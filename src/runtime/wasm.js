import {resolveAssetPath} from './network.js';

// WeChat's official API accepts package paths, not arbitrary user-data temporary files:
// https://developers.weixin.qq.com/minigame/dev/guide/performance/perf-webassembly.html
// This bridge never claims that writing arbitrary bytes makes them executable on WeChat.
function unsupported(operation) {
  const error = new Error(`${operation} is unsupported by the platform WebAssembly namespace; use a bundled .wasm/.wasm.br module with instantiate()`);
  error.name = 'NotSupportedError';
  return error;
}
function toBytes(source) {
  if (source instanceof ArrayBuffer || Object.prototype.toString.call(source) === '[object ArrayBuffer]') return new Uint8Array(source);
  if (ArrayBuffer.isView(source)) return new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
  throw new TypeError('WebAssembly source must be a package path, ArrayBuffer, or typed-array view');
}
function sameBytes(a, b) { if (a.byteLength !== b.byteLength) return false; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; }

/**
 * Returns the genuine standard namespace unchanged when present, or a path-aware bridge
 * over a genuine platform namespace. Returns undefined when neither implementation exists.
 *
 * wasmFiles is a build-time list of package-relative module files. BufferSource arguments
 * are accepted ONLY when actual package-file bytes match; no fake Module is ever returned.
 * Native platform instantiate return values and Memory/Table/Global/Module constructors
 * are preserved exactly. Native platform result shapes can differ from browser WebAssembly.
 */
export function createWasmCompatibility({nativeWebAssembly, platformWebAssembly, api, assetRoot = 'game', wasmFiles = []} = {}) {
  if (typeof nativeWebAssembly?.instantiate === 'function') return nativeWebAssembly;
  if (typeof platformWebAssembly?.instantiate !== 'function') return undefined;
  resolveAssetPath('probe', assetRoot);
  const packagePath = source => {
    const resolved = resolveAssetPath(String(source), assetRoot);
    if (/^[a-z][a-z\d+.-]*:/i.test(resolved) || resolved.startsWith('//') || !/\.wasm(?:\.br)?$/i.test(resolved)) {
      throw new TypeError('WXWebAssembly requires a bundled package-relative .wasm or .wasm.br path');
    }
    return resolved;
  };
  const files = [...new Set(wasmFiles.map(packagePath))];
  const fileBytes = new Map();
  function readPackageBytes(filePath) {
    if (fileBytes.has(filePath)) return fileBytes.get(filePath);
    const result = new Promise((resolve, reject) => {
      if (typeof api?.getFileSystemManager !== 'function') { reject(new Error('Matching WASM bytes requires the native file system')); return; }
      const filesystem = api.getFileSystemManager();
      if (typeof filesystem.readFile !== 'function') { reject(new Error('Native readFile is unavailable')); return; }
      filesystem.readFile({filePath, success: result => {
        try { resolve(toBytes(result.data).slice()); } catch (error) { reject(error); }
      }, fail: reject});
    });
    fileBytes.set(filePath, result);
    return result;
  }
  async function instantiateBytes(source, imports, suggestedPath) {
    const bytes = toBytes(source).slice();
    const candidates = [...files];
    if (suggestedPath) {
      try { const candidate = packagePath(suggestedPath); if (!candidates.includes(candidate)) candidates.unshift(candidate); }
      catch { /* Remote response URLs cannot become package paths. Registered files may still match. */ }
    }
    if (!candidates.length) throw new Error('WXWebAssembly cannot instantiate arbitrary bytes; include the module in wasmFiles or use its package path');
    for (const filePath of candidates) {
      const packaged = await readPackageBytes(filePath);
      if (sameBytes(bytes, packaged)) return platformWebAssembly.instantiate(filePath, imports);
    }
    throw new Error('WASM bytes do not match any registered package file; runtime-created or downloaded code is unsupported');
  }
  const bridge = Object.create(platformWebAssembly);
  Object.defineProperties(bridge, {
    instantiate: {enumerable: true, value: async (source, imports) => {
      if (typeof source === 'string') return platformWebAssembly.instantiate(packagePath(source), imports);
      return instantiateBytes(source, imports);
    }},
    instantiateStreaming: {enumerable: true, value: async (response, imports) => {
      const resolved = await response;
      if (!resolved || typeof resolved.arrayBuffer !== 'function') throw new TypeError('instantiateStreaming requires a Response with arrayBuffer()');
      if (resolved.ok === false) throw new Error(`WASM response failed with status ${resolved.status}`);
      return instantiateBytes(await resolved.arrayBuffer(), imports, resolved.url);
    }},
    compile: {enumerable: true, value: typeof platformWebAssembly.compile === 'function' ? platformWebAssembly.compile.bind(platformWebAssembly) : async () => { throw unsupported('WebAssembly.compile'); }},
    compileStreaming: {enumerable: true, value: typeof platformWebAssembly.compileStreaming === 'function' ? platformWebAssembly.compileStreaming.bind(platformWebAssembly) : async () => { throw unsupported('WebAssembly.compileStreaming'); }},
    validate: {enumerable: true, value: typeof platformWebAssembly.validate === 'function' ? platformWebAssembly.validate.bind(platformWebAssembly) : () => { throw unsupported('WebAssembly.validate'); }}
  });
  return bridge;
}
