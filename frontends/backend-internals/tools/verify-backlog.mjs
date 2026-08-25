/* ============================================================
   27편 검증 — 실행: node tools/verify-backlog.mjs
   ------------------------------------------------------------
   배포되는 `shared/backlog-lab.js` 를 그대로 구동해서
     1. **`tcp(7)` 의 "approximately 127 seconds" 를 재현하나** — 이 편의 검산점이다
     2. 본문 · 시나리오 · 판정이 인용한 수치가 모델의 실측과 같은가
     3. 불변식이 전 조합에서 성립하는가
   를 본다. 허용오차 없이 정확히 일치해야 한다.

   1번이 이 스크립트의 존재 이유다. RFC 6298 은 첫 RTO 1초와 2배 백오프만 정하고
   재시도 한도는 안 정한다. 그 한도(리눅스 기본 6)와 합계(127초)를 man page 가 주므로,
   두 문서가 같은 숫자를 가리키는 것을 여기 고정한다.
   ============================================================ */
import { boot } from './lab-harness.mjs';

const r = boot('backlog');
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

const BASE = { lambda: 2000, accept: 500, backlog: 128, burst: 5, abort: false };
const at = o => LAB.model(Object.assign({}, BASE, o));

/* ── 1. RFC 6298 백오프 + tcp(7) 의 합계 ─────────────────── */
{
    /* 재전송 시각 2^k − 1 */
    const want = [1, 3, 7, 15, 31, 63];
    want.forEach((v, i) => ok(`RFC 6298 — ${i + 1}번째 재전송`, LAB.retryAt(i + 1), v));
    ok('계단이 그 여섯 값이다', LAB.STEPS.join(','), want.join(','));

    /* man page — "The default value is 6, which corresponds to
       retrying for up to approximately 127 seconds" */
    ok('tcp_syn_retries 기본값', LAB.RETRIES, 6);
    ok('man page — 6회는 약 127초', LAB.giveUpAt(6), 127);
    ok('모델이 쓰는 포기 시각도 127초', LAB.GIVE_UP, 127);

    /* 다른 한도에서도 2^(n+1) − 1 이다 — 규칙이 맞는지 본다 */
    for (const [n, v] of [[1, 3], [2, 7], [3, 15], [4, 31], [5, 63], [7, 255]])
        ok(`재시도 ${n}회면 포기 ${v}초`, LAB.giveUpAt(n), v);
}

/* backlog 눈금이 man page 의 기본값을 담고 있나 */
ok('somaxconn 5.4 이전 기본 128 이 눈금에 있다', LAB.BACKLOGS.includes(128), true);
ok('somaxconn 5.4 이후 기본 4096 이 눈금에 있다', LAB.BACKLOGS.includes(4096), true);

/* ── 2. 본문이 인용한 수치 ─────────────────────────────── */

/* 레시피 1 · 시나리오 1 — 과부하가 아니면 아무 일도 없다 */
{
    const m = at({ lambda: 400 });
    ok('과부하 아님 — 버려짐', m.dropped, 0);
    ok('과부하 아님 — 큐에 쌓임', m.queued, 0);
    ok('과부하 아님 — 클라이언트 지연', m.clientWait, 0);
    ok('과부하 아님 — 큐가 안 참', isFinite(m.fillAt), false);
    /* backlog 를 어떻게 두든 같다 */
    for (const b of LAB.BACKLOGS) ok(`과부하 아님 — backlog ${b} 여도 같다`, at({ lambda: 400, backlog: b }).dropped, 0);
}

/* 레시피 2 · 시나리오 2 — 기본 버스트 */
{
    const m = at({});
    near('큐가 차기까지 0.09초', m.fillAt, 128 / 1500, 1e-12);
    ok('큐가 차기까지 (표기)', m.fillAt.toFixed(2), '0.09');
    ok('버려진 커넥션 7,372건', m.dropped, 7372);
    ok('넘친 구간 (표기)', m.overflowFor.toFixed(2), '4.91');
    ok('클라이언트 지연 7초', m.clientWait, 7);
    ok('애플리케이션이 본 것 0건', m.serverSees, 0);
    ok('큐에 들어간 것 128건', m.queued, 128);
    ok('큐 맨 뒤 대기 0.26초', m.queueWait.toFixed(2), '0.26');
}

/* 레시피 3 · 시나리오 3 — 2초 버스트 */
{
    const m = at({ burst: 2 });
    ok('2초 — 넘친 구간', m.overflowFor.toFixed(2), '1.91');
    ok('2초 — 클라이언트 지연 3초', m.clientWait, 3);
    ok('2초 — 넘친 구간 대비 1.57배', (m.clientWait / m.overflowFor).toFixed(2), '1.57');
    ok('2초 — 몰린 시간의 1.50배', (m.clientWait / 2).toFixed(2), '1.50');
    ok('2초 — 버려짐', m.dropped, 2872);
}

