/* ============================================================
   21. close() 한 줄인데 선로에는 RST 가 나간다
   ------------------------------------------------------------
   축은 하나다 — **"정상 종료" 의 정의가 계층마다 다르다.**
   애플리케이션은 close() 했으니 정상, TLS 는 close_notify 가 없으니 비정상,
   TCP 는 FIN 이 아니라 RST 가 나갔으니 비정상.

   근거 (1차 출처 확인, 2026-08-13)
     · RFC 9293 §3.6.1 — "If such a host issues a CLOSE call while received data is still
       pending in the TCP connection, or if new data is received after CLOSE is called,
       its TCP implementation SHOULD send a RST to show that data was lost (SHLD-3)."
       **SHOULD 이지 MUST 가 아니다.**
     · RFC 8446 §6.1 — "Each party MUST send a close_notify alert before closing its
       write side." close_notify 를 요구하지 않는 구현은 절단 공격에 취약하다.
     · RFC 8446 §5.1 — 최대 평문 레코드 2^14 = 16,384 바이트.
     · AWS NLB TLS 리스너는 "terminate the front-end connection" 한다 → 커넥션이 둘로 쪼개진다.
       TCP 리스너는 복호화하지 않고 그대로 넘긴다 → 쪼개지지 않는다.
     · nginx `proxy_half_close` 기본값은 off — 한 방향이 닫히면 프록시가 양쪽을 닫는다.

   RFC 가 규정하지 **않는** 것도 분명히 구별한다
     · RST 를 받은 쪽이 수신 버퍼를 버리는 것은 **구현 동작**이다. §3.5.3 은
       "aborts the connection and advises the user" 까지만 말한다.
     · "구멍 있는 EOF 가 없다" 도 한 문장으로 규정된 게 아니라 **순서 보장의 귀결**이다.
       FIN 은 시퀀스 공간을 차지해 스트림 맨 끝에 놓이고(§3.4), 수신 TCP 는 구멍이 있으면
       그 뒤를 애플리케이션에 올리지 못한다.

   그래서 **유실량을 지어내지 않는다.** FIN 경로는 유실이 구조적으로 0 이고,
   RST 경로는 "수신 측 커널 버퍼에 아직 앱이 안 읽은 바이트" 가 사라지는데 그 값을
   알 수 없으므로 **유실 상한**만 계산한다 — min(본문, 수신 버퍼).
   ============================================================ */
