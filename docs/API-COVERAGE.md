# API 覆盖与调用约定

本说明对应 0.2.0 的 [platform-api.js](../src/runtime/platform-api.js) 和 [bridge.js](../src/runtime/bridge.js)。目录包含 **171 个唯一 API 名称、20 类能力**；微信纳入 142 个名称，抖音纳入 140 个名称。同名接口可能有不同调用种类，例如分享。

这里的“纳入目录”表示适配层允许按指定原生协议调用，不表示每个基础库都支持，也不表示接口已获授权、广告有填充、网络域名已配置或业务执行成功。`supported` 只检查当前平台的目录项和原生函数是否存在；事件还要求对应 `off...` 存在。能力查询不调用业务 API，不登录、不申请权限、不发起分享、请求或支付。当前目录不包含支付。

## 6 个通用接口

| 接口 | 用途与结果 |
| --- | --- |
| `callAPI(name, options = {}, control = {})` | 调用 `async` 接口，Promise 返回原生成功回调的原值；原生任务句柄不是成功结果 |
| `getAPISync(name, ...args)` | 调用 `sync` 接口并立即返回原值；位置参数和原生接收者保持不变。sync 表示同步，**不表示只读** |
| `createAPIObject(name, options = {})` | 调用 `object` 工厂或管理器入口，返回原生对象本身；不包装成 JSON、不修改对象身份 |
| `onAPIEvent(name, callback)` | 订阅 `event`，返回幂等的取消订阅函数；保留回调的全部参数、原生 `this` 和返回值 |
| `supportsAPI(name)` | 返回当前环境的方法是否可用；未知名称或缺少原生方法返回 false |
| `getCapabilities()` | 返回目录数组，每项含 `name`、`kind`、`category`、`platform`、`supported`；不可用时含 `reason` |

Construct 事件表可使用 Call API、Read synchronous API、Subscribe / Unsubscribe to API event，也提供 toast、modal、存储、网络类型、剪贴板和键盘等快捷动作。插件实例先 Init，再等待 On ready。完整动作、tag 和结果表达式见 [插件说明](../addon/README.md)。缺少原生方法时明确报 `UNSUPPORTED`；用错调用种类时报 `WRONG_API_KIND`。

`PLATFORM_API_CATALOG` 和 `PLATFORM_API_CATEGORIES` 从 runtime 模块导出，是本页表格的数据来源。目录只允许精确名称，不接受任意属性路径或未登记方法。

## 异步完成、超时与取消

`callAPI` 的控制参数是 `{timeoutMs, signal, onTask}`。普通 API 默认超时 30000 毫秒；运行时桥接可通过 `init({apiTimeoutMs})` 调整普通调用默认值。`timeoutMs: 0` 关闭超时。Modal、ActionSheet、键盘、扫码、选图、授权、分享等交互调用默认不设超时，显式 `control.timeoutMs` 可覆盖。

成功、失败及 complete 最多触发一次；complete 在对应成功或失败回调后执行。原生只触发 complete 时，仅明确的 `errMsg: "方法名:ok"` 或失败状态能够结束调用；没有可判断结果会拒绝为 `PROTOCOL_ERROR`。同步抛错、原生 fail、回调异常和资源清理异常都可观察，不以返回了 RequestTask、DownloadTask 或 UploadTask 作为成功依据。HTTP 请求的原生成功只表示收到了响应，调用方仍应检查 `statusCode` 和业务字段。

`control.onTask` 可取得仍在等待中的原生任务，用于平台支持的进度监听或取消。使用 `AbortSignal` 或返回 Promise 的 `.abort()` 会结束本次等待；只有原生任务提供 `abort()` 时才同时调用它。**取消等待不会自动关闭原生 Modal，不保证撤回已经执行的写入或外部操作。** 插件实例的 `callAPI` 同样透传 `.abort()`，也可使用 `control.signal`。

直接运行时调用示例：

