# FD-06-client · 客户端与交付

## 说明
多端客户端交付：Windows / Android / PWA 已可用；iOS / HarmonyOS 为源码工程（编译上架为人工项）。四端同源。

## 注释（细节 · 坑）
- Windows 安装包：NSIS 写入注册表（文件关联 .pdf/.ofd/.lvjx/.docx/.xlsx/.pptx + 默认打开），双击经 argv/second-instance 捕获路径 → IPC 推前端打开；全自动更新（启动检查+后台自动下载+退出自动装，generic feed 接 lujax.fun/releases）。
- Android APK 需 SDK/gradle，本环境无 → 阻塞（未伪造）。
- iOS / HarmonyOS 编译需 Mac / DevEco + 签名证书 + 隐私页，人工项。
- 沙箱到 VPS 无网络出口，发布上传须在能连 VPS 的机器跑 `bash scripts/publish-latest.sh`。

## 目标（对应 G / VG）
- **G**：多端交付（桌面/移动/Web）。
- **VG**：四端同源。

## 关联（↔报错 / ↔决策 / ↔动作）
- ↔A Windows 文件关联（bump 1.0.3）/ 全自动更新（bump 1.0.15，见 `FD-07-release`）；模块总纲 `模块/06_客户端与交付_总纲.md`
- ↔E 沙箱连不上 VPS（SSH 22/备用端口全超时，仅代理 HTTP 出口）→ 发布须用户侧机器
