import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { createPlatformBridge } from "../src/runtime/bridge.js";

let properties = [0, ""];
globalThis.C3 = { Plugins: {} };
globalThis.ISDKPluginBase = class {};
globalThis.ISDKObjectTypeBase = class {};
globalThis.ISDKInstanceBase = class {
  constructor() { this.events = []; }
  _getInitProperties() { return properties; }
  _release() { this.released = true; }
  _trigger(condition) {
    const name = Object.entries(globalThis.C3.Plugins.C3MiniGameBridge.Cnds).find(([, fn]) => fn === condition)?.[0];
    assert.ok(name, "every trigger must reference an actual condition");
    this.events.push({
      name, error: this.getLastError(), code: this.getLastErrorCode(), loginCode: this.getLastLoginCode(),
      apiName: this.getLastAPIName(), tag: this.getLastAPITag(), operation: this.getLastOperation(),
      resultJSON: this.getLastResultJSON(), resultIsJSON: this.getLastResultIsJSON(),
      eventJSON: this.getLastEventJSON(), eventIsJSON: this.getLastEventIsJSON()
    });
    this.onTrigger?.(name);
  }
};
await import("../addon/c3runtime/main.js");
const plugin = globalThis.C3.Plugins.C3MiniGameBridge;
const create = () => new plugin.Instance();
const names = instance => instance.events.map(event => event.name);

function installBridge(overrides = {}) {
  globalThis.C3MiniGameBridge = {
    init: async () => ({ platform: "wechat" }),
    getPlatform: () => "wechat",
    login: async () => ({ platform: "wechat", code: "one-time-code" }),
    showRewardedVideo: async () => ({ platform: "wechat", completed: true }),
    reportScore: async () => ({ platform: "wechat", result: { accepted: true } }),
    vibrate: async () => undefined,
    callAPI: async (name, options) => ({ errMsg: `${name}:ok`, options }),
    getAPISync: (name, ...args) => ({ name, args }),
    createAPIObject: () => ({ play() {}, stop() {} }),
    supportsAPI: name => ["showToast", "getStorageSync"].includes(name),
    getCapabilities: () => [{ name: "showToast", kind: "async", supported: true }, { name: "notAvailable", kind: "async", supported: false }],
    ...overrides
  };
}

beforeEach(() => {
  properties = [0, ""];
  delete globalThis.C3MiniGameBridge;
});

test("browser preview reports unsupported without login or ad success", async () => {
  const instance = create();
  await assert.rejects(instance.init(), { code: "UNSUPPORTED" });
  await plugin.Acts.Login.call(instance);
  await plugin.Acts.ShowRewardedVideo.call(instance, "ad-1");
  assert.deepEqual(names(instance), ["OnError", "OnError", "OnError"]);
  assert.equal(instance.isReady(), false);
  assert.equal(instance.getPlatform(), "unsupported");
  assert.equal(instance.getLastLoginCode(), "");
  assert.match(instance.getLastError(), /^\[UNSUPPORTED\]/);
});

test("init passes configured platform and endpoint and requires a supported host", async () => {
  properties = [1, "https://scores.example.test/submit"];
  let received;
  installBridge({ getPlatform: () => "douyin", init: async options => { received = options; } });
  const instance = create();
  await plugin.Acts.Init.call(instance);
  assert.deepEqual(received, { platform: "douyin", scoreEndpoint: "https://scores.example.test/submit" });
  assert.deepEqual(names(instance), ["OnReady"]);
  assert.equal(plugin.Cnds.IsReady.call(instance), true);
  assert.equal(plugin.Exps.Platform.call(instance), "douyin");
  globalThis.C3MiniGameBridge.getPlatform = () => "browser";
  await assert.rejects(instance.init(), { code: "UNSUPPORTED" });
  assert.equal(instance.isReady(), false);
});

