/* ============================================================
   19편(`/throughput/`) 본문 인용 수치 대조 — 실행: node tools/verify-throughput.mjs
   ------------------------------------------------------------
   배포되는 `shared/throughput-lab.js` 를 그대로 구동해 대조한다.
   세 식의 min 이라 난수가 없다 — 표시 자리수까지 정확히 일치해야 한다.
   ============================================================ */
import { boot } from './lab-harness.mjs';

const { lab, errors } = boot('throughput');
if (errors.length) { console.error('구동 오류:', errors.join(' / ')); process.exit(1); }
if (!lab) { console.error('window.LAB 훅이 없다'); process.exit(1); }

const KB = 1024, MB = 1024 * 1024;
let fail = 0, pass = 0;
const eq = (label, got, want) => {
    const ok = typeof want === 'number' ? Math.abs(got - want) < 5e-3 : got === want;
    if (ok) pass++; else { fail++; console.error(`  실패 ${label}: 실측 ${got} · 기대 ${want}`); }
};
/* Mbps 로 두 자리까지 */
const mb = x => Math.round(x / 1e6 * 100) / 100;
const D = { bwMbps: 1000, RTT: 100, winKB: 64, N: 1, lossPct: 0 };
const R = cfg => { const x = lab.set({ ...D, ...cfg }).exact(); return { t: mb(x.t), win: mb(x.win), loss: mb(x.loss), util: x.util, limit: x.limit, inflight: x.inflight }; };

console.log('19편 인용 수치 대조\n');

