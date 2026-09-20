import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {build} from 'esbuild';
import {MiniBlob, binaryAtob, binaryBtoa, createBinaryCompatibility} from '../src/runtime/binary.js';

function mockFS() {
  const files = new Map(), writes = [];
  const api = {env: {USER_DATA_PATH: 'wxfile://usr'}, getFileSystemManager: () => ({
    writeFile({filePath, data, success}) { files.set(filePath, new Uint8Array(data).slice()); writes.push(filePath); queueMicrotask(success); },
    unlink({filePath, success}) { files.delete(filePath); queueMicrotask(success); }
  })};
  return {api, files, writes};
}

test('base64 functions preserve all byte values and reject invalid inputs', () => {
  const bytes = String.fromCharCode(...Array.from({length: 256}, (_, i) => i));
  assert.equal(binaryAtob(binaryBtoa(bytes)), bytes);
  assert.equal(binaryBtoa(bytes), Buffer.from(bytes, 'latin1').toString('base64'));
  assert.equal(binaryAtob(' Zg==\n'), 'f');
  assert.equal(binaryAtob('Zm8'), 'fo');
  for (const invalid of ['a', 'a===', 'Zg=', '!aa', 'Z===']) assert.throws(() => binaryAtob(invalid), {name: 'InvalidCharacterError'});
  assert.throws(() => binaryBtoa('中'), {name: 'InvalidCharacterError'});
});

test('Blob fallback copies view boundaries, encodes UTF-8, slices and remains immutable', async () => {
  const backing = new Uint8Array([1, 2, 3, 4]);
  const part = new MiniBlob(['中文🙂']);
  const blob = new MiniBlob([backing.subarray(1, 3), part, new DataView(backing.buffer, 3, 1)], {type: 'IMAGE/PNG'});
  backing.fill(9);
  assert.equal(blob.type, 'image/png');
  assert.equal(blob.size, 13);
  assert.deepEqual([...new Uint8Array(await blob.slice(0, 2).arrayBuffer())], [2, 3]);
  assert.equal(await blob.slice(2, -1, 'TEXT/PLAIN').text(), '中文🙂');
  assert.equal(blob.slice(2, -1, 'TEXT/PLAIN').type, 'text/plain');
  const returned = new Uint8Array(await blob.arrayBuffer()); returned[0] = 99;
  assert.equal((await blob.bytes())[0], 2);
  assert.equal(await new MiniBlob(['\ud800']).text(), '\ufffd');
  assert.equal(new MiniBlob([], {type: '无效'}).type, '');
  assert.equal(Object.prototype.toString.call(blob), '[object Blob]');
});

test('UTF-8 Blob decoding matches TextDecoder on malformed byte sequences', async () => {
  for (const bytes of [[0xe0, 0x80, 0x80], [0xed, 0xa0, 0x80], [0xf4, 0x90, 0x80, 0x80], [0xe4, 0xb8], [0xe4, 0x61], [0xef, 0xbb, 0xbf, 0x61]]) {
    const array = new Uint8Array(bytes);
    assert.equal(await new MiniBlob([array]).text(), new TextDecoder().decode(array));
  }
});

test('object URLs materialize actual bytes once and remove temporary files on revoke/dispose', async () => {
  const {api, files, writes} = mockFS();
  const binary = createBinaryCompatibility({api, host: {}});
  const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const url = binary.URL.createObjectURL(new binary.Blob([bytes]));
  const [file1, file2] = await Promise.all([binary.resolveImageSource(url), binary.resolveImageSource(url)]);
  assert.equal(file1, file2);
  assert.equal(writes.length, 1);
  assert.match(file1, /^wxfile:\/\/usr\/c3-adapter-blob-.*\.png$/);
  assert.deepEqual([...files.get(file1)], [...bytes]);
  binary.URL.revokeObjectURL(url);
  await assert.rejects(binary.resolveImageSource(url), /revoked/);
  const url2 = binary.URL.createObjectURL(new binary.Blob(['other'], {type: 'image/webp'}));
  await binary.resolveImageSource(url2);
  assert.equal(await binary.resolveImageSource('images/a.png'), 'images/a.png');
  assert.equal(await binary.resolveImageSource('data:image/png;base64,aA=='), 'data:image/png;base64,aA==');
  await binary.dispose();
  assert.equal(files.size, 0);
  assert.throws(() => binary.URL.createObjectURL(new binary.Blob()), /disposed/);
});

test('Blob/image errors are explicit and do not fabricate usable native paths', async () => {
  const binary = createBinaryCompatibility({host: {}});
  assert.throws(() => binary.URL.createObjectURL('text'), /requires a Blob/);
  const url = binary.URL.createObjectURL(new binary.Blob(['x']));
  await assert.rejects(binary.resolveImageSource(url), /USER_DATA_PATH/);
  await assert.rejects(binary.resolveImageSource('blob:missing'), /unknown/);
  await binary.dispose();
});

test('bundled URL fallback runs without any native URL globals and supports relative/base/query semantics', async () => {
  const code = `import {createBinaryCompatibility} from './src/runtime/binary.js';
    const b=createBinaryCompatibility({host:globalThis});
    const u=new b.URL('../引擎.js?x=1&x=2#z','https://example.test/game/scripts/main.js');
    u.searchParams.append('q','a b');
    globalThis.result={href:u.href,origin:u.origin,pathname:u.pathname,values:u.searchParams.getAll('x'),params:new b.URLSearchParams('a=1&a=2').getAll('a')};`;
  const result = await build({stdin: {contents: code, resolveDir: process.cwd(), sourcefile: 'binary-smoke.mjs'}, bundle: true, write: false, format: 'iife', platform: 'browser', target: 'es2020'});
  const context = vm.createContext({console, setTimeout, clearTimeout});
  vm.runInContext(result.outputFiles[0].text, context);
  assert.equal(context.result.origin, 'https://example.test');
  assert.equal(context.result.pathname, '/game/%E5%BC%95%E6%93%8E.js');
  assert.match(context.result.href, /q=a\+b#z$/);
  assert.deepEqual(Array.from(context.result.values), ['1', '2']);
  assert.deepEqual(Array.from(context.result.params), ['1', '2']);
});
