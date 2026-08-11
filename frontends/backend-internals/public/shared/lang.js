/* ============================================================
   언어 선택을 페이지 사이에서 공유한다.

   저장소를 못 쓰는 환경(시크릿 모드, 일부 내장 브라우저)에서도
   깨지지 않도록 메모리로 떨어진다. 첫 방문은 브라우저 언어를 따른다.
   ============================================================ */
window.Lang = (function(){
  const KEY = 'bi.lang';
  let mem = null;

  function read(){
    try { return localStorage.getItem(KEY); } catch(_) { return mem; }
  }
  function write(v){
    try { localStorage.setItem(KEY, v); } catch(_) { mem = v; }
  }
  function detect(){
    const n = (navigator.language || navigator.userLanguage || '').toLowerCase();
    return n.startsWith('ko') ? 'ko' : 'en';
  }

  return {
    get(){
      const v = read();
      return (v === 'ko' || v === 'en') ? v : detect();
    },
    set(v){
      if (v === 'ko' || v === 'en') write(v);
    },
    /** 'ko' ↔ 'en' 을 뒤집어 저장하고 새 값을 돌려준다 */
    toggle(cur){
      const next = cur === 'ko' ? 'en' : 'ko';
      write(next);
      return next;
    },
  };
})();