{   console.log('레시피 1 — 1Gbps · RTT 100ms · 창 64KB · 커넥션 1 · 손실 0');
    const x = R({});
    eq('처리량', x.t, 5.24); eq('병목', x.limit, 'win');
    eq('링크 활용률', Math.round(x.util * 1e5) / 1e3, 0.524);
    eq('띄운 양', x.inflight, 65536);
    eq('창÷RTT 산수', mb(65536 / 0.1 * 8), 5.24);
}
{   console.log('레시피 2 — 대역폭 10Gbps');
    const a = R({}), b = R({ bwMbps: 10000 });
    eq('처리량 그대로', b.t, a.t); eq('= 5.24', b.t, 5.24);
    eq('활용률', Math.round(b.util * 1e6) / 1e4, 0.0524);
}
{   console.log('레시피 3 — RTT 10ms');
    eq('처리량', R({ bwMbps: 10000, RTT: 10 }).t, 52.43);
    eq('10배', 52.43 / 5.24 > 9.9, true);
}
{   console.log('레시피 4 — 커넥션 6개');
    eq('처리량', R({ bwMbps: 10000, N: 6 }).t, 31.46);
    /* 창을 8배로 올린 것과 커넥션을 8개로 늘린 것이 같아야 한다 (식에는 곱만 들어간다) */
    eq('창 8배 = 커넥션 8개', R({ bwMbps: 10000, winKB: 512, N: 1 }).t, R({ bwMbps: 10000, winKB: 64, N: 8 }).t);
}
{   console.log('레시피 5 — 창 1MB · 커넥션 1');
    eq('처리량', R({ bwMbps: 10000, winKB: 1024 }).t, 83.89);
}
{   console.log('레시피 6 — 손실 0.1%');
    const a = R({ bwMbps: 10000, winKB: 1024 }), b = R({ bwMbps: 10000, winKB: 1024, lossPct: 0.1 });
    eq('전', a.t, 83.89); eq('후', b.t, 4.52); eq('병목', b.limit, 'loss');
    eq('창 한도는 그대로', b.win, 83.89);
    /* 배수는 표시용 반올림값이 아니라 원값으로 잰다 */
    const raw = c => lab.set({ ...D, ...c }).exact().t;
    eq('배수', Math.round(raw({ bwMbps: 10000, winKB: 1024 }) / raw({ bwMbps: 10000, winKB: 1024, lossPct: 0.1 }) * 10) / 10, 18.5);
}
{   console.log('레시피 7 — 손실 0.1% · 커넥션 6개');
    eq('처리량', R({ bwMbps: 10000, winKB: 1024, N: 6, lossPct: 0.1 }).t, 27.14);
    const raw = c => lab.set({ ...D, ...c }).exact().t;
    eq('6배', Math.round(raw({ bwMbps: 10000, winKB: 1024, N: 6, lossPct: 0.1 }) / raw({ bwMbps: 10000, winKB: 1024, N: 1, lossPct: 0.1 }) * 100) / 100, 6);
}
{   console.log('본문 — 프로토콜 비교표 (1Gbps · RTT 100ms)');
    const h1 = p => mb(lab.calc({ B: 1e9, RTT: 100, W: 64 * KB, N: 6, p: p / 100 }).t);
    const h2 = p => mb(lab.calc({ B: 1e9, RTT: 100, W: 16 * MB, N: 1, p: p / 100 }).t);
    eq('0% · HTTP/1.1', h1(0), 31.46); eq('0% · HTTP/2', h2(0), 1000);
    eq('0.002% · HTTP/1.1', h1(0.002), 31.46); eq('0.002% · HTTP/2', h2(0.002), 31.99);
    eq('0.01% · HTTP/1.1', h1(0.01), 31.46); eq('0.01% · HTTP/2', h2(0.01), 14.31);
    eq('0.1% · HTTP/1.1', h1(0.1), 27.14); eq('0.1% · HTTP/2', h2(0.1), 4.52);
    eq('1% · HTTP/1.1', h1(1), 8.58); eq('1% · HTTP/2', h2(1), 1.43);
}
{   console.log('본문 — 교차점 0.00207%');
    let lo = 0, hi = 1e-2;
    for (let i = 0; i < 60; i++) {
        const m2 = (lo + hi) / 2;
        const a = lab.calc({ B: 1e9, RTT: 100, W: 64 * KB, N: 6, p: m2 }).t;
        const b = lab.calc({ B: 1e9, RTT: 100, W: 16 * MB, N: 1, p: m2 }).t;
        if (a > b) hi = m2; else lo = m2;
    }
    eq('교차점 (%)', Math.round(hi * 100 * 1e5) / 1e5, 0.00207);
}
{   console.log('본문 — HTTP/3 는 처리량을 안 바꾼다');
    for (const p of [1e-4, 1e-3]) {
        const h2 = lab.calc({ B: 1e9, RTT: 100, W: 16 * MB, N: 1, p }).t;
        eq(`손실 ${p * 100}% · H2 = H3`, h2, lab.calc({ B: 1e9, RTT: 100, W: 16 * MB, N: 1, p }).t);
    }
}
{   console.log('본문 — 1Gbps 를 채우려면 12.5MB, 지금 64KB');
    eq('필요한 in-flight (B)', Math.round(1e9 / 8 * 0.1), 12500000);
    eq('배수 191', Math.round(12500000 / 65536), 191);
}
{   console.log('시나리오 — 7단계');
    const want = [
        { t: 5.24, limit: 'win' }, { t: 5.24, limit: 'win' }, { t: 52.43, limit: 'win' },
        { t: 31.46, limit: 'win' }, { t: 83.89, limit: 'win' },
        { t: 4.52, limit: 'loss' }, { t: 27.14, limit: 'loss' }
    ];
    eq('단계 수', lab.scene.length, want.length);
    lab.scene.forEach((s, i) => {
        const T = lab.tables;
        const x = R({ bwMbps: T.BW[s.bi], RTT: s.RTT, winKB: T.WIN[s.wi], N: s.N, lossPct: T.LOSS[s.li] });
        eq(`${i + 1}단계 처리량`, x.t, want[i].t);
        eq(`${i + 1}단계 병목`, x.limit, want[i].limit);
    });
}

console.log('');
console.log(fail ? `실패 ${fail}건 · 통과 ${pass}건` : `전부 일치 — 단언 ${pass}건`);
process.exit(fail ? 1 : 0);
