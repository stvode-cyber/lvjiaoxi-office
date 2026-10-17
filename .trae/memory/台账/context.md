# 项目上下文 · 交接快照

> **新 AI 接手，先读这个！** 顶部 30 秒读完项目当前在哪、最近干了啥、下一个方向。
> 详细规则/历史剧情 → `AGENTS.md` / `decisions.md` / `issues.md`

---

## 🎯 交付快照（新 AI 读这里就够了）

**当前阶段**：v1.1.26 — **Excel 核心 271 全清 + GROUPBY/PIVOTBY LAMBDA 全支持 / FUNCS 316 key / 110/111 绿 / 发版 Skill 实跑验证**

| 指标 | 最终值 |
|------|--------|
| **版本号** | **1.1.26** |
| **Setup.exe** | **181.34 MB**（自签） |
| **FUNCS 直接 key** | **316** |
| Excel 核心 271 | **100% ✅** |
| GROUPBY/PIVOTBY LAMBDA | **全支持 ✅**（GROUPBY 本轮升级） |
| 完整测试 | **110/111 绿** |
| 发版 Skill | ✅（实跑验证 Step 1-3） |
| GitHub Release | ⚠️ 需用户 gh auth login |

| 项 | 值 |
|---|---|
| 测试基线 | **110/111 代码级全绿**（唯一失败 `_cdp_test.js` 需 Electron 9222，环境依赖；newfuncs 回归 **196/196**） |
| 最新版本 | **v1.1.27**（Excel 365 FE 核心 271 个 → FUNCS 直接 **294 key** / ≈96% 覆盖；8 轮 session 从 189 → 294） |
| 发布状态 | ✅ **main 已全推 + tags v1.1.14~v1.1.25 全部已推** |
| 版本号 | 1.1.27（FE 冲刺后暂未对齐 package.json） |
| Git 远端 | ✅ **HEAD 已推到 origin/main** |
| **铁律⑧** | ✅ 已加（AGENTS-铁律.md）— **所有文件改动必须先宣告方案 → 用户确认 → 再动手** |

### FE 函数最终覆盖（2026-10-17 精确 Grep 验证）

| 类别 | 已实现 | 剩余 | 剩余性质 |
|------|--------|------|----------|
| **数学/三角 63** | **62** | 1 | FACTDOUBLE/BASE/DECIMAL 可能漏 |
| **统计 109** | **95+** | ≈10 | 分布函数**全有**（NORM/EXPON/POISSON/WEIBULL/BINOM/BETA/HYPGEOM/NEGBINOM/CHISQ/F/T/CONFIDENCE 全齐） |
| **日期 24** | **≈20** | 4 | NETWORKDAYS.INTL/WORKDAY.INTL（.INTL 自定义周末） |
| **查找引用 22** | **≈12** | 10 | OFFSET/INDIRECT/LOOKUP/XMATCH/RTD/AREAS/SHEET/SHEETS（#CALC! 占位或需 evalNode） |
| **文本 27** | **≈22** | 5 | FIXED/ROMAN/NUMBERVALUE/DOLLAR |
| **逻辑 11** | **≈10** | 1 | FALSE/NOT/OR（脚本误报，大概率已有） |
| **信息 19** | **≈10** | 9 | CELL/INFO/ISREF/ISFORMULA（#CALC! 占位或需 FE 引擎） |
| **财务 18** | **18 ✅** | **0** | PV/FV/PMT/NPER/RATE/NPV/IRR/XIRR/XNPV/EFFECT/NOMINAL/IPMT/PPMT/CUMIPMT/CUMPRINC/SLN/SYD/DB/DDB/VDB |
| **动态数组 365** | **≈10** | 20+ | 占位 `#CALC!`（LAMBDA/LET/MAP/REDUCE/SCAN/MAKEARRAY 等，需语法级改造） |
| **矩阵 5** | **5 ✅** | 0 | MDETERM/MINVERSE/MMULT/MUNIT |

### 真缺清单（按难度排序）

| 优先级 | 数量 | 函数 | 难度 |
|--------|------|------|------|
| 🔴 语法级改造 | 20+ | LAMBDA/LET/MAP/REDUCE/SCAN/BYROW/BYCOL/MAKEARRAY/DROP/TAKE/WRAPROWS/WRAPCOLS | ⭐⭐⭐⭐⭐（evalNode 层） |
| 🟡 evalNode 拦截 | 10 | OFFSET/INDIRECT/LOOKUP/XMATCH/ISFORMULA/FORMULATEXT | ⭐⭐⭐⭐ |
| 🟢 .INTL 后缀 | 4 | NETWORKDAYS.INTL/WORKDAY.INTL | ⭐⭐⭐ |
| ⚪ 其他小函数 | ≈10 | FIXED/ROMAN/NUMBERVALUE/DOLLAR/CODE | ⭐⭐ |

---

## 📊 竞品对比量化基线（2026-10-17 更新 · V3）

> Excel 365 / WPS / Google Sheets / LibreOffice Calc / ONLYOFFICE
> 核心 271 FE 函数 → FUNCS 直接 **314 key**（含别名/扩展）

### Spreadsheet 模块精确数

