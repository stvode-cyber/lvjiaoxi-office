---
name: code-review-checklist
description: 代码审查 Checklist — Agent 在 PR 审查时按此清单逐条检查。每条带检测命令。
---

# 代码审查 Checklist

> 绿角犀 Office PR 审查标准 · 2026-09-13 更新 · 覆盖 renderer + Electron 全层

---

## 🔴 必须通过（任一不通过 = 打回）

### 错误处理
- [ ] **无空 catch {}** — 每个 catch 里至少有 `console.info()` 或以上级别日志
  ```bash
  # 检测命令
  Select-String -Path "app/js/**/*.js","electron/*.js" -Pattern "catch\s*\(\s*\w*\s*\)\s*\{\s*\}" -AllMatches
  ```
- [ ] **Promise 全链路 catch** — 每个 `.then()` 跟 `.catch()`，或在 async 函数里被 try/catch 包裹
  ```bash
  node -e "const fs=require('fs'),path=require('path');for(const f of fs.readdirSync('app/js')){const c=fs.readFileSync('app/js/'+f,'utf8'),lines=c.split('\n');for(let i=0;i<lines.length;i++){if(lines[i].includes('.then(')){const a=lines.slice(i+1,i+5).join('\n');if(!a.includes('.catch'))console.log(path.basename(f)+':'+(i+1));}}}"
  ```

### 功能正确性
- [ ] **模块初始化链路完整**: store.create → put → shell.openDoc → module.mount
- [ ] **边界条件**: 空数组/undefined/文件不存在/PDF 页数为 0
- [ ] **不破坏 SPA 切换**: 改 mount() 必须检查有没有配对的 unmount()

### 安全
- [ ] **eval / Function() 不用**（或注释明确原因）
  ```bash
  Select-String -Path "app/js/**/*.js" -Pattern "eval\s*\(|new Function\s*\(" -AllMatches
  ```
- [ ] **innerHTML 变量已转义**（用 `OS.util.escapeHtml`）
- [ ] **Electron: contextIsolation=true + preload.js 存在**
  ```bash
  Select-String -Path "electron/*.js" -Pattern "contextIsolation|preload"
  ```
- [ ] **Electron: enableRemoteModule 不能为 true**（已废弃）
- [ ] **IPC 通道配对**: renderer 调的每个通道 main 都有 handle
  ```bash
  # 分别扫 electron/ 和 app/js/，比两个列表的差集
  ```

### 跨层边界
- [ ] **renderer 里 require Node 内置模块**（zlib/fs 等）必须加注释说明原因
  ```js
  // 使用 Node zlib 解压 PDF content stream — renderer 层必须保留 nodeIntegration
  const zlib = require("zlib");
  ```

---

## 🟡 应该修复（建议修，但不打回）

### 事件监听配对
- [ ] **每个模块 addEventListener 和 removeEventListener 大致相等**（差 ≤5）
  ```bash
  node -e "const fs=require('fs'),p=require('path');for(const f of fs.readdirSync('app/js')){const c=fs.readFileSync('app/js/'+f,'utf8');const a=(c.match(/\.addEventListener\(/g)||[]).length;const r=(c.match(/\.removeEventListener\(/g)||[]).length;if(a>r+2)console.log(p.basename(f)+': +'+(a-r))}"
  ```
- [ ] **SPA mount() 必须有配对的 unmount()**
  - 方案 A: 统一 listener 记录 + unmount 清理
  - 方案 B: AbortController signal 模式

### DRY
- [ ] **不复制 escapeHtml/toMarkdown/summarize/bytesToString/sliceDict** — 统一用 OS.util
  ```bash
  grep -r "function escapeHtml\|function toMarkdown\|function summarize\|function bytesToString" app/js/ --include="*.js" | wc -l
  ```
- [ ] **相同 innerHTML 拼接模板出现 3+ 次 → 抽函数**
- [ ] **相同 try/catch + toast 模式 → 抽 `OS.util.safeRun(fn)`**

### 硬编码
- [ ] **JS 里不硬编码 #2563eb / #fafafa / #ffffff** 等高频色 — 走 CSS 变量
  ```bash
  node -e "const fs=require('fs'),h={};for(const f of fs.readdirSync('app/js')){(fs.readFileSync('app/js/'+f,'utf8').match(/#[0-9a-fA-F]{6,8}\b/g)||[]).forEach(x=>h[x.toLowerCase()]=(h[x.toLowerCase()]||0)+1)}Object.entries(h).sort((a,b)=>b[1]-a[1]).slice(0,5).forEach(([k,v])=>console.log(k+' × '+v))"
  ```
- [ ] **不硬编码像素常量（760/427/1024）** — 走 CSS 变量或 window.innerWidth

### 代码质量
- [ ] **函数单一职责，≤50 行**（超过 50 行建议拆）
- [ ] **能用 const 就不用 let**（项目 const 使用率 89%）
- [ ] **注释**: `// 单行` + `/** 函数文档 */` 统一风格

---

## 🟢 可接受（知道就行，不强制改）

- [ ] console.log 生产残留（发布前清零即可）
- [ ] window 非 OS 命名空间挂载（知道有这回事，新增的归 window.OS）
- [ ] innerHTML 占比（知道 47% 就行，纯文本赋值可改 textContent）
- [ ] async 里的 fire-and-forget（重点审 ai.js / auth.js 等高风险文件）
- [ ] index.html 缺 CSP（Electron contextIsolation 已开，风险低）

---

## 📤 审查输出格式

```
# PR 审查 — {模块名}
## 🔴 必须通过项（X/Y 通过）
| 检查项 | 结果 | 位置 |
|--------|------|------|
| 无空 catch {} | ❌ | pdf.js:L127 |
| Promise 全链路 | ✅ | — |
| Electron 安全 | ✅ | — |
## 🟡 建议修复（X/Y 通过）
| 检查项 | 结果 | 建议 |
|--------|------|------|
| 事件监听 | ⚠️ | pdf.js +47 vs 0，建议加 unmount |
| DRY | ✅ | — |
| 硬编码 hex | ⚠️ | 12 处 #2563eb |
## 总体评价
- [ ] 通过（可合并）
- [ ] 有条件通过（修完 🔴 项即可）
- [ ] 打回（🔴 项有不通过）
```

---

## 🎯 项目基线（2026-09-13）

| 检查项 | 基线 | 目标 |
|--------|------|------|
| 空 catch {} | 122 | 0 |
| .then() 无 catch | 12 | 0 |
| 事件 add-remove 差 | 352 | ≤50 |
| JS 硬编码 hex | 424 | ≤100 |
| escapeHtml 重复定义 | 11 | 1 |
| renderer require Node | 8 (全部 zlib) | 8 + 注释 |
| const 使用率 | 89% | ≥85% |
| eval/Function | 0 | 0 |
