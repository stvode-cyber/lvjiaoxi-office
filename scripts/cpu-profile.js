#!/usr/bin/env node
/** CPU Profile 采集 —— 卡死时抓主线程热点 */
const WebSocket = require("ws");
const fs = require("fs");

async function main() {
  const r = await fetch("http://127.0.0.1:9222/json");
  const t = await r.json();
  const page = t.find(x => x.type === "page");
  if (!page) { console.error("❌ no page target"); process.exit(1); }

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.on("open", res); ws.on("error", rej); });
  console.log("✅ CDP connected");

  let id = 0;
  const send = (m, p = {}) => ws.send(JSON.stringify({ id: ++id, method: m, params: p }));

  // 开启 Profiler
  send("Profiler.enable");
  send("Profiler.start");
  console.log("🎯 CPU Profile started — 现在去 Electron 里复现卡死！");
  console.log("⏳ 35s 后自动 stop 并保存 profile ...");

  // 35s 后 stop
  setTimeout(() => send("Profiler.stop"), 35000);

  ws.on("message", msg => {
    const d = JSON.parse(msg);
    // Profiler.stop 的 result
    if (d.result && d.result.profile && d.result.profile.nodes) {
      const profile = d.result.profile;
      fs.mkdirSync("logs", { recursive: true });
      const f = `logs/cpu-profile-${Date.now()}.cpuprofile`;
      fs.writeFileSync(f, JSON.stringify(profile));
      console.log(`\n💾 Profile saved → ${f}`);
      console.log(`   Nodes: ${profile.nodes.length}, Samples: ${profile.samples?.length || 0}`);

      // --- 分析热点 ---
      const totalTime = profile.endTime - profile.startTime;
      console.log(`   Duration: ${(totalTime / 1000).toFixed(2)}s`);

      // 统计每个 function 的 hit count（在 samples 的 stack 中出现的次数）
      const hitCount = new Map();
      const nodesById = new Map();
      profile.nodes.forEach(n => nodesById.set(n.id, n));

      // samples 是节点 id 序列（每个 sample 的叶子节点）
      // 每个 sample 路径上所有节点都加 1
      if (profile.samples && profile.stackFrames) {
        // V8 CPU profile 格式
        profile.samples.forEach(nodeId => {
          let n = nodesById.get(nodeId);
          while (n) {
            const fn = n.callFrame?.functionName || "(anon)";
            const url = (n.callFrame?.url || "").split("/").pop() || "";
            const key = `${fn} @ ${url}`;
            hitCount.set(key, (hitCount.get(key) || 0) + 1);
            n = nodesById.get(n.parent);
          }
        });
      }

      const top = [...hitCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);
      console.log("\n🔥 TOP 20 HOTSPOTS (by hit count):");
      top.forEach(([k, v], i) => {
        const pct = ((v / (profile.samples?.length || 1)) * 100).toFixed(1);
        console.log(`  ${String(i+1).padStart(2)}. [${pct.padStart(5)}%] ${k}`);
      });

      ws.close();
      process.exit(0);
    }
  });
}

main().catch(e => { console.error(e); process.exit(1); });
