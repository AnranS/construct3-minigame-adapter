import test from 'node:test';
import assert from 'node:assert/strict';
import {installAdapter} from '../src/runtime/index.js';
import {createPlatformStorage} from '../src/runtime/storage.js';

function nativeStorage({enumeration = 'missing', missing = undefined} = {}) {
  const values = new Map([['foreign-game-data', 'unchanged']]);
  const calls = {get: 0, set: 0, info: 0};
  const state = {listedKeys: [], readError: null, writeError: null};
  const api = {
    createCanvas() { return {getContext() { return {}; }}; },
    getStorageSync(key) {
      assert.equal(this, api); ++calls.get;
      if (state.readError) throw state.readError;
      return values.has(key) ? values.get(key) : missing;
    },
    setStorageSync(key, value) {
      assert.equal(this, api); ++calls.set;
      if (state.writeError) throw state.writeError;
      values.set(key, value);
    },
    removeStorageSync(key) { assert.equal(this, api); values.delete(key); }
  };
  if (enumeration !== 'missing') api.getStorageInfoSync = function () {
    assert.equal(this, api); ++calls.info;
    if (enumeration === 'throws') throw new Error('Enumeration is unavailable');
    return {keys: enumeration === 'accurate' ? [...values.keys()] : state.listedKeys};
  };
  return {api, values, calls, state};
}

function installTikTok(api) {
  const host = {TTMinis: {game: api}};
  return {host, adapter: installAdapter({platform: 'tiktok', host})};
}

for (const enumeration of ['missing', 'stale', 'throws']) {
  test(`TikTok localStorage point reads work independently of ${enumeration} key enumeration and survive reinstall`, async t => {
    const f = nativeStorage({enumeration});
    const first = installTikTok(f.api);
    t.after(() => first.adapter.dispose());
    const entries = [['中文:键', '持久值🎮'], ['empty', ''], ['null-text', 'null'], ['undefined-text', 'undefined'], ['', '空键']];
    for (const [key, value] of entries) {
      first.host.localStorage.setItem(key, value);
      assert.equal(first.host.localStorage.getItem(key), value);
    }
    assert.equal(first.host.localStorage.getItem('never-written'), null);
    assert.equal(f.calls.info, 0, 'point reads do not ask an optional enumeration API');
    assert.ok(f.calls.get >= entries.length + 1, 'reads reach native persistence');
    await first.adapter.dispose();

    const second = installTikTok(f.api);
    t.after(() => second.adapter.dispose());
    for (const [key, value] of entries) assert.equal(second.host.localStorage.getItem(key), value);
    assert.equal(f.values.get('foreign-game-data'), 'unchanged');
    assert.equal(f.calls.info, 0);
  });

  test(`TikTok Construct storage point reads and ready work with ${enumeration} enumeration across instances and namespaces`, async () => {
    const f = nativeStorage({enumeration});
    const root = createPlatformStorage({api: f.api, platform: 'tiktok'});
    const project = root.createInstance({name: 'project-中文'});
    const other = root.createInstance({name: 'other-project'});
    const savegames = root.createInstance({name: 'project-中文', storeName: 'savegames'});
    assert.equal(await project.ready(), true);
    assert.equal(project.IsInMemory(), false);
    const entries = [['中文:键', '持久值🎮'], ['empty', ''], ['null-text', 'null'], ['undefined-text', 'undefined'], ['', false], ['zero', 0], ['null', null]];
    for (const [key, value] of entries) {
      await project.setItem(key, value);
      assert.equal(await project.getItem(key), value);
    }
    await other.setItem('中文:键', 'other-value');
    await savegames.setItem('中文:键', {level: 3});
    assert.equal(await project.getItem('never-written'), null);
    const reopened = createPlatformStorage({api: f.api, platform: 'tiktok', name: 'project-中文'});
    for (const [key, value] of entries) assert.equal(await reopened.getItem(key), value);
    assert.equal(await other.getItem('中文:键'), 'other-value');
    assert.deepEqual(await savegames.getItem('中文:键'), {level: 3});
    assert.equal(f.values.get('foreign-game-data'), 'unchanged');
    assert.equal(f.calls.info, 0, 'createInstance inherits the TikTok point-read contract');
    assert.ok(f.calls.get > entries.length, 'reopened instances read native data');
  });
}

for (const missing of [undefined, null]) {
  test(`TikTok deletion uses native ${String(missing)} missing value despite stale positive keys`, async t => {
    const f = nativeStorage({enumeration: 'stale', missing});
    const {host, adapter} = installTikTok(f.api); t.after(() => adapter.dispose());
    const store = createPlatformStorage({api: f.api, platform: 'tiktok'});
    host.localStorage.setItem('remove-me', 'local-value');
    await store.setItem('remove-me', {value: 5});
    f.state.listedKeys = [...f.values.keys()];
    assert.equal(host.localStorage.getItem('remove-me'), 'local-value');
    assert.deepEqual(await store.getItem('remove-me'), {value: 5});
    host.localStorage.removeItem('remove-me');
    await store.removeItem('remove-me');
    assert.equal(host.localStorage.getItem('remove-me'), null);
    assert.equal(await store.getItem('remove-me'), null);
    assert.equal(f.calls.info, 0);
    assert.deepEqual([...f.values], [['foreign-game-data', 'unchanged']]);
  });
}

