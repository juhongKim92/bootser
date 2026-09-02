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

   선택기 <ul> 은 어느 페이지에서도 비워 둔다 — 204개 <li> × 410개 페이지면
   HTML 만 7MB 가 된다. dday.js 가 countries.json 으로 채운다.
   첫 화면의 국가 목록은 그와 별개로 HTML 에 박혀 있어서, 자바스크립트가 없어도
   204개국으로 갈 수 있다.

   'en' 은 국가 코드가 아니다(ISO 3166-1 에 없다). 그래서 /en/ 을 언어 칸으로
   써도 국가 경로와 부딪히지 않는데, Nager 목록이 바뀌어 부딪히면 조용히
   덮어써 버리므로 아래에서 확인하고 멈춘다.
   ============================================================ */
import { readFileSync, readdirSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { BASE, PUB, DATA, YEARS, EXTRA, today } from './config.mjs';
import { CARDINAL } from './astro.mjs';
import { CARD_W, CARD_H, CARD_DIR } from './card-art.mjs';

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

/* 연휴 일수를 세는 데만 쓴다. 자료에는 일수를 담지 않는다 — 시작·끝에서 나오므로
   담아 두면 두 값이 갈라질 수 있다. */
const epochDay = (iso) => {
    const [y, m, d] = iso.split('-').map(Number);
    return Math.round(Date.UTC(y, m - 1, d) / 86400000);
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
        /* 하늘 페이지의 기준 시간대. sky.json 의 zones 와 같은 것을 가리켜야 한다 —
           절기는 온 세계가 같은 순간을 공유하지만 날짜는 시간대마다 갈린다. */
        zone: 'kst', zoneLabel: '한국 표준시(KST)',
        name: (c) => c.ko,
        homeTitle: (n) => `${SITE} — ${n}개국 공휴일·황금연휴와 절기·삭망 D-day`,
        homeDesc: (n) => `오늘이 무슨 날인지, 다음까지 며칠 남았는지. 대한민국을 비롯한 ${n}개국의 법정 공휴일과 황금연휴, 그리고 24절기·삭망·유성우를 날짜순으로 봅니다.`,
        homeH1: '오늘은 무슨 날인가',
        homeLede: '공휴일과 황금연휴, 절기와 삭망까지. 오늘이 어떤 날인지, 다음까지 며칠 남았는지 봅니다.',
        countriesCap: (n) => `국가 ${n}개`,
        countriesH2: '국가별 공휴일',
        todayCap: '전 세계',
        todayH2: '오늘 공휴일인 나라',
        todayWait: '확인하는 중…',
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
        breakCap: (y, n) => `${y}년 · 연휴 ${n}회`,
        breakH2: (c, y) => `${y}년 ${c.ko} 황금연휴`,
        breakNote: '주말과 공휴일이 이어져 사흘 이상 쉬는 구간입니다. 하루만 더 쓰면 이어지는 날은 징검다리로 적었습니다.',
        thSpan: '기간', thBreak: '연휴',
        breakLen: (n) => `${n}일 연휴`,
        bridgeBadge: (n) => `징검다리 ${n}일`,
        placeholderVerdict: (c, n) => `${c.ko} 공휴일 ${n}일`,
        checking: '날짜를 확인하는 중…', computing: '계산하는 중…',
        dtNext: '다음', dtPrev: '지난', dtBreak: '다음 연휴',
        otherCountries: '다른 국가 공휴일 보기 →',
        localBadge: (n) => `일부 지역 ${n}곳`,
        foot: (g) => `공휴일 자료 <a href="https://date.nager.at/" rel="noopener">Nager.Date</a> · <code>types</code> 가 <code>Public</code> 인 항목만 담았습니다. 갱신 ${g}.`,
        footTz: 'D-day 는 이 기기의 날짜로 계산합니다 — 다른 시간대의 국가를 볼 때는 하루 어긋날 수 있습니다.',
        crumbCountry: (c) => `${c.ko} 공휴일`,

        /* --- 하늘 --- */
        skyTitle: (y) => `${y}년 절기와 삭망 — 24절기 날짜와 D-day`,
        skyDesc: (y) => `${y}년 24절기와 삭·보름, 유성우 극대기를 날짜순으로. 다음 절기까지 남은 날을 함께 보여줍니다. 한국 표준시 기준.`,
        skyH1: '절기와 삭망',
        skyLede: '24절기와 삭·보름, 유성우 극대기입니다. 다음 절기까지 며칠 남았는지 바로 보여줍니다.',
        skyCrumb: '절기와 삭망',
        skyLink: '절기와 삭망 전체 보기 →',
        skyHomeCap: '하늘',
        skyHomeH2: '다가오는 절기와 삭망',
        termsCap: (y, n) => `${y}년 · 절기 ${n}개`,
        termsH2: (y) => `${y}년 24절기`,
        moonsCap: (y, n) => `${y}년 · 삭망 ${n}회`,
        moonsH2: (y) => `${y}년 삭과 보름`,
        showersCap: (y, n) => `${y}년 · 유성우 ${n}개`,
        showersH2: (y) => `${y}년 유성우 극대기`,
        thTime: '날짜와 시각', thEvent: '천문 현상',
        newMoon: '삭', fullMoon: '보름', han: { new: '朔', full: '望' },
        showerName: (n) => `${n} 유성우`,
        zhr: (n) => `조건이 좋으면 시간당 ${n}개`,
        cardinal: { equinox: '분점', solstice: '지점' },
        dtTerm: '다음 절기', dtNew: '다음 삭', dtFull: '다음 보름', dtShower: '다음 유성우',
        skyVerdict: '오늘 하늘',
        skyNote: '절기와 삭망은 온 세계가 같은 순간을 공유하지만, 날짜는 시간대마다 갈립니다. 이 페이지의 날짜와 시각은 모두 한국 표준시(KST) 기준입니다.',
        skyFoot: '절기·삭망은 VSOP87D(태양)와 Meeus 제49장(달)으로 직접 계산합니다. 유성우 극대기는 국제유성기구가 쓰는 태양 황경으로 구합니다.',
        contact: '문의',
        nfTitle: `없는 쪽입니다 — ${SITE}`,
        nfH1: '없는 쪽입니다',
        nfLede: '주소를 다시 확인해 주세요. 국가 페이지 주소는 두 글자 국가 코드입니다 — 대한민국은 <code>/kr/</code>, 미국은 <code>/us/</code>.',
        nfBack: '국가 목록으로 →',
    },
    en: {
        lang: 'en', dir: '/en', other: 'ko', locale: 'en_US',
        otherLabel: 'KO',            /* 버튼에 적히는 글자 = 눌렀을 때 가는 언어 */
        dow: EN_DOW,
        zone: 'utc', zoneLabel: 'UTC',
        name: (c) => c.name,
        homeTitle: () => `${SITE} — public holidays, long weekends and the sky`,
        homeDesc: (n) => `What is today, and how long until the next one? Public holidays and long weekends for ${n} countries, plus solar terms, moon phases and meteor showers.`,
        homeH1: 'What day is today?',
        homeLede: 'Public holidays and long weekends, solar terms and moon phases. See what today is and how long until the next one.',
        countriesCap: (n) => `${n} countries`,
        countriesH2: 'Holidays by country',
        todayCap: 'Around the world',
        todayH2: 'Countries on holiday today',
        todayWait: 'Checking…',
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
        breakCap: (y, n) => `${y} · ${n} long weekends`,
        breakH2: (c, y) => `${c.name} Long Weekends ${y}`,
        breakNote: 'Stretches of three days or more where weekends and public holidays run together. Days you would have to take off to join them up are marked as bridge days.',
        thSpan: 'Dates', thBreak: 'Break',
        breakLen: (n) => `${n}-day break`,
        bridgeBadge: (n) => (n === 1 ? '1 bridge day' : `${n} bridge days`),
        placeholderVerdict: (c, n) => `${n} public holidays in ${c.name}`,
        checking: 'Checking the date…', computing: 'Computing…',
        dtNext: 'Next', dtPrev: 'Last', dtBreak: 'Next break',
        otherCountries: 'Holidays in other countries →',
        localBadge: (n) => `${n} regions`,
        foot: (g) => `Holiday data from <a href="https://date.nager.at/" rel="noopener">Nager.Date</a> · only entries whose <code>types</code> includes <code>Public</code>. Updated ${g}.`,
        footTz: 'The countdown uses this device’s date — it can be a day out when you view a country in another time zone.',
        crumbCountry: (c) => `${c.name} public holidays`,

        /* --- 하늘 --- */
        skyTitle: (y) => `Solar Terms and Moon Phases ${y}`,
        skyDesc: (y) => `All 24 solar terms for ${y} with new and full moons and meteor shower peaks, in date order, with the days until the next one. Times in UTC.`,
        skyH1: 'Solar Terms and Moon Phases',
        skyLede: 'The 24 solar terms, new and full moons, and meteor shower peaks. See at a glance how long until the next one.',
        skyCrumb: 'solar terms and moon phases',
        skyLink: 'All solar terms and moon phases →',
        skyHomeCap: 'The sky',
        skyHomeH2: 'Coming up in the sky',
        termsCap: (y, n) => `${y} · ${n} solar terms`,
        termsH2: (y) => `The 24 solar terms of ${y}`,
        moonsCap: (y, n) => `${y} · ${n} phases`,
        moonsH2: (y) => `New and full moons in ${y}`,
        showersCap: (y, n) => `${y} · ${n} showers`,
        showersH2: (y) => `Meteor shower peaks in ${y}`,
        thTime: 'Date and time', thEvent: 'Event',
        newMoon: 'New Moon', fullMoon: 'Full Moon', han: { new: '朔', full: '望' },
        showerName: (n) => `${n}`,
        zhr: (n) => `up to ${n} an hour in good conditions`,
        cardinal: { equinox: 'equinox', solstice: 'solstice' },
        dtTerm: 'Next term', dtNew: 'Next new moon', dtFull: 'Next full moon', dtShower: 'Next shower',
        skyVerdict: 'Today',
        skyNote: 'These moments are shared by the whole world, but the date they fall on depends on the time zone. Every date and time on this page is UTC.',
        skyFoot: 'Solar terms and moon phases are computed here — VSOP87D for the Sun, Meeus chapter 49 for the Moon. Shower peaks use the solar longitude the International Meteor Organization defines them by.',
        contact: 'Contact',
        nfTitle: `Not here — ${SITE}`,
        nfH1: 'Not here',
        nfLede: 'Check the address. Country pages use the two-letter country code — <code>/en/kr/</code> for South Korea, <code>/en/us/</code> for the United States.',
        nfBack: 'Back to the country list →',
    },
};

