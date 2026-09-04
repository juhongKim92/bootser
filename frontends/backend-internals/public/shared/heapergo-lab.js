/* ============================================================
   34. 컨테이너 메모리를 두 배로 줬는데 힙은 그대로다 — JVM 인체공학의 평지
   ------------------------------------------------------------
   1차 출처: OpenJDK 소스와 **JVM 자신의 출력**.

     arguments.cpp · Arguments::set_heap_size()
       if (FLAG_IS_DEFAULT(MaxHeapSize)) {
         julong reasonable_max = phys_mem * MaxRAMPercentage / 100;
         const julong reasonable_min = phys_mem * MinRAMPercentage / 100;
         if (reasonable_min < MaxHeapSize) {
           // Small physical memory, so use a minimum fraction of it for the heap
           reasonable_max = reasonable_min;
         } else {
           // Not-small physical memory, so require a heap at least as large as MaxHeapSize
           reasonable_max = MAX2(reasonable_max, (julong)MaxHeapSize);
         }

     gc_globals.hpp
       MaxRAMPercentage      25.0
       MinRAMPercentage      50.0
       InitialRAMPercentage  1.5625
       MaxHeapSize           ScaleForWordSize(96*M)   ← 평지의 정체

   ------------------------------------------------------------ 식

     힙 = align_up( max(RAM×Max%, min(RAM×Min%, CAP)), 2 MiB )   CAP = 130862280

   가운데 `min` 이 평지를 만든다. CAP 은 `ScaleForWordSize(96*M)` = 124.8 MiB 이고
   **컨테이너와 아무 상관없는 96MB 짜리 기본값**이다. 그래서 249MB~504MB 구간에서는
   메모리를 두 배 줘도 힙이 126MB 에서 안 움직인다.

   ------------------------------------------------------------ 검산

   이 편의 두 번째 점은 표가 아니라 **생성기**다 — `-XX:MaxRAM=N -XX:+PrintFlagsFinal`
   이 임의 입력에 답을 인쇄한다. 그 출력을 `tools/heap-fixture.mjs` 에 62점 굳혀 두고
   `verify-heapergo.mjs` 가 이 모델과 견준다(Temurin 25.0.4.1+1 · Zulu 17 에서 일치 확인).

   ⚠ CAP 과 2 MiB 정렬은 **명세가 아니라 구현**이다. JDK 판이 바뀌면 고정자료를 다시
   떠야 한다 — 페이지에도 그렇게 적는다.
   ============================================================ */
