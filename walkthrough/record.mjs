// Records a flow as a Recordly recording: the screen without a cursor (ffmpeg x11grab on a virtual
// display) plus a cursor log of every pointer move and click, so Recordly redraws a smooth cursor
// and suggests zooms exactly as it does for its own native macOS recordings.
//
//   node walkthrough/record.mjs flows/<flow>.mjs [--out out/<flow>] [--size 1920x1080] [--fps 60]
//
// Writes <out>/library: a Recordly recordings folder holding the recording and a project for it.
// Render it with walkthrough/render.mjs.
//
// A desktop flow may export `background`: an image or an HTML page (relative to the flow) for the
// desktop behind its windows, e.g. '../desktops/windows11/desktop.html'.
// A flow may also export `size` ('1440x900'), `scale` (pixel density, 2 for Retina; --scale) and `aspect` (Recordly's video shape for the finished
// video: '1:1', '16:9', '9:16'…; render.mjs picks it).
//
// Two kinds of flow. A page flow exports `url` (and optionally `setup(page)`): the app runs in a
// browser and only its page is captured; `run(d, page)`. A desktop flow exports `desktop = true` and
// `launch({display, env, desktop, out, width, height, recordly})`, which starts its apps on a
// desktop (window manager and all), registers their pages with `desktop.register(page, origin)`
// and returns what `run(d, ctx)` needs plus `close()`; the whole screen is captured and the
// director uses real input.
import {spawn, execFileSync} from 'node:child_process';
import {mkdirSync, rmSync, writeFileSync} from 'node:fs';
import {basename, dirname, join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {chromium} from 'playwright-core';
import {Director} from './lib/director.mjs';
import {startDesktop, startDisplay} from './lib/display.mjs';
import {recordlyDir, recordlyNative} from './lib/recordly.mjs';
import {DesktopSurface, PageSurface} from './lib/surfaces.mjs';

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
// the screen size: --size, else the flow's own `size`, else 1920x1080
const [width, height] = arg('size', flow.size ?? '1920x1080').split('x').map(Number);
const fps = Number(arg('fps', 60));
// Pixel density: the screen is laid out at width × height (points) and drawn at `scale` times that
// many pixels, like a Retina display. 1440x900 at 2.6667 is 3840×2400, 4K at 16:10. Coordinates in
// the logs stay in points; the video has the pixels.
const scale = Number(arg('scale', flow.scale ?? 1));
const pw = Math.round(width * scale / 2) * 2, ph = Math.round(height * scale / 2) * 2;
const chrome = process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const library = join(out, 'library');
const recName = flow.name ?? slug;
const folder = join(library, `Recording ${slug}`);
rmSync(library, {recursive: true, force: true});
mkdirSync(folder, {recursive: true});

let target;
if (flow.desktop) {
  // A whole desktop: the flow launches its apps (flow.launch) and the director uses real input.
  const desk = await startDesktop({width: pw, height: ph, scale, background: flow.background && resolve(dirname(resolve(flowPath)), flow.background)});
  process.env.DISPLAY = desk.display; // for the native module's X connection
  const recordly = recordlyDir(arg('recordly'));
  const surface = new DesktopSurface({display: desk.display, native: recordlyNative(recordly), scale});
  console.log(`desktop ${desk.display} ${width}×${height}${scale !== 1 ? ` at ${scale}× (${pw}×${ph} pixels)` : ''}`);
  let ctx;
  try {
    ctx = await flow.launch({display: desk.display, env: desk.env, desktop: surface, out, width, height, scale, recordly});
  } catch (err) {
    desk.stop();
    throw err;
  }
  target = {surface, ctx, area: {x: 0, y: 0}, display: desk.display, close: async () => {
    await ctx?.close?.();
    desk.stop();
  }};
} else {
  // room above the page for the browser's tab strip and address bar, which stay out of the shot
  const screen = await startDisplay({width: pw, height: ph + Math.round(300 * scale)});
  console.log(`display ${screen.display} ${width}×${height}`);

  // The app in a browser window at the top-left; only its page area is captured, so page
  // coordinates are the recording's coordinates.
  const browser = await chromium.launch({
    executablePath: chrome,
    headless: false,
    env: {...process.env, DISPLAY: screen.display},
    args: ['--window-position=0,0', `--window-size=${width},${height + 200}`, `--force-device-scale-factor=${scale}`, '--no-first-run', '--disable-infobars', '--hide-crash-restore-bubble']
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
  if (flow.setup) await flow.setup(page);
  await page.goto(flow.url, {waitUntil: 'networkidle'});
  await page.waitForTimeout(800);
  target = {surface: new PageSurface(page), ctx: page, area: {x: Math.round((m.sx + (m.ow - m.iw)) * scale), y: Math.round((m.sy + (m.oh - m.ih)) * scale)}, display: screen.display, close: async () => {
    await browser.close();
    screen.stop();
  }};
}
const {area} = target;

const d = new Director(target.surface);
await d.park(Math.round(width * 0.62), Math.round(height * 0.62));

// Screen capture. x11grab stamps frames with wall-clock time; -copyts keeps it so the first
// frame's time is exactly when the video starts, the anchor for the cursor log.
const raw = join(out, 'raw.mkv');
const ff = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'x11grab', '-draw_mouse', '0', '-framerate', String(fps), '-video_size', `${pw}x${ph}`, '-i', `${target.display}+${area.x},${area.y}`, '-copyts', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '10', '-pix_fmt', 'yuv444p', raw], {stdio: ['pipe', 'inherit', 'inherit']});
const ffDone = new Promise(r => ff.on('exit', r));
await new Promise(r => setTimeout(r, 1200)); // a beat of the starting screen

console.log(`recording "${recName}"…`);
const started = Date.now();
let failure = null;
try {
  await flow.run(d, target.ctx);
} catch (err) {
  failure = err;
  // what the screen showed when it failed
  try {
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'x11grab', '-video_size', `${pw}x${ph}`, '-i', `${target.display}+${area.x},${area.y}`, '-frames:v', '1', join(out, 'failure.png')]);
  } catch {}
}
await new Promise(r => setTimeout(r, 1000));
ff.stdin.write('q');
await ffDone;
await target.close();
if (failure) {
  console.error(`the flow failed after ${((Date.now() - started) / 1000).toFixed(1)} s: ${failure.message}\nthe screen then: ${join(out, 'failure.png')}`);
  process.exit(1);
}

