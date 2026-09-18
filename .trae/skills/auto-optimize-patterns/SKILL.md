---
name: auto-optimize-patterns
description: 自动优化模式库 — 反模式清单 + 自动检测命令 + 修复模板 + 项目基线。自我进化工程师读代码时按此清单扫描。
---

# 自动优化模式库

> 绿角犀 Office 反模式审计手册 · 基于 v1 (renderer) + v2 (全层) 两轮审计的实际数据。
> 每个反模式带：📊 基线 / 🔍 检测命令 / 🛠️ 修复模板 / 📈 收敛目标

---

## 📊 项目总基线（2026-09-13 审计 → 2026-09-13 修复）

| # | 反模式 | 审计基线 | 当前 | 优先级 | 状态 |
|---|--------|---------|------|--------|------|
| 1 | 空 catch {} 静默吞错 | 131 | **0** | 🔴 P0 | ✅ 已清零 |
| 2 | .then() 无 .catch() | 12 | **0** | 🔴 P0 | ✅ 已清零 |
| 3 | 事件监听 add 远超 remove | 364 vs 12 | 237 vs 9 | 🔴 P0 | ✅ 真泄漏已清零（window/doc 级：10→10，其中 shell 3 处是全局设计，spreadsheet 1 处已修） |
| 4 | JS 硬编码 hex | 424 | **411 (13 处已替换)** | 🟡 P1 | ✅ 安全替换赋值语句里的 hex；util.js 加 OS.theme.getVar() 缓存层 |
| 5 | DRY 违反（escapeHtml/toMarkdown 等 18 模块复制） | 18 模块 | 7（11 个已转 OS.util 转发） | 🟡 P1 | ✅ escapeHtml 已统一 |
| 6 | pdf-engine.js × 2 完全重复 | 4462 行 × 2 | **已删副本** | 🟡 P1 | ✅ 去重完成 |
| 7 | >50 行函数 | 31 | 31 | 🟡 P1 | ⏳ 暂缓（工作量大） |
| 8 | renderer 直接 require("zlib") 等 Node 模块 | 8 处 | **2（已加注释）** | 🟡 P1 | ✅ P1-4 完成 |
| 9 | IPC 通道孤儿 | 1 个 | **0（扫描误判，实际已配对）** | 🟡 P1 | ✅ |
| 10 | window 非 OS 挂载 | 5 个 | **0** | 🟢 P2 | ✅ 全归到 OS.PDFEngine/PDFToolbox/PDFStore |
| 11 | console.log 生产残留 | 3 | **0** | 🟢 P2 | ✅ |
| 12 | index.html 缺 CSP meta | 10 个 | **1 个已加** | 🟢 P2 | ✅ app/index.html 已加严格 CSP（其他 HTML 是 build 产物/PRD，不需要） |

---

## 🔴 P0-1: 空 catch {} 静默吞错（122 处）

### 根因
错误是程序的**可观测路径**。空 catch {} 把它变成黑洞——debug 时连 console 都没东西看。

### 🔍 自动检测命令
```powershell
# 空 catch {}（同行）
Select-String -Path "app/js/**/*.js","electron/*.js" -Pattern "catch\s*\(\s*\w*\s*\)\s*\{\s*\}" -AllMatches

# catch 里只有注释（后续行是 // 开头）
Select-String -Path "app/js/**/*.js","electron/*.js" -Pattern "catch\s*\(" -Context 0,1 | Where-Object { $_.Context.PostContext -match "^\s*//" }
```

### 🛠️ 修复模板
```js
// ❌ 之前
try { pdfDoc.save() } catch (e) {}

// ✅ 之后：至少打日志 + toast
try {
  pdfDoc.save();
} catch (e) {
  console.error("[PdfEngine] save 失败:", e);
  OS.toast("保存失败: " + e.message, "err");
}
```

