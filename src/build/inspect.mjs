import fs from 'node:fs/promises';
import path from 'node:path';
import { parse as parseHTML } from 'parse5';
import { parse as parseJS } from 'acorn';
import { safeRelative, walkFiles } from './files.mjs';

const fileProtocolMessage = "Web exports won't work until you upload them. (When running on the file: protocol, browsers block many features from working for security reasons.)";

// Match the complete, inert browser-only diagnostic from the Construct export.
// Every node is constrained so additional statements or executable expressions
// cannot disappear along with an otherwise matching diagnostic.
function isConstructFileProtocolDiagnostic(source) {
  try {
    const ast = parseJS(source, { ecmaVersion: 'latest', sourceType: 'script' });
    if (ast.body.length !== 1) return false;
    const statement = ast.body[0];
    if (statement.type !== 'IfStatement' || statement.alternate !== null) return false;
    const condition = statement.test;
    const literal = (node, value) => node?.type === 'Literal' && node.value === value;
    const identifier = (node, name) => node?.type === 'Identifier' && node.name === name;
    const member = (node, property) => node?.type === 'MemberExpression' && !node.computed && !node.optional && identifier(node.property, property);
    if (condition.type !== 'BinaryExpression' || condition.operator !== '===' || !literal(condition.right, 'file')) return false;
    const call = condition.left;
    if (call.type !== 'CallExpression' || call.optional || call.arguments.length !== 2 || !literal(call.arguments[0], 0) || !literal(call.arguments[1], 4)) return false;
    if (!member(call.callee, 'substr') || !member(call.callee.object, 'protocol') || !identifier(call.callee.object.object, 'location')) return false;
    const body = statement.consequent;
    if (body.type !== 'BlockStatement' || body.body.length !== 1 || body.body[0].type !== 'ExpressionStatement') return false;
    const alert = body.body[0].expression;
    return alert.type === 'CallExpression' && !alert.optional && identifier(alert.callee, 'alert') && alert.arguments.length === 1 && literal(alert.arguments[0], fileProtocolMessage);
  } catch {
    return false;
  }
}

