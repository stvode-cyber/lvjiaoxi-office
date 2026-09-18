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
      await evalCode(ws, `try { OS.shell.goHome(); } catch(e){}`);
      await new Promise((r) => setTimeout(r, 400));
      await evalCode(ws, `try { OS.shell.newDoc("pdf"); } catch(e){ console.error("ND ERR:", e.message); }`);
      await new Promise((r) => setTimeout(r, 2500));
      const dom = await evalCode(
        ws,
        `JSON.stringify({
          canvases: document.querySelectorAll(".pdf-view canvas.pdf-page").length,
          pageBoxes: document.querySelectorAll(".pdf-page-box").length,
          hasEmptyBtn: !!document.querySelector(".pdf-empty [data-act=open]"),
          viewHTMLlen: (document.querySelector(".pdf-view")?.innerHTML || "").length,
          title: document.getElementById("doc-title").textContent
        })`
      );
      console.log("newDoc DOM:", dom);
      const r = JSON.parse(dom);
      console.log("\n=== 检查 ===");
      console.log((r.pageBoxes > 0 ? "✅" : "❌") + " pdf-page-box x " + r.pageBoxes);
      console.log((r.canvases > 0 ? "✅" : "❌") + " canvas x " + r.canvases);
      console.log((!r.hasEmptyBtn ? "✅" : "❌") + " no old 'open PDF' btn");
      console.log((r.viewHTMLlen > 50 ? "✅" : "❌") + " pdf-view has content (" + r.viewHTMLlen + ")");
      if (r.canvases > 0 && !r.hasEmptyBtn && r.viewHTMLlen > 50) {
        console.log("\n🎉🎉🎉 NEW PDF SHOWS BLANK A4 PAGE!");
      } else {
        console.log("\n❌ FAILED");
      }
      ws.close();
    } catch (e) {
      console.error("ERR:", e.message);
      ws.close();
    }
  });
})();
