/* ============================================================
   20. 컨슈머는 쉬지 않고 도는데 lag 는 줄지 않는다 — 리밸런싱 루프
   ------------------------------------------------------------
   축은 부등식 하나다.

     배치 처리시간 B = max.poll.records × 레코드당 처리시간
     B > max.poll.interval.ms  이면 그 컨슈머는 **매 배치마다 확정적으로** 그룹에서
     빠진다. 부하와 무관하고 확률도 아니다 — 산수가 그렇다.

   쫓겨나면 그 배치는 커밋되지 않는다. auto-commit 은 `poll()` 안에서 일어나는데
   `poll()` 로 돌아가지 못했으니까. 그래서 CPU 는 계속 바쁜데 오프셋이 한 칸도
   안 움직인다.

   하트비트는 이 판정에 관여하지 않는다. `session.timeout.ms` 는 백그라운드 스레드가
   보내는 하트비트로 재는 값이라, 처리가 아무리 길어도 정상으로 나간다. 걸리는 것은
   `max.poll.interval.ms` 하나다.

   전부 해석식이다 — 난수가 없어 화면의 모든 수치가 정확히 재현된다.
   모델링하지 않은 것은 본문에 밝혀뒀다 (KIP-848 · 파티션 편중 · 슬로 스타트 성격의 워밍업).
   ============================================================ */
