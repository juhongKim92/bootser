/* ============================================================
   전 페이지 공통 검사 — 실행: node tools/check-pages.mjs
   ------------------------------------------------------------
   서버가 없으니 잘못 만든 페이지를 잡아 줄 것도 없다. 배포 전에 여기서 잡는다.

     1. 페이지가 예외 없이 구동되고 window.DDAY 손잡이가 나오나
     2. dday.js 가 찾는 #id 가 HTML 에 실제로 있나
     3. 주요 태그가 짝이 맞나
     4. canonical(자기 주소) · hreflang 3줄(ko/en/x-default, 양쪽에 똑같이) ·
        title · description · 파비콘 4줄 · 자산 링크가 있나
        (파비콘은 파일까지 열어 정사각 + 48 의 배수인지 본다 — 구글 검색결과 아이콘 조건)
     4.5. og:image · twitter:card 가 있고, 가리키는 공유 카드가 실제로 있으며
        HTML 이 적어 둔 크기와 PNG 머리의 크기가 같나
     4.6. 하늘 허브가 표를 이고 있지 않고 세 갈래로 다 링크하나, 그리고 갈래
        페이지가 제 갈래의 자료만 담고 제 갈래의 카드 줄만 두었나
     5. HTML 표의 날짜 집합이 data/<CC>.json 과 정확히 같나
     5.2. 요약 문장과 description 이 나르는 사실이 자료와 같나 — 공휴일 수 ·
        주말 겹침 · 연휴 횟수 · 가장 긴 연휴. 숫자는 문맥에 붙여 본다
        (그냥 "어딘가에 있나" 로 보면 다른 숫자가 대신 물어 준다)
        (생성기가 자료를 흘리거나 겹쳐 쓰지 않았나)
     5.5. 황금연휴가 스스로 앞뒤가 맞나 — 3일 이상인가, 우리가 담은 공휴일에
        걸려 있나, 징검다리가 구간 안의 평일인가 — 그리고 표가 그 자료와 같나
     6. 고정 날짜를 넣고 DDAY.classify 가 낸 다음/지난/오늘이
        여기서 따로 계산한 값과 같나. 연휴는 갈림길이 셋이라(전·중·후)
        DDAY.classifyBreaks 도 같은 방식으로 견준다
     7. 첫 화면 국가 링크 · countries.json · 실제 페이지 디렉터리가 1:1 인가
     8. sitemap.xml 의 URL 집합이 페이지 집합과 같나
     9. 브라우저 지역 감지(DDAY.detect)가 기대대로 갈리나, 그리고 저장된 값이
        그 감지를 바꾸지 못하나 — 홈은 늘 내 지역이어야 한다
    10. ko / en 이 짝으로 있고, 두 벌이 같은 국가 집합을 덮나
    11. 영어 페이지가 한국어 말을 흘리지 않나
    12. 어느 페이지도 localStorage 에 아무것도 남기지 않나
    13. data/month/*.json 이 국가별 파일과 한 건도 어긋나지 않나
    14. robots.txt · CSS 계약 · 404 가 언어 칸마다 있고 noindex 인가
    15. 글꼴이 전부 우리 오리진이고, 커밋한 조각이 사이트가 쓰는 글자를 다 덮나

   실패가 하나라도 있으면 종료 코드 1 이다.
   ============================================================ */
import { boot, pages, PUB, DATA } from './harness.mjs';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
import { BASE, EXTRA, YEARS, today, HERE, kindOf, NAME_PAGE } from './config.mjs';
import { NORM, NAMES, MIN, NAME_ROOT } from './holiday-names.mjs';
import { pngSize } from './png.mjs';
import { FONT_DIR, FONT_CSS, LICENSE_FILE, codepoints, parseFaces, parseRanges, used, parseName, hash8 } from './fonts.mjs';
import { SHOWERS } from './astro.mjs';
import { EQUINOXES, TOLERANCE_MINUTES } from './sky-fixture.mjs';
import { ICONS, ICON_DIR, ICON_PATH, skyIconOf, skyIconImg, validate as skyArtWrong } from './sky-art.mjs';
/* 달력 목록과 라벨만 가져온다 — 날짜를 내는 함수(newYears)는 **가져오지 않는다**.
   그걸 같이 쓰면 훑기가 틀렸을 때 검사도 똑같이 틀린다. 아래 검산점 칸은 ICU 에
   다른 질문(그 날의 월·일이 1/1인가)을 던지고, 분점은 손으로 적은 고정값을 쓴다. */
import { CALS, CAL_BY_ID, NY_CALS, ERA_CALS, noonOf, yearOf } from './calendars.mjs';

const fail = [], warn = [];
const bad = (p, m) => fail.push(`${p}: ${m}`);
const soft = (p, m) => warn.push(`${p}: ${m}`);

const TAGS = ['html', 'head', 'body', 'div', 'section', 'main', 'table', 'thead', 'tbody',
    'tr', 'td', 'th', 'span', 'p', 'h1', 'h2', 'ul', 'li', 'dl', 'dt', 'dd',
    'details', 'summary', 'a'];

const ICON_LINKS = [
    'href="/favicon.ico"',
    'href="/favicon.svg"',
    'href="/icon-192.png"',
    'rel="apple-touch-icon"',
];

/* dday.js 가 이름으로 찾는 것들. 없으면 조용히 아무 일도 안 일어난다 —
   그게 가장 알아채기 어려운 고장이라 여기서 본다. */
const NEED_IDS = {
    country: ['picker', 'now', 'next', 'prev'],
    home: ['picker', 'home', 'tcap', 'tnote', 'tlist', 'csearch', 'clist', 'cnone', 'sky', 'skylist'],
    /* 하늘 허브는 표도 카드도 없다. 첫 화면과 같은 #skylist 하나로 굴러간다. */
    sky: ['picker', 'skylist'],
    'sky/term': ['picker', 'now', 'next-term'],
    'sky/moon': ['picker', 'now', 'next-new', 'next-full'],
    'sky/meteor': ['picker', 'now', 'next-shower'],
    'sky/lunar': ['picker', 'now', 'next-lunar'],
    'sky/calendar': ['picker', 'now', 'next-cal'],
    /* 이름 축 허브와 순위 페이지에는 카드가 없다 — 표에 여러 이름·여러 나라가
       섞여 있어 "다음" 이 하나로 정해지지 않는다. 이름 한 장에만 카드가 있다. */
    holiday: ['picker'],
    name: ['picker', 'now', 'next', 'prev'],
    rank: ['picker'],
    /* 요일 축도 표만 이고 있다 — 순위와 같이 '다음' 이 하나로 정해지지 않는다 */
    weekday: ['picker'],
};

/* 하늘 갈래. gen-pages 의 SKY_TOPICS 와 짝이지만 여기서 따로 적는다 —
   거기서 가져오면 둘이 같이 틀려도 통과한다. */
const SKY_KIND = { 'sky/term': 'term', 'sky/moon': 'moon', 'sky/meteor': 'shower', 'sky/lunar': 'lunar',
    'sky/calendar': 'cal' };
const SKY_DATA = { 'sky/term': 'terms', 'sky/moon': 'moons', 'sky/meteor': 'showers', 'sky/lunar': 'lunar',
    'sky/calendar': 'cals' };

/* 슬러그를 언어와 갈래로 가른다.
     '' | 'en' | 'kr' | 'en/kr' | 'sky' | 'sky/moon' | 'holiday' | 'holiday/christmas' | 'rank'
   갈래를 가르는 규칙은 config.mjs 의 kindOf 하나다 — 경로 규칙은 의견이 아니라
   규칙이고, gen-pages 가 페이지를 놓는 자리와 여기가 읽는 자리가 갈리면
   검사가 통째로 헛돈다. (기대값·문안을 나눠 쓰지 않는 것과는 다른 이야기다.) */
const ALL = pages().map((p) => {
    const en = p === 'en' || p.startsWith('en/');
    const slug = en ? p.slice(3) : p;                    /* '' | 'kr' | 'sky' */
    return { page: p, lang: en ? 'en' : 'ko', slug, kind: kindOf(slug),
        label: '/' + (p ? p + '/' : '') };
});
const COUNTRY = ALL.filter((p) => p.kind === 'country');
console.log(`페이지 ${ALL.length}개 (한국어 ${ALL.filter((p) => p.lang === 'ko').length}` +
    ` · 영어 ${ALL.filter((p) => p.lang === 'en').length})\n`);

/* ------------------------------------------------------------ 파비콘 크기
   구글이 검색결과에 아이콘을 쓰는 조건은 정사각 + 한 변이 48 의 배수다.
   .ico 는 여러 크기를 담는 묶음이라 "48 이 들어 있나" 로 본다. */
function check(name, fn) {
    const file = join(PUB, name);
    if (!existsSync(file)) { bad('/', `파비콘 없음: ${name}`); return; }
    try { fn(file); } catch (e) { bad('/', `${name} — ${e.message}`); }
}
for (const name of ['icon-192.png', 'apple-touch-icon.png']) check(name, (file) => {
    const b = readFileSync(file);
    const w = b.readUInt32BE(16), h = b.readUInt32BE(20);
    if (w !== h) throw new Error(`정사각이 아니다 (${w}×${h})`);
    if (w % 48) throw new Error(`한 변이 48 의 배수가 아니다 — ${w}px (구글이 안 쓴다)`);
});
check('favicon.ico', (file) => {
    const b = readFileSync(file);
    if (b.readUInt16LE(2) !== 1) throw new Error('ICO 헤더가 아니다');
    const sizes = [];
    for (let i = 0; i < b.readUInt16LE(4); i++) {
        const o = 6 + i * 16;
        const w = b[o] || 256, h = b[o + 1] || 256;
        if (w !== h) throw new Error(`${w}×${h} 항목이 정사각이 아니다`);
        sizes.push(w);
    }
    if (!sizes.includes(48)) throw new Error(`48×48 이 없다 — 담긴 크기 ${sizes.join('/')}`);
});
check('favicon.svg', (file) => {
    const vb = (readFileSync(file, 'utf8').match(/viewBox="([^"]+)"/) || [])[1];
    if (!vb) throw new Error('viewBox 가 없다');
    const [, , w, h] = vb.split(/\s+/).map(Number);
    if (w !== h) throw new Error(`정사각이 아니다 (${w}×${h})`);
});

/* ------------------------------------------------------------------ robots
   손으로 쓰는 유일한 파일인데 도메인이 박혀 있다. config 의 BASE 를 바꾸면
   나머지는 다 따라가는데 여기만 안 따라가서, 크롤러가 없는 sitemap 을 보게 된다. */
{
    const file = join(PUB, 'robots.txt');
    if (!existsSync(file)) bad('/robots.txt', '없다');
    else {
        const txt = readFileSync(file, 'utf8');
        const want = `Sitemap: ${BASE}/sitemap.xml`;
        if (!txt.includes(want)) {
            const has = (txt.match(/^Sitemap:.*$/m) || ['(줄 자체가 없다)'])[0];
            bad('/robots.txt', `"${has}" — "${want}" 이어야 한다`);
        }
    }
}

