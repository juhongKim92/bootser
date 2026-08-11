'use strict';
/* ============================================================================
 * 04. Raft 리더 선출 — 실험대
 *
 * 문안은 페이지가 window.LAB_I18N 으로 주입한다. 이 파일은 언어를 모른다.
 * 아래 [SIM] 구역은 DOM 을 전혀 건드리지 않는다. 그대로 떼어 검증할 수 있다.
 * ========================================================================== */

(function(){

/* ==== [SIM] 시작 — DOM 없음 ============================================== */

const T = {
  heartbeat: 300,      // 리더가 하트비트를 보내는 주기 (ms)
  eMin: 1200,          // 선거 타임아웃 하한
  eMax: 2400,          // 선거 타임아웃 상한 — 무작위라서 동시 출마가 잘 갈린다
  delay: 60,           // 메시지 전달 지연
};

/** 재현 가능한 난수. 같은 씨앗이면 같은 시나리오가 나온다. */
function makeRng(seed){
  let s = seed >>> 0;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;  s >>>= 0;
    return s / 4294967296;
  };
}

function createCluster(n, seed){
  const rng = makeRng(seed || 12345);
  const C = { n, rng, t:0, msgs:[], nodes:[], events:[], elections:0 };
  for (let i=0;i<n;i++){
    C.nodes.push({
      id:i, alive:true, group:0,
      term:0, state:'follower', votedFor:null,
      timer: T.eMin + rng()*(T.eMax-T.eMin),
      hb:0, votes:new Set(),
      acks:new Set(), qTimer:0,      // CheckQuorum 용
    });
  }
  return C;
}

const majority = C => Math.floor(C.n/2) + 1;
const reachable = (C,a,b) => C.nodes[a].alive && C.nodes[b].alive && C.nodes[a].group === C.nodes[b].group;
const resetTimer = (C,nd) => { nd.timer = T.eMin + C.rng()*(T.eMax-T.eMin); };

/**
 * 사건 하나를 남긴다. 여기서는 문안을 만들지 않는다.
 * 키와 인자만 저장해두고 그리는 쪽에서 그 페이지의 언어로 번역한다.
 * 이 구역이 언어를 모르도록 유지하는 장치다.
 */
function log(C, kind, key, ...args){
  C.events.push({ t: C.t, kind, key, args });
  if (C.events.length > 200) C.events.shift();
}

function send(C, from, to, type, term){
  if (!reachable(C, from, to)) return;              // 분단된 상대에게는 닿지 않는다
  C.msgs.push({ from, to, type, term, ttl: T.delay, total: T.delay });
}

function becomeCandidate(C, nd){
  nd.state = 'candidate';
  nd.term += 1;
  nd.votedFor = nd.id;
  nd.votes = new Set([nd.id]);
  resetTimer(C, nd);
  C.elections += 1;
  log(C, 'cand', 'evCand', nd.id, nd.term);
  for (let j=0;j<C.n;j++) if (j !== nd.id) send(C, nd.id, j, 'vote-req', nd.term);
  // 단일 노드 클러스터가 아니어도 과반이 1이면 즉시 당선
  if (nd.votes.size >= majority(C)) becomeLeader(C, nd);
}

function becomeLeader(C, nd){
  nd.state = 'leader';
  nd.hb = 0;
  nd.acks = new Set();
  nd.qTimer = T.eMax;
  log(C, 'lead', 'evLead', nd.id, nd.term, nd.votes.size);
}

/** whyKey 는 사임 사유를 담은 문안 키다. 문장 자체는 페이지가 갖고 있다. */
function stepDown(C, nd, term, whyKey){
  if (nd.state === 'leader') log(C, 'down', whyKey, nd.id, nd.term, term);
  nd.state = 'follower';
  nd.term = term;
  nd.votedFor = null;
  nd.votes = new Set();
}

function deliver(C, m){
  const nd = C.nodes[m.to];
  if (!nd.alive) return;
  if (!reachable(C, m.from, m.to)) return;          // 이동 중에 분단이 생겼다면 버린다

  // 더 높은 term 을 보면 무조건 물러난다. Raft 전체를 관통하는 규칙이다.
  if (m.term > nd.term) stepDown(C, nd, m.term, 'evDownHigherTerm');

  if (m.type === 'vote-req'){
    const ok = m.term === nd.term && (nd.votedFor === null || nd.votedFor === m.from);
    if (ok){
      nd.votedFor = m.from;
      resetTimer(C, nd);
      send(C, nd.id, m.from, 'vote-ok', nd.term);
    }
  } else if (m.type === 'vote-ok'){
    if (nd.state === 'candidate' && m.term === nd.term){
      nd.votes.add(m.from);
      if (nd.votes.size >= majority(C)) becomeLeader(C, nd);
    }
  } else if (m.type === 'hb'){
    if (m.term >= nd.term){
      if (nd.state !== 'follower') stepDown(C, nd, m.term, 'evDownHeartbeat');
      nd.term = m.term;
      resetTimer(C, nd);
      send(C, nd.id, m.from, 'hb-ok', nd.term);
    }
  } else if (m.type === 'hb-ok'){
    if (nd.state === 'leader' && m.term === nd.term) nd.acks.add(m.from);
  }
}

function stepSim(C, dt){
  C.t += dt;

  // 메시지 이동
  const keep = [];
  for (const m of C.msgs){
    m.ttl -= dt;
    if (m.ttl <= 0) deliver(C, m); else keep.push(m);
  }
  C.msgs = keep;

  for (const nd of C.nodes){
    if (!nd.alive) continue;

    if (nd.state === 'leader'){
      nd.hb -= dt;
      if (nd.hb <= 0){
        nd.hb = T.heartbeat;
        for (let j=0;j<C.n;j++) if (j !== nd.id) send(C, nd.id, j, 'hb', nd.term);
      }
      // CheckQuorum: 한 선거 주기 동안 과반의 응답을 못 받았으면 리더 자격을 내려놓는다.
      // 논문의 기본 Raft 에는 없다. 이게 없으면 분단된 옛 리더가 자기가 아직
      // 리더라고 믿은 채 남는다(커밋은 못 한다). etcd 등 실제 구현이 쓰는 방식이다.
      nd.qTimer -= dt;
      if (nd.qTimer <= 0){
        if (nd.acks.size + 1 < majority(C)){
          log(C, 'down', 'evDownQuorum', nd.id, nd.acks.size+1, C.n);
          nd.state = 'follower'; nd.votedFor = null; nd.votes = new Set();
          resetTimer(C, nd);
        } else {
          nd.acks = new Set();
          nd.qTimer = T.eMax;
        }
      }
    } else {
      // 팔로워도 후보도 타임아웃이 되면 (다시) 출마한다
      nd.timer -= dt;
      if (nd.timer <= 0) becomeCandidate(C, nd);
    }
  }
}

/* --- 관측 --------------------------------------------------------------- */

function groups(C){
  const g = new Map();
  for (const nd of C.nodes){
    if (!nd.alive) continue;
    if (!g.has(nd.group)) g.set(nd.group, []);
    g.get(nd.group).push(nd);
  }
  return g;
}

function campStats(C){
  const out = [];
  for (const [gid, list] of groups(C)){
    const leader = list.find(x => x.state === 'leader');
    out.push({
      gid, size: list.length, need: majority(C),
      hasQuorum: list.length >= majority(C),
      leader: leader ? leader.id : null,
      maxTerm: Math.max(...list.map(x => x.term)),
      ids: list.map(x => x.id),
    });
  }
  out.sort((a,b)=>a.gid-b.gid);
  return out;
}

const leaders = C => C.nodes.filter(x => x.alive && x.state === 'leader');
const maxTerm = C => Math.max(0, ...C.nodes.map(x => x.term));

/* ==== [SIM] 끝 =========================================================== */

if (typeof document === 'undefined') return;   // 검증용으로 코어만 불러올 때

const I = window.LAB_I18N || {};
const t = (k, ...a) => { let s = I[k] ?? k; a.forEach((v,i)=> s = String(s).replaceAll('$'+(i+1), v)); return s; };
const $ = s => document.querySelector(s);

/* --- 색 ------------------------------------------------------------------ */

const HUE = {
  light:{ leader:'#2f6b4f', cand:'#a8791a', follower:'#5b6470', down:'#b9b2a6',
          edge:'rgba(120,112,128,.28)', msg:'#1b4f7a', ink:'#1b1917', paper:'#f5f2ec' },
  dark: { leader:'#5fbf8c', cand:'#d9a83a', follower:'#8f99a8', down:'#4a4550',
          edge:'rgba(160,152,170,.24)', msg:'#6aa9dd', ink:'#ece7dd', paper:'#17161a' },
};
let C_ = HUE.light;
const setHue = () => { C_ = matchMedia('(prefers-color-scheme: dark)').matches ? HUE.dark : HUE.light; };
setHue();
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { setHue(); draw(); });

