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
node walkthrough/frames.mjs out/demo-taskly           # one full-size frame per step: look at every one
node walkthrough/finish.mjs out/demo-taskly           # poster frame (baked in as frame 0) and share copy
```

## Captions

A step can carry an instructional subtitle: `d.click(button, {caption: 'Click Add website'})`. It
comes up just before the step and stays until the next caption. Recordly draws them (its captions
track) in Inter Bold, about 4.7% of the frame's height, in a band of background above the
recording so they never cover the app (`walkthrough/lib/captions.mjs`). `review.mjs --fix` and
`render.mjs` write them into the project. One line each, at most 48 characters; `record.mjs`
refuses longer ones. Needs the Inter font installed (`fonts-inter`).

## Voice narration (optional)

For a spoken version, give steps a line to say: `d.click(button, {caption: 'Click Add website',
narrate: 'Click Add website.'})`. With an [ElevenLabs](https://elevenlabs.io) API key in
`ELEVENLABS_API_KEY` and a voice (the flow's `voice` export, `--voice` or `ELEVENLABS_VOICE`),
`record.mjs` makes every line before recording (cached in `out/.voice`, so re-recording costs
nothing for lines already made) and paces the flow to them: a narrated step waits for the line
before it to finish, so lines never overlap and each starts with its step. `render.mjs out/<flow> --narrated` renders the narrated version (its captions are the spoken
lines, two rows at most, each shown while it's spoken), and `finish.mjs` lays the voice over it as
`<flow>-narrated.mp4`, next to the silent, captioned `<flow>.mp4`. Lines say what's on screen as
it happens, from the first frame. Without a key the flow records
as before, captions only. Keep the key out of the repo.

The lines are spoken as one continuous take and cut apart by ElevenLabs' character timings: made
one request each, a clip's first sound tends to come out clipped ("Umami" heard as "Mami").
`python3 walkthrough/hear.py out/<flow>` listens for you (local speech recognition, `pip install
faster-whisper`): it checks every line is heard as written, with a confident first word.

## Use it from a coding agent

The whole process (picking the flow, making the app real, scripting it, reviewing it frame by
frame, reporting what's real) is written up as an agent skill in
[`skills/product-walkthrough/`](skills/product-walkthrough/SKILL.md): a `SKILL.md` with the
workflow and `references/` with the detail.

- **Claude Code** picks it up in this repo (`.claude/skills/product-walkthrough` links to it). To
  use it anywhere, copy the folder to `~/.claude/skills/`.
- **Codex** reads [`AGENTS.md`](AGENTS.md), **Gemini CLI** reads [`GEMINI.md`](GEMINI.md); both point
  to the skill. In another repo, add the same few lines to its `AGENTS.md` / `GEMINI.md`, with the
  path to wherever this repo is cloned.
- Any other agent: point it at `skills/product-walkthrough/SKILL.md`. It's plain Markdown.

Then ask for what you want, e.g. *"Make a walkthrough video of setting up https://github.com/umami-software/umami"*.

## Shape: plan, length, tutorial order

A walkthrough goes from A to B in order, like walking someone through the flow: no opening on the
payoff. A flow can carry the brief for its video, from `latent-spaces/brag`'s playbook.

- **`plan`**: what it is, who it's for, the flow, the target `duration` ([min, max] s)
  and `milestones` ({beat, by}: an action that must happen by then). `record.mjs` writes it to
  `plan.md`, and `review.mjs` fails the video if it runs too long or a milestone comes late.
- **`d.idle(fn)`** cuts what happens in `fn` (waits on the app, housekeeping the viewer needn't
  see, a page load). The screen may change across the cut, so the review ends any zoom early
  enough to have eased out before it, and starts the next one after it. **`d.fast(fn, {speed})`** plays it faster (a countdown, a progress bar). **`lead`** (ms)
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
- **Centred.** While zoomed in, once the camera has settled, the target (as it's acted on) and then
  its result have to sit within 12% of the view of its middle. That holds unless the camera can't
  get closer: at the edge of the recording, or when the result fills the view, so moving to the
  target would cut it off.
- **Motion.** It fails if the camera zooms faster than 3 doublings per second or pans faster than 1.2
  view widths per second. The focused preset peaks around 12 doublings per second; smooth stays
  under 3.
- **Readable.** Once an action has happened, the view has to hold still long enough to read what
  it shows, counted until the next action: about 0.15 s per word (mostly labels, read at a
  glance), between 0.8 and 2 s. `--fix` can't lengthen a hold; the flow has to.
- **The plan.** It fails if the video is outside the plan's length or a milestone comes late.
- **The flow.** It fails if a `show` target never appeared, or if a click, typing or key press
  changed nothing on screen. Either means the flow didn't do what it meant to.

`--fix` reframes every zoom as a manual zoom centred on what its actions need. Recordly's own zooms
follow the cursor, which can leave the content off to one side. A zoom has one focus, so one that
spans actions in different places (typing into a form, then the button on the page it leads to)
leaves each of them off-centre. Those are split into one zoom per group of actions that share a
middle, gliding from one to the next. Each zoom is centred between its result and its target, goes
no tighter than still shows all of it, and never past 2×. If its target still can't be centred,
it's widened. A zoom is removed if it would be under 1.3×, or if no framing works. It
adds the zooms the flow asked for, and re-checks the camera after each change until every beat
passes. Then it saves the project for a re-render.

`review/sheet.png` is a contact sheet with one row per action, plus a row of stills from halfway
through every zoom-in, zoom-out and glide, where a move between two busy views can turn muddy. The first frame is the raw
recording, with the needed area in green and the camera's view in blue (dashed at the moment of
the action). It's followed by frames from the finished video at the action, midway and after. The
numbers catch framing; the sheet is for what they can't catch, like the wrong state, a result that
appears too late, or motion blur on the frame that matters.

`record.mjs` takes `--size 1920x1080` and `--fps 60`. `render.mjs` takes `--motion smooth|focused`,
`--quality original|high|standard`, `--fps 60|30` and `--cursor 2.5`. The cursor setting is
Recordly's own cursor size (Cursor → Size, 0.5–10×), set in the editor before exporting. It
defaults to 2.5× here; Recordly's own default of 1.5× is small at walkthrough sizes. The motion setting picks one of Recordly's
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

- `videos/cuca-a-search.mp4`, `cuca-b-guided.mp4`, `cuca-c-orders.mp4`, `cuca-d-assistant.mp4`:
  [Cuca Vision](https://github.com/lalaee/cuca-vision), four ways to redesign help on Zalando's
  "Your account" screen, one video each, on a phone (375×812 at 3×, 9:16, 1370×2436). No captions
  or narration. **A · Search** (27.1 s): Help and contact → search "I want to cancel my order" →
  results → the article → Need more help? → contact options. **B · Guided** (30.7 s): Help and
  contact → pick an order → I did not receive this parcel → back → Item is different from the order
  → back → Returns and refunds hub. **C · Orders** (22.3 s): Orders → View Order → Get help with
  this order → I did not receive this parcel (B's answer). **D · Assistant** (19.2 s): the AI
  button → Assistant → Where is my order? → loading → the reply with your orders → help on that
  order. Each approach is its own Vite app from the repo's `app/` (`npm run dev:search`, `:guided`,
  `:orders`, `:assistant` on 5174–5177; `CUCA_*_URL` to override), unmodified; the Assistant's
  reply is the app's designed one. All checks passed. Posters, share copy, plans and contact sheets
  alongside (`videos/cuca-*`).
- `videos/coucou-setup.mp4`: setting up [Coucou](https://github.com/lalaee/coucou) to watch your
  Claude Code sessions, entirely in Coucou's own UI: Mochi and the island at the top of the screen,
  the card saying hooks aren't installed, Settings → Claude Code → Install hooks, the exact diff it
  will write to `~/.claude/settings.json` (with a dated backup), Back up and write, and back in the
  island it says Connected. Coucou's real Linux build (the Tauri app in `windows/`, built from the
  repo, unmodified), on a plain desktop; on Linux without a layer-shell compositor the island is a
  window pinned to the top edge, not a Mac notch. The hooks are really written (a fresh HOME each
  run). Coucou uses the OS font (Segoe UI), which is proprietary, so it's rendered in Selawik,
  Microsoft's metric-compatible open substitute, with the real Cascadia Mono. Captions at the top;
  `-narrated.mp4` is the same walkthrough with the voice (ElevenLabs), its captions the spoken
  lines. 43.0 s, 1920×1080 (16:9), all checks passed. Poster, share copy, plan and contact sheet alongside
  (`videos/coucou-setup*`).
- `videos/coucou-approve.mp4`: [Coucou](https://github.com/lalaee/coucou) end to end, ending on what
  it's for: Mochi at the top of the screen, "Hooks not installed", Settings → Install hooks (the
  exact diff for `~/.claude/settings.json`), Back up and write, Connected, and then a Claude Code
  session asks to run `npm test`: the request shows up in the island, one click on Allow, and Claude
  carries on to finished. Coucou's real interface (its `windows/` web frontend, built from the repo
  with `npx vite build`, served unmodified) running in a browser, with its native side stood in by
  `flows/coucou-web/host.js`: the hooks aren't really written (the diff is the one Coucou shows for
  an empty settings file), the Claude Code session is the real hook payloads played in order rather
  than a live `claude`, and the Settings window's title bar and the desktop are stand-ins. Captions
  at the top; `-narrated.mp4` has the voice (ElevenLabs). 46.5 s, 1920×1200 (16:10). Review: 12
  beats, 9 pass; Mochi, "done" and "Connected" show without the zoom the flow asked for (the island
  sits on the screen's top edge, where a zoom can't centre it). Poster, share copy, plan and frames
  alongside (`videos/coucou-approve*`).
- `videos/recordly-record.mp4`: Recordly recording a fresh screen on a 1440×900 desktop drawn at
  8/3 pixel density: 3840×2400, 4K at 16:10. It starts a new recording, hides the recorder,
  creates a project in Taskly while it records, stops with Ctrl+Shift+2, lands in the editor
  (asking for zooms when Recordly hasn't suggested them), trims off the start, and plays it back.
  43.8 s at 60 fps, reviewed and fixed (all 16 actions in view); contact sheet
  `videos/recordly-record-review.png`. It was recorded before the plan and readability
  changes. Recordly's own recording inside it runs at about 9 fps at this density on a machine
  without a GPU, so its playback in the preview is choppy.
- `videos/rottoways-before-after.mp4`: [Rottoways](https://github.com/lalaee/Rottoways), the design
  system pack for AI-built landing pages, as a visitor to its site sees it: the pitch, the demo's
  Before toggle (the landing page as AI tools build it by default: purple gradients, everything
  centred), After (the same page through the pack), your copy kept, how you use it (renovate or
  start new), what's in the pack, and the price. The real site, built from its repo (`vite build`,
  served with `vite preview`, `ROTTOWAYS_URL`), unmodified. Its PostHog analytics are blocked
  during recording so the run isn't counted as visits, and the checkout isn't opened (it's a real
  Polar checkout); the video ends on the price. Captions at the top; `-narrated.mp4` is the same
  walkthrough with the voice, its captions the spoken lines. 41.2 s, 1920×1200 (16:10), all checks
  passed. Poster, share copy, plan and contact sheet alongside (`videos/rottoways-before-after*`).
- `videos/umami-setup.mp4`: setting up [Umami](https://github.com/umami-software/umami) for a
  website, as a tutorial from start to finish: sign in, add the Taskly website (name and domain),
  open its settings and copy the tracking code, open Taskly with that code in its page, and back in
  Umami the visit is there (1 visitor), zoomed on the row of numbers. Each step has an
  instructional caption above the recording ("Click Add website", "Copy it into the <head> of
  your pages"). `videos/umami-setup-narrated.mp4` is the same video with voice narration
  (ElevenLabs), its captions the spoken lines, the flow paced to them: 11 lines, none overlapping, each starting with its
  step; voice at -16 LUFS. Umami is the real app (v3.4.0 from source, unmodified), and
  the visit is real: Taskly (the bundled demo page) is served locally with exactly the code that
  was copied (read off the clipboard) in its `<head>`, and Umami's own tracker counts it. Pasting
  the code into the site's HTML happens off camera, in a cut. Taskly's icon in Umami is its logo
  (Umami fetches icons from an online service this machine can't reach). 40.4 s, 1920×1200 (16:10)
  at 60 fps, all checks passed (centring included), every action checked at full size. Poster, share copy, plan and contact sheet alongside
  (`videos/umami-setup*`).
- `videos/umami-traffic.mp4`: [Umami](https://github.com/umami-software/umami) finding out where a
  spike in traffic came from. It opens on the answer, then switches Taskly's dashboard to the last
  30 days, points at the one day that towers over the rest, scrolls to Sources and clicks
  news.ycombinator.com, and the dashboard filters to it: 491 visitors from Hacker News. Umami is the
  real app (v3.4.0 built from source, on Postgres 16, unmodified). The traffic is made up but sent
  through Umami's own tracking endpoint (`/api/send`), the same one its tracker script calls
  (`flows/umami/traffic.mjs`: a seeded month of visits that grows, dips at weekends and spikes the
  day Taskly was on Hacker News), so every number on screen is Umami's own count. Site icons come
  from an online service this machine can't reach: Taskly's is its logo, every other site gets a
  grey letter tile (not that site's logo). 17.8 s, 1920×1200 (16:10) at 60 fps, all checks passed.
  Poster, share copy, plan and contact sheet alongside (`videos/umami-traffic*`).
  Setup: Postgres with a database `umami` (user and password `umami`), then in a clone of Umami
  `.env` with `DATABASE_URL=postgresql://umami:umami@localhost:5432/umami`, `pnpm install`,
  `pnpm build` and `PORT=3100 pnpm start` (or set `UMAMI_URL`). Each run starts from one fresh
  Taskly website (it deletes the others), signed in as Umami's default admin.
