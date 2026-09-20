import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parse} from 'parse5';
import {getAPICatalog, API_PLATFORMS} from './api-catalog.mjs';

const siteRoot = fileURLToPath(new URL('../dist/site/', import.meta.url));
const base = '/construct3-minigame-adapter/';
const origin = 'https://documentation.invalid';
const errors = [];

async function walk(directory) {
  const result = [];
  for (const entry of await fs.readdir(directory, {withFileTypes: true})) {
    const filename = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) errors.push(`Symbolic links are not supported: ${path.relative(siteRoot, filename)}`);
    else if (entry.isDirectory()) result.push(...await walk(filename));
    else if (entry.isFile()) result.push(path.relative(siteRoot, filename).split(path.sep).join('/'));
  }
  return result;
}

const files = new Set(await walk(siteRoot));
const documents = new Map();
for (const filename of [...files].filter(name => name.endsWith('.html'))) {
  const document = {ids: new Set(), anchors: new Set(), links: [], apiRows: 0, platformColumns: new Set(), platformOptions: new Set()};
  const tree = parse(await fs.readFile(path.join(siteRoot, filename), 'utf8'));
  function visit(node) {
    const attributes = Object.fromEntries((node.attrs ?? []).map(({name, value}) => [name, value]));
    if (Object.hasOwn(attributes, 'id')) {
      if (!attributes.id) errors.push(`${filename}: empty id`);
      if (document.ids.has(attributes.id)) errors.push(`${filename}: duplicate id "${attributes.id}"`);
      document.ids.add(attributes.id);
    }
    if (node.tagName === 'a' && attributes.name) document.anchors.add(attributes.name);
    if (node.tagName === 'tr' && Object.hasOwn(attributes, 'data-api-row')) document.apiRows++;
    if (node.tagName === 'th' && attributes['data-platform-column']) document.platformColumns.add(attributes['data-platform-column']);
    if (node.tagName === 'option' && API_PLATFORMS.includes(attributes.value)) document.platformOptions.add(attributes.value);
    for (const attribute of ['href', 'src']) {
      if (Object.hasOwn(attributes, attribute)) document.links.push({attribute, value: attributes[attribute]});
    }
    for (const child of node.childNodes ?? []) visit(child);
    if (node.content) visit(node.content);
  }
  visit(tree);
  documents.set(filename, document);
}

for (const filename of ['index.html', '404.html']) {
  if (!documents.has(filename)) errors.push(`Missing page: ${filename}`);
}
const pages = new Map();
for (const name of ['guide', 'addon', 'api', 'tiktok-iap', 'troubleshooting', 'validation']) {
  const filename = [`${name}/index.html`, `${name}.html`].find(candidate => documents.has(candidate));
  if (!filename) errors.push(`Missing page: ${name}`);
  else pages.set(name, filename);
}

function targetForPath(pathname) {
  let decoded;
  try { decoded = decodeURIComponent(pathname); }
  catch { throw new Error('Malformed percent encoding'); }
  if (!decoded.startsWith(base)) throw new Error(`Path escapes the GitHub Pages base: ${decoded}`);
  const relative = decoded.slice(base.length);
  if (relative.includes('\\') || relative.includes('\0') || relative.split('/').some(part => part === '..' || part === '.'))
    throw new Error(`Unsafe internal path: ${decoded}`);
  const candidates = relative.endsWith('/') || relative === '' ? [`${relative}index.html`] : [relative, `${relative}/index.html`];
  return candidates.find(candidate => files.has(candidate));
}

let checkedLinks = 0;
for (const [filename, document] of documents) {
  const documentURL = new URL(`${base}${filename.replace(/index\.html$/, '')}`, origin);
  for (const {attribute, value} of document.links) {
    try {
      const url = new URL(value, documentURL);
      if (url.protocol === 'javascript:') throw new Error('javascript: links are not supported');
      if (!['http:', 'https:'].includes(url.protocol)) continue;
      // Also verify absolute links pointing back to this production Pages site.
      if (url.origin !== origin && !(url.origin === 'https://anrans.github.io' && url.pathname.startsWith(base))) continue;
      const target = targetForPath(url.pathname);
      if (!target) throw new Error(`Missing internal target: ${url.pathname}`);
      checkedLinks++;
      if (url.hash && documents.has(target)) {
        const anchor = decodeURIComponent(url.hash.slice(1));
        const targetDocument = documents.get(target);
        if (!targetDocument.ids.has(anchor) && !targetDocument.anchors.has(anchor))
          throw new Error(`Missing anchor: ${target}#${anchor}`);
      }
    } catch (error) {
      errors.push(`${filename}: ${attribute}=${JSON.stringify(value)}: ${error.message}`);
    }
  }
}

for (const filename of ['downloads/C3MiniGameBridge.c3addon', 'downloads/MiniGameApiSuite.c3p']) {
  if (!files.has(filename)) errors.push(`Missing download: ${filename}`);
  else if ((await fs.stat(path.join(siteRoot, filename))).size === 0) errors.push(`Empty download: ${filename}`);
}
const apiRows = documents.get(pages.get('api'))?.apiRows ?? 0;
const expectedAPIRows = getAPICatalog().length;
if (apiRows !== expectedAPIRows) errors.push(`API table must contain ${expectedAPIRows} tr[data-api-row] rows; found ${apiRows}`);
for (const platform of API_PLATFORMS) {
  const apiDocument = documents.get(pages.get('api'));
  if (!apiDocument?.platformColumns.has(platform)) errors.push(`Missing API platform contract column: ${platform}`);
  if (!apiDocument?.platformOptions.has(platform)) errors.push(`Missing API platform filter: ${platform}`);
}

if (errors.length) {
  console.error(`Documentation check failed (${errors.length} issues):\n${errors.map(error => `- ${error}`).join('\n')}`);
  process.exitCode = 1;
} else {
  console.log(`Documentation valid: ${documents.size} HTML files, ${checkedLinks} internal references, ${apiRows} API rows, 2 non-empty downloads.`);
}
