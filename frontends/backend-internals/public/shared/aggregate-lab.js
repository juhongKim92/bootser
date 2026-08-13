/* ============================================================
   22. 같은 숫자가 두 화면에서 다르다 — 집계 경로 난립
   ------------------------------------------------------------
   같은 지표를 두 경로가 각자 계산한다.
     경로 A — 원천에서 **전체 가중 평균**을 다시 낸다
     경로 B — 날짜별로 저장해둔 평균값들을 **단순 평균**한다
   표본 수가 날마다 다르면 두 값은 다르다. **어느 쪽도 틀리지 않았다** — 정의가 둘이다.

   1차 출처 확인 (2026-08-13, PostgreSQL 공식 문서)
     · `trunc(v, s)` 는 "Truncates v to s decimal places" — **버린다.** 반올림이 아니다
       (`trunc(42.4382, 2) → 42.43`)
     · `round(v, s)` 는 반올림하되 **타입에 따라 tie 처리가 다르다** —
       numeric 은 "ties are broken by rounding away from zero",
       double precision 은 "platform dependent, but round to nearest even is the most common rule"
     · `real` 은 최소 6자리, `double precision` 은 최소 15자리 십진 정밀도
     · 문서가 직접 경고한다 — "Comparing two floating-point values for equality
       might not always work as expected"

   tie 를 진짜 tie 로 만들려고 **이진수로 정확히 표현되는 값(0.25 · 0.75)만 썼다.**
   0.35 같은 값은 애초에 이진 부동소수점에 정확히 없어서 "tie" 자체가 성립하지 않는다 —
   그건 더 나쁜 상황이고 본문에 적어뒀다.
   ============================================================ */
