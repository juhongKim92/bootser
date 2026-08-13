/* ============================================================
   17. 각자 1초씩 줬는데 왜 아무도 1초를 못 쓰나 — 데드라인 전파
   ------------------------------------------------------------
   클라이언트 → A → B → C. 타임아웃은 부르는 쪽이 "보내는 순간" 부터 잰다.
   계층마다 따로 정한 값이 전부 같으면 안쪽 타임아웃은 항상 바깥보다 늦게
   발동한다 — 발동할 기회가 없다. 재시도가 곱해지면 그 시도는 대부분
   클라이언트가 떠난 뒤에 시작된다.

   C 의 응답시간은 두 점이다 — 빠름 65ms, 느림 1200ms. 분포의 몸통과 꼬리를
   두 점으로 줄였다. 그래서 화면의 모든 수치가 난수 없이 정확히 재현된다.
   집계는 표본이 아니라 모든 경로의 확률 가중 열거다 (C 호출은 최대 r²=9 개).
   ============================================================ */
(function () {
  const S = window.LAB_I18N;
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];

  const HOP = 25;         // 한 방향 홉 비용 (네트워크 + 자기 처리)
  const FAST = 65;
  const SLOW = 1200;
  const FLOOR = 20;       // 전파 시 이보다 적게 남았으면 부르지 않는다
  const TICK_MS = 50;
  const STEP = 120;       // 재생 머리가 한 틱에 나아가는 시간

  /* --- 손잡이 --- */
  let tA = 1000, tB = 1000, tC = 1000, r = 3, p = 0.10, mode = 'persist', prop = false;
  let running = true, playSpeed = 1, idx = 0, timer = null, head = 0;

  /* --- 모델 ------------------------------------------------------------
     decide[k] = k 번째 C 호출이 느린가. 부족하면 Need 를 던져 열거 쪽에서 가지를 친다. */
  function Need() {}

  function run(decide) {
    const DL = tA;                                   // 클라이언트가 포기하는 절대 시각
    const aTries = [], cCalls = [];
    let k = 0, cur = HOP, done = null;

    for (let i = 0; i < r; i++) {
      let budget = tB;
      if (prop) {
        budget = Math.min(tB, DL - cur - HOP);       // 응답이 클라이언트까지 갈 홉을 남긴다
        if (budget <= FLOOR) { aTries.push({ send: cur, expire: cur, cs: [], skip: true }); break; }
      }
      const send = cur, expire = send + budget;
      const at = { send, expire, bRecv: send + HOP, cs: [] };
      aTries.push(at);

      let bCur = at.bRecv, res = null;
      for (let j = 0; j < r; j++) {
        let cb = tC;
        if (prop) {
          cb = Math.min(tC, expire - bCur - HOP);
          if (cb <= FLOOR) { at.failFast = bCur; break; }   // 남은 게 없다 — 부르지 않고 실패
        }
        if (k >= decide.length) throw new Need();
        const slow = decide[k]; k++;
        const cSend = bCur, cExpire = cSend + cb, cStart = cSend + HOP;
        const cDone = cStart + (slow ? SLOW : FAST);
        const call = {
          cSend, cExpire, cStart, cDone, cb, slow,
          ok: cDone + HOP <= cExpire,                // 응답이 B 의 타임아웃 안에 도달하나
          owner: expire                              // B 를 부른 A 가 기다려주는 기한
        };
        cCalls.push(call); at.cs.push(call);
        if (call.ok) { res = { ok: true, at: cDone + HOP }; break; }
        bCur = cExpire;                              // B 는 자기 타임아웃까지 기다린 뒤 다음 시도
      }
      if (!res) res = { ok: false, at: at.failFast != null ? at.failFast : bCur };
      at.bAnswer = res.at; at.bOk = res.ok; at.aArrive = res.at + HOP;

      if (res.ok && at.aArrive <= expire) { done = at.aArrive + HOP; break; }
      at.orphan = res.ok && at.aArrive > expire;     // B 는 답을 얻었는데 A 가 이미 떠났다
      cur = Math.min(expire, at.aArrive);
    }

    const clientAt = done != null ? done : cur + HOP;
    return {
      ok: done != null && clientAt <= DL, clientAt, aTries, cCalls,
      afterDL: cCalls.filter(c => c.cStart > DL).length,
      overCommit: cCalls.filter(c => c.cExpire > c.owner).length,
      orphans: aTries.filter(a => a.orphan).length
    };
  }

  /* 모든 경로를 확률 가중으로 열거한다 — 표본이 아니라 정확한 기대값 */
  function exact() {
    const acc = { succ: 0, calls: 0, afterDL: 0, overCommit: 0, orphans: 0, clientAt: 0 };
    const walk = (dec, prob) => {
      if (prob < 1e-12) return;
      let res;
      try { res = run(dec); }
      catch (e) {
        if (!(e instanceof Need)) throw e;
        if (mode === 'persist' && dec.length) { walk([...dec, dec[0]], prob); return; }
        walk([...dec, true], prob * p);
        walk([...dec, false], prob * (1 - p));
        return;
      }
      acc.succ += prob * (res.ok ? 1 : 0);
      acc.calls += prob * res.cCalls.length;
      acc.afterDL += prob * res.afterDL;
      acc.overCommit += prob * res.overCommit;
      acc.orphans += prob * res.orphans;
      acc.clientAt += prob * res.clientAt;
    };
    walk([], 1);
    return acc;
  }

  /* 같은 설정에서 전파만 뒤집어 재본다 — 비교표용 */
  function withProp(v, fn) { const old = prop; prop = v; const out = fn(); prop = old; return out; }

  /* 폭포수에 그릴 결정적 한 건 — "C 가 느린 요청".
     지속적이면 매 시도가 느리고, 일시적이면 첫 시도만 느리다. */
  function trace() {
    return run(mode === 'persist' ? Array(16).fill(true) : [true, ...Array(15).fill(false)]);
  }

  /* --- 그리기 --------------------------------------------------------- */
  let axMax = 1, ev = [];

  const pctOf = t => Math.max(0, Math.min(100, t / axMax * 100));
  const spanOf = (a, b) => Math.max(0.15, pctOf(b) - pctOf(a));
  const fmt = t => t < 2000 ? Math.round(t) + 'ms' : (t / 1000).toFixed(2) + 's';
  const axFmt = t => t < 1 ? '0' : (t / 1000).toFixed(1) + 's';

  const lane = (cls, name, body) =>
    '<div class="lane ' + cls + '"><span class="ln">' + name + '</span>' + body + '</div>';
  const m = (k, n, u, cls) =>
    '<div class="m ' + (cls || '') + '"><span class="k">' + k + '</span><span class="n">' + n +
    (u ? '<small>' + u + '</small>' : '') + '</span></div>';

  /* 폭포수 — 계층별 레인. 클라이언트 기한 오른쪽은 빗금이다 */
  function drawFall(tr) {
    const dlPct = pctOf(tA);
    const chrome = '<div class="gone" style="left:' + dlPct + '%;right:0"></div>' +
      '<div class="dl" style="left:' + dlPct + '%"></div>' +
      '<div class="head" style="left:' + pctOf(head) + '%"></div>';
    const live = tr.aTries.filter(a => !a.skip);

    let html = lane('cl', S.lnClient,
      '<div class="tl">' + chrome +
      '<div class="tick" style="left:' + dlPct + '%">' + S.tkGiveUp.replace('$1', fmt(tA)) + '</div>' +
      '<div class="win' + (tr.ok ? '' : ' dead') + '" style="left:0;width:' + spanOf(0, tA) + '%">' +
      (dlPct > 13 ? S.lbWait : '') + '</div></div>');

    /* A — 시도들이 순차적이라 한 줄에 들어간다 */
    let aBars = chrome;
    live.forEach((a, i) => {
      const w = spanOf(a.send, a.expire);
      aBars += '<div class="win' + (a.bOk && a.aArrive <= a.expire ? '' : ' dead') +
        '" style="left:' + pctOf(a.send) + '%;width:' + w + '%" title="' +
        S.ttA.replace('$1', i + 1).replace('$2', fmt(a.send)).replace('$3', fmt(a.expire)) + '">' +
        (w > 10 ? S.lbTry.replace('$1', i + 1) : '') + '</div>' +
        '<div class="fire" style="left:' + pctOf(a.expire) + '%"></div>';
    });
    html += lane('', S.lnA, '<div class="tl">' + aBars + '</div>');

    /* B·C — A 의 시도마다 한 벌. 시도들이 겹치므로 줄을 나눈다 */
    live.forEach((a, i) => {
      let bBars = chrome, cBars = chrome;
      a.cs.forEach(c => {
        bBars += '<div class="win' + (c.ok ? '' : ' dead') + '" style="left:' + pctOf(c.cSend) +
          '%;width:' + spanOf(c.cSend, c.cExpire) + '%" title="' +
          S.ttC.replace('$1', fmt(c.cSend)).replace('$2', fmt(c.cb)) + '"></div>';
        const oL = Math.max(c.owner, c.cSend);       // 부른 쪽이 기다려줄 수 있는 시간을 넘어선 구간
        if (c.cExpire > oL)
          bBars += '<div class="over" style="left:' + pctOf(oL) + '%;width:' +
            spanOf(oL, c.cExpire) + '%" title="' + S.ttOver + '"></div>';
        bBars += '<div class="fire" style="left:' + pctOf(c.cExpire) + '%"></div>';

        const bey = c.cDone > tA
          ? '<div class="bey" style="width:' + Math.min(100,
              (c.cDone - Math.max(c.cStart, tA)) / (c.cDone - c.cStart) * 100) + '%"></div>' : '';
        cBars += '<div class="work' + (c.slow ? ' slow' : '') + '" style="left:' + pctOf(c.cStart) +
          '%;width:' + spanOf(c.cStart, c.cDone) + '%" title="' +
          S.ttWork.replace('$1', fmt(c.cStart)).replace('$2', c.slow ? SLOW : FAST) + '">' + bey + '</div>';
      });
      if (a.failFast != null)
        bBars += '<div class="tick low" style="left:' + pctOf(a.failFast) + '%">' + S.tkFailFast + '</div>';
      const n = live.length > 1 ? ' ' + (i + 1) : '';
      html += lane(i ? 'sub' : '', S.lnB + n, '<div class="tl">' + bBars + '</div>');
      html += lane(i ? 'sub' : '', S.lnC + n, '<div class="tl">' + cBars + '</div>');
    });

    $('#fall').innerHTML = html;
    $('#fallX').innerHTML = [0, .25, .5, .75, 1].map(f => '<span>' + axFmt(axMax * f) + '</span>').join('');
  }

  /* 실제로 발동한 시각 — 설정값이 아니라 첫 시도가 받은 예산에서 읽는다.
     전파를 켜면 하위가 자기 기본값이 아니라 잔여 예산을 쓰므로 둘이 달라진다. */
  function firesOf(tr) {
    const a0 = tr.aTries.find(a => !a.skip);
    const c0 = a0 && a0.cs[0];
    return {
      aVal: a0 ? a0.expire - a0.send : tB, aAt: a0 ? a0.expire : HOP + tB,
      cVal: c0 ? c0.cb : tC, cAt: c0 ? c0.cExpire : HOP * 2 + tC,
      has: !!c0
    };
  }

  function drawFires(tr) {
    const f = firesOf(tr);
    const rows = [
      { who: S.fwClient, val: tA, at: tA, cfg: tA, base: true },
      { who: S.fwA, val: f.aVal, at: f.aAt, cfg: tB },
      { who: S.fwB, val: f.cVal, at: f.cAt, cfg: tC }
    ];
    $('#fireTbl').innerHTML =
      '<tr><th>' + S.fhWho + '</th><th>' + S.fhVal + '</th><th>' + S.fhAt + '</th><th>' + S.fhVs + '</th></tr>' +
      rows.map(x => {
        const d = x.at - tA;
        return '<tr' + (x.base ? ' class="base"' : '') + '><td>' + x.who + '</td>' +
          '<td>' + Math.round(x.val) + 'ms' + (x.val < x.cfg ? ' <span class="cut">' + S.fvProp + '</span>' : '') +
          '</td><td>' + Math.round(x.at) + 'ms</td>' +
          '<td' + (x.base ? '' : (d >= 0 ? ' class="bad"' : ' class="good"')) + '>' +
          (x.base ? S.fvBase : (d >= 0 ? S.fvLate : S.fvEarly).replace('$1', Math.abs(d))) + '</td></tr>';
      }).join('') +
      '<tr><td>' + S.fwUsable + '</td><td>&mdash;</td><td>' + (tA - HOP * 6) +
      'ms</td><td class="same">' + S.fvUsable + '</td></tr>';
  }

  function drawMeters(tr) {
    const x = exact();
    $('#meters').innerHTML =
      m(S.mSucc, (x.succ * 100).toFixed(1), '%', x.succ > 0.99 ? 'good' : (x.succ < 0.95 ? 'bad' : '')) +
      m(S.mCalls, x.calls.toFixed(2), '', x.calls > 1.05 ? 'bad' : 'good') +
      m(S.mAfter, x.afterDL.toFixed(2), '', x.afterDL > 0.01 ? 'bad' : 'good') +
      m(S.mOver, x.overCommit.toFixed(2), '', x.overCommit > 0.01 ? 'bad' : 'good') +
      m(S.mOrphan, x.orphans.toFixed(3), '', x.orphans > 0.001 ? 'bad' : 'good') +
      m(S.mAnswer, Math.round(x.clientAt), S.uMs, '');

    /* 전파 끔 / 켬 — 같은 설정에서 전파만 뒤집는다 */
    const off = withProp(false, exact), on = withProp(true, exact);
    const cell = (mine, other, txt, lowerBetter) =>
      '<td class="num' + (Math.abs(mine - other) < 1e-9 ? ' same'
        : (lowerBetter ? (mine < other ? ' good' : ' bad') : (mine > other ? ' good' : ' bad'))) + '">' + txt + '</td>';
    const row = (label, o, other, cur) =>
      '<tr class="' + (cur ? 'on' : '') + '"><td>' + label + '</td>' +
      cell(o.succ, other.succ, (o.succ * 100).toFixed(1) + '%', false) +
      cell(o.calls, other.calls, o.calls.toFixed(2), true) +
      cell(o.afterDL, other.afterDL, o.afterDL.toFixed(2), true) +
      cell(o.orphans, other.orphans, o.orphans.toFixed(3), true) +
      cell(o.clientAt, other.clientAt, Math.round(o.clientAt) + 'ms', true) + '</tr>';
    $('#cmp').innerHTML =
      '<tr><th>' + S.cProp + '</th><th>' + S.cSucc + '</th><th>' + S.cCalls + '</th><th>' +
      S.cAfter + '</th><th>' + S.cOrphan + '</th><th>' + S.cAnswer + '</th></tr>' +
      row(S.cOff, off, on, !prop) + row(S.cOn, on, off, prop);

    /* 판정 */
    const v = $('#verdict');
    /* 두 안쪽 계층 중 가장 늦게 발동하는 쪽을 본다 — 하나만 늦어도 순서가 깨진다.
       설정값이 아니라 실제로 받은 예산에서 읽어야 전파를 켠 경우가 맞게 나온다. */
    const fr = firesOf(tr);
    const lateFire = Math.max(fr.aAt, fr.cAt);
    let msg, cls;
    if (lateFire >= tA) {
      msg = S.vInverted.replace('$1', lateFire).replace('$2', tA).replace('$3', lateFire - tA);
      cls = ' stuck';
    } else if (x.afterDL > 0.01) {
      msg = S.vAfter.replace('$1', x.afterDL.toFixed(2)).replace('$2', x.calls.toFixed(2));
      cls = ' stuck';
    } else {
      msg = S.vClean.replace('$1', (x.succ * 100).toFixed(1)).replace('$2', x.calls.toFixed(2))
        .replace('$3', Math.round(x.clientAt));
      cls = ' ok';
    }
    v.className = 'verdict' + cls;
    v.innerHTML = msg;
  }

  /* 폭포수를 사건 목록으로 — 재생 머리가 짚어주는 문장들 */
  function events(tr) {
    const out = [{ t: 0, s: S.evStart.replace('$1', fmt(tA)) }];
    tr.aTries.forEach((a, i) => {
      if (a.skip) { out.push({ t: a.send, s: S.evNoBudget }); return; }
      out.push({ t: a.send, s: S.evASend.replace('$1', i + 1).replace('$2', fmt(tB)).replace('$3', fmt(a.expire)), bad: a.send > tA });
      a.cs.forEach((c, j) => {
        out.push({ t: c.cSend, s: S.evCSend.replace('$1', j + 1).replace('$2', fmt(c.cb)).replace('$3', fmt(c.cExpire)), bad: c.cSend > tA });
        out.push({ t: c.cDone, s: (c.ok ? S.evCDone : S.evCLate).replace('$1', c.slow ? SLOW : FAST), bad: !c.ok });
        if (!c.ok) out.push({ t: c.cExpire, s: S.evCFire.replace('$1', j + 1), bad: true });
      });
      if (a.failFast != null) out.push({ t: a.failFast, s: S.evFailFast });
      if (a.orphan) out.push({ t: a.aArrive, s: S.evOrphan.replace('$1', fmt(a.expire)), bad: true });
      out.push({ t: a.expire, s: S.evAFire.replace('$1', i + 1), bad: a.expire > tA });
    });
    out.push({ t: tA, s: S.evGiveUp, bad: true });
    out.push({ t: tr.clientAt, s: (tr.ok ? S.evWon : S.evLost).replace('$1', fmt(tr.clientAt)), bad: !tr.ok });
    return out.sort((a, b) => a.t - b.t);
  }

  /* 재생 머리만 움직인다 — 미터는 난수가 아니라 정확한 기대값이라 다시 셀 필요가 없다 */
  function moveHead() {
    const left = pctOf(head) + '%';
    $$('#fall .head').forEach(e => e.style.left = left);
    const cur = ev.filter(e => e.t <= head).at(-1);
    const h = $('#hint');
    h.className = 'hint' + (cur && cur.bad ? ' warn' : '');
    h.innerHTML = cur ? fmt(cur.t) + ' &middot; ' + cur.s : '';
  }

  function layout() {
    const tr = trace();
    const last = tr.cCalls.length ? Math.max(...tr.cCalls.map(c => c.cDone)) : tr.clientAt;
    axMax = Math.max(tA * 1.12, last * 1.03, 300);
    ev = events(tr);
    drawFall(tr); drawFires(tr); drawMeters(tr); moveHead();
  }

  /* --- 시나리오 --- */
  const SCENE = [
    { tA: 1000, tB: 1000, tC: 1000, r: 1, p: .10, mode: 'persist', prop: false },
    { tA: 1000, tB: 1000, tC: 1000, r: 3, p: .10, mode: 'persist', prop: false },
    { tA: 3000, tB: 3000, tC: 3000, r: 1, p: .10, mode: 'persist', prop: false },
    { tA: 3000, tB: 3000, tC: 1000, r: 3, p: .10, mode: 'persist', prop: false },
    { tA: 3000, tB: 3000, tC: 1000, r: 3, p: .10, mode: 'transient', prop: false },
    { tA: 1000, tB: 900, tC: 300, r: 3, p: .10, mode: 'persist', prop: false },
    { tA: 1000, tB: 1000, tC: 1000, r: 3, p: .10, mode: 'persist', prop: true }
  ];

  function applyStep() {
    const s = SCENE[idx];
    tA = s.tA; tB = s.tB; tC = s.tC; r = s.r; p = s.p; mode = s.mode; prop = s.prop;
    head = 0; syncDials();
    $('#nStep').textContent = pad(idx + 1) + ' / ' + pad(SCENE.length);
    $('#nText').textContent = S.scene[idx];
    $('#btnStep').disabled = idx >= SCENE.length - 1;
    $('#btnPrev').disabled = idx <= 0;
    layout();
  }
  const pad = n => String(n).padStart(2, '0');

  function syncDials() {
    $('#sA').value = String(tA); $('#vA').innerHTML = sec(tA);
    $('#sB').value = String(tB); $('#vB').innerHTML = sec(tB);
    $('#sC').value = String(tC); $('#vC').innerHTML = sec(tC);
    $('#sR').value = String(r); $('#vR').innerHTML = r + '<small>' + S.uTimes + '</small>';
    $('#sP').value = String(Math.round(p * 100)); $('#vP').innerHTML = Math.round(p * 100) + '<small>%</small>';
    press('#segMode', b => b.dataset.mode === mode);
    press('#segProp', b => (b.dataset.prop === '1') === prop);
  }
  const sec = t => (t / 1000).toFixed(1) + '<small>' + S.uSec + '</small>';
  const press = (sel, fn) => $$(sel + ' button').forEach(b => b.setAttribute('aria-pressed', fn(b) ? 'true' : 'false'));

  /* --- 구동 --- */
  function frame() { head += STEP; if (head > axMax) head = 0; moveHead(); }
  function start() { stop(); timer = setInterval(frame, TICK_MS / playSpeed); }
  function stop() { if (timer) { clearInterval(timer); timer = null; } }

  const bind = (sel, fn) => { $(sel).oninput = e => { fn(+e.target.value); head = 0; syncDials(); layout(); }; };
  bind('#sA', v => tA = v);
  bind('#sB', v => tB = v);
  bind('#sC', v => tC = v);
  bind('#sR', v => r = v);
  bind('#sP', v => p = v / 100);

  $$('#segMode button').forEach(b => b.onclick = () => { mode = b.dataset.mode; head = 0; syncDials(); layout(); });
  $$('#segProp button').forEach(b => b.onclick = () => { prop = b.dataset.prop === '1'; head = 0; syncDials(); layout(); });

  $('#btnRun').onclick = () => {
    running = !running;
    $('#btnRun').textContent = running ? S.pause : S.resume;
    if (running) start(); else stop();
  };
  $('#btnStep').onclick = () => { if (idx < SCENE.length - 1) { idx++; applyStep(); } };
  $('#btnPrev').onclick = () => { if (idx > 0) { idx--; applyStep(); } };
  $('#btnReset').onclick = () => { idx = 0; applyStep(); };
  $('#btnPrev').disabled = true;
  $$('#segSpeed button').forEach(b => b.onclick = () => {
    playSpeed = +b.dataset.speed;
    press('#segSpeed', x => x === b);
    if (running) start();
  });

  applyStep();
  start();

  /* 검증용 — 배포되는 코드 그대로 수치를 읽을 수 있게 열어둔다 */
  window.LAB = {
    set(o) {
      for (const [k, v] of Object.entries(o)) {
        if (k === 'tA') tA = v; else if (k === 'tB') tB = v; else if (k === 'tC') tC = v;
        else if (k === 'r') r = v; else if (k === 'p') p = v;
        else if (k === 'mode') mode = v; else if (k === 'prop') prop = v;
      }
      syncDials(); layout(); return window.LAB;
    },
    exact, trace, scene: SCENE,
    get cfg() { return { tA, tB, tC, r, p, mode, prop }; }
  };
})();
