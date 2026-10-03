# Making the app real

A walkthrough is only worth something if it shows the real product doing the real thing. The
viewer will try it afterwards. Everything below is about getting a real app into a state worth
filming without faking it, and being clear about the few places you had to.

## Run it from its repo

- Clone the repo and follow its own README to build and run it. Prefer a production build
  (`build` + `start`) over a dev server: dev servers add overlays, banners, slow first loads and
  hot-reload flicker.
- Give it what it needs for real: a Postgres or MySQL if it uses one (a local one is fine), its
  `.env` from the example file, a fresh admin account. Turn off telemetry and update checks
  where there's a setting for it.
- Use a released version (a tag) when there is one, and note it (e.g. "Umami v3.4.0").
- Don't modify the app. If you truly must (it won't start on this machine without a patch), keep
  the patch minimal, say so in the report, and never change what the viewer sees.

## A clean starting state, every run

Each recording should start from the same state, so a re-record is comparable and a failed run
doesn't leave junk behind. Do it in the flow's `setup` (page flows) or `launch` (desktop flows):

- Reset through the app's API: delete what the last run created (e.g. all websites), then create
  what the flow starts from.
- Start desktop apps with a fresh home or profile directory and the settings a first-time user
  would have, minus the noise (an onboarding tour the flow isn't about, a "what's new" popup).
- Sign in off camera when signing in isn't part of the flow (log in through the API and put the
  token where the app keeps it). When the flow *is* setting up, show the sign-in.

## Data: through the app's own front door

A dashboard with no data is a poor demo; a dashboard with made-up numbers drawn on top is a lie.
Put realistic data **in**, and let the app compute what it shows:

- Use the app's API, import, or ingestion endpoint: the same path real data takes. For Umami that
  was `/api/send`, the endpoint its own tracker calls, with the time, IP and browser of each
  visit, so Umami itself worked out sessions, countries and devices
  (`flows/umami/traffic.mjs`).
- Make it plausible: a seeded random generator (same data every run), growth over time, weekday
  and weekend patterns, a realistic mix of sources, one notable event if the story needs it.
- Better still, when the flow allows: generate the data by using the product. In the Umami setup
  video the visit at the end is a real visit, from a real page carrying the tracking code that was
  copied on camera.

## Stand-ins

Some flows need something you can't run: a phone, a third-party service, the internet. Then:

- Make the stand-in **real enough to exercise the app for real**: a peer that speaks the app's
  published protocol (`flows/localsend/peer.mjs` is a LocalSend receiver, so the app really
  discovers it and really sends the file); a local route answering what the app asks an
  unreachable service for (`flows/umami/icons.mjs` answers favicon requests).
- Keep it visually honest: neutral placeholders rather than another company's logo; a stand-in
  screen in the app's own style, not a copy of their mobile app.
- Write it down. Every stand-in goes in the report and the README entry.

## Off camera, and when to say so

Cuts are fine for things the viewer needn't watch (waiting for a page, a file picker, an export
running, trimming a recording). They're still part of what happened: if a cut hides a step the
viewer would have to do themselves (pasting code into their HTML, say), mention it in the report.

Anything run differently from how a user would see it must be disclosed: a platform interface
shown on a different OS underneath, a slow-motion capture played back at real speed, a window
recorded instead of the whole screen because the OS can't exclude a window.

## The report

End with a short, plain account the user can pass on:

- **Real:** the app (version, built from source, unmodified), the backend, the data path.
- **Stand-ins:** what, why, and how close to real.
- **Off camera / different:** cuts that hide a user step, slow motion, platform differences.
- **Not passing:** any check that missed, with its number.
