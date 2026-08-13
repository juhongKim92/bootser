# tools — 실험대 검증

> `public/` 밖이라 배포되지 않는다. `wrangler.toml` 의 `[assets] directory = "./public"`
> 이 업로드 범위를 정한다.

## 왜 있나

이 사이트의 값은 **본문이 인용한 수치가 화면의 수치와 같다**는 데 있다.
`docs/content-audit.md` 가 그걸 한 번 감사했고 실제 오류 5건을 찾았다.
그때는 검증 스크립트를 세션마다 다시 만들었는데(그리고 저장소에 남기지 않았는데),
17편을 만들면서 같은 것을 또 만들게 되어 여기 고정했다.

의존성은 없다. `node tools/<script>.mjs` 로 그냥 돈다.

## 쓰기

```bash
cd frontends/backend-internals

node tools/check-pages.mjs         # 전 페이지 공통 검사
node tools/verify-timeout.mjs      # 17편 인용 수치 대조
node tools/verify-lockttl.mjs      # 18편
node tools/verify-throughput.mjs   # 19편
node tools/verify-rebalance.mjs    # 20편
node tools/verify-tcpclose.mjs     # 21편
node tools/verify-aggregate.mjs    # 22편

node tools/gen-related.mjs         # "이어서 볼 것" 블록을 박는다
node tools/gen-jsonld.mjs          # JSON-LD(Article + BreadcrumbList)를 박는다
node tools/gen-related.mjs --check # 고치지 않고 최신인지만 본다 (두 생성기 모두 지원)
```

전부 실패하면 종료 코드 1 이다. 페이지를 고친 뒤와 배포 전에 돌린다.

## 무엇을 잡나

`check-pages.mjs` — 페이지마다

1. 실험대가 예외 없이 구동되나
2. 렌더 결과에 `undefined` · 미치환 `$1` · `NaN` 이 남지 않나 — **i18n 키 누락 검사**다.
   `window.LAB` 훅이 있는 실험대는 시나리오 전 단계를 밟아가며 다시 훑는다
3. 실험대가 `$('#id')` 로 찾는 요소가 HTML 에 실제로 있나
4. 주요 태그가 짝이 맞나 — `<div>` 를 `</p>` 로 닫는 실수를 잡는다
5. `canonical` + `hreflang` 3줄, 그리고 자기 실험대 자산 링크가 있나
6. **ko/en i18n 키 집합이 같나** — 한쪽만 고치는 사고가 제일 흔하다
7. 인덱스의 그룹별 카드 수와 `<span class="count">` 표기가 맞나,
   그리고 모든 실험대 페이지가 인덱스에 링크돼 있나
8. **"이어서 볼 것" 링크 그래프** — 자기 링크·중복·없는 페이지·빈 이유가 없나,
   **들어오는 링크가 0인 페이지**가 없나, HTML 에 박힌 블록이 링크 맵과 일치하나,
   그리고 문단 여백을 주는 `prose` 규칙이 걸려 있나
9. **JSON-LD** — 파싱되나, `@context` 가 schema.org 인가, 그리고 **페이지 내용과
   어긋나지 않나** — `headline` = `<h1>`, `url` = canonical, `inLanguage` = `<html lang>`,
   날짜 형식과 순서, 빵가루의 `position` 연속성과 뿌리 URL

`verify-<slug>.mjs` — 그 편의 본문·시나리오·판정 문안이 인용한 값을 실측과 대조한다.
허용오차 없이 정확히 일치해야 한다.

### 이 도구가 못 잡는 것 — 틀린 모델

`verify-<slug>.mjs` 가 보는 것은 **모델과 본문이 일치하는가**다. **모델이 현실과 일치하는가**는
못 본다. 모델이 틀린 메커니즘을 구현하고 있으면 단언 수십 건이 전부 통과하면서
틀린 페이지가 나간다 — *틀린 모델의 내부 일관성*만 검증하는 셈이다.

2026-08-13 에 실제로 그럴 뻔했다. 21편 후보의 원인 설명("FIN 이 데이터를 앞질러 도착한다")이
TCP 에서 성립하지 않는데(FIN 은 시퀀스 번호를 차지해 스트림 맨 끝에 놓이고, 수신 TCP 는
구멍이 있으면 EOF 를 올리지 않는다) 출처 문서에서 그대로 물려받았다. 검토받아서 잡혔다.

