/* ============================================================
   23편(`/alignment/`) 본문 인용 수치 대조 — 실행: node tools/verify-alignment.mjs
   ------------------------------------------------------------
   1차 출처 확인은 착수 전에 했다 — `java.lang.foreign.MemoryLayout` 문서
   (자동 패딩 없음 · 어긋나면 IllegalArgumentException · 크기는 멤버 합 ·
    자연 정렬은 크기와 같음). C 쪽 정렬 규칙은 **표준이 아니라 ABI** 라는 점을
   본문에 명시했고, 실험대는 x86-64 · AArch64 규칙을 모델로 쓴다.
   ============================================================ */
import { boot } from './lab-harness.mjs';

const { lab, errors } = boot('alignment');
if (errors.length) { console.error('구동 오류:', errors.join(' / ')); process.exit(1); }
if (!lab) { console.error('window.LAB 훅이 없다'); process.exit(1); }

let fail = 0, pass = 0;
const eq = (label, got, want) => {
    const ok = typeof want === 'number' ? got === want : got === want;
    if (ok) pass++; else { fail++; console.error(`  실패 ${label}: 실측 ${JSON.stringify(got)} · 기대 ${JSON.stringify(want)}`); }
};
const R = cfg => {
    const x = lab.set({ layout: 'decl', pack: 0, n: 1, ...cfg }).exact();
    return {
        sum: x.sum, size: x.size, inner: x.innerPad, tail: x.tail, align: x.structAlign,
        first: x.firstMis ? x.firstMis.name : null, drift: x.arrDrift,
        offs: x.fields.map(f => f.name + '@' + f.start).join(' ')
    };
};

console.log('23편 인용 수치 대조\n');

{   console.log('레시피 1 — 선언 순서 · ABI 기본');
    const x = R({});
    eq('필드 크기 합', x.sum, 16); eq('sizeof', x.size, 24);
    eq('내부 패딩', x.inner, 8); eq('꼬리 패딩', x.tail, 0);
    eq('구조체 정렬', x.align, 8);
    eq('첫 어긋남', x.first, 'width');
    eq('오프셋', x.offs, 'type@0 width@4 shape@8 flag@10 ts@16');
}
{   console.log('레시피 2 — 큰 것부터 (같은 필드)');
    const x = R({ layout: 'big' });
    eq('sizeof', x.size, 16); eq('합과 같다', x.size, x.sum);
    eq('내부 패딩', x.inner, 0); eq('꼬리 패딩', x.tail, 0);
    eq('어긋남 없음', x.first, null);
    eq('오프셋', x.offs, 'ts@0 width@8 shape@12 type@14 flag@15');
    /* 필드 목록은 같아야 한다 — 순서만 바꾼 것이다 */
    eq('필드 크기 합이 같다', x.sum, R({}).sum);
}
{   console.log('레시피 3 — pack(1)');
    const x = R({ pack: 1 });
    eq('sizeof', x.size, 16); eq('내부 패딩', x.inner, 0);
    eq('구조체 정렬', x.align, 1);
    eq('오프셋', x.offs, 'type@0 width@1 shape@5 flag@7 ts@8');
}
{   console.log('레시피 4 — pack(4) · 같은 필드로 세 번째 크기');
    const x = R({ pack: 4 });
    eq('sizeof', x.size, 20); eq('내부 패딩', x.inner, 4);
    eq('구조체 정렬', x.align, 4);
    eq('첫 어긋남', x.first, 'width');
    eq('세 크기가 24 · 20 · 16', [R({}).size, x.size, R({ pack: 1 }).size].join('/'), '24/20/16');
}
{   console.log('레시피 5 — 꼬리 패딩 배치');
    const x = R({ layout: 'tail' });
    eq('합', x.sum, 13); eq('sizeof', x.size, 24);
    eq('내부 패딩', x.inner, 4); eq('꼬리 패딩', x.tail, 7);
    eq('첫 어긋남', x.first, 'ts');
    eq('오프셋', x.offs, 'width@0 ts@8 flag@16');
}
{   console.log('레시피 6 — 배열 누적 오차 (원소 1개면 0)');
    eq('n=1', R({ layout: 'tail', n: 1 }).drift, 0);
    eq('n=2', R({ layout: 'tail', n: 2 }).drift, 11);
    eq('n=3', R({ layout: 'tail', n: 3 }).drift, 22);
    eq('n=8', R({ layout: 'tail', n: 8 }).drift, 77);
    /* 오차는 (n-1) × (sizeof - 합) 이다 */
    eq('오차 산식', 7 * (24 - 13), 77);
}
{   console.log('레시피 7 — 배치를 고치면 배열도 안전');
    const x = R({ layout: 'big', n: 3 });
    eq('sizeof', x.size, 16); eq('꼬리 패딩', x.tail, 0); eq('배열 오차', x.drift, 0);
}
{   console.log('본문 — 원소가 1개면 어떤 배치·정렬에서도 배열 오차가 0 (전수)');
    let bad = 0, n2 = 0;
    for (const layout of ['decl', 'big', 'tail']) for (const pack of [0, 1, 4]) {
        n2++;
        if (R({ layout, pack, n: 1 }).drift !== 0) bad++;
    }
    eq('조합 수', n2, 9);
    eq('n=1 에서 오차가 있는 조합', bad, 0);
}
{   console.log('본문 — pack(1) 이면 어떤 배치에서도 합 = sizeof (전수)');
    let bad = 0;
    for (const layout of ['decl', 'big', 'tail']) {
        const x = R({ layout, pack: 1 });
        if (x.size !== x.sum || x.inner !== 0 || x.tail !== 0) bad++;
    }
    eq('어긋난 배치', bad, 0);
}
{   console.log('본문 — 어긋남은 국소적이지 않다: 첫 어긋남 뒤 모든 필드가 밀린다');
    const x = lab.set({ layout: 'decl', pack: 0, n: 1 }).exact();
    const fm = x.firstMis;
    eq('첫 어긋남 인덱스', fm.i, 1);
    const after = x.fields.filter(f => f.i >= fm.i);
    eq('그 뒤 필드 수', after.length, 4);
    eq('그 뒤 전부 어긋난다', after.every(f => f.start !== f.nstart), true);
    eq('그 앞은 맞는다', x.fields.filter(f => f.i < fm.i).every(f => f.start === f.nstart), true);
}
{   console.log('시나리오 — 7단계');
    const want = [
        { sum: 16, size: 24, inner: 8, tail: 0, drift: 0 },
        { sum: 16, size: 16, inner: 0, tail: 0, drift: 0 },
        { sum: 16, size: 16, inner: 0, tail: 0, drift: 0 },
        { sum: 16, size: 20, inner: 4, tail: 0, drift: 0 },
        { sum: 13, size: 24, inner: 4, tail: 7, drift: 0 },
        { sum: 13, size: 24, inner: 4, tail: 7, drift: 22 },
        { sum: 16, size: 16, inner: 0, tail: 0, drift: 0 }
    ];
    eq('단계 수', lab.scene.length, want.length);
    lab.scene.forEach((s, i) => {
        const x = R(s);
        for (const k of ['sum', 'size', 'inner', 'tail', 'drift']) eq(`${i + 1}단계 ${k}`, x[k], want[i][k]);
    });
}

console.log('');
console.log(fail ? `실패 ${fail}건 · 통과 ${pass}건` : `전부 일치 — 단언 ${pass}건`);
process.exit(fail ? 1 : 0);