```js
const api = globalThis.C3MiniGameBridge;
const pending = api.callAPI("getStorage", {key: "my-game/save"}, {timeoutMs: 5000});
try {
  const result = await pending;
  // 使用原生 result.data；不要将账户、剪贴板或存储内容写入公开日志。
} catch (error) {
  // error.code / error.operation 用于选择错误处理分支。
}
```

错误码包括 `UNSUPPORTED`、`WRONG_API_KIND`、`INVALID_ARGUMENT`、`TIMEOUT`、`ABORTED`、`DISPOSED`、`PLATFORM_ERROR`、`CALLBACK_ERROR`、`PROTOCOL_ERROR` 和 `CLEANUP_ERROR`。`PlatformAPIError.toJSON()` 只输出安全诊断字段，不序列化 options、响应、原生错误文本或 cause；原始 cause 非枚举地保留供本地排查。原生 message/cause 仍可能含业务信息，不应直接放入公开日志。结果数据保持原生值；插件的 JSON 表达式对无法忠实表示的二进制、Date、原生句柄或循环对象留空，并提供 IsJSON / Type 标记。

## 原生对象和事件生命周期

`createAPIObject` 返回的音频、广告、视频、SocketTask、文件管理器和开放数据对象，由调用方按原生文档使用。需要释放的对象应显式 `destroy()` / `close()`，对象自身的 on/off 监听也由调用方管理；管理器或 sharedCanvas 不应被当作可随意销毁的独立资源。文件管理器的读写方法、SocketTask 的 send/onOpen、开放数据对象的 postMessage 等仍按对应平台原生协议调用。

桥接 dispose 会拒绝自身未完成的 callAPI、取消可取消的任务，并尝试移除所有通过 onAPIEvent 注册的监听。某个原生 off 抛错时仍继续清理其他订阅，并报告失败；晚到回调不再交给已释放的订阅。插件实例释放只清理该实例的订阅，不销毁共享全局桥接。全局事件缺少 off 方法时，本层不会创建无法移除的订阅。

专用 `showRewardedVideo` 是例外：它自己创建广告并管理广告的监听、重试和销毁。只在原生 close 明确返回 `isEnded === true` 时报告 completed；取消或缺少结束状态均不是已完成。广告显示 Promise 成功只表示显示成功，奖励必须等实际 close。重复 close/error、注册到一半失败、off/destroy 抛错和 dispose 后异步 load 完成都已覆盖回归，清理失败不伪装成成功。

## 分享、网络和音频的差异

| 能力 | 当前语义 |
| --- | --- |
| 微信 `shareAppMessage` | 目录种类为 sync。使用 `getAPISync("shareAppMessage", options)` 显式拉起分享；官方接口无完成回调，undefined 返回值不证明分享成功 |
| 抖音 `shareAppMessage` | 目录种类为 async。使用 callAPI，按原生 success / fail 结束；素材、渠道和用户点击要求仍由平台决定 |
| `onShareAppMessage` | 使用 JavaScript 回调返回分享配置；事件表的通知不能替代所需的返回对象。订阅仍要求原生 off 存在 |
| 原生 `connectSocket` | createAPIObject 返回真实 SocketTask；创建或调用成功回调不等于已连接，实际连接看 onOpen |
| WebSocket 接口 | 运行时另提供浏览器式 WebSocket 桥接：独立 SocketTask、真实 OPEN/CLOSE、文本和二进制、Blob 转换、有序发送、binaryType、bufferedAmount 与关闭参数校验。域名、TLS、子协议和并发限制仍来自平台 |
| fetch / XHR | 支持包内文件、data URL 和原生 request；保留 HTTP 失败状态及真实字节。XHR 已修复重发、换请求、事件重入、取消/超时、旧响应覆盖和清理问题；无同步 XHR、响应流、完整 cookie/credentials 或 overrideMimeType |
| Audio | 使用原生 createInnerAudioContext。play 等实际播放事件；重复 play 共用等待，暂停、换源、stop、销毁会结束未完成的等待。修复静音恢复音量、布尔属性、seek 状态、注册失败与销毁异常清理 |
| Web Audio | API 目录列出微信 createWebAudioContext 与抖音 getAudioContext，不把两者宣称为同一个完整标准。浏览器式 AudioContext 仅在宿主确实提供 createWebAudioContext 时暴露，完整解码器、效果链及显式 sampleRate 等仍有边界 |

