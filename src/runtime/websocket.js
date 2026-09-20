import {MiniEvent, MiniEventTarget, platformError, requireMethod} from './events.js';

const states = {CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3};
const fail = (name, message) => Object.assign(new Error(message), {name});
const bufferSize = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength').get;
function isBuffer(value) { try { bufferSize.call(value); return true; } catch { return false; } }
const copyBuffer = (value, start = 0, end) => ArrayBuffer.prototype.slice.call(value, start, end);

/** Browser WebSocket over an individual native SocketTask, never the global socket API. */
export function createWebSocketClass({api, URLClass = URL, BlobClass = Blob, instances = new Set()} = {}) {
  class WebSocket extends MiniEventTarget {
    constructor(url, protocols = []) {
      super();
      const parsed = new URLClass(String(url));
      if (!['ws:', 'wss:'].includes(parsed.protocol) || parsed.hash || parsed.username || parsed.password)
        throw fail('SyntaxError', 'WebSocket requires a ws/wss URL without credentials or fragment');
      const names = typeof protocols === 'string' ? [protocols] : Array.from(protocols);
      if (names.some(p => typeof p !== 'string' || !/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(p)) || new Set(names).size !== names.length)
        throw fail('SyntaxError', 'Invalid or duplicate WebSocket subprotocol');
      this._url = parsed.href;
      this._state = states.CONNECTING;
      this._buffered = 0;
      this._protocol = '';
      this._binaryType = 'blob';
      this._disposed = false;
      this._bindings = [];
      this._pending = new Set();
      this._sendQueue = Promise.resolve();
      this._receiveQueue = Promise.resolve();
      for (const name of ['open', 'message', 'error', 'close']) this['on' + name] = null;
      const emitError = cause => this._queue(() => this._error(cause));
      this._task = requireMethod(api, 'connectSocket')({url: this.url, protocols: names, fail: emitError});
      try {
        const bind = (name, listener) => {
          this._bindings.push(['off' + name, listener]);
          requireMethod(this._task, 'on' + name)(listener);
        };
        bind('Open', value => this._queue(() => {
          if (this._state !== states.CONNECTING) return;
          this._state = states.OPEN;
          const headers = value?.header || {};
          this._protocol = value?.protocol || Object.entries(headers).find(([key]) => key.toLowerCase() === 'sec-websocket-protocol')?.[1] || '';
          this.dispatchEvent(new MiniEvent('open'));
        }));
        bind('Message', value => this._queue(() => {
          if (this._state !== states.OPEN) return;
          let data = value.data;
          if (ArrayBuffer.isView(data)) data = copyBuffer(data.buffer, data.byteOffset, data.byteOffset + data.byteLength);
          if (isBuffer(data) && this.binaryType === 'blob') data = new BlobClass([copyBuffer(data)]);
          this.dispatchEvent(new MiniEvent('message', {data, origin: parsed.origin}));
        }));
        bind('Error', emitError);
        bind('Close', value => this._queue(() => this._closed(value?.code ?? 1006, value?.reason || '', value?.code === 1000)));
        requireMethod(this._task, 'send'); requireMethod(this._task, 'close');
        instances.add(this);
      } catch (error) {
        this._disposed = true;
        this._detach();
        try { this._task?.close?.({}); } catch { /* Preserve construction failure. */ }
        throw error;
      }
    }
    get url() { return this._url; }
    get readyState() { return this._state; }
    get bufferedAmount() { return this._buffered; }
    get protocol() { return this._protocol; }
    get extensions() { return ''; }
    get binaryType() { return this._binaryType; }
    set binaryType(value) { if (value === 'blob' || value === 'arraybuffer') this._binaryType = value; }
    _queue(callback) {
      this._receiveQueue = this._receiveQueue.then(() => { if (!this._disposed) callback(); });
    }
    _detach() {
      for (const [name, listener] of this._bindings.splice(0)) {
        try { this._task?.[name]?.(listener); } catch { /* Terminal callbacks are also guarded by state. */ }
      }
      instances.delete(this);
    }
    _closed(code, reason, wasClean) {
      if (this._state === states.CLOSED) return;
      this._state = states.CLOSED;
      for (const finish of [...this._pending]) finish();
      this._detach();
      this.dispatchEvent(new MiniEvent('close', {code, reason, wasClean}));
    }
    _error(cause) {
      if (this._state === states.CLOSED) return;
      const error = platformError('WebSocket', cause);
      this.dispatchEvent(new MiniEvent('error', {error, message: error.message}));
      // Hosts do not consistently emit onClose after connection failure.
      try { this._task?.close?.({}); } catch { /* The original error is reported above. */ }
      this._closed(1006, '', false);
    }
    send(value) {
      if (this._state === states.CONNECTING) throw fail('InvalidStateError', 'WebSocket is still connecting');
      let payload, bytes;
      if (typeof value === 'string') { payload = value; bytes = new BlobClass([value]).size; }
      else if (isBuffer(value)) { payload = copyBuffer(value); bytes = payload.byteLength; }
      else if (ArrayBuffer.isView(value)) { payload = copyBuffer(value.buffer, value.byteOffset, value.byteOffset + value.byteLength); bytes = payload.byteLength; }
      else if (value instanceof BlobClass) { payload = value; bytes = value.size; }
      else { payload = String(value); bytes = new BlobClass([payload]).size; }
      this._buffered += bytes;
      if (this._state !== states.OPEN) return;
      // Serial conversion prevents Blob.arrayBuffer() from reordering messages.
      this._sendQueue = this._sendQueue.then(async () => {
        if (this._state === states.CLOSED || this._disposed) { this._buffered -= bytes; return; }
        try {
          const data = payload instanceof BlobClass ? await payload.arrayBuffer() : payload;
          if (this._state === states.CLOSED || this._disposed) { this._buffered -= bytes; return; }
          await new Promise(resolve => {
            let finished = false;
            const finish = error => {
              if (finished) return;
              finished = true; this._pending.delete(finish); this._buffered -= bytes;
              if (error && !this._disposed) this._error(error);
              resolve();
            };
            this._pending.add(finish);
            try { this._task.send({data, success: () => finish(), fail: error => finish(error)}); }
            catch (error) { finish(error); }
          });
        } catch (error) { this._buffered -= bytes; if (!this._disposed) this._error(error); }
      });
    }
    close(code, reason = '') {
      if (code !== undefined && code !== 1000 && (!Number.isInteger(code) || code < 3000 || code > 4999))
        throw fail('InvalidAccessError', 'WebSocket close code must be 1000 or 3000–4999');
      reason = String(reason);
      if (new BlobClass([reason]).size > 123) throw fail('SyntaxError', 'WebSocket close reason exceeds 123 UTF-8 bytes');
      if (this._state >= states.CLOSING) return;
      const connecting = this._state === states.CONNECTING;
      this._state = states.CLOSING;
      const finish = () => {
        if (this._disposed || this._state === states.CLOSED) return;
        try { this._task.close({...(code === undefined ? {} : {code}), reason, fail: error => this._queue(() => this._error(error))}); }
        catch (error) { this._error(error); }
      };
      // close() must follow messages already accepted by send(), including Blob conversion.
      if (connecting) finish(); else this._sendQueue.then(finish);
    }
    dispose() {
      if (this._disposed) return;
      this._disposed = true;
      let error;
      try { if (this._state !== states.CLOSED) this._task.close({code: 1000, reason: 'adapter disposed'}); }
      catch (cause) { error = cause; }
      this._state = states.CLOSED;
      for (const finish of [...this._pending]) finish();
      this._detach(); this._clearListeners();
      for (const name of ['open', 'message', 'error', 'close']) this['on' + name] = null;
      if (error) throw error;
    }
  }
  for (const [name, value] of Object.entries(states)) {
    Object.defineProperty(WebSocket, name, {value, enumerable: true});
    Object.defineProperty(WebSocket.prototype, name, {value, enumerable: true});
  }
  return WebSocket;
}
