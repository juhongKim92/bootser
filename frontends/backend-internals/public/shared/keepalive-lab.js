/* ============================================================
   07. Keep-alive 와 죽은 커넥션 + LWT 실험대 — 로직 전용.

   본문과 화면 문안은 각 언어의 HTML 에 직접 박혀 있다.
   실행 중에만 만들어지는 문자열만 페이지가 window.LAB_I18N 으로 넘긴다.

   애니메이션이 없다. 손잡이를 움직이면 그 조건의 사건 순서를 통째로
   다시 계산해 그린다 — 2시간 11분을 실시간으로 기다릴 수는 없으니까.

   모델
   ----
   끊김 방식
     clean   정상 종료 — FIN/DISCONNECT 를 보낸다. 즉시 탐지, Will 발행 안 함
     abrupt  비정상 종료 — 전원 차단·회선 단절. FIN 이 없다
     hang    애플리케이션 멈춤 — 커널은 살아 있어 TCP 프로브에 응답한다.
             앱만 무응답이라 TCP keepalive 로는 영원히 못 잡는다

   탐지 방식 (사망 시점 기준 탐지까지 걸리는 시간)
     tcpDefault  7200 + 75×9 = 7875초   (Linux 기본값)
     tcpTuned    KA + 10×6              (time=KA, intvl=10, probes=6)
     app         1.5 × KA               (MQTT 의 1.5배 규칙)

     KA + 60 = 1.5KA 는 KA=120 에서 만난다. 주기를 2분보다 길게 잡으면
     앱 keep-alive 가 오히려 느려진다.

   LWT
     정상 종료면 발행하지 않는다. 그 외에는 탐지 시점 + Will 지연에 발행하되,
     그 전에 같은 세션으로 다시 붙으면 취소된다 (MQTT 5 Will Delay Interval).
     탐지 자체가 안 되면 Will 도 영원히 나가지 않는다.
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

  const TCP_TIME   = 7200;   // net.ipv4.tcp_keepalive_time
  const TCP_INTVL  = 75;     // net.ipv4.tcp_keepalive_intvl
  const TCP_PROBES = 9;      // net.ipv4.tcp_keepalive_probes
  const TCP_DEFAULT = TCP_TIME + TCP_INTVL * TCP_PROBES;   // 7875

  const TUNED_INTVL  = 10;
  const TUNED_PROBES = 6;

  const INF = Infinity;

  /* ============================================================================
   * 1. 상태
   * ========================================================================== */

  let kind  = 'abrupt';    // clean | abrupt | hang
  let mode  = 'tcpDefault';// tcpDefault | tcpTuned | app
  let ka    = 60;          // keep-alive 주기 (초)
  let will  = 0;           // Will 지연 (초)
  let back  = 0;           // 재접속까지 (초, 0 = 돌아오지 않음)

  /* ============================================================================
   * 2. 계산
   * ========================================================================== */

  function detectAfter(m){
    if (kind === 'clean') return 0;
    if (kind === 'hang' && m !== 'app') return INF;   // 커널이 대신 대답해 준다
    if (m === 'tcpDefault') return TCP_DEFAULT;
    if (m === 'tcpTuned')   return ka + TUNED_INTVL * TUNED_PROBES;
    return 1.5 * ka;
  }

  function compute(){
    const detect = detectAfter(mode);
    const r = { detect, willAt: null, lwt: 'published' };

    if (kind === 'clean'){ r.lwt = 'none'; return r; }
    if (detect === INF)  { r.lwt = 'never'; return r; }

    const at = detect + will;
    if (back > 0 && back < at){ r.lwt = 'cancelled'; r.willAt = at; return r; }
    r.willAt = at;
    return r;
  }

  /* ============================================================================
   * 3. 서식
   * ========================================================================== */

  function fmt(s){
    if (s === INF) return '∞';
    if (s === 0) return t('fNow');
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const x = Math.round(s % 60);
    return [h ? t('fH', h) : '', m ? t('fM', m) : '', x ? t('fS', x) : ''].filter(Boolean).join(' ');
  }

  function clock(s){
    if (s === INF) return '  —  ';
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const x = Math.round(s % 60);
    const p = n => String(n).padStart(2, '0');
    return `${p(h)}:${p(m)}:${p(x)}`;
  }

  /* ============================================================================
   * 4. 사건 순서
   * ========================================================================== */

  function timeline(){
    const c = compute();
    const ev = [];
    const add = (at, text, cls) => ev.push({ at, text, cls });

    add(0, kind === 'clean' ? t('eClean') : kind === 'abrupt' ? t('eAbrupt') : t('eHang'),
        kind === 'clean' ? '' : 'down');

    if (kind === 'clean'){
      add(0, t('eCleanSeen'), 'up');
      add(0, t('eNoWill'), '');
      return { c, ev };
    }

    add(0, t('eStillOnline'), 'warn');

    if (kind === 'hang' && mode !== 'app'){
      add(TCP_TIME, mode === 'tcpDefault' ? t('eProbe1', TCP_TIME) : t('eProbe1', ka), '');
      add(INF, t('eKernelAnswers'), 'down');
      add(INF, t('eNeverDetected'), 'down');
      return { c, ev };
    }

    if (mode === 'tcpDefault'){
      add(TCP_TIME, t('eProbe1', TCP_TIME), 'warn');
      add(c.detect, t('eProbeOut', TCP_PROBES, TCP_INTVL), 'down');
    } else if (mode === 'tcpTuned'){
      add(ka, t('eProbe1', ka), 'warn');
      add(c.detect, t('eProbeOut', TUNED_PROBES, TUNED_INTVL), 'down');
    } else {
      add(ka, t('ePingMissed', ka), 'warn');
      add(c.detect, t('eKaOut', ka), 'down');
    }

    add(c.detect, t('eOffline'), 'up');

    if (back > 0) add(back, t('eBack', fmt(back)), 'up');

    if (c.lwt === 'cancelled') add(c.willAt, t('eWillCancelled'), 'up');
    else                        add(c.willAt, t('eWillPublished', fmt(will)), 'down');

    ev.sort((a, b) => a.at - b.at);
    return { c, ev };
  }

  /* ============================================================================
   * 5. 그리기
   * ========================================================================== */

  function render(){
    $$('#segKind button').forEach(b => b.setAttribute('aria-pressed', b.dataset.kind === kind));
    $$('#segMode button').forEach(b => b.setAttribute('aria-pressed', b.dataset.mode === mode));

    const kaUsed = kind !== 'clean' && mode !== 'tcpDefault';
    $('#vKa').innerHTML   = `${ka}<small> ${t('uSec')}</small>`;
    $('#vKa').className   = 'v' + (kaUsed ? '' : ' off');
    $('#vWill').innerHTML = `${will}<small> ${t('uSec')}</small>`;
    $('#vBack').innerHTML = back === 0 ? `<small>${t('noBack')}</small>` : `${back}<small> ${t('uSec')}</small>`;

    const { c, ev } = timeline();

    /* 시간축 */
    const bar = $('#bar');
    if (c.detect === INF){
      bar.innerHTML = `<div class="never">${t('bNever')}</div>`;
      $('#axis').innerHTML = `<span>0</span><span>∞</span>`;
      $('#marks').innerHTML = '';
    } else {
      const total = Math.max(c.willAt || c.detect, 1);
      const g = c.detect / total * 100;
      const w = ((c.willAt || c.detect) - c.detect) / total * 100;
      bar.innerHTML =
        (c.detect > 0 ? `<div class="ghost" style="width:${g}%">${g > 22 ? t('bGhost', fmt(c.detect)) : ''}</div>` : '') +
        (w > 0 ? `<div class="delay" style="width:${w}%">${w > 18 ? t('bDelay', fmt(will)) : ''}</div>` : '') +
        (c.detect === 0 ? `<div class="live" style="width:100%">${t('bClean')}</div>` : '');
      $('#axis').innerHTML = `<span>${t('aDied')}</span><span>${fmt(total)}</span>`;
      $('#marks').innerHTML = back > 0 && back <= total
        ? `<span style="left:${Math.min(98, back / total * 100)}%">↑ ${t('aBack')}</span>` : '';
    }

    /* 판정 */
    const vc = { none:'no', never:'bad', cancelled:'warn', published:'pub' }[c.lwt];
    $('#verdict').innerHTML =
      `<span class="lbl">${t('vLwt')}</span><span class="val ${vc}">${t('lwt_' + c.lwt)}</span>`;

    /* 계기 */
    const cell = (k, n, cls) =>
      `<div class="${cls || ''}"><span class="k">${k}</span><span class="n">${n}</span></div>`;
    $('#meters').innerHTML =
      cell(t('mGhost'), fmt(c.detect), c.detect === 0 ? 'good' : 'bad') +
      cell(t('mWill'),  c.lwt === 'published' ? fmt(c.willAt) : '—',
           c.lwt === 'published' ? '' : 'bad');

    /* 방식 비교 */
    const rows = [
      ['tcpDefault', t('mdDefault'), `${TCP_TIME} + ${TCP_INTVL}×${TCP_PROBES}`],
      ['tcpTuned',   t('mdTuned'),   `${ka} + ${TUNED_INTVL}×${TUNED_PROBES}`],
      ['app',        t('mdApp'),     `${ka} × 1.5`],
    ];
    $('#cmp').innerHTML =
      `<tr><th>${t('cMode')}</th><th>${t('cCalc')}</th><th>${t('cGhost')}</th></tr>` +
      rows.map(([m, name, calc]) => {
        const dd = detectAfter(m);
        const cls = dd === INF ? 'bad' : dd === 0 ? 'good' : dd > 600 ? 'bad' : '';
        return `<tr class="${m === mode ? 'on' : ''}"><td>${name}</td>` +
               `<td class="num">${kind === 'clean' ? '—' : calc}</td>` +
               `<td class="num ${cls}">${dd === INF ? t('cNever') : fmt(dd)}</td></tr>`;
      }).join('');

    /* 사건 순서 */
    $('#events').innerHTML = ev.map(e =>
      `<div class="${e.cls}"><span class="t">${clock(e.at)}</span><span>${e.text}</span></div>`).join('');

    /* 힌트 */
    const h = $('#hint');
    if (kind === 'hang' && mode !== 'app'){ h.textContent = t('hHang'); h.className = 'hint warn'; }
    else if (kind === 'clean'){ h.textContent = t('hClean'); h.className = 'hint'; }
    else if (mode === 'tcpDefault'){ h.textContent = t('hDefault'); h.className = 'hint warn'; }
    else if (c.lwt === 'cancelled'){ h.textContent = t('hCancelled'); h.className = 'hint'; }
    else if (mode === 'app' && ka > 120){ h.textContent = t('hSlow'); h.className = 'hint warn'; }
    else { h.textContent = t('hOk', fmt(c.detect)); h.className = 'hint'; }
  }

  /* ============================================================================
   * 6. 시나리오
   * ========================================================================== */

  const SCENE = [
    { kind:'clean',  mode:'tcpDefault', ka:60, will:0,  back:0   },
    { kind:'abrupt', mode:'tcpDefault', ka:60, will:0,  back:0   },
    { kind:'abrupt', mode:'tcpTuned',   ka:60, will:0,  back:0   },
    { kind:'abrupt', mode:'app',        ka:60, will:0,  back:0   },
    { kind:'hang',   mode:'tcpTuned',   ka:60, will:0,  back:0   },
    { kind:'hang',   mode:'app',        ka:60, will:0,  back:0   },
    { kind:'abrupt', mode:'app',        ka:60, will:60, back:100 },
  ];

  let step = 0, playing = false, timer = null;

  let playSpeed = 1;             // 재생 배율

  function applyStep(){
    const s = SCENE[step];
    kind = s.kind; mode = s.mode; ka = s.ka; will = s.will; back = s.back;
    $('#sKa').value = ka; $('#sWill').value = will; $('#sBack').value = back;
    $('#nText').textContent = S.scene[step];
    $('#nStep').textContent =
      `${String(step + 1).padStart(2, '0')} / ${String(SCENE.length).padStart(2, '0')}`;
    $('#btnStep').disabled = step >= SCENE.length - 1;
    $('#btnPrev').disabled = step <= 0;
    render();
  }
  function stepOnce(){
    if (step >= SCENE.length - 1){ stop(); return; }
    step++; applyStep();
    if (step >= SCENE.length - 1) stop();
  }
  function play(){ playing = true; $('#btnPlay').textContent = t('pause'); timer = setInterval(stepOnce, (4200) / playSpeed); }
  function stop(){ playing = false; clearInterval(timer); $('#btnPlay').textContent = t('play'); }

  /* ============================================================================
   * 7. 손잡이
   * ========================================================================== */

  $$('#segKind button').forEach(b => b.onclick = () => { stop(); kind = b.dataset.kind; render(); });
  $$('#segMode button').forEach(b => b.onclick = () => { stop(); mode = b.dataset.mode; render(); });
  $('#sKa').oninput   = () => { stop(); ka   = +$('#sKa').value;   render(); };
  $('#sWill').oninput = () => { stop(); will = +$('#sWill').value; render(); };
  $('#sBack').oninput = () => { stop(); back = +$('#sBack').value; render(); };

  $('#btnPlay').onclick  = () => playing ? stop() : play();
  $('#btnStep').onclick  = () => { stop(); stepOnce(); };
  $('#btnPrev').onclick  = () => { stop(); if (step > 0){ step--; applyStep(); } };
  $('#btnPrev').disabled = true;      // 첫 단계에서 시작한다
  [...document.querySelectorAll('#segSpeed button')].forEach(b => b.onclick = () => {
    playSpeed = +b.dataset.speed;
    [...document.querySelectorAll('#segSpeed button')]
      .forEach(x => x.setAttribute('aria-pressed', x === b));
    if (playing){ stop(); play(); }   // 돌고 있으면 새 간격으로 다시 건다
  });
  $('#btnReset').onclick = () => { stop(); step = 0; applyStep(); };

  /* ============================================================================
   * 8. 기동
   * ========================================================================== */

  $('#nText').textContent = S.scene[0];
  $('#nStep').textContent = `01 / ${String(SCENE.length).padStart(2, '0')}`;
  render();

})();
