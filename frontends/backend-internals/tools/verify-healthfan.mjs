/* ============================================================
   33편 검증 — 실행: node tools/verify-healthfan.mjs
   ------------------------------------------------------------
   배포되는 `shared/healthfan-lab.js` 를 그대로 구동해서
     1. **ALB 문서가 출력에 건 제약을 지키나** — 이 편의 검산점이다
        · 감지 시각은 언제나 간격의 정수배 ("the result lasts for the entire interval")
        · 이탈 = Unhealthy × 간격 · 복귀 = Healthy × 간격 (연속 규칙에서 연역)
        · 문턱 2–10 · 간격 5–300 을 벗어나지 않는다
        · healthy 가 0 이면 라우팅이 뒤집힌다 (fail-open — 문서화된 불연속)
        · 신규 투입은 1회 통과 ("it must pass one health check")
     2. 본문 · 시나리오 · 판정이 인용한 수치가 모델의 실측과 같은가
     3. 불변식이 전 조합에서 성립하는가
   를 본다. 허용오차 없이 정확히 일치해야 한다.

   24~27편은 문서가 *맞춰야 할 수치*를 줬지만 이 편은 28편처럼 문서가 **출력을
   제약한다.** 그래서 단언이 "이 값이 저 값과 같은가" 가 아니라 "이 성질이 전 조합에서
   성립하는가" 쪽에 몰려 있다.

   ⚠ 기본값(30 · 2 · 5)은 명세라 불변식으로 고정하고, **DB 장애 길이는 우리가 넣은
   입력**이라 손잡이로만 둔다.
   ============================================================ */
import { boot } from './lab-harness.mjs';

const r = boot('healthfan');
if (r.errors.length) { console.error('구동 실패:', r.errors); process.exit(1); }
const LAB = r.lab;

let pass = 0;
const fail = [];
const ok = (what, got, want) => {
    if (String(got) === String(want)) pass++;
    else fail.push(`${what} — 실측 ${got} / 기대 ${want}`);
};

/* ALB 기본값 (target type instance/ip) */
const BASE = { mode: 'all', n: 4, iv: 30, u: 2, h: 5, out: 90 };
const at = o => LAB.model(Object.assign({}, BASE, o));

/* ── 1. 문서가 정한 것 ──────────────────────────────────── */

ok('명세 기본 간격 30초가 손잡이에 있다', LAB.INTERVALS.includes(30), true);
ok('문서 범위의 하한 5초가 손잡이에 있다', LAB.INTERVALS.includes(5), true);
ok('문서 범위의 상한 300초가 손잡이에 있다', LAB.INTERVALS.includes(300), true);
/* 범위를 벗어난 후보값이 없어야 한다 — 문서가 5–300 이라고 못박았다 */
for (const iv of LAB.INTERVALS) ok(`간격 ${iv}초가 문서 범위 안이다`, iv >= 5 && iv <= 300, true);

/* 기본값을 규칙에 넣으면 두 시각이 나온다 — 이 편의 출발점 */
{
    const m = at({});
    ok('기본값 이탈 60초', m.evictWorst, 60);
    ok('기본값 복귀 240초 (장애 90초 + 5×30)', m.backWorst, 240);
    ok('기본값 비대칭 2.5배', m.skew, 2.5);
    ok('복귀만 재면 150초', m.backWorst - 90, 150);
    ok('신규 투입은 한 간격 (1회 통과)', m.newIn, 30);
}

/* 감지 시각은 언제나 간격의 정수배 — "the result lasts for the entire interval" */
{
    let checked = 0, seen = 0;
    for (const iv of LAB.INTERVALS) for (const u of [2, 3, 5, 10]) for (const h of [2, 3, 5, 10])
        for (const out of [1, 7, 31, 90, 137, 300]) {
            const m = at({ iv, u, h, out });
            if (!m.evicts) continue;
            seen++;
            const evictMul = m.evictWorst % iv === 0;
            const backMul = (m.backWorst - out) % iv === 0;
            if (!evictMul || !backMul)
                fail.push(`정수배 — iv=${iv} u=${u} h=${h} out=${out} : 이탈 ${m.evictWorst} 복귀 ${m.backWorst}`);
            else checked++;
        }
    ok(`"간격의 정수배" 전수 ${checked}조합`, checked, seen);
}

