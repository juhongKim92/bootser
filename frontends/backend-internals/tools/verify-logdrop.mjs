/* ============================================================
   32편 검증 — 실행: node tools/verify-logdrop.mjs
   ------------------------------------------------------------
   배포되는 `shared/logdrop-lab.js` 를 그대로 구동해서
     1. **logback 문서의 두 문턱을 지키나** — 이 편의 검산점이다
        · queueSize 기본 256
        · "when the blocking queue has 20% capacity remaining" → 256×0.2 = 51.2 → 51건
        · "To keep all events, set discardingThreshold to 0" → 0 이면 버림이 없다
        · "If the queue is filled up, then application threads are blocked"
     2. 본문 · 시나리오 · 판정이 인용한 수치가 모델의 실측과 같은가
     3. 불변식이 전 조합에서 성립하는가 — 특히 **초과분이 셋으로만 나뉜다**
   를 본다. 허용오차 없이 정확히 일치해야 한다.

   256 과 20% 는 명세값이라 불변식으로 고정하고, **한 건 쓰는 시간(소비율)은 우리가
   정한 입력**이라 손잡이로만 둔다 — 28편이 지연 ACK 40ms 를 리눅스 구현값으로
   분리한 것과 같은 취급이다.
   ============================================================ */
import { boot } from './lab-harness.mjs';

const r = boot('logdrop');
if (r.errors.length) { console.error('구동 실패:', r.errors); process.exit(1); }
const LAB = r.lab;

let pass = 0;
const fail = [];
const ok = (what, got, want) => {
    if (String(got) === String(want)) pass++;
    else fail.push(`${what} — 실측 ${got} / 기대 ${want}`);
};
const near = (a, b) => Math.abs(a - b) < 1e-9;
const r2 = v => Math.round(v * 100) / 100;

const BASE = { q: 256, disc: 20, never: false, rate: 40, write: 100, errp: 5 };
const at = o => LAB.model(Object.assign({}, BASE, o));

/* ── 1. logback 문서가 정한 것 ───────────────────────────── */

ok('명세 기본값 256 이 손잡이에 있다', LAB.QS.includes(256), true);
ok('명세 문턱 20% 가 손잡이에 있다', LAB.DISC.includes(20), true);
ok('"전부 보관"(0) 이 손잡이에 있다', LAB.DISC.includes(0), true);

/* 256 × 20% = 51.2 → 51. 문서의 두 값을 곱해 나오는 유일한 수다. */
ok('기본 설정의 버림 문턱', at({}).thr, 51);
ok('기본 설정의 버림 선', at({}).discLine, 205);

/* 전수 — 문턱은 언제나 floor(q × disc/100) 이고 버림 선은 q − thr 이다 */
{
    let checked = 0;
    for (const q of LAB.QS) for (const disc of LAB.DISC) {
        const m = at({ q, disc });
        if (m.thr !== Math.floor(q * disc / 100)) fail.push(`문턱 — q=${q} disc=${disc} 에서 ${m.thr}`);
        else if (m.discLine !== q - m.thr) fail.push(`버림 선 — q=${q} disc=${disc} 에서 ${m.discLine}`);
        else checked++;
    }
    ok(`문턱 산수 전수 ${checked}조합`, checked, LAB.QS.length * LAB.DISC.length);
}

/* "To keep all events, set discardingThreshold to 0" — 막는 설정에서는 한 건도 안 잃는다 */
{
    let checked = 0;
    for (const q of LAB.QS) for (const rate of [1, 8, 40, 120, 200]) for (const errp of LAB.ERRP) {
        const m = at({ q, disc: 0, never: false, rate, errp });
        if (m.dropInfo !== 0 || m.dropErr !== 0)
            fail.push(`전부 보관인데 버렸다 — q=${q} rate=${rate} errp=${errp}`);
        else checked++;
    }
    ok(`"전부 보관" 전수 ${checked}조합`, checked, LAB.QS.length * 5 * LAB.ERRP.length);
}

