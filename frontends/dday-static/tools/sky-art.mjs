/* ============================================================
   하늘 아이콘 원화 — 절기·삭·보름·유성우
   ------------------------------------------------------------
   `gen-sky-icons.mjs` 가 그려서 public/sky-icons/ 에 두고, `gen-pages.mjs` 가
   표에 건다. 국기와 같은 자리(우리 오리진의 SVG · <img> · lazy)지만 **받아 온
   것이 아니라 여기서 그린 것**이라 고지가 없고 판을 박을 것도 없다.

   ------------------------------------------------------------ 왜 다 다른가

   72줄짜리 표에 똑같은 그림을 72번 찍으면 그건 장식이지 정보가 아니다. 그래서
   그림을 **자료에서 뽑는다** —

     · 절기    태양의 황경이 곧 k(=황경/15)다. 원 위 그 각도에 해를 찍는다.
               표를 내려가면 해가 원을 한 바퀴 돈다. 분점·지점 넷은 정확히
               동서남북에 선다(k=0·6·12·18 — astro.mjs 의 CARDINAL 과 같은 자리다).
     · 삭·보름 빈 원과 찬 원. 달이 안 보이는 날과 다 보이는 날 그대로다.
     · 유성우  세기(ZHR)만큼 줄기를 긋는다. 1개 · 2개 · 3개.

   음력은 넣지 않았다. 초하루가 곧 삭이라 삭 그림을 그대로 쓸 수 있지만, 그러면
   같은 그림이 두 갈래에서 다른 뜻으로 읽힌다 — 저쪽 표의 한 행은 순간이 아니라 달이다.

   ------------------------------------------------------------ 왜 색이 하나인가

   `<img>` 로 싣기 때문에 바깥 CSS 가 닿지 않는다. `currentColor` 도, base.css 의
   토큰도 그림 안으로 들어오지 못한다. SVG 안에 `prefers-color-scheme` 를 적는
   길이 있지만 `<img>` 안에서의 동작이 브라우저마다 갈렸던 자리라, **두 테마에서
   모두 읽히는 중간 잉크 하나**로 끝낸다 — base.css 의 밝은 쪽 `--ink-3` 값이다.
   흰 종이(#fcfdfe)에서 3.6:1, 어두운 종이(#0d1117)에서 5.1:1 이라 그림에 필요한
   3:1 을 양쪽에서 넘는다. 색을 늘리지 않는 것은 팔레트 규칙이기도 하다 —
   이 사이트의 따뜻한 색은 `--today` 하나뿐이다.
   ============================================================ */
import { join } from 'node:path';
import { PUB } from './config.mjs';

/* 두 글자면 안 된다 — gen-pages 의 청소가 `/^[a-z]{2}$/` 인 디렉터리를 지운다.
   'sky' 여도 안 된다: 그쪽은 EXTRA 라 빌드마다 통째로 지워지고 다시 만들어진다. */
export const ICON_DIR = 'sky-icons';
export const ICON_PATH = join(PUB, ICON_DIR);

/* 화면에 놓이는 크기. viewBox 와 같은 수라 1:1 로 그려진다 — 픽셀 격자에 맞으므로
   16px 에서 선이 흐려지지 않는다. gen-pages · dday.js 가 속성으로 함께 찍고
   dday.css 가 같은 값을 쓴다. */
export const ICON_W = 16;
export const ICON_H = 16;

/* base.css 의 밝은 쪽 --ink-3. 위 머리말 참고 — 두 테마 모두에서 읽히라고 고른 값이다. */
export const INK = '#78849a';

const C = ICON_W / 2;                 /* 한가운데 */
const r2 = (n) => +n.toFixed(2);

/* ---------------------------------------------------------------- 절기
   원은 황도, 점은 해다. ORBIT 은 궤도 반지름이고 SUN 은 해의 반지름이라
   ORBIT + SUN 이 상자 반지름(8)을 넘으면 해가 잘린다. */
