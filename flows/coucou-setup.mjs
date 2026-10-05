// Coucou (github.com/lalaee/coucou): set it up to watch your Claude Code sessions. A tutorial from A to
// B, entirely in Coucou's own UI: Coucou is on screen → Claude Code isn't connected yet → Settings →
// Install hooks (the exact diff it will write) → Back up and write → back in the island, connected.
//
// Coucou's real Linux build, built from the repo (windows/, a Tauri 2 app; see the README). On this
// Linux pipeline there's no mac notch and no layer-shell compositor, so the island is a window pinned
// to the TOP of the screen rather than inside a notch — the real 0.1.1 Linux behaviour. Said in the
// report. Everything else is real: the hooks are really written to ~/.claude/settings.json (a clean HOME
// each run, so it always starts unconnected).
import {execFileSync, spawn} from 'node:child_process';
import {mkdirSync, openSync, rmSync} from 'node:fs';
import {join} from 'node:path';

export const name = 'Coucou — connect it to Claude Code';
export const desktop = true;
export const size = '1920x1080';
export const aspect = '16:9';
export const background = '../desktops/coucou/desktop.png';
export const lead = 500;
// narration (optional): ElevenLabs, with ELEVENLABS_API_KEY set; this voice unless --voice / ELEVENLABS_VOICE
export const voice = 'Xb7hH8MSUJpSbSDYk0k2';

export const plan = {
  what: 'Coucou lives at the top of your screen and keeps an eye on your AI coding agent: each session, what it edits, and its permission requests.',
  audience: 'People who run Claude Code and want to watch their sessions at a glance.',
  flow: ['Coucou on screen, with Mochi', "Claude Code isn't connected yet", 'Open Settings', 'Install hooks: the exact diff', 'Back up and write', 'Back in the island: connected'],
  duration: [25, 45],
  milestones: [{beat: 'Install hooks', by: 18}, {beat: 'connected', by: 40}]
};
export const poster = 'connected';
export const share = 'Setting up Coucou: open Settings, install the Claude Code hooks (it shows you the exact change first), and Mochi starts watching your sessions from the top of your screen. Open source.';

const COUCOU = process.env.COUCOU_BIN
  ?? new URL('../../lalaee/coucou/windows/target/release/coucou', import.meta.url).pathname;
const HOOK_HOME = '/tmp/coucou-walkthrough-home';
const XDG = '/tmp/coucou-walkthrough-xdg';

const sleep = ms => new Promise(r => setTimeout(r, ms));

export async function launch({env, desktop, out, width, height}) {
  // a clean HOME: no Coucou hooks yet (the walkthrough installs them)
  rmSync(HOOK_HOME, {recursive: true, force: true});
  mkdirSync(`${HOOK_HOME}/.claude`, {recursive: true});
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


  return {
    island: desktop.window('^Coucou$'),
    makeWindow: t => desktop.window(t),
    findIsland, xd, env: appEnv, out, width, height,
    close: async () => {
      app.kill();
      rmSync(HOOK_HOME, {recursive: true, force: true});
    }
  };
}

