/**
 * Create an engine-only global object without changing the native mini-game/devtools realm.
 * Keep this function dependency-free: the build wrapper may embed its function source before
 * bundled libraries execute so their global detection sees standard JavaScript intrinsics.
 */
export function createEngineScope(nativeHost, {platform = 'douyin', api, nativeBindings = {}} = {}) {
  if (!nativeHost || (typeof nativeHost !== 'object' && typeof nativeHost !== 'function')) throw new TypeError('A native host object is required');
  if (platform !== 'douyin' && platform !== 'wechat') throw new Error(`Unsupported platform: ${platform}`);
  const ownsBinding = name => Object.prototype.hasOwnProperty.call(nativeBindings, name);
  const readNative = name => ownsBinding(name) ? nativeBindings[name] : nativeHost[name];
  const apiName = platform === 'douyin' ? 'tt' : 'wx';
  const platformAPI = api || readNative(apiName);
  if (!platformAPI || typeof platformAPI.createCanvas !== 'function') throw new Error(`Missing ${apiName} mini-game API`);
  const scope = Object.create(null);
  // Browser DOM, events, network, storage, workers and audio are deliberately absent:
  // installAdapter supplies their mini-game implementations on this fresh object.
  const intrinsicNames = [
    'Object', 'Function', 'Boolean', 'Symbol', 'Number', 'BigInt', 'Math', 'Date', 'String', 'RegExp',
    'Array', 'Map', 'Set', 'WeakMap', 'WeakSet', 'WeakRef', 'FinalizationRegistry', 'Promise',
    'ArrayBuffer', 'SharedArrayBuffer', 'DataView', 'Int8Array', 'Uint8Array', 'Uint8ClampedArray',
    'Int16Array', 'Uint16Array', 'Int32Array', 'Uint32Array', 'Float16Array', 'Float32Array', 'Float64Array',
    'BigInt64Array', 'BigUint64Array', 'Error', 'EvalError', 'RangeError', 'ReferenceError', 'SyntaxError',
    'TypeError', 'URIError', 'AggregateError', 'JSON', 'Reflect', 'Proxy', 'Intl', 'Atomics', 'WebAssembly',
    'Infinity', 'NaN', 'undefined', 'isNaN', 'isFinite', 'parseFloat', 'parseInt',
    'decodeURI', 'decodeURIComponent', 'encodeURI', 'encodeURIComponent', 'escape', 'unescape',
    'Blob', 'URL', 'URLSearchParams', 'TextEncoder', 'TextDecoder', 'AbortController', 'AbortSignal',
    'DOMException', 'ReadableStream', 'WritableStream', 'TransformStream', 'ByteLengthQueuingStrategy',
    'CountQueuingStrategy', 'CompressionStream', 'DecompressionStream', 'ImageData', 'DOMRect', 'DOMRectReadOnly',
    'WebGLRenderingContext', 'WebGL2RenderingContext'
  ];
  for (const name of intrinsicNames) {
    if (ownsBinding(name) || name in nativeHost) scope[name] = readNative(name);
  }
  for (const name of ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'queueMicrotask',
    'requestAnimationFrame', 'cancelAnimationFrame', 'atob', 'btoa', 'structuredClone']) {
    if (typeof readNative(name) === 'function') scope[name] = readNative(name).bind(nativeHost);
  }
  for (const name of ['console', 'performance', 'crypto']) {
    if (readNative(name) !== undefined) scope[name] = readNative(name);
  }
  scope[apiName] = platformAPI;
  // Real platform wasm variants remain separate; their signatures need platform-specific handling.
  for (const name of ['WXWebAssembly', 'TTWebAssembly']) {
    if (readNative(name) !== undefined) scope[name] = readNative(name);
  }
  scope.globalThis = scope;
  scope.self = scope;
  scope.window = scope;
  scope.global = scope;
  scope.GameGlobal = scope;
  scope.top = scope;
  scope.parent = scope;
  return scope;
}
