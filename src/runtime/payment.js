// Native mini-game VMs need not expose browser AbortController. This local signal
// supports the listener contract used by the adapter's request cancellation.
function pollingController() {
  if (typeof AbortController === 'function') return new AbortController();
  let aborted = false, reason;
  const listeners = new Set();
  const signal = {
    get aborted() { return aborted; }, get reason() { return reason; }, onabort: null,
    addEventListener(name, listener) { if (name === 'abort') listeners.add(listener); },
    removeEventListener(name, listener) { if (name === 'abort') listeners.delete(listener); },
    throwIfAborted() { if (aborted) throw reason; }
  };
  return {signal, abort() {
    if (aborted) return;
    aborted = true; reason = new Error('Order polling ended'); reason.name = 'AbortError';
    const event = {type: 'abort', target: signal};
    for (const listener of [...listeners, signal.onabort]) {
      // Cancellation must finish even when application observers throw.
      try { if (typeof listener === 'function') listener.call(signal, event); else listener?.handleEvent?.(event); } catch {}
    }
    listeners.clear(); signal.onabort = null;
  }};
}

/** Poll an authenticated application backend, never the platform's secret APIs.
 * These statuses describe the application's order, not a TikTok/WeChat enum.
 * A verified payment is not fulfilled until the backend has granted the item.
 */
export function pollPaymentOrder({orderId, queryOrder, intervalMs = 1500, timeoutMs = 20000, signal} = {}) {
  return new Promise((resolve, reject) => {
    if (typeof orderId !== 'string' || !orderId.trim() || typeof queryOrder !== 'function') {
      reject(new TypeError('orderId and an authenticated queryOrder callback are required')); return;
    }
    if (![intervalMs, timeoutMs].every(value => Number.isFinite(value) && value > 0 && value <= 2147483647)) {
      reject(new TypeError('Polling durations must be positive finite milliseconds')); return;
    }
    if (signal && (typeof signal.addEventListener !== 'function' || typeof signal.removeEventListener !== 'function')) {
      reject(new TypeError('signal must be an AbortSignal')); return;
    }
    let done = false, interval, deadline;
    const controller = pollingController();
    const finish = (failure, value) => {
      if (done) return;
      done = true;
      clearTimeout(interval); clearTimeout(deadline);
      signal?.removeEventListener('abort', abort);
      controller.abort();
      if (failure) reject(failure); else resolve(value);
    };
    const abort = () => {
      const error = new Error('Order polling was aborted; the order may still settle on the backend');
      error.name = 'AbortError'; finish(error);
    };
    if (signal?.aborted) { abort(); return; }
    signal?.addEventListener('abort', abort, {once: true});
    if (signal?.aborted || done) { abort(); return; }
    // A stalled request also has a bounded wait; late results cannot grant items.
    deadline = setTimeout(() => finish(null, {orderId, status: 'pending', timedOut: true}), timeoutMs);
    const query = async () => {
      try {
        const result = await queryOrder(orderId, {signal: controller.signal});
        if (done) return;
        if (result?.orderId !== orderId || !['pending', 'fulfilled', 'failed', 'cancelled', 'refunded'].includes(result.status)) {
          throw new Error('Invalid backend order response: expected matching orderId and an application fulfillment status');
        }
        if (result.status !== 'pending') { finish(null, result); return; }
        interval = setTimeout(query, intervalMs);
      } catch (failure) { finish(failure); }
    };
    query();
  });
}
