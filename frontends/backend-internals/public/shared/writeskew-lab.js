/* ============================================================
   15. 둘 다 확인했고 둘 다 통과했다 — 격리 수준과 write skew
   ------------------------------------------------------------
   앱 코드는 한 번만 읽는다:
     BEGIN; n = SELECT count(*) FROM oncall WHERE on_duty;      -- t
            if (n >= 2) UPDATE oncall SET on_duty=false WHERE id=me;  -- t+g
     COMMIT;
   각자 자기 행만 건드리므로 행 락이 안 걸리고, 읽기가 한 번뿐이라
   Read Committed 와 Repeatable Read 가 완전히 같은 결과를 낸다.
   ============================================================ */
(function () {
  const S = window.LAB_I18N;
  const $ = s => document.querySelector(s);

  const DT = 0.05;        // 시뮬레이션 스텝 s
  const SUB = 4;          // 화면 한 틱당 스텝 수
  const TICK_MS = 60;
  const OFF = 6;          // 빠진 뒤 복귀까지 s
  const RATE = 0.10;      // 한 사람이 초당 "빠지겠다"고 시도할 확률

  /* --- 손잡이 --- */
  let lvl = 'rc', D = 5, gap = 0.6;
  let running = true, playSpeed = 1, idx = 0, timer = null;

  /* --- 상태 --- */
  let on, backAt, tx, t, seed, commits, aborts, denied, pairs, broke, minSeen, lastCommit;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const cnt = () => on.filter(Boolean).length;

  function reset() {
    on = Array(D).fill(true); backAt = Array(D).fill(0); tx = [];
    t = 0; seed = 7; commits = aborts = denied = pairs = broke = 0;
    minSeen = D; lastCommit = -1;
  }

  function step() {
    for (let i = 0; i < D; i++) {
      if (!on[i] && t >= backAt[i] && !tx.some(x => x.who === i)) on[i] = true;
    }
    for (let i = 0; i < D; i++) {
      if (!on[i] || tx.some(x => x.who === i) || rnd() >= RATE * DT) continue;
      /* SELECT ... FOR UPDATE 는 읽은 행을 잠그므로 앞 트랜잭션이 끝날 때까지 못 읽는다 */
      if (lvl === 'lock' && tx.length > 0) continue;
      if (tx.length > 0) pairs++;
      tx.push({ who: i, at: t, wr: t + gap, snap: cnt() });   // 읽기는 한 번뿐
    }
    const done = tx.filter(x => t >= x.wr);
    tx = tx.filter(x => t < x.wr);
    for (const x of done) {
      if (x.snap < 2) { denied++; continue; }                 // 규칙상 못 빠진다
      /* SSI: 내가 읽은 술어를 내 커밋 전에 누가 바꿨으면 40001 */
      if (lvl === 'ser' && lastCommit > x.at) { aborts++; continue; }
      on[x.who] = false; backAt[x.who] = t + OFF; commits++; lastCommit = t;
      if (cnt() === 0) broke++;
    }
    if (cnt() < minSeen) minSeen = cnt();
    t += DT;
  }

  /* --- 그리기 --- */
  const NAMES = () => S.names.slice(0, D);

  function render() {
    const c = cnt();

    $('#roster').innerHTML = NAMES().map((nm, i) => {
      const mine = tx.find(x => x.who === i);
      const cls = mine ? 'tx' : (on[i] ? 'on' : 'off');
      const st = mine ? S.pTx : (on[i] ? S.pOn : S.pOff.replace('$1', Math.max(0, backAt[i] - t).toFixed(0)));
      const p = mine ? ((t - mine.at) / gap * 100) : 0;
      return '<div class="person ' + cls + '"><span class="nm">' + nm + '</span>' +
        '<span class="st">' + st + '</span>' +
        (mine ? '<div class="prog" style="width:' + Math.min(100, p) + '%"></div>' : '') + '</div>';
    }).join('');

    $('#txs').innerHTML = tx.length ? tx.map(x => {
      const now = cnt(), frozen = lvl === 'rr' || lvl === 'ser';
      /* 쓰기 직전에 다시 세어봤다면 무엇이 보이는가 — RC 는 지금 값, RR/SER 은 스냅샷 */
      const again = frozen ? x.snap : now;
      const diff = again !== x.snap;
      const willBreak = x.snap >= 2 && now <= 1;
      return '<div class="tx"><span class="who">' + NAMES()[x.who] + '</span>' +
        '<span class="rd">' + S.txRead.replace('$1', '<b>' + x.snap + '</b>') + '</span>' +
        '<span class="bar"><i style="width:' + Math.min(100, (t - x.at) / gap * 100) + '%"></i></span>' +
        '<span class="now">' + S.txAgain.replace('$1', '<b class="' + (diff ? 'diff' : '') + '">' + again + '</b>') + '</span>' +
        '<span class="vd ' + (willBreak ? 'bad' : 'ok') + '">' +
        (x.snap >= 2 ? (willBreak ? S.txBreak : S.txWrite) : S.txSkip) + '</span></div>';
    }).join('') : '<div class="empty">' + S.txNone + '</div>';

    const inv = $('#inv');
    inv.className = 'inv' + (c === 0 ? ' broken' : '');
    inv.innerHTML = '<span class="big">' + c + '</span><span>' + S.invOn + '</span>' +
      '<span class="rule">' + (c === 0 ? S.invBroken : S.invRule) + '</span>';

    $('#meters').innerHTML =
      m(S.mCommit, String(commits), '', '') +
      m(S.mAbort, String(aborts), '', aborts > 0 ? 'bad' : '') +
      m(S.mBroke, String(broke), '', broke > 0 ? 'bad' : 'good') +
      m(S.mMin, String(minSeen), S.uPeople, minSeen === 0 ? 'bad' : 'good') +
      m(S.mPairs, String(pairs), '', '');

    const v = $('#verdict');
    const safe = lvl === 'ser' || lvl === 'lock';
    v.className = 'verdict' + (broke > 0 ? ' stuck' : (safe ? ' ok' : ''));
    v.innerHTML = broke > 0
      ? S.vBroke.replace('$1', String(broke)).replace('$2', S['n_' + lvl])
      : (safe ? (lvl === 'ser' ? S.vSer.replace('$1', String(aborts)) : S.vLock)
        : S.vYet.replace('$1', S['n_' + lvl]));

    $('#cmp').innerHTML = '<tr><th>' + S.cLvl + '</th><th>' + S.cSkew + '</th><th>' + S.c40001 + '</th><th>' + S.cCost + '</th></tr>' +
      ['rc', 'rr', 'ser', 'lock'].map(k =>
        '<tr class="' + (k === lvl ? 'on' : '') + '"><td>' + S['n_' + k] + '</td>' +
        '<td class="' + (k === 'rc' || k === 'rr' ? 'bad' : 'good') + '">' + (k === 'rc' || k === 'rr' ? S.cYes : S.cNo) + '</td>' +
        '<td>' + (k === 'ser' ? S.cThrows : S.cNone) + '</td>' +
        '<td>' + S['cost_' + k] + '</td></tr>').join('');

    const h = $('#hint');
    h.className = 'hint' + (broke > 0 ? ' warn' : '');
    h.textContent = pairs === 0 ? S.hNoOverlap
      : (broke > 0 ? S.hBroke : (safe ? S.hSafe : S.hWaiting));
  }
  const m = (k, n, u, cls) =>
    '<div class="m ' + (cls || '') + '"><span class="k">' + k + '</span><span class="n">' + n +
    (u ? '<small>' + u + '</small>' : '') + '</span></div>';

  /* --- 시나리오 --- */
  const SCENE = [
    { lvl: 'rc', D: 5, gap: 0 },
    { lvl: 'rc', D: 5, gap: 0.6 },
    { lvl: 'rr', D: 5, gap: 0.6 },
    { lvl: 'rc', D: 8, gap: 0.6 },
    { lvl: 'ser', D: 5, gap: 0.6 },
    { lvl: 'lock', D: 5, gap: 0.6 }
  ];

  function applyStep() {
    const s = SCENE[idx];
    lvl = s.lvl; D = s.D; gap = s.gap;
    syncDials(); reset();
    $('#nStep').textContent = pad(idx + 1) + ' / ' + pad(SCENE.length);
    $('#nText').textContent = S.scene[idx];
    $('#btnStep').disabled = idx >= SCENE.length - 1;
    $('#btnPrev').disabled = idx <= 0;
    render();
  }
  const pad = n => String(n).padStart(2, '0');

  function syncDials() {
    $('#sD').value = String(D); $('#vD').innerHTML = D + '<small>' + S.uPeople + '</small>';
    $('#sGap').value = String(Math.round(gap * 100)); $('#vGap').innerHTML = gap.toFixed(1) + '<small>' + S.uSec + '</small>';
    [...document.querySelectorAll('#segLvl button')].forEach(b => b.setAttribute('aria-pressed', b.dataset.lvl === lvl));
  }

  /* --- 구동 --- */
  function frame() { for (let i = 0; i < SUB; i++) step(); render(); }
  function start() { stop(); timer = setInterval(frame, TICK_MS / playSpeed); }
  function stop() { if (timer) { clearInterval(timer); timer = null; } }

  $('#sD').oninput = e => { D = +e.target.value; $('#vD').innerHTML = D + '<small>' + S.uPeople + '</small>'; reset(); render(); };
  $('#sGap').oninput = e => { gap = +e.target.value / 100; $('#vGap').innerHTML = gap.toFixed(1) + '<small>' + S.uSec + '</small>'; reset(); render(); };
  [...document.querySelectorAll('#segLvl button')].forEach(b => b.onclick = () => {
    lvl = b.dataset.lvl;
    [...document.querySelectorAll('#segLvl button')].forEach(x => x.setAttribute('aria-pressed', x === b));
    reset(); render();                       // 같은 씨앗에서 다시 돌려야 수준끼리 비교된다
  });
  $('#btnRun').onclick = () => {
    running = !running;
    $('#btnRun').textContent = running ? S.pause : S.resume;
    if (running) start(); else stop();
  };

  $('#btnStep').onclick = () => { if (idx < SCENE.length - 1) { idx++; applyStep(); } };
  $('#btnPrev').onclick = () => { if (idx > 0) { idx--; applyStep(); } };
  $('#btnReset').onclick = () => { idx = 0; applyStep(); };
  $('#btnPrev').disabled = true;              // 첫 단계에서 시작한다
  [...document.querySelectorAll('#segSpeed button')].forEach(b => b.onclick = () => {
    playSpeed = +b.dataset.speed;
    [...document.querySelectorAll('#segSpeed button')].forEach(x => x.setAttribute('aria-pressed', x === b));
    if (running) start();                     // 돌고 있으면 새 간격으로 다시 건다
  });

  reset();
  applyStep();
  start();
})();
