const sharedEventHubs = new WeakMap();

// The permanently retained native dispatcher must be created in a scope that
// never holds a subscriber. Shared closure contexts could otherwise retain the
// first callback (and its DOM) even after it is removed from hub.listeners.
function createEventHub() {
  const hub = {listeners: new Set(), failed: false, failure: null};
  hub.dispatch = function (...args) {
    let result;
    const failures = [];
    for (const callback of [...hub.listeners]) {
      if (!hub.listeners.has(callback)) continue;
      try {
        const value = callback.apply(this, args);
        if (value !== undefined) result = value;
      } catch (failure) { failures.push(failure); }
    }
    if (failures.length === 1) throw failures[0];
    if (failures.length) throw new AggregateError(failures, 'Platform event callbacks failed');
    return result;
  };
  return hub;
}

/** Native APIs with no listener-specific off keep one inert dispatcher per host.
 * Removing a subscription only releases its local callback. Never call a global
 * off method: doing so would remove listeners owned by other engine/plugins.
 * These events normally return void; when a platform requests share configuration,
 * the last non-undefined callback return is passed back to the native host.
 */
export function subscribeSharedEvent(api, entry, listener) {
  let hubs = sharedEventHubs.get(api);
  if (!hubs) { hubs = new Map(); sharedEventHubs.set(api, hubs); }
  let hub = hubs.get(entry.name);
  if (hub?.failed) throw hub.failure;
  if (hub) {
    hub.listeners.add(listener);
    return () => hub.listeners.delete(listener);
  }

  hub = createEventHub();
  hub.listeners.add(listener);
  hubs.set(entry.name, hub);
  try { api[entry.name].call(api, hub.dispatch); }
  catch (failure) {
    hub.listeners.clear();
    // Registration may have attached the dispatcher before throwing. Retain the
    // inert failed hub instead of risking duplicate native registration on retry.
    hub.failed = true; hub.failure = failure;
    throw failure;
  }
  return () => hub.listeners.delete(listener);
}
