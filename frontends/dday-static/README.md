# dday-static — this is the day

204개국 공휴일을 한국어·영어로 보여주는 정적 사이트. **백엔드도 빌드 도구도 의존성도 없다.**
`public/` 을 Cloudflare 에 그대로 얹는다.

`apps/d-day/d-day-service` 와는 별개다. 저쪽은 회원·영화·스포츠까지 다루는 Spring 서비스로
그대로 남아 있고, 여기는 공개 공휴일(`PUBLIC_HOLIDAY`)만 떼어 낸 읽기 전용 사이트다.

## 왜 서버가 없어도 되나

남은 외부 의존이 [Nager.Date](https://date.nager.at/) 하나뿐이고 API 키가 없다.
공휴일은 연 단위로 확정되는 자료라 요청마다 계산할 것이 없다 — 빌드 타임에 받아
JSON 으로 굳히고, 날짜에 따라 달라지는 것(D-day · 오늘 여부)만 브라우저가 계산한다.

| 서버가 하던 일 | 어디로 갔나 |
| --- | --- |
| Nager 호출 → DB 저장 | `tools/gen-holidays.mjs` (빌드 타임) |
| `LocalDate.now(timezone)` | 브라우저 — 기기 날짜 |
| 다음/지난 공휴일 탐색 | 브라우저 — `dday.js` 의 `classify()` |
| Redis 캐시 | Cloudflare CDN |

## 구조

```
tools/                     전부 node 내장 모듈만 쓴다 (npm install 없음)
├── config.mjs             도메인·연도 범위 — 바꿀 게 있으면 여기
├── gen-holidays.mjs       Nager.Date  → public/data/*.json
├── gen-pages.mjs          data        → 한국어·영어 두 벌의 HTML (410개)
├── gen-sitemap.mjs        git 커밋 날짜 → public/sitemap.xml
├── gen-favicon.mjs        favicon-art.mjs → ico · svg · png 넷
├── favicon-art.mjs        16×16 픽셀맵 (모든 크기의 원화)
├── harness.mjs            node:vm DOM·fetch 스텁 — 브라우저 없이 페이지를 돌린다
├── inject-beacon.mjs      Cloudflare 웹 분석 비콘 주입 (빌드 단계)
└── check-pages.mjs        배포 전 검사 410개 페이지

public/
├── index.html             생성물 — 국가 목록 + 감지된 국가 요약 카드 (한국어)
├── {cc}/index.html        생성물 — 국가별 공휴일 (3년치, HTML 에 박혀 있다)
├── en/index.html          생성물 — 영어 첫 화면
├── en/{cc}/index.html     생성물 — 영어 국가 페이지
├── 404.html · en/404.html 생성물 — 언어 칸마다 하나씩
├── data/{CC}.json         생성물 — 국가별 자료 (언어 무관, 한 벌)
├── data/countries.json    생성물 — 선택기용 목록
├── shared/base.css        손으로 쓴 것
├── shared/dday.css        손으로 쓴 것
├── shared/dday.js         손으로 쓴 것 — 두 언어가 같은 파일을 쓴다
├── robots.txt             손으로 쓴 것
└── favicon.*              생성물
```

생성물도 커밋한다. 그래야 (1) Nager 가 죽어도 배포할 수 있고, (2) 이번 달에 어떤
공휴일이 바뀌었는지 git diff 로 보이고, (3) `gen-sitemap.mjs` 가 `lastmod` 를
커밋 날짜에서 뽑을 수 있다.

## 자료 갱신

**순서가 중요하다.**

```bash
cd frontends/dday-static

node tools/gen-holidays.mjs    # 1. Nager 에서 자료를 새로 받는다 (유일한 네트워크 단계)
node tools/gen-pages.mjs       # 2. 자료로 HTML 을 다시 만든다
git add -A && git commit       # 3. lastmod 가 여기서 정해진다
node tools/gen-sitemap.mjs     # 4. sitemap.xml
node tools/check-pages.mjs     # 5. 실패하면 밀지 않는다 (종료 코드 1)
git push                       # 6. 나머지는 Cloudflare 가 한다
```

3번을 건너뛰면 모든 HTML 이 "커밋 안 된 수정본" 으로 판정돼 `lastmod` 가 죄다 오늘이
된다. 구글은 `lastmod` 가 부정확하면 아예 무시하므로 그게 최악이다.

갱신 주기는 **월 1회면 충분하다**. 공휴일은 사실상 연 1회 바뀌고, 3년치(작년·올해·내년)를
담고 있어 연말연시에도 "다음/지난" 이 비지 않는다.

## Cloudflare 프로젝트 설정

Workers Builds 가 push 를 받아 배포한다. 설정 네 칸이 전부인데, **backend-internals
프로젝트 설정을 복사해 오면 둘 다 틀린다** — 실제로 그래서 두 번 깨졌다.

| 칸 | 값 | 틀리면 |
| --- | --- | --- |
| Root directory | `frontends/dday-static` | 저장소 루트가 npm workspace 라 wrangler 가 "run in the root of a workspace" 로 멈춘다 |
| Build command | `node tools/check-pages.mjs && node tools/inject-beacon.mjs` | backend-internals 는 `node inject-beacon.mjs` (루트, tools/ 아님) 라 `MODULE_NOT_FOUND` |
| Deploy command | `npx wrangler deploy` | |
| 환경 변수 | `CF_BEACON_TOKEN` | 없으면 비콘만 안 들어가고 배포는 된다 |

빌드 명령에 검사를 물려 두었으므로 **깨진 페이지는 배포되지 않는다.**
`inject-beacon.mjs` 는 검사 뒤에 와야 한다 — 커밋된 HTML 을 제자리에서 고치기 때문에
먼저 돌리면 410개가 전부 수정본이 된다.

빌드 단계에서는 `gen-holidays` · `gen-pages` 를 돌리지 않는다. 생성물이 이미 커밋돼
있고, 빌드 때마다 Nager 를 204번 치면 자료가 조용히 바뀌어 배포될 수 있다.
자료 갱신은 위 절차대로 손으로 하고 diff 를 보고 넘긴다.

## 두 언어

경로가 곧 언어다 — `/kr/` 은 한국어, `/en/kr/` 은 영어. 페이지마다 canonical(자기 주소)과
hreflang 세 줄(ko · en · x-default→en)이 **양쪽에 똑같이** 들어간다. 한쪽만 있으면
구글은 그 hreflang 을 통째로 버리므로, 짝이 없으면 `gen-sitemap.mjs` 가 멈춘다.

말은 두 군데에 있다.

- **페이지 문안** — `tools/gen-pages.mjs` 의 `L.ko` / `L.en` 표
- **화면에서 바뀌는 문안** — `public/shared/dday.js` 의 `STR.ko` / `STR.en` 표

`dday.js` 는 한 파일로 두 언어를 다 쓴다. 갈림길은 `<html lang>` 하나뿐이라
한쪽만 고쳐지는 일이 없다. 자료(`data/*.json`)도 한 벌이고, 국가 이름은 한글·영어를
같이 담아 두었다 — 그래서 영어 화면에서도 "대한" 으로 검색된다.

국가 목록 정렬은 **보이는 이름** 기준이다. `countries.json` 은 한글 이름순으로
저장돼 있어서, 영어 화면에서 그대로 쓰면 Ghana(가나)가 맨 앞에 오는 무작위 순서가 된다.

## 검사

`tools/check-pages.mjs` 가 410개 페이지를 브라우저 없이 돌려 본다.
jsdom 을 쓰지 않는다 — `node:vm` + 최소 DOM·fetch 스텁이면 충분하고, 의존성이 늘지 않는다.

보는 것:

1. 페이지가 예외 없이 구동되고 `window.DDAY` 손잡이가 나오나
2. `dday.js` 가 찾는 `#picker` · `#now` · `#next` · `#prev` 가 HTML 에 있나
3. 주요 태그가 짝이 맞나
4. canonical(자기 주소) · hreflang 3줄 · title · description · 파비콘 4줄 · 자산 링크
   (파비콘은 파일을 열어 정사각 + 48 의 배수인지 본다 — 구글 검색결과 아이콘 조건)
5. HTML 표의 날짜 집합이 `data/<CC>.json` 과 정확히 같나
6. 고정 날짜(`2026-06-15`)를 넣고 `classify()` 가 낸 다음/지난/오늘이
   검사기가 따로 계산한 값과 같나. 이어서 실제로 그려진 오늘 카드 문안까지 견준다
7. `countries.json` · 페이지 디렉터리 · 양쪽 첫 화면 링크가 1:1 인가,
   목록이 보이는 이름순인가
8. `sitemap.xml` 의 URL 집합이 페이지 집합과 같고 hreflang 이 url 마다 세 줄인가
9. 브라우저 지역 감지가 기대대로 갈리나 (`ko-KR`→KR, `en-US`→US, `ko`→KR, 모르는 지역→null)
10. ko / en 이 짝으로 있고 수가 같나
11. 영어 페이지에 한국어가 남아 있지 않나 (공휴일 이름처럼 자료에서 오는 자리는 뺀다)
12. `robots.txt` 의 Sitemap 줄이 `BASE` 와 같나, CSS 계약(스크롤 목록·오늘 강조·
    어두운 테마·좁은 화면)이 살아 있나, 404 가 언어 칸마다 있고 noindex 인가

## 알려진 제약

- **D-day 는 보는 사람의 기기 날짜로 계산한다.** 다른 시간대의 국가를 볼 때는 하루
  어긋날 수 있다. 국가별 대표 시간대를 담으면 고칠 수 있지만, 그러려면 CLDR
  territory→timezone 표를 들여와야 해서 지금은 각주로만 적어 두었다.
- **`types` 가 `Public` 인 항목만 담는다.** Nager 의 `Bank` · `Observance` ·
  `Optional` · `School` · `Authorities` 는 뺐다. 그래서 미국의 Lincoln's Birthday 는
  없다.
- **지역 한정 공휴일은 넣되 표시한다.** `global: false` 인 항목(미국 Good Friday 처럼
  일부 주만 쉬는 날)도 목록에 넣고, "일부 지역 N곳" 배지와 지역 코드를 함께 적는다.
  오늘이 그런 날뿐이면 카드도 "일부 지역만 쉽니다" 로 바뀐다.
