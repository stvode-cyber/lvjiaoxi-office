#!/usr/bin/env node
/** 诊断主线程是否被阻塞 — 通过 Runtime.evaluate 测试 */
const WebSocket = require("ws");

async function main() {
  const r = await fetch("http://127.0.0.1:9222/json");
  const t = await r.json();
  const page = t.find(x => x.type === "page");
  if (!page) { console.error("no page"); process.exit(1); }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.on("open", res); ws.on("error", rej); });

  let id = 0;
  function send(method, params = {}, timeoutMs = 2000) {
    return new Promise((resolve, reject) => {
      const myId = ++id;
      let done = false;
      const to = setTimeout(() => {
        if (!done) { done = true; reject(new Error("timeout " + timeoutMs + "ms — 主线程被阻塞")); }
      }, timeoutMs);
      ws.on("message", (msg) => {
        const d = JSON.parse(msg);
        if (d.id === myId && !done) {
          done = true; clearTimeout(to);
          if (d.error) reject(new Error(d.error.message));
          else resolve(d.result);
        }
      });
      ws.send(JSON.stringify({ id: myId, method, params }));
    });
  }

  console.log("=== 诊断主线程 ===");

  // Test 1: 简单 evaluate
  try {
    const r1 = await send("Runtime.evaluate", { expression: "1 + 1", returnByValue: true });
    console.log("✅ T1 1+1:", r1.result?.value);
  } catch (e) { console.log("❌ T1:", e.message); }

  // Test 2: document.title
  try {
    const r2 = await send("Runtime.evaluate", { expression: "document.title", returnByValue: true });
    console.log("✅ T2 title:", r2.result?.value);
  } catch (e) { console.log("❌ T2:", e.message); }

  // Test 3: performance.now() — 每次 evaluate 间隔 1s 调用两次
  try {
    const r3a = await send("Runtime.evaluate", { expression: "performance.now()", returnByValue: true });
    await new Promise(r => setTimeout(r, 1000));
    const r3b = await send("Runtime.evaluate", { expression: "performance.now()", returnByValue: true });
    const diff = r3b.result?.value - r3a.result?.value;
    console.log("✅ T3 performance.now():", r3a.result?.value, "→", r3b.result?.value, "(diff ~1000ms:", diff?.toFixed(1), "ms)");
  } catch (e) { console.log("❌ T3:", e.message); }

  // Test 4: 检查 document.readyState
  try {
    const r4 = await send("Runtime.evaluate", { expression: "document.readyState", returnByValue: true });
    console.log("✅ T4 readyState:", r4.result?.value);
  } catch (e) { console.log("❌ T4:", e.message); }

  // Test 5: 打印 console.log 看是否有反应
  try {
    const r5 = await send("Runtime.evaluate", { expression: "console.log('[CDP-DIAG] hello from injected code')", returnByValue: true });
    console.log("✅ T5 console.log injected (check cdp-capture for new entry)");
  } catch (e) { console.log("❌ T5:", e.message); }

  ws.close();
  console.log("\n=== 诊断完成 ===");
}

main().catch(e => { console.error(e); process.exit(1); });
