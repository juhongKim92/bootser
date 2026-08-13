/* ============================================================
   전 페이지 공통 검사 — 실행: node tools/check-pages.mjs
   ------------------------------------------------------------
   페이지마다 확인하는 것
     1. 실험대가 예외 없이 구동되나
     2. 렌더 결과에 undefined · 미치환 $1 · NaN 이 남지 않나 (= i18n 키 누락 검사)
     3. 실험대가 `$('#id')` 로 찾는 요소가 HTML 에 실제로 있나
     4. 주요 태그가 짝이 맞나 (div 를 </p> 로 닫은 실수를 잡는다)
     5. canonical + hreflang 3줄 + 자기 실험대 자산 링크가 있나
     6. ko/en i18n 키 집합이 같나
     7. 인덱스의 그룹별 카드 수와 <span class="count"> 표기가 맞나

   실패가 하나라도 있으면 종료 코드 1 이다.
   ============================================================ */
import { boot, scan, pages, PUB } from './lab-harness.mjs';
import { RELATED, NO } from './related.mjs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const fail = [], warn = [];
const bad = (p, m) => fail.push(`${p}: ${m}`);
const soft = (p, m) => warn.push(`${p}: ${m}`);

const TAGS = ['div', 'section', 'table', 'tr', 'td', 'th', 'main', 'span', 'p', 'h1', 'h2', 'h4', 'details', 'summary'];
const ALL = pages();
const LABS = ALL.filter(p => p !== '' && p !== 'en');
const i18nKeys = new Map();

console.log(`페이지 ${ALL.length}개 (실험대 ${LABS.length}개)\n`);

