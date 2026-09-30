/* ============================================================
 * 绿角犀 Office · 台账改后建议 (ledger-posthint)
 * ------------------------------------------------------------
 * 用法：
 *   node scripts/ledger-posthint.js                        # 读 git diff --name-only 未提交
 *   node scripts/ledger-posthint.js --staged                # 已暂存
 *   node scripts/ledger-posthint.js HEAD~3..HEAD            # 指定范围
 *   node scripts/ledger-posthint.js app/js/shell.js         # 直接给文件列表
 *
 * 功能：
 *   1. 读 git diff 或参数文件列表
 *   2. 按路径归类（模块 → 对应 issues/decisions 条目有没有命中）
 *   3. 输出终端建议：哪些改动值得写台账（新决策？新坑？）
 *   4. 退出码：0=OK / 2=有新改动但台账未覆盖（提醒但不阻断）
 *
 * 与 ledger-precheck.js 互补：
 *   - precheck = 改前防坑（issues 关联文件有没有 TODO 预防注释）
 *   - posthint = 改后提醒（本轮改动有没有值得写台账的）
 *
 * 零依赖。
 * ============================================================ */
"use strict";
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const ISSUES_PATH = path.join(ROOT, ".trae/memory/台账/issues.md");
const DECISIONS_PATH = path.join(ROOT, ".trae/memory/台账/decisions.md");
const INDEX_PATH = path.join(ROOT, ".trae/memory/台账/index.md");

