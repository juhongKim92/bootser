/* ============================================================
   06. WebSocket 다중 서버와 Redis Pub/Sub 실험대 — 로직 전용.

   본문과 화면 문안은 각 언어의 HTML 에 직접 박혀 있다.
   실행 중에만 만들어지는 문자열만 페이지가 window.LAB_I18N 으로 넘긴다.

   모델
   ----
   서버 N 대. 방 하나에 k 명. 그중 d 비율은 재연결 중이라 어느 서버에도
   붙어 있지 않다. 이벤트는 방 밖에서 들어온다 — 로드밸런서가 아무 서버로
   보내고, 그 서버가 방 전체에 알려야 한다.

     로컬만        받은 서버가 자기한테 붙은 소켓에만 쓴다
     전체 브로드캐스트  채널 하나로 발행 → 모든 서버가 받는다
     방별 채널      방마다 채널 → 구성원이 있는 서버만 받는다

   기대값 (s = (1-d)/N — 구성원 한 명이 특정 서버에 접속해 있을 확률)
     도달률   로컬만 s,        Pub/Sub 둘 다 (1-d)
     팬아웃   로컬만 0,        브로드캐스트 N,   방별 N(1-(1-s)^k)
     헛일     브로드캐스트만 (1-s)^k,           나머지 0

   (1-s)^k 은 "그 서버에 이 방 사람이 하나도 없을 확률"이다. 방이 작고
   서버가 많을수록 1 에 가까워진다 — 브로드캐스트가 비싸지는 지점이다.

   발행 주체를 방 구성원이 아니라 방 밖에 둔 이유: 구성원 중에서 뽑으면
   "발행자는 반드시 접속 중" 이라는 조건이 붙어 도달률이 (1-d) 보다
   낮게 나온다. 서버로 들어온 이벤트를 방에 알리는 쪽이 더 흔한 모양이기도 하다.
   ============================================================ */
'use strict';

