/* ============================================================
   23. 필드를 다 더했는데 크기가 안 맞는다 — 정렬과 패딩
   ------------------------------------------------------------
   필드 크기를 합해서 오프셋을 계산하면 밀린다. 컴파일러가 정렬을 맞추려고 사이에
   패딩을 넣고, 구조체 끝에도 넣기 때문이다. 그리고 **한 필드가 밀리면 그 뒤가 전부
   밀린다** — 오류가 국소적이지 않다.

   1차 출처 확인 (2026-08-13)
     · Java `MemoryLayout.structLayout` 은 **패딩을 자동으로 넣지 않는다.**
       문서에 그대로 있다 — "This factory does not automatically align element layouts,
       by inserting additional padding layout elements. As such, the following struct
       layout creation will fail with an exception: structLayout(JAVA_SHORT, JAVA_INT)".
       어긋나면 `IllegalArgumentException` 이다.
     · 같은 문서 — 값 레이아웃의 자연 정렬은 크기와 같다("The natural alignment of a
       value layout whose size is N is N").
     · 그리고 구조체 크기는 **멤버 크기의 단순 합**이다("S1 + S2 + ... + Sn") —
       즉 **꼬리 패딩이 자동으로 안 붙는다.** C 구조체를 옮겨 적을 때 이게 함정이다.

   근거의 성격을 구별한다 — 이건 21편에서 배운 것이다
     · C 표준은 패딩을 **허용**할 뿐 규칙을 정하지 않는다.
     · 자연 정렬 · 구조체 정렬 = 멤버 최대 정렬 · sizeof 가 정렬의 배수 — 이건
       **ABI 규칙**이고 x86-64 · AArch64 에서 그렇다. 다른 ABI 는 다를 수 있다.
       그래서 헤더 파일을 봐도 레이아웃을 확정할 수 없다. 이게 페이지의 논지다.
   ============================================================ */
