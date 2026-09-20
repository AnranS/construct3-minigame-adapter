import {requireMethod} from './events.js';
import {createPlatformAPI, PlatformAPIError} from './platform-api.js';
export {PLATFORM_API_CATALOG, PLATFORM_API_CATEGORIES, PlatformAPIError} from './platform-api.js';
export {pollPaymentOrder} from './payment.js';

function endpoint(value, purpose) {
  if (typeof value !== 'string' || !/^https:\/\/[^/\s]+(?:\/|$)/i.test(value)) {
    throw new Error(`${purpose} requires an explicit HTTPS backend endpoint and a configured platform request-domain allowlist`);
  }
  return value;
}

/** Business APIs, independent of the DOM adapter. Does not contain any app secret. */
export function createPlatformBridge({api, platform = 'douyin', ...initialConfig} = {}) {
  if (!['douyin', 'wechat', 'tiktok'].includes(platform)) throw new Error(`Unsupported platform: ${platform}`);
  if (!api) throw new Error(`Missing ${{douyin: 'tt', wechat: 'wx', tiktok: 'TTMinis.game'}[platform]} platform API`);
  let config = {...initialConfig};
  const operations = createPlatformAPI({api, platform, defaultTimeoutMs: initialConfig.apiTimeoutMs ?? 30000});
  let disposed = false;
  let activeAd = null;
  let activePayment = false;
  const ensure = () => { if (disposed) throw new Error('Platform bridge is disposed'); };
  const post = async (url, data) => {
    const response = await operations.callAPI('request', {
      url, method: 'POST', header: {'content-type': 'application/json'}, data, dataType: 'json'
    });
    if (!Number.isInteger(response?.statusCode)) throw new Error('Backend response has no valid HTTP status code');
    if (response.statusCode < 200 || response.statusCode >= 300) throw new Error(`Backend HTTP ${response.statusCode}`);
    return response.data;
  };
  return {
    callAPI: operations.callAPI,
    getAPISync: operations.getAPISync,
    createAPIObject: operations.createAPIObject,
    onAPIEvent: operations.onAPIEvent,
    supportsAPI: operations.supportsAPI,
    getCapabilities: operations.getCapabilities,
    getPlatform() { return platform; },
    init(options = {}) {
      ensure();
      if (options.platform && options.platform !== 'auto' && options.platform !== platform) throw new Error(`Plugin platform ${options.platform} does not match runtime ${platform}`);
      if (options.apiTimeoutMs !== undefined) operations.setDefaultTimeout(options.apiTimeoutMs);
      config = {...config, ...options};
      return Promise.resolve({platform, initialized: true});
    },
    async login(options = {}) {
      ensure();
      const loginEndpoint = options.loginEndpoint || config.loginEndpoint;
      const url = loginEndpoint ? endpoint(loginEndpoint, 'Login') : null;
      const result = await operations.callAPI('login', platform === 'douyin' ? {force: options.force ?? false} : {});
      if (typeof result?.code !== 'string' || !result.code) throw new Error('Platform login returned no authorization code');
      // Without a backend configuration, return the temporary code only in memory.
      // The caller must exchange it on its own backend; never log it or embed an app secret.
      if (!url) return {platform, code: result.code};
      const session = await post(url, {platform, code: result.code});
      return {platform, session};
    },
    async pay(options = {}, control = {}) {
      ensure();
      const method = {tiktok: 'pay', wechat: 'requestMidasPayment'}[platform];
      if (!method || !operations.supportsAPI(method)) throw new PlatformAPIError('UNSUPPORTED', 'pay', platform);
      if (!options || typeof options !== 'object' || Array.isArray(options)) throw new TypeError('Payment options must be an object');
      if (platform === 'tiktok' && (typeof options.trade_order_id !== 'string' || !options.trade_order_id.trim())) throw new TypeError('TikTok pay requires a backend-created trade_order_id');
      if (activePayment) throw new Error('A payment request is already in progress');
      activePayment = true;
      try {
        // No automatic retry and no entitlement changes. Native success only closes
        // the client flow; the authenticated backend decides fulfillment status.
        const result = await operations.callAPI(method, options, control);
        return {platform, clientStatus: 'completed', fulfillment: 'unconfirmed', result};
      } finally { activePayment = false; }
    },
    showRewardedVideo(options = {}, control = {}) {
      ensure();
      const adUnitId = typeof options === 'string' ? options : options.adUnitId || config.adUnitId;
      if (!adUnitId) return Promise.reject(new Error('showRewardedVideo requires adUnitId'));
      if (activeAd) return Promise.reject(new Error('A rewarded video request is already in progress'));
      return new Promise((resolve, reject) => {
        let ad, settled = false, closeRegistered = false, errorRegistered = false, timer;
        const token = {cancel: () => settle(new PlatformAPIError('DISPOSED', 'showRewardedVideo', platform))};
        activeAd = token;
        const cleanup = () => {
          const failures = [];
          clearTimeout(timer);
          const attempt = callback => { try { callback(); } catch (cause) { failures.push(cause); } };
          attempt(() => control.signal?.removeEventListener('abort', onAbort));
          if (closeRegistered) attempt(() => ad.offClose(onClose));
          if (errorRegistered) attempt(() => ad.offError(onError));
          attempt(() => { if (typeof ad?.destroy === 'function') ad.destroy(); });
          if (activeAd === token) activeAd = null;
          return failures;
        };
        const settle = (error, value) => {
          if (settled) return;
          settled = true;
          const failures = cleanup();
          if (failures.length) {
            error ||= new PlatformAPIError('CLEANUP_ERROR', 'showRewardedVideo', platform, failures[0]);
            Object.defineProperty(error, 'cleanupErrors', {value: failures});
          }
          if (error) reject(error); else resolve(value);
        };
        const onClose = result => settle(null, {completed: result?.isEnded === true, platform});
        const onError = error => settle(new PlatformAPIError('PLATFORM_ERROR', 'showRewardedVideo', platform, error));
        const onAbort = () => settle(new PlatformAPIError('ABORTED', 'showRewardedVideo', platform));
        try {
          if (!control || typeof control !== 'object' || Array.isArray(control)) throw new TypeError('Ad control must be an object');
          const timeout = control.timeoutMs ?? 0; // Watching an ad has no short default timeout.
          if (!Number.isFinite(timeout) || timeout < 0 || timeout > 2147483647) throw new TypeError('Ad timeoutMs must be a nonnegative finite duration');
          if (control.signal && (typeof control.signal.addEventListener !== 'function' || typeof control.signal.removeEventListener !== 'function')) throw new TypeError('Ad signal must be an AbortSignal');
          if (control.signal?.aborted) { onAbort(); return; }
          control.signal?.addEventListener('abort', onAbort, {once: true});
          if (settled || control.signal?.aborted) { onAbort(); return; }
          if (timeout) timer = setTimeout(() => settle(new PlatformAPIError('TIMEOUT', 'showRewardedVideo', platform)), timeout);
          ad = operations.createAPIObject('createRewardedVideoAd', {adUnitId});
          for (const method of ['onClose', 'offClose', 'onError', 'offError', 'show']) requireMethod(ad, method);
          // Set the flags before registration: native registration may add then throw.
          closeRegistered = true; ad.onClose(onClose);
          if (settled) return;
          errorRegistered = true; ad.onError(onError);
          if (settled) return;
          Promise.resolve().then(() => { if (!settled) return ad.show(); }).catch(async error => {
            if (settled) return;
            if (typeof ad.load !== 'function') throw error;
            await ad.load();
            if (!settled) await ad.show();
          }).catch(onError);
        } catch (cause) { settle(cause instanceof PlatformAPIError ? cause : new PlatformAPIError('PLATFORM_ERROR', 'showRewardedVideo', platform, cause)); }
      });
    },
    async reportScore(score, options = {}) {
      ensure();
      if (typeof score === 'object' && score !== null) {
        options = score; score = options.score;
      }
      if (typeof score !== 'number' || !Number.isFinite(score)) throw new TypeError('Score must be a finite number');
      const url = endpoint(options.endpoint || config.scoreEndpoint || config.endpoint, 'reportScore');
      const result = await post(url, {platform, score, ...(options.leaderboardId ? {leaderboardId: options.leaderboardId} : {}), ...(options.metadata ? {metadata: options.metadata} : {})});
      return {platform, result};
    },
    vibrate(type = 'short') {
      ensure();
      const strength = typeof type === 'object' && type !== null ? type.strength ?? 'medium' : 'medium';
      if (typeof type === 'object' && type !== null) type = type.type || 'short';
      if (!['short', 'long'].includes(type)) return Promise.reject(new Error('vibrate supports short or long'));
      if (!['light', 'medium', 'heavy'].includes(strength)) return Promise.reject(new Error('Vibration strength must be light, medium or heavy'));
      return operations.callAPI(type === 'long' ? 'vibrateLong' : 'vibrateShort', type === 'short' && ['wechat', 'tiktok'].includes(platform) ? {type: strength} : {});
    },
    getLaunchOptions() { ensure(); return operations.getAPISync('getLaunchOptionsSync'); },
    onPause(callback) { return operations.onAPIEvent('onHide', callback); },
    onResume(callback) { return operations.onAPIEvent('onShow', callback); },
    dispose() {
      if (disposed) return;
      disposed = true;
      const failures = [];
      try { activeAd?.cancel(); } catch (cause) { failures.push(cause); }
      try { operations.dispose(); } catch (cause) { failures.push(cause); }
      if (failures.length) throw new AggregateError(failures, 'Platform bridge cleanup failed');
    }
  };
}