test("platform operations wait for successful init", async () => {
  let calls = 0;
  installBridge({ login: async () => { calls++; return { code: "secret" }; } });
  const instance = create();
  await assert.rejects(instance.login(), { code: "NOT_READY" });
  assert.equal(calls, 0);
  assert.equal(instance.getLastOperation(), "login");
});

test("login code is only held in memory and is never added to score payload", async () => {
  let payload;
  installBridge({ reportScore: async options => { payload = options; } });
  const instance = create();
  await instance.init();
  await instance.login();
  assert.equal(instance.getLastLoginCode(), "one-time-code");
  assert.deepEqual(instance._saveToJson(), {});
  await instance.reportScore(123, "weekly");
  assert.deepEqual(payload, { score: 123, leaderboardId: "weekly" });
  assert.deepEqual(names(instance), ["OnReady", "OnLoginSucceeded", "OnScoreReported"]);
  instance._loadFromJson({ code: "must-not-load" });
  assert.equal(instance.getLastLoginCode(), "");
});

test("failed login clears stale code and preserves normalized host error", async () => {
  installBridge();
  const instance = create();
  await instance.init();
  await instance.login();
  globalThis.C3MiniGameBridge.login = async () => { throw { errCode: 1002, errMsg: "User rejected" }; };
  await assert.rejects(instance.login(), { code: "1002", message: "User rejected" });
  assert.equal(instance.getLastLoginCode(), "");
  assert.equal(instance.getLastError(), "[1002] User rejected");
  assert.equal(names(instance).at(-1), "OnError");
});

test("malformed login success is rejected; explicit server session is accepted", async () => {
  installBridge({ login: async () => ({}) });
  const instance = create();
  await instance.init();
  await assert.rejects(instance.login(), { code: "INVALID_RESULT" });
  assert.ok(!names(instance).includes("OnLoginSucceeded"));
  globalThis.C3MiniGameBridge.login = async () => ({ session: { authenticated: true } });
  await instance.login();
  assert.equal(instance.getLastLoginCode(), "");
  assert.equal(names(instance).at(-1), "OnLoginSucceeded");
});

test("rewarded ads distinguish completed, cancelled, missing status and host failure", async () => {
  installBridge();
  const instance = create();
  await instance.init();
  await instance.showRewardedVideo("ad-1");
  assert.equal(names(instance).at(-1), "OnAdCompleted");
  globalThis.C3MiniGameBridge.showRewardedVideo = async () => ({ completed: false });
  await instance.showRewardedVideo("ad-1");
  assert.equal(names(instance).at(-1), "OnAdCancelled");
  globalThis.C3MiniGameBridge.showRewardedVideo = async () => ({});
  await assert.rejects(instance.showRewardedVideo("ad-1"), { code: "INVALID_RESULT" });
  globalThis.C3MiniGameBridge.showRewardedVideo = async () => { throw new Error("No ad available"); };
  await plugin.Acts.ShowRewardedVideo.call(instance, "ad-1");
  assert.equal(names(instance).filter(name => name === "OnAdCompleted").length, 1);
  assert.equal(names(instance).filter(name => name === "OnError").length, 2);
});

test("event-sheet actions map params and emit completion after awaiting host", async () => {
  const seen = [];
  installBridge({
    vibrate: async options => { seen.push(options); },
    showRewardedVideo: async options => { seen.push(options); return { completed: true }; }
  });
  const instance = create();
  await plugin.Acts.Init.call(instance);
  await plugin.Acts.Vibrate.call(instance, 1);
  await plugin.Acts.Vibrate.call(instance, 0);
  await plugin.Acts.ShowRewardedVideo.call(instance, "issued-id");
  assert.deepEqual(seen, [{ type: "long" }, { type: "short" }, { adUnitId: "issued-id" }]);
  assert.deepEqual(names(instance), ["OnReady", "OnVibrationCompleted", "OnVibrationCompleted", "OnAdCompleted"]);
});