(function () {
  const S = window.LAB_I18N;
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];

  /* 날짜별 참 평균 — 0.25 · 0.75 만 써서 이진 표현이 정확하다 */
  const TRUE_AVG = [40.25, 60.75, 80.25];
  const BASE_N = 100;
  const PREC = [null, 1, 0];          // null = 원값 그대로 저장

  /* --- 손잡이 --- */
  let skew = 0;                        // 표본 편중 0..90
  let pi = 0;                          // 저장 정밀도
  let rmode = 'trunc';                 // trunc | numeric | double
  let tz = 'utc';                      // utc | local
  let edge = 0;                        // 경계 이벤트 수 0..40
  let idx = 0;

  /* --- 반올림 구현 ---------------------------------------------------------
     numeric  : ties away from zero        (PostgreSQL numeric)
     double   : ties to even (banker's)    (PostgreSQL double precision, 흔한 규칙)
     trunc    : 버림                        (PostgreSQL trunc)                      */
  function quantize(v, s, how) {
    if (s == null) return v;
    const f = Math.pow(10, s);
    const x = v * f;
    if (how === 'trunc') return Math.trunc(x) / f;
    const fl = Math.floor(x), diff = x - fl;
    if (Math.abs(diff - 0.5) > 1e-9) return Math.round(x) / f;   // tie 가 아니면 그냥 반올림
    if (how === 'numeric') return (fl + 1) / f;                   // away from zero (양수 기준)
    return (fl % 2 === 0 ? fl : fl + 1) / f;                      // to even
  }

  /* --- 모델 -----------------------------------------------------------------
     날마다 n 개의 행이 있고 그 날의 행은 모두 같은 값이다.
     경계 이벤트를 로컬 기준으로 그룹핑하면 첫날 끝 구간의 행들이 **값을 들고**
     둘째 날로 넘어간다 — 그래서 둘째 날의 평균이 섞여서 바뀐다.

     여기서 갈린다.
       · 경로 A(전체 가중 평균)는 **같은 행 집합의 평균**이므로 날짜 경계가 어디든 불변이다
       · 경로 B(일별 평균의 평균)는 경계가 바뀌면 달라진다                        */
  function calc(o) {
    /* 표본 편중 — 총합은 300 으로 고정한다 */
    const n0 = BASE_N + 2 * o.skew, n1 = BASE_N - o.skew, n2 = BASE_N - o.skew;
    const moved = o.tz === 'local' ? Math.min(o.edge, n0) : 0;
    const n = [n0 - moved, n1 + moved, n2];
    const total = n0 + n1 + n2;

    /* 경로 A — 원천의 모든 행을 한 번에 평균한다. 경계와 무관하다 */
    const a = (n0 * TRUE_AVG[0] + n1 * TRUE_AVG[1] + n2 * TRUE_AVG[2]) / total;

    /* 날짜별 평균 — 넘어온 행이 섞인다 */
    const dayAvg = [
      TRUE_AVG[0],
      (n1 * TRUE_AVG[1] + moved * TRUE_AVG[0]) / (n1 + moved),
      TRUE_AVG[2]
    ];
    /* 경로 B — 저장된 일별 평균(정밀도가 깎인다)의 단순 평균 */
    const stored = dayAvg.map(v => quantize(v, PREC[o.pi], o.rmode));
    const b = (stored[0] + stored[1] + stored[2]) / 3;

    const gap = Math.abs(a - b);
    /* 소수점 몇 자리까지 같나 */
    let agree = 0;
    for (let d = 0; d <= 6; d++) {
      if (Math.abs(a - b) < 0.5 * Math.pow(10, -d)) agree = d; else break;
    }
    return { n, moved, total, a, b, gap, agree, stored, dayAvg, relPct: a ? gap / a * 100 : 0 };
  }
  const cfg = () => ({ skew, pi, rmode, tz, edge });
  const cur = () => calc(cfg());

  /* --- 표시 --- */
  const f = (v, d = 4) => v.toFixed(d);
  const m = (k, n2, u, cls) =>
    '<div class="m ' + (cls || '') + '"><span class="k">' + k + '</span><span class="n">' + n2 +
    (u ? '<small>' + u + '</small>' : '') + '</span></div>';

  function render() {
    const c = cfg(), r = cur();

    $('#two').innerHTML =
      '<div class="num a"><span class="k">' + S.pathA + '</span>' +
      '<span class="big">' + f(r.a) + '</span>' +
      '<span class="sub">' + S.pathASub + '</span></div>' +
      '<div class="gap' + (r.gap > 1e-9 ? ' diff' : '') + '"><span class="k">' + S.gapK + '</span>' +
      '<span class="big">' + (r.gap > 1e-9 ? f(r.gap) : '0') + '</span>' +
      '<span class="sub">' + (r.gap > 1e-9 ? f(r.relPct, 3) + '%' : S.gapNone) + '</span></div>' +
      '<div class="num b"><span class="k">' + S.pathB + '</span>' +
      '<span class="big">' + f(r.b) + '</span>' +
      '<span class="sub">' + S.pathBSub + '</span></div>';

    /* 날짜별 표본 — 폭이 표본 수, 높이가 평균 */
    const maxAvg = Math.max(...TRUE_AVG) * 1.1;
    $('#days').innerHTML = r.n.map((cnt, i) =>
      '<div class="day' + (i === 1 && r.moved ? ' moved' : '') + '" style="flex:' + Math.max(1, cnt) + '">' +
      '<span class="lab2">' + (Math.abs(r.dayAvg[i] % 1) > 1e-9 ? r.dayAvg[i].toFixed(2) : r.dayAvg[i]) + '</span>' +
      '<span class="bar" style="height:' + (r.dayAvg[i] / maxAvg * 100) + '%"></span></div>').join('');
    $('#daysX').innerHTML = r.n.map((cnt, i) =>
      '<span style="flex:' + Math.max(1, cnt) + '">' + S.dayN.replace('$1', i + 1).replace('$2', cnt) +
      (i === 1 && r.moved ? ' +' + r.moved : '') + '</span>').join('');

    /* 계산 단계 */
    const st = (cls, nm, ex, rs) =>
      '<div class="step ' + cls + '"><span class="nm">' + nm + '</span>' +
      '<span class="ex">' + ex + '</span><span class="rs">' + rs + '</span></div>';
    $('#steps').innerHTML =
      st('a', S.sA1, '(' + [BASE_N + 2 * skew, BASE_N - skew, BASE_N - skew]
        .map((n2, i) => n2 + '×' + TRUE_AVG[i]).join(' + ') + ') / ' + r.total, f(r.a)) +
      st('b', S.sB1, S.sB1ex.replace('$1', PREC[pi] == null ? S.precRaw : PREC[pi] + S.precDigits)
        .replace('$2', S['rm_' + rmode]), r.stored.join(' · ')) +
      st('b', S.sB2, '(' + r.stored.join(' + ') + ') / 3', f(r.b));

    $('#meters').innerHTML =
      m(S.mGap, r.gap > 1e-9 ? f(r.gap) : '0', '', r.gap > 1e-9 ? 'bad' : 'good') +
      m(S.mRel, f(r.relPct, 3), '%', r.relPct > 0.001 ? 'bad' : 'good') +
      m(S.mAgree, String(r.agree), S.uDigit, r.agree >= 4 ? 'good' : 'bad') +
      m(S.mMoved, String(r.moved), S.uRow, r.moved ? 'bad' : 'good') +
      m(S.mSkew, r.n.join(' / '), '', '');

    /* 반올림 방식 세 가지 비교 — 나머지는 그대로 */
    $('#cmp').innerHTML =
      '<tr><th>' + S.cMode + '</th><th>' + S.cStored + '</th><th>' + S.cB + '</th><th>' + S.cGap + '</th></tr>' +
      ['trunc', 'numeric', 'double'].map(k => {
        const x = calc({ ...c, rmode: k });
        return '<tr class="' + (k === rmode ? 'on' : '') + '"><td>' + S['rm_' + k] + '</td>' +
          '<td class="num2">' + x.stored.join(' · ') + '</td>' +
          '<td class="num2">' + f(x.b) + '</td>' +
          '<td class="num2 ' + (x.gap > 1e-9 ? 'bad' : 'good') + '">' + (x.gap > 1e-9 ? f(x.gap) : '0') + '</td></tr>';
      }).join('');

    /* 판정 */
    const v = $('#verdict');
    let msg, cls;
    if (r.moved) {
      msg = S.vTz.replace('$1', String(r.moved)).replace('$2', f(r.gap)); cls = ' stuck';
    } else if (skew > 0 && PREC[pi] == null) {
      msg = S.vWeight.replace('$1', r.n.join('/')).replace('$2', f(r.gap)); cls = ' stuck';
    } else if (r.gap > 1e-9) {
      msg = S.vRound.replace('$1', S['rm_' + rmode]).replace('$2', f(r.gap)).replace('$3', String(r.agree)); cls = ' stuck';
    } else {
      msg = S.vSame; cls = ' ok';
    }
    v.className = 'verdict' + cls;
    v.innerHTML = msg;

    const h = $('#hint');
    h.className = 'hint' + (r.gap > 1e-9 ? ' warn' : '');
    h.textContent = r.gap > 1e-9 ? S.hDiff.replace('$1', String(r.agree)) : S.hSame;
  }

  /* --- 시나리오 --- */
  const SCENE = [
    { skew: 0, pi: 0, rmode: 'trunc', tz: 'utc', edge: 0 },
    { skew: 60, pi: 0, rmode: 'trunc', tz: 'utc', edge: 0 },
    { skew: 0, pi: 1, rmode: 'trunc', tz: 'utc', edge: 0 },
    { skew: 0, pi: 1, rmode: 'numeric', tz: 'utc', edge: 0 },
    { skew: 0, pi: 1, rmode: 'double', tz: 'utc', edge: 0 },
    { skew: 0, pi: 0, rmode: 'trunc', tz: 'local', edge: 40 },
    { skew: 60, pi: 1, rmode: 'double', tz: 'local', edge: 40 }
  ];

  function applyStep() {
    const s = SCENE[idx];
    skew = s.skew; pi = s.pi; rmode = s.rmode; tz = s.tz; edge = s.edge;
    syncDials();
    $('#nStep').textContent = pad(idx + 1) + ' / ' + pad(SCENE.length);
    $('#nText').textContent = S.scene[idx];
    $('#btnStep').disabled = idx >= SCENE.length - 1;
    $('#btnPrev').disabled = idx <= 0;
    render();
  }
  const pad = n => String(n).padStart(2, '0');

  function syncDials() {
    $('#sS').value = String(skew); $('#vS').innerHTML = skew + '<small>%</small>';
    $('#sE').value = String(edge); $('#vE').innerHTML = edge + '<small>' + S.uRow + '</small>';
    $('#sP').value = String(pi);
    $('#vP').innerHTML = PREC[pi] == null ? S.precRaw : PREC[pi] + '<small>' + S.precDigits + '</small>';
    press('#segRound', b => b.dataset.rm === rmode);
    press('#segTz', b => b.dataset.tz === tz);
  }
  const press = (sel, fn) => $$(sel + ' button').forEach(b => b.setAttribute('aria-pressed', fn(b) ? 'true' : 'false'));

  const bind = (sel, fn) => { $(sel).oninput = e => { fn(+e.target.value); syncDials(); render(); }; };
  bind('#sS', v => skew = v);
  bind('#sE', v => edge = v);
  bind('#sP', v => pi = v);
  $$('#segRound button').forEach(b => b.onclick = () => { rmode = b.dataset.rm; syncDials(); render(); });
  $$('#segTz button').forEach(b => b.onclick = () => { tz = b.dataset.tz; syncDials(); render(); });

  $('#btnStep').onclick = () => { if (idx < SCENE.length - 1) { idx++; applyStep(); } };
  $('#btnPrev').onclick = () => { if (idx > 0) { idx--; applyStep(); } };
  $('#btnReset').onclick = () => { idx = 0; applyStep(); };
  $('#btnPrev').disabled = true;

  applyStep();

  /* 검증용 — 배포되는 코드 그대로 수치를 읽을 수 있게 열어둔다 (tools/ 참고) */
  window.LAB = {
    set(o) {
      if (o.skew != null) skew = o.skew;
      if (o.prec !== undefined) pi = PREC.indexOf(o.prec);
      if (o.rmode) rmode = o.rmode;
      if (o.tz) tz = o.tz;
      if (o.edge != null) edge = o.edge;
      if (pi < 0) throw new Error('눈금에 없는 정밀도: ' + o.prec);
      syncDials(); render(); return window.LAB;
    },
    calc, quantize, scene: SCENE, tables: { TRUE_AVG, BASE_N, PREC },
    exact: () => cur(),
    get cfg() { return { skew, prec: PREC[pi], rmode, tz, edge }; }
  };
})();
