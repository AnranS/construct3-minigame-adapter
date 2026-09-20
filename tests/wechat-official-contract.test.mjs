import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlatformAPI, PLATFORM_API_CATALOG, PlatformAPIError} from '../src/runtime/platform-api.js';

const wxEntries = new Map(PLATFORM_API_CATALOG.filter(entry => entry.platforms.includes('wechat')).map(entry => [entry.name, entry]));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

test('WeChat official directory does not infer Mini Program APIs from an available property', () => {
  const uncertain = ['canIUse', 'createOffscreenCanvas', 'chooseVideo', 'saveVideoToPhotosAlbum', 'reportAnalytics', 'requestVirtualPayment'];
  const api = Object.fromEntries(uncertain.map(name => [name, () => { throw new Error('must not run'); }]));
  const bridge = createPlatformAPI({api, platform: 'wechat'});
  for (const name of uncertain) {
    assert.equal(wxEntries.has(name), false, name);
    assert.equal(bridge.supportsAPI(name), false, name);
  }
  assert.equal(wxEntries.has('requestMidasFriendPayment'), false, 'officially deprecated entry is not promoted');
  assert.equal(wxEntries.has('onNeedPrivacyAuthorization'), false, 'singleton custom-consent registration needs a separate contract');
  bridge.dispose();
});

test('WeChat getOpenDataContext forwards sharedCanvasMode while Douyin retains its own invocation contract', () => {
  const result = {};
  const options = {sharedCanvasMode: 'screenCanvas'};
  const wx = createPlatformAPI({platform: 'wechat', api: {getOpenDataContext(value) { assert.equal(value, options); return result; }}});
  const tt = createPlatformAPI({platform: 'douyin', api: {getOpenDataContext(...args) { assert.equal(args.length, 0); return result; }}});
  assert.equal(wx.createAPIObject('getOpenDataContext', options), result);
  assert.equal(tt.createAPIObject('getOpenDataContext'), result);
  wx.dispose(); tt.dispose();
});

test('open-data onMessage uses one native listener without inventing offMessage', () => {
  let nativeListener, registrations = 0;
  const api = {onMessage(listener) { assert.equal(this, api); registrations++; nativeListener = listener; }};
  const first = createPlatformAPI({api, platform: 'wechat'});
  const second = createPlatformAPI({api, platform: 'wechat'});
  assert.equal(first.supportsAPI('onMessage'), true);
  assert.equal(registrations, 0, 'capability discovery does not register anything');
  const capability = first.getCapabilities().find(entry => entry.name === 'onMessage');
  assert.equal(capability.unsubscribe, 'local');
  assert.equal(capability.executionScope, 'open-data');
  const received = [];
  const context = {native: true};
  const unsubscribe = first.onAPIEvent('onMessage', function (...args) { received.push(['first', this, args]); return 'first-result'; });
  second.onAPIEvent('onMessage', function (...args) { received.push(['second', this, args]); return 'query=second'; });
  assert.equal(registrations, 1);
  assert.equal(nativeListener.call(context, {value: 2}, 'extra'), 'query=second');
  assert.deepEqual(received, [['first', context, [{value: 2}, 'extra']], ['second', context, [{value: 2}, 'extra']]]);
  unsubscribe(); unsubscribe(); first.dispose(); received.length = 0;
  nativeListener.call(context, 3);
  assert.deepEqual(received, [['second', context, [3]]]);
  second.dispose(); received.length = 0;
  assert.equal(nativeListener.call(context, 4), undefined);
  assert.deepEqual(received, []);
  const third = createPlatformAPI({api, platform: 'wechat'});
  third.onAPIEvent('onMessage', value => value);
  assert.equal(registrations, 1, 'new bridge reuses the inert native dispatcher');
  assert.equal(nativeListener(9), 9);
  third.dispose();
});

