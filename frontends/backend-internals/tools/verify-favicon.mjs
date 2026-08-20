/**
 * 파비콘 검증 — 네 파일이 원화(favicon-art.mjs 의 MAP)와 같은 그림인지 본다.
 *
 * 확인하는 것:
 *   1. 원화 자체가 성립하는가 — 크기, 그리고 현미경으로 읽히는 네 요소
 *   2. PNG 두 개를 디코딩해 16 그리드 칸마다 기대한 색이 나오는가
 *   3. .ico 안의 16 · 32 · 48 세 장이 모두 같은 그림인가
 *   4. SVG 의 rect 들을 도로 래스터화하면 원화와 같아지는가
 *
 *   node tools/verify-favicon.mjs
 */
import { inflateSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { MAP, GRID, COLOR, TILE, validate } from './favicon-art.mjs';

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

const fails = [];
const check = (ok, msg) => { if (!ok) fails.push(msg); };

const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const want = (x, y) => rgb(COLOR[MAP[y][x]]);

// 1. 원화 자체
for (const p of validate()) fails.push(`원화: ${p}`);

/** 필터 0 짜리 RGB PNG 만 읽는다 — 생성기가 그것만 쓴다. */
function decodePng(buf, label) {
  const dead = { w: 0, h: 0, px: () => [-1, -1, -1] };
  if (buf.slice(0, 8).toString('hex') !== '89504e470d0a1a0a') {
    fails.push(`${label}: PNG 시그니처가 아니다`);
    return dead;
  }
  const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
  check(buf[24] === 8, `${label}: bit depth 가 8 이 아니다 (${buf[24]})`);
  check(buf[25] === 2, `${label}: color type 이 2(RGB) 가 아니다 (${buf[25]})`);

  const idat = [];
  let off = 8;
  while (off + 12 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.slice(off + 4, off + 8).toString('ascii');
    if (type === 'IDAT') idat.push(buf.slice(off + 8, off + 8 + len));
    off += 12 + len;
  }
  let raw;
  try {
    raw = inflateSync(Buffer.concat(idat));
  } catch (e) {
    fails.push(`${label}: IDAT 압축이 깨졌다 — ${e.message}`);
    return dead;
  }
  const stride = w * 3 + 1;
  if (raw.length !== h * stride) {
    fails.push(`${label}: 디코딩 크기가 안 맞는다 — ${raw.length} / 기대 ${h * stride}`);
    return dead;
  }
  for (let y = 0; y < h; y++) check(raw[y * stride] === 0, `${label}: ${y}행 필터가 0 이 아니다`);
  return { w, h, px: (x, y) => [raw[y * stride + 1 + x * 3], raw[y * stride + 2 + x * 3], raw[y * stride + 3 + x * 3]] };
}

/** 각 격자 칸의 네 모서리 안쪽 픽셀을 찍어 원화와 대조한다. */
function assertArt(img, label) {
  if (!img.w) return;
  check(img.w === img.h, `${label}: 정사각형이 아니다 (${img.w}x${img.h})`);
  check(img.w % GRID === 0, `${label}: 크기가 ${GRID}의 배수가 아니다 (${img.w})`);
  if (img.w % GRID !== 0) return;
  const k = img.w / GRID;
  let bad = 0, first = '';
  for (let gy = 0; gy < GRID; gy++) {
    for (let gx = 0; gx < GRID; gx++) {
      const w = want(gx, gy);
      for (const [dx, dy] of [[0, 0], [k - 1, 0], [0, k - 1], [k - 1, k - 1]]) {
        const got = img.px(gx * k + dx, gy * k + dy);
        if (got.join() !== w.join()) {
          if (!bad++) first = `(${gx},${gy}) 기대 ${w} / 실제 ${got}`;
        }
      }
    }
  }
  check(bad === 0, `${label}: 원화와 어긋난 지점 ${bad}곳 — 첫 곳 ${first}`);
}

// 2. PNG 두 개
for (const name of ['icon-192.png', 'apple-touch-icon.png']) {
  const img = decodePng(readFileSync(join(PUBLIC, name)), name);
  check(img.w === 192, `${name}: 192px 가 아니다 (${img.w})`);
  assertArt(img, name);
}

// 3. ICO — 16 · 32 · 48 세 장
{
  const b = readFileSync(join(PUBLIC, 'favicon.ico'));
  check(b.readUInt16LE(0) === 0 && b.readUInt16LE(2) === 1, 'favicon.ico: ICO 헤더가 아니다');
  const count = b.readUInt16LE(4);
  check(count === 3, `favicon.ico: 엔트리가 3개가 아니다 (${count})`);
  const seen = [];
  for (let i = 0; i < count; i++) {
    const e = 6 + i * 16;
    const w = b[e] || 256;
    const size = b.readUInt32LE(e + 8);
    const off = b.readUInt32LE(e + 12);
    if (off + size > b.length) { fails.push(`favicon.ico: ${w}px 페이로드가 파일 밖을 가리킨다`); continue; }
    const img = decodePng(b.slice(off, off + size), `favicon.ico@${w}`);
    check(img.w === w, `favicon.ico: 디렉터리는 ${w}px 인데 PNG 는 ${img.w}px`);
    assertArt(img, `favicon.ico@${w}`);
    seen.push(w);
  }
  check(seen.join() === '16,32,48', `favicon.ico: 크기 구성이 16,32,48 이 아니다 (${seen})`);
}

// 4. SVG — rect 들을 도로 래스터화해 원화와 대조한다
{
  const s = readFileSync(join(PUBLIC, 'favicon.svg'), 'utf8');
  check(/viewBox="0 0 48 48"/.test(s), 'favicon.svg: viewBox 가 0 0 48 48 이 아니다');
  check(/shape-rendering="crispEdges"/.test(s), 'favicon.svg: crispEdges 가 없다');
  check(!/prefers-color-scheme/.test(s),
    'favicon.svg: prefers-color-scheme 가 남아 있다 — 타일은 테마 무관 고정이어야 한다');

  const rects = [...s.matchAll(/<rect([^>]*)\/>/g)].map((m) => {
    const at = (k) => (m[1].match(new RegExp(`${k}="([^"]+)"`)) || [])[1];
    return {
      x: +(at('x') ?? 0), y: +(at('y') ?? 0),
      w: +at('width'), h: +at('height'), fill: (at('fill') || '').toLowerCase(),
    };
  });
  check(rects.length > 0, 'favicon.svg: rect 가 없다');

  // 48 그리드로 칠한 뒤 3배 다운샘플해 원화와 맞춰본다
  const canvas = Array.from({ length: 48 }, () => Array(48).fill(null));
  let offGrid = 0;
  for (const r of rects) {
    if ([r.x, r.y, r.w, r.h].some((v) => !Number.isInteger(v) || v % 3 !== 0)) offGrid++;
    for (let y = r.y; y < r.y + r.h; y++) {
      for (let x = r.x; x < r.x + r.w; x++) {
        if (canvas[y] && x < 48) canvas[y][x] = r.fill;
      }
    }
  }
  check(offGrid === 0, `favicon.svg: 3의 배수가 아닌 rect 가 ${offGrid}개 — 16px 에서 뭉갠다`);

  let bad = 0, first = '';
  for (let gy = 0; gy < GRID; gy++) {
    for (let gx = 0; gx < GRID; gx++) {
      const w = COLOR[MAP[gy][gx]].toLowerCase();
      for (let dy = 0; dy < 3; dy++) {
        for (let dx = 0; dx < 3; dx++) {
          const got = canvas[gy * 3 + dy][gx * 3 + dx];
          if (got !== w) { if (!bad++) first = `(${gx},${gy}) 기대 ${w} / 실제 ${got}`; }
        }
      }
    }
  }
  check(bad === 0, `favicon.svg: 원화와 어긋난 지점 ${bad}곳 — 첫 곳 ${first}`);

  const covered = canvas.flat().filter(Boolean).length;
  check(covered === 48 * 48, `favicon.svg: 안 칠해진 픽셀 ${48 * 48 - covered}개 — 배경 rect 가 빠졌나`);
  check(rects[0] && rects[0].w === 48 && rects[0].h === 48 && rects[0].fill === TILE,
    'favicon.svg: 첫 rect 가 48x48 잉크 타일이 아니다');
}

if (fails.length) {
  console.error('FAIL');
  for (const f of fails) console.error('  · ' + f);
  process.exit(1);
}
console.log('OK — favicon.svg / favicon.ico(16,32,48) / icon-192.png / apple-touch-icon.png 모두 원화와 같다');
