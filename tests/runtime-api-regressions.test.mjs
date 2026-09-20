import test from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {createAudioClass} from '../src/runtime/audio.js';
import {createNetwork, MiniResponse} from '../src/runtime/network.js';
import {MiniEvent, MiniEventTarget, platformError} from '../src/runtime/events.js';

const flush = () => new Promise(resolve => setImmediate(resolve));
function audioFixture() {
  const callbacks = new Map(), instances = new Set(), calls = [];
  const inner = {volume: 1, src: '', currentTime: 0, duration: 2,
    play() { calls.push('play'); }, pause() { calls.push('pause'); },
    seek(value) { this.currentTime = value; calls.push(['seek', value]); },
    destroy() { calls.push('destroy'); }};
  for (const name of ['Canplay', 'Play', 'Pause', 'Stop', 'Ended', 'Seeking', 'Seeked', 'TimeUpdate', 'Error']) {
    inner[`on${name}`] = listener => callbacks.set(name, listener);
    inner[`off${name}`] = () => { calls.push(`off${name}`); callbacks.delete(name); };
  }
  const Audio = createAudioClass({api: {createInnerAudioContext: () => inner}, assetRoot: 'game', instances});
  return {Audio, inner, calls, callbacks, instances, emit: (name, data) => callbacks.get(name)?.(data)};
}
function networkFixture({abortThrows = false, host = globalThis} = {}) {
  const requests = [], files = [];
  const api = {
    request(options) {
      const record = {options, aborts: 0}; requests.push(record);
      return {abort() { record.aborts++; options.fail({errMsg: 'request:fail abort'}); if (abortThrows) throw new Error('native abort failed'); }};
    },
    getFileSystemManager() { return {readFile(options) { files.push(options); }}; }
  };
  const network = createNetwork({api, assetRoot: 'game', host});
  return {...network, api, requests, files,
    respond(index, data = 'ok', statusCode = 200, header = {}) { requests[index].options.success({data, statusCode, header}); }};
}

test('Audio settles play only from native playback/error and repeated play does not wait for another event', async () => {
  const f = audioFixture(), audio = new f.Audio('beep.wav');
  let settled = false;
  const first = audio.play().then(() => { settled = true; });
  const second = audio.play();
  await Promise.resolve(); assert.equal(settled, false); assert.deepEqual(f.calls, ['play']);
  f.emit('Play'); await Promise.all([first, second]);
  assert.equal(audio.paused, false); await audio.play(); assert.deepEqual(f.calls, ['play']);
  f.emit('Ended'); assert.equal(audio.paused, true); assert.equal(audio.ended, true);
  const failure = assert.rejects(audio.play(), error => error.code === 10003 && /file missing/.test(error.message));
  f.emit('Error', {errCode: 10003, errMsg: 'file missing'}); await failure;
  assert.equal(audio.paused, true); await assert.rejects(audio.play(), /file missing/);
  audio.load(); assert.equal(audio.error, null); assert.equal(audio.ended, false);
  audio.dispose();
});

test('Audio pause, source changes, native stop and disposal cancel pending playback', async () => {
  const f = audioFixture(), audio = new f.Audio('first.wav');
  for (const cancel of [() => audio.pause(), () => { audio.src = 'second.wav'; }, () => audio.load(), () => f.emit('Stop'), () => audio.dispose()]) {
    const pending = assert.rejects(audio.play(), {name: 'AbortError'});
    cancel(); await pending;
    assert.equal(audio.paused, true);
  }
  assert.equal(f.instances.size, 0); assert.equal(f.callbacks.size, 0);
  await assert.rejects(audio.play(), /disposed/);
});

