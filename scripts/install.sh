#!/usr/bin/env sh
# Legacy 手工安装脚本：把 dsh-outbound 复制进 DSH profile 的 node_modules。
#
# 【已不推荐】主流 DSH profile 的 node_modules 由 pnpm 管理。不在 profile
# package.json 依赖树里、且 pnpm-lock.yaml 没有记录的包，会在下一次
# pnpm install 时被移到 node_modules/.ignored 并删除（安装、升级、卸载任何
# 插件都会触发 pnpm install）。
#
# 请优先使用界面「添加插件」安装：
#   1) DSH 设置 → 插件（Plugins）→ 添加插件：填本仓库的本地目录绝对路径或 Git 地址；
#   2) 离线 / 固定版本：在仓库根目录 npm pack，然后把生成的 tgz 绝对路径
#      填进同一个「添加插件」对话框。
# 注意：桌面版 dsh plugin --profile desktop add 会执行 pnpm add 并 reconcile 依赖树
#（也能完成安装），但没有界面安装的预检与显式启用；安装请优先界面。
#
# 本脚本检测到 pnpm 管理的 profile 时会拒绝执行。确认 profile 不是 pnpm
# 管理时，用 --legacy（或设置 DSH_LEGACY=1）强制手工安装。
#
# 用法：
#   sh scripts/install.sh [--dry-run] [--legacy] [--no-backup]
# 环境变量：
#   DSH_PROFILE_DIR  profile 目录（默认 $HOME/.dsh/profiles/desktop）
#   DSH_LEGACY=1     等价于 --legacy
#   DRY_RUN=1        等价于 --dry-run
set -eu

PLUGIN_ID=dsh-outbound
SRC=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
PROFILE_DIR="${DSH_PROFILE_DIR:-$HOME/.dsh/profiles/desktop}"
DRY_RUN="${DRY_RUN:-0}"
LEGACY=0
NO_BACKUP=0

usage() {
    cat <<'USAGE'
用法: sh scripts/install.sh [选项]
  --dry-run    只打印将要执行的动作，不写文件
  --legacy     强制在 pnpm 管理的 profile 上手工安装（不推荐）
  --no-backup  不备份 cordis.patch.yml
  -h, --help   显示帮助
环境变量: DSH_PROFILE_DIR / DSH_LEGACY=1 / DRY_RUN=1
USAGE
}

for arg in "$@"; do
    case "$arg" in
        --dry-run) DRY_RUN=1 ;;
        --legacy) LEGACY=1 ;;
        --no-backup) NO_BACKUP=1 ;;
        -h|--help) usage; exit 0 ;;
        *) echo "未知参数: $arg" >&2; usage >&2; exit 2 ;;
    esac
done
if [ "${DSH_LEGACY:-0}" = "1" ]; then LEGACY=1; fi

if [ ! -f "$SRC/package.json" ]; then
    echo "找不到插件源码：$SRC/package.json" >&2
    exit 1
