/* ============================================================
   11. 백프레셔 · 큐 정책 실험대 — 로직 전용.

   본문과 화면 문안은 각 언어의 HTML 에 직접 박혀 있다.
   실행 중에만 만들어지는 문자열만 페이지가 window.LAB_I18N 으로 넘긴다.

   모델
   ----
   생산자가 초당 L 개의 태스크를 낸다. 소비 스레드 C 개가 태스크당 S 초씩 쓴다.

     처리 용량 cap
       I/O 대기      C / S          — 스레드를 늘린 만큼 는다
       CPU·프로세스   min(C, 코어) / S — 코어를 넘기면 안 는다

   L <= cap 이면 어느 정책이든 큐가 안 쌓인다. 문제는 L > cap 일 때다.

     유계 + Abort       큐가 Q 에서 멈추고 초과분이 거부된다 (초당 L - cap 건)
     유계 + CallerRuns  생산자 스레드가 직접 처리한다 → 용량 cap + 1/S,
                        생산 속도가 그만큼으로 묶인다. 거부 0
     무제한             큐가 초당 L - cap 씩 자란다 → 힙을 채우고 OOM

   OOM 임계 = 힙 여유 / 태스크당 점유. 거부를 없앤 대가가 이것이다.

   시간은 가속돼 있다. 한 tick 이 DT 초다.
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

  const SVC     = 0.12;    // 태스크당 서비스 시간 (초)
  const CORES   = 8;
  const TASK_KB = 256;     // 큐에 매달린 태스크 하나가 잡고 있는 힙
  const HEAP_MB = 512;     // 여유 힙
  const OOM_AT  = Math.round(HEAP_MB * 1024 / TASK_KB);   // 2048
  const DT      = 0.05;    // tick 당 모의 시간 (초)
  const TICK_MS = 60;
  const LOG_MAX = 30;

  /* ============================================================================
   * 1. 상태
   * ========================================================================== */

  let rate   = 200;        // 초당 생산
  let cons   = 8;          // 소비 스레드
  let kind   = 'io';       // io | cpu
  let policy = 'abort';    // abort | callerRuns | unbounded
  let qmax   = 500;

  let queue = 0, done = 0, rejected = 0, elapsed = 0, dead = false;
  let log = [];

  function reset(){
    queue = done = rejected = elapsed = 0;
    dead = false; log = [];
  }
  function addLog(at, text, cls){
    log.unshift({ at, text, cls });
    if (log.length > LOG_MAX) log.pop();
  }

  const capacity = (c, k) => (k === 'io' ? c : Math.min(c, CORES)) / SVC;

  /* ============================================================================
   * 2. 한 tick
   * ========================================================================== */

  function tick(){
    if (dead) return;
    elapsed += DT;

    const cap  = capacity(cons, kind);
    const over = rate > cap;

    if (policy === 'callerRuns'){
      // 생산자가 직접 처리하는 만큼 생산 속도가 묶인다
      const total = cap + 1 / SVC;
      const acc   = Math.min(rate, total);
      done += acc * DT;
      const target = rate > total ? qmax : rate > cap ? qmax : 0;
      queue += (target - queue) * 0.25;          // 포화점으로 수렴
    } else {
      queue += rate * DT;
      const served = Math.min(queue, cap * DT);
      queue -= served;
      done  += served;

      if (policy === 'abort' && queue > qmax){
        const drop = queue - qmax;
        rejected += drop;
        queue = qmax;
        if (rejected > 0 && rejected - drop <= 0)
          addLog(elapsed, t('lgFirstReject', qmax), 'down');
      }
    }

    if (policy === 'unbounded'){
      if (!dead && queue >= OOM_AT * 0.5 && queue - rate * DT < OOM_AT * 0.5)
        addLog(elapsed, t('lgHalf', Math.round(queue)), 'warn');
      if (!dead && queue >= OOM_AT){
        dead = true;
        addLog(elapsed, t('lgOom', OOM_AT, HEAP_MB), 'down');
      }
    }

    if (!over && queue < 1 && elapsed > 1 && !log.some(l => l.k === 'ok')){
      const e = { at: elapsed, text: t('lgHealthy'), cls: 'up', k: 'ok' };
      log.unshift(e);
      if (log.length > LOG_MAX) log.pop();
    }
  }

  /* ============================================================================
   * 3. 정상 상태 — 지금 조건에서 각 정책이 어떻게 되나
   * ========================================================================== */

  function steady(p, c, k, r){
    const cap  = capacity(c, k);
    const over = r > cap;
    if (p === 'callerRuns')
      return { thr: over ? cap + 1 / SVC : r, rej: 0, depth: over ? qmax : 0, oom: null };
    if (p === 'abort')
      return { thr: Math.min(r, cap), rej: over ? r - cap : 0, depth: over ? qmax : 0, oom: null };
    return { thr: Math.min(r, cap), rej: 0, depth: over ? Infinity : 0,
             oom: over ? OOM_AT / (r - cap) : null };
  }

  /* ============================================================================
   * 4. 그리기
   * ========================================================================== */

  const f1 = n => n.toFixed(1);

  function render(){
    $$('#segKind button').forEach(b => b.setAttribute('aria-pressed', b.dataset.kind === kind));
    $$('#segPolicy button').forEach(b => b.setAttribute('aria-pressed', b.dataset.policy === policy));
    $('#vRate').innerHTML = `${rate}<small> ${t('uPs')}</small>`;
    $('#vCons').innerHTML = `${cons}<small> ${t('uThr')}</small>`;
    $('#vQmax').innerHTML = policy === 'unbounded' ? `<small>${t('noLimit')}</small>` : `${qmax}<small> ${t('uTask')}</small>`;
    $('#vQmax').className = 'v' + (policy === 'unbounded' ? ' off' : '');

    const cap  = capacity(cons, kind);
    const st   = steady(policy, cons, kind, rate);
    const over = rate > cap;

    /* 파이프 */
    $('#boxIn').className  = 'box' + (over ? ' over' : ' ok');
    $('#nIn').textContent  = rate;
    $('#boxOut').className = 'box' + (over && policy !== 'callerRuns' ? ' over' : ' ok');
    $('#nOut').textContent = f1(st.thr);
    $('#nCap').textContent = f1(cap);

    /* 큐 */
    const scale = policy === 'unbounded' ? OOM_AT : Math.max(qmax * 1.15, 1);
    const pct   = Math.min(100, queue / scale * 100);
    const fill  = $('#qFill');
    fill.style.width = pct + '%';
    fill.className = 'fill' + (dead ? ' oom' : queue >= OOM_AT * 0.5 ? ' hot' : '');
    $('#qLim').style.display = policy === 'unbounded' ? 'none' : '';
    $('#qLim').style.left = Math.min(100, qmax / scale * 100) + '%';
    $('#qNow').textContent  = t('qNow', Math.round(queue));
    $('#qScale').textContent = policy === 'unbounded' ? t('qOomAt', OOM_AT, HEAP_MB) : t('qMax', qmax);

    /* 워커 */
    let w = '';
    const busy = Math.min(cons, Math.round(Math.min(queue, cap * SVC)));
    for (let i = 0; i < Math.min(cons, 40); i++)
      w += `<i class="${i < busy ? 'busy' : 'idle'}"></i>`;
    if (policy === 'callerRuns' && over) w += `<i class="caller" title="${t('wCaller')}"></i>`;
    $('#workers').innerHTML = w;

    /* 경고 패널 */
    let alert = '';
    if (dead) alert = t('oomBody', OOM_AT, HEAP_MB);
    else if (policy === 'abort' && rejected >= 1)
      alert = t('rejBody', cons, cons, Math.round(queue), Math.round(done), f1(st.rej));
    $('#alert').innerHTML = alert;
    $('#alert').style.display = alert ? '' : 'none';

    /* 계기 */
    const cell = (k, n, e, cls) =>
      `<div class="${cls || ''}"><span class="k">${k}</span><span class="n">${n}</span>` +
      `<span class="e">${e || '&nbsp;'}</span></div>`;
    const heapMB = queue * TASK_KB / 1024;
    $('#meters').innerHTML =
      cell(t('mQueue'), Math.round(queue), t('mOf', policy === 'unbounded' ? '∞' : qmax),
           dead ? 'bad' : queue >= qmax ? 'warn' : '') +
      cell(t('mHeap'), f1(heapMB) + ' MB', t('mOfHeap', HEAP_MB), heapMB > HEAP_MB * 0.5 ? 'bad' : '') +
      cell(t('mRej'), Math.round(rejected), st.rej > 0 ? t('mPerSec', f1(st.rej)) : '',
           rejected > 0 ? 'warn' : 'good') +
      cell(t('mThr'), f1(st.thr) + ' ' + t('uPs'), t('mCap', f1(cap)), over && policy !== 'callerRuns' ? 'bad' : 'good') +
      cell(t('mElapsed'), f1(elapsed) + t('uSec'), '');

    /* 정책 비교 */
    const POL = ['abort', 'callerRuns', 'unbounded'];
    $('#cmp').innerHTML =
      `<tr><th>${t('cPol')}</th><th>${t('cDepth')}</th><th>${t('cRej')}</th>` +
      `<th>${t('cThr')}</th><th>${t('cRisk')}</th></tr>` +
      POL.map(p => {
        const s = steady(p, cons, kind, rate);
        const risk = p === 'unbounded' && s.oom ? t('rOom', f1(s.oom))
                   : p === 'abort' && s.rej > 0 ? t('rLoss')
                   : p === 'callerRuns' && rate > cap ? t('rSlow')
                   : t('rNone');
        const rc = p === 'unbounded' && s.oom ? 'bad' : s.rej > 0 ? 'warn'
                 : p === 'callerRuns' && rate > cap ? 'warn' : 'good';
        return `<tr class="${p === policy ? 'on' : ''}"><td>${t('p_' + p)}</td>` +
          `<td class="num ${s.depth === Infinity ? 'bad' : ''}">${s.depth === Infinity ? '∞' : Math.round(s.depth)}</td>` +
          `<td class="num ${s.rej > 0 ? 'warn' : ''}">${f1(s.rej)}</td>` +
          `<td class="num">${f1(s.thr)}</td>` +
          `<td class="${rc}">${risk}</td></tr>`;
      }).join('');

    $('#events').innerHTML = log.map(l =>
      `<div class="${l.cls}"><span class="t">${f1(l.at)}${t('uSec')}</span><span>${l.text}</span></div>`).join('');

    /* 힌트 */
    const h = $('#hint');
    if (dead){ h.textContent = t('hOom'); h.className = 'hint warn'; }
    else if (!over){ h.textContent = t('hHealthy', f1(cap)); h.className = 'hint good'; }
    else if (kind === 'cpu' && cons > CORES){ h.textContent = t('hCpu', CORES, f1(cap)); h.className = 'hint warn'; }
    else if (policy === 'unbounded'){ h.textContent = t('hUnbounded', f1(steady('unbounded', cons, kind, rate).oom)); h.className = 'hint warn'; }
    else if (policy === 'abort'){ h.textContent = t('hAbort', f1(st.rej)); h.className = 'hint warn'; }
    else { h.textContent = t('hCaller', f1(st.thr)); h.className = 'hint'; }
  }

  /* ============================================================================
   * 5. 시계
   * ========================================================================== */

  let running = false, timer = null;

  function step(){ tick(); render(); if (dead) pause(); }
  function start(){
    if (running || dead) return;
    running = true;
    $('#btnRun').textContent = t('pause');
    timer = setInterval(step, TICK_MS);
  }
  function pause(){
    running = false;
    clearInterval(timer);
    $('#btnRun').textContent = t('resume');
  }
  function changed(){ pause(); reset(); render(); start(); }

  /* ============================================================================
   * 6. 시나리오
   * ========================================================================== */

  const SCENE = [
    { rate:50,  cons:8,  kind:'io',  policy:'abort' },
    { rate:200, cons:8,  kind:'io',  policy:'abort' },
    { rate:200, cons:8,  kind:'io',  policy:'unbounded' },
    { rate:200, cons:8,  kind:'io',  policy:'callerRuns' },
    { rate:200, cons:32, kind:'io',  policy:'callerRuns' },
    { rate:200, cons:32, kind:'cpu', policy:'callerRuns' },
    { rate:50,  cons:8,  kind:'cpu', policy:'abort' },
  ];

  let idx = 0;

  function applyStep(){
    const s = SCENE[idx];
    rate = s.rate; cons = s.cons; kind = s.kind; policy = s.policy;
    $('#sRate').value = rate; $('#sCons').value = cons; $('#sQmax').value = qmax;
    changed();
    $('#nText').textContent = window.LAB_I18N.scene[idx];
    $('#nStep').textContent =
      `${String(idx + 1).padStart(2, '0')} / ${String(SCENE.length).padStart(2, '0')}`;
    $('#btnStep').disabled = idx >= SCENE.length - 1;
  }

  /* ============================================================================
   * 7. 손잡이
   * ========================================================================== */

  $('#sRate').oninput = () => { rate = +$('#sRate').value; changed(); };
  $('#sCons').oninput = () => { cons = +$('#sCons').value; changed(); };
  $('#sQmax').oninput = () => { qmax = +$('#sQmax').value; changed(); };
  $$('#segKind button').forEach(b => b.onclick = () => { kind = b.dataset.kind; changed(); });
  $$('#segPolicy button').forEach(b => b.onclick = () => { policy = b.dataset.policy; changed(); });

  $('#btnRun').onclick   = () => running ? pause() : start();
  $('#btnStep').onclick  = () => { if (idx < SCENE.length - 1){ idx++; applyStep(); } };
  $('#btnReset').onclick = () => {
    idx = 0; qmax = 500;
    rate = 50; cons = 8; kind = 'io'; policy = 'abort';
    $('#sRate').value = rate; $('#sCons').value = cons; $('#sQmax').value = qmax;
    changed();
    $('#nText').textContent = window.LAB_I18N.scene[0];
    $('#nStep').textContent = `01 / ${String(SCENE.length).padStart(2, '0')}`;
    $('#btnStep').disabled = false;
  };

  /* ============================================================================
   * 8. 기동
   * ========================================================================== */

  $('#nText').textContent = window.LAB_I18N.scene[0];
  $('#nStep').textContent = `01 / ${String(SCENE.length).padStart(2, '0')}`;
  changed();

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && running) pause();
  });

})();
