---
name: "growth-logger"
description: "成长型工作记录：台账自动写入 + 索引同步 + 会话交接。Invoke when 完成文件改动 / 遇到坑 / 做架构决策 / 会话结束 / 新 AI 接手。"
---

# 成长型工作记录（Growth Logger）

> **核心原则**：好记性不如烂笔头。AI 必须把每一次改动、每一个坑、每一个决策都写入台账——**临时换电脑 / 新 AI 接手时，5 分钟能读懂项目全貌。**

---

## 1. 台账体系全景（AI 必读）

项目已有 **4 层记录体系**，本 Skill 规定 **什么时候写、写在哪、写啥格式**。

### 1.1 台账文件地图

| 文件 | 位置 | 写入内容 | 频率 |
|------|------|----------|------|
| **issues.md** | `.trae/memory/台账/` | 踩坑台账：问题 / 解决 / 根因 / 预防 / 关联文件 | 每次遇到 bug/坑/报错 **立即写** |
| **decisions.md** | `.trae/memory/台账/` | 决策台账：选了啥 / 为啥 / 备选方案 | 每次做架构决策 **立即写** |
| **context.md** | `.trae/memory/台账/` | 项目全景：架构约束 / 技术栈版本 / 关键路径 | 低频（版本大跃迁时更新） |
| **index.md** | `.trae/memory/台账/` | **索引**：按模块分组的 [I] / [D] 快速跳转 | **每次写入 issues/decisions 后自动更新** |
| **weekly_YYYY-MM-DD.md** | `.trae/memory/台账/` | 本周汇总：完成了啥 / 测试数据 / 下一步 | 每轮工作结束（会话收尾）时写 |
| **AI交接_拉手.md** | 项目根目录 | 新 AI 5 分钟上手包（导航 + 当前状态快照） | 低频（版本/架构大跃迁时更新） |
| **handoff-YYYY-MM-DD.md** | `.workbuddy/` | 每次 AI 交接的完整工作明细 | 每次换 AI 时写（非本 Skill 管） |

### 1.2 写入格式（固定模板，AI 不用自由发挥）

**issues.md 条目**：
```markdown
---
## [严重度] [slug 关键词]

- **问题**：一句话描述现象
- **解决**：改了啥、怎么修的
- **根因**：为什么会发生（深层原因，不是表面）
- **预防**：下次怎么避免（具体规则，不是抽象）
- **关联文件**：绝对路径列表
- **首次踩坑**：YYYY-MM-DD
- **复发次数**：N（0 = 首次）
- **代码位置**：`path.js#L123-L145`（可选，具体到行）
```

**decisions.md 条目**：
```markdown
---
## [YYYY-MM-DD] 决策标题（一句话）

- **选了啥**：具体方案
- **为啥**：决策原因（不能只说"好"）
- **备选方案**：考虑过的其他选项 + 排除理由
- **关联文件**：绝对路径列表
- **决策人**：AI / 用户 / 讨论后共识
```

**index.md 条目**（写入 issues/decisions 后**自动追加一行**）：
```markdown
- [I] 坑标题 → issues.md#slug-keyword
- [D] 决策标题 → decisions.md#YYYY-MM-DD
```

**weekly_*.md 条目**：
```markdown
# 周工作汇总 YYYY-MM-DD ~ YYYY-MM-DD

## 本轮完成

| 模块 | 改动 | 测试 | 关联 issues |
|------|------|------|-------------|
| xxx | xxx | N/N 绿 | - |

## 新发现的坑 → issues.md#slug

（链接到 issues.md 对应条目）

## 下一步 TODO

1. xxx
2. xxx

## 基线指标

