# MiniGameBridge 插件接入

MiniGameBridge 是 Construct SDK v2 单例对象插件，固定插件 ID 为 `C3MiniGameBridge`。当前包版本为 **0.2.0.0**，与适配工具版本 0.2.0 对应。插件提供 **19 个动作、11 个条件、14 个表达式**，也可以在 Construct JavaScript 脚本中调用。

先按[快速开始](../guide/)安装 `.c3addon`、添加对象并完成小游戏转换。插件声明不支持 Worker 模式；转换器负责安装运行时桥接，插件负责把事件表和脚本调用交给它。

## 初始化和错误处理

在布局启动时调用 **Init**，等 **On ready** 后再调用业务 API。用 **On error** 统一显示或处理失败。

```text
System → On start of layout
  MiniGameBridge → Init

MiniGameBridge → On ready
  执行后续平台操作

MiniGameBridge → On error
  读取 LastErrorCode、LastError、LastOperation
  通用调用还可读取 LastAPIName、LastAPITag
```

缺少小游戏桥接时返回 `UNSUPPORTED`；未初始化时返回 `NOT_READY`。插件不会在初始化过程中自动登录、读取剪贴板、申请权限或展示广告。

所有事件表动作都支持 Construct 的 **Wait for previous actions to complete**。其中 **Read synchronous API** 仍然立即调用原生同步接口；动作支持等待并不改变原生接口种类。

## 事件表：调用一个 API

通用动作按原生协议分为以下几种：

| 动作 | 输入 | 结果 |
| --- | --- | --- |
| Call API | API 名称、options JSON 对象、tag | 等待原生成功回调，触发 On API succeeded(tag) |
| Read synchronous API | API 名称、位置参数 JSON 数组、tag | 立即取得原生返回值，触发 On API succeeded(tag) |
| Subscribe to API event | `on...` 事件名、tag | 注册后触发 On API succeeded(tag)，以后收到事件触发 On API event(tag) |
| Unsubscribe from API event | 同一事件名和 tag | 移除本实例对应订阅，结果包含 `unsubscribed` |

例如查询网络类型：

```text
MiniGameBridge → On ready
  MiniGameBridge → Call API
    API name: "getNetworkType"
    Options JSON: "{}"
    Tag: "network"

MiniGameBridge → On API succeeded("network")
  Text → Set text to MiniGameBridge.LastResultJSON
```

`LastResultJSON` 是完整原生结果的 JSON 字符串。如果需要其中的 `networkType` 字段，可交给项目中的 Construct JSON 对象解析，再读取对应字段。

读取同步存储时，API 名称使用 `getStorageSync`，参数数组的内容为：

```json
["my-game/save"]
```

options 必须是 JSON 对象，同步参数必须是 JSON 数组。JSON 无效返回 `INVALID_JSON`，形状不正确返回 `INVALID_ARGUMENT`，未调用原生接口。

## tag 与结果表达式

tag 是项目自行选择的标记，例如 `network`、`save-read`、`keyboard`。它区分事件表中的调用来源，区分大小写，不会传给原生 API。

| 表达式 | 用途 |
| --- | --- |
| `LastAPIName`、`LastAPITag` | 当前触发对应的 API / 事件名和 tag |
| `LastResultJSON` | API 返回数据的 JSON 字符串 |
| `LastResultIsJSON`、`LastResultType` | 结果是否能忠实表示为 JSON，以及原始类型 |
| `LastEventJSON` | 原生事件数据的 JSON 字符串 |
| `LastEventIsJSON`、`LastEventType` | 事件数据是否为可表达的 JSON，以及原始类型 |
| `CapabilitiesJSON` | 当前能力目录，包含名称、调用种类和 `supported` 等字段 |
| `LastErrorCode`、`LastError`、`LastOperation` | 错误码、错误说明和失败的插件操作 |

API 成功不保证结果适合 JSON。`undefined`、二进制、原生对象、循环对象等不能忠实表示时，`LastResultIsJSON` 为 0，`LastResultJSON` 为空字符串；需要这些数据时使用 JavaScript 接口取得原值。插件不会将它们替换成 `{}` 或 `null`。

`LastResultJSON` 与 `LastEventJSON` 分别保存调用结果和事件数据，按当前触发读取。结果、事件、tag 和临时登录 code 不写入 Construct 存档。

## 事件表：监听和取消监听

监听键盘输入的配置：

```text
MiniGameBridge → On ready
  MiniGameBridge → Subscribe to API event
    Event name: "onKeyboardInput"
    Tag: "keyboard"

MiniGameBridge → On API event("keyboard")
  读取 MiniGameBridge.LastEventJSON

关闭输入功能时
  MiniGameBridge → Unsubscribe from API event
    Event name: "onKeyboardInput"
    Tag: "keyboard"
```

同一个事件名和 tag 再次订阅会替换原订阅；不同 tag 独立存在。事件订阅要求宿主的 `on...` 和对应 `off...` 都可用。插件实例释放或加载存档时会清理本实例订阅，不释放共享桥接或其他实例的资源。

## 常用快捷动作

无需手写 JSON 的动作适合常用功能：

