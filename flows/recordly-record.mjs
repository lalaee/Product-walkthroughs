// Recordly's key flow, on a desktop: start a new recording, hide the recorder, record a short Taskly
// session in the browser, stop with the shortcut, and land in the editor with zooms suggested from
// the clicks; trim the start and play it back.
//
// Runs Recordly (Recorder-2) for real: its recorder captures the screen and watches the real pointer,
// so the director uses real input (a desktop flow, see walkthrough/record.mjs).
import {mkdirSync, rmSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {chromium} from 'playwright-core';
import {launchRecordly} from '../walkthrough/lib/recordly.mjs';
import {finishInEditor, recordTaskly} from './recordly-steps.mjs';

export const name = 'Recordly — record your screen';
export const desktop = true;
export const size = '1440x900';
export const scale = 8 / 3; // 3840×2400 pixels: 4K at 16:10
export const aspect = '16:10';

const taskly = pathToFileURL(new URL('../demo-app/index.html', import.meta.url).pathname).href;

export async function launch({env, desktop, out, width, height, scale, recordly}) {
  // the app being recorded: Taskly in a browser, filling the screen
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    headless: false,
    env,
    args: ['--window-position=0,0', `--window-size=${width},${height}`, '--no-first-run', '--disable-infobars', '--hide-crash-restore-bubble', `--force-device-scale-factor=${scale}`]
  });
  const page = await (await browser.newContext({viewport: null})).newPage();
  await page.goto(taskly);
  desktop.register(page, async () => page.evaluate(() => ({x: screenX + (outerWidth - innerWidth) / 2, y: screenY + outerHeight - innerHeight})));

  // Recordly, in front and full screen, with an empty library of its own
  const library = join(out, 'recordly-library');
  rmSync(library, {recursive: true, force: true});
  mkdirSync(library, {recursive: true});
  const rec = await launchRecordly({dir: recordly, env, library, scale, settings: {hideRecorder: false}});
  const main = await rec.window('main');
  desktop.register(main, rec.origin(main));
  await (await rec.app.browserWindow(main)).evaluate(w => w.maximize());
  const overlay = await rec.window('overlay');
  desktop.register(overlay, rec.origin(overlay));
  await main.getByText('Record your first video').waitFor();
  await page.waitForTimeout(1500);

  return {
    main, overlay, taskly: page,
    close: async () => {
      writeFileSync(join(out, 'recordly.log'), rec.log.join(''));
      await rec.close();
      await browser.close();
    }
  };
}

/** @param {import('../walkthrough/lib/director.mjs').Director} d */
export async function run(d, ctx) {
  const {main, overlay} = ctx;
  const bar = [overlay.getByRole('button', {name: /^Move recorder/}), overlay.getByRole('button', {name: 'More recorder options'})];
  await d.point(main.getByText('Record your first video'), {hold: 900});
  await d.click(main.getByRole('button', {name: 'New recording'}).last(), {hold: 1300, show: bar, label: 'New recording'});
  await d.point(overlay.getByRole('button', {name: /^Countdown/}), {hold: 1100, show: bar, label: 'the recorder bar', zoom: 1.8});
  const trimAt = await recordTaskly(d, ctx);
  await finishInEditor(d, ctx, trimAt);
}
