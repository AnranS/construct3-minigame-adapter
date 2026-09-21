# From Construct to a mini-game

Convert Construct 3 HTML5 exports into native WeChat, Douyin, or TikTok mini-game projects, and call platform APIs through the MiniGameBridge addon. Running the sample before integrating your own game usually makes it easier to separate project issues from platform compatibility issues.

The current version is **{{VERSION}}**. This is a **Construct addon + offline converter + runtime adapter**. Installing the addon does not add “WeChat Mini Games,” “Douyin Mini Games,” or “TikTok” to Construct's export menu. The workflow is always **install the addon → export HTML5 from Construct → convert with the CLI → test in the mini-game IDE**. See the [validation records](../validation/) for the full acceptance scope.

## 1. Prepare your environment

You will need these tools:

| Tool | Purpose |
| --- | --- |
| Node.js 22 or newer | Install dependencies, package the addon, and run the converter |
| Construct 3 | Edit projects and export HTML5; the addon declares r450 as its minimum version, and the recorded editor tests used r495.2 |
| WeChat DevTools / Douyin DevTools / TikTok's official development workflow | Debug the output for each platform; TikTok targets the Native runtime |
| Your own mini-game AppID | Configure each platform project and test account, advertising, and other business features |

You can download the [MiniGameBridge addon package]({{ASSET_BASE}}downloads/C3MiniGameBridge.c3addon) and [MiniGameApiSuite sample project]({{ASSET_BASE}}downloads/MiniGameApiSuite.c3p) directly. HTML5 conversion still requires this project's CLI. Download or clone the source, then run these commands from the project root:

```sh
git clone https://github.com/AnranS/construct3-minigame-adapter.git
cd construct3-minigame-adapter
npm ci
npm run build:addon
```

This generates `dist/C3MiniGameBridge.c3addon`. `npm ci` installs the dependency versions pinned by the repository; rerun it after updating the source or lockfile.

## 2. Install the addon

Install `dist/C3MiniGameBridge.c3addon` through Construct's **Addon manager**, then reload when the editor asks you to. Add a **MiniGameBridge** object to the project.

<figure class="doc-screenshot">
  <a href="{{ASSET_BASE}}assets/screenshots/construct-addon-manager.jpg"><img style="width:890px" src="{{ASSET_BASE}}assets/screenshots/construct-addon-manager.jpg" alt="Construct Addon manager showing MiniGameBridge 0.3.0.0 and the Install new addon button at the bottom" loading="lazy" width="890" height="540"></a>
  <figcaption>Click Install new addon… to install the package, then search for MiniGame to confirm the version. This screenshot uses developer-addon mode, so Source shows Developer; installation from a .c3addon may show a different source. Click the image to view the original.</figcaption>
</figure>

| Addon property | Configuration |
| --- | --- |
| Platform | Usually leave Auto-detect selected. You can also choose WeChat, Douyin, or TikTok explicitly; the value must match the actual native host |
| Score endpoint | Enter your own HTTPS service only when using custom score reporting; otherwise leave it blank |

<figure class="doc-screenshot">
  <a href="{{ASSET_BASE}}assets/screenshots/construct-plugin-properties.jpg"><img style="width:360px" src="{{ASSET_BASE}}assets/screenshots/construct-plugin-properties.jpg" alt="MiniGameBridge properties with Platform set to Auto-detect and Score endpoint blank" loading="lazy" width="360" height="290"></a>
  <figcaption>Select the MiniGameBridge object in your project to configure its properties. Auto-detect usually lets you convert the same project to different platforms.</figcaption>
</figure>

Create a minimal initialization flow in the event sheet:

```text
System → On start of layout
  MiniGameBridge → Init

MiniGameBridge → On ready
  MiniGameBridge → Get network type, tag = "network"

MiniGameBridge → On API succeeded("network")
  Text → Set text to MiniGameBridge.LastResultJSON

MiniGameBridge → On error
  Text → Set text to MiniGameBridge.LastErrorCode
```

In an ordinary browser preview without the mini-game host bridge, platform calls return `UNSUPPORTED`. Test platform APIs in the converted mini-game project. See [addon integration](../addon/) for event sheets, result expressions, and JavaScript usage.

## 3. Run the feature demo first

The current feature demo is `examples/construct/MiniGameApiSuite.c3p`, which you can open in Construct. Its controls use real Construct Text objects. The current source has **54 feature entries** for WeChat/Douyin and **58 entries** for TikTok; payment entries only check availability and workflow, without making a payment. The new “图片渲染” (Image rendering) category uses a Construct Sprite to load the packaged PNG asset `render-test.png`, testing image loading and texture display; it is not an HTML overlay. To test this category, open the latest `.c3p` in Construct and export HTML5 again. Older HTML5 exports do not include it. The new category still needs a fresh export from the real editor and platform runtime validation; the homepage asset is not a platform screenshot. Version 0.3.0 was exported again from the real Construct r495.2 editor and converted for all three targets. WeChat IDE displayed 53 entries and verified category/back navigation, but did not run the new self-checks or click the payment test entries. The historical 0.2.0 demo had 51 entries, 11 categories, and 17 self-checks; see the [validation records](../validation/).

