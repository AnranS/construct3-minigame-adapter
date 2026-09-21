# MiniGameBridge addon integration

MiniGameBridge is a Construct SDK v2 single-global object addon with the fixed plugin ID `C3MiniGameBridge`. The current adapter version is **{{VERSION}}**; the addon manifest uses the four-part version number required by Construct. It provides **19 actions, 11 conditions, and 14 expressions**, and can also be called from Construct JavaScript scripts.

Follow [getting started](../guide/) to install the `.c3addon`, add the object, and convert your mini-game. The addon declares that it does not support Worker mode. The converter installs the runtime bridge, and the addon forwards event-sheet and script calls to it.

## Initialization and error handling

Call **Init** when the layout starts, then wait for **On ready** before calling business APIs. Use **On error** to display or handle failures in one place.

```text
System → On start of layout
  MiniGameBridge → Init

MiniGameBridge → On ready
  Perform subsequent platform operations

MiniGameBridge → On error
  Read LastErrorCode, LastError, LastOperation
  Generic calls also expose LastAPIName, LastAPITag
```

A missing mini-game bridge returns `UNSUPPORTED`; calling before initialization returns `NOT_READY`. Initialization does not automatically log in, read the clipboard, request permissions, or show ads. Platform property values remain ordered as Auto-detect, Douyin, WeChat, and TikTok. TikTok is appended at index 3, preserving existing project selections. It uses `TTMinis.game`, never Douyin's `tt`. The native SDK needs no init call; addon Init initializes only the adapter.

All event-sheet actions support Construct's **Wait for previous actions to complete**. **Read synchronous API** still calls the native synchronous method immediately; support for waiting does not change the API's native invocation kind.

## Event sheets: call an API

Generic actions follow these native contracts:

| Action | Input | Result |
| --- | --- | --- |
| Call API | API name, options JSON object, tag | Wait for the native success callback, then trigger On API succeeded(tag) |
| Read synchronous API | API name, positional-argument JSON array, tag | Obtain the native return value immediately, then trigger On API succeeded(tag) |
| Subscribe to API event | `on...` event name, tag | Trigger On API succeeded(tag) after registration; subsequent events trigger On API event(tag) |
| Unsubscribe from API event | The same event name and tag | Remove this instance's matching subscription; the result includes `unsubscribed` |

For example, query the network type:

```text
MiniGameBridge → On ready
  MiniGameBridge → Call API
    API name: "getNetworkType"
    Options JSON: "{}"
    Tag: "network"

MiniGameBridge → On API succeeded("network")
  Text → Set text to MiniGameBridge.LastResultJSON
```

`LastResultJSON` is a JSON string containing the complete native result. To read its `networkType` field, parse it with a Construct JSON object in your project, then retrieve the field.

For synchronous storage reads, use the API name `getStorageSync` and this argument-array content:

```json
["my-game/save"]
```

Options must be a JSON object, and synchronous arguments must be a JSON array. Invalid JSON returns `INVALID_JSON`; the wrong shape returns `INVALID_ARGUMENT`. Neither invokes the native method.

## Tags and result expressions

A tag is a label you choose, such as `network`, `save-read`, or `keyboard`. It distinguishes call sources in event sheets, is case-sensitive, and is not passed to the native API.

| Expression | Purpose |
| --- | --- |
| `LastAPIName`, `LastAPITag` | API/event name and tag associated with the current trigger |
| `LastResultJSON` | API result as a JSON string |
| `LastResultIsJSON`, `LastResultType` | Whether the result can be represented faithfully as JSON, and its original type |
| `LastEventJSON` | Native event data as a JSON string |
| `LastEventIsJSON`, `LastEventType` | Whether event data can be represented faithfully as JSON, and its original type |
| `CapabilitiesJSON` | Current capability catalog, including names, invocation kinds, and fields such as `supported` |
| `LastErrorCode`, `LastError`, `LastOperation` | Error code, description, and failed addon operation |

API success does not guarantee a JSON-compatible result. For values that cannot be represented faithfully, such as `undefined`, binary data, native objects, or cyclic objects, `LastResultIsJSON` is 0 and `LastResultJSON` is an empty string. Use the JavaScript interface to access original values when needed. The addon does not replace them with `{}` or `null`.

