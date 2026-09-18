// 构造一个真正的 .xmind（zip containing content.json），用 CDP 自动触发导入
const w = require("ws");

// 真实 XMind ZIP 结构的 content.json
const contentJson = JSON.stringify([{
  rootTopic: {
    id: "root-id-001",
    title: "测试根节点",
    structureClass: "org.xmind.ui.logic.right",
    markers: [],
    labels: [],
    children: {
      attached: [
        { id: "c1", title: "分支 1", children: { attached: [
          { id: "c1-1", title: "叶节点 A" },
          { id: "c1-2", title: "叶节点 B" }
        ]}},
        { id: "c2", title: "分支 2" },
        { id: "c3", title: "分支 3", children: { attached: [
          { id: "c3-1", title: "子分支" }
        ]}}
      ]
    }
  }
}]);

(async () => {
  const resp = await fetch("http://127.0.0.1:9222/json");
  const targets = await resp.json();
  const page = targets.find((t) => t.type === "page");
  const ws = new w(page.webSocketDebuggerUrl);
  let id = 0;
  const send = (method, params) => ws.send(JSON.stringify({ id: ++id, method, params }));

  ws.on("open", () => {
    console.log("✅ CDP auto-test — constructing REAL .xmind zip...\n");
    send("Runtime.enable");

    setTimeout(() => {
      send("Runtime.evaluate", {
        expression: `
          (async () => {
            try {
              // 1. 用 JSZip 构造真正的 .xmind zip
              console.log('📟 step 1: loading JSZip...');
              const JSZip = window.JSZip;
              const zip = new JSZip();
              zip.file('content.json', ${JSON.stringify(contentJson)});
              zip.file('metadata.json', JSON.stringify({ creator: { name: 'test' }, version: '2.0' }));
              console.log('📟 step 2: generating zip blob...');
              const blob = await zip.generateAsync({ type: 'blob' });
              console.log('📟 step 3: zip size =', blob.size, 'bytes');
              
              // 2. 构造 File
              const f = new File([blob], 'test-real.xmind', { type: 'application/vnd.xmind.workbook.v1' });
              console.log('📟 step 4: created File, name=', f.name);
              
              // 3. 调导入
              console.log('📟 step 5: calling OS.Importer.importFile...');
              const r = await OS.Importer.importFile(f, (label, p) => console.log('📟  progress:', label, p));
              console.log('📟 step 6: importFile result:', JSON.stringify({
                type: r?.type,
                nodes: r?.data?.nodes?.length,
                edges: r?.data?.edges?.length,
                rootId: r?.data?.rootId
              }));
              
              if (r && r.type === 'mindmap') {
                console.log('📟 step 7: creating doc via store.create...');
                const doc = await OS.store.create({ type: r.type, name: 'test-real' });
                doc.data = r.data;
                console.log('📟 step 8: putting doc...');
                await OS.store.put(doc);
                console.log('📟 step 9: put OK, calling openDoc...');
                
                if (typeof openDoc === 'function') {
                  openDoc(doc);
                } else {
                  console.log('📟 openDoc not in scope, checking OS.shell...');
                  if (OS.shell && typeof OS.shell.openDoc === 'function') {
                    OS.shell.openDoc(doc);
                  }
                }
                console.log('📟 step 10: DONE!');
              }
            } catch(e) {
              console.error('📟 AUTO-TEST CATCH:', e.message);
              console.error(e.stack);
            }
          })();
        `,
        returnByValue: false
      });
    }, 800);
  });

  ws.on("message", (msg) => {
    const d = JSON.parse(msg.toString());
    if (d.id) return;
    if (d.method === "Runtime.exceptionThrown") {
      const ex = d.params.exceptionDetails;
      console.error("━━ EXC:", ex.text);
      (ex.stackTrace?.callFrames || []).forEach((f) => {
        console.error(`  at ${f.functionName || "?"} line ${f.lineNumber} (${(f.url || "").split("/").pop()})`);
      });
    } else if (d.method === "Runtime.consoleAPICalled") {
      const text = (d.params.args || [])
        .map((a) => (a.value !== undefined ? a.value : a.description))
        .join(" ");
      if (text.includes("📟") || text.includes("EXCEPTION") || text.includes("FATAL") || text.includes("CATCH")) {
        console.log(text);
      }
    }
  });

  setTimeout(() => { ws.close(); process.exit(0); }, 45000);
})();