test("release prevents late async triggers and secret repopulation", async () => {
  let finish;
  installBridge({ login: () => new Promise(resolve => { finish = resolve; }) });
  const instance = create();
  await instance.init();
  const pending = instance.login();
  instance._release();
  finish({ code: "late-code" });
  await assert.rejects(pending, { code: "DISPOSED" });
  assert.equal(instance.getLastLoginCode(), "");
  assert.equal(instance.isReady(), false);
  assert.deepEqual(names(instance), ["OnReady"]);
});

test("generic calls preserve native results and control options and expose completion tags", async () => {
  let observed;
  const control = { timeoutMs: 20, signal: new AbortController().signal, onTask() {} };
  const nativeResult = { errMsg: "showToast:ok", value: { count: 2 } };
  installBridge({ callAPI: async (...args) => { observed = args; return nativeResult; } });
  const instance = create();
  await assert.rejects(instance.callAPI("showToast"), { code: "NOT_READY" });
  await instance.init();
  assert.equal(await instance.callAPI("showToast", { title: "Hello" }, control), nativeResult);
  assert.equal(observed[2], control);
  await plugin.Acts.CallAPI.call(instance, "showToast", '{"title":"Event sheet"}', "toast-one");
  assert.deepEqual(observed, ["showToast", { title: "Event sheet" }]);
  assert.equal(plugin.Exps.LastAPIName.call(instance), "showToast");
  assert.equal(plugin.Exps.LastAPITag.call(instance), "toast-one");
  assert.deepEqual(JSON.parse(plugin.Exps.LastResultJSON.call(instance)), nativeResult);
  assert.equal(plugin.Exps.LastResultIsJSON.call(instance), 1);
  assert.equal(plugin.Cnds.OnAPISucceeded.call(instance, "toast-one"), true);
  assert.equal(plugin.Cnds.OnAPISucceeded.call(instance, "TOAST-ONE"), false);
});

test("public API promises forward abort and signal cancellation produces one error and no success", async () => {
  for (const mode of ["promise", "signal"]) {
    let nativeCallbacks, aborts = 0;
    const task = { abort() { assert.equal(this, task); aborts++; nativeCallbacks.fail({ errMsg: "request:fail abort" }); } };
    globalThis.C3MiniGameBridge = createPlatformBridge({
      platform: "wechat",
      api: { request(options) { nativeCallbacks = options; return task; } }
    });
    const instance = create(); await instance.init();
    const controller = new AbortController();
    const promise = instance.callAPI("request", { url: "https://example.test/never-requested" }, { signal: controller.signal });
    assert.equal(typeof promise.abort, "function");
    const rejected = assert.rejects(promise, { code: "ABORTED" });
    if (mode === "promise") promise.abort(); else controller.abort();
    promise.abort(); controller.abort();
    nativeCallbacks.success({ errMsg: "request:ok", data: "late" });
    nativeCallbacks.complete({ errMsg: "request:ok" });
    await rejected;
    assert.equal(aborts, 1);
    assert.deepEqual(names(instance), ["OnReady", "OnError"]);
    assert.equal(instance.getLastErrorCode(), "ABORTED");
    assert.equal(instance.getLastAPIName(), "request");
    assert.equal(instance.getLastResultJSON(), "");
    instance._release();
    globalThis.C3MiniGameBridge.dispose();
  }
});

test("concurrent API completion and failures retain their own API name and tag", async () => {
  const pending = new Map();
  installBridge({ callAPI: name => new Promise((resolve, reject) => pending.set(name, { resolve, reject })) });
  const instance = create();
  await instance.init();
  const first = plugin.Acts.CallAPI.call(instance, "first", "{}", "first-tag");
  const second = plugin.Acts.CallAPI.call(instance, "second", "{}", "second-tag");
  pending.get("second").resolve({ order: 2 });
  await second;
  pending.get("first").reject(Object.assign(new Error("denied"), { code: "PLATFORM_ERROR" }));
  await first;
  const events = instance.events.slice(1);
  assert.deepEqual(events.map(e => [e.name, e.apiName, e.tag]), [
    ["OnAPISucceeded", "second", "second-tag"], ["OnError", "first", "first-tag"]
  ]);
  assert.equal(events[1].code, "PLATFORM_ERROR");
  assert.equal(events[1].resultJSON, "");
  assert.equal(events[1].resultIsJSON, false);
});