这些浏览器接口桥接不扩大平台网络权限，不自动替项目填写域名、请求权限或建立外部连接；也不代表所有 Construct 插件、编解码器和平台版本都兼容。

## 配置与验证范围

| 功能 | 项目需要提供或验证 |
| --- | --- |
| 平台运行 | 自己的 AppID、目标基础库、真实设备；IDE 方法存在不等于真机行为一致 |
| 网络 / 下载 / 上传 / WebSocket | 自己的服务地址、平台允许的域名、HTTPS/WSS 及服务端协议；HTTP 与业务状态分别判断 |
| 登录 | 将临时代码交给自己的服务端交换身份；AppSecret 留在服务端，不自动上报登录 code |
| 广告 | 真实广告位、平台开通状态和测试条件；缺少广告库存或未完整观看不发放奖励 |
| 分享 / 用户信息 / 位置 / 相册 / 录音等 | 对应权限、平台隐私配置、用户操作和素材/场景条件；适配层不绕过它们，也不自动申请 |
| 本地存储 / 文件 | 选择项目专用键和路径；通用原生存储 API 不加前缀，clearStorage 会影响原生存储空间；文件路径及容量限制遵从平台 |
| 开放数据 / 榜单 | 对应域配置、平台身份和访问权限；主域和开放数据域 API 不是互换使用，支持探测不证明榜单已可用 |
| 自定义成绩服务 | 明确 HTTPS scoreEndpoint 与自己的业务服务；不是平台内置排行榜的模拟实现 |

当前全量自动化记录为 **213 项通过、0 项失败**；最终交付测试数字与 IDE / 真机结果以 [验证记录](VALIDATION.md) 的最新复测为准。测试覆盖调用层与运行时的契约和失败路径，其中大量使用受控原生 API 夹具，不能当作全部 171 个接口的目标设备验收。

新版 `MiniGameApiSuite` 已完成真实 Construct r495.2 编辑器导出及两端构建，页面有 11 个分类、51 个功能入口。微信 IDE 基础库 3.15.3 已观察到 WebGL2 渲染和真实 `runtime-ready`，启动为 0 项错误、2 项警告；iPhone 12 和 iPad Pro 12.9 模拟器配置在完整重开项目后均正常显示，不能视为两台真机验证。17 项常用自检实际结果为 **17 成功、0 失败、0 跳过**，并已从真实运行时控制台读回确认；这些自检不主动请求授权、分享或连接外网，会读设备信息并操作本示例专用存储键和临时文件。当前 IDE 宿主能力探测为 **133 / 171**，只表示方法可用，不代表 133 项业务调用成功。新版已完成 Toast、操作菜单、Loading、键盘输入/完成、音频停止/结束等部分交互验收，具体边界见验证记录；抖音 IDE、两端真机及需要外部配置的功能尚未完成验收。历史 21 项 `WeChatApiDemo` 的归档文件位于 `examples/construct/archive/`，其旧结果不能直接代替新版结果。

**已知未解决问题：微信 IDE 原生 Modal 触发 `worker path empty`。** 基础库 3.15.3、完整重开后的 3.12.1 都复现，弹窗仍会显示。实际请求 URL 正确包含 `libName=WAAccelerateWorker.js`；本机源码与隔离函数复现已定位 IDE 转发 URL 时丢失该查询参数。此为本机调查结论，未获官方确认，也没有交付验证过的修复。新版 Modal 确认与取消回调正常，但仍触发此错误。见 [微信调试记录](WECHAT-DEBUGGING.md)。本层不修改微信内部 Worker、不屏蔽错误、不用伪造成功替代原生弹窗。

## 分类概览

