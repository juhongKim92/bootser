/**
 * 웹폰트 자체 호스팅 — public/fonts/
 *
 * 여기 오기 전까지 페이지 머리에는 남의 오리진이 셋 있었다.
 *
 *     fonts.googleapis.com   ← 렌더를 막는 CSS
 *     fonts.gstatic.com      ← 글꼴 파일
 *     cdn.jsdelivr.net       ← Pretendard
 *
 * public/ 을 Cloudflare 에 그대로 얹는 사이트인데 DNS+TLS 핸드셰이크를 세 번 더 하고,
 * 그중 둘은 첫 페인트를 막는 CSS 다. 파일을 받아 커밋해 두면 같은 오리진 · 같은
 * HTTP/2 연결 · 같은 CDN 캐시로 들어오고, 이 디렉터리의 "의존성 없음" 원칙에도 맞는다.
 *
 * 조각을 다 받지는 않는다. dynamic subset 은 unicode-range 로 갈려 있어서 사이트가
 * 쓰지 않는 글자의 조각은 아무도 내려받지 않는다 — 커밋해 봐야 저장소만 무겁다.
 * `fonts.mjs` 의 `codepoints()` 로 public/ 이 실제로 쓰는 글자를 모으고 걸리는 것만 남긴다.
 * 버린 조각의 unicode-range 는 `fonts-lock.json` 에 적어 둔다. 나중에 나라가 하나
 * 늘어 새 한글 음절이 들어오면 check-pages 가 그 기록을 보고 "버린 조각이 이제
 * 필요해졌다" 를 잡는다 — 그게 이 가지치기의 유일한 위험이다.
 *
 *   node tools/gen-fonts.mjs          # 받아서 public/fonts/ 를 다시 만든다 (네트워크)
 *   node tools/gen-fonts.mjs --check  # upstream 이 그대로인지만 본다 (네트워크)
 *
 * 커밋된 것이 성립하는지는 `check-pages.mjs` 가 네트워크 없이 본다.
 * 그래서 이 도구는 gen-holidays 처럼 손으로 돌리는 단계고 Cloudflare 빌드에는 없다.
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { PUB, HERE } from './config.mjs';
import {
    SOURCES, FONT_DIR, FONT_CSS, LICENSE_FILE, UA,
    codepoints, parseFaces, used, fontName,
} from './fonts.mjs';

const DIR = join(PUB, FONT_DIR);
const LOCK = join(HERE, 'fonts-lock.json');
const CHECK = process.argv.includes('--check');

const get = async (url, as) => {
    const r = await fetch(url, { headers: { 'user-agent': UA } });
    if (!r.ok) throw new Error(`${r.status} ${url}`);
    return as === 'buf' ? Buffer.from(await r.arrayBuffer()) : r.text();
};

/* ------------------------------------------------------------------ 모으기 */

const cps = codepoints(PUB);
console.log(`public/ 이 쓰는 글자 ${cps.size}자`);

const families = [];
for (const src of SOURCES) {
    const css = await get(src.css, 'text');
    const faces = parseFaces(css);
    if (!faces.length) throw new Error(`@font-face 를 못 찾았다: ${src.css}`);
    const fams = new Set(faces.map((f) => f.family));
    if (fams.size !== 1 || !fams.has(src.family))
        throw new Error(`${src.css} 가 '${src.family}' 아닌 것을 준다: ${[...fams]}`);

    const allowed = faces.filter((f) => !src.weights || src.weights.includes(f.weight));
    const keep = allowed.filter((f) => used(f.ranges, cps));
    families.push({ src, css, allowed, keep, cssHash: createHash('sha256').update(css).digest('hex') });
    console.log(`  ${src.family.padEnd(20)} ${String(keep.length).padStart(3)} / ${allowed.length} 조각` + (src.weights ? ` (무게 ${src.weights.join('·')} 만, upstream ${faces.length}면)` : ''));
}

/* ------------------------------------------------------------------ --check
   커밋된 lock 의 upstream CSS 해시와 지금 받은 것이 같은가. upstream 이 조용히
   판을 올리면(v12 → v13) 우리가 커밋한 조각은 그대로인데 unicode-range 만
   달라져 있을 수 있다. 그건 네트워크 없이는 못 본다. */
