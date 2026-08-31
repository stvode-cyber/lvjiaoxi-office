'use strict';
/*
 * _make_release_test.js — make-release 纯函数回归。
 * 运行：node _make_release_test.js
 */
const assert = require('assert');
const { nextVersion, tagFor, versionCmp, formatChangelog, SEMVER_RE } =
  require('./scripts/make-release.js');

let pass = 0;
function ok(cond, msg) {
  assert.ok(cond, msg);
  pass++;
  console.log('  ✓ ' + msg);
}

console.log('nextVersion:');
ok(nextVersion('1.0.0', 'patch') === '1.0.1', '1.0.0 patch → 1.0.1');
ok(nextVersion('1.0.0', 'minor') === '1.1.0', '1.0.0 minor → 1.1.0');
ok(nextVersion('1.0.0', 'major') === '2.0.0', '1.0.0 major → 2.0.0');
ok(nextVersion('1.9.9', 'minor') === '1.10.0', '1.9.9 minor 进位 → 1.10.0');
ok(nextVersion('0.0.5', 'patch') === '0.0.6', '0.0.5 patch → 0.0.6');
ok(() => nextVersion('1.0', 'patch').toString(), '非法版本号抛错');

console.log('tagFor:');
ok(tagFor('1.2.3') === 'v1.2.3', '1.2.3 → v1.2.3');
ok(() => tagFor('1.2').toString(), '非法版本号 tag 抛错');

console.log('versionCmp:');
ok(versionCmp('1.0.0', '1.0.1') === -1, '1.0.0 < 1.0.1');
ok(versionCmp('1.0.1', '1.0.0') === 1, '1.0.1 > 1.0.0');
ok(versionCmp('1.2.0', '1.2.0') === 0, '1.2.0 == 1.2.0');
ok(versionCmp('2.0.0', '1.9.9') === 1, '2.0.0 > 1.9.9');

console.log('formatChangelog:');
const c1 = formatChangelog(['修复导出崩溃', '优化启动'], '1.0.1', '2026-08-17');
ok(c1.includes('## v1.0.1 (2026-08-17)'), '标题含 tag 与日期');
ok(c1.includes('- 修复导出崩溃') && c1.includes('- 优化启动'), '每条 note 一行');
const c2 = formatChangelog([], '1.0.1', '2026-08-17');
ok(c2.includes('（无更新说明）'), '空 notes 给占位行');
const c3 = formatChangelog(['  a  ', '', 'b'], '1.0.1', '2026-08-17');
ok(c3.includes('- a') && c3.includes('- b'), 'trim 并过滤空 note');

console.log('SEMVER_RE:');
ok(SEMVER_RE.test('10.20.30'), '10.20.30 合法');
ok(!SEMVER_RE.test('1.0'), '1.0 非法');

console.log(`\n全部通过：${pass} 断言`);
