# 项目上下文 · 交接快照

> **新 AI 接手，先读这个！** 顶部 30 秒读完项目当前在哪、最近干了啥、下一个方向。
> 详细规则/历史剧情 → `AGENTS.md` / `decisions.md` / `issues.md`

---

## 🎯 交付快照（新 AI 读这里就够了）

**当前阶段**：v1.1.6 XLSX 格式修复收尾 — 合并单元格 + 公式缓存值 + mount 初始化顺序 + 选中高亮

| 项 | 值 |
|---|---|
| 测试基线 | **108/108 代码级全绿**（`node scripts/run-tests.js`；_cdp_test.js 需 Electron 实例连 9222，AI 代理回归 5 个环境依赖） |
| 最新 dist | `dist\绿角犀 Office Setup 1.1.6.exe` — **2026-10-12**（merge+formula 双修复 + mount init order） |
| 发布状态 | ❌ GitHub push + VPS 上传待执行（所有 commit 本地已堆到 main） |
| 版本号 | 1.1.6（源码/pubspec/dist 三处一致，铁律不能漂） |
| 用户账号 | aiuser / aiuser2 / aiuserB — 密码统一 **123456**（server/data/*.json，scrypt 哈希） |
| 台账状态 | decisions.md 最新 #47（XLSX 格式完整导入导出），issues.md 最新 L1\|xlsx-import 升级到 4 条子坑 |
| 代码待 push | **16 个 commit 本地已提交**（9c638db → 1e69148） |
| Git 脏文件 | `.trae/memory/台账/issues.md`（已改未 commit，下面会记） |

---

## 🚨 新 AI 必做 Checklist（换电脑 / 新对话启动）

```powershell
# 0) 读台账（≤ 30 秒）
Get-Content .trae/memory/台账/context.md -TotalCount 35
(Get-Content .trae/memory/台账/issues.md -Raw) -split '---' | Select-Object -First 5
(Get-Content .trae/memory/台账/decisions.md -Raw) -split '---' | Select-Object -First 4

# 1) 跑测试
node scripts/run-tests.js

# 2) 首次换电脑
npm install
node scripts/run-tests.js
npm.cmd run dist:local    # 打 Setup.exe（electron-builder）

# 3) 开发模式
npm start                 # Electron 桌面端
npm run cloud             # 启动云后端（localhost:PORT）

# 4) 如果要发布
git push origin HEAD:main
git tag v1.1.6; git push origin v1.1.6
scripts\publish-latest.bat   # 上传到 47.116.59.141 VPS
```

---

## 🧩 这轮核心改动（2026-10-12）— 必读（3 个 commit）

### commit `1e69148` — mount 初始化顺序（**合并单元格丢失的真根因**）

**根因链**：
```
parseXlsx → merge 对象数组 ✅
normalizeDoc → sheets[0].merge ✅
mount() 里：
  buildGrid() → 内部调 applyMerges()  ← ❌ 此时 data.merge 还是空的！
  bindAliases() → sh.merge → data.merge  ← 太晚了！
```

**修法**：[spreadsheet.js L2205-2206](file:///d:/源码存档/绿角犀办公软件/app/js/modules/spreadsheet.js#L2205) swap 两行：
```diff
- buildGrid();
- bindAliases();
+ bindAliases();
+ buildGrid();
```

**教训**：`buildGrid` 内部消费 `data.merge`（applyMerges），`bindAliases` 负责把 sheet 级数据提升到顶层 `data.*`。**数据提升必须在数据消费之前**。

### commit `cc2678f` — 公式缓存值 + merge 对象格式（**公式显示空白的根因**）

**Bug 1**（[import-ooxml.js L485-496](file:///d:/源码存档/绿角犀办公软件/app/js/import-ooxml.js#L485)）：有 `<f>` 时丢掉 `<v>`（Excel 缓存值）
```javascript
// 旧：有 f 就完全不管 v
if (f) { cells[ref] = { f: "=" + f.textContent }; }

// 新：同时保存 f 和 v
if (f) {
  const cell = { f: "=" + f.textContent.trim() };
  if (v) { cell.v = isNum(v.textContent) ? Number(v.textContent) : v.textContent; }
  cells[ref] = cell;
}
```

**Bug 2**（[spreadsheet.js L2248-2249](file:///d:/源码存档/绿角犀办公软件/app/js/modules/spreadsheet.js#L2248)）：FE.run 失败直接 `#ERROR!` 不回退
```javascript
// 旧
catch { val = "#ERROR!"; }
// 新
catch { val = (raw.v !== undefined && raw.v !== "") ? (isNum(raw.v) ? Number(raw.v) : raw.v) : "#ERROR!"; }
```

**Bug 3**（[import-ooxml.js L524](file:///d:/源码存档/绿角犀办公软件/app/js/import-ooxml.js#L524)）：merge 字符串 vs 对象
```javascript
// 旧
merges.push(ref);  // "A1:B2"
// 新
merges.push({ range: ref, type: "merge" });  // { range: "A1:B2", type: "merge" }
```
+ normalizeDoc 里 `normMerge` 兜底老格式自动转对象。

### commit `bdc58db` — 选中高亮（行列表头同步高光）

[paint() 函数](file:///d:/源码存档/绿角犀办公软件/app/js/modules/spreadsheet.js#L2349) 每次渲染前清所有 `th.head-selected`，再根据选中单元格的行号列号给对应 `th.rowhead` / `th.colhead` 加类。CSS `.head-selected` 已存在。

---

## 📊 模块状态

| 模块 | 状态 | 备注 |
|------|------|------|
| Writer | ✅ | 富文本 + docx/html/md 导出 |
| Spreadsheet | ✅ **已验证** | 选中高亮 ✅ / 合并单元格 ✅ / 公式 ✅ / 跨 sheet INDIRECT ✅ / TVM 5 函数 ✅ |
| Presentation | ✅ | PPTX 背景完整三层继承 + blipFill + 性能 |
| MindMap | ✅ | XMind/MD/OPML 导入 |
| PDF | 🟢 | PDF→DOCX + 三栏 + 坐标系已实锤 |
| AI 面板 | ✅ | BYOK 四供应商 |
| Electron | ✅ | 多窗口 + 大文件 + 隐藏菜单栏 |

---

## 🛠 XLSX 数据流全景图（**关键！新 AI 必须懂**）

```
用户打开 .xlsx
  ↓
import-ooxml.js parseXlsx(zip)           ← 源头：OOXML → 内部数据结构
  输出: { type: "spreadsheet", data: { sheets: [{
    cells: { "A1": { f: "=SUM(B1:B5)", v: 15 }, "B1": { v: 3 }, ... },
    styles: { "A1": { bold: true } },
    merge: [ { range: "C1:D2", type: "merge" } ],
    ...
  }]}}
  ↓
shell.js → doc.data = r2.data
  ↓
spreadsheet.js normalizeDoc(doc)          ← 中间层：单表→多表兼容 + normMerge 兜底
  输出: { sheets: [{ cells, styles, merge, ... }], activeSheet: 0 }
  ↓
mount(host, doc, ctx)                     ← 消费层
  bindAliases()   → data.merge = sh.merge（sheet 级 → 顶层 data）
  buildGrid()     → table.innerHTML + applyMerges()（用 data.merge 画 colspan/rowspan）
  getCell(ref)    → 读 data.cells[ref]，有 f 先 FE.run，失败回退 raw.v
  recompute()     → 遍历所有 .f 单元格 getCell 求值
```

**三个关键约束**（issues.md L1\|xlsx-import 总预防规则）：
1. parseXlsx 输出必须与 normalizeDoc 严格对齐（merge 要对象数组）
2. 公式单元格必须同时存 f 和 v（缓存值兜底）
3. mount 初始化：bindAliases（数据提升）→ buildGrid + applyMerges（数据消费）

---

## 🔧 铁律（高频踩坑压缩版）

1. **Electron main 进程 `*Sync` 一律禁用** — 阻塞 Chromium → watchdog 杀进程 → 闪退
2. **PPTX 背景三层继承链** — slide → slideLayout → slideMaster
3. **mount 初始化顺序** — 数据提升（bindAliases）必须在数据消费（buildGrid/applyMerges）之前
4. **XLSX merge 格式** — 对象 `{ range, type }` 不是纯字符串
5. **Excel 缓存值** — `<f>` 有了也要保留 `<v>`，FE.run 失败回退
6. **FE 大小写** — 函数名 scope key 统一大写

---

## 📂 目录地图（关键路径）

| 路径 | 干啥的 |
|------|--------|
| `app/js/import-ooxml.js` | OOXML 解析（docx/xlsx/pptx → 内部结构） |
| `app/js/modules/spreadsheet.js` | 表格核心（FE 引擎 + mount + applyMerges + getCell） |
| `app/js/modules/spreadsheet.js#L5996` | applyMerges（data.merge → colspan/rowspan） |
| `app/js/modules/spreadsheet.js#L2205` | mount 初始化顺序（bindAliases → buildGrid） |
| `app/js/modules/spreadsheet.js#L2247` | getCell 公式求值 + 缓存值回退 |
| `app/js/modules/spreadsheet.js#L2111` | normalizeDoc normMerge 兜底 |
| `electron/main.js` | Electron 主进程 |
| `scripts/run-tests.js` | 测试入口 |
| `dist/绿角犀 Office Setup 1.1.6.exe` | 最新安装包 |

---

## ⚠️ 已知遗留问题（非阻断）

1. **xlsx 公式 FE.run 不支持的函数** — 如 CUBESET、WEBSERVICE 等 Excel 特有函数，FE.run 会抛异常 → 已靠缓存值 raw.v 回退显示（用户看到的是 Excel 保存时的最后结果）。如果 FE 引擎后续加了这些函数就不用回退了
2. **顶层导航紧凑型小** — 如果用户反馈按钮太小，加"标准模式/紧凑模式"切换
3. **多窗口 HTTP server 共享** — 保留单实例锁，但多个 BrowserWindow 共享 127.0.0.1:PORT（OK）
4. **Git 未提交** — `.trae/memory/台账/issues.md` 已改（L1\|xlsx-import 升级 4 条子坑），建议 commit 时顺带记 `ref: ledger#xlsx-import`

---

## 📋 变更日志（2026-10-12 顶部追加）

- **[2026-10-12] XLSX 修复收尾 — 3 个 commit**
  - `1e69148` mount 初始化顺序：bindAliases 必须在 buildGrid 之前（applyMerges 依赖 data.merge）
  - `cc2678f` 公式同时保存 f + v 缓存值 + FE.run 失败回退 raw.v + merge 对象格式
  - `bdc58db` 选中单元格行列表头同步高光（th.head-selected）
  - 测试 108/108 代码级全绿 / dist 2026-10-12 / 台账 L1\|xlsx-import 新建（4 条子坑）

- **[2026-10-11] 跨 sheet INDIRECT + TVM 合并**
  - tokenizer 识别 `Sheet2!A1` / `'My Sheet'!A1:B2`
  - getCell closure `_splitSheetRef` + `_findSheet` case-insensitive
  - TVM: `_tvmFVcore` + `_tvmAdj` 共用
  - RATE NPER PMT PV FV 5 函数 + IRR evalNode special path

- **[2026-10-10] XLSX 格式完整双向 + Excel 快捷键 + PPTX 性能 + 底部单层**（详见旧 context.md）

---

## 🚀 换电脑 Checklist + 台账文件速查

| 文件 | 什么时候读 |
|------|----------|
| **`context.md`（本文件）** | **新 AI 第一读**：30 秒快照 |
| `issues.md` | 踩坑清单，L1 聚合坑含「总预防规则」（顶部 5 条必读） |
| `decisions.md` | 架构决策 / 方案选择理由 |
| `index.md` | 模块→决策/坑 映射表 |
| `STATUS.md` | 模块状态总览 |
