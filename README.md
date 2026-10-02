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
buttons, the open hand over things to drag, the I-beam in fields), read from the page's CSS (or the
system cursor, in desktop flows) and logged on every change. The hand is also shown over anything
clickable the pointer goes to, even where the app keeps the arrow, as Recordly's own buttons do.
Recordly draws the shapes; the director only logs when each one applies. Recordings made on Linux carry no system cursor images, so Recordly draws
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
node walkthrough/finish.mjs out/demo-taskly           # poster frame (baked in as frame 0) and share copy
```

## Shape: plan, hook, length

A flow can carry the brief for its video, from `latent-spaces/brag`'s playbook. Short beats long
(15–25 s), and the first two seconds decide whether anyone keeps watching.

- **`plan`**: what it is, who it's for, the hook, the flow, the target `duration` ([min, max] s)
  and `milestones` ({beat, by}: an action that must happen by then). `record.mjs` writes it to
  `plan.md`, and `review.mjs` fails the video if it runs too long or a milestone comes late.
- **`hook`** (`{mark, seconds}`): the video opens on a few seconds from a moment the flow marked
  with `d.mark(name)`, usually the payoff, then cuts to the start.
- **`d.idle(fn)`** cuts what happens in `fn` (waits on the app, housekeeping the viewer needn't
  see). **`d.fast(fn, {speed})`** plays it faster (a countdown, a progress bar). **`lead`** (ms)
  sets the pause before the first action.

The recording is put together from an edit list (stretches of the capture, in order, at their
speed), and the cursor log and the actions go through the same edit. So to Recordly and the review
it's one continuous recording.

- **`poster`** (an action's label) and **`share`** (1–3 sentences): `finish.mjs` takes the poster at
  that action once it has settled. It saves it as `<flow>.jpg` and bakes it in as frame 0, which is
  what Slack, X and Discord show as the thumbnail. It writes the share copy to `share-copy.txt`.

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
- **Readable.** Once an action has happened, the view has to hold still long enough to read what
  it shows, counted until the next action: about 0.15 s per word (mostly labels, read at a
  glance), between 0.8 and 2 s. `--fix` can't lengthen a hold; the flow has to.
- **The plan.** It fails if the video is outside the plan's length or a milestone comes late.
- **The flow.** It fails if a `show` target never appeared, or if a click, typing or key press
  changed nothing on screen. Either means the flow didn't do what it meant to.

`--fix` reframes every zoom as a manual zoom centred on everything its actions need. Recordly's
own zooms follow the cursor, which can leave the content off to one side. Each zoom goes no tighter
than still shows all of it, and never past 2×. A zoom is removed if that would be under 1.3×. It
adds the zooms the flow asked for, and re-checks the camera after each change until every beat
passes. Then it saves the project for a re-render.

`review/sheet.png` is a contact sheet with one row per action, plus a row of stills from halfway
through every zoom-in, zoom-out and glide, where a move between two busy views can turn muddy. The first frame is the raw
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

## Desktop flows

A page flow drives one web page and captures only that page. A **desktop flow** captures the
whole screen of a virtual desktop and uses real system input (`xdotool`), so it can span several
windows and record apps that watch the real pointer. `flows/recordly-record.mjs` uses one to record
Recordly itself: Recordly's own recorder captures the screen and logs clicks while the walkthrough
is being recorded.

It exports `desktop = true` and `launch({env, desktop, out, width, height, recordly})`. `launch`
starts the apps and registers each page with `desktop.register(page, origin)`, where `origin()`
returns the page's top-left on screen. It returns what `run(d, ctx)` needs, plus `close()`. Targets
are then Playwright locators in those pages, and the director moves the real pointer to them. The
cursor's shape is the system cursor's, read through Recordly's native module.

Needs `apt-get install xdotool openbox xcompmgr`. openbox gives windows stacking, focus and
always-on-top, and xcompmgr makes see-through windows such as Recordly's floating recorder draw.
A flow can set its pixel density (`export const scale = 2`, or `--scale`): the screen is laid out
at `size` in points and drawn at `scale` times the pixels, like a Retina display, so zooms stay
sharp. 1440×900 at 8/3 is 3840×2400, 4K at 16:10, Recordly's largest export. Logs stay in points.
Higher densities cost frame rate on a machine without a GPU. Measured on 4 cores with
Recordly recording too:

| Density | Pixels | Recordly's own recording | Its preview playing back |
|---|---|---|---|
| 1× | 1440×900 | smooth | ~30 fps |
| 2× | 2880×1800 | ~25 fps | ~13 fps |
| 8/3 (4K) | 3840×2400 | ~9 fps | ~8 fps |

A flow can set its screen size (`export const size = '1440x900'`) and the shape of the finished
video (`export const aspect = '1:1'`, which `render.mjs` sets in Recordly's "Video shape" picker;
`--aspect` overrides it). Wrap waits on the app in `d.idle(() => …)`, such as a window opening or
an analysis finishing. `record.mjs` cuts them from the video, keeping 0.4 s at each end, and shifts
every timestamp after them. Shortcuts pressed with `d.press('Control+Shift+2')` are logged, so
Recordly shows them as keycaps.

A desktop flow can set the desktop behind its windows with `export const background`, an image or
an HTML page rendered at the screen's size. `desktops/windows11/` is a Windows 11 desktop: the
Bloom wallpaper and the dark taskbar, built from the Windows 11 UI Kit (Community) on Figma, with
the kit's own icons. Windows have no decorations from the window manager; apps draw their own title
bars. `flows/recordly-windows.mjs` gives its Taskly window a Windows 11 one.

**Apps that aren't web pages** (Flutter, GTK, Qt): `desktop.window(title)` gives targets found on
screen. `.text('Send')` finds the words by OCR (tesseract, on the window enlarged 2×, without the
pointer in the way), and `.at(x, y, w, h)` is a position in the window. A read is reused until the
window changes. The time the director spends finding a target is cut from the video, so the pointer
never stands waiting. `walkthrough/lib/webwindow.mjs` opens a web page in a frameless see-through
window, for props on the desktop (a phone screen). `desktops/windows11/titlebar.mjs` gives an app
that draws no title bar a Windows 11 one.

If a flow fails, `failure.png` is the screen at that moment, and the Recordly flow keeps
Recordly's log in `recordly.log`.

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

Targets are CSS selectors, Playwright locators or `{x, y}`. Every action takes `zoom` (an amount,
or `true` for 1.8×) to ask for a zoom where Recordly might not suggest one. `review.mjs --fix` adds
it, as far as still shows the target and its result, with a second's glide from the zoom before.
Every action also takes `show`, a selector
or locator (or a list of them) for what the viewer should see once it has played out, such as the
dialog a button opens. The review keeps that in frame and fails the flow if it never appears.
Without `show`, it uses whatever changed on screen, which is too much when a dialog dims the whole
page. `label` names the action in the review.

Pacing is what shapes the zooms. Recordly zooms in on each click, and on each "settle", where the
pointer moves and then rests for about 0.8 s. Clicks less than about 2 s apart merge into one longer
zoom. Hold after a click that changes the screen, so the viewer sees what happened.

## Videos

- `videos/recordly-record.mp4`: Recordly recording a fresh screen on a 1440×900 desktop drawn at
  8/3 pixel density: 3840×2400, 4K at 16:10. It starts a new recording, hides the recorder,
  creates a project in Taskly while it records, stops with Ctrl+Shift+2, lands in the editor
  (asking for zooms when Recordly hasn't suggested them), trims off the start, and plays it back.
  43.8 s at 60 fps, reviewed and fixed (all 16 actions in view); contact sheet
  `videos/recordly-record-review.png`. It was recorded before the hook, plan and readability
  changes. Recordly's own recording inside it runs at about 9 fps at this density on a machine
  without a GPU, so its playback in the preview is choppy.
- `videos/localsend-send.mp4`: [LocalSend](https://github.com/localsend/localsend) sending a photo
  from the PC to a phone nearby, on the Windows 11 desktop. LocalSend is the real app (the v1.18.2
  Linux release, unmodified), driven by OCR. The phone is a stand-in: `flows/localsend/peer.mjs` is
  a LocalSend receiver speaking the published protocol (v2.2), so the app really discovers it and
  really transfers the file. Its screen (`flows/localsend/phone.html`) is mine, in LocalSend's
  colours, not LocalSend's mobile app. The PC's chip on LocalSend's sending screen says "Linux",
  because that's what it runs on here. 17.8 s, 1920×1080 at 60 fps, all checks passed. Poster,
  share copy, plan and contact sheet alongside (`videos/localsend-send*`).
  Setup: the LocalSend Linux release in `/home/user/apps/localsend` (or `LOCALSEND_APP`), and
  `apt-get install tesseract-ocr feh libayatana-appindicator3-1 libegl1 libgl1`.
- `videos/recordly-windows.mp4`: Recordly on a Windows 11 desktop, starting from its recorder bar,
  with Taskly already open. It opens on the payoff (the recording playing back, zoomed in), then
  records with a 3× countdown, creates a project in Taskly, stops with Ctrl+Shift+2, points out the
  suggested zoom and plays it back. The trim is done off-camera. 24.6 s, 1920×1080 at 60 fps,
  reviewed and fixed (all actions in view and readable, plan met). Also: the poster
  `videos/recordly-windows.jpg` (frame 0 of the video), `videos/recordly-windows-share.txt`, the
  plan `videos/recordly-windows-plan.md` and the contact sheet `videos/recordly-windows-review.png`.
- `videos/demo-taskly.mp4`: the pipeline on the bundled demo page (`demo-app/`): create a project,
  open it, add two tasks, tick one off. 27 s, 1080p60, smooth motion, reviewed and fixed (all
  11 actions in view, peak zoom speed 2.6 doublings/s); its contact sheet is `videos/demo-taskly-review.png`.