| 分类 | 唯一 API 名称数 | 调用种类 |
| --- | ---: | --- |
| 系统信息 | 21 | `sync`、`async`、`object` |
| 生命周期 | 11 | `event`、`async`、`sync` |
| 渲染与字体 | 5 | `object`、`sync` |
| 触摸、键鼠 | 10 | `event` |
| 原生界面 | 6 | `async` |
| 原生键盘 | 6 | `async`、`event` |
| 剪贴板 | 2 | `async` |
| 本地存储 | 10 | `async`、`sync` |
| 网络与连接 | 6 | `async`、`event`、`object` |
| 文件 | 1 | `object` |
| 设备与传感器 | 22 | `async`、`event` |
| 音频与录音 | 6 | `object`、`async` |
| 图像、视频与录屏 | 11 | `async`、`object` |
| 登录与设置 | 9 | `async` |
| 分享 | 6 | `async`、`event`、`sync` |
| 跳转与回访 | 10 | `async` |
| 广告 | 6 | `object` |
| 开放数据与榜单 | 14 | `object`、`async`、`event` |
| 原生按钮 | 7 | `object` |
| 数据分析 | 2 | `sync`、`async` |

## 完整目录

以下表格由代码目录生成。平台列表示该平台被纳入此调用协议，**不表示其全部版本、场景、权限和当前设备都可用**。按当前宿主实际 getCapabilities 结果调用。

