/* 绿角犀 Office · 桌面更新源解析（纯函数，零依赖，可被 Node 单测）
 *
 * 把「远程更新源」解析为 electron-updater 的 feed 配置对象：
 *   - LVJX_UPDATE_FEED（generic provider，自建静态托管 + 代码签名）
 *   - 否则回退 GitHub Releases（从 release URL / version.json.url / 显式 repo 推导 owner/repo）
 *   - 否则把 version.json.url 这个「非 GitHub 的发布地址」（如 https://lujax.fun/releases）
 *     直接当作 generic provider，启用应用内静默下载/安装通道（无需手动下载原件）。
 *
 * 这样桌面端默认就能吃到 lujax.fun/releases 上的最新安装包：已托管 latest.yml + 安装包
 * 即静默下载安装；任意环节失败（无依赖/无 latest.yml/被杀软拦截）则自动打开发布页兜底。
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
 *   { provider: "generic", url }                          —— 私有 feed 或 version.json.url（非 GitHub 发布地址）
 *   { provider: "github", owner, repo, downloadUrl }      —— GitHub Releases 回退
 *   null                                                   —— 无可用远程更新源（桌面视为已最新）
 *
 * 优先级：feed > 显式 githubRepo > releaseUrl/versionJsonUrl 推导 GitHub > versionJsonUrl 非 GitHub 作 generic
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
  // 非 GitHub 的发布地址（如 version.json.url = https://lujax.fun/releases）：
  // 直接作为 generic provider 启用应用内静默更新通道，无需用户手动下载安装包。
  if (opts.versionJsonUrl && /^https?:\/\//i.test(opts.versionJsonUrl) && !/github\.com/i.test(opts.versionJsonUrl)) {
    return { provider: "generic", url: normalizeFeedUrl(opts.versionJsonUrl) };
  }
  return null;
}

module.exports = { normalizeFeedUrl, deriveGithubRepo, isValidRepo, resolveUpdateProvider };