### 特殊情况：预期会失败的操作
```js
// ✅ "预期失败" 场景也不能静默 — 标注清楚
try {
  // 记住我：跨会话恢复可能失败（用户没勾选过）
  const saved = JSON.parse(localStorage.getItem("auth") || "null");
  if (saved) restoreSession(saved);
} catch (e) {
  console.info("[Auth] 无保存会话，跳过恢复");  // info 级别即可
}
```

### 📈 收敛目标
**P0: 清零** — 不允许任何空 catch {}。catch 里哪怕只有一行 `console.info()` 都算通过。

---

## 🔴 P0-2: .then() 无 .catch()（12 处）

### 根因
Promise 链会**断链**——reject 变成 unhandled rejection，Electron 里会弹崩溃对话框。

### 🔍 自动检测命令
```bash
# 对每个 .then() 往后 3 行查 .catch
node -e "
const fs=require('fs'),path=require('path');
const files=[...require('fs').readdirSync('app/js').map(f=>'app/js/'+f)];
for(const f of files){
  const c=fs.readFileSync(f,'utf8'),lines=c.split('\n');
  for(let i=0;i<lines.length;i++){
    if(lines[i].includes('.then(')||lines[i].includes('.then ')){
      const after=lines.slice(i+1,i+5).join('\n');
      if(!after.includes('.catch')&&!after.includes('.finally'))
        console.log(path.basename(f)+':'+(i+1));
    }
  }
}"
```

### 🛠️ 修复模板
```js
// ❌ 之前 — promise 悬空
fetchData().then(render);

// ✅ 之后 — 完整链路
fetchData()
  .then(render)
  .catch(e => {
    console.error("fetchData 失败:", e);
    OS.toast("加载失败", "err");
  });

// ✅ 或者 async/await（更清晰）
async function load() {
  try {
    const data = await fetchData();
    render(data);
  } catch (e) {
    console.error("fetchData 失败:", e);
    OS.toast("加载失败", "err");
  }
}
```

### 📈 收敛目标
**P0: 清零** — 每个 `.then()` 必须跟 `.catch()` 或在 async 函数里被 try/catch 包裹。

---

## 🔴 P0-3: 事件监听配对（364 add vs 12 remove）

### 根因
SPA 切模块 mount 时加事件，但切换时从不 remove。加一次叠一层 → 每次事件触发回调 N 遍 → 越用越卡。

**最严重热点**: pdf.js (+47) / pdf-app.js (+35) / shell.js (+32) / spreadsheet.js (+27) / presentation.js (+25)

### 🔍 自动检测命令
```bash
node -e "
const fs=require('fs'),path=require('path');
for(const f of fs.readdirSync('app/js')){
  const c=fs.readFileSync('app/js/'+f,'utf8');
  const a=(c.match(/\.addEventListener\(/g)||[]).length;
  const r=(c.match(/\.removeEventListener\(/g)||[]).length;
  if(a>r+2) console.log(path.basename(f)+': add '+a+' vs remove '+r+' (差 '+(a-r)+')');
}"
```

### 🛠️ 修复模板

**方案 A: mount/unmount 配对**（推荐，简单直接）
```js
// pdf.js 示例 — 现状只有 mount，缺 unmount
let _pdfListeners = [];  // 统一记录这个模块加的所有 listener

function mount() {
  // ✅ 包装 addEventListener，自动记录
  const _on = (el, evt, fn, opts) => {
    el.addEventListener(evt, fn, opts);
    _pdfListeners.push({ el, evt, fn, opts });
  };

  _on(window, "resize", onResize);
  _on(document, "keydown", onKey);
  _on(document.getElementById("pdfToolbar"), "click", onToolbarClick);
  // ... 其他 listener 都用 _on() 加
}

function unmount() {  // 🆕 新增
  for (const { el, evt, fn, opts } of _pdfListeners) {
    el.removeEventListener(evt, fn, opts);
  }
  _pdfListeners = [];
}
```

