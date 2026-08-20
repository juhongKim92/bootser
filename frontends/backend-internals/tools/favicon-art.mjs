/**
 * 파비콘 원화 — 16×16 픽셀맵 하나가 모든 크기의 유일한 출처다.
 *
 * '.' 타일(잉크) · '#' 본체(종이) · 'o' 접안렌즈(오렌지)
 *
 * 16 그리드인 이유: 파비콘이 가장 많이 보이는 곳은 브라우저 탭의 16px 이고,
 * 그 크기에서는 픽셀 하나가 곧 그리드 한 칸이다. 여기서 읽히도록 손으로 찍고
 * 48 · 192 는 정수배(3배 · 12배)로만 키운다. 그래서 어느 크기에서도
 * 안티에일리어싱이 끼지 않고, 큰 크기에서만 멀쩡한 도안이 나올 수 없다.
 *
 * 현미경으로 읽히게 하는 요소는 넷이고, 하나라도 빠지면 램프나 트로피가 된다 —
 *   1. 기울어진 경통      곧게 세우면 소화전처럼 보인다
 *   2. 오른쪽 암          경통 위에서 이어져 받침까지 내려온다
 *   3. 대물렌즈 아래 빈칸  슬라이드가 들어가는 자리다. 스테이지에 붙이면 뭉친다
 *   4. 넓은 받침          맨 아래에서 실루엣을 잡아준다
 */

export const TILE   = '#17161a';  // 라이트/다크 무관 고정. 아래 주석 참고
export const MARK   = '#ece7dd';
export const ACCENT = '#ff7a18';

/* 타일을 종이색이 아니라 잉크로 고정하는 이유 —
   ① 종이색이면 밝은 탭 바에 녹아 실루엣이 사라진다
   ② SVG 의 prefers-color-scheme 는 OS 테마를 따라가는데 탭 바 색은 브라우저
      테마라 둘이 어긋난다
   ③ .ico 는 애초에 한 모습으로 고정이라 SVG 만 테마를 따라가면 서로 달라 보인다 */

export const MAP = [
  '................',
  '.....ooo........',   // 접안렌즈
  '.....ooo........',
  '.....###........',
  '....#########...',   // 경통 위에서 암으로 이어진다
  '....###...###...',
  '...###....###...',   // 경통이 왼쪽 아래로 기운다
  '..###.....###...',
  '..##......###...',   // 대물렌즈
  '..........###...',   // 슬라이드 자리 — 여기를 메우면 현미경으로 안 읽힌다
  '.############...',   // 스테이지
  '..........###...',
  '..........###...',
  '.##############.',   // 받침
  '.##############.',
  '................',
];

export const GRID = 16;

export const COLOR = { '.': TILE, '#': MARK, o: ACCENT };

/** 픽셀맵이 성립하는지 — 크기, 알 수 없는 문자, 그리고 위 네 요소가 살아 있는지. */
export function validate(map = MAP) {
  const bad = [];
  if (map.length !== GRID) bad.push(`행이 ${map.length}개다 (${GRID}이어야 한다)`);
  map.forEach((row, y) => {
    if (row.length !== GRID) bad.push(`${y}행 길이가 ${row.length}이다`);
    for (const ch of row) if (!(ch in COLOR)) bad.push(`${y}행에 알 수 없는 문자 '${ch}'`);
  });
  if (bad.length) return bad;

  const at = (x, y) => map[y][x];
  const rowHas = (y, ch) => map[y].includes(ch);

  // 1. 기울어진 경통 — 경통 왼쪽 끝이 아래로 갈수록 왼쪽으로 간다
  const leftEdge = (y) => map[y].indexOf('#');
  const tube = [5, 6, 7, 8].map(leftEdge);
  if (!tube.every((v, i) => i === 0 || v <= tube[i - 1])) bad.push('경통이 왼쪽으로 기울지 않는다');
  if (tube[0] - tube[tube.length - 1] < 2) bad.push('경통 기울기가 2칸 미만이라 곧게 보인다');

  // 2. 오른쪽 암 — 경통 상단(4행)부터 받침 직전까지 끊기지 않는다
  for (let y = 4; y <= 12; y++) {
    if (!(at(13, y) === '#' || at(12, y) === '#')) bad.push(`${y}행에서 암이 끊겼다`);
  }

  // 3. 대물렌즈 아래 빈칸 — 9행 왼쪽(스테이지 위)이 비어 있어야 한다
  if (map[9].slice(0, 9).includes('#')) bad.push('대물렌즈와 스테이지 사이 슬라이드 자리가 메워졌다');

  // 4. 받침이 스테이지보다 넓다
  const width = (y, ch = '#') => map[y].split('').filter((c) => c === ch).length;
  if (width(13) <= width(10)) bad.push('받침이 스테이지보다 넓지 않다');

  // 접안렌즈가 경통 맨 위에 있고 2칸 이상이다
  const acc = map.reduce((n, r) => n + (r.split('').filter((c) => c === 'o').length), 0);
  if (acc < 6) bad.push(`접안렌즈 픽셀이 ${acc}개뿐이다 — 16px 에서 안 보인다`);
  if (!rowHas(1, 'o')) bad.push('접안렌즈가 맨 위에 없다');

  // 사방 1칸 여백 — 탭 바에서 타일이 잘려 보이지 않게
  for (let i = 0; i < GRID; i++) {
    if (at(i, 0) !== '.' || at(i, GRID - 1) !== '.') bad.push('위아래 여백이 없다');
    if (at(0, i) !== '.' || at(GRID - 1, i) !== '.') bad.push('좌우 여백이 없다');
  }

  return [...new Set(bad)];
}
