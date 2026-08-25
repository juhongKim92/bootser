/* ============================================================
   29. 무작위 키가 인덱스를 얼마나 키우나 — B-tree 페이지 분할
   ------------------------------------------------------------
   문서에서 연역되는 것만 계산한다.

     `CREATE INDEX` 문서 — *"B-trees use a default fillfactor of 90"*, 그리고
     *"leaf pages are filled to this percentage during initial index builds, and also
     **when extending the index at the right** (adding new largest key values)"*.
     → **순차 키는 fillfactor 까지 찬다.**

     `nbtree/README` — *"When we split a page, we try to equalize the number of **bytes**,
     not items, assigned to pages"*.
     → 일반 분할은 바이트 반반이므로 **분할 직후 50%, 다음 분할 직전 100%**.
       그래서 무작위 삽입에서 모든 리프는 **50%~100% 사이**다. 이게 불변식이다.

   무작위 삽입의 정상 상태 **평균** 점유율 `ln 2 ≈ 69.3%` 는 고전 분석 결과이고
   명세에 없다 — 그래서 이 실험대는 하한·상한을 계산하고 그 값은 **참고선**으로만 표시한다.
   난수를 쓰지 않는다.
   ============================================================ */
(function () {
  const S = window.LAB_I18N;
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];

  const PAGE = 8192;      /* 기본 블록 크기 */
  const HDR = 24;         /* 페이지 헤더 */
  const LP = 4;           /* 라인 포인터 */
  const TUPHDR = 8;       /* IndexTupleData */
  const LN2 = Math.log(2) * 100;             /* 69.31% — 고전 결과, 참고선 */
  const ROWS = [1e6, 5e6, 1e7, 5e7, 1e8];
  const KEYS = [8, 16];   /* bigint · uuid */

  /* --- 손잡이 --- */
  let rows = 1e7, key = 8, ff = 90, random = false;
  let idx = 0;

  /* --- 모델 --------------------------------------------------------- */
  const align8 = v => Math.ceil(v / 8) * 8;
  const perEntry = k => align8(TUPHDR + k) + LP;
  const perPage = k => Math.floor((PAGE - HDR) / perEntry(k));

  /* 채움률(%) 이 주어지면 페이지 수와 크기가 정해진다 */
  function at(k, fillPct, n) {
    const cap = perPage(k);
    const each = Math.max(1, Math.floor(cap * fillPct / 100));
    const pages = Math.ceil(n / each);
    return { cap, each, pages, bytes: pages * PAGE, fillPct };
  }

  function model(o) {
    const seq = at(o.key, o.ff, o.rows);                 /* 오른쪽 끝 확장 — fillfactor 까지 */
    const rndBest = at(o.key, 100, o.rows);              /* 분할 직전 — 하한 */
    const rndAvg = at(o.key, LN2, o.rows);               /* 고전 평균 — 참고선 */
    const rndWorst = at(o.key, 50, o.rows);              /* 분할 직후 — 상한 */
    const base = at(8, o.ff, o.rows);                    /* bigint 순차 — 비교 기준 */
    const now = o.random ? rndAvg : seq;
    return {
      seq, rndBest, rndAvg, rndWorst, base, now,
      perEntry: perEntry(o.key), cap: perPage(o.key),
      vsSeq: rndAvg.bytes / seq.bytes,                   /* 같은 폭에서 무작위가 몇 배 */
      vsSeqWorst: rndWorst.bytes / seq.bytes,
      vsBase: now.bytes / base.bytes,                    /* bigint 순차 대비 */
      widthOnly: seq.bytes / base.bytes                  /* 키 폭만의 효과 */
    };
  }
  const cfg = over => Object.assign({ rows, key, ff, random }, over || {});
  const cur = () => model(cfg());

  /* --- 표기 --- */
  const num = v => String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const mb = b => b >= 1073741824 ? (b / 1073741824).toFixed(2) + S.uGb : (b / 1048576).toFixed(1) + S.uMb;
  /* 행 수 단위는 언어마다 다르다 — 한국어는 만/억, 영어는 백만 단위. i18n 이 자릿수를 준다 */
  const rows_ = v => v >= S.divBig ? num(v / S.divBig) + S.uEok : num(v / S.divMid) + S.uMan;
  const x = v => '×' + v.toFixed(2);
  const fill = (str, ...v) => v.reduce((a, y, i) => a.split('$' + (i + 1)).join(y), str);
  const meter = (k, n, u, cls) =>
    '<div class="m ' + (cls || '') + '"><span class="k">' + k + '</span><span class="n">' + n +
    (u ? '<small>' + u + '</small>' : '') + '</span></div>';

  /* --- 페이지 채움 --- */
  function drawFills() {
    const o = cfg(), m = cur();
    const rowsOut = [
      { n: fill(S.rSeq, o.ff), f: m.seq.fillPct, each: m.seq.each, cls: '', on: !o.random },
      { n: S.rBest, f: 100, each: m.rndBest.each, cls: 'rnd', on: false },
      { n: S.rAvg, f: LN2, each: m.rndAvg.each, cls: 'rnd', on: o.random },
      { n: S.rWorst, f: 50, each: m.rndWorst.each, cls: 'rnd', on: false }
    ];
    $('#fills').innerHTML = rowsOut.map(r =>
      '<div class="row ' + r.cls + (r.on ? ' on' : '') + '">' +
      '<span class="rn">' + r.n + '</span>' +
      '<span class="page">' +
      (r.cls === 'rnd' ? '<span class="band" style="left:50%;right:0"></span>' : '') +
      '<span class="used" style="width:' + r.f.toFixed(2) + '%"></span>' +
      '<span class="ff" style="left:' + o.ff + '%"></span>' +
      '</span>' +
      '<span class="rv">' + r.each + S.uEntries + '</span></div>').join('');
  }

  /* --- 크기 막대 --- */
  function drawSizes() {
    const o = cfg(), m = cur();
    const rowsOut = [
      { n: S.zBase, b: m.base.bytes, cls: 'base' },
      { n: fill(S.zSeq, o.key), b: m.seq.bytes, cls: '' },
      { n: S.zAvg, b: m.rndAvg.bytes, cls: 'rnd' },
      { n: S.zWorst, b: m.rndWorst.bytes, cls: 'rnd' }
    ];
    const max = Math.max(...rowsOut.map(r => r.b));
    $('#sizes').innerHTML = rowsOut.map(r =>
      '<div class="row ' + r.cls + '"><span class="rn">' + r.n + '</span>' +
      '<span class="bar" style="width:' + (r.b / max * 100).toFixed(1) + '%"></span>' +
      '<span class="rv">' + mb(r.b) + '<em>' + x(r.b / m.base.bytes) + '</em></span></div>').join('');
  }

  /* --- 조건별 표 --- */
  function drawTable() {
    const o = cfg(), m = cur();
    const rowsOut = [
      { k: fill(S.rSeq, o.ff), v: m.seq, on: !o.random },
      { k: S.rBest, v: m.rndBest, on: false },
      { k: S.rAvg, v: m.rndAvg, on: o.random },
      { k: S.rWorst, v: m.rndWorst, on: false }
    ];
    $('#four').innerHTML =
      '<tr><th>' + S.tCase + '</th><th>' + S.tFill + '</th><th>' + S.tEach + '</th><th>' +
      S.tPages + '</th><th>' + S.tSize + '</th><th>' + S.tRatio + '</th></tr>' +
      rowsOut.map(r =>
        '<tr class="' + (r.on ? 'on' : '') + '"><td>' + r.k + '</td>' +
        '<td>' + r.v.fillPct.toFixed(1) + '%</td><td>' + r.v.each + '</td>' +
        '<td>' + num(r.v.pages) + '</td><td>' + mb(r.v.bytes) + '</td>' +
        '<td class="' + (r.v.bytes > m.seq.bytes ? 'bad' : 'good') + '">' +
        x(r.v.bytes / m.seq.bytes) + '</td></tr>').join('');
  }

  function drawMeters() {
    const o = cfg(), m = cur();
    $('#meters').innerHTML =
      meter(S.mEntry, m.perEntry, S.uB, '') +
      meter(S.mCap, m.cap, S.uEntries, '') +
      meter(S.mPages, num(m.now.pages), '', '') +
      meter(S.mSize, mb(m.now.bytes), '', o.random ? 'bad' : 'good') +
      meter(S.mVsSeq, x(m.vsSeq), '', m.vsSeq > 1.5 ? 'bad' : '') +
      meter(S.mVsBase, x(m.vsBase), '', m.vsBase > 1.5 ? 'bad' : '');

    /* 판정 */
    const v = $('#verdict');
    let msg, cls;
    if (!o.random) {
      msg = fill(S.vSeq, o.ff, m.seq.each, mb(m.seq.bytes), x(m.widthOnly));
      cls = ' ok';
    } else if (o.key > 8) {
      msg = fill(S.vRnd, x(m.vsSeq), x(m.vsSeqWorst), x(m.vsBase), mb(m.rndAvg.bytes));
      cls = ' stuck';
    } else {
      /* 키가 기준과 같은 폭이면 "두 배" 이야기가 성립하지 않는다 — 분할 몫만 남는다 */
      msg = fill(S.vRndSame, x(m.vsSeq), x(m.vsSeqWorst), mb(m.rndAvg.bytes));
      cls = ' stuck';
    }
    v.className = 'verdict' + cls;
    v.innerHTML = msg;
  }

  function drawHint() {
    const o = cfg(), m = cur();
    const h = $('#hint');
    h.className = 'hint' + (o.random ? ' warn' : '');
    h.innerHTML = fill(S.hint, rows_(o.rows), o.key, m.perEntry, m.cap, o.ff, mb(m.now.bytes));
  }

  function layout() { drawFills(); drawSizes(); drawTable(); drawMeters(); drawHint(); }

  /* --- 시나리오 --- */
  const SCENE = [
    { rows: 1e7, key: 8, ff: 90, random: false },
    { rows: 1e7, key: 16, ff: 90, random: false },
    { rows: 1e7, key: 16, ff: 90, random: true },
    { rows: 1e7, key: 16, ff: 100, random: false },
    { rows: 1e7, key: 16, ff: 100, random: true },
    { rows: 1e7, key: 8, ff: 90, random: true },
    { rows: 1e8, key: 16, ff: 90, random: true }
  ];

  function applyStep() {
    const c = SCENE[idx];
    rows = c.rows; key = c.key; ff = c.ff; random = c.random;
    syncDials();
    $('#nStep').textContent = pad(idx + 1) + ' / ' + pad(SCENE.length);
    $('#nText').textContent = S.scene[idx];
    $('#btnStep').disabled = idx >= SCENE.length - 1;
    $('#btnPrev').disabled = idx <= 0;
    layout();
  }
  const pad = n => String(n).padStart(2, '0');

  function syncDials() {
    const ri = ROWS.indexOf(rows);
    if (ri >= 0) $('#sN').value = String(ri);
    $('#vN').innerHTML = rows_(rows) + '<small>' + S.uRows + '</small>';
    const ki = KEYS.indexOf(key);
    if (ki >= 0) $('#sK').value = String(ki);
    $('#vK').innerHTML = key + '<small>' + S.uB + '</small>';
    $('#sF').value = String(ff); $('#vF').innerHTML = ff + '<small>%</small>';
    press('#segOrder', b => (b.dataset.rand === '1') === random);
  }
  const press = (sel, fn) => $$(sel + ' button').forEach(b => b.setAttribute('aria-pressed', fn(b) ? 'true' : 'false'));

  /* --- 구동 --- */
  const bind = (sel, fn) => { $(sel).oninput = e => { fn(+e.target.value); syncDials(); layout(); }; };
  bind('#sN', v => rows = ROWS[v]);
  bind('#sK', v => key = KEYS[v]);
  bind('#sF', v => ff = v);

  $$('#segOrder button').forEach(b => b.onclick = () => { random = b.dataset.rand === '1'; syncDials(); layout(); });
  $('#btnStep').onclick = () => { if (idx < SCENE.length - 1) { idx++; applyStep(); } };
  $('#btnPrev').onclick = () => { if (idx > 0) { idx--; applyStep(); } };
  $('#btnReset').onclick = () => { idx = 0; applyStep(); };
  $('#btnPrev').disabled = true;

  applyStep();

  /* 검증용 — 배포되는 코드 그대로 수치를 읽을 수 있게 열어둔다 */
  window.LAB = {
    set(o) {
      for (const [k, v] of Object.entries(o)) {
        if (k === 'rows') rows = v; else if (k === 'key') key = v;
        else if (k === 'ff') ff = v; else if (k === 'random') random = v;
      }
      syncDials(); layout(); return window.LAB;
    },
    model, cur, at, perEntry, perPage,
    PAGE, HDR, LP, TUPHDR, LN2, ROWS, KEYS, scene: SCENE,
    m: over => model(cfg(over)),
    get dials() { return { rows, key, ff, random }; }
  };
})();
