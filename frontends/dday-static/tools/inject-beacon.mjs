/* ============================================================
   Cloudflare 웹 분석 비콘을 모든 HTML 의 </body> 앞에 넣는다.
   실행: node tools/inject-beacon.mjs   (Cloudflare 빌드 단계에서)
   ------------------------------------------------------------
   토큰은 저장소에 두지 않는다 — Cloudflare 프로젝트의 환경 변수
   CF_BEACON_TOKEN 에서 읽고, 없으면 아무것도 하지 않는다.
   그래서 로컬에서 그냥 돌려도 작업 트리가 더러워지지 않는다.

   **이 스크립트는 커밋된 HTML 을 제자리에서 고친다.** 배포 파이프라인의
   맨 마지막(검사 다음, wrangler deploy 직전)에 와야 한다. 먼저 돌리면
   420개 HTML 이 전부 "커밋 안 된 수정본" 이 되어 gen-sitemap.mjs 의
   lastmod 가 죄다 오늘로 찍힌다.
   ============================================================ */
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { PUB } from './config.mjs';

const TOKEN = process.env.CF_BEACON_TOKEN;
if (!TOKEN) {
    console.log('CF_BEACON_TOKEN 없음 — 비콘을 넣지 않는다');
    process.exit(0);
}

const SNIPPET = '<script defer src="https://static.cloudflareinsights.com/beacon.min.js" '
    + `data-cf-beacon='{"token":"${TOKEN}"}'></script>`;

let done = 0, skipped = 0;

function walk(dir) {
    for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) { walk(p); continue; }
        if (!p.endsWith('.html')) continue;

        const s = readFileSync(p, 'utf8');
        if (s.includes('cloudflareinsights')) { skipped++; continue; }   /* 이미 있다 */
        if (!s.includes('</body>')) { skipped++; continue; }

        writeFileSync(p, s.replace('</body>', SNIPPET + '\n</body>'));
        done++;
    }
}

walk(PUB);
console.log(`비콘 주입 ${done}개${skipped ? ` (건너뜀 ${skipped}개)` : ''}`);
