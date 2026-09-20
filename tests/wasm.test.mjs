import test from 'node:test';
import assert from 'node:assert/strict';
import {createWasmCompatibility} from '../src/runtime/wasm.js';

// Real minimal WASM module exporting answer() -> 42, instantiated by Node's real WASM VM.
const wasmBytes = new Uint8Array([0,97,115,109,1,0,0,0,1,5,1,96,0,1,127,3,2,1,0,7,10,1,6,97,110,115,119,101,114,0,0,10,6,1,4,0,65,42,11]);
function platform() {
  const files = new Map([['game/modules/answer.wasm', wasmBytes]]), calls = [];
  const namespace = {
    Memory: WebAssembly.Memory, Table: WebAssembly.Table, Global: WebAssembly.Global,
    instantiate: async (path, imports) => {
      calls.push(path);
      const bytes = files.get(path);
      if (!bytes) throw new Error('module not in package');
      return WebAssembly.instantiate(bytes, imports);
    }
  };
  const api = {getFileSystemManager: () => ({readFile({filePath, success, fail}) {
    const bytes = files.get(filePath);
    if (!bytes) fail(new Error('package file not found'));
    else success({data: bytes.slice().buffer});
  }})};
  return {namespace, api, calls};
}

test('real standard WASM is preserved and absent WASM does not receive a fake namespace', () => {
  assert.equal(createWasmCompatibility({nativeWebAssembly: WebAssembly}), WebAssembly);
  assert.equal(createWasmCompatibility({}), undefined);
});

test('platform bridge preserves genuine constructors and executes bundled WASM', async () => {
  const {namespace, api, calls} = platform();
  const bridge = createWasmCompatibility({platformWebAssembly: namespace, api});
  assert.equal(bridge.Memory, WebAssembly.Memory);
  assert.equal(bridge.Table, WebAssembly.Table);
  assert.equal(bridge.Global, WebAssembly.Global);
  const result = await bridge.instantiate('modules/answer.wasm', {});
  assert.equal(result.instance.exports.answer(), 42);
  assert.ok(result.module instanceof WebAssembly.Module, 'module is genuinely compiled, never fabricated');
  assert.deepEqual(calls, ['game/modules/answer.wasm']);
  await assert.rejects(bridge.instantiate('wxfile://usr/generated.wasm'), /package-relative/);
  await assert.rejects(bridge.instantiate('https://example.test/x.wasm'), /package-relative/);
  await assert.rejects(bridge.instantiate('../escape.wasm'), /escapes/);
});

test('typed-array WASM bytes match real package bytes before native path instantiation', async () => {
  const {namespace, api, calls} = platform();
  const bridge = createWasmCompatibility({platformWebAssembly: namespace, api, wasmFiles: ['modules/answer.wasm']});
  const padded = new Uint8Array(wasmBytes.length + 4); padded.set(wasmBytes, 2);
  const result = await bridge.instantiate(padded.subarray(2, -2));
  assert.equal(result.instance.exports.answer(), 42);
  assert.deepEqual(calls, ['game/modules/answer.wasm']);
  await assert.rejects(bridge.instantiate(new Uint8Array([0, 1, 2])), /do not match/);
  const unregistered = createWasmCompatibility({platformWebAssembly: namespace, api});
  await assert.rejects(unregistered.instantiate(wasmBytes), /arbitrary bytes/);
});

test('streaming validates response bytes against a true package path; unsupported compile/validate fail explicitly', async () => {
  const {namespace, api} = platform();
  const bridge = createWasmCompatibility({platformWebAssembly: namespace, api});
  const result = await bridge.instantiateStreaming(Promise.resolve({ok: true, url: 'https://c3-minigame.invalid/game/modules/answer.wasm', arrayBuffer: async () => wasmBytes.slice().buffer}));
  assert.equal(result.instance.exports.answer(), 42);
  await assert.rejects(bridge.instantiateStreaming({ok: false, status: 404, arrayBuffer() { throw new Error('should not read'); }}), /404/);
  await assert.rejects(bridge.compile(wasmBytes), {name: 'NotSupportedError'});
  await assert.rejects(bridge.compileStreaming(Promise.resolve({})), {name: 'NotSupportedError'});
  assert.throws(() => bridge.validate(wasmBytes), {name: 'NotSupportedError'});
});
