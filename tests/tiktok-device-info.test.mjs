import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlatformBridge} from '../src/runtime/bridge.js';
import {TIKTOK_API_CATALOG} from '../src/runtime/tiktok-api.js';

const deviceCapability = bridge => bridge.getCapabilities().find(entry => entry.name === 'getDeviceInfo');

test('TikTok device info discovery prefers its native method without invoking either candidate', () => {
  let calls = 0;
  const argument = {nativeOption: true};
  const nativeResult = Object.freeze({platform: 'ios', model: 'host-provided', additionalField: {native: true}});
  const api = {
    getDeviceInfo(...args) { assert.equal(this, api); assert.deepEqual(args, [argument, 7, null]); calls++; return nativeResult; },
    getSystemInfoSync() { assert.fail('a callable native device method takes priority'); }
  };
  const bridge = createPlatformBridge({platform: 'tiktok', api});
  assert.equal(bridge.supportsAPI('getDeviceInfo'), true);
  const capability = deviceCapability(bridge);
  assert.equal(capability.supported, true); assert.equal(capability.kind, 'sync');
  assert.equal(capability.platform, 'tiktok'); assert.equal(calls, 0);
  assert.equal(capability.nativeMethod, 'getDeviceInfo'); assert.equal(capability.compatibilityFallback, false);
  assert.equal(bridge.getAPISync('getDeviceInfo', argument, 7, null), nativeResult, 'preserve the native object, including unknown fields');
  assert.equal(calls, 1);
  bridge.dispose();
  assert.equal(bridge.supportsAPI('getDeviceInfo'), false);
  const disposed = deviceCapability(bridge);
  assert.equal(disposed.reason, 'DISPOSED');
  assert.equal(disposed.nativeMethod, null); assert.equal(disposed.compatibilityFallback, false);
  assert.throws(() => bridge.getAPISync('getDeviceInfo'), {code: 'DISPOSED'});
  assert.equal(calls, 1);
});

test('TikTok explicitly maps absent or non-callable device info to the same platform system method', () => {
  const argument = {hostOption: true};
  for (const unavailable of [undefined, null, {notCallable: true}, 17, 'method-name']) {
    let calls = 0;
    const realSystemData = Object.freeze({windowWidth: 390, hostOnly: Object.freeze({verified: true})});
    const api = {
      getDeviceInfo: unavailable,
      getSystemInfoSync(...args) {
        assert.equal(this, api); assert.deepEqual(args, [argument, 'extra']);
        calls++; return realSystemData;
      }
    };
    const bridge = createPlatformBridge({platform: 'tiktok', api});
    assert.equal(bridge.supportsAPI('getDeviceInfo'), true);
    const capability = deviceCapability(bridge);
    assert.equal(capability.supported, true); assert.equal(capability.kind, 'sync');
    assert.equal(capability.nativeMethod, 'getSystemInfoSync'); assert.equal(capability.compatibilityFallback, true);
    assert.equal(calls, 0, 'discovery must not call the fallback');
    assert.equal(bridge.getAPISync('getDeviceInfo', argument, 'extra'), realSystemData);
    assert.equal(calls, 1);
    assert.deepEqual(Object.keys(realSystemData), ['windowWidth', 'hostOnly'], 'no device fields are invented');
    bridge.dispose();
    const disposed = deviceCapability(bridge);
    assert.equal(disposed.supported, false); assert.equal(disposed.reason, 'DISPOSED');
    assert.equal(disposed.nativeMethod, null); assert.equal(disposed.compatibilityFallback, false);
    assert.throws(() => bridge.getAPISync('getDeviceInfo'), {code: 'DISPOSED'});
    assert.equal(calls, 1);
  }
});

test('TikTok device info remains unsupported when both candidate methods are unavailable', () => {
  const api = {};
  const bridge = createPlatformBridge({platform: 'tiktok', api});
  for (const value of [undefined, null, {notCallable: true}]) {
    api.getDeviceInfo = value; api.getSystemInfoSync = value;
    assert.equal(bridge.supportsAPI('getDeviceInfo'), false);
    const capability = deviceCapability(bridge);
    assert.equal(capability.supported, false); assert.equal(capability.reason, 'UNSUPPORTED');
    assert.equal(capability.nativeMethod, null); assert.equal(capability.compatibilityFallback, false);
    assert.throws(() => bridge.getAPISync('getDeviceInfo'), {code: 'UNSUPPORTED', platform: 'tiktok', operation: 'getDeviceInfo'});
  }
  bridge.dispose();
});

