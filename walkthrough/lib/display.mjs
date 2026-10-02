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
 * A desktop: a virtual screen with a window manager (openbox: stacking, focus, always-on-top) and a
 * compositor (xcompmgr: see-through windows such as Recordly's floating recorder).
 */
export async function startDesktop({width, height}) {
  const screen = await startDisplay({width, height});
  const env = {...process.env, DISPLAY: screen.display};
  const helpers = ['xcompmgr', 'openbox'].map(cmd => spawn(cmd, [], {env, stdio: 'ignore'}));
  await sleep(1000);
  for (const [i, p] of helpers.entries()) if (p.exitCode != null) throw new Error(`${['xcompmgr', 'openbox'][i]} didn't start (apt-get install xcompmgr openbox)`);
  return {
    display: screen.display,
    env,
    stop: () => {
      helpers.forEach(p => p.kill());
      screen.stop();
    }
  };
}
