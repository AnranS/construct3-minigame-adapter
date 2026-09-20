import fs from 'node:fs/promises';
import {constants} from 'node:fs';
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
const toolName = 'construct3-minigame-adapter';
const platforms = ['douyin', 'wechat', 'tiktok'];
const validAppId = value => typeof value === 'string' && !/[\r\n\0]/.test(value);

// Read only ordinary local JSON files; never follow a symlink into another
// project. Invalid saved configuration stops before replacing the old output.
async function readOutputJSON(directory, name, optional = false) {
  const filename = path.join(directory, name);
  let stat;
  try { stat = await fs.lstat(filename); }
  catch (error) {
    if (optional && error.code === 'ENOENT') return undefined;
    throw new Error(`拒绝覆盖：无法读取 ${name}`);
  }
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`拒绝覆盖：${name} 必须是普通 JSON 文件，不能是符号链接`);
  let handle;
  try { handle = await fs.open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW || 0)); }
  catch { throw new Error(`拒绝覆盖：无法安全读取 ${name}`); }
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.size > 1024 * 1024) throw new Error(`拒绝覆盖：${name} 不是有效的本地配置文件`);
    let value;
    try { value = JSON.parse(await handle.readFile('utf8')); }
    catch { throw new Error(`拒绝覆盖：${name} 必须是有效 JSON 对象`); }
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`拒绝覆盖：${name} 必须是有效 JSON 对象`);
    return value;
  } finally { await handle.close(); }
}

async function readPreservedConfig(destination, marker, platform, appId) {
  let previousPlatform = marker.platform;
  if (previousPlatform === undefined) {
    // Releases before platform-aware markers recorded it in their build report.
    const report = await readOutputJSON(destination, 'BUILD-REPORT.json', true);
    if (report?.tool === toolName && platforms.includes(report.platform)) previousPlatform = report.platform;
  }
  if (previousPlatform !== platform) return {};
  const config = await readOutputJSON(destination, 'project.config.json', true);
  const saved = {};
  if (appId === undefined && config?.appid !== undefined) {
    if (!validAppId(config.appid)) throw new Error('拒绝覆盖：已有 appid 格式错误');
    saved.appid = config.appid;
  }
  if (config?.libVersion !== undefined) {
    if (typeof config.libVersion !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9.+_-]{0,63}$/.test(config.libVersion)) throw new Error('拒绝覆盖：已有 libVersion 格式错误');
    saved.libVersion = config.libVersion;
  }
  saved.privateConfig = await readOutputJSON(destination, 'project.private.config.json', true);
  return saved;
}

