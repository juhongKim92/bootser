/* 웹폰트의 순수 부분 — 어디서 받아 오는가, 무엇을 남기는가, 이름을 어떻게 짓는가.
   `gen-fonts.mjs` 가 이걸로 받아서 쓰고, `check-pages.mjs` 가 이걸로 커밋된 것을 본다.
   png.mjs 를 파비콘과 카드가 함께 쓰는 것과 같은 자리다 — 기계적인 부분만 나누고
   "맞는가" 를 따지는 말은 양쪽이 따로 적는다. */
import { readdirSync, readFileSync } from 'node:fs';
import { join, extname } from 'node:path';
import { createHash } from 'node:crypto';

/* 남의 오리진 셋을 우리 것 하나로 바꾼다.
   ---------------------------------------------------------------------------
   글꼴마다 무게를 upstream 주소에서 이미 좁혀 둔다. 받아 놓고 코드로 거르면
   "왜 이 무게인가" 가 주소와 코드 두 군데로 갈라진다.

   · Gowun Batang — `--serif`. base.css 의 serif 규칙은 h1 · h2 · .verdict 셋뿐이고
     전부 font-weight:700 이다. 400 을 받아 두면 95개 조각이 통째로 놀고 있다.
   · JetBrains Mono — `--mono`. 가변 글꼴이라 400 과 500 이 같은 파일을 가리킨다.
     `wght@400..500` 로 물으면 파일 여섯 벌에 `font-weight: 400 500` 한 줄로 온다.
   · Pretendard — `--sans`. jsdelivr 이 주는 CSS 는 9무게 × 92조각 = 828면 한 벌뿐이라
     주소로 좁힐 수가 없다. 여기서만 `weights` 로 거른다.

     가변본(92면이 9무게를 다 덮는다)을 먼저 붙여 봤다가 물렸다 — 조각 하나가
     25.4 KB 로 정적본 10.5 KB 의 2.4배다. 무게 축을 통째로 이고 다니기 때문이다.
     저장소에서도 634 KB 대 539 KB 로 지고, 방문자가 받는 양은 더 크게 진다.
     base.css 가 sans 에 쓰는 무게는 400 과 500 둘뿐이다(700 은 serif 쪽이다). */
export const SOURCES = [
    {
        slug: 'gowun-batang',
        family: 'Gowun Batang',
        css: 'https://fonts.googleapis.com/css2?family=Gowun+Batang:wght@700&display=swap',
        license: 'https://raw.githubusercontent.com/google/fonts/main/ofl/gowunbatang/OFL.txt',
    },
    {
        slug: 'jetbrains-mono',
        family: 'JetBrains Mono',
        css: 'https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400..500&display=swap',
        license: 'https://raw.githubusercontent.com/google/fonts/main/ofl/jetbrainsmono/OFL.txt',
    },
    {
        slug: 'pretendard',
        family: 'Pretendard',
        css: 'https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard-dynamic-subset.css',
        license: 'https://raw.githubusercontent.com/orioncactus/pretendard/v1.3.9/LICENSE',
        weights: ['400', '500'],
    },
];

export const FONT_DIR = 'fonts';
export const FONT_CSS = 'fonts.css';
export const LICENSE_FILE = 'LICENSE.txt';

/* css2 는 물어보는 쪽을 보고 형식을 고른다. 옛 UA 로 물으면 woff2 대신 ttf 를 준다. */
export const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
    + '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/* ------------------------------------------------------------------ 글자 모으기

   조각(subset)은 unicode-range 로 갈려 있어서, 이 사이트가 실제로 쓰는 글자에
   걸리지 않는 조각은 아무도 내려받지 않는다. 그런 조각까지 커밋하면 저장소만
   무거워진다 — 그래서 public/ 을 통째로 훑어 쓰는 글자를 모으고, 걸리는 조각만 남긴다.

   HTML 뿐 아니라 JSON 과 JS 도 본다. 표의 절반은 브라우저가 data/{CC}.json 으로
   그리고, dday.js 안에도 한국어 문자열이 박혀 있다. HTML 만 보면 그만큼이 샌다. */