test('TikTok native getDeviceInfo failures preserve their cause and never trigger fallback', async () => {
  const argument = {nativeOption: true}, failure = new Error('native device query failed');
  let calls = 0;
  const api = {
    getDeviceInfo(...args) { assert.equal(this, api); assert.deepEqual(args, [argument]); calls++; throw failure; },
    getSystemInfoSync() { assert.fail('a thrown native query must not switch methods'); }
  };
  const bridge = createPlatformBridge({platform: 'tiktok', api});
  assert.throws(() => bridge.getAPISync('getDeviceInfo', argument), error => error.code === 'PLATFORM_ERROR' && error.operation === 'getDeviceInfo' && error.platform === 'tiktok' && error.cause === failure);
  assert.equal(calls, 1);
  await assert.rejects(bridge.callAPI('getDeviceInfo'), {code: 'WRONG_API_KIND'});
  assert.equal(calls, 1, 'incorrect asynchronous invocation does not reach the native function');
  bridge.dispose();
});

test('TikTok mapped system-info failures keep the public operation and exact native cause', async () => {
  const argument = {nativeOption: 'fallback'};
  for (const failure of [new Error('system info failed'), {errCode: 913, errMsg: 'host refused query'}]) {
    let calls = 0;
    const api = {getSystemInfoSync(...args) {
      assert.equal(this, api); assert.deepEqual(args, [argument]); calls++; throw failure;
    }};
    const bridge = createPlatformBridge({platform: 'tiktok', api});
    assert.throws(() => bridge.getAPISync('getDeviceInfo', argument), error => error.code === 'PLATFORM_ERROR' && error.operation === 'getDeviceInfo' && error.platform === 'tiktok' && error.cause === failure);
    assert.equal(calls, 1);
    await assert.rejects(bridge.callAPI('getDeviceInfo'), {code: 'WRONG_API_KIND'});
    assert.equal(calls, 1);
    bridge.dispose();
  }
});

test('TikTok capability metadata follows native method availability without a cached or invoked fallback', () => {
  const system = Object.freeze({system: true}), device = Object.freeze({device: true});
  let systemCalls = 0, deviceCalls = 0;
  const api = {getSystemInfoSync() { systemCalls++; return system; }};
  const bridge = createPlatformBridge({platform: 'tiktok', api});
  assert.equal(deviceCapability(bridge).nativeMethod, 'getSystemInfoSync');
  api.getDeviceInfo = () => { deviceCalls++; return device; };
  assert.equal(deviceCapability(bridge).nativeMethod, 'getDeviceInfo');
  assert.equal(bridge.getAPISync('getDeviceInfo'), device);
  delete api.getDeviceInfo;
  assert.equal(deviceCapability(bridge).nativeMethod, 'getSystemInfoSync');
  assert.equal(bridge.getAPISync('getDeviceInfo'), system);
  assert.deepEqual([systemCalls, deviceCalls], [1, 1]);
  bridge.dispose();
});

test('TikTok device-info mapping is explicit in the catalog and does not permit arbitrary host APIs', () => {
  const entry = TIKTOK_API_CATALOG.find(item => item.name === 'getDeviceInfo');
  assert.equal(entry.documentation, 'native-or-system-info-mapping');
  assert.equal(entry.syncFallback, 'getSystemInfoSync');
  assert.equal(entry.kind, 'sync'); assert.deepEqual(entry.platforms, ['tiktok']);
  const native = {getDeviceInfo() { return {native: true}; }, undocumentedDeviceSecret() { assert.fail('arbitrary methods remain blocked'); }};
  const tiktok = createPlatformBridge({platform: 'tiktok', api: native});
  assert.equal(tiktok.supportsAPI('undocumentedDeviceSecret'), false);
  assert.throws(() => tiktok.getAPISync('undocumentedDeviceSecret'), {code: 'UNSUPPORTED'});
  tiktok.dispose();
});

for (const platform of ['wechat', 'douyin']) {
  test(`${platform} does not inherit TikTok's system-info compatibility mapping`, () => {
    const api = {getSystemInfoSync() { assert.fail('TikTok compatibility mapping must not cross platform boundaries'); }};
    const bridge = createPlatformBridge({platform, api});
    assert.equal(bridge.supportsAPI('getDeviceInfo'), false);
    const capability = deviceCapability(bridge);
    assert.equal(capability.supported, false); assert.equal(capability.reason, 'UNSUPPORTED');
    assert.notEqual(capability.nativeMethod, 'getSystemInfoSync');
    assert.notEqual(capability.compatibilityFallback, true);
    assert.throws(() => bridge.getAPISync('getDeviceInfo'), {code: 'UNSUPPORTED', platform});
    let deviceCalls = 0;
    const result = {native: platform};
    api.getDeviceInfo = function () { assert.equal(this, api); deviceCalls++; return result; };
    if (platform === 'wechat') {
      assert.equal(bridge.supportsAPI('getDeviceInfo'), true);
      assert.equal(bridge.getAPISync('getDeviceInfo'), result);
      assert.equal(deviceCalls, 1);
    } else {
      assert.equal(bridge.supportsAPI('getDeviceInfo'), false);
      assert.throws(() => bridge.getAPISync('getDeviceInfo'), {code: 'UNSUPPORTED'});
      assert.equal(deviceCalls, 0);
    }
    bridge.dispose();
  });
}
