#!/usr/bin/env bash
# 一键启动开发环境：后端 API + 钉钉机器人 (3000) 与 Web 前端 (5173)
set -euo pipefail
cd "$(dirname "$0")/.."

# 启动失败时：打印原因；若在交互窗口里运行，停留等待按键（避免闪退看不到报错）
die() {
  echo "[dev] 启动失败: $*" >&2
  if [ -t 0 ]; then
    echo "[dev] 按回车关闭窗口..."
    read -r _ || true
  fi
  exit 1
}

if ! command -v pnpm >/dev/null 2>&1; then
  die "未找到 pnpm，请先执行: npm install -g pnpm"
fi

if netstat -ano 2>/dev/null | grep -q ':3000 .*LISTENING'; then
  die "端口 3000 已被占用 —— 小苏似乎已经在运行。如需重启：先按 Ctrl+C 停止旧窗口"
fi

if [ ! -f .env ]; then
  cp .env.example .env
  echo "[dev] 已从 .env.example 创建 .env，请填写 DeepSeek / 钉钉密钥后重启"
fi

[ -d node_modules ] || pnpm install
mkdir -p logs data/mock

pnpm --filter @xiaosu/server dev &
SERVER_PID=$!
pnpm --filter @xiaosu/web dev &
WEB_PID=$!

# 停止时只杀本次启动的两个子进程树（Windows 用 taskkill /T 带出整棵树），
# 绝不再向自己发信号，避免重复触发导致刷屏。
stopped=0
stop() {
  if [ "$stopped" = "1" ]; then
    return
  fi
  stopped=1
  echo ""
  echo "[dev] 停止所有进程..."
  taskkill //F //T //PID "$SERVER_PID" >/dev/null 2>&1 || true
  taskkill //F //T //PID "$WEB_PID" >/dev/null 2>&1 || true
}
trap stop EXIT INT TERM

echo "[dev] 后端: http://localhost:3000  |  前端: http://localhost:5173"
echo "[dev] 停止请按 Ctrl+C（只会看到一条停止提示）"
wait