/* 레시피 4 · 시나리오 4 — 4초 버스트 */
{
    const m = at({ burst: 4 });
    ok('4초 — 넘친 구간', m.overflowFor.toFixed(2), '3.91');
    ok('4초 — 클라이언트 지연 7초', m.clientWait, 7);
    ok('4초 — 넘친 구간 대비 1.79배', (m.clientWait / m.overflowFor).toFixed(2), '1.79');
    ok('4초 — 몰린 시간의 1.75배', (m.clientWait / 4).toFixed(2), '1.75');
    ok('4초 — 버려짐', m.dropped, 5872);
}

/* 본문 표 — 몰린 시간과 기다린 시간 */
for (const [burst, wait, ratio] of [[2, 3, '1.50'], [4, 7, '1.75'], [8, 15, '1.88'], [16, 31, '1.94']]) {
    const m = at({ burst });
    ok(`본문 표 — ${burst}초 몰리면 ${wait}초`, m.clientWait, wait);
    ok(`본문 표 — ${burst}초의 ${ratio}배`, (m.clientWait / burst).toFixed(2), ratio);
}

/* 레시피 5 · 시나리오 5 — backlog 4096 */
{
    const m = at({ backlog: 4096 });
    ok('4096 — 큐가 차기까지 2.73초', m.fillAt.toFixed(2), '2.73');
    ok('4096 — 버려짐 3,404건', m.dropped, 3404);
    ok('4096 — 클라이언트 지연 3초', m.clientWait, 3);
    ok('4096 — 큐 맨 뒤 대기 8.19초', m.queueWait.toFixed(2), '8.19');
    /* 드롭은 줄고 대기는 늘어난다 — 11편의 결론 */
    const small = at({});
    ok('4096 — 드롭이 줄었다', m.dropped < small.dropped, true);
    ok('4096 — 대기가 늘었다', m.queueWait > small.queueWait, true);
}

/* 레시피 6 · 시나리오 6 — RST */
{
    const m = at({ abort: true });
    ok('RST — 클라이언트 지연 0', m.clientWait, 0);
    ok('RST — 버려진 수는 그대로', m.dropped, at({}).dropped);
}

/* 레시피 7 · 시나리오 7 — 70초 */
{
    const m = at({ burst: 70 });
    ok('70초 — 재시도로 못 살린다', m.dead, true);
    ok('70초 — 127초 뒤 실패', m.clientWait, 127);
    ok('70초 — 넘친 구간', m.overflowFor.toFixed(1), '69.9');
    ok('70초 — 버려짐', m.dropped, 104872);
    /* 64초가 경계다 — 마지막 재전송이 63초이므로 */
    ok('63초를 넘는 넘침은 못 살린다', at({ burst: 63 + 128 / 1500 + 0.01 }).dead, true);
    ok('63초 이하면 살린다', at({ burst: 63 + 128 / 1500 - 0.01 }).dead, false);
}

/* ── 3. 불변식 ──────────────────────────────────────────── */

const LS = [600, 1000, 2000, 3000, 5000], AS = [100, 200, 500, 1000, 2000];
const DS = [0, 1, 2, 4, 5, 8, 16, 30, 63, 70];

/* ① 넘친 구간이 0 이면 버려진 것도 0, 클라이언트 지연도 0 */
/* ② 클라이언트 지연은 넘친 구간 이상이다 (죽지 않은 경우) */
/* ③ 계단 값은 2^k − 1 중 하나이거나 127 이다 */
/* ④ 애플리케이션이 보는 것은 언제나 0 */
{
    let checked = 0;
    for (const lambda of LS) for (const accept of AS) for (const backlog of LAB.BACKLOGS) for (const burst of DS) {
        if (lambda <= accept) continue;
        const m = at({ lambda, accept, backlog, burst });
        const tag = `λ=${lambda} A=${accept} B=${backlog} D=${burst}`;
        if (m.overflowFor <= 0 && (m.dropped !== 0 || m.clientWait !== 0)) fail.push(`불변식① ${tag}`);
        else if (!m.dead && m.overflowFor > 0 && m.clientWait < m.overflowFor - 1e-9) fail.push(`불변식② ${tag}`);
        else if (m.clientWait !== 0 && !LAB.STEPS.includes(m.clientWait) && m.clientWait !== LAB.GIVE_UP) fail.push(`불변식③ ${tag} — ${m.clientWait}`);
        else if (m.serverSees !== 0) fail.push(`불변식④ ${tag}`);
        else checked++;
    }
    ok(`불변식①②③④ 전수 ${checked}조합`, checked > 300, true);
}

