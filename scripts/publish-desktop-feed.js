#!/usr/bin/env node
'use strict';
/*
 * 把 electron-builder 产出的桌面安装包发布到 LVJX_UPDATE_FEED 指向的静态目录。
 *
 * 设计要点：
 *  - electron-updater generic provider 不支持 HTTP PUT 自动上传（见 UPDATER.md），
 *    所以这里在构建完成后，把 dist/ 根级产物「显式上传」到 feed 目录。
 *  - 上传机制由环境变量二选一自动识别：
 *      · SSH：LVJX_FEED_SSH_HOST / LVJX_FEED_SSH_USER / LVJX_FEED_SSH_KEY(base64) / LVJX_FEED_REMOTE_DIR
 *            -> 通过 rsync 推送到自托管静态服务器
 *      · S3 ：LVJX_FEED_S3_BUCKET / LVJX_FEED_S3_PREFIX(可选)
 *            -> 通过 aws s3 cp 推送到对象存储（前置 CDN 即 feed 目录）
 *  - 纯函数 collectArtifacts() 与 detectMechanism() 已配 _publish_feed_test.js 回归，
 *    不依赖任何外部凭证即可测试。
 *
 * 用法：
 *  node scripts/publish-desktop-feed.js                 # 默认发布 dist/
 *  node scripts/publish-desktop-feed.js --dist ./dist   # 指定目录
 *  node scripts/publish-desktop-feed.js --dry-run       # 只列出将上传的文件与目标机制
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

// 发布清单：latest.yml / latest-mac.yml / latest-linux.yml
const META_RE = /^latest.*\.yml$/;
// 增量更新加速文件
const BLOCKMAP_RE = /\.blockmap$/;

/**
 * 收集 dist/ 根级需要上传到 feed 的文件。
 * 只取根级文件——electron-builder 的 unpacked 运行目录（win-unpacked / mac / mac-arm64 /
 * linux-unpacked）都在子目录里，不应上传。安装包与 latest*.yml 永远在 dist 根。
 * 同时排除调试/配置类文件（builder-debug.yml、其它非 latest 的 .yml/.yaml、隐藏文件）。
 * @param {string} distDir
 * @returns {{installers:string[], metas:string[], blockmaps:string[], all:string[]}}
 */
function collectArtifacts(distDir) {
  if (!fs.existsSync(distDir)) {
    return { installers: [], metas: [], blockmaps: [], all: [] };
  }
  const all = [];
  for (const entry of fs.readdirSync(distDir, { withFileTypes: true })) {
    if (entry.isDirectory()) continue; // 跳过所有子目录（unpacked 运行目录）
    const base = entry.name;
    if (base.startsWith('.')) continue; // 隐藏文件
    if (base === 'builder-debug.yml') continue; // 调试产物
    const ext = path.extname(base).toLowerCase();
    // 仅保留 latest*.yml；其它 .yml/.yaml（如配置）排除
    if ((ext === '.yml' || ext === '.yaml') && !META_RE.test(base)) continue;
    all.push(path.join(distDir, base));
  }
  const name = (f) => path.basename(f);
  const metas = all.filter((f) => META_RE.test(name(f)));
  const blockmaps = all.filter((f) => BLOCKMAP_RE.test(name(f)));
  const installers = all.filter(
    (f) => !META_RE.test(name(f)) && !BLOCKMAP_RE.test(name(f))
  );
  return { installers, metas, blockmaps, all };
}

/**
 * 根据环境变量推断上传机制。
 * @param {NodeJS.ProcessEnv} env
 * @returns {'s3'|'ssh'|'none'}
 */
function detectMechanism(env) {
  if (env.LVJX_FEED_S3_BUCKET) return 's3';
  if (env.LVJX_FEED_SSH_HOST) return 'ssh';
  return 'none';
}

/**
 * 上传顺序：先安装包 -> 再 blockmap -> 最后 latest*.yml。
 * 让清单最后落地，保证用户在拿到新 latest.yml 时所有二进制已就位（原子性）。
 * @param {string[]} files
 * @returns {string[]}
 */
