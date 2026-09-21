# Construct 3 微信 / 抖音 / TikTok 小游戏适配工具

[English](README.md) | 简体中文

[使用文档网站](https://anrans.github.io/construct3-minigame-adapter/) · [图文使用指南](https://anrans.github.io/construct3-minigame-adapter/guide/) · [GitHub 仓库](https://github.com/anrans/construct3-minigame-adapter)

将 Construct 3 的 HTML5 导出转换为微信、抖音和 TikTok 原生小游戏工程。项目包含 MiniGameBridge 插件、离线转换 CLI 与运行时适配层，可从事件表或 JavaScript 调用平台能力。

**0.3.0 已接入三个独立宿主：`wx`、`tt`、`TTMinis.game`，并提供支付调用、后端订单轮询和服务器 Webhook 验签辅助。** 当前目录有 194 个 API 名称、21 类能力；调用契约与平台差异见 [API 目录](https://anrans.github.io/construct3-minigame-adapter/api/)。TikTok 使用原生 runtime，无需 SDK init，也不会映射到抖音 `tt`。

新增图片演示前，0.3.0 已通过真实 Construct r495.2 重新导出并完成三端转换。微信 IDE 已观察到 WebGL2、runtime-ready、53 个功能入口及分类/返回导航，新启动为 0 error、2 warning。TikTok iOS 用户截图已显示 57 个入口并进入存储分类，同时报告存储回读失败；fix5 的存储与设备信息修复仍待手机复测。**新版自检与支付入口尚未实测；抖音 / TikTok IDE、三端真机完整功能和真实支付尚未验收。** 微信 IDE 的 Modal 历史 Worker 错误仍未解决，本轮尚未复测；分项结果和历史基线见 [验证记录](docs/VALIDATION.md)，排查见 [在线指南](https://anrans.github.io/construct3-minigame-adapter/troubleshooting/)。

公开仓库提供源码、插件、原创测试夹具及 `.c3p` 示例，**不分发 Construct 引擎的 HTML5 导出或其小游戏构建产物**。克隆后请用 Construct 打开 `MiniGameApiSuite.c3p`、自行导出 HTML5，再运行转换器；完整步骤见下文或[快速开始](https://anrans.github.io/construct3-minigame-adapter/guide/)。本机原始导出与历史证据仍保留。

## 组成与工作方式

| 组件 | 用途 |
| --- | --- |
| `addon/` | SDK v2 单例对象 MiniGameBridge，固定插件 ID 为 `C3MiniGameBridge`，提供事件表动作、条件和表达式 |
| `src/cli.mjs`、`src/build/` | 检查解压后的 HTML5 导出目录，打包本地脚本和资源，生成小游戏入口及配置 |
| `src/runtime/` | 提供 DOM / 加载器的有限兼容能力，以及真实宿主 API 的业务桥接 |
| `examples/construct/` | 真实测试项目 `.c3p` 与项目脚本；HTML5 导出由使用者在本地生成，不随公开仓库分发 |
| `examples/smoke/` | 原生小游戏 API 的最小冒烟示例，不包含 Construct 引擎 |
| `website/` | 文档站内容、API 目录生成器与静态站构建工具 |

本项目的形式是 **Addon + 离线转换器**。公开 Addon SDK 没有提供注册自定义 exporter 的接口；安装本插件不会在 Construct 官方导出菜单中增加微信、抖音或 TikTok 选项。先使用 Construct 的 HTML5 exporter，再运行本项目 CLI 生成小游戏工程。转换器先安装适配层和 `globalThis.C3MiniGameBridge`，再加载游戏入口。插件仅调用这个桥接对象，不把小游戏适配层作为普通 DOM 脚本注入。

## 安装与打包插件

需要 Node.js 22 或更新版本。克隆仓库并在项目目录执行：

```sh
git clone https://github.com/anrans/construct3-minigame-adapter.git
cd construct3-minigame-adapter
npm ci
npm test
npm run build:addon
```

生成的插件文件为 `dist/C3MiniGameBridge.c3addon`。在 Construct 的 Addon manager 中选择安装新插件并选择此文件，按编辑器提示完成安装和重载，然后在项目中添加 **MiniGameBridge** 对象。插件声明的最低 Construct 版本为 r450，使用 SDK v2，关闭 Worker 模式支持。

开发时也可执行 `npm run dev:addon`，按 Construct 的开发插件方式使用 `http://localhost:65432/addon/addon.json`。历史基线工程下载地址为 `http://localhost:65432/MiniGameBridgeTest.c3p`；新版 `MiniGameApiSuite.c3p` 请从本地文件打开。该服务器只监听 `127.0.0.1:65432`，仅提供插件清单中的文件和历史基线工程，允许 `https://editor.construct.net` 跨域读取；按 Ctrl+C 停止。它用于编辑器开发与联调，不属于导出后小游戏的运行依赖。

插件属性：

| 属性 | 配置 |
| --- | --- |
| Platform | `auto`、`douyin`、`wechat` 或 `tiktok`；指定平台必须与实际宿主匹配 |
| Score endpoint | 自己的 HTTPS 成绩服务地址；留空时成绩上报不可用 |

## 在 Construct 中使用

1. 在游戏启动事件中调用 **Init**。
2. 在 **On ready** 后调用通用 **Call API**、**Read synchronous API**，或 Login、Show rewarded video 等专用动作。
3. 用 **On error** 读取 `LastErrorCode`、`LastError`、`LastOperation`，处理失败。
4. 只有 **On ad completed** 才发放激励；**On ad cancelled** 表示视频未完整观看。

| 动作 | 结果条件 | 说明 |
| --- | --- | --- |
| Init | On ready | 检查宿主桥接并应用插件属性 |
| Login | On login succeeded | 获取平台临时登录 code；`LastLoginCode` 仅保存在内存 |
| Show rewarded video | On ad completed / On ad cancelled | 需要该平台实际分配的广告位 ID |
| Report score | On score reported | 向配置的 HTTPS 服务提交成绩和可选榜单 ID |
| Vibrate | On vibration completed | `short` 或 `long`，调用宿主振动能力 |
| Call API | On API succeeded(tag) | API 名称、options JSON 对象、tag；等待原生成功回调 |
| Read synchronous API | On API succeeded(tag) | API 名称、位置参数 JSON 数组、tag；返回原生同步结果 |
| Subscribe / Unsubscribe to API event | On API event(tag) / On API succeeded(tag) | 按事件名和 tag 管理本实例订阅；按目录的原生 on/off 或本地停用契约处理 |

所有失败均触发 **On error**。通用动作结果可读 `LastAPIName`、`LastAPITag`、`LastResultJSON`，事件可读 `LastEventJSON`；非 JSON 数据使用 JavaScript 原值，表达式不会把二进制或原生对象伪装成空 JSON。**Supports API(name)** 和 `CapabilitiesJSON` 可查询目录与当前宿主的方法可用性；可用不表示已经授权、配置完成或业务成功。条件 **Is ready** 可检查初始化状态，表达式 **Platform** 返回平台。动作支持 Construct 的 “Wait for previous actions to complete”。普通浏览器预览没有小游戏桥接时会明确返回 `UNSUPPORTED`，不会模拟登录或广告成功。

登录 code 需要交给自己的服务端换取身份；插件不自动上传 code，也不会把它加入成绩请求或 Construct 存档。成绩上报是自定义后端请求，不是微信 / 抖音内置排行榜。平台 AppSecret 应留在服务端；实际请求还需配置平台允许的域名。

也可从 Construct 运行时脚本调用插件实例：

```js
const bridge = runtime.objects.MiniGameBridge.getFirstInstance();

try {
  await bridge.init();
  const result = await bridge.login();
  // 按项目需求处理 result；不要把登录 code 写入公开日志。
} catch (error) {
  console.error(bridge.getLastOperation(), bridge.getLastError());
}
```

如果重命名了项目中的对象，需要相应修改 `runtime.objects` 下的名称。JavaScript 方法也触发事件条件，但失败会 reject，调用方须捕获。更多方法和适配层接口见 [插件说明](addon/README.md)。

通用 JavaScript 接口为 `callAPI(name, options, control)`、`getAPISync(name, ...args)`、`createAPIObject(name, options)`、`onAPIEvent(name, callback)`、`supportsAPI(name)` 和 `getCapabilities()`。它们只接受目录中的名称；原生方法及目录显式登记的备用方法均不可用时报 `UNSUPPORTED`，调用种类错误时报 `WRONG_API_KIND`。原生对象由调用方按平台文档 `close` / `destroy` 并移除对象上的监听。`onAPIEvent` 返回幂等的取消订阅函数；插件释放时只清理自己的订阅。

普通异步 API 默认等待最多 30 秒，Modal、授权、扫码、选图等交互 API 默认不设置超时；JavaScript 可显式传 `control.timeoutMs`。取消等待仅在原生任务提供 `abort()` 时同时取消任务，不能据此认为平台弹窗已经关闭。微信 `shareAppMessage` 是无完成回调的同步调用，返回不代表分享成功；抖音同名接口按原生回调处理。详见 [调用语义与完整目录](docs/API-COVERAGE.md)。

## 转换 HTML5 导出

0.2.0 功能演示已完成本机真实编辑器导出、两端构建以及微信 IDE 渲染和自检验证；新增图片演示前的 0.3.0 已在真实 Construct r495.2 重新导出，并从同一份 HTML5 成功生成微信、抖音、TikTok 三端产物；当时微信 IDE 已验证启动、53 个入口与分类/返回导航，自检和支付入口尚未复测；历史文件记录和分项验证状态以 [导出证据](docs/EXPORT-EVIDENCE.json) 及 [验证记录](docs/VALIDATION.md) 为准。公开仓库与本地导出的分工如下：

- `examples/construct/MiniGameApiSuite.c3p`：公开提供的新版分类式 API 功能演示工程。
- `MiniGameApiSuite-html5.zip`：请通过自己的 Construct 编辑器导出，公开仓库不包含此 ZIP。
- `examples/construct/api-demo-html5/`：将自己的 HTML5 ZIP 解压到此目录；这是 `export:*` 命令的默认输入，克隆仓库后不会自动具备引擎文件。

此前 21 项 `WeChatApiDemo`、更早的 `MiniGameBridgeTest` 及其 HTML5 导出仍在本机保留为历史验证基线。公开仓库仅分发相应 `.c3p` 和自写项目代码，不包含历史 HTML5 ZIP、解压目录或包含引擎的转换产物。历史工程不是当前 `export:*` 命令的默认输入。修改 demo 时，应在 Construct 工程中修改并重新导出，保留原始导出文件不变；运行适配补丁由转换器应用。

在 Construct 中打开 `MiniGameApiSuite.c3p`，选择 **Export → HTML5**；初次验证建议关闭脚本压缩与离线支持。将 ZIP 解压到 `examples/construct/api-demo-html5/`，确认该目录下直接包含 `index.html`、`scripts/` 和其他导出资源，再执行：

```sh
npm run inspect -- --input examples/construct/api-demo-html5
npm run export:wechat -- --appid 你的微信AppID
npm run export:douyin -- --appid 你的抖音AppID
npm run export:tiktok -- --appid 你的TikTokAppID
```

三个 `export:*` 脚本默认读取你刚刚生成的 `examples/construct/api-demo-html5/`，包含 `--experimental --overwrite`，分别重建 `dist/construct-wechat`、`dist/construct-douyin` 和 `dist/construct-tiktok`；只有带本工具标记的旧产物可覆盖。它们不重新操作 Construct 编辑器，而是转换当前保存的 HTML5 导出。首次构建或跨平台重建省略 `--appid` 时配置留空；同平台且旧输出标记有效的 `--overwrite` 会保留原 AppID。显式传入 `--appid` 会覆盖原值，空字符串也会清空。请使用自己的有效小游戏 AppID。

macOS 也可双击 `build-wechat.command` 或 `build-douyin.command`，按提示输入自己的 AppID；它们使用同一份 `api-demo-html5` 默认输入。两个脚本会先检查 Node.js 和本地依赖；缺少 `node_modules` 时只提示在项目目录执行 `npm ci`，不会自动安装依赖或修改系统配置。构建完成后，将提示的目录导入对应小游戏 IDE。

`MiniGameApiSuite` 使用 Construct Text 对象绘制控件，图片演示由真实 Sprite 对象渲染。当前源码包含新增的图片渲染分类，**微信 / 抖音为 54 个入口、13 类，TikTok 为 58 个入口、14 类**；新增支付入口仅检查能力与流程，不执行真实付款，0.3.0 已在微信 IDE 显示 53 个入口并验证分类/返回导航，但未逐项点击新增功能或运行新版自检。历史 0.2.0 为 51 个入口、11 类，微信 IDE 当时已实际完成 17 项自检，结果为 17 成功、0 失败、0 跳过。自检覆盖常用信息、网络类型、专用存储键与临时文件读写清理、包内 fetch / XHR、电量、亮度和时钟，不主动申请权限、分享或连接外网。平台不支持或调用失败时保留实际结果。登录依赖真实平台环境；激励视频、HTTPS 请求及 WebSocket 测试需要分别配置真实广告位、服务地址和平台域名，未配置时不会发起对应调用。分项验收以验证记录为准。

### 图片渲染演示

打开最新的 [MiniGameApiSuite.c3p](examples/construct/MiniGameApiSuite.c3p)，在 Construct 中导出 HTML5 并按上文转换。运行演示后，进入 **图片渲染** 分类，点击 **加载 / 隐藏测试图片**。按钮会加载包内的 [render-test.png](examples/construct/assets/render-test.png)，在按钮下方按原始比例显示，并报告解码后的图片尺寸。再次点击可隐藏图片并销毁演示 Sprite 实例，返回分类菜单也会执行相同清理。

图片通过 `runtime.assets.fetchBlob()` 读取，由名为 `RenderTestSprite` 的 Construct 内置 Sprite 对象调用 `replaceCurrentAnimationFrame()` 后渲染，用于检查 Construct 的资源加载与 Sprite 渲染路径。**新增图片测试尚未完成真机验证**；此前 53 / 57 个入口的实测记录不包含这一项。

维护演示时，修改 `examples/construct/api-demo-main.js` 或替换 `examples/construct/assets/render-test.png`，再将它们同步到可编辑源工程：

```sh
node scripts/update-construct-demo.mjs
```

此命令只更新 `examples/construct/MiniGameApiSuite.c3p`，不会导出 HTML5，也不会更新已有小游戏产物。必须在 Construct 中重新打开更新后的 `.c3p`，再次导出 HTML5、解压新导出，再运行对应平台转换器后测试。仓库中的工程已包含所需的 `RenderTestSprite` 对象。

处理自己的工程时，完整流程如下。

先从 Construct 导出 HTML5 工程并解压，例如放在 `exports/my-game/`，保留入口和资源的相对目录结构。初次验证建议使用最小项目和未压缩导出，便于定位引擎兼容问题。CLI 的输入是解压目录，不是 `.c3p` 项目文件或 ZIP 文件。

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

检测到 Construct 导出时必须显式加 `--experimental`。结构检查通过只表示可以进入构建；打包成功也不代表游戏成功启动。

| 参数 | 说明 |
| --- | --- |
| `--appid` | 指定自己的 AppID；首次 / 跨平台省略时留空，同平台有效 `--overwrite` 省略时继承旧值，显式空字符串清空 |
| `--orientation portrait\|landscape` | 屏幕方向，默认 `portrait` |
| `--entry` | 直接指定本地 JS 相对入口，不读取 `index.html`；不改变引擎兼容能力 |
| `--overwrite` | 重建本工具已生成且保留标记文件的目录；不会覆盖无标记的现有目录 |
| `--json` | 输出机器可读检查或构建报告 |

同样可以使用 `npm run inspect -- --input ...` 或 `npm run convert -- ...`。完整帮助为 `node src/cli.mjs --help`。

每个输出目录包含：

```text
game.js                    小游戏启动入口和打包代码
game/                      游戏资源
game.json                  小游戏配置
project.config.json        开发者工具配置
BUILD-REPORT.json          特征检查、补丁记录和待验证事项
.c3-minigame-output.json   本工具生成目录的标记
README.txt                 导入提示
```

将微信 / 抖音输出目录作为**小游戏工程**导入相应开发者工具；TikTok 输出按官方 Native Mini Games 工作流使用，使用各自的真实 AppID，并阅读 `BUILD-REPORT.json`。本工具不会登录开发者平台、上传或发布项目，也不自动处理分包、广告申请或后端部署。当前报告固定标记 `deviceVerified: false`，完成真机验证后需另行记录实测证据。

同平台有效 `--overwrite` 还会保留旧 `libVersion` 和合法的 `project.private.config.json`，其他 `project.config.json` 字段重新生成。配置、标记或用于确认旧平台的报告为符号链接、非普通文件或非法 JSON 时，构建会拒绝并保留旧输出；无法确认旧平台时不继承配置。 `BUILD-REPORT.json` 的 `preservedLocalConfig` 仅列出实际保留的字段名，不记录 AppID 值。

输出与输入不能重叠；输入中的符号链接、指向导出目录外的模块和未打包的裸包依赖会被拒绝。构建先写临时目录，编译失败时保留原有产物。

## TikTok Native 与 IAP

TikTok 使用 `TTMinis.game`，与微信 `wx`、抖音 `tt` 独立；插件平台 enum 保留原有顺序，TikTok 追加为索引 3。插件 Init 初始化本项目桥接，不调用 `TTMinis.game.init()`，也不加载 HTML runtime SDK。官方原生契约见 [Mini Games SDK Overview](https://developers.tiktok.com/docs/en/mini-games-sdk-overview)。

```sh
node src/cli.mjs convert \
  --input ./exports/my-game \
  --output ./dist/my-game-tiktok \
  --platform tiktok \
  --appid YOUR_TIKTOK_APP_ID \
  --experimental
```

支付使用现有 Call API / `callAPI("pay", {trade_order_id})`，或运行时辅助 `globalThis.C3MiniGameBridge.pay()`；后者成功仅返回 `clientStatus: "completed"`、`fulfillment: "unconfirmed"`。自己的后端需要创建订单、处理 Webhook 验签与幂等发货，客户端只查询自己的已鉴权订单接口。轮询超时保持 pending，取消/失败后的新购买需重新创建订单。详见 [TikTok IAP 接入](docs/TIKTOK-IAP.md)。

`src/runtime/payment.js` 提供 `pollPaymentOrder`，`src/server/tiktok-webhook.mjs` 提供服务器验签辅助；本项目没有订单数据库或自动发货服务。TikTok 已有用户截图提供页面显示与分类导航证据；TikTok IDE、真机完整功能和真实支付仍待验收。微信两个支付接口也按其原生参数调用，不能复用 TikTok 订单参数。

## 当前兼容边界

| 能力 | 当前范围与限制 |
| --- | --- |
| DOM / CSS | 仅提供启动和资源加载需要的有限 DOM 接口；不实现完整浏览器布局、表单或任意 HTML 插件 |
| 渲染与输入 | 使用宿主真实 Canvas / WebGL 和触摸能力；历史 0.2.0 的 51 个功能入口页面已在微信 IDE 的 iPhone 12、iPad Pro 12.9 模拟器配置中通过完整重开后的 WebGL2 渲染验证；历史演示已有连续拖动滚动和点击实测，0.2.0 已完成 Toast、操作菜单、Loading、键盘输入/完成、音频停止/结束等交互验收；最新滚轮输入与真机多点触摸仍未实测。任意着色器、第三方插件及真机表现仍需另验，未实现 WebGPU |
| Worker | 关闭已识别的 Construct 主 Worker 配置；内部任务 Worker 使用同线程异步兼容实现，没有多线程加速、隔离或 transferable 分离语义 |
| 模块与脚本 | 仅打包本地代码；拒绝远程可执行脚本、import map 和一般 HTML 内联脚本；仅跳过 AST 完整匹配的 Construct `file:` 打开提示。classic 脚本的共享顶层声明仍拒绝，共享对象需显式使用 `globalThis` 或 ES module |
| 存储 | `localStorage` 与已识别的 Construct `runtime.storage` / localforage 路径接入真实平台存储；支持 JSON 数据、Date 和二进制视图，不支持循环引用、函数、Map / Set / Blob；不模拟 IndexedDB，不将存储失败静默改为内存成功；跳过已识别的浏览器 Service Worker 启动脚本 |
| fetch / XHR | 提供包内资源、数据 URL 读取及平台请求；修复 XHR 重复发送、请求替换、超时、取消和事件重入时的旧响应污染；HTTP 4xx/5xx 保留实际状态。无响应流、同步 XHR、完整 cookie / credentials 管理或 `overrideMimeType` |
| WebSocket | 新增基于独立原生 SocketTask 的 WebSocket 接口桥接；等待真实 onOpen，支持文本 / ArrayBuffer / 视图 / Blob、有序发送、binaryType 与关闭事件。仍受平台域名、TLS 和连接限制；不替代真实服务端、IDE或真机验收 |
| 音频 | Audio 桥接真实 `createInnerAudioContext`；play 等待原生播放事件，暂停、换源、销毁正确结束等待，修复静音音量恢复与清理异常；只有宿主提供 `createWebAudioContext` 才暴露 AudioContext。不是完整浏览器音频实现，解码器、效果链和显式 sampleRate 等路径有局限 |
| WASM | 使用真实原生接口；微信平台桥接只接受包内 WASM 路径或与已登记包内文件完全匹配的字节，不支持任意下载或动态生成的 WASM 代码，完整引擎解码路径仍需实测 |
| Blob / URL | 提供真实字节存储、UTF-8、Blob URL 到原生临时图片文件的转换，缺少原生 URL 时使用 core-js-pure；并非所有浏览器 Blob URL 消费接口均已实现 |
| 平台 API | 三平台显式目录涵盖信息、生命周期、UI、键盘、网络、存储、设备、媒体、登录设置、分享、广告和开放数据等；按平台分类并探测方法。业务参数、权限、广告位、服务端、开放数据域配置仍由项目提供；支付调用不确认发货，需自己的后端验签、核单与幂等发货 |

`GameGlobal.__C3MiniGameLoaded` 只表示已调度的入口脚本加载完成。`GameGlobal.__C3MiniGameScope.__C3MiniGameReady` 等待 Construct 实际 `runtime-ready` 消息处理成功；它也不代替首帧、持续渲染及各业务功能的验收。检查报告是静态启发式检查，无法枚举第三方插件和运行时代码的所有能力需求。

## 开发检查与原生 API 冒烟

```sh
npm test            # 自动化回归；不要求公开仓库包含 Construct 引擎
npm run build:demo   # 生成 dist/wechat、dist/douyin、dist/tiktok 原生 API 冒烟工程
npm run verify       # 自动化测试、插件打包与冒烟工程构建
```

将冒烟工程导入对应小游戏 IDE，可单独检查适配层和原生 API。它们是手写最小示例，不能替代真实 Construct 导出验证。`npm run build` 打包插件并重建三个平台的冒烟目录；macOS 可双击 `run-verification.command` 执行测试与构建。真实 Construct 导出使用 `dist/construct-wechat` / `dist/construct-douyin` / `dist/construct-tiktok`；自己的游戏可使用前文的 `dist/my-game-wechat` 等独立目录。

0.3.0 发布基线为 **255 项通过、0 项失败**，真实 HTML5 导出已完成三端转换。图片 demo 更新后，本地回归为 **324 项通过、0 失败、0 跳过**；更新后的源工程仍需重新完成 Construct 导出和平台画面验收。2026-09-21 的 fix5 本地回归为 **318 项通过、0 项失败、0 项跳过**，真实 Construct 导出重新转换和语法检查通过；手机存储与设备读数仍待复测，详见 [验证记录](docs/VALIDATION.md)。公开 CI 缺少本地引擎文件时会明确跳过该附加检查，结果以 GitHub Actions 为准；新增图片演示前的微信 IDE 记录已验证启动、渲染和分类/返回导航，未运行新版 17 项自检或点击支付测试入口；不沿用历史版本结果。

原生存储补丁另有原创协议夹具，公开 CI 可执行该路径的回归。依赖本地真实 Construct 引擎文件的测试在文件缺失时明确跳过；这不是引擎验证通过，也不影响保留的 0.2.0 实测记录。该项附加检查读取 `examples/construct/html5/scripts/c3runtime.js`；需要时，可将历史基线 `MiniGameBridgeTest.c3p` 的本地 HTML5 导出解压到 `examples/construct/html5/`。

## 文档站维护

中文使用文档位于 `website/content/`，包含快速开始、插件接入、问题排查和验证范围；TikTok 支付页直接使用 `docs/TIKTOK-IAP.md`。API 目录从运行时源码生成，修改接口时应更新源码目录并重新构建网站，避免手写目录与实现不一致。

```sh
npm run build:addon  # 生成站点提供下载的插件包
npm run docs:build   # 构建静态文档、API 目录与下载文件
npm run docs:check   # 检查站点链接和生成结果
npm run docs:dev     # 启动本地文档预览，访问终端显示的地址
```

页面构建只发布适配器文档、插件包和 `.c3p` 示例，不发布本机的 Construct HTML5 导出。推送到 `main` 后，GitHub Actions 自动构建并部署 GitHub Pages：[在线文档](https://anrans.github.io/construct3-minigame-adapter/)。

## 上游来源

插件结构参考官方 [Scirra/Construct-Addon-SDK](https://github.com/Scirra/Construct-Addon-SDK/tree/a34e41a246fdbb03ac719597d528d7a5e5de0b02/plugin-sdk/singleGlobalPlugin)，固定参考提交为 `a34e41a246fdbb03ac719597d528d7a5e5de0b02`。`addon/schemas/` 下三份 JSON Schema 来自同一官方版本，保持原样，仅用于开发验证，不包含在 `.c3addon` 中；上游文件的权利和许可归其原作者，本项目未另行声明其许可。

运行时使用 `core-js-pure` 3.49.0 的 URL / URLSearchParams 实现作为缺失原生能力时的兼容实现，按 MIT 许可分发，完整版权与许可文本见 [第三方声明](docs/THIRD_PARTY_NOTICES.md)。使用者自行生成的 Construct HTML5 导出包含 Construct 引擎代码，公开仓库和文档站不分发这些引擎导出；其权利和适用条款归相应权利方，本项目不为其重新授予许可。

参考文档：[Construct Addon SDK](https://www.construct.net/en/make-games/manuals/addon-sdk)、[发布项目](https://www.construct.net/en/make-games/manuals/construct-3/overview/publishing-projects)。本仓库的手写测试夹具与烟雾示例不包含 Construct 引擎或第三方游戏素材。
