import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const siteRoot = await fs.realpath(fileURLToPath(new URL('../dist/site/', import.meta.url)));
const base = '/construct3-minigame-adapter/';
const hostname = '127.0.0.1';
const port = Number(process.env.DOCS_PORT ?? 4174);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('DOCS_PORT must be a valid TCP port.');
const contentTypes = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff',
  '.txt': 'text/plain; charset=utf-8', '.zip': 'application/zip',
  '.c3addon': 'application/zip', '.c3p': 'application/zip'
};

function insideRoot(filename) {
  const relative = path.relative(siteRoot, filename);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
}

async function respond(request, response, status, body, contentType = 'text/plain; charset=utf-8') {
  response.writeHead(status, {'Content-Type': contentType, 'Content-Length': Buffer.byteLength(body), 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store'});
  response.end(request.method === 'HEAD' ? undefined : body);
}

async function notFound(request, response) {
  try {
    const filename = await fs.realpath(path.join(siteRoot, '404.html'));
    if (!insideRoot(filename)) throw new Error('404 page is outside the site root');
    await respond(request, response, 404, await fs.readFile(filename), contentTypes['.html']);
  } catch {
    await respond(request, response, 404, 'Not found\n');
  }
}

const server = http.createServer(async (request, response) => {
  try {
    if (!['GET', 'HEAD'].includes(request.method)) {
      response.setHeader('Allow', 'GET, HEAD');
      return await respond(request, response, 405, 'Method not allowed\n');
    }
    const rawPath = (request.url ?? '/').split(/[?#]/, 1)[0];
    let pathname;
    try { pathname = decodeURIComponent(rawPath); }
    catch { return await respond(request, response, 400, 'Malformed request path\n'); }
    // Validate before URL normalization, including encoded traversal segments.
    if (pathname.includes('\0') || pathname.includes('\\') || pathname.split('/').some(part => part === '..' || part === '.'))
      return await respond(request, response, 400, 'Unsafe request path\n');
    if (pathname === '/' || pathname === base.slice(0, -1)) {
      response.writeHead(302, {Location: base});
      return response.end();
    }
    if (!pathname.startsWith(base)) return await notFound(request, response);
    let filename = path.resolve(siteRoot, pathname.slice(base.length));
    if (!insideRoot(filename)) return await respond(request, response, 400, 'Unsafe request path\n');
    let stat;
    try { stat = await fs.stat(filename); }
    catch (error) {
      if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return await notFound(request, response);
      throw error;
    }
    if (stat.isDirectory()) {
      if (!pathname.endsWith('/')) {
        response.writeHead(301, {Location: `${rawPath}/`});
        return response.end();
      }
      filename = path.join(filename, 'index.html');
    }
    try {
      filename = await fs.realpath(filename);
      if (!insideRoot(filename)) return await respond(request, response, 403, 'Forbidden\n');
      if (!(await fs.stat(filename)).isFile()) return await notFound(request, response);
      const content = await fs.readFile(filename);
      await respond(request, response, 200, content, contentTypes[path.extname(filename).toLowerCase()] ?? 'application/octet-stream');
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return await notFound(request, response);
      throw error;
    }
  } catch (error) {
    console.error(`Preview request failed: ${error.message}`);
    if (!response.headersSent) await respond(request, response, 500, 'Preview server error\n');
    else response.destroy();
  }
});

server.listen(port, hostname, () => console.log(`Documentation preview: http://${hostname}:${port}${base}`));
