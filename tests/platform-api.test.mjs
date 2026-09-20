import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlatformAPI, PLATFORM_API_CATALOG, PLATFORM_API_CATEGORIES} from '../src/runtime/platform-api.js';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

test('catalog is immutable, classified and has one invocation kind per platform/name', () => {
  assert.ok(PLATFORM_API_CATEGORIES.length >= 18);
  assert.ok(new Set(PLATFORM_API_CATALOG.map(item => item.name)).size >= 130);
  assert.equal(Object.isFrozen(PLATFORM_API_CATALOG), true);
  const keys = new Set();
  for (const item of PLATFORM_API_CATALOG) {
    assert.ok(['sync', 'async', 'object', 'event'].includes(item.kind));
    assert.ok(Object.isFrozen(item) && Object.isFrozen(item.platforms));
    for (const platform of item.platforms) {
      const key = `${platform}.${item.name}`;
      assert.equal(keys.has(key), false, key); keys.add(key);
    }
  }
});

for (const platform of ['wechat', 'douyin']) {
  test(`${platform}: whitelist and capability discovery have no side effects or sensitive data`, async () => {
    let calls = 0;
    const api = {login() { calls++; }, request() { calls++; }, onShow() { calls++; },
      undocumentedSecret() { throw new Error('must not be invoked'); }, secret: 'private-token'};
    const bridge = createPlatformAPI({api, platform});
    assert.equal(bridge.supportsAPI('request'), true);
    assert.equal(bridge.supportsAPI('undocumentedSecret'), false);
    assert.equal(bridge.supportsAPI('constructor'), false);
    assert.equal(bridge.supportsAPI('onShow'), false, 'without offShow it cannot be safely subscribed');
    await assert.rejects(bridge.callAPI('__proto__'), {code: 'UNSUPPORTED'});
    assert.throws(() => bridge.getAPISync('request'), {code: 'WRONG_API_KIND'});
    await assert.rejects(bridge.callAPI('getSystemInfoSync'), {code: 'UNSUPPORTED'});
    const serialized = JSON.stringify(bridge.getCapabilities());
    assert.equal(serialized.includes('private-token'), false); assert.equal(calls, 0);
    bridge.dispose(); assert.equal(bridge.supportsAPI('request'), false);
    await assert.rejects(bridge.callAPI('request'), {code: 'DISPOSED'});
  });

  test(`${platform}: async task is never success; callbacks complete once with original result and native receiver`, async () => {
    let nativeOptions;
    const task = {abort() {}};
    const api = {request(options) { assert.equal(this, api); nativeOptions = options; return task; }};
    const bridge = createPlatformAPI({api, platform});
    const calls = []; const result = {data: new ArrayBuffer(8), statusCode: 403};
    let actualTask;
    const promise = bridge.callAPI('request', {
      url: 'https://example.test', success(value) { assert.equal(this, api); calls.push(['success', value]); },
      fail(value) { calls.push(['fail', value]); }, complete(value) { calls.push(['complete', value]); }
    }, {onTask(value) { actualTask = value; }});
    let done = false; promise.then(() => { done = true; });
    await Promise.resolve(); assert.equal(done, false); assert.equal(actualTask, task);
    nativeOptions.success(result); nativeOptions.success({wrong: true}); nativeOptions.fail({errMsg: 'late failure'}); nativeOptions.complete(result);
    assert.equal(await promise, result); assert.deepEqual(calls, [['success', result], ['complete', result]]);
    assert.equal(result.statusCode, 403, 'HTTP status is native transport success, never rewritten');
    bridge.dispose();
  });

  test(`${platform}: sync throw and native failure reject; diagnostic JSON omits credentials and request data`, async () => {
    const original = {errMsg: 'request:fail secret-login-code', errCode: 8, token: 'secret-token'};
    const api = {request(options) { options.fail(original); }, getStorage() { throw new Error('private-value'); },
      getStorageSync() { throw new Error('read failed'); }};
    const bridge = createPlatformAPI({api, platform});
    const calls = [];
    let caught;
    try { await bridge.callAPI('request', {fail: value => calls.push(value), complete: value => calls.push(value)}); } catch (failure) { caught = failure; }
    assert.equal(caught.code, 'PLATFORM_ERROR'); assert.equal(caught.operation, 'request'); assert.equal(caught.cause, original);
    assert.deepEqual(calls, [original, original]);
    assert.equal(JSON.stringify(caught).includes('secret'), false);
    assert.equal(Object.keys(caught).includes('cause'), false);
    await assert.rejects(bridge.callAPI('getStorage'), {code: 'PLATFORM_ERROR'});
    assert.throws(() => bridge.getAPISync('getStorageSync', 'key'), {code: 'PLATFORM_ERROR'});
    bridge.dispose();
  });

  test(`${platform}: complete-only callbacks require explicit outcome and still call user callbacks once`, async () => {
    let result;
    const api = {showToast(options) { options.complete(result); options.complete(result); }};
    const bridge = createPlatformAPI({api, platform});
    result = {errMsg: 'showToast:ok'};
    let completed = 0;
    assert.equal(await bridge.callAPI('showToast', {complete() { completed++; }}), result);
    assert.equal(completed, 1);
    result = {errMsg: 'showToast:fail native-error'};
    await assert.rejects(bridge.callAPI('showToast'), {code: 'PLATFORM_ERROR'});
    result = {}; await assert.rejects(bridge.callAPI('showToast'), {code: 'PROTOCOL_ERROR'});
    bridge.dispose();
  });

  test(`${platform}: timeout and abort cancel a pending task exactly once and ignore late callbacks`, async () => {
    let nativeOptions, aborts = 0;
    const api = {downloadFile(options) { nativeOptions = options; return {abort() { aborts++; options.fail({errMsg: 'downloadFile:fail abort'}); }}; }};
    const bridge = createPlatformAPI({api, platform});
    const timed = bridge.callAPI('downloadFile', {}, {timeoutMs: 5});
    await assert.rejects(timed, {code: 'TIMEOUT'}); assert.equal(aborts, 1);
    nativeOptions.success({tempFilePath: 'late'}); timed.abort(); assert.equal(aborts, 1);
    const controller = new AbortController();
    const aborted = bridge.callAPI('downloadFile', {}, {signal: controller.signal});
    controller.abort(); await assert.rejects(aborted, {code: 'ABORTED'}); assert.equal(aborts, 2);
    const preAborted = bridge.callAPI('downloadFile', {}, {signal: controller.signal});
    await assert.rejects(preAborted, {code: 'ABORTED'}); assert.equal(aborts, 2);
    const direct = bridge.callAPI('downloadFile'); direct.abort(); direct.abort();
    await assert.rejects(direct, {code: 'ABORTED'}); assert.equal(aborts, 3);
    bridge.dispose();
  });

  test(`${platform}: interaction has no short timeout and explicit timeout overrides it`, async () => {
    let nativeOptions;
    const api = {showModal(options) { nativeOptions = options; }};
    const bridge = createPlatformAPI({api, platform, defaultTimeoutMs: 1});
    const modal = bridge.callAPI('showModal');
    await delay(10); nativeOptions.success({confirm: true}); assert.deepEqual(await modal, {confirm: true});
    await assert.rejects(bridge.callAPI('showModal', {}, {timeoutMs: 2}), {code: 'TIMEOUT'});
    bridge.dispose();
  });

  test(`${platform}: user callback throws reject without skipping complete or leaving task live`, async () => {
    let completed = 0, aborts = 0;
    const api = {getStorage(options) { options.success({data: 'value'}); }, request() { return {abort() { aborts++; }}; }};
    const bridge = createPlatformAPI({api, platform});
    await assert.rejects(bridge.callAPI('getStorage', {success() { throw new Error('consumer'); }, complete() { completed++; }}), {code: 'CALLBACK_ERROR'});
    assert.equal(completed, 1);
    await assert.rejects(bridge.callAPI('getStorage', {complete() { throw new Error('complete consumer'); }}), {code: 'CALLBACK_ERROR'});
    await assert.rejects(bridge.callAPI('request', {}, {onTask() { throw new Error('task consumer'); }}), {code: 'CALLBACK_ERROR'});
    assert.equal(aborts, 1); bridge.dispose();
  });

  test(`${platform}: sync positional arguments and object identity are preserved`, () => {
    const nativeObject = {native: true};
    const api = {setStorageSync(...args) { assert.equal(this, api); assert.deepEqual(args, ['key', nativeObject]); return 7; },
      getFileSystemManager(...args) { assert.equal(this, api); assert.equal(args.length, 0); return nativeObject; }, connectSocket(options) { assert.equal(options.url, 'wss://example.test'); return nativeObject; }};
    const bridge = createPlatformAPI({api, platform});
    assert.equal(bridge.getAPISync('setStorageSync', 'key', nativeObject), 7);
    assert.equal(bridge.createAPIObject('getFileSystemManager'), nativeObject);
    assert.equal(bridge.createAPIObject('connectSocket', {url: 'wss://example.test'}), nativeObject);
    assert.throws(() => bridge.createAPIObject('setStorageSync'), {code: 'WRONG_API_KIND'});
    bridge.dispose();
  });

  test(`${platform}: events retain callback return/receiver and unsubscribe/disposal clean even on native failure`, async () => {
    const listeners = new Map(); let removals = 0;
    const api = {};
    for (const suffix of ['Show', 'Hide', 'ShareAppMessage']) {
      api[`on${suffix}`] = function (callback) { assert.equal(this, api); listeners.set(suffix, callback); };
      api[`off${suffix}`] = function (callback) { assert.equal(this, api); assert.equal(listeners.get(suffix), callback); removals++; if (suffix === 'Show') throw new Error('off failed'); listeners.delete(suffix); };
    }
    let options, aborts = 0;
    api.request = value => { options = value; return {abort() { aborts++; }}; };
    const bridge = createPlatformAPI({api, platform});
    const share = {title: 'explicit share title'};
    const unsubscribe = bridge.onAPIEvent('onShareAppMessage', function () { assert.equal(this, api); return share; });
    assert.equal(listeners.get('ShareAppMessage').call(api), share); unsubscribe(); unsubscribe();
    let invoked = 0;
    bridge.onAPIEvent('onShow', () => { invoked++; }); bridge.onAPIEvent('onHide', () => { invoked++; });
    const lateShow = listeners.get('Show'); const pending = bridge.callAPI('request');
    assert.throws(() => bridge.dispose(), AggregateError);
    await assert.rejects(pending, {code: 'DISPOSED'}); assert.equal(aborts, 1);
    options.success({late: true}); lateShow(); assert.equal(invoked, 0);
    assert.equal(removals, 3); assert.equal(listeners.has('Hide'), false);
    bridge.dispose();
  });

  test(`${platform}: registration that adds then throws is rolled back`, () => {
    let saved, removes = 0;
    const api = {onHide(callback) { saved = callback; throw new Error('registration failed'); }, offHide(callback) { assert.equal(callback, saved); removes++; }};
    const bridge = createPlatformAPI({api, platform});
    let invoked = 0;
    assert.throws(() => bridge.onAPIEvent('onHide', () => { invoked++; }), {code: 'PLATFORM_ERROR'});
    saved(); assert.equal(invoked, 0); assert.equal(removes, 1);
    bridge.dispose(); assert.equal(removes, 1);
  });
}

