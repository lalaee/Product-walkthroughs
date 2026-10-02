// A virtual X11 screen (Xvfb) for the browser, the screen capture and Recordly to share.
import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Starts Xvfb on a free display number, or reuses $DISPLAY when set. */
export async function startDisplay({width, height}) {
  if (process.env.DISPLAY) return {display: process.env.DISPLAY, stop: () => {}};
  let n = 99;
  while (existsSync(`/tmp/.X11-unix/X${n}`) || existsSync(`/tmp/.X${n}-lock`)) n++;
  const display = `:${n}`;
  const proc = spawn('Xvfb', [display, '-screen', '0', `${width}x${height}x24`, '-nolisten', 'tcp'], {stdio: 'ignore'});
  const until = Date.now() + 10_000;
  while (!existsSync(`/tmp/.X11-unix/X${n}`)) {
    if (Date.now() > until || proc.exitCode != null) throw new Error(`Xvfb didn't start on ${display}`);
    await sleep(100);
  }
  return {display, stop: () => proc.kill()};
}

/**
 * Renders a desktop background (an HTML page or an image) at the screen's size and sets it as the
 * root window's background (feh), which the compositor draws behind every window.
 */
async function paintBackground(env, file, width, height, scale) {
  const {chromium} = await import('playwright-core');
  const {mkdtempSync} = await import('node:fs');
  const {tmpdir} = await import('node:os');
  const {join, resolve} = await import('node:path');
  const {pathToFileURL} = await import('node:url');
  const {execFileSync} = await import('node:child_process');
  let image = resolve(file);
  if (/\.html?$/.test(file)) {
    image = join(mkdtempSync(join(tmpdir(), 'desktop-')), 'background.png');
    const browser = await chromium.launch({executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
    const page = await browser.newPage({viewport: {width: Math.round(width / scale), height: Math.round(height / scale)}, deviceScaleFactor: scale});
    await page.goto(pathToFileURL(resolve(file)).href);
    await page.waitForLoadState('networkidle');
    await page.screenshot({path: image});
    await browser.close();
  }
  execFileSync('feh', ['--no-fehbg', '--bg-fill', image], {env});
}

/**
 * A desktop: a virtual screen with a window manager (openbox: stacking, focus, always-on-top) and a
 * compositor (xcompmgr: see-through windows such as Recordly's floating recorder), and optionally a
 * background: an image, or an HTML page rendered to one (see desktops/).
 */
export async function startDesktop({width, height, background, scale = 1}) {
  const screen = await startDisplay({width, height});
  const env = {...process.env, DISPLAY: screen.display};
  // openbox without decorations: apps draw their own title bars
  const helpers = [['xcompmgr', []], ['openbox', ['--config-file', new URL('./openbox-rc.xml', import.meta.url).pathname]]].map(([cmd, args]) => spawn(cmd, args, {env, stdio: 'ignore'}));
  await sleep(1000);
  for (const [i, p] of helpers.entries()) if (p.exitCode != null) throw new Error(`${['xcompmgr', 'openbox'][i]} didn't start (apt-get install xcompmgr openbox)`);
  if (background) await paintBackground(env, background, width, height, scale);
  return {
    display: screen.display,
    env,
    stop: () => {
      helpers.forEach(p => p.kill());
      screen.stop();
    }
  };
}
