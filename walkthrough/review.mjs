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
// --fix reframes every zoom as a manual zoom centred on everything its beats need, no tighter
// than shows it all and at most 2× (removed when that's under 1.3×), adds the zooms the flow asked
// for (`zoom`) where there's none, and re-checks against the camera until every beat passes. Then
// render again and review again.
import {captionWalkthrough} from './lib/captions.mjs';
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
const {width: W, height: H, beats, scenes = []} = JSON.parse(readFileSync(join(out, 'beats.json'), 'utf8'));
const rec = JSON.parse(readFileSync(join(recDir, 'recording.json'), 'utf8'));
const project = JSON.parse(readFileSync(projectFile, 'utf8'));
if (!project.doc) throw new Error('the project has no saved edit yet: render it first (render.mjs)');
const doc = project.doc;
const preset = doc.motion?.preset ?? 'focused';
const MARGIN = 1.1; // room around the needed area, so it isn't flush with the edge of the view
const MIN_ZOOM = 1.3; // below this a zoom isn't worth its motion
const MAX_AMOUNT = 2; // tighter than this loses the context around the action
const OFF_CENTRE = 0.12; // how far (in view widths / heights) the content may sit from the middle
const OFF_CENTRE_TARGET = 0.2; // and the thing acted on, as it's acted on (the content comes first)
const CONNECT_GAP = 1.5; // Recordly glides between zooms closer than this (render/motion.ts)

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
/**
 * How far the subject b sits from the middle of view v, in view widths and heights, beyond what the
 * camera can help (at the edge of the recording it can't move further, so it can't centre it).
 */
const offCentre = (b, v, keep) => {
  // the middles the camera could have: within the recording, and (with `keep`) keeping all of it in view
  const best = (c, size, total, k0, k1) => {
    let lo = size / 2, hi = total - size / 2;
    if (keep && k1 - k0 <= size) [lo, hi] = [Math.max(lo, k1 - size / 2), Math.min(hi, k0 + size / 2)];
    return lo <= hi ? Math.max(lo, Math.min(hi, c)) : (k0 + k1) / 2;
  };
  const vx = v.x + v.w / 2, vy = v.y + v.h / 2;
  return {
    x: Math.abs(vx - best(b.x + b.w / 2, v.w, W, keep?.x, keep && keep.x + keep.w)) / v.w,
    y: Math.abs(vy - best(b.y + b.h / 2, v.h, H, keep?.y, keep && keep.y + keep.h)) / v.h
  };
};
/**
 * Where to put the middle of a zoom on some actions: the middle of what they show, their result,
 * the content the viewer looks at. (Their targets only have to be in view: pulling the middle
 * toward the button that was clicked pushes the content off to a side.) As a zoom focus, in % of
 * the recording.
 */
const middleOf = needBoxes => {
  const u = union(needBoxes);
  return {x: +(((u.x + u.w / 2) / W) * 100).toFixed(2), y: +(((u.y + u.h / 2) / H) * 100).toFixed(2)};
};
const span = (a, b) => Array.from({length: Math.max(1, Math.round((b - a) / 0.05)) + 1}, (_, k) => a + k * 0.05).filter(s => s <= b + 1e-9);

