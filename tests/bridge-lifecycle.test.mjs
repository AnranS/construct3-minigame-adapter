import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlatformBridge} from '../src/runtime/bridge.js';

const tick = () => new Promise(resolve => setImmediate(resolve));

function adFixture(overrides = {}) {
  const callbacks = {};
  const calls = [];
  const ad = {
    onClose(callback) { callbacks.close = callback; calls.push('onClose'); },
    offClose(callback) { assert.equal(callback, callbacks.close); calls.push('offClose'); },
    onError(callback) { callbacks.error = callback; calls.push('onError'); },
    offError(callback) { assert.equal(callback, callbacks.error); calls.push('offError'); },
    async show() { calls.push('show'); },
    destroy() { calls.push('destroy'); }, ...overrides
  };
  return {ad, callbacks, calls};
}

for (const platform of ['wechat', 'douyin']) {
  test(`${platform}: business bridge exposes native API methods and pending login is rejected on disposal`, async () => {
    let loginOptions, requestOptions, aborts = 0;
    const api = {
      login(options) { loginOptions = options; },
      request(options) { requestOptions = options; return {abort() { aborts++; }}; },
      getSystemInfoSync() { return {platform: 'test'}; }
    };
    const bridge = createPlatformBridge({platform, api});
    await bridge.init({platform: 'auto', apiTimeoutMs: 1000});
    assert.equal(bridge.supportsAPI('login'), true);
    assert.equal(bridge.getCapabilities().find(item => item.name === 'getSystemInfoSync').supported, true);
    assert.deepEqual(bridge.getAPISync('getSystemInfoSync'), {platform: 'test'});
    const login = bridge.login(); const native = bridge.callAPI('request');
    bridge.dispose(); bridge.dispose();
    await assert.rejects(login, {code: 'DISPOSED'}); await assert.rejects(native, {code: 'DISPOSED'});
    loginOptions.success({code: 'late-secret'}); requestOptions.success({}); assert.equal(aborts, 1);
    assert.equal(bridge.supportsAPI('login'), false);
  });

  test(`${platform}: partial ad listener registration failure destroys native object and frees next request`, async () => {
    const fixture = adFixture();
    fixture.ad.onError = callback => { fixture.callbacks.error = callback; fixture.calls.push('onError'); throw new Error('register failure'); };
    let first = true;
    const next = adFixture();
    const bridge = createPlatformBridge({platform, api: {createRewardedVideoAd() { if (first) { first = false; return fixture.ad; } return next.ad; }}});
    await assert.rejects(bridge.showRewardedVideo({adUnitId: 'test'}), /register failure/);
    assert.deepEqual(fixture.calls, ['onClose', 'onError', 'offClose', 'offError', 'destroy']);
    fixture.callbacks.close({isEnded: true}); fixture.callbacks.error({errMsg: 'late error'});
    const pending = bridge.showRewardedVideo({adUnitId: 'test'}); next.callbacks.close({isEnded: true});
    assert.deepEqual(await pending, {completed: true, platform}); bridge.dispose();
  });

  test(`${platform}: malformed native ad is destroyed before rejection`, async () => {
    let destroys = 0;
    const bridge = createPlatformBridge({platform, api: {createRewardedVideoAd() { return {destroy() { destroys++; }}; }}});
    await assert.rejects(bridge.showRewardedVideo({adUnitId: 'test'}), /onClose/);
    assert.equal(destroys, 1);
    await assert.rejects(bridge.showRewardedVideo({adUnitId: 'test'}), /onClose/);
    assert.equal(destroys, 2); bridge.dispose();
  });

  test(`${platform}: cleanup failures still attempt every release and settle once without hanging`, async () => {
    const fixture = adFixture();
    for (const method of ['offClose', 'offError', 'destroy']) fixture.ad[method] = () => { fixture.calls.push(method); throw new Error(`${method} failure`); };
    const bridge = createPlatformBridge({platform, api: {createRewardedVideoAd() { return fixture.ad; }}});
    const pending = bridge.showRewardedVideo({adUnitId: 'test'});
    fixture.callbacks.close({isEnded: true}); fixture.callbacks.close({isEnded: false}); fixture.callbacks.error({errMsg: 'duplicate'});
    await assert.rejects(pending, failure => failure.code === 'CLEANUP_ERROR' && failure.cleanupErrors.length === 3);
    assert.equal(fixture.calls.filter(name => name === 'destroy').length, 1);
    const again = bridge.showRewardedVideo({adUnitId: 'test'}); fixture.callbacks.close({isEnded: false});
    await assert.rejects(again, {code: 'CLEANUP_ERROR'}); bridge.dispose();
  });

  test(`${platform}: duplicate callbacks cannot award twice; undefined close is not completed`, async () => {
    const fixture = adFixture();
    const bridge = createPlatformBridge({platform, api: {createRewardedVideoAd() { return fixture.ad; }}});
    const pending = bridge.showRewardedVideo({adUnitId: 'test'});
    await assert.rejects(bridge.showRewardedVideo({adUnitId: 'other'}), /already in progress/);
    fixture.callbacks.close(); fixture.callbacks.close({isEnded: true}); fixture.callbacks.error({errMsg: 'late'});
    assert.deepEqual(await pending, {completed: false, platform});
    assert.equal(fixture.calls.filter(name => name === 'destroy').length, 1); bridge.dispose();
  });

  test(`${platform}: frozen native ad errors and cleanup errors are both retained`, async () => {
    const fixture = adFixture({destroy() { throw new Error('destroy failure'); }});
    const bridge = createPlatformBridge({platform, api: {createRewardedVideoAd() { return fixture.ad; }}});
    const pending = bridge.showRewardedVideo({adUnitId: 'test'});
    const nativeFailure = Object.freeze(new Error('native inventory failure'));
    fixture.callbacks.error(nativeFailure);
    await assert.rejects(pending, failure => failure.code === 'PLATFORM_ERROR' && failure.cause === nativeFailure && failure.cleanupErrors[0].message === 'destroy failure');
    bridge.dispose();
  });

  test(`${platform}: disposed ad does not retry show after an in-flight load completes`, async () => {
    let finishLoad;
    const fixture = adFixture();
    fixture.ad.show = async () => { fixture.calls.push('show'); throw new Error('not loaded'); };
    fixture.ad.load = () => { fixture.calls.push('load'); return new Promise(resolve => { finishLoad = resolve; }); };
    const bridge = createPlatformBridge({platform, api: {createRewardedVideoAd() { return fixture.ad; }}});
    const pending = bridge.showRewardedVideo({adUnitId: 'test'});
    await tick(); assert.equal(typeof finishLoad, 'function');
    bridge.dispose(); await assert.rejects(pending, {code: 'DISPOSED'});
    finishLoad(); await tick();
    assert.equal(fixture.calls.filter(name => name === 'show').length, 1);
    assert.equal(fixture.calls.filter(name => name === 'destroy').length, 1);
  });

  test(`${platform}: native show rejection retries load once, successful show waits for actual close`, async () => {
    const fixture = adFixture(); let shows = 0, loads = 0;
    fixture.ad.show = async () => { if (++shows === 1) throw new Error('not loaded'); };
    fixture.ad.load = async () => { loads++; };
    const bridge = createPlatformBridge({platform, api: {createRewardedVideoAd() { return fixture.ad; }}});
    const pending = bridge.showRewardedVideo({adUnitId: 'test'}); let done = false;
    pending.then(() => { done = true; }); await tick();
    assert.equal(shows, 2); assert.equal(loads, 1); assert.equal(done, false);
    fixture.callbacks.close({isEnded: true}); assert.equal((await pending).completed, true); bridge.dispose();
  });

  test(`${platform}: explicit rewarded-ad timeout and abort dispose native resources`, async () => {
    const fixtures = [];
    const bridge = createPlatformBridge({platform, api: {createRewardedVideoAd() { const f = adFixture(); fixtures.push(f); return f.ad; }}});
    await assert.rejects(bridge.showRewardedVideo({adUnitId: 'test'}, {timeoutMs: 2}), {code: 'TIMEOUT'});
    const controller = new AbortController();
    const pending = bridge.showRewardedVideo({adUnitId: 'test'}, {signal: controller.signal}); controller.abort();
    await assert.rejects(pending, {code: 'ABORTED'});
    assert.equal(fixtures.length, 2); for (const fixture of fixtures) assert.equal(fixture.calls.filter(name => name === 'destroy').length, 1);
    bridge.dispose();
  });
}
