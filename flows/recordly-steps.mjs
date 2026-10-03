// Steps shared by the Recordly flows: record a short Taskly session with Recordly's recorder bar,
// then finish it in Recordly's editor.
import {slowMotion} from '../walkthrough/lib/slowmo.mjs';

/**
 * From the recorder bar: start recording, create a project in Taskly, stop.
 *
 * `hide`: hide the bar once recording (recording the whole screen on Linux, it would be in the
 * recording), then stop with Ctrl+Shift+2; returns where to trim the start, in seconds of the
 * recording, past what it caught of the bar. Without it the bar stays up (recording a window, it
 * isn't in the recording) and the recording stops with its Stop button; returns null (no trim).
 * @param {import('../walkthrough/lib/director.mjs').Director} d
 */
export async function recordTaskly(d, {overlay, taskly}, {hide = true} = {}) {
  // the countdown: its circle, "Recording your screen" and Cancel
  const countdown = [overlay.locator('[aria-label^="Recording starts in"] [aria-live]'), overlay.getByRole('button', {name: /^Cancel/})];
  await d.click(overlay.getByRole('button', {name: 'Record', exact: true}), {hold: 300, show: countdown, label: 'Record'});
  // the 3-2-1 countdown, played at 3×
  const hideButton = overlay.getByRole('button', {name: 'Hide controls'});
  const stop = overlay.getByRole('button', {name: 'Stop', exact: true});
  await d.fast(() => (hide ? hideButton : stop).waitFor({timeout: 15_000}), {speed: 3});
  let trimAt = null;
  if (hide) {
    const recStart = Date.now();
    await d.click(hideButton, {hold: 500, label: 'Hide controls'});
    trimAt = Math.ceil(((Date.now() - recStart) / 1000 + 0.3) * 10) / 10;
  }

  // what's being recorded
  await d.click(taskly.locator('#new-project'), {hold: 800, show: taskly.locator('.dialog')});
  await d.type(taskly.locator('#name'), 'Product launch', {delay: 40, hold: 400});
  await d.click(taskly.locator('#create'), {hold: 1200, show: taskly.locator('.card.new')});
  if (hide) await d.press('Control+Shift+2', {hold: 300, label: 'Stop (Ctrl+Shift+2)'});
  else await d.click(stop, {hold: 300, label: 'Stop'});
  return trimAt;
}

/**
 * In the editor Recordly opens after recording: wait for its zoom suggestions and trim off the start
 * if asked (both cut from the video), point out the suggested zoom and play it back.
 *
 * `slow`: play back in slow motion, `slow` times slower, and play that stretch of the video as many
 * times faster, so the playback is seen at its real speed and frame rate on a machine that can't
 * draw it that fast live (see walkthrough/lib/slowmo.mjs).
 * @param {import('../walkthrough/lib/director.mjs').Director} d
 */
export async function finishInEditor(d, {main}, trimAt, {slow} = {}) {
  const zoom = main.getByRole('button', {name: /Auto \(follows cursor\)|Manual focus/}).first();
  const suggested = await d.idle(() => zoom.waitFor({timeout: 8_000}).then(() => true, () => false));
  if (!suggested) {
    // now and then Recordly doesn't suggest them on its own; then ask, as a person would
    await d.click(main.getByRole('button', {name: 'Suggest zooms'}).first(), {hold: 600, show: zoom, label: 'Suggest zooms'});
    await d.idle(() => zoom.waitFor({timeout: 15_000}));
  }
  // Trim the start: playhead past the bar, split there, delete the first part. Housekeeping the
  // viewer needn't watch, so it's cut from the video.
  // (the ruler's labels read 0:00.0 or 0:00, depending on how far the timeline is zoomed)
  if (trimAt != null) await d.idle(async () => {
    const z0 = await d.s.box(main.getByText(/^0:00(\.0)?$/).last());
    const z1 = await d.s.box(main.getByText(/^0:01(\.0)?$/).last());
    const ruler = {x: Math.round(z0.x + (z1.x - z0.x) * trimAt + 1), y: Math.round(z0.y + z0.h / 2)};
    await d.click(ruler, {hold: 500, label: `the ruler at ${trimAt} s`});
    await d.click(main.getByRole('button', {name: /^Split clip/}), {hold: 500, label: 'Split clip at playhead'});
    await d.click(main.getByRole('button', {name: /^Clip 1:/}).first(), {hold: 400, label: 'the first part'});
    await d.click(main.getByRole('button', {name: /^Delete selected/}), {hold: 700, label: 'Delete selected'});
  });

  await d.point(zoom, {hold: 2000, show: zoom, label: 'the suggested zoom', zoom: 2});
  const preview = main.locator('canvas[aria-label=Preview]');
  const PLAY = 2800;
  const after = slow ? () => slowMotion(main, slow, () => d.fast(() => new Promise(r => setTimeout(r, PLAY * slow)), {speed: slow})) : undefined;
  await d.click(main.getByRole('button', {name: 'Play', exact: true}), {hold: PLAY, show: preview, label: 'Play', zoom: 1.6, after});
}
