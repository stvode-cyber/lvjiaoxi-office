---
name: "electron-startup-perf"
description: "Electron 应用冷启动 + 文件打开性能优化专项 Skill。Invoke when user complains app is slow to start / open files, or asks to optimize startup/import speed."
---

# Electron 应用冷启动 & 文件打开性能优化

> 基于 v1.1.2 defer 化实测（启动 3s→483ms）和 48841 节点 XMind 导入链路排查的沉淀。
> 解决两类问题：**冷启动慢**（打开桌面应用白屏久）、**文件打开慢**（点文件卡 5s+）。

---

## 🔴 触发时机

- 用户说"启动慢 / 打开文件卡 / 白屏久"
- 自测发现 `npm start` 后渲染进程 ready > 3s
- 打开大文件（大 XMind / 多 Sheet Excel / 长 PPTX）体感 > 2s

---

## 📐 步骤一：先测量（不要拍脑袋优化）

### 1.1 冷启动 Timing 采集

```powershell
# 1. 清空旧诊断日志
if (Test-Path "$env:APPDATA\lvjiaoxi-office\diag\render-console.log") { Remove-Item -Force ... }
# 2. 启动应用
npm start
# 3. 等 10 秒后读日志
Get-Content "$env:APPDATA\lvjiaoxi-office\diag\render-console.log" -Tail 50
```

关键时间戳（index.html 里诊断层已经埋好）：
- `[DIAG] 诊断层就绪` — script 开始执行的时间
- `[DIAG] shell phase 工具就绪` — shell.js IIFE 加载完成
- `[DB]: xx ms` — IndexedDB open 耗时
- `[PHASE] xxx` — 各业务链路 timing

### 1.2 文件打开链路 Timing

```powershell
# 过滤 PHASE / OPEN-DOC / IMPORT
Select-String render-console.log -Pattern "PHASE|OPEN-DOC|IMPORT|MINDMAP-LAYOUT|MINDMAP-RENDER"
```

把打开一个文件的链路拆成 4 段打点：
| 阶段 | 位置 | 含义 |
|------|------|------|
| ① Read | `importFile.arrayBuffer()` | 读文件到内存 |
| ② Parse | `parseXmind / parseDocx / ...` | 解压 ZIP + 解析 XML/JSON → nodes |
| ③ Layout | `layoutMap()` | 树形递归布局（O(N)）|
| ④ Render | `render()` | 生成 SVG DOM |

**每一段都要 console.time/timeEnd**，拿到数字才能决定优化方向。

### 1.3 script 体积 & 加载方式扫描

```js
// 保存为临时 .js 脚本执行
const fs=require("fs");
const html=fs.readFileSync("app/index.html","utf8");
const mm=[...html.matchAll(/<script([^>]*?)src=["']([^"']+)["']/g)];
let syncKb=0, deferKb=0;
for(const m of mm){
  const attrs=m[1]; const src=m[2];
  const p="app/"+src; let sz=0; try{sz=fs.statSync(p).size;}catch(e){}
  if(attrs.includes("defer")||attrs.includes("async")) deferKb+=sz; else syncKb+=sz;
}
console.log("sync KB:",Math.round(syncKb/1024),"defer KB:",Math.round(deferKb/1024));
```

**红线：HEAD 里 sync KB > 500KB 必须优化**。

---

## 🛠️ 步骤二：冷启动三板斧（按优先级）

### 2.1 把所有 `<script src>` 加 `defer`（P0 · 改一行代码 100% 安全）

defer 的语义：**并行下载 + 不阻塞 DOM 解析 + 严格保序执行**。
```html
<!-- 改前 -->
<script src="vendor/xlsx.full.min.js"></script>
<!-- 改后 -->
<script src="vendor/xlsx.full.min.js" defer></script>
```

**项目已实测**：66 sync + 1 defer → **全部 67 defer**，冷启动从 ~3s → **~483ms（6× 加速）**。

批量修改脚本（一次性）：
```js
// 保存为 _defer.js 然后 node _defer.js
const fs=require("fs");
const p="app/index.html";
let html=fs.readFileSync(p,"utf8");
html=html.replace(/<script([^>]*?)src=["']([^"']+)["']([^>]*?)>/g,(m,a1,src,a2)=>{
  if(a1.includes("defer")||a1.includes("async")||a2.includes("defer")||a2.includes("async")) return m;
  return '<script'+a1+' src="'+src+'" defer'+a2+'>';
});
fs.writeFileSync(p,html);
```

### 2.2 inline script 引用 OS 的时序修复（P0 · 配套 2.1）

defer 后所有外部 script 在 DOMContentLoaded 前执行；body 尾部 inline `<script>` 是立即执行的。
如果 inline script 引用 `OS.xxx`（OS 在 util.js 这个 defer 脚本里创建），就会炸：
```
ReferenceError: OS is not defined  at index.html:469
```

**修法**：把 OS 引用包到 DOMContentLoaded 回调里：
```html
<script>
// 原代码立即执行会因 OS 未就绪炸
// OS.prompt = function(){ ... };

// 修后：等所有 defer 脚本执行完（OS 已创建）再挂
document.addEventListener('DOMContentLoaded', function(){
  OS.prompt = function(msg, def){ return new Promise(...); };
  OS.confirm = ...
  OS.alert = ...
  // window.prompt = OS.prompt 兜底也要在这里
});
</script>
```

### 2.3 按需懒加载（P1 · 大刀阔斧）

