# 验证记录

更新日期：2026-09-21。当前版本：0.3.0，工程：`MiniGameApiSuite`。0.3.0 的导出与构建证据单独记录，0.2.0 的 IDE 实测保留为历史基线。此文件分别记录源码测试、编辑器安装、真实游戏导出和目标平台运行，避免把其中一项当成其他项的证据。

## 0.3.0 当前验证

0.3.0 已在真实 Construct r495.2 编辑器重新完成 HTML5 导出，并从同一份原始导出成功转换微信、抖音、TikTok 三个平台。本轮微信 IDE 已验证启动、渲染与分类/返回导航；尚未运行新版 17 项自检或点击支付测试入口。TikTok iOS 用户后续截图已提供 API 页面显示和进入本地存储分类的证据，同时报告存储回读失败。抖音 / TikTok IDE、三端真机完整功能与真实支付尚未验收，详见后文。

| 层级 | 当前结果 | 范围 |
| --- | --- | --- |
| 自动化回归 | 255 项通过，0 项失败 | 本机 Node / 模拟宿主回归，含本地保留的真实引擎附加检查；不等于平台或支付实测 |
| 真实 Construct 导出 | r495.2 已完成 | `MiniGameApiSuite-html5.zip` 共 28 文件，原样解压到 `examples/construct/api-demo-html5/` |
| 项目脚本一致性 | 完全一致 | 导出的 `scripts/project/main.js` 与 `api-demo-main.js`、`.c3p` 内 `scripts\main.js` 字节一致 |
| 新版插件导出 | 7 个运行时文件全部一致 | `addon/c3runtime/*.js` 与实际导出插件目录逐字节一致，包含 TikTok 枚举和键盘参数修正，证明新版插件进入真实导出 |
| 微信 / 抖音 / TikTok 转换 | 三端构建成功 | 每个输出保留 `build-only-not-device-verified`；TikTok 是原生 `TTMinis.game` 目标 |
| 当前示例内容 | 微信 / 抖音 53 入口、12 类；TikTok 57 入口、13 类 | 支付入口只检测能力和说明流程，不执行真实支付 |
| 微信 IDE 0.3.0 | 启动、渲染与导航通过 | RC 2.02.2607161 / 基础库 3.15.3，iPhone 12/13 Pro 模拟器；WebGL2、runtime-ready、53 个入口，基础信息分类打开及返回成功。新启动 0 error、2 warning |
| 抖音 / TikTok IDE | 未验收 | 构建通过不代表 IDE 首帧或平台 API 已运行 |
| TikTok iOS 真机 | 用户截图提供部分显示与导航证据 | fix4 页面显示 57 个入口，已进入本地存储分类；写入回读失败，不能外推其他 API 已通过 |
| 真机完整功能 / 真实支付 | 尚未验收 | 保留此前 TikTok iOS 启动失败反馈；没有三端真机完整功能或真实交易通过记录 |

`.c3p` 的 `properties.version` 已修正为 `0.3.0.0`，`usedAddons` 中 MiniGameBridge 仍为 `0.3.0.0`；该次修正仅改变项目版本元数据，其他 24 个 ZIP 条目逐字节保持不变，没有修改真实 HTML5 导出内容。原始 ZIP SHA-256 为 `9a00976f65288906b02716175019f5d5c09f3bcff257ec940b34ea44bdbf3f66`，项目脚本 SHA-256 为 `4a215fb1ed3a77c7a2ebc67511735f2111086ca11225037673c7954fd8922c9c`。三端入口与项目文件哈希见 [导出证据](EXPORT-EVIDENCE.json) 中 `releases["0.3.0"]`。

**本轮未运行新版 17 项自检，未点击支付测试入口，也未复测 Modal。** 0.2.0 的自检与交互结果保留在后文，不能继承为 0.3.0 结果。启动日志数字仅对应本轮新启动窗口。首次使用空 AppID 配置导入时曾进入错误的工程编译类型，配置有效的小游戏 AppID 并完整重开后才完成上述运行；导出时请传入自己的 `--appid`，公开文档不记录个人 ID。

新增回归包含 TikTok 原生宿主解析与构建、独立 API 契约、支付面板与发货状态分离、后端订单轮询、服务器 Webhook 验签、微信官方契约修正，以及同平台覆盖时 AppID / 基础库 / 私有配置的保留和损坏输出拒绝。辅助工具不提供真实订单服务或幂等数据库，真实支付链路需要接入自己的后端后另外验收。 本轮三端真实输出重新构建成功，微信输出保留了既有 AppID 和 `libVersion: 3.15.3`，记录仅保留字段名称与存在性，不包含 AppID 值。

