/* sitemap.xml 을 각 페이지의 실제 마지막 커밋 날짜로 다시 만든다.
   실행: node gen-sitemap.mjs   (frontends/backend-internals 에서)

   배포 순서가 중요하다 — 반드시 이 순서로 돌린다.
     1. node tools/gen-prerender.mjs  (실험대 첫 화면을 HTML 에 굽는다)
     2. node gen-sitemap.mjs          (작업 트리가 깨끗한 상태에서)
     3. node inject-beacon.mjs        (HTML 을 제자리에서 고친다)
     4. wrangler deploy
   거꾸로 하면 beacon 주입으로 모든 HTML 이 수정본 상태가 되고,
   그러면 아래 커밋 안 된 수정본 판정에 전부 걸려 lastmod 가 죄다 오늘이 된다.

   lastmod 는 구글이 실제로 쓰는 유일한 항목인데, 부정확하면 아예 무시해버린다.
   그래서 손으로 적지 않고 git 이 아는 날짜를 박는다.

   페이지의 lastmod = max(
     그 페이지 HTML 의 마지막 커밋 날짜,
     그 페이지 전용 /shared/<slug>-lab.{js,css} 의 마지막 커밋 날짜
   )
   base.css · contact.js · groups.js 처럼 전 페이지가 함께 쓰는 파일은 뺀다.
   그것까지 넣으면 사이트 손질 한 번에 34개 URL 이 전부 갱신된 것처럼 보인다. */

import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, posix } from 'node:path';

const BASE = 'https://lab.vermilion19.com';
const ROOT = 'public';
const TODAY = new Date().toISOString().slice(0, 10);

const git = (...args) => {
    try { return execFileSync('git', args, { encoding: 'utf8' }).trim(); }
    catch { return ''; }
};

/* 파일 하나의 마지막 커밋 날짜. 커밋이 없거나 수정본이 남아 있으면 오늘로 본다 */
const warned = [];
function lastCommit(path) {
    const p = path.split('\\').join('/');
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
        else if (name === 'index.html') out.push(p.split('\\').join('/'));
    }
    return out;
}

const pages = walk(ROOT).map(file => {
    const rel = file.slice(ROOT.length + 1).replace(/index\.html$/, '');   // '' | 'en/' | 'mvcc/' | 'en/mvcc/'
    const en = rel.startsWith('en/') || rel === 'en/';
    const slug = en ? rel.slice(3) : rel;                                   // '' | 'mvcc/'
    const html = readFileSync(file, 'utf8');

    /* 그 페이지 전용 실험대 파일만 딸려 본다 */
    const deps = [...html.matchAll(/(?:href|src)="\/shared\/([^"]+)"/g)]
        .map(m => m[1])
        .filter(n => /-lab\.(js|css)$/.test(n))
        .map(n => `${ROOT}/shared/${n}`);

    const dates = [lastCommit(file), ...deps.map(lastCommit)];
    return { slug, en, lastmod: dates.sort().at(-1) };
});

/* ko / en 짝을 맞춘다 — hreflang 세 줄은 양쪽에 똑같이 들어가야 한다 */
const url = (slug, en) => `${BASE}/${en ? 'en/' : ''}${slug}`;
const byKey = new Map(pages.map(p => [`${p.en ? 'en' : 'ko'}:${p.slug}`, p]));

const missing = pages.filter(p => !byKey.has(`${p.en ? 'ko' : 'en'}:${p.slug}`));
if (missing.length) {
    console.error('짝이 없는 페이지:', missing.map(p => url(p.slug, p.en)).join(', '));
    process.exit(1);
}

const order = [...pages].sort((a, b) =>
    (a.slug === '' ? -1 : b.slug === '' ? 1 : a.slug.localeCompare(b.slug)) ||
    (a.en ? 1 : -1));

const body = order.map(p => `  <url>
    <loc>${url(p.slug, p.en)}</loc>
    <xhtml:link rel="alternate" hreflang="ko" href="${url(p.slug, false)}"/>
    <xhtml:link rel="alternate" hreflang="en" href="${url(p.slug, true)}"/>
    <xhtml:link rel="alternate" hreflang="x-default" href="${url(p.slug, true)}"/>
    <lastmod>${p.lastmod}</lastmod>
  </url>`).join('\n\n');

/* changefreq 와 priority 는 구글이 무시한다고 문서에 명시돼 있어 넣지 않는다 */
const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!-- gen-sitemap.mjs 가 만듭니다. 손으로 고치지 마세요.
     lastmod 는 각 페이지 HTML 과 그 페이지 전용 *-lab.{js,css} 의 마지막 커밋 날짜 중 최신값입니다. -->
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml">

${body}

</urlset>
`;

writeFileSync(`${ROOT}/sitemap.xml`, xml);
console.log(`sitemap.xml — url ${order.length}개`);
for (const w of [...new Set(warned)]) console.warn('  주의:', w);
