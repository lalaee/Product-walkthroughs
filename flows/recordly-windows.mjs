// How to record on Windows with Recordly, as a tutorial from start to finish: from Recordly's home,
// open the recorder, choose what to record (the whole screen), record a short Taskly session, stop
// with the shortcut, check the zoom Recordly suggested, play it back and export the video.
//
// The desktop is the Windows 11 UI Kit's (desktops/windows11). Runs Recordly (Recorder-2) for real,
// with real input (a desktop flow, see walkthrough/record.mjs), its interface as it is on Windows
// (launchRecordly's `platform`): this machine runs Linux underneath.
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {chromium} from 'playwright-core';
import {launchRecordly} from '../walkthrough/lib/recordly.mjs';
import {finishInEditor, recordTaskly} from './recordly-steps.mjs';

export const name = 'Recordly — how to record on Windows';
export const desktop = true;
export const size = '1920x1080';
export const aspect = '16:9';
export const background = '../desktops/windows11/desktop.html';

// The plan: what this video is for, and what the review holds it to.
export const plan = {
  what: 'Recordly records your screen and turns it into a polished video, zooming in where you clicked.',
  audience: 'People who make product demos and walkthroughs on Windows.',
  flow: ['Recordly is open; Taskly is the app to record', 'New recording: the recorder bar', 'Choose what to record: the entire screen', 'Record: 3, 2, 1', 'Create a project in Taskly while it records', 'Stop with Ctrl+Shift+2', 'Recordly has already suggested a zoom from the clicks', 'Play it back', 'Export: the MP4 is ready'],
  duration: [30, 50],
  milestones: [{beat: 'Record', by: 12}, {beat: 'Stop (Ctrl+Shift+2)', by: 26}, {beat: 'Export', by: 40}]
};
export const lead = 400;
// the poster: the finished video, exported
export const poster = 'Save';
export const share = 'Recording on Windows with Recordly: New recording, pick your screen, hit Record, use your app, press Ctrl+Shift+2. It comes back already zoomed in on every click; export and you are done.';

const taskly = pathToFileURL(new URL('../demo-app/index.html', import.meta.url).pathname).href;
const TASKBAR = 48;

export async function launch({env, desktop, out, width, height, recordly}) {
  // Taskly in an app window, where the design's window sits (its rectangle at 11% / 11%, 78% wide)
  const win = {x: Math.round(width * 0.11), y: Math.round(height * 0.09), w: Math.round(width * 0.78), h: Math.round((height - TASKBAR) * 0.76)};
  const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'taskly-')), {
    executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    headless: false,
    viewport: null,
    // (--test-type and no Google keys: no warning bars across the window)
    args: [`--app=${taskly}`, `--window-position=${win.x},${win.y}`, `--window-size=${win.w},${win.h}`, '--test-type', '--no-first-run', '--disable-infobars', '--hide-crash-restore-bubble', '--force-device-scale-factor=1'],
    env: {...env, GOOGLE_API_KEY: 'no', GOOGLE_DEFAULT_CLIENT_ID: 'no', GOOGLE_DEFAULT_CLIENT_SECRET: 'no'}
  });
  const page = context.pages()[0] ?? (await context.waitForEvent('page'));
  await page.waitForLoadState();
  await page.evaluate(windowsTitleBar, 'Taskly');
  desktop.register(page, async () => page.evaluate(() => ({x: screenX + (outerWidth - innerWidth) / 2, y: screenY + outerHeight - innerHeight})));

  // Recordly, with an empty library of its own. Its window opens later, above the taskbar.
  const library = join(out, 'recordly-library');
  rmSync(library, {recursive: true, force: true});
  mkdirSync(library, {recursive: true});
  const downloads = join(out, 'recordly-exports');
  rmSync(downloads, {recursive: true, force: true});
  mkdirSync(downloads, {recursive: true});
  const rec = await launchRecordly({dir: recordly, env, library, downloads, platform: 'win', settings: {hideRecorder: false}});
  const main = await rec.window('main');
  desktop.register(main, rec.origin(main));
  await (await rec.app.browserWindow(main)).evaluate((w, b) => w.setBounds(b), {x: 0, y: 0, width, height: height - TASKBAR});
  const overlay = await rec.window('overlay');
  desktop.register(overlay, rec.origin(overlay));
  await main.getByRole('button', {name: 'New recording'}).last().waitFor();
  await main.waitForTimeout(1500);

  return {
    main, overlay, taskly: page,
    close: async () => {
      writeFileSync(join(out, 'recordly.log'), rec.log.join(''));
      await rec.close();
      await context.close();
    }
  };
}

