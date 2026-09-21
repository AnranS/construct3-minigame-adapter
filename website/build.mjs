import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {marked} from 'marked';
import {getAPICatalog, getAPISummary, API_PLATFORMS, getAPIPlatformLabels} from './api-catalog.mjs';
import {LOCALES, PAGE_SLUGS, messages} from './locales.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'dist/site');
const base = '/construct3-minigame-adapter/';
const origin = 'https://anrans.github.io';
const repo = 'https://github.com/AnranS/construct3-minigame-adapter';
const version = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8')).version;
const summary = getAPISummary();
const tokens = {VERSION: version, API_COUNT: summary.names, CATEGORY_COUNT: summary.categories, WECHAT_COUNT: summary.platforms.wechat, DOUYIN_COUNT: summary.platforms.douyin, TIKTOK_COUNT: summary.platforms.tiktok, PLATFORM_COUNT: API_PLATFORMS.length};
const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const languageBase = locale => `${base}${locale === 'en' ? 'en/' : ''}`;
const link = (slug = '', locale = 'zh-CN') => `${languageBase(locale)}${slug === '404' ? '404.html' : slug ? `${slug}/` : ''}`;
const otherLocale = locale => locale === 'en' ? 'zh-CN' : 'en';
const expand = (source, locale = 'zh-CN') => source.replace(/\{\{([A-Z_]+)\}\}/g, (match, key) => {
  const values = {...tokens, BASE: languageBase(locale), ASSET_BASE: base, REPO: repo};
  return Object.hasOwn(values, key) ? String(values[key]) : match;
});
const current = (slug, active) => slug === active ? ' aria-current="page"' : '';

