# MiniGameBridge addon 0.2.0

This experimental Construct SDK v2 addon exposes registered WeChat and Douyin APIs through the companion runtime adapter. Install it, export the project as HTML5, then run the converter. Installing the addon does not add a native mini-game exporter to Construct's export menu.

The single-global object is `MiniGameBridge`; its permanent addon ID is `C3MiniGameBridge`. The manifest version is `0.2.0.0` (Construct's four-part format). It declares `supports-worker-mode: false`, shares the adapter's main-thread scope, and does not inject the adapter as a DOM script. API availability depends on the selected platform, SDK version and permissions. The addon does not call clipboard, login, location or other business APIs during installation or initialization.

## Event-sheet setup

1. Install `dist/C3MiniGameBridge.c3addon`, then add a MiniGameBridge object.
2. Choose Auto-detect, Douyin, or WeChat in its Platform property. Optionally configure your HTTPS Score endpoint.
3. Call **Init**, and wait for **On ready** before operations or subscriptions.
4. Handle **On error** using `LastErrorCode`, `LastError`, and `LastOperation`. Generic operations also provide `LastAPIName` and `LastAPITag`.

Ordinary browser preview returns `UNSUPPORTED` when the companion bridge is absent. Calling an operation before successful initialization returns `NOT_READY`. Missing host APIs return `UNSUPPORTED`; using the wrong API kind returns `WRONG_API_KIND`. Nothing simulates login, advertising or storage success.

All event-sheet actions are marked asynchronous so they support Construct's “Wait for previous actions to complete”. **Read synchronous API** still invokes and observes the native synchronous function immediately. Event-sheet failures fire **On error** without leaving an unhandled Promise rejection.

## Generic API actions

| Action | Parameters | Result |
| --- | --- | --- |
| Call API | Exact API name, options JSON object, tag | Calls a registered callback API; **On API succeeded(tag)** after native success |
| Read synchronous API | Exact API name, positional arguments JSON array, tag | Calls a registered synchronous API; **On API succeeded(tag)** immediately |
| Subscribe to API event | Exact `on...` event name, tag | Registers an event; success result is `{"subscribed":true}` unless it was removed during immediate delivery |
| Unsubscribe from API event | Same event name and tag | Removes this instance's matching subscription; success result is `{"unsubscribed":true}` or `false` when none existed |

For example, after **On ready**, call API `getNetworkType` with `{}` and tag `network`. Under **On API succeeded("network")**, read `LastResultJSON`. For a synchronous read, use `getStorageSync`, arguments `["my-key"]`, and tag `save-read`.

To observe keyboard input, subscribe to `onKeyboardInput` with tag `keyboard`. **On API event("keyboard")** provides `LastEventJSON`. Registration requires both the native `on` and `off` APIs. Repeating the same event name and tag replaces only that subscription; another tag is independent. Tags are case-sensitive and are never forwarded in native options. Each trigger retains its own name, tag and payload during nested events or synchronous calls.

Invalid JSON reports `INVALID_JSON` before invoking the API. Options must be an object and synchronous arguments must be an array; incorrect shapes report `INVALID_ARGUMENT`. API names must belong to the adapter's catalog. Use **Supports API(name)** and `CapabilitiesJSON` to inspect availability without invoking the API.

### Result expressions

| Expression | Meaning |
| --- | --- |
| `LastAPIName`, `LastAPITag` | API/event name and tag for the current trigger, otherwise the latest generic result or error |
| `LastResultJSON`, `LastResultIsJSON`, `LastResultType` | API result JSON, a 1/0 validity marker, and its JavaScript type (`null` and `array` are distinguished) |
| `LastEventJSON`, `LastEventIsJSON`, `LastEventType` | Equivalent values for native event data |
| `CapabilitiesJSON` | Array of descriptors including `name`, `kind`, and `supported`; empty string when the bridge is unavailable |
| `LastErrorCode`, `LastError`, `LastOperation` | Machine-readable failure code, message and plugin operation |

A successful native call can return `undefined`, bytes or an object that cannot be represented faithfully as JSON. In that case **On API succeeded** still indicates the native operation completed, but `LastResultIsJSON` is 0 and `LastResultJSON` is empty. The addon never substitutes `{}` or `null` for such a value. Use the JavaScript methods to receive the original result. The same rule applies to events; multiple native callback arguments appear as an array in the event expressions. Accessors, cyclic values, typed arrays, Date, native handles and other non-JSON values are not silently flattened.

`LastResultJSON` describes API results; `LastEventJSON` describes event payloads. They are separate histories. Read the one corresponding to the trigger being handled. General results, events, tags and login codes remain in memory and are excluded from Construct savegames; loading a save clears them and removes this instance's subscriptions.

## Common actions

These actions construct native options and use the same tagged success/error conditions:

| Action | Native API / behavior |
| --- | --- |
| Show toast | `showToast`, title and duration, no icon |
| Show modal | `showModal`, title/content/cancel button; inspect `confirm` / `cancel` in the result |
| Write / Read / Remove storage | `setStorage` / `getStorage` / `removeStorage`; write accepts any JSON value |
| Get network type | `getNetworkType` |
| Write / Read clipboard | `setClipboardData` / `getClipboardData` |
| Show / Hide keyboard | `showKeyboard` / `hideKeyboard`; show uses single-line input and a Done confirmation |

Storage actions use native keys without adding a prefix; choose project-specific keys. Missing-key behavior follows the platform and may be an error. Keyboard result text arrives through separately subscribed input/confirm/complete events. Use the generic actions for additional native options and registered APIs.

Platform UI appearing does not prove its entire callback path is error-free. The repository's validation record documents the currently reproducible WeChat IDE Modal worker error; this addon does not suppress it.

The original **Login**, **Show rewarded video**, **Report score**, and **Vibrate** actions remain available with their original conditions. Only **On ad completed** should grant a reward; cancellation and missing completion status do not. **On login succeeded** is a temporary code or configured session, not independently verified server identity. The plugin does not upload login codes or add them to score requests. `LastLoginCode` is held only in memory and is cleared on failed/repeated login and release. Generic `callAPI("login")` returns the raw native result through the generic result interface; it does not update `LastLoginCode`.

## JavaScript interface

Get the instance using your project's object name:

```js
const bridge = runtime.objects.MiniGameBridge.getFirstInstance();
await bridge.init();

try {
  const result = await bridge.callAPI("getNetworkType", {});
  const stored = bridge.getAPISync("getStorageSync", "my-key");
  const capabilities = bridge.getCapabilities();
  const canShowToast = bridge.supportsAPI("showToast");
} catch (error) {
  console.error(error.code, error.message);
}
```

The generic methods are:

```ts
callAPI(name: string, options?: object, control?: {
  timeoutMs?: number;
  signal?: AbortSignal;
  onTask?: (nativeTask: unknown) => void;
}): Promise<unknown> & { abort(): void };
getAPISync(name: string, ...args: unknown[]): unknown;
createAPIObject(name: string, options?: object): unknown;
onAPIEvent(name: string, callback: (...args: unknown[]) => unknown): () => void;
supportsAPI(name: string): boolean;
getCapabilities(): Array<{ name: string; kind: "async" | "sync" | "object" | "event"; supported: boolean; [key: string]: unknown }>;
```

`callAPI` forwards control options to the adapter. Cancel with the returned Promise's `.abort()` or with `AbortController.signal`; both use the same adapter cancellation path and report `ABORTED` once through **On error** and Promise rejection. Repeated cancellation and late native callbacks do not fire success. A native task's `abort()` is used when available; cancellation cannot necessarily dismiss native UI or stop operations that provide no abort capability. `onTask` exposes a native request/task handle when the API returns one; a task handle is not a success result. A timeout or permission failure rejects with the adapter's error code. Interactive APIs can use different timeout policies from ordinary requests.

`callAPI`, `getAPISync`, and `createAPIObject` also fire **On API succeeded** with an empty tag on success, or **On error** on failure. JavaScript failures reject/throw in addition to firing the condition. `onAPIEvent` fires **On API event** with an empty tag and passes all original arguments to the callback, preserving native `this` and the callback's return value. A thrown callback error is reported through **On error** as `CALLBACK_ERROR`.

Use JavaScript for native object factories and event handlers that must return a value, such as a supported `onShareAppMessage` handler:

```js
const audio = bridge.createAPIObject("createInnerAudioContext", {});
audio.src = "game/beep.wav";
// Call play in the appropriate game/user interaction.

const stopKeyboardEvents = bridge.onAPIEvent("onKeyboardInput", data => {
  // Use native event data directly, including non-JSON values.
});

// Later, when your feature is closed:
stopKeyboardEvents();
audio.destroy();
```

The caller owns returned native objects and their object-specific listeners; close/destroy them when finished. The addon cleans up only subscriptions created by its own `onAPIEvent` or event-sheet subscribe action. It never disposes the shared global bridge. Unsubscribe is idempotent, and released instances ignore late callbacks and do not fire completion events. Callbacks during native registration are also handled safely if the instance is released or unsubscribed immediately.

Capability probes may be used before Init. `supportsAPI` returns false when unavailable. JavaScript `getCapabilities` throws `UNSUPPORTED` when no compatible bridge exists; the `CapabilitiesJSON` expression returns an empty string without triggering an event. Capability inspection grants no permission and performs no business API call. A listed sync API returning undefined means only that the call was made; for example, WeChat's `shareAppMessage` return value is not proof of a successful share. API kinds may differ between platforms.

The original JavaScript methods remain:

```js
await bridge.login();
await bridge.showRewardedVideo("issued-ad-unit-id");
await bridge.reportScore(100, "weekly");
await bridge.vibrate("short");
```

Read-only state methods include `isReady()`, `getPlatform()`, `getLastError()`, `getLastErrorCode()`, `getLastOperation()`, `getLastLoginCode()`, and getters corresponding to the generic result/event expressions.

## Adapter contract and provenance

The converter installs `globalThis.C3MiniGameBridge` with the six generic API methods above, plus:

```ts
init(options: { platform: "auto" | "douyin" | "wechat"; scoreEndpoint: string }): Promise<unknown>;
login(): Promise<{ platform: string; code?: string; session?: unknown }>;
showRewardedVideo(options: { adUnitId: string }): Promise<{ platform: string; completed: boolean }>;
reportScore(options: { score: number; leaderboardId: string }): Promise<unknown>;
vibrate(options: { type: "short" | "long" }): Promise<unknown>;
getPlatform(): string;
```

The addon is based on the official `plugin-sdk/singleGlobalPlugin` example from [Scirra/Construct-Addon-SDK](https://github.com/Scirra/Construct-Addon-SDK), commit `a34e41a246fdbb03ac719597d528d7a5e5de0b02`. The three unmodified schemas in `schemas/` are from that source and are used only for development validation. The packaging script excludes them and removes `$schema` references. Metadata help links point to the general Construct SDK documentation; this bundled README is the addon-specific guide.
