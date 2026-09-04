/* ============================================================
   32. AsyncAppender 를 붙였더니 로그가 사라진다 — 큐 256 과 두 개의 문턱
   ------------------------------------------------------------
   1차 출처: logback 문서 `appenders-async-sift.html` 의 AsyncAppender 속성표.

     queueSize            *"The maximum capacity of the blocking queue.
                          By default, queueSize is set to 256."*
     discardingThreshold  *"By default, when the blocking queue has 20% capacity
                          remaining, it will drop events of level TRACE, DEBUG and INFO,
                          keeping only events of level WARN and ERROR.
                          **To keep all events, set discardingThreshold to 0.**"*
     neverBlock (기본 false)
                          *"If the queue is filled up, then application threads are
                          blocked from logging new events until the worker thread has
                          had a chance to dispatch one or more events."*

   여기서 문턱이 **둘** 나온다. 하나는 버림이 시작되는 큐 길이(= 용량 − 20%),
   또 하나는 꽉 차서 **애플리케이션 스레드가 막히는** 자리다. 256 과 20% 는 명세값이고,
   그 둘을 합치면 256×0.2 = 51.2 → 51건이 남았을 때부터 INFO 가 사라진다.

   ------------------------------------------------------------ 모델의 범위

   보는 것은 **로그 파이프 하나**다. 애플리케이션이 내려는 비율 λ 와 파이프가
   통과시키는 비율 μ 가 있고, 그 차이(λ − μ)는 셋 중 하나로 처리된다.

     · INFO 를 버린다        discardingThreshold 가 허용하는 만큼
     · 전부 버린다           neverBlock 이 켜져 있고 큐가 꽉 찼을 때 — ERROR 도 사라진다
     · 스레드가 흡수한다     neverBlock 이 꺼져 있고 큐가 꽉 찼을 때 = 막힘

   셋은 배타적이고 **합이 정확히 λ − μ 다.** 그게 이 모델의 뼈대이고
   `verify-logdrop.mjs` 의 불변식 ②다.

   ⚠ μ(소비율)는 명세값이 아니다. 디스크·네트워크 사정이라 손잡이로 두고,
   우리가 정한 입력이라고 페이지에 적는다 — 28편이 지연 ACK 40ms 를 리눅스
   구현값으로 분리한 것과 같은 취급이다. 난수는 쓰지 않는다.
   ============================================================ */
