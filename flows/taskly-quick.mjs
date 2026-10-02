// A short Taskly clip (about 10 s): open the New project dialog, name it, create it. Used as the
// raw recording inside the Recordly walkthrough (flows/recordly-edit.mjs).
import {pathToFileURL} from 'node:url';

export const name = 'Taskly — new project';
export const url = pathToFileURL(new URL('../demo-app/index.html', import.meta.url).pathname).href;

/** @param {import('../walkthrough/lib/director.mjs').Director} d */
export async function run(d) {
  await d.click('#new-project', {hold: 900, show: '.dialog'});
  await d.type('#name', 'Product launch');
  await d.click('#create', {hold: 1500, show: '.card.new'});
}
