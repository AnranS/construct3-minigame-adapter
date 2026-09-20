import {MiniEvent, MiniEventTarget} from './events.js';
import {registryGet, resolveModulePath} from './module-loader.js';

const defer = globalThis.queueMicrotask?.bind(globalThis) || (callback => Promise.resolve().then(callback));
const PORT = Symbol('C3MinigameMessagePort');

/** A bounded clone implementation. Ports retain their endpoint; transfer does not detach buffers. */
function cloneMessage(value, seen = new Map()) {
  if (typeof value === 'function' || typeof value === 'symbol') throw new TypeError('Message data cannot contain functions or symbols');
  if (value === null || typeof value !== 'object') return value;
  if (value[PORT]) return value;
  if (seen.has(value)) return seen.get(value);
  let result;
  if (value instanceof ArrayBuffer) result = value.slice(0);
  else if (typeof SharedArrayBuffer !== 'undefined' && value instanceof SharedArrayBuffer) return value;
  else if (ArrayBuffer.isView(value)) {
    const buffer = cloneMessage(value.buffer, seen);
    result = value instanceof DataView ? new DataView(buffer, value.byteOffset, value.byteLength) : new value.constructor(buffer, value.byteOffset, value.length);
  } else if (value instanceof Date) result = new Date(value.getTime());
  else if (value instanceof RegExp) result = new RegExp(value.source, value.flags);
  else if (value instanceof Error) { result = new Error(value.message); result.name = value.name; result.stack = value.stack; }
  else if (value instanceof Map) {
    result = new Map(); seen.set(value, result);
    for (const [key, item] of value) result.set(cloneMessage(key, seen), cloneMessage(item, seen));
  } else if (value instanceof Set) {
    result = new Set(); seen.set(value, result);
    for (const item of value) result.add(cloneMessage(item, seen));
  } else if (typeof Blob !== 'undefined' && value instanceof Blob) result = value.slice();
  else if (Array.isArray(value) || Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null) {
    result = Array.isArray(value) ? [] : {};
    seen.set(value, result);
    for (const key of Object.keys(value)) result[key] = cloneMessage(value[key], seen);
  } else {
    throw new TypeError(`Unsupported message data: ${value.constructor?.name || 'object'}`);
  }
  seen.set(value, result);
  return result;
}

export function createMessageChannelClass() {
  class MessagePort extends MiniEventTarget {
    constructor() { super(); this[PORT] = true; this._peer = null; this._closed = false; this._started = false; this._pending = []; this._onmessage = null; }
    get onmessage() { return this._onmessage; }
    set onmessage(callback) { this._onmessage = callback; if (typeof callback === 'function') this.start(); }
    postMessage(data, transfer = []) {
      if (this._closed || !this._peer || this._peer._closed) return;
      const copy = cloneMessage(data);
      const ports = (Array.isArray(transfer) ? transfer : transfer?.transfer || []).filter(item => item?.[PORT]);
      const target = this._peer;
      defer(() => {
        if (this._closed || target._closed) return;
        target._pending.push(new MiniEvent('message', {data: copy, ports}));
        target._flush();
      });
    }
    _flush() {
      if (!this._started || this._closed) return;
      const events = this._pending.splice(0);
      for (const event of events) { if (!this._closed) this.dispatchEvent(event); }
    }
    start() { if (this._started || this._closed) return; this._started = true; defer(() => this._flush()); }
    close() { this._closed = true; this._pending.length = 0; this._onmessage = null; this._clearListeners(); }
  }
  class MessageChannel {
    constructor() { this.port1 = new MessagePort(); this.port2 = new MessagePort(); this.port1._peer = this.port2; this.port2._peer = this.port1; }
  }
  MessageChannel.MessagePort = MessagePort;
  return MessageChannel;
}

/**
 * Precompiled, asynchronous worker compatibility for Construct's job scheduler.
 * Runs on the MAIN THREAD: no parallelism, isolation, transferable detachment, or dynamic source.
 */