/* ⑤ backlog 를 키우면 버려지는 것이 줄거나 같고, 큐 대기는 늘거나 같다 */
{
    let checked = 0;
    for (const lambda of LS) for (const accept of AS) for (const burst of DS) {
        if (lambda <= accept) continue;
        for (let i = 1; i < LAB.BACKLOGS.length; i++) {
            const small = at({ lambda, accept, burst, backlog: LAB.BACKLOGS[i - 1] });
            const big = at({ lambda, accept, burst, backlog: LAB.BACKLOGS[i] });
            if (big.dropped > small.dropped + 1e-9) fail.push(`불변식⑤ backlog 를 키웠는데 드롭이 늘었다 — λ=${lambda} A=${accept} D=${burst}`);
            else if (big.queueWait < small.queueWait - 1e-9) fail.push(`불변식⑤ backlog 를 키웠는데 큐 대기가 줄었다 — λ=${lambda} A=${accept} D=${burst}`);
            else checked++;
        }
    }
    ok(`불변식⑤ 전수 ${checked}조합`, checked > 300, true);
}

/* ⑥ RST 를 켜면 클라이언트 지연이 언제나 0 이다 — 버려지는 수는 안 바뀐다 */
{
    let checked = 0;
    for (const lambda of LS) for (const burst of DS) {
        const off = at({ lambda, burst, abort: false }), on = at({ lambda, burst, abort: true });
        if (on.clientWait !== 0) fail.push(`불변식⑥ RST 인데 지연이 ${on.clientWait}`);
        else if (on.dropped !== off.dropped) fail.push(`불변식⑥ RST 가 드롭 수를 바꿨다`);
        else checked++;
    }
    ok(`불변식⑥ 전수 ${checked}조합`, checked, LS.length * DS.length);
}

/* ⑦ 몰리는 시간이 길수록 클라이언트 지연이 줄지 않는다 (단조) */
{
    let prev = -1, mono = true;
    for (const burst of [0, 1, 2, 3, 4, 5, 8, 16, 32, 63, 70]) {
        const v = at({ burst }).clientWait;
        if (v < prev) mono = false;
        prev = v;
    }
    ok('불변식⑦ 버스트가 길수록 지연이 줄지 않는다', mono, true);
}

/* ── 4. 시나리오가 본문과 같은 설정을 밟나 ───────────────── */
{
    const want = [
        { lambda: 400, accept: 500, backlog: 128, burst: 5, abort: false },
        { lambda: 2000, accept: 500, backlog: 128, burst: 5, abort: false },
        { lambda: 2000, accept: 500, backlog: 128, burst: 2, abort: false },
        { lambda: 2000, accept: 500, backlog: 128, burst: 4, abort: false },
        { lambda: 2000, accept: 500, backlog: 4096, burst: 5, abort: false },
        { lambda: 2000, accept: 500, backlog: 128, burst: 5, abort: true },
        { lambda: 2000, accept: 500, backlog: 128, burst: 70, abort: false }
    ];
    ok('시나리오 단계 수', LAB.scene.length, want.length);
    want.forEach((w, i) => ok(`시나리오 ${i + 1} 설정`, JSON.stringify(LAB.scene[i]), JSON.stringify(w)));
    want.forEach((w, i) => ok(`시나리오 ${i + 1} backlog 가 손잡이 위에 있다`, LAB.BACKLOGS.includes(w.backlog), true));
}

/* ── 5. 렌더된 문자열이 실제로 그 수치를 담고 있나 ────────── */
{
    LAB.set({ lambda: 2000, accept: 500, backlog: 128, burst: 5, abort: false });
    const sides = r.doc.cache.get('#sides').innerHTML;
    ok('표에 애플리케이션이 본 0건이 있다', /0/.test(sides), true);
    ok('표에 커널이 버린 7,372 가 있다', sides.includes('7,372'), true);
    ok('미터에 7,372 가 있다', r.doc.cache.get('#meters').innerHTML.includes('7,372'), true);
    ok('판정이 애플리케이션 0건을 짚는다', r.doc.cache.get('#verdict').innerHTML.includes('7,372'), true);
    ok('계단에 성공 칸이 하나 있다',
        (r.doc.cache.get('#stair').innerHTML.match(/class="st hit"/g) || []).length, 1);

    LAB.set({ burst: 70 });
    ok('70초면 죽은 칸이 표시된다', r.doc.cache.get('#stair').innerHTML.includes('st dead'), true);
    ok('70초면 성공 칸이 없다',
        (r.doc.cache.get('#stair').innerHTML.match(/class="st hit"/g) || []).length, 0);

    LAB.set({ lambda: 400, accept: 500, backlog: 128, burst: 5, abort: false });   /* 첫 화면으로 */
}

console.log(fail.length ? '' : `단언 ${pass}건 — 전부 통과`);
for (const f of fail) console.error('실패  ' + f);
if (fail.length) console.error(`\n통과 ${pass}건 · 실패 ${fail.length}건`);
process.exit(fail.length ? 1 : 0);
