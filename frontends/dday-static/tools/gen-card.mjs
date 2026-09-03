/**
 * 공유 카드 생성기 — public/card/{home,sky,{cc}}.png (1200×630)
 *
 *   node tools/gen-card.mjs
 *   node tools/gen-card.mjs --check   # 고치지 않고 최신인지만 본다
 *
 * 카카오톡·슬랙·트위터에 링크를 던졌을 때 뜨는 그림이다. 없으면 빈 카드가 뜬다.
 *
 * **왜 public/og/ 가 아닌가.** gen-pages.mjs 의 청소가 `/^[a-z]{2}$/` 인 디렉터리를
 * 통째로 지우는데 'og' 가 정확히 두 글자다. 거기 두면 빌드마다 조용히 사라진다.
 * 'card' 는 네 글자라 걸리지 않는다. EXTRA 의 슬러그와도 부딪히면 안 되고,
 * 아래에서 실제로 확인한다.
 *
 * **카드는 자료를 나르지 않는다.** 공휴일 수나 연도를 그려 넣으면 매월 갱신
 * 워크플로가 204개 PNG 를 다시 쓰고, 바이너리가 git 이력에 영원히 쌓인다.
 * 카드가 바뀌는 때는 국가 목록이 바뀔 때뿐이어야 한다.
 *
 * 원화는 tools/card-art.mjs 의 5×7 글꼴과 tools/favicon-art.mjs 의 16×16 픽셀맵이고,
 * 여기서는 그것을 정수배로 키워 배치만 한다.
 */
