const w = require("ws");

async function evalExpr(expr, waitForLogs = false, timeout = 10000) {
  const resp = await fetch("http://127.0.0.1:9222/json");
  const targets = await resp.json();
  const page = targets.find((t) => t.type === "page");
  const ws = new w(page.webSocketDebuggerUrl);
  let id = 0;
  const send = (method, params) => ws.send(JSON.stringify({ id: ++id, method, params }));
  
  return new Promise((resolve) => {
    const logs = [];
    setTimeout(() => { ws.close(); resolve({ logs }); }, timeout);
    
    ws.on("open", () => {
      send("Runtime.enable");
      send("Runtime.evaluate", { expression: expr, returnByValue: false });
      if (!waitForLogs) {
        setTimeout(() => { ws.close(); resolve({ logs }); }, 2000);
      }
    });
    ws.on("message", (msg) => {
      const d = JSON.parse(msg.toString());
      if (d.method === "Runtime.consoleAPICalled") {
        const text = (d.params.args || []).map(a => a.value !== undefined ? a.value : a.description).join(" ");
        logs.push(text);
        console.log("📟", text);
      } else if (d.id && !waitForLogs) {
        // 立即 resolve
      }
    });
  });
}

(async () => {
  // 先加 unhandledrejection 监听
  await evalExpr(`
    window.__logs = [];
    window.addEventListener('unhandledrejection', e => {
      console.error('UNHANDLED:', e.reason?.message || e.reason);
      console.error(e.reason?.stack || '');
    });
    console.log('listener installed');
  `);

  // 触发 create + put
  await evalExpr(`
    (async () => {
      try {
        console.log('A: calling store.create mindmap...');
        const doc = await OS.store.create({ type: "mindmap", name: "test-debug" });
        console.log('B: created! id=' + doc.id, 'data keys:', Object.keys(doc.data || {}));
        
        // 模拟 xmind import 返回的数据
        doc.data = {
          rootId: "root-1",
          nodes: [{ id: "root-1", x: 0, y: 0, text: "root", parent: null, isRoot: true, color: "#4a90d9", shape: "roundRect", fontSize: 16 }],
          edges: []
        };
        console.log('C: data set, calling put...');
        
        await OS.store.put(doc);
        console.log('D: put OK! doc.id=' + doc.id);
      } catch(e) {
        console.error('CATCH:', e.message);
        console.error(e.stack);
      }
    })();
  `, true, 8000);
})();
