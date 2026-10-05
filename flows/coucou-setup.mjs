// Coucou (github.com/lalaee/coucou): set it up to watch your AI coding agent and approve permissions
// from the notch. A tutorial from A to B: Coucou is on screen → connect Claude Code (install the
// hooks, with the exact diff shown) → run a Claude Code session in a terminal → a permission request
// appears in the island → approve it with one click, without leaving your terminal.
//
// Coucou's real Linux build, built from the repo (windows/, a Tauri 2 app; see the README). On this
// Linux pipeline there's no mac notch and no layer-shell compositor, so the island is a window pinned
// to the TOP of the screen rather than inside a notch — the real 0.1.1 Linux behaviour. Said in the
// report. Everything else is real: the hooks are really written to ~/.claude/settings.json, and the
// permission card comes from a real `claude` session's own PermissionRequest through Coucou's relay.
import {execFileSync, spawn} from 'node:child_process';
import {cpSync, mkdirSync, openSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {openWebWindow} from '../walkthrough/lib/webwindow.mjs';
import {startTerminal} from '../walkthrough/lib/terminal.mjs';

export const name = 'Coucou — watch your AI agent from the notch';
export const desktop = true;
export const size = '1920x1080';
export const aspect = '16:9';
export const background = '../desktops/coucou/desktop.png';
export const lead = 500;
// narration (optional): ElevenLabs, with ELEVENLABS_API_KEY set; this voice unless --voice / ELEVENLABS_VOICE
export const voice = 'Xb7hH8MSUJpSbSDYk0k2';

export const plan = {
  what: 'Coucou lives at the top of your screen and keeps an eye on your AI coding agent: it shows each session and lets you approve permissions without leaving your terminal.',
  audience: 'People who run Claude Code (or Cursor, Codex, Gemini) and want to watch and approve sessions at a glance.',
  flow: ['Coucou on screen, with Mochi', "Claude Code isn't connected yet", 'Open Settings', 'Install the hooks: the exact diff', 'Back up and write', 'Run a Claude Code session', 'A permission request in the island', 'Approve it from the notch'],
  duration: [30, 55],
  milestones: [{beat: 'Install hooks', by: 22}, {beat: 'Approve', by: 48}]
};
export const poster = 'approve from the notch';
export const share = 'Coucou watches your Claude Code sessions from the top of your screen — and lets you approve permissions with one click, without leaving your terminal. Open source.';

const COUCOU = process.env.COUCOU_BIN
  ?? new URL('../../lalaee/coucou/windows/target/release/coucou', import.meta.url).pathname;
const HOOK_HOME = '/tmp/coucou-walkthrough-home';
const XDG = '/tmp/coucou-walkthrough-xdg';

const sleep = ms => new Promise(r => setTimeout(r, ms));

export async function launch({env, desktop, out, width, height, recordly}) {
  // a clean HOME: no Coucou hooks yet (the walkthrough installs them), but Claude Code's own
  // credentials copied in so a real session can sign in
  rmSync(HOOK_HOME, {recursive: true, force: true});
  mkdirSync(`${HOOK_HOME}/.claude`, {recursive: true});
  try { cpSync('/root/.claude.json', `${HOOK_HOME}/.claude.json`); } catch {}
  mkdirSync(XDG, {recursive: true});
  execFileSync('chmod', ['700', XDG]);

  // WebKitGTK under Xvfb: software GL, no compositing mode; a real dbus session so the app is happy
  const appEnv = {...env, HOME: HOOK_HOME, XDG_RUNTIME_DIR: XDG,
    WEBKIT_DISABLE_COMPOSITING_MODE: '1', LIBGL_ALWAYS_SOFTWARE: '1', GDK_BACKEND: 'x11'};
  const logFd = openSync(join(out, 'coucou-app.log'), 'a');
  const app = spawn('dbus-run-session', ['--', COUCOU], {env: appEnv, stdio: ['ignore', logFd, logFd]});

  const xd = (...a) => execFileSync('xdotool', a.map(String), {env}).toString().trim();
  // The island window (the big "Coucou" one) can be recreated, so always look it up fresh.
  const findIsland = () => {
    for (const id of xd('search', '--name', '^Coucou$').split('\n').filter(Boolean)) {
      const g = Object.fromEntries(xd('getwindowgeometry', '--shell', id).split('\n').map(l => l.split('=')));
      if (Number(g.WIDTH) > 100) return id;
    }
    return null;
  };
  let island;
  for (let i = 0; i < 60 && !island; i++) { await sleep(500); island = findIsland(); }
  if (!island) throw new Error('Coucou island window never appeared');
  await sleep(1500);
  xd('key', '--window', island, 'Escape'); // collapse to the idle sliver
  await sleep(800);

  // a terminal on the desktop, where a real Claude Code session will run (same HOME/XDG so its hooks
  // reach Coucou, same env so it signs in and reaches the network through the proxy)
  const term = await startTerminal({cwd: HOOK_HOME, env: appEnv, title: 'Terminal', fontSize: 15});
  const tw = {x: Math.round(width * 0.30), y: Math.round(height * 0.34), w: Math.round(width * 0.56), h: Math.round(height * 0.52)};
  const termWindow = await openWebWindow({url: term.url, x: tw.x, y: tw.y, width: tw.w, height: tw.h, env, recordly});
  desktop.register(termWindow.page, termWindow.origin);

  return {
    island: desktop.window('^Coucou$'),
    makeWindow: t => desktop.window(t),
    findIsland, xd, env: appEnv,
    term, termPage: termWindow.page, termWindow, width, height,
    close: async () => {
      try { await termWindow.close(); } catch {}
      term.close();
      app.kill();
      rmSync(HOOK_HOME, {recursive: true, force: true});
    }
  };
}

/** Polls the island window's height; it grows from the 6 px sliver when it opens or reveals a card. */
async function islandHeight(ctx) {
  const id = ctx.findIsland();
  if (!id) return 0;
  const g = Object.fromEntries(ctx.xd('getwindowgeometry', '--shell', id).split('\n').map(l => l.split('=')));
  return Number(g.HEIGHT);
}

/** @param {import('../walkthrough/lib/director.mjs').Director} d */
export async function run(d, ctx) {
  const {island, term} = ctx;
  // the island is a small FSM: hidden → petit (hover) → home (click). Home auto-collapses 15 s after
  // the pointer leaves (a pending permission card keeps it open). Its open window is 720×320 at x=600;
  // filmed spots are window-relative (island.at), buttons by their text (OCR).
  const geom = () => { const id = ctx.findIsland() ?? ''; return Object.fromEntries(ctx.xd('getwindowgeometry', '--shell', id).split('\n').map(l => l.split('='))); };
  const islandEsc = () => { const id = ctx.findIsland(); if (id) ctx.xd('key', '--window', id, 'Escape'); };
  const onHome = async () => !!(await island.text('GitHub').resolve().catch(() => null));
  // The settings window's title has an em-dash, which xdotool can't match (UTF8→ASCII fails). Find it
  // by class + size (a "coucou" window ~560 wide, not the 720-wide island), and give it an ASCII title
  // so the pipeline's name-based OCR targeting works.
  const findSettings = () => {
    for (const id of ctx.xd('search', '--class', 'coucou').split('\n').filter(Boolean)) {
      const g = Object.fromEntries(ctx.xd('getwindowgeometry', '--shell', id).split('\n').map(l => l.split('=')));
      if (Number(g.WIDTH) > 400 && Number(g.WIDTH) < 660 && Number(g.HEIGHT) > 400) return {id, ...g};
    }
    return null;
  };
  const settings = ctx.makeWindow('CoucouSettings');
  const ocrHas = async w => !!(await settings.text(w).resolve().catch(() => null));
  // Click a settings button at a fixed window-relative spot. The primary buttons are white-on-light
  // (OCR can't read them), so they're positioned by offset; WebKitGTK needs the pointer to enter the
  // window (hover) before the click lands, and two clicks to register. Retries until `until()` holds.
  async function clickSettingsBtn(rx, ry, until) {
    for (let i = 0; i < 6; i++) {
      if (await until()) return;
      const s = findSettings(); if (!s) { await d.wait(500); continue; }
      ctx.xd('mousemove', String(Number(s.X) + 220), String(Number(s.Y) + ry - 40)); await d.wait(350);
      ctx.xd('mousemove', String(Number(s.X) + rx), String(Number(s.Y) + ry)); await d.wait(350);
      ctx.xd('click', '--repeat', '2', '--delay', '200', '1'); await d.wait(1400);
    }
  }
  // Open the HOME dashboard (not the launch greeting, and not a poke of Mochi): clear any state with
  // Escape, hover the top edge to reveal the petit strip, then click the strip to expand to home.
  async function ensureHome() {
    for (let i = 0; i < 6; i++) {
      if (await onHome()) return;
      islandEsc(); await d.wait(500);
      ctx.xd('mousemove', '960', '3'); await d.wait(800);           // → petit strip
      const g = geom();
      const cx = Math.round(Number(g.X) + Number(g.WIDTH) / 2);
      ctx.xd('mousemove', String(cx), '16'); await d.wait(300);
      ctx.xd('click', '1'); await d.wait(1100);                     // petit → home
    }
  }

  // 1. the island is on screen: Mochi, and the integration pills
  await d.idle(() => ensureHome(), {keep: 300});
  await d.point(island.at(110, 70, 120, 120), {hold: 2400, show: island.at(10, 10, 700, 300), label: 'Mochi', zoom: 1.3,
    caption: 'This is Coucou', narrate: 'This is Coucou. It lives at the top of your screen and keeps an eye on your AI coding agent.'});

  // 2. Claude Code isn't connected yet (the focused card says so)
  await d.point(island.at(130, 55, 230, 70), {hold: 2400, show: island.at(60, 40, 340, 110), label: 'not connected', zoom: 1.4,
    caption: "Claude Code isn't connected yet", narrate: "Out of the box, it isn't connected to Claude Code yet."});

  // 3. open Settings via the "Settings…" link (filmed point), then open it reliably: WebKitGTK only
  //    registers the click once the pointer has entered the card (hover), so move onto the card first,
  //    then click the link twice. Wait for the window and give it an ASCII title (its em-dash one is
  //    unmatchable by xdotool).
  await d.idle(() => ensureHome(), {keep: 200});
  await d.point(island.at(326, 103, 70, 16), {hold: 1500, label: 'Settings link',
    caption: 'Open Settings', narrate: 'Open Settings,'});
  await d.idle(async () => {
    for (let i = 0; i < 6 && !findSettings(); i++) {
      await ensureHome();
      const g = geom(), bx = Number(g.X);
      ctx.xd('mousemove', String(bx + 300), '90'); await d.wait(400);   // enter the card (hover)
      ctx.xd('mousemove', String(bx + 326), '103'); await d.wait(400);  // onto the Settings… link
      ctx.xd('click', '--repeat', '2', '--delay', '200', '1'); await d.wait(1400);
    }
    const s = findSettings();
    if (s) { ctx.xd('set_window', '--name', 'CoucouSettings', s.id); ctx.xd('windowraise', s.id); }
    await d.wait(400);
  }, {keep: 300});

  // 4. the Claude Code section, and the Install hooks button (positioned ~75 px below the Relay label;
  //    white-on-light, so OCR can't see it — placed by offset)
  await d.point(settings.text('Claude Code'), {hold: 1600, show: settings.at(30, 60, 500, 340), label: 'Claude Code section',
    caption: 'Connect Claude Code', narrate: 'and find Claude Code.'});
  await d.point(settings.at(103, 231, 130, 32), {hold: 1400, show: settings.at(30, 60, 500, 340), label: 'Install hooks',
    caption: 'Install the hooks', narrate: 'Install the hooks.'});
  await d.idle(() => clickSettingsBtn(103, 231, () => ocrHas('Cancel')), {keep: 300});

  // the diff: exactly what will change, with a backup
  await d.point(settings.at(30, 150, 500, 230), {hold: 3000, zoom: 1.2, show: settings.at(30, 150, 500, 280), label: 'the diff',
    caption: 'It shows the exact change to settings.json', narrate: 'Coucou shows the exact change it makes, and backs up the old settings.'});

  // 5. apply it (Back up and write sits just left of Cancel)
  await d.point(settings.at(110, 444, 120, 30), {hold: 1300, show: settings.at(30, 300, 500, 170), label: 'Back up and write',
    caption: 'Back up and write', narrate: 'Back up and write,'});
  await d.idle(() => clickSettingsBtn(110, 444, () => ocrHas('Done')), {keep: 300});
  await d.point(settings.at(30, 70, 500, 120), {hold: 2400, zoom: 1.2, show: settings.at(30, 60, 500, 140), label: 'done',
    caption: 'Done — Coucou is hooked in', narrate: "and that's it — Coucou is hooked in."});

  // close Settings, back to the desktop and the terminal
  await d.idle(async () => {
    const s = findSettings();
    if (s) ctx.xd('windowunmap', s.id);
    islandEsc();
    await d.wait(600);
  }, {keep: 300});

  // 6. run a real Claude Code session in the terminal (-p: non-interactive, so no first-run prompts;
  //    the task needs one shell command, which fires a PermissionRequest hook → Coucou's card)
  await d.point(ctx.termPage.locator('body'), {hold: 1200, show: ctx.termPage.locator('body'), label: 'the terminal',
    caption: 'Now start a Claude Code session', narrate: 'Now, in your terminal, start a Claude Code session.'});
  await d.idle(async () => {
    term.pty.write('claude -p "Run this command: echo hello > notes.txt"\r');
    // wait until Claude asks to run it — the island reveals (a badge on Mochi, then grows tall)
    const until = Date.now() + 90_000;
    while (Date.now() < until && await islandHeight(ctx) < 200) await d.wait(500);
    // the badge isn't the full card: click the strip (Mochi) to focus the request and show Deny/Allow
    const g = geom();
    ctx.xd('mousemove', String(Number(g.X) + 255), '16'); await d.wait(300);
    ctx.xd('click', '1'); await d.wait(1300);
  }, {keep: 400});

  // 7. the permission request, in the island (the full Deny/Allow card)
  await d.point(island.at(60, 40, 600, 120), {hold: 2600, show: island.at(10, 10, 700, 300), label: 'permission request', zoom: 1.3,
    caption: 'The request shows up in the island', narrate: 'When Claude needs to run a command, the request shows up right here.'});

  // 8. approve it — one click, no terminal round-trip. The Deny/Allow buttons are white-on-light
  //    (OCR can't read them): Allow sits at window-rel ~(302,120); WebKitGTK wants a hover then click.
  await d.point(island.at(302, 120, 70, 26), {hold: 1400, label: 'Allow',
    caption: 'Approve it from the notch', narrate: 'Click Allow,'});
  await d.idle(async () => {
    const g = geom(), bx = Number(g.X), by = Number(g.Y);
    ctx.xd('mousemove', String(bx + 300), String(by + 60)); await d.wait(300);
    ctx.xd('mousemove', String(bx + 302), String(by + 120)); await d.wait(300);
    ctx.xd('click', '--repeat', '2', '--delay', '200', '1');
    // let Claude run the approved command and the island settle
    await d.wait(3500);
  }, {keep: 300});

  // 9. the result: Claude ran the command, back in the terminal
  await d.point(ctx.termPage.locator('body'), {hold: 3000, show: ctx.termPage.locator('body'), label: 'done', zoom: 1.1,
    caption: 'Claude carries on — no terminal round-trip', narrate: 'and Claude carries on — without you leaving what you are doing.'});
}
