/* ============================================================
   20편(`/rebalance/`) 본문 인용 수치 대조 — 실행: node tools/verify-rebalance.mjs
   ------------------------------------------------------------
   배포되는 `shared/rebalance-lab.js` 를 그대로 구동해 대조한다.
   전부 해석식이라 난수가 없다 — 표시 자리수까지 정확히 일치해야 한다.
   ============================================================ */
import { boot } from './lab-harness.mjs';

const { lab, errors } = boot('rebalance');
if (errors.length) { console.error('구동 오류:', errors.join(' / ')); process.exit(1); }
if (!lab) { console.error('window.LAB 훅이 없다'); process.exit(1); }

let fail = 0, pass = 0;
const eq = (label, got, want) => {
    const ok = typeof want === 'number' ? Math.abs(got - want) < 5e-3 : got === want;
    if (ok) pass++; else { fail++; console.error(`  실패 ${label}: 실측 ${got} · 기대 ${want}`); }
};
const r2 = x => Math.round(x * 100) / 100;
const D = { recs: 500, t: 700, interval: 300000, N: 3, D: 5000, churn: 0, coop: false, commitEvery: 0 };
const R = cfg => {
    const x = lab.set({ ...D, ...cfg }).exact();
    return {
        B: x.B, evicted: x.evicted, done: x.done, ratio: r2(x.commitRatio * 100),
        tput: r2(x.committed), waste: r2(x.wasted), rebal: r2(x.rebal), busy: r2(x.busy * 100)
    };
};

console.log('20편 인용 수치 대조\n');

{   console.log('레시피 1 — 500건 × 700ms · interval 5분 · 컨슈머 3');
    const x = R({});
    eq('배치 처리시간 (ms)', x.B, 350000); eq('쫓겨나나', x.evicted, true);
    eq('마감 전 처리 건수', x.done, 428); eq('커밋 비율', x.ratio, 0);
    eq('유효 처리량', x.tput, 0); eq('낭비', x.waste, 4.21);
    eq('컨슈머 바쁨', x.busy, 98.36);
    eq('리밸런싱/분', x.rebal, 0.2);
}
{   console.log('레시피 2 — 컨슈머 12대');
    const x = R({ N: 12 });
    eq('유효 처리량 그대로', x.tput, 0); eq('낭비', x.waste, 16.84);
}
{   console.log('레시피 3 — max.poll.interval 1시간');
    const x = R({ interval: 3600000 });
    eq('쫓겨나지 않는다', x.evicted, false); eq('유효 처리량', x.tput, 4.29);
}
{   console.log('레시피 4 — max.poll.records 100 (interval 은 5분)');
    const x = R({ recs: 100 });
    eq('배치 처리시간 (ms)', x.B, 70000); eq('쫓겨나지 않는다', x.evicted, false);
    eq('유효 처리량', x.tput, 4.29);
    eq('3번과 같은 처리량', x.tput, R({ interval: 3600000 }).tput);
}
{   console.log('레시피 5 — 부등식 위반 + 10건마다 커밋');
    const x = R({ commitEvery: 10 });
    eq('커밋 비율', x.ratio, 98.13); eq('유효 처리량', x.tput, 4.13);
    eq('리밸런싱은 그대로', x.rebal, R({}).rebal);
    eq('여전히 쫓겨난다', x.evicted, true);
}
{   console.log('레시피 6 — 부등식 준수 · 멤버 변동 6회/분 · eager');
    const x = R({ recs: 100, churn: 6 });
    eq('유효 처리량', x.tput, 2.14); eq('컨슈머 바쁨', x.busy, 50);
}
{   console.log('레시피 7 — cooperative-sticky');
    const a = R({ recs: 100, churn: 6, coop: false }), b = R({ recs: 100, churn: 6, coop: true });
    eq('유효 처리량', b.tput, 3.57);
    eq('회복률 66.7%', Math.round((b.tput / a.tput - 1) * 1000) / 10, 66.8);
    /* 부등식을 넘으면 coop 도 eager 와 같이 0 이다 */
    eq('부등식 위반 시 eager', R({ coop: false }).tput, 0);
    eq('부등식 위반 시 coop', R({ coop: true }).tput, 0);
}
{   console.log('본문 — 부등식이 뒤집히는 지점 (500건 · interval 5분)');
    /* 300000 / 500 = 600ms 가 경계다 */
    eq('600ms — 아직 안 넘는다', R({ t: 600 }).evicted, false);
    eq('610ms — 넘는다', R({ t: 610 }).evicted, true);
    eq('경계 산수', 300000 / 500, 600);
}
{   console.log('본문 — 부하와 무관하다 (컨슈머 1대여도 쫓겨난다)');
    eq('컨슈머 1대', R({ N: 1 }).evicted, true);
    eq('컨슈머 1대 처리량', R({ N: 1 }).tput, 0);
    eq('컨슈머 1대 낭비', R({ N: 1 }).waste, 1.4);
}
{   console.log('시나리오 — 7단계');
    const T = lab.tables;
    const want = [
        { tput: 0, ratio: 0, waste: 4.21 }, { tput: 0, ratio: 0, waste: 16.84 },
        { tput: 4.29, ratio: 100, waste: 0 }, { tput: 4.29, ratio: 100, waste: 0 },
        { tput: 4.13, ratio: 98.13, waste: 0.08 },
        { tput: 2.14, ratio: 100, waste: 0 }, { tput: 3.57, ratio: 100, waste: 0 }
    ];
    eq('단계 수', lab.scene.length, want.length);
    lab.scene.forEach((s, i) => {
        const x = R({
            recs: T.RECS[s.ki], t: s.t, interval: T.IVAL[s.ii], N: s.N, D: s.D,
            churn: s.churn, coop: s.coop, commitEvery: T.CMIT[s.mi]
        });
        for (const k of ['tput', 'ratio', 'waste']) eq(`${i + 1}단계 ${k}`, x[k], want[i][k]);
    });
}

console.log('');
console.log(fail ? `실패 ${fail}건 · 통과 ${pass}건` : `전부 일치 — 단언 ${pass}건`);
process.exit(fail ? 1 : 0);
