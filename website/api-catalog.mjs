import { PLATFORM_API_CATALOG } from '../src/runtime/platform-api.js';

export const API_CATEGORY_LABELS = Object.freeze({
  system: '系统信息',
  lifecycle: '生命周期',
  rendering: '渲染与字体',
  input: '触摸、键盘与鼠标',
  ui: '原生界面',
  keyboard: '原生键盘',
  clipboard: '剪贴板',
  storage: '本地存储',
  network: '网络与连接',
  files: '文件',
  device: '设备与传感器',
  audio: '音频与录音',
  media: '图像、视频与录屏',
  account: '登录与设置',
  share: '分享',
  navigation: '跳转与回访',
  ads: '广告',
  'open-data': '开放数据与榜单',
  buttons: '原生按钮',
  analytics: '数据分析',
  payment: '支付',
  payments: '支付',
  subpackage: '分包加载',
  subpackages: '分包加载'
});

export const API_PLATFORMS = Object.freeze(['wechat', 'douyin', 'tiktok']);
export const API_PLATFORM_LABELS = Object.freeze({ wechat: '微信', douyin: '抖音', tiktok: 'TikTok' });
const ENGLISH_CATEGORY_LABELS = Object.freeze({
  system: 'System information',
  lifecycle: 'Lifecycle',
  rendering: 'Rendering and fonts',
  input: 'Touch, keyboard and mouse',
  ui: 'Native UI',
  keyboard: 'Native keyboard',
  clipboard: 'Clipboard',
  storage: 'Local storage',
  network: 'Network and connections',
  files: 'Files',
  device: 'Device and sensors',
  audio: 'Audio and recording',
  media: 'Images, video and screen recording',
  account: 'Login and settings',
  share: 'Sharing',
  navigation: 'Navigation and return visits',
  ads: 'Advertising',
  'open-data': 'Open data and leaderboards',
  buttons: 'Native buttons',
  analytics: 'Analytics',
  payment: 'Payments',
  payments: 'Payments',
  subpackage: 'Subpackage loading',
  subpackages: 'Subpackage loading'
});
const ENGLISH_PLATFORM_LABELS = Object.freeze({ wechat: 'WeChat', douyin: 'Douyin', tiktok: 'TikTok' });
const platformOrder = API_PLATFORMS;

export function getAPIPlatformLabels(locale = 'zh-CN') {
  return locale === 'en' ? ENGLISH_PLATFORM_LABELS : API_PLATFORM_LABELS;
}

/**
 * One row per exact native name, generated from the runtime directory.
 * kinds uses null when a platform is not in the directory. metadata retains
 * per-platform invocation details without implying availability on a device.
 * The result only contains JSON-compatible plain values and is safe to embed
 * as data (the renderer remains responsible for HTML/script escaping).
 */
