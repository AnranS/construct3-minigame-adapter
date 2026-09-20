# TikTok 原生小游戏与 IAP 接入

本项目通过 **`TTMinis.game`** 接入 TikTok Native Mini Games，平台标识为 `tiktok`。它与抖音的 `tt` 独立，不能根据同名 API 推断支持。TikTok 原生 runtime 无需 SDK init；Construct 的 **MiniGameBridge Init** 仍要执行，用来初始化本项目桥接。[官方 SDK 概览](https://developers.tiktok.com/docs/en/mini-games-sdk-overview)

当前提供客户端支付调用、应用后端轮询工具及服务器 Webhook 验签辅助。**没有 TikTok IDE、真机或真实支付验证，也没有内置订单服务、商品数据库或发货系统。** 下文描述你需要接入自己服务端的职责，不代表这些服务已经部署。

## 支付流程与发货依据

建议把购买过程分成四个明确阶段：

1. 游戏向自己的已鉴权后端请求购买，后端确定商品、金额、币种及用户，创建订单并返回 `trade_order_id`。
2. 用户确认购买后，客户端调用 `TTMinis.game.pay`，由平台展示支付面板。
3. 服务器接收平台 Webhook，验签、核对订单归属及金额，并在持久化事务中幂等发货。
4. 游戏查询自己的后端，取得订单与发货状态后刷新资产。

**客户端 success / complete 只用于结束客户端面板流程，不是已付款或可发货证明。** 即使应用退出或回调丢失，后端仍应能处理通知；即使同一通知多次到达，也只能发放一次。此流程依据用户提供并标记为 **L1 公开**的 [TikTok IAP 接入说明](https://bytedance.sg.larkoffice.com/docx/MYsLdpeGGoulzDxZ6VelG8Gggoe)，本文仅摘述集成要点。

## 已登记的 TikTok 支付 API

| API | options 重点 | 结果的边界 |
| --- | --- | --- |
| `checkBalance` | `amount`、`type: "BEANS"` | 查询是否足够，结果含 `is_sufficient`；不创建或确认订单 |
| `pay` | 后端创建的 `trade_order_id` | 调起支付面板，使用 success / fail / complete |
| `navigateToBalance` | `type: "BEANS"` | 打开余额页面，不代表充值或支付完成 |

以上使用独立的 TikTok 回调协议，来源为 [TikTok In-App Purchases](https://developers.tiktok.com/docs/en/mini-games-sdk-payment)。`recharge` 在官方概览与不同版本详细文档中的信息不一致，当前版本暂未登记；不会猜测参数或从抖音接口映射。

## 在 Construct 事件表中调用

先执行 MiniGameBridge **Init** 并等待 **On ready**。然后使用已有的 **Call API**，无需添加新的支付动作：

```text
API name: "pay"
Options JSON: {"trade_order_id":"由自己的后端返回"}
Tag: "purchase-panel"

On API succeeded("purchase-panel")
  开始查询自己的订单后端；不要在这里发放道具。

On error，且 LastAPITag = "purchase-panel"
  展示客户端操作结果，并向自己的后端确认订单状态。
```

JSON 中的订单号必须是服务端返回的实际值。原生 pay 的成功回调可以没有数据，`LastResultIsJSON = 0` 不等于失败。tag 区分购买操作，但不能代替服务器的订单 ID 或幂等键。

## JavaScript 支付辅助接口

可以继续使用插件实例 `callAPI("pay", {trade_order_id})` 获取原生返回值。额外的运行时辅助接口会显式标记发货尚未确认：

```js
const bridge = globalThis.C3MiniGameBridge;

async function openTikTokPayment(tradeOrderId) {
  if (bridge.getPlatform() !== "tiktok" || !bridge.supportsAPI("pay")) {
    throw new Error("TikTok pay is not available in this host");
  }
  return bridge.pay({ trade_order_id: tradeOrderId });
}
```

成功返回的结构为：

```js
const clientResult = {
  platform: "tiktok",
  clientStatus: "completed",
  fulfillment: "unconfirmed",
  result: undefined // 原生 success 若带数据，这里保留原值。
};
```

这里的 `bridge` 是转换器安装的全局运行时对象，**不是** Construct 的 MiniGameBridge 插件实例。`pay` 辅助接口不创建订单、不发货、不自动重试；同一个桥接实例已有支付等待时会拒绝再次发起。取消等待也不保证原生面板已关闭或订单不会结算。

微信运行时的同名辅助方法调用 `requestMidasPayment`，原样传递微信 options，结果同样保持 `fulfillment: "unconfirmed"`。需要微信 `requestMidasPaymentGameItem` 时，应通过 `callAPI` 显式选择该接口和对应参数。TikTok 的 `trade_order_id` 不能当作微信参数使用。

## 查询自己的后端订单

`src/runtime/payment.js` 导出 `pollPaymentOrder`，`bridge.js` 也重新导出它。它只调用你传入的 `queryOrder`，没有内置平台密钥或平台服务端请求。用于 Construct 项目时，将这个独立模块加入项目 Scripts，再从项目脚本引用；不要引用导出目录外的源文件。

下面的 `queryOrder` 是**自己的已鉴权后端函数**，需要按项目实现。它接收订单 ID 和 AbortSignal，返回经过授权检查的本应用订单数据：

```js
import { pollPaymentOrder } from "./payment.js";

export async function waitForPurchase(orderId, queryOrder, signal) {
  return pollPaymentOrder({
    orderId,
    queryOrder,
    intervalMs: 1500,
    timeoutMs: 20000,
    signal
  });
}
```

`queryOrder(orderId, {signal})` 需返回以下结构中的一种：

```json
{
  "orderId": "同一个应用订单ID",
  "status": "pending"
}
```

| 本应用状态 | 如何处理 |
| --- | --- |
| `pending` | 尚未确认，继续等待或稍后再查 |
| `fulfilled` | 后端已完成发货，可刷新资产；客户端不再重复加道具 |
| `failed` / `cancelled` | 显示结果，新一次购买重新创建订单 |
| `refunded` | 展示退款状态，资产处理由后端策略执行 |

这些状态是**本工具约定的应用后端状态，不是 TikTok 原生订单枚举**。`orderId` 必须与本次查询一致，否则函数拒绝接受响应。

默认每 1.5 秒查询一次，等待最多 20 秒。可按业务在约 1–2 秒间隔、15–30 秒等待窗口内配置；超时返回 `{orderId, status: "pending", timedOut: true}`。超时、网络失败或页面关闭都不能推断订单失败，更不能据此重复扣款。用户明确取消或失败后重新购买，应创建新订单；原订单后续通知仍需服务端正确处理。

## 服务器 Webhook 验签辅助

`src/server/tiktok-webhook.mjs` 仅用于 Node.js 服务器，不能导入 Construct 或任何客户端包。服务器从安全配置中读取自己的 `clientSecret`、`clientKey`，接收**未经 JSON 重新序列化的原始请求体 Buffer**：

```js
import { verifyTikTokWebhook } from "./src/server/tiktok-webhook.mjs";

export function verifyPaymentEvent(rawBody, signatureHeader, config) {
  return verifyTikTokWebhook({
    rawBody,
    signatureHeader,
    clientSecret: config.clientSecret,
    clientKey: config.clientKey,
    environment: config.environment, // 必须为 "sandbox" 或 "production"
    toleranceSeconds: 300
  });
}
```

函数校验 `TikTok-Signature`、以时间戳和原始请求体计算 HMAC-SHA256、检查时间窗口、client key、支持的交易事件和 sandbox 标志。签名处理参考 [TikTok Webhooks Verification](https://developers.tiktok.com/docs/en/webhooks-verification)。原始请求体处理不正确时，重新 JSON.stringify 得到的内容可能与签名载荷不同。

**验签成功还不是发货完成。** 返回值只包含已验证事件及订单标识；项目服务端仍需查自己的订单、校验用户/金额/商品、处理事件幂等和退款状态，并在数据库事务中完成状态更新与发货。辅助函数不实现这些业务或持久化逻辑。sandbox 与 production 使用明确配置隔离，不把测试通知用于正式发货。

## 上线前验证

当前已有实现和自动化契约检查，尚无 TikTok IDE、真机或真实交易证据。自己的接入至少应覆盖面板成功与取消、余额不足、pending、网络中断、客户端退出、重复/迟到通知、签名错误、环境不符及退款路径。

最终以自己的后端权威记录确认发货，分别记录测试环境和正式环境。三平台目录与既有微信实测边界见 [API 参考](https://anrans.github.io/construct3-minigame-adapter/api/)和[验证记录](https://anrans.github.io/construct3-minigame-adapter/validation/)。