test('sharing exposes WeChat void semantics and Douyin callback semantics without auto-sharing', async () => {
  let calls = 0;
  const wx = createPlatformAPI({platform: 'wechat', api: {shareAppMessage(options) { calls++; assert.equal(options.title, 'explicit'); }}});
  assert.equal(wx.getCapabilities().find(item => item.name === 'shareAppMessage').kind, 'sync');
  await assert.rejects(wx.callAPI('shareAppMessage', {title: 'explicit'}), {code: 'WRONG_API_KIND'});
  assert.equal(calls, 0); assert.equal(wx.getAPISync('shareAppMessage', {title: 'explicit'}), undefined); assert.equal(calls, 1);
  const tt = createPlatformAPI({platform: 'douyin', api: {shareAppMessage(options) { options.success({errMsg: 'shareAppMessage:ok'}); }}});
  assert.equal(tt.getCapabilities().find(item => item.name === 'shareAppMessage').kind, 'async');
  assert.equal((await tt.callAPI('shareAppMessage')).errMsg, 'shareAppMessage:ok');
  wx.dispose(); tt.dispose();
});

test('invalid inputs never invoke native code, and abort cleanup errors cannot leave promises pending', async () => {
  let calls = 0;
  const bridge = createPlatformAPI({platform: 'wechat', api: {request() { calls++; return {abort() { throw new Error('abort failure'); }}; }}});
  await assert.rejects(bridge.callAPI('request', [], {}), {code: 'INVALID_ARGUMENT'});
  await assert.rejects(bridge.callAPI('request', {}, {timeoutMs: -1}), {code: 'INVALID_ARGUMENT'});
  await assert.rejects(bridge.callAPI('request', {success: 'not callable'}), {code: 'INVALID_ARGUMENT'});
  assert.equal(calls, 0);
  const pending = bridge.callAPI('request'); pending.abort();
  await assert.rejects(pending, failure => failure.code === 'ABORTED' && failure.cleanupErrors[0].message === 'abort failure');
  bridge.dispose();
});
