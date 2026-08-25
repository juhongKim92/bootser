/* ============================================================
   29편 검증 — 실행: node tools/verify-pagesplit.mjs
   ------------------------------------------------------------
   배포되는 `shared/pagesplit-lab.js` 를 그대로 구동해서
     1. **문서에서 연역되는 것만 계산하나** — 이 편의 검산점이다
        · `CREATE INDEX` — 순차(오른쪽 확장)는 fillfactor 까지 찬다. 기본 90
        · `nbtree/README` — 분할은 바이트를 균등 분배 → 리프는 50~100% 사이
        · 그래서 fillfactor 는 **무작위 삽입에 아무 영향이 없어야** 한다
     2. 본문 · 시나리오 · 판정이 인용한 수치가 모델의 실측과 같은가
     3. 불변식이 전 조합에서 성립하는가
   를 본다. 허용오차 없이 정확히 일치해야 한다.

   `ln 2 ≈ 69.3%` 는 고전 분석 결과이고 명세가 아니다. 그래서 **참고선**으로만 쓰고,
   불변식은 문서에서 연역되는 하한(100%)·상한(50%)에만 건다.
   ============================================================ */
import { boot } from './lab-harness.mjs';

const r = boot('pagesplit');
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

const N = 1e7;
const at = o => LAB.m(Object.assign({ rows: N, key: 8, ff: 90, random: false }, o));
const mb = b => (b / 1048576).toFixed(1);

/* ── 1. 문서에서 연역되는 것 ─────────────────────────────── */

/* 블록·헤더 상수 */
ok('블록 크기 8,192', LAB.PAGE, 8192);
ok('fillfactor 기본값이 손잡이 기본값', 90, at({}).seq.fillPct);

/* 엔트리 크기 — 튜플 헤더 8 + 키(8정렬) + 라인 포인터 4 */
ok('bigint 엔트리', LAB.perEntry(8), 20);
ok('uuid 엔트리', LAB.perEntry(16), 28);
ok('bigint 페이지 정원', LAB.perPage(8), 408);
ok('uuid 페이지 정원', LAB.perPage(16), 291);

/* `nbtree/README` — 분할은 바이트 반반이므로 리프는 50~100% 사이.
   그래서 무작위의 하한은 100% 채움, 상한은 50% 채움이다. */
ok('무작위 하한은 100% 채움', at({ random: true }).rndBest.fillPct, 100);
ok('무작위 상한은 50% 채움', at({ random: true }).rndWorst.fillPct, 50);
near('상한/순차(ff90) 비율은 1.80', at({ key: 16 }).vsSeqWorst, 1.80, 0.005);

/* ln2 는 참고선 — 하한과 상한 사이에 있어야 한다 */
{
    const m = at({ key: 16 });
    near('참고선 ln2 = 69.31%', LAB.LN2, 69.31, 0.01);
    ok('참고선이 50~100 사이', LAB.LN2 > 50 && LAB.LN2 < 100, true);
    ok('참고선 크기가 하한·상한 사이', m.rndAvg.bytes > m.rndBest.bytes && m.rndAvg.bytes < m.rndWorst.bytes, true);
}

/* **fillfactor 는 무작위 삽입에 아무 영향이 없다** — 문서가 적용 범위를 못 박았다 */
{
    let checked = 0;
    for (const key of LAB.KEYS) for (const rows of LAB.ROWS) {
        const base = at({ key, rows, ff: 90, random: true }).now.bytes;
        for (const ff of [10, 30, 50, 70, 90, 100]) {
            if (at({ key, rows, ff, random: true }).now.bytes !== base)
                fail.push(`fillfactor 가 무작위를 움직였다 — key=${key} rows=${rows} ff=${ff}`);
            else checked++;
        }
    }
    ok(`fillfactor 무관 전수 ${checked}조합`, checked, LAB.KEYS.length * LAB.ROWS.length * 6);
}

/* 반대로 순차에는 영향이 있어야 한다 (fillfactor 를 올리면 작아진다) */
{
    let mono = true, prev = Infinity;
    for (const ff of [10, 30, 50, 70, 90, 100]) {
        const v = at({ key: 16, ff, random: false }).now.bytes;
        if (v > prev) mono = false;
        prev = v;
    }
    ok('순차는 fillfactor 를 올릴수록 작아진다', mono, true);
}

/* ── 2. 본문이 인용한 수치 ─────────────────────────────── */

/* 레시피 1 — bigint 순차 기준점 */
{
    const m = at({});
    ok('bigint 순차 페이지당', m.seq.each, 367);
    ok('bigint 순차 페이지 수', m.seq.pages, 27248);
    ok('bigint 순차 크기 212.9MB', mb(m.seq.bytes), '212.9');
}

