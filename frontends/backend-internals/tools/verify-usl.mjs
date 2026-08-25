/* ============================================================
   30편 검증 — 실행: node tools/verify-usl.mjs
   ------------------------------------------------------------
   이 편의 검산점은 **바깥에서 온 실측이 아니라 수학**이다. USL 은 명세가 아니라
   적합 모델이고 σ·κ 는 실측으로 정하는 값이라, 계수를 검증 대상으로 삼을 수 없다.
   대신 **식이 만드는 두 지점**을 전수로 확인한다.

     ① Amdahl 상한  1/σ            — n 을 아무리 키워도 넘지 않는다
     ② USL 정점     √((1−σ)/κ)     — 그 정수 근처가 실제 최댓값이다
     ③ κ=0 이면 USL 이 Amdahl 과 **정확히** 같다

   그 위에 본문·시나리오가 인용한 수치를 대조한다.
   ============================================================ */
import { boot } from './lab-harness.mjs';

const r = boot('usl');
if (r.errors.length) { console.error('구동 실패:', r.errors); process.exit(1); }
const LAB = r.lab;

let pass = 0;
const fail = [];
const ok = (what, got, want) => {
    if (String(got) === String(want)) pass++;
    else fail.push(`${what} — 실측 ${got} / 기대 ${want}`);
};
const near = (what, got, want, eps) => {
    if (Math.abs(got - want) <= eps) pass++;
    else fail.push(`${what} — 실측 ${got} / 기대 ${want} (허용 ${eps})`);
};

const at = o => LAB.m(Object.assign({ n: 1, sigma: 0.05, kappa: 0.001 }, o));
const f2 = v => (Math.round(v * 100) / 100).toFixed(2);

/* ── 1. 검산점 ───────────────────────────────────────────── */

/* ① Amdahl 상한 1/σ — 어떤 n 에서도 넘지 않는다 */
{
    let checked = 0;
    for (const s of LAB.SIGMAS) {
        const cap = LAB.ceiling(s);
        near(`상한 정의 σ=${s}`, cap, 1 / s, 1e-12);
        for (let n = 1; n <= LAB.NMAX; n++) {
            if (LAB.amdahl(n, s) > cap + 1e-9) { fail.push(`검산① σ=${s} n=${n} 이 상한을 넘었다`); break; }
            checked++;
        }
    }
    ok(`검산① 전수 ${checked}조합`, checked, LAB.SIGMAS.length * LAB.NMAX);
}

/* ② USL 정점 — √((1−σ)/κ) 의 정수 근처가 실제 최댓값인가 (1..256 전수) */
{
    let checked = 0;
    for (const s of LAB.SIGMAS) for (const k of LAB.KAPPAS) {
        if (k === 0) continue;
        const p = LAB.peakAt(s, k);
        near(`정점 정의 σ=${s} κ=${k}`, p, Math.sqrt((1 - s) / k), 1e-12);
        /* 전수 탐색으로 실제 최댓값 위치를 찾는다 */
        let bestN = 1, bestV = -1;
        for (let n = 1; n <= LAB.NMAX; n++) {
            const v = LAB.usl(n, s, k);
            if (v > bestV) { bestV = v; bestN = n; }
        }
        const pInt = Math.max(1, Math.round(p));
        if (p < LAB.NMAX && Math.abs(bestN - pInt) > 1)
            fail.push(`검산② σ=${s} κ=${k} — 실제 최댓값 n=${bestN}, 식은 ${pInt}`);
        else checked++;
    }
    ok(`검산② 전수 ${checked}조합`, checked, LAB.SIGMAS.length * (LAB.KAPPAS.length - 1));
}

/* ③ κ=0 이면 USL = Amdahl (정확히) */
{
    let checked = 0;
    for (const s of LAB.SIGMAS) for (let n = 1; n <= LAB.NMAX; n++) {
        if (LAB.usl(n, s, 0) !== LAB.amdahl(n, s)) { fail.push(`검산③ σ=${s} n=${n} 에서 다르다`); break; }
        checked++;
    }
    ok(`검산③ 전수 ${checked}조합`, checked, LAB.SIGMAS.length * LAB.NMAX);
    ok('κ=0 이면 정점이 없다', LAB.peakAt(0.05, 0), Infinity);
}

/* ── 2. 본문이 인용한 수치 (σ=5% · κ=0.001) ─────────────── */

