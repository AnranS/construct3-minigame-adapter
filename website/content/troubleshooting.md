# 问题排查

先确认问题发生在插件初始化、导出检查、小游戏编译、引擎启动还是业务调用阶段。保留完整错误、工具版本、实际基础库日志和最小复现步骤，通常比反复修改编译选项更有效。

本页保留 0.2.0 微信实际验证记录，并说明当前 {{VERSION}} 的新增接入边界。微信 IDE 已知的 Modal Worker 错误仍未修复，不能将弹窗正常显示当作该错误消失。

## 插件安装后没有小游戏导出选项

这是当前工具的工作方式。MiniGameBridge 提供事件表和 JavaScript 平台调用，离线 CLI 负责转换导出；插件不会向 Construct 导出菜单注册新 exporter。

在 Construct 选择 **HTML5 导出**，解压 ZIP，再执行 `inspect` 和 `convert --experimental`。完整命令见[快速开始](../guide/)。

## 浏览器预览出现 UNSUPPORTED

普通浏览器没有微信 `wx` / 抖音 `tt` / TikTok `TTMinis.game` 原生宿主及转换器安装的桥接。平台 API 需要在转换后的小游戏工程中验证。

如果已经在小游戏 IDE 中，检查是否导入了转换输出目录，确认 `game.js` 正常执行，再用 `supportsAPI` 或 `getCapabilities` 查看具体 API。目录外的名称、当前平台没有纳入的接口、缺少原生方法或缺少目录要求的 `off...` 时会不可用；显式登记的全量 off / 无 off 事件特例按本地停用契约处理。

不要用模拟成功回调消除这个错误；应让界面明确提示当前功能不可用。

## NOT_READY、WRONG_API_KIND 或 JSON 错误

| 现象 | 处理方法 |
| --- | --- |
| `NOT_READY` | 先调用 Init，在 On ready 之后执行业务操作 |
| `WRONG_API_KIND` | 按[API 目录](../api/)选择 Call API、同步调用、对象工厂或事件订阅 |
| `INVALID_JSON` | 检查是否是合法 JSON，字符串需要双引号，不能有尾随逗号 |
| `INVALID_ARGUMENT` | Call API 使用 options 对象；Read synchronous API 使用位置参数数组 |
| 成功但 `LastResultJSON` 为空 | 检查 `LastResultIsJSON` / `LastResultType`；原生 undefined、字节或句柄应从 JavaScript 取得 |

微信与抖音同名接口也可能类型不同，例如 `shareAppMessage`。具体结果表达式和 tag 规则见[插件接入](../addon/)。

## CLI 不能读取输入或拒绝覆盖

CLI 接受解压后的 HTML5 目录。输入 `.c3p`、ZIP、错误层级目录或缺失脚本与资源时，先修正输入再构建。

```sh
node src/cli.mjs inspect --input ./exports/my-game
```

检查报告中所有 `error` 项。Construct 项目转换需要显式加 `--experimental`；这个标记不会放行其他检查错误。

同平台有效 `--overwrite` 中省略 `--appid` 会保留旧值，也保留 `libVersion` 与合法的私有配置；首次或跨平台构建省略时留空。显式 `--appid` 覆盖旧值，显式空字符串会清空。旧配置、标记或用于判断平台的报告损坏时会拒绝覆盖并保留原输出，先确认文件内容和工程归属。

输出不能与输入重叠。已有输出需要保留 `.c3-minigame-output.json` 并加 `--overwrite`，否则请使用新的空目录。不要把任意现有目录伪装成本工具生成的目录。

输入中的符号链接、导出目录外模块、远程可执行脚本、一般 HTML 内联脚本和未打包的裸包依赖会被拒绝。请将游戏依赖整理为完整的本地导出资源；不要仅为通过检查而删除仍被引用的文件。

## 编译成功，但画面空白或没有 ready

先区分三个状态：

