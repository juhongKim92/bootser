/* ============================================================
   실험대의 첫 화면을 HTML 에 구워 넣는다 — 실행: node tools/gen-prerender.mjs
   ------------------------------------------------------------
   왜 —
   실험대가 채우는 자리(`<div class="meters" id="meters"></div>`)는 배포되는 HTML 에
   비어 있다. 브라우저는 그걸 높이 0 으로 그리고, 스크립트가 돌면서 표가 들어차면
   그 아래 내용이 전부 밀린다. 그 밀림이 CLS 다. 페이지 42개가 그 상태였다.

   높이를 min-height 로 예약하는 방법도 있지만, 그건 밀림을 줄일 뿐 없애지 못한다 —
   예약한 값이 실제보다 작으면 여전히 밀리고 크면 빈 칸이 남는다.
   여기서는 첫 화면을 아예 미리 그려 넣어 밀림 자체를 없앤다.

   덤으로 크롤러와 자바스크립트를 끈 사람이 실험대 내용을 본다. 지금까지는
   빈 상자만 보였다.

   어떻게 —
   lab-harness 로 배포되는 스크립트 그대로를 node:vm 에서 돌리고, 각 컨테이너에
   들어간 innerHTML 을 그대로 HTML 에 넣는다. 브라우저가 load 시점에 만드는 것과
   같은 문자열이므로, 스크립트가 다시 그려도 화면은 그대로다.

   다시 돌려도 안전하다 —
   구운 부분을 <!--pr--> … <!--/pr--> 로 감싸고, 매번 그것부터 걷어낸 뒤 다시 넣는다.
   그래서 몇 번을 돌리든 결과가 같다.

   배포 순서 —
     1. node tools/gen-prerender.mjs   ← 여기
     2. node gen-sitemap.mjs           (작업 트리가 깨끗한 상태에서)
     3. node inject-beacon.mjs
     4. wrangler deploy
   ============================================================ */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { boot, pages, PUB } from './lab-harness.mjs';

const CHECK = process.argv.includes('--check');

const OPEN = '<!--pr-->';
const CLOSE = '<!--/pr-->';
const STRIP = /<!--pr-->[\s\S]*?<!--\/pr-->/g;

/* 구울 값이 없는 자리 — 한 줄짜리 값 표시는 HTML 에 이미 초기값이 적혀 있어서
   비어 있지 않고, 아래에서 자연히 걸러진다. */
const MIN_LEN = 1;

let touched = 0, baked = 0;
const skipped = [], stale = [];

/* 한 페이지의 "구워야 할 최종 HTML" 을 만든다. 디스크는 건드리지 않는다. */
export function bake(page, html) {
    const bare = html.replace(STRIP, '');
    const rendered = boot(page, { source: bare });

    let out = bare, n = 0;
    for (const [sel, el] of rendered.doc.cache) {
        const m = /^#([\w-]+)$/.exec(sel);
        if (!m) continue;
        const body = String(el.innerHTML || '');
        if (body.length < MIN_LEN) continue;

        /* 비어 있는 컨테이너에만 넣는다. 손으로 쓴 내용이 있는 자리
           (예: 초기값이 적힌 <span class="v">25</span>)는 안 걸린다. */
        const tag = new RegExp(
            '(<([a-z]+)\\b[^>]*\\bid="' + m[1] + '"[^>]*>)(</\\2>)');
        const hit = tag.exec(out);
        if (!hit) continue;

        out = out.slice(0, hit.index) + hit[1] + OPEN + body + CLOSE + hit[3] +
            out.slice(hit.index + hit[0].length);
        n++;
    }
    return { out, n };
}

for (const page of pages()) {
    const file = join(PUB, page, 'index.html');
    const html = readFileSync(file, 'utf8');

    let res;
    try { res = bake(page, html); }
    catch (e) { skipped.push(`${page || '(첫 화면)'} — 구동 실패: ${e.message}`); continue; }

    baked += res.n;
    if (res.out === html) continue;

    touched++;
    if (CHECK) stale.push('/' + (page ? page + '/' : ''));
    else writeFileSync(file, res.out);
}

for (const s of skipped) console.warn('  주의:', s);

if (CHECK) {
    if (stale.length) {
        console.error(`구운 내용이 최신이 아닌 페이지 ${stale.length}개: ${stale.slice(0, 6).join(', ')}` +
            (stale.length > 6 ? ` 외 ${stale.length - 6}개` : ''));
        console.error('node tools/gen-prerender.mjs 를 돌릴 것');
        process.exit(1);
    }
    console.log(`구운 내용이 최신이다 — 자리 ${baked}개`);
} else {
    console.log(`프리렌더 — 페이지 ${touched}개 고침, 자리 ${baked}개`);
}