test('Audio muted volume changes stay silent, boolean attributes and seek use real native state', () => {
  const f = audioFixture(), audio = new f.Audio('beep.wav');
  audio.volume = .7; audio.muted = true;
  assert.equal(audio.volume, .7); assert.equal(f.inner.volume, 0);
  audio.volume = .2; assert.equal(f.inner.volume, 0);
  audio.muted = false; assert.equal(f.inner.volume, .2);
  audio.setAttribute('loop', ''); audio.setAttribute('autoplay', 'false');
  assert.equal(f.inner.loop, true); assert.equal(f.inner.autoplay, true);
  for (const value of [NaN, Infinity, -1]) assert.throws(() => { audio.currentTime = value; }, RangeError);
  audio.currentTime = '1.25'; assert.equal(f.inner.currentTime, 1.25);
  const events = []; audio.onseeking = () => events.push('seeking'); audio.onseeked = () => events.push('seeked');
  f.emit('Seeking'); assert.equal(audio.seeking, true); f.emit('Seeked');
  assert.equal(audio.seeking, false); assert.deepEqual(events, ['seeking', 'seeked']);
  audio.dispose();
});

test('Audio cleanup attempts every native unsubscribe and destroy even when they throw', async () => {
  const f = audioFixture(), audio = new f.Audio('beep.wav');
  const queued = f.callbacks.get('Play'); let plays = 0; audio.onplay = () => plays++;
  f.inner.offCanplay = () => { throw new Error('off failure'); };
  f.inner.destroy = () => { f.calls.push('destroy'); throw new Error('destroy failure'); };
  const pending = assert.rejects(audio.play(), {name: 'AbortError'});
  assert.throws(() => audio.dispose(), error => error instanceof AggregateError && error.errors.length === 2);
  await pending; queued();
  assert.equal(plays, 0); assert.equal(audio.paused, true); assert.equal(f.instances.size, 0);
  assert.ok(f.calls.includes('offError')); assert.ok(f.calls.includes('destroy'));
  assert.doesNotThrow(() => audio.dispose());
});

test('Audio constructor failure releases the context it created', () => {
  const f = audioFixture();
  assert.throws(() => new f.Audio('../outside.wav'), /escapes assetRoot/);
  assert.equal(f.instances.size, 0); assert.equal(f.callbacks.size, 0); assert.ok(f.calls.includes('destroy'));
});

test('Audio pause listener can restart playback without its new play promise being cancelled', async () => {
  const f = audioFixture(), audio = new f.Audio('beep.wav');
  const started = audio.play(); f.emit('Play'); await started;
  let resumed;
  f.inner.pause = () => f.emit('Pause');
  audio.onpause = () => { resumed = audio.play(); };
  audio.pause(); f.emit('Play'); await resumed;
  assert.equal(audio.paused, false); audio.dispose();
});

test('fetch preserves HTTP failures, rejects malformed native success, and removes HEAD/null-status bodies', async () => {
  const f = networkFixture();
  const missing = f.fetch('https://example.test/missing'); f.respond(0, 'missing', 404);
  const response = await missing; assert.equal(response.ok, false); assert.equal(response.status, 404); assert.equal(await response.text(), 'missing');
  const malformed = assert.rejects(f.fetch('https://example.test/invalid'), /invalid HTTP statusCode/);
  f.requests[1].options.success({data: 'no status'}); await malformed;
  const head = f.fetch('https://example.test/head', {method: 'HEAD'}); f.respond(2, {unexpected: 'body'}, 200);
  assert.equal(await (await head).text(), '');
  const empty = f.fetch('https://example.test/empty'); f.respond(3, null, 204);
  assert.equal((await (await empty).arrayBuffer()).byteLength, 0); f.dispose();
});

test('fetch preserves file byte boundaries and cross-realm ArrayBuffer, with truthful JSON failures', async () => {
  const f = networkFixture();
  const pending = f.fetch('file.bin');
  f.files[0].success({data: new Uint8Array([9, 1, 2, 8]).subarray(1, 3)});
  const response = await pending, clone = response.clone();
  assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [1, 2]);
  assert.deepEqual([...new Uint8Array(await clone.arrayBuffer())], [1, 2]);
  await assert.rejects(response.text(), /already been consumed/);
  const foreign = f.fetch('foreign.bin'); f.files[1].success({data: runInNewContext('new Uint8Array([5, 6]).buffer')});
  assert.deepEqual([...new Uint8Array(await (await foreign).arrayBuffer())], [5, 6]);
  const invalid = await f.fetch('data:application/json,%7Bbad'); await assert.rejects(invalid.json(), SyntaxError);
  assert.equal(invalid.bodyUsed, true); await assert.rejects(f.fetch('file.bin', {method: 'POST'}), /GET and HEAD only/);
  f.dispose();
});

