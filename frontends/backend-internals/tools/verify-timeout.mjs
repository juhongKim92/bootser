/* ============================================================
   17편(`/timeout/`) 본문 인용 수치 대조 — 실행: node tools/verify-timeout.mjs
   ------------------------------------------------------------
   배포되는 `shared/timeout-lab.js` 를 그대로 구동해 페이지가 인용한 값과 맞춰본다.
   실험대의 미터는 표본이 아니라 모든 경로의 확률 가중 열거라, 여기 적힌 기대값은
   허용오차 없이 정확히 일치해야 한다. 어긋나면 본문을 고치거나 모델을 고쳐야 한다.

   페이지별 검증의 첫 예다. 새 실험대에 `window.LAB = { set, exact, trace, scene }`
   훅을 넣어두면 같은 방식으로 verify-<slug>.mjs 를 붙일 수 있다.
   ============================================================ */
import { boot } from './lab-harness.mjs';

const { lab, doc, i18n, errors } = boot('timeout');
if (errors.length) { console.error('구동 오류:', errors.join(' / ')); process.exit(1); }
if (!lab) { console.error('window.LAB 훅이 없다'); process.exit(1); }

const D = { tA: 1000, tB: 1000, tC: 1000, r: 3, p: .10, mode: 'persist', prop: false };
let fail = 0, pass = 0;

function eq(label, got, want) {
    const ok = typeof want === 'number' ? Math.abs(got - want) < 1e-9 : got === want;
    if (ok) { pass++; } else { fail++; console.error(`  실패 ${label}: 실측 ${got} · 기대 ${want}`); }
}
const R = cfg => { const x = lab.set({ ...D, ...cfg }).exact(); return {
    succ: +(x.succ * 100).toFixed(1), calls: +x.calls.toFixed(2), after: +x.afterDL.toFixed(2),
    over: +x.overCommit.toFixed(2), orphan: +x.orphans.toFixed(3), at: Math.round(x.clientAt) }; };
const T = cfg => lab.set({ ...D, ...cfg }).trace();
const conc = tr => {                                   // 동시에 도는 C 호출 최대
    const last = Math.max(...tr.cCalls.map(c => c.cDone), 0);
    let m = 0;
    for (let t = 0; t <= last; t += 5) {
        const n = tr.cCalls.filter(c => c.cStart <= t && t < c.cDone).length;
        if (n > m) m = n;
    }
    return m;
};

console.log('17편 인용 수치 대조\n');

