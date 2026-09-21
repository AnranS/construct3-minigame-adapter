import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parse} from 'parse5';
import {getAPICatalog, getAPIPlatformLabels, API_PLATFORMS} from './api-catalog.mjs';

const defaultSiteRoot = fileURLToPath(new URL('../dist/site/', import.meta.url));
const base = '/construct3-minigame-adapter/';
const productionOrigin = 'https://anrans.github.io';
const localOrigin = 'https://documentation.invalid';
const slugs = ['', 'guide', 'addon', 'api', 'tiktok-iap', 'troubleshooting', 'validation', '404.html'];
const locales = ['zh-CN', 'en'];
const filenameFor = (locale, slug) => `${locale === 'en' ? 'en/' : ''}${slug === '404.html' ? slug : `${slug ? `${slug}/` : ''}index.html`}`;
const pagePath = (locale, slug) => `${base}${locale === 'en' ? 'en/' : ''}${slug === '404.html' ? slug : slug ? `${slug}/` : ''}`;
const attrs = node => Object.fromEntries((node.attrs ?? []).map(({name, value}) => [name, value]));
const textContent = node => node.nodeName === '#text' ? node.value : (node.childNodes ?? []).map(textContent).join('');
const descendants = (node, predicate) => (node.childNodes ?? []).flatMap(child => [...(predicate(child) ? [child] : []), ...descendants(child, predicate)]);
const hasClass = (node, name) => (attrs(node).class ?? '').split(/\s+/).includes(name);
const ancestor = (node, tagName) => node.parentNode && (node.parentNode.tagName === tagName || ancestor(node.parentNode, tagName));
const sameList = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Validate the generated site without mutating it; exported for regression fixtures. */
export async function checkSite({siteRoot = defaultSiteRoot} = {}) {
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
    const document = {ids: new Set(), anchors: new Set(), links: [], images: [], apiRows: [], platformColumns: [], filters: new Map(), canonical: [], alternates: [], switches: [], langs: []};
    const source = await fs.readFile(path.join(siteRoot, filename), 'utf8');
    if (/\{\{[A-Z_]+\}\}/.test(source)) errors.push(`${filename}: unexpanded build token`);
    const tree = parse(source);
    function visit(node) {
      const attributes = attrs(node);
      if (Object.hasOwn(attributes, 'id')) {
        if (!attributes.id) errors.push(`${filename}: empty id`);
        if (document.ids.has(attributes.id)) errors.push(`${filename}: duplicate id "${attributes.id}"`);
        document.ids.add(attributes.id);
      }
      if (node.tagName === 'html') document.langs.push(attributes.lang);
      if (node.tagName === 'link') {
        const rel = (attributes.rel ?? '').split(/\s+/);
        if (rel.includes('canonical')) document.canonical.push(attributes.href);
        if (rel.includes('alternate') && attributes.hreflang) document.alternates.push(attributes);
      }
      if (node.tagName === 'a') {
        if (attributes.name) document.anchors.add(attributes.name);
        if (Object.hasOwn(attributes, 'data-language-switch')) document.switches.push({attributes, inHeader: Boolean(ancestor(node, 'header'))});
      }
      if (node.tagName === 'tr' && Object.hasOwn(attributes, 'data-api-row')) document.apiRows.push(node);
      if (node.tagName === 'th' && attributes['data-platform-column']) document.platformColumns.push(node);
      if (node.tagName === 'select' && ['platform', 'kind', 'category'].includes(attributes.name)) {
        if (document.filters.has(attributes.name)) errors.push(`${filename}: duplicate API filter ${attributes.name}`);
        document.filters.set(attributes.name, descendants(node, child => child.tagName === 'option'));
      }
      if (node.tagName === 'img') {
        const parentAttributes = attrs(node.parentNode ?? {});
        const decorative = attributes.alt === '' && (attributes['aria-hidden'] === 'true' || attributes.role === 'presentation' || (node.parentNode?.tagName === 'a' && parentAttributes['aria-label']?.trim()));
        const alt = attributes.alt?.trim() ?? '';
        if (!decorative && (Array.from(alt).length < 4 || /^(?:image|img|photo|screenshot|screen shot|figure|图片|图像|照片|截图)(?:\s*\d+)?$/i.test(alt) || /\.(?:png|jpe?g|gif|webp|avif|svg)$/i.test(alt)))
          errors.push(`${filename}: image ${JSON.stringify(attributes.src ?? '')} needs descriptive alt text`);
        if (!attributes.src?.trim()) errors.push(`${filename}: image is missing a non-empty src`);
        else document.images.push(attributes.src);
      }
      for (const attribute of ['href', 'src']) {
        if (Object.hasOwn(attributes, attribute)) document.links.push({attribute, value: attributes[attribute]});
      }
      for (const child of node.childNodes ?? []) visit(child);
      if (node.content) visit(node.content);
    }
    visit(tree);
    documents.set(filename, document);
  }

  const expectedFiles = new Set(locales.flatMap(locale => slugs.map(slug => filenameFor(locale, slug))));
  for (const filename of expectedFiles) if (!documents.has(filename)) errors.push(`Missing page: ${filename}`);
  for (const filename of documents.keys()) if (!expectedFiles.has(filename)) errors.push(`Unexpected HTML page: ${filename}`);
  for (const locale of locales) {
    const otherLocale = locale === 'en' ? 'zh-CN' : 'en';
    for (const slug of slugs) {
      const filename = filenameFor(locale, slug), document = documents.get(filename);
      if (!document) continue;
      if (!sameList(document.langs, [locale])) errors.push(`${filename}: html lang must be ${locale}`);
      const canonical = `${productionOrigin}${pagePath(locale, slug)}`;
      if (!sameList(document.canonical, [canonical])) errors.push(`${filename}: canonical must be ${canonical}`);
      const expectedAlternates = {'zh-CN': `${productionOrigin}${pagePath('zh-CN', slug)}`, en: `${productionOrigin}${pagePath('en', slug)}`, 'x-default': `${productionOrigin}${pagePath('zh-CN', slug)}`};
      if (document.alternates.length !== 3) errors.push(`${filename}: expected exactly three language alternates`);
      for (const [language, href] of Object.entries(expectedAlternates)) {
        const matching = document.alternates.filter(alternate => alternate.hreflang === language);
        if (matching.length !== 1 || matching[0].href !== href) errors.push(`${filename}: alternate ${language} must be ${href}`);
      }
      if (document.switches.length !== 1) errors.push(`${filename}: expected exactly one language switch`);
      else {
        const {attributes, inHeader} = document.switches[0];
        let target;
        try { target = new URL(attributes.href, canonical); } catch {}
        const expected = `${productionOrigin}${pagePath(otherLocale, slug)}`;
        if (!inHeader || attributes.hreflang !== otherLocale || target?.href !== expected)
          errors.push(`${filename}: header language switch must use hreflang=${otherLocale} and target ${expected}`);
      }
    }
  }

  function targetForPath(pathname) {
    let decoded;
    try { decoded = decodeURIComponent(pathname); }
    catch { throw new Error('Malformed percent encoding'); }
    if (!decoded.startsWith(base)) throw new Error(`Path escapes the GitHub Pages base: ${decoded}`);
    const relative = decoded.slice(base.length);
    if (relative.includes('\\') || relative.includes('\0') || relative.split('/').some(part => part === '..' || part === '.')) throw new Error(`Unsafe internal path: ${decoded}`);
    const candidates = relative.endsWith('/') || relative === '' ? [`${relative}index.html`] : [relative, `${relative}/index.html`];
    return candidates.find(candidate => files.has(candidate));
  }
  let checkedLinks = 0, checkedImages = 0;
  for (const [filename, document] of documents) {
    const documentURL = new URL(`${base}${filename.replace(/index\.html$/, '')}`, localOrigin);
    for (const {attribute, value} of document.links) {
      try {
        const url = new URL(value, documentURL);
        if (url.protocol === 'javascript:') throw new Error('javascript: links are not supported');
        if (!['http:', 'https:'].includes(url.protocol)) continue;
        if (url.origin !== localOrigin && !(url.origin === productionOrigin && url.pathname.startsWith(base))) continue;
        const target = targetForPath(url.pathname);
        if (!target) throw new Error(`Missing internal target: ${url.pathname}`);
        checkedLinks++;
        if (url.hash && documents.has(target)) {
          const anchor = decodeURIComponent(url.hash.slice(1)), targetDocument = documents.get(target);
          if (!targetDocument.ids.has(anchor) && !targetDocument.anchors.has(anchor)) throw new Error(`Missing anchor: ${target}#${anchor}`);
        }
      } catch (error) { errors.push(`${filename}: ${attribute}=${JSON.stringify(value)}: ${error.message}`); }
    }
    for (const value of document.images) {
      try {
        const url = new URL(value, documentURL);
        if (url.origin !== localOrigin && !(url.origin === productionOrigin && url.pathname.startsWith(base))) continue;
        const target = targetForPath(url.pathname);
        if (!target) throw new Error(`Missing local image: ${url.pathname}`);
        if (!/\.(?:png|jpe?g|gif|webp|avif|svg|apng|bmp|ico)$/i.test(target)) throw new Error(`Local image does not point to an image file: ${target}`);
        if ((await fs.stat(path.join(siteRoot, target))).size === 0) throw new Error(`Empty local image: ${target}`);
        checkedImages++;
      } catch (error) { errors.push(`${filename}: img src=${JSON.stringify(value)}: ${error.message}`); }
    }
  }
  for (const filename of ['downloads/C3MiniGameBridge.c3addon', 'downloads/MiniGameApiSuite.c3p']) {
    if (!files.has(filename)) errors.push(`Missing download: ${filename}`);
    else if ((await fs.stat(path.join(siteRoot, filename))).size === 0) errors.push(`Empty download: ${filename}`);
  }

  const apiRows = {};
  for (const locale of locales) {
    const filename = filenameFor(locale, 'api'), document = documents.get(filename), catalog = getAPICatalog(locale), labels = getAPIPlatformLabels(locale);
    apiRows[locale] = document?.apiRows.length ?? 0;
    if (!document) continue;
    if (document.apiRows.length !== catalog.length) errors.push(`${filename}: API table must contain ${catalog.length} tr[data-api-row] rows; found ${document.apiRows.length}`);
    for (const platform of API_PLATFORMS) {
      const columns = document.platformColumns.filter(node => attrs(node)['data-platform-column'] === platform);
      if (columns.length !== 1 || !textContent(columns[0]).includes(labels[platform])) errors.push(`${filename}: missing or mislabeled API platform contract column: ${platform}`);
    }
    for (const [filter, expected] of [
      ['platform', API_PLATFORMS.map(platform => [platform, labels[platform]])],
      ['category', [...new Map(catalog.map(row => [row.category, row.categoryLabel])).entries()]],
      ['kind', ['async', 'sync', 'object', 'event'].map(kind => [kind, null])]
    ]) {
      const options = document.filters.get(filter) ?? [];
      const values = options.map(option => attrs(option).value ?? textContent(option));
      if (!sameList([...values].sort(), ['', ...expected.map(([value]) => value)].sort())) errors.push(`${filename}: API ${filter} filter has missing, duplicate or unexpected options`);
      for (const [value, label] of expected) {
        const option = options.find(node => attrs(node).value === value);
        if (label && option && textContent(option).trim() !== label) errors.push(`${filename}: API ${filter} option ${value} must be localized as ${label}`);
      }
    }
    const nodesById = new Map(document.apiRows.map(node => [attrs(node).id, node]));
    for (const row of catalog) {
      const node = nodesById.get(`api-${row.name}`);
      if (!node) { errors.push(`${filename}: missing API row ${row.name}`); continue; }
      const attributes = attrs(node), cells = (node.childNodes ?? []).filter(child => child.tagName === 'td');
      if (textContent(cells[0] ?? {}).trim() !== row.name || textContent(cells[1] ?? {}).trim() !== row.categoryLabel || attributes['data-category'] !== row.category) errors.push(`${filename}: API row ${row.name} has incorrect name or localized category`);
      if (!attributes['data-search']?.includes(row.notes.toLowerCase())) errors.push(`${filename}: API row ${row.name} search text omits localized notes`);
      for (const platform of API_PLATFORMS) {
        const platformCells = cells.filter(cell => attrs(cell)['data-platform-cell'] === platform);
        const cell = platformCells[0];
        if (platformCells.length !== 1) { errors.push(`${filename}: API ${row.name} is missing a unique ${platform} contract cell`); continue; }
        const badges = descendants(cell, child => hasClass(child, 'kind-badge')).map(textContent);
        const contracts = descendants(cell, child => child.tagName === 'small').map(child => textContent(child).trim());
        if (attributes[`data-${platform}`] !== (row.kinds[platform] ?? '') || !sameList(badges, row.kinds[platform] ? [row.kinds[platform]] : [])) errors.push(`${filename}: API ${row.name} has an incorrect ${platform} invocation kind`);
        if (!sameList(contracts, row.contracts[platform] ?? [])) errors.push(`${filename}: API ${row.name} has incomplete or incorrect ${platform} contracts`);
        if (!row.kinds[platform] && !textContent(cell).trim()) errors.push(`${filename}: API ${row.name} must label ${platform} as unlisted`);
      }
    }
  }
  return {errors, documents: documents.size, checkedLinks, checkedImages, apiRows};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await checkSite();
  if (result.errors.length) {
    console.error(`Documentation check failed (${result.errors.length} issues):\n${result.errors.map(error => `- ${error}`).join('\n')}`);
    process.exitCode = 1;
  } else console.log(`Documentation valid: ${result.documents} HTML files, ${result.checkedLinks} internal references, ${result.checkedImages} local image references, API rows zh-CN=${result.apiRows['zh-CN']} / en=${result.apiRows.en}, 2 non-empty downloads.`);
}
