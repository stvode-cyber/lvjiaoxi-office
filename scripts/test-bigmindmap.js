#!/usr/bin/env node
/** 自动化复现：造巨型 mindmap + store.put + 抓热点 */
const WebSocket = require("ws");
const fs = require("fs");

async function main() {
  const r = await fetch("http://127.0.0.1:9222/json");
  const t = await r.json();
  const page = t.find(x => x.type === "page");
  if (!page) { console.error("no page"); process.exit(1); }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.on("open", res); ws.on("error", rej); });

  let id = 0;
  function send(method, params = {}, timeoutMs = 10000) {
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

  console.log("=== 自动化 XMind 卡死复现 ===");

  // Step 1: 开 CPU Profile
  await send("Profiler.enable");
  await send("Profiler.start");
  console.log("✅ CPU Profile started");

  // Step 2: 注入巨型 mindmap 构造 + store.put
  const NODES = 3000;  // 足够大但不至于内存爆炸
  const injectCode = `
    (async () => {
      console.log('[TEST] 开始构造 mindmap，nodes=' + ${NODES});
      const nodes = [];
      nodes.push({ id: 'n0', x: 0, y: 0, text: '根节点', color: '#1e3a5f', parent: null, isRoot: true });
      for (let i = 1; i < ${NODES}; i++) {
        nodes.push({
          id: 'n' + i,
          x: Math.random() * 800 - 400,
          y: Math.random() * 600 - 300,
          text: '节点 ' + i + ' — 这是一段测试文字 ' + 'x'.repeat(50),
          color: '#' + Math.floor(Math.random()*0xffffff).toString(16).padStart(6,'0'),
          fontSize: 14,
          parent: 'n' + Math.floor(Math.random() * Math.min(i, 100)),
          shape: 'rounded'
        });
      }
      console.log('[TEST] 构造完成，nodes.length=' + nodes.length);

      // 直接调 store.create + put（shell.js 导入路径）
      const t0 = performance.now();
      console.log('[TEST] before store.create');
      const doc = await OS.store.create({ type: 'mindmap', name: 'test-big' });
      console.log('[TEST] store.create done, ' + (performance.now()-t0).toFixed(0) + 'ms');

      const t1 = performance.now();
      doc.data = { mode: 'map', nodes, edges: [], rootId: 'n0' };
      console.log('[TEST] before store.put — data.size=' + (typeof JSON.stringify === 'function' ? JSON.stringify(doc.data).length : '?'));
      await OS.store.put(doc);
      console.log('[TEST] store.put done, ' + (performance.now()-t1).toFixed(0) + 'ms');
      console.log('[TEST] 全部完成！');
      return 'OK ' + nodes.length + ' nodes';
    })().then(r => r, e => 'FAIL: ' + e.message);
  `;

  console.log(`⏳ 注入 ${NODES} 节点 mindmap...`);
  let evalResult;
  try {
    evalResult = await send("Runtime.evaluate", {
      expression: injectCode,
      awaitPromise: true,
      returnByValue: true
    }, 30000);  // 30s timeout — 如果还没回来说明卡了
    console.log("✅ evaluate result:", evalResult.result?.value);
  } catch (e) {
    console.log("❌ evaluate FAIL:", e.message);
    console.log("   ↓ 很可能就是卡在这里了！");
  }

  // Step 3: stop CPU Profile
  console.log("⏳ stopping CPU Profile...");
  await new Promise(r => setTimeout(r, 500));
  const profResult = await send("Profiler.stop");
  const profile = profResult.profile;
  fs.mkdirSync("logs", { recursive: true });
  const f = `logs/cpu-profile-bigmindmap-${Date.now()}.cpuprofile`;
  fs.writeFileSync(f, JSON.stringify(profile));
  console.log(`💾 Profile saved → ${f}`);

  // 分析热点
  console.log(`   Duration: ${((profile.endTime - profile.startTime)/1000).toFixed(2)}s, Samples: ${profile.samples?.length || 0}`);
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
  const top = [...hitCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25);
  console.log("\n🔥 TOP 25 HOTSPOTS:");
  top.forEach(([k, v], i) => {
    const pct = ((v / total) * 100).toFixed(1);
    console.log(`  ${String(i+1).padStart(2)}. [${pct.padStart(6)}%] ${k}`);
  });

  ws.close();
}

main().catch(e => { console.error("FATAL:", e); process.exit(1); });
