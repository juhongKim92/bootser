/* ============================================================
   31편 검증 — 실행: node tools/verify-quorum.mjs
   ------------------------------------------------------------
   이 편의 검산점은 **문서가 인쇄한 조합표**다. 26편이 RFC 6928 의 왕복 수 표로
   검산한 것과 같은 구조다.

     ① QUORUM = floor(N/2) + 1        (*"A majority (n/2 + 1) of the replicas"*)
     ② W + R > N 이면 겹침이 보장된다   (*"guaranteed to participate in both"*)
        → 조합론이 그 칸에서 **정확히 확률 1** 을 내야 한다. 그리고 그 역도 —
          부등식이 성립하지 않는 칸에서는 반드시 1 미만이어야 한다

   ②가 이 스크립트의 핵심이다. 문서가 "보장" 이라고 말하는 칸과 내 조합론이 100% 를
   내는 칸이 **완전히 일치**해야 나머지 칸의 확률을 믿을 수 있다.

   한 번 탈락시켰던 주제라(PBS 는 몬테카를로여서 재현 불가) PBS 수치는 인용만 하고
   여기서 검증하지 않는다.
   ============================================================ */
import { boot } from './lab-harness.mjs';

const r = boot('quorum');
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

const at = o => LAB.m(Object.assign({ N: 3, W: 2, R: 2, dead: 0 }, o));
const pc = v => (v * 100).toFixed(1);

/* ── 1. 검산점 ───────────────────────────────────────────── */

/* ① QUORUM = floor(N/2)+1 — 문서의 공식 */
for (const [n, q] of [[1, 1], [2, 2], [3, 2], [4, 3], [5, 3], [6, 4], [7, 4]])
    ok(`QUORUM(N=${n})`, LAB.quorumOf(n), q);

/* ② 부등식과 확률 1 이 정확히 일치하나 — N=1..9 · 모든 W·R 전수 */
{
    let checked = 0, guaranteed = 0;
    for (let N = 1; N <= 9; N++) for (let W = 1; W <= N; W++) for (let R = 1; R <= N; R++) {
        const p = LAB.overlapProb(N, R, W);
        const ineq = W + R > N;
        if (ineq && Math.abs(p - 1) > 1e-12)
            fail.push(`검산② N=${N} W=${W} R=${R} — 부등식이 성립하는데 확률이 ${p}`);
        else if (!ineq && p >= 1 - 1e-12)
            fail.push(`검산② N=${N} W=${W} R=${R} — 부등식이 안 되는데 확률이 1 이다`);
        else { checked++; if (ineq) guaranteed++; }
    }
    ok(`검산② 전수 ${checked}조합에서 일치`, checked, 285);   /* Σ N² (N=1..9) */
    ok('검산② 그중 보장되는 조합', guaranteed > 0, true);
}

/* ③ 조합 함수가 맞나 (파스칼 항등식으로 교차 검증) */
{
    let checked = 0;
    for (let n = 1; n <= 12; n++) for (let k = 1; k < n; k++) {
        if (LAB.comb(n, k) !== LAB.comb(n - 1, k - 1) + LAB.comb(n - 1, k))
            fail.push(`검산③ C(${n},${k}) 가 파스칼 항등식과 안 맞는다`);
        else checked++;
    }
    ok(`검산③ 전수 ${checked}조합`, checked > 50, true);
    ok('C(3,2)', LAB.comb(3, 2), 3);
    ok('C(5,3)', LAB.comb(5, 3), 10);
}

/* ── 2. 본문이 인용한 수치 ─────────────────────────────── */

/* N=3 조합표 — 문서가 주는 칸과 나머지 칸 */
ok('N=3 ONE/ONE 33.3%', pc(LAB.overlapProb(3, 1, 1)), '33.3');
ok('N=3 ONE/QUORUM 66.7%', pc(LAB.overlapProb(3, 2, 1)), '66.7');
ok('N=3 QUORUM/ONE 66.7%', pc(LAB.overlapProb(3, 1, 2)), '66.7');
ok('N=3 QUORUM/QUORUM 100%', pc(LAB.overlapProb(3, 2, 2)), '100.0');
ok('N=5 ONE/ONE 20.0%', pc(LAB.overlapProb(5, 1, 1)), '20.0');

/* 레시피 1 — N=3 R=W=2 */
{
    const m = at({});
    ok('R=W=2 보장', m.guaranteed, true);
    ok('R=W=2 견디는 고장 1대', m.tol, 1);
    ok('R=W=2 QUORUM 값 2', m.quorum, 2);
    ok('R=W=2 보장하며 최대 1대', m.bestTol, 1);
}

