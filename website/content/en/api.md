# API reference

The adapter registers **{{API_COUNT}} unique API names across {{CATEGORY_COUNT}} capability categories**: {{WECHAT_COUNT}} names for WeChat, {{DOUYIN_COUNT}} for Douyin, and {{TIKTOK_COUNT}} for TikTok. The directory below is generated directly from the runtime source. APIs with the same name share a row while retaining their invocation kinds and platform differences.

**Directory coverage does not mean an API is available in the target environment, or that every API has passed real-world testing.** Base-library versions, execution contexts, user authorization, and project configuration all affect calls. Check the current host with `supportsAPI()` or `getCapabilities()` first, then handle the actual result. Capability checks only inspect the directory and the presence of native methods or explicitly registered fallbacks. They do not log in, request permissions, open sharing, or send network requests. Payment entries are registered separately for each platform; a client callback cannot replace server-side order confirmation.

## Six general-purpose interfaces

| Interface | Directory kind | Result |
| --- | --- | --- |
| `callAPI(name, options, control)` | `async` | A Promise settled by the native success or failure callback, returning the native success result |
| `getAPISync(name, ...args)` | `sync` | Returns the original value synchronously and preserves native positional arguments; synchronous does not mean read-only |
| `createAPIObject(name, options)` | `object` | Returns the native object itself without serializing its handle to JSON |
| `onAPIEvent(name, callback)` | `event` | Returns an unsubscribe function that is safe to call repeatedly |
| `supportsAPI(name)` | All | Whether the current host provides the methods required by this directory entry |
| `getCapabilities()` | All | Capability records containing `name`, `kind`, `category`, `platform`, and `supported`, plus `reason` when unavailable; entries with a compatibility mapping also contain `nativeMethod` and `compatibilityFallback` |

These interfaces accept only exact names from the directory. If neither the native method nor an explicitly registered fallback is available, they report `UNSUPPORTED`. Using the wrong invocation kind reports `WRONG_API_KIND`. For example, `connectSocket` is an object entry: use `createAPIObject()`, then wait for the actual `onOpen` event.

On TikTok, `getDeviceInfo` first calls the native method with the same name synchronously. Only when that method is missing or is not a function does it map to the official `getSystemInfoSync`, returning the actual result unchanged without inventing fields. `getCapabilities()` exposes the selected `nativeMethod` and whether `compatibilityFallback` is used; querying capabilities does not invoke either native method. If native `getDeviceInfo` throws, that failure is preserved without switching to the fallback. This mapping does not affect WeChat or Douyin.

In a Construct script, obtain the plugin instance and initialize it first:

```js
const bridge = runtime.objects.MiniGameBridge.getFirstInstance();
await bridge.init();

if (bridge.supportsAPI('getNetworkType')) {
  const result = await bridge.callAPI('getNetworkType');
  const networkType = result.networkType;
}
```

Event sheets can use Call API, Read synchronous API, and Subscribe / Unsubscribe to API event. Common features also have dedicated actions. Run Init first and make calls after On ready. Native objects, binary data, and event callbacks that must return an object are best handled in JavaScript.

## Completion, timeouts, and cancellation

`control` supports `timeoutMs`, `signal`, and `onTask`. Ordinary asynchronous APIs have a default timeout of 30 seconds. Interactive APIs such as dialogs, authorization, keyboards, and image selection have no timeout by default. `timeoutMs: 0` means no timeout; an explicit positive number overrides the default.

```js
const pending = bridge.callAPI(
  'getStorage',
  { key: 'my-game/save' },
  { timeoutMs: 5000 }
);

try {
  const result = await pending;
  // Use result.data according to the native protocol.
} catch (error) {
  // Use error.code to distinguish TIMEOUT, ABORTED, PLATFORM_ERROR, etc.
}
```

Both the direct runtime and the plugin instance preserve `.abort()` on the Promise returned by `callAPI()`. You can also pass `control.signal`. `control.onTask(task)` provides the native task while it is pending, for operations such as progress tracking.

Cancellation ends this wait and calls the native task's `abort()` when available. It does not automatically close a native dialog or guarantee that completed writes or external operations are reversed. RequestTask, DownloadTask, and UploadTask are control handles; receiving one does not mean the operation succeeded.

Success, failure, and complete callbacks each run at most once. Native implementations that only invoke complete must return a clear `errMsg` status; an indeterminate result reports `PROTOCOL_ERROR`. Even when a network request invokes success, check `statusCode` and application fields separately. Synchronous exceptions, callback exceptions, and cleanup failures are never converted into success.

## Events and native objects

Ordinary event subscriptions require both the native `on...` method and its corresponding `off...` method. Explicitly registered exceptions for global off or no off disable only their own local callbacks and preserve other listeners; physical removal of the native listener is not guaranteed. Callbacks preserve every argument, the native `this`, and their return value. Call the returned unsubscribe function when leaving a scene or disposing of a module:

