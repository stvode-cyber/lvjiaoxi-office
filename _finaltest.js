const WebSocket = require("ws");
const fs = require("fs");
const http = require("http");
const b64 = fs.readFileSync("_sb.txt", "utf8").trim();

http.get("http://127.0.0.1:9222/json", (s) => {
  let d = ""; s.on("data", (c) => (d += c));
  s.on("end", async () => {
    const url = JSON.parse(d).find((x) => x.type === "page").webSocketDebuggerUrl;
    const ws = new WebSocket(url);
    await new Promise((r) => ws.on("open", r));
    console.log("CDP connected");
    
    async function evalCode(code, timeout = 15000) {
      return new Promise((rs, rj) => {
        const id = Math.floor(Math.random() * 1e9);
        const h = (msg) => {
          const m = JSON.parse(msg);
          if (m.id === id) { ws.off("message", h); rs(m.result.result.value); }
        };
        ws.on("message", h);
        ws.send(JSON.stringify({ id, method: "Runtime.evaluate", params: { expression: code, returnByValue: true, awaitPromise: true, timeout } }));
      });
    }
    
    // Step 1: mount + 轮询 __rp
    await evalCode(`
      const host = document.getElementById("module-host");
      while(host.firstChild) host.removeChild(host.firstChild);
      window.__rp = null;
      const fullUrl = "data:application/pdf;base64,${b64}";
      const nd = await window.OS.store.create({ type: "pdf", name: "t.pdf", data: { dataUrl: fullUrl, annotations: [] } });
      await window.OS.store.put(nd);
      window.OS.modules.pdf.mount(host, nd, { markDirty: ()=>{}, saveNow: ()=>{}, openBackstage: ()=>{} });
    `);
    console.log("mount 触发，开始轮询...");
    
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      const rp = await evalCode(`JSON.stringify(window.__rp)`);
      if (rp && rp !== "null" && rp !== "undefined") {
        console.log(`  t=${i}s __rp=`, rp);
      }
      if (rp && rp.includes('"step":"done"')) console.log(`  ✅ page ${JSON.parse(rp).page} done!`);
    }
    
    // Step 2: mount 源码检查
    const head = await evalCode(`OS.modules.pdf.mount.toString().includes("__rp")`);
    console.log("mount 含 __rp:", head);
    
    ws.close();
  });
});
