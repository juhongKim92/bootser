/* ============================================================
   19. 대역폭은 남는데 처리량이 안 나온다 — BDP 와 제곱근 법칙
   ------------------------------------------------------------
   처리량에는 세 개의 한도가 있고, 실제 처리량은 그중 가장 작은 값이다.

     ① 대역폭            링크가 낼 수 있는 최대
     ② 동시성 ÷ RTT      한 번에 띄울 수 있는 양(창 × 커넥션)을 왕복시간으로 나눈 값
     ③ 손실 한도         N · MSS · √(3/2) / (RTT · √p)   — Mathis 제곱근 법칙

   ①이 병목이 아닌 구간에서는 대역폭을 아무리 올려도 처리량이 한 자리도 안 움직인다.
   ②는 리틀의 법칙이다 — 08 의 커넥션 풀, 05 의 Receive Maximum 과 같은 식이고
   단위만 바이트로 바뀐다.

   ③은 손실 기반 혼잡 제어(Reno · CUBIC 계열)의 근사식이다. 커넥션 수에 정비례하므로
   커넥션 6개짜리 HTTP/1.1 이 커넥션 1개짜리 HTTP/2 보다 6배 빨라질 수 있다.
   BBR 처럼 손실을 혼잡 신호로 쓰지 않는 제어는 이 식에서 벗어난다 — 본문에 밝혀뒀다.

   난수가 없다. 세 식의 min 이므로 화면의 모든 수치가 정확히 재현된다.
   ============================================================ */