/**
 * A Windows 11 title bar across the top of the page (the window has no decorations of its own): the
 * app's icon and name, and the minimise, maximise and close buttons, in the light Mica style.
 */
function windowsTitleBar(title) {
  const bar = document.createElement('div');
  bar.setAttribute('aria-hidden', 'true');
  bar.style.cssText = 'position:sticky;top:0;z-index:1000;height:32px;display:flex;align-items:center;background:#f3f3f3;border-bottom:1px solid #e5e5e5;font:12px "Segoe UI Variable","Segoe UI",Inter,"Noto Sans",system-ui,sans-serif;color:#1a1a1a;user-select:none';
  const glyph = d => `<span style="width:46px;height:32px;display:grid;place-items:center"><svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="#1a1a1a" stroke-width="1">${d}</svg></span>`;
  bar.innerHTML = `<span style="width:16px;height:16px;border-radius:4px;margin:0 10px 0 12px;background:linear-gradient(135deg,#5b5bf7,#9b5bf7)"></span><span style="flex:1">${title}</span>`
    + glyph('<path d="M0 5.5h10"/>') + glyph('<rect x=".5" y=".5" width="9" height="9" rx="1.5"/>') + glyph('<path d="M.5.5l9 9M9.5.5l-9 9"/>');
  document.body.prepend(bar);
  // the window's 1 px outline
  const frame = document.createElement('div');
  frame.style.cssText = 'position:fixed;inset:0;border:1px solid #c8c8cc;pointer-events:none;z-index:1001';
  document.body.append(frame);
}

/** @param {import('../walkthrough/lib/director.mjs').Director} d */
export async function run(d, ctx) {
  const {main, overlay} = ctx;
  // 1. the recorder: Recordly's window steps aside and its bar comes up
  const bar = overlay.locator('[aria-label="Recorder"]');
  await d.click(main.getByRole('button', {name: 'New recording'}).last(), {hold: 1000, show: bar, label: 'New recording'});
  // 2. what to record: the entire screen
  const picker = overlay.getByRole('dialog');
  await d.click(overlay.getByRole('button', {name: 'Choose what to record'}), {hold: 1500, show: picker, label: 'Choose what to record'});
  await d.click(picker.getByText('Entire screen'), {hold: 1000, show: bar, label: 'Entire screen'});
  // 3. record Taskly, stop
  const trimAt = await recordTaskly(d, ctx);
  // 4. in the editor: the suggested zoom, playback
  await finishInEditor(d, ctx, trimAt);
  // 5. export
  const dialog = main.getByRole('dialog');
  await d.click(main.getByRole('button', {name: 'Export', exact: true}).first(), {hold: 1200, show: dialog, label: 'Export'});
  await d.click(dialog.getByRole('button', {name: /^Export MP4$/}), {hold: 300, label: 'Export MP4'});
  // (the export takes a while on this machine: a moment of its progress, then it's done)
  await d.idle(() => dialog.getByRole('button', {name: 'Save'}).waitFor({timeout: 10 * 60_000}), {keep: 800});
  await d.click(dialog.getByRole('button', {name: 'Save'}), {hold: 2200, show: dialog.getByText('Your video is ready'), label: 'Save', zoom: 1.6});
}
