/* ============================================================
   24편 검증 — 실행: node tools/verify-fanout.mjs
   ------------------------------------------------------------
   배포되는 `shared/fanout-lab.js` 를 그대로 구동해서
     1. 본문 · 시나리오 · 판정이 인용한 수치가 모델의 실측과 같은가
     2. 불변식이 전 조합에서 성립하는가
     3. 논문(Dean & Barroso, CACM 2013)의 두 예시가 재현되는가
   를 본다. 허용오차 없이 정확히 일치해야 한다.

   이 스크립트가 못 보는 것 — 모델이 현실과 맞는가. 그건 착수 전 게이트에서
   원문 대조로 했다(`docs/todo.md` 24번 항목).
   ============================================================ */
import { boot } from './lab-harness.mjs';

const r = boot('fanout');
if (r.errors.length) { console.error('구동 실패:', r.errors); process.exit(1); }
const LAB = r.lab;

let pass = 0;
const fail = [];
const ok = (what, got, want) => {
    if (String(got) === String(want)) pass++;
    else fail.push(`${what} — 실측 ${got} / 본문 ${want}`);
};
const near = (what, got, want, eps) => {
    if (Math.abs(got - want) <= eps) pass++;
    else fail.push(`${what} — 실측 ${got} / 기대 ${want} (허용 ${eps})`);
};

/* 화면 표기와 같은 반올림으로 읽는다 */
const pc = v => v === 0 ? '0' : v >= 10 ? v.toFixed(1) : v >= 1 ? v.toFixed(2) : v.toFixed(3);
const at = o => LAB.calc(Object.assign({ N: 100, p: 0.01, s: 1, hedge: false, H: 30 }, o));
const tail = o => pc(at(o).q * 100);
const amp = o => pc(at(o).amp);
const mean = o => Math.round(at(o).mean);
const extra = o => pc(at(o).extra * 100);

/* ── 1. 본문이 인용한 수치 ───────────────────────────────── */

/* 레시피 1 · 시나리오 1~2 — 서버 하나 → 100대 */
ok('N=1 꼬리', tail({ N: 1 }), '1.00');
ok('N=1 배수', amp({ N: 1 }), '1.00');
ok('N=1 평균', mean({ N: 1 }), 20);
ok('N=100 꼬리', tail({}), '63.4');
ok('N=100 배수', amp({}), '63.4');
ok('N=100 평균', mean({}), 638);

/* 레시피 2 · 시나리오 3 — 절반을 넘는 폭 */
ok('N=68 꼬리', tail({ N: 68 }), '49.5');
ok('N=69 꼬리', tail({ N: 69 }), '50.0');
ok('절반을 넘는 폭', at({}).nStar, 69);

/* 본문 표 — 폭에 따른 꼬리 (p=1%) */
ok('표 N=10', tail({ N: 10 }), '9.56');
ok('표 N=50', tail({ N: 50 }), '39.5');
ok('표 N=200', tail({ N: 200 }), '86.6');

/* 레시피 3 · 시나리오 4 — 서버를 10배 좋게 */
ok('p=0.1% 꼬리', tail({ p: 0.001 }), '9.52');
ok('p=0.1% 배수', amp({ p: 0.001 }), '95.2');
ok('p=0.1% 평균', mean({ p: 0.001 }), 104);

/* 레시피 4 · 시나리오 5 — 사본 30ms */
ok('hedge30 꼬리', tail({ hedge: true, H: 30 }), '0.995');
ok('hedge30 배수', amp({ hedge: true, H: 30 }), '0.995');
ok('hedge30 평균', mean({ hedge: true, H: 30 }), 39);
ok('hedge30 추가요청', extra({ hedge: true, H: 30 }), '1.00');

/* 레시피 5 · 시나리오 6 — 사본 5ms. 꼬리는 그대로, 부하만 100배 */
ok('hedge5 꼬리', tail({ hedge: true, H: 5 }), '0.995');
ok('hedge5 평균', mean({ hedge: true, H: 5 }), 23);
ok('hedge5 추가요청', extra({ hedge: true, H: 5 }), '100.0');
ok('사본 시점이 꼬리를 안 바꾼다',
    at({ hedge: true, H: 5 }).q === at({ hedge: true, H: 30 }).q, true);

/* 레시피 6 · 시나리오 7 — 라운드와 폭 */
ok('s=2 꼬리', tail({ s: 2 }), '86.6');
ok('s=2 평균', mean({ s: 2 }), 1275);
ok('N=200 평균', mean({ N: 200 }), 867);

/* ── 2. 불변식 ──────────────────────────────────────────── */

/* ① 폭 1 · 라운드 1 이면 사용자가 겪는 꼬리는 서버 하나의 꼬리와 정확히 같다 */
for (const p of LAB.PS) near(`불변식① N=1 이면 꼬리=p (p=${p})`, at({ N: 1, p }).q, p, 1e-15);

/* ② 닿는 서버 수가 같으면 꼬리 확률이 정확히 같다 — 폭과 라운드를 구별하지 못한다.
      (평균은 다르다. 그것도 함께 확인한다.) */
{
    let same = 0, meanDiffers = 0;
    for (const p of LAB.PS) {
        for (let n = 2; n <= 100; n++) {
            for (const s of [2, 3, 4, 5]) {
                const a = at({ N: n, p, s });
                const b = at({ N: n * s, p, s: 1 });
                if (Math.abs(a.q - b.q) > 1e-15) {
                    fail.push(`불변식② N=${n}·s=${s} 와 N=${n * s} 의 꼬리가 다르다`);
                } else same++;
                if (Math.abs(a.mean - b.mean) > 1e-9) meanDiffers++;
            }
        }
    }
    ok(`불변식② 전수 ${same}조합에서 꼬리 일치`, same, 7 * 99 * 4);
    ok('불변식② 그런데 평균은 대부분 다르다', meanDiffers > same * 0.9, true);
}

