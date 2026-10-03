# Running the Design to AI walkthrough on your own machine

This records the Framer plugin flow for real: the Aurel project on the Framer canvas → select the
Hero Container component → open **Design to AI** → enter the license → **Copy Prompt** → a terminal
where **Claude Code** builds the component from that prompt.

It has to run on a normal machine (your laptop, or a cloud box on an ordinary network). It does
**not** work in the Claude Code cloud environment, because that environment's egress proxy drops
WebSocket connections and Framer's editor needs one to load ("Connecting… Editing is disabled").

macOS and Linux both work. On macOS the browser uses your real screen; on Linux you need a virtual
screen (Xvfb). Steps below note where they differ.

---

## 1. Install the system packages (once)

**Linux (Debian/Ubuntu):**

```sh
sudo apt-get update
sudo apt-get install -y xvfb ffmpeg xdotool openbox xcompmgr feh tesseract-ocr \
  libayatana-appindicator3-1 libegl1 libgl1 fonts-noto fonts-noto-color-emoji fonts-inter \
  libnss3-tools
```

**macOS (Homebrew):**

```sh
brew install ffmpeg tesseract
# Xvfb/xdotool are not needed on macOS; the browser uses your display.
```

You also need **Node 20+** and **Rust** (Recordly builds a native module). Check:

```sh
node -v    # v20 or newer
cargo -V   # any recent stable; install from https://rustup.rs if missing
```

---

## 2. Get the three repos

```sh
# the pipeline (this repo)
git clone https://github.com/lalaee/Product-walkthroughs walkthroughs
cd walkthroughs
npm install

# Recordly (the recorder), cloned NEXT TO the pipeline
git clone https://github.com/lalaee/Recorder-2 ../recorder-2
(cd ../recorder-2 && npm ci && npm run build:native && npm run build)

# the plugin, anywhere you like
git clone https://github.com/lalaee/DesigntoAI-Plugin-Cloud ../designtoai-plugin-cloud
(cd ../designtoai-plugin-cloud && npm install)
```

If Recordly's Electron binary is missing after `npm ci` (no network during postinstall):
`node node_modules/electron/install.js` inside `../recorder-2`.

Confirm the pipeline itself works before touching Framer:

```sh
node walkthrough/record.mjs flows/demo-taskly.mjs && node walkthrough/render.mjs out/demo-taskly
```

That must end with `exported … → out/demo-taskly/demo-taskly.mp4`. If it doesn't, fix setup first
(`skills/product-walkthrough/references/setup.md` lists the common snags).

---

## 3. Start the plugin's dev server

Framer loads a development plugin from a local HTTPS URL. In the plugin repo:

```sh
cd ../designtoai-plugin-cloud
npm run dev            # serves the plugin UI at https://localhost:5173
```

Leave it running. The first time, open `https://localhost:5173` in your browser once and accept the
self-signed certificate, or Framer can't load it.

---

## 4. Sign in to Framer and export your session

Framer's automated login trips a bot check ("Verification failed"), so you sign in by hand once and
let the recording reuse that session.

1. In a normal browser, sign in to Framer as **lakesofmotion@gmail.com**.
2. Open the project: `https://framer.com/projects/Aurel-copy--HlcEhT7ZoRFPQ7heveT0-dwiQb`
3. With that tab open and signed in, export cookies to a `cookies.txt` (Netscape format) using a
   "cookies.txt" browser extension. Export **framer.com** at least.
4. Save it somewhere outside the repos, e.g. `~/.framer-cookies.txt`, and **don't sign out** of that
   browser afterwards — signing out invalidates the session the cookies point to.

Keep `cookies.txt` private; never commit it.

---

## 5. Load the plugin in Framer once (manual, to confirm it works)

Before recording, prove the plugin runs on your machine:

1. In the Framer project, **Plugins → Development → Open Development Plugin**, URL
   `https://localhost:5173`.
2. Select the **Hero Container** component on the canvas.
3. In the plugin panel, paste the license `21B7ECD4-A8A3-4280-BF4F-E083B59C612D` and activate.
4. Click **Copy Prompt** — it should copy a self-contained prompt to your clipboard.

If all four work, the recording will too.

---

## 6. The flow file

The flow module for this walkthrough lives at `flows/designtoai-plugin.mjs`. It is a **desktop
flow**: Framer in a browser window, plus a terminal window where Claude Code runs the pasted prompt.
It points at Framer and the plugin through environment variables with sensible defaults, so you only
override what's specific to you:

```sh
export FRAMER_PROJECT="https://framer.com/projects/Aurel-copy--HlcEhT7ZoRFPQ7heveT0-dwiQb?node=augiA20Il"
export FRAMER_COOKIES="$HOME/.framer-cookies.txt"
export PLUGIN_DEV_URL="https://localhost:5173"
export DESIGNTOAI_LICENSE="21B7ECD4-A8A3-4280-BF4F-E083B59C612D"   # read by the flow, never printed
```

The flow is a **best-effort draft**. The plugin-panel steps (license field, Activate, Copy prompt)
and the terminal/Claude Code ending use selectors read from the real plugin source and should work
as written. Two steps touch Framer's own obfuscated canvas UI and are marked **«CONFIRM LOCALLY»**
in the file: selecting the Hero Container, and the Plugins → Development menu path. Open the project
once (step 5 above), see how those read, and adjust those two locators. Everything else is wired up.

---

## 7. Record, render, review

From the pipeline root, with the plugin dev server (step 3) still running:

```sh
# Linux only: a virtual screen (macOS skips this)
Xvfb :99 -screen 0 1920x1080x24 &
export DISPLAY=:99

node walkthrough/record.mjs flows/designtoai-plugin.mjs
node walkthrough/render.mjs  out/designtoai-plugin
node walkthrough/review.mjs  out/designtoai-plugin           # the numbers
node walkthrough/review.mjs  out/designtoai-plugin --fix     # reframe zooms, then render + review again
node walkthrough/frames.mjs  out/designtoai-plugin           # look at every step with your own eyes
```

The result is `out/designtoai-plugin/designtoai-plugin.mp4`.

**Optional narration** (ElevenLabs):

```sh
export ELEVENLABS_API_KEY=...     # your key; never commit it
node walkthrough/record.mjs flows/designtoai-plugin.mjs       # regenerates voice.json
node walkthrough/render.mjs  out/designtoai-plugin --narrated
node walkthrough/finish.mjs  out/designtoai-plugin --narrated
python3 walkthrough/hear.py  out/designtoai-plugin            # checks the voice matches the script
```

---

## 8. When you're done

- Delete your `cookies.txt` and any browser profile the flow created.
- Don't commit the license, the cookies, or the ElevenLabs key.

---

## If Framer still won't open the editor locally

It should, on an ordinary network. If it doesn't:

- Make sure nothing on your network is a TLS-intercepting / WebSocket-dropping proxy (corporate
  networks sometimes are — the same thing that blocks the cloud environment).
- Confirm you're signed in and the cookies are fresh (redo step 4).
- Try a different network (phone hotspot) to rule the network out.
