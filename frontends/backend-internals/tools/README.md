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

node tools/check-pages.mjs        # 전 페이지 공통 검사 (36개 페이지)
node tools/verify-timeout.mjs     # 17편 인용 수치 대조 (단언 98건)
```

둘 다 실패하면 종료 코드 1 이다. 페이지를 고친 뒤와 배포 전에 돌린다.

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

`verify-timeout.mjs` — 17편 본문·시나리오·판정 문안이 인용한 값을 실측과 대조한다.
허용오차 없이 정확히 일치해야 한다.

### 실제로 잡히는지 확인했다

변이를 넣어보고 잡는 것을 봤다.

| 변이 | 결과 |
|---|---|
| i18n 키 `fvProp` 하나 제거 | `#fireTbl` 에 `undefined` + ko/en 키 불일치, 2건 실패 |
| `</div>` 하나를 `</p>` 로 | `<div>` 41/40 · `<p>` 18/19, 2건 실패 |
| 모델 상수 `HOP` 25 → 30 | 98개 단언 중 16건 실패 |

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

### 한계

**레이아웃이 없다.** `getBoundingClientRect` 는 고정값을 돌려주므로 "화면에서 실제로
어떻게 보이나" 는 검증하지 못한다. 이 하니스가 보는 것은 **모델의 수치와 렌더된
문자열**이다. 시각적 확인은 여전히 브라우저로 해야 한다.

캔버스 2D 컨텍스트는 전부 no-op 이다(`hashring` · `raft` 가 쓴다). 구동은 되지만
그림 자체는 검사하지 못한다.

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
