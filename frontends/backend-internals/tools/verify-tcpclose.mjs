/* ============================================================
   21편(`/tcpclose/`) 본문 인용 수치 대조 — 실행: node tools/verify-tcpclose.mjs
   ------------------------------------------------------------
   이 편은 수치보다 **분기 판정**이 본체다. 종료 신호(FIN/RST) · 계층별 정상 종료 판정 ·
   유실 상한 · 유실 지점 수가 손잡이 조합마다 맞는지 본다.

   주의 — 이 스크립트는 **모델과 본문이 일치하는가**만 본다. 모델이 현실과 일치하는가는
   착수 전 1차 출처 확인으로 처리했다 (RFC 9293 §3.6.1 · RFC 8446 §6.1 · §5.1 ·
   nginx proxy_half_close 기본 off · NLB TLS 리스너의 front-end 종단).
   ============================================================ */
import { boot } from './lab-harness.mjs';

const { lab, errors } = boot('tcpclose');
if (errors.length) { console.error('구동 오류:', errors.join(' / ')); process.exit(1); }
if (!lab) { console.error('window.LAB 훅이 없다'); process.exit(1); }

let fail = 0, pass = 0;
const eq = (label, got, want) => {
    const ok = typeof want === 'number' ? Math.abs(got - want) < 1e-9 : got === want;
    if (ok) pass++; else { fail++; console.error(`  실패 ${label}: 실측 ${JSON.stringify(got)} · 기대 ${JSON.stringify(want)}`); }
};
const KB = 1024;
const D = { mode: 'readClose', bodyKB: 16, respKB: 1, tls: 'none', notify: true, halfClose: false };
const R = cfg => lab.set({ ...D, ...cfg }).exact();

console.log('21편 인용 수치 대조\n');

