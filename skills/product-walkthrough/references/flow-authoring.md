# Writing a flow

A flow is an ES module in `flows/<name>.mjs`. `record.mjs` imports it, opens the browser (page
flows) or the desktop (desktop flows), calls the flow's `setup` / `launch` to get the app ready,
and hands `run()` a director `d` that performs the steps like a presenter and logs each one as a **beat**
(what was acted on, what it should show, how long it held) for the review.

## Exports

| export | what it's for |
| --- | --- |
| `name` | the video's title (Recordly project name) |
| `url` | page flows: where the browser starts (`export let url`, so `setup` can change it) |
| `setup(page)` | page flows: get the app ready before recording: start it if the flow needs a fresh instance, reset state, seed data, route requests |
| `teardown()` | page flows: stop what `setup` started (a server, a temp directory); called whether or not `setup` or `run` failed |
| `run(d, page)` / `run(d, ctx)` | the steps |
| `desktop = true`, `launch(ctx)` | desktop flows: start the apps, return what `run` needs and `close()` (see `desktop-apps.md`) |
| `background` | desktop flows: wallpaper image or HTML page (e.g. `'../desktops/windows11/desktop.html'`) |
| `size` | the screen in points: `'1440x900'` for web apps, `'1920x1080'` for desktops |
| `scale` | pixel density: `4/3` gives HD with room to zoom (1440×900 → 1920×1200) |
| `aspect` | the video's shape in Recordly: `'16:10'`, `'16:9'`, `'1:1'`… |
| `quality` | Recordly's export quality: `'original'` (default), `'high'` (0.9), `'standard'` (0.75) |
| `lead` | ms of the starting screen before the first step (default 1200; 400 to 600 reads better) |
| `plan` | `{what, audience, flow: [steps], duration: [min, max], milestones: [{beat, by}]}`; `duration` and `by` are seconds of the **finished** video (after cuts and speed-ups); `beat` is a step's `label` |
| `poster` | label of the beat whose end makes the poster frame (usually the result) |
| `share` | a one or two sentence caption for posting the video. A string; to use a value read on screen, `export let share` and assign it at the end of `run` |

## The director

Targets are Playwright locators (or selectors in page flows), `{x, y}` points, or `{x, y, w, h}`
boxes. In desktop flows, also OCR'd text: `win.text('Send')` (see `desktop-apps.md`).

| call | does |
| --- | --- |
| `d.click(target, {hold, show, label, zoom, after})` | travel, click, hold. With `after: async () => …`, that runs instead of the hold (150 ms after the click) and the step ends when it resolves: use it for something that happens *as part of* the step and is filmed, like playback in slow motion. To wait for something the viewer needn't see (a navigation), use `d.idle` after the click instead |
| `d.type(target, text, {delay, hold, show, label, zoom})` | click the field, type at a readable pace. Works on rich editors too (CodeMirror, ProseMirror, Lexical): target the editable element, and `show` the whole editor card |
| `d.press(key, {hold, show, label})` | a key or shortcut (`'Control+Shift+2'`); shortcuts show as keycaps |
| `d.point(target, {hold, show, label, zoom})` | travel and rest on something: draws the eye without clicking |
| `d.scroll(target, {hold, show, label})` | smooth-scroll until the target is mid-screen |
| `d.idle(fn, {keep})` | do `fn` (waits, page loads, housekeeping) and cut it from the video, keeping `keep` ms either side |
| `d.fast(fn, {speed})` | do `fn` and play that stretch `speed`× faster (countdowns, progress bars) |
| `d.wait(ms)` | a plain wait (inside `idle`/`fast`, usually) |

Every call also takes `caption: 'Click Add website'`: an instructional subtitle for that step
(see "Captions" below).

`label` names the step in the review and the frames; give every step a short, human one
("Add website", "the tracking code"). It's also how `plan.milestones` and `poster` refer to it.

## The three decisions per step

### `show`: the whole result

What should the viewer see once the step has played out? The camera frames it and the review
centres on it, so:

- Give the **whole** result element: the dialog (`page.getByRole('dialog')`), the new table row
  (`page.getByRole('row', {name: /Taskly/})`), the row of stat cards (`[card('Visitors'),
  card('Views')]`), the code panel. A word or a link inside it puts the content off-centre.
- For a click that navigates, show the main thing on the new page, not a button in its corner.
- A list of locators is fine; they're joined.
- No `show` means "whatever changed on screen", which is too much when a dialog dims the page.

