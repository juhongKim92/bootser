/* ============================================================
   25편 검증 — 실행: node tools/verify-omission.mjs
   ------------------------------------------------------------
   배포되는 `shared/omission-lab.js` 를 그대로 구동해서
     1. 본문 · 시나리오 · 판정이 인용한 수치가 모델의 실측과 같은가
     2. 불변식이 전 조합에서 성립하는가
     3. wrk2 실측 예시의 "어느 퍼센타일에서 뒤집히나" 를 이 식이 맞히는가
   를 본다. 허용오차 없이 정확히 일치해야 한다.

   이 스크립트가 못 보는 것 — 모델이 현실과 맞는가. 그건 착수 전 게이트에서
   HdrHistogram 소스와 wrk2 문서 대조로 했다(`docs/todo.md` 25번 항목).
   ============================================================ */
import { boot } from './lab-harness.mjs';

const r = boot('omission');
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

const BASE = { C: 10, S: 10, T: 300, D: 30 };
const at = o => Object.assign({}, BASE, o);
/* 화면 표기와 같은 반올림으로 읽는다 */
const ms = v => v >= 1000 ? (v / 1000).toFixed(2) + '초' : Math.round(v) + 'ms';
const q = (mode, pct, o) => ms(LAB.q(mode, pct, at(o)));
const n = (mode, o) => LAB.parts(at(o)).n[mode];
const rev = (mode, o) => LAB.reveal(mode, at(o));

/* ── 1. 본문이 인용한 수치 ───────────────────────────────── */

/* 레시피 1 · 시나리오 1 — 정지가 없으면 셋이 같다 */
for (const p of [50, 90, 99, 99.9, 99.99, 100])
    for (const m of LAB.MODES) ok(`정지 0 · ${m} p${p}`, q(m, p, { D: 0 }), '10ms');
ok('정지 0 표본이 셋 다 같다',
    new Set(LAB.MODES.map(m => n(m, { D: 0 }))).size, 1);

/* 레시피 2 · 시나리오 2 — 폐루프는 p99.99 로도 못 본다 */
ok('폐루프 p99', q('closed', 99, {}), '10ms');
ok('폐루프 p99.9', q('closed', 99.9, {}), '10ms');
ok('폐루프 p99.99', q('closed', 99.99, {}), '10ms');
ok('폐루프 최대', q('closed', 100, {}), '30.01초');
ok('폐루프 표본', n('closed', {}), 270010);
ok('폐루프가 드러나는 지점', rev('closed', {}).toFixed(3), '99.996');
ok('정지에 묶이는 요청은 워커 수만큼', LAB.parts(at({})).stuck, 10);

/* 레시피 3 · 시나리오 3 — 개루프 */
ok('개루프 p99', q('open', 99, {}), '27.01초');
ok('개루프 p99.9', q('open', 99.9, {}), '29.71초');
ok('개루프 p99.99', q('open', 99.99, {}), '29.98초');
ok('개루프 표본', n('open', {}), 300000);
ok('개루프가 드러나는 지점', rev('open', {}).toFixed(1), '90.0');
ok('왜곡 배수', Math.round(LAB.q('open', 99, at({})) / LAB.q('closed', 99, at({}))), 2701);

/* 레시피 4 · 시나리오 4 — 보정이 개루프를 재현한다 */
ok('보정 p99', q('fixed', 99, {}), '27.01초');
ok('보정 p99.9', q('fixed', 99.9, {}), '29.71초');
ok('보정 표본', n('fixed', {}), 300010);
ok('보정이 채워 넣은 기록', n('fixed', {}) - n('closed', {}), 30000);
ok('묶인 표본 하나가 만드는 기록', LAB.parts(at({})).K, 3001);

/* 레시피 5 · 시나리오 5 — 부하를 5배로 올려도 안 변한다 */
ok('워커 50 폐루프 p99', q('closed', 99, { C: 50 }), '10ms');
ok('워커 50 드러나는 지점', rev('closed', { C: 50 }).toFixed(3), '99.996');
ok('워커 50 표본', n('closed', { C: 50 }), 1350050);

/* 레시피 6 · 시나리오 6 — 시험 시간이 왜곡을 정한다 */
ok('60초 시험 p99.99', q('closed', 99.99, { T: 60 }), '30.01초');
ok('60초 시험 드러나는 지점', rev('closed', { T: 60 }).toFixed(3), '99.967');
ok('600초 시험 드러나는 지점', rev('closed', { T: 600 }).toFixed(3), '99.998');
ok('600초 시험 p99.99 는 다시 숨는다', q('closed', 99.99, { T: 600 }), '10ms');