ok('Amdahl 상한 ×20.0', LAB.ceiling(0.05).toFixed(1), '20.0');
near('정점 30.82', LAB.peakAt(0.05, 0.001), 30.82, 0.01);
ok('정점 정수 31', at({}).peakInt, 31);

for (const [n, u, a, lat] of [
    [1, '1.00', '1.00', '1.00'],
    [8, '5.69', '5.93', '1.41'],
    [16, '8.04', '9.14', '1.99'],
    [31, '9.04', '12.40', '3.43'],
    [64, '7.82', '15.42', '8.18'],
    [128, '5.42', '17.41', '23.61'],
    [256, '3.24', '18.62', '79.03']
]) {
    const m = at({ n });
    ok(`n=${n} USL`, f2(m.now), u);
    ok(`n=${n} Amdahl`, f2(m.am), a);
    ok(`n=${n} 응답시간`, f2(m.lat), lat);
}

/* 레시피 4 — 정점으로 내리면 */
{
    const peak = at({ n: 31 }), far = at({ n: 256 });
    ok('정점 대비 처리량 하락 2.79배', f2(peak.now / far.now), '2.79');
    ok('정점 대비 응답시간 23.04배', f2(far.lat / peak.lat), '23.04');
}

/* 레시피 5 — 정점을 조금 넘기면 */
{
    const peak = at({ n: 31 }), over = at({ n: 64 });
    ok('처리량은 13% 만 떨어진다', Math.round((1 - over.now / peak.now) * 100), 13);
    ok('응답시간은 2.39배', f2(over.lat / peak.lat), '2.39');
}

/* 레시피 6 — σ 를 반으로 줄이면 상한만 오른다 */
{
    near('σ=2% 정점 31.30', LAB.peakAt(0.02, 0.001), 31.30, 0.01);
    ok('σ=2% 상한 ×50.0', LAB.ceiling(0.02).toFixed(1), '50.0');
    ok('본문 — 정점은 0.5 밖에 안 움직인다',
        (LAB.peakAt(0.02, 0.001) - LAB.peakAt(0.05, 0.001)).toFixed(1), '0.5');
}

/* 레시피 7 — κ 를 5배로 */
{
    near('κ=0.005 정점 13.78', LAB.peakAt(0.05, 0.005), 13.78, 0.01);
    ok('κ=0.005 최대 처리량 5.47', f2(at({ n: 14, kappa: 0.005 }).now), '5.47');
    ok('본문 — κ 5배면 정점이 √5 배 작아진다',
        (LAB.peakAt(0.05, 0.001) / LAB.peakAt(0.05, 0.005)).toFixed(2), Math.sqrt(5).toFixed(2));
}

/* 본문 κ 별 정점 표 */
for (const [k, p, v] of [[0.0002, '68.9', '12.93'], [0.0005, '43.6', '10.74'],
                         [0.001, '30.8', '9.04'], [0.005, '13.8', '5.47']]) {
    ok(`표 κ=${k} 정점`, LAB.peakAt(0.05, k).toFixed(1), p);
    ok(`표 κ=${k} 처리량`, f2(at({ n: Math.round(LAB.peakAt(0.05, k)), kappa: k }).now), v);
}

/* ── 3. 불변식 ──────────────────────────────────────────── */

/* ④ 리틀의 법칙 — 응답시간 = n / 처리량 */
{
    let checked = 0;
    for (const s of LAB.SIGMAS) for (const k of LAB.KAPPAS) for (const n of [1, 8, 31, 64, 256]) {
        const m = at({ n, sigma: s, kappa: k });
        if (Math.abs(m.lat - n / m.now) > 1e-9) fail.push(`불변식④ σ=${s} κ=${k} n=${n}`);
        else checked++;
    }
    ok(`불변식④ 전수 ${checked}조합`, checked, LAB.SIGMAS.length * LAB.KAPPAS.length * 5);
}

/* ⑤ USL ≤ Amdahl 이 언제나 성립한다 (κ ≥ 0 이므로) */
{
    let checked = 0;
    for (const s of LAB.SIGMAS) for (const k of LAB.KAPPAS) for (let n = 1; n <= LAB.NMAX; n += 5) {
        if (LAB.usl(n, s, k) > LAB.amdahl(n, s) + 1e-9) { fail.push(`불변식⑤ σ=${s} κ=${k} n=${n}`); break; }
        checked++;
    }
    ok(`불변식⑤ 전수 ${checked}조합`, checked > 500, true);
}

