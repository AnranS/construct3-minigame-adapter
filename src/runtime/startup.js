/** Observe the real startup promises. Progress is never treated as runtime-ready. */
export function createStartupDiagnostics({host, readiness, platform, waitMs = 15000} = {}) {
  const pending = new Map(), history = [], restorers = [];
  const startedAt = Date.now();
  let state = 'starting', sequence = 0, stopped = false, timer, failure;
  const safeErrorText = value => String(value ?? '').replace(/https?:\/\/[^\s<>"')]+/gi, '[remote-url]');
  const snapshot = () => ({build: 'startup-diag-2', platform, state, elapsedMs: Date.now() - startedAt,
    pending: [...pending.values()], history: history.slice(), ...(failure ? {failure} : {})});
  const log = (level, message) => {
    try { host.console?.[level]?.(`[C3 MiniGame] ${message}`); } catch { /* Logging cannot break startup. */ }
  };
  const record = (stage, status) => {
    if (stopped) return;
    history.push({stage, status, elapsedMs: Date.now() - startedAt});
    if (history.length > 80) history.shift();
    log('info', `${status}: ${stage}`);
  };
  const stopWatching = () => {
    if (timer !== undefined) host.clearTimeout?.(timer);
    timer = undefined;
  };
  function fail(error, stage = 'startup') {
    if (stopped || state !== 'starting') return false;
    state = 'failed'; stopWatching();
    failure = {stage, name: safeErrorText(error?.name || 'Error'), message: safeErrorText(error?.message || error), stack: safeErrorText(error?.stack || '').slice(0, 6000)};
    log('error', `STARTUP_FAILED ${JSON.stringify(failure)}`);
    readiness.reject(error);
    return true;
  }
  function run(stage, callback, {fatal = true} = {}) {
    if (stopped || state !== 'starting') return callback();
    const id = ++sequence;
    pending.set(id, stage); record(stage, 'begin');
    const complete = () => { pending.delete(id); record(stage, 'done'); };
    const rejected = error => {
      pending.delete(id); record(stage, 'rejected');
      if (fatal) fail(error, stage);
    };
    try {
      const result = callback();
      if (result && typeof result.then === 'function') Promise.resolve(result).then(complete, rejected);
      else complete();
      return result; // Preserve the exact promise/value and native exception behavior.
    } catch (error) { rejected(error); throw error; }
  }
  function wrapMethod(object, name, stage, options) {
    if (!object || typeof object[name] !== 'function') return;
    const own = Object.getOwnPropertyDescriptor(object, name), original = object[name];
    const wrapper = function (...args) { return run(stage, () => original.apply(this, args), options); };
    try {
      Object.defineProperty(object, name, {configurable: true, writable: true, value: wrapper});
      restorers.push(() => {
        if (object[name] !== wrapper) return;
        if (own) Object.defineProperty(object, name, own); else delete object[name];
      });
    } catch { /* An immutable engine method remains untouched. */ }
  }
  function watchAssignment(name, transform) {
    const own = Object.getOwnPropertyDescriptor(host, name);
    if (own && (!own.configurable || !('value' in own))) return;
    let assigned = own?.value, value = assigned;
    const get = () => value;
    Object.defineProperty(host, name, {configurable: true, enumerable: true, get,
      set(next) { assigned = next; value = transform(next); }});
    restorers.push(() => {
      if (Object.getOwnPropertyDescriptor(host, name)?.get === get)
        Object.defineProperty(host, name, {configurable: true, enumerable: own?.enumerable ?? true, writable: true, value: assigned});
    });
    if (value !== undefined) value = transform(value);
  }
  watchAssignment('RuntimeInterface', value => {
    readiness.attach(value);
    wrapMethod(value?.prototype, 'CreateWorker', 'worker-create');
    return value;
  });
  watchAssignment('JobSchedulerDOM', value => {
    wrapMethod(value?.prototype, 'Init', 'job-scheduler-init');
    return value;
  });
  watchAssignment('C3_SetInitFunctions', value => {
    if (typeof value !== 'function') return value;
    return function (create, initialize) {
      const createObserved = function (...args) {
        const runtime = run('runtime-create', () => create.apply(this, args));
        wrapMethod(runtime, '_LoadDataJson', 'project-data-init');
        wrapMethod(runtime, '_InitialiseCanvas', 'canvas-init');
        // Construct may catch a renderer failure and retry with a fallback.
        // Only the enclosing canvas/runtime initialization determines failure.
        wrapMethod(host.C3?.Gfx?.WebGLRenderer?.prototype, 'InitState', 'webgl-init', {fatal: false});
        return runtime;
      };
      const initObserved = function (...args) { return run('runtime-init', () => initialize.apply(this, args)); };
      return value.call(this, createObserved, initObserved);
    };
  });
  // Trace only package reads. Never add request URLs, query strings or payloads
  // from remote business APIs to the startup snapshot.
  const originalFetch = host.fetch;
  if (typeof originalFetch === 'function') {
    const fetchObserved = function (input, ...args) {
      const raw = typeof input === 'string' ? input : '';
      const local = raw.replace(/^https:\/\/c3-minigame\.invalid\//, '').split(/[?#]/, 1)[0];
      const label = local && !/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(local) ? `asset:${local}` : null;
      return label ? run(label, () => originalFetch.call(this, input, ...args), {fatal: false}) : originalFetch.call(this, input, ...args);
    };
    host.fetch = fetchObserved;
    restorers.push(() => { if (host.fetch === fetchObserved) host.fetch = originalFetch; });
  }
  log('info', `boot platform=${platform} build=startup-diag-2`);
  if (waitMs > 0 && typeof host.setTimeout === 'function') {
    timer = host.setTimeout(() => {
      timer = undefined;
      if (state === 'starting') log('warn', `STARTUP_WAIT ${JSON.stringify(snapshot())}`);
    }, waitMs);
    timer?.unref?.();
  }
  function dispose() {
    if (stopped) return;
    stopped = true; stopWatching();
    for (const restore of restorers.splice(0).reverse()) { try { restore(); } catch { /* Do not replace later owners. */ } }
  }
  return {run, fail, getSnapshot: snapshot, dispose,
    ready() { if (state === 'starting') { state = 'ready'; record('runtime-ready', 'done'); } dispose(); }
  };
}
