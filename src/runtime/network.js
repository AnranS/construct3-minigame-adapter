import {MiniEvent, MiniEventTarget, platformError, requireMethod} from './events.js';
import {binaryAtob} from './binary.js';

export function resolveAssetPath(input, assetRoot = 'game') {
  const value = String(input).replace(/^https:\/\/c3-minigame\.invalid\//i, '');
  if (/^https?:\/\//i.test(value) || /^(?:ttfile|wxfile):\/\//i.test(value)) return value;
  if (/^[a-z][a-z\d+.-]*:/i.test(value) || value.startsWith('//')) throw new Error(`Unsupported asset URL: ${value}`);
  const root = String(assetRoot).replace(/^\/+|\/+$/g, '');
  if (!root || /(^|\/)\.\.?($|\/)/.test(root) || /[?#\\]/.test(root)) throw new Error('assetRoot must be a package-relative directory');
  const path = decodeURIComponent(value.split(/[?#]/, 1)[0]).replace(/^\/+/, '');
  if (path.includes('\\') || path.includes('\0')) throw new Error('Invalid local asset path');
  const relative = path === root ? '' : path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path;
  const segments = [];
  for (const part of relative.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (!segments.length) throw new Error(`Asset path escapes assetRoot: ${value}`);
      segments.pop();
    } else segments.push(part);
  }
  return [root, ...segments].join('/');
}

export class MiniHeaders {
  constructor(initial = {}) {
    this._headers = new Map();
    if (typeof initial?.forEach === 'function' && !Array.isArray(initial)) initial.forEach((v, k) => this.set(k, v));
    else for (const [key, value] of Array.isArray(initial) ? initial : Object.entries(initial)) this.set(key, value);
  }
  set(name, value) { this._headers.set(String(name).toLowerCase(), String(value)); }
  append(name, value) { this.set(name, this.has(name) ? `${this.get(name)}, ${value}` : value); }
  get(name) { return this._headers.get(String(name).toLowerCase()) ?? null; }
  has(name) { return this._headers.has(String(name).toLowerCase()); }
  delete(name) { this._headers.delete(String(name).toLowerCase()); }
  forEach(callback, thisArg) { this._headers.forEach((v, k) => callback.call(thisArg, v, k, this)); }
  entries() { return this._headers.entries(); }
  keys() { return this._headers.keys(); }
  values() { return this._headers.values(); }
  [Symbol.iterator]() { return this.entries(); }
}

// Keep UTF-8 support independent of TextEncoder/TextDecoder availability in game VMs.
function encode(text) {
  const bytes = [];
  for (const character of String(text)) {
    let n = character.codePointAt(0);
    if (n >= 0xd800 && n <= 0xdfff) n = 0xfffd;
    if (n < 0x80) bytes.push(n);
    else if (n < 0x800) bytes.push(0xc0 | n >> 6, 0x80 | n & 63);
    else if (n < 0x10000) bytes.push(0xe0 | n >> 12, 0x80 | n >> 6 & 63, 0x80 | n & 63);
    else bytes.push(0xf0 | n >> 18, 0x80 | n >> 12 & 63, 0x80 | n >> 6 & 63, 0x80 | n & 63);
  }
  return new Uint8Array(bytes);
}
function decode(bytes) {
  const parts = [];
  for (let i = 0; i < bytes.length;) {
    const first = bytes[i++];
    if (first < 128) { parts.push(String.fromCharCode(first)); continue; }
    const count = first >= 0xc2 && first <= 0xdf ? 1 : first >= 0xe0 && first <= 0xef ? 2 : first >= 0xf0 && first <= 0xf4 ? 3 : 0;
    if (!count) { parts.push('\ufffd'); continue; }
    let n = first & (count === 1 ? 31 : count === 2 ? 15 : 7);
    let consumed = 0;
    for (; consumed < count && i + consumed < bytes.length; consumed++) {
      const next = bytes[i + consumed];
      if ((next & 0xc0) !== 0x80) break;
      if (consumed === 0 && (first === 0xe0 && next < 0xa0 || first === 0xed && next > 0x9f || first === 0xf0 && next < 0x90 || first === 0xf4 && next > 0x8f)) break;
      n = n << 6 | next & 63;
    }
    i += consumed;
    parts.push(consumed === count ? String.fromCodePoint(n) : '\ufffd');
  }
  return parts.join('').replace(/^\uFEFF/, '');
}

function parseDataURL(input) {
  // URL parsing removes ASCII tabs/newlines; an unescaped fragment is not part of the data.
  const url = String(input).replace(/[\t\r\n]/g, '').split('#', 1)[0];
  const comma = url.indexOf(',');
  if (comma < 0) throw new TypeError('Invalid data URL: missing comma separator');
  let mediaType = url.slice(5, comma).trim();
  const base64 = /;base64$/i.test(mediaType);
  if (base64) mediaType = mediaType.slice(0, -7).trim();
  if (mediaType.startsWith(';')) mediaType = 'text/plain' + mediaType;
  if (!/^[!#$%&'*+.^_`|~A-Za-z0-9-]+\/[!#$%&'*+.^_`|~A-Za-z0-9-]+(?:\s*;.*)?$/.test(mediaType)) mediaType = 'text/plain;charset=US-ASCII';
  const content = url.slice(comma + 1);
  const bytes = [];
  // Percent-decode bytes, not Unicode code points: e.g. %FF is a valid binary byte.
  for (let index = 0; index < content.length;) {
    if (content[index] === '%' && /^[0-9a-f]{2}$/i.test(content.slice(index + 1, index + 3))) {
      bytes.push(parseInt(content.slice(index + 1, index + 3), 16)); index += 3;
    } else {
      const point = content.codePointAt(index);
      for (const byte of encode(String.fromCodePoint(point))) bytes.push(byte);
      index += point > 0xffff ? 2 : 1;
    }
  }
  let data = new Uint8Array(bytes);
  if (base64) {
    const chunks = [];
    for (let offset = 0; offset < data.length; offset += 8192) chunks.push(String.fromCharCode(...data.subarray(offset, offset + 8192)));
    const decoded = binaryAtob(chunks.join(''));
    data = Uint8Array.from(decoded, character => character.charCodeAt(0));
  }
  return {data, mediaType, url};
}

function bytesOf(data) {
  if (data instanceof ArrayBuffer || Object.prototype.toString.call(data) === '[object ArrayBuffer]') return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  if (typeof data === 'string') return encode(data);
  throw new TypeError('Expected string or binary platform response');
}
export class MiniResponse {
  constructor(data, {status = 200, statusText = '', headers = {}, url = '', host = globalThis} = {}) {
    this._bytes = bytesOf(data);
    this.status = status; this.statusText = statusText;
    this.ok = status >= 200 && status < 300;
    this.headers = new MiniHeaders(headers);
    this.url = url; this.bodyUsed = false; this._host = host;
    this.body = null; // Streaming bodies are not implemented.
  }
  async _consume() {
    if (this.bodyUsed) throw new TypeError('Response body has already been consumed');
    this.bodyUsed = true;
    return this._bytes;
  }
  async arrayBuffer() { const b = await this._consume(); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); }
  async text() { return decode(await this._consume()); }
  async json() { return JSON.parse(await this.text()); }
  async blob() {
    if (typeof this._host.Blob !== 'function') throw new Error('Blob is unavailable; use response.arrayBuffer()');
    return new this._host.Blob([await this.arrayBuffer()], {type: this.headers.get('content-type') || ''});
  }
  clone() {
    if (this.bodyUsed) throw new TypeError('Cannot clone a consumed response');
    return new MiniResponse(this._bytes.slice(), {status: this.status, statusText: this.statusText, headers: this.headers, url: this.url, host: this._host});
  }
}
function abortError() { const error = new Error('Request aborted'); error.name = 'AbortError'; return error; }
export function createNetwork({api, assetRoot, host = globalThis}) {
  let disposed = false;
  const pendingRequests = new Set();
  const activeXHRs = new Set();
  const request = (input, options = {}) => {
    let task, settled = false, cancelled = false, nativeAbortCalled = false, cancellation;
    let signalCleanup = () => {};
    let resolvePending, rejectPending;
    const promise = new Promise((resolve, reject) => { resolvePending = resolve; rejectPending = reject; });
    const cleanup = () => { signalCleanup(); signalCleanup = () => {}; pendingRequests.delete(operation); };
    const done = result => { if (!settled) { settled = true; cleanup(); resolvePending(result); } };
    const fail = error => { if (!settled) { settled = true; cleanup(); rejectPending(platformError('fetch', error)); } };
    const abortNative = () => {
      if (!task || nativeAbortCalled) return;
      nativeAbortCalled = true;
      try { task.abort?.(); }
      catch (error) {
        // Aborting still rejects reliably even if the native task's abort throws.
        try { if (cancellation instanceof Error && cancellation.cause === undefined) cancellation.cause = error; } catch { /* A caller's abort reason may be frozen. */ }
      }
    };
    const operation = {promise, abort(reason = abortError()) {
      if (settled) return;
      cancelled = true; settled = true; cancellation = reason;
      cleanup(); rejectPending(reason); abortNative();
    }};
    pendingRequests.add(operation);
    try {
      if (disposed) throw new Error('Network adapter is disposed');
      if (options.credentials && options.credentials !== 'omit') throw new Error('Automatic fetch credential/cookie management is not supported');
      if (options.signal?.aborted) { operation.abort(options.signal.reason ?? abortError()); return operation; }
      const inputURL = String(typeof input === 'string' ? input : input?.url ?? input);
      const isDataURL = /^data:/i.test(inputURL);
      const url = isDataURL ? inputURL : resolveAssetPath(inputURL, assetRoot);
      const method = String(options.method || 'GET').toUpperCase();
      if (options.signal) {
        const listener = () => operation.abort(options.signal.reason ?? abortError());
        options.signal.addEventListener('abort', listener, {once: true});
        signalCleanup = () => options.signal.removeEventListener('abort', listener);
        if (options.signal.aborted) { listener(); return operation; }
      }
      if (isDataURL) {
        if (method !== 'GET' && method !== 'HEAD') throw new Error('Data URLs support read-only GET and HEAD requests');
        const resource = parseDataURL(url);
        done(new MiniResponse(method === 'HEAD' ? '' : resource.data, {url: resource.url, headers: {'content-type': resource.mediaType}, host}));
      } else if (/^https?:\/\//i.test(url)) {
        task = requireMethod(api, 'request')({
          url, method, header: Object.fromEntries(new MiniHeaders(options.headers)), data: options.body,
          dataType: 'string', responseType: 'arraybuffer', ...(options.timeout ? {timeout: options.timeout} : {}),
          success: result => {
            if (settled) return;
            try {
              if (!Number.isInteger(result?.statusCode) || result.statusCode < 200 || result.statusCode > 599) throw new TypeError('Platform request returned an invalid HTTP statusCode');
              const empty = method === 'HEAD' || [204, 205, 304].includes(result.statusCode);
              done(new MiniResponse(empty ? '' : result.data, {status: result.statusCode, headers: result.header, url, host}));
            } catch (error) { fail(error); }
          }, fail
        });
        // A signal can abort synchronously while the native task is being created.
        if (cancelled) abortNative();
      } else {
        if (method !== 'GET' && method !== 'HEAD') throw new Error('Local assets support GET and HEAD only');
        const fs = requireMethod(api, 'getFileSystemManager')();
        requireMethod(fs, 'readFile')({filePath: url,
          success: result => {
            if (settled) return;
            try { done(new MiniResponse(method === 'HEAD' ? '' : result.data, {url, host})); }
            catch (error) { fail(error); }
          }, fail
        });
      }
    } catch (error) { fail(error); }
    return operation;
  };
  class XMLHttpRequest extends MiniEventTarget {
    constructor() {
      super(); this.readyState = 0; this.responseType = ''; this.timeout = 0;
      this.withCredentials = false; this._headers = new MiniHeaders();
      this._sent = false; this._request = null; this._generation = 0; this._timer = null;
      this._resetResponse();
    }
    _resetResponse() {
      this.status = 0; this.statusText = ''; this.responseURL = '';
      this.response = null; this.responseText = ''; this.lastError = null;
      this._responseHeaders = new MiniHeaders();
    }
    _state(value) { this.readyState = value; this.dispatchEvent(new MiniEvent('readystatechange')); }
    _clearTimer() {
      if (this._timer !== null) (host.clearTimeout || clearTimeout)(this._timer);
      this._timer = null;
    }
    _active(generation) { return this._generation === generation && this._sent; }
    _finish(generation, type, error) {
      if (!this._active(generation)) return;
      this._clearTimer(); this._sent = false; this._request = null; activeXHRs.delete(this);
      if (error) { this._resetResponse(); this.lastError = error; }
      // Finish internal state before firing DONE: a listener can open/send another request.
      this._state(4);
      this.dispatchEvent(new MiniEvent(type));
      this.dispatchEvent(new MiniEvent('loadend'));
    }
    open(method, url, async = true) {
      if (!async) throw new Error('Synchronous XMLHttpRequest is not supported');
      ++this._generation;
      const previous = this._request;
      this._clearTimer(); this._sent = false; this._request = null; activeXHRs.delete(this);
      previous?.abort(); // open replaces an active request without emitting abort events.
      this._method = method; this._url = url; this._headers = new MiniHeaders();
      this._resetResponse(); this._state(1);
    }
    setRequestHeader(name, value) {
      if (this.readyState !== 1 || this._sent) throw new Error('XMLHttpRequest is not open');
      this._headers.append(name, value);
    }
    getResponseHeader(name) { return this.readyState >= 2 ? this._responseHeaders.get(name) : null; }
    getAllResponseHeaders() { return this.readyState >= 2 ? [...this._responseHeaders].map(([k, v]) => `${k}: ${v}\r\n`).join('') : ''; }
    send(body) {
      if (disposed) throw new Error('Network adapter is disposed');
      if (this.readyState !== 1 || this._sent) throw new Error('XMLHttpRequest is not open');
      if (!['', 'text', 'arraybuffer', 'json', 'blob'].includes(this.responseType)) throw new Error(`Unsupported XMLHttpRequest responseType: ${this.responseType}`);
      if (this.withCredentials) throw new Error('Automatic credential/cookie management is not supported');
      this._sent = true;
      activeXHRs.add(this);
      const generation = ++this._generation;
      this.dispatchEvent(new MiniEvent('loadstart'));
      if (!this._active(generation)) return;
      const operation = request(this._url, {method: this._method, headers: this._headers, body});
      if (!this._active(generation)) { operation.abort(); operation.promise.catch(() => {}); return; }
      this._request = operation;
      if (this.timeout > 0) this._timer = (host.setTimeout || setTimeout)(() => {
        if (!this._active(generation)) return;
        operation.abort();
        const error = new Error('XMLHttpRequest timed out'); error.name = 'TimeoutError';
        this._finish(generation, 'timeout', error);
      }, this.timeout);
      operation.promise.then(async response => {
        if (!this._active(generation)) return;
        this.status = response.status; this.statusText = response.statusText;
        this.responseURL = response.url; this._responseHeaders = response.headers;
        this._state(2);
        if (!this._active(generation) || this.readyState !== 2) return;
        this._state(3);
        if (!this._active(generation) || this.readyState !== 3) return;
        let result, text = '';
        if (this.responseType === 'arraybuffer') result = await response.arrayBuffer();
        else if (this.responseType === 'blob') result = await response.blob();
        else {
          const value = await response.text();
          if (this.responseType === 'json') { try { result = JSON.parse(value); } catch { result = null; } }
          else result = text = value;
        }
        if (!this._active(generation)) return;
        this.response = result; this.responseText = text;
        this._finish(generation, 'load');
      }).catch(error => this._finish(generation, error.name === 'AbortError' ? 'abort' : 'error', error));
    }
    abort() {
      const pending = this._sent, previous = this._request;
      const generation = ++this._generation;
      this._clearTimer(); this._sent = false; this._request = null; activeXHRs.delete(this);
      previous?.abort(); this._resetResponse();
      if (pending) {
        this._state(4);
        this.dispatchEvent(new MiniEvent('abort'));
        this.dispatchEvent(new MiniEvent('loadend'));
      }
      // Do not overwrite a new request opened by an abort/readystatechange listener.
      if (this._generation === generation && this.readyState === 4) this.readyState = 0;
    }
    overrideMimeType() { throw new Error('XMLHttpRequest.overrideMimeType is not supported'); }
  }
  for (const [name, value] of Object.entries({UNSENT: 0, OPENED: 1, HEADERS_RECEIVED: 2, LOADING: 3, DONE: 4})) {
    XMLHttpRequest[name] = value; XMLHttpRequest.prototype[name] = value;
  }
  return {fetch: (input, options) => request(input, options).promise, XMLHttpRequest, dispose() {
    disposed = true;
    for (const xhr of [...activeXHRs]) xhr.abort();
    for (const operation of pendingRequests) operation.abort();
    pendingRequests.clear();
  }};
}