| 分类 | API 名称 | 种类 | 纳入目录的平台 |
| --- | --- | --- | --- |
| 系统信息 | `canIUse` | `sync` | 微信、抖音 |
| 系统信息 | `getSystemInfoSync` | `sync` | 微信、抖音 |
| 系统信息 | `getLaunchOptionsSync` | `sync` | 微信、抖音 |
| 系统信息 | `getWindowInfo` | `sync` | 微信 |
| 系统信息 | `getDeviceInfo` | `sync` | 微信 |
| 系统信息 | `getAppBaseInfo` | `sync` | 微信 |
| 系统信息 | `getSystemSetting` | `sync` | 微信 |
| 系统信息 | `getAppAuthorizeSetting` | `sync` | 微信 |
| 系统信息 | `getEnterOptionsSync` | `sync` | 微信 |
| 系统信息 | `getAccountInfoSync` | `sync` | 微信 |
| 系统信息 | `getBatteryInfoSync` | `sync` | 微信 |
| 系统信息 | `getMenuButtonBoundingClientRect` | `sync` | 微信 |
| 系统信息 | `getEnvInfoSync` | `sync` | 抖音 |
| 系统信息 | `getMenuButtonLayout` | `sync` | 抖音 |
| 系统信息 | `getSystemInfo` | `async` | 微信、抖音 |
| 系统信息 | `getSystemInfoAsync` | `async` | 微信 |
| 系统信息 | `getBatteryInfo` | `async` | 微信 |
| 系统信息 | `getPerformance` | `object` | 微信、抖音 |
| 系统信息 | `getUpdateManager` | `object` | 微信、抖音 |
| 系统信息 | `getLogManager` | `object` | 微信、抖音 |
| 系统信息 | `getRealtimeLogManager` | `object` | 微信、抖音 |
| 生命周期 | `onShow` | `event` | 微信、抖音 |
| 生命周期 | `onHide` | `event` | 微信、抖音 |
| 生命周期 | `onError` | `event` | 微信、抖音 |
| 生命周期 | `onMemoryWarning` | `event` | 微信、抖音 |
| 生命周期 | `onWindowResize` | `event` | 微信、抖音 |
| 生命周期 | `onUnhandledRejection` | `event` | 微信 |
| 生命周期 | `onAudioInterruptionBegin` | `event` | 微信 |
| 生命周期 | `onAudioInterruptionEnd` | `event` | 微信 |
| 生命周期 | `exitMiniProgram` | `async` | 微信、抖音 |
| 生命周期 | `loadSubpackage` | `async` | 微信、抖音 |
| 生命周期 | `restartMiniProgramSync` | `sync` | 抖音 |
| 渲染与字体 | `createCanvas` | `object` | 微信、抖音 |
| 渲染与字体 | `createImage` | `object` | 微信、抖音 |
| 渲染与字体 | `createOffscreenCanvas` | `object` | 微信 |
| 渲染与字体 | `loadFont` | `sync` | 微信、抖音 |
| 渲染与字体 | `setPreferredFramesPerSecond` | `sync` | 微信、抖音 |
| 触摸、键鼠 | `onTouchStart` | `event` | 微信、抖音 |
| 触摸、键鼠 | `onTouchMove` | `event` | 微信、抖音 |
| 触摸、键鼠 | `onTouchEnd` | `event` | 微信、抖音 |
| 触摸、键鼠 | `onTouchCancel` | `event` | 微信、抖音 |
| 触摸、键鼠 | `onKeyDown` | `event` | 微信、抖音 |
| 触摸、键鼠 | `onKeyUp` | `event` | 微信、抖音 |
| 触摸、键鼠 | `onMouseDown` | `event` | 微信、抖音 |
| 触摸、键鼠 | `onMouseMove` | `event` | 微信、抖音 |
| 触摸、键鼠 | `onMouseUp` | `event` | 微信、抖音 |
| 触摸、键鼠 | `onWheel` | `event` | 微信、抖音 |
| 原生界面 | `showToast` | `async` | 微信、抖音 |
| 原生界面 | `hideToast` | `async` | 微信、抖音 |
| 原生界面 | `showLoading` | `async` | 微信、抖音 |
| 原生界面 | `hideLoading` | `async` | 微信、抖音 |
| 原生界面 | `showModal` | `async` | 微信、抖音 |
| 原生界面 | `showActionSheet` | `async` | 微信、抖音 |
| 原生键盘 | `showKeyboard` | `async` | 微信、抖音 |
| 原生键盘 | `hideKeyboard` | `async` | 微信、抖音 |
| 原生键盘 | `updateKeyboard` | `async` | 微信、抖音 |
| 原生键盘 | `onKeyboardInput` | `event` | 微信、抖音 |
| 原生键盘 | `onKeyboardConfirm` | `event` | 微信、抖音 |
| 原生键盘 | `onKeyboardComplete` | `event` | 微信、抖音 |
| 剪贴板 | `getClipboardData` | `async` | 微信、抖音 |
| 剪贴板 | `setClipboardData` | `async` | 微信、抖音 |
| 本地存储 | `getStorage` | `async` | 微信、抖音 |
| 本地存储 | `setStorage` | `async` | 微信、抖音 |
| 本地存储 | `removeStorage` | `async` | 微信、抖音 |
| 本地存储 | `clearStorage` | `async` | 微信、抖音 |
| 本地存储 | `getStorageInfo` | `async` | 微信、抖音 |
| 本地存储 | `getStorageSync` | `sync` | 微信、抖音 |
| 本地存储 | `setStorageSync` | `sync` | 微信、抖音 |
| 本地存储 | `removeStorageSync` | `sync` | 微信、抖音 |
| 本地存储 | `clearStorageSync` | `sync` | 微信、抖音 |
| 本地存储 | `getStorageInfoSync` | `sync` | 微信、抖音 |
| 网络与连接 | `request` | `async` | 微信、抖音 |
| 网络与连接 | `downloadFile` | `async` | 微信、抖音 |
| 网络与连接 | `uploadFile` | `async` | 微信、抖音 |
| 网络与连接 | `getNetworkType` | `async` | 微信、抖音 |
| 网络与连接 | `onNetworkStatusChange` | `event` | 微信、抖音 |
| 网络与连接 | `connectSocket` | `object` | 微信、抖音 |
| 文件 | `getFileSystemManager` | `object` | 微信、抖音 |
| 设备与传感器 | `setKeepScreenOn` | `async` | 微信、抖音 |
| 设备与传感器 | `getScreenBrightness` | `async` | 微信、抖音 |
| 设备与传感器 | `setScreenBrightness` | `async` | 微信、抖音 |
| 设备与传感器 | `vibrateShort` | `async` | 微信、抖音 |
| 设备与传感器 | `vibrateLong` | `async` | 微信、抖音 |
| 设备与传感器 | `startAccelerometer` | `async` | 微信、抖音 |
| 设备与传感器 | `stopAccelerometer` | `async` | 微信、抖音 |
| 设备与传感器 | `startCompass` | `async` | 微信、抖音 |
| 设备与传感器 | `stopCompass` | `async` | 微信、抖音 |
| 设备与传感器 | `startGyroscope` | `async` | 微信、抖音 |
| 设备与传感器 | `stopGyroscope` | `async` | 微信、抖音 |
| 设备与传感器 | `startDeviceMotionListening` | `async` | 微信、抖音 |
| 设备与传感器 | `stopDeviceMotionListening` | `async` | 微信、抖音 |
| 设备与传感器 | `scanCode` | `async` | 微信、抖音 |
| 设备与传感器 | `getLocation` | `async` | 微信、抖音 |
| 设备与传感器 | `onAccelerometerChange` | `event` | 微信、抖音 |
| 设备与传感器 | `onCompassChange` | `event` | 微信、抖音 |
| 设备与传感器 | `onGyroscopeChange` | `event` | 微信、抖音 |
| 设备与传感器 | `onDeviceMotionChange` | `event` | 微信、抖音 |
| 设备与传感器 | `onDeviceOrientationChange` | `event` | 微信、抖音 |
| 设备与传感器 | `setDeviceOrientation` | `async` | 微信、抖音 |
| 设备与传感器 | `onUserCaptureScreen` | `event` | 微信 |
| 音频与录音 | `createInnerAudioContext` | `object` | 微信、抖音 |
| 音频与录音 | `getRecorderManager` | `object` | 微信、抖音 |
| 音频与录音 | `createWebAudioContext` | `object` | 微信 |
| 音频与录音 | `setInnerAudioOption` | `async` | 微信 |
| 音频与录音 | `getAvailableAudioSources` | `async` | 微信 |
| 音频与录音 | `getAudioContext` | `object` | 抖音 |
| 图像、视频与录屏 | `chooseImage` | `async` | 微信、抖音 |
| 图像、视频与录屏 | `previewImage` | `async` | 微信、抖音 |
| 图像、视频与录屏 | `saveImageToPhotosAlbum` | `async` | 微信、抖音 |
| 图像、视频与录屏 | `chooseVideo` | `async` | 微信、抖音 |
| 图像、视频与录屏 | `saveVideoToPhotosAlbum` | `async` | 微信、抖音 |
| 图像、视频与录屏 | `getImageInfo` | `async` | 抖音 |
| 图像、视频与录屏 | `compressImage` | `async` | 微信 |
| 图像、视频与录屏 | `createVideo` | `object` | 微信、抖音 |
| 图像、视频与录屏 | `createOffscreenVideo` | `object` | 抖音 |
| 图像、视频与录屏 | `getGameRecorderManager` | `object` | 抖音 |
| 图像、视频与录屏 | `getGameRecorder` | `object` | 微信 |
| 登录与设置 | `login` | `async` | 微信、抖音 |
| 登录与设置 | `checkSession` | `async` | 微信、抖音 |
| 登录与设置 | `getSetting` | `async` | 微信、抖音 |
| 登录与设置 | `authorize` | `async` | 微信、抖音 |
| 登录与设置 | `openSetting` | `async` | 微信、抖音 |
| 登录与设置 | `requestSubscribeMessage` | `async` | 微信、抖音 |
| 登录与设置 | `openCustomerServiceConversation` | `async` | 微信、抖音 |
| 登录与设置 | `getUserInfo` | `async` | 微信、抖音 |
| 登录与设置 | `showDouyinOpenAuth` | `async` | 抖音 |
| 分享 | `showShareMenu` | `async` | 微信、抖音 |
| 分享 | `hideShareMenu` | `async` | 微信、抖音 |
| 分享 | `onShareAppMessage` | `event` | 微信、抖音 |
| 分享 | `shareAppMessage` | `sync`（微信） / `async`（抖音） | 微信、抖音 |
| 分享 | `onShareTimeline` | `event` | 微信 |
| 分享 | `shareMessageToFriend` | `async` | 抖音 |
| 跳转与回访 | `navigateToMiniProgram` | `async` | 微信 |
| 跳转与回访 | `navigateToScene` | `async` | 抖音 |
| 跳转与回访 | `addShortcut` | `async` | 抖音 |
| 跳转与回访 | `showFavoriteGuide` | `async` | 抖音 |
| 跳转与回访 | `showRevisitGuide` | `async` | 抖音 |
| 跳转与回访 | `openAwemeUserProfile` | `async` | 抖音 |
| 跳转与回访 | `checkScene` | `async` | 抖音 |
| 跳转与回访 | `checkShortcut` | `async` | 抖音 |
| 跳转与回访 | `checkFollowState` | `async` | 抖音 |
| 跳转与回访 | `checkFollowAwemeState` | `async` | 抖音 |
| 广告 | `createBannerAd` | `object` | 微信、抖音 |
| 广告 | `createRewardedVideoAd` | `object` | 微信、抖音 |
| 广告 | `createInterstitialAd` | `object` | 微信、抖音 |
| 广告 | `createCustomAd` | `object` | 微信 |
| 广告 | `createGridAd` | `object` | 微信 |
| 广告 | `createGridGamePanel` | `object` | 抖音 |
| 开放数据与榜单 | `getOpenDataContext` | `object` | 微信、抖音 |
| 开放数据与榜单 | `getSharedCanvas` | `object` | 微信、抖音 |
| 开放数据与榜单 | `setUserCloudStorage` | `async` | 微信、抖音 |
| 开放数据与榜单 | `getUserCloudStorage` | `async` | 微信、抖音 |
| 开放数据与榜单 | `removeUserCloudStorage` | `async` | 微信、抖音 |
| 开放数据与榜单 | `getFriendCloudStorage` | `async` | 微信 |
| 开放数据与榜单 | `getGroupCloudStorage` | `async` | 微信 |
| 开放数据与榜单 | `getCloudStorageByRelation` | `async` | 抖音 |
| 开放数据与榜单 | `setUserGroup` | `async` | 抖音 |
| 开放数据与榜单 | `setImRankData` | `async` | 抖音 |
| 开放数据与榜单 | `getImRankList` | `async` | 抖音 |
| 开放数据与榜单 | `getImRankData` | `async` | 抖音 |
| 开放数据与榜单 | `setImRankDataInOpenContext` | `async` | 抖音 |
| 开放数据与榜单 | `onMessage` | `event` | 微信、抖音 |
| 原生按钮 | `createUserInfoButton` | `object` | 微信 |
| 原生按钮 | `createGameClubButton` | `object` | 微信 |
| 原生按钮 | `createFeedbackButton` | `object` | 微信 |
| 原生按钮 | `createOpenSettingButton` | `object` | 微信 |
| 原生按钮 | `createContactButton` | `object` | 抖音 |
| 原生按钮 | `createFollowButton` | `object` | 抖音 |
| 原生按钮 | `createInteractiveButton` | `object` | 抖音 |
| 数据分析 | `reportAnalytics` | `sync` | 微信、抖音 |
| 数据分析 | `reportScene` | `async` | 抖音 |

## 官方依据

接口名称及调用分组参考 [微信官方小游戏 API 类型定义](https://github.com/wechat-miniprogram/minigame-api-typings/blob/master/types/wx/lib.wx.api.d.ts) 和 [抖音小游戏 JavaScript API 目录](https://developer.open-douyin.com/docs/resource/zh-CN/mini-game/develop/api/javascript-api/overview)，本轮核对日期为 2026-09-20。微信分享的 void 签名与无回调 options 来自官方类型；抖音分享、reportScene 的异步回调分别见 [tt.shareAppMessage](https://developer.open-douyin.com/docs/resource/zh-CN/mini-game/develop/api/javascript-api/open-capacity/retweet/tt-share-app-message)、[tt.reportScene](https://developer.open-douyin.com/docs/resource/zh-CN/mini-game/develop/api/javascript-api/data-analysis/tt-report-scene)。平台权限、版本和业务限制以对应官方文档及实际宿主结果为准。