/* 레시피 2 — R=W=1 */
{
    const m = at({ W: 1, R: 1 });
    ok('R=W=1 보장 없음', m.guaranteed, false);
    ok('R=W=1 확률 33.3%', pc(m.p), '33.3');
    ok('R=W=1 견디는 고장 2대', m.tol, 2);
}

/* 레시피 3·4 — 노드를 죽인다 */
{
    ok('1대 죽어도 쓰기 성공', at({ dead: 1 }).writeOk, true);
    ok('1대 죽어도 읽기 성공', at({ dead: 1 }).readOk, true);
    ok('2대 죽으면 쓰기 실패', at({ dead: 2 }).writeOk, false);
    ok('2대 죽으면 읽기 실패', at({ dead: 2 }).readOk, false);
    ok('2대 죽어도 부등식은 그대로', at({ dead: 2 }).guaranteed, true);
}

/* 레시피 5 — 등급을 낮추면 살아난다 */
{
    const m = at({ W: 1, R: 1, dead: 2 });
    ok('등급을 낮추면 쓰기 성공', m.writeOk, true);
    ok('등급을 낮추면 읽기 성공', m.readOk, true);
    ok('그 대가로 보장이 사라진다', m.guaranteed, false);
    ok('그때 확률 33.3%', pc(m.p), '33.3');
}

/* 레시피 6 — 같은 보장 안에서 내구성이 0 인 조합 */
{
    const m = at({ W: 3, R: 1 });
    ok('R=1 W=3 도 보장', m.guaranteed, true);
    ok('R=1 W=3 견디는 고장 0대', m.tol, 0);
    ok('R=1 W=3 쓰기 내구 0', m.tolW, 0);
    ok('R=1 W=3 읽기 내구 2', m.tolR, 2);
    ok('본문 — 같은 보장 안에 1대와 0대가 섞여 있다',
        at({}).tol !== m.tol && at({}).guaranteed && m.guaranteed, true);
}

/* 레시피 7 — N=5 */
{
    const m = at({ N: 5, W: 3, R: 3, dead: 2 });
    ok('N=5 QUORUM 3', m.quorum, 3);
    ok('N=5 R=W=3 보장', m.guaranteed, true);
    ok('N=5 2대 죽어도 쓰기 성공', m.writeOk, true);
    ok('N=5 견디는 고장 2대', m.tol, 2);
}

/* 본문 표 — 보장하면서 견디는 최대 = floor((N−1)/2) */
for (const [n, t] of [[3, 1], [5, 2], [7, 3]]) ok(`N=${n} 보장하며 최대 ${t}대`, at({ N: n }).bestTol, t);

/* ── 3. 불변식 ──────────────────────────────────────────── */

/* ④ 견디는 고장 = min(N−W, N−R) */
{
    let checked = 0;
    for (let N = 1; N <= 7; N++) for (let W = 1; W <= N; W++) for (let R = 1; R <= N; R++) {
        const m = at({ N, W, R });
        if (m.tol !== Math.min(N - W, N - R)) fail.push(`불변식④ N=${N} W=${W} R=${R}`);
        else checked++;
    }
    ok(`불변식④ 전수 ${checked}조합`, checked, 140);
}

/* ⑤ 부등식을 지키면서 견딜 수 있는 최대는 floor((N−1)/2) 이고,
      QUORUM/QUORUM 이 그 최대를 **달성한다**.
      (처음엔 "최적 조합은 QUORUM/QUORUM 뿐" 으로 썼다가 이 검증에 잡혔다 —
       짝수 N 에서는 같은 내구성을 내는 조합이 여럿이라 argmax 가 유일하지 않다.
       예: N=4 에서 W=3·R=3 과 W=2·R=3 이 둘 다 1대를 견딘다.) */
{
    let checked = 0, ties = 0;
    for (let N = 1; N <= 9; N++) {
        let best = -1;
        const argmax = [];
        for (let W = 1; W <= N; W++) for (let R = 1; R <= N; R++) {
            if (W + R <= N) continue;
            const t = Math.min(N - W, N - R);
            if (t > best) { best = t; argmax.length = 0; argmax.push([W, R]); }
            else if (t === best) argmax.push([W, R]);
        }
        const q = LAB.quorumOf(N);
        if (best !== Math.floor((N - 1) / 2)) fail.push(`불변식⑤ N=${N} 최대가 ${best}`);
        else if (Math.min(N - q, N - q) !== best)
            fail.push(`불변식⑤ N=${N} QUORUM/QUORUM 이 최대를 못 낸다`);
        else { checked++; if (argmax.length > 1) ties++; }
    }
    ok(`불변식⑤ 전수 ${checked}개 N`, checked, 9);
    ok('불변식⑤ 짝수 N 에서는 최적 조합이 여럿이다', ties >= 4, true);
}

