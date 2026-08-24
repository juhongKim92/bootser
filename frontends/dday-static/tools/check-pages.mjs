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
     6. 고정 날짜를 넣고 DDAY.classify 가 낸 다음/지난/오늘이
        여기서 따로 계산한 값과 같나
     7. 첫 화면 국가 링크 · countries.json · 실제 페이지 디렉터리가 1:1 인가
     8. sitemap.xml 의 URL 집합이 페이지 집합과 같나
     9. 브라우저 지역 감지(DDAY.detect)가 기대대로 갈리나
    10. ko / en 이 짝으로 있고, 두 벌이 같은 국가 집합을 덮나
    11. 영어 페이지가 한국어 말을 흘리지 않나

   실패가 하나라도 있으면 종료 코드 1 이다.
   ============================================================ */
import { boot, pages, PUB, DATA } from './harness.mjs';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { BASE, today } from './config.mjs';

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
    home: ['picker', 'home', 'tcap', 'tnote', 'tlist', 'csearch', 'clist', 'cnone'],
};

/* 슬러그를 언어와 국가로 가른다.  '' | 'en' | 'kr' | 'en/kr' */
const ALL = pages().map((p) => {
    const en = p === 'en' || p.startsWith('en/');
    const slug = en ? p.slice(3) : p;                    /* '' | 'kr' */
    return { page: p, lang: en ? 'en' : 'ko', slug, label: '/' + (p ? p + '/' : '') };
});
const COUNTRY = ALL.filter((p) => p.slug !== '');
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
    ko: { noHoliday: '오늘은 공휴일이 아닙니다', off: ' — 오늘 쉽니다',
          partial: ' — 일부 지역만 쉽니다', outOfRange: '담긴 자료 범위 밖입니다',
          asofYear: (y) => String(y) },
    en: { noHoliday: 'Today is not a public holiday', off: ' — a day off today',
          partial: ' — observed only in some regions', outOfRange: 'Outside the range of the data',
          asofYear: (y) => String(y) },
};

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

/* ------------------------------------------------------------ 페이지 순회 */
const linkedFromHome = { ko: new Set(), en: new Set() };

for (const { page, lang, slug, label } of ALL) {
    let r;
    try { r = boot(page); }
    catch (e) { bad(label, `구동 실패 — ${e.message}`); continue; }

    for (const e of r.errors) bad(label, e);
    if (!r.dday) { bad(label, 'window.DDAY 손잡이가 없다 — dday.js 가 안 실렸다'); continue; }

    const html = r.html;
    const isHome = slug === '';
    const dir = lang === 'en' ? '/en' : '';

    /* <html lang> 이 곧 dday.js 의 갈림길이다. 경로와 어긋나면 영어 페이지가
       한국어 말로 그려진다 — 화면으로만 보이고 어디서도 에러가 안 난다. */
    const declared = (html.match(/<html lang="([a-z]{2})">/) || [])[1];
    if (declared !== lang) bad(label, `<html lang="${declared}"> 가 경로와 다르다 (기대 ${lang})`);
    if (r.dday.lang !== lang) bad(label, `dday.js 가 ${r.dday.lang} 로 잡았다 (기대 ${lang})`);

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
    for (const id of (isHome ? NEED_IDS.home : NEED_IDS.country)) {
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
    /* 영어 페이지는 영어 이름을 앞세운다 — 생성기·클라이언트와 같은 규칙이어야 한다 */
    const nameAt = (d) => {
        const day = data.days.find((x) => x.d === d) || {};
        return lang === 'en' ? (day.e || day.n) : day.n;
    };

    if (!drawn.asof.includes(String(new Date().getFullYear()))) {
        bad(label, `기준 날짜 문안이 이상하다: "${drawn.asof}"`);
    }
    const w = WORDS[lang];
    const wantVerdict = want2.todays.length
        ? want2.todays.map(nameAt).join(' · ') +
            (want2.todays.every((d) => data.days.find((x) => x.d === d).r) ? w.partial : w.off)
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
    }
    for (const smell of ['undefined', 'NaN', '[object Object]']) {
        for (const [k, v] of Object.entries(drawn)) {
            if (v.includes(smell)) bad(label, `오늘 카드 ${k} 에 "${smell}" 가 있다`);
        }
    }
}

/* -------------------------------------------------- 7. 목록 ↔ 페이지 1:1 */
const indexCodes = new Set(JSON.parse(readFileSync(join(DATA, 'countries.json'), 'utf8'))
    .map((c) => c.code));
const dirCodes = new Set(COUNTRY.map((p) => p.slug.toUpperCase()));
const dataCodes = new Set(readdirSync(DATA)
    .filter((f) => f.endsWith('.json') && f !== 'countries.json')
    .map((f) => f.replace('.json', '')));

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
        for (const f of readdirSync(DATA).filter((x) => x.endsWith('.json') && x !== 'countries.json')) {
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
