/* ============================================================
   22편(`/aggregate/`) 본문 인용 수치 대조 — 실행: node tools/verify-aggregate.mjs
   ------------------------------------------------------------
   1차 출처 확인은 착수 전에 했다 (PostgreSQL 문서 — trunc 는 버림,
   round 의 tie 처리가 numeric 은 away-from-zero · double 은 대개 round-half-to-even
   이고 플랫폼 의존, real 6자리 · double precision 15자리).
   여기서는 **모델과 본문이 일치하는가**만 본다.
   ============================================================ */
import { boot } from './lab-harness.mjs';

const { lab, errors } = boot('aggregate');
if (errors.length) { console.error('구동 오류:', errors.join(' / ')); process.exit(1); }
if (!lab) { console.error('window.LAB 훅이 없다'); process.exit(1); }

let fail = 0, pass = 0;
const eq = (label, got, want) => {
    const ok = typeof want === 'number' ? Math.abs(got - want) < 5e-5 : got === want;
    if (ok) pass++; else { fail++; console.error(`  실패 ${label}: 실측 ${JSON.stringify(got)} · 기대 ${JSON.stringify(want)}`); }
};
const r4 = x => Math.round(x * 1e4) / 1e4;
const D = { skew: 0, prec: null, rmode: 'trunc', tz: 'utc', edge: 0 };
const R = cfg => {
    const x = lab.set({ ...D, ...cfg }).exact();
    return { a: r4(x.a), b: r4(x.b), gap: r4(x.gap), agree: x.agree, n: x.n.join('/'), stored: x.stored.map(v => r4(v)).join(','), moved: x.moved };
};

console.log('22편 인용 수치 대조\n');

{   console.log('레시피 1 — 균등 · 원값');
    const x = R({});
    eq('경로 A', x.a, 60.4167); eq('경로 B', x.b, 60.4167);
    eq('차이', x.gap, 0); eq('일치 자리수', x.agree, 6);
    eq('행 수', x.n, '100/100/100');
}
{   console.log('레시피 2 — 편중 60%');
    const x = R({ skew: 60 });
    eq('행 수', x.n, '220/40/40');
    eq('경로 A', x.a, 48.3167);
    eq('경로 B 는 안 움직인다', x.b, 60.4167);
    eq('차이', x.gap, 12.1);
    /* 편중은 선형으로 벌어진다 */
    eq('편중 30%', R({ skew: 30 }).gap, 6.05);
    eq('편중 90%', R({ skew: 90 }).gap, 18.15);
}
{   console.log('레시피 3 — 저장 1자리 · trunc');
    const x = R({ prec: 1 });
    eq('저장값', x.stored, '40.2,60.7,80.2');
    eq('경로 B', x.b, 60.3667); eq('경로 A 는 그대로', x.a, 60.4167);
    eq('차이', x.gap, 0.05); eq('일치 자리수', x.agree, 1);
}
{   console.log('레시피 4 — round · numeric (tie away from zero)');
    const x = R({ prec: 1, rmode: 'numeric' });
    eq('저장값', x.stored, '40.3,60.8,80.3');
    eq('경로 B', x.b, 60.4667); eq('차이', x.gap, 0.05);
}
{   console.log('레시피 5 — round · double (tie to even)');
    const x = R({ prec: 1, rmode: 'double' });
    eq('저장값', x.stored, '40.2,60.8,80.2');
    eq('경로 B', x.b, 60.4);
    eq('차이', x.gap, 0.0167);
    /* 40.25 는 짝수로, 60.75 는 8 로, 80.25 는 짝수로 */
    eq('40.25 → 40.2', r4(lab.quantize(40.25, 1, 'double')), 40.2);
    eq('60.75 → 60.8', r4(lab.quantize(60.75, 1, 'double')), 60.8);
    eq('80.25 → 80.2', r4(lab.quantize(80.25, 1, 'double')), 80.2);
    eq('numeric 은 40.3', r4(lab.quantize(40.25, 1, 'numeric')), 40.3);
    eq('trunc 는 40.2', r4(lab.quantize(40.25, 1, 'trunc')), 40.2);
}
{   console.log('레시피 6 — 로컬 그룹핑 · 경계 행 40');
    const x = R({ tz: 'local', edge: 40 });
    eq('행 수', x.n, '60/140/100'); eq('넘어간 행', x.moved, 40);
    eq('경로 A 는 경계와 무관', x.a, 60.4167);
    eq('경로 B', x.b, 58.4643); eq('차이', x.gap, 1.9524);
    eq('2일차 평균', r4(lab.exact().dayAvg[1]), 54.8929);
}
{   console.log('레시피 7 — 셋을 다 겹친다');
    const x = R({ skew: 60, prec: 1, rmode: 'double', tz: 'local', edge: 40 });
    eq('경로 A', x.a, 48.3167); eq('경로 B', x.b, 56.9667);
    eq('차이', x.gap, 8.65); eq('일치 자리수', x.agree, 0);
}
{   console.log('본문 — 경로 A 는 날짜 경계에 전혀 영향받지 않는다 (전수)');
    let moves = 0, n = 0;
    const base = R({ tz: 'utc', edge: 0 }).a;
    for (const skew of [0, 30, 60, 90]) {
        const b0 = R({ skew, tz: 'utc', edge: 0 }).a;
        for (const edge of [0, 5, 10, 20, 40]) {
            const x = R({ skew, tz: 'local', edge });
            n++;
            if (Math.abs(x.a - b0) > 1e-9) moves++;
        }
    }
    eq('조합 수', n, 20);
    eq('경로 A 가 움직인 조합', moves, 0);
    eq('기준값', base, 60.4167);
}
{   console.log('본문 — 경로 B 는 표본 편중에 전혀 영향받지 않는다 (전수)');
    let moves = 0;
    for (const prec of [null, 1, 0]) for (const rmode of ['trunc', 'numeric', 'double']) {
        const b0 = R({ skew: 0, prec, rmode }).b;
        for (const skew of [30, 60, 90]) {
            if (Math.abs(R({ skew, prec, rmode }).b - b0) > 1e-9) moves++;
        }
    }
    eq('경로 B 가 움직인 조합', moves, 0);
}
{   console.log('본문 — 반올림 세 방식이 같은 자리수에서 세 값을 낸다');
    const bs = ['trunc', 'numeric', 'double'].map(rmode => R({ prec: 1, rmode }).b);
    eq('세 값', bs.join(' '), '60.3667 60.4667 60.4');
    eq('전부 다르다', new Set(bs).size, 3);
}
{   console.log('시나리오 — 7단계');
    const want = [
        { a: 60.4167, b: 60.4167, gap: 0 }, { a: 48.3167, b: 60.4167, gap: 12.1 },
        { a: 60.4167, b: 60.3667, gap: 0.05 }, { a: 60.4167, b: 60.4667, gap: 0.05 },
        { a: 60.4167, b: 60.4, gap: 0.0167 }, { a: 60.4167, b: 58.4643, gap: 1.9524 },
        { a: 48.3167, b: 56.9667, gap: 8.65 }
    ];
    eq('단계 수', lab.scene.length, want.length);
    lab.scene.forEach((s, i) => {
        const x = R({ skew: s.skew, prec: lab.tables.PREC[s.pi], rmode: s.rmode, tz: s.tz, edge: s.edge });
        for (const k of ['a', 'b', 'gap']) eq(`${i + 1}단계 ${k}`, x[k], want[i][k]);
    });
}

console.log('');
console.log(fail ? `실패 ${fail}건 · 통과 ${pass}건` : `전부 일치 — 단언 ${pass}건`);
process.exit(fail ? 1 : 0);
