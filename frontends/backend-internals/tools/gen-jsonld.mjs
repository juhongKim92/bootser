/* ============================================================
   JSON-LD 구조화 데이터를 38개 페이지에 박는다 — 실행: node tools/gen-jsonld.mjs
   ------------------------------------------------------------
   무엇을 넣고 무엇을 안 넣나 (2026-08-13, Google 문서 확인 후 결정)

   · `Article`      — 문서가 지원한다고 명시한 타입은 Article · NewsArticle · BlogPosting
                      뿐이다. **`TechArticle` 은 그 목록에 없다.** schema.org 상으로는
                      Article 의 서브타입이라 틀리지 않지만, 문서에 있는 것을 쓴다.
                      필수 속성은 없고 headline · datePublished · dateModified · image ·
                      author 가 권장이다.
   · `BreadcrumbList` — 이 사이트에서 실제로 값을 하는 건 이쪽이다. 검색 결과에 URL 대신
                      `Backend Internals › 제목` 경로가 뜬다. 이미지가 필요 없다.
   · 인덱스 두 장    — `CollectionPage`.
   · 안 넣는 것      — `FAQPage` · `HowTo` 는 갤러리에서 빠졌다(FAQ 는 정부·의료 사이트로
                      한정, HowTo 는 폐지). 넣어도 표시되지 않는다.

   **이미지를 넣지 않았다.** 사이트에 이미지가 하나도 없어서(og:image 도 없다) Article
   rich result 의 큰 썸네일은 어차피 못 받는다. 이미지를 만들면 여기 `image` 를 추가한다.

   **author 에 사람 이름을 넣지 않았다.** 사이트 어디에도 실명이 없으므로 조직명으로
   둔다. 실명을 노출할지는 사이트 주인이 정할 일이다.

   날짜는 손으로 적지 않고 git 에서 읽는다 — `datePublished` 는 그 페이지의 첫 커밋,
   `dateModified` 는 페이지와 그 전용 `-lab.{js,css}` 중 마지막 커밋이다.
   (`gen-sitemap.mjs` 의 lastmod 와 같은 규칙)

   블록은 표식 사이에 들어가 **몇 번 돌려도 결과가 같다.**
   `--check` 를 주면 고치지 않고 최신인지만 본다.
   ============================================================ */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { RELATED } from './related.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PUB = join(HERE, '..', 'public');
const BASE = 'https://lab.vermilion19.com';
const SITE = 'Backend Internals';
const TODAY = new Date().toISOString().slice(0, 10);
const CHECK = process.argv.includes('--check');

const START = '<!-- jsonld:start · tools/gen-jsonld.mjs 가 만듭니다. 손으로 고치지 마세요 -->';
const END = '<!-- jsonld:end -->';

const git = (...a) => { try { return execFileSync('git', a, { encoding: 'utf8', cwd: HERE }).trim(); } catch { return ''; } };
const rel = p => p.split('\\').join('/');

/* 커밋 안 된 수정본이 있으면 오늘로 본다 — gen-sitemap.mjs 와 같은 판정 */
function dates(file, deps) {
    const all = [file, ...deps].map(rel);
    const dirty = all.some(p => git('status', '--porcelain', '--', p));
    const last = dirty ? TODAY
        : all.map(p => git('log', '-1', '--format=%cd', '--date=short', '--', p)).filter(Boolean).sort().at(-1) || TODAY;
    const first = git('log', '--reverse', '--format=%cd', '--date=short', '--', rel(file)).split('\n')[0] || last;
    return { published: first, modified: last };
}

/* JSON-LD 를 <script> 안에 넣을 때 '<' 는 이스케이프한다 — </script> 사고 방지 */
const emit = obj => JSON.stringify(obj, null, 2).replace(/</g, '\\u003C');

