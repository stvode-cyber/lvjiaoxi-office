# 关键决策台账

> 记录所有影响项目方向/架构/规范的决策。每条含：选了啥、为啥、备选方案、关联文件。
> 格式：`---` 分隔每条，时间倒序追加。

---

## [2026-09-15] Promise 永不 settle 三级保险策略

- **选了啥**：IndexedDB/tasks.js 所有 await 链加 timeout + 自动降级 localStorage + 全局 60s 兜底
- **为啥**：Promise 永不 settle 已复发 2 次（auth.js boot hang + store.put 95% hang），根因是 IndexedDB 等事件驱动 API 的 transaction oncomplete/onerror 理论上可同时不触发；任何外部 API Promise 都不能假设"一定会 settle"
- **备选方案**：只加 catch （不够——没有 error，只是永不 settle）；只加局部 timeout （不够——Tasks.run 链本身也要）
- **三级保险具体实现**：
  1. **openDB**：3s timeout + onblocked → reject
  2. **tx() 路径**：5s `_withTimeout` + `_autoFailover()` → 切 localStorage 模式（永久降级，重启后自动恢复 IndexedDB）
  3. **Tasks.run**：全局 60s `_wrap` → 任务失败退出 + toast 提示
- **关联文件**：app/js/store.js / app/js/tasks.js / app/js/auth.js
- **决策人**：AI + 用户反馈卡死

---

## [2026-09-15] Git 协议统一 HTTPS

- **选了啥**：所有远端仓库 URL 强制使用 HTTPS，禁用 SSH
- **为啥**：Windows 环境 SSH 密钥配置繁琐，HTTPS + PAT 更稳
- **备选方案**：SSH（已排除，密钥丢失率高）
- **关联**：AGENTS.md / MEMORY.md / .gitconfig / release.yml

---

## [2026-09-15] 版本号铁律：四端强制同步

- **选了啥**：源码常量 / UI 显示 / 安装包属性 / 更新通道 版本号一字不差
- **为啥**：作为排查问题的唯一标尺，防止"我这台正常你那台崩"
- **备选方案**：各模块独立版本（已排除，对账地狱）
- **关联**：package.json / src/constants.js / release.yml / installer.nsi / 更新服务器元数据

---

## [2026-09-15] BYOK 密钥仅存 localStorage

- **选了啥**：用户自定义 AI API Key 明文存 localStorage，不上云、不进仓库
- **为啥**：合规第一，密钥泄露后果不可接受
- **备选方案**：后端加密存储（已排除，服务器也可能泄露 + 增加服务端成本）
- **关联**：src/os/ai.js / src/settings/provider.js

---

## [2026-09-15] PDF 深色主题限制作用域

- **选了啥**：PDF 模块深色变量挂在 `.pdf-toolbox-root` 下，不污染全局浅色 token
- **为啥**：应用默认主题为浅色，深色是可选切换，全局变量会冲突 Writer/Sheet 等
- **备选方案**：全局双主题（已排除，工程量大 3 倍+ 回归成本高）
- **关联**：src/modules/pdf/style.css

---

## [2026-09-15] 历史版本快照存 IndexedDB

- **选了啥**：OS.Versions API，单文档最多 50 快照，自动 30s 间隔 + 2s debounce
- **为啥**：避免频繁 IO 阻塞主线程，同时满足撤销回退需求
- **备选方案**：内存环形缓冲（已排除，刷新即丢）/ 本地文件（已排除，跨平台权限）
- **关联**：src/os/store.js / src/os/versions.js

---

## [2026-09-15] AI 块级编辑嵌入工具栏而非外挂聊天框

- **选了啥**：Writer/Sheet/Presentation/Mindmap/PDF 各模块工具栏内嵌 AI 面板
- **为啥**：对标 GenOffice 模式，避免焦点漂移，"选字 → 改字"一个视线完成
- **备选方案**：右侧外挂侧边栏（已排除，遮挡内容 + 视线跳跃）
- **关联**：src/modules/*/toolbar.js / src/components/ai-panel.js

---

## [2026-09-15] 应用内自动更新走 VPS 源

- **选了啥**：更新检查走 lujax.fun VPS，不走 GitHub Releases
- **为啥**：GitHub API 有速率限制 + 国内访问不稳定
- **备选方案**：GitHub Releases + CDN 镜像（已排除，实测 30% 用户拉不到）
- **关联**：electron/main.js / src/updater.js / release.yml
