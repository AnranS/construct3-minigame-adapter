import {subscribeSharedEvent} from './native-events.js';
import {MiniEvent, MiniEventTarget, attachEvents, requireMethod} from './events.js';
import {createNetwork, MiniHeaders, MiniResponse, resolveAssetPath} from './network.js';
import {createPlatformBridge} from './bridge.js';
import {createAudioClass} from './audio.js';
import {createBinaryCompatibility} from './binary.js';
import {DOMRect, DOMRectReadOnly} from './geometry.js';
import {createWebSocketClass} from './websocket.js';
export {createPlatformBridge} from './bridge.js';
export {resolveAssetPath} from './network.js';

const installed = new WeakMap();
const LOCAL_ORIGIN = 'https://c3-minigame.invalid';

function createStyle() {
  return {
    setProperty(name, value) { this[name] = String(value); },
    getPropertyValue(name) { return this[name] || ''; },
    removeProperty(name) { const previous = this[name]; delete this[name]; return previous || ''; }
  };
}
function descriptor(object, name) {
  for (let current = object; current; current = Object.getPrototypeOf(current)) {
    const value = Object.getOwnPropertyDescriptor(current, name);
    if (value) return value;
  }
}


/** Deliberately limited CSS media-query evaluator. Unknown syntax never claims support. */
function matchesMediaQuery(query, viewport) {
  return query.toLowerCase().split(',').some(alternative => {
    const terms = alternative.trim().split(/\s+and\s+/);
    return terms.every(term => {
      term = term.trim();
      if (term === 'all' || term === 'screen') return true;
      let match = /^\(\s*display-mode\s*:\s*(browser|standalone)\s*\)$/.exec(term);
      if (match) return match[1] === 'standalone'; // Native game shell has no browser chrome.
      match = /^\(\s*orientation\s*:\s*(portrait|landscape)\s*\)$/.exec(term);
      if (match) return match[1] === (viewport.width > viewport.height ? 'landscape' : 'portrait');
      match = /^\(\s*(?:(min|max)-)?(width|height)\s*:\s*(\d+(?:\.\d+)?)px\s*\)$/.exec(term);
      if (match) {
        const value = Number(match[3]);
        return match[1] === 'min' ? viewport[match[2]] >= value : match[1] === 'max' ? viewport[match[2]] <= value : viewport[match[2]] === value;
      }
      return false;
    });
  });
}

/** Pixel-buffer shape for engines that inspect ImageData; this does not emulate a native canvas. */
class MiniImageData {
  constructor(dataOrWidth, widthOrHeight, optionalHeight) {
    const suppliedPixels = dataOrWidth instanceof Uint8ClampedArray;
    const width = suppliedPixels ? widthOrHeight : dataOrWidth;
    const height = suppliedPixels ? optionalHeight ?? dataOrWidth.length / (4 * width) : widthOrHeight;
    if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) throw new RangeError('ImageData dimensions must be positive integers');
    if (suppliedPixels && dataOrWidth.length !== width * height * 4) throw new RangeError('ImageData pixel length must match width × height × 4');
    if (!suppliedPixels && typeof dataOrWidth !== 'number') throw new TypeError('ImageData pixels must be Uint8ClampedArray');
    Object.defineProperties(this, {
      data: {value: suppliedPixels ? dataOrWidth : new Uint8ClampedArray(width * height * 4), enumerable: true},
      width: {value: width, enumerable: true}, height: {value: height, enumerable: true}, colorSpace: {value: 'srgb', enumerable: true}
    });
  }
  get [Symbol.toStringTag]() { return 'ImageData'; }
}

/** Install only missing globals, except fetch/XHR which must resolve package assets.
 * Existing descriptors are restored on dispose. The adapter is intentionally not a complete DOM.
 */
