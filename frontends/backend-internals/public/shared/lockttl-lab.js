/* ============================================================
   18. 락을 잡았는데 둘이 들어왔다 — 락 만료와 펜싱 토큰
   ------------------------------------------------------------
   워커가 락을 잡고(토큰 발급) 일한 뒤 자원에 쓰고 놓는다. 작업이 TTL 보다 길면
   일하는 중에 락이 만료되고, 다음 인스턴스가 같은 일을 시작한다. 락을 잃은 워커는
   자기가 잃은 줄 모르고 계속 일해서 결국 쓴다.

   펜싱 토큰은 그 중복 실행을 막지 못한다. 자원이 "지금까지 본 최대 토큰보다 작은
   토큰의 쓰기" 를 거부하게 만들어, **낡은 쓰기가 최종 상태가 되는 것**만 막는다.

   watchdog(자동 갱신)은 R 간격으로 만료를 밀지만 정지 중에는 갱신이 못 나간다.
   막을 수 있는 정지의 상한은 L − R 이고, R 을 0 으로 줄여도 L 을 넘지 못한다.
   여유는 정지가 갱신 주기의 어디서 시작됐는지에 달리는데, 안전성은 최악에서
   정해지므로 여기서는 갱신 직전에 정지가 시작된 경우를 본다.

   정지는 있거나 없거나 둘 중 하나(확률 q)라 모든 경로를 확률 가중으로 열거한다 —
   워커가 최대 N 명이니 잎이 2^N 개다. 난수가 없어 수치가 정확히 재현된다.
   ============================================================ */