test('Response UTF-8 decoding matches TextDecoder for truncated, overlong and invalid sequences', async () => {
  for (const bytes of [[0xe2, 0x82], [0xf0, 0x90, 0x80], [0xed, 0xa0, 0x80], [0xe0, 0x80, 0xaf], [0xe2, 0x82, 65], [0xef, 0xbb, 0xbf, 65]]) {
    assert.equal(await new MiniResponse(new Uint8Array(bytes)).text(), new TextDecoder().decode(new Uint8Array(bytes)), bytes.join(','));
  }
});

test('fetch abort still rejects when native abort throws, ignores late completion and preserves a custom reason', async () => {
  const f = networkFixture({abortThrows: true}), controller = new AbortController();
  const aborted = assert.rejects(f.fetch('https://example.test/slow', {signal: controller.signal}), error => error.name === 'AbortError' && /native abort failed/.test(error.cause.message));
  assert.doesNotThrow(() => controller.abort()); await aborted;
  f.respond(0); f.requests[0].options.fail({errMsg: 'late failure'}); f.dispose();
  assert.equal(f.requests[0].aborts, 1);
  const g = networkFixture(), custom = new AbortController(), reason = new Error('cancelled by caller');
  custom.abort(reason); await assert.rejects(g.fetch('https://example.test/never', {signal: custom.signal}), error => error === reason);
  assert.equal(g.requests.length, 0); g.dispose();
});

test('fetch clears AbortSignal listeners on completion and cancels local reads without accepting late success', async () => {
  const f = networkFixture(), controller = new AbortController();
  let removed = 0;
  const remove = controller.signal.removeEventListener.bind(controller.signal);
  controller.signal.removeEventListener = (...args) => { removed++; return remove(...args); };
  const completed = f.fetch('https://example.test/done', {signal: controller.signal}); f.respond(0); await completed;
  controller.abort(); assert.equal(f.requests[0].aborts, 0); assert.equal(removed, 1);
  const local = new AbortController(); const pending = assert.rejects(f.fetch('file.bin', {signal: local.signal}), {name: 'AbortError'});
  local.abort(); f.files[0].success({data: 'late'}); await pending;
  f.dispose(); await assert.rejects(f.fetch('file.bin'), /disposed/);
});

test('fetch abort during synchronous native task construction aborts the returned task once', async () => {
  const controller = new AbortController(); let aborts = 0;
  const network = createNetwork({assetRoot: 'game', api: {request() { controller.abort(); return {abort() { aborts++; }}; }}});
  await assert.rejects(network.fetch('https://example.test/slow', {signal: controller.signal}), {name: 'AbortError'});
  assert.equal(aborts, 1); network.dispose();
});

test('XHR loadstart cancellation never starts native IO and emits one abort/loadend pair', async () => {
  const f = networkFixture(), xhr = new f.XMLHttpRequest(), events = [];
  xhr.onreadystatechange = () => events.push(`state:${xhr.readyState}`);
  xhr.onloadstart = () => { events.push('loadstart'); xhr.abort(); };
  for (const name of ['abort', 'loadend', 'load', 'error']) xhr.addEventListener(name, () => events.push(name));
  xhr.open('GET', 'https://example.test/never'); xhr.send(); await flush();
  assert.equal(f.requests.length, 0); assert.equal(xhr.readyState, 0);
  assert.deepEqual(events, ['state:1', 'loadstart', 'state:4', 'abort', 'loadend']); f.dispose();
});

