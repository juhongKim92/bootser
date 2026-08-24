/* ============================================================
   연락처 조립 — 수집 봇 대응

   HTML 소스 어디에도 완성된 주소가 없다. 로컬 파트와 도메인을 뒤집어
   따로 담아두고 여기서 합친다. '@' 는 소스에 아예 등장하지 않는다.

     <span data-contact data-u="tcatnoc" data-d="moc.91noilimrev">
       <noscript>...</noscript>
     </span>

   막아주는 것과 못 막는 것을 분명히 해두자면 —
   정규식으로 \w+@\w+ 를 훑는 수집기는 여기서 아무것도 못 가져간다.
   헤드리스 브라우저로 렌더링까지 하는 수집기는 그대로 가져간다.
   그건 이 방식으로 못 막고, 폼이나 별칭 주소로 가야 한다.
   ============================================================ */
'use strict';

(function () {

  const rev = s => s.split('').reverse().join('');

  document.querySelectorAll('[data-contact]').forEach(el => {
    const u = el.getAttribute('data-u');
    const d = el.getAttribute('data-d');
    if (!u || !d) return;

    const addr = rev(u) + String.fromCharCode(64) + rev(d);

    const a = document.createElement('a');
    a.href = String.fromCharCode(109, 97, 105, 108, 116, 111, 58) + addr;   // mailto:
    a.textContent = addr;
    a.rel = 'nofollow';
    el.replaceWith(a);
  });

})();
