const WebSocket = require("ws");
const http = require("http");
function getWS() {
  return new Promise((res, rej) => {
    http.get("http://127.0.0.1:9222/json", (s) => {
      let d = "";
      s.on("data", (c) => (d += c));
      s.on("end", () => res(JSON.parse(d).find((x) => x.type === "page").webSocketDebuggerUrl));
    }).on("error", rej);
  });
}
async function evalCode(ws, code) {
  return new Promise((rs, rj) => {
    const id = Math.floor(Math.random() * 1e9);
    const h = (d) => {
      const m = JSON.parse(d);
      if (m.id === id) {
        ws.off("message", h);
        if (m.error) rj(new Error("CDP: " + m.error.message));
        else rs(m.result.result.value);
      }
    };
    ws.on("message", h);
    ws.send(
      JSON.stringify({
        id,
        method: "Runtime.evaluate",
        params: { expression: code, returnByValue: true, awaitPromise: true },
      })
    );
  });
}
(async () => {
  const ws = new WebSocket(await getWS());
  ws.on("open", async () => {
    try {
      // 1. blank() 函数
      const blank = await evalCode(ws, `JSON.stringify(OS.modules.pdf.blank())`);
      console.log("blank():", blank.slice(0, 100) + "...");

      // 2. store.create
      const doc = await evalCode(
        ws,
        `(async function(){ const d = await OS.store.create({ type: "pdf" }); return JSON.stringify(d); })()`
      );
      console.log("store.create:", doc.slice(0, 200));

      // 3. mount 源码检查
      const hasBlank = await evalCode(
        ws,
        `OS.modules.pdf.mount.toString().includes("BLANK_PDF_BASE64") || OS.modules.pdf.mount.toString().includes("data:application/pdf")`
      );
      console.log("mount has BLANK code:", hasBlank);

      ws.close();
    } catch (e) {
      console.error("ERR:", e.message);
      ws.close();
    }
  });
})();
