# 验证记录

记录日期：2026-09-20。当前版本：0.2.0，当前实测工程：`MiniGameApiSuite`。此文件分别记录源码测试、编辑器安装、真实游戏导出和目标平台运行，避免把其中一项当成其他项的证据。

## 当前结论

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

## 自动化测试

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

### 当前 MiniGameApiSuite 实测结果

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