(function () {
  const S = window.LAB_I18N;
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];

  const KB = 1024;
  const RCVBUF = 64 * KB;      // 수신 버퍼 (양쪽 동일하다고 본다)
  const TLS_REC = 16384;       // RFC 8446 §5.1

  const BODY = [1, 4, 16, 24, 48, 64].map(n => n * KB);
  const RESP = [0, 1, 8, 64].map(n => n * KB);

  /* --- 손잡이 --- */
  let mode = 'readClose';      // readClose | blindClose | linger0 | shutWr
  let bi = 2, ri = 1;          // 본문 16KB · 응답 1KB
  let tls = 'none';            // none | lb | backend
  let notify = true, halfClose = false;
  let idx = 0;

  const body = () => BODY[bi];
  const resp = () => RESP[ri];

  /* --- 모델 --- */
  function calc(o) {
    /* 응답을 읽지 않고 닫으면 수신 버퍼에 미독 데이터가 남는다 */
    const unread = o.mode === 'blindClose' ? Math.min(o.resp, RCVBUF) : 0;
    /* SO_LINGER(0) 은 미독 데이터와 무관하게 RST 다 */
    const signal = (o.mode === 'linger0' || unread > 0) ? 'RST' : 'FIN';

    /* 커넥션 구간 — TLS 를 로드밸런서에서 종단하면 둘로 쪼개진다 */
    const split = o.tls === 'lb';
    const hops = split ? 2 : 1;

    /* 유실 상한. FIN 이면 구조적으로 0 — 순서 보장의 귀결이다.
       RST 면 수신 측 커널 버퍼의 미독 바이트가 사라지는데, 그 값을 알 수 없으므로 상한만 낸다. */
    const perHop = signal === 'RST' ? Math.min(o.body, RCVBUF) : 0;
    /* 쪼개진 구간이 있으면 유실 지점이 하나 더 생긴다. 프록시가 앞단 RST 를 받고
       뒷단 버퍼를 flush 하는지 끊는지는 문서화돼 있지 않다 — half-close 전파가
       꺼져 있으면(nginx 기본) 양쪽을 닫는다고 본다. */
    const proxyDrops = split && signal === 'RST' && !o.halfClose;
    const lossCap = perHop * (proxyDrops ? 2 : 1);

    /* TLS 면 잘리는 단위가 바이트가 아니라 레코드다 */
    const tlsOn = o.tls !== 'none';
    const recUnit = tlsOn ? TLS_REC : 1;
    const records = tlsOn ? Math.ceil(o.body / TLS_REC) : 0;

    /* 계층별 "정상 종료" 판정 */
    const okApp = true;                                  // close() 를 불렀다. 언제나 정상이다
    const okTls = !tlsOn || o.notify;                    // RFC 8446 §6.1
    const okTcp = signal === 'FIN';

    return {
      unread, signal, hops, split, perHop, proxyDrops, lossCap,
      tlsOn, recUnit, records, okApp, okTls, okTcp,
      okCount: [okApp, okTls, okTcp].filter(Boolean).length,
      /* 서버(수신 측)가 애플리케이션 레벨에서 보는 것 */
      seen: signal === 'RST' ? 'reset' : (okTls ? 'eof' : 'ambiguous')
    };
  }
  const cfg = () => ({ mode, body: body(), resp: resp(), tls, notify, halfClose });
  const cur = () => calc(cfg());

  /* --- 표시 --- */
  const bytes = n => n >= KB ? (n / KB) % 1 === 0 ? (n / KB) + ' KB' : (n / KB).toFixed(1) + ' KB' : n + ' B';
  const m = (k, n, u, cls) =>
    '<div class="m ' + (cls || '') + '"><span class="k">' + k + '</span><span class="n">' + n +
    (u ? '<small>' + u + '</small>' : '') + '</span></div>';

  function render() {
    const c = cfg(), r = cur();

    /* 선로에 나간 신호 */
    $('#wire').innerHTML =
      '<span class="lb">' + S.wLabel + '</span>' +
      '<span class="sigbox' + (r.signal === 'RST' ? ' rst' : '') + '">' + r.signal + '</span>' +
      '<span class="note">' + (r.signal === 'RST'
        ? (mode === 'linger0' ? S.wLinger : S.wUnread.replace('$1', bytes(r.unread)))
        : S.wFin) + '</span>';

    /* 바이트 스트림 — FIN 은 언제나 맨 뒤에 있다 */
    const cells = 24;
    const lostFrom = r.lossCap > 0 ? Math.max(0, cells - Math.round(Math.min(1, r.perHop / c.body) * cells)) : cells;
    let bs = '';
    for (let i = 0; i < cells; i++) {
      const recEdge = r.tlsOn && r.records > 1 && (i + 1) % Math.max(1, Math.round(cells / r.records)) === 0;
      bs += '<i class="' + (i >= lostFrom ? 'lost ' : '') + (recEdge ? 'rec' : '') + '"></i>';
    }
    bs += '<span class="tail' + (r.signal === 'RST' ? ' rst' : '') + '">' + r.signal + '</span>';
    $('#bytes').innerHTML = bs;
    $('#streamX').innerHTML = '<span>' + S.sStart + '</span>' +
      '<span>' + (r.tlsOn ? S.sRecords.replace('$1', r.records).replace('$2', bytes(TLS_REC)) : S.sPlain) + '</span>' +
      '<span>' + S.sTail.replace('$1', r.signal) + '</span>';

    /* 커넥션 구간 */
    let hs = '';
    if (r.split) {
      hs += hop(S.hFront, r.signal === 'RST', r.signal === 'RST' ? r.perHop : 0, S.hTlsHere);
      hs += hop(S.hBack, r.proxyDrops, r.proxyDrops ? r.perHop : 0,
        r.proxyDrops ? S.hPropagated : S.hHalfOpen);
    } else {
      hs += hop(S.hSingle, r.signal === 'RST', r.signal === 'RST' ? r.perHop : 0,
        r.tlsOn ? S.hTlsEnd : S.hPlainEnd);
    }
    $('#hops').innerHTML = hs;

    /* 계층별 판정 — 축이다 */
    const vr = (who, ok, why) =>
      '<div class="vrow"><span class="who">' + who + '</span>' +
      '<span class="tag ' + (ok ? 'ok' : 'no') + '">' + (ok ? S.tOk : S.tNo) + '</span>' +
      '<span class="why">' + why + '</span></div>';
    $('#verdicts').innerHTML =
      vr(S.lApp, r.okApp, S.wApp) +
      vr(S.lTls, r.okTls, !r.tlsOn ? S.wNoTls : (r.notify ? S.wNotify : S.wNoNotify)) +
      vr(S.lTcp, r.okTcp, r.signal === 'FIN' ? S.wTcpFin : S.wTcpRst);

    $('#meters').innerHTML =
      m(S.mSignal, r.signal, '', r.signal === 'RST' ? 'bad' : 'good') +
      m(S.mLoss, r.lossCap ? bytes(r.lossCap) : '0', '', r.lossCap ? 'bad' : 'good') +
      m(S.mPoints, String(r.proxyDrops ? 2 : (r.signal === 'RST' ? 1 : 0)), '', r.signal === 'RST' ? 'bad' : 'good') +
      m(S.mUnit, r.tlsOn ? bytes(TLS_REC) : S.uByte, '', '') +
      m(S.mOk, r.okCount + ' / 3', '', r.okCount === 3 ? 'good' : 'bad') +
      m(S.mSeen, S['seen_' + r.seen], '', r.seen === 'eof' ? 'good' : 'bad');

    /* 네 가지 종료 방식 비교 — 나머지 손잡이는 그대로 */
    const rows = ['readClose', 'blindClose', 'linger0', 'shutWr'];
    $('#cmp').innerHTML =
      '<tr><th>' + S.cMode + '</th><th>' + S.cSignal + '</th><th>' + S.cLoss + '</th><th>' + S.cCode + '</th></tr>' +
      rows.map(k => {
        const x = calc({ ...c, mode: k });
        return '<tr class="' + (k === mode ? 'on' : '') + '"><td>' + S['n_' + k] + '</td>' +
          '<td class="num ' + (x.signal === 'RST' ? 'bad' : 'good') + '">' + x.signal + '</td>' +
          '<td class="num ' + (x.lossCap ? 'bad' : 'good') + '">' + (x.lossCap ? bytes(x.lossCap) : '0') + '</td>' +
          '<td>' + S['c_' + k] + '</td></tr>';
      }).join('');

    /* 판정 */
    const v = $('#verdict');
    let msg, cls;
    if (r.signal === 'RST' && r.proxyDrops) {
      msg = S.vSplit.replace('$1', bytes(r.lossCap)); cls = ' stuck';
    } else if (r.signal === 'RST') {
      msg = S.vRst.replace('$1', bytes(r.unread) || '0').replace('$2', bytes(r.perHop)); cls = ' stuck';
    } else if (!r.okTls) {
      msg = S.vAmb.replace('$1', bytes(TLS_REC)); cls = ' stuck';
    } else {
      msg = S.vClean; cls = ' ok';
    }
    v.className = 'verdict' + cls;
    v.innerHTML = msg;

    const h = $('#hint');
    h.className = 'hint' + (r.signal === 'RST' || !r.okTls ? ' warn' : '');
    h.textContent = r.signal === 'RST' ? S.hRst : (!r.okTls ? S.hAmb : S.hOk);
  }
  const hop = (nm, broken, amt, note) =>
    '<div class="hop' + (broken ? ' broken' : '') + '"><span class="nm">' + nm + '</span>' +
    '<span class="ln">' + note + '</span>' +
    '<span class="amt">' + (amt ? '≤ ' + bytes(amt) : '0') + '</span></div>';

  /* --- 시나리오 --- */
  const SCENE = [
    { mode: 'readClose', bi: 2, ri: 1, tls: 'none', notify: true, halfClose: false },
    { mode: 'blindClose', bi: 2, ri: 1, tls: 'none', notify: true, halfClose: false },
    { mode: 'blindClose', bi: 2, ri: 0, tls: 'none', notify: true, halfClose: false },
    { mode: 'linger0', bi: 2, ri: 0, tls: 'none', notify: true, halfClose: false },
    { mode: 'blindClose', bi: 2, ri: 1, tls: 'backend', notify: false, halfClose: false },
    { mode: 'blindClose', bi: 2, ri: 1, tls: 'lb', notify: false, halfClose: false },
    { mode: 'shutWr', bi: 2, ri: 1, tls: 'lb', notify: true, halfClose: false }
  ];

  function applyStep() {
    const s = SCENE[idx];
    mode = s.mode; bi = s.bi; ri = s.ri; tls = s.tls; notify = s.notify; halfClose = s.halfClose;
    syncDials();
    $('#nStep').textContent = pad(idx + 1) + ' / ' + pad(SCENE.length);
    $('#nText').textContent = S.scene[idx];
    $('#btnStep').disabled = idx >= SCENE.length - 1;
    $('#btnPrev').disabled = idx <= 0;
    render();
  }
  const pad = n => String(n).padStart(2, '0');

  function syncDials() {
    $('#sB').value = String(bi); $('#vB').innerHTML = bytes(body());
    $('#sR').value = String(ri); $('#vR').innerHTML = bytes(resp());
    press('#segMode', b => b.dataset.mode === mode);
    press('#segTls', b => b.dataset.tls === tls);
    press('#segNotify', b => (b.dataset.on === '1') === notify);
    press('#segHalf', b => (b.dataset.on === '1') === halfClose);
    /* TLS 가 없으면 close_notify 는 의미가 없고, 쪼개지지 않으면 half-close 전파도 그렇다 */
    $$('#segNotify button').forEach(b => b.disabled = tls === 'none');
    $$('#segHalf button').forEach(b => b.disabled = tls !== 'lb');
  }
  const press = (sel, fn) => $$(sel + ' button').forEach(b => b.setAttribute('aria-pressed', fn(b) ? 'true' : 'false'));

  const bind = (sel, fn) => { $(sel).oninput = e => { fn(+e.target.value); syncDials(); render(); }; };
  bind('#sB', v => bi = v);
  bind('#sR', v => ri = v);
  $$('#segMode button').forEach(b => b.onclick = () => { mode = b.dataset.mode; syncDials(); render(); });
  $$('#segTls button').forEach(b => b.onclick = () => { tls = b.dataset.tls; syncDials(); render(); });
  $$('#segNotify button').forEach(b => b.onclick = () => { notify = b.dataset.on === '1'; syncDials(); render(); });
  $$('#segHalf button').forEach(b => b.onclick = () => { halfClose = b.dataset.on === '1'; syncDials(); render(); });

  $('#btnStep').onclick = () => { if (idx < SCENE.length - 1) { idx++; applyStep(); } };
  $('#btnPrev').onclick = () => { if (idx > 0) { idx--; applyStep(); } };
  $('#btnReset').onclick = () => { idx = 0; applyStep(); };
  $('#btnPrev').disabled = true;

  applyStep();

  /* 검증용 — 배포되는 코드 그대로 수치를 읽을 수 있게 열어둔다 (tools/ 참고) */
  window.LAB = {
    set(o) {
      if (o.bodyKB != null) bi = BODY.indexOf(o.bodyKB * KB);
      if (o.respKB != null) ri = RESP.indexOf(o.respKB * KB);
      if (o.mode) mode = o.mode;
      if (o.tls) tls = o.tls;
      if (o.notify != null) notify = o.notify;
      if (o.halfClose != null) halfClose = o.halfClose;
      if (bi < 0 || ri < 0) throw new Error('눈금에 없는 값: ' + JSON.stringify(o));
      syncDials(); render(); return window.LAB;
    },
    calc, scene: SCENE, tables: { BODY, RESP, RCVBUF, TLS_REC },
    exact: () => cur(),
    get cfg() { return { mode, bodyKB: body() / KB, respKB: resp() / KB, tls, notify, halfClose }; }
  };
})();
