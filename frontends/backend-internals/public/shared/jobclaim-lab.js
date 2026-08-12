/* ============================================================
   09. 작업 선점 실험대 — 로직 전용.

   본문과 화면 문안은 각 언어의 HTML 에 직접 박혀 있다.
   실행 중에만 만들어지는 문자열만 페이지가 window.LAB_I18N 으로 넘긴다.

   모델
   ----
   인스턴스 N 대가 같은 작업 테이블을 폴링한다. 매 tick 마다 작업 하나를 놓고
   네 가지 선점 방식 중 하나로 경쟁시킨다.

     memory       인메모리 컬렉션 + synchronized
                  DB 상태를 안 바꾸므로 그 행은 계속 PENDING 으로 보인다
                  → 폴링하는 모든 인스턴스가 집는다. 실행 N 회
     readwrite    SELECT 로 읽고 UPDATE 로 RESERVED 를 쓴다
                  → 읽고 쓰는 사이 g 만큼의 창이 남는다
                    다른 인스턴스가 그 창에 들어올 확률 g/T
                    실행 횟수 = 1 + Binomial(N-1, g/T)
     conditional  UPDATE ... WHERE id=? AND state='PENDING'
                  → 원자적이라 한 대만 이긴다. 대신 진 N-1 대는 헛돈다
     skiplocked   SELECT ... FOR UPDATE SKIP LOCKED
                  → 서로 다른 행을 잡으므로 중복도 경합도 없다

   기대값 (T = 폴링 주기, g = read-then-write 갭)
     초과 실행률   memory (N-1)·100%,  readwrite (1-(1-g/T)^(N-1))·100%,  나머지 0
     헛돈 시도/건  conditional N-1,    나머지 0

   N=1 이면 넷 다 0 이다. 이 페이지의 전부가 그 사실이다.

   전제: 처리 시간이 폴링 주기보다 길다. memory 방식에서 모든 인스턴스가
   같은 행을 보게 되는 조건이며, 원래 사례(추론·업로드 배치)가 그랬다.
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

  const POLL_MS = 1000;   // 폴링 주기
  const GAP_MS  = 5;      // SELECT 와 UPDATE 사이
  const TICK_MS = 260;
  const STRIP   = 26;
  const LOG_MAX = 40;

  const MODES = ['memory', 'readwrite', 'conditional', 'skiplocked'];

  /* ============================================================================
   * 1. 상태
   * ========================================================================== */

  let N       = 1;             // 인스턴스 수
  let mode    = 'memory';
  let dieRate = 0;             // 처리 중 죽는 비율
  let reclaim = false;         // 회수 타임아웃

  let jobs = 0, runs = 0, wasted = 0, zombies = 0, reclaimed = 0;
  let strip = [], log = [], nodes = [], frame = null;

  function resetCounters(){
    jobs = runs = wasted = zombies = reclaimed = 0;
    strip = []; log = []; frame = null;
    nodes = Array.from({ length: 6 }, () => ({ won:0, dup:0, lost:0, died:0 }));
  }

  function addLog(text, cls){
    log.unshift({ text, cls });
    if (log.length > LOG_MAX) log.pop();
  }

  /* ============================================================================
   * 2. 작업 하나
   * ========================================================================== */

  function runOne(){
    jobs++;
    const id = jobs;
    const claimers = [];      // 이 작업을 실제로 집은 인스턴스
    const losers   = [];      // 경합에서 진 인스턴스

    if (mode === 'memory'){
      for (let i = 0; i < N; i++) claimers.push(i);
    } else if (mode === 'readwrite'){
      const first = Math.random() * N | 0;
      claimers.push(first);
      for (let i = 0; i < N; i++)
        if (i !== first && Math.random() < GAP_MS / POLL_MS) claimers.push(i);
    } else if (mode === 'conditional'){
      const w = Math.random() * N | 0;
      claimers.push(w);
      for (let i = 0; i < N; i++) if (i !== w) losers.push(i);
    } else {
      claimers.push(Math.random() * N | 0);
    }

    runs += claimers.length;
    wasted += losers.length;
    claimers.forEach((i, k) => { nodes[i].won++; if (k > 0) nodes[i].dup++; });
    losers.forEach(i => nodes[i].lost++);

    // 처리 중 사망 — 상태를 쓰는 방식에서만 좀비가 남는다
    let died = false;
    if (mode !== 'memory' && dieRate > 0 && Math.random() < dieRate){
      died = true;
      nodes[claimers[0]].died++;
      if (reclaim){ reclaimed++; addLog(t('lgReclaim', id, claimers[0]), 'warn'); }
      else        { zombies++;   addLog(t('lgZombie', id, claimers[0]), 'down'); }
    }

    const kind = died && !reclaim ? 'zombie' : claimers.length > 1 ? 'dup' : 'ok';
    strip.push({ kind, n: claimers.length });
    if (strip.length > STRIP) strip.shift();

    if (claimers.length > 1)
      addLog(t('lgDup', id, claimers.length, claimers.map(i => 'w' + i).join(', ')), 'down');

    frame = { id, claimers, losers, died };
  }

  /* ============================================================================
   * 3. 기대값
   * ========================================================================== */

  function expected(m, n){
    const p = GAP_MS / POLL_MS;
    return {
      excess: m === 'memory'     ? (n - 1) * 100
            : m === 'readwrite'  ? (1 - Math.pow(1 - p, n - 1)) * 100
            : 0,
      wasted: m === 'conditional' ? n - 1 : 0,
    };
  }

  /* ============================================================================
   * 4. 그리기
   * ========================================================================== */

  const f1 = n => n.toFixed(1);
  const f2 = n => n.toFixed(2);

  function render(){
    $$('#segMode button').forEach(b => b.setAttribute('aria-pressed', b.dataset.mode === mode));
    $$('#segReclaim button').forEach(b =>
      b.setAttribute('aria-pressed', (b.dataset.reclaim === 'on') === reclaim));
    $('#vN').innerHTML   = `${N}<small> ${t('uInst')}</small>`;
    $('#vDie').innerHTML = dieRate === 0 ? `<small>${t('noDie')}</small>` : `${Math.round(dieRate * 100)}<small> %</small>`;
    $('#vDie').className = 'v' + (mode === 'memory' ? ' off' : '');

    /* 인스턴스 카드 */
    let cards = '';
    for (let i = 0; i < N; i++){
      const n = nodes[i];
      const inFrame = frame && frame.claimers.includes(i);
      const isDup   = frame && frame.claimers.length > 1 && inFrame;
      const isLost  = frame && frame.losers.includes(i);
      const badge = isDup ? t('bDup') : inFrame ? t('bWon') : isLost ? t('bLost') : '';
      cards +=
        `<div class="node ${isDup ? 'dup' : inFrame ? 'won' : isLost ? 'lost' : ''}">` +
        `<span class="nm">worker-${i}<em>${badge}</em></span><div class="rows">` +
        `<span>${t('rWon')}<b>${n.won}</b></span>` +
        `<span class="${n.dup ? 'bad' : ''}">${t('rDup')}<b>${n.dup}</b></span>` +
        `<span>${t('rLost')}<b>${n.lost}</b></span>` +
        `</div></div>`;
    }
    $('#nodes').innerHTML = cards;

    /* 작업 결과 */
    $('#jobs').innerHTML = strip.map(s =>
      `<i class="${s.kind}" title="${t('s_' + s.kind)}">${s.kind === 'dup' ? s.n : s.kind === 'zombie' ? '!' : ''}</i>`
    ).join('');

    /* 계기 */
    const e = expected(mode, N);
    const excess = jobs > 0 ? (runs - jobs) / jobs * 100 : 0;
    const wpj    = jobs > 0 ? wasted / jobs : 0;
    const cell = (k, n, ex, cls) =>
      `<div class="${cls || ''}"><span class="k">${k}</span><span class="n">${n}</span>` +
      `<span class="e">${ex || '&nbsp;'}</span></div>`;
    $('#meters').innerHTML =
      cell(t('mExcess'), f1(excess) + '%', t('mExp', f1(e.excess)), excess > 0.05 ? 'bad' : 'good') +
      cell(t('mWasted'), f2(wpj), t('mExp', f2(e.wasted)), wpj > 0.05 ? 'warn' : '') +
      cell(t('mZombie'), zombies, reclaim ? t('mReclaimed', reclaimed) : '', zombies > 0 ? 'bad' : '') +
      cell(t('mDone'), jobs, '');

    /* 방식 비교 */
    $('#cmp').innerHTML =
      `<tr><th>${t('cMode')}</th><th>${t('cExcess')}</th><th>${t('cWasted')}</th><th>${t('cVerdict')}</th></tr>` +
      MODES.map(m => {
        const x = expected(m, N);
        const safe = x.excess === 0;
        return `<tr class="${m === mode ? 'on' : ''}"><td>${t('m_' + m)}</td>` +
          `<td class="num ${x.excess > 0 ? 'bad' : 'good'}">${f1(x.excess)}%</td>` +
          `<td class="num ${x.wasted > 0 ? 'warn' : ''}">${f2(x.wasted)}</td>` +
          `<td class="${safe ? 'good' : 'bad'}">${t(safe ? 'vSafe' : 'vBroken')}</td></tr>`;
      }).join('');

    $('#events').innerHTML = log.map(l => `<div class="${l.cls}">${l.text}</div>`).join('');

    /* 힌트 */
    const h = $('#hint');
    if (N === 1){ h.textContent = t('hSingle'); h.className = 'hint'; }
    else if (mode === 'memory'){ h.textContent = t('hMemory', N); h.className = 'hint warn'; }
    else if (mode === 'readwrite'){ h.textContent = t('hRw', f1(e.excess)); h.className = 'hint warn'; }
    else if (zombies > 0){ h.textContent = t('hZombie', zombies); h.className = 'hint warn'; }
    else if (mode === 'conditional'){ h.textContent = t('hCond', N - 1); h.className = 'hint'; }
    else { h.textContent = t('hSkip'); h.className = 'hint'; }
  }

  /* ============================================================================
   * 5. 시계
   * ========================================================================== */

  let running = false, timer = null;

  let playSpeed = 1;             // 재생 배율

  function tick(){ runOne(); render(); }
  function start(){
    if (running) return;
    running = true;
    $('#btnRun').textContent = t('pause');
    timer = setInterval(tick, (TICK_MS) / playSpeed);
  }
  function pause(){
    running = false;
    clearInterval(timer);
    $('#btnRun').textContent = t('resume');
  }
  function changed(){
    resetCounters();
    addLog(t('lgSetup', N, t('m_' + mode)), 'warn');
    render();
  }

  /* ============================================================================
   * 6. 시나리오
   * ========================================================================== */

  const SCENE = [
    { N:1, mode:'memory',      die:0,    reclaim:false },
    { N:2, mode:'memory',      die:0,    reclaim:false },
    { N:2, mode:'readwrite',   die:0,    reclaim:false },
    { N:6, mode:'readwrite',   die:0,    reclaim:false },
    { N:6, mode:'conditional', die:0,    reclaim:false },
    { N:6, mode:'skiplocked',  die:0,    reclaim:false },
    { N:6, mode:'skiplocked',  die:0.15, reclaim:false },
    { N:6, mode:'skiplocked',  die:0.15, reclaim:true  },
  ];

  let step = 0;

  function applyStep(){
    const s = SCENE[step];
    N = s.N; mode = s.mode; dieRate = s.die; reclaim = s.reclaim;
    $('#sN').value = N; $('#sDie').value = Math.round(dieRate * 100);
    changed();
    $('#nText').textContent = S.scene[step];
    $('#nStep').textContent =
      `${String(step + 1).padStart(2, '0')} / ${String(SCENE.length).padStart(2, '0')}`;
    $('#btnStep').disabled = step >= SCENE.length - 1;
    $('#btnPrev').disabled = step <= 0;
    start();
  }

  /* ============================================================================
   * 7. 손잡이
   * ========================================================================== */

  $('#sN').oninput   = () => { N = +$('#sN').value; changed(); };
  $('#sDie').oninput = () => { dieRate = +$('#sDie').value / 100; changed(); };
  $$('#segMode button').forEach(b => b.onclick = () => { mode = b.dataset.mode; changed(); });
  $$('#segReclaim button').forEach(b => b.onclick = () => { reclaim = b.dataset.reclaim === 'on'; changed(); });

  $('#btnRun').onclick   = () => running ? pause() : start();
  $('#btnStep').onclick  = () => { if (step < SCENE.length - 1){ step++; applyStep(); } };
  $('#btnPrev').onclick  = () => { pause(); if (step > 0){ step--; applyStep(); } };
  $('#btnPrev').disabled = true;      // 첫 단계에서 시작한다
  [...document.querySelectorAll('#segSpeed button')].forEach(b => b.onclick = () => {
    playSpeed = +b.dataset.speed;
    [...document.querySelectorAll('#segSpeed button')]
      .forEach(x => x.setAttribute('aria-pressed', x === b));
    if (running){ pause(); start(); }   // 돌고 있으면 새 간격으로 다시 건다
  });
  $('#btnReset').onclick = () => {
    step = 0; N = 1; mode = 'memory'; dieRate = 0; reclaim = false;
    $('#sN').value = 1; $('#sDie').value = 0;
    changed();
    $('#nText').textContent = S.scene[0];
    $('#nStep').textContent = `01 / ${String(SCENE.length).padStart(2, '0')}`;
    $('#btnStep').disabled = false;
    start();
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
