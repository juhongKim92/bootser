/* ============================================================
   28편 검증 — 실행: node tools/verify-nagle.mjs
   ------------------------------------------------------------
   배포되는 `shared/nagle-lab.js` 를 그대로 구동해서
     1. **RFC 1122 의 두 규칙을 지키나** — 이 편의 검산점이다
        · 지연은 0.5초를 넘지 않는다 (§4.2.3.2)
        · 꽉 찬 패킷 흐름에서는 두 개마다 하나는 ACK 한다 → 그 경로에서는 타이머가 안 뜬다
        · Nagle 이 미루는 대상은 **작은** 세그먼트뿐이다 (§4.2.3.4)
     2. 본문 · 시나리오 · 판정이 인용한 수치가 모델의 실측과 같은가
     3. 불변식이 전 조합에서 성립하는가
   를 본다. 허용오차 없이 정확히 일치해야 한다.

   40ms 는 명세에 없는 리눅스 값이라 **손잡이**로 두고, 명세가 정한 것(0.5초 상한 ·
   두 개마다 하나)만 불변식으로 고정한다.
   ============================================================ */
import { boot } from './lab-harness.mjs';

const r = boot('nagle');
if (r.errors.length) { console.error('구동 실패:', r.errors); process.exit(1); }
const LAB = r.lab;
const MSS = LAB.MSS;

let pass = 0;
const fail = [];
const ok = (what, got, want) => {
    if (String(got) === String(want)) pass++;
    else fail.push(`${what} — 실측 ${got} / 기대 ${want}`);
};

const BASE = { size: 200, writes: 2, nagle: true, delack: 40, rtt: 1, joined: false };
const at = o => LAB.model(Object.assign({}, BASE, o));

/* ── 1. RFC 1122 의 규칙 ─────────────────────────────────── */

/* 지연 ACK 후보값이 전부 명세의 상한(0.5초) 안에 있나 */
for (const d of LAB.DELACKS) ok(`지연 ACK ${d}ms 는 0.5초 상한 안이다`, d <= 500, true);
ok('상한값 500ms 가 손잡이에 있다', LAB.DELACKS.includes(500), true);
ok('TCP_QUICKACK(0) 도 손잡이에 있다', LAB.DELACKS.includes(0), true);

/* 꽉 찬 세그먼트 흐름 — 두 개마다 하나, 그리고 타이머가 안 뜬다 */
{
    let checked = 0;
    for (let k = 1; k <= 4; k++) {
        const m = at({ size: MSS, writes: k });
        if (!m.allFull) fail.push(`RFC — ${k}개 꽉 찬 세그먼트인데 allFull 이 아니다`);
        else if (m.ackCount !== Math.ceil(m.segs.length / 2))
            fail.push(`RFC — ${k}개에서 ACK 가 ${m.ackCount} (기대 ${Math.ceil(m.segs.length / 2)})`);
        else if (m.stalled) fail.push(`RFC — 꽉 찬 세그먼트인데 타이머가 떴다 (k=${k})`);
        else checked++;
    }
    ok(`RFC "두 개마다 하나" 전수 ${checked}조합`, checked, 4);
}

/* Nagle 은 작은 세그먼트만 미룬다 — 크기를 MSS 로 올리면 어떤 지연 ACK 값에서도 안 막힌다 */
{
    let checked = 0;
    for (const d of LAB.DELACKS) for (let k = 2; k <= 4; k++) {
        if (at({ size: MSS, writes: k, delack: d }).stalled)
            fail.push(`Nagle — 꽉 찬 세그먼트가 막혔다 (k=${k} delack=${d})`);
        else checked++;
    }
    ok(`Nagle "작은 것만" 전수 ${checked}조합`, checked, LAB.DELACKS.length * 3);
}

/* ── 2. 본문이 인용한 수치 ─────────────────────────────── */

/* 레시피 1 · 시나리오 1 — write 한 번 */
{
    const m = at({ writes: 1 });
    ok('write 1회 총 시간', m.doneAt, 1);
    ok('write 1회 패킷', m.packets, 1);
    ok('write 1회 막히지 않는다', m.stalled, false);
    ok('write 1회 추가 지연 없음', m.extra, 0);
}

/* 레시피 2 · 시나리오 2 — 나눠 쓰기 42ms */
{
    const m = at({});
    ok('나눠 쓰기 총 시간 42ms', m.doneAt, 42);
    ok('나눠 쓰기 추가 41ms', m.extra, 41);
    ok('나눠 쓰기 패킷 3개', m.packets, 3);
    ok('나눠 쓰기 막힌다', m.stalled, true);
    ok('나눠 쓰기 합계 400B', m.total, 400);
}

/* 레시피 3 · 시나리오 3 — 합쳐 쓰기 1ms */
{
    const m = at({ joined: true });
    ok('합쳐 쓰기 총 시간 1ms', m.doneAt, 1);
    ok('합쳐 쓰기 패킷 1개', m.packets, 1);
    ok('합쳐 쓰기 막히지 않는다', m.stalled, false);
    ok('본문 — 같은 바이트다', m.total, at({}).total);
}

