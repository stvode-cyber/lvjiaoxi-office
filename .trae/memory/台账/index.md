# 台账索引 — 新 AI 30 秒快速上手

## 🚀 启动顺序（必读）

1. **`context.md`** — 项目当前在哪 + 测试基线 + 下一个方向（5 秒快照）
2. **`decisions.md`** — 最近 13 条决策（ledger#78-#90，10-17 FE 冲刺）
3. **`issues.md`** — 8 个 L1 聚合坑（长期预防规则）

## 📂 文件用途速查

| 文件 | 大小 | 内容 | 什么时候读 |
|------|------|------|-----------|
| **context.md** | 18.9KB | 交付快照 + 测试基线 + 覆盖表 | **新会话第一读** |
| **decisions.md** | 26.1KB | 最近 13 条决策（时间倒序） | 改架构/方案前 |
| **issues.md** | 11.2KB | 8 个 L1 聚合坑 + 子坑列表 | 改文件前扫坑 |
| **archive/** | — | 归档旧条（85 decisions + 25 L2 issues + 3 weekly） | 查历史方案 |

## 📊 FE 函数最终状态（2026-10-17）

| 指标 | 值 |
|------|-----|
| **FUNCS 直接 key** | **314** |
| Excel 365 核心 271 覆盖 | **≈96%** |
| 财务 18 个 | **18/18 ✅** |
| 完整测试 | **110/111 全绿** |

### 真缺清单（约 25 个）

| 类型 | 数量 | 例子 | 难度 |
|------|------|------|------|
| 动态数组语法级 | 20+ | LAMBDA/LET/MAP/REDUCE | ⭐⭐⭐⭐⭐ evalNode 层 |
| 查找引用复杂 | ≈5 | XMATCH/LOOKUP/OFFSET/INDIRECT | ⭐⭐⭐⭐ |
| 分布补全 | ≈5 | NORM.DIST/EXPON.DIST/POISSON | ⭐⭐⭐ 依赖 _gammaln |

## 🛠 高频命令速查

```powershell
# 完整测试
node scripts/run-tests.js

# newfuncs 回归
node _spreadsheet_newfuncs_test.js

# 精确 FUNCS key 数
$lines = Get-Content app\js\modules\spreadsheet.js
$funcs = ($lines[238..3200] | Select-String -Pattern '^\s{6}"?([A-Z][A-Z0-9.]{0,20})"?\s*:' | ForEach-Object { $_.Matches.Groups[1].Value } | Sort-Object -Unique)
$funcs.Count
```

## 📋 台账维护铁律

- **改前**：扫 context.md 顶部快照 + issues.md L1 聚合坑
- **改后测完**：写 decisions.md 条目（`---` 分隔，时间倒序）
- **每月**：归档 > 15 天的 decisions / 已修复的 L2 issues 到 `archive/`
- **context.md**：每次会话收尾更新顶部快照

## 📁 Archive 内容

| 文件 | 条数 | 日期 |
|------|------|------|
| `archive/decisions_2026-10-10前.md` | 85 | 2026-09 ~ 10-10 |
| `archive/issues_L2_2026-10-10前.md` | 25 | L2 独立实例坑 |
| `archive/weekly_*.md` | 3 | 周报 |
