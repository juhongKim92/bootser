/* ============================================================
   31. R + W > N 을 지켰는데 왜 위험한가 — 정족수의 산수
   ------------------------------------------------------------
   기호 셋. 알파벳만 두면 안 읽히므로 화면에도 뜻을 그대로 적는다.

     N — 복제본 수 (replication factor). 한 조각을 몇 대에 두나
     W — 쓰기가 **기다리는 응답 수**. "몇 대에 쓰나" 가 아니다.
         Cassandra 문서 — *"Write operations are always sent to all replicas,
         regardless of consistency level. The consistency level simply controls
         how many responses the coordinator waits for."*
     R — 읽기가 **모으는 응답 수**

   문서가 주는 두 조각으로 검산한다.
     · QUORUM = floor(N/2) + 1                       (*"A majority (n/2 + 1)"*)
     · W + R > N 이면 겹침이 보장된다                  (*"guaranteed to participate in both"*)

   그 위에 문서가 말하지 않는 칸을 조합론으로 채운다 —
   읽기 집합이 쓰기 집합을 완전히 비껴갈 확률이 C(N−W, R) / C(N, R) 이므로
   겹칠 확률은 그 여집합이다. 조합론이라 난수가 없고 전수 검증된다.
   ============================================================ */
(function () {
  const S = window.LAB_I18N;
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];

  /* --- 손잡이 --- */
  let N = 3, W = 2, R = 2, dead = 0;
  let idx = 0;

  /* --- 모델 --------------------------------------------------------- */
  const comb = (n, k) => {
    if (k < 0 || k > n) return 0;
    let r = 1;
    for (let i = 0; i < k; i++) r = r * (n - i) / (i + 1);
    return Math.round(r);
  };
  const quorumOf = n => Math.floor(n / 2) + 1;
  /* 읽기 R 개가 쓰기 W 개를 하나도 안 건드릴 확률 */
  const missProb = (n, r, w) => comb(n - w, r) / comb(n, r);
  const overlapProb = (n, r, w) => 1 - missProb(n, r, w);

  function model(o) {
    const guaranteed = o.R + o.W > o.N;
    const p = overlapProb(o.N, o.R, o.W);
    const alive = o.N - o.dead;
    return {
      guaranteed, p,
      alive,
      writeOk: o.W <= alive,                      /* 쓰기가 성공하나 */
      readOk: o.R <= alive,
      tolW: o.N - o.W,                            /* 쓰기가 견디는 고장 수 */
      tolR: o.N - o.R,
      tol: Math.min(o.N - o.W, o.N - o.R),        /* 둘 다 되는 고장 수 */
      quorum: quorumOf(o.N),
      /* 겹침을 보장하면서 가장 많이 견디는 조합 */
      bestTol: Math.floor((o.N - 1) / 2)
    };
  }
  const cfg = over => Object.assign({ N, W, R, dead }, over || {});
  const cur = () => model(cfg());

  /* --- 표기 --- */
  const pc = v => (v * 100).toFixed(v * 100 % 1 === 0 ? 0 : 1);
  const fill = (str, ...v) => v.reduce((a, x, i) => a.split('$' + (i + 1)).join(x), str);
  const meter = (k, x, u, cls) =>
    '<div class="m ' + (cls || '') + '"><span class="k">' + k + '</span><span class="n">' + x +
    (u ? '<small>' + u + '</small>' : '') + '</span></div>';

  /* --- 복제본 격자 --------------------------------------------------
     쓰기는 앞에서 W 개, 읽기는 뒤에서 R 개를 잡는다 — 겹침이 최소가 되는 배치라
     "겹치면 반드시 겹친다" 를 눈으로 보여준다. */
  function drawNodes() {
    const o = cfg(), m = cur();
    const wSet = new Set(), rSet = new Set(), dSet = new Set();
    for (let i = 0; i < o.W; i++) wSet.add(i);
    for (let i = 0; i < o.R; i++) rSet.add(o.N - 1 - i);
    for (let i = 0; i < o.dead; i++) dSet.add(o.N - 1 - i);

    const row = (name, cls) => {
      let html = '<div class="row"><span class="rn">' + name + '</span><span class="set">';
      for (let i = 0; i < o.N; i++) {
        let c = '';
        if (cls === 'w') c = wSet.has(i) ? 'w' : '';
        else if (cls === 'r') c = rSet.has(i) ? 'r' : '';
        else if (cls === 'both') c = (wSet.has(i) && rSet.has(i)) ? 'both' : (wSet.has(i) ? 'w' : (rSet.has(i) ? 'r' : ''));
        else if (cls === 'dead') c = dSet.has(i) ? 'dead' : '';
        html += '<span class="nd ' + c + '">' + (i + 1) + '</span>';
      }
      return html + '</span></div>';
    };
    let html = row(fill(S.nW, o.W), 'w') + row(fill(S.nR, o.R), 'r') + row(S.nBoth, 'both');
    if (o.dead > 0) html += row(fill(S.nDead, o.dead), 'dead');
    $('#nodes').innerHTML = html;

    const inter = [...wSet].filter(i => rSet.has(i)).length;
    $('#nodeCap').innerHTML = m.guaranteed
      ? fill(S.ncSafe, o.W, o.R, o.N, '<b>' + inter + '</b>')
      : fill(S.ncRisk, o.W, o.R, o.N, '<span class="no">' + pc(m.p) + '%</span>');
  }

  /* --- 조합표 — 문서가 주는 등급 조합 --- */
  function drawGrid() {
    const o = cfg(), m = cur();
    const levels = [
      { k: S.lOne, v: 1 },
      { k: S.lQuorum, v: m.quorum },
      { k: S.lAll, v: o.N }
    ].filter((x, i, a) => a.findIndex(y => y.v === x.v) === i);
    let html = '<tr><th>' + S.gWR + '</th>' + levels.map(l =>
      '<th>' + l.k + ' (' + l.v + ')</th>').join('') + '</tr>';
    for (const w of levels) {
      html += '<tr><th>' + w.k + ' (' + w.v + ')</th>';
      for (const rr of levels) {
        const g = w.v + rr.v > o.N;
        const on = (w.v === o.W && rr.v === o.R) ? ' on' : '';
        html += '<td class="' + (g ? 'safe' : 'risk') + on + '">' +
          (g ? S.gSafe : pc(overlapProb(o.N, rr.v, w.v)) + '%') + '</td>';
      }
      html += '</tr>';
    }
    $('#grid2').innerHTML = html;
  }

  /* --- 가용성 표 --- */
  function drawTable() {
    const o = cfg(), m = cur();
    const rows = [];
    for (let w = 1; w <= o.N; w++) for (let r = 1; r <= o.N; r++) {
      if (w + r <= o.N) continue;
      rows.push({ w, r, tol: Math.min(o.N - w, o.N - r) });
    }
    rows.sort((a, b) => b.tol - a.tol || a.w - b.w);
    const top = rows.slice(0, 6);
    $('#four').innerHTML =
      '<tr><th>' + S.tPair + '</th><th>' + S.tSum + '</th><th>' + S.tTolW + '</th><th>' +
      S.tTolR + '</th><th>' + S.tTol + '</th></tr>' +
      top.map(x =>
        '<tr class="' + (x.w === o.W && x.r === o.R ? 'on' : '') + '">' +
        '<td>' + fill(S.tPairV, x.w, x.r) + '</td>' +
        '<td>' + (x.w + x.r) + ' &gt; ' + o.N + '</td>' +
        '<td>' + (o.N - x.w) + '</td><td>' + (o.N - x.r) + '</td>' +
        '<td class="' + (x.tol === m.bestTol ? 'good' : (x.tol === 0 ? 'bad' : '')) + '">' +
        x.tol + '</td></tr>').join('');
  }

  function drawMeters() {
    const o = cfg(), m = cur();
    $('#meters').innerHTML =
      meter(S.mSum, o.W + o.R + ' vs ' + o.N, '', m.guaranteed ? 'good' : 'bad') +
      meter(S.mProb, m.guaranteed ? S.mAlways : pc(m.p) + '%', '', m.guaranteed ? 'good' : 'bad') +
      meter(S.mQuorum, m.quorum, '', '') +
      meter(S.mTol, m.tol, S.uNodes, m.tol === 0 ? 'bad' : '') +
      meter(S.mBestTol, m.bestTol, S.uNodes, '') +
      meter(S.mAlive, m.writeOk && m.readOk ? S.mBothOk : (m.writeOk ? S.mReadNo : S.mWriteNo), '',
        m.writeOk && m.readOk ? 'good' : 'bad');

    /* 판정 */
    const v = $('#verdict');
    let msg, cls;
    if (!m.writeOk || !m.readOk) {
      msg = fill(S.vDown, o.dead, m.alive, !m.writeOk ? fill(S.vDownW, o.W) : fill(S.vDownR, o.R), m.tol);
      cls = ' stuck';
    } else if (!m.guaranteed) {
      msg = fill(S.vRisk, o.W, o.R, o.N, pc(m.p), pc(1 - m.p));
      cls = ' stuck';
    } else if (m.tol === 0) {
      msg = fill(S.vZero, o.W, o.R, m.tolW, m.tolR, m.bestTol);
      cls = ' stuck';
    } else {
      msg = fill(S.vSafe, o.W, o.R, o.N, m.tol, m.bestTol);
      cls = ' ok';
    }
    v.className = 'verdict' + cls;
    v.innerHTML = msg;
  }

  function drawHint() {
    const o = cfg(), m = cur();
    const h = $('#hint');
    h.className = 'hint' + (!m.guaranteed || !m.writeOk || !m.readOk ? ' warn' : '');
    h.innerHTML = fill(S.hint, o.N, o.W, o.R, o.W + o.R,
      m.guaranteed ? S.hGuard : fill(S.hProb, pc(m.p)));
  }

  function layout() { drawNodes(); drawGrid(); drawTable(); drawMeters(); drawHint(); }

  /* --- 시나리오 --- */
  const SCENE = [
    { N: 3, W: 2, R: 2, dead: 0 },
    { N: 3, W: 1, R: 1, dead: 0 },
    { N: 3, W: 2, R: 2, dead: 1 },
    { N: 3, W: 2, R: 2, dead: 2 },
    { N: 3, W: 1, R: 1, dead: 2 },
    { N: 3, W: 3, R: 1, dead: 0 },
    { N: 5, W: 3, R: 3, dead: 2 }
  ];

  function applyStep() {
    const c = SCENE[idx];
    N = c.N; W = c.W; R = c.R; dead = c.dead;
    syncDials();
    $('#nStep').textContent = pad(idx + 1) + ' / ' + pad(SCENE.length);
    $('#nText').textContent = S.scene[idx];
    $('#btnStep').disabled = idx >= SCENE.length - 1;
    $('#btnPrev').disabled = idx <= 0;
    layout();
  }
  const pad = x => String(x).padStart(2, '0');

  function syncDials() {
    $('#sN').value = String(N); $('#vN').innerHTML = N + '<small>' + S.uNodes + '</small>';
    $('#sW').value = String(Math.min(W, N)); $('#vW').innerHTML = W + '<small>' + S.uAck + '</small>';
    $('#sR').value = String(Math.min(R, N)); $('#vR').innerHTML = R + '<small>' + S.uAck + '</small>';
    $('#sD').value = String(Math.min(dead, N)); $('#vD').innerHTML = dead + '<small>' + S.uNodes + '</small>';
  }

  /* --- 구동 --- */
  const clamp = () => { W = Math.min(W, N); R = Math.min(R, N); dead = Math.min(dead, N); };
  const bind = (sel, fn) => { $(sel).oninput = e => { fn(+e.target.value); clamp(); syncDials(); layout(); }; };
  bind('#sN', v => N = v);
  bind('#sW', v => W = v);
  bind('#sR', v => R = v);
  bind('#sD', v => dead = v);

  $('#btnStep').onclick = () => { if (idx < SCENE.length - 1) { idx++; applyStep(); } };
  $('#btnPrev').onclick = () => { if (idx > 0) { idx--; applyStep(); } };
  $('#btnReset').onclick = () => { idx = 0; applyStep(); };
  $('#btnPrev').disabled = true;

  applyStep();

  /* 검증용 — 배포되는 코드 그대로 수치를 읽을 수 있게 열어둔다.
     quorumOf 와 "W+R>N 이면 확률 1" 이 이 편의 검산점이다. */
  window.LAB = {
    set(o) {
      for (const [k, v] of Object.entries(o)) {
        if (k === 'N') N = v; else if (k === 'W') W = v;
        else if (k === 'R') R = v; else if (k === 'dead') dead = v;
      }
      syncDials(); layout(); return window.LAB;
    },
    model, cur, comb, quorumOf, overlapProb, missProb,
    scene: SCENE,
    m: over => model(cfg(over)),
    get dials() { return { N, W, R, dead }; }
  };
})();
