/* ============================================================
   G1 vs ZGC 실험대 — 로직 전용.

   본문과 화면 문안은 각 언어의 HTML 에 직접 박혀 있다.
   실행 중에만 만들어지는 문자열(계기 라벨, 힌트, 단계 서술)만
   페이지가 넘겨준다.

     initGcLab({ strings: {...}, scenes: [...] })

   scenes 는 아래 SCENE 과 같은 길이의 서술문 배열이다.
   ============================================================ */
'use strict';

window.initGcLab = function (cfg) {

  const S = cfg.strings;
  const NARR = cfg.scenes;

  const t = (k, ...a) => {
    let s = S[k] ?? k;
    a.forEach((v, i) => s = s.replaceAll('$' + (i + 1), v));
    return s;
  };
  const $ = s => document.querySelector(s);

  /* ============================================================================
   * 1. 모델
   *
   *    G1  — 살아 있는 객체를 STW 중에 복사한다. 옮길 양이 곧 정지 시간이다.
   *          MaxGCPauseMillis 를 맞추려 young 영역을 줄이지만, 하한(힙의 5%)이
   *          있어서 힙이 커지면 결국 정지 시간이 따라 커진다.
   *
   *    ZGC — 색깔 포인터와 load barrier 덕에 이동까지 동시에 한다. STW 는 루트를
   *          훑는 짧은 구간뿐이고, JDK 16 이후 스택 스캔도 동시 수행이라
   *          힙 크기와 사실상 무관하다. 대신 회수 속도를 넘겨 할당하면 멈춘다.
   * ========================================================================== */

  const HEAPS = [2,4,8,16,32,64,96,128];        // GB
  const WINDOW = 60_000;                        // 관측 구간 (ms)

  const P = {
    pauseTarget: 200,      // -XX:MaxGCPauseMillis 기본값
    copyMBperMS: 2.0,      // 복사 처리량
    survive: 0.15,         // young 중 살아남는 비율
    g1Fixed: 2,            // 고정 비용
    g1RootPerGB: 0.35,     // 힙에 비례하는 부분 (RSet, 리전 메타데이터)
    g1MinYoung: 0.05,      // G1NewSizePercent
    g1MaxYoung: 0.60,      // G1MaxNewSizePercent
    mixedEvery: 4,         // mixed 수집 주기 (관측 구간에 반드시 들어오도록)
    mixedFactor: 1.7,
    g1FullThreshold: 0.35, // GC 점유율이 이걸 넘으면 따라가지 못한다
    fullGCperGB: 42,       // Full GC 시간 (ms/GB)

    zPause: 0.28,          // 사이클당 STW 하나 (힙과 무관)
    zPausesPerCycle: 3,    // Mark Start / Mark End / Relocate Start
    zTrigger: 0.30,        // 힙의 이 비율을 소비하면 사이클 시작
    zReclaimMBs: 2000,     // 동시 회수 처리량
  };

  function simulate(heapGB, allocMBs){
    const heapMB = heapGB*1024;
    const ev = { g1:[], z:[] };

    /* --- G1 --- */
    const ideal = P.pauseTarget * P.copyMBperMS / P.survive;
    const young = Math.min(Math.max(ideal, heapMB*P.g1MinYoung), heapMB*P.g1MaxYoung);
    const youngPause = P.g1Fixed + (young*P.survive)/P.copyMBperMS + heapGB*P.g1RootPerGB;
    const interval = young/allocMBs*1000;
    const overhead = youngPause/interval;
    const fullPause = heapGB*P.fullGCperGB;

    let tms = interval, i = 0;
    while (tms < WINDOW){
      const mixed = (i % P.mixedEvery === P.mixedEvery-1);
      ev.g1.push({ t:tms, ms: mixed ? youngPause*P.mixedFactor : youngPause, kind: mixed?'mixed':'young' });
      tms += interval; i++;
    }
    if (overhead > P.g1FullThreshold){
      const n = Math.max(1, Math.floor(overhead/P.g1FullThreshold));
      for (let k=1;k<=n;k++) ev.g1.push({ t: WINDOW*k/(n+1), ms: fullPause, kind:'full' });
      ev.g1.sort((a,b)=>a.t-b.t);
    }

    /* --- ZGC --- */
    // ZGC 는 소비량 기준 외에 주기적으로도 사이클을 돈다(proactive). 상한을 둔다.
    const zInterval = Math.min(20000, Math.max(500, heapMB*P.zTrigger/allocMBs*1000));
    let zt = zInterval;
    while (zt < WINDOW){
      for (let k=0;k<P.zPausesPerCycle;k++)
        ev.z.push({ t: zt + k*(zInterval*0.18), ms: P.zPause, kind:'z' });
      zt += zInterval;
    }
    // 힙이 넓을수록 사이클을 끝낼 시간이 생긴다 → 흡수 가능한 할당량이 는다
    const effReclaim = P.zReclaimMBs * (1 + Math.log2(Math.max(1, heapGB/8)) * 0.18);
    const excess = Math.max(0, allocMBs - effReclaim);
    const stallPerSec = excess > 0 ? (excess/allocMBs)*1000 : 0;

    return { ev, heapGB, allocMBs, young, youngPause, mixedPause: youngPause*P.mixedFactor,
      effReclaim, interval, overhead, stallPerSec,
      g1Full: overhead > P.g1FullThreshold };
  }

  const stats = (list, extraStallMs=0) => {
    if (!list.length) return { max:0, p99:0, n:0, stw:0, thru:100 };
    const s = list.map(e=>e.ms).sort((a,b)=>a-b);
    const stw = s.reduce((a,b)=>a+b,0) + extraStallMs;
    return {
      max: s[s.length-1],
      p99: s[Math.min(s.length-1, Math.floor(s.length*0.99))],
      n: list.length,
      stw,
      thru: Math.max(0, 100 - stw/WINDOW*100),
    };
  };

  /* ============================================================================
   * 2. 그리기
   * ========================================================================== */

  let logScale = false;
  let sim;

  const fmt = ms => ms >= 1000 ? (ms/1000).toFixed(2)+'s' : ms >= 10 ? Math.round(ms)+'ms' : ms.toFixed(2)+'ms';

  function plot(el, events, ceil){
    const H = 96, W = 1000;
    const y = ms => {
      if (!logScale) return Math.max(1, ms/ceil*(H-8));
      const lo = 0.05;
      return Math.max(1, (Math.log10(Math.max(ms,lo))-Math.log10(lo)) / (Math.log10(ceil)-Math.log10(lo)) * (H-8));
    };
    const bars = events.map(e => {
      const h = Math.min(H-6, y(e.ms));
      const x = e.t/WINDOW*W;
      const w = e.kind==='full' ? 6 : e.kind==='z' ? 2.5 : 4;
      const fill = e.kind==='full' ? 'var(--blocked)'
              : e.kind==='mixed' ? 'var(--free)'
                      : e.kind==='z' ? 'var(--horizon)' : 'var(--ink-2)';
      return `<rect x="${x.toFixed(1)}" y="${(H-h).toFixed(1)}" width="${w}" height="${h.toFixed(1)}" fill="${fill}"/>`;
    }).join('');
    el.innerHTML = `<line x1="0" y1="${H-0.5}" x2="${W}" y2="${H-0.5}" stroke="var(--rule)"/>${bars}`;
  }

  function phaseStrip(el, segs){
    const total = segs.reduce((a,s)=>a+s.ms,0);
    el.innerHTML = segs.map(s => {
      const pct = Math.max(0.35, s.ms/total*100);
      const label = pct > 9 ? s.name : '';
      return `<div class="${s.stw?'stw':'conc'}" style="width:${pct}%" title="${s.name} · ${fmt(s.ms)}">${label}</div>`;
    }).join('');
  }

  function render(){
    const heapGB = HEAPS[+$('#sHeap').value];
    const allocMBs = +$('#sAlloc').value;
    sim = simulate(heapGB, allocMBs);

    $('#vHeap').innerHTML = `${heapGB}<small> GB</small>`;
    $('#vAlloc').innerHTML = `${allocMBs}<small> MB/s</small>`;
    $('#hHeap').textContent = heapGB<=8 ? t('hintHeapS') : heapGB<=32 ? t('hintHeapM') : t('hintHeapL');
    const ha = $('#hAlloc');
    if (sim.g1Full){ ha.textContent = t('hintG1Full'); ha.className='hint warn'; }
    else if (sim.stallPerSec>0){ ha.textContent = t('hintAllocL'); ha.className='hint warn'; }
    else { ha.textContent = allocMBs<=400 ? t('hintAllocS') : t('hintAllocM'); ha.className='hint'; }

    const sG1 = stats(sim.ev.g1);
    const sZ  = stats(sim.ev.z, sim.stallPerSec*60);
    const ceil = logScale ? Math.max(sG1.max, 10) : Math.max(sG1.max, 1);

    plot($('#pG1'), sim.ev.g1, ceil);
    plot($('#pZ'),  sim.ev.z,  ceil);
    $('#scaleNote').textContent = logScale ? t('scaleLog') : t('scaleLin');
    $('#btnScale').textContent = logScale ? t('toLinear') : t('toLog');

    const num = (k,v,bad) => `<span class="${bad?'bad':''}">${t(k)} <b>${v}</b></span>`;
    $('#nG1').innerHTML =
            num('nYoung', fmt(sim.youngPause), sim.youngPause > P.pauseTarget*1.1) +
            num('nMixed', fmt(sim.mixedPause)) +
            (sim.g1Full ? num('nFull', fmt(sG1.max), true) : '') +
            num('nCount', sG1.n) +
            num('nStw', fmt(sG1.stw)) +
            num('nThru', sG1.thru.toFixed(1)+'%', sG1.thru<90);
    $('#nZ').innerHTML =
            num('nMax', fmt(sZ.max)) +
            num('nCount', sZ.n) +
            num('nStw', fmt(sim.ev.z.reduce((a,e)=>a+e.ms,0))) +
            (sim.stallPerSec>0 ? num('nStall', Math.round(sim.stallPerSec)+'ms/s', true) : '') +
            num('nThru', sZ.thru.toFixed(1)+'%', sZ.thru<90);

    // 한 사이클의 구성 — 실제 비율대로
    const yp = sim.youngPause;
    phaseStrip($('#stripG1'), [
      { name:'Young Evacuation', ms: yp, stw:true },
      { name:'Concurrent Mark',  ms: yp*6, stw:false },
      { name:'Remark',           ms: yp*0.18, stw:true },
      { name:'Concurrent Cleanup', ms: yp*1.2, stw:false },
      { name:'Mixed Evacuation', ms: yp*P.mixedFactor, stw:true },
    ]);
    const zp = P.zPause;
    phaseStrip($('#stripZ'), [
      { name:'Mark Start',            ms: zp, stw:true },
      { name:'Concurrent Mark',       ms: zp*90, stw:false },
      { name:'Mark End',              ms: zp, stw:true },
      { name:'Concurrent Prepare',    ms: zp*24, stw:false },
      { name:'Relocate Start',        ms: zp, stw:true },
      { name:'Concurrent Relocate',   ms: zp*70, stw:false },
    ]);
  }

  /* ============================================================================
   * 3. 시나리오 — 서술문은 페이지가 넘겨준 NARR 에서 꺼낸다
   * ========================================================================== */

  const SCENE = [
    { heap:1, alloc:500  },
    { heap:3, alloc:500  },
    { heap:5, alloc:500  },
    { heap:7, alloc:500  },
    { heap:3, alloc:2000 },
    { heap:3, alloc:5000 },
    { heap:7, alloc:5000 },
  ];

  let step = 0, playing = false, timer = null;

  function applyStep(){
    const s = SCENE[step];
    $('#sHeap').value = s.heap;
    $('#sAlloc').value = s.alloc;
    $('#nText').textContent = NARR[step];
    $('#nStep').textContent = `${String(step+1).padStart(2,'0')} / ${String(SCENE.length).padStart(2,'0')}`;
    $('#btnStep').disabled = step >= SCENE.length-1;
    render();
  }
  function stepOnce(){
    if (step >= SCENE.length-1){ stop(); return; }
    step++; applyStep();
    if (step >= SCENE.length-1) stop();
  }
  function play(){ playing=true; $('#btnPlay').textContent=t('pause'); timer=setInterval(stepOnce, 3400); }
  function stop(){ playing=false; clearInterval(timer); $('#btnPlay').textContent=t('play'); }

  $('#btnPlay').onclick  = () => playing?stop():play();
  $('#btnStep').onclick  = () => { stop(); stepOnce(); };
  $('#btnReset').onclick = () => { stop(); step=0; applyStep(); };
  $('#btnScale').onclick = () => { logScale=!logScale; render(); };
  $('#sHeap').oninput    = () => { stop(); render(); };
  $('#sAlloc').oninput   = () => { stop(); render(); };

  /* ============================================================================
   * 4. 기동
   * ========================================================================== */

  render();
  $('#nStep').textContent = `01 / ${String(SCENE.length).padStart(2,'0')}`;
};
