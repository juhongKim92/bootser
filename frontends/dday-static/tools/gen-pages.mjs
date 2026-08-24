/* ============================================================
   public/data/*.json → public/{cc}/index.html · public/index.html
   실행: node tools/gen-pages.mjs   (frontends/dday-static 에서)
   ------------------------------------------------------------
   공휴일 목록은 HTML 안에 그대로 박는다. 자바스크립트를 꺼도 읽히고, 크롤러가
   "2026년 대한민국 공휴일" 을 찾을 때 실제로 그 문자열이 문서에 있다.
   날짜에 따라 달라지는 것(D-day · 오늘 여부)만 shared/dday.js 가 붙인다.

   선택기 <ul> 은 첫 화면에만 인라인하고 국가 페이지에서는 비워 둔다 —
   204개 <li> × 204개 페이지면 HTML 만 3.7MB 가 된다. 국가 페이지는
   dday.js 가 countries.json 으로 채운다.
   ============================================================ */
import { readFileSync, readdirSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { BASE, PUB, DATA, YEARS, today } from './config.mjs';

const DOW = ['일', '월', '화', '수', '목', '금', '토'];
const SITE = '오늘 뭐 쉬나';
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

/* ------------------------------------------------------------------ 머리 */

function head({ title, desc, path }) {
    const url = `${BASE}${path}`;
    return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="icon" href="/favicon.ico" sizes="48x48">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="icon" href="/icon-192.png" type="image/png" sizes="192x192">
  <link rel="apple-touch-icon" href="/apple-touch-icon.png">
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(desc)}">
  <link rel="canonical" href="${url}">
  <meta property="og:type" content="website">
  <meta property="og:locale" content="ko_KR">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(desc)}">
  <meta property="og:url" content="${url}">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Gowun+Batang:wght@400;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard-dynamic-subset.css">
  <link rel="stylesheet" href="/shared/base.css">
  <link rel="stylesheet" href="/shared/dday.css">
</head>`;
}

/* 선택기. items 가 비면 <ul> 만 두고 dday.js 가 채운다. */
function picker(label, items) {
    const li = items.map((c) => `      <li data-cc="${c.code}" data-ko="${esc(c.ko)}" data-en="${esc(c.name)}" data-key="${esc([c.ko, c.name, c.code].join(' ').toLowerCase())}"><a href="/${c.code.toLowerCase()}/" data-cc="${c.code}"><span class="flag">${flag(c.code)}</span>${esc(c.ko)}<span class="cc">${c.code}</span></a></li>`).join('\n');

    return `<details class="picker" id="picker">
    <summary>${label}</summary>
    <div class="panel">
      <input type="search" placeholder="국가 검색 — 한글·영어·코드" aria-label="국가 검색" autocomplete="off">
      <ul>
${li}
      </ul>
      <div class="none" hidden>찾는 국가가 없습니다.</div>
    </div>
  </details>`;
}

const foot = (generated) => `  <div class="foot">
    <p>공휴일 자료 <a href="https://date.nager.at/" rel="noopener">Nager.Date</a> · <code>types</code> 가 <code>Public</code> 인 항목만 담았습니다. 갱신 ${generated}.</p>
    <p>D-day 는 이 기기의 날짜로 계산합니다 — 다른 시간대의 국가를 볼 때는 하루 어긋날 수 있습니다.</p>
  </div>`;

/* ------------------------------------------------------------ 국가 페이지 */

function table(days) {
    const rows = days.map((day) => {
        const [y, m, d] = day.d.split('-');
        const w = dow(day.d);
        const wcls = w === 0 ? ' sun' : w === 6 ? ' sat' : '';
        const local = day.r
            ? `<span class="local" title="${esc(day.r.join(', '))}">일부 지역 ${day.r.length}곳</span>` +
              `<span class="regions">${esc(day.r.join(' · '))}</span>`
            : '';
        const en = day.e ? `<span class="en">${esc(day.e)}</span>` : '';
        return `        <tr data-d="${day.d}">
          <td class="date">${y}.${m}.${d}<span class="dow${wcls}">${DOW[w]}</span></td>
          <td class="name">${esc(day.n)}${local}${en}</td>
          <td class="mark"></td>
        </tr>`;
    }).join('\n');

    return `      <table>
        <thead><tr><th>날짜</th><th>공휴일</th><th></th></tr></thead>
        <tbody>
${rows}
        </tbody>
      </table>`;
}

function countryPage(data) {
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

    const title = `${main}년 ${data.ko} 공휴일 — 날짜와 다음 공휴일까지 며칠`;
    const desc = `${main}년 ${data.ko}(${data.name})의 공휴일 ${byYear.get(main).length}일을 날짜순으로. ` +
        `다음 공휴일까지 남은 날을 함께 보여줍니다.` +
        (localCount ? ` 일부 지역만 쉬는 날은 지역을 표시합니다.` : '');
    const path = `/${data.code.toLowerCase()}/`;

    const sections = years.map((y) => {
        const body = table(byYear.get(y));
        if (y === main) {
            return `  <section>
    <span class="cap">${y}년 · ${byYear.get(y).length}일</span>
    <h2>${y}년 ${esc(data.ko)} 공휴일</h2>
