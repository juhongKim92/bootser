/* ============================================================
   26편 검증 — 실행: node tools/verify-slowstart.mjs
   ------------------------------------------------------------
   배포되는 `shared/slowstart-lab.js` 를 그대로 구동해서
     1. **RFC 6928 의 왕복 수 표를 재현하나** — 이 편의 검산점이다
     2. 본문 · 시나리오 · 판정이 인용한 수치가 모델의 실측과 같은가
     3. 불변식이 전 조합에서 성립하는가
   를 본다. 허용오차 없이 정확히 일치해야 한다.

   1번이 이 스크립트의 존재 이유다. 착수 전 게이트에서 창의 성장 계수를 2배로
   잡았다가 이 표에 걸렸다 — 지연 ACK 때문에 1.5배다. 그 판정을 여기 고정해서
   누가 계수를 되돌리면 바로 실패하게 한다.
   ============================================================ */
import { boot } from './lab-harness.mjs';

const r = boot('slowstart');
if (r.errors.length) { console.error('구동 실패:', r.errors); process.exit(1); }
const LAB = r.lab;
const MSS = LAB.MSS;

let pass = 0;
const fail = [];
const ok = (what, got, want) => {
    if (String(got) === String(want)) pass++;
    else fail.push(`${what} — 실측 ${got} / 기대 ${want}`);
};

/* 세그먼트 수로 직접 물어보려면 바이트로 바꿔서 넣는다 */
const bySeg = (seg, o) => LAB.rounds(seg * MSS, o);

/* ── 1. RFC 6928 의 표 ───────────────────────────────────
   "With IW=10 versus IW=3, transfer completion times (in round trips)" */
{
    const TABLE = [
        { seg: 10, iw10: 1, iw3: 3 },
        { seg: 21, iw10: 2, iw3: 4 },
        { seg: 78, iw10: 4, iw3: 7 }
    ];
    for (const t of TABLE) {
        ok(`RFC 6928 — ${t.seg}세그먼트 IW10`, bySeg(t.seg, { iw: 10, dack: true }), t.iw10);
        ok(`RFC 6928 — ${t.seg}세그먼트 IW3`, bySeg(t.seg, { iw: 3, dack: true }), t.iw3);
    }
    /* 성장 계수를 2배로 되돌리면 이 표가 깨진다 — 그 사실 자체를 고정한다 */
    ok('계수 2배면 21세그먼트 IW3 이 RFC 와 어긋난다', bySeg(21, { iw: 3, dack: false }) !== 4, true);
    ok('계수 2배면 78세그먼트 IW3 이 RFC 와 어긋난다', bySeg(78, { iw: 3, dack: false }) !== 7, true);
}

/* RFC 6928 의 IW 정의 — min(10*MSS, max(2*MSS, 14600)) */
ok('IW 정의 MSS 1460', LAB.initialWindow(1460), 14600);
ok('IW 정의 MSS 1460 = 10세그먼트', LAB.initialWindow(1460) / 1460, 10);
ok('IW 정의 MSS 536', LAB.initialWindow(536), 5360);
ok('본문 — 점보 MSS 8960 이면 17,920바이트', LAB.initialWindow(8960), 17920);
ok('본문 — 그게 세그먼트 두 개다', LAB.initialWindow(8960) / 8960, 2);

/* ── 2. 본문이 인용한 수치 ─────────────────────────────── */

const BASE = { iw: 10, dack: true };
const t = (bytes, o) => LAB.time(bytes, Object.assign({ rtt: 100, reuse: false }, BASE, o || {}));

/* 레시피 1 · 시나리오 1 — 14,600 은 한 왕복 */
ok('14,600B 세그먼트 수', LAB.segs(14600), 10);
ok('14,600B 왕복', LAB.rounds(14600, BASE), 1);
ok('14,600B 총 시간', t(14600), 200);
ok('1,000B 도 같은 200ms', t(1000), 200);
ok('첫 왕복 용량 = 14,600B', LAB.capacity(1, BASE) * MSS, 14600);

/* 레시피 2 · 시나리오 2 — 한 바이트 */
ok('14,601B 세그먼트 수', LAB.segs(14601), 11);
ok('14,601B 왕복', LAB.rounds(14601, BASE), 2);
ok('14,601B 총 시간', t(14601), 300);
ok('두 번째 왕복은 세그먼트 하나', LAB.trips(14601, BASE).at(-1).sent, 1);

/* 레시피 3 · 시나리오 3 — 100KB · IW3 */
ok('100,000B 세그먼트 수', LAB.segs(100000), 69);
ok('100,000B IW3 왕복', LAB.rounds(100000, { iw: 3, dack: true }), 7);
ok('100,000B IW3 총 시간', t(100000, { iw: 3 }), 800);
ok('IW3 왕복별 세그먼트',
    LAB.trips(100000, { iw: 3, dack: true }).map(x => x.sent).join('/'), '3/4/6/9/13/19/15');
