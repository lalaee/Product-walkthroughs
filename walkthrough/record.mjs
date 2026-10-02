// Records a flow as a Recordly recording: the screen without a cursor (ffmpeg x11grab on a virtual
// display) plus a cursor log of every pointer move and click, so Recordly redraws a smooth cursor
// and suggests zooms exactly as it does for its own native macOS recordings.
//
//   node walkthrough/record.mjs flows/<flow>.mjs [--out out/<flow>] [--size 1920x1080] [--fps 60]
//
// Writes <out>/library: a Recordly recordings folder holding the recording and a project for it.
// Render it with walkthrough/render.mjs.
import {spawn, execFileSync} from 'node:child_process';
import {mkdirSync, rmSync, writeFileSync} from 'node:fs';
import {basename, join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {chromium} from 'playwright-core';
import {Director} from './lib/director.mjs';
import {startDisplay} from './lib/display.mjs';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const flowPath = process.argv[2];
if (!flowPath || flowPath.startsWith('--')) {
  console.error('usage: node walkthrough/record.mjs flows/<flow>.mjs [--out dir] [--size WxH] [--fps n]');
  process.exit(2);
}
const flow = await import(pathToFileURL(resolve(flowPath)).href);
const slug = basename(flowPath).replace(/\.m?js$/, '');
const out = resolve(arg('out', join('out', slug)));
const [width, height] = arg('size', '1920x1080').split('x').map(Number);
const fps = Number(arg('fps', 60));
const chrome = process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const library = join(out, 'library');
const recName = flow.name ?? slug;
const folder = join(library, `Recording ${slug}`);
rmSync(library, {recursive: true, force: true});
mkdirSync(folder, {recursive: true});

// room above the page for the browser's tab strip and address bar, which stay out of the shot
const screen = await startDisplay({width, height: height + 300});
console.log(`display ${screen.display} ${width}×${height}`);

// The app in a browser window at the top-left; only its page area is captured, so page coordinates
// are the recording's coordinates.
const browser = await chromium.launch({
  executablePath: chrome,
  headless: false,
  env: {...process.env, DISPLAY: screen.display},
  args: ['--window-position=0,0', `--window-size=${width},${height + 200}`, '--force-device-scale-factor=1', '--no-first-run', '--disable-infobars', '--hide-crash-restore-bubble']
});
const context = await browser.newContext({viewport: null});
const page = await context.newPage();
// size the window so the page area is exactly width × height, and find where it is on screen
const cdp = await context.newCDPSession(page);
const {windowId} = await cdp.send('Browser.getWindowForTarget');
const measure = () => page.evaluate(() => ({iw: innerWidth, ih: innerHeight, ow: outerWidth, oh: outerHeight, sx: screenX, sy: screenY}));
let m = await measure();
await cdp.send('Browser.setWindowBounds', {windowId, bounds: {left: 0, top: 0, width: width + m.ow - m.iw, height: height + m.oh - m.ih}});
await page.waitForTimeout(500);
m = await measure();
if (m.iw !== width || m.ih !== height) throw new Error(`couldn't size the page to ${width}×${height} (it is ${m.iw}×${m.ih})`);
const area = {x: m.sx + (m.ow - m.iw), y: m.sy + (m.oh - m.ih)};
if (flow.setup) await flow.setup(page);
await page.goto(flow.url, {waitUntil: 'networkidle'});
await page.waitForTimeout(800);

const d = new Director(page);
await d.park(Math.round(width * 0.62), Math.round(height * 0.62));

// Screen capture. x11grab stamps frames with wall-clock time; -copyts keeps it so the first
// frame's time is exactly when the video starts, the anchor for the cursor log.
const raw = join(out, 'raw.mkv');
const ff = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'x11grab', '-draw_mouse', '0', '-framerate', String(fps), '-video_size', `${width}x${height}`, '-i', `${screen.display}+${area.x},${area.y}`, '-copyts', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '10', '-pix_fmt', 'yuv444p', raw], {stdio: ['pipe', 'inherit', 'inherit']});
const ffDone = new Promise(r => ff.on('exit', r));
await new Promise(r => setTimeout(r, 1200)); // a beat of the starting screen

console.log(`recording "${recName}"…`);
const started = Date.now();
let failure = null;
try {
  await flow.run(d, page);
} catch (err) {
  failure = err;
}
await new Promise(r => setTimeout(r, 1000));
ff.stdin.write('q');
await ffDone;
await browser.close();
screen.stop();
if (failure) {
  console.error(`the flow failed after ${((Date.now() - started) / 1000).toFixed(1)} s: ${failure.message}`);
  process.exit(1);
}

// Re-encode to a plain MP4 Recordly's decoder takes; timestamps restart at 0 = startedAt.
const startedAt = Math.round(Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=start_time', '-of', 'csv=p=0', raw]).toString().trim()) * 1000);
execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', raw, '-c:v', 'libx264', '-preset', 'medium', '-crf', '16', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', join(folder, 'screen.mp4')]);
const durationSec = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', join(folder, 'screen.mp4')]).toString().trim());
rmSync(raw);

const id = `rec-${slug}`;
const lines = d.log.filter(l => l.t >= startedAt).sort((a, b) => a.t - b.t);
// the pointer's resting place at the start, so the cursor is there from the first frame
const parked = d.log.find(l => 'x' in l && !('click' in l));
if (parked) lines.unshift({...parked, t: startedAt});
writeFileSync(join(folder, 'cursor.ndjson'), lines.map(l => JSON.stringify(l)).join('\n') + '\n');
writeFileSync(
  join(folder, 'recording.json'),
  JSON.stringify({
    version: 1, id, name: recName, createdAt: new Date(startedAt).toISOString(), status: 'complete', platform: 'linux', backend: 'x11grab',
    source: {kind: 'screen', name: 'Screen', frame: {x: 0, y: 0, width, height}, scaleFactor: 1},
    tracks: {screen: {file: 'screen.mp4', startedAt, width, height, fps, cursorInVideo: false, systemAudio: false}, cursor: {file: 'cursor.ndjson', clicks: true}},
    pauses: [], durationSec, endedAt: startedAt + Math.round(durationSec * 1000)
  }, null, 2)
);
mkdirSync(join(library, 'Projects'));
const now = new Date().toISOString();
writeFileSync(join(library, 'Projects', `${recName}.recordly`), JSON.stringify({format: 'recordly-project', version: 1, id: `p-${slug}`, name: recName, created: now, edited: now, duration: durationSec, folders: [], recordingIds: [id]}));

const clicks = lines.filter(l => l.click === 'down').length;
console.log(`recorded ${durationSec.toFixed(1)} s, ${clicks} clicks → ${library}`);