| 动作 | 行为 |
| --- | --- |
| Show toast / Show modal | 调用原生提示 / 弹窗；Modal 结果读取 `confirm`、`cancel` |
| Write / Read / Remove storage | 调用原生异步存储；写入值可为任意 JSON 值 |
| Get network type | 读取网络类型 |
| Write / Read clipboard | 调用原生剪贴板接口 |
| Show / Hide keyboard | 显示或隐藏原生键盘，输入内容从键盘事件接收 |
| Login | 获取临时登录 code，触发 On login succeeded |
| Show rewarded video | 仅完整观看触发 On ad completed，其他关闭结果触发 On ad cancelled |
| Report score | 请求配置的 HTTPS 成绩服务，成功触发 On score reported |
| Vibrate | 请求短 / 长振动，触发 On vibration completed |

通用原生存储不自动加键名前缀，请用项目专属键。自定义成绩服务不是平台内置排行榜。登录 code 需要交给自己的服务端验证身份；AppSecret 留在服务端。奖励只在 **On ad completed** 后发放。

## JavaScript：查询能力并调用

在能访问 Construct `runtime` 的项目脚本中，按实际对象名取得实例：

```js
const bridge = runtime.objects.MiniGameBridge.getFirstInstance();
await bridge.init();

if (bridge.supportsAPI("getNetworkType")) {
  try {
    const result = await bridge.callAPI("getNetworkType", {});
    // 将 result.networkType 用于自己的界面或联网逻辑。
  } catch (error) {
    console.warn("getNetworkType failed:", error.code);
  }
}

const available = bridge.getCapabilities().filter(item => item.supported);
```

如果重命名了 Construct 对象，需要同步修改 `runtime.objects.MiniGameBridge`。能力检测不调用业务接口，不代表已授权或业务一定成功。完整调用种类见[API 目录](../api/)。

```js
// async：options 对象，等待原生回调。
await bridge.callAPI("setStorage", {
  key: "my-game/save",
  data: { level: 3 }
});

// sync：使用原生位置参数，不是参数数组包装。
const save = bridge.getAPISync("getStorageSync", "my-game/save");
```

JavaScript 的 `callAPI`、`getAPISync`、`createAPIObject` 也会触发通用成功条件，tag 为空字符串。失败同时触发 **On error** 并 reject / throw，脚本调用仍须捕获错误。不要同时在事件表和脚本中重复执行业务奖励等操作。

## JavaScript：取消与超时

`callAPI` 返回可取消的 Promise，支持 `.abort()`，也支持 `AbortController.signal`：

```js
const controller = new AbortController();
const pending = bridge.callAPI(
  "getStorage",
  { key: "my-game/save" },
  { timeoutMs: 5000, signal: controller.signal }
);

// 页面关闭或不再需要结果时，任选一种取消方式：
// controller.abort();
// pending.abort();

try {
  const result = await pending;
  // 使用 result.data。
} catch (error) {
  if (error.code !== "ABORTED") {
    console.warn("Storage read failed:", error.code);
  }
}
```

普通异步接口默认超时为 30 秒；Modal、授权、扫码、选图等交互接口默认不设超时。`control.timeoutMs` 可显式调整，`control.onTask` 可取得 API 返回的原生任务句柄。

取消会结束当前等待；只有原生任务提供 `abort()` 才能同时尝试取消底层任务。它不保证关闭平台弹窗，也不能撤回已经发生的写入。任务句柄本身不被视为成功结果。

## JavaScript：管理原生对象和事件

原生音频、广告、SocketTask 等对象要按平台协议使用并释放。下面演示播放结束、失败或功能关闭时清理音频：

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
    // 按项目需要消费 data.value，避免把用户输入写入公开日志。
  });
}

if (bridge.supportsAPI("createInnerAudioContext")) {
  audio = bridge.createAPIObject("createInnerAudioContext", {});
  audio.src = "game/beep.wav"; // 替换为游戏包中实际存在的音频路径。
  audio.onEnded(closeFeature);
  audio.onError(onAudioError);
  // 在游戏允许播放的时机或用户操作中执行：
  audio.play();
}

// 功能关闭时也调用 closeFeature()。
```

`onAPIEvent` 返回的取消订阅函数可重复调用。原生对象自身的监听以及对象释放由调用方负责；文件管理器、开放数据管理器或共享 Canvas 不应当作独立可销毁资源。原生对象方法和失败回调不由通用 `callAPI` 自动接管。

## 平台差异与常见错误

微信 `shareAppMessage` 使用 `getAPISync`，没有分享完成回调；返回 `undefined` 不证明分享成功。抖音同名接口使用 `callAPI`，按原生回调处理。需要返回配置的 `onShareAppMessage` 应使用 JavaScript 回调，事件表通知不能替代返回值。

| 错误码 | 首先检查 |
| --- | --- |
| `NOT_READY` | 是否已 Init 并收到 On ready |
| `UNSUPPORTED` | 当前平台、基础库、目录及原生方法是否支持 |
| `WRONG_API_KIND` | 是否按 async / sync / object / event 使用正确入口 |
| `INVALID_JSON` / `INVALID_ARGUMENT` | JSON 内容、对象 / 数组形状、参数类型 |
| `TIMEOUT` / `ABORTED` | 等待是否超时或被项目主动取消 |
| `PLATFORM_ERROR` | 原生失败信息、权限、域名、广告位及业务配置 |
| `CALLBACK_ERROR` | 项目提供的事件处理函数是否抛错 |

当前微信 IDE 的 Modal 还有已知 Worker 错误，原生回调正常不代表该问题已解决。操作步骤和验收边界见[问题排查](../troubleshooting/)与[验证记录](../validation/)。