test('screenshot local unsubscribe never invokes native remove-all or removes external listeners', () => {
  let registrations = 0, offCalls = 0, externalCalls = 0;
  const listeners = new Set([() => { externalCalls++; }]);
  const api = {
    onUserCaptureScreen(listener) { registrations++; listeners.add(listener); },
    offUserCaptureScreen() { offCalls++; listeners.clear(); }
  };
  const a = createPlatformAPI({api, platform: 'wechat'}), b = createPlatformAPI({api, platform: 'wechat'});
  let aCalls = 0, bCalls = 0;
  const cancel = a.onAPIEvent('onUserCaptureScreen', () => { aCalls++; });
  b.onAPIEvent('onUserCaptureScreen', () => { bCalls++; });
  assert.equal(a.getCapabilities().find(entry => entry.name === 'onUserCaptureScreen').unsubscribe, 'local');
  for (const listener of listeners) listener();
  cancel(); a.dispose();
  for (const listener of listeners) listener();
  assert.deepEqual({aCalls, bCalls, externalCalls, registrations, offCalls}, {aCalls: 1, bCalls: 2, externalCalls: 2, registrations: 1, offCalls: 0});
  b.dispose(); for (const listener of listeners) listener();
  assert.equal(bCalls, 2); assert.equal(externalCalls, 3); assert.equal(offCalls, 0);
});

test('local-only event dispatch keeps other subscribers alive when one callback throws', () => {
  let nativeListener, otherCalls = 0;
  const bridge = createPlatformAPI({platform: 'wechat', api: {onMessage(listener) { nativeListener = listener; }}});
  const failure = new Error('consumer failed');
  const cancel = bridge.onAPIEvent('onMessage', () => { throw failure; });
  bridge.onAPIEvent('onMessage', () => { otherCalls++; return {query: 'still-alive'}; });
  assert.throws(() => nativeListener(), error => error === failure);
  assert.equal(otherCalls, 1);
  cancel(); assert.deepEqual(nativeListener(), {query: 'still-alive'});
  bridge.dispose();
});

test('failed local-only registration leaves no active callback and does not duplicate a possibly attached native listener', () => {
  let listener, registrations = 0, calls = 0;
  const api = {onMessage(value) { listener = value; registrations++; throw new Error('registration failed after attach'); }};
  const bridge = createPlatformAPI({api, platform: 'wechat'});
  assert.throws(() => bridge.onAPIEvent('onMessage', () => { calls++; }), {code: 'PLATFORM_ERROR'});
  listener(); assert.equal(calls, 0);
  assert.throws(() => bridge.onAPIEvent('onMessage', () => { calls++; }), {code: 'PLATFORM_ERROR'});
  assert.equal(registrations, 1);
  bridge.dispose(); listener(); assert.equal(calls, 0);
});

test('dispose during synchronous local-only registration releases the local callback', () => {
  let listener, calls = 0;
  const api = {onMessage(value) { listener = value; value(); }};
  const bridge = createPlatformAPI({api, platform: 'wechat'});
  bridge.onAPIEvent('onMessage', () => { calls++; bridge.dispose(); });
  listener(); assert.equal(calls, 1);
  const other = createPlatformAPI({api, platform: 'wechat'});
  other.onAPIEvent('onMessage', () => { calls++; });
  listener(); assert.equal(calls, 2);
  other.dispose();
});

test('official desktop and analytics sync methods preserve positions and do not wait for imaginary callbacks', () => {
  const calls = [];
  const api = {};
  for (const name of ['reportEvent', 'reportPerformance', 'getGamepads', 'setCursor', 'isPointerLocked', 'requestPointerLock', 'exitPointerLock']) {
    api[name] = function (...args) { assert.equal(this, api); calls.push([name, args]); return name === 'getGamepads' ? [] : undefined; };
  }
  const bridge = createPlatformAPI({api, platform: 'wechat'});
  bridge.getAPISync('reportEvent', 'test-event', {count: 1});
  bridge.getAPISync('reportPerformance', 17, 100, ['scene']);
  bridge.getAPISync('setCursor', 'default', 0, 0);
  assert.deepEqual(bridge.getAPISync('getGamepads'), []);
  assert.equal(bridge.getAPISync('requestPointerLock'), undefined);
  bridge.getAPISync('exitPointerLock');
  assert.deepEqual(calls, [['reportEvent', ['test-event', {count: 1}]], ['reportPerformance', [17, 100, ['scene']]], ['setCursor', ['default', 0, 0]], ['getGamepads', []], ['requestPointerLock', []], ['exitPointerLock', []]]);
  bridge.dispose();
});

