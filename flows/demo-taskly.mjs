// Demo flow on the bundled Taskly page: create a project, open it, add two tasks, tick one off.
import {pathToFileURL} from 'node:url';

export const name = 'Taskly — create a project';
export const url = pathToFileURL(new URL('../demo-app/index.html', import.meta.url).pathname).href;

/** @param {import('../walkthrough/lib/director.mjs').Director} d */
export async function run(d, page) {
  await d.point('h2:has-text("Projects")', {hold: 900});
  await d.click('#new-project', {hold: 900});
  await d.type('#name', 'Product launch');
  await d.type('#desc', 'Everything we need for the October launch.');
  await d.click('#create', {hold: 1400});
  await d.click('.card.new', {hold: 1000});
  await d.type('#task-input', 'Write the announcement post');
  await d.press('Enter');
  await d.type('#task-input', 'Record the walkthrough video');
  await d.press('Enter', {hold: 800});
  await d.click(page.locator('.task').first().locator('input'), {hold: 1800});
}
