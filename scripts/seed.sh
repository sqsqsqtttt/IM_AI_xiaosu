#!/usr/bin/env bash
# 生成种子数据：mock 接口 JSON（按当前日期相对生成）+ PDF/DOCX/TXT 测试文档
set -euo pipefail
cd "$(dirname "$0")/.."

[ -d node_modules ] || pnpm install
pnpm exec tsx scripts/seed.ts
