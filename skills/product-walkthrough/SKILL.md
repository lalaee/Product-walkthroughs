---
name: product-walkthrough
description: "Turn an app's repo into a polished, tutorial-style product walkthrough video: run the real app from its source, script one key flow, record it with Recordly (Recorder-2) for smooth auto-zooms and a redrawn cursor, then review it frame by frame until every step is centred, readable and honest. Use this whenever someone wants a demo video, product walkthrough, tutorial video, screen recording, explainer or launch video of an app, a GitHub repo, a web app, or a desktop app, even if they don't say \"walkthrough\" (e.g. \"record how X works\", \"make a video of setting up Y\", \"show the signup flow in a video\")."
---

# Product walkthrough

You are making a short video that walks a viewer through one real flow of an app, A to B, the
way a good presenter would: every click deliberate, the camera zoomed where the detail is, each
step on screen long enough to read, nothing faked without saying so.

The pipeline that does the recording and finishing lives in this repo
(https://github.com/lalaee/Product-walkthroughs; `walkthrough/`). Your part is everything around it,
and that's what decides whether the video is good: which flow, how the app is made real, how
each step is scripted, and what you check before calling it done.

If you're working in the app's own repo, clone the pipeline next to it (`references/setup.md`),
write the flow in the pipeline's `flows/`, and run the commands below from the pipeline's root.
Paths to scripts and example flows are relative to that root; `references/` is next to this file.
Point the flow at the app through an environment variable with a sensible default
(`UMAMI_URL ?? 'http://localhost:3100'`, `LOCALSEND_APP ?? '/home/user/apps/localsend/…'`), never a
hard-coded path into someone's checkout.

Work through the steps in order. Each one has a reference file with the detail; read it when you
get there, not all at once.

## 0. Set up the machine (once)

Linux with Xvfb, ffmpeg, Chromium (Playwright's), Node 20+, and Recorder-2 built next to this repo.
Details and the full package list: `references/setup.md`. Check it works with the demo before
touching the user's app (`node walkthrough/record.mjs flows/demo-taskly.mjs` then the render
step); a broken setup found later costs a full recording cycle. If Recorder-2 won't build or the
demo won't render, stop and tell the user what failed: the finished video depends on it, and a
screen recording without it isn't this product.

## 1. Get the real app running

Read the app's README and docs, then build and run the real app, unmodified; don't rebuild its
UI. Its own release (a tagged binary, the official image) counts as the real app; so does a
build from source. Use whichever runs on this machine (Docker often isn't available in agent
containers), and say which in the report. If it needs a
database, run one. If a screen needs data (a dashboard with traffic, a list with items), put it
there **through the app's own API or import**, so every number on screen is the app's own.

Where you have to stand something in (a phone the app talks to, a site icon from a service you
can't reach, a backend you don't have), make the stand-in real enough to exercise the app for
real, and write down what it is: it goes in the report and the README.

Every run should start from the same state. If the flow goes through a one-time first-run
screen (create the admin, set up the instance), each run needs a **fresh instance** (a new data
directory or database), started by the flow's `setup` and stopped by its `teardown`. Otherwise,
reset through the app's API in `setup`.

Detail, including clean state, seeding, stand-ins and what to disclose:
`references/making-it-real.md`.

## 2. Pick the flow

With the app running in front of you (step 1), pick **one** flow:

- The one a new user needs first is usually the best: setting it up, the first real task, the
  "aha" moment. "Set up analytics for your website" beat "find where a traffic spike came from"
  because a viewer can follow it and do it themselves.
- 5 to 12 steps, 20 to 45 seconds. Shorter is better if the flow is complete.
- It must end on a visible result (the visit counted, the file on the phone, the video exported).

If the user named a flow, use it. If there are two good candidates, say which you'd pick and why,
and go on unless they object.

Write the plan into the flow file (`export const plan`): what the app is, who it's for, the
steps, a target duration and two or three milestones ("Add website by 8 s"). The review holds the
video to it.

**Tutorial order, no hook.** Start at the beginning of the flow and go to the end. Don't open on
the payoff and cut back; it confuses someone trying to follow along.

## 3. Script the flow

A flow is a small ES module in `flows/`. A web app is a **page flow** (`url`, `setup(page)`,
`run(d, page)`); a desktop app or anything spanning windows is a **desktop flow** (`desktop = true`,
`launch(ctx)`, `run(d, ctx)`). Copy the closest example:

- `flows/umami-setup.mjs`: web app, real backend, sign-in → configure → result. The reference
  example: it's the one people liked best.
- `flows/recordly-windows.mjs`: desktop app on a Windows 11 desktop, several windows.
- `flows/localsend-send.mjs`: native (Flutter) app driven by on-screen text (OCR), with a stand-in
  peer.

The director `d` acts like a presenter: `d.click`, `d.type`, `d.press`, `d.point`, `d.scroll`, and
`d.idle` / `d.fast` to cut or speed up waits. For every step, think about three things:

1. **`show`: what the viewer must see once the step has played out.** Give the whole result: the
   dialog it opens, the whole new table row, the whole row of numbers. Not a word inside it.
   The camera centres on `show`, so a too-small `show` puts the content off to one side.
2. **`hold`: how long it stays still.** Enough to read it: about 0.15 s per word of visible
   labels, 0.8 s minimum, 2 to 3 s for a dense panel. The video's pace comes from holds.
3. **`zoom`: only where detail matters** (a form field, a code snippet, the final number). Wide
   results (a full page, a whole table) read better unzoomed.

Give each step that starts something new a short instructional **caption** (`caption: 'Click
Add website'`, one line); it stays up until the next one. Write them before scripting the
holds, as a list of scenes: if a caption needs more time to read than its step lasts, the hold
is too short.

Cut anything the viewer needn't wait through (`d.idle`): page loads, an export running, a file
dialog. Speed up countdowns (`d.fast`). Do what a user would do: if a user would click Stop,
click Stop, not a keyboard shortcut.

Full API, the flow exports (size, scale, aspect, plan, poster, share), and patterns:
`references/flow-authoring.md`. Desktop apps, OCR, the Windows desktop and recording Recordly
itself: `references/desktop-apps.md`.

## 4. Record, render, fix, review

```sh
node walkthrough/record.mjs flows/<flow>.mjs       # → out/<flow>/library (fails fast with failure.png)
node walkthrough/render.mjs out/<flow>             # Recordly suggests zooms and exports
node walkthrough/review.mjs out/<flow> --fix       # reframes every zoom against Recordly's own camera
node walkthrough/render.mjs out/<flow>             # export with the fixed zooms
node walkthrough/review.mjs out/<flow>             # must pass
node walkthrough/frames.mjs out/<flow>             # one full-size frame per step, to look at
```

If `record.mjs` fails, read `failure.png` and the error before changing anything. Renders take
minutes; run long chains in the background where your agent can.

`review.mjs` checks every step, sampled every 50 ms through Recordly's own camera code: target
and result in view, the result **centred** (within 12% of the middle), readable (still long
enough), motion not too sharp, the plan's length and milestones. `--fix` repairs zoom framing;
it can't lengthen a hold or change what a step shows. When a beat fails on readability or
framing that `--fix` can't solve, change the flow (`hold`, `show`, `zoom`) and record again.

## 5. Look at every frame yourself

The numbers can't see everything. Open `out/<flow>/frames/all.jpg` (and individual frames at
full size when in doubt) and check each step:

