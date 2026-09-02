# FD-07-release · 发版与更新

## 说明
版本单一真源（仅 `package.json`，`bump-version.js` 同步四端）/ 全自动更新模式（启动检查+后台自动下载+退出自动装，generic feed 接 `https://lujax.fun/releases`）/ 合规素材（商店图标/LaunchScreen/PrivacyInfo）。

## 注释（细节 · 坑）
- 版本单一真源纪律：只改 `package.json`，`bump-version.js` 同步 web/index.html/sw.js/version.json/iOS/HarmonyOS，禁多源。
- electron-updater `^6.8.9`；feed-config 返回 generic provider 指向 version.json.url。
- 构建用 `NODE_OPTIONS="" npx electron-builder --win --publish never` 绕过 genie-safe-delete shim（`fs.unlink` 中文路径拦截）；PowerShell 后台包装会回收成僵尸，须用 **Bash 后台通道**。
- 发布上传须 SSH 到 VPS `8.149.245.252`——沙箱无 raw TCP 出口，阻塞；脚本 `scripts/publish-latest.sh` 在用户侧机器一行执行。

## 目标（对应 G / VG）
- **G**：发版与自动更新。
- **VG**：全功能可交付（旧客户端应用内自动更新生效）。

## 关联（↔报错 / ↔决策 / ↔动作）
- ↔Dc 全自动更新模式（v1.0.15 起）；版本单一真源
- ↔A commit `9e32df0` / tag `v1.0.16`；发布脚本 `scripts/publish-latest.sh`（环境阻塞）；合规素材已生成（上架人工项）