The public repository provides the `.c3p` project and adapter source, but not original HTML5 exports or ZIPs containing the Construct engine. Open this project in Construct and choose **Export → HTML5**. For initial validation, disable script minification and offline support. The “Export your own Construct project” section below shows screenshots of the same export workflow.

Extract the exported ZIP into `examples/construct/api-demo-html5/`, with `index.html` and `scripts/` directly inside that directory, then run:

```sh
npm run inspect -- --input examples/construct/api-demo-html5
npm run export:wechat -- --appid YOUR_WECHAT_APP_ID
npm run export:douyin -- --appid YOUR_DOUYIN_APP_ID
npm run export:tiktok -- --appid YOUR_TIKTOK_APP_ID
```

Replace the uppercase placeholders with your own platform AppIDs. The outputs are:

```text
dist/construct-wechat/
dist/construct-douyin/
dist/construct-tiktok/
```

These convenience commands convert only the HTML5 files you just extracted. They do not operate the Construct editor or export the `.c3p` again. After cloning the repository, you must first complete the editor export and extraction steps above. The commands include `--experimental --overwrite` and rebuild previous outputs carrying this tool's marker. Omitting `--appid` on a first or cross-platform build leaves the AppID blank. A same-platform `--overwrite` with a valid output marker preserves the previous AppID. An explicit new value replaces it, and an explicit empty string clears it.

On macOS, you can also double-click `build-wechat.command` or `build-douyin.command` in the repository and enter your AppID when prompted. They read the same sample export and ask you to run `npm ci` first if dependencies are missing.

## 4. Export your own Construct project

Save your project in Construct, then choose **Export → HTML5**. For initial integration, disable script minification and offline support, and use a small project to establish a working baseline. The recorded sample uses an unminified HTML5 export.

<figure class="doc-screenshot">
  <a href="{{ASSET_BASE}}assets/screenshots/construct-html5-export.jpg"><img style="width:590px" src="{{ASSET_BASE}}assets/screenshots/construct-html5-export.jpg" alt="Construct export platform dialog with Web (HTML5) selected and a Next button at the lower right" loading="lazy" width="590" height="522"></a>
  <figcaption>① Open Menu → Project → Export, select Web (HTML5), and click Next. Mini-game conversion happens later in the CLI step.</figcaption>
</figure>

<figure class="doc-screenshot">
  <a href="{{ASSET_BASE}}assets/screenshots/construct-export-options.jpg"><img style="width:430px" src="{{ASSET_BASE}}assets/screenshots/construct-export-options.jpg" alt="Construct export options with Minify mode set to None and Offline support unchecked" loading="lazy" width="430" height="430"></a>
  <figcaption>② Scroll down in Export options, set Minify mode to None, and uncheck Offline support. Click Next to continue the export.</figcaption>
</figure>

<figure class="doc-screenshot">
  <a href="{{ASSET_BASE}}assets/screenshots/construct-export-finished.jpg"><img style="width:570px" src="{{ASSET_BASE}}assets/screenshots/construct-export-finished.jpg" alt="Construct showing Export finished and a Download MiniGameApiSuite.zip link" loading="lazy" width="570" height="568"></a>
  <figcaption>③ Once Export finished appears, click Download to save the HTML5 ZIP. This completes the HTML5 export; extraction and conversion are still required.</figcaption>
</figure>

Extract the exported ZIP into a separate project directory, for example:

```text
exports/my-game/
  index.html
  scripts/
  ...other exported resources
```

Preserve every file's relative path. The CLI accepts this **extracted directory**, not a `.c3p` or ZIP file. After changing your game in Construct, export it again and update the input directory.

Inspect first, then convert:

```sh
node src/cli.mjs inspect --input ./exports/my-game

node src/cli.mjs convert \
  --input ./exports/my-game \
  --output ./dist/my-game-wechat \
  --platform wechat \
  --appid YOUR_WECHAT_APP_ID \
  --experimental

node src/cli.mjs convert \
  --input ./exports/my-game \
  --output ./dist/my-game-douyin \
  --platform douyin \
  --appid YOUR_DOUYIN_APP_ID \
  --experimental
```

A detected Construct export requires `--experimental`. The flag acknowledges that engine compatibility still needs validation for each project and on real devices; it does not bypass structural checks.

## 5. Import into the mini-game IDE

Import the output directory as a **mini-game project** in the appropriate developer tools. Select the directory containing `game.js`, `game.json`, and `project.config.json`, not the HTML5 input directory.

