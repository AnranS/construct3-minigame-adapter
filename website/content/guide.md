# 从 Construct 到小游戏

把 Construct 3 的 HTML5 导出转换为微信、抖音或 TikTok 原生小游戏工程，并通过 MiniGameBridge 插件调用平台能力。先跑通示例，再接入自己的游戏，通常更容易区分项目问题与平台适配问题。

当前版本为 **{{VERSION}}**。这是 **Construct 插件 + 离线转换器 + 运行时适配层**：安装插件后，Construct 的导出菜单不会新增“微信小游戏”或“抖音小游戏”或“TikTok”。实际流程始终是 **安装插件 → Construct 导出 HTML5 → CLI 转换 → 小游戏 IDE 测试**。完整的已验收范围见[验证记录](../validation/)。

## 1. 准备环境

需要以下工具：

| 工具 | 用途 |
| --- | --- |
| Node.js 22 或更新版本 | 安装依赖、打包插件、执行转换器 |
| Construct 3 | 编辑项目并导出 HTML5；插件最低声明版本为 r450，本轮实测为 r495.2 |
| 微信开发者工具 / 抖音开发者工具 / TikTok 官方开发流程 | 调试对应平台产物；TikTok 目标为 Native runtime |
| 自己的小游戏 AppID | 配置对应平台工程，测试账号、广告及其他业务能力 |

可以直接下载 [MiniGameBridge 插件包](../downloads/C3MiniGameBridge.c3addon)和 [MiniGameApiSuite 示例工程](../downloads/MiniGameApiSuite.c3p)。转换 HTML5 仍需要本项目 CLI；下载或克隆源码后，在项目根目录执行：

```sh
git clone https://github.com/AnranS/construct3-minigame-adapter.git
cd construct3-minigame-adapter
npm ci
npm run build:addon
```

生成 `dist/C3MiniGameBridge.c3addon`。`npm ci` 使用仓库锁定的依赖版本；以后更新源码或锁文件时重新执行。

## 2. 安装插件

在 Construct 的 **Addon manager** 中安装 `dist/C3MiniGameBridge.c3addon`，按编辑器提示重载。然后在项目中添加 **MiniGameBridge** 对象。

| 插件属性 | 如何设置 |
| --- | --- |
| Platform | 通常保留 Auto-detect；也可固定为 WeChat、Douyin 或 TikTok，固定值必须与实际宿主一致 |
| Score endpoint | 只有使用自定义成绩上报时才填写自己的 HTTPS 服务地址，其他情况留空 |

在事件表中建立最小初始化流程：

```text
System → On start of layout
  MiniGameBridge → Init

MiniGameBridge → On ready
  MiniGameBridge → Get network type，tag = "network"

MiniGameBridge → On API succeeded("network")
  Text → Set text to MiniGameBridge.LastResultJSON

MiniGameBridge → On error
  Text → Set text to MiniGameBridge.LastErrorCode
```

普通浏览器预览中没有小游戏宿主桥接时，平台调用会返回 `UNSUPPORTED`。应在后续转换得到的小游戏工程中验证平台能力。事件表、结果表达式和 JavaScript 用法见[插件接入](../addon/)。

## 3. 先运行功能示例

仓库中的 `examples/construct/MiniGameApiSuite.c3p` 是当前功能演示工程，可用 Construct 打开。其界面由真实 Construct Text 对象构成，当前源码在微信 / 抖音下包含 **12 个分类、53 个功能入口**，TikTok 下包含 **13 个分类、57 个入口**，其中支付入口只做能力与流程检查，不会实际付款。0.3.0 已由真实 Construct r495.2 重新导出并完成三端转换，微信 IDE 已显示 53 个入口并验证分类/返回导航，未运行新版自检或点击支付测试入口；历史 0.2.0 的 51 个入口、11 类和 17 项自检记录见[验证记录](../validation/)。

公开仓库提供 `.c3p` 工程和适配器源码，不包含 Construct 引擎的原始 HTML5 导出或 ZIP。请在 Construct 中打开这份工程，选择 **Export → HTML5**；初次验证建议关闭脚本压缩与离线支持。

将导出的 ZIP 解压到 `examples/construct/api-demo-html5/`，确保该目录下直接包含 `index.html` 和 `scripts/`，再执行：

```sh
npm run inspect -- --input examples/construct/api-demo-html5
npm run export:wechat -- --appid YOUR_WECHAT_APP_ID
npm run export:douyin -- --appid YOUR_DOUYIN_APP_ID
npm run export:tiktok -- --appid YOUR_TIKTOK_APP_ID
```

请把大写占位符替换为自己的平台 AppID。输出分别为：

```text
dist/construct-wechat/
dist/construct-douyin/
dist/construct-tiktok/
```

这些便利命令只转换你刚刚解压的 HTML5 文件，不会操作 Construct 编辑器或重新导出 `.c3p`。刚克隆仓库时，必须先完成上述编辑器导出与解压步骤。它们包含 `--experimental --overwrite`，会重建带有本工具标记的旧输出。首次或跨平台构建省略 `--appid` 时，AppID 留空；同平台且旧输出标记有效的 `--overwrite` 会保留旧 AppID。显式传入新值会覆盖，显式空字符串会清空。

macOS 也可双击仓库中的 `构建微信小游戏.command` 或 `构建抖音小游戏.command`，按提示填写 AppID。它们读取同一份示例导出；缺少依赖时会提示先执行 `npm ci`。

## 4. 导出自己的 Construct 项目

