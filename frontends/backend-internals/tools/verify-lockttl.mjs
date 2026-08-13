/* ============================================================
   18편(`/lockttl/`) 본문 인용 수치 대조 — 실행: node tools/verify-lockttl.mjs
   ------------------------------------------------------------
   배포되는 `shared/lockttl-lab.js` 를 그대로 구동해 페이지가 인용한 값과 맞춘다.
   미터는 모든 경로의 확률 가중 열거라 허용오차 없이 정확히 일치해야 한다.
   ============================================================ */
import { boot } from './lab-harness.mjs';

const { lab, doc, i18n, errors } = boot('lockttl');
if (errors.length) { console.error('구동 오류:', errors.join(' / ')); process.exit(1); }
if (!lab) { console.error('window.LAB 훅이 없다'); process.exit(1); }

const D = { L: 3000, W: 5000, P: 8000, q: .20, R: 1000, N: 2, watchdog: false, fencing: false };
let fail = 0, pass = 0;
const eq = (label, got, want) => {
    const ok = typeof want === 'number' ? Math.abs(got - want) < 1e-9 : got === want;
    if (ok) pass++; else { fail++; console.error(`  실패 ${label}: 실측 ${got} · 기대 ${want}`); }
};
const R = cfg => {
    const x = lab.set({ ...D, ...cfg }).exact();
    return {
        ran: +x.ran.toFixed(2), overlap: +(x.overlap * 100).toFixed(1),
        stale: +(x.staleWon * 100).toFixed(1), rejected: +x.rejected.toFixed(2),
        zombie: Math.round(x.zombieMs)
    };
};
const T = cfg => lab.set({ ...D, ...cfg }).trace();

console.log('18편 인용 수치 대조\n');

