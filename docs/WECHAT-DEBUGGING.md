# 微信开发者工具调试记录

记录日期：2026-09-20。测试对象是通过 Construct 3 r495.2 编辑器导出的真实工程，包含本项目的 MiniGameBridge 插件，再由转换器生成微信小游戏产物。本记录区分开发者工具验证与手机真机验证。

## 本次开发者工具结果

当前测试版本为 0.2.0、工程为 `MiniGameApiSuite`。已在 Construct r495.2 真实编辑器中打开、保存并导出 28 文件的原始 HTML5 ZIP；213 项自动化回归全通过，两端转换构建完成。当前实际运行环境为 macOS、微信开发者工具 RC 2.02.2607161、基础库 3.15.3：

- 使用 WebGL 2，收到 Construct 真实 `runtime-ready`。
- 新启动控制台 0 条 error、2 条 warning；此结论仅对应启动观察窗口。
- 51 个功能入口、11 类别；iPhone 12 与 iPad Pro 12.9 模拟器完整重开后均正常，尚未等同手机或平板真机验证。
- 本机能力目录显示 133 / 171 个方法可用；17 项实际 API 自检的控制台结果为 17 success、0 fail、0 skip。方法可用数与自检结果均不代表全 171 个 API 验收。

本轮真实操作已观察到 Toast、短长振动成功回调、Loading 显示后 1 秒隐藏、ActionSheet 第二项返回、Modal 确认及 `cancel=true` 取消回调。键盘显示后输入 8 字符，仅记录长度，收到 `onKeyboardInput` / `onKeyboardComplete`；完成输入关闭后调用 `hideKeyboard` 成功，尚未验证用该 API 主动隐藏仍打开的键盘。8 秒测试音频的播放期间主动 Stop、`onStop` 与释放，以及另一次完整播放后的自然 `onEnded` 均已观察。

**本轮 Modal 仍触发 1 条 IDE `worker path empty` 红色错误，尚未修复。** 弹窗和回调正常不等于无错误通过。本机查询参数丢失位置已定位，见下方源码调查。生命周期、真实广告、账号后端及真机等未完成范围详见 [验证记录](VALIDATION.md)。入口脚本加载完成的 `__C3MiniGameLoaded` 不等于引擎就绪。

历史最小工程和 0.1 版 WeChatApiDemo 的 21 项检查另在验证记录保留。历史基础库对照如下；3.12.1 的对照只针对 Modal 错误，当前已恢复 3.15.3。

| 调试基础库 | 历史对照与当前基线 |
| --- | --- |
| 3.17.3 | 启动阶段出现 `[jsbridge] invoke getSystemInfo fail: jsbridge not ready`，堆栈位于 WAGame.js，早于游戏入口。 |
| 3.17.2 | 同类早期错误仍出现；本地源码也存在相同形式的早期系统信息调用。 |
| 3.15.3 | 初次选择并编译时仍看到旧版本日志；完整重开工程、确认新日志实际为 3.15.3 后，没有早期 jsbridge error，并收到 Construct `runtime-ready`。0.1 demo 及当前 0.2.0 suite 点击 Modal 均复现 `worker path empty`；当前启动仍为 0 error、2 warning。 |
| 3.12.1 | 通过 UI 选择并完整重开工程，新日志明确为 `Wechat Lib:3.12.1`，启动正常；点击 Modal 仍立即触发相同 `worker path empty`，对话框本身显示正常。此次回退没有解决 Modal 问题。 |

不要仅用设置面板或错误后缀中的基础库版本判断实际执行版本。本次选择 3.15.3 后，旧运行上下文仍曾显示 `Wechat Lib:3.17.2`；完整重开后才确认加载了新版本。

## 对 jsbridge 错误的本地调查

以下依据来自本机官方安装包及已下载基础库的只读分析，**不是微信官方故障公告或官方确认的根因**。没有修改 WAGame.js，也没有屏蔽控制台错误。

基础库内部桥对象尚未建立时，WAGame.js 的调用入口会输出上述错误。3.17.3 和 3.17.2 中存在两处模块顶层调用系统信息接口读取 `deviceOrientation` 的代码；已缓存的 3.15.3 中没有这两处调用。这与早于游戏入口的错误及版本对照结果相符，但不能据此推断所有项目或客户端都会发生同一问题。

