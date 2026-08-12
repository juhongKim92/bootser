/* 메인 목록의 주제 그룹 접힘 상태를 기억한다.
   JS 가 없어도 <details open> 이라 전부 펼쳐진 채로 동작한다. */
(function () {
  const KEY = 'bi-groups';
  let st = {};
  try { st = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { /* 사생활 보호 모드 */ }

  document.querySelectorAll('details.group').forEach(d => {
    const g = d.getAttribute('data-g');
    if (st[g] === 0) d.open = false;
    else if (st[g] === 1) d.open = true;
    d.addEventListener('toggle', () => {
      st[g] = d.open ? 1 : 0;
      try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) { /* 저장 못 해도 그만 */ }
    });
  });
})();
