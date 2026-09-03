/* ============================================================
   하늘 아이콘 SVG 를 그린다 → public/sky-icons/
   실행: node tools/gen-sky-icons.mjs           (그려서 쓴다)
         node tools/gen-sky-icons.mjs --check   (쓰지 않고 있는 것만 본다)
   ------------------------------------------------------------
   `gen-favicon.mjs` · `gen-card.mjs` 와 같은 자리다 — 원화는 `sky-art.mjs` 에 있고
   여기는 그것을 파일로 내려놓기만 한다. **네트워크를 타지 않으므로** gen-flags 와
   달리 Cloudflare 빌드에서 돌려도 되고, 언제 돌려도 같은 답이 나온다.

   그래도 커밋해 둔다 — 이 저장소는 생성물을 커밋한다(README 「구조」). 그림이
   바뀌면 git diff 에 보이는 것이 그 자체로 검토 자리다.
   ============================================================ */
import { writeFileSync, existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { ICONS, ICON_DIR, ICON_PATH, validate } from './sky-art.mjs';
import { EXTRA } from './config.mjs';

const CHECK = process.argv.includes('--check');

if (/^[a-z]{2}$/.test(ICON_DIR) || EXTRA.includes(ICON_DIR)) {
    console.error(`'${ICON_DIR}' 가 국가 코드나 EXTRA 와 부딪힌다 — gen-pages 의 청소가 지운다`);
    process.exit(1);
}

/* 원화부터 본다. 상자를 넘거나 스물넷이 한 자리에 몰린 그림을 파일로 내려놓고
   나중에 페이지에서 찾는 것보다 여기서 멈추는 것이 낫다. */
const wrong = validate();
if (wrong.length) {
    console.error(`하늘 아이콘 원화가 성립하지 않는다 ${wrong.length}건:`);
    for (const w of wrong.slice(0, 12)) console.error('  ✗ ' + w);
    process.exit(1);
}

const want = new Map(Object.entries(ICONS).map(([n, b]) => [`${n}.svg`, b]));

/* ------------------------------------------------------------------ 검사만 */
if (CHECK) {
    const problems = [];
    if (!existsSync(ICON_PATH)) problems.push(`${ICON_DIR}/ 이 없다`);
    else {
        for (const [file, body] of want) {
            const at = join(ICON_PATH, file);
            if (!existsSync(at)) { problems.push(`없다: ${file}`); continue; }
            if (readFileSync(at, 'utf8') !== body) problems.push(`원화와 다르다: ${file}`);
        }
        for (const f of readdirSync(ICON_PATH)) {
            if (!want.has(f)) problems.push(`원화에 없는 그림: ${f}`);
        }
    }
    if (problems.length) {
        console.error(`하늘 아이콘이 원화와 다르다 ${problems.length}건 — node tools/gen-sky-icons.mjs`);
        for (const p of problems.slice(0, 12)) console.error('  ✗ ' + p);
        process.exit(1);
    }
    console.log(`하늘 아이콘 최신 — ${want.size}개`);
    process.exit(0);
}

/* ------------------------------------------------------------------ 그린다 */
mkdirSync(ICON_PATH, { recursive: true });

let wrote = 0, bytes = 0;
for (const [file, body] of want) {
    const at = join(ICON_PATH, file);
    bytes += Buffer.byteLength(body);
    if (existsSync(at) && readFileSync(at, 'utf8') === body) continue;
    writeFileSync(at, body);
    wrote++;
}

/* 이름을 바꾸면 옛 그림이 남는다. 어느 페이지도 가리키지 않는 파일이라
   조용히 쌓이므로 여기서 치운다 — gen-flags 의 유령 정리와 같은 자리다. */
const orphan = readdirSync(ICON_PATH).filter((f) => !want.has(f));
for (const f of orphan) unlinkSync(join(ICON_PATH, f));

console.log(`하늘 아이콘 ${want.size}개 — 새로 쓴 것 ${wrote}개`
    + `${orphan.length ? ` · 지운 것 ${orphan.length}개` : ''}`);
console.log(`합계 ${(bytes / 1024).toFixed(1)} KB · 평균 ${Math.round(bytes / want.size)} B`);
