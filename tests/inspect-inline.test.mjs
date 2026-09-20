import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { inspectProject } from '../src/build/inspect.mjs';

const message = "Web exports won't work until you upload them. (When running on the file: protocol, browsers block many features from working for security reasons.)";
const diagnostic = `if (location.protocol.substr(0, 4) === "file") { alert(${JSON.stringify(message)}); }`;

async function inspectInline(t, source) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'c3-inline-diagnostic-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, 'index.html'), `<script>${source}</script><script type="module" src="main.js"></script>`);
  await fs.writeFile(path.join(root, 'main.js'), 'globalThis.C3_SetInitFunctions = () => {};');
  return inspectProject(root);
}

test('skip only the complete Construct file-protocol diagnostic and record the decision', async t => {
  for (const source of [diagnostic, `/* export diagnostic */\n${diagnostic.replace('"file"', "'file'")}\n// trailing comment`]) {
    const report = await inspectInline(t, source);
    assert.equal(report.canBuild, true);
    assert.equal(report.findings.filter(f => f.code === 'SKIP_FILE_PROTOCOL_DIAGNOSTIC' && f.level === 'info').length, 1);
    assert.equal(report.findings.some(f => f.code === 'INLINE_SCRIPT'), false);
    assert.deepEqual(report.entries, [{ path: 'main.js', type: 'module' }]);
  }
});

test('do not skip extra behavior or near-matches to the browser diagnostic', async t => {
  const sources = [
    `${diagnostic}\nglobalThis.gameStarted = true;`,
    `globalThis.gameStarted = true;\n${diagnostic}`,
    diagnostic.replace('); }', '); globalThis.gameStarted = true; }'),
    `${diagnostic} else { globalThis.gameStarted = true; }`,
    diagnostic.replace('location.protocol', 'getLocation().protocol'),
    diagnostic.replace('substr(0, 4)', 'substr(0, getLength())'),
    diagnostic.replace('=== "file"', '=== "http"'),
    diagnostic.replace('=== "file"', '=== "file" || startGame()'),
    diagnostic.replace('alert(', 'notify('),
    diagnostic.replace(JSON.stringify(message), `(${JSON.stringify(message)}, startGame())`),
    diagnostic.replace(JSON.stringify(message), '"A game-specific message"'),
    'globalThis.gameStarted = true;',
    'if ('
  ];
  for (const source of sources) {
    const report = await inspectInline(t, source);
    assert.equal(report.canBuild, false, source);
    assert.equal(report.findings.some(f => f.code === 'INLINE_SCRIPT' && f.level === 'error'), true, source);
    assert.equal(report.findings.some(f => f.code === 'SKIP_FILE_PROTOCOL_DIAGNOSTIC'), false, source);
  }
});
