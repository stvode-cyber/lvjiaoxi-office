#!/usr/bin/env node
'use strict';
/*
 * 本地发版准备脚本：计算下一个版本号、生成 changelog、打 git tag。
 * 真正的构建/发布由 CI（release.yml，打 tag 触发）完成；本脚本只做「准备」。
 *
 * 用法：
 *   node scripts/make-release.js patch                 # 修订 +1 并打印计划（dry-run）
 *   node scripts/make-release.js minor --notes "a|b"   # 次版本 +1，更新说明用 | 分隔
 *   node scripts/make-release.js --set 1.2.3 --apply   # 直接指定版本并真正执行（bump + tag）
 *   node scripts/make-release.js patch --apply         # bump 版本 + 打 tag vX.Y.Z（不自动 push）
 *   node scripts/make-release.js patch --url "https://..."  # 同时写入 version.json 的下载页 URL
 *
 * 下载页 URL 解析优先级：--url 显式 > 环境变量 LVJX_RELEASE_URL > 由 git remote 推导
 * GitHub Release 标签页（https://github.com/<owner>/<repo>/releases/tag/<tag>）。
 *
 * 纯函数 nextVersion / tagFor / formatChangelog / versionCmp / deriveRepoSlug / releaseUrl
 * 已配 _make_release_test.js 回归。
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)$/;

/** 语义化版本号自增。step: patch|minor|major；非法版本抛错。 */
function nextVersion(current, step) {
  const m = SEMVER_RE.exec(current);
  if (!m) throw new Error(`非法版本号: ${current}`);
  let [maj, min, pat] = m.slice(1).map(Number);
  if (step === 'major') {
    maj += 1; min = 0; pat = 0;
  } else if (step === 'minor') {
    min += 1; pat = 0;
  } else if (step === 'patch') {
    pat += 1;
  } else {
    throw new Error(`未知步长: ${step}（应为 patch|minor|major）`);
  }
  return `${maj}.${min}.${pat}`;
}

/** 版本号 → git tag 名（v 前缀）。 */
function tagFor(version) {
  if (!SEMVER_RE.test(version)) throw new Error(`非法版本号: ${version}`);
  return 'v' + version;
}

/** 版本比较：a<b → -1, a==b → 0, a>b → 1。 */
function versionCmp(a, b) {
  const pa = SEMVER_RE.exec(a), pb = SEMVER_RE.exec(b);
  if (!pa || !pb) throw new Error('非法版本号比较');
  for (let i = 1; i <= 3; i++) {
    const d = Number(pa[i]) - Number(pb[i]);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

/** 把 notes 数组格式化为 markdown changelog 片段。 */
function formatChangelog(notes, version, date) {
  const lines = [`## ${tagFor(version)} (${date})`];
  const list = (notes || []).filter((n) => String(n).trim().length > 0);
  if (list.length === 0) {
    lines.push('- （无更新说明）');
  } else {
    for (const n of list) lines.push(`- ${String(n).trim()}`);
  }
  return lines.join('\n');
}

/** 读取 package.json 的当前版本。 */
function currentVersion(pkgPath) {
  const p = pkgPath || path.resolve(__dirname, '..', 'package.json');
  return JSON.parse(fs.readFileSync(p, 'utf8')).version;
}

/**
 * 从 git remote（ssh 或 https 形式）解析 `owner/repo` 片段。
 * 例：git@github.com:foo/bar.git -> "foo/bar"；https://github.com/foo/bar.git -> "foo/bar"
 * 解析失败返回 null（静默回退，不抛错）。
 * @param {string} [remote]
 * @returns {string|null}
 */
function deriveRepoSlug(remote) {
  let r = remote;
  if (r == null) {
    try { r = execFileSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf8' }).trim(); }
    catch (e) { return null; }
  }
  const m = /github\.com[:/]([^/]+)\/(.+?)(?:\.git)?$/i.exec(r || '');
  if (!m) return null;
  return m[1] + '/' + m[2];
}

/** 拼出 GitHub Release 标签页 URL。 */
function releaseUrl(repo, tag) {
  if (!repo || !tag) throw new Error('releaseUrl 需要 repo 与 tag');
  return `https://github.com/${repo}/releases/tag/${tag}`;
}

/**
 * 解析最终要写入 version.json 的下载页 URL：
 *   1) 显式 --url；2) 环境变量 LVJX_RELEASE_URL；3) 由 git remote 推导的 Release 标签页。
 * 三者皆无则返回 null（调用方据此「保留原 URL，不覆盖」）。
 * @param {{url?:string, tag:string, repo?:string}} opts
 * @returns {string|null}
 */
function resolveReleaseUrl(opts) {
  if (opts.url) return opts.url;
  if (process.env.LVJX_RELEASE_URL) return process.env.LVJX_RELEASE_URL;
  const slug = opts.repo || deriveRepoSlug();
  if (slug) return releaseUrl(slug, opts.tag);
  return null;
}

function main() {
  const argv = process.argv.slice(2);
  const dryRun = !argv.includes('--apply');
  let step = null;
  let setVersion = null;
  let setUrl = null;
  const notesParts = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === 'patch' || a === 'minor' || a === 'major') step = a;
    else if (a === '--set') setVersion = argv[++i];
    else if (a === '--url') setUrl = argv[++i];
    else if (a === '--notes') notesParts.push(argv[++i] || '');
  }
  const notes = notesParts.join('|').split('|').map((s) => s.trim()).filter(Boolean);

  const cur = currentVersion();
  const next = setVersion || nextVersion(cur, step || 'patch');
  if (setVersion && !SEMVER_RE.test(setVersion)) {
    console.error(`非法 --set 版本号: ${setVersion}`);
    return 1;
  }
  const today = new Date().toISOString().slice(0, 10);
  const tag = tagFor(next);
  const changelog = formatChangelog(notes, next, today);
  const url = resolveReleaseUrl({ url: setUrl, tag: tag });

  console.log('=== 发版计划 ===');
  console.log(`当前版本 : ${cur}`);
  console.log(`下一版本 : ${next}`);
  console.log(`git tag  : ${tag}`);
  if (url) console.log(`下载页   : ${url}`);
  else console.log('下载页   : （未指定，保留 version.json 原值）');
  console.log('changelog:');
  console.log(changelog);

  if (dryRun) {
    console.log('\n(dry-run) 未做任何改动。加 --apply 以真正 bump 版本并打 tag。');
    return 0;
  }

  // 真正执行：复用 bump-version.js 同步四处版本 + notes + url
  const bumpArgs = [path.resolve(__dirname, 'bump-version.js')];
  if (setVersion) bumpArgs.push('--set', setVersion);
  else bumpArgs.push(step || 'patch');
  if (notes.length) bumpArgs.push('--notes', notes.join('|'));
  if (url) bumpArgs.push('--url', url);
  execFileSync('node', bumpArgs, { stdio: 'inherit' });

  // 打 tag（不自动 push，避免误推；用户确认后 git push --tags）
  execFileSync('git', ['tag', tag], { stdio: 'inherit' });
  console.log(`\n已打 tag ${tag}（未推送）。确认后执行：`);
  console.log(`  git push && git push --tags`);
  return 0;
}

module.exports = { nextVersion, tagFor, versionCmp, formatChangelog, currentVersion, deriveRepoSlug, releaseUrl, resolveReleaseUrl, SEMVER_RE };

if (require.main === module) {
  process.exit(main());
}
