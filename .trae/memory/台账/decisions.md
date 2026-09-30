
---


---


---

## [2026-09-30] issues.md 4 条关联 glob 收窄 → precheck 噪音 -70%

- **选了啥**：把 4 条写得太宽的关联 glob 收窄成实际有关的具体文件
  - ileassoc-hardcoded-absolute: pp/js/**/*.js / scripts/*.js → pp/js/shell.js
  - koa-connect-ctx-leak: electron/main.js / server/index.js / scripts/*.js → electron/main.js
  - powershell-regex-quote-hell: scripts/run-tests.js / scripts/*.js → scripts/run-tests.js, scripts/bump-version.js
  - electron-builder-csclink-null: electron/main.js / electron/*.js → electron/main.js
- **为啥**：precheck 扫 47 条建议，34 条来自这 4 条宽 glob（fileAssoc 12 + koa 10 + PS regex 8 + csclink 4）；实际 grep 验证：scripts/ 里根本没有 koa 引用、硬编码路径只在 shell.js、csclink 只在 main.js
- **效果**：precheck 建议补 TODO 从 47 → 14（-70%）；总行数从 ~100 → 67
- **教训**：issues.md 关联文件写 glob 前先 grep 验证实际命中范围
- **关联文件**：.trae/memory/台账/issues.md（4 条条目 L189 L211 L249 L260）
- **决策人**：precheck 噪音来源分析发现
## [2026-09-30] 沉淀 agents-ledger-workflow Skill

- **选了啥**：创建 .trae/skills/agents-ledger-workflow/SKILL.md，把 AGENTS §7 台账五步闭环（扫台账→选任务→实现→验证→写台账+commit 带 ref）沉淀为 workspace 级 skill
- **为啥**：同一会话里完整跑了 3 轮闭环（fix precheck / 补 issues.md severity / 补 26 条 TODO），每次都是触发型流程，值得让后续 AI 一接手就自动调用
- **Skill 里包含**：触发条件、五步流程图、每步具体命令、避坑清单（PowerShell 批量写/HTML 注释踩坑）、台账格式模板、工具链速查、实战数据
- **关联文件**：.trae/skills/agents-ledger-workflow/SKILL.md
- **决策人**：Skill Accumulation 规则触发（同流程执行 ≥3 次）
## [2026-09-30] 核心 9 文件补 26 条 TODO 预防注释

- **选了啥**：shell.js(6) / mindmap.js(4) / import-ooxml.js(3) / electron/main.js(1) / auth.js(2) / tasks.js(2) / pdf.js(2) / store.js(1) / bump-version.js(2) + index.html(2) 共 10 文件 26 条 TODO 预防注释；JS 用 // TODO: [坑-slug] 预防: xxx，HTML 用 <!-- TODO: ... -->
- **为啥**：ledger-precheck 扫出 71 条建议，绝大多数是 issues.md 关联 glob 太宽的噪音（如 ileAssoc 关联 app/js/**/*.js）；核心高频改文件 + P0/P1 坑值得加；scripts/ 下大部分文件 koa-connect/PowerShell-regex 的 TODO 是误导性的（脚本根本不用 koa）
- **踩的坑**：第一次用 PowerShell 批量写时 index.html 两条 TODO 连在一起无换行 + 用了 JS // 注释（HTML 不认），导致 boot test 16 挂 → 立刻 git checkout 回滚 → 改用 Edit 工具逐文件精确 old_string→new_string 替换，每条独立一行
- **故意不加的**：electron/main.js 的 contextIsolation-window — 主进程没 window 对象，坑在 preload/renderer；scripts/ 下 koa-connect/PowerShell-regex/fileAssoc 批量噪音
- **关联文件**：app/js/shell.js / app/js/modules/mindmap.js / app/js/import-ooxml.js / electron/main.js / app/js/auth.js / app/js/tasks.js / app/js/modules/pdf.js / app/js/store.js / scripts/bump-version.js / app/index.html
- **决策人**：AI 批量补 TODO 时踩 PowerShell 换行坑
