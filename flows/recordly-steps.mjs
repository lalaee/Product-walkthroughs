// Steps shared by the Recordly flows: record a short Taskly session with Recordly's recorder bar,
// then finish it in Recordly's editor.

/**
 * From the recorder bar: start recording, hide the bar (on Linux it would be in the recording),
 * create a project in Taskly, stop with Ctrl+Shift+2. Returns where to trim the start, in seconds of
 * the recording: past what it caught of the bar.
 * @param {import('../walkthrough/lib/director.mjs').Director} d
 */
export async function recordTaskly(d, {overlay, taskly}) {
  // the countdown: its circle, "Recording your screen" and Cancel
  const countdown = [overlay.locator('[aria-label^="Recording starts in"] [aria-live]'), overlay.getByRole('button', {name: /^Cancel/})];
  await d.click(overlay.getByRole('button', {name: 'Record', exact: true}), {hold: 300, show: countdown, label: 'Record'});
  const hide = overlay.getByRole('button', {name: 'Hide controls'});
  await hide.waitFor({timeout: 15_000});
  const recStart = Date.now();
  await d.click(hide, {hold: 500, label: 'Hide controls'});
  const trimAt = Math.ceil(((Date.now() - recStart) / 1000 + 0.3) * 10) / 10;

  // what's being recorded
  await d.click(taskly.locator('#new-project'), {hold: 900, show: taskly.locator('.dialog')});
  await d.type(taskly.locator('#name'), 'Product launch');
  await d.click(taskly.locator('#create'), {hold: 1500, show: taskly.locator('.card.new')});
  await d.press('Control+Shift+2', {hold: 300, label: 'Stop (Ctrl+Shift+2)'});
  return trimAt;
}

/**
 * In the editor Recordly opens after recording: wait for its zoom suggestions (a wait cut from the
 * video), trim off the start, point out the suggested zoom and play it back.
 * @param {import('../walkthrough/lib/director.mjs').Director} d
 */
export async function finishInEditor(d, {main}, trimAt) {
  const zoom = main.getByRole('button', {name: /Auto \(follows cursor\)|Manual focus/}).first();
  const suggested = await d.idle(() => zoom.waitFor({timeout: 8_000}).then(() => true, () => false));
  if (!suggested) {
    // now and then Recordly doesn't suggest them on its own; then ask, as a person would
    await d.click(main.getByRole('button', {name: 'Suggest zooms'}).first(), {hold: 900, show: zoom, label: 'Suggest zooms'});
    await d.idle(() => zoom.waitFor({timeout: 15_000}));
  }
  await d.wait(800);

  // trim the start: playhead past the bar, split there, delete the first part
  // (the ruler's labels read 0:00.0 or 0:00, depending on how far the timeline is zoomed)
  const z0 = await d.s.box(main.getByText(/^0:00(\.0)?$/).last());
  const z1 = await d.s.box(main.getByText(/^0:01(\.0)?$/).last());
  const ruler = {x: Math.round(z0.x + (z1.x - z0.x) * trimAt + 1), y: Math.round(z0.y + z0.h / 2)};
  await d.click(ruler, {hold: 600, label: `the ruler at ${trimAt} s`});
  await d.click(main.getByRole('button', {name: /^Split clip/}), {hold: 700, label: 'Split clip at playhead'});
  await d.click(main.getByRole('button', {name: /^Clip 1:/}).first(), {hold: 600, label: 'the first part'});
  await d.click(main.getByRole('button', {name: /^Delete selected/}), {hold: 1000, show: main.getByRole('button', {name: /^Clip 1:/}).first(), label: 'Delete selected'});

  await d.point(zoom, {hold: 1600, show: zoom, label: 'the suggested zoom', zoom: 2});
  const preview = main.locator('canvas[aria-label=Preview]');
  await d.click(main.getByRole('button', {name: 'Play', exact: true}), {hold: 7000, show: preview, label: 'Play', zoom: 1.6});
}
