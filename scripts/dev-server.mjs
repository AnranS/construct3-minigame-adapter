import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = await fs.realpath(fileURLToPath(new URL('../', import.meta.url)));
const addonRoot = path.join(root, 'addon');
const manifest = JSON.parse(await fs.readFile(path.join(addonRoot, 'addon.json'), 'utf8'));
const allowed = new Map();
if (!Array.isArray(manifest['file-list'])) throw new Error('Missing addon file-list');
for (const name of manifest['file-list']) {
  if (typeof name !== 'string' || !name || path.isAbsolute(name) || /[\\\0]/.test(name) || name.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new Error(`Unsafe addon file-list entry: ${name}`);
  }
  allowed.set(`/addon/${name}`, path.join(addonRoot, name));
}
allowed.set('/MiniGameBridgeTest.c3p', path.join(root, 'examples/construct/MiniGameBridgeTest.c3p'));

const mime = {
  '.json': 'application/json; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.md': 'text/markdown; charset=utf-8',
  '.c3p': 'application/zip'
};
const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', 'https://editor.construct.net');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Vary', 'Origin');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.headers.origin === 'https://editor.construct.net' && req.headers['access-control-request-private-network'] === 'true') {
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
  }
  const fail = (status, message) => {
    res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(req.method === 'HEAD' ? undefined : message);
  };
  try {
    // Inspect the raw target before URL normalization can remove ../ segments.
    const pathname = decodeURIComponent((req.url || '').split('?')[0]);
    if (!pathname.startsWith('/') || /[\\\u0000-\u001f\u007f]/.test(pathname) || pathname.slice(1).split('/').some(part => !part || part === '.' || part === '..')) {
      fail(400, 'Invalid path'); return;
    }
    const filename = allowed.get(pathname);
    if (!filename) { fail(404, 'Not found'); return; }
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      res.setHeader('Allow', 'GET, HEAD, OPTIONS');
      fail(405, 'Method not allowed'); return;
    }
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    const stat = await fs.lstat(filename);
    if (!stat.isFile() || stat.isSymbolicLink() || await fs.realpath(filename) !== filename) {
      fail(403, 'File unavailable'); return;
    }
    const content = await fs.readFile(filename);
    res.writeHead(200, {
      'Content-Type': mime[path.extname(filename)] || 'application/octet-stream',
      'Content-Length': content.byteLength
    });
    res.end(req.method === 'HEAD' ? undefined : content);
  } catch (error) {
    fail(error.code === 'ENOENT' ? 404 : error instanceof URIError ? 400 : 500, 'File unavailable');
  }
});
server.on('error', error => { console.error(error.message); process.exitCode = 1; });
server.listen(65432, '127.0.0.1', () => {
  console.log('Construct dev addon: http://localhost:65432/addon/addon.json');
  console.log('Test project: http://localhost:65432/MiniGameBridgeTest.c3p');
  console.log('Only addon file-list entries and the test project are served. Ctrl+C stops the server.');
});
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close());
