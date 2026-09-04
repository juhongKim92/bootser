/* dday-static 의 단일 설정점.
   도메인이 바뀌면 여기만 고친다 — gen-pages · gen-sitemap · check-pages 가 모두 이걸 읽는다. */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export const BASE = 'https://this-is-the.day';

export const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(HERE, '..');
export const PUB = join(ROOT, 'public');
export const DATA = join(PUB, 'data');

/* Nager.Date 는 무키 공개 API 다. 키도 쿼터도 없지만 204개국 × 3년이라
   예의상 동시 요청을 묶어서 보낸다. */
export const NAGER = 'https://date.nager.at/api/v3';
export const CONCURRENCY = 6;

/* 왜 3년인가 —
   올해만 담으면 12월 말에 "다음 공휴일" 이 비고, 1월 초에 "지난 공휴일" 이 빈다.
   앞뒤로 한 해씩 두면 어느 날짜에 열어도 양쪽이 채워진다. */
export const YEARS = (now = new Date()) => {
    const y = now.getUTCFullYear();
    return [y - 1, y, y + 1];
};

/* 국가가 아닌 페이지의 슬러그.
   여기까지는 "첫 화면 아니면 전부 국가 페이지" 라는 가정으로 굴러왔는데, 하늘 페이지가
   그 가정을 깬다. 한 군데 적어 두고 gen-pages · gen-sitemap · check-pages 가 같이 본다.

   두 글자가 아니어야 한다 — 국가 코드(ISO 3166-1 alpha-2)와 부딪히면 국가 페이지를
   조용히 덮어쓴다. gen-pages 가 그것도 확인한다.

   하늘은 다시 갈래 넷으로 갈렸다 — 절기·삭망·유성우·음력. 176건을 한 URL 에 몰아 두면 어느 검색어에도
   정확히 대응하지 못한다 — 유성우는 8월·12월에, 절기는 입춘·동지에 수요가 몰리는데
   그 어느 것도 "절기와 삭망" 한 장으로는 받지 못했다. /sky/ 는 허브로 남고 표는
   갈래로 내려갔다. 중첩 슬러그라 EXTRA 항목에 '/' 가 들어간다 — 아래 청소는
   맨 앞 'sky' 로 걸려 하위까지 통째로 지우므로 그대로 맞는다.

   'holiday' 와 'rank' 는 뒤에 붙은 축 둘이다.
     · /holiday/           이름 축의 허브 (어떤 이름을 몇 나라가 쓰나)
     · /holiday/{slug}/    이름 하나 (tools/holiday-names.mjs 가 정한다 — 아래 NAME_PAGE)
     · /rank/              국가끼리 견주는 한 장 (공휴일 수 · 최장 연휴)
     · /weekday/           같은 축의 둘째 장 — 공휴일을 **요일**로 다시 묶는다.
                           자료를 하나도 더 만들지 않는다(이름 축과 같은 방식)이고,
                           축 탭은 새로 늘리지 않고 'rank' 를 잡는다 —
                           /sky/term/ 이나 /holiday/{이름}/ 이 쓰는 그 관례다 */
export const EXTRA = ['sky', 'sky/term', 'sky/moon', 'sky/meteor', 'sky/lunar',
    'sky/calendar', 'holiday', 'rank', 'weekday'];

/* 이름 축의 낱장. **EXTRA 에 손으로 적지 않는다** — 몇 장이 될지는 자료가 정하고
   (문턱을 넘는 이름의 수) 달마다 늘거나 줄 수 있다. 손으로 적어 두면 자료가
   바뀔 때 조용히 어긋난다.

   'holiday' 뿌리는 EXTRA 에 있으므로 gen-pages 의 청소가 하위까지 통째로 지운다.
   슬러그 모양이 두 글자가 될 수 없게 최소 세 글자로 못박는다 — 국가 코드와
   부딪히면 국가 페이지를 조용히 덮어쓴다. */
export const NAME_PAGE = /^holiday\/[a-z0-9][a-z0-9-]{2,}$/;

/* 슬러그 → 페이지 갈래. gen-pages · gen-card · check-pages 가 같이 본다.
   경로 규칙은 의견이 아니라 규칙이라 한 군데 두는 것이 맞다 — 기대값(문안·숫자)을
   나눠 쓰지 않는 것과는 다른 이야기다. */
export const kindOf = (slug) =>
    slug === '' ? 'home'
        : NAME_PAGE.test(slug) ? 'name'
            : EXTRA.includes(slug) ? slug
                : 'country';

/* 'Public' 만 남긴다. Nager 의 types 에는 Bank · Observance · Optional · School ·
   Authorities 가 섞여 있는데, 그건 공휴일이 아니라 관습일이거나 일부 직군만 쉬는 날이다.
   (미국 Lincoln's Birthday 가 Observance 로 들어온다) */
export const isPublic = (h) => Array.isArray(h.types) && h.types.includes('Public');

/* 오늘 날짜(로컬). toISOString() 은 UTC 라 KST 새벽에는 하루 전으로 찍힌다 —
   git 의 --date=short 는 로컬 기준이므로 sitemap 의 lastmod 가 어긋나 버린다. */
export const today = (d = new Date()) =>
    d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0');
