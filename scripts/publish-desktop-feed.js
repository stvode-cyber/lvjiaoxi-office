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
 *  node scripts/publish-desktop-feed.js                 # 默认发布 dist/（全部版本）
 *  node scripts/publish-desktop-feed.js --latest-only   # 仅发布 latest.yml 指向的最新版本（避免上传历史版本堆积）
 *  node scripts/publish-desktop-feed.js --dist ./dist   # 指定目录
 *  node scripts/publish-desktop-feed.js --dry-run       # 只列出将上传的文件与目标机制
 *  REMOTE_DIR 可省略：SSH 模式下自动 `find` 定位远端第一个 releases 目录（无需手动记路径）
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
function parseLatestVersion(distDir) {
  try {
    const txt = fs.readFileSync(path.join(distDir, 'latest.yml'), 'utf8');
    const m = txt.match(/^version:\s*([\d.]+)/m);
    return m ? m[1] : null;
  } catch (e) { return null; }
}

/**
 * 收集 dist/ 根级需要上传到 feed 的文件。
 * @param {string} distDir
 * @param {{latestOnly?:boolean}} [opts] latestOnly=true 时仅保留 latest.yml 指向的最新版本产物
 * @returns {{installers:string[], metas:string[], blockmaps:string[], all:string[]}}
 */
function collectArtifacts(distDir, opts) {
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
  // --latest-only：仅保留 latest.yml 指向版本号的最新产物（安装包/blockmap），避免上传历史版本堆积
  if (opts && opts.latestOnly) {
    const ver = parseLatestVersion(distDir);
    if (!ver) return { installers: [], metas: [], blockmaps: [], all: [] };
    const verRe = new RegExp(ver.replace(/\./g, '\\.') + '\\.(exe|exe\\.blockmap)$');
    const kept = all.filter((f) => META_RE.test(path.basename(f)) || verRe.test(path.basename(f)));
    all.length = 0;
    for (const f of kept) all.push(f);
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

// 写临时私钥文件（用完调用方负责删除）；返回临时路径，无 key 返回 null
function ensureTempKey(env) {
  if (!env.LVJX_FEED_SSH_KEY) return null;
  const keyPath = path.join(os.tmpdir(), 'lvjx_feed_' + Date.now() + '.key');
  fs.writeFileSync(keyPath, Buffer.from(env.LVJX_FEED_SSH_KEY, 'base64'));
  fs.chmodSync(keyPath, 0o600);
  return keyPath;
}

// 返回 ssh 基础参数数组（不含 host/cmd），供 rsync -e 与 sshExec 复用
function sshBaseArgs(env, keyPath) {
  return ['-i', keyPath, '-o', 'StrictHostKeyChecking=no', '-o', 'UserKnownHostsFile=/dev/null'];
}

// 经 SSH 在远端执行命令并返回 stdout（用于只读探测，如定位 releases 目录）
function sshExec(env, cmd) {
  const keyPath = ensureTempKey(env);
  if (!keyPath) throw new Error('SSH 发布缺少 LVJX_FEED_SSH_KEY(base64)');
  try {
    return execFileSync('ssh', [
      ...sshBaseArgs(env, keyPath),
      `${env.LVJX_FEED_SSH_USER}@${env.LVJX_FEED_SSH_HOST}`,
      cmd,
    ], { encoding: 'utf8' });
  } finally {
    try { fs.unlinkSync(keyPath); } catch (e) {}
  }
}

// 从 `find` 输出中挑第一个非空且以 releases 结尾的目录行
function pickReleasesDir(findOutput) {
  if (!findOutput) return null;
  for (const line of findOutput.split('\n')) {
    const t = line.trim();
    if (t && /releases$/.test(t)) return t;
  }
  return null;
}

// 解析 REMOTE_DIR：显式设置优先；否则 SSH 模式下自动 find 定位第一个 releases 目录
function resolveRemoteDir(env) {
  if (env.LVJX_FEED_REMOTE_DIR) return env.LVJX_FEED_REMOTE_DIR;
  if (!env.LVJX_FEED_SSH_HOST || !env.LVJX_FEED_SSH_USER || !env.LVJX_FEED_SSH_KEY) return null;
  const findCmd = "find /var/www /opt /srv /usr/share/nginx -maxdepth 4 -type d -name releases 2>/dev/null | head -1";
  const out = sshExec(env, findCmd);
  return pickReleasesDir(out);
}

function publishViaSsh(files, env) {
  if (!env.LVJX_FEED_SSH_USER) throw new Error('SSH 发布缺少 LVJX_FEED_SSH_USER');
  const keyPath = ensureTempKey(env);
  if (!keyPath) throw new Error('SSH 发布缺少 LVJX_FEED_SSH_KEY(base64)');
  const remoteDir = (env.LVJX_FEED_REMOTE_DIR || '').replace(/\/$/, '');
  if (!remoteDir) throw new Error('SSH 发布缺少 LVJX_FEED_REMOTE_DIR（或自动定位失败，请显式设置）');
  const remote = `${env.LVJX_FEED_SSH_USER}@${env.LVJX_FEED_SSH_HOST}:${remoteDir}/`;
  const sshOpt = ['-i', keyPath, '-o', 'StrictHostKeyChecking=no', '-o', 'UserKnownHostsFile=/dev/null'];
  try {
    execFileSync('rsync', ['-azP', '-e', 'ssh ' + sshOpt.join(' '), ...files, remote], { stdio: 'inherit' });
  } finally {
    try { fs.unlinkSync(keyPath); } catch (e) {}
  }
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

  const latestOnly = argv.includes('--latest-only');
  const { installers, metas, blockmaps, all } = collectArtifacts(distDir, { latestOnly });
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
    console.log(`[dry-run] mechanism=${mech} latestOnly=${latestOnly}`);
    if (mech === 'ssh' && !process.env.LVJX_FEED_REMOTE_DIR) {
      console.log('[dry-run] REMOTE_DIR 未设置，发布时将自动 SSH 定位 releases 目录（需 LVJX_FEED_SSH_* 凭证）');
    }
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
  if (mech === 'ssh') {
    const dir = resolveRemoteDir(process.env);
    if (dir) {
      process.env.LVJX_FEED_REMOTE_DIR = dir;
      console.log(`[auto] 已定位 releases 目录: ${dir}`);
    }
    publishViaSsh(ordered, process.env);
  } else if (mech === 's3') publishViaS3(ordered, process.env);
  console.log('发布完成。');
  return 0;
}

module.exports = { collectArtifacts, detectMechanism, orderForUpload, META_RE, BLOCKMAP_RE, pickReleasesDir, resolveRemoteDir };

if (require.main === module) {
  process.exit(main());
}
