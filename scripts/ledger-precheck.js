/* ============================================================
 * 绿角犀 Office · 台账改前扫描 (ledger-precheck)
 * ------------------------------------------------------------
 * 用法：
 *   node scripts/ledger-precheck.js                         # 无参 → 扫全部活跃坑关联路径
 *   node scripts/ledger-precheck.js app/js/shell.js         # 单文件
 *   node scripts/ledger-precheck.js electron/*.js           # glob（shell 展开后）
 *
 * 功能：
 *   1. 读取 .trae/memory/台账/issues.md + 用户级 shared-issues.md
 *   2. 解析每条「关联」字段 → 展开 glob → 实际文件列表
 *   3. 命中历史坑但文件没 TODO: [坑-xxx] 预防注释 → 输出警告
 *   4. 退出码：0=全部OK / 1=有文件缺 TODO（便于 CI 阻断）
 *
 * 零依赖。
 * ============================================================ */
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const ISSUES_PATH = path.join(ROOT, ".trae/memory/台账/issues.md");
const GLOBAL_SHARED = path.join(process.env.USERPROFILE || "", ".trae-cn/memory/shared-issues.md");

function parseIssues(mdPath) {
  if (!fs.existsSync(mdPath)) return [];
  const raw = fs.readFileSync(mdPath, "utf8");
  const sections = raw.split(/^---\s*$/m);
  const out = [];
  for (const sec of sections) {
    const title = sec.match(/^##\s+\[([^\]]+)\]\s*(.+)$/m);
    const link = sec.match(/^\s*-\s*\*\*关联\*\*[:：]\s*(.+)$/m);
    const sev = sec.match(/^\s*-\s*\*\*严重程度\*\*[:：]\s*(.+)$/m);
    if (!title || !link) continue;
    // 先把 "路径 / 路径 / 路径" 里的 " / " 替换成 "," 再 split —— 关键：不能把路径里的 / 当分隔符！
    const paths = link[1]
      .replace(/\s*\/\s/g, ",")   // " / " → ","（只在有空格时才替换，避免破坏 unix 路径）
      .split(/[,，]\s*/)
      .map((p) => p.trim().replace(/^`|`$/g, "").replace(/[（(].*?[)）]/g, "").trim())
      .filter((p) => p && p.length > 2);
    out.push({
      title: title[0].trim(),
      date: title[1],
      tag: title[2].trim().toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-").replace(/^-+|-+$/g, ""),
      severity: sev ? sev[1].trim() : "?",
      paths,
    });
  }
  return out;
}

// 展开 glob pattern → 实际文件列表
function expandPattern(pattern) {
  const absPattern = path.isAbsolute(pattern) ? pattern : path.resolve(ROOT, pattern);
  const results = [];

  function walkPat(pat) {
    // 大括号 {a,b} → 分别展开
    const brace = pat.match(/\{([^}]+)\}/);
    if (brace) {
      const opts = brace[1].split(",").map((s) => s.trim());
      for (const o of opts) walkPat(pat.replace(brace[0], o));
      return;
    }
    // ** 递归通配
    const dblStar = pat.indexOf("**");
    if (dblStar !== -1) {
      const prefix = pat.slice(0, dblStar);
      const suffix = pat.slice(dblStar + 2).replace(/^[\\/]/, "").replace(/^\*/, "");
      // 先 trim 末尾斜杠再 dirname，避免 path.dirname("dir/") 返回上层
      let baseDir = path.dirname(prefix.replace(/[\\/]$/, ""));
      if (baseDir === pat) baseDir = ROOT;
      if (!fs.existsSync(baseDir)) return;
      function rec(d) {
        for (const f of fs.readdirSync(d)) {
          const full = path.join(d, f);
          const st = fs.statSync(full);
          if (st.isDirectory()) rec(full);
          else if (!suffix || full.endsWith(suffix)) results.push(full);
        }
      }
      rec(baseDir);
      return;
    }
    // 直接路径存在 → 必须是文件（跳过目录）
    if (fs.existsSync(pat)) {
      const st = fs.statSync(pat);
      if (!st.isDirectory()) results.push(pat);
      return;
    }
    // 单 * 通配（同目录层级）
    if (pat.includes("*")) {
      const dir = path.dirname(pat);
      const fileGlob = path.basename(pat);
      if (fs.existsSync(dir)) {
        const re = new RegExp("^" + fileGlob.replace(/\*/g, ".*") + "$");
        for (const f of fs.readdirSync(dir)) {
          const full = path.join(dir, f);
          if (re.test(f) && !fs.statSync(full).isDirectory()) results.push(full);
        }
      }
    }
  }
  walkPat(absPattern);
  return results;
}