/* 레시피 7 · 시나리오 7 — 개루프도 만능은 아니다 */
ok('정지 3초 개루프 p99', q('open', 99, { D: 3 }), '10ms');
ok('정지 3초 개루프 p99.9', q('open', 99.9, { D: 3 }), '2.71초');
ok('정지 3초 개루프 드러나는 지점', rev('open', { D: 3 }).toFixed(1), '99.0');

/* 본문 "최대값은 셋 다 같다" 표 */
ok('최대값이 세 방식 모두 같다',
    new Set(LAB.MODES.map(m => LAB.q(m, 100, at({})))).size, 1);

/* ── 2. 불변식 ──────────────────────────────────────────── */

const CS = [1, 5, 10, 25, 50], TS = [30, 60, 100, 200, 300, 600], DS = [0, 1, 3, 10, 30, 60];

/* ① 정지가 0 이면 세 방식의 모든 퍼센타일이 완전히 일치한다 */
{
    let checked = 0;
    for (const C of CS) for (const S of LAB.SS) for (const T of TS)
        for (const p of [50, 90, 99, 99.9, 99.99, 100]) {
            const o = { C, S, T, D: 0 };
            const vs = LAB.MODES.map(m => LAB.q(m, p, o));
            if (new Set(vs).size !== 1) fail.push(`불변식① C=${C} S=${S} T=${T} p${p} 에서 갈렸다 — ${vs}`);
            else checked++;
        }
    ok(`불변식① 전수 ${checked}조합`, checked, CS.length * LAB.SS.length * TS.length * 6);
}

/* ② 폐루프의 꼬리에는 모양이 없다 — 값이 언제나 "평소" 아니면 "최대" 둘 중 하나다.
      (처음엔 "폐루프가 개루프보다 크지 않다" 로 썼다가 이 검증에 잡혔다.
       문턱을 넘는 순간 폐루프는 곧장 최대값으로 뛰므로 그 구간에서는 개루프보다 크다.)
   ③ 폐루프가 개루프보다 큰 값을 보고하는 것은 오직 최대값을 보고할 때뿐이다
   ④ 보정과 개루프의 차이는 평소 응답 시간을 넘지 않는다
   ⑤ 놓친 표본 = 개루프가 정지에 밀어넣은 수 − 워커 수 */
{
    let checked = 0;
    for (const C of CS) for (const S of LAB.SS) for (const T of TS) for (const D of DS) {
        if (D > T - 10) continue;
        const o = { C, S, T, D }, P = LAB.parts(o);
        for (const p of [50, 90, 99, 99.9, 99.99]) {
            const c = LAB.q('closed', p, o), op = LAB.q('open', p, o);
            if (c !== S && c !== P.peak)
                fail.push(`불변식② C=${C} S=${S} T=${T} D=${D} p${p} 에서 폐루프가 중간값 ${c} 를 냈다`);
            if (c > op + 1e-9 && c !== P.peak)
                fail.push(`불변식③ C=${C} S=${S} T=${T} D=${D} p${p} 에서 폐루프가 최대값도 아닌데 더 컸다`);
            if (Math.abs(LAB.q('fixed', p, o) - op) > S)
                fail.push(`불변식④ C=${C} S=${S} T=${T} D=${D} p${p} 에서 보정이 개루프와 ${S}ms 넘게 달랐다`);
        }
        if (P.n.open - P.n.closed !== P.badOpen - P.stuck)
            fail.push(`불변식⑤ C=${C} S=${S} T=${T} D=${D} 놓친 표본이 안 맞는다`);
        checked++;
    }
    ok(`불변식②③④⑤ 전수 ${checked}조합`, checked > 500, true);
}

/* 개루프에는 그 사이가 있다 — 같은 설정에서 평소도 최대도 아닌 값을 낸다 */
{
    const o = { C: 10, S: 10, T: 300, D: 30 }, P = LAB.parts(o);
    const mid = LAB.q('open', 99.9, o);
    ok('개루프는 꼬리에 중간값이 있다', mid !== 10 && mid !== P.peak, true);
    ok('폐루프는 같은 자리에서 평소값이다', LAB.q('closed', 99.9, o), 10);
}

