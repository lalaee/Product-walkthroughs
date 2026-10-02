# Product walkthroughs

Scripted product walkthrough videos, recorded and finished with
[Recordly (Recorder-2)](https://github.com/lalaee/Recorder-2): auto-zooms that follow the clicks, a
smooth redrawn cursor with click effects, a background, and Recordly's own MP4 export.

It runs on Linux, headless, with no person or Mac needed:

1. **Record** (`walkthrough/record.mjs`): the app runs in Chromium on a virtual screen (Xvfb). A flow
   script drives it like a presenter would: eased pointer moves, deliberate clicks, readable typing.
   ffmpeg captures the page area **without the cursor**, and every pointer move and click goes into a
   cursor log. The result is a recording in Recordly's own format, the same one it writes for its
   native macOS recordings (`recording.json`, `screen.mp4`, `cursor.ndjson`), plus a project for it.
2. **Render** (`walkthrough/render.mjs`): Recordly opens the project, suggests zooms from the clicks
   and the moments the pointer settles, redraws the cursor from the log, and exports the MP4.

Because the cursor is data and not pixels, the video gets the same redrawn cursor and click-driven
zooms as a native Mac recording.

## Setup

```sh
# Recordly, next to this repo (../recorder-2)
git clone https://github.com/lalaee/Recorder-2 ../recorder-2
(cd ../recorder-2 && npm ci && npm run build:native && npm run build)   # build:native needs Rust

npm install        # here
```

Needs `Xvfb` and `ffmpeg` on the machine, and a Chromium build (`CHROME_PATH`, defaulting to the
Playwright Chromium in `/opt/pw-browsers`).

## Make a video

```sh
node walkthrough/record.mjs flows/demo-taskly.mjs     # → out/demo-taskly/library
node walkthrough/render.mjs out/demo-taskly           # → out/demo-taskly/demo-taskly.mp4
```

`record.mjs` takes `--size 1920x1080` and `--fps 60`. `render.mjs` takes `--motion focused|smooth`
(Recordly's zoom presets: focused = more, shorter, tighter zooms), `--quality original|high|standard`
and `--fps 60|30`. It also saves `editor.png`, a screenshot of Recordly's timeline, so you can check
where the zooms landed.

To re-render with other settings, run `render.mjs` again. The recording is kept, so there's no need
to record again.

## Writing a flow

A flow is a module in `flows/` that exports `name`, `url` and `run(d, page)`, and optionally
`setup(page)` to log in or seed data before recording starts. `d` is the director
(`walkthrough/lib/director.mjs`):

| Call | What it does |
|---|---|
| `d.click(target, {hold})` | travel to the target, click, hold `hold` ms (default 700) |
| `d.type(target, text)` | click a field and type at a readable pace |
| `d.press(key)` | press a key (Enter, Tab…) |
| `d.point(target, {hold})` | hover something long enough for a soft zoom (default 1200 ms) |
| `d.moveTo(target)` / `d.wait(ms)` | travel without clicking / pause |

Targets are CSS selectors, Playwright locators or `{x, y}`.

Pacing is what shapes the zooms. Recordly zooms in on each click, and on each "settle", where the
pointer moves and then rests for about 0.8 s. Clicks less than about 2 s apart merge into one longer
zoom. Hold after a click that changes the screen, so the viewer sees what happened.

## Videos

- `videos/demo-taskly.mp4`: the pipeline on the bundled demo page (`demo-app/`): create a project,
  open it, add two tasks, tick one off. 27 s, 1080p60.