## 0.3.0 TikTok 启动监听修复

用户反馈的 TikTok iOS 真机产物在 `installAdapter` 阶段报 `offWindowResize is required to install a disposable adapter`。这是一次失败报告，不代表已通过 TikTok 真机验收；上文 0.3.0 表格保留原发布时的验证基线。

修复让 TikTok 内部启动监听在仅提供 `on...` 时通过共享分发器本地撤销，释放自己的回调并在重装时复用原生监听。有原生 `off...` 的注册会预先记录清理动作，覆盖“已附着监听后再抛错”的回滚。微信 / 抖音原有成对监听要求保持不变，TikTok 公开 API 目录也未扩大。

修复后本机 `npm test` 为 **262 项通过、0 失败、0 跳过**。共享分发器使用独立工厂隔离订阅者闭包，附加 GC 回归确认释放后的页面对象可被回收。新增回归覆盖仅有 on 的窗口变化、触摸、滚轮、前后台及网络事件，释放后无副作用，多适配层互不干扰，重复安装不增加原生监听，注册失败回滚，以及缺失 off 接口时转换产物的启动协议。完整打包启动检查使用原创 Construct 协议夹具；新产物仍需重新执行 TikTok 真机启动与渲染验收。

## 2026-09-21 TikTok iOS 灰屏反馈与 fix2 启动诊断

用户使用 `fix1` 产物复测后，未再报告 `offWindowResize` 异常，但游戏仍停在灰屏。提供的真机截图最后一条游戏相关日志是 Construct 的 `not a secure context` 警告，用户另确认控制台 Error 页为空。这是一次新的失败报告；不能据此认定安全上下文警告就是灰屏原因，也不能把 Error 页为空当作启动成功。

本地源码分析确认：Construct 的 `RuntimeInterface` 构造器会发起异步初始化而不等待其返回 Promise；因此入口脚本的 `__C3MiniGameLoaded` 可以先完成，这条初始化链的后续 rejection 不一定进入原有入口加载错误捕获。这个错误观测缺口已经确认；交付 `fix2` 时，TikTok 真机灰屏的具体失败阶段和根因尚未确认，后续复测结果见下一节。

新产物观察实际初始化过程中的 worker 创建、任务调度器、runtime 创建与初始化、项目数据、Canvas 和 WebGL 阶段，并记录包内资源读取。失败输出 `STARTUP_FAILED`；启动等待超过 15 秒且仍未就绪时输出一次 `STARTUP_WAIT`，包含当前等待阶段及已执行阶段。诊断保留原 Promise、返回值和异常语义；等待提示不终止慢启动，也不生成虚假的 ready。可选资源读取失败只记录阶段，不单独把引擎判为失败；远程业务 URL 不加入诊断日志。

本轮本机 `npm test` 为 **285 项通过、0 失败、0 跳过**，包括打包产物中私有异步初始化失败的回归、可恢复的渲染器重试和就绪消息处理失败。真实 HTML5 输入重新转换后，`scripts/main.js` 中识别并观察了 3 处异步调用；原始导出未改写。该结果验证捕获与诊断路径，不代表已复现或修复用户手机上的具体故障。

**fix2 补足诊断，当时尚未证明灰屏已修复或真机首帧已显示。** 安全上下文警告保持原样，只有 Construct 实际发出并成功处理 `runtime-ready` 才记录就绪，之后仍需观察画面和输入。

复测时换用含启动诊断的新包并完整重新启动，等待至少 15 秒。若仍灰屏，提供 `STARTUP_FAILED` 或 `STARTUP_WAIT` 的完整日志，以及其前后的阶段记录、TikTok 客户端版本和设备信息；如果两种日志都没有出现，也需保留启动日志以确认新包是否执行。不要继续用 `fix1` 判断本轮诊断是否有效。

## 2026-09-21 fix3：原生全局方法接收对象修复

用户使用 `fix2` 在 TikTok iOS 真机再次运行，新增诊断捕获到 `STARTUP_FAILED`，阶段为 `runtime-interface-init`，错误为 `TypeError: Can only call Window.queueMicrotask on instances of Window`。堆栈从原生 `queueMicrotask` 指向 `MessagePort.start` 和 `onmessage` 赋值。本地严格模拟宿主复现了同文异常，验证了错误接收对象可以触发此失败；这并未证明模拟宿主完整还原了手机实际的全局对象。