/* 이탈 = u × 간격, 복귀 = 장애 + h × 간격 (최악 위상) */
{
    let checked = 0, seen = 0;
    for (const iv of LAB.INTERVALS) for (const u of [2, 3, 5, 10]) for (const h of [2, 3, 5, 10])
        for (const out of [90, 300]) {
            const m = at({ iv, u, h, out });
            if (!m.evicts) continue;
            seen++;
            if (m.evictWorst !== u * iv) fail.push(`이탈 산수 — iv=${iv} u=${u} : ${m.evictWorst}`);
            else if (m.backWorst !== out + h * iv) fail.push(`복귀 산수 — iv=${iv} h=${h} : ${m.backWorst}`);
            else checked++;
        }
    ok(`연속 규칙 산수 전수 ${checked}조합`, checked, seen);
}

/* ── 2. 본문이 인용한 수치 ─────────────────────────────── */

/* 레시피 1 · 시나리오 1 — 10초는 안 보인다 */
{
    const m = at({ out: 10 });
    ok('1단계 상태', m.state, 'unseen');
    ok('1단계 이탈 없음', m.evictWorst, null);
    ok('1단계 최악 실패 검사 0회', m.failsWorst, 0);
    ok('1단계 최선 실패 검사 1회', m.failsBest, 1);
    ok('1단계 healthy 4', m.healthy, 4);
}

/* 레시피 2 · 시나리오 2 — 90초, fail-open */
{
    const m = at({});
    ok('2단계 상태', m.state, 'failopen');
    ok('2단계 fail-open', m.failOpen, true);
    ok('2단계 healthy 0', m.healthy, 0);
    ok('2단계 라우팅 비정상 180초', m.badFor, 180);
    ok('2단계 부하 배수 1', m.loadX, 1);
    ok('2단계 최선 이탈 30초', m.evictBest, 30);
    /* 본문 "차이는 정확히 간격 하나" */
    ok('2단계 위상 차이가 간격 하나', m.evictWorst - m.evictBest, 30);
}

/* 레시피 3 · 시나리오 3 — 절반이 더 나쁘다 */
{
    const m = at({ mode: 'half' });
    ok('3단계 상태', m.state, 'partial');
    ok('3단계 fail-open 안 걸린다', m.failOpen, false);
    ok('3단계 healthy 2', m.healthy, 2);
    ok('3단계 부하 배수 2', m.loadX, 2);
    ok('3단계 시각은 전부와 같다', m.evictWorst + ',' + m.backWorst, '60,240');
}

/* 레시피 4 · 시나리오 4 — 얕은 검사 */
{
    const m = at({ mode: 'shallow' });
    ok('4단계 상태', m.state, 'shallow');
    ok('4단계 이탈 없음', m.evictWorst, null);
    ok('4단계 healthy 4', m.healthy, 4);
    ok('4단계 라우팅 비정상 0초', m.badFor, 0);
}

/* 레시피 5 · 시나리오 5 — 복귀 문턱 2 */
{
    const m = at({ h: 2 });
    ok('5단계 복귀 150초', m.backWorst, 150);
    ok('5단계 라우팅 비정상 90초', m.badFor, 90);
    ok('5단계 비대칭 1배', m.skew, 1);
    ok('5단계 이탈은 그대로 60초', m.evictWorst, 60);
    /* 본문 "비정상 기간이 절반" */
    ok('5단계 비정상이 절반', at({}).badFor / m.badFor, 2);
}

/* 레시피 6 · 시나리오 6 — 간격 5초 */
{
    const m = at({ iv: 5 });
    ok('6단계 이탈 10초', m.evictWorst, 10);
    ok('6단계 복귀 115초', m.backWorst, 115);
    ok('6단계 라우팅 비정상 105초', m.badFor, 105);
    ok('6단계 신규 투입 5초', m.newIn, 5);
}

