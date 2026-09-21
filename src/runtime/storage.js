import {binaryAtob, binaryBtoa} from './binary.js';
import {requireMethod} from './events.js';

const TYPED_ARRAYS = {
  Int8Array, Uint8Array, Uint8ClampedArray, Int16Array, Uint16Array, Int32Array, Uint32Array,
  Float32Array, Float64Array,
  ...(typeof BigInt64Array === 'function' ? {BigInt64Array, BigUint64Array} : {})
};
function bytesToBase64(bytes) {
  const chunks = [];
  for (let offset = 0; offset < bytes.length; offset += 8192) chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 8192)));
  return binaryBtoa(chunks.join(''));
}
function base64ToBuffer(text) {
  const binary = binaryAtob(text);
  return Uint8Array.from(binary, character => character.charCodeAt(0)).buffer;
}
function encode(value, visiting = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : ['number', String(value)];
  if (typeof value === 'undefined') return ['undefined'];
  if (typeof value === 'bigint') return ['bigint', String(value)];
  if (typeof value !== 'object') throw new TypeError(`Unsupported storage value: ${typeof value}`);
  if (visiting.has(value)) throw new TypeError('Cyclic storage values are unsupported');
  const tag = Object.prototype.toString.call(value);
  if (tag === '[object ArrayBuffer]') return ['buffer', bytesToBase64(new Uint8Array(value))];
  if (ArrayBuffer.isView(value)) {
    const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    if (tag === '[object DataView]') return ['view', bytesToBase64(bytes)];
    const name = value.constructor.name;
    if (!Object.prototype.hasOwnProperty.call(TYPED_ARRAYS, name)) throw new TypeError(`Unsupported typed storage value: ${name}`);
    return ['typed', name, bytesToBase64(bytes)];
  }
  if (tag === '[object Date]') return ['date', value.toISOString()];
  visiting.add(value);
  try {
    if (Array.isArray(value)) return ['array', Array.from(value, item => encode(item, visiting))];
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw new TypeError(`Unsupported storage object: ${tag}`);
    return ['object', Object.keys(value).map(key => [key, encode(value[key], visiting)])];
  } finally { visiting.delete(value); }
}
function decode(value) {
  if (!Array.isArray(value)) {
    if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return value;
    throw new Error('Invalid native storage value');
  }
  const [tag, content, binary] = value;
  switch (tag) {
    case 'undefined': return undefined;
    case 'number': {
      if (content === 'NaN') return NaN;
      if (content === 'Infinity') return Infinity;
      if (content === '-Infinity') return -Infinity;
      throw new Error('Invalid stored number');
    }
    case 'bigint': return BigInt(content);
    case 'buffer': return base64ToBuffer(content);
    case 'view': return new DataView(base64ToBuffer(content));
    case 'typed': {
      if (!Object.prototype.hasOwnProperty.call(TYPED_ARRAYS, content)) throw new Error('Invalid stored typed array');
      return new TYPED_ARRAYS[content](base64ToBuffer(binary));
    }
    case 'date': return new Date(content);
    case 'array': return content.map(decode);
    case 'object': {
      const object = {};
      for (const [key, entry] of content) Object.defineProperty(object, key, {value: decode(entry), enumerable: true, writable: true, configurable: true});
      return object;
    }
    default: throw new Error('Unsupported native storage encoding');
  }
}
function clone(value) { return decode(encode(value)); }
function keyString(key) {
  if (typeof key !== 'string') throw new TypeError('Storage key must be a string');
  return key;
}
function noCallback(callback) {
  if (callback !== undefined) throw new TypeError('Native storage supports Promise APIs; callbacks are not supported');
}

/**
 * Optional localforage-shaped store backed by actual platform storage APIs.
 * Never fabricates IndexedDB and never silently replaces failed persistence with memory.
 * Supported values: JSON-like data, Date, ArrayBuffer, DataView and standard typed arrays.
 * Functions, symbols, cycles, Map/Set and Blob are rejected rather than silently corrupted.
 */