test('XHR abort at HEADERS_RECEIVED stops old state and body delivery', async () => {
  const f = networkFixture(), xhr = new f.XMLHttpRequest(), states = [], events = [];
  xhr.onreadystatechange = () => { states.push(xhr.readyState); if (xhr.readyState === 2) xhr.abort(); };
  for (const name of ['abort', 'loadend', 'load', 'error']) xhr.addEventListener(name, () => events.push(name));
  xhr.open('GET', 'https://example.test/old'); xhr.send(); f.respond(0, 'old'); await flush();
  assert.deepEqual(states, [1, 2, 4]); assert.deepEqual(events, ['abort', 'loadend']);
  assert.equal(xhr.response, null); assert.equal(xhr.responseText, ''); assert.equal(xhr.responseURL, ''); assert.equal(xhr.status, 0); f.dispose();
});

test('XHR open during LOADING abandons the previous body without overwriting the next request', async () => {
  const f = networkFixture(), xhr = new f.XMLHttpRequest(); let replaced = false; let loads = 0;
  xhr.onload = () => loads++;
  xhr.onreadystatechange = () => {
    if (xhr.readyState === 3 && !replaced) { replaced = true; xhr.open('GET', 'https://example.test/new'); xhr.send(); }
  };
  xhr.open('GET', 'https://example.test/old'); xhr.send(); f.respond(0, 'old', 201, {'x-old': 'stale'}); await flush();
  assert.equal(xhr.readyState, 1); assert.equal(xhr.response, null); assert.equal(xhr.responseURL, ''); assert.equal(xhr.getResponseHeader('x-old'), null);
  f.respond(1, 'new'); await flush(); assert.equal(xhr.responseText, 'new'); assert.equal(loads, 1); f.dispose();
});

test('XHR DONE callback can immediately send a new request without the old finish clearing its state', async () => {
  const f = networkFixture(), xhr = new f.XMLHttpRequest(); let restarted = false;
  xhr.onreadystatechange = () => {
    if (xhr.readyState === 4 && !restarted) { restarted = true; xhr.open('GET', 'https://example.test/new'); xhr.send(); }
  };
  xhr.open('GET', 'https://example.test/old'); xhr.send(); f.respond(0, 'old'); await flush();
  assert.equal(xhr.readyState, 1); assert.throws(() => xhr.send(), /not open/);
  f.respond(1, 'new'); await flush(); assert.equal(xhr.responseText, 'new'); assert.equal(xhr.readyState, 4); f.dispose();
});

test('XHR abort callback can open a replacement request without being reset to UNSENT', async () => {
  const f = networkFixture(), xhr = new f.XMLHttpRequest();
  xhr.onabort = () => { xhr.open('GET', 'https://example.test/new'); xhr.send(); };
  xhr.open('GET', 'https://example.test/old'); xhr.send(); xhr.abort();
  assert.equal(xhr.readyState, 1); f.respond(1, 'new'); await flush(); assert.equal(xhr.responseText, 'new'); f.dispose();
});

test('XHR timeout emits timeout/loadend once, clears even timer ID zero and ignores native late callbacks', async () => {
  let timerCallback; const cleared = [];
  const f = networkFixture({abortThrows: true, host: {setTimeout(callback) { timerCallback = callback; return 0; }, clearTimeout(id) { cleared.push(id); }}});
  const xhr = new f.XMLHttpRequest(), events = [];
  for (const name of ['timeout', 'loadend', 'load', 'error', 'abort']) xhr.addEventListener(name, () => events.push(name));
  xhr.open('GET', 'https://example.test/slow'); xhr.timeout = 10; xhr.send(); timerCallback();
  f.respond(0, 'too late'); await flush();
  assert.deepEqual(events, ['timeout', 'loadend']); assert.deepEqual(cleared, [0]); assert.equal(f.requests[0].aborts, 1);
  assert.equal(xhr.readyState, 4); assert.equal(xhr.status, 0); assert.equal(xhr.responseURL, ''); assert.equal(xhr.lastError.name, 'TimeoutError'); f.dispose();
});