| 状态 | 能说明什么 |
| --- | --- |
| CLI 构建成功 | 文件结构与打包流程完成 |
| `__C3MiniGameLoaded` | 入口脚本已加载 |
| `[C3 MiniGame] Construct runtime-ready` | Construct 的实际就绪消息已处理 |

检查控制台中第一条与游戏相关的错误，确认导入目录包含 `game.js` 和 `game.json`、资源路径完整、AppID 与工程类型正确。不要只关注最后一条连带错误。

先运行仓库的 MiniGameApiSuite，再逐步加入自己的对象、音频、特效和第三方插件。本适配层提供有限 DOM、资源、网络和音频接口，不等于完整浏览器；任意 HTML 插件、WebGPU 或完整浏览器音频效果链不在当前验收范围。

改变 IDE 设备配置或基础库版本后，完整重开工程再观察。本轮 iPhone 12 与 iPad Pro 12.9 模拟器均在完整重开后正常，尚未将动态切换尺寸的所有路径验收为通过。

## 启动时出现 jsbridge not ready

本轮在微信基础库 3.17.3 / 3.17.2 中观察到 `WAGame.js` 早于游戏入口报告：

```text
[jsbridge] invoke getSystemInfo fail: jsbridge not ready
```

当前验证基线使用 3.15.3。若复现同类启动错误，可以在开发者工具中选择该基线、清空控制台显示并**完整重开工程**，然后核对新一轮日志里的 `Wechat Lib` 实际版本，再检查 `runtime-ready` 和画面。

设置面板选中的版本和错误后缀不一定能说明当前旧上下文已切换。本轮曾在选择新版本后仍看到旧版本日志，完整重开后才确认生效。重开工程无需清除游戏存储。

这是本机版本对照结果，不代表所有项目或客户端都存在相同问题，也不是建议长期固定某个版本。项目最终使用的目标基础库仍需单独验证。

## Modal 触发 worker path empty

**状态：仍未修复。** 本轮微信开发者工具 RC 2.02.2607161 中，基础库 3.15.3 和完整重开后的 3.12.1 均复现。新版示例的原生弹窗、确认与取消回调正常，同时仍触发红色 Worker 错误。

可按以下步骤复现并记录：

1. 完整重开 MiniGameApiSuite，确认新日志的基础库版本和 Construct `runtime-ready`。
2. 进入原生界面分类，点击 Modal。
3. 分别操作确认和取消，记录返回值及控制台错误。
4. 在网络面板检查内部 `worker.js` 请求是否携带 `libName=WAAccelerateWorker.js`。

本机只读源码分析和隔离函数复现定位到 IDE 转发内部 Worker 请求时丢失查询参数。这是本机调查结论，尚未获官方确认；未交付经过验证的 IDE 修复。回退到 3.12.1 也未消除错误。

不要添加空业务 `workers` 目录作为修复，也不要屏蔽错误或将原生弹窗替换为伪造成功。后续应在官方修正版本中复测或向官方提交最小复现；真机是否受影响尚未验证。

## 网络、登录或广告失败

能力检测为 `supported: true` 只说明当前宿主存在可调用的方法，业务仍可能失败。

| 能力 | 应检查的项目配置 |
| --- | --- |
| HTTPS / 下载 / 上传 | 平台允许的域名、证书、服务可达性、HTTP 状态和业务响应 |
| WebSocket | WSS 地址、平台域名、子协议与服务端握手；SocketTask 创建成功不等于 onOpen |
| 登录 | 原生临时代码、自己的服务端交换流程、失败和过期处理 |
| 激励视频 | 实际广告位、平台开通状态、广告库存；只有明确完整观看才发奖 |
| 位置、录音、相册等 | 权限、平台隐私配置、用户操作和场景条件 |
| 开放数据 / 榜单 | 对应域和权限配置，主域与开放数据域的调用范围 |

