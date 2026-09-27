---
name: "electron-cdp-layout-debug"
description: "Electron CDP 实机布局诊断：启动带文件的 Electron → WebSocket 连 DevTools → Runtime.evaluate dump 尺寸链 + Page.captureScreenshot。Invoke when 用户反馈'显示不全/布局错乱/列表项被压扁但 scrollbar 也不出现'，或需要验证 flex 容器真实渲染尺寸时。"
---

# Electron CDP 实机布局诊断

## 触发条件

- 用户说 "显示不全" / "被截断" / "看不到" 但 DOM 结构代码看起来没问题
- Flex column 容器里列表项数量多（>5），scrollbar 不出现
- `scrollHeight == clientHeight` 看起来"没有溢出"但用户看到内容被压扁
- 修改 CSS 后说"没有变化" → 要确认是缓存、选择器没命中、还是根因找错了
- 需要验证 `flex-shrink:0` / `min-height:0` / `box-sizing:border-box` 等 flex 修复是否生效

## 完整流程（6 步）

### Step 0：准备

```powershell
# 清缓存（Electron 强缓存 CSS！不清 = 改了也白改）
Get-Process | Where-Object { $_.ProcessName -like "*electron*" } | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2
Remove-Item "$env:APPDATA\lvjiaoxi-office\Cache\*" -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item "$env:APPDATA\lvjiaoxi-office\Code Cache\*" -Recurse -Force -ErrorAction SilentlyContinue
```

### Step 1：启动带目标文件的 Electron

```powershell
# 关键：把待测试的文档路径作为 argv 传入，main.js 会自动 openFileAt
.\node_modules\.bin\electron.cmd . "C:\path\to\test.pptx" 2>&1
```

等 log 出现 `DevTools listening on ws://127.0.0.1:9222/devtools/browser/xxx` 说明启动完成。

### Step 2：发现正确的 CDP endpoint

**陷阱：不要用 browser endpoint！** 那个控制整个浏览器；要用 **page endpoint** 才能 `Runtime.evaluate`。

```powershell
$ep = ((Invoke-WebRequest -Uri "http://127.0.0.1:9222/json" -UseBasicParsing).Content | ConvertFrom-Json |
  Where-Object { $_.type -eq 'page' }).webSocketDebuggerUrl
Write-Host "WS: $ep"
```

### Step 3：Node.js CDP 脚本模板

保存为 `cdp-debug.js`（临时文件，用完清理）：

```javascript
const WebSocket = require('ws');
const fs = require('fs');
const ENDPOINT = process.argv[2]; // 从命令行注入，避免 PowerShell 变量转义地狱
const ws = new WebSocket(ENDPOINT);
let msgId = 0; const pending = {};

ws.on('message', raw => {
  const msg = JSON.parse(raw);
  if (msg.id && pending[msg.id]) { pending[msg.id](msg); delete pending[msg.id]; }
});
function send(method, params) {
  return new Promise(r => {
    const id = ++msgId; pending[id] = r;
    ws.send(JSON.stringify({ id, method, params }));
  });
}

(async () => {
  await new Promise(r => { ws.once('open', r); setTimeout(r, 3000); });
  await new Promise(r => setTimeout(r, 1500)); // 等 renderer mount + 异步渲染

  // === 在这里写你的 Runtime.evaluate 表达式 ===
  const d = await send('Runtime.evaluate', {
    expression: '/* 见下面的诊断表达式模板 */',
    returnByValue: true
  });
  const raw = d.result?.result?.value;
  const v = raw ? JSON.parse(raw) : {};
  console.log('DUMP:', JSON.stringify(v, null, 2));

  // 截图
  const ss = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync('debug-screenshot.png', Buffer.from(ss.result.data, 'base64'));
  console.log('PNG saved, size:', fs.statSync('debug-screenshot.png').size);

  ws.close(); process.exit(0);
})();
setTimeout(() => { console.log('TIMEOUT'); ws.close(); process.exit(1); }, 15000);
```

运行：
```powershell
node cdp-debug.js "$ep"
```

### Step 4：诊断表达式模板

#### 模板 A：Flex 容器压缩诊断（最常用）

```javascript
(function(){
  var sel = '.pres-thumbs';          // ← 改成你的容器选择器
  var childSel = '.pres-thumb';      // ← 子项选择器（或 null 表示 :scope > div）
  var box = document.querySelector(sel);
  if (!box) return JSON.stringify({error: 'not found: ' + sel});
  var children = childSel ? box.querySelectorAll(childSel) : box.children;
  var first = children[0];
  var last = children[children.length - 1];
  var csFirst = first ? getComputedStyle(first) : {};
  return JSON.stringify({
    container: {
      rectH: box.getBoundingClientRect().height,
      clientH: box.clientHeight,
      scrollH: box.scrollHeight,
      maxH: getComputedStyle(box).maxHeight,
      overflowY: getComputedStyle(box).overflowY,
      hasScrollbar: box.scrollHeight > box.clientHeight,
      boxSizing: getComputedStyle(box).boxSizing
    },
    children: {
      count: children.length,
      firstH: first ? first.offsetHeight : -1,
      firstScrollH: first ? first.scrollHeight : -1,
      lastH: last ? last.offsetHeight : -1,
      // 关键：如果 firstH << firstScrollH → 被 flex-shrink 压缩了
      flexShrink: csFirst.flexShrink,          // "0" = 正常, "1" = 默认可能被压
      flexGrow: csFirst.flexGrow,
      flexBasis: csFirst.flexBasis
    },
    parentChain: [
      '.module-wrap', '.module-host', '#editor', '.pres-wrap'
    ].map(function(s){
      var el = document.querySelector(s);
      return el ? { sel: s, h: el.offsetHeight, cs: getComputedStyle(el).minHeight } : null;
    })
  });
})()
```

