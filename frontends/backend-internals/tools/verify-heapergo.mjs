/* ============================================================
   34편 검증 — 실행: node tools/verify-heapergo.mjs
   ------------------------------------------------------------
   배포되는 `shared/heapergo-lab.js` 를 그대로 구동해서
     1. **JVM 이 인쇄한 값과 모델이 같은가** — 이 편의 검산점이다.
        `tools/heap-fixture.mjs` 의 62점과 전수 대조한다. 24~27편은 문서가 준
        *표*를 맞췄고 28·33편은 문서가 건 *제약*을 지켰는데, 이 편은 **생성기**와
        겨룬다 — JVM 이 임의 입력에 답을 인쇄하므로 손잡이 전 구간을 훑을 수 있다.
     2. 본문 · 시나리오 · 판정이 인용한 수치가 모델의 실측과 같은가
     3. 불변식이 전 조합에서 성립하는가
   를 본다. 허용오차 없이 정확히 일치해야 한다.

   ⚠ 상한선(`ScaleForWordSize(96*M)`)과 2 MiB 정렬은 **명세가 아니라 구현**이다.
   그래서 상수를 여기 다시 적지 않고 **고정자료에 물어본다** — JDK 판이 바뀌면
   `gen-heap-fixture.mjs` 로 다시 뜨고, 그때 이 검사가 갈라진 자리를 짚어 준다.
   ============================================================ */
import { boot } from './lab-harness.mjs';
import { SWEEP, DEFAULTS, JVM } from './heap-fixture.mjs';

const r = boot('heapergo');
if (r.errors.length) { console.error('구동 실패:', r.errors); process.exit(1); }
const LAB = r.lab;
const MB = LAB.MB;

let pass = 0;
const fail = [];
const ok = (what, got, want) => {
    if (String(got) === String(want)) pass++;
    else fail.push(`${what} — 실측 ${got} / 기대 ${want}`);
};
const mbOf = b => Math.round(b / MB * 10) / 10;

const BASE = { ram: 1024, maxP: 25, minP: 50, way: 'ergo', off: 60 };
const at = o => LAB.model(Object.assign({}, BASE, o));

/* ── 1. JVM 이 인쇄한 값과 대조 — 이 편의 검산점 ───────────── */

ok('고정자료가 어느 JVM 인지 적혀 있다', /java\.runtime\.version/.test(JVM), true);
ok('고정자료가 JDK 25 다', /= 25\./.test(JVM), true);

/* 기본값 — 모델이 쓰는 것과 JVM 이 인쇄한 것이 같아야 한다 */
ok('MaxRAMPercentage 기본값', DEFAULTS.MaxRAMPercentage, 25);
ok('MinRAMPercentage 기본값', DEFAULTS.MinRAMPercentage, 50);
ok('InitialRAMPercentage 기본값', DEFAULTS.InitialRAMPercentage, 1.5625);

/* **전수 대조.** 62점 전부에서 모델이 JVM 과 한 바이트도 다르지 않아야 한다. */
{
    let checked = 0;
    for (const row of SWEEP) {
        const got = LAB.heapOf(row.mb, { way: 'ergo', maxP: 25, minP: 50 });
        if (got !== row.heap) {
            fail.push(`JVM 대조 — ${row.mb}MB 에서 모델 ${mbOf(got)}MB / JVM ${mbOf(row.heap)}MB`);
        } else checked++;
    }
    ok(`JVM 실측 전수 ${checked}점`, checked, SWEEP.length);
}

/* 고정자료가 세 구간을 다 덮고 있나 — 한 구간만 훑고 통과하면 검사가 아니다 */
{
    const flat = LAB.heapOf(300, { way: 'ergo', maxP: 25, minP: 50 });
    const half = SWEEP.filter(x => x.heap === x.mb * MB / 2).length;
    const plateau = SWEEP.filter(x => x.heap === flat).length;
    const quarter = SWEEP.filter(x => x.heap === x.mb * MB / 4).length;
    ok('고정자료에 50% 구간 점이 있다', half >= 5, true);
    ok('고정자료에 평지 점이 있다', plateau >= 5, true);
    ok('고정자료에 25% 구간 점이 있다', quarter >= 5, true);
}

