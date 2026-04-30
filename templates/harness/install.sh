#!/usr/bin/env bash
# 把 VibeSpace 的 harness 配置（6 skill + 7 agent + 2 dev/ 文档）安装到目标项目。
# 用法：bash templates/harness/install.sh <target_project_path>
# 已存在同名文件会跳过 + 列出冲突清单（不会覆盖你已有的）。
#
# **同步提醒**：本脚本是命令行入口；server 端有等价实现
# `packages/server/src/harness-template-service.ts`（VibeSpace UI 调它）。
# 加新模板文件 / 改文件清单时**两边都要改**——它们是两份独立实现（bash vs TS）。

set -e

TARGET="${1:-}"
if [ -z "$TARGET" ]; then
  echo "用法：$0 <target_project_path>"
  exit 2
fi

if [ ! -d "$TARGET" ]; then
  echo "ERROR: 目标目录不存在：$TARGET"
  exit 1
fi

# SRC = 仓库根 = 本脚本所在 templates/harness/ 的两级父目录
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$(cd "$SCRIPT_DIR/../.." && pwd)"

# 校验 SRC 长得像 VibeSpace 仓库
if [ ! -d "$SRC/.aimon/skills" ] || [ ! -d "$SRC/.claude/agents" ]; then
  echo "ERROR: 当前 SRC ($SRC) 看起来不像 VibeSpace 仓库根（找不到 .aimon/skills 或 .claude/agents）"
  exit 1
fi

TARGET="$(cd "$TARGET" && pwd)"
echo "[harness-install] SRC=$SRC"
echo "[harness-install] TARGET=$TARGET"

mkdir -p "$TARGET/.aimon/skills" "$TARGET/.claude/agents" "$TARGET/dev"

CONFLICTS=()
COPIED=0

copy_if_absent() {
  local src_file="$1"
  local dst_file="$2"
  if [ -e "$dst_file" ]; then
    CONFLICTS+=("$dst_file")
    return
  fi
  cp "$src_file" "$dst_file"
  COPIED=$((COPIED + 1))
}

# .aimon/skills/*.md
for f in "$SRC/.aimon/skills/"*.md; do
  [ -e "$f" ] || continue
  copy_if_absent "$f" "$TARGET/.aimon/skills/$(basename "$f")"
done

# .claude/agents/*.md
for f in "$SRC/.claude/agents/"*.md; do
  [ -e "$f" ] || continue
  copy_if_absent "$f" "$TARGET/.claude/agents/$(basename "$f")"
done

# dev/ 两份文档
copy_if_absent "$SRC/dev/harness-roadmap.md" "$TARGET/dev/harness-roadmap.md"
copy_if_absent "$SRC/dev/agent-team-blueprint.md" "$TARGET/dev/agent-team-blueprint.md"

# 改造清单放在显眼位置
copy_if_absent "$SCRIPT_DIR/CUSTOMIZE.md" "$TARGET/.aimon/CUSTOMIZE-harness.md"

# .gitignore 追加 .aimon/runtime/（不是 ignore 整个 .aimon——skills/ agents/ 该入库）
if [ -f "$TARGET/.gitignore" ]; then
  if ! grep -qE '^\.aimon/runtime/?$' "$TARGET/.gitignore"; then
    echo "" >> "$TARGET/.gitignore"
    echo "# Harness runtime prompts (generated per-session, ignore)" >> "$TARGET/.gitignore"
    echo ".aimon/runtime/" >> "$TARGET/.gitignore"
    echo "[harness-install] .gitignore: 追加 .aimon/runtime/"
  fi
else
  echo ".aimon/runtime/" > "$TARGET/.gitignore"
  echo "[harness-install] 创建 .gitignore（含 .aimon/runtime/）"
fi

echo ""
echo "============================================"
echo "[harness-install] 复制完成：$COPIED 个文件"

if [ ${#CONFLICTS[@]} -gt 0 ]; then
  echo "[harness-install] 跳过（目标已存在，未覆盖）：${#CONFLICTS[@]} 个"
  for c in "${CONFLICTS[@]}"; do
    echo "  - $c"
  done
  echo ""
  echo "→ 想覆盖请手动 diff + 删除目标文件再跑一遍"
fi

echo ""
echo "下一步必读："
echo "  $TARGET/.aimon/CUSTOMIZE-harness.md"
echo ""
echo "改造完后启动一次 claude session，Task 工具菜单应能看到 vibespace-*"
echo "（建议改名成你项目代号前缀，如 myproj-*）"
echo "============================================"
