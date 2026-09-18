const WebSocket = require('ws');
async function main(){
  const r = await fetch('http://127.0.0.1:9222/json');
  const t = await r.json();
  const p = t.find(x=>x.type==='page');
  if (!p) { console.error('no page target'); return; }
  console.log('target:', p.url.substring(0, 60));
  const ws = new WebSocket(p.webSocketDebuggerUrl);
  await new Promise(res=>{ws.on('open',res);});
  let id = 0;
  const send = (m, p={}) => new Promise((res, rej) => {
    const myId = ++id; let done = false;
    ws.on('message', msg => { const d = JSON.parse(msg); if (d.id===myId && !done) { done=true; if(d.error) rej(new Error(d.error.message)); else res(d.result); }});
    ws.send(JSON.stringify({ id:myId, method:m, params:p }));
  });

  // 核心诊断
  const res = await send('Runtime.evaluate',{expression:'__diagnose()',returnByValue:true});
  const d = res.result.value;
  console.log('\n🩺 __diagnose() 结果:');
  console.log('时间:', d.time);
  console.log('最后 phase:', d.phase);
  d.phases.forEach(p=>console.log(' ', p.name, '→', p.ms==='STILL-RUNNING' ? '🔥 还在跑！卡在这里！' : p.ms+'ms'));
  if (d.slow_snapshots && d.slow_snapshots.length) {
    console.log('\n🐌 slow_snapshots (phase >3s):');
    d.slow_snapshots.forEach(s=>console.log(' ', s.name, '等了', Math.round(s.waited/1000)+'s', 'stack:', (s.stack||'').split('\n').slice(0,3).join(' | ')));
  }
  if (d.last_error) console.log('\n❌ last_error:', JSON.stringify(d.last_error).substring(0,500));
  if (d.last_reject) console.log('\n❌ last_reject:', JSON.stringify(d.last_reject).substring(0,500));

  // DOM 状态
  const domExpr = '(function(){ return { tabs: document.querySelectorAll(".tab").length, active: document.querySelector(".tab.active")?.dataset.id || "none", dashboardHidden: document.querySelector("#dashboard")?.hidden, editorHidden: document.querySelector("#editor")?.hidden, bodyChildCount: document.body.children.length, workbench: !!document.querySelector("#workbench") }; })()';
  const r2 = await send('Runtime.evaluate',{expression:domExpr,returnByValue:true});
  console.log('\n📐 DOM:', JSON.stringify(r2.result.value));

  // 主线程还活着吗？（同步获取时间戳 — 如果这行几秒后才返回说明主线程真冻结了）
  const t0 = Date.now();
  const r3 = await send('Runtime.evaluate',{expression:'performance.now()',returnByValue:true});
  const t1 = Date.now();
  console.log('\n⏱️ CDP round-trip:', (t1-t0)+'ms —', (t1-t0)<100 ? '主线程活着 ✅' : (t1-t0)>1000 ? '🔥🔥🔥 主线程冻结！！' : '有点慢');
  console.log('页面已运行:', Math.round(r3.result.value/1000)+'s');

  ws.close();
}
main().catch(e=>console.error('❌', e.message, e.stack?.substring(0,200)))