`LastResultJSON` and `LastEventJSON` separately hold call results and event data; read them during the corresponding trigger. Results, events, tags, and temporary login codes are not written to Construct save data.

## Event sheets: subscribe and unsubscribe

To listen for keyboard input:

```text
MiniGameBridge → On ready
  MiniGameBridge → Subscribe to API event
    Event name: "onKeyboardInput"
    Tag: "keyboard"

MiniGameBridge → On API event("keyboard")
  Read MiniGameBridge.LastEventJSON

When closing the input feature
  MiniGameBridge → Unsubscribe from API event
    Event name: "onKeyboardInput"
    Tag: "keyboard"
```

Subscribing again with the same event name and tag replaces the previous subscription; different tags remain independent. Ordinary subscriptions require both the native `on...` method and its corresponding `off...` method. Explicitly cataloged exceptions with an off method that removes all listeners, or with no off method, only deactivate this subscription's callback. They do not clear other listeners or claim that the native listener was removed. Releasing the addon instance or loading save data cleans up this instance's subscriptions, without releasing the shared bridge or another instance's resources.

## Common shortcut actions

Use these actions for common features without writing JSON manually:

| Action | Behavior |
| --- | --- |
| Show toast / Show modal | Call native notifications/dialogs; read `confirm` and `cancel` from Modal results |
| Write / Read / Remove storage | Call native asynchronous storage; writes accept any JSON value |
| Get network type | Read the network type |
| Write / Read clipboard | Call native clipboard APIs |
| Show / Hide keyboard | Show or hide the native keyboard; receive input through keyboard events; WeChat and TikTok explicitly pass `keyboardType: "text"` |
| Login | Obtain a temporary login code and trigger On login succeeded |
| Show rewarded video | Trigger On ad completed only after full viewing; other close results trigger On ad cancelled |
| Report score | Request the configured HTTPS score service and trigger On score reported on success |
| Vibrate | Request short/long vibration and trigger On vibration completed |

Generic native storage does not automatically prefix keys; use keys specific to your project. The custom score service is not a built-in platform leaderboard. Send login codes to your backend to verify identity, and keep AppSecrets on the server. Grant rewards only after **On ad completed**.

## JavaScript: check availability and call APIs

In a project script with access to Construct's `runtime`, obtain the instance using its actual object name:

```js
const bridge = runtime.objects.MiniGameBridge.getFirstInstance();
await bridge.init();

if (bridge.supportsAPI("getNetworkType")) {
  try {
    const result = await bridge.callAPI("getNetworkType", {});
    // Use result.networkType in your UI or network logic.
  } catch (error) {
    console.warn("getNetworkType failed:", error.code);
  }
}

const available = bridge.getCapabilities().filter(item => item.supported);
```

If you rename the Construct object, update `runtime.objects.MiniGameBridge` accordingly. Availability checks do not invoke business APIs and do not imply that permission has been granted or the operation will succeed. See the [API catalog](../api/) for all invocation kinds.

```js
// async: pass an options object and wait for the native callback.
await bridge.callAPI("setStorage", {
  key: "my-game/save",
  data: { level: 3 }
});

// sync: pass native positional arguments, not a wrapping argument array.
const save = bridge.getAPISync("getStorageSync", "my-game/save");
```

JavaScript `callAPI`, `getAPISync`, and `createAPIObject` also trigger generic success conditions with an empty-string tag. Failures both trigger **On error** and reject/throw, so script callers must still catch errors. Avoid applying rewards or other business operations twice through both an event sheet and a script.

## JavaScript: cancellation and timeouts

`callAPI` returns a cancellable Promise supporting `.abort()` and `AbortController.signal`:

```js
const controller = new AbortController();
const pending = bridge.callAPI(
  "getStorage",
  { key: "my-game/save" },
  { timeoutMs: 5000, signal: controller.signal }
);

// When the page closes or you no longer need the result, use either option:
// controller.abort();
// pending.abort();

try {
  const result = await pending;
  // Use result.data.
} catch (error) {
  if (error.code !== "ABORTED") {
    console.warn("Storage read failed:", error.code);
  }
}
```

Ordinary asynchronous APIs have a default timeout of 30 seconds. Interactive APIs such as Modal, authorization, scanning, and image selection have no default timeout. Set `control.timeoutMs` to override it explicitly; use `control.onTask` to receive the native task handle returned by the API.