/* ⑥ 폐루프의 왜곡은 부하와 무관하다 — 드러나는 지점이 워커 수에 안 움직인다 */
{
    const want = rev('closed', { C: 1 });
    for (const C of CS) near(`불변식⑥ 워커 ${C} 에서도 드러나는 지점이 같다`, rev('closed', { C }), want, 1e-12);
    ok('불변식⑥ 그런데 표본 수는 워커에 비례한다',
        n('closed', { C: 50 }) > n('closed', { C: 1 }) * 40, true);
}

/* ⑦ 시험을 길게 할수록 폐루프는 더 깊이 숨는다 */
{
    let mono = true, prev = -1;
    for (const T of TS) { const v = rev('closed', { T }); if (v < prev) mono = false; prev = v; }
    ok('불변식⑦ 시험이 길수록 드러나는 지점이 뒤로 간다', mono, true);
}

/* ── 3. wrk2 실측 예시 대조 ──────────────────────────────
   연결 100 · 30초 · 2,000rps · 정지 1.4초. 발표된 출력에서 보정판은 p90 정상 ·
   p99 정지, 미보정은 p99 정상 · p99.9 정지다. 같은 식으로 그 경계를 맞히나. */
{
    const conns = 100, T = 30, D = 1.4, rps = 2000;
    const nOpen = rps * T, good = nOpen - rps * D, nClosed = good + conns;
    const revOpen = 100 * good / nOpen, revClosed = 100 * good / nClosed;
    near('wrk2 — 보정판이 드러나는 지점', revOpen, 95.33, 0.01);
    near('wrk2 — 미보정이 드러나는 지점', revClosed, 99.825, 0.01);
    ok('wrk2 — 보정판은 p90 에서 정상, p99 에서 정지', revOpen > 90 && revOpen < 99, true);
    ok('wrk2 — 미보정은 p99 에서 정상, p99.9 에서 정지', revClosed > 99 && revClosed < 99.9, true);
}

/* ── 4. 시나리오가 본문과 같은 설정을 밟나 ───────────────── */
{
    const want = [
        { C: 10, S: 10, T: 300, D: 0, mode: 'closed' },
        { C: 10, S: 10, T: 300, D: 30, mode: 'closed' },
        { C: 10, S: 10, T: 300, D: 30, mode: 'open' },
        { C: 10, S: 10, T: 300, D: 30, mode: 'fixed' },
        { C: 50, S: 10, T: 300, D: 30, mode: 'closed' },
        { C: 10, S: 10, T: 60, D: 30, mode: 'closed' },
        { C: 10, S: 10, T: 300, D: 3, mode: 'open' }
    ];
    ok('시나리오 단계 수', LAB.scene.length, want.length);
    want.forEach((w, i) => ok(`시나리오 ${i + 1} 설정`, JSON.stringify(LAB.scene[i]), JSON.stringify(w)));
}

/* ── 5. 렌더된 문자열이 실제로 그 수치를 담고 있나 ────────── */
{
    LAB.set({ C: 10, S: 10, T: 300, D: 30, mode: 'closed' });
    const meters = r.doc.cache.get('#meters').innerHTML;
    ok('미터에 왜곡 배수 2701 이 있다', meters.includes('2701'), true);
    ok('미터에 놓친 표본 29,990 이 있다', meters.includes('29,990'), true);
    ok('판정이 최대값을 짚는다', r.doc.cache.get('#verdict').innerHTML.includes('30.01'), true);
    const tape = r.doc.cache.get('#tape').innerHTML;
    ok('폐루프 줄에 표본 없는 구간이 그려진다', tape.includes('class="void"'), true);

    LAB.set({ mode: 'open' });
    ok('개루프 줄은 정지 구간이 채워진다', r.doc.cache.get('#tape').innerHTML.includes('live hot'), true);

    LAB.set({ D: 0, mode: 'closed' });
    ok('정지 0 이면 빈 구간이 없다', r.doc.cache.get('#tape').innerHTML.includes('class="void"'), false);

    LAB.set({ C: 10, S: 10, T: 300, D: 0, mode: 'closed' });   /* 첫 화면으로 되돌린다 */
}

console.log(fail.length ? '' : `단언 ${pass}건 — 전부 통과`);
for (const f of fail) console.error('실패  ' + f);
if (fail.length) console.error(`\n통과 ${pass}건 · 실패 ${fail.length}건`);
process.exit(fail.length ? 1 : 0);
