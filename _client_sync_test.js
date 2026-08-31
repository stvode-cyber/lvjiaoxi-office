'use strict';
/*
 * _client_sync_test.js — scripts/sync-clients.js 纯函数回归
 * 覆盖：planSync 的 缺失 / 漂移 / 客户端专属 / toCopy 合并逻辑。
 */
const assert = require('assert');
const v = require('./scripts/sync-clients.js');

let pass = 0;
function ok(name, cond) {
  assert.ok(cond, name);
  console.log('  ✓ ' + name);
  pass++;
}

// 模拟内容判定：same 集合内的 rel 视为一致，其余视为漂移
function makeEq(same) {
  const s = new Set(same || []);
  return function (rel) { return s.has(rel); };
}

console.log('planSync:');

// 1) 缺失：app 有、客户端没有
let r = v.planSync(['a.js', 'b.js'], ['a.js'], makeEq(['a.js']));
ok('缺失文件进入 missing', r.missing.join() === 'b.js');
ok('缺失同时进入 toCopy', r.toCopy.join() === 'b.js');
ok('无漂移', r.drift.length === 0);

// 2) 漂移：都存在但内容不同（contentEquals=false）
r = v.planSync(['a.js', 'b.js'], ['a.js', 'b.js'], makeEq(['a.js'])); // b.js 不在 same -> 漂移
ok('漂移文件进入 drift', r.drift.join() === 'b.js');
ok('漂移同时进入 toCopy', r.toCopy.join() === 'b.js');
ok('无缺失', r.missing.length === 0);

// 3) 客户端专属（客户端有、app 没有）：不进 toCopy，单独报告
r = v.planSync(['a.js'], ['a.js', 'c.js'], makeEq(['a.js', 'c.js']));
ok('客户端专属进入 clientOnly', r.clientOnly.join() === 'c.js');
ok('客户端专属不进 toCopy（默认保留）', r.toCopy.length === 0);

// 4) 完全同源
r = v.planSync(['a.js', 'b.js'], ['a.js', 'b.js'], makeEq(['a.js', 'b.js']));
ok('完全同源时 toCopy 为空', r.toCopy.length === 0);
ok('完全同源时 clientOnly 为空', r.clientOnly.length === 0);

// 5) 混合：缺失 + 漂移 + 专属 同时存在
// app: a(同) b(漂移) d(缺失) ; client: a(同) b(漂移) c(专属)
r = v.planSync(['a.js', 'b.js', 'd.js'], ['a.js', 'b.js', 'c.js'], makeEq(['a.js']));
ok('混合 missing=d.js', r.missing.join() === 'd.js');
ok('混合 drift=b.js', r.drift.join() === 'b.js');
ok('混合 clientOnly=c.js', r.clientOnly.join() === 'c.js');
ok('混合 toCopy=d.js,b.js（缺失+漂移，不含专属）', r.toCopy.join() === 'd.js,b.js');

// 6) contentEquals 缺省时 drift 为空（仅按清单，无法判内容）
r = v.planSync(['a.js', 'b.js'], ['a.js', 'b.js']);
ok('无 contentEquals 时不报漂移', r.drift.length === 0 && r.toCopy.length === 0);

console.log('\n✅ 全部 ' + pass + ' 条断言通过');
