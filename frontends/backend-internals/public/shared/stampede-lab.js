/* ============================================================
   16. TTL 이 끝나는 순간 — 캐시 스탬피드
   ------------------------------------------------------------
   뜨거운 키 하나. TTL 이 끝나는 순간 그때 도착한 요청이 전부 캐시를
   비켜 지나가 각자 재계산을 시작한다. 만료 한 번당 중복 재계산은 λ·T.
   히트율은 TTL/(TTL+T) 이라 네 방식이 거의 같고, 그래서 히트율로는
   이 문제가 보이지 않는다.
   ============================================================ */
(function () {
  const S = window.LAB_I18N;
  const $ = s => document.querySelector(s);

  const DT = 0.002;       // 시뮬레이션 스텝 s
  const SUB = 60;         // 화면 한 틱당 스텝 수 (= 0.12초)
  const TICK_MS = 50;
  const COLS = 240;       // 시계열 폭 (= 28.8초)
  const BETA = 1;         // 확률적 조기 만료 계수

  /* --- 손잡이 --- */
  let pol = 'none', lam = 500, T = 0.2, TTL = 30;
  let running = true, playSpeed = 1, idx = 0, timer = null;

  /* --- 상태 --- */
  let t, seed, expiry, inflight, wq, hit, miss, stale, waited, recomp, peak, maxWait, bursts, burst, trace;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;

  function reset() {
    t = 0; seed = 11; expiry = TTL; inflight = []; wq = [];
    hit = miss = stale = waited = recomp = peak = maxWait = burst = 0;
    bursts = []; trace = [];
  }

  function step() {
    inflight = inflight.filter(f => { if (t < f.done) return true; expiry = t + TTL; return false; });
    if (wq.length && !inflight.length) {
      for (const w of wq) { waited++; if (t - w > maxWait) maxWait = t - w; }
      wq = [];
    }
    const n = lam * DT;
    const k = Math.round(n) + (rnd() < n % 1 ? 1 : 0);
    for (let i = 0; i < k; i++) {
      const expired = t >= expiry;
      if (pol === 'none') {
        if (!expired) { hit++; continue; }
        miss++; recomp++; burst++; inflight.push({ done: t + T });
        if (inflight.length > peak) peak = inflight.length;
      } else if (pol === 'mutex') {
        if (!expired) { hit++; continue; }
        miss++;
        if (!inflight.length) { recomp++; burst++; inflight.push({ done: t + T }); if (inflight.length > peak) peak = inflight.length; }
        else wq.push(t);
      } else if (pol === 'xfetch') {
        if (!expired) {
          hit++;
          /* now - delta·beta·ln(rand()) >= expiry 이면 만료 전에 미리 갱신한다 */
          if (!inflight.length && t - T * BETA * Math.log(rnd()) >= expiry) {
            recomp++; burst++; inflight.push({ done: t + T }); if (inflight.length > peak) peak = inflight.length;
          }
        } else {
          miss++;
          if (!inflight.length) { recomp++; burst++; inflight.push({ done: t + T }); }
          else wq.push(t);
        }
      } else {                                   // stale-while-revalidate
        if (!expired) { hit++; continue; }
        stale++;                                 // 낡은 값을 즉시 준다
        if (!inflight.length) { recomp++; burst++; inflight.push({ done: t + T }); if (inflight.length > peak) peak = inflight.length; }
      }
    }
    if (burst > 0 && !inflight.length) { bursts.push(burst); burst = 0; }
    t += DT;
  }

  /* --- 그리기 --- */
  const tot = () => hit + miss + stale;
  const hitPct = () => tot() ? hit / tot() * 100 : 100;
  const avgBurst = () => bursts.length ? bursts.reduce((a, b) => a + b, 0) / bursts.length : 0;
  const f2 = n => n.toFixed(n < 10 ? 1 : 0);

  function render() {
    const live = inflight.length;
    const YMAX = Math.max(20, Math.ceil(lam * T * 1.1));

    trace.push(live);
    if (trace.length > COLS) trace.shift();
    $('#trace').innerHTML =
      '<div class="ref" style="bottom:' + (1 / YMAX * 100) + '%"><span>' + S.refOne + '</span></div>' +
      trace.map(v => '<i class="' + (v > 1 ? 'dead' : '') + '" style="height:' +
        Math.min(100, v / YMAX * 100) + '%"></i>').join('');
    $('#traceX').innerHTML = '<span>' + S.axAgo.replace('$1', (COLS * DT * SUB).toFixed(0)) + '</span>' +
      '<span>' + S.axScale.replace('$1', YMAX) + '</span><span>' + S.axNow + '</span>';

    const left = Math.max(0, expiry - t), pct = Math.min(100, left / TTL * 100);
    $('#ttlFill').style.width = pct + '%';
    $('#ttlFill').className = 'fill' + (left <= 0 ? ' cold' : (pct < 15 ? ' warm' : ''));
    $('#ttlMeta').innerHTML = '<span>' + (left > 0 ? S.ttlLeft.replace('$1', left.toFixed(1)) : S.ttlGone) + '</span>' +
      '<span>' + S.ttlOf.replace('$1', TTL) + '</span>';

    $('#works').innerHTML = live
      ? [...Array(Math.min(live, 120))].map(() => '<i class="' + (live === 1 ? 'one' : '') + '"></i>').join('') +
        (live > 120 ? '<span class="more">' + S.wMore.replace('$1', live - 120) + '</span>' : '')
      : '<span class="none">' + S.wNone + '</span>';

    $('#meters').innerHTML =
      m(S.mHit, hitPct().toFixed(1), '%', hitPct() > 99 ? 'good' : '') +
      m(S.mBurst, f2(avgBurst()), '', avgBurst() > 1.5 ? 'bad' : 'good') +
      m(S.mPeak, String(peak), '', peak > 1 ? 'bad' : 'good') +
      m(S.mAvgRec, (recomp / Math.max(t, 1)).toFixed(2), S.uPs, '') +
      m(S.mWait, String(waited), '', waited > 0 ? 'bad' : '') +
      m(S.mStale, String(stale), '', stale > 0 ? 'bad' : '');

    const v = $('#verdict');
    const bad = pol === 'none' && bursts.length > 0;
    v.className = 'verdict' + (bad ? ' stuck' : (bursts.length ? ' ok' : ''));
    v.innerHTML = bursts.length === 0 ? S.vQuiet.replace('$1', left.toFixed(0))
      : ({
        none: S.vNone.replace('$1', f2(avgBurst())).replace('$2', (recomp / Math.max(t, 1)).toFixed(2)),
        mutex: S.vMutex.replace('$1', String(waited)).replace('$2', Math.round(maxWait * 1000)),
        xfetch: S.vXfetch.replace('$1', hitPct().toFixed(1)),
        swr: S.vSwr.replace('$1', String(stale))
      })[pol];

    $('#cmp').innerHTML = '<tr><th>' + S.cPol + '</th><th>' + S.cBurst + '</th><th>' + S.cWait + '</th><th>' + S.cCost + '</th></tr>' +
      ['none', 'mutex', 'xfetch', 'swr'].map(k =>
        '<tr class="' + (k === pol ? 'on' : '') + '"><td>' + S['n_' + k] + '</td>' +
        '<td class="num' + (k === 'none' ? ' bad' : ' good') + '">' + (k === 'none' ? S.cLamT.replace('$1', Math.round(lam * T)) : '1') + '</td>' +
        '<td class="num' + (k === 'mutex' ? ' bad' : '') + '">' + (k === 'mutex' ? S.cWaitV.replace('$1', Math.round(T * 1000)) : S.cNone) + '</td>' +
        '<td>' + S['cost_' + k] + '</td></tr>').join('');

    const h = $('#hint');
    h.className = 'hint' + (live > 1 ? ' warn' : '');
    h.textContent = live > 1 ? S.hStorm.replace('$1', String(live))
      : (left > 0 ? S.hQuiet.replace('$1', hitPct().toFixed(1)) : S.hExpired);
  }
  const m = (k, n, u, cls) =>
    '<div class="m ' + (cls || '') + '"><span class="k">' + k + '</span><span class="n">' + n +
    (u ? '<small>' + u + '</small>' : '') + '</span></div>';

  /* --- 시나리오 --- */
  const SCENE = [
    { pol: 'none', lam: 500, T: 0.2, TTL: 30 },
    { pol: 'none', lam: 500, T: 0.2, TTL: 3 },
    { pol: 'none', lam: 1000, T: 0.2, TTL: 3 },
    { pol: 'mutex', lam: 500, T: 0.2, TTL: 3 },
    { pol: 'xfetch', lam: 500, T: 0.2, TTL: 3 },
    { pol: 'swr', lam: 500, T: 0.2, TTL: 3 }
  ];

  function applyStep() {
    const s = SCENE[idx];
    pol = s.pol; lam = s.lam; T = s.T; TTL = s.TTL;
    syncDials(); reset();
    $('#nStep').textContent = pad(idx + 1) + ' / ' + pad(SCENE.length);
    $('#nText').textContent = S.scene[idx];
    $('#btnStep').disabled = idx >= SCENE.length - 1;
    $('#btnPrev').disabled = idx <= 0;
    render();
  }
  const pad = n => String(n).padStart(2, '0');

  function syncDials() {
    $('#sLam').value = String(lam); $('#vLam').innerHTML = lam + '<small>' + S.uPs + '</small>';
    $('#sT').value = String(Math.round(T * 1000)); $('#vT').innerHTML = Math.round(T * 1000) + '<small>' + S.uMs + '</small>';
    $('#sTTL').value = String(TTL); $('#vTTL').innerHTML = TTL + '<small>' + S.uSec + '</small>';
    [...document.querySelectorAll('#segPol button')].forEach(b => b.setAttribute('aria-pressed', b.dataset.pol === pol));
  }

  /* --- 구동 --- */
  function frame() { for (let i = 0; i < SUB; i++) step(); render(); }
  function start() { stop(); timer = setInterval(frame, TICK_MS / playSpeed); }
  function stop() { if (timer) { clearInterval(timer); timer = null; } }

  $('#sLam').oninput = e => { lam = +e.target.value; $('#vLam').innerHTML = lam + '<small>' + S.uPs + '</small>'; reset(); render(); };
  $('#sT').oninput = e => { T = +e.target.value / 1000; $('#vT').innerHTML = Math.round(T * 1000) + '<small>' + S.uMs + '</small>'; reset(); render(); };
  $('#sTTL').oninput = e => { TTL = +e.target.value; $('#vTTL').innerHTML = TTL + '<small>' + S.uSec + '</small>'; reset(); render(); };
  [...document.querySelectorAll('#segPol button')].forEach(b => b.onclick = () => {
    pol = b.dataset.pol;
    [...document.querySelectorAll('#segPol button')].forEach(x => x.setAttribute('aria-pressed', x === b));
    reset(); render();                        // 같은 씨앗에서 다시 돌려야 방식끼리 비교된다
  });
  $('#btnRun').onclick = () => {
    running = !running;
    $('#btnRun').textContent = running ? S.pause : S.resume;
    if (running) start(); else stop();
  };

  $('#btnStep').onclick = () => { if (idx < SCENE.length - 1) { idx++; applyStep(); } };
  $('#btnPrev').onclick = () => { if (idx > 0) { idx--; applyStep(); } };
  $('#btnReset').onclick = () => { idx = 0; applyStep(); };
  $('#btnPrev').disabled = true;               // 첫 단계에서 시작한다
  [...document.querySelectorAll('#segSpeed button')].forEach(b => b.onclick = () => {
    playSpeed = +b.dataset.speed;
    [...document.querySelectorAll('#segSpeed button')].forEach(x => x.setAttribute('aria-pressed', x === b));
    if (running) start();                      // 돌고 있으면 새 간격으로 다시 건다
  });

  reset();
  applyStep();
  start();
})();
