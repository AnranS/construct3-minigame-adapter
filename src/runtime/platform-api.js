import {subscribeSharedEvent} from './native-events.js';
import {TIKTOK_API_CATALOG} from './tiktok-api.js';

/** Explicit native API directory. Presence means callable, not permission, inventory,
 * network access or business success. No operation runs during capability discovery.
 * Sources (checked 2026-09-20):
 * https://github.com/wechat-miniprogram/minigame-api-typings/blob/master/types/wx/lib.wx.api.d.ts
 * https://developer.open-douyin.com/docs/resource/zh-CN/mini-game/develop/api/javascript-api/overview
 */
const directory = [];
const both = ['wechat', 'douyin'];
const noOptions = new Set('getPerformance getUpdateManager getRealtimeLogManager createCanvas createImage createWebAudioContext getRecorderManager getAudioContext getGameRecorderManager getGameRecorder getFileSystemManager getSharedCanvas'.split(' '));
function group(category, kind, names, extra = {}) {
  for (const name of names.split(/\s+/).filter(Boolean)) {
    directory.push(Object.freeze({name, kind, category,
      ...(noOptions.has(name) ? {noOptions: true} : {}),
      ...(kind === 'event' ? {off: `off${name.slice(2)}`} : {}), ...extra, platforms: Object.freeze([...(extra.platforms || both)])}));
  }
}
group('system', 'sync', 'getSystemInfoSync getLaunchOptionsSync');
// These entries are independently documented for Douyin. Do not infer WeChat
// Mini Game support from the similarly named WeChat Mini Program namespace.
group('system', 'sync', 'canIUse', {platforms: ['douyin']});
group('system', 'sync', 'getWindowInfo getDeviceInfo getAppBaseInfo getSystemSetting getAppAuthorizeSetting getEnterOptionsSync getAccountInfoSync getBatteryInfoSync getMenuButtonBoundingClientRect', {platforms: ['wechat']});
group('system', 'sync', 'getEnvInfoSync getMenuButtonLayout', {platforms: ['douyin']});
group('system', 'async', 'getSystemInfo');
group('system', 'async', 'getSystemInfoAsync getBatteryInfo', {platforms: ['wechat']});
group('system', 'object', 'getPerformance getUpdateManager getLogManager getRealtimeLogManager');
group('lifecycle', 'event', 'onShow onHide onError onMemoryWarning onWindowResize');
group('lifecycle', 'event', 'onUnhandledRejection onAudioInterruptionBegin onAudioInterruptionEnd', {platforms: ['wechat']});
group('lifecycle', 'async', 'exitMiniProgram', {interaction: true});
group('lifecycle', 'async', 'loadSubpackage');
group('lifecycle', 'sync', 'restartMiniProgramSync', {platforms: ['douyin']});
group('rendering', 'object', 'createCanvas createImage');
group('rendering', 'sync', 'loadFont setPreferredFramesPerSecond');
group('rendering', 'sync', 'setCursor isPointerLocked requestPointerLock exitPointerLock', {platforms: ['wechat'], deviceScope: 'desktop'});
group('input', 'event', 'onTouchStart onTouchMove onTouchEnd onTouchCancel onKeyDown onKeyUp onMouseDown onMouseMove onMouseUp onWheel');
group('input', 'sync', 'getGamepads', {platforms: ['wechat'], deviceScope: 'desktop', minVersion: '3.6.4'});
group('ui', 'async', 'showToast hideToast showLoading hideLoading');
group('ui', 'async', 'showModal showActionSheet', {interaction: true});
group('keyboard', 'async', 'showKeyboard hideKeyboard updateKeyboard', {interaction: true});
group('keyboard', 'event', 'onKeyboardInput onKeyboardConfirm onKeyboardComplete');
group('keyboard', 'event', 'onKeyboardHeightChange', {platforms: ['wechat'], minVersion: '2.21.3'});
group('clipboard', 'async', 'getClipboardData setClipboardData');
group('storage', 'async', 'getStorage setStorage removeStorage clearStorage getStorageInfo');
group('storage', 'sync', 'getStorageSync setStorageSync removeStorageSync clearStorageSync getStorageInfoSync');
group('network', 'async', 'request downloadFile uploadFile getNetworkType');
group('network', 'event', 'onNetworkStatusChange');
group('network', 'event', 'onNetworkWeakChange', {platforms: ['wechat'], minVersion: '2.21.0'});
// SocketTask is returned unchanged. Creation is not the onOpen event.
group('network', 'object', 'connectSocket');
group('files', 'object', 'getFileSystemManager');
group('device', 'async', 'setKeepScreenOn getScreenBrightness setScreenBrightness vibrateShort vibrateLong startAccelerometer stopAccelerometer startCompass stopCompass startGyroscope stopGyroscope startDeviceMotionListening stopDeviceMotionListening');
group('device', 'async', 'scanCode getLocation', {interaction: true});
group('device', 'event', 'onAccelerometerChange onCompassChange onGyroscopeChange onDeviceMotionChange');
group('device', 'event', 'onDeviceOrientationChange', {platforms: ['douyin']});
group('device', 'async', 'setDeviceOrientation');
group('device', 'event', 'onDeviceOrientationChange', {platforms: ['wechat']});
// Native offUserCaptureScreen() removes every listener. Use a shared dispatcher
// and local cancellation so one bridge cannot remove another consumer's handler.
group('device', 'event', 'onUserCaptureScreen', {platforms: ['wechat'], offMode: 'all'});
group('audio', 'object', 'createInnerAudioContext getRecorderManager');
group('audio', 'object', 'createWebAudioContext', {platforms: ['wechat']});
group('audio', 'async', 'setInnerAudioOption getAvailableAudioSources', {platforms: ['wechat']});
group('audio', 'object', 'getAudioContext', {platforms: ['douyin']});
group('media', 'async', 'chooseImage previewImage saveImageToPhotosAlbum', {interaction: true});
group('media', 'async', 'chooseVideo saveVideoToPhotosAlbum', {platforms: ['douyin'], interaction: true});
group('media', 'async', 'chooseMedia', {platforms: ['wechat'], interaction: true, minVersion: '2.23.0'});
group('media', 'async', 'getImageInfo', {platforms: ['douyin']});
group('media', 'async', 'compressImage', {platforms: ['wechat']});
group('media', 'object', 'createVideo');
group('media', 'object', 'createOffscreenVideo getGameRecorderManager', {platforms: ['douyin']});
group('media', 'object', 'getGameRecorder', {platforms: ['wechat']});
group('account', 'async', 'login checkSession getSetting');
group('account', 'async', 'authorize openSetting requestSubscribeMessage openCustomerServiceConversation', {interaction: true});
group('account', 'async', 'getUserInfo', {interaction: true});
group('account', 'async', 'showDouyinOpenAuth', {platforms: ['douyin'], interaction: true});
group('account', 'async', 'getPrivacySetting', {platforms: ['wechat'], minVersion: '2.32.3'});
group('account', 'async', 'requirePrivacyAuthorize openPrivacyContract', {platforms: ['wechat'], interaction: true, minVersion: '2.32.3'});
group('share', 'async', 'showShareMenu hideShareMenu');
group('share', 'event', 'onShareAppMessage');
// wx deliberately has no sharing success callback. The sync return only means invoked.
group('share', 'sync', 'shareAppMessage', {platforms: ['wechat'], completion: 'not-observable'});
group('share', 'async', 'shareAppMessage', {platforms: ['douyin'], interaction: true});
group('share', 'event', 'onShareTimeline', {platforms: ['wechat']});
group('share', 'async', 'shareMessageToFriend', {platforms: ['douyin'], interaction: true});
group('navigation', 'async', 'navigateToMiniProgram', {platforms: ['wechat'], interaction: true});
group('navigation', 'async', 'navigateToScene addShortcut showFavoriteGuide showRevisitGuide openAwemeUserProfile', {platforms: ['douyin'], interaction: true});
group('navigation', 'async', 'checkScene checkShortcut checkFollowState checkFollowAwemeState', {platforms: ['douyin']});
group('ads', 'object', 'createBannerAd createRewardedVideoAd createInterstitialAd');
group('ads', 'object', 'createCustomAd createGridAd', {platforms: ['wechat']});
group('ads', 'object', 'createGridGamePanel', {platforms: ['douyin']});
group('open-data', 'object', 'getSharedCanvas');
group('open-data', 'object', 'getOpenDataContext', {platforms: ['wechat']});
group('open-data', 'object', 'getOpenDataContext', {platforms: ['douyin'], noOptions: true});
group('open-data', 'async', 'setUserCloudStorage getUserCloudStorage removeUserCloudStorage');
group('open-data', 'async', 'getFriendCloudStorage getGroupCloudStorage', {platforms: ['wechat']});
group('open-data', 'async', 'getCloudStorageByRelation setUserGroup setImRankData getImRankList getImRankData setImRankDataInOpenContext', {platforms: ['douyin']});
// Open-data-only methods remain conditional on the actual native namespace.
group('open-data', 'event', 'onMessage', {platforms: ['douyin']});
// The official WeChat open-data API has no wx.offMessage counterpart.
group('open-data', 'event', 'onMessage', {platforms: ['wechat'], off: null, offMode: 'none', executionScope: 'open-data'});
group('buttons', 'object', 'createUserInfoButton createGameClubButton createFeedbackButton createOpenSettingButton', {platforms: ['wechat']});
group('buttons', 'object', 'createContactButton createFollowButton createInteractiveButton', {platforms: ['douyin']});
group('analytics', 'sync', 'reportAnalytics', {platforms: ['douyin']});
group('analytics', 'sync', 'reportEvent reportPerformance', {platforms: ['wechat']});
group('analytics', 'async', 'reportScene', {platforms: ['douyin']});
group('analytics', 'async', 'reportScene', {platforms: ['wechat'], minVersion: '2.26.2'});
// Only transport the explicit frontend request. A frontend success is never a
// fulfillment decision; signing, order verification and delivery live server-side.
group('payment', 'async', 'requestMidasPayment requestMidasPaymentGameItem', {platforms: ['wechat'], interaction: true, fulfillment: 'server-verified', minVersion: '2.19.2'});

