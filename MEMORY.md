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
- 工程交接：`.workbuddy/handoff-2026-09-04.md`（最新，v1.0.16 · 92 套件 91 通过 · 四端同源 · GitHub 已推 · 含 E2E 测试 + PDF 转换改进；§6.1 两项卡点：① 发布到 VPS 待用户侧 ② iOS/HarmonyOS 编译 · 原 §6.1② git remote 已解决）

---

## 三、当前基线（2026-09-04 更新）

- **92 套件 91 通过**（1 云服务偶发超时） + 四端同源 ✅ + GitHub 已推（`stvode-cyber/lvjiaoxi-office`，41 commit + 17 tag）
- E2E 测试已补（171 断言），PDF 转换改进（段落合并/列表检测/多级标题）
- 大型均已消解，Windows 安装包 v1.0.16 已重建
- 🟡 待办：发布到 VPS（用户侧 `publish-latest.bat`）、iOS/HarmonyOS 编译（需本地工具链）

> 变更详情见 [CHANGELOG.md](CHANGELOG.md)；状态总览见 [STATUS.md](STATUS.md)。