/* ── 2. 본문이 인용한 수치 ─────────────────────────────── */

/* 레시피 1 · 시나리오 1 — 파이프가 소화한다 */
{
    const m = at({ rate: 8 });
    ok('1단계 상태', m.state, 'clean');
    ok('1단계 큐 길이', m.len, 0);
    ok('1단계 대기 0.1ms', r2(m.wait), 0.1);
    ok('1단계 버림 없음', m.dropInfo + m.dropErr, 0);
    ok('1단계 소비율 1만/초', m.mu, 10000);
}

/* 레시피 2 · 시나리오 2 — 6.83ms 부터 초당 3만 건 */
{
    const m = at({});
    ok('2단계 상태', m.state, 'discarding');
    ok('2단계 도착률 4만/초', m.lam, 40000);
    ok('2단계 버림 시작 6.83ms', r2(m.tDisc), 6.83);
    ok('2단계 막히지 않는다', m.tFull, null);
    ok('2단계 INFO 손실 3만/초', m.dropInfo, 30000);
    ok('2단계 ERROR 손실 없음', m.dropErr, 0);
    ok('2단계 큐 205 에서 멈춘다', m.len, 205);
    ok('2단계 대기 20.6ms', r2(m.wait), 20.6);
    /* 본문 "0.1ms 에서 20.5ms 로 205배" */
    ok('2단계 대기가 206배', r2(m.wait / (1000 / m.mu)), 206);
}

/* 레시피 3 · 시나리오 3 — 에러가 절반이면 막힌다 */
{
    const m = at({ errp: 50 });
    ok('3단계 상태', m.state, 'blocking');
    ok('3단계 막힘 시작 11.93ms', r2(m.tFull), 11.93);
    ok('3단계 버림 시작은 그대로 6.83ms', r2(m.tDisc), 6.83);
    ok('3단계 INFO 손실 2만/초', m.dropInfo, 20000);
    ok('3단계 스레드 흡수 1만/초', m.absorbed, 10000);
    ok('3단계 호출당 대기 0.1ms', r2(m.perCall), 0.1);
    ok('3단계 파이프 상한 1만/초', m.cap, 10000);
    /* 본문 "버려도 초당 2만 건이 남는다" */
    ok('3단계 버릴 수 없는 도착 2만/초', m.lamKept, 20000);
}

/* 레시피 4 · 시나리오 4 — neverBlock 이면 ERROR 가 사라진다 */
{
    const m = at({ errp: 50, never: true });
    ok('4단계 상태', m.state, 'dropall');
    ok('4단계 막힘 없음', m.absorbed, 0);
    ok('4단계 ERROR 손실 1만/초', m.dropErr, 10000);
    ok('4단계 INFO 손실 2만/초', m.dropInfo, 20000);
    ok('4단계 꽉 차는 시각은 같다', r2(m.tFull), 11.93);
}

/* 레시피 5 · 시나리오 5 — 전부 보관이 더 빨리 막는다 */
{
    const m = at({ disc: 0 });
    ok('5단계 상태', m.state, 'blocking');
    ok('5단계 막힘 시작 8.53ms', r2(m.tFull), 8.53);
    ok('5단계 버림 없음', m.dropInfo + m.dropErr, 0);
    ok('5단계 흡수 3만/초', m.absorbed, 30000);
    /* 본문 "2단계에서는 멀쩡했던 상황" — 같은 부하에서 기본 설정은 안 막힌다 */
    ok('5단계 같은 부하의 기본 설정은 안 막힌다', at({}).tFull, null);
}