(function () {
  const S = window.LAB_I18N;
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];

  const TICK_MS = 50, STEP = 200;

  /* --- 손잡이 --- */
  let L = 3000, W = 5000, P = 8000, q = 0.20, R = 1000, N = 2,
      watchdog = false, fencing = false;
  let running = true, playSpeed = 1, idx = 0, timer = null, head = 0;

  /* --- 모델 --- */
  function Need() {}

  function run(pauses) {
    const runs = [];
    let token = 0, start = 0, used = 0;

    for (let i = 0; i < N; i++) {
      token++;
      const acq = start;
      if (used >= pauses.length) throw new Need();
      const pauseLen = pauses[used++] ? P : 0;
      const pauseAt = acq + W / 2;                   // 작업 중간에 멈춘다 (결정적으로 두기 위해)
      const finish = acq + W + pauseLen;

      /* 만료 시각 */
      let expiry;
      if (!watchdog) expiry = acq + L;
      else {
        const margin = L - R;                        // 최악: 갱신 직전에 정지가 시작된다
        expiry = pauseLen > margin ? pauseAt + margin : Infinity;
      }
      const lost = finish > expiry;
      runs.push({ token, acq, finish, expiry, pauseAt, pauseLen, lost });
      if (!lost) break;
      start = expiry;                                // 만료 순간 다음 인스턴스가 잡는다
    }

    /* 자원이 쓰기를 받는다 — 도착 순서대로 */
    const sorted = [...runs].sort((a, b) => a.finish - b.finish || a.token - b.token);
    let hw = 0;
    for (const w of sorted) {
      w.taken = !(fencing && w.token <= hw);
      if (w.taken) hw = Math.max(hw, w.token);
    }
    const kept = sorted.filter(w => w.taken);
    const final = kept.at(-1);
    const maxToken = Math.max(...runs.map(w => w.token));

    return {
      runs, sorted, final, maxToken,
      ran: runs.length,
      overlap: runs.length > 1,
      staleWon: !!final && final.token < maxToken,   // 낡은 쓰기가 최종 상태가 됐다
      rejected: sorted.length - kept.length,
      zombieMs: runs.reduce((a, w) => a + (w.lost ? w.finish - w.expiry : 0), 0)
    };
  }

  /* 모든 경로를 확률 가중으로 열거 — 표본이 아니라 정확한 기대값 */
  function exact() {
    const acc = { ran: 0, overlap: 0, staleWon: 0, rejected: 0, zombieMs: 0 };
    const walk = (ps, prob) => {
      if (prob < 1e-12) return;
      let r;
      try { r = run(ps); }
      catch (e) {
        if (!(e instanceof Need)) throw e;
        walk([...ps, true], prob * q); walk([...ps, false], prob * (1 - q)); return;
      }
      acc.ran += prob * r.ran;
      acc.overlap += prob * (r.overlap ? 1 : 0);
      acc.staleWon += prob * (r.staleWon ? 1 : 0);
      acc.rejected += prob * r.rejected;
      acc.zombieMs += prob * r.zombieMs;
    };
    walk([], 1);
    return acc;
  }

  /* 방어 조합을 바꿔가며 재본다 — 비교표용 */
  function withGuard(wd, fe, fn) {
    const a = watchdog, b = fencing;
    watchdog = wd; fencing = fe;
    const out = fn();
    watchdog = a; fencing = b;
    return out;
  }

  /* 폭포수에 그릴 결정적 한 건 — 정지가 있는 설정이면 첫 워커가 멈춘다 */
  function trace() { return run(q > 0 ? [true, ...Array(15).fill(false)] : Array(16).fill(false)); }

  /* --- 그리기 --- */
  let axMax = 1, ev = [];
  const pctOf = t => Math.max(0, Math.min(100, t / axMax * 100));
  const spanOf = (a, b) => Math.max(0.2, pctOf(b) - pctOf(a));
  const fmt = t => (t >= 1000 ? (t / 1000).toFixed(t % 1000 ? 1 : 0) + 's' : Math.round(t) + 'ms');
  const axFmt = t => (t < 1 ? '0' : (t / 1000).toFixed(0) + 's');

  const lane = (cls, name, body) =>
    '<div class="lane ' + cls + '"><span class="ln">' + name + '</span>' + body + '</div>';
  const m = (k, n, u, cls) =>
    '<div class="m ' + (cls || '') + '"><span class="k">' + k + '</span><span class="n">' + n +
    (u ? '<small>' + u + '</small>' : '') + '</span></div>';

  function drawBoard(tr) {
    const chrome = () => '<div class="head" style="left:' + pctOf(head) + '%"></div>';
    let html = '';

    tr.runs.forEach((w) => {
      let b = chrome();
      const holdEnd = Math.min(w.expiry === Infinity ? w.finish : w.expiry, w.finish);
      b += '<div class="held" style="left:' + pctOf(w.acq) + '%;width:' + spanOf(w.acq, holdEnd) + '%">' +
        (spanOf(w.acq, holdEnd) > 11 ? S.lbHeld.replace('$1', w.token) : '') + '</div>';
      if (w.lost) {
        b += '<div class="zombie" style="left:' + pctOf(w.expiry) + '%;width:' + spanOf(w.expiry, w.finish) +
          '%" title="' + S.ttZombie + '"></div>' +
          '<div class="exp" style="left:' + pctOf(w.expiry) + '%"></div>';
      }
      if (w.pauseLen) {
        b += '<div class="froze" style="left:' + pctOf(w.pauseAt) + '%;width:' +
          spanOf(w.pauseAt, w.pauseAt + w.pauseLen) + '%" title="' + S.ttFroze.replace('$1', fmt(w.pauseLen)) + '"></div>';
      }
      if (watchdog && !w.pauseLen) {                 // 갱신 표시는 정지 없는 구간에만
        for (let t = w.acq + R; t < w.finish; t += R)
          b += '<div class="renew" style="left:' + pctOf(t) + '%"></div>';
      }
      b += '<div class="wr' + (w.taken ? '' : ' no') + '" style="left:' + pctOf(w.finish) + '%"></div>';
      html += lane('', S.lnWorker.replace('$1', w.token), '<div class="tl">' + b + '</div>');
    });

    /* 자원 — 쓰기가 닿는 자리 */
    let rb = chrome();
    tr.sorted.forEach(w => {
      const stale = w.taken && tr.final === w && tr.staleWon;
      rb += '<div class="land' + (w.taken ? (stale ? ' stale' : '') : ' no') + '" style="left:' + pctOf(w.finish) +
        '%" title="' + (w.taken ? S.ttTaken : S.ttRejected).replace('$1', w.token) + '">' + w.token + '</div>';
    });
    html += lane('res', S.lnResource, '<div class="tl">' + rb + '</div>');

    $('#board').innerHTML = html;
    $('#boardX').innerHTML = [0, .25, .5, .75, 1].map(f => '<span>' + axFmt(axMax * f) + '</span>').join('');

    /* 자원의 최종 상태 */
    const f = $('#final');
    f.className = 'final ' + (tr.staleWon ? 'wrong' : 'right');
    f.innerHTML = tr.staleWon
      ? S.fnWrong.replace('$1', tr.final.token).replace('$2', tr.maxToken).replace('$3', fmt(tr.final.finish))
      : S.fnRight.replace('$1', tr.final.token).replace('$2', fmt(tr.final.finish)) +
        (tr.rejected ? ' ' + S.fnRejected.replace('$1', tr.rejected) : '');
  }

  function drawMeters(tr) {
    const x = exact();
    $('#meters').innerHTML =
      m(S.mRan, x.ran.toFixed(2), S.uTimes, x.ran > 1.01 ? 'bad' : 'good') +
      m(S.mOverlap, (x.overlap * 100).toFixed(1), '%', x.overlap > 0.001 ? 'bad' : 'good') +
      m(S.mStale, (x.staleWon * 100).toFixed(1), '%', x.staleWon > 0.001 ? 'bad' : 'good') +
      m(S.mRejected, x.rejected.toFixed(2), '', '') +
      m(S.mZombie, Math.round(x.zombieMs), S.uMs, x.zombieMs > 1 ? 'bad' : 'good') +
      m(S.mDeadWait, fmt(L), '', '');

    /* 네 조합 — 같은 설정에서 방어만 바꾼다 */
    const combos = [[false, false], [false, true], [true, false], [true, true]];
    const vals = combos.map(([wd, fe]) => withGuard(wd, fe, exact));
    const base = vals[0];
    const cell = (v, b, txt, lower) =>
      '<td class="num' + (Math.abs(v - b) < 1e-9 ? ' same' : (lower ? (v < b ? ' good' : ' bad') : (v > b ? ' good' : ' bad'))) + '">' + txt + '</td>';
    $('#cmp').innerHTML =
      '<tr><th>' + S.cGuard + '</th><th>' + S.cRan + '</th><th>' + S.cOverlap + '</th><th>' +
      S.cStale + '</th><th>' + S.cRejected + '</th></tr>' +
      combos.map(([wd, fe], i) => {
        const v = vals[i], on = wd === watchdog && fe === fencing;
        const key = 'g_' + ((wd ? 'w' : '') + (fe ? 'f' : '') || 'none');
        return '<tr class="' + (on ? 'on' : '') + '"><td>' + S[key] +
          '</td>' + cell(v.ran, base.ran, v.ran.toFixed(2), true) +
          cell(v.overlap, base.overlap, (v.overlap * 100).toFixed(1) + '%', true) +
          cell(v.staleWon, base.staleWon, (v.staleWon * 100).toFixed(1) + '%', true) +
          '<td class="num">' + v.rejected.toFixed(2) + '</td></tr>';
      }).join('');

    /* 판정 */
    const v = $('#verdict');
    const noFence = withGuard(watchdog, false, exact);
    let msg, cls;
    if (x.staleWon > 0.001) {
      msg = S.vWrong.replace('$1', (x.staleWon * 100).toFixed(1)).replace('$2', fmt(P)).replace('$3', fmt(L));
      cls = ' stuck';
    } else if (x.overlap > 0.001 && fencing) {
      msg = S.vFenced.replace('$1', (x.overlap * 100).toFixed(1)).replace('$2', x.ran.toFixed(2))
        .replace('$3', (noFence.staleWon * 100).toFixed(1));
      cls = ' stuck';
    } else if (x.overlap > 0.001) {
      msg = S.vOverlap.replace('$1', (x.overlap * 100).toFixed(1)).replace('$2', x.ran.toFixed(2))
        .replace('$3', Math.round(x.zombieMs));
      cls = ' stuck';
    } else {
      msg = S.vSafe.replace('$1', fmt(L)).replace('$2', fmt(W + P)).replace('$3', fmt(L));
      cls = ' ok';
    }
    v.className = 'verdict' + cls;
    v.innerHTML = msg;
  }

  function events(tr) {
    const out = [];
    tr.runs.forEach(w => {
      out.push({ t: w.acq, s: S.evAcq.replace('$1', w.token).replace('$2', fmt(L)).replace('$3', w.expiry === Infinity ? S.evNever : fmt(w.expiry)) });
      if (w.pauseLen) out.push({ t: w.pauseAt, s: S.evFroze.replace('$1', w.token).replace('$2', fmt(w.pauseLen)), bad: true });
      if (w.lost) out.push({ t: w.expiry, s: S.evLost.replace('$1', w.token), bad: true });
      out.push({
        t: w.finish,
        s: (w.taken ? S.evWrite : S.evRejected).replace('$1', w.token),
        bad: !w.taken || (w.lost && w.taken)
      });
    });
    if (tr.final) out.push({
      t: tr.final.finish + 1,
      s: (tr.staleWon ? S.evEndWrong : S.evEndRight).replace('$1', tr.final.token),
      bad: tr.staleWon
    });
    return out.sort((a, b) => a.t - b.t);
  }

  function moveHead() {
    const left = pctOf(head) + '%';
    $$('#board .head').forEach(e => e.style.left = left);
    const cur = ev.filter(e => e.t <= head).at(-1);
    const h = $('#hint');
    h.className = 'hint' + (cur && cur.bad ? ' warn' : '');
    h.innerHTML = cur ? fmt(cur.t) + ' &middot; ' + cur.s : '';
  }

  function layout() {
    const tr = trace();
    axMax = Math.max(...tr.runs.map(r => r.finish), 1000) * 1.04;
    ev = events(tr);
    drawBoard(tr); drawMeters(tr); moveHead();
  }

  /* --- 시나리오 --- */
  const SCENE = [
    { L: 3000, W: 5000, P: 8000, q: 0, R: 1000, N: 2, watchdog: false, fencing: false },
    { L: 3000, W: 5000, P: 8000, q: 0, R: 1000, N: 2, watchdog: false, fencing: true },
    { L: 3000, W: 5000, P: 8000, q: .20, R: 1000, N: 2, watchdog: false, fencing: false },
    { L: 3000, W: 5000, P: 8000, q: .20, R: 1000, N: 2, watchdog: false, fencing: true },
    { L: 3000, W: 5000, P: 4000, q: .20, R: 1000, N: 2, watchdog: true, fencing: true },
    { L: 3000, W: 5000, P: 4000, q: .20, R: 100, N: 2, watchdog: true, fencing: true },
    { L: 9000, W: 5000, P: 4000, q: .20, R: 100, N: 2, watchdog: false, fencing: true }
  ];

  function applyStep() {
    const s = SCENE[idx];
    L = s.L; W = s.W; P = s.P; q = s.q; R = s.R; N = s.N;
    watchdog = s.watchdog; fencing = s.fencing;
    head = 0; syncDials();
    $('#nStep').textContent = pad(idx + 1) + ' / ' + pad(SCENE.length);
    $('#nText').textContent = S.scene[idx];
    $('#btnStep').disabled = idx >= SCENE.length - 1;
    $('#btnPrev').disabled = idx <= 0;
    layout();
  }
  const pad = n => String(n).padStart(2, '0');

  function syncDials() {
    $('#sL').value = String(L); $('#vL').innerHTML = sec(L);
    $('#sW').value = String(W); $('#vW').innerHTML = sec(W);
    $('#sP').value = String(P); $('#vP').innerHTML = sec(P);
    $('#sQ').value = String(Math.round(q * 100)); $('#vQ').innerHTML = Math.round(q * 100) + '<small>%</small>';
    $('#sR').value = String(R); $('#vR').innerHTML = R + '<small>' + S.uMs + '</small>';
    $('#sN').value = String(N); $('#vN').innerHTML = N + '<small>' + S.uUnit + '</small>';
    press('#segWd', b => (b.dataset.wd === '1') === watchdog);
    press('#segFence', b => (b.dataset.fence === '1') === fencing);
  }
  const sec = t => (t / 1000).toFixed(1) + '<small>' + S.uSec + '</small>';
  const press = (sel, fn) => $$(sel + ' button').forEach(b => b.setAttribute('aria-pressed', fn(b) ? 'true' : 'false'));

  /* --- 구동 --- */
  function frame() { head += STEP; if (head > axMax) head = 0; moveHead(); }
  function start() { stop(); timer = setInterval(frame, TICK_MS / playSpeed); }
  function stop() { if (timer) { clearInterval(timer); timer = null; } }

  const bind = (sel, fn) => { $(sel).oninput = e => { fn(+e.target.value); head = 0; syncDials(); layout(); }; };
  bind('#sL', v => L = v);
  bind('#sW', v => W = v);
  bind('#sP', v => P = v);
  bind('#sQ', v => q = v / 100);
  bind('#sR', v => R = v);
  bind('#sN', v => N = v);

  $$('#segWd button').forEach(b => b.onclick = () => { watchdog = b.dataset.wd === '1'; head = 0; syncDials(); layout(); });
  $$('#segFence button').forEach(b => b.onclick = () => { fencing = b.dataset.fence === '1'; head = 0; syncDials(); layout(); });

  $('#btnRun').onclick = () => {
    running = !running;
    $('#btnRun').textContent = running ? S.pause : S.resume;
    if (running) start(); else stop();
  };
  $('#btnStep').onclick = () => { if (idx < SCENE.length - 1) { idx++; applyStep(); } };
  $('#btnPrev').onclick = () => { if (idx > 0) { idx--; applyStep(); } };
  $('#btnReset').onclick = () => { idx = 0; applyStep(); };
  $('#btnPrev').disabled = true;
  $$('#segSpeed button').forEach(b => b.onclick = () => {
    playSpeed = +b.dataset.speed;
    press('#segSpeed', x => x === b);
    if (running) start();
  });

  applyStep();
  start();

  /* 검증용 — 배포되는 코드 그대로 수치를 읽을 수 있게 열어둔다 (tools/ 참고) */
  window.LAB = {
    set(o) {
      for (const [k, v] of Object.entries(o)) {
        if (k === 'L') L = v; else if (k === 'W') W = v; else if (k === 'P') P = v;
        else if (k === 'q') q = v; else if (k === 'R') R = v; else if (k === 'N') N = v;
        else if (k === 'watchdog') watchdog = v; else if (k === 'fencing') fencing = v;
      }
      syncDials(); layout(); return window.LAB;
    },
    exact, trace, scene: SCENE,
    get cfg() { return { L, W, P, q, R, N, watchdog, fencing }; }
  };
})();
