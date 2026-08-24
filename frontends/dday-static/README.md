# dday-static — 오늘 뭐 쉬나

204개국 공휴일을 보여주는 정적 사이트. **백엔드도 빌드 도구도 의존성도 없다.**
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
├── gen-pages.mjs          data        → public/{cc}/index.html · public/index.html
├── gen-sitemap.mjs        git 커밋 날짜 → public/sitemap.xml
├── gen-favicon.mjs        favicon-art.mjs → ico · svg · png 넷
├── favicon-art.mjs        16×16 픽셀맵 (모든 크기의 원화)
├── harness.mjs            node:vm DOM·fetch 스텁 — 브라우저 없이 페이지를 돌린다
└── check-pages.mjs        배포 전 검사 205개 페이지

public/
├── index.html             생성물 — 국가 목록 + 감지된 국가 요약 카드
├── {cc}/index.html        생성물 — 국가별 공휴일 (3년치, HTML 에 박혀 있다)
├── data/{CC}.json         생성물 — 국가별 자료
├── data/countries.json    생성물 — 선택기용 목록
├── shared/base.css        손으로 쓴 것
├── shared/dday.css        손으로 쓴 것
├── shared/dday.js         손으로 쓴 것
├── 404.html · robots.txt  손으로 쓴 것
└── favicon.*              생성물
```

생성물도 커밋한다. 그래야 (1) Nager 가 죽어도 배포할 수 있고, (2) 이번 달에 어떤
공휴일이 바뀌었는지 git diff 로 보이고, (3) `gen-sitemap.mjs` 가 `lastmod` 를
커밋 날짜에서 뽑을 수 있다.

## 배포

**순서가 중요하다.**

```bash
cd frontends/dday-static

node tools/gen-holidays.mjs    # 1. Nager 에서 자료를 새로 받는다 (유일한 네트워크 단계)
node tools/gen-pages.mjs       # 2. 자료로 HTML 을 다시 만든다
git add -A && git commit       # 3. lastmod 가 여기서 정해진다
node tools/gen-sitemap.mjs     # 4. sitemap.xml
node tools/check-pages.mjs     # 5. 실패하면 배포하지 않는다 (종료 코드 1)
npx wrangler deploy            # 6.
```

3번을 건너뛰면 모든 HTML 이 "커밋 안 된 수정본" 으로 판정돼 `lastmod` 가 죄다 오늘이
된다. 구글은 `lastmod` 가 부정확하면 아예 무시하므로 그게 최악이다.

갱신 주기는 **월 1회면 충분하다**. 공휴일은 사실상 연 1회 바뀌고, 3년치(작년·올해·내년)를
담고 있어 연말연시에도 "다음/지난" 이 비지 않는다.

## 검사

`tools/check-pages.mjs` 가 205개 페이지를 브라우저 없이 돌려 본다.
jsdom 을 쓰지 않는다 — `node:vm` + 최소 DOM·fetch 스텁이면 충분하고, 의존성이 늘지 않는다.

보는 것:

1. 페이지가 예외 없이 구동되고 `window.DDAY` 손잡이가 나오나
2. `dday.js` 가 찾는 `#picker` · `#now` · `#next` · `#prev` 가 HTML 에 있나
3. 주요 태그가 짝이 맞나
4. canonical(자기 주소) · title · description · 파비콘 4줄 · 자산 링크
   (파비콘은 파일을 열어 정사각 + 48 의 배수인지 본다 — 구글 검색결과 아이콘 조건)
5. HTML 표의 날짜 집합이 `data/<CC>.json` 과 정확히 같나
6. 고정 날짜(`2026-06-15`)를 넣고 `classify()` 가 낸 다음/지난/오늘이
   검사기가 따로 계산한 값과 같나
7. `countries.json` · 페이지 디렉터리 · 첫 화면 링크가 1:1 인가
8. `sitemap.xml` 의 URL 집합이 페이지 집합과 같나
9. 브라우저 지역 감지가 기대대로 갈리나 (`ko-KR`→KR, `en-US`→US, `ko`→KR, 모르는 지역→null)

## 알려진 제약

- **D-day 는 보는 사람의 기기 날짜로 계산한다.** 다른 시간대의 국가를 볼 때는 하루
  어긋날 수 있다. 국가별 대표 시간대를 담으면 고칠 수 있지만, 그러려면 CLDR
  territory→timezone 표를 들여와야 해서 지금은 각주로만 적어 두었다.
- **한국어 페이지만 있다.** 미국·일본 공휴일 페이지도 한국어다. `en/` 짝을 만들면
  페이지가 410개가 된다 — 필요해지면 그때.
- **`types` 가 `Public` 인 항목만 담는다.** Nager 의 `Bank` · `Observance` ·
  `Optional` · `School` · `Authorities` 는 뺐다. 그래서 미국의 Lincoln's Birthday 는
  없다.
- **지역 한정 공휴일은 넣되 표시한다.** `global: false` 인 항목(미국 Good Friday 처럼
  일부 주만 쉬는 날)도 목록에 넣고, "일부 지역 N곳" 배지와 지역 코드를 함께 적는다.
  오늘이 그런 날뿐이면 카드도 "일부 지역만 쉽니다" 로 바뀐다.
