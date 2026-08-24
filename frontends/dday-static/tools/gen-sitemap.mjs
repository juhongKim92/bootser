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
   그것까지 넣으면 CSS 한 줄 고칠 때마다 205개 URL 이 전부 갱신된 것처럼 보인다.
   ============================================================ */
import { readdirSync, writeFileSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { BASE, PUB, today } from './config.mjs';

const TODAY = today();

const git = (...args) => {
    try { return execFileSync('git', args, { encoding: 'utf8' }).trim(); }
    catch { return ''; }
};

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

const root = PUB.split('\\').join('/');
const pages = walk(PUB).map((file) => {
    const rel = file.slice(root.length + 1).replace(/index\.html$/, '');   // '' | 'kr/'
    return { slug: rel, lastmod: lastCommit(file) };
});

/* 첫 화면이 맨 앞, 나머지는 국가 코드순 */
const order = [...pages].sort((a, b) =>
    (a.slug === '' ? -1 : b.slug === '' ? 1 : a.slug.localeCompare(b.slug)));

/* changefreq 와 priority 는 구글이 무시한다고 문서에 명시돼 있어 넣지 않는다 */
const body = order.map((p) => `  <url>
    <loc>${BASE}/${p.slug}</loc>
    <lastmod>${p.lastmod}</lastmod>
  </url>`).join('\n');

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!-- gen-sitemap.mjs 가 만듭니다. 손으로 고치지 마세요.
     lastmod 는 각 페이지 index.html 의 마지막 커밋 날짜입니다. -->
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">

${body}

</urlset>
`;

writeFileSync(join(PUB, 'sitemap.xml'), xml);
console.log(`sitemap.xml — url ${order.length}개`);
for (const w of [...new Set(warned)].slice(0, 5)) console.warn('  주의:', w);
if (warned.length > 5) console.warn(`  주의: 그 외 ${warned.length - 5}건`);