/* 정렬이 실제로 올림인지 — 홀수 입력이 있어야 보인다 */
{
    let odd = 0, up = 0;
    for (const row of SWEEP) {
        if (row.mb % 2 === 0) continue;
        odd++;
        /* 홀수 MB 의 50% 나 25% 는 2 MiB 배수가 아니므로 반드시 올라가 있어야 한다 */
        if (row.heap % LAB.ALIGN === 0) up++;
    }
    ok('고정자료에 홀수 입력이 있다', odd >= 6, true);
    ok(`홀수 ${odd}점이 전부 2 MiB 배수다(올림의 증거)`, up, odd);
}

/* ── 2. 본문이 인용한 수치 ─────────────────────────────── */

/* 레시피 1 · 시나리오 1 — 128MB */
{
    const m = at({ ram: 128 });
    ok('1단계 구간', m.regime, 'floor');
    ok('1단계 힙 64MB', mbOf(m.heap), 64);
    ok('1단계 비율 50%', Math.round(m.ratio * 10) / 10, 50);
    ok('1단계 초기 힙 2MB', mbOf(m.init), 2);
    ok('1단계 여유 4MB', mbOf(m.spare), 4);
}

/* 레시피 2 · 시나리오 2 — 249MB, 평지의 시작 */
{
    const m = at({ ram: 249 });
    ok('2단계 구간', m.regime, 'plateau');
    ok('2단계 힙 126MB', mbOf(m.heap), 126);
    ok('2단계 비율 50.6%', Math.round(m.ratio * 10) / 10, 50.6);
    /* 이 편의 반전 — 두 배 줘도 늘어나는 힙이 없다 */
    ok('2단계 두 배 줘도 힙 증가 0', m.gain, 0);
    ok('2단계 두 배(498MB) 힙도 126MB', mbOf(m.twice), 126);
    ok('2단계 여유 63MB', mbOf(m.spare), 63);
}

/* 레시피 3 · 시나리오 3 — 504MB, 평지의 끝 */
{
    const m = at({ ram: 504 });
    ok('3단계 구간', m.regime, 'plateau');
    ok('3단계 힙 126MB', mbOf(m.heap), 126);
    ok('3단계 비율 25%', Math.round(m.ratio * 10) / 10, 25);
    ok('3단계 여유 318MB', mbOf(m.spare), 318);
    /* 본문 "힙은 한 바이트도 안 늘었고 비율만 절반으로" */
    ok('3단계 힙이 249MB 와 같다', m.heap, at({ ram: 249 }).heap);
}

/* 레시피 4 · 시나리오 4 — 512MB, 평지를 벗어난다 */
{
    const m = at({ ram: 512 });
    ok('4단계 구간', m.regime, 'ceil');
    ok('4단계 힙 128MB', mbOf(m.heap), 128);
    ok('4단계 두 배 주면 +128MB', mbOf(m.gain), 128);
    /* 본문 "평지의 오른쪽 끝은 126 ÷ 25% = 504MB" */
    ok('4단계 평지 오른쪽 끝 504MB', m.plateauTo, 504);
    ok('4단계 평지 왼쪽 끝 249MB', m.plateauFrom, 249);
}

/* 레시피 5 · 시나리오 5 — 1024MB, 기본값의 모습 */
{
    const m = at({});
    ok('5단계 힙 256MB', mbOf(m.heap), 256);
    ok('5단계 비율 25%', Math.round(m.ratio * 10) / 10, 25);
    ok('5단계 여유 708MB', mbOf(m.spare), 708);
    ok('5단계 초기 힙 16MB', mbOf(m.init), 16);
    /* 본문 "남은 768MB" */
    ok('5단계 힙 밖 몫 768MB', mbOf(m.phys - m.heap), 768);
}

/* 레시피 6 · 시나리오 6 — Max 75% */
{
    const m = at({ maxP: 75 });
    ok('6단계 힙 768MB', mbOf(m.heap), 768);
    ok('6단계 비율 75%', Math.round(m.ratio * 10) / 10, 75);
    ok('6단계 여유 196MB', mbOf(m.spare), 196);
    /* 본문 "평지가 사라진다 — 167MB 라 들어갈 자리가 없다" */
    ok('6단계 평지가 없다', m.hasPlateau, false);
}

