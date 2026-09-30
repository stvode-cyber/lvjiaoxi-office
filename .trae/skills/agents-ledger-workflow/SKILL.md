---
name: "agents-ledger-workflow"
description: "AGENTS §7 台账五步闭环：扫台账→改→测→写台账→commit 带 ref。Invoke 时：新对话启动、改文件前、改完测完、commit 前。"
---

# AGENTS §7 台账五步闭环

> 本项目最高铁律（见 `AGENTS.md §7`）。任何 AI 接手或执行开发任务时必须走完。

## 触发条件（何时调用）

1. **新对话启动** — 第一件事
2. **改文件之前** — 动手前先扫一眼
3. **改完 + 测完通过** — 立刻写台账条目
4. **commit 之前** — 确认 commit body 带 `ref: ledger#N`

## 五步流程

```
┌─────────────────────────────────────────────────────────┐
│ ① 扫台账 (≤30s)                                         │
│    ↓                                                     │
│ ② 选任务 (可验证/可交付)                                 │
│    ↓                                                     │
│ ③ 实现 (小心 PowerShell 批量写坑 → 用 Edit 精确替换)    │
│    ↓                                                     │
│ ④ 验证 (run-tests.js 必须全绿)                          │
│    ↓                                                     │
│ ⑤ 写台账 + commit 带 ref                                │
└─────────────────────────────────────────────────────────┘
```

---

### ① 扫台账（≤30 秒）

```powershell
# 决策台账最近 2 条
(Get-Content .trae/memory/台账/decisions.md -Raw -Encoding UTF8) -split '---' | Select-Object -First 3

# 踩坑台账最近 2 条
(Get-Content .trae/memory/台账/issues.md -Raw -Encoding UTF8) -split '---' | Select-Object -First 3

# 全量测试现状（必须 104/104 绿）
node scripts/run-tests.js
```

**台账位置**：
- 决策：`.trae/memory/台账/decisions.md`
- 踩坑：`.trae/memory/台账/issues.md`
- 索引（可选）：`.trae/memory/台账/index.md`

**为什么先扫**：避免重踩已记录的坑、避免推翻已确认的决策、知道"还剩啥没干"。

---

### ② 选任务

选一件**能推进完成度、完成后可被客观验证**的事。不要选"看起来做了"但无法验证的。

选任务参考：
- `ledger-precheck.js` 输出里的 P0/P1 坑（核心高频改文件优先）
- `STATUS.md` / `AI交接_拉手.md` 里标记"待做"的
- 台账里 `✅` 已修复但代码里没补 TODO 预防注释的

---

### ③ 实现（避坑！）

#### ✅ 正确姿势

- **Edit 工具逐文件精确替换**：`old_string→new_string`，每条独立一行
- **JS 文件注释**：`// TODO: [坑-slug-name] 预防: 具体怎么做`
- **HTML 文件注释**：`<!-- TODO: ... -->`（绝不能用 `//`）
- **Electron 主进程文件**：注意主进程没有 `window` 对象，renderer/preload 才有

#### ❌ 绝对禁止

- PowerShell `foreach` + `Set-Content` 批量写多个文件 → 换行丢失 + 类型转换报错
- 在 HTML 里用 JS `//` 注释 → boot test 挂一片
- issues.md 里关联 glob 写太宽（如 `app/js/**/*.js`）→ precheck 每次扫出全噪音

#### 已沉淀的具体坑号（issues.md 里都有）

| 坑 slug | 严重度 | 预防 |
|---------|--------|------|
| `powershell-batch-todo-newline` | P2 | 批量改文件 → 用 Edit 工具逐文件 |
| `boot-test-regex-eats-body` | P0 | HTML 注释里别写 `<script>` 精确字符串 |
| `shell-_on-scope` | P0 | 函数别定义在另一个函数内部但被外部调用 |
| `tesseract-worker-in-inline-script` | P0 | worker.min.js 别用 `<script src>` 直接加载 |

---

