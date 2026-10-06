// The host page around Design to AI's real interface: the editor (a screenshot of Framer, from
// /backdrop, with the component's place on it from /layout.json), the plugin's floating window, and
// window.host for the flow: open the plugin, select the component.
(async () => {
  const layout = await (await fetch('/layout.json')).json();
  const backdrop = document.getElementById('backdrop'), component = document.getElementById('component');
  const win = document.getElementById('plugin-window'), frame = document.getElementById('plugin');
  if (layout.backdrop) backdrop.src = '/backdrop'; else backdrop.hidden = true;
  const place = (el, r) => Object.assign(el.style, {left: `${r.x}px`, top: `${r.y}px`, width: r.w ? `${r.w}px` : '', height: r.h ? `${r.h}px` : ''});
  place(component, layout.component.rect);
  place(win, layout.plugin);

  const node = layout.component.node;
  const select = nodes => frame.contentWindow?.__framerStandin?.select(nodes);
  component.addEventListener('click', () => { component.classList.add('selected'); select([node]); });
  // clicking the bare canvas clears the selection, as in Framer
  for (const el of [backdrop, document.getElementById('canvas')])
    el.addEventListener('click', () => { component.classList.remove('selected'); select([]); });

  window.host = {
    layout,
    openPlugin() {
      return new Promise(resolve => {
        frame.addEventListener('load', () => {
          // a plugin opened with something selected sees that selection straight away
          if (component.classList.contains('selected')) select([node]);
          resolve();
        }, {once: true});
        frame.src = '/plugin/index.html';
        win.hidden = false;
      });
    }
  };
  window.hostReady = true;
})();
