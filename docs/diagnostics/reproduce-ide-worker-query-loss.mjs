// Read-only diagnostic for the locally installed WeChat IDE RC 2.02.2607161.
// Does not launch the IDE, issue HTTP requests, modify its files, or read a profile.
// Loads only three source modules into an isolated VM with inert service imports.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { openSync, readSync, closeSync } from 'node:fs';
import { URL, URLSearchParams } from 'node:url';
import vm from 'node:vm';

const asarPath = process.argv[2] || '/Applications/wechatwebdevtools.app/Contents/Resources/app.asar';
const descriptor = openSync(asarPath, 'r');
const headerSize = Buffer.alloc(16);
readSync(descriptor, headerSize, 0, 16, 0);
const headerBuffer = Buffer.alloc(headerSize.readUInt32LE(12));
readSync(descriptor, headerBuffer, 0, headerBuffer.length, 16);
const header = JSON.parse(headerBuffer.toString());
const contentOffset = 8 + headerSize.readUInt32LE(4);
const sources = [];

function readModule(name) {
  const entry = header.files.js.files[name];
  assert(entry?.offset !== undefined, `Missing local IDE module: ${name}`);
  const buffer = Buffer.alloc(entry.size);
  readSync(descriptor, buffer, 0, buffer.length, contentOffset + Number(entry.offset));
  sources.push({ path: `js/${name}`, sha256: createHash('sha256').update(buffer).digest('hex') });
  return buffer.toString();
}

function loadModule(name, overrides = {}) {
  const exports = {};
  const inertRequire = (id) => {
    if (Object.hasOwn(overrides, id)) return overrides[id];
    if (id === 'licia/lazyImport') return (require) => require;
    // Query decoding is not the behavior under test: the IDE parsePath/parsedUrl
    // functions themselves split path and query. This one-key query is standard.
    if (id === 'licia/query') return { parse: (value) => Object.fromEntries(new URLSearchParams(value)) };
    if (id === 'tslib') return { __param: () => () => {}, __decorate: (_, constructor) => constructor };
    if (id === 'url') return { URL };
    return {};
  };
  vm.runInNewContext(readModule(name), { exports, require: inertRequire }, { filename: name, timeout: 1000 });
  return exports;
}

try {
  const utilities = loadModule('7141d70a632001bdddb65e5d63d2ac25.js');
  const { SimulatorCodeService } = loadModule('8200c33fc6adfcc87f94ac822aa8ec4a.js');
  let receivedOptions;
  const backend = {
    async getGameWorkerBundle(_windowId, options) {
      receivedOptions = options;
      return ''; // Observe routing only; never run the real compiler.
    },
  };
  const { getGameResource } = loadModule('a9cc11502efe0e26cce81894f7c858be.js', {
    './9eee66f818065fa6881814a83bcfe0cf.js': { default: () => backend },
    './c0ca29e0e453b6db3ac2b1c2112bb2ac.js': { RetrievedSource: class {} },
  });

  const originalPath = '/game/s1/_sessionId/simulator-app-session-s1/__WORKER__/worker.js?libName=WAAccelerateWorker.js';
  const route = utilities.parsedUrl(originalPath, 'game/s1/_sessionId/simulator-app-session-s1');
  assert.equal(route.subPath, '__WORKER__/worker.js');
  assert.equal(route.query.libName, 'WAAccelerateWorker.js');

  let rewrittenURL;
  const isolatedService = Object.create(SimulatorCodeService.prototype);
  isolatedService.simulatorHttpService = { address: 'http://127.0.0.1:1' };
  isolatedService.buildProxyContext = async function (request, url) {
    rewrittenURL = url;
    return { parsedUrl: this.getParsedUrl(request, url), project: {}, winId: 'diagnostic' };
  };
  isolatedService.goGameAppservice = getGameResource;
  await isolatedService.serveGameAppservice({}, route, 'simulator-app-session-s1');

  assert.equal(rewrittenURL, 'http://127.0.0.1:1/game/__WORKER__/worker.js');
  assert.equal(receivedOptions.extraLibName, undefined);
  assert.equal(receivedOptions.useEngineIDE, false);
  console.log(JSON.stringify({
    diagnosis: 'Local IDE session route drops the libName query before calling the worker compiler',
    originalPath,
    parsedSubPath: route.subPath,
    parsedQuery: route.query,
    rewrittenURL,
    receivedExtraLibName: receivedOptions.extraLibName ?? null,
    actualIdeFunctionsExecuted: ['parsedUrl', 'serveGameAppservice', 'getParsedUrl', 'getGameResource'],
    notExecuted: ['IDE services', 'real compiler', 'network requests', 'native Worker'],
    sources,
  }, null, 2));
} finally {
  closeSync(descriptor);
}