directory.push(...TIKTOK_API_CATALOG);

export const PLATFORM_API_CATALOG = Object.freeze(directory);
export const PLATFORM_API_CATEGORIES = Object.freeze([...new Set(directory.map(item => item.category))]);

const reasons = Object.freeze({UNSUPPORTED: 'API is not supported in this environment', WRONG_API_KIND: 'Use the matching API invocation method',
  DISPOSED: 'Platform bridge is disposed', ABORTED: 'API call was aborted', TIMEOUT: 'API call timed out',
  PLATFORM_ERROR: 'Native platform API failed', CALLBACK_ERROR: 'API callback threw', PROTOCOL_ERROR: 'Native API returned no usable completion result',
  INVALID_ARGUMENT: 'Invalid API argument', CLEANUP_ERROR: 'Native API cleanup failed'});

/** Raw native failures stay non-enumerable; JSON diagnostics never serialize
 * login codes, URLs, request payloads, clipboard contents or native error text. */
export class PlatformAPIError extends Error {
  constructor(code, operation, platform, cause) {
    const safeOperation = typeof operation === 'string' && /^[A-Za-z][A-Za-z0-9]*$/.test(operation) ? operation : 'unknown';
    const detail = cause?.errMsg || cause?.message || cause?.error?.error_msg;
    super(`${platform}.${safeOperation}: ${reasons[code] || code}${detail ? ` (${detail})` : ''}`);
    this.name = 'PlatformAPIError'; this.code = code; this.operation = safeOperation; this.platform = platform;
    if (cause !== undefined) Object.defineProperty(this, 'cause', {value: cause, configurable: true});
    if (cause?.error?.error_code !== undefined) Object.defineProperty(this, 'nativeCode', {value: cause.error.error_code, configurable: true});
  }
  toJSON() { return {name: this.name, code: this.code, operation: this.operation, platform: this.platform, message: reasons[this.code] || 'API operation failed'}; }
}

