import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {createPlatformBridge} from '../src/runtime/bridge.js';
import {createPlatformAPI} from '../src/runtime/platform-api.js';
import {TIKTOK_API_CATALOG} from '../src/runtime/tiktok-api.js';
import {pollPaymentOrder} from '../src/runtime/payment.js';
import {verifyTikTokWebhook} from '../src/server/tiktok-webhook.mjs';

test('TikTok catalog is independent: no Douyin UI/payment or object-method namespace leakage', async () => {
  const api = Object.fromEntries(['login', 'pay', 'showModal', 'requestMidasPayment', 'recharge', 'readFile'].map(name => [name, () => {}]));
  const bridge = createPlatformAPI({platform: 'tiktok', api});
  assert.ok(TIKTOK_API_CATALOG.length > 50);
  for (const name of ['login', 'pay']) assert.equal(bridge.supportsAPI(name), true);
  for (const name of ['showModal', 'requestMidasPayment', 'recharge', 'readFile']) {
    assert.equal(bridge.supportsAPI(name), false);
    await assert.rejects(bridge.callAPI(name), {code: 'UNSUPPORTED'});
  }
  bridge.dispose();
});

test('TikTok login keeps native receiver, exchanges code only with the configured backend', async () => {
  let sent;
  const api = {
    login(options) { assert.equal(this, api); assert.equal('force' in options, false); options.success({code: 'ephemeral-test-code'}); },
    request(options) { sent = options; options.success({statusCode: 200, data: {session: 'test-only'}}); }
  };
  const bridge = createPlatformBridge({platform: 'tiktok', api});
  assert.deepEqual(await bridge.login(), {platform: 'tiktok', code: 'ephemeral-test-code'});
  assert.equal(sent, undefined);
  await bridge.init({loginEndpoint: 'https://backend.example.test/login'});
  assert.deepEqual(await bridge.login(), {platform: 'tiktok', session: {session: 'test-only'}});
  assert.deepEqual(sent.data, {platform: 'tiktok', code: 'ephemeral-test-code'});
  bridge.dispose();
});

test('TikTok pay success with no result is client completion, never fulfilled; duplicate callbacks settle once', async () => {
  let options, count = 0;
  const api = {pay(value) { assert.equal(this, api); options = value; count++; }};
  const bridge = createPlatformBridge({platform: 'tiktok', api, apiTimeoutMs: 1});
  await assert.rejects(bridge.pay({}), /trade_order_id/);
  const payment = bridge.pay({trade_order_id: 'test-order'});
  await assert.rejects(bridge.pay({trade_order_id: 'other'}), /already in progress/);
  await new Promise(resolve => setTimeout(resolve, 8)); // interactive calls ignore short default timeout
  options.success(); options.complete(); options.success({paid: true});
  assert.deepEqual(await payment, {platform: 'tiktok', clientStatus: 'completed', fulfillment: 'unconfirmed', result: undefined});
  assert.equal(count, 1); bridge.dispose();
});

test('TikTok nested cancellation and pending errors remain failures, with no auto retry or data leakage', async () => {
  for (const code of [30001, 30002, 30003]) {
    let count = 0;
    const native = {error: {error_code: code, error_msg: 'native detail', error_extra: {private: 'secret'}}};
    const bridge = createPlatformBridge({platform: 'tiktok', api: {pay(options) { count++; options.fail(native); options.complete(); }}});
    await assert.rejects(bridge.pay({trade_order_id: 'test'}), error => {
      assert.equal(error.cause, native);
      assert.equal(JSON.stringify(error).includes('secret'), false);
      return error.code === 'PLATFORM_ERROR';
    });
    assert.equal(count, 1); bridge.dispose();
  }
});

test('payment disposal rejects pending flow; late native success cannot fulfill anything', async () => {
  let options;
  const bridge = createPlatformBridge({platform: 'tiktok', api: {pay(value) { options = value; }}});
  const pending = bridge.pay({trade_order_id: 'test'});
  bridge.dispose(); await assert.rejects(pending, {code: 'DISPOSED'});
  options.success(); options.complete();
});

test('WeChat payment preserves Midas fields and short vibration supplies required intensity', async () => {
  let payment, vibration;
  const bridge = createPlatformBridge({platform: 'wechat', api: {
    requestMidasPayment(options) { payment = options; options.success({errMsg: 'requestMidasPayment:ok'}); },
    vibrateShort(options) { vibration = options; options.success(); }
  }});
  const args = {mode: 'game', offerId: 'test-only', buyQuantity: 1, zoneId: '1', currencyType: 'CNY', platform: 'android', env: 1};
  assert.equal((await bridge.pay(args)).fulfillment, 'unconfirmed');
  for (const [key, value] of Object.entries(args)) assert.equal(payment[key], value);
  await bridge.vibrate(); assert.equal(vibration.type, 'medium');
  await bridge.vibrate({type: 'short', strength: 'light'}); assert.equal(vibration.type, 'light');
  await assert.rejects(bridge.vibrate({strength: 'invalid'}), /strength/); bridge.dispose();
});

