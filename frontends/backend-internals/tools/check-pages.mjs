/* ============================================================
   전 페이지 공통 검사 — 실행: node tools/check-pages.mjs
   ------------------------------------------------------------
   페이지마다 확인하는 것
     1. 실험대가 예외 없이 구동되나
     2. 렌더 결과에 undefined · 미치환 $1 · NaN 이 남지 않나 (= i18n 키 누락 검사)
     3. 실험대가 `$('#id')` 로 찾는 요소가 HTML 에 실제로 있나
     4. 주요 태그가 짝이 맞나 (div 를 </p> 로 닫은 실수를 잡는다)
     5. canonical + hreflang 3줄 + 파비콘 4줄 + 자기 실험대 자산 링크가 있나
        (파비콘은 파일까지 열어서 정사각 + 48 의 배수인지 본다 — 구글 검색결과 아이콘 조건)
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

/* 파비콘 — 검색결과 아이콘은 호스트당 하나지만, 어느 페이지가 먼저 크롤되든 같은 걸
   가리키도록 전 페이지에 넣는다. 구글은 정사각 + 한 변이 48 의 배수를 요구한다. */
const ICON_LINKS = [
    'href="/favicon.ico"',
    'href="/favicon.svg"',
    'href="/icon-192.png"',
    'rel="apple-touch-icon"',
];
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

    /* 5. canonical · hreflang · 아이콘 · 자산 */
    for (const need of ['rel="canonical"', 'hreflang="ko"', 'hreflang="en"', 'hreflang="x-default"',
                        ...ICON_LINKS]) {
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

/* 9. JSON-LD — 파싱되나, 그리고 페이지 내용과 어긋나지 않나 */
{
    const BASE = 'https://lab.vermilion19.com';
    let arts = 0, crumbs = 0, colls = 0;
    for (const page of ALL) {
        const label = '/' + (page ? page + '/' : '');
        const html = readFileSync(join(PUB, page, 'index.html'), 'utf8');
        const m = html.match(/<!-- jsonld:start[\s\S]*?<!-- jsonld:end -->/);
        if (!m) { bad(label, 'JSON-LD 블록이 없다 — node tools/gen-jsonld.mjs'); continue; }

        const blocks = [...m[0].matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(x => x[1]);
        if (!blocks.length) { bad(label, 'ld+json 스크립트가 비었다'); continue; }

        const pick = re => (html.match(re) || [])[1];
        const lang = pick(/<html lang="([^"]+)"/);
        const canonical = pick(/<link rel="canonical" href="([^"]+)"/);
        const h1 = (pick(/<h1[^>]*>([\s\S]*?)<\/h1>/) || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
        const isIndex = page === '' || page === 'en';
        const crumbRoot = BASE + (page.startsWith('en') ? '/en/' : '/');

        for (const raw of blocks) {
            let o;
            try { o = JSON.parse(raw); }
            catch (e) { bad(label, `ld+json 파싱 실패 — ${e.message}`); continue; }
            if (o['@context'] !== 'https://schema.org') bad(label, `@context 가 schema.org 가 아니다: ${o['@context']}`);
            if (raw.includes('</script')) bad(label, 'JSON 안에 </script 가 이스케이프되지 않았다');

            if (o['@type'] === 'Article') {
                arts++;
                if (o.headline !== h1) bad(label, `headline 이 <h1> 과 다르다 — "${o.headline}" vs "${h1}"`);
                if (o.url !== canonical) bad(label, `url 이 canonical 과 다르다 — ${o.url} vs ${canonical}`);
                if (o.inLanguage !== lang) bad(label, `inLanguage 가 <html lang> 과 다르다 — ${o.inLanguage} vs ${lang}`);
                for (const k of ['datePublished', 'dateModified']) {
                    if (!/^\d{4}-\d{2}-\d{2}$/.test(o[k] || '')) bad(label, `${k} 가 YYYY-MM-DD 가 아니다: ${o[k]}`);
                }
                if (o.datePublished > o.dateModified) bad(label, `datePublished 가 dateModified 보다 늦다`);
                if (!o.description) bad(label, 'Article 에 description 이 없다');
            } else if (o['@type'] === 'BreadcrumbList') {
                crumbs++;
                const list = o.itemListElement || [];
                if (list.length < 2) bad(label, `빵가루가 ${list.length}단이다 — 최소 2단`);
                list.forEach((it, i) => {
                    if (it.position !== i + 1) bad(label, `빵가루 position 이 어긋난다 — ${it.position} (기대 ${i + 1})`);
                    if (!it.name) bad(label, `빵가루 ${i + 1}단에 name 이 없다`);
                    /* item 생략은 마지막 항목만 허용된다 (Google 이 그 페이지 URL 을 쓴다) */
                    if (!it.item && i !== list.length - 1) bad(label, `빵가루 ${i + 1}단에 item 이 없다 — 마지막이 아니다`);
                });
                if (list[0] && list[0].item !== crumbRoot) bad(label, `빵가루 뿌리가 ${list[0].item} 다 — 기대 ${crumbRoot}`);
                if (list.at(-1) && list.at(-1).name !== h1) bad(label, '빵가루 마지막 단이 <h1> 과 다르다');
            } else if (o['@type'] === 'CollectionPage') {
                colls++;
                if (!isIndex) bad(label, 'CollectionPage 가 목록 페이지가 아닌 곳에 있다');
                if (o.url !== canonical) bad(label, `CollectionPage url 이 canonical 과 다르다`);
            } else {
                bad(label, `모르는 @type: ${o['@type']}`);
            }
        }
        if (isIndex && !blocks.length) bad(label, '인덱스에 CollectionPage 가 없다');
        if (!isIndex && blocks.length !== 2) bad(label, `ld+json 블록이 ${blocks.length}개다 — Article + BreadcrumbList 2개여야 한다`);
    }
    console.log(`JSON-LD — Article ${arts}개 · BreadcrumbList ${crumbs}개 · CollectionPage ${colls}개`);
}

/* 10. 파비콘 자산 — 링크만 있고 파일이 없으면 검색결과가 기본 지구본으로 돌아간다.
   구글 조건은 정사각 + 한 변이 48 의 배수다. */
{
    const size = f => {                                  // PNG IHDR 에서 크기를 읽는다
        const b = readFileSync(join(PUB, f));
        if (b.readUInt32BE(0) !== 0x89504e47) throw new Error('PNG 서명이 아니다');
        return [b.readUInt32BE(16), b.readUInt32BE(20)];
    };
    const check = (f, fn) => {
        try { fn(); } catch (e) { bad('public/' + f, e.code === 'ENOENT' ? '파일이 없다' : e.message); }
    };
    const before = fail.length;

    /* 구글은 apple-touch-icon 도 아이콘 후보로 읽으므로 둘 다 48 의 배수로 맞춘다 */
    for (const f of ['icon-192.png', 'apple-touch-icon.png']) check(f, () => {
        const [w, h] = size(f);
        if (w !== h) throw new Error(`정사각이 아니다 — ${w}x${h}`);
        if (w % 48) throw new Error(`한 변이 48 의 배수가 아니다 — ${w}px (구글이 안 쓴다)`);
    });
    check('favicon.ico', () => {
        const b = readFileSync(join(PUB, 'favicon.ico'));
        if (b.readUInt16LE(2) !== 1) throw new Error('ICO 헤더가 아니다');
        const sizes = [];
        for (let i = 0, n = b.readUInt16LE(4); i < n; i++) {
            const w = b.readUInt8(6 + 16 * i) || 256, h = b.readUInt8(7 + 16 * i) || 256;
            if (w !== h) throw new Error(`${i}번 이미지가 정사각이 아니다 — ${w}x${h}`);
            sizes.push(w);
        }
        if (!sizes.includes(48)) throw new Error(`48x48 이 없다 — 담긴 크기 ${sizes.join('/')}`);
    });
    check('favicon.svg', () => {
        const vb = (readFileSync(join(PUB, 'favicon.svg'), 'utf8').match(/viewBox="([^"]+)"/) || [])[1];
        if (!vb) throw new Error('viewBox 가 없다');
        const [, , w, h] = vb.trim().split(/\s+/).map(Number);
        if (w !== h) throw new Error(`viewBox 가 정사각이 아니다 — ${w}x${h}`);
    });
    if (fail.length === before) console.log('파비콘 — ico(48 포함) · svg · png 192 · apple-touch 192');
}

console.log('');
for (const w of warn) console.log('주의  ' + w);
for (const f of fail) console.error('실패  ' + f);
console.log(fail.length ? `\n실패 ${fail.length}건` : `\n문제 없음${warn.length ? ` (주의 ${warn.length}건)` : ''}`);
process.exit(fail.length ? 1 : 0);
