// The stand-in for Coucou's native (Rust/Tauri) side, for recording Coucou's real web interface in a
// browser. The island (index.html) and the Settings window (settings.html) are Coucou's own built
// frontend, unmodified; each runs in an iframe whose `window.__TAURI_INTERNALS__` (frame.js) forwards
// here. This answers the commands the interface sends (boot, hooks status/preview/apply, window
// sizing, approvals…) and emits the events Rust would (`hook`, `settings-changed`), so a flow can make
// a Claude Code permission request appear on cue.
//
// What's simulated, and says so in the video's notes: the hooks aren't written to a real
// ~/.claude/settings.json (the diff is the one the app would show for an empty file), and the Claude
// Code session is a scripted sequence of the real hook payloads, not a live `claude`.
(() => {
  const HOME = '/home/you';
  const HOOK = `${HOME}/.local/share/coucou/bin/coucou-hook`;
  const SETTINGS_JSON = `${HOME}/.claude/settings.json`;
  // The events Coucou installs, in its order, with their timeouts (src-tauri/src/hooks.rs HOOK_EVENTS)
  const HOOK_EVENTS = [['SessionStart', 10], ['SessionEnd', 10], ['UserPromptSubmit', 10], ['PreToolUse', 10],
    ['PostToolUse', 10], ['PostToolUseFailure', 10], ['PermissionRequest', 120], ['Notification', 10],
    ['Stop', 10], ['StopFailure', 10], ['SubagentStart', 10], ['SubagentStop', 10]];

  const state = {
    settings: {
      soundEnabled: false, soundVolume: 0.12, autoCloseInterval: 600, absenceInterval: 180,
      activeIntegrations: ['integration_resend', 'integration_n8n', 'integration_vercel', 'integration_github'],
      screen: 'primary', autostart: false, hooksInstalled: false, model: 'claude-opus-5'
    },
    decisions: []
  };

  // what `hooks_preview` would show for an empty settings.json: the old file, then the new one, line
  // by line (hooks.rs line_diff: "- " old, "+ " new), serde_json's two-space pretty printing
  function hooksDiff() {
    const hooks = {};
    for (const [e, t] of HOOK_EVENTS) hooks[e] = [{hooks: [{type: 'command', command: `'${HOOK}' ${e}`, timeout: t}]}];
    const next = JSON.stringify({hooks}, null, 2).split('\n');
    return ['- {}', ...next.map(l => `+ ${l}`)].join('\n');
  }
  const stamp = () => {
    const d = new Date(), p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  };

  // event listeners per frame: id → {frame, event, cb}
  const listeners = new Map();
  let nextId = 1;
  const callbacks = new Map();
  function emit(event, payload, only) {
    for (const l of listeners.values()) {
      if (l.event !== event || (only && l.label !== only)) continue;
      const cb = callbacks.get(l.handler);
      try { cb?.({event, id: l.id, payload}); } catch (e) { console.error(e); }
    }
  }

  const frames = {island: document.getElementById('island'), settings: document.getElementById('settings')};
  const settingsWindow = document.getElementById('settings-window');

  // Click-through outside the island's shape, as the real window does (set_island_rect / set_collapsed):
  // the frame takes the pointer only inside that rectangle, so the Settings window under it stays usable.
  let islandRect = {x: 0, y: 0, w: 720, h: 320};
  const WAKE_STRIP = {x: 240, y: 0, w: 240, h: 8};
  function trackPointer(doc, offset) {
    doc.addEventListener('mousemove', e => {
      const r = frames.island.getBoundingClientRect();
      const x = e.clientX + offset().x - r.left, y = e.clientY + offset().y - r.top;
      const inside = x >= islandRect.x && x <= islandRect.x + islandRect.w && y >= islandRect.y && y <= islandRect.y + islandRect.h;
      frames.island.style.pointerEvents = inside ? 'auto' : 'none';
    }, true);
  }
  trackPointer(document, () => ({x: 0, y: 0}));
  frames.island.addEventListener('load', () => {
    trackPointer(frames.island.contentDocument, () => { const r = frames.island.getBoundingClientRect(); return {x: r.left, y: r.top}; });
  });

  async function command(label, cmd, args = {}) {
    switch (cmd) {
      case 'plugin:event|listen': {
        const id = nextId++;
        listeners.set(id, {id, label, event: args.event, handler: args.handler});
        return id;
      }
      case 'plugin:event|unlisten': listeners.delete(args.eventId); return null;
      case 'boot': return {
        settings: state.settings, version: '0.1.1', hookPath: HOOK, cursorPoll: false,
        screen: {x: 0, y: 0, width: innerWidth, height: innerHeight, scale: 1}
      };
      case 'save_settings':
        state.settings = {...state.settings, ...args.settings};
        emit('settings-changed', state.settings);
        return null;
      case 'hooks_status': return {installed: state.settings.hooksInstalled, settingsPath: SETTINGS_JSON, hookPath: HOOK, hookReady: true};
      case 'hooks_preview': return {diff: hooksDiff(), backup: `${SETTINGS_JSON}.bak-${stamp()}`, settingsPath: SETTINGS_JSON, fingerprint: 'empty'};
      case 'hooks_apply': {
        state.settings.hooksInstalled = !!args.install;
        emit('settings-changed', state.settings);
        return `${SETTINGS_JSON}.bak-${stamp()}`;
      }
      case 'open_settings_window':
        if (!frames.settings.src) frames.settings.src = '/settings.html';
        settingsWindow.hidden = false;
        return null;
      case 'secret_present': return false;
      case 'approval_ack': return null;
      case 'approval_decline': return null;
      case 'approval_decision':
        state.decisions.push({requestId: args.requestId, decision: args.decision});
        window.coucou.onDecision?.(args.requestId, args.decision);
        return null;
      case 'set_island_rect': islandRect = {x: args.x, y: args.y, w: args.width, h: args.height}; return null;
      case 'set_collapsed': if (args.collapsed) islandRect = WAKE_STRIP; return null;
      default: return null; // focus, logging, integrations: nothing to do in a page
    }
  }

  // what frame.js calls from inside each iframe
  window.__coucouHost = {
    invoke: (label, cmd, args) => command(label, cmd, args),
    transformCallback(cb) { const id = nextId++; callbacks.set(id, cb); return id; }
  };

  // ── for the flow ────────────────────────────────────────────────────────────
  const session = 'sess-demo-1', cwd = `${HOME}/my-app`;
  const hook = payload => emit('hook', {session_id: session, cwd, transcript_path: `${HOME}/.claude/projects/my-app/${session}.jsonl`, ...payload}, 'island');
  window.coucou = {
    state,
    closeSettings() { settingsWindow.hidden = true; },
    /** A Claude Code session asks to run `command`: the real hook payloads, in order. */
    async permissionRequest(command, prompt) {
      hook({hook_event_name: 'SessionStart', source: 'startup'});
      await new Promise(r => setTimeout(r, 300));
      hook({hook_event_name: 'UserPromptSubmit', prompt});
      await new Promise(r => setTimeout(r, 600));
      hook({hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: {command, description: 'Run the tests'}});
      await new Promise(r => setTimeout(r, 300));
      const requestId = `req-${Date.now()}`;
      hook({hook_event_name: 'PermissionRequest', request_id: requestId, tool_name: 'Bash', tool_input: {command, description: 'Run the tests'}});
      return requestId;
    },
    /** After an approval, what the session does next: the command runs, Claude finishes. */
    async finish(command, output) {
      hook({hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: {command}, tool_response: {stdout: output, stderr: '', interrupted: false}});
      await new Promise(r => setTimeout(r, 500));
      hook({hook_event_name: 'Stop', stop_hook_active: false});
    }
  };
})();
