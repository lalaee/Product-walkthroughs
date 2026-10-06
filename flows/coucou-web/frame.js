// Loaded first in Coucou's own pages (index.html, settings.html) when they run inside host.html: the
// window.__TAURI_INTERNALS__ that @tauri-apps/api talks to, forwarding to host.js in the parent page.
(() => {
  const label = location.pathname.includes('settings') ? 'settings' : 'island';
  const host = parent.__coucouHost;
  if (!host) return;
  window.__TAURI_INTERNALS__ = {
    invoke: (cmd, args) => host.invoke(label, cmd, args ?? {}),
    transformCallback: cb => host.transformCallback(cb),
    unregisterCallback: () => {},
    convertFileSrc: p => p,
    metadata: {currentWindow: {label}, currentWebview: {windowLabel: label, label}}
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = {unregisterListener: () => {}};
})();