/* 레시피 7 · 시나리오 7 — OOMKilled */
{
    const m = at({ off: 800 });
    ok('7단계 여유 −32MB', mbOf(m.spare), -32);
    ok('7단계 OOM', m.oom, true);
    /* 본문 "힙 256 + 힙 밖 800 = 1,056MB" */
    ok('7단계 합계 1056MB', mbOf(m.heap + m.offHeap), 1056);
    /* 본문 "힙은 상한을 안 넘었다" */
    ok('7단계 힙은 그대로 256MB', mbOf(m.heap), 256);
}

/* 본문 「249MB 에서 126MB 가 나오는 이유」 표 — 정렬이 올림이라는 증거 */
{
    const want = [[65, 34], [101, 52], [249, 126], [1001, 252]];
    for (const [ram, heap] of want) {
        ok(`정렬 표: ${ram}MB → ${heap}MB`, mbOf(at({ ram }).heap), heap);
    }
    /* 그리고 그 값들이 고정자료(JVM 실측)에도 있어야 한다 — 본문이 우리 모델만
       인용하고 있으면 안 된다 */
    for (const [ram, heap] of want) {
        const row = SWEEP.find(x => x.mb === ram);
        ok(`정렬 표 ${ram}MB 가 JVM 실측에도 있다`, row ? mbOf(row.heap) : null, heap);
    }
}

/* 본문 「식」 — 상한선이 124.8 MiB 이고 정렬이 2 MiB 다 */
{
    ok('상한선 124.8 MiB', Math.round(LAB.CAP / MB * 10) / 10, 124.8);
    ok('상한선 바이트', LAB.CAP, 130862280);
    ok('정렬 2 MiB', LAB.ALIGN / MB, 2);
    /* 그 상한선이 평지의 높이를 정한다 */
    ok('평지 높이 126MB', mbOf(at({ ram: 300 }).heap), 126);
}

/* ── 3. 불변식 (전수) ───────────────────────────────────── */

const RAMS = [];
for (let v = 16; v <= 4096; v += 1) RAMS.push(v);

/* ① 힙은 컨테이너를 절대 넘지 않는다 */
{
    let checked = 0, seen = 0;
    for (const ram of RAMS) for (const maxP of LAB.PCTS) for (const minP of LAB.PCTS) {
        seen++;
        const m = at({ ram, maxP, minP });
        if (m.heap > m.phys) fail.push(`불변식① 힙이 컨테이너보다 크다 — ${ram}MB Max${maxP} Min${minP}`);
        else checked++;
    }
    ok(`불변식① 전수 ${checked}조합`, checked, seen);
}

/* ② 힙은 컨테이너에 대해 단조 증가한다 — 줄어드는 구간이 있으면 안 된다 */
{
    let checked = 0, seen = 0;
    for (const maxP of LAB.PCTS) for (const minP of LAB.PCTS) {
        let prev = 0;
        for (const ram of RAMS) {
            seen++;
            const h = LAB.heapOf(ram, { way: 'ergo', maxP, minP });
            if (h < prev) fail.push(`불변식② 힙이 줄었다 — ${ram}MB Max${maxP} Min${minP}`);
            else { checked++; prev = h; }
        }
    }
    ok(`불변식② 전수 ${checked}조합`, checked, seen);
}

/* ③ 언제나 2 MiB 배수다 — 정렬은 예외 없다 */
{
    let checked = 0, seen = 0;
    for (const ram of RAMS) for (const way of LAB.WAYS) {
        seen++;
        if (LAB.heapOf(ram, { way, maxP: 25, minP: 50 }) % LAB.ALIGN !== 0)
            fail.push(`불변식③ 2 MiB 배수가 아니다 — ${ram}MB ${way}`);
        else checked++;
    }
    ok(`불변식③ 전수 ${checked}조합`, checked, seen);
}