大库（> 200KB）且不是启动必需的，别进 index.html，用 `import()` 或 `new Function('return require')()` 按需加载：
- **xlsx.full.min.js** (861KB) → 点"导入 Excel"再加载
- **pdf.worker.min.js** (1062KB) → 进 PDF 模式再加载
- **tesseract.min.js** (66KB) + **worker.min.js** (123KB) → 点"OCR"再 new Worker
- **docx.umd.min.js** (378KB) → 点"导出 Word"再加载

加载后挂到 `OS.Xxx = window.Xxx` 缓存，下次直接用。

### 2.4 vendor 层打包合并（P2 · 构建时）

如果用 webpack/vite，可以把 vendor 拆成 2 个 chunk：
- `vendor-core.js` — FileSaver + jszip + fontkit（启动必需，~482KB）
- `vendor-heavy.js` — xlsx + pdf + pdf-lib + tesseract + docx（懒加载）

---

## 🛠️ 步骤三：文件打开慢的优化模式

拿到 4 段 timing 数据后，按"最慢段优先"处理：

### 情况 A：Read 慢（> 500ms）
- 大文件（> 50MB）用分片读取：`file.slice()` + 分段 `arrayBuffer()`
- 加 loading toast，让用户看到进度

### 情况 B：Parse 慢（> 1s）
- **JSZip**：`JSZip.loadAsync(buf, { streamFiles: true })` 懒解压
- **多 sheet**：XMind 只取第一个 sheet（本项目已做）；Excel 按需读取 sheetN.xml
- **XML 解析**：`fast-xml-parser` 替换 DOMParser（2-5×）
- **JSON.parse 48841 节点**：先只解析 rootTopic + 第一层，后续层用 `JSON.parse` 子串

### 情况 C：Layout 慢（> 500ms）
- 递归布局加 **memoization**：`fitSig` 缓存（本项目已做，防止重复 measureText）
- 大节点集用**非递归队列**替递归（避免 stack overflow + 更快）
- 布局结果缓存到 `doc._layoutCache`，dirty=false 时跳过

### 情况 D：Render 慢（> 1s）
- **SVG path 批量优化**：把边数组 join 成一个大 `<path d="M...C...M...C...">`（当前每条边一个 path）
- **节点分批 requestIdleCallback**：首 200 个同步渲染立即可见，剩余在浏览器空闲时追加
- `innerHTML = ""` + 重建 — 大节点集下换成 `removeChild` 批量
- `console.time/timeEnd` 保留在 render 里持续观测

---

## ⚠️ 坑清单（本项目踩过）

| # | 坑 | 现象 | 根因 | 修 |
|---|----|------|------|----|
| 1 | **inline script 立即引用 OS** | `ReferenceError: OS is not defined` | defer 后外部脚本还没执行，body 末尾 inline script 就跑了 | 包 `DOMContentLoaded` |
| 2 | **PowerShell `$host` 是只读自动变量** | `Cannot overwrite variable Host` | PowerShell 保留了 `$Host`（大小写不敏感） | 用 `$tgt`/`$hst` 等 |
| 3 | **Set-Content 默认写 UTF-8 BOM** | Nginx 报 `unknown directive "﻿#"` | BOM 被当成第一个字符 | `[System.IO.File]::WriteAllText($path,$content,UTF8Encoding($false))` |
| 4 | **`tail`/`head` 不是 Windows 原生命令** | `The term 'tail' is not recognized` | 没装 Git Bash / WSL | PowerShell 用 `Select-Object -Last N` / `-First N` |
| 5 | **`defer` 执行顺序严格保序** | 改对了不生效 | defer 脚本顺序保持 `<script>` 在 HTML 里的位置；如果 A 依赖 B，B 必须排在 A 前面 | 检查依赖拓扑，调 HTML 顺序 |
| 6 | **sync → defer 后 PDF text 编辑器爆炸** | `pdf-lib is not defined` | pdf-text-edit.js 顶层立即 `pdfjsLib.xxx`；但 pdf.min.js 已 defer 还没执行 | 给 pdf-text-edit.js 顶层包 IIFE 或 DOMContentLoaded（类似 坑 1）|
| 7 | **大 XMind 节点 NaN path** | `Error: <path> attribute d: Expected number, "MNaN,0 ..."` | layoutMap 没覆盖所有孤立节点 | 递归后强制 `place` 孤立节点 + edgePath 检查 `Number.isFinite` |
| 8 | **Electron 禁止 HardwareAcceleration** | 360 安全卫士拦截进程崩溃 | `app.disableHardwareAcceleration()` | main.js 顶部加 |

---

## ✅ 完成定义（本项目）

| 检查项 | 期望 |
|--------|------|
| 冷启动 ready 时间 | < 1s（已实测 483ms） |
| 打开中等 XMind | < 2s（48841 节点拆解后 Parse + Layout + Render 各段 < 1s） |
| HEAD sync KB | < 500KB（已实测 0KB 全 defer） |
| 测试套件 | **95/95 通过** |
| 四端同源 | sync-clients.js --check ✅ |
| 无 ReferenceError | 启动后 F12 Console 无红 |

---

## 📚 项目基线（v1.1.2 · defer 化后）

```
启动阶段 timing:
  [DIAG] 诊断层就绪           +167ms    (html → head script → body)
  [OS.PDFTextEditor] 初始化   +313ms    (pdf-lib is ready — defer script 全部执行完)
  [DIAG] shell phase 工具就绪  +321ms    (shell.js IIFE 挂 OS.shell)
  [DB] IndexedDB open          +322ms    (store.js 打开 DB)
  ──────────────────────────────────────
  总冷启动 DOMContentLoaded     ~483ms   (从 electron 启动到 shell 可交互)
```