(function () {
  const S = window.LAB_I18N;
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];

  /* 슬라이더 눈금 → 실제값 */
  const RECS = [1, 10, 50, 100, 250, 500, 1000, 2000];
  const IVAL = [5000, 10000, 30000, 60000, 120000, 300000, 600000, 1800000, 3600000];
  const CMIT = [0, 1, 10, 50, 100];                  // 0 = 배치 끝에만

  let ki = 5, ii = 5, mi = 0;                        // 500건 · 300초 · 배치 끝에만
  let t = 700, N = 3, D = 5000, churn = 0, coop = false;
  let idx = 0;

  const K = () => RECS[ki];
  const I = () => IVAL[ii];
  const M = () => CMIT[mi];

  /* --- 모델 --- */
  function calc(o) {
    const B = o.k * o.t;
    const evicted = B > o.I;

    if (!evicted) {
      /* 부등식을 지킨다 — 남는 비용은 멤버 변동뿐이다.
         eager 는 변동 한 번에 전원이 멈추고, cooperative 는 움직이는 몫만 멈춘다. */
      const per = 1000 / o.t;                        // 컨슈머 1대의 rec/s
      const lost = Math.min(1, o.coop
        ? o.churn * (o.D / 1000) / (o.N * 60)
        : o.churn * (o.D / 1000) / 60);
      return {
        B, evicted, committed: o.N * per * (1 - lost), wasted: 0, commitRatio: 1,
        rebal: o.churn, busy: 1 - lost, done: o.k, commit: o.k, cycle: B + 0, stall: lost
      };
    }

    /* 부등식을 넘었다 — I 만큼 일하다 쫓겨나고, D 만큼 리밸런싱하고, 반복 */
    const done = Math.floor(o.I / o.t);              // 마감 전까지 처리한 건수
    const commit = o.m > 0 ? Math.floor(done / o.m) * o.m : 0;
    const cycle = o.I + o.D;
    return {
      B, evicted,
      committed: o.N * commit / (cycle / 1000),
      wasted: o.N * (done - commit) / (cycle / 1000),
      commitRatio: done ? commit / done : 0,
      rebal: 60000 / cycle,
      busy: o.I / cycle, done, commit, cycle, stall: o.D / cycle
    };
  }
  const cfg = () => ({ k: K(), t, I: I(), N, D, churn, coop, m: M() });
  const cur = () => calc(cfg());

  /* --- 표시 --- */
  const secs = ms => ms >= 60000 ? (ms / 60000).toFixed(ms % 60000 ? 1 : 0) + S.uMin
    : (ms >= 1000 ? (ms / 1000).toFixed(ms % 1000 ? 1 : 0) + S.uSec : Math.round(ms) + 'ms');
  const pct = x => (x * 100).toFixed(1) + '%';
  const f2 = x => x.toFixed(2);
  const m = (k, n, u, cls) =>
    '<div class="m ' + (cls || '') + '"><span class="k">' + k + '</span><span class="n">' + n +
    (u ? '<small>' + u + '</small>' : '') + '</span></div>';

  function render() {
    const c = cfg(), r = cur();
    const scale = Math.max(r.B, c.I) * 1.02;

    const bar = (cls, nm, v) =>
      '<div class="bar2 ' + cls + '"><span class="nm">' + nm + '</span>' +
      '<span class="tr"><span class="fl" style="width:' + Math.min(100, v / scale * 100) + '%"></span></span>' +
      '<span class="val">' + secs(v) + '</span></div>';

    $('#ineq').innerHTML =
      bar('batch' + (r.evicted ? ' over' : ''), S.bBatch.replace('$1', c.k).replace('$2', c.t), r.B) +
      bar('limit', S.bLimit, c.I);
    const vl = $('#ineqVerdict');
    vl.className = 'verdictline ' + (r.evicted ? 'over' : 'ok');
    vl.textContent = r.evicted
      ? S.iOver.replace('$1', secs(r.B)).replace('$2', secs(c.I)).replace('$3', secs(r.B - c.I))
      : S.iOk.replace('$1', secs(r.B)).replace('$2', secs(c.I)).replace('$3', secs(c.I - r.B));

    /* 한 사이클 — 커밋된 부분 · 낭비된 부분 · 리밸런싱 */
    let seg = '';
    if (r.evicted) {
      const total = r.cycle;
      const doneMs = r.commit * c.t, wasteMs = (r.done - r.commit) * c.t;
      const w = x => (x / total * 100) + '%';
      if (doneMs > 0) seg += '<span class="seg2 done" style="width:' + w(doneMs) + '">' + S.sDone + '</span>';
      seg += '<span class="seg2 waste" style="width:' + w(wasteMs) + '">' + S.sWaste + '</span>';
      seg += '<span class="seg2 rebal" style="width:' + w(c.D) + '">' + S.sRebal + '</span>';
      $('#cycleX').innerHTML = '<span>0</span><span>' + S.xEvict.replace('$1', secs(c.I)) +
        '</span><span>' + secs(total) + '</span>';
    } else {
      seg = '<span class="seg2 done" style="width:' + ((1 - r.stall) * 100) + '%">' + S.sWork + '</span>';
      if (r.stall > 0) seg += '<span class="seg2 rebal" style="width:' + (r.stall * 100) + '%">' + S.sRebal + '</span>';
      $('#cycleX').innerHTML = '<span>' + S.xSteady + '</span><span></span><span>' + S.xMin + '</span>';
    }
    $('#track').innerHTML = seg;

    $('#meters').innerHTML =
      m(S.mTput, f2(r.committed), S.uRps, r.committed <= 0.001 ? 'bad' : 'good') +
      m(S.mWaste, f2(r.wasted), S.uRps, r.wasted > 0.001 ? 'bad' : 'good') +
      m(S.mRatio, pct(r.commitRatio), '', r.commitRatio < 0.5 ? 'bad' : 'good') +
      m(S.mRebal, r.rebal < 10 ? f2(r.rebal) : Math.round(r.rebal), S.uPm, r.rebal > 0.001 ? 'bad' : 'good') +
      m(S.mBusy, pct(r.busy), '', '') +
      m(S.mDetect, secs(c.I), '', c.I > 600000 ? 'bad' : '');

    /* eager vs cooperative — 같은 설정에서 전략만 바꾼다 */
    const a = calc({ ...c, coop: false }), b = calc({ ...c, coop: true });
    const cell = (v, o2, txt) =>
      '<td class="num' + (Math.abs(v - o2) < 1e-9 ? ' same' : (v > o2 ? ' good' : ' bad')) + '">' + txt + '</td>';
    const row = (nm, x, other, on) =>
      '<tr class="' + (on ? 'on' : '') + '"><td>' + nm + '</td>' +
      cell(x.committed, other.committed, f2(x.committed)) +
      '<td class="num">' + pct(x.busy) + '</td></tr>';
    $('#cmp').innerHTML =
      '<tr><th>' + S.cStrat + '</th><th>' + S.cTput + '</th><th>' + S.cBusy + '</th></tr>' +
      row(S.sEager, a, b, !coop) + row(S.sCoop, b, a, coop);

    /* 판정 */
    const v = $('#verdict');
    let msg, cls;
    if (r.evicted && r.commit === 0) {
      msg = S.vZero.replace('$1', String(r.done)).replace('$2', pct(r.busy)).replace('$3', f2(r.wasted));
      cls = ' stuck';
    } else if (r.evicted) {
      msg = S.vPartial.replace('$1', pct(r.commitRatio)).replace('$2', f2(r.committed)).replace('$3', f2(r.rebal));
      cls = ' stuck';
    } else if (r.stall > 0.02) {
      msg = S.vChurn.replace('$1', pct(r.stall)).replace('$2', f2(r.committed))
        .replace('$3', coop ? S.sCoop : S.sEager);
      cls = ' stuck';
    } else {
      msg = S.vOk.replace('$1', secs(r.B)).replace('$2', secs(c.I)).replace('$3', f2(r.committed));
      cls = ' ok';
    }
    v.className = 'verdict' + cls;
    v.innerHTML = msg;

    const h = $('#hint');
    h.className = 'hint' + (r.evicted ? ' warn' : '');
    h.textContent = r.evicted ? S.hOver : (r.stall > 0.02 ? S.hChurn : S.hOk);
  }

  /* --- 시나리오 --- */
  const SCENE = [
    { ki: 5, t: 700, ii: 5, N: 3, D: 5000, churn: 0, coop: false, mi: 0 },
    { ki: 5, t: 700, ii: 5, N: 12, D: 5000, churn: 0, coop: false, mi: 0 },
    { ki: 5, t: 700, ii: 8, N: 3, D: 5000, churn: 0, coop: false, mi: 0 },
    { ki: 3, t: 700, ii: 5, N: 3, D: 5000, churn: 0, coop: false, mi: 0 },
    { ki: 5, t: 700, ii: 5, N: 3, D: 5000, churn: 0, coop: false, mi: 2 },
    { ki: 3, t: 700, ii: 5, N: 3, D: 5000, churn: 6, coop: false, mi: 0 },
    { ki: 3, t: 700, ii: 5, N: 3, D: 5000, churn: 6, coop: true, mi: 0 }
  ];

  function applyStep() {
    const s = SCENE[idx];
    ki = s.ki; t = s.t; ii = s.ii; N = s.N; D = s.D; churn = s.churn; coop = s.coop; mi = s.mi;
    syncDials();
    $('#nStep').textContent = pad(idx + 1) + ' / ' + pad(SCENE.length);
    $('#nText').textContent = S.scene[idx];
    $('#btnStep').disabled = idx >= SCENE.length - 1;
    $('#btnPrev').disabled = idx <= 0;
    render();
  }
  const pad = n => String(n).padStart(2, '0');

  function syncDials() {
    $('#sK').value = String(ki); $('#vK').innerHTML = K() + '<small>' + S.uRec + '</small>';
    $('#sT').value = String(t); $('#vT').innerHTML = t + '<small>ms</small>';
    $('#sI').value = String(ii); $('#vI').innerHTML = secs(I());
    $('#sN').value = String(N); $('#vN').innerHTML = N + '<small>' + S.uUnit + '</small>';
    $('#sD').value = String(D); $('#vD').innerHTML = secs(D);
    $('#sC').value = String(churn); $('#vC').innerHTML = churn + '<small>' + S.uPm + '</small>';
    $('#sM').value = String(mi);
    $('#vM').innerHTML = M() === 0 ? S.mEnd : M() + '<small>' + S.uRec + '</small>';
    $$('#segStrat button').forEach(b => b.setAttribute('aria-pressed', (b.dataset.coop === '1') === coop));
  }

  const bind = (sel, fn) => { $(sel).oninput = e => { fn(+e.target.value); syncDials(); render(); }; };
  bind('#sK', v => ki = v);
  bind('#sT', v => t = v);
  bind('#sI', v => ii = v);
  bind('#sN', v => N = v);
  bind('#sD', v => D = v);
  bind('#sC', v => churn = v);
  bind('#sM', v => mi = v);
  $$('#segStrat button').forEach(b => b.onclick = () => { coop = b.dataset.coop === '1'; syncDials(); render(); });

  $('#btnStep').onclick = () => { if (idx < SCENE.length - 1) { idx++; applyStep(); } };
  $('#btnPrev').onclick = () => { if (idx > 0) { idx--; applyStep(); } };
  $('#btnReset').onclick = () => { idx = 0; applyStep(); };
  $('#btnPrev').disabled = true;

  applyStep();

  /* 검증용 — 배포되는 코드 그대로 수치를 읽을 수 있게 열어둔다 (tools/ 참고) */
  window.LAB = {
    set(o) {
      if (o.recs != null) ki = RECS.indexOf(o.recs);
      if (o.interval != null) ii = IVAL.indexOf(o.interval);
      if (o.commitEvery != null) mi = CMIT.indexOf(o.commitEvery);
      if (o.t != null) t = o.t;
      if (o.N != null) N = o.N;
      if (o.D != null) D = o.D;
      if (o.churn != null) churn = o.churn;
      if (o.coop != null) coop = o.coop;
      if (ki < 0 || ii < 0 || mi < 0) throw new Error('눈금에 없는 값: ' + JSON.stringify(o));
      syncDials(); render(); return window.LAB;
    },
    calc, scene: SCENE, tables: { RECS, IVAL, CMIT },
    exact: () => cur(),
    get cfg() { return { recs: K(), t, interval: I(), N, D, churn, coop, commitEvery: M() }; }
  };
})();