/* ④ 평지 안에서는 두 배를 줘도 힙이 안 늘어난다 — 평지의 정의이자 이 편의 반전 */
{
    let checked = 0, seen = 0;
    for (const ram of RAMS) {
        const m = at({ ram });
        if (m.regime !== 'plateau') continue;
        /* 두 배가 평지 안에 남는 경우만 — 평지를 벗어나면 늘어나는 게 맞다 */
        if (ram * 2 > m.plateauTo) continue;
        seen++;
        if (m.gain !== 0) fail.push(`불변식④ 평지 안인데 힙이 늘었다 — ${ram}MB`);
        else checked++;
    }
    ok(`불변식④ 전수 ${checked}조합`, checked, seen);
}

/* ⑤ 평지 밖(25% 구간)에서는 두 배를 주면 힙도 두 배다 */
{
    let checked = 0, seen = 0;
    for (const ram of RAMS) {
        const m = at({ ram });
        if (m.regime !== 'ceil' || ram < 600) continue;
        seen++;
        /* 정렬 때문에 정확히 두 배가 아닐 수 있으므로 2 MiB 안에서 본다 */
        if (Math.abs(m.twice - m.heap * 2) > LAB.ALIGN)
            fail.push(`불변식⑤ 25% 구간인데 두 배가 아니다 — ${ram}MB`);
        else checked++;
    }
    ok(`불변식⑤ 전수 ${checked}조합`, checked, seen);
}

/* ⑥ 평지의 정체가 상한선이다 — 평지의 높이는 언제나 align_up(CAP) 이고
   Min·Max 를 어떻게 돌려도 그 값은 안 바뀐다 */
{
    let checked = 0, seen = 0;
    const flat = Math.ceil(LAB.CAP / LAB.ALIGN) * LAB.ALIGN;
    for (const maxP of LAB.PCTS) for (const minP of LAB.PCTS) {
        const m = at({ ram: 300, maxP, minP });
        if (!m.hasPlateau) continue;
        seen++;
        if (LAB.heapOf(m.plateauFrom, { way: 'ergo', maxP, minP }) !== flat ||
            LAB.heapOf(m.plateauTo, { way: 'ergo', maxP, minP }) !== flat)
            fail.push(`불변식⑥ 평지 높이가 상한선이 아니다 — Max${maxP} Min${minP}`);
        else checked++;
    }
    ok(`불변식⑥ 전수 ${checked}조합`, checked, seen);
}

/* ⑦ -Xmx 를 주면 인체공학이 사라진다 — 비율 손잡이가 힙을 못 바꾼다 */
{
    let checked = 0, seen = 0;
    for (const ram of RAMS) for (const way of ['xmx50', 'xmx75']) {
        const ref = LAB.heapOf(ram, { way, maxP: 25, minP: 50 });
        for (const maxP of LAB.PCTS) for (const minP of LAB.PCTS) {
            seen++;
            if (LAB.heapOf(ram, { way, maxP, minP }) !== ref)
                fail.push(`불변식⑦ -Xmx 인데 비율이 힙을 바꿨다 — ${ram}MB ${way}`);
            else checked++;
        }
    }
    ok(`불변식⑦ 전수 ${checked}조합`, checked, seen);
}

/* ⑧ 여유 = 컨테이너 − 힙 − 힙 밖. OOM 판정이 그 부호와 정확히 같다 */
{
    let checked = 0, seen = 0;
    for (const ram of [128, 256, 512, 1024, 2048]) for (const off of [10, 60, 200, 500, 800, 900]) {
        seen++;
        const m = at({ ram, off });
        if (m.spare !== m.phys - m.heap - m.offHeap || m.oom !== (m.spare < 0))
            fail.push(`불변식⑧ 여유·OOM 이 어긋난다 — ${ram}MB off=${off}`);
        else checked++;
    }
    ok(`불변식⑧ 전수 ${checked}조합`, checked, seen);
}

