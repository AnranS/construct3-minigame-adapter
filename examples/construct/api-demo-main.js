/*
 * Real Construct project script: replace the project's scripts/main.js with this
 * file, then export again in Construct. UI is made only from the existing Text
 * object type. No HTML, external canvas renderer, or synthetic native input.
 *
 * Project: Text origin Top-left; Layer 0 = 2D; viewport 390 x 844.
 * Import beep.wav under project Files so its exported path is beep.wav.
 * Configure only your own platform-issued rewarded ad unit below if required.
 *
 * Official references:
 * https://www.construct.net/en/make-games/manuals/construct-3/scripting/scripting-reference/plugin-interfaces/text
 * https://www.construct.net/en/make-games/manuals/construct-3/scripting/scripting-reference/object-interfaces/iobjecttype
 * https://www.construct.net/en/make-games/manuals/construct-3/scripting/scripting-reference/layout-interfaces/ilayout/ilayer
 * https://www.construct.net/en/make-games/manuals/construct-3/scripting/scripting-reference/interfaces/istorage
 * https://github.com/wechat-miniprogram/minigame-api-typings/blob/master/types/wx/lib.wx.api.d.ts
 */

const DEMO_CONFIG = Object.freeze({
  audioPath: 'game/beep.wav',
  packagePath: 'game/data.json',
  rewardedAdUnitId: '',
  storageKey: 'c3-api-demo-value-v1',
  requestURL: '',
  websocketURL: '',
  fontFace: 'Arial'
});

runOnStartup(runtime => {
  runtime.addEventListener('beforeprojectstart', () => startApiDemo(runtime));
});

