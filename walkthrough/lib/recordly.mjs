// Recordly (Recorder-2) from scripts: where it is, and launching it with a given library and settings.
import {createRequire} from 'node:module';
import {existsSync, mkdtempSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {_electron as electron} from 'playwright-core';

/** The Recorder-2 checkout: --recordly, $RECORDLY_DIR, or ../recorder-2 next to this repo. */
export function recordlyDir(arg) {
  return resolve(arg ?? process.env.RECORDLY_DIR ?? join(import.meta.dirname, '..', '..', '..', 'recorder-2'));
}

/** Recordly's native module (pointer, clicks, cursor shape), loaded into this process. */
export function recordlyNative(dir) {
  const file = join(dir, 'native', 'recordly_native.node');
  return existsSync(file) ? createRequire(import.meta.url)(file) : null;
}

/**
 * Launches Recordly with a fresh profile, already onboarded, its recordings folder at `library`.
 * Returns the app, a lookup for its windows by kind ('main', 'overlay'), and where a window's content
 * sits on screen.
 *
 * `platform` ('win' or 'mac') runs Recordly's interface as it is on that system: Recordly reads the
 * platform once, in its preload, so a preload of ours that runs first reports that one. Only the
 * interface follows (on Windows: the recorder's own screen and window picker, Windows window
 * buttons); everything underneath still runs on this machine, with the one Windows-only Electron
 * call that path makes (screen.screenToDipRect) filled in.
 */
export async function launchRecordly({dir, env = process.env, library, motion = 'smooth', settings = {}, recorder = {}, downloads, scale, platform}) {
  const userData = mkdtempSync(join(tmpdir(), 'recordly-profile-'));
  writeFileSync(
    join(userData, 'state.json'),
    JSON.stringify({
      onboarded: true,
      settings: {autoZooms: true, connectZooms: true, motionPreset: motion, hideRecorder: true, recordingsPath: library, experimentalUpdates: false, ...settings},
      recorder: {sourceId: null, micOn: false, micId: null, sysAudio: false, camOn: false, camId: null, countdown: 3, floatingPreview: true, ...recorder}
    })
  );
  const app = await electron.launch({
    executablePath: join(dir, 'node_modules', 'electron', 'dist', 'electron'),
    cwd: join(dir, 'apps', 'desktop'),
    args: ['.', '--no-sandbox', `--user-data-dir=${userData}`, '--autoplay-policy=no-user-gesture-required', ...(scale ? [`--force-device-scale-factor=${scale}`] : [])],
    env,
    timeout: 60_000
  });
  const log = [];
  app.process().stderr?.on('data', d => log.push(String(d)));
  app.process().stdout?.on('data', d => log.push(String(d)));
  app.on('window', w => w.on('console', m => log.push(`[${m.type()}] ${m.text()}\n`)));
  for (const w of app.windows()) w.on('console', m => log.push(`[${m.type()}] ${m.text()}\n`));
  if (downloads) await app.evaluate(({app}, dir) => app.setPath('downloads', dir), downloads);
  if (platform) {
    const preload = join(userData, 'platform-preload.cjs');
    writeFileSync(preload, `Object.defineProperty(process, 'platform', {value: ${JSON.stringify({win: 'win32', mac: 'darwin'}[platform])}});\n`);
    await app.evaluate(({session}, filePath) => session.defaultSession.registerPreloadScript({type: 'frame', filePath}), preload);
    // Electron's Windows-only screen.screenToDipRect, which Recordly's main process uses to place a
    // window recording there: here, made of screenToDipPoint (which Electron has on Linux too)
    await app.evaluate(({screen}) => {
      if (screen.screenToDipRect) return;
      screen.screenToDipRect = (_window, r) => {
        const a = screen.screenToDipPoint({x: r.x, y: r.y}), b = screen.screenToDipPoint({x: r.x + r.width, y: r.y + r.height});
        return {x: a.x, y: a.y, width: b.x - a.x, height: b.y - a.y};
      };
    });
    // the windows that are already open load again, with it
    for (const w of app.windows()) await w.reload().catch(() => {});
  }

  /** The window of a kind, once it exists. */
  async function window(kind, timeout = 30_000) {
    const until = Date.now() + timeout;
    while (Date.now() < until) {
      for (const w of app.windows()) if ((await w.evaluate(() => window.recordly?.window).catch(() => null)) === kind) return w;
      await new Promise(r => setTimeout(r, 300));
    }
    throw new Error(`Recordly's ${kind} window didn't open`);
  }
  /** Where a window's content is on screen, now. */
  const origin = page => async () => {
    const bw = await app.browserWindow(page);
    return bw.evaluate(w => {
      const c = w.getContentBounds();
      return {x: c.x, y: c.y};
    });
  };
  return {app, window, origin, log, close: () => app.close().catch(() => {})};
}
