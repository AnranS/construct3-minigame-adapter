# Validation records and compatibility limits

Record date: **2026-09-21**. Historical tested tool version: **0.2.0**. These documents ship with **{{VERSION}}**. Current feature project: **MiniGameApiSuite**.

The historical 0.2.0 baseline completed an export from the real Construct editor, conversion builds for WeChat and Douyin, and WeChat IDE checks for startup, rendering, 17 self-checks, and some interactions. **Acceptance testing remains incomplete for the Douyin / TikTok IDEs, full physical-device functionality on all three platforms, and all platform business APIs.** The WeChat IDE Modal Worker error remains unresolved.

## Image demo update

The current downloadable `.c3p` adds an image-rendering category: it loads a PNG from project Files and displays, proportionally scales, and hides it through a Construct Sprite. The source sample has **54 entries in 13 categories** for WeChat / Douyin and **58 entries in 14 categories** for TikTok. Local regressions passed **324 tests, with 0 failures and 0 skips**. The plugin and three-platform smoke builds passed.

This updated source project has not yet completed another Construct export, mini-game IDE check, or phone image-rendering check. Old HTML5 exports and mini-game packages do not contain this category. The 53 / 57 entry counts and export/IDE records below refer to the version before this update. The homepage image is the actual sample asset, not a runtime screenshot.

## Export and builds at the 0.3.0 release

The updated project was exported to HTML5 in the real Construct r495.2 editor. The 28 files in the original ZIP matched the extracted directory individually, and the exported project script matched the source. The plugin's seven runtime JS files also matched the source byte for byte, including the TikTok enum and keyboard fixes, confirming that the real export loaded the updated plugin. The same export was successfully converted into native projects for WeChat, Douyin, and TikTok. The local regression baseline at the 0.3.0 release was **255 passed and 0 failed**.

The `.c3p` project-version metadata was corrected to 0.3.0.0, the referenced plugin version remained 0.3.0.0, and the other 24 ZIP entries were unchanged. This metadata correction did not alter the project script or engine files in the real HTML5 export.

The 0.3.0 WeChat IDE check used RC 2.02.2607161, base library 3.15.3, and the iPhone 12/13 Pro simulator. It displayed 53 entries, used WebGL2, and reached actual runtime-ready. A fresh startup showed 0 errors and 2 warnings; opening the basic-information category and returning both worked. **This round did not run the 17 self-checks, click payment test entries, or retest Modal.** The historical successes below must not be carried forward as new results. Douyin / TikTok IDE checks, complete physical-device functionality on all three platforms, and real payments remain unvalidated. Full file hashes and three-platform build records are stored under `releases["0.3.0"]` in the repository's `docs/EXPORT-EVIDENCE.json`.

## TikTok integration status

The 0.3.0 release added a separate TikTok Native Mini Games host, platform API directory, and payment-call contracts. At that time, the sample had 53 entries in 12 categories for WeChat / Douyin and 57 entries in 13 categories for TikTok. The new payment entries did not make actual payments. On 2026-09-21, a user's TikTok iOS fix4 screenshots showed the 57-entry page and navigation into the local-storage category, along with a write/read-back failure. This provides partial rendering and navigation evidence. TikTok IDE, complete physical-device functionality, and real-payment acceptance remain outstanding; the WeChat tests and 0.2.0 directory figures below remain historical baselines.

fix5, marked `storage-device-5`, maps TikTok storage key reads directly to `getStorageSync` instead of relying on key enumeration to determine whether a value exists. `keys`, `length`, and `clear` still use native enumeration and preserve its failures. `getDeviceInfo` prefers the native method with that name. Only when it is missing or is not a function does it map to the official `getSystemInfoSync`, returning the actual native object without inventing fields. Capability records expose `nativeMethod` and `compatibilityFallback`. An exception from the native method does not switch execution to the fallback.

On 2026-09-21, fix5 passed **318 local tests, with 0 failures and 0 skips**. Re-conversion of the real Construct export and syntax checks passed. Automation reproduced the adapter defect when enumeration was delayed or missing, but the phone's raw storage return values remain unknown. Storage and device readings in the new package still need phone retesting. For the full fix history and evidence, see the [repository validation record](https://github.com/anrans/construct3-minigame-adapter/blob/main/docs/VALIDATION.md) and [Troubleshooting](../troubleshooting/).

