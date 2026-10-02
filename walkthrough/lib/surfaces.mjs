// What the director drives. Both take the same calls: pointer moves and button presses in recording
// coordinates, typing, key presses, the box of a target, and the pointer's shape.
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';

/** Whether an element is something a person clicks (the hand belongs over it). */
const CLICKABLE = el => !!el.closest('button, a[href], summary, select, label, [role=button], [role=link], [role=tab], [role=menuitem], [role=option], [role=switch], [role=radio], [role=checkbox], [role=gridcell], input[type=checkbox], input[type=radio], input[type=button], input[type=submit]');

/** One browser page; input goes into the page and coordinates are the page's own. */
export class PageSurface {
  /** @param {import('playwright-core').Page} page */
  constructor(page) {
    this.page = page;
  }
  #loc(target) {
    return typeof target === 'string' ? this.page.locator(target) : target;
  }
  move(x, y) {
    return this.page.mouse.move(x, y);
  }
  down() {
    return this.page.mouse.down();
  }
  up() {
    return this.page.mouse.up();
  }
  type(text, delay) {
    return this.page.keyboard.type(text, {delay});
  }
  press(key) {
    return this.page.keyboard.press(key);
  }
  async box(target) {
    const b = await this.#loc(target).first().boundingBox({timeout: 1000});
    return b && {x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height)};
  }
  async point(target) {
    await this.#loc(target).first().scrollIntoViewIfNeeded();
    return this.box(target);
  }
  clickable(target) {
    return this.#loc(target).first().evaluate(new Function('el', `return (${CLICKABLE})(el)`), null, {timeout: 1000});
  }
  text(target) {
    return this.#loc(target).first().innerText({timeout: 1000});
  }
  /** As the browser would draw it, from the CSS cursor under the pointer. */
  shape({x, y}) {
    return this.page.evaluate(([x, y]) => {
      const el = document.elementFromPoint(x, y);
      if (!el) return 'arrow';
      const c = getComputedStyle(el).cursor;
      if (c === 'pointer') return 'pointer';
      if (c === 'grab' || c === 'grabbing') return 'grab';
      if (c === 'text' || c === 'vertical-text') return 'text';
      if (c === 'auto' && (el.isContentEditable || el.matches('textarea, input:not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]):not([type=range]):not([type=color]):not([type=file])'))) return 'text';
      return 'arrow';
    }, [x, y]);
  }
}