(function () {

  const S = window.LAB_I18N;
  const t = (k, ...a) => {
    let s = S[k] ?? k;
    a.forEach((v, i) => s = s.replaceAll('$' + (i + 1), v));
    return s;
  };
  const $  = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];

  const TICK_MS = 1100;
  const LOG_MAX = 40;

  /* ============================================================================
   * 1. 상태
   * ========================================================================== */

  let N    = 4;        // 서버 수
  let k    = 12;       // 방 크기
  let d    = 0;        // 재연결 중 비율
  let mode = 'local';  // local | bcast | room

  let msgs = 0, targets = 0, recv = 0, missed = 0, fanSum = 0, wasteSum = 0;
  let frame = null;    // 마지막 메시지의 그림
  let log = [];

  function resetCounters(){
    msgs = targets = recv = missed = fanSum = wasteSum = 0;
    frame = null;
    log = [];
  }

  function addLog(text, cls){
    log.unshift({ text, cls });
    if (log.length > LOG_MAX) log.pop();
  }

  /* ============================================================================
   * 2. 한 번의 발행
   * ========================================================================== */

  function publish(){
    // 구성원의 접속 상태를 새로 뽑는다 — 여러 방·여러 시점의 평균을 보기 위해
    const conn = [], srv = [];
    for (let i = 0; i < k; i++){
      const c = Math.random() >= d;
      conn.push(c);
      srv.push(c ? (Math.random() * N | 0) : -1);
    }
    const origin = Math.random() * N | 0;          // 이벤트가 들어온 서버

    const hosts = new Set(srv.filter(s => s >= 0));
    const gotBy = new Set();                        // 메시지를 받은 서버
    if (mode === 'bcast')     for (let s = 0; s < N; s++) gotBy.add(s);
    else if (mode === 'room') hosts.forEach(s => gotBy.add(s));
    else                      gotBy.add(origin);

    let hit = 0, miss = 0;
    const hitOn = new Map();
    for (let i = 0; i < k; i++){
      targets++;
      if (!conn[i]){ miss++; missed++; continue; }
      if (gotBy.has(srv[i])){ hit++; recv++; hitOn.set(srv[i], (hitOn.get(srv[i]) || 0) + 1); }
      else { miss++; missed++; }
    }

    const fan   = mode === 'local' ? 0 : mode === 'bcast' ? N : hosts.size;
    const waste = mode === 'bcast' ? N - hosts.size : 0;
    fanSum   += fan;
    wasteSum += waste;
    msgs++;

    frame = { srv, conn, origin, gotBy, hitOn, hosts, fan, waste, hit, miss };

    if (mode === 'local' && miss > 0)
      addLog(t('lgLocal', hit, k, origin), 'down');
    if (mode === 'bcast' && waste > 0)
      addLog(t('lgWaste', waste, N), 'warn');
    const off = conn.filter(c => !c).length;
    if (off > 0)
      addLog(t('lgOffline', off), 'down');
  }

  /* ============================================================================
   * 3. 기대값
   * ========================================================================== */

  function expected(){
    const s     = (1 - d) / N;
    const empty = Math.pow(1 - s, k);
    return {
      reach: mode === 'local' ? s * 100 : (1 - d) * 100,
      fan:   mode === 'local' ? 0 : mode === 'bcast' ? N : N * (1 - empty),
      waste: mode === 'bcast' ? empty * 100 : 0,
    };
  }

  /* ============================================================================
   * 4. 그리기
   * ========================================================================== */

  const f1 = n => n.toFixed(1);

  function render(){
    $('#vN').innerHTML    = `${N}<small> ${t('uSrv')}</small>`;
    $('#vK').innerHTML    = `${k}<small> ${t('uMem')}</small>`;
    $('#vD').innerHTML    = `${Math.round(d * 100)}<small> %</small>`;
    $$('#segMode button').forEach(b => b.setAttribute('aria-pressed', b.dataset.mode === mode));

    // 레디스 줄
    const r = $('#redis');
    r.classList.toggle('off', mode === 'local');
    $('#chan').textContent =
      mode === 'local' ? t('chanNone') : mode === 'bcast' ? t('chanAll') : t('chanRoom');
    $('#fanNow').textContent = frame ? t('fanNow', frame.fan, N) : '';

    // 서버 카드
    const boxes = [];
    for (let s = 0; s < N; s++){
      const members = frame ? frame.srv.filter(x => x === s).length : 0;
      const got     = frame ? frame.gotBy.has(s) : false;
      const hits    = frame ? (frame.hitOn.get(s) || 0) : 0;
      const wasted  = got && members === 0;

      let dots = '';
      for (let m = 0; m < members; m++)
        dots += `<i class="${hits > m ? 'hit' : 'mem'}"></i>`;
      if (!members) dots = `<span class="st">${t('sNoMember')}</span>`;

      const st = !frame ? '&nbsp;'
        : wasted ? t('sWaste')
        : got    ? t('sGot', hits)
        : t('sSkip');

      boxes.push(
        `<div class="srv ${got ? (wasted ? 'waste' : 'got') : ''} ${frame && frame.origin === s ? 'origin' : ''}">` +
        `<span class="nm">ws-${s}${frame && frame.origin === s ? `<em>${t('sOrigin')}</em>` : ''}</span>` +
        `<div class="dots">${dots}</div><span class="st">${st}</span></div>`
      );
    }
    $('#servers').innerHTML = boxes.join('');

    const off = frame ? frame.conn.filter(c => !c).length : 0;
    $('#offline').innerHTML = `<i></i>${t('sOffline', off, k)}`;

    // 계기
    const e = expected();
    const reach = targets > 0 ? recv / targets * 100 : 0;
    const fan   = msgs > 0 ? fanSum / msgs : 0;
    const waste = fanSum > 0 ? wasteSum / fanSum * 100 : 0;

    const cell = (kk, n, exp, cls) =>
      `<div class="${cls || ''}"><span class="k">${kk}</span>` +
      `<span class="n">${n}</span><span class="e">${exp}</span></div>`;

    $('#meters').innerHTML =
      cell(t('mReach'), f1(reach) + '%', t('mExp', f1(e.reach)), reach < 99 ? 'bad' : 'good') +
      cell(t('mFan'),   fan.toFixed(2), t('mExp', e.fan.toFixed(2))) +
      cell(t('mWaste'), f1(waste) + '%', t('mExp', f1(e.waste)), waste > 1 ? 'bad' : '') +
      cell(t('mMissed'), missed, t('mOf', targets), missed > 0 ? 'bad' : '');

    // 힌트
    const h = $('#hMode');
    if (mode === 'local' && N > 1){ h.textContent = t('hLocal', Math.round(100 / N)); h.className = 'hint warn'; }
    else if (mode === 'bcast' && e.waste > 20){ h.textContent = t('hWaste', Math.round(e.waste)); h.className = 'hint warn'; }
    else if (d > 0){ h.textContent = t('hOffline'); h.className = 'hint warn'; }
    else { h.textContent = t('hOk'); h.className = 'hint'; }

    $('#events').innerHTML = log.map(l => `<div class="${l.cls}">${l.text}</div>`).join('');
  }

  /* ============================================================================
   * 5. 시계
   * ========================================================================== */

  let running = false, timer = null;

  function tick(){ publish(); render(); }

  function start(){
    if (running) return;
    running = true;
    $('#btnRun').textContent = t('pause');
    timer = setInterval(tick, TICK_MS);
  }
  function pause(){
    running = false;
    clearInterval(timer);
    $('#btnRun').textContent = t('resume');
  }

  function changed(){
    resetCounters();
    addLog(t('lgSetup', N, k, Math.round(d * 100), t('m_' + mode)), 'warn');
    render();
  }

  /* ============================================================================
   * 6. 시나리오
   * ========================================================================== */

  const SCENE = [
    { N:1, k:12, d:0,   mode:'local' },
    { N:4, k:12, d:0,   mode:'local' },
    { N:4, k:12, d:0,   mode:'bcast' },
    { N:8, k:3,  d:0,   mode:'bcast' },
    { N:8, k:3,  d:0,   mode:'room'  },
    { N:4, k:12, d:0.2, mode:'room'  },
  ];

  let stepIdx = 0;

  function applyStep(){
    const s = SCENE[stepIdx];
    N = s.N; k = s.k; d = s.d; mode = s.mode;
    $('#sN').value = N; $('#sK').value = k; $('#sD').value = Math.round(d * 100);
    changed();
    $('#nText').textContent = S.scene[stepIdx];
    $('#nStep').textContent =
      `${String(stepIdx + 1).padStart(2, '0')} / ${String(SCENE.length).padStart(2, '0')}`;
    $('#btnStep').disabled = stepIdx >= SCENE.length - 1;
    start();
  }

  /* ============================================================================
   * 7. 손잡이
   * ========================================================================== */

  $('#sN').oninput = () => { N = +$('#sN').value; changed(); };
  $('#sK').oninput = () => { k = +$('#sK').value; changed(); };
  $('#sD').oninput = () => { d = +$('#sD').value / 100; changed(); };
  $$('#segMode button').forEach(b => {
    b.onclick = () => { mode = b.dataset.mode; changed(); };
  });

  $('#btnRun').onclick  = () => running ? pause() : start();
  $('#btnStep').onclick = () => { if (stepIdx < SCENE.length - 1){ stepIdx++; applyStep(); } };
  $('#btnReset').onclick = () => {
    stepIdx = 0;
    N = 4; k = 12; d = 0; mode = 'local';
    $('#sN').value = N; $('#sK').value = k; $('#sD').value = 0;
    changed();
    $('#nText').textContent = S.scene[0];
    $('#nStep').textContent = `01 / ${String(SCENE.length).padStart(2, '0')}`;
    $('#btnStep').disabled = false;
  };

  /* ============================================================================
   * 8. 기동
   * ========================================================================== */

  $('#nText').textContent = S.scene[0];
  $('#nStep').textContent = `01 / ${String(SCENE.length).padStart(2, '0')}`;
  changed();
  start();

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && running) pause();
  });

})();