#### 模板 B：Box-sizing / content-box 膨胀诊断

```javascript
(function(){
  var selectors = ['.pres-wrap', '.pres-thumbs', '.pres-canvas-area', '.pres-side'];
  return JSON.stringify(selectors.map(function(sel){
    var el = document.querySelector(sel);
    if (!el) return { sel: sel, found: false };
    var cs = getComputedStyle(el);
    // content-box: 实际总宽 = width + padding*2 + border*2 → 可能溢出 flex 容器
    return {
      sel: sel,
      boxSizing: cs.boxSizing,
      cssWidth: cs.width,
      padding: cs.padding,
      border: cs.border,
      offsetW: el.offsetWidth   // 实际渲染宽度（包含 padding+border，不管 box-sizing）
    };
  }));
})()
```

#### 模板 C：父级高度链条闭合诊断

```javascript
(function(){
  // flex 子项高度 = 0 的典型原因：某一级祖先没设 height/min-height
  var chain = ['html', 'body', '#app', '#editor', '.module-host', '.module-wrap', '.pres-wrap'];
  return JSON.stringify(chain.map(function(sel){
    var el = document.querySelector(sel);
    if (!el) return { sel: sel, found: false };
    var cs = getComputedStyle(el);
    return {
      sel: sel,
      offsetH: el.offsetHeight,
      cssH: cs.height,
      minH: cs.minHeight,
      display: cs.display,
      flex: cs.flex,
      overflow: cs.overflow
    };
  }));
})()
```

### Step 5：分析输出

**Flex 压缩判断：**
| 指标 | 含义 | 问题 |
|------|------|------|
| `firstH << firstScrollH`（如 7 vs 79） | 子项被压扁 | **flex-shrink 压缩** → 加 `flex-shrink:0` |
| `container.scrollH == container.clientH` 但 `count × firstScrollH > clientH` | 总固有高度 > 容器但没有滚动条 | flex-shrink 把所有子项压扁了 → 同上 |
| `flexShrink: "1"` (默认) | 没显式设 | 在 flex column + overflow 容器里应该设 `0` |
| `flexShrink: "0"` | 已显式设 | 正常，问题在别处 |

**Box-sizing 判断：**
| 指标 | 含义 | 问题 |
|------|------|------|
| `boxSizing: "content-box"` (默认) | padding/border 向外扩展 | 加 `box-sizing: border-box` |
| `boxSizing: "border-box"` | padding/border 算在 width 内 | 正常 |

**高度链条判断：**
| 指标 | 含义 | 问题 |
|------|------|------|
| 某级 `offsetH: 0` 或极小 | 祖先没传递高度 | 加 `flex:1; min-height:0` |
| 某级 `min-height` 是 `auto` 不是 `0` | flex 子项默认 min-height:auto 不收缩 | 显式设 `min-height:0` |

### Step 6：清理

```powershell
Remove-Item cdp-debug.js, debug-screenshot.png -ErrorAction SilentlyContinue
Get-Process | Where-Object { $_.ProcessName -like "*electron*" } | Stop-Process -Force -ErrorAction SilentlyContinue
```

## 常见陷阱

### 1. Browser Endpoint ≠ Page Endpoint
- `/devtools/browser/xxx` → 控制浏览器，不能 `Runtime.evaluate`
- `/devtools/page/xxx` → 控制渲染进程，**这个才是你要的**
- 通过 `http://127.0.0.1:9222/json` 拿 `type == "page"` 的 entry

### 2. PowerShell 变量注入坑
- Expression 里如果要拼字符串（如 `OS.store.get("'+id+'")`），单引号双引号在 PowerShell here-string + JS 字符串里会嵌套爆炸
- 解法：把 CDP 脚本存成 `.js` 文件，把 endpoint 当 `process.argv[2]` 注入，不拼接业务数据

### 3. 大文件 Base64 传输
- 不要用 `Runtime.evaluate` 传 >1MB 的 base64，WebSocket 会被截断
- 解法：用 main.js argv 传文件路径 → `electron.cmd . "C:\path\to\large.pdf"`（已支持）

### 4. CSS 缓存
- Electron 对静态资源（CSS/JS）缓存很激进，改了不生效大概率是缓存没清
- 每次改 CSS 后重启 Electron 必须删 `Cache/` 和 `Code Cache/`

### 5. `awaitPromise: true`
- 渲染器里的 `async` 函数必须加 `awaitPromise: true`，否则只返回 Promise 对象
- 返回值在 `d.result.result.value` 里，不是 `d.result.value`（两层！）

## 快速诊断 Checklist

拿到输出后按这个顺序判断：

1. **父级高度链条** — 每一级 offsetHeight 是否合理？有没有 0？
2. **容器 box-sizing** — content-box？加 border-box
3. **子项 flex-shrink** — column flex 里的固定高度子项有没有显式 `flex-shrink:0`？
4. **scrollHeight vs clientHeight** — 被压扁时两者会"假相等"，检查子项 scrollHeight 总和
5. **Electron 窗口尺寸** — minWidth/minHeight 会不会触发移动端 media query？（默认 960×640，Electron 默认 1280×860，一般不会）
