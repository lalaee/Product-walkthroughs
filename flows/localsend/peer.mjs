// A phone on the same network, for LocalSend walkthroughs: a LocalSend receiver that speaks the
// protocol (github.com/localsend/protocol, v2.2) and shows what it gets on a phone screen.
//
// It announces itself over multicast, so it shows up in LocalSend's nearby devices, and answers the
// upload API: on /prepare-upload the phone shows the request and taps Accept, then takes the files
// and shows them. Plain HTTP on its own port (the protocol allows either); the phone screen is a
// page at /phone that follows along over server-sent events.
import dgram from 'node:dgram';
import {randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import {request as httpsRequest} from 'node:https';
import {readFileSync} from 'node:fs';

const MULTICAST = {address: '224.0.0.167', port: 53317};

/**
 * @param {{alias?: string, deviceModel?: string, port?: number, acceptAfter?: number}} opts
 *   acceptAfter: how long (ms) the phone shows the request before tapping Accept
 *   transferMs: how long a file takes to arrive (on one machine it's instant, and there'd be no
 *     progress to see on either side), paced by reading the upload at size / transferMs
 *   backdrop: an image file served at /phone/backdrop, for the phone window's background
 */
export async function startPeer({alias = 'Pixel 8', deviceModel = 'Pixel', port = 53318, acceptAfter = 1400, transferMs = 1600, backdrop} = {}) {
  const info = {alias, version: '2.1', deviceModel, deviceType: 'mobile', fingerprint: randomUUID(), port, protocol: 'http', download: false};
  const clients = new Set();
  const received = new Map(); // fileName → {type, data}
  let session = null;
  const emit = event => {
    for (const res of clients) res.write(`data: ${JSON.stringify(event)}\n\n`);
  };
  const json = (res, code, body) => {
    res.writeHead(code, {'content-type': 'application/json'});
    res.end(body === undefined ? '' : JSON.stringify(body));
  };
  const readBody = req => new Promise((ok, no) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => ok(Buffer.concat(chunks)));
    req.on('error', no);
  });

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const path = url.pathname;
    try {
      if (path === '/phone') {
        res.writeHead(200, {'content-type': 'text/html; charset=utf-8'});
        return res.end(readFileSync(new URL('./phone.html', import.meta.url)).toString().replaceAll('{{alias}}', alias));
      }
      if (path === '/phone/events') {
        res.writeHead(200, {'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive'});
        res.write(`data: ${JSON.stringify({type: 'ready', alias})}\n\n`);
        clients.add(res);
        return req.on('close', () => clients.delete(res));
      }
      if (path === '/phone/backdrop' && backdrop) {
        res.writeHead(200, {'content-type': backdrop.endsWith('.png') ? 'image/png' : 'image/jpeg'});
        return res.end(readFileSync(backdrop));
      }
      if (path.startsWith('/phone/files/')) {
        const f = received.get(decodeURIComponent(path.slice('/phone/files/'.length)));
        if (!f) return json(res, 404);
        res.writeHead(200, {'content-type': f.type});
        return res.end(f.data);
      }
      if (path === '/api/localsend/v2/register' || path === '/api/localsend/v1/register') {
        await readBody(req);
        return json(res, 200, info);
      }
      if (path === '/api/localsend/v2/info' || path === '/api/localsend/v1/info') return json(res, 200, info);
      if (path === '/api/localsend/v2/prepare-upload') {
        const body = JSON.parse((await readBody(req)).toString());
        const files = Object.values(body.files ?? {});
        // a request on the phone; the person taps Accept a moment later
        emit({type: 'request', from: body.info?.alias ?? 'Someone', files: files.map(f => ({name: f.fileName, size: f.size, type: f.fileType}))});
        await new Promise(r => setTimeout(r, acceptAfter));
        emit({type: 'accept'});
        // text messages are shown straight away; there's nothing to upload
        const texts = files.filter(f => f.fileType === 'text/plain' && f.preview != null);
        if (texts.length === files.length) {
          emit({type: 'message', from: body.info?.alias, text: texts.map(f => f.preview).join('\n')});
          return json(res, 204);
        }
        session = {id: randomUUID(), files: Object.fromEntries(files.map(f => [f.id, {...f, token: randomUUID(), got: 0}])), from: body.info?.alias};
        return json(res, 200, {sessionId: session.id, files: Object.fromEntries(Object.values(session.files).map(f => [f.id, f.token]))});
      }
      if (path === '/api/localsend/v2/upload') {
        const f = session?.files[url.searchParams.get('fileId')];
        if (!session || url.searchParams.get('sessionId') !== session.id || !f || url.searchParams.get('token') !== f.token) return json(res, 403);
        const chunks = [], t0 = Date.now();
        req.on('data', c => {
          chunks.push(c);
          f.got += c.length;
          emit({type: 'progress', name: f.fileName, got: f.got, size: f.size});
          // pace it: pause until this much would have arrived at size / transferMs
          const due = t0 + (f.got / f.size) * transferMs - Date.now();
          if (due > 5) {
            req.pause();
            setTimeout(() => req.resume(), due);
          }
        });
        await new Promise(r => req.on('end', r));
        received.set(f.fileName, {type: f.fileType || 'application/octet-stream', data: Buffer.concat(chunks)});
        emit({type: 'received', name: f.fileName, size: f.size, fileType: f.fileType, url: `/phone/files/${encodeURIComponent(f.fileName)}`, from: session.from});
        return json(res, 200);
      }
      if (path === '/api/localsend/v2/cancel') {
        session = null;
        emit({type: 'cancel'});
        return json(res, 200);
      }
      json(res, 404);
    } catch (err) {
      json(res, 500, {message: String(err)});
    }
  });
  await new Promise(r => server.listen(port, '0.0.0.0', r));

  // discovery: announce on the multicast group, and answer other members' announcements
  const socket = dgram.createSocket({type: 'udp4', reuseAddr: true});
  await new Promise(r => socket.bind(MULTICAST.port, r));
  socket.addMembership(MULTICAST.address);
  socket.setMulticastLoopback(true);
  const announce = flag => socket.send(Buffer.from(JSON.stringify({...info, announce: flag})), MULTICAST.port, MULTICAST.address);
  socket.on('message', (msg, from) => {
    let other;
    try {
      other = JSON.parse(msg.toString());
    } catch {
      return;
    }
    if (other.fingerprint === info.fingerprint || !other.announce) return;
    // reply over HTTP(S) to the announcer's register route, and by multicast as a fallback
    const req = httpsRequest({host: from.address, port: other.port, path: '/api/localsend/v2/register', method: 'POST', rejectUnauthorized: false, headers: {'content-type': 'application/json'}}, r => r.resume());
    req.on('error', () => {});
    req.end(JSON.stringify(info));
    announce(false);
  });
  const timer = setInterval(() => announce(true), 2000);
  announce(true);

  return {
    info,
    url: `http://127.0.0.1:${port}/phone`,
    close: async () => {
      clearInterval(timer);
      socket.close();
      for (const res of clients) res.end();
      await new Promise(r => server.close(r));
    }
  };
}