function objectArgument(value, operation, platform) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new PlatformAPIError('INVALID_ARGUMENT', operation, platform);
  return value;
}
function timeoutArgument(value, operation, platform) {
  if (!Number.isFinite(value) || value < 0 || value > 2147483647) throw new PlatformAPIError('INVALID_ARGUMENT', operation, platform);
  return value;
}

const usesLocalUnsubscribe = entry => entry.offMode === 'all' || entry.offMode === 'none';

export function createPlatformAPI({api, platform = 'douyin', defaultTimeoutMs = 30000} = {}) {
  if (!['wechat', 'douyin', 'tiktok'].includes(platform)) throw new Error(`Unsupported platform: ${platform}`);
  if (!api) throw new TypeError('A native platform API object is required');
  timeoutArgument(defaultTimeoutMs, 'configure', platform);
  const catalog = directory.filter(item => item.platforms.includes(platform));
  const entries = new Map(catalog.map(item => [item.name, item]));
  const pending = new Set();
  const subscriptions = new Set();
  let disposed = false;
  const error = (code, name, cause) => new PlatformAPIError(code, name, platform, cause);
  const reasonFor = entry => {
    if (disposed) return 'DISPOSED';
    if (!entry || typeof api[entry.name] !== 'function') return 'UNSUPPORTED';
    if (entry.kind === 'event' && !usesLocalUnsubscribe(entry) && typeof api[entry.off] !== 'function') return 'UNSUPPORTED';
    return null;
  };
  const lookup = (name, kind) => {
    const entry = entries.get(name);
    const reason = reasonFor(entry);
    if (reason) throw error(reason, name);
    if (entry.kind !== kind) throw error('WRONG_API_KIND', name);
    return entry;
  };

  function callAPI(name, options = {}, control = {}) {
    let cancel = () => {};
    const promise = new Promise((resolve, reject) => {
      let entry;
      try {
        entry = lookup(name, 'async'); objectArgument(options, name, platform); objectArgument(control, name, platform);
        for (const callback of ['success', 'fail', 'complete', ...(entry.failureCallback ? [entry.failureCallback] : [])]) {
          if (options[callback] !== undefined && typeof options[callback] !== 'function') throw error('INVALID_ARGUMENT', name);
        }
        if (control.onTask !== undefined && typeof control.onTask !== 'function') throw error('INVALID_ARGUMENT', name);
        if (control.signal && (typeof control.signal.addEventListener !== 'function' || typeof control.signal.removeEventListener !== 'function')) throw error('INVALID_ARGUMENT', name);
        timeoutArgument(control.timeoutMs ?? (entry.interaction ? 0 : defaultTimeoutMs), name, platform);
      } catch (failure) { reject(failure); return; }
      let settled = false, task, timer, abortRequested = false, taskAborted = false, cancellationError;
      const signal = control.signal;
      const cleanupFailures = [];
      const abortTask = () => {
        if (!task || taskAborted || typeof task.abort !== 'function') return;
        taskAborted = true;
        try { task.abort.call(task); } catch (failure) {
          cleanupFailures.push(failure);
          if (cancellationError && !Object.prototype.hasOwnProperty.call(cancellationError, 'cleanupErrors')) Object.defineProperty(cancellationError, 'cleanupErrors', {value: cleanupFailures});
        }
      };
      const settle = (failure, result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer); pending.delete(cancel);
        try { signal?.removeEventListener('abort', abort); } catch (failure) { cleanupFailures.push(failure); }
        if (abortRequested) abortTask();
        let callbackFailure;
        const outcomeCallbacks = failure ? [options.fail, ...(entry.failureCallback ? [options[entry.failureCallback]] : [])] : [options.success];
        for (const callback of new Set(outcomeCallbacks.filter(value => typeof value === 'function'))) {
          try { callback.call(api, result); } catch (cause) { callbackFailure ??= error('CALLBACK_ERROR', name, cause); }
        }
        try { options.complete?.call(api, result); } catch (cause) { callbackFailure ??= error('CALLBACK_ERROR', name, cause); }
        const finalFailure = callbackFailure || failure || (cleanupFailures.length ? error('CLEANUP_ERROR', name, cleanupFailures[0]) : null);
        if (finalFailure && cleanupFailures.length && !Object.prototype.hasOwnProperty.call(finalFailure, 'cleanupErrors')) Object.defineProperty(finalFailure, 'cleanupErrors', {value: cleanupFailures});
        if (finalFailure) reject(finalFailure); else resolve(result);
      };
      cancel = (code = 'ABORTED') => {
        if (settled) return;
        abortRequested = true;
        const failure = cancellationError = error(code, name);
        settle(failure, failure);
      };
      const abort = () => cancel('ABORTED');
      pending.add(cancel);
      if (signal?.aborted) { abort(); return; }
      try {
        signal?.addEventListener('abort', abort, {once: true});
        // A custom AbortSignal may become aborted during registration.
        if (signal?.aborted || settled) { abort(); return; }
        const timeout = control.timeoutMs ?? (entry.interaction ? 0 : defaultTimeoutMs);
        if (timeout) timer = setTimeout(() => cancel('TIMEOUT'), timeout);
        const nativeFail = cause => settle(error('PLATFORM_ERROR', name, cause), cause);
        task = api[name].call(api, {...options,
          success: result => settle(null, result),
          fail: nativeFail,
          ...(entry.failureCallback ? {[entry.failureCallback]: nativeFail} : {}),
          complete: result => {
            if (settled) return;
            // A complete-only native implementation must report its actual outcome.
            if (typeof result?.errMsg === 'string' && /:\s*ok(?:\s|$)/.test(result.errMsg)) settle(null, result);
            else if (typeof result?.errMsg === 'string' && /:\s*(?:fail|cancel)(?:\s|$)/.test(result.errMsg)) settle(error('PLATFORM_ERROR', name, result), result);
            else settle(error('PROTOCOL_ERROR', name), result);
          }
        });
        if (abortRequested) abortTask();
        // Tasks are progress/cancellation handles, never successful results.
        if (!settled && control.onTask) {
          try { control.onTask(task); } catch (cause) {
            abortRequested = true;
            settle(error('CALLBACK_ERROR', name, cause), cause);
          }
        }
        // Passing callbacks selects callback semantics. Consume a returned rejection
        // defensively, without interpreting a fulfilled task/Promise as completion.
        if (task && typeof task.then === 'function') task.then(undefined, cause => settle(error('PLATFORM_ERROR', name, cause), cause));
      } catch (cause) {
        if (!settled) {
          abortRequested = true;
          settle(error('PLATFORM_ERROR', name, cause), cause);
        }
      }
    });
    Object.defineProperty(promise, 'abort', {value: () => cancel('ABORTED')});
    return promise;
  }

  return {
    callAPI,
    getAPISync(name, ...args) {
      lookup(name, 'sync');
      try { return api[name].apply(api, args); } catch (cause) { throw error('PLATFORM_ERROR', name, cause); }
    },
    createAPIObject(name, options = {}) {
      const entry = lookup(name, 'object'); objectArgument(options, name, platform);
      try {
        const value = api[name].apply(api, entry.noOptions ? [] : [options]);
        if (!value || !['object', 'function'].includes(typeof value)) throw error('PROTOCOL_ERROR', name);
        // Return the original object: the caller owns its native destroy/close lifecycle,
        // listeners and methods. Do not proxy, serialize or wrap it in success JSON.
        return value;
      } catch (cause) { if (cause instanceof PlatformAPIError) throw cause; throw error('PLATFORM_ERROR', name, cause); }
    },
    onAPIEvent(name, callback) {
      const entry = lookup(name, 'event');
      if (typeof callback !== 'function') throw error('INVALID_ARGUMENT', name);
      let active = true, nativeCleanup;
      const listener = function (...args) { if (active) return callback.apply(this, args); };
      const unsubscribe = () => {
        if (!active) return;
        active = false; subscriptions.delete(unsubscribe);
        try { nativeCleanup?.(); } catch (cause) { throw error('CLEANUP_ERROR', name, cause); }
      };
      subscriptions.add(unsubscribe);
      try {
        if (usesLocalUnsubscribe(entry)) {
          nativeCleanup = subscribeSharedEvent(api, entry, listener);
          // Native registration can synchronously invoke a callback that disposes
          // this bridge before subscribeSharedEvent returns its local cleanup.
          if (!active) nativeCleanup();
        } else {
          nativeCleanup = () => api[entry.off].call(api, listener);
          api[name].call(api, listener);
        }
      } catch (cause) {
        const failure = error('PLATFORM_ERROR', name, cause);
        try { unsubscribe(); } catch (cleanup) { Object.defineProperty(failure, 'cleanupErrors', {value: [cleanup]}); }
        throw failure;
      }
      return unsubscribe;
    },
    supportsAPI(name) { return reasonFor(entries.get(name)) === null; },
    getCapabilities() {
      // Include other-platform entries as unsupported so projects can compare targets.
      return [...new Set(directory.map(item => item.name))].map(name => {
        const entry = entries.get(name) || directory.find(item => item.name === name);
        const reason = reasonFor(entries.get(name));
        return {name, kind: entry.kind, category: entry.category, platform, supported: !reason, ...(reason ? {reason} : {}),
          ...(entry.completion ? {completion: entry.completion} : {}),
          ...(entry.kind === 'event' ? {unsubscribe: usesLocalUnsubscribe(entry) ? 'local' : 'native'} : {}),
          ...(entry.executionScope ? {executionScope: entry.executionScope} : {}),
          ...(entry.deviceScope ? {deviceScope: entry.deviceScope} : {}),
          ...(entry.fulfillment ? {fulfillment: entry.fulfillment} : {})};
      });
    },
    setDefaultTimeout(timeoutMs) { defaultTimeoutMs = timeoutArgument(timeoutMs, 'configure', platform); },
    dispose() {
      if (disposed) return;
      disposed = true;
      const failures = [];
      for (const cancel of [...pending]) { try { cancel('DISPOSED'); } catch (cause) { failures.push(cause); } }
      for (const unsubscribe of [...subscriptions]) { try { unsubscribe(); } catch (cause) { failures.push(cause); } }
      if (failures.length) throw new AggregateError(failures, 'Platform API cleanup failed');
    }
  };
}