/* --- 상태 ---------------------------------------------------------------- */

let C = createCluster(5, 20260811);
let cut = 0;              // 소수파(그룹 1)에 넣을 노드 수
let running = true;
let speed = 1;
let last = 0;

function applyCut(){
  for (let i=0;i<C.n;i++) C.nodes[i].group = (i >= C.n - cut) ? 1 : 0;
}
function rebuild(n){
  C = createCluster(n, 20260811);
  cut = 0; applyCut();
}

/* --- 그리기 --------------------------------------------------------------- */

const cv = $('#board');
const cx = cv.getContext('2d');

function layout(){
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  const w = cv.clientWidth || 420;
  const h = Math.round(w * 0.72);
  cv.width = Math.round(w*dpr); cv.height = Math.round(h*dpr);
  cv.style.height = h+'px';
  cx.setTransform(dpr,0,0,dpr,0,0);
  return { w, h };
}

function nodePos(i, w, h){
  const R = Math.min(w, h)*0.36;
  const a = -Math.PI/2 + i/C.n*Math.PI*2;
  return { x: w/2 + Math.cos(a)*R, y: h/2 + Math.sin(a)*R, r: Math.max(17, Math.min(w,h)*0.058) };
}

function draw(){
  const { w, h } = layout();
  cx.clearRect(0,0,w,h);
  const pos = [];
  for (let i=0;i<C.n;i++) pos.push(nodePos(i,w,h));

  // 같은 진영끼리만 선을 잇는다 — 분단이 그래프로 드러난다
  cx.lineWidth = 1;
  cx.strokeStyle = C_.edge;
  for (let i=0;i<C.n;i++) for (let j=i+1;j<C.n;j++){
    if (C.nodes[i].group !== C.nodes[j].group) continue;
    if (!C.nodes[i].alive || !C.nodes[j].alive) continue;
    cx.beginPath(); cx.moveTo(pos[i].x,pos[i].y); cx.lineTo(pos[j].x,pos[j].y); cx.stroke();
  }

  // 이동 중인 메시지
  for (const m of C.msgs){
    const p = 1 - m.ttl/m.total;
    const a = pos[m.from], b = pos[m.to];
    const x = a.x + (b.x-a.x)*p, y = a.y + (b.y-a.y)*p;
    cx.beginPath();
    cx.arc(x, y, m.type==='hb' ? 2.4 : 3.4, 0, Math.PI*2);
    cx.fillStyle = m.type==='hb' ? C_.follower : m.type==='vote-req' ? C_.cand : C_.leader;
    cx.globalAlpha = .85; cx.fill(); cx.globalAlpha = 1;
  }

  // 노드
  for (let i=0;i<C.n;i++){
    const nd = C.nodes[i], p = pos[i];
    const col = !nd.alive ? C_.down : nd.state==='leader' ? C_.leader : nd.state==='candidate' ? C_.cand : C_.follower;

    // 선거 타이머 — 언제 출마할지가 보인다
    if (nd.alive && nd.state !== 'leader'){
      const frac = Math.max(0, Math.min(1, 1 - nd.timer/T.eMax));
      cx.beginPath();
      cx.arc(p.x, p.y, p.r+5, -Math.PI/2, -Math.PI/2 + frac*Math.PI*2);
      cx.strokeStyle = col; cx.globalAlpha = .35; cx.lineWidth = 2.5; cx.stroke();
      cx.globalAlpha = 1;
    }

    cx.beginPath(); cx.arc(p.x, p.y, p.r, 0, Math.PI*2);
    cx.fillStyle = nd.alive && nd.state==='leader' ? col : C_.paper;
    cx.fill();
    cx.lineWidth = nd.state==='leader' ? 3 : 2;
    cx.strokeStyle = col;
    if (!nd.alive) cx.setLineDash([3,3]);
    cx.stroke();
    cx.setLineDash([]);

    cx.textAlign='center'; cx.textBaseline='middle';
    cx.fillStyle = (nd.alive && nd.state==='leader') ? C_.paper : col;
    cx.font = `500 ${Math.round(p.r*0.78)}px ui-monospace, monospace`;
    cx.fillText('N'+i, p.x, p.y);

    cx.fillStyle = C_.follower;
    cx.font = `400 ${Math.round(p.r*0.5)}px ui-monospace, monospace`;
    cx.fillText('t'+nd.term, p.x, p.y + p.r + 12);
  }
}

