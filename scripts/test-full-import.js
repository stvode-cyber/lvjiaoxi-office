#!/usr/bin/env node
/** 完整导入链路测试 — 包含 openDoc（之前绕过了） */
const WebSocket = require("ws");
const fs = require("fs");
const path = require("path");

const FILE = path.resolve("logs/test-big.xmind");

async function main() {
  const r = await fetch("http://127.0.0.1:9222/json");
  const t = await r.json();
  const page = t.find(x => x.type === "page");
  if (!page) { console.error("no page"); process.exit(1); }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.on("open", res); ws.on("error", rej); });

  let id = 0;
  function send(method, params = {}, timeoutMs = 60000) {
    return new Promise((resolve, reject) => {
      const myId = ++id; let done = false;
      const timer = setTimeout(() => { if (!done) { done = true; reject(new Error("timeout " + timeoutMs + "ms")); } }, timeoutMs);
      ws.on("message", msg => {
        const d = JSON.parse(msg);
        if (d.id === myId && !done) { done = true; clearTimeout(timer); if (d.error) reject(new Error(d.error.message)); else resolve(d.result); }
      });
      ws.send(JSON.stringify({ id: myId, method, params }));
    });
  }

  const b64 = fs.readFileSync(FILE, "base64");
  console.log("📦 Loaded XMind:", b64.length, "base64 chars");

  // 先找到 shell.js 暴露的 openDoc — 它在闭包里，得找全局引用
  // 方案：走 file input change — 但更简单：直接用 Tasks.run 触发完整流程
  // 方案3：模拟真实用户点"导入文件"按钮 + 给 file input 设置文件
  // 但 Page.setInputFiles 需要 nodeId... 先用最简单的 — OS.Importer + store + 找 openDoc
  
  // 从 window 上找 openDoc（它应该被暴露到某处）
  const findOpenDoc = await send("Runtime.evaluate", {
    expression: `
      (() => {
        // 遍历 window 找包含 openDoc 的函数
        for (const k of Object.keys(window)) {
          try {
            const v = window[k];
            if (typeof v === 'object' && v && typeof v.openDoc === 'function') {
              return { module: k, hasOpenDoc: true };
            }
          } catch(e) {}
        }
        return { hasOpenDoc: false, OS: typeof OS, Shell: typeof Shell };
      })()
    `,
    returnByValue: true
  });
  console.log("openDoc 暴露在哪？", JSON.stringify(findOpenDoc.result?.value));

  // 终极方案：从 shell.js 里的 importFileObj 触发完整链路
  // importFileObj 是闭包的，但它被绑在 file input 的 change 事件上
  // 用 Page.setInputFiles 给 file input 设置真实文件路径 + dispatchEvent change!
  
  // 先找 file input 的 nodeId
  const inputInfo = await send("Runtime.evaluate", {
    expression: `
      (() => {
        const input = document.querySelector('input[type="file"]');
        if (!input) return { found: false };
        return { found: true, id: input.id, className: input.className };
      })()
    `,
    returnByValue: true
  });
  console.log("file input:", JSON.stringify(inputInfo.result?.value));

  if (inputInfo.result?.value?.found) {
    // 用 DOM.setFileInputFiles — 需要 FileSystemPath
    // 但更简单：构造 File → dispatchEvent
    const code = `
      (async () => {
        console.log("[AUTO-IMPORT] === 完整链路测试 ===");
        console.time("[AUTO-IMPORT] total");
        
        const b64 = ${JSON.stringify(b64)};
        const bin = atob(b64);
        const buf = new Uint8Array(bin.length);
        for(let i=0;i<bin.length;i++) buf[i] = bin.charCodeAt(i);
        const blob = new Blob([buf], { type: 'application/vnd.xmind.workbook' });
        const file = new File([blob], 'test-big.xmind', { type: 'application/vnd.xmind.workbook' });
        
        // 方法1：直接走 OS.Importer + store + shell.openDoc（如果能找到）
        // 方法2：触发 file input change 让 shell.importFileObj 接住
        const input = document.querySelector('input[type="file"]');
        if (!input) { console.log("[AUTO-IMPORT] ❌ no file input"); return; }
        
        // 给 input.files 手动赋值（需要 DataTransfer）
        const dt = new DataTransfer();
        dt.items.add(file);
        input.files = dt.files;
        console.log("[AUTO-IMPORT] files set:", input.files.length);
        
        // 触发 change 事件 — shell.js importFileObj 会接住！
        const changeEvt = new Event('change', { bubbles: true });
        console.time("[AUTO-IMPORT] dispatching change");
        input.dispatchEvent(changeEvt);
        
        // 等 Tasks.run 完成（shell.js 里 importFileObj 包了 Tasks.run）
        // 简单方案：等 5s 让事件处理完毕
        console.log("[AUTO-IMPORT] waiting for Tasks...");
        await new Promise(r => setTimeout(r, 5000));
        
        // 检查 tab 数
        const tabCount = document.querySelectorAll('.tab').length;
        const activeTab = document.querySelector('.tab.active')?.dataset.id || 'none';
        console.log("[AUTO-IMPORT] after 5s wait:", tabCount, "tabs, active=", activeTab);
        
        return "triggered change — see capture log for [OPEN-DOC] timing";
      })()
    `;
    let result;
    try {
      result = await send("Runtime.evaluate", { expression: code, awaitPromise: true, returnByValue: true }, 30000);
      console.log("✅ Result:", result.result?.value);
    } catch (e) {
      console.log("❌ FAIL:", e.message);
    }
  }

  ws.close();
}

main().catch(e => { console.error("FATAL:", e); process.exit(1); });
