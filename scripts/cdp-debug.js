const w = require("ws");
const ws = new w("ws://127.0.0.1:9222/devtools/page/17FDE4103172E5483CCBC185AF1C7E5C");
let id = 0;

function send(method, params) {
  ws.send(JSON.stringify({ id: ++id, method, params }));
}

ws.on("open", () => {
  console.log("✅ CDP connected");
  send("Runtime.enable");
  send("Log.enable");
  
  // 检查对象
  send("Runtime.evaluate", { expression: "typeof OS + ' | importer:' + (OS&&typeof OS.Importer) + ' | store.put:' + (OS&&OS.store&&typeof OS.store.put)", returnByValue: true });
  
  // 注入完整 hook
  send("Runtime.evaluate", { expression: `
    const _orig = OS.Importer.importFile;
    OS.Importer.importFile = async function(f, p) {
      const t0 = Date.now();
      console.log('[CDP] importFile START', f.name);
      const wp = (l, pp) => { console.log('[CDP] step:', l, 'p='+pp, 'el='+(Date.now()-t0)+'ms'); if(p) p(l,pp); };
      try { const r = await _orig.call(this, f, wp); console.log('[CDP] importFile OK total='+(Date.now()-t0)+'ms nodes='+((r&&r.data&&r.data.nodes&&r.data.nodes.length)||0)); return r; }
      catch(e) { console.error('[CDP] importFile FAIL:', e.message, 'el='+(Date.now()-t0)+'ms'); throw e; }
    };
    OS.Importer.importFile.__hooked = true;
    console.log('[CDP] ✅ hooked importFile');

    const _origPut = OS.store.put;
    OS.store.put = async function(doc) {
      const t0 = Date.now();
      console.log('[CDP] store.put START id='+doc.id);
      try { const r = await _origPut.apply(this, arguments); console.log('[CDP] store.put OK el='+(Date.now()-t0)+'ms'); return r; }
      catch(e) { console.error('[CDP] store.put FAIL:', e.message); throw e; }
    };
    OS.store.put.__hooked = true;
    console.log('[CDP] ✅ hooked store.put');

    const _origTx = OS.store._tx || null;
    console.log('[CDP] store has _tx?', !!_origTx);
    
    console.log('[CDP] ============ 注入完成 ============');
  `, returnByValue: true });
});

ws.on("message", (msg) => {
  const d = JSON.parse(msg.toString());
  if (d.id) {
    // 响应
    if (d.result && d.result.result) console.log("📊 eval:", d.result.result.value);
    else console.log("📊 resp:", JSON.stringify(d).slice(0, 200));
  } else if (d.method === "Runtime.consoleAPICalled") {
    const text = (d.params.args || []).map(a => a.value || a.description).join(" ");
    console.log("📟", text);
  } else if (d.method === "Log.entryAdded") {
    const e = d.params.entry;
    console.log("📋", e.level, e.text?.slice(0, 200));
  } else if (d.method === "Runtime.exceptionThrown") {
    console.error("❌ EXC:", d.params.exceptionDetails?.text?.slice(0, 200));
  }
});

console.log("⏳ 等 60s，快点去 Electron 里打开 .xmind！");
setTimeout(() => { ws.close(); process.exit(0); }, 60000);