/* 레시피 4 · 시나리오 4 — TCP_NODELAY */
{
    const m = at({ nagle: false });
    ok('NODELAY 총 시간 1ms', m.doneAt, 1);
    ok('NODELAY 패킷 2개 (합쳐 쓰기보다 많다)', m.packets, 2);
    ok('NODELAY 는 패킷을 줄이지 않는다', m.packets > at({ joined: true }).packets, true);
}

/* 레시피 5 · 시나리오 5 — TCP_QUICKACK */
{
    const m = at({ delack: 0 });
    ok('QUICKACK 총 시간 2ms', m.doneAt, 2);
    ok('QUICKACK 는 합쳐 쓰기보다 느리다', m.doneAt > at({ joined: true }).doneAt, true);
    ok('QUICKACK 추가 1ms', m.extra, 1);
}

/* 레시피 6 · 시나리오 6 — MSS 크기 */
{
    const m = at({ size: MSS });
    ok('MSS 크기 총 시간 1ms', m.doneAt, 1);
    ok('MSS 크기 ACK 1개', m.ackCount, 1);
    ok('MSS 크기 전부 꽉 찼다', m.allFull, true);
}

/* 레시피 7 · 시나리오 7 — 합쳐 써도 꼬리가 작으면 막힌다 */
{
    const m = at({ size: 700, writes: 3, joined: true });
    ok('700×3 합쳐 쓰기 합계', m.total, 2100);
    ok('700×3 세그먼트', m.segs.join('+'), '1460+640');
    ok('700×3 총 시간 42ms', m.doneAt, 42);
    ok('700×3 막힌다', m.stalled, true);
    ok('본문 — 꼬리가 640B', 2100 % MSS, 640);
}

/* 본문 "쓰기를 늘려도 더 나빠지지 않는다" */
for (const k of [2, 3, 4]) ok(`write ${k}회여도 42ms`, at({ writes: k }).doneAt, 42);

/* 본문 "RTT 가 작을수록 40ms 가 크게 보인다" */
{
    const near = at({ rtt: 1 }), far = at({ rtt: 100 });
    ok('RTT 1ms 에서 40ms 는 총 시간의 대부분', Math.round(near.extra / near.doneAt * 100), 98);
    ok('RTT 100ms 에서는 비중이 준다', Math.round(far.extra / far.doneAt * 100), 58);
    ok('가까울수록 상대적으로 더 아프다', near.extra / near.doneAt > far.extra / far.doneAt, true);
}

/* ── 3. 불변식 ──────────────────────────────────────────── */

const KS = [1, 2, 3, 4], RS = [1, 5, 20, 50, 100];

/* ① 막히면 추가 지연이 정확히 (지연 ACK + 왕복 하나) 다 */
{
    let checked = 0;
    for (const size of LAB.SIZES) for (const k of KS) for (const d of LAB.DELACKS) for (const rtt of RS) {
        const m = at({ size, writes: k, delack: d, rtt });
        if (m.stalled) {
            const want = d + rtt;
            if (Math.abs(m.extra - want) > 1e-9)
                fail.push(`불변식① size=${size} k=${k} d=${d} rtt=${rtt} — 추가 ${m.extra} (기대 ${want})`);
            else checked++;
        } else if (m.extra !== 0) {
            fail.push(`불변식① 안 막혔는데 추가 지연 ${m.extra}`);
        } else checked++;
    }
    ok(`불변식① 전수 ${checked}조합`, checked, LAB.SIZES.length * KS.length * LAB.DELACKS.length * RS.length);
}

/* ② write 한 번이면 절대 막히지 않는다 */
{
    let checked = 0;
    for (const size of LAB.SIZES) for (const d of LAB.DELACKS) for (const rtt of RS) {
        if (at({ size, writes: 1, delack: d, rtt }).stalled)
            fail.push(`불변식② write 1회가 막혔다 — size=${size}`);
        else checked++;
    }
    ok(`불변식② 전수 ${checked}조합`, checked, LAB.SIZES.length * LAB.DELACKS.length * RS.length);
}

/* ③ Nagle 을 끄면 절대 막히지 않는다 */
{
    let checked = 0;
    for (const size of LAB.SIZES) for (const k of KS) for (const j of [false, true]) {
        if (at({ size, writes: k, nagle: false, joined: j }).stalled)
            fail.push(`불변식③ NODELAY 인데 막혔다 — size=${size} k=${k}`);
        else checked++;
    }
    ok(`불변식③ 전수 ${checked}조합`, checked, LAB.SIZES.length * KS.length * 2);
}