- 套件总数：101 / 通过 N / 失败 N
- 四端同步：✅ / ❌（IOS / HarmonyOS / Android）
- 版本号：X.Y.Z
```

---

## 2. 触发时机（MUST 级 · 强制不可跳过）

### 🔴 P0 级 — 必须立即触发

| 场景 | 写哪 | 怎么触发 |
|------|------|----------|
| **遇到 bug / 报错 / 坑** | `issues.md` | RunCommand 失败 / 测试挂 / 运行时抛异常 |
| **做架构决策**（改数据模型 / 换库 / 改接口契约） | `decisions.md` | Edit 涉及多文件改动或影响模块边界 |
| **新 AI 接手**（会话开始时） | health-check | 读取 index.md 最新条目 + 跑 `node scripts/run-tests.js -last 5` + 确认台账文件齐全 |

### 🟡 P1 级 — 本轮结束前触发

| 场景 | 写哪 | 怎么触发 |
|------|------|----------|
| **完成 ≥1 个文件改动**（本轮有 Edit 操作） | 自动扫描 diff 决定 | 会话收尾 / TodoWrite 最后一条标记 completed 时 |
| **完成 ≥1 个坑的修复** | `issues.md` | 修复完成 + 测试通过后 |
| **完成 ≥1 个新功能** | `decisions.md` + `weekly_*.md` | 功能验证全绿后 |
| **会话要结束 / 用户说"先这样"** | `weekly_*.md` | 所有 Todo 已完成 + 用户没新指令 |

### ⚪ P2 级 — 低频触发

| 场景 | 写哪 | 怎么触发 |
|------|------|----------|
| **版本号跃迁**（X.Y.Z → X.(Y+1).Z） | `AI交接_拉手.md` | bump-version 后 |
| **架构大重构** | `AI交接_拉手.md` + `context.md` | ≥5 个模块改动 + 新接口 |

---

## 3. 核心流程：每轮改动结束时做啥

```
每轮工作（完成 ≥1 个 Edit）
    │
    ├── [1] 跑测试 → 确认全绿
    │
    ├── [2] 扫描本轮所有 Edit
    │     for each 改动文件:
    │       ├── 有没有 bug fix？ → issues.md
    │       ├── 有没有新决策？ → decisions.md
    │       └── 有没有新坑？ → issues.md
    │
    ├── [3] 写入后，更新 index.md
    │     在对应模块组下追加一行
    │
    ├── [4] 会话要结束？
    │     └── 是 → 写 weekly_YYYY-MM-DD.md（汇总本轮）
    │
    └── [5] 用户说"继续"？
          └── 是 → 回到第 1 步下一轮
```

### 简化版（实际 AI 执行时可以浓缩成 3 步）

```
1. 跑测试 → 全绿
2. 有 bug 修复？→ issues.md。有决策？→ decisions.md。写入后更新 index.md
3. 会话结束？→ weekly_*.md 汇总
```

---

## 4. 新 AI 接手快速体检（5 分钟）

每轮新会话开始时，**必须先跑这个清单**，否则不要开始写代码：

```bash
# Step 1 — 环境健康检查
cd "d:\源码存档\绿角犀办公软件"
node --check app/js/modules/pdf-engine.js   # 语法检查（最大的模块）
node scripts/run-tests.js 2>&1 | Select-Object -Last 3   # 测试基线

# Step 2 — 台账快速扫描（3 个文件，总耗时 < 30 秒）
# Read  .trae/memory/台账/index.md           → 知道有哪些坑和决策
# Read  .trae/memory/台账/issues.md -First 30  → 最紧急的坑
# Read  .trae/memory/台账/decisions.md -First 30 → 关键架构决策

# Step 3 — AI交接_拉手.md（30 秒速读）
# Read  AI交接_拉手.md -TotalCount 80        → 导航 + 当前状态

# Step 4 — 明确"本轮目标"（不能写代码前没有方向）
# 如果用户没明确 → 主动问："要推哪个？"
# 如果用户明确 → 在 TodoWrite 里拆成 3-5 步
```

**为什么必须先体检？** 因为项目是**多人/多 AI 接力**，上一轮的坑你不知道、上一轮的决策你不理解、上一轮的改动你没验证——直接写代码等于在沙滩上建楼。

---

## 5. 台账写入示例（来自真实项目）

### issues.md 真实条目

```markdown
## [P0] [worker-inline-script] worker.min.js 被 script 标签直接加载到主线程

- **问题**：index.html 里写了 `<script src="worker.min.js">` 把 Web Worker 脚本当普通 JS 加载
- **解决**：移除那行 script 标签
- **根因**：worker-*.js 脚本里的 self.addEventListener('message', ...) 在主线程 context 下，self 不是 WorkerGlobalScope
- **预防**：任何 worker-*.js / *worker.min.js 绝对不能用 script src 直接加载
- **关联文件**：app/index.html
- **首次踩坑**：2026-09-16
- **复发次数**：1
```

### decisions.md 真实条目

```markdown
## [2026-09-15] Promise 永不 settle 三级保险策略

- **选了啥**：IndexedDB/tasks.js 所有 await 链加 timeout + 自动降级 localStorage + 全局 60s 兜底
- **为啥**：Promise 永不 settle 已复发 2 次，IndexedDB 等事件驱动 API transaction 理论上可同时不触发 oncomplete/onerror
- **备选方案**：只加 catch（不够——没有 error，只是永不 settle）
- **关联文件**：app/js/store.js / app/js/tasks.js / app/js/auth.js
- **决策人**：AI + 用户反馈卡死
```

### index.md 真实片段

```markdown
## PDF 工具箱

