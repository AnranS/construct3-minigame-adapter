/** Resolve only bundled local modules. Remote code and runtime eval are intentionally unsupported. */
export function resolveModulePath(specifier, from = '', baseURL = 'https://c3-minigame.invalid/game/') {
  let path = String(specifier);
  const base = String(baseURL).replace(/[?#].*$/, '').replace(/\/?$/, '/');
  if (/^[a-z][a-z\d+.-]*:/i.test(path) || path.startsWith('//')) {
    if (!path.startsWith(base)) throw new Error(`External or unbundled script URL is unsupported: ${path}`);
    path = path.slice(base.length);
    from = '';
  }
  path = path.replace(/[?#].*$/, '');
  if (!path || path.includes('\\') || /%2f|%5c/i.test(path)) throw new Error(`Invalid module path: ${specifier}`);
  path = decodeURIComponent(path);
  if (path.includes('\0')) throw new Error(`Invalid module path: ${specifier}`);
  if (path.startsWith('/')) {
    const basePath = base.replace(/^[a-z][a-z\d+.-]*:\/\/[^/]+/i, '');
    if (!path.startsWith(basePath)) throw new Error(`Module is outside the bundle root: ${specifier}`);
    path = path.slice(basePath.length);
    from = '';
  }
  const directory = from ? String(from).replace(/[^/]*$/, '') : '';
  const parts = [];
  for (const part of `${directory}${path}`.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (!parts.length) throw new Error(`Module escapes the bundle root: ${specifier}`);
      parts.pop();
    } else {
      parts.push(part);
    }
  }
  return parts.join('/');
}

export function registryGet(registry, key) {
  return registry instanceof Map ? registry.get(key) : Object.prototype.hasOwnProperty.call(registry, key) ? registry[key] : undefined;
}

/** Factory functions must be generated at build time. The loader never fetches or evaluates source. */
export function createModuleLoader(registry, {baseURL = 'https://c3-minigame.invalid/game/', onLoad} = {}) {
  const cache = new Map();
  const resolve = (specifier, from = '') => resolveModulePath(specifier, from, baseURL);
  function load(specifier, from = '') {
    let key;
    try { key = resolve(specifier, from); }
    catch (error) { return Promise.reject(error); }
    if (cache.has(key)) return cache.get(key);
    const factory = registryGet(registry, key);
    if (typeof factory !== 'function') return Promise.reject(new Error(`Script was not bundled: ${key}`));
    const result = Promise.resolve().then(() => factory()).then(value => {
      onLoad?.(key);
      return value;
    });
    cache.set(key, result);
    return result;
  }
  return {resolve, load};
}
