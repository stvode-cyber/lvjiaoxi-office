'use strict';
/*
 * scripts/sync-clients.js
 * ------------------------------------------------------------------
 * 把仓库根的 app/（Web 层「单一真源」）同步到各原生客户端的 WebView 资源目录，
 * 保证 iOS / HarmonyOS 客户端与 Web / Android 同源（避免陈旧快照导致功能缺失）。
 *
 * 背景：Android 通过 build.gradle 的 assets.srcDirs 直接引用 ../../../app，永不失同步；
 *       iOS (clients/ios/webroot) 与 HarmonyOS (rawfile) 是「提交进仓库的副本」，
 *       app/ 演进后它们会静默漂移（已发现缺失登录功能、auth.js/updater.js/version.json 等）。
 *
 * 用法：
 *   node scripts/sync-clients.js                 # 应用：把 app/ 复制到各客户端 webroot
 *   node scripts/sync-clients.js --dry-run       # 只打印将变更，不写文件
 *   node scripts/sync-clients.js --check         # 检测漂移；有漂移 exit 1（供 CI 门控）
 *   node scripts/sync-clients.js --prune         # 应用同时删除「客户端有但 app 没有」的孤儿文件
 *
 * 安全约定：
 *   - 默认不删除任何客户端专属文件（clientOnly），避免误删平台资源；仅 --prune 才清理。
 *   - 排除 .git / .DS_Store / Thumbs.db / node_modules。
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const APP_DIR = path.join(REPO_ROOT, 'app');

// 需要保持同源的客户端 WebView 资源根目录
const CLIENTS = [
  { name: 'ios', root: path.join(REPO_ROOT, 'clients/ios/webroot') },
  { name: 'harmonyos', root: path.join(REPO_ROOT, 'clients/harmonyos/entry/src/main/resources/rawfile') }
];

const EXCLUDE = new Set(['.git', '.DS_Store', 'Thumbs.db', 'node_modules']);

// 递归列出目录内所有文件，返回「/」分隔的相对路径（已排序）。目录不存在则返回 []。
function listFiles(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  (function walk(d, rel) {
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); }
    catch (e) { return; }
    for (const e of entries) {
      if (EXCLUDE.has(e.name)) continue;
      const full = path.join(d, e.name);
      const r = rel ? rel + '/' + e.name : e.name;
      if (e.isDirectory()) walk(full, r);
      else if (e.isFile()) out.push(r);
    }
  })(dir, '');
  return out.sort();
}

// 字节级比较 app 与客户端同一相对路径的内容是否一致
function contentEquals(rel, clientRoot) {
  const a = path.join(APP_DIR, rel);
  const b = path.join(clientRoot, rel);
  try {
    return Buffer.compare(fs.readFileSync(a), fs.readFileSync(b)) === 0;
  } catch (e) { return false; }
}

/**
 * 纯函数：依据 app / 客户端文件清单与内容判定，计算同步计划。
 * @param {string[]} appFiles
 * @param {string[]} clientFiles
 * @param {(rel:string)=>boolean} [contentEquals] 仅对「两端都存在」的文件判定一致性
 * @returns {{toCopy:string[], missing:string[], drift:string[], clientOnly:string[]}}
 */
function planSync(appFiles, clientFiles, contentEquals) {
  const appSet = new Set(appFiles);
  const clientSet = new Set(clientFiles);
  const missing = appFiles.filter(function (f) { return !clientSet.has(f); });
  const clientOnly = clientFiles.filter(function (f) { return !appSet.has(f); });
  const common = appFiles.filter(function (f) { return clientSet.has(f); });
  const drift = (contentEquals ? common.filter(function (f) { return !contentEquals(f); }) : []);
  const toCopy = missing.concat(drift);
  return { toCopy: toCopy, missing: missing, drift: drift, clientOnly: clientOnly };
}

// 实际复制单个相对路径（含创建父目录）
function copyOne(rel, clientRoot) {
  const src = path.join(APP_DIR, rel);
  const dst = path.join(clientRoot, rel);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
}

// 删除客户端孤儿文件（仅 --prune）
function removeOne(rel, clientRoot) {
  const dst = path.join(clientRoot, rel);
  try { fs.unlinkSync(dst); } catch (e) { /* 忽略 */ }
}

/**
 * 执行同步（或仅计算）。返回每个客户端的计划汇总，供 CLI 打印 / 测试断言。
 * @param {{check?:boolean, dryRun?:boolean, prune?:boolean}} opts
 */
function run(opts) {
  opts = opts || {};
  const report = [];
  for (const c of CLIENTS) {
    const appFiles = listFiles(APP_DIR);
    const clientFiles = listFiles(c.root);
    const plan = planSync(appFiles, clientFiles, function (rel) {
      return contentEquals(rel, c.root);
    });
    if (!opts.check && !opts.dryRun) {
      plan.toCopy.forEach(function (rel) { copyOne(rel, c.root); });
      if (opts.prune) plan.clientOnly.forEach(function (rel) { removeOne(rel, c.root); });
    }
    report.push(Object.assign({ name: c.name, root: c.root }, plan));
  }
  return report;
}

// ----------------------------- CLI -----------------------------
function main(argv) {
  const opts = { check: false, dryRun: false, prune: false };
  for (const a of argv) {
    if (a === '--check') opts.check = true;
    else if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--prune') opts.prune = true;
  }
  const report = run(opts);
  let drift = false;
  for (const r of report) {
    const hasChange = r.toCopy.length > 0;
    if (hasChange) drift = true;
    if (opts.check || opts.dryRun) {
      console.log('[' + r.name + '] ' + r.root);
      if (r.missing.length) console.log('  缺失(将新增): ' + r.missing.length + ' 个 -> ' + r.missing.join(', '));
      if (r.drift.length) console.log('  漂移(将覆盖): ' + r.drift.length + ' 个 -> ' + r.drift.join(', '));
      if (r.clientOnly.length) console.log('  客户端专属(保留): ' + r.clientOnly.length + ' 个 -> ' + r.clientOnly.join(', '));
      if (!hasChange && !r.clientOnly.length) console.log('  已同源 ✅');
    } else {
      console.log('[' + r.name + '] 已同步: 复制 ' + r.toCopy.length + ' 个' +
        (opts.prune ? '，清理 ' + r.clientOnly.length + ' 个孤儿' : ''));
    }
  }
  if (opts.check && drift) {
    console.error('\n❌ 检测到客户端 Web 层与 app/ 漂移，请运行 `npm run client:sync` 后重新提交。');
    process.exit(1);
  }
  if (opts.check) console.log('\n✅ 全部客户端已与 app/ 同源。');
}

if (require.main === module) {
  main(process.argv.slice(2));
}

module.exports = { listFiles: listFiles, planSync: planSync, run: run, CLIENTS: CLIENTS, APP_DIR: APP_DIR };