export function createPlatformStorage({api, platform = 'wechat', name = 'localforage', storeName = 'keyvaluepairs', namespace = 'c3-native-storage', forceInMemoryFallback = false} = {}) {
  if (!['wechat', 'douyin', 'tiktok'].includes(platform)) throw new Error(`Unsupported storage platform: ${platform}`);
  if (typeof name !== 'string' || !name || typeof storeName !== 'string' || !storeName || typeof namespace !== 'string' || !namespace) throw new TypeError('Storage namespace, name and storeName must be non-empty strings');
  const prefix = `${encodeURIComponent(namespace)}:${encodeURIComponent(name)}:${encodeURIComponent(storeName)}:`;
  let memory = new Map();
  const isMemory = forceInMemoryFallback === true;
  const nativeKeys = () => {
    const result = requireMethod(api, 'getStorageInfoSync')();
    if (!Array.isArray(result?.keys)) throw new Error('Native storage did not return a key list');
    return result.keys.filter(key => typeof key === 'string' && key.startsWith(prefix));
  };
  const methods = {
    async ready(callback) {
      noCallback(callback);
      if (!isMemory) {
        for (const method of ['getStorageSync', 'setStorageSync', 'removeStorageSync']) requireMethod(api, method);
        if (platform !== 'tiktok') nativeKeys();
      }
      return true;
    },
    async getItem(key, callback) {
      noCallback(callback); keyString(key);
      if (isMemory) return memory.has(key) ? clone(memory.get(key)) : null;
      const nativeKey = prefix + encodeURIComponent(key);
      if (platform !== 'tiktok' && !nativeKeys().includes(nativeKey)) return null;
      const payload = requireMethod(api, 'getStorageSync')(nativeKey);
      // Every value written by this store is a non-empty versioned envelope.
      // A null/undefined/empty native result therefore represents a missing key.
      if (platform === 'tiktok' && (payload == null || payload === '')) return null;
      if (typeof payload !== 'string') throw new Error('Native storage payload has an unexpected format');
      const envelope = JSON.parse(payload);
      if (envelope?.version !== 1) throw new Error('Unsupported native storage version');
      return decode(envelope.value);
    },
    async setItem(key, value, callback) {
      noCallback(callback); keyString(key);
      if (value === undefined) value = null;
      const encoded = encode(value);
      if (isMemory) memory.set(key, decode(encoded));
      else requireMethod(api, 'setStorageSync')(prefix + encodeURIComponent(key), JSON.stringify({version: 1, value: encoded}));
      return value;
    },
    async removeItem(key, callback) {
      noCallback(callback); keyString(key);
      if (isMemory) memory.delete(key);
      else requireMethod(api, 'removeStorageSync')(prefix + encodeURIComponent(key));
    },
    async clear(callback) {
      noCallback(callback);
      if (isMemory) memory.clear();
      else for (const key of nativeKeys()) requireMethod(api, 'removeStorageSync')(key);
    },
    async keys(callback) {
      noCallback(callback);
      return isMemory ? [...memory.keys()] : nativeKeys().map(key => decodeURIComponent(key.slice(prefix.length)));
    },
    async length(callback) { noCallback(callback); return (await methods.keys()).length; },
    async key(index, callback) { noCallback(callback); return Number.isInteger(index) && index >= 0 ? (await methods.keys())[index] ?? null : null; },
    async iterate(iterator, callback) {
      noCallback(callback);
      if (typeof iterator !== 'function') throw new TypeError('Storage iterator must be a function');
      const keys = await methods.keys();
      for (let index = 0; index < keys.length; index++) {
        const result = iterator(await methods.getItem(keys[index]), keys[index], index + 1);
        if (result !== undefined) return result;
      }
    },
    createInstance(options = {}) {
      return createPlatformStorage({api, platform, namespace, name, storeName, ...options});
    },
    IsInMemory() { return isMemory; },
    GetMemoryStorage() { if (!isMemory) throw new Error('This store uses native persistence'); return memory; },
    SetMemoryStorage(value) {
      if (!isMemory) throw new Error('This store uses native persistence');
      if (!(value instanceof Map)) throw new TypeError('Memory storage must be a Map');
      const next = new Map();
      for (const [key, entry] of value) next.set(keyString(key), clone(entry));
      memory = next;
    }
  };
  return methods;
}
