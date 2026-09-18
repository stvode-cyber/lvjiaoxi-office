#!/usr/bin/env node
/**
 * CDP 日志采集 —— 卡死时一键抓取 console + exception
 * 用法：
 *   node scripts/cdp-capture.js                    # 实时打印，Ctrl+C 停止
 *   node scripts/cdp-capture.js --timeout=60       # 自动抓 60s 后停
 *   node scripts/cdp-capture.js --save              # 额外保存到 logs/capture-*.log
 *
 * 依赖：Dev 版 Electron 已启动（scripts/dev-start.js）
 */
const WebSocket = require("ws");
const fs = require("fs");
const path = require("path");

const args = { timeout: 0, save: false };
process.argv.slice(2).forEach(a => {
  if (a.startsWith("--timeout=")) args.timeout = parseInt(a.split("=")[1]) * 1000;
  if (a === "--save") args.save = true;
});

const HOST = "127.0.0.1";
const PORT = 9222;
const KEYWORDS = [
  // 业务关键前缀（来自 console.log/warn/error 的前缀约定）
  "[IMPORT]", "[EXPORT]", "[DB]", "[Tasks]", "[AI]", "[Auth]", "[Store]",
  // 通用错误关键词
  "FATAL", "CATCH", "FAIL", "ERROR", "Exception", "TypeError",
  "timeout", "hang", "blocked", "卡死",
  // XMind 特定
  "xmind", "importXmind", "parseXmind",
  // store 特定
  "store.put", "store.create", "tx(",
];

// ---------------- 连接 CDP ----------------
async function connect() {
  try {
    const r = await fetch(`http://${HOST}:${PORT}/json`);
    const targets = await r.json();
    const page = targets.find(t => t.type === "page");
    if (!page) { console.error("❌ 没找到 page target，Electron 可能还没打开主窗口"); process.exit(1); }
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.on("open", res); ws.on("error", rej); });
    console.log(`✅ CDP 已连接 → ${page.url}`);
    return ws;
  } catch (e) {
    console.error(`❌ 连不上 ${HOST}:${PORT}`);
    console.error("   请先跑: node scripts/dev-start.js");
    console.error("   或确认 Electron 是带 --remote-debugging-port=9222 启动的");
    process.exit(1);
  }
}

// ---------------- 主流程 ----------------
(async () => {
  const ws = await connect();
  let id = 0;
  const send = (method, params = {}) =>
    ws.send(JSON.stringify({ id: ++id, method, params }));

  // 开启 console + exception 监听
  send("Runtime.enable");
  send("Log.enable");

  // 日志缓冲（给 --save 用）
  const buffer = [];
  const log = (level, text) => {
    const line = `[${new Date().toISOString()}] [${level}] ${text}`;
    buffer.push(line);
    console.log(line);
  };

  console.log("🎣 开始抓日志... 导入 XMind 复现卡死吧！Ctrl+C 停止\n");

  ws.on("message", (msg) => {
    let d; try { d = JSON.parse(msg); } catch { return; }

    // Runtime exception
    if (d.method === "Runtime.exceptionThrown") {
      const ex = d.params.exceptionDetails;
      const stack = (ex.stackTrace?.callFrames || [])
        .map(f => `    at ${f.functionName || "?"} ${(f.url || "").split("/").pop()}:${f.lineNumber}`)
        .join("\n");
      log("EXC", `${ex.text}\n${stack}`);
      return;
    }

    // console API 调用
    if (d.method === "Runtime.consoleAPICalled") {
      const p = d.params;
      const text = (p.args || []).map(a => {
        if (a.value !== undefined) return String(a.value);
        if (a.description) return a.description;
        return JSON.stringify(a);
      }).join(" ");

      // 全量打印，但关键行加 emoji
      const hit = KEYWORDS.some(k => text.includes(k));
      const icon = hit ? "🔥" : "  ";
      const levelMap = { log: "LOG", warning: "WRN", error: "ERR", info: "INF", debug: "DBG" };
      log(levelMap[p.type] || "LOG", `${icon} ${text}`);
      return;
    }

    // Log 模块事件
    if (d.method === "Log.entryAdded") {
      const e = d.params.entry;
      if (e.text) log(e.level?.toUpperCase() || "LOG", `📋 ${e.text.slice(0, 500)}`);
    }
  });

  // 超时自动停
  if (args.timeout > 0) {
    setTimeout(() => {
      console.log(`\n⏰ 自动超时（${args.timeout/1000}s）`);
      finish();
    }, args.timeout);
  }

  process.on("SIGINT", finish);

  function finish() {
    ws.close();
    if (args.save || buffer.some(l => l.includes("EXC") || l.includes("🔥"))) {
      const logDir = path.resolve(__dirname, "..", "logs");
      fs.mkdirSync(logDir, { recursive: true });
      const ts = new Date().toISOString().replace(/[:.]/g, "-");
      const file = path.join(logDir, `capture-${ts}.log`);
      fs.writeFileSync(file, buffer.join("\n"), "utf8");
      console.log(`💾 日志已保存 → ${file}`);
      console.log(`   共 ${buffer.length} 行，含异常 ${buffer.filter(l => l.includes("[EXC]")).length} 条`);
    } else {
      console.log(`\n📡 采集中止，共 ${buffer.length} 行，无异常关键词`);
    }
    process.exit(0);
  }
})();