/* ------------------------------------------------------------------ 스타일
   화면으로만 확인되는 것은 하니스가 못 본다. 그중 "있기로 하고 만든" 것 몇 개만
   계약으로 박아 둔다 — 나중에 CSS 를 손보다 조용히 사라지는 걸 막는다. */
{
    const css = ['base.css', 'dday.css']
        .map((f) => readFileSync(join(PUB, 'shared', f), 'utf8')).join('\n');
    const need = [
        [/\.panel ul\{[^}]*overflow-y:\s*auto/, '국가 목록이 스크롤되지 않는다'],
        [/\.panel ul\{[^}]*max-height/, '국가 목록에 높이 제한이 없다 — 204개가 화면을 넘긴다'],
        [/tr\.is-today\{/, '오늘 행 강조가 없다'],
        [/tr\.is-past td\{/, '지난 행 흐림 처리가 없다'],
        [/\.local\{/, '지역 한정 배지 스타일이 없다'],
        [/\.bridge\{/, '징검다리 배지 스타일이 없다'],
        [/td\.range\{/, '연휴 기간 칸 스타일이 없다 — 줄바꿈이 나 버린다'],
        [/\.now \.pair dd \.dd\.on\{/, '연휴 중 표시 색이 없다 — 다가오는 연휴와 같아 보인다'],
        [/td\.date \.at\{/, '하늘 표의 시각 스타일이 없다'],
        [/td\.ev\{/, '하늘 표의 이름 칸 스타일이 없다'],
        [/\.cardinal\{/, '분점·지점 배지 스타일이 없다'],
        [/\.leap\{/, '윤달 배지 스타일이 없다 — 표에서 안 보인다'],
        [/\.tab\{/, '축 탭 스타일이 없다'],
        [/img\.flag\{/, '국기 스타일이 없다'],
        [/img\.flag\{[^}]*border/, '국기에 테두리가 없다 — 흰 국기(일본)가 바탕에 묻힌다'],
        /* 요약 카드의 국기는 22px 명조 옆에 선다. base.css 의 -2px(본문 15px 기준)이
           그대로 오면 글자보다 아래로 처지고 이름에 딱 붙는다. */
        [/\.now \.verdict img\.flag\{/, '요약 카드의 국기 자리 보정이 없다 — 글자보다 처지고 이름에 붙는다'],
        [/td\.ico\{/, '하늘 표의 그림 칸 스타일이 없다'],
        [/img\.sky-icon\{/, '하늘 아이콘 스타일이 없다'],
        [/\.tab\.here\{[^}]*font-weight/, '잡힌 축 탭이 굵기로도 갈리지 않는다 — 색만으로는 부족하다'],
        [/\.top \.tabs\{[^}]*overflow-x/, '좁은 화면에서 축 탭이 굴러가지 않는다 — 머리말이 넘친다'],
        [/table\.who td\.name\{/, '이름 축 표의 이름 칸 스타일이 없다'],
        [/\.ccs\{/, '이름 축의 나라 칩 스타일이 없다 — 176개국이 한 줄로 붙는다'],
        [/\.ccs \.one::after\{/, '나라 칩 사이 구분점이 없다 — 이름들이 붙어 읽힌다'],
        [/td\.no\{/, '순위 칸 스타일이 없다'],
        [/td\.who\{/, '순위 표의 국가 칸 스타일이 없다 — 줄바꿈이 나 버린다'],
        [/table\.wk\{/, '요일 축 표 스타일이 없다'],
        [/table\.wk td\.num\{[^}]*tabular-nums/, '요일 축의 수 칸이 자리를 안 맞춘다 — 일곱 줄을 견주는 표다'],
        [/\.sum\{/, '요약 문장 스타일이 없다 — lede 와 붙어 한 문단으로 보인다'],
        /* .now .pair dd .dd 는 카드 안에만 걸린다. 첫 화면 목록에도 같은 모양이
           필요한데 그걸 빠뜨려서 "D-10다음 절기" 처럼 붙어 나온 적이 있다. */
        [/\.worldwide \.what \.dd\{/, '첫 화면 하늘 목록의 D-day 가 붙어 나온다'],
        [/\.worldwide \.what em\{/, '첫 화면 하늘 목록의 날짜가 붙어 나온다'],
        [/\.worldwide \.who img\{/, '첫 화면 목록의 그림과 이름 사이 여백이 없다'],
        /* 한국어는 기본값이 음절 사이 어디서나 끊는다 — "봅니다." 가 "봅니"/"다." 로
           갈린다. 하늘 허브에서 실제로 그랬고, 화면으로만 보이는 종류의 흠이다. */
        [/\.lede\{[^}]*word-break:\s*keep-all/, '머리글이 낱글자로 쪼개진다 — 한국어에 keep-all 이 없다'],
        [/body\[data-sky-hub\] \.lede\{/, '하늘 허브 머리글이 62ch 에 갇혀 마지막 한 마디가 다음 줄로 떨어진다'],
        [/prefers-color-scheme:\s*dark/, '어두운 테마 토큰이 없다'],
        [/@media \(max-width:\s*640px\)/, '좁은 화면 대응이 없다'],
    ];
    for (const [re, msg] of need) if (!re.test(css)) bad('shared/*.css', msg);

    /* 있으면 안 되는 것 하나. `.worldwide .who` 를 플렉스 상자로 두면 줄(li)의
       `align-items:baseline` 이 이 칸의 밑선을 **첫 항목**에서 가져오는데, 첫 항목이
       그림이라 밑선이 없어 아래 모서리가 대신 쓰인다. 그러면 오른쪽 칸(.what)이
       몇 픽셀 내려앉는다 — "다음 절기" 와 "D-3 백로" 가 어긋나 보이던 것이 이것이다.
       그림이 없던 시절에는 첫 항목이 글자라 아무 일도 없었고, 되돌리기도 쉽다. */
    if (/\.worldwide \.who\{[^}]*flex/.test(css)) {
        bad('shared/*.css', '.worldwide .who 가 다시 플렉스다 — 줄의 밑선이 그림 아래 모서리로 잡혀 오른쪽 칸이 내려간다');
    }
}

/* ------------------------------------------------------------------- 글꼴
   여기 오기 전 머리에는 남의 오리진이 셋 있었다(googleapis · gstatic · jsdelivr).
   `tools/gen-fonts.mjs` 가 조각을 받아 public/fonts/ 에 커밋해 두고, 여기서는
   그것이 성립하는지만 본다 — 네트워크 없이. Cloudflare 빌드가 이 파일을 돌린다.

   무는 것 여섯.
     · 렌더 경로에 남의 오리진이 다시 들어오지 않았나 (이 항목이 되돌려지는 유일한 길)
     · 페이지가 /fonts/fonts.css 를 걸고 있나
     · fonts.css 가 가리키는 파일이 다 있고, 이름의 해시가 내용과 맞나
     · 모든 면에 font-display:swap 이 있나 (없으면 최대 3초 빈 글자다)
     · base.css 가 첫 자리에 적은 글꼴 셋을 우리가 실제로 나르나
     · **버린 조각이 이제 필요해지지 않았나** — 이게 가지치기의 유일한 위험이다.
       나라가 하나 늘어 새 한글 음절이 들어오면 그 글자만 대체 글꼴로 나오는데
       화면으로도 잘 안 보인다. fonts-lock.json 에 적어 둔 버린 범위로 잡는다. */
{
    const FDIR = join(PUB, FONT_DIR);
    const cssFile = join(FDIR, FONT_CSS);
    const P = `/${FONT_DIR}/${FONT_CSS}`;

    if (!existsSync(cssFile)) bad(P, '없다 — node tools/gen-fonts.mjs');
    else {
        const css = readFileSync(cssFile, 'utf8');
        const faces = parseFaces(css);
        if (!faces.length) bad(P, '@font-face 가 하나도 없다');

        /* 3-1. 가리키는 파일과 이름의 해시 */
        const referenced = new Set();
        for (const f of faces) {
            if (!f.url.startsWith(`/${FONT_DIR}/`)) { bad(P, `우리 오리진이 아니다: ${f.url}`); continue; }
            const name = f.url.slice(FONT_DIR.length + 2);
            referenced.add(name);
            const parsed = parseName(name);
            if (!parsed) { bad(P, `이름 규칙에 안 맞는다: ${name}`); continue; }
            const file = join(FDIR, name);
            if (!existsSync(file)) { bad(P, `가리키는 파일이 없다: ${name}`); continue; }
            const buf = readFileSync(file);
            if (hash8(buf) !== parsed.hash)
                bad(P, `${name} — 이름의 해시(${parsed.hash})가 내용(${hash8(buf)})과 다르다`);
            if (buf.subarray(0, 4).toString('latin1') !== 'wOF2')
                bad(P, `${name} — woff2 가 아니다`);
        }

        /* 3-2. font-display */
        const swap = (css.match(/font-display:\s*swap/g) || []).length;
        if (swap !== faces.length)
            bad(P, `font-display:swap 이 ${swap}면뿐이다 — ${faces.length}면 전부에 있어야 한다`);

        /* 3-3. 커밋된 woff2 중 아무도 안 가리키는 것 */
        for (const name of readdirSync(FDIR)) {
            if (name === FONT_CSS || name === LICENSE_FILE) continue;
            if (!referenced.has(name)) bad(`/${FONT_DIR}/`, `fonts.css 가 안 가리키는 파일이 남아 있다: ${name}`);
        }
        if (!existsSync(join(FDIR, LICENSE_FILE)))
            bad(`/${FONT_DIR}/`, `${LICENSE_FILE} 이 없다 — 셋 다 OFL 이라 같이 실어야 한다`);

        /* 3-4. base.css 가 첫 자리에 적은 이름을 우리가 나르나.
           기대값은 여기 적지 않는다 — base.css 가 진짜고, 그것과 fonts.css 가
           어긋나는 순간이 고장이다. */
        const base = readFileSync(join(PUB, 'shared', 'base.css'), 'utf8');
        const shipped = new Set(faces.map((f) => f.family));
        for (const tok of ['serif', 'sans', 'mono']) {
            const stack = (new RegExp(`--${tok}:([^;]+);`).exec(base) || [])[1];
            if (!stack) { bad('shared/base.css', `--${tok} 토큰이 없다`); continue; }
            const m = /^\s*(?:'([^']+)'|([A-Za-z][\w-]*))/.exec(stack) || [];
            const first = m[1] || m[2];
            if (!first) { bad('shared/base.css', `--${tok} 의 첫 글꼴 이름을 못 읽었다`); continue; }
            if (!shipped.has(first))
                bad(P, `base.css 의 --${tok} 은 '${first}' 를 먼저 부르는데 우리는 안 나른다`);
        }

        /* 3-5. 버린 조각이 이제 필요해졌나 */
        const lockFile = join(HERE, 'fonts-lock.json');
        if (!existsSync(lockFile)) bad('tools/fonts-lock.json', '없다 — node tools/gen-fonts.mjs');
        else {
            const cps = codepoints(PUB);
            const lock = JSON.parse(readFileSync(lockFile, 'utf8'));
            for (const fam of lock.families) {
                if (!shipped.has(fam.family)) { bad(P, `lock 에 있는 '${fam.family}' 를 fonts.css 가 안 나른다`); continue; }
                for (const d of fam.dropped) {
                    if (!used(parseRanges(d.range), cps)) continue;
                    const miss = [];
                    for (const [a, b] of parseRanges(d.range))
                        for (const c of cps) if (c >= a && c <= b && miss.length < 6) miss.push(String.fromCodePoint(c));
                    bad('tools/fonts-lock.json',
                        `${fam.family} 의 버린 조각 ${d.index} 가 이제 필요하다 (${miss.join(' ')}) — node tools/gen-fonts.mjs`);
                }
            }
        }
    }

    /* 3-6. 렌더 경로의 오리진. canonical · hreflang · og:url 은 절대주소가 맞으므로
       스타일시트 · 스크립트 · preload 계열만 본다. 남의 오리진이 다시 들어오는
       길은 실질적으로 여기뿐이다. */
    const htmls = [];
    (function walk(dir) {
        for (const e of readdirSync(dir, { withFileTypes: true })) {
            if (e.isDirectory()) walk(join(dir, e.name));
            else if (e.name.endsWith('.html')) htmls.push(join(dir, e.name));
        }
    })(PUB);
    /* 소유확인 파일(naver*.html)은 한 줄짜리라 여기 걸릴 것이 없지만 세어는 둔다. */
    let checked = 0;
    for (const file of htmls) {
        const rel = '/' + file.slice(PUB.length + 1).split(sep).join('/');
        const html = readFileSync(file, 'utf8');
        if (!/<link |<script /.test(html)) continue;
        checked++;
        for (const m of html.matchAll(/<link\b[^>]*>/g)) {
            const tag = m[0];
            const relAttr = (/rel="([^"]+)"/.exec(tag) || [])[1] || '';
            if (!/^(stylesheet|preload|preconnect|dns-prefetch|modulepreload)$/.test(relAttr)) continue;
            const href = (/href="([^"]+)"/.exec(tag) || [])[1] || '';
            if (!href.startsWith('/')) bad(rel, `남의 오리진: <link rel="${relAttr}" href="${href}">`);
        }
        for (const m of html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g))
            if (!m[1].startsWith('/')) bad(rel, `남의 오리진: <script src="${m[1]}">`);
        if (rel.endsWith('/index.html') || rel === '/404.html') {
            if (!html.includes(`href="${P}"`)) bad(rel, `${P} 를 안 건다`);
        }
    }
    /* CSS 안에서도 샐 수 있다 — @import 나 url(https://...). */
    for (const name of ['base.css', 'dday.css']) {
        const css = readFileSync(join(PUB, 'shared', name), 'utf8');
        if (/@import/.test(css)) bad(`shared/${name}`, '@import 가 있다 — 렌더를 한 번 더 막는다');
        for (const m of css.matchAll(/url\((['"]?)(https?:)?\/\//g)) bad(`shared/${name}`, `url() 이 밖을 본다: ${m[0]}`);
    }
    console.log(`글꼴 — 우리 오리진만 · HTML ${checked}개 확인`);
}

/* --------------------------------------------------------------- 날짜 검사
   하니스가 쓰는 것과 겹치지 않게, 기대값은 여기서 따로 계산한다.
   같은 함수로 만들고 같은 함수로 검사하면 아무것도 검사하지 않는 것과 같다. */
const TODAY = today();

/* 표지 연도 — 요약 문장이 어느 해를 말하는지. gen-pages 의 규칙을 여기 다시 적는다:
   담긴 세 해 중 가운데(올해)를 쓰되, 그 해 자료가 없으면 가장 이른 해다.
   저쪽 값을 가져오면 둘이 같이 틀려도 통과한다. */
const MID = YEARS()[1];
const coverYear = (data) => {
    const years = [...new Set(data.days.map((d) => +d.d.slice(0, 4)))].sort((a, b) => a - b);
    return years.includes(MID) ? MID : years[0];
};
const esc = (s) => String(s).replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
/* 카드에 나와야 하는 말. dday.js 의 STR 을 가져다 쓰지 않고 여기 따로 적는다 —
   같은 표를 보고 견주면 번역이 통째로 틀려도 통과한다. */
const WORDS = {
    ko: { noHoliday: '오늘은 여느 날입니다', off: ' — 오늘 쉽니다',
          partial: ' — 일부 지역만 쉽니다', outOfRange: '담긴 자료 범위 밖입니다',
          breakLen: (n) => `${n}일 연휴`, breakNow: '연휴 중', dtBreak: '다음 연휴',
          noBreak: '담긴 자료에 연휴가 없습니다',
          newMoon: '삭', fullMoon: '보름',
          thTime: '날짜와 시각', thEvent: '천문 현상', thDateOnly: '날짜', thNewYearDay: '새해',
          skyNone: '오늘은 절기도 삭망도 아닙니다', skyOff: '오늘입니다',
          lunarNone: '오늘은 초하루가 아닙니다',
          calNone: '오늘은 어느 달력의 새해도 아닙니다',
          dtTerm: '다음 절기', dtNew: '다음 삭', dtFull: '다음 보름', dtShower: '다음 유성우',
          asofYear: (y) => String(y) },
    en: { noHoliday: 'An ordinary day', off: ' — a day off today',
          partial: ' — observed only in some regions', outOfRange: 'Outside the range of the data',
          breakLen: (n) => `${n}-day break`, breakNow: 'on now', dtBreak: 'Next break',
          noBreak: 'No long weekend in the data',
          newMoon: 'New Moon', fullMoon: 'Full Moon',
          thTime: 'Date and time', thEvent: 'Event', thDateOnly: 'Date', thNewYearDay: 'New year',
          skyNone: 'No solar term or moon phase today', skyOff: 'today',
          lunarNone: 'Not the first day of a lunar month',
          calNone: 'Not a new year in any of these calendars',
          dtTerm: 'Next term', dtNew: 'Next new moon', dtFull: 'Next full moon', dtShower: 'Next shower',
          asofYear: (y) => String(y) },
};

/* 푸터에 조립돼 나와야 하는 주소. 소스의 조각을 뒤집어 만들지 않고 여기 적는다. */
const CONTACT_ADDR = 'contact' + String.fromCharCode(64) + 'vermilion19.com';

/* 하늘 자료. 페이지 순회와 아래 검산점 칸이 같은 것을 본다. */
const SKY_FILE = join(DATA, 'sky.json');
if (!existsSync(SKY_FILE)) {
    console.error('data/sky.json 이 없다 — node tools/gen-sky.mjs 를 먼저 돌릴 것.');
    process.exit(1);
}
const SKY = JSON.parse(readFileSync(SKY_FILE, 'utf8'));

/* data/ 안의 국가 파일만 고른다. countries.json 은 목록이고 sky.json 은 국가 축이
   아니다 — 그냥 훑으면 days 가 없다며 터진다. */
const NOT_COUNTRY = new Set(['countries.json', 'sky.json']);
const countryFiles = () => readdirSync(DATA).filter((f) => f.endsWith('.json') && !NOT_COUNTRY.has(f));

const PROBE = '2026-06-15';                     /* 아무 날이나 — 재현 가능하기만 하면 된다 */
function epochDayRef(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    return Math.round(Date.UTC(y, m - 1, d) / 86400000);
}
const isoAt = (n) => new Date(n * 86400000).toISOString().slice(0, 10);
function expectRef(dates, today) {
    const t = epochDayRef(today);
    let next = null, prev = null;
    const todays = [];
    for (const d of dates) {
        const diff = epochDayRef(d) - t;
        if (diff === 0) todays.push(d);
        else if (diff > 0 && (next === null || diff < next.diff)) next = { d, diff };
        else if (diff < 0 && (prev === null || diff > prev.diff)) prev = { d, diff };
    }
    return { todays, next, prev };
}

/* 연휴 쪽 기대값. dday.js 의 classifyBreaks 를 가져다 쓰지 않고 여기 다시 적는다 —
   같은 함수로 만들고 같은 함수로 검사하면 아무것도 검사하지 않는 것과 같다.
   "다음" 은 지금 붙어 있는 연휴가 있으면 그것이다. */
function expectBreak(longs, today) {
    const t = epochDayRef(today);
    let now = null, next = null;
    for (const w of longs) {
        const s = epochDayRef(w.s), e = epochDayRef(w.e);
        const days = e - s + 1;
        if (t >= s && t <= e) { if (!now) now = { w, days, phase: 'now' }; }
        else if (s > t && (next === null || s - t < next.diff)) {
            next = { w, days, diff: s - t, phase: 'next' };
        }
    }
    return now || next;
}
/* 연휴 구간의 모든 날짜 */
function spanRef(s, e) {
    const out = [];
    for (let n = epochDayRef(s); n <= epochDayRef(e); n++) {
        out.push(new Date(n * 86400000).toISOString().slice(0, 10));
    }
    return out;
}

/* ------------------------------------- 이름 축을 손으로 다시 묶어 둔다

   이름 축(/holiday/…)은 `data/` 에 파일을 하나도 더 만들지 않는다. gen-pages 가
   204개 국가 파일을 그때그때 묶어 HTML 에 박을 뿐이다. 그래서 검산점이
   `data/month/*.json` 보다 세다 — **묶는 코드를 나눠 쓰지 않으므로 둘이 같이
   틀릴 수 없다.** 저장된 파생물을 견주는 쪽은 생성기가 두 벌을 같은 코드로 만들면
   조용히 통과하는데, 여기는 그럴 수가 없다.

   묶는 규칙(정규화)만은 원화와 같은 규칙이어야 하므로 여기 **다시 적는다** —
   holiday-names.mjs 의 NORM 을 가져오지 않는다. 라벨과 슬러그(NAMES)와 문턱(MIN)은
   자료가 아니라 입력이라 그대로 들여온다. */
const NAME_INDEX = (() => {
    const norm = (s) => String(s).toLowerCase()
        .replace(/['‘’]/g, '')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();

    const byKey = new Map();
    for (const f of countryFiles()) {
        const d = JSON.parse(readFileSync(join(DATA, f), 'utf8'));
        for (const day of d.days) {
            /* e 가 없으면 현지어가 곧 영어 이름이다 — 이 갈림길을 놓치면
               3,375건이 한 이름으로 뭉친다 */
            const k = norm(day.e ?? day.n);
            if (!byKey.has(k)) byKey.set(k, new Map());
            const m = byKey.get(k);
            if (!m.has(day.d)) m.set(day.d, new Set());
            m.get(day.d).add(d.code);
        }
    }

    const out = new Map();                    /* 슬러그 → { key, cover, dates } */
    for (const [key, m] of byKey) {
        const cover = new Set();
        for (const [date, ccs] of m) {
            if (date.startsWith(String(MID))) for (const cc of ccs) cover.add(cc);
        }
        if (cover.size < MIN) continue;
        const label = NAMES[key];
        if (!label) { bad('/holiday/', `문턱을 넘는데 라벨이 없는 이름: '${key}' (${cover.size}개국)`); continue; }
        out.set(label.slug, {
            key, ko: label.ko, en: label.en, cover: cover.size,
            dates: [...m.keys()].sort().map((d) => ({ d, cc: [...m.get(d)].sort() })),
        });
    }
    return out;
})();

/* 날짜 축 — "어떤 날에 가장 많은 나라가 쉬나". 이름과 무관하게 날짜로만 센다.
   허브의 표와 견줄 기대값이고, 문턱(10)은 gen-pages 의 TOGETHER_MIN 과 같은 수를
   여기 다시 적은 것이다 — 저쪽 값을 들여오면 문턱이 바뀌어도 조용히 통과한다. */
const TOGETHER_MIN_REF = 10;
const TOGETHER_REF = (() => {
    const byDate = new Map();
    for (const f of countryFiles()) {
        const d = JSON.parse(readFileSync(join(DATA, f), 'utf8'));
        for (const day of d.days) {
            if (!day.d.startsWith(String(MID))) continue;
            if (!byDate.has(day.d)) byDate.set(day.d, new Set());
            byDate.get(day.d).add(d.code);
        }
    }
    return [...byDate.keys()]
        .map((d) => ({ d, n: byDate.get(d).size }))
        .filter((x) => x.n >= TOGETHER_MIN_REF)
        .sort((a, b) => b.n - a.n || a.d.localeCompare(b.d));
})();

/* 순위 — 표지 연도의 "쉬는 날짜" 수와 연휴. 세는 단위를 gen-pages 와 같은 말로
   다시 적는다: 건수가 아니라 **날짜 수**다 (한 날짜에 공휴일이 둘 겹치는 나라가 있다). */
const RANK_TOP_REF = 20;
/* ISO 날짜의 요일. 0=일 … 6=토 — gen-pages 의 dow() 와 같은 규칙이다. */
const dowRef = (iso) => new Date(iso + 'T00:00:00Z').getUTCDay();

const RANK_REF = (() => {
    const rows = [];
    const spans = [];
    for (const f of countryFiles()) {
        const d = JSON.parse(readFileSync(join(DATA, f), 'utf8'));
        const n = new Set(d.days.filter((x) => x.d.startsWith(String(MID))).map((x) => x.d)).size;
        const breaks = (d.long || []).filter((w) => w.s.startsWith(String(MID)));
        if (!n) continue;
        rows.push({ code: d.code, ko: d.ko, name: d.name, n, breaks: breaks.length });
        for (const w of breaks) {
            spans.push({ code: d.code, s: w.s, e: w.e,
                n: epochDayRef(w.e) - epochDayRef(w.s) + 1 });
        }
    }
    const desc = (f) => (a, b) => f(b) - f(a) || a.code.localeCompare(b.code);
    return {
        total: rows.length,
        most: [...rows].sort(desc((c) => c.n)).slice(0, RANK_TOP_REF),
        least: [...rows].sort((a, b) => a.n - b.n || a.code.localeCompare(b.code)).slice(0, RANK_TOP_REF),
        busiest: [...rows].sort(desc((c) => c.breaks)).slice(0, RANK_TOP_REF),
        longest: spans.sort((a, b) => b.n - a.n || a.s.localeCompare(b.s)
            || a.code.localeCompare(b.code)).slice(0, RANK_TOP_REF),
    };
})();

/* 요일 축의 기대값. **검사기가 자기 손으로 다시 센다** — 이름 축의 게이트 4번과
   같은 자리다. gen-pages 의 weekdayIndex 를 import 하지 않는 것이 요점이고,
   그래서 둘이 같이 틀릴 수가 없다.

   ⚠ 세는 단위가 RANK_REF 와 같아야 한다(공휴일이 있는 **날짜**). 아래 불변식이
   그것을 본다 — 요일 일곱 칸의 합이 순위 페이지의 날짜 수 합과 맞아야 한다. */
const WK_MIN_REF = 8;

/* 나라별 주말 요일. **Intl 이 유일한 출처다** — 우리 자료에는 없다.
   생성기와 같은 규칙을 쓰지만 값을 나눠 받는 것이 아니라 여기서 다시 물어본다
   (NORM 과 같은 취급이다 — 규칙은 나눠 써도 되고 기대값은 안 된다).
   ⚠ ISO 요일(1=월 … 7=일)을 `d % 7` 로 옮긴다. 안 옮기면 하루씩 밀린다. */
const weekendRef = (cc) => {
    try {
        const w = new Intl.Locale(`und-${cc}`).getWeekInfo();
        if (w && Array.isArray(w.weekend) && w.weekend.length) {
            return new Set(w.weekend.map((d) => d % 7));
        }
    } catch { /* 못 주는 런타임 */ }
    return new Set([0, 6]);
};
const WK_REF = (() => {
    const rows = [];
    const dist = [0, 0, 0, 0, 0, 0, 0];
    const byName = new Map();
    const years = new Map();
    let days = 0;
    const onDate = new Map();

    for (const f of countryFiles()) {
        const d = JSON.parse(readFileSync(join(DATA, f), 'utf8'));
        /* 해별 — 자료가 담은 세 해를 다 센다 */
        for (const y of YEARS()) {
            const s = String(y);
            const set = new Set(d.days.filter((x) => x.d.startsWith(s)).map((x) => x.d));
            if (!set.size) continue;
            if (!years.has(y)) years.set(y, { y, n: 0, we: 0, dist: [0, 0, 0, 0, 0, 0, 0] });
            const e = years.get(y);
            const wknd = weekendRef(d.code);
            for (const iso of set) {
                const k = dowRef(iso);
                e.n++; e.dist[k]++;
                if (wknd.has(k)) e.we++;
            }
        }
        /* 표지 연도 — 나라별 일곱 칸 */
        const dates = [...new Set(d.days.filter((x) => x.d.startsWith(String(MID))).map((x) => x.d))];
        if (!dates.length) continue;
        const w = [0, 0, 0, 0, 0, 0, 0];
        for (const iso of dates) { w[dowRef(iso)]++; dist[dowRef(iso)]++; }
        days += dates.length;
        const wknd = weekendRef(d.code);
        rows.push({
            code: d.code, w, n: dates.length,
            wknd: [...wknd].sort((a, b) => a - b),
            we: dates.filter((iso) => wknd.has(dowRef(iso))).length,
        });
        /* 이름별 — 이름 축의 정규화를 그대로 쓴다(그건 규칙이라 나눠 써도 된다) */
        for (const x of d.days) {
            if (!x.d.startsWith(String(MID))) continue;
            const k = NORM(x.e ?? x.n);
            if (!NAMES[k]) continue;
            if (!byName.has(k)) byName.set(k, { w: [0, 0, 0, 0, 0, 0, 0], n: 0 });
            const e = byName.get(k);
            e.w[dowRef(x.d)]++; e.n++;
        }
        for (const iso of [`${MID}-01-01`, `${MID}-12-25`]) {
            if (d.days.some((x) => x.d === iso)) onDate.set(iso, (onDate.get(iso) || 0) + 1);
        }
    }

    const names = [...byName].map(([k, v]) => ({
        ko: NAMES[k].ko, en: NAMES[k].en, slug: NAMES[k].slug, n: v.n,
        spans: v.w.filter((x) => x > 0).length,
        top: v.w.indexOf(Math.max(...v.w)),
    })).sort((a, b) => b.n - a.n || a.slug.localeCompare(b.slug));

    const desc = (f) => (a, b) => f(b) - f(a) || a.code.localeCompare(b.code);
    const enough = rows.filter((c) => c.n >= WK_MIN_REF);
    const ratio = (c) => c.we / c.n;
    return {
        total: rows.length, days, dist,
        we: rows.reduce((a, c) => a + c.we, 0), rows, names,
        wknds: (() => {
            const m = new Map();
            for (const c of rows) {
                const k = c.wknd.join(',');
                if (!m.has(k)) m.set(k, { days: c.wknd, n: 0 });
                m.get(k).n++;
            }
            return [...m.values()].sort((a, b) => b.n - a.n || a.days[0] - b.days[0]);
        })(),
        years: [...years.values()].sort((a, b) => a.y - b.y),
        fixed: [`${MID}-01-01`, `${MID}-12-25`].map((iso) => ({
            iso, dw: dowRef(iso), n: onDate.get(iso) || 0,
        })),
        mondays: [...rows].sort(desc((c) => c.w[1])).slice(0, RANK_TOP_REF),
        clean: [...enough].sort((a, b) => ratio(a) - ratio(b) || a.code.localeCompare(b.code)).slice(0, RANK_TOP_REF),
        worst: [...enough].sort((a, b) => ratio(b) - ratio(a) || a.code.localeCompare(b.code)).slice(0, RANK_TOP_REF),
    };
})();

/* 요일 축의 산수가 스스로 앞뒤가 맞나 — 페이지를 열기 전에 여기서 본다. */
{
    const sum = WK_REF.dist.reduce((a, b) => a + b, 0);
    if (sum !== WK_REF.days) {
        bad('/weekday/', `요일 일곱 칸의 합이 ${sum} 인데 날짜 수는 ${WK_REF.days} 다`);
    }
    /* **두 페이지가 같은 자료를 같은 단위로 말하나.** 순위 페이지가 검증하는 날짜 수의
       합과 요일 칸의 합이 같아야 한다 — 건수로 세면 여기서 갈라진다. */
    if (WK_REF.total !== RANK_REF.total) {
        bad('/weekday/', `요일 축이 ${WK_REF.total}개국인데 순위 축은 ${RANK_REF.total}개국이다`);
    }
    /* ⚠ 예전에는 "주말 = 토·일" 로 봤다. 금·토인 나라가 8개국이라 그 가정으로는
       조용히 틀린다 — README 가 이 지표를 한 번 뺐던 이유다. 지금은 나라별로
       세므로 전 세계 합계가 토·일 칸의 합과 **달라야** 맞다. */
    if (WK_REF.we === WK_REF.dist[0] + WK_REF.dist[6]) {
        bad('/weekday/', '주말 겹침이 토·일 칸의 합과 같다 — 나라별 주말을 안 보고 있다');
    }
    if (WK_REF.wknds.length < 2) {
        bad('/weekday/', `주말 종류가 ${WK_REF.wknds.length}가지다 — 금·토인 나라가 있어야 한다`);
    }
    for (const y of WK_REF.years) {
        if (y.dist.reduce((a, b) => a + b, 0) !== y.n) bad('/weekday/', `${y.y}년 일곱 칸의 합이 날짜 수와 다르다`);
    }
    for (const c of WK_REF.rows) {
        if (c.w.reduce((a, b) => a + b, 0) !== c.n) { bad('/weekday/', `${c.code} 의 일곱 칸 합이 다르다`); break; }
    }
}

/* 이름 축 페이지의 이름 칸에서 나라 코드를 뽑는다. 칩은 `<span class="one">` 하나에
   국기와 <a> 하나씩이라 좁은 무늬로 충분하다. */
const ccsIn = (cell) => [...cell.matchAll(
    /<span class="one"><img class="flag" src="\/flags\/([a-z]{2})\.svg"[^>]*><a href="(?:\/en)?\/([a-z]{2})\/">/g
)].map((m) => {
    /* 국기와 링크가 같은 나라를 가리키는지 여기서 함께 본다 — 갈리면
       "가나" 옆에 다른 나라 국기가 붙은 채로 통과한다 */
    if (m[1] !== m[2]) bad("/holiday/", `나라 칩의 국기(${m[1]})와 링크(${m[2]})가 다르다`);
    return m[2].toUpperCase();
});

/* 이름 칸의 앞머리(칩 앞)에 적힌 나라 수. "178개국" · "178 countries" */
const countIn = (cell) => {
    const m = /^(\d+)/.exec(cell.replace(/<[^>]*>/g, '').trim());
    return m ? +m[1] : null;
};

/* 날짜 행 하나 = [날짜, 이름 칸]. 이름 축 페이지와 허브가 같은 모양을 쓴다. */
const dateRows = (html) => [...html.matchAll(
    /<tr data-d="(\d{4}-\d{2}-\d{2})">\s*<td class="date">[\s\S]*?<\/td>\s*<td class="name">([\s\S]*?)<\/td>/g
)].map((m) => ({ d: m[1], cell: m[2] }));

/* 국가 이름. 이름 축의 나라 칩과 순위 표가 "보이는 이름순" 인지 보는 데 쓴다 —
   countries.json 은 한글 이름순으로 저장돼 있어서 영어 화면에서 그대로 쓰면
   Ghana(가나)가 맨 앞에 오는 무작위 순서가 된다. 첫 화면에서 한 번 겪은 고장이다. */
const BY_CODE = new Map(JSON.parse(readFileSync(join(DATA, 'countries.json'), 'utf8'))
    .map((c) => [c.code, c]));
const shownName = (cc, lang) => {
    const c = BY_CODE.get(cc) || { ko: cc, name: cc };
    return lang === 'en' ? c.name : c.ko;
};
const inShownOrder = (ccs, lang) => {
    const names = ccs.map((cc) => shownName(cc, lang));
    const sorted = [...names].sort((a, b) => a.localeCompare(b, lang));
    return names.join('|') === sorted.join('|') ? -1 : names.findIndex((n, i) => n !== sorted[i]);
};

/* 순위 표의 행. 열이 셋(순위 · 국가 · 값)인 표와 다섯(연휴)인 표를 따로 뽑는다. */
const rankRowsOf = (body) => [...body.matchAll(
    /<td class="no">(\d+)<\/td>\s*<td class="who"><img class="flag" src="\/flags\/([a-z]{2})\.svg"[^>]*><a href="[^"]*\/([a-z]{2})\/">([^<]*)<\/a><\/td>\s*<td class="len">([^<]*)<\/td>/g
)].map((m) => ({ no: +m[1], flagCc: m[2].toUpperCase(), cc: m[3].toUpperCase(), shown: m[4], cell: m[5] }));

/* ------------------------------------------------------------ 페이지 순회 */
const linkedFromHome = { ko: new Set(), en: new Set() };
const cardsUsed = new Set();
const namePagesSeen = { ko: new Set(), en: new Set() };

for (const { page, lang, slug, kind, label } of ALL) {
    let r;
    try { r = boot(page); }
    catch (e) { bad(label, `구동 실패 — ${e.message}`); continue; }

    for (const e of r.errors) bad(label, e);
    if (!r.dday) { bad(label, 'window.DDAY 손잡이가 없다 — dday.js 가 안 실렸다'); continue; }

    const html = r.html;
    const isHome = kind === 'home';
    const dir = lang === 'en' ? '/en' : '';

    /* <html lang> 이 곧 dday.js 의 갈림길이다. 경로와 어긋나면 영어 페이지가
       한국어 말로 그려진다 — 화면으로만 보이고 어디서도 에러가 안 난다. */
    const declared = (html.match(/<html lang="([a-z]{2})">/) || [])[1];
    if (declared !== lang) bad(label, `<html lang="${declared}"> 가 경로와 다르다 (기대 ${lang})`);
    if (r.dday.lang !== lang) bad(label, `dday.js 가 ${r.dday.lang} 로 잡았다 (기대 ${lang})`);

    /* 1.2. 아무것도 저장하지 않는다.
       홈이 이라크로 굳던 원인은 국가 페이지를 여는 것만으로 값을 써 두었기
       때문이다. 읽는 쪽(detect)만 고치면 다음에 또 읽는 코드가 생긴다. */
    {
        const left = r.win.localStorage._dump();
        const keys = Object.keys(left);
        if (keys.length) bad(label, `localStorage 에 ${keys.join(', ')} 를 남겼다`);
    }

    /* 1.3. 연락처. HTML 에는 뒤집힌 두 토막만 있고 완성된 주소가 없어야 한다.
       조각 하나만 틀려도 조용히 엉뚱한 주소가 나오므로 조립 결과까지 본다.
       기대값은 여기 적어 둔다 — 같은 조각을 뒤집어 견주면 아무것도 검사하지 않는 것과 같다. */
    {
        const spans = (html.match(/<span data-contact /g) || []).length;
        if (spans !== 1) bad(label, `연락처가 ${spans}개다 — 푸터에 하나여야 한다`);
        if (!html.includes('src="/shared/contact.js"')) {
            bad(label, 'contact.js 를 싣지 않는다 — 주소가 조립되지 않는다');
        }
        /* 수집 봇이 정규식으로 훑어 가져갈 만한 것이 남아 있으면 안 된다 */
        if (/[A-Za-z0-9._-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(html)) {
            const hit = html.match(/[A-Za-z0-9._-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/)[0];
            bad(label, `완성된 메일 주소가 소스에 있다: ${hit}`);
        }

        const c = r.doc.contacts[0];
        if (!c) bad(label, '연락처 조각을 찾지 못했다');
        else if (!c.replacedBy) bad(label, 'contact.js 가 주소를 조립하지 않았다');
        else {
            const a = c.replacedBy;
            if (a.textContent !== CONTACT_ADDR) {
                bad(label, `조립된 주소가 ${a.textContent} 다 (기대 ${CONTACT_ADDR})`);
            }
            if (a.href !== 'mailto:' + CONTACT_ADDR) bad(label, `mailto 가 ${a.href} 다`);
            if (a.rel !== 'nofollow') bad(label, `연락처 링크에 rel=nofollow 가 없다 (${a.rel})`);
        }
    }

    /* 1.5. 언어 전환 단추 — 가는 곳과 적힌 글자가 같아야 한다.
       href 는 반대 언어인데 글자는 현재 언어면 눌러 보기 전엔 아무도 모른다. */
    {
        const other = lang === 'ko' ? 'en' : 'ko';
        const href = other === 'en' ? `/en/${slug ? slug + '/' : ''}` : `/${slug ? slug + '/' : ''}`;
        const want = `<a class="btn" href="${href}" hreflang="${other}" lang="${other}">${other.toUpperCase()}</a>`;
        if (!html.includes(want)) {
            const got = (html.match(/<a class="btn"[^>]*>[^<]*<\/a>/) || ['(단추가 없다)'])[0];
            bad(label, `언어 단추가 ${got} — ${want} 이어야 한다`);
        }
    }

    /* 1.7. 축 탭 — 모든 페이지 머리말에 넷이 있고, 지금 축 하나만 잡혀 있어야 한다.
       기대하는 축을 여기 따로 적는다: gen-pages 가 넘기는 값을 가져다 쓰면
       거기서 잘못 넘겨도 통과한다. 탭이 통째로 빠지거나 엉뚱한 축이 잡히는 것은
       화면으로만 보이는 종류의 고장이라 검사 말고 잡을 데가 없다. */
    {
        const wantAxis = {
            home: 'country', country: 'country', rank: 'rank',
            weekday: 'weekday',
            holiday: 'name', name: 'name',
            sky: 'sky', 'sky/term': 'sky', 'sky/moon': 'sky', 'sky/meteor': 'sky', 'sky/lunar': 'sky',
            'sky/calendar': 'sky',
        }[kind];
        const wantHref = {
            country: `${dir}/`, rank: `${dir}/rank/`, weekday: `${dir}/weekday/`,
            name: `${dir}/holiday/`, sky: `${dir}/sky/`,
        };

        const got = [...html.matchAll(/<a class="tab( here)?" href="([^"]+)"( aria-current="page")?>/g)]
            .map((m) => ({ here: !!m[1], href: m[2], current: !!m[3] }));

        if (got.length !== 5) bad(label, `축 탭이 ${got.length}개다 — 다섯이어야 한다`);
        for (const [axis, href] of Object.entries(wantHref)) {
            if (!got.some((g) => g.href === href)) bad(label, `축 탭에 ${axis} 링크가 없다: ${href}`);
        }
        /* 언어 칸을 넘나드는 탭이 있으면 눌렀을 때 언어가 바뀐다 */
        for (const g of got) {
            const en = g.href.startsWith('/en/');
            if (en !== (lang === 'en')) { bad(label, `축 탭이 다른 언어로 간다: ${g.href}`); break; }
        }
        const here = got.filter((g) => g.here);
        if (here.length !== 1) bad(label, `잡혀 있는 축 탭이 ${here.length}개다 — 하나여야 한다`);
        else {
            if (here[0].href !== wantHref[wantAxis]) {
                bad(label, `잡힌 축이 ${here[0].href} 다 (기대 ${wantHref[wantAxis]})`);
            }
            /* 색과 굵기만으로 표시하면 보조기술에는 아무것도 전달되지 않는다 */
            if (!here[0].current) bad(label, '잡힌 축 탭에 aria-current="page" 가 없다');
        }
        const marked = got.filter((g) => g.current).length;
        if (marked !== 1) bad(label, `aria-current="page" 가 ${marked}개다`);
    }

    /* 2. 필요한 id */
    for (const id of (NEED_IDS[kind] || NEED_IDS.country)) {
        if (!html.includes(`id="${id}"`)) bad(label, `dday.js 가 찾는 #${id} 가 HTML 에 없다`);
    }

    /* 3. 태그 짝 */
    for (const t of TAGS) {
        const o = (html.match(new RegExp('<' + t + '[\\s>]', 'g')) || []).length;
        const c = (html.match(new RegExp('</' + t + '>', 'g')) || []).length;
        if (o !== c) bad(label, `<${t}> 열림 ${o} / 닫힘 ${c}`);
    }

    /* 3.4. 이모지 국기가 남아 있지 않나.
       지역 표시 기호(U+1F1E6..U+1F1FF)는 윈도우에서 국기로 합쳐지지 않아
       'GH' 두 글자로 보인다. 그래서 SVG 로 옮겼는데, 국기를 찍는 자리가
       다섯이라(머리말·첫 화면 목록·나라 칩·순위 두 표) 하나만 남아도
       그 자리에서만 글자로 보인다 — 화면으로도 잘 안 걸린다. */
    if (/[\u{1F1E6}-\u{1F1FF}]/u.test(html)) {
        bad(label, '이모지 국기가 남아 있다 — flag() 를 안 거친 자리가 있다');
    }

    /* 3.5. 생성기 사고 흔적 — 템플릿에 값이 안 들어가면 이 문자열들이 남는다 */
    for (const smell of ['undefined', 'NaN', '[object Object]', '${']) {
        if (html.includes(smell)) bad(label, `HTML 에 "${smell}" 가 남았다`);
    }

    /* 4. head */
    const koUrl = `${BASE}/${slug ? slug + '/' : ''}`;
    const enUrl = `${BASE}/en/${slug ? slug + '/' : ''}`;
    for (const need of [`rel="canonical" href="${BASE}${label}"`,
                        `hreflang="ko" href="${koUrl}"`,
                        `hreflang="en" href="${enUrl}"`,
                        `hreflang="x-default" href="${enUrl}"`,
                        'name="description"', '<title>', ...ICON_LINKS,
                        'href="/shared/base.css"', 'href="/shared/dday.css"',
                        'src="/shared/dday.js"']) {
        if (!html.includes(need)) bad(label, `빠짐: ${need}`);
    }
    const title = (html.match(/<title>([^<]*)<\/title>/) || [])[1] || '';
    if (title.length > 65) soft(label, `title 이 ${title.length}자 — 검색결과에서 잘린다`);
    const desc = (html.match(/name="description" content="([^"]*)"/) || [])[1] || '';
    if (desc.length > 160) soft(label, `description 이 ${desc.length}자 — 잘린다`);

    /* 4.5. 공유 카드. 기대하는 이름을 여기서 따로 짓는다 —
       gen-pages 가 쓴 값을 가져다 쓰면 둘이 같이 틀려도 통과한다.
       og:image 는 절대 주소여야 한다. 상대 주소면 카카오톡·페이스북이 못 읽는다. */
    const wantCard = slug === '' ? 'home' : slug.split('/').join('-');
    cardsUsed.add(wantCard);
    for (const need of [`property="og:image" content="${BASE}/card/${wantCard}.png"`,
                        'property="og:image:width" content="1200"',
                        'property="og:image:height" content="630"',
                        'name="twitter:card" content="summary_large_image"']) {
        if (!html.includes(need)) bad(label, `빠짐: ${need}`);
    }
    if (!((html.match(/property="og:image:alt" content="([^"]*)"/) || [])[1] || '')) {
        bad(label, 'og:image:alt 가 비었다');
    }

    if (isHome) {
        /* 7. 첫 화면 국가 링크 — 같은 언어 칸 안으로만 걸려야 한다 */
        const seen = linkedFromHome[lang];
        for (const m of html.matchAll(
            /<li data-cc="([A-Z]{2})" data-key="[^"]*"><a href="([^"]+)"><img class="flag" src="\/flags\/([a-z]{2})\.svg"/g
        )) {
            seen.add(m[1]);
            const want = `${dir}/${m[1].toLowerCase()}/`;
            if (m[2] !== want) bad(label, `${m[1]} 링크가 ${m[2]} — ${want} 이어야 한다`);
            if (m[3].toUpperCase() !== m[1]) {
                bad(label, `${m[1]} 줄에 ${m[3].toUpperCase()} 국기가 붙었다`);
            }
        }
        const shown = (html.match(/(\d+)(?:개국|\s*countries)/) || [])[1];
        if (shown && +shown !== seen.size) {
            bad(label, `"${shown}" 이라고 적혀 있는데 링크는 ${seen.size}개다`);
        }
        /* 보이는 이름순인가. countries.json 은 한글 이름순으로 저장돼 있어서,
           영어 화면에서 그대로 쓰면 Ghana(가나)가 맨 앞에 오는 무작위 순서가 된다. */
        const shownNames = [...html.matchAll(
            /<li data-cc="[A-Z]{2}" data-key="[^"]*"><a href="[^"]*"><img class="flag"[^>]*><span class="cn">([^<]+)<\/span><span class="cc">/g
        )].map((m) => m[1]);
        if (shownNames.length !== seen.size) {
            bad(label, `국가 목록에서 이름을 ${shownNames.length}개만 읽었다 (링크는 ${seen.size}개)`
                + ' — 검사 무늬가 마크업과 어긋났다');
        }
        const inOrder = [...shownNames].sort((a, b) => a.localeCompare(b, lang));
        if (shownNames.join('|') !== inOrder.join('|')) {
            const at = shownNames.findIndex((n, i) => n !== inOrder[i]);
            bad(label, `국가 목록이 이름순이 아니다 — ${at + 1}번째가 "${shownNames[at]}" (기대 "${inOrder[at]}")`);
        }

        /* 검색칸이 있어야 204줄을 눈으로 훑지 않는다 */
        for (const id of ['csearch', 'clist', 'cnone']) {
            if (!html.includes(`id="${id}"`)) bad(label, `국가 검색에 필요한 #${id} 가 없다`);
        }
        continue;
    }

    /* ------------------------------------------------------------ 하늘 허브
       표를 이고 있지 않다 — 176건을 한 URL 에 몰아 두면 어느 검색어에도 정확히
       대응하지 못해서 갈래로 내렸다. 여기서 볼 것은 셋이다.
       표가 정말 없나(있으면 갈래 페이지와 겹친다) · 세 갈래로 다 링크하나
       (빠지면 그 갈래는 sitemap 에만 있는 쪽이 된다) · 첫 화면과 같은 손잡이를 쓰나. */
    if (kind === 'sky') {
        if (r.dday.isSky) bad(label, 'dday.js 가 허브를 갈래 페이지로 잡았다');
        /* 실제 행은 `<tr data-d="..." data-sky="...">` 다. data-sky 가 <tr 바로
           뒤에 온다고 보면 아무것도 안 잡힌다 — 처음에 그렇게 썼다가 일부러
           깨뜨려 보고서야 알았다. 갈래 쪽 검사와 같은 무늬를 쓴다. */
        const rows = (html.match(/<tr data-d="[\d-]+" data-sky="[a-z]+">/g) || []).length;
        if (rows) bad(label, `허브에 하늘 표 ${rows}행이 있다 — 갈래 페이지와 겹친다`);
        for (const t of Object.keys(SKY_KIND)) {
            const href = `${dir}/${t}/`;
            if (!html.includes(`href="${href}"`)) bad(label, `갈래로 가는 링크가 없다: ${href}`);
        }
        continue;
    }

    /* -------------------------------------------------------- 하늘 갈래 한 장
       국가 축이 아니라 전 세계 공통 축이라 자료가 한 벌이고, 갈리는 것은 날짜뿐이다
       (ko=KST · en=UTC). 여기서는 "표가 그 갈래의 자료와 정확히 같은가" 와 "카드가
       표와 같은 답을 내는가" 를 본다. 자료 자체의 검산은 아래 천문 검산점 칸이 한다. */
    if (SKY_KIND[kind]) {
        if (!r.dday.isSky) bad(label, 'dday.js 가 하늘 페이지로 알아보지 못했다');
        const zone = lang === 'en' ? 'utc' : 'kst';
        const only = SKY_KIND[kind];
        const mine = SKY[SKY_DATA[kind]];

        /* 음력만 다르다 — 시간대가 자료의 일부라(초하루는 "삭이 든 날" 이다)
           ko/en 이 같은 날짜를 본다. 그래서 두 칸이 아니라 s 한 칸이고, 여기서도
           zone 을 묻지 않는다. gen-pages 의 skyDate 와 짝이다. */
        const dateOf = (e) => (e.s !== undefined ? e.s : e[zone]);

        const want = mine.map((e) => `${dateOf(e)}|${only}`);
        const got = [...html.matchAll(/<tr data-d="([\d-]+)" data-sky="([a-z]+)">/g)]
            .map((m) => `${m[1]}|${m[2]}`);
        const sortKey = (a) => [...a].sort().join(',');
        if (sortKey(got) !== sortKey(want)) {
            bad(label, `하늘 표 ${got.length}행 / 자료 ${want.length}건 — 집합이 다르다 (${zone} 기준)`);
        }
        /* 다른 갈래가 새어 들어오면 갈래를 나눈 뜻이 없다 */
        for (const g of got) {
            if (!g.endsWith('|' + only)) { bad(label, `다른 갈래의 행이 섞였다: ${g}`); break; }
        }
        /* 날짜순이어야 한다. 연도 구획이 셋이라 눈으로는 안 보인다. */
        const seq = got.map((x) => x.split('|')[0]);
        if (seq.join(',') !== [...seq].sort().join(',')) bad(label, '하늘 표가 날짜순이 아니다');

        /* 그림 칸. **이름 짓는 규칙을 여기 다시 적는다** — sky-art 의 skyIconOf 를
           가져다 쓰면 그 함수가 틀렸을 때 검사도 같이 틀린다(음력 이름 검사와 같은
           자리다). 절기는 황경 k, 삭·보름은 f, 유성우는 ZHR 층이다. */
        const iconWant = (e) => (only === 'term' ? `term-${String(e.k).padStart(2, '0')}`
            : only === 'moon' ? (e.f ? 'moon-full' : 'moon-new')
                : only === 'shower' ? `meteor-${e.z >= 100 ? 5 : e.z >= 25 ? 3 : 2}`
                    : null);
        {
            const drawn = [...html.matchAll(
                /<tr data-d="([\d-]+)" data-sky="[a-z]+">[\s\S]*?<td class="ico"><img class="sky-icon" src="\/sky-icons\/([a-z0-9-]+)\.svg" width="16" height="16" alt="" loading="lazy" decoding="async"><\/td>/g
            )].map((m) => `${m[1]}|${m[2]}`);
            const wantIcons = mine.map((e) => `${dateOf(e)}|${iconWant(e)}`);

            if (only === 'lunar' || only === 'cal') {
                /* 음력과 달력에는 그림이 없다(sky-art 의 머리말). 어느 날 하나 붙으면
                   같은 그림이 두 갈래에서 다른 뜻으로 읽히기 시작한다. */
                if (drawn.length) bad(label, `${only} 표에 하늘 아이콘이 ${drawn.length}개 있다`);
                if (html.includes('class="ico"')) bad(label, `${only} 표에 그림 칸이 있다 — 빈 칸만 남는다`);
            } else if (drawn.length !== got.length) {
                bad(label, `그림이 ${drawn.length}개다 (행은 ${got.length}개) — 검사 무늬가 마크업과 어긋났거나 칸이 빠졌다`);
            } else {
                const a = [...drawn].sort(), b = [...wantIcons].sort();
                const at = a.findIndex((x, i) => x !== b[i]);
                if (at >= 0) bad(label, `그림이 자료와 어긋난다 — "${a[at]}" (기대 "${b[at]}")`);
            }
            /* 표의 머리와 몸이 갈리면 열이 한 칸씩 밀린다.
               ⚠ 하늘 표만 골라 센다 — 달력 갈래에는 아래에 다른 표(table.wk)가
               둘 더 붙어 있어서, 페이지 전체의 <thead> 를 세면 그 칸수까지 섞인다. */
            const heads = [...html.matchAll(/<table class="sky">[\s\S]*?(<thead><tr>[\s\S]*?<\/tr><\/thead>)/g)]
                .map((m) => m[1]);
            if (!heads.length) bad(label, '하늘 표의 머리를 못 찾았다 — 검사 무늬가 마크업과 어긋났다');
            /* 머리 글자도 본다. 칸수만 세면 달력 표가 "날짜와 시각 / 천문 현상" 이라고
               적혀 있어도 통과한다 — 시각이 없는 표이고 천문 현상도 아니다. 기대값을
               여기 적어 두므로 갈래가 머리를 갈아 끼우는 것을 잊으면 걸린다. */
            const wl = WORDS[lang];
            const wantHead = only === 'cal' ? [wl.thDateOnly, wl.thNewYearDay] : [wl.thTime, wl.thEvent];
            for (const h of heads) {
                const cols = (h.match(/<th>/g) || []).length;
                const wantCols = (only === 'lunar' || only === 'cal') ? 3 : 4;
                if (cols !== wantCols) { bad(label, `표 머리가 ${cols}칸이다 — ${wantCols}칸이어야 한다`); break; }
                const texts = [...h.matchAll(/<th>([\s\S]*?)<\/th>/g)].map((m) => m[1]).filter(Boolean);
                if (texts.join('|') !== wantHead.map(esc).join('|')) {
                    bad(label, `표 머리가 "${texts.join(' / ')}" 다 (기대 "${wantHead.join(' / ')}")`);
                    break;
                }
            }
        }

        /* 분점 둘 · 지점 둘, 해마다 넷 — 절기 페이지에만 있어야 한다 */
        const cardinals = (html.match(/class="cardinal"/g) || []).length;
        const wantCardinals = only === 'term' ? SKY.years.length * 4 : 0;
        if (cardinals !== wantCardinals) {
            bad(label, `분점·지점 배지 ${cardinals}개 / 기대 ${wantCardinals}개`);
        }

        /* 카드. 기대값은 sky.json 에서 여기가 따로 뽑는다 —
           "다음" 은 앞으로 올 것이고 오늘 것은 오늘 칸이 맡는다. */
        const nextOf = (items) => {
            const t = epochDayRef(TODAY);
            let best = null;
            for (const e of items) {
                const d = epochDayRef(dateOf(e)) - t;
                if (d > 0 && (best === null || d < best.d)) best = { e, d };
            }
            return best;
        };
        const w = WORDS[lang];
        const lines = {
            'sky/term': [['#next-term', SKY.terms, (e) => (lang === 'en' ? e.e : e.n)]],
            'sky/moon': [['#next-new', SKY.moons.filter((m) => !m.f), () => w.newMoon],
                         ['#next-full', SKY.moons.filter((m) => m.f), () => w.fullMoon]],
            'sky/meteor': [['#next-shower', SKY.showers, (e) => (lang === 'en' ? e.e : e.n)]],
            /* 음력 달 이름은 자료의 숫자에서 조립된다. gen-pages 의 lunarName 을
               가져다 쓰지 않고 여기 다시 적는다 — 윤달 표시가 빠져도 통과하면
               검사가 아니다. */
            'sky/lunar': [['#next-lunar', SKY.lunar, (e) => (lang === 'en'
                ? `${e.leap ? 'Leap month' : 'Month'} ${e.m}, ${e.y}`
                : `${e.y}년 ${e.leap ? '윤' : ''}${e.m}월`)]],
            /* 달력 카드에는 그 달력의 **새해 이름**(설날 · 노루즈 …)이 들어간다.
               라벨은 원화의 값이라 여기서 가져다 쓴다 — 규칙이 아니라 이름이다. */
            'sky/calendar': [['#next-cal', SKY.cals,
                (e) => (lang === 'en' ? CAL_BY_ID[e.c].nyEn : CAL_BY_ID[e.c].nyKo)]],
        }[kind];

        /* 다른 갈래의 카드 줄이 남아 있으면 안 된다 — 그 줄은 영영 '-' 로 남는다 */
        for (const id of ['next-term', 'next-new', 'next-full', 'next-shower', 'next-lunar', 'next-cal']) {
            const mineIds = lines.map(([sel]) => sel.slice(1));
            if (!mineIds.includes(id) && html.includes(`id="${id}"`)) {
                bad(label, `이 갈래에 없는 카드 줄이 있다: #${id}`);
            }
        }

        for (const [sel, items, name] of lines) {
            const e = nextOf(items);
            const el = r.doc.querySelector(sel);
            const drawn = el ? (el.innerHTML || '') : '';
            if (!drawn) { bad(label, `${sel} 이 비어 있다`); continue; }
            if (!e) {
                if (!drawn.includes(w.outOfRange)) bad(label, `${sel}: 자료가 없는데 무언가를 그렸다`);
                continue;
            }
            if (!drawn.includes(`D-${e.d}<`)) bad(label, `${sel}: D-${e.d} 이 없다 — "${drawn}"`);
            const wantName = esc(name(e.e));
            if (!drawn.includes(wantName)) bad(label, `${sel}: "${wantName}" 이 없다 — "${drawn}"`);
            for (const smell of ['undefined', 'NaN', '[object Object]']) {
                if (drawn.includes(smell)) bad(label, `${sel} 에 "${smell}" 가 있다`);
            }
        }

        /* 오늘 칸 — 이 갈래의 자료만 본다.
           음력만 "아무것도 아닌 날" 의 문안이 다르다 — 초하루가 아닌 날에
           "절기도 삭망도 아닙니다" 라고 적으면 그 페이지에서는 거짓말이다. */
        const now = r.doc.cache.get('#now');
        const verdict = now.querySelector('.verdict').textContent;
        const none = kind === 'sky/lunar' ? w.lunarNone
            : kind === 'sky/calendar' ? w.calNone : w.skyNone;
        const todays = mine.filter((e) => dateOf(e) === TODAY);
        if (!todays.length && verdict !== none) {
            bad(label, `오늘 아무것도 없는데 오늘 칸이 "${verdict}" 다`);
        }
        if (todays.length && !verdict.includes(w.skyOff.trim().replace(/^—\s*/, ''))) {
            bad(label, `오늘 ${todays.length}건인데 오늘 칸이 "${verdict}" 다`);
        }
        continue;
    }

    /* --------------------------------------------------------- 이름 축 한 장
       자료를 하나도 더 만들지 않는 축이라, 검사기가 국가별 파일에서 **자기 손으로
       다시 묶어**(NAME_INDEX) HTML 과 견준다. 묶는 코드를 나눠 쓰지 않으므로
       둘이 같이 틀릴 수 없다 — 이 축의 게이트 4번이 바로 이것이다. */
    if (kind === 'name') {
        const only = slug.slice(NAME_ROOT.length + 1);
        namePagesSeen[lang].add(only);
        if (r.dday.list !== 'name') bad(label, `dday.js 가 이름 축으로 못 알아봤다 (${r.dday.list})`);

        const want = NAME_INDEX.get(only);
        if (!want) { bad(label, `문턱(${MIN}개국)을 넘지 않는 이름인데 페이지가 있다`); continue; }

        const rows = dateRows(html);
        const wantKeys = want.dates.map((x) => `${x.d}|${x.cc.join(',')}`);
        const gotKeys = rows.map((x) => `${x.d}|${ccsIn(x.cell).sort().join(',')}`);
        if (gotKeys.join(' / ') !== wantKeys.join(' / ')) {
            /* 어긋난 나라만 적는다. 한 줄에 176개국이 들어가는 표라서 양쪽을
               통째로 찍으면 실패 메시지가 화면을 덮고 무엇이 틀렸는지 안 보인다. */
            const at = gotKeys.findIndex((k, i) => k !== wantKeys[i]);
            if (at < 0 || rows.length !== want.dates.length) {
                bad(label, `표 ${rows.length}행 / 자료 ${want.dates.length}건 — 날짜 집합이 다르다`);
            } else {
                const g = new Set(ccsIn(rows[at].cell));
                const w2 = new Set(want.dates[at].cc);
                const only = (a, b) => [...a].filter((x) => !b.has(x));
                bad(label, `${want.dates[at].d}: 표에만 있는 나라 [${only(g, w2).join(',') || '없음'}]`
                    + ` · 자료에만 있는 나라 [${only(w2, g).join(',') || '없음'}]`);
            }
        }

        for (const x of rows) {
            const ccs = ccsIn(x.cell);
            /* 칩 앞에 적힌 수와 실제 칩 개수. 갈리면 화면이 조용히 거짓말한다. */
            if (countIn(x.cell) !== ccs.length) {
                bad(label, `${x.d}: "${countIn(x.cell)}" 이라고 적혀 있는데 나라 칩은 ${ccs.length}개다`);
                break;
            }
            const at = inShownOrder(ccs, lang);
            if (at >= 0) {
                bad(label, `${x.d}: 나라가 보이는 이름순이 아니다 — ${at + 1}번째가 "${shownName(ccs[at], lang)}"`);
                break;
            }
        }

        /* 요약 문장 ↔ 자료. 스니펫에 담길 문장이라 갈리면 검색결과에서 거짓말한다.
           기대값은 여기서 다시 센다 — 저쪽 nameFacts() 를 가져오면 같이 틀린다. */
        {
            const mineY = want.dates.filter((x) => x.d.startsWith(String(MID)));
            const cover = new Set();
            for (const x of mineY) for (const c of x.cc) cover.add(c);
            let peak = null;
            for (const x of mineY) if (!peak || x.cc.length > peak.cc.length) peak = x;

            const sum = (html.match(/<p class="sum">([^<]*)<\/p>/) || [])[1] || '';
            if (!sum) bad(label, '요약 문장(<p class="sum">)이 없다');
            const pats = lang === 'ko'
                ? [[`쉬는 나라는 ${cover.size}개국`, '국가 수'],
                   ...(mineY.length > 1 ? [[`${mineY.length}가지`, '날짜 가짓수'],
                                           [`(${peak.cc.length}개국)`, '가장 많은 날']] : [])]
                : [[`${cover.size} countries observe`, '국가 수'],
                   ...(mineY.length > 1 ? [[`${mineY.length} distinct dates`, '날짜 가짓수'],
                                           [`(${peak.cc.length} countries)`, '가장 많은 날']] : [])];
            for (const [needle, what] of pats) {
                if (sum && !sum.includes(needle)) {
                    bad(label, `요약의 ${what} 가 자료와 다르다 — "${needle}" 이 없다: "${sum}"`);
                }
            }
            /* 허브에 적히는 수와 같아야 한다 — 두 페이지가 같은 자료를 다르게 세면
               어느 쪽이 맞는지 방문자는 알 수 없다 */
            if (cover.size !== want.cover) {
                bad(label, `표지 연도 국가 수가 ${cover.size} 인데 허브 기대값은 ${want.cover} 다`);
            }
        }

        /* 실제로 그려진 카드. 위가 자료를 봤다면 여기는 화면을 본다 —
           dday.js 가 표를 읽어 카드로 옮겨 적는 데까지 다녀온 결과다. */
        {
            const dates = want.dates.map((x) => x.d);
            const e = expectRef(dates, TODAY);
            const label2 = (d) => {
                const row = want.dates.find((x) => x.d === d);
                return lang === 'en' ? `${row.cc.length} countries` : `${row.cc.length}개국`;
            };
            for (const [key, got2, sign] of [['next', e.next, '-'], ['prev', e.prev, '+']]) {
                const el = r.doc.querySelector('#' + key);
                const drawn = el ? (el.innerHTML || '') : '';
                if (!drawn) { bad(label, `#${key} 이 비어 있다`); continue; }
                if (!got2) {
                    if (!drawn.includes(WORDS[lang].outOfRange)) bad(label, `#${key}: 자료가 없는데 무언가를 그렸다`);
                    continue;
                }
                if (!drawn.includes(`D${sign}${Math.abs(got2.diff)}<`)) {
                    bad(label, `#${key}: D${sign}${Math.abs(got2.diff)} 이 없다 — "${drawn}"`);
                }
                if (!drawn.includes(label2(got2.d))) {
                    bad(label, `#${key}: "${label2(got2.d)}" 이 없다 — 나라 칩이 카드로 쏟아졌나: "${drawn.slice(0, 120)}"`);
                }
            }
        }
        continue;
    }

    /* --------------------------------------------------------- 이름 축 허브
       이름으로 보내는 자리이면서 **날짜 축**으로 뒤집은 표를 하나 이고 있다.
       둘을 따로 견준다 — 링크 쪽이 맞아도 표가 틀릴 수 있다. */
    if (kind === 'holiday') {
        if (r.dday.list !== 'hub') bad(label, `dday.js 가 허브로 못 알아봤다 (${r.dday.list})`);

        /* 링크 — 문턱을 넘는 이름 전부로, 국가 수까지 적혀 있어야 한다 */
        const linked = [...html.matchAll(
            new RegExp(`<li><a href="[^"]*/${NAME_ROOT}/([a-z0-9-]+)/">([^<]*)`
                + '(?:<span class="en">[^<]*</span>)?<span class="cc">([^<]*)</span>', 'g')
        )].map((m) => ({ slug: m[1], shown: m[2], count: m[3] }));

        const missing = [...NAME_INDEX.keys()].filter((s) => !linked.some((l) => l.slug === s));
        const extra = linked.filter((l) => !NAME_INDEX.has(l.slug)).map((l) => l.slug);
        if (missing.length) bad(label, `허브에서 링크되지 않는 이름 ${missing.length}개: ${missing.slice(0, 5).join(', ')}`);
        if (extra.length) bad(label, `이름 축에 없는 링크 ${extra.length}개: ${extra.slice(0, 5).join(', ')}`);

        for (const l of linked) {
            const e = NAME_INDEX.get(l.slug);
            if (!e) continue;
            const wantCount = lang === 'en' ? String(e.cover) : `${e.cover}개국`;
            if (l.count !== wantCount) bad(label, `${l.slug} 의 국가 수가 "${l.count}" 다 (기대 "${wantCount}")`);
            const wantShown = lang === 'en' ? e.en : e.ko;
            if (l.shown !== esc(wantShown)) bad(label, `${l.slug} 에 적힌 이름이 "${l.shown}" 다 (기대 "${esc(wantShown)}")`);
        }
        /* 국가 수 내림차순 — 흔한 이름이 위로 와야 목록이 읽힌다 */
        const counts = linked.map((l) => NAME_INDEX.get(l.slug)?.cover ?? -1);
        for (let i = 1; i < counts.length; i++) {
            if (counts[i] > counts[i - 1]) { bad(label, `이름 목록이 국가 수 내림차순이 아니다 — ${i + 1}번째(${linked[i].slug})`); break; }
        }

        /* 함께 쉬는 날 — 날짜 축으로 다시 센 값과 견준다 */
        const rows = dateRows(html);
        const gotT = rows.map((x) => `${x.d}|${countIn(x.cell)}`);
        const wantT = TOGETHER_REF.map((x) => `${x.d}|${x.n}`);
        if (gotT.join(' / ') !== wantT.join(' / ')) {
            const at = gotT.findIndex((k, i) => k !== wantT[i]);
            bad(label, `함께 쉬는 날 표 ${rows.length}행 / 기대 ${TOGETHER_REF.length}건 — `
                + (at < 0 ? '집합이 다르다' : `${at + 1}번째가 "${gotT[at]}" (기대 "${wantT[at]}")`));
        }
        /* 허브 표에는 나라 칩이 없어야 한다 — 44일 × 최대 197개국이면 페이지가 죽는다 */
        for (const x of rows) {
            if (ccsIn(x.cell).length) { bad(label, `허브 표에 나라 칩이 있다 (${x.d})`); break; }
        }
        continue;
    }

    /* ------------------------------------------------------------ 요일 축 한 장
       자료를 하나도 더 만들지 않는 축이라, 이름 축과 같이 **검사기가 자기 손으로
       다시 세어**(WK_REF) HTML 과 견준다. 묶는 코드를 나눠 쓰지 않으므로 둘이
       같이 틀릴 수 없다 — 이 축의 게이트 4번이 바로 이것이다. */
    if (kind === 'weekday') {
        if (r.dday.list !== 'weekday') bad(label, `dday.js 가 요일 축으로 못 알아봤다 (${r.dday.list})`);

        /* table.wk 넷 — 요일 분포 · 주말 종류 · 해별 · 이름별. 국가 표는 table.rank 다.
           ⚠ 순서가 곧 인덱스다. 주말 종류 표를 해별 앞에 끼우면서 한 칸씩 밀렸고,
           그 순간 해별 검사가 엉뚱한 표를 읽어 터졌다 — 개수를 먼저 보는 이유다. */
        const wkTables = [...html.matchAll(/<table class="wk">([\s\S]*?)<\/table>/g)].map((m) => m[1]);
        if (wkTables.length !== 4) bad(label, `요일 표가 ${wkTables.length}개다 — 넷이어야 한다`);

        /* 머리 줄(<thead>)을 함께 잡지 않도록 <tbody> 안만 본다. 처음에 <tr> 을
           통째로 훑었더니 머리 줄이 칸 0개로 들어와 첫 검사에서 터졌다. */
        const cellsOf = (body) => {
            const tb = /<tbody>([\s\S]*?)<\/tbody>/.exec(body);
            return [...(tb ? tb[1] : '').matchAll(/<tr>([\s\S]*?)<\/tr>/g)]
                .map((m) => [...m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)]
                    .map((c) => c[1].replace(/<[^>]*>/g, '').trim()))
                .filter((cells) => cells.length);
        };

        /* ① 요일 분포 일곱 줄 — 건수·비율·배수를 다 견준다 */
        if (wkTables[0]) {
            const rows = cellsOf(wkTables[0]);
            if (rows.length !== 7) bad(label, `요일 분포가 ${rows.length}줄이다 — 일곱이어야 한다`);
            rows.forEach((c, i) => {
                const want = WK_REF.dist[i];
                if (+c[1] !== want) bad(label, `${i}번 요일이 ${c[1]}건이다 (기대 ${want})`);
                const wantPct = (Math.round(want / WK_REF.days * 1000) / 10).toFixed(1);
                if (!c[2].startsWith(wantPct)) bad(label, `${i}번 요일 비율이 "${c[2]}" 다 (기대 ${wantPct}%)`);
                const wantX = (Math.round(want / (WK_REF.days / 7) * 100) / 100).toFixed(2);
                if (!c[3].startsWith(wantX) && !c[3].includes(wantX)) {
                    bad(label, `${i}번 요일 배수가 "${c[3]}" 다 (기대 ${wantX})`);
                }
            });
            /* 표의 합이 각주가 말하는 날짜 수와 같아야 한다 — 두 페이지가 같은 단위를 쓴다 */
            const sum = rows.reduce((a, c) => a + (+c[1] || 0), 0);
            if (sum !== WK_REF.days) bad(label, `요일 표의 합이 ${sum} 이다 (기대 ${WK_REF.days})`);
        }

        /* ② 주말 종류 — 이 지표의 전제다. 토·일 말고 다른 주말이 실제로 있어야 한다. */
        if (wkTables[1]) {
            const rows = cellsOf(wkTables[1]);
            if (rows.length !== WK_REF.wknds.length) {
                bad(label, `주말 종류가 ${rows.length}줄이다 (기대 ${WK_REF.wknds.length})`);
            }
            rows.forEach((c, i) => {
                const w = WK_REF.wknds[i];
                if (!w) return;
                if (+c[1] !== w.n) bad(label, `주말 종류 ${i + 1}줄이 ${c[1]}개국이다 (기대 ${w.n})`);
            });
            const sum = rows.reduce((a, c) => a + (+c[1] || 0), 0);
            if (sum !== WK_REF.total) bad(label, `주말 종류의 합이 ${sum}개국이다 (기대 ${WK_REF.total})`);
        }

        /* ③ 해별 표 — 주말 겹침이 해마다 흔들리는 것이 이 페이지의 축이다 */
        if (wkTables[2]) {
            const rows = cellsOf(wkTables[2]);
            if (rows.length !== WK_REF.years.length) {
                bad(label, `해별 표가 ${rows.length}줄이다 (기대 ${WK_REF.years.length})`);
            }
            rows.forEach((c, i) => {
                const y = WK_REF.years[i];
                if (!y) return;
                if (+c[0] !== y.y) bad(label, `해별 ${i + 1}줄이 ${c[0]} 년이다 (기대 ${y.y})`);
                if (+c[1] !== y.n) bad(label, `${y.y}년 날짜 수가 ${c[1]} 이다 (기대 ${y.n})`);
                if (!c[2].startsWith(String(y.we))) bad(label, `${y.y}년 주말 겹침이 "${c[2]}" 다 (기대 ${y.we})`);
                const wantPct = (Math.round(y.we / y.n * 1000) / 10).toFixed(1);
                if (!c[3].startsWith(wantPct)) bad(label, `${y.y}년 비율이 "${c[3]}" 다 (기대 ${wantPct}%)`);
            });
        }

        /* ④ 이름별 표 — 걸치는 요일 수가 1 이면 요일이 정의에 박힌 것이다 */
        if (wkTables[3]) {
            const rows = cellsOf(wkTables[3]);
            rows.forEach((c, i) => {
                const w = WK_REF.names[i];
                if (!w) { bad(label, `이름 표 ${i + 1}줄이 기대 밖이다`); return; }
                const shown = lang === 'en' ? w.en : w.ko;
                if (c[0] !== esc(shown)) bad(label, `이름 표 ${i + 1}줄이 "${c[0]}" 다 (기대 "${esc(shown)}")`);
                if (+c[1] !== w.n) bad(label, `"${shown}" 이 ${c[1]}건이다 (기대 ${w.n})`);
                if (!c[2].startsWith(String(w.spans))) {
                    bad(label, `"${shown}" 의 걸치는 요일이 "${c[2]}" 다 (기대 ${w.spans})`);
                }
            });
            /* 이름 축으로 가는 링크가 실제로 있는 슬러그를 가리키나 */
            for (const m of wkTables[3].matchAll(/href="([^"]*\/holiday\/([a-z0-9-]+)\/)"/g)) {
                if (!NAME_INDEX.has(m[2])) bad(label, `이름 표의 링크가 없는 이름을 가리킨다: ${m[2]}`);
                if (m[1].startsWith('/en/') !== (lang === 'en')) {
                    bad(label, `이름 표의 링크가 다른 언어 칸으로 간다: ${m[1]}`);
                }
            }
        }

        /* ⑤ 국가 표 셋 — 주말 안 겹침 · 많이 겹침 · 월요일 많음 */
        const plain = [...html.matchAll(/<table class="rank">([\s\S]*?)<\/table>/g)].map((m) => m[1]);
        const want = [
            ['주말 안 겹침', WK_REF.clean, (c) => `${c.we} / ${c.n}`],
            ['주말 많이 겹침', WK_REF.worst, (c) => `${c.we} / ${c.n}`],
            ['월요일 많음', WK_REF.mondays, (c) => `${c.w[1]} / ${c.n}`],
        ];
        if (plain.length !== want.length) {
            bad(label, `국가 표가 ${plain.length}개다 — ${want.length}개여야 한다`);
        }
        plain.forEach((body, i) => {
            const [what, rows, valueOf] = want[i] || [];
            if (!rows) return;
            const got2 = rankRowsOf(body);
            if (got2.length !== rows.length) {
                bad(label, `${what} 표가 ${got2.length}행이다 (기대 ${rows.length})`); return;
            }
            got2.forEach((g, j) => {
                const w2 = rows[j];
                if (g.no !== j + 1) bad(label, `${what} ${j + 1}번째 순위가 ${g.no} 다`);
                if (g.cc !== w2.code) bad(label, `${what} ${j + 1}번째가 ${g.cc} 다 (기대 ${w2.code})`);
                if (g.flagCc !== g.cc) bad(label, `${what} ${g.cc} 줄에 ${g.flagCc} 국기가 붙었다`);
                if (g.cell.replace(/\s/g, '') !== valueOf(w2).replace(/\s/g, '')) {
                    bad(label, `${what} ${g.cc} 의 값이 "${g.cell}" 다 (기대 "${valueOf(w2)}")`);
                }
                if (g.shown !== esc(shownName(w2.code, lang))) {
                    bad(label, `${what} ${g.cc} 에 적힌 이름이 "${g.shown}" 다`);
                }
            });
        });

        /* ⑥ 요약과 각주가 나르는 수치 — 쏠림의 정체를 적어 둔 자리다 */
        {
            const plainText = html.replace(/<[^>]*>/g, ' ');
            for (const [what, v] of [
                ['날짜 수', WK_REF.days],
                ['나라 수', WK_REF.total],
                ['최다 요일 건수', Math.max(...WK_REF.dist)],
                ['최소 요일 건수', Math.min(...WK_REF.dist)],
                ['주말 겹침', WK_REF.we],
                ['1월 1일 나라 수', WK_REF.fixed[0].n],
                ['12월 25일 나라 수', WK_REF.fixed[1].n],
            ]) {
                if (!new RegExp(`\\b${v}\\b`).test(plainText)) {
                    bad(label, `${what} ${v} 가 페이지에 없다 — 문안이 자료와 갈렸다`);
                }
            }
        }
        continue;
    }

    /* ---------------------------------------------------- 나라끼리 견주기 한 장
       표가 넷인데 셋은 열이 같고(순위·국가·값) 하나는 구간이다. 넷 다 국가별
       파일에서 다시 센 값(RANK_REF)과 견준다. */
    if (kind === 'rank') {
        if (r.dday.list !== 'rank') bad(label, `dday.js 가 순위 페이지로 못 알아봤다 (${r.dday.list})`);

        const plain = [...html.matchAll(/<table class="rank">([\s\S]*?)<\/table>/g)].map((m) => m[1]);
        const want = [
            ['공휴일 많은 나라', RANK_REF.most, (c) => c.n],
            ['공휴일 적은 나라', RANK_REF.least, (c) => c.n],
            ['연휴 많은 나라', RANK_REF.busiest, (c) => c.breaks],
        ];
        if (plain.length !== want.length) {
            bad(label, `순위 표가 ${plain.length}개다 — ${want.length}개여야 한다`);
        }
        plain.forEach((body, i) => {
            const [what, rows, valueOf] = want[i] || [];
            if (!rows) return;
            const got2 = rankRowsOf(body);
            if (got2.length !== rows.length) { bad(label, `${what} 표가 ${got2.length}행이다 (기대 ${rows.length})`); return; }
            got2.forEach((g, j) => {
                const w2 = rows[j];
                if (g.no !== j + 1) bad(label, `${what} ${j + 1}번째 순위가 ${g.no} 다`);
                if (g.cc !== w2.code) bad(label, `${what} ${j + 1}번째가 ${g.cc} 다 (기대 ${w2.code})`);
                if (g.flagCc !== g.cc) bad(label, `${what} ${g.cc} 줄에 ${g.flagCc} 국기가 붙었다`);
                const num = (/(\d+)/.exec(g.cell) || [])[1];
                if (+num !== valueOf(w2)) bad(label, `${what} ${g.cc} 의 값이 ${num} 이다 (기대 ${valueOf(w2)})`);
                if (g.shown !== esc(shownName(w2.code, lang))) {
                    bad(label, `${what} ${g.cc} 에 적힌 이름이 "${g.shown}" 다 (기대 "${esc(shownName(w2.code, lang))}")`);
                }
            });
        });

        const spans = [...html.matchAll(
            /<tr data-s="([\d-]+)" data-e="([\d-]+)">\s*<td class="no">(\d+)<\/td>\s*<td class="who"><img class="flag" src="\/flags\/[a-z]{2}\.svg"[^>]*><a href="[^"]*\/([a-z]{2})\/">/g
        )].map((m) => ({ s: m[1], e: m[2], no: +m[3], cc: m[4].toUpperCase() }));
        const wantSpans = RANK_REF.longest;
        const key = (x) => `${x.cc}|${x.s}|${x.e}`;
        if (spans.map(key).join(' / ') !== wantSpans.map((x) => `${x.code}|${x.s}|${x.e}`).join(' / ')) {
            bad(label, `최장 연휴 표 ${spans.length}행 / 기대 ${wantSpans.length}건 — 집합이나 순서가 다르다`);
        }
        /* 표가 길이 내림차순인가. 순위를 적어 두고 정렬이 틀리면 그게 가장 나쁘다. */
        for (let i = 1; i < wantSpans.length; i++) {
            if (wantSpans[i].n > wantSpans[i - 1].n) { bad(label, '최장 연휴 기대값 자체가 내림차순이 아니다'); break; }
        }
        /* 담긴 나라 수를 각주에 적어 두었다 — 자료와 갈리면 사이트가 거짓말한다 */
        const shownTotal = (html.match(/(\d+)개국에 대해|all (\d+) countries/) || []).filter(Boolean)[1];
        if (shownTotal && +shownTotal !== RANK_REF.total) {
            bad(label, `각주에 "${shownTotal}개국" 이라 적혀 있는데 자료는 ${RANK_REF.total}개국이다`);
        }
        continue;
    }

    /* ---------------------------------------------------- 국가 페이지 본문 */
    const cc = (html.match(/<body data-cc="([A-Z]{2})">/) || [])[1];
    if (!cc) { bad(label, '<body data-cc="XX"> 가 없다 — dday.js 가 국가 페이지로 못 알아본다'); continue; }
    if (cc.toLowerCase() !== slug) bad(label, `data-cc="${cc}" 가 경로 ${label} 와 다르다`);

    const src = join(DATA, `${cc}.json`);
    if (!existsSync(src)) { bad(label, `자료가 없다: data/${cc}.json`); continue; }
    const data = JSON.parse(readFileSync(src, 'utf8'));

    /* 5. HTML 표 ↔ JSON */
    const rowDates = [...html.matchAll(/<tr data-d="(\d{4}-\d{2}-\d{2})">/g)].map((m) => m[1]);
    const jsonDates = data.days.map((d) => d.d);
    if (rowDates.length !== jsonDates.length) {
        bad(label, `표 행 ${rowDates.length}개 / 자료 ${jsonDates.length}건`);
    }
    if (rowDates.join(',') !== jsonDates.join(',')) {
        bad(label, '표의 날짜 순서·집합이 자료와 다르다');
    }
    /* 5.2. 요약 문장 ↔ 자료
       빌드 타임에 확정된 사실을 HTML 에 박아 두었다. 스니펫에 담길 문장이라
       자료와 갈라지면 사이트가 검색결과에서 조용히 거짓말을 한다.

       **기대값을 여기서 다시 센다.** gen-pages 의 facts() 를 가져다 쓰면 둘이 같이
       틀려도 통과한다 — 이 저장소가 늘 경계하는 그 함정이다. 세는 규칙도 저쪽과
       같은 말로 적어 둔다: 표지 연도로 거르고, 연휴 수는 Nager 가 준 구간을 그대로
       (같은 명절에 대해 여러 벌 주는 것까지) 센다 — 표에 찍히는 것과 같아야 한다. */
    {
        const y = String(coverYear(data));
        const days = data.days.filter((d) => d.d.startsWith(y));
        const breaks = (data.long || []).filter((w) => w.s.startsWith(y));
        let longest = 0;
        for (const w of breaks) {
            const n = epochDayRef(w.e) - epochDayRef(w.s) + 1;
            if (n > longest) longest = n;
        }
        const weekend = days.filter((d) => {
            const w = new Date(d.d + 'T00:00:00Z').getUTCDay();
            return w === 0 || w === 6;
        }).length;

        const sum = (html.match(/<p class="sum">([^<]*)<\/p>/) || [])[1] || '';
        if (!sum) bad(label, '요약 문장(<p class="sum">)이 없다');
        else {
            /* **숫자를 문맥에 붙여 본다.** 처음에는 "그 숫자가 문장 어딘가에 있나" 로
               썼는데 KR 요약의 "(2월 14~18일)" 이 공휴일 수 18 을 대신 물어 줘서,
               18 을 19 로 바꿔도 통과했다. 일부러 깨뜨려 보고서야 알았다.

               말을 여기 다시 적는 것은 WORDS 와 같은 방식이다 — 문안을 다듬으면
               검사가 시끄럽게 깨지는 쪽이 맞다. 조용히 통과하는 것보다 낫다. */
            const pats = lang === 'ko'
                ? [[`공휴일은 ${days.length}일`, '공휴일 수'],
                   [`그중 ${weekend}일이 주말`, '주말 겹침'],
                   ...(longest ? [[`구간은 ${breaks.length}번`, '연휴 횟수'],
                                  [`${longest}일(`, '가장 긴 연휴']] : [])]
                : [[`has ${days.length} public holidays`, '공휴일 수'],
                   [`${weekend} of which fall on a weekend`, '주말 겹침'],
                   ...(longest ? [[`are ${breaks.length} long weekends`, '연휴 횟수'],
                                  [`runs ${longest} days`, '가장 긴 연휴']] : [])];
            for (const [want, what] of pats) {
                if (!sum.includes(want)) bad(label, `요약의 ${what} 가 자료와 다르다 — "${want}" 이 없다: "${sum}"`);
            }
            for (const smell of ['undefined', 'NaN', 'null']) {
                if (sum.includes(smell)) bad(label, `요약에 "${smell}" 가 있다 — "${sum}"`);
            }
        }

        /* description 도 같은 사실을 나른다. 여기서 갈라지면 검색결과와 화면이
           서로 다른 말을 한다.

           **뽑아서 견준다 — 있나 없나로 보지 않는다.** description 은 160자를 넘으면
           뒤쪽 절이 통째로 빠지도록 fit 을 사슬로 걸어 두었다(국가명이 44자인 곳이
           있다). 그래서 "이 문구가 있어야 한다" 로 쓰면 정상적으로 빠진 절까지
           실패로 잡는다. 절이 있으면 그 숫자가 맞아야 한다, 로 쓴다.

           처음에는 공휴일 수와 연휴 길이만 봤는데, 그러면 연휴 횟수를 틀려도
           조용했다 — 일부러 깨뜨려 보고서야 알았다. */
        const d = (html.match(/name="description" content="([^"]*)"/) || [])[1] || '';
        const dPats = lang === 'ko'
            ? [[/공휴일 (\d+)일/, days.length, '공휴일 수'],
               [/가장 긴 연휴는 (?:.*?)?(\d+)일입니다/, longest, '가장 긴 연휴'],
               [/구간은 (\d+)번/, breaks.length, '연휴 횟수']]
            : [[/^(\d+) public holidays/, days.length, '공휴일 수'],
               [/Longest break: (\d+) days/, longest, '가장 긴 연휴'],
               [/(\d+) long weekends/, breaks.length, '연휴 횟수']];
        for (const [re, want, what] of dPats) {
            const m = d.match(re);
            if (m && +m[1] !== want) {
                bad(label, `description 의 ${what} 가 ${m[1]} 이다 — 자료는 ${want} — "${d}"`);
            }
        }
        /* 공휴일 수는 절이 빠질 자리가 아니다. 이것만은 반드시 있어야 한다. */
        if (!dPats[0][0].test(d)) bad(label, `description 에 공휴일 수가 없다 — "${d}"`);
    }

    const localInHtml = (html.match(/class="local"/g) || []).length;
    const localInJson = data.days.filter((d) => d.r).length;
    if (localInHtml !== localInJson) {
        bad(label, `지역 한정 배지 ${localInHtml}개 / 자료 ${localInJson}건`);
    }

    /* 5.5. 황금연휴 — 자료가 스스로 앞뒤가 맞나, 그리고 HTML 이 그 자료와 같나.
       자료 검사를 여기(페이지 순회) 안에서 하는 이유는 두 언어가 같은 파일을
       보므로 두 번 도는데, 그게 오히려 "두 페이지가 같은 자료를 봤다" 를 뜻하기
       때문이다. 국가 하나가 두 번 걸리는 값싼 검사다. */
    if (!Array.isArray(data.long)) {
        bad(label, `data/${cc}.json 에 long 이 없다 — 자료가 낡았다 (gen-holidays.mjs)`);
    } else {
        const holidays = new Set(data.days.map((d) => d.d));
        let prevStart = '';
        for (const w of data.long) {
            const where = `${cc} ${w.s}~${w.e}`;
            if (!/^\d{4}-\d{2}-\d{2}$/.test(w.s) || !/^\d{4}-\d{2}-\d{2}$/.test(w.e)) {
                bad(label, `연휴 날짜 모양이 아니다: ${where}`); continue;
            }
            const span = spanRef(w.s, w.e);
            if (span.length < 3) bad(label, `연휴가 ${span.length}일이다 — 3일 미만: ${where}`);
            /* 표에 없는 공휴일에 걸린 연휴는 페이지 안에서 앞뒤가 안 맞는다 */
            if (!span.some((d) => holidays.has(d))) {
                bad(label, `공휴일에 걸리지 않은 연휴: ${where}`);
            }
            for (const b of w.b || []) {
                if (!span.includes(b)) bad(label, `징검다리 ${b} 가 연휴 밖이다: ${where}`);
                if (holidays.has(b)) bad(label, `징검다리 ${b} 가 공휴일이다: ${where}`);
            }
            if (w.s < prevStart) bad(label, `연휴가 시작일순이 아니다: ${where}`);
            prevStart = w.s;
        }
        const keys = data.long.map((w) => `${w.s}|${w.e}`);
        if (new Set(keys).size !== keys.length) bad(label, '같은 연휴가 두 번 들어 있다');

        /* HTML ↔ 자료 */
        const htmlBreaks = [...html.matchAll(/<tr data-s="([\d-]+)" data-e="([\d-]+)">/g)]
            .map((m) => `${m[1]}|${m[2]}`);
        if (htmlBreaks.join(',') !== keys.join(',')) {
            bad(label, `연휴 표 ${htmlBreaks.length}행 / 자료 ${keys.length}건 — 집합이나 순서가 다르다`);
        }
        const bridgeInHtml = (html.match(/class="bridge"/g) || []).length;
        const bridgeInJson = data.long.filter((w) => w.b?.length).length;
        if (bridgeInHtml !== bridgeInJson) {
            bad(label, `징검다리 배지 ${bridgeInHtml}개 / 자료 ${bridgeInJson}건`);
        }
        /* 연휴가 없으면 카드 줄도 섹션도 없어야 한다 — 빈 표만 남으면 그게 더 나쁘다 */
        const hasLine = html.includes('id="break"');
        if (hasLine !== data.long.length > 0) {
            bad(label, data.long.length
                ? '연휴 자료가 있는데 카드에 #break 줄이 없다'
                : '연휴가 0건인데 카드에 #break 줄이 있다');
        }
    }

    /* 6. 고정 날짜로 분류 대조 */
    const got = r.dday.classify(jsonDates.map((d) => ({ d })), PROBE);
    const want = expectRef(jsonDates, PROBE);
    if (got.todays.length !== want.todays.length) {
        bad(label, `${PROBE} 기준 오늘 ${got.todays.length}건 / 기대 ${want.todays.length}건`);
    }
    const gotNext = got.next ? got.next.item.d : null;
    const gotPrev = got.prev ? got.prev.item.d : null;
    if (gotNext !== (want.next && want.next.d)) {
        bad(label, `${PROBE} 기준 다음 공휴일 ${gotNext} / 기대 ${want.next && want.next.d}`);
    }
    if (gotPrev !== (want.prev && want.prev.d)) {
        bad(label, `${PROBE} 기준 지난 공휴일 ${gotPrev} / 기대 ${want.prev && want.prev.d}`);
    }
    if (got.next && got.next.diff <= 0) bad(label, '다음 공휴일의 D-day 가 양수가 아니다');
    if (got.prev && got.prev.diff >= 0) bad(label, '지난 공휴일의 D-day 가 음수가 아니다');

    /* 6.5. 실제로 그려진 오늘 카드. 위 5·6 이 자료를 봤다면 여기는 화면을 본다 —
       dday.js 가 표를 읽고 카드에 옮겨 적는 데까지 다녀온 결과다. */
    const now = r.doc.cache.get('#now');
    const drawn = {
        asof: now.querySelector('.asof').textContent,
        verdict: now.querySelector('.verdict').textContent,
        next: r.doc.querySelector('#next').innerHTML,
        prev: r.doc.querySelector('#prev').innerHTML,
    };
    const want2 = expectRef(jsonDates, TODAY);
    /* 영어 페이지는 영어 이름을 앞세운다 — 생성기·클라이언트와 같은 규칙이어야 한다.
       두 번째 이름(다른 언어)도 카드에 붙어야 한다. 敬老の日 만 있으면 무슨 날인지
       알 수 없어서 넣은 것이라, 붙는지까지 본다. */
    const dayAt = (d) => data.days.find((x) => x.d === d) || {};
    const nameAt = (d) => {
        const day = dayAt(d);
        return lang === 'en' ? (day.e || day.n) : day.n;
    };
    const subAt = (d) => {
        const day = dayAt(d);
        return lang === 'en' ? (day.e ? day.n : '') : (day.e || '');
    };

    if (!drawn.asof.includes(String(new Date().getFullYear()))) {
        bad(label, `기준 날짜 문안이 이상하다: "${drawn.asof}"`);
    }
    const w = WORDS[lang];
    const full = (d) => nameAt(d) + (subAt(d) ? ` (${subAt(d)})` : '');
    const wantVerdict = want2.todays.length
        ? want2.todays.map(full).join(' · ') +
            (want2.todays.every((d) => dayAt(d).r) ? w.partial : w.off)
        : w.noHoliday;
    if (drawn.verdict !== wantVerdict) {
        bad(label, `오늘 카드 문안 "${drawn.verdict}" / 기대 "${wantVerdict}"`);
    }
    for (const [key, e, sign] of [['next', want2.next, '-'], ['prev', want2.prev, '+']]) {
        const html2 = drawn[key];
        if (!e) {
            if (!html2.includes(w.outOfRange)) bad(label, `${key}: 자료가 없는데 무언가를 그렸다`);
            continue;
        }
        if (!html2.includes(`D${sign}${Math.abs(e.diff)}<`)) {
            bad(label, `${key}: D${sign}${Math.abs(e.diff)} 이 없다 — "${html2}"`);
        }
        /* 카드는 이름을 이스케이프해서 넣는다 — 필리핀 공휴일처럼 따옴표가 든
           이름이 있어서, 날것으로 견주면 멀쩡한 카드를 틀렸다고 한다 */
        const wantName = esc(nameAt(e.d) || '');
        if (wantName && !html2.includes(wantName)) {
            bad(label, `${key}: 공휴일 이름 "${wantName}" 이 카드에 없다 — "${html2}"`);
        }
        const wantSub = esc(subAt(e.d) || '');
        if (wantSub && !html2.includes(`<span class="sub">${wantSub}</span>`)) {
            bad(label, `${key}: 다른 언어 이름 "${wantSub}" 이 카드에 없다 — "${html2}"`);
        }
    }
    for (const smell of ['undefined', 'NaN', '[object Object]']) {
        for (const [k, v] of Object.entries(drawn)) {
            if (v.includes(smell)) bad(label, `오늘 카드 ${k} 에 "${smell}" 가 있다`);
        }
    }

    /* 6.6. 연휴 줄과 연휴 표가 실제로 그려진 결과.
       공휴일 쪽 D-day 는 하루 기준이지만 연휴는 구간이라 갈림길이 셋이다 —
       셋 다 지나가는지 보려면 오늘 하나로는 모자라서, 고정 날짜로 한 번 더 본다. */
    if (Array.isArray(data.long) && data.long.length) {
        const e = expectBreak(data.long, TODAY);
        const line = r.doc.querySelector('#break');
        const drawnBreak = line ? (line.innerHTML || '') : '';
        if (!drawnBreak) {
            bad(label, '연휴 줄이 비어 있다 — paintNow 가 #break 를 안 채웠다');
        } else if (!e) {
            /* 자료가 3년치라 "앞으로도 연휴가 없다" 는 연말에만 나온다 */
            if (!drawnBreak.includes(w.noBreak)) bad(label, `연휴 줄: "${drawnBreak}"`);
        } else {
            const head = e.phase === 'now' ? w.breakNow : `D-${e.diff}<`;
            if (!drawnBreak.includes(head)) {
                bad(label, `연휴 줄에 ${head} 가 없다 — "${drawnBreak}"`);
            }
            if (!drawnBreak.includes(esc(w.breakLen(e.days)))) {
                bad(label, `연휴 줄에 "${w.breakLen(e.days)}" 가 없다 — "${drawnBreak}"`);
            }
        }
        for (const smell of ['undefined', 'NaN', '[object Object]']) {
            if (drawnBreak.includes(smell)) bad(label, `연휴 줄에 "${smell}" 가 있다`);
        }

        /* 표의 D-day. 고정 날짜(PROBE)로 다시 돌려 세 갈림길을 모두 지나가게 한다.
           하니스의 행 객체를 직접 먹이므로 배포되는 코드 그대로가 돈다. */
        const t = epochDayRef(PROBE);
        const marks = r.dday.classifyBreaks(
            r.doc.breaks.map((tr) => ({
                s: tr.getAttribute('data-s'), e: tr.getAttribute('data-e'),
            })), PROBE);
        if (marks.marked.length !== data.long.length) {
            bad(label, `연휴 행 ${marks.marked.length}개 / 자료 ${data.long.length}건 (하니스)`);
        }
        for (const m of marks.marked) {
            const s = epochDayRef(m.item.s), en = epochDayRef(m.item.e);
            const want = t < s ? 'next' : t > en ? 'past' : 'now';
            if (m.phase !== want) {
                bad(label, `${PROBE} 에 ${m.item.s}~${m.item.e} 가 ${m.phase} (기대 ${want})`);
            }
            if (m.days !== en - s + 1) bad(label, `${m.item.s}~${m.item.e} 일수가 ${m.days} 다`);
        }
        const ongoing = marks.marked.filter((m) => m.phase === 'now');
        if (marks.now && marks.now !== ongoing[0]) bad(label, '연휴 중 판정이 첫 구간이 아니다');
        if (!marks.now && marks.next) {
            const nearest = Math.min(...marks.marked
                .filter((m) => m.phase === 'next').map((m) => m.diff));
            if (marks.next.diff !== nearest) bad(label, `다음 연휴가 가장 가깝지 않다 (D-${marks.next.diff} / 가장 가까운 D-${nearest})`);
        }
        if (marks.upcoming !== (marks.now || marks.next)) bad(label, 'upcoming 이 now/next 와 다르다');
    }
}

/* -------------------------------------------------- 7. 목록 ↔ 페이지 1:1 */
const indexCodes = new Set(JSON.parse(readFileSync(join(DATA, 'countries.json'), 'utf8'))
    .map((c) => c.code));
const dirCodes = new Set(COUNTRY.map((p) => p.slug.toUpperCase()));   /* EXTRA 는 COUNTRY 에 없다 */
const dataCodes = new Set(countryFiles().map((f) => f.replace('.json', '')));

const diff = (a, b) => [...a].filter((x) => !b.has(x));
for (const [what, missing] of [
    ['countries.json 에 있는데 페이지가 없다', diff(indexCodes, dirCodes)],
    ['페이지는 있는데 countries.json 에 없다', diff(dirCodes, indexCodes)],
    ['자료는 있는데 페이지가 없다', diff(dataCodes, dirCodes)],
    ['한국어 첫 화면에서 링크되지 않는다', diff(dirCodes, linkedFromHome.ko)],
    ['영어 첫 화면에서 링크되지 않는다', diff(dirCodes, linkedFromHome.en)],
]) {
    if (missing.length) bad('/', `${what}: ${missing.slice(0, 8).join(', ')}${missing.length > 8 ? ` 외 ${missing.length - 8}개` : ''}`);
}

/* --------------------------------------------- 7.2. 이름 축 ↔ 페이지 1:1
   이름 축은 자료가 개수를 정한다. 문턱을 넘는 이름과 페이지가 1:1 이 아니면
   한쪽은 유령이다 — 링크만 있고 페이지가 없거나, sitemap 에만 있는 쪽이 된다. */
{
    const want = new Set(NAME_INDEX.keys());
    for (const lang of ['ko', 'en']) {
        const got = namePagesSeen[lang];
        const missing = [...want].filter((s) => !got.has(s));
        const extra = [...got].filter((s) => !want.has(s));
        if (missing.length) bad('/', `문턱을 넘는데 ${lang} 페이지가 없다: ${missing.slice(0, 5).join(', ')}`);
        if (extra.length) bad('/', `${lang} 페이지는 있는데 문턱을 못 넘는다: ${extra.slice(0, 5).join(', ')}`);
    }
    /* 슬러그가 국가 코드와 부딪히면 국가 페이지를 조용히 덮어쓴다 */
    for (const s of want) {
        if (!NAME_PAGE.test(`${NAME_ROOT}/${s}`)) bad('/', `이름 축 슬러그 모양이 아니다: '${s}'`);
        if (indexCodes.has(s.toUpperCase())) bad('/', `이름 축 슬러그 '${s}' 가 국가 코드와 부딪힌다`);
    }
    /* 원화에 적힌 라벨이 남아 있는지. 이름이 하나 빠져도 60개 중 하나라
       눈으로는 안 보인다 — 최소 개수를 박아 둔다. */
    const FLOOR = 40;
    if (want.size < FLOOR) {
        bad('/', `이름 축이 ${want.size}개뿐이다 — ${FLOOR}개 이상이어야 한다. 자료나 문턱(MIN)을 확인할 것.`);
    } else {
        console.log(`이름 축 ${want.size}개 · 함께 쉬는 날 ${TOGETHER_REF.length}일 대조\n`);
    }
}

/* ----------------------------------------------------- 7.5. 공유 카드 파일
   카카오톡·슬랙·트위터가 읽는 그림이다. og:image 만 있고 파일이 없으면 빈 카드가
   뜨는데, 그건 사이트를 열어 봐서는 안 보인다 — 검사 말고 잡을 데가 없다.

   **1200×630 을 card-art.mjs 에서 들여오지 않고 여기 따로 적는다.** 생성기가 쓰는
   값을 그대로 가져오면 둘이 같이 틀려도 통과한다. 이 숫자는 우리가 정한 것이 아니라
   소셜 미리보기가 요구하는 바깥 사실이라 여기 박는 것이 맞다. 페이지 쪽은 HTML 에
   적힌 수를, 여기서는 PNG 머리의 수를 본다 — 둘이 갈라지면 한쪽에서 걸린다. */
{
    const NAME = 'card';
    const WANT_W = 1200, WANT_H = 630;
    const dir = join(PUB, NAME);

    /* gen-pages 의 청소가 두 글자 디렉터리를 통째로 지운다. 'og' 로 옮기면
       빌드마다 조용히 사라지므로, 이름이 두 글자가 되는 순간 여기서 멈춘다. */
    if (/^[a-z]{2}$/.test(NAME) || EXTRA.includes(NAME)) {
        bad('/', `카드 디렉터리 이름 '${NAME}' 이 국가 코드나 EXTRA 와 부딪힌다`);
    }

    if (!existsSync(dir)) {
        bad('/', `${NAME}/ 이 없다 — node tools/gen-card.mjs`);
    } else {
        for (const name of [...cardsUsed].sort()) {
            const at = `/${NAME}/${name}.png`;
            const file = join(dir, `${name}.png`);
            if (!existsSync(file)) { bad(at, '페이지가 가리키는데 파일이 없다 — node tools/gen-card.mjs'); continue; }
            const size = pngSize(readFileSync(file));
            if (!size) { bad(at, 'PNG 가 아니다'); continue; }
            if (size.width !== WANT_W || size.height !== WANT_H) {
                bad(at, `${size.width}×${size.height} 다 — ${WANT_W}×${WANT_H} 이어야 한다`);
            }
        }
        /* 어느 페이지도 안 가리키는 카드는 국가가 빠진 흔적이다 */
        for (const f of readdirSync(dir).filter((f) => f.endsWith('.png'))) {
            if (!cardsUsed.has(f.replace(/\.png$/, ''))) bad(`/${NAME}/${f}`, '어느 페이지도 가리키지 않는다');
        }
    }
}

/* ------------------------------------------------------------- 7.7. 국기
   글꼴과 같은 자리다 — 남의 오리진을 물지 않으려고 받아서 커밋해 두었으니,
   페이지가 가리키는 파일이 실제로 있고 나라와 1:1 인지 여기서 본다.
   og:image 처럼 없어도 페이지는 뜨고 그림만 깨지므로 검사 말고 잡을 데가 없다. */
{
    const dir = join(PUB, 'flags');
    if (!existsSync(dir)) {
        bad('/flags/', '없다 — node tools/gen-flags.mjs');
    } else {
        const have = new Set(readdirSync(dir));
        const want = new Set([...indexCodes].map((cc) => `${cc.toLowerCase()}.svg`));
        const missing = [...want].filter((f) => !have.has(f));
        const orphan = [...have].filter((f) => f.endsWith('.svg') && !want.has(f));
        if (missing.length) bad('/flags/', `나라는 있는데 국기가 없다 ${missing.length}개: ${missing.slice(0, 8).join(', ')}`);
        if (orphan.length) bad('/flags/', `나라가 없는 국기 ${orphan.length}개: ${orphan.slice(0, 8).join(', ')}`);

        /* MIT 는 저작권 표시와 허가문을 함께 배포하라고 한다. 글꼴의
           /fonts/LICENSE.txt 와 같은 조건이라 같은 방식으로 지킨다. */
        if (!have.has('LICENSE.txt')) bad('/flags/', 'LICENSE.txt 이 없다 — MIT 고지를 함께 실어야 한다');
        else {
            const lic = readFileSync(join(dir, 'LICENSE.txt'), 'utf8');
            if (!/MIT/i.test(lic) || !/flag-icons/.test(lic)) {
                bad('/flags/LICENSE.txt', '고지 내용이 이상하다 — MIT · flag-icons 가 적혀 있어야 한다');
            }
        }

        /* 내용까지 본다. 받아 온 것이 404 HTML 이면 페이지에서 그림만 깨진다. */
        let checked = 0;
        for (const f of [...want].sort()) {
            if (!have.has(f)) continue;
            const body = readFileSync(join(dir, f), 'utf8');
            if (!/<svg[\s>]/.test(body) || !body.includes('</svg>')) {
                bad(`/flags/${f}`, 'SVG 가 아니다');
                break;
            }
            checked++;
        }
        if (checked && checked !== indexCodes.size) {
            bad('/flags/', `${checked}개만 확인됐다 / 나라 ${indexCodes.size}개`);
        }
    }
}

/* ------------------------------------------------------- 7.8. 하늘 아이콘
   국기와 같은 자리지만 받아 온 것이 아니라 `tools/sky-art.mjs` 가 그린 것이다.
   그래서 볼 것이 하나 더 있다 — 원화 자체가 성립하나(상자를 넘지 않나, 스물넷이
   한 자리에 몰리지 않았나). 파일 쪽은 국기와 같다: 원화와 1:1 이고 내용이 같나. */
{
    const wrong = skyArtWrong();
    for (const w of wrong.slice(0, 8)) bad('sky-art.mjs', w);

    const want = new Map(Object.entries(ICONS).map(([n, b]) => [`${n}.svg`, b]));
    if (!existsSync(ICON_PATH)) {
        bad(`/${ICON_DIR}/`, '없다 — node tools/gen-sky-icons.mjs');
    } else {
        const have = new Set(readdirSync(ICON_PATH));
        const missing = [...want.keys()].filter((f) => !have.has(f));
        const orphan = [...have].filter((f) => !want.has(f));
        if (missing.length) bad(`/${ICON_DIR}/`, `원화에는 있는데 파일이 없다 ${missing.length}개: ${missing.slice(0, 8).join(', ')}`);
        if (orphan.length) bad(`/${ICON_DIR}/`, `원화에 없는 그림 ${orphan.length}개: ${orphan.slice(0, 8).join(', ')}`);
        /* 내용까지 본다. 원화를 고치고 gen-sky-icons 를 안 돌리면 파일 이름은
           그대로라 위 두 검사가 조용히 통과한다 — 그 자리를 여기서 막는다. */
        for (const [f, body] of want) {
            if (!have.has(f)) continue;
            if (readFileSync(join(ICON_PATH, f), 'utf8') !== body) {
                bad(`/${ICON_DIR}/${f}`, '원화와 다르다 — node tools/gen-sky-icons.mjs');
                break;
            }
        }
    }
}

/* ---------------------------------------------------------- 8. sitemap */
const smFile = join(PUB, 'sitemap.xml');
if (!existsSync(smFile)) {
    soft('/', 'sitemap.xml 이 없다 — node tools/gen-sitemap.mjs 를 아직 안 돌렸다');
} else {
    const sm = readFileSync(smFile, 'utf8');
    const locs = new Set([...sm.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]));
    const want = new Set(ALL.map((p) => `${BASE}/${p.page ? p.page + '/' : ''}`));
    const only = (a, b) => [...a].filter((x) => !b.has(x));
    if (only(want, locs).length) bad('/sitemap.xml', `빠진 URL ${only(want, locs).length}개`);
    if (only(locs, want).length) bad('/sitemap.xml', `없는 페이지의 URL ${only(locs, want).length}개`);
    if (!/<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/.test(sm)) bad('/sitemap.xml', 'lastmod 형식이 이상하다');
    /* hreflang 세 줄은 url 마다 있어야 한다 — 한쪽만 있으면 구글이 통째로 버린다 */
    for (const tag of ['hreflang="ko"', 'hreflang="en"', 'hreflang="x-default"']) {
        const n = (sm.match(new RegExp(tag, 'g')) || []).length;
        if (n !== locs.size) bad('/sitemap.xml', `${tag} 가 ${n}개 — url ${locs.size}개와 다르다`);
    }
}

/* -------------------------------------------------------- 9. 지역 감지 */
{
    const cases = [
        [['ko-KR'], 'KR'], [['en-US', 'en'], 'US'], [['ja-JP'], 'JP'],
        [['ko'], 'KR'],                                  /* 지역 없는 태그도 maximize 로 */
        [['xx-ZZ'], null],                               /* 우리가 모르는 지역 */
    ];
    const known = [...indexCodes];
    for (const [langs, want] of cases) {
        const home = boot('', { languages: langs });
        const got = home.dday.detect(known);
        if (got !== want) bad('/', `지역 감지: ${langs.join(',')} → ${got} (기대 ${want})`);
    }

    /* 홈은 늘 내 지역이어야 한다.
       이라크 공휴일을 한 번 구경했다고 홈이 계속 이라크가 되면 안 된다 —
       예전에는 국가 페이지를 여는 것만으로 localStorage 에 기억해서 그랬다.
       무엇이 담겨 있든 화면이 흔들리지 않는지 본다. */
    for (const junk of [
        { 'dday.country': 'IQ' },
        { 'dday.country': 'US' },
        { 'dday.lastCountry': 'IQ', anything: 'else' },
    ]) {
        const home = boot('', { languages: ['ko-KR'], storage: junk });
        const got = home.dday.detect(known);
        if (got !== 'KR') {
            bad('/', `저장된 값(${JSON.stringify(junk)})이 지역 감지를 바꿨다 → ${got}`);
        }
    }
}

/* --------------------------------------- 첫 화면이 실제로 그리는 것
   fetch 는 약속(promise)이라 boot 이 돌아온 시점에는 아직 안 끝났다 —
   한 틱 넘겨 밀린 미소작업을 흘려보낸 뒤에 본다. 두 언어를 다 본다. */
for (const [page, lang, langs, wantCc] of [
    ['', 'ko', ['ko-KR'], 'KR'],
    ['en', 'en', ['en-US', 'en'], 'US'],
]) {
    const label = '/' + (page ? page + '/' : '');
    const dir = lang === 'en' ? '/en' : '';
    const r = boot(page, { languages: langs });
    await new Promise((res) => setImmediate(res));

    const asked = r.fetched.filter((u) => /\/data\/[A-Z]{2}\.json$/.test(u));
    if (!asked.length) {
        bad(label, '첫 화면이 국가 자료를 받지 않았다 — 요약 카드가 안 뜬다');
    } else if (!asked.some((u) => u.endsWith(`/${wantCc}.json`))) {
        bad(label, `${langs[0]} 인데 ${asked[0]} 를 받았다 — ${wantCc}.json 이어야 한다`);
    }
    if (!r.fetched.some((u) => u.endsWith(`/month/${TODAY.slice(0, 7)}.json`))) {
        bad(label, '이번 달 색인을 받지 않았다 — 오늘 쉬는 나라가 안 뜬다');
    }

    /* 선택기를 dday.js 가 채운 결과. 204개라 정렬이 틀리면 반드시 드러난다 —
       "오늘 쉬는 나라" 목록도 같은 방식으로 정렬하는데 그쪽은 하루 두어 곳뿐이라
       어떤 날에는 틀려도 티가 안 난다. 여기서 대신 붙잡는다. */
    {
        const filled = r.doc.pickerList.innerHTML || '';
        const n = (filled.match(/<li /g) || []).length;
        if (n !== indexCodes.size) {
            bad(label, `선택기에 ${n}개가 찼다 / 기대 ${indexCodes.size}개`);
        }
        const order = [...filled.matchAll(/<span class="cn">([^<]+)<\/span>/g)].map((m) => m[1]);
        /* **뽑은 개수를 먼저 본다.** 이 무늬가 마크업과 어긋나면 order 가 빈 배열이
           되고, 빈 배열은 늘 "정렬돼 있다" 로 통과한다 — 국기를 <img> 로 옮기면서
           실제로 그렇게 죽어 있었고 검사는 조용히 통과했다. */
        if (order.length !== n) {
            bad(label, `선택기에서 이름을 ${order.length}개만 읽었다 (줄은 ${n}개) — 검사 무늬가 마크업과 어긋났다`);
        }
        const want = [...order].sort((a, b) => a.localeCompare(b, lang));
        if (order.join('|') !== want.join('|')) {
            const at = order.findIndex((x, i) => x !== want[i]);
            bad(label, `선택기가 이름순이 아니다 — ${at + 1}번째가 "${order[at]}" (기대 "${want[at]}")`);
        }
        if (!filled.includes(`href="${dir}/kr/"`)) bad(label, `선택기 링크가 ${dir} 칸을 안 쓴다`);

        /* 국기는 dday.js 가 자기 손으로 조립한다 — tools/ 를 import 할 수 없어서
           크기와 경로를 두 벌 들고 있는 유일한 자리다. 그 두 벌이 갈라지지 않았나,
           그리고 국기와 링크가 같은 나라를 가리키나 본다. */
        const drawnFlags = [...filled.matchAll(
            /<img class="flag" src="\/flags\/([a-z]{2})\.svg" width="20" height="15" alt="" loading="lazy" decoding="async"><span class="cn">[^<]*<\/span><span class="cc">([A-Z]{2})<\/span>/g
        )];
        if (drawnFlags.length !== n) {
            bad(label, `선택기 국기가 ${drawnFlags.length}개다 (줄은 ${n}개) — dday.js 의 flag() 가 HTML 쪽과 다른 모양을 낸다`);
        }
        for (const m of drawnFlags) {
            if (m[1].toUpperCase() !== m[2]) { bad(label, `선택기 국기(${m[1]})와 코드(${m[2]})가 다르다`); break; }
        }
    }

    /* "오늘 공휴일인 나라" 가 실제로 무엇을 그리는지. 기대값은 달 색인에서
       여기가 따로 뽑는다 — 나라 수, 나라 이름, 공휴일 이름까지 견준다. */
    {
        const monthFile = join(DATA, 'month', `${TODAY.slice(0, 7)}.json`);
        const rows = existsSync(monthFile)
            ? (JSON.parse(readFileSync(monthFile, 'utf8')).d[TODAY] || [])
            : [];
        const names = Object.fromEntries(
            JSON.parse(readFileSync(join(DATA, 'countries.json'), 'utf8'))
                .map((c) => [c.code, lang === 'en' ? c.name : c.ko]));

        const drawnList = r.doc.querySelector('#tlist').innerHTML || '';
        const note = r.doc.querySelector('#tnote');
        const cap = r.doc.querySelector('#tcap');

        if (!rows.length) {
            if (drawnList) bad(label, '오늘 공휴일인 나라가 없는데 목록을 그렸다');
            if (note.hidden) bad(label, '빈 날인데 안내 문구를 숨겼다');
        } else {
            const shown = (drawnList.match(/<li>/g) || []).length;
            if (shown !== rows.length) bad(label, `오늘 쉬는 나라 ${shown}줄 / 기대 ${rows.length}곳`);
            if (!note.hidden) bad(label, '목록을 그려 놓고 안내 문구를 안 숨겼다');
            if (!cap.textContent.includes(String(rows.length))) {
                bad(label, `머리말에 나라 수가 없다: "${cap.textContent}"`);
            }
            for (const h of rows) {
                const who = esc(names[h.c] || '');
                const what = esc(lang === 'en' ? (h.e || h.n) : h.n);
                if (who && !drawnList.includes(`>${who}</a>`)) bad(label, `오늘 목록에 "${who}" 가 없다`);
                if (!drawnList.includes(what)) bad(label, `오늘 목록에 "${what}" 가 없다`);
                if (!drawnList.includes(`href="${dir}/${h.c.toLowerCase()}/"`)) {
                    bad(label, `오늘 목록의 ${h.c} 링크가 ${dir} 칸을 안 쓴다`);
                }
            }
            /* 보이는 이름순 */
            const order = [...drawnList.matchAll(/">([^<]+)<\/a><\/span>/g)].map((m) => m[1]);
            const want = [...order].sort((a, b) => a.localeCompare(b, lang));
            if (order.join('|') !== want.join('|')) bad(label, '오늘 목록이 이름순이 아니다');
        }
        for (const smell of ['undefined', 'NaN', '[object Object]']) {
            if (drawnList.includes(smell)) bad(label, `오늘 목록에 "${smell}" 가 있다`);
        }
    }

    /* 첫 화면의 하늘 칸. /sky/ 로 가는 유일한 입구라 여기가 비면 하늘 페이지는
       sitemap 에만 있고 아무도 못 찾는 쪽이 된다.
       기대값은 sky.json 에서 여기가 따로 뽑고, 하늘 페이지 카드와 **같은 규칙**을
       쓴다 — 두 화면이 같은 날 다른 답을 내면 안 된다. */
    {
        const zone = lang === 'en' ? 'utc' : 'kst';
        const w = WORDS[lang];
        const t = epochDayRef(TODAY);
        const nextOf = (items) => {
            let best = null;
            for (const e of items) {
                const d = epochDayRef(e[zone]) - t;
                if (d > 0 && (best === null || d < best.d)) best = { e, d };
            }
            return best;
        };
        const drawnSky = r.doc.querySelector('#skylist').innerHTML || '';
        if (!drawnSky) bad(label, '하늘 칸이 비어 있다 — /sky/ 로 가는 입구가 없다');

        const rows = (drawnSky.match(/<li>/g) || []).length;
        if (rows !== 4) bad(label, `하늘 칸이 ${rows}줄 — 절기·삭·보름·유성우 넷이어야 한다`);

        /* 그림이 앞, 갈래 이름이 그 뒤, D-day 는 다음 칸. 순서가 뒤집히면
           "D-10다음 절기" 가 된다. 그림 이름은 여기서 다시 짓는다 — 갈래 페이지의
           표와 같은 규칙이어야 첫 화면과 /sky/ 가 같은 그림을 보인다. */
        for (const [items, kind, dt, name] of [
            [SKY.terms, 'term', w.dtTerm, (e) => (lang === 'en' ? e.e : e.n)],
            [SKY.moons.filter((m) => !m.f), 'moon', w.dtNew, () => w.newMoon],
            [SKY.moons.filter((m) => m.f), 'moon', w.dtFull, () => w.fullMoon],
            [SKY.showers, 'shower', w.dtShower, (e) => (lang === 'en' ? e.e : e.n)],
        ]) {
            const e = nextOf(items);
            if (!e) {
                if (!drawnSky.includes(`<span class="who">`)) bad(label, `하늘 칸에 "${dt}" 줄이 없다`);
                continue;
            }
            const ico = kind === 'term' ? `term-${String(e.e.k).padStart(2, '0')}`
                : kind === 'moon' ? (e.e.f ? 'moon-full' : 'moon-new')
                    : `meteor-${e.e.z >= 100 ? 5 : e.e.z >= 25 ? 3 : 2}`;
            const who = `<span class="who"><img class="sky-icon" src="/sky-icons/${ico}.svg"`
                + ` width="16" height="16" alt="" loading="lazy" decoding="async">${esc(dt)}</span>`;
            if (!drawnSky.includes(who)) {
                bad(label, `하늘 칸의 "${dt}" 줄이 ${ico} 그림을 앞에 달고 있지 않다`);
            }
            if (!drawnSky.includes(`D-${e.d}<`)) bad(label, `하늘 칸에 D-${e.d} 이 없다`);
            if (!drawnSky.includes(esc(name(e.e)))) bad(label, `하늘 칸에 "${name(e.e)}" 이 없다`);
        }

        /* 국기와 똑같이 두 벌을 들고 있는 자리다 — dday.js 는 브라우저가 받는
           파일이라 tools/sky-art.mjs 를 import 할 수 없다. 그 두 벌이 같은 글자를
           내는지 스물아홉 가지 모두에 대해 견준다. */
        for (const [kind, e] of [
            ...Array.from({ length: 24 }, (_, k) => ['term', { k }]),
            ['moon', { f: 0 }], ['moon', { f: 1 }],
            /* 층의 경계를 걸치는 수로 본다. 가운데 값(50 · 10)만 넣으면 문턱이
               한 칸 옮겨져도 두 벌이 여전히 같은 답을 내서 조용히 통과한다. */
            ...[150, 100, 99, 25, 24, 0].map((z) => ['shower', { z }]),
        ]) {
            const mineImg = skyIconImg(skyIconOf(kind, e));
            const theirs = r.dday.skyIcon(kind, e);
            if (mineImg !== theirs) {
                bad(label, `dday.js 의 하늘 아이콘이 HTML 쪽과 다르다 — "${theirs}" (기대 "${mineImg}")`);
                break;
            }
        }
        /* 음력은 그림이 없다. dday.js 쪽에서만 하나 생기면 첫 화면과 표가 갈린다. */
        if (r.dday.skyIcon('lunar', {}) !== '') bad(label, 'dday.js 가 음력에도 그림을 준다');
        for (const smell of ['undefined', 'NaN', '[object Object]']) {
            if (drawnSky.includes(smell)) bad(label, `하늘 칸에 "${smell}" 가 있다`);
        }
        const homeHtml = readFileSync(join(PUB, page, "index.html"), "utf8");
        if (!homeHtml.includes(`href="${dir}/sky/"`)) bad(label, `첫 화면에 ${dir}/sky/ 링크가 없다`);
    }

    /* 카드가 실제로 어떤 문자열을 그리는지 본다. 스텁은 셀렉터마다 같은 객체를
       돌려주므로 #home 의 innerHTML 을 그대로 읽을 수 있다. */
    const card = r.doc.querySelector('#home');
    const drawn = card.innerHTML || '';
    if (!drawn) {
        bad(label, '요약 카드가 비어 있다 — renderHomeCard 가 안 돌았다');
    } else {
        if (card.hidden) bad(label, '요약 카드를 그려 놓고 hidden 을 안 풀었다');
        for (const smell of ['undefined', 'NaN', '[object Object]']) {
            if (drawn.includes(smell)) bad(label, `요약 카드에 "${smell}" 가 있다`);
        }
        const wantName = lang === 'en' ? 'United States' : '대한민국';
        for (const need of ['class="asof"', wantName,
                            `${dir}/${wantCc.toLowerCase()}/`]) {
            if (!drawn.includes(need)) bad(label, `요약 카드에 빠짐: ${need}`);
        }

        /* 판정 칸은 쉬는 날이면 class 가 'verdict rest' 로 늘어난다. 그래서
           'class="verdict"' 를 문자열로 찾으면 공휴일 당일에만 터진다 —
           실제로 미국 노동절에 /en/ 이 터졌다. 어느 쪽이어야 하는지까지 본다.
           rest 는 dday.js 의 verdictOf 와 같은 규칙이다: 오늘이 있고, 그게
           전부 local(일부 지역만 쉼)은 아닐 때. */
        const src = JSON.parse(readFileSync(join(DATA, `${wantCc}.json`), 'utf8'));
        const todays = src.days.filter((x) => x.d === TODAY);
        const wantRest = todays.length > 0 && !todays.every((x) => x.local);
        const wantClass = `class="verdict${wantRest ? ' rest' : ''}"`;
        if (!drawn.includes(wantClass)) {
            const got = (drawn.match(/class="verdict[^"]*"/) || ['없음'])[0];
            bad(label, `요약 카드의 판정 칸이 ${got} — ${wantClass} 여야 한다`
                     + ` (${TODAY} 의 ${wantCc} 공휴일 ${todays.length}건)`);
        }
        if (!/D[-+]\d+/.test(drawn)) bad(label, '요약 카드에 D-day 숫자가 없다');

        /* 다음·지난 공휴일의 이름과 다른 언어 이름까지. 국가 페이지 카드와 같은
           내용을 그려야 하는데, 예전에 첫 화면만 조용히 빠뜨린 적이 있다. */
        const got2 = expectRef(src.days.map((d) => d.d), TODAY);
        for (const e of [got2.next, got2.prev]) {
            if (!e) continue;
            const day = src.days.find((x) => x.d === e.d) || {};
            const primary = lang === 'en' ? (day.e || day.n) : day.n;
            const sub = lang === 'en' ? (day.e ? day.n : '') : (day.e || '');
            if (primary && !drawn.includes(esc(primary))) {
                bad(label, `요약 카드에 "${primary}" 가 없다`);
            }
            if (sub && !drawn.includes(`<span class="sub">${esc(sub)}</span>`)) {
                bad(label, `요약 카드에 다른 언어 이름 "${sub}" 이 없다`);
            }
        }

        /* 연휴 줄. 국가 페이지 카드에는 있는데 첫 화면만 조용히 빠진 적이 있어
           같은 자료로 같은 답이 나오는지 본다. */
        const w = WORDS[lang];
        const e = expectBreak(src.long || [], TODAY);
        if (!src.long?.length) {
            if (drawn.includes(`<dt>${w.dtBreak}</dt>`)) {
                bad(label, '연휴 자료가 없는데 요약 카드가 연휴 줄을 그렸다');
            }
        } else if (!drawn.includes(`<dt>${w.dtBreak}</dt>`)) {
            bad(label, `요약 카드에 "${w.dtBreak}" 줄이 없다`);
        } else if (!e) {
            if (!drawn.includes(w.noBreak)) bad(label, '연휴 줄이 없다');
        } else {
            const head = e.phase === 'now' ? w.breakNow : `D-${e.diff}<`;
            if (!drawn.includes(head)) bad(label, `요약 카드 연휴 줄에 ${head} 가 없다`);
            if (!drawn.includes(esc(w.breakLen(e.days)))) {
                bad(label, `요약 카드에 "${w.breakLen(e.days)}" 가 없다`);
            }
        }
    }
}

/* --------------------------------------------------- 날짜 색인 대조
   data/month/*.json 은 국가별 파일을 날짜로 다시 색인한 것이다. 같은 자료를 두 벌
   들고 있으니 갈라질 수 있다 — 한 건이라도 어긋나면 "오늘 쉬는 나라" 가 조용히
   틀린다. 양쪽을 (날짜, 국가, 이름) 으로 통째로 견준다. */
{
    const MONTHS = join(DATA, 'month');
    if (!existsSync(MONTHS)) bad('/data/month/', '없다 — node tools/gen-holidays.mjs 를 돌릴 것');
    else {
        const fromCountry = new Set();
        for (const f of countryFiles()) {
            const d = JSON.parse(readFileSync(join(DATA, f), 'utf8'));
            for (const day of d.days) fromCountry.add(`${day.d}|${d.code}|${day.n}`);
        }

        const fromMonth = new Set();
        for (const f of readdirSync(MONTHS)) {
            const m = JSON.parse(readFileSync(join(MONTHS, f), 'utf8'));
            if (f !== `${m.m}.json`) bad('/data/month/' + f, `안에 적힌 달이 ${m.m} 이다`);
            for (const [date, rows] of Object.entries(m.d)) {
                if (!date.startsWith(m.m)) bad('/data/month/' + f, `${date} 는 이 달이 아니다`);
                for (const h of rows) fromMonth.add(`${date}|${h.c}|${h.n}`);
            }
        }

        const only = (a, b) => [...a].filter((x) => !b.has(x));
        const missing = only(fromCountry, fromMonth);
        const extra = only(fromMonth, fromCountry);
        if (missing.length) bad('/data/month/', `국가 파일엔 있는데 달 색인엔 없다 ${missing.length}건: ${missing.slice(0, 3).join(' / ')}`);
        if (extra.length) bad('/data/month/', `달 색인에만 있다 ${extra.length}건: ${extra.slice(0, 3).join(' / ')}`);

        /* 오늘 달이 있어야 첫 화면이 답을 낸다 */
        if (!existsSync(join(MONTHS, `${TODAY.slice(0, 7)}.json`))) {
            bad('/data/month/', `이번 달(${TODAY.slice(0, 7)}) 파일이 없다 — 자료가 낡았다`);
        }
    }
}

/* ------------------------------------------------- 천문 자료의 검산점
   여기가 하늘 페이지의 게이트다. 절기·삭망은 **우리가 직접 계산한 것**이라
   "받은 대로 찍혔나" 로는 아무것도 검사되지 않는다. 두 번째 점이 필요하다.

   그 점이 이미 저장소 안에 있다 — Nager 에서 온 공휴일 자료다. 완전히 다른
   경로로 들어온 값이고 우리 계산을 전혀 모른다.

     · 일본은 春分の日 · 秋分の日 를 **실제 천문 분점**(일본 표준시)으로 정한다
     · 음력 1월 1일은 **삭이 있는 날**이다 (그 나라 달력 표준시 기준)
     · 음력 8월 15일은 삭이 있는 날 + 14일이다

   대체공휴일이 있는 명절은 뺐다 — 계산일이 일요일이면 월요일로 밀려서
   검산점이 아니라 요일 검사가 된다. (부처님오신날 2026 이 그렇다.) */
{
    const anchors = [
        { cc: 'JP', re: /春分/, tz: 'Asia/Tokyo', kind: 'term', k: 0, what: '춘분' },
        { cc: 'JP', re: /秋分/, tz: 'Asia/Tokyo', kind: 'term', k: 12, what: '추분' },
        { cc: 'CN', re: /Spring Festival|春节/i, tz: 'Asia/Shanghai', kind: 'new', off: 0, what: '음력 1월 1일' },
        { cc: 'HK', re: /農曆年初一/, tz: 'Asia/Hong_Kong', kind: 'new', off: 0, what: '음력 1월 1일' },
        { cc: 'HK', re: /中秋節翌日/, tz: 'Asia/Hong_Kong', kind: 'new', off: 15, what: '음력 8월 16일' },
        { cc: 'KR', re: /^추석$/, tz: 'Asia/Seoul', kind: 'new', off: 14, what: '음력 8월 15일' },
        { cc: 'SG', re: /Chinese New Year/i, tz: 'Asia/Singapore', kind: 'new', off: 0, what: '음력 1월 1일' },
    ];

    /* 순간을 그 나라 시간대의 날짜로. sky.json 이 굳혀 둔 kst/utc 를 쓰지 않고
       t(UTC 순간)에서 여기가 따로 뽑는다 — 굳히는 쪽이 틀렸다면 그것도 잡힌다. */
    const inZone = (iso, tz) => new Intl.DateTimeFormat('en-CA', {
        timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date(iso));
    const shift = (iso, n) =>
        new Date(Date.parse(iso + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);

    let points = 0;
    for (const a of anchors) {
        const file = join(DATA, `${a.cc}.json`);
        if (!existsSync(file)) { soft('/data/sky.json', `검산점 ${a.cc} 자료가 없다`); continue; }
        const days = JSON.parse(readFileSync(file, 'utf8')).days
            .filter((h) => a.re.test(h.n) || a.re.test(h.e || ''));
        if (!days.length) {
            soft('/data/sky.json', `검산점을 못 찾았다 — ${a.cc} ${a.what} (Nager 가 이름을 바꿨나)`);
            continue;
        }

        for (const year of SKY.years) {
            const holiday = days.map((h) => h.d).filter((d) => d.startsWith(String(year)));
            if (!holiday.length) continue;

            const mine = a.kind === 'term'
                ? SKY.terms.filter((e) => e.k === a.k)
                    .map((e) => inZone(e.t, a.tz))
                    .filter((d) => d.startsWith(String(year)))
                : SKY.moons.filter((e) => !e.f)
                    .map((e) => shift(inZone(e.t, a.tz), a.off));

            const hit = holiday.filter((d) => mine.includes(d));
            points++;
            if (hit.length !== 1) {
                bad('/data/sky.json',
                    `검산점 어긋남 — ${a.cc} ${year} ${a.what}: 공휴일 ${holiday.join(',')} / 계산 ${
                        hit.length ? '중복 ' + hit.join(',') : '해당 없음'}`);
            }
        }
    }

    /* 검산점이 통째로 사라지는 것이 가장 나쁘다 — 이름이 바뀌면 위에서 조용히
       건너뛰고 검사는 통과한다. 최소 개수를 박아 둔다. */
    const FLOOR = 15;
    if (points < FLOOR) {
        bad('/data/sky.json', `검산점이 ${points}개뿐이다 — ${FLOOR}개 이상이어야 한다. 앵커 공휴일 이름을 확인할 것.`);
    } else {
        console.log(`천문 검산점 ${points}개 (일본 분점 · 음력 명절) 대조\n`);
    }
}

/* ------------------------------------------------- 다른 달력의 검산점
   `sky.json` 의 `cals` 는 ICU(CLDR 달력 표)에서 받아 굳힌 값이다. "받은 대로
   찍혔나" 만 보면 훑기가 새해를 하루 놓쳐도 조용히 통과한다 — 두 번째 점이 필요하다.
   네 가지를 서로 다른 곳에서 가져온다.

     ① 그 날이 정말 그 달력의 1월 1일인가   ICU 에 **다른 질문**을 던진다. 훑기는
        "표시가 바뀌는 날" 을 찾았고, 이건 "월·일이 1/1인가" 다. 하루 밀리면 갈린다
     ② 노루즈가 분점과 맞나              `sky-fixture.mjs` 의 **손으로 적은 공표 시각**
        에 테헤란 정오 규칙을 얹는다. 우리 VSOP87D 도, ICU 도 모르는 제3의 값이다
     ③ 설날이 우리 음력과 맞나            우리가 직접 계산한 `lunar` 의 1월 초하루와
        ICU 의 단기 새해가 같아야 한다 — 완전히 다른 두 구현이다
     ④ 연호력의 차이가 상수인가           1월 1일 하루만 보면 상수인 척하기 쉽다.
        3년치를 열흘 간격으로 훑는다 */
{
    const P = '/data/sky.json';
    const cals = SKY.cals || [];
    if (!cals.length) bad(P, 'cals 가 비어 있다');

    /* 원화에 실린 달력이 모두 자료에 있나 — 하나가 조용히 빠지면 표만 짧아진다 */
    for (const c of NY_CALS) {
        const n = cals.filter((r) => r.c === c.id).length;
        if (n < SKY.years.length) bad(P, `${c.id} 의 새해가 ${n}개 — ${SKY.years.length}개 이상이어야 한다`);
    }
    for (const r of cals) {
        if (!CAL_BY_ID[r.c]) bad(P, `모르는 달력이 자료에 있다: ${r.c}`);
        if (CAL_BY_ID[r.c] && CAL_BY_ID[r.c].janFirst) {
            bad(P, `${r.c} 는 새해가 1월 1일인데 새해 표에 들어 있다`);
        }
        /* 번호가 있으면 번호, 없으면 간지 두 표기. 둘 다 없거나 둘 다 있으면 표가 흔들린다 */
        const named = r.nk !== undefined || r.ne !== undefined;
        if ((r.y === null) !== named) bad(P, `${r.c} ${r.s} 의 해 표기가 반쪽이다`);
        if (named && !(r.nk && r.ne)) bad(P, `${r.c} ${r.s} 의 간지가 ko·en 한쪽만 있다`);
    }

    /* ── ① 그 날이 그 달력의 첫날인가 ──────────────────────────────
       hebrew 만 ICU 가 월을 이름으로 준다(Tishri). 그 이름을 여기 적어 둔다 —
       검사기가 아는 것이고, 만드는 쪽과 나눠 쓰지 않는다. */
    const FIRST_MONTH = { hebrew: 'Tishri' };
    let firsts = 0;
    for (const r of cals) {
        const parts = new Intl.DateTimeFormat(`en-u-ca-${r.c}`,
            { timeZone: 'UTC', year: 'numeric', month: 'numeric', day: 'numeric' })
            .formatToParts(noonOf(r.s));
        const pick = (t) => (parts.find((x) => x.type === t) || {}).value;
        const wantMonth = FIRST_MONTH[r.c] || '1';
        if (pick('day') !== '1' || pick('month') !== wantMonth) {
            bad(P, `${r.c} ${r.s} 가 그 달력으로 ${pick('month')}월 ${pick('day')}일이다 — ${wantMonth}월 1일이어야 한다`);
        } else firsts++;
        /* 하루 전은 첫날이 아니어야 한다 — 그래야 "첫날 아무 날" 이 아니라 경계다 */
        const prevDay = new Intl.DateTimeFormat(`en-u-ca-${r.c}`, { timeZone: 'UTC', day: 'numeric' })
            .formatToParts(noonOf(r.s) - 86400e3).find((x) => x.type === 'day').value;
        if (prevDay === '1') bad(P, `${r.c} ${r.s} 의 하루 전도 1일이다 — 경계가 아니다`);
        /* 자료에 적힌 해 길이가 다음 새해까지의 간격과 맞나 */
        const nxt = cals.filter((x) => x.c === r.c && x.s > r.s).sort((a, b) => (a.s < b.s ? -1 : 1))[0];
        if (nxt) {
            const gap = Math.round((noonOf(nxt.s) - noonOf(r.s)) / 86400e3);
            if (gap !== r.n) bad(P, `${r.c} ${r.s} 의 해가 ${r.n}일로 적혔는데 다음 새해까지 ${gap}일이다`);
        }
    }
    if (firsts !== cals.length) bad(P, `첫날 검사가 ${firsts}/${cals.length} 만 됐다`);

    /* ── ② 노루즈 ↔ 손으로 적은 분점 시각 ──────────────────────────
       테헤란 표준시(UTC+3:30)로 춘분이 정오 이전이면 그날, 이후면 다음날. */
    {
        const TEHRAN = 3.5 * 3600e3;
        let n = 0;
        for (const r of cals.filter((x) => x.c === 'persian')) {
            const y = +r.s.slice(0, 4);
            const pub = (EQUINOXES[y] || {})[0];
            if (!pub) { soft(P, `${y}년 분점 고정값이 없어 노루즈를 못 견줬다`); continue; }
            const teh = new Date(Date.parse(pub) + TEHRAN);
            const day = teh.toISOString().slice(0, 10);
            const want = teh.getUTCHours() < 12 ? day
                : new Date(Date.parse(`${day}T12:00:00Z`) + 86400e3).toISOString().slice(0, 10);
            if (r.s !== want) bad(P, `노루즈가 ${r.s} 인데 공표 분점(${pub}) + 테헤란 규칙은 ${want} 다`);
            else n++;
        }
        if (!n) bad(P, '노루즈를 한 해도 못 견줬다');
        else console.log(`달력 검산점 — 노루즈 ${n}해가 공표 분점 시각과 일치`);
    }

    /* ── ③ 설날 ↔ 우리가 계산한 음력 ────────────────────────────── */
    {
        const ours = new Set(SKY.lunar.filter((m) => m.m === 1 && !m.leap).map((m) => m.s));
        const theirs = cals.filter((r) => r.c === 'dangi').map((r) => r.s);
        for (const s of theirs) {
            if (!ours.has(s)) bad(P, `ICU 의 설날 ${s} 가 우리 음력의 1월 초하루가 아니다`);
        }
        /* 반대 방향도 본다 — 우리 쪽에만 있는 설날이 있으면 훑기가 놓친 것이다 */
        const lo = theirs[0], hi = theirs[theirs.length - 1];
        for (const s of ours) {
            if (s >= lo && s <= hi && !theirs.includes(s)) {
                bad(P, `우리 음력의 설날 ${s} 가 ICU 자료에 없다`);
            }
        }
        if (!theirs.length) bad(P, '설날을 한 해도 못 견줬다');
        else console.log(`달력 검산점 — 설날 ${theirs.length}해가 우리 음력 1월 초하루와 일치`);
    }

    /* ── ④ 연호력의 차이가 상수인가 ────────────────────────────── */
    {
        let days = 0;
        const from = noonOf(`${SKY.years[0]}-01-01`);
        const to = noonOf(`${SKY.years[SKY.years.length - 1]}-12-31`);
        for (let at = from; at <= to; at += 10 * 86400e3) {
            const gy = +new Date(at).toISOString().slice(0, 4);
            for (const c of ERA_CALS) {
                const y = +yearOf(c.id, at);
                if (gy - y !== c.offset) {
                    bad(P, `${c.id} 의 차이가 ${new Date(at).toISOString().slice(0, 10)} 에 ${gy - y} 다 (원화 ${c.offset})`);
                }
            }
            days++;
        }
        if (days < 100) bad(P, `연호 검사가 ${days}일만 됐다 — 3년치를 열흘 간격으로 훑어야 한다`);
        else console.log(`달력 검산점 — 연호력 ${ERA_CALS.length}개의 차이가 ${days}일 내내 상수\n`);
    }
}

/* ------------------------------------------------- 천문 자료 자체의 앞뒤 */
{
    const P = '/data/sky.json';
    const byYear = (list) => {
        const m = {};
        for (const e of list) (m[e.t.slice(0, 4)] ??= []).push(e);
        return m;
    };

    /* 굳혀 둔 날짜가 순간과 맞나. 여기가 틀리면 표 전체가 하루씩 밀린다. */
    const zoneOf = { kst: 'Asia/Seoul', utc: 'UTC' };
    for (const [key, tz] of Object.entries(zoneOf)) {
        for (const e of [...SKY.terms, ...SKY.moons, ...SKY.showers]) {
            const want = new Intl.DateTimeFormat('en-CA', {
                timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
            }).format(new Date(e.t));
            if (e[key] !== want) { bad(P, `${e.t} 의 ${key} 가 ${e[key]} 다 (기대 ${want})`); break; }
        }
    }

    /* 절기 — 해마다 24개, k 는 0..23 이 한 번씩, 간격은 14~16.5일 */
    for (const [y, list] of Object.entries(byYear(SKY.terms))) {
        if (list.length !== 24) bad(P, `${y}년 절기가 ${list.length}개다`);
        const ks = list.map((e) => e.k).sort((a, b) => a - b);
        if (ks.join(',') !== [...Array(24).keys()].join(',')) bad(P, `${y}년 절기 k 가 0..23 이 아니다`);
    }
    for (let i = 1; i < SKY.terms.length; i++) {
        const gap = (Date.parse(SKY.terms[i].t) - Date.parse(SKY.terms[i - 1].t)) / 86400000;
        if (gap < 14 || gap > 16.5) bad(P, `절기 간격 ${gap.toFixed(1)}일 — ${SKY.terms[i - 1].n}→${SKY.terms[i].n}`);
    }
    /* 이름이 자리와 맞나. astro.mjs 의 TERM_NAMES 를 가져다 쓰지 않는다 —
       만드는 표로 검사하면 두 이름을 맞바꿔도 통과한다(실제로 그랬다).
       여기 따로 적고, 게다가 **드는 달**까지 본다. 이름만 견주면 같은 오타를
       두 번 내는 것으로 뚫리지만, 동지가 6월에 뜨는 것은 못 숨긴다. */
    const TERM_CHECK = [
        ['춘분', 3], ['청명', 4], ['곡우', 4], ['입하', 5], ['소만', 5], ['망종', 6],
        ['하지', 6], ['소서', 7], ['대서', 7], ['입추', 8], ['처서', 8], ['백로', 9],
        ['추분', 9], ['한로', 10], ['상강', 10], ['입동', 11], ['소설', 11], ['대설', 12],
        ['동지', 12], ['소한', 1], ['대한', 1], ['입춘', 2], ['우수', 2], ['경칩', 3],
    ];
    for (const e of SKY.terms) {
        const want = TERM_CHECK[e.k];
        if (!want) { bad(P, `모르는 절기 자리 k=${e.k}`); continue; }
        if (want[0] !== e.n) bad(P, `k=${e.k} 의 이름이 "${e.n}" 이다 (기대 "${want[0]}")`);
        const month = +e.t.slice(5, 7);
        if (month !== want[1]) bad(P, `${e.n} 이 ${month}월에 든다 (기대 ${want[1]}월) — ${e.t}`);
    }

    /* 분 단위 검산. 공휴일 쪽 검산점은 날짜만 주므로 1분 오차와 70분 오차를
       가르지 못한다. 공표값과 직접 견준다. */
    {
        let n = 0;
        for (const [y, byK] of Object.entries(EQUINOXES)) {
            for (const [k, iso] of Object.entries(byK)) {
                const mine = SKY.terms.find((e) => e.k === +k && e.t.startsWith(y));
                if (!mine) continue;
                n++;
                const off = Math.round((Date.parse(mine.t) - Date.parse(iso)) / 60000);
                if (Math.abs(off) > TOLERANCE_MINUTES) {
                    bad(P, `${y} k=${k}: 계산 ${mine.t} / 공표 ${iso} — ${off}분 차이 (허용 ${TOLERANCE_MINUTES}분)`);
                }
            }
        }
        if (n < 8) {
            soft(P, `분점·지점 공표값과 겹치는 항목이 ${n}개뿐이다 — tools/sky-fixture.mjs 에 올해 값을 채울 것`);
        }
    }

    /* 삭망 — 번갈아 나오고 간격은 반 삭망월(약 14.77일) 언저리 */
    for (let i = 1; i < SKY.moons.length; i++) {
        if (SKY.moons[i].f === SKY.moons[i - 1].f) bad(P, `삭망이 연달아 같다 — ${SKY.moons[i].t}`);
        const gap = (Date.parse(SKY.moons[i].t) - Date.parse(SKY.moons[i - 1].t)) / 86400000;
        if (gap < 13.5 || gap > 16) bad(P, `삭망 간격 ${gap.toFixed(1)}일 — ${SKY.moons[i].t}`);
    }

    /* 유성우 — 해마다 같은 목록, 널리 알려진 날짜에서 사흘 안.
       λ☉ 를 잘못 적으면 조용히 며칠 어긋나는데 그것만 잡는다. 정밀 검산이 아니다. */
    const win = Object.fromEntries(SHOWERS.map((s) => [s.id, s.win]));
    for (const [y, list] of Object.entries(byYear(SKY.showers))) {
        if (list.length !== SHOWERS.length) bad(P, `${y}년 유성우가 ${list.length}개다`);
        for (const e of list) {
            const [mo, day] = win[e.id] || [];
            if (!mo) { bad(P, `모르는 유성우 ${e.id}`); continue; }
            const at = new Date(e.t);
            const off = Math.abs((at - Date.UTC(+y, mo - 1, day)) / 86400000);
            if (off > 3) bad(P, `${e.n} 극대기가 ${e.utc} — 알려진 ${y}-${mo}-${day} 에서 ${off.toFixed(1)}일 벗어났다`);
        }
    }

    /* ------------------------------------------------------------- 음력 달력
       규칙이 셋이고 셋 다 저장소 안에서 되짚을 수 있다.
         · 초하루는 삭이 든 날 (KST)          ← sky.json 의 moons
         · 동지가 든 달은 11월                ← sky.json 의 terms (k=18)
         · 윤달은 중기가 들지 않는 달, 나머지 달은 중기가 하나씩 (무중치윤법)
       셋을 다 걸면 달력이 온전히 정해진다 — 삭과 중기가 이미 분 단위로 검사돼
       있으므로(위 공표값 12건), 남는 것은 "번호를 어떻게 붙였나" 뿐이고 그게
       이 세 규칙이다. */
    {
        const lunar = SKY.lunar;
        if (!Array.isArray(lunar) || !lunar.length) {
            bad(P, '음력 자료가 없다 — node tools/gen-sky.mjs 를 다시 돌릴 것');
        } else {
            const dayOf = (iso) => epochDayRef(iso);
            const kst = (iso) => new Intl.DateTimeFormat('en-CA', {
                timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
            }).format(new Date(iso));

            const newMoons = new Set(SKY.moons.filter((m) => !m.f).map((m) => kst(m.t)));
            /* 중기 = 황경이 30°의 배수인 절기 = 짝수 k. 24절기의 절반이다. */
            const majors = SKY.terms.filter((e) => e.k % 2 === 0).map((e) => kst(e.t));
            const solstices = SKY.terms.filter((e) => e.k === 18).map((e) => kst(e.t));

            for (let i = 0; i < lunar.length; i++) {
                const mo = lunar[i];
                const at = `음력 ${mo.y}/${mo.leap ? '윤' : ''}${mo.m}(${mo.s})`;
                if (mo.m < 1 || mo.m > 12) bad(P, `${at}: 달 번호가 범위 밖이다`);
                if (mo.n !== 29 && mo.n !== 30) bad(P, `${at}: ${mo.n}일이다 — 29 나 30 이어야 한다`);
                /* 자료 창의 양 끝 달은 짝이 될 삭이 sky.json 밖에 있다 */
                if (SKY.years.includes(+mo.s.slice(0, 4)) && !newMoons.has(mo.s)) {
                    bad(P, `${at}: 초하루에 삭이 없다`);
                }
                if (i) {
                    const gap = dayOf(mo.s) - dayOf(lunar[i - 1].s);
                    if (gap !== lunar[i - 1].n) {
                        bad(P, `${at}: 앞 달이 ${lunar[i - 1].n}일인데 초하루 간격은 ${gap}일이다`);
                    }
                }
                /* 중기가 든 달의 수. 마지막 달은 끝을 재는 데 다음 달이 필요 없다
                   (n 이 있다) 므로 전부 볼 수 있다. */
                const s = dayOf(mo.s), e = s + mo.n;
                const inside = (list) => list.filter((d) => dayOf(d) >= s && dayOf(d) < e);
                /* 절기 자료가 담긴 해 안에서만 센다 — 창 밖으로 걸친 달은 중기가
                   비어 보인다. **연도를 뽑을 때 slice 를 잊지 말 것** — `+'2025-08-22'`
                   는 NaN 이고, 그러면 covered 가 늘 false 가 되어 이 검사가 통째로
                   잠든다. 일부러 윤달 표시를 지워 보고서야 알았다. */
                const covered = SKY.years.includes(+mo.s.slice(0, 4))
                    && SKY.years.includes(+isoAt(e - 1).slice(0, 4));
                if (covered) {
                    const got = inside(majors).length;
                    if (mo.leap && got !== 0) bad(P, `${at}: 윤달인데 중기가 ${got}개 들었다`);
                    if (!mo.leap && got !== 1) bad(P, `${at}: 중기가 ${got}개 들었다 — 윤달이 아니면 하나여야 한다`);
                    if (inside(solstices).length && mo.m !== 11) {
                        bad(P, `${at}: 동지가 들었는데 11월이 아니다`);
                    }
                }
            }
            /* 한 음력 해의 **평달 번호는 1..12 가 한 번씩**이고, 윤달은 있어도 하나다.
               번호가 통째로 밀리는 고장(정월이 2월이 되는 것)은 중기 검사로 안 잡힌다 —
               밀린 달에도 중기는 하나씩 들어 있기 때문이다. 실제로 그렇게 뚫렸다. */
            const byLy = new Map();
            for (const mo of lunar) {
                if (!byLy.has(mo.y)) byLy.set(mo.y, []);
                byLy.get(mo.y).push(mo);
            }
            for (const [y, list] of byLy) {
                /* 자료 창의 양 끝 음력 해는 잘려 있다 — 12개월이 안 되면 건너뛴다 */
                if (list.length < 12) continue;
                const plain = list.filter((mo) => !mo.leap).map((mo) => mo.m).sort((a, b) => a - b);
                const want = [...Array(12).keys()].map((i) => i + 1);
                if (plain.join(',') !== want.join(',')) {
                    bad(P, `음력 ${y}년의 평달 번호가 [${plain.join(',')}] 이다 — 1..12 가 한 번씩이어야 한다`);
                }
                const leaps = list.filter((mo) => mo.leap).length;
                if (leaps > 1) bad(P, `음력 ${y}년에 윤달이 ${leaps}개다`);
                if (list.length !== 12 + leaps) {
                    bad(P, `음력 ${y}년이 ${list.length}개월인데 윤달은 ${leaps}개다`);
                }
            }
        }
    }

    /* --------------------------------------------- 음력의 밖에서 온 검산점
       위 셋은 우리 규칙을 우리가 다시 읽은 것이다. 규칙 자체를 잘못 잡았는지
       (정월이 한 달 밀렸는지) 는 밖에서 온 자료로만 잡힌다 — Nager 의 공휴일 중
       음력으로 정의된 날이 여럿이다.

       엄격도가 셋이다. 느슨한 쪽을 쓰는 데는 저마다 이유가 있다.
         exact  계산일이 그 공휴일 날짜 중 하나여야 한다
         span   연휴 구간(가장 이른 날 ~ 가장 늦은 날) 안에 들면 된다.
                Nager 가 일요일에 걸린 날을 빼고 주는 나라가 있어(2027 KR 설날)
                정확 일치로는 멀쩡한 계산이 걸린다
         zone   하루까지 어긋나도 된다. **이건 오차가 아니라 사실이다** —
                중국 농력은 UTC+8 기준이라 삭이 두 자정 사이에 떨어지는 해에
                한국 음력과 하루 갈린다 (2027 춘절: 중국 2월 6일 · 한국 2월 7일).
                그래도 이틀 어긋나면 잡힌다. */
    {
        const anchors = [
            { cc: 'KR', re: /^추석$/,                   m: 8, d: 15, how: 'exact', what: '추석 = 음력 8월 15일' },
            { cc: 'HK', re: /中秋節翌日/,                m: 8, d: 16, how: 'exact', what: '中秋節翌日 = 음력 8월 16일' },
            { cc: 'KR', re: /^설날$/,                    m: 1, d: 1,  how: 'span',  what: '설날 = 음력 1월 1일' },
            { cc: 'SG', re: /Chinese New Year/i,        m: 1, d: 1,  how: 'span',  what: '春节 = 음력 1월 1일' },
            { cc: 'CN', re: /Spring Festival|春节/i,     m: 1, d: 1,  how: 'zone',  what: '春节 = 음력 1월 1일 (UTC+8)' },
            { cc: 'HK', re: /農曆年初一/,                m: 1, d: 1,  how: 'zone',  what: '農曆年初一 = 음력 1월 1일 (UTC+8)' },
        ];
        const lunar = SKY.lunar || [];
        /* 자료가 온전히 담고 있는 음력 해. 여기 드는 해에서 달을 못 찾으면 그건
           건너뛸 일이 아니라 실패다 — 조용히 건너뛰면 번호가 밀려도 통과한다. */
        const whole = new Set();
        {
            const n = new Map();
            for (const mo of lunar) n.set(mo.y, (n.get(mo.y) || 0) + 1);
            for (const [y, c] of n) if (c >= 12) whole.add(y);
        }
        /* 음력 (해, 달, 날) → 양력. 윤달은 건너뛴다 — 명절은 평달로 센다. */
        const solarOf = (ly, m, d) => {
            const mo = lunar.find((x) => x.y === ly && x.m === m && !x.leap);
            return mo ? isoAt(epochDayRef(mo.s) + d - 1) : null;
        };

        let points = 0;
        for (const a of anchors) {
            const file = join(DATA, `${a.cc}.json`);
            if (!existsSync(file)) { soft(P, `음력 검산점 ${a.cc} 자료가 없다`); continue; }
            const days = JSON.parse(readFileSync(file, 'utf8')).days
                .filter((h) => a.re.test(h.n) || a.re.test(h.e || ''));
            if (!days.length) {
                soft(P, `음력 검산점을 못 찾았다 — ${a.cc} ${a.what} (Nager 가 이름을 바꿨나)`);
                continue;
            }
            for (const year of SKY.years) {
                const hs = days.map((h) => h.d).filter((d) => d.startsWith(String(year))).sort();
                if (!hs.length) continue;
                const mine = solarOf(year, a.m, a.d);
                if (!mine) {
                    if (whole.has(year)) bad(P, `음력 ${year}년에 ${a.m}월(평달)이 없다 — 달 번호가 밀렸나`);
                    continue;                            /* 자료 창 밖의 음력 해 */
                }
                points++;

                const ok = a.how === 'exact' ? hs.includes(mine)
                    : a.how === 'span' ? (mine >= hs[0] && mine <= hs[hs.length - 1])
                        : hs.some((d) => Math.abs(epochDayRef(d) - epochDayRef(mine)) <= 1);
                if (!ok) {
                    bad(P, `음력 검산점 어긋남(${a.how}) — ${a.cc} ${year} ${a.what}:`
                        + ` 계산 ${mine} / 공휴일 ${hs.join(',')}`);
                }
            }
        }
        /* 이름이 바뀌어 검산점이 통째로 사라지는 것이 가장 나쁘다 */
        const FLOOR = 12;
        if (points < FLOOR) {
            bad(P, `음력 검산점이 ${points}개뿐이다 — ${FLOOR}개 이상이어야 한다. 앵커 공휴일 이름을 확인할 것.`);
        } else {
            console.log(`음력 검산점 ${points}개 (설날 · 추석 · 中秋節) 대조\n`);
        }
    }

    /* 자정에서 1분도 안 남은 사건은 날짜를 못 믿는다. 태양 쪽 오차가 1분 안이라
       그보다 얇으면 계산이 맞아도 어느 날인지 단정할 수 없다. */
    for (const [key, zone] of [['kh', 'KST'], ['uh', 'UTC']]) {
        for (const e of [...SKY.terms, ...SKY.moons, ...SKY.showers]) {
            const [hh, mm] = e[key].split(':').map(Number);
            const t = hh * 60 + mm;
            const margin = Math.min(t, 1440 - t);
            if (margin < 1) bad(P, `${e.t} 이 ${zone} 자정에서 ${margin}분 — 날짜를 단정할 수 없다`);
            else if (margin <= 5) soft(P, `${e.t} 이 ${zone} 자정에서 ${margin}분 — 여유가 얇다`);
        }
    }
}

/* ---------------------------------------------------------------- 404
   Cloudflare 는 경로를 거슬러 올라가며 가장 가까운 404.html 을 쓴다. 언어 칸마다
   하나씩 있어야 /en/... 오타에 한국어 안내가 나오지 않는다. */
for (const [file, lang, needle] of [
    ['404.html', 'ko', '없는 쪽입니다'],
    ['en/404.html', 'en', 'Not here'],
]) {
    const path = join(PUB, file);
    if (!existsSync(path)) { bad('/' + file, '없다'); continue; }
    const txt = readFileSync(path, 'utf8');
    if (!txt.includes(`<html lang="${lang}">`)) bad('/' + file, `<html lang="${lang}"> 가 아니다`);
    if (!txt.includes('name="robots" content="noindex"')) bad('/' + file, 'noindex 가 없다');
    if (!txt.includes(needle)) bad('/' + file, `"${needle}" 가 없다 — 언어가 섞였다`);
    if (txt.includes('rel="canonical"')) bad('/' + file, 'canonical 이 있다 — 색인될 쪽이 아니다');
    /* 404 는 pages() 순회에 안 들어가서 위 연락처 검사를 안 받는다 */
    if (!txt.includes('<span data-contact ')) bad('/' + file, '연락처가 없다');
    if (!txt.includes('src="/shared/contact.js"')) bad('/' + file, 'contact.js 를 싣지 않는다');
    if (/[A-Za-z0-9._-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(txt)) {
        bad('/' + file, '완성된 메일 주소가 소스에 있다');
    }
}

/* ------------------------------------------------- 10. ko / en 짝 맞추기 */
{
    const key = (p) => `${p.lang}:${p.slug}`;
    const have = new Set(ALL.map(key));
    const orphan = ALL.filter((p) => !have.has(`${p.lang === 'ko' ? 'en' : 'ko'}:${p.slug}`));
    if (orphan.length) {
        bad('/', `짝이 없는 페이지 ${orphan.length}개: ${orphan.slice(0, 5).map((p) => p.label).join(', ')}`);
    }
    const ko = ALL.filter((p) => p.lang === 'ko').length;
    const en = ALL.filter((p) => p.lang === 'en').length;
    if (ko !== en) bad('/', `한국어 ${ko}개 / 영어 ${en}개 — 수가 다르다`);
}

/* ------------------------------------------- 11. 영어 페이지의 한국어 누출
   말 표를 한 군데로 모아 두어도 생성기 쪽 문안은 손으로 쓴다. 영어 페이지에
   한글이 남아 있으면 번역을 빠뜨린 것이다 — 공휴일 이름(현지어)은 자료에서
   오는 것이라 <td class="name"> 안쪽과 <title>/description 의 국가명은 뺀다. */
{
    const HANGUL = /[가-힣]/;
    for (const { page, lang, label } of ALL) {
        if (lang !== 'en') continue;
        const html = readFileSync(join(PUB, page, 'index.html'), 'utf8');

        /* 자료에서 오는 자리를 들어낸다 */
        const chrome = html
            .replace(/<td class="name">[\s\S]*?<\/td>/g, '')
            .replace(/<span class="regions">[\s\S]*?<\/span>/g, '')
            .replace(/ data-ko="[^"]*"/g, '')
            .replace(/ data-key="[^"]*"/g, '')
            .replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g, '');

        if (HANGUL.test(chrome)) {
            const hit = (chrome.match(/[^\s>]*[가-힣][^\s<]*/) || [''])[0];
            bad(label, `영어 페이지에 한국어가 남았다: "${hit}"`);
        }
    }
}

/* 유령 주소 — 구글봇은 JS 소스를 실행만 하는 게 아니라 훑어서, 주소처럼 생긴
   문자열을 꺼내 실제로 받아 간다. 화면에 쓸 값이나 조각 접두사를 슬래시로 시작하는
   리터럴로 두면 그게 통째로 크롤 대상이 된다. 실제로 GSC 에 이렇게 쌓였다 —
   backend-internals 는 단위 접미사가 404 로(세 건), dday-static 은 언어 칸이
   307 리디렉션으로.

   그래서 스크립트 안의 슬래시로 시작하는 리터럴은 전부 여기서 풀어 본다.
   진짜 자산을 가리키면 통과, 아니면 실패다. 통과시킬 수 없는 값이라면 소스에서
   맨 앞 슬래시를 \u002F 로 적으면 된다 — 런타임 값은 같고 이 검사에도 안 걸린다. */
{
    const GHOST = /['"`]\/[A-Za-z0-9가-힣][^'"`\s]{0,40}['"`]/g;
    const INLINE = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;
    const before = fail.length;
    let seen = 0;

    const sweep = (label, code) => {
        for (const hit of code.matchAll(GHOST)) {
            const url = hit[0].slice(1, -1);
            seen++;
            const target = join(PUB, url);
            if (existsSync(target) && !statSync(target).isDirectory()) continue;   // 진짜 자산
            const why = existsSync(join(target, 'index.html'))
                ? '슬래시가 빠져 307 로 튕긴다'
                : '404 다';
            bad(label, `스크립트의 주소꼴 리터럴 ${hit[0]} — 구글봇이 이걸 크롤하는데 ${why}`);
        }
    };

    const walk = (dir) => {
        for (const name of readdirSync(dir)) {
            const p = join(dir, name);
            if (statSync(p).isDirectory()) { walk(p); continue; }
            if (p.endsWith('.js')) { sweep(p.slice(PUB.length + 1).split(sep).join('/'), readFileSync(p, 'utf8')); continue; }
            if (!p.endsWith('.html')) continue;
            for (const m of readFileSync(p, 'utf8').matchAll(INLINE)) {
                if (/application\/ld\+json/.test(m[0])) continue;      // JSON-LD 는 따로 본다
                sweep(p.slice(PUB.length + 1).split(sep).join('/'), m[1]);
            }
        }
    };
    walk(PUB);

    if (fail.length === before) console.log(`유령 주소 — 스크립트의 주소꼴 리터럴 ${seen}개 전부 실제 자산`);
}

/* ------------------------------------------------------------------ 결과 */
console.log('');
for (const w of warn) console.warn('  주의:', w);
if (fail.length) {
    console.error(`\n실패 ${fail.length}건`);
    for (const f of fail.slice(0, 40)) console.error('  ✗', f);
    if (fail.length > 40) console.error(`  … 그 외 ${fail.length - 40}건`);
    process.exit(1);
}
console.log(`통과 — 페이지 ${ALL.length}개${warn.length ? ` (주의 ${warn.length}건)` : ''}`);