export function installAdapter({platform = 'douyin', host = globalThis, api = platform === 'tiktok' ? host.TTMinis?.game : host[platform === 'douyin' ? 'tt' : 'wx'], assetRoot = 'game', width, height, pixelRatio, bridgeConfig = {}, loadScript, autoClaimMainCanvas = true} = {}) {
  if (!['douyin', 'wechat', 'tiktok'].includes(platform)) throw new Error(`Unsupported platform: ${platform}`);
  if (installed.has(host)) {
    const existing = installed.get(host);
    if (existing.platform !== platform || existing.api !== api) throw new Error('A different adapter is already installed on this host');
    return existing;
  }
  if (!api) throw new Error(`Missing platform API: ${platform === 'tiktok' ? 'TTMinis.game' : platform === 'douyin' ? 'tt' : 'wx'}`);
  resolveAssetPath('probe', assetRoot); // Validate before changing the host.
  if (host.document?.createElement && !host.document.__c3MiniGameAdapter) throw new Error('Refusing to replace an existing browser DOM; install only in a mini-game VM');
  const info = typeof api.getWindowInfo === 'function' ? api.getWindowInfo() : typeof api.getSystemInfoSync === 'function' ? api.getSystemInfoSync() : {};
  let cssWidth = width ?? info.windowWidth ?? info.screenWidth ?? 375;
  let cssHeight = height ?? info.windowHeight ?? info.screenHeight ?? 667;
  const dpr = pixelRatio ?? info.pixelRatio ?? 1;
  const changes = [];
  const managedGlobals = new Set();
  const nativeCanvases = new WeakSet();
  const nativeImages = new WeakSet();
  const nodeRelations = new WeakMap();
  const mediaQueries = new Set();
  const nativeSubscriptions = [];
  const audioInstances = new Set();
  const webAudioInstances = new Set();
  const socketInstances = new Set();
  const createdTargets = [];
  const pendingFrames = new Set();
  const rafTimers = new Map();
  let disposed = false;
  let disposalPromise;
  const binary = createBinaryCompatibility({api, host});
  const setGlobal = (name, value, overwrite = false) => {
    if (!overwrite && host[name] !== undefined) return;
    const original = Object.getOwnPropertyDescriptor(host, name);
    managedGlobals.add(name);
    if (original && !original.configurable) {
      if ('value' in original && original.writable) { host[name] = value; changes.push(() => { host[name] = original.value; }); return; }
      throw new Error(`Cannot install global ${name}: host property is not configurable`);
    }
    Object.defineProperty(host, name, {value, writable: true, configurable: true, enumerable: true});
    changes.push(() => { if (original) Object.defineProperty(host, name, original); else delete host[name]; });
  };
  const subscribe = (on, off, handler) => {
    if (typeof api[on] !== 'function') return false;
    if (typeof api[off] !== 'function') {
      if (platform !== 'tiktok') throw new Error(`${off} is required to install a disposable adapter`);
      // Some TikTok Native versions expose onWindowResize without an off method.
      // Keep one dispatcher per API/event; disposal releases only our callback,
      // and reinstalling does not accumulate native listeners or retain old DOMs.
      nativeSubscriptions.push(subscribeSharedEvent(api, {name: on}, handler));
      return true;
    }
    // Register rollback before native on: a host can attach, then throw.
    nativeSubscriptions.push(() => api[off](handler)); api[on](handler); return true;
  };
  const windowEvents = new MiniEventTarget();
  const readViewport = () => ({width: host.innerWidth ?? cssWidth, height: host.innerHeight ?? cssHeight});
  class MediaQueryList extends MiniEventTarget {
    constructor(query) {
      super(); this.media = String(query); this.onchange = null;
      this._matches = matchesMediaQuery(this.media, readViewport());
      mediaQueries.add(this); createdTargets.push(this);
    }
    get matches() { return matchesMediaQuery(this.media, readViewport()); }
    addListener(callback) { this.addEventListener('change', callback); }
    removeListener(callback) { this.removeEventListener('change', callback); }
    _refresh() {
      const matches = this.matches;
      if (matches === this._matches) return;
      this._matches = matches;
      this.dispatchEvent(new MiniEvent('change', {matches, media: this.media}));
    }
  }
  windowEvents.addEventListener('resize', () => { for (const query of mediaQueries) query._refresh(); });
  let document;
  const logicalParent = node => nodeRelations.get(node)?.parent || null;
  const defineDOMProperty = (node, name, definition) => {
    const own = Object.getOwnPropertyDescriptor(node, name);
    if (own && !own.configurable) return false;
    Object.defineProperty(node, name, {configurable: true, enumerable: true, ...definition});
    return true;
  };
  const supplementDOMProperty = (node, name, value) => {
    if (node[name] === undefined) defineDOMProperty(node, name, {value, writable: true});
  };
  const trackNode = node => {
    if (nodeRelations.has(node)) return;
    const relationship = {parent: null};
    nodeRelations.set(node, relationship);
    // Shadow inherited readonly DOM accessors without changing the native object identity.
    // Nonconfigurable own getters remain native; adapter tree operations always use the map.
    defineDOMProperty(node, 'parentNode', {get: () => relationship.parent});
    defineDOMProperty(node, 'parentElement', {get: () => relationship.parent});
    defineDOMProperty(node, 'ownerDocument', {get: () => document});
  };
  const scheduleScript = script => {
    if (script._started) return;
    script._started = true;
    Promise.resolve().then(() => {
      if (disposed) throw new Error('Adapter is disposed');
      if (!loadScript) throw new Error(`Dynamic script loading requires the bundled module loader: ${script.src || '(inline)'}`);
      if (!script.src) throw new Error('Inline script execution is not supported');
      return loadScript(script.src);
    }).then(() => { script.dispatchEvent(new MiniEvent('load')); }, error => {
      script.lastError = error;
      script.dispatchEvent(new MiniEvent('error', {error, message: error.message}));
      windowEvents.dispatchEvent(new MiniEvent('error', {error, message: error.message}));
    });
  };
  class Element extends MiniEventTarget {
    constructor(tagName) {
      super(); this.tagName = tagName.toUpperCase(); this.nodeName = this.tagName; this.nodeType = 1;
      this.id = ''; this.style = createStyle(); this.children = []; this.childNodes = this.children;
      this.textContent = ''; this.className = ''; this.dataset = {};
      this.attributes = new Map(); trackNode(this);
      this.classList = {
        add: (...names) => { this.className = [...new Set([...this.className.split(/\s+/).filter(Boolean), ...names])].join(' '); },
        remove: (...names) => { this.className = this.className.split(/\s+/).filter(name => !names.includes(name)).join(' '); },
        contains: name => this.className.split(/\s+/).includes(name),
        toggle: (name, force) => { const add = force ?? !this.classList.contains(name); this.classList[add ? 'add' : 'remove'](name); return add; }
      };
      createdTargets.push(this);
    }
    appendChild(child) {
      if (!child || (typeof child !== 'object' && typeof child !== 'function')) throw new TypeError('Child must be a node');
      for (let parent = this; parent; parent = logicalParent(parent)) {
        if (parent === child) throw new Error('Cannot append a node inside itself');
      }
      trackNode(child);
      logicalParent(child)?.removeChild(child);
      this.children.push(child); nodeRelations.get(child).parent = this;
      if (child.tagName === 'SCRIPT') scheduleScript(child);
      return child;
    }
    removeChild(child) {
      const index = this.children.indexOf(child);
      if (index < 0) throw new Error('Node is not a child');
      this.children.splice(index, 1); nodeRelations.get(child).parent = null; return child;
    }
    remove() { logicalParent(this)?.removeChild(this); }
    contains(node) {
      for (let current = node; current; current = logicalParent(current)) if (current === this) return true;
      return false;
    }
    setAttribute(name, value) { this.attributes.set(name, String(value)); if (['id', 'src', 'type', 'class'].includes(name)) this[name === 'class' ? 'className' : name] = String(value); }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    hasAttribute(name) { return this.attributes.has(name); }
    removeAttribute(name) { this.attributes.delete(name); }
    getBoundingClientRect() { return {x: 0, y: 0, left: 0, top: 0, right: cssWidth, bottom: cssHeight, width: cssWidth, height: cssHeight}; }
    get clientWidth() { return cssWidth; }
    get clientHeight() { return cssHeight; }
    querySelectorAll(selector) {
      const match = selector.startsWith('#') ? item => item.id === selector.slice(1) : selector.startsWith('.') ? item => item.classList?.contains(selector.slice(1)) : item => item.tagName === selector.toUpperCase();
      const results = [];
      const visit = node => { for (const child of node.children || []) { if (match(child)) results.push(child); visit(child); } };
      visit(this); return results;
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    focus() { document.activeElement = this; }
    blur() { if (document.activeElement === this) document.activeElement = document.body; }
  }
  const decorateCanvas = (canvas, main = false) => {
    nativeCanvases.add(canvas);
    attachEvents(canvas); createdTargets.push(canvas); trackNode(canvas);
    supplementDOMProperty(canvas, 'tagName', 'CANVAS'); supplementDOMProperty(canvas, 'nodeName', 'CANVAS'); supplementDOMProperty(canvas, 'nodeType', 1);
    supplementDOMProperty(canvas, 'id', main ? 'c3canvas' : ''); supplementDOMProperty(canvas, 'style', createStyle());
    defineDOMProperty(canvas, 'getBoundingClientRect', {value: () => ({x: 0, y: 0, left: 0, top: 0, right: cssWidth, bottom: cssHeight, width: cssWidth, height: cssHeight}), writable: true});
    supplementDOMProperty(canvas, 'setAttribute', (name, value) => { if (name === 'width' || name === 'height') canvas[name] = Number(value); else canvas[name] = String(value); });
    supplementDOMProperty(canvas, 'getAttribute', name => canvas[name] ?? null);
    defineDOMProperty(canvas, 'remove', {value: () => logicalParent(canvas)?.removeChild(canvas), writable: true});
    defineDOMProperty(canvas, 'focus', {value: () => { document.activeElement = canvas; }, writable: true});
    // The single screen canvas is already the target of every native touch event.
    defineDOMProperty(canvas, 'setPointerCapture', {value: () => {}, writable: true});
    defineDOMProperty(canvas, 'releasePointerCapture', {value: () => {}, writable: true});
    defineDOMProperty(canvas, 'clientWidth', {get: () => cssWidth});
    defineDOMProperty(canvas, 'clientHeight', {get: () => cssHeight});
    if (main) { canvas.width = Math.round(cssWidth * dpr); canvas.height = Math.round(cssHeight * dpr); }
    return canvas;
  };
  const canvas = decorateCanvas(requireMethod(api, 'createCanvas')(), true);
  const Audio = createAudioClass({api, assetRoot, instances: audioInstances});
  function Image(width, height) {
    const image = requireMethod(api, 'createImage')();
    nativeImages.add(image);
    const src = descriptor(image, 'src');
    if (!src?.set) throw new Error('Native Image.src is not an accessible setter; image path adaptation requires a platform-specific implementation');
    const listeners = new MiniEventTarget();
    image.addEventListener = listeners.addEventListener.bind(listeners);
    image.removeEventListener = listeners.removeEventListener.bind(listeners);
    const callbacks = {};
    const notify = (type, event) => {
      const wrapped = new MiniEvent(type, {target: image, nativeEvent: event, ...(type === 'error' ? {error: event, message: event?.message} : {})});
      listeners.dispatchEvent(wrapped);
      if (typeof callbacks[type] === 'function') callbacks[type].call(image, wrapped);
    };
    for (const type of ['load', 'error']) {
      image[`on${type}`] = event => notify(type, event);
      Object.defineProperty(image, `on${type}`, {configurable: true, get: () => callbacks[type] || null, set: value => { callbacks[type] = value; }});
    }
    let logicalSrc = '', sourceVersion = 0;
    Object.defineProperty(image, 'src', {configurable: true, get: () => logicalSrc, set: value => {
      logicalSrc = String(value);
      const version = ++sourceVersion;
      if (logicalSrc.startsWith('blob:')) {
        binary.resolveImageSource(logicalSrc).then(nativeSource => {
          if (!disposed && sourceVersion === version) src.set.call(image, nativeSource);
        }).catch(error => { if (!disposed && sourceVersion === version) notify('error', error); });
      } else src.set.call(image, /^data:/i.test(logicalSrc) ? logicalSrc : resolveAssetPath(logicalSrc, assetRoot));
    }});
    if (width !== undefined) image.width = width;
    if (height !== undefined) image.height = height;
    supplementDOMProperty(image, 'tagName', 'IMG'); supplementDOMProperty(image, 'nodeName', 'IMG'); supplementDOMProperty(image, 'nodeType', 1);
    supplementDOMProperty(image, 'style', createStyle()); trackNode(image);
    defineDOMProperty(image, 'remove', {value: () => logicalParent(image)?.removeChild(image), writable: true});
    createdTargets.push(listeners);
    return image;
  }
  function HTMLCanvasElement() { throw new TypeError('Illegal constructor; use document.createElement("canvas")'); }
  function HTMLImageElement() { throw new TypeError('Illegal constructor; use new Image()'); }
  Object.defineProperty(HTMLCanvasElement, Symbol.hasInstance, {value: value => nativeCanvases.has(value)});
  Object.defineProperty(HTMLImageElement, Symbol.hasInstance, {value: value => nativeImages.has(value)});
  Object.defineProperty(Image, Symbol.hasInstance, {value: value => nativeImages.has(value)});
  let firstCanvasClaimed = false;
  let mainCanvasClaimPending = autoClaimMainCanvas;
  const location = {href: `${LOCAL_ORIGIN}/${assetRoot}/index.html`, origin: LOCAL_ORIGIN, protocol: 'https:', host: 'c3-minigame.invalid', hostname: 'c3-minigame.invalid', pathname: `/${assetRoot}/index.html`, search: '', hash: ''};
  document = new MiniEventTarget();
  Object.assign(document, {
    __c3MiniGameAdapter: true, nodeType: 9, readyState: 'complete', visibilityState: 'visible', hidden: false,
    baseURI: location.href, location, defaultView: host, fonts: undefined,
    createElement(name) {
      switch (String(name).toLowerCase()) {
        case 'canvas': if (mainCanvasClaimPending && !firstCanvasClaimed) { firstCanvasClaimed = true; mainCanvasClaimPending = false; return canvas; } return decorateCanvas(requireMethod(api, 'createCanvas')());
        case 'img': case 'image': return new Image();
        case 'audio': return new Audio();
        // Inert capability-probe elements: no download or directory picker properties.
        case 'a': case 'input': return new Element(name);
        case 'div': case 'span': case 'head': case 'body': case 'html': case 'style': case 'script': return new Element(name);
        default: throw new Error(`Unsupported DOM element <${name}> in mini-game adapter`);
      }
    },
    createTextNode(text) { const node = {nodeType: 3, textContent: String(text)}; trackNode(node); return node; },
    getElementById(id) { return document.documentElement.querySelector(`#${id}`) || (canvas.id === id ? canvas : null); },
    querySelector(selector) { if (selector === 'canvas' || selector === '#c3canvas') return canvas; return document.documentElement.querySelector(selector); },
    querySelectorAll(selector) { if (selector === 'canvas' && !logicalParent(canvas)) return [canvas]; return document.documentElement.querySelectorAll(selector); },
    getElementsByTagName(name) { return document.querySelectorAll(name); },
    hasFocus() { return !document.hidden; }
  });
  document.documentElement = new Element('html'); document.head = new Element('head'); document.body = new Element('body');
  document.documentElement.appendChild(document.head); document.documentElement.appendChild(document.body); document.activeElement = document.body;
  const storagePrefix = 'c3-adapter:';
  const storageKeys = () => requireMethod(api, 'getStorageInfoSync')().keys.filter(key => key.startsWith(storagePrefix));
  const localStorage = {
    get length() { return storageKeys().length; },
    key(index) { return storageKeys()[index]?.slice(storagePrefix.length) ?? null; },
    getItem(key) {
      const fullKey = storagePrefix + String(key);
      // TikTok point reads must not depend on the separate storage inventory:
      // an omitted key must not prevent us from reading its persisted value.
      if (platform !== 'tiktok' && !storageKeys().includes(fullKey)) return null;
      const value = requireMethod(api, 'getStorageSync')(fullKey);
      return platform === 'tiktok' && value == null ? null : String(value);
    },
    setItem(key, value) { requireMethod(api, 'setStorageSync')(storagePrefix + String(key), String(value)); },
    removeItem(key) { requireMethod(api, 'removeStorageSync')(storagePrefix + String(key)); },
    clear() { for (const key of storageKeys()) requireMethod(api, 'removeStorageSync')(key); }
  };
  const network = createNetwork({api, assetRoot, host});
  const bridge = createPlatformBridge({api, platform, ...bridgeConfig});
  const performanceStart = Date.now();
  const performance = host.performance || (typeof api.getPerformance === 'function' ? api.getPerformance() : {now: () => Date.now() - performanceStart, timeOrigin: performanceStart});
  const nativeRAF = host.requestAnimationFrame?.bind(host) || canvas.requestAnimationFrame?.bind(canvas);
  const nativeCAF = host.cancelAnimationFrame?.bind(host) || canvas.cancelAnimationFrame?.bind(canvas);
  const timer = host.setTimeout?.bind(host) || setTimeout;
  const clearTimer = host.clearTimeout?.bind(host) || clearTimeout;
  let frameID = 0;
  const requestAnimationFrame = callback => {
    if (disposed) throw new Error('Adapter is disposed');
    if (nativeRAF && nativeCAF) {
      let id;
      id = nativeRAF(time => { pendingFrames.delete(id); if (!disposed) callback(time); }); pendingFrames.add(id); return id;
    }
    const id = ++frameID;
    rafTimers.set(id, timer(() => { rafTimers.delete(id); if (!disposed) callback(performance.now()); }, 16)); return id;
  };
  const cancelAnimationFrame = id => {
    if (pendingFrames.delete(id)) nativeCAF(id);
    if (rafTimers.has(id)) { clearTimer(rafTimers.get(id)); rafTimers.delete(id); }
  };
  const adapter = {canvas, platform, api, bridge,
    claimMainCanvas() {
      if (firstCanvasClaimed) throw new Error('The main canvas has already been claimed');
      mainCanvasClaimPending = true;
      return canvas;
    },
    capabilities: Object.freeze({dom: 'subset', network: true, websocket: typeof api.connectSocket === 'function', audio: typeof api.createInnerAudioContext === 'function' ? 'native-basic' : false, webAudio: typeof api.createWebAudioContext === 'function' ? 'native' : false, workers: 'external-shim', webGL: 'native-canvas-only'}),
    dispose() {
      if (disposed) return disposalPromise;
      disposed = true;
      const errors = [], pending = [];
      const release = action => {
        try {
          const result = action();
          if (result && typeof result.then === 'function') pending.push(Promise.resolve(result).catch(error => errors.push(error)));
        } catch (error) { errors.push(error); }
      };
      release(() => binary.dispose());
      for (const unsubscribe of nativeSubscriptions.splice(0)) release(unsubscribe);
      for (const id of [...pendingFrames, ...rafTimers.keys()]) release(() => cancelAnimationFrame(id));
      for (const audio of [...audioInstances]) release(() => audio.dispose());
      for (const socket of [...socketInstances]) release(() => socket.dispose());
      for (const context of webAudioInstances) {
        if (typeof context.destroy === 'function') release(() => context.destroy());
        else if (typeof context.close === 'function') release(() => context.close());
      }
      webAudioInstances.clear();
      release(() => bridge.dispose());
      release(() => network.dispose());
      mediaQueries.clear();
      for (const target of [...createdTargets, document, windowEvents]) target._listeners?.clear();
      for (const restore of changes.reverse()) release(restore);
      installed.delete(host);
      disposalPromise = Promise.all(pending).then(() => {
        if (errors.length) throw new AggregateError(errors, 'Some native resources failed to release; all cleanup steps were attempted');
      });
      return disposalPromise;
    }
  };
  try {
    for (const [key, value] of Object.entries({window: host, self: host, top: host, parent: host, globalThis: host, document, Blob: binary.Blob, atob: binary.atob, btoa: binary.btoa, URLSearchParams: binary.URLSearchParams, Image, Audio, HTMLImageElement, HTMLCanvasElement, ImageData: MiniImageData, DOMRect, DOMRectReadOnly, HTMLAudioElement: Audio, HTMLElement: Element, Event: MiniEvent, PointerEvent: MiniEvent, EventTarget: MiniEventTarget, Headers: MiniHeaders, Response: MiniResponse, localStorage, performance,
      navigator: {userAgent: `Construct3MiniGame/${platform}`, platform: info.platform || platform, language: info.language || 'zh-CN', onLine: true, maxTouchPoints: 10, hardwareConcurrency: 1,
        getGamepads() {
          // No platform polling API means no gamepads are exposed to this runtime.
          if (typeof api.getGamepads !== 'function') return [];
          const gamepads = api.getGamepads();
          if (!Array.isArray(gamepads)) throw new TypeError('Platform getGamepads must return a synchronous array');
          return gamepads;
        }
      },
      location,
      innerWidth: cssWidth, innerHeight: cssHeight, outerWidth: cssWidth, outerHeight: cssHeight, devicePixelRatio: dpr,
      screen: {width: cssWidth, height: cssHeight, availWidth: cssWidth, availHeight: cssHeight},
      addEventListener: windowEvents.addEventListener.bind(windowEvents), removeEventListener: windowEvents.removeEventListener.bind(windowEvents), dispatchEvent: windowEvents.dispatchEvent.bind(windowEvents),
      getComputedStyle: element => element.style, matchMedia: query => new MediaQueryList(query), C3MiniGameBridge: bridge
    })) setGlobal(key, value);
    if (typeof api.createWebAudioContext === 'function') {
      setGlobal('AudioContext', function AudioContext(options) {
        if (disposed) throw new Error('Adapter is disposed');
        if (options?.sampleRate) throw new Error('Explicit Web Audio sampleRate is not supported by the native mini-game API');
        const context = api.createWebAudioContext();
        if (!context) throw new Error('Native createWebAudioContext returned no context');
        webAudioInstances.add(context);
        return context;
      });
    }
    setGlobal('URL', binary.URL, true);
    setGlobal('fetch', network.fetch, true); setGlobal('XMLHttpRequest', network.XMLHttpRequest, true);
    if (typeof api.connectSocket === 'function') setGlobal('WebSocket', createWebSocketClass({api, URLClass: binary.URL, BlobClass: binary.Blob, instances: socketInstances}), true);
    setGlobal('requestAnimationFrame', requestAnimationFrame, true); setGlobal('cancelAnimationFrame', cancelAnimationFrame, true);
    const bubble = event => {
      event.target = canvas;
      const parents = [];
      for (let parent = logicalParent(canvas); parent; parent = logicalParent(parent)) parents.push(parent);
      parents.push(document, windowEvents);
      event._dispatchPhase = 'capture'; event.eventPhase = 1;
      for (const target of [...parents].reverse()) {
        target.dispatchEvent(event);
        if (event._stopped) return;
      }
      event._dispatchPhase = undefined; event.eventPhase = 2;
      canvas.dispatchEvent(event);
      if (!event._stopped && event.bubbles) {
        event._dispatchPhase = 'bubble'; event.eventPhase = 3;
        for (const target of parents) {
          target.dispatchEvent(event);
          if (event._stopped) break;
        }
      }
      event._dispatchPhase = undefined; event.eventPhase = 0;
    };
    const activeTouches = new Map();
    const touchPointerIds = new Map();
    let nextTouchPointerId = 1;
    let primaryTouch = null;
    const touchKey = touch => String(touch.identifier);
    const pointerIdFor = touch => {
      const key = touchKey(touch);
      if (!touchPointerIds.has(key)) touchPointerIds.set(key, nextTouchPointerId++);
      return touchPointerIds.get(key);
    };
    for (const [suffix, type, pointerType] of [['Start', 'touchstart', 'pointerdown'], ['Move', 'touchmove', 'pointermove'], ['End', 'touchend', 'pointerup'], ['Cancel', 'touchcancel', 'pointercancel']]) {
      subscribe(`onTouch${suffix}`, `offTouch${suffix}`, native => {
        if (disposed) return;
        const mapTouch = touch => {
          const raw = touch.identifier ?? touch.id ?? 0;
          const number = Number(raw);
          const identifier = Number.isSafeInteger(number) && number >= 0 ? number : raw;
          // TikTok documents screen coordinates on Touch. Its window can start
          // below the screen origin; browser client coordinates are window-local.
          // Explicit client/x values take precedence when the host supplies them.
          const clientX = touch.clientX ?? touch.x ?? (platform === 'tiktok' ? touch.screenX : undefined) ?? 0;
          const clientY = touch.clientY ?? touch.y ?? (platform === 'tiktok' && Number.isFinite(touch.screenY) ? touch.screenY - (Number.isFinite(info.screenTop) ? info.screenTop : 0) : undefined) ?? 0;
          return {...touch, identifier, target: canvas, clientX, clientY, pageX: touch.pageX ?? clientX, pageY: touch.pageY ?? clientY};
        };
        const touches = (native.touches || []).map(mapTouch);
        const current = new Map(touches.map(touch => [touchKey(touch), touch]));
        const ended = suffix === 'End' || suffix === 'Cancel';
        let changedTouches;
        if (native.changedTouches?.length) changedTouches = native.changedTouches.map(mapTouch);
        else if (ended) changedTouches = [...activeTouches].filter(([key]) => !current.has(key)).map(([, touch]) => touch);
        else if (suffix === 'Start' && native.changedTouches) changedTouches = touches.filter(touch => !activeTouches.has(touchKey(touch)));
        else changedTouches = touches;
        // Keep a stable numeric PointerEvent ID even if a native host sends string IDs.
        if (!activeTouches.size && touches.length) primaryTouch = touchKey(touches[0]);
        for (const touch of touches) pointerIdFor(touch);
        activeTouches.clear();
        for (const [key, touch] of current) activeTouches.set(key, touch);
        bubble(new MiniEvent(type, {touches, targetTouches: touches, changedTouches, bubbles: true, cancelable: true, timeStamp: native.timeStamp}));
        for (const touch of changedTouches) bubble(new MiniEvent(pointerType, {...touch, pointerId: pointerIdFor(touch), pointerType: 'touch', isPrimary: touchKey(touch) === primaryTouch, buttons: ended ? 0 : 1, button: 0, pressure: ended ? 0 : touch.force ?? .5, bubbles: true, cancelable: true, timeStamp: native.timeStamp}));
        if (ended) for (const touch of changedTouches) touchPointerIds.delete(touchKey(touch));
        if (!activeTouches.size) primaryTouch = null;
      });
    }
    subscribe('onWheel', 'offWheel', native => {
      if (disposed) return;
      const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
      const clientX = finite(native.clientX, finite(native.x));
      const clientY = finite(native.clientY, finite(native.y));
      const event = new MiniEvent('wheel', {
        clientX, clientY, pageX: finite(native.pageX, clientX), pageY: finite(native.pageY, clientY),
        deltaX: finite(native.deltaX), deltaY: finite(native.deltaY), deltaZ: finite(native.deltaZ),
        deltaMode: native.deltaMode === 1 || native.deltaMode === 2 ? native.deltaMode : 0,
        ctrlKey: !!native.ctrlKey, shiftKey: !!native.shiftKey, altKey: !!native.altKey, metaKey: !!native.metaKey,
        bubbles: true, cancelable: native.cancelable !== false, timeStamp: native.timeStamp
      });
      bubble(event);
      if (event.defaultPrevented && typeof native.preventDefault === 'function') native.preventDefault.call(native);
    });
    subscribe('onWindowResize', 'offWindowResize', size => {
      if (Number.isFinite(size.windowWidth) && size.windowWidth > 0) cssWidth = size.windowWidth;
      if (Number.isFinite(size.windowHeight) && size.windowHeight > 0) cssHeight = size.windowHeight;
      for (const [key, value] of Object.entries({innerWidth: cssWidth, outerWidth: cssWidth, innerHeight: cssHeight, outerHeight: cssHeight})) {
        if (managedGlobals.has(key)) host[key] = value;
      }
      if (managedGlobals.has('screen')) Object.assign(host.screen, {width: cssWidth, height: cssHeight, availWidth: cssWidth, availHeight: cssHeight});
      windowEvents.dispatchEvent(new MiniEvent('resize'));
    });
    subscribe('onHide', 'offHide', () => { document.hidden = true; document.visibilityState = 'hidden'; document.dispatchEvent(new MiniEvent('visibilitychange')); windowEvents.dispatchEvent(new MiniEvent('blur')); });
    subscribe('onShow', 'offShow', () => { document.hidden = false; document.visibilityState = 'visible'; document.dispatchEvent(new MiniEvent('visibilitychange')); windowEvents.dispatchEvent(new MiniEvent('focus')); });
    subscribe('onNetworkStatusChange', 'offNetworkStatusChange', value => {
      const online = value?.isConnected;
      if (typeof online !== 'boolean' || !managedGlobals.has('navigator') || host.navigator.onLine === online) return;
      host.navigator.onLine = online;
      windowEvents.dispatchEvent(new MiniEvent(online ? 'online' : 'offline'));
    });
    installed.set(host, adapter);
    return adapter;
  } catch (error) { adapter.dispose().catch(() => {}); throw error; }
}