function startApiDemo(runtime) {
  globalThis.__C3ApiDemo?.dispose();
  const textType = runtime.objects.Text;
  if (!textType) throw new Error('API demo requires the existing Text object type.');
  const originalText = [...textType.instances()];
  const layer = runtime.layout.getLayer(0);
  layer.renderingMode = '2d';
  layer.isTransparent = false;
  layer.backgroundColor = [1, 1, 1];

  const adapter = globalThis.__C3MiniGameAdapter;
  const api = adapter?.api || globalThis.TTMinis?.game || globalThis.wx || globalThis.tt || null;
  const platformId = adapter?.platform || (globalThis.TTMinis?.game ? 'tiktok' : globalThis.wx ? 'wechat' : globalThis.tt ? 'douyin' : '');
  const platform = {wechat: '微信小游戏', douyin: '抖音小游戏', tiktok: 'TikTok 小游戏'}[platformId] || '未检测到小游戏宿主';
  const colors = {
    ink: [0.12, 0.14, 0.16], muted: [0.49, 0.52, 0.55], line: [0.91, 0.92, 0.93],
    success: [0.02, 0.65, 0.34], error: [0.80, 0.20, 0.24], info: [0.49, 0.52, 0.55],
    config: [0.64, 0.43, 0.14], busy: [0.05, 0.45, 0.79]
  };
  const rows = [];
  const groups = [];
  const elements = [];
  const cleanup = [];
  let disposed = false;
  let scroll = 0;
  let maxScroll = 0;
  let drag = null;
  let pointerCount = 0;
  let touchCount = 0;
  let lastPointer = '尚未收到输入';
  let lifecycle = '前台 · 本次启动';
  let showCount = 0;
  let hideCount = 0;
  let activeAudio = null;
  let layoutSignature = '';
  let currentGroup = null;
  let page = { left: 0, top: 0, width: 390, height: 844, unit: 1, margin: 24 };

  function plain(value) {
    // Text's template enables BBCode. API output must always remain literal text.
    return String(value ?? '').replaceAll('[', '［').replaceAll(']', '］');
  }
  function short(value, max = 150) {
    const chars = Array.from(plain(value).replace(/\s+/g, ' ').trim());
    return chars.length > max ? chars.slice(0, max - 1).join('') + '…' : chars.join('');
  }
  function errorText(error) {
    return short(error?.error?.error_msg || error?.errMsg || error?.message || error || '宿主未返回错误说明', 120);
  }
  function createText(size, color, bold = false, align = 'left') {
    const instance = textType.createInstance(layer.index, 0, 0);
    instance.fontFace = DEMO_CONFIG.fontFace;
    instance.sizePt = size;
    instance.fontColor = color;
    instance.isBold = bold;
    instance.isItalic = false;
    instance.horizontalAlign = align;
    instance.verticalAlign = 'top';
    instance.wordWrapMode = 'cjk';
    instance.lineHeight = 2;
    instance.opacity = 1;
    const element = { instance, size, x: 0, y: 0, width: 100, height: 30 };
    elements.push(element);
    return element;
  }
  function write(element, text, color) {
    const value = plain(text);
    if (element.instance.text !== value) element.instance.text = value;
    if (color) element.instance.fontColor = color;
  }
  function geometry(element, x, y, width, height) {
    Object.assign(element, { x, y, width, height });
  }
  function paintPositions() {
    for (const e of elements) {
      const visibleY = e.y - scroll;
      e.instance.x = page.left + e.x * page.unit;
      e.instance.y = page.top + visibleY * page.unit;
      e.instance.width = e.width * page.unit;
      e.instance.height = e.height * page.unit;
      e.instance.sizePt = e.size * page.unit;
      e.instance.lineHeight = 2 * page.unit;
      e.instance.isVisible = !e.hidden && visibleY + e.height > 0 && visibleY < page.height;
    }
  }
  function setStatus(row, message, kind = 'info') {
    if (disposed) return;
    row.status = short(message);
    row.kind = kind;
    write(row.statusText, row.status, colors[kind] || colors.info);
    reflow();
  }
  function outcome(message, kind = 'success') { return { message, kind }; }
  function activate(row) {
    if (!row || disposed) return Promise.resolve(null);
    if (row.busy) return row.pending;
    row.busy = true;
    setStatus(row, '调用中…', 'busy');
    write(row.arrow, '…');
    row.pending = (async () => {
      try {
        const result = await row.action(row);
        const returned = result?.message ? result : outcome('调用已返回，但未提供可验证结果', 'info');
        if (!disposed) setStatus(row, returned.message, returned.kind || 'info');
        return returned;
      } catch (error) {
        const failed = outcome(`${error?.code === 'UNSUPPORTED' ? '当前环境不支持' : '失败'} · ${errorText(error)}`, error?.code === 'UNSUPPORTED' ? 'config' : 'error');
        setStatus(row, failed.message, failed.kind);
        return failed;
      } finally {
        row.busy = false;
        if (!disposed) write(row.arrow, '›');
      }
    })();
    return row.pending;
  }
  function requireMethod(target, method) {
    if (typeof target?.[method] !== 'function') throw new Error(`当前环境不支持 ${method}`);
    return target[method].bind(target);
  }
  function callbackCall(target, method, options = {}, timeout = 15000) {
    if (target === api) return readyPlugin().then(bridge => bridge.callAPI(method, options, { timeoutMs: timeout }));
    return new Promise((resolve, reject) => {
      let settled = false;
      let timer;
      const finish = (error, result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(error); else resolve(result);
      };
      if (timeout > 0) timer = setTimeout(() => finish(new Error(`${method} 未在 ${timeout / 1000} 秒内返回回调`)), timeout);
      try {
        requireMethod(target, method)({ ...options, success: value => finish(null, value), fail: error => finish(error || new Error(`${method} 调用失败`)) });
      } catch (error) { finish(error); }
    });
  }
  function plugin() {
    const bridge = runtime.objects.MiniGameBridge?.getFirstInstance();
    if (!bridge) throw new Error('项目中未找到 MiniGameBridge 插件实例');
    return bridge;
  }
  async function readyPlugin() {
    const bridge = plugin();
    if (!bridge.isReady()) await bridge.init();
    return bridge;
  }
  function windowInfo() {
    // Avoid the broad legacy getSystemInfo APIs, which can involve permissions.
    return plugin().getAPISync('getWindowInfo');
  }
  function addGroup(title) {
    const group = { name: title, title: createText(10.5, colors.muted, true), rows: [] };
    write(group.title, title);
    groups.push(group);
    return group;
  }
  function addRow(group, id, title, description, action, kind = 'info') {
    const row = {
      id, title, status: description, kind, action, busy: false, y: 0, height: 86,
      titleText: createText(13.2, colors.ink), statusText: createText(9.7, colors[kind]),
      arrow: createText(21, colors.muted, false, 'right'), separator: createText(7, colors.line)
    };
    write(row.titleText, title); write(row.statusText, description); write(row.arrow, '›');
    write(row.separator, '─'.repeat(90));
    rows.push(row); group.rows.push(row);
    return row;
  }

  const eyebrow = createText(10, colors.success, true);
  const heading = createText(25, colors.ink, true);
  const subheading = createText(10.2, colors.muted);
  const hint = createText(9.3, colors.muted);
  const footer = createText(9.1, colors.muted, false, 'center');
  write(eyebrow, `${platform} · 功能示例`);
  write(heading, '小游戏能力');
  write(subheading, 'Construct 3  ×  MiniGameBridge');
  write(hint, '先选分类，再点按功能 · 结果来自实际调用');
  write(footer, '绿色代表收到结果，未配置项不执行\n开发者工具验证不等于手机真机验证');

  const basic = addGroup('基础信息');
  const initRow = addRow(basic, 'init', '初始化插件', 'MiniGameBridge.init · 等待初始化', async () => {
    const bridge = plugin();
    await bridge.init();
    return outcome(`已就绪 · ${bridge.getPlatform()} · MiniGameBridge 实例`);
  });
  addRow(basic, 'device', '设备与系统', '读取设备型号、系统与平台', () => {
    const value = plugin().getAPISync('getDeviceInfo');
    const parts = [value.brand, value.model, value.system, value.platform].filter(Boolean);
    if (!parts.length) throw new Error('宿主未返回设备信息');
    return outcome(parts.join(' · '));
  });
  addRow(basic, 'window', '窗口与像素比', '读取窗口尺寸和 pixelRatio', () => {
    const value = windowInfo();
    if (!Number.isFinite(value.windowWidth) || !Number.isFinite(value.windowHeight)) throw new Error('宿主未返回有效窗口尺寸');
    return outcome(`${value.windowWidth} × ${value.windowHeight} px · 像素比 ${value.pixelRatio ?? '未提供'}`);
  });
  addRow(basic, 'safe-area', '屏幕安全区域', '查看宿主返回的安全区边界', () => {
    const safe = windowInfo().safeArea;
    if (!safe) return outcome('当前宿主未提供 safeArea', 'info');
    if (!['top', 'bottom', 'left', 'right'].every(key => Number.isFinite(safe[key]))) throw new Error('宿主返回的安全区边界无效');
    return outcome(`上 ${safe.top} · 下 ${safe.bottom} · 左 ${safe.left} · 右 ${safe.right}`);
  });
  const touchRow = addRow(basic, 'touch', '触摸与点击', '尚未收到 Construct pointerdown', () => outcome(`${pointerCount} 次点击 / 触摸，其中触摸 ${touchCount} 次 · ${lastPointer}`));
  const lifecycleRow = addRow(basic, 'lifecycle', '前后台状态', '前台 · 切换应用后返回查看', () => outcome(`${lifecycle} · onShow ${showCount} 次 / onHide ${hideCount} 次`, 'info'));

  const feedback = addGroup('交互反馈');
  addRow(feedback, 'toast', '轻提示 Toast', '显示一条原生文字提示', async () => {
    await callbackCall(api, 'showToast', { title: '来自真实小游戏 API', icon: 'none', duration: 1800 });
    return outcome('showToast 成功回调 · 已提交原生提示');
  });
  addRow(feedback, 'modal', '对话框 Modal', '确认或取消后，在这里查看返回值', async () => {
    const value = await callbackCall(api, 'showModal', { title: '原生对话框', content: '请选择确认或取消，结果将显示在功能页中。', confirmText: '确认', cancelText: '取消', showCancel: true }, 0);
    if (value.confirm === true) return outcome('用户点击了确认 · confirm = true');
    if (value.cancel === true) return outcome('用户点击了取消 · cancel = true', 'info');
    return outcome('对话框已关闭，未返回确认或取消标记', 'info');
  });
  addRow(feedback, 'vibrate-short', '短振动', '通过 MiniGameBridge 调用原生振动', async () => {
    await (await readyPlugin()).vibrate('short');
    return outcome('短振动请求已返回成功 · 实际触感以设备为准');
  });
  addRow(feedback, 'vibrate-long', '长振动', '通过 MiniGameBridge 调用原生振动', async () => {
    await (await readyPlugin()).vibrate('long');
    return outcome('长振动请求已返回成功 · 实际触感以设备为准');
  });

  const local = addGroup('本地存储 · localStorage 映射');
  addRow(local, 'local-write', '写入测试数据', '写入本示例专用键，不覆盖其他业务数据', () => {
    if (!api) throw new Error('请在小游戏宿主中验证存储映射');
    const value = `本地存储 ${new Date().toLocaleTimeString()}`;
    globalThis.localStorage.setItem(DEMO_CONFIG.storageKey, value);
    if (globalThis.localStorage.getItem(DEMO_CONFIG.storageKey) !== value) throw new Error('写入后读回的数据不一致');
    return outcome(`写入并读回一致 · ${value}`);
  });
  addRow(local, 'local-read', '读取测试数据', '读取 localStorage 中的专用键', () => {
    if (!api) throw new Error('请在小游戏宿主中验证存储映射');
    const value = globalThis.localStorage.getItem(DEMO_CONFIG.storageKey);
    return value === null ? outcome('当前没有测试数据，请先写入', 'info') : outcome(`读到：${short(value, 70)}`);
  });
  addRow(local, 'local-remove', '删除测试数据', '只删除本示例创建的键', () => {
    if (!api) throw new Error('请在小游戏宿主中验证存储映射');
    globalThis.localStorage.removeItem(DEMO_CONFIG.storageKey);
    if (globalThis.localStorage.getItem(DEMO_CONFIG.storageKey) !== null) throw new Error('删除后仍能读到测试值');
    return outcome('专用键已删除 · 读回 null');
  });

  const projectStorage = addGroup('项目存储 · Construct runtime.storage');
  addRow(projectStorage, 'project-write', '写入项目数据', '通过 Construct 异步存储接口写入', async () => {
    const value = `项目存储 ${new Date().toLocaleTimeString()}`;
    await requireMethod(runtime.storage, 'setItem')(DEMO_CONFIG.storageKey, value);
    const readback = await requireMethod(runtime.storage, 'getItem')(DEMO_CONFIG.storageKey);
    if (readback !== value) throw new Error('写入后读取为空或数据不一致');
    return outcome(`写入并读回一致 · ${value}`);
  });
  addRow(projectStorage, 'project-read', '读取项目数据', '读取 runtime.storage 中的专用键', async () => {
    const value = await requireMethod(runtime.storage, 'getItem')(DEMO_CONFIG.storageKey);
    return value === null ? outcome('返回 null · 数据不存在或底层读取失败', 'info') : outcome(`读到：${short(value, 70)}`);
  });
  addRow(projectStorage, 'project-remove', '删除项目数据', '只删除本示例项目存储键', async () => {
    await requireMethod(runtime.storage, 'removeItem')(DEMO_CONFIG.storageKey);
    const value = await requireMethod(runtime.storage, 'getItem')(DEMO_CONFIG.storageKey);
    if (value !== null) throw new Error('删除后仍能读到测试值');
    return outcome('删除请求已完成 · 当前读取返回 null');
  });

  const media = addGroup('音频与包内文件');
  const audioRow = addRow(media, 'audio-play', '播放提示音', '播放包内 beep.wav，等待真实音频回调', row => {
    if (activeAudio) return outcome('音频仍在播放，请先停止', 'info');
    const context = plugin().createAPIObject('createInnerAudioContext');
    return new Promise((resolve, reject) => {
      let settled = false;
      let timer;
      let cleanupError;
      const removeListeners = [];
      const listen = (name, callback) => {
        const off = 'off' + name.slice(2);
        removeListeners.push(() => { if (typeof context[off] === 'function') context[off](callback); });
        requireMethod(context, name)(callback);
      };
      const finish = (error, message) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const failures = [];
        for (const remove of removeListeners.splice(0)) { try { remove(); } catch (failure) { failures.push(failure); } }
        try { context.destroy(); activeAudio = null; }
        catch (failure) {
          failures.push(failure);
          activeAudio = { context, needsCleanup: true, cancel: () => { context.destroy(); activeAudio = null; } };
        }
        if (failures.length) {
          cleanupError = new AggregateError(error ? [error, ...failures] : failures, '原生音频清理失败，请检查控制台或重启当前测试');
          reject(cleanupError);
        }
        else if (error) reject(error);
        else resolve(message);
      };
      try {
        listen('onPlay', () => { if (!settled) setStatus(row, '播放中 · 收到原生 onPlay', 'busy'); });
        listen('onEnded', () => finish(null, outcome('播放完成 · 收到原生 onEnded')));
        listen('onError', error => finish(error || new Error('音频播放失败')));
        if (typeof context.onStop === 'function') listen('onStop', () => finish(null, outcome('已停止 · 收到原生 onStop', 'info')));
        activeAudio = { context, cancel: () => {
          finish(null, outcome('音频已释放', 'info'));
          if (cleanupError) throw cleanupError;
        } };
        context.autoplay = false;
        context.loop = false;
        context.volume = 0.45;
        context.src = DEMO_CONFIG.audioPath;
        timer = setTimeout(() => finish(new Error('音频未在 12 秒内返回结束回调；请检查包内资源路径')), 12000);
        context.play();
      } catch (error) { finish(error); }
    });
  });
  addRow(media, 'audio-stop', '停止音频', '停止本页正在播放的提示音', () => {
    if (!activeAudio) return outcome('当前没有播放中的提示音', 'info');
    if (activeAudio.needsCleanup) {
      activeAudio.cancel();
      return outcome('已重试并成功释放原生音频资源', 'info');
    }
    activeAudio.context.stop();
    return outcome('已调用原生 stop，播放状态以音频回调为准', 'info');
  });
  addRow(media, 'package-read', '读取包内文件', '读取 game/data.json，不向外部发送数据', async () => {
    const manager = plugin().createAPIObject('getFileSystemManager');
    const value = await callbackCall(manager, 'readFile', { filePath: DEMO_CONFIG.packagePath, encoding: 'utf8' });
    if (typeof value.data !== 'string') throw new Error('文件系统未返回 UTF-8 文本');
    JSON.parse(value.data);
    return outcome(`已读取并解析 JSON · ${value.data.length} 个字符`);
  });

  const account = addGroup('平台能力 · 需要有效配置');
  addRow(account, 'login', '获取临时登录凭证', '点击后真实调用登录；不上传、不显示 code', async () => {
    const value = await (await readyPlugin()).login();
    if (typeof value?.code === 'string' && value.code.length) return outcome(`已返回临时 code · ${value.code.length} 个字符，仅保留在插件内存`);
    if (value?.session !== undefined) return outcome('桥接返回会话结果，请按后端协议自行验证', 'info');
    throw new Error('登录未返回 code 或会话结果');
  });
  addRow(account, 'rewarded-ad', '激励视频广告', DEMO_CONFIG.rewardedAdUnitId ? '已配置广告位，点击真实请求视频' : '未配置广告位 · 填写自己的 adUnitId 后体验', async () => {
    if (!DEMO_CONFIG.rewardedAdUnitId) return outcome('未配置 · 请先在 DEMO_CONFIG 填写真实广告位 ID', 'config');
    const result = await (await readyPlugin()).showRewardedVideo(DEMO_CONFIG.rewardedAdUnitId);
    return result.completed === true ? outcome('完整观看 · 宿主 completed = true') : outcome('未完整观看 · 不发放奖励', 'info');
  }, DEMO_CONFIG.rewardedAdUnitId ? 'info' : 'config');


  const extraInfo = addGroup('能力检测与诊断');
  addRow(extraInfo, 'capabilities', '平台 API 能力目录', '查看适配目录与当前宿主方法可用数量', () => {
    const all = plugin().getCapabilities();
    const supported = all.filter(item => item.supported);
    return outcome(`${supported.length} / ${all.length} 个目录接口在当前宿主可调用；具体业务仍需逐项验证`);
  });
  for (const [id, title, method, format] of [
    ['app-info', '应用基础信息', 'getAppBaseInfo', value => value.SDKVersion || value.version ? `SDK ${value.SDKVersion || '未知'} · 客户端 ${value.version || '未知'} · ${value.language || ''}` : null],
    ['launch', '启动场景', 'getLaunchOptionsSync', value => value.scene !== undefined && value.scene !== null ? `场景 ${value.scene} · 启动参数 ${Object.keys(value.query || {}).length} 项（不显示值）` : null],
    ['enter', '本次进入场景', 'getEnterOptionsSync', value => value.scene !== undefined && value.scene !== null ? `场景 ${value.scene} · 参数 ${Object.keys(value.query || {}).length} 项` : null],
    ['authorize-info', '系统授权状态', 'getAppAuthorizeSetting', value => `已读取 ${Object.keys(value).length} 项系统授权状态；不会发起授权`],
    ['system-setting', '系统开关状态', 'getSystemSetting', value => typeof value.wifiEnabled === 'boolean' || typeof value.bluetoothEnabled === 'boolean' ? `Wi-Fi ${value.wifiEnabled ?? '未知'} · 蓝牙 ${value.bluetoothEnabled ?? '未知'}` : null]
  ]) addRow(extraInfo, id, title, `通过插件读取 ${method}`, () => {
    const message = format(plugin().getAPISync(method));
    return message ? outcome(message) : outcome('调用已返回，但宿主未提供本项需要的信息', 'info');
  });
  addRow(extraInfo, 'session', '检查平台登录态', '真实调用 checkSession，过期会显示平台失败', async () => {
    await callbackCall(api, 'checkSession'); return outcome('平台返回会话未过期；服务端身份另行验证');
  });
  addRow(extraInfo, 'permissions', '读取授权设置', '只读取当前设置，不请求权限', async () => {
    const result = await callbackCall(api, 'getSetting');
    return outcome(`收到 ${Object.keys(result.authSetting || {}).length} 项权限状态`);
  });

  addRow(feedback, 'action-sheet', '原生操作菜单', '选择一个菜单项，或取消', async () => {
    const result = await callbackCall(api, 'showActionSheet', {itemList: ['选项一', '选项二', '选项三']}, 0);
    return outcome(`点击第 ${Number(result.tapIndex) + 1} 项`);
  });
  addRow(feedback, 'loading', '显示与关闭 Loading', '显示一秒后真实调用 hideLoading', async () => {
    await callbackCall(api, 'showLoading', {title: '小游戏 API', mask: false});
    await new Promise(resolve => setTimeout(resolve, 1000));
    await callbackCall(api, 'hideLoading'); return outcome('showLoading / hideLoading 均已返回成功');
  });
  addRow(feedback, 'toast-hide', '关闭轻提示', '真实调用 hideToast', async () => {
    await callbackCall(api, 'hideToast'); return outcome('hideToast 成功回调');
  });

  const keyboard = addGroup('键盘与输入');
  let keyboardState = '尚未收到键盘事件';
  const keyboardEventsRow = addRow(keyboard, 'keyboard-events', '键盘事件', '点按此项开始监听；不记录输入内容', () => {
    if (keyboardEventsRow.subscribed) return outcome(keyboardState, 'info');
    for (const name of ['onKeyboardInput', 'onKeyboardConfirm', 'onKeyboardComplete']) {
      if (!plugin().supportsAPI(name)) continue;
      cleanup.push(plugin().onAPIEvent(name, value => {
        keyboardState = `${name} · 输入 ${String(value.value || '').length} 个字符（内容不显示）`;
        setStatus(keyboardEventsRow, keyboardState, 'success');
      }));
      keyboardEventsRow.subscribed = true;
    }
    if (!keyboardEventsRow.subscribed) throw new Error('当前宿主没有可移除的键盘事件接口');
    return outcome('监听已启用 · 再点显示键盘进行输入');
  });
  addRow(keyboard, 'keyboard-show', '显示原生键盘', '初始内容为 Demo，可手动输入', async () => {
    await callbackCall(api, 'showKeyboard', {defaultValue: 'Demo', maxLength: 80, multiple: false, confirmHold: false, confirmType: 'done', keyboardType: 'text'});
    return outcome('显示请求成功；输入与完成结果见键盘事件');
  });
  addRow(keyboard, 'keyboard-hide', '隐藏原生键盘', '真实调用 hideKeyboard', async () => {
    await callbackCall(api, 'hideKeyboard'); return outcome('hideKeyboard 成功回调');
  });

  const nativeStorage = addGroup('原生存储与文件');
  const nativeKey = DEMO_CONFIG.storageKey + ':native';
  addRow(nativeStorage, 'native-storage-write', '原生异步存储写入', '通过插件 setStorage 写入专用键', async () => {
    await callbackCall(api, 'setStorage', {key: nativeKey, data: {version: 2, message: '你好小游戏'}});
    const result = await callbackCall(api, 'getStorage', {key: nativeKey});
    if (result.data?.message !== '你好小游戏') throw new Error('原生存储读回不一致');
    return outcome('原生异步 setStorage / getStorage 读回一致');
  });
  addRow(nativeStorage, 'native-storage-read', '原生异步存储读取', '读取本示例专用键；缺少时显示平台错误', async () => {
    const value = await callbackCall(api, 'getStorage', {key: nativeKey}); return outcome(`读到 ${short(JSON.stringify(value.data), 90)}`);
  });
  addRow(nativeStorage, 'native-storage-delete', '原生异步存储删除', '只删除本示例专用键', async () => {
    await callbackCall(api, 'removeStorage', {key: nativeKey}); return outcome('removeStorage 返回成功');
  });
  addRow(nativeStorage, 'native-storage-info', '存储空间信息', '只显示数量与占用，不显示业务键名', async () => {
    const value = await callbackCall(api, 'getStorageInfo');
    if (!Array.isArray(value?.keys) || !Number.isFinite(value.currentSize) || !Number.isFinite(value.limitSize)) throw new Error('宿主未返回有效存储空间信息');
    return outcome(`${value.keys?.length ?? 0} 个键 · ${value.currentSize ?? '?'} / ${value.limitSize ?? '?'} KB`);
  });
  addRow(nativeStorage, 'file-roundtrip', '文件写入、读回与清理', '只操作本示例专用临时文件', async () => {
    const manager = plugin().createAPIObject('getFileSystemManager');
    if (!api?.env?.USER_DATA_PATH) throw new Error('宿主未提供 USER_DATA_PATH');
    const filePath = `${api.env.USER_DATA_PATH}/c3-api-demo-${Date.now()}-${Math.random().toString(16).slice(2)}.txt`;
    const data = 'Construct 3 · 真实文件读写';
    let wrote = false;
    try {
      await callbackCall(manager, 'writeFile', {filePath, data, encoding: 'utf8'}); wrote = true;
      const read = await callbackCall(manager, 'readFile', {filePath, encoding: 'utf8'});
      if (read.data !== data) throw new Error('文件读回不一致');
    } finally { if (wrote) await callbackCall(manager, 'unlink', {filePath}); }
    return outcome('writeFile / readFile / unlink 均成功；内容一致');
  });

  const network = addGroup('网络与连接');
  addRow(network, 'network-type', '获取网络类型', '通过插件调用 getNetworkType', async () => {
    const value = await callbackCall(api, 'getNetworkType');
    if (typeof value?.networkType !== 'string' || !value.networkType) throw new Error('宿主未返回网络类型');
    return outcome(`网络类型：${value.networkType}`);
  });
  const networkWatch = addRow(network, 'network-watch', '网络变化事件', '点按启用监听，再切换设备网络', () => {
    if (networkWatch.subscribed) return outcome('已监听；等待实际网络变化', 'info');
    cleanup.push(plugin().onAPIEvent('onNetworkStatusChange', value => setStatus(networkWatch, `连接 ${value.isConnected} · ${value.networkType || ''}`, 'success')));
    networkWatch.subscribed = true; return outcome('已注册可移除监听；未模拟网络变化', 'info');
  });
  addRow(network, 'fetch-package', 'fetch 读取包内 JSON', '通过标准 fetch 适配读取 data.json', async () => {
    const response = await fetch('data.json'); const value = await response.json();
    return outcome(`fetch 状态 ${response.status} · JSON 类型 ${typeof value}`);
  });
  addRow(network, 'xhr-package', 'XHR 读取包内 JSON', '通过 XMLHttpRequest 加载，不访问外网', () => new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest(); xhr.open('GET', 'data.json');
    xhr.onload = () => {
      try {
        if (xhr.status !== 200) throw new Error(`HTTP ${xhr.status}`);
        const value = JSON.parse(xhr.responseText);
        resolve(outcome(`XHR 状态 200 · JSON 已解析，类型 ${typeof value}`));
      } catch (error) { reject(error); }
    };
    xhr.onerror = () => reject(new Error('XHR 加载失败')); xhr.send();
  }));
  addRow(network, 'network-request', 'HTTPS 请求', '未配置 · 填写 DEMO_CONFIG.requestURL', async () => {
    if (!DEMO_CONFIG.requestURL) return outcome('未配置 URL，不会向外部发送数据', 'config');
    const value = await callbackCall(api, 'request', {url: DEMO_CONFIG.requestURL, method: 'GET'});
    return outcome(`真实 HTTP 状态 ${value.statusCode}；业务成功请按响应另行判断`, 'info');
  }, 'config');
  addRow(network, 'websocket', 'WebSocket 连接与关闭', '未配置 · 填写自己的 wss 地址', () => {
    if (!DEMO_CONFIG.websocketURL) return outcome('未配置 WebSocket 地址，不建立外部连接', 'config');
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(DEMO_CONFIG.websocketURL); let opened = false;
      const timer = setTimeout(() => { socket.close(); reject(new Error('10 秒内未连接完成')); }, 10000);
      socket.onopen = () => { opened = true; socket.close(1000, 'demo complete'); };
      socket.onerror = () => { clearTimeout(timer); reject(new Error('WebSocket 原生连接失败')); };
      socket.onclose = event => { clearTimeout(timer); opened ? resolve(outcome(`真实 onOpen → onClose · code ${event.code}`)) : reject(new Error('连接建立前关闭')); };
    });
  }, 'config');

  const device = addGroup('设备与运行状态');
  addRow(device, 'battery', '获取电量', '读取当前宿主电池信息', async () => {
    const value = await callbackCall(api, 'getBatteryInfo');
    if (!Number.isFinite(value?.level) || value.level < 0 || value.level > 100 || typeof value.isCharging !== 'boolean') return outcome('调用已返回，但宿主未提供有效电量和充电状态', 'info');
    return outcome(`电量 ${value.level}% · 充电 ${value.isCharging}`);
  });
  addRow(device, 'brightness', '读取屏幕亮度', '只读取，不修改系统亮度', async () => {
    const value = await callbackCall(api, 'getScreenBrightness');
    if (!Number.isFinite(value?.value) || value.value < 0 || value.value > 1) return outcome('调用已返回，但宿主未提供有效亮度', 'info');
    return outcome(`亮度 ${value.value}`);
  });
  addRow(device, 'performance', '单调时钟', '读取原生 performance.now', () => {
    const value = plugin().createAPIObject('getPerformance');
    const now = value.now();
    if (!Number.isFinite(now)) throw new Error('原生 performance.now 未返回有限数值');
    return outcome(`原生时钟 ${now.toFixed(3)}；单位按当前平台定义`);
  });
  const resizeRow = addRow(device, 'resize-watch', '窗口尺寸变化', '点击监听，再旋转或调整模拟器', () => {
    if (resizeRow.subscribed) return outcome('监听中，等待窗口变化', 'info');
    cleanup.push(plugin().onAPIEvent('onWindowResize', value => setStatus(resizeRow, `${value.windowWidth} × ${value.windowHeight}`, 'success')));
    resizeRow.subscribed = true; return outcome('已注册原生窗口监听', 'info');
  });

  addRow(extraInfo, 'safe-check', '运行常用 API 自检', '验证 17 项接口；不发起授权、分享或外网请求', async row => {
    const ids = ['device', 'window', 'safe-area', 'app-info', 'launch', 'enter', 'system-setting', 'network-type', 'native-storage-write', 'native-storage-info', 'native-storage-delete', 'file-roundtrip', 'fetch-package', 'xhr-package', 'battery', 'brightness', 'performance'];
    let passed = 0, failed = 0, skipped = 0;
    for (const id of ids) {
      if (disposed) return outcome('页面已释放，自检已停止', 'info');
      const target = rows.find(item => item.id === id);
      setStatus(row, `正在检查 ${target.title} · ${passed + failed + skipped} / ${ids.length}`, 'busy');
      const result = await activate(target);
      if (result?.kind === 'success') passed++;
      else if (result?.kind === 'error') failed++;
      else skipped++;
    }
    return outcome(`实际返回：${passed} 项成功，${failed} 项失败，${skipped} 项未支持或待验证；进入各分类查看详情`, failed ? 'error' : skipped ? 'info' : 'success');
  });

  const payments = addGroup('支付与订单');
  addRow(payments, 'payment-support', '支付接口支持情况', '仅检测接口；不下单、不扣款', () => {
    const methods = platformId === 'tiktok' ? ['pay', 'checkBalance', 'navigateToBalance'] : ['requestMidasPayment', 'requestMidasPaymentGameItem'];
    return outcome(methods.map(name => `${name}: ${plugin().supportsAPI(name) ? '可调用' : '不支持'}`).join(' · '), 'info');
  });
  addRow(payments, 'payment-contract', '订单与发货流程', '接入自有服务端后再测试支付', () => outcome('服务端创建订单 → 用户支付 → 服务端验签/查单/幂等发货 → 前端刷新；前端回调不代表已发货', 'config'));
  if (platformId === 'tiktok') {
    const revisit = addGroup('TikTok 回访与分享');
    for (const [method, title] of [['startEntranceMission', '前往个人页回访入口'], ['addShortcut', '添加桌面快捷方式'], ['getEntranceMissionReward', '查询回访奖励资格'], ['getShortcutMissionReward', '查询快捷方式奖励资格']]) {
      addRow(revisit, `tiktok-${method}`, title, `真实调用 ${method}；资格结果不自动发奖`, async () => {
        const bridge = await readyPlugin();
        if (!bridge.supportsAPI('canIUse') || !bridge.getAPISync('canIUse', method)) return outcome('当前 TikTok 版本不支持此功能', 'config');
        const result = await bridge.callAPI(method, {});
        return outcome(typeof result?.canReceiveReward === 'boolean' ? `奖励资格：${result.canReceiveReward ? '可领取' : '不可领取'}；由业务层确认发奖` : '已收到原生回调');
      });
    }
  }

  const categoryMenu = addGroup('选择功能分类');
  const demoGroups = groups.filter(group => group !== categoryMenu);
  for (const group of demoGroups) {
    const count = group.rows.length;
    addRow(categoryMenu, `category-${groups.indexOf(group)}`, group.name, `${count} 项测试 · 点按进入`, () => {
      currentGroup = group; scroll = 0; reflow(); return outcome(`${count} 项测试 · 点按进入`, 'info');
    });
    const back = addRow(group, `back-${groups.indexOf(group)}`, '‹ 返回功能分类', '选择其他类别', () => {
      currentGroup = categoryMenu; scroll = 0; reflow(); return outcome('选择其他类别', 'info');
    });
    group.rows.splice(group.rows.indexOf(back), 1); group.rows.unshift(back);
  }
  currentGroup = categoryMenu;
  write(subheading, `Construct 3 · ${rows.filter(row => !row.id.startsWith('category-') && !row.id.startsWith('back-')).length} 项 API 检查`);

  function reflow() {
    if (disposed) return;
    const viewport = layer.getViewport();
    const p0 = layer.cssPxToLayer(0, 0);
    const p1 = layer.cssPxToLayer(1, 0);
    const unit = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) || 1;
    const width = viewport.width / unit;
    const height = viewport.height / unit;
    const margin = Math.max(16, Math.min(28, width * 0.06));
    page = { left: viewport.left, top: viewport.top, width, height, unit, margin };
    let safeTop = 0;
    let safeBottom = 0;
    try {
      const info = windowInfo();
      const screenTop = Number(info.screenTop) || 0;
      safeTop = Math.min(70, Math.max(0, Number(info.safeArea?.top) - screenTop || 0));
      safeBottom = Math.min(50, Math.max(0, Number(info.windowHeight) + screenTop - Number(info.safeArea?.bottom) || 0));
    } catch { /* Unknown safe area is not reported as an API success. */ }
    const contentWidth = Math.max(140, width - margin * 2);
    geometry(eyebrow, margin, safeTop + 20, contentWidth, 22);
    geometry(heading, margin, safeTop + 52, contentWidth, 47);
    geometry(subheading, margin, safeTop + 104, contentWidth, 24);
    geometry(hint, margin, safeTop + 132, contentWidth, 24);
    let y = safeTop + 179;
    for (const group of groups) {
      const hidden = group !== currentGroup;
      group.title.hidden = hidden;
      for (const row of group.rows) for (const key of ['titleText', 'statusText', 'arrow', 'separator']) row[key].hidden = hidden;
      if (hidden) continue;
      geometry(group.title, margin, y, contentWidth, 23);
      y += 34;
      for (const row of group.rows) {
        const statusWidth = contentWidth - 26;
        const units = [...row.status].reduce((n, char) => n + (char.charCodeAt(0) < 256 ? 0.55 : 1), 0);
        // Reserve two lines so live pointer counts do not move a button mid-press.
        const statusLines = Math.max(2, Math.min(4, Math.ceil(units / Math.max(10, statusWidth / 13))));
        const statusHeight = statusLines * 19 + 5;
        row.height = 46 + statusHeight;
        row.y = y;
        geometry(row.titleText, margin, y + 9, contentWidth - 30, 28);
        geometry(row.statusText, margin, y + 39, statusWidth, statusHeight);
        geometry(row.arrow, width - margin - 20, y + 13, 20, 36);
        geometry(row.separator, margin, y + row.height - 5, contentWidth, 13);
        y += row.height + 8;
      }
      y += 24;
    }
    geometry(footer, margin, y + 2, contentWidth, 53);
    maxScroll = Math.max(0, y + 70 + safeBottom - height);
    scroll = Math.max(0, Math.min(scroll, maxScroll));
    layoutSignature = [viewport.left, viewport.top, viewport.width, viewport.height, unit].join(',');
    paintPositions();
  }
  function pointerPosition(event) {
    const [x, y] = layer.cssPxToLayer(event.clientX, event.clientY);
    return { x: (x - page.left) / page.unit, y: (y - page.top) / page.unit };
  }
  function rowAt(point) {
    if (point.x < page.margin || point.x > page.width - page.margin || point.y < 0 || point.y > page.height) return null;
    const documentY = point.y + scroll;
    return currentGroup.rows.find(row => documentY >= row.y && documentY <= row.y + row.height) || null;
  }
  function listen(event, callback) {
    runtime.addEventListener(event, callback);
    cleanup.push(() => runtime.removeEventListener(event, callback));
  }
  listen('pointerdown', event => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const point = pointerPosition(event);
    pointerCount++;
    if (event.pointerType === 'touch') touchCount++;
    lastPointer = `${Math.round(point.x)}, ${Math.round(point.y)} · ${event.pointerType || 'pointer'}`;
    // A live counter is derived solely from Construct's actual input event.
    setStatus(touchRow, `${pointerCount} 次点击 / 触摸，其中触摸 ${touchCount} 次 · ${lastPointer}`, 'info');
    if (drag) return;
    drag = { id: event.pointerId, start: point, last: point, scroll, row: rowAt(point), moved: false };
  });
  listen('pointermove', event => {
    if (!drag || event.pointerId !== drag.id) return;
    const point = pointerPosition(event);
    if (Math.hypot(point.x - drag.start.x, point.y - drag.start.y) > 9) drag.moved = true;
    if (drag.moved) {
      scroll = Math.max(0, Math.min(maxScroll, drag.scroll + drag.start.y - point.y));
      paintPositions();
    }
    drag.last = point;
  });
  listen('pointerup', event => {
    if (!drag || event.pointerId !== drag.id) return;
    const current = drag;
    drag = null;
    const point = pointerPosition(event);
    if (!current.moved && Math.hypot(point.x - current.start.x, point.y - current.start.y) <= 9 && rowAt(point) === current.row) void activate(current.row);
  });
  listen('pointercancel', event => { if (drag?.id === event.pointerId) drag = null; });
  listen('wheel', event => {
    const factor = event.deltaMode === 1 ? 18 : event.deltaMode === 2 ? page.height : 1;
    scroll = Math.max(0, Math.min(maxScroll, scroll + (Number(event.deltaY) || 0) * factor));
    paintPositions();
  });
  listen('resize', reflow);
  listen('tick', () => {
    const viewport = layer.getViewport();
    const p0 = layer.cssPxToLayer(0, 0), p1 = layer.cssPxToLayer(1, 0);
    const signature = [viewport.left, viewport.top, viewport.width, viewport.height, Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) || 1].join(',');
    if (signature !== layoutSignature) reflow();
  });
  function nativeEvent(on, off, callback) {
    if (typeof api?.[on] !== 'function' || typeof api?.[off] !== 'function') return false;
    api[on](callback);
    cleanup.push(() => api[off](callback));
    return true;
  }
  const lifecycleSupported = nativeEvent('onShow', 'offShow', () => {
    showCount++; lifecycle = '前台 · 收到原生 onShow';
    setStatus(lifecycleRow, `${lifecycle} · 返回 ${showCount} 次`, 'success');
    reflow();
  }) && nativeEvent('onHide', 'offHide', () => {
    hideCount++; lifecycle = '后台 · 收到原生 onHide';
    setStatus(lifecycleRow, `${lifecycle} · 离开 ${hideCount} 次`, 'info');
    drag = null;
  });
  if (!lifecycleSupported) setStatus(lifecycleRow, '当前宿主未提供可移除的 onShow / onHide 监听', 'info');

  function dispose() {
    if (disposed) return;
    disposed = true;
    const failures = [];
    for (const remove of cleanup.splice(0)) { try { remove(); } catch (error) { failures.push(error); } }
    try { activeAudio?.cancel(); } catch (error) { failures.push(error); }
    for (const element of elements) { try { element.instance.destroy(); } catch (error) { failures.push(error); } }
    if (globalThis.__C3ApiDemo === debugView) delete globalThis.__C3ApiDemo;
    if (failures.length) console.error(new AggregateError(failures, '示例页面部分原生资源未能释放'));
  }
  const debugView = {
    dispose,
    getSnapshot: () => ({ platform, category: currentGroup?.name, scroll, maxScroll, pointerCount, touchCount,
      rows: rows.map(row => ({ id: row.id, title: row.title, visible: !row.titleText.hidden, status: row.status, kind: row.kind, busy: row.busy,
        bounds: { x: page.margin, y: row.y - scroll, width: page.width - 2 * page.margin, height: row.height } })) })
  };
  globalThis.__C3ApiDemo = debugView;
  listen('beforeanylayoutend', dispose);
  for (const instance of originalText) instance.destroy();
  reflow();
  void activate(initRow);
}
