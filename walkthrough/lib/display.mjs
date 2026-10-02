// A virtual X11 screen (Xvfb) for the browser, the screen capture and Recordly to share.
import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';

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
    await new Promise(r => setTimeout(r, 100));
  }
  return {display, stop: () => proc.kill()};
}