fi
name=$(sed -n 's/.*"name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$SRC/package.json" | head -n 1)
if [ "$name" != "$PLUGIN_ID" ]; then
    echo "package.json 的 name 是 '$name'，不是 '$PLUGIN_ID'。" >&2
    exit 1
fi
if [ ! -d "$PROFILE_DIR" ]; then
    echo "找不到 DSH profile 目录：$PROFILE_DIR（先打开一次 DeepSeek Harness Desktop 初始化 profile）" >&2
    exit 1
fi

# ---- 检测 profile 是否由 pnpm 管理 ----
pnpm_markers=""
if [ -f "$PROFILE_DIR/pnpm-lock.yaml" ]; then
    pnpm_markers="$pnpm_markers pnpm-lock.yaml"
fi
if [ -d "$PROFILE_DIR/node_modules/.pnpm" ]; then
    pnpm_markers="$pnpm_markers node_modules/.pnpm"
fi
if [ -f "$PROFILE_DIR/package.json" ] && grep -q '"dependencies"' "$PROFILE_DIR/package.json" 2>/dev/null; then
    pnpm_markers="$pnpm_markers package.json"
fi

if [ -n "$pnpm_markers" ] && [ "$LEGACY" = "0" ]; then
    echo ""
    echo "检测到 profile 由 pnpm 管理（$pnpm_markers）。" >&2
    echo "手工复制到 node_modules 的包会在下一次 pnpm install 时被清理。" >&2
    echo "" >&2
    echo "请改用界面「添加插件」安装：" >&2
    echo "  1) DSH 设置 → 插件（Plugins）→ 添加插件：填本地目录绝对路径或 Git 地址" >&2
    echo "  2) 离线 / 固定版本：npm pack 后把 tgz 绝对路径填进同一个对话框" >&2
    echo "注意：dsh plugin --profile desktop add 会 pnpm add 并 reconcile 依赖树，但没有界面安装的预检与显式启用。" >&2
    echo "" >&2
    echo "确认 profile 不是 pnpm 管理时，加 --legacy（或设置 DSH_LEGACY=1）强制执行本脚本。" >&2
    exit 1
fi
if [ -n "$pnpm_markers" ] && [ "$LEGACY" = "1" ]; then
    echo "警告：profile 由 pnpm 管理（$pnpm_markers），--legacy 安装可能在下次 pnpm install 时被清理。" >&2
fi

TARGET="$PROFILE_DIR/node_modules/$PLUGIN_ID"
PATCH="$PROFILE_DIR/cordis.patch.yml"

if [ "$DRY_RUN" = "1" ]; then
    echo "[DryRun] 源目录 : $SRC"
    echo "[DryRun] profile: $PROFILE_DIR"
    echo "[DryRun] 目标   : $TARGET"
    echo "[DryRun] patch  : $PATCH"
    echo "[DryRun] 将复制 lib/、package.json、README.md、CHANGELOG.md、LICENSE"
    echo "[DryRun] 将追加 dsh-outbound insert 配置块（若尚未存在）"
    exit 0
fi

# ---- 复制插件文件 ----
mkdir -p "$TARGET"
cp -R "$SRC/lib" "$TARGET/"
cp "$SRC/package.json" "$SRC/README.md" "$SRC/CHANGELOG.md" "$SRC/LICENSE" "$TARGET/"
echo "已复制插件文件到 $TARGET"

# ---- 追加 profile patch ----
BLOCK=$(cat <<'YAML'

# --- dsh-outbound: 全局出站代理（手工安装） ---
- insert:
    - id: dsh-outbound
      name: dsh-outbound
      config:
        enabled: true
        mode: system
        proxy: ''
        keepModelDirect: true
        noProxy: []
        emergencyDirectHosts: []
        fallbackToDirect: false
        probeUrl: https://www.gstatic.com/generate_204
        pollIntervalMs: 2000
        probeIntervalMs: 5000
        probeTimeoutMs: 2500
YAML
)

if [ -f "$PATCH" ] && grep -q -E '^[[:space:]]*-?[[:space:]]*id:[[:space:]]*dsh-outbound[[:space:]]*$' "$PATCH"; then
    echo "cordis.patch.yml 里已有 dsh-outbound 配置行，跳过追加。"
else
    if [ ! -f "$PATCH" ]; then
        : > "$PATCH"
    elif [ "$NO_BACKUP" = "0" ]; then
        cp "$PATCH" "$PATCH.bak-$(date +%Y%m%d-%H%M%S)"
        echo "已备份 patch：$PATCH.bak-$(date +%Y%m%d-%H%M%S)"
    fi
    printf '%s\n' "$BLOCK" >> "$PATCH"
    echo "已追加 dsh-outbound 配置块到 cordis.patch.yml。"
fi

echo ""
echo "已安装 $PLUGIN_ID -> $TARGET"
echo "后续步骤："
echo "  1. 完全退出并重新打开 DeepSeek Harness Desktop。"
echo "  2. 在 设置 → 通用 确认出现「出站代理」并检查策略状态。"
echo "  3. 如果 profile 由 pnpm 管理，请改用界面「添加插件」安装（见 README「安装」）。"
