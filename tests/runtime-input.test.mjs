import test from 'node:test';
import assert from 'node:assert/strict';
import {installAdapter} from '../src/runtime/index.js';

function fixture({wheel = true} = {}) {
  const callbacks = new Map(), removed = [];
  const api = {
    getWindowInfo() { return {windowWidth: 390, windowHeight: 844, pixelRatio: 3}; },
    createCanvas() { return {getContext() { return {}; }}; }
  };
  for (const name of ['TouchStart', 'TouchMove', 'TouchEnd', 'TouchCancel', ...(wheel ? ['Wheel'] : [])]) {
    api[`on${name}`] = function (callback) { assert.equal(this, api); callbacks.set(name, callback); };
    api[`off${name}`] = function (callback) { assert.equal(this, api); assert.equal(callbacks.get(name), callback); callbacks.delete(name); removed.push(name); };
  }
  return {api, callbacks, removed, emit: (name, value) => callbacks.get(name).call(api, value)};
}

for (const platform of ['wechat', 'douyin']) {
  test(`${platform}: native wheel reaches Construct's window listener with CSS coordinates and pixel deltas`, async () => {
    const f = fixture(), host = {}, adapter = installAdapter({platform, host, api: f.api}), order = [];
    let wheel, touchEvents = 0, prevented = 0;
    host.addEventListener('wheel', () => order.push('window-capture'), true);
    host.document.addEventListener('wheel', () => order.push('document-capture'), true);
    adapter.canvas.addEventListener('wheel', event => { order.push('canvas'); event.preventDefault(); });
    host.document.addEventListener('wheel', () => order.push('document-bubble'));
    host.addEventListener('wheel', event => { order.push('window-bubble'); wheel = event; });
    host.addEventListener('pointerdown', () => touchEvents++);
    const native = {x: 25, y: 80, deltaX: -1.25, deltaY: 120, deltaZ: 2, timeStamp: 45,
      preventDefault() { assert.equal(this, native); prevented++; }};
    f.emit('Wheel', native);
    assert.deepEqual(order, ['window-capture', 'document-capture', 'canvas', 'document-bubble', 'window-bubble']);
    assert.equal(wheel.target, adapter.canvas);
    assert.deepEqual([wheel.clientX, wheel.clientY, wheel.pageX, wheel.pageY], [25, 80, 25, 80]);
    assert.deepEqual([wheel.deltaX, wheel.deltaY, wheel.deltaZ, wheel.deltaMode, wheel.timeStamp], [-1.25, 120, 2, 0, 45]);
    assert.equal(touchEvents, 0); assert.equal(prevented, 1);
    const queued = f.callbacks.get('Wheel'); await adapter.dispose();
    const before = order.length; queued(native);
    assert.equal(order.length, before); assert.ok(f.removed.includes('Wheel')); assert.equal(f.callbacks.size, 0);
  });

  test(`${platform}: wheel preserves explicit line/page units and browser coordinates without multiplying DPR`, async () => {
    const f = fixture(), host = {}, adapter = installAdapter({platform, host, api: f.api}), events = [];
    host.addEventListener('wheel', event => events.push(event));
    f.emit('Wheel', {clientX: 0, clientY: 7, x: 999, y: 999, pageX: 2, pageY: 9, deltaY: -3, deltaMode: 1, ctrlKey: true});
    f.emit('Wheel', {x: 30, y: 40, deltaY: 1, deltaMode: 2});
    assert.deepEqual(events.map(e => [e.clientX, e.clientY, e.pageX, e.pageY, e.deltaY, e.deltaMode]), [[0, 7, 2, 9, -3, 1], [30, 40, 30, 40, 1, 2]]);
    assert.equal(events[0].ctrlKey, true); assert.equal(events[0].deltaX, 0); assert.equal(events[0].deltaZ, 0);
    await adapter.dispose();
  });

  test(`${platform}: empty changedTouches yields only new starts and real ended contacts with stable numeric pointer IDs`, async () => {
    const f = fixture(), host = {}, adapter = installAdapter({platform, host, api: f.api}), events = [], touchEnds = [];
    for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) host.addEventListener(type, event => events.push(event));
    host.addEventListener('touchend', event => touchEnds.push(event));
    f.emit('TouchStart', {touches: [{identifier: '7', x: 10, y: 20}], changedTouches: [], timeStamp: 10});
    f.emit('TouchStart', {touches: [{identifier: 7, x: 10, y: 20}, {identifier: 'finger-b', x: 30, y: 40}], changedTouches: []});
    assert.equal(events.length, 2); assert.ok(events.every(e => typeof e.pointerId === 'number'));
    const [first, second] = events;
    assert.notEqual(first.pointerId, second.pointerId); assert.equal(first.isPrimary, true); assert.equal(second.isPrimary, false);
    f.emit('TouchMove', {touches: [{identifier: '7', x: 12, y: 24}, {identifier: 'finger-b', x: 30, y: 40}], changedTouches: []});
    const move = events.find(e => e.type === 'pointermove' && e.identifier === 7);
    assert.equal(move.pointerId, first.pointerId); assert.equal(move.clientY, 24);
    f.emit('TouchEnd', {touches: [{identifier: 'finger-b', x: 30, y: 40}], changedTouches: []});
    const up = events.at(-1);
    assert.equal(up.type, 'pointerup'); assert.equal(up.pointerId, first.pointerId); assert.equal(up.isPrimary, true);
    assert.equal(up.clientY, 24); assert.equal(up.buttons, 0); assert.equal(up.pressure, 0);
    assert.equal(touchEnds[0].changedTouches.length, 1); assert.equal(touchEnds[0].touches.length, 1);
    f.emit('TouchCancel', {touches: [], changedTouches: []});
    assert.equal(events.at(-1).pointerId, second.pointerId); assert.equal(events.at(-1).isPrimary, false);
    const queued = f.callbacks.get('TouchStart'); await adapter.dispose();
    const before = events.length; queued({touches: [{identifier: 0}], changedTouches: []}); assert.equal(events.length, before);
  });
}

test('an absent native wheel API adds no fallback mouse/touch event source', async () => {
  const f = fixture({wheel: false}), adapter = installAdapter({host: {}, api: f.api});
  assert.equal(f.callbacks.has('Wheel'), false); await adapter.dispose();
});

test('wheel registration requires the matching off method and rolls installation back', () => {
  const f = fixture(), host = {}; delete f.api.offWheel;
  assert.throws(() => installAdapter({host, api: f.api}), /offWheel is required/);
  assert.equal(host.document, undefined); assert.equal(f.callbacks.size, 0);
});
