#!/usr/bin/env node
/** 不同规模 mindmap mount 时间缩放测试 */
const WebSocket = require("ws");

async function main() {
  const r = await fetch("http://127.0.0.1:9222/json");
  const t = await r.json();
  const page = t.find(x => x.type === "page");
  if (!page) { console.error("no page"); process.exit(1); }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.on("open", res); ws.on("error", rej); });

  let id = 0;
  function send(method, params = {}, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
      const myId = ++id; let done = false;
      const timer = setTimeout(() => { if (!done) { done = true; reject(new Error("timeout " + timeoutMs + "ms")); } }, timeoutMs);
      ws.on("message", msg => {
        const d = JSON.parse(msg);
        if (d.id === myId && !done) { done = true; clearTimeout(timer); if (d.error) reject(new Error(d.error.message)); else resolve(d.result); }
      });
      ws.send(JSON.stringify({ id: myId, method, params }));
    });
  }

  console.log("=== MindMap mount 缩放测试（优化后）===");
  console.log("| nodes | mount ms |");
  console.log("|-------|---------:|");

  for (const N of [50, 100, 300, 500, 800, 1000, 2000, 3000]) {
    const code = `
      (async () => {
        const nodes = [{id:'n0',x:0,y:0,text:'root',color:'#1e3a5f',parent:null,isRoot:true,fontSize:16}];
        for(let i=1;i<${N};i++){
          nodes.push({id:'n'+i,x:0,y:0,text:'节点'+i,color:'#2563eb',fontSize:14,parent:'n'+Math.floor(Math.random()*Math.min(i,200)),shape:'rounded'});
        }
        const doc={id:'p',type:'mindmap',name:'p',data:{mode:'map',nodes,edges:[],rootId:'n0'}};
        const host=document.createElement('div');
        host.className='mm-container';
        document.body.appendChild(host);
        const t0=performance.now();
        OS.modules.mindmap.mount(host,doc,{markDirty:()=>{}});
        return Math.round(performance.now()-t0);
      })()
    `;
    const result = await send("Runtime.evaluate", { expression: code, awaitPromise: true, returnByValue: true }, 15000);
    const ms = result.result?.value ?? "?";
    console.log(`| ${String(N).padStart(5)} | ${String(ms).padStart(8)} |`);
    await new Promise(r => setTimeout(r, 100));
  }
  ws.close();
}

main().catch(e => { console.error(e); process.exit(1); });