test('callback-only privacy, scene reporting and media selection use native async results unchanged', async () => {
  let nativeOptions;
  const api = {};
  for (const name of ['getPrivacySetting', 'requirePrivacyAuthorize', 'openPrivacyContract', 'reportScene', 'chooseMedia']) {
    api[name] = options => { nativeOptions = options; };
  }
  const bridge = createPlatformAPI({api, platform: 'wechat'});
  for (const [name, options, result] of [
    ['getPrivacySetting', {}, {needAuthorization: true}],
    ['requirePrivacyAuthorize', {}, undefined],
    ['openPrivacyContract', {}, undefined],
    ['reportScene', {sceneId: 12, costTime: 75}, {data: {sceneId: 12}}],
    ['chooseMedia', {mediaType: ['video']}, {tempFiles: [{tempFilePath: 'native-path'}], type: 'video'}]
  ]) {
    const pending = bridge.callAPI(name, options);
    for (const [key, value] of Object.entries(options)) assert.equal(nativeOptions[key], value);
    nativeOptions.success(result);
    assert.equal(await pending, result);
  }
  bridge.dispose();
});

test('new keyboard-height and weak-network events remove their exact native listener', () => {
  const listeners = new Map();
  const api = {};
  for (const suffix of ['KeyboardHeightChange', 'NetworkWeakChange']) {
    api[`on${suffix}`] = listener => listeners.set(suffix, listener);
    api[`off${suffix}`] = listener => { assert.equal(listener, listeners.get(suffix)); listeners.delete(suffix); };
  }
  const bridge = createPlatformAPI({api, platform: 'wechat'});
  let height;
  const cancel = bridge.onAPIEvent('onKeyboardHeightChange', event => { height = event.height; });
  listeners.get('KeyboardHeightChange')({height: 230});
  assert.equal(height, 230);
  cancel(); assert.equal(listeners.has('KeyboardHeightChange'), false);
  bridge.onAPIEvent('onNetworkWeakChange', () => {});
  bridge.dispose(); assert.equal(listeners.size, 0);
});

test('Midas transport waits for native callback, retains signed bytes, and exposes no fulfillment result', async () => {
  let nativeOptions, calls = 0;
  const api = {
    requestMidasPayment(options) { calls++; nativeOptions = options; },
    requestMidasPaymentGameItem(options) { calls++; nativeOptions = options; }
  };
  const bridge = createPlatformAPI({api, platform: 'wechat', defaultTimeoutMs: 1});
  assert.equal(calls, 0);
  const metadata = bridge.getCapabilities().find(entry => entry.name === 'requestMidasPaymentGameItem');
  assert.equal(metadata.fulfillment, 'server-verified');
  assert.equal(calls, 0, 'discovery never starts payment');
  const signData = '{ "mode": "goods", "outTradeNo": "test-only" }';
  const options = {signData, paySig: 'server-issued-signature', signature: 'server-issued-user-signature'};
  const pending = bridge.callAPI('requestMidasPaymentGameItem', options);
  await delay(10);
  assert.equal(nativeOptions.signData, signData, 'signed JSON bytes are not parsed or normalized');
  assert.equal(nativeOptions.paySig, options.paySig);
  const frontendResult = {errMsg: 'requestMidasPaymentGameItem:ok'};
  nativeOptions.success(frontendResult);
  assert.equal(await pending, frontendResult);
  assert.equal(Object.hasOwn(frontendResult, 'fulfilled'), false);
  const cancelled = bridge.callAPI('requestMidasPayment', {mode: 'game', offerId: 'test-only'});
  const nativeFailure = {errMsg: 'requestMidasPayment:fail cancelled', errCode: -2};
  nativeOptions.fail(nativeFailure);
  await assert.rejects(cancelled, error => error.code === 'PLATFORM_ERROR' && error.cause === nativeFailure);
  bridge.dispose();
});

