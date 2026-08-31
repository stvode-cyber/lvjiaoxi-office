#!/usr/bin/env node
'use strict';
/*
 * version.json 下载页 URL 注入回归测试。
 * 覆盖：
 *  - bump-version.js：--url 写入 / LVJX_RELEASE_URL 环境变量 / 两者皆无时保留原值
 *  - make-release.js：deriveRepoSlug（ssh+https remote 解析）/ releaseUrl / resolveReleaseUrl 优先级
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const bump = require('./scripts/bump-version.js');
const mk = require('./scripts/make-release.js');

let passed = 0;
function ok(cond, msg) {
  assert.ok(cond, msg);
  console.log('  ✓ ' + msg);
  passed++;
}

// 构造一个最小可 bump 的工程根
function makeTmpRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lvjx-url-'));
  fs.mkdirSync(path.join(root, 'app'), { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'),
    JSON.stringify({ name: 't', version: '1.0.0' }, null, 2));
  fs.writeFileSync(path.join(root, 'app', 'index.html'),
    '<!doctype html><html><head><meta name="x-app-version" content="1.0.0"></head><body></body></html>');
  fs.writeFileSync(path.join(root, 'app', 'sw.js'),
    'const CACHE = "lvjiaoxi-office-v1";');
  fs.writeFileSync(path.join(root, 'app', 'version.json'),
    JSON.stringify({ version: '1.0.0', url: 'keepme' }, null, 2));
  return root;
}
function readVer(root) {
  return JSON.parse(fs.readFileSync(path.join(root, 'app', 'version.json'), 'utf8'));
}

console.log('1) bump-version --url 写入 version.json.url');
{
  const root = makeTmpRoot();
  bump.run({ root: root, type: 'patch', url: 'https://release.test/v1.0.1', dryRun: false });
  ok(readVer(root).url === 'https://release.test/v1.0.1', '显式 --url 已写入');
  ok(readVer(root).version === '1.0.1', '版本号同步更新');
}

console.log('2) bump-version 尊重 LVJX_RELEASE_URL 环境变量');
{
  const root = makeTmpRoot();
  const prev = process.env.LVJX_RELEASE_URL;
  process.env.LVJX_RELEASE_URL = 'https://env.test/r';
  try {
    bump.run({ root: root, type: 'patch', dryRun: false });
    ok(readVer(root).url === 'https://env.test/r', '环境变量 LVJX_RELEASE_URL 已写入');
  } finally {
    if (prev === undefined) delete process.env.LVJX_RELEASE_URL; else process.env.LVJX_RELEASE_URL = prev;
  }
}

console.log('3) bump-version 两者皆无时保留 version.json 原值');
{
  const root = makeTmpRoot();
  const prev = process.env.LVJX_RELEASE_URL;
  delete process.env.LVJX_RELEASE_URL;
  try {
    bump.run({ root: root, type: 'patch', dryRun: false });
    ok(readVer(root).url === 'keepme', '原 url 被保留（未覆盖为占位符）');
  } finally {
    if (prev !== undefined) process.env.LVJX_RELEASE_URL = prev;
  }
}

console.log('4) make-release.deriveRepoSlug 解析 git remote');
{
  ok(mk.deriveRepoSlug('git@github.com:foo/bar.git') === 'foo/bar', 'ssh 形式 remote');
  ok(mk.deriveRepoSlug('https://github.com/foo/bar.git') === 'foo/bar', 'https 形式 remote');
  ok(mk.deriveRepoSlug('https://github.com/foo/bar') === 'foo/bar', '无 .git 后缀');
  ok(mk.deriveRepoSlug('git@gitlab.com:foo/bar.git') === null, '非 github 返回 null');
  ok(mk.deriveRepoSlug('not-a-remote') === null, '非法 remote 返回 null');
}

console.log('5) make-release.releaseUrl 格式');
{
  ok(mk.releaseUrl('foo/bar', 'v1.2.3') === 'https://github.com/foo/bar/releases/tag/v1.2.3',
    'Release 标签页 URL 正确');
}

console.log('6) make-release.resolveReleaseUrl 优先级');
{
  const prev = process.env.LVJX_RELEASE_URL;
  delete process.env.LVJX_RELEASE_URL;
  try {
    // 显式最高优先
    ok(mk.resolveReleaseUrl({ url: 'https://explicit', tag: 'v1.0.0' }) === 'https://explicit',
      '显式 --url 优先');
    // 环境变量次之
    process.env.LVJX_RELEASE_URL = 'https://env';
    ok(mk.resolveReleaseUrl({ tag: 'v1.0.0' }) === 'https://env', '环境变量次之');
    // 回退推导（给定 repo）
    delete process.env.LVJX_RELEASE_URL;
    ok(mk.resolveReleaseUrl({ tag: 'v9.9.9', repo: 'foo/bar' }) ===
      'https://github.com/foo/bar/releases/tag/v9.9.9', '回退到 git 推导 URL');
    // 三者皆无返回 null（保留原值）
    ok(mk.resolveReleaseUrl({ tag: 'v1.0.0' }) === null, '全无时返回 null（保留原值）');
  } finally {
    if (prev !== undefined) process.env.LVJX_RELEASE_URL = prev; else delete process.env.LVJX_RELEASE_URL;
  }
}

console.log('\n全部通过：' + passed + ' 断言');
