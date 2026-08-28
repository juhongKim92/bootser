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
     5. HTML 표의 날짜 집합이 data/<CC>.json 과 정확히 같나
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

   실패가 하나라도 있으면 종료 코드 1 이다.
   ============================================================ */
import { boot, pages, PUB, DATA } from './harness.mjs';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { BASE, EXTRA, today } from './config.mjs';
import { SHOWERS } from './astro.mjs';
import { EQUINOXES, TOLERANCE_MINUTES } from './sky-fixture.mjs';

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
    sky: ['picker', 'now', 'next-term', 'next-new', 'next-full', 'next-shower'],
};

/* 슬러그를 언어와 갈래로 가른다.  '' | 'en' | 'kr' | 'en/kr' | 'sky' | 'en/sky'
   갈래가 셋이다 — 첫 화면 · 국가 페이지 · 국가가 아닌 페이지(EXTRA).
   예전에는 "첫 화면 아니면 전부 국가 페이지" 였는데 하늘 페이지가 그 가정을 깬다. */
const ALL = pages().map((p) => {
    const en = p === 'en' || p.startsWith('en/');
    const slug = en ? p.slice(3) : p;                    /* '' | 'kr' | 'sky' */
    const kind = slug === '' ? 'home' : EXTRA.includes(slug) ? slug : 'country';
    return { page: p, lang: en ? 'en' : 'ko', slug, kind, label: '/' + (p ? p + '/' : '') };
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
        /* .now .pair dd .dd 는 카드 안에만 걸린다. 첫 화면 목록에도 같은 모양이
           필요한데 그걸 빠뜨려서 "D-10다음 절기" 처럼 붙어 나온 적이 있다. */
        [/\.worldwide \.what \.dd\{/, '첫 화면 하늘 목록의 D-day 가 붙어 나온다'],
        [/\.worldwide \.what em\{/, '첫 화면 하늘 목록의 날짜가 붙어 나온다'],
        [/prefers-color-scheme:\s*dark/, '어두운 테마 토큰이 없다'],
        [/@media \(max-width:\s*640px\)/, '좁은 화면 대응이 없다'],
    ];
    for (const [re, msg] of need) if (!re.test(css)) bad('shared/*.css', msg);
}

/* --------------------------------------------------------------- 날짜 검사
   하니스가 쓰는 것과 겹치지 않게, 기대값은 여기서 따로 계산한다.
   같은 함수로 만들고 같은 함수로 검사하면 아무것도 검사하지 않는 것과 같다. */
const TODAY = today();
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
          skyNone: '오늘은 절기도 삭망도 아닙니다', skyOff: '오늘입니다',
          dtTerm: '다음 절기', dtNew: '다음 삭', dtFull: '다음 보름', dtShower: '다음 유성우',
          asofYear: (y) => String(y) },
    en: { noHoliday: 'An ordinary day', off: ' — a day off today',
          partial: ' — observed only in some regions', outOfRange: 'Outside the range of the data',
          breakLen: (n) => `${n}-day break`, breakNow: 'on now', dtBreak: 'Next break',
          noBreak: 'No long weekend in the data',
          newMoon: 'New Moon', fullMoon: 'Full Moon',
          skyNone: 'No solar term or moon phase today', skyOff: 'today',
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

/* ------------------------------------------------------------ 페이지 순회 */
const linkedFromHome = { ko: new Set(), en: new Set() };

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

    if (isHome) {
        /* 7. 첫 화면 국가 링크 — 같은 언어 칸 안으로만 걸려야 한다 */
        const seen = linkedFromHome[lang];
        for (const m of html.matchAll(/<li data-cc="([A-Z]{2})" data-key="[^"]*"><a href="([^"]+)"/g)) {
            seen.add(m[1]);
            const want = `${dir}/${m[1].toLowerCase()}/`;
            if (m[2] !== want) bad(label, `${m[1]} 링크가 ${m[2]} — ${want} 이어야 한다`);
        }
        const shown = (html.match(/(\d+)(?:개국|\s*countries)/) || [])[1];
        if (shown && +shown !== seen.size) {
            bad(label, `"${shown}" 이라고 적혀 있는데 링크는 ${seen.size}개다`);
        }
        /* 보이는 이름순인가. countries.json 은 한글 이름순으로 저장돼 있어서,
           영어 화면에서 그대로 쓰면 Ghana(가나)가 맨 앞에 오는 무작위 순서가 된다. */
        const shownNames = [...html.matchAll(
            /<li data-cc="[A-Z]{2}" data-key="[^"]*"><a href="[^"]*">[^ ]+ ([^<]+)<span class="cc">/g
        )].map((m) => m[1]);
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

    /* ------------------------------------------------------------ 하늘 페이지
       국가 축이 아니라 전 세계 공통 축이라 자료가 한 벌이고, 갈리는 것은 날짜뿐이다
       (ko=KST · en=UTC). 여기서는 "표가 자료와 같은가" 와 "카드가 표와 같은 답을
       내는가" 를 본다. 자료 자체의 검산은 아래 천문 검산점 칸에서 따로 한다. */
    if (kind === 'sky') {
        if (!r.dday.isSky) bad(label, 'dday.js 가 하늘 페이지로 알아보지 못했다');
        const zone = lang === 'en' ? 'utc' : 'kst';

        const want = [
            ...SKY.terms.map((e) => `${e[zone]}|term`),
            ...SKY.moons.map((e) => `${e[zone]}|moon`),
            ...SKY.showers.map((e) => `${e[zone]}|shower`),
        ];
        const got = [...html.matchAll(/<tr data-d="([\d-]+)" data-sky="([a-z]+)">/g)]
            .map((m) => `${m[1]}|${m[2]}`);
        const sortKey = (a) => [...a].sort().join(',');
        if (sortKey(got) !== sortKey(want)) {
            bad(label, `하늘 표 ${got.length}행 / 자료 ${want.length}건 — 집합이 다르다 (${zone} 기준)`);
        }
        /* 갈래마다 날짜순이어야 한다. 연도 구획이 셋이라 눈으로는 안 보인다. */
        for (const g of ['term', 'moon', 'shower']) {
            const seq = got.filter((x) => x.endsWith('|' + g)).map((x) => x.split('|')[0]);
            const asc = [...seq].sort();
            if (seq.join(',') !== asc.join(',')) bad(label, `하늘 표(${g})가 날짜순이 아니다`);
        }
        /* 분점 둘 · 지점 둘, 해마다 넷 */
        const cardinals = (html.match(/class="cardinal"/g) || []).length;
        if (cardinals !== SKY.years.length * 4) {
            bad(label, `분점·지점 배지 ${cardinals}개 / 기대 ${SKY.years.length * 4}개`);
        }

        /* 카드. 기대값은 sky.json 에서 여기가 따로 뽑는다 —
           "다음" 은 앞으로 올 것이고 오늘 것은 오늘 칸이 맡는다. */
        const nextOf = (items) => {
            const t = epochDayRef(TODAY);
            let best = null;
            for (const e of items) {
                const d = epochDayRef(e[zone]) - t;
                if (d > 0 && (best === null || d < best.d)) best = { e, d };
            }
            return best;
        };
        const w = WORDS[lang];
        const lines = [
            ['#next-term', nextOf(SKY.terms), (e) => (lang === 'en' ? e.e : e.n)],
            ['#next-new', nextOf(SKY.moons.filter((m) => !m.f)), () => w.newMoon],
            ['#next-full', nextOf(SKY.moons.filter((m) => m.f)), () => w.fullMoon],
            ['#next-shower', nextOf(SKY.showers), (e) => (lang === 'en' ? e.e : e.n)],
        ];
        for (const [sel, e, name] of lines) {
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

        /* 오늘 칸 */
        const now = r.doc.cache.get('#now');
        const verdict = now.querySelector('.verdict').textContent;
        const todays = [...SKY.terms, ...SKY.moons, ...SKY.showers].filter((e) => e[zone] === TODAY);
        if (!todays.length && verdict !== w.skyNone) {
            bad(label, `오늘 아무것도 없는데 오늘 칸이 "${verdict}" 다`);
        }
        if (todays.length && !verdict.includes(w.skyOff.trim().replace(/^—\s*/, ''))) {
            bad(label, `오늘 ${todays.length}건인데 오늘 칸이 "${verdict}" 다`);
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
        const order = [...filled.matchAll(/<\/span>([^<]+)<span class="cc">/g)].map((m) => m[1]);
        const want = [...order].sort((a, b) => a.localeCompare(b, lang));
        if (order.join('|') !== want.join('|')) {
            const at = order.findIndex((x, i) => x !== want[i]);
            bad(label, `선택기가 이름순이 아니다 — ${at + 1}번째가 "${order[at]}" (기대 "${want[at]}")`);
        }
        if (!filled.includes(`href="${dir}/kr/"`)) bad(label, `선택기 링크가 ${dir} 칸을 안 쓴다`);
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

        /* 갈래 이름이 앞, D-day 가 뒤. 순서가 뒤집히면 "D-10다음 절기" 가 된다. */
        for (const dt of [w.dtTerm, w.dtNew, w.dtFull, w.dtShower]) {
            if (!drawnSky.includes(`<span class="who">${esc(dt)}</span>`)) {
                bad(label, `하늘 칸에 "${dt}" 줄이 없다 — 갈래 이름이 앞에 와야 한다`);
            }
        }

        for (const [items, name] of [
            [SKY.terms, (e) => (lang === 'en' ? e.e : e.n)],
            [SKY.moons.filter((m) => !m.f), () => w.newMoon],
            [SKY.moons.filter((m) => m.f), () => w.fullMoon],
            [SKY.showers, (e) => (lang === 'en' ? e.e : e.n)],
        ]) {
            const e = nextOf(items);
            if (!e) continue;
            if (!drawnSky.includes(`D-${e.d}<`)) bad(label, `하늘 칸에 D-${e.d} 이 없다`);
            if (!drawnSky.includes(esc(name(e.e)))) bad(label, `하늘 칸에 "${name(e.e)}" 이 없다`);
        }
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
        for (const need of ['class="asof"', 'class="verdict"', wantName,
                            `${dir}/${wantCc.toLowerCase()}/`]) {
            if (!drawn.includes(need)) bad(label, `요약 카드에 빠짐: ${need}`);
        }
        if (!/D[-+]\d+/.test(drawn)) bad(label, '요약 카드에 D-day 숫자가 없다');

        /* 다음·지난 공휴일의 이름과 다른 언어 이름까지. 국가 페이지 카드와 같은
           내용을 그려야 하는데, 예전에 첫 화면만 조용히 빠뜨린 적이 있다. */
        const src = JSON.parse(readFileSync(join(DATA, `${wantCc}.json`), 'utf8'));
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
