// Serves Coucou's built web frontend (windows/dist, from `npm run build` in the repo's windows/) as
// is, with one addition to its two pages: frame.js, first in <head>, so they find a Tauri runtime when
// they run inside host.html. Host files (host.html, host.js, frame.js, the wallpaper) live at /__host/.
import {createServer} from 'node:http';
import {readFileSync, existsSync, statSync} from 'node:fs';
import {extname, join, normalize} from 'node:path';

const TYPES = {'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.json': 'application/json', '.woff2': 'font/woff2'};
const HOST = import.meta.dirname;
const WALLPAPER = join(HOST, '../../desktops/coucou/desktop.png');

export function startServer({dist, port = 0}) {
  const server = createServer((req, res) => {
    const path = decodeURIComponent(req.url.split('?')[0]);
    let file;
    if (path.startsWith('/__host/')) {
      const name = path.slice('/__host/'.length);
      file = name === 'desktop.png' ? WALLPAPER : join(HOST, normalize(name).replace(/^(\.\.[/\\])+/, ''));
    } else {
      file = join(dist, normalize(path === '/' ? '/index.html' : path).replace(/^(\.\.[/\\])+/, ''));
    }
    if (!existsSync(file) || !statSync(file).isFile()) return res.writeHead(404).end();
    let body = readFileSync(file);
    if (!path.startsWith('/__host/') && extname(file) === '.html') {
      body = body.toString().replace('<head>', '<head>\n    <script src="/__host/frame.js"></script>');
    }
    res.writeHead(200, {'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store'}).end(body);
  });
  return new Promise(resolve => server.listen(port, '127.0.0.1', () => resolve({
    url: `http://127.0.0.1:${server.address().port}/__host/host.html`,
    close: () => server.close()
  })));
}
