#!/usr/bin/env bash
# 构建：全量类型检查 + Web 前端产物
set -euo pipefail
cd "$(dirname "$0")/.."

[ -d node_modules ] || pnpm install

echo "[build] 类型检查 (core/db/server/bot/web/tests)..."
for p in packages/core packages/db apps/server apps/bot apps/web .; do
  pnpm exec tsc -p "$p"
  echo "  ✓ $p"
done

echo "[build] 构建 Web 前端..."
pnpm --filter @xiaosu/web exec vite build

echo "[build] 完成。生产启动: bash scripts/start.sh"