import { writeFileSync, readFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { MAP, GRID, COLOR } from './favicon-art.mjs';
import { GLYPHS, FW, FH, TILE, MARK, ACCENT, CARD_W, CARD_H, CARD_DIR, normalize, validate } from './card-art.mjs';
import { encodePng, rgb } from './png.mjs';
import { PUB, DATA, EXTRA } from './config.mjs';
import { NAMES, NAME_ROOT } from './holiday-names.mjs';

const CHECK = process.argv.includes('--check');

const W = CARD_W;
const H = CARD_H;
const SLUG = CARD_DIR;
const DIR = join(PUB, SLUG);

/* 슬러그가 부딪히면 국가 페이지나 하늘 페이지를 덮는다.
   gen-pages 가 EXTRA 에 대해 하는 확인을 여기서도 한다. */
if (/^[a-z]{2}$/.test(SLUG) || EXTRA.includes(SLUG)) {
    console.error(`'${SLUG}' 가 국가 코드나 EXTRA 와 부딪힌다 — 다른 이름을 쓸 것`);
    process.exit(1);
}

const problems = validate();
if (problems.length) {
    console.error('원화가 성립하지 않는다 — card-art.mjs 의 GLYPHS 를 고칠 것');
    for (const p of problems) console.error('  · ' + p);
    process.exit(1);
}

/* ------------------------------------------------------------------ 도화지 */

function canvas(bg) {
    const buf = Buffer.alloc(W * H * 3);
    const c = rgb(bg);
    for (let i = 0; i < W * H; i++) {
        buf[i * 3] = c[0];
        buf[i * 3 + 1] = c[1];
        buf[i * 3 + 2] = c[2];
    }
    return buf;
}

function rect(buf, x0, y0, w, h, color) {
    const c = rgb(color);
    for (let y = Math.max(0, y0); y < Math.min(H, y0 + h); y++) {
        for (let x = Math.max(0, x0); x < Math.min(W, x0 + w); x++) {
            const o = (y * W + x) * 3;
            buf[o] = c[0];
            buf[o + 1] = c[1];
            buf[o + 2] = c[2];
        }
    }
}

/* 파비콘 픽셀맵을 배율만큼 키워 찍는다. 축에 정렬된 사각형뿐이라 보간이 없다. */
function mark(buf, x0, y0, scale) {
    for (let y = 0; y < GRID; y++) {
        for (let x = 0; x < GRID; x++) {
            const ch = MAP[y][x];
            if (ch === '.') continue;               /* 타일색은 카드 배경과 같다 */
            rect(buf, x0 + x * scale, y0 + y * scale, scale, scale, COLOR[ch]);
        }
    }
}

/* ------------------------------------------------------------------ 글자 */

/** n 글자를 배율 s 로 찍었을 때의 폭. 글자 사이 1칸이 들어간다. */
const textW = (n, s) => (n <= 0 ? 0 : s * ((FW + 1) * n - 1));
const lineH = (s) => FH * s;

function text(buf, str, x0, y0, scale, color) {
    let x = x0;
    for (const ch of str) {
        const g = GLYPHS[ch];
        if (!g) throw new Error(`글꼴에 없는 문자: '${ch}' (${JSON.stringify(str)})`);
        for (let y = 0; y < FH; y++) {
            for (let i = 0; i < FW; i++) {
                if (g[y][i] === '#') rect(buf, x + i * scale, y0 + y * scale, scale, scale, color);
            }
        }
        x += (FW + 1) * scale;
    }
}

/** 공백에서만 접는다. 한 낱말이 한 줄보다 길면 그 줄은 넘치고, fit() 이 그것을 본다. */
function wrap(str, maxChars) {
    const out = [];
    let line = '';
    for (const word of str.split(' ')) {
        const next = line ? `${line} ${word}` : word;
        if (next.length <= maxChars || !line) { line = next; continue; }
        out.push(line);
        line = word;
    }
    if (line) out.push(line);
    return out;
}

/**
 * 상자 안에 들어가는 가장 큰 배율을 고른다.
 * 이름이 11자("SOUTH KOREA")에서 44자("SAINT HELENA, ASCENSION AND TRISTAN DA
 * CUNHA")까지 벌어져서, 배율을 고정하면 짧은 쪽이 초라하거나 긴 쪽이 넘친다.
 * 카드마다 조금씩 다른 편이 넘치는 것보다 낫다.
 */
function fit(str, boxW, boxH, maxScale, maxLines) {
    for (let s = maxScale; s >= 2; s--) {
        const maxChars = Math.floor((boxW / s + 1) / (FW + 1));
        if (maxChars < 1) continue;
        const lines = wrap(str, maxChars);
        if (lines.length > maxLines) continue;
        if (lines.some((l) => textW(l.length, s) > boxW)) continue;   /* 낱말 하나가 길다 */
        const gap = 2 * s;
        if (lines.length * lineH(s) + (lines.length - 1) * gap > boxH) continue;
        return { scale: s, lines, gap };
    }
    return null;
}

/* ------------------------------------------------------------------ 배치 */

const PAD = 72;
const WORDMARK = 'THIS IS THE DAY';

/* 세로 배치. 아래를 바꾸면 카드가 위나 아래로 쏠리므로 한 곳에 모아 둔다.
   윗단(표시 + 오른쪽 칸)은 108..344, 괘선은 380, 이름 상자는 412..592 다.
   위 여백 108 · 아래 여백 38 — 소셜 미리보기가 위아래를 조금씩 잘라도 살아남는다. */
const TOP = 108;
const MARK_SCALE = 13;              /* 16×13 = 208 */
const CODE_SCALE_MAX = 24;          /* 7×24 = 168 */
const WORD_SCALE = 6;               /* 7×6  = 42  */
const COL_GAP = 26;                 /* 워드마크와 코드 사이 */
const RULE_Y = 380;
const NAME_TOP = 412;
const NAME_BOX_H = 180;

/** 국가·하늘 카드 — 달력 표시 · 워드마크 · 큰 코드 · 오렌지 괘선 · 영어 이름 */
function card({ code, name }) {
    const buf = canvas(TILE);

    const markPx = GRID * MARK_SCALE;                         /* 208 */
    const colX = PAD + markPx + 48;                           /* 328 */

    /* 코드는 두 글자(국가)거나 세 글자(SKY)다. 남은 폭에 맞추되 24배를 넘기지
       않는다 — 넘기면 두 글자 카드에서 코드가 괘선을 넘본다. */
    const codeScale = Math.min(CODE_SCALE_MAX,
        Math.floor((W - PAD - colX) / ((FW + 1) * code.length - 1)));

    /* 오른쪽 칸이 표시보다 크다. 표시를 칸 한가운데에 맞춰야 둘이 한 덩어리로 보인다. */
    const colH = lineH(WORD_SCALE) + COL_GAP + lineH(codeScale);
    mark(buf, PAD, TOP + ((colH - markPx) >> 1), MARK_SCALE);

    text(buf, WORDMARK, colX, TOP, WORD_SCALE, MARK);
    text(buf, code, colX, TOP + lineH(WORD_SCALE) + COL_GAP, codeScale, ACCENT);

    rect(buf, PAD, RULE_Y, W - PAD * 2, 6, ACCENT);

    const box = fit(name, W - PAD * 2, NAME_BOX_H, 14, 3);
    if (!box) throw new Error(`이름이 상자에 안 들어간다: ${name}`);
    box.lines.forEach((line, i) => {
        text(buf, line, PAD, NAME_TOP + i * (lineH(box.scale) + box.gap), box.scale, MARK);
    });

    return encodePng(W, H, buf);
}

/** 첫 화면 카드. 코드도 이름도 없으므로 표시와 워드마크를 크게 쓴다. */
function homeCard() {
    const buf = canvas(TILE);
    const s = 13;
    const x = PAD + 320 + 56;                                 /* 448 */
    const step = lineH(s) + 2 * s;

    mark(buf, PAD, 155, 20);                                  /* 320×320 */
    text(buf, 'THIS IS', x, 211, s, MARK);
    text(buf, 'THE DAY', x, 211 + step, s, ACCENT);
    rect(buf, x, 211 + step + lineH(s) + 24, textW(7, s), 6, ACCENT);

    return encodePng(W, H, buf);
}

/* ------------------------------------------------------------------ 출력 */

const countries = JSON.parse(readFileSync(join(DATA, 'countries.json'), 'utf8'));

/* 하늘은 허브 하나와 갈래 넷이다. 이름은 gen-pages 의 SKY_TOPICS 와 짝이지만
   여기서 따로 적는다 — 거기서 가져오면 그 파일이 카드를 다시 그리게 만든다
   (gen-pages 는 생성기라 import 하는 순간 412개 HTML 이 다시 쓰인다).
   짝이 어긋나면 check-pages 가 "페이지가 가리키는데 파일이 없다" 로 문다. */
const SKY_CARDS = [
    ['sky',        'SKY',    'SOLAR TERMS, MOONS, METEORS AND LUNAR MONTHS'],
    ['sky-term',   'TERM',   'THE 24 SOLAR TERMS'],
    ['sky-moon',   'MOON',   'NEW AND FULL MOONS'],
    ['sky-meteor', 'METEOR', 'METEOR SHOWER PEAKS'],
    ['sky-lunar',  'LUNAR',  'THE LUNISOLAR CALENDAR'],
];

/* 국가 축도 하늘도 아닌 축 둘. /holiday/ 아래의 낱장은 아래에서 원화(NAMES)로 만든다. */
const AXIS_CARDS = [
    [NAME_ROOT,    'HOLIDAY', 'HOLIDAYS BY NAME'],
    ['rank',       'RANK',    'COUNTRIES COMPARED'],
];

/* 이름 축의 낱장. **원화(tools/holiday-names.mjs)만 본다** — 어느 이름이 문턱을
   넘는지는 자료가 정하는데, 그 판단을 여기서 되풀이하면 gen-pages 와 갈라진다.
   원화에는 있는데 페이지가 없어지면 카드가 유령으로 남고, 그건 check-pages 의
   "어느 페이지도 가리키지 않는다" 가 문다 — 그때 원화에서 빼면 된다. */
const NAME_CARDS = Object.values(NAMES)
    .map((e) => [`${NAME_ROOT}-${e.slug}`, 'HOLIDAY', normalize(e.en)]);

const out = [
    ['home.png', homeCard()],
    ...[...SKY_CARDS, ...AXIS_CARDS, ...NAME_CARDS]
        .map(([file, code, name]) => [`${file}.png`, card({ code, name })]),
    ...countries.map((c) => [
        `${c.code.toLowerCase()}.png`,
        card({ code: c.code, name: normalize(c.name) }),
    ]),
];

if (!CHECK) mkdirSync(DIR, { recursive: true });

const want = new Set(out.map(([n]) => n));
let stale = 0, wrote = 0, bytes = 0;

for (const [name, data] of out) {
    const path = join(DIR, name);
    const same = existsSync(path) && readFileSync(path).equals(data);
    bytes += data.length;
    if (CHECK) {
        if (!same) { stale++; console.error(`STALE  card/${name}`); }
        continue;
    }
    if (!same) { writeFileSync(path, data); wrote++; }
}

/* 국가가 Nager 에서 빠지면 카드가 유령으로 남는다. 페이지 쪽 청소와 짝을 맞춘다. */
const orphan = existsSync(DIR)
    ? readdirSync(DIR).filter((f) => f.endsWith('.png') && !want.has(f))
    : [];

if (CHECK) {
    for (const f of orphan) { stale++; console.error(`ORPHAN card/${f} — 페이지가 없는 카드`); }
    if (stale) {
        console.error(`\n카드 ${stale}개가 원화·목록과 다르다 — node tools/gen-card.mjs`);
        process.exit(1);
    }
    console.log(`카드 최신 — ${out.length}개`);
} else {
    for (const f of orphan) unlinkSync(join(DIR, f));
    console.log(`카드 ${out.length}개 (${W}×${H}) — 새로 쓴 것 ${wrote}개${orphan.length ? ` · 지운 것 ${orphan.length}개` : ''}`);
    console.log(`합계 ${(bytes / 1024).toFixed(0)} KB · 평균 ${(bytes / out.length / 1024).toFixed(1)} KB · 가장 큰 것 ${(Math.max(...out.map(([, d]) => d.length)) / 1024).toFixed(1)} KB`);
}