function header(active, locale, anchorMap) {
  const t = messages[locale], other = otherLocale(locale);
  const navigation = ['', 'guide', 'api', 'validation'].map((slug, i) => `<a href="${link(slug, locale)}"${current(slug, active)}>${t.nav[i]}</a>`).join('');
  return `<a class="skip-link" href="#main">${t.skip}</a><header class="site-header"><div class="container nav-shell"><a class="brand" href="${link('', locale)}" aria-label="${t.homeLabel}"><img src="${base}assets/favicon.svg" alt="" width="34" height="34"><span>Construct <small>Mini Game</small></span></a><nav class="nav-links" id="primary-nav" aria-label="${t.navLabel}">${navigation}<a class="github" href="${repo}">GitHub ↗</a></nav><div class="nav-actions"><a class="language-switch" data-language-switch data-language-anchors="${escape(JSON.stringify(anchorMap))}" href="${link(active, other)}" hreflang="${other}" lang="${other}" aria-label="${t.switchLabel}">${t.switchText}</a><button type="button" class="menu-toggle" aria-expanded="false" aria-controls="primary-nav">${t.menu}</button></div></div></header>`;
}
function footer(locale) {
  const t = messages[locale];
  return `<footer class="footer"><div class="container"><div>Construct Mini Game · v${version}<br>${t.disclaimer}</div><nav class="footer-links" aria-label="${t.footerLabel}"><a href="${repo}">${t.footer[0]}</a><a href="${link('guide', locale)}">${t.footer[1]}</a><a href="${repo}/issues">${t.footer[2]}</a><a href="${repo}/blob/main/docs/THIRD_PARTY_NOTICES.md">${t.footer[3]}</a></nav></div></footer>`;
}
function shell({slug = '', locale, title, description, body, anchorMap = {}}) {
  const url = `${origin}${link(slug, locale)}`;
  const alternatives = [...LOCALES.map(lang => `<link rel="alternate" hreflang="${lang}" href="${origin}${link(slug, lang)}">`), `<link rel="alternate" hreflang="x-default" href="${origin}${link(slug, 'zh-CN')}">`].join('');
  return `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#087b3e"><title>${escape(title)} · Construct Mini Game</title><meta name="description" content="${escape(description)}"><link rel="canonical" href="${url}">${alternatives}<meta property="og:title" content="${escape(title)} · Construct Mini Game"><meta property="og:description" content="${escape(description)}"><meta property="og:type" content="website"><meta property="og:url" content="${url}"><meta property="og:locale" content="${locale === 'en' ? 'en_US' : 'zh_CN'}"><link rel="icon" type="image/svg+xml" href="${base}assets/favicon.svg"><link rel="stylesheet" href="${base}assets/site.css"><script type="module" src="${base}assets/site.js"></script></head><body>${header(slug, locale, anchorMap)}${body}${footer(locale)}</body></html>`;
}
function markdown(source) {
  const headings = [], allHeadings = [], used = new Map();
  const renderer = new marked.Renderer();
  renderer.heading = function ({tokens, depth}) {
    const text = this.parser.parseInline(tokens), plain = text.replace(/<[^>]*>/g, '');
    const key = plain.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || 'section';
    const count = used.get(key) || 0; used.set(key, count + 1);
    const id = count ? `${key}-${count + 1}` : key;
    allHeadings.push({id, depth});
    if (depth === 2) headings.push({id, text: plain});
    return `<h${depth} id="${escape(id)}">${text}</h${depth}>\n`;
  };
  const html = marked.parse(source, {renderer}).replace(/<table>/g, '<div class="table-wrap"><table>').replace(/<\/table>/g, '</table></div>');
  return {html, headings, allHeadings};
}
function apiTable(locale) {
  const t = messages[locale], platformLabels = getAPIPlatformLabels(locale), catalog = getAPICatalog(locale);
  const categories = [...new Map(catalog.map(row => [row.category, row.categoryLabel])).entries()];
  const platformOptions = API_PLATFORMS.map(platform => `<option value="${platform}">${platformLabels[platform]}</option>`).join('');
  const columns = API_PLATFORMS.map(platform => `<th scope="col" data-platform-column="${platform}">${t.contract.replace('{platform}', platformLabels[platform])}</th>`).join('');
  const rows = catalog.map(row => {
    const contractText = Object.values(row.contracts).flat().join(' ');
    const attributes = API_PLATFORMS.map(platform => `data-${platform}="${row.kinds[platform] || ''}"`).join(' ');
    const cells = API_PLATFORMS.map(platform => {
      if (!row.kinds[platform]) return `<td data-platform-cell="${platform}"><span class="unsupported">${t.unsupported}</span></td>`;
      const contract = row.contracts[platform].map(note => `<small>${escape(note)}</small>`).join('');
      return `<td data-platform-cell="${platform}"><span class="kind-badge">${escape(row.kinds[platform])}</span>${contract}</td>`;
    }).join('');
    return `<tr data-api-row data-search="${escape(`${row.name} ${row.category} ${row.categoryLabel} ${row.notes} ${contractText}`.toLowerCase())}" data-category="${escape(row.category)}" ${attributes} id="api-${escape(row.name)}"><td><code>${escape(row.name)}</code></td><td>${escape(row.categoryLabel)}</td>${cells}</tr>`;
  }).join('');
  const kinds = ['async', 'sync', 'object', 'event'].map((kind, i) => `<option value="${kind}">${t.kinds[i]}</option>`).join('');
  const count = t.count.replace('{visible}', catalog.length).replace('{total}', catalog.length);
  return `<section aria-labelledby="api-directory"><h2 id="api-directory">${t.apiDirectory}</h2><p>${t.apiIntro}</p><form id="api-filters" class="api-filters" role="search" aria-label="${t.filterLabel}"><label class="search">${t.search}<input name="search" type="search" placeholder="${t.searchPlaceholder}" autocomplete="off"></label><label>${t.platform}<select name="platform"><option value="">${t.allPlatforms}</option>${platformOptions}</select></label><label>${t.kind}<select name="kind"><option value="">${t.allKinds}</option>${kinds}</select></label><label>${t.category}<select name="category"><option value="">${t.allCategories}</option>${categories.map(([v, label]) => `<option value="${escape(v)}">${escape(label)}</option>`).join('')}</select></label><div class="filter-footer"><span id="api-count" role="status" aria-live="polite">${count}</span><button type="reset">${t.reset}</button></div></form><div class="table-wrap"><table class="api-table"><thead><tr><th scope="col">${t.apiName}</th><th scope="col">${t.categoryColumn}</th>${columns}</tr></thead><tbody>${rows}</tbody></table></div><p id="api-empty" class="api-empty" hidden>${t.empty}</p></section>`;
}

// Compile both versions before writing pages so a missing translation cannot
// silently turn an English route into a Chinese fallback.
const documents = new Map();
for (const locale of LOCALES) {
  for (const slug of PAGE_SLUGS) {
    const source = locale === 'en' ? `website/content/en/${slug}.md` : slug === 'tiktok-iap' ? 'docs/TIKTOK-IAP.md' : `website/content/${slug}.md`;
    documents.set(`${locale}/${slug}`, {source, ...markdown(expand(await fs.readFile(path.join(root, source), 'utf8'), locale))});
  }
}
for (const slug of PAGE_SLUGS) {
  const zh = documents.get(`zh-CN/${slug}`).allHeadings, en = documents.get(`en/${slug}`).allHeadings;
  if (JSON.stringify(zh.map(h => h.depth)) !== JSON.stringify(en.map(h => h.depth))) throw new Error(`Heading structure differs between translations: ${slug}`);
}
await fs.mkdir(out, {recursive: true});
await fs.cp(path.join(root, 'website/assets'), path.join(out, 'assets'), {recursive: true});
await fs.mkdir(path.join(out, 'downloads'), {recursive: true});
for (const [source, name] of [['dist/C3MiniGameBridge.c3addon', 'C3MiniGameBridge.c3addon'], ['examples/construct/MiniGameApiSuite.c3p', 'MiniGameApiSuite.c3p']]) await fs.copyFile(path.join(root, source), path.join(out, 'downloads', name));

