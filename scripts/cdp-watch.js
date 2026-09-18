const w = require("ws");

async function connect() {
  const resp = await fetch("http://127.0.0.1:9222/json");
  const targets = await resp.json();
  const page = targets.find((t) => t.type === "page");
  if (!page) { console.log("no page"); process.exit(1); }

  const ws = new w(page.webSocketDebuggerUrl);

  ws.on("open", () => {
    console.log("✅ CDP — 启动后自动导入一个 xmind 试试（或等待下一次手动导入）\n");
    ws.send(JSON.stringify({ id: 1, method: "Runtime.enable" }));
    ws.send(JSON.stringify({ id: 2, method: "Log.enable" }));
  });

  ws.on("message", (msg) => {
    const d = JSON.parse(msg.toString());
    if (d.id) return;
    if (d.method === "Runtime.exceptionThrown") {
      const ex = d.params.exceptionDetails;
      console.error("━━━ EXCEPTION ━━━");
      console.error("  text:", ex.text);
      if (ex.exception && ex.exception.value) console.error("  value:", ex.exception.value);
      if (ex.exception && ex.exception.description) console.error("  desc:", ex.exception.description);
      if (ex.stackTrace && ex.stackTrace.callFrames) {
        ex.stackTrace.callFrames.forEach((f, i) => {
          console.error(`  at ${f.functionName || "?"} (${f.url || ""}:${f.lineNumber}:${f.columnNumber})`);
        });
      }
    } else if (d.method === "Runtime.consoleAPICalled") {
      const text = (d.params.args || []).map(a => a.value !== undefined ? a.value : a.description).join(" ");
      console.log("📟", text);
    } else if (d.method === "Log.entryAdded") {
      const e = d.params.entry;
      console.log(`📋 [${e.level}] ${e.text?.slice(0, 200)}`);
    }
  });

  setTimeout(() => { ws.close(); process.exit(0); }, 120000);
}

connect().catch((e) => { console.error(e); process.exit(1); });