function scanFile(file) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return null;
  try {
    const c = fs.readFileSync(file, "utf8");
    const todos = [...c.matchAll(/TODO:\s*\[坑-([^\]]+)\]\s*预防[：:](.*)$/gm)].map((m) => ({
      tag: m[1],
      text: m[2].trim().slice(0, 80),
      line: c.slice(0, m.index).split("\n").length,
    }));
    return { todos };
  } catch { return { todos: [] }; }
}

function main() {
  const args = process.argv.slice(2);
  const allIssues = parseIssues(ISSUES_PATH).concat(parseIssues(GLOBAL_SHARED));

  // 目标：用户指定 or 所有活跃坑关联路径
  const targets = args.length ? args : allIssues.flatMap((i) => i.paths);

  // 构建 { absPath → fileInfo } 映射
  const fileMap = new Map();
  for (const pat of targets) {
    for (const abs of expandPattern(pat)) {
      if (!fileMap.has(abs)) {
        const info = scanFile(abs);
        if (info) fileMap.set(abs, info);
      }
    }
  }

  // 匹配：file 的所有 issue 集合
  const hits = [];
  for (const [abs, info] of fileMap) {
    const rel = path.relative(ROOT, abs).replace(/\\/g, "/");
    for (const issue of allIssues) {
      const issueAbsSet = new Set(issue.paths.flatMap((p) => expandPattern(p)));
      if (!issueAbsSet.has(abs)) continue;
      // 匹配：短 tag 在长 tag 里出现，或两者有 ≥2 个连续相同的 ASCII token
      const hasTodo = info.todos.some((td) => {
        if (issue.tag.includes(td.tag) || td.tag.includes(issue.tag)) return true;
        const ia = issue.tag.split("-"), ta = td.tag.split("-");
        // 计算共有 token 数（忽略中英文混杂后拆分导致的空 token）
        const common = ia.filter((t) => t.length >= 2 && ta.includes(t)).length;
        return common >= 2;
      });
      hits.push({ file: rel, severity: issue.severity, title: issue.title, date: issue.date, tag: issue.tag, hasTodo });
    }
  }

  if (!hits.length) { console.log("✓ 台账扫描：目标路径无命中历史坑"); process.exit(0); }

  let missing = 0, withTodo = 0;
  for (const h of hits) {
    if (!h.hasTodo) {
      missing++;
      const color = h.severity === "P0" ? "\x1b[31m" : h.severity === "P1" ? "\x1b[33m" : "\x1b[36m";
      const reset = "\x1b[0m";
      console.log(`${color}[${h.severity}]${reset} ${h.file}`);
      console.log(`         命中坑: ${h.title}  (${h.date})`);
      console.log(`         建议插入:  // TODO: [坑-${h.tag}] 预防: (见 issues.md 对应条目)`);
    } else {
      withTodo++;
      console.log(`[OK] ${h.file} — 已有 TODO [坑-${h.tag}]`);
    }
  }
  console.log(`\n汇总：${withTodo} OK, ${missing} 建议补 TODO`);
  process.exit(missing ? 1 : 0);
}

main();
