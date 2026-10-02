// LocalSend (github.com/localsend/localsend): send a photo from the PC to a phone nearby.
//
// The real LocalSend desktop app (its Linux release) on the Windows 11 desktop, and a phone next to
// it: a LocalSend receiver that speaks the protocol (flows/localsend/peer.mjs) and shows what it gets,
// in a frameless see-through window, so the phone stands on the desktop.
// LocalSend is a Flutter app, so its controls are found by their text on screen (OCR).
import {spawn, execFileSync} from 'node:child_process';
import {copyFileSync, mkdirSync, mkdtempSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {paintedEdges, showTitleBar, TITLE_BAR} from '../desktops/windows11/titlebar.mjs';
import {openWebWindow} from '../walkthrough/lib/webwindow.mjs';
import {startPeer} from './localsend/peer.mjs';

export const name = 'LocalSend — send a photo to your phone';
export const desktop = true;
export const size = '1920x1080';
export const aspect = '16:9';
export const background = '../desktops/windows11/desktop.html';
export const lead = 400;

export const plan = {
  what: 'LocalSend sends files between your own devices on the same Wi-Fi, no cloud and no account.',
  audience: 'Anyone moving photos and files between their computer and phone.',
  hook: 'Open on the payoff: the photo already on the phone.',
  flow: ['LocalSend is open on the PC, a phone nearby', 'Send → File: pick a photo', 'The phone shows up under Nearby devices: click it', 'The phone accepts; the photo arrives'],
  duration: [12, 22],
  milestones: [{beat: 'File', by: 7}, {beat: 'Pixel 8', by: 12}]
};
export const hook = {mark: 'payoff', seconds: 2.5};
export const poster = 'the photo on the phone';
export const share = 'LocalSend: pick a photo on your PC, tap your phone in the list, done. Straight over your Wi-Fi, no cloud, no account.';

const LOCALSEND = process.env.LOCALSEND_APP ?? '/home/user/apps/localsend/localsend_app';
const WALLPAPER = resolve(import.meta.dirname, '../desktops/windows11/wallpaper.jpg');
const TASKBAR = 48;

export async function launch({env, desktop, out, width, height, recordly}) {
  // the phone: a LocalSend receiver, and its screen in a window to the right
  const phoneWin = {x: 1450, y: 150, w: 380, h: 760};
  const peer = await startPeer({alias: 'Pixel 8', deviceModel: 'Pixel'});
  const phoneWindow = await openWebWindow({url: peer.url, x: phoneWin.x, y: phoneWin.y, width: phoneWin.w, height: phoneWin.h, env, recordly});
  const phone = phoneWindow.page;
  desktop.register(phone, phoneWindow.origin);

  // LocalSend, with a home of its own: this PC's name, the photo to send, no "what's new"
  const home = mkdtempSync(join(tmpdir(), 'localsend-home-'));
  const prefs = join(home, '.local/share/org.localsend.localsend_app');
  mkdirSync(prefs, {recursive: true});
  writeFileSync(join(prefs, 'shared_preferences.json'), JSON.stringify({'flutter.ls_version': 3, 'flutter.ls_alias': 'Office PC', 'flutter.ls_whats_new': '1.18.2'}));
  mkdirSync(join(home, 'Pictures'));
  copyFileSync(WALLPAPER, join(home, 'Pictures', 'Bloom.jpg'));
  const app = spawn(LOCALSEND, [], {env: {...env, HOME: home}, stdio: 'ignore'});
  const win = {x: 230, y: 150 + TITLE_BAR, w: 1120, h: height - TASKBAR - 150 - TITLE_BAR - 80};
  const xd = (...a) => execFileSync('xdotool', a.map(String), {env}).toString().trim();
  for (let i = 0; i < 60; i++) {
    try {
      xd('search', '--onlyvisible', '--name', '^LocalSend$');
      break;
    } catch {
      await new Promise(r => setTimeout(r, 500));
    }
  }
  const id = xd('search', '--onlyvisible', '--name', '^LocalSend$').split('\n')[0];
  // LocalSend restores its own window size and place as it starts: set ours until it holds
  const geometry = () => Object.fromEntries(xd('getwindowgeometry', '--shell', id).split('\n').map(l => l.split('=')).map(([k, v]) => [k, Number(v)]));
  // (the window manager may offset it by its border: what counts is that it's the right size and
  // stays put, and the title bar goes where it actually is)
  let g, prev;
  for (let i = 0; i < 20; i++) {
    xd('windowsize', id, win.w, win.h);
    xd('windowmove', id, win.x, win.y);
    await new Promise(r => setTimeout(r, 400));
    prev = g;
    g = geometry();
    const near = Math.abs(g.X - win.x) <= 4 && Math.abs(g.Y - win.y) <= 4 && g.WIDTH === win.w && g.HEIGHT === win.h;
    if (i >= 3 && near && prev && prev.X === g.X && prev.Y === g.Y) break;
  }
  if (Math.abs(g.X - win.x) > 4 || Math.abs(g.Y - win.y) > 4 || g.WIDTH !== win.w || g.HEIGHT !== win.h) throw new Error(`LocalSend's window is at ${g.X},${g.Y} ${g.WIDTH}×${g.HEIGHT}, not where it was put`);
  // the title bar on the window as it actually is
  // (fitted to where the window is painted, a few rows down, which can differ from its frame by a pixel)
  await new Promise(r => setTimeout(r, 800));
  const edges = paintedEdges({env, y: g.Y + 12, x0: g.X - 20, x1: g.X + g.WIDTH + 20}) ?? {left: g.X, right: g.X + g.WIDTH - 1};
  const bar = await showTitleBar({env, title: 'LocalSend', icon: join(LOCALSEND, '../data/flutter_assets/assets/img/logo-32.png'), x: edges.left, y: g.Y - TITLE_BAR, width: edges.right - edges.left + 1});
  await new Promise(r => setTimeout(r, 3000)); // discovery
  // still in place, title bar and all, as recording starts
  const now = geometry();
  if (now.X !== g.X || now.Y !== g.Y || now.WIDTH !== g.WIDTH) throw new Error(`LocalSend's window moved to ${now.X},${now.Y} ${now.WIDTH}×${now.HEIGHT}`);

  return {
    localsend: desktop.window('^LocalSend$'), phone, home,
    close: async () => {
      bar.kill();
      app.kill();
      await phoneWindow.close();
      await peer.close();
    }
  };
}

/** @param {import('../walkthrough/lib/director.mjs').Director} d */
export async function run(d, {localsend: ls, phone, home}) {
  await d.click(ls.text('Send'), {hold: 900, show: ls.text('Nearby devices'), label: 'Send'});
  // the file picker is the system's (on this machine, GTK's): pick the photo off camera
  await d.click(ls.text('File'), {hold: 0, label: 'File'});
  await d.idle(async () => {
    const xd = (...a) => execFileSync('xdotool', a.map(String), {env: {...process.env}}).toString();
    for (let i = 0; i < 20; i++) {
      try {
        xd('search', '--onlyvisible', '--name', '^Open File$');
        break;
      } catch {
        await d.wait(300);
      }
    }
    await d.wait(500);
    d.s.press('Control+l'); // the location field, then the path
    await d.wait(400);
    d.s.type(join(home, 'Pictures', 'Bloom.jpg'), 20);
    await d.wait(300);
    d.s.press('Enter');
    await d.wait(1500);
  }, {keep: 0});
  await d.point(ls.text('Selection'), {hold: 1100, show: [ls.text('Selection'), ls.text('Edit')], label: 'the photo, selected', zoom: 1.6});
  // the phone is in the list: send it there. The phone shows the request, accepts, the photo arrives.
  await d.click(ls.text('Pixel 8'), {hold: 4200, show: [phone.locator('.phone'), ls.text('Finished')], label: 'Pixel 8'});
  await d.point(phone.locator('.screen'), {hold: 2200, show: phone.locator('#received'), label: 'the photo on the phone', zoom: 1.8});
  d.marks.payoff = d.beats.at(-1).t + 300;
}
