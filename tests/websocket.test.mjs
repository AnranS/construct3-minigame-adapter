import test from 'node:test';
import assert from 'node:assert/strict';
import {createWebSocketClass} from '../src/runtime/websocket.js';
import {installAdapter} from '../src/runtime/index.js';
import vm from 'node:vm';

const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function fixture() {
  const listeners = new Map(), sends = [], closes = [], instances = new Set();
  const task = {send(options) { sends.push(options); }, close(options) { closes.push(options); }};
  for (const name of ['Open', 'Message', 'Error', 'Close']) {
    task['on' + name] = callback => listeners.set(name, callback);
    task['off' + name] = callback => { if (listeners.get(name) === callback) listeners.delete(name); };
  }
  const api = {connectSocket(options) { assert.equal(this, api); api.options = options; return task; }};
  return {api, task, sends, closes, listeners, instances, emit: (name, value) => listeners.get(name)?.(value),
    WebSocket: createWebSocketClass({api, instances})};
}

test('native SocketTask request success is not OPEN; task events control independent sockets', async () => {
  const f = fixture(); const socket = new f.WebSocket('wss://example.test/game', ['game-v1']);
  assert.equal(socket.readyState, socket.CONNECTING);
  assert.throws(() => socket.send('too early'), {name: 'InvalidStateError'});
  const events = []; socket.addEventListener('open', () => events.push('open'));
  f.emit('Open', {header: {'Sec-WebSocket-Protocol': 'game-v1'}}); await flush();
  assert.equal(socket.readyState, socket.OPEN); assert.equal(socket.protocol, 'game-v1');
  assert.deepEqual(events, ['open']); assert.equal(f.api.options.url, 'wss://example.test/game');
  socket.dispose(); assert.equal(f.instances.size, 0); assert.equal(f.listeners.size, 0);
});

test('WebSocket preserves Blob/string send order, UTF-8 buffering and binary slices', async () => {
  const f = fixture(); const socket = new f.WebSocket('wss://example.test');
  f.emit('Open', {}); await flush();
  socket.send(new Blob(['你好'])); socket.send('后'); socket.send(new Uint8Array([1, 2, 3]).subarray(1));
  assert.equal(socket.bufferedAmount, 11); await flush(); assert.equal(f.sends.length, 1);
  assert.equal(new TextDecoder().decode(f.sends[0].data), '你好');
  f.sends[0].success({}); await flush(); assert.equal(f.sends[1].data, '后');
  f.sends[1].success({}); await flush(); assert.deepEqual([...new Uint8Array(f.sends[2].data)], [2, 3]);
  f.sends[2].success({}); await flush(); assert.equal(socket.bufferedAmount, 0);
  socket.dispose();
});

test('binaryType selects real Blob/ArrayBuffer and normal close remains terminal', async () => {
  const f = fixture(); const socket = new f.WebSocket('wss://example.test'); const data = [], closed = [];
  socket.onmessage = event => data.push(event.data); socket.onclose = event => closed.push(event);
  f.emit('Open', {}); f.emit('Message', {data: new Uint8Array([4, 5]).buffer}); await flush();
  assert.ok(data[0] instanceof Blob); assert.equal(data[0].size, 2);
  socket.binaryType = 'arraybuffer'; f.emit('Message', {data: new Uint8Array([6]).buffer}); await flush();
  assert.deepEqual([...new Uint8Array(data[1])], [6]);
  socket.close(1000, 'done'); assert.equal(socket.readyState, socket.CLOSING);
  const lateOpen = f.listeners.get('Open'); f.emit('Close', {code: 1000, reason: 'done'}); await flush();
  lateOpen({}); await flush(); assert.equal(socket.readyState, socket.CLOSED);
  assert.equal(closed.length, 1); assert.equal(closed[0].wasClean, true); assert.equal(f.listeners.size, 0);
});

test('connection failure and disposal settle pending sends without late application callbacks', async () => {
  const f = fixture(); const socket = new f.WebSocket('wss://example.test'); const events = [];
  socket.onerror = () => events.push('error'); socket.onclose = event => events.push(event.code);
  f.api.options.fail({errMsg: 'connect failed'}); await flush();
  assert.deepEqual(events, ['error', 1006]); assert.equal(socket.readyState, socket.CLOSED);
  const g = fixture(); const active = new g.WebSocket('wss://example.test');
  g.emit('Open', {}); await flush(); active.send('pending'); await flush();
  assert.equal(active.bufferedAmount, 7); active.dispose(); assert.equal(active.bufferedAmount, 0);
  g.sends[0].fail({errMsg: 'late'}); await flush(); assert.equal(active.bufferedAmount, 0);
});

test('WebSocket validates URL/subprotocols and UTF-8 close reason before native side effects', () => {
  const f = fixture();
  for (const url of ['https://example.test', 'wss://example.test/#fragment', 'wss://user:pass@example.test'])
    assert.throws(() => new f.WebSocket(url), {name: 'SyntaxError'});
  assert.throws(() => new f.WebSocket('wss://example.test', ['same', 'same']), {name: 'SyntaxError'});
  const socket = new f.WebSocket('wss://example.test');
  assert.throws(() => socket.close(1006), {name: 'InvalidAccessError'});
  assert.throws(() => socket.close(1000, '你'.repeat(42)), {name: 'SyntaxError'});
  assert.equal(f.closes.length, 0); socket.dispose();
});

test('close drains previously accepted messages and supports ArrayBuffer from another realm', async () => {
  const f = fixture(); const socket = new f.WebSocket('wss://example.test');
  const foreign = vm.runInNewContext('new Uint8Array([9, 8]).buffer');
  f.emit('Open', {}); await flush(); socket.send(foreign); socket.send(new Blob(['last'])); socket.close(1000);
  await flush(); assert.equal(f.closes.length, 0); assert.deepEqual([...new Uint8Array(f.sends[0].data)], [9, 8]);
  f.sends[0].success({}); await flush(); assert.equal(new TextDecoder().decode(f.sends[1].data), 'last');
  assert.equal(f.closes.length, 0); f.sends[1].success({}); await flush(); assert.equal(f.closes.length, 1);
  socket.dispose();
});

test('adapter cleanup restores globals despite native cleanup errors and network events reflect host status', async () => {
  const nativeEvents = new Map(); const host = {fetch: () => 'old'}; const originalFetch = host.fetch;
  const api = {createCanvas: () => ({}), getWindowInfo: () => ({windowWidth: 300, windowHeight: 500}),
    onNetworkStatusChange: fn => nativeEvents.set('network', fn),
    offNetworkStatusChange: () => { nativeEvents.delete('network'); throw new Error('native off failed'); }};
  const adapter = installAdapter({api, host, platform: 'wechat'}); const changes = [];
  host.addEventListener('offline', () => changes.push('offline')); host.addEventListener('online', () => changes.push('online'));
  nativeEvents.get('network')({isConnected: false}); assert.equal(host.navigator.onLine, false);
  nativeEvents.get('network')({isConnected: false}); nativeEvents.get('network')({isConnected: true});
  assert.deepEqual(changes, ['offline', 'online']);
  await assert.rejects(adapter.dispose(), AggregateError);
  assert.equal(host.fetch, originalFetch); assert.equal(host.document, undefined); assert.equal(nativeEvents.size, 0);
});