// ---------------------------------------------------------------- what changed on screen
const SW = 480, SH = Math.round((SW * H) / W / 2) * 2; // the recording's own shape
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
  const kx = W / SW, ky = H / SH;
  return {x: Math.round(x0 * kx), y: Math.round(y0 * ky), w: Math.round((x1 - x0 + 1) * kx), h: Math.round((y1 - y0 + 1) * ky)};
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
    // centred: while zoomed in, what the beat is about sits in the middle of the view, not off to a
    // side (a zoom framed on several beats at once leaves each of them off-centre)
    // (the target as the action happens, then the target and its result once it has played out)
    for (const [what, box, a, z, keep, tol] of [['its target', b.target, b.t, b.t + 0.3, need, OFF_CENTRE_TARGET], ['what it shows', result ?? need, (b.t + b.end) / 2, b.end, null, OFF_CENTRE]]) {
      // judged once the camera has settled: mid-zoom it is still on its way to the middle
      const settled = (s, v) => {
        const n = viewAt(s + 0.05, d);
        return Math.abs(n.amount - v.amount) < 0.004 && Math.hypot(n.x + n.w / 2 - (v.x + v.w / 2), n.y + n.h / 2 - (v.y + v.h / 2)) < W * 0.0015;
      };
      const offs = box ? span(a, z).map(s => ({s, v: viewAt(s, d)})).filter(({s, v}) => v.amount > 1.05 && settled(s, v)).map(x => ({...x, o: offCentre(box, x.v, keep)})) : [];
      const offBad = offs.filter(x => x.o.x > tol || x.o.y > tol);
      if (!offs.length || offBad.length <= offs.length / 2) continue;
      const f = offBad.reduce((p, c) => (Math.max(c.o.x, c.o.y) > Math.max(p.o.x, p.o.y) ? c : p));
      zoomsAt(f.s, d).forEach(x => zooms.add(x));
      problems.push(`off-centre at ${f.s.toFixed(1)} s: ${what} sits ${Math.round(Math.max(f.o.x, f.o.y) * 100)}% of the view from its middle (at most ${tol * 100}%)`);
    }
    const zoomed = b.zoom && d.zooms.some(z => z.start < b.end && z.end > (b.t + b.end) / 2);
    if (b.zoom && !zoomed) problems.push(`the flow wants a ${b.zoom}× zoom here, and there's none`);
    if (early.length) problems.push(`the ${b.action} target is out of view around the action (${early[0].s.toFixed(1)} s, ${early[0].v.amount}×)`);
    if (late.length) {
      const f = late.reduce((a, c) => (c.v.amount > a.v.amount ? c : a));
      problems.push(need.w * MARGIN > f.v.w || need.h * MARGIN > f.v.h ? `zoomed too far at ${f.s.toFixed(1)} s: ${f.v.amount}× shows ${Math.round(f.v.w)}×${Math.round(f.v.h)}, the action needs ${need.w}×${need.h} (at most ${capFor(need).toFixed(1)}×)` : `the view at ${f.s.toFixed(1)} s (${f.v.amount}×) misses part of what the action needs`);
    }
    // Readable: once the action has happened, the view holds still long enough to read what it shows
    // (kept apart from `problems`: --fix reframes zooms, it can't make a hold longer)
    // the viewer can read until the next action starts (or the video ends)
    const next = beats.filter(x => x.t > b.t + 0.05 && x.label.startsWith('hook · ') === b.label.startsWith('hook · ')).reduce((m, x) => Math.min(m, x.t), b.label.startsWith('hook · ') ? Math.max(...beats.filter(x => x.label.startsWith('hook · ')).map(x => x.end)) : rec.durationSec);
    const hold = holdFor(b), held = b.words ? steadyFor(b.t + 0.3, Math.max(b.end, next), d) : Infinity;
    const read = held + 0.05 < hold ? `readability: the view holds still for ${held.toFixed(1)} s after the ${b.action}; its ${b.words} words need ${hold.toFixed(1)} s (a longer hold in the flow)` : null;
    return {i, beat: b, result, need, view: viewAt(b.end - 0.05, d), viewAtAction: viewAt(b.t, d), zooms: [...zooms], problems, read};
  });
}
/**
 * How long a beat's result should stay still to be read: ~0.15 s per word, between 0.8 and 2 s.
 * What's on screen is mostly labels (a dialog's title, fields and buttons), read at a glance, not
 * sentences; prose needs the flow to hold longer than this asks.
 */