for (const locale of LOCALES) {
  const t = messages[locale], localeOut = path.join(out, locale === 'en' ? 'en' : '');
  await fs.mkdir(localeOut, {recursive: true});
  const homeSource = locale === 'en' ? 'website/en/home.html' : 'website/home.html';
  const home = expand(await fs.readFile(path.join(root, homeSource), 'utf8'), locale);
  await fs.writeFile(path.join(localeOut, 'index.html'), shell({locale, title: t.homeTitle, description: t.homeDescription, body: home}));
  for (const [index, slug] of PAGE_SLUGS.entries()) {
    const [title, description] = t.pages[index];
    const document = documents.get(`${locale}/${slug}`), counterpart = documents.get(`${otherLocale(locale)}/${slug}`);
    const headings = [...document.headings];
    const anchorMap = Object.fromEntries(document.allHeadings.map((h, i) => [h.id, counterpart.allHeadings[i].id]));
    let articleHTML = document.html;
    if (slug === 'api') {
      const split = articleHTML.indexOf('<h2');
      const jump = `<p><a class="button" href="#${escape(headings[0].id)}">${t.apiJump}</a></p>`;
      articleHTML = articleHTML.slice(0, split) + jump + apiTable(locale) + articleHTML.slice(split);
      headings.unshift({id: 'api-directory', text: t.apiDirectory});
    }
    const navLinks = PAGE_SLUGS.map((key, i) => `<a href="${link(key, locale)}"${current(key, slug)}>${t.pages[i][0]}</a>`).join('');
    const body = `<main id="main" class="doc-layout"><aside class="doc-sidebar" aria-label="${t.docsNav}"><p class="sidebar-label">${t.docsLabel} · v${version}</p><nav>${navLinks}</nav><div class="sidebar-separator"><a href="${base}downloads/C3MiniGameBridge.c3addon" download>${t.downloadAddon}</a><a href="${base}downloads/MiniGameApiSuite.c3p" download>${t.downloadDemo}</a><a href="${repo}">GitHub ↗</a></div></aside><article class="doc-content"><details class="doc-mobile-nav"><summary>${t.mobileDocs} · ${title}</summary><nav aria-label="${t.mobileDocsLabel}">${navLinks}</nav></details><p class="eyebrow">CONSTRUCT MINI GAME / ${slug.toUpperCase()}</p>${articleHTML}<div class="doc-bottom"><a href="${repo}/blob/main/${document.source}">${t.viewSource}</a><span>${t.docsVersion} v${version}</span></div></article><aside class="doc-toc" aria-label="${t.tocLabel}"><strong>${t.toc}</strong>${headings.map(h => `<a href="#${escape(h.id)}">${escape(h.text)}</a>`).join('')}</aside></main>`;
    await fs.mkdir(path.join(localeOut, slug), {recursive: true});
    await fs.writeFile(path.join(localeOut, slug, 'index.html'), shell({slug, locale, title, description: expand(description, locale), body, anchorMap}));
  }
  const notFound = `<main class="container section" id="main"><p class="eyebrow">404</p><h1>${t.missingHeading}</h1><p>${t.missingText}</p><div class="actions"><a class="button primary" href="${link('', locale)}">${t.backHome}</a><a class="button" href="${link('api', locale)}">${t.pages[2][0]}</a></div></main>`;
  await fs.writeFile(path.join(localeOut, '404.html'), shell({slug: '404', locale, title: t.missingTitle, description: t.missingDescription, body: notFound}));
}
await fs.writeFile(path.join(out, '.nojekyll'), '');
const sitemapURLs = LOCALES.flatMap(locale => ['', ...PAGE_SLUGS].map(slug => `<url><loc>${origin}${link(slug, locale)}</loc></url>`));
await fs.writeFile(path.join(out, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${sitemapURLs.join('')}</urlset>`);
console.log(`Built ${LOCALES.length * (PAGE_SLUGS.length + 1)} localized pages and 2 error pages at ${out}`);
