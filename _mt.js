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
      // 用 debugger 拦截 mount 的 throw
      const r = await evalCode(
        ws,
        `(async function(){
          // 在 window 上套 Error 捕获
          window.__mountError = null;
          const origCreate = document.createElement.bind(document);
          
          // 手动跑 mount 的每一步，逐段 try/catch
          try {
            window.__step = "a-create-wrap";
            const wrap = origCreate("div");
            wrap.className = "module-wrap";
            
            window.__step = "b-innerHTML";
            // 只放最小 innerHTML
            wrap.innerHTML = '<div class="pdf-wrap"><div class="pdf-view"></div></div>';
            
            window.__step = "c-append";
            const host = document.getElementById("module-host");
            while(host.firstChild) host.removeChild(host.firstChild);
            host.appendChild(wrap);
            
            window.__step = "d-loadPdf-try";
            const view = wrap.querySelector(".pdf-view");
            window.__step = "d-loadPdf-view-found:" + !!view;
            
            // 手动用 pdfjsLib 渲染
            const BLANK = "JVBERi0xLjcKJYGBgYEKCjUgMCBvYmoKPDwKL0ZpbHRlciAvRmxhdGVEZWNvZGUKL1R5cGUgL09ialN0bQovTiA0Ci9GaXJzdCAyMAovTGVuZ3RoIDI2OAo+PgpzdHJlYW0KeJzVkk1LxDAQhu/5FXPUy2aSpk0qpbD24yLCsnhy8RC2YSnIZklb0H/vpFkVD+JZwks+5pl8vSMAQYJSkIE2oCDPJFQV40/vFwd8Z09uYvxhHCY4UBRhDy+MN345zyBYXbNvtrGzffUnlpJARPiT2AU/LEcXoOq7vkfUiFgoUoEoW+obUkmSNKeYNDQmaXUVrekMMdtSrE8qdMqJ8ZXNr/kd9cQWkWkTq0yaf50bz+rSHvKv+5Q1449+aO3s4Ka9kygLLIUQShqVP9/SdwRnZ/9/H7fef/TnX1/4w+dobzQ5uFgDq8t87ya/hCPZTlwd/8sNo733b1Q1SC0v8400YJTYmJIqiJAPoB6PLQplbmRzdHJlYW0KZW5kb2JqCgo2IDAgb2JqCjw8Ci9TaXplIDcKL1Jvb3QgMiAwIFIKL0luZm8gMyAwIFIKL0ZpbHRlciAvRmxhdGVEZWNvZGUKL1R5cGUgL1hSZWYKL0xlbmd0aCAzNAovVyBbIDEgMiAyIF0KL0luZGV4IFsgMCA3IF0KPj4Kc3RyZWFtCnicFcQxDgAgCASwHsbdN/txCB2K7nLZstV24pF8BkOhArYKZW5kc3RyZWFtCmVuZG9iagoKc3RhcnR4cmVmCjM4NgolJUVPRg==";
            const dataUrl = "data:application/pdf;base64," + BLANK;
            
            view.innerHTML = "<p>加载中…</p>";
            window.__step = "e-getDocument";
            const loading = window.pdfjsLib.getDocument(dataUrl);
            const pdfDoc = await loading.promise;
            window.__step = "f-got-doc pages=" + pdfDoc.numPages;
            
            const page = await pdfDoc.getPage(1);
            view.innerHTML = "";
            const pageBox = origCreate("div");
            pageBox.className = "pdf-page-box";
            const canvas = origCreate("canvas");
            canvas.className = "pdf-page";
            pageBox.appendChild(canvas);
            view.appendChild(pageBox);
            
            canvas.width = 300; canvas.height = 400;
            const ctx = canvas.getContext("2d");
            await page.render({ canvasContext: ctx, viewport: page.getViewport({ scale: 1 }) }).promise;
            window.__step = "g-RENDERED";
            
            return { ok: true, canvases: view.querySelectorAll("canvas").length };
          } catch(e) {
            return { err: e.message, stack: (e.stack || "").slice(0, 200), step: window.__step };
          }
        })()`
      );
      console.log("result:", typeof r === "string" ? r : JSON.stringify(r));
      ws.close();
    } catch (e) {
      console.error("ERR:", e.message);
      try { ws.close(); } catch(_) {}
    }
  });
  ws.on("error", (e) => console.error("WS:", e.message));
})();
