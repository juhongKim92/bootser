/* ============================================================
   25. 멈춰 있던 30초를 부하 테스트가 세지 않았다 — coordinated omission
   ------------------------------------------------------------
   서버는 평소 S 밀리초에 답하고, 정지 구간 [t0, t0+D) 에 도착한 요청은 전부
   t0+D+S 에 답한다. 부하 생성기를 세 가지로 둔다.

     폐루프  워커 C 개가 응답을 받아야 다음을 보낸다 — 정지 중에는 워커당 한 건만
             나가고 나머지 시간은 **요청 자체가 없다.** 그 구간이 표본에 안 들어간다
     개루프  목표 속도대로 계속 보낸다 — 정지 구간에 C·D/S 건을 밀어넣는다
     보정    폐루프로 재고 HdrHistogram 의 recordValueWithExpectedInterval 규칙으로
             누락분을 채운다. 표본 하나가 floor(값/간격) 개의 기록이 된다

   난수가 없다. 요청 도착이 고정 간격이고 서비스 시간이 상수라 모든 지연이
   결정되고, 퍼센타일은 **최근접 순위**(m = ceil(q·n/100) 번째 작은 값)로 고정한다.
   그래서 세 방식의 수치가 닫힌 식으로 나온다 — 표본을 만들어 정렬하지 않는다.
   ============================================================ */
