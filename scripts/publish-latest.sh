#!/usr/bin/env bash
# 绿角犀 Office · 桌面端发布一键脚本
# 适用：在【能 SSH 连 lujax.fun VPS 的机器】上执行（如你本机 Git Bash / WSL）
# 前置：ssh / rsync / base64 可用，且已部署私钥 ~/.ssh/id_ed25519_rcprod
# 作用：把 dist/ 中 latest.yml 指向的最新版（nsis+便携+blockmap+latest.yml）上传到 VPS 的 releases 目录
#       远端目录留空时会由 publish-desktop-feed.js 自动 find 第一个 releases 目录
set -euo pipefail

# 切到脚本所在目录的上级（项目根），避免硬编码中文路径
cd "$(dirname "$0")/.."

# 以下三项可用环境变量覆盖；默认值取自历史部署记录
export LVJX_FEED_SSH_HOST="${LVJX_FEED_SSH_HOST:-8.149.245.252}"
export LVJX_FEED_SSH_USER="${LVJX_FEED_SSH_USER:-root}"
export LVJX_FEED_SSH_KEY="${LVJX_FEED_SSH_KEY:-$(base64 -w0 ~/.ssh/id_ed25519_rcprod)}"
# LVJX_FEED_SSH_REMOTE_DIR 留空 -> 自动定位远端 releases 目录

echo "[publish] 目标 host=${LVJX_FEED_SSH_HOST} user=${LVJX_FEED_SSH_USER}"
echo "[publish] 仅发布最新版（--latest-only）..."
node scripts/publish-desktop-feed.js --latest-only

echo "[publish] 完成。旧客户端将拉取 latest.yml 走应用内自动更新。"
