/* 绿角犀 Office · 桌面更新源解析（纯函数，零依赖，可被 Node 单测）
 *
 * 把「远程更新源」解析为 electron-updater 的 feed 配置对象：
 *   - LVJX_UPDATE_FEED（generic provider，需自建静态托管 + 代码签名）
 *   - 否则回退 GitHub Releases（从 release URL / version.json.url / 显式 repo 推导 owner/repo）
 *
 * 这样未配置私有 feed 的桌面也能直接吃到 GitHub Release 上的最新安装包，
 * 已签名则静默下载安装，未签名（或安装被拦）则自动打开发布页手动下载。
 */
"use strict";

function normalizeFeedUrl(feed) {
  if (!feed) return "";
  return String(feed).replace(/\/+$/, "") + "/";
}

// 从 GitHub releases / tag 页面 URL 提取 owner/repo
function deriveGithubRepo(url) {
  if (!url || typeof url !== "string") return null;
  const m = /github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)(?:[/?#]|$)/.exec(url);
  if (!m) return null;
  return { owner: m[1], repo: m[2] };
}

function isValidRepo(slug) {
  return typeof slug === "string" && /^[\w.-]+\/[\w.-]+$/.test(slug);
}

/* 解析更新源
 * opts: { feed, releaseUrl, versionJsonUrl, githubRepo }
 * 返回：
 *   { provider: "generic", url }                          —— 私有 feed
 *   { provider: "github", owner, repo, downloadUrl }      —— GitHub Releases 回退
 *   null                                                   —— 无可用远程更新源（桌面视为已最新）
 *
 * 优先级：feed > 显式 githubRepo > releaseUrl 推导 > versionJsonUrl 推导
 */
function resolveUpdateProvider(opts) {
  opts = opts || {};
  if (opts.feed) {
    return { provider: "generic", url: normalizeFeedUrl(opts.feed) };
  }
  if (isValidRepo(opts.githubRepo)) {
    const parts = opts.githubRepo.split("/");
    return {
      provider: "github",
      owner: parts[0],
      repo: parts[1],
      downloadUrl: "https://github.com/" + parts[0] + "/" + parts[1] + "/releases"
    };
  }
  const gh = deriveGithubRepo(opts.releaseUrl) || deriveGithubRepo(opts.versionJsonUrl);
  if (gh) {
    return {
      provider: "github",
      owner: gh.owner,
      repo: gh.repo,
      downloadUrl: "https://github.com/" + gh.owner + "/" + gh.repo + "/releases"
    };
  }
  return null;
}

module.exports = { normalizeFeedUrl, deriveGithubRepo, isValidRepo, resolveUpdateProvider };