/* --- 화면 갱신 ------------------------------------------------------------ */

function paint(){
  const camps = campStats(C);
  const lead = leaders(C);

  $('#camps').innerHTML = camps.map(c => {
    const cls = c.hasQuorum ? 'win' : 'lose';
    const name = camps.length === 1 ? t('campAll') : t('campN', c.gid===0 ? 'A' : 'B');
    return `<div class="camp ${cls}">
      <h4><span>${name}</span><span>N${c.ids.join(' N')}</span></h4>
      <div class="quorum">${c.size}<small> / ${C.n}</small>
        <small style="margin-left:8px">${t('need')} ${c.need}</small></div>
      <div class="verdict">${c.hasQuorum ? t('vQuorum') : t('vNoQuorum')}</div>
      <div class="who">${c.leader!==null ? t('wLeader', 'N'+c.leader) : t('wNoLeader')} · term ${c.maxTerm}</div>
    </div>`;
  }).join('') || `<div class="camp lose"><h4><span>${t('campAll')}</span></h4>
      <div class="verdict">${t('allDown')}</div></div>`;

  $('#readouts').innerHTML =
    `<div class="${lead.length!==1?'bad':''}"><span class="k">${t('rLeaders')}</span><span class="v">${lead.length}</span></div>` +
    `<div><span class="k">${t('rTerm')}</span><span class="v">${maxTerm(C)}</span></div>` +
    `<div><span class="k">${t('rElections')}</span><span class="v">${C.elections}</span></div>` +
    `<div><span class="k">${t('rTime')}</span><span class="v">${(C.t/1000).toFixed(1)}<small> s</small></span></div>`;

  $('#events').innerHTML = C.events.slice(-30).map(e =>
    `<div><span class="t">${(e.t/1000).toFixed(1)}s</span>  <span class="${e.kind==='lead'?'up':e.kind==='down'?'down':''}">${t(e.key, ...e.args)}</span></div>`
  ).join('');
  $('#events').scrollTop = 1e6;

  $('#cutN').textContent = cut === 0 ? t('cutNone') : `${C.n-cut} : ${cut}`;
  $('#cutMore').disabled = cut >= Math.floor(C.n/2);
  $('#cutLess').disabled = cut <= 0;
  for (const b of document.querySelectorAll('[data-n]'))
    b.setAttribute('aria-pressed', String(+b.dataset.n === C.n));
  $('#btnRun').textContent = running ? t('pause') : t('resume');
}

