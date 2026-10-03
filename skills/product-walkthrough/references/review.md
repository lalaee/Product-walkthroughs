# Reviewing a walkthrough

Two passes, both required: the numbers (`review.mjs`), then your own eyes on every step
(`frames.mjs`) and one watch at full speed. The numbers catch framing and pacing exactly; your
eyes catch what they can't (the wrong page, a half-loaded chart, a crop that looks off).

## What `review.mjs` checks

For every beat, sampled every 50 ms through Recordly's own camera and cursor code, against the
zooms in the saved project:

- **In view**: the target as it's acted on (up to 15% clipped while the camera arrives), and the
  target plus its result over the second half of the step.
- **Centred**: once the camera has settled, the result within 12% of the view's middle, and the
  target within 20% as it's clicked. Except where the camera can't get closer: at the edge of the
  recording, or when the result fills the view.
- **Stays with the action**: until a step's result is on screen (the director notes when it
  appears; a click that opens a page shows its result only after the load), the camera doesn't
  head away from what's being acted on. The fixer starts a zoom on a result once it shows.
- **Readable**: the view holds still long enough after the step (about 0.15 s per word, 0.8 to 2 s).
- **Motion**: zoom speed at most 3.2 doublings per second; pan at most 1.2 view widths per second;
  no zoom running across a cut.
- **Plan**: total length within `plan.duration`, each milestone on time.
- **Flow**: a `show` target that never appeared, or a click that changed nothing, means the flow
  didn't do what it meant to.

It writes `review/report.md` and a contact sheet (`review/sheet.png`): the raw frame with the
needed area (green) and the camera's view (blue), then frames at the action, midway and after,
plus a frame from halfway through every camera move.

`--fix` rewrites the zooms: one per group of steps that share a middle, centred on their
results, as tight as still shows everything (at most 2×), gliding between neighbours, eased out
before cuts, run on so the last step can be read. Then render again and review again.

## What `--fix` can't fix (change the flow)

| the review says | change |
| --- | --- |
| readability: holds still for X s, needs Y s | a longer `hold` on that step |
| off-centre / misses part of what the action needs, after `--fix` | a better `show` (the whole result), or no `zoom` there |
| the flow wants a zoom here, and there's none | the step's result is too big to zoom: drop `zoom`, or show less |
| flow: `show` wasn't on screen | the step didn't do what you think: check `failure.png`/frames, wait for it |
| flow: nothing visible changed | add `show`, or the click missed: check its locator |
| plan: comes at X s, wants it by Y s | tighten earlier steps, cut waits (`d.idle`), or adjust a plan that was too ambitious (say so) |

## The look: `frames.mjs`

`node walkthrough/frames.mjs out/<flow>` writes one frame per step, taken just before the step
ends, into `out/<flow>/frames/` (and all of them in `all.jpg`). Look at every one, at full size
when in doubt:

- **Centred**: the content the step is about sits in the middle. A form at the left with empty
  space at the right, or a dialog pushed aside with the page cut off, is wrong even if the review
  passed. Fix it with `show` (the whole result) or by dropping the zoom.
- **Cut off**: a table, a row of cards, a panel cut at the edge of a zoom. Show the whole thing,
  or zoom less.
- **State**: loaded (no spinners or blank pages, unless the step is the load), the right page,
  the value typed, the dialog open.
- **Sharp**: text readable at the zoom. If it's soft, the screen needs more pixels (`scale`), or
  the zoom is too tight.
- **Cursor**: hand over buttons and links, I-beam in fields, big enough to follow.
- **Shouldn't be there**: a recorder's own controls inside its recording, dev banners, warning
  bars, crash dialogs, real people's data.

Then watch the whole video once, at full speed, for pacing: dead time, a step that flashes past,
a move that snaps, playback that looks slow or choppy.

## Common problems and their causes

- **Zoom too tight, action out of frame**: Recordly's own zooms follow the cursor at up to 2.4×.
  `--fix` reframes them; if a step still fails, its result is too big for a zoom.
- **Content off to one side**: a zoom spanning steps in different places, or a `show` that's only
  part of the result. `--fix` splits the first; the second needs the flow.
- **Sharp, snappy zooms**: the `focused` motion preset. Use `smooth` (the default).
- **Video sits still**: waits not cut. Wrap them in `d.idle`.
- **Playback slow or choppy in an app's preview**: the machine can't draw it live; use slow motion.
- **First characters of a typed path lost**: the field wasn't focused yet; click or Ctrl+L first,
  wait a moment.
- **A process won't die / the next run can't start**: kill by PID, never `pkill -f` a pattern that
  matches your own shell.
