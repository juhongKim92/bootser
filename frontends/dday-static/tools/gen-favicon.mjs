/**
 * 파비콘 생성기 — favicon.svg / favicon.ico / icon-192.png / apple-touch-icon.png
 *
 * 원화는 `favicon-art.mjs` 의 16×16 픽셀맵 하나뿐이고, 여기서는 그것을 정수배로
 * 키워 네 파일을 만든다. 축에 정렬된 사각형뿐이라 래스터라이저 없이 픽셀을 직접
 * 찍고 PNG · ICO 를 손으로 인코딩한다 — 이 디렉터리의 무의존성 규칙을 지킨다.
 *
 *   node tools/gen-favicon.mjs
 *   node tools/gen-favicon.mjs --check   # 고치지 않고 최신인지만 본다
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { MAP, GRID, COLOR, TILE, validate } from './favicon-art.mjs';

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const CHECK = process.argv.includes('--check');

const problems = validate();
if (problems.length) {
  console.error('원화가 성립하지 않는다 — favicon-art.mjs 의 MAP 을 고칠 것');
  for (const p of problems) console.error('  · ' + p);
  process.exit(1);
}

// ---------------------------------------------------------------- SVG

/**
 * 같은 색 칸을 가로로 잇고, 똑같이 생긴 연속 행끼리 세로로 합쳐 rect 를 줄인다.
 * 칸마다 rect 를 찍으면 100개가 넘는데 이렇게 하면 20개 남짓이다.
 */
function runs(map) {
  const out = [];
  for (let y = 0; y < GRID; ) {
    let span = 1;
    while (y + span < GRID && map[y + span] === map[y]) span++;
    let x = 0;
    while (x < GRID) {
      const ch = map[y][x];
      let w = 1;
      while (x + w < GRID && map[y][x + w] === ch) w++;
      if (ch !== '.') out.push({ x, y, w, h: span, fill: COLOR[ch] });
      x += w;
    }
    y += span;
  }
  return out;
}

function svg() {
  const s = 48, k = s / GRID;
  const body = runs(MAP)
    .map((r) => `  <rect x="${r.x * k}" y="${r.y * k}" width="${r.w * k}" height="${r.h * k}" fill="${r.fill}"/>`)
    .join('\n');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${s} ${s}" width="${s}" height="${s}" shape-rendering="crispEdges">
  <!-- 오늘 뭐 쉬나 — 달력. 위쪽 고리 둘 · 꽉 찬 머리띠 · 빈칸으로 나뉜 날짜 격자 ·
       오렌지 한 칸(오늘), 이 넷이 달력으로 읽히게 한다.
       원화는 tools/favicon-art.mjs 의 16x16 픽셀맵이고 여기서 ${k}배로 키웠다.
       타일은 테마 무관 잉크 고정 — 종이색이면 밝은 탭 바에서 실루엣이 사라진다.
       tools/gen-favicon.mjs 가 생성한다. 직접 고치지 말 것. -->
  <rect width="${s}" height="${s}" fill="${TILE}"/>
${body}
</svg>
`;
}

// ---------------------------------------------------------------- PNG

const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

/** 픽셀맵을 size×size RGB 로 키운다. size 는 16의 배수여야 한다. */
function pixels(size) {
  if (size % GRID !== 0) throw new Error(`size must be a multiple of ${GRID}: ${size}`);
  const k = size / GRID;
  const buf = Buffer.alloc(size * size * 3);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const c = rgb(COLOR[MAP[(y / k) | 0][(x / k) | 0]]);
      const o = (y * size + x) * 3;
      buf[o] = c[0]; buf[o + 1] = c[1]; buf[o + 2] = c[2];
    }
  }
  return buf;
}

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(size) {
  const src = pixels(size);
  // 스캔라인마다 필터 바이트 0 (None). 단색 블록뿐이라 이게 가장 잘 압축된다.
  const stride = size * 3 + 1;
  const raw = Buffer.alloc(size * stride);
  for (let y = 0; y < size; y++) {
    raw[y * stride] = 0;
    src.copy(raw, y * stride + 1, y * size * 3, (y + 1) * size * 3);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 2;   // color type: truecolor RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------- ICO

/** PNG 를 그대로 품는 ICO. Vista 이후 형식이고 현행 브라우저는 전부 읽는다. */
function ico(sizes) {
  const images = sizes.map(png);
  const head = Buffer.alloc(6);
  head.writeUInt16LE(0, 0);            // reserved
  head.writeUInt16LE(1, 2);            // type: icon
  head.writeUInt16LE(sizes.length, 4); // count

  let offset = 6 + sizes.length * 16;
  const dir = sizes.map((s, i) => {
    const e = Buffer.alloc(16);
    e[0] = s === 256 ? 0 : s;          // width  (0 == 256)
    e[1] = s === 256 ? 0 : s;          // height
    e[2] = 0;                          // palette size
    e[3] = 0;                          // reserved
    e.writeUInt16LE(1, 4);             // color planes
    e.writeUInt16LE(32, 6);            // bits per pixel
    e.writeUInt32LE(images[i].length, 8);
    e.writeUInt32LE(offset, 12);
    offset += images[i].length;
    return e;
  });

  return Buffer.concat([head, ...dir, ...images]);
}

// ---------------------------------------------------------------- 출력

const out = [
  ['favicon.svg',           Buffer.from(svg(), 'utf8')],
  ['favicon.ico',           ico([16, 32, 48])],
  ['icon-192.png',          png(192)],
  ['apple-touch-icon.png',  png(192)],
];

let stale = 0;
for (const [name, data] of out) {
  const path = join(PUBLIC, name);
  const same = existsSync(path) && readFileSync(path).equals(data);
  if (CHECK) {
    if (!same) { stale++; console.error(`STALE ${name}`); }
    continue;
  }
  if (!same) writeFileSync(path, data);
  console.log(`${name.padEnd(22)} ${String(data.length).padStart(6)} bytes${same ? ' (변경 없음)' : ''}`);
}

if (CHECK) {
  if (stale) { console.error(`\n파비콘 ${stale}개가 원화와 다르다 — node tools/gen-favicon.mjs`); process.exit(1); }
  console.log('파비콘 최신');
}
