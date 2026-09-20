import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { marked } from 'marked';
import { getAPICatalog } from './api-catalog.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'dist/site');
const base = '/construct3-minigame-adapter/';
const origin = 'https://anrans.github.io';
const repo = 'https://github.com/AnranS/construct3-minigame-adapter';
const version = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8')).version;
const pages = [
  ['guide', '快速开始', '从安装 Construct 插件，到导出、转换和导入小游戏开发者工具。'],
  ['addon', '插件与脚本', '使用 Construct 事件表和 JavaScript 调用小游戏原生能力。'],
  ['api', 'API 参考', '搜索 171 个原生 API 名称，查看微信、抖音和调用类型差异。'],
  ['troubleshooting', '常见问题', '定位导出、初始化、存储、音频和微信 IDE 的常见问题。'],
  ['validation', '验证记录', '查看自动化回归、真实编辑器导出及微信 IDE 实测范围。'],
];
const escape = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const link = (slug = '') => `${base}${slug ? `${slug}/` : ''}`;
const current = (slug, active) => slug === active ? ' aria-current="page"' : '';
const brand = `<a class="brand" href="${base}" aria-label="Construct Mini Game 首页"><img src="${base}assets/favicon.svg" alt="" width="34" height="34"><span>Construct <small>Mini Game</small></span></a>`;
const header = active => `<a class="skip-link" href="#main">跳到正文</a><header class="site-header"><div class="container nav-shell">${brand}<button type="button" class="menu-toggle" aria-expanded="false" aria-controls="primary-nav">导航</button><nav class="nav-links" id="primary-nav" aria-label="主导航"><a href="${base}"${current('',active)}>概览</a><a href="${link('guide')}"${current('guide',active)}>使用指南</a><a href="${link('api')}"${current('api',active)}>API 参考</a><a href="${link('validation')}"${current('validation',active)}>验证状态</a><a class="github" href="${repo}">GitHub ↗</a></nav></div></header>`;
const footer = `<footer class="footer"><div class="container"><div>Construct Mini Game · v${version}<br>社区适配项目，与 Scirra、微信和抖音官方无隶属关系。</div><nav class="footer-links" aria-label="页脚导航"><a href="${repo}">源码</a><a href="${link('guide')}">文档</a><a href="${repo}/issues">反馈问题</a><a href="${repo}/blob/main/docs/THIRD_PARTY_NOTICES.md">第三方声明</a></nav></div></footer>`;
function shell({slug='', title, description, body}) {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#087e58"><title>${escape(title)} · Construct Mini Game</title><meta name="description" content="${escape(description)}"><link rel="canonical" href="${origin}${link(slug)}"><meta property="og:title" content="${escape(title)} · Construct Mini Game"><meta property="og:description" content="${escape(description)}"><meta property="og:type" content="website"><meta property="og:url" content="${origin}${link(slug)}"><link rel="icon" type="image/svg+xml" href="${base}assets/favicon.svg"><link rel="stylesheet" href="${base}assets/site.css"><script type="module" src="${base}assets/site.js"></script></head><body>${header(slug)}${body}${footer}</body></html>`;
}
function markdown(source) {
  const headings = [], used = new Map();
  const renderer = new marked.Renderer();
  renderer.heading = function ({tokens,depth}) {
    const text = this.parser.parseInline(tokens), plain = text.replace(/<[^>]*>/g,'');
    const key = plain.toLowerCase().replace(/[^\p{L}\p{N}]+/gu,'-').replace(/^-|-$/g,'') || 'section';
    const count = used.get(key) || 0; used.set(key,count+1);
    const id = count ? `${key}-${count+1}` : key;
    if (depth === 2) headings.push({id,text:plain});
    return `<h${depth} id="${escape(id)}">${text}</h${depth}>\n`;
  };
  const html = marked.parse(source,{renderer}).replace(/<table>/g,'<div class="table-wrap"><table>').replace(/<\/table>/g,'</table></div>');
  return {html,headings};
}
function apiTable() {
  const catalog = getAPICatalog();
  const categories = [...new Map(catalog.map(row=>[row.category,row.categoryLabel])).entries()];
  return `<section aria-labelledby="api-directory"><h2 id="api-directory">完整 API 目录</h2><p>下表来自运行时源码，随构建同步更新。类型表示调用入口；当前宿主是否提供该方法，请使用 <code>supportsAPI()</code> 检测。</p><form id="api-filters" class="api-filters" role="search" aria-label="筛选 API"><label class="search">搜索 API 或能力<input name="search" type="search" placeholder="例如 getStorage、键盘、audio" autocomplete="off"></label><label>目标平台<select name="platform"><option value="">全部平台</option><option value="wechat">微信 · WeChat</option><option value="douyin">抖音 · Douyin</option></select></label><label>调用类型<select name="kind"><option value="">全部类型</option><option value="async">async · 异步调用</option><option value="sync">sync · 同步调用</option><option value="object">object · 原生对象</option><option value="event">event · 事件订阅</option></select></label><label>能力分类<select name="category"><option value="">全部分类</option>${categories.map(([v,t])=>`<option value="${escape(v)}">${escape(t)}</option>`).join('')}</select></label><div class="filter-footer"><span id="api-count" role="status" aria-live="polite">显示 ${catalog.length} / ${catalog.length} 个 API</span><button type="reset">重置筛选</button></div></form><div class="table-wrap"><table class="api-table"><thead><tr><th scope="col">API 名称 / 调用说明</th><th scope="col">分类</th><th scope="col">微信</th><th scope="col">抖音</th></tr></thead><tbody>${catalog.map(row=>`<tr data-api-row data-search="${escape(`${row.name} ${row.category} ${row.categoryLabel} ${row.notes}`.toLowerCase())}" data-category="${escape(row.category)}" data-wechat="${row.kinds.wechat||''}" data-douyin="${row.kinds.douyin||''}" id="api-${escape(row.name)}"><td><code>${escape(row.name)}</code>${row.notes?`<small>${escape(row.notes)}</small>`:''}</td><td>${escape(row.categoryLabel)}</td>${['wechat','douyin'].map(platform=>`<td>${row.kinds[platform]?`<span class="kind-badge">${row.kinds[platform]}</span>`:'<span class="unsupported">未列入</span>'}</td>`).join('')}</tr>`).join('')}</tbody></table></div><p id="api-empty" class="api-empty" hidden>没有匹配的 API。试试其他关键词，或重置筛选。</p></section>`;
}
const home = await fs.readFile(path.join(root,'website/home.html'),'utf8');
const homeBody = home.replaceAll('{{BASE}}',base).replaceAll('{{REPO}}',repo).replaceAll('{{VERSION}}',version);
await fs.mkdir(out,{recursive:true});
await fs.cp(path.join(root,'website/assets'),path.join(out,'assets'),{recursive:true});
await fs.mkdir(path.join(out,'downloads'),{recursive:true});
for (const [source,name] of [['dist/C3MiniGameBridge.c3addon','C3MiniGameBridge.c3addon'],['examples/construct/MiniGameApiSuite.c3p','MiniGameApiSuite.c3p']]) await fs.copyFile(path.join(root,source),path.join(out,'downloads',name));
await fs.writeFile(path.join(out,'index.html'),shell({title:'Construct 游戏的小游戏适配工具',description:'Construct 3 微信 / 抖音小游戏插件、HTML5 导出转换与原生 API 文档。',body:homeBody}));
for (const [slug,title,description] of pages) {
  const {html,headings} = markdown(await fs.readFile(path.join(root,`website/content/${slug}.md`),'utf8'));
  if (slug==='api') headings.push({id:'api-directory',text:'完整 API 目录'});
  const navLinks = pages.map(([key,label])=>`<a href="${link(key)}"${current(key,slug)}>${label}</a>`).join('');
  const body = `<main id="main" class="doc-layout"><aside class="doc-sidebar" aria-label="文档导航"><p class="sidebar-label">使用文档 · v${version}</p><nav>${navLinks}</nav><div class="sidebar-separator"><a href="${base}downloads/C3MiniGameBridge.c3addon" download>下载插件 ↓</a><a href="${base}downloads/MiniGameApiSuite.c3p" download>下载示例工程 ↓</a><a href="${repo}">GitHub ↗</a></div></aside><article class="doc-content"><details class="doc-mobile-nav"><summary>文档目录 · ${title}</summary><nav aria-label="移动端文档导航">${navLinks}</nav></details><p class="eyebrow">CONSTRUCT MINI GAME / ${slug.toUpperCase()}</p>${html}${slug==='api'?apiTable():''}<div class="doc-bottom"><a href="${repo}/blob/main/website/content/${slug}.md">在 GitHub 查看本文 ↗</a><span>v${version} · 2026-09-20</span></div></article><aside class="doc-toc" aria-label="页内目录"><strong>本页内容</strong>${headings.map(h=>`<a href="#${escape(h.id)}">${escape(h.text)}</a>`).join('')}</aside></main>`;
  await fs.mkdir(path.join(out,slug),{recursive:true});
  await fs.writeFile(path.join(out,slug,'index.html'),shell({slug,title,description,body}));
}
await fs.writeFile(path.join(out,'404.html'),shell({title:'页面未找到',description:'返回 Construct Mini Game 文档。',body:`<main class="container section" id="main"><p class="eyebrow">404</p><h1>这个页面暂时不存在。</h1><p>可以从首页重新选择指南，或进入 API 目录搜索。</p><div class="actions"><a class="button primary" href="${base}">返回首页</a><a class="button" href="${link('api')}">API 参考</a></div></main>`}));
await fs.writeFile(path.join(out,'.nojekyll'),'');
await fs.writeFile(path.join(out,'sitemap.xml'),`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${['',...pages.map(p=>p[0])].map(slug=>`<url><loc>${origin}${link(slug)}</loc></url>`).join('')}</urlset>`);
console.log(`Built ${pages.length+1} pages at ${out} (base: ${base})`);
