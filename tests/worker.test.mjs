import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorkerCompatibility} from '../src/runtime/worker.js';
import {createModuleLoader} from '../src/runtime/module-loader.js';

const tick = () => new Promise(resolve => setImmediate(resolve));

test('module registry resolves local script URLs, executes once and rejects remote/dynamic code', async () => {
  const order = [];
  const loader = createModuleLoader({'scripts/engine.js': () => order.push('engine')});
  await Promise.all([loader.load('scripts/engine.js'), loader.load('https://c3-minigame.invalid/game/scripts/engine.js?v=1')]);
  assert.deepEqual(order, ['engine']);
  assert.equal(loader.resolve('../engine.js', 'scripts/project/main.js'), 'scripts/engine.js');
  assert.equal(loader.resolve('scripts/with%20space.js'), 'scripts/with space.js');
  await assert.rejects(loader.load('%2e%2e/outside.js'), /escapes/);
  await assert.rejects(loader.load('https://evil.example/code.js'), /unsupported/);
  await assert.rejects(loader.load('../../outside.js'), /escapes/);
  await assert.rejects(loader.load('blob:test'), /unsupported/);
  await assert.rejects(loader.load('missing.js'), /not bundled/);
});

test('MessageChannel queues asynchronously, clones data, supports start and close', async () => {
  const {MessageChannel} = createWorkerCompatibility({});
  const channel = new MessageChannel();
  const messages = [];
  channel.port2.addEventListener('message', event => messages.push(event.data));
  const data = {value: 1, bytes: new Uint8Array([3, 4])};
  channel.port1.postMessage(data);
  data.value = 2; data.bytes[0] = 9;
  await tick();
  assert.equal(messages.length, 0, 'addEventListener requires start');
  channel.port2.start();
  await tick();
  assert.equal(messages[0].value, 1);
  assert.deepEqual([...messages[0].bytes], [3, 4]);
  channel.port2.close(); channel.port1.postMessage('ignored');
  await tick();
  assert.equal(messages.length, 1);
});

test('Worker factories execute in separate scopes; bundled imports and asynchronous roundtrip work', async () => {
  const {Worker} = createWorkerCompatibility({
    'scripts/lib.js': scope => { scope.multiplier = 3; },
    'scripts/job.js': scope => {
      scope.importScripts('lib.js');
      scope.onmessage = event => scope.postMessage(event.data * scope.multiplier);
    }
  });
  const worker = new Worker('scripts/job.js');
  let observed;
  worker.onmessage = event => { observed = event.data; };
  worker.postMessage(14);
  assert.equal(observed, undefined);
  await tick();
  assert.equal(observed, 42);
  assert.equal(globalThis.multiplier, undefined);
  worker.terminate();
  worker.postMessage(99); await tick();
  assert.equal(observed, 42);
  assert.throws(() => new Worker('https://other.test/job.js'), /unsupported/);
  assert.throws(() => new Worker('missing.js'), /not bundled/);
});

test('Construct-like dispatch/job workers route MessagePorts and transferable typed arrays', async () => {
  const registry = {
    'scripts/dispatchworker.js': scope => {
      let inputPort, jobPort;
      scope.onmessage = ({data}) => {
        if (data.type === '_init') {
          inputPort = data['in-port'];
          inputPort.onmessage = ({data: job}) => jobPort.postMessage(job, [job.bytes.buffer]);
        } else if (data.type === '_addJobWorker') {
          jobPort = data.port;
        }
      };
    },
    'scripts/jobworker.js': scope => {
      scope.onmessage = ({data}) => {
        if (data.type !== 'init') return;
        const outputPort = data['output-port'];
        data['dispatch-port'].onmessage = ({data: job}) => {
          const result = new Uint8Array(job.bytes.length);
          for (let i = 0; i < result.length; i++) result[i] = job.bytes[i] * 2;
          outputPort.postMessage({id: job.id, bytes: result}, [result.buffer]);
        };
      };
    }
  };
  const {Worker, MessageChannel} = createWorkerCompatibility(registry);
  const dispatch = new Worker('scripts/dispatchworker.js');
  const job = new Worker('scripts/jobworker.js');
  const input = new MessageChannel(), dispatchJob = new MessageChannel(), output = new MessageChannel();
  dispatch.postMessage({type: '_init', 'in-port': input.port2}, [input.port2]);
  dispatch.postMessage({type: '_addJobWorker', port: dispatchJob.port1}, [dispatchJob.port1]);
  job.postMessage({type: 'init', 'dispatch-port': dispatchJob.port2, 'output-port': output.port2}, [dispatchJob.port2, output.port2]);
  const response = new Promise(resolve => { output.port1.onmessage = ({data}) => resolve(data); });
  const bytes = new Uint8Array([2, 3, 4]);
  input.port1.postMessage({id: 7, bytes}, [bytes.buffer]);
  assert.equal(bytes.byteLength, 3, 'shim documents that transfer does not detach');
  const result = await response;
  assert.equal(result.id, 7);
  assert.deepEqual([...result.bytes], [4, 6, 8]);
  dispatch.terminate(); job.terminate();
});

test('Worker startup errors are observable; terminate cancels pending messages and timers', async () => {
  const {Worker} = createWorkerCompatibility({
    'bad.js': () => { throw new Error('fixture startup error'); },
    'timer.js': scope => { scope.setTimeout(() => scope.postMessage('late'), 10); }
  });
  const bad = new Worker('bad.js');
  const failure = new Promise(resolve => { bad.onerror = event => resolve(event.message); });
  assert.equal(await failure, 'fixture startup error');
  bad.terminate();
  const timer = new Worker('timer.js');
  let events = 0;
  timer.onmessage = () => events++;
  await tick(); timer.terminate();
  await new Promise(resolve => setTimeout(resolve, 15));
  assert.equal(events, 0);
});


test('terminating a worker closes received MessagePort endpoints', async () => {
  const {Worker, MessageChannel} = createWorkerCompatibility({
    'port.js': scope => { scope.onmessage = ({data}) => { data.port.onmessage = ({data: value}) => data.port.postMessage(value * 2); }; }
  });
  const channel = new MessageChannel(), worker = new Worker('port.js');
  const messages = [];
  channel.port1.onmessage = ({data}) => messages.push(data);
  worker.postMessage({port: channel.port2}, [channel.port2]);
  channel.port1.postMessage(21);
  await tick();
  assert.deepEqual(messages, [42]);
  worker.terminate();
  channel.port1.postMessage(22);
  await tick();
  assert.deepEqual(messages, [42]);
});