test("event-sheet JSON errors and incorrect shapes are observable before native calls", async () => {
  let calls = 0;
  installBridge({ callAPI: () => { calls++; }, getAPISync: () => { calls++; } });
  const instance = create();
  await instance.init();
  for (const [action, args, code] of [
    ["CallAPI", ["showToast", "{", "syntax"], "INVALID_JSON"],
    ["CallAPI", ["showToast", "null", "object"], "INVALID_ARGUMENT"],
    ["CallAPI", ["showToast", "[]", "array-options"], "INVALID_ARGUMENT"],
    ["ReadAPISync", ["getStorageSync", "{}", "args"], "INVALID_ARGUMENT"],
    ["ReadAPISync", ["getStorageSync", "[", "syntax-args"], "INVALID_JSON"],
    ["SetStorage", ["save", "undefined", "storage"], "INVALID_JSON"]
  ]) {
    await plugin.Acts[action].call(instance, ...args);
    assert.equal(instance.events.at(-1).name, "OnError");
    assert.equal(instance.events.at(-1).tag, args.at(-1));
    assert.equal(instance.getLastErrorCode(), code);
  }
  assert.equal(calls, 0);
});

test("synchronous APIs expose positional arguments, immediate success and normalized errors", async () => {
  let received;
  installBridge({ getAPISync: (...args) => { received = args; return { score: 10 }; } });
  const instance = create();
  await instance.init();
  const action = plugin.Acts.ReadAPISync.call(instance, "getStorageSync", '["score",3]', "sync");
  assert.deepEqual(received, ["getStorageSync", "score", 3]);
  assert.equal(instance.events.at(-1).name, "OnAPISucceeded", "native synchronous result is observable immediately");
  assert.equal(instance.events.at(-1).tag, "sync");
  await action;
  assert.deepEqual(instance.getAPISync("getStorageSync", "other"), { score: 10 });
  globalThis.C3MiniGameBridge.getAPISync = () => { throw { errCode: "NO_KEY", errMsg: "Key missing" }; };
  await plugin.Acts.ReadAPISync.call(instance, "getStorageSync", '["missing"]', "miss");
  assert.equal(instance.getLastErrorCode(), "NO_KEY");
  assert.equal(instance.getLastAPITag(), "miss");
  assert.throws(() => instance.getAPISync("getStorageSync", "missing"), { code: "NO_KEY" });
});

test("non-JSON results preserve native identity and never publish lossy JSON", async () => {
  let result;
  installBridge({ callAPI: async () => result, getAPISync: () => result, createAPIObject: () => result });
  const instance = create();
  await instance.init();
  const cycle = {}; cycle.self = cycle;
  const accessor = {}; Object.defineProperty(accessor, "value", { enumerable: true, get() { throw new Error("must not read accessor"); } });
  const revoked = Proxy.revocable({}, {}); revoked.revoke();
  for (result of [undefined, new ArrayBuffer(2), new Uint8Array([1, 2]), new Date(), new Map(), 1n, NaN, -0, cycle, accessor, { skipped: undefined }, [, 1]]) {
    assert.equal(await instance.callAPI("native"), result);
    assert.equal(instance.getLastResultJSON(), "");
    assert.equal(instance.getLastResultIsJSON(), false);
    assert.equal(instance.events.at(-1).name, "OnAPISucceeded", "native operation succeeded even when its result is not JSON");
  }
  result = revoked.proxy;
  assert.equal(instance.getAPISync("native"), result, "synchronous native handles need not allow inspection");
  assert.equal(instance.getLastResultIsJSON(), false);
  result = { play() {}, stop() {} };
  assert.equal(instance.createAPIObject("createInnerAudioContext"), result);
  assert.equal(instance.getLastResultIsJSON(), false);
  for (result of [null, true, "", 12, [1, "two"], { ok: true, nested: [null, 3] }]) {
    assert.equal(instance.getAPISync("native"), result);
    assert.equal(instance.getLastResultIsJSON(), true);
    assert.deepEqual(JSON.parse(instance.getLastResultJSON()), result);
  }
});

