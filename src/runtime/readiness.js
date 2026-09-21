/**
 * Observe Construct's real runtime-ready protocol without treating script loading as readiness.
 * This hook targets the RuntimeInterface method present in the validated export format.
 * Missing or immutable methods leave the promise pending; callers reject startup failures.
 */
export function createRuntimeReadiness() {
  let resolvePromise;
  let rejectPromise;
  let settled = false;
  let disposed = false;
  const hooks = new Map();
  const methodName = '_OnMessageFromRuntime';
  const promise = new Promise((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });

  function reject(reason) {
    if (settled) return;
    settled = true;
    rejectPromise(reason);
  }

  function observe(result, runtimeInterface, message) {
    // Keep the original return object, including a Promise, untouched. Awaiting its
    // completion only affects this independent readiness promise.
    Promise.resolve(result).then(() => {
      if (settled || disposed) return;
      settled = true;
      resolvePromise({runtimeInterface, message});
    }, reject);
  }

  function attach(RuntimeInterface) {
    if (disposed) return false;
    try {
      const prototype = RuntimeInterface?.prototype;
      if (!prototype || (typeof prototype !== 'object' && typeof prototype !== 'function')) return false;
      const ownDescriptor = Object.getOwnPropertyDescriptor(prototype, methodName);
      const existing = hooks.get(prototype);
      if (existing && ownDescriptor?.value === existing.wrapper) return true;

      let descriptor = ownDescriptor;
      let ancestor = prototype;
      while (!descriptor && (ancestor = Object.getPrototypeOf(ancestor))) {
        descriptor = Object.getOwnPropertyDescriptor(ancestor, methodName);
      }
      // Do not invoke or replace accessors to manufacture a hookable method.
      if (typeof descriptor?.value !== 'function') return false;
      const original = descriptor.value;
      function wrapper(...args) {
        let result;
        try { result = Reflect.apply(original, this, args); }
        catch (error) {
          // DOM attachment runs inside this message handler. A thrown attachment
          // error must reject readiness even when EventTarget only reports it.
          // Other message failures do not decide whether startup has completed.
          try { if (args[0]?.type === 'runtime-ready') reject(error); }
          catch { /* A hostile message accessor must not replace the original error. */ }
          throw error;
        }
        try {
          if (args[0]?.type === 'runtime-ready') observe(result, this, args[0]);
        } catch (error) {
          // Observation must never alter the engine method's result or exception behavior.
          reject(error);
        }
        return result;
      }
      Object.defineProperty(prototype, methodName, ownDescriptor
        ? {...ownDescriptor, value: wrapper}
        : {value: wrapper, configurable: true, writable: true, enumerable: false});
      hooks.set(prototype, {wrapper, ownDescriptor});
      return true;
    } catch {
      return false;
    }
  }

  function dispose() {
    disposed = true;
    for (const [prototype, {wrapper, ownDescriptor}] of hooks) {
      try {
        if (Object.getOwnPropertyDescriptor(prototype, methodName)?.value !== wrapper) continue;
        if (ownDescriptor) Object.defineProperty(prototype, methodName, ownDescriptor);
        else delete prototype[methodName];
      } catch {
        // A later owner may freeze the prototype. Avoid disrupting engine cleanup.
      }
    }
    hooks.clear();
  }

  return {promise, attach, reject, dispose};
}