(function () {
  const S_I18N = window.LAB_I18N;
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];

  const SS = [5, 10, 20, 25, 50];          // 서비스 시간 후보 (ms)
  const MODES = ['closed', 'open', 'fixed'];
  const SHOWN = [50, 90, 99, 99.9, 99.99];

  /* --- 손잡이 --- */
  let C = 10, S = 10, T = 300, D = 0, mode = 'closed';
  let idx = 0;

  /* --- 모델 --------------------------------------------------------- */
  function parts(o) {
    const Tms = o.T * 1000, Dms = o.D * 1000;
    const g = o.C * (Tms - Dms) / o.S;             // 정지 밖에서 나온 정상 표본
    const badOpen = o.C * Dms / o.S;               // 개루프가 정지 구간에 밀어넣은 요청
    const stuck = Dms > 0 ? o.C : 0;               // 정지에 묶이는 것은 워커당 하나뿐
    const K = Math.floor((Dms + o.S) / o.S);       // 보정이 한 표본에서 만드는 기록 수
    return {
      g, badOpen, stuck, K, peak: Dms + o.S, rps: o.C / o.S * 1000,
      n: { closed: g + stuck, open: g + badOpen, fixed: g + stuck * K }
    };
  }

  /* 최근접 순위. m ≤ g 면 정상 구간의 값이고, 아니면 방식마다 다른 꼬리다. */
  function q(m, pct, o) {
    const p = parts(o), n = p.n[m];
    const k = Math.ceil(pct / 100 * n);
    if (k <= p.g) return o.S;
    const r = k - p.g;
    if (m === 'open') return o.S + r * o.S / o.C;
    if (m === 'closed') return p.peak;
    return o.S * Math.ceil(r / o.C);               // 보정 — 값 S·m 이 C 벌씩
  }

  /* 정지가 처음 드러나는 퍼센타일 */
  const reveal = (m, o) => { const p = parts(o); return 100 * p.g / p.n[m]; };

  const cfg = (over) => Object.assign({ C, S, T, D }, over || {});

  /* --- 표기 --- */
  const ms = v => v >= 1000 ? (v / 1000).toFixed(2) + S_I18N.uSec : Math.round(v) + S_I18N.uMs;
  const num = v => String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const pctLabel = v => v >= 99 ? v.toFixed(3) : v.toFixed(1);
  const fill = (str, ...v) => v.reduce((a, x, i) => a.split('$' + (i + 1)).join(x), str);
  const meter = (k, n, u, cls) =>
    '<div class="m ' + (cls || '') + '"><span class="k">' + k + '</span><span class="n">' + n +
    (u ? '<small>' + u + '</small>' : '') + '</span></div>';

  /* --- 시간축 -------------------------------------------------------
     정지 구간이 어디이고, 각 방식이 거기에 표본을 남겼는지를 본다. */
  function drawTape() {
    const o = cfg(), p = parts(o);
    const t0 = 30, w = o.D / o.T * 100, l = Math.min(t0, 100 - w);   // 정지는 30% 지점에서 시작
    const band = cls => '<div class="live ' + cls + '" style="left:0;width:' + l + '%"></div>' +
      '<div class="live ' + cls + '" style="left:' + (l + w) + '%;right:0;width:' + (100 - l - w) + '%"></div>';

    const rows = [
      { key: 'closed', name: S_I18N.tClosed, inside: '<div class="void" style="left:' + l + '%;width:' + w + '%"></div>' },
      { key: 'open', name: S_I18N.tOpen, inside: '<div class="live hot" style="left:' + l + '%;width:' + w + '%"></div>' },
      { key: 'fixed', name: S_I18N.tFixed, inside: '<div class="live synth" style="left:' + l + '%;width:' + w + '%"></div>' }
    ];

    let html = '<div class="tape head"><span class="tn"></span><div class="tl">' +
      '<div class="stall" style="left:' + l + '%;width:' + w + '%"></div>' +
      '<div class="lbl" style="left:' + (l + w / 2) + '%">' + fill(S_I18N.tStall, o.D) + '</div></div></div>';

    for (const r of rows) {
      html += '<div class="tape' + (r.key === mode ? ' on' : '') + '"><span class="tn">' + r.name + '</span>' +
        '<div class="tl"><div class="stall" style="left:' + l + '%;width:' + w + '%"></div>' +
        band('') + (o.D > 0 ? r.inside : '') + '</div></div>';
    }
    $('#tape').innerHTML = html;
    $('#tapeX').innerHTML = [0, o.T / 2, o.T].map(v => '<span>' + Math.round(v) + S_I18N.uSecShort + '</span>').join('');
  }

  /* --- 세 개의 p99 막대 --- */
  function drawSpine() {
    const o = cfg();
    const vals = MODES.map(m => ({ m, v: q(m, 99, o) }));
    const max = Math.max(...vals.map(x => x.v), o.S);
    const name = { closed: S_I18N.tClosed, open: S_I18N.tOpen, fixed: S_I18N.tFixed };
    $('#spine').innerHTML = vals.map(x =>
      '<div class="row ' + (x.m === mode ? 'rep' : x.m === 'open' ? 'truth' : '') + '">' +
      '<span class="rn">' + name[x.m] + '</span>' +
      '<span class="bar" style="width:' + Math.max(0.6, x.v / max * 100).toFixed(2) + '%"></span>' +
      '<span class="rv">' + ms(x.v) + '</span></div>').join('');
  }

  /* --- 퍼센타일 표 — 어디서부터 정지가 드러나나 --- */
  function drawTable() {
    const o = cfg();
    const name = { closed: S_I18N.tClosed, open: S_I18N.tOpen, fixed: S_I18N.tFixed };
    let html = '<tr><th>' + S_I18N.hMode + '</th>' +
      SHOWN.map(p => '<th>p' + p + '</th>').join('') +
      '<th>' + S_I18N.hMax + '</th><th>' + S_I18N.hN + '</th></tr>';
    for (const m of MODES) {
      const rv = reveal(m, o);
      html += '<tr class="' + (m === mode ? 'on' : '') + '"><td>' + name[m] +
        (o.D > 0 ? '<span class="flip">' + fill(S_I18N.hFlip, pctLabel(rv)) + '</span>' : '') + '</td>' +
        SHOWN.map(p => {
          const v = q(m, p, o);
          return '<td class="' + (v > o.S ? 'seen' : 'hid') + '">' + ms(v) + '</td>';
        }).join('') +
        '<td class="' + (q(m, 100, o) > o.S ? 'seen' : 'hid') + '">' + ms(q(m, 100, o)) + '</td>' +
        '<td>' + num(parts(o).n[m]) + '</td></tr>';
    }
    $('#pct').innerHTML = html;
  }

  function drawMeters() {
    const o = cfg(), p = parts(o);
    const rep = q(mode, 99, o), truth = q('open', 99, o);
    const missed = p.n.open - p.n[mode];
    $('#meters').innerHTML =
      meter(S_I18N.mRep, ms(rep), '', rep < truth ? 'good' : '') +
      meter(S_I18N.mTruth, ms(truth), '', truth > o.S ? 'bad' : 'good') +
      meter(S_I18N.mGap, '×' + (truth / rep >= 10 ? Math.round(truth / rep) : (truth / rep).toFixed(1)), '',
        truth / rep > 1.5 ? 'bad' : 'good') +
      meter(S_I18N.mFlip, 'p' + pctLabel(reveal(mode, o)), '', '') +
      meter(S_I18N.mN, num(p.n[mode]), '', '') +
      meter(S_I18N.mMissed, (missed > 0 ? '−' + num(missed) : '0'), '', missed > 0 ? 'bad' : 'good');

    /* 판정 */
    const v = $('#verdict');
    let msg, cls;
    if (o.D === 0) {
      msg = fill(S_I18N.vNone, ms(q('closed', 99, o)));
      cls = ' ok';
    } else if (mode === 'closed' && rep < truth) {
      msg = fill(S_I18N.vHidden, ms(rep), ms(truth), Math.round(truth / rep),
        pctLabel(reveal('closed', o)), ms(q('closed', 100, o)));
      cls = ' stuck';
    } else if (mode === 'fixed') {
      msg = fill(S_I18N.vFixed, ms(rep), ms(truth), num(p.n.fixed - p.n.closed));
      cls = ' ok';
    } else {
      msg = fill(S_I18N.vOpen, ms(rep), pctLabel(reveal('open', o)), num(p.badOpen));
      cls = ' ok';
    }
    v.className = 'verdict' + cls;
    v.innerHTML = msg;
  }

  function drawHint() {
    const o = cfg(), p = parts(o);
    const h = $('#hint');
    const rep = q(mode, 99, o), truth = q('open', 99, o);
    h.className = 'hint' + (rep < truth ? ' warn' : '');
    h.innerHTML = fill(S_I18N.hint, num(p.rps), o.C, o.S, o.T, o.D, ms(rep));
  }

  function layout() { drawTape(); drawSpine(); drawTable(); drawMeters(); drawHint(); }

  /* --- 시나리오 --- */
  const SCENE = [
    { C: 10, S: 10, T: 300, D: 0, mode: 'closed' },
    { C: 10, S: 10, T: 300, D: 30, mode: 'closed' },
    { C: 10, S: 10, T: 300, D: 30, mode: 'open' },
    { C: 10, S: 10, T: 300, D: 30, mode: 'fixed' },
    { C: 50, S: 10, T: 300, D: 30, mode: 'closed' },
    { C: 10, S: 10, T: 60, D: 30, mode: 'closed' },
    { C: 10, S: 10, T: 300, D: 3, mode: 'open' }
  ];

  function applyStep() {
    const c = SCENE[idx];
    C = c.C; S = c.S; T = c.T; D = c.D; mode = c.mode;
    syncDials();
    $('#nStep').textContent = pad(idx + 1) + ' / ' + pad(SCENE.length);
    $('#nText').textContent = S_I18N.scene[idx];
    $('#btnStep').disabled = idx >= SCENE.length - 1;
    $('#btnPrev').disabled = idx <= 0;
    layout();
  }
  const pad = n => String(n).padStart(2, '0');

  function syncDials() {
    $('#sC').value = String(C); $('#vC').innerHTML = C + '<small>' + S_I18N.uWorkers + '</small>';
    const si = SS.indexOf(S);
    if (si >= 0) $('#sS').value = String(si);
    $('#vS').innerHTML = S + '<small>' + S_I18N.uMs + '</small>';
    $('#sT').value = String(T); $('#vT').innerHTML = T + '<small>' + S_I18N.uSecShort + '</small>';
    $('#sD').value = String(D); $('#vD').innerHTML = D + '<small>' + S_I18N.uSecShort + '</small>';
    press('#segMode', b => b.dataset.mode === mode);
  }
  const press = (sel, fn) => $$(sel + ' button').forEach(b => b.setAttribute('aria-pressed', fn(b) ? 'true' : 'false'));

  /* --- 구동 --- */
  const bind = (sel, fn) => { $(sel).oninput = e => { fn(+e.target.value); syncDials(); layout(); }; };
  bind('#sC', v => C = v);
  bind('#sS', v => S = SS[v]);
  bind('#sT', v => { T = v; if (D > T - 10) D = T - 10; });
  bind('#sD', v => D = Math.min(v, T - 10));

  $$('#segMode button').forEach(b => b.onclick = () => { mode = b.dataset.mode; syncDials(); layout(); });
  $('#btnStep').onclick = () => { if (idx < SCENE.length - 1) { idx++; applyStep(); } };
  $('#btnPrev').onclick = () => { if (idx > 0) { idx--; applyStep(); } };
  $('#btnReset').onclick = () => { idx = 0; applyStep(); };
  $('#btnPrev').disabled = true;

  applyStep();

  /* 검증용 — 배포되는 코드 그대로 수치를 읽을 수 있게 열어둔다 */
  window.LAB = {
    set(o) {
      for (const [k, v] of Object.entries(o)) {
        if (k === 'C') C = v; else if (k === 'S') S = v; else if (k === 'T') T = v;
        else if (k === 'D') D = v; else if (k === 'mode') mode = v;
      }
      syncDials(); layout(); return window.LAB;
    },
    q, parts, reveal, scene: SCENE, SS, MODES,
    get cfg() { return { C, S, T, D, mode }; }
  };
})();
