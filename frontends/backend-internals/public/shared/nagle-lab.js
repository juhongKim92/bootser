/* ============================================================
   28. 작은 쓰기 두 번이 40밀리초가 된다 — Nagle 과 지연 ACK
   ------------------------------------------------------------
   애플리케이션이 `write()` 를 k 번 하고 곧바로 응답을 읽는다(write-write-read).
   두 알고리즘이 각자 합리적인데 겹치면 서로를 기다린다.

     Nagle (RFC 1122 §4.2.3.4 — MAY)   미확인 데이터가 있으면 **작은** 세그먼트를 미룬다.
                                       꽉 찬 세그먼트는 언제나 보낸다
     지연 ACK (RFC 1122 §4.2.3.2)      ACK 를 미룰 수 있다. 단 *"the delay MUST be less
                                       than 0.5 seconds, and in a stream of full packets
                                       there SHOULD be an ACK for at least every other
                                       packet"*

   그래서 **작은 세그먼트 두 개**를 연달아 쓰면 보내는 쪽은 ACK 를 기다리고 받는 쪽은
   타이머를 기다린다. 꽉 찬 세그먼트라면 둘 다 안 기다린다 — 명세의 "두 개마다 하나"
   규칙이 그 갈림길이다.

   40ms 는 명세에 없다(리눅스 값). 손잡이로 두고 500ms 가 RFC 상한이라고 적는다.
   난수 없이 시각이 전부 결정된다.
   ============================================================ */
