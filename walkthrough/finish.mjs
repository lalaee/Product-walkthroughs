// Finishes a reviewed walkthrough for sharing: a poster frame and share copy.
//
//   node walkthrough/finish.mjs out/<flow>
//
// The poster is the flow's chosen moment (`poster`: the label of a beat), taken once that beat has
// settled, just before the next action. It's saved as <flow>.jpg and baked in as frame 0 of the MP4:
// Slack, X and Discord make their thumbnail from frame 0 and ignore embedded cover art, so that's the
// only way to choose what people see before they press play. Frame 0 is replaced, not added, so
// the length stays the same. Share copy (the flow's `share`) goes to share-copy.txt.
import {execFileSync} from 'node:child_process';
import {readFileSync, renameSync, writeFileSync} from 'node:fs';
import {basename, join, resolve} from 'node:path';

const out = resolve(process.argv[2] ?? '');
const slug = basename(out);
const video = join(out, `${slug}.mp4`);
const meta = JSON.parse(readFileSync(join(out, 'walkthrough.json'), 'utf8'));
const {beats} = JSON.parse(readFileSync(join(out, 'beats.json'), 'utf8'));

// the poster moment: the flow's beat, settled (just before it ends); else the last beat's
const main = beats;
const beat = (meta.poster && main.find(b => b.label === meta.poster)) ?? main.at(-1);
if (meta.poster && beat.label !== meta.poster) console.warn(`no beat "${meta.poster}"; using the last one`);
const at = Math.max(0, beat.end - 0.3);
const poster = join(out, `${slug}.jpg`);
execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', at.toFixed(3), '-i', video, '-frames:v', '1', '-q:v', '2', poster]);

// bake it in as frame 0: same frames, same length, any audio copied through
const tmp = join(out, `${slug}.poster.mp4`);
execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', video, '-i', poster, '-filter_complex', "[0:v][1:v]overlay=0:0:enable='eq(n,0)'[v]", '-map', '[v]', '-map', '0:a?', '-c:v', 'libx264', '-crf', '16', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-c:a', 'copy', '-movflags', '+faststart', tmp]);
renameSync(tmp, video);
console.log(`poster: "${beat.label}" at ${at.toFixed(1)} s → ${poster} (and frame 0 of ${basename(video)})`);

if (meta.share) {
  writeFileSync(join(out, 'share-copy.txt'), meta.share.trim() + '\n');
  console.log(`share copy → ${join(out, 'share-copy.txt')}`);
} else console.warn('the flow has no `share` copy');