{   console.log('레시피 1 — 전부 1초 · 시도 1회');
    const x = R({ r: 1 });
    eq('성공률', x.succ, 90.0); eq('C호출', x.calls, 1.00);
    eq('기한 뒤 시작', x.after, 0.00); eq('지킬 수 없는 약속', x.over, 1.00);
    /* 발동 시각 1000 / 1025 / 1050ms */
    eq('A→B 발동', 25 + 1000, 1025); eq('B→C 발동', 50 + 1000, 1050);
}
{   console.log('레시피 2 — 시도 3회');
    const x = R({ r: 3 }), tr = T({ r: 3 });
    eq('성공률(안 움직임)', x.succ, 90.0); eq('C호출', x.calls, 1.80);
    eq('기한 뒤 시작', x.after, 0.80);
    eq('느린 요청 C호출', tr.cCalls.length, 9); eq('그중 기한 뒤', tr.afterDL, 8);
    eq('동시 최대', conc(tr), 5);
    eq('마지막 작업 종료', Math.max(...tr.cCalls.map(c => c.cDone)), 5275);
    eq('A·B 실패 확정', tr.clientAt, 3050);
}
{   console.log('레시피 3 — 전부 3초 · 시도 1회');
    const x = R({ tA: 3000, tB: 3000, tC: 3000, r: 1 });
    eq('성공률', x.succ, 100.0); eq('C호출', x.calls, 1.00); eq('평균 응답', x.at, 329);
}
{   console.log('레시피 4 — 3초를 1초씩 3회 (지속적)');
    const x = R({ tA: 3000, tB: 3000, tC: 1000, r: 3 });
    eq('성공률', x.succ, 90.0); eq('C호출', x.calls, 1.80); eq('평균 응답', x.at, 1099);
}
{   console.log('레시피 5 — 같은 설정 · 일시적');
    const x = R({ tA: 3000, tB: 3000, tC: 1000, r: 3, mode: 'transient' });
    eq('성공률', x.succ, 99.9); eq('C호출', x.calls, 1.11);
}
{   console.log('레시피 6 — 계단식 1000 / 900 / 300');
    const x = R({ tB: 900, tC: 300, r: 3 });
    eq('성공률(그대로)', x.succ, 90.0); eq('지킬 수 없는 약속', x.over, 0.30);
    eq('기한 뒤 시작(A 재시도)', x.after, 0.50);
    eq('A→B 발동', 25 + 900, 925); eq('B→C 발동', 50 + 300, 350);
}
{   console.log('레시피 7 — 전파 켬');
    const x = R({ prop: true }), tr = T({ prop: true });
    eq('성공률(그대로)', x.succ, 90.0); eq('C호출', x.calls, 1.00);
    eq('기한 뒤 시작', x.after, 0.00); eq('지킬 수 없는 약속', x.over, 0.00);
    eq('평균 응답', x.at, 294);
    eq('C 가 받은 예산', tr.cCalls[0].cb, 900);
    eq('실패 확정 시각', tr.clientAt, 1000);
    /* 발동 시각 표가 설정값이 아니라 실제로 받은 예산을 보여야 한다 */
    const tbl = doc.querySelector('#fireTbl').innerHTML;
    eq('표에 A→B 950ms', tbl.includes('950ms'), true);
    eq('표에 B→C 900ms', tbl.includes('900ms'), true);
    eq('표에 전파 표식', tbl.includes(i18n.fvProp), true);
}
{   console.log('본문 — C 가 쓸 수 있는 실제 시간');
    eq('850ms', 1000 - 25 * 6, 850);
}
{   console.log('본문 — 꼬리 절벽 (tA=tB=3000 · 시도 1회)');
    eq('tC 1249ms', R({ tA: 3000, tB: 3000, tC: 1249, r: 1 }).succ, 90.0);
    eq('tC 1250ms', R({ tA: 3000, tB: 3000, tC: 1250, r: 1 }).succ, 100.0);
}
{   console.log('본문 — 예산 바닥 1.35초 (세 값 모두 · 시도 1회)');
    eq('1.3초', R({ tA: 1300, tB: 1300, tC: 1300, r: 1 }).succ, 90.0);
    eq('1.4초', R({ tA: 1400, tB: 1400, tC: 1400, r: 1 }).succ, 100.0);
    eq('바닥 = 꼬리 1200 + 홉6 150', 1200 + 150, 1350);
}
{   console.log('본문 — 재시도가 발동할 조건 tC ≤ (1000−150)/3');
    eq('283ms', Math.floor((1000 - 150) / 3), 283);
}
{   console.log('본문 — 750개 조합 전수: 전파가 성공률을 바꾸나');
    let up = 0, down = 0, same = 0, cOff = 0, cOn = 0, aOff = 0, aOn = 0, oOff = 0, oOn = 0, n = 0;
    for (const tA of [500, 1000, 1500, 2000, 3000]) for (const tB of [300, 700, 1000, 2000, 3000])
        for (const tC of [200, 500, 1000, 1500, 3000]) for (const r of [1, 2, 3]) for (const mode of ['persist', 'transient']) {
            const a = lab.set({ tA, tB, tC, r, p: .10, mode, prop: false }).exact();
            const b = lab.set({ tA, tB, tC, r, p: .10, mode, prop: true }).exact();
            if (b.succ > a.succ + 1e-9) up++; else if (b.succ < a.succ - 1e-9) down++; else same++;
            cOff += a.calls; cOn += b.calls; aOff += a.afterDL; aOn += b.afterDL;
            oOff += a.orphans; oOn += b.orphans; n++;
        }
    eq('조합 수', n, 750);
    eq('전파가 성공률을 올린 조합', up, 0);
    eq('전파가 성공률을 낮춘 조합', down, 0);
    eq('같은 조합', same, 750);
    eq('평균 C호출 (끔)', +(cOff / n).toFixed(2), 1.16);
    eq('평균 C호출 (켬)', +(cOn / n).toFixed(2), 1.08);
    eq('기한 뒤 시작 (끔)', +(aOff / n).toFixed(2), 0.06);
    eq('기한 뒤 시작 (켬)', +(aOn / n).toFixed(2), 0.00);
    eq('고아 응답 (끔)', +(oOff / n).toFixed(3), 0.044);
    eq('고아 응답 (켬)', +(oOn / n).toFixed(3), 0.000);
}
{   console.log('판정 — 설정마다 맞는 문안을 고르나');
    const stem = s => s.replace(/<[^>]*>/g, '').split('$')[0].slice(0, 10);
    const kind = () => {
        const h = doc.querySelector('#verdict').innerHTML.replace(/<[^>]*>/g, '');
        if (h.startsWith(stem(i18n.vInverted))) return 'inverted';
        if (h.startsWith(stem(i18n.vAfter))) return 'after';
        if (h.startsWith(stem(i18n.vClean))) return 'clean';
        return 'unknown:' + h.slice(0, 30);
    };
    for (const [label, cfg, want] of [
        ['전부 1초 r3', { r: 3 }, 'inverted'],
        ['전부 1초 r1', { r: 1 }, 'inverted'],
        ['tB 만 큼', { tB: 2000, tC: 200, r: 1 }, 'inverted'],
        ['tC 만 큼', { tB: 200, tC: 2000, r: 1 }, 'inverted'],
        ['계단식 r3', { tB: 900, tC: 300, r: 3 }, 'after'],
        ['계단식 r1', { tB: 900, tC: 300, r: 1 }, 'clean'],
        ['전파 기본', { prop: true }, 'clean'],
        ['전파 계단식', { tB: 900, tC: 300, prop: true }, 'clean']
    ]) { lab.set({ ...D, ...cfg }); eq(label, kind(), want); }
}
{   console.log('시나리오 — 7단계가 문안이 말하는 수치를 내나');
    const want = [
        { succ: 90.0, calls: 1.00, after: 0.00, over: 1.00, at: 299 },
        { succ: 90.0, calls: 1.80, after: 0.80, over: 1.80, at: 499 },
        { succ: 100.0, calls: 1.00, after: 0.00, over: 1.00, at: 329 },
        { succ: 90.0, calls: 1.80, after: 0.60, over: 0.30, at: 1099 },
        { succ: 99.9, calls: 1.11, after: 0.00, over: 0.01, at: 326 },
        { succ: 90.0, calls: 1.80, after: 0.50, over: 0.30, at: 469 },
        { succ: 90.0, calls: 1.00, after: 0.00, over: 0.00, at: 294 }
    ];
    eq('단계 수', lab.scene.length, want.length);
    lab.scene.forEach((s, i) => {
        const x = R(s);
        for (const k of ['succ', 'calls', 'after', 'over', 'at']) eq(`${i + 1}단계 ${k}`, x[k], want[i][k]);
    });
}

console.log('');
console.log(fail ? `실패 ${fail}건 · 통과 ${pass}건` : `전부 일치 — 단언 ${pass}건`);
process.exit(fail ? 1 : 0);
