/* ============================================================
 * 绿角犀 Office · 台账周报自动生成 (ledger-weekly)
 * ------------------------------------------------------------
 * 用法：
 *   node scripts/ledger-weekly.js                 # 生成 Markdown 输出到 stdout + 写 .trae/memory/台账/weekly_YYYY-MM-DD.md
 *   node scripts/ledger-weekly.js --file .trae/memory/台账/weekly_2026-09-15.md  # 指定输出文件
 *   node scripts/ledger-weekly.js --no-save                                        # 只打印不写文件
 *   node scripts/ledger-weekly.js --weeks 2                                        # 覆盖最近 2 周
 *
 * 数据源：100% 来自台账文件 + 实跑 npm test
 *   - .trae/memory/台账/issues.md      → 坑统计
 *   - .trae/memory/台账/decisions.md   → 决策统计
 *   - .trae/memory/台账/context.md     → 模块状态 + 铁律
 *   - scripts/run-tests.js             → 测试结果（spawn 实跑）
 *
 * 零依赖。
 * ============================================================ */
"use strict";
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const LEDGER = path.join(ROOT, ".trae/memory/台账");
const ISSUES_PATH = path.join(LEDGER, "issues.md");
const DECISIONS_PATH = path.join(LEDGER, "decisions.md");
const CONTEXT_PATH = path.join(LEDGER, "context.md");
const GLOBAL_SHARED_ISSUES = path.join(process.env.USERPROFILE || "", ".trae-cn/memory/shared-issues.md");
const GLOBAL_SHARED_DECISIONS = path.join(process.env.USERPROFILE || "", ".trae-cn/memory/shared-decisions.md");

// ---------- arg parse ----------
const args = process.argv.slice(2);
const NO_SAVE = args.includes("--no-save");
const WEEKS = (function () {
  const i = args.indexOf("--weeks");
  return i >= 0 ? parseInt(args[i + 1], 10) || 1 : 1;
})();
const FILE_OVERRIDE = (function () {
  const i = args.indexOf("--file");
  return i >= 0 && args[i + 1] ? args[i + 1] : null;
})();

// ---------- md 解析 ----------
function parseMD(path) {
  if (!fs.existsSync(path)) return [];
  const raw = fs.readFileSync(path, "utf8");
  return raw.split(/^---\s*$/m).filter((s) => s.trim());
}