- [D] 深色主题 `.pdf-toolbox-root` 局部作用域 → decisions.md#2026-09-15
- [I] escapeHtml 转发 OS.util Node 环境 undefined → issues.md#2026-09-15
- [I] worker.min.js 被 script 标签加载到主线程 → issues.md#worker-inline-script
- [新] PDF→Excel 版面还原（detectTables 精细列边界 + XLSX 真表格） → issues.md#pdf-excel-layout
```

---

## 6. 什么情况下 **不** 写台账

| 情况 | 理由 |
|------|------|
| 纯参数微调（改个颜色值、改个 timeout 数字） | 改动太小，不值得占一条 |
| 文档改错字（错别字修复） | 同上 |
| 用户说"撤销刚才那个改动" | 改动被回滚，不算"已完成" |
| 还没跑测试就改了 | 改动还没验证，不算"已完成" |

---

## 7. 常见坑

| 坑 | 解法 |
|----|------|
| **台账写了但 index.md 忘更新** | 每次写入 issues/decisions 后，**立即**在 index.md 追加一行。可以在脑中默念"写台账 = 写正文 + 更索引" |
| **issues.md 写了"bug 已修复"但没写根因** | 根因是最重要的部分——下次换 AI 遇到同样问题，根因告诉他怎么预防 |
| **decisions.md 只写了"选了方案 A"没写备选 B/C** | 备选方案是架构知识——下次重构时知道哪些路是**已经被踩过的坑** |
| **新 AI 接手跳过体检直接写代码** | 至少花 30 秒跑 Step 1（语法检查 + 测试）。不验证环境 = 你之前的代码有可能挂了 |
| **weekly_*.md 写得太细（逐文件流水账）** | 不要贴 diff、不要贴命令输出。写"改了啥模块 + 核心改动 + 测试数据"就行 |

---

## 8. 台账自动脚本（可选）

项目已有两个 Node 脚本辅助台账流程：

| 脚本 | 时机 | 做啥 |
|------|------|------|
| `scripts/ledger-precheck.js` | **改前**（编辑文件前跑） | 读 issues.md → 展开关联文件 glob → 检查有没有 TODO 预防注释 → 缺就 exit 1 |
| `scripts/ledger-posthint.js` | **改后**（测试全绿后跑） | 读 git diff --name-only → 按路径归类模块 → 比对台账覆盖 → 建议写 issues/decisions（exit 2） |

**建议工作流**：
```
每轮改动结束 → 跑测试 → 跑 ledger-posthint.js → 如果 exit 2 有建议 → 补台账
```

用法：
```bash
node scripts/ledger-posthint.js                    # 读 git diff 未提交
node scripts/ledger-posthint.js --staged          # 读 git diff 已暂存
node scripts/ledger-posthint.js app/js/shell.js   # 直接给文件
```

---

## 9. 快速检查清单（每轮结束前过一遍）

```
[ ] 测试全绿（node scripts/run-tests.js 最后一行 N/N passed）
[ ] 本轮有没有 bug fix？→ issues.md 写了吗？
[ ] 本轮有没有新决策？→ decisions.md 写了吗？
[ ] index.md 更新了吗？（issues/decisions 新条目都有索引）
[ ] 会话要结束？→ weekly_*.md 写了吗？
[ ] 四端同步？（node scripts/sync-clients.js）
```

---

## 10. 端到端工作流示例

### 10.1 场景 A：新 AI 接手，发现拉手.md 过时

```
Step 1 — 健康检查
  node scripts/run-tests.js → 101/101 全绿 ✅
  node --check app/js/shell.js → OK

Step 2 — 台账扫描（30 秒）
  Read index.md → 发现 issues.md 已有 28 坑、decisions.md 已有 16 决策
  Read AI交接_拉手.md → 发现"PDF 批注 P2 未做"但 addVectorAnnotation 2026-09-01 就实现了

Step 3 — 写新坑 issues.md
  ## [P2] [ledger-info-stale] 拉手.md 过时信息误导新 AI
  - **根因**：台账自动触发机制缺失
  - **预防**：每完成一个 P0/P1/P2 任务后立即检查拉手.md 对应章节

Step 4 — 更新 index.md + 拉手.md

Step 5 — 写 weekly_*.md 汇总（会话收尾）
```

### 10.2 场景 B：加新功能 Ctrl+Tab 可视化弹窗

```
Step 1 — 健康检查 + 明确目标
  RunCommand 跑测试 → 101/101 基线稳
  TodoWrite: Ctrl+Tab 可视化弹窗（high）