test("foreign-realm plain native results, event payloads and capabilities retain JSON data", async () => {
  const foreign = vm.runInNewContext(`({
    result: {errMsg: "getDeviceInfo:ok", nested: {brand: "device"}, list: [{count: 2}, null]},
    dictionary: Object.assign(Object.create(null), {value: "dictionary"}),
    capabilities: [{name: "getDeviceInfo", kind: "sync", supported: true}]
  })`);
  assert.notEqual(Object.getPrototypeOf(foreign.result), Object.prototype);
  const host = installEventBridge({ callAPI: async () => foreign.result, getAPISync: () => foreign.dictionary, getCapabilities: () => foreign.capabilities });
  const instance = create(); await instance.init();
  assert.equal(await instance.callAPI("getDeviceInfo"), foreign.result);
  assert.equal(instance.getLastResultIsJSON(), true);
  assert.deepEqual(JSON.parse(instance.getLastResultJSON()), { errMsg: "getDeviceInfo:ok", nested: { brand: "device" }, list: [{ count: 2 }, null] });
  assert.equal(instance.getAPISync("getStorageSync"), foreign.dictionary);
  assert.equal(instance.getLastResultJSON(), '{"value":"dictionary"}');
  assert.deepEqual(JSON.parse(instance.getCapabilitiesJSON()), [{ name: "getDeviceInfo", kind: "sync", supported: true }]);
  instance.onAPIEvent("onNetworkStatusChange", () => {});
  host.emit("onNetworkStatusChange", foreign.result);
  assert.equal(instance.getLastEventIsJSON(), true);
  assert.deepEqual(JSON.parse(instance.getLastEventJSON()), JSON.parse(JSON.stringify(foreign.result)));
});

test("foreign realm class, custom prototype, accessor and binary values still reject JSON serialization", async () => {
  const foreign = vm.runInNewContext(`(() => {
    class Device { constructor() { this.brand = "device"; } }
    const accessor = {};
    Object.defineProperty(accessor, "value", {enumerable: true, get() { throw new Error("getter must not run"); }});
    const custom = Object.create(Object.assign(Object.create(null), {constructor: Object}));
    custom.value = "not a plain prototype";
    return [new Device(), Object.create({inherited: true}), custom, accessor,
      {nested: accessor}, new Uint8Array([1, 2]), new ArrayBuffer(2), new Date(), new Map()];
  })()`);
  let result;
  installBridge({ getAPISync: () => result });
  const instance = create(); await instance.init();
  for (result of foreign) {
    assert.equal(instance.getAPISync("native"), result);
    assert.equal(instance.getLastResultIsJSON(), false);
    assert.equal(instance.getLastResultJSON(), "");
    assert.equal(instance.events.at(-1).name, "OnAPISucceeded");
  }
});

test("JSON snapshots do not execute inherited foreign toJSON hooks", async () => {
  const foreign = vm.runInNewContext(`(() => {
    Object.prototype.toJSON = function () { throw new Error("must not invoke Object toJSON"); };
    Array.prototype.toJSON = function () { throw new Error("must not invoke Array toJSON"); };
    return {value: "actual data", nested: [{x: 1}]};
  })()`);
  installBridge({ getAPISync: () => foreign });
  const instance = create(); await instance.init();
  assert.equal(instance.getAPISync("native"), foreign);
  assert.equal(instance.getLastResultIsJSON(), true);
  assert.deepEqual(JSON.parse(instance.getLastResultJSON()), { value: "actual data", nested: [{ x: 1 }] });
});

