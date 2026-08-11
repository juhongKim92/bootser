import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const TOKEN = process.env.CF_BEACON_TOKEN;
if (!TOKEN) { console.log('CF_BEACON_TOKEN 없음 — 건너뜀'); process.exit(0); }

const SNIPPET = `<script defer src="https://static.cloudflareinsights.com/beacon.min.js" `
    + `data-cf-beacon='{"token":"${TOKEN}"}'></script>`;

function walk(dir){
    for (const name of readdirSync(dir)){
        const p = join(dir, name);
        if (statSync(p).isDirectory()) { walk(p); continue; }
        if (!p.endsWith('.html')) continue;

        let s = readFileSync(p, 'utf8');
        if (s.includes('cloudflareinsights')) continue;   // 이미 있으면 건너뜀
        if (!s.includes('</body>')) continue;

        writeFileSync(p, s.replace('</body>', SNIPPET + '\n</body>'));
        console.log('injected:', p);
    }
}
walk('public');