(function () {
  const S = window.LAB_I18N;
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];

  /* 손잡이 후보값. 256 이 명세 기본값이고 20 이 명세의 버림 문턱이다. */
  const QS = [64, 128, 256, 1024, 4096];
  const DISC = [0, 20, 40];              /* % — 0 은 "전부 보관"(문서가 정한 뜻) */
  const WRITE = [1, 5, 20, 100, 500];    /* 한 건 쓰는 시간 μs */
  const ERRP = [1, 5, 20, 50, 100];      /* WARN/ERROR 비율 % */

  /* --- 손잡이 상태 --- */
  let q = 256, disc = 20, never = false, rate = 40, write = 100, errp = 5;
  let idx = 0;

  /* --- 모델 ---------------------------------------------------------
     rate 는 천 건/초 단위다(슬라이더가 정수라야 값이 흔들리지 않는다). */
  function model(o) {
    const lam = o.rate * 1000;                 /* 도착률 events/s */
    const mu = 1e6 / o.write;                  /* 소비율 events/s — 한 건 쓰는 시간의 역수 */
    const lamKept = lam * o.errp / 100;        /* 버림이 걸려도 남는 것 = WARN/ERROR */
    const lamInfo = lam - lamKept;

    /* 명세: "20% capacity remaining" — 남은 용량이 문턱 이하면 버린다.
       남은 용량 = q − len 이므로 버림은 len ≥ q − thr 에서 시작한다.
       thr = 0 이면 그 선이 q 와 같아져서 버림 없이 곧장 꽉 찬다 — 문서의
       "To keep all events, set discardingThreshold to 0" 이 이 식에서 그대로 나온다. */
    const thr = Math.floor(o.q * o.disc / 100);
    const discLine = o.q - thr;

    const out = {
      lam, mu, lamKept, lamInfo, thr, discLine,
      state: 'clean', tDisc: null, tFull: null,
      /* 대기 = 큐를 통과하는 데 걸리는 시간이다. 앞에 선 len 건을 워커가 내보낸 뒤
         자기 차례가 오므로 (len + 1) ÷ μ 다. **+1 을 빼면 빈 큐의 대기가 0 이 되어
         "한 건 쓰는 시간" 이 사라진다** — 처음에 빈 큐만 1/μ 로 따로 두었다가
         verify 의 불변식⑥(리틀)에 잡혔다. 상태마다 뜻이 달랐던 것이다. */
      len: 0, wait: 1000 / mu,
      dropInfo: 0, dropErr: 0, absorbed: 0,
      perCall: 0, cap: mu, excess: Math.max(0, lam - mu)
    };

    /* 파이프가 도착을 다 소화하면 큐가 자라지 않는다 */
    if (lam <= mu) return out;

    /* 1단계 — 빈 큐에서 버림 선까지. 자라는 속도는 λ − μ 다. */
    out.tDisc = discLine / (lam - mu) * 1000;

    /* 2단계 — 버림이 걸린 뒤에도 남는 것(WARN/ERROR)이 파이프보다 많으면 계속 찬다.
       thr 가 0 이면 1단계에서 이미 꽉 찬 것이라 2단계가 없다. */
    const stabilises = thr > 0 && lamKept < mu;

    if (stabilises) {
      /* 큐가 버림 선에 머문다 — 초과분 전부가 INFO 로 빠진다 */
      out.state = 'discarding';
      out.len = discLine;
      out.dropInfo = lam - mu;
    } else {
      out.tFull = out.tDisc + (thr > 0 ? thr / (lamKept - mu) * 1000 : 0);
      out.len = o.q;
      out.state = o.never ? 'dropall' : 'blocking';
      if (thr > 0) {
        /* ⚠ 버림과 막힘은 둘 중 하나가 아니다. 버림 선 위에서는 INFO 가 큐에
           들어가지도 못하므로 **그 호출은 막히지 않고 사라진다.** 큐 자리를 다투는
           것은 WARN/ERROR 뿐이고, 막히는(또는 버려지는) 것도 그쪽이다. */
        out.dropInfo = lamInfo;
        const errExcess = lamKept - mu;        /* 안 안정됐으니 반드시 > 0 이다 */
        if (o.never) out.dropErr = errExcess;
        else { out.absorbed = errExcess; out.perCall = 1000 / mu; }
      } else {
        /* discardingThreshold = 0 — 문서가 말한 "전부 보관" 이다. 등급을 안 가리므로
           초과분이 섞인 채로 막히거나(put) 섞인 채로 버려진다(offer). */
        const ex = lam - mu;
        if (o.never) { out.dropErr = ex * o.errp / 100; out.dropInfo = ex - out.dropErr; }
        else { out.absorbed = ex; out.perCall = 1000 / mu; }
      }
    }
    out.wait = (out.len + 1) / mu * 1000;      /* 리틀의 법칙 — (큐 길이 + 자기) ÷ 소비율 */
    return out;
  }

  const cfg = over => Object.assign({ q, disc, never, rate, write, errp }, over || {});
  const cur = () => model(cfg());

  /* --- 표기 --- */
  const num = v => String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  /* 소수 두 자리를 1초까지 유지한다. 이 편의 시각은 6.83 · 109.23 · 327.70 처럼
     자리가 갈리는 값이라 100 에서 정수로 접으면 본문이 화면과 어긋난다. */
  const ms = v => v >= 1000 ? num(v) + S.uMs : (Math.round(v * 100) / 100) + S.uMs;
  const per = v => num(v) + S.uPerSec;
  const fill = (str, ...v) => v.reduce((a, x, i) => a.split('$' + (i + 1)).join(x), str);
  const meter = (k, n, u, cls) =>
    '<div class="m ' + (cls || '') + '"><span class="k">' + k + '</span><span class="n">' + n +
    (u ? '<small>' + u + '</small>' : '') + '</span></div>';

  /* --- 시간축 — 큐가 두 문턱을 밟아 가는 순서 ------------------------
     가로가 시간이다. 띠 셋은 배타적이라 상태가 하나뿐임이 그림으로 보인다. */
  function drawPhases() {
    const m = cur();
    const end = m.tFull !== null ? m.tFull * 1.35 : (m.tDisc !== null ? m.tDisc * 1.8 : 1);
    const pct = t => Math.max(0, Math.min(100, t / end * 100));
    let html = '';

    if (m.state === 'clean') {
      html = '<div class="band ok" style="left:0;width:100%"></div>' +
        '<div class="blabel ok" style="left:1%">' + S.bClean + '</div>';
    } else {
      const d = pct(m.tDisc);
      html += '<div class="band fillup" style="left:0;width:' + d + '%"></div>' +
        '<div class="blabel" style="left:0">' + S.bFill + '</div>';
      /* thr = 0 이면 버림 선이 꽉 찬 선과 같은 자리다 — 표식을 겹쳐 찍지 않는다 */
      if (m.thr > 0) {
        html += '<div class="mark" style="left:' + d + '%"></div>' +
          '<div class="mlabel" style="left:' + d + '%">' + fill(S.bDiscAt, ms(m.tDisc)) + '</div>';
      }
      if (m.tFull === null) {
        html += '<div class="band drop" style="left:' + d + '%;width:' + (100 - d) + '%"></div>' +
          '<div class="blabel drop" style="left:' + (d + 1) + '%">' + S.bDisc + '</div>';
      } else {
        const f = pct(m.tFull);
        html += '<div class="band drop" style="left:' + d + '%;width:' + (f - d) + '%"></div>' +
          '<div class="mark hard" style="left:' + f + '%"></div>' +
          '<div class="mlabel hard" style="left:' + f + '%">' + fill(S.bFullAt, ms(m.tFull)) + '</div>' +
          '<div class="band ' + (m.state === 'blocking' ? 'block' : 'dropall') + '" style="left:' + f +
          '%;width:' + (100 - f) + '%"></div>' +
          '<div class="blabel ' + (m.state === 'blocking' ? 'block' : 'dropall') + '" style="left:' +
          (f + 1) + '%">' + (m.state === 'blocking' ? S.bBlock : S.bDropAll) + '</div>';
      }
    }
    $('#phases').innerHTML = html;
    $('#phasex').innerHTML = [0, end / 2, end].map(v => '<span>' + ms(v) + '</span>').join('');
  }

  /* --- 큐 게이지 — 정상 상태의 길이와 두 선 --- */
  function drawGauge() {
    const o = cfg(), m = cur();
    const p = v => (v / o.q * 100) + '%';
    $('#gauge').innerHTML =
      '<div class="qbar"><div class="qfill ' + m.state + '" style="width:' + p(m.len) + '"></div>' +
      '<div class="qline" style="left:' + p(m.discLine) + '"></div></div>' +
      '<div class="qtext">' + fill(S.gText, num(m.len), num(o.q), num(m.discLine), num(m.thr)) + '</div>';
  }

  /* --- 네 가지 설정 비교 --- */
  function drawFour() {
    const rows = [
      { k: S.fBase, o: { disc: 20, never: false, q: 256 } },
      { k: S.fKeepAll, o: { disc: 0, never: false, q: 256 } },
      { k: S.fNever, o: { disc: 20, never: true, q: 256 } },
      { k: S.fBigQ, o: { disc: 20, never: false, q: 4096 } }
    ];
    const vals = rows.map(x => ({ k: x.k, m: model(cfg(x.o)) }));
    $('#four').innerHTML =
      '<tr><th>' + S.fWhat + '</th><th>' + S.fLost + '</th><th>' + S.fErrLost + '</th><th>' +
      S.fBlocked + '</th><th>' + S.fWait + '</th></tr>' +
      vals.map(x =>
        '<tr><td>' + x.k + '</td>' +
        '<td class="' + (x.m.dropInfo > 0 ? 'bad' : 'good') + '">' + (x.m.dropInfo > 0 ? per(x.m.dropInfo) : '—') + '</td>' +
        '<td class="' + (x.m.dropErr > 0 ? 'bad' : 'good') + '">' + (x.m.dropErr > 0 ? per(x.m.dropErr) : '—') + '</td>' +
        '<td class="' + (x.m.absorbed > 0 ? 'bad' : 'good') + '">' + (x.m.absorbed > 0 ? per(x.m.absorbed) : '—') + '</td>' +
        '<td>' + ms(x.m.wait) + '</td></tr>').join('');
  }

  function drawMeters() {
    const m = cur();
    $('#meters').innerHTML =
      meter(S.mDiscAt, m.tDisc === null ? '—' : ms(m.tDisc), '', m.tDisc === null ? 'good' : 'bad') +
      meter(S.mFullAt, m.tFull === null ? S.mNever : ms(m.tFull), '',
        m.tFull === null ? 'good' : 'bad') +
      meter(S.mLostInfo, m.dropInfo > 0 ? per(m.dropInfo) : '—', '', m.dropInfo > 0 ? 'bad' : 'good') +
      meter(S.mLostErr, m.dropErr > 0 ? per(m.dropErr) : '—', '', m.dropErr > 0 ? 'bad' : 'good') +
      meter(S.mQueue, num(m.len) + ' / ' + num(cfg().q), '', m.len >= cfg().q ? 'bad' : '') +
      meter(S.mWait, ms(m.wait), '', m.wait > 100 ? 'bad' : '');

    const v = $('#verdict');
    let msg, cls;
    if (m.state === 'clean') {
      msg = fill(S.vClean, per(m.lam), per(m.mu));
      cls = ' ok';
    } else if (m.state === 'discarding') {
      msg = fill(S.vDisc, ms(m.tDisc), per(m.dropInfo), num(m.discLine), num(m.thr));
      cls = ' stuck';
    } else if (m.state === 'blocking') {
      msg = fill(S.vBlock, ms(m.tFull), ms(m.perCall), per(m.cap), per(m.absorbed));
      cls = ' stuck';
    } else {
      msg = fill(S.vDropAll, ms(m.tFull), per(m.dropErr), per(m.dropInfo));
      cls = ' stuck';
    }
    v.className = 'verdict' + cls;
    v.innerHTML = msg;
  }

  function drawHint() {
    const o = cfg(), m = cur();
    const h = $('#hint');
    h.className = 'hint' + (m.state === 'clean' ? '' : ' warn');
    h.innerHTML = fill(S.hint, per(m.lam), per(m.mu), num(o.q), num(m.thr), o.errp);
  }

  function layout() { drawPhases(); drawGauge(); drawFour(); drawMeters(); drawHint(); }

  /* --- 시나리오 --- */
  const SCENE = [
    { q: 256, disc: 20, never: false, rate: 8, write: 100, errp: 5 },
    { q: 256, disc: 20, never: false, rate: 40, write: 100, errp: 5 },
    { q: 256, disc: 20, never: false, rate: 40, write: 100, errp: 50 },
    { q: 256, disc: 20, never: true, rate: 40, write: 100, errp: 50 },
    { q: 256, disc: 0, never: false, rate: 40, write: 100, errp: 5 },
    { q: 4096, disc: 20, never: false, rate: 40, write: 100, errp: 5 },
    { q: 256, disc: 20, never: false, rate: 40, write: 5, errp: 5 }
  ];

  const pad = n => String(n).padStart(2, '0');

  function applyStep() {
    const c = SCENE[idx];
    q = c.q; disc = c.disc; never = c.never; rate = c.rate; write = c.write; errp = c.errp;
    syncDials();
    $('#nStep').textContent = pad(idx + 1) + ' / ' + pad(SCENE.length);
    $('#nText').textContent = S.scene[idx];
    $('#btnStep').disabled = idx >= SCENE.length - 1;
    $('#btnPrev').disabled = idx <= 0;
    layout();
  }

  function syncDials() {
    const qi = QS.indexOf(q);
    if (qi >= 0) $('#sQ').value = String(qi);
    $('#vQ').innerHTML = num(q) + '<small>' + S.uEv + '</small>';
    $('#sR').value = String(rate);
    $('#vR').innerHTML = num(rate) + '<small>' + S.uKPerSec + '</small>';
    const wi = WRITE.indexOf(write);
    if (wi >= 0) $('#sW').value = String(wi);
    $('#vW').innerHTML = num(write) + '<small>' + S.uUs + '</small>';
    const ei = ERRP.indexOf(errp);
    if (ei >= 0) $('#sE').value = String(ei);
    $('#vE').innerHTML = errp + '<small>' + S.uPct + '</small>';
    press('#segDisc', b => +b.dataset.disc === disc);
    press('#segNever', b => (b.dataset.never === '1') === never);
  }
  const press = (sel, fn) => $$(sel + ' button').forEach(b => b.setAttribute('aria-pressed', fn(b) ? 'true' : 'false'));

  /* --- 구동 --- */
  const bind = (sel, fn) => { $(sel).oninput = e => { fn(+e.target.value); syncDials(); layout(); }; };
  bind('#sQ', v => q = QS[v]);
  bind('#sR', v => rate = v);
  bind('#sW', v => write = WRITE[v]);
  bind('#sE', v => errp = ERRP[v]);

  $$('#segDisc button').forEach(b => b.onclick = () => { disc = +b.dataset.disc; syncDials(); layout(); });
  $$('#segNever button').forEach(b => b.onclick = () => { never = b.dataset.never === '1'; syncDials(); layout(); });
  $('#btnStep').onclick = () => { if (idx < SCENE.length - 1) { idx++; applyStep(); } };
  $('#btnPrev').onclick = () => { if (idx > 0) { idx--; applyStep(); } };
  $('#btnReset').onclick = () => { idx = 0; applyStep(); };
  $('#btnPrev').disabled = true;

  applyStep();

  /* 검증용 — 배포되는 코드 그대로 수치를 읽을 수 있게 열어둔다 */
  window.LAB = {
    set(o) {
      for (const [k, v] of Object.entries(o)) {
        if (k === 'q') q = v; else if (k === 'disc') disc = v;
        else if (k === 'never') never = v; else if (k === 'rate') rate = v;
        else if (k === 'write') write = v; else if (k === 'errp') errp = v;
      }
      syncDials(); layout(); return window.LAB;
    },
    model, cur, QS, DISC, WRITE, ERRP, scene: SCENE,
    at: over => model(cfg(over)),
    get dials() { return { q, disc, never, rate, write, errp }; }
  };
})();