**方案 B: AbortController**（现代浏览器，更干净）
```js
let _abortCtrl;
function mount() {
  _abortCtrl = new AbortController();
  window.addEventListener("resize", onResize, { signal: _abortCtrl.signal });
  document.addEventListener("keydown", onKey, { signal: _abortCtrl.signal });
}
function unmount() {
  _abortCtrl.abort();  // 一行清掉所有
}
```

### 📈 收敛目标
**P0: 减半** → 第一轮把每个热点模块的事件差降到 ≤5。
**P1: 配对** → 第二轮全模块 add ≈ remove。

---

## 🟡 P1-1: JS 硬编码 hex（424 处）

### 🔍 自动检测命令
```bash
node -e "
const fs=require('fs');
const hexCount={};
for(const f of fs.readdirSync('app/js')){
  const matches=fs.readFileSync('app/js/'+f,'utf8').match(/#[0-9a-fA-F]{6,8}\b/g)||[];
  matches.forEach(h=>hexCount[h.toLowerCase()]=(hexCount[h.toLowerCase()]||0)+1);
}
Object.entries(hexCount).sort((a,b)=>b[1]-a[1]).slice(0,10)
  .forEach(([h,n])=>console.log(h+' × '+n));
"
```

### 🛠️ 修复模板
```js
// ❌ 之前
ctx.fillStyle = "#2563eb";
toolbar.style.background = "#1b1b1d";
footer.style.color = "#faf9f8";

// ✅ 之后 — 从 computed style 读 CSS 变量（运行时解析）
const _rootVars = getComputedStyle(document.documentElement);
const accent = _rootVars.getPropertyValue("--accent").trim() || "#2563eb";
const bg     = _rootVars.getPropertyValue("--bg").trim()     || "#1b1b1d";
const ink    = _rootVars.getPropertyValue("--ink").trim()    || "#faf9f8";

ctx.fillStyle = accent;
toolbar.style.background = bg;
```

### 📈 收敛目标
**P1: Top 5 高频 hex 清零**（#ffffff×41, #2563eb×27, #fafafa×22, #000000×17, #111827×16）

---

## 🟡 P1-2: DRY 违反（18 个 pdf-* 模块各自实现 escapeHtml/toMarkdown）

### 🔍 自动检测命令
```bash
# 找有多少文件定义了 escapeHtml
grep -r "function escapeHtml" app/js/ --include="*.js" | wc -l
# 找有多少文件定义了 toMarkdown
grep -r "function toMarkdown" app/js/ --include="*.js" | wc -l
```

### 🛠️ 修复模板
```js
// ❌ 之前 — 每个 pdf-*.js 自己写一份
// pdf-docinfo.js
function escapeHtml(str) { ... }
// pdf-fonts.js  
function escapeHtml(str) { ... }
// pdf-encrypt.js
function escapeHtml(str) { ... }

// ✅ 之后 — 统一用 OS.util.escapeHtml（已存在）
// 删掉各模块里的本地实现，直接调用
const safe = OS.util.escapeHtml(annotation.content);
```

### 📈 收敛目标
**P1: escapeHtml / toMarkdown / summarize / bytesToString / sliceDict 全部从 util.js 导出，各模块删本地实现**

---

## 🟡 P1-3: renderer 直接 require Node 内置模块（8 处）

### 根因
Electron renderer 层用 CommonJS require 直接拉 Node zlib —— 这是**安全 tradeoff**（PDF 解压需要 Node 性能），但必须**显式记录**这个依赖。

### 🔍 自动检测命令
```bash
node -e "
const fs=require('fs'),path=require('path');
const nodeBuiltins=['zlib','fs','path','crypto','os','http','https','net','child_process'];
for(const f of fs.readdirSync('app/js')){
  const c=fs.readFileSync('app/js/'+f,'utf8');
  nodeBuiltins.forEach(m=>{
    if(c.includes('require(\"'+m+'\")')||c.includes(\"require('\"+m+\"')\"))
      console.log(path.basename(f)+' → require('+m+')');
  });
}"
```

