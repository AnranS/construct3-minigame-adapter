import {createHmac, timingSafeEqual} from 'node:crypto';

/** Server-only verification; never import into a Construct/client bundle.
 * https://developers.tiktok.com/docs/en/webhooks-verification
 * Verification does not grant goods or implement persistent idempotency. In one
 * database transaction, bind the order/user/amount, confirm its state and grant
 * once. Refunds have separate transitions; a duplicate event must not grant twice.
 */
export function verifyTikTokWebhook({rawBody, signatureHeader, clientSecret, clientKey,
  environment, nowSeconds = Date.now() / 1000, toleranceSeconds = 300} = {}) {
  if (!Buffer.isBuffer(rawBody)) throw new TypeError('rawBody must be the original request bytes as a Buffer');
  if (typeof clientSecret !== 'string' || !clientSecret || typeof clientKey !== 'string' || !clientKey) throw new TypeError('Server clientSecret and clientKey are required');
  if (!['sandbox', 'production'].includes(environment)) throw new TypeError('Explicit sandbox or production environment is required');
  if (!Number.isFinite(nowSeconds) || !Number.isFinite(toleranceSeconds) || toleranceSeconds <= 0) throw new TypeError('Invalid signature time window');
  if (typeof signatureHeader !== 'string') throw new Error('Missing TikTok-Signature');
  const parts = signatureHeader.split(',').map(part => part.trim().split('='));
  const timestamps = parts.filter(([name]) => name === 't');
  const signatures = parts.filter(([name]) => name === 's').map(([, value]) => value);
  if (parts.some(part => part.length !== 2) || timestamps.length !== 1 || !/^\d+$/.test(timestamps[0][1]) || !signatures.length || signatures.some(value => !/^[a-f\d]{64}$/i.test(value))) throw new Error('Invalid TikTok-Signature format');
  const timestamp = timestamps[0][1];
  const seconds = Number(timestamp);
  if (!Number.isSafeInteger(seconds) || Math.abs(nowSeconds - seconds) > toleranceSeconds) throw new Error('Webhook timestamp is outside the allowed window');
  const expected = createHmac('sha256', clientSecret).update(`${timestamp}.`).update(rawBody).digest();
  if (!signatures.some(signature => timingSafeEqual(expected, Buffer.from(signature, 'hex')))) throw new Error('Webhook signature mismatch');
  let event, content;
  try {
    event = JSON.parse(rawBody.toString('utf8'));
    content = typeof event.content === 'string' ? JSON.parse(event.content) : event.content;
  } catch { throw new Error('Invalid webhook JSON'); }
  if (event?.client_key !== clientKey) throw new Error('Webhook belongs to a different client');
  const events = ['minis.trade_order.redeem.success', 'minis.trade_order.redeem.refund_success', 'minis.trade_order.redeem.refund_fail', 'minis.trade_order.redeem.refund_traceback'];
  if (!events.includes(event.event)) throw new Error('Unsupported trade order event');
  if (!content || typeof content.trade_order_id !== 'string' || !content.trade_order_id || typeof content.order_id !== 'string' || !content.order_id || typeof content.is_sandbox !== 'boolean') throw new Error('Missing trade order identity or sandbox flag');
  if (content.is_sandbox !== (environment === 'sandbox')) throw new Error('Webhook sandbox/production mismatch');
  return {event: event.event, clientKey, orderId: content.order_id, tradeOrderId: content.trade_order_id,
    isSandbox: content.is_sandbox, content};
}
