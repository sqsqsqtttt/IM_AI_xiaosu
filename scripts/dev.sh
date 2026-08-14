#!/usr/bin/env bash
# 一键启动开发环境：后端 API + 钉钉机器人 (3000) 与 Web 前端 (5173)
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v pnpm >/dev/null 2>&1; then
  echo "[dev] 未找到 pnpm，请先执行: npm install -g pnpm" >&2
  exit 1
fi

if [ ! -f .env ]; then
  cp .env.example .env
  echo "[dev] 已从 .env.example 创建 .env，请填写 DeepSeek / 钉钉密钥后重启"
fi

[ -d node_modules ] || pnpm install
mkdir -p logs data/mock

trap 'echo "[dev] 停止所有进程..."; kill 0' EXIT INT TERM

pnpm --filter @xiaosu/server dev &
pnpm --filter @xiaosu/web dev &

echo "[dev] 后端: http://localhost:3000  |  前端: http://localhost:5173"
wait