/* ③ 사본은 꼬리를 절대 올리지 않는다 — 전 조합 */
{
    let checked = 0;
    for (const p of LAB.PS)
        for (let n = 1; n <= 200; n += 7)
            for (const s of [1, 2, 3, 4, 5])
                for (const H of [0, 5, 30, 100, 200]) {
                    const off = at({ N: n, p, s, hedge: false, H }).q;
                    const on = at({ N: n, p, s, hedge: true, H }).q;
                    if (on > off + 1e-15) fail.push(`불변식③ N=${n} p=${p} s=${s} H=${H} 에서 사본이 꼬리를 올렸다`);
                    else checked++;
                }
    ok(`불변식③ 전수 ${checked}조합`, checked > 0, true);
}

/* ④ 추가 요청은 사본 시점 하나로 갈린다 — 10ms 미만이면 전부, 아니면 느린 것만 */
{
    let cliff = 0;
    for (const p of LAB.PS)
        for (const H of [0, 5, 10, 15, 30, 200]) {
            const e = at({ p, hedge: true, H }).extra;
            const want = H < 10 ? 1 : p;
            if (Math.abs(e - want) > 1e-15) fail.push(`불변식④ H=${H} p=${p} 추가요청 ${e} (기대 ${want})`);
            else cliff++;
        }
    ok(`불변식④ 전수 ${cliff}조합`, cliff, LAB.PS.length * 6);
    ok('불변식④ 절벽은 정확히 10ms 에 있다',
        at({ hedge: true, H: 5 }).extra === 1 && at({ hedge: true, H: 10 }).extra === 0.01, true);
}

/* ⑤ 사본을 꺼도 켠 것과 같은 값이 나오는 자리는 없다 (폭이 있는 한) */
ok('불변식⑤ N=1 에서도 사본은 꼬리를 줄인다', at({ N: 1, hedge: true }).q < at({ N: 1 }).q, true);

/* ── 3. 논문 재현 (Dean & Barroso, CACM 2013) ─────────────── */

/* 예시 1 — 서버 100대 · 각 1% → 논문 표기 63% */
near('논문 예시1 — 63%', at({ N: 100, p: 0.01 }).q * 100, 63.397, 0.001);

/* 예시 2 — 서버 2,000대 · 각 1/10,000 → "거의 다섯 중 하나".
   이 점은 슬라이더 밖이지만 식은 같다. 두 점이 맞아야 식이 맞은 것이다. */
{
    const q = at({ N: 2000, p: 0.0001 }).q;
    near('논문 예시2 — 18.1%', q * 100, 18.13, 0.01);
    ok('논문 예시2 — "거의 다섯 중 하나"', 1 / q > 5 && 1 / q < 6, true);
}

/* ── 4. 시나리오가 본문과 같은 설정을 밟나 ───────────────── */
{
    const want = [
        { N: 1, p: 0.01, s: 1, hedge: false, H: 30 },
        { N: 100, p: 0.01, s: 1, hedge: false, H: 30 },
        { N: 69, p: 0.01, s: 1, hedge: false, H: 30 },
        { N: 100, p: 0.001, s: 1, hedge: false, H: 30 },
        { N: 100, p: 0.01, s: 1, hedge: true, H: 30 },
        { N: 100, p: 0.01, s: 1, hedge: true, H: 5 },
        { N: 100, p: 0.01, s: 2, hedge: false, H: 30 }
    ];
    ok('시나리오 단계 수', LAB.scene.length, want.length);
    want.forEach((w, i) => ok(`시나리오 ${i + 1} 설정`, JSON.stringify(LAB.scene[i]), JSON.stringify(w)));
}

/* ── 5. 렌더된 문자열이 실제로 그 수치를 담고 있나 ────────── */
{
    LAB.set({ N: 100, p: 0.01, s: 1, hedge: false, H: 30 });
    const meters = r.doc.cache.get('#meters').innerHTML;
    ok('미터에 63.4 가 있다', meters.includes('63.4'), true);
    ok('미터에 평균 638 이 있다', meters.includes('638'), true);
    const verdict = r.doc.cache.get('#verdict').innerHTML;
    ok('판정이 절반 초과를 말한다', verdict.includes('63.4'), true);
    const grid = r.doc.cache.get('#grid').innerHTML;
    ok('격자에 채워진 칸이 63개', (grid.match(/class="hit"/g) || []).length, 63);

    LAB.set({ hedge: true, H: 30 });
    const g2 = r.doc.cache.get('#grid').innerHTML;
    ok('사본을 켜면 진한 칸 1개', (g2.match(/class="hit"/g) || []).length, 1);
    ok('사본이 건진 칸 62개', (g2.match(/class="saved"/g) || []).length, 62);

    LAB.set({ N: 1, p: 0.01, s: 1, hedge: false, H: 30 });   /* 첫 화면으로 되돌린다 */
}

console.log(fail.length ? '' : `단언 ${pass}건 — 전부 통과`);
for (const f of fail) console.error('실패  ' + f);
if (fail.length) console.error(`\n통과 ${pass}건 · 실패 ${fail.length}건`);
process.exit(fail.length ? 1 : 0);
