/* ============================================================
   VSOP87D.ear → tools/vsop87.mjs (절단본)
   실행: node tools/gen-vsop87.mjs   (frontends/dday-static 에서)
   ------------------------------------------------------------
   **한 번 돌리고 마는 도구다.** 월 1회 갱신에는 들어가지 않는다 — 행성 이론은
   바뀌지 않으므로 tools/vsop87.mjs 를 커밋해 두고 그대로 쓴다.

   그래도 이 파일이 있어야 하는 이유는 하나다. 저 표는 172줄짜리 숫자 뭉치라
   손으로 검산할 수 없다. 어디서 왔고 무엇을 버렸는지 코드로 남겨 두지 않으면,
   나중에 누가 봐도 믿을 근거가 없다.

   자료는 Bretagnon & Francou 의 VSOP87 정본이고 CDS 스트라스부르가 배포한다
   (카탈로그 VI/81). 네트워크를 타는 유일한 다른 단계인 gen-holidays.mjs 와 달리
   이건 사람이 손으로 돌린다.
   ============================================================ */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { HERE } from './config.mjs';

const SOURCE = 'https://cdsarc.cds.unistra.fr/ftp/VI/81/VSOP87D.ear';

/* 남길 항의 문턱(라디안). |A|·τ^p 가 이보다 작으면 버린다.
   τ 는 J2000 부터의 율리우스 천년이고, 이 사이트가 담는 3년 구간에서 |τ| < 0.03 이다.

   1e-6(56항) 도 1e-8(447항) 도 분점·지점 오차는 1분으로 같았다. 1e-7 을 고른 것은
   담는 기간이 늘어나도 여유가 남게 하기 위해서다. */
const THRESHOLD = 1e-7;
const TAU_MAX = 0.03;

const NAME = { 1: 'L', 2: 'B', 3: 'R' };
const WHAT = { L: '황경(라디안)', B: '황위(라디안)', R: '동경거리(AU)' };

console.log(`${SOURCE} 받는 중…`);
const res = await fetch(SOURCE);
if (!res.ok) { console.error(`받지 못했다 — HTTP ${res.status}`); process.exit(1); }
const text = await res.text();

/* 형식은 표준 VSOP87 이다. 헤더 줄이 변수(1=L·2=B·3=R)와 T 의 거듭제곱을 알려 주고,
   이어지는 자료 줄의 마지막 세 수가 A · B · C 다 — 항은 A·cos(B + C·τ). */
const series = {};
let cur = null, total = 0;
for (const ln of text.split('\n')) {
    if (ln.includes('VSOP87 VERSION')) {
        const v = +/VARIABLE (\d)/.exec(ln)[1];
        const p = +/\*T\*\*(\d)/.exec(ln)[1];
        (series[v] ??= {})[p] = cur = [];
        continue;
    }
    if (!ln.trim() || !cur) continue;
    const n = ln.trim().split(/\s+/).map(Number);
    const [a, b, c] = n.slice(-3);
    if (!Number.isFinite(a)) continue;
    cur.push([a, b, c]);
    total++;
}
if (!series[1]) { console.error('L 급수를 못 찾았다 — 파일 형식이 바뀌었나'); process.exit(1); }

let kept = 0;
const blocks = [1, 2, 3].map((v) => {
    const inner = Object.keys(series[v]).sort().map((p) => {
        const rows = series[v][p].filter(([a]) => Math.abs(a) * TAU_MAX ** p >= THRESHOLD);
        if (!rows.length) return null;
        kept += rows.length;
        return `    ${p}: [\n${rows.map(([a, b, c]) => `        [${a}, ${b}, ${c}],`).join('\n')}\n    ],`;
    }).filter(Boolean).join('\n');
    return `/* ${NAME[v]} — ${WHAT[NAME[v]]} */\nexport const ${NAME[v]} = {\n${inner}\n};`;
}).join('\n\n');

const head = `/* ============================================================
   VSOP87D — 지구의 일주 운동 (절단본)
   ------------------------------------------------------------
   출처  Bretagnon P., Francou G., "Planetary theories in rectangular
         and spherical variables: VSOP87 solution", Astron. Astrophys.
         202, 309 (1988). 파일 VSOP87D.ear, CDS 카탈로그 VI/81.
         ${SOURCE}

   각 항은  A · cos(B + C·τ)  이고 τ 는 J2000 부터의 율리우스 천년
   (τ = (JDE − 2451545.0) / 365250) 이다.
   급수 하나는  Σ_p τ^p · Σ_i A cos(B + C τ)  로 합쳐진다.

   전체 ${total}항 중 |A|·${TAU_MAX}^p ≥ ${THRESHOLD} 인 ${kept}항만 남겼다.
   ${TAU_MAX} 은 이 사이트가 담는 기간(3년)의 |τ| 상한이다.
   이 절단으로도 분점·지점 12건이 공표값과 1분 안에 든다 — 절단 전과 같다.

   손으로 고치지 마세요. tools/gen-vsop87.mjs 가 만듭니다.
   ============================================================ */
`;

writeFileSync(join(HERE, 'vsop87.mjs'), head + '\n' + blocks + '\n');
console.log(`tools/vsop87.mjs — ${kept}항 / 전체 ${total}항`);
console.log('이어서 node tools/gen-sky.mjs → gen-pages.mjs → check-pages.mjs 로 확인할 것.');