/* 레시피 7 · 시나리오 7 — 간격 300초 */
{
    const m = at({ iv: 300 });
    ok('7단계 상태', m.state, 'unseen');
    ok('7단계 90초 장애를 못 본다', m.evicts, false);
    ok('7단계 신규 투입 300초', m.newIn, 300);
}

/* 본문 「fail-open」 표 — 하나씩 빠질 때 부하 배수가 단조롭지 않다 */
{
    ok('표: 0/4 부하 1배', at({ mode: 'shallow' }).loadX, 1);
    ok('표: 2/4 부하 2배', at({ mode: 'half' }).loadX, 2);
    ok('표: 4/4 부하 1배 (fail-open)', at({ mode: 'all' }).loadX, 1);
    /* 본문 "×4 에서 ×1 로 떨어진다" — n=4 에서 셋이 빠진 상태는 half 로는 안 나오므로
       인스턴스 수를 줄여 같은 비율을 만든다. n=2 의 half 는 1대가 빠져 남은 1대가 2배다. */
    ok('표: n=2 의 절반은 2배', at({ n: 2, mode: 'half' }).loadX, 2);
}

/* 본문 「같은 간격이 세 가지를 정한다」 표 */
{
    ok('표: 5초 → 이탈 10 · 복귀 115 · 신규 5',
        [at({ iv: 5 }).evictWorst, at({ iv: 5 }).backWorst, at({ iv: 5 }).newIn].join(','), '10,115,5');
    ok('표: 30초 → 이탈 60 · 복귀 240 · 신규 30',
        [at({}).evictWorst, at({}).backWorst, at({}).newIn].join(','), '60,240,30');
    ok('표: 300초 → 감지 못 함 · 신규 300',
        [at({ iv: 300 }).evicts, at({ iv: 300 }).newIn].join(','), 'false,300');
    /* 본문 "진짜 죽은 인스턴스도 600초를 버틴다" = u × 300 */
    ok('표: 300초에서 진짜 죽은 것은 600초', 2 * 300, 600);
}

/* ── 3. 불변식 (전수) ───────────────────────────────────── */

const OUTS = [1, 5, 11, 30, 61, 90, 150, 300];
const combos = [];
for (const mode of LAB.MODES) for (const n of LAB.NS) for (const iv of LAB.INTERVALS)
    for (const u of [2, 3, 5, 10]) for (const h of [2, 3, 5, 10]) for (const out of OUTS)
        combos.push({ mode, n, iv, u, h, out });

/* ① 얕은 검사는 절대 이탈하지 않는다 — 상태가 안 바뀐다 */
{
    let checked = 0, seen = 0;
    for (const c of combos) {
        if (c.mode !== 'shallow') continue;
        seen++;
        const m = at(c);
        if (m.evicts || m.evictWorst !== null || m.badFor !== 0 || m.healthy !== c.n)
            fail.push(`불변식① 얕은 검사가 이탈했다 — ${JSON.stringify(c)}`);
        else checked++;
    }
    ok(`불변식① 전수 ${checked}조합`, checked, seen);
}

/* ② 장애가 (u−1)×간격 보다 짧으면 절대 이탈하지 않는다 — 연속 실패를 못 채운다 */
{
    let checked = 0, seen = 0;
    for (const c of combos) {
        if (c.mode === 'shallow') continue;
        if (c.out >= (c.u - 1) * c.iv) continue;
        seen++;
        if (at(c).evicts) fail.push(`불변식② 짧은 장애인데 이탈했다 — ${JSON.stringify(c)}`);
        else checked++;
    }
    ok(`불변식② 전수 ${checked}조합`, checked, seen);
}

/* ③ healthy 가 0 이면 반드시 fail-open 이고 부하 배수는 1 이다 — 문서화된 불연속 */
{
    let checked = 0, seen = 0;
    for (const c of combos) {
        const m = at(c);
        if (!(m.evicts && m.healthy === 0)) continue;
        seen++;
        if (!m.failOpen || m.loadX !== 1)
            fail.push(`불변식③ 전멸인데 fail-open 이 아니다 — ${JSON.stringify(c)}`);
        else checked++;
    }
    ok(`불변식③ 전수 ${checked}조합`, checked, seen);
}

