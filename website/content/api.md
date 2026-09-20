# API 参考

适配层登记了 **{{API_COUNT}} 个唯一 API 名称、{{CATEGORY_COUNT}} 类能力**：微信目录 {{WECHAT_COUNT}} 个、抖音 {{DOUYIN_COUNT}} 个、TikTok {{TIKTOK_COUNT}} 个。下方目录直接从运行时代码生成，同名接口会合并展示，调用种类和平台差异仍保留。

**目录覆盖不等于目标环境可用，更不等于全部实测通过。** 基础库版本、运行域、用户授权和业务配置都会影响调用。先用 `supportsAPI()` 或 `getCapabilities()` 检查当前宿主，再处理真实返回结果。能力检查只检查目录及原生方法是否存在，不登录、不申请权限、不拉起分享，也不会发送网络请求。当前支付入口按平台独立登记；客户端回调不能替代服务端订单确认。

## 六个通用接口

| 接口 | 对应目录种类 | 返回结果 |
| --- | --- | --- |
| `callAPI(name, options, control)` | `async` | Promise；由原生成功或失败回调结束，返回原生成功结果 |
| `getAPISync(name, ...args)` | `sync` | 同步返回原值，保留原生位置参数；同步不表示只读 |
| `createAPIObject(name, options)` | `object` | 返回原生对象本身，不把句柄序列化成 JSON |
| `onAPIEvent(name, callback)` | `event` | 返回取消订阅函数，重复取消安全 |
| `supportsAPI(name)` | 全部 | 当前宿主是否提供该目录项所需方法 |
| `getCapabilities()` | 全部 | 当前目录的能力记录，含 `name`、`kind`、`category`、`platform`、`supported` 及不可用时的 `reason` |

接口只接受目录中的精确名称。缺少方法会报告 `UNSUPPORTED`，用错调用种类会报告 `WRONG_API_KIND`。例如 `connectSocket` 属于对象入口，应使用 `createAPIObject()`，然后等待真实 `onOpen`。

在 Construct 脚本中，先取得插件实例并完成初始化：

```js
const bridge = runtime.objects.MiniGameBridge.getFirstInstance();
await bridge.init();

if (bridge.supportsAPI('getNetworkType')) {
  const result = await bridge.callAPI('getNetworkType');
  const networkType = result.networkType;
}
```

事件表可使用 Call API、Read synchronous API、Subscribe / Unsubscribe to API event；常用功能也有快捷动作。先执行 Init，并在 On ready 之后调用。原生对象、二进制和必须返回对象的事件回调适合在 JavaScript 中处理。

## 完成、超时与取消

`control` 支持 `timeoutMs`、`signal` 和 `onTask`。普通异步接口默认 30 秒超时；弹窗、授权、键盘、选图等交互接口默认不设超时。`timeoutMs: 0` 表示不设超时，显式传入正数可以覆盖默认值。

```js
const pending = bridge.callAPI(
  'getStorage',
  { key: 'my-game/save' },
  { timeoutMs: 5000 }
);

try {
  const result = await pending;
  // 按原生协议使用 result.data。
} catch (error) {
  // 按 error.code 区分 TIMEOUT、ABORTED、PLATFORM_ERROR 等。
}
```

直接运行时和插件实例的 `callAPI()` 都保留返回 Promise 的 `.abort()`；也可以传 `control.signal`。`control.onTask(task)` 可取得尚在等待中的原生任务，用于进度监听等操作。

取消会结束本次等待，并在原生任务支持时调用其 `abort()`。这不会自动关闭原生弹窗，也不保证撤回已经完成的写入或外部操作。RequestTask、DownloadTask、UploadTask 是控制句柄，取得它们不代表业务成功。

成功、失败和 complete 回调最多执行一次。仅有 complete 的原生实现需要返回明确的 `errMsg` 状态；没有可判断结果时报告 `PROTOCOL_ERROR`。网络请求即使进入 success，也应另行判断 `statusCode` 和业务字段。同步抛错、回调抛错、资源清理失败都不会被转换成成功。

## 事件与原生对象

普通事件订阅要求原生 `on...` 和对应 `off...` 同时存在。目录显式登记的全量 off / 无 off 特例只停用自己的回调，保留其他监听；没有物理移除原生监听的保证。回调保留所有参数、原生 `this` 和返回值。退出场景或销毁业务模块时，调用返回的取消订阅函数：

