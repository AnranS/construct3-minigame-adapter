import PureURL from 'core-js-pure/actual/url/index.js';
import PureURLSearchParams from 'core-js-pure/actual/url-search-params/index.js';

const blobBytes = new WeakMap();
const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function invalidCharacter(message) { const error = new Error(message); error.name = 'InvalidCharacterError'; return error; }
export function binaryBtoa(value) {
  const text = String(value);
  let result = '';
  for (let i = 0; i < text.length; i += 3) {
    const a = text.charCodeAt(i), b = text.charCodeAt(i + 1), c = text.charCodeAt(i + 2);
    if (a > 255 || b > 255 || c > 255) throw invalidCharacter('btoa input must contain only Latin-1 code units');
    result += BASE64[a >> 2] + BASE64[(a & 3) << 4 | (b || 0) >> 4] +
      (i + 1 < text.length ? BASE64[(b & 15) << 2 | (c || 0) >> 6] : '=') +
      (i + 2 < text.length ? BASE64[c & 63] : '=');
  }
  return result;
}
export function binaryAtob(value) {
  let text = String(value).replace(/[\t\n\f\r ]/g, '');
  if (text.length % 4 === 0) text = text.replace(/={1,2}$/, '');
  if (text.length % 4 === 1 || /[^A-Za-z0-9+/]/.test(text)) throw invalidCharacter('Invalid base64 string');
  let accumulator = 0, bits = 0, result = '';
  for (const character of text) {
    accumulator = accumulator << 6 | BASE64.indexOf(character); bits += 6;
    if (bits >= 8) { bits -= 8; result += String.fromCharCode(accumulator >> bits & 255); }
  }
  return result;
}
function encodeUTF8(value) {
  const bytes = [];
  for (const character of String(value)) {
    let n = character.codePointAt(0);
    if (n >= 0xd800 && n <= 0xdfff) n = 0xfffd;
    if (n < 0x80) bytes.push(n);
    else if (n < 0x800) bytes.push(0xc0 | n >> 6, 0x80 | n & 63);
    else if (n < 0x10000) bytes.push(0xe0 | n >> 12, 0x80 | n >> 6 & 63, 0x80 | n & 63);
    else bytes.push(0xf0 | n >> 18, 0x80 | n >> 12 & 63, 0x80 | n >> 6 & 63, 0x80 | n & 63);
  }
  return new Uint8Array(bytes);
}
function decodeUTF8(bytes) {
  const points = [];
  for (let i = 0; i < bytes.length;) {
    const first = bytes[i++];
    if (first < 0x80) { points.push(String.fromCharCode(first)); continue; }
    const count = first >= 0xc2 && first <= 0xdf ? 1 : first >= 0xe0 && first <= 0xef ? 2 : first >= 0xf0 && first <= 0xf4 ? 3 : 0;
    if (!count) { points.push('\ufffd'); continue; }
    let n = first & (count === 1 ? 31 : count === 2 ? 15 : 7), consumed = 0;
    for (; consumed < count && i + consumed < bytes.length; consumed++) {
      const next = bytes[i + consumed];
      if ((next & 0xc0) !== 0x80) break;
      if (consumed === 0 && (first === 0xe0 && next < 0xa0 || first === 0xed && next > 0x9f || first === 0xf0 && next < 0x90 || first === 0xf4 && next > 0x8f)) break;
      n = n << 6 | next & 63;
    }
    i += consumed;
    points.push(consumed === count ? String.fromCodePoint(n) : '\ufffd');
  }
  return points.join('').replace(/^\uFEFF/, '');
}
function normalizeType(type) { const value = String(type || ''); return /[^\x20-\x7e]/.test(value) ? '' : value.toLowerCase(); }
function normalizeIndex(value, size, fallback) {
  if (value === undefined) return fallback;
  const n = Number(value);
  const integer = Number.isNaN(n) ? 0 : Math.trunc(n);
  return integer < 0 ? Math.max(size + integer, 0) : Math.min(integer, size);
}

/** Immutable Blob fallback. Real bytes, UTF-8 strings and ArrayBuffer view boundaries are retained. */
export class MiniBlob {
  constructor(parts = [], options = {}) {
    if (parts === null || typeof parts !== 'object' || typeof parts[Symbol.iterator] !== 'function') throw new TypeError('Blob parts must be an iterable object');
    const endings = options.endings ?? 'transparent';
    if (!['transparent', 'native'].includes(endings)) throw new TypeError('Invalid Blob endings option');
    const buffers = [];
    let size = 0;
    for (const part of parts) {
      let bytes;
      if (blobBytes.has(part)) bytes = blobBytes.get(part);
      else if (part instanceof ArrayBuffer || Object.prototype.toString.call(part) === '[object ArrayBuffer]') bytes = new Uint8Array(part);
      else if (ArrayBuffer.isView(part)) bytes = new Uint8Array(part.buffer, part.byteOffset, part.byteLength);
      else if (Object.prototype.toString.call(part) === '[object Blob]') throw new TypeError('Use the native Blob constructor to concatenate native Blob parts');
      else bytes = encodeUTF8(endings === 'native' ? String(part).replace(/\r\n|\r/g, '\n') : part);
      buffers.push(bytes); size += bytes.byteLength;
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const buffer of buffers) { bytes.set(buffer, offset); offset += buffer.byteLength; }
    blobBytes.set(this, bytes);
    Object.defineProperty(this, '_type', {value: normalizeType(options.type)});
  }
  get size() { return blobBytes.get(this).byteLength; }
  get type() { return this._type; }
  get [Symbol.toStringTag]() { return 'Blob'; }
  slice(start, end, contentType = '') {
    const bytes = blobBytes.get(this), from = normalizeIndex(start, bytes.length, 0), to = normalizeIndex(end, bytes.length, bytes.length);
    return new MiniBlob([bytes.subarray(from, Math.max(from, to))], {type: contentType});
  }
  async arrayBuffer() { return blobBytes.get(this).slice().buffer; }
  async bytes() { return blobBytes.get(this).slice(); }
  async text() { return decodeUTF8(blobBytes.get(this)); }
  stream() {
    if (typeof ReadableStream !== 'function') throw new Error('ReadableStream is unavailable in this host');
    const bytes = blobBytes.get(this).slice();
    return new ReadableStream({start(controller) { controller.enqueue(bytes); controller.close(); }});
  }
}

