// What the director drives. Both take the same calls: pointer moves and button presses in recording
// coordinates, typing, key presses, the box of a target, and the pointer's shape.
import {execFileSync} from 'node:child_process';

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

const KEYS = {Enter: 'Return', Escape: 'Escape', Tab: 'Tab', Space: 'space', Backspace: 'BackSpace', Delete: 'Delete', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right'};

/**
 * The whole desktop (an X display): real pointer, clicks and keys through xdotool, which every
 * window sees, and which apps that watch the system pointer (like Recordly itself) pick up.
 * Coordinates are the screen's. Targets are Playwright locators in pages registered with where
 * their content sits on screen; the pointer's shape is the system cursor's, through Recordly's native
 * module (cursorKind), so it's right over any window.
 */
export class DesktopSurface {
  /** @param {{display: string, native?: {cursorKind?: () => string | null}}} opts */
  constructor({display, native}) {
    this.env = {...process.env, DISPLAY: display};
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
    this.#x('mousemove', x, y);
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
  async box(locator) {
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
    await locator.first().scrollIntoViewIfNeeded({timeout: 5000}).catch(() => {});
    return this.box(locator);
  }
  async shape() {
    const k = this.native?.cursorKind?.();
    return k === 'pointer' || k === 'grab' || k === 'text' ? k : 'arrow';
  }
}