在 Construct 中保存项目，再选择 **Export → HTML5**。初次接入建议关闭脚本压缩和离线支持，使用尽量小的工程建立运行基线。本轮示例使用未压缩 HTML5 导出。

导出 ZIP 后解压到项目下的独立目录，例如：

```text
exports/my-game/
  index.html
  scripts/
  ...其他导出资源
```

保留所有文件的相对目录关系。CLI 的输入是这个**解压目录**，不能直接传 `.c3p` 或 ZIP。以后在 Construct 中修改游戏后，需要重新导出并更新输入目录。

先检查，再转换：

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

识别为 Construct 导出时必须加 `--experimental`。它表示接受当前引擎兼容性仍需逐项目和真机验证，不会跳过结构检查。

## 5. 导入小游戏 IDE

把输出目录作为**小游戏工程**导入相应开发者工具。应选中包含 `game.js`、`game.json` 和 `project.config.json` 的目录，而不是 HTML5 输入目录。

```text
dist/my-game-wechat/
  game.js                    小游戏启动入口
  game/                      游戏资源
  game.json                  小游戏配置
  project.config.json        IDE 工程配置
  BUILD-REPORT.json          转换发现、应用补丁和待验证事项
  .c3-minigame-output.json    生成目录标记
  README.txt                 导入提示
```

确认使用自己的有效小游戏 AppID 和小游戏工程类型后编译。空 AppID 配置可能使 IDE 进入错误的编译类型；建议转换时传 `--appid`，修改后完整重开工程。检查真实首帧、触摸响应以及控制台的：

```text
[C3 MiniGame] Construct runtime-ready
```

这条日志表示 Construct 的就绪协议已完成；仍要继续测试画面、资源、音频和项目业务。`__C3MiniGameLoaded` 仅表示入口脚本加载完成，不能代替引擎就绪。

当前微信 IDE 已实测示例的启动、渲染、自检和部分交互；抖音 IDE 尚未验收，TikTok 新增目标也尚无 IDE、真机或真实支付验证。TikTok 使用其官方 Native Mini Games 工作流，不导入微信或抖音 IDE。遇到错误请按[问题排查](../troubleshooting/)核对实际基础库版本和运行阶段。

## 常用 CLI 参数

| 参数 | 作用 |
| --- | --- |
| `--input` | 解压后的导出目录 |
| `--output` | 独立的输出目录，不得与输入重叠 |
| `--platform wechat` / `douyin` / `tiktok` | 选择目标宿主 |
| `--appid` | 首次 / 跨平台省略时留空，同平台有效覆盖时保留旧值；显式新值或空字符串覆盖 |
| `--orientation portrait` / `landscape` | 屏幕方向，默认竖屏 |
| `--experimental` | Construct 导出转换必需 |
| `--overwrite` | 允许重建保留本工具标记的旧产物，不覆盖任意目录 |
| `--entry` | 指定相对输入目录的本地 JS 入口，跳过 `index.html` 入口发现 |
| `--json` | 输出 JSON 格式的检查或构建报告 |

同平台有效覆盖还保留旧 `libVersion` 与合法普通文件 `project.private.config.json`，其他 `project.config.json` 字段按本轮参数重新生成。遇到损坏 JSON、符号链接或不能确认平台的旧输出时，转换器保守处理，不从不可信路径继承配置。 `BUILD-REPORT.json` 的 `preservedLocalConfig` 仅列出实际保留的字段名，不记录 AppID 值。

完整帮助：

```sh
node src/cli.mjs --help
```

## 接入更多平台能力

适配层有 **{{API_COUNT}} 个唯一 API 名称、{{CATEGORY_COUNT}} 类能力**的显式目录，覆盖异步调用、同步调用、原生对象和事件订阅。先通过 `supportsAPI` 或 `getCapabilities` 检查当前宿主，再按目录种类调用。详见[API 目录](../api/)和[插件接入](../addon/)。

账号登录需要自己的服务端交换临时代码；网络请求需要自己的服务和平台域名配置；广告需要实际广告位及开通条件。示例中未配置广告位、HTTPS 地址或 WebSocket 地址时，会提示缺少配置并跳过相应调用。

转换器生成的 `BUILD-REPORT.json` 保留 `deviceVerified: false`。完成自己的真机测试后另行记录结果；工具不会登录开发者平台、上传或发布游戏。

## TikTok 原生目标

TikTok 原生宿主命名空间是 `TTMinis.game`，与抖音的 `tt` 独立。插件选 TikTok 或 Auto-detect 后仍执行插件 **Init → On ready**；这一步设置本项目桥接，不调用原生 `TTMinis.game.init()`。TikTok 官方原生 runtime 无需 SDK 初始化，HTML runtime 的脚本加载与 `clientKey` 初始化流程不适用于本转换目标。[官方 SDK 概览](https://developers.tiktok.com/docs/en/mini-games-sdk-overview)

自己的游戏可以使用以下转换命令：

```sh
node src/cli.mjs convert \
  --input ./exports/my-game \
  --output ./dist/my-game-tiktok \
  --platform tiktok \
  --appid YOUR_TIKTOK_APP_ID \
  --experimental
```

按 TikTok 官方原生游戏开发与提交流程使用输出；本项目不把微信或抖音的 IDE 配置当作 TikTok 配置。调用前查看 [API 目录](../api/) 的 TikTok 独立列；同名接口不保证参数和回调一致。需要 IAP 时继续阅读 [TikTok 支付接入](../tiktok-iap/)，客户端完成回调不能作为发货依据。
