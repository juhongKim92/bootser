/* ============================================================
   MVCC 실험대 — 로직 전용.

   본문과 화면 문안은 각 언어의 HTML 에 직접 박혀 있다.
   여기서 필요한 건 실행 중에만 만들어지는 문자열(로그, 세션 상태,
   단계 서술)뿐이고, 그것만 페이지가 넘겨준다.

     initMvccLab({ strings: {...}, scenes: [...] })

   scenes 는 아래 SCENE 과 같은 길이의 서술문 배열이다.
   ============================================================ */
'use strict';

window.initMvccLab = function (cfg) {

  const S = cfg.strings;
  const NARR = cfg.scenes;

  const t = (k, ...a) => {
    let s = S[k] ?? k;
    a.forEach((v, i) => s = s.replaceAll('$' + (i + 1), v));
    return s;
  };
  const $ = s => document.querySelector(s);

  /* ============================================================================
   * 1. 모델
   *
   *    튜플 하나는 { xmin, xmax } 를 갖는다.
   *      xmin — 이 버전을 만든 트랜잭션
   *      xmax — 이 버전을 지운 트랜잭션 (없으면 null)
   *
   *    죽은 튜플이라고 바로 지울 수 있는 게 아니다. 아직 그 버전을 볼 자격이
   *    있는 트랜잭션이 하나라도 살아 있으면 VACUUM은 손대지 못한다.
   *    그 경계선이 xmin horizon 이다.
   * ========================================================================== */

  const SLOTS = 8;          // 페이지당 슬롯
  const PAGE_KB = 8;        // 페이지 크기

  let st;

  function reset(){
    st = {
      nextXid: 101,
      committed: new Set([100]),
      tx: { A: blank(), B: blank() },
      tuples: [],
      pages: 3,
      seq: 0,
      log: [],
      step: 0,
      peakSize: 0,
    };
    for (let i=0;i<16;i++){
      const p = place();
      st.tuples.push({ id: st.seq++, xmin:100, xmax:null, page:p.page, slot:p.slot });
    }
    st.peakSize = size();
  }

  const blank = () => ({ open:false, xid:null, snap:null });

  /** 열린 트랜잭션이 붙잡고 있는 가장 오래된 xid. 없으면 미래를 가리킨다. */
  function horizon(){
    const xs = [];
    for (const k of ['A','B']){
      const x = st.tx[k];
      if (!x.open) continue;
      if (x.snap != null) xs.push(x.snap);
      if (x.xid  != null) xs.push(x.xid);
    }
    return xs.length ? Math.min(...xs) : st.nextXid;
  }

  function holder(){
    const h = horizon();
    for (const k of ['A','B']){
      const x = st.tx[k];
      if (!x.open) continue;
      if (x.snap === h || x.xid === h) return k;
    }
    return null;
  }

  const isCommitted = x => x != null && st.committed.has(x);

  /** live | pending | blocked | free */
  function stateOf(tp){
    if (!isCommitted(tp.xmin)) return 'pending';
    if (!isCommitted(tp.xmax)) return 'live';
    return tp.xmax < horizon() ? 'free' : 'blocked';
  }

  function place(){
    const used = new Set(st.tuples.map(x => x.page*SLOTS + x.slot));
    for (let i=0;i<st.pages*SLOTS;i++) if (!used.has(i)) return { page:Math.floor(i/SLOTS), slot:i%SLOTS };
    st.pages++;
    return { page:st.pages-1, slot:0 };
  }

  const size  = () => st.pages * PAGE_KB;
  const liveN = () => st.tuples.filter(x => stateOf(x)==='live').length;
  const deadN = () => st.tuples.filter(x => { const s=stateOf(x); return s==='blocked'||s==='free'; }).length;

  /* --- 연산 ----------------------------------------------------------------- */

  function log(msg, cls){ st.log.push({ msg, cls }); if (st.log.length>60) st.log.shift(); }

  function opBegin(k){
    if (st.tx[k].open) return;
    st.tx[k] = { open:true, xid:null, snap:null };
    log(t('lgBegin', k));
  }
  function takeSnap(k){
    const x = st.tx[k];
    if (x.snap == null) x.snap = st.nextXid;
  }
  function needXid(k){
    const x = st.tx[k];
    if (x.xid == null) x.xid = st.nextXid++;
    return x.xid;
  }
  function opSelect(k){
    if (!st.tx[k].open){ log(t('lgAuto', k)); opBegin(k); }
    takeSnap(k);
    log(t('lgSelect', k, st.tx[k].snap));
  }
  function opWrite(k, n, kind){
    if (!st.tx[k].open){ log(t('lgAuto', k)); opBegin(k); }
    takeSnap(k);
    const xid = needXid(k);
    const targets = st.tuples.filter(x => isCommitted(x.xmin) && x.xmax == null).slice(0, n);
    for (const tp of targets){
      tp.xmax = xid;
      if (kind === 'update'){
        const p = place();
        st.tuples.push({ id: st.seq++, xmin: xid, xmax:null, page:p.page, slot:p.slot });
      }
    }
    log(t(kind === 'update' ? 'lgUpdate' : 'lgDelete', k, targets.length));
    st.peakSize = Math.max(st.peakSize, size());
  }
  function opCommit(k){
    const x = st.tx[k];
    if (!x.open) return;
    if (x.xid != null) st.committed.add(x.xid);
    st.tx[k] = blank();
    log(t('lgCommit', k));
  }

  function opVacuum(){
    const h = horizon();
    const before = st.tuples.length;
    const kept = st.tuples.filter(x => stateOf(x) !== 'free');
    const removed = before - kept.length;
    const held = kept.filter(x => stateOf(x) === 'blocked').length;
    st.tuples = kept;

    if (removed === 0) log(t('lgVacNone', h), 'hi');
    else log(t('lgVacFull', removed, held), held ? 'hi' : 'ok');

    // 꼬리 절단 — 뒤쪽 페이지가 완전히 비어야만 OS에 돌려줄 수 있다
    let maxPage = -1;
    for (const x of st.tuples) maxPage = Math.max(maxPage, x.page);
    const canDrop = st.pages - (maxPage + 1);
    if (removed > 0){
      if (canDrop > 0){ st.pages = Math.max(1, maxPage + 1); log(t('lgTrunc', canDrop), 'ok'); }
      else log(t('lgNoTrunc'));
    }
  }

  /* ============================================================================
   * 2. 시나리오 — 서술문은 페이지가 넘겨준 NARR 에서 꺼낸다
   * ========================================================================== */

  const SCENE = [
    { run(){} },
    { run(){ opBegin('B'); opWrite('B',3,'update'); opCommit('B'); } },
    { run(){ opVacuum(); } },
    { run(){ opBegin('A'); opSelect('A'); } },
    { run(){ opBegin('B'); opWrite('B',3,'update'); opCommit('B'); } },
    { run(){ opVacuum(); } },
    { run(){ opBegin('B'); opWrite('B',3,'update'); opCommit('B');
             opBegin('B'); opWrite('B',3,'update'); opCommit('B'); } },
    { run(){ opVacuum(); } },
    { run(){ opCommit('A'); } },
    { run(){ opVacuum(); } },
    { run(){} },
  ];

  /* ============================================================================
   * 3. 화면
   * ========================================================================== */

  function render(){
    const h = horizon();

    // 축
    const ticks = [];
    for (let x=100; x<st.nextXid; x++){
      const cls = ['tick'];
      if (x < h) cls.push('reclaimable');
      const who = [];
      for (const k of ['A','B']){
        const s = st.tx[k];
        if (s.open && (s.xid===x || s.snap===x)){ cls.push('open'); who.push(k); }
      }
      ticks.push(`<span class="${cls.join(' ')}">${who.length?`<span class="who">${who.join('·')}</span>`:''}${x}</span>`);
    }
    if (st.nextXid <= 160)
      ticks.push(`<span class="tick" style="opacity:.45">${st.nextXid}</span>`);
    $('#ticks').innerHTML = ticks.join('');

    $('#hzVal').textContent = h;
    const hd = holder();
    $('#hzWho').textContent = hd ? t('hzHeld', hd) : t('hzNone');

    // 세션
    for (const k of ['A','B']){
      const s = st.tx[k], el = $('#st'+k);
      el.classList.toggle('on', s.open);
      el.textContent = !s.open ? t('idle')
              : s.xid != null ? t('openXid', s.xid, s.snap)
                      : s.snap != null ? t('openSnap', s.snap)
                              : t('openNoSnap');
    }

    // 힙
    const byPage = Array.from({length:st.pages}, () => new Array(SLOTS).fill(null));
    for (const x of st.tuples) if (x.page < st.pages) byPage[x.page][x.slot] = x;
    $('#pages').innerHTML = byPage.map((slots, p) => `
    <div class="page">
      <span class="pno">page ${p}</span>
      <div class="slots">${slots.map(x => {
      if (!x) return '<div class="slot"></div>';
      const s = stateOf(x);
      return `<div class="slot ${s}"><span>${x.xmin}</span><span>${x.xmax ?? '—'}</span></div>`;
    }).join('')}</div>
    </div>`).join('');

    // 계기
    const dead = deadN();
    $('#mSize').innerHTML = `${size()}<small> KB</small>`;
    $('#mLive').textContent = liveN();
    $('#mDead').textContent = dead;
    $('#mDeadBox').classList.toggle('warn', dead > 0);
    const total = st.tuples.length;
    const bloat = total ? Math.round(dead * 100 / total) : 0;
    $('#mBloat').innerHTML = `${bloat}<small> %</small>`;

    // 로그
    $('#log').innerHTML = st.log.slice(-40)
            .map(e => `<div class="${e.cls||''}">${e.msg}</div>`).join('');
    $('#log').scrollTop = 1e6;

    // 서술
    $('#nStep').textContent = `${String(st.step).padStart(2,'0')} / ${String(SCENE.length-1).padStart(2,'0')}`;
    $('#btnStep').disabled = st.step >= SCENE.length-1;
  }

  /* --- 조작 버튼 ------------------------------------------------------------
     라벨은 SQL 키워드라 언어를 타지 않는다. HTML 에 그대로 두고 여기서 묶기만 한다. */

  const OPS = {
    begin:  k => opBegin(k),
    select: k => opSelect(k),
    update: k => opWrite(k, 3, 'update'),
    delete: k => opWrite(k, 3, 'delete'),
    commit: k => opCommit(k),
  };

  for (const b of document.querySelectorAll('[data-op]')){
    b.onclick = () => { stop(); OPS[b.dataset.op](b.dataset.session); render(); };
  }

  /* --- 진행 ----------------------------------------------------------------- */

  let playing = false, timer = null;

  function stepOnce(){
    if (st.step >= SCENE.length-1){ stop(); return; }
    st.step++;
    SCENE[st.step].run();
    $('#nText').textContent = NARR[st.step];
    render();
    if (st.step >= SCENE.length-1) stop();
  }

  function play(){
    playing = true;
    $('#btnPlay').textContent = t('pause');
    timer = setInterval(stepOnce, 2600);
  }
  function stop(){
    playing = false;
    clearInterval(timer);
    $('#btnPlay').textContent = t('play');
  }

  $('#btnPlay').onclick   = () => playing ? stop() : play();
  $('#btnStep').onclick   = () => { stop(); stepOnce(); };
  $('#btnVacuum').onclick = () => { stop(); opVacuum(); render(); };
  $('#btnReset').onclick  = () => { stop(); reset(); $('#nText').textContent = t('nIntro'); render(); };

  /* ============================================================================
   * 4. 기동
   * ========================================================================== */

  reset();
  render();
};