/* ⑥ W 나 R 을 키우면 확률이 줄지 않는다 (단조) */
{
    let checked = 0;
    for (let N = 2; N <= 9; N++) for (let R = 1; R <= N; R++) {
        let prev = -1, mono = true;
        for (let W = 1; W <= N; W++) {
            const p = LAB.overlapProb(N, R, W);
            if (p < prev - 1e-12) mono = false;
            prev = p;
        }
        if (!mono) fail.push(`불변식⑥ N=${N} R=${R} 에서 W 단조가 깨졌다`);
        else checked++;
    }
    ok(`불변식⑥ 전수 ${checked}조합`, checked > 40, true);
}

/* ⑦ 복제본을 늘리면 ONE/ONE 의 확률은 나빠진다 */
{
    let mono = true, prev = 2;
    for (let N = 1; N <= 9; N++) {
        const p = LAB.overlapProb(N, 1, 1);
        if (p > prev + 1e-12) mono = false;
        prev = p;
    }
    ok('불변식⑦ N 이 커지면 ONE/ONE 확률이 줄어든다', mono, true);
    ok('불변식⑦ N=1 이면 항상 겹친다', LAB.overlapProb(1, 1, 1), 1);
}

/* ⑧ 살아있는 노드가 W 보다 적으면 쓰기가 실패한다 */
{
    let checked = 0;
    for (let N = 1; N <= 7; N++) for (let W = 1; W <= N; W++) for (let d = 0; d <= N; d++) {
        const m = at({ N, W, R: 1, dead: d });
        if (m.writeOk !== (W <= N - d)) fail.push(`불변식⑧ N=${N} W=${W} dead=${d}`);
        else checked++;
    }
    ok(`불변식⑧ 전수 ${checked}조합`, checked > 100, true);
}

/* ── 4. 시나리오 ─────────────────────────────────────────── */
{
    const want = [
        { N: 3, W: 2, R: 2, dead: 0 },
        { N: 3, W: 1, R: 1, dead: 0 },
        { N: 3, W: 2, R: 2, dead: 1 },
        { N: 3, W: 2, R: 2, dead: 2 },
        { N: 3, W: 1, R: 1, dead: 2 },
        { N: 3, W: 3, R: 1, dead: 0 },
        { N: 5, W: 3, R: 3, dead: 2 }
    ];
    ok('시나리오 단계 수', LAB.scene.length, want.length);
    want.forEach((w, i) => ok(`시나리오 ${i + 1} 설정`, JSON.stringify(LAB.scene[i]), JSON.stringify(w)));
    /* 시나리오가 네 가지 상태를 다 밟나 */
    ok('시나리오에 보장 상태가 있다', LAB.scene.some(s => at(s).guaranteed && at(s).writeOk), true);
    ok('시나리오에 보장 없는 상태가 있다', LAB.scene.some(s => !at(s).guaranteed), true);
    ok('시나리오에 연산 실패 상태가 있다', LAB.scene.some(s => !at(s).writeOk), true);
    ok('시나리오에 내구성 0 인 보장이 있다', LAB.scene.some(s => at(s).guaranteed && at(s).tol === 0 && at(s).writeOk), true);
}

/* ── 5. 렌더된 문자열 ────────────────────────────────────── */
{
    LAB.set({ N: 3, W: 2, R: 2, dead: 0 });
    const grid = r.doc.cache.get('#grid2').innerHTML;
    ok('조합표에 33.3% 가 있다', grid.includes('33.3%'), true);
    ok('조합표에 66.7% 가 있다', grid.includes('66.7%'), true);
    ok('조합표에 보장 칸이 있다', grid.includes('safe'), true);
    ok('격자에 겹친 칸이 표시된다', r.doc.cache.get('#nodes').innerHTML.includes('nd both'), true);
    ok('미터에 QUORUM 값이 있다', r.doc.cache.get('#meters').innerHTML.includes('2'), true);

    LAB.set({ W: 1, R: 1 });
    ok('보장이 없으면 겹친 칸이 없다', r.doc.cache.get('#nodes').innerHTML.includes('nd both'), false);
    ok('판정이 확률을 짚는다', r.doc.cache.get('#verdict').innerHTML.includes('33.3'), true);

    LAB.set({ W: 2, R: 2, dead: 2 });
    ok('죽은 칸이 표시된다', r.doc.cache.get('#nodes').innerHTML.includes('nd dead'), true);

    LAB.set({ N: 3, W: 2, R: 2, dead: 0 });   /* 첫 화면으로 */
}

console.log(fail.length ? '' : `단언 ${pass}건 — 전부 통과`);
for (const f of fail) console.error('실패  ' + f);
if (fail.length) console.error(`\n통과 ${pass}건 · 실패 ${fail.length}건`);
process.exit(fail.length ? 1 : 0);
