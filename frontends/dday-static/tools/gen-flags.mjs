/* ============================================================
   국기 SVG 를 우리 오리진으로 들인다 → public/flags/
   실행: node tools/gen-flags.mjs           (받아서 쓴다 — 네트워크)
         node tools/gen-flags.mjs --check   (받지 않고 있는 것만 본다)
   ------------------------------------------------------------
   `gen-holidays.mjs` · `gen-fonts.mjs` 와 같은 **손으로 돌리는 네트워크 단계**다.
   Cloudflare 빌드에는 없다. 국가 목록이 바뀔 때만 돌리면 된다.

   받은 바이트를 그대로 쓴다. 줄이려고 손대지 않는다 — MIT 라 고쳐도 되지만,
   최적화기를 들이는 순간 이 디렉터리의 "의존성 없음" 이 깨지고 무엇을 버렸는지
   기록할 자리가 또 필요해진다. upstream 이 이미 충분히 작다(평균 5.8KB).

   `countries.json` 이 곧 목록이다. 나라가 빠지면 국기도 지운다 — 유령으로 남으면
   어느 페이지도 가리키지 않는 파일이 저장소에 쌓인다.
   ============================================================ */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { DATA, EXTRA } from './config.mjs';
import { FLAG_PKG, FLAG_URL, FLAG_LICENSE_URL, FLAG_DIR, FLAG_PATH, FLAG_LICENSE } from './flags.mjs';

const CHECK = process.argv.includes('--check');
const CONCURRENCY = 8;

if (/^[a-z]{2}$/.test(FLAG_DIR) || EXTRA.includes(FLAG_DIR)) {
    console.error(`'${FLAG_DIR}' 가 국가 코드나 EXTRA 와 부딪힌다 — gen-pages 의 청소가 지운다`);
    process.exit(1);
}

const codes = JSON.parse(readFileSync(join(DATA, 'countries.json'), 'utf8'))
    .map((c) => c.code.toLowerCase()).sort();

/* SVG 인가. 받아 온 것이 404 HTML 이거나 빈 파일이면 화면에 깨진 그림이 뜨는데,
   그건 페이지를 열어 봐야 보인다. 여기서 문다. */
const looksSvg = (s) => /^\s*(<\?xml[^>]*\?>\s*)?<svg[\s>]/.test(s) && s.includes('</svg>');

/* ------------------------------------------------------------------ 검사만 */
if (CHECK) {
    const problems = [];
    if (!existsSync(FLAG_PATH)) problems.push(`${FLAG_DIR}/ 이 없다`);
    else {
        for (const cc of codes) {
            const file = join(FLAG_PATH, `${cc}.svg`);
            if (!existsSync(file)) { problems.push(`없다: ${cc}.svg`); continue; }
            const body = readFileSync(file, 'utf8');
            if (!looksSvg(body)) problems.push(`SVG 가 아니다: ${cc}.svg`);
        }
        if (!existsSync(join(FLAG_PATH, FLAG_LICENSE))) problems.push(`${FLAG_LICENSE} 이 없다`);
        const want = new Set(codes.map((c) => `${c}.svg`));
        for (const f of readdirSync(FLAG_PATH)) {
            if (f === FLAG_LICENSE) continue;
            if (!want.has(f)) problems.push(`나라가 없는 국기: ${f}`);
        }
    }
    if (problems.length) {
        console.error(`국기가 목록과 다르다 ${problems.length}건 — node tools/gen-flags.mjs`);
        for (const p of problems.slice(0, 12)) console.error('  ✗ ' + p);
        process.exit(1);
    }
    console.log(`국기 최신 — ${codes.length}개`);
    process.exit(0);
}

/* ------------------------------------------------------------------ 받는다 */
async function get(url, tries = 3) {
    for (let i = 1; ; i++) {
        try {
            const r = await fetch(url);
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            const body = await r.text();
            if (!body.trim()) throw new Error('본문이 비었다');
            return body;
        } catch (e) {
            if (i === tries) throw new Error(`${url} — ${e.message}`);
            await new Promise((res) => setTimeout(res, 400 * i));
        }
    }
}

