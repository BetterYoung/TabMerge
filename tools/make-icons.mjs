/**
 * TabMerge 图标构建工具（零依赖 Node 脚本）。
 *
 * 1) 扫描 extension/lib/tabler/*.svg，生成 extension/core/icons.js（内联图标模块）
 * 2) 用无头 Chrome 把 extension/lib/tabler/stack-2-filled.svg 渲染成
 *    extension/icons/icon{16,32,48,128}.png（透明背景、精确像素尺寸）
 *
 * 用法：node tools/make-icons.mjs
 * 可选环境变量 CHROME_PATH 指定 Chrome 可执行文件。
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, readdirSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync, deflateSync } from 'node:zlib';

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, '..');
const extensionDir = join(projectRoot, 'extension');
const tablerDir = join(extensionDir, 'lib', 'tabler');
const iconsOutDir = join(extensionDir, 'icons');
const tmpDir = join(projectRoot, '.tmp-icons');
const ICON_SIZES = [16, 32, 48, 128];

/** 无头 Chrome 窗口装饰高度：截图比视口多出的行数，需要裁掉。 */
const HEADLESS_CHROME_OFFSET = 96;

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean);

function findChrome() {
  for (const candidate of CHROME_CANDIDATES) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error('未找到 Chrome/Edge，可通过环境变量 CHROME_PATH 指定路径');
}

/* ---------------------------------------------------------------- PNG 工具 */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([length, typeAndData, crc]);
}

function paethPredictor(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function unfilter(raw, width, height, bytesPerPixel) {
  const stride = width * bytesPerPixel;
  const out = Buffer.alloc(stride * height);
  let pos = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[pos];
    pos += 1;
    const rowStart = y * stride;
    const prevStart = (y - 1) * stride;
    for (let x = 0; x < stride; x += 1) {
      const value = raw[pos + x];
      const left = x >= bytesPerPixel ? out[rowStart + x - bytesPerPixel] : 0;
      const up = y > 0 ? out[prevStart + x] : 0;
      const upLeft = y > 0 && x >= bytesPerPixel ? out[prevStart + x - bytesPerPixel] : 0;
      let restored;
      switch (filter) {
        case 0: restored = value; break;
        case 1: restored = value + left; break;
        case 2: restored = value + up; break;
        case 3: restored = value + ((left + up) >> 1); break;
        case 4: restored = value + paethPredictor(left, up, upLeft); break;
        default: throw new Error(`未知的 PNG 行过滤器：${filter}`);
      }
      out[rowStart + x] = restored & 0xff;
    }
    pos += stride;
  }
  return out;
}

/**
 * 裁掉 PNG 底部多余的行（无头 Chrome 窗口装饰），输出精确尺寸的 PNG。
 * @param {Buffer} buffer
 * @param {number} targetWidth
 * @param {number} targetHeight
 */
