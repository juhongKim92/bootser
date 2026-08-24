/* ============================================================
   public/data/*.json → 한국어 · 영어 두 벌의 정적 페이지
   실행: node tools/gen-pages.mjs   (frontends/dday-static 에서)
   ------------------------------------------------------------
     한국어  /            /kr/      /us/      …
     영어    /en/         /en/kr/   /en/us/   …

   공휴일 목록은 HTML 안에 그대로 박는다. 자바스크립트를 꺼도 읽히고, 크롤러가
   "2026년 대한민국 공휴일" 이나 "South Korea Public Holidays 2026" 을 찾을 때
   실제로 그 문자열이 문서에 있다.
   날짜에 따라 달라지는 것(D-day · 오늘 여부)만 shared/dday.js 가 붙인다.

   선택기 <ul> 은 첫 화면에만 인라인하고 국가 페이지에서는 비워 둔다 —
   204개 <li> × 410개 페이지면 HTML 만 7MB 가 된다. 국가 페이지는
   dday.js 가 countries.json 으로 채운다.

   'en' 은 국가 코드가 아니다(ISO 3166-1 에 없다). 그래서 /en/ 을 언어 칸으로
   써도 국가 경로와 부딪히지 않는데, Nager 목록이 바뀌어 부딪히면 조용히
   덮어써 버리므로 아래에서 확인하고 멈춘다.
   ============================================================ */