示例中广告、外部 HTTPS 和 WebSocket 参数留空时，会显示缺少配置，不会主动发起调用。使用自己的项目配置后，再单独记录这些功能的成功、失败和取消路径。

## 存储、音频或输入异常

原生存储使用项目专属键，先验证写入、读取、删除，再验证重启后持久化。通用原生 `clearStorage` 会影响该原生存储空间，不适合作为排查启动问题的第一步。

音频需使用包中实际存在且平台支持的资源，检查原生 `onError`；播放、停止与自然结束分别验收，功能关闭时释放对象和监听。本轮已验证 8 秒测试音频的主动停止、资源释放和自然 `onEnded`，完整解码器和效果链另验。

若输入坐标或页面尺寸异常，完整重开当前设备配置，再对照最小示例。触摸与滚轮适配已有自动化回归；最新滚轮实际转发、真机多点触摸及硬件行为尚不能用自动化结果替代。

## 调试工具与 MCP

本项目的实际验收使用开发者工具 UI、控制台和网络面板。已调查社区 `wechat-dev-mcp`，但当前工程不依赖它，也没有把 MCP 连接成功当作游戏启动成功。

本轮安装的官方 IDE CLI 暴露 `get_simulator_console`、`get_simulator_network` 等工具入口，但调用受到 IDE 服务端口设置约束。若返回 `IDE service port disabled`，说明该调试通道未启用，不是游戏编译错误。继续使用 IDE 控制台即可排查游戏，无需为运行项目强制开启该端口。

提交问题时请附上工具与基础库版本、Construct 版本、构建报告、最小复现步骤、第一条错误及平台类别。移除临时登录 code、用户输入、个人存储内容和项目私有凭据。已验收与待验收项目见[验证记录](../validation/)。

## TikTok 启动报 offWindowResize is required

旧版适配层要求内部事件同时提供 `on...` 和 `off...`。用户提供的 TikTok iOS 真机错误表明，该宿主暴露了 `onWindowResize`，却没有 `offWindowResize`，因此旧产物会在安装适配层时中止。

更新源码并重新转换 HTML5 导出。修复后的 TikTok 适配层在存在 `on...`、缺少 `off...` 时使用共享事件分发器；释放适配层会移除自己的本地回调，重复安装复用同一个原生监听，不影响其他调用方。有对应 `off...` 时仍使用原生撤销。此兼容逻辑覆盖启动过程的窗口、输入、前后台和网络监听，不会添加假的原生方法，也不扩展公开 API 目录。