const ORBIT = 5.2;
const SUN = 2.3;

/** k(=황경/15) 자리의 해가 놓이는 점. 0=춘분은 오른쪽, 6=하지는 위. */
export function sunAt(k) {
    const rad = (k * 15 * Math.PI) / 180;
    /* SVG 는 y 가 아래로 자라므로 빼야 반시계(황경이 느는 방향)로 돈다 */
    return { x: r2(C + ORBIT * Math.cos(rad)), y: r2(C - ORBIT * Math.sin(rad)) };
}

const svg = (body) =>
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${ICON_W} ${ICON_H}"`
    + ` width="${ICON_W}" height="${ICON_H}">${body}</svg>\n`;

const termIcon = (k) => {
    const s = sunAt(k);
    return svg(
        `<circle cx="${C}" cy="${C}" r="${ORBIT}" fill="none" stroke="${INK}"`
        + ` stroke-width="1" opacity=".38"/>`
        + `<circle cx="${s.x}" cy="${s.y}" r="${SUN}" fill="${INK}"/>`
    );
};

/* ---------------------------------------------------------------- 삭·보름
   테두리를 절기의 황도보다 굵고 진하게 둔다. 첫 화면에서는 넷이 나란히 서므로
   (다음 절기 · 삭 · 보름 · 유성우) 빈 원 둘이 같아 보이면 안 된다. */
const MOON = 5.6;

const moonIcon = (full) => svg(full
    ? `<circle cx="${C}" cy="${C}" r="${MOON}" fill="${INK}"/>`
    : `<circle cx="${C}" cy="${C}" r="${MOON}" fill="none" stroke="${INK}" stroke-width="1.4"/>`);

/* ---------------------------------------------------------------- 유성우
   줄기는 오른쪽 위에서 왼쪽 아래로 흐르고 머리가 앞선다. 셋을 한 상자에 넣으면
   빽빽하므로 뒤 둘은 짧고 옅다 — 개수가 곧 세기라 굵기까지 같을 필요가 없다.

   ⚠ 셋이 모두 기울기 -1 이라 **한 줄에 겹쳐 놓기 쉽다.** 처음 앉힌 자리가 그랬다:
   둘째 줄기가 첫째와 같은 선(x+y=16) 위에 있어서, 짧은 줄기가 아니라 첫째가 길게
   이어진 것으로 보이고 그 중간에 머리 점이 하나 박혔다. 그래서 아래 validate 가
   줄기 사이 거리를 잰다 — x+y 가 곧 그 선의 이름이다. */
const STREAKS = [
    { x1: 12.6, y1: 3.4, x2: 7.6, y2: 8.4, w: 1.3, head: 1.15, o: '1' },
    { x1: 7.2, y1: 4.2, x2: 4.4, y2: 7.0, w: 1.1, head: 0.9, o: '.55' },
    { x1: 13.0, y1: 8.8, x2: 10.2, y2: 11.6, w: 1.1, head: 0.9, o: '.55' },
];

/** ZHR → 줄기 수. 앞에서부터 처음 걸리는 층을 쓴다(내림차순이어야 한다). */
export const METEOR_TIERS = [[100, 3], [25, 2], [0, 1]];
export const meteorTier = (zhr) => METEOR_TIERS.find(([min]) => zhr >= min)[1];

const meteorIcon = (n) => svg(STREAKS.slice(0, n).map((s) =>
    `<g opacity="${s.o}">`
    + `<line x1="${s.x1}" y1="${s.y1}" x2="${s.x2}" y2="${s.y2}" stroke="${INK}"`
    + ` stroke-width="${s.w}" stroke-linecap="round"/>`
    + `<circle cx="${s.x2}" cy="${s.y2}" r="${s.head}" fill="${INK}"/>`
    + `</g>`).join(''));

/* ---------------------------------------------------------------- 판 전체
   이름 → SVG. gen-sky-icons 가 이 표 그대로 쓰고, check-pages 가 이 표와
   public/sky-icons/ 가 1:1 인지 본다 — 유령 파일도 빠진 파일도 여기서 걸린다. */
