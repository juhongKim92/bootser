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
node tools/verify-alignment.mjs    # 23편
node tools/verify-fanout.mjs       # 24편
node tools/verify-omission.mjs     # 25편
node tools/verify-slowstart.mjs    # 26편
node tools/verify-backlog.mjs      # 27편
node tools/verify-nagle.mjs        # 28편
node tools/verify-pagesplit.mjs    # 29편
node tools/verify-usl.mjs          # 30편
node tools/verify-quorum.mjs       # 31편
node tools/verify-favicon.mjs      # 파비콘 네 파일이 원화와 같은지

node tools/gen-related.mjs         # "이어서 볼 것" 블록을 박는다
node tools/gen-jsonld.mjs          # JSON-LD(Article + BreadcrumbList)를 박는다
node tools/gen-related.mjs --check # 고치지 않고 최신인지만 본다 (두 생성기 모두 지원)
node tools/gen-favicon.mjs         # 파비콘 네 파일을 원화에서 다시 만든다
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
| 파비콘 원화의 슬라이드 자리를 메움 | 원화 1건 + 생성물 4건 |
| 파비콘 원화의 경통을 곧게 세움 | 생성물 4건, 각 56곳 |
| 파비콘 원화의 암을 한 줄 끊음 | 원화 3건 |
| 파비콘 원화의 접안렌즈를 종이색으로 | 원화 2건 (오렌지 0픽셀) |
| 파비콘 원화의 받침을 스테이지보다 좁게 | 원화 1건 + 생성물 4건 |
| `favicon.svg` 의 `<rect>` 하나 삭제 | 래스터 대조에서 27곳 |
| `icon-192.png` 의 IDAT 바이트 하나 뒤집기 | 압축 손상으로 감지 |

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

> **더러운 트리에서 두 번 돌리지 말 것 — 2026-08-25 에 겪었다.**
>
> 이 생성기는 **자기가 쓴 파일을 다시 "커밋 안 된 수정본" 으로 만든다.** 그래서 한 번
> 돌린 뒤 `--check` 를 하면 방금 고친 페이지들이 최신이 아니라고 나오고, 그 말을 듣고
> 한 번 더 돌리면 **내용이 한 글자도 안 바뀐 페이지 39개의 `dateModified` 가 오늘로
> 밀린다.** 검색엔진에 "오늘 고쳤다" 고 거짓말을 하는 셈이다.
>
> `--check` 는 **커밋된 트리에서** 쓰는 것이다 — `gen-sitemap.mjs` 를 "트리가 깨끗할 때"
> 돌리라고 적어둔 것과 같은 이유다. 작업 중에는 한 번만 돌리고 `--check` 는 넘긴다.
>
> 이미 밀렸으면 **날짜 줄만 다른 파일**을 골라 되돌린다 —
> `git diff -U0 -- <파일> | grep -E '^[+-][^+-]' | grep -v '"dateModified"'` 가 비면
> 그 파일은 `git checkout` 해도 되는 것이다.
>
> **더 나은 방법 — 아예 따로 커밋하지 않는다.** 이 생성기는 *내용을 고친 커밋에 같이 태우는*
> 것을 전제로 만들어졌다(더러운 트리 → 오늘 → 오늘 커밋 → 일치). 날짜만 고치는 커밋을
> 따로 만들면 **그 커밋 자체가 수정이라서** 다음 실행 때 그 파일들이 다시 오늘로 간다.
> 2026-08-25 에 24편을 내면서 이 한 칸 밀림을 겪었다 — 날짜를 08-24 로 정정해 커밋했더니,
> 25편 작업 때 돌린 실행이 그 36장을 08-25 로 옮겼다. 이번엔 거기서 수렴하니 받아들였다.

> **되돌린 뒤에 줄바꿈을 확인할 것.** Windows 에서 `git checkout` 은 작업 트리에
> CRLF 를 쓰는데(`core.autocrlf`) 이 디렉터리의 생성기들은 전부 LF 로 쓴다.
> 그래서 되돌린 파일은 git 이 보기에는 동일한데 **생성기가 보기에는 다르고**,
> `gen-related.mjs --check` 와 `gen-prerender.mjs --check` 가 멀쩡한 페이지를
> "최신이 아니다" 로 잡는다. `git diff` 는 정규화해서 비교하므로 아무것도 안 보여준다.
> 되돌렸으면 그 파일들을 LF 로 다시 정규화한다.

## 파비콘 생성기

원화는 `favicon-art.mjs` 의 **16×16 픽셀맵 하나**뿐이고, `gen-favicon.mjs` 가 그것을
정수배로 키워 `favicon.svg` · `favicon.ico`(16·32·48) · `icon-192.png` ·
`apple-touch-icon.png` 네 개를 만든다. 축에 정렬된 사각형뿐이라 래스터라이저 없이
픽셀을 직접 찍고 PNG·ICO 를 손으로 인코딩한다 — 의존성이 없다는 이 디렉터리의
규칙을 그대로 지킨다.

**16 그리드인 이유.** 파비콘이 가장 많이 보이는 곳은 브라우저 탭의 16px 이고, 거기서는
픽셀 하나가 곧 그리드 한 칸이다. 16px 에서 읽히도록 손으로 찍고 48·192 는 3배·12배로만
키운다. 큰 크기에서만 멀쩡한 도안이 나올 수 없고, 어느 크기에서도 안티에일리어싱이
끼지 않는다.

2026-08-20 에 파랑 계단 막대에서 오렌지 현미경으로 바꾸면서 정한 것들 —