/* ④ 막히는 횟수는 한 번뿐 — 쓰기 횟수를 늘려도 총 시간이 안 변한다 */
{
    let checked = 0;
    for (const size of LAB.SIZES) for (const d of LAB.DELACKS) {
        const base = at({ size, writes: 2, delack: d }).doneAt;
        for (const k of [3, 4]) {
            if (at({ size, writes: k, delack: d }).doneAt !== base)
                fail.push(`불변식④ size=${size} d=${d} 에서 k=${k} 가 다르다`);
            else checked++;
        }
    }
    ok(`불변식④ 전수 ${checked}조합`, checked, LAB.SIZES.length * LAB.DELACKS.length * 2);
}

/* ⑤ 합쳐 쓰기가 나눠 쓰기보다 느린 경우는 없다 */
{
    let checked = 0;
    for (const size of LAB.SIZES) for (const k of KS) for (const d of LAB.DELACKS) {
        const split = at({ size, writes: k, delack: d, joined: false });
        const join = at({ size, writes: k, delack: d, joined: true });
        if (join.doneAt > split.doneAt + 1e-9)
            fail.push(`불변식⑤ 합쳐 썼는데 더 느리다 — size=${size} k=${k} d=${d}`);
        else checked++;
    }
    ok(`불변식⑤ 전수 ${checked}조합`, checked, LAB.SIZES.length * KS.length * LAB.DELACKS.length);
}

/* ⑥ 세그먼트 쪼개기 — 합이 보낼 바이트와 같고, 꽉 찬 것 + 꼬리 하나다 */
{
    let checked = 0;
    for (const bytes of [1, 40, 200, 1459, 1460, 1461, 2100, 2920, 5000]) {
        const segs = LAB.segs(bytes);
        if (segs.reduce((a, b) => a + b, 0) !== bytes) fail.push(`불변식⑥ ${bytes}B 합이 안 맞는다`);
        else if (segs.slice(0, -1).some(x => x !== MSS)) fail.push(`불변식⑥ ${bytes}B 앞쪽이 꽉 차지 않았다`);
        else if (segs[segs.length - 1] > MSS) fail.push(`불변식⑥ ${bytes}B 꼬리가 MSS 를 넘는다`);
        else checked++;
    }
    ok(`불변식⑥ 전수 ${checked}개 크기`, checked, 9);
}

/* ── 4. 시나리오가 본문과 같은 설정을 밟나 ───────────────── */
{
    const want = [
        { size: 200, writes: 1, nagle: true, delack: 40, rtt: 1, joined: false },
        { size: 200, writes: 2, nagle: true, delack: 40, rtt: 1, joined: false },
        { size: 200, writes: 2, nagle: true, delack: 40, rtt: 1, joined: true },
        { size: 200, writes: 2, nagle: false, delack: 40, rtt: 1, joined: false },
        { size: 200, writes: 2, nagle: true, delack: 0, rtt: 1, joined: false },
        { size: 1460, writes: 2, nagle: true, delack: 40, rtt: 1, joined: false },
        { size: 700, writes: 3, nagle: true, delack: 40, rtt: 1, joined: true }
    ];
    ok('시나리오 단계 수', LAB.scene.length, want.length);
    want.forEach((w, i) => ok(`시나리오 ${i + 1} 설정`, JSON.stringify(LAB.scene[i]), JSON.stringify(w)));
    want.forEach((w, i) => ok(`시나리오 ${i + 1} 크기가 손잡이 위에 있다`, LAB.SIZES.includes(w.size), true));
    want.forEach((w, i) => ok(`시나리오 ${i + 1} 지연 ACK 가 손잡이 위에 있다`, LAB.DELACKS.includes(w.delack), true));
}

/* ── 5. 렌더된 문자열이 실제로 그 수치를 담고 있나 ────────── */
{
    LAB.set({ size: 200, writes: 2, nagle: true, delack: 40, rtt: 1, joined: false });
    ok('미터에 42ms 가 있다', r.doc.cache.get('#meters').innerHTML.includes('42ms'), true);
    ok('판정이 타이머를 짚는다', r.doc.cache.get('#verdict').innerHTML.includes('40ms'), true);
    ok('시간축에 붙잡는 구간이 그려진다', r.doc.cache.get('#wire').innerHTML.includes('class="held"'), true);
    ok('시간축에 타이머 구간이 그려진다', r.doc.cache.get('#wire').innerHTML.includes('class="timer"'), true);
    const four = r.doc.cache.get('#four').innerHTML;
    for (const v of ['42ms', '1ms', '2ms']) ok(`비교표에 ${v} 가 있다`, four.includes(v), true);

    LAB.set({ size: 1460 });
    ok('MSS 크기면 붙잡는 구간이 없다', r.doc.cache.get('#wire').innerHTML.includes('class="held"'), false);

    LAB.set({ size: 200, writes: 1, nagle: true, delack: 40, rtt: 1, joined: false });   /* 첫 화면으로 */
}

console.log(fail.length ? '' : `단언 ${pass}건 — 전부 통과`);
for (const f of fail) console.error('실패  ' + f);
if (fail.length) console.error(`\n통과 ${pass}건 · 실패 ${fail.length}건`);
process.exit(fail.length ? 1 : 0);
