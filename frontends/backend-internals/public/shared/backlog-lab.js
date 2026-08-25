/* ============================================================
   27. 커널이 SYN 을 버리는데 애플리케이션 로그는 깨끗하다 — accept 큐
   ------------------------------------------------------------
   커넥션이 도착률 λ 로 D 초 동안 몰려온다. 애플리케이션은 초당 A 개를 accept 하고,
   커널은 그 사이를 크기 B 의 큐로 메운다. 큐가 차면 커널이 요청을 버린다 —
   `listen(2)` 의 표현으로 *"the request may be ignored so that a later reattempt at
   connection succeeds"* 다. 애플리케이션은 그 요청을 **본 적이 없다.**

   버려진 쪽의 "later reattempt" 가 이 페이지의 계단이다. RFC 6298 이 첫 RTO 를
   1초로 두고 타임아웃마다 2배로 물리므로 재전송이 1 · 3 · 7 · 15 · 31 · 63 초에 나가고,
   리눅스 기본 `tcp_syn_retries=6` 이면 **127초**에 포기한다 — `tcp(7)` 이 그 합계를
   그대로 적어둔 것이 이 모델의 검산점이다.

   난수가 없다. 도착이 고정 간격이라 모든 값이 닫힌 식으로 나온다.
   ============================================================ */