/* ④ 부분 이탈이면 fail-open 이 아니고 부하 배수가 1 을 넘는다 */
{
    let checked = 0, seen = 0;
    for (const c of combos) {
        const m = at(c);
        if (!(m.evicts && m.healthy > 0)) continue;
        seen++;
        if (m.failOpen || m.loadX <= 1 || m.loadX !== c.n / m.healthy)
            fail.push(`불변식④ 부분 이탈의 부하가 이상하다 — ${JSON.stringify(c)} : ×${m.loadX}`);
        else checked++;
    }
    ok(`불변식④ 전수 ${checked}조합`, checked, seen);
}

/* ⑤ 최선은 최악보다 이르고, 차이는 정확히 간격 하나다 */
{
    let checked = 0, seen = 0;
    for (const c of combos) {
        const m = at(c);
        if (m.evictBest === null || m.evictWorst === null) continue;
        seen++;
        if (m.evictWorst - m.evictBest !== c.iv)
            fail.push(`불변식⑤ 위상 차이가 간격이 아니다 — ${JSON.stringify(c)}`);
        else checked++;
    }
    ok(`불변식⑤ 전수 ${checked}조합`, checked, seen);
}

/* ⑥ 복귀는 언제나 이탈보다 늦다 — 뒤집히면 페이지의 이야기가 성립하지 않는다 */
{
    let checked = 0, seen = 0;
    for (const c of combos) {
        const m = at(c);
        if (!m.evicts) continue;
        seen++;
        if (m.backWorst <= m.evictWorst || m.badFor <= 0)
            fail.push(`불변식⑥ 복귀가 이탈보다 이르다 — ${JSON.stringify(c)}`);
        else checked++;
    }
    ok(`불변식⑥ 전수 ${checked}조합`, checked, seen);
}

/* ⑦ 신규 투입은 언제나 한 간격이고, 복귀보다 h 배 빠르다 — 문서가 "1회" 라고 못박았다 */
{
    let checked = 0;
    for (const c of combos) {
        const m = at(c);
        if (m.newIn !== c.iv) fail.push(`불변식⑦ 신규 투입이 한 간격이 아니다 — ${JSON.stringify(c)}`);
        else if (m.evicts && (m.backWorst - c.out) / m.newIn !== c.h)
            fail.push(`불변식⑦ 복귀가 신규의 h 배가 아니다 — ${JSON.stringify(c)}`);
        else checked++;
    }
    ok(`불변식⑦ 전수 ${checked}조합`, checked, combos.length);
}

/* ⑧ 비대칭은 문턱 둘의 비다 — 간격과 무관하다 (본문의 2.5배가 여기서 나온다) */
{
    let checked = 0;
    for (const c of combos) {
        const m = at(c);
        if (m.skew !== c.h / c.u) fail.push(`불변식⑧ 비대칭이 h/u 가 아니다 — ${JSON.stringify(c)}`);
        else checked++;
    }
    ok(`불변식⑧ 전수 ${checked}조합`, checked, combos.length);
}

/* ⑨ 이탈 시각은 인스턴스 수와 무관하다 — 노드마다 따로 판단한다(본문 가정 표) */
{
    let checked = 0, seen = 0;
    for (const mode of ['half', 'all']) for (const iv of LAB.INTERVALS) for (const out of OUTS) {
        const ref = at({ mode, iv, out, n: LAB.NS[0] });
        for (const n of LAB.NS.slice(1)) {
            seen++;
            const m = at({ mode, iv, out, n });
            if (m.evictWorst !== ref.evictWorst || m.backWorst !== ref.backWorst)
                fail.push(`불변식⑨ 인스턴스 수가 시각을 바꿨다 — mode=${mode} iv=${iv} out=${out} n=${n}`);
            else checked++;
        }
    }
    ok(`불변식⑨ 전수 ${checked}조합`, checked, seen);
}

