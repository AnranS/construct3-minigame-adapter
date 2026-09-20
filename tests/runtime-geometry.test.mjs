import test from 'node:test';
import assert from 'node:assert/strict';
import {DOMRect, DOMRectReadOnly} from '../src/runtime/geometry.js';
import {installAdapter} from '../src/runtime/index.js';
import {createEngineScope} from '../src/runtime/scope.js';

test('DOMRect supports C3 viewport geometry, negative dimensions and JSON serialization', () => {
  const empty = new DOMRect();
  assert.deepEqual(empty.toJSON(), {x: 0, y: 0, width: 0, height: 0, top: 0, right: 0, bottom: 0, left: 0});
  const rectangle = new DOMRect(100, 80, -60, -30);
  assert.ok(rectangle instanceof DOMRectReadOnly);
  assert.deepEqual(rectangle.toJSON(), {x: 100, y: 80, width: -60, height: -30, top: 50, right: 100, bottom: 80, left: 40});
  rectangle.x = '12'; rectangle.y = -5; rectangle.width = 30; rectangle.height = 15;
  assert.deepEqual(JSON.parse(JSON.stringify(rectangle)), {x: 12, y: -5, width: 30, height: 15, top: -5, right: 42, bottom: 10, left: 12});
  assert.equal(Object.prototype.toString.call(rectangle), '[object DOMRect]');
  assert.deepEqual(Object.keys(rectangle), [], 'geometry is held in internal slots');
});

test('DOMRectReadOnly is immutable and fromRect copies numeric dictionary fields', () => {
  const source = {x: '2', y: null, width: 5};
  const rectangle = DOMRectReadOnly.fromRect(source);
  source.width = 50;
  assert.equal(rectangle.x, 2); assert.equal(rectangle.y, 0); assert.equal(rectangle.width, 5); assert.equal(rectangle.height, 0);
  assert.throws(() => { rectangle.x = 4; }, TypeError);
  assert.throws(() => { rectangle.top = 4; }, TypeError);
  assert.equal(Object.prototype.toString.call(rectangle), '[object DOMRectReadOnly]');
  assert.deepEqual(DOMRect.fromRect(null).toJSON(), new DOMRect().toJSON());
  const mutable = DOMRect.fromRect(rectangle);
  mutable.width = 100; assert.equal(rectangle.width, 5);
  assert.ok(mutable instanceof DOMRect);
  assert.throws(() => DOMRect.fromRect(2), TypeError);
  const reads = [];
  DOMRect.fromRect(Object.fromEntries(['x', 'y', 'width', 'height'].map(key => [key, {valueOf() { reads.push(key); return 1; }}])));
  assert.deepEqual(reads, ['height', 'width', 'x', 'y']);
});

test('DOMRect follows unrestricted-double conversion, NaN-safe bounds and receiver checks', () => {
  const rectangle = new DOMRect(-0, NaN, Infinity, -Infinity);
  assert.ok(Object.is(rectangle.x, -0));
  assert.equal(rectangle.right, Infinity); assert.ok(Object.is(rectangle.left, -0));
  assert.ok(Number.isNaN(rectangle.top)); assert.ok(Number.isNaN(rectangle.bottom));
  rectangle.width = NaN; assert.ok(Number.isNaN(rectangle.left)); assert.ok(Number.isNaN(rectangle.right));
  rectangle.x = Infinity; rectangle.width = -Infinity; assert.ok(Number.isNaN(rectangle.right));
  assert.throws(() => new DOMRect(1n), TypeError);
  assert.throws(() => { rectangle.height = Symbol('height'); }, TypeError);
  assert.throws(() => DOMRectReadOnly.prototype.toJSON.call({x: 1}), /Illegal DOMRect receiver/);
  assert.throws(() => Object.getOwnPropertyDescriptor(DOMRect.prototype, 'x').get.call({}), /Illegal DOMRect receiver/);
});

for (const platform of ['douyin', 'wechat']) {
  test(`${platform}: engine scope receives rectangle fallback and retains genuine native geometry`, async () => {
    const api = {createCanvas() { return {getContext() { return null; }}; }};
    const nativeHost = {[platform === 'douyin' ? 'tt' : 'wx']: api};
    const scope = createEngineScope(nativeHost, {platform});
    const adapter = installAdapter({host: scope, platform});
    assert.equal(scope.DOMRect, DOMRect); assert.equal(scope.DOMRectReadOnly, DOMRectReadOnly);
    assert.equal(new scope.DOMRect(1, 2, 320, 480).bottom, 482);
    await adapter.dispose();
    assert.equal(scope.DOMRect, undefined);
    class NativeDOMRectReadOnly {}
    class NativeDOMRect extends NativeDOMRectReadOnly {}
    nativeHost.DOMRect = NativeDOMRect; nativeHost.DOMRectReadOnly = NativeDOMRectReadOnly;
    const nativeScope = createEngineScope(nativeHost, {platform});
    const nativeAdapter = installAdapter({host: nativeScope, platform});
    assert.equal(nativeScope.DOMRect, NativeDOMRect); assert.equal(nativeScope.DOMRectReadOnly, NativeDOMRectReadOnly);
    await nativeAdapter.dispose();
    assert.equal(nativeScope.DOMRect, NativeDOMRect);
  });
}