(function () {
  const S = window.LAB_I18N;
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];

  const MSS = 1460;
  const C = Math.sqrt(1.5);          // ≈ 1.2247
  const KB = 1024, MB = 1024 * 1024;
  const SWEEP = 64;                  // 대역폭 곡선의 칸 수
  const SW_LO = 1e6, SW_HI = 2e10;   // 1 Mbps ~ 20 Gbps

  /* --- 손잡이 (대역폭·손실은 슬라이더 눈금 → 실제값 표로 옮긴다) --- */
  const BW = [1, 5, 10, 50, 100, 200, 500, 1000, 2500, 10000];              // Mbps
  const LOSS = [0, 0.0001, 0.001, 0.002, 0.005, 0.01, 0.05, 0.1, 0.5, 1];   // %
  const WIN = [16, 32, 64, 128, 256, 512, 1024, 4096, 16384];               // KB

  let bi = 7, wi = 2, li = 0;        // 1000 Mbps · 64KB · 손실 0
  let RTT = 100, N = 1;
  let idx = 0;

  const B = () => BW[bi] * 1e6;
  const W = () => WIN[wi] * KB;
  const P = () => LOSS[li] / 100;

  /* --- 모델 --- */
  function calc(o) {
    const b = o.B, rtt = o.RTT / 1000, w = o.W, n = o.N, p = o.p;
    const win = n * w / rtt * 8;
    const loss = p > 0 ? n * MSS * C / (rtt * Math.sqrt(p)) * 8 : Infinity;
    const t = Math.min(b, win, loss);
    return {
      t, bw: b, win, loss,
      limit: t === b ? 'bw' : (win <= loss ? 'win' : 'loss'),
      util: t / b,
      bdp: t / 8 * rtt,              // 그 처리량을 내려면 띄워야 하는 바이트
      inflight: n * w
    };
  }
  const cur = () => calc({ B: B(), RTT, W: W(), N, p: P() });

  /* --- 표시 --- */
  const mbps = x => {
    if (!isFinite(x)) return '∞';
    const m = x / 1e6;
    return m >= 1000 ? (m / 1000).toFixed(2) + ' Gbps' : m.toFixed(2) + ' Mbps';
  };
  const bytes = x => x >= MB ? (x / MB).toFixed(2) + ' MB' : (x / KB).toFixed(0) + ' KB';
  const pct = x => (x * 100).toFixed(x < 0.01 ? 3 : (x < 0.1 ? 2 : 1)) + '%';

  function render() {
    const r = cur();
    const scale = Math.max(r.bw, isFinite(r.win) ? r.win : 0, isFinite(r.loss) ? r.loss : 0);

    const row = (cls, name, v, wide) =>
      '<div class="cap3 ' + cls + '"><span class="nm">' + name + '</span>' +
      '<span class="tr"><span class="fl" style="width:' +
      (isFinite(v) ? Math.max(0.4, v / scale * 100) : 100) + '%"></span></span>' +
      '<span class="val">' + mbps(v) + '</span></div>';

    $('#caps').innerHTML =
      row(r.limit === 'bw' ? 'win' : '', S.cBw, r.bw) +
      row(r.limit === 'win' ? 'win' : '', S.cWin, r.win) +
      row((r.limit === 'loss' ? 'win' : '') + (isFinite(r.loss) ? '' : ' inf'), S.cLoss, r.loss) +
      row('out' + (r.util < 0.1 ? ' bad' : ''), S.cOut, r.t);

    /* 대역폭만 쓸어가며 처리량 — 나머지 손잡이는 그대로 둔다 */
    const bws = [...Array(SWEEP)].map((_, i) => SW_LO * Math.pow(SW_HI / SW_LO, i / (SWEEP - 1)));
    const vals = bws.map(b => calc({ B: b, RTT, W: W(), N, p: P() }));
    const ymax = Math.max(...vals.map(v => v.t));
    const nowI = bws.reduce((best, b, i) => Math.abs(Math.log(b / B())) < Math.abs(Math.log(bws[best] / B())) ? i : best, 0);
    $('#plot').innerHTML =
      '<span class="lbl">' + mbps(ymax) + '</span>' +
      vals.map((v, i) => '<i class="' + (i === nowI ? 'now' : (v.limit !== 'bw' ? 'flat' : '')) +
        '" style="height:' + Math.max(1, v.t / ymax * 100) + '%"></i>').join('');
    $('#plotX').innerHTML = ['1 Mbps', '', '1 Gbps', '', '20 Gbps'].map(s => '<span>' + s + '</span>').join('');

    $('#meters').innerHTML =
      m(S.mTput, mbps(r.t).split(' ')[0], mbps(r.t).split(' ')[1], '') +
      m(S.mUtil, pct(r.util), '', r.util < 0.1 ? 'bad' : (r.util > 0.8 ? 'good' : '')) +
      m(S.mLimit, S['n_' + r.limit], '', r.limit === 'bw' ? 'good' : 'bad') +
      m(S.mInflight, bytes(r.inflight), '', '') +
      m(S.mNeed, bytes(r.bw / 8 * (RTT / 1000)), '', '') +
      m(S.mRtts, (r.bw / r.t).toFixed(r.bw / r.t < 10 ? 1 : 0) + '×', '', r.bw / r.t > 2 ? 'bad' : 'good');

    /* 프로토콜 — 같은 경로에서 커넥션 수와 창만 다르다 */
    const P11 = calc({ B: B(), RTT, W: 64 * KB, N: 6, p: P() });
    const P2 = calc({ B: B(), RTT, W: 16 * MB, N: 1, p: P() });
    const best = Math.max(P11.t, P2.t);
    const prow = (name, v, conns, hol) =>
      '<tr><td>' + name + '</td>' +
      '<td class="num' + (Math.abs(v.t - best) < 1 ? ' good' : ' bad') + '">' + mbps(v.t) + '</td>' +
      '<td class="num">' + conns + '</td>' +
      '<td class="' + (hol ? 'bad' : 'good') + '">' + (hol ? S.holYes : S.holNo) + '</td></tr>';
    $('#cmp').innerHTML =
      '<tr><th>' + S.cProto + '</th><th>' + S.cTput + '</th><th>' + S.cConn + '</th><th>' + S.cHol + '</th></tr>' +
      prow(S.p11, P11, '6', false) + prow(S.p2, P2, '1', true) + prow(S.p3, P2, '1', false);

    /* 판정 */
    const v = $('#verdict');
    let msg, cls;
    if (r.limit === 'bw') {
      msg = S.vBw.replace('$1', mbps(r.t)).replace('$2', pct(r.util));
      cls = ' ok';
    } else if (r.limit === 'win') {
      msg = S.vWin.replace('$1', mbps(r.t)).replace('$2', pct(r.util))
        .replace('$3', bytes(r.inflight)).replace('$4', bytes(r.bw / 8 * (RTT / 1000)));
      cls = ' stuck';
    } else {
      msg = S.vLoss.replace('$1', mbps(r.t)).replace('$2', LOSS[li] + '%')
        .replace('$3', mbps(r.win)).replace('$4', String(N));
      cls = ' stuck';
    }
    v.className = 'verdict' + cls;
    v.innerHTML = msg;

    const h = $('#hint');
    h.className = 'hint' + (r.limit !== 'bw' ? ' warn' : '');
    h.textContent = r.limit === 'bw' ? S.hBw
      : (r.limit === 'win' ? S.hWin.replace('$1', mbps(r.bw)) : S.hLoss.replace('$1', mbps(r.bw)));
  }
  const m = (k, n, u, cls) =>
    '<div class="m ' + (cls || '') + '"><span class="k">' + k + '</span><span class="n">' + n +
    (u ? '<small>' + u + '</small>' : '') + '</span></div>';

  /* --- 시나리오 --- */
  const SCENE = [
    { bi: 7, RTT: 100, wi: 2, N: 1, li: 0 },   // 1Gbps · 100ms · 64KB · 1 · 무손실
    { bi: 9, RTT: 100, wi: 2, N: 1, li: 0 },   // 대역폭 10Gbps
    { bi: 9, RTT: 10, wi: 2, N: 1, li: 0 },    // RTT 10ms
    { bi: 9, RTT: 100, wi: 2, N: 6, li: 0 },   // 커넥션 6
    { bi: 9, RTT: 100, wi: 6, N: 1, li: 0 },   // 창 1MB
    { bi: 9, RTT: 100, wi: 6, N: 1, li: 7 },   // 손실 0.1% (LOSS[7])
    { bi: 9, RTT: 100, wi: 6, N: 6, li: 7 }    // 커넥션 6 + 손실 0.1%
  ];

  function applyStep() {
    const s = SCENE[idx];
    bi = s.bi; RTT = s.RTT; wi = s.wi; N = s.N; li = s.li;
    syncDials();
    $('#nStep').textContent = pad(idx + 1) + ' / ' + pad(SCENE.length);
    $('#nText').textContent = S.scene[idx];
    $('#btnStep').disabled = idx >= SCENE.length - 1;
    $('#btnPrev').disabled = idx <= 0;
    render();
  }
  const pad = n => String(n).padStart(2, '0');

  function syncDials() {
    $('#sB').value = String(bi);
    $('#vB').innerHTML = (BW[bi] >= 1000 ? BW[bi] / 1000 + '<small>Gbps</small>' : BW[bi] + '<small>Mbps</small>');
    $('#sR').value = String(RTT); $('#vR').innerHTML = RTT + '<small>ms</small>';
    $('#sW').value = String(wi);
    $('#vW').innerHTML = (WIN[wi] >= 1024 ? WIN[wi] / 1024 + '<small>MB</small>' : WIN[wi] + '<small>KB</small>');
    $('#sN').value = String(N); $('#vN').innerHTML = N + '<small>' + S.uConn + '</small>';
    $('#sL').value = String(li);
    $('#vL').innerHTML = (LOSS[li] === 0 ? '0' : LOSS[li]) + '<small>%</small>';
  }

  const bind = (sel, fn) => { $(sel).oninput = e => { fn(+e.target.value); syncDials(); render(); }; };
  bind('#sB', v => bi = v);
  bind('#sR', v => RTT = v);
  bind('#sW', v => wi = v);
  bind('#sN', v => N = v);
  bind('#sL', v => li = v);

  $('#btnStep').onclick = () => { if (idx < SCENE.length - 1) { idx++; applyStep(); } };
  $('#btnPrev').onclick = () => { if (idx > 0) { idx--; applyStep(); } };
  $('#btnReset').onclick = () => { idx = 0; applyStep(); };
  $('#btnPrev').disabled = true;

  applyStep();

  /* 검증용 — 배포되는 코드 그대로 수치를 읽을 수 있게 열어둔다 (tools/ 참고) */
  window.LAB = {
    set(o) {
      if (o.bwMbps != null) bi = BW.indexOf(o.bwMbps);
      if (o.winKB != null) wi = WIN.indexOf(o.winKB);
      if (o.lossPct != null) li = LOSS.indexOf(o.lossPct);
      if (o.RTT != null) RTT = o.RTT;
      if (o.N != null) N = o.N;
      if (bi < 0 || wi < 0 || li < 0) throw new Error('눈금에 없는 값: ' + JSON.stringify(o));
      syncDials(); render(); return window.LAB;
    },
    calc, scene: SCENE, tables: { BW, WIN, LOSS },
    exact: () => cur(),
    get cfg() { return { bwMbps: BW[bi], RTT, winKB: WIN[wi], N, lossPct: LOSS[li] }; }
  };
})();
