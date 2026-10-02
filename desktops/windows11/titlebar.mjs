// A Windows 11 title bar for an app window that has none of its own (the desktop's window manager
// draws no decorations): rendered as an image (icon, title, minimise / maximise / close in the
// light Mica style) and shown in a borderless window just above the app's (feh).
import {execFileSync, spawn} from 'node:child_process';
import {mkdtempSync, readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {extname, join} from 'node:path';
import {chromium} from 'playwright-core';

export const TITLE_BAR = 32;

/** Shows a title bar at (x, y), `width` wide. Returns the window's process (kill it to remove it). */
export async function showTitleBar({env, title, icon, x, y, width, scale = 1}) {
  const png = join(mkdtempSync(join(tmpdir(), 'titlebar-')), 'bar.png');
  const iconUrl = icon ? `data:image/${extname(icon).slice(1)};base64,${readFileSync(icon).toString('base64')}` : null;
  const glyph = d => `<span class="b"><svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="#1a1a1a" stroke-width="1">${d}</svg></span>`;
  const browser = await chromium.launch({executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
  const page = await browser.newPage({viewport: {width, height: TITLE_BAR}, deviceScaleFactor: scale});
  await page.setContent(`<style>
    body{margin:0;height:${TITLE_BAR}px;display:flex;align-items:center;background:#f3f3f3;border:1px solid #c8c8cc;border-bottom:1px solid #e5e5e5;box-sizing:border-box;font:12px "Segoe UI Variable","Segoe UI",Inter,"Noto Sans",system-ui,sans-serif;color:#1a1a1a}
    img{width:16px;height:16px;margin:0 10px 0 12px} .t{flex:1} .b{width:46px;height:${TITLE_BAR}px;display:grid;place-items:center}
  </style>${iconUrl ? `<img src="${iconUrl}">` : '<span style="width:12px"></span>'}<span class="t">${title}</span>${glyph('<path d="M0 5.5h10"/>')}${glyph('<rect x=".5" y=".5" width="9" height="9" rx="1.5"/>')}${glyph('<path d="M.5.5l9 9M9.5.5l-9 9"/>')}`);
  await page.screenshot({path: png});
  await browser.close();
  const s = n => Math.round(n * scale);
  const name = `${title} title bar ${process.pid}`;
  const proc = spawn('feh', ['--borderless', '--no-menus', '--title', name, '--geometry', `${s(width)}x${s(TITLE_BAR)}+${s(x)}+${s(y)}`, png], {env, stdio: 'ignore'});
  // The window manager may offset a window by its border: nudge the bar until its edges are exactly
  // where they belong, flush with the app's window.
  const xd = (...a) => execFileSync('xdotool', a.map(String), {env}).toString().trim();
  let id = null;
  for (let i = 0; i < 30 && !id; i++) {
    try {
      id = xd('search', '--name', `^${name}$`).split('\n')[0];
    } catch {
      await new Promise(r => setTimeout(r, 100));
    }
  }
  if (!id) throw new Error("the title bar's window didn't appear");
  let want = {x: s(x), y: s(y)};
  for (let i = 0; i < 10; i++) {
    const g = Object.fromEntries(xd('getwindowgeometry', '--shell', id).split('\n').map(l => l.split('=')).map(([k, v]) => [k, Number(v)]));
    if (g.X === s(x) && g.Y === s(y)) break;
    want = {x: want.x + (s(x) - g.X), y: want.y + (s(y) - g.Y)};
    xd('windowmove', id, want.x, want.y);
    await new Promise(r => setTimeout(r, 150));
  }
  return proc;
}

/**
 * Where a window is actually painted along one row of the screen: its first and last light pixels
 * between x0 and x1 (for a light app on a dark desktop). An app can paint a pixel or two inside the
 * frame the window manager reports, so the title bar is fitted to what's on screen.
 */
export function paintedEdges({env, y, x0, x1, threshold = 200, outline = 1}) {
  const w = x1 - x0;
  const row = execFileSync('ffmpeg', ['-v', 'error', '-f', 'x11grab', '-draw_mouse', '0', '-video_size', `${w}x1`, '-i', `${env.DISPLAY}+${x0},${y}`, '-frames:v', '1', '-vf', 'format=gray', '-f', 'rawvideo', '-'], {env});
  let a = -1, b = -1;
  for (let i = 0; i < row.length; i++) if (row[i] >= threshold) {
    if (a < 0) a = i;
    b = i;
  }
  // and the window's 1 px outline either side, darker than its content
  return a < 0 ? null : {left: x0 + a - outline, right: x0 + b + outline};
}