/* --- 순환 ---------------------------------------------------------------- */

function frame(ts){
  if (!last) last = ts;
  const dt = Math.min(80, ts - last) * speed;
  last = ts;
  if (running) stepSim(C, dt);
  draw();
  paint();
  requestAnimationFrame(frame);
}

/* --- 조작 ---------------------------------------------------------------- */

cv.addEventListener('click', e => {
  const r = cv.getBoundingClientRect();
  const x = e.clientX - r.left, y = e.clientY - r.top;
  const w = r.width, h = r.height;
  for (let i=0;i<C.n;i++){
    const p = nodePos(i,w,h);
    if ((x-p.x)**2 + (y-p.y)**2 <= (p.r+6)**2){
      const nd = C.nodes[i];
      nd.alive = !nd.alive;
      if (!nd.alive){
        log(C,'down','evNodeDown', i);
        nd.state='follower'; nd.votes=new Set(); nd.votedFor=null;
      } else {
        log(C,'up','evNodeUp', i);
        resetTimer(C, nd);
      }
      return;
    }
  }
});

$('#cutMore').onclick = () => { if (cut < Math.floor(C.n/2)) { cut++; applyCut(); log(C,'down','logCut', C.n-cut, cut); } };
$('#cutLess').onclick = () => { if (cut > 0) { cut--; applyCut(); cut===0 ? log(C,'up','logHeal') : log(C,'up','logCut', C.n-cut, cut); } };
$('#btnRun').onclick = () => { running = !running; };
for (const b of document.querySelectorAll('[data-n]')) b.onclick = () => { stop(); rebuild(+b.dataset.n); };

/* --- 시나리오 ------------------------------------------------------------- */

const SCENE = [
  () => { rebuild(5); },
  () => { const l = leaders(C)[0]; if (l){ l.alive=false; log(C,'down','evNodeDown', l.id); } },
  () => { cut = 2; applyCut(); for (const nd of C.nodes) if(!nd.alive){ nd.alive=true; resetTimer(C,nd); } log(C,'down','logCut',3,2); },
  () => {},
  () => { cut = 0; applyCut(); log(C,'up','logHeal'); },
  () => { rebuild(5); for (let i=2;i<5;i++){ C.nodes[i].alive=false; } log(C,'down','logKill3'); },
];

let step = 0, playing = false, timer = null;
function show(){
  $('#nStep').textContent = `${String(step+1).padStart(2,'0')} / ${String(SCENE.length).padStart(2,'0')}`;
  $('#nText').textContent = (I.scene && I.scene[step]) || '';
  $('#btnStep').disabled = step >= SCENE.length-1;
}
function stepOnce(){
  if (step >= SCENE.length-1){ stop(); return; }
  step++; SCENE[step](); show();
  if (step >= SCENE.length-1) stop();
}
function play(){ playing=true; $('#btnPlay').textContent=t('scPause'); timer=setInterval(stepOnce, 7000); }
function stop(){ playing=false; clearInterval(timer); $('#btnPlay').textContent=t('play'); }

$('#btnPlay').onclick = () => playing?stop():play();
$('#btnStep').onclick = () => { stop(); stepOnce(); };
$('#btnReset').onclick = () => { stop(); step=0; SCENE[0](); show(); };

addEventListener('resize', draw);

/* --- 기동 ---------------------------------------------------------------- */

show();
requestAnimationFrame(frame);

})();