/* ⑥ 응답시간은 정점을 넘으면 단조 증가한다 */
{
    let checked = 0;
    for (const s of LAB.SIGMAS) for (const k of [0.0005, 0.001, 0.005]) {
        const p = Math.round(LAB.peakAt(s, k));
        let prev = -1, mono = true;
        for (let n = p; n <= LAB.NMAX; n++) {
            const lat = n / LAB.usl(n, s, k);
            if (lat < prev - 1e-9) mono = false;
            prev = lat;
        }
        if (!mono) fail.push(`불변식⑥ σ=${s} κ=${k} 응답시간이 단조가 아니다`);
        else checked++;
    }
    ok(`불변식⑥ 전수 ${checked}조합`, checked, LAB.SIGMAS.length * 3);
}

/* ⑦ 정점을 정하는 것은 κ 다 — σ 를 바꿔도 정점이 거의 안 움직인다 */
{
    for (const k of [0.0005, 0.001, 0.005]) {
        const lo = LAB.peakAt(0.01, k), hi = LAB.peakAt(0.20, k);
        ok(`불변식⑦ κ=${k} 에서 σ 를 20배 바꿔도 정점 변화가 12% 미만`,
            (1 - hi / lo) < 0.12, true);
    }
    /* 반대로 κ 를 바꾸면 크게 움직인다 */
    ok('불변식⑦ κ 를 25배 키우면 정점이 5배 작아진다',
        (LAB.peakAt(0.05, 0.0002) / LAB.peakAt(0.05, 0.005)).toFixed(1), '5.0');
}

/* ── 4. 시나리오가 본문과 같은 설정을 밟나 ───────────────── */
{
    const want = [
        { n: 1, sigma: 0.05, kappa: 0 },
        { n: 256, sigma: 0.05, kappa: 0 },
        { n: 256, sigma: 0.05, kappa: 0.001 },
        { n: 31, sigma: 0.05, kappa: 0.001 },
        { n: 64, sigma: 0.05, kappa: 0.001 },
        { n: 31, sigma: 0.02, kappa: 0.001 },
        { n: 14, sigma: 0.05, kappa: 0.005 }
    ];
    ok('시나리오 단계 수', LAB.scene.length, want.length);
    want.forEach((w, i) => ok(`시나리오 ${i + 1} 설정`, JSON.stringify(LAB.scene[i]), JSON.stringify(w)));
    want.forEach((w, i) => ok(`시나리오 ${i + 1} σ 가 손잡이 위에 있다`, LAB.SIGMAS.includes(w.sigma), true));
    want.forEach((w, i) => ok(`시나리오 ${i + 1} κ 가 손잡이 위에 있다`, LAB.KAPPAS.includes(w.kappa), true));
    /* 4번과 7번은 정점에 정확히 서 있어야 한다 */
    ok('시나리오 4 는 정점이다', at({ n: 31 }).atPeak, true);
    ok('시나리오 7 은 정점이다', at({ n: 14, kappa: 0.005 }).atPeak, true);
}

/* ── 5. 렌더된 문자열 ────────────────────────────────────── */
{
    LAB.set({ n: 256, sigma: 0.05, kappa: 0.001 });
    ok('미터에 3.24 가 있다', r.doc.cache.get('#meters').innerHTML.includes('3.24'), true);
    ok('미터에 상한 ×20.0 이 있다', r.doc.cache.get('#meters').innerHTML.includes('20.0'), true);
    ok('판정이 정점을 넘었다고 말한다', r.doc.cache.get('#verdict').innerHTML.includes('2.79'), true);
    ok('곡선에 정점 표시가 있다', r.doc.cache.get('#curve').innerHTML.includes('peaklbl'), true);
    ok('응답시간 표에 79.03 이 있다', r.doc.cache.get('#lat').innerHTML.includes('79.03'), true);

    LAB.set({ kappa: 0 });
    ok('κ=0 이면 정점 표시가 없다', r.doc.cache.get('#curve').innerHTML.includes('peaklbl'), false);
    ok('κ=0 이면 정점 미터가 ∞', r.doc.cache.get('#meters').innerHTML.includes('∞'), true);

    LAB.set({ n: 1, sigma: 0.05, kappa: 0 });   /* 첫 화면으로 */
}

console.log(fail.length ? '' : `단언 ${pass}건 — 전부 통과`);
for (const f of fail) console.error('실패  ' + f);
if (fail.length) console.error(`\n통과 ${pass}건 · 실패 ${fail.length}건`);
process.exit(fail.length ? 1 : 0);
