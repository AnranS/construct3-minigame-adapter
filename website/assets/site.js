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
  button.type = 'button'; button.className = 'copy-button'; button.textContent = '复制';
  button.setAttribute('aria-label', '复制代码');
  button.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(pre.querySelector('code')?.textContent || '');
      button.textContent = '已复制';
    } catch { button.textContent = '请手动选择复制'; }
    setTimeout(() => { button.textContent = '复制'; }, 2200);
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
      const kinds = platform ? [platformKind] : [row.dataset.wechat, row.dataset.douyin];
      const show = (!query || row.dataset.search.includes(query)) && (!platform || !!platformKind) && (!kind || kinds.includes(kind)) && (!category || row.dataset.category === category);
      row.hidden = !show;
      if (show) visible++;
    }
    count.textContent = `显示 ${visible} / ${rows.length} 个 API`;
    empty.hidden = visible !== 0;
  };
  filterForm.addEventListener('input', update);
  filterForm.addEventListener('change', update);
  filterForm.addEventListener('submit', event => event.preventDefault());
  filterForm.addEventListener('reset', () => setTimeout(update, 0));
  const params = new URLSearchParams(location.search);
  if (params.has('q')) filterForm.elements.search.value = params.get('q');
  update();
}