/** @param {import('../walkthrough/lib/director.mjs').Director} d */
export async function run(d, ctx) {
  const {island} = ctx;
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
  // The settings window's primary buttons are white pills (dark text on white) that OCR doesn't
  // read reliably, and their exact position shifts with layout. Find them on screen instead: the first
  // band of solid white rows inside a column of the window, below a given point.
  function findPill(s, x0, x1, yFrom, yTo) {
    const w = x1 - x0, h = yTo - yFrom;
    const raw = execFileSync('ffmpeg', ['-v', 'error', '-f', 'x11grab', '-draw_mouse', '0', '-video_size', `${w}x${h}`,
      '-i', `${ctx.env.DISPLAY}+${Number(s.X) + x0},${Number(s.Y) + yFrom}`, '-frames:v', '1', '-pix_fmt', 'gray', '-f', 'rawvideo', '-'], {maxBuffer: 1 << 26});
    let start = -1;
    for (let y = 0; y < h; y++) {
      let white = 0;
      for (let x = 0; x < w; x++) if (raw[y * w + x] > 215) white++;
      if (white > w * 0.6) { if (start < 0) start = y; }
      else if (start >= 0) { if (y - start >= 12) return yFrom + Math.round((start + y) / 2); start = -1; }
    }
    return null;
  }
  // a pointable target at a detected pill
  const pillTarget = (x0, x1, yFrom, yTo, label) => ({toString: () => label, label, clickable: true, resolve: async () => {
    const s = findSettings(); if (!s) return null;
    const y = findPill(s, x0, x1, yFrom, yTo); if (y == null) return null;
    return {x: Number(s.X) + x0 - 10, y: Number(s.Y) + y - 15, w: x1 - x0 + 40, h: 30};
  }});
  // Click a settings button found by findPill (x0..x1 a column inside the pill), WebKitGTK-style:
  // hover into the window first, then two clicks. Retries until `until()` holds.
  async function clickSettingsPill(x0, x1, yFrom, yTo, until) {
    for (let i = 0; i < 6; i++) {
      if (await until()) return;
      const s = findSettings(); if (!s) { await d.wait(500); continue; }
      const y = findPill(s, x0, x1, yFrom, yTo);
      if (y == null) { if (i > 0) return; await d.wait(600); continue; }  // clicked, and the button is gone
      const cx = Number(s.X) + Math.round((x0 + x1) / 2);
      ctx.xd('mousemove', String(Number(s.X) + 280), String(Number(s.Y) + y - 50)); await d.wait(350);
      ctx.xd('mousemove', String(cx), String(Number(s.Y) + y)); await d.wait(350);
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
  await d.point(island.at(110, 70, 120, 120), {hold: 2400, show: island.at(10, 10, 700, 300), label: 'Mochi', zoom: 2.0,
    caption: 'This is Coucou', narrate: 'This is Coucou. It lives at the top of your screen and keeps an eye on your AI coding agent.'});

  // 2. Claude Code isn't connected yet (the focused card says so)
  await d.point(island.at(130, 55, 230, 70), {hold: 2400, show: island.at(60, 40, 340, 110), label: 'not connected', zoom: 2.0,
    caption: "Claude Code isn't connected yet", narrate: "Out of the box, it isn't connected to Claude Code yet."});

  // 3. open Settings via the "Settings…" link (filmed point), then open it reliably: WebKitGTK only
  //    registers the click once the pointer has entered the card (hover), so move onto the card first,
  //    then click the link twice. Wait for the window and give it an ASCII title (its em-dash one is
  //    unmatchable by xdotool).
  await d.idle(() => ensureHome(), {keep: 200});
  await d.point(island.at(326, 103, 70, 16), {hold: 1500, label: 'Settings link', zoom: 2.0,
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
  await d.point(settings.text('Claude Code'), {hold: 1600, show: settings.at(30, 60, 500, 340), label: 'Claude Code section', zoom: 1.5,
    caption: 'Connect Claude Code', narrate: 'and find Claude Code.'});
  await d.point(pillTarget(60, 130, 150, 420, 'Install hooks'), {hold: 1400, show: settings.at(30, 60, 500, 340), label: 'Install hooks', zoom: 1.5,
    caption: 'Install the hooks', narrate: 'Install the hooks.'});
  await d.idle(() => clickSettingsPill(60, 130, 150, 420, () => ocrHas('Cancel')), {keep: 300});

  // the diff: exactly what will change, with a backup
  await d.point(settings.at(30, 150, 500, 230), {hold: 3000, zoom: 1.6, show: settings.at(30, 150, 500, 280), label: 'the diff',
    caption: 'It shows the exact change to settings.json', narrate: 'Coucou shows the exact change it makes, and backs up the old settings.'});

  // 5. apply it (Back up and write sits just left of Cancel)
  await d.point(pillTarget(60, 130, 300, 640, 'Back up and write'), {hold: 1300, show: settings.at(30, 300, 500, 170), label: 'Back up and write', zoom: 1.5,
    caption: 'Back up and write', narrate: 'Back up and write,'});
  await d.idle(() => clickSettingsPill(60, 130, 300, 640, () => ocrHas('Done')), {keep: 300});
  await d.point(settings.at(30, 70, 500, 120), {hold: 2400, zoom: 1.6, show: settings.at(30, 60, 500, 140), label: 'done',
    caption: 'Done — Coucou is hooked in', narrate: "and that's it — Coucou is hooked in."});

  // close Settings, back to the desktop
  await d.idle(async () => {
    const s = findSettings();
    if (s) ctx.xd('windowunmap', s.id);
    islandEsc();
    await d.wait(800);
  }, {keep: 300});

  // 6. back in the island: Claude Code is connected now
  await d.idle(() => ensureHome(), {keep: 300});
  await d.point(island.at(130, 55, 230, 70), {hold: 3200, show: island.at(10, 10, 700, 300), label: 'connected', zoom: 2.0,
    caption: 'Connected: Mochi is watching', narrate: 'Back in the island, it says connected. Your next Claude Code session shows up right here.'});
}