if (CHECK) {
    if (!existsSync(LOCK)) { console.error(`${LOCK} 이 없다 — node tools/gen-fonts.mjs`); process.exit(1); }
    const lock = JSON.parse(readFileSync(LOCK, 'utf8'));
    let stale = 0;
    for (const f of families) {
        const was = lock.families.find((x) => x.slug === f.src.slug);
        if (!was) { stale++; console.error(`NEW    ${f.src.family} — lock 에 없다`); continue; }
        if (was.cssHash !== f.cssHash) { stale++; console.error(`STALE  ${f.src.family} — upstream CSS 가 달라졌다`); }
        if (was.kept.length !== f.keep.length) { stale++; console.error(`STALE  ${f.src.family} — 필요한 조각 수가 ${was.kept.length} → ${f.keep.length}`); }
    }
    if (stale) { console.error('\nupstream 이 움직였다 — node tools/gen-fonts.mjs'); process.exit(1); }
    console.log('\nupstream 그대로');
    process.exit(0);
}

/* ------------------------------------------------------------------ 내려받기 */

mkdirSync(DIR, { recursive: true });

const wanted = new Set([FONT_CSS, LICENSE_FILE]);
const lines = [];
const lock = { note: 'tools/gen-fonts.mjs 가 만든다. 손대지 말 것.', families: [] };

for (const { src, allowed, keep, cssHash } of families) {
    const kept = [];
    for (const f of keep) {
        const url = new URL(f.url, src.css).href;
        const buf = await get(url, 'buf');
        if (buf.length < 64 || buf.subarray(0, 4).toString('latin1') !== 'wOF2')
            throw new Error(`woff2 가 아니다: ${url}`);
        const name = fontName(src.slug, f.index, buf);
        writeFileSync(join(DIR, name), buf);
        wanted.add(name);
        kept.push({ index: f.index, file: name, bytes: buf.length });

        lines.push(`@font-face{font-family:'${f.family}';font-style:${f.style};`
            + `font-weight:${f.weight};font-display:swap;`
            + `src:url(/${FONT_DIR}/${name}) format('${f.format}');`
            + `unicode-range:${f.range}}`);
    }
    const bytes = kept.reduce((a, k) => a + k.bytes, 0);
    console.log(`${src.family.padEnd(20)} ${String(kept.length).padStart(3)}개 · ${(bytes / 1024).toFixed(0)} KB`);

    lock.families.push({
        slug: src.slug,
        family: src.family,
        css: src.css,
        cssHash,
        kept: kept.map((k) => k.index),
        /* 버린 조각의 범위만 적는다. 남긴 조각의 범위는 fonts.css 에 이미 있다 —
           같은 사실을 두 군데 두면 갈라진다.
           "쓰는 글자가 없어서" 버린 것만 적는다. 무게 때문에 버린 면(Pretendard 의
           100·200·…·900 중 넷)은 여기 들어오면 안 된다 — 그 범위는 400·500 이
           이미 덮고 있어서, 적어 두면 check-pages 가 멀쩡한 것을 물고 늘어진다. */
        dropped: allowed.filter((f) => !keep.includes(f)).map((f) => ({ index: f.index, range: f.range })),
    });
}

/* ------------------------------------------------------------------ 쓰기 */

const css = `/* 생성물 — tools/gen-fonts.mjs. 직접 고치지 말 것.
   조각은 public/ 이 실제로 쓰는 글자에 걸리는 것만 담겨 있다. 무엇을 버렸는지는
   tools/fonts-lock.json 에 있고, check-pages 가 그 기록으로 빠진 글자를 잡는다.
   라이선스: ${FONT_DIR}/${LICENSE_FILE} (셋 다 SIL OFL 1.1) */
${lines.join('\n')}
`;
writeFileSync(join(DIR, FONT_CSS), css);

const licenses = [];
for (const src of SOURCES) {
    licenses.push(`${'='.repeat(70)}\n${src.family}\n${src.license}\n${'='.repeat(70)}\n\n`
        + (await get(src.license, 'text')).trim() + '\n');
}
writeFileSync(join(DIR, LICENSE_FILE), licenses.join('\n\n'));

writeFileSync(LOCK, JSON.stringify(lock, null, 2) + '\n');

/* 남은 것 치우기 — 조각을 덜 쓰게 되면 옛 파일이 그대로 남는다. */
for (const name of readdirSync(DIR)) {
    if (!wanted.has(name)) { rmSync(join(DIR, name)); console.log(`지웠다 ${name}`); }
}

const total = readdirSync(DIR).reduce((a, n) => a + readFileSync(join(DIR, n)).length, 0);
console.log(`\npublic/${FONT_DIR}/ ${readdirSync(DIR).length}개 · ${(total / 1024).toFixed(0)} KB`);
console.log(`fonts.css ${(css.length / 1024).toFixed(1)} KB · ${lines.length}면`);
console.log(`\n페이지가 이걸 가리키는지는 node tools/check-pages.mjs`);
