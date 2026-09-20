import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const exec = promisify(execFile);
const moduleURL = new URL('../src/runtime/native-events.js', import.meta.url).href;

test('an attached shared dispatcher releases the disposed listener closure for garbage collection', {timeout: 15000}, async () => {
  // A separate V8 process lets this regression force GC without changing the
  // main test runner. The native dispatcher deliberately stays strongly held.
  const script = `
    import assert from 'node:assert/strict';
    import {subscribeSharedEvent} from ${JSON.stringify(moduleURL)};
    const nativeDispatchers = [];
    const api = {onResize(dispatcher) { nativeDispatchers.push(dispatcher); }};
    function registerAndDispose() {
      const oldDocument = {payload: new Array(100000).fill('disposed-dom')};
      const reference = new WeakRef(oldDocument);
      const listener = () => oldDocument.payload.length;
      const unsubscribe = subscribeSharedEvent(api, {name: 'onResize'}, listener);
      assert.equal(nativeDispatchers[0](), 100000, 'the active callback really captures the document');
      unsubscribe();
      return reference;
    }
    const reference = registerAndDispose();
    // Neither listener nor unsubscribe escapes the function. Yield between GC
    // attempts to end the WeakRef keep-alive job; do not deref inside this loop.
    for (let attempt = 0; attempt < 20; attempt++) {
      await new Promise(resolve => setImmediate(resolve));
      global.gc();
    }
    assert.equal(reference.deref() === undefined, true, 'permanent dispatcher must not retain the first disposed listener closure');
    assert.equal(nativeDispatchers.length, 1);
    assert.equal(nativeDispatchers[0](), undefined, 'native dispatcher remains attached and inert');
    let calls = 0;
    const unsubscribe = subscribeSharedEvent(api, {name: 'onResize'}, () => ++calls);
    assert.equal(nativeDispatchers.length, 1, 'subsequent subscription reuses the same native dispatcher');
    nativeDispatchers[0]();
    assert.equal(calls, 1);
    unsubscribe();
    console.log('disposed listener collected; native dispatcher reused');
  `;
  const {stdout} = await exec(process.execPath, ['--expose-gc', '--input-type=module', '--eval', script], {timeout: 10000});
  assert.match(stdout, /disposed listener collected; native dispatcher reused/);
});
