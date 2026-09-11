const fs = require("fs");
const src = fs.readFileSync("d:/源码存档/绿角犀办公软件/app/js/modules/pdf-toolbox.js", "utf8");
const L = src.split("\n");
const groups = [];
let cur = null;
for (let i = 0; i < L.length; i++) {
  const m = L[i].match(/label:\s*"([^"]+)"\s*,\s*items/);
  if (m) { if (cur) cur.end = i; groups.push(cur); cur = { name: m[1], start: i }; }
}
if (cur) { cur.end = L.length; groups.push(cur); }
groups.forEach(g => {
  console.log(g.name + ": L" + (g.start+1) + "-L" + g.end + " (" + (g.end-g.start) + " lines)");
});
console.log("");
console.log("total groups:", groups.length);