### ④ 验证（Trust-but-Verify）

```powershell
# 全量测试（必须 104/104 绿）
node scripts/run-tests.js

# 台账 precheck 扫改动文件
node scripts/ledger-precheck.js <改动文件路径>

# 如果改了台账数据，跑 posthint
node scripts/ledger-posthint.js HEAD~1..HEAD
```

**失败时**：读报错、查上下文、换思路。**禁止 sleep 重试循环**。连续同一错误失败 2 次就停手分析根因。

**紧急回滚**：
```powershell
git checkout -- <被破坏的文件>
```

---

### ⑤ 写台账 + commit 带 ref

#### 写决策台账（影响方向/架构/规范的决策）

```powershell
# 打开 decisions.md，在顶部插入新条目（时间倒序追加）
# 格式：
---

## [YYYY-MM-DD] 一句话标题

- **选了啥**：具体方案
- **为啥**：决策依据（踩过的坑 / 收益 / 用户要求）
- **备选方案**：其他选项 + 排除理由（可以写"无"）
- **关联文件**：受影响的路径
- **决策人**：AI / 用户反馈 / 测试发现
```

#### 写踩坑台账（遇到报错/踩花 >5 分钟/发现隐藏 bug）

```powershell
# 打开 issues.md，在顶部插入新条目
# 格式：
---

## [P0/P1/P2/P3] [slug-name] 一句话标题

- **问题**：现象 + 复现路径
- **解决**：改了啥文件 + 改前改后对比
- **根因**：为什么会这样（代码架构层面）
- **预防**：下次怎么避免（具体规则 / 检查点）
- **复发次数**：首次踩坑日期 + 复发次数
- **关联文件**：
```

严重程度定义：P0=阻断发布 / P1=影响核心体验 / P2=影响局部 / P3=不爽但能用

#### commit body 带 ref

```powershell
git add <改动文件>
git commit -m "feat/fix/chore: 一句话" -m "ref: ledger#N"
git push origin main
```

`N` = 台账条目序号（issues.md/decisions.md 里你加的是第几条）。

---

## 本项目工具链速查

| 工具 | 路径 | 用途 |
|------|------|------|
| precheck | `scripts/ledger-precheck.js` | 改前扫坑：哪些文件关联了哪些已知坑 |
| posthint | `scripts/ledger-posthint.js` | 改完建议：哪些改动值得写台账 |
| run-tests | `scripts/run-tests.js` | 全量测试（当前 104 用例） |
| bump-version | `scripts/bump-version.js` | 版本号统一注入四端 |
| sync-clients | `scripts/sync-clients.js` | 四端版本号同步 |

precheck 特性：
- 自动跳过 glob 展开 > 50 文件的宽条目（减少噪音）
- 自动跳过 `app/vendor/`
- 支持两种标题格式：`[P0] [slug] desc` 和 `[YYYY-MM-DD] desc`
- 输出带颜色分级（P0红/P1黄/P2蓝/P3灰）

---

## 台账铁律（AGENTS.md §7.5）

1. **台账是唯一真源** — 写进去的东西不可推翻，除非新条目显式标注"覆盖 #N"
2. **改完立刻写** — 不要拖到会话末尾
3. **commit 必须带 ref** — body 里加 `ref: ledger#N`
4. **其他 AI 接手时** — 读台账 > 读代码 > 读文档
5. **台账漂移 = 项目失忆** — 质量崩盘

---

## 3 轮实战数据（2026-09-30）

| 轮次 | 任务 | 改文件 | 测试 | 台账 | commit |
|------|------|--------|------|------|--------|
| 1 | fix ledger-precheck glob + parseIssues | 2 脚本 | 104/104 | #36 | 792c902 |
| 2 | issues.md 29 条补 P0-P3 前缀 | 1 台账 | 104/104 | #37 | 8f26490 |
| 3 | 10 核心文件补 26 条 TODO | 10 文件 | 104/104 | #38 #39 | 5adef8e |
