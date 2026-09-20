#!/bin/zsh
set -e
cd -- "$(dirname -- "$0")"

fail() {
  print -r -- "$1"
  read -r '?按回车结束'
  exit 1
}

if ! command -v node >/dev/null || ! command -v npm >/dev/null; then
  fail '需要 Node.js 22 或更新版本及 npm；请先安装后重试。'
fi
if ! node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)'; then
  fail '当前 Node.js 版本低于 22，请更新后重试。'
fi
if [[ ! -d node_modules ]]; then
  print -r -- "项目目录：$PWD"
  fail '缺少本地依赖。请在上面的目录执行 npm ci，然后重新双击本脚本。'
fi

print '将保存的真实 Construct HTML5 导出转换为抖音小游戏工程。'
read -r 'c3_douyin_app_id?输入你的抖音 AppID（留空取消）：'
if [[ -z "$c3_douyin_app_id" ]]; then
  print '已取消，未修改构建产物。'
  exit 0
fi
if ! npm run export:douyin -- --appid "$c3_douyin_app_id"; then
  fail '构建失败，请根据上面的错误信息修复后重试。'
fi
print -r -- "工程目录：$PWD/dist/construct-douyin"
print '请将该目录导入抖音小游戏开发者工具。构建成功不代表 IDE 或真机运行已通过。'
read -r '?按回车结束'