/* 레시피 6 · 시나리오 6 — 큐를 키우면 늦어질 뿐 */
{
    const m = at({ q: 4096 });
    ok('6단계 버림 시작 109.23ms', r2(m.tDisc), 109.23);
    ok('6단계 대기 327.8ms', r2(m.wait), 327.8);
    ok('6단계 큐 3,277 에서 멈춘다', m.len, 3277);
    ok('6단계 문턱 819', m.thr, 819);
    /* 본문 표 "사라지는 양은 한 건도 안 줄어든다" */
    ok('6단계 손실은 256 일 때와 같다', m.dropInfo, at({}).dropInfo);
    /* 본문 "약 열여섯 배 뒤로" — 3277/205 이라 정확히 16 이 아니다. 처음에 16 으로
       적었다가 여기서 잡혔다. 어림수는 본문에만 두고 단언은 실측을 쓴다. */
    ok('6단계 버림 시작이 15.99배', r2(m.tDisc / at({}).tDisc), 15.99);
}

/* 레시피 7 · 시나리오 7 — 소비율이 원인이다 */
{
    const m = at({ write: 5 });
    ok('7단계 상태', m.state, 'clean');
    ok('7단계 소비율 20만/초', m.mu, 200000);
    ok('7단계 도착률은 그대로 4만/초', m.lam, 40000);
    ok('7단계 큐 0', m.len, 0);
}

/* 본문 「명세가 문턱을 둘 정해뒀다」 표 — 남은 용량별 갈림 */
{
    const m = at({});
    ok('표: 버림이 시작되는 큐 길이', m.discLine, 205);
    ok('표: 남은 용량 51건', m.q === undefined ? 256 - m.discLine : 256 - m.discLine, 51);
}

/* ── 3. 불변식 (전수) ───────────────────────────────────── */

const RATES = [1, 4, 8, 20, 40, 90, 140, 200];
const combos = [];
for (const q of LAB.QS) for (const disc of LAB.DISC) for (const never of [false, true])
    for (const rate of RATES) for (const write of LAB.WRITE) for (const errp of LAB.ERRP)
        combos.push({ q, disc, never, rate, write, errp });

/* ① 초과분은 셋으로만 나뉘고 합이 정확히 λ − μ 다 — 이 모델의 뼈대 */
{
    let checked = 0;
    for (const c of combos) {
        const m = at(c);
        if (!near(m.dropInfo + m.dropErr + m.absorbed, m.excess))
            fail.push(`불변식① 합이 안 맞는다 — ${JSON.stringify(c)} : ${m.dropInfo}+${m.dropErr}+${m.absorbed} ≠ ${m.excess}`);
        else checked++;
    }
    ok(`불변식① 전수 ${checked}조합`, checked, combos.length);
}

/* ② 도착이 소비 이하면 아무 일도 없다 */
{
    let checked = 0, seen = 0;
    for (const c of combos) {
        const m = at(c);
        if (m.lam > m.mu) continue;
        seen++;
        if (m.state !== 'clean' || m.len !== 0 || m.excess !== 0 || m.tDisc !== null)
            fail.push(`불변식② λ≤μ 인데 ${m.state} — ${JSON.stringify(c)}`);
        else checked++;
    }
    ok(`불변식② 전수 ${checked}조합`, checked, seen);
}

/* ③ WARN·ERROR 는 neverBlock 이 켜져 있을 때만 사라진다 — 문서가 정한 등급 규칙 */
{
    let checked = 0;
    for (const c of combos) {
        const m = at(c);
        if (m.dropErr > 0 && !c.never)
            fail.push(`불변식③ neverBlock 이 꺼졌는데 ERROR 를 버렸다 — ${JSON.stringify(c)}`);
        else checked++;
    }
    ok(`불변식③ 전수 ${checked}조합`, checked, combos.length);
}

/* ④ neverBlock 이면 절대 막지 않는다 */
{
    let checked = 0, seen = 0;
    for (const c of combos) {
        if (!c.never) continue;
        seen++;
        const m = at(c);
        if (m.absorbed !== 0 || m.state === 'blocking')
            fail.push(`불변식④ neverBlock 인데 막혔다 — ${JSON.stringify(c)}`);
        else checked++;
    }
    ok(`불변식④ 전수 ${checked}조합`, checked, seen);
}

