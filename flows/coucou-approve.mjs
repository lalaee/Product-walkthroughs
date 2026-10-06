// Coucou (github.com/lalaee/coucou): connect it to Claude Code, then approve a permission request
// from the island. Coucou's real interface (its windows/ web frontend, built from the repo and served
// unmodified) running in a browser, with its native side stood in by flows/coucou-web/host.js: the
// hooks aren't really written to ~/.claude/settings.json (the diff shown is the one Coucou shows for an
// empty file), and the Claude Code session is the real hook payloads played in order, not a live
// `claude`. The window chrome around Settings and the desktop are stand-ins too. Say so in the report.
//
// Needs the frontend built: `cd windows && npx vite build` in the Coucou checkout (COUCOU_DIST to point
// elsewhere). Fonts: Coucou asks for the system font (Segoe UI); see the README's Coucou entry.
import {startServer} from './coucou-web/server.mjs';

export const name = 'Coucou — connect it, then approve from the island';
export const size = '1440x900';
export const scale = 4 / 3;
export const aspect = '16:10';
export const lead = 600;
export const voice = 'Xb7hH8MSUJpSbSDYk0k2';

export const plan = {
  what: 'Coucou lives at the top of your screen, shows your Claude Code sessions, and lets you approve their permission requests in one click.',
  audience: 'People who run Claude Code and want to approve it without switching to the terminal.',
  flow: ['Mochi, at the top of the screen', "Claude Code isn't connected yet", 'Settings → Install hooks: the exact diff', 'Back up and write', 'Connected', 'A permission request in the island', 'Allow', 'Claude carries on'],
  duration: [30, 55],
  milestones: [{beat: 'Install hooks', by: 20}, {beat: 'Allow', by: 45}]
};
export const poster = 'permission request';
export const share = 'Coucou: install the Claude Code hooks (it shows you the exact change first), and the next time Claude needs permission, approve it right from the top of your screen.';

const DIST = process.env.COUCOU_DIST ?? new URL('../../lalaee/coucou/windows/dist', import.meta.url).pathname;
let server;
export let url = 'about:blank';
export async function setup(page) {
  server = await startServer({dist: DIST});
  url = server.url; // (record.mjs reads `url` after setup, so the port is known by then)
}
export async function teardown() {
  server?.close();
}

/** @param {import('../walkthrough/lib/director.mjs').Director} d */
export async function run(d, page) {
  const island = page.frameLocator('#island'), settings = page.frameLocator('#settings');
  const top = page.locator('#island-top'), shell = page.locator('#island');
  const COMMAND = 'npm test';
  // what the session does once allowed: the command runs, Claude finishes
  await page.evaluate(cmd => { coucou.onDecision = (id, d) => { if (d === 'allow') setTimeout(() => coucou.finish(cmd, '42 passing'), 700); }; }, COMMAND);

  // 1. Mochi says hello from the top of the screen, then the island opens
  await d.wait(1500);
  await d.point(top, {hold: 1600, show: shell, label: 'Mochi', zoom: 1.6,
    caption: 'This is Coucou', narrate: 'This is Coucou. It sits at the top of your screen and keeps an eye on your Claude Code sessions.'});
  await d.click(top, {hold: 1400, show: island.getByText('GitHub'), label: 'the island'});
  const notInstalled = island.getByText('Hooks not installed');
  await d.point(notInstalled, {hold: 2200, show: notInstalled, label: 'not connected', zoom: 1.8,
    caption: "Claude Code isn't connected yet", narrate: "Out of the box, it isn't connected to Claude Code yet."});

  // 2. Settings → Claude Code → Install hooks
  await d.click(island.getByText('Settings…'), {hold: 1600, show: page.locator('#settings-window'), label: 'Settings',
    caption: 'Open Settings', narrate: 'Open Settings,'});
  const install = settings.getByRole('button', {name: /Install hooks/});
  await d.point(install, {hold: 1200, show: settings.getByText('Claude Code').first(), label: 'Install hooks', zoom: 1.5,
    caption: 'Install the hooks', narrate: 'and install the hooks.'});
  await d.click(install, {hold: 3000, show: settings.locator('.diff'), label: 'the diff', zoom: 1.4,
    caption: 'It shows the exact change to settings.json', narrate: 'Coucou shows the exact change it makes, and backs up your old settings.'});
  await d.click(settings.getByRole('button', {name: 'Back up and write'}), {hold: 2400, show: settings.getByText(/^Done\./), label: 'done', zoom: 1.5,
    caption: 'Back up and write: done', narrate: "Back up and write, and that's it."});
  await d.click(page.getByRole('button', {name: 'Close settings'}), {hold: 900, label: 'close Settings'});
  const connected = island.getByText(/^Connected/);
  await d.point(connected, {hold: 2000, show: connected, label: 'connected', zoom: 1.8,
    caption: 'Connected', narrate: 'The island says connected.'});

  // 3. a Claude Code session needs permission: the request shows up in the island
  await d.idle(async () => {
    await page.evaluate(([cmd]) => coucou.permissionRequest(cmd, 'Run the tests and fix anything that fails'), [COMMAND]);
    await island.getByRole('button', {name: /^Allow/}).waitFor();
    await d.wait(500);
  }, {keep: 400});
  const allow = island.getByRole('button', {name: /^Allow/});
  await d.point(island.getByText('needs permission'), {hold: 2800, show: [island.getByText('needs permission'), allow], label: 'permission request', zoom: 1.6,
    caption: 'Claude asks permission, in the island', narrate: 'Now, when Claude needs to run a command, the request shows up right here.'});

  // 4. approve it, and Claude carries on
  await d.click(allow, {hold: 2600, show: island.getByText(/finished/), label: 'Allow', zoom: 1.6,
    caption: 'Approve it in one click', narrate: 'Click Allow, and Claude carries on, without you switching to the terminal.'});
  await d.point(island.getByText(/finished/), {hold: 2400, show: island.getByText(/finished/), label: 'Claude carries on', zoom: 1.6,
    caption: 'Claude carries on'});
}
