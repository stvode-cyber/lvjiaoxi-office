const fs = require('fs');
const c = fs.readFileSync('app/js/modules/presentation.js','utf8');

// 找 W/H 定义 + canvas/area 变量
let idx = 0;
while ((idx = c.indexOf('const W = ', idx)) !== -1) {
  console.log('W at', idx, ':', c.slice(idx, idx+80));
  idx++;
}
idx = 0;
while ((idx = c.indexOf('let canvas ', idx)) !== -1 || (idx = c.indexOf('const canvas ', idx)) !== -1) {
  console.log('canvas var at', idx, ':', c.slice(idx, idx+150).replace(/\n/g,' '));
  idx++;
}

// 找 wrap.appendChild(host) 位置（mount 里面 wrap 添加后）
idx = c.indexOf('host.appendChild(wrap');
if (idx < 0) idx = c.indexOf('host.appendChild(wrap,');
console.log('host.appendChild at', idx);
console.log(c.slice(Math.max(0,idx-100), idx+500));