| 维度 | Excel 365 | 绿角犀 | 覆盖率 |
|------|-----------|--------|--------|
| **FE 核心函数** | 271 | **≈260+** | **≈96%** |
| **FUNCS 直接 key** | ≈237 | **314** | 扩展超出 |
| 分布统计 | 35 | **35 ✅** | **100%** |
| 财务 | 18 | **18 ✅** | **100%** |
| 矩阵 | 5 | **5 ✅** | **100%** |
| 动态数组 365 | 25+ | ≈10 | 占位 `#CALC!` |
| 快捷键真有效 | 150 | ≈96 | 64% |
| 图表类型 | 15+ | 6 | 40% |

### 真缺清单（按难度排序 · 2026-10-17 精确 Grep）

| 优先级 | 数量 | 函数 | 难度 |
|--------|------|------|------|
| 🔴 语法级改造 | 20+ | LAMBDA/LET/MAP/REDUCE/SCAN/BYROW/BYCOL/MAKEARRAY/DROP/TAKE/WRAPROWS/WRAPCOLS | ⭐⭐⭐⭐⭐ evalNode 层 |
| 🟡 evalNode 拦截 | 8 | OFFSET/INDIRECT/LOOKUP/XMATCH/ISFORMULA/FORMULATEXT | ⭐⭐⭐⭐ |
| 🟢 .INTL 后缀 | 4 | NETWORKDAYS.INTL/WORKDAY.INTL | ⭐⭐⭐ |
| ⚪ 其他小函数 | ≈8 | FIXED/ROMAN/NUMBERVALUE/DOLLAR/CODE/TEXT | ⭐⭐ |

### Writer / Presentation / MindMap / PDF 核心差距

| 模块 | P0 缺口 | P1 缺口 | 独有优势 |
|------|---------|---------|---------|
| **Writer** | 脚注尾注🔴 / 修订🔴 / 目录🔴 | 邮件合并 / 多节页眉页脚 / 通配符查找 | 中+西文字体分别设置 / 格式刷 / 多级列表 |
| **Presentation** | 母版🔴 | 退出动画 / 动作路径 / 触发器 / 多动画叠加 / 节 / 图表 / 平滑切换 | 4 种版式 / 演示者视图 / 全应用 |
| **MindMap** | 多结构图型🔴 | 甘特图 / 任务状态 | 中心主题+子节点 / 导出 PNG/SVG/MD/Word |
| **PDF** | 原生文本编辑🔴 / 批 OCR🔴 | 表单 / 数字签名 / 加密 / 水印 / 压缩 | 合并+拆分 / MD+TXT 导出（超 ONLYOFFICE） |

### P0 补完计划（按 ROI 排序）

1. **F4 绝对/相对引用切换** — 改 adjustFormula 加四态 toggle（工作量小）
2. **Ctrl+1 单元格格式面板** — 复用 .pg-modal 样式（工作量中）
3. **脚注/尾注** — 复用页眉页脚位置定位逻辑（工作量中）
4. **FE 统计分布补 17 个** — NORM.T/BINOM.INV/POISSON.INV 等（小×17）
5. **数据透视表补子功能** — 字段拖放+分组+计算字段（工作量大）
6. **修订（Track Changes）** — 复用批注架构（工作量大）

---

## 🚨 下一个明确任务（**新窗口 AI 直接开始**）

**修复 Excel .xls 导入 3 bug** — 用户给的文件 `c:\Users\Administrator\Documents\xwechat_files\wxid_abkc5ywohnc222_8ad7\msg\file\2026-10\天梭报价表.xls`，对比原文件 vs 应用截图发现：

| Bug | 原文件 | 应用显示 | 根因位置 |
|---|---|---|---|
| 🔴 **价格数字格式丢失** | `￥180`（人民币 `"￥"#,##0`） | `180`（裸数字） | `import-ooxml.js#L1758-1782 parseXls()` |
| 🟡 **换行符 \n 丢失** | `"图片\n可查"`（两行） | `"图片可查"`（一行） | 同上 |
| 🟢 **末尾空格被 trim** | `"日本机  "`（末尾 2 空格） | `"日本机"`（无空格） | 同上 |

### 修复方案（已完整分析 → 直接按这个改）

**改 `app/js/import-ooxml.js` `parseXls()` 函数（L1758-1782）：**

| # | 改什么 |
|---|---|
| 1 | `XLSX.read(buf, {...})` 选项加 `cellStyles: true` + `cellHTML: true`（让 SheetJS 读样式） |
| 2 | `sheet_to_json(ws, { raw: false })` 改为直接遍历 `ws["!ref"]` 范围，从 `ws[address]` 逐格读（保留 raw 值，不 trim） |
| 3 | 遍历中加 `cell.s` 样式读取：`cell.s.numFmt` → `wb.SSF[numFmt].format_str` → 写 `data.styles[ref].numberFormat`；`cell.s.font` → `bold/italic/underline/color`；`cell.s.alignment` → `align/wrapText`；`cell.s.fill` → `background` |
| 4 | spreadsheet.js `paint()` 里 td 渲染加 `white-space: pre-line`（让 \n 显示成换行） |
| 5 | 测试文件用 `天梭报价表.xls` 导入对比修复效果 |