function installEventBridge(overrides = {}) {
  const listeners = new Map();
  const removed = [];
  let bridgeDisposed = 0;
  installBridge({
    onAPIEvent(name, callback) {
      const list = listeners.get(name) ?? new Set();
      list.add(callback); listeners.set(name, list);
      return () => { list.delete(callback); removed.push(callback); };
    },
    dispose() { bridgeDisposed++; },
    ...overrides
  });
  return { listeners, removed, emit(name, value) { for (const fn of [...(listeners.get(name) ?? [])]) fn(value); }, get bridgeDisposed() { return bridgeDisposed; } };
}

test("named subscriptions replace only matching name/tag and release only this instance", async () => {
  const host = installEventBridge();
  const first = create(), second = create();
  await first.init(); await second.init();
  await plugin.Acts.SubscribeAPIEvent.call(first, "onKeyboardInput", "one");
  await plugin.Acts.SubscribeAPIEvent.call(first, "onKeyboardInput", "two");
  await plugin.Acts.SubscribeAPIEvent.call(first, "onKeyboardInput", "one");
  await plugin.Acts.SubscribeAPIEvent.call(second, "onKeyboardInput", "other-instance");
  assert.equal(host.listeners.get("onKeyboardInput").size, 3);
  host.emit("onKeyboardInput", { value: "hello" });
  assert.deepEqual(first.events.filter(e => e.name === "OnAPIEvent").map(e => e.tag).sort(), ["one", "two"]);
  assert.equal(second.events.at(-1).tag, "other-instance");
  await plugin.Acts.UnsubscribeAPIEvent.call(first, "onKeyboardInput", "one");
  assert.deepEqual(JSON.parse(first.getLastResultJSON()), { unsubscribed: true });
  await plugin.Acts.UnsubscribeAPIEvent.call(first, "onKeyboardInput", "missing");
  assert.deepEqual(JSON.parse(first.getLastResultJSON()), { unsubscribed: false });
  const stale = [...host.listeners.get("onKeyboardInput")][0];
  const firstCount = first.events.length;
  first._release();
  assert.equal(host.listeners.get("onKeyboardInput").size, 1);
  stale({ value: "late" });
  host.emit("onKeyboardInput", { value: "still active" });
  assert.equal(first.events.length, firstCount);
  assert.equal(second.events.at(-1).eventJSON, '{"value":"still active"}');
  assert.equal(host.bridgeDisposed, 0);
  second._release();
  assert.equal(host.listeners.get("onKeyboardInput").size, 0);
});

test("nested API events and synchronous calls keep outer trigger tags and payloads", async () => {
  const host = installEventBridge();
  const instance = create(); await instance.init();
  await plugin.Acts.SubscribeAPIEvent.call(instance, "onKeyboardInput", "outer");
  await plugin.Acts.SubscribeAPIEvent.call(instance, "onNetworkStatusChange", "inner");
  const observed = [];
  instance.onTrigger = name => {
    if (name !== "OnAPIEvent") return;
    const tag = instance.getLastAPITag();
    assert.equal(plugin.Cnds.OnAPIEvent.call(instance, tag), true);
    assert.equal(plugin.Cnds.OnAPIEvent.call(instance, "not-this-tag"), false);
    if (tag === "outer") {
      observed.push([tag, instance.getLastEventJSON()]);
      host.emit("onNetworkStatusChange", { online: true });
      instance.getAPISync("getStorageSync", "key");
      observed.push([instance.getLastAPITag(), instance.getLastEventJSON()]);
    } else observed.push([tag, instance.getLastEventJSON()]);
  };
  host.emit("onKeyboardInput", { value: "typed" });
  assert.deepEqual(observed, [["outer", '{"value":"typed"}'], ["inner", '{"online":true}'], ["outer", '{"value":"typed"}']]);
});

