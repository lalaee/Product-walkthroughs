// Checks a rendered walkthrough beat by beat: does each zoom still show what the action needs?
//
//   node walkthrough/review.mjs out/<flow> [--fix] [--recordly ../recorder-2]
//
// For every action the flow took (beats.json, written by record.mjs) it works out what the viewer
// has to see: the thing clicked or typed into, plus its result (the `show` boxes the flow gave, or
// else whatever changed on screen, from the raw recording). It then works out what part of the
// screen Recordly's camera shows, every 50 ms, from the zooms Recordly saved in the project and
// Recordly's own camera code, and flags every beat where the needed area doesn't fit.
//
// Writes <out>/review/: sheet.png (a contact sheet: per beat, the raw frame with the needed area
// and the camera's view drawn on it, then the finished video at the action, midway and after) and
// report.md. Exits 1 if a beat fails.
//
// --fix rewrites the failing zooms in the project: a manual zoom centred on everything its beats
// need, at the most it can zoom and still show it all (or no zoom when that's under 1.3×),
// re-checked against the camera until every beat passes. Then render again and review again.
import {execFileSync} from 'node:child_process';
import {mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {basename, join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {chromium} from 'playwright-core';
import {recordlyDir} from './lib/recordly.mjs';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const out = resolve(process.argv[2] ?? '');
const fix = process.argv.includes('--fix');
const library = join(out, 'library');
const recDir = join(library, readdirSync(library).find(f => f.startsWith('Recording ')));
const projectFile = join(library, 'Projects', readdirSync(join(library, 'Projects')).find(f => f.endsWith('.recordly')));
const video = join(out, `${basename(out)}.mp4`);
const {width: W, height: H, beats} = JSON.parse(readFileSync(join(out, 'beats.json'), 'utf8'));
const rec = JSON.parse(readFileSync(join(recDir, 'recording.json'), 'utf8'));
const project = JSON.parse(readFileSync(projectFile, 'utf8'));
if (!project.doc) throw new Error('the project has no saved edit yet: render it first (render.mjs)');
const doc = project.doc;
const preset = doc.motion?.preset ?? 'focused';
const MARGIN = 1.1; // room around the needed area, so it isn't flush with the edge of the view
const MIN_ZOOM = 1.3; // below this a zoom isn't worth its motion

// ---------------------------------------------------------------- camera
// Recordly's own camera and cursor code (bundled from Recorder-2's source), so the view computed
// here is the one its exporter draws: zoom ramps, glides between connected zooms, the cursor follow.
const recordly = recordlyDir(arg('recordly'));
const src = join(recordly, 'apps', 'desktop', 'src');
const {build} = await import(pathToFileURL(join(recordly, 'node_modules', 'esbuild', 'lib', 'main.js')).href);
const stub = {name: 'stub', setup(b) {
  // the editor model's UI imports, which the camera code doesn't use
  b.onResolve({filter: /^react$|\/lib\/art$/}, a => ({path: a.path, namespace: 'stub'}));
  b.onLoad({filter: /.*/, namespace: 'stub'}, () => ({contents: 'export const useCallback=()=>{},useRef=()=>{},useState=()=>{},bgTypeFor=()=>{},DEFAULT_WALLPAPER="";'}));
}};
const bundled = await build({
  stdin: {contents: "export {cameraAt} from './render/motion'; export {buildTrack, cursorAverage} from './render/cursor';", resolveDir: src, loader: 'ts'},
  bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'error', plugins: [stub]
});
const camFile = join(tmpdir(), `recordly-camera-${process.pid}.mjs`);
writeFileSync(camFile, bundled.outputFiles[0].text);
const {cameraAt, buildTrack, cursorAverage} = await import(pathToFileURL(camFile).href);
rmSync(camFile);

const cursorLines = readFileSync(join(recDir, 'cursor.ndjson'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
const track = buildTrack(cursorLines, {screenStartedAt: rec.tracks.screen.startedAt, micStartedAt: null, cameraStartedAt: null, sourceFrame: rec.source.frame, pauses: rec.pauses ?? []});
const crop = doc.scene?.crop ?? {l: 0, t: 0, r: 0, b: 0};
const cropW = 1 - (crop.l + crop.r) / 100, cropH = 1 - (crop.t + crop.b) / 100;
/** The compositor's focusOf (render/compositor.ts), for a single clip that starts at 0. */
const focusOf = (z, at) => {
  if (z.mode === 'manual') {
    if (z.amount <= 1) return z.focus;
    const half = 50 / z.amount, w = 100 / z.amount;
    const c = v => Math.max(half, Math.min(100 - half, v));
    return {x: ((c(z.focus.x) - w / 2) / (100 - w)) * 100, y: ((c(z.focus.y) - w / 2) / (100 - w)) * 100};
  }
  const c = cursorAverage(track, at, (doc.motion?.preset ?? 'focused') === 'focused' ? 0.5 : 0.9);
  return {x: Math.max(0, Math.min(100, ((c.x - crop.l / 100) / cropW) * 100)), y: Math.max(0, Math.min(100, ((c.y - crop.t / 100) / cropH) * 100))};
};
/** What part of the recording the camera shows at time s: it scales about the focus point. */
function viewAt(s, d = doc) {
  const cam = cameraAt(d, s, focusOf);
  const k = cam.scale, fx = (cam.focus.x / 100) * W, fy = (cam.focus.y / 100) * H;
  return {x: fx * (1 - 1 / k), y: fy * (1 - 1 / k), w: W / k, h: H / k, amount: +k.toFixed(2)};
}
/** The zooms shaping the camera at s: the one it's in, or both sides of a glide. */
const zoomsAt = (s, d = doc) => {
  const zs = [...d.zooms].sort((a, b) => a.start - b.start);
  const i = zs.findIndex(z => s >= z.start && s < z.end);
  if (i >= 0) return [zs[i]];
  const j = zs.findIndex((z, n) => zs[n + 1] && s >= z.end && s < zs[n + 1].start);
  return j >= 0 && viewAt(s, d).amount > 1 ? [zs[j], zs[j + 1]] : [];
};
const union = boxes => {
  const bs = boxes.filter(Boolean);
  if (!bs.length) return null;
  const x = Math.min(...bs.map(b => b.x)), y = Math.min(...bs.map(b => b.y));
  return {x, y, w: Math.max(...bs.map(b => b.x + b.w)) - x, h: Math.max(...bs.map(b => b.y + b.h)) - y};
};
/** How much of box b the view v shows (0..1). */
const shown = (b, v) => (Math.max(0, Math.min(b.x + b.w, v.x + v.w) - Math.max(b.x, v.x)) * Math.max(0, Math.min(b.y + b.h, v.y + v.h) - Math.max(b.y, v.y))) / Math.max(1, b.w * b.h);
// the target may be a little clipped while the camera arrives; the result has to be all there
const inside = (b, v, enough = 0.98) => shown(b, v) >= enough;
const capFor = b => Math.min(W / (b.w * MARGIN), H / (b.h * MARGIN));
const span = (a, b) => Array.from({length: Math.max(1, Math.round((b - a) / 0.05)) + 1}, (_, k) => a + k * 0.05).filter(s => s <= b + 1e-9);

// ---------------------------------------------------------------- what changed on screen
const SW = 480, SH = 270;
const raw = join(recDir, 'screen.mp4');
const grab = s => execFileSync('ffmpeg', ['-v', 'error', '-ss', String(Math.max(0, s)), '-i', raw, '-frames:v', '1', '-vf', `scale=${SW}:${SH},format=gray`, '-f', 'rawvideo', '-']);
function changed(a, b) {
  const fa = grab(a), fb = grab(b);
  let x0 = SW, y0 = SH, x1 = -1, y1 = -1, n = 0;
  for (let y = 0; y < SH; y++)
    for (let x = 0; x < SW; x++)
      if (Math.abs(fa[y * SW + x] - fb[y * SW + x]) > 28) {
        n++;
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
  if (n < 15) return null;
  const k = W / SW;
  return {x: Math.round(x0 * k), y: Math.round(y0 * k), w: Math.round((x1 - x0 + 1) * k), h: Math.round((y1 - y0 + 1) * k)};
}

// ---------------------------------------------------------------- check every beat
// Sampled every 50 ms: around the action (from just before to just after it) the target must be
// in view; over the second half of the beat, once the action has played out, the target and its
// result must be.
const needs = beats.map(b => {
  const result = b.show?.length ? union(b.show) : changed(b.t - 0.15, b.end - 0.05);
  return {result, need: union([b.target, result])};
});
function check(d) {
  return beats.map((b, i) => {
    const {result, need} = needs[i];
    const problems = [], zooms = new Set();
    // the flow itself: an action that should show something, or change something, and didn't
    if (b.showMissing) problems.push(`flow: ${b.showMissing} wasn't on screen after the ${b.action}`);
    else if (!result && (b.action === 'click' || b.action === 'type' || b.action === 'press')) problems.push(`flow: nothing visible changed after the ${b.action}`);
    const fail = (s, what) => {
      const v = viewAt(s, d);
      zoomsAt(s, d).forEach(z => zooms.add(z));
      return {s, v, what};
    };
    const early = b.target ? span(b.t - 0.1, b.t + 0.3).map(s => !inside(b.target, viewAt(s, d), 0.85) && fail(s, 'target')).filter(Boolean) : [];
    const late = need ? span((b.t + b.end) / 2, b.end).map(s => !inside(need, viewAt(s, d)) && fail(s, 'need')).filter(Boolean) : [];
    const zoomed = b.zoom && d.zooms.some(z => z.start < b.end && z.end > (b.t + b.end) / 2);
    if (b.zoom && !zoomed) problems.push(`the flow wants a ${b.zoom}× zoom here, and there's none`);
    if (early.length) problems.push(`the ${b.action} target is out of view around the action (${early[0].s.toFixed(1)} s, ${early[0].v.amount}×)`);
    if (late.length) {
      const f = late.reduce((a, c) => (c.v.amount > a.v.amount ? c : a));
      problems.push(need.w * MARGIN > f.v.w || need.h * MARGIN > f.v.h ? `zoomed too far at ${f.s.toFixed(1)} s: ${f.v.amount}× shows ${Math.round(f.v.w)}×${Math.round(f.v.h)}, the action needs ${need.w}×${need.h} (at most ${capFor(need).toFixed(1)}×)` : `the view at ${f.s.toFixed(1)} s (${f.v.amount}×) misses part of what the action needs`);
    }
    return {i, beat: b, result, need, view: viewAt(b.end - 0.05, d), viewAtAction: viewAt(b.t, d), zooms: [...zooms], problems};
  });
}
let results = check(doc);

// ---------------------------------------------------------------- motion
// How hard the camera moves: zoom speed in "doublings per second" (log scale, so 1×→2× and 2×→4×
// count the same) and pan speed in screen widths per second, both seen at the zoomed-in scale.
function motionOf(d) {
  const dt = 1 / 60, end = Math.max(...beats.map(b => b.end)) + 1;
  let zoom = {v: 0, s: 0}, pan = {v: 0, s: 0}, prev = viewAt(0, d);
  for (let s = dt; s < end; s += dt) {
    const v = viewAt(s, d);
    const z = Math.abs(Math.log2(v.amount) - Math.log2(prev.amount)) / dt;
    const p = Math.hypot(v.x + v.w / 2 - (prev.x + prev.w / 2), v.y + v.h / 2 - (prev.y + prev.h / 2)) / v.w / dt;
    if (z > zoom.v) zoom = {v: z, s};
    if (p > pan.v && Math.abs(v.amount - prev.amount) < 1e-6) pan = {v: p, s};
    prev = v;
  }
  return {zoom, pan};
}
const MAX_ZOOM_SPEED = 3.2; // smooth zooms to 2× peak right at 3 // doublings per second
const MAX_PAN_SPEED = 1.2; // view widths per second

// ---------------------------------------------------------------- contact sheet
const dir = join(out, 'review');
rmSync(dir, {recursive: true, force: true});
mkdirSync(dir);
const still = (file, s, name) => {
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', String(Math.max(0, s)), '-i', file, '-frames:v', '1', '-vf', 'scale=480:-2', '-q:v', '3', join(dir, name)]);
  return name;
};
const pct = (v, total) => `${((v / total) * 100).toFixed(2)}%`;
const rect = (b, cls) => (b ? `<div class="${cls}" style="left:${pct(b.x, W)};top:${pct(b.y, H)};width:${pct(b.w, W)};height:${pct(b.h, H)}"></div>` : '');
const rows = results.map(r => {
  const {beat: b, i} = r;
  const n = String(i + 1).padStart(2, '0');
  const rawShot = still(raw, b.end - 0.05, `${n}-raw.jpg`);
  const shots = [b.t, (b.t + b.end) / 2, b.end - 0.05].map((s, k) => still(video, s, `${n}-${k}.jpg`));
  return `<section class="${r.problems.length ? 'bad' : 'ok'}">
    <h2>${n} · ${b.action} · ${b.label.replace(/</g, '&lt;')} <small>${b.t.toFixed(1)}–${b.end.toFixed(1)} s · ${r.view.amount}× after</small></h2>
    ${r.problems.map(p => `<p>✗ ${p}</p>`).join('') || '<p class="pass">✓ in view</p>'}
    <div class="row">
      <figure><div class="frame"><img src="${rawShot}">${rect(r.need, 'need')}${rect(r.viewAtAction, 'view at')}${rect(r.view, 'view')}</div><figcaption>raw · green: needed · blue: camera (dashed at the action)</figcaption></figure>
      ${shots.map((s, k) => `<figure><img src="${s}"><figcaption>video · ${['action', 'midway', 'after'][k]}</figcaption></figure>`).join('')}
    </div></section>`;
});
writeFileSync(
  join(dir, 'sheet.html'),
  `<!doctype html><meta charset="utf-8"><style>
  body{margin:0;padding:24px;background:#16171a;color:#e8e8ea;font:14px system-ui,sans-serif;width:2000px}
  h1{font-size:22px;margin:0 0 16px} h2{font-size:16px;margin:0 0 4px} small{color:#9a9ba1;font-weight:400}
  section{padding:14px;margin-bottom:14px;border-radius:10px;background:#202125;border-left:6px solid #3ecf8e}
  section.bad{border-left-color:#ff5c5c} p{margin:2px 0 8px;color:#ff8f8f} p.pass{color:#3ecf8e}
  .row{display:flex;gap:12px} figure{margin:0} figure img{width:480px;display:block;border-radius:4px}
  figcaption{color:#9a9ba1;font-size:12px;margin-top:4px} .frame{position:relative}
  .need,.view{position:absolute;box-sizing:border-box} .need{border:3px solid #3ecf8e;background:#3ecf8e22}
  .view{border:3px solid #4f8cff} .view.at{border-style:dashed}
  </style><h1>${project.name} — ${results.filter(r => r.problems.length).length} of ${results.length} beats need attention</h1>${rows.join('')}`
);
const browser = await chromium.launch({executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
const page = await browser.newPage({viewport: {width: 2048, height: 800}});
await page.goto(`file://${join(dir, 'sheet.html')}`);
await page.screenshot({path: join(dir, 'sheet.png'), fullPage: true});
await browser.close();

// ---------------------------------------------------------------- report and fix
const failing = results.filter(r => r.problems.length);
const m = motionOf(doc);
const harsh = [];
if (m.zoom.v > MAX_ZOOM_SPEED) harsh.push(`camera zooms too sharply at ${m.zoom.s.toFixed(1)} s (${m.zoom.v.toFixed(1)} doublings/s, at most ${MAX_ZOOM_SPEED}); try --motion smooth`);
if (m.pan.v > MAX_PAN_SPEED) harsh.push(`camera pans too fast at ${m.pan.s.toFixed(1)} s (${m.pan.v.toFixed(1)} view widths/s, at most ${MAX_PAN_SPEED})`);
const lines = [`# Review: ${project.name}`, '', `${results.length} beats, ${doc.zooms.length} zooms (${doc.motion?.preset} motion), ${failing.length} beats need attention.`, `Motion: peak zoom speed ${m.zoom.v.toFixed(1)} doublings/s at ${m.zoom.s.toFixed(1)} s, peak pan ${m.pan.v.toFixed(1)} view widths/s at ${m.pan.s.toFixed(1)} s.${harsh.map(h => `\n- ✗ ${h}`).join('')}`, ''];
for (const r of results) lines.push(`- ${r.problems.length ? '✗' : '✓'} ${String(r.i + 1).padStart(2, '0')} ${r.beat.action} ${r.beat.label} (${r.beat.t.toFixed(1)} s)${r.problems.map(p => `\n  - ${p}`).join('')}`);

if (fix && failing.length) {
  // Recordly's camera is pure, so fixes are checked here before rendering: repeat until clean.
  lines.push('', '## Fixes');
  // zooms the flow asked for where there's none: manual, on the action's target and result, from a
  // moment before it until a moment after, kept clear of the zooms around it
  const tooBig = new Set();
  const addWanted = () => {
    for (const [i, b] of beats.entries()) {
      if (!b.zoom || tooBig.has(i) || doc.zooms.some(z => z.start < b.end && z.end > (b.t + b.end) / 2) || !needs[i].need) continue;
      const need = needs[i].need;
      const before = Math.max(0, ...doc.zooms.filter(z => z.end <= b.t).map(z => z.end + 0.2));
      // until the next zoom, or the next action that wants its own
      // A second between neighbouring zooms, so Recordly's glide from one to the other takes that
      // second instead of snapping: this one ends a second before the next zoom (or the next action
      // that wants its own), and a zoom running into this beat ends a second before this one starts.
      const GLIDE = 1.0;
      const after = Math.min(Infinity, ...doc.zooms.filter(z => z.start >= (b.t + b.end) / 2).map(z => z.start - GLIDE), ...beats.filter(n => n.zoom && n.t > b.t).map(n => n.t - 0.2 - GLIDE));
      const before0 = before;
      for (const z of doc.zooms) if (z.end > b.t - 0.2 - GLIDE && z.start < b.t) z.end = Math.max(z.start + 0.6, Math.min(z.end, b.t - 0.2 - GLIDE));
      const amount = Math.min(b.zoom, Math.floor(capFor(need) * 10) / 10);
      if (amount < MIN_ZOOM) {
        tooBig.add(i);
        lines.push(`- ${b.t.toFixed(1)} s ${b.label}: wanted a ${b.zoom}× zoom, but what it needs (${need.w}×${need.h}) only fits at ${amount}×; left unzoomed`);
        continue;
      }
      const z = {id: `zm-flow-${i}`, start: +Math.max(before0, b.t - 0.8, ...doc.zooms.filter(z => z.start < b.t).map(z => z.end + GLIDE)).toFixed(2), end: +Math.min(after, b.end + 0.9).toFixed(2), amount, mode: 'manual', focus: {x: +(((need.x + need.w / 2) / W) * 100).toFixed(2), y: +(((need.y + need.h / 2) / H) * 100).toFixed(2)}};
      doc.zooms.push(z);
      doc.zooms.sort((a, c) => a.start - c.start);
      lines.push(`- ${z.start.toFixed(1)}–${z.end.toFixed(1)} s: added a ${amount}× zoom on ${b.label}, as the flow asked`);
    }
  };
  // Repeat until nothing changes: removing a zoom that can't fit can leave a wanted zoom to add.
  for (let round = 0; round < 8; round++) {
    addWanted();
    const bad = new Set(check(doc).flatMap(r => (r.problems.length ? r.zooms : [])));
    if (!bad.size) break;
    for (const z of bad) {
      const covered = beats.map((b, i) => (b.end > z.start && b.t < z.end ? needs[i].need : null));
      const need = union(covered);
      const before = `${z.amount}× ${z.mode}`;
      const cap = need ? Math.floor(capFor(need) * 10) / 10 : z.amount;
      if (cap < MIN_ZOOM || round >= 6) {
        doc.zooms = doc.zooms.filter(x => x !== z);
        lines.push(`- ${z.start.toFixed(1)}–${z.end.toFixed(1)} s: ${before} → removed${need ? ` (what it covers spans ${need.w}×${need.h}, too much to zoom)` : ''}`);
        continue;
      }
      z.amount = Math.min(z.amount, cap);
      z.mode = 'manual';
      z.focus = {x: +(((need.x + need.w / 2) / W) * 100).toFixed(2), y: +(((need.y + need.h / 2) / H) * 100).toFixed(2)};
      lines.push(`- ${z.start.toFixed(1)}–${z.end.toFixed(1)} s: ${before} → ${z.amount}× manual, centred on the ${need.w}×${need.h} area its beats need`);
    }
  }
  const mf = motionOf(doc);
  if (mf.zoom.v > MAX_ZOOM_SPEED) lines.push(`- the camera still zooms too sharply at ${mf.zoom.s.toFixed(1)} s (${mf.zoom.v.toFixed(1)} doublings/s): space those zooms out in the flow`);
  const left = check(doc).filter(r => r.problems.length).length + (mf.zoom.v > MAX_ZOOM_SPEED ? 1 : 0);
  project.edited = new Date().toISOString();
  writeFileSync(projectFile, JSON.stringify(project));
  lines.push('', left ? `${left} beats still fail on paper; change the flow (pacing, \`show\`).` : 'All beats pass on paper. Render again (render.mjs), then review again to check the frames.');
}
writeFileSync(join(dir, 'report.md'), lines.join('\n') + '\n');
console.log(lines.join('\n'));
console.log(`\ncontact sheet: ${join(dir, 'sheet.png')}`);
process.exitCode = (failing.length && !fix) || harsh.length ? 1 : 0;
