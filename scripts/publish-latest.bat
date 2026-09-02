@echo off
chcp 65001 >nul
REM ============================================================
REM  绿角犀 Office · Windows 一键发布 1.0.16 安装包到 VPS
REM  双击本文件即可（需已安装 Git for Windows，含 bash）
REM  脚本会自动：设 host=8.149.245.252 / user=root / key=~/.ssh/id_ed25519_rcprod
REM  SSH find 定位远端 releases 目录，上传 Setup 1.0.16.exe + latest.yml + .blockmap
REM ============================================================
cd /d "%~dp0.."
where bash >nul 2>nul
if errorlevel 1 (
  echo [错误] 未找到 bash，请先安装 Git for Windows（https://git-scm.com）
  echo        安装时勾选 "Git Bash" 与 "Add to PATH"。
  pause
  exit /b 1
)
echo [发布] 开始上传 dist/ 到 https://lujax.fun/releases ...
bash "scripts/publish-latest.sh" %*
set RC=%errorlevel%
if %RC%==0 (
  echo [完成] 1.0.16 已发布，旧客户端将拉 latest.yml 走应用内自动更新。
) else (
  echo [失败] 发布脚本退出码 %RC%。请确认本机可直连 VPS 8.149.245.252:22。
)
pause