/* 레시피 2 — uuid 순차 1.41배 */
{
    const m = at({ key: 16 });
    ok('uuid 순차 페이지당', m.seq.each, 261);
    ok('uuid 순차 페이지 수', m.seq.pages, 38315);
    ok('uuid 순차 크기 299.3MB', mb(m.seq.bytes), '299.3');
    ok('키 폭만의 효과 1.41배', m.widthOnly.toFixed(2), '1.41');
}

/* 레시피 3 — uuid 무작위 */
{
    const m = at({ key: 16, random: true });
    ok('uuid 무작위 페이지당', m.rndAvg.each, 201);
    ok('uuid 무작위 페이지 수', m.rndAvg.pages, 49752);
    ok('uuid 무작위 크기 388.7MB', mb(m.rndAvg.bytes), '388.7');
    ok('같은 폭에서 1.30배', m.vsSeq.toFixed(2), '1.30');
    ok('bigint 순차 대비 1.83배', m.vsBase.toFixed(2), '1.83');
    ok('본문 — 1.41 × 1.30 이 1.83 이다',
        (at({ key: 16 }).widthOnly * m.vsSeq).toFixed(2), '1.83');
    ok('상한 1.80배', m.vsSeqWorst.toFixed(2), '1.80');
    ok('상한 크기 538.8MB', mb(m.rndWorst.bytes), '538.8');
}

/* 레시피 4 — fillfactor 100 · uuid 순차 */
{
    const m = at({ key: 16, ff: 100 });
    ok('ff100 uuid 순차 페이지당', m.seq.each, 291);
    ok('ff100 uuid 순차 크기 268.5MB', mb(m.seq.bytes), '268.5');
}

/* 레시피 5 — 무작위에서 fillfactor 는 무효 */
ok('ff100 무작위도 388.7MB', mb(at({ key: 16, ff: 100, random: true }).now.bytes), '388.7');
ok('ff10 무작위도 388.7MB', mb(at({ key: 16, ff: 10, random: true }).now.bytes), '388.7');

/* 레시피 6 — bigint 무작위도 1.30배 */
{
    const m = at({ key: 8, random: true });
    ok('bigint 무작위 크기 277.0MB', mb(m.rndAvg.bytes), '277.0');
    ok('bigint 무작위도 1.30배', m.vsSeq.toFixed(2), '1.30');
    ok('본문 — 비율은 키 폭과 무관하다',
        at({ key: 8, random: true }).vsSeq.toFixed(2), at({ key: 16, random: true }).vsSeq.toFixed(2));
}

/* 레시피 7 — 1억 행 */
{
    const m = at({ key: 16, rows: 1e8, random: true });
    ok('1억행 크기 3.80GB', (m.rndAvg.bytes / 1073741824).toFixed(2), '3.80');
    ok('1억행에서도 1.30배', m.vsSeq.toFixed(2), '1.30');
}

/* ── 3. 불변식 ──────────────────────────────────────────── */

/* ① 비율은 행 수와 무관하다 — **화면이 보여주는 자리수에서**.
      페이지 수를 올림하므로 소수 넷째 자리에서는 미세하게 흔들린다(1.3014 vs 1.3017).
      본문이 주장하는 것은 표시되는 두 자리이므로 그 정밀도로 건다. */
{
    let checked = 0;
    for (const key of LAB.KEYS) for (const ff of [50, 90, 100]) {
        const want = at({ key, ff, rows: LAB.ROWS[0], random: true }).vsSeq.toFixed(2);
        for (const rows of LAB.ROWS) {
            const got = at({ key, ff, rows, random: true }).vsSeq.toFixed(2);
            if (got !== want) fail.push(`불변식① key=${key} ff=${ff} rows=${rows} — ${got} vs ${want}`);
            else checked++;
        }
    }
    ok(`불변식① 전수 ${checked}조합`, checked, LAB.KEYS.length * 3 * LAB.ROWS.length);
}

/* ② 순차는 fillfactor 까지 정확히 찬다 — 문서의 문장 그대로 */
{
    let checked = 0;
    for (const key of LAB.KEYS) for (const ff of [10, 30, 50, 70, 90, 100]) {
        const m = at({ key, ff });
        if (m.seq.fillPct !== ff) fail.push(`불변식② key=${key} ff=${ff} 인데 채움률 ${m.seq.fillPct}`);
        else if (m.seq.each !== Math.floor(LAB.perPage(key) * ff / 100))
            fail.push(`불변식② key=${key} ff=${ff} 페이지당 수가 안 맞는다`);
        else checked++;
    }
    ok(`불변식② 전수 ${checked}조합`, checked, LAB.KEYS.length * 6);
}