export const ICONS = (() => {
    const out = {};
    for (let k = 0; k < 24; k++) out[`term-${String(k).padStart(2, '0')}`] = termIcon(k);
    out['moon-new'] = moonIcon(false);
    out['moon-full'] = moonIcon(true);
    for (const [, n] of METEOR_TIERS) out[`meteor-${n}`] = meteorIcon(n);
    return out;
})();

/** 표의 한 행(sky.json 의 항목) → 아이콘 이름. 없으면 null(음력). */
export function skyIconOf(kind, e) {
    if (kind === 'term') return `term-${String(e.k).padStart(2, '0')}`;
    if (kind === 'moon') return e.f ? 'moon-full' : 'moon-new';
    if (kind === 'shower') return `meteor-${meteorTier(e.z)}`;
    return null;
}

/** 아이콘 하나의 <img>. alt 가 빈 문자열인 것은 국기와 같은 이유다 —
    바로 옆에 이름이 글자로 있어서 그림을 다시 읽어 주면 같은 말을 두 번 듣는다. */
export const skyIconImg = (name) =>
    `<img class="sky-icon" src="/${ICON_DIR}/${name}.svg"`
    + ` width="${ICON_W}" height="${ICON_H}" alt=""`
    + ` loading="lazy" decoding="async">`;

/* ---------------------------------------------------------------- 검산
   **그린 것을 다시 읽어서 본다.** 좌표를 계산한 그 식으로 되짚으면 식이 틀렸을 때
   검사도 같이 틀린다 — favicon-art 의 validate 와 같은 자리이고, 여기서는 문자열이
   된 SVG 에서 숫자를 도로 뽑아 상자 안에 들어오는지 견준다. */
