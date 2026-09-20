/** TikTok Native Mini Games: independent TTMinis.game contracts, checked 2026-09-20.
 * Do not infer support from Douyin's similarly named APIs. Object methods (audio,
 * file manager, ads, sockets) belong to their returned object, not this namespace.
 * Sources: https://developers.tiktok.com/docs/en/mini-games-sdk-overview and the
 * per-category references stored below. Actual availability remains host-dependent.
 */
const entries = [];
const platforms = Object.freeze(['tiktok']);
function add(category, kind, names, page, extra = {}) {
  for (const name of names.split(' ')) entries.push(Object.freeze({
    name, category, kind, platforms,
    source: page.startsWith('https:') ? page : `https://developers.tiktok.com/docs/en/mini-games-sdk-${page}`,
    ...(kind === 'event' ? {off: `off${name.slice(2)}`} : {}), ...extra
  }));
}
add('system', 'sync', 'canIUse', 'basic-utility');
add('system', 'sync', 'getSystemInfoSync getWindowInfo', 'system');
add('system', 'async', 'getSystemInfo', 'system');
add('system', 'sync', 'getLaunchOptionsSync getEnterOptionsSync', 'event');
add('system', 'object', 'getUpdateManager', 'https://developers.tiktok.com/docs/en/mini-games-update-management', {noOptions: true});
add('lifecycle', 'event', 'onShow onHide', 'event');
add('lifecycle', 'async', 'loadSubpackage preDownloadSubpackage', 'subpackage-loading');
add('rendering', 'object', 'createCanvas createImage', 'render-and-canvas', {noOptions: true});
add('rendering', 'sync', 'loadFont setPreferredFramesPerSecond', 'render-and-canvas');
add('input', 'event', 'onTouchStart onTouchMove onTouchEnd onTouchCancel', 'device-and-network');
add('keyboard', 'async', 'showKeyboard hideKeyboard updateKeyboard', 'device-and-network', {interaction: true});
add('keyboard', 'event', 'onKeyboardInput onKeyboardConfirm onKeyboardComplete onKeyboardHeightChange', 'device-and-network');
add('storage', 'async', 'getStorage setStorage removeStorage clearStorage', 'storage', {failureCallback: 'error'});
add('storage', 'async', 'getStorageInfo', 'storage');
add('storage', 'sync', 'getStorageSync setStorageSync removeStorageSync clearStorageSync getStorageInfoSync', 'storage');
add('network', 'async', 'request', 'basic-utility');
add('network', 'async', 'getNetworkType', 'device-and-network');
add('network', 'object', 'connectSocket', 'websocket');
add('files', 'object', 'getFileSystemManager', 'file', {noOptions: true});
add('device', 'async', 'vibrateShort vibrateLong', 'device-and-network');
add('audio', 'object', 'createInnerAudioContext', 'media');
add('audio', 'object', 'createWebAudioContext', 'media', {noOptions: true});
add('account', 'async', 'login', 'login');
add('account', 'async', 'authorize', 'login', {interaction: true});
add('ads', 'object', 'createRewardedVideoAd createInterstitialAd', 'iaa');
add('payment', 'async', 'checkBalance', 'payment', {failureCallback: 'error'});
add('payment', 'async', 'pay navigateToBalance', 'payment', {interaction: true, completion: 'client-callback-only'});
add('navigation', 'async', 'startEntranceMission addShortcut', 'revisit-incentives', {interaction: true});
add('navigation', 'async', 'getEntranceMissionReward getShortcutMissionReward', 'revisit-incentives');
add('share', 'async', 'shareToStory shareAppMessage', 'sharing', {interaction: true});
// offCopyUrl() removes ALL host listeners. The bridge must only disable its own.
add('share', 'event', 'onCopyUrl', 'sharing', {offMode: 'all'});
add('system', 'sync', 'getMenuButtonBoundingClientRect', 'ui');

export const TIKTOK_API_CATALOG = Object.freeze(entries);
