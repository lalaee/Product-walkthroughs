// Opens a web page in a frameless, see-through window at a given place on a desktop (Electron, from
// the Recorder-2 checkout). For props like a phone screen next to the app being recorded.
import {join} from 'node:path';
import {_electron as electron} from 'playwright-core';

/** Returns {page, origin, close}: the page (to point at), where it sits on screen, and a way to close it. */
export async function openWebWindow({url, x, y, width, height, env, recordly}) {
  const app = await electron.launch({
    executablePath: join(recordly, 'node_modules', 'electron', 'dist', 'electron'),
    args: [join(import.meta.dirname, 'webwindow', 'main.cjs'), '--no-sandbox', `--url=${url}`, `--bounds=${x},${y},${width},${height}`],
    env,
    timeout: 60_000
  });
  const page = await app.firstWindow();
  await page.waitForLoadState();
  const origin = async () => {
    const bw = await app.browserWindow(page);
    return bw.evaluate(w => {
      const c = w.getContentBounds();
      return {x: c.x, y: c.y};
    });
  };
  return {page, origin, close: () => app.close().catch(() => {})};
}