const TEXT_EXT = new Set(['.html', '.json', '.js', '.css']);

/** public/ 아래(폰트 디렉터리는 빼고)에 등장하는 모든 코드포인트. */
export function codepoints(pub) {
    const cps = new Set();
    const walk = (dir) => {
        for (const e of readdirSync(dir, { withFileTypes: true })) {
            if (e.isDirectory()) {
                if (dir === pub && e.name === FONT_DIR) continue;   /* 제 이름은 안 센다 */
                walk(join(dir, e.name));
            } else if (TEXT_EXT.has(extname(e.name))) {
                const s = readFileSync(join(dir, e.name), 'utf8');
                for (const ch of s) cps.add(ch.codePointAt(0));
                /* &#x...; 로 적힌 글자도 결국 화면에는 그 글자로 나온다. */
                for (const m of s.matchAll(/&#(x[0-9a-fA-F]+|\d+);/g)) {
                    const n = m[1][0] === 'x' ? parseInt(m[1].slice(1), 16) : Number(m[1]);
                    if (Number.isFinite(n)) cps.add(n);
                }
            }
        }
    };
    walk(pub);
    return cps;
}

/* ------------------------------------------------------------------ CSS 읽기 */

/** "U+ac00-d7a3, U+f900" → [[0xac00,0xd7a3],[0xf900,0xf900]] */
export function parseRanges(text) {
    const out = [];
    for (const part of text.split(',')) {
        const m = /^\s*U\+([0-9a-fA-F]+)(?:-([0-9a-fA-F]+))?\s*$/.exec(part);
        if (!m) throw new Error(`unicode-range 를 못 읽었다: ${part.trim()}`);
        const a = parseInt(m[1], 16);
        out.push([a, m[2] ? parseInt(m[2], 16) : a]);
    }
    return out;
}

/** @font-face 블록을 순서대로 뽑는다. 조각 번호는 등장 순서다. */
export function parseFaces(css) {
    const out = [];
    for (const m of css.matchAll(/@font-face\s*\{([^}]*)\}/g)) {
        const b = m[1];
        const pick = (re) => (re.exec(b) || [])[1];
        const family = pick(/font-family:\s*'([^']+)'/);
        const src = /url\(([^)]+)\)\s*format\('([^']+)'\)/.exec(b);
        const range = pick(/unicode-range:\s*([^;}]+)/);
        if (!family || !src || !range) continue;
        out.push({
            index: out.length,
            family,
            style: pick(/font-style:\s*([^;}]+)/)?.trim() || 'normal',
            weight: pick(/font-weight:\s*([^;}]+)/)?.trim() || '400',
            url: src[1].trim(),
            format: src[2],
            range: range.trim().replace(/\s+/g, ' '),
            ranges: parseRanges(range),
        });
    }
    return out;
}

/** 이 조각이 사이트가 쓰는 글자에 하나라도 걸리나. */
export function used(ranges, cps) {
    for (const [a, b] of ranges) {
        if (b - a > cps.size) { for (const c of cps) if (c >= a && c <= b) return true; }
        else { for (let c = a; c <= b; c++) if (cps.has(c)) return true; }
    }
    return false;
}

/* ------------------------------------------------------------------ 이름

   파일 이름에 내용 해시를 박는다. 그래야 `_headers` 의 immutable 이 참말이 된다 —
   upstream 판이 올라가 같은 조각의 내용이 달라져도 이름이 같이 달라진다.
   덤으로 check-pages 가 네트워크 없이 무결성을 본다: 이름의 해시와 파일의 해시가
   어긋나면 받다가 잘렸거나 손으로 건드린 것이다. */
export const hash8 = (buf) => createHash('sha256').update(buf).digest('hex').slice(0, 8);
export const fontName = (slug, index, buf) => `${slug}.${index}.${hash8(buf)}.woff2`;

/** 'pretendard-variable.5.9a3f1c22.woff2' → { slug, index, hash } */
export function parseName(name) {
    const m = /^([a-z-]+)\.(\d+)\.([0-9a-f]{8})\.woff2$/.exec(name);
    return m ? { slug: m[1], index: Number(m[2]), hash: m[3] } : null;
}