/* ⑤ 버릴 수 있는 것보다 많이 버리지 않는다 — INFO 손실은 INFO 도착을 못 넘는다 */
{
    let checked = 0;
    for (const c of combos) {
        const m = at(c);
        if (m.dropInfo > m.lamInfo + 1e-9)
            fail.push(`불변식⑤ INFO 도착보다 많이 버렸다 — ${JSON.stringify(c)}`);
        else checked++;
    }
    ok(`불변식⑤ 전수 ${checked}조합`, checked, combos.length);
}

/* ⑥ 리틀의 법칙 — (큐 길이 + 자기) = 대기 × 소비율. 본문이 327.8ms 를 여기서 뽑는다.
   ⚠ 이 불변식이 모델 버그를 잡았다 — 빈 큐만 대기를 1/μ 로 따로 두는 바람에
   `wait` 가 상태마다 다른 뜻이었다(빈 큐는 서비스 시간, 나머지는 큐 시간).
   그대로 갔으면 1단계의 0.1ms 와 2단계의 20.5ms 가 서로 다른 자를 쓰고 있었다. */
{
    let checked = 0;
    for (const c of combos) {
        const m = at(c);
        if (!near(m.len + 1, m.wait * m.mu / 1000))
            fail.push(`불변식⑥ 리틀이 안 맞는다 — ${JSON.stringify(c)}`);
        else checked++;
    }
    ok(`불변식⑥ 전수 ${checked}조합`, checked, combos.length);
}

/* ⑦ 버림이 막힘보다 먼저 온다 — 순서가 뒤집히면 페이지의 이야기가 성립하지 않는다 */
{
    let checked = 0, seen = 0;
    for (const c of combos) {
        const m = at(c);
        if (m.tFull === null) continue;
        seen++;
        if (m.tDisc > m.tFull + 1e-9) fail.push(`불변식⑦ 막힘이 버림보다 빠르다 — ${JSON.stringify(c)}`);
        else checked++;
    }
    ok(`불변식⑦ 전수 ${checked}조합`, checked, seen);
}

/* ⑧ **큐 크기는 정상 상태의 손실률을 바꾸지 못한다** — 본문의 핵심 주장이다.
   버림이 걸리는 설정에서 q 만 바꿔도 손실률과 상태가 같아야 한다. */
{
    let checked = 0, seen = 0;
    for (const disc of [20, 40]) for (const rate of RATES) for (const write of LAB.WRITE)
        for (const errp of LAB.ERRP) {
            const ref = at({ q: LAB.QS[0], disc, rate, write, errp });
            for (const q of LAB.QS.slice(1)) {
                seen++;
                const m = at({ q, disc, rate, write, errp });
                if (m.state !== ref.state || !near(m.dropInfo, ref.dropInfo) ||
                    !near(m.dropErr, ref.dropErr) || !near(m.absorbed, ref.absorbed))
                    fail.push(`불변식⑧ 큐 크기가 손실률을 바꿨다 — q=${q} disc=${disc} rate=${rate} write=${write} errp=${errp}`);
                else checked++;
            }
        }
    ok(`불변식⑧ 전수 ${checked}조합`, checked, seen);
}