### `hold`: long enough to read

`hold` is the time after the action itself (after the click, after the last typed character);
the pointer's travel comes before it and isn't counted. Camera moves happen during it, so the
review measures how long the view is actually still. Roughly 0.15 s per visible word (labels are read at a glance), at least 0.8 s, 2 to 3 s for a
dense panel or code. The review measures how long the camera actually stays still and fails a
step that's too short. Since zoom transitions eat into a hold, give the steps that matter (the
result, a code snippet, the final number) the most.

### `zoom`: only where the detail is

Ask for a zoom (`zoom: 1.6`, at most 2) on steps where the detail matters: a form being filled,
a snippet, the result. Leave wide results unzoomed: a whole page, a table, a desktop with
several windows.

A zoom isn't per step: the fixer puts neighbouring steps whose results share a middle into one
zoom. So ask for it on the first step of a group (the first field of a form) and give the
following steps the same `show` (the form): the camera stays put through all of them. The
review's fixer adds the zooms you asked for, centres every zoom on its
step's result, splits a zoom whose steps need different places, and removes zooms that can't
frame their steps.

## Captions

Walkthroughs carry big instructional subtitles, not narration. Give the steps that start
something new a `caption` (one short instruction, at most 48 characters; `record.mjs` refuses
longer ones), and leave the steps that continue it without one: a caption stays up until the
next. Write them as what to do or what you're looking at, in the viewer's terms:

- "Sign in to Umami", "Click Add website", "Enter a name and your site's domain"
- "This is your tracking code", "Copy it into the <head> of your pages"
- end on the result: "…and Umami counts the visit"

Each comes up a moment (0.35 s) before its step. Recordly draws them (its captions track, Inter
Bold, about 4.7% of the frame height) in a band of background below the recording, so they never
cover the app; `review.mjs --fix` and `render.mjs` write them into the project
(`walkthrough/lib/captions.mjs`). Check in the frames that every caption matches what's on screen.

## Patterns

**Sign-in, then the real work.** Show signing in when the flow is setting up; otherwise sign in
during `setup` (API login, token into storage) and start on the first real screen.

**Cut the waits.** Wrap page loads, background jobs and anything the viewer would sit through:

```js
await d.idle(async () => {
  await page.goto(overview);
  await page.getByText('Visitors', {exact: true}).first().waitFor();
  await d.wait(1500);           // let charts finish drawing before the cut ends
}, {keep: 0});
```

**Prove it worked with the product.** End on the product's own evidence: the counter that went
up, the item in the list, the file received. In `flows/umami-setup.mjs` the tracking code copied
on camera is put into a real page (read off the clipboard), the page is visited, and Umami counts
the visit.

**Read values off the screen** rather than hard-coding them in copy: `share` can be set at the
end of `run` from what the app shows.

**Slow-motion capture for heavy playback.** If the step plays something the machine can't draw at
full speed (an editor previewing a video, an animation), run the page's clock slower and play
that stretch faster: see `walkthrough/lib/slowmo.mjs` and `finishInEditor(…, {slow: 4})` in
`flows/recordly-steps.mjs`. The viewer sees it at real speed and frame rate. Disclose it.

**Menus, dropdowns and popovers.** Open it with a click whose `show` is the menu (the listbox or
popover, not its trigger), then click the option; picking closes it. To close it without
choosing (looking is the point), `d.press('Escape')`. Don't zoom on a menu that drops over a wide
area; zoom on its trigger's neighbourhood or not at all.

**Do what a user does.** Click the button a user would click, not a shortcut they wouldn't know;
pick the option a first-time user would pick.

## An example: `flows/umami-setup.mjs`, step 2

```js
// 2. add the website
await d.click(page.getByRole('button', {name: 'Add website'}), {hold: 1100, show: page.getByRole('dialog'), label: 'Add website'});
const dialog = page.getByRole('dialog');
await d.type(dialog.locator('input[name=name]'), 'Taskly', {hold: 800, label: 'Name', zoom: 1.6, show: dialog});
await d.type(dialog.locator('input[name=domain]'), 'taskly.app', {label: 'Domain', show: dialog});
await d.click(dialog.getByRole('button', {name: 'Save'}), {hold: 1200, show: page.getByRole('row', {name: /Taskly/}), label: 'Save'});
```

The dialog is the result of opening it and stays the `show` while it's filled in (so the zoom
holds still on it); after Save, the result is the new row in the list.
