/* ============================================================
   33. DB 가 깜빡했더니 전 인스턴스가 동시에 빠졌다 — 헬스체크의 비대칭과 fail-open
   ------------------------------------------------------------
   1차 출처: AWS ALB 문서 `target-group-health-checks`.

     기본값 (target type instance/ip)
       HealthCheckIntervalSeconds  30초   (범위 5–300)
       UnhealthyThresholdCount      2     (범위 2–10)
       HealthyThresholdCount        5     (범위 2–10)
       HealthCheckTimeoutSeconds    5초   (범위 2–120)

     규칙  *"If the health checks exceed UnhealthyThresholdCount consecutive failures,
           the load balancer takes the target out of service. When the health checks
           exceed HealthyThresholdCount consecutive successes, the load balancer puts
           the target back in service."*

     간격  *"Each health check request is independent and the result lasts for the
           entire interval. The time that it takes for the target to respond does not
           affect the interval for the next health check request."*
           → 그래서 **감지 시각은 언제나 간격의 정수배**다. 응답 시간이 안 섞인다.

     불연속 *"If a target group contains only unhealthy registered targets, the load
           balancer routes requests to all those targets, regardless of their health
           status. … the load balancer fails open."*

     신규   *"After your target is registered, it must pass one health check to be
           considered healthy."*  → 복귀는 5회인데 **투입은 1회**다.

   ------------------------------------------------------------ 위상을 난수로 안 다룬다

   장애가 검사 사이 어디에서 시작하는지는 모르지만, **양 끝을 둘 다 계산하면** 난수가
   필요 없다. 검사 바로 직전에 시작하면(최선) 첫 실패가 즉시고, 바로 직후에 시작하면
   (최악) 첫 실패가 한 간격 뒤다. 둘의 차이는 정확히 간격 하나다 — 28편이 세그먼트
   홀짝을 두 갈래로 편 것과 같은 방식이다.

   ⚠ 간격을 줄이는 대가를 "DB 부하" 로 쓰지 않는다. N=4 · 30초면 초당 0.3회뿐이라
   그 축은 과장이다. 진짜 대가는 **오탐**이고 그건 타임아웃(5초)과 정지 시간의 문제다.
   ============================================================ */