function orderForUpload(files) {
  const name = (f) => path.basename(f);
  const installers = files.filter(
    (f) => !META_RE.test(name(f)) && !BLOCKMAP_RE.test(name(f))
  );
  const blockmaps = files.filter((f) => BLOCKMAP_RE.test(name(f)));
  const metas = files.filter((f) => META_RE.test(name(f)));
  return [...installers, ...blockmaps, ...metas];
}

function publishViaSsh(files, env) {
  if (!env.LVJX_FEED_SSH_USER || !env.LVJX_FEED_SSH_KEY || !env.LVJX_FEED_REMOTE_DIR) {
    throw new Error(
      'SSH 发布缺少必要变量：LVJX_FEED_SSH_USER / LVJX_FEED_SSH_KEY(base64) / LVJX_FEED_REMOTE_DIR'
    );
  }
  const keyPath = path.join(os.tmpdir(), 'lvjx_feed_' + Date.now() + '.key');
  fs.writeFileSync(keyPath, Buffer.from(env.LVJX_FEED_SSH_KEY, 'base64'));
  fs.chmodSync(keyPath, 0o600);
  const remote = `${env.LVJX_FEED_SSH_USER}@${env.LVJX_FEED_SSH_HOST}:${env.LVJX_FEED_REMOTE_DIR.replace(/\/$/, '')}/`;
  const sshOpt = `ssh -i ${keyPath} -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null`;
  execFileSync('rsync', ['-azP', '-e', sshOpt, ...files, remote], {
    stdio: 'inherit',
  });
}

function publishViaS3(files, env) {
  const bucket = env.LVJX_FEED_S3_BUCKET;
  const prefix = (env.LVJX_FEED_S3_PREFIX || '').replace(/^\/+|\/+$/g, '');
  for (const f of files) {
    const key = `${prefix ? prefix + '/' : ''}${path.basename(f)}`;
    execFileSync('aws', ['s3', 'cp', f, `s3://${bucket}/${key}`], { stdio: 'inherit' });
  }
}

function main() {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes('--dry-run');
  let distDir = path.resolve(__dirname, '..', 'dist');
  const di = argv.indexOf('--dist');
  if (di !== -1 && argv[di + 1]) distDir = path.resolve(argv[di + 1]);

  const { installers, metas, blockmaps, all } = collectArtifacts(distDir);
  const ordered = orderForUpload(all);
  const mech = detectMechanism(process.env);

  if (dryRun) {
    console.log(`[dry-run] dist=${distDir}`);
    console.log(`[dry-run] found ${ordered.length} file(s) to upload:`);
    for (const f of ordered) {
      const tag = META_RE.test(path.basename(f))
        ? 'meta'
        : BLOCKMAP_RE.test(path.basename(f))
        ? 'blockmap'
        : 'installer';
      console.log(`  [${tag}] ${f}`);
    }
    console.log(`[dry-run] mechanism=${mech}`);
    return 0;
  }

  if (ordered.length === 0) {
    console.error(`No publishable artifacts found in ${distDir}`);
    return 1;
  }
  if (mech === 'none') {
    console.error(
      '未配置发布机制：请设置 LVJX_FEED_SSH_HOST（SSH/rsync）或 LVJX_FEED_S3_BUCKET（S3）。'
    );
    return 2;
  }

  const feed = process.env.LVJX_UPDATE_FEED || '(unknown)';
  console.log(`发布 ${ordered.length} 个产物（机制=${mech}）到 feed: ${feed}`);
  if (mech === 'ssh') publishViaSsh(ordered, process.env);
  else if (mech === 's3') publishViaS3(ordered, process.env);
  console.log('发布完成。');
  return 0;
}

module.exports = { collectArtifacts, detectMechanism, orderForUpload, META_RE, BLOCKMAP_RE };

if (require.main === module) {
  process.exit(main());
}