/* ③ 무작위 크기는 하한·상한 사이다 — 분할 규칙에서 연역된다 */
{
    let checked = 0;
    for (const key of LAB.KEYS) for (const rows of LAB.ROWS) {
        const m = at({ key, rows, random: true });
        if (!(m.rndBest.bytes <= m.rndAvg.bytes && m.rndAvg.bytes <= m.rndWorst.bytes))
            fail.push(`불변식③ key=${key} rows=${rows} 범위를 벗어났다`);
        else if (m.rndWorst.bytes / m.rndBest.bytes < 1.9)
            fail.push(`불변식③ 상한/하한이 2배 근처가 아니다 — ${(m.rndWorst.bytes / m.rndBest.bytes).toFixed(2)}`);
        else checked++;
    }
    ok(`불변식③ 전수 ${checked}조합`, checked, LAB.KEYS.length * LAB.ROWS.length);
}

/* ④ 두 원인은 곱해진다 — 키 폭 효과 × 분할 효과 = 전체 */
{
    let checked = 0;
    for (const rows of LAB.ROWS) for (const ff of [50, 90, 100]) {
        const width = at({ key: 16, ff, rows }).widthOnly;
        const split = at({ key: 16, ff, rows, random: true }).vsSeq;
        const both = at({ key: 16, ff, rows, random: true }).vsBase;
        if (Math.abs(width * split - both) > 0.02)
            fail.push(`불변식④ rows=${rows} ff=${ff} — ${width.toFixed(3)}×${split.toFixed(3)} ≠ ${both.toFixed(3)}`);
        else checked++;
    }
    ok(`불변식④ 전수 ${checked}조합`, checked, LAB.ROWS.length * 3);
}

/* ⑤ "두 배" 는 어떤 조합에서도 같은 폭에서 안 나온다 */
{
    let checked = 0;
    for (const key of LAB.KEYS) for (const ff of [70, 90]) {
        const v = at({ key, ff, random: true }).vsSeq;
        if (v >= 2) fail.push(`불변식⑤ key=${key} ff=${ff} 에서 같은 폭 비율이 ${v.toFixed(2)}`);
        else checked++;
    }
    ok(`불변식⑤ 전수 ${checked}조합 — 같은 폭에서 2배 미만`, checked, LAB.KEYS.length * 2);
}

/* ── 4. 시나리오가 본문과 같은 설정을 밟나 ───────────────── */
{
    const want = [
        { rows: 1e7, key: 8, ff: 90, random: false },
        { rows: 1e7, key: 16, ff: 90, random: false },
        { rows: 1e7, key: 16, ff: 90, random: true },
        { rows: 1e7, key: 16, ff: 100, random: false },
        { rows: 1e7, key: 16, ff: 100, random: true },
        { rows: 1e7, key: 8, ff: 90, random: true },
        { rows: 1e8, key: 16, ff: 90, random: true }
    ];
    ok('시나리오 단계 수', LAB.scene.length, want.length);
    want.forEach((w, i) => ok(`시나리오 ${i + 1} 설정`, JSON.stringify(LAB.scene[i]), JSON.stringify(w)));
    want.forEach((w, i) => ok(`시나리오 ${i + 1} 행 수가 손잡이 위에 있다`, LAB.ROWS.includes(w.rows), true));
    want.forEach((w, i) => ok(`시나리오 ${i + 1} 키 폭이 손잡이 위에 있다`, LAB.KEYS.includes(w.key), true));
}

/* ── 5. 렌더된 문자열이 실제로 그 수치를 담고 있나 ────────── */
{
    LAB.set({ rows: 1e7, key: 16, ff: 90, random: true });
    ok('미터에 1.30 이 있다', r.doc.cache.get('#meters').innerHTML.includes('×1.30'), true);
    ok('미터에 1.83 이 있다', r.doc.cache.get('#meters').innerHTML.includes('×1.83'), true);
    ok('판정이 "두 배가 아니다" 를 말한다',
        r.doc.cache.get('#verdict').innerHTML.includes('1.30'), true);
    const four = r.doc.cache.get('#four').innerHTML;
    for (const v of ['299.3MB', '388.7MB', '538.8MB', '69.3%', '50.0%']) ok(`표에 ${v} 가 있다`, four.includes(v), true);
    ok('채움 막대에 50~100 띠가 그려진다', r.doc.cache.get('#fills').innerHTML.includes('class="band"'), true);

    LAB.set({ ff: 10 });
    ok('ff10 으로 내려도 무작위 크기가 같다', r.doc.cache.get('#meters').innerHTML.includes('388.7MB'), true);

    LAB.set({ rows: 1e7, key: 8, ff: 90, random: false });   /* 첫 화면으로 */
}

console.log(fail.length ? '' : `단언 ${pass}건 — 전부 통과`);
for (const f of fail) console.error('실패  ' + f);
if (fail.length) console.error(`\n통과 ${pass}건 · 실패 ${fail.length}건`);
process.exit(fail.length ? 1 : 0);
