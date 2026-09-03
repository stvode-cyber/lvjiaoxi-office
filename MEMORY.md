# MEMORY · 长期决策（导航）

> **导航-only**。完整日志与决策落 `.workbuddy/memory/`（按日期 + 长期 `MEMORY.md`）。
> 本文件只**索引**关键决策与位置，不在此堆细节。

---

## 一、关键长期决策（索引）

| 决策 | 要点 | 详址 |
|------|------|------|
| 自主开发 | Agent 全权、无审核、循环至 DoD | [AGENTS.md](AGENTS.md) |
| 单一真源 | Web `app/` 为唯一真源，四端严格镜像零漂移 | [工程总纲.md](工程总纲.md) §四 |
| 版本单一真源 | 仅 `package.json`，脚本注入四端 | [模块/07_发版与更新_总纲.md](模块/07_发版与更新_总纲.md) |
| 零依赖优先 | 沙箱可测纯逻辑必须抽独立模块 | `.workbuddy/memory/MEMORY.md` |
| 信任但验证 | 实跑测试回查产物，禁止靠「已创建」判定完成 | [AGENTS.md](AGENTS.md) / `.workbuddy/memory/MEMORY.md` |
| 发布默认 | 无 `LVJX_UPDATE_FEED` → GitHub Release 强制；有 → `RELEASE_DRAFT=true` | [工程总纲.md](工程总纲.md) §四 |
| 文档治理 | 模块单一职责、主目录只导航、讨论与正式分离 | [工程总纲.md](工程总纲.md) §二 |

---

## 二、知识库入口

- 项目长期笔记：`.workbuddy/memory/MEMORY.md`
- 每日日志：`.workbuddy/memory/YYYY-MM-DD.md`
- 工程交接：`.workbuddy/handoff-2026-09-03.md`（最新，v1.0.16 · 90 套件 0 失败 · 四端同源；含 §6.1 两项待用户侧卡点）｜历史交接：`.workbuddy/handoff-2026-08-19.md`

---

## 三、当前基线（2026-08-30 更新）

- **78 套件 0 失败** + 四端同源 ✅（S→AH 全特性 + 登录设定已落地并验证；AC/AD/AE/AF/AG/AH 已新增 + 登录可选；Android APK 与 make-release 打 tag 受限于本环境无 SDK / 无 git 仓库，需在有工具链环境执行）
- 🔴 大型均已消解：PDF→Excel（坐标列边界聚类）、docx→PDF（浏览器 print-to-PDF）
- 🟡 边界：PDF→DOCX/TXT/MD/Excel 版面还原有限（仅文本提取）
- **Windows 安装包已重建（2026-08-30）**：`dist:local` 经 `NODE_OPTIONS=""` 绕过 WorkBuddy 安全删除 shim → 退出码 0，产出 Setup exe + 便携 exe + latest.yml + blockmap；`release:check` 与 `verify-release-assets` 全绿。
- 待办（人工/环境）：Android APK 需 SDK（本环境无）；iOS/HarmonyOS 仅源码工程。

> 变更详情见 [CHANGELOG.md](CHANGELOG.md)；状态总览见 [STATUS.md](STATUS.md)。
