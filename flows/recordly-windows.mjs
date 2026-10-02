// Recordly on a Windows 11 desktop, starting from its recorder bar: Taskly is already open in a
// window, the bar is up. Record a short Taskly session, stop with the shortcut, and finish it in the
// editor (trim the start, point out the suggested zoom, play it back).
//
// The desktop is the Windows 11 UI Kit's (desktops/windows11). Runs Recordly (Recorder-2) for real,
// with real input (a desktop flow, see walkthrough/record.mjs).
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {chromium} from 'playwright-core';
import {launchRecordly} from '../walkthrough/lib/recordly.mjs';
import {finishInEditor, recordTaskly} from './recordly-steps.mjs';

export const name = 'Recordly — record on Windows';
export const desktop = true;
export const size = '1920x1080';
export const aspect = '16:9';
export const background = '../desktops/windows11/desktop.html';

// The plan: what this video is for, and what the review holds it to.
export const plan = {
  what: 'Recordly records your screen and turns it into a polished video, zooming in where you clicked.',
  audience: 'People who make product demos and walkthroughs on Windows.',
  hook: 'Open on the payoff: the finished recording already playing back in Recordly, zoomed in on the click.',
  flow: ['The recorder bar is up over Taskly, open on the desktop', 'Record: 3, 2, 1', 'Create a project in Taskly while it records', 'Stop with Ctrl+Shift+2', 'Recordly has already suggested a zoom from the clicks', 'Play it back'],
  duration: [15, 25],
  milestones: [{beat: 'Record', by: 7}, {beat: 'Stop (Ctrl+Shift+2)', by: 18}, {beat: 'Play', by: 23}]
};
// open on 2.2 s of the playback (marked by finishInEditor)
export const hook = {mark: 'payoff', seconds: 2.2};
// after the hook, straight in
export const lead = 400;
// the poster: the playback, zoomed in
export const poster = 'Play';
export const share = 'Hit Record, use your app, press Ctrl+Shift+2. Recordly hands it back already zoomed in on every click.';

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
  const rec = await launchRecordly({dir: recordly, env, library, settings: {hideRecorder: false}});
  const main = await rec.window('main');
  desktop.register(main, rec.origin(main));
  await (await rec.app.browserWindow(main)).evaluate((w, b) => w.setBounds(b), {x: 0, y: 0, width, height: height - TASKBAR});
  const overlay = await rec.window('overlay');
  desktop.register(overlay, rec.origin(overlay));
  // before recording starts: open the recorder bar (the main window steps aside)
  await main.getByRole('button', {name: 'New recording'}).last().click();
  await overlay.getByRole('button', {name: 'Record', exact: true}).waitFor();
  await page.bringToFront();
  await page.waitForTimeout(1500);

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
  const {overlay, taskly} = ctx;
  const bar = [overlay.getByRole('button', {name: /^Move recorder/}), overlay.getByRole('button', {name: 'More recorder options'})];
  await d.point(overlay.getByRole('button', {name: /^Countdown/}), {hold: 1000, show: bar, label: 'the recorder bar', zoom: 1.8});
  const trimAt = await recordTaskly(d, ctx);
  await finishInEditor(d, ctx, trimAt);
}
