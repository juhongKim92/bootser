# dday-static — this is the day

204개국 공휴일과 황금연휴, 그리고 절기·삭망·유성우를 한국어·영어로 보여주는 정적 사이트.
**백엔드도 빌드 도구도 의존성도 없다.** `public/` 을 Cloudflare 에 그대로 얹는다.

`apps/d-day/d-day-service` 와는 별개다. 저쪽은 회원·영화·스포츠까지 다루는 Spring 서비스로
그대로 남아 있고, 여기는 공개 공휴일(`PUBLIC_HOLIDAY`)만 떼어 낸 읽기 전용 사이트다.

## 왜 서버가 없어도 되나

남은 외부 의존이 [Nager.Date](https://date.nager.at/) 하나뿐이고 API 키가 없다.
공휴일은 연 단위로 확정되는 자료라 요청마다 계산할 것이 없다 — 빌드 타임에 받아
JSON 으로 굳히고, 날짜에 따라 달라지는 것(D-day · 오늘 여부)만 브라우저가 계산한다.

| 서버가 하던 일 | 어디로 갔나 |
| --- | --- |
| Nager 호출 → DB 저장 | `tools/gen-holidays.mjs` (빌드 타임) |
| 연휴 구간 계산 | Nager `LongWeekend` — 같은 빌드 단계 |
| 천문 계산 | `tools/astro.mjs` — 네트워크조차 안 탄다 |
| `LocalDate.now(timezone)` | 브라우저 — 기기 날짜 |
| 다음/지난 공휴일 탐색 | 브라우저 — `dday.js` 의 `classify()` · `classifyBreaks()` |
| Redis 캐시 | Cloudflare CDN |

## 구조

```
tools/                     전부 node 내장 모듈만 쓴다 (npm install 없음)
├── config.mjs             도메인·연도 범위·국가 아닌 슬러그 — 바꿀 게 있으면 여기
├── gen-holidays.mjs       Nager.Date  → public/data/*.json
├── astro.mjs              절기·삭망·유성우 계산 (순수 함수, 네트워크 없음)
├── vsop87.mjs             VSOP87D 절단본 172항 — 생성물, 손대지 말 것
├── gen-vsop87.mjs         CDS VI/81   → vsop87.mjs (한 번 돌리고 마는 도구)
├── sky-fixture.mjs        분점·지점 공표 시각 12건 — 검사 전용
├── gen-sky.mjs            astro.mjs   → public/data/sky.json
├── gen-pages.mjs          data        → 한국어·영어 두 벌의 HTML (418개)
├── gen-sitemap.mjs        git 커밋 날짜 → public/sitemap.xml
├── gen-fonts.mjs          남의 오리진 셋 → public/fonts/ (손으로 돌리는 유일한 폰트 단계)
├── fonts.mjs              어디서 받고 무엇을 남기나 (gen-fonts · check-pages 가 함께 쓴다)
├── fonts-lock.json        생성물 — 버린 조각의 unicode-range 기록
├── gen-favicon.mjs        favicon-art.mjs → ico · svg · png 넷
├── favicon-art.mjs        16×16 픽셀맵 (모든 크기의 원화)
├── gen-card.mjs           card-art.mjs → public/card/*.png (공유 카드 206개)
├── card-art.mjs           5×7 픽셀 대문자 글꼴 · 카드 규격 (원화)
├── png.mjs                손으로 쓴 PNG 인코더 — 파비콘과 카드가 함께 쓴다
├── harness.mjs            node:vm DOM·fetch 스텁 — 브라우저 없이 페이지를 돌린다
├── inject-beacon.mjs      Cloudflare 웹 분석 비콘 주입 (빌드 단계)
└── check-pages.mjs        배포 전 검사 418개 페이지

public/
├── index.html             생성물 — 국가 목록 + 감지된 국가 요약 카드 (한국어)
├── {cc}/index.html        생성물 — 국가별 공휴일·황금연휴 (3년치, HTML 에 박혀 있다)
├── en/index.html          생성물 — 영어 첫 화면
├── {sky,en/sky}/index.html 생성물 — 하늘 허브 (국가 축이 아니다. 표는 없다)
├── fonts/                 생성물 — woff2 조각 84개 + fonts.css + LICENSE.txt
├── _headers               Cloudflare 응답 머리 (글꼴 immutable · 카드 하루)
├── sky/{term,moon,meteor}/ 생성물 — 갈래별 3년치 (검색어가 갈래로 갈린다)
├── en/{cc}/index.html     생성물 — 영어 국가 페이지
├── 404.html · en/404.html 생성물 — 언어 칸마다 하나씩
├── card/*.png             생성물 — og:image 공유 카드 (1200×630, 언어 무관 한 벌)
├── data/{CC}.json         생성물 — 국가별 자료 (공휴일 + 황금연휴, 언어 무관 한 벌)
├── data/month/YYYY-MM.json 생성물 — 같은 자료의 날짜 색인 36개
├── data/countries.json    생성물 — 선택기용 목록
├── data/sky.json          생성물 — 절기·삭망·유성우 (한 벌, 21KB)
├── shared/base.css        손으로 쓴 것
├── shared/dday.css        손으로 쓴 것
├── shared/dday.js         손으로 쓴 것 — 두 언어가 같은 파일을 쓴다
├── shared/contact.js      backend-internals 에서 가져온 것 (연락처 조립)
├── robots.txt             손으로 쓴 것
└── favicon.*              생성물
```

생성물도 커밋한다. 그래야 (1) Nager 가 죽어도 배포할 수 있고, (2) 이번 달에 어떤
공휴일이 바뀌었는지 git diff 로 보이고, (3) `gen-sitemap.mjs` 가 `lastmod` 를
커밋 날짜에서 뽑을 수 있다.

## 자료 갱신

**매월 1일 03:00 UTC 에 GitHub Actions 가 알아서 한다** —
`.github/workflows/dday-static-refresh.yml`.

Nager.Date 를 호출하는 유일한 자동 경로다. Cloudflare 빌드에서는 부르지 않는다 —
빌드마다 1224번(204개국 × 3년 × 공휴일·연휴) 치면 자료가 조용히 바뀌어 배포된다.

워크플로가 하는 일은 아래 손 절차와 똑같고, **순서가 중요하다.**

```bash
cd frontends/dday-static

node tools/gen-holidays.mjs    # 1. Nager 에서 자료를 새로 받는다 (유일한 네트워크 단계)
node tools/gen-sky.mjs         # 2. 절기·삭망을 다시 계산한다 (네트워크 없음)
node tools/gen-pages.mjs       # 3. 자료로 HTML 을 다시 만든다
node tools/gen-card.mjs        # 3.5. 국가 목록이 바뀌었으면 공유 카드도
node tools/gen-fonts.mjs       # 3.6. 새 글자가 들어왔으면 글꼴 조각도 (네트워크)
git add -A && git commit       # 4. lastmod 가 여기서 정해진다
node tools/gen-sitemap.mjs     # 5. sitemap.xml
node tools/check-pages.mjs     # 6. 실패하면 밀지 않는다 (종료 코드 1)
git push                       # 7. 나머지는 Cloudflare 가 한다
```

4번을 건너뛰면 모든 HTML 이 "커밋 안 된 수정본" 으로 판정돼 `lastmod` 가 죄다 오늘이
된다. 구글은 `lastmod` 가 부정확하면 아예 무시하므로 그게 최악이다. 5번이 4번 뒤에
오므로 `sitemap.xml` 이 커밋 밖에 남는데, 워크플로는 `--amend` 로 같은 커밋에 합친다.

워크플로에서 특히 조심한 것 둘.

- **`fetch-depth: 0`** — `gen-sitemap.mjs` 가 파일마다 `git log -1` 로 `lastmod` 를
  뽑는다. 얕은 클론이면 이력이 없어 전부 오늘로 찍힌다.
- **급감 방어** — `gen-holidays.mjs` 는 `data/` 를 통째로 지우고 새로 쓴다. Nager 가
  잠시 절반만 돌려주는 날이면 국가 페이지 100개가 조용히 사라지는데, 1:1 대응은
  그대로라 `check-pages` 도 통과한다. 그래서 직전 국가 수의 90% 미만이면 아무것도
  쓰지 않고 멈춘다. 진짜로 줄어든 것이라면 `--allow-shrink`.

자료가 그대로인 달에는 아무것도 커밋하지 않는다 — 생성기가 결정적이라 같은 입력이면
바이트까지 같은 출력이 나온다.

주기가 **월 1회**인 이유. 공휴일은 사실상 연 1회 바뀌고 3년치(작년·올해·내년)를 담고
있어 연말연시에도 "다음/지난" 이 비지 않는다. 다만 해가 바뀌면 국가 페이지의 표지
연도가 갱신돼야 하므로(`MID = YEARS()[1]`) 방치하면 계속 지난 해로 남는다.

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
먼저 돌리면 418개가 전부 수정본이 된다.

빌드 단계에서는 `gen-holidays` · `gen-sky` · `gen-pages` 를 돌리지 않는다. 생성물이 이미 커밋돼
있고, 빌드 때마다 Nager 를 1224번 치면 자료가 조용히 바뀌어 배포될 수 있다.
자료 갱신은 위 절차대로 손으로 하고 diff 를 보고 넘긴다.

## 황금연휴

주말과 공휴일이 이어져 사흘 이상 쉬는 구간을 국가마다 따로 싣는다. 같은 Nager 에
엔드포인트만 하나 더다 — `/LongWeekend/{year}/{cc}`. 주말이 어느 요일인지는 나라마다
다른데(이집트는 금·토) 그건 Nager 가 안다.

```json
{"s":"2026-05-01","e":"2026-05-05","b":["2026-05-04"]}
```

**일수를 담지 않는다.** `s` 와 `e` 에서 나온다. 담아 두면 자료 안에서 두 값이 갈라질 수
있고, 그러면 그것까지 검사해야 한다. `b` 는 징검다리 — 쉬는 날이 아닌데 하루 쓰면
앞뒤가 이어지는 날이다.

**우리가 담지 않은 공휴일에만 걸린 연휴는 버린다.** Nager 의 LongWeekend 는 `types` 를
가리지 않는데 우리 표에는 `Public` 만 있다. 그대로 실으면 표에 없는 날을 근거로
"5일 연휴" 라고 적는 페이지가 나온다 — 페이지 안에서 앞뒤가 맞지 않는다.
버린 건수는 생성기가 찍는다. 조용히 사라지면 다음 달에 왜 줄었는지 알 수 없다.

날짜 하나가 아니라 구간이라 D-day 의 갈림길이 셋이다.

| 지금 | 표의 표시 | 카드의 표시 |
| --- | --- | --- |
| 시작 전 | `D-12` | `D-12  5일 연휴` |
| 그 사이 | `연휴 중` | `연휴 중  5일 연휴` |
| 끝난 뒤 | `D+3` | (다음 연휴로 넘어간다) |

카드의 "다음 연휴" 는 **지금 붙어 있는 연휴가 있으면 그것이다.** 남은 이틀을 두고 두 달
뒤 연휴를 가리키면 카드가 거짓말을 한다. `dday.js` 의 `classifyBreaks()` 가 그 규칙을
한 군데에 담고, 국가 페이지 카드와 첫 화면 카드가 같은 함수를 쓴다.

## 절기와 삭망 (`/sky/`)

국가 축이 아닌 첫 페이지다. 절기도 삭망도 유성우도 **온 세계가 같은 순간을 공유**하므로
204개국으로 쪼갤 것이 없다 — `data/sky.json` 한 벌(21KB)이 전부다.
그래서 `config.mjs` 에 `EXTRA` 가 생겼다. 그전까지는 "첫 화면 아니면 전부 국가 페이지"
였고, `check-pages` 가 그 가정 위에 서 있었다.

### 밖에서 받아오지 않는다

`tools/astro.mjs` 가 직접 계산한다. Nager 도, 다른 API 도 안 탄다.

- **절기** — 태양의 겉보기 황경이 15°의 배수가 되는 순간. 24개가 한 식에서 나오고
  분점·지점은 그중 넷이다(0° · 90° · 180° · 270°).
- **삭망** — Meeus 제49장.
- **유성우** — **날짜를 손으로 적지 않는다.** 국제유성기구가 극대기를 태양 황경으로
  정의하므로, 위의 태양 계산에 그 황경을 넣으면 해마다 맞는 날짜가 나온다.
  해가 바뀌어도 표를 고칠 일이 없다.

### 태양은 왜 VSOP87 인가

처음에는 Meeus 저정밀식(0.01°)으로 짰다. **2025년 동지가 KST 자정 정각에 떨어졌다.**
오차 한계가 ±15분이니 12월 21일인지 22일인지 정할 수 없었다 — 동지 날짜가 틀린 절기
페이지는 안 내는 게 낫다.

그래서 VSOP87D 정본(CDS 카탈로그 VI/81)을 받아 `|A|·0.03^p ≥ 1e-7` 로 절단했다.
2425항 중 172항이 남고 오차는 **11분 → 1분**이 되었다. 지금 동지의 여유는 2분이다.

계수를 기억으로 적지 않고 `tools/gen-vsop87.mjs` 로 받아 만든다. 172줄짜리 숫자
뭉치는 손으로 검산할 수 없으니, 어디서 왔고 무엇을 버렸는지 코드로 남겨 둔다.

### 날짜는 시간대마다 갈린다

순간은 하나인데 날짜는 아니다. 2025년 동지는 UTC 12월 21일 15:02, 한국은 12월 22일
00:02 다. **ko 페이지는 KST, en 페이지는 UTC** 로 굳혀 박고 각주로 밝힌다.

굳히는 일은 `gen-sky.mjs` 한 군데에서만 한다. 브라우저가 다시 계산하면 HTML 에 박힌
날짜와 갈라질 수 있어서, `sky.json` 이 두 기준 시간대의 날짜·시각을 함께 담는다.

## 오늘 공휴일인 나라

첫 화면에 "오늘 어느 나라가 쉬는가" 를 띄운다. 국가별 파일로는 답할 수 없는 물음이라
(204개를 다 받아야 한다) `gen-holidays.mjs` 가 같은 자료를 날짜로 한 번 더 색인해
`data/month/YYYY-MM.json` 을 만든다.

달 단위로 쪼갠 이유 — 하루 단위면 파일이 973개가 되고, 한 파일이면 900KB 를 받아
그중 하루치만 쓴다. 달 파일은 36개에 9~16KB 라 브라우저가 이번 달 하나만 받는다.

같은 자료를 두 벌 들고 있으니 갈라질 수 있다. `check-pages.mjs` 가 국가별 파일과
달 색인을 (날짜, 국가, 이름) 으로 통째로 견주고, 한 건이라도 어긋나면 배포를 막는다.

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

## 글꼴

머리에 남의 오리진이 셋 있었다 — `fonts.googleapis.com` · `fonts.gstatic.com` ·
`cdn.jsdelivr.net`. `public/` 을 Cloudflare 에 그대로 얹는 사이트인데 DNS+TLS
핸드셰이크를 세 번 더 했고, 그중 둘은 첫 페인트를 막는 CSS 였다. 지금은 조각을 받아
`public/fonts/` 에 커밋해 둔다 — 같은 오리진 · 같은 연결 · 같은 CDN 캐시고,
이 디렉터리의 "의존성 없음" 원칙에도 맞는다.

| | 전 | 후 |
|---|---|---|
| 렌더 경로의 오리진 | 3 | **0** |
| 렌더를 막는 외부 CSS | 2 | 0 |
| 글꼴 CSS (gzip) | 145 KB | **8.4 KB** |
| 한 페이지가 받는 글꼴 | (같음) | 258 ~ 414 KB |

**조각을 다 받지는 않는다.** dynamic subset 은 `unicode-range` 로 갈려 있어서 사이트가
쓰지 않는 글자의 조각은 아무도 내려받지 않는다 — 커밋해 봐야 저장소만 무겁다.
`public/` 을 통째로 훑어(HTML·JSON·JS·CSS) 쓰는 글자 1,142자를 모으고 걸리는 것만 남긴다.
upstream 1,030면 → **84면 · 1,074 KB**.

가지치기의 위험은 하나뿐이다. 나라가 하나 늘어 새 한글 음절이 들어오면 그 글자만
대체 글꼴로 나오는데, **화면으로도 잘 안 보인다.** 그래서 버린 조각의
`unicode-range` 를 `tools/fonts-lock.json` 에 적어 두고 `check-pages` 가 그 기록으로
"버린 조각이 이제 필요해졌다" 를 잡는다.

**가변본을 먼저 붙였다가 물렸다.** `base.css` 의 `--sans` 첫 자리가
`'Pretendard Variable'` 이라 가변 dynamic-subset 을 실었는데, 조각 하나가 25.4 KB 로
정적본 10.5 KB 의 **2.4배**다 — 무게 축을 통째로 이고 다닌다. `--sans` 가 실제로
쓰는 무게는 400 과 500 둘뿐이라(700 은 serif 쪽이다) 정적 두 벌이 저장소에서도
방문자 쪽에서도 이긴다. 그러면서 드러난 것: **첫 자리에 적힌 이름을 우리가 나른 적이
없었다.** 그 글꼴을 이미 깔아 둔 사람만 다르게 보였고 아무 데서도 티가 안 났다.
지금은 `check-pages` 가 `base.css` 를 진짜로 놓고 `fonts.css` 와 견준다.

파일 이름에 내용 해시가 박혀 있다(`pretendard.172.9a3f1c22.woff2`). `_headers` 의
`immutable` 이 참말이 되고, 덤으로 검사가 네트워크 없이 무결성을 본다.

**preload 는 넣지 않았다.** 어느 조각이 필요한지가 페이지마다 다르다 — 한 벌을 골라
418개 머리에 박으면 맞는 페이지에서는 1 RTT 를 벌지만 틀린 페이지에서는 아무도 안 쓰는
파일을 통째로 받는다. 페이지마다 계산해 박으면 `gen-pages` 가 `gen-fonts` 의 출력을
읽고 `gen-fonts` 는 페이지의 글자를 읽어, 생성기 둘이 서로를 물어 처음 한 번을 못 돌린다.

`gen-fonts.mjs` 는 `gen-holidays.mjs` 처럼 **손으로 돌리는 네트워크 단계**고 Cloudflare
빌드에는 없다. 빌드가 돌리는 것은 `check-pages.mjs` 뿐이고 그건 네트워크를 타지 않는다.
`node tools/gen-fonts.mjs --check` 는 upstream 이 판을 올렸는지만 본다.

## 검사

`tools/check-pages.mjs` 가 418개 페이지를 브라우저 없이 돌려 본다.
jsdom 을 쓰지 않는다 — `node:vm` + 최소 DOM·fetch 스텁이면 충분하고, 의존성이 늘지 않는다.

보는 것:

1. 페이지가 예외 없이 구동되고 `window.DDAY` 손잡이가 나오나
2. `dday.js` 가 찾는 `#picker` · `#now` · `#next` · `#prev` · `#break` 가 HTML 에 있나
3. 주요 태그가 짝이 맞나
4. canonical(자기 주소) · hreflang 3줄 · title · description · 파비콘 4줄 · 자산 링크
   (파비콘은 파일을 열어 정사각 + 48 의 배수인지 본다 — 구글 검색결과 아이콘 조건)
5. HTML 표의 날짜 집합이 `data/<CC>.json` 과 같나, `data/month/*.json` 이
   국가별 파일과 한 건도 어긋나지 않나
6. 황금연휴가 스스로 앞뒤가 맞나 — 사흘 이상인가, 우리가 담은 공휴일에 걸려 있나,
   징검다리가 구간 안의 공휴일 아닌 날인가, 시작일순이고 겹치지 않나. 그리고 연휴 표가
   그 자료와 같나, 연휴가 0건인 국가에는 카드 줄도 섹션도 없나
6.5. **천문 검산점** — 절기·삭망은 우리가 직접 계산한 것이라 "받은 대로 찍혔나" 로는
   아무것도 검사되지 않는다. 두 번째 점을 저장소 안에서 찾는다. 일본은 `春分の日`·
   `秋分の日` 를 실제 천문 분점(일본 표준시)으로 정하고, 음력 1월 1일은 삭이 있는 날,
   음력 8월 15일은 그 14일 뒤다. Nager 에서 온 공휴일 자료와 **21개 지점**을 견준다.
   이름이 바뀌어 검산점이 통째로 사라지는 것이 가장 나쁘므로 최소 개수를 박아 두었다.
   그것과 별개로 `sky-fixture.mjs` 의 분점·지점 공표 시각 12건과 **분 단위로** 견준다 —
   공휴일 쪽 검산점은 날짜만 주므로 1분 오차와 70분 오차를 가르지 못한다
7. 고정 날짜(`2026-06-15`)를 넣고 `classify()` 가 낸 다음/지난/오늘이
   검사기가 따로 계산한 값과 같나. 이어서 실제로 그려진 오늘 카드 문안,
   "오늘 공휴일인 나라" 목록(나라 수·이름·공휴일 이름·정렬), 그리고 dday.js 가
   채운 선택기 204줄의 정렬까지 견준다.
   연휴는 갈림길이 셋(전·중·후)이라 `classifyBreaks()` 도 같은 고정 날짜로 견준다 —
   연휴가 4천 건이라 그 날짜 하나로 셋이 다 지나간다
8. `countries.json` · 페이지 디렉터리 · 양쪽 첫 화면 링크가 1:1 인가,
   목록이 보이는 이름순인가
9. `sitemap.xml` 의 URL 집합이 페이지 집합과 같고 hreflang 이 url 마다 세 줄인가
10. 브라우저 지역 감지가 기대대로 갈리나 (`ko-KR`→KR, `en-US`→US, `ko`→KR, 모르는 지역→null),
   그리고 `localStorage` 에 무엇이 담겨 있든 그 감지를 바꾸지 못하나
11. ko / en 이 짝으로 있고 수가 같나
12. 영어 페이지에 한국어가 남아 있지 않나 (공휴일 이름처럼 자료에서 오는 자리는 뺀다)
13. 어느 페이지도 `localStorage` 에 아무것도 남기지 않나
14. 푸터 연락처가 제대로 조립되나 — 조각이 하나 있고, `contact.js` 를 싣고,
    합친 결과가 기대한 주소이고, **완성된 주소가 소스 어디에도 없나**
15. `robots.txt` 의 Sitemap 줄이 `BASE` 와 같나, CSS 계약(스크롤 목록·오늘 강조·
    어두운 테마·좁은 화면)이 살아 있나, 404 가 언어 칸마다 있고 noindex 인가
16. **글꼴** — 렌더 경로(stylesheet·script·preload)에 남의 오리진이 다시 들어오지
    않았나, 페이지가 `/fonts/fonts.css` 를 걸고 있나, `fonts.css` 가 가리키는 파일이
    다 있고 이름의 해시가 내용과 맞나, 84면 전부에 `font-display:swap` 이 있나,
    `base.css` 가 첫 자리에 부르는 글꼴 셋을 우리가 실제로 나르나, 그리고
    **버린 조각이 이제 필요해지지 않았나**

## 홈은 늘 내 지역

첫 화면의 "내 국가" 카드는 **브라우저 지역 설정만** 본다 (`Intl.Locale(...).maximize().region`).

한때 고른 국가를 `localStorage` 에 기억하고 그걸 먼저 썼는데, 국가 페이지를 **열어 본
것만으로도** 기억되는 바람에 이라크 공휴일을 한 번 구경하면 홈이 계속 이라크가 되었다.
지금은 사이트 전체가 `localStorage` 를 쓰지 않고, 검사가 읽는 쪽과 쓰는 쪽을 모두 막는다 —
값을 심어 두고 감지가 흔들리는지 보고, 어느 페이지도 무엇을 남기지 않는지 본다.

## 연락처

푸터의 메일 주소는 HTML 어디에도 완성된 형태로 없다. 로컬 파트와 도메인을 뒤집어
따로 담아 두고 `shared/contact.js` 가 합친다 — `@` 는 소스에 아예 등장하지 않는다.
backend-internals 와 같은 방식이고 같은 파일을 쓴다.

정규식으로 훑는 수집기는 아무것도 못 가져가고, 헤드리스 브라우저로 렌더링까지 하는
수집기는 그대로 가져간다. 그건 이 방식으로 못 막는다.

검사가 조립 결과까지 본다. 조각 한 글자가 틀리면 조용히 엉뚱한 주소가 나오는데,
`data-d` 를 `moc.02noilimrev` 로 바꿔 보면 잡힌다.

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