// Re-encode to a plain MP4 Recordly's decoder takes; timestamps restart at 0 = startedAt.
const startedAt = Math.round(Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=start_time', '-of', 'csv=p=0', raw]).toString().trim()) * 1000);
// Waits the flow marked as idle (d.idle) are cut: their frames dropped, everything after them moved
// up, and every time in the logs mapped the same way.
const cuts = d.waits.map(([a, b]) => [Math.max(a, startedAt), b]).filter(([a, b]) => b > a);
const cutBefore = t => cuts.reduce((sum, [a, b]) => sum + (t > a ? Math.min(t, b) - a : 0), 0);
const cutTime = t => t - cutBefore(t);
const vf = cuts.length
  ? [`select='not(${cuts.map(([a, b]) => `between(t,${(a - startedAt) / 1000},${(b - startedAt) / 1000})`).join('+')})'`, `setpts='PTS-(${cuts.map(([a, b]) => `gte(T,${(b - startedAt) / 1000})*${(b - a) / 1000}`).join('+')})/TB'`]
  : [];
execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', raw, ...(vf.length ? ['-vf', vf.join(',')] : []), '-c:v', 'libx264', '-preset', 'medium', '-crf', '16', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', join(folder, 'screen.mp4')]);
if (cuts.length) console.log(`cut ${cuts.length} wait${cuts.length > 1 ? 's' : ''}: ${(cuts.reduce((s, [a, b]) => s + b - a, 0) / 1000).toFixed(1)} s`);
const captured = Number(execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', join(folder, 'screen.mp4')]).toString().trim());
const durationSec = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', join(folder, 'screen.mp4')]).toString().trim());
rmSync(raw);

const id = `rec-${slug}`;
const lines = d.log.filter(l => l.t >= startedAt).map(l => ({...l, t: cutTime(l.t)})).sort((a, b) => a.t - b.t);
// the pointer's resting place at the start, so the cursor is there from the first frame
const parked = d.log.find(l => 'x' in l && !('click' in l));
if (parked) lines.unshift({...parked, t: startedAt});
// and its shape then
const shapeBefore = d.log.filter(l => l.cursor && l.t < startedAt).at(-1);
if (shapeBefore) lines.splice(1, 0, {...shapeBefore, t: startedAt});
writeFileSync(join(folder, 'cursor.ndjson'), lines.map(l => JSON.stringify(l)).join('\n') + '\n');
writeFileSync(
  join(folder, 'recording.json'),
  JSON.stringify({
    version: 1, id, name: recName, createdAt: new Date(startedAt).toISOString(), status: 'complete', platform: 'linux', backend: 'x11grab',
    source: {kind: 'screen', name: 'Screen', frame: {x: 0, y: 0, width, height}, scaleFactor: scale},
    tracks: {screen: {file: 'screen.mp4', startedAt, width: pw, height: ph, fps, cursorInVideo: false, systemAudio: false}, cursor: {file: 'cursor.ndjson', clicks: true}},
    pauses: [], durationSec, endedAt: startedAt + Math.round(durationSec * 1000)
  }, null, 2)
);
mkdirSync(join(library, 'Projects'));
const now = new Date().toISOString();
writeFileSync(join(library, 'Projects', `${recName}.recordly`), JSON.stringify({format: 'recordly-project', version: 1, id: `p-${slug}`, name: recName, created: now, edited: now, duration: durationSec, folders: [], recordingIds: [id]}));

// the beats, in seconds from the start of the video, for review.mjs
const sec = t => +((cutTime(t) - startedAt) / 1000).toFixed(3);
// what the flow says about the finished video (its shape), for render.mjs
writeFileSync(join(out, 'walkthrough.json'), JSON.stringify({name: recName, aspect: flow.aspect ?? 'native', width, height, scale}, null, 2));
writeFileSync(join(out, 'beats.json'), JSON.stringify({width, height, beats: d.beats.map(b => ({...b, t: sec(b.t), end: sec(b.end ?? b.t)}))}, null, 2));
const clicks = lines.filter(l => l.click === 'down').length;
console.log(`recorded ${durationSec.toFixed(1)} s at ${pw}×${ph}, ${clicks} clicks → ${library}`);