그래서 **모델을 짜기 전에 메커니즘을 1차 출처(RFC · 벤더 문서 · 명세)로 확인한다.**
`docs/todo.md` 의 "페이지 추가 체크리스트" 첫 항목이 그것이다. 순서가 중요하다.

### 실제로 잡히는지 확인했다

변이를 넣어보고 잡는 것을 봤다.

| 변이 | 결과 |
|---|---|
| i18n 키 `fvProp` 하나 제거 | `#fireTbl` 에 `undefined` + ko/en 키 불일치, 2건 실패 |
| `</div>` 하나를 `</p>` 로 | `<div>` 41/40 · `<p>` 18/19, 2건 실패 |
| 모델 상수 `HOP` 25 → 30 | 98개 단언 중 16건 실패 |
| 한 페이지에서 "이어서 볼 것" 블록 제거 | 그 페이지 1건 실패 |
| 링크 맵에 자기 링크 추가 | 맵 1건 + ko/en 블록 불일치 2건 실패 |
| JSON-LD 의 닫는 따옴표 · 배열 괄호 깨기 | 파싱 실패로 각 1건 |
| `@context` 를 schema.org 아닌 값으로 | 1건 |
| `headline` 을 `<h1>` 과 다르게 | 1건 |
| 빵가루 `position` 을 1 → 2 로 | 1건 |
| JSON-LD 블록 통째로 제거 | 1건 |

> 변이 테스트를 짤 때 주의 — perl 정규식 안의 `@type` 은 **배열로 보간되어** 치환이
> 조용히 안 먹는다. 처음 이걸로 "검사가 통과했다" 는 잘못된 결론을 냈다.
> `@` 가 없는 문자열로 변이시킬 것.

## 하니스

`lab-harness.mjs` 가 `public/<slug>/index.html` 을 읽어 스크립트를 **문서 순서대로**
`node:vm` 컨텍스트에서 실행한다. 배포되는 코드 그대로가 돌고, 렌더 결과를 DOM 스텁에서
읽는다.

- **jsdom 을 쓰지 않는다.** 실험대가 건드리는 브라우저 API 는 `querySelector` ·
  `querySelectorAll` · `getElementById` · `setInterval` · `requestAnimationFrame` ·
  `matchMedia` · canvas 2d · `classList` · `localStorage` 뿐이라 최소 스텁으로 충분하고,
  저장소에 의존성을 늘리지 않는 편이 낫다
- **문서 순서가 중요하다.** 17편은 `LAB_I18N` 인라인 블록이 `<script src>` 앞에 있지만
  `gc` · `mvcc` 는 거꾸로다(실험대를 먼저 싣고 인라인에서 `initGcLab(...)` 을 호출한다).
  순서를 뒤집으면 `initGcLab is not defined` 로 헛되게 실패한다
- i18n 은 **실제 페이지에서 가져온다.** 그래야 빠진 키가 `undefined` 로 터져서
  그 자체가 검사가 된다

### 검사 범위

이 하니스가 보는 것은 **모델의 수치와 렌더된 문자열**이다. 레이아웃은 없다
(`getBoundingClientRect` 가 고정값을 돌려준다), 캔버스 2D 컨텍스트도 전부
no-op 이다(`hashring` · `raft` 가 쓴다). 픽셀은 검사 대상이 아니니,
**깨지면 안 되는 것은 여기서 잡히도록 만든다** — 태그 짝 · id 존재 · `prose` 규칙 ·
링크 그래프처럼 문자열로 판정할 수 있는 형태로 옮겨 담는다.

## "이어서 볼 것" 생성기

`related.mjs` 가 링크 맵의 **유일한 출처**이고, `gen-related.mjs` 가 그것을 각 페이지의
`</main>` 앞에 써 넣는다. 본문을 JS 로 주입하면 색인되지 않으므로 HTML 에 직접 박는다.

- 블록은 `<!-- onward:start -->` / `<!-- onward:end -->` 표식 사이에 들어가므로
  **몇 번 돌려도 결과가 같다.** 링크 문구를 고치려면 맵을 고치고 다시 돌린다
