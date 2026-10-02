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

export const name = 'Recordly — record your screen';
export const desktop = true;
export const size = '1440x900';
export const aspect = '16:10';

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

  // Recordly, in front and full screen, with an empty library of its own
  const library = join(out, 'recordly-library');
  rmSync(library, {recursive: true, force: true});
  mkdirSync(library, {recursive: true});
  const rec = await launchRecordly({dir: recordly, env, library, settings: {hideRecorder: false}});
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
export async function run(d, {main, overlay, taskly}) {
  const bar = [overlay.getByRole('button', {name: /^Move recorder/}), overlay.getByRole('button', {name: 'More recorder options'})];
  await d.point(main.getByText('Record your first video'), {hold: 900});
  await d.click(main.getByRole('button', {name: 'New recording'}).last(), {hold: 1300, show: bar, label: 'New recording'});
  await d.point(overlay.getByRole('button', {name: /^Countdown/}), {hold: 1100, show: bar, label: 'the recorder bar', zoom: 1.8});
  await d.click(overlay.getByRole('button', {name: 'Record', exact: true}), {hold: 300, show: overlay.getByText('Recording your screen'), label: 'Record'});

  // On Linux the recorder bar would be in the recording: hide it as soon as recording starts
  // (Ctrl+Shift+2 stops it later). Recordly records from here; what it caught of the bar is trimmed
  // off in the editor.
  const hide = overlay.getByRole('button', {name: 'Hide controls'});
  await hide.waitFor({timeout: 15_000});
  const recStart = Date.now();
  await d.click(hide, {hold: 500, label: 'Hide controls'});
  const trimAt = Math.ceil(((Date.now() - recStart) / 1000 + 0.3) * 10) / 10;

  // what's being recorded
  await d.click(taskly.locator('#new-project'), {hold: 900, show: taskly.locator('.dialog')});
  await d.type(taskly.locator('#name'), 'Product launch');
  await d.click(taskly.locator('#create'), {hold: 1500, show: taskly.locator('.card.new')});
  await d.press('Control+Shift+2', {hold: 300, label: 'Stop (Ctrl+Shift+2)'});

  // Recordly opens the editor and analyses the recording: a wait, cut from the video
  const zoom = main.getByRole('button', {name: /Auto \(follows cursor\)|Manual focus/}).first();
  const suggested = await d.idle(() => zoom.waitFor({timeout: 30_000}).then(() => true, () => false));
  if (!suggested) {
    // now and then Recordly doesn't suggest them on its own; then ask, as a person would
    await d.click(main.getByRole('button', {name: 'Suggest zooms'}).first(), {hold: 900, show: zoom, label: 'Suggest zooms'});
    await d.idle(() => zoom.waitFor({timeout: 15_000}));
  }
  await d.wait(800);

  // trim the start: playhead past the bar, split there, delete the first part
  const z0 = await d.s.box(main.getByText('0:00.0', {exact: true}).last());
  const z1 = await d.s.box(main.getByText('0:01.0', {exact: true}).last());
  const ruler = {x: Math.round(z0.x + (z1.x - z0.x) * trimAt + 1), y: Math.round(z0.y + z0.h / 2)};
  await d.click(ruler, {hold: 600, label: `the ruler at ${trimAt} s`});
  await d.click(main.getByRole('button', {name: /^Split clip/}), {hold: 700, label: 'Split clip at playhead'});
  await d.click(main.getByRole('button', {name: /^Clip 1:/}).first(), {hold: 600, label: 'the first part'});
  await d.click(main.getByRole('button', {name: /^Delete selected/}), {hold: 1000, show: main.getByRole('button', {name: /^Clip 1:/}).first(), label: 'Delete selected'});

  await d.point(zoom, {hold: 1600, show: zoom, label: 'the suggested zoom', zoom: 2});
  const preview = main.locator('canvas[aria-label=Preview]');
  await d.click(main.getByRole('button', {name: 'Play', exact: true}), {hold: 7000, show: preview, label: 'Play', zoom: 1.6});
}
