// One full-size frame per action of a finished video, for checking each by eye: is what the action
// is about in the middle of the view, nothing important cut off at an edge, the screen in the right
// state (not still loading)? The numbers in review.mjs can't see those; this is the look.
//
//   node walkthrough/frames.mjs out/<flow> [--width 960]
//
// Writes <out>/frames/NN.jpg (labelled with the action), taken once the action has played out
// (just before it ends), and <out>/frames/all.jpg, all of them two to a row. Look at every one.
import {execFileSync} from 'node:child_process';
import {mkdirSync, readFileSync, rmSync} from 'node:fs';
import {basename, join, resolve} from 'node:path';

const out = resolve(process.argv[2] ?? '');
const i = process.argv.indexOf('--width');
const width = i > 0 ? Number(process.argv[i + 1]) : 960;
const video = join(out, `${basename(out)}.mp4`);
const {beats} = JSON.parse(readFileSync(join(out, 'beats.json'), 'utf8'));
const dir = join(out, 'frames');
rmSync(dir, {recursive: true, force: true});
mkdirSync(dir);
// drawtext needs its text escaped; keep labels to plain characters
const label = s => s.replace(/[^\w .,()-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);
beats.forEach((b, k) => {
  const t = Math.max(b.t + 0.25, b.end - 0.15);
  const text = `${k + 1}  ${label(b.label)}  ${t.toFixed(1)} s`;
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', t.toFixed(2), '-i', video, '-frames:v', '1', '-vf', `scale=${width}:-2,drawtext=text='${text}':x=12:y=h-th-12:fontsize=${Math.round(width / 32)}:fontcolor=yellow:box=1:boxcolor=black@0.7:boxborderw=6`, '-q:v', '3', join(dir, `${String(k + 1).padStart(2, '0')}.jpg`)]);
});
execFileSync('ffmpeg', ['-v', 'error', '-y', '-framerate', '1', '-i', join(dir, '%02d.jpg'), '-vf', `tile=2x${Math.ceil(beats.length / 2)}:padding=8:color=black`, '-frames:v', '1', '-q:v', '3', join(dir, 'all.jpg')]);
console.log(`${beats.length} frames → ${dir} (all of them: ${join(dir, 'all.jpg')})`);
