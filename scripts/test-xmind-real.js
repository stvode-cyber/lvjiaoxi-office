#!/usr/bin/env node
/** 真实 XMind 文件导入测试 — 绕过 CSP 问题 */
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
  function send(method, params = {}, timeoutMs = 30000) {
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

  // 同步读 base64（在 Node 端，不走 CSP）
  const b64 = fs.readFileSync(FILE, "base64");
  console.log("📦 Loaded XMind:", b64.length, "base64 chars,", fs.statSync(FILE).size, "bytes");

  const code = `
    (async () => {
      const t0 = performance.now();
      console.log('[REAL] === XMind 导入测试 ===');
      
      // base64 → Uint8Array（同步，不走 fetch，不受 CSP 限制）
      const bin = atob(${JSON.stringify(b64)});
      const buf = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
      const blob = new Blob([buf], { type: 'application/vnd.xmind.workbook' });
      const file = new File([blob], 'test-big.xmind', { type: 'application/vnd.xmind.workbook' });
      console.log('[REAL] File created, size=' + file.size, '(' + Math.round(file.size/1024) + 'KB)');
      
      try {
        // ===== 解析 XMind =====
        console.log('[REAL] calling OS.Importer.importFile...');
        console.time('[REAL] parse');
        const r = await OS.Importer.importFile(file, (s, p) => {
          console.log('[REAL] step:', s, Math.round(p*100) + '%');
        });
        console.timeEnd('[REAL] parse');
        console.log('[REAL] ✅ parse OK! nodes=' + r.data?.nodes?.length, 'rootId=' + r.data?.rootId);

        // ===== store.create =====
        console.log('[REAL] calling OS.store.create...');
        console.time('[REAL] create');
        const doc = await OS.store.create({ type: r.type, name: 'test-big' });
        doc.data = r.data; doc.compat = r.compat || 'B';
        console.timeEnd('[REAL] create');

        // ===== store.put（JSON.stringify + IndexedDB）=====
        const sz = JSON.stringify(doc.data).length;
        console.log('[REAL] calling OS.store.put... data.size=' + sz + ' (' + Math.round(sz/1024) + 'KB)');
        console.time('[REAL] put');
        await OS.store.put(doc);
        console.timeEnd('[REAL] put');
        console.log('[REAL] ✅ store.put OK');

        const total = Math.round(performance.now() - t0);
        console.log('[REAL] === 🎉 ALL OK total=' + total + 'ms ===');
        return 'OK ' + r.data.nodes.length + 'nodes total=' + total + 'ms';
      } catch (e) {
        console.log('[REAL] ❌ FAIL:', e.message);
        console.log(e.stack);
        return 'FAIL: ' + e.message;
      }
    })()
  `;

  console.log("⏳ Injecting...");
  let result;
  try {
    result = await send("Runtime.evaluate", {
      expression: code,
      awaitPromise: true,
      returnByValue: true
    }, 60000);
    console.log("✅ evaluate done:", result.result?.value);
  } catch (e) {
    console.log("❌ evaluate FAIL:", e.message);
  }

  ws.close();
}

main().catch(e => { console.error("FATAL:", e); process.exit(1); });
