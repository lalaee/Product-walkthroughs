// Drives the page like a person presenting it: the pointer travels on eased, slightly curved paths,
// clicks are deliberate and followed by a beat, typing is readable. Every pointer position and
// click is written to Recordly's cursor log (wall-clock ms, screen coordinates), which is what its
// redrawn cursor, click effects and auto-zooms are made from.
//
// Pacing matters for the zooms: Recordly zooms in on clicks, and on "settles" (the pointer moved,
// then stayed put for ~0.8 s). Clicks closer than ~2 s apart merge into one longer zoom.
//
// Each action is also written down as a "beat" (what it was, when, and where on the page its target
// and result are) so review.mjs can check every zoom against what the viewer needs to see. Pass
// `show` (a selector or locator) to say what the viewer should see after an action, e.g. the dialog
// a button opens; without it the review works it out from what changed on screen.

const sleep = ms => new Promise(r => setTimeout(r, ms));
const ease = t => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

export class Director {
  /** @param {import('playwright-core').Page} page  @param {{x:number,y:number}} origin  the page's top-left on screen */
  constructor(page, origin = {x: 0, y: 0}) {
    this.page = page;
    this.origin = origin;
    this.log = [];
    this.beats = [];
    this.pos = null;
    this.kind = null;
    this.kindAt = 0;
  }

  /**
   * The pointer's shape where it is now, as the browser would draw it: the hand over links and
   * buttons, the open hand over things to drag (Recordly closes it while the button is held), the
   * I-beam over fields. Written to the log on change ({"cursor": …}), checked at most
   * every 100 ms while moving (as Recordly's own recorder does) and always when the pointer stops.
   */
  async #shape({force = false} = {}) {
    if (!force && Date.now() - this.kindAt < 100) return;
    this.kindAt = Date.now();
    const {x, y} = this.pos;
    const kind = await this.page.evaluate(([x, y]) => {
      const el = document.elementFromPoint(x, y);
      if (!el) return 'arrow';
      const c = getComputedStyle(el).cursor;
      if (c === 'pointer') return 'pointer';
      if (c === 'grab' || c === 'grabbing') return 'grab';
      if (c === 'text' || c === 'vertical-text') return 'text';
      if (c === 'auto' && (el.isContentEditable || el.matches('textarea, input:not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]):not([type=range]):not([type=color]):not([type=file])'))) return 'text';
      return 'arrow';
    }, [x, y]).catch(() => this.kind ?? 'arrow');
    if (kind !== this.kind) {
      this.kind = kind;
      this.#write({cursor: kind});
    }
  }

  /** Boxes of the `show` targets, noting any that aren't on screen. */
  async #shows(beat, show) {
    const list = [show].flat();
    const boxes = await Promise.all(list.map(s => this.#box(s)));
    beat.show = boxes.filter(Boolean);
    const missing = list.filter((_, i) => !boxes[i]).map(String);
    if (missing.length) beat.showMissing = missing.join(', ');
  }

  async #box(target) {
    if (typeof target === 'string') target = this.page.locator(target);
    const b = await target.first().boundingBox({timeout: 1000}).catch(() => null);
    return b && {x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height)};
  }

  /** Notes an action for the review: its target's box now, the `show` boxes once it has played out. */
  async #beat(action, label, target, t, show) {
    const beat = {action, label: label ?? (typeof target === 'string' ? target : String(target)), t, target: target && typeof target === 'object' && 'x' in target && !('boundingBox' in target) ? {x: target.x - 4, y: target.y - 4, w: 8, h: 8} : target ? await this.#box(target) : null};
    this.beats.push(beat);
    return async () => {
      beat.end = Date.now();
      if (show) await this.#shows(beat, show);
    };
  }

  #write(entry) {
    this.log.push({t: Date.now(), ...entry});
  }

  async #moveRaw(x, y) {
    await this.page.mouse.move(x, y);
    this.pos = {x, y};
    this.#write({x: x + this.origin.x, y: y + this.origin.y});
  }

  /** Puts the pointer somewhere without travelling (before recording starts). */
  async park(x, y) {
    await this.#moveRaw(x, y);
    await this.#shape({force: true});
  }

  async #point(target) {
    if (typeof target === 'string') target = this.page.locator(target);
    if (target && 'x' in target && 'y' in target && !('boundingBox' in target)) return target;
    await target.first().scrollIntoViewIfNeeded();
    const b = await target.first().boundingBox();
    if (!b) throw new Error(`not visible: ${target}`);
    return {x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2)};
  }

  /** Travels to a locator, selector or {x, y}. */
  async moveTo(target, {duration} = {}) {
    const to = await this.#point(target);
    const from = this.pos ?? to;
    const dist = Math.hypot(to.x - from.x, to.y - from.y);
    if (dist < 1) return to;
    duration ??= Math.min(1100, 380 + dist * 0.45);
    // bend the path a little to one side, like a hand does
    const nx = -(to.y - from.y) / dist, ny = (to.x - from.x) / dist;
    const bend = Math.min(60, dist * 0.08);
    const t0 = Date.now();
    for (;;) {
      const k = Math.min(1, (Date.now() - t0) / duration);
      const e = ease(k), arc = Math.sin(Math.PI * k) * bend;
      await this.#moveRaw(Math.round(from.x + (to.x - from.x) * e + nx * arc), Math.round(from.y + (to.y - from.y) * e + ny * arc));
      await this.#shape({force: k >= 1});
      if (k >= 1) break;
      await sleep(16);
    }
    return to;
  }

  /** Moves to the target and clicks it, then holds for `hold` ms so the viewer sees the result. */
  async click(target, {hold = 700, show, label} = {}) {
    const done = await this.#beat('click', label, target, null, show);
    const p = await this.moveTo(target);
    await sleep(140);
    this.beats.at(-1).t ??= Date.now();
    this.#write({click: 'down', button: 0, x: p.x + this.origin.x, y: p.y + this.origin.y});
    await this.page.mouse.down();
    await sleep(70);
    await this.page.mouse.up();
    this.#write({click: 'up', button: 0, x: p.x + this.origin.x, y: p.y + this.origin.y});
    // what's under the pointer may have changed (a dialog closed, a page opened)
    await sleep(Math.min(hold, 150));
    await this.#shape({force: true});
    await sleep(Math.max(0, hold - 150));
    await done();
  }

  /** Clicks a field and types into it at a readable pace. */
  async type(target, text, {delay = 55, hold = 500, show, label} = {}) {
    await this.click(target, {hold: 250, label: label ?? `type "${text}"`});
    const beat = this.beats.at(-1);
    beat.action = 'type';
    await this.page.keyboard.type(text, {delay});
    await sleep(hold);
    beat.end = Date.now();
    beat.target = (await this.#box(target)) ?? beat.target;
    if (show) await this.#shows(beat, show);
  }

  async press(key, {hold = 600, show, label} = {}) {
    const done = await this.#beat('press', label ?? `press ${key}`, null, Date.now(), show);
    await this.page.keyboard.press(key);
    await sleep(hold);
    await done();
  }

  /** Hovers over something long enough to count as a settle (a soft zoom). */
  async point(target, {hold = 1200, show, label} = {}) {
    await this.moveTo(target);
    const done = await this.#beat('point', label, target, Date.now(), show);
    await sleep(hold);
    await done();
  }

  wait(ms) {
    return sleep(ms);
  }
}
