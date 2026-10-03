// Umami (github.com/umami-software/umami): set it up for a website, from signing in to the first visit.
//
// A tutorial from A to B on the real Umami (built from source, on Postgres): sign in, add the Taskly
// website, copy its tracking code, open Taskly with that code in its page, and see the visit arrive.
// Taskly is the bundled demo page (demo-app/), served here with the tracking code that was copied
// put in its <head>, so the visit is counted by Umami's own tracker.
//
// Needs Umami running (UMAMI_URL, default http://localhost:3100; see the README).
import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
import {routeIcons} from './umami/icons.mjs';
import {login} from './umami/traffic.mjs';

export const name = 'Umami — set up analytics for your website';
export const size = '1440x900';
export const scale = 4 / 3; // 1920×1200: HD, sharp when zoomed
export const aspect = '16:10';
export const lead = 600;
// narration (optional): ElevenLabs, with ELEVENLABS_API_KEY set; this voice unless --voice / ELEVENLABS_VOICE
export const voice = 'Xb7hH8MSUJpSbSDYk0k2';

export const plan = {
  what: 'Umami is privacy-first web analytics: traffic, sources and behaviour, without cookies.',
  audience: 'People who run a website and want to start measuring it.',
  flow: ['Sign in to Umami', 'Add a website: its name and domain', "Open the website's settings and copy the tracking code", 'Put the code on the site and visit it', 'Back in Umami, the visit is there'],
  duration: [20, 40],
  milestones: [{beat: 'Add website', by: 11}, {beat: 'copy the tracking code', by: 29}]
};
export const poster = 'the first visitor';
export const share = 'Setting up Umami for a website: add it, copy the one-line tracking code into your page, and the visits start showing up. No cookies, no banner.';

const BASE = process.env.UMAMI_URL ?? 'http://localhost:3100';
const SITE_PORT = 8090;
export const url = `${BASE}/login`;

let site;
/** Umami with no websites yet; Taskly served with whatever tracking code was copied. */
export async function setup(page) {
  const token = await login(BASE).catch(() => {
    throw new Error(`Umami isn't running at ${BASE} (start it: cd umami && pnpm start)`);
  });
  const h = {authorization: `Bearer ${token}`};
  const sites = await (await fetch(`${BASE}/api/websites?pageSize=100`, {headers: h})).json();
  for (const w of sites.data ?? []) await fetch(`${BASE}/api/websites/${w.id}`, {method: 'DELETE', headers: h});

  let snippet = '';
  const html = readFileSync(new URL('../demo-app/index.html', import.meta.url), 'utf8');
  site = createServer((req, res) => {
    res.setHeader('content-type', 'text/html');
    res.end(html.replace('</head>', `${snippet}\n</head>`));
  }).listen(SITE_PORT);
  await routeIcons(page);
  // the code goes on the site as copied, read off the clipboard
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], {origin: BASE});
  page.takeSnippet = async () => (snippet = await page.evaluate(() => navigator.clipboard.readText()));
}

/** @param {import('../walkthrough/lib/director.mjs').Director} d */
export async function run(d, page) {
  // 1. sign in
  const user = page.locator('input[name=username]');
  await user.waitFor();
  await d.type(user, 'admin', {label: 'Username', caption: 'Sign in to Umami', narrate: "Umami is simple, privacy-friendly web analytics. Let's set it up for a website. First, sign in."});
  await d.type(page.locator('input[name=password]'), 'umami', {label: 'Password'});
  await d.click(page.getByRole('button', {name: 'Login'}), {hold: 1800, show: page.getByRole('button', {name: 'Add website'}), label: 'Login'});

  // 2. add the website
  await d.click(page.getByRole('button', {name: 'Add website'}), {hold: 1100, show: page.getByRole('dialog'), label: 'Add website', caption: 'Click Add website', narrate: 'Click Add website.'});
  const dialog = page.getByRole('dialog');
  await d.type(dialog.locator('input[name=name]'), 'Taskly', {hold: 800, label: 'Name', zoom: 1.6, show: dialog, caption: "Enter a name and your site's domain", narrate: 'Give it a name, and the domain your site lives on.'});
  await d.type(dialog.locator('input[name=domain]'), 'taskly.app', {hold: 900, label: 'Domain', show: dialog});
  await d.click(dialog.getByRole('button', {name: 'Save'}), {hold: 1200, show: page.getByRole('row', {name: /Taskly/}), label: 'Save', caption: 'Save it: your website is now in the list', narrate: "Save, and it's in your list."});

  // 3. its tracking code, in its settings
  await d.click(page.getByRole('link', {name: 'Taskly'}).first(), {hold: 1000, show: page.getByRole('button', {name: 'Edit'}), label: 'Taskly', caption: 'Open the website, then click Edit', narrate: 'Open the website, then click Edit.'});
  await d.click(page.getByRole('button', {name: 'Edit'}).first(), {hold: 900, show: page.getByText('Tracking code', {exact: true}), label: 'Edit'});
  const tracking = page.getByText('Tracking code', {exact: true}).locator('xpath=..');
  await tracking.waitFor();
  const code = tracking.locator('textarea, pre, code').first();
  await d.point(code, {hold: 3000, show: tracking, label: 'the tracking code', zoom: 1.6, caption: 'This is your tracking code', narrate: 'This is your tracking code: one line of script.'});
  const copy = tracking.getByRole('button').last();
  await d.click(copy, {hold: 1200, show: copy, label: 'copy the tracking code', caption: 'Copy it into the <head> of your pages', narrate: 'Copy it into the head of your pages.'});
  await page.takeSnippet();
  const overview = page.url().replace(/\/settings.*$/, '');

  // 4. the code on the site, and a visit
  await d.idle(async () => {
    await page.goto(`http://localhost:${SITE_PORT}/`);
    await page.locator('h2').first().waitFor();
    await d.wait(400);
  }, {keep: 0});
  await d.point(page.locator('h2').first(), {hold: 2500, show: page.locator('main'), label: 'Taskly, with the code in its page', caption: 'Now someone visits your site…', narrate: 'Now, when someone visits your site,'});

  // 5. back in Umami: the visit
  await d.idle(async () => {
    await page.goto(overview);
    await page.getByText('Visitors', {exact: true}).first().waitFor();
    await d.wait(1500);
  }, {keep: 0});
  const visitors = page.getByText('Visitors', {exact: true}).first();
  // its first visit: the row of numbers, Visitors to Views
  const card = name => page.getByText(name, {exact: true}).first().locator('xpath=ancestor::*[2]');
  await d.point(visitors, {hold: 2400, show: [card('Visitors'), card('Views')], label: 'the first visitor', zoom: 1.6, caption: '…and Umami counts the visit', narrate: 'Umami counts the visit. No cookies needed.'});
}

/** Stops Taskly's site (record.mjs calls this whether or not the run worked). */
export async function teardown() {
  site?.close();
}
