/* ============================================================
   13. 계획 캐시 · generic plan 과 파라미터 편향 실험대 — 로직 전용.

   본문과 화면 문안은 각 언어의 HTML 에 직접 박혀 있다.
   실행 중에만 만들어지는 문자열만 페이지가 window.LAB_I18N 으로 넘긴다.

   모델
   ----
   같은 프리페어드 문을 계속 실행한다. 파라미터는 두 종류다.

     흔한 값   선택도 S_HI (60%)  — 비율 q
     드문 값   선택도 S_LO (0.1%) — 나머지

   비용 (ms)
     인덱스 스캔   IDX × s × ROWS      선택도에 비례한다
     시퀀셜 스캔   SEQ                 선택도와 무관하다
     교차점        s* = SEQ / (IDX × ROWS) = 3.75%
     계획 수립     PLAN                커스텀은 실행마다 문다

   핵심은 제네릭 계획의 추정치다. 파라미터를 모르니 옵티마이저는
   **모든 값이 고르게 분포한다**고 가정하고 1/n_distinct 를 쓴다.
   편향된 컬럼에서는 이 추정이 실제 어느 실행과도 맞지 않는다.

     제네릭 계획 = 1/n_distinct 로 고른다
     제네릭 실행 = 그 계획을 실제 선택도로 돌린다   ← 여기서 갈린다

   auto 모드는 PostgreSQL 의 plancache 규칙을 따른다.
     1~5회는 커스텀. 6회째에 제네릭 추정 비용과 지금까지의 커스텀 평균을
     비교해, 제네릭이 싸 보이면 그 뒤로 계속 제네릭을 쓴다.

   그래서 처음 다섯 번을 어떤 파라미터로 실행했는지가 그 뒤 전부를 정한다.
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

  const ROWS = 1e6;
  const IDX  = 0.004;      // 인덱스로 한 행 가져오는 시간 (ms)
  const SEQ  = 150;        // 시퀀셜 스캔 전체 (ms)
  const PLAN = 0.4;        // 계획 수립 (ms)
  const S_HI = 0.60;       // 흔한 값의 선택도
  const S_LO = 0.001;      // 드문 값의 선택도
  const CUSTOM_TRIES = 5;  // 이 횟수까지는 커스텀
  const HIST = 44;
  const TICK_MS = 260;

  const S_STAR = SEQ / (IDX * ROWS);          // 3.75%

  const idxMs = s => IDX * s * ROWS;
  const best  = s => idxMs(s) <= SEQ ? 'index' : 'seq';
  const runMs = (plan, s) => plan === 'index' ? idxMs(s) : SEQ;

  /* ============================================================================
   * 1. 상태
   * ========================================================================== */

  let q    = 0.25;         // 흔한 값 비율
  let nd   = 200;          // n_distinct
  let mode = 'auto';       // auto | custom | generic

  let runs, hist, customCosts, locked, lockedAt, sumC, sumG, hiWorst, loBest;

  function reset(){
    runs = 0; hist = []; customCosts = [];
    locked = false; lockedAt = 0;
    sumC = 0; sumG = 0; hiWorst = 0; loBest = 0;
  }
  reset();

  const genericSel  = () => 1 / nd;                       // 균등 가정
  const genericPlan = () => best(genericSel());
  const genericEst  = () => runMs(genericPlan(), genericSel());

  /* ============================================================================
   * 2. 실행 한 번
   * ========================================================================== */

  function execute(){
    runs++;
    const hi = Math.random() < q;
    const s  = hi ? S_HI : S_LO;

    let plan, ms, kind;
    if (mode === 'generic' || (mode === 'auto' && locked)){
      plan = genericPlan();
      ms   = runMs(plan, s);                 // 계획은 추정으로 골랐고 실행은 실제로 한다
      kind = 'generic';
    } else {
      plan = best(s);                        // 값을 알고 고른다
      ms   = runMs(plan, s) + PLAN;          // 대신 매번 계획을 세운다
      kind = 'custom';
      if (mode === 'auto' && customCosts.length < CUSTOM_TRIES) customCosts.push(ms);
    }

    // 6회째 판정 — 제네릭이 싸 보이면 그 뒤로 굳는다
    if (mode === 'auto' && !locked && customCosts.length >= CUSTOM_TRIES){
      const avg = customCosts.reduce((a, b) => a + b, 0) / customCosts.length;
      if (genericEst() <= avg){ locked = true; lockedAt = runs; }
    }

    hist.push({ ms, kind, plan, hi });
    if (hist.length > HIST) hist.shift();
    if (kind === 'generic') sumG += ms; else sumC += ms;
    if (hi) hiWorst = Math.max(hiWorst, ms);
    else    loBest  = Math.max(loBest, ms);
  }

  /* ============================================================================
   * 3. 기대값 — 지금 조건에서 두 계획이 각각 어떻게 되나
   * ========================================================================== */

  function expected(){
    const cHi = runMs(best(S_HI), S_HI) + PLAN, cLo = runMs(best(S_LO), S_LO) + PLAN;
    const gp  = genericPlan();
    const gHi = runMs(gp, S_HI),               gLo = runMs(gp, S_LO);
    return {
      custom : { avg: q * cHi + (1 - q) * cLo, hi: cHi, lo: cLo },
      generic: { avg: q * gHi + (1 - q) * gLo, hi: gHi, lo: gLo, plan: gp, est: genericEst() },
    };
  }

  /* ============================================================================
   * 4. 그리기
   * ========================================================================== */

  const ms1 = n => n >= 1000 ? (n / 1000).toFixed(2) + 's' : n >= 10 ? Math.round(n) + 'ms' : n.toFixed(1) + 'ms';
  const f1  = n => n.toFixed(1);

  function render(){
    $$('#segMode button').forEach(b => b.setAttribute('aria-pressed', b.dataset.mode === mode));
    $('#vQ').innerHTML  = `${Math.round(q * 100)}<small> %</small>`;
    $('#vNd').innerHTML = `${nd}<small> ${t('uKinds')}</small>`;

    const e = expected();

    /* 히스토그램 — 최악을 천장으로 잡고 로그로 눌러 그린다 */
    const top = Math.max(...hist.map(h => h.ms), SEQ, 1);
    $('#hist').innerHTML = hist.map(h => {
      const pct = Math.max(2, Math.log10(1 + h.ms) / Math.log10(1 + top) * 100);
      const cls = h.kind === 'generic' ? (h.hi ? 'generic' : '') : (h.plan === 'seq' ? 'seq' : '');
      return `<i class="${cls}" style="height:${pct.toFixed(1)}%" title="${ms1(h.ms)}"></i>`;
    }).join('');
    $('#histx').innerHTML =
      `<span>${t('xOld')}</span><span>${t('xTop', ms1(top))}</span><span>${t('xNow')}</span>`;

    /* 지금 쓰는 계획 */
    const usingGeneric = mode === 'generic' || (mode === 'auto' && locked);
    const p = $('#plan');
    p.className = 'plan ' + (usingGeneric ? 'generic' : 'custom');
    p.innerHTML =
      `<span>${t('pNow')}</span><b>${t(usingGeneric ? 'pGeneric' : 'pCustom')}</b>` +
      `<span>${t('pScan', t('sc_' + (usingGeneric ? genericPlan() : 'perValue')))}</span>` +
      `<span class="est">${usingGeneric
        ? t('pEst', (genericSel() * 100).toFixed(2), ms1(genericEst()))
        : t('pPerRun', ms1(PLAN))}</span>`;

    /* 전환 판정 */
    const avgC = customCosts.length ? customCosts.reduce((a, b) => a + b, 0) / customCosts.length : 0;
    $('#verdict').innerHTML =
      mode !== 'auto' ? t('vForced', t('m_' + mode))
      : locked        ? t('vLocked', lockedAt, ms1(genericEst()), ms1(avgC))
      : customCosts.length >= CUSTOM_TRIES
                      ? t('vKept', ms1(genericEst()), ms1(avgC))
                      : t('vWarm', customCosts.length, CUSTOM_TRIES);

    /* 계기 */
    const cell = (k, n, ex, cls) =>
      `<div class="${cls || ''}"><span class="k">${k}</span><span class="n">${n}</span>` +
      `<span class="e">${ex || '&nbsp;'}</span></div>`;
    const nowAvg = usingGeneric ? e.generic.avg : e.custom.avg;
    const ratio  = e.generic.avg / e.custom.avg;
    $('#meters').innerHTML =
      cell(t('mRuns'), runs, t('mLocked', locked ? lockedAt : '—')) +
      cell(t('mAvg'), ms1(nowAvg), t('mExp'), usingGeneric && ratio > 1.1 ? 'bad' : 'good') +
      cell(t('mWorst'), ms1(usingGeneric ? e.generic.hi : e.custom.hi), t('mHi'),
           usingGeneric && e.generic.hi > e.custom.hi ? 'bad' : '') +
      cell(t('mCommon'), ms1(usingGeneric ? e.generic.lo : e.custom.lo), t('mLo'),
           usingGeneric && e.generic.lo > e.custom.lo ? 'bad' : 'good');

    /* 비교표 */
    const row = (name, o, on) =>
      `<tr class="${on ? 'on' : ''}"><td>${name}</td>` +
      `<td class="num">${ms1(o.avg)}</td><td class="num ${o.lo > 10 ? 'bad' : 'good'}">${ms1(o.lo)}</td>` +
      `<td class="num ${o.hi > SEQ * 1.5 ? 'bad' : ''}">${ms1(o.hi)}</td></tr>`;
    $('#cmp').innerHTML =
      `<tr><th>${t('cPlan')}</th><th>${t('cAvg')}</th><th>${t('cLo')}</th><th>${t('cHi')}</th></tr>` +
      row(t('m_custom'), e.custom, !usingGeneric) +
      row(t('m_generic') + ' · ' + t('sc_' + e.generic.plan), e.generic, usingGeneric);

    /* 힌트 */
    const h = $('#hint');
    if (q === 0){ h.textContent = t('hUniform', ms1(e.generic.avg), ms1(e.custom.avg)); h.className = 'hint good'; }
    else if (usingGeneric && ratio > 1.5){ h.textContent = t('hBad', f1(ratio)); h.className = 'hint warn'; }
    else if (mode === 'auto' && !locked && customCosts.length >= CUSTOM_TRIES){ h.textContent = t('hKept'); h.className = 'hint good'; }
    else if (genericPlan() === 'seq'){ h.textContent = t('hSeq', (genericSel() * 100).toFixed(1), (S_STAR * 100).toFixed(2)); h.className = 'hint'; }
    else { h.textContent = t('hRun'); h.className = 'hint'; }
  }

  /* ============================================================================
   * 5. 시계
   * ========================================================================== */

  let running = false, timer = null;
  let playSpeed = 1;             // 재생 배율

  function onTick(){ execute(); render(); }
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
    { q:0,    nd:200, mode:'auto'    },
    { q:0.25, nd:200, mode:'auto'    },
    { q:0.25, nd:200, mode:'custom'  },
    { q:0.25, nd:200, mode:'generic' },
    { q:0.25, nd:20,  mode:'auto'    },
    { q:0.05, nd:200, mode:'auto'    },
  ];
  let idx = 0;

  function applyStep(){
    const s = SCENE[idx];
    q = s.q; nd = s.nd; mode = s.mode;
    $('#sQ').value = Math.round(q * 100); $('#sNd').value = nd;
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

  $('#sQ').oninput  = () => { q  = +$('#sQ').value / 100; changed(); };
  $('#sNd').oninput = () => { nd = +$('#sNd').value;      changed(); };
  $$('#segMode button').forEach(b => b.onclick = () => { mode = b.dataset.mode; changed(); });

  $('#btnRun').onclick   = () => running ? pause() : start();
  $('#btnStep').onclick  = () => { if (idx < SCENE.length - 1){ idx++; applyStep(); } };
  $('#btnPrev').onclick  = () => { if (idx > 0){ idx--; applyStep(); } };
  $('#btnPrev').disabled = true;      // 첫 단계에서 시작한다
  $$('#segSpeed button').forEach(b => b.onclick = () => {
    playSpeed = +b.dataset.speed;
    $$('#segSpeed button').forEach(x => x.setAttribute('aria-pressed', x === b));
    if (running){ pause(); start(); }   // 돌고 있으면 새 간격으로 다시 건다
  });
  $('#btnReset').onclick = () => {
    idx = 0; q = 0; nd = 200; mode = 'auto';
    $('#sQ').value = 0; $('#sNd').value = 200;
    changed();
    $('#nText').textContent = S.scene[0];
    $('#nStep').textContent = `01 / ${String(SCENE.length).padStart(2, '0')}`;
    $('#btnStep').disabled = false; $('#btnPrev').disabled = true;
  };

  /* ============================================================================
   * 8. 기동
   * ========================================================================== */

  $('#nText').textContent = S.scene[0];
  $('#nStep').textContent = `01 / ${String(SCENE.length).padStart(2, '0')}`;
  changed();

  document.addEventListener('visibilitychange', () => { if (document.hidden && running) pause(); });

})();
