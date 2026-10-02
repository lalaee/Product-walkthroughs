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
zooms as a native Mac recording. That includes the cursor's shape (the hand over links and
buttons, the open hand over things to drag, the I-beam in fields), read from the page's CSS and
logged on every change. Recordings made on Linux carry no system cursor images, so Recordly draws
its own arrow and its Figma-based hands.

Last tested with Recorder-2 at `b47ba1e` (each recording drawn with its own machine's cursors).

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
node walkthrough/review.mjs out/demo-taskly --fix     # check every zoom, fix the ones that hide the action
node walkthrough/render.mjs out/demo-taskly           # render with the fixed zooms
node walkthrough/review.mjs out/demo-taskly           # must pass; then look at review/sheet.png
```

## Review: frame by frame

Recordly zooms to 2.4× on clicks, which can crop a dialog, a wide form field or the result of a
click. `review.mjs` checks every action in the video:

- **What the viewer needs to see.** The flow records each action as a beat in `beats.json`: what
  was clicked, typed into or pressed, and where. What should be visible afterwards comes from the
  flow's `show` hint, or else from the region of the raw recording that changed during the action.
- **What the camera shows.** Recordly's own camera and cursor code is bundled from Recorder-2's
  source and run against the zooms Recordly saved in the project. That includes its ramps, its
  glides between connected zooms and its cursor follow, so this is the view the exporter draws,
  sampled every 50 ms.
- **The check.** Around the moment of each action the target has to be in view, with up to 15%
  allowed to be clipped while the camera arrives. Over the second half of the action, the target
  and its result have to be fully in view.
- **Motion.** It fails if the camera zooms faster than 3 doublings per second or pans faster than 1.2
  view widths per second. The focused preset peaks around 12 doublings per second; smooth stays
  under 3.
- **The flow.** It fails if a `show` target never appeared, or if a click, typing or key press
  changed nothing on screen. Either means the flow didn't do what it meant to.

`--fix` turns each failing zoom into a manual zoom centred on everything its actions need, at the
most it can zoom while still showing all of it, or removes it if that's under 1.3×. It re-checks
the camera after each change until every beat passes, then saves the project for a re-render.

`review/sheet.png` is a contact sheet with one row per action. The first frame is the raw
recording, with the needed area in green and the camera's view in blue (dashed at the moment of
the action). It's followed by frames from the finished video at the action, midway and after. The
numbers catch framing; the sheet is for what they can't catch, like the wrong state, a result that
appears too late, or motion blur on the frame that matters.

`record.mjs` takes `--size 1920x1080` and `--fps 60`. `render.mjs` takes `--motion smooth|focused`,
`--quality original|high|standard` and `--fps 60|30`. The motion setting picks one of Recordly's
zoom presets:

- **smooth** (the default): 1.1 s eased in-out camera moves and fewer, longer zooms.
- **focused**: 0.45 s snappy moves and more, tighter zooms. These read as sharp.

Recordly suggests zooms once, when it first opens a project, so add `--fresh` to redo them after
changing `--motion`. That also discards earlier review fixes.

`render.mjs` also saves `editor.png`, a screenshot of Recordly's timeline, so you can check where
the zooms landed.

To re-render with other settings, run `render.mjs` again. The recording is kept, so there's no need
to record again.

## Writing a flow

A flow is a module in `flows/` that exports `name`, `url` and `run(d, page)`, and optionally
`setup(page)` to log in or seed data before recording starts. `d` is the director
(`walkthrough/lib/director.mjs`):

| Call | What it does |
|---|---|
| `d.click(target, {hold, show})` | travel to the target, click, hold `hold` ms (default 700) |
| `d.type(target, text)` | click a field and type at a readable pace |
| `d.press(key)` | press a key (Enter, Tab…) |
| `d.point(target, {hold})` | hover something long enough for a soft zoom (default 1200 ms) |
| `d.moveTo(target)` / `d.wait(ms)` | travel without clicking / pause |

Targets are CSS selectors, Playwright locators or `{x, y}`. Every action takes `show`, a selector
or locator (or a list of them) for what the viewer should see once it has played out, such as the
dialog a button opens. The review keeps that in frame and fails the flow if it never appears.
Without `show`, it uses whatever changed on screen, which is too much when a dialog dims the whole
page. `label` names the action in the review.

Pacing is what shapes the zooms. Recordly zooms in on each click, and on each "settle", where the
pointer moves and then rests for about 0.8 s. Clicks less than about 2 s apart merge into one longer
zoom. Hold after a click that changes the screen, so the viewer sees what happened.

## Videos

- `videos/demo-taskly.mp4`: the pipeline on the bundled demo page (`demo-app/`): create a project,
  open it, add two tasks, tick one off. 27 s, 1080p60, smooth motion, reviewed and fixed (all
  11 actions in view, peak zoom speed 2.6 doublings/s); its contact sheet is `videos/demo-taskly-review.png`.
