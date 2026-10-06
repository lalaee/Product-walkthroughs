// Serves the host page (host.html: the Framer backdrop and the plugin's window) at /, where things sit
// on it at /layout.json, and the plugin interface built by build.mjs at /plugin/.
import {createServer} from 'node:http';
import {readFileSync, existsSync, statSync} from 'node:fs';
import {extname, join, normalize} from 'node:path';

const TYPES = {'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.json': 'application/json', '.wasm': 'application/wasm', '.woff2': 'font/woff2'};
const HOST = import.meta.dirname;
const safe = p => normalize(p).replace(/^(\.\.[/\\])+/, '');

export function startServer({plugin, backdrop, layout, port = 0, routes = {}}) {
  const server = createServer(async (req, res) => {
    const path = decodeURIComponent(req.url.split('?')[0]);
    if (routes[path]) return routes[path](req, res);
    if (path === '/layout.json') return res.writeHead(200, {'content-type': 'application/json'}).end(JSON.stringify({...layout, backdrop: !!backdrop}));
    let file;
    if (path === '/' || path === '/host.html') file = join(HOST, 'host.html');
    else if (path === '/backdrop') file = backdrop;
    else if (path.startsWith('/plugin/')) file = join(plugin, safe(path.slice('/plugin/'.length) || 'index.html'));
    else file = join(HOST, safe(path));
    if (!file || !existsSync(file) || !statSync(file).isFile()) return res.writeHead(404).end();
    res.writeHead(200, {'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store'})
      .end(readFileSync(file));
  });
  return new Promise(resolve => server.listen(port, '127.0.0.1', () => resolve({
    url: `http://127.0.0.1:${server.address().port}/`,
    close: () => server.close()
  })));
}