ok('본문 — 첫 세 왕복이 13세그먼트', LAB.capacity(3, { iw: 3, dack: true }), 13);
ok('본문 — 그게 전체의 19%', Math.round(13 / 69 * 100), 19);

/* 레시피 4 · 시나리오 4 — IW10 */
ok('100,000B IW10 왕복', LAB.rounds(100000, BASE), 4);
ok('100,000B IW10 총 시간', t(100000), 500);
ok('IW10 왕복별 세그먼트',
    LAB.trips(100000, BASE).map(x => x.sent).join('/'), '10/15/22/22');
ok('본문 — 커널 설정 하나로 300ms', t(100000, { iw: 3 }) - t(100000), 300);

/* 레시피 5 · 시나리오 5 — 지연 ACK 끔 */
ok('지연 ACK 끔 왕복', LAB.rounds(100000, { iw: 10, dack: false }), 3);
ok('지연 ACK 끔 총 시간', t(100000, { dack: false }), 400);
ok('지연 ACK 끔 왕복별',
    LAB.trips(100000, { iw: 10, dack: false }).map(x => x.sent).join('/'), '10/20/39');

/* 레시피 6 · 시나리오 6 — 커넥션 재사용 */
ok('재사용 총 시간', t(100000, { reuse: true }), 100);
ok('재사용은 핸드셰이크가 없다', t(100000, { reuse: true }) * 5, t(100000));

/* 레시피 7 · 시나리오 7 — 1MB */
ok('1,000,000B 세그먼트 수', LAB.segs(1000000), 685);
ok('1MB IW10 왕복', LAB.rounds(1000000, BASE), 9);
ok('1MB IW3 왕복', LAB.rounds(1000000, { iw: 3, dack: true }), 13);
ok('1MB 총 시간', t(1000000), 1000);
ok('본문 — 100KB 에서 7/4 = 1.75배',
    (LAB.rounds(100000, { iw: 3, dack: true }) / LAB.rounds(100000, BASE)).toFixed(2), '1.75');
ok('본문 — 1MB 에서 13/9 = 1.44배',
    (LAB.rounds(1000000, { iw: 3, dack: true }) / LAB.rounds(1000000, BASE)).toFixed(2), '1.44');

/* 본문 "계단 경계" 표 (IW10) */
{
    const want = [14600, 36500, 68620, 116800, 188340, 294920];
    want.forEach((v, i) => ok(`계단 경계 ${i + 1}왕복`, LAB.capacity(i + 1, BASE) * MSS, v));
}

/* 본문 — IW 별 첫 왕복 바이트 */
for (const [iw, b] of [[3, 4380], [10, 14600], [30, 43800]]) ok(`IW${iw} 첫 왕복 바이트`, iw * MSS, b);

/* ── 3. 불변식 ──────────────────────────────────────────── */

const SEGS = [];
for (let i = 1; i <= 800; i++) SEGS.push(i);

/* ① 앞 r 왕복 용량 안에 들어가고, r−1 왕복으로는 모자란다 */
{
    let checked = 0;
    for (const iw of [2, 3, 10, 30]) for (const dack of [true, false]) for (const seg of SEGS) {
        const o = { iw, dack };
        const rr = bySeg(seg, o);
        if (LAB.capacity(rr, o) < seg) fail.push(`불변식① IW${iw} dack=${dack} ${seg}세그먼트 — 용량이 모자란다`);
        else if (rr > 1 && LAB.capacity(rr - 1, o) >= seg) fail.push(`불변식① IW${iw} dack=${dack} ${seg}세그먼트 — 한 왕복 더 썼다`);
        else checked++;
    }
    ok(`불변식① 전수 ${checked}조합`, checked, 4 * 2 * SEGS.length);
}

/* ② 초기 창을 키우면 왕복이 줄거나 같다 */
{
    let checked = 0;
    for (const [small, big] of [[3, 10], [10, 30], [30, 60]]) for (const seg of SEGS) {
        if (bySeg(seg, { iw: big, dack: true }) > bySeg(seg, { iw: small, dack: true }))
            fail.push(`불변식② IW ${small}→${big} ${seg}세그먼트 에서 왕복이 늘었다`);
        else checked++;
    }
    ok(`불변식② 전수 ${checked}조합`, checked, 3 * SEGS.length);
}