```js
const unsubscribe = bridge.onAPIEvent('onNetworkStatusChange', event => {
  // Update your state using native fields such as event.isConnected.
});

// When leaving the scene:
unsubscribe();
```

The caller manages audio, ad, video, SocketTask, and other objects returned by `createAPIObject()`. Remove their listeners according to the platform protocol and call `destroy()` or `close()` when appropriate. Managers and shared Canvas objects should not be treated as independently disposable resources.

```js
const audio = bridge.createAPIObject('createInnerAudioContext');
const onEnded = () => {
  audio.offEnded(onEnded);
  audio.destroy();
};
audio.onEnded(onEnded);
audio.src = 'game/beep.wav'; // Audio in this sample package; use your own project path.
audio.play();
```

A real project must also handle audio errors, explicit stopping, and scene changes. Disposing of a plugin instance cleans up that instance's event subscriptions. It does not destroy the global bridge while other instances use it, or take ownership of every returned native object's lifecycle.

## Platform semantics

| Capability | WeChat | Douyin | TikTok Native |
| --- | --- | --- | --- |
| Host namespace | `wx` | `tt` | `TTMinis.game`; does not reuse `tt` |
| Initialization | Plugin Init configures this project's bridge | Plugin Init configures this project's bridge | Native SDK needs no init; plugin Init is still required |
| `shareAppMessage` | `sync`, with no completion callback | `async`, using native callbacks | A separate `async` contract using TikTok directory rules and official parameters |
| Native Web Audio entry | `createWebAudioContext` | `getAudioContext` | `createWebAudioContext` |
| Menu layout | `getMenuButtonBoundingClientRect` | `getMenuButtonLayout` | `getMenuButtonBoundingClientRect` |
| Payment | Use WeChat payment APIs and configuration | Only explicitly registered directory entries are available | `pay({trade_order_id})`; its callback does not confirm fulfillment |


`onShareAppMessage` requires a JavaScript callback that returns the sharing configuration. Receiving a notification in an event sheet cannot replace that return object. `connectSocket` returns a real SocketTask; connection success is determined by `onOpen`, not by object creation.

Browser-style runtime adapters for `fetch`, XHR, WebSocket, Audio, and related interfaces have separate compatibility limits. A native entry in the directory does not imply a complete implementation of browser standards. The application must still configure platform network domains, permissions, privacy settings, ad placements, and open-data contexts.

## Interpreting validation results

Version 0.3.0 was re-exported from the real Construct r495.2 editor and converted for all three platforms. Its release baseline was 255 local regression tests passed and 0 failed. The WeChat IDE was checked for startup, 53 entries, and category/back navigation; the updated self-check and payment test entries were not run. Later TikTok iOS user screenshots of fix4 showed the 57-entry page and navigation into storage, along with a read-back failure. This provides only partial rendering and navigation evidence. fix5 passed 318 local tests with 0 failures and 0 skips; storage and device readings on a phone still need retesting. See [Validation records](../validation/).

The 0.2.0 runtime baseline had **213 automated regression tests passed**, many using controlled native API fixtures to check success, failure, cancellation, and resource cleanup. All 17 common self-checks passed in the real WeChat IDE, and some interface, keyboard, and audio interactions were tested. That historical WeChat host exposed 133 / 171 available methods; this is not a count of successful calls.

The Douyin IDE, TikTok IDE, physical devices on all three platforms, and every individual API have not completed acceptance testing. Real TikTok payments remain unverified. The WeChat IDE's native Modal confirmation and cancellation callbacks work, but can still trigger the identified internal IDE error `worker path empty`. Use the validation records to choose your own test scope.

Native failure `message`, `cause`, and response data may contain application information. For public diagnostics, record only `error.code`, `operation`, and the platform. Do not include temporary login codes, clipboard contents, or request payloads.

## TikTok sources and payment limits

The TikTok directory is maintained independently in the source, based on the [Mini Games SDK Overview](https://developers.tiktok.com/docs/en/mini-games-sdk-overview) and public category documentation. Sharing an API name does not automatically inherit WeChat or Douyin support. Methods on returned native objects, such as `readFile`, audio methods, and SocketTask methods, remain methods of those objects rather than top-level `TTMinis.game` calls.

Payments can use the event-sheet Call API action or plugin instance `callAPI("pay", ...)`. The additional runtime helper `C3MiniGameBridge.pay()` distinguishes client completion from unconfirmed fulfillment. After the server receives and verifies the Webhook, validates the order, and fulfills it idempotently, the client queries its own backend for the final result. See [TikTok IAP](../tiktok-iap/).