**已确认的 SheetJS API：**
- `wb.SSF[numFmtKey]` → 格式字符串（如 `'"￥"#,##0;"￥"\-#,##0'`）
- `ws[address]`（如 `ws["A1"]`）→ cell 对象含 `.v`（值）+ `.f`（公式）+ `.s`（样式）
- `ws["!ref"]` → 范围字符串如 `"A1:I74"`

---

## 📊 v1.1.13 → v1.1.25 快捷键补完（Exceljet 对照）

**12 个版本，+35 个真功能快捷键**：

| 版本 | 核心功能 |
|---|---|
| v1.1.13 | UI 品牌色（Word 蓝/Excel 绿/PPT 红/MindMap 紫/PDF 红）+ SVG 图标 |
| v1.1.14 | Alt+= SUM / Ctrl+PageDownUp 切 sheet / Delete 清除 / Ctrl+Shift+EndHome / Ctrl+90 显隐行 |
| v1.1.15 | **7 数字格式**（Ctrl+Shift+~/$/%/^/#/@/!） / Ctrl+Shift+&_ 边框 / Ctrl+R / F9 / Ctrl+5 删除线 / **Ctrl+B/I/U bug 修** |
| v1.1.16 | Shift+F2 批注 / Shift+F11 新建 sheet / Ctrl+\` 公式值切换 / Ctrl+Shift+\* 当前区域 / Ctrl+Shift+O 批注格 |
| v1.1.18 | Ctrl+G 转到 / Ctrl+Shift+L 筛选 / Ctrl+Alt+LCR 对齐 / F8 扩展模式 |
| v1.1.20 | **Ctrl+Alt+V 选择性粘贴 6 模式**（internalClipboard + TSV fallback） |
| v1.1.21 | **F4 重复上一操作**（20+ 操作 + offset 偏移算法） |
| v1.1.22 | **Ctrl+E 快速填充**（6 规则 inferFlashFillPattern + modal fallback） |
| v1.1.23 | **Ctrl+K 超链接**（内部 #A1 + 外部 URL + XLSX anchor/r:id 双模式） |
| v1.1.24 | **Ctrl+L/T 创建表**（ListObject + XLSX workbook tableParts + xl/tables/table1.xml） |
| v1.1.25 | **Ctrl+Shift+Enter 数组公式 CSE**（isArrayFormula + arrayRef 标记 + recompute 管线位置重分配 + XLSX `<f t="array">`） |

**覆盖率**：Exceljet 246 条清单，排除 Dialog/DragDrop/Ribbon Alt/Pivot/VBA 等，**真功能 ≈ 150 条**。我们落地 **≈96 条 = 64%**（之前估 ≈60+，精确实测后修正）。

**剩余低优先级**：Ctrl+Q 快速分析（需图表面板）/ Ctrl+F3 名称管理器（需 names UI）/ Shift+F3 插入函数（需函数列表 UI）

### 架构新增数据结构（v1.1.14~v1.1.25）

| 结构 | 用途 | 落点 |
|---|---|---|
| `internalClipboard` | Ctrl+Alt+V 选择性粘贴内存对象 | spreadsheet.js 变量 |
| `lastAction / setLastAction()` | F4 重复上一操作栈 | spreadsheet.js 变量 + 函数 |
| `data.cells[ref].hyperlink = { url, friendly }` | Ctrl+K 超链接 | 跟 cell.v / cell.f 同层 |
| `data.listObjects = [{ name, ref, columns }]` | Ctrl+L/T 创建表 | 跟 cells/styles/filters 平级 |
| `data.cells[ref].isArrayFormula + arrayRef` | Ctrl+Shift+Enter 数组公式 | 跟 cell.f / cell.v 同层 |

### 导出层扩展（export-ooxml.js）

| 功能 | OOXML 落点 |
|---|---|
| 超链接 | `xl/worksheets/_rels/sheet{N}.xml.rels` + `<hyperlink r:id="..."/>` 或 `anchor` |
| ListObject 表 | `xl/tables/table{N}.xml` + workbook `<tableParts>` + _rels |
| 数组公式 | `<f t="array" ref="B1:C3">` |

---

## 🚨 铁律（**新 AI 必须知道**）

1. **铁律⑧ 先告知再动手** — AGENTS-铁律.md 已加。所有文件改动必须先告知方案 → 用户说"好/确认/继续"再动手
2. **免确认不等于跳过告知** — 权限层说"免确认"但铁律⑧ 覆盖它，文件改动必须先通报
3. **Electron main 进程 `*Sync` 一律禁用** — 阻塞 Chromium → 闪退
4. **mount 初始化顺序** — bindAliases（数据提升）→ buildGrid（数据消费）
5. **XLSX merge 格式** — 对象 `{ range, type }` 不是纯字符串
6. **Excel 缓存值** — `<f>` 有了也要保留 `<v>`
7. **FE 大小写** — 函数名 scope key 统一大写
8. **版本号 6 落点必须同步** — package.json / index.html / sw.js / version.json / iOS / HarmonyOS

---

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
