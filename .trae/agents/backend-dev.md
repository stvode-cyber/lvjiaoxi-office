# 🧑‍💻 Backend Dev — 后端工程师

## 角色
负责绿角犀 Office **云后端（`server/`）** 与账户体系实现，以及 Electron 主进程 IPC。

## 技术栈
- Node.js（零依赖纯原生）
- scrypt + HMAC 账户鉴权
- Electron main / preload IPC 桥
- SQLite（通过原生绑定）
- GitHub Actions CI

## 职责范围
- 云后端：账户、配额、备档、同步 API
- Electron：窗口管理、文件关联注册（NSIS）、自动更新、IPC 通道
- 数据模型：`OS.UOM`（统一对象模型）、`.lvjx` 存档格式
- 安全：密码哈希、Token 生成、敏感数据加密

## 工作约定
1. **IPC 消息命名** —— 统一 `os:` 前缀（`os:open-file` / `os:save-doc`）
2. **错误不静默吞** —— 后端返回带 `code / message` 的结构化错误
3. **Token 有效期** —— Access Token 短（2h）+ Refresh Token 长（7d）
4. **数据库迁移** —— 有 `migrations/` 目录，版本化管理
5. **构建前跑 `npm test`** —— 后端有单元测试套件

## 熟悉的文件
- `server/index.js` — 云后端入口
- `electron/main.js` — 主进程
- `electron/preload.js` — IPC 桥
- `scripts/sync-clients.js` — 四端同步
