/* ============================================================
   10. 재시도 루프 폭주 · 시퀀스 소진 실험대 — 로직 전용.

   본문과 화면 문안은 각 언어의 HTML 에 직접 박혀 있다.
   실행 중에만 만들어지는 문자열만 페이지가 window.LAB_I18N 으로 넘긴다.

   모델
   ----
   1분마다 도는 적재 배치. 매 주기 FILES 개의 파일이 도착하고 그중 d 비율은
   후행 테이블이 없는 불량 파일이다. 파일 하나당 ROWS 행을 COPY 한다.

     검증 뒤   COPY 를 먼저 하고 검증한다. 불량이면 예외 → 롤백.
               행은 사라지지만 시퀀스는 돌아오지 않는다.
     검증 앞   COPY 전에 검증한다. 불량이면 COPY 자체를 안 한다. 소비 0.

   불량 파일은 성공 표시가 안 되므로 다음 주기에 또 집힌다. 아무 장치가
   없으면 재시도 풀이 주기마다 선형으로 커지고, 소비량은 그 합이라 2차로 는다.

     영구 실패 상태   첫 시도 후 종료 상태로 보내 재시도 대상에서 뺀다 → 풀이 안 큰다
     시도 횟수 상한   k 주기 뒤 풀에서 빠진다 → 풀이 k×신규 에서 멈춘다

   풀 크기는 실수로 누적한다. 반올림하면 낮은 실패율이 뭉개진다.

   시간은 가속돼 있다. 한 tick 이 배치 한 주기(=1분)다.
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

  const INT4    = 2147483647;
  const FILES   = 12;      // 배치당 도착 파일
  const ROWS    = 3000;    // 파일당 행
  const CYCLE_M = 1;       // 배치 주기 (분)
  const TICK_MS = 50;
  const LOG_MAX = 30;

  /* ============================================================================
   * 1. 상태
   * ========================================================================== */

  let validateFirst = false;   // 검증을 COPY 앞에 두는가
  let terminal      = false;   // 영구 실패 상태
  let cap           = 0;       // 시도 횟수 상한 (0 = 없음)
  let d             = 0.10;    // 불량 파일 비율

  let seq = 0, rows = 0, pool = 0, ages = [], cycle = 0, dead = false;
  let lastBurn = 0;      // 직전 주기의 실제 시퀀스 소비량 — 예측은 이 값으로 한다
  let log = [];

  function reset(){
    seq = rows = pool = cycle = lastBurn = 0;
    ages = []; log = []; dead = false;
  }

  function addLog(at, text, cls){
    log.unshift({ at, text, cls });
    if (log.length > LOG_MAX) log.pop();
  }

  /* ============================================================================
   * 2. 배치 한 주기
   * ========================================================================== */

  function runCycle(){
    if (dead) return;
    cycle++;
    const seqBefore = seq;

    const bad  = FILES * d;
    const good = FILES - bad;

    // 정상 파일 — 적재도 되고 시퀀스도 쓴다
    seq  += good * ROWS;
    rows += good * ROWS;

    // 불량 파일이 재시도 풀에 합류
    ages.unshift(bad);
    pool += bad;

    // 풀 전체를 시도한다
    if (!validateFirst){
      seq += pool * ROWS;                 // COPY 하고 롤백 — 시퀀스만 남는다
      if (cycle === 1)
        addLog(cycle, t('lgBurn', Math.round(pool * ROWS).toLocaleString()), 'down');
    }

    // 풀에서 빠지는 조건
    if (terminal){
      if (pool > 0 && cycle === 1) addLog(cycle, t('lgTerminal'), 'up');
      pool = 0; ages.length = 0;
    } else if (cap > 0 && ages.length >= cap){
      const out = ages.pop();
      pool -= out;
      if (cycle === cap) addLog(cycle, t('lgCap', cap), 'warn');
    }

    lastBurn = seq - seqBefore;

    if (!dead && seq >= INT4){
      dead = true;
      addLog(cycle, t('lgDead'), 'down');
    }
    if (!dead && seq > INT4 * 0.7 && seq - (good + pool) * ROWS <= INT4 * 0.7)
      addLog(cycle, t('lgWarn70'), 'warn');
  }

  /* ============================================================================
   * 3. 예측 — 지금 조건 그대로 갔을 때 언제 소진되나
   * ========================================================================== */

  function project(vf, tm, cp, dd){
    let s = 0, p = 0, n = 0, ag = 0;
    const bad = FILES * dd, good = FILES - bad;
    while (s < INT4 && n < 400000){
      n++;
      s += good * ROWS;
      p += bad; ag++;
      if (!vf) s += p * ROWS;
      if (tm){ p = 0; ag = 0; }
      else if (cp > 0 && ag >= cp){ p -= bad; ag--; }
    }
    return n;   // 주기 수 = 분
  }

  /* ============================================================================
   * 4. 서식
   * ========================================================================== */

  const big = n => Math.round(n).toLocaleString();
  const compact = n =>
    n >= 1e9 ? (n / 1e9).toFixed(2) + 'B' :
    n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' :
    n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : String(Math.round(n));

  function dur(min){
    if (min >= 400000) return '—';
    const dys = Math.floor(min / 1440);
    const hrs = Math.floor((min % 1440) / 60);
    const m   = Math.round(min % 60);
    if (dys > 0) return t('fD', dys) + (hrs ? ' ' + t('fH', hrs) : '');
    if (hrs > 0) return t('fH', hrs) + (m ? ' ' + t('fM', m) : '');
    return t('fM', m);
  }

  /* ============================================================================
   * 5. 그리기
   * ========================================================================== */

  function render(){
    $$('#segOrder button').forEach(b => b.setAttribute('aria-pressed', (b.dataset.order === 'first') === validateFirst));
    $$('#segTerm button').forEach(b => b.setAttribute('aria-pressed', (b.dataset.term === 'on') === terminal));
    $('#vCap').innerHTML = cap === 0 ? `<small>${t('noCap')}</small>` : `${cap}<small> ${t('uTimes')}</small>`;
    $('#vD').innerHTML   = `${Math.round(d * 100)}<small> %</small>`;

    const pctSeq  = Math.min(100, seq / INT4 * 100);
    const pctRows = Math.min(100, rows / INT4 * 100);

    $('#gSeq').style.width  = pctSeq + '%';
    $('#gRows').style.width = pctRows + '%';
    $('#nSeq').textContent  = big(seq);
    $('#nRows').textContent = big(rows);
    $('#pSeq').textContent  = pctSeq.toFixed(2) + '%';
    $('#pRows').textContent = pctRows.toFixed(2) + '%';

    $('#dead').innerHTML = dead ? t('deadBody') : '';
    $('#dead').style.display = dead ? '' : 'none';

    const burned  = seq - rows;
    const perCyc  = lastBurn > 0 ? lastBurn : (FILES - FILES * d) * ROWS;
    const left    = Math.max(0, INT4 - seq);
    const etaMin  = dead ? 0 : perCyc > 0 ? left / perCyc * CYCLE_M : Infinity;

    const cell = (k, n, e, cls) =>
      `<div class="${cls || ''}"><span class="k">${k}</span><span class="n">${n}</span>` +
      `<span class="e">${e || '&nbsp;'}</span></div>`;
    $('#meters').innerHTML =
      cell(t('mBurned'), compact(burned), t('mRatio', rows > 0 ? (burned / rows).toFixed(1) : '—'),
           burned > rows ? 'bad' : burned > 0 ? 'warn' : 'good') +
      cell(t('mPool'), pool.toFixed(1), t('mFiles'), pool > FILES ? 'bad' : '') +
      cell(t('mElapsed'), dur(cycle * CYCLE_M), t('mCycles', cycle)) +
      cell(t('mEta'), dead ? t('mNow') : dur(etaMin), '', dead ? 'bad' : etaMin < 1440 ? 'bad' : '');

    /* 구성 비교 — 지금 실패 비율에서 각 조합이 언제 소진되나 */
    const combos = [
      ['a', false, false, 0],
      ['b', false, false, 5],
      ['c', false, true,  0],
      ['d', true,  true,  0],
    ];
    const cur = combos.find(c => c[1] === validateFirst && c[2] === terminal && (c[3] === cap || (c[3] === 5 && cap > 0)));
    $('#cmp').innerHTML =
      `<tr><th>${t('cSetup')}</th><th>${t('cEta')}</th><th>${t('cLeak')}</th></tr>` +
      combos.map(([k, vf, tm, cp]) => {
        const n = project(vf, tm, cp, d);
        const leaks = !vf;
        return `<tr class="${cur && cur[0] === k ? 'on' : ''}"><td>${t('c_' + k)}</td>` +
          `<td class="num ${n < 1440 ? 'bad' : n < 10080 ? 'warn' : ''}">${dur(n)}</td>` +
          `<td class="${leaks ? 'bad' : 'good'}">${t(leaks ? 'cLeakYes' : 'cLeakNo')}</td></tr>`;
      }).join('');

    $('#events').innerHTML = log.map(l =>
      `<div class="${l.cls}"><span class="t">${t('cyc', l.at)}</span><span>${l.text}</span></div>`).join('');

    const h = $('#hint');
    if (dead){ h.textContent = t('hDead'); h.className = 'hint warn'; }
    else if (!validateFirst && !terminal && cap === 0){ h.textContent = t('hWorst'); h.className = 'hint warn'; }
    else if (!validateFirst){ h.textContent = t('hStillLeaks'); h.className = 'hint warn'; }
    else { h.textContent = t('hClean', dur(project(true, terminal, cap, d))); h.className = 'hint good'; }
  }

  /* ============================================================================
   * 6. 시계
   * ========================================================================== */

  let running = false, timer = null;

  function tick(){ runCycle(); render(); if (dead) pause(); }
  function start(){
    if (running || dead) return;
    running = true;
    $('#btnRun').textContent = t('pause');
    timer = setInterval(tick, TICK_MS);
  }
  function pause(){
    running = false;
    clearInterval(timer);
    $('#btnRun').textContent = t('resume');
  }
  function changed(){ pause(); reset(); render(); start(); }

  /* ============================================================================
   * 7. 시나리오
   * ========================================================================== */

  const SCENE = [
    { vf:false, tm:false, cap:0, d:0.10 },
    { vf:false, tm:false, cap:5, d:0.10 },
    { vf:false, tm:true,  cap:0, d:0.10 },
    { vf:true,  tm:true,  cap:0, d:0.10 },
    { vf:true,  tm:true,  cap:0, d:0.30 },
  ];

  let step = 0;

  function applyStep(){
    const s = SCENE[step];
    validateFirst = s.vf; terminal = s.tm; cap = s.cap; d = s.d;
    $('#sCap').value = cap; $('#sD').value = Math.round(d * 100);
    changed();
    $('#nText').textContent = S.scene[step];
    $('#nStep').textContent =
      `${String(step + 1).padStart(2, '0')} / ${String(SCENE.length).padStart(2, '0')}`;
    $('#btnStep').disabled = step >= SCENE.length - 1;
  }

  /* ============================================================================
   * 8. 손잡이
   * ========================================================================== */

  $$('#segOrder button').forEach(b => b.onclick = () => { validateFirst = b.dataset.order === 'first'; changed(); });
  $$('#segTerm button').forEach(b => b.onclick = () => { terminal = b.dataset.term === 'on'; changed(); });
  $('#sCap').oninput = () => { cap = +$('#sCap').value; changed(); };
  $('#sD').oninput   = () => { d = +$('#sD').value / 100; changed(); };

  $('#btnRun').onclick   = () => running ? pause() : start();
  $('#btnStep').onclick  = () => { if (step < SCENE.length - 1){ step++; applyStep(); } };
  $('#btnReset').onclick = () => {
    step = 0;
    validateFirst = false; terminal = false; cap = 0; d = 0.10;
    $('#sCap').value = 0; $('#sD').value = 10;
    changed();
    $('#nText').textContent = S.scene[0];
    $('#nStep').textContent = `01 / ${String(SCENE.length).padStart(2, '0')}`;
    $('#btnStep').disabled = false;
  };

  /* ============================================================================
   * 9. 기동
   * ========================================================================== */

  $('#nText').textContent = S.scene[0];
  $('#nStep').textContent = `01 / ${String(SCENE.length).padStart(2, '0')}`;
  changed();

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && running) pause();
  });

})();