已通过缺失 off 接口的启动、窗口更新、释放、重装和完整打包夹具回归；修复后的 TikTok 真机首帧仍待验证。原生接口范围请分别参考 TikTok 官方 [Event](https://developers.tiktok.com/docs/en/mini-games-sdk-event) 和 [Device and Network](https://developers.tiktok.com/docs/en/mini-games-sdk-device-and-network)，不要从微信或抖音同名方法推断。

## TikTok 灰屏，最后只有 secure context 警告

2026-09-21 的 TikTok iOS 用户反馈：`fix1` 不再出现 `offWindowResize` 异常，但游戏仍灰屏，最后一条游戏相关日志是 Construct 的 `not a secure context` 警告，Error 页为空。当时尚未确认失败位置；后续 `fix2` 的真机日志定位到 `queueMicrotask` 接收对象错误，处理方式见下一节。修复后的真机首帧仍无通过记录。

这条警告本身不会中止 Construct 启动。已确认的诊断缺口是：Construct 构造器发起异步初始化后立即返回，初始化 Promise 的后续错误可能绕过 `__C3MiniGameLoaded` 的入口加载错误捕获。因此 Error 页为空，仍可能有尚未暴露的初始化失败或等待。

换用含启动诊断的新包并完整重新启动，等待至少 15 秒，然后查看以下日志：

| 日志 | 含义与下一步 |
| --- | --- |
| `STARTUP_FAILED` | 已观察到实际初始化异常。提供完整日志及之前的阶段记录，以定位失败位置 |
| `STARTUP_WAIT` | 15 秒后仍未收到真实 ready。提供其中的 pending、history 及后续日志；该提示不终止慢启动，也不表示已经失败 |
| `[C3 MiniGame] Construct runtime-ready` | 实际就绪消息已处理，继续检查首帧、输入和后续错误 |

新诊断记录 worker 创建、任务调度器、runtime 创建与初始化、项目数据、Canvas、WebGL 及包内资源读取阶段。它保留安全上下文警告，不通过屏蔽警告或伪造 ready 让测试看起来成功。可选资源读取失败不会单独将启动判为失败，远程业务 URL 不进入诊断日志。

如果灰屏时两种诊断日志都没有出现，保留启动日志并确认当前运行的是新包。反馈时附上 TikTok 客户端版本和设备信息；目前这一步用于取得具体失败阶段，不能当作灰屏已经修复。完整记录见[验证记录](../validation/)。

## TikTok 报 Can only call Window.queueMicrotask on instances of Window

`fix2` 的 TikTok iOS 真机诊断已捕获 `STARTUP_FAILED`，阶段为 `runtime-interface-init`，错误为 `Can only call Window.queueMicrotask on instances of Window`。本地已复现：旧实现将底层全局函数绑定到 `GameGlobal`，但该函数要求真实 Window 作为 `this`，消息通道初始化因此失败。随后再次绑定到引擎兼容对象也无法纠正第一次绑定。

请使用 `fix3`，或更新源码后重新转换原始 HTML5 导出，并确认启动日志包含 `build=host-receiver-3`。修复分别捕获真实全局环境和 `GameGlobal`；两者共享的函数使用原始全局接收对象，小游戏独有方法保留自己的接收对象。相同处理覆盖定时器、rAF、`queueMicrotask`、`atob` / `btoa` 和 `structuredClone`，裸定时器也统一通过引擎作用域。

这里的 `Window` 是底层函数的类型检查，不代表能直接使用完整网页 DOM。Construct 看到的 `window` / `self` 仍是适配层提供的兼容对象；修复没有把真实浏览器 DOM 引入小游戏。TikTok 官方对完整 DOM、CSS 和任意浏览器 API 的限制见 [Technical Overview](https://developers.tiktok.com/docs/en/mini-games-technical-overview)。

此次修复针对已确认的函数绑定异常，**fix3 仍需在手机上验证实际 ready 和首帧**。若依旧灰屏，等待至少 15 秒并提供新的 `STARTUP_FAILED` 或 `STARTUP_WAIT` 完整日志，不能只根据构建完成或旧异常消失判定整个适配已通过。

## TikTok 检测不到宿主或支付没有发货

确认运行目标为 TikTok Native Mini Games，并选择 `tiktok` 平台。TikTok 的命名空间是 `TTMinis.game`，不能把抖音 `tt` 注入或重命名来模拟通过。原生 runtime 不需要 `TTMinis.game.init()`；HTML runtime 的 SDK 加载流程不适用于原生转换产物。

同名 API 也需要看目录中 TikTok 的独立契约。当前未登记的顶层方法不会自动透传；文件管理器、音频或 SocketTask 上的方法需要在返回对象上调用。

支付的客户端 success / complete 不代表订单已确认或已发货。检查自己的服务器是否收到 Webhook、使用原始请求体验签、验证商户和环境、幂等更新订单，再检查客户端查询的是自己的已鉴权订单接口。轮询超时保持 pending，不自动认定失败或再次扣款；用户取消或失败后重新购买需创建新订单。见 [TikTok 支付接入](../tiktok-iap/)。本项目尚无 TikTok IDE、真机或真实支付的通过记录；已有 TikTok iOS 用户真机启动失败报告，见上面的启动排查记录。
