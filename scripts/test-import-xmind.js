#!/usr/bin/env node
/** 自动化导入测试 —— 完全模拟用户点文件选择器 */
const WebSocket = require("ws");
const fs = require("fs");
const path = require("path");

const XMIND_PATH = path.resolve("logs/test-big.xmind");
const XMIND_B64 = fs.readFileSync(XMIND_PATH, "base64");
const XMIND_SIZE = fs.statSync(XMIND_PATH).size;

async function main() {
  const r = await fetch("http://127.0.0.1:9222/json");
  const t = await r.json();
  const page = t.find(x => x.type === "page");
  if (!page) { console.error("no page"); process.exit(1); }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.on("open", res); ws.on("error", rej); });

  let id = 0;
  function send(method, params = {}, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
      const myId = ++id;
      let done = false;
      const to = setTimeout(() => { if (!done) { done = true; reject(new Error("timeout " + timeoutMs + "ms")); } }, timeoutMs);
      ws.on("message", (msg) => {
        const d = JSON.parse(msg);
        if (d.id === myId && !done) { done = true; clearTimeout(to); if (d.error) reject(new Error(d.error.message)); else resolve(d.result); }
      });
      ws.send(JSON.stringify({ id: myId, method, params }));
    });
  }

  // 开启 Network + DOM + IO
  await send("Runtime.enable");
  await send("DOM.enable");

  // 1) 找第一个 file input
  const fileInputEval = `
    (() => {
      const input = document.querySelector('input[type="file"]');
      if (!input) return null;
      const rect = input.getBoundingClientRect();
      return { found: true, tag: input.tagName, id: input.id, cls: input.className, w: rect.width, h: rect.height };
    })()
  `;
  const r1 = await send("Runtime.evaluate", { expression: fileInputEval, returnByValue: true });
  const inputInfo = r1.result?.value;
  console.log("1️⃣  file input:", inputInfo?.found ? `found (${inputInfo.id || inputInfo.cls})` : "NOT FOUND");
  if (!inputInfo?.found) {
    // 尝试触发文件选择按钮（可能需要先 render 它）
    console.log("   → 尝试从 dashboard 进入...");
    await send("Runtime.evaluate", {
      expression: `
        (() => {
          const btn = document.querySelector('[data-action="import"]') ||
                      document.querySelector('#sp-import') ||
                      document.querySelector('.tb-import-btn');
          if (btn) { btn.click(); return 'clicked ' + btn.id; }
          return 'no button';
        })()
      `,
      returnByValue: true
    });
    await new Promise(r => setTimeout(r, 500));
    // 再找一遍
    const r1b = await send("Runtime.evaluate", { expression: fileInputEval, returnByValue: true });
    console.log("   → 第二次查找:", r1b.result?.value?.found ? "found!" : "still not found");
  }

  // 2) 用 File 对象构造一个 XMind 文件，直接调用 importFileObj
  console.log("\n2️⃣  构造 File 对象 + 直接调用 importFileObj...");
  const injectImport = `
    (async () => {
      // 从 base64 构造 ArrayBuffer
      const b64 = "${XMIND_B64.slice(0, 50)}...${XMIND_B64.slice(-20)}";
      // 等等，b64 直接传太大了，换用 fs.readFileSync 走 CDP FileSystem
      // 直接用 Blob + File 构造
      const resp = await fetch("data:application/octet-stream;base64,${XMIND_B64}");
      const buf = await resp.arrayBuffer();
      const blob = new Blob([buf], { type: "application/vnd.xmind.workbook" });
      const file = new File([blob], "test-big.xmind", { type: "application/vnd.xmind.workbook" });
      console.log("[AUTO-IMPORT] File created, size=" + file.size);

      // 找 importFileObj — 它在 shell.js 的闭包里，但 OS.Tasks 是暴露的
      // 方案：直接用 OS.Importer.importFile + OS.store.create/put
      console.time("[AUTO-IMPORT] total");
      try {
        const r = await OS.Importer.importFile(file, (s, p) => {
          console.log("[AUTO-IMPORT] step:", s, Math.round(p*100) + "%");
        });
        console.log("[AUTO-IMPORT] parse done! r.type=", r.type, "data.nodes=", r.data?.nodes?.length);

        console.timeLog("[AUTO-IMPORT]", "before store.create");
        const doc = await OS.store.create({ type: r.type, name: "test-big" });
        console.timeLog("[AUTO-IMPORT]", "after store.create");

        doc.data = r.data;
        doc.compat = r.compat || "B";
        console.log("[AUTO-IMPORT] before store.put, data.size=" + JSON.stringify(doc.data).length);
        await OS.store.put(doc);
        console.timeLog("[AUTO-IMPORT]", "after store.put");

        // 不做 openDoc（那可能触发布局/渲染重操作）
        console.log("[AUTO-IMPORT] ✅ DONE! doc.id=", doc.id);
        console.timeEnd("[AUTO-IMPORT]");
        return "SUCCESS nodes=" + r.data?.nodes?.length;
      } catch(e) {
        console.log("[AUTO-IMPORT] ❌ FAIL:", e.message);
        console.log(e.stack);
        return "FAIL: " + e.message;
      }
    })();
  `;

  let result;
  try {
    result = await send("Runtime.evaluate", {
      expression: injectImport,
      awaitPromise: true,
      returnByValue: true
    }, 60000);  // 60s timeout
    console.log("✅ Result:", result.result?.value);
  } catch (e) {
    console.log("❌ evaluate FAIL:", e.message);
  }

  ws.close();
}

main().catch(e => { console.error("FATAL:", e); process.exit(1); });
