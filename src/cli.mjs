#!/usr/bin/env node
import { parseArgs } from 'node:util';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { inspectProject } from './build/inspect.mjs';
import { convertProject } from './build/convert.mjs';

export async function main(args = process.argv.slice(2)) {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: {
    input: { type: 'string', short: 'i' }, output: { type: 'string', short: 'o' },
    platform: { type: 'string', short: 'p' }, appid: { type: 'string' }, entry: { type: 'string' },
    orientation: { type: 'string', default: 'portrait' }, experimental: { type: 'boolean', default: false },
    overwrite: { type: 'boolean', default: false }, json: { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h' }
  } });
  const command = positionals[0];
  if (values.help || !command) { console.log(help); return; }
  const input = values.input || positionals[1];
  if (!input) throw new Error('需要 --input 导出目录');
  if (command === 'inspect') {
    const report = await inspectProject(input, { entry: values.entry });
    if (values.json) console.log(JSON.stringify(report, null, 2));
    else {
      console.log(`格式：${report.format}\n文件：${report.files.length}\n体积：${(report.totalBytes / 1024 / 1024).toFixed(2)} MiB`);
      for (const finding of report.findings) console.log(`[${finding.level}] ${finding.code}: ${finding.message}`);
      console.log(`结构检查：${report.canBuild ? '可进入构建' : '需要修复'}；真机验证：未完成`);
    }
    if (!report.canBuild) process.exitCode = 2;
    return;
  }
  if (command === 'convert') {
    if (!values.output || !values.platform) throw new Error('convert 需要 --output 和 --platform douyin|wechat|tiktok');
    const report = await convertProject({ input, output: values.output, platform: values.platform, appId: values.appid,
      entry: values.entry, orientation: values.orientation, experimental: values.experimental, overwrite: values.overwrite });
    console.log(values.json ? JSON.stringify(report, null, 2) : `已生成 ${report.platform} 工程：${report.output}\n验证状态：${report.validation}\n请阅读构建目录内 BUILD-REPORT.json。`);
    return;
  }
  throw new Error(`未知命令：${command}`);
}

const help = `Construct 3 微信 / 抖音 / TikTok Native 小游戏适配工具

node src/cli.mjs inspect --input ./exports/game
node src/cli.mjs convert --input ./exports/game --output ./dist/wechat --platform wechat --appid 你的AppID --experimental
node src/cli.mjs convert --input ./exports/game --output ./dist/douyin --platform douyin --appid 你的AppID --experimental
node src/cli.mjs convert --input ./exports/game --output ./dist/tiktok --platform tiktok --appid 你的TikTokMiniGameAppID --experimental

--entry 路径      不读取 index.html，直接使用本地 JS 入口
--orientation    portrait 或 landscape，默认 portrait
                 TikTok 未确认方向配置字段，此选项仅记录在报告中，不自动写入
--experimental   接受 Construct 引擎兼容性尚未经真机验证；TikTok 总是必需
--overwrite      仅允许覆盖本工具以前生成的目录
                 同平台覆盖保留已有 AppID、libVersion 和私有配置；显式 --appid 优先
--json           输出 JSON 报告

TikTok 使用 TTMinis.game 原生运行时；appid 是 Mini Game App ID，不是 client key。
转换后在 TikTok 输出目录运行 ttmg dev，并按提示单独填写 client key。
本工具不会登录开发者平台或上传项目。先用 npm run build:demo 验证适配层。`;

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => { console.error(`错误：${error.message}`); process.exitCode = 1; });
}