// 模块归属表（路径 → 模块标签）
const MODULE_MAP = [
  { tag: "shell", pattern: /^app\/js\/shell\.js$/ },
  { tag: "writer", pattern: /^app\/js\/modules\/writer\.js$/ },
  { tag: "spreadsheet", pattern: /^app\/js\/modules\/spreadsheet\.js$/ },
  { tag: "presentation", pattern: /^app\/js\/modules\/presentation\.js$/ },
  { tag: "pdf", pattern: /^app\/js\/modules\/pdf[^/]*\.js$/ },
  { tag: "pdf-engine", pattern: /^app\/js\/modules\/pdf-engine\.js$/ },
  { tag: "mindmap", pattern: /^app\/js\/modules\/mindmap\.js$/ },
  { tag: "electron", pattern: /^electron\// },
  { tag: "vendor", pattern: /^vendor\// },
  { tag: "css", pattern: /^app\/css\// },
  { tag: "sync", pattern: /^(ios|harmonyos)\// },
  { tag: "test", pattern: /^_.*_test\.js$/ },
  { tag: "scripts", pattern: /^scripts\// },
  { tag: "config", pattern: /^(package\.json|electron-builder\.yml|vite\.config)/ },
];

// 决策关键词（命中说明可能是新决策）
const DECISION_HINTS = [
  /^app\/js\/shell\.js$/, /^app\/css\//, /^electron\//,
  /addEventListener\("keydown"/, /_tswOpen/, /_recentlyClosed/, /reopenRecentlyClosed/,
  /OS\.theme\.toggle/, /data-pdf-dark/, /autoUpdater/, /electron-updater/,
];

// 坑关键词（命中说明可能是修复了 bug）
const BUG_HINTS = [
  /fix|bug|hotfix|patch|workaround|fallback|回退|修复|兜底/,
  /TODO:\s*\[坑-/,
  /catch\s*\([^)]*\)\s*\{[^}]*console\.error/,
];

function classifyModule(file) {
  for (const m of MODULE_MAP) {
    if (m.pattern.test(file)) return m.tag;
  }
  return "other";
}

function parseSections(mdPath) {
  if (!fs.existsSync(mdPath)) return [];
  const raw = fs.readFileSync(mdPath, "utf8");
  const sections = raw.split(/^---\s*$/m);
  const out = [];
  for (const sec of sections) {
    // 同 ledger-precheck.js：两种标题格式
    const titleA = sec.match(/^##\s+\[(P[0-3])\]\s+\[([^\]]+)\]\s*(.+)$/m);
    const titleB = sec.match(/^##\s+\[(\d{4}-\d{2}-\d{2})\]\s*(.+)$/m);
    const link = sec.match(/^\s*-\s*\*\*关联[^*]*\*\*[:：]\s*(.+)$/m) ||
                 sec.match(/^\s*-\s*关联文件?[:：]\s*(.+)$/m);
    let slug, cnTitle;
    if (titleA) {
      slug = titleA[2];
      cnTitle = titleA[3];
    } else if (titleB) {
      slug = titleB[1].replace(/-/g, "");
      cnTitle = titleB[2];
    } else {
      continue;
    }
    const paths = link ? link[1].replace(/\s*\/\s/g, ",").split(/[,，]\s*/).map(s => s.trim().replace(/^`|`$/g, "")) : [];
    out.push({ title: cnTitle.trim(), tag: slug, paths });
  }
  return out;
}

function readDiff(range) {
  try {
    const r = range ? range.join(" ") : "--name-only";
    return execSync(`git diff ${r}`, { cwd: ROOT, encoding: "utf8" })
      .split("\n").map(s => s.trim()).filter(Boolean);
  } catch (e) { return []; }
}

function readStaged() {
  try {
    return execSync("git diff --cached --name-only", { cwd: ROOT, encoding: "utf8" })
      .split("\n").map(s => s.trim()).filter(Boolean);
  } catch (e) { return []; }
}

// ===== 主流程 =====
const args = process.argv.slice(2);
const WRITE_MODE = args.includes("--write");
// 过滤掉 --write 再判断 staged 或直接文件
const cleanArgs = args.filter(a => a !== "--write");
let files = [];
if (cleanArgs.includes("--staged")) files = readStaged();
else if (cleanArgs.length && !cleanArgs[0].startsWith("--")) files = cleanArgs;
else files = readDiff();

if (!files.length) {
  console.log("ℹ️ 无改动文件（git diff 空）。exit 0");
  process.exit(0);
}

// 归类
const byModule = {};
for (const f of files) {
  const m = classifyModule(f);
  (byModule[m] = byModule[m] || []).push(f);
}

// 读台账
const issues = parseSections(ISSUES_PATH);
const decisions = parseSections(DECISIONS_PATH);
const existingPaths = new Set([
  ...issues.flatMap(i => i.paths),
  ...decisions.flatMap(i => i.paths),
]);

console.log("📋 ledger-posthint · 改后台账建议");
console.log("=" .repeat(50));
console.log(`改动文件: ${files.length} 个，归为 ${Object.keys(byModule).length} 个模块\n`);

let hints = 0;
for (const [mod, flist] of Object.entries(byModule)) {
  console.log(`🔹 模块 [${mod}] · ${flist.length} 个文件`);
  for (const f of flist) console.log(`   - ${f}`);

  // 检查现有台账是否覆盖
  const covered = flist.filter(f => [...existingPaths].some(p => f.includes(p) || p.includes(f)));
  const uncovered = flist.filter(f => !covered.includes(f));

  if (uncovered.length) {
    // 检查是否是"决策类"改动
    const isDecision = flist.some(f => DECISION_HINTS.some(h => h.test(f)));
    const isBugfix = flist.some(f => BUG_HINTS.some(h => h.test(f)));

    if (isDecision) {
      console.log(`   ✨ 建议写 **decisions.md** — 可能是新架构决策`);
      hints++;
    }
    if (isBugfix) {
      console.log(`   🐛 建议写 **issues.md** — 可能修了新坑`);
      hints++;
    }
    if (!isDecision && !isBugfix && uncovered.length) {
      console.log(`   💭 ${uncovered.length} 个文件不在现有台账覆盖。要不要写一条？`);
      hints++;
    }
  } else {
    console.log(`   ✅ 现有台账已覆盖，无需新条目`);
  }
  console.log();
}

// 汇总
console.log("=" .repeat(50));
if (!hints) {
  console.log("✅ 所有改动都已被现有台账覆盖，exit 0");
  process.exit(0);
} else {
  console.log(`💡 有 ${hints} 个建议！跑 Growth Logger Skill 写入。exit 2`);
  console.log("\n📝 模板（手动套）:");
  console.log("  decisions.md 新条目:  node scripts/ledger-posthint.js --staged");
  console.log("  issues.md 新条目:     记得写「根因」和「预防规则」");

// ===== 辅助：git diff 摘要 =====
function getFileNumstat(file) {
  try {
    const r = execSync(`git diff --numstat -- "${file}"`, { cwd: ROOT, encoding: "utf8" }).trim();
    if (!r) return { add: 0, del: 0 };
    const parts = r.split("\t");
    return { add: parseInt(parts[0], 10) || 0, del: parseInt(parts[1], 10) || 0 };
  } catch (e) { return { add: 0, del: 0 }; }
}
function getDiffHead(file, n = 20) {
  try {
    return execSync(`git diff -- "${file}"`, { cwd: ROOT, encoding: "utf8" })
      .split("\n").slice(0, n).join("\n");
  } catch (e) { return ""; }
}

// ===== 辅助：基于改动推断 "为啥" =====
function inferWhy(modules, hints, diffsByFile) {
  const reasons = [];
  // 按模块推断
  if (modules.includes("shell")) reasons.push("shell.js 路由层改动（快捷键/命令面板/标签管理）");
  if (modules.includes("css")) reasons.push("全局样式或 PDF 暗模式 CSS filter");
  if (modules.includes("electron")) reasons.push("Electron 主进程或 autoUpdater 链路");
  if (modules.includes("pdf") || modules.includes("pdf-engine")) reasons.push("PDF 引擎（渲染/导出/批注/版面还原）");
  // 按改动类型推断
  const newFiles = Object.entries(diffsByFile).filter(([_, d]) => d.add > 0 && d.del === 0).length;
  const bigFiles = Object.entries(diffsByFile).filter(([_, d]) => d.add + d.del > 50);
  if (newFiles > 0) reasons.push(`新增 ${newFiles} 个文件`);
  if (bigFiles.length > 0) reasons.push(`${bigFiles.length} 个文件改动 >50 行（可能是新功能）`);
  // 按关键词推断
  const allDiffs = Object.values(diffsByFile).map(d => d.head).join("\n");
  if (/addEventListener\(["']keydown/.test(allDiffs)) reasons.push("新增键盘快捷键 handler");
  if (/function\s+\w+\(.*\)\s*\{[^}]*return[^}]*\.save\(\)/.test(allDiffs)) reasons.push("新增导出/保存函数");
  if (/TODO:\s*\[坑-|FIXME|HACK/.test(allDiffs)) reasons.push("含 TODO/FIXME 标记，需要跟进");
  // 兜底
  if (!reasons.length) reasons.push(`${hints} 个建议涉及 [${modules.join(", ")}]`);
  return reasons.join("；");
}

// ===== 辅助：基于改动推断 "备选方案" =====
function inferAlternatives(modules, hints) {
  const alts = [];
  if (modules.includes("shell")) alts.push("备选：路由分散到各模块 vs 集中在 shell.js handler（选了集中）");
  if (modules.includes("css")) alts.push("备选：改 pdf.js render 参数 vs CSS filter invert（选了 filter，零依赖）");
  if (modules.includes("pdf-engine") || modules.includes("pdf")) alts.push("备选：版面还原精度 vs 通用导出速度（版面还原优先）");
  if (modules.includes("electron")) alts.push("备选：可选依赖 try/catch vs 硬依赖（选了 try/catch，兼容 Web 壳）");
  if (!alts.length) alts.push("_如果有其他考虑的方案，写在这里_");
  return alts.join("\n");
}

  // --write 模式：自动在 decisions.md 追加极简模板 + index.md 索引行
  if (WRITE_MODE) {
    const DEC_PATH = path.join(ROOT, ".trae/memory/台账/decisions.md");
    const IDX_PATH = path.join(ROOT, ".trae/memory/台账/index.md");
    const today = new Date().toISOString().slice(0, 10);
    const moduleList = Object.keys(byModule).join(", ");
    const fileList = files.map(f => "`" + f + "`").join(" / ");

    // 构建每个文件的 diff 元数据
    const diffsByFile = {};
    for (const f of files) {
      diffsByFile[f] = { ...getFileNumstat(f), head: getDiffHead(f, 20) };
    }

    // 自动推断"为啥"和"备选方案"
    const why = inferWhy(Object.keys(byModule), hints, diffsByFile);
    const alternatives = inferAlternatives(Object.keys(byModule), hints);
    const totalAdd = Object.values(diffsByFile).reduce((s, d) => s + d.add, 0);
    const totalDel = Object.values(diffsByFile).reduce((s, d) => s + d.del, 0);
    const isSmart = why !== "_AI 自动生成模板，请手动补充决策原因_";
    const status = isSmart ? "auto-filled（脚本自动推断，建议复核）" : "draft（待补充完整）";

    // decisions.md 追加模板（智能推断版）
    const tmpl = `\n\n---\n\n## [${today}] 改动台账（自动生成${isSmart ? " · 智能推断" : " · 待补充"}）\n\n- **选了啥**：${hints} 个建议涉及模块 [${moduleList}] · 改动 +${totalAdd}/-${totalDel} 行\n- **为啥**：${why}\n- **备选方案**：\n${alternatives.split("\n").map(a => "  - " + a.replace(/^_\(.*\)_$/, "_" + a + "_")).join("\n")}\n- **关联文件**：${fileList}\n- **决策人**：AI（\`--write\` 模式自动写入${isSmart ? " · 推断填充" : ""}）\n- **状态**：${status}\n`;
    if (fs.existsSync(DEC_PATH)) {
      fs.appendFileSync(DEC_PATH, tmpl, "utf8");
      console.log(`\n✍️  decisions.md 已追加模板（${today} · ${isSmart ? "智能推断" : "待补充"}）`);
    } else {
      console.log(`\n⚠️  decisions.md 不存在，跳过写入`);
    }

    // index.md 追加索引行
    if (fs.existsSync(IDX_PATH)) {
      const idxTmpl = `- [D] 改动台账（自动生成${isSmart ? " · 智能推断" : ""} · ${today}） → decisions.md#${today}\n`;
      let idx = fs.readFileSync(IDX_PATH, "utf8");
      const anchor = "## PDF 工具箱";
      if (idx.includes(anchor)) {
        idx = idx.replace(anchor, idxTmpl + anchor);
      } else {
        idx += "\n" + idxTmpl;
      }
      fs.writeFileSync(IDX_PATH, idx, "utf8");
      console.log(`✍️  index.md 已追加索引行`);
    }
    if (isSmart) console.log(`\n💡  脚本已基于 git diff 自动填充，建议复核后将状态改为 active`);
    else console.log(`\n📖  打开 decisions.md 手动补充「为啥」和「备选方案」`);
    process.exit(isSmart ? 4 : 3); // exit 4 = 智能填充待复核 / exit 3 = 待补充
  }
  process.exit(2);
}

