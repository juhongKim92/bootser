'use strict';
/* ============================================================================
 * 03. 컨시스턴트 해싱 — 실험대
 *
 * 문안은 페이지가 window.LAB_I18N 으로 주입한다. 이 파일은 언어를 모른다.
 * ========================================================================== */

(function(){

const I = window.LAB_I18N || {};
const t = (k, ...a) => { let s = I[k] ?? k; a.forEach((v,i)=> s = String(s).replaceAll('$'+(i+1), v)); return s; };
const $ = s => document.querySelector(s);

/* --- 상수 --------------------------------------------------------------- */

const KEYS = 1500;                // 관측할 키 개수.
                                  // 적으면 표본 잡음이 링의 실제 편차를 덮어
                                  // 가상 노드를 늘려도 좋아지는 게 안 보인다.
const RING = 2 ** 32;             // 해시 공간
const MAX_NODES = 8, MIN_NODES = 2;
const NAMES = ['A','B','C','D','E','F','G','H'];

const HUES = {
  light: ['#2f6b4f','#b0392c','#1b4f7a','#a8791a','#6b4a7a','#2a7d84','#8a5a2b','#7a2f52'],
  dark:  ['#5fbf8c','#e2695a','#6aa9dd','#d9a83a','#a98cc4','#5cc0c8','#c99464','#c97a9c'],
};
let palette = HUES.light;
function pickPalette(){
  palette = matchMedia('(prefers-color-scheme: dark)').matches ? HUES.dark : HUES.light;
}
pickPalette();
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { pickPalette(); render(); });

/* --- 해시 ---------------------------------------------------------------- */

/**
 * FNV-1a 32비트 + 최종 믹싱.
 *
 * FNV-1a 만으로는 안 된다. 링 위치는 값의 상위 비트를 쓰는데, 짧고 비슷한
 * 문자열('node-A#0','node-A#1'…)에 대해 FNV-1a 의 상위 비트는 거의 확산되지
 * 않는다. 실제로 지점들이 등차수열처럼 한 자리에 뭉쳐 링이 무용지물이 된다.
 * murmur3 의 fmix32 를 덧붙여 상위 비트까지 흩는다.
 */
function fnv1a(str){
  let h = 0x811c9dc5;
  for (let i=0;i<str.length;i++){
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  // fmix32
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

/* --- 상태 ---------------------------------------------------------------- */

const S = {
  nodes: 6,      // 4개면 CV 를 표본 4개로 재는 셈이라 값이 크게 튄다
  vnodes: 1,
  ringPts: [],      // { pos, node } 정렬됨
  owner: [],        // keyIndex → nodeIndex
  prevOwner: null,
  prevModulo: null,
  lastMove: null,   // { ch, mod, total, label }
};

const keyName = i => 'key-' + i;
const keyHash = [];
for (let i=0;i<KEYS;i++) keyHash.push(fnv1a(keyName(i)));

function buildRing(){
  const pts = [];
  for (let n=0;n<S.nodes;n++){
    for (let v=0;v<S.vnodes;v++){
      pts.push({ pos: fnv1a('node-'+NAMES[n]+'#'+v), node:n });
    }
  }
  pts.sort((a,b)=>a.pos-b.pos);
  S.ringPts = pts;
}

/** 시계 방향으로 첫 번째 지점을 찾는다. */
function lookup(h){
  const p = S.ringPts;
  let lo=0, hi=p.length-1, ans=0;
  if (h > p[hi].pos) return p[0].node;      // 한 바퀴 돌아 처음으로
  while (lo<=hi){
    const m=(lo+hi)>>1;
    if (p[m].pos >= h){ ans=m; hi=m-1; } else lo=m+1;
  }
  return p[ans].node;
}

function assign(){
  const o = new Array(KEYS);
  for (let i=0;i<KEYS;i++) o[i] = lookup(keyHash[i]);
  return o;
}
const assignModulo = n => keyHash.map(h => h % n);

/** 변경 전후를 비교해 이동한 키 수를 센다. */
function commit(label, kind){
  const before = S.owner, beforeMod = S.prevModulo;
  buildRing();
  S.owner = assign();
  const mod = assignModulo(S.nodes);

  if (before && before.length === KEYS && beforeMod){
    let ch=0, mc=0;
    for (let i=0;i<KEYS;i++){
      if (before[i] !== S.owner[i]) ch++;
      if (beforeMod[i] !== mod[i]) mc++;
    }
    S.lastMove = { ch, mod: mc, total: KEYS, label, kind };
  }
  S.prevModulo = mod;
}

function reset(nodes, vnodes){
  S.nodes = nodes; S.vnodes = vnodes;
  S.owner = []; S.prevModulo = null; S.lastMove = null;
  buildRing();
  S.owner = assign();
  S.prevModulo = assignModulo(S.nodes);
}

/* --- 통계 ---------------------------------------------------------------- */

function loads(){
  const c = new Array(S.nodes).fill(0);
  for (const o of S.owner) c[o]++;
  return c;
}
function spread(c){
  const ideal = KEYS/S.nodes;
  const max = Math.max(...c), min = Math.min(...c);
  const mean = c.reduce((a,b)=>a+b,0)/c.length;
  const sd = Math.sqrt(c.reduce((a,b)=>a+(b-mean)**2,0)/c.length);
  return { ideal, max, min, ratio: min>0 ? max/min : Infinity, cv: sd/mean*100 };
}

/* --- 링 그리기 ------------------------------------------------------------ */

const cv = $('#ring');
const cx = cv.getContext('2d');

function sizeCanvas(){
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  const w = cv.clientWidth || 320;
  cv.width = Math.round(w*dpr);
  cv.height = Math.round(w*dpr);
  cv.style.height = w+'px';
  cx.setTransform(dpr,0,0,dpr,0,0);
  return w;
}

function drawRing(){
  const W = sizeCanvas();
  const cxp = W/2, cyp = W/2;
  const R = W*0.34, band = Math.max(9, W*0.045);
  cx.clearRect(0,0,W,W);

  const ang = h => (h/RING)*Math.PI*2 - Math.PI/2;   // 12시 방향에서 시작

  // 소유 구간 — 각 지점부터 다음 지점까지가 그 지점의 몫이다
  const p = S.ringPts;
  cx.lineWidth = band;
  for (let i=0;i<p.length;i++){
    const cur = p[i], nxt = p[(i+1)%p.length];
    let a0 = ang(cur.pos), a1 = ang(nxt.pos);
    if (a1 <= a0) a1 += Math.PI*2;
    cx.beginPath();
    cx.strokeStyle = palette[nxt.node % palette.length];   // 시계방향 다음 노드가 가져간다
    cx.arc(cxp, cyp, R, a0, a1);
    cx.stroke();
  }

  // 가상 노드 눈금
  if (p.length <= 400){
    cx.lineWidth = 1;
    cx.strokeStyle = 'rgba(128,120,136,.55)';
    for (const q of p){
      const a = ang(q.pos);
      cx.beginPath();
      cx.moveTo(cxp+Math.cos(a)*(R-band/2), cyp+Math.sin(a)*(R-band/2));
      cx.lineTo(cxp+Math.cos(a)*(R+band/2), cyp+Math.sin(a)*(R+band/2));
      cx.stroke();
    }
  }

  // 키
  const kr = R + band/2 + Math.max(7, W*0.032);
  for (let i=0;i<KEYS;i++){
    const a = ang(keyHash[i]);
    cx.beginPath();
    cx.arc(cxp+Math.cos(a)*kr, cyp+Math.sin(a)*kr, Math.max(0.9, W*0.0042), 0, Math.PI*2);
    cx.fillStyle = palette[S.owner[i] % palette.length];
    cx.globalAlpha = .7;
    cx.fill();
  }
  cx.globalAlpha = 1;

  // 0 지점 표시
  cx.strokeStyle = 'rgba(128,120,136,.4)';
  cx.lineWidth = 1;
  cx.beginPath();
  cx.moveTo(cxp, cyp - R - band/2 - 2);
  cx.lineTo(cxp, cyp - R + band/2 + 2);
  cx.stroke();
}

/* --- 화면 ---------------------------------------------------------------- */

function render(){
  drawRing();

  const c = loads(), sp = spread(c);
  const scale = Math.max(...c, 1);

  $('#bars').innerHTML = c.map((v,i)=>{
    const w = v/scale*100, idealPct = sp.ideal/scale*100;
    return `<div class="bar">
      <span class="who"><i class="sw" style="background:${palette[i%palette.length]}"></i>${NAMES[i]}</span>
      <span class="track"><span class="fill" style="width:${w}%;background:${palette[i%palette.length]}"></span>
        ${i===0?`<span class="ideal" style="left:${idealPct}%" data-l="${t('ideal')} ${Math.round(sp.ideal)}"></span>`
                :`<span class="ideal" style="left:${idealPct}%"></span>`}</span>
      <span class="val">${v}</span>
    </div>`;
  }).join('');

  const ratioTxt = isFinite(sp.ratio) ? sp.ratio.toFixed(2)+'×' : '∞';
  $('#spread').innerHTML =
    `<div class="${sp.cv>25?'bad':sp.cv<10?'good':''}"><span class="k">${t('sCv')}</span><span class="v">${sp.cv.toFixed(1)}<small> %</small></span></div>` +
    `<div class="${sp.ratio>2?'bad':sp.ratio<1.3?'good':''}"><span class="k">${t('sRatio')}</span><span class="v">${ratioTxt}</span></div>` +
    `<div><span class="k">${t('sMax')}</span><span class="v">${sp.max}</span></div>` +
    `<div><span class="k">${t('sMin')}</span><span class="v">${sp.min}</span></div>`;

  $('#nNodes').textContent = S.nodes;
  $('#vVnodes').innerHTML = `${S.vnodes}<small> ${t('perNode')}</small>`;
  $('#sVnodes').value = S.vnodes;
  $('#btnAdd').disabled = S.nodes >= MAX_NODES;
  $('#btnDel').disabled = S.nodes <= MIN_NODES;

  const hv = $('#hVnodes');
  if (S.vnodes === 1){ hv.textContent = t('hV1'); hv.className='hint warn'; }
  else if (S.vnodes < 40){ hv.textContent = t('hVmid'); hv.className='hint'; }
  else { hv.textContent = t('hVok'); hv.className='hint'; }

  const m = S.lastMove;
  if (!m){
    $('#moved').innerHTML = `<p class="mnote">${t('mIdle')}</p>`;
  } else {
    const pc = v => (v/m.total*100);
    if (m.kind === 'vnode'){
      // 가상 노드 개수 변경은 노드 구성 변경이 아니다. 나머지 연산은 영향을 받지
      // 않으므로 나란히 두면 링이 불리해 보인다. 성격이 다른 변경이라 따로 알린다.
      $('#moved').innerHTML =
        `<div class="mrow"><span class="lbl">${t('mRing')}</span>
          <span class="track"><span class="fill bad" style="width:${pc(m.ch)}%"></span></span>
          <span class="val">${m.ch} / ${m.total} · ${pc(m.ch).toFixed(0)}%</span></div>
         <p class="mnote">${t('mVnodeNote', Math.round(pc(m.ch)))}</p>`;
    } else {
      $('#moved').innerHTML =
        `<div class="mrow"><span class="lbl">${t('mRing')}</span>
          <span class="track"><span class="fill ok" style="width:${pc(m.ch)}%"></span></span>
          <span class="val">${m.ch} / ${m.total} · ${pc(m.ch).toFixed(0)}%</span></div>
         <div class="mrow"><span class="lbl">${t('mMod')}</span>
          <span class="track"><span class="fill bad" style="width:${pc(m.mod)}%"></span></span>
          <span class="val">${m.mod} / ${m.total} · ${pc(m.mod).toFixed(0)}%</span></div>
         <p class="mnote">${t('mNote', m.label, Math.round(pc(m.ch)), Math.round(pc(m.mod)))}</p>`;
    }
  }
}

/* --- 조작 ---------------------------------------------------------------- */

function addNode(){ if (S.nodes>=MAX_NODES) return; S.nodes++; commit(t('actAdd', NAMES[S.nodes-1]), 'node'); render(); }
function delNode(){ if (S.nodes<=MIN_NODES) return; const g=NAMES[S.nodes-1]; S.nodes--; commit(t('actDel', g), 'node'); render(); }
function setVnodes(v){ S.vnodes = v; commit(t('actV', v), 'vnode'); render(); }

$('#btnAdd').onclick = () => { stop(); addNode(); };
$('#btnDel').onclick = () => { stop(); delNode(); };
$('#sVnodes').oninput = e => { stop(); setVnodes(+e.target.value); };

/* --- 시나리오 ------------------------------------------------------------- */

const SCENE = [
  () => reset(6,1),
  () => {},
  () => delNode(),
  () => setVnodes(20),
  () => setVnodes(160),
  () => delNode(),
  () => addNode(),
];

let step = 0, playing = false, timer = null;

let playSpeed = 1;             // 재생 배율

function show(){
  $('#nStep').textContent = `${String(step+1).padStart(2,'0')} / ${String(SCENE.length).padStart(2,'0')}`;
  $('#nText').textContent = (I.scene && I.scene[step]) || '';
  $('#btnStep').disabled = step >= SCENE.length-1;
  $('#btnPrev').disabled = step <= 0;
}
function stepOnce(){
  if (step >= SCENE.length-1){ stop(); return; }
  step++; SCENE[step](); show(); render();
  if (step >= SCENE.length-1) stop();
}
function play(){ playing=true; $('#btnPlay').textContent=t('pause'); timer=setInterval(stepOnce, (3600) / playSpeed); }
function stop(){ playing=false; clearInterval(timer); $('#btnPlay').textContent=t('play'); }

$('#btnPlay').onclick = () => playing?stop():play();
$('#btnStep').onclick = () => { stop(); stepOnce(); };
/* SCENE 이 상태를 누적으로 바꾸므로 되감기는 처음부터 다시 실행한다. */
function goTo(n){
  step = 0; SCENE[0]();
  for (let i = 1; i <= n; i++) SCENE[i]();
  step = n; show(); render();
}
$('#btnPrev').onclick  = () => { stop(); if (step > 0) goTo(step - 1); };
$('#btnPrev').disabled = true;      // 첫 단계에서 시작한다
[...document.querySelectorAll('#segSpeed button')].forEach(b => b.onclick = () => {
  playSpeed = +b.dataset.speed;
  [...document.querySelectorAll('#segSpeed button')]
    .forEach(x => x.setAttribute('aria-pressed', x === b));
  if (playing){ stop(); play(); }   // 돌고 있으면 새 간격으로 다시 건다
});
$('#btnReset').onclick = () => { stop(); step=0; SCENE[0](); show(); render(); };

addEventListener('resize', () => drawRing());

/* --- 기동 ---------------------------------------------------------------- */

reset(6,1);
show();
render();

// 폰트/레이아웃이 자리잡은 뒤 한 번 더
requestAnimationFrame(() => drawRing());

})();