test('XHR HTTP failures complete as load, native failures clear stale metadata and retain error codes', async () => {
  const f = networkFixture(), xhr = new f.XMLHttpRequest(), events = [];
  for (const name of ['load', 'error', 'loadend']) xhr.addEventListener(name, () => events.push(name));
  xhr.open('GET', 'https://example.test/http'); xhr.send(); f.respond(0, 'server error', 503, {'x-test': 'one'}); await flush();
  assert.equal(xhr.status, 503); assert.equal(xhr.getResponseHeader('x-test'), 'one'); assert.deepEqual(events, ['load', 'loadend']);
  xhr.open('GET', 'https://example.test/network'); assert.equal(xhr.responseURL, ''); xhr.send();
  f.requests[1].options.fail({errCode: 600009, errMsg: 'connection failure'}); await flush();
  assert.equal(xhr.status, 0); assert.equal(xhr.getAllResponseHeaders(), ''); assert.equal(xhr.lastError.code, 600009);
  assert.deepEqual(events, ['load', 'loadend', 'error', 'loadend']); f.dispose();
});

test('network disposal during XHR response events stops body delivery and forbids later sends', async () => {
  const f = networkFixture(), xhr = new f.XMLHttpRequest(), events = [];
  xhr.onreadystatechange = () => { if (xhr.readyState === 2) f.dispose(); };
  for (const name of ['load', 'abort', 'loadend']) xhr.addEventListener(name, () => events.push(name));
  xhr.open('GET', 'https://example.test/finished-io'); xhr.send(); f.respond(0, 'must not deliver'); await flush();
  assert.deepEqual(events, ['abort', 'loadend']); assert.equal(xhr.response, null); assert.equal(xhr.readyState, 0);
  xhr.open('GET', 'https://example.test/after-disposal'); assert.throws(() => xhr.send(), /disposed/);
});

test('XHR cancellation during synchronous native task creation does not retain a timer or deliver a load', async () => {
  let xhr, aborts = 0, timers = 0; const events = [];
  const network = createNetwork({assetRoot: 'game', host: {setTimeout() { timers++; return 1; }}, api: {
    request(options) { xhr.abort(); return {abort() { aborts++; options.fail({errMsg: 'abort'}); }}; }
  }});
  xhr = new network.XMLHttpRequest(); xhr.timeout = 100;
  for (const name of ['load', 'abort', 'loadend']) xhr.addEventListener(name, () => events.push(name));
  xhr.open('GET', 'https://example.test/reentrant'); xhr.send(); await flush();
  assert.equal(aborts, 1); assert.equal(timers, 0); assert.deepEqual(events, ['abort', 'loadend']); network.dispose();
});

test('event listener removal during dispatch is honored and callback exceptions do not turn XHR load into network error', async t => {
  const errors = []; t.mock.method(console, 'error', (...args) => errors.push(args));
  const target = new MiniEventTarget(), calls = [];
  const removed = () => calls.push('removed');
  target.addEventListener('test', () => { target.removeEventListener('test', removed); calls.push('first'); throw new Error('handler failed'); });
  target.addEventListener('test', removed); target.addEventListener('test', () => calls.push('last'));
  target.ontest = () => calls.push('property');
  assert.doesNotThrow(() => target.dispatchEvent(new MiniEvent('test')));
  assert.deepEqual(calls, ['first', 'last', 'property']); assert.equal(errors.length, 1);
  const f = networkFixture(), xhr = new f.XMLHttpRequest(), events = [];
  xhr.onload = () => { events.push('load'); throw new Error('load handler failed'); };
  xhr.onerror = () => events.push('error'); xhr.onloadend = () => events.push('loadend');
  xhr.open('GET', 'https://example.test/ok'); xhr.send(); f.respond(0); await flush();
  assert.deepEqual(events, ['load', 'loadend']); assert.equal(xhr.status, 200); assert.equal(errors.length, 2); f.dispose();
});

test('native error normalization keeps both platform code formats and string failures', () => {
  assert.equal(platformError('api', {errNo: 42}).code, 42);
  assert.equal(platformError('api', {errCode: 43}).code, 43);
  assert.match(platformError('api', 'native rejection').message, /native rejection/);
});