export function cropPng(buffer, targetWidth, targetHeight) {
  if (buffer.readUInt32BE(0) !== 0x89504e47) throw new Error('不是合法的 PNG 文件');
  let offset = 8;
  let ihdr = null;
  const idat = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      ihdr = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        bitDepth: data[8],
        colorType: data[9],
        interlace: data[12],
      };
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    offset += 12 + length;
  }
  if (!ihdr) throw new Error('PNG 缺少 IHDR');
  if (ihdr.bitDepth !== 8 || ihdr.colorType !== 6 || ihdr.interlace !== 0) {
    throw new Error(`暂不支持的 PNG 格式：depth=${ihdr.bitDepth} colorType=${ihdr.colorType} interlace=${ihdr.interlace}`);
  }

  const bytesPerPixel = 4;
  const inflated = inflateSync(Buffer.concat(idat));
  const pixels = unfilter(inflated, ihdr.width, ihdr.height, bytesPerPixel);

  const stride = ihdr.width * bytesPerPixel;
  const croppedStride = targetWidth * bytesPerPixel;
  const raw = Buffer.alloc((croppedStride + 1) * targetHeight);
  for (let y = 0; y < targetHeight; y += 1) {
    raw[y * (croppedStride + 1)] = 0; // 过滤器 None
    pixels.copy(
      raw,
      y * (croppedStride + 1) + 1,
      y * stride,
      y * stride + croppedStride,
    );
  }

  const newIhdr = Buffer.alloc(13);
  newIhdr.writeUInt32BE(targetWidth, 0);
  newIhdr.writeUInt32BE(targetHeight, 4);
  newIhdr[8] = 8;
  newIhdr[9] = 6;
  newIhdr[10] = 0;
  newIhdr[11] = 0;
  newIhdr[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', newIhdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* --------------------------------------------------------- 图标模块生成 */

/** 提取 SVG 内部标记（去掉 <svg> 外壳），保留官方 path 定义。 */
function extractSvgBody(svg) {
  const openTagEnd = svg.indexOf('>', svg.indexOf('<svg'));
  const closeTagStart = svg.lastIndexOf('</svg>');
  return svg.slice(openTagEnd + 1, closeTagStart).trim();
}

function generateIconModule() {
  const files = readdirSync(tablerDir).filter((name) => name.endsWith('.svg')).sort();
  const entries = [];
  for (const file of files) {
    const key = file.replace(/\.svg$/, '').replace(/-outline$/, '').replace(/-filled$/, '-filled');
    const body = extractSvgBody(readFileSync(join(tablerDir, file), 'utf8'));
    entries.push([key, body]);
  }

  const lines = entries.map(([key, body]) => `  ${JSON.stringify(key)}: ${JSON.stringify(body)},`);
  const module = `/**
 * Tabler Icons 内联模块 —— 由 tools/make-icons.mjs 依据 extension/lib/tabler/*.svg 生成。
 * 请勿手工编辑；改动图标请更新 lib/tabler 下的官方文件后重新运行该脚本。
 * 以传统脚本形式输出，页面可在 <head> 中同步引入，避免图标缺失导致的布局抖动。
 */

(function (global) {
  'use strict';

  var ICONS = {
${lines.join('\n')}
  };

  /**
   * 生成一个内联 SVG 图标。
   * @param {string} name 图标名，如 'chevron-down'
   * @param {{size?: number, className?: string}} [options]
   * @returns {string}
   */
  function icon(name, options) {
    var body = ICONS[name];
    if (!body) throw new Error('未知图标：' + name);
    var size = (options && options.size) || 18;
    var className = (options && options.className) || '';
    return [
      '<svg class="icon ' + className + '" width="' + size + '" height="' + size + '" viewBox="0 0 24 24"',
      '  fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"',
      '  stroke-linejoin="round" aria-hidden="true" focusable="false">',
      body,
      '</svg>',
    ].join('');
  }

  global.TabMergeIcons = {
    ICON_SOURCE: 'Tabler Icons (MIT) - https://tabler.io/icons',
    ICONS: ICONS,
    icon: icon,
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
`;
  writeFileSync(join(extensionDir, 'core', 'icons.js'), module, 'utf8');
  console.log(`已生成 core/icons.js（${entries.length} 个图标）`);
}

/* --------------------------------------------------------------- PNG 渲染 */

function renderIconPng(chromePath, size) {
  const svg = readFileSync(join(tablerDir, 'stack-2-filled.svg'), 'utf8');
  // 小尺寸下用更方的底与更大的图形，保证 16px 仍可辨认
  const small = size <= 16;
  const radius = Math.round(size * (small ? 0.16 : 0.22));
  const glyph = Math.round(size * (small ? 0.68 : 0.58));
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;padding:0;background:transparent}
.wrap{width:${size}px;height:${size}px;border-radius:${radius}px;background:#14624A;color:#FFFFFF;
  display:flex;align-items:center;justify-content:center}
.wrap svg{width:${glyph}px;height:${glyph}px}
</style></head><body><div class="wrap">${svg}</div></body></html>`;

  const htmlPath = join(tmpDir, `icon${size}.html`);
  const shotPath = join(tmpDir, `shot${size}.png`);
  writeFileSync(htmlPath, html, 'utf8');

  execFileSync(chromePath, [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    '--default-background-color=00000000',
    `--user-data-dir=${join(tmpDir, 'profile')}`,
    `--window-size=${size},${size + HEADLESS_CHROME_OFFSET}`,
    `--screenshot=${shotPath}`,
    `file:///${htmlPath.replace(/\\/g, '/')}`,
  ], { stdio: 'ignore' });

  const raw = readFileSync(shotPath);
  const cropped = cropPng(raw, size, size);
  writeFileSync(join(iconsOutDir, `icon${size}.png`), cropped);
  console.log(`已生成 icons/icon${size}.png（${cropped.length} 字节）`);
}

function main() {
  mkdirSync(iconsOutDir, { recursive: true });
  mkdirSync(tmpDir, { recursive: true });
  try {
    generateIconModule();
    const chromePath = findChrome();
    for (const size of ICON_SIZES) {
      renderIconPng(chromePath, size);
    }
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

main();