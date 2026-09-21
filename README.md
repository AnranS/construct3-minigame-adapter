# Construct 3 Mini Game Adapter

English | [简体中文](README.zh-CN.md)

[Documentation](https://anrans.github.io/construct3-minigame-adapter/) · [Illustrated guide](https://anrans.github.io/construct3-minigame-adapter/guide/) · [GitHub](https://github.com/anrans/construct3-minigame-adapter)

Convert Construct 3 HTML5 exports into native mini-game projects for WeChat, Douyin, and TikTok. This project includes the MiniGameBridge addon, an offline conversion CLI, and a runtime adapter. Games can call platform APIs from Construct event sheets or JavaScript.

**Version 0.3.0 supports three separate native namespaces: `wx`, `tt`, and `TTMinis.game`, with payment calls, backend order polling, and server-side webhook signature helpers.** The catalog contains 194 API names across 21 categories. See the [API directory](https://anrans.github.io/construct3-minigame-adapter/api/) for contracts and platform differences. TikTok uses its native runtime, requires no SDK initialization, and is never aliased to Douyin's `tt`.

Before the image-demo update, version 0.3.0 was exported using the real Construct r495.2 editor and converted for all three targets. WeChat DevTools showed WebGL2 rendering, `runtime-ready`, 53 feature entries, working category/back navigation, and 0 errors with 2 warnings on the observed startup. A user-provided TikTok iOS screenshot showed 57 entries and navigation into the storage category, but also reported a storage readback failure; the fix5 storage and device-info changes still require phone verification. **The current self-checks and payment entries have not been exercised on a device; Douyin/TikTok IDE acceptance, full feature testing on all three platforms, and real payments remain unverified.** The historical WeChat IDE Modal/Worker error remains unresolved and has not been retested in this release. See [validation records](docs/VALIDATION.md) and [troubleshooting](https://anrans.github.io/construct3-minigame-adapter/troubleshooting/) for detailed and historical evidence.

The public repository contains source, the addon, original test fixtures, and `.c3p` examples. **It does not distribute Construct engine HTML5 exports or mini-game builds containing that engine.** After cloning, open `MiniGameApiSuite.c3p` in Construct, export HTML5 yourself, then run the converter. Follow the steps below or the [getting started guide](https://anrans.github.io/construct3-minigame-adapter/guide/). Original local exports and historical evidence are retained separately.

## Components and workflow

| Component | Purpose |
| --- | --- |
| `addon/` | SDK v2 single-global MiniGameBridge object; fixed plugin ID `C3MiniGameBridge`; event-sheet actions, conditions, and expressions |
| `src/cli.mjs`, `src/build/` | Inspect an extracted HTML5 export, bundle local scripts/resources, and generate mini-game entry points and configuration |
| `src/runtime/` | Limited DOM/loader compatibility and bridges to real native platform APIs |
| `examples/construct/` | Construct `.c3p` test projects and project scripts; users generate HTML5 exports locally |
| `examples/smoke/` | Minimal native API smoke examples without the Construct engine |
| `website/` | Documentation content, generated API directory, and static-site build tools |

This is an **addon plus an offline converter**. The public Addon SDK does not expose custom exporter registration, so installing the addon does not add WeChat, Douyin, or TikTok to Construct's export menu. Export with Construct's HTML5 exporter first, then generate a mini-game project with this CLI. The converter installs the adapter and `globalThis.C3MiniGameBridge` before loading the game entry point. The addon calls that bridge; it does not inject the mini-game adapter as an ordinary DOM script.

## Install and package the addon

Install Node.js 22 or newer, then run:

```sh
git clone https://github.com/anrans/construct3-minigame-adapter.git
cd construct3-minigame-adapter
npm ci
npm test
npm run build:addon
```

The addon is generated at `dist/C3MiniGameBridge.c3addon`. In Construct's Addon manager, choose **Install new addon**, select this file, and follow the editor's installation/reload prompts. Add a **MiniGameBridge** object to your project. The addon declares Construct r450 as its minimum version, uses SDK v2, and does not support Worker mode.

For development, run `npm run dev:addon` and use `http://localhost:65432/addon/addon.json` through Construct's developer-addon workflow. The historical baseline project is available at `http://localhost:65432/MiniGameBridgeTest.c3p`; open the current `MiniGameApiSuite.c3p` from your local files. This server listens only on `127.0.0.1:65432`, serves addon-manifest files and the historical baseline project, and allows cross-origin reads from `https://editor.construct.net`. Stop it with Ctrl+C. It is an editor development tool, not a runtime dependency of exported mini-games.

Addon properties:

| Property | Configuration |
| --- | --- |
| Platform | `auto`, `douyin`, `wechat`, or `tiktok`; an explicit selection must match the actual native host |
| Score endpoint | Your own HTTPS score service; score reporting is unavailable when this is empty |

## Use it in Construct

1. Call **Init** when the game starts.
2. After **On ready**, use **Call API**, **Read synchronous API**, or dedicated actions such as Login and Show rewarded video.
3. Handle **On error** using `LastErrorCode`, `LastError`, and `LastOperation`.
4. Grant an ad reward only after **On ad completed**. **On ad cancelled** means the video was not watched to completion.

| Action | Result condition | Details |
| --- | --- | --- |
| Init | On ready | Check the native bridge and apply addon properties |
| Login | On login succeeded | Obtain a temporary platform login code; `LastLoginCode` stays in memory |
| Show rewarded video | On ad completed / On ad cancelled | Requires a real ad unit ID assigned by the target platform |
| Report score | On score reported | Submit a score and optional leaderboard ID to your configured HTTPS service |
| Vibrate | On vibration completed | `short` or `long`, using the native vibration API |
| Call API | On API succeeded(tag) | API name, options JSON object, and tag; wait for the native success callback |
| Read synchronous API | On API succeeded(tag) | API name, positional-argument JSON array, and tag; return the native synchronous result |
| Subscribe / Unsubscribe to API event | On API event(tag) / On API succeeded(tag) | Manage this instance's subscriptions by event name and tag using the catalog's native on/off or local-unsubscribe contract |

Failures trigger **On error**. Generic action results are available through `LastAPIName`, `LastAPITag`, and `LastResultJSON`; events use `LastEventJSON`. JavaScript retains non-JSON values directly; expressions do not disguise binary or native objects as empty JSON. **Supports API(name)** and `CapabilitiesJSON` report catalog membership and callable methods in the current host. Availability does not mean permission, valid configuration, or business success. **Is ready** reports initialization state, and **Platform** returns the platform name. Actions support Construct's “Wait for previous actions to complete.” Ordinary browser previews without the mini-game bridge return `UNSUPPORTED`; they do not simulate login or successful ads.

Send login codes to your own backend to exchange them for an identity. The addon does not upload codes automatically or include them in score requests or Construct save data. Score reporting is a custom backend request, not a built-in WeChat/Douyin leaderboard. Keep platform AppSecrets on the server and configure the platform's allowed request domains.

You can also call the addon instance from a Construct runtime script:

```js
const bridge = runtime.objects.MiniGameBridge.getFirstInstance();

try {
  await bridge.init();
  const result = await bridge.login();
  // Process result as needed; do not write login codes to public logs.
} catch (error) {
  console.error(bridge.getLastOperation(), bridge.getLastError());
}
```

If you rename the object in Construct, update the name under `runtime.objects`. JavaScript methods also trigger event-sheet conditions, but failures reject their promises and must be caught. See the [addon documentation](addon/README.md) for more methods and runtime interfaces.

The generic JavaScript interfaces are `callAPI(name, options, control)`, `getAPISync(name, ...args)`, `createAPIObject(name, options)`, `onAPIEvent(name, callback)`, `supportsAPI(name)`, and `getCapabilities()`. They accept only cataloged API names. If neither the native method nor a fallback explicitly registered in the catalog is available, they return `UNSUPPORTED`; the wrong invocation kind returns `WRONG_API_KIND`. Callers own native objects and must use the documented `close`/`destroy` methods and remove object listeners. `onAPIEvent` returns an idempotent unsubscribe function; releasing the addon cleans up only its own subscriptions.

Ordinary asynchronous APIs default to a 30-second wait. Interactive APIs such as Modal, authorization, scanning, and image selection have no default timeout; JavaScript callers can set `control.timeoutMs`. Cancelling the wait aborts the native task only if it exposes `abort()` and does not imply that a native dialog closed. WeChat `shareAppMessage` is a synchronous call with no completion callback, so returning does not confirm sharing. Douyin's same-named API follows its native callbacks. See [API invocation semantics](docs/API-COVERAGE.md).

## Convert an HTML5 export

The 0.2.0 feature demo completed a real local editor export, two-platform builds, and WeChat IDE rendering/self-check validation. The 0.3.0 demo before the image update was exported again in Construct r495.2, and the same HTML5 export built for WeChat, Douyin, and TikTok. That WeChat IDE run verified startup, 53 entries, and category/back navigation; self-checks and payment entries have not been rerun. [Export evidence](docs/EXPORT-EVIDENCE.json) and [validation records](docs/VALIDATION.md) distinguish each version's results.

- `examples/construct/MiniGameApiSuite.c3p`: the current public, categorized API demonstration project.
- `MiniGameApiSuite-html5.zip`: export this yourself in Construct; the public repository does not include it.
- `examples/construct/api-demo-html5/`: extract your HTML5 ZIP here. This is the default input for `export:*`; a fresh clone does not contain the engine files.

The earlier 21-entry `WeChatApiDemo`, the older `MiniGameBridgeTest`, and their HTML5 exports remain local historical baselines. The public repository distributes only their `.c3p` files and original project code, not historical HTML5 ZIPs, extracted engine directories, or converted engine builds. Historical projects are not the current default input. Edit demos in Construct and export again; keep original exports intact and let the converter apply runtime patches.

Open `MiniGameApiSuite.c3p` in Construct and choose **Export → HTML5**. For initial validation, disable script minification and offline support. Extract the ZIP into `examples/construct/api-demo-html5/` so that `index.html`, `scripts/`, and other exported resources are directly inside that directory, then run:

```sh
npm run inspect -- --input examples/construct/api-demo-html5
npm run export:wechat -- --appid YOUR_WECHAT_APP_ID
npm run export:douyin -- --appid YOUR_DOUYIN_APP_ID
npm run export:tiktok -- --appid YOUR_TIKTOK_APP_ID
```

These three scripts read the locally generated HTML5 directory, include `--experimental --overwrite`, and rebuild `dist/construct-wechat`, `dist/construct-douyin`, and `dist/construct-tiktok`. They can overwrite only outputs carrying this tool's marker. They convert the saved export and do not operate the Construct editor. Omitting `--appid` leaves it blank on a first build or a cross-platform rebuild; a valid same-platform `--overwrite` preserves the previous AppID. An explicit `--appid` replaces it, including an empty string to clear it. Use your own valid mini-game AppID.

On macOS, you can also double-click `build-wechat.command` or `build-douyin.command` and enter your AppID. They use the same `api-demo-html5` input, check Node.js and local dependencies, and ask you to run `npm ci` if dependencies are missing. These two scripts do not install dependencies or change system configuration. Import the reported output directory into the corresponding mini-game IDE.

`MiniGameApiSuite` uses Construct Text objects for its controls and a real Sprite for its image demo. The current source has **54 entries in 13 categories for WeChat/Douyin** and **58 entries in 14 categories for TikTok**, including the new image-rendering category. Payment entries check capability and flow without making a real payment. The 0.3.0 WeChat IDE run displayed 53 entries and verified category/back navigation; it did not click every new feature or run the new self-check. The historical 0.2.0 demo had 51 entries in 11 categories, with 17 self-checks completed in WeChat IDE: 17 passed, 0 failed, 0 skipped. Those checks covered common information, network type, dedicated storage keys, temporary-file write/read/cleanup, package fetch/XHR, battery, brightness, and the clock. They did not request permissions, share content, or contact external services. Unsupported APIs and failures retain their actual results. Login needs a real platform environment. Rewarded video, HTTPS, and WebSocket tests require real ad IDs, service endpoints, and platform domain configuration; unconfigured tests do not invoke those APIs. Acceptance status is recorded per feature.

### Image rendering demo

Open the latest [MiniGameApiSuite.c3p](examples/construct/MiniGameApiSuite.c3p), export HTML5 in Construct, and convert it as described above. In the running demo, select **图片渲染** (Image rendering), then **加载 / 隐藏测试图片** (Load / hide test image). The button loads the packaged [render-test.png](examples/construct/assets/render-test.png), displays it below the button at its original aspect ratio, and reports the decoded dimensions. Click again to hide the image and destroy the demo Sprite instance; returning to the category menu does the same.

The image is loaded through `runtime.assets.fetchBlob()` and rendered by a Construct built-in Sprite object named `RenderTestSprite`, using `replaceCurrentAnimationFrame()`. It exercises Construct's asset and Sprite rendering path. **This new image test has not yet been verified on a device.** The earlier 53-/57-entry observations do not validate this addition.

To maintain the demo, edit `examples/construct/api-demo-main.js` or replace `examples/construct/assets/render-test.png`, then synchronize those files into the editable source project:

```sh
node scripts/update-construct-demo.mjs
```

This updates only `examples/construct/MiniGameApiSuite.c3p`. It does not export HTML5 or update existing mini-game builds. Reopen the updated `.c3p` in Construct, export HTML5 again, extract the new export, and rerun the platform converter before testing. The checked-in project already includes the required `RenderTestSprite` object.

For your own game, export HTML5 to a directory such as `exports/my-game/`, keeping the entry point and relative resource structure. Start with a minimal project and unminified export to make engine issues easier to diagnose. The CLI input is an extracted directory, not a `.c3p` or ZIP file.

```sh
node src/cli.mjs inspect --input ./exports/my-game

node src/cli.mjs convert \
  --input ./exports/my-game \
  --output ./dist/my-game-wechat \
  --platform wechat \
  --experimental

node src/cli.mjs convert \
  --input ./exports/my-game \
  --output ./dist/my-game-douyin \
  --platform douyin \
  --experimental
```

Detected Construct exports require an explicit `--experimental` flag. Passing inspection means a build can be attempted; a successful build does not prove that the game starts.

| Option | Meaning |
| --- | --- |
| `--appid` | Your AppID; omitted on first/cross-platform builds means blank; valid same-platform overwrite inherits it; an explicit empty string clears it |
| `--orientation portrait\|landscape` | Requested orientation; defaults to `portrait` |
| `--entry` | A local relative JS entry point instead of parsing `index.html`; does not expand engine compatibility |
| `--overwrite` | Rebuild an output generated and marked by this tool; unmarked existing directories are not overwritten |
| `--json` | Machine-readable inspection/build report |

You can also use `npm run inspect -- --input ...` or `npm run convert -- ...`. Full help: `node src/cli.mjs --help`.

Each output contains:

```text
game.js                    Mini-game entry point and bundled code
game/                      Game resources
game.json                  Mini-game configuration
project.config.json        Developer-tool configuration
BUILD-REPORT.json          Inspection findings, patches, and remaining checks
.c3-minigame-output.json   Generated-output marker
README.txt                 Import instructions
```

Import WeChat/Douyin outputs as **mini-game projects** in their respective developer tools. Use TikTok's official Native Mini Games workflow for TikTok output. Configure each platform's own AppID and read `BUILD-REPORT.json`. This tool does not sign in, upload, or publish projects; it does not automatically configure subpackages, obtain ad access, or deploy a backend. Reports remain marked `deviceVerified: false`; record actual device evidence separately.

A valid same-platform `--overwrite` also preserves the previous `libVersion` and valid `project.private.config.json`; other `project.config.json` fields are regenerated. The build rejects symlinks, nonregular files, or invalid JSON in configuration/marker files or the report used to establish the previous platform, preserving the old output. It does not inherit configuration when the old platform cannot be established. `BUILD-REPORT.json` lists preserved field names in `preservedLocalConfig`, without recording AppID values.

Input and output cannot overlap. The converter rejects input symlinks, modules outside the export directory, and unbundled bare package dependencies. It builds in a temporary directory and preserves previous outputs if compilation fails.

## TikTok Native and IAP

TikTok uses `TTMinis.game`, independently of WeChat's `wx` and Douyin's `tt`. The addon preserves previous platform enum values and appends TikTok at index 3. Addon Init initializes this project's bridge, not `TTMinis.game.init()`, and does not load an HTML runtime SDK. See the official [Mini Games SDK Overview](https://developers.tiktok.com/docs/en/mini-games-sdk-overview).

```sh
node src/cli.mjs convert \
  --input ./exports/my-game \
  --output ./dist/my-game-tiktok \
  --platform tiktok \
  --appid YOUR_TIKTOK_APP_ID \
  --experimental
```

Use the existing Call API action / `callAPI("pay", {trade_order_id})`, or the runtime helper `globalThis.C3MiniGameBridge.pay()`. The helper's successful result means only `clientStatus: "completed"` with `fulfillment: "unconfirmed"`. Your backend must create orders, verify webhook signatures, and fulfill orders idempotently. The client queries your authenticated order endpoint. Polling timeouts leave the order pending; a new purchase after cancellation/failure requires a new order. See the [TikTok IAP guide](docs/TIKTOK-IAP.md).

`src/runtime/payment.js` provides `pollPaymentOrder`; `src/server/tiktok-webhook.mjs` provides server-side signature helpers. This project does not include an order database or automatic fulfillment service. User screenshots provide evidence of TikTok page display and category navigation, but TikTok IDE acceptance, complete device testing, and real payments remain outstanding. WeChat's two payment APIs use their own native parameters; TikTok order parameters cannot be reused for them.

## Compatibility boundaries

| Capability | Current scope and limits |
| --- | --- |
| DOM / CSS | Only interfaces needed for startup and resource loading; no complete browser layout, forms, or arbitrary HTML plugins |
| Rendering and input | Real native Canvas/WebGL and touch input. The historical 0.2.0 51-entry page passed WebGL2 rendering checks after full reopen in WeChat IDE's iPhone 12 and iPad Pro 12.9 configurations. Historical testing covered continuous drag scrolling, taps, Toast, action menus, Loading, keyboard input/completion, and audio stop/end. The latest wheel input and device multitouch remain untested. Arbitrary shaders, third-party plugins, and device behavior require separate validation; WebGPU is not implemented |
| Workers | Recognized Construct main-worker settings are disabled. Internal job workers run asynchronously on the same thread, without parallel execution, isolation, or transferable detachment |
| Modules and scripts | Local code only. Remote executable scripts, import maps, and general inline HTML scripts are rejected. Only an AST-exact Construct `file:` warning is skipped. Shared top-level declarations in classic scripts are rejected; use explicit `globalThis` sharing or ES modules |
| Storage | `localStorage` and recognized Construct `runtime.storage` / localforage paths use real native storage. JSON-like values, Date, and binary views are supported; cycles, functions, Map/Set/Blob are not. No simulated IndexedDB or silent successful in-memory fallback after persistence fails. Recognized browser Service Worker startup scripts are skipped |
| fetch / XHR | Package resources, data URLs, and platform requests. Repeated sends, request replacement, timeouts, cancellation, and stale responses during event reentry are handled. HTTP 4xx/5xx statuses are retained. No response streaming, synchronous XHR, full cookie/credentials management, or `overrideMimeType` |
| WebSocket | Native SocketTask-backed bridge that waits for actual onOpen; supports text, ArrayBuffer, views, Blob, ordered sends, binaryType, and close events. Subject to platform domain, TLS, and connection limits; not a substitute for server/IDE/device testing |
| Audio | Audio uses real `createInnerAudioContext`; play waits for the native event, and pause/source changes/destruction end pending waits. Mute/volume restoration and cleanup failures are handled. AudioContext is exposed only when the host has `createWebAudioContext`. This is not full browser audio; decoders, effect chains, and explicit sampleRate paths have limitations |
| WASM | Real native interfaces. The WeChat bridge accepts only package WASM paths or bytes exactly matching registered package files, not arbitrary downloaded or generated WASM. Complete engine decoding paths still need validation |
| Blob / URL | Real byte storage, UTF-8, Blob URLs converted to native temporary image files, and core-js-pure when native URL support is absent. Not every browser Blob URL consumer is implemented |
| Platform APIs | Explicit platform-specific catalogs for system information, lifecycle, UI, keyboard, networking, storage, device/media, login/settings, sharing, ads, and open data. Projects supply parameters, permissions, ad units, backends, and open-data configuration. Payment calls do not confirm fulfillment; the backend must verify signatures/orders and fulfill idempotently |

`GameGlobal.__C3MiniGameLoaded` means only that scheduled entry scripts loaded. `GameGlobal.__C3MiniGameScope.__C3MiniGameReady` waits for successful processing of Construct's actual `runtime-ready` message. Neither replaces validation of the first frame, sustained rendering, or business features. Inspection is based on static heuristics and cannot enumerate every requirement of third-party plugins or dynamically executed code.

## Development checks and native API smoke tests

```sh
npm test            # Automated regressions; no redistributed Construct engine required
npm run build:demo  # Generate dist/wechat, dist/douyin, dist/tiktok native API smoke projects
npm run verify      # Tests, addon packaging, and smoke-project builds
```

Import smoke projects into the respective mini-game IDE to check the adapter and native APIs independently. These are handwritten minimal examples, not replacements for real Construct export validation. `npm run build` packages the addon and rebuilds all three smoke directories. On macOS, `run-verification.command` runs tests and builds. Real Construct outputs use `dist/construct-wechat`, `dist/construct-douyin`, and `dist/construct-tiktok`; your game can use a separate directory such as `dist/my-game-wechat`.

The 0.3.0 release baseline was **255 passing tests, 0 failures**, with a real HTML5 export converted for all three platforms. The image-demo update passes **324 local tests, 0 failures, 0 skips**; the updated source project still needs a fresh Construct export and platform rendering checks. The local fix5 regression run on 2026-09-21 had **318 passing tests, 0 failures, 0 skips**; the real Construct export was converted again and syntax checks passed. Phone storage/device-info behavior still requires retesting; see [validation records](docs/VALIDATION.md). Public CI explicitly skips additional checks when local engine files are absent; GitHub Actions is the source of current CI results. The recorded WeChat IDE run before the image update verified startup, rendering, and category/back navigation, but did not rerun the new 17-item self-check or payment entries. Historical results are not carried forward as new-version results.

The native storage patch also has an original protocol fixture that runs in public CI. Checks requiring a local real Construct runtime explicitly skip when it is absent; that is not a successful engine validation and does not change historical 0.2.0 evidence. One additional check reads `examples/construct/html5/scripts/c3runtime.js`. To run it, locally export the historical `MiniGameBridgeTest.c3p` and extract its HTML5 files to `examples/construct/html5/`.

## Maintain the documentation site

Chinese documentation lives under `website/content/`, including setup, addon integration, troubleshooting, and validation boundaries. The TikTok payment page uses `docs/TIKTOK-IAP.md` directly. The API directory is generated from runtime source; update the source catalog and rebuild the site when changing APIs.

```sh
npm run build:addon  # Generate the downloadable addon package
npm run docs:build   # Build static documentation, API directory, and downloads
npm run docs:check   # Check generated pages and links
npm run docs:dev     # Start a local preview at the address printed in the terminal
```

The site publishes adapter documentation, the addon package, and `.c3p` examples, not local Construct HTML5 exports. Pushes to `main` trigger the GitHub Actions build and deployment to [GitHub Pages](https://anrans.github.io/construct3-minigame-adapter/).

## Upstream sources

The addon structure follows the official [Scirra/Construct-Addon-SDK single-global plugin example](https://github.com/Scirra/Construct-Addon-SDK/tree/a34e41a246fdbb03ac719597d528d7a5e5de0b02/plugin-sdk/singleGlobalPlugin), pinned to commit `a34e41a246fdbb03ac719597d528d7a5e5de0b02`. The three JSON schemas in `addon/schemas/` are unchanged files from that version, used only for development validation and excluded from `.c3addon`. Their rights and license belong to the original authors; this project does not relicense them.

The runtime uses core-js-pure 3.49.0's URL/URLSearchParams implementations when native support is missing, distributed under MIT. Full notices are in [Third-party notices](docs/THIRD_PARTY_NOTICES.md). User-generated Construct HTML5 exports contain Construct engine code, which the public repository and site do not redistribute. Applicable rights and terms remain with the respective owners; this project does not grant a new license for that code.

References: [Construct Addon SDK](https://www.construct.net/en/make-games/manuals/addon-sdk), [publishing projects](https://www.construct.net/en/make-games/manuals/construct-3/overview/publishing-projects). Handwritten test fixtures and smoke examples contain neither the Construct engine nor third-party game assets.
