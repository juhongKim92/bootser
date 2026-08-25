/* ============================================================
   30. 스레드를 늘렸더니 느려졌다 — Amdahl 과 USL
   ------------------------------------------------------------
   두 식만 쓴다.

     Amdahl   S(n) = n / (1 + σ(n−1))                상한은 1/σ
     USL      C(n) = n / (1 + σ(n−1) + κn(n−1))      정점은 n* = √((1−σ)/κ)

   σ 는 직렬 구간의 비율, κ 는 일관성 비용(경합·캐시 무효화·락 대기)이다.
   **둘 다 손잡이로 노출한다** — 내가 고른 상수가 아니라 모델의 입력이다.
   그래서 검증할 대상은 계수가 아니라 **식이 만드는 두 지점**이다:
   Amdahl 상한 1/σ 와 USL 정점 √((1−σ)/κ). 둘 다 닫힌 형태로 유도된다.

   응답시간은 리틀의 법칙으로 낸다 — R(n) = n / C(n). 08 · 19 · 05 에 이어
   같은 식이 네 번째로 나온다. 난수가 없다.
   ============================================================ */
(function () {
  const S = window.LAB_I18N;
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];

  const SIGMAS = [0.01, 0.02, 0.05, 0.10, 0.20];      /* 직렬 비율 후보 */
  const KAPPAS = [0, 0.0002, 0.0005, 0.001, 0.005];   /* 일관성 비용 후보 (0 = Amdahl) */
  const NMAX = 256, COLS = 60;

  /* --- 손잡이 --- */
  let n = 1, sigma = 0.05, kappa = 0.001;
  let idx = 0;

  /* --- 모델 --------------------------------------------------------- */
  const amdahl = (x, s) => x / (1 + s * (x - 1));
  const usl = (x, s, k) => x / (1 + s * (x - 1) + k * x * (x - 1));
  const ceiling = s => 1 / s;                                  /* Amdahl 상한 */
  const peakAt = (s, k) => k > 0 ? Math.sqrt((1 - s) / k) : Infinity;

  function model(o) {
    const p = peakAt(o.sigma, o.kappa);
    const pInt = isFinite(p) ? Math.max(1, Math.round(p)) : null;
    const now = usl(o.n, o.sigma, o.kappa);
    const best = pInt ? usl(pInt, o.sigma, o.kappa) : usl(NMAX, o.sigma, o.kappa);
    return {
      now, am: amdahl(o.n, o.sigma), cap: ceiling(o.sigma),
      peak: p, peakInt: pInt, best,
      lat: o.n / now,                                          /* 리틀의 법칙 */
      latBest: pInt ? pInt / best : 1,
      /* 정점 판정은 **정수로 반올림한 값**과 비교한다. 실수 30.82 와 비교하면
         n=31 이 "넘었다" 로 잡혀 1.00배 하락이라는 이상한 문장이 나온다. */
      atPeak: pInt !== null && o.n === pInt,
      past: pInt !== null && o.n > pInt,
      drop: best / now,                                         /* 정점 대비 처리량 하락 */
      latX: (o.n / now) / (pInt ? pInt / best : 1)               /* 정점 대비 응답시간 */
    };
  }
  const cfg = over => Object.assign({ n, sigma, kappa }, over || {});
  const cur = () => model(cfg());

  /* --- 표기 --- */
  const f2 = v => (Math.round(v * 100) / 100).toFixed(2);
  const f1 = v => (Math.round(v * 10) / 10).toFixed(1);
  const pc = v => (v * 100).toFixed(v * 100 >= 10 ? 0 : 1);
  const fill = (str, ...v) => v.reduce((a, x, i) => a.split('$' + (i + 1)).join(x), str);
  const meter = (k, x, u, cls) =>
    '<div class="m ' + (cls || '') + '"><span class="k">' + k + '</span><span class="n">' + x +
    (u ? '<small>' + u + '</small>' : '') + '</span></div>';

  /* --- 두 곡선 --- */
  function drawCurve() {
    const o = cfg(), m = cur();
    /* 가로는 스레드 수(로그에 가깝게 고르게), 세로는 처리량 */
    const xs = [];
    for (let i = 1; i <= COLS; i++) xs.push(Math.max(1, Math.round(Math.pow(NMAX, i / COLS))));
    const top = Math.max(m.cap, ...xs.map(x => amdahl(x, o.sigma))) * 1.04;
    let html = '';
    xs.forEach((x, i) => {
      const a = amdahl(x, o.sigma), u = usl(x, o.sigma, o.kappa);
      const here = Math.abs(x - o.n) <= Math.max(1, o.n * 0.06) ? ' here' : '';
      const isPeak = m.peakInt && Math.abs(x - m.peakInt) <= Math.max(1, m.peakInt * 0.06);
      html += '<div class="col' + here + (isPeak ? ' peak' : '') +
        '" style="left:' + (i / COLS * 100).toFixed(2) + '%" title="' +
        fill(S.cvTip, x, f2(u), f2(a)) + '">' +
        '<div class="am" style="height:' + (a / top * 100).toFixed(2) + '%"></div>' +
        '<div class="us" style="height:' + (u / top * 100).toFixed(2) + '%"></div></div>';
    });
    html += '<div class="cap" style="bottom:' + (m.cap / top * 100).toFixed(2) + '%"></div>' +
      '<div class="caplbl" style="bottom:' + (m.cap / top * 100 + 1.5).toFixed(2) + '%">' +
      fill(S.cvCap, f1(m.cap)) + '</div>';
    if (m.peakInt) {
      const pos = Math.log(m.peakInt) / Math.log(NMAX) * 100;
      html += '<div class="peaklbl" style="left:' + pos.toFixed(2) + '%;top:0">' +
        fill(S.cvPeak, m.peakInt) + '</div>';
    }
    $('#curve').innerHTML = html;
    $('#curveX').innerHTML = [1, 16, NMAX].map(v => '<span>' + v + '</span>').join('');
    $('#curveY').innerHTML = fill(S.cvY, f1(m.cap));
  }

  /* --- 응답시간 --- */
  function drawLat() {
    const o = cfg(), m = cur();
    const picks = [1, 8, 16, m.peakInt || 32, 64, 128, 256].filter((v, i, a) => a.indexOf(v) === i).sort((a, b) => a - b);
    const lats = picks.map(x => ({ x, lat: x / usl(x, o.sigma, o.kappa) }));
    const max = Math.max(...lats.map(l => l.lat));
    $('#lat').innerHTML = lats.map(l =>
      '<div class="row ' + (l.x === m.peakInt ? 'peak' : (m.peakInt && l.x > m.peakInt ? 'over' : '')) +
      (l.x === o.n ? ' on' : '') + '">' +
      '<span class="rn">' + fill(S.lThreads, l.x) + (l.x === m.peakInt ? ' ' + S.lPeak : '') + '</span>' +
      '<span class="bar" style="width:' + (l.lat / max * 100).toFixed(1) + '%"></span>' +
      '<span class="rv">×' + f2(l.lat) + '</span></div>').join('');
  }

  /* --- 조건별 표 --- */
  function drawTable() {
    const o = cfg(), m = cur();
    const picks = [1, 8, 16, m.peakInt || 32, 64, 128, 256].filter((v, i, a) => a.indexOf(v) === i).sort((a, b) => a - b);
    $('#four').innerHTML =
      '<tr><th>' + S.tN + '</th><th>' + S.tUsl + '</th><th>' + S.tAm + '</th><th>' +
      S.tLat + '</th><th>' + S.tVs + '</th></tr>' +
      picks.map(x => {
        const u = usl(x, o.sigma, o.kappa), a = amdahl(x, o.sigma);
        const over = m.peakInt && x > m.peakInt;
        return '<tr class="' + (x === o.n ? 'on' : '') + '"><td>' + x +
          (x === m.peakInt ? ' ' + S.lPeak : '') + '</td>' +
          '<td class="' + (over ? 'bad' : 'good') + '">' + f2(u) + '</td>' +
          '<td>' + f2(a) + '</td>' +
          '<td class="' + (over ? 'bad' : '') + '">×' + f2(x / u) + '</td>' +
          '<td>' + f2(a / u) + '</td></tr>';
      }).join('');
  }

  function drawMeters() {
    const o = cfg(), m = cur();
    $('#meters').innerHTML =
      meter(S.mNow, f2(m.now), '', m.past ? 'bad' : 'good') +
      meter(S.mCap, '×' + f1(m.cap), '', '') +
      meter(S.mPeak, m.peakInt || '∞', m.peakInt ? S.uThreads : '', '') +
      meter(S.mBest, m.peakInt ? f2(m.best) : '—', '', '') +
      meter(S.mLat, '×' + f2(m.lat), '', m.lat > 3 ? 'bad' : '') +
      meter(S.mAm, f2(m.am), '', '');

    /* 판정 */
    const v = $('#verdict');
    let msg, cls;
    if (o.kappa === 0) {
      msg = fill(S.vAmdahl, f1(m.cap), f2(m.now), f2(m.lat));
      cls = ' ok';
    } else if (m.past) {
      msg = fill(S.vPast, o.n, m.peakInt, f2(m.best), f2(m.now), f2(m.drop), f2(m.latX));
      cls = ' stuck';
    } else if (m.atPeak) {
      msg = fill(S.vAt, m.peakInt, f2(m.now), f2(m.lat), f1(m.cap));
      cls = ' ok';
    } else {
      msg = fill(S.vUnder, o.n, m.peakInt, f2(m.now), f2(m.best), f1(m.cap));
      cls = ' ok';
    }
    v.className = 'verdict' + cls;
    v.innerHTML = msg;
  }

  function drawHint() {
    const o = cfg(), m = cur();
    const h = $('#hint');
    h.className = 'hint' + (m.past ? ' warn' : '');
    h.innerHTML = fill(S.hint, o.n, pc(o.sigma), o.kappa, f2(m.now), f2(m.lat));
  }

  function layout() { drawCurve(); drawLat(); drawTable(); drawMeters(); drawHint(); }

  /* --- 시나리오 --- */
  const SCENE = [
    { n: 1, sigma: 0.05, kappa: 0 },
    { n: 256, sigma: 0.05, kappa: 0 },
    { n: 256, sigma: 0.05, kappa: 0.001 },
    { n: 31, sigma: 0.05, kappa: 0.001 },
    { n: 64, sigma: 0.05, kappa: 0.001 },
    { n: 31, sigma: 0.02, kappa: 0.001 },
    { n: 14, sigma: 0.05, kappa: 0.005 }
  ];

  function applyStep() {
    const c = SCENE[idx];
    n = c.n; sigma = c.sigma; kappa = c.kappa;
    syncDials();
    $('#nStep').textContent = pad(idx + 1) + ' / ' + pad(SCENE.length);
    $('#nText').textContent = S.scene[idx];
    $('#btnStep').disabled = idx >= SCENE.length - 1;
    $('#btnPrev').disabled = idx <= 0;
    layout();
  }
  const pad = x => String(x).padStart(2, '0');

  function syncDials() {
    $('#sN').value = String(n); $('#vN').innerHTML = n + '<small>' + S.uThreads + '</small>';
    const si = SIGMAS.indexOf(sigma);
    if (si >= 0) $('#sS').value = String(si);
    $('#vS').innerHTML = pc(sigma) + '<small>%</small>';
    const ki = KAPPAS.indexOf(kappa);
    if (ki >= 0) $('#sK').value = String(ki);
    $('#vK').innerHTML = (kappa === 0 ? S.uNone : String(kappa));
  }

  /* --- 구동 --- */
  const bind = (sel, fn) => { $(sel).oninput = e => { fn(+e.target.value); syncDials(); layout(); }; };
  bind('#sN', v => n = v);
  bind('#sS', v => sigma = SIGMAS[v]);
  bind('#sK', v => kappa = KAPPAS[v]);

  $('#btnStep').onclick = () => { if (idx < SCENE.length - 1) { idx++; applyStep(); } };
  $('#btnPrev').onclick = () => { if (idx > 0) { idx--; applyStep(); } };
  $('#btnReset').onclick = () => { idx = 0; applyStep(); };
  $('#btnPrev').disabled = true;

  applyStep();

  /* 검증용 — 배포되는 코드 그대로 수치를 읽을 수 있게 열어둔다.
     ceiling · peakAt 이 이 편의 검산점이다 (Amdahl 상한과 USL 정점). */
  window.LAB = {
    set(o) {
      for (const [k, v] of Object.entries(o)) {
        if (k === 'n') n = v; else if (k === 'sigma') sigma = v; else if (k === 'kappa') kappa = v;
      }
      syncDials(); layout(); return window.LAB;
    },
    model, cur, amdahl, usl, ceiling, peakAt,
    SIGMAS, KAPPAS, NMAX, scene: SCENE,
    m: over => model(cfg(over)),
    get dials() { return { n, sigma, kappa }; }
  };
})();
