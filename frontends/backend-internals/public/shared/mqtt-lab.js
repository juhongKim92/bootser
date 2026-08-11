/* ============================================================
   05. MQTT QoS 0/1/2 실험대 — 로직 전용.

   본문과 화면 문안은 각 언어의 HTML 에 직접 박혀 있다.
   실행 중에만 만들어지는 문자열만 페이지가 window.LAB_I18N 으로 넘긴다.

   모델
   ----
   세 레인(QoS 0/1/2)이 같은 속도로 패킷을 하나씩 소비한다.
   같은 패킷 예산에서 몇 개의 메시지를 끝내는지가 곧 QoS 의 비용이다.

     QoS 0   PUBLISH                                    (1 패킷)
     QoS 1   PUBLISH → PUBACK                           (2 패킷)
     QoS 2   PUBLISH → PUBREC → PUBREL → PUBCOMP        (4 패킷)

   전달 시점
     QoS 0/1 — 브로커가 PUBLISH 를 받는 순간
     QoS 2   — 브로커가 PUBREL 을 받는 순간. 패킷 id 를 그때 버리므로
               PUBCOMP 가 유실되어 PUBREL 이 다시 와도 두 번 전달되지 않는다

   그래서 중복은 QoS 1 에서만 생긴다. PUBACK 이 유실되면 발행자는
   메시지가 도착했는지 알 수 없어 그대로 다시 보낸다.

   기대값 (q = 1 - 유실률, 재전송 상한 없다고 가정)
     QoS 0   전달 q,      중복 0,       패킷 1
     QoS 1   전달 1/q,    중복 p/q,     패킷 (1+q)/q²
     QoS 2   전달 1,      중복 0,       패킷 2(1+q)/q²

   패킷 수가 "시도 × 2" 가 아닌 이유: PUBLISH 가 유실되면 PUBACK 은
   아예 생기지 않는다. 한 시도의 패킷 수는 1 + q 이지 2 가 아니다.
   시도 횟수 기대값이 1/q² 이므로 곱하면 위 식이 된다.

   실험대는 재전송을 MAX_ATTEMPTS 회로 끊는다. 유실률 20% 까지는
   위 기대값과 사실상 같고, 40% 에서 1~2% 낮게 나온다
   (QoS 2 는 0.8% 가량이 상한에 걸려 포기된다).
   ============================================================ */
'use strict';