export function createWorkerCompatibility(registry, {baseURL = 'https://c3-minigame.invalid/game/', globals = {}, onError} = {}) {
  const MessageChannel = createMessageChannelClass();
  const MessagePort = MessageChannel.MessagePort;
  class Worker extends MiniEventTarget {
    constructor(specifier, options = {}) {
      super();
      this._key = resolveModulePath(specifier, '', baseURL);
      const factory = registryGet(registry, this._key);
      if (typeof factory !== 'function') throw new Error(`Worker script was not bundled: ${this._key}`);
      if (options.type && !['classic', 'module'].includes(options.type)) throw new Error(`Unsupported worker type: ${options.type}`);
      this._terminated = false;
      this._timers = new Set();
      this._ports = new Set();
      this._scope = new MiniEventTarget();
      const defaults = {};
      for (const name of ['console', 'performance', 'atob', 'btoa', 'TextEncoder', 'TextDecoder', 'URL', 'URLSearchParams', 'Blob', 'fetch', 'crypto', 'WebAssembly', 'navigator']) {
        if (name in globalThis) defaults[name] = globalThis[name];
      }
      const workerEvents = Object.fromEntries(['addEventListener', 'removeEventListener', 'dispatchEvent'].map(name => [name, this._scope[name].bind(this._scope)]));
      Object.assign(this._scope, defaults, globals, workerEvents, {
        name: options.name || '', MessageChannel, MessagePort,
        location: {href: `${baseURL}${this._key}`},
        postMessage: (data, transfer) => this._send(this, data, transfer),
        close: () => this.terminate(),
        importScripts: (...scripts) => {
          for (const script of scripts) {
            const key = resolveModulePath(script, this._key, baseURL);
            const dependency = registryGet(registry, key);
            if (typeof dependency !== 'function') throw new Error(`Worker dependency was not bundled: ${key}`);
            const result = dependency(this._scope);
            if (result?.then) throw new Error(`importScripts dependency must be synchronous: ${key}`);
          }
        },
        queueMicrotask: callback => defer(() => { if (!this._terminated) { try { callback(); } catch (error) { this._error(error); } } }),
        setTimeout: (callback, delay, ...args) => {
          const timer = setTimeout(() => {
            this._timers.delete(timer);
            if (!this._terminated) { try { callback(...args); } catch (error) { this._error(error); } }
          }, delay);
          this._timers.add(timer); return timer;
        },
        clearTimeout: timer => { clearTimeout(timer); this._timers.delete(timer); }
      });
      this._scope.self = this._scope;
      this._scope.globalThis = this._scope;
      defer(() => {
        if (this._terminated) return;
        try { Promise.resolve(factory(this._scope)).catch(error => this._error(error)); }
        catch (error) { this._error(error); }
      });
    }
    _error(error) {
      if (this._terminated) return;
      const event = new MiniEvent('error', {error, message: error?.message || String(error), filename: this._key, cancelable: true});
      const hasHandler = typeof this.onerror === 'function' || (this._listeners.get('error')?.length > 0);
      this.dispatchEvent(event);
      if (!hasHandler && !event.defaultPrevented) { if (onError) onError(error); else this._scope.console?.error?.('[C3 MiniGame worker]', error); }
    }
    _send(target, data, transfer = []) {
      if (this._terminated) return;
      const copy = cloneMessage(data);
      const ports = (Array.isArray(transfer) ? transfer : transfer?.transfer || []).filter(item => item?.[PORT]);
      for (const port of ports) { if (target === this._scope) this._ports.add(port); else this._ports.delete(port); }
      defer(() => {
        if (this._terminated) return;
        try { target.dispatchEvent(new MiniEvent('message', {data: copy, ports})); }
        catch (error) { this._error(error); }
      });
    }
    postMessage(data, transfer) { this._send(this._scope, data, transfer); }
    terminate() {
      this._terminated = true;
      for (const timer of this._timers) clearTimeout(timer);
      this._timers.clear();
      for (const port of this._ports) port.close();
      this._ports.clear(); this._clearListeners(); this._scope._clearListeners(); this._scope.onmessage = null;
    }
  }
  return {Worker, MessageChannel, MessagePort};
}

export function createWorkerClass(registry, options) { return createWorkerCompatibility(registry, options).Worker; }