test('polling waits for backend fulfillment rather than accepting a native paid flag', async () => {
  let calls = 0;
  const result = await pollPaymentOrder({orderId: 'test', intervalMs: 1, timeoutMs: 100,
    queryOrder: async (id, {signal}) => { assert.equal(id, 'test'); assert.equal(signal.aborted, false); return {orderId: id, status: ++calls === 1 ? 'pending' : 'fulfilled'}; }});
  assert.equal(result.status, 'fulfilled'); assert.equal(calls, 2);
  await assert.rejects(pollPaymentOrder({orderId: 'test', queryOrder: async () => ({orderId: 'other', status: 'fulfilled'})}), /matching orderId/);
  await assert.rejects(pollPaymentOrder({orderId: 'test', queryOrder: async () => ({orderId: 'test', status: 'PAID'})}), /fulfillment status/);
});

test('poll deadline bounds even a hung backend and cancels the outstanding query', async () => {
  let signal, finish;
  const result = await pollPaymentOrder({orderId: 'test', timeoutMs: 5, queryOrder: (_, control) => {
    signal = control.signal; return new Promise(resolve => { finish = resolve; });
  }});
  assert.deepEqual(result, {orderId: 'test', status: 'pending', timedOut: true});
  assert.equal(signal.aborted, true); finish({orderId: 'test', status: 'fulfilled'});
});

test('polling cancellation, backend errors and negative durations are not payment success', async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(pollPaymentOrder({orderId: 'test', queryOrder: () => assert.fail(), signal: controller.signal}), {name: 'AbortError'});
  await assert.rejects(pollPaymentOrder({orderId: 'test', queryOrder: async () => { throw new Error('backend unavailable'); }}), /backend unavailable/);
  await assert.rejects(pollPaymentOrder({orderId: 'test', timeoutMs: -1, queryOrder() {}}), /durations/);
});

test('polling works in a native VM with no browser AbortController and still aborts a stalled task', async () => {
  const source = await fs.readFile(new URL('../src/runtime/payment.js', import.meta.url), 'utf8');
  const poll = vm.runInNewContext(source.replace('export function pollPaymentOrder', 'function pollPaymentOrder') + '\npollPaymentOrder', {setTimeout, clearTimeout});
  const done = await poll({orderId: 'test', queryOrder: async orderId => ({orderId, status: 'fulfilled'})});
  assert.equal(done.status, 'fulfilled');
  let signal, aborts = 0;
  const timed = await poll({orderId: 'test', timeoutMs: 5, queryOrder: (_, control) => {
    signal = control.signal; signal.addEventListener('abort', () => { aborts++; });
    return new Promise(() => {});
  }});
  assert.equal(timed.status, 'pending'); assert.equal(signal.aborted, true); assert.equal(aborts, 1);
});

test('TikTok vibration supplies the official required intensity', async () => {
  let options;
  const bridge = createPlatformBridge({platform: 'tiktok', api: {vibrateShort(value) { options = value; value.success(); }}});
  await bridge.vibrate(); assert.equal(options.type, 'medium'); bridge.dispose();
});

const secret = 'unit-test-secret-not-a-credential';
const clientKey = 'test-client';
const now = 1700000000;
function signed(overrides = {}, contentOverrides = {}) {
  const content = JSON.stringify({trade_order_id: 'test-trade', order_id: 'test-order', is_sandbox: true, ...contentOverrides});
  const rawBody = Buffer.from(JSON.stringify({client_key: clientKey, event: 'minis.trade_order.redeem.success', content, ...overrides}));
  const digest = createHmac('sha256', secret).update(`${now}.`).update(rawBody).digest('hex');
  return {rawBody, signatureHeader: `t=${now},s=${digest}`, clientSecret: secret, clientKey, environment: 'sandbox', nowSeconds: now};
}

test('server verifier accepts original signed bytes; signature, reserialization and replay checks fail closed', () => {
  const args = signed();
  assert.equal(verifyTikTokWebhook(args).tradeOrderId, 'test-trade');
  assert.throws(() => verifyTikTokWebhook({...args, rawBody: Buffer.from(JSON.stringify(JSON.parse(args.rawBody), null, 2))}), /signature mismatch/);
  assert.throws(() => verifyTikTokWebhook({...args, clientSecret: 'wrong'}), /signature mismatch/);
  assert.throws(() => verifyTikTokWebhook({...args, nowSeconds: now + 301}), /timestamp/);
  assert.throws(() => verifyTikTokWebhook({...args, nowSeconds: now - 301}), /timestamp/);
  assert.throws(() => verifyTikTokWebhook({...args, signatureHeader: `${args.signatureHeader},t=${now}`}), /format/);
  assert.throws(() => verifyTikTokWebhook({...args, rawBody: JSON.parse(args.rawBody)}), /Buffer/);
});

test('server verifier enforces application/environment/order identity and keeps refunds separate', () => {
  assert.throws(() => verifyTikTokWebhook({...signed(), environment: 'production'}), /sandbox\/production mismatch/);
  assert.throws(() => verifyTikTokWebhook(signed({client_key: 'other'})), /different client/);
  assert.throws(() => verifyTikTokWebhook(signed({}, {is_sandbox: undefined})), /sandbox flag/);
  assert.throws(() => verifyTikTokWebhook(signed({}, {order_id: ''})), /identity/);
  assert.throws(() => verifyTikTokWebhook(signed({event: 'unknown'})), /Unsupported/);
  for (const suffix of ['refund_success', 'refund_fail', 'refund_traceback']) {
    const event = `minis.trade_order.redeem.${suffix}`;
    const verified = verifyTikTokWebhook(signed({event}));
    assert.equal(verified.event, event); assert.equal('fulfilled' in verified, false);
  }
});