{   console.log('레시피 1 — 응답 읽고 close · TLS 없음');
    const x = R({});
    eq('종료 신호', x.signal, 'FIN'); eq('유실 상한', x.lossCap, 0);
    eq('정상 종료 판정', x.okCount, 3); eq('수신 측이 보는 것', x.seen, 'eof');
    eq('구간 수', x.hops, 1);
}
{   console.log('레시피 2 — 안 읽고 close (응답 1KB)');
    const x = R({ mode: 'blindClose' });
    eq('종료 신호', x.signal, 'RST'); eq('미독 데이터', x.unread, 1 * KB);
    eq('유실 상한 = min(본문, 수신버퍼)', x.lossCap, 16 * KB);
    eq('정상 종료 판정', x.okCount, 2);
    eq('애플리케이션은 여전히 정상', x.okApp, true);
    eq('TCP 는 비정상', x.okTcp, false);
    eq('수신 측이 보는 것', x.seen, 'reset');
}
{   console.log('레시피 3 — 응답 0 (같은 코드가 안전해진다)');
    const x = R({ mode: 'blindClose', respKB: 0 });
    eq('종료 신호', x.signal, 'FIN'); eq('유실 상한', x.lossCap, 0);
    eq('미독 데이터 없음', x.unread, 0);
    eq('종료 방식은 그대로', lab.cfg.mode, 'blindClose');
}
{   console.log('레시피 4 — SO_LINGER 0 (응답 0 이어도 RST)');
    const x = R({ mode: 'linger0', respKB: 0 });
    eq('종료 신호', x.signal, 'RST'); eq('미독 데이터는 0 인데도', x.unread, 0);
    eq('유실 상한', x.lossCap, 16 * KB);
}
{   console.log('레시피 5 — TLS 백엔드 종단 · close_notify 안 보냄');
    const x = R({ mode: 'blindClose', tls: 'backend', notify: false });
    eq('TLS 판정 비정상', x.okTls, false); eq('정상 종료 판정', x.okCount, 1);
    eq('잘리는 단위 = TLS 레코드', x.recUnit, 16384);
    eq('레코드 수 (16KB 본문)', x.records, 1);
    eq('구간은 여전히 1개', x.hops, 1);
}
{   console.log('레시피 6 — TLS 종단을 로드밸런서로');
    const a = R({ mode: 'blindClose', tls: 'backend', notify: false });
    const b = R({ mode: 'blindClose', tls: 'lb', notify: false });
    eq('구간 1 → 2', [a.hops, b.hops].join('→'), '1→2');
    eq('쪼개짐', b.split, true);
    eq('프록시도 버린다 (half-close off)', b.proxyDrops, true);
    eq('유실 상한 2배', b.lossCap, 2 * a.lossCap);
    eq('= 32KB', b.lossCap, 32 * KB);
    /* half-close 전파를 켜면 뒷단은 안 닫힌다 */
    const c = R({ mode: 'blindClose', tls: 'lb', notify: false, halfClose: true });
    eq('전파 on 이면 프록시가 안 버린다', c.proxyDrops, false);
    eq('유실 상한이 1구간분', c.lossCap, 16 * KB);
}
{   console.log('레시피 7 — shutdown(WR) 후 읽고 close');
    const x = R({ mode: 'shutWr', tls: 'lb', notify: true });
    eq('종료 신호', x.signal, 'FIN'); eq('유실 상한', x.lossCap, 0);
    eq('정상 종료 판정', x.okCount, 3);
}
{   console.log('본문 — FIN 경로는 어떤 설정에서도 유실 상한이 0 이다 (전수)');
    let bad = 0, n = 0;
    for (const mode of ['readClose', 'blindClose', 'linger0', 'shutWr'])
        for (const bodyKB of [1, 4, 16, 24, 48, 64])
            for (const respKB of [0, 1, 8, 64])
                for (const tls of ['none', 'lb', 'backend'])
                    for (const notify of [true, false])
                        for (const halfClose of [true, false]) {
                            const x = R({ mode, bodyKB, respKB, tls, notify, halfClose });
                            n++;
                            if (x.signal === 'FIN' && x.lossCap !== 0) bad++;
                            /* 애플리케이션 판정은 언제나 정상이어야 한다 — 그게 이 페이지의 축이다 */
                            if (!x.okApp) bad++;
                        }
    eq('조합 수', n, 4 * 6 * 4 * 3 * 2 * 2);
    eq('FIN 인데 유실이 있는 조합', bad, 0);
}
{   console.log('본문 — RST 가 나가는 조건은 두 가지뿐이다 (전수)');
    let wrong = 0;
    for (const mode of ['readClose', 'blindClose', 'linger0', 'shutWr'])
        for (const respKB of [0, 1, 8, 64]) {
            const x = R({ mode, respKB });
            const expect = (mode === 'linger0' || (mode === 'blindClose' && respKB > 0)) ? 'RST' : 'FIN';
            if (x.signal !== expect) wrong++;
        }
    eq('예상과 다른 조합', wrong, 0);
}
{   console.log('본문 — 미독 데이터는 수신 버퍼(64KB)로 상한이 걸린다');
    eq('응답 64KB → 미독 64KB', R({ mode: 'blindClose', respKB: 64 }).unread, 64 * KB);
    eq('본문 64KB 유실 상한도 64KB', R({ mode: 'blindClose', bodyKB: 64 }).lossCap, 64 * KB);
    eq('수신 버퍼 상수', lab.tables.RCVBUF, 64 * KB);
    eq('TLS 레코드 상수 (RFC 8446 §5.1)', lab.tables.TLS_REC, 16384);
}
{   console.log('시나리오 — 7단계');
    const want = [
        { signal: 'FIN', lossCap: 0, okCount: 3 },
        { signal: 'RST', lossCap: 16 * KB, okCount: 2 },
        { signal: 'FIN', lossCap: 0, okCount: 3 },
        { signal: 'RST', lossCap: 16 * KB, okCount: 2 },
        { signal: 'RST', lossCap: 16 * KB, okCount: 1 },
        { signal: 'RST', lossCap: 32 * KB, okCount: 1 },
        { signal: 'FIN', lossCap: 0, okCount: 3 }
    ];
    eq('단계 수', lab.scene.length, want.length);
    lab.scene.forEach((s, i) => {
        const T = lab.tables;
        const x = R({
            mode: s.mode, bodyKB: T.BODY[s.bi] / KB, respKB: T.RESP[s.ri] / KB,
            tls: s.tls, notify: s.notify, halfClose: s.halfClose
        });
        for (const k of ['signal', 'lossCap', 'okCount']) eq(`${i + 1}단계 ${k}`, x[k], want[i][k]);
    });
}

console.log('');
console.log(fail ? `실패 ${fail}건 · 통과 ${pass}건` : `전부 일치 — 단언 ${pass}건`);
process.exit(fail ? 1 : 0);