export async function convertProject({ input, output, platform, appId, entry, experimental = false, overwrite = false, orientation = 'portrait' }) {
  if (!platforms.includes(platform)) throw new Error('platform 必须是 douyin、wechat 或 tiktok');
  if (!['portrait', 'landscape'].includes(orientation)) throw new Error('orientation 必须是 portrait 或 landscape');
  if (appId !== undefined && !validAppId(appId)) throw new Error('AppID 格式错误');
  if (platform === 'tiktok' && !experimental) throw new Error('TikTok Native 转换尚未通过 DevTool 与真机验收；必须显式添加 --experimental');
  const inspection = await inspectProject(input, { entry });
  if (!inspection.canBuild) throw new Error(inspection.findings.filter(f => f.level === 'error').map(f => f.message).join('\n'));
  if (inspection.format.startsWith('construct') && !experimental) throw new Error('检测到 Construct 导出；此转换路径尚未通过真机验收，请阅读兼容说明后添加 --experimental');
  const destination = path.resolve(output);
  const parent = path.dirname(destination);
  await fs.mkdir(parent, { recursive: true });
  const realDestination = path.join(await fs.realpath(parent), path.basename(destination));
  if (inside(inspection.root, realDestination) || inside(realDestination, inspection.root)) throw new Error('输出目录不能与输入目录相同、互相包含或通过符号链接重叠');
  let exists = false, preservedConfig = {};
  try {
    const stat = await fs.lstat(destination);
    exists = true;
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('输出位置必须是普通目录');
    if (!overwrite) throw new Error('输出目录已存在；可用 --overwrite 覆盖本工具生成的目录');
    const marker = await readOutputJSON(destination, outputMarker);
    if (marker.tool !== toolName || marker.platform !== undefined && !platforms.includes(marker.platform)) throw new Error('输出目录标记不匹配，拒绝覆盖');
    preservedConfig = await readPreservedConfig(destination, marker, platform, appId);
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const effectiveAppId = appId ?? preservedConfig.appid ?? '';

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

    const platformAPIExpression = platform === 'tiktok' ? 'globalThis.TTMinis?.game' : `globalThis[${JSON.stringify(platform === 'wechat' ? 'wx' : 'tt')}]`;
    // TikTok documents the native TTMinis.game namespace, not a TTWebAssembly alias.
    // Preserve only a real standard WebAssembly namespace until its alternative
    // namespace/signature is documented and verified for this target.
    const platformWasmExpression = platform === 'tiktok' ? 'undefined' : platform === 'wechat' ? 'globalThis.WXWebAssembly' : 'globalThis.TTWebAssembly';
    const entryCode = `import { installAdapter } from ${JSON.stringify(path.join(projectRoot, 'src/runtime/index.js'))};
import { createModuleLoader } from ${JSON.stringify(path.join(projectRoot, 'src/runtime/module-loader.js'))};
import { createWorkerCompatibility } from ${JSON.stringify(path.join(projectRoot, 'src/runtime/worker.js'))};
import { createWasmCompatibility } from ${JSON.stringify(path.join(projectRoot, 'src/runtime/wasm.js'))};
import { createRuntimeReadiness } from ${JSON.stringify(path.join(projectRoot, 'src/runtime/readiness.js'))};
import { createPlatformStorage } from ${JSON.stringify(path.join(projectRoot, 'src/runtime/storage.js'))};
const modules = {${moduleLines.join(',\n')}};
const workers = {${workerLines.join(',\n')}};
const baseURL = 'https://c3-minigame.invalid/game/';
globalThis.WebAssembly = createWasmCompatibility({nativeWebAssembly: globalThis.WebAssembly, platformWebAssembly: ${platformWasmExpression}, api: ${platformAPIExpression}, assetRoot: 'game', wasmFiles: ${JSON.stringify(inspection.files.filter(f => /\.wasm(?:\.br)?$/i.test(f)))}});
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
    // TikTok's public native debugging guide confirms these filenames and appid,
    // but does not specify Douyin/WeChat IDE settings or orientation fields.
    // Do not invent a compatible schema by copying another platform's settings.
    // https://developers.tiktok.com/docs/en/debug-your-mini-game
    const gameConfig = platform === 'tiktok' ? {} : { deviceOrientation: orientation, networkTimeout: { request: 15000, downloadFile: 30000, connectSocket: 15000, uploadFile: 30000 } };
    if (platform === 'douyin') gameConfig.showStatusBar = false;
    const projectConfig = platform === 'tiktok' ? {appid: effectiveAppId} : { appid: effectiveAppId, projectname: `c3-minigame-${platform}`, compileType: 'game', setting: { es6: false, minified: false, urlCheck: true } };
    if (platform === 'wechat') projectConfig.miniprogramRoot = './';
    if (preservedConfig.libVersion !== undefined) projectConfig.libVersion = preservedConfig.libVersion;
    await writeJSON(path.join(staging, 'game.json'), gameConfig);
    await writeJSON(path.join(staging, 'project.config.json'), projectConfig);
    if (preservedConfig.privateConfig !== undefined) await writeJSON(path.join(staging, 'project.private.config.json'), preservedConfig.privateConfig);
    const report = {
      tool: 'construct3-minigame-adapter', version: JSON.parse(await fs.readFile(path.join(projectRoot, 'package.json'), 'utf8')).version, platform, output: destination,
      sourceFormat: inspection.format, generatedAt: new Date().toISOString(),
      validation: 'build-only-not-device-verified', deviceVerified: false,
      appIdConfigured: Boolean(effectiveAppId), entryPoints: inspection.entries, modules: moduleLines.length,
      preservedLocalConfig: [
        ...(preservedConfig.appid !== undefined ? ['appid'] : []),
        ...(preservedConfig.libVersion !== undefined ? ['libVersion'] : []),
        ...(preservedConfig.privateConfig !== undefined ? ['project.private.config.json'] : [])
      ],
      inlineWorkers: workerLines.length, workerExecution: 'same-thread-asynchronous',
      patches: [...new Map(patchSummary.map(p => [p.file, p])).values()], findings: inspection.findings,
      remainingChecks: ['填写自己的平台 AppID', '在对应开发者工具中导入并编译', '验证真机启动、渲染、触摸、音频和前后台切换', '按项目需要配置域名、分包、登录及广告']
    };
    if (platform === 'tiktok') {
      report.nativeNamespace = 'TTMinis.game';
      report.nativeInitialization = 'not-required';
      report.contractSources = ['https://developers.tiktok.com/docs/en/mini-games-sdk-overview', 'https://developers.tiktok.com/docs/en/debug-your-mini-game', 'https://developers.tiktok.com/docs/en/mini-games-sdk-render-and-canvas'];
      report.packageConstraints = {mainPackageMB: 4, totalPackageMB: 30, subpackagesGenerated: false, validation: 'TikTok DevTool pre-check required'};
      report.configuration = {mode: 'minimal-public-contract', requestedOrientation: orientation, orientationApplied: false, appIdMeaning: 'TikTok mini-game App ID (not the client key)'};
      report.limitations = [
        'TikTok DevTool and TikTok app execution have not been verified.',
        'Only game.js, game.json and project.config.json/appid are confirmed by the public package guide; additional game configuration and orientation require DevTool review.',
        'No subpackages are generated; all output files belong to the main package and must meet TikTok package-size limits.',
        'Only genuine standard WebAssembly is preserved; no WeChat or Douyin WASM namespace is used for TikTok.',
        'The public Canvas contract documents WebGL 1.0; WebGL 2 and complete Construct rendering require device validation.'
      ];
      report.remainingChecks = ['填写 TikTok Mini Game App ID（不是 client key）', '从本目录运行 ttmg dev，并按提示单独填写 client key', '核对 game.json 中方向及其他项目配置，执行 DevTool 代码与包体预检查', '用已加入测试名单的 TikTok 账号在真机检查启动、渲染、输入、资源、存储和音频', '按实际游戏流程接入并验收登录、广告及平台要求的能力'];
      report.findings = [...report.findings, {level: 'warning', code: 'TIKTOK_CONFIGURATION_REVIEW', message: 'TikTok 使用最小公开配置；--orientation 未写入尚未确认的配置字段，请在 DevTool 核对。'}];
    }
    await writeJSON(path.join(staging, 'BUILD-REPORT.json'), report);
    await writeJSON(path.join(staging, outputMarker), { tool: report.tool, version: report.version, platform });
    await fs.copyFile(path.join(projectRoot, 'docs/THIRD_PARTY_NOTICES.md'), path.join(staging, 'THIRD_PARTY_NOTICES.md'));
    await fs.writeFile(path.join(staging, 'README.txt'), platform === 'tiktok'
      ? `TikTok Native 实验性代码包（TTMinis.game，无需 SDK init）。\n填写 project.config.json 的 appid 为 TikTok Mini Game App ID，然后在此目录运行 ttmg dev；首次提示的 client key 单独填写。\n尚未通过 DevTool 和 TikTok 真机验收。game.json 为最小配置；--orientation 未应用，请在 DevTool 核对完整配置及主包大小。\nWorker 为同线程兼容实现；WASM 仅保留真正的标准 WebAssembly。完整限制与官方来源见 BUILD-REPORT.json。\n`
      : `这是 ${platform} 小游戏构建产物。\n请在对应开发者工具中导入本目录，填写自己的 AppID。\n本次仅验证了构建结构，未完成真机验证；具体见 BUILD-REPORT.json。\nWorker 为同线程兼容实现，不支持跨线程加速。\n`);

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