/* ③ 지연 ACK 를 끄면 왕복이 줄거나 같다 */
{
    let checked = 0;
    for (const iw of [3, 10, 30]) for (const seg of SEGS) {
        if (bySeg(seg, { iw, dack: false }) > bySeg(seg, { iw, dack: true }))
            fail.push(`불변식③ IW${iw} ${seg}세그먼트 에서 ACK 를 안 묶었는데 더 걸렸다`);
        else checked++;
    }
    ok(`불변식③ 전수 ${checked}조합`, checked, 3 * SEGS.length);
}

/* ④ 왕복 수는 RTT 와 무관하다 — 대역폭도, 시간도 식에 없다 */
{
    let checked = 0;
    const want = LAB.rounds(100000, BASE);
    for (let rtt = 10; rtt <= 300; rtt += 10) {
        LAB.set({ rtt });
        if (LAB.rounds(100000, BASE) !== want) fail.push(`불변식④ RTT ${rtt} 에서 왕복 수가 바뀌었다`);
        else checked++;
        if (LAB.time(100000, Object.assign({ rtt, reuse: false }, BASE)) !== (1 + want) * rtt)
            fail.push(`불변식④ RTT ${rtt} 에서 시간이 왕복 수 × RTT 가 아니다`);
    }
    ok(`불변식④ 전수 ${checked}개 RTT`, checked, 30);
    LAB.set({ rtt: 100 });
}

/* ⑤ 계단이다 — 경계 바로 아래와 위에서 왕복이 정확히 1 차이 난다 */
{
    let checked = 0;
    for (const iw of [3, 10, 30]) for (let rr = 1; rr <= 6; rr++) {
        const o = { iw, dack: true };
        const edge = LAB.capacity(rr, o) * MSS;
        if (LAB.rounds(edge, o) !== rr) fail.push(`불변식⑤ IW${iw} ${rr}왕복 경계에서 ${LAB.rounds(edge, o)}`);
        else if (LAB.rounds(edge + 1, o) !== rr + 1) fail.push(`불변식⑤ IW${iw} ${rr}왕복 경계+1 에서 ${LAB.rounds(edge + 1, o)}`);
        else checked++;
    }
    ok(`불변식⑤ 전수 ${checked}개 경계`, checked, 18);
}

/* ── 4. 시나리오가 본문과 같은 설정을 밟나 ───────────────── */
{
    const want = [
        { iw: 10, rtt: 100, size: 14600, reuse: false, dack: true },
        { iw: 10, rtt: 100, size: 14601, reuse: false, dack: true },
        { iw: 3, rtt: 100, size: 100000, reuse: false, dack: true },
        { iw: 10, rtt: 100, size: 100000, reuse: false, dack: true },
        { iw: 10, rtt: 100, size: 100000, reuse: false, dack: false },
        { iw: 10, rtt: 100, size: 100000, reuse: true, dack: true },
        { iw: 10, rtt: 100, size: 1000000, reuse: false, dack: true }
    ];
    ok('시나리오 단계 수', LAB.scene.length, want.length);
    want.forEach((w, i) => ok(`시나리오 ${i + 1} 설정`, JSON.stringify(LAB.scene[i]), JSON.stringify(w)));
    /* 슬라이더로 고를 수 있는 크기여야 한다 */
    want.forEach((w, i) => ok(`시나리오 ${i + 1} 크기가 손잡이 위에 있다`, LAB.SIZES.includes(w.size), true));
}

/* ── 5. 렌더된 문자열이 실제로 그 수치를 담고 있나 ────────── */
{
    LAB.set({ iw: 10, rtt: 100, size: 14600, reuse: false, dack: true });
    ok('판정이 한 바이트를 짚는다', r.doc.cache.get('#verdict').innerHTML.includes('1'), true);
    ok('힌트에 정확한 바이트가 나온다', r.doc.cache.get('#hint').innerHTML.includes('14,600'), true);
    ok('계단 경계 표에 14,600 이 있다', r.doc.cache.get('#edge').innerHTML.includes('14,600'), true);
    ok('계단 경계 표에 294,920 이 있다', r.doc.cache.get('#edge').innerHTML.includes('294,920'), true);

    LAB.set({ size: 14601 });
    ok('왕복 타임라인이 두 칸이 된다',
        (r.doc.cache.get('#trip').innerHTML.match(/class="rt/g) || []).length, 3);   /* 악수 + 2왕복 */

    LAB.set({ size: 100000, reuse: true });
    ok('재사용이면 핸드셰이크 칸이 없다', r.doc.cache.get('#trip').innerHTML.includes('rt hs'), false);

    LAB.set({ iw: 10, rtt: 100, size: 14600, reuse: false, dack: true });   /* 첫 화면으로 */
}

console.log(fail.length ? '' : `단언 ${pass}건 — 전부 통과`);
for (const f of fail) console.error('실패  ' + f);
if (fail.length) console.error(`\n통과 ${pass}건 · 실패 ${fail.length}건`);
process.exit(fail.length ? 1 : 0);