IDE 的基础库选择链也已只读核对：

- 微信模拟器通过 `getVendorVersionForSimulatorType` 读取工程的 `libVersion`，没有发现小游戏另设强制新版的选择逻辑。
- `VendorService.getFileByProject` 从对应版本的 `.wxvpkg` 读取 WAGame.js；它不属于忽略版本的文件列表。
- 脚本请求中的 `?v=` 参数优先于工程版本；旧请求或旧上下文可能继续使用旧版本。
- 基础库包读取缓存的键包含完整包路径和文件名，不会把 3.15.3 与 3.17.2 当作同一个缓存项。

因此，本项目当前采用的可重复办法是：在 UI 选择基础库，清空控制台显示，完整重开工程，核对新一轮 `Wechat Lib` 日志，再观察游戏渲染、输入及 `runtime-ready`。重开工程无需清除游戏存储；保留存储有利于继续验证重启后的数据持久化。

## Modal Worker 错误的本地调查

以下为**本机安装包和 3.15.3 基础库的只读源码分析、隔离函数复现及现场观察，不是微信官方确认的根因或故障公告**。3.12.1 的记录是实际操作对照，没有据此声称两个版本的内部实现完全相同。

历史复现步骤：完整重开项目，确认实际基础库日志和 Construct `runtime-ready`；读取设备信息、滑动页面均未出现 error；点击 Modal 后立即出现 `worker path empty`，同时原生对话框显示。3.15.3 重复操作及 3.12.1 完整重开后的对照都得到这一结果。当前 0.2.0 MiniGameApiSuite 在 3.15.3 下仍触发 1 条同类红色错误；确认和 `cancel=true` 取消回调均正常，这没有消除错误或改变未修复结论。

本机源码能确认以下路径：

- WAGame.js 的 `showModal` 在完成处理后可进入内部质量报告；报告条件启用时，调用 `runTask("resolveInteractiveApiContent", ...)`。
- 该任务服务首次使用时会调用 `createWXLibWorker("WAAccelerateWorker.js", {APIList: []})`。这里的库名是非空常量；该 Worker 脚本内也未发现再次创建 Worker 的调用。
- IDE 的 `js/extensions/worker/asdebug/index.js` 正常会将库名写为 `__WORKER__/worker.js?libName=WAAccelerateWorker.js`。
- 本次 Network 已实际观察到 `/game/s1/_sessionId/simulator-app-session-s1/__WORKER__/worker.js?libName=WAAccelerateWorker.js`，原始请求确实带有非空库名。
- **本机已定位到漏参函数：** `js/384885f85e653c121a5b9fe96f0a3088.js` 的 `AppserviceController` 先调用 URL 辅助函数，把请求分为独立的 `subPath` 和 `query`。随后 `js/8200c33fc6adfcc87f94ac822aa8ec4a.js` 的 `SimulatorCodeService.serveGameAppservice` 仅用 `address + "/game/" + subPath` 重建 URL，没有追加查询参数；`buildProxyContext` 再解析这个新 URL，因此丢失 `libName`。
- IDE 请求处理器 `js/a9cc11502efe0e26cce81894f7c858be.js` 将查询参数 `libName` 传为 `extraLibName`。编译器 `js/8fd55709f2317870f49b21a86699363d.js` 在该参数非空时直接加载基础库 Worker；只有进入业务 Worker 分支、同时 `game.json.workers` 或 `workers.path` 为空时，才抛出本次同文案错误。

已在隔离 VM 中运行本机原始的 URL 拆分、转发及游戏请求处理函数，验证输入 `query.libName = "WAAccelerateWorker.js"`，转发后 URL 不含查询参数，传给 Worker 编译接口的 `extraLibName` 为 `undefined`。验证仅使用无副作用的服务参数接收器，没有运行或修改后台服务；这确认了本机转发函数的丢参行为，不冒充后台调试器取得了运行时局部变量。结合实际 Network 与错误堆栈，该链可以具体解释本次 Modal 错误。当前转换产物中的 Construct Worker 调用使用同线程兼容实现，没有调用 `wx.createWorker`。

