import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlatformStorage} from '../src/runtime/storage.js';

function nativeAPI() {
  const values = new Map([['other-app-data', 'unchanged']]);
  return {values, api: {
    getStorageInfoSync() { return {keys: [...values.keys()]}; },
    getStorageSync(key) { if (!values.has(key)) throw new Error('Missing key'); return values.get(key); },
    setStorageSync(key, value) { values.set(key, value); },
    removeStorageSync(key) { values.delete(key); }
  }};
}
for (const platform of ['douyin', 'wechat']) {
  test(`${platform}: platform storage persists across instances and isolates project/store names`, async () => {
    const {api, values} = nativeAPI();
    const root = createPlatformStorage({api});
    const project = root.createInstance({name: 'c3-localstorage-123'});
    const otherProject = root.createInstance({name: 'c3-localstorage-456'});
    const savegames = root.createInstance({name: 'c3-savegames-123'});
    assert.equal(await project.ready(), true); assert.equal(project.IsInMemory(), false);
    await project.setItem('score:中文', 42); await project.setItem('', false);
    await otherProject.setItem('score:中文', 900);
    const saveJSON = '{"is-c3-savegame":true,"world":[1,2,3]}';
    await savegames.setItem('slot1', saveJSON);
    assert.equal(await root.createInstance({name: 'c3-localstorage-123'}).getItem('score:中文'), 42);
    assert.equal(await savegames.getItem('slot1'), saveJSON);
    assert.equal(await project.getItem('missing'), null);
    assert.deepEqual(await project.keys(), ['score:中文', '']); assert.equal(await project.length(), 2);
    assert.equal(await project.key(0), 'score:中文'); assert.equal(await project.key(-1), null);
    await project.clear(); assert.equal(await project.length(), 0);
    assert.equal(await otherProject.getItem('score:中文'), 900); assert.equal(await savegames.getItem('slot1'), saveJSON);
    assert.equal(values.get('other-app-data'), 'unchanged');
  });
  test(`${platform}: binary storage preserves view boundaries and returns independent values`, async () => {
    const {api} = nativeAPI(); const storage = createPlatformStorage({api});
    const backing = new Uint8Array([99, 1, 2, 3, 88]);
    const value = {raw: new Uint8Array([5, 6]).buffer, typed: backing.subarray(1, 4), view: new DataView(backing.buffer, 1, 2), date: new Date('2026-01-01T00:00:00Z'), nested: [undefined, NaN, Infinity, 42n]};
    await storage.setItem('data', value); backing[1] = 200;
    const restored = await storage.getItem('data');
    assert.deepEqual([...new Uint8Array(restored.raw)], [5, 6]);
    assert.deepEqual([...restored.typed], [1, 2, 3]); assert.equal(restored.typed.byteOffset, 0);
    assert.equal(restored.view.getUint8(0), 1); assert.equal(restored.view.byteLength, 2);
    assert.equal(restored.date.toISOString(), '2026-01-01T00:00:00.000Z');
    assert.deepEqual(restored.nested, [undefined, NaN, Infinity, 42n]);
    restored.typed[0] = 0; assert.equal((await storage.getItem('data')).typed[0], 1);
    await storage.setItem('undefined', undefined); assert.equal(await storage.getItem('undefined'), null);
  });
  test(`${platform}: native quota/errors and unsupported values reject without pretending persistence`, async () => {
    const {api} = nativeAPI(); const storage = createPlatformStorage({api});
    api.setStorageSync = () => { throw new Error('Storage quota exceeded'); };
    await assert.rejects(storage.setItem('score', 42), /quota exceeded/);
    assert.equal(storage.IsInMemory(), false); assert.equal(await storage.getItem('score'), null);
    const cyclic = {}; cyclic.self = cyclic;
    await assert.rejects(storage.setItem('cycle', cyclic), /Cyclic/);
    await assert.rejects(storage.setItem('fn', () => {}), /Unsupported/);
    await assert.rejects(storage.setItem('blob', new Blob(['x'])), /Unsupported storage object/);
    await assert.rejects(storage.getItem('score', () => {}), /Promise APIs/);
  });
}

test('explicit memory fallback works without native APIs and clones caller values', async () => {
  const storage = createPlatformStorage({forceInMemoryFallback: true});
  assert.equal(storage.IsInMemory(), true); assert.equal(await storage.ready(), true);
  const value = {count: 1}; await storage.setItem('key', value); value.count = 2;
  assert.deepEqual(await storage.getItem('key'), {count: 1});
  storage.SetMemoryStorage(new Map([['replacement', [1, 2]]]));
  assert.deepEqual(await storage.keys(), ['replacement']);
  assert.equal(await storage.iterate((value, key, index) => `${key}:${index}:${value.length}`), 'replacement:1:2');
  assert.ok(storage.GetMemoryStorage() instanceof Map);
  const instance = storage.createInstance({forceInMemoryFallback: true});
  assert.deepEqual(await instance.keys(), []);
});

test('stored object keys cannot mutate object prototypes, corrupt payloads fail visibly', async () => {
  const {api, values} = nativeAPI(); const storage = createPlatformStorage({api});
  await storage.setItem('object', JSON.parse('{"__proto__":{"polluted":true},"constructor":"own"}'));
  const restored = await storage.getItem('object');
  assert.equal(Object.getPrototypeOf(restored), Object.prototype);
  assert.equal(Object.hasOwn(restored, '__proto__'), true); assert.equal(restored.__proto__.polluted, true);
  assert.equal({}.polluted, undefined);
  const key = [...values.keys()].find(key => key.includes('c3-native-storage'));
  values.set(key, 'broken-json'); await assert.rejects(storage.getItem('object'), SyntaxError);
});