function pageInfo(page) {
    const file = join(PUB, page, 'index.html');
    const html = readFileSync(file, 'utf8');
    const pick = re => (html.match(re) || [])[1];
    const h1 = pick(/<h1[^>]*>([\s\S]*?)<\/h1>/);
    return {
        file, html,
        lang: pick(/<html lang="([^"]+)"/) || 'ko',
        canonical: pick(/<link rel="canonical" href="([^"]+)"/),
        desc: pick(/<meta name="description" content="([^"]*)"/),
        h1: h1 && h1.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim(),
        deps: [...html.matchAll(/(?:href|src)="\/shared\/([^"]+)"/g)].map(m => m[1])
            .filter(n => /-lab\.(js|css)$/.test(n)).map(n => join(PUB, 'shared', n))
    };
}

function blocksFor(page) {
    const p = pageInfo(page);
    const en = page.startsWith('en/') || page === 'en';
    const isIndex = page === '' || page === 'en';
    /* 빵가루의 뿌리는 그 언어의 목록 페이지, WebSite·Organization 은 언어와 무관하게 루트 하나다 */
    const crumbRoot = BASE + (en ? '/en/' : '/');
    const d = dates(p.file, p.deps);
    const org = { '@type': 'Organization', name: SITE, url: BASE + '/' };
    const site = { '@type': 'WebSite', name: SITE, url: BASE + '/' };

    if (isIndex) {
        /* 인덱스는 자기가 곧 목록이므로 isPartOf 로 자기를 가리키지 않는다 */
        return [{
            '@context': 'https://schema.org',
            '@type': 'CollectionPage',
            name: SITE,
            description: p.desc,
            url: p.canonical,
            inLanguage: p.lang,
            dateModified: d.modified,
            publisher: org
        }];
    }

    return [
        {
            '@context': 'https://schema.org',
            '@type': 'Article',
            headline: p.h1,
            description: p.desc,
            url: p.canonical,
            inLanguage: p.lang,
            datePublished: d.published,
            dateModified: d.modified,
            author: org,
            publisher: org,
            isPartOf: site
        },
        {
            '@context': 'https://schema.org',
            '@type': 'BreadcrumbList',
            itemListElement: [
                { '@type': 'ListItem', position: 1, name: SITE, item: crumbRoot },
                /* 마지막 항목은 item 을 생략한다 — Google 이 그 페이지 URL 을 쓴다 */
                { '@type': 'ListItem', position: 2, name: p.h1 }
            ]
        }
    ];
}

const PAGES = ['', 'en', ...Object.keys(RELATED).flatMap(s => [s, 'en/' + s])];

let changed = 0; const stale = [];
for (const page of PAGES) {
    const file = join(PUB, page, 'index.html');
    if (!existsSync(file)) throw new Error(`없는 페이지: ${page}`);
    let html = readFileSync(file, 'utf8');
    const before = html;

    const body = blocksFor(page)
        .map(o => '  <script type="application/ld+json">\n' + emit(o) + '\n  </script>').join('\n');
    const block = START + '\n' + body + '\n  ' + END;

    const re = new RegExp(START.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[\\s\\S]*?' + END, '');
    if (re.test(html)) html = html.replace(re, block);
    else {
        if (!html.includes('</body>')) throw new Error(`${file}: </body> 가 없다`);
        html = html.replace(/\n(\s*)<\/body>/, '\n\n' + block + '\n$1</body>');
    }

    if (html !== before) {
        if (CHECK) stale.push(page || '/');
        else { writeFileSync(file, html); changed++; }
    }
}

if (CHECK) {
    if (stale.length) {
        console.error(`JSON-LD 가 최신이 아닙니다 (${stale.length}개): ${stale.join(', ')}`);
        console.error('node tools/gen-jsonld.mjs 를 돌리세요.');
        process.exit(1);
    }
    console.log(`JSON-LD — ${PAGES.length}개 페이지 모두 최신`);
} else {
    console.log(`JSON-LD — ${PAGES.length}개 페이지 · 갱신 ${changed}개 (Article + BreadcrumbList, 인덱스는 CollectionPage)`);
}