Step 2 — 改代码（多文件 Edit）
  shell.js 加变量 + handler + 4 辅助函数
  style.css 加 14 行 .tab-switcher-* 样式

Step 3 — 测试全绿
  node scripts/run-tests.js → 101/101 ✅

Step 4 — ledger-posthint.js 改后扫
  node scripts/ledger-posthint.js → 61 文件自动归类 10 模块
  shell.js ✅ 台账已覆盖（但 handler 重写了 → 建议新决策）

Step 5 — 写台账 decisions.md
  ## [2026-09-23] Ctrl+Tab 可视化弹窗：按住选、松开切
  - **选了啥**：overlay DOM + _tswOpen/_tswMove/_tswCommit/_tswClose
  - **为啥**：WPS/Office/iTerm 都用"按住选、松开关"模式
  - **备选方案**：纯循环切换（已替换）

Step 6 — index.md +1 索引行

Step 7 — sync-clients.js + weekly_*.md（会话收尾）
```

### 10.3 场景 C：遇到 bug → 修 → 写台账 → 预防

```
Step 1 — 改快捷键 Ctrl+Tab 路由，第一次跑测试 FAIL
  node _shell_shortcuts_test.js → 38/39，Ctrl+R 断言 FAIL

Step 2 — Debug
  测试搜 'invoke("app:reload")'，但 shell.js 写的是 'global.electronAPI.invoke("app:reload")'
  字符串不匹配 ✗

Step 3 — 修完测试 + 全绿 ✅

Step 4 — 写 issues.md 新坑 [shortcut-test-fragile]
  - **根因**：快捷键测试全部用 src.includes() 字符串包含匹配
  - **预防**：升级到 jsdom 真实 KeyboardEvent 派发（P3 低优先级）

Step 5 — decisions.md +1（Ctrl+Tab 可视化方案选型）
       index.md +2 行（1 I + 1 D）
```

---

## 11. 与 ledger-precheck / ledger-posthint 脚本集成

### 11.1 两脚本定位差异

| 维度 | ledger-precheck.js | ledger-posthint.js |
|------|-------------------|-------------------|
| **时机** | 改前（编辑文件前） | 改后（测试全绿后） |
| **做啥** | 扫 issues.md 关联文件 → 检查有没有 TODO 预防注释 | 扫 git diff → 归类模块 → 比对台账覆盖 → 建议写台账 |
| **退出码** | 0=全OK / **1=有文件缺 TODO**（可 CI 阻断） | 0=全覆盖 / **2=有建议**（提醒但不阻断） |
| **输出** | `❌ app/js/store.js#L123 缺 TODO: [坑-indexeddb-timeout]` | `💭 44 个文件不在台账覆盖。要不要写一条？` |
| **AI 自动触发** | 不自动（改前 AI 主动跑） | 建议每轮测试全绿后跑 |

### 11.2 三个 exit code 语义

| 退出码 | 含义 | 场景 |
|--------|------|------|
| **0** | ✅ 全覆盖 | 所有改动都被现有台账覆盖，无需写新条目 |
| **2** | 💡 有建议（不带 --write） | 有 N 个模块不在台账覆盖 → 手动补 issues/decisions |
| **3** | ✍️ 写入成功但待补充（带 --write） | 自动在 decisions.md 追加极简模板 + index.md 索引 → 手动补"为啥"和"备选方案" |

**--write 模式做啥**：
- 自动在 `decisions.md` 末尾追加极简模板（日期 + 模块 + 文件列表）
- 自动在 `index.md` 对应位置追加 `- [D]` 索引行
- 状态标记为 `draft（待补充完整）`，提醒 AI 手动补全"为啥"和"备选方案"
- **不会自动写 issues.md**（根因和预防规则太复杂，自动生成会误导）

### 11.3 AI 应该怎么用

```
# 推荐集成点：Growth Logger Skill 第 3 步"核心流程"

每轮测试全绿后：
  node scripts/ledger-posthint.js app/js/shell.js 2>&1 | Select-Object -Last 10

  如果输出 ✅ 台账已覆盖 → 跳过台账写入
  如果输出 💡 有 N 个建议 → 补 issues/decisions

# 一键写入（自动写极简模板 + 索引，exit 3 待补充）
  node scripts/ledger-posthint.js --write

如果要编辑文件且想先检查坑有没有预防注释：
  node scripts/ledger-precheck.js app/js/store.js
```

### 11.3 两个脚本都零依赖

- 纯 Node 内置模块（fs / path / child_process）
- 不引入任何第三方包
- 可被 CI 调用（exit code 语义清晰）

---

## 12. FAQ