(function () {
  const S = window.LAB_I18N;
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];

  /* 문서가 정한 범위 안에서만 후보값을 둔다 — 5–300 · 2–10 */
  const INTERVALS = [5, 10, 30, 60, 300];
  const NS = [2, 3, 4, 6, 10];
  const AZ = 2;                      /* 가정 — 본문에 적는다. 문서: 노드마다 검사한다 */

  /* 검사 방식. 'shallow' 는 DB 를 안 보므로 장애 때도 healthy 로 남는다. */
  const MODES = ['shallow', 'half', 'all'];

  /* --- 손잡이 상태 --- */
  let mode = 'all', n = 4, iv = 30, u = 2, h = 5, out = 90;
  let idx = 0;

  /* --- 모델 ---------------------------------------------------------
     시각은 전부 "장애 시작" 기준 초다. */
  function model(o) {
    /* 장애 동안 실패하는 검사 횟수. 최선은 장애 시작과 검사가 겹치는 경우,
       최악은 검사 직후에 시작해 한 간격을 그냥 흘리는 경우다. */
    const failsBest = Math.ceil(o.out / o.iv);
    const failsWorst = Math.max(0, failsBest - 1);

    /* 얕은 검사는 상태가 안 바뀐다 — 요청은 실패해도 라우팅은 그대로다 */
    const affected = o.mode === 'shallow' ? 0
      : o.mode === 'half' ? Math.floor(o.n / 2) : o.n;

    /* 연속 u 회를 못 채우면 이탈이 아예 없다. 얕은 검사도 그렇다 — 상태가 안 바뀐다.
       두 이유를 같은 자리에서 null 로 만든다: "언제 빠지나" 에 답이 없어야 화면과
       검산이 갈라지지 않는다(처음엔 얕은 검사에도 시각이 남아 있었다). */
    const canEvict = affected > 0;
    const evictBest = canEvict && failsBest >= o.u ? (o.u - 1) * o.iv : null;
    const evictWorst = canEvict && failsWorst >= o.u ? o.u * o.iv : null;
    const evicts = evictWorst !== null;

    /* 복귀 — 장애가 끝난 뒤 연속 h 회 성공. 최선은 종료와 검사가 겹치는 경우. */
    const backBest = evicts ? o.out + (o.h - 1) * o.iv : null;
    const backWorst = evicts ? o.out + o.h * o.iv : null;

    const healthy = evicts ? o.n - affected : o.n;
    /* 문서의 불연속 — healthy 가 0 이면 라우팅이 뒤집혀 전부에게 간다 */
    const failOpen = evicts && healthy === 0;
    /* 남은 것이 받는 부하 배수. fail-open 이면 다시 N 으로 나뉘므로 1 이다. */
    const loadX = failOpen ? 1 : (healthy > 0 ? o.n / healthy : 1);

    return {
      failsBest, failsWorst, affected, healthy, evicts, failOpen, loadX,
      evictBest, evictWorst, backBest, backWorst,
      /* 라우팅이 정상이 아닌 기간 */
      badFor: evicts ? backWorst - evictWorst : 0,
      /* 비대칭 — 문턱 둘의 비 */
      skew: o.h / o.u,
      /* 문서가 정한 것: 신규 인스턴스는 1회만 통과하면 된다 */
      newIn: o.iv,
      /* 헬스체크가 대상에 주는 초당 요청 수 (노드마다 검사한다) */
      qps: o.n * AZ / o.iv,
      state: o.mode === 'shallow' ? 'shallow'
        : !evicts ? 'unseen' : failOpen ? 'failopen' : 'partial'
    };
  }

  const cfg = over => Object.assign({ mode, n, iv, u, h, out }, over || {});
  const cur = () => model(cfg());

  /* --- 표기 --- */
  const num = v => String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const sec = v => (Math.round(v * 10) / 10) + S.uSec;
  const x = v => '×' + (Math.round(v * 100) / 100);
  const fill = (str, ...v) => v.reduce((a, y, i) => a.split('$' + (i + 1)).join(y), str);
  const meter = (k, v, cls) =>
    '<div class="m ' + (cls || '') + '"><span class="k">' + k + '</span><span class="n">' + v + '</span></div>';

  /* --- 시간축 — 장애 · 이탈 · 복귀가 겹치는 모양 --------------------
     세로 눈금 하나가 검사 한 번이다. "간격의 정수배" 라는 문서의 성질이 그림에 보인다. */
  function drawTime() {
    const o = cfg(), m = cur();
    const end = Math.max((m.backWorst || o.out) * 1.15, o.out * 1.6, o.iv * 3);
    const pct = t => Math.max(0, Math.min(100, t / end * 100));
    let html = '<div class="axis"></div>';

    /* 검사 눈금 — 최악 위상(검사 직후 장애 시작)을 그린다 */
    for (let t = 0; t <= end; t += o.iv) {
      const bad = t > 0 && t <= o.out;
      html += '<div class="tick' + (bad ? ' fail' : '') + '" style="left:' + pct(t) + '%"></div>';
    }

    html += '<div class="span out" style="left:0;width:' + pct(o.out) + '%"></div>' +
      '<div class="slabel out" style="left:0">' + fill(S.tOut, sec(o.out)) + '</div>';

    if (m.evicts) {
      html += '<div class="mark evict" style="left:' + pct(m.evictWorst) + '%"></div>' +
        '<div class="mlabel evict" style="left:' + pct(m.evictWorst) + '%">' +
        fill(S.tEvict, sec(m.evictWorst)) + '</div>' +
        '<div class="span bad" style="left:' + pct(m.evictWorst) + '%;width:' +
        (pct(m.backWorst) - pct(m.evictWorst)) + '%"></div>' +
        '<div class="mark back" style="left:' + pct(m.backWorst) + '%"></div>' +
        '<div class="mlabel back" style="left:' + pct(m.backWorst) + '%">' +
        fill(S.tBack, sec(m.backWorst)) + '</div>';
    }
    $('#time').innerHTML = html;
    $('#timex').innerHTML = [0, end / 2, end].map(v => '<span>' + sec(v) + '</span>').join('');
  }

  /* --- 인스턴스 줄 — 몇이 빠졌고 남은 것이 얼마를 받나 --- */
  function drawPool() {
    const o = cfg(), m = cur();
    let html = '';
    for (let i = 0; i < o.n; i++) {
      const down = i < m.affected && m.evicts;
      /* fail-open 이면 unhealthy 인데도 트래픽을 받는다 — 문서가 정한 그것 */
      const cls = !down ? 'up' : (m.failOpen ? 'openx' : 'down');
      html += '<div class="inst ' + cls + '"><span></span></div>';
    }
    $('#pool').innerHTML = html;
    $('#poolnote').innerHTML = fill(S.pNote, m.healthy, o.n, x(m.loadX));
  }

  /* --- 네 가지 설정 비교 --- */
  function drawFour() {
    const rows = [
      { k: S.fShallow, o: { mode: 'shallow' } },
      { k: S.fHalf, o: { mode: 'half' } },
      { k: S.fAll, o: { mode: 'all' } },
      { k: S.fTight, o: { mode: 'all', iv: 5 } }
    ];
    $('#four').innerHTML =
      '<tr><th>' + S.fWhat + '</th><th>' + S.fEvict + '</th><th>' + S.fBack + '</th><th>' +
      S.fLoad + '</th><th>' + S.fBad + '</th></tr>' +
      rows.map(r => {
        const m = model(cfg(r.o));
        return '<tr><td>' + r.k + '</td>' +
          '<td class="' + (m.evicts ? 'bad' : 'good') + '">' + (m.evicts ? sec(m.evictWorst) : '—') + '</td>' +
          '<td class="' + (m.evicts ? 'bad' : 'good') + '">' + (m.evicts ? sec(m.backWorst) : '—') + '</td>' +
          '<td class="' + (m.loadX > 1 ? 'bad' : 'good') + '">' + x(m.loadX) + '</td>' +
          '<td class="' + (m.badFor > 0 ? 'bad' : 'good') + '">' + (m.badFor > 0 ? sec(m.badFor) : '—') + '</td></tr>';
      }).join('');
  }

  function drawMeters() {
    const o = cfg(), m = cur();
    $('#meters').innerHTML =
      meter(S.mEvict, m.evicts ? sec(m.evictWorst) : S.mNone, m.evicts ? 'bad' : 'good') +
      meter(S.mBack, m.evicts ? sec(m.backWorst) : S.mNone, m.evicts ? 'bad' : 'good') +
      meter(S.mSkew, x(m.skew), m.skew > 1 ? 'bad' : '') +
      meter(S.mHealthy, m.healthy + ' / ' + o.n, m.healthy === 0 ? 'bad' : (m.healthy < o.n ? 'bad' : 'good')) +
      meter(S.mLoad, x(m.loadX), m.loadX > 1 ? 'bad' : 'good') +
      meter(S.mNewIn, sec(m.newIn), 'good');

    const v = $('#verdict');
    let msg, cls;
    if (m.state === 'shallow') {
      msg = fill(S.vShallow, sec(o.out));
      cls = ' ok';
    } else if (m.state === 'unseen') {
      msg = fill(S.vUnseen, sec(o.out), m.failsWorst, o.u, sec((o.u - 1) * o.iv));
      cls = ' ok';
    } else if (m.state === 'failopen') {
      msg = fill(S.vFailOpen, sec(m.evictWorst), sec(m.backWorst), sec(m.badFor));
      cls = ' stuck';
    } else {
      msg = fill(S.vPartial, m.affected, o.n, m.healthy, x(m.loadX), sec(m.backWorst));
      cls = ' stuck';
    }
    v.className = 'verdict' + cls;
    v.innerHTML = msg;
  }

  function drawHint() {
    const o = cfg(), m = cur();
    const el = $('#hint');
    el.className = 'hint' + (m.state === 'shallow' || m.state === 'unseen' ? '' : ' warn');
    el.innerHTML = fill(S.hint, o.n, sec(o.iv), o.u, o.h, sec(o.u * o.iv), sec(o.h * o.iv));
  }

  function layout() { drawTime(); drawPool(); drawFour(); drawMeters(); drawHint(); }

  /* --- 시나리오 --- */
  const SCENE = [
    { mode: 'all', n: 4, iv: 30, u: 2, h: 5, out: 10 },
    { mode: 'all', n: 4, iv: 30, u: 2, h: 5, out: 90 },
    { mode: 'half', n: 4, iv: 30, u: 2, h: 5, out: 90 },
    { mode: 'shallow', n: 4, iv: 30, u: 2, h: 5, out: 90 },
    { mode: 'all', n: 4, iv: 30, u: 2, h: 2, out: 90 },
    { mode: 'all', n: 4, iv: 5, u: 2, h: 5, out: 90 },
    { mode: 'all', n: 4, iv: 300, u: 2, h: 5, out: 90 }
  ];

  const pad = v => String(v).padStart(2, '0');

  function applyStep() {
    const c = SCENE[idx];
    mode = c.mode; n = c.n; iv = c.iv; u = c.u; h = c.h; out = c.out;
    syncDials();
    $('#nStep').textContent = pad(idx + 1) + ' / ' + pad(SCENE.length);
    $('#nText').textContent = S.scene[idx];
    $('#btnStep').disabled = idx >= SCENE.length - 1;
    $('#btnPrev').disabled = idx <= 0;
    layout();
  }

  function syncDials() {
    const ni = NS.indexOf(n);
    if (ni >= 0) $('#sN').value = String(ni);
    $('#vN').innerHTML = n + '<small>' + S.uInst + '</small>';
    const ii = INTERVALS.indexOf(iv);
    if (ii >= 0) $('#sI').value = String(ii);
    $('#vI').innerHTML = num(iv) + '<small>' + S.uSec + '</small>';
    $('#sU').value = String(u); $('#vU').innerHTML = u + '<small>' + S.uTimes + '</small>';
    $('#sH').value = String(h); $('#vH').innerHTML = h + '<small>' + S.uTimes + '</small>';
    $('#sO').value = String(out); $('#vO').innerHTML = num(out) + '<small>' + S.uSec + '</small>';
    press('#segMode', b => b.dataset.mode === mode);
  }
  const press = (sel, fn) => $$(sel + ' button').forEach(b => b.setAttribute('aria-pressed', fn(b) ? 'true' : 'false'));

  /* --- 구동 --- */
  const bind = (sel, fn) => { $(sel).oninput = e => { fn(+e.target.value); syncDials(); layout(); }; };
  bind('#sN', v => n = NS[v]);
  bind('#sI', v => iv = INTERVALS[v]);
  bind('#sU', v => u = v);
  bind('#sH', v => h = v);
  bind('#sO', v => out = v);

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
        if (k === 'mode') mode = v; else if (k === 'n') n = v; else if (k === 'iv') iv = v;
        else if (k === 'u') u = v; else if (k === 'h') h = v; else if (k === 'out') out = v;
      }
      syncDials(); layout(); return window.LAB;
    },
    model, cur, INTERVALS, NS, MODES, AZ, scene: SCENE,
    at: over => model(cfg(over)),
    get dials() { return { mode, n, iv, u, h, out }; }
  };
})();