- 링크 제목은 대상 페이지의 `<h1>` 에서 읽는다 — 제목을 고치면 문구가 따라온다
- 고르는 기준은 **실제로 이어져 있는데 화면에 없던 것**이다. 한 줄의 이유가 안 써지면
  그 링크는 넣지 않는다. "관련 글" 목록이 아니다

`gen-related.mjs` 는 문단 여백도 함께 맞춘다. 01~13 은 본문을 `<article class="prose">`
로 감쌌지만 14 이후는 그러지 않아 `*{margin:0}` 리셋 때문에 문단 여백이 0 이었다.
prose 규칙이 없는 페이지에만 `<main class="wrap prose">` 를 붙인다.

## JSON-LD 생성기

`gen-jsonld.mjs` 가 각 페이지의 `<h1>` · `description` · canonical · `<html lang>` 과
**git 커밋 날짜**를 읽어 블록을 만든다. 손으로 관리할 데이터가 없다.

2026-08-13 에 Google 문서를 확인하고 정한 것들 —

- **`TechArticle` 을 쓰지 않는다.** 문서가 지원한다고 명시한 타입은 `Article` ·
  `NewsArticle` · `BlogPosting` 뿐이다. `TechArticle` 은 schema.org 상 Article 의
  서브타입이라 틀리지는 않지만, 문서에 있는 것을 쓴다
- **실제로 값을 하는 건 `BreadcrumbList` 다.** 검색 결과에 URL 대신
  `Backend Internals › 제목` 이 뜬다. 이미지가 필요 없다
- **`image` 를 넣지 않았다.** 사이트에 이미지가 하나도 없어서(`og:image` 도 없다)
  Article rich result 의 큰 썸네일은 어차피 못 받는다. 이미지를 만들면 그때 추가한다
- **`author` 에 실명을 넣지 않았다.** 사이트 어디에도 실명이 없으니 조직명으로 뒀다.
  노출 여부는 사이트 주인이 정할 일이다
- **`FAQPage` · `HowTo` 는 안 넣는다.** 갤러리에서 빠졌다 — FAQ 는 정부·의료 사이트로
  한정, HowTo 는 폐지. 넣어도 표시되지 않는다
- 구조화 데이터는 **순위에 직접 영향이 없다.** 표시·이해 장치다

날짜는 `datePublished` = 그 페이지의 첫 커밋, `dateModified` = 페이지와 전용
`-lab.{js,css}` 중 마지막 커밋이다(`gen-sitemap.mjs` 의 lastmod 와 같은 규칙).
커밋 안 된 수정본이 있으면 오늘로 본다.

## 새 페이지에 붙이기

실험대 끝에 검증용 훅을 열어둔다. `shared/timeout-lab.js` 가 그 예다.

```js
window.LAB = {
  set(o) { /* 손잡이를 적용하고 다시 렌더한다 */ return window.LAB; },
  exact,          // 또는 집계를 돌려주는 무엇
  trace, scene    // 결정적 한 건 · 시나리오 배열
};
```

`set` 과 `scene` 이 있으면 `check-pages.mjs` 가 시나리오 전 단계를 자동으로 훑는다.
수치 대조가 필요하면 `verify-timeout.mjs` 를 본떠 `verify-<slug>.mjs` 를 만든다.

**미터는 표본이 아니라 정확한 기대값으로 설계하는 편이 낫다.** 응답시간처럼 분포가
필요한 값을 두 점으로 줄이면 모든 경로를 확률 가중으로 열거할 수 있고(잎 수백 개),
난수가 없어 본문 인용값이 정확히 재현된다. 해시링에서 겪은 "링의 불균형이 아니라
표본 잡음을 재고 있었다"(`docs/content-audit.md` §2) 문제가 아예 생기지 않는다.

## 배포 순서와의 관계

배포는 이 순서다 — ① `gen-sitemap.mjs` ② `inject-beacon.mjs` ③ `wrangler deploy`.
검증은 **①보다 앞**에 돌린다. `inject-beacon.mjs` 가 HTML 을 제자리에서 고치므로
그 뒤에 돌리면 주입된 스크립트까지 실행하게 된다.
