import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {PLATFORM_API_CATALOG} from '../src/runtime/platform-api.js';
import {API_PLATFORMS, API_PLATFORM_LABELS, getAPICatalog, getAPIPlatformLabels} from '../website/api-catalog.mjs';
import {checkSite} from '../website/check.mjs';

const base = '/construct3-minigame-adapter/';
const origin = 'https://anrans.github.io';
const slugs = ['', 'guide', 'addon', 'api', 'tiktok-iap', 'troubleshooting', 'validation', '404.html'];
const escape = value => String(value).replace(/[&<>"']/g, character => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[character]));
const route = (locale, slug) => `${base}${locale === 'en' ? 'en/' : ''}${slug === '404.html' ? slug : slug ? `${slug}/` : ''}`;
const filename = (locale, slug) => route(locale, slug).slice(base.length) + (slug === '404.html' ? '' : 'index.html');

function apiTable(locale) {
  const rows = getAPICatalog(locale), labels = getAPIPlatformLabels(locale);
  const select = (name, options) => `<select name="${name}"><option value="">All</option>${options.map(([value, label]) => `<option value="${value}">${label}</option>`).join('')}</select>`;
  return select('platform', API_PLATFORMS.map(platform => [platform, labels[platform]])) + select('category', [...new Map(rows.map(row => [row.category, row.categoryLabel]))]) + select('kind', ['async', 'sync', 'object', 'event'].map(kind => [kind, kind])) +
    `<table><thead><tr><th>API</th><th>Category</th>${API_PLATFORMS.map(platform => `<th data-platform-column="${platform}">${labels[platform]}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr id="api-${row.name}" data-api-row data-category="${row.category}" data-search="${escape(row.notes.toLowerCase())}" ${API_PLATFORMS.map(platform => `data-${platform}="${row.kinds[platform] ?? ''}"`).join(' ')}><td><code>${row.name}</code></td><td>${row.categoryLabel}</td>${API_PLATFORMS.map(platform => `<td data-platform-cell="${platform}">${row.kinds[platform] ? `<span class="kind-badge">${row.kinds[platform]}</span>${row.contracts[platform].map(contract => `<small>${escape(contract)}</small>`).join('')}` : 'Unlisted'}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}

async function fixture(t) {
  const siteRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'c3-docs-i18n-'));
  t.after(() => fs.rm(siteRoot, {recursive: true, force: true}));
  for (const locale of ['zh-CN', 'en']) {
    for (const slug of slugs) {
      const other = locale === 'en' ? 'zh-CN' : 'en';
      const output = path.join(siteRoot, filename(locale, slug));
      const source = `<!doctype html><html lang="${locale}"><head><link rel="canonical" href="${origin}${route(locale, slug)}">${['zh-CN', 'en', 'x-default'].map(language => `<link rel="alternate" hreflang="${language}" href="${origin}${route(language === 'x-default' ? 'zh-CN' : language, slug)}">`).join('')}</head><body><header><a data-language-switch hreflang="${other}" href="${route(other, slug)}">Switch language</a></header><main id="main"><h1>Documentation</h1><a href="#main">Main content</a><img src="${base}assets/example.svg" alt="Construct export settings with the HTML5 option selected">${slug === 'api' ? apiTable(locale) : ''}</main></body></html>`;
      await fs.mkdir(path.dirname(output), {recursive: true});
      await fs.writeFile(output, source);
    }
  }
  for (const [name, data] of [['assets/example.svg', '<svg xmlns="http://www.w3.org/2000/svg"></svg>'], ['downloads/C3MiniGameBridge.c3addon', 'fixture addon'], ['downloads/MiniGameApiSuite.c3p', 'fixture project']]) {
    const output = path.join(siteRoot, name);
    await fs.mkdir(path.dirname(output), {recursive: true});
    await fs.writeFile(output, data);
  }
  return siteRoot;
}

async function mutate(root, name, transform, verify) {
  const location = path.join(root, name), original = await fs.readFile(location, 'utf8');
  const changed = transform(original);
  assert.notEqual(changed, original, `Fault injection must change ${name}`);
  await fs.writeFile(location, changed);
  try { await verify(await checkSite({siteRoot: root})); }
  finally { await fs.writeFile(location, original); }
}

test('English catalog translates every label and contract without changing runtime contracts', () => {
  const originalMetadata = JSON.stringify(PLATFORM_API_CATALOG);
  const zh = getAPICatalog(), en = getAPICatalog('en');
  assert.deepEqual(zh, getAPICatalog('zh-CN'));
  assert.equal(zh.length, 194);
  assert.deepEqual(getAPIPlatformLabels(), API_PLATFORM_LABELS);
  assert.deepEqual(getAPIPlatformLabels('en'), {wechat: 'WeChat', douyin: 'Douyin', tiktok: 'TikTok'});
  const machineFields = ({categoryLabel, contracts, notes, ...row}) => row;
  assert.deepEqual(en.map(machineFields), zh.map(machineFields));
  for (const [index, row] of en.entries()) {
    assert.notEqual(row.categoryLabel, row.category, `${row.category} needs an English label`);
    assert.doesNotMatch(JSON.stringify([row.categoryLabel, row.notes, row.contracts]), /[\u3400-\u9fff]/u);
    assert.equal(Boolean(row.notes), Boolean(zh[index].notes), `${row.name} notes must not disappear`);
    for (const platform of row.platforms) assert.equal(row.contracts[platform].length, zh[index].contracts[platform].length, `${platform}.${row.name} contract count`);
  }
  const api = Object.fromEntries(en.map(row => [row.name, row]));
  assert.deepEqual(api.pay.contracts.tiktok, ['No timeout by default', 'Client callbacks do not confirm payment or fulfillment', 'Parameter: trade_order_id']);
  assert.match(api.shareAppMessage.contracts.wechat.join(' '), /successful sharing cannot be confirmed/);
  assert.equal(api.shareAppMessage.kinds.wechat, 'sync');
  assert.equal(api.shareAppMessage.kinds.tiktok, 'async');
  assert.match(api.showKeyboard.contracts.tiktok.join(' '), /keyboardType: text/);
  assert.equal(api.onNetworkStatusChange.kinds.tiktok, null);
  assert.equal(JSON.stringify(PLATFORM_API_CATALOG), originalMetadata);
});

test('Documentation checker accepts all 16 locale pages and both complete API tables', async t => {
  const result = await checkSite({siteRoot: await fixture(t)});
  assert.deepEqual(result.errors, []);
  assert.equal(result.documents, 16);
  assert.deepEqual(result.apiRows, {'zh-CN': 194, en: 194});
  assert.equal(result.checkedImages, 16);
  assert.ok(result.checkedLinks > 100);
});

test('Documentation checker catches incorrect locale metadata, counterpart routes and missing English pages', async t => {
  const root = await fixture(t);
  const cases = [
    ['en/guide/index.html', source => source.replace('lang="en"', 'lang="zh-CN"'), /en\/guide\/index.html: html lang must be en/],
    ['en/guide/index.html', source => source.replace(`rel="canonical" href="${origin}${base}en/guide/"`, `rel="canonical" href="${origin}${base}guide/"`), /en\/guide\/index.html: canonical/],
    ['en/api/index.html', source => source.replace(`hreflang="x-default" href="${origin}${base}api/"`, `hreflang="x-default" href="${origin}${base}en/api/"`), /alternate x-default/],
    ['404.html', source => source.replace(`data-language-switch hreflang="en" href="${base}en/404.html"`, `data-language-switch hreflang="en" href="${base}en/"`), /404.html: header language switch/],
    ['en/404.html', source => source.replace('<header>', '<div>').replace('</header>', '</div>'), /en\/404.html: header language switch/]
  ];
  for (const [name, transform, expected] of cases) await mutate(root, name, transform, result => assert.match(result.errors.join('\n'), expected));
  const missing = path.join(root, 'en/validation/index.html');
  await fs.rename(missing, `${missing}.backup`);
  const result = await checkSite({siteRoot: root});
  assert.ok(result.errors.includes('Missing page: en/validation/index.html'));
});

test('Documentation checker rejects lost English API rows, per-platform contracts and filter translations', async t => {
  const root = await fixture(t);
  const cases = [
    [source => source.replace(/<tr id="api-pay"[\s\S]*?<\/tr>/, ''), /API table must contain 194.*found 193/],
    [source => source.replace('<small>Client callbacks do not confirm payment or fulfillment</small>', ''), /API pay has incomplete or incorrect tiktok contracts/],
    [source => source.replace('data-platform-cell="wechat"', 'data-platform-cell="tiktok"'), /missing a unique wechat contract cell/],
    [source => source.replace('<option value="wechat">WeChat</option>', '<option value="wechat">微信</option>'), /API platform option wechat must be localized as WeChat/],
    [source => source.replace('<option value="event">event</option>', ''), /API kind filter has missing, duplicate or unexpected options/],
    [source => source.replace('<option value="system">System information</option>', '<option value="system">系统信息</option>'), /API category option system must be localized as System information/]
  ];
  for (const [transform, expected] of cases) await mutate(root, 'en/api/index.html', transform, result => assert.match(result.errors.join('\n'), expected));
});

test('Bilingual checker retains broken anchor, screenshot and download validation', async t => {
  const root = await fixture(t);
  await mutate(root, 'en/guide/index.html', source => source.replace('href="#main"', 'href="#missing-section"'), result => assert.match(result.errors.join('\n'), /Missing anchor: en\/guide\/index.html#missing-section/));
  await mutate(root, 'en/guide/index.html', source => source.replace('alt="Construct export settings with the HTML5 option selected"', 'alt="screenshot"'), result => assert.match(result.errors.join('\n'), /needs descriptive alt text/));
  await mutate(root, 'en/guide/index.html', source => source.replace('assets/example.svg', 'assets/missing.svg'), result => assert.match(result.errors.join('\n'), /Missing local image/));
  await fs.writeFile(path.join(root, 'downloads/C3MiniGameBridge.c3addon'), '');
  const result = await checkSite({siteRoot: root});
  assert.ok(result.errors.includes('Empty download: downloads/C3MiniGameBridge.c3addon'));
});