(function () {
  const S = window.LAB_I18N;
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];

  /* 필드 배치 세 벌 — 같은 필드를 순서만 바꾼 것과, 꼬리 패딩이 생기는 것 */
  const LAYOUTS = {
    decl: [['type', 1], ['width', 4], ['shape', 2], ['flag', 1], ['ts', 8]],
    big: [['ts', 8], ['width', 4], ['shape', 2], ['type', 1], ['flag', 1]],
    tail: [['width', 4], ['ts', 8], ['flag', 1]]
  };

  /* --- 손잡이 --- */
  let layout = 'decl', pack = 0, n = 3;   // pack 0 = ABI 기본(자연 정렬)
  let idx = 0;

  /* --- 모델 -----------------------------------------------------------------
     pack 이 0 이면 각 필드의 정렬은 자기 크기(자연 정렬)다.
     pack 이 p 면 정렬이 min(크기, p) 로 깎인다.
     구조체 정렬 = 필드 정렬의 최대값. sizeof 는 그 배수로 올림된다(꼬리 패딩).   */
  function calc(o) {
    const fs = LAYOUTS[o.layout];
    const alignOf = sz => o.pack ? Math.min(sz, o.pack) : sz;
    let off = 0;
    const fields = fs.map(([name, sz], i) => {
      const al = alignOf(sz);
      const pad = (al - (off % al)) % al;
      off += pad;
      const start = off;
      off += sz;
      return { name, sz, al, pad, start, end: off, i };
    });
    const structAlign = Math.max(...fields.map(f => f.al));
    const bodyEnd = off;
    const tail = (structAlign - (bodyEnd % structAlign)) % structAlign;
    const size = bodyEnd + tail;
    const sum = fs.reduce((a, [, sz]) => a + sz, 0);

    /* "크기를 그냥 더한" 계산 — 패딩을 모른다 */
    let so = 0;
    const naive = fields.map(f => { const s = so; so += f.sz; return { ...f, nstart: s, nend: so }; });
    const firstMis = naive.find(f => f.nstart !== f.start);

    return {
      fields: naive, structAlign, sum, size, tail,
      innerPad: fields.reduce((a, f) => a + f.pad, 0),
      firstMis: firstMis || null,
      /* 배열 n 번째 원소가 시작하는 오프셋 — 꼬리 패딩을 무시하면 누적으로 벌어진다 */
      arrReal: (o.n - 1) * size, arrNaive: (o.n - 1) * sum,
      arrDrift: (o.n - 1) * (size - sum)
    };
  }
  const cfg = () => ({ layout, pack, n });
  const cur = () => calc(cfg());

  /* --- 표시 --- */
  const m = (k, v, u, cls) =>
    '<div class="m ' + (cls || '') + '"><span class="k">' + k + '</span><span class="n">' + v +
    (u ? '<small>' + u + '</small>' : '') + '</span></div>';

  function render() {
    const c = cfg(), r = cur();

    /* 실제 레이아웃 자 */
    const cells = [];
    for (let b = 0; b < r.size; b++) {
      const f = r.fields.find(x => b >= x.start && b < x.end);
      if (f) cells[b] = '<span class="cell f' + (f.i % 5) + (r.firstMis && f.i >= r.firstMis.i ? ' mis' : '') +
        '" title="' + f.name + ' @' + f.start + '">' + (b === f.start ? f.name.slice(0, 2) : '') + '</span>';
      else cells[b] = '<span class="cell ' + (b >= r.fields.at(-1).end ? 'tail' : 'pad') + '" title="' +
        (b >= r.fields.at(-1).end ? S.tTail : S.tPad) + '"></span>';
    }
    /* 합으로 계산한 자 */
    const nc = [];
    for (let b = 0; b < r.sum; b++) {
      const f = r.fields.find(x => b >= x.nstart && b < x.nend);
      nc[b] = '<span class="cell f' + (f.i % 5) + '" title="' + f.name + ' @' + f.nstart + '">' +
        (b === f.nstart ? f.name.slice(0, 2) : '') + '</span>';
    }
    $('#ruler').innerHTML =
      '<div class="rowlab">' + S.rReal.replace('$1', r.size) + '</div>' +
      '<div class="ruler">' + cells.join('') + '</div>' +
      '<div class="axis">' + [...Array(r.size)].map((_, b) => '<span>' + (b % 4 === 0 ? b : '') + '</span>').join('') + '</div>' +
      '<div class="rowlab bad">' + S.rNaive.replace('$1', r.sum) + '</div>' +
      '<div class="ruler">' + nc.join('') + '</div>';

    /* 필드 표 */
    $('#ftbl').innerHTML =
      '<tr><th>' + S.hField + '</th><th>' + S.hSize + '</th><th>' + S.hAlign + '</th><th>' + S.hPad + '</th>' +
      '<th>' + S.hReal + '</th><th>' + S.hNaive + '</th><th>' + S.hDrift + '</th></tr>' +
      r.fields.map(f => {
        const d = f.start - f.nstart;
        return '<tr class="' + (d ? 'mis' : '') + '"><td><span class="sw f' + (f.i % 5) +
          '" style="background:var(--' + ['horizon', 'live', 'pending', 'free', 'blocked'][f.i % 5] + ')"></span>' +
          f.name + '</td><td>' + f.sz + '</td><td>' + f.al + '</td><td>' + (f.pad || '') + '</td>' +
          '<td>' + f.start + '</td><td>' + f.nstart + '</td><td>' + (d ? '+' + d : '') + '</td></tr>';
      }).join('');

    $('#meters').innerHTML =
      m(S.mSum, String(r.sum), S.uByte, '') +
      m(S.mSize, String(r.size), S.uByte, r.size !== r.sum ? 'bad' : 'good') +
      m(S.mInner, String(r.innerPad), S.uByte, r.innerPad ? 'bad' : 'good') +
      m(S.mTail, String(r.tail), S.uByte, r.tail ? 'bad' : 'good') +
      m(S.mAlign, String(r.structAlign), S.uByte, '') +
      m(S.mFirst, r.firstMis ? r.firstMis.name : S.none, '', r.firstMis ? 'bad' : 'good') +
      m(S.mDrift, String(r.arrDrift), S.uByte, r.arrDrift ? 'bad' : 'good');

    /* 배치 세 벌 비교 */
    $('#cmp').innerHTML =
      '<tr><th>' + S.cLayout + '</th><th>' + S.cSum + '</th><th>' + S.cSize + '</th><th>' +
      S.cInner + '</th><th>' + S.cTail + '</th></tr>' +
      Object.keys(LAYOUTS).map(k => {
        const x = calc({ ...c, layout: k });
        return '<tr class="' + (k === layout ? 'on' : '') + '"><td>' + S['n_' + k] + '</td>' +
          '<td class="num2">' + x.sum + '</td>' +
          '<td class="num2 ' + (x.size === x.sum ? 'good' : 'bad') + '">' + x.size + '</td>' +
          '<td class="num2">' + x.innerPad + '</td><td class="num2">' + x.tail + '</td></tr>';
      }).join('');

    /* 판정 */
    const v = $('#verdict');
    let msg, cls;
    if (r.tail && n > 1) {
      msg = S.vTail.replace('$1', String(r.tail)).replace('$2', String(n)).replace('$3', String(r.arrDrift)); cls = ' stuck';
    } else if (r.firstMis) {
      msg = S.vMis.replace('$1', r.firstMis.name).replace('$2', String(r.firstMis.start))
        .replace('$3', String(r.firstMis.nstart))
        .replace('$4', String(r.fields.length - r.firstMis.i)); cls = ' stuck';
    } else if (r.size !== r.sum) {
      msg = S.vSizeOnly.replace('$1', String(r.sum)).replace('$2', String(r.size)); cls = ' stuck';
    } else {
      msg = S.vClean.replace('$1', String(r.size)); cls = ' ok';
    }
    v.className = 'verdict' + cls;
    v.innerHTML = msg;

    const h = $('#hint');
    h.className = 'hint' + (r.firstMis || r.tail ? ' warn' : '');
    h.textContent = r.firstMis ? S.hMis.replace('$1', r.firstMis.name)
      : (r.tail ? S.hTail.replace('$1', String(r.tail)) : S.hOk);
  }

  /* --- 시나리오 --- */
  const SCENE = [
    { layout: 'decl', pack: 0, n: 1 },
    { layout: 'big', pack: 0, n: 1 },
    { layout: 'decl', pack: 1, n: 1 },
    { layout: 'decl', pack: 4, n: 1 },
    { layout: 'tail', pack: 0, n: 1 },
    { layout: 'tail', pack: 0, n: 3 },
    { layout: 'big', pack: 0, n: 3 }
  ];

  function applyStep() {
    const s = SCENE[idx];
    layout = s.layout; pack = s.pack; n = s.n;
    syncDials();
    $('#nStep').textContent = pad(idx + 1) + ' / ' + pad(SCENE.length);
    $('#nText').textContent = S.scene[idx];
    $('#btnStep').disabled = idx >= SCENE.length - 1;
    $('#btnPrev').disabled = idx <= 0;
    render();
  }
  const pad = x => String(x).padStart(2, '0');

  function syncDials() {
    $('#sN').value = String(n); $('#vN').innerHTML = n + '<small>' + S.uElem + '</small>';
    press('#segLayout', b => b.dataset.l === layout);
    press('#segPack', b => +b.dataset.p === pack);
  }
  const press = (sel, fn) => $$(sel + ' button').forEach(b => b.setAttribute('aria-pressed', fn(b) ? 'true' : 'false'));

  $('#sN').oninput = e => { n = +e.target.value; syncDials(); render(); };
  $$('#segLayout button').forEach(b => b.onclick = () => { layout = b.dataset.l; syncDials(); render(); });
  $$('#segPack button').forEach(b => b.onclick = () => { pack = +b.dataset.p; syncDials(); render(); });

  $('#btnStep').onclick = () => { if (idx < SCENE.length - 1) { idx++; applyStep(); } };
  $('#btnPrev').onclick = () => { if (idx > 0) { idx--; applyStep(); } };
  $('#btnReset').onclick = () => { idx = 0; applyStep(); };
  $('#btnPrev').disabled = true;

  applyStep();

  /* 검증용 — 배포되는 코드 그대로 수치를 읽을 수 있게 열어둔다 (tools/ 참고) */
  window.LAB = {
    set(o) {
      if (o.layout) layout = o.layout;
      if (o.pack != null) pack = o.pack;
      if (o.n != null) n = o.n;
      if (!LAYOUTS[layout]) throw new Error('없는 배치: ' + layout);
      syncDials(); render(); return window.LAB;
    },
    calc, scene: SCENE, tables: { LAYOUTS },
    exact: () => cur(),
    get cfg() { return { layout, pack, n }; }
  };
})();