For current unique API totals and per-platform coverage, use the dynamically generated [API reference](../api/). Server-side order processing, Webhook signature verification, idempotent fulfillment, and real payment outcomes must be integrated and validated separately. See [TikTok IAP](../tiktok-iap/).

## What the historical baseline numbers mean

| Figure | Meaning |
| --- | --- |
| **171 API names / 20 categories** | The adapter's explicit call directory, with 142 names for WeChat and 140 for Douyin; not proof that each API passed a real test |
| **133 / 171** | The historical WeChat IDE host's capability-detection result; methods were available, not necessarily authorized, configured, or successfully called |
| **51 entries / 11 categories** | Organization of the MiniGameApiSuite feature pages; one entry can combine multiple APIs |
| **213 passed / 0 failed** | The 0.2.0 runtime test baseline; the 0.3.0 release baseline of 255 is recorded separately above |
| **17 succeeded / 0 failed / 0 skipped** | The 0.2.0 sample's self-check results in the real WeChat IDE, read back from the runtime console |

Directory coverage, capability detection, automated tests, and physical-device acceptance are different levels of evidence. The project cannot currently claim validated support for the complete Construct runtime, arbitrary Construct games, or all 171 APIs.

## 0.2.0 real export and runtime environment

| Item | Record for that test round |
| --- | --- |
| Construct | r495.2; MiniGameApiSuite was opened, saved, and exported to HTML5 in the real editor |
| Plugin | MiniGameBridge 0.2.0, with Construct manifest version 0.2.0.0 |
| Original export | The unmodified 28-file HTML5 ZIP was retained locally; conversion patches were applied during the build. The public repository supplies `.c3p`; generate HTML5 through your own Construct export |
| Conversion | Both WeChat and Douyin projects built successfully |
| WeChat IDE | macOS, RC 2.02.2607161, actually running base library 3.15.3 |
| Rendering and readiness | WebGL 2; received `[C3 MiniGame] Construct runtime-ready` |
| Device configurations | iPhone 12 / iPad Pro 12.9 simulators; each displayed correctly after fully reopening the project |
| Startup logs | 0 errors and 2 warnings during that fresh-start observation window, excluding later Modal interactions |

Simulator device configurations do not represent tests on the corresponding phones or tablets. Successful builds for both platforms also do not mean that both were run.

## 0.2.0 WeChat IDE self-checks

The 17 self-checks made actual platform calls and checked their results, covering:

- Device, window, safe area, application base information, launch options, enter options, and system settings.
- Network type.
- Writing sample-specific native storage keys, querying storage information, and deleting those keys.
- Round-trip verification of temporary-file writing, reading, and cleanup.
- Package-resource reads through fetch and XHR.
- Battery, brightness, and the performance clock.

Results were **17 succeeded, 0 failed, and 0 skipped**. These self-checks operate on sample-specific storage and temporary files. They do not proactively request permissions, share content, or connect to external networks.

## 0.2.0 WeChat IDE interaction checks

| Feature | Actual observation | Scope |
| --- | --- | --- |
| Toast | Native toast displayed and success callback received | Display and callback observed in that test round |
| Loading | Native Loading displayed; hideLoading succeeded after one second | Both showing and hiding observed |
| ActionSheet | Selected the second item and received the corresponding option | Selection and callback observed |
| Short / long vibration | Both received success callbacks | Phone hardware vibration not validated |
| Modal | Confirmation and `cancel=true` cancellation callbacks worked | One red `worker path empty` error still appeared; unresolved |
| Native keyboard | Input displayed, eight characters entered, onKeyboardInput and onKeyboardComplete received | Only length was recorded; hideKeyboard succeeded after input completion had closed the keyboard. Actively hiding an open keyboard through that API was not validated |
| Explicit audio stop | Stop was pressed during the eight-second clip; onStop arrived and resources were released | Explicit-stop path observed |
| Natural audio completion | onEnded arrived after a separate complete playback | Natural-completion path observed |
| Categories and back navigation | Category and back operations worked | Not generalized to every input device or physical device |

An error-free startup does not mean every later operation is error-free. The Modal issue reproduced with base library 3.15.3 and, after a full reopen, 3.12.1. A local read-only investigation traced it to query parameters being lost when the IDE forwards an internal Worker URL. This has not been officially confirmed, and no validated fix has been delivered. Reproduction steps are in [Troubleshooting](../troubleshooting/).

## 0.2.0 automated regression coverage

The historical 0.2.0 `npm test` run had **213 passed and 0 failed**. Main coverage:

| Area | Checks |
| --- | --- |
| Plugin package and registration | Official schemas; action / condition / expression consistency; language entries; ZIP root layout and packaged contents |
| Plugin runtime | Initialization, tag isolation, JSON and non-JSON results, cancellation, errors, instance cleanup, and late callbacks |
| Platform APIs | Directory, platform differences, invocation kinds, success / failure, timeout, cancellation, event on/off, and missing capabilities |
| DOM and resources | Limited DOM, Canvas properties, global isolation, DOMRect, Blob / URL, UTF-8, package resources, and WASM limits |
| Networking | fetch / XHR failure, cancellation, timeout, reentrancy, and stale-response interference; WebSocket state, message ordering, binary data, and closing |
| Audio and lifecycle | Playback, stopping, source changes, muted volume, completion waits, event cleanup, and disposal exceptions |
| Input | Touch IDs, primary pointer, empty changedTouches, wheel events, native cancellation, and subscription cleanup |
| Storage | Serialization, isolation, error propagation, and the recognized Construct localforage integration |
| Build and export protocol | Entry ordering, dynamic modules, internal job messages, actual ready protocol, preservation of old output after a failed build, and directory/dependency boundaries |

These tests mainly use controlled mock APIs. They do not connect to real account backends, show real ads, or publish projects. Handwritten Construct protocol fixtures and native API smoke projects support regression testing. They do not include the complete Construct engine and do not replace editor-export acceptance testing.

## Current compatibility limits

| Capability | Current implementation and limits |
| --- | --- |
| DOM / CSS | Only the limited interfaces needed for engine startup and resource loading; no complete browser layout, forms, or arbitrary HTML plugins |
| Rendering | Uses the host Canvas / WebGL. That test round validated the actual Text page; other plugins, effects, shaders, and performance need per-project checks. WebGPU is not implemented |
| Worker | Internal jobs use a same-thread asynchronous compatibility implementation, without multithreaded acceleration, isolation, or transferable detachment semantics |
| Scripts | Bundles local code; rejects remotely executable scripts, import maps, and general inline scripts |
| Storage | localStorage and recognized runtime.storage paths use actual platform storage; no complete IndexedDB emulation |
| fetch / XHR | Package files, data URLs, and native request are supported; no response streams, synchronous XHR, or complete cookie / credentials management |
| WebSocket | Bridges through actual SocketTask objects and preserves connection/closing state; external services, domains, TLS, and subprotocols still require real validation |
| Audio | Native InnerAudioContext bridge; Web Audio is exposed only when the host actually provides the corresponding entry. Full effect chains and decoding paths have limits |
| WASM | Uses actual host capabilities. WeChat accepts only package paths or bytes that exactly match a registered package file |
| Platform operations | The project supplies parameters, permissions, account backends, ad placements, open-data contexts, and platform settings. Newly added payment entries handle client calls only; the server confirms final order and fulfillment state |

See the [API directory](../api/) for interface names and invocation kinds.

## Pending acceptance checks

- Actual compilation, initialization, first frame, and platform calls in Douyin and TikTok IDEs. TikTok Native does not call SDK init.
- The full TikTok real-payment flow: cancellation, pending state, backend Webhook signature verification, and idempotent fulfillment.
- Cold startup, rendering, touch, audio, foreground/background transitions, orientation, performance, and extended runs on physical WeChat, Douyin, and TikTok devices.
- Actual forwarding by the latest wheel adapter, physical-device multitouch, onShow / onHide in the current sample, and actively hiding an open keyboard.
- Real login backend exchange, production network requests, external WebSocket services, and full viewing / early closure of real ads.
- Retesting the Modal Worker error in an official corrected version, and determining whether physical devices are affected.
- Different Construct versions, actual game plugins, shaders, decoders, and project-specific assets.

Record success, failure, and cancellation separately for each platform. Establish a baseline with a minimal project, then add the features your game uses. A passing sample must not be generalized to every project.

## Interpreting the build report

The converter's `BUILD-REPORT.json` contains static findings and entry/patch records. It currently retains these statuses:

```json
{
  "validation": "build-only-not-device-verified",
  "deviceVerified": false,
  "workerExecution": "same-thread-asynchronous"
}
```

This is the build tool's status declaration. It does not override the separately recorded IDE evidence on this page. After validating your own project on physical devices, retain device details, versions, logs, and reproduction steps. Editing this field does not replace testing. Start with [Quick start](../guide/).
