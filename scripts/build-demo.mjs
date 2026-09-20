import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { convertProject } from '../src/build/convert.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const platform of ['douyin', 'wechat', 'tiktok']) {
  const report = await convertProject({ input: path.join(root, 'examples/smoke'), output: path.join(root, 'dist', platform), platform, entry: 'main.js', overwrite: true, experimental: platform === 'tiktok' });
  console.log(`示例已生成：${report.output}`);
}
