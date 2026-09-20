import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { inside, writeJSON } from './files.mjs';
import { inspectProject } from './inspect.mjs';
import { disableMainWorker, adaptConstructStorage } from './patch.mjs';
import { engineScopeBuildOptions } from './engine-scope.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const outputMarker = '.c3-minigame-output.json';

export async function convertProject({ input, output, platform, appId = '', entry, experimental = false, overwrite = false, orientation = 'portrait' }) {
  if (!['douyin', 'wechat'].includes(platform)) throw new Error('platform 必须是 douyin 或 wechat');
  if (!['portrait', 'landscape'].includes(orientation)) throw new Error('orientation 必须是 portrait 或 landscape');
  if (typeof appId !== 'string' || /[\r\n\0]/.test(appId)) throw new Error('AppID 格式错误');
  const inspection = await inspectProject(input, { entry });
  if (!inspection.canBuild) throw new Error(inspection.findings.filter(f => f.level === 'error').map(f => f.message).join('\n'));
  if (inspection.format.startsWith('construct') && !experimental) throw new Error('检测到 Construct 导出；此转换路径尚未通过真机验收，请阅读兼容说明后添加 --experimental');
  const destination = path.resolve(output);
  const parent = path.dirname(destination);
  await fs.mkdir(parent, { recursive: true });
  const realDestination = path.join(await fs.realpath(parent), path.basename(destination));
  if (inside(inspection.root, realDestination) || inside(realDestination, inspection.root)) throw new Error('输出目录不能与输入目录相同、互相包含或通过符号链接重叠');
  let exists = false;
  try {
    const stat = await fs.lstat(destination);
    exists = true;
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('输出位置必须是普通目录');
    if (!overwrite) throw new Error('输出目录已存在；可用 --overwrite 覆盖本工具生成的目录');
    let marker;
    try { marker = JSON.parse(await fs.readFile(path.join(destination, outputMarker), 'utf8')); } catch { throw new Error('拒绝覆盖非本工具生成的目录'); }
    if (marker.tool !== 'construct3-minigame-adapter') throw new Error('输出目录标记不匹配，拒绝覆盖');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }

  const staging = await fs.mkdtemp(path.join(parent, '.c3-build-'));
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'c3-compile-'));
  let committed = false;
  try {
    for (const file of inspection.files) {
      if (/\.(?:html?|css|m?js|map)$/i.test(file) || /(?:^|\/)(?:offline\.json|manifest\.json)$/i.test(file)) continue;
      const target = path.join(staging, 'game', file);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.copyFile(path.join(inspection.root, file), target);
    }

    const patchSummary = [];
    const compile = async (file, worker = false) => {
      const result = await build({
        entryPoints: [path.join(inspection.root, file)], bundle: true, write: false,
        format: 'iife', platform: 'browser', target: ['es2020'], charset: 'utf8',
        legalComments: 'inline', minify: false, sourcemap: false, logLevel: 'silent',
        plugins: [{ name: 'c3-bootstrap-and-local-imports', setup(builder) {
          builder.onResolve({ filter: /^(?:https?:\/\/|\/\/)/ }, args => ({ errors: [{ text: `远程模块必须先本地化：${args.path}` }] }));
          builder.onResolve({ filter: /.*/ }, args => {
            if (!args.importer) return;
            if (!args.path.startsWith('.') && !path.isAbsolute(args.path)) return { errors: [{ text: `Worker 包含未打包的外部依赖：${args.path}` }] };
            if (!inside(inspection.root, path.resolve(path.dirname(args.importer), args.path))) return { errors: [{ text: `Worker 模块引用超出导出目录：${args.path}` }] };
          });
          builder.onLoad({ filter: /.*/, namespace: 'file' }, async args => {
            const resolved = await fs.realpath(args.path);
            if (!inside(inspection.root, resolved)) return { errors: [{ text: `拒绝加载导出目录外脚本：${args.path}` }] };
            if (!/\.[cm]?js$/.test(args.path)) return;
            const source = await fs.readFile(args.path, 'utf8');
            const patched = worker ? { code: source, count: 0 } : disableMainWorker(source);
            if (patched.count) patchSummary.push({ file: path.relative(inspection.root, args.path), mainWorkerProperties: patched.count });
            return { contents: patched.code, loader: 'js', resolveDir: path.dirname(args.path) };
          });
        } }]
      });
      return result.outputFiles[0].text;
    };

    const jsFiles = inspection.files.filter(f => /\.m?js$/i.test(f) && !inspection.ignoredScripts.includes(f) && !/^(?:sw|register-sw|workermain)\.js$/i.test(path.basename(f)));
    const moduleLines = [];
    const workerLines = [];
    for (const file of jsFiles) {
      const isWorker = /(?:^|\/)(?:dispatchworker|jobworker|opus-decoder-worker)\.js$/i.test(file) || /(?:^|\/)workers\//.test(file);
      if (isWorker) {
        const compiled = await compile(file, true);
        workerLines.push(`${JSON.stringify(file)}: function(scope) {\nconst self=scope, globalThis=scope, postMessage=scope.postMessage.bind(scope), importScripts=scope.importScripts.bind(scope), addEventListener=scope.addEventListener.bind(scope), removeEventListener=scope.removeEventListener.bind(scope);\n${compiled}\n}`);
      } else moduleLines.push(`${JSON.stringify(file)}: () => require(${JSON.stringify(path.join(inspection.root, file))})`);
    }

    const entryCode = `import { installAdapter } from ${JSON.stringify(path.join(projectRoot, 'src/runtime/index.js'))};
import { createModuleLoader } from ${JSON.stringify(path.join(projectRoot, 'src/runtime/module-loader.js'))};
import { createWorkerCompatibility } from ${JSON.stringify(path.join(projectRoot, 'src/runtime/worker.js'))};
import { createWasmCompatibility } from ${JSON.stringify(path.join(projectRoot, 'src/runtime/wasm.js'))};
import { createRuntimeReadiness } from ${JSON.stringify(path.join(projectRoot, 'src/runtime/readiness.js'))};
import { createPlatformStorage } from ${JSON.stringify(path.join(projectRoot, 'src/runtime/storage.js'))};
const modules = {${moduleLines.join(',\n')}};
const workers = {${workerLines.join(',\n')}};
const baseURL = 'https://c3-minigame.invalid/game/';
globalThis.WebAssembly = createWasmCompatibility({nativeWebAssembly: globalThis.WebAssembly, platformWebAssembly: globalThis.WXWebAssembly || globalThis.TTWebAssembly, api: globalThis[${JSON.stringify(platform === 'wechat' ? 'wx' : 'tt')}], assetRoot: 'game', wasmFiles: ${JSON.stringify(inspection.files.filter(f => /\.wasm(?:\.br)?$/i.test(f)))}});
const loader = createModuleLoader(modules, { baseURL });
const adapter = installAdapter({ platform: ${JSON.stringify(platform)}, assetRoot: 'game', autoClaimMainCanvas: ${!inspection.format.startsWith('construct')}, loadScript: src => loader.load(src) });
globalThis.__C3MiniGameStorage = createPlatformStorage({api: adapter.api});
const workerCompat = createWorkerCompatibility(workers, { baseURL, globals: { fetch: globalThis.fetch, navigator: globalThis.navigator, console: globalThis.console } });
globalThis.Worker = workerCompat.Worker;
globalThis.MessageChannel = workerCompat.MessageChannel;
globalThis.MessagePort = workerCompat.MessagePort;
globalThis.__C3MiniGameAdapter = adapter;
__c3NativeHost.__C3MiniGameAdapter = adapter;
const readiness = createRuntimeReadiness();
globalThis.__C3MiniGameReady = readiness.promise;
readiness.promise.then(() => { console.info('[C3 MiniGame] Construct runtime-ready'); readiness.dispose(); }, () => { readiness.dispose(); });
globalThis.__C3MiniGameLoaded = (async () => {
  for (const entry of ${JSON.stringify(inspection.entries.map(e => e.path))}) {
    if (${JSON.stringify(inspection.bootstrapEntries)}.includes(entry)) {
      if (globalThis.C3_IsSupported !== true) throw new Error('Construct supportcheck rejected this host; inspect WebGL, WebAssembly and Intl support');
      adapter.claimMainCanvas();
    }
    await loader.load(entry);
    readiness.attach(globalThis.RuntimeInterface);
  }
  document.dispatchEvent({ type: 'DOMContentLoaded' });
  globalThis.dispatchEvent?.(new globalThis.Event('load'));
  return adapter;
})();
globalThis.__C3MiniGameLoaded.catch(error => { readiness.reject(error); console.error('[C3 MiniGame] 入口加载失败:', error?.message || String(error)); });
__c3NativeHost.__C3MiniGameLoaded = globalThis.__C3MiniGameLoaded;
`;
    const bootFile = path.join(scratch, 'entry.mjs');
    await fs.writeFile(bootFile, entryCode);
    const realBootFile = await fs.realpath(bootFile);
    const realRuntimeRoot = await fs.realpath(path.join(projectRoot, 'src/runtime'));
    const realURLPolyfillRoot = await fs.realpath(path.join(projectRoot, 'node_modules/core-js-pure'));
    await build({ entryPoints: [bootFile], outfile: path.join(staging, 'game.js'), bundle: true, format: 'cjs', platform: 'neutral', target: ['es2020'], charset: 'utf8', minify: false, legalComments: 'inline', logLevel: 'silent',
      ...engineScopeBuildOptions(platform),
      plugins: [{ name: 'local-project-modules', setup(builder) {
        builder.onResolve({ filter: /^(?:https?:\/\/|\/\/)/ }, args => ({ errors: [{ text: `远程模块必须先本地化：${args.path}` }] }));
        builder.onResolve({ filter: /.*/ }, args => {
          if (!args.importer || !inside(inspection.root, args.importer)) return;
          if (!args.path.startsWith('.') && !path.isAbsolute(args.path)) return { errors: [{ text: `导出脚本包含未打包的外部依赖：${args.path}` }] };
          if (!inside(inspection.root, path.resolve(path.dirname(args.importer), args.path))) return { errors: [{ text: `模块引用超出导出目录：${args.path}` }] };
        });
        builder.onLoad({ filter: /.*/, namespace: 'file' }, async args => {
          const resolved = await fs.realpath(args.path);
          if (resolved === path.join(realURLPolyfillRoot, 'internals/global-this.js')) {
            // The wrapper supplies the exact engine realm. Avoid core-js's legacy
            // Function('return this') fallback, which mini-game code must not need.
            return {contents: 'module.exports = globalThis;', loader: 'js'};
          }
          if (resolved === realBootFile || inside(realRuntimeRoot, resolved) || inside(realURLPolyfillRoot, resolved)) return;
          if (!inside(inspection.root, resolved)) return { errors: [{ text: `拒绝加载导出目录外脚本：${args.path}` }] };
          if (!/\.[cm]?js$/.test(args.path)) return;
          const source = await fs.readFile(args.path, 'utf8');
          const patched = disableMainWorker(source);
          const storage = adaptConstructStorage(patched.code);
          if (patched.count || storage.count) patchSummary.push({ file: path.relative(inspection.root, args.path), mainWorkerProperties: patched.count, nativeStorageAssignments: storage.count });
          return { contents: storage.code, loader: 'js', resolveDir: path.dirname(args.path) };
        });
      } }]
    });
    const gameConfig = { deviceOrientation: orientation, networkTimeout: { request: 15000, downloadFile: 30000, connectSocket: 15000, uploadFile: 30000 } };
    if (platform === 'douyin') gameConfig.showStatusBar = false;
    const projectConfig = { appid: appId, projectname: `c3-minigame-${platform}`, compileType: 'game', setting: { es6: false, minified: false, urlCheck: true } };
    if (platform === 'wechat') projectConfig.miniprogramRoot = './';
    await writeJSON(path.join(staging, 'game.json'), gameConfig);
    await writeJSON(path.join(staging, 'project.config.json'), projectConfig);
    const report = {
      tool: 'construct3-minigame-adapter', version: '0.1.0', platform, output: destination,
      sourceFormat: inspection.format, generatedAt: new Date().toISOString(),
      validation: 'build-only-not-device-verified', deviceVerified: false,
      appIdConfigured: Boolean(appId), entryPoints: inspection.entries, modules: moduleLines.length,
      inlineWorkers: workerLines.length, workerExecution: 'same-thread-asynchronous',
      patches: [...new Map(patchSummary.map(p => [p.file, p])).values()], findings: inspection.findings,
      remainingChecks: ['填写自己的平台 AppID', '在对应开发者工具中导入并编译', '验证真机启动、渲染、触摸、音频和前后台切换', '按项目需要配置域名、分包、登录及广告']
    };
    await writeJSON(path.join(staging, 'BUILD-REPORT.json'), report);
    await writeJSON(path.join(staging, outputMarker), { tool: report.tool, version: report.version });
    await fs.copyFile(path.join(projectRoot, 'docs/THIRD_PARTY_NOTICES.md'), path.join(staging, 'THIRD_PARTY_NOTICES.md'));
    await fs.writeFile(path.join(staging, 'README.txt'), `这是 ${platform} 小游戏构建产物。\n请在对应开发者工具中导入本目录，填写自己的 AppID。\n本次仅验证了构建结构，未完成真机验证；具体见 BUILD-REPORT.json。\nWorker 为同线程兼容实现，不支持跨线程加速。\n`);

    if (exists) {
      const backup = `${destination}.backup-${Date.now()}`;
      await fs.rename(destination, backup);
      try { await fs.rename(staging, destination); committed = true; }
      catch (error) { await fs.rename(backup, destination); throw error; }
      await fs.rm(backup, { recursive: true });
    } else { await fs.rename(staging, destination); committed = true; }
    return report;
  } finally {
    await fs.rm(scratch, { recursive: true, force: true });
    if (!committed) await fs.rm(staging, { recursive: true, force: true });
  }
}
