import fs from 'node:fs/promises';
import path from 'node:path';

export function inside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

export async function walkFiles(root) {
  const files = [];
  async function visit(dir) {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      if (['node_modules', '.git', '.DS_Store'].includes(entry.name)) continue;
      const absolute = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`不接受符号链接，以免复制工程外文件：${absolute}`);
      if (entry.isDirectory()) await visit(absolute);
      else if (entry.isFile()) files.push(path.relative(root, absolute).split(path.sep).join('/'));
    }
  }
  await visit(root);
  return files.sort();
}

export function safeRelative(value, name = '路径') {
  if (typeof value !== 'string' || !value || value.includes('\0')) throw new Error(`${name}不能为空`);
  const normalized = value.replaceAll('\\', '/').replace(/^\.\//, '');
  if (normalized.startsWith('/') || /^[a-z]+:/i.test(normalized) || normalized.split('/').includes('..')) {
    throw new Error(`${name}必须是工程内的相对路径：${value}`);
  }
  return normalized;
}

export async function writeJSON(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}
