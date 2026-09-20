#!/bin/zsh
set -e
cd -- "$(dirname -- "$0")"
if [[ ! -d node_modules ]]; then npm ci; fi
npm run verify
read -r '?验证完成，按回车结束'
