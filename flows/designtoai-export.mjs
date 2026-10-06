// Design to AI (github.com/lalaee/DesigntoAI-Plugin-Cloud): select a Framer component, open the
// plugin, enter a license, Copy prompt. The plugin's real interface (built from the repo by
// flows/designtoai-web/build.mjs, unmodified but for the `framer-plugin` import) in a page standing
// in for the Framer editor: a screenshot of Framer behind it (FRAMER_BACKDROP, with where the
// component sits on it in DESIGNTOAI_LAYOUT; a plain canvas without one), and Framer's plugin API
// answered by flows/designtoai-web/framer-standin.js. The export is real: the plugin fetches
// Framer's public Slideshow component from framerusercontent.com, bundles it in the browser and
// uploads it to the plugin's own storage, and the prompt it copies points at those files.
//
// Stand-ins, to say in the report: the editor around the plugin, the license server (a demo key is
// accepted, so no real license is shown or used), and analytics (blocked, so runs aren't counted).
import {existsSync, readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
import {startServer} from './designtoai-web/server.mjs';

export const name = 'Design to AI — a Framer component to an AI prompt';
export const size = '1440x900';
export const scale = 4 / 3;
export const aspect = '16:10';
export const lead = 600;
export const voice = 'Xb7hH8MSUJpSbSDYk0k2';

export const plan = {
  what: 'Design to AI turns a component on your Framer canvas into a prompt your AI coding tool can build from.',
  audience: 'Framer designers who hand their components to Claude Code, Cursor and the like.',
  flow: ['A component on the canvas', 'Open Design to AI', 'Enter your license', 'Select the component', 'Copy prompt', 'Prompt copied: paste it into Claude Code, Cursor…'],
  duration: [25, 50],
  milestones: [{beat: 'Copy prompt', by: 35}]
};
export const poster = 'prompt copied';
export const share = 'Design to AI: select a component in Framer, click Copy prompt, and paste a ready-to-build prompt into your AI coding tool.';

const HERE = import.meta.dirname;
const BUILT = process.env.DESIGNTOAI_BUILD ?? join(HERE, '../out/designtoai-web');
const SLIDESHOW = 'https://framerusercontent.com/modules/zvkTOpMSuRzRhLzZZIwG/k4brqe4qK7JYm6JdutDJ/SlideShow.js';
const LAYOUT = process.env.DESIGNTOAI_LAYOUT ? JSON.parse(readFileSync(process.env.DESIGNTOAI_LAYOUT, 'utf8')) : {
  component: {rect: {x: 300, y: 200, w: 600, h: 420}},
  plugin: {x: 1060, y: 110}
};
LAYOUT.component.node = {id: 'slideshow', name: 'Slideshow', __class: 'ComponentInstanceNode', insertURL: SLIDESHOW, ...LAYOUT.component.node};
const DEMO_KEY = 'DEMO-4F2A-91C3-7B8E';

let server;
export let url = 'about:blank';
export async function setup(page) {
  if (!existsSync(join(BUILT, 'index.html'))) execFileSync('node', [join(HERE, 'designtoai-web/build.mjs'), process.env.DESIGNTOAI_PLUGIN ?? join(HERE, '../../designtoai-plugin-cloud'), BUILT], {stdio: 'inherit'});
  server = await startServer({plugin: BUILT, backdrop: process.env.FRAMER_BACKDROP, layout: LAYOUT});
  url = server.url;
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], {origin: new URL(url).origin});
  // analytics: answered here, never sent
  await page.route('https://eu.posthog.com/**', r => r.fulfill({status: 200, contentType: 'application/json', body: '{}'}));
  // the license server: any key is active (LemonSqueezy's /activate and /validate response)
  await page.route('https://api.lemonsqueezy.com/v1/licenses/**', r => {
    const now = new Date().toISOString(), key = JSON.parse(r.request().postData() ?? '{}').license_key;
    r.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify({
      activated: true, valid: true, error: null,
      license_key: {id: 1, status: 'active', key, activation_limit: 5, activation_usage: 1, created_at: now, expires_at: null, test_mode: false},
      instance: {id: 'demo', name: 'Framer', created_at: now},
      meta: {store_id: 1, order_id: 1, order_item_id: 1, product_id: 1, product_name: 'Design to AI', variant_id: 1, variant_name: 'Monthly',
        customer_id: 1, customer_name: 'Demo', customer_email: 'demo@example.com'}
    })});
  });
  // a returning user: the "How did you find Design to AI?" question was answered on an earlier run
  await page.addInitScript(() => { try { localStorage.setItem('design_to_ai_attribution_completed', 'true'); } catch {} });
}
export async function teardown() {
  server?.close();
}