mkdirSync(FLAG_PATH, { recursive: true });

const got = new Map();
const fail = [];
let done = 0;

await Promise.all(Array.from({ length: CONCURRENCY }, async (_, slot) => {
    for (let i = slot; i < codes.length; i += CONCURRENCY) {
        const cc = codes[i];
        try {
            const body = await get(FLAG_URL(cc));
            if (!looksSvg(body)) throw new Error('SVG 가 아니다');
            got.set(cc, body);
        } catch (e) {
            fail.push(`${cc} — ${e.message}`);
        }
        done++;
    }
}));

/* 절반만 받아 온 날에 그대로 쓰면 국기 100개가 조용히 사라진다.
   gen-holidays 의 급감 방어와 같은 자리다 — 하나라도 못 받으면 아무것도 쓰지 않는다. */
if (fail.length) {
    console.error(`국기 ${fail.length}개를 못 받았다 — 아무것도 쓰지 않는다`);
    for (const f of fail.slice(0, 10)) console.error('  ✗ ' + f);
    process.exit(1);
}

let wrote = 0, bytes = 0;
for (const [cc, body] of got) {
    const file = join(FLAG_PATH, `${cc}.svg`);
    bytes += Buffer.byteLength(body);
    if (existsSync(file) && readFileSync(file, 'utf8') === body) continue;
    writeFileSync(file, body);
    wrote++;
}

/* 고지를 같이 실어 나른다. MIT 는 저작권 표시와 허가문을 함께 배포하라고 한다 —
   글꼴의 /fonts/LICENSE.txt 와 같은 자리이고, check-pages 가 없어지면 문다. */
const license = await get(FLAG_LICENSE_URL);
const notice = `국기 SVG 는 ${FLAG_PKG} (https://github.com/lipis/flag-icons) 의 4x3 판본을\n`
    + `받은 바이트 그대로 담은 것입니다. 아래는 그 저작권 표시와 허가문입니다.\n`
    + `${'-'.repeat(72)}\n\n${license.trim()}\n`;
const licFile = join(FLAG_PATH, FLAG_LICENSE);
if (!existsSync(licFile) || readFileSync(licFile, 'utf8') !== notice) {
    writeFileSync(licFile, notice);
    wrote++;
}

const want = new Set(codes.map((c) => `${c}.svg`));
const orphan = readdirSync(FLAG_PATH)
    .filter((f) => f !== FLAG_LICENSE && !want.has(f));
for (const f of orphan) unlinkSync(join(FLAG_PATH, f));

console.log(`국기 ${got.size}개 (${FLAG_PKG}) — 새로 쓴 것 ${wrote}개`
    + `${orphan.length ? ` · 지운 것 ${orphan.length}개` : ''}`);
console.log(`합계 ${(bytes / 1024).toFixed(0)} KB · 평균 ${(bytes / got.size / 1024).toFixed(1)} KB`);
console.log('목록의 국기는 loading="lazy" 로 걸린다 — 페이지가 한 번에 1MB 를 받지 않는다');

/* 무거운 국기를 찍어 둔다. 문양(국장)이 든 국기가 그렇고, 20×15 로 그려지는
   그림이 100KB 를 넘는 것은 그 자체로는 우리가 고칠 수 없다 — 래스터라이저가
   없어서 줄일 수단이 없다. 다만 **조용히 이고 있지는 않는다.** upstream 이
   어느 날 더 무거운 것을 올리면 여기서 보인다. */
const HEAVY = 100 * 1024;
const heavy = [...got].map(([cc, b2]) => [cc, Buffer.byteLength(b2)])
    .filter(([, n]) => n >= HEAVY).sort((a2, b2) => b2[1] - a2[1]);
if (heavy.length) {
    console.log(`  ${HEAVY / 1024}KB 넘는 국기 ${heavy.length}개 — `
        + heavy.map(([cc, n]) => `${cc.toUpperCase()} ${(n / 1024).toFixed(0)}KB`).join(' · '));
    console.log('  문양이 든 국기다. 20×15 에서는 안 보이는 세부지만 줄일 수단이 없다(래스터라이저 없음).');
}
