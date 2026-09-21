# TikTok Native Mini Games and IAP integration

This project integrates TikTok Native Mini Games through **`TTMinis.game`**, using the platform identifier `tiktok`. It is separate from Douyin's `tt`; matching API names do not imply support. The TikTok native runtime requires no SDK init. Construct's **MiniGameBridge Init** is still required to initialize this project's bridge. [Official SDK overview](https://developers.tiktok.com/docs/en/mini-games-sdk-overview)

The current implementation provides client payment calls, application-backend polling utilities, and a server-side Webhook signature-verification helper. **TikTok IDE, physical-device, and real-payment validation have not been completed, and no order service, product database, or fulfillment system is built in.** The sections below describe the responsibilities you must integrate into your own server. They do not imply those services have been deployed.

## Payment flow and fulfillment authority

Separate a purchase into four explicit stages:

1. The game requests a purchase from its own authenticated backend. The backend determines the product, amount, currency, and user, creates an order, and returns `trade_order_id`.
2. After the user confirms the purchase, the client calls `TTMinis.game.pay` and the platform presents its payment panel.
3. The server receives the platform Webhook, verifies its signature, checks order ownership and amount, and fulfills the order idempotently in a persistent transaction.
4. The game queries its own backend and refreshes assets after receiving the order and fulfillment status.