const KEYS = {Control: 'ctrl', Ctrl: 'ctrl', Shift: 'shift', Alt: 'alt', Meta: 'super', Enter: 'Return', Escape: 'Escape', Tab: 'Tab', Space: 'space', Backspace: 'BackSpace', Delete: 'Delete', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right'};

/**
 * The whole desktop (an X display): real pointer, clicks and keys through xdotool, which every
 * window sees, and which apps that watch the system pointer (like Recordly itself) pick up.
 * Coordinates are the screen's. Targets are Playwright locators in pages registered with where
 * their content sits on screen; the pointer's shape is the system cursor's, through Recordly's native
 * module (cursorKind), so it's right over any window.
 */
export class DesktopSurface {
  /** @param {{display: string, native?: {cursorKind?: () => string | null}}} opts */
  constructor({display, native, scale = 1}) {
    this.env = {...process.env, DISPLAY: display};
    this.scale = scale; // pixels per point: xdotool works in pixels, everything else in points
    this.native = native;
    this.origins = new Map();
  }
  /** Says where a page's content is on screen: `origin()` returns its top-left, now. */
  register(page, origin) {
    this.origins.set(page, origin);
    return page;
  }
  #x(...args) {
    execFileSync('xdotool', args.map(String), {env: this.env});
  }
  move(x, y) {
    this.#x('mousemove', Math.round(x * this.scale), Math.round(y * this.scale));
  }
  down() {
    this.#x('mousedown', 1);
  }
  up() {
    this.#x('mouseup', 1);
  }
  type(text, delay) {
    this.#x('type', '--delay', delay, text);
  }
  press(key) {
    this.#x('key', key.split('+').map(k => KEYS[k] ?? k).join('+'));
  }
  /**
   * An app window that isn't a web page (a Flutter, GTK or Qt app), by its title. Its targets are
   * found on screen: `.text('Send')` by OCR (the words' box, read from the window as it looks now),
   * `.at(x, y, w, h)` by position in the window.
   */
  window(title) {
    const surface = this;
    const geometry = () => {
      const id = execFileSync('xdotool', ['search', '--onlyvisible', '--name', title], {env: this.env}).toString().trim().split('\n')[0];
      const g = Object.fromEntries(execFileSync('xdotool', ['getwindowgeometry', '--shell', id], {env: this.env}).toString().trim().split('\n').map(l => l.split('=')));
      return {id, x: Number(g.X) / surface.scale, y: Number(g.Y) / surface.scale, w: Number(g.WIDTH) / surface.scale, h: Number(g.HEIGHT) / surface.scale};
    };
    return {
      title,
      geometry,
      text: (words, {nth = 0} = {}) => ({toString: () => `"${words}"`, label: words, clickable: true, resolve: async () => surface.#ocrFind(geometry(), words, nth)}),
      at: (x, y, w, h, label = `${title} @${x},${y}`) => ({toString: () => label, label, clickable: true, resolve: async () => {
        const g = geometry();
        return {x: Math.round(g.x + x), y: Math.round(g.y + y), w, h};
      }})
    };
  }

  #ocr = new Map(); // window id → {key, words}: OCR of a window, reused while the window looks the same
  /** The box of `words` in a window, read by OCR (tesseract, the window enlarged 2× for small text). */
  async #ocrFind(g, words, nth) {
    const s = this.scale, k = 2;
    // grabbed without the pointer, which would hide the word under it
    const grab = vf => execFileSync('ffmpeg', ['-v', 'error', '-f', 'x11grab', '-draw_mouse', '0', '-video_size', `${Math.round(g.w * s)}x${Math.round(g.h * s)}`, '-i', `${this.env.DISPLAY}+${Math.round(g.x * s)},${Math.round(g.y * s)}`, '-frames:v', '1', '-vf', vf, '-f', 'image2pipe', '-c:v', 'png', '-'], {maxBuffer: 1 << 28});
    // a small thumbnail says whether the window changed since the last read (OCR takes a second)
    const key = `${g.x},${g.y},${g.w},${g.h}:` + createHash('md5').update(grab('scale=160:-2,format=gray')).digest('hex');
    let hit = this.#ocr.get(g.id);
    if (!hit || hit.key !== key) {
      const png = grab(`scale=iw*${k / s}:ih*${k / s}:flags=lanczos,format=gray`);
      const tsv = execFileSync('tesseract', ['stdin', 'stdout', '--psm', '11', 'tsv'], {input: png, stdio: ['pipe', 'pipe', 'ignore'], maxBuffer: 1 << 26}).toString();
      const found = tsv.trim().split('\n').slice(1).map(l => l.split('\t')).filter(c => c[11]?.trim() && Number(c[10]) > 30)
        .map(c => ({t: c[11].trim(), x: g.x + Number(c[6]) / k, y: g.y + Number(c[7]) / k, w: Number(c[8]) / k, h: Number(c[9]) / k}));
      hit = {key, words: found};
      this.#ocr.set(g.id, hit);
    }
    // the phrase as consecutive words on one line (case and punctuation aside)
    const norm = t => t.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
    const want = words.split(/\s+/).map(norm).filter(Boolean);
    const ws = hit.words, matches = [];
    for (let i = 0; i + want.length <= ws.length; i++) {
      const run = ws.slice(i, i + want.length);
      if (run.every((w, j) => norm(w.t) === want[j]) && run.every(w => Math.abs(w.y - run[0].y) < run[0].h)) {
        const x = Math.min(...run.map(w => w.x)), y = Math.min(...run.map(w => w.y));
        matches.push({x: Math.round(x), y: Math.round(y), w: Math.round(Math.max(...run.map(w => w.x + w.w)) - x), h: Math.round(Math.max(...run.map(w => w.y + w.h)) - y)});
      }
    }
    return matches[nth] ?? null;
  }

  async box(locator) {
    if (locator.resolve) return locator.resolve();
    const origin = this.origins.get(locator.page());
    if (!origin) throw new Error('a target in a page the desktop has no position for (register it)');
    const r = await locator.first().evaluate(e => {
      const b = e.getBoundingClientRect();
      return b.width && b.height ? {x: b.x, y: b.y, w: b.width, h: b.height} : null;
    }, null, {timeout: 1000});
    if (!r) return null;
    const o = await origin();
    return {x: Math.round(o.x + r.x), y: Math.round(o.y + r.y), w: Math.round(r.w), h: Math.round(r.h)};
  }
  async point(locator) {
    if (locator.resolve) {
      // OCR can miss a frame mid-animation: try for a few seconds
      for (let i = 0; i < 6; i++) {
        const b = await locator.resolve();
        if (b) return b;
        await new Promise(r => setTimeout(r, 500));
      }
      return null;
    }
    await locator.first().scrollIntoViewIfNeeded({timeout: 5000}).catch(() => {});
    return this.box(locator);
  }
  clickable(locator) {
    if (locator.resolve) return Promise.resolve(!!locator.clickable);
    return locator.first().evaluate(new Function('el', `return (${CLICKABLE})(el)`), null, {timeout: 1000});
  }
  text(locator) {
    if (locator.resolve) return Promise.resolve(locator.label ?? '');
    return locator.first().innerText({timeout: 1000});
  }
  async shape() {
    const k = this.native?.cursorKind?.();
    return k === 'pointer' || k === 'grab' || k === 'text' ? k : 'arrow';
  }
}
