/* ============================================================
   08. 커넥션 풀 · OSIV · 트랜잭션 경계 실험대 — 로직 전용.

   본문과 화면 문안은 각 언어의 HTML 에 직접 박혀 있다.
   실행 중에만 만들어지는 문자열만 페이지가 window.LAB_I18N 으로 넘긴다.

   시간이 흐르지 않는다. 손잡이를 움직이면 그 조건을 통째로 다시 계산한다.

   요청 하나의 구성 (모두 고정값)
     사전 처리   5ms   DB 없음
     쿼리 1     17ms   ← 누수 경고 스택이 가리키는 그 쿼리
     외부 호출   io     DB 없음 (S3 업로드 · 외부 API)
     쿼리 2      8ms
     응답 렌더    25ms   DB 없음

   커넥션 점유 시간
     OSIV 켜짐            17 + io + 8 + 25   첫 쿼리에서 빌려 응답 끝까지 쥔다
     OSIV 끔              17 + io + 8        트랜잭션이 외부 호출을 감싼다
     OSIV 끔 + 외부 분리    17 + 8            외부 호출 동안 반납한다

   실제로 DB 를 쓰는 시간은 셋 다 25ms 로 같다. 달라지는 건 쥐고 있는 시간뿐이다.

   판정은 리틀의 법칙 하나로 한다.
     필요 커넥션 = 초당 요청 수 × 점유 시간(초)
     처리 상한   = 풀 크기 ÷ 점유 시간(초)

   대기 시간은 계산하지 않는다. 도착 분포를 가정해야 하는데 그 가정을
   정당화할 근거가 없다. 필요 커넥션과 풀 크기를 나란히 놓는 것으로 충분하다.
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

  const PRE = 5, Q1 = 17, Q2 = 8, RENDER = 25;
  const DB_TIME = Q1 + Q2;          // 실제로 DB 를 쓰는 시간 — 구성과 무관하게 고정
  const LEAK_MS = 2000;             // leak-detection-threshold 를 2초로 뒀을 때
  const POOL_MAX_DRAW = 60;         // 그림으로 그릴 슬롯 상한

  /* ============================================================================
   * 1. 상태
   * ========================================================================== */

  let mode = 'osiv';   // osiv | txin | txout
  let rps  = 50;       // 초당 요청 수
  let io   = 300;      // 외부 호출 시간 (ms)
  let pool = 10;       // 풀 크기

  const MODES = ['osiv', 'txin', 'txout'];

  const holdOf = (m, ioMs) =>
    m === 'osiv'  ? Q1 + ioMs + Q2 + RENDER :
    m === 'txin'  ? Q1 + ioMs + Q2 :
                    Q1 + Q2;

  function stats(m){
    const hold = holdOf(m, io);
    const need = rps * hold / 1000;          // 리틀의 법칙
    const cap  = pool / (hold / 1000);       // 처리 상한
    return { hold, need, cap, util: need / pool * 100, short: need > pool };
  }

  /* ============================================================================
   * 2. 서식
   * ========================================================================== */

  const ms = n => n >= 1000 ? (n / 1000).toFixed(2) + 's' : Math.round(n) + 'ms';
  const f1 = n => n.toFixed(1);

  /* ============================================================================
   * 3. 그리기
   * ========================================================================== */

  function render(){
    $$('#segMode button').forEach(b => b.setAttribute('aria-pressed', b.dataset.mode === mode));
    $('#vRps').innerHTML  = `${rps}<small> ${t('uRps')}</small>`;
    $('#vIo').innerHTML   = io === 0 ? `<small>${t('noIo')}</small>` : `${io}<small> ms</small>`;
    $('#vPool').innerHTML = `${pool}<small> ${t('uConn')}</small>`;

    const st    = stats(mode);
    const total = PRE + Q1 + io + Q2 + RENDER;
    const pc    = n => n / total * 100;

    /* 요청 하나의 시간축 */
    const held = mode !== 'txout';                       // 외부 호출 동안 쥐고 있나
    const seg = (cls, w, label) =>
      w <= 0 ? '' : `<div class="${cls}" style="width:${w}%">${w > 9 ? label : ''}</div>`;

    $('#bar').innerHTML =
      seg('free', pc(PRE), t('sPre')) +
      seg('db',   pc(Q1),  t('sQ1')) +
      (io > 0 ? seg(held ? 'held' : 'released', pc(io), held ? t('sIoHeld') : t('sIoFree')) : '') +
      seg('db',   pc(Q2),  t('sQ2')) +
      seg(mode === 'osiv' ? 'held' : 'free', pc(RENDER), t('sRender'));

    /* 점유 구간 표시 */
    const holdStart = pc(PRE);
    const holdEnd   = mode === 'osiv' ? 100 : pc(PRE + Q1 + io + Q2);
    $('#hold').innerHTML =
      `<div class="off" style="width:${holdStart}%"></div>` +
      (mode === 'txout'
        ? `<div class="on" style="width:${pc(Q1)}%"></div>` +
          `<div class="off" style="width:${pc(io)}%">${io > 0 ? t('sReleased') : ''}</div>` +
          `<div class="on" style="width:${pc(Q2)}%"></div>` +
          `<div class="off" style="width:${pc(RENDER)}%"></div>`
        : `<div class="on" style="width:${holdEnd - holdStart}%">${t('sHold', ms(st.hold))}</div>` +
          `<div class="off" style="width:${100 - holdEnd}%"></div>`);

    /* 풀 */
    const busy = Math.min(pool, Math.round(st.need));
    let slots = '';
    for (let i = 0; i < Math.min(pool, POOL_MAX_DRAW); i++)
      slots += `<i class="${i < busy ? 'busy' : 'spare'}"></i>`;
    if (pool > POOL_MAX_DRAW) slots += `<span class="queued">…</span>`;
    $('#pool').innerHTML = slots;
    $('#queued').innerHTML = st.short
      ? t('qShort', f1(st.need), pool, f1(st.need - pool))
      : t('qOk', f1(st.need), pool);
    $('#queued').style.color = st.short ? 'var(--blocked)' : 'var(--ink-3)';

    /* 계기 */
    const cell = (k, n, e, cls) =>
      `<div class="${cls || ''}"><span class="k">${k}</span><span class="n">${n}</span>` +
      `<span class="e">${e || '&nbsp;'}</span></div>`;
    $('#meters').innerHTML =
      cell(t('mHold'), ms(st.hold), t('mOfDb', ms(DB_TIME)), st.hold > 100 ? 'bad' : '') +
      cell(t('mNeed'), f1(st.need), t('mLittle'), st.short ? 'bad' : 'good') +
      cell(t('mUtil'), f1(st.util) + '%', '', st.util >= 100 ? 'bad' : st.util > 80 ? 'bad' : 'good') +
      cell(t('mCap'),  f1(st.cap) + ' ' + t('uRps'), t('mAt', pool), st.cap < rps ? 'bad' : 'good');

    /* 누수 경고 */
    $('#leak').innerHTML = st.hold >= LEAK_MS
      ? t('leakBody', ms(st.hold), LEAK_MS / 1000, ms(Q1))
      : '';
    $('#leak').style.display = st.hold >= LEAK_MS ? '' : 'none';

    /* 구성 비교 */
    $('#cmp').innerHTML =
      `<tr><th>${t('cMode')}</th><th>${t('cHold')}</th><th>${t('cDb')}</th>` +
      `<th>${t('cNeed')}</th><th>${t('cCap')}</th></tr>` +
      MODES.map(m => {
        const s = stats(m);
        return `<tr class="${m === mode ? 'on' : ''}"><td>${t('m_' + m)}</td>` +
          `<td class="num ${s.hold > 100 ? 'bad' : ''}">${ms(s.hold)}</td>` +
          `<td class="num">${ms(DB_TIME)}</td>` +
          `<td class="num ${s.short ? 'bad' : 'good'}">${f1(s.need)}</td>` +
          `<td class="num ${s.cap < rps ? 'bad' : 'good'}">${f1(s.cap)}</td></tr>`;
      }).join('');

    /* 힌트 */
    const h = $('#hint');
    if (st.short){ h.textContent = t('hShort', f1(st.need), pool); h.className = 'hint warn'; }
    else if (st.hold >= LEAK_MS){ h.textContent = t('hLeak'); h.className = 'hint warn'; }
    else if (mode === 'txout' && io > 0){ h.textContent = t('hGood', ms(st.hold)); h.className = 'hint'; }
    else { h.textContent = t('hOk', f1(st.util)); h.className = 'hint'; }
  }

  /* ============================================================================
   * 4. 시나리오
   * ========================================================================== */

  const SCENE = [
    { mode:'osiv',  rps:50,  io:0,    pool:10 },
    { mode:'osiv',  rps:50,  io:300,  pool:10 },
    { mode:'txin',  rps:50,  io:300,  pool:10 },
    { mode:'txout', rps:50,  io:300,  pool:10 },
    { mode:'osiv',  rps:50,  io:3000, pool:10 },
    { mode:'txout', rps:50,  io:3000, pool:10 },
    { mode:'osiv',  rps:200, io:300,  pool:50 },
  ];

  let step = 0, playing = false, timer = null;

  let playSpeed = 1;             // 재생 배율

  function applyStep(){
    const s = SCENE[step];
    mode = s.mode; rps = s.rps; io = s.io; pool = s.pool;
    $('#sRps').value = rps; $('#sIo').value = io; $('#sPool').value = pool;
    $('#nText').textContent = S.scene[step];
    $('#nStep').textContent =
      `${String(step + 1).padStart(2, '0')} / ${String(SCENE.length).padStart(2, '0')}`;
    $('#btnStep').disabled = step >= SCENE.length - 1;
    $('#btnPrev').disabled = step <= 0;
    render();
  }
  function stepOnce(){
    if (step >= SCENE.length - 1){ stop(); return; }
    step++; applyStep();
    if (step >= SCENE.length - 1) stop();
  }
  function play(){ playing = true; $('#btnPlay').textContent = t('pause'); timer = setInterval(stepOnce, (4200) / playSpeed); }
  function stop(){ playing = false; clearInterval(timer); $('#btnPlay').textContent = t('play'); }

  /* ============================================================================
   * 5. 손잡이
   * ========================================================================== */

  $$('#segMode button').forEach(b => b.onclick = () => { stop(); mode = b.dataset.mode; render(); });
  $('#sRps').oninput  = () => { stop(); rps  = +$('#sRps').value;  render(); };
  $('#sIo').oninput   = () => { stop(); io   = +$('#sIo').value;   render(); };
  $('#sPool').oninput = () => { stop(); pool = +$('#sPool').value; render(); };

  $('#btnPlay').onclick  = () => playing ? stop() : play();
  $('#btnStep').onclick  = () => { stop(); stepOnce(); };
  $('#btnPrev').onclick  = () => { stop(); if (step > 0){ step--; applyStep(); } };
  $('#btnPrev').disabled = true;      // 첫 단계에서 시작한다
  [...document.querySelectorAll('#segSpeed button')].forEach(b => b.onclick = () => {
    playSpeed = +b.dataset.speed;
    [...document.querySelectorAll('#segSpeed button')]
      .forEach(x => x.setAttribute('aria-pressed', x === b));
    if (playing){ stop(); play(); }   // 돌고 있으면 새 간격으로 다시 건다
  });
  $('#btnReset').onclick = () => { stop(); step = 0; applyStep(); };

  /* ============================================================================
   * 6. 기동
   * ========================================================================== */

  $('#nText').textContent = S.scene[0];
  $('#nStep').textContent = `01 / ${String(SCENE.length).padStart(2, '0')}`;
  render();

})();
