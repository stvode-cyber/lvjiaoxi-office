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
- 工程交接：`.workbuddy/handoff-2026-09-08.md`（最新，v1.0.17 · 99 套件 0 失败 · 四端同源 · GitHub 已推 · 含业务五板块 + 测试环境修复；卡点：① 发布到 VPS 待用户侧 ② iOS/HarmonyOS 编译）

---

## 三、当前基线（2026-09-08 更新）

- **100 套件 0 失败**（批量操作后门禁）+ 四端同源 ✅ + GitHub 已推（`stvode-cyber/lvjiaoxi-office`，tag v1.0.17）
- 业务板块已上线：顶部导航五板块（工作台/订单/库存/审批/我的），订单/库存/审批本地 CRUD + CSV 导出 + **批量操作**（biz-common 共享工具条；订单/库存批量删除；审批批量通过/驳回/删除）
- 测试环境已修复：jsdom/jszip 改为项目 devDependency（原外部路径随环境迁移丢失）
- 🟡 待办：发布 v1.0.17 到 VPS（用户侧 `publish-latest.bat`）、iOS/HarmonyOS 编译（需本地工具链）

> 变更详情见 [CHANGELOG.md](CHANGELOG.md)；状态总览见 [STATUS.md](STATUS.md)。
