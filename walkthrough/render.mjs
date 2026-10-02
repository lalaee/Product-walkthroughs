// Turns a recording made by record.mjs into the finished video with Recordly: opens its project,
// lets Recordly suggest zooms from the clicks and pauses, and exports an MP4 with its own exporter.
//
//   node walkthrough/render.mjs out/<flow> [--motion smooth|focused] [--fresh] [--quality original|high|standard]
//                               [--fps 60|30] [--recordly ../recorder-2]
//
// Needs Recorder-2 cloned and built (npm ci && npm run build:native && npm run build).
// Motion is Recordly's zoom preset: smooth (default) = 1.1 s eased in-out camera moves, fewer and
// longer zooms; focused = 0.45 s snappy moves, more and tighter zooms. Recordly suggests zooms
// once, when it first opens a project; --fresh discards the saved edit (and any review fixes) so it
// suggests again, e.g. after changing --motion.
// Writes <out>/<flow>.mp4 and <out>/editor.png (the editor's timeline, to check the zooms).
import {mkdtempSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {basename, join, resolve} from 'node:path';
import {startDisplay} from './lib/display.mjs';
import {launchRecordly, recordlyDir} from './lib/recordly.mjs';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const outArg = process.argv[2];
if (!outArg || outArg.startsWith('--')) {
  console.error('usage: node walkthrough/render.mjs out/<flow> [--motion focused|smooth] [--recordly dir]');
  process.exit(2);
}
const out = resolve(outArg);
const library = join(out, 'library');
const recordly = recordlyDir(arg('recordly'));
const motion = arg('motion', 'smooth');
const quality = arg('quality', 'original');
const fps = arg('fps', '60');
const projectFile = join(library, 'Projects', readdirSync(join(library, 'Projects')).find(f => f.endsWith('.recordly')));
const project = basename(projectFile).replace(/\.recordly$/, '');
const saved = JSON.parse(readFileSync(projectFile, 'utf8'));
if (process.argv.includes('--fresh') && saved.doc) {
  delete saved.doc;
  writeFileSync(projectFile, JSON.stringify(saved));
} else if (saved.doc && saved.doc.motion?.preset !== motion) {
  console.warn(`note: the project's zooms were made with the ${saved.doc.motion?.preset} preset; add --fresh to redo them as ${motion}`);
}

const downloads = mkdtempSync(join(tmpdir(), 'recordly-export-'));
const screen = await startDisplay({width: 1920, height: 1200});
const recordlyApp = await launchRecordly({dir: recordly, env: {...process.env, DISPLAY: screen.display}, library, motion, downloads});
const {log} = recordlyApp;

try {
  const main = await recordlyApp.window('main');
  main.setDefaultTimeout(30_000);
  await main.setViewportSize({width: 1440, height: 900}).catch(() => {});

  console.log(`opening "${project}" in Recordly (${motion} zooms)…`);
  await main.locator('[role=gridcell]', {hasText: project}).first().dblclick();
  await main.locator('canvas[aria-label=Preview]').waitFor();
  await main.waitForTimeout(3000);
  const zooms = await main.getByRole('button', {name: /Auto \(follows cursor\)|Manual focus/}).count();
  await main.mouse.move(2, 2);
  await main.screenshot({path: join(out, 'editor.png')});
  console.log(`${zooms} zooms suggested`);

  await main.getByRole('button', {name: 'Export', exact: true}).first().click();
  const dlg = main.getByRole('dialog');
  await dlg.waitFor();
  // segmented controls: Quality (Original = the recording's own size) and Frame rate
  const pick = async (group, item) => {
    const option = dlg.getByRole('radiogroup', {name: group}).getByRole('radio', {name: item, exact: true});
    await option.evaluate(e => e.click());
    if (!(await option.isChecked())) throw new Error(`couldn't set ${group} to ${item}`);
  };
  await pick('Quality', quality[0].toUpperCase() + quality.slice(1));
  await pick('Frame rate', `${fps} fps`);
  await dlg.getByRole('button', {name: /^Export MP4$/}).click();
  const t0 = Date.now();
  await dlg.getByRole('button', {name: 'Save'}).waitFor({timeout: 30 * 60_000});
  await dlg.getByRole('button', {name: 'Save'}).click();
  await dlg.getByText('Your video is ready').waitFor();
  const file = readdirSync(downloads).filter(f => f.endsWith('.mp4')).map(f => join(downloads, f)).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
  if (!file) throw new Error('Recordly said the export finished, but no MP4 was saved');
  const dest = join(out, `${basename(out)}.mp4`);
  renameSync(file, dest);
  console.log(`exported in ${((Date.now() - t0) / 1000).toFixed(0)} s → ${dest}`);
} catch (err) {
  console.error(`render failed: ${err.message}`);
  const tail = log.join('').trim().split('\n').slice(-15).join('\n');
  if (tail) console.error(`Recordly's log:\n${tail}`);
  process.exitCode = 1;
} finally {
  await recordlyApp.close();
  screen.stop();
}