test("JavaScript event callbacks receive native payloads and unsubscribe idempotently", async () => {
  const host = installEventBridge();
  const instance = create(); await instance.init();
  const received = [];
  const off = instance.onAPIEvent("onKeyboardInput", value => received.push(value));
  const value = new Uint8Array([5]);
  host.emit("onKeyboardInput", value);
  assert.equal(received[0], value);
  assert.equal(instance.getLastEventIsJSON(), false);
  assert.equal(instance.getLastEventJSON(), "");
  off(); off();
  assert.equal(host.removed.length, 1);
  host.emit("onKeyboardInput", { value: "late" });
  assert.equal(received.length, 1);
  instance.onAPIEvent("onKeyboardInput", () => { throw new Error("callback failed"); });
  host.emit("onKeyboardInput", {});
  assert.equal(instance.events.at(-1).name, "OnError");
  assert.equal(instance.getLastErrorCode(), "CALLBACK_ERROR");
  instance._release();
});

test("JavaScript event callbacks preserve native receiver, multiple arguments and return value", async () => {
  const host = installEventBridge();
  const instance = create(); await instance.init();
  const nativeThis = { native: true }, response = { title: "Share this game" };
  let observed;
  instance.onAPIEvent("onShareAppMessage", function (...args) { observed = { receiver: this, args }; return response; });
  const listener = [...host.listeners.get("onShareAppMessage")][0];
  assert.equal(listener.call(nativeThis, { source: "menu" }, "extra"), response);
  assert.equal(observed.receiver, nativeThis);
  assert.deepEqual(observed.args, [{ source: "menu" }, "extra"]);
  assert.deepEqual(JSON.parse(instance.getLastEventJSON()), [{ source: "menu" }, "extra"]);
});

test("subscriptions handle synchronous delivery followed by unsubscribe or release", async () => {
  let removals = 0;
  installBridge({ onAPIEvent(_name, callback) { callback({ initial: true }); return () => { removals++; }; } });
  const instance = create(); await instance.init();
  instance.onTrigger = name => {
    if (name === "OnAPIEvent") instance._unsubscribeAPIEvent("onKeyboardInput", "early");
  };
  await plugin.Acts.SubscribeAPIEvent.call(instance, "onKeyboardInput", "early");
  assert.deepEqual(JSON.parse(instance.getLastResultJSON()), { subscribed: false });
  assert.equal(removals, 1);
  assert.equal(instance._apiSubscriptions.size, 0);
  const released = create(); await released.init();
  released.onTrigger = name => { if (name === "OnAPIEvent") released._release(); };
  let called = false;
  assert.throws(() => released.onAPIEvent("onKeyboardInput", () => { called = true; }), { code: "DISPOSED" });
  assert.equal(called, false);
  assert.equal(removals, 2);
  assert.equal(released.getLastEventJSON(), "");
  assert.deepEqual(names(released), ["OnReady", "OnAPIEvent"]);
});

test("unsupported APIs, unsupported subscriptions and registration failures emit no false success", async () => {
  let stale;
  const unsupported = () => { throw Object.assign(new Error("Not available on this host"), { code: "UNSUPPORTED" }); };
  installBridge({ callAPI: unsupported, getAPISync: unsupported, createAPIObject: unsupported, onAPIEvent: (_name, callback) => { stale = callback; return unsupported(); } });
  const instance = create(); await instance.init();
  await plugin.Acts.CallAPI.call(instance, "notAvailable", "{}", "missing");
  await plugin.Acts.ReadAPISync.call(instance, "notAvailableSync", "[]", "missing-sync");
  await plugin.Acts.SubscribeAPIEvent.call(instance, "onMissing", "missing-event");
  assert.throws(() => instance.createAPIObject("createMissing"), { code: "UNSUPPORTED" });
  assert.equal(names(instance).filter(name => name === "OnError").length, 4);
  assert.equal(names(instance).includes("OnAPISucceeded"), false);
  stale({ shouldNotFire: true });
  assert.equal(names(instance).includes("OnAPIEvent"), false);
});

