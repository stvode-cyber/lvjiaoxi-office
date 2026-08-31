/* 绿角犀 Office · 桌面更新源解析测试（纯函数，零依赖）
   验证 electron/feed-config.js 的 resolveUpdateProvider / deriveGithubRepo 等。 */
const fc = require("C:/Users/Administrator/Desktop/绿角犀办公软件/electron/feed-config.js");

let pass = 0, fail = 0; const fails = [];
function ok(name, cond) { if (cond) { pass++; } else { fail++; fails.push(name); console.log("  ✗ " + name); } }

// normalizeFeedUrl
ok("normalizeFeedUrl 去尾斜杠", fc.normalizeFeedUrl("https://h/x/") === "https://h/x/");
ok("normalizeFeedUrl 补尾斜杠", fc.normalizeFeedUrl("https://h/x") === "https://h/x/");
ok("normalizeFeedUrl 空串", fc.normalizeFeedUrl("") === "");

// deriveGithubRepo
ok("deriveGithubRepo tag 页", JSON.stringify(fc.deriveGithubRepo("https://github.com/foo/bar/releases/tag/v1.2.3")) === JSON.stringify({ owner: "foo", repo: "bar" }));
ok("deriveGithubRepo 仓库页", fc.deriveGithubRepo("https://github.com/foo/bar").repo === "bar");
ok("deriveGithubRepo 非 github", fc.deriveGithubRepo("https://gitlab.com/a/b") === null);
ok("deriveGithubRepo 空", fc.deriveGithubRepo("") === null);

// isValidRepo
ok("isValidRepo 正常", fc.isValidRepo("foo/bar") === true);
ok("isValidRepo 单段非法", fc.isValidRepo("foo") === false);

// resolveUpdateProvider：feed 优先
let p = fc.resolveUpdateProvider({ feed: "https://h/x/", releaseUrl: "https://github.com/a/b/releases", versionJsonUrl: "https://github.com/c/d/releases" });
ok("feed 优先 -> generic", p && p.provider === "generic" && p.url === "https://h/x/");

// 显式 githubRepo
p = fc.resolveUpdateProvider({ githubRepo: "owner/repo" });
ok("githubRepo -> github", p && p.provider === "github" && p.owner === "owner" && p.repo === "repo" && /releases$/.test(p.downloadUrl));

// 从 releaseUrl 推导
p = fc.resolveUpdateProvider({ releaseUrl: "https://github.com/aaa/bbb/releases/tag/v1.0.0" });
ok("releaseUrl 推导 -> github", p && p.provider === "github" && p.owner === "aaa" && p.repo === "bbb");

// 从 versionJsonUrl 推导
p = fc.resolveUpdateProvider({ versionJsonUrl: "https://github.com/ccc/ddd/releases" });
ok("versionJsonUrl 推导 -> github", p && p.provider === "github" && p.owner === "ccc" && p.repo === "ddd");

// 无源
p = fc.resolveUpdateProvider({});
ok("无源 -> null", p === null);

// feed 覆盖 githubRepo
p = fc.resolveUpdateProvider({ feed: "https://h/x", githubRepo: "o/r" });
ok("feed 覆盖 githubRepo", p && p.provider === "generic");

// 非法 githubRepo 被忽略，回退推导
p = fc.resolveUpdateProvider({ githubRepo: "bad", releaseUrl: "https://github.com/e/f/releases" });
ok("非法 githubRepo 忽略并推导", p && p.provider === "github" && p.repo === "f");

// 仅 githubRepo 时 downloadUrl 形态
p = fc.resolveUpdateProvider({ githubRepo: "o/r" });
ok("downloadUrl 为 releases 页", p && p.downloadUrl === "https://github.com/o/r/releases");

const summary = `FEED-CONFIG TEST: ${pass} passed, ${fail} failed` + (fail ? ("; FAIL: " + fails.join(", ")) : "");
console.log(summary);
process.exit(fail ? 1 : 0);