- Is what the step is about in the **middle** of the frame, with nothing important cut off at an
  edge? (A form pushed to the left with empty space on the right is a fail even if it's "in view".)
- Is the screen in the right **state**: loaded, the right page, the dialog open, the value typed?
- Is it **sharp**, and is the text readable at the zoom?
- Does the **caption** say what's happening on screen right now?
- Does the cursor look right: a hand over buttons and links, the I-beam in fields, big enough?
- Anything that shouldn't be there: a recorder bar inside a recording, a dev banner, a crash
  dialog, someone's real data?

Also watch the video once at full speed for pacing: dead time, a step that flashes past, a
camera move that snaps. `references/review.md` has the checks, the common failures and their
fixes.

Fix, re-record, and look again until it's right. Two or three rounds is normal.

## 6. Finish and report

```sh
node walkthrough/finish.mjs out/<flow>   # poster frame (also frame 0) and share copy
```

Copy the video, poster, share text, plan and contact sheet to `videos/`, add an entry to the
README's video list, and commit. Then tell the user, plainly:

- what the video shows, step by step, and its length and size;
- **what's real and what isn't**: the app (built from its repo, unmodified?), the data (seeded
  how?), any stand-ins, anything cut or sped up, anything run differently from how a user would
  see it (e.g. slow-motion capture of a playback);
- anything that didn't pass, with the number, rather than rounding it to "all good".

## Defaults that came from feedback

These came from people watching the results; keep them unless the user asks otherwise.

- **HD, not 4K**: 1440×900 at 4/3 density (1920×1200, 16:10) for web apps; 1920×1080 at 4/3 with
  Recordly's Standard export (1920×1080) for desktops. 4K is slow to make and heavy to share.
- **Smooth** zoom motion (Recordly's `smooth` preset), at most 2×, centred on the content.
- **Bigger cursor**: Recordly's cursor at 2.5× (`render.mjs --cursor`, the default).
- **No dead time**: cut waits and loading; the video should never sit still without a reason.
- **Subtitles first**: big instructional captions in Inter, in a band below the recording.
  A voice (ElevenLabs) is an option for those who want one and have a key: see "Narration" in
  `references/flow-authoring.md`. It gives a second, narrated copy of the video.
- **Real-time playback**: if the video shows something playing (a video, an animation) and the
  machine can't draw it at full speed, film it in slow motion (`walkthrough/lib/slowmo.mjs`) so
  it plays at its real speed; say so in the report.
- **The recorder never records itself**: when the app being shown is a recorder, its own
  controls must not appear in what it records.
