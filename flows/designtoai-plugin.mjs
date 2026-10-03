// Design to AI (github.com/lalaee/DesigntoAI-Plugin-Cloud): a Framer plugin that turns a selected
// canvas component into a self-contained prompt for an AI coding tool. The walkthrough: a component
// on the Framer canvas → select it → open the plugin → enter a license → Copy prompt → paste it into
// Claude Code in a terminal, where Claude builds the component for real.
//
// This is a DESKTOP flow: Framer runs in a real browser window, and a terminal window sits beside it
// for the ending. It needs a normal network — Framer's editor opens a WebSocket, which the Claude
// Code cloud environment's proxy drops ("Connecting… Editing is disabled"). Run it locally; see
// videos/designtoai-plugin/LOCAL-RUN.md.
//
// Config is through env vars so nothing is hard-coded into a checkout:
//   FRAMER_PROJECT     the project URL (…/projects/Aurel-copy-…?node=…)
//   FRAMER_COOKIES     a Netscape cookies.txt exported from a signed-in Framer session
//   PLUGIN_DEV_URL     where `npm run dev` serves the plugin (default https://localhost:5173)
//   PLUGIN_REPO        the plugin checkout, so Claude Code runs in it (default ../designtoai-plugin-cloud)
//   DESIGNTOAI_LICENSE the license key to type (read here, never printed or committed)
//
// NOTE: two steps touch Framer's own UI, whose DOM is obfuscated and only loads on a real network.
// They're marked «CONFIRM LOCALLY» — open the project once (LOCAL-RUN.md step 5) and adjust the
// locator to what you see. Everything inside the plugin panel and the terminal is from real source
// and should work as written.
import {readFileSync} from 'node:fs';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright-core';
import {openWebWindow} from '../walkthrough/lib/webwindow.mjs';
import {startTerminal} from '../walkthrough/lib/terminal.mjs';

export const name = 'Design to AI — a Framer component into Claude Code';
export const desktop = true;
export const size = '1920x1080';
export const aspect = '16:9';
export const scale = 4 / 3; // HD with room to zoom
export const lead = 500;
// narration (optional): ElevenLabs, with ELEVENLABS_API_KEY set; this voice unless --voice / ELEVENLABS_VOICE
export const voice = 'Xb7hH8MSUJpSbSDYk0k2';

export const plan = {
  what: 'Design to AI is a Framer plugin: select a component on your canvas and it writes a self-contained prompt that an AI coding tool can build from.',
  audience: 'Framer users who build the rest of their product with an AI coding tool.',
  flow: ['A component on the Framer canvas', 'Select it', 'Open the Design to AI plugin', 'Enter your license', 'Copy prompt', 'Paste it into Claude Code', 'Claude starts building the component'],
  duration: [25, 50],
  milestones: [{beat: 'Copy prompt', by: 24}, {beat: 'Claude builds', by: 40}]
};
export const poster = 'Claude builds';
export const share = 'Design to AI: select a component in Framer, Copy prompt, paste into Claude Code, and your AI editor builds it — dependencies, files and all.';

const FRAMER_PROJECT = process.env.FRAMER_PROJECT
  ?? 'https://framer.com/projects/Aurel-copy--HlcEhT7ZoRFPQ7heveT0-dwiQb?node=augiA20Il';
const PLUGIN_DEV_URL = process.env.PLUGIN_DEV_URL ?? 'https://localhost:5173';
const PLUGIN_REPO = process.env.PLUGIN_REPO
  ?? fileURLToPath(new URL('../../designtoai-plugin-cloud', import.meta.url));
const LICENSE = process.env.DESIGNTOAI_LICENSE ?? '';

const TASKBAR = 48;