${body}
  </section>`;
        }
        return `  <details class="year">
    <summary>${y}년 · ${byYear.get(y).length}일</summary>
${body}
  </details>`;
    }).join('\n\n');

    const crumbs = {
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: [
            { '@type': 'ListItem', position: 1, name: SITE, item: `${BASE}/` },
            { '@type': 'ListItem', position: 2, name: `${data.ko} 공휴일`, item: `${BASE}${path}` },
        ],
    };

    return `${head({ title, desc, path })}
<body data-cc="${data.code}">

<div class="top"><div class="wrap">
  <a class="brand" href="/">← ${SITE}</a>
  ${picker(`<span class="flag">${flag(data.code)}</span>${esc(data.ko)}`, [])}
</div></div>

<main class="wrap">

  <h1>${esc(data.ko)} 공휴일</h1>
  <p class="lede">${esc(data.ko)}${data.ko === data.name ? '' : `(${esc(data.name)})`}의 법정 공휴일입니다. 오늘이 쉬는 날인지, 다음 공휴일까지 며칠 남았는지 바로 보여줍니다.${localCount ? ' 일부 지역만 쉬는 날에는 해당 지역을 함께 적었습니다.' : ''}</p>

  <div class="now" id="now">
    <div class="asof">날짜를 확인하는 중…</div>
    <div class="verdict">${esc(data.ko)} 공휴일 ${data.days.length}일</div>
    <dl class="pair">
      <dt>다음</dt><dd id="next"><em>계산하는 중…</em></dd>
      <dt>지난</dt><dd id="prev"><em>계산하는 중…</em></dd>
    </dl>
  </div>

${sections}

  <section>
    <p><a href="/#countries">다른 국가 공휴일 보기 →</a></p>
  </section>

${foot(data.generated)}
</main>

<script type="application/ld+json">${JSON.stringify(crumbs)}</script>
<script src="/shared/dday.js"></script>
</body>
</html>
`;
}

/* -------------------------------------------------------------- 첫 화면 */

function homePage(index, generated) {
    const title = `${SITE} — ${index.length}개국 공휴일과 다음 공휴일까지 D-day`;
    const desc = `오늘이 공휴일인지, 다음 공휴일까지 며칠 남았는지. 대한민국을 비롯한 ${index.length}개국의 법정 공휴일을 날짜순으로 봅니다.`;

    const links = index.map((c) =>
        `    <li><a href="/${c.code.toLowerCase()}/">${flag(c.code)} ${esc(c.ko)}<span class="cc">${c.code}</span></a></li>`
    ).join('\n');

    return `${head({ title, desc, path: '/' })}
<body>

<div class="top"><div class="wrap">
  <a class="brand" href="/">${SITE}</a>
  ${picker('국가 선택', index)}
</div></div>

<main class="wrap">

  <h1>오늘 뭐 쉬나</h1>
  <p class="lede">오늘이 공휴일인지, 다음 공휴일까지 며칠 남았는지 봅니다. 브라우저의 지역 설정으로 국가를 먼저 맞춰 두고, 위쪽 선택기에서 ${index.length}개국 아무 곳으로나 바꿀 수 있습니다.</p>

  <div class="now" id="home" hidden></div>

  <section id="countries">
    <span class="cap">국가 ${index.length}개</span>
    <h2>국가별 공휴일</h2>
    <ul class="countries">
${links}
    </ul>
  </section>

${foot(generated)}
</main>

<script src="/shared/dday.js"></script>
</body>
</html>
`;
}

/* ------------------------------------------------------------------ 실행 */

const index = JSON.parse(readFileSync(join(DATA, 'countries.json'), 'utf8'));
const files = readdirSync(DATA).filter((f) => f.endsWith('.json') && f !== 'countries.json');

/* 이전에 만든 국가 디렉터리를 먼저 지운다. Nager 에서 빠진 국가의 페이지가 남으면
   sitemap 에는 없는데 링크만 살아 있는 유령이 된다. */
for (const name of readdirSync(PUB, { withFileTypes: true })) {
    if (name.isDirectory() && /^[a-z]{2}$/.test(name.name)) {
        rmSync(join(PUB, name.name), { recursive: true });
    }
}

let generated = today();

for (const file of files) {
    const data = JSON.parse(readFileSync(join(DATA, file), 'utf8'));
    if (!data.days.length) continue;
    generated = data.generated || generated;

    const dir = join(PUB, data.code.toLowerCase());
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'index.html'), countryPage(data));
}

writeFileSync(join(PUB, 'index.html'), homePage(index, generated));

console.log(`국가 페이지 ${files.length}개 + 첫 화면 1개 — 표지 연도 ${MID}`);