**Client success / complete callbacks only end the client panel flow. They are not proof of payment or authorization to fulfill an order.** The backend must handle notifications even if the app exits or the callback is lost. Repeated delivery of the same notification must grant the purchase only once. This flow follows the user-provided [TikTok IAP integration guide](https://bytedance.sg.larkoffice.com/docx/MYsLdpeGGoulzDxZ6VelG8Gggoe), marked **L1 Public**. This page summarizes only the integration points.

## Registered TikTok payment APIs

| API | Key options | Result limits |
| --- | --- | --- |
| `checkBalance` | `amount`, `type: "BEANS"` | Checks whether the balance is sufficient and returns `is_sufficient`; does not create or confirm an order |
| `pay` | A backend-created `trade_order_id` | Opens the payment panel and uses success / fail / complete |
| `navigateToBalance` | `type: "BEANS"` | Opens the balance page; does not imply a top-up or payment completed |

These entries use TikTok's separate callback protocol, sourced from [TikTok In-App Purchases](https://developers.tiktok.com/docs/en/mini-games-sdk-payment). Information about `recharge` differs between the official overview and versions of the detailed documentation, so it is not registered in this release. The adapter does not guess its parameters or map it from a Douyin API.

## Calling from a Construct event sheet

Run MiniGameBridge **Init** and wait for **On ready**. Then use the existing **Call API** action; no new payment action is needed:

```text
API name: "pay"
Options JSON: {"trade_order_id":"returned-by-your-backend"}
Tag: "purchase-panel"

On API succeeded("purchase-panel")
  Start querying your order backend; do not grant items here.

On error, and LastAPITag = "purchase-panel"
  Show the client operation result and confirm the order status with your backend.
```

The order number in JSON must be the actual value returned by your server. Native pay can invoke success without data, so `LastResultIsJSON = 0` does not mean failure. A tag distinguishes purchase operations but cannot replace the server's order ID or idempotency key.

## JavaScript payment helper

You can continue using plugin instance `callAPI("pay", {trade_order_id})` to receive the native return value. The additional runtime helper explicitly marks fulfillment as unconfirmed:

```js
const bridge = globalThis.C3MiniGameBridge;

async function openTikTokPayment(tradeOrderId) {
  if (bridge.getPlatform() !== "tiktok" || !bridge.supportsAPI("pay")) {
    throw new Error("TikTok pay is not available in this host");
  }
  return bridge.pay({ trade_order_id: tradeOrderId });
}
```

A successful call returns this structure:

```js
const clientResult = {
  platform: "tiktok",
  clientStatus: "completed",
  fulfillment: "unconfirmed",
  result: undefined // Preserves the original data if native success supplies it.
};
```

Here, `bridge` is the global runtime object installed by the converter, **not** the Construct MiniGameBridge plugin instance. The `pay` helper does not create orders, fulfill purchases, or retry automatically. It rejects a new payment while that bridge instance already has one pending. Cancelling the wait does not guarantee that the native panel has closed or that the order will not settle.

The helper with the same name in the WeChat runtime calls `requestMidasPayment`, passing WeChat options unchanged and also retaining `fulfillment: "unconfirmed"`. To use WeChat `requestMidasPaymentGameItem`, explicitly choose that API and its parameters through `callAPI`. TikTok's `trade_order_id` cannot be used as WeChat payment parameters.

## Querying your order backend

`src/runtime/payment.js` exports `pollPaymentOrder`, which is also re-exported by `bridge.js`. It calls only the `queryOrder` function you provide and contains no platform secret or platform server request. For a Construct project, add this standalone module to the project's Scripts and import it from a project script. Do not reference source files outside the export directory.

The `queryOrder` below is **your own authenticated backend function**, which you must implement for your application. It receives an order ID and AbortSignal and returns your application's order data after authorization checks:

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

`queryOrder(orderId, {signal})` must return one of the supported states in this structure:

```json
{
  "orderId": "the-same-application-order-id",
  "status": "pending"
}
```

| Application status | Handling |
| --- | --- |
| `pending` | Not yet confirmed; keep waiting or check again later |
| `fulfilled` | The backend has fulfilled the order; refresh assets without granting items again on the client |
| `failed` / `cancelled` | Show the result and create a new order for a new purchase |
| `refunded` | Show the refund status; the backend's policy governs asset handling |

These states are **application-backend statuses defined by this tool, not TikTok native order enums**. `orderId` must match the current query or the function rejects the response.

By default, polling runs every 1.5 seconds for up to 20 seconds. Adjust it for your application within roughly 1-2 second intervals and a 15-30 second waiting window. A timeout returns `{orderId, status: "pending", timedOut: true}`. A timeout, network failure, or closed page does not establish that the order failed and must not cause a duplicate charge. Create a new order when the user starts another purchase after an explicit cancellation or failure. The server must still correctly process any later notifications for the original order.

## Server-side Webhook signature helper

`src/server/tiktok-webhook.mjs` is for Node.js servers only. Do not import it into Construct or any client bundle. The server reads its `clientSecret` and `clientKey` from secure configuration and receives **the original request-body Buffer, without reserializing its JSON**:

```js
import { verifyTikTokWebhook } from "./src/server/tiktok-webhook.mjs";

export function verifyPaymentEvent(rawBody, signatureHeader, config) {
  return verifyTikTokWebhook({
    rawBody,
    signatureHeader,
    clientSecret: config.clientSecret,
    clientKey: config.clientKey,
    environment: config.environment, // Must be "sandbox" or "production".
    toleranceSeconds: 300
  });
}
```

The function validates `TikTok-Signature`, computes HMAC-SHA256 from the timestamp and original request body, and checks the time window, client key, supported transaction event, and sandbox flag. Signature handling follows [TikTok Webhooks Verification](https://developers.tiktok.com/docs/en/webhooks-verification). If the original body is handled incorrectly, a new JSON.stringify result may differ from the signed payload.

**A valid signature does not mean fulfillment has completed.** The return value contains only the verified event and order identifiers. Your server must still look up its own order, validate user/amount/product, handle event idempotency and refunds, and update state and fulfill the purchase in a database transaction. The helper does not implement that business or persistence logic. Keep sandbox and production separate through explicit configuration, and never use test notifications for production fulfillment.

## Validation before launch

Implementation and automated contract checks are available, but there is no completed TikTok IDE, physical-device, or real-transaction validation. Your integration should at least cover panel success and cancellation, insufficient balance, pending states, network loss, client exit, duplicate/late notifications, invalid signatures, environment mismatches, and refunds.

Use your backend's authoritative records to confirm fulfillment, and record sandbox and production results separately. See the [API reference](../api/) and [Validation records](../validation/) for the three-platform directory and the limits of existing WeChat tests.
