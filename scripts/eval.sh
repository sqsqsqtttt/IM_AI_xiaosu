#!/usr/bin/env bash
# 运行 Evals 评测（20+ 条用例，需要 .env 中配置真实 LLM_API_KEY）
set -euo pipefail
cd "$(dirname "$0")/.."

[ -d node_modules ] || pnpm install
pnpm exec tsx evals/eval.ts