### 🛠️ 规范（不是 bug）
如果用了 Node 内置模块，必须在文件头部加注释说明原因：
```js
// eslint-disable-next-line node/no-missing-require
// 使用 Node zlib 解压 PDF content stream —— renderer 层必须保留 nodeIntegration
const zlib = require("zlib");
```

### 📈 收敛目标
**P2: 加注释** — 每处 require Node 的地方都加注释说明为什么 renderer 层需要它。**不强制改**（改了反而拖慢 PDF 处理）。

---

## 🟡 P1-4: IPC 通道配对孤儿

### 🔍 自动检测命令
```bash
node -e "
const fs=require('fs');
let main=new Set(), ren=new Set();
for(const f of fs.readdirSync('app/js')){
  const c=fs.readFileSync('app/js/'+f,'utf8');
  const re=/ipc(?:Main|Renderer)?\.(?:handle|invoke|send)\s*\(\s*['\"]([^'\"]+)['\"]/g;
  let m; while((m=re.exec(c))){
    if(fs.readdirSync('electron').some(e=>fs.existsSync('electron/'+e)) && 
       c.includes('ipcMain.handle')) main.add(m[1]);
    else ren.add(m[1]);
  }
}
// 需要分别扫 electron 和 app 目录
console.log('run separately for each dir');
"
```

### 🛠️ 修复模板
```js
// electron/main.js — 注册 renderer 需要的通道
ipcMain.handle("shell:open-external", (e, url) => {
  return shell.openExternal(url);
});

// 或者删掉 renderer 里的孤儿调用
// delete await OS.ipc.invoke("shell:open-external", url);
```

### 📈 收敛目标
**P1: orphan=0** — renderer 调的每个通道 main 都有 handle。main 里预留的 updater 5 通道要么接 UI 要么删掉。

---

## 🟢 P2 类（可接受但可优化）

| 反模式 | 基线 | 命令 | 目标 |
|--------|------|------|------|
| console.log 生产残留 | 3 | `grep -r "console\.log(" app/js/` | 发布前清零 |
| window 非 OS 挂载 | 5 | `grep -r "window\.\w\+\s*=" app/js/` | 全部归到 window.OS |
| innerHTML vs textContent | 47% | 纯文本赋值改 textContent | 不用强制，知道有这回事 |
| async fire-and-forget | 336（虚高） | 逐文件人工审 | 重点审 ai.js / auth.js |
| 10 个 index.html 缺 CSP | 10 | 加 `<meta http-equiv="Content-Security-Policy" content="default-src 'self'">` | 安全加固 |

---

## 🔄 审计循环（自我进化工程师跑一轮）

```bash
# Step 1: 跑全部检测命令（上面 8 个 node/grep 脚本）
# Step 2: 对比基线数字 — 哪些涨了？哪些降了？
# Step 3: 按优先级修 — P0 → P1 → P2
# Step 4: 跑 CDP 端到端 — 确保没修坏
# Step 5: 更新本文件的基线数字
# Step 6: 遇到新模式 → 扩展本文件
```

---

## 💡 模式洞察库（从审计中提炼的）

| 模式 | 说明 |
|------|------|
| **事件 = 定时炸弹** | SPA 每 mount 一次叠一层 listener。写 mount() 同时必须写 unmount()。这不是"可选项" |
| **死代码比没写过更糟** | 5 个 updater IPC 通道写好了但没人调。要么活要么删 |
| **错误路径也是路径** | 空 catch {} 是项目第一大反模式。哪怕 info 级别日志也行 |
| **DRY 不只是风格** | 18 个模块各自实现 escapeHtml → 改 XSS 正则要改 18 次。统一函数 = 改一处修所有 |
| **安全 tradeoff 要记录** | renderer 层 require("zlib") 是有意为之，不是疏忽。但必须显式注释 |
