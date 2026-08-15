#!/usr/bin/env bash
# 生产启动：后端 API + 钉钉机器人（静态托管 Web 构建产物）
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  echo "[start] 缺少 .env，请先复制 .env.example 并填写配置" >&2
  exit 1
fi

if [ ! -d apps/web/dist ]; then
  echo "[start] 未找到前端构建产物，请先执行: bash scripts/build.sh" >&2
  exit 1
fi

mkdir -p logs data/mock
export NODE_ENV=production
exec pnpm --filter @xiaosu/server start
