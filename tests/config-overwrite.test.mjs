import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {convertProject} from '../src/build/convert.mjs';

const exec = promisify(execFile);
const cli = fileURLToPath(new URL('../src/cli.mjs', import.meta.url));
const markerName = '.c3-minigame-output.json';
const privateConfig = {libVersion: '3.15.3', setting: {compileHotReLoad: true}, projectname: 'local-test'};

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'c3-config-overwrite-'));
  t.after(() => fs.rm(root, {recursive: true, force: true}));
  const input = path.join(root, 'input'), output = path.join(root, 'output');
  await fs.mkdir(input);
  await fs.writeFile(path.join(input, 'main.js'), 'globalThis.configFixture = 1;');
  const build = options => convertProject({input, output, platform: 'wechat', entry: 'main.js', ...options});
  const read = async name => JSON.parse(await fs.readFile(path.join(output, name), 'utf8'));
  const write = (name, value) => fs.writeFile(path.join(output, name), JSON.stringify(value));
  await build({appId: 'fixture-original-game-id'});
  const config = await read('project.config.json');
  await write('project.config.json', {...config, libVersion: '3.15.3', compileType: 'miniprogram',
    projectname: 'must-be-regenerated', unrelatedPrivateValue: 'do-not-inherit', setting: {urlCheck: false}});
  await write('project.private.config.json', privateConfig);
  return {root, input, output, build, read, write,
    runCLI: args => exec(process.execPath, [cli, 'convert', '--input', input, '--output', output,
      '--entry', 'main.js', '--platform', 'wechat', '--overwrite', '--json', ...args])};
}

test('CLI overwrite without appid retains same-platform local identity and IDE settings only', async t => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.input, 'main.js'), 'globalThis.configFixture = 2;');
  const {stdout} = await f.runCLI([]);
  const config = await f.read('project.config.json');
  assert.equal(config.appid, 'fixture-original-game-id');
  assert.equal(config.libVersion, '3.15.3');
  assert.equal(config.compileType, 'game');
  assert.equal(config.projectname, 'c3-minigame-wechat');
  assert.equal(config.setting.urlCheck, true);
  assert.equal('unrelatedPrivateValue' in config, false);
  assert.deepEqual(await f.read('project.private.config.json'), privateConfig);
  assert.equal((await f.read(markerName)).platform, 'wechat');
  const report = JSON.parse(stdout);
  assert.equal(report.appIdConfigured, true);
  assert.deepEqual(report.preservedLocalConfig, ['appid', 'libVersion', 'project.private.config.json']);
  assert.equal(stdout.includes('fixture-original-game-id'), false, 'build diagnostics do not expose the local AppID');
  assert.match(await fs.readFile(path.join(f.output, 'game.js'), 'utf8'), /configFixture = 2/);
});

test('explicit CLI appid wins, including an explicitly empty value', async t => {
  const f = await fixture(t);
  for (const appId of ['fixture-replacement-game-id', '']) {
    const {stdout} = await f.runCLI(['--appid', appId]);
    const config = await f.read('project.config.json');
    assert.equal(config.appid, appId);
    assert.equal(config.libVersion, '3.15.3');
    assert.deepEqual(await f.read('project.private.config.json'), privateConfig);
    const report = JSON.parse(stdout);
    assert.equal(report.appIdConfigured, Boolean(appId));
    assert.deepEqual(report.preservedLocalConfig, ['libVersion', 'project.private.config.json']);
  }
});

test('changing the target platform does not copy identity, library version or private config', async t => {
  const f = await fixture(t);
  const report = await f.build({platform: 'douyin', overwrite: true});
  const config = await f.read('project.config.json');
  assert.equal(config.appid, '');
  assert.equal('libVersion' in config, false);
  assert.equal((await f.read(markerName)).platform, 'douyin');
  await assert.rejects(fs.access(path.join(f.output, 'project.private.config.json')), {code: 'ENOENT'});
  assert.deepEqual(report.preservedLocalConfig, []);
  assert.equal(report.appIdConfigured, false);
});