test("capability inspection is read-only and does not require init or invoke platform APIs", () => {
  const absent = create();
  assert.equal(absent.supportsAPI("showToast"), false);
  assert.equal(absent.getCapabilitiesJSON(), "");
  assert.throws(() => absent.getCapabilities(), { code: "UNSUPPORTED" });
  let calls = 0;
  installBridge({ callAPI: () => { calls++; } });
  const instance = create();
  assert.equal(plugin.Cnds.SupportsAPI.call(instance, "showToast"), true);
  assert.equal(instance.supportsAPI("notAvailable"), false);
  assert.deepEqual(JSON.parse(plugin.Exps.CapabilitiesJSON.call(instance)), instance.getCapabilities());
  assert.equal(calls, 0);
  assert.deepEqual(instance.events, []);
});

test("common event-sheet actions map native names and options without auto-calling unrelated APIs", async () => {
  const calls = [];
  installBridge({ callAPI: async (...args) => { calls.push(args); return { errMsg: `${args[0]}:ok` }; } });
  const instance = create(); await instance.init();
  assert.equal(calls.length, 0);
  const cases = [
    ["ShowToast", ["Toast", 900, "a"], "showToast", { title: "Toast", duration: 900, icon: "none" }],
    ["ShowModal", ["Title", "Body", 1, "b"], "showModal", { title: "Title", content: "Body", showCancel: true }],
    ["SetStorage", ["key", '{"score":12}', "c"], "setStorage", { key: "key", data: { score: 12 } }],
    ["GetStorage", ["key", "d"], "getStorage", { key: "key" }],
    ["RemoveStorage", ["key", "e"], "removeStorage", { key: "key" }],
    ["GetNetworkType", ["f"], "getNetworkType", {}],
    ["SetClipboard", ["copy", "g"], "setClipboardData", { data: "copy" }],
    ["GetClipboard", ["h"], "getClipboardData", {}],
    ["ShowKeyboard", ["text", 50, "i"], "showKeyboard", { defaultValue: "text", maxLength: 50, multiple: false, confirmHold: false, confirmType: "done" }],
    ["HideKeyboard", ["j"], "hideKeyboard", {}]
  ];
  for (const [action, args, apiName, options] of cases) {
    await plugin.Acts[action].call(instance, ...args);
    assert.deepEqual(calls.at(-1), [apiName, options]);
    assert.equal(instance.getLastAPITag(), args.at(-1));
  }
  assert.equal(calls.length, cases.length);
});

test("generic login results and events stay out of savegames and are cleared on load/release", async () => {
  const host = installEventBridge({ callAPI: async () => ({ code: "private-code" }) });
  const instance = create(); await instance.init();
  await instance.callAPI("login");
  instance.onAPIEvent("onSensitiveEvent", () => {});
  host.emit("onSensitiveEvent", { token: "private-token" });
  assert.deepEqual(instance._saveToJson(), {});
  instance._loadFromJson({ lastResultJSON: '{"code":"must-not-load"}' });
  assert.equal(instance.getLastResultJSON(), "");
  assert.equal(instance.getLastEventJSON(), "");
  assert.equal(host.listeners.get("onSensitiveEvent").size, 0);
  await instance.callAPI("login");
  instance._release();
  assert.equal(instance.getLastResultJSON(), "");
  assert.equal(instance.getLastEventJSON(), "");
  assert.deepEqual(instance._saveToJson(), {});
});

test("release suppresses delayed generic API completion and blocks new synchronous calls", async () => {
  let finish;
  installBridge({ callAPI: () => new Promise(resolve => { finish = resolve; }) });
  const instance = create(); await instance.init();
  const operation = instance.callAPI("login");
  const count = instance.events.length;
  instance._release();
  finish({ code: "late-private-code" });
  await assert.rejects(operation, { code: "DISPOSED" });
  assert.throws(() => instance.getAPISync("getStorageSync", "key"), { code: "DISPOSED" });
  assert.equal(instance.getLastResultJSON(), "");
  assert.equal(instance.events.length, count);
});