test('TikTok Construct envelopes distinguish stored empty strings from an empty missing sentinel', async () => {
  const f = nativeStorage({missing: ''});
  const storage = createPlatformStorage({api: f.api, platform: 'tiktok'});
  assert.equal(await storage.getItem('missing'), null);
  await storage.setItem('empty', '');
  const nativeValue = [...f.values].find(([key]) => key !== 'foreign-game-data')[1];
  assert.notEqual(nativeValue, '', 'the persisted envelope is nonempty even for an empty value');
  assert.equal(await storage.getItem('empty'), '');
  await storage.removeItem('empty');
  assert.equal(await storage.getItem('empty'), null);
});

test('TikTok enumeration operations require real enumeration while ready and point operations remain usable', async t => {
  const f = nativeStorage();
  const {host, adapter} = installTikTok(f.api); t.after(() => adapter.dispose());
  const storage = createPlatformStorage({api: f.api, platform: 'tiktok'});
  host.localStorage.setItem('retained', 'local');
  await storage.setItem('retained', 'runtime');
  assert.equal(await storage.ready(), true);
  for (const action of [() => host.localStorage.length, () => host.localStorage.key(0), () => host.localStorage.clear()]) {
    assert.throws(action, /getStorageInfoSync/);
  }
  for (const action of [() => storage.keys(), () => storage.length(), () => storage.key(0), () => storage.clear()]) {
    await assert.rejects(action(), /getStorageInfoSync/);
  }
  assert.equal(host.localStorage.getItem('retained'), 'local');
  assert.equal(await storage.getItem('retained'), 'runtime');
});

test('TikTok enumeration stays namespace-scoped when supported', async t => {
  const f = nativeStorage({enumeration: 'accurate'});
  const {host, adapter} = installTikTok(f.api); t.after(() => adapter.dispose());
  const storage = createPlatformStorage({api: f.api, platform: 'tiktok', name: 'project-one'});
  const other = storage.createInstance({name: 'project-two'});
  host.localStorage.setItem('中文', 'local');
  await storage.setItem('中文', 'runtime');
  await other.setItem('中文', 'other');
  assert.equal(host.localStorage.length, 1); assert.equal(host.localStorage.key(0), '中文');
  assert.deepEqual(await storage.keys(), ['中文']);
  await storage.clear();
  assert.equal(await storage.getItem('中文'), null);
  assert.equal(await other.getItem('中文'), 'other');
  assert.equal(host.localStorage.getItem('中文'), 'local');
  host.localStorage.clear();
  assert.equal(await other.getItem('中文'), 'other');
  assert.equal(f.values.get('foreign-game-data'), 'unchanged');
});

test('TikTok native read failures and quota errors propagate without a successful memory fallback', async t => {
  const f = nativeStorage();
  const {host, adapter} = installTikTok(f.api); t.after(() => adapter.dispose());
  const storage = createPlatformStorage({api: f.api, platform: 'tiktok'});
  const quota = new Error('Native storage quota exceeded');
  f.state.writeError = quota;
  assert.throws(() => host.localStorage.setItem('failed', 'value'), error => error === quota);
  await assert.rejects(storage.setItem('failed', 'value'), error => error === quota);
  assert.equal(storage.IsInMemory(), false);
  assert.deepEqual([...f.values], [['foreign-game-data', 'unchanged']]);
  f.state.writeError = null;
  assert.equal(host.localStorage.getItem('failed'), null);
  assert.equal(await storage.getItem('failed'), null);
  const readError = new Error('Native storage read permission denied');
  f.state.readError = readError;
  assert.throws(() => host.localStorage.getItem('key'), error => error === readError);
  await assert.rejects(storage.getItem('key'), error => error === readError);
});

test('TikTok corrupt native payloads fail visibly instead of being treated as missing or guessed wrappers', async () => {
  const f = nativeStorage();
  const storage = createPlatformStorage({api: f.api, platform: 'tiktok'});
  await storage.setItem('data', 'value');
  const nativeKey = [...f.values.keys()].find(key => key !== 'foreign-game-data');
  f.values.set(nativeKey, 'broken-json');
  await assert.rejects(storage.getItem('data'), SyntaxError);
  f.values.set(nativeKey, JSON.stringify({version: 999, value: 'value'}));
  await assert.rejects(storage.getItem('data'), /version/);
  f.values.set(nativeKey, {data: JSON.stringify({version: 1, value: 'value'})});
  await assert.rejects(storage.getItem('data'), /unexpected format/);
});

for (const platform of ['wechat', 'douyin']) {
  test(`${platform} retains key-gated missing-value semantics`, async t => {
    const f = nativeStorage({enumeration: 'stale', missing: ''});
    f.api.getStorageSync = () => { assert.fail('An absent enumerated key must not be read on this platform'); };
    const host = {[platform === 'wechat' ? 'wx' : 'tt']: f.api};
    const adapter = installAdapter({platform, host}); t.after(() => adapter.dispose());
    assert.equal(host.localStorage.getItem('missing'), null);
    assert.equal(await createPlatformStorage({api: f.api, platform}).getItem('missing'), null);
    assert.equal(f.calls.info, 2);
  });
}
