#!/usr/bin/env bash
# 运行自动化测试（含 Mock LLM 离线用例）
set -euo pipefail
cd "$(dirname "$0")/.."

[ -d node_modules ] || pnpm install
pnpm exec vitest run