```js
const unsubscribe = bridge.onAPIEvent('onNetworkStatusChange', event => {
  // 按 event.isConnected 等原生字段更新自己的状态。
});

// 场景退出时：
unsubscribe();
```

`createAPIObject()` 返回的音频、广告、视频、SocketTask 等对象由调用方管理。按对应平台协议移除对象监听，并在适当时机调用 `destroy()` 或 `close()`；管理器和共享 Canvas 不应被当成可随意销毁的独立资源。

```js
const audio = bridge.createAPIObject('createInnerAudioContext');
const onEnded = () => {
  audio.offEnded(onEnded);
  audio.destroy();
};
audio.onEnded(onEnded);
audio.src = 'game/beep.wav'; // 当前示例包内音频；业务项目替换为自己的路径。
audio.play();
```

实际项目还应处理音频 error、主动停止和场景退出。插件实例释放会清理该实例的事件订阅；不会销毁其他实例正在使用的全局桥接，也不会接管所有返回原生对象的生命周期。

## 平台语义差异

| 能力 | 微信 | 抖音 | TikTok Native |
| --- | --- | --- | --- |
| 宿主命名空间 | `wx` | `tt` | `TTMinis.game`，不复用 `tt` |
| 初始化 | 插件 Init 设置本项目桥接 | 插件 Init 设置本项目桥接 | 原生 SDK 无需 init；插件 Init 仍需执行 |
| `shareAppMessage` | `sync`，无完成回调 | `async`，使用原生回调 | 独立 `async` 契约，按 TikTok 目录与官方参数调用 |
| Web Audio 原生入口 | `createWebAudioContext` | `getAudioContext` | `createWebAudioContext` |
| 菜单布局 | `getMenuButtonBoundingClientRect` | `getMenuButtonLayout` | `getMenuButtonBoundingClientRect` |
| 支付 | 按微信支付接口与配置使用 | 仅目录明确登记的接口可用 | `pay({trade_order_id})`，回调不确认发货 |


`onShareAppMessage` 需要 JavaScript 回调返回分享配置，事件表收到一次通知不能替代这个返回对象。`connectSocket` 返回真实 SocketTask，是否连接成功看 `onOpen`，而不是对象是否已经创建。

浏览器式 `fetch`、XHR、WebSocket、Audio 等运行时适配另有兼容边界；目录中的原生入口并不意味着完整浏览器标准已经实现。平台网络域名、权限、隐私配置、广告位及开放数据域要求仍由业务项目配置。

## 如何理解验证结果

0.3.0 已完成真实 Construct r495.2 重新导出和三端转换，本机回归 255 项通过、0 项失败。本轮微信 IDE 已验证启动、53 个入口和分类/返回导航，未运行新版自检或点击支付测试入口；TikTok IDE、真机及真实支付尚未验证。

0.2.0 运行时基线有 **213 项自动化回归通过**，其中许多使用受控原生 API 夹具验证成功、失败、取消及资源清理。真实微信 IDE 的 17 项常用自检全部通过，并验证了部分界面、键盘和音频交互。该历史微信宿主探测到 133 / 171 项可用方法；这个数字不是成功调用数。

抖音 IDE、TikTok IDE、三端真机及全部接口尚未逐项验收；TikTok 真实支付尚未验证。微信 IDE 原生 Modal 的确认和取消回调正常，但仍可触发已定位的 IDE 内部 `worker path empty` 错误。请结合验证记录选择自己的测试范围。

原生失败的 `message`、`cause`、响应数据可能包含业务信息。公开诊断建议只记录 `error.code`、`operation` 和平台，不输出登录临时代码、剪贴板内容或请求载荷。

## TikTok 来源与支付边界

TikTok 目录独立维护于源码，依据 [Mini Games SDK Overview](https://developers.tiktok.com/docs/en/mini-games-sdk-overview) 与各分类公开文档；目录同名不会自动继承微信或抖音支持。原生对象上的 `readFile`、音频、SocketTask 等方法仍属于返回的对象，不作为 `TTMinis.game` 顶层方法调用。

支付可使用事件表 Call API / 插件实例 `callAPI("pay", ...)`；额外的运行时 `C3MiniGameBridge.pay()` 帮助区分客户端完成与发货未确认。服务器收到并验证 Webhook、核对订单并幂等发货后，客户端查询自己的后端获取最终结果。详见 [TikTok IAP](../tiktok-iap/)。
