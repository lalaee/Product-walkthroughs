// Recordly's key flow, on a desktop: start a new recording, record a short Taskly session in the
// browser, stop, and land in the editor with zooms suggested from the clicks, then play it back.
//
// Runs Recordly (Recorder-2) for real: its recorder captures the screen and watches the real pointer,
// so the director uses real input (a desktop flow, see walkthrough/record.mjs).
import {mkdirSync, rmSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {chromium} from 'playwright-core';
import {launchRecordly} from '../walkthrough/lib/recordly.mjs';

export const name = 'Recordly — record your screen';
export const desktop = true;

const taskly = pathToFileURL(new URL('../demo-app/index.html', import.meta.url).pathname).href;

export async function launch({env, desktop, out, width, height, recordly}) {
  // the app being recorded: Taskly in a browser, filling the screen
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    headless: false,
    env,
    args: ['--window-position=0,0', `--window-size=${width},${height}`, '--no-first-run', '--disable-infobars', '--hide-crash-restore-bubble', '--force-device-scale-factor=1']
  });
  const page = await (await browser.newContext({viewport: null})).newPage();
  await page.goto(taskly);
  desktop.register(page, async () => page.evaluate(() => ({x: screenX + (outerWidth - innerWidth) / 2, y: screenY + outerHeight - innerHeight})));

  // Recordly, in front, with an empty library of its own
  const library = join(out, 'recordly-library');
  rmSync(library, {recursive: true, force: true});
  mkdirSync(library, {recursive: true});
  const rec = await launchRecordly({dir: recordly, env, library, settings: {hideRecorder: false}});
  const main = await rec.window('main');
  desktop.register(main, rec.origin(main));
  // full screen, so its interface reads at video size
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
export async function run(d, {main, overlay, taskly}) {
  const bar = [overlay.getByRole('button', {name: /^Move recorder/}), overlay.getByRole('button', {name: 'More recorder options'})];
  await d.point(main.getByText('Record your first video'), {hold: 900});
  await d.click(main.getByRole('button', {name: 'New recording'}).last(), {hold: 1300, show: bar, label: 'New recording'});
  await d.point(overlay.getByRole('button', {name: /^Countdown/}), {hold: 1100, show: bar, label: 'the recorder bar', zoom: 1.8});
  await d.click(overlay.getByRole('button', {name: 'Record', exact: true}), {hold: 500, show: overlay.getByText('Recording your screen'), label: 'Record'});
  await overlay.getByText(/Recording \d+:\d+/).waitFor({timeout: 15_000});
  await d.wait(600);

  // what's being recorded
  await d.click(taskly.locator('#new-project'), {hold: 900, show: taskly.locator('.dialog')});
  await d.type(taskly.locator('#name'), 'Product launch');
  await d.click(taskly.locator('#create'), {hold: 1500, show: taskly.locator('.card.new')});

  await d.click(overlay.getByRole('button', {name: 'Stop', exact: true}), {hold: 400, label: 'Stop'});
  const preview = main.locator('canvas[aria-label=Preview]');
  await preview.waitFor({timeout: 30_000});
  // Recordly analyses the recording, then suggests zooms on the timeline
  const zoom = main.getByRole('button', {name: /Auto \(follows cursor\)|Manual focus/}).first();
  // (now and then they don't appear on their own; then ask, as a person would)
  if (!(await zoom.waitFor({timeout: 12_000}).then(() => true, () => false))) {
    await d.click(main.getByRole('button', {name: 'Suggest zooms'}).first(), {hold: 900, show: zoom, label: 'Suggest zooms'});
    await zoom.waitFor({timeout: 15_000});
  }
  await d.wait(1200);
  await d.point(zoom, {hold: 1600, show: zoom, label: 'the suggested zoom', zoom: 2});
  await d.click(main.getByRole('button', {name: 'Play', exact: true}), {hold: 7000, show: preview, label: 'Play', zoom: 1.6});
}
