const english = document.documentElement.lang === 'en';
const text = english ? {
  copy: 'Copy', copyLabel: 'Copy code', copied: 'Copied', copyFailed: 'Select and copy manually',
  count: (visible, total) => `Showing ${visible} / ${total} APIs`,
} : {
  copy: '复制', copyLabel: '复制代码', copied: '已复制', copyFailed: '请手动选择复制',
  count: (visible, total) => `显示 ${visible} / ${total} 个 API`,
};
const languageLink = document.querySelector('[data-language-switch]');
const languageTarget = languageLink?.getAttribute('href');
const languageAnchors = JSON.parse(languageLink?.dataset.languageAnchors || '{}');
function updateLanguageLink() {
  if (!languageLink) return;
  const target = new URL(languageTarget, location.href);
  target.search = location.search;
  const form = document.querySelector('#api-filters');
  if (form) {
    for (const [field, parameter] of [['search', 'q'], ['platform', 'platform'], ['kind', 'kind'], ['category', 'category']]) {
      const value = form.elements[field].value;
      if (value) target.searchParams.set(parameter, value);
      else target.searchParams.delete(parameter);
    }
  }
  let anchor;
  try { anchor = decodeURIComponent(location.hash.slice(1)); } catch { anchor = ''; }
  target.hash = Object.hasOwn(languageAnchors, anchor) ? languageAnchors[anchor] : location.hash;
  languageLink.href = target.href;
}
languageLink?.addEventListener('click', updateLanguageLink);
window.addEventListener('hashchange', updateLanguageLink);

const toggle = document.querySelector('.menu-toggle');
const nav = document.querySelector('#primary-nav');
const closeMenu = (restore = false) => {
  if (!toggle || !nav) return;
  toggle.setAttribute('aria-expanded', 'false');
  nav.classList.remove('is-open');
  if (restore) toggle.focus();
};
toggle?.addEventListener('click', () => {
  const open = toggle.getAttribute('aria-expanded') !== 'true';
  toggle.setAttribute('aria-expanded', String(open));
  nav.classList.toggle('is-open', open);
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && toggle?.getAttribute('aria-expanded') === 'true') closeMenu(true);
});
document.addEventListener('click', event => {
  if (!event.target.closest('.site-header')) closeMenu();
});
nav?.addEventListener('click', event => { if (event.target.closest('a')) closeMenu(); });

for (const pre of document.querySelectorAll('pre')) {
  const button = document.createElement('button');
  button.type = 'button'; button.className = 'copy-button'; button.textContent = text.copy;
  button.setAttribute('aria-label', text.copyLabel);
  button.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(pre.querySelector('code')?.textContent || '');
      button.textContent = text.copied;
    } catch { button.textContent = text.copyFailed; }
    setTimeout(() => { button.textContent = text.copy; }, 2200);
  });
  pre.append(button);
}

const filterForm = document.querySelector('#api-filters');
if (filterForm) {
  const rows = [...document.querySelectorAll('[data-api-row]')];
  const count = document.querySelector('#api-count');
  const empty = document.querySelector('#api-empty');
  const update = () => {
    const query = filterForm.elements.search.value.trim().toLowerCase();
    const platform = filterForm.elements.platform.value;
    const kind = filterForm.elements.kind.value;
    const category = filterForm.elements.category.value;
    let visible = 0;
    for (const row of rows) {
      const platformKind = platform ? row.dataset[platform] : '';
      const kinds = platform ? [platformKind] : [row.dataset.wechat, row.dataset.douyin, row.dataset.tiktok];
      const show = (!query || row.dataset.search.includes(query)) && (!platform || !!platformKind) && (!kind || kinds.includes(kind)) && (!category || row.dataset.category === category);
      row.hidden = !show;
      if (show) visible++;
    }
    count.textContent = text.count(visible, rows.length);
    empty.hidden = visible !== 0;
    updateLanguageLink();
  };
  filterForm.addEventListener('input', update);
  filterForm.addEventListener('change', update);
  filterForm.addEventListener('submit', event => event.preventDefault());
  filterForm.addEventListener('reset', () => setTimeout(update, 0));
  const params = new URLSearchParams(location.search);
  if (params.has('q')) filterForm.elements.search.value = params.get('q');
  for (const name of ['platform', 'kind', 'category']) {
    const value = params.get(name);
    const field = filterForm.elements[name];
    if (value && [...field.options].some(option => option.value === value)) field.value = value;
  }
  update();
}
updateLanguageLink();