/* ── 4. 시나리오가 본문과 같은 설정을 밟나 ───────────────── */
{
    const want = [
        { q: 256, disc: 20, never: false, rate: 8, write: 100, errp: 5 },
        { q: 256, disc: 20, never: false, rate: 40, write: 100, errp: 5 },
        { q: 256, disc: 20, never: false, rate: 40, write: 100, errp: 50 },
        { q: 256, disc: 20, never: true, rate: 40, write: 100, errp: 50 },
        { q: 256, disc: 0, never: false, rate: 40, write: 100, errp: 5 },
        { q: 4096, disc: 20, never: false, rate: 40, write: 100, errp: 5 },
        { q: 256, disc: 20, never: false, rate: 40, write: 5, errp: 5 }
    ];
    ok('시나리오 단계 수', LAB.scene.length, want.length);
    want.forEach((w, i) => ok(`시나리오 ${i + 1} 설정`, JSON.stringify(LAB.scene[i]), JSON.stringify(w)));
    want.forEach((w, i) => ok(`시나리오 ${i + 1} 큐가 손잡이 위에 있다`, LAB.QS.includes(w.q), true));
    want.forEach((w, i) => ok(`시나리오 ${i + 1} 문턱이 손잡이 위에 있다`, LAB.DISC.includes(w.disc), true));
    want.forEach((w, i) => ok(`시나리오 ${i + 1} 쓰는 시간이 손잡이 위에 있다`, LAB.WRITE.includes(w.write), true));
    want.forEach((w, i) => ok(`시나리오 ${i + 1} 에러 비율이 손잡이 위에 있다`, LAB.ERRP.includes(w.errp), true));
    /* 단계마다 상태가 갈려야 이야기가 성립한다 */
    const states = LAB.scene.map(c => LAB.model(c).state);
    ok('시나리오 상태 순서', states.join(','),
        'clean,discarding,blocking,dropall,blocking,discarding,clean');
}

/* ── 5. 렌더된 문자열이 실제로 그 수치를 담고 있나 ────────── */
{
    LAB.set(BASE);
    const meters = r.doc.cache.get('#meters').innerHTML;
    ok('미터에 6.83ms 가 있다', meters.includes('6.83ms'), true);
    ok('미터에 30,000/초 가 있다', meters.includes('30,000/초'), true);
    ok('미터에 205 / 256 이 있다', meters.includes('205 / 256'), true);
    ok('미터에 20.6ms 가 있다', meters.includes('20.6ms'), true);
    ok('게이지가 버림 선을 그린다', r.doc.cache.get('#gauge').innerHTML.includes('class="qline"'), true);
    ok('상태 띠에 버림 구간이 있다', r.doc.cache.get('#phases').innerHTML.includes('band drop'), true);
    ok('기본 상태에서는 막힘 띠가 없다', r.doc.cache.get('#phases').innerHTML.includes('band block'), false);

    LAB.set({ errp: 50 });
    ok('에러 50% 면 막힘 띠가 생긴다', r.doc.cache.get('#phases').innerHTML.includes('band block'), true);
    ok('판정이 11.93ms 를 짚는다', r.doc.cache.get('#verdict').innerHTML.includes('11.93ms'), true);

    LAB.set({ errp: 50, never: true });
    ok('neverBlock 이면 등급 없이 버리는 띠', r.doc.cache.get('#phases').innerHTML.includes('band dropall'), true);
    ok('판정이 ERROR 손실을 짚는다', r.doc.cache.get('#verdict').innerHTML.includes('ERROR 10,000/초'), true);

    LAB.set({ disc: 0, errp: 5, never: false });
    ok('전부 보관이면 버림 표식이 없다', r.doc.cache.get('#phases').innerHTML.includes('class="mark"'), false);

    LAB.set({ q: 4096, disc: 20 });
    const big = r.doc.cache.get('#meters').innerHTML;
    ok('큐 4096 미터에 109.23ms', big.includes('109.23ms'), true);
    ok('큐 4096 미터에 327.8ms', big.includes('327.8ms'), true);

    const four = r.doc.cache.get('#four').innerHTML;
    for (const v of ['30,000/초', '20.6ms']) ok(`비교표에 ${v} 가 있다`, four.includes(v), true);

    LAB.set(LAB.scene[0]);   /* 첫 화면으로 되돌린다 — 프리렌더와 같은 상태여야 한다 */
}

console.log(fail.length ? '' : `단언 ${pass}건 — 전부 통과`);
for (const f of fail) console.error('실패  ' + f);
if (fail.length) console.error(`\n통과 ${pass}건 · 실패 ${fail.length}건`);
process.exit(fail.length ? 1 : 0);
