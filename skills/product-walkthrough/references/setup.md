# Setting up the machine

The pipeline runs headless on Linux: a virtual screen (Xvfb), the app on it, ffmpeg capturing it,
and Recordly (an Electron app) finishing the video. A cloud container or CI runner works; no GPU
is needed (it's slower without one; see "Speed" below).

## Packages

```sh
# Debian/Ubuntu
sudo apt-get install -y xvfb ffmpeg xdotool openbox xcompmgr feh tesseract-ocr \
  libayatana-appindicator3-1 libegl1 libgl1 fonts-noto fonts-noto-color-emoji fonts-inter
```

- `xvfb`, `ffmpeg`: the screen and the capture. Always needed.
- `xdotool`, `openbox`, `xcompmgr`, `feh`: desktop flows (real windows, a window manager, a
  wallpaper). Only for desktop apps.
- `tesseract-ocr`: finding controls by their text in apps that aren't web pages (Flutter, native).
- The `lib*` packages: what Electron and Flutter apps commonly need to start.

Chromium: the pipeline uses Playwright's Chromium (`CHROME_PATH`, defaulting to
`/opt/pw-browsers/chromium-*/chrome-linux/chrome`). If it isn't there: `npx playwright install chromium`
and set `CHROME_PATH`.

## The repos

```sh
git clone https://github.com/lalaee/Product-walkthroughs walkthroughs && cd walkthroughs
npm install
git clone https://github.com/lalaee/Recorder-2 ../recorder-2          # Recordly, next to this repo
(cd ../recorder-2 && npm ci && npm run build:native && npm run build) # build:native needs Rust
```

Recordly is found at `../recorder-2`, or `RECORDLY_DIR`, or `--recordly <dir>`.

Known setup snags:

- Recordly's Electron binary missing after `npm ci` (no network during postinstall): run
  `node node_modules/electron/install.js` inside the Recorder-2 checkout.
- A pnpm-based app refusing your pnpm version: `npx -y pnpm@<version from its package.json> install`.
- Chromium warning bars across a window: launch with `--test-type` and set `GOOGLE_API_KEY=no`,
  `GOOGLE_DEFAULT_CLIENT_ID=no`, `GOOGLE_DEFAULT_CLIENT_SECRET=no` (see `flows/recordly-windows.mjs`).

## Check it before the real thing

```sh
node walkthrough/record.mjs flows/demo-taskly.mjs && node walkthrough/render.mjs out/demo-taskly
```

That should end with `exported … → out/demo-taskly/demo-taskly.mp4`. If it doesn't, fix the
setup first.

## Speed

On a 4-core machine with no GPU: recording runs in real time; a Recordly export of a 30 to 40 s
video at 1920×1080 takes 3 to 5 minutes; a full record → render → fix → render → review cycle is
10 to 15 minutes. 4K is roughly three times slower and makes Recordly's own UI draw at a few
frames a second, so stay at HD unless asked.

Run long chains in the background if your agent can, and keep the services the app needs (its
database, its server) running between cycles: a restarted session kills them, so check before
each run (`curl` the app's URL).