/** Parse a Netscape cookies.txt into Playwright cookie objects (incl. #HttpOnly_ lines). */
function parseCookies(path) {
  const out = [];
  for (let line of readFileSync(path, 'utf8').split('\n')) {
    const httpOnly = line.startsWith('#HttpOnly_');
    if (httpOnly) line = line.slice('#HttpOnly_'.length);
    if (!line || line.startsWith('#')) continue;
    const [domain, , cookPath, secure, expires, nameField, ...rest] = line.split('\t');
    if (!nameField) continue;
    out.push({
      name: nameField, value: rest.join('\t'),
      domain, path: cookPath || '/',
      expires: Number(expires) || -1,
      httpOnly, secure: secure === 'TRUE',
      sameSite: 'Lax'
    });
  }
  return out;
}

export async function launch({env, desktop, out, width, height, scale, recordly}) {
  if (!LICENSE) throw new Error('Set DESIGNTOAI_LICENSE to your license key.');
  if (!process.env.FRAMER_COOKIES) throw new Error('Set FRAMER_COOKIES to a signed-in Framer cookies.txt (see LOCAL-RUN.md step 4).');

  // Framer in a maximised browser window (leaving the taskbar visible for the desktop look).
  const win = {x: 0, y: 0, w: width, h: height - TASKBAR};
  const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'framer-')), {
    executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    headless: false,
    viewport: null,
    // accept the plugin dev server's self-signed cert; no warning bars across the window
    ignoreHTTPSErrors: true,
    args: [`--window-position=${win.x},${win.y}`, `--window-size=${win.w},${win.h}`,
      '--test-type', '--no-first-run', '--disable-infobars', '--hide-crash-restore-bubble',
      `--force-device-scale-factor=${scale}`],
    env: {...env, GOOGLE_API_KEY: 'no', GOOGLE_DEFAULT_CLIENT_ID: 'no', GOOGLE_DEFAULT_CLIENT_SECRET: 'no'}
  });
  await context.addCookies(parseCookies(process.env.FRAMER_COOKIES));

  const page = context.pages()[0] ?? (await context.waitForEvent('page'));
  await page.goto(FRAMER_PROJECT, {waitUntil: 'domcontentloaded'});
  // the editor is up once the canvas is interactive (not the "Connecting…" state)
  await page.getByText(/Connecting/).waitFor({state: 'hidden', timeout: 120_000}).catch(() => {});
  await page.waitForTimeout(3000);
  desktop.register(page, async () => ({x: 0, y: 0})); // the window is at the top-left origin

  // The terminal, where Claude Code runs — in the plugin repo, so Claude builds into the real
  // project. Opened as a frameless window on the right; placed later by run() when we switch to it.
  const term = await startTerminal({cwd: PLUGIN_REPO, env, title: 'Terminal — Claude Code', fontSize: 14});
  const termWin = {x: Math.round(width * 0.30), y: Math.round(height * 0.10),
    w: Math.round(width * 0.62), h: Math.round((height - TASKBAR) * 0.74)};
  const termWindow = await openWebWindow({url: term.url, ...{x: termWin.x, y: termWin.y, width: termWin.w, height: termWin.h}, env, recordly});
  desktop.register(termWindow.page, termWindow.origin);

  return {
    page, term, termWindow, width, height,
    close: async () => {
      termWindow.close();
      term.close();
      await context.close();
    }
  };
}

/** The plugin UI runs in an iframe (the dev server); target it through a frame locator. */
const plugin = page => page.frameLocator(`iframe[src*="${new URL(PLUGIN_DEV_URL).host}"]`);