const holdFor = b => Math.min(2, Math.max(0.8, (b.words ?? 0) * 0.15));
/** The longest stretch in [a, z] where the camera neither zooms nor pans. */
function steadyFor(a, z, d) {
  let best = 0, run = 0, prev = viewAt(a, d);
  for (const s of span(a + 0.05, z)) {
    const v = viewAt(s, d);
    const moved = Math.abs(v.amount - prev.amount) > 0.004 || Math.hypot(v.x + v.w / 2 - (prev.x + prev.w / 2), v.y + v.h / 2 - (prev.y + prev.h / 2)) > W * 0.0015;
    run = moved ? 0 : run + 0.05;
    best = Math.max(best, run);
    prev = v;
  }
  return best;
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
    ${r.problems.map(p => `<p>✗ ${p}</p>`).join('') || '<p class="pass">✓ in view</p>'}${r.read ? `<p class="read">✗ ${r.read}</p>` : ''}
    <div class="row">
      <figure><div class="frame"><img src="${rawShot}">${rect(r.need, 'need')}${rect(r.viewAtAction, 'view at')}${rect(r.view, 'view')}</div><figcaption>raw · green: needed · blue: camera (dashed at the action)</figcaption></figure>
      ${shots.map((s, k) => `<figure><img src="${s}"><figcaption>video · ${['action', 'midway', 'after'][k]}</figcaption></figure>`).join('')}
    </div></section>`;
});
// Mid-transition stills: halfway through every zoom-in, zoom-out and glide, where a move between
// two busy views can turn muddy.
const RAMP = (doc.motion?.preset ?? 'smooth') === 'focused' ? 0.45 : 1.1;
const sorted = [...doc.zooms].sort((a, b) => a.start - b.start);
const linked = (a, b) => a && b && doc.motion?.connect && b.start - a.end < 1.5;
const moves = sorted.flatMap((z, i) => {
  const r = Math.min(RAMP, (z.end - z.start) / 2), prev = sorted[i - 1], next = sorted[i + 1];
  return [
    ...(linked(prev, z) ? [] : [{s: z.start + r / 2, what: `into ${z.amount}×`}]),
    linked(z, next) ? {s: (z.end + next.start) / 2, what: `glide ${z.amount}× → ${next.amount}×`} : {s: z.end - r / 2, what: `out of ${z.amount}×`}
  ];
});
const moveShots = moves.map((m, k) => ({...m, img: still(video, m.s, `move-${String(k + 1).padStart(2, '0')}.jpg`)}));
const transitions = moveShots.length
  ? `<section class="moves"><h2>Mid-transition <small>halfway through each camera move</small></h2><div class="grid">${moveShots.map(m => `<figure><img src="${m.img}"><figcaption>${m.s.toFixed(1)} s · ${m.what}</figcaption></figure>`).join('')}</div></section>`
  : '';
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
  .view{border:3px solid #4f8cff} .view.at{border-style:dashed} p.read{color:#ffc46b}
  section.moves{border-left-color:#4f8cff} .grid{display:grid;grid-template-columns:repeat(4,480px);gap:12px}
  </style><h1>${project.name} — ${results.filter(r => r.problems.length || r.read).length} of ${results.length} beats need attention</h1>${rows.join('')}${transitions}`
);
const browser = await chromium.launch({executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
const page = await browser.newPage({viewport: {width: 2048, height: 800}});
await page.goto(`file://${join(dir, 'sheet.html')}`);
await page.screenshot({path: join(dir, 'sheet.png'), fullPage: true});
await browser.close();

// ---------------------------------------------------------------- report and fix
const failing = results.filter(r => r.problems.length || r.read);
const m = motionOf(doc);
const harsh = [];
if (m.zoom.v > MAX_ZOOM_SPEED) harsh.push(`camera zooms too sharply at ${m.zoom.s.toFixed(1)} s (${m.zoom.v.toFixed(1)} doublings/s, at most ${MAX_ZOOM_SPEED}); try --motion smooth`);
if (m.pan.v > MAX_PAN_SPEED) harsh.push(`camera pans too fast at ${m.pan.s.toFixed(1)} s (${m.pan.v.toFixed(1)} view widths/s, at most ${MAX_PAN_SPEED})`);
// a zoom still on (or still easing out) when the video cuts to another scene carries the camera
// move across the cut, onto a screen it wasn't framed for
// (Recordly eases out within a zoom's own span, so it only has to end before the cut)
const acrossCut = z => scenes.find(c => z.start < c && z.end > c - 0.05);
for (const z of doc.zooms) if (acrossCut(z) !== undefined) harsh.push(`a zoom (${z.start.toFixed(1)}–${z.end.toFixed(1)} s) runs across the cut at ${acrossCut(z).toFixed(1)} s`);
const lines = [`# Review: ${project.name}`, '', `${results.length} beats, ${doc.zooms.length} zooms (${doc.motion?.preset} motion), ${failing.length} beats need attention.`, `Motion: peak zoom speed ${m.zoom.v.toFixed(1)} doublings/s at ${m.zoom.s.toFixed(1)} s, peak pan ${m.pan.v.toFixed(1)} view widths/s at ${m.pan.s.toFixed(1)} s.${harsh.map(h => `\n- ✗ ${h}`).join('')}`, ''];
// The plan's checks (walkthrough.json, from the flow): the length, and when the milestones land
const meta = JSON.parse(readFileSync(join(out, 'walkthrough.json'), 'utf8'));
const planIssues = [];
if (meta.plan) {
  const [lo, hi] = meta.plan.duration ?? [0, Infinity];
  if (rec.durationSec < lo || rec.durationSec > hi) planIssues.push(`plan: the video is ${rec.durationSec.toFixed(1)} s; the plan says ${lo}–${hi} s`);
  for (const ms of meta.plan.milestones ?? []) {
    const b = beats.find(x => !x.label.startsWith('hook · ') && x.label === ms.beat);
    if (!b) planIssues.push(`plan: no "${ms.beat}" in the video`);
    else if (b.t > ms.by) planIssues.push(`plan: "${ms.beat}" comes at ${b.t.toFixed(1)} s; the plan wants it by ${ms.by} s`);
  }
  lines.push(`Plan: ${rec.durationSec.toFixed(1)} s (target ${lo}–${hi} s)${planIssues.length ? planIssues.map(x => `\n- ✗ ${x}`).join('') : ', milestones on time.'}`, '');
}
for (const r of results) lines.push(`- ${r.problems.length || r.read ? '✗' : '✓'} ${String(r.i + 1).padStart(2, '0')} ${r.beat.action} ${r.beat.label} (${r.beat.t.toFixed(1)} s)${[...r.problems, ...(r.read ? [r.read] : [])].map(p => `\n  - ${p}`).join('')}`);

if (fix) {
  // Recordly's camera is pure, so fixes are checked here before rendering: repeat until clean.
  lines.push('', '## Fixes');
  // zooms the flow asked for where there's none: manual, on the action's target and result, from a
  // moment before it until a moment after, kept clear of the zooms around it
  const tooBig = new Set();
  const hookEnd = Math.max(0, ...beats.filter(b => b.label.startsWith('hook · ')).map(b => b.end));
  const addWanted = () => {
    for (const [i, b] of beats.entries()) {
      if (!b.zoom || tooBig.has(i) || doc.zooms.some(z => z.start < b.end && z.end > (b.t + b.end) / 2) || !needs[i].need) continue;
      const need = needs[i].need;
      const before = Math.max(0, ...doc.zooms.filter(z => z.end <= b.t).map(z => z.end + 0.2));
      // until the next zoom, or the next action that wants its own
      // A second between neighbouring zooms, so Recordly's glide from one to the other takes that
      // second instead of snapping: this one ends a second before the next zoom (or the next action
      // that wants its own), and a zoom running into this beat ends a second before this one starts.
      // The hook's end is a cut to the start of the walkthrough: no zoom glides across it. A hook zoom
      // ends before the hook does, and the next zoom starts far enough on that Recordly doesn't
      // connect the two (1.5 s).
      const GLIDE = 1.0, APART = 1.6;
      const isHook = b.label.startsWith('hook · ');
      const gapAfter = z => (hookEnd && z.end <= hookEnd + 0.01 ? APART : GLIDE);
      const after = Math.min(isHook ? hookEnd - 0.6 : Infinity, ...doc.zooms.filter(z => z.start >= (b.t + b.end) / 2).map(z => z.start - GLIDE), ...beats.filter(n => n.zoom && n.t > b.t).map(n => n.t - 0.2 - GLIDE), ...scenes.filter(c => c > b.t).map(c => c - 0.1));
      const before0 = before;
      for (const z of doc.zooms) if (z.end > b.t - 0.2 - GLIDE && z.start < b.t) z.end = Math.max(z.start + 0.6, Math.min(z.end, b.t - 0.2 - GLIDE));
      // and not before the action ahead of it has played out (what that one needs may not fit)
      const prevEnd = Math.max(0, ...beats.filter(p => p !== b && p.end <= b.t + 0.01).map(p => p.end));
      const amount = Math.min(b.zoom, MAX_AMOUNT, Math.floor(capFor(need) * 10) / 10);
      if (amount < MIN_ZOOM) {
        tooBig.add(i);
        lines.push(`- ${b.t.toFixed(1)} s ${b.label}: wanted a ${b.zoom}× zoom, but what it needs (${need.w}×${need.h}) only fits at ${amount}×; left unzoomed`);
        continue;
      }
      const z = {id: `zm-flow-${i}`, start: +Math.max(before0, b.t - 0.8, prevEnd, ...scenes.filter(c => c <= b.t).map(c => Math.ceil(c * 100) / 100), ...doc.zooms.filter(z => z.start < b.t).map(z => z.end + gapAfter(z))).toFixed(2), end: +Math.min(after, b.end + 0.9).toFixed(2), amount, mode: 'manual', focus: middleOf([needs[i].result ?? need])};
      doc.zooms.push(z);
      doc.zooms.sort((a, c) => a.start - c.start);
      lines.push(`- ${z.start.toFixed(1)}–${z.end.toFixed(1)} s: added a ${amount}× zoom on ${b.label}, as the flow asked`);
    }
  };
  // Frame every zoom like a director would: centred on what the actions it covers need (Recordly's
  // own zooms follow the cursor, which leaves the content wherever the pointer is), no tighter than
  // that allows, and never past MAX_AMOUNT. A zoom has one focus, so when its actions need different
  // places (a form, then the button on the page it leads to) it becomes one zoom per group of actions
  // that share a middle, gliding from one to the next: each one centred while it's on screen.
  const amountFor = (z, need) => Math.min(z.amount, MAX_AMOUNT, Math.floor(capFor(need) * 10) / 10);
  const centredIn = (members, amount) => {
    const w = W / amount, h = H / amount, m = middleOf(members.map(x => x.shows));
    const cx = Math.max(w / 2, Math.min(W - w / 2, (m.x / 100) * W)), cy = Math.max(h / 2, Math.min(H - h / 2, (m.y / 100) * H));
    const v = {x: cx - w / 2, y: cy - h / 2, w, h};
    const ok = (box, keep, tol) => {
      const o = offCentre(box, v, keep);
      return o.x <= tol && o.y <= tol;
    };
    return members.every(m => ok(m.shows, null, OFF_CENTRE) && (!m.target || ok(m.target, m.need, OFF_CENTRE_TARGET)));
  };
  const PAN = 0.7; // the glide from one group to the next
  /** The zooms z becomes: [z] reframed, or one per group of its beats; [] if none can zoom. */
  const frameZoom = z => {
    const covered = beats.map((b, i) => ({b, need: needs[i].need, shows: needs[i].result ?? needs[i].need})).filter(({b, need}) => need && b.end > z.start && b.t < z.end).sort((p, q) => p.b.t - q.b.t);
    if (!covered.length) return [z];
    const groups = [];
    for (const c of covered) {
      const g = groups.at(-1);
      const u = g && union([...g.map(x => x.need), c.need]);
      if (g && amountFor(z, u) >= MIN_ZOOM && centredIn([...g, c].map(x => ({need: x.need, shows: x.shows, target: x.b.target})), amountFor(z, u))) g.push(c);
      else groups.push([c]);
    }
    // each group's framing first, then its times: the glide to the next group takes long enough
    // for the camera not to pan faster than MAX_PAN_SPEED (Recordly's eased glide peaks at about
    // 2.6 times its average speed)
    const framed = groups.map(g => {
      const need = union(g.map(x => x.need)), amount = amountFor(z, need);
      return {g, amount, focus: amount >= MIN_ZOOM ? middleOf(g.map(x => x.shows)) : null};
    });
    const panFor = (a, b) => {
      if (!a?.focus || !b?.focus) return PAN;
      const w = W / Math.min(a.amount, b.amount), dist = Math.hypot(((a.focus.x - b.focus.x) / 100) * W, ((a.focus.y - b.focus.y) / 100) * H);
      return Math.min(1.6, Math.max(PAN, (3 * dist) / (w * MAX_PAN_SPEED * 0.9)));
    };
    const made = [];
    framed.forEach(({g, amount, focus}, k) => {
      if (!focus) return;
      const first = g[0].b, last = g.at(-1).b, next = groups[k + 1]?.[0].b;
      const start = k === 0 ? z.start : Math.max(made.at(-1) ? made.at(-1).end + panFor(framed[k - 1], framed[k]) * 0.5 : z.start, first.t - 0.25);
      const end = !next ? z.end : Math.max(last.t + 0.4, Math.min(last.end, next.t - 0.25 - panFor(framed[k], framed[k + 1])));
      if (end - start < 0.6) return;
      made.push({...z, id: groups.length > 1 ? `${z.id}-${k}` : z.id, start: +start.toFixed(2), end: +end.toFixed(2), amount, mode: 'manual', focus});
    });
    return made;
  };
  const describe = z => `${z.start.toFixed(1)}–${z.end.toFixed(1)} s ${z.amount}× on ${(() => {
    const n = union(beats.map((b, i) => (b.end > z.start && b.t < z.end ? needs[i].need : null)));
    return n ? `${n.w}×${n.h}` : 'nothing';
  })()}`;
  /** Puts frameZoom's result in place of z; says what changed. */
  const reframe = (z, why = '') => {
    const made = frameZoom(z);
    const same = made.length === 1 && made[0].start === z.start && made[0].end === z.end && made[0].amount === z.amount && z.mode === 'manual' && made[0].focus.x === z.focus.x && made[0].focus.y === z.focus.y;
    if (same) return false;
    doc.zooms = [...doc.zooms.filter(x => x !== z), ...made].sort((a, b) => a.start - b.start);
    const before = `${z.start.toFixed(1)}–${z.end.toFixed(1)} s: ${z.amount}× ${z.mode}`;
    if (!made.length) lines.push(`- ${before} → removed (what its actions need is too much to zoom)${why}`);
    else if (made.length === 1) lines.push(`- ${before} → ${describe(made[0])}, centred${why}`);
    else lines.push(`- ${before} → split in ${made.length}, each centred on its actions: ${made.map(describe).join('; ')}${why}`);
    return true;
  };
  for (const z of [...doc.zooms]) reframe(z);
  // Repeat until nothing changes: removing a zoom that can't fit can leave a wanted zoom to add.
  // zooms end early enough to have eased out before a cut to another scene
  const clampToScenes = () => {
    for (const z of [...doc.zooms]) {
      const c = acrossCut(z);
      if (c === undefined) continue;
      const end = +(c - 0.1).toFixed(2);
      if (end - z.start < 0.6) {
        doc.zooms = doc.zooms.filter(x => x !== z);
        lines.push(`- ${z.start.toFixed(1)}–${z.end.toFixed(1)} s: ${z.amount}× → removed, it ran across the cut at ${c.toFixed(1)} s`);
      } else {
        lines.push(`- ${z.start.toFixed(1)}–${z.end.toFixed(1)} s: ${z.amount}× → ends at ${end.toFixed(1)} s, eased out before the cut at ${c.toFixed(1)} s`);
        z.end = end;
      }
    }
  };
  // A zoom cut short to make room for one after it that's since gone: run it on again, so its last
  // action can be read before the camera eases out (to a moment after that action, short of the
  // next zoom, the next cut, and the next action's own arrival).
  const extendHolds = () => {
    const zs = [...doc.zooms].sort((a, b) => a.start - b.start);
    zs.forEach((z, k) => {
      const inZoom = beats.filter(b => b.t >= z.start && b.t < z.end);
      if (!inZoom.length) return;
      const last = inZoom.reduce((a, b) => (b.t > a.t ? b : a));
      const nextBeat = beats.filter(b => b.t > last.t + 0.05).reduce((m, b) => Math.min(m, b.t), Infinity);
      const next = zs[k + 1];
      const bound = Math.min(next ? next.start - GLIDE_GAP : Infinity, ...scenes.filter(c => c > z.start).map(c => c - 0.1), nextBeat - 0.05, rec.durationSec - 0.1);
      const want = Math.min(last.end + 0.9, bound);
      if (want > z.end + 0.05) {
        lines.push(`- ${z.start.toFixed(1)}–${z.end.toFixed(1)} s: runs on to ${want.toFixed(1)} s, so ${last.label} can be read before it eases out`);
        z.end = +want.toFixed(2);
      }
    });
  };
  const GLIDE_GAP = 1.0;
  for (let round = 0; round < 8; round++) {
    addWanted();
    clampToScenes();
    extendHolds();
    const checked = check(doc);
    const bad = new Set(checked.flatMap(r => (r.problems.length ? r.zooms : [])));
    if (!bad.size) break;
    const why = z => checked.find(r => r.problems.length && r.zooms.includes(z))?.problems[0];
    for (const z of bad) {
      if (round < 6 && doc.zooms.includes(z) && reframe(z, ' (it left an action off-centre or out of view)')) continue;
      const inside = beats.map((b, i) => (b.end > z.start && b.t < z.end ? i : -1)).filter(i => i >= 0);
      const need = union(inside.map(i => needs[i].need));
      // can't be centred this tight (the result fills the view, so the camera can't move to the
      // target): a little wider, where there's room to
      if (round < 6 && why(z)?.startsWith('off-centre') && z.amount - 0.1 >= MIN_ZOOM) {
        const before = z.amount;
        z.amount = +(z.amount - 0.1).toFixed(2);
        z.mode = 'manual';
        z.focus = middleOf(inside.map(i => needs[i].result ?? needs[i].need));
        lines.push(`- ${z.start.toFixed(1)}–${z.end.toFixed(1)} s: ${before}× → ${z.amount}×, wider so its target can be centred too`);
        continue;
      }
      const before = `${z.amount}× ${z.mode}`;
      const cap = need ? Math.floor(capFor(need) * 10) / 10 : z.amount;
      if (cap < MIN_ZOOM || round >= 6) {
        doc.zooms = doc.zooms.filter(x => x !== z);
        lines.push(`- ${z.start.toFixed(1)}–${z.end.toFixed(1)} s: ${before} → removed (${cap < MIN_ZOOM && need ? `what it covers spans ${need.w}×${need.h}, too much to zoom` : `no framing of it worked: ${why(z)}`})`);
        continue;
      }
      const focus = middleOf(inside.map(i => needs[i].result ?? needs[i].need));
      const same = z.mode === 'manual' && z.amount === Math.min(z.amount, cap) && z.focus.x === focus.x && z.focus.y === focus.y;
      z.amount = Math.min(z.amount, cap);
      z.mode = 'manual';
      z.focus = focus;
      if (!same) lines.push(`- ${z.start.toFixed(1)}–${z.end.toFixed(1)} s: ${before} → ${z.amount}× manual, centred on the ${need.w}×${need.h} area its beats need`);
    }
  }
  // Zooms that move the camera too sharply (a short zoom ramps fast): ease them off 0.1× at a time
  for (let round = 0; round < 12; round++) {
    const mv = motionOf(doc);
    if (mv.zoom.v <= MAX_ZOOM_SPEED) break;
    const near = [...doc.zooms].sort((a, b) => Math.min(Math.abs(a.start - mv.zoom.s), Math.abs(a.end - mv.zoom.s)) - Math.min(Math.abs(b.start - mv.zoom.s), Math.abs(b.end - mv.zoom.s)))[0];
    if (!near) break;
    const before = near.amount;
    near.amount = +(near.amount - 0.1).toFixed(2);
    if (near.amount < MIN_ZOOM) doc.zooms = doc.zooms.filter(x => x !== near);
    lines.push(`- ${near.start.toFixed(1)}–${near.end.toFixed(1)} s: ${before}× → ${near.amount < MIN_ZOOM ? 'removed' : `${near.amount}×`}, as it moved the camera at ${mv.zoom.v.toFixed(1)} doublings/s`);
  }
  const mf = motionOf(doc);
  if (mf.zoom.v > MAX_ZOOM_SPEED) lines.push(`- the camera still zooms too sharply at ${mf.zoom.s.toFixed(1)} s (${mf.zoom.v.toFixed(1)} doublings/s): space those zooms out in the flow`);
  const left = check(doc).filter(r => r.problems.length).length + (mf.zoom.v > MAX_ZOOM_SPEED ? 1 : 0);
  // the flow's captions, in their band above the recording
  if (captionWalkthrough(doc, {beats, meta, durationSec: rec.durationSec})) lines.push(`- ${doc.captions.length} captions, in a band above the recording`);
  project.edited = new Date().toISOString();
  writeFileSync(projectFile, JSON.stringify(project));
  lines.push('', left ? `${left} beats still fail on paper; change the flow (pacing, \`show\`).` : 'All beats pass on paper. Render again (render.mjs), then review again to check the frames.');
}
writeFileSync(join(dir, 'report.md'), lines.join('\n') + '\n');
console.log(lines.join('\n'));
console.log(`\ncontact sheet: ${join(dir, 'sheet.png')}`);
process.exitCode = (failing.length && !fix) || harsh.length || planIssues.length ? 1 : 0;
