// Stands in for the `framer-plugin` package (Framer's plugin API) so Design to AI's real interface can
// run in a page outside Framer: build.mjs aliases the bare `framer-plugin` import to this file and
// nothing else (`framer-plugin/framer.css`, Framer's own plugin stylesheet, is the real one). Inside
// Framer these calls go to the editor; here the host page decides what's selected on the "canvas"
// (window.__framerStandin.select), and everything the plugin only tells Framer (panel size, menu,
// notifications) is a no-op.
let selection = [];
const subscribers = new Set();

// The theme Framer puts on a plugin's document: the attribute framer.css keys its dark styles on, and
// the background variable the plugin reads its theme from (App.tsx detectThemeFromDOM).
document.documentElement.setAttribute('data-framer-theme', 'dark');
document.documentElement.style.setProperty('--framer-color-bg', '#111111');

export const framer = {
  showUI() {},
  setMenu() {},
  notify() {},
  on() { return () => {}; },
  ui: {postMessage() {}},
  async getSelection() { return selection; },
  subscribeToSelection(cb) { subscribers.add(cb); return () => subscribers.delete(cb); },
  async getColorStyles() { return []; },
  async getTextStyles() { return []; }
};
export default framer;

window.__framerStandin = {
  /** What the host page has selected on its canvas: Framer nodes, as {id, name, __class, insertURL}. */
  select(nodes) {
    selection = nodes.map(n => ({getChildren: async () => [], ...n}));
    for (const cb of subscribers) cb(selection);
  }
};