/** @param {import('../walkthrough/lib/director.mjs').Director} d */
export async function run(d, ctx) {
  const {page, term} = ctx;
  const ui = plugin(page);

  // 1. the component on the canvas
  // «CONFIRM LOCALLY» — how the Hero Container reads in Framer's layers/canvas. Best guess: the
  // layer row by its name. Replace with what you see (a canvas node, or a layers-panel row).
  const heroLayer = page.getByText('Hero Container', {exact: true}).first();
  await heroLayer.waitFor({timeout: 30_000});
  await d.point(heroLayer, {hold: 2200, show: heroLayer, label: 'a component in Framer',
    caption: 'A component on your Framer canvas',
    narrate: 'This is a component on your Framer canvas: the Hero Container.'});

  // 2. select it
  await d.click(heroLayer, {hold: 1200, show: heroLayer, label: 'select the component',
    caption: 'Select the component', narrate: 'Select it.'});

  // 3. open the Design to AI plugin
  // «CONFIRM LOCALLY» — Framer's Plugins → Development → Open Development Plugin path. Replace the
  // two clicks below with the real menu items (and the dev-plugin picker) once you can see them.
  await d.click(page.getByRole('button', {name: /Plugins/}), {hold: 900, show: page.locator('body'),
    label: 'Plugins menu', caption: 'Open the Design to AI plugin', narrate: 'Open the Design to AI plugin.'});
  await d.click(page.getByText(/Design to AI/).first(), {hold: 1600, show: ui.locator('body'),
    label: 'Design to AI'});

  // 4. the license (first run shows the license prompt; if already activated, this step is a no-op —
  //    drop it, or deactivate first, when re-recording)
  const keyField = ui.getByPlaceholder('Enter your license key...');
  await keyField.waitFor({timeout: 20_000});
  await d.type(keyField, LICENSE, {hold: 700, show: ui.locator('body'), zoom: 1.4,
    label: 'enter the license', caption: 'Enter your license key',
    narrate: 'Enter your license key,'});
  await d.click(ui.getByRole('button', {name: 'Activate license'}), {hold: 1800,
    show: ui.getByText(/Component selected/), label: 'Activate',
    caption: 'Activate', narrate: 'and activate it.'});

  // 5. Copy prompt
  const copyBtn = ui.getByRole('button', {name: 'Copy prompt'});
  await copyBtn.waitFor({timeout: 20_000});
  await d.click(copyBtn, {hold: 2000, show: [ui.getByText(/Component selected/), copyBtn],
    label: 'Copy prompt', caption: 'Copy prompt — a ready-to-paste AI prompt',
    narrate: 'Click Copy prompt. That copies a self-contained prompt for your AI editor.'});

  // the prompt the plugin put on the clipboard — what we'll paste into Claude Code
  const prompt = await page.evaluate(() => navigator.clipboard.readText()).catch(() => '');

  // 6. the terminal: start Claude Code, paste the prompt, send it
  // start Claude in the plugin repo (cut the startup into idle time)
  await d.idle(async () => {
    term.pty.write('claude\n');
    await waitFor(() => /Welcome to Claude Code|>\s*$/.test(term.output()), 20_000);
    await d.wait(600);
  }, {keep: 400});
  await d.point(ctx.termWindow.page.locator('body'), {hold: 1800, show: ctx.termWindow.page.locator('body'),
    label: 'Claude Code', caption: 'In your terminal, open Claude Code',
    narrate: "Here's Claude Code in your terminal."});

  // paste the prompt (bracketed paste, so it lands as one block like a real paste), then show it
  await d.idle(async () => {
    if (prompt) term.pty.write('\x1b[200~' + prompt + '\x1b[201~');
    await d.wait(500);
  }, {keep: 300});
  await d.point(ctx.termWindow.page.locator('body'), {hold: 2000, show: ctx.termWindow.page.locator('body'),
    label: 'paste the prompt', caption: 'Paste the prompt', narrate: 'Paste the prompt,'});

  // send it — Claude starts working
  await d.idle(async () => {
    term.pty.write('\r');
    await waitFor(() => /esc to interrupt|Building|Running|⏺|●/.test(term.output()), 30_000);
    await d.wait(800);
  }, {keep: 400});
  await d.point(ctx.termWindow.page.locator('body'), {hold: 3200, zoom: 1.2,
    show: ctx.termWindow.page.locator('body'), label: 'Claude builds',
    caption: 'Claude Code builds the component', narrate: 'and Claude Code builds the component for you.'});
}

/** Poll until cond() is true or it times out (for a terminal prompt/answer). */
function waitFor(cond, timeout) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const i = setInterval(() => {
      if (cond()) { clearInterval(i); resolve(); }
      else if (Date.now() - t0 > timeout) { clearInterval(i); reject(new Error('waitFor timed out')); }
    }, 100);
  });
}
