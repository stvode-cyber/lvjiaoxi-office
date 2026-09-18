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
  let ws;
  try { ws = new WebSocket(await getWS()); } catch (e) { console.error(e.message); process.exit(1); }
  ws.on("open", async () => {
    try {
      // 最暴力的方法：读 mount 源码，截取主路径，手动加 try/catch
      const mountSrc = await evalCode(ws, `OS.modules.pdf.mount.toString()`);
      console.log("mount src len:", mountSrc.length);
      console.log("contains pdfLoadPdf:", mountSrc.includes("__pdfLoadPdf"));
      console.log("contains pdfMount:", mountSrc.includes("__pdfMount"));
      console.log("dataUrl truthy:", mountSrc.includes("data.dataUrl truthy"));

      // 看主路径前 2000 字符
      console.log("\n=== mount src head ===");
      console.log(mountSrc.slice(0, 2000));

      ws.close();
    } catch (e) {
      console.error("ERR:", e.message);
      try { ws.close(); } catch(_) {}
    }
  });
  ws.on("error", (e) => console.error("WS:", e.message));
})();