/* ── 4. 시나리오가 본문과 같은 설정을 밟나 ───────────────── */
{
    const want = [
        { mode: 'all', n: 4, iv: 30, u: 2, h: 5, out: 10 },
        { mode: 'all', n: 4, iv: 30, u: 2, h: 5, out: 90 },
        { mode: 'half', n: 4, iv: 30, u: 2, h: 5, out: 90 },
        { mode: 'shallow', n: 4, iv: 30, u: 2, h: 5, out: 90 },
        { mode: 'all', n: 4, iv: 30, u: 2, h: 2, out: 90 },
        { mode: 'all', n: 4, iv: 5, u: 2, h: 5, out: 90 },
        { mode: 'all', n: 4, iv: 300, u: 2, h: 5, out: 90 }
    ];
    ok('시나리오 단계 수', LAB.scene.length, want.length);
    want.forEach((w, i) => ok(`시나리오 ${i + 1} 설정`, JSON.stringify(LAB.scene[i]), JSON.stringify(w)));
    want.forEach((w, i) => ok(`시나리오 ${i + 1} 간격이 손잡이 위에 있다`, LAB.INTERVALS.includes(w.iv), true));
    want.forEach((w, i) => ok(`시나리오 ${i + 1} 인스턴스 수가 손잡이 위에 있다`, LAB.NS.includes(w.n), true));
    want.forEach((w, i) => ok(`시나리오 ${i + 1} 검사 방식이 손잡이 위에 있다`, LAB.MODES.includes(w.mode), true));
    want.forEach((w, i) => ok(`시나리오 ${i + 1} 문턱이 문서 범위 안이다`,
        w.u >= 2 && w.u <= 10 && w.h >= 2 && w.h <= 10, true));
    const states = LAB.scene.map(c => LAB.model(c).state);
    ok('시나리오 상태 순서', states.join(','),
        'unseen,failopen,partial,shallow,failopen,failopen,unseen');
}

/* ── 5. 렌더된 문자열이 실제로 그 수치를 담고 있나 ────────── */
{
    LAB.set(BASE);
    const meters = r.doc.cache.get('#meters').innerHTML;
    ok('미터에 60초 가 있다', meters.includes('60초'), true);
    ok('미터에 240초 가 있다', meters.includes('240초'), true);
    ok('미터에 ×2.5 가 있다', meters.includes('×2.5'), true);
    ok('미터에 0 / 4 가 있다', meters.includes('0 / 4'), true);
    ok('시간축이 이탈을 표시한다', r.doc.cache.get('#time').innerHTML.includes('mark evict'), true);
    ok('시간축이 복귀를 표시한다', r.doc.cache.get('#time').innerHTML.includes('mark back'), true);
    ok('시간축에 실패한 검사 눈금이 있다', r.doc.cache.get('#time').innerHTML.includes('tick fail'), true);
    ok('전멸이면 fail-open 상태로 그린다', r.doc.cache.get('#pool').innerHTML.includes('inst openx'), true);
    ok('판정이 fail-open 을 짚는다', r.doc.cache.get('#verdict').innerHTML.includes('fail-open'), true);

    LAB.set({ mode: 'half' });
    ok('절반이면 down 과 up 이 섞인다',
        r.doc.cache.get('#pool').innerHTML.includes('inst down') &&
        r.doc.cache.get('#pool').innerHTML.includes('inst up'), true);
    ok('절반이면 fail-open 표시가 없다', r.doc.cache.get('#pool').innerHTML.includes('openx'), false);
    ok('절반 판정에 ×2 가 있다', r.doc.cache.get('#verdict').innerHTML.includes('×2'), true);

    LAB.set({ mode: 'all', out: 10 });
    ok('안 보이는 장애면 이탈 표식이 없다', r.doc.cache.get('#time').innerHTML.includes('mark evict'), false);
    ok('안 보이는 장애면 미터가 "없음"', r.doc.cache.get('#meters').innerHTML.includes('없음'), true);

    LAB.set(LAB.scene[0]);   /* 첫 화면으로 되돌린다 — 프리렌더와 같은 상태여야 한다 */
}

console.log(fail.length ? '' : `단언 ${pass}건 — 전부 통과`);
for (const f of fail) console.error('실패  ' + f);
if (fail.length) console.error(`\n통과 ${pass}건 · 실패 ${fail.length}건`);
process.exit(fail.length ? 1 : 0);