(function () {
  const S = window.LAB_I18N;
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];

  const MB = 1048576;
  const ALIGN = 2 * MB;                  /* 실측한 힙 정렬 — 언제나 올림이다 */
  const CAP = 130862280;                 /* ScaleForWordSize(96*M) = 124.8 MiB */

  /* 컨테이너 크기 후보. 실제로 쓰는 값들과 평지의 두 경계를 다 덮는다. */
  const RAMS = [64, 128, 192, 248, 249, 256, 320, 384, 448, 504, 512, 640, 768,
    1024, 1536, 2048, 3072, 4096, 8192];
  const PCTS = [25, 50, 75];
  /* 상한을 정하는 방식. 'ergo' 가 기본이고 나머지는 -Xmx 를 컨테이너 비율로 준다. */
  const WAYS = ['ergo', 'xmx50', 'xmx75'];

  /* --- 손잡이 상태 --- */
  let ram = 1024, maxP = 25, minP = 50, way = 'ergo', off = 60;
  let idx = 0;

  const alignUp = v => Math.ceil(v / ALIGN) * ALIGN;

  /* --- 모델 -------------------------------------------------------- */
  function heapOf(ramMB, o) {
    const phys = ramMB * MB;
    if (o.way === 'xmx50') return alignUp(phys * 0.5);
    if (o.way === 'xmx75') return alignUp(phys * 0.75);
    /* 인체공학 — 소스의 그 분기 그대로 */
    const reasonableMax = phys * o.maxP / 100;
    const reasonableMin = phys * o.minP / 100;
    return alignUp(reasonableMin < CAP ? reasonableMin : Math.max(reasonableMax, CAP));
  }

  function model(o) {
    const phys = o.ram * MB;
    const heap = heapOf(o.ram, o);
    /* 두 배로 줬을 때 — 이 편의 반전을 미터 하나로 만든다 */
    const twice = heapOf(o.ram * 2, o);
    const init = alignUp(phys * 1.5625 / 100);

    const offHeap = o.off * MB;
    const spare = phys - heap - offHeap;

    /* 평지의 양 끝. **식으로 풀지 않고 훑는다** — 정렬(2 MiB 올림) 때문에 경계가
       `CAP ÷ 비율` 로 안 나온다. 처음 그렇게 풀었더니 250~499MB 가 나왔는데
       실측은 249~504MB 다: 249MB 는 124.5MB 가 126MB 로 올라가서 평지에 들고,
       504MB 는 25%가 정확히 126MB 라 아직 평지다. 훑으면 화면과 실측이 갈리지 않는다. */
    const flat = alignUp(CAP);
    let from = null, to = null;
    if (o.way === 'ergo') {
      for (let v = 1; v <= 65536; v++) {
        if (heapOf(v, o) !== flat) { if (from !== null) break; continue; }
        if (from === null) from = v;
        to = v;
      }
    }

    /* 어느 구간인가. 힙이 평지 높이와 같으면 평지다 — 읽는 사람이 보는 기준과 같다. */
    const regime = o.way !== 'ergo' ? 'xmx'
      : (from !== null && o.ram >= from && o.ram <= to) ? 'plateau'
        : (from !== null && o.ram < from) ? 'floor' : 'ceil';

    return {
      phys, heap, twice, init, regime, offHeap, spare,
      ratio: heap / phys * 100,
      twiceRatio: twice / (phys * 2) * 100,
      /* 두 배 줘서 늘어난 힙. 평지 안에서 두 배를 줘도 평지를 못 벗어나면 0 이다. */
      gain: twice - heap,
      oom: spare < 0,
      cap: CAP, flat,
      plateauFrom: from, plateauTo: to,
      /* 비율을 올리면 평지가 **아예 없어진다**(6단계). 그때 양 끝이 한 점으로
         붙는데, 그걸 "$1MB 를 넘어서 벗어났다" 로 읽어 주면 거짓말이 된다. */
      hasPlateau: from !== null && to !== null && to > from
    };
  }

  const cfg = over => Object.assign({ ram, maxP, minP, way, off }, over || {});
  const cur = () => model(cfg());

  /* --- 표기 --- */
  const num = v => String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const mb = v => (Math.abs(v) >= 100 * MB ? num(v / MB) : (Math.round(v / MB * 10) / 10)) + S.uMB;
  const pct = v => (Math.round(v * 10) / 10) + S.uPct;
  const fill = (str, ...v) => v.reduce((a, x, i) => a.split('$' + (i + 1)).join(x), str);
  const meter = (k, v, cls) =>
    '<div class="m ' + (cls || '') + '"><span class="k">' + k + '</span><span class="n">' + v + '</span></div>';

  /* --- 곡선 — 컨테이너 대비 힙. 세 구간이 눈으로 갈린다 -----------------
     가로가 컨테이너 메모리(로그), 세로가 힙 비율. 평지에서 비율이 흘러내리는 것이
     이 그림의 요점이다 — 힙은 그대로인데 비율만 떨어진다. */
  function drawCurve() {
    const o = cfg(), m = cur();
    const lo = Math.log2(RAMS[0]), hi = Math.log2(RAMS[RAMS.length - 1]);
    const px = v => (Math.log2(v) - lo) / (hi - lo) * 100;
    const py = r => 100 - Math.max(0, Math.min(100, r / 80 * 100));   /* 80% 를 위로 */
    let html = '<div class="cgrid"></div>';

    /* 구간 띠 — 인체공학일 때만 그린다 */
    if (o.way === 'ergo' && m.hasPlateau) {
      const a = Math.max(0, px(m.plateauFrom)), b = Math.min(100, px(m.plateauTo));
      html += '<div class="cband" style="left:' + a + '%;width:' + (b - a) + '%"></div>' +
        '<div class="cbandl" style="left:' + a + '%">' +
        fill(S.cPlateau, num(m.plateauFrom), num(m.plateauTo)) + '</div>';
    }

    /* 점 — 후보값마다 하나. 평지에서는 세로로 흘러내린다. */
    for (const v of RAMS) {
      const mm = model(cfg({ ram: v }));
      html += '<div class="cdot' + (v === o.ram ? ' on' : '') +
        '" style="left:' + px(v) + '%;top:' + py(mm.ratio) + '%"></div>';
    }
    /* 25% · 50% 기준선 */
    for (const r of [o.maxP, o.minP]) {
      html += '<div class="cline" style="top:' + py(r) + '%"></div>' +
        '<div class="clinel" style="top:' + py(r) + '%">' + r + '%</div>';
    }
    $('#curve').innerHTML = html;
    $('#curvex').innerHTML = [RAMS[0], 512, RAMS[RAMS.length - 1]]
      .map(v => '<span>' + num(v) + S.uMB + '</span>').join('');
  }

  /* --- 두 배 비교 — 이 편의 반전 --- */
  function drawTwice() {
    const o = cfg(), m = cur();
    const w = v => (v / (o.ram * 2 * MB) * 100) + '%';
    $('#twice').innerHTML =
      '<div class="bar"><div class="fillh" style="width:' + w(m.heap) + '"></div>' +
      '<div class="lab">' + fill(S.tNow, num(o.ram), mb(m.heap)) + '</div></div>' +
      '<div class="bar"><div class="fillh" style="width:' + w(m.twice) + '"></div>' +
      '<div class="lab">' + fill(S.tTwice, num(o.ram * 2), mb(m.twice)) + '</div></div>' +
      '<div class="gain' + (m.gain === 0 ? ' zero' : '') + '">' +
      (m.gain === 0 ? S.tNoGain : fill(S.tGain, mb(m.gain))) + '</div>';
  }

  /* --- 네 가지 설정 비교 --- */
  function drawFour() {
    const rows = [
      { k: S.fErgo, o: { way: 'ergo', maxP: 25, minP: 50 } },
      { k: S.fMax75, o: { way: 'ergo', maxP: 75, minP: 50 } },
      { k: S.fXmx50, o: { way: 'xmx50' } },
      { k: S.fXmx75, o: { way: 'xmx75' } }
    ];
    $('#four').innerHTML =
      '<tr><th>' + S.fWhat + '</th><th>' + S.fHeap + '</th><th>' + S.fRatio + '</th><th>' +
      S.fTwice + '</th><th>' + S.fSpare + '</th></tr>' +
      rows.map(r => {
        const m = model(cfg(r.o));
        return '<tr><td>' + r.k + '</td>' +
          '<td>' + mb(m.heap) + '</td>' +
          '<td class="' + (m.ratio < 30 ? 'bad' : 'good') + '">' + pct(m.ratio) + '</td>' +
          '<td class="' + (m.gain === 0 ? 'bad' : 'good') + '">' +
          (m.gain === 0 ? S.fSame : '+' + mb(m.gain)) + '</td>' +
          '<td class="' + (m.spare < 0 ? 'bad' : 'good') + '">' + mb(m.spare) + '</td></tr>';
      }).join('');
  }

  function drawMeters() {
    const o = cfg(), m = cur();
    $('#meters').innerHTML =
      meter(S.mHeap, mb(m.heap), '') +
      meter(S.mRatio, pct(m.ratio), m.ratio < 30 ? 'bad' : 'good') +
      meter(S.mTwice, m.gain === 0 ? S.mNoGain : '+' + mb(m.gain), m.gain === 0 ? 'bad' : 'good') +
      meter(S.mInit, mb(m.init), '') +
      meter(S.mOff, mb(m.offHeap), '') +
      meter(S.mSpare, mb(m.spare), m.spare < 0 ? 'bad' : 'good');

    const v = $('#verdict');
    let msg, cls;
    if (m.oom) {
      msg = fill(S.vOom, mb(-m.spare), mb(m.heap), mb(m.offHeap), num(o.ram));
      cls = ' stuck';
    } else if (m.regime === 'xmx') {
      msg = fill(S.vXmx, mb(m.heap), pct(m.ratio));
      cls = ' ok';
    } else if (m.regime === 'plateau') {
      msg = fill(S.vPlateau, mb(m.heap), num(m.plateauFrom), num(m.plateauTo), pct(m.ratio));
      cls = ' stuck';
    } else if (m.regime === 'floor') {
      msg = fill(S.vFloor, o.minP, mb(m.heap), num(m.plateauFrom));
      cls = ' ok';
    } else if (m.hasPlateau) {
      msg = fill(S.vCeil, o.maxP, mb(m.heap), num(m.plateauTo));
      cls = ' ok';
    } else {
      msg = fill(S.vNoFlat, o.maxP, mb(m.heap));
      cls = ' ok';
    }
    v.className = 'verdict' + cls;
    v.innerHTML = msg;
  }

  function drawHint() {
    const o = cfg(), m = cur();
    const el = $('#hint');
    el.className = 'hint' + (m.regime === 'plateau' || m.oom ? ' warn' : '');
    el.innerHTML = fill(S.hint, num(o.ram), o.maxP, o.minP, mb(CAP));
  }

  function layout() { drawCurve(); drawTwice(); drawFour(); drawMeters(); drawHint(); }

  /* --- 시나리오 --- */
  const SCENE = [
    { ram: 128, maxP: 25, minP: 50, way: 'ergo', off: 60 },
    { ram: 249, maxP: 25, minP: 50, way: 'ergo', off: 60 },
    { ram: 504, maxP: 25, minP: 50, way: 'ergo', off: 60 },
    { ram: 512, maxP: 25, minP: 50, way: 'ergo', off: 60 },
    { ram: 1024, maxP: 25, minP: 50, way: 'ergo', off: 60 },
    { ram: 1024, maxP: 75, minP: 50, way: 'ergo', off: 60 },
    { ram: 1024, maxP: 25, minP: 50, way: 'ergo', off: 800 }
  ];

  const pad = v => String(v).padStart(2, '0');

  function applyStep() {
    const c = SCENE[idx];
    ram = c.ram; maxP = c.maxP; minP = c.minP; way = c.way; off = c.off;
    syncDials();
    $('#nStep').textContent = pad(idx + 1) + ' / ' + pad(SCENE.length);
    $('#nText').textContent = S.scene[idx];
    $('#btnStep').disabled = idx >= SCENE.length - 1;
    $('#btnPrev').disabled = idx <= 0;
    layout();
  }

  function syncDials() {
    const ri = RAMS.indexOf(ram);
    if (ri >= 0) $('#sR').value = String(ri);
    $('#vR').innerHTML = num(ram) + '<small>' + S.uMB + '</small>';
    $('#sO').value = String(off);
    $('#vO').innerHTML = num(off) + '<small>' + S.uMB + '</small>';
    press('#segWay', b => b.dataset.way === way);
    press('#segMax', b => +b.dataset.max === maxP);
    press('#segMin', b => +b.dataset.min === minP);
  }
  const press = (sel, fn) => $$(sel + ' button').forEach(b => b.setAttribute('aria-pressed', fn(b) ? 'true' : 'false'));

  /* --- 구동 --- */
  $('#sR').oninput = e => { ram = RAMS[+e.target.value]; syncDials(); layout(); };
  $('#sO').oninput = e => { off = +e.target.value; syncDials(); layout(); };
  $$('#segWay button').forEach(b => b.onclick = () => { way = b.dataset.way; syncDials(); layout(); });
  $$('#segMax button').forEach(b => b.onclick = () => { maxP = +b.dataset.max; syncDials(); layout(); });
  $$('#segMin button').forEach(b => b.onclick = () => { minP = +b.dataset.min; syncDials(); layout(); });
  $('#btnStep').onclick = () => { if (idx < SCENE.length - 1) { idx++; applyStep(); } };
  $('#btnPrev').onclick = () => { if (idx > 0) { idx--; applyStep(); } };
  $('#btnReset').onclick = () => { idx = 0; applyStep(); };
  $('#btnPrev').disabled = true;

  applyStep();

  /* 검증용 — 배포되는 코드 그대로 수치를 읽을 수 있게 열어둔다.
     verify-heapergo 가 heapOf 를 tools/heap-fixture.mjs 의 62점과 직접 견준다. */
  window.LAB = {
    set(o) {
      for (const [k, v] of Object.entries(o)) {
        if (k === 'ram') ram = v; else if (k === 'maxP') maxP = v;
        else if (k === 'minP') minP = v; else if (k === 'way') way = v;
        else if (k === 'off') off = v;
      }
      syncDials(); layout(); return window.LAB;
    },
    model, cur, heapOf, RAMS, PCTS, WAYS, CAP, ALIGN, MB, scene: SCENE,
    at: over => model(cfg(over)),
    get dials() { return { ram, maxP, minP, way, off }; }
  };
})();
