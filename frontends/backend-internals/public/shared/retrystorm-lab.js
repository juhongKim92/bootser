/* ============================================================
   14. 부하는 걷혔는데 돌아오지 않는다 — 재시도 증폭과 메타스터블
   ------------------------------------------------------------
   모델: 클라이언트는 타임아웃 T 에 포기하고 재시도한다. 그런데 서버 큐에는
   그 요청이 그대로 남아 끝까지 처리된다 — 아무도 받지 않을 응답을 만드는
   것이 낭비이고, 이 낭비가 용량을 먹어 다음 요청도 늦게 만든다.
   증폭 배수 A = r^L 이 클수록 갇힌 상태에서 스스로 나오지 못한다.
   ============================================================ */
(function () {
  const S = window.LAB_I18N;
  const $ = s => document.querySelector(s);

  /* --- 모델 상수 --- */
  const C = 100;          // 서버 용량 req/s
  const T = 1.0;          // 클라이언트 타임아웃 s
  const QMAX = 500;       // 서버 큐 상한
  const DT = 0.05;        // 시뮬레이션 스텝 s
  const BASE = 0.3;       // 백오프 기본 s
  const KSPREAD = 8;      // 지터가 코호트를 펼치는 조각 수
  const SPIKE = 160;      // 스파이크 부하 req/s
  const SPIKE_SECS = 20;  // 스파이크 지속
  const SUB = 4;          // 화면 한 틱당 시뮬레이션 스텝 수
  const TICK_MS = 60;
  const COLS = 300;       // 시계열 폭 (= 60초)
  const YMAX = 200;       // 시계열 세로 눈금 req/s

  /* --- 손잡이 --- */
  let lam = 60, L = 3, r = 3, jitter = false, breaker = false;
  let running = true, playSpeed = 1, idx = 0, timer = null;

  /* --- 상태 --- */
  let q, qn, tSim, tick, pool, brOpen, brUntil, win, spikeEnd, trace, ema;
  const A = () => Math.pow(r, L);
  const recThreshold = () => C / A();          // 회복 임계 λ < C/A
  const spiking = () => tSim < spikeEnd;

  function reset() {
    q = []; qn = 0; tSim = 0; tick = 0; pool = new Map();
    brOpen = false; brUntil = 0; win = []; spikeEnd = -1;
    trace = []; ema = { att: 0, good: 0, waste: 0 };
  }

  /* --- 시뮬레이션 한 스텝 --- */
  function push(delay, n, att) {
    const k = (tick + Math.max(1, Math.round(delay / DT))) + '|' + att;
    pool.set(k, (pool.get(k) || 0) + n);
  }
  function retry(n, att) {
    if (att >= A()) return;                     // 재시도 예산 소진 — 최종 실패
    const b = BASE * Math.pow(2, Math.min(att - 1, 4));
    if (!jitter) { push(b, n, att + 1); return; }
    /* 지터는 클라이언트마다 독립이라 코호트를 [0,b] 에 고르게 펼친다 */
    for (let k = 0; k < KSPREAD; k++) push(b * (k + 0.5) / KSPREAD, n / KSPREAD, att + 1);
  }

  function step() {
    const lamNow = spiking() ? SPIKE : lam;
    let att = 0, ok = 0, waste = 0;

    if (breaker) {
      const a = win.reduce((s, x) => s + x.att, 0), o = win.reduce((s, x) => s + x.ok, 0);
      if (!brOpen && a > 20 && o / a < 0.5) { brOpen = true; brUntil = tSim + 5; }
      else if (brOpen && tSim >= brUntil) { brOpen = false; win = []; }
    } else brOpen = false;

    const arrivals = [[lamNow * DT, 1]];
    for (const [k, n] of [...pool]) {
      if (+k.split('|')[0] <= tick) { arrivals.push([n, +k.split('|')[1]]); pool.delete(k); }
    }
    for (const [n, at] of arrivals) {
      att += n;
      if (brOpen) continue;                     // 열려 있으면 즉시 거절하고 재시도도 안 건다
      const take = Math.min(Math.max(0, QMAX - qn), n);
      if (take > 0) { q.push({ n: take, age: 0, att: at, gone: false }); qn += take; }
      if (n - take > 1e-9) retry(n - take, at); // 큐가 꽉 참 → 즉시 실패 → 재시도
    }

    let cap = C * DT;
    while (cap > 1e-9 && q.length) {
      const h = q[0], tk = Math.min(cap, h.n);
      if (h.gone) waste += tk; else ok += tk;   // 이미 포기한 요청을 처리하는 건 낭비다
      h.n -= tk; cap -= tk; qn -= tk;
      if (h.n <= 1e-9) q.shift();
    }
    /* 클라이언트만 포기한다. 서버 큐에는 그대로 남는다 */
    for (const h of q) {
      h.age += DT;
      if (!h.gone && h.age > T) { h.gone = true; retry(h.n, h.att); }
    }

    win.push({ att, ok }); if (win.length > 40) win.shift();
    const a = 0.25;
    ema.att = ema.att * (1 - a) + (att / DT) * a;
    ema.good = ema.good * (1 - a) + (ok / DT) * a;
    ema.waste = ema.waste * (1 - a) + (waste / DT) * a;
    tSim += DT; tick++;
  }

  /* --- 그리기 --- */
  const f1 = n => n < 10 ? n.toFixed(1) : String(Math.round(n));
  const stale = () => q.reduce((s, h) => s + (h.gone ? h.n : 0), 0);

  function state() {
    if (spiking()) return 'spike';
    if (brOpen) return 'brk';
    if (ema.good >= Math.max(lam, 1) * 0.8) return 'ok';
    if (qn > QMAX * 0.5) return 'stuck';
    return 'drain';
  }

  function render() {
    const st = state(), amp = A();

    trace.push({ g: ema.good, l: spiking() ? SPIKE : lam, dead: ema.good < 1 });
    if (trace.length > COLS) trace.shift();
    $('#trace').innerHTML =
      '<div class="ref" style="bottom:' + (C / YMAX * 100) + '%"><span>' + S.refCap.replace('$1', C) + '</span></div>' +
      trace.map(p =>
        '<i class="load" style="height:' + Math.min(100, p.l / YMAX * 100) + '%"></i>' +
        '<i class="' + (p.dead ? 'dead' : '') + '" style="height:' + Math.min(100, p.g / YMAX * 100) + '%"></i>'
      ).join('');
    $('#traceX').innerHTML = '<span>' + S.axAgo.replace('$1', Math.round(COLS * DT * SUB)) + '</span><span>' + S.axNow + '</span>';

    const pct = qn / QMAX * 100, sp = stale() / QMAX * 100;
    $('#qFill').style.width = pct + '%';
    $('#qFill').className = 'fill' + (pct > 90 ? ' hot' : '');
    $('#qStale').style.width = sp + '%';
    $('#qMeta').innerHTML = '<span>' + S.qNow.replace('$1', Math.round(qn)).replace('$2', Math.round(stale())) + '</span>' +
      '<span>' + S.qMax.replace('$1', QMAX) + '</span>';

    $('#meters').innerHTML =
      m(S.mAtt, f1(ema.att), S.uPs, ema.att > C * 3 ? 'bad' : '') +
      m(S.mGood, f1(ema.good), S.uPs, ema.good < 1 ? 'bad' : (st === 'ok' ? 'good' : '')) +
      m(S.mWaste, f1(ema.waste), S.uPs, ema.waste > 1 ? 'bad' : '') +
      m(S.mAmp, String(amp), S.uX, amp > 1 ? '' : 'good');

    const v = $('#verdict');
    v.className = 'verdict' + (st === 'stuck' ? ' stuck' : (st === 'ok' ? ' ok' : ''));
    v.innerHTML = ({
      ok: S.vOk.replace('$1', f1(ema.good)),
      spike: S.vSpike.replace('$1', SPIKE).replace('$2', Math.max(0, spikeEnd - tSim).toFixed(0)),
      stuck: S.vStuck.replace('$1', lam).replace('$2', recThreshold().toFixed(1)).replace('$3', String(amp)),
      drain: S.vDrain, brk: S.vBrk
    })[st];

    /* 이력현상 눈금 — 무너지는 임계 C, 회복 임계 C/A */
    const x = n => Math.min(100, Math.max(0, n / YMAX * 100));
    $('#hyst').innerHTML = '<div class="ax"></div>' +
      '<div class="gap" style="left:' + x(recThreshold()) + '%;width:' + (x(C) - x(recThreshold())) + '%"></div>' +
      '<div class="mk rec" style="left:' + x(recThreshold()) + '%"><b>' + S.axRec.replace('$1', recThreshold().toFixed(1)) + '</b></div>' +
      '<div class="mk brk" style="left:' + x(C) + '%"><b>' + S.axBrk.replace('$1', C) + '</b></div>' +
      '<div class="now" style="left:' + x(spiking() ? SPIKE : lam) + '%"></div>';

    /* 같은 계층 수에서 재시도 횟수만 바꿔본 임계 */
    $('#cmp').innerHTML = '<tr><th>' + S.cR + '</th><th>' + S.cAmp + '</th><th>' + S.cRec + '</th><th>' + S.cGap + '</th></tr>' +
      [1, 2, 3, 4].map(rr => {
        const aa = Math.pow(rr, L), rec = C / aa;
        return '<tr class="' + (rr === r ? 'on' : '') + '"><td>' + S.cRv.replace('$1', rr) + '</td>' +
          '<td class="num">' + aa + S.uX + '</td>' +
          '<td class="num' + (aa > 1 ? ' bad' : ' good') + '">' + rec.toFixed(1) + S.uPs + '</td>' +
          '<td class="num">' + (aa === 1 ? S.cNone : S.cGapV.replace('$1', aa)) + '</td></tr>';
      }).join('');

    const h = $('#hint');
    h.className = 'hint' + (st === 'stuck' ? ' warn' : '');
    h.textContent = ({
      ok: S.hOk, spike: S.hSpike, drain: S.hDrain, brk: S.hBrk,
      stuck: S.hStuck.replace('$1', recThreshold().toFixed(1))
    })[st];

    $('#btnSpike').dataset.on = spiking() ? '1' : '0';
    $('#btnSpike').textContent = spiking() ? S.spiking : S.spike;
  }
  const m = (k, n, u, cls) =>
    '<div class="m ' + (cls || '') + '"><span class="k">' + k + '</span><span class="n">' + n + '<small>' + u + '</small></span></div>';

  /* --- 시나리오 --- */
  const SCENE = [
    { lam: 60, L: 3, r: 1, jitter: false, breaker: false, spike: false },
    { lam: 60, L: 3, r: 1, jitter: false, breaker: false, spike: true },
    { lam: 60, L: 3, r: 3, jitter: false, breaker: false, spike: true },
    { lam: 10, L: 3, r: 3, jitter: false, breaker: false, spike: true },
    { lam: 60, L: 3, r: 3, jitter: true, breaker: false, spike: true },
    { lam: 60, L: 3, r: 3, jitter: true, breaker: true, spike: true }
  ];

  function applyStep() {
    const s = SCENE[idx];
    lam = s.lam; L = s.L; r = s.r; jitter = s.jitter; breaker = s.breaker;
    syncDials();
    reset();
    if (s.spike) spikeEnd = SPIKE_SECS;          // 0초부터 20초까지 스파이크
    $('#nStep').textContent = pad(idx + 1) + ' / ' + pad(SCENE.length);
    $('#nText').textContent = S.scene[idx];
    $('#btnStep').disabled = idx >= SCENE.length - 1;
    $('#btnPrev').disabled = idx <= 0;
    render();
  }
  const pad = n => String(n).padStart(2, '0');

  function syncDials() {
    $('#sLam').value = String(lam); $('#vLam').innerHTML = lam + '<small>' + S.uPs + '</small>';
    $('#sL').value = String(L); $('#vL').innerHTML = L + '<small>' + S.uTier + '</small>';
    $('#sR').value = String(r); $('#vR').innerHTML = r + '<small>' + S.uTry + '</small>';
    press('#segJitter', 'on', jitter ? '1' : '0');
    press('#segBreaker', 'on', breaker ? '1' : '0');
  }
  const press = (sel, key, val) =>
    [...document.querySelectorAll(sel + ' button')].forEach(b => b.setAttribute('aria-pressed', b.dataset[key] === val));

  /* --- 구동 --- */
  function frame() { for (let i = 0; i < SUB; i++) step(); render(); }
  function start() { stop(); timer = setInterval(frame, TICK_MS / playSpeed); }
  function stop() { if (timer) { clearInterval(timer); timer = null; } }

  $('#sLam').oninput = e => { lam = +e.target.value; $('#vLam').innerHTML = lam + '<small>' + S.uPs + '</small>'; render(); };
  $('#sL').oninput = e => { L = +e.target.value; $('#vL').innerHTML = L + '<small>' + S.uTier + '</small>'; render(); };
  $('#sR').oninput = e => { r = +e.target.value; $('#vR').innerHTML = r + '<small>' + S.uTry + '</small>'; render(); };
  [...document.querySelectorAll('#segJitter button')].forEach(b => b.onclick = () => {
    jitter = b.dataset.on === '1'; press('#segJitter', 'on', b.dataset.on); render();
  });
  [...document.querySelectorAll('#segBreaker button')].forEach(b => b.onclick = () => {
    breaker = b.dataset.on === '1'; press('#segBreaker', 'on', b.dataset.on); render();
  });
  $('#btnSpike').onclick = () => { spikeEnd = tSim + SPIKE_SECS; render(); };
  $('#btnRun').onclick = () => {
    running = !running;
    $('#btnRun').textContent = running ? S.pause : S.resume;
    if (running) start(); else stop();
  };

  $('#btnStep').onclick = () => { if (idx < SCENE.length - 1) { idx++; applyStep(); } };
  $('#btnPrev').onclick = () => { if (idx > 0) { idx--; applyStep(); } };
  $('#btnReset').onclick = () => { idx = 0; applyStep(); };
  $('#btnPrev').disabled = true;                 // 첫 단계에서 시작한다
  [...document.querySelectorAll('#segSpeed button')].forEach(b => b.onclick = () => {
    playSpeed = +b.dataset.speed;
    [...document.querySelectorAll('#segSpeed button')].forEach(x => x.setAttribute('aria-pressed', x === b));
    if (running) start();                        // 돌고 있으면 새 간격으로 다시 건다
  });

  reset();
  applyStep();
  start();
})();
