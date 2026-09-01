'use strict';
/*
 * _publish_feed_test.js — 发布脚本的纯函数回归（零外部依赖、零凭证）。
 * 运行：node _publish_feed_test.js
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { collectArtifacts, detectMechanism, orderForUpload, META_RE, BLOCKMAP_RE } =
  require('./scripts/publish-desktop-feed.js');

let pass = 0;
function ok(cond, msg) {
  assert.ok(cond, msg);
  pass++;
  console.log('  ✓ ' + msg);
}

// 构造一个仿真的 dist 目录
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lvjx-dist-'));
const winExe = path.join(tmp, '绿角犀 Office Setup 1.0.0.exe');
const winPortable = path.join(tmp, '绿角犀 Office 1.0.0.exe');
const winBlock = path.join(tmp, '绿角犀 Office Setup 1.0.0.exe.blockmap');
const latestWin = path.join(tmp, 'latest.yml');
const latestMac = path.join(tmp, 'latest-mac.yml');
const latestLinux = path.join(tmp, 'latest-linux.yml');
const macDmg = path.join(tmp, '绿角犀 Office-1.0.0.dmg');
const linuxAppImg = path.join(tmp, '绿角犀 Office-1.0.0.AppImage');
const linuxDeb = path.join(tmp, '绿角犀 Office-1.0.0.deb');
const zip = path.join(tmp, '绿角犀 Office-1.0.0-mac.zip');
for (const f of [winExe, winPortable, winBlock, latestWin, latestMac, latestLinux, macDmg, linuxAppImg, linuxDeb, zip]) {
  fs.writeFileSync(f, 'x');
}
// 调试/配置类文件，应被排除
fs.writeFileSync(path.join(tmp, 'builder-debug.yml'), 'x');
fs.writeFileSync(path.join(tmp, 'app-config.yaml'), 'x');
fs.writeFileSync(path.join(tmp, '.DS_Store'), 'x');
// 一个 unpacked 子目录，里面文件不应被收集
const unpacked = path.join(tmp, 'win-unpacked');
fs.mkdirSync(unpacked);
fs.writeFileSync(path.join(unpacked, '绿角犀 Office.exe'), 'x');

console.log('collectArtifacts:');
const r = collectArtifacts(tmp);
ok(r.all.length === 10, `根级文件共 10 个（含 latest*.yml/blockmap），实际 ${r.all.length}`);
ok(r.installers.length === 6, `安装包 6 个（win exe×2 / mac dmg / linux appimage+deb / zip），实际 ${r.installers.length}`);
ok(r.metas.length === 3, `latest*.yml 3 个（win/mac/linux），实际 ${r.metas.length}`);
ok(r.blockmaps.length === 1, `blockmap 1 个，实际 ${r.blockmaps.length}`);
ok(!r.all.some((f) => f.includes('win-unpacked')), 'unpacked 子目录文件被排除');
ok(!r.all.some((f) => /builder-debug\.yml$/.test(f)), 'builder-debug.yml 被排除');
ok(!r.all.some((f) => /app-config\.yaml$/.test(f)), '非 latest 的 .yaml 被排除');
ok(!r.all.some((f) => /\.DS_Store$/.test(f)), '隐藏文件被排除');
ok(
  r.installers.every((f) => !META_RE.test(path.basename(f)) && !BLOCKMAP_RE.test(path.basename(f))),
  'installers 不含 latest*.yml 与 blockmap'
);

console.log('orderForUpload（原子性：安装包 → blockmap → 最新清单）:');
const ordered = orderForUpload(r.all);
ok(META_RE.test(path.basename(ordered[ordered.length - 1])), '最后一个文件是 latest*.yml（清单最后落地）');
ok(
  ordered.slice(0, ordered.length - 3).every((f) => !META_RE.test(path.basename(f))),
  '所有 latest*.yml 都排在尾部'
);
const firstBlock = ordered.findIndex((f) => BLOCKMAP_RE.test(path.basename(f)));
const firstMeta = ordered.findIndex((f) => META_RE.test(path.basename(f)));
ok(firstBlock !== -1 && firstMeta !== -1 && firstBlock < firstMeta, 'blockmap 在 latest*.yml 之前');
ok(ordered.length === r.all.length, '上传顺序集合与原始集合一致');

console.log('detectMechanism:');
const base = {};
ok(detectMechanism(base) === 'none', '无相关变量 → none');
ok(detectMechanism({ LVJX_FEED_SSH_HOST: 'h' }) === 'ssh', '有 SSH_HOST → ssh');
ok(detectMechanism({ LVJX_FEED_S3_BUCKET: 'b' }) === 's3', '有 S3_BUCKET → s3');
ok(
  detectMechanism({ LVJX_FEED_S3_BUCKET: 'b', LVJX_FEED_SSH_HOST: 'h' }) === 's3',
  'S3 优先于 SSH'
);

console.log('collectArtifacts --latest-only（仅最新版）:');
const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), 'lvjx-dist2-'));
fs.writeFileSync(path.join(tmp2, '绿角犀 Office Setup 1.0.0.exe'), 'x');
fs.writeFileSync(path.join(tmp2, '绿角犀 Office Setup 1.0.0.exe.blockmap'), 'x');
fs.writeFileSync(path.join(tmp2, '绿角犀 Office 1.0.0.exe'), 'x');
fs.writeFileSync(path.join(tmp2, '绿角犀 Office Setup 1.0.1.exe'), 'x'); // 旧版本，应被排除
fs.writeFileSync(path.join(tmp2, '绿角犀 Office Setup 1.0.1.exe.blockmap'), 'x');
fs.writeFileSync(path.join(tmp2, 'latest.yml'), 'version: 1.0.0\npath: 绿角犀 Office Setup 1.0.0.exe\n');
const r2 = collectArtifacts(tmp2, { latestOnly: true });
ok(r2.all.length === 4, `latest-only 仅 4 个（1.0.0 的 nsis+portable+blockmap+latest.yml），实际 ${r2.all.length}`);
ok(!r2.all.some((f) => f.includes('1.0.1')), '旧版本 1.0.1 被排除');
ok(
  r2.all.some((f) => f.includes('绿角犀 Office Setup 1.0.0.exe')) &&
  r2.all.some((f) => f.includes('绿角犀 Office 1.0.0.exe')),
  '1.0.0 安装包（nsis + 便携）均保留'
);
fs.rmSync(tmp2, { recursive: true, force: true });

console.log('空目录容错:');
const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'lvjx-empty-'));
const re = collectArtifacts(empty);
ok(re.installers.length === 0 && re.metas.length === 0, '空 dist → 空集合，不抛错');
const missing = collectArtifacts(path.join(empty, 'nope'));
ok(missing.all.length === 0, '不存在的目录 → 空集合，不抛错');

fs.rmSync(tmp, { recursive: true, force: true });
fs.rmSync(empty, { recursive: true, force: true });

console.log(`\n全部通过：${pass} 断言`);
