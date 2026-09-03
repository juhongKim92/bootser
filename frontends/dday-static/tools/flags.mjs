/* ============================================================
   국기 — 어디서 받고 어디에 두나
   ------------------------------------------------------------
   `gen-flags.mjs` 와 `check-pages.mjs` 가 함께 본다. 받아 오는 쪽과 검사하는
   쪽이 서로 다른 주소를 보면 조용히 어긋나므로 한 군데 적어 둔다.

   ------------------------------------------------------------ 왜 이모지를 버렸나

   여태 국기를 이모지로 찍었다 — 두 글자 국가 코드를 지역 표시 기호로 옮기는
   방식이고, 자산이 0바이트라 값이 공짜였다. **그런데 윈도우에서는 국기로
   그려지지 않는다.** 크롬·엣지 모두 지역 표시 기호 두 개를 한 글리프로 합치지
   않아서 `GH` 라는 두 글자 상자로 보인다. 국내 방문자 대부분이 윈도우다.

   그래서 SVG 를 우리 오리진에 들인다. 글꼴에서 한 것과 같은 판단이다 —
   남의 오리진을 물지 않고, 받은 것을 커밋해 두고, 검사가 무결성을 본다.

   ------------------------------------------------------------ 무게

   204개 · 합계 약 1.1MB · 평균 5.8KB. 국가 페이지는 한 장에 국기 하나지만
   첫 화면(204개)과 이름 축(최대 176개)은 목록이 길다. 그래서 목록의 국기는
   `loading="lazy"` 로 걸어 **화면에 든 것만** 받는다. 처음 보이는 서른 개쯤이면
   170KB 언저리고, 그 뒤로는 CDN 캐시에서 온다.

   ⚠ 이름을 내용 해시로 두지 않았다(`{cc}.svg` 고정). 글꼴과 다른 점이고,
   그래서 `_headers` 의 캐시도 immutable 이 아니라 하루다 — 국기 도안이 바뀌는
   일(2011년 리비아, 2021년 아프가니스탄)이 실제로 있기 때문이다.
   ============================================================ */
import { join } from 'node:path';
import { PUB } from './config.mjs';

/* 판을 박아 둔다. 안 박으면 어느 날 국기 도안이 바뀌어 커밋 diff 가 통째로
   흔들리는데, 그게 우리가 올린 것인지 upstream 이 바꾼 것인지 알 수 없다. */
export const FLAG_PKG = 'flag-icons@7.2.3';

/* 4x3 을 쓴다. 네팔·스위스처럼 비율이 다른 국기까지 4:3 상자에 여백을 넣어
   맞춰 둔 판본이라, 한 크기(20×15)로 늘어놓아도 찌그러지지 않는다. */
export const FLAG_URL = (cc) =>
    `https://cdn.jsdelivr.net/npm/${FLAG_PKG}/flags/4x3/${cc.toLowerCase()}.svg`;
export const FLAG_LICENSE_URL = `https://cdn.jsdelivr.net/npm/${FLAG_PKG}/LICENSE`;

/* 두 글자면 안 된다 — gen-pages 의 청소가 `/^[a-z]{2}$/` 인 디렉터리를 지운다.
   'flags' 는 다섯 글자라 걸리지 않고, gen-flags 가 그것도 확인한다. */
export const FLAG_DIR = 'flags';
export const FLAG_PATH = join(PUB, FLAG_DIR);
export const FLAG_LICENSE = 'LICENSE.txt';

/* 화면에 놓이는 크기. gen-pages · dday.js 가 width/height 로 함께 찍고
   base.css 가 같은 값을 쓴다 — 속성으로 박아 두면 그림이 늦게 와도 줄이 안 밀린다. */
export const FLAG_W = 20;
export const FLAG_H = 15;

/** 국기 하나의 <img>. 목록에서는 lazy, 머리말처럼 첫 화면에 드는 자리는 eager.
    alt 가 빈 문자열인 것은 일부러다 — 바로 옆에 나라 이름이 글자로 있어서
    국기를 다시 읽어 주면 같은 말을 두 번 듣는다. */
export const flagImg = (cc, { eager = false } = {}) =>
    `<img class="flag" src="/${FLAG_DIR}/${String(cc).toLowerCase()}.svg"`
    + ` width="${FLAG_W}" height="${FLAG_H}" alt=""`
    + ` loading="${eager ? 'eager' : 'lazy'}" decoding="async">`;