export async function inspectProject(input, { entry } = {}) {
  const root = await fs.realpath(path.resolve(input));
  if (!(await fs.stat(root)).isDirectory()) throw new Error('输入必须是解压后的导出目录');
  const files = await walkFiles(root);
  const findings = [];
  const entries = [];
  const ignoredScripts = [];
  if (entry) {
    const relative = safeRelative(entry, '入口');
    if (!files.includes(relative)) throw new Error(`入口不存在：${relative}`);
    entries.push({ path: relative, type: 'module' });
  } else {
    if (!files.includes('index.html')) throw new Error('没有 index.html；请指定 --entry 相对入口路径');
    const html = parseHTML(await fs.readFile(path.join(root, 'index.html'), 'utf8'));
    const visit = node => {
      if (node.tagName === 'script') {
        const attrs = Object.fromEntries((node.attrs || []).map(a => [a.name, a.value]));
        if (attrs.type && !['module', 'text/javascript', 'application/javascript'].includes(attrs.type)) {
          if (attrs.type === 'importmap') findings.push({ level: 'error', code: 'IMPORT_MAP', message: '请先把 import map 依赖打包为本地相对模块' });
        } else if (attrs.src) {
          if (/^(?:https?:)?\/\//i.test(attrs.src)) {
            findings.push({ level: 'error', code: 'REMOTE_SCRIPT', message: `远程脚本需要先本地化：${attrs.src}` });
          } else {
            try {
              const source = safeRelative(decodeURIComponent(attrs.src.split(/[?#]/)[0]), 'HTML 脚本');
              if (/^(?:register-sw|sw|offlineclient)\.js$/i.test(path.basename(source))) ignoredScripts.push(source);
              else if (!files.includes(source)) findings.push({ level: 'error', code: 'MISSING_SCRIPT', message: `入口脚本不存在：${source}` });
              else entries.push({ path: source, type: attrs.type === 'module' ? 'module' : 'classic' });
            } catch (error) { findings.push({ level: 'error', code: 'SCRIPT_PATH', message: error.message }); }
          }
        } else {
          const text = (node.childNodes || []).map(n => n.value || '').join('').trim();
          if (text) {
            if (isConstructFileProtocolDiagnostic(text)) findings.push({ level: 'info', code: 'SKIP_FILE_PROTOCOL_DIAGNOSTIC', message: '跳过 Construct 导出页仅用于提示 file: 协议不可运行的内联诊断脚本' });
            else findings.push({ level: 'error', code: 'INLINE_SCRIPT', message: '请将 index.html 的内联脚本移入本地 .js 文件，再以 src 引用' });
          }
        }
      }
      for (const child of node.childNodes || []) visit(child);
    };
    visit(html);
  }
  let format = 'javascript-entry';
  const bootstrapEntries = [];
  const features = new Set();
  for (const file of files.filter(f => /\.(?:m?js)$/.test(f))) {
    const code = await fs.readFile(path.join(root, file), 'utf8');
    if (entries.some(e => e.path === file) && /RuntimeInterface/.test(code) && /runtimeMainScript|engineScripts/.test(code)) bootstrapEntries.push(file);
    if (/C3_SetInitFunctions/.test(code)) format = 'construct-modern';
    else if (format !== 'construct-modern' && /C3_CreateRuntime|C3_InitRuntime/.test(code)) format = 'construct-legacy';
    for (const [pattern, feature] of [
      [/\b(?:new\s+Worker|JobSchedulerDOM)\b/, 'workers'],
      [/\bAudioContext\b|\bwebkitAudioContext\b/, 'web-audio'],
      [/\bWebAssembly\b/, 'wasm'],
      [/\bindexedDB\b/, 'indexeddb'],
      [/\bcreateObjectURL\b/, 'blob-urls'],
      [/\bWebGPU\b|navigator\s*\.\s*gpu\b/, 'webgpu'],
      [/\beval\s*\(|new\s+Function\s*\(/, 'dynamic-code']
    ]) if (pattern.test(code)) features.add(feature);
  }
  for (const script of entries.filter(e => e.type === 'classic')) {
    const source = await fs.readFile(path.join(root, script.path), 'utf8');
    try {
      const ast = parseJS(source, { ecmaVersion: 'latest', sourceType: 'script' });
      let globalDeclaration = ast.body.some(node => ['VariableDeclaration', 'FunctionDeclaration', 'ClassDeclaration'].includes(node.type));
      const visit = node => {
        if (!node || typeof node !== 'object' || /^(?:Function|ArrowFunction|Class)/.test(node.type || '')) return;
        if (node.type === 'VariableDeclaration' && node.kind === 'var') globalDeclaration = true;
        for (const value of Object.values(node)) {
          if (Array.isArray(value)) value.forEach(visit);
          else if (value && typeof value === 'object') visit(value);
        }
      };
      visit(ast);
      if (globalDeclaration) findings.push({ level: 'error', code: 'CLASSIC_GLOBAL_SCOPE', message: `${script.path} 包含 classic 脚本全局声明；请显式用 globalThis 暴露共享对象，或转换为 ES module 后再打包` });
    } catch (error) { findings.push({ level: 'error', code: 'SCRIPT_SYNTAX', message: `${script.path}: ${error.message}` }); }
  }
  if (format === 'javascript-entry' && files.some(f => /(?:^|\/)c3runtime\.js$/.test(f))) format = 'construct-unrecognized';
  if (!entries.length) findings.push({ level: 'error', code: 'NO_ENTRY', message: '未找到可执行的本地 JavaScript 入口' });
  if (format.startsWith('construct')) findings.push({ level: 'warning', code: 'EXPERIMENTAL_C3', message: 'Construct 引擎转换尚未通过目标平台真机验收；必须显式使用 --experimental' });
  for (const feature of features) findings.push({ level: 'warning', code: `FEATURE_${feature.toUpperCase().replaceAll('-', '_')}`, message: featureMessages[feature] });
  if (ignoredScripts.length) findings.push({ level: 'info', code: 'SKIP_SERVICE_WORKER', message: `小游戏不使用浏览器离线缓存，跳过：${ignoredScripts.join(', ')}` });
  let totalBytes = 0;
  for (const file of files) totalBytes += (await fs.stat(path.join(root, file))).size;
  return { root, format, entries, bootstrapEntries, ignoredScripts, files, totalBytes, features: [...features], findings, canBuild: !findings.some(f => f.level === 'error'), deviceVerified: false };
}

const featureMessages = {
  workers: '内部任务 Worker 使用同线程异步兼容实现，不能获得多线程加速。',
  'web-audio': '检测到 Web Audio 引用：基础 Audio 可桥接，AudioContext 效果链等需单独验证。',
  wasm: '检测到 WebAssembly：不同平台的 WASM 加载接口和编解码器需要实机验证。',
  indexeddb: '检测到 IndexedDB：当前适配层只桥接 localStorage，不模拟 IndexedDB。',
  'blob-urls': '检测到 Blob URL：小游戏文件/图片解码路径需要验证，不提供虚假的 Blob URL。',
  webgpu: '检测到 WebGPU：目标平台请使用 WebGL；不可假定 WebGPU 可用。',
  'dynamic-code': '检测到动态执行代码：平台可能禁止 eval/new Function，请检查实际调用路径。'
};
