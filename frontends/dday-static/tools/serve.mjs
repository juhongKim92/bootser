/* ============================================================
   public/ 을 그대로 띄우는 개발용 정적 서버
   실행: node tools/serve.mjs          (frontends/dday-static 에서)
         node tools/serve.mjs --port 8001
         npm run dev:dday-static       (저장소 루트에서 — 같은 것이다)
   ------------------------------------------------------------
   **`file://` 로는 볼 수 없어서 있는 파일이다.** 페이지의 자산 링크가 전부
   절대경로(`/shared/base.css`)다 — 페이지가 `/`, `/kr/`, `/holiday/christmas/`
   처럼 깊이가 다른 자리에 놓이므로 상대경로로 두면 깊이마다 다시 계산해야 한다.
   그래서 `index.html` 을 브라우저로 그냥 열면 드라이브 루트를 뒤지고 CSS 가
   하나도 안 붙는다. 그건 고장이 아니라 절대경로의 당연한 결과다.

   **배포에는 쓰이지 않는다.** Cloudflare 는 `public/` 을 그대로 얹고
   (`wrangler.toml` 의 `[assets]`), 빌드 명령은 `check-pages` 와 `inject-beacon`
   뿐이다. 이 파일은 거기 없다.

   의존성은 없다 — node 내장 모듈만 쓴다. 이 디렉터리의 규칙 그대로다.

   ------------------------------------------------------------ 배포와 맞춘 것

   · **404** — `wrangler.toml` 의 `not_found_handling = "404-page"` 를 흉내 낸다.
     없는 주소면 경로를 거슬러 올라가며 가장 가까운 `404.html` 을 찾아 404 로 낸다.
     그래서 `/en/없는쪽/` 은 영어 안내(`/en/404.html`)가 나온다 — 언어 칸마다
     404 를 하나씩 둔 이유가 그것이고, python 의 `http.server` 로는 확인할 수 없다.

   ------------------------------------------------------------ 배포와 다른 것

   · **`_headers` 를 읽지 않는다.** 글꼴 `immutable` 같은 캐시 머리는 안 붙는다.
     오히려 반대로 `no-store` 를 붙인다 — 고친 CSS 가 브라우저 캐시에 걸려
     "왜 안 바뀌지" 로 시간을 버리는 쪽이 훨씬 잦다.
   · **비콘이 없다.** `inject-beacon.mjs` 는 빌드 단계에서만 돈다.
   ============================================================ */
import { createServer } from 'node:http';
import { existsSync, statSync, createReadStream } from 'node:fs';
import { join, extname, dirname, resolve, sep } from 'node:path';
import { PUB } from './config.mjs';

const arg = (name, fallback) => {
    const i = process.argv.indexOf(name);
    return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const PORT = Number(arg('--port', 8000));

/* public/ 에 실제로 있는 확장자만 적는다. 모르는 것은 다운로드로 흐르게 두는 편이
   조용히 잘못된 타입으로 내보내는 것보다 낫다. */
const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.xml': 'application/xml; charset=utf-8',
    '.txt': 'text/plain; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.ico': 'image/x-icon',
    '.woff2': 'font/woff2',
};

/* 없는 주소일 때 Cloudflare 가 하는 일 — 경로를 거슬러 올라가며 가장 가까운
   404.html 을 쓴다. `/en/…` 오타에 한국어 안내가 나오지 않는 근거다. */
function nearest404(dir) {
    let at = dir;
    for (;;) {
        const file = join(at, '404.html');
        if (existsSync(file)) return file;
        if (at === PUB) return null;
        const up = dirname(at);
        if (up === at) return null;
        at = up;
    }
}

const send = (res, code, file) => {
    res.writeHead(code, {
        'Content-Type': MIME[extname(file)] || 'application/octet-stream',
        'Content-Length': statSync(file).size,
        /* 배포와 정반대로 둔다 — 위 머리말 참고 */
        'Cache-Control': 'no-store',
    });
    createReadStream(file).pipe(res);
};

const server = createServer((req, res) => {
    const path = decodeURIComponent((req.url || '/').split('?')[0]);
    let file = resolve(join(PUB, path));

    /* public/ 밖으로 나가는 경로는 받지 않는다 (`/../../..`) */
    if (file !== PUB && !file.startsWith(PUB + sep)) {
        res.writeHead(403).end('403');
        console.log(`403 ${path}`);
        return;
    }

    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');

    if (existsSync(file) && statSync(file).isFile()) {
        send(res, 200, file);
        /* 자산은 페이지마다 수십 개라 로그가 화면을 덮는다. 페이지만 찍는다. */
        if (file.endsWith('.html')) console.log(`200 ${path}`);
        return;
    }

    const page = nearest404(dirname(file));
    console.log(`404 ${path}`);
    if (page) { send(res, 404, page); return; }
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('404');
});

server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') {
        console.error(`포트 ${PORT} 을 이미 누가 쓰고 있다.`);
        console.error(`  다른 포트로: node tools/serve.mjs --port ${PORT + 1}`);
        console.error('  잡고 있는 것을 끄려면 (PowerShell):');
        console.error(`    Get-NetTCPConnection -LocalPort ${PORT} -State Listen |`
            + ' ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }');
        process.exit(1);
    }
    throw e;
});

server.listen(PORT, () => {
    console.log(`public/ → http://localhost:${PORT}`);
    console.log('  첫 화면 /        국가 /kr/        이름 축 /holiday/christmas/');
    console.log('  순위 /rank/      음력 /sky/lunar/  영어는 앞에 /en/');
    console.log('끄기: 이 창에서 Ctrl+C');
});
