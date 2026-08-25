/* ============================================================
   24. 서버는 안 느려졌는데 사용자는 느려졌다 — 팬아웃과 꼬리 지연
   ------------------------------------------------------------
   한 화면이 서버 N 대를 병렬로 부르고, 그 라운드를 s 번 돈다. 잎 하나의 응답은
   두 점이다 — 빠름 10ms, 느림 1000ms. 느릴 확률이 p 이고 서로 독립이면,
   "적어도 하나가 느릴 확률" 은 1 − (1−p)^(N·s) 다.

   hedge 를 켜면 첫 응답이 H 밀리초 안에 안 오는 잎에만 사본을 하나 더 보낸다.
   두 번 다 느려야 느린 것이니 잎의 꼬리 확률이 p² 로 떨어지고, 추가 요청은
   H 가 빠른 응답(10ms)보다 뒤면 p, 앞이면 전부(100%)다.

   전부 닫힌 형태라 열거조차 필요 없다 — 난수가 없고 같은 손잡이면 같은 수치다.
   화면의 지연(ms)은 두 점의 확률 가중 평균이다. 논문의 실측치는 본문 인용으로만
   쓰고 이 모델의 출력으로 섞지 않는다.
   ============================================================ */
(function () {
  const S = window.LAB_I18N;
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];

  const FAST = 10;        // 잎 하나의 몸통
  const SLOW = 1000;      // 잎 하나의 꼬리
  const PS = [0.0005, 0.001, 0.002, 0.005, 0.01, 0.02, 0.05];
  const COLS = 20;        // 곡선 막대 수 — 폭 10, 20, … 200
  const COL_STEP = 10;

  /* --- 손잡이 --- */
  let N = 100, p = 0.01, s = 1, hedge = false, H = 30;
  let idx = 0;

  /* --- 모델 ------------------------------------------------------------
     a = 라운드가 전부 빠를 확률, b = hedge 를 켰을 때 라운드가 꼬리를 피할 확률.
     hedge 를 끄면 b 는 a 와 같다 — 건지는 몫이 0 이 된다. */
  function calc(o) {
    const n = o.N, pr = o.p, rounds = o.s, hg = o.hedge, hd = o.H;
    const a = Math.pow(1 - pr, n);
    const b = hg ? Math.pow(1 - pr * pr, n) : a;
    const mid = Math.min(SLOW, hd + FAST);
    const q = 1 - Math.pow(b, rounds);
    const round = FAST * a + mid * (b - a) + SLOW * (1 - b);
    return {
      q, a, b, mid,
      mean: rounds * round,
      extra: hg ? (hd < FAST ? 1 : pr) : 0,
      K: n * rounds,
      amp: q / pr,
      /* 중앙값이 꼬리로 넘어가는 첫 폭 — (1−p)^(N·s) < 0.5 를 만족하는 최소 N */
      nStar: Math.floor(Math.log(0.5) / (rounds * Math.log(1 - pr))) + 1
    };
  }
  const cfg = (over) => Object.assign({ N, p, s, hedge, H }, over || {});
  const cur = () => calc(cfg());

  /* --- 표기 --- */
  const pc = v => v === 0 ? '0' : v >= 10 ? v.toFixed(1) : v >= 1 ? v.toFixed(2) : v.toFixed(3);
  const pp = v => v >= 1 ? String(v) : v.toFixed(2);
  const ms = t => t < 2000 ? Math.round(t) + S.uMs : (t / 1000).toFixed(2) + S.uSec;
  const fill = (str, ...v) => v.reduce((acc, x, i) => acc.split('$' + (i + 1)).join(x), str);
  const m = (k, n, u, cls) =>
    '<div class="m ' + (cls || '') + '"><span class="k">' + k + '</span><span class="n">' + n +
    (u ? '<small>' + u + '</small>' : '') + '</span></div>';

  /* --- 사용자 100명 격자 -------------------------------------------------
     한 칸이 사용자 한 명. 채워진 칸은 기대값을 반올림한 것이라 캡션에 그렇게 적는다. */
  function drawGrid() {
    const on = cur();
    const off = calc(cfg({ hedge: false }));
    const hit = Math.round(on.q * 100);
    const saved = Math.max(0, Math.round(off.q * 100) - hit);
    let html = '';
    for (let i = 0; i < 100; i++)
      html += '<i class="' + (i < hit ? 'hit' : i < hit + saved ? 'saved' : '') + '"></i>';
    $('#grid').innerHTML = html;
    $('#gridCap').innerHTML = hedge
      ? fill(S.gcHedge, '<b>' + hit + '</b>', '<span class="sv">' + saved + '</span>', pc(on.q * 100))
      : fill(S.gcPlain, '<b>' + hit + '</b>', pp(p * 100), pc(on.q * 100));
  }

  /* --- 폭에 따른 곡선 ----------------------------------------------------
     바깥 막대 = hedge 를 끈 꼬리 확률, 안쪽 = 켠 것. 차이가 hedge 가 자르는 몫이다. */
  function drawCurve() {
    let html = '';
    for (let i = 1; i <= COLS; i++) {
      const n = i * COL_STEP;
      const off = calc(cfg({ N: n, hedge: false }));
      const on = calc(cfg({ N: n, hedge: true }));
      const here = Math.abs(n - N) <= COL_STEP / 2 ? ' here' : '';
      html += '<div class="col' + here + '" title="' + fill(S.cvTip, n, pc(off.q * 100), pc(on.q * 100)) + '">' +
        '<div class="off" style="height:' + (off.q * 100).toFixed(2) + '%">' +
        '<div class="on" style="height:' + (off.q > 0 ? (on.q / off.q * 100).toFixed(2) : 0) + '%"></div>' +
        '</div></div>';
    }
    $('#curve').innerHTML = html;
    $('#curveX').innerHTML = [COL_STEP, COLS * COL_STEP / 2, COLS * COL_STEP]
      .map(v => '<span>' + v + '</span>').join('');
    $('#curveY').innerHTML = S.cvY;
  }

  /* --- 라운드 하나의 응답 분해 — 세 점의 확률과 값 --- */
  function drawSplit() {
    const x = cur();
    const rows = [
      { k: S.spFast, t: FAST, prob: x.a, cls: 'f' },
      { k: fill(S.spSaved, H), t: x.mid, prob: x.b - x.a, cls: 'm' },
      { k: S.spTail, t: SLOW, prob: 1 - x.b, cls: 's', tail: true }
    ];
    $('#split').innerHTML =
      '<tr><th>' + S.spWhat + '</th><th>' + S.spWhen + '</th><th>' + S.spHow + '</th><th></th></tr>' +
      rows.map(r =>
        '<tr' + (r.tail ? ' class="tail"' : '') + '><td>' + r.k + '</td><td>' + Math.round(r.t) + S.uMs +
        '</td><td>' + pc(r.prob * 100) + '%</td>' +
        '<td><span class="bar ' + r.cls + '" style="width:' + (r.prob * 100).toFixed(2) + '%"></span></td></tr>'
      ).join('') +
      '<tr><td>' + S.spMean + '</td><td>' + Math.round(x.mean) + S.uMs + '</td><td>&mdash;</td><td></td></tr>';
  }

  function drawMeters() {
    const x = cur();
    $('#meters').innerHTML =
      m(S.mTail, pc(x.q * 100), '%', x.q > 0.05 ? 'bad' : 'good') +
      m(S.mAmp, '×' + pc(x.amp), '', x.amp > 2 ? 'bad' : 'good') +
      m(S.mK, x.K, '', '') +
      m(S.mMean, Math.round(x.mean), S.uMs, x.mean > 100 ? 'bad' : 'good') +
      m(S.mExtra, pc(x.extra * 100), '%', x.extra > 0.1 ? 'bad' : 'good') +
      m(S.mFlip, x.nStar, '', '');

    /* hedge 끔 / 켬 — 같은 설정에서 hedge 만 뒤집는다 */
    const off = calc(cfg({ hedge: false })), on = calc(cfg({ hedge: true }));
    const cell = (mine, other, txt, lowerBetter) =>
      '<td class="num' + (Math.abs(mine - other) < 1e-12 ? ' same'
        : (lowerBetter ? (mine < other ? ' good' : ' bad') : (mine > other ? ' good' : ' bad'))) + '">' + txt + '</td>';
    const row = (label, o, other, isCur) =>
      '<tr class="' + (isCur ? 'on' : '') + '"><td>' + label + '</td>' +
      cell(o.q, other.q, pc(o.q * 100) + '%', true) +
      cell(o.amp, other.amp, '×' + pc(o.amp), true) +
      cell(o.mean, other.mean, Math.round(o.mean) + S.uMs, true) +
      cell(o.extra, other.extra, pc(o.extra * 100) + '%', true) + '</tr>';
    $('#cmp').innerHTML =
      '<tr><th>' + S.cHedge + '</th><th>' + S.cTail + '</th><th>' + S.cAmp + '</th><th>' +
      S.cMean + '</th><th>' + S.cExtra + '</th></tr>' +
      row(S.cOff, off, on, !hedge) + row(S.cOn, on, off, hedge);

    /* 판정 */
    const v = $('#verdict');
    let msg, cls;
    if (x.q >= 0.5) {
      msg = fill(S.vHalf, pc(x.q * 100), pp(p * 100), pc(x.amp), x.nStar);
      cls = ' stuck';
    } else if (x.q >= 0.05) {
      msg = fill(S.vAmp, pc(x.q * 100), pp(p * 100), pc(x.amp), x.nStar, N);
      cls = ' stuck';
    } else if (hedge) {
      msg = fill(S.vHedge, pc(x.q * 100), pc(off.q * 100), pc(x.extra * 100), Math.round(x.mean));
      cls = ' ok';
    } else {
      msg = fill(S.vOk, pc(x.q * 100), pp(p * 100), pc(x.amp), x.nStar);
      cls = ' ok';
    }
    v.className = 'verdict' + cls;
    v.innerHTML = msg;
  }

  function drawHint() {
    const x = cur();
    const h = $('#hint');
    h.className = 'hint' + (x.q >= 0.05 ? ' warn' : '');
    h.innerHTML = fill(S.hint, N, pp(p * 100), s, x.K, pc(x.q * 100), ms(x.mean));
  }

  function layout() { drawGrid(); drawCurve(); drawSplit(); drawMeters(); drawHint(); }

  /* --- 시나리오 --- */
  const SCENE = [
    { N: 1, p: 0.01, s: 1, hedge: false, H: 30 },
    { N: 100, p: 0.01, s: 1, hedge: false, H: 30 },
    { N: 69, p: 0.01, s: 1, hedge: false, H: 30 },
    { N: 100, p: 0.001, s: 1, hedge: false, H: 30 },
    { N: 100, p: 0.01, s: 1, hedge: true, H: 30 },
    { N: 100, p: 0.01, s: 1, hedge: true, H: 5 },
    { N: 100, p: 0.01, s: 2, hedge: false, H: 30 }
  ];

  function applyStep() {
    const c = SCENE[idx];
    N = c.N; p = c.p; s = c.s; hedge = c.hedge; H = c.H;
    syncDials();
    $('#nStep').textContent = pad(idx + 1) + ' / ' + pad(SCENE.length);
    $('#nText').textContent = S.scene[idx];
    $('#btnStep').disabled = idx >= SCENE.length - 1;
    $('#btnPrev').disabled = idx <= 0;
    layout();
  }
  const pad = n => String(n).padStart(2, '0');

  function syncDials() {
    $('#sN').value = String(N); $('#vN').innerHTML = N + '<small>' + S.uServers + '</small>';
    const pi = PS.indexOf(p);
    if (pi >= 0) $('#sP').value = String(pi);
    $('#vP').innerHTML = pp(p * 100) + '<small>%</small>';
    $('#sS').value = String(s); $('#vS').innerHTML = s + '<small>' + S.uRounds + '</small>';
    $('#sH').value = String(H); $('#vH').innerHTML = H + '<small>' + S.uMs + '</small>';
    press('#segHedge', b => (b.dataset.hedge === '1') === hedge);
  }
  const press = (sel, fn) => $$(sel + ' button').forEach(b => b.setAttribute('aria-pressed', fn(b) ? 'true' : 'false'));

  /* --- 구동 --- */
  const bind = (sel, fn) => { $(sel).oninput = e => { fn(+e.target.value); syncDials(); layout(); }; };
  bind('#sN', v => N = v);
  bind('#sP', v => p = PS[v]);
  bind('#sS', v => s = v);
  bind('#sH', v => H = v);

  $$('#segHedge button').forEach(b => b.onclick = () => { hedge = b.dataset.hedge === '1'; syncDials(); layout(); });
  $('#btnStep').onclick = () => { if (idx < SCENE.length - 1) { idx++; applyStep(); } };
  $('#btnPrev').onclick = () => { if (idx > 0) { idx--; applyStep(); } };
  $('#btnReset').onclick = () => { idx = 0; applyStep(); };
  $('#btnPrev').disabled = true;

  applyStep();

  /* 검증용 — 배포되는 코드 그대로 수치를 읽을 수 있게 열어둔다 */
  window.LAB = {
    set(o) {
      for (const [k, v] of Object.entries(o)) {
        if (k === 'N') N = v; else if (k === 'p') p = v; else if (k === 's') s = v;
        else if (k === 'hedge') hedge = v; else if (k === 'H') H = v;
      }
      syncDials(); layout(); return window.LAB;
    },
    calc, cur, scene: SCENE, PS,
    get cfg() { return { N, p, s, hedge, H }; }
  };
})();