进入该 session 请求链由小游戏模拟器的 `isGame` 决定，来源是工程的 `attr.gameApp`。容器无条件注册 session 下 GET `**` 路由；在已检查的分支中没有基础库版本、业务 Worker 或 ES6/压缩选项可以保留查询参数。同一 IDE 还有使用原始 request URL 的通用代理入口，但未找到正常项目设置能把当前内部 Worker 切回该入口。因此没有把改编译选项或回退基础库视为已知修复。

本轮没有找到经过验证的项目配置修复。添加空 `workers` 目录会继续走错误的业务 Worker 分支，因此未将其作为修复交付；也未修改第三方 IDE、屏蔽错误或替换原生 Modal。正确修正此函数需要在 IDE 转发时保留查询参数，未在本任务中实施。版本对照到 3.12.1 后仍复现，现已恢复 3.15.3 基线；**已定位本机丢参位置，但 Modal 错误尚未修复**。后续可向官方提交复现或用官方修正版本验证；手机真机是否受影响尚未验证。

## 官方 CLI 的实际可用边界

本机安装的官方 CLI 位于：

```text
/Applications/wechatwebdevtools.app/Contents/MacOS/cli
```

`cli --help`、`cli agent --help` 和 `cli agent tool --help` 均可读取。本机官方工具注册代码包含以下接口；这些名称和参数来自实际 schema，并非猜测：

| 工具 | 参数 | 行为 |
| --- | --- | --- |
| `get_simulator_console` | `project`：工程绝对路径；`command`：不含文件名的 grep 命令 | 只读已打开工程的 console 缓冲区；不是实时日志流。`grep -n .` 返回全部非空日志行。 |
| `get_simulator_network` | `project`、`command` | 只读网络日志缓冲区。 |
| `simulator_refresh` | `project` | 触发重新编译/刷新，不返回编译结果。本次未通过 CLI 执行。 |

实际尝试过只读 `get_simulator_console`，但官方 CLI 在调用工具前返回：

```text
IDE service port disabled.
工具的服务端口已关闭。
```

退出码为 246。未开启服务端口、未修改安全设置、未运行 `agent start`。CLI 的通用初始化同样约束 `simulator_refresh`，因此不能把它当作无需服务端口的编译途径。本机 `skill-cli --help` 另报缺少 `wechatide-skill` 目录；已有 `agent tool` schema 并不意味着完整 skill 命令包已安装。

下面仅保留可重复命令的格式；将 `project` 替换为实际绝对路径。当前端口关闭时，该命令仍会返回上述错误。

```sh
/Applications/wechatwebdevtools.app/Contents/MacOS/cli agent tool \
  --name get_simulator_console \
  --args '{"project":"/absolute/path/to/dist/construct-wechat","command":"grep -n ."}' \
  --timeout 10000 </dev/null
```

当前继续通过微信开发者工具 UI 编译、读控制台、截图和测试触摸即可，不要求用户为完成本项目开启额外权限。

## 社区 MCP 调查

已检查社区项目 [wechat-dev-mcp](https://github.com/jiawei686/wechat-dev-mcp) 的文档和源码，**没有安装或配置该 MCP**。仓库确有小游戏分支、CDP 连接、截图及日志工具，不能简单归类为“只支持小程序”。但需要注意：

- 其连接实现承认小游戏 automator 可能只能握手，`evaluate` 或截图可能挂起，因此另提供 CDP-only 连接；所谓 ready 仅检查 `GameGlobal` 和 `wx` 是否存在，不能证明 Construct 启动成功。[连接源码](https://raw.githubusercontent.com/jiawei686/wechat-dev-mcp/main/src/connection.js)
- 自动插桩会调用 `wx.createCanvas()`；帧率探针统计自己的 rAF 回调；网络包装还会在 success/fail 中调用原 complete，而原 complete 仍保留。这些行为可能影响画布、性能或回调验证，不宜直接当作本项目的验收证据。[插桩源码](https://raw.githubusercontent.com/jiawei686/wechat-dev-mcp/main/src/game-runtime.js)
- 仓库的测试脚本当时明确没有自动化测试，需要对真实微信开发者工具验证。[包配置](https://github.com/jiawei686/wechat-dev-mcp/blob/main/package.json)

后续若另行接入，可优先评估明确指定目标的 CDP-only 日志和截图能力，验证它连接的是当前小游戏上下文。当前交付不依赖社区 MCP；实际启动仍以 Construct 的真实 `runtime-ready`、画面和交互结果为准。
