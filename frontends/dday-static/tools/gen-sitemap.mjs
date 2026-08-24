/* ============================================================
   sitemap.xml 을 각 페이지의 실제 마지막 커밋 날짜로 다시 만든다.
   실행: node tools/gen-sitemap.mjs   (frontends/dday-static 에서)

   배포 순서 — 반드시 이 순서로 돌린다.
     1. node tools/gen-holidays.mjs   (Nager 에서 자료를 새로 받는다)
     2. node tools/gen-pages.mjs      (자료로 HTML 을 다시 만든다)
     3. git commit                    ← lastmod 는 여기서 정해진다
     4. node tools/gen-sitemap.mjs
     5. node tools/check-pages.mjs
     6. wrangler deploy
   3번을 건너뛰면 모든 HTML 이 "커밋 안 된 수정본" 으로 판정돼 lastmod 가 죄다
   오늘이 된다. 구글은 lastmod 가 부정확하면 아예 무시하므로 그게 최악이다.

   페이지의 lastmod = 그 페이지 HTML 의 마지막 커밋 날짜.
   base.css · dday.css · dday.js 처럼 전 페이지가 함께 쓰는 파일은 뺀다 —
   그것까지 넣으면 CSS 한 줄 고칠 때마다 410개 URL 이 전부 갱신된 것처럼 보인다.

   ko / en 은 반드시 짝으로 있어야 한다. hreflang 세 줄이 양쪽에 똑같이 들어가지
   않으면 구글은 그 hreflang 을 통째로 버린다. 짝이 없으면 여기서 멈춘다.
   ============================================================ */
import { readdirSync, writeFileSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, relative, sep } from 'node:path';
import { BASE, PUB, today } from './config.mjs';

/* 윈도우에서는 경로 구분자가 역슬래시다. git 도 URL 도 슬래시만 쓰므로 한 번에 바꾼다. */
const slash = (p) => p.split(sep).join('/');

const TODAY = today();

const git = (...args) => {
    try { return execFileSync('git', args, { encoding: 'utf8' }).trim(); }
    catch { return ''; }
};

const warned = [];
function lastCommit(path) {
    const p = slash(path);
    if (git('status', '--porcelain', '--', p)) { warned.push(`${p} — 커밋 안 된 수정본`); return TODAY; }
    const d = git('log', '-1', '--format=%cd', '--date=short', '--', p);
    if (!d) { warned.push(`${p} — 커밋 이력 없음`); return TODAY; }
    return d;
}

/* public 아래의 index.html 을 모은다. 404.html 은 index.html 이 아니라 자연히 빠진다 */
function walk(dir, out = []) {
    for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p, out);
        else if (name === 'index.html') out.push(p);
    }
    return out;
}

const pages = walk(PUB).map((file) => {
    /* '' | 'en/' | 'kr/' | 'en/kr/' */
    const dir = slash(relative(PUB, file)).replace(/index\.html$/, '');
    const en = dir === 'en/' || dir.startsWith('en/');
    return { slug: en ? dir.slice(3) : dir, en, lastmod: lastCommit(file) };
});

/* ko / en 짝을 맞춘다 — hreflang 세 줄은 양쪽에 똑같이 들어가야 한다.
   한쪽만 있으면 구글은 그 hreflang 을 통째로 버린다. */
const url = (slug, en) => `${BASE}/${en ? 'en/' : ''}${slug}`;
const byKey = new Set(pages.map((p) => `${p.en ? 'en' : 'ko'}:${p.slug}`));
const orphan = pages.filter((p) => !byKey.has(`${p.en ? 'ko' : 'en'}:${p.slug}`));
if (orphan.length) {
    console.error('짝이 없는 페이지:', orphan.map((p) => url(p.slug, p.en)).join(', '));
    process.exit(1);
}

/* 첫 화면이 맨 앞, 그다음 국가 코드순, 같은 슬러그면 ko 가 먼저 */
const order = [...pages].sort((a, b) =>
    (a.slug === '' ? -1 : b.slug === '' ? 1 : a.slug.localeCompare(b.slug)) ||
    (a.en ? 1 : -1));

/* changefreq 와 priority 는 구글이 무시한다고 문서에 명시돼 있어 넣지 않는다 */
const body = order.map((p) => `  <url>
    <loc>${url(p.slug, p.en)}</loc>
    <xhtml:link rel="alternate" hreflang="ko" href="${url(p.slug, false)}"/>
    <xhtml:link rel="alternate" hreflang="en" href="${url(p.slug, true)}"/>
    <xhtml:link rel="alternate" hreflang="x-default" href="${url(p.slug, true)}"/>
    <lastmod>${p.lastmod}</lastmod>
  </url>`).join('\n\n');

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!-- gen-sitemap.mjs 가 만듭니다. 손으로 고치지 마세요.
     lastmod 는 각 페이지 index.html 의 마지막 커밋 날짜입니다. -->
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml">

${body}

</urlset>
`;

writeFileSync(join(PUB, 'sitemap.xml'), xml);
console.log(`sitemap.xml — url ${order.length}개`);
for (const w of [...new Set(warned)].slice(0, 3)) console.warn('  주의:', w);
if (warned.length > 3) console.warn(`  주의: 그 외 ${warned.length - 3}건`);
