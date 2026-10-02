// Drives the app like a person presenting it: the pointer travels on eased, slightly curved paths,
// clicks are deliberate and followed by a beat, typing is readable. Every pointer position, click
// and change of cursor shape is written to Recordly's cursor log (wall-clock ms, recording
// coordinates), which is what its redrawn cursor, click effects and auto-zooms are made from.
//
// It drives a surface (lib/surfaces.mjs): one browser page (PageSurface, input sent into the page),
// or the whole desktop (DesktopSurface, real system input that every window sees, for flows across
// several apps, or apps like Recordly that watch the real pointer).
//
// Pacing matters for the zooms: Recordly zooms in on clicks, and on "settles" (the pointer moved,
// then stayed put for ~0.8 s). Clicks closer than ~2 s apart merge into one longer zoom.
//
// Each action is also written down as a "beat" (what it was, when, and where its target and result
// are) so review.mjs can check every zoom against what the viewer needs to see. Pass `show` (a
// selector or locator, or a list) to say what the viewer should see after an action, e.g. the dialog
// a button opens; without it the review works it out from what changed on screen. Pass `zoom` (an
// amount, or true for 1.8×) to want a zoom on an action even where Recordly suggests none; review.mjs
// --fix adds it, as far as still shows the action's target and result.
import {PageSurface} from './surfaces.mjs';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const ease = t => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const isPoint = t => t && typeof t === 'object' && 'x' in t && 'y' in t && !('boundingBox' in t);

export class Director {
  /** @param {import('./surfaces.mjs').PageSurface | import('./surfaces.mjs').DesktopSurface | import('playwright-core').Page} surface */
  constructor(surface) {
    this.s = 'mouse' in surface ? new PageSurface(surface) : surface;
    this.log = [];
    this.beats = [];
    this.pos = null;
    this.kind = null;
    this.kindAt = 0;
  }

  #write(entry) {
    this.log.push({t: Date.now(), ...entry});
  }

  /** The pointer's shape (hand, open hand, I-beam, arrow), logged on change; at most every 100 ms while moving. */
  async #shape({force = false} = {}) {
    if (!force && Date.now() - this.kindAt < 100) return;
    this.kindAt = Date.now();
    const kind = (await this.s.shape(this.pos).catch(() => null)) ?? this.kind ?? 'arrow';
    if (kind !== this.kind) {
      this.kind = kind;
      this.#write({cursor: kind});
    }
  }

  async #box(target) {
    if (isPoint(target)) return {x: target.x - 4, y: target.y - 4, w: 8, h: 8};
    return this.s.box(target).catch(() => null);
  }

  /** Boxes of the `show` targets, noting any that aren't on screen. */
  async #shows(beat, show) {
    const list = [show].flat();
    const boxes = await Promise.all(list.map(s => this.#box(s)));
    beat.show = boxes.filter(Boolean);
    const missing = list.filter((_, i) => !boxes[i]).map(String);
    if (missing.length) beat.showMissing = missing.join(', ');
  }

  /** Notes an action for the review: its target's box now, the `show` boxes once it has played out. */
  async #beat(action, label, target, t, show, zoom) {
    const beat = {action, label: label ?? (typeof target === 'string' ? target : String(target)), t, target: target ? await this.#box(target) : null};
    if (zoom) beat.zoom = zoom === true ? 1.8 : zoom;
    this.beats.push(beat);
    return async () => {
      beat.end = Date.now();
      if (show) await this.#shows(beat, show);
    };
  }

  async #moveRaw(x, y) {
    await this.s.move(x, y);
    this.pos = {x, y};
    this.#write({x, y});
  }

  /** Puts the pointer somewhere without travelling (before recording starts). */
  async park(x, y) {
    await this.#moveRaw(x, y);
    await this.#shape({force: true});
  }

  async #point(target) {
    if (isPoint(target)) return target;
    const b = await this.s.point(target);
    if (!b) throw new Error(`not visible: ${target}`);
    return {x: Math.round(b.x + b.w / 2), y: Math.round(b.y + b.h / 2)};
  }

  /** Travels to a target: a locator, a selector (page flows) or {x, y}. */
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
  async click(target, {hold = 700, show, label, zoom} = {}) {
    const done = await this.#beat('click', label, target, null, show, zoom);
    const p = await this.moveTo(target);
    await sleep(140);
    this.beats.at(-1).t ??= Date.now();
    this.#write({click: 'down', button: 0, x: p.x, y: p.y});
    await this.s.down();
    await sleep(70);
    await this.s.up();
    this.#write({click: 'up', button: 0, x: p.x, y: p.y});
    // what's under the pointer may have changed (a dialog closed, a page opened)
    await sleep(Math.min(hold, 150));
    await this.#shape({force: true});
    await sleep(Math.max(0, hold - 150));
    await done();
  }

  /** Clicks a field and types into it at a readable pace. */
  async type(target, text, {delay = 55, hold = 500, show, label, zoom} = {}) {
    await this.click(target, {hold: 250, label: label ?? `type "${text}"`, zoom});
    const beat = this.beats.at(-1);
    beat.action = 'type';
    await this.s.type(text, delay);
    await sleep(hold);
    beat.end = Date.now();
    beat.target = (await this.#box(target)) ?? beat.target;
    if (show) await this.#shows(beat, show);
  }

  /** Presses a key (Playwright names: Enter, Escape, Tab, Space…). */
  async press(key, {hold = 600, show, label, zoom} = {}) {
    const done = await this.#beat('press', label ?? `press ${key}`, null, Date.now(), show, zoom);
    await this.s.press(key);
    await sleep(hold);
    await done();
  }

  /** Hovers over something long enough to count as a settle (a soft zoom). */
  async point(target, {hold = 1200, show, label, zoom} = {}) {
    await this.moveTo(target);
    const done = await this.#beat('point', label, target, Date.now(), show, zoom);
    await sleep(hold);
    await done();
  }

  wait(ms) {
    return sleep(ms);
  }
}