test('TikTok nested native failures retain non-enumerable details without leaking them in JSON diagnostics', () => {
  const cause = {error: {error_msg: 'native message with signed-data', error_code: 4001}};
  const error = new PlatformAPIError('PLATFORM_ERROR', 'requestPayment', 'tiktok', cause);
  assert.equal(error.cause, cause);
  assert.equal(error.nativeCode, 4001);
  assert.match(error.message, /native message with signed-data/);
  assert.equal(Object.keys(error).includes('nativeCode'), false);
  assert.equal(JSON.stringify(error).includes('signed-data'), false);
});

test('TikTok documented error alias settles once and preserves fail/error/complete consumers', async () => {
  let nativeOptions, calls = 0;
  const api = {
    getStorage(options) { calls++; nativeOptions = options; },
    checkBalance(options) { calls++; nativeOptions = options; },
    getStorageInfo(options) { calls++; nativeOptions = options; }
  };
  const bridge = createPlatformAPI({api, platform: 'tiktok'});
  const failure = {error: {error_code: 4001, error_msg: 'native failure'}};
  for (const name of ['getStorage', 'checkBalance']) {
    const callbacks = [];
    const pending = bridge.callAPI(name, {
      fail(value) { assert.equal(this, api); callbacks.push(['fail', value]); },
      error(value) { assert.equal(this, api); callbacks.push(['error', value]); },
      complete(value) { assert.equal(this, api); callbacks.push(['complete', value]); }
    });
    assert.equal(nativeOptions.error, nativeOptions.fail);
    nativeOptions.error(failure); nativeOptions.fail(failure); nativeOptions.complete(); nativeOptions.success();
    await assert.rejects(pending, error => error.code === 'PLATFORM_ERROR' && error.cause === failure);
    assert.deepEqual(callbacks, [['fail', failure], ['error', failure], ['complete', failure]]);
  }
  const pending = bridge.callAPI('getStorageInfo');
  assert.equal(Object.hasOwn(nativeOptions, 'error'), false, 'unmarked methods do not get an invented alias');
  nativeOptions.success({keys: []}); await pending;
  await assert.rejects(bridge.callAPI('getStorage', {error: 'not a function'}), {code: 'INVALID_ARGUMENT'});
  assert.equal(calls, 3);
  bridge.dispose();
});

test('TikTok duplicate alias consumer is called once and complete still runs when it throws', async () => {
  let nativeOptions, failed = 0, complete = 0;
  const bridge = createPlatformAPI({platform: 'tiktok', api: {setStorage(options) { nativeOptions = options; }}});
  const consumer = () => { failed++; throw new Error('consumer failed'); };
  const pending = bridge.callAPI('setStorage', {fail: consumer, error: consumer, complete() { complete++; }});
  nativeOptions.error({error: {error_code: 1, error_msg: 'native'}});
  await assert.rejects(pending, {code: 'CALLBACK_ERROR'});
  assert.equal(failed, 1); assert.equal(complete, 1);
  bridge.dispose();
});

test('TikTok copy URL keeps the native return contract and never calls remove-all when one subscriber leaves', () => {
  let nativeListener, registrations = 0, removals = 0;
  const api = {onCopyUrl(listener) { registrations++; nativeListener = listener; }, offCopyUrl() { removals++; }};
  const a = createPlatformAPI({api, platform: 'tiktok'}), b = createPlatformAPI({api, platform: 'tiktok'});
  const first = {query: 'scene=first'}, second = {query: 'scene=second'};
  a.onAPIEvent('onCopyUrl', function (...args) { assert.equal(this, api); assert.deepEqual(args, ['request', 7]); return first; });
  const cancel = b.onAPIEvent('onCopyUrl', () => second);
  assert.equal(nativeListener.call(api, 'request', 7), second);
  cancel(); assert.equal(nativeListener.call(api, 'request', 7), first);
  a.dispose(); b.dispose();
  assert.equal(nativeListener(), undefined);
  assert.equal(registrations, 1); assert.equal(removals, 0);
});
