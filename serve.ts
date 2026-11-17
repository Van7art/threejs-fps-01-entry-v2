// Sunscorch Yard static server. Node standard library only: it answers GET
// and HEAD for files under game/, nothing else, so the game can be played
// from http://localhost:8080 with no build step and no network.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const root = resolve(here, 'game');
const port = Number(process.env.PORT || 8080);
const host = process.env.HOST || '127.0.0.1';

const byExt = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
};

function safeJoin(base, requestPath) {
  const cleaned = normalize('/' + requestPath).replace(/^\/+/, '');
  const full = join(base, cleaned);
  if (!full.startsWith(base + sep) && full !== base) return null;
  return full;
}

const server = createServer(async (req, res) => {
  try {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('method not allowed\n');
      return;
    }
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    let path = decodeURIComponent(url.pathname);
    if (path === '/' || path === '') path = '/index.html';
    const file = safeJoin(root, path);
    if (!file) {
      res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('bad path\n');
      return;
    }
    let info;
    try {
      info = await stat(file);
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('not found\n');
      return;
    }
    if (!info.isFile()) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('not found\n');
      return;
    }
    const body = await readFile(file);
    res.writeHead(200, {
      'content-type': byExt[extname(file).toLowerCase()] || 'application/octet-stream',
      'content-length': body.length,
      'cache-control': 'no-cache',
    });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch (err) {
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('server error\n');
  }
});

server.listen(port, host, () => {
  console.log(`Sunscorch Yard serving game/ at http://${host}:${port}/`);
});