- `videos/localsend-send.mp4`: [LocalSend](https://github.com/localsend/localsend) sending a photo
  from the PC to a phone nearby, on the Windows 11 desktop. LocalSend is the real app (the v1.18.2
  Linux release, unmodified), driven by OCR. The phone is a stand-in: `flows/localsend/peer.mjs` is
  a LocalSend receiver speaking the published protocol (v2.2), so the app really discovers it and
  really transfers the file. Its screen (`flows/localsend/phone.html`) is mine, in LocalSend's
  colours, not LocalSend's mobile app. The PC's chip on LocalSend's sending screen says "Linux",
  because that's what it runs on here. 18.5 s, 1920×1080 at 60 fps, all checks passed. Poster,
  share copy, plan and contact sheet alongside (`videos/localsend-send*`).
  Setup: the LocalSend Linux release in `/home/user/apps/localsend` (or `LOCALSEND_APP`), and
  `apt-get install tesseract-ocr feh libayatana-appindicator3-1 libegl1 libgl1`.
- `videos/recordly-windows.mp4`: how to record on Windows with Recordly, as a tutorial from start
  to finish on a Windows 11 desktop with Taskly open. From Recordly's home: New recording, Choose
  what to record (the Taskly window, from Recordly's own picker of screens and windows), Record
  with a 3× countdown, create a project in Taskly, Stop on the recorder bar, the zoom Recordly
  suggested from the clicks, playback, and Export → "Your video is ready". The recorder bar stays
  up throughout and isn't in Recordly's recording, because it records the window.
  - Recordly is the real app, run with its interface as it is on Windows
    (`launchRecordly({platform: 'win'})`). A preload of ours reports Windows before Recordly's own
    reads the platform, so the recorder offers its screen and window picker and the window has
    Windows buttons. Underneath it runs on Linux: the capture, the picker's sources and the export
    are this machine's. One Windows-only Electron call that path makes (`screen.screenToDipRect`)
    is filled in from one Linux has.
  - Why the window, not the whole screen: on Windows, Recordly leaves its bar out of screen
    recordings. On Linux nothing can, so a whole-screen recording here would have the bar in it.
  - On Linux a window recording has the real pointer in it, so Recordly's preview shows "Animated
    cursor unavailable" and draws no smooth cursor of its own there. On Windows it would.
  - The playback is filmed in slow motion (`walkthrough/lib/slowmo.mjs`): without a GPU, Recordly
    draws its preview at about 12 fps here. During Play its clock runs 4× slower and that stretch of
    the video plays 4× faster, so the playback shows at its real speed and frame rate.
  - Drawn at 4/3 (2560×1440) so the zooms and the preview stay sharp, and exported at Recordly's
    Standard quality: 1920×1080. The wait while the export runs is cut.
  - 43.1 s at 60 fps, all checks passed (in view, centred, readable, motion, plan), and every action
    checked at full size. Poster, share copy, plan and contact sheet alongside
    (`videos/recordly-windows*`).
- `videos/demo-taskly.mp4`: the pipeline on the bundled demo page (`demo-app/`): create a project,
  open it, add two tasks, tick one off. 27 s, 1080p60, smooth motion, reviewed and fixed (all
  11 actions in view, peak zoom speed 2.6 doublings/s); its contact sheet is `videos/demo-taskly-review.png`.