function parseIssues(mdPath) {
  return parseMD(mdPath).map((sec) => {
    const title = sec.match(/^##\s+\[([^\]]+)\]\s*(.+)$/m);
    const sev = sec.match(/\*\*严重程度\*\*[:：]\s*(.+)$/m);
    const link = sec.match(/\*\*关联\*\*[:：]\s*(.+)$/m);
    const fix = sec.match(/\*\*解决\*\*[:：]\s*(.+)$/m);
    const root = sec.match(/\*\*根因\*\*[:：]\s*(.+)$/m);
    const prev = sec.match(/\*\*预防\*\*[:：]\s*(.+)$/m);
    return {
      date: title ? title[1] : "",
      title: title ? title[2].trim() : "",
      severity: sev ? sev[1].trim() : "?",
      link: link ? link[1].trim() : "",
      fix: fix ? fix[1].trim() : "",
      root: root ? root[1].trim() : "",
      prev: prev ? prev[1].trim() : "",
    };
  }).filter((i) => i.title);
}

function parseDecisions(mdPath) {
  return parseMD(mdPath).map((sec) => {
    const title = sec.match(/^##\s+\[([^\]]+)\]\s*(.+)$/m);
    const pick = sec.match(/\*\*选了啥\*\*[:：]\s*(.+)$/m);
    const why = sec.match(/\*\*为啥\*\*[:：]\s*(.+)$/m);
    return {
      date: title ? title[1] : "",
      title: title ? title[2].trim() : "",
      pick: pick ? pick[1].trim() : "",
      why: why ? why[1].trim() : "",
    };
  }).filter((d) => d.title);
}

function parseContext() {
  if (!fs.existsSync(CONTEXT_PATH)) return { modules: [], rules: [], changelog: [] };
  const raw = fs.readFileSync(CONTEXT_PATH, "utf8");
  const modules = [];
  const rules = [];
  const changelog = [];
  let section = null;
  for (const line of raw.split("\n")) {
    const m = line.match(/^##\s+(.+)$/);
    if (m) section = m[1].trim();
    if (!section) continue;
    if (section.includes("已实现核心模块")) {
      if (line.match(/^\|\s*-{3,}/)) continue;               // skip separator | --- |
      const row = line.match(/\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|/);
      if (row && !row[1].trim().match(/^(模块|------)/)) {
        modules.push({ name: row[1].trim(), status: row[2].trim(), note: row[3].trim() });
      }
    }
    if (section.includes("已定铁律")) {
      const r = line.match(/^\d+\.\s+\*\*(.+?)\*\*[:：]\s*(.+)$/);
      if (r) rules.push({ name: r[1].trim(), desc: r[2].trim() });
    }
    if (section.includes("变更日志")) {
      const c = line.match(/^-\s+\[(\d{4}-\d{2}-\d{2})\]\s*(.+)$/);
      if (c) changelog.push({ date: c[1], text: c[2].trim() });
    }
  }
  return { modules, rules, changelog };
}

// ---------- test runner ----------
function runTests() {
  const r = spawnSync(process.execPath, ["scripts/run-tests.js"], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 120000,
  });
  const passMatch = (r.stdout + r.stderr).match(/套件结果:\s*(\d+)\s*passed,\s*(\d+)\s*failed,\s*共\s*(\d+)/);
  if (passMatch) return { pass: +passMatch[1], fail: +passMatch[2], total: +passMatch[3], exit: r.status || 0 };
  return { pass: -1, fail: -1, total: -1, exit: r.status || 0, raw: r.stdout.slice(-200) };
}

// ---------- severity stat ----------
function severityTable(issues) {
  const count = { P0: 0, P1: 0, P2: 0, P3: 0, "?": 0 };
  for (const i of issues) count[i.severity] = (count[i.severity] || 0) + 1;
  return count;
}

// ---------- build report ----------
function buildReport() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const weekStart = new Date(now); weekStart.setDate(now.getDate() - WEEKS * 7);
  const startStr = `${weekStart.getFullYear()}-${pad(weekStart.getMonth() + 1)}-${pad(weekStart.getDate())}`;

  const projectPkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  const context = parseContext();
  const allIssues = [
    ...parseIssues(ISSUES_PATH),
    ...(fs.existsSync(GLOBAL_SHARED_ISSUES) ? parseIssues(GLOBAL_SHARED_ISSUES) : []),
  ];
  const allDecisions = [
    ...parseDecisions(DECISIONS_PATH),
    ...(fs.existsSync(GLOBAL_SHARED_DECISIONS) ? parseDecisions(GLOBAL_SHARED_DECISIONS) : []),
  ];
  const tests = runTests();
  const sev = severityTable(allIssues);

  const fixedIssues = allIssues.filter((i) => i.fix && i.fix.length > 0 && i.date >= startStr);
  const recentChangelog = context.changelog.filter((c) => c.date >= startStr);

  // ---------- render ----------
  let out = "";
  out += `# 📋 台账周报 · ${startStr} ~ ${today}\n\n`;
  out += `**项目**：${projectPkg.name}  **版本**：${projectPkg.version}\n`;
  out += `**测试**：${tests.pass === -1 ? "(未运行)" : `${tests.pass} passed / ${tests.fail} failed / ${tests.total} 套件`}\n`;
  out += `**铁律**：${context.rules.length} 条  **活跃坑**：${allIssues.length} 条  **决策**：${allDecisions.length} 条\n\n`;
  out += `---\n\n`;

  // 模块状态
  out += `## 一、模块状态\n\n`;
  out += `| 模块 | 状态 | 备注 |\n|------|------|------|\n`;
  for (const m of context.modules) out += `| ${m.name} | ${m.status} | ${m.note} |\n`;
  out += `\n`;

  // 测试结果
  out += `## 二、测试结果\n\n`;
  if (tests.pass === -1) {
    out += `⚠️  测试运行超时或失败，请手动执行 \`npm test\` 后重新生成。\n\n`;
  } else if (tests.fail === 0) {
    out += `✅ **${tests.pass}/${tests.total} 全绿** — 无红单\n\n`;
  } else {
    out += `❌ **${tests.pass}/${tests.total}** — 有 ${tests.fail} 红单，需修复\n\n`;
  }

  // 坑统计
  out += `## 三、活跃坑分布\n\n`;
  out += `| 严重度 | 数量 | 说明 |\n|--------|------|------|\n`;
  out += `| P0 | ${sev.P0 || 0} | 阻断发布 |\n`;
  out += `| P1 | ${sev.P1 || 0} | 影响核心体验 |\n`;
  out += `| P2 | ${sev.P2 || 0} | 影响局部 |\n`;
  out += `| P3 | ${sev.P3 || 0} | 不爽但能用 |\n`;
  out += `\n`;

  // 本周新修复
  if (fixedIssues.length) {
    out += `## 四、本周新修复（${fixedIssues.length} 条）\n\n`;
    for (const i of fixedIssues) {
      out += `### ${i.severity} · ${i.title}（${i.date}）\n\n`;
      if (i.root) out += `- **根因**：${i.root}\n`;
      if (i.fix) out += `- **解决**：${i.fix}\n`;
      if (i.prev) out += `- **预防**：${i.prev}\n`;
      if (i.link) out += `- **关联**：${i.link}\n`;
      out += `\n`;
    }
  }

  // 最近变更日志
  if (recentChangelog.length) {
    out += `## 五、台账变更（${recentChangelog.length} 条）\n\n`;
    for (const c of recentChangelog) out += `- [${c.date}] ${c.text}\n`;
    out += `\n`;
  }

  // 铁律速查
  out += `## 六、铁律速查（${context.rules.length} 条）\n\n`;
  for (const r of context.rules) out += `1. **${r.name}**：${r.desc}\n`;
  out += `\n`;

  // 技术积累
  out += `## 七、技术积累（从坑根因自动提炼）\n\n`;
  const uniqueRoots = new Map();
  for (const i of allIssues) {
    if (!i.root || uniqueRoots.has(i.root)) continue;
    uniqueRoots.set(i.root, i);
  }
  let idx = 1;
  for (const [, i] of uniqueRoots) out += `${idx++}. **${i.title}** — ${i.root}\n`;
  out += `\n`;

  // 指标汇总
  out += `## 八、指标汇总\n\n`;
  out += `| 指标 | 值 |\n|------|----|\n`;
  out += `| 测试套件 | ${tests.total === -1 ? "?" : tests.total} |\n`;
  out += `| 活跃坑 | ${allIssues.length} |\n`;
  out += `| 关键决策 | ${allDecisions.length} |\n`;
  out += `| 铁律 | ${context.rules.length} |\n`;
  out += `| 模块 | ${context.modules.length} |\n`;
  out += `| 台账变更（周期内） | ${recentChangelog.length} |\n`;
  out += `\n`;
  out += `> 本周报 100% 自动生成，数据源：issues.md + decisions.md + context.md + npm test 实跑。\n`;
  out += `> 下次生成：\`node scripts/ledger-weekly.js [--no-save] [--weeks N]\`\n`;

  return { out, filename: `weekly_${today}.md` };
}

function main() {
  const { out, filename } = buildReport();
  console.log(out);
  if (!NO_SAVE) {
    let fp;
    if (FILE_OVERRIDE) {
      // 允许绝对路径或相对路径（相对 ROOT）
      fp = path.isAbsolute(FILE_OVERRIDE) ? FILE_OVERRIDE : path.join(ROOT, FILE_OVERRIDE);
    } else {
      fp = path.join(LEDGER, filename);
    }
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(fp, out, "utf8");
    console.log(`\n💾 已写入：${path.relative(ROOT, fp)}`);
  }
}

main();
