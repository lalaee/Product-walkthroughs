# Desktop apps

When the app isn't a web page (an Electron, Flutter, Qt or GTK app), or the flow spans several
windows, write a **desktop flow**: the whole virtual screen is captured, a window manager runs,
and the director uses real mouse and keyboard input (xdotool).

## The shape of a desktop flow

```js
export const desktop = true;
export const size = '1920x1080';
export const scale = 4 / 3;                       // HD with room to zoom
export const background = '../desktops/windows11/desktop.html';

export async function launch({env, desktop, out, width, height, scale, recordly}) {
  // start the app(s) on `env.DISPLAY`, place their windows, wait until they're settled
  // register any web contents so the director can target them: desktop.register(page, origin)
  return {/* what run() needs */, close: async () => {/* stop everything */}};
}

export async function run(d, ctx) { /* steps */ }
```

Examples: `flows/recordly-windows.mjs` (Electron app plus a browser window),
`flows/localsend-send.mjs` (a Flutter app, a stand-in phone in a frameless window),
`flows/recordly-record.mjs` (Recordly recording itself, Linux style).

## Finding controls

- **Web contents** (Electron windows, Chromium app windows): register the page with
  `desktop.register(page, origin)` and target it with locators, as in a page flow.
- **Anything else**: by the text on screen. `const win = desktop.window('^LocalSend$')` then
  `win.text('Send')` (OCR with tesseract; `{nth}` for the n-th match) or `win.at(x, y, w, h)` for a
  fixed spot. OCR takes about a second; the director cuts that thinking time from the video. Short
  or stylised words can fail to read; pick a nearby longer label.

## Windows that behave

- Apps often restore their own size and position as they start: set yours in a loop until it
  holds (see `launch` in `flows/localsend-send.mjs`), and check again just before recording.
- The window manager (openbox, no decorations) draws no title bars. For a Windows look,
  `desktops/windows11/titlebar.mjs` draws one (`showTitleBar`), fitted to where the window is
  actually painted (`paintedEdges`); or inject one into a web page (`windowsTitleBar` in
  `flows/recordly-windows.mjs`).
- System dialogs (a GTK file picker) look nothing like the target OS: do that part inside
  `d.idle` (type the path with Ctrl+L, Enter) so it's cut.

## A Windows 11 desktop

`desktops/windows11/desktop.html` is a wallpaper and taskbar from the Windows 11 UI Kit. With a
Windows title bar on each window it reads as Windows. Say in the report that it's Linux underneath.

## Recording Recordly itself (or any recorder)

Recordly is an Electron app; `walkthrough/lib/recordly.mjs` launches it with a fresh profile
(`launchRecordly`).

- **Its interface as on Windows or macOS**: `launchRecordly({platform: 'win'})`. A preload of ours
  reports that platform to Recordly's interface (the recorder's own screen and window picker,
  Windows window buttons); everything underneath is still Linux. Disclose it.
- **The recorder must never record itself.** On Windows and macOS Recordly hides its bar from
  screen recordings; Linux can't. So record a **window** (choose the app's window in "Choose
  what to record"): the bar stays visible to the viewer and stays out of the recording. Stop with
  the bar's Stop button, as a user would.
- **Playback in its editor** can't be drawn at full speed without a GPU (about 12 fps here): use
  slow motion (`finishInEditor(d, ctx, null, {slow: 4})`, `walkthrough/lib/slowmo.mjs`).
- On Linux a window recording carries the real pointer, so Recordly's preview shows "Animated
  cursor unavailable". That's Recordly being honest; mention it.

## Web content in its own window

To put a web page on the desktop as if it were a device or another app (a phone screen, a
browser), use `openWebWindow` (`walkthrough/lib/webwindow.mjs`): a frameless, transparent Electron
window you can place anywhere, registered for locators like any page.