/** The plugin's screens slide sideways inside its 320px window; this waits until `text` is the one in view. */
async function onScreen(frame, text, timeout = 120_000) {
  const t0 = Date.now();
  for (;;) {
    const shown = await frame.getByText(text).evaluateAll(els => els.map(e => e.getBoundingClientRect())
      .some(r => r.width > 0 && r.x >= 0 && r.right <= innerWidth + 1));
    if (shown) return;
    if (Date.now() - t0 > timeout) throw new Error(`"${text}" never came into view`);
    await new Promise(r => setTimeout(r, 200));
  }
}

/** @param {import('../walkthrough/lib/director.mjs').Director} d */
export async function run(d, page) {
  await page.waitForFunction(() => window.hostReady);
  const plugin = page.frameLocator('#plugin'), component = page.locator('#component'), win = page.locator('#plugin-window');
  const inView = (text, opts) => plugin.getByText(text, opts).locator('visible=true');

  // 1. a component on the canvas
  await d.wait(600);
  await d.point(component, {hold: 2000, show: component, label: 'a component',
    caption: 'A component on your Framer canvas', narrate: 'Here is a component on a Framer canvas, a Slideshow.'});

  // 2. Design to AI opens (from Framer's Plugins menu)
  await d.idle(async () => { await page.evaluate(() => host.openPlugin()); await onScreen(plugin, 'Already have a license?'); }, {keep: 300});
  const title = inView(/^Export Framer components/);
  await d.point(title, {hold: 2200, show: win, label: 'Design to AI', zoom: 1.5,
    caption: 'Open Design to AI', narrate: 'Open the Design to AI plugin.'});

  // 3. the license
  const key = plugin.getByPlaceholder('Enter your license key...');
  await d.type(key, DEMO_KEY, {hold: 500, label: 'license key', zoom: 1.6,
    caption: 'Enter your license key', narrate: 'Enter your license key,'});
  await d.press('Enter', {hold: 1600, show: win, label: 'activate'});
  await onScreen(plugin, /Select a component|Component selected/, 20_000);

  // 4. select the component: the plugin sees it
  await d.click(component, {hold: 2000, show: [component, win], label: 'select it',
    caption: 'Select the component', narrate: 'select the component, and the plugin picks it up.'});
  await onScreen(plugin, /Component selected/, 10_000);

  // 5. Copy prompt: it bundles the component (cut while it works), the prompt lands on the clipboard
  const copy = plugin.getByRole('button', {name: 'Copy prompt'});
  await d.click(copy, {hold: 1500, show: win, label: 'Copy prompt', zoom: 1.4,
    caption: 'Copy prompt', narrate: 'Click Copy prompt. It bundles the component and writes the prompt.'});
  await d.idle(() => onScreen(plugin, 'Prompt copied!'), {keep: 1200});
  const done = inView('Prompt copied!');
  await d.point(done, {hold: 3200, show: win, label: 'prompt copied', zoom: 1.5,
    caption: 'Prompt copied: paste it into your AI tool', narrate: 'Done. The prompt is on your clipboard, ready to paste into your AI coding tool.'});
}
