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
await new Promise(r => setTimeout(r, flow.lead ?? 1200)); // a beat of the starting screen (a flow's `lead`, ms)

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

// The edit: which stretches of the capture make the video, in order. Waits the flow marked as idle
// (d.idle) are cut; the video runs from the first action to the last, like a tutorial. Frames, cursor log and beats all go through the same edit, so they stay in
// step; to Recordly it's one continuous recording.
const startedAt = Math.round(Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=start_time', '-of', 'csv=p=0', raw]).toString().trim()) * 1000);
// (with -copyts the container's "duration" is where it ends on the wall clock, not how long it is)
const rawDur = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', raw]).toString().trim());
const rawEnd = rawDur * 1000 > startedAt ? Math.round(rawDur * 1000) : startedAt + Math.round(rawDur * 1000);
const cuts = d.waits.map(([a, b]) => [Math.max(a, startedAt), Math.min(b, rawEnd)]).filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
const segments = []; // {a, b} wall-clock ms of the capture, in the order they play
let from = startedAt;
for (const [a, b] of cuts) {
  if (a > from) segments.push({a: from, b: a});
  from = Math.max(from, b);
}
if (rawEnd > from) segments.push({a: from, b: rawEnd});
// stretches the flow sped up (d.fast) play at their speed: split the segments at their edges
for (const [fa, fb, speed] of d.fasts) {
  for (let i = segments.length - 1; i >= 0; i--) {
    const sg = segments[i];
    if (fb <= sg.a || fa >= sg.b) continue;
    const parts = [{a: sg.a, b: Math.max(sg.a, fa)}, {a: Math.max(sg.a, fa), b: Math.min(sg.b, fb), speed}, {a: Math.min(sg.b, fb), b: sg.b}].filter(x => x.b - x.a > 1);
    segments.splice(i, 1, ...parts);
  }
}
let pos = 0;
for (const sg of segments) {
  sg.speed ??= 1;
  sg.out = pos; // ms from the start of the video
  pos += (sg.b - sg.a) / sg.speed;
}
/** Every time a capture moment plays in the video (wall-clock ms on the video's clock); none if cut. */
const plays = t => segments.filter(sg => t >= sg.a && (t < sg.b || (t === sg.b && sg === segments.at(-1)))).map(sg => startedAt + sg.out + (t - sg.a) / sg.speed);
/** Where a capture moment plays (or where the cut it fell in ends). */
const playsMain = t => {
  const main = segments;
  const sg = main.find(x => t >= x.a && t <= x.b) ?? main.find(x => x.a > t) ?? main.at(-1);
  return startedAt + sg.out + (Math.min(Math.max(t, sg.a), sg.b) - sg.a) / sg.speed;
};
const s0 = sec => sec.toFixed(3);
// each stretch is its own seeked input, so nothing waits in memory for a stretch that plays later
const inputs = segments.flatMap(sg => ['-ss', s0((sg.a - startedAt) / 1000), '-t', s0((sg.b - sg.a) / 1000), '-i', raw]);
const filter = segments.map((sg, i) => `[${i}:v]setpts=(PTS-STARTPTS)/${sg.speed}[v${i}]`).join(';') + `;${segments.map((_, i) => `[v${i}]`).join('')}concat=n=${segments.length}:v=1:a=0[v]`;
execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...inputs, '-filter_complex', filter, '-map', '[v]', '-r', String(fps), '-c:v', 'libx264', '-preset', 'medium', '-crf', '16', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', join(folder, 'screen.mp4')]);
if (cuts.length) console.log(`cut ${cuts.length} span${cuts.length > 1 ? 's' : ''}: ${(cuts.reduce((s, [a, b]) => s + b - a, 0) / 1000).toFixed(1)} s`);
for (const [a, b, speed] of d.fasts) console.log(`${((b - a) / 1000).toFixed(1)} s played at ${speed}×`);
const durationSec = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', join(folder, 'screen.mp4')]).toString().trim());
rmSync(raw);

const id = `rec-${slug}`;
const lines = d.log.flatMap(l => plays(l.t).map(t => ({...l, t})));
// at the start of each stretch, where the pointer is and its shape, so it doesn't drift in from
// wherever it was at the end of the one before
for (const sg of segments) {
  const at = startedAt + sg.out;
  const lastMove = d.log.filter(l => 'x' in l && !l.click && l.t <= sg.a).at(-1);
  const lastShape = d.log.filter(l => l.cursor && l.t <= sg.a).at(-1);
  if (lastMove) lines.push({...lastMove, t: at});
  if (lastShape) lines.push({...lastShape, t: at});
}
lines.sort((a, b) => a.t - b.t);
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

// The beats, in seconds of the video, for review.mjs. Actions inside a cut aren't in the video, so
// they're left out.
const sec = t => +((t - startedAt) / 1000).toFixed(3);
const inCut = t => cuts.some(([a, b]) => t > a && t < b);
const beats = d.beats.filter(b => !inCut(b.t)).map(b => ({...b, t: sec(playsMain(b.t)), end: sec(playsMain(b.end ?? b.t))}));
// what the flow says about the finished video (its shape, plan, poster, share copy), for render.mjs,
// review.mjs and finish.mjs
writeFileSync(join(out, 'walkthrough.json'), JSON.stringify({name: recName, aspect: flow.aspect ?? 'native', width, height, scale, plan: flow.plan ?? null, poster: flow.poster ?? null, share: flow.share ?? null}, null, 2));
// where the video jumps from one scene to another (an idle cut): no zoom should run across one
const scenes = [...new Set(d.scenes.map(t => sec(playsMain(t))))].sort((a, b) => a - b);
writeFileSync(join(out, 'beats.json'), JSON.stringify({width, height, beats, scenes}, null, 2));
if (flow.plan) writeFileSync(join(out, 'plan.md'), planMarkdown(recName, flow.plan));
const clicks = lines.filter(l => l.click === 'down').length;
console.log(`recorded ${durationSec.toFixed(1)} s at ${pw}×${ph}, ${clicks} clicks → ${library}`);

/** The flow's plan, for people: what the video is for, its shape, and what the review holds it to. */
function planMarkdown(title, p) {
  const list = xs => (xs ?? []).map(x => `- ${x}`).join('\n');
  return [`# ${title}`, '', `**What it is:** ${p.what ?? ''}`, `**For:** ${p.audience ?? ''}`, '', '## The flow', '', list(p.flow), '',
    `## Checks`, '', `- Length: ${p.duration?.[0] ?? '?'}–${p.duration?.[1] ?? '?'} s`, ...(p.milestones ?? []).map(m => `- "${m.beat}" by ${m.by} s`), ''].join('\n');
}
