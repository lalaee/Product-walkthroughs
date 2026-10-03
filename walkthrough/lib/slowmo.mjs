// Slow motion for a page that can't draw fast enough here: its clock runs `factor` times slower,
// so it has time for every frame, and the director plays that stretch of the capture `factor`
// times faster (d.fast). The video shows it at its real speed and a full frame rate, as on a
// machine with a GPU.
//
// The page's clock is what it animates by: requestAnimationFrame's timestamps and
// performance.now(), and its media elements' playback rate. Recordly's editor plays back by
// exactly these (its playhead advances by animation-frame time; the video elements follow it).

/** Runs `fn` with the page's clock `factor` times slower. */
export async function slowMotion(page, factor, fn) {
  await page.evaluate(scale => {
    if (!window.__slowMotion) {
      const realNow = performance.now.bind(performance);
      let base = realNow(), virtualBase = base, rate = 1;
      const virtual = t => virtualBase + (t - base) * rate;
      performance.now = () => virtual(realNow());
      const raf = window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame = cb => raf(t => cb(virtual(t)));
      // media plays at the rate the page asked for, times the clock's
      const desc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'playbackRate');
      const media = new Set();
      Object.defineProperty(HTMLMediaElement.prototype, 'playbackRate', {
        configurable: true,
        get() {
          return this.__asked ?? desc.get.call(this);
        },
        set(v) {
          this.__asked = v;
          media.add(this);
          desc.set.call(this, v * rate);
        }
      });
      window.__slowMotion = r => {
        const now = realNow();
        virtualBase = virtual(now);
        base = now;
        rate = r;
        for (const m of media) desc.set.call(m, (m.__asked ?? 1) * r);
      };
    }
    window.__slowMotion(scale);
  }, 1 / factor);
  try {
    return await fn();
  } finally {
    await page.evaluate(() => window.__slowMotion(1));
  }
}
