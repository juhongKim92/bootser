/**
 * 파비콘 원화 — 16×16 픽셀맵 하나가 모든 크기의 유일한 출처다.
 *
 * '.' 타일(잉크) · '#' 본체(종이) · 'o' 오늘 표시(라즈베리)
 *
 * 16 그리드인 이유: 파비콘이 가장 많이 보이는 곳은 브라우저 탭의 16px 이고,
 * 그 크기에서는 픽셀 하나가 곧 그리드 한 칸이다. 여기서 읽히도록 손으로 찍고
 * 48 · 192 는 정수배(3배 · 12배)로만 키운다.
 *
 * 달력으로 읽히게 하는 요소는 넷이고, 하나라도 빠지면 그냥 창틀이 된다 —
 *   1. 위쪽 고리 두 개    달력을 벽에 거는 그것. 이게 없으면 표나 액자로 보인다
 *   2. 머리띠            고리 아래 꽉 찬 한 줄. 날짜칸과 대비를 만든다
 *   3. 날짜 격자          빈칸으로 나뉜 칸들. 메우면 종이 한 장이 된다
 *   4. 라즈베리 한 칸     오늘. 16px 에서 이 사이트가 무엇인지 말하는 유일한 신호다
 */

/* 세 색이 파비콘과 공유 카드의 전부다. **base.css 의 어두운 테마 토큰과 짝이다** —
   TILE=--paper · MARK=--ink · ACCENT=--today. 밝은 쪽 값을 쓰지 않는 이유는
   파비콘이 밝은 탭 바에 놓이기 때문이다: 어두운 타일이어야 실루엣이 산다.

   ⚠ ACCENT 는 사이트의 --today 와 같은 뜻이어야 한다. 2026-09-03 에 팔레트를
   라즈베리로 옮기면서 오렌지(#ff7a18)에서 함께 옮겼다 — 여기만 두고 가면
   파비콘과 카드는 주황인데 화면의 오늘은 라즈베리인 사이트가 된다. */
export const TILE   = '#0d1117';
export const MARK   = '#e9edf3';
export const ACCENT = '#ff5c8a';

export const MAP = [
  '................',
  '................',
  '....#.....#.....',   // 고리 — 달력을 거는 그것
  '....#.....#.....',
  '..############..',   // 머리띠
  '..############..',
  '..#..........#..',
  '..#.##.##.##.#..',   // 날짜 격자
  '..#..........#..',
  '..#.##.oo.##.#..',   // 오늘
  '..#....oo....#..',
  '..#.##.##.##.#..',
  '..#..........#..',
  '..############..',   // 바닥
  '................',
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
  const count = (y, ch) => map[y].split('').filter(c => c === ch).length;

  // 1. 고리 두 개 — 머리띠 위에 떨어져 있고, 사이가 비어야 두 개로 읽힌다
  for (const y of [2, 3]) {
    if (count(y, '#') !== 2) bad.push(`${y}행 고리가 2칸이 아니다`);
    if (map[y].indexOf('#') + 1 === map[y].lastIndexOf('#')) bad.push(`${y}행 고리 둘이 붙어 있다`);
  }

  // 2. 머리띠 — 몸통 맨 위 두 줄이 꽉 차 날짜 칸과 대비를 만든다
  for (const y of [4, 5]) if (count(y, '#') < 12) bad.push(`${y}행 머리띠가 꽉 차지 않았다`);

  // 3. 날짜 격자 — 칸 사이에 빈칸이 남아 있어야 표로 읽힌다. 메우면 종이 한 장이다
  for (const y of [7, 9, 11]) {
    if (!map[y].slice(3, 13).includes('.')) bad.push(`${y}행 날짜 칸이 메워졌다`);
  }
  for (const y of [6, 8, 12]) {
    if (map[y].slice(3, 13).includes('#')) bad.push(`${y}행은 칸 사이 여백인데 채워졌다`);
  }

  // 4. 오늘 — 16px 에서 보이려면 최소 4칸이고, 격자 한가운데여야 한다
  const acc = map.reduce((n, _r, y) => n + count(y, 'o'), 0);
  if (acc < 4) bad.push(`오늘 표시가 ${acc}칸뿐이다 — 16px 에서 안 보인다`);
  if (!map[9].includes('o')) bad.push('오늘 표시가 격자 가운데 줄에 없다');

  // 좌우 테두리가 이어져야 몸통이 닫힌다
  for (let y = 4; y <= 13; y++) {
    if (at(2, y) !== '#' || at(13, y) !== '#') bad.push(`${y}행에서 몸통 테두리가 끊겼다`);
  }

  // 사방 1칸 여백 — 탭 바에서 타일이 잘려 보이지 않게
  for (let i = 0; i < GRID; i++) {
    if (at(i, 0) !== '.' || at(i, GRID - 1) !== '.') bad.push('위아래 여백이 없다');
    if (at(0, i) !== '.' || at(GRID - 1, i) !== '.') bad.push('좌우 여백이 없다');
  }

  return [...new Set(bad)];
}