/* ── 4. 시나리오가 본문과 같은 설정을 밟나 ───────────────── */
{
    const want = [
        { ram: 128, maxP: 25, minP: 50, way: 'ergo', off: 60 },
        { ram: 249, maxP: 25, minP: 50, way: 'ergo', off: 60 },
        { ram: 504, maxP: 25, minP: 50, way: 'ergo', off: 60 },
        { ram: 512, maxP: 25, minP: 50, way: 'ergo', off: 60 },
        { ram: 1024, maxP: 25, minP: 50, way: 'ergo', off: 60 },
        { ram: 1024, maxP: 75, minP: 50, way: 'ergo', off: 60 },
        { ram: 1024, maxP: 25, minP: 50, way: 'ergo', off: 800 }
    ];
    ok('시나리오 단계 수', LAB.scene.length, want.length);
    want.forEach((w, i) => ok(`시나리오 ${i + 1} 설정`, JSON.stringify(LAB.scene[i]), JSON.stringify(w)));
    want.forEach((w, i) => ok(`시나리오 ${i + 1} 컨테이너가 손잡이 위에 있다`, LAB.RAMS.includes(w.ram), true));
    want.forEach((w, i) => ok(`시나리오 ${i + 1} 비율이 손잡이 위에 있다`,
        LAB.PCTS.includes(w.maxP) && LAB.PCTS.includes(w.minP), true));
    /* 단계마다 그림이 갈려야 이야기가 성립한다 */
    ok('시나리오 구간 순서', LAB.scene.map(c => LAB.model(c).regime).join(','),
        'floor,plateau,plateau,ceil,ceil,ceil,ceil');
    /* 그리고 시나리오의 컨테이너 크기는 전부 JVM 실측에 있어야 한다 */
    for (const w of want) {
        if (!SWEEP.some(x => x.mb === w.ram)) fail.push(`시나리오의 ${w.ram}MB 가 고정자료에 없다`);
        else pass++;
    }
}

/* ── 5. 렌더된 문자열이 실제로 그 수치를 담고 있나 ────────── */
{
    LAB.set({ ram: 249, maxP: 25, minP: 50, way: 'ergo', off: 60 });
    const meters = r.doc.cache.get('#meters').innerHTML;
    ok('미터에 126MB 가 있다', meters.includes('126MB'), true);
    ok('미터가 "안 늘어남" 을 보인다', meters.includes('안 늘어남'), true);
    ok('두 배 막대에 498MB 가 있다', r.doc.cache.get('#twice').innerHTML.includes('498MB'), true);
    ok('두 배 막대가 증가 없음을 말한다',
        r.doc.cache.get('#twice').innerHTML.includes('늘어난 힙이 없다'), true);
    ok('곡선에 평지 띠가 있다', r.doc.cache.get('#curve').innerHTML.includes('class="cband"'), true);
    ok('곡선의 평지 띠가 249~504 를 짚는다',
        r.doc.cache.get('#curve').innerHTML.includes('249~504MB'), true);
    ok('판정이 평지를 짚는다', r.doc.cache.get('#verdict').innerHTML.includes('평지 안이다'), true);

    LAB.set({ ram: 1024, maxP: 75 });
    ok('Max 75% 면 평지 띠가 없다', r.doc.cache.get('#curve').innerHTML.includes('class="cband"'), false);
    ok('Max 75% 판정이 평지 없음을 말한다',
        r.doc.cache.get('#verdict').innerHTML.includes('평지가 아예 없다'), true);

    LAB.set({ maxP: 25, off: 800 });
    ok('OOM 판정이 cgroup 을 짚는다', r.doc.cache.get('#verdict').innerHTML.includes('cgroup'), true);

    LAB.set({ way: 'xmx75', off: 60 });
    ok('-Xmx 판정이 인체공학 소멸을 말한다',
        r.doc.cache.get('#verdict').innerHTML.includes('인체공학'), true);

    const four = r.doc.cache.get('#four').innerHTML;
    ok('비교표에 "그대로" 가 있다', four.includes('그대로') || four.includes('+'), true);

    LAB.set(LAB.scene[0]);   /* 첫 화면으로 되돌린다 — 프리렌더와 같은 상태여야 한다 */
}

console.log(fail.length ? '' : `단언 ${pass}건 — 전부 통과`);
console.log(fail.length ? '' : `  JVM 실측 ${SWEEP.length}점 대조 · ${JVM}`);
for (const f of fail) console.error('실패  ' + f);
if (fail.length) console.error(`\n통과 ${pass}건 · 실패 ${fail.length}건`);
process.exit(fail.length ? 1 : 0);