```text
dist/my-game-wechat/
  game.js                    Mini-game entry point
  game/                      Game resources
  game.json                  Mini-game configuration
  project.config.json        IDE project configuration
  BUILD-REPORT.json          Findings, applied patches, and remaining checks
  .c3-minigame-output.json    Generated-output marker
  README.txt                 Import instructions
```

Confirm that you are using your own valid mini-game AppID and the mini-game project type, then compile. A blank AppID may cause the IDE to select the wrong compilation type. Pass `--appid` when converting, and fully reopen the project after changing it. Check the actual first frame, touch response, and this console message:

```text
[C3 MiniGame] Construct runtime-ready
```

This message means Construct's readiness protocol completed. Continue testing rendering, resources, audio, and your game logic. `__C3MiniGameLoaded` means only that entry scripts finished loading; it does not establish engine readiness.

WeChat IDE has recorded tests for sample startup, rendering, self-checks, and some interactions. Douyin IDE acceptance is still pending, and the new TikTok target has not completed IDE, device, or real-payment validation. TikTok uses its official Native Mini Games workflow, rather than WeChat or Douyin IDE. For errors, use [troubleshooting](../troubleshooting/) to check the actual base-library version and runtime stage.

## Common CLI options

| Option | Purpose |
| --- | --- |
| `--input` | Extracted export directory |
| `--output` | Separate output directory; it must not overlap the input |
| `--platform wechat` / `douyin` / `tiktok` | Select the target host |
| `--appid` | Omitted on a first/cross-platform build means blank; a valid same-platform overwrite preserves the old value; an explicit new value or empty string replaces it |
| `--orientation portrait` / `landscape` | Screen orientation; defaults to portrait |
| `--experimental` | Required for Construct export conversion |
| `--overwrite` | Rebuild an old output carrying this tool's marker; does not overwrite arbitrary directories |
| `--entry` | Local JS entry point relative to the input directory; skips entry discovery in `index.html` |
| `--json` | Output a JSON inspection or build report |

A valid same-platform overwrite also preserves the previous `libVersion` and a valid regular `project.private.config.json` file. Other `project.config.json` fields are regenerated from the current options. The converter handles malformed JSON, symlinks, or an unidentifiable previous platform conservatively and does not inherit configuration from untrusted paths. `preservedLocalConfig` in `BUILD-REPORT.json` lists only the names of fields actually preserved, without recording AppID values.

Full help:

```sh
node src/cli.mjs --help
```

## Integrate more platform APIs

The adapter has an explicit catalog of **{{API_COUNT}} unique API names across {{CATEGORY_COUNT}} categories**, covering asynchronous calls, synchronous calls, native objects, and event subscriptions. Check the current host with `supportsAPI` or `getCapabilities`, then use the invocation kind defined by the catalog. See the [API catalog](../api/) and [addon integration](../addon/).

<figure class="doc-screenshot">
  <a href="{{ASSET_BASE}}assets/screenshots/api-platform-filter.jpg"><img style="width:850px" src="{{ASSET_BASE}}assets/screenshots/api-platform-filter.jpg" alt="API catalog filtered to TikTok and Payments, showing checkBalance, pay, navigateToBalance, and platform differences" loading="lazy" width="850" height="762"></a>
  <figcaption>Filter the catalog by platform and capability, then check the invocation kind, parameters, and platform differences. This screenshot shows TikTok's payment category; inclusion in the catalog does not mean device or payment acceptance testing is complete.</figcaption>
</figure>

Account login requires your backend to exchange temporary codes. Network requests need your own service and the platform's domain configuration. Ads require real ad unit IDs and access approval. If the sample has no ad unit, HTTPS URL, or WebSocket URL configured, it reports the missing configuration and skips the corresponding call.

The converter keeps `deviceVerified: false` in `BUILD-REPORT.json`. Record your own device results separately after testing. The tool does not sign in to developer platforms, upload, or publish your game.

## TikTok native target

TikTok's native namespace is `TTMinis.game`, separate from Douyin's `tt`. With TikTok or Auto-detect selected, still follow the addon's **Init → On ready** flow. This configures this project's bridge; it does not call native `TTMinis.game.init()`. TikTok's official native runtime needs no SDK initialization. HTML-runtime script loading and `clientKey` initialization do not apply to this conversion target. See the [official SDK overview](https://developers.tiktok.com/docs/en/mini-games-sdk-overview).

For your own game, use this conversion command:

```sh
node src/cli.mjs convert \
  --input ./exports/my-game \
  --output ./dist/my-game-tiktok \
  --platform tiktok \
  --appid YOUR_TIKTOK_APP_ID \
  --experimental
```

Use the output through TikTok's official native-game development and submission workflow. This project does not treat WeChat or Douyin IDE configuration as TikTok configuration. Before calling an API, check the separate TikTok column in the [API catalog](../api/); the same name does not guarantee identical parameters or callbacks. For IAP, continue to [TikTok payment integration](../tiktok-iap/). A client completion callback is not proof that an order should be fulfilled.
