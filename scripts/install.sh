#!/usr/bin/env sh
# dsh-outbound 一键安装脚本（方式一）—— macOS / Linux
#
# 用法（在仓库根目录）：
#   sh ./scripts/install.sh
#   DSH_PROFILE_DIR="$HOME/.dsh/profiles/desktop" sh ./scripts/install.sh
#   DRY_RUN=1 sh ./scripts/install.sh
#
# 它会做两件事：
#   1. 把 lib/、package.json 等复制到 <ProfileDir>/node_modules/dsh-outbound
#   2. 在 <ProfileDir>/cordis.patch.yml 末尾追加一条 dsh-outbound 配置行（已存在则跳过）

set -eu

PLUGIN_ID="dsh-outbound"
SRC=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
PROFILE_DIR="${DSH_PROFILE_DIR:-$HOME/.dsh/profiles/desktop}"
TARGET="$PROFILE_DIR/node_modules/$PLUGIN_ID"
PATCH="$PROFILE_DIR/cordis.patch.yml"

if [ ! -f "$SRC/package.json" ]; then
  echo "找不到 $SRC/package.json；请在仓库根目录执行脚本。" >&2
  exit 1
fi
NAME=$(sed -n 's/.*"name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$SRC/package.json" | head -n 1)
if [ "$NAME" != "$PLUGIN_ID" ]; then
  echo "package.json 里的 name 是 $NAME，不是 $PLUGIN_ID。" >&2
  exit 1
fi
if [ ! -d "$PROFILE_DIR" ]; then
  echo "profile 目录不存在：$PROFILE_DIR" >&2
  echo "先启动一次 DeepSeek Harness 桌面版，让它初始化 profile，再执行本脚本。" >&2
  exit 1
fi

echo "来源仓库 : $SRC"
echo "目标插件 : $TARGET"
echo "配置文件 : $PATCH"

if [ "${DRY_RUN:-0}" = "1" ]; then
  echo
  echo "[DryRun] 将复制：lib/ package.json README.md CHANGELOG.md LICENSE"
  echo "[DryRun] 若 cordis.patch.yml 没有 dsh-outbound 行，则追加一条 insert 行"
  exit 0
fi

mkdir -p "$TARGET"
for item in lib package.json README.md CHANGELOG.md LICENSE; do
  [ -e "$SRC/$item" ] && cp -R "$SRC/$item" "$TARGET/"
done
echo "已复制插件文件。"

BLOCK='# --- dsh-outbound: 全局出站代理（手工安装） ---
- insert:
    - id: dsh-outbound
      name: dsh-outbound
      config:
        enabled: true
        mode: system
        proxy: ""
        keepModelDirect: true
        noProxy: []
        emergencyDirectHosts: []
        fallbackToDirect: false
        probeUrl: https://www.gstatic.com/generate_204
        pollIntervalMs: 2000
        probeIntervalMs: 5000
        probeTimeoutMs: 2500'

if [ -f "$PATCH" ] && grep -q '^[[:space:]]*-[[:space:]]*id:[[:space:]]*dsh-outbound[[:space:]]*$' "$PATCH"; then
  echo "cordis.patch.yml 已包含 dsh-outbound 行，跳过追加（避免重复 id）。"
else
  if [ -f "$PATCH" ]; then
    cp "$PATCH" "$PATCH.bak-$(date +%Y%m%d-%H%M%S)"
    echo "已备份配置：$PATCH.bak-$(date +%Y%m%d-%H%M%S)"
  fi
  printf '\n%s\n' "$BLOCK" >> "$PATCH"
  echo "已追加 dsh-outbound 配置行到 cordis.patch.yml。"
fi

echo
echo "安装完成。接下来："
echo "  1. 打开 DSH 设置 → 通用，确认出现「出站代理」一栏；"
echo "  2. 没有出现就完全退出 DSH（含托盘）再重开；"
echo "  3. 打开系统代理，抓一次 https://www.google.com/robots.txt 验证走代理。"
