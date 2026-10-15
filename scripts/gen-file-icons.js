/* 生成 7 种文件类型 ICO（模块色圆角底 + 白色类型符号） — 用 sharp */
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const outDir = 'app/icons/file-assoc';
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

const TYPES = [
  { name: 'docx',  color: '#2B579A', label: 'W' },
  { name: 'xlsx',  color: '#217346', label: 'X' },
  { name: 'pptx',  color: '#D04423', label: 'P' },
  { name: 'pdf',   color: '#E53935', label: 'PDF' },
  { name: 'xmind', color: '#7C3AED', label: 'M' },
  { name: 'ofd',   color: '#5B6B7E', label: 'OFD' },
  { name: 'lvjx',  color: '#1E3A5F', label: 'LX' }
];

// 生成圆角矩形 SVG 底
function roundedRectSvg(size, radius, fillColor) {
  const r = radius;
  const w = size, h = size;
  const d = `M${r},0 L${w-r},0 Q${w},0 ${w},${r} L${w},${h-r} Q${w},${h} ${w-r},${h} L${r},${h} Q0,${h} 0,${h-r} L0,${r} Q0,0 ${r},0 Z`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><path d="${d}" fill="${fillColor}"/></svg>`;
}

// 白色文字 SVG（字号自适应）
function textSvg(size, label) {
  const fontSize = label.length === 1 ? 140 : (label.length === 2 ? 86 : 60);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
    <text x="50%" y="54%" font-family="Segoe UI Semibold, Segoe UI, Arial, sans-serif"
          font-size="${fontSize}" font-weight="bold" fill="white"
          text-anchor="middle" dominant-baseline="middle">${label}</text>
  </svg>`;
  return svg;
}

// PNG buffer → ICO buffer（单层 256x256）
function pngToIco(pngBuf) {
  const W = 256, H = 256;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);
  const dir = Buffer.alloc(16);
  dir.writeUInt8(0, 0); dir.writeUInt8(0, 1); dir.writeUInt8(0, 2); dir.writeUInt8(0, 3);
  dir.writeUInt16LE(1, 4); dir.writeUInt16LE(32, 6);
  dir.writeUInt32LE(pngBuf.length, 8); dir.writeUInt32LE(22, 12);
  return Buffer.concat([header, dir, pngBuf]);
}

async function main() {
  for (const t of TYPES) {
    console.log(`Generating ${t.name}.ico (${t.color} + "${t.label}") ...`);
    const size = 256;

    const pngBuf = await sharp({
      create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } }
    })
      .composite([
        { input: Buffer.from(roundedRectSvg(size, 40, t.color)), top: 0, left: 0 },
        { input: Buffer.from(textSvg(size, t.label)), top: 0, left: 0 }
      ])
      .png()
      .toBuffer();

    const icoBuf = pngToIco(pngBuf);
    fs.writeFileSync(path.join(outDir, `${t.name}.ico`), icoBuf);
    console.log(`  -> ${t.name}.ico (${icoBuf.length} bytes)`);
  }
  console.log(`\nDone! ${TYPES.length} icons with white labels`);
}

main().catch(e => console.error('FATAL:', e));