Cancellation ends the current wait. It also attempts to cancel the underlying task only when the native task exposes `abort()`. It does not guarantee that a platform dialog closes and cannot undo writes that have already occurred. A task handle is not treated as a successful result.

## JavaScript: manage native objects and events

Native audio, ad, SocketTask, and other objects must be used and released according to their platform contracts. This example cleans up audio when playback ends, fails, or the feature closes:

```js
const bridge = runtime.objects.MiniGameBridge.getFirstInstance();
await bridge.init();

let audio;
let stopKeyboardEvents;

function closeFeature() {
  try {
    stopKeyboardEvents?.();
  } finally {
    stopKeyboardEvents = undefined;
    if (audio) {
      const current = audio;
      audio = undefined;
      try {
        current.offEnded(closeFeature);
      } finally {
        try {
          current.offError(onAudioError);
        } finally {
          current.destroy();
        }
      }
    }
  }
}

function onAudioError(error) {
  console.warn("Audio failed:", error.errCode);
  closeFeature();
}

if (bridge.supportsAPI("onKeyboardInput")) {
  stopKeyboardEvents = bridge.onAPIEvent("onKeyboardInput", data => {
    // Use data.value as needed; keep user input out of public logs.
  });
}

if (bridge.supportsAPI("createInnerAudioContext")) {
  audio = bridge.createAPIObject("createInnerAudioContext", {});
  audio.src = "game/beep.wav"; // Replace with an audio path that exists in your game package.
  audio.onEnded(closeFeature);
  audio.onError(onAudioError);
  // Run when your game allows playback or in response to a user action:
  audio.play();
}

// Also call closeFeature() when the feature closes.
```

The unsubscribe function returned by `onAPIEvent` can be called repeatedly. The caller owns native object listeners and cleanup. Do not treat file managers, open-data managers, or shared canvases as independent disposable resources. Generic `callAPI` does not automatically manage native object methods or failure callbacks.

## Platform differences and common errors

WeChat `shareAppMessage` uses `getAPISync` and has no share-completion callback; an `undefined` return does not prove a successful share. Douyin's same-named API uses `callAPI` and follows native callbacks. Use a JavaScript callback for `onShareAppMessage` when it must return configuration; an event-sheet notification cannot replace that return value.

| Error code | Check first |
| --- | --- |
| `NOT_READY` | Whether Init has run and On ready has fired |
| `UNSUPPORTED` | Current platform, base-library version, catalog entry, and native method availability |
| `WRONG_API_KIND` | Whether the call uses the correct async / sync / object / event interface |
| `INVALID_JSON` / `INVALID_ARGUMENT` | JSON content, object/array shape, and argument types |
| `TIMEOUT` / `ABORTED` | Whether the wait timed out or your project cancelled it |
| `PLATFORM_ERROR` | Native failure details, permissions, domains, ad units, and business configuration |
| `CALLBACK_ERROR` | Whether a project-provided event handler threw an error |

Modal still has a known Worker error in WeChat IDE. A successful native callback does not establish that this issue is fixed. See [troubleshooting](../troubleshooting/) and [validation records](../validation/) for steps and acceptance boundaries.

## TikTok payments use the existing Call API action

In an event sheet, call `pay` with Options JSON containing a `trade_order_id` created by your backend, for example `{"trade_order_id":"backend-created-order"}`. You can use `purchase-panel` as the tag. This example ID is not a payable order; the real value must come from your backend.

**On API succeeded("purchase-panel") means only that the client payment-flow callback succeeded. It does not authorize fulfillment.** Query your authenticated backend next, wait for it to verify the webhook, check the order, and fulfill it idempotently, then refresh the player's assets. If the payment callback has no JSON data, `LastResultIsJSON` being 0 does not mean the payment failed.

After a native payment cancellation or failure, create a new order for a new purchase rather than automatically retrying the old order. A polling timeout leaves the order pending so the player can check later. `globalThis.C3MiniGameBridge.pay()` is a runtime helper with an explicit `fulfillment: "unconfirmed"` result, not an addon instance method. See [TikTok payments](../tiktok-iap/) for the complete workflow and server helpers. TikTok IDE, device, and real-payment validation remain incomplete.