test('legacy tool markers preserve local config only when their build report identifies the same platform', async t => {
  const f = await fixture(t);
  const marker = await f.read(markerName);
  delete marker.platform;
  await f.write(markerName, marker);
  const report = await f.build({overwrite: true});
  assert.equal((await f.read('project.config.json')).appid, 'fixture-original-game-id');
  assert.equal((await f.read('project.config.json')).libVersion, '3.15.3');
  assert.deepEqual(await f.read('project.private.config.json'), privateConfig);
  assert.equal((await f.read(markerName)).platform, 'wechat');
  assert.equal(report.preservedLocalConfig.length, 3);
});

test('symlinked, non-object or malformed saved JSON cannot be inherited or replace the old build', async t => {
  const f = await fixture(t);
  const marker = await f.read(markerName);
  delete marker.platform;
  await f.write(markerName, marker); // Exercise the legacy report reader as well.
  const originalGame = await fs.readFile(path.join(f.output, 'game.js'));
  const outside = path.join(f.root, 'outside.json');
  await fs.writeFile(outside, '{"private":"external-file-must-not-be-read-or-copied"}');
  for (const name of [markerName, 'BUILD-REPORT.json', 'project.config.json', 'project.private.config.json']) {
    const filename = path.join(f.output, name);
    const original = await fs.readFile(filename);
    for (const value of ['{broken', '[]', 'null']) {
      await fs.writeFile(filename, value);
      await assert.rejects(f.build({overwrite: true}), /拒绝覆盖/);
      assert.equal(await fs.readFile(filename, 'utf8'), value);
      assert.deepEqual(await fs.readFile(path.join(f.output, 'game.js')), originalGame);
    }
    await fs.rm(filename);
    await fs.symlink(outside, filename);
    await assert.rejects(f.build({overwrite: true}), /符号链接/);
    assert.equal((await fs.lstat(filename)).isSymbolicLink(), true);
    await fs.rm(filename);
    await fs.mkdir(filename);
    await assert.rejects(f.build({overwrite: true}), /普通 JSON 文件/);
    await fs.rmdir(filename);
    await fs.writeFile(filename, original);
  }
  assert.deepEqual(await fs.readFile(path.join(f.output, 'game.js')), originalGame);
  assert.equal(await fs.readFile(outside, 'utf8'), '{"private":"external-file-must-not-be-read-or-copied"}');
  assert.equal((await fs.readdir(f.root)).some(name => name.startsWith('.c3-build-')), false);
});

test('legacy markers without a trustworthy matching platform report do not inherit local config', async t => {
  const f = await fixture(t);
  for (const previousReport of [null, {tool: 'other-tool', platform: 'wechat'}, {tool: 'construct3-minigame-adapter', platform: 'douyin'}]) {
    await f.write(markerName, {tool: 'construct3-minigame-adapter', version: '0.2.0'});
    await f.write('project.config.json', {appid: 'fixture-do-not-inherit', libVersion: '3.15.3'});
    await f.write('project.private.config.json', privateConfig);
    if (previousReport) await f.write('BUILD-REPORT.json', previousReport);
    else await fs.rm(path.join(f.output, 'BUILD-REPORT.json'));
    const report = await f.build({overwrite: true});
    assert.equal((await f.read('project.config.json')).appid, '');
    assert.equal('libVersion' in await f.read('project.config.json'), false);
    await assert.rejects(fs.access(path.join(f.output, 'project.private.config.json')), {code: 'ENOENT'});
    assert.deepEqual(report.preservedLocalConfig, []);
  }
});

test('invalid inherited identity or library-version values fail before replacing the output', async t => {
  const f = await fixture(t);
  const config = await f.read('project.config.json');
  const originalGame = await fs.readFile(path.join(f.output, 'game.js'));
  for (const invalid of [{appid: {}}, {appid: 'bad\nidentifier'}, {libVersion: []}, {libVersion: '../outside'}]) {
    await f.write('project.config.json', {...config, ...invalid});
    await assert.rejects(f.build({overwrite: true}), /格式错误/);
    assert.deepEqual(await fs.readFile(path.join(f.output, 'game.js')), originalGame);
  }
});
