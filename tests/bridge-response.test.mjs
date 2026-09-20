import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlatformBridge} from '../src/runtime/bridge.js';

test('backend reporting never treats missing, nonnumeric or nonfinite status as success', async () => {
  for (const statusCode of [undefined, NaN, Infinity, '200', 199, 300, 500]) {
    const bridge = createPlatformBridge({platform: 'wechat', scoreEndpoint: 'https://example.test/score',
      api: {request(options) { options.success({statusCode, data: {accepted: true}}); }}});
    await assert.rejects(bridge.reportScore(1), /status code|HTTP/); bridge.dispose();
  }
  const bridge = createPlatformBridge({platform: 'wechat', scoreEndpoint: 'https://example.test/score',
    api: {request(options) { options.success({statusCode: 204, data: ''}); }}});
  assert.deepEqual(await bridge.reportScore(1), {platform: 'wechat', result: ''}); bridge.dispose();
});