(function () {
  const S = window.LAB_I18N;
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];

  const BACKLOGS = [16, 128, 512, 1024, 4096];   /* 128 = 리눅스 5.4 이전 기본, 4096 = 이후 */
  const RETRIES = 6;                              /* tcp_syn_retries 기본값 */
  const STEPS = [1, 3, 7, 15, 31, 63];            /* 2^k − 1 — RFC 6298 의 백오프 */
  const GIVE_UP = 127;                            /* 2^7 − 1, tcp(7) 이 적은 값 */

  /* --- 손잡이 --- */
  let lambda = 2000, accept = 500, backlog = 128, burst = 5, abort = false;
  let idx = 0;

  /* --- 모델 --------------------------------------------------------- */
  function model(o) {
    const excess = o.lambda - o.accept;
    const fillAt = excess > 0 ? o.backlog / excess : Infinity;
    const overflowFor = Math.max(0, o.burst - fillAt);
    const dropped = Math.round(excess > 0 ? excess * overflowFor : 0);
    const queued = Math.round(Math.min(o.backlog, excess > 0 ? excess * o.burst : 0));
    const queueWait = queued / o.accept;

    /* 버려진 커넥션은 버스트가 끝난 뒤 첫 계단에 성공한다 */
    let step = null;
    if (overflowFor > 0) for (const v of STEPS) if (v >= overflowFor) { step = v; break; }
    const dead = overflowFor > 0 && step === null;

    return {
      excess, fillAt, overflowFor, dropped, queued, queueWait, step, dead,
      /* 커널이 버렸으니 애플리케이션 지표에는 아무것도 안 남는다 */
      serverSees: 0,
      clientWait: overflowFor <= 0 ? 0 : (o.abort ? 0 : (dead ? GIVE_UP : step))
    };
  }
  const cfg = over => Object.assign({ lambda, accept, backlog, burst, abort }, over || {});
  const cur = () => model(cfg());

  /* --- 표기 --- */
  const num = v => String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const sec = v => !isFinite(v) ? '∞' : v >= 10 ? v.toFixed(1) + S.uSec : v.toFixed(2) + S.uSec;
  const secInt = v => Math.round(v) + S.uSec;
  const fill = (str, ...v) => v.reduce((a, x, i) => a.split('$' + (i + 1)).join(x), str);
  const meter = (k, n, u, cls) =>
    '<div class="m ' + (cls || '') + '"><span class="k">' + k + '</span><span class="n">' + n +
    (u ? '<small>' + u + '</small>' : '') + '</span></div>';

  /* --- 버스트 타임라인 --- */
  function drawTape() {
    const o = cfg(), m = cur();
    const span = Math.max(o.burst * 1.4, 1);
    const pct = t => Math.max(0, Math.min(100, t / span * 100));
    const fillEnd = isFinite(m.fillAt) ? Math.min(m.fillAt, o.burst) : o.burst;
    let html = '<div class="zone fill" style="left:0;width:' + pct(fillEnd) + '%"></div>';
    if (m.overflowFor > 0)
      html += '<div class="zone over" style="left:' + pct(fillEnd) + '%;width:' + (pct(o.burst) - pct(fillEnd)) + '%"></div>';
    html += '<div class="zone calm" style="left:' + pct(o.burst) + '%;right:0"></div>' +
      '<div class="edge" style="left:' + pct(o.burst) + '%"></div>' +
      '<div class="lbl" style="left:0">' + fill(S.zFill, m.excess > 0 ? sec(m.fillAt) : S.uNever) + '</div>';
    if (m.overflowFor > 0)
      html += '<div class="lbl" style="left:' + pct(fillEnd) + '%">' + fill(S.zOver, sec(m.overflowFor)) + '</div>';
    $('#tape').innerHTML = html;
    $('#tapeX').innerHTML = [0, span / 2, span].map(v => '<span>' + secInt(v) + '</span>').join('');
  }

  /* --- 큐 길이 --- */
  function drawQueue() {
    const o = cfg(), m = cur();
    $('#qbar').innerHTML =
      '<div class="fillq" style="width:' + (m.queued / o.backlog * 100).toFixed(1) + '%"></div>' +
      '<div class="cap"></div>';
    $('#qcap').innerHTML = fill(S.qCap, num(m.queued), num(o.backlog), sec(m.queueWait),
      '<b>' + num(m.dropped) + '</b>');
  }

  /* --- 재시도 계단 --- */
  function drawStair() {
    const m = cur();
    const need = m.overflowFor;
    const max = m.dead ? GIVE_UP : Math.max(...STEPS);
    let html = '', x = '';
    for (const v of STEPS) {
      const hit = !m.dead && v === m.step;
      html += '<div class="st' + (hit ? ' hit' : '') + '">' +
        '<span class="lb">' + (hit ? secInt(v) : '') + '</span>' +
        '<span class="bar" style="height:' + (v / max * 100).toFixed(1) + '%"></span></div>';
      x += '<span>' + v + '</span>';
    }
    html += '<div class="st' + (m.dead ? ' dead' : '') + '">' +
      '<span class="lb">' + (m.dead ? secInt(GIVE_UP) : '') + '</span>' +
      '<span class="bar" style="height:' + (m.dead ? 100 : 0).toFixed(1) + '%"></span></div>';
    x += '<span>' + GIVE_UP + '</span>';
    $('#stair').innerHTML = html;
    $('#stairX').innerHTML = x;
    $('#stairY').innerHTML = need > 0
      ? fill(S.stY, sec(need), m.dead ? secInt(GIVE_UP) : secInt(m.step))
      : S.stNone;
  }

  /* --- 어느 쪽이 무엇을 보나 --- */
  function drawSides() {
    const m = cur();
    const rows = [
      { k: S.sApp, v: fill(S.sAppV, m.serverSees), cls: 'blind' },
      { k: S.sKernel, v: fill(S.sKernelV, num(m.dropped), num(m.queued)), cls: '' },
      { k: S.sClient, v: m.overflowFor <= 0 ? S.sClientOk
        : abort ? S.sClientAbort
          : (m.dead ? fill(S.sClientDead, GIVE_UP) : fill(S.sClientV, secInt(m.clientWait))), cls: 'hurt' }
    ];
    $('#sides').innerHTML =
      '<tr><th>' + S.sWho + '</th><th>' + S.sWhat + '</th></tr>' +
      rows.map(r => '<tr><td>' + r.k + '</td><td class="' + r.cls + '">' + r.v + '</td></tr>').join('');
  }

  function drawMeters() {
    const o = cfg(), m = cur();
    const big = model(cfg({ backlog: 4096 }));
    $('#meters').innerHTML =
      meter(S.mFill, m.excess > 0 ? sec(m.fillAt) : S.uNever, '', m.excess > 0 && m.fillAt < 1 ? 'bad' : '') +
      meter(S.mDropped, num(m.dropped), '', m.dropped > 0 ? 'bad' : 'good') +
      meter(S.mClient, m.overflowFor <= 0 ? '—' : (abort ? S.mNow : (m.dead ? secInt(GIVE_UP) : secInt(m.clientWait))),
        '', m.overflowFor > 0 && !abort ? 'bad' : 'good') +
      meter(S.mRatio, m.overflowFor > 0 && !abort && !m.dead
        ? '×' + (m.clientWait / m.overflowFor).toFixed(2) : '—', '',
        m.overflowFor > 0 && !abort ? 'bad' : '') +
      meter(S.mQueueWait, sec(m.queueWait), '', m.queueWait > 1 ? 'bad' : 'good') +
      meter(S.mServer, m.serverSees, '', 'good');

    /* 판정 */
    const v = $('#verdict');
    let msg, cls;
    if (m.overflowFor <= 0) {
      msg = fill(S.vCalm, num(m.queued), sec(m.queueWait));
      cls = ' ok';
    } else if (abort) {
      msg = fill(S.vAbort, num(m.dropped), secInt(m.dead ? GIVE_UP : m.step));
      cls = ' ok';
    } else if (m.dead) {
      msg = fill(S.vDead, num(m.dropped), sec(m.overflowFor), GIVE_UP);
      cls = ' stuck';
    } else {
      msg = fill(S.vStair, num(m.dropped), secInt(m.clientWait), sec(m.overflowFor),
        (m.clientWait / m.overflowFor).toFixed(2));
      cls = ' stuck';
    }
    v.className = 'verdict' + cls;
    v.innerHTML = msg;
  }

  function drawHint() {
    const o = cfg(), m = cur();
    const h = $('#hint');
    h.className = 'hint' + (m.overflowFor > 0 ? ' warn' : '');
    h.innerHTML = m.excess > 0
      ? fill(S.hint, num(o.lambda), num(o.accept), num(o.backlog), o.burst, sec(m.fillAt))
      : fill(S.hintNever, num(o.lambda), num(o.accept), num(o.backlog), o.burst);
  }

  function layout() { drawTape(); drawQueue(); drawStair(); drawSides(); drawMeters(); drawHint(); }

  /* --- 시나리오 --- */
  const SCENE = [
    { lambda: 400, accept: 500, backlog: 128, burst: 5, abort: false },
    { lambda: 2000, accept: 500, backlog: 128, burst: 5, abort: false },
    { lambda: 2000, accept: 500, backlog: 128, burst: 2, abort: false },
    { lambda: 2000, accept: 500, backlog: 128, burst: 4, abort: false },
    { lambda: 2000, accept: 500, backlog: 4096, burst: 5, abort: false },
    { lambda: 2000, accept: 500, backlog: 128, burst: 5, abort: true },
    { lambda: 2000, accept: 500, backlog: 128, burst: 70, abort: false }
  ];

  function applyStep() {
    const c = SCENE[idx];
    lambda = c.lambda; accept = c.accept; backlog = c.backlog; burst = c.burst; abort = c.abort;
    syncDials();
    $('#nStep').textContent = pad(idx + 1) + ' / ' + pad(SCENE.length);
    $('#nText').textContent = S.scene[idx];
    $('#btnStep').disabled = idx >= SCENE.length - 1;
    $('#btnPrev').disabled = idx <= 0;
    layout();
  }
  const pad = n => String(n).padStart(2, '0');

  function syncDials() {
    $('#sL').value = String(lambda); $('#vL').innerHTML = num(lambda) + '<small>' + S.uPerSec + '</small>';
    $('#sA').value = String(accept); $('#vA').innerHTML = num(accept) + '<small>' + S.uPerSec + '</small>';
    const bi = BACKLOGS.indexOf(backlog);
    if (bi >= 0) $('#sB').value = String(bi);
    $('#vB').innerHTML = num(backlog) + '<small>' + S.uCount + '</small>';
    $('#sD').value = String(burst); $('#vD').innerHTML = burst + '<small>' + S.uSec + '</small>';
    press('#segAbort', b => (b.dataset.abort === '1') === abort);
  }
  const press = (sel, fn) => $$(sel + ' button').forEach(b => b.setAttribute('aria-pressed', fn(b) ? 'true' : 'false'));

  /* --- 구동 --- */
  const bind = (sel, fn) => { $(sel).oninput = e => { fn(+e.target.value); syncDials(); layout(); }; };
  bind('#sL', v => lambda = v);
  bind('#sA', v => accept = v);
  bind('#sB', v => backlog = BACKLOGS[v]);
  bind('#sD', v => burst = v);

  $$('#segAbort button').forEach(b => b.onclick = () => { abort = b.dataset.abort === '1'; syncDials(); layout(); });
  $('#btnStep').onclick = () => { if (idx < SCENE.length - 1) { idx++; applyStep(); } };
  $('#btnPrev').onclick = () => { if (idx > 0) { idx--; applyStep(); } };
  $('#btnReset').onclick = () => { idx = 0; applyStep(); };
  $('#btnPrev').disabled = true;

  applyStep();

  /* 검증용 — 배포되는 코드 그대로 수치를 읽을 수 있게 열어둔다.
     retryAt / giveUpAt 은 RFC 6298 의 백오프를 그대로 쓴 것이다. */
  window.LAB = {
    set(o) {
      for (const [k, v] of Object.entries(o)) {
        if (k === 'lambda') lambda = v; else if (k === 'accept') accept = v;
        else if (k === 'backlog') backlog = v; else if (k === 'burst') burst = v;
        else if (k === 'abort') abort = v;
      }
      syncDials(); layout(); return window.LAB;
    },
    model, cur, cfg: over => cfg(over),
    retryAt: k => Math.pow(2, k) - 1,
    giveUpAt: n => Math.pow(2, n + 1) - 1,
    STEPS, GIVE_UP, RETRIES, BACKLOGS, scene: SCENE,
    get dials() { return { lambda, accept, backlog, burst, abort }; }
  };
})();
