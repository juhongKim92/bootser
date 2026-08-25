/* ============================================================
   26. 파일이 1바이트 커졌는데 왕복이 한 번 더 든다 — 슬로 스타트
   ------------------------------------------------------------
   TCP 는 처음부터 회선을 다 쓰지 않는다. 초기 혼잡 창(IW) 만큼 보내고, 그 응답을
   받아야 창을 키운다. 그래서 전송 시간이 크기에 비례하지 않고 **왕복 수의 계단**이다.

   창이 한 왕복에 얼마나 커지나 — 지연 ACK 를 켜면 수신자가 세그먼트 두 개당
   ACK 하나를 보내고 ACK 하나가 cwnd 를 1 MSS 키우므로 `cwnd → cwnd + cwnd/2`,
   즉 1.5배다. 끄면 2배다. **RFC 6928 이 준 왕복 수 표는 1.5 쪽에서만 맞는다**
   (10/21/78 세그먼트 × IW 3/10 여섯 칸 전부). 그 표가 이 모델의 검산점이다.

   난수가 없다. 왕복 수는 크기와 IW 만의 함수라 닫힌 형태로 나온다 —
   회선 속도는 이 식에 아예 없다.
   ============================================================ */
(function () {
  const S = window.LAB_I18N;
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];

  const MSS = 1460;
  const IWS = [3, 10, 30];
  /* 크기 후보 — 14,600 과 14,601 을 둘 다 넣는다. 이 페이지의 훅이다 */
  const SIZES = [1000, 5000, 14600, 14601, 25000, 50000, 100000, 250000, 500000, 1000000];
  const STAIR_COLS = 24, STAIR_MAX = 307200;   /* 300 KiB — 축 눈금이 딱 떨어지게 */

  /* --- 손잡이 --- */
  let iw = 10, rtt = 100, size = 14600, reuse = false, dack = true;
  let idx = 0;

  /* --- 모델 --------------------------------------------------------- */
  const segsOf = bytes => Math.ceil(bytes / MSS);

  /* 왕복마다 보낸 세그먼트 목록 — 마지막 왕복은 남은 만큼만 보낸다 */
  function trips(bytes, o) {
    const need = segsOf(bytes);
    const out = [];
    let w = o.iw, sent = 0;
    while (sent < need && out.length < 64) {
      const now = Math.min(w, need - sent);
      out.push({ window: w, sent: now });
      sent += now;
      w += o.dack ? Math.floor(w / 2) : w;
    }
    return out;
  }
  const roundsOf = (bytes, o) => o.reuse ? 1 : trips(bytes, o).length;

  /* 앞 r 왕복에 보낼 수 있는 누적 세그먼트 */
  function capacity(r, o) {
    let w = o.iw, sent = 0;
    for (let i = 0; i < r; i++) { sent += w; w += o.dack ? Math.floor(w / 2) : w; }
    return sent;
  }

  /* 새 커넥션이면 TCP 핸드셰이크 한 왕복이 앞에 붙는다 */
  const handshake = o => o.reuse ? 0 : 1;
  const timeOf = (bytes, o) => (handshake(o) + roundsOf(bytes, o)) * o.rtt;

  const cfg = over => Object.assign({ iw, rtt, size, reuse, dack }, over || {});

  /* --- 표기 --- */
  /* 이 페이지는 한 바이트가 논지라 본문·힌트에는 정확한 바이트를 쓴다.
     KB 표기는 축 눈금처럼 자리가 좁은 곳에만 쓴다. */
  const bytes = v => num(v) + S.uB;
  const bytesShort = v => v >= 1048576 ? (v / 1048576).toFixed(2) + S.uMb
    : v >= 1024 ? (v / 1024).toFixed(1) + S.uKb : num(v) + S.uB;
  const num = v => String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const ms = v => v >= 1000 ? (v / 1000).toFixed(2) + S.uSec : Math.round(v) + S.uMs;
  const fill = (str, ...v) => v.reduce((a, x, i) => a.split('$' + (i + 1)).join(x), str);
  const meter = (k, n, u, cls) =>
    '<div class="m ' + (cls || '') + '"><span class="k">' + k + '</span><span class="n">' + n +
    (u ? '<small>' + u + '</small>' : '') + '</span></div>';

  /* --- 왕복 타임라인 --- */
  function drawTrip() {
    const o = cfg(), ts = trips(size, o);
    const shown = o.reuse ? [{ window: segsOf(size), sent: segsOf(size) }] : ts;
    const max = Math.max(...shown.map(t => t.sent), 1);
    let html = '';
    if (!o.reuse) html += '<div class="rt hs"><span class="seg-n">' + S.tHand +
      '</span><span class="bar" style="height:14%"></span></div>';
    shown.forEach((t, i) => {
      html += '<div class="rt' + (i === shown.length - 1 && shown.length > 1 ? ' over' : '') + '">' +
        '<span class="seg-n">' + t.sent + '</span>' +
        '<span class="bar" style="height:' + Math.max(4, t.sent / max * 100).toFixed(1) + '%"></span></div>';
    });
    $('#trip').innerHTML = html;
    let x = o.reuse ? '' : '<span>' + S.tHandShort + '</span>';
    shown.forEach((t, i) => { x += '<span>' + fill(S.tRound, i + 1) + '</span>'; });
    $('#tripX').innerHTML = x;
  }

  /* --- 크기에 따른 계단 --- */
  function drawStair() {
    const o = cfg(), cmpIw = iw === 3 ? 10 : 3;
    const cols = [];
    for (let i = 1; i <= STAIR_COLS; i++) {
      const b = Math.round(STAIR_MAX / STAIR_COLS * i);
      cols.push({ b, now: roundsOf(b, cfg({ reuse: false })), cmp: roundsOf(b, cfg({ iw: cmpIw, reuse: false })) });
    }
    const max = Math.max(...cols.map(c => Math.max(c.now, c.cmp)), 1);
    const step = STAIR_MAX / STAIR_COLS;
    $('#stair').innerHTML = cols.map(c => {
      const here = Math.abs(c.b - size) < step / 2 ? ' here' : '';
      return '<div class="col' + here + '" title="' + fill(S.stTip, bytes(c.b), c.now, c.cmp) + '">' +
        '<div class="now" style="height:' + (c.now / max * 100).toFixed(1) + '%"></div>' +
        '<div class="cmp" style="height:' + (c.cmp / max * 100).toFixed(1) + '%"></div></div>';
    }).join('');
    $('#stairX').innerHTML = [0, STAIR_MAX / 2, STAIR_MAX].map(v => '<span>' + bytesShort(v) + '</span>').join('');
    $('#stairY').innerHTML = fill(S.stY, max, iw, cmpIw);
  }

  /* --- 계단 경계 표 --- */
  function drawEdge() {
    const o = cfg({ reuse: false }), r = roundsOf(size, o);
    let html = '<tr><th>' + S.eRound + '</th><th>' + S.eUpto + '</th><th>' + S.eTime + '</th></tr>';
    for (let i = 1; i <= 6; i++) {
      const cap = capacity(i, o) * MSS;
      html += '<tr class="' + (i === r && !reuse ? 'on' : '') + '"><td>' + fill(S.tRound, i) + '</td>' +
        '<td>' + num(cap) + S.uB + '</td><td>' + ms((handshake(o) + i) * rtt) + '</td></tr>';
    }
    $('#edge').innerHTML = html;
  }

  function drawMeters() {
    const o = cfg(), r = roundsOf(size, o);
    const base = cfg({ reuse: false });
    const rNew = roundsOf(size, base);
    const cap = capacity(rNew, base) * MSS;
    const prev = rNew > 1 ? capacity(rNew - 1, base) * MSS : 0;
    $('#meters').innerHTML =
      meter(S.mRounds, r, S.uTimes, r > 3 ? 'bad' : 'good') +
      meter(S.mTime, ms(timeOf(size, o)), '', '') +
      meter(S.mFirst, num(iw * MSS), S.uB, '') +
      meter(S.mUpto, num(cap), S.uB, '') +
      meter(S.mToNext, num(cap - size + 1), S.uB, '') +
      meter(S.mSaved, reuse ? '—' : ms(timeOf(size, cfg({ reuse: true }))), '', reuse ? 'good' : '');

    /* IW 세 값 비교 */
    const rows = IWS.map(v => ({ v, r: roundsOf(size, cfg({ iw: v, reuse: false })) }));
    const best = Math.min(...rows.map(x => x.r));
    $('#cmpTbl').innerHTML =
      '<tr><th>' + S.cIw + '</th><th>' + S.cFirst + '</th><th>' + S.cRounds + '</th><th>' + S.cTime + '</th></tr>' +
      rows.map(x =>
        '<tr class="' + (x.v === iw ? 'on' : '') + '"><td>' + fill(S.cIwVal, x.v) + '</td>' +
        '<td class="num">' + num(x.v * MSS) + S.uB + '</td>' +
        '<td class="num ' + (x.r === best ? 'good' : 'bad') + '">' + fill(S.tRound, x.r) + '</td>' +
        '<td class="num ' + (x.r === best ? 'good' : 'bad') + '">' + ms((1 + x.r) * rtt) + '</td></tr>').join('');

    /* 판정 */
    const v = $('#verdict');
    let msg, cls;
    if (reuse) {
      msg = fill(S.vReuse, ms(timeOf(size, o)), ms(timeOf(size, base)), rNew);
      cls = ' ok';
    } else if (rNew === 1) {
      msg = fill(S.vOne, num(cap), num(cap - size + 1));
      cls = ' ok';
    } else {
      msg = fill(S.vSteps, rNew, ms(timeOf(size, o)), num(size - prev), num(cap - size + 1));
      cls = ' stuck';
    }
    v.className = 'verdict' + cls;
    v.innerHTML = msg;
  }

  function drawHint() {
    const o = cfg();
    const h = $('#hint');
    const r = roundsOf(size, o);
    h.className = 'hint' + (!reuse && r > 3 ? ' warn' : '');
    h.innerHTML = fill(S.hint, bytes(size), segsOf(size), iw, r, ms(timeOf(size, o)));
  }

  function layout() { drawTrip(); drawStair(); drawEdge(); drawMeters(); drawHint(); }

  /* --- 시나리오 --- */
  const SCENE = [
    { iw: 10, rtt: 100, size: 14600, reuse: false, dack: true },
    { iw: 10, rtt: 100, size: 14601, reuse: false, dack: true },
    { iw: 3, rtt: 100, size: 100000, reuse: false, dack: true },
    { iw: 10, rtt: 100, size: 100000, reuse: false, dack: true },
    { iw: 10, rtt: 100, size: 100000, reuse: false, dack: false },
    { iw: 10, rtt: 100, size: 100000, reuse: true, dack: true },
    { iw: 10, rtt: 100, size: 1000000, reuse: false, dack: true }
  ];

  function applyStep() {
    const c = SCENE[idx];
    iw = c.iw; rtt = c.rtt; size = c.size; reuse = c.reuse; dack = c.dack;
    syncDials();
    $('#nStep').textContent = pad(idx + 1) + ' / ' + pad(SCENE.length);
    $('#nText').textContent = S.scene[idx];
    $('#btnStep').disabled = idx >= SCENE.length - 1;
    $('#btnPrev').disabled = idx <= 0;
    layout();
  }
  const pad = n => String(n).padStart(2, '0');

  function syncDials() {
    const ii = IWS.indexOf(iw);
    if (ii >= 0) $('#sIw').value = String(ii);
    $('#vIw').innerHTML = iw + '<small>' + S.uSeg + '</small>';
    $('#sRtt').value = String(rtt); $('#vRtt').innerHTML = rtt + '<small>' + S.uMs + '</small>';
    const si = SIZES.indexOf(size);
    if (si >= 0) $('#sSize').value = String(si);
    $('#vSize').innerHTML = num(size) + '<small>' + S.uB + '</small>';
    press('#segReuse', b => (b.dataset.reuse === '1') === reuse);
    press('#segAck', b => (b.dataset.ack === '1') === dack);
  }
  const press = (sel, fn) => $$(sel + ' button').forEach(b => b.setAttribute('aria-pressed', fn(b) ? 'true' : 'false'));

  /* --- 구동 --- */
  const bind = (sel, fn) => { $(sel).oninput = e => { fn(+e.target.value); syncDials(); layout(); }; };
  bind('#sIw', v => iw = IWS[v]);
  bind('#sRtt', v => rtt = v);
  bind('#sSize', v => size = SIZES[v]);

  $$('#segReuse button').forEach(b => b.onclick = () => { reuse = b.dataset.reuse === '1'; syncDials(); layout(); });
  $$('#segAck button').forEach(b => b.onclick = () => { dack = b.dataset.ack === '1'; syncDials(); layout(); });
  $('#btnStep').onclick = () => { if (idx < SCENE.length - 1) { idx++; applyStep(); } };
  $('#btnPrev').onclick = () => { if (idx > 0) { idx--; applyStep(); } };
  $('#btnReset').onclick = () => { idx = 0; applyStep(); };
  $('#btnPrev').disabled = true;

  applyStep();

  /* 검증용 — 배포되는 코드 그대로 수치를 읽을 수 있게 열어둔다.
     initialWindow 는 RFC 6928 의 정의 그대로다: min(10*MSS, max(2*MSS, 14600)). */
  window.LAB = {
    set(o) {
      for (const [k, v] of Object.entries(o)) {
        if (k === 'iw') iw = v; else if (k === 'rtt') rtt = v; else if (k === 'size') size = v;
        else if (k === 'reuse') reuse = v; else if (k === 'dack') dack = v;
      }
      syncDials(); layout(); return window.LAB;
    },
    rounds: (bytesIn, o) => roundsOf(bytesIn, Object.assign({ iw, rtt, size, reuse: false, dack }, o || {})),
    capacity: (r, o) => capacity(r, Object.assign({ iw, dack }, o || {})),
    trips: (bytesIn, o) => trips(bytesIn, Object.assign({ iw, dack }, o || {})),
    time: (bytesIn, o) => timeOf(bytesIn, Object.assign({ iw, rtt, reuse, dack }, o || {})),
    initialWindow: mss => Math.min(10 * mss, Math.max(2 * mss, 14600)),
    segs: segsOf, MSS, IWS, SIZES, scene: SCENE,
    get cfg() { return { iw, rtt, size, reuse, dack }; }
  };
})();
