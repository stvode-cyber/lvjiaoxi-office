#!/usr/bin/env node
/** openDoc → mindmap mount 性能量化测试 */
const WebSocket = require("ws");

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

  // CPU Profile
  await send("Profiler.enable");
  console.log("=== openDoc 性能量化（3000 节点）===");

  const code = `
    (async () => {
      const N = 3000;
      console.log("[PERF] 造 " + N + " 节点 mindmap doc...");
      const nodes = [{ id: 'n0', x: 0, y: 0, text: '根节点', color: '#1e3a5f', parent: null, isRoot: true, fontSize: 16 }];
      for (let i = 1; i < N; i++) {
        nodes.push({
          id: 'n' + i, x: 0, y: 0,
          text: '节点' + i + '—' + 'x'.repeat(20),
          color: '#2563eb', fontSize: 14,
          parent: 'n' + Math.floor(Math.random() * Math.min(i, 200)),
          shape: 'rounded'
        });
      }
      const doc = { id: 'perf-test', type: 'mindmap', name: 'perf-test', data: { mode: 'map', nodes, edges: [], rootId: 'n0' } };
      console.log("[PERF] nodes.length=" + doc.data.nodes.length);

      // 模拟 shell.js 的 openDoc(doc) 流程
      const steps = {};

      // Step 1: 准备 host（shell.js 里 openDoc 会切 tab + show module）
      steps["1.查找host"] = performance.now();
      const host = document.querySelector('.mm-container') || document.querySelector('[data-module-host]');
      if (!host) {
        console.log("[PERF] 没有 mindmap host，先切到 dashboard 然后新建空白 mindmap...");
        // 直接调 OS.store.create('mindmap') 然后 openDoc
        // 但 openDoc 是 shell.js 闭包里的... 换方案：
        // 直接手动调用 mount
      }

      // Step 2: 直接手动 mount — 绕过 shell.js 闭包
      steps["2.mount-start"] = performance.now();
      const hostEl = host || (() => {
        // 造一个临时 host
        const d = document.createElement('div');
        d.className = 'mm-container';
        d.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;overflow:hidden;';
        document.body.appendChild(d);
        return d;
      })();
      console.log("[PERF] host ready, calling mindmap.mount...");

      try {
        const instance = OS.modules.mindmap.mount(hostEl, doc, { markDirty: ()=>{} });
        steps["3.mount-done"] = performance.now();
        const mountMs = Math.round(steps["3.mount-done"] - steps["2.mount-start"]);
        console.log("[PERF] mount 总耗时:", mountMs, "ms");

        // 打印 timeline
        console.log("[PERF] === TIMELINE ===");
        console.log("  mount:", mountMs, "ms");

        // 直接调 layoutMap + render 看各自耗时（mount 里已经调过一次，但内部有 console.time）
        // 我们用 perf 再加一层
        if (instance && instance.serialize) {
          console.log("[PERF] instance type:", typeof instance);
        }

        return { nodes: N, mountMs };
      } catch(e) {
        console.log("[PERF] ❌ mount FAIL:", e.message);
        console.log(e.stack);
        return "FAIL: " + e.message;
      }
    })()
  `;

  await send("Profiler.start");
  let result;
  try {
    result = await send("Runtime.evaluate", { expression: code, awaitPromise: true, returnByValue: true }, 60000);
    console.log("✅ Result:", JSON.stringify(result.result?.value));
  } catch (e) {
    console.log("❌ FAIL:", e.message);
  }
  const prof = await send("Profiler.stop");
  const profile = prof.profile;
  const nodesById = new Map();
  profile.nodes.forEach(n => nodesById.set(n.id, n));
  const hitCount = new Map();
  if (profile.samples) {
    profile.samples.forEach(nodeId => {
      let n = nodesById.get(nodeId);
      while (n) {
        const fn = n.callFrame?.functionName || "(anon)";
        const url = (n.callFrame?.url || "").split("/").pop() || "";
        const ln = n.callFrame?.lineNumber ?? -1;
        const key = `${fn} @ ${url}:${ln}`;
        hitCount.set(key, (hitCount.get(key) || 0) + 1);
        n = nodesById.get(n.parent);
      }
    });
  }
  const total = profile.samples?.length || 1;
  console.log(`\n🔥 HOTSPOTS (${total} samples):`);
  [...hitCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20).forEach(([k, v], i) => {
    const pct = ((v / total) * 100).toFixed(1);
    console.log(`  ${String(i+1).padStart(2)}. [${pct.padStart(6)}%] ${k}`);
  });
  ws.close();
}
main().catch(e => { console.error(e); process.exit(1); });