import { readFileSync, readdirSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { BASE, PUB, DATA, YEARS, today } from './config.mjs';

const SITE = 'this is the day';
const MID = YEARS()[1];                                   /* 표지로 삼을 해 = 올해 */

const esc = (s) => String(s).replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const flag = (cc) => /^[A-Z]{2}$/.test(cc)
    ? String.fromCodePoint(0x1F1E6 + cc.charCodeAt(0) - 65, 0x1F1E6 + cc.charCodeAt(1) - 65)
    : '';

const dow = (iso) => {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
};

/* 한글 · 영어 · 코드 아무거나로 찾히게 한다. 영어 페이지에서도 "대한" 으로 찾힌다 —
   목록에 걸어 두는 열쇠는 언어와 무관하게 같은 것이 편하다. */
const searchKey = (c) => [c.ko, c.name, c.code].filter(Boolean).join(' ').toLowerCase();

/* description 은 160자를 넘으면 검색결과에서 잘린다. 덧붙이는 문장은 들어갈 때만
   붙인다 — 국가명이 긴 곳(Saint Helena, Ascension and Tristan da Cunha)이 있다. */
const fit = (base, extra, limit = 160) =>
    (extra && base.length + extra.length <= limit) ? base + extra : base;

/* ------------------------------------------------------------------- 말

   경로 규칙은 아래 dir 두 줄이 전부다.
     한국어  dir: ''     →  /        /kr/
     영어    dir: '/en'  →  /en/     /en/kr/

   언어 칸과 국가 칸이 같은 자리를 쓴다. 지금은 'en' 이 국가 코드가 아니고 한국이
   'KO' 가 아닌 'KR' 이라 부딪히지 않지만, 우연이다 — de·fr·es·it·pt·nl·ru 등
   35개 국가 코드가 흔한 언어 코드와 겹친다. 독일어를 넣는 순간 /de/ 가 독일
   공휴일 페이지와 정면으로 부딪힌다.

   그때는 언어를 양쪽 다 명시하는 쪽으로 옮긴다 — dir 을 '/ko' · '/en' 으로 바꾸고
   (dday.js 의 STR.*.dir 도 같이), 루트에 리다이렉트나 언어 선택 랜딩을 둔다.
   경로를 만드는 자리는 전부 dir 을 거치므로 그 두 줄이면 끝난다.

   이미 색인된 뒤라도 옮기는 비용은 낮다. Cloudflare 정적 자산의 _redirects 는
   플레이스홀더를 받으므로 국가마다 한 줄씩 적을 필요가 없다 — 위에서부터
   먼저 맞는 규칙이 이기니 영어 칸을 앞에 둔다.

     /en/*   /en/:splat   200
     /       /ko/         301
     /:cc/   /ko/:cc/     301

   남는 비용은 301 을 타고 순위가 넘어가는 데 걸리는 시간뿐이다. */

const KO_DOW = ['일', '월', '화', '수', '목', '금', '토'];
const EN_DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const L = {
    ko: {
        lang: 'ko', dir: '', other: 'en', locale: 'ko_KR',
        otherLabel: 'EN',            /* 버튼에 적히는 글자 = 눌렀을 때 가는 언어 */
        dow: KO_DOW,
        name: (c) => c.ko,
        homeTitle: (n) => `${SITE} — ${n}개국 공휴일과 다음 공휴일까지 D-day`,
        homeDesc: (n) => `오늘이 공휴일인지, 다음 공휴일까지 며칠 남았는지. 대한민국을 비롯한 ${n}개국의 법정 공휴일을 날짜순으로 봅니다.`,
        homeH1: '오늘, 쉬는 날인가',
        homeLede: (n) => `오늘이 공휴일인지, 다음 공휴일까지 며칠 남았는지 봅니다. 브라우저의 지역 설정으로 국가를 먼저 맞춰 두고, ${n}개국 아무 곳으로나 바꿀 수 있습니다.`,
        countriesCap: (n) => `국가 ${n}개`,
        countriesH2: '국가별 공휴일',
        searchLabel: '국가 검색',
        searchHint: '국가 검색 — 한글·영어·코드',
        noCountry: '찾는 국가가 없습니다.',
        pickerLabel: '국가 선택',
        title: (c, y) => `${y}년 ${c.ko} 공휴일 — 날짜와 D-day`,
        desc: (c, y, n, local) => fit(
            `${y}년 ${c.ko}(${c.name})의 공휴일 ${n}일을 날짜순으로. 다음 공휴일까지 남은 날을 함께 보여줍니다.`,
            local ? ' 일부 지역만 쉬는 날은 지역을 표시합니다.' : ''),
        h1: (c) => `${c.ko} 공휴일`,
        lede: (c, local) => `${c.ko}${c.ko === c.name ? '' : `(${c.name})`}의 법정 공휴일입니다. 오늘이 쉬는 날인지, 다음 공휴일까지 며칠 남았는지 바로 보여줍니다.`
            + (local ? ' 일부 지역만 쉬는 날에는 해당 지역을 함께 적었습니다.' : ''),
        yearCap: (y, n) => `${y}년 · ${n}일`,
        yearH2: (c, y) => `${y}년 ${c.ko} 공휴일`,
        thDate: '날짜', thName: '공휴일',
        placeholderVerdict: (c, n) => `${c.ko} 공휴일 ${n}일`,
        checking: '날짜를 확인하는 중…', computing: '계산하는 중…',
        dtNext: '다음', dtPrev: '지난',
        otherCountries: '다른 국가 공휴일 보기 →',
        localBadge: (n) => `일부 지역 ${n}곳`,
        foot: (g) => `공휴일 자료 <a href="https://date.nager.at/" rel="noopener">Nager.Date</a> · <code>types</code> 가 <code>Public</code> 인 항목만 담았습니다. 갱신 ${g}.`,
        footTz: 'D-day 는 이 기기의 날짜로 계산합니다 — 다른 시간대의 국가를 볼 때는 하루 어긋날 수 있습니다.',
        crumbCountry: (c) => `${c.ko} 공휴일`,
        nfTitle: `없는 쪽입니다 — ${SITE}`,
        nfH1: '없는 쪽입니다',
        nfLede: '주소를 다시 확인해 주세요. 국가 페이지 주소는 두 글자 국가 코드입니다 — 대한민국은 <code>/kr/</code>, 미국은 <code>/us/</code>.',
        nfBack: '국가 목록으로 →',
    },
    en: {
        lang: 'en', dir: '/en', other: 'ko', locale: 'en_US',
        otherLabel: 'KO',            /* 버튼에 적히는 글자 = 눌렀을 때 가는 언어 */
        dow: EN_DOW,
        name: (c) => c.name,
        homeTitle: (n) => `${SITE} — public holidays in ${n} countries, counted down`,
        homeDesc: (n) => `Is today a holiday, and how many days until the next one? Public holidays for ${n} countries, in date order.`,
        homeH1: 'Is today a holiday?',
        homeLede: (n) => `See whether today is a public holiday and how many days remain until the next one. Your browser's region picks the country to start with; switch to any of ${n}.`,
        countriesCap: (n) => `${n} countries`,
        countriesH2: 'Holidays by country',
        searchLabel: 'Search countries',
        searchHint: 'Search — name or code',
        noCountry: 'No country matches.',
        pickerLabel: 'Country',
        title: (c, y) => `${c.name} Public Holidays ${y}`,
        desc: (c, y, n, local) => fit(
            `All ${n} public holidays in ${c.name} for ${y}, in date order, with the days until the next one.`,
            local ? ' Region-only days are marked.' : ''),
        h1: (c) => `${c.name} Public Holidays`,
        lede: (c, local) => `Statutory public holidays in ${c.name}. See at a glance whether today is a day off and how long until the next one.`
            + (local ? ' Days observed only in some regions carry the regions they apply to.' : ''),
        yearCap: (y, n) => `${y} · ${n} days`,
        yearH2: (c, y) => `${c.name} public holidays in ${y}`,
        thDate: 'Date', thName: 'Holiday',
        placeholderVerdict: (c, n) => `${n} public holidays in ${c.name}`,
        checking: 'Checking the date…', computing: 'Computing…',
        dtNext: 'Next', dtPrev: 'Last',
        otherCountries: 'Holidays in other countries →',
        localBadge: (n) => `${n} regions`,
        foot: (g) => `Holiday data from <a href="https://date.nager.at/" rel="noopener">Nager.Date</a> · only entries whose <code>types</code> includes <code>Public</code>. Updated ${g}.`,
        footTz: 'The countdown uses this device’s date — it can be a day out when you view a country in another time zone.',
        crumbCountry: (c) => `${c.name} public holidays`,
        nfTitle: `Not here — ${SITE}`,
        nfH1: 'Not here',
        nfLede: 'Check the address. Country pages use the two-letter country code — <code>/en/kr/</code> for South Korea, <code>/en/us/</code> for the United States.',
        nfBack: 'Back to the country list →',
    },
};

/* 두 언어가 서로를 가리키는 주소. 셋 다 양쪽 페이지에 똑같이 들어가야 한다. */
const url = (lang, slug) => `${BASE}${L[lang].dir}/${slug}`;

/* ------------------------------------------------------------------ 머리 */

function head(t, { title, desc, slug }) {
    return `<!DOCTYPE html>
<html lang="${t.lang}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="icon" href="/favicon.ico" sizes="48x48">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="icon" href="/icon-192.png" type="image/png" sizes="192x192">
  <link rel="apple-touch-icon" href="/apple-touch-icon.png">
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(desc)}">
  <link rel="canonical" href="${url(t.lang, slug)}">
  <link rel="alternate" hreflang="ko" href="${url('ko', slug)}">
  <link rel="alternate" hreflang="en" href="${url('en', slug)}">
  <link rel="alternate" hreflang="x-default" href="${url('en', slug)}">
  <meta property="og:type" content="website">
  <meta property="og:locale" content="${t.locale}">
  <meta property="og:locale:alternate" content="${L[t.other].locale}">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(desc)}">
  <meta property="og:url" content="${url(t.lang, slug)}">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Gowun+Batang:wght@400;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard-dynamic-subset.css">
  <link rel="stylesheet" href="/shared/base.css">
  <link rel="stylesheet" href="/shared/dday.css">
</head>`;
}

function top(t, { slug, home, label }) {
    const o = L[t.other];
    return `<div class="top"><div class="wrap">
  <a class="brand" href="${t.dir}/">${home ? '' : '← '}${SITE}</a>
  <nav>
${picker(t, label, [])}
    <a class="btn" href="${o.dir}/${slug}" hreflang="${o.lang}" lang="${o.lang}">${t.otherLabel}</a>
  </nav>
</div></div>`;
}

/* 선택기. items 가 비면 <ul> 만 두고 dday.js 가 채운다. */
function picker(t, label, items) {
    const li = items.map((c) => `        <li data-cc="${c.code}" data-ko="${esc(c.ko)}" data-en="${esc(c.name)}" data-key="${esc(searchKey(c))}"><a href="${t.dir}/${c.code.toLowerCase()}/" data-cc="${c.code}"><span class="flag">${flag(c.code)}</span>${esc(t.name(c))}<span class="cc">${c.code}</span></a></li>`).join('\n');

    return `    <details class="picker" id="picker">
      <summary>${label}</summary>
      <div class="panel">
        <input type="search" placeholder="${esc(t.searchHint)}" aria-label="${esc(t.searchLabel)}" autocomplete="off">
        <ul>
${li}
        </ul>
        <div class="none" hidden>${esc(t.noCountry)}</div>
      </div>
    </details>`;
}

const foot = (t, generated) => `  <div class="foot">
    <p>${t.foot(generated)}</p>
    <p>${t.footTz}</p>
  </div>`;

/* ------------------------------------------------------------ 국가 페이지 */

function table(t, days) {
    const rows = days.map((day) => {
        const [y, m, d] = day.d.split('-');
        const w = dow(day.d);
        const wcls = w === 0 ? ' sun' : w === 6 ? ' sat' : '';
        const local = day.r
            ? `<span class="local" title="${esc(day.r.join(', '))}">${esc(t.localBadge(day.r.length))}</span>` +
              `<span class="regions">${esc(day.r.join(' · '))}</span>`
            : '';
        /* 영어 페이지는 영어 이름을 앞세우고 현지어 이름을 아래에 둔다.
           영어 이름이 따로 없으면(e 가 없으면) 현지어 이름이 곧 영어 이름이다. */
        const primary = t.lang === 'en' ? (day.e || day.n) : day.n;
        const secondary = t.lang === 'en' ? (day.e ? day.n : '') : (day.e || '');
        const sub = secondary ? `<span class="en">${esc(secondary)}</span>` : '';
        return `        <tr data-d="${day.d}">
          <td class="date">${y}.${m}.${d}<span class="dow${wcls}">${t.dow[w]}</span></td>
          <td class="name">${esc(primary)}${local}${sub}</td>
          <td class="mark"></td>
        </tr>`;
    }).join('\n');

    return `      <table>
        <thead><tr><th>${esc(t.thDate)}</th><th>${esc(t.thName)}</th><th></th></tr></thead>
        <tbody>
${rows}
        </tbody>
      </table>`;
}

function countryPage(t, data) {
    const byYear = new Map();
    for (const day of data.days) {
        const y = +day.d.slice(0, 4);
        if (!byYear.has(y)) byYear.set(y, []);
        byYear.get(y).push(day);
    }

    /* 표지 연도 — 올해가 있으면 올해, 없으면 가진 것 중 가장 이른 해 */
    const years = [...byYear.keys()].sort((a, b) => a - b);
    const main = byYear.has(MID) ? MID : years[0];
    const localCount = data.days.filter((d) => d.r).length;
    const slug = `${data.code.toLowerCase()}/`;

    const sections = years.map((y) => {
        const body = table(t, byYear.get(y));
        if (y === main) {
            return `  <section>
    <span class="cap">${esc(t.yearCap(y, byYear.get(y).length))}</span>
    <h2>${esc(t.yearH2(data, y))}</h2>
${body}
  </section>`;
        }
        return `  <details class="year">
    <summary>${esc(t.yearCap(y, byYear.get(y).length))}</summary>
${body}
  </details>`;
    }).join('\n\n');

    const crumbs = {
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: [
            { '@type': 'ListItem', position: 1, name: SITE, item: `${BASE}${t.dir}/` },
            { '@type': 'ListItem', position: 2, name: t.crumbCountry(data), item: url(t.lang, slug) },
        ],
    };

    return `${head(t, {
        title: t.title(data, main),
        desc: t.desc(data, main, byYear.get(main).length, localCount),
        slug,
    })}
<body data-cc="${data.code}">

${top(t, { slug, label: `<span class="flag">${flag(data.code)}</span>${esc(t.name(data))}` })}

<main class="wrap">

  <h1>${esc(t.h1(data))}</h1>
  <p class="lede">${esc(t.lede(data, localCount))}</p>

  <div class="now" id="now">
    <div class="asof">${esc(t.checking)}</div>
    <div class="verdict">${esc(t.placeholderVerdict(data, data.days.length))}</div>
    <dl class="pair">
      <dt>${esc(t.dtNext)}</dt><dd id="next"><em>${esc(t.computing)}</em></dd>
      <dt>${esc(t.dtPrev)}</dt><dd id="prev"><em>${esc(t.computing)}</em></dd>
    </dl>
  </div>

${sections}

  <section>
    <p><a href="${t.dir}/#countries">${esc(t.otherCountries)}</a></p>
  </section>

${foot(t, data.generated)}
</main>

<script type="application/ld+json">${JSON.stringify(crumbs)}</script>
<script src="/shared/dday.js"></script>
</body>
</html>
`;
}

/* -------------------------------------------------------------- 첫 화면 */

function homePage(t, index, generated) {
    const n = index.length;
    const links = index.map((c) =>
        `      <li data-cc="${c.code}" data-key="${esc(searchKey(c))}"><a href="${t.dir}/${c.code.toLowerCase()}/">${flag(c.code)} ${esc(t.name(c))}<span class="cc">${c.code}</span></a></li>`
    ).join('\n');

    return `${head(t, { title: t.homeTitle(n), desc: t.homeDesc(n), slug: '' })}
<body>

${top(t, { slug: '', home: true, label: esc(t.pickerLabel) })}

<main class="wrap">

  <h1>${esc(t.homeH1)}</h1>
  <p class="lede">${esc(t.homeLede(n))}</p>

  <div class="now" id="home" hidden></div>

  <section id="countries">
    <span class="cap">${esc(t.countriesCap(n))}</span>
    <h2>${esc(t.countriesH2)}</h2>
    <input type="search" class="find" id="csearch" placeholder="${esc(t.searchHint)}" aria-label="${esc(t.searchLabel)}" autocomplete="off">
    <ul class="countries" id="clist">
${links}
    </ul>
    <div class="none" id="cnone" hidden>${esc(t.noCountry)}</div>
  </section>

${foot(t, generated)}
</main>

<script src="/shared/dday.js"></script>
</body>
</html>
`;
}

/* ---------------------------------------------------------------- 404
   canonical 도 hreflang 도 넣지 않는다 — 색인될 쪽이 아니다.
   Cloudflare 의 not_found_handling = "404-page" 는 경로를 거슬러 올라가며
   가장 가까운 404.html 을 찾는다. /en/404.html 을 함께 두면 /en/... 로 잘못
   들어온 사람이 영어 안내를 본다. */
function notFoundPage(t) {
    return `<!DOCTYPE html>
<html lang="${t.lang}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="icon" href="/favicon.ico" sizes="48x48">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="icon" href="/icon-192.png" type="image/png" sizes="192x192">
  <link rel="apple-touch-icon" href="/apple-touch-icon.png">
  <title>${esc(t.nfTitle)}</title>
  <meta name="robots" content="noindex">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Gowun+Batang:wght@400;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard-dynamic-subset.css">
  <link rel="stylesheet" href="/shared/base.css">
  <link rel="stylesheet" href="/shared/dday.css">
</head>
<body>

<div class="top"><div class="wrap">
  <a class="brand" href="${t.dir}/">← ${SITE}</a>
</div></div>

<main class="wrap">
  <h1>${esc(t.nfH1)}</h1>
  <p class="lede">${t.nfLede}</p>
  <p><a href="${t.dir}/#countries">${esc(t.nfBack)}</a></p>
</main>

</body>
</html>
`;
}

/* ------------------------------------------------------------------ 실행 */

const index = JSON.parse(readFileSync(join(DATA, 'countries.json'), 'utf8'));
const files = readdirSync(DATA).filter((f) => f.endsWith('.json') && f !== 'countries.json');

if (index.some((c) => c.code === 'EN')) {
    console.error('국가 코드 EN 이 생겼다 — /en/ 언어 칸과 부딪힌다. 언어 칸 주소를 바꿀 것.');
    process.exit(1);
}

/* 이전에 만든 국가·언어 디렉터리를 먼저 지운다. Nager 에서 빠진 국가의 페이지가
   남으면 sitemap 에는 없는데 링크만 살아 있는 유령이 된다. 'en' 도 두 글자라
   이 규칙에 함께 걸려 통째로 다시 만들어진다. */
for (const name of readdirSync(PUB, { withFileTypes: true })) {
    if (name.isDirectory() && /^[a-z]{2}$/.test(name.name)) {
        rmSync(join(PUB, name.name), { recursive: true });
    }
}

let generated = today();
let count = 0;

for (const lang of ['ko', 'en']) {
    const t = L[lang];
    const root = join(PUB, t.dir.replace(/^\//, ''));

    /* countries.json 은 한글 이름순으로 저장돼 있다. 영어 페이지에서 그대로 쓰면
       Ghana 가 맨 앞에 오는(가나) 무작위 순서로 보인다 — 보이는 이름으로 다시 정렬한다. */
    const sorted = [...index].sort((a, b) =>
        t.name(a).localeCompare(t.name(b), t.lang));

    for (const file of files) {
        const data = JSON.parse(readFileSync(join(DATA, file), 'utf8'));
        if (!data.days.length) continue;
        generated = data.generated || generated;

        const dir = join(root, data.code.toLowerCase());
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, 'index.html'), countryPage(t, data));
        count++;
    }

    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, 'index.html'), homePage(t, sorted, generated));
    writeFileSync(join(root, '404.html'), notFoundPage(t));
    count++;
}

console.log(`페이지 ${count}개 (한국어·영어 각 ${count / 2}개) — 표지 연도 ${MID}`);
