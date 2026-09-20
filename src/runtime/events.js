/** A small EventTarget implementation; event bubbling is explicitly dispatched by the adapter. */
export class MiniEvent {
  constructor(type, init = {}) {
    Object.assign(this, init);
    this.type = String(type);
    this.defaultPrevented = false;
    this.cancelable = init.cancelable ?? false;
    this.bubbles = init.bubbles ?? false;
    this.timeStamp = init.timeStamp ?? Date.now();
    this._stopped = false;
    this._immediateStopped = false;
  }
  preventDefault() { if (this.cancelable) this.defaultPrevented = true; }
  stopPropagation() { this._stopped = true; }
  stopImmediatePropagation() { this._stopped = this._immediateStopped = true; }
}

export class MiniEventTarget {
  constructor() { this._listeners = new Map(); }
  addEventListener(type, callback, options = {}) {
    if (!callback) return;
    type = String(type);
    const capture = typeof options === 'boolean' ? options : !!options?.capture;
    const items = this._listeners.get(type) || [];
    if (!items.some(item => item.callback === callback && item.capture === capture)) items.push({callback, capture, once: !!options?.once});
    this._listeners.set(type, items);
  }
  removeEventListener(type, callback, options = {}) {
    type = String(type);
    const capture = typeof options === 'boolean' ? options : !!options?.capture;
    const items = this._listeners.get(type);
    if (items) this._listeners.set(type, items.filter(item => item.callback !== callback || item.capture !== capture));
  }
  dispatchEvent(event) {
    if (!event?.type) throw new TypeError('Event requires a type');
    event.target ??= this;
    event.currentTarget = this;
    for (const item of [...(this._listeners.get(event.type) || [])].sort((a, b) => Number(b.capture) - Number(a.capture))) {
      // Removing a listener during dispatch must also remove it from this dispatch.
      if (event._immediateStopped) break;
      if (!this._listeners.get(event.type)?.includes(item)) continue;
      if (event._dispatchPhase === 'capture' && !item.capture || event._dispatchPhase === 'bubble' && item.capture) continue;
      if (item.once) this.removeEventListener(event.type, item.callback, item.capture);
      try {
        if (typeof item.callback === 'function') item.callback.call(this, event);
        else item.callback.handleEvent(event);
      } catch (error) { reportListenerError(error); }
      if (event._immediateStopped) break;
    }
    if (event._dispatchPhase !== 'capture' && !event._immediateStopped && typeof this[`on${event.type}`] === 'function') {
      try { this[`on${event.type}`](event); } catch (error) { reportListenerError(error); }
    }
    return !event.defaultPrevented;
  }
  _clearListeners() { this._listeners.clear(); }
}

// Event handler exceptions are reported, not thrown into the native API callback
// or the Promise chain delivering the event (which would turn a load into error).
function reportListenerError(error) {
  try {
    if (typeof globalThis.reportError === 'function') globalThis.reportError(error);
    else globalThis.console?.error?.('Uncaught event listener error', error);
  } catch { /* Reporting must not interrupt the remaining event listeners. */ }
}

export function attachEvents(object) {
  const target = object;
  Object.defineProperty(object, '_listeners', {value: new Map(), configurable: true});
  for (const key of ['addEventListener', 'removeEventListener', 'dispatchEvent']) {
    Object.defineProperty(object, key, {value: MiniEventTarget.prototype[key].bind(target), configurable: true});
  }
  return target;
}

export function platformError(operation, cause) {
  if (cause instanceof Error) return cause;
  const error = new Error(`${operation}: ${cause?.errMsg || cause?.message || (typeof cause === 'string' && cause) || 'platform API failed'}`, {cause});
  const code = cause?.errNo ?? cause?.errCode ?? cause?.code;
  if (code !== undefined) error.code = code;
  return error;
}

export function requireMethod(api, name) {
  if (typeof api?.[name] !== 'function') throw new Error(`Platform API ${name} is unavailable in this environment`);
  return api[name].bind(api);
}