- **타일은 테마 무관 잉크 고정이다.** 이전 아이콘은 바탕이 종이색(`#f5f2ec`)이라
  밝은 탭 바에서 타일 경계가 녹아 실루엣이 사라졌다. 게다가 SVG 의
  `prefers-color-scheme` 는 **OS 테마**를 따라가는데 탭 바 색은 **브라우저 테마**라
  둘이 어긋나고, `.ico` 는 애초에 한 모습으로 고정이라 SVG 와 다르게 보이기도 했다.
  잉크로 고정하면 세 문제가 한 번에 사라진다
- **현미경으로 읽히게 하는 요소는 넷이다.** 하나라도 빠지면 램프나 트로피가 된다 —
  ① 기울어진 경통(곧게 세우면 소화전처럼 보인다) ② 경통 위에서 받침까지 이어지는
  오른쪽 암 ③ 대물렌즈 아래 슬라이드 자리(빈칸) ④ 넓은 받침.
  `favicon-art.mjs` 의 `validate()` 가 이 넷을 픽셀맵에서 직접 단언한다
- **16px 도안을 먼저 확정하고 큰 크기를 유도했다.** 반대로 하면 16px 에서 뭉갠다.
  실제로 첫 시도(정면 대칭 · 수직 경통)는 체스 말과 소화전으로 읽혀서 버렸다

`verify-favicon.mjs` 는 PNG 를 직접 디코딩하고 SVG 의 rect 를 도로 래스터화해서
**네 파일이 16 그리드 칸마다 원화와 같은 색**인지 본다. `.ico` 안의 세 장도 각각 푼다.
생성물을 손으로 고치면 여기서 잡힌다 — 고칠 곳은 `favicon-art.mjs` 의 `MAP` 하나다.

`gen-favicon.mjs --check` 는 고치지 않고 원화와 어긋났는지만 본다(다른 생성기와 같다).

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

## 프리렌더 생성기

`gen-prerender.mjs` 는 실험대의 **첫 화면을 HTML 에 구워 넣는다.**

실험대가 채우는 자리(`<div class="meters" id="meters"></div>`)는 배포되는 HTML 에
비어 있었다. 브라우저는 그걸 높이 0 으로 그리고, 스크립트가 돌면서 표가 들어차면
그 아래 내용이 전부 밀린다 — 그 밀림이 CLS 다. 하니스로 재 보니 페이지 42개,
자리 222개가 그 상태였다.

`min-height` 로 높이만 예약하는 방법도 있지만 그건 밀림을 줄일 뿐 없애지 못한다.
예약한 값이 실제보다 작으면 여전히 밀리고, 크면 빈 칸이 남는다.

만드는 방법은 하니스 그대로다. 배포되는 스크립트를 `node:vm` 에서 돌려 각 컨테이너에
들어간 `innerHTML` 을 얻고, 그것을 HTML 에 넣는다. 브라우저가 load 시점에 만드는 것과
같은 문자열이라 스크립트가 다시 그려도 화면이 바뀌지 않는다.
덤으로 크롤러와 자바스크립트를 끈 사람이 실험대 내용을 본다.

```bash
node tools/gen-prerender.mjs           # 굽는다
node tools/gen-prerender.mjs --check   # 고치지 않고 최신인지만 본다 (종료 코드 1)
```

구운 부분은 `<!--pr--> … <!--/pr-->` 로 감싸고 매번 그것부터 걷어낸 뒤 다시 넣는다.
그래서 몇 번을 돌리든 결과가 같다. 비어 있는 컨테이너에만 넣으므로 손으로 쓴 초기값
(`<span class="v" id="vQ">25<small> %</small></span>` 같은 것)은 건드리지 않는다.

구워도 되는 근거 셋을 확인하고 넣었다.

- **결정적인가** — 전 페이지를 두 번씩 돌려 결과가 같았다. 난수나 현재 시각을 쓰는
  실험대가 다섯 있지만 초기 렌더에서는 쓰지 않는다. 안 그랬으면 구운 것과 브라우저가
  그리는 것이 달라 화면이 깜빡인다.
- **덧붙이지 않는가** — 컨테이너를 채우는 것은 전부 `innerHTML` 대입이다.
  `innerHTML +=` 나 `insertAdjacentHTML` 이 있었다면 구운 내용이 두 배가 된다.
- **안쪽을 조회하지 않는가** — 구운 컨테이너 안을 `'#board .head'` 처럼 찾는 곳이 둘
  있는데(lockttl · timeout), 둘 다 `position:absolute` 인 재생 머리를 `moveHead()` 가
  옮기는 것이고 초기값이 0 이라 레이아웃에 영향이 없다. 새 실험대를 붙일 때 컨테이너
  안쪽을 **읽어서** 판단하는 코드를 쓰면 이 전제가 깨진다.

## 배포 순서와의 관계

배포는 이 순서다 — ① `gen-prerender.mjs` ② `gen-sitemap.mjs` ③ `inject-beacon.mjs`
④ `wrangler deploy`.
검증은 **②보다 앞**에 돌린다. `inject-beacon.mjs` 가 HTML 을 제자리에서 고치므로
그 뒤에 돌리면 주입된 스크립트까지 실행하게 된다.
`gen-prerender.mjs` 도 HTML 을 고치므로 `gen-sitemap.mjs` 앞에 와야 한다 —
거꾸로 하면 구운 페이지가 전부 "커밋 안 된 수정본" 이 되어 lastmod 가 죄다 오늘이 된다.