export function validate(icons = ICONS) {
    const bad = [];
    const names = Object.keys(icons);

    for (const [name, body] of Object.entries(icons)) {
        if (!/^<svg[\s>]/.test(body) || !body.trimEnd().endsWith('</svg>')) {
            bad.push(`'${name}' 이 SVG 가 아니다`);
            continue;
        }
        if (!body.includes(`viewBox="0 0 ${ICON_W} ${ICON_H}"`)) bad.push(`'${name}' 의 viewBox 가 다르다`);
        if (!body.includes(INK)) bad.push(`'${name}' 에 잉크색이 없다 — 아무것도 안 그렸다`);

        /* 상자를 넘는 그림은 잘린 채로 뜬다. 원과 줄기 양 끝을 다 본다. */
        const box = (x, y, pad, what) => {
            if (x - pad < 0 || x + pad > ICON_W || y - pad < 0 || y + pad > ICON_H) {
                bad.push(`'${name}' 의 ${what}(${x},${y} ±${pad})가 상자를 넘는다`);
            }
        };
        for (const m of body.matchAll(/<circle cx="([\d.]+)" cy="([\d.]+)" r="([\d.]+)"([^>]*)>/g)) {
            const sw = /stroke-width="([\d.]+)"/.exec(m[4]);
            box(+m[1], +m[2], +m[3] + (sw ? +sw[1] / 2 : 0), '원');
        }
        for (const m of body.matchAll(/<line x1="([\d.]+)" y1="([\d.]+)" x2="([\d.]+)" y2="([\d.]+)" [^>]*stroke-width="([\d.]+)"/g)) {
            box(+m[1], +m[2], +m[5] / 2, '줄기 꼬리');
            box(+m[3], +m[4], +m[5] / 2, '줄기 머리');
        }
    }

    /* 절기 24개가 다 있고 서로 다른 자리에 서 있나. 각도 식을 잘못 적으면
       스물넷이 한 점에 몰리는데, 그림만 보고는 "원 위의 점" 이라 잘 안 보인다. */
    const seats = new Map();
    for (let k = 0; k < 24; k++) {
        const name = `term-${String(k).padStart(2, '0')}`;
        const body = icons[name];
        if (!body) { bad.push(`'${name}' 이 없다`); continue; }
        const suns = [...body.matchAll(/<circle cx="([\d.]+)" cy="([\d.]+)" r="([\d.]+)" fill="#/g)];
        if (suns.length !== 1) { bad.push(`'${name}' 에 해가 ${suns.length}개다`); continue; }
        const at = `${suns[0][1]},${suns[0][2]}`;
        if (seats.has(at)) bad.push(`'${seats.get(at)}' 와 '${name}' 의 해가 같은 자리다`);
        seats.set(at, name);
    }
    /* 분점 둘·지점 둘은 정확히 동서남북이어야 한다. 시작 각도나 회전 방향을
       뒤집으면 그림은 여전히 그럴듯한데 하지가 아래로 간다. */
    for (const [k, want] of [[0, `${C + ORBIT},${C}`], [6, `${C},${C - ORBIT}`],
        [12, `${C - ORBIT},${C}`], [18, `${C},${C + ORBIT}`]]) {
        const s = sunAt(k);
        if (`${s.x},${s.y}` !== want) bad.push(`k=${k} 의 해가 ${s.x},${s.y} 다 — ${want} 이어야 한다`);
    }

    /* 삭과 보름이 같아 보이면 그림을 넣은 뜻이 없다 */
    if (icons['moon-new'] === icons['moon-full']) bad.push('삭과 보름이 똑같이 생겼다');
    if (!/fill="none"/.test(icons['moon-new'] || '')) bad.push('삭이 비어 있지 않다');
    if (/fill="none"/.test(icons['moon-full'] || '')) bad.push('보름이 차 있지 않다');

    /* 세기 층이 겹치거나 비면 어느 유성우는 그림이 없다 */
    for (const [, n] of METEOR_TIERS) {
        const got = (icons[`meteor-${n}`] || '').match(/<line /g) || [];
        if (got.length !== n) bad.push(`'meteor-${n}' 의 줄기가 ${got.length}개다`);
    }

    /* 줄기가 서로 겹치지 않나. 셋 다 기울기 -1 이라 x+y 가 곧 그 선의 이름이고,
       두 선 사이 거리는 그 차이를 √2 로 나눈 값이다. 굵기의 반씩을 빼고도
       여유가 남아야 두 줄기로 보인다 — 처음 앉힌 자리가 실제로 겹쳐 있었다. */
    {
        const lines = [...(icons[`meteor-${STREAKS.length}`] || '').matchAll(
            /<line x1="([\d.]+)" y1="([\d.]+)" x2="([\d.]+)" y2="([\d.]+)" [^>]*stroke-width="([\d.]+)"/g)]
            .map((m) => ({ c: +m[1] + +m[2], c2: +m[3] + +m[4], w: +m[5] }));
        for (const l of lines) {
            if (Math.abs(l.c - l.c2) > 0.01) bad.push(`줄기가 45°가 아니다 (${l.c} → ${l.c2})`);
        }
        for (let i = 0; i < lines.length; i++) {
            for (let j = i + 1; j < lines.length; j++) {
                const gap = Math.abs(lines[i].c - lines[j].c) / Math.SQRT2
                    - (lines[i].w + lines[j].w) / 2;
                if (gap < 0.5) {
                    bad.push(`줄기 ${i + 1} 과 ${j + 1} 사이가 ${gap.toFixed(2)}px 다 — 한 줄로 보인다`);
                }
            }
        }
    }

    /* 서로 다른 이름이 똑같이 생기면 표에서 두 갈래가 한 그림으로 보인다 */
    const seen = new Map();
    for (const name of names) {
        const key = icons[name];
        if (seen.has(key)) bad.push(`'${seen.get(key)}' 와 '${name}' 이 똑같이 생겼다`);
        seen.set(key, name);
    }

    return [...new Set(bad)];
}