**Q: 为什么 issues.md 里的"根因"不能写"就是没加 XX"？**
A: 根因是**预防的关键**。下次换 AI 遇到同样问题，"没加 XX"对它没用；"因为 XX API 在 Y 环境下行为不同，需要加 Z 兜底"才是可执行规则。

**Q: index.md 要不要每个决策都加？会不会太啰嗦？**
A: 必须加。index.md 是**新 AI 5 分钟体检的入口**。issues/decisions 正文可能很长，新 AI 不想通读全文，只想知道"哪个模块有哪些坑、哪些决策"。

**Q: 台账写了但过几周发现那个决策又被推翻了怎么办？**
A: 不删！在 decisions.md 原条目下面追加一条"后来发现这条路不对，见 decision YYYY-MM-DD 新方案"。**被推翻的决策也是知识**——告诉后人哪些路是已踩过的坑。

**Q: 如果一个改动同时算 bug fix 和新决策，写一条还是两条？**
A: **两条**。issues.md 写 bug fix（根因+预防），decisions.md 写为什么这次用方案 A 不用方案 B。这是两个不同维度的知识。

**Q: Growth Logger Skill 是不是每次 invoke 都要写台账？**
A: 不是。Skill 是**规定什么时候写、写在哪、写啥格式**，不是强制每次都写。如果本轮没有新决策、没有新坑、只有"改了个 timeout 数字"，那**不写也是对的**（见第 6 节"什么情况下不写台账"）。

**Q: 台账文件在哪？会不会跟项目一起被 git commit？**
A: `.trae/memory/台账/` 目录。建议在 `.gitignore` 里加 `.trae/memory/`（个人工作记录，不提交仓库），或者加 `.trae/memory/台账/index.md` + `decisions.md` 提交（公共知识）而 issues.md 和 weekly_*.md 不提交。**取决于团队约定**。

**Q: ledger-posthint.js 的"模块归类表"怎么维护？**
A: 脚本顶部 `const MODULE_MAP = [...]` 硬编码了路径正则。如果项目新增模块（比如加个 `crm.js`），在 MODULE_MAP 里加一行 `{ tag: "crm", pattern: /^app\/js\/modules\/crm\.js$/ }` 就行。零成本维护。

---

## 13. 边界条件与不适用场景

### 13.1 什么时候这个 Skill 完全不适用

| 场景 | 理由 |
|------|------|
| **纯原型验证 / 一次性脚本**（不进主分支的东西） | 临时代码，不值得写持久化台账 |
| **用户个人偏好**（比如"这个按钮放左边"vs"右边"） | 不是架构决策，不需要留档 |
| **完全无技术含量的重复劳动**（批量改 CSS 类名） | 没有新知识产生 |
| **AI 会话长度限制**（快到 token 上限了） | 先写代码，台账留到下一轮 |

### 13.2 适用但要灵活调整的场景

| 场景 | 怎么调整 |
|------|----------|
| **一次会话推了 10 个小改动** | 不要每个改动都写一条 decisions，合并成"本轮 X 系列小优化"一条 |
| **一个 issue 修了 3 次还复发** | 原 issues.md 条目追加"复发 N 次"，不要新建重复条目；如果根因变了，再新建 |
| **改了 vendor/ 下第三方库** | 不写 issues/decisions（那是别人的代码），但**必须在拉手.md 里注明 vendor 版本** |
| **紧急热修复（5 分钟上线）** | 先跑通测试上线，台账可以下一轮补——但**不能超过 2 轮**还没补 |

---

## 14. 版本历史（Skill 自身也在进化）

| 版本 | 日期 | 变更 |
|------|------|------|
| **v1.0** | 2026-09-23 | 初始版本：9 节完整文档 + 固定写入模板 + 触发时机（P0/P1/P2 三级） + 核心流程 + 新 AI 体检清单 |
| **v1.1** | 2026-09-23 | 补第 8 节台账自动脚本（ledger-precheck / ledger-posthint）+ 第 10-14 节端到端示例 / 脚本集成 / FAQ / 边界条件 |
| **v1.2** | 2026-09-23 | ledger-posthint 加 --write 智能推断（exit 4）· 自动填"为啥/备选方案" · 脚本 v1.2 |（ledger-precheck / ledger-posthint）+ 第 10-14 节端到端示例 / 脚本集成 / FAQ / 边界条件 |

> **这个版本历史也应该写入**——Skill 自身的进化是项目知识的一部分。

---

> **一句话总结**：Growth Logger = AI 的**工作记录仪 + 交接手册 + 坑预防数据库**。每次改完代码，花 30 秒写台账 → 换 AI 时省 30 分钟。





