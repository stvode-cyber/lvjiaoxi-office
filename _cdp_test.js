// cdp-test-let.js — 通过 CDP Runtime.evaluate 直接测 LET + MAP
const WebSocket = require('ws');
const http = require('http');

async function getEndpoint() {
  return new Promise((resolve, reject) => {
    http.get('http://127.0.0.1:9222/json', (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const arr = JSON.parse(data);
          const page = arr.find(x => x.type === 'page' && !x.url.includes('devtools'));
          if (page) resolve(page.webSocketDebuggerUrl);
          else reject('no page found');
        } catch(e) { reject(e.message); }
      });
    }).on('error', reject);
  });
}

async function main() {
  let ep;
  for (let i = 0; i < 10; i++) {
    try { ep = await getEndpoint(); break; }
    catch { await new Promise(r => setTimeout(r, 1000)); }
  }
  if (!ep) { console.log('❌ 连不上 9222，应用可能没启动'); process.exit(1); }
  console.log('✅ CDP endpoint:', ep.split('/').pop());

  const ws = new WebSocket(ep);
  const pending = {}; let msgId = 0;
  ws.on('message', raw => {
    const m = JSON.parse(raw);
    if (m.id && pending[m.id]) { pending[m.id](m); }
  });
  await new Promise(r => ws.once('open', r));
  await new Promise(r => setTimeout(r, 4000)); // 等 renderer mount

  function send(method, params) {
    return new Promise(resolve => {
      const id = ++msgId; pending[id] = resolve;
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  // Step 1: 列出所有 execution contexts
  const ctxResp = await send('Runtime.enable', {});
  const ctxs = await send('Runtime.getExecutionContexts', {});
  console.log('\n📋 Execution contexts:');
  const contexts = ctxs.result?.contexts || [];
  contexts.forEach(c => console.log(`  id=${c.id}, name="${c.name}", origin=${c.origin}`));

  // Step 2: 找页面主上下文（isDefault=true 或 contextId=1）
  let targetCtx = contexts.find(c => c.isDefault || c.id === 1);
  if (!targetCtx && contexts.length > 0) targetCtx = contexts[0];
  const ctxId = targetCtx ? targetCtx.id : 1;
  console.log(`\n🎯 使用 contextId: ${ctxId}`);

  // Step 3: 探测 OS / window 上有啥
  const probe = await send('Runtime.evaluate', {
    expression: `(function(){
      var keys = Object.keys(window).filter(k => k.length < 20).sort();
      var hasOS = typeof window.OS !== 'undefined';
      var hasFE = typeof window.FE !== 'undefined';
      var hasFE2 = typeof (window.OS && window.OS.FormulaEngine) !== 'undefined';
      return JSON.stringify({ hasOS, hasFE, hasOS_FE: hasFE2, sampleKeys: keys.slice(-20) });
    })()`,
    contextId: ctxId,
    returnByValue: true
  });
  console.log('\n🔍 window probe:', probe.result?.result?.value);

  // Step 4: 跑测试
  function runFE(f) {
    return send('Runtime.evaluate', {
      expression: `(function(){ try { return JSON.stringify((window.OS || {}).FormulaEngine.run("=${f}", () => 0, "A1")); } catch(e) { return "#ERR:"+e.message; } })()`,
      contextId: ctxId,
      returnByValue: true
    }).then(d => d.result?.result?.value);
  }

  console.log('\n' + '='.repeat(60));
  console.log('LET + MAP + REDUCE + SCAN + MAKEARRAY — Electron 实机测试\n');

  const tests = [
    // LET
    ["LET(a, 5, a*100)", 500],
    ["LET(a, 2, b, a+3, a*b)", 10],
    ["LET(a, 2+3, b, a*2, a+b)", 15],
    ["LET(x, A1, x*10)", 0], // A1 默认空
    // LET + LAMBDA 绑定
    ["LET(Dbl, LAMBDA(x, x*2), Dbl(7))", 14],
    ["LET(Add, LAMBDA(x, y, x+y), Add(3, 4))", 7],
    ["LET(Dbl, LAMBDA(x, x*2), Triple, LAMBDA(x, x*3), Dbl(Triple(2)))", 12],
    // MAP（用 SEQUENCE 造数据）
    ["MAP(SEQUENCE(3,1,1,1), LAMBDA(x, x*2))", [[2],[4],[6]]],
    ["LET(arr, SEQUENCE(4,1,1,1), MAP(arr, LAMBDA(x, x+10)))", [[11],[12],[13],[14]]],
    // REDUCE
    ["REDUCE(SEQUENCE(5,1,1,1), 0, LAMBDA(a, c, a+c))", 15],
    ["REDUCE(SEQUENCE(4,1,1,1), 1, LAMBDA(a, c, a*c))", 24],
    // SCAN
    ["SCAN(SEQUENCE(5,1,1,1), 0, LAMBDA(a, c, a+c))", [[1],[3],[6],[10],[15]]],
    // MAKEARRAY
    ["MAKEARRAY(3, 3, LAMBDA(r, c, r*10+c))", [[11,12,13],[21,22,23],[31,32,33]]],
    ["MAKEARRAY(3, 4, LAMBDA(r, c, r*c))", [[1,2,3,4],[2,4,6,8],[3,6,9,12]]],
  ];

  let pass = 0, fail = 0;
  for (const [f, exp] of tests) {
    const raw = await runFE(f);
    let got;
    try { got = JSON.parse(raw); } catch(e) { got = raw; }
    const ok = JSON.stringify(got) === JSON.stringify(exp);
    if (ok) pass++; else fail++;
    console.log(`${ok ? "✅" : "❌"} ${f}`);
    if (!ok) console.log(`   got:  ${JSON.stringify(got)}`);
    if (!ok) console.log(`   exp:  ${JSON.stringify(exp)}`);
  }

  console.log(`\n结果: ${pass}/${tests.length} 通过, ${fail} 失败`);
  ws.close();
  process.exit(0);
}

main().catch(e => { console.log('ERROR:', e.message); process.exit(1); });
