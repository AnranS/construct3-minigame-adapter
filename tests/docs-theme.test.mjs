import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const source = await fs.readFile(new URL('../website/assets/theme.js', import.meta.url), 'utf8');
const key = 'c3-minigame-docs-theme';

function eventTarget() {
  const listeners = new Map();
  return {
    addEventListener(type, callback, options) {
      const entries = listeners.get(type) ?? [];
      entries.push({callback, once: Boolean(options?.once)});
      listeners.set(type, entries);
    },
    removeEventListener(type, callback) {
      listeners.set(type, (listeners.get(type) ?? []).filter(entry => entry.callback !== callback));
    },
    emit(type, detail = {}) {
      const event = {type, target: this, currentTarget: this, ...detail};
      for (const entry of [...(listeners.get(type) ?? [])]) {
        if (entry.once) this.removeEventListener(type, entry.callback);
        entry.callback.call(this, event);
      }
    }
  };
}

function browser({saved = null, dark = false, storageFailure = null} = {}) {
  const stored = new Map(saved === null ? [] : [[key, saved]]);
  const storage = {
    getItem(name) { if (storageFailure === 'methods') throw new Error('Storage blocked'); return stored.get(name) ?? null; },
    setItem(name, value) { if (storageFailure === 'methods') throw new Error('Quota or access failure'); stored.set(name, String(value)); },
    removeItem(name) { if (storageFailure === 'methods') throw new Error('Storage blocked'); stored.delete(name); }
  };
  const root = {dataset: {}};
  const meta = {content: '#initial', setAttribute(name, value) { this[name] = String(value); }};
  const control = {hidden: true};
  const picker = {...eventTarget(), value: '', closest(selector) { assert.equal(selector, '[data-theme-control]'); return control; }};
  const media = {...eventTarget(), matches: dark, media: '(prefers-color-scheme: dark)'};
  const document = {
    ...eventTarget(), documentElement: root, readyState: 'loading',
    querySelector(selector) {
      if (selector === 'meta[name="theme-color"]') return meta;
      if (selector === '[data-theme-picker]') return picker;
      return null;
    }
  };
  const window = {...eventTarget(), document, matchMedia(query) { assert.equal(query, '(prefers-color-scheme: dark)'); return media; }};
  const sandbox = {window, document};
  Object.defineProperty(sandbox, 'localStorage', {get() {
    if (storageFailure === 'access') throw new Error('SecurityError: storage access denied');
    return storage;
  }});
  vm.runInNewContext(source, sandbox, {filename: 'website/assets/theme.js', timeout: 1000});
  return {
    root, meta, control, picker, stored,
    ready() { document.readyState = 'interactive'; document.emit('DOMContentLoaded'); },
    choose(value) { picker.value = value; picker.emit('change'); },
    system(value) { media.matches = value; media.emit('change', {matches: value, media: media.media}); },
    fromAnotherTab(value, eventKey = key) {
      if (eventKey === null) stored.clear();
      else if (value === null) stored.delete(eventKey);
      else stored.set(eventKey, value);
      window.emit('storage', {key: eventKey, newValue: value, storageArea: storage});
    },
    pageshow(persisted) { window.emit('pageshow', {persisted}); }
  };
}

function expectTheme(page, theme, preference) {
  assert.equal(page.root.dataset.theme, theme);
  assert.equal(page.root.dataset.themePreference, preference);
  assert.equal(typeof page.meta.content, 'string');
  assert.notEqual(page.meta.content.trim(), '');
  assert.notEqual(page.meta.content, '#initial');
}

test('Theme applies before DOM readiness, with saved light/dark taking priority over the system', () => {
  const scenarios = [
    [{dark: true}, 'dark', 'system'],
    [{dark: false}, 'light', 'system'],
    [{saved: 'light', dark: true}, 'light', 'light'],
    [{saved: 'dark', dark: false}, 'dark', 'dark'],
    [{saved: 'sepia', dark: true}, 'dark', 'system']
  ];
  for (const [options, theme, preference] of scenarios) {
    const page = browser(options);
    expectTheme(page, theme, preference);
    assert.equal(page.control.hidden, true);
    page.ready();
    assert.equal(page.control.hidden, false);
    assert.equal(page.picker.value, preference);
  }
});

test('Manual choices persist, update browser chrome, and System removes the saved override', () => {
  const page = browser({dark: true});
  page.ready();
  const darkColor = page.meta.content;
  page.choose('light');
  expectTheme(page, 'light', 'light');
  assert.equal(page.stored.get(key), 'light');
  assert.notEqual(page.meta.content, darkColor);
  page.choose('dark');
  expectTheme(page, 'dark', 'dark');
  assert.equal(page.stored.get(key), 'dark');
  assert.equal(page.meta.content, darkColor);
  page.system(false);
  expectTheme(page, 'dark', 'dark');
  page.choose('system');
  expectTheme(page, 'light', 'system');
  assert.equal(page.stored.has(key), false);
  assert.equal(page.picker.value, 'system');
});

test('Storage access and method failures retain usable system and manual theme selection', () => {
  for (const storageFailure of ['access', 'methods']) {
    const page = browser({saved: 'light', dark: true, storageFailure});
    expectTheme(page, 'dark', 'system');
    page.ready();
    page.choose('light');
    expectTheme(page, 'light', 'light');
    assert.equal(page.picker.value, 'light');
    page.choose('dark');
    expectTheme(page, 'dark', 'dark');
    page.choose('system');
    expectTheme(page, 'dark', 'system');
    page.system(false);
    expectTheme(page, 'light', 'system');
  }
});

test('System changes respect manual preferences; cross-tab updates and clear synchronize the picker', () => {
  const page = browser({dark: false});
  page.ready();
  page.system(true);
  expectTheme(page, 'dark', 'system');
  page.choose('light');
  page.system(false);
  page.system(true);
  expectTheme(page, 'light', 'light');
  page.fromAnotherTab('dark');
  expectTheme(page, 'dark', 'dark');
  assert.equal(page.picker.value, 'dark');
  page.fromAnotherTab('light', 'unrelated-setting');
  expectTheme(page, 'dark', 'dark');
  page.fromAnotherTab('invalid-theme');
  expectTheme(page, 'dark', 'system');
  assert.equal(page.picker.value, 'system');
  page.fromAnotherTab('light');
  expectTheme(page, 'light', 'light');
  page.fromAnotherTab(null, null);
  expectTheme(page, 'dark', 'system');
  assert.equal(page.picker.value, 'system');
  page.fromAnotherTab('light');
  page.fromAnotherTab(null);
  expectTheme(page, 'dark', 'system');
});

test('A persisted pageshow re-reads preferences changed while the page was in bfcache', () => {
  const page = browser({saved: 'light', dark: true});
  page.ready();
  page.stored.set(key, 'dark');
  page.pageshow(false);
  expectTheme(page, 'light', 'light');
  page.pageshow(true);
  expectTheme(page, 'dark', 'dark');
  assert.equal(page.picker.value, 'dark');
  page.stored.delete(key);
  page.pageshow(true);
  expectTheme(page, 'dark', 'system');
  assert.equal(page.picker.value, 'system');
  page.system(false);
  expectTheme(page, 'light', 'system');
});
