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
  analytics: '数据分析'
});

const platformOrder = ['wechat', 'douyin'];
const platformLabels = { wechat: '微信', douyin: '抖音' };

/**
 * One row per exact native name, generated from the runtime directory.
 * kinds uses null when a platform is not in the directory. metadata retains
 * per-platform invocation details without implying availability on a device.
 * The result only contains JSON-compatible plain values and is safe to embed
 * as data (the renderer remains responsible for HTML/script escaping).
 */
export function getAPICatalog() {
  const rows = new Map();

  for (const entry of PLATFORM_API_CATALOG) {
    if (!rows.has(entry.name)) {
      rows.set(entry.name, {
        name: entry.name,
        category: entry.category,
        categoryLabel: API_CATEGORY_LABELS[entry.category] || entry.category,
        kinds: { wechat: null, douyin: null },
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
      notes.push(row.platforms.map(platform => `${platformLabels[platform]} ${row.kinds[platform]}`).join('；'));
    }

    const offNames = [...new Set(row.platforms.map(platform => row.metadata[platform].off).filter(Boolean))];
    if (offNames.length) notes.push(`订阅要求对应取消接口：${offNames.join(' / ')}`);

    const interactionPlatforms = row.platforms.filter(platform => row.metadata[platform].interaction);
    if (interactionPlatforms.length) {
      const prefix = interactionPlatforms.length === row.platforms.length ? '' : `${interactionPlatforms.map(platform => platformLabels[platform]).join('、')}：`;
      notes.push(`${prefix}交互调用默认不设超时`);
    }

    const noOptionsPlatforms = row.platforms.filter(platform => row.metadata[platform].noOptions);
    if (noOptionsPlatforms.length) notes.push('原生入口不传 options 参数');

    for (const platform of row.platforms) {
      if (row.metadata[platform].completion === 'not-observable') {
        notes.push(`${platformLabels[platform]}不提供完成回调，返回值不代表分享成功`);
      }
    }
    row.notes = notes.join('。');
  }

  return [...rows.values()];
}
