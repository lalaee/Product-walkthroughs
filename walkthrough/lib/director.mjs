// Drives the page like a person presenting it: the pointer travels on eased, slightly curved paths,
// clicks are deliberate and followed by a beat, typing is readable. Every pointer position and
// click is written to Recordly's cursor log (wall-clock ms, screen coordinates), which is what its
// redrawn cursor, click effects and auto-zooms are made from.
//
// Pacing matters for the zooms: Recordly zooms in on clicks, and on "settles" (the pointer moved,
// then stayed put for ~0.8 s). Clicks closer than ~2 s apart merge into one longer zoom.

const sleep = ms => new Promise(r => setTimeout(r, ms));
const ease = t => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

export class Director {
  /** @param {import('playwright-core').Page} page  @param {{x:number,y:number}} origin  the page's top-left on screen */
  constructor(page, origin = {x: 0, y: 0}) {
    this.page = page;
    this.origin = origin;
    this.log = [];
    this.pos = null;
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
      if (k >= 1) break;
      await sleep(16);
    }
    return to;
  }

  /** Moves to the target and clicks it, then holds for `hold` ms so the viewer sees the result. */
  async click(target, {hold = 700} = {}) {
    const p = await this.moveTo(target);
    await sleep(140);
    this.#write({click: 'down', button: 0, x: p.x + this.origin.x, y: p.y + this.origin.y});
    await this.page.mouse.down();
    await sleep(70);
    await this.page.mouse.up();
    this.#write({click: 'up', button: 0, x: p.x + this.origin.x, y: p.y + this.origin.y});
    await sleep(hold);
  }

  /** Clicks a field and types into it at a readable pace. */
  async type(target, text, {delay = 55, hold = 500} = {}) {
    await this.click(target, {hold: 250});
    await this.page.keyboard.type(text, {delay});
    await sleep(hold);
  }

  async press(key, {hold = 600} = {}) {
    await this.page.keyboard.press(key);
    await sleep(hold);
  }

  /** Hovers over something long enough to count as a settle (a soft zoom). */
  async point(target, {hold = 1200} = {}) {
    await this.moveTo(target);
    await sleep(hold);
  }

  wait(ms) {
    return sleep(ms);
  }
}