function fileExtension(type, bytes) {
  const known = {'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/svg+xml': 'svg', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/ogg': 'ogg', 'audio/webm': 'webm'};
  if (known[type]) return known[type];
  if (bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71) return 'png';
  if (bytes[0] === 255 && bytes[1] === 216) return 'jpg';
  if (bytes[0] === 71 && bytes[1] === 73 && bytes[2] === 70) return 'gif';
  if (String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP') return 'webp';
  return 'bin';
}

/**
 * Supplies true binary APIs and URL constructors without editing globals.
 * Object URLs point to retained Blob values. Image resolution writes their bytes to native storage.
 */
export function createBinaryCompatibility({api, host = globalThis} = {}) {
  const BlobClass = typeof host.Blob === 'function' ? host.Blob : MiniBlob;
  const BaseURL = typeof host.URL === 'function' ? host.URL : PureURL;
  const SearchParams = typeof host.URLSearchParams === 'function' ? host.URLSearchParams : PureURLSearchParams;
  const entries = new Map(), materialized = new Set(), cleanupTasks = new Set(), pendingMaterializations = new Set();
  const session = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  let nextId = 0, disposed = false;
  const fs = () => {
    if (typeof api?.getFileSystemManager !== 'function') throw new Error('Object URL image loading requires the native file system');
    return api.getFileSystemManager();
  };
  const unlink = filePath => {
    const promise = new Promise((resolve, reject) => {
      const filesystem = fs();
      if (typeof filesystem.unlink !== 'function') { reject(new Error('Native file system unlink is unavailable')); return; }
      filesystem.unlink({filePath, success: () => resolve(), fail: reject});
    });
    cleanupTasks.add(promise);
    // Track cleanup until dispose; avoid unhandled rejections from the synchronous revoke API.
    promise.catch(() => {});
    return promise;
  };
  class AdapterURL extends BaseURL {
    static createObjectURL(blob) {
      if (disposed) throw new Error('Binary compatibility has been disposed');
      if (!(blob instanceof BlobClass) && !(blob instanceof MiniBlob)) throw new TypeError('createObjectURL requires a Blob');
      const id = ++nextId, url = `blob:c3-minigame/${session}/${id}`;
      entries.set(url, {blob, id, pending: null, filePath: null, revoked: false});
      return url;
    }
    static revokeObjectURL(value) {
      const url = String(value), entry = entries.get(url);
      if (!entry) return;
      entries.delete(url); entry.revoked = true;
      if (entry.filePath) { materialized.delete(entry.filePath); unlink(entry.filePath); }
    }
  }
  async function resolveImageSource(source) {
    const value = String(source);
    if (!value.startsWith('blob:')) return value;
    if (disposed) throw new Error('Binary compatibility has been disposed');
    const entry = entries.get(value);
    if (!entry) throw new Error(`Object URL is unknown or revoked: ${value}`);
    if (!entry.pending) {
      entry.pending = (async () => {
      const root = api?.env?.USER_DATA_PATH;
      if (typeof root !== 'string' || !root) throw new Error('Object URL image loading requires platform env.USER_DATA_PATH');
      const bytes = new Uint8Array(await entry.blob.arrayBuffer());
      const filePath = `${root.replace(/\/$/, '')}/c3-adapter-blob-${session}-${entry.id}.${fileExtension(entry.blob.type, bytes)}`;
      await new Promise((resolve, reject) => {
        const filesystem = fs();
        if (typeof filesystem.writeFile !== 'function') { reject(new Error('Native file system writeFile is unavailable')); return; }
        filesystem.writeFile({filePath, data: bytes.buffer, success: () => resolve(), fail: reject});
      });
      entry.filePath = filePath;
      materialized.add(filePath);
      if (disposed || entry.revoked) { materialized.delete(filePath); await unlink(filePath); throw new Error('Object URL was revoked before its image could load'); }
      return filePath;
      })();
      pendingMaterializations.add(entry.pending);
      entry.pending.then(() => pendingMaterializations.delete(entry.pending), () => pendingMaterializations.delete(entry.pending));
    }
    return entry.pending;
  }
  async function dispose() {
    if (disposed) return;
    disposed = true;
    const pending = [...pendingMaterializations];
    entries.clear();
    await Promise.allSettled(pending);
    for (const filePath of materialized) unlink(filePath);
    materialized.clear();
    const cleanup = await Promise.allSettled(cleanupTasks);
    cleanupTasks.clear();
    const failures = cleanup.filter(result => result.status === 'rejected');
    if (failures.length) throw new Error(`Unable to remove ${failures.length} temporary object URL file(s)`);
  }
  return {Blob: BlobClass, atob: binaryAtob, btoa: binaryBtoa, URL: AdapterURL, URLSearchParams: SearchParams, resolveImageSource, dispose};
}