for (const page of ALL) {
    const label = '/' + (page ? page + '/' : '');
    let r;
    try { r = boot(page); }
    catch (e) { bad(label, `구동 실패 — ${e.message}`); continue; }

    for (const e of r.errors) bad(label, e);

    /* 2. 초기 렌더 훑기 */
    for (const p of scan(r.doc)) bad(label, p);

    /* 손잡이를 흔들어 다시 훑는다 — LAB 훅이 있는 실험대만 */
    if (r.lab && typeof r.lab.set === 'function' && Array.isArray(r.lab.scene)) {
        for (const [i, s] of r.lab.scene.entries()) {
            try { r.lab.set(s); } catch (e) { bad(label, `시나리오 ${i + 1} 적용 실패 — ${e.message}`); break; }
            for (const p of scan(r.doc, `시나리오 ${i + 1}`)) bad(label, p);
        }
    }

    const html = r.html;

    /* 3. 실험대가 찾는 id 가 있나.
          동적으로 만든 셀렉터( `$('#st'+k)` · `` $(`#lane${i}`) `` )는 제외한다 —
          닫는 따옴표가 바로 오고 그 뒤에 `+` 가 없는 온전한 리터럴만 본다. */
    const src = r.srcs.filter(s => /-lab\.js$/.test(s)).map(s => readFileSync(join(PUB, s.replace(/^\//, '')), 'utf8')).join('\n');
    const ids = new Set([...src.matchAll(/(?:querySelector\(|\$\(|getElementById\()(['"`])#?([A-Za-z][A-Za-z0-9_-]*)\1(?!\s*\+)/g)].map(m => m[2]));
    for (const m of src.matchAll(/['"`]#([A-Za-z][A-Za-z0-9_-]*) button['"`]/g)) ids.add(m[1]);
    for (const id of ids) if (!html.includes(`id="${id}"`)) bad(label, `실험대가 찾는 #${id} 가 HTML 에 없다`);

    /* 4. 태그 짝 */
    for (const t of TAGS) {
        const o = (html.match(new RegExp('<' + t + '[\\s>]', 'g')) || []).length;
        const c = (html.match(new RegExp('</' + t + '>', 'g')) || []).length;
        if (o !== c) bad(label, `<${t}> 열림 ${o} / 닫힘 ${c}`);
    }

    /* 5. canonical · hreflang · 자산 */
    for (const need of ['rel="canonical"', 'hreflang="ko"', 'hreflang="en"', 'hreflang="x-default"']) {
        if (!html.includes(need)) bad(label, `빠짐: ${need}`);
    }
    if (LABS.includes(page)) {                       // 목록 페이지에는 실험대가 없다
        const slug = page.replace(/^en\//, '');
        for (const ext of ['css', 'js']) {
            if (!html.includes(`/shared/${slug}-lab.${ext}`))
                soft(label, `/shared/${slug}-lab.${ext} 링크가 없다 (파일명 규약 확인)`);
        }
    }

    /* 6. i18n 키 집합 모으기 */
    if (r.i18n) i18nKeys.set(page, Object.keys(r.i18n).sort().join(','));
    process.stdout.write('.');
}
console.log('\n');

/* 6. ko/en 짝 비교 */
for (const [page, keys] of i18nKeys) {
    if (page.startsWith('en/')) continue;
    const en = i18nKeys.get('en/' + page);
    if (en === undefined) { soft('/' + page + '/', 'en 쪽 i18n 을 못 읽었다'); continue; }
    if (en !== keys) {
        const a = new Set(keys.split(',')), b = new Set(en.split(','));
        bad('/' + page + '/', 'ko/en i18n 키 불일치 — ko 만: ' +
            ([...a].filter(k => !b.has(k)).join(' ') || '없음') + ' / en 만: ' +
            ([...b].filter(k => !a.has(k)).join(' ') || '없음'));
    }
}

/* 7. 인덱스 카드 수 vs count 표기 */
for (const page of ['', 'en']) {
    const html = readFileSync(join(PUB, page, 'index.html'), 'utf8');
    const groups = [...html.matchAll(/<details class="group"[^>]*data-g="(\d+)"[\s\S]*?<\/details>/g)];
    let total = 0;
    for (const g of groups) {
        const cards = (g[0].match(/class="card"/g) || []).length;
        const count = (g[0].match(/class="count">(\d+)/) || [])[1];
        total += cards;
        if (String(cards) !== count) bad('/' + (page ? page + '/' : ''), `그룹 ${g[1]}: 카드 ${cards}개인데 count 표기는 ${count}`);
    }
    /* 모든 실험대 페이지가 인덱스에 링크돼 있나 */
    for (const p of LABS.filter(p => (page === 'en') === p.startsWith('en/'))) {
        if (!html.includes(`href="/${p}/"`)) bad('/' + (page ? page + '/' : ''), `/${p}/ 카드가 인덱스에 없다`);
    }
    console.log(`인덱스 /${page ? page + '/' : ''} — 카드 ${total}개 · 그룹 ${groups.length}개`);
}

/* 8. "이어서 볼 것" 링크 그래프 — 막다른 길도, 깨진 링크도, 자기 링크도 없어야 한다 */
{
    const slugs = LABS.filter(p => !p.startsWith('en/'));
    const incoming = new Map(slugs.map(s => [s, 0]));
    for (const [from, list] of Object.entries(RELATED)) {
        if (!slugs.includes(from)) bad('related.mjs', `${from} 은 실험대 페이지가 아니다`);
        if (!list.length) bad('related.mjs', `${from} 에 나가는 링크가 없다`);
        const seen = new Set();
        for (const r of list) {
            if (r.to === from) bad('related.mjs', `${from} 이 자기를 가리킨다`);
            if (seen.has(r.to)) bad('related.mjs', `${from} → ${r.to} 가 중복이다`);
            seen.add(r.to);
            if (!slugs.includes(r.to)) { bad('related.mjs', `${from} → ${r.to} — 없는 페이지다`); continue; }
            if (!NO[r.to]) bad('related.mjs', `${r.to} 의 번호가 NO 에 없다`);
            for (const lang of ['ko', 'en']) {
                if (!r[lang] || !r[lang].trim()) bad('related.mjs', `${from} → ${r.to} 의 ${lang} 이유가 비었다`);
            }
            incoming.set(r.to, incoming.get(r.to) + 1);
        }
    }
    const orphan = [...incoming].filter(([, n]) => n === 0).map(([s]) => s);
    if (orphan.length) bad('related.mjs', `들어오는 링크가 없는 페이지: ${orphan.join(', ')}`);
    const missing = slugs.filter(s => !RELATED[s]);
    if (missing.length) bad('related.mjs', `링크 맵에 없는 페이지: ${missing.join(', ')}`);

    /* 블록이 실제로 HTML 에 박혀 있고 링크가 맞나 */
    for (const page of LABS) {
        const html = readFileSync(join(PUB, page, 'index.html'), 'utf8');
        const label = '/' + page + '/';
        const m = html.match(/<!-- onward:start[\s\S]*?<!-- onward:end -->/);
        if (!m) { bad(label, '"이어서 볼 것" 블록이 없다 — node tools/gen-related.mjs'); continue; }
        const en = page.startsWith('en/');
        const slug = page.replace(/^en\//, '');
        const hrefs = [...m[0].matchAll(/href="([^"]+)"/g)].map(x => x[1]);
        const want = RELATED[slug].map(r => (en ? '/en/' : '/') + r.to + '/');
        if (hrefs.join(',') !== want.join(',')) bad(label, `블록 링크가 맵과 다르다 — 있음 [${hrefs}] 기대 [${want}]`);
        /* 문단 여백이 붙는 규칙이 걸려 있나 (01~13 은 <article class="prose">,
           14 이후는 <main class="wrap prose">). 부분문자열이 아니라 단어 경계로 본다. */
        if (!/class="[^"]*\bprose\b/.test(html)) bad(label, 'prose 규칙이 없다 — 문단 여백이 0 이 된다');
    }
    console.log(`"이어서 볼 것" — 링크 ${Object.values(RELATED).reduce((a, v) => a + v.length, 0)}개 · 막다른 길 0개`);
}

console.log('');
for (const w of warn) console.log('주의  ' + w);
for (const f of fail) console.error('실패  ' + f);
console.log(fail.length ? `\n실패 ${fail.length}건` : `\n문제 없음${warn.length ? ` (주의 ${warn.length}건)` : ''}`);
process.exit(fail.length ? 1 : 0);
