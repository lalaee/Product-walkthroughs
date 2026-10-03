// A terminal window for desktop flows: a real shell (node-pty) drawn with xterm.js (the terminal
// VS Code uses), in a page styled like Windows Terminal. Open it on the desktop with openWebWindow
// and type into it with the director, as into any window: what runs in it (Claude Code, say) is
// real.
//
//   const term = await startTerminal({cwd, env, title: 'PowerShell'});
//   const win = await openWebWindow({url: term.url, x, y, width, height, env, recordly});
import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname, join} from 'node:path';
import pty from 'node-pty';
import {WebSocketServer} from 'ws';

const require = createRequire(import.meta.url);
const asset = p => readFileSync(require.resolve(p));
const xtermDir = dirname(require.resolve('@xterm/xterm/package.json'));

const page = ({title, fontSize}) => `<!doctype html><meta charset="utf-8"><title>${title}</title>
<link rel="stylesheet" href="/xterm.css">
<style>
  html, body { margin: 0; height: 100%; background: transparent; overflow: hidden; }
  .win { position: absolute; inset: 0; display: flex; flex-direction: column; background: #0c0c0c; border: 1px solid #3a3a3a; border-radius: 8px; overflow: hidden; font: 12px "Segoe UI", Inter, system-ui, sans-serif; color: #fff; }
  .bar { height: 36px; display: flex; align-items: stretch; background: #202020; flex: none; }
  .tab { display: flex; align-items: center; gap: 8px; padding: 0 12px; margin: 6px 0 0 8px; background: #0c0c0c; border-radius: 6px 6px 0 0; min-width: 180px; }
  .tab svg { flex: none; }
  .sp { flex: 1; }
  .ctl { width: 46px; display: grid; place-items: center; }
  #term { flex: 1; padding: 6px 4px 4px 10px; }
  .xterm .xterm-viewport { overflow-y: hidden !important; }
</style>
<div class="win">
  <div class="bar"><div class="tab"><svg width="14" height="14" viewBox="0 0 14 14"><rect width="14" height="14" rx="3" fill="#2b2b2b" stroke="#777"/><path d="M3.5 4.5l2.5 2.5-2.5 2.5M7.5 10h3" stroke="#fff" stroke-width="1.1" fill="none"/></svg>${title}</div><div class="sp"></div>
    <div class="ctl"><svg width="10" height="10"><path d="M0 5.5h10" stroke="#fff"/></svg></div><div class="ctl"><svg width="10" height="10"><rect x=".5" y=".5" width="9" height="9" fill="none" stroke="#fff"/></svg></div><div class="ctl"><svg width="10" height="10"><path d="M.5.5l9 9M9.5.5l-9 9" stroke="#fff"/></svg></div></div>
  <div id="term"></div>
</div>
<script src="/xterm.js"></script><script src="/addon-fit.js"></script>
<script>
  const term = new Terminal({fontFamily: '"Cascadia Mono", "DejaVu Sans Mono", "Noto Sans Mono", monospace', fontSize: ${fontSize}, lineHeight: 1.15, cursorBlink: true, allowProposedApi: true,
    theme: {background: '#0c0c0c', foreground: '#cccccc', cursor: '#ffffff', selectionBackground: '#264f78'}});
  const fit = new FitAddon.FitAddon(); term.loadAddon(fit); term.open(document.getElementById('term')); fit.fit();
  const ws = new WebSocket('ws://' + location.host + '/pty');
  ws.onopen = () => ws.send(JSON.stringify({resize: [term.cols, term.rows]}));
  ws.onmessage = e => term.write(e.data);
  term.onData(d => ws.send(JSON.stringify({input: d})));
  addEventListener('resize', () => { fit.fit(); ws.send(JSON.stringify({resize: [term.cols, term.rows]})); });
  term.focus(); window.term = term;
</script>`;

/** Starts a shell behind a terminal page; resolves to {url, pty, close}. */
export function startTerminal({cwd = process.cwd(), env = process.env, shell = 'bash', args = ['-l'], title = 'Terminal', fontSize = 15, port = 0} = {}) {
  const proc = pty.spawn(shell, args, {name: 'xterm-256color', cols: 100, rows: 30, cwd, env: {...env, TERM: 'xterm-256color', COLORTERM: 'truecolor'}});
  const server = createServer((req, res) => {
    const files = {'/': ['text/html', () => page({title, fontSize})], '/xterm.css': ['text/css', () => readFileSync(join(xtermDir, 'css/xterm.css'))],
      '/xterm.js': ['text/javascript', () => readFileSync(join(xtermDir, 'lib/xterm.js'))], '/addon-fit.js': ['text/javascript', () => asset('@xterm/addon-fit/lib/addon-fit.js')]};
    const f = files[req.url.split('?')[0]];
    if (!f) return res.writeHead(404).end();
    res.writeHead(200, {'content-type': f[0]}).end(f[1]());
  });
  const wss = new WebSocketServer({server, path: '/pty'});
  let output = '';
  proc.onData(d => {
    output += d;
    for (const c of wss.clients) c.send(d);
  });
  wss.on('connection', ws => {
    if (output) ws.send(output);
    ws.on('message', m => {
      const msg = JSON.parse(m);
      if (msg.input) proc.write(msg.input);
      if (msg.resize) proc.resize(...msg.resize);
    });
  });
  return new Promise(resolve => server.listen(port, '127.0.0.1', () => resolve({
    url: `http://127.0.0.1:${server.address().port}/`,
    pty: proc,
    /** Everything the shell has printed so far (to wait for a prompt or an answer). */
    output: () => output,
    close: () => {
      proc.kill();
      wss.close();
      server.close();
    }
  })));
}
