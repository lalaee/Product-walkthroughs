// Copies walkthroughs' Recordly projects into one library folder you can open in Recordly to edit
// them yourself: Settings › Recordings folder → that folder (or copy its contents into your own
// recordings folder). Each project keeps its zooms, captions and trims; the recording it points to
// sits next to it. Machine paths are dropped (Recordly finds recordings by id in the folder).
//
//   node walkthrough/library-export.mjs <library dir> out/<flow> [out/<flow> …]
import {cpSync, mkdirSync, readdirSync, readFileSync, writeFileSync} from 'node:fs';
import {basename, join, resolve} from 'node:path';

const [dest, ...outs] = process.argv.slice(2).map(p => resolve(p));
if (!dest || !outs.length) throw new Error('usage: library-export.mjs <library dir> out/<flow> …');
mkdirSync(join(dest, 'Projects'), {recursive: true});
for (const out of outs) {
  const lib = join(out, 'library');
  const projects = readdirSync(join(lib, 'Projects')).filter(f => f.endsWith('.recordly'));
  if (!projects.length) throw new Error(`${basename(out)}: no Recordly project`);
  for (const f of projects) {
    const project = JSON.parse(readFileSync(join(lib, 'Projects', f), 'utf8'));
    delete project.recordings;
    writeFileSync(join(dest, 'Projects', f), JSON.stringify(project));
  }
  for (const d of readdirSync(lib, {withFileTypes: true}))
    if (d.isDirectory() && d.name !== 'Projects') cpSync(join(lib, d.name), join(dest, d.name), {recursive: true});
  console.log(`${basename(out)}: ${projects.join(', ')}`);
}