export function getAPICatalog(locale = 'zh-CN') {
  const english = locale === 'en';
  const categoryLabels = english ? ENGLISH_CATEGORY_LABELS : API_CATEGORY_LABELS;
  const platformLabels = getAPIPlatformLabels(locale);
  const localize = (zh, en) => english ? en : zh;
  const rows = new Map();

  for (const entry of PLATFORM_API_CATALOG) {
    if (!rows.has(entry.name)) {
      rows.set(entry.name, {
        name: entry.name,
        category: entry.category,
        categoryLabel: categoryLabels[entry.category] || entry.category,
        kinds: Object.fromEntries(platformOrder.map(platform => [platform, null])),
        contracts: {},
        platforms: [],
        notes: '',
        metadata: {}
      });
    }

    const row = rows.get(entry.name);
    if (row.category !== entry.category) {
      throw new Error(`API category conflict: ${entry.name}`);
    }

    for (const platform of entry.platforms) {
      if (!platformOrder.includes(platform)) {
        throw new Error(`Unknown API platform: ${platform}`);
      }
      if (row.kinds[platform] && row.kinds[platform] !== entry.kind) {
        throw new Error(`API kind conflict: ${platform}.${entry.name}`);
      }
      row.kinds[platform] = entry.kind;
      const { name, kind, category, platforms, ...metadata } = entry;
      row.metadata[platform] = { ...metadata };
    }
  }

  for (const row of rows.values()) {
    row.platforms = platformOrder.filter(platform => row.kinds[platform]);
    const notes = [];
    if (new Set(row.platforms.map(platform => row.kinds[platform])).size > 1) {
      notes.push(row.platforms.map(platform => `${platformLabels[platform]} ${row.kinds[platform]}`).join(localize('；', '; ')));
    }

    const offNames = [...new Set(row.platforms.map(platform => row.metadata[platform].off).filter(Boolean))];
    if (offNames.length) notes.push(localize(`订阅要求对应取消接口：${offNames.join(' / ')}`, `Subscriptions require the corresponding unsubscribe method: ${offNames.join(' / ')}`));

    const interactionPlatforms = row.platforms.filter(platform => row.metadata[platform].interaction);
    if (interactionPlatforms.length) {
      const prefix = interactionPlatforms.length === row.platforms.length ? '' : `${interactionPlatforms.map(platform => platformLabels[platform]).join(localize('、', ', '))}${localize('：', ': ')}`;
      notes.push(`${prefix}${localize('交互调用默认不设超时', 'Interactive calls have no timeout by default')}`);
    }

    const noOptionsPlatforms = row.platforms.filter(platform => row.metadata[platform].noOptions);
    if (noOptionsPlatforms.length) notes.push(localize('原生入口不传 options 参数', 'The native method is called without an options argument'));

    for (const platform of row.platforms) {
      if (row.metadata[platform].completion === 'not-observable') {
        notes.push(localize(`${platformLabels[platform]}不提供完成回调，返回值不代表分享成功`, `${platformLabels[platform]} provides no completion callback; the return value does not confirm successful sharing`));
      }
    }
    for (const platform of row.platforms) {
      const metadata = row.metadata[platform];
      const contract = [];
      if (metadata.syncFallback) contract.push(localize(`优先原生同名方法；缺失时映射 ${metadata.syncFallback}，返回实际结果`, `Prefer the same-name native method; if absent, call ${metadata.syncFallback} and return its actual result`));
      if (metadata.offMode === 'all') contract.push(localize('宿主取消接口影响全部监听；桥接仅停用自身回调', 'The native unsubscribe method affects all listeners; the bridge only deactivates its own callbacks'));
      else if (metadata.offMode === 'none') contract.push(localize('无原生撤销接口；桥接仅停用自身回调', 'No native unsubscribe method; the bridge only deactivates its own callbacks'));
      else if (metadata.off) contract.push(localize(`需 ${metadata.off} 撤销订阅`, `Requires ${metadata.off} to unsubscribe`));
      if (metadata.executionScope === 'open-data') contract.push(localize('仅开放数据域', 'Open data context only'));
      if (metadata.noOptions) contract.push(localize('不传 options', 'No options argument'));
      if (metadata.interaction) contract.push(localize('默认不设超时', 'No timeout by default'));
      if (metadata.completion === 'not-observable') contract.push(localize('无完成回调，不能确认分享成功', 'No completion callback; successful sharing cannot be confirmed'));
      if (metadata.completion === 'client-callback-only') contract.push(localize('客户端回调不确认付款/发货', 'Client callbacks do not confirm payment or fulfillment'));
      if (platform === 'tiktok' && row.name === 'pay') contract.push(localize('参数 trade_order_id', 'Parameter: trade_order_id'));
      if (['wechat', 'tiktok'].includes(platform) && row.name === 'showKeyboard') contract.push(localize('快捷动作显式 keyboardType: text', 'The shortcut action explicitly sets keyboardType: text'));
      row.contracts[platform] = contract;
    }
    row.notes = notes.join(localize('。', '. '));
  }

  return [...rows.values()];
}

export function getAPISummary() {
  const rows = getAPICatalog();
  return {
    names: rows.length,
    categories: new Set(rows.map(row => row.category)).size,
    platforms: Object.fromEntries(API_PLATFORMS.map(platform => [platform, rows.filter(row => row.kinds[platform]).length]))
  };
}
