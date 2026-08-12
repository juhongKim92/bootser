/* ============================================================
   12. 요청-응답 매칭 · correlationId 실험대 — 로직 전용.

   본문과 화면 문안은 각 언어의 HTML 에 직접 박혀 있다.
   실행 중에만 만들어지는 문자열만 페이지가 window.LAB_I18N 으로 넘긴다.

   모델 — 끊기지 않는 스트림
   ----
   같은 단말에 요청을 계속 보낸다. 동시에 떠 있는 건 최대 N 건.
   응답은 RTT 뒤에 오고, 교란에 따라 순서가 뒤집히거나 늦게 오거나 두 번 온다.

     단일 슬롯   pendingMap.put(serial, future) — 새 요청이 앞의 future 를 덮어쓴다
     FIFO 큐     키별 큐. 도착한 응답이 큐의 맨 앞을 완료시킨다
     직렬화      동시 1건으로 강제. 위치로 찾는 건 같다
     correlationId  요청 id 로 찾는다

   위치로 찾는 세 방식은 한 번 어긋나면 스스로 복구하지 못한다.
   응답 하나가 밀리면 그 뒤로 전부 한 칸씩 밀린 채로 간다 — 화면에서
   오매칭률이 100% 에 붙는 이유다.

   동시 요청이 1건이어도 지각·중복은 오매칭을 만든다. 동시성 문제가 아니라
   식별자가 없어서 생기는 문제라는 뜻이다.
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

  const ISSUE_EVERY = 2, RTT = 6, TIMEOUT = 20, LATE_EXTRA = 6, DUP_GAP = 1;
  const HORIZON = 64;          // 이벤트 버킷
  const STEPS_PER_TICK = 3;
  const TICK_MS = 55;
  const STRIP = 18, LOG_MAX = 28;

  const STRATS = ['single', 'fifo', 'serialize', 'correlation'];

  /* ============================================================================
   * 1. 상태
   * ========================================================================== */

  let N = 4, strat = 'single', dist = 'none', d = 0.4;

  let buck, slot, queue, map, live, ok, mis, lost, issued, seq, pending, clock, strip, log;

  function reset(){
    buck = Array.from({ length: HORIZON }, () => []);
    slot = null; queue = []; map = new Map(); live = new Set();
    ok = mis = lost = issued = seq = pending = clock = 0;
    strip = []; log = [];
  }
  reset();

  const cap  = () => strat === 'serialize' ? 1 : N;
  const at   = (tm, e) => buck[tm % HORIZON].push(e);
  const byId = () => strat === 'correlation';

  function addLog(text, cls){
    log.unshift({ text, cls });
    if (log.length > LOG_MAX) log.pop();
  }
  function mark(kind, id){
    strip.push({ kind, id });
    if (strip.length > STRIP) strip.shift();
  }

  /* ============================================================================
   * 2. 한 스텝
   * ========================================================================== */

  function drop(id){
    if (byId()){ if (map.has(id)){ map.delete(id); return true; } return false; }
    if (strat === 'single'){ if (slot === id){ slot = null; return true; } return false; }
    const i = queue.indexOf(id);
    if (i >= 0){ queue.splice(i, 1); return true; }
    return false;
  }

  function deliver(id){
    if (byId()){
      if (map.has(id)){ map.delete(id); live.delete(id); pending--; ok++; mark('ok', id); }
      return;                                   // 지각분·중복분은 짝이 없어 버려진다
    }
    let owner;
    if (strat === 'single'){ if (slot === null) return; owner = slot; slot = null; }
    else { if (!queue.length) return; owner = queue.shift(); }
    live.delete(owner); pending--;
    if (owner === id){ ok++; mark('ok', owner); }
    else {
      mis++; mark('mis', owner);
      addLog(t('lgMis', owner, id), 'down');
    }
  }

  function step(){
    clock++;
    const cell = buck[clock % HORIZON];
    for (const e of cell){
      if (e.k === 'r') deliver(e.id);
      else if (live.has(e.id)){                 // 타임아웃 — 아직 대기 중이면 유실
        drop(e.id); live.delete(e.id); pending--; lost++; mark('lost', e.id);
        addLog(t('lgLost', e.id), 'warn');
      }
    }
    cell.length = 0;

    if (clock % ISSUE_EVERY === 0 && pending < cap()){
      const id = seq++; issued++; pending++; live.add(id);
      const late = dist === 'late' && Math.random() < d;
      let r = late ? TIMEOUT + LATE_EXTRA : RTT;
      if (dist === 'reorder' && Math.random() < d) r += (Math.random() < 0.5 ? -3 : 3);
      r = Math.max(1, r);
      at(clock + r, { k: 'r', id });
      if (dist === 'dup' && Math.random() < d) at(clock + r + DUP_GAP, { k: 'r', id });
      at(clock + TIMEOUT, { k: 't', id });

      if (byId()) map.set(id, true);
      else if (strat === 'single'){
        if (slot !== null) addLog(t('lgOverwrite', slot, id), 'down');
        slot = id;                              // 앞의 future 가 사라진다
      }
      else queue.push(id);
    }
  }

  /* ============================================================================
   * 3. 구조적 판정 — 이 방식이 이 교란에 원리적으로 안전한가
   * ========================================================================== */

  function safe(s, dt){
    if (s === 'correlation') return true;                 // id 로 찾으므로 전부 무해
    if (s === 'single') return dt === 'none' && cap() === 1;
    if (s === 'serialize') return dt === 'none' || dt === 'reorder';
    return dt === 'none';                                  // fifo
  }

  /* ============================================================================
   * 4. 그리기
   * ========================================================================== */

  const f1 = n => n.toFixed(1);

  function render(){
    $$('#segStrat button').forEach(b => b.setAttribute('aria-pressed', b.dataset.strat === strat));
    $$('#segDist button').forEach(b => b.setAttribute('aria-pressed', b.dataset.dist === dist));
    $('#vN').innerHTML = `${N}<small> ${t('uReq')}</small>`;
    $('#vN').className = 'v' + (strat === 'serialize' ? ' off' : '');
    $('#vD').innerHTML = dist === 'none' ? `<small>${t('noDist')}</small>` : `${Math.round(d * 100)}<small> %</small>`;
    $('#vD').className = 'v' + (dist === 'none' ? ' off' : '');

    $('#strip').innerHTML = strip.map(s =>
      `<i class="${s.kind}" title="${t('s_' + s.kind)}">#${s.id % 100}</i>`).join('');

    const waiting = byId() ? [...map.keys()] : strat === 'single' ? (slot === null ? [] : [slot]) : queue;
    $('#pend').innerHTML = `<span class="k">${t('pWaiting')}</span>` +
      (waiting.length
        ? waiting.map(id => `<i class="${strat === 'single' ? 'slot' : ''}">#${id % 100}</i>`).join('')
        : `<i style="border-color:var(--rule);color:var(--ink-3)">${t('pEmpty')}</i>`);

    const total = ok + mis + lost || 1;
    const cell = (k, n, e, cls) =>
      `<div class="${cls || ''}"><span class="k">${k}</span><span class="n">${n}</span>` +
      `<span class="e">${e || '&nbsp;'}</span></div>`;
    $('#meters').innerHTML =
      cell(t('mOk'),   f1(ok / total * 100) + '%',  '', ok / total > 0.99 ? 'good' : '') +
      cell(t('mMis'),  f1(mis / total * 100) + '%', '', mis > 0 ? 'bad' : 'good') +
      cell(t('mLost'), f1(lost / total * 100) + '%', '', lost > 0 ? 'warn' : '') +
      cell(t('mDone'), issued, t('mInFlight', cap()));

    $('#verdict').innerHTML = safe(strat, dist)
      ? t('vSafe') : t('vBroken');
    $('#verdict').style.display = '';

    $('#cmp').innerHTML =
      `<tr><th>${t('cStrat')}</th><th>${t('cSafe')}</th><th>${t('cWhy')}</th></tr>` +
      STRATS.map(s => {
        const ss = safe(s, dist);
        return `<tr class="${s === strat ? 'on' : ''}"><td>${t('st_' + s)}</td>` +
          `<td class="${ss ? 'good' : 'bad'}">${t(ss ? 'cYes' : 'cNo')}</td>` +
          `<td>${t('why_' + s + '_' + dist)}</td></tr>`;
      }).join('');

    $('#events').innerHTML = log.map(l => `<div class="${l.cls}">${l.text}</div>`).join('');

    const h = $('#hint');
    if (strat === 'correlation'){ h.textContent = t('hCorr'); h.className = 'hint good'; }
    else if (strat === 'single'){ h.textContent = t('hSingle'); h.className = 'hint warn'; }
    else if (!safe(strat, dist)){ h.textContent = t('hDrift'); h.className = 'hint warn'; }
    else if (strat === 'serialize'){ h.textContent = t('hSerial'); h.className = 'hint'; }
    else { h.textContent = t('hOk'); h.className = 'hint'; }
  }

  /* ============================================================================
   * 5. 시계
   * ========================================================================== */

  let running = false, timer = null;

  let playSpeed = 1;             // 재생 배율
  function onTick(){ for (let i = 0; i < STEPS_PER_TICK; i++) step(); render(); }
  function start(){
    if (running) return;
    running = true; $('#btnRun').textContent = t('pause');
    timer = setInterval(onTick, (TICK_MS) / playSpeed);
  }
  function pause(){ running = false; clearInterval(timer); $('#btnRun').textContent = t('resume'); }
  function changed(){ pause(); reset(); render(); start(); }

  /* ============================================================================
   * 6. 시나리오
   * ========================================================================== */

  const SCENE = [
    { N:1, strat:'single',      dist:'none',    d:0.4 },
    { N:4, strat:'single',      dist:'none',    d:0.4 },
    { N:4, strat:'fifo',        dist:'none',    d:0.4 },
    { N:4, strat:'fifo',        dist:'reorder', d:0.4 },
    { N:4, strat:'serialize',   dist:'reorder', d:0.4 },
    { N:4, strat:'serialize',   dist:'late',    d:0.4 },
    { N:4, strat:'fifo',        dist:'dup',     d:0.4 },
    { N:4, strat:'correlation', dist:'dup',     d:0.4 },
  ];
  let idx = 0;

  function applyStep(){
    const s = SCENE[idx];
    N = s.N; strat = s.strat; dist = s.dist; d = s.d;
    $('#sN').value = N; $('#sD').value = Math.round(d * 100);
    changed();
    $('#nText').textContent = S.scene[idx];
    $('#nStep').textContent =
      `${String(idx + 1).padStart(2, '0')} / ${String(SCENE.length).padStart(2, '0')}`;
    $('#btnStep').disabled = idx >= SCENE.length - 1;
    $('#btnPrev').disabled = idx <= 0;
  }

  /* ============================================================================
   * 7. 손잡이
   * ========================================================================== */

  $('#sN').oninput = () => { N = +$('#sN').value; changed(); };
  $('#sD').oninput = () => { d = +$('#sD').value / 100; changed(); };
  $$('#segStrat button').forEach(b => b.onclick = () => { strat = b.dataset.strat; changed(); });
  $$('#segDist button').forEach(b => b.onclick = () => { dist = b.dataset.dist; changed(); });

  $('#btnRun').onclick   = () => running ? pause() : start();
  $('#btnStep').onclick  = () => { if (idx < SCENE.length - 1){ idx++; applyStep(); } };
  $('#btnPrev').onclick  = () => { pause(); if (idx > 0){ idx--; applyStep(); } };
  $('#btnPrev').disabled = true;      // 첫 단계에서 시작한다
  [...document.querySelectorAll('#segSpeed button')].forEach(b => b.onclick = () => {
    playSpeed = +b.dataset.speed;
    [...document.querySelectorAll('#segSpeed button')]
      .forEach(x => x.setAttribute('aria-pressed', x === b));
    if (running){ pause(); start(); }   // 돌고 있으면 새 간격으로 다시 건다
  });
  $('#btnReset').onclick = () => {
    idx = 0; N = 1; strat = 'single'; dist = 'none'; d = 0.4;
    $('#sN').value = N; $('#sD').value = 40;
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

  document.addEventListener('visibilitychange', () => { if (document.hidden && running) pause(); });

})();