(function () {

  const S = window.LAB_I18N;
  const t = (k, ...a) => {
    let s = S[k] ?? k;
    a.forEach((v, i) => s = s.replaceAll('$' + (i + 1), v));
    return s;
  };
  const $ = s => document.querySelector(s);

  const STEP_MS      = 300;   // 패킷 하나가 오가는 시간
  const MAX_ATTEMPTS = 12;    // 재전송 상한 — 없으면 유실률이 높을 때 영원히 돈다
  const TRACK_MAX    = 14;    // 패킷 기록에 남기는 칩 개수
  const STRIP_MAX    = 22;    // 결과 스트립 칸 수
  const LOG_MAX      = 40;

  /* ============================================================================
   * 1. 레인
   * ========================================================================== */

  function newLane(q){
    return {
      q,
      sent:0,          // 발행을 시작한 메시지 수
      done:0,          // 끝난 메시지 수
      delivered:0,     // 구독자가 받은 횟수 (중복 포함)
      lostMsg:0,       // 한 번도 못 받고 끝난 메시지
      dupMsg:0,        // 두 번 이상 받은 메시지
      dupExtra:0,      // 초과 전달 횟수
      packets:0,       // 오간 패킷 수
      gaveUp:0,        // 재전송 상한에 걸린 메시지
      track:[],
      strip:[],
      cur:null,
    };
  }

  let lanes = [newLane(0), newLane(1), newLane(2)];
  let p = 0;            // 유실 확률
  let elapsed = 0;      // 경과 step 수
  let log = [];

  const lossy = () => Math.random() < p;

  function pushChip(L, label, cls){
    L.track.push({ label, cls });
    if (L.track.length > TRACK_MAX) L.track.shift();
  }

  function startMsg(L){
    L.sent++;
    L.cur = { id:L.sent, deliveries:0, attempts:1, stage:'PUBLISH', released:false };
    L.track = [];
  }

  function deliver(L){
    const c = L.cur;
    c.deliveries++;
    L.delivered++;
    if (c.deliveries === 1){
      pushChip(L, t('cDeliver'), 'deliver');
    } else {
      L.dupExtra++;
      if (c.deliveries === 2) L.dupMsg++;
      pushChip(L, t('cDup'), 'dup');
      addLog(t('lgDup', L.q, c.id), 'down');
    }
  }

  function retry(L, resumeAt){
    const c = L.cur;
    c.attempts++;
    if (c.attempts > MAX_ATTEMPTS){
      L.gaveUp++;
      addLog(t('lgGiveUp', L.q, c.id, MAX_ATTEMPTS), 'down');
      finish(L);
      return;
    }
    c.stage = 'TIMEOUT';
    c.resumeAt = resumeAt;
  }

  function finish(L){
    const c = L.cur;
    const kind = c.deliveries === 0 ? 'lost' : c.deliveries === 1 ? 'ok' : 'dup';
    if (kind === 'lost'){
      L.lostMsg++;
      addLog(t('lgLost', L.q, c.id), 'down');
    }
    L.strip.push(kind);
    if (L.strip.length > STRIP_MAX) L.strip.shift();
    L.done++;
    L.cur = null;
  }

  /* 한 step = 패킷 하나 (또는 타임아웃 대기 한 칸) */
  function step(L){
    if (!L.cur) startMsg(L);
    const c = L.cur;

    if (c.stage === 'TIMEOUT'){
      pushChip(L, t('cTimeout'), 'wait');
      c.stage = c.resumeAt;
      return;
    }

    const lost = lossy();
    L.packets++;
    pushChip(L, t('c' + c.stage), lost ? 'lost' : 'ok');

    if (L.q === 0){
      if (!lost) deliver(L);
      finish(L);
      return;
    }

    if (L.q === 1){
      if (c.stage === 'PUBLISH'){
        if (lost) retry(L, 'PUBLISH');
        else { deliver(L); c.stage = 'PUBACK'; }
      } else {                                  // PUBACK
        if (lost) retry(L, 'PUBLISH');          // 발행자는 도착 여부를 모른다 → 그대로 재전송
        else finish(L);
      }
      return;
    }

    switch (c.stage){                            // QoS 2
      case 'PUBLISH':
        lost ? retry(L, 'PUBLISH') : (c.stage = 'PUBREC');
        break;
      case 'PUBREC':
        lost ? retry(L, 'PUBLISH') : (c.stage = 'PUBREL');
        break;
      case 'PUBREL':
        if (lost) retry(L, 'PUBREL');
        else {
          if (!c.released){ deliver(L); c.released = true; }  // 여기서 딱 한 번
          c.stage = 'PUBCOMP';
        }
        break;
      case 'PUBCOMP':
        lost ? retry(L, 'PUBREL') : finish(L);   // 패킷 id 는 이미 버렸다 → 재전달 없음
        break;
    }
  }

  /* ============================================================================
   * 2. 기대값 — 재전송 상한이 없다고 가정한 해석해
   * ========================================================================== */

  function expected(q){
    const s   = 1 - p;                    // 패킷 하나가 살아남을 확률
    const one = (1 + s) / (s * s);        // 왕복 한 벌의 기대 패킷 수
    if (q === 0) return { deliv: s * 100, dup: 0,             packets: 1 };
    if (q === 1) return { deliv: 100,     dup: (p / s) * 100, packets: one };
    return             { deliv: 100,     dup: 0,             packets: 2 * one };
  }

  /* ============================================================================
   * 3. 그리기
   * ========================================================================== */

  const pct = (n, d) => d > 0 ? (n / d * 100) : 0;
  const f1  = n => n.toFixed(1);

  function addLog(text, cls){
    log.unshift({ text, cls });
    if (log.length > LOG_MAX) log.pop();
  }

  function renderLane(L, i){
    const el = document.getElementById('lane' + L.q);
    const e  = expected(L.q);

    el.querySelector('.track').innerHTML =
      L.track.map(c => `<span class="chip ${c.cls}">${c.label}</span>`).join('');

    el.querySelector('.strip').innerHTML =
      L.strip.map(k => `<i class="${k}" title="${t('s_' + k)}">${k === 'lost' ? '×' : k === 'dup' ? '2' : ''}</i>`).join('');

    // 유실률: 한 번도 못 받고 끝난 메시지의 비율
    const lostPct = pct(L.lostMsg, L.done);
    const dupPct  = pct(L.dupExtra, L.done);
    const perMsg  = L.done > 0 ? L.packets / L.done : 0;

    const cell = (k, n, exp, cls) =>
      `<div class="${cls || ''}"><span class="k">${k}</span>` +
      `<span class="n">${n}</span><span class="e">${exp}</span></div>`;

    el.querySelector('.meters').innerHTML =
      cell(t('mDone'),  L.done, '&nbsp;') +
      cell(t('mLost'),  f1(lostPct) + '%', t('mExp', f1(100 - e.deliv)), lostPct > 0.05 ? 'bad' : '') +
      cell(t('mDup'),   f1(dupPct) + '%',  t('mExp', f1(e.dup)),         dupPct  > 0.05 ? 'bad' : '') +
      cell(t('mPkt'),   perMsg.toFixed(2), t('mExp', e.packets.toFixed(2)));

    el.classList.toggle('win', L.q === 2);
  }

  function render(){
    lanes.forEach(renderLane);

    $('#vLoss').innerHTML = `${Math.round(p * 100)}<small> %</small>`;
    const h = $('#hLoss');
    if (p === 0)        { h.textContent = t('hint0');  h.className = 'hint'; }
    else if (p <= 0.10) { h.textContent = t('hintLo'); h.className = 'hint'; }
    else if (p <= 0.25) { h.textContent = t('hintMid');h.className = 'hint'; }
    else                { h.textContent = t('hintHi'); h.className = 'hint warn'; }

    $('#events').innerHTML =
      log.map(l => `<div class="${l.cls}">${l.text}</div>`).join('');
  }

  /* ============================================================================
   * 4. 시계
   * ========================================================================== */

  let running = false, timer = null;

  function tick(){
    lanes.forEach(step);
    elapsed++;
    render();
  }

  function start(){
    if (running) return;
    running = true;
    $('#btnRun').textContent = t('pause');
    timer = setInterval(tick, STEP_MS);
  }
  function pause(){
    running = false;
    clearInterval(timer);
    $('#btnRun').textContent = t('resume');
  }
  function reset(keepLoss){
    pause();
    lanes = [newLane(0), newLane(1), newLane(2)];
    log = []; elapsed = 0;
    if (!keepLoss){ p = 0; $('#sLoss').value = 0; }
    render();
  }

  /* ============================================================================
   * 5. 시나리오
   * ========================================================================== */

  const SCENE = [
    { loss: 0  },
    { loss: 10 },
    { loss: 20 },
    { loss: 40 },
    { loss: 20 },
  ];

  let stepIdx = 0;

  function applyStep(){
    const s = SCENE[stepIdx];
    $('#sLoss').value = s.loss;
    p = s.loss / 100;
    lanes = [newLane(0), newLane(1), newLane(2)];   // 단계마다 계기를 새로 잡는다
    log = [];
    addLog(t('lgLoss', s.loss), 'warn');
    $('#nText').textContent = S.scene[stepIdx];
    $('#nStep').textContent =
      `${String(stepIdx + 1).padStart(2, '0')} / ${String(SCENE.length).padStart(2, '0')}`;
    $('#btnStep').disabled = stepIdx >= SCENE.length - 1;
    render();
    start();
  }

  $('#btnRun').onclick  = () => running ? pause() : start();
  $('#btnStep').onclick = () => {
    if (stepIdx >= SCENE.length - 1) return;
    stepIdx++; applyStep();
  };
  $('#btnReset').onclick = () => { stepIdx = 0; reset(false); $('#nText').textContent = S.scene[0];
    $('#nStep').textContent = `01 / ${String(SCENE.length).padStart(2, '0')}`;
    $('#btnStep').disabled = false; };

  $('#sLoss').oninput = () => {
    p = +$('#sLoss').value / 100;
    lanes = [newLane(0), newLane(1), newLane(2)];   // 조건이 바뀌면 계기도 새로
    log = [];
    addLog(t('lgLoss', Math.round(p * 100)), 'warn');
    render();
  };

  /* ============================================================================
   * 6. 기동
   * ========================================================================== */

  $('#nText').textContent = S.scene[0];
  $('#nStep').textContent = `01 / ${String(SCENE.length).padStart(2, '0')}`;
  render();
  start();

  // 탭이 가려져 있을 때 타이머를 돌릴 이유가 없다
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && running) pause();
  });

})();