旧实现将从 `GameGlobal` 读取的 `queueMicrotask` 首次绑定到 `GameGlobal`；该宿主实际提供的是要求真实 Window 接收对象的函数。引擎兼容作用域中的再次 `bind` 无法覆盖第一次绑定，导致消息通道启动时触发底层类型检查。报错中的 `Window` 指底层函数要求的接收对象类型，不表示小游戏提供了完整浏览器。

`fix3` 在构建入口分别捕获真实全局对象与 `GameGlobal`。当两者引用同一个全局函数时，按原始全局环境绑定；小游戏宿主独有的方法仍绑定到 `GameGlobal`。白名单覆盖定时器及取消方法、rAF 及取消方法、`queueMicrotask`、`atob`、`btoa` 和 `structuredClone`，裸定时器调用也统一经过引擎作用域。引擎中的 `window` / `self` 仍是适配层兼容对象，此修复不引入宿主真实 DOM、浏览器事件或网络实现。TikTok 官方也说明原生小游戏环境不具备完整浏览器能力，不能依赖完整 DOM、CSS 或任意浏览器 API，见 [Technical Overview](https://developers.tiktok.com/docs/en/mini-games-technical-overview)。

`fix3` 启动标记为 `build=host-receiver-3`，保留 `STARTUP_FAILED`、`STARTUP_WAIT` 与真实 `runtime-ready` 诊断。**当时的通过结果仅属于本地模拟宿主；随后用户确认带有该标记的 fix3 在手机上仍报告同一 queueMicrotask 错误，已排除误用旧包。** 因此不能将接收对象重新绑定记为真实宿主修复成功，后续方案见下一节。

本轮本机自动化回归 **289 项通过、0 失败、0 跳过**。新增独立 `GameGlobal` 与严格全局函数接收对象检查：旧版 helper 复现同文异常，修复后的完整转换产物完成 MessageChannel / Worker 消息往返及定时器、帧回调；原生 DOM 和方法引用保持不变。另覆盖宿主独有方法和缺失方法的回退路径。真实 Construct HTML5 输入已重新转换并通过入口语法检查；这些是本地验证，手机结果单独记录。

## 2026-09-21 fix4：TikTok 使用独立 Promise 微任务队列

`fix3` 的真机复测说明，将 `queueMicrotask` 绑定到可取得的全局对象仍未适配该宿主。当前没有证据确认手机中的 `globalThis` 是否为代理对象或哪个内部对象满足原生函数的类型要求；不继续把这些推测当作已经确认的宿主结构。

`fix4` 对 TikTok 完全跳过原生 `queueMicrotask`，包括读取、探测和调用，改用 JavaScript Promise 队列实现引擎微任务。调度保持异步和入队顺序，调用返回 `undefined`，忽略回调返回值；非函数回调同步抛出 `TypeError`。回调异常传递到启动诊断或错误日志，后续排队任务继续执行，不留下静默的内部 Promise rejection。

该调度器在构建入口创建引擎作用域时安装，早于 Worker / MessageChannel 模块求值，避免这些模块提前缓存旧的原生函数；裸 `queueMicrotask` 和 `self.queueMicrotask` 使用同一实现。`window` / `self` 仍为引擎兼容对象，原生方法保持不变，不通过读取宿主 `window` / `document` 寻找浏览器对象。

新增完整包回归设置原生 `queueMicrotask` 无论接收对象是什么都抛出同文异常，并令宿主 `window` / `document` 的访问抛错。在该契约下，手写 Construct 协议夹具完成消息通道与 Worker 启动，异步顺序与返回值检查通过，原生 queue 调用次数和禁用属性读取次数均为零。这仍是本地契约测试，不是真机环境的复刻或手机通过记录。

该包标记为 `build=promise-microtask-4`，交付时手机首帧尚待复测。**后续用户真机截图已显示 TikTok 的 57 入口 API 页面，并进入本地存储分类。** 这是部分渲染与导航证据，不代表所有入口、平台 API 或后续运行均已通过；同次反馈的存储失败见下一节。

本轮本机自动化回归 **294 项通过、0 失败、0 跳过**。新增微任务顺序、返回值、参数校验、异常报告和不可用原生队列的完整转换产物回归。真实 Construct HTML5 已重新转换，入口语法检查通过；这些检查不作为手机首帧验收。

## 2026-09-21 fix5：TikTok 存储读取与设备信息登记

用户真机截图显示 API 页面已能渲染并进入“本地存储 · localStorage 映射”，点击写入后提示“写入后读回的数据不一致”；另反馈 `tiktok.getDeviceInfo` 被判为不支持。

本地已复现一项存储适配缺陷：旧实现先用 `getStorageInfoSync().keys` 判断键是否存在，当枚举遗漏新键时，会直接返回 `null`，即使原生 `getStorageSync` 本可读到已持久化的数据。该问题同时影响 localStorage 与 Construct `runtime.storage`。**这是已复现的适配层缺陷；手机上实际的 keys 和原始读取返回值尚未取得，不能断言真机就是枚举滞后。**

`fix5` 的 TikTok 点读直接调用 `getStorageSync`，不再由枚举结果拦截。项目存储的 `ready()` 也不再要求 SDK 0.8.0 起提供的枚举接口。`null` / `undefined` 作为缺失值；localStorage 保留合法空字符串；项目存储使用非空版本化封装，因此原生空字符串按缺失处理。需要枚举的 `keys`、`key`、`length`、`clear` 仍读取原生键列表，缺少接口或原生失败会明确暴露。没有缓存写入值来替代真实读取，也没有把持久化失败改报成功。

设备信息方面，TikTok 目录原先漏掉 `getDeviceInfo`，即使宿主确实提供函数也会被桥接拒绝。现增加同步入口和明确的同平台兼容映射：优先调用 `TTMinis.game.getDeviceInfo`；仅当其缺失或不是函数时，改用官方 `TTMinis.game.getSystemInfoSync`。实际方法的接收对象、参数和返回值原样保留，不补造设备字段；原生 `getDeviceInfo` 抛错时保留失败，不再调用替代方法，两者都缺失才报告 `UNSUPPORTED`。

当前官方 [System 文档](https://developers.tiktok.com/docs/en/mini-games-sdk-system) 未列 `getDeviceInfo`，因此不宣称它是所有 SDK 都提供的原生接口。目录使用 `documentation: "native-or-system-info-mapping"` 与 `syncFallback: "getSystemInfoSync"` 明确记录映射；该能力的 `getCapabilities()` 项公开 `nativeMethod` 和 `compatibilityFallback`，告知实际选择的方法及是否启用兼容映射。能力探测本身不执行这些 API。TikTok 目录由 59 增至 60 个名称，全局唯一名称仍为 194 个。

本轮本机自动化回归 **318 项通过、0 失败、0 跳过**。新增存储检查覆盖缺失、滞后和抛错的枚举接口、原生持久化跨实例读取、中文与空字符串、命名空间隔离和原生读写错误；设备信息检查覆盖原生优先、明确兼容映射、实际方法元数据、调用失败及平台隔离。打包夹具还验证生成入口向 Construct 子存储传递 TikTok 平台，以及包内桥接的两条设备信息路径。原来的真实 Construct HTML5 导出重新转换成功。

新包标记为 `build=storage-device-5`。**手机上的存储写入、读取、删除、重启持久化及设备读数仍待复测。** 已有的页面显示证据仅适用于用户提供的 fix4 运行截图，不替代 fix5 的功能验收。

## 0.2.0 历史结论

| 层级 | 状态 | 已有证据及范围 |
| --- | --- | --- |
| Construct 插件包 | 通过自动化检查 | 官方 JSON Schema、ACE 与语言条目一致性、编辑器注册模拟、ZIP 根目录和打包内容检查 |
| 真实 Construct 编辑器 | 已打开、保存并导出 | 在真实编辑器 r495.2 中打开使用 MiniGameBridge 0.2.0 的 `MiniGameApiSuite.c3p`，保存并通过 Chrome 原生 UI 导出 |
| 插件业务与适配层 | 通过模拟宿主测试 | 成功 / 失败回调、平台差异、资源读取、消息传递和能力缺失处理；宿主为测试替身 |
| Construct 导出协议 | 通过手写夹具测试 | 手写 modern HTML5 启动结构，覆盖入口顺序、动态模块、资源加载及内部任务消息 |
| 真实 Construct 项目导出 | 已完成两端构建 | `MiniGameApiSuite.c3p`、28 文件的 `MiniGameApiSuite-html5.zip` 和原样解压目录已保存；默认转换输入为 `api-demo-html5/`，微信 / 抖音构建成功 |
| 微信 IDE 历史基线 | 已启动并观察输入 | `MiniGameBridgeTest` 在 RC 2.02.2607161、基础库 3.15.3 完整重开后收到真实 `runtime-ready`；该次启动 2 条 warning、0 条 error，并曾观察到微信 TouchStart 和 Construct PointerDown |
| 微信 IDE 0.2.0 API suite | 51 个入口、11 类别；已完成部分交互验收 | 基础库 3.15.3、WebGL 2、真实 `runtime-ready`；iPhone 12 / iPad Pro 12.9 模拟器完整重开后正常；17 项实际 API 自检均成功。Modal 回调正常，但仍触发已定位的 IDE worker 错误 |
| 抖音开发者工具运行 | 待完成 | 尚无真实 Construct 工程成功编译、初始化和首帧的证据 |
| 微信 / 抖音真机 | 待完成 | 启动、渲染、输入、音频、前后台、登录、广告与后端请求均需按平台实测 |

**当前不能宣称“完整 Construct runtime 已适配”或“微信 / 抖音小游戏发布已验证”。** `.c3addon` 可安装、打包过程成功或测试通过，均不足以得出这些结论。

## 0.2.0 历史自动化测试

本轮执行：

```sh
node src/cli.mjs --help
npm test
```

2026-09-20，0.2.0 最新一轮 `npm test` 记录为 **213 项通过，0 项失败**。测试文件和主要覆盖范围如下：

| 文件 | 验证范围 |
| --- | --- |
| `tests/addon-package.test.mjs` | 官方 Schema 验证、编辑器对象注册、ACE / 语言一致性、可重复 ZIP 打包结构 |
| `tests/addon-runtime.test.mjs` | 初始化与未就绪错误；通用异步 / 同步 / 对象 / 事件接口；标签隔离；跨 realm 普通对象与非 JSON 结果；取消、错误、实例订阅清理和迟到回调；savegame 不保存登录 code 或 API 结果 |
| `tests/runtime.test.mjs` | 微信 / 抖音模拟 API、基础 DOM / Canvas、网络和包内资源、音频 / 生命周期、平台业务及缺失能力处理 |
| `tests/worker.test.mjs` | 同线程异步 Worker 与 MessageChannel 的消息、关闭、克隆及受限加载行为 |
| `tests/export-contract.test.mjs` | 识别手写 Construct 启动协议、要求实验标记、两端模拟宿主中的启动顺序、模块和资源加载；宿主只读 DOM、全局隔离及共享库绑定 |
| `tests/build-safety.test.mjs` | 主模块和 Worker 的目录外 JSON / 裸依赖拒绝；classic 全局声明拒绝；失败构建保留旧产物；输出标记校验；符号链接和输入输出重叠拒绝 |
| `tests/inspect-inline.test.mjs` | 精确识别官方 `file:` 诊断 AST，拒绝附加行为和近似内联脚本 |
| `tests/binary.test.mjs` | Blob / base64 / UTF-8、真实临时图片文件及无原生 URL 环境的兼容实现 |
| `tests/runtime-scope.test.mjs`、`tests/wasm.test.mjs` | 引擎作用域与原生宿主边界、真实平台 WASM 接口及包内文件约束；独立于真实 IDE 验收 |
| `tests/readiness.test.mjs` | 仅在真实协议的 `runtime-ready` 消息处理成功后解决就绪 Promise，保留原方法的返回值和异常行为 |
| `tests/runtime-storage.test.mjs`、`tests/storage-patch.test.mjs` | 平台存储序列化、隔离与失败处理；精确识别 Construct localforage 适配代码并接入存储桥接 |
| `tests/runtime-geometry.test.mjs` | DOMRect / DOMRectReadOnly 的几何计算、数值转换及引擎作用域安装；覆盖 `layer.getViewport()` 所需接口 |
| `tests/platform-api.test.mjs` | 171 个 API 名称的分类、平台差异、调用类型；异步结果、取消与超时；同步 / 对象接口；事件订阅清理与缺失能力；不自动调用敏感 API |
| `tests/bridge-lifecycle.test.mjs`、`tests/bridge-response.test.mjs` | 桥接层释放、迟到回调及原生响应有效性；不把缺失或无效状态当作成功 |
| `tests/runtime-api-regressions.test.mjs` | 音频播放与停止、真实事件和资源释放；fetch / XHR 的失败、取消、超时、重入及字节边界 |
| `tests/runtime-input.test.mjs`、`tests/websocket.test.mjs` | 原生输入订阅与撤销；SocketTask 驱动的连接状态、消息顺序、二进制语义、关闭及释放 |

这些测试以本地 Node 环境、Mock SDK 或 Mock `wx` / `tt` 为基础，不连接真实登录服务、不展示真实广告，也不执行平台发布。

### 手写夹具的范围

[`tests/fixtures/construct-export/`](../tests/fixtures/construct-export/README.md) 是本项目原创的小型协议夹具，**不是从 Construct 编辑器导出的游戏，也不包含 Construct 引擎**。它模拟 `RuntimeInterface`、模块加载、`C3_SetInitFunctions`、项目启动回调、任务 Worker 和 JSON 资源读取。其通过结果用于验证转换器实现的这些接口路径，不能证明任意 Construct 版本、插件、渲染器、着色器或解码器兼容。

`examples/smoke/` 同样是手写 JavaScript 示例。`dist/wechat`、`dist/douyin` 默认由该示例生成，不能作为真实 Construct 游戏产物的证据。

## 0.2.0 真实编辑器导出与 IDE 实测

本节保留当时的路径与观察结果。当前同名 `.c3p`、HTML5 输入和构建目录已更新为 0.3.0；0.2.0 原始导出仍在本地归档，不随公开仓库分发。本节成功项不自动适用于 0.3.0。

已在 Construct r495.2 真实编辑器中打开 `MiniGameApiSuite.c3p`，保存并执行 HTML5 导出，获得 28 个文件的 `MiniGameApiSuite-html5.zip`。界面使用 Construct Text 对象，包含 51 个功能入口、11 个类别。两端转换产物均已构建；本轮目标平台运行验证仅在微信开发者工具完成，抖音构建不等于抖音 IDE 或真机验证。

| 路径 | 内容 |
| --- | --- |
| `examples/construct/MiniGameApiSuite.c3p` | 当前 0.2.0 编辑器工程，已由真实编辑器打开并保存 |
| `examples/construct/MiniGameApiSuite-html5.zip` | 当前工程实际导出的原始 HTML5 ZIP，共 28 个文件 |
| `examples/construct/api-demo-html5/` | 当前 ZIP 的原样解压目录，是 `export:wechat` / `export:douyin` 的默认输入 |
| `examples/construct/archive/WeChatApiDemo-0.1.c3p`、`WeChatApiDemo-0.1-html5.zip` | 历史 21 项 demo 的归档工程与导出 |
| `examples/construct/MiniGameBridgeTest.c3p`、`MiniGameBridgeTest-html5.zip`、`html5/` | 历史最小工程、实际 HTML5 导出及解压目录 |
| `dist/construct-wechat/`、`dist/construct-douyin/` | 当前 MiniGameApiSuite 的两端转换产物 |

原始 HTML5 文件保持原样。转换器通过严格 AST 判断跳过仅提示 `file:` 协议不可运行的官方内联诊断，继续拒绝其他内联代码。结构检查识别为 `construct-modern`，转换要求 `--experimental`。

### 0.2.0 MiniGameApiSuite 实测结果

环境：macOS、微信开发者工具 RC 2.02.2607161、基础库 3.15.3。**能力目录中本机有 133 / 171 个方法可用，是方法存在与调用类型检查，不代表这些方法全部调用通过。** 17 项自检执行了实际平台 API 并读取回调结果；已从控制台读回 **17 成功、0 失败、0 跳过**，也不等于全 171 个 API 验收。

| 项目 | 0.2.0 本轮实际记录 |
| --- | --- |
| 回归与构建 | 213 项自动化测试通过、0 项失败；微信与抖音转换构建成功 |
| 启动与渲染 | 实际基础库 3.15.3、WebGL 2，收到 Construct 真实 `runtime-ready`；新启动 0 条 error、2 条 warning |
| 页面与尺寸 | 51 个功能入口、11 类别；iPhone 12 与 iPad Pro 12.9 模拟器分别完整重开后显示、运行正常。均为 IDE 模拟器，不是真机 |
| 能力与自检 | 本机目录显示 133 / 171 个方法可用；17 项实际 API 自检成功，控制台读回 17 success、0 fail、0 skip |
| Toast | 真实平台 Toast 显示并成功回调 |
| 短振动 / 长振动 | 两者均收到成功回调；手机硬件振动另验 |
| Loading | 真实显示 Loading，1 秒后 `hideLoading` 成功 |
| ActionSheet | 真实选择第二项，回调对应第二项 |
| Modal | 确认回调和 `cancel=true` 取消回调均已观察；同时仍触发 1 条 IDE `worker path empty` 红色错误，不能标为无错误通过 |
| 键盘 | `showKeyboard` 后实际看到 demo 输入框，输入 8 个字符，仅记录长度；收到 `onKeyboardInput` 与 `onKeyboardComplete`。完成输入关闭后调用 `hideKeyboard` 成功；尚未验证用该 API 主动隐藏仍打开的键盘 |
| 音频主动停止 | 播放 8 秒测试音频期间主动 Stop，收到 `onStop` 并成功释放资源 |
| 音频自然结束 | 另一次播放完整 8 秒后收到 `onEnded`，实际画面显示播放完成；已截图确认 |
| 生命周期 | 当前 suite 的 onShow / onHide 实际切换待验 |
| 广告、账号与后端 | 真实广告播放、服务端身份交换、生产后端请求等仍需单独验收；可用性目录不替代此项 |

**启动时无 error 不等于所有后续操作无 error。** 本轮 Modal 的原生 UI、确认与取消回调正常，但已重复观察到 IDE Worker 错误。本机源码和隔离函数复现定位为 session 转发 URL 时丢失 `libName` 查询参数；尚未修复 IDE，也没有添加空业务 Worker、屏蔽错误或替换原生弹窗。具体证据与边界见 [微信调试记录](WECHAT-DEBUGGING.md#modal-worker-错误的本地调查)。

### 历史 0.1：最小基线与 21 项 WeChatApiDemo

以下保留此前工程的检查记录，**不是当前 0.2.0 每个功能的重复验收结果**。历史最小工程 `MiniGameBridgeTest` 已在微信测试号 `本地测试号（不公开 AppID）` 下启动并观察输入；该 AppID 仅记录本轮环境，不作为其他项目可复用的正式 AppID。原生 Canvas 只读属性、浏览器全局隔离、localforage、平台存储、数据 URL 和 DOMRect 问题已在适配代码修复并添加回归。

历史 WeChatApiDemo 显示白底全屏 21 项 Construct Text 页面。基础库 3.15.3 下读取设备信息和滑动未出现 error，点击 Modal 可重复出现 `worker path empty`。随后通过 UI 切到 3.12.1，完整重开并从新日志确认版本，Modal 仍触发同一错误；已恢复 3.15.3 作为当前基线。此版本对照仅针对该问题，没有把 3.12.1 当作完整功能验收。后续本机源码调查已找到 IDE 的查询参数丢失位置，见上述调试记录。

以下为历史 21 项工程在微信 IDE 中的实际观察；表中“待验”表示该历史轮次的状态，当前 suite 的新结果以此前 0.2.0 表格为准。平台回调成功不自动证明手机硬件行为。

| 项目 | 历史 0.1 记录 |
| --- | --- |
| 当时自动化复测 / 构建 | 113 项通过、0 项失败；21 项 demo 的转换产物已在 IDE 编译运行 |
| IDE / 基础库 | 微信开发者工具 RC 2.02.2607161；功能检查基线为 3.15.3。3.12.1 经完整重开和日志确认后仍复现 Modal 错误，回退未解决 |
| 当时启动日志 | 恢复 3.15.3 并完整重开后，日志确认为 `Wechat Lib:3.15.3, 2026.7.23 14:51:32`，收到真实 `runtime-ready`，启动时 2 条 warning、无 error，功能首屏清晰正常；点击 Modal 可重复出现的 `worker path empty` 未解决 |
| Text 页面与输入 | 白底全屏 21 项实际显示；触摸、连续拖动滚动、点击已观察。不同尺寸另验 |
| 设备、窗口、安全区 | 已点击读取并显示结果；不将模拟器信息当作手机真机数据 |
| 生命周期 | onShow / onHide 待实际切换验证 |
| toast / modal | 真实平台 UI 已显示，modal confirm 回调已观察；Modal 在 3.15.3、3.12.1 均触发同一 IDE worker 错误，不能标为完整通过；取消分支仍待验 |
| 短振动 / 长振动 | 两者均收到平台 success；手机实际振动另验 |
| localStorage 写入 / 读取 / 删除 | 写入、读取、编译重启后原值仍在、删除后读取 null 均已观察 |
| runtime.storage 写入 / 读取 / 删除 | 写入、读取、编译重启后原值仍在、删除后读取 null 均已观察 |
| 包内音频 | 播放后收到 onEnded；播放过程中主动停止仍待验，真机音频另验 |
| 包内 JSON 读取 | 实际读取包内数据，显示 1624 字符 |
| 登录 | 收到 32 字符临时 code；未将 code 本身输出到日志，未验证服务端交换身份 |
| 激励视频 | 已验证广告位未配置时的明确提示；没有真实播放、完整观看或提前关闭的验收结果 |

插件开发服务器另经过 HTTP 校验：清单内文件和 `.c3p` 可读，CORS 限定 Construct 编辑器源，HEAD / OPTIONS 正常，路径穿越、非白名单路径和非法方法被拒绝。它只用于编辑器开发插件加载，不属于小游戏运行环境。

## 待完成的真实项目验收

先用最小工程建立可重复的基线，再添加项目实际使用的对象、音频、特效和第三方插件。

1. 基于已保存的项目与真实导出，补齐插件 ACE 与属性的编辑器回归记录；每次更改项目后重新通过编辑器导出。
2. 使用 `inspect` 检查后执行 `convert --experimental`；便利脚本 `export:wechat` / `export:douyin` 已包含实验标记。
3. 解决已定位的 IDE Modal Worker 丢参问题并复测；补齐当前 suite 的前后台、主动隐藏已打开键盘、真实广告等剩余项目。在抖音 IDE 另行导入对应产物，记录 IDE、基础库版本、编译日志和运行结果。
4. 在尚未验收的平台与真机上验证 Construct 引擎初始化、首帧和持续更新；补齐图片、特效及项目实际使用的其他插件功能，不把当前 Text 页面验收外推到任意游戏。
5. 在真机上验证冷启动、前后台切换、屏幕方向、资源和网络失败、不同分辨率、长时间运行与性能。
6. 使用真实平台能力验证登录失败与 code 交换、激励视频完整观看与提前关闭、后端成绩请求、振动及错误处理；记录取消和失败时不会错误发奖或假报成功。

每个平台单独记录结果；某平台或某个项目通过，不自动推断另一平台、其他 Construct 版本或任意游戏通过。开发者工具运行成功也不代替真机测试。

## 构建报告的含义

转换器生成的 `BUILD-REPORT.json` 会记录来源格式、入口、静态发现、主 Worker 补丁、同线程内部 Worker 数量和待完成事项。当前输出：

```json
{
  "validation": "build-only-not-device-verified",
  "deviceVerified": false,
  "workerExecution": "same-thread-asynchronous"
}
```

`canBuild` 只表示静态检查没有阻止构建的错误。`GameGlobal.__C3MiniGameLoaded` 只表示入口脚本加载完成；引擎的异步初始化、首帧、音频解码和后续网络操作仍可能失败。真实项目的验收应另外记录日志、截图或可复现步骤，不通过改写构建报告来代替测试。

## 上游与许可记录

插件基于官方 SDK 的 [`plugin-sdk/singleGlobalPlugin`](https://github.com/Scirra/Construct-Addon-SDK/tree/a34e41a246fdbb03ac719597d528d7a5e5de0b02/plugin-sdk/singleGlobalPlugin) 示例，参考提交 `a34e41a246fdbb03ac719597d528d7a5e5de0b02`。以下三个官方 Schema 保存在 `addon/schemas/`，未修改内容：

- `plugin.addon.schema.json`
- `aces.schema.json`
- `plugin.lang.schema.json`

打包脚本排除这些 Schema，并移除打包 JSON 中仅供编辑器开发工具使用的 `$schema` 引用。检查该上游快照时未找到独立的 `LICENSE` / `COPYING` / `NOTICE` 文件，因此本项目没有为这些上游内容宣称 MIT、Apache 或其他额外许可。运行依赖及开发依赖的版本由 `package-lock.json` 固定，许可分别随各依赖分发。

`core-js-pure` 3.49.0 的版权与 MIT 许可保存在 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)，与当前安装依赖的 LICENSE 核对。真实导出中的 Construct 引擎代码和 SDK Schema 为不同来源，不应把 core-js 的 MIT 许可套用到它们。

## 启动状态诊断

`GameGlobal.__C3MiniGameScope.__C3MiniGameLoaded` 仅表示入口脚本加载完成；独立的 `__C3MiniGameReady` 等待 Construct 实际 `runtime-ready` 消息处理成功，届时控制台输出 `[C3 MiniGame] Construct runtime-ready`。未观察到该消息时保持等待，不将脚本加载或手写夹具初始化误报为引擎就绪。`tests/readiness.test.mjs` 覆盖此行为；最终测试计数在本文自动化测试部分更新。收到 ready 仍不代替画面、音频、存储或平台业务验收。

2026-09-21 新增的 `tests/startup-diagnostics.test.mjs` 验证真实初始化 Promise 的观察、失败传递、15 秒等待提示、慢启动继续执行、可选资源失败、hooks 恢复与日志 URL 脱敏。上述自动化检查不替代 TikTok 用户真机灰屏问题的再次验收。