(function () {
  const S = window.LAB_I18N;
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];

  const MSS = 1460;
  const SIZES = [40, 200, 700, 1460];
  const DELACKS = [0, 40, 100, 200, 500];   /* 0 = TCP_QUICKACK · 500 = RFC 상한 */

  /* --- 손잡이 --- */
  let size = 200, writes = 2, nagle = true, delack = 40, rtt = 1, joined = false;
  let idx = 0;

  /* --- 모델 ---------------------------------------------------------
     joined 면 k 번의 쓰기를 한 번에 합쳐 쓴 것으로 본다. 보낼 바이트를 MSS 로 쪼개면
     꽉 찬 세그먼트 몇 개와 (남으면) 작은 꼬리 하나가 된다. */
  function segsOf(bytes) {
    const full = Math.floor(bytes / MSS), tail = bytes % MSS;
    const out = [];
    for (let i = 0; i < full; i++) out.push(MSS);
    if (tail > 0) out.push(tail);
    return out;
  }

  function model(o) {
    const total = o.size * o.writes;
    /* 첫 번째 쓰기가 만드는 세그먼트와, 그 뒤에 남는 바이트 */
    const first = o.joined ? segsOf(total) : segsOf(o.size);
    const rest = o.joined ? 0 : o.size * (o.writes - 1);

    const half = o.rtt / 2;
    /* 첫 묶음은 언제나 즉시 나간다 — 미확인 데이터가 없으니 Nagle 도 안 막는다 */
    let packets = first.length;
    let stalled = false, stallStart = 0, ackAt = null;

    /* 첫 묶음의 마지막 세그먼트가 작고, 그 앞에 미확인 데이터가 있으면 Nagle 이 잡는다 */
    const firstTailSmall = first.length > 1 && first[first.length - 1] < MSS;
    /* 나눠 쓴 나머지 — 꽉 찬 세그먼트는 Nagle 도 통과시킨다. 잡히는 것은 **꼬리**뿐이라
       MSS 로 나누어떨어지지 않을 때만 막힌다. (처음엔 첫 세그먼트를 봤다가
       verify-nagle 의 불변식 ④·⑤ 에 잡혔다 — 700B × 4회가 반례였다.) */
    const restSegs = rest > 0 ? segsOf(rest) : [];
    const restHeld = o.nagle && rest > 0 && (rest % MSS !== 0);
    const joinedHeld = o.nagle && o.joined && firstTailSmall;

    let doneAt;
    if (restHeld || joinedHeld) {
      /* 받는 쪽은 요청이 덜 왔으니 응답을 못 만든다 → 지연 ACK 타이머가 유일한 출구 */
      stalled = true;
      stallStart = half;
      ackAt = half + o.delack;                 /* 타이머가 0 이면 즉시 ACK */
      const releasedAt = ackAt + half;         /* ACK 가 보내는 쪽에 도착 */
      const arriveAt = releasedAt + half;      /* 붙잡혔던 것이 도착 */
      doneAt = arriveAt + half;                /* 응답이 돌아온다 */
      packets += (o.joined ? 1 : restSegs.length) + 1;   /* 붙잡힌 것 + ACK */
    } else {
      /* 전부 즉시 나간다 — 요청이 한 왕복의 절반에 도착하고 응답이 반 왕복 뒤에 온다 */
      packets += restSegs.length;
      doneAt = o.rtt;
    }

    /* RFC 의 "꽉 찬 세그먼트 흐름에서는 두 개마다 하나" — 그 경로에서의 ACK 수 */
    const allSegs = o.joined ? first : first.concat(restSegs);
    const allFull = allSegs.length > 0 && allSegs.every(x => x === MSS);
    const ackCount = allFull ? Math.ceil(allSegs.length / 2) : (stalled ? 1 : 1);

    /* 같은 바이트를 한 번에 썼다면 */
    const joinedTime = model0(Object.assign({}, o, { joined: true }));

    return {
      total, segs: allSegs, packets, stalled, stallStart, ackAt, doneAt,
      allFull, ackCount, restHeld, joinedHeld,
      extra: doneAt - o.rtt,
      joinedTime
    };
  }
  /* 재귀를 끊기 위한 얇은 판 — 시각만 돌려준다 */
  function model0(o) {
    const total = o.size * o.writes;
    const first = o.joined ? segsOf(total) : segsOf(o.size);
    const rest = o.joined ? 0 : o.size * (o.writes - 1);
    const half = o.rtt / 2;
    const firstTailSmall = first.length > 1 && first[first.length - 1] < MSS;
    const restSegs = rest > 0 ? segsOf(rest) : [];
    const held = o.nagle && ((rest > 0 && rest % MSS !== 0) || (o.joined && firstTailSmall));
    return held ? (half + o.delack) + half + half + half : o.rtt;
  }

  const cfg = over => Object.assign({ size, writes, nagle, delack, rtt, joined }, over || {});
  const cur = () => model(cfg());

  /* --- 표기 --- */
  const num = v => String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const ms = v => v >= 100 ? Math.round(v) + S.uMs : (Math.round(v * 100) / 100) + S.uMs;
  const fill = (str, ...v) => v.reduce((a, x, i) => a.split('$' + (i + 1)).join(x), str);
  const meter = (k, n, u, cls) =>
    '<div class="m ' + (cls || '') + '"><span class="k">' + k + '</span><span class="n">' + n +
    (u ? '<small>' + u + '</small>' : '') + '</span></div>';

  /* --- 패킷 시간축 --- */
  function drawWire() {
    const o = cfg(), m = cur();
    const span = Math.max(m.doneAt * 1.08, o.rtt * 2.2);
    const pct = t => Math.max(0, Math.min(99.4, t / span * 100));
    const half = o.rtt / 2;
    let html = '<div class="lane tx"></div><div class="lane rx"></div>' +
      '<div class="who tx">' + S.wTx + '</div><div class="who rx">' + S.wRx + '</div>';

    const arrow = (t0, cls, label, up) =>
      '<div class="pkt ' + cls + '" style="left:' + pct(t0) + '%"></div>' +
      '<div class="tag ' + (up ? 'up' : 'dn') + '" style="left:' + pct(t0) + '%">' + label + '</div>';

    /* 첫 묶음 */
    const first = o.joined ? segsOf(m.total) : segsOf(o.size);
    first.forEach((sz, i) => {
      html += arrow(0, sz === MSS ? '' : 'small', i === 0 ? fill(S.pFirst, num(sz)) : num(sz), true);
    });

    if (m.stalled) {
      html += '<div class="held" style="left:' + pct(0) + '%;width:' + (pct(m.ackAt + half) - pct(0)) + '%"></div>' +
        '<div class="heldlbl" style="left:' + pct(0) + '%">' + fill(S.pHeld, ms(m.ackAt + half)) + '</div>' +
        '<div class="timer" style="left:' + pct(half) + '%;width:' + (pct(m.ackAt) - pct(half)) + '%"></div>' +
        '<div class="timerlbl" style="left:' + pct(half) + '%">' + fill(S.pTimer, ms(o.delack)) + '</div>' +
        arrow(m.ackAt, 'ack', S.pAck, false) +
        arrow(m.ackAt + half, 'small', S.pReleased, true) +
        arrow(m.ackAt + half + half + half - half, 'rsp', S.pRsp, false);
    } else {
      if (!o.joined && o.writes > 1) segsOf(o.size * (o.writes - 1)).forEach(sz =>
        html += arrow(0, sz === MSS ? '' : 'small', num(sz), true));
      html += arrow(half, 'rsp', S.pRsp, false);
    }
    $('#wire').innerHTML = html;
    $('#wireX').innerHTML = [0, span / 2, span].map(v => '<span>' + ms(v) + '</span>').join('');
  }

  /* --- 네 가지 설정 비교 --- */
  function drawFour() {
    const rows = [
      { k: S.fSplit, o: { joined: false, nagle: true }, },
      { k: S.fJoined, o: { joined: true, nagle: true } },
      { k: S.fNodelay, o: { joined: false, nagle: false } },
      { k: S.fQuick, o: { joined: false, nagle: true, delack: 0 } }
    ];
    const vals = rows.map(x => ({ k: x.k, o: x.o, m: model(cfg(x.o)) }));
    const best = Math.min(...vals.map(x => x.m.doneAt));
    const isCur = x => (x.o.joined === joined) && (x.o.nagle === nagle) &&
      (x.o.delack === undefined ? delack === DELACKS[1] || delack === delack : x.o.delack === delack);
    $('#four').innerHTML =
      '<tr><th>' + S.fWhat + '</th><th>' + S.fTime + '</th><th>' + S.fExtra + '</th><th>' + S.fPkt + '</th></tr>' +
      vals.map(x =>
        '<tr><td>' + x.k + '</td>' +
        '<td class="' + (x.m.doneAt === best ? 'good' : 'bad') + '">' + ms(x.m.doneAt) + '</td>' +
        '<td class="' + (x.m.extra > 0 ? 'bad' : 'good') + '">' + (x.m.extra > 0 ? '+' + ms(x.m.extra) : '—') + '</td>' +
        '<td>' + x.m.packets + '</td></tr>').join('');
  }

  function drawMeters() {
    const o = cfg(), m = cur();
    $('#meters').innerHTML =
      meter(S.mTime, ms(m.doneAt), '', m.stalled ? 'bad' : 'good') +
      meter(S.mExtra, m.extra > 0 ? '+' + ms(m.extra) : '—', '', m.extra > 0 ? 'bad' : 'good') +
      meter(S.mJoined, ms(m.joinedTime), '', '') +
      meter(S.mPkt, m.packets, '', '') +
      meter(S.mSeg, m.allFull ? S.mAllFull : S.mHasSmall, '', m.allFull ? 'good' : (m.stalled ? 'bad' : '')) +
      meter(S.mAck, m.ackCount, '', '');

    /* 판정 */
    const v = $('#verdict');
    let msg, cls;
    if (!m.stalled && m.allFull && m.segs.length > 1) {
      msg = fill(S.vFull, m.segs.length, m.ackCount, ms(m.doneAt));
      cls = ' ok';
    } else if (!m.stalled) {
      msg = fill(S.vClean, ms(m.doneAt), m.packets);
      cls = ' ok';
    } else if (o.joined) {
      msg = fill(S.vJoinedHeld, num(m.total), num(MSS), num(m.total % MSS), ms(m.doneAt));
      cls = ' stuck';
    } else if (o.delack === 0) {
      msg = fill(S.vQuick, ms(m.doneAt), ms(m.joinedTime));
      cls = ' ok';
    } else {
      msg = fill(S.vHeld, ms(m.doneAt), ms(o.delack), ms(m.joinedTime), ms(m.extra));
      cls = ' stuck';
    }
    v.className = 'verdict' + cls;
    v.innerHTML = msg;
  }

  function drawHint() {
    const o = cfg(), m = cur();
    const h = $('#hint');
    h.className = 'hint' + (m.stalled ? ' warn' : '');
    h.innerHTML = fill(S.hint, o.joined ? 1 : o.writes, num(o.size), num(m.total),
      m.segs.length, ms(m.doneAt));
  }

  function layout() { drawWire(); drawFour(); drawMeters(); drawHint(); }

  /* --- 시나리오 --- */
  const SCENE = [
    { size: 200, writes: 1, nagle: true, delack: 40, rtt: 1, joined: false },
    { size: 200, writes: 2, nagle: true, delack: 40, rtt: 1, joined: false },
    { size: 200, writes: 2, nagle: true, delack: 40, rtt: 1, joined: true },
    { size: 200, writes: 2, nagle: false, delack: 40, rtt: 1, joined: false },
    { size: 200, writes: 2, nagle: true, delack: 0, rtt: 1, joined: false },
    { size: 1460, writes: 2, nagle: true, delack: 40, rtt: 1, joined: false },
    { size: 700, writes: 3, nagle: true, delack: 40, rtt: 1, joined: true }
  ];

  function applyStep() {
    const c = SCENE[idx];
    size = c.size; writes = c.writes; nagle = c.nagle; delack = c.delack; rtt = c.rtt; joined = c.joined;
    syncDials();
    $('#nStep').textContent = pad(idx + 1) + ' / ' + pad(SCENE.length);
    $('#nText').textContent = S.scene[idx];
    $('#btnStep').disabled = idx >= SCENE.length - 1;
    $('#btnPrev').disabled = idx <= 0;
    layout();
  }
  const pad = n => String(n).padStart(2, '0');

  function syncDials() {
    const si = SIZES.indexOf(size);
    if (si >= 0) $('#sS').value = String(si);
    $('#vS').innerHTML = num(size) + '<small>' + S.uB + '</small>';
    $('#sW').value = String(writes); $('#vW').innerHTML = writes + '<small>' + S.uTimes + '</small>';
    const di = DELACKS.indexOf(delack);
    if (di >= 0) $('#sD').value = String(di);
    $('#vD').innerHTML = (delack === 0 ? S.uOff : delack + '<small>' + S.uMs + '</small>');
    $('#sR').value = String(rtt); $('#vR').innerHTML = rtt + '<small>' + S.uMs + '</small>';
    press('#segNagle', b => (b.dataset.nagle === '1') === nagle);
    press('#segJoin', b => (b.dataset.join === '1') === joined);
  }
  const press = (sel, fn) => $$(sel + ' button').forEach(b => b.setAttribute('aria-pressed', fn(b) ? 'true' : 'false'));

  /* --- 구동 --- */
  const bind = (sel, fn) => { $(sel).oninput = e => { fn(+e.target.value); syncDials(); layout(); }; };
  bind('#sS', v => size = SIZES[v]);
  bind('#sW', v => writes = v);
  bind('#sD', v => delack = DELACKS[v]);
  bind('#sR', v => rtt = v);

  $$('#segNagle button').forEach(b => b.onclick = () => { nagle = b.dataset.nagle === '1'; syncDials(); layout(); });
  $$('#segJoin button').forEach(b => b.onclick = () => { joined = b.dataset.join === '1'; syncDials(); layout(); });
  $('#btnStep').onclick = () => { if (idx < SCENE.length - 1) { idx++; applyStep(); } };
  $('#btnPrev').onclick = () => { if (idx > 0) { idx--; applyStep(); } };
  $('#btnReset').onclick = () => { idx = 0; applyStep(); };
  $('#btnPrev').disabled = true;

  applyStep();

  /* 검증용 — 배포되는 코드 그대로 수치를 읽을 수 있게 열어둔다 */
  window.LAB = {
    set(o) {
      for (const [k, v] of Object.entries(o)) {
        if (k === 'size') size = v; else if (k === 'writes') writes = v;
        else if (k === 'nagle') nagle = v; else if (k === 'delack') delack = v;
        else if (k === 'rtt') rtt = v; else if (k === 'joined') joined = v;
      }
      syncDials(); layout(); return window.LAB;
    },
    model, cur, segs: segsOf, MSS, SIZES, DELACKS, scene: SCENE,
    at: over => model(cfg(over)),
    get dials() { return { size, writes, nagle, delack, rtt, joined }; }
  };
})();
