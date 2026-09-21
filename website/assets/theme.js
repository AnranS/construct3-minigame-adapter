// Inlined before the stylesheet so a saved preference applies on the first paint.
(() => {
  const key = 'c3-minigame-docs-theme';
  const root = document.documentElement;
  const normalize = value => value === 'light' || value === 'dark' ? value : 'system';
  const readPreference = () => {
    try { return normalize(localStorage.getItem(key)); }
    catch { return 'system'; }
  };
  let preference = readPreference();
  let media;
  try { media = window.matchMedia('(prefers-color-scheme: dark)'); }
  catch { /* Manual selection remains available if media queries are unavailable. */ }
  let picker;
  const apply = () => {
    const theme = preference === 'system' ? (media?.matches ? 'dark' : 'light') : preference;
    root.dataset.theme = theme;
    root.dataset.themePreference = preference;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#111815' : '#fdfefd');
    if (picker) picker.value = preference;
  };
  apply();

  const followSystem = () => { if (preference === 'system') apply(); };
  if (media?.addEventListener) media.addEventListener('change', followSystem);
  else media?.addListener?.(followSystem);

  document.addEventListener('DOMContentLoaded', () => {
    picker = document.querySelector('[data-theme-picker]');
    if (!picker) return;
    picker.value = preference;
    picker.closest('[data-theme-control]').hidden = false;
    picker.addEventListener('change', () => {
      preference = normalize(picker.value);
      apply();
      try {
        if (preference === 'system') localStorage.removeItem(key);
        else localStorage.setItem(key, preference);
      } catch { /* Keep this page usable when storage is blocked or full. */ }
    });
  }, {once: true});

  window.addEventListener('storage', event => {
    if (event.key !== key && event.key !== null) return;
    preference = normalize(event.newValue);
    apply();
  });
  window.addEventListener('pageshow', event => {
    if (!event.persisted) return;
    preference = readPreference();
    apply();
  });
})();