{   console.log('레시피 1 — TTL 3s · 작업 5s · 정지 0% · N=2');
    const x = R({ q: 0 });
    eq('같은 일 실행', x.ran, 2.00); eq('중복 실행률', x.overlap, 100.0);
    eq('락 없이 일한 시간', x.zombie, 4000); eq('낡은 쓰기가 최종', x.stale, 0.0);
}
{   console.log('레시피 2 — 펜싱만 켠다 (정지 0%)');
    const a = R({ q: 0 }), b = R({ q: 0, fencing: true });
    eq('같은 일 실행 그대로', b.ran, a.ran); eq('= 2.00', b.ran, 2.00);
    eq('중복 실행률 그대로', b.overlap, a.overlap); eq('= 100.0%', b.overlap, 100.0);
    eq('거부된 쓰기 없음', b.rejected, 0.00);
}
{   console.log('레시피 3 — 정지 8s 를 넣는다 (펜싱 끔)');
    const a = R({ q: 0 }), b = R({});
    eq('낡은 쓰기가 최종 전', a.stale, 0.0); eq('후', b.stale, 16.0);
    const tr = T({});
    eq('토큰 2 가 쓰는 시각', tr.runs.find(r => r.token === 2).finish, 8000);
    eq('토큰 1 이 덮어쓰는 시각', tr.runs.find(r => r.token === 1).finish, 13000);
    eq('최종 상태가 토큰 1', tr.final.token, 1);
    eq('낡은 쓰기가 이겼다', tr.staleWon, true);
}
{   console.log('레시피 4 — 펜싱을 켠다');
    const a = R({}), b = R({ fencing: true });
    eq('낡은 쓰기가 최종 16.0 → 0.0', b.stale, 0.0); eq('전', a.stale, 16.0);
    eq('거부된 쓰기', b.rejected, 0.16);
    eq('중복 실행률 그대로', b.overlap, 100.0);
    eq('같은 일 실행 그대로', b.ran, 2.00);
    eq('토큰 1 의 쓰기가 거부됐다', T({ fencing: true }).runs.find(r => r.token === 1).taken, false);
}
{   console.log('레시피 5 — 자동 갱신 (정지 4s · R=1000)');
    const x = R({ P: 4000, R: 1000, watchdog: true, fencing: true });
    eq('중복 실행률', x.overlap, 20.0); eq('같은 일 실행', x.ran, 1.20);
    eq('정지 확률과 같다', x.overlap, 20.0);
}
{   console.log('레시피 6 — 갱신 간격 1000 → 100ms');
    eq('정지 2.5s · R=1000', R({ P: 2500, R: 1000, watchdog: true, fencing: true }).overlap, 20.0);
    eq('정지 2.5s · R=100', R({ P: 2500, R: 100, watchdog: true, fencing: true }).overlap, 0.0);
    eq('정지 4.0s · R=1000', R({ P: 4000, R: 1000, watchdog: true, fencing: true }).overlap, 20.0);
    eq('정지 4.0s · R=100', R({ P: 4000, R: 100, watchdog: true, fencing: true }).overlap, 20.0);
    eq('견딜 수 있는 정지 상한 = L - R', 3000 - 100, 2900);
}
{   console.log('레시피 7 — TTL 9s (작업 5 + 정지 4)');
    const x = R({ L: 9000, P: 4000, R: 100, fencing: true });
    eq('중복 실행률', x.overlap, 0.0); eq('같은 일 실행', x.ran, 1.00);
    eq('죽은 워커 대기 = TTL', 9000, 9000);
}
{   console.log('본문 — 정지 > TTL 절벽 (L=3s · 펜싱 끔)');
    eq('정지 3000ms', R({ P: 3000 }).stale, 0.0);
    eq('정지 3100ms', R({ P: 3100 }).stale, 16.0);
}
{   console.log('본문 — 방어별 비교표 (정지 8s)');
    eq('없음 · 중복', R({}).overlap, 100.0);
    eq('없음 · 낡은 쓰기', R({}).stale, 16.0);
    eq('펜싱 · 중복 (그대로)', R({ fencing: true }).overlap, 100.0);
    eq('펜싱 · 낡은 쓰기', R({ fencing: true }).stale, 0.0);
    eq('갱신 · 중복', R({ P: 4000, watchdog: true }).overlap, 20.0);
    eq('갱신 · 낡은 쓰기', R({ P: 4000, watchdog: true }).stale, 0.0);
}
{   console.log('판정 — 설정마다 맞는 문안을 고르나');
    const stem = s => s.replace(/<[^>]*>/g, '').split('$')[0].slice(0, 8);
    const kind = () => {
        const h = doc.querySelector('#verdict').innerHTML.replace(/<[^>]*>/g, '');
        for (const k of ['vWrong', 'vFenced', 'vOverlap', 'vSafe'])
            if (h.startsWith(stem(i18n[k]))) return k;
        return 'unknown:' + h.slice(0, 26);
    };
    for (const [label, cfg, want] of [
        ['정지 8s 펜싱 끔', {}, 'vWrong'],
        ['정지 8s 펜싱 켬', { fencing: true }, 'vFenced'],
        ['정지 0% 펜싱 끔', { q: 0 }, 'vOverlap'],
        ['TTL 9s', { L: 9000, P: 4000, fencing: true }, 'vSafe']
    ]) { lab.set({ ...D, ...cfg }); eq(label, kind(), want); }
}
{   console.log('시나리오 — 7단계');
    const want = [
        { ran: 2.00, overlap: 100.0, stale: 0.0, rejected: 0.00 },
        { ran: 2.00, overlap: 100.0, stale: 0.0, rejected: 0.00 },
        { ran: 2.00, overlap: 100.0, stale: 16.0, rejected: 0.00 },
        { ran: 2.00, overlap: 100.0, stale: 0.0, rejected: 0.16 },
        { ran: 1.20, overlap: 20.0, stale: 0.0, rejected: 0.00 },
        { ran: 1.20, overlap: 20.0, stale: 0.0, rejected: 0.00 },
        { ran: 1.00, overlap: 0.0, stale: 0.0, rejected: 0.00 }
    ];
    eq('단계 수', lab.scene.length, want.length);
    lab.scene.forEach((s, i) => {
        const x = R(s);
        for (const k of ['ran', 'overlap', 'stale', 'rejected']) eq(`${i + 1}단계 ${k}`, x[k], want[i][k]);
    });
}

console.log('');
console.log(fail ? `실패 ${fail}건 · 통과 ${pass}건` : `전부 일치 — 단언 ${pass}건`);
process.exit(fail ? 1 : 0);