/* 두 언어가 서로를 가리키는 주소. 셋 다 양쪽 페이지에 똑같이 들어가야 한다. */
const url = (lang, slug) => `${BASE}${L[lang].dir}/${slug}`;

/* ------------------------------------------------------------------ 머리 */

function head(t, { title, desc, slug, card, alt }) {
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
  <meta property="og:image" content="${BASE}/${CARD_DIR}/${card}.png">
  <meta property="og:image:width" content="${CARD_W}">
  <meta property="og:image:height" content="${CARD_H}">
  <meta property="og:image:alt" content="${esc(alt)}">
  <meta name="twitter:card" content="summary_large_image">
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
${picker(t, label)}
    <a class="btn" href="${o.dir}/${slug}" hreflang="${o.lang}" lang="${o.lang}">${t.otherLabel}</a>
  </nav>
</div></div>`;
}

/* 선택기. <ul> 은 늘 비워 두고 dday.js 가 countries.json 으로 채운다 —
   204개 <li> 를 410개 페이지에 인라인하면 HTML 만 7MB 가 된다.
   자바스크립트가 없으면 선택기는 빈 채로 남지만, 첫 화면의 국가 목록은
   HTML 에 그대로 박혀 있어서 거기서 고를 수 있다. */
function picker(t, label) {
    return `    <details class="picker" id="picker">
      <summary>${label}</summary>
      <div class="panel">
        <input type="search" placeholder="${esc(t.searchHint)}" aria-label="${esc(t.searchLabel)}" autocomplete="off">
        <ul></ul>
        <div class="none" hidden>${esc(t.noCountry)}</div>
      </div>
    </details>`;
}

/* 연락처. 완성된 주소는 HTML 어디에도 없다 — 로컬 파트와 도메인을 뒤집어 담고
   shared/contact.js 가 합친다. '@' 는 소스에 아예 등장하지 않는다.
   backend-internals 와 같은 방식이고 같은 파일을 쓴다. */
const CONTACT = '<span data-contact data-u="tcatnoc" data-d="moc.91noilimrev">'
    + '<noscript>contact (at) vermilion19 (dot) com</noscript></span>';

const foot = (t, generated) => `  <div class="foot">
    <p>${t.foot(generated)}</p>
    <p>${t.footTz}</p>
    <p>${t.contact} ${CONTACT}</p>
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

/* ------------------------------------------------------------ 황금연휴 표

   공휴일 표와 나란한 모양이지만 행이 날짜 하나가 아니라 구간이라 열이 다르다.
   D-day 는 여기서도 비워 두고 dday.js 가 붙인다 — 시작 전이면 D-, 끝난 뒤면 D+,
   그 사이면 "연휴 중" 이다.

   이름 칸을 class="name" 이 아니라 class="len" 으로 두는 이유가 있다.
   check-pages 의 한국어 누출 검사는 <td class="name"> 을 들어내고 본다 —
   거기 들어가는 공휴일 이름은 자료(현지어)라서 영어 페이지에도 한글이 올 수 있기
   때문이다. 연휴 칸은 우리가 쓰는 말이므로 그 면제를 받으면 안 된다. */
const NUM = (iso) => { const [y, m, d] = iso.split('-'); return { y, m, d }; };

function breakSpan(t, s, e) {
    const a = NUM(s), b = NUM(e);
    const cell = (p, iso, withYear) => {
        const w = dow(iso);
        const wcls = w === 0 ? ' sun' : w === 6 ? ' sat' : '';
        return `${withYear ? p.y + '.' : ''}${p.m}.${p.d}<span class="dow${wcls}">${t.dow[w]}</span>`;
    };
    /* 연말에 걸친 연휴만 끝쪽에도 연도를 적는다 — 늘 적으면 좁은 화면에서 넘친다 */
    return `${cell(a, s, true)} ~ ${cell(b, e, a.y !== b.y)}`;
}

function breakTable(t, items) {
    const rows = items.map((w) => {
        const n = (epochDay(w.e) - epochDay(w.s)) + 1;
        const bridge = w.b?.length
            ? `<span class="bridge" title="${esc(w.b.join(', '))}">${esc(t.bridgeBadge(w.b.length))}</span>`
            : '';
        return `        <tr data-s="${w.s}" data-e="${w.e}">
          <td class="range">${breakSpan(t, w.s, w.e)}</td>
          <td class="len">${esc(t.breakLen(n))}${bridge}</td>
          <td class="mark"></td>
        </tr>`;
    }).join('\n');

    return `      <table class="breaks">
        <thead><tr><th>${esc(t.thSpan)}</th><th>${esc(t.thBreak)}</th><th></th></tr></thead>
        <tbody>
${rows}
        </tbody>
      </table>`;
}

function countryPage(t, data) {
    /* 자료가 낡으면 연휴 섹션만 조용히 빠진다. 그게 가장 알아채기 어려우니 멈춘다. */
    if (!Array.isArray(data.long)) {
        console.error(`data/${data.code}.json 에 long 이 없다 — node tools/gen-holidays.mjs 를 먼저 돌릴 것.`);
        process.exit(1);
    }

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

    /* 황금연휴. 공휴일과 같은 해 나눔을 쓴다 — 표지 연도는 펼쳐 두고 나머지는 접는다.
       연휴가 한 건도 없는 국가가 있어서(공휴일이 늘 주중 한복판인 곳) 통째로 뺀다. */
    const breaksByYear = new Map();
    for (const w of data.long) {
        const y = +w.s.slice(0, 4);
        if (!breaksByYear.has(y)) breaksByYear.set(y, []);
        breaksByYear.get(y).push(w);
    }
    const breakYears = [...breaksByYear.keys()].sort((a, b) => a - b);
    const breakMain = breaksByYear.has(main) ? main : breakYears[0];

    const breaks = !data.long.length ? '' : '\n\n' + breakYears.map((y) => {
        const body = breakTable(t, breaksByYear.get(y));
        if (y === breakMain) {
            return `  <section>
    <span class="cap">${esc(t.breakCap(y, breaksByYear.get(y).length))}</span>
    <h2>${esc(t.breakH2(data, y))}</h2>
    <p class="note">${esc(t.breakNote)}</p>
${body}
  </section>`;
        }
        return `  <details class="year">
    <summary>${esc(t.breakCap(y, breaksByYear.get(y).length))}</summary>
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
        card: data.code.toLowerCase(),
        alt: `${t.crumbCountry(data)} — ${SITE}`,
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
      <dt>${esc(t.dtPrev)}</dt><dd id="prev"><em>${esc(t.computing)}</em></dd>${data.long.length ? `
      <dt>${esc(t.dtBreak)}</dt><dd id="break"><em>${esc(t.computing)}</em></dd>` : ''}
    </dl>
  </div>

${sections}${breaks}

  <section>
    <p><a href="${t.dir}/#countries">${esc(t.otherCountries)}</a></p>
  </section>

${foot(t, data.generated)}
</main>

<script type="application/ld+json">${JSON.stringify(crumbs)}</script>
<script src="/shared/dday.js"></script>
<script src="/shared/contact.js"></script>
</body>
</html>
`;
}

/* ---------------------------------------------------------------- 하늘

   국가 페이지와 달리 자료가 한 벌이다 — 절기도 삭망도 유성우도 온 세계가 같은
   순간을 공유한다. 갈리는 것은 **날짜**뿐이고, 그건 sky.json 이 기준 시간대마다
   미리 굳혀 두었다 (ko=KST · en=UTC). 여기서 다시 계산하지 않는다.

   이름 칸을 class="ev" 로 두는 이유는 황금연휴의 class="len" 과 같다 —
   한국어 누출 검사는 <td class="name"> 을 면제하는데, 이 칸의 말은 우리 것이라
   그 면제를 받으면 안 된다. */
const skyDate = (e, t) => (t.zone === 'kst' ? e.kst : e.utc);
const skyTime = (e, t) => (t.zone === 'kst' ? e.kh : e.uh);

function skyRow(t, e, kind, name, alt, badge) {
    const iso = skyDate(e, t);
    const [y, m, d] = iso.split('-');
    const w = dow(iso);
    const wcls = w === 0 ? ' sun' : w === 6 ? ' sat' : '';
    return `        <tr data-d="${iso}" data-sky="${kind}">
          <td class="date">${y}.${m}.${d}<span class="dow${wcls}">${t.dow[w]}</span><span class="at">${skyTime(e, t)}</span></td>
          <td class="ev">${esc(name)}${badge || ''}${alt ? `<span class="alt">${esc(alt)}</span>` : ''}</td>
          <td class="mark"></td>
        </tr>`;
}

function skyTable(t, rows) {
    return `      <table class="sky">
        <thead><tr><th>${esc(t.thTime)}</th><th>${esc(t.thEvent)}</th><th></th></tr></thead>
        <tbody>
${rows.join('\n')}
        </tbody>
      </table>`;
}

/* 표지 연도는 펼치고 나머지 해는 접는다 — 공휴일·황금연휴와 같은 규칙이다. */
function skyGroup(t, byYear, cap, h2, build) {
    const years = [...byYear.keys()].sort((a, b) => a - b);
    const head = byYear.has(MID) ? MID : years[0];
    return years.map((y) => {
        const body = skyTable(t, byYear.get(y).map(build));
        if (y === head) {
            return `  <section>
    <span class="cap">${esc(cap(y, byYear.get(y).length))}</span>
    <h2>${esc(h2(y))}</h2>
${body}
  </section>`;
        }
        return `  <details class="year">
    <summary>${esc(cap(y, byYear.get(y).length))}</summary>
${body}
  </details>`;
    }).join('\n\n');
}

const groupBy = (list, key) => {
    const m = new Map();
    for (const e of list) {
        const y = +key(e).slice(0, 4);
        if (!m.has(y)) m.set(y, []);
        m.get(y).push(e);
    }
    return m;
};

function skyPage(t, sky) {
    const slug = 'sky/';
    const by = (list) => groupBy(list, (e) => skyDate(e, t));

    const terms = skyGroup(t, by(sky.terms), t.termsCap, t.termsH2, (e) => {
        const badge = CARDINAL[e.k]
            ? `<span class="cardinal">${esc(t.cardinal[CARDINAL[e.k]])}</span>` : '';
        return skyRow(t, e, 'term', t.lang === 'en' ? e.e : e.n, e.h, badge);
    });
    const moons = skyGroup(t, by(sky.moons), t.moonsCap, t.moonsH2, (e) =>
        skyRow(t, e, 'moon', e.f ? t.fullMoon : t.newMoon, e.f ? t.han.full : t.han.new));
    const showers = skyGroup(t, by(sky.showers), t.showersCap, t.showersH2, (e) =>
        skyRow(t, e, 'shower', t.showerName(t.lang === 'en' ? e.e : e.n), t.zhr(e.z)));

    const crumbs = {
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: [
            { '@type': 'ListItem', position: 1, name: SITE, item: `${BASE}${t.dir}/` },
            { '@type': 'ListItem', position: 2, name: t.skyCrumb, item: url(t.lang, slug) },
        ],
    };

    return `${head(t, { title: t.skyTitle(MID), desc: t.skyDesc(MID), slug, card: 'sky', alt: `${t.skyCrumb} — ${SITE}` })}
<body data-sky="1">

${top(t, { slug, label: esc(t.pickerLabel) })}

<main class="wrap">

  <h1>${esc(t.skyH1)}</h1>
  <p class="lede">${esc(t.skyLede)}</p>

  <div class="now" id="now">
    <div class="asof">${esc(t.checking)}</div>
    <div class="verdict">${esc(t.skyVerdict)}</div>
    <dl class="pair">
      <dt>${esc(t.dtTerm)}</dt><dd id="next-term"><em>${esc(t.computing)}</em></dd>
      <dt>${esc(t.dtNew)}</dt><dd id="next-new"><em>${esc(t.computing)}</em></dd>
      <dt>${esc(t.dtFull)}</dt><dd id="next-full"><em>${esc(t.computing)}</em></dd>
      <dt>${esc(t.dtShower)}</dt><dd id="next-shower"><em>${esc(t.computing)}</em></dd>
    </dl>
  </div>

  <p class="note">${esc(t.skyNote)}</p>

${terms}

${moons}

${showers}

  <section>
    <p><a href="${t.dir}/#countries">${esc(t.otherCountries)}</a></p>
  </section>

  <div class="foot">
    <p>${esc(t.skyFoot)}</p>
    <p>${t.contact} ${CONTACT}</p>
  </div>
</main>

<script type="application/ld+json">${JSON.stringify(crumbs)}</script>
<script src="/shared/dday.js"></script>
<script src="/shared/contact.js"></script>
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

    return `${head(t, { title: t.homeTitle(n), desc: t.homeDesc(n), slug: '', card: 'home', alt: SITE })}
<body>

${top(t, { slug: '', home: true, label: esc(t.pickerLabel) })}

<main class="wrap">

  <h1>${esc(t.homeH1)}</h1>
  <p class="lede">${esc(t.homeLede)}</p>

  <div class="now" id="home" hidden></div>

  <section id="today">
    <span class="cap" id="tcap">${esc(t.todayCap)}</span>
    <h2>${esc(t.todayH2)}</h2>
    <p class="pending" id="tnote">${esc(t.todayWait)}</p>
    <ul class="worldwide" id="tlist"></ul>
  </section>

  <section id="sky">
    <span class="cap">${esc(t.skyHomeCap)}</span>
    <h2>${esc(t.skyHomeH2)}</h2>
    <ul class="worldwide" id="skylist"></ul>
    <p><a href="${t.dir}/sky/">${esc(t.skyLink)}</a></p>
  </section>

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
<script src="/shared/contact.js"></script>
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

  <div class="foot">
    <p>${t.contact} ${CONTACT}</p>
  </div>
</main>

<script src="/shared/contact.js"></script>
</body>
</html>
`;
}

/* ------------------------------------------------------------------ 실행 */

const index = JSON.parse(readFileSync(join(DATA, 'countries.json'), 'utf8'));
const SPECIAL = new Set(['countries.json', 'sky.json']);
const files = readdirSync(DATA).filter((f) => f.endsWith('.json') && !SPECIAL.has(f));

if (index.some((c) => c.code === 'EN')) {
    console.error('국가 코드 EN 이 생겼다 — /en/ 언어 칸과 부딪힌다. 언어 칸 주소를 바꿀 것.');
    process.exit(1);
}

/* 국가가 아닌 슬러그가 국가 코드와 부딪히면 국가 페이지를 조용히 덮어쓴다.
   지금은 'sky' 가 세 글자라 안 부딪히지만, 늘어날 때를 위해 확인해 둔다. */
for (const slug of EXTRA) {
    if (index.some((c) => c.code.toLowerCase() === slug)) {
        console.error(`슬러그 '${slug}' 가 국가 코드와 부딪힌다 — 다른 이름을 쓸 것.`);
        process.exit(1);
    }
}

const skyFile = join(DATA, 'sky.json');
if (!existsSync(skyFile)) {
    console.error('data/sky.json 이 없다 — node tools/gen-sky.mjs 를 먼저 돌릴 것.');
    process.exit(1);
}
const sky = JSON.parse(readFileSync(skyFile, 'utf8'));

/* 이전에 만든 국가·언어 디렉터리를 먼저 지운다. Nager 에서 빠진 국가의 페이지가
   남으면 sitemap 에는 없는데 링크만 살아 있는 유령이 된다. 'en' 도 두 글자라
   이 규칙에 함께 걸려 통째로 다시 만들어진다.
   국가가 아닌 슬러그(EXTRA)는 두 글자가 아니라서 따로 지운다. */
for (const name of readdirSync(PUB, { withFileTypes: true })) {
    if (name.isDirectory() && (/^[a-z]{2}$/.test(name.name) || EXTRA.includes(name.name))) {
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

    /* 하늘 페이지. 국가 축이 아니라 전 세계 공통 축이라 자료가 한 벌이다. */
    const skyDir = join(root, 'sky');
    mkdirSync(skyDir, { recursive: true });
    writeFileSync(join(skyDir, 'index.html'), skyPage(t, sky));
    count++;

    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, 'index.html'), homePage(t, sorted, generated));
    writeFileSync(join(root, '404.html'), notFoundPage(t));
    count++;
}

console.log(`페이지 ${count}개 (한국어·영어 각 ${count / 2}개) — 표지 연도 ${MID}`);
