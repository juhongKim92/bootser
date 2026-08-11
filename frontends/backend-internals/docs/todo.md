# Backend Internals — TODO

> 이 폴더는 `public/` 밖이라 배포되지 않는다.
> `wrangler.toml` 의 `[assets] directory = "./public"` 이 업로드 범위를 정하므로,
> 여기 무엇을 넣든 사이트 URL 로는 접근되지 않는다.

## 콘텐츠

- [x] 03. 컨시스턴트 해싱 — 노드 하나가 빠지면 캐시는 어떻게 무너지는가
- [x] 04. Raft 리더 선출 — 네트워크가 갈라지면 누가 리더가 되는가
- [ ] mvcc 페이지의 "실제로 겪은 일" 주석 블록 채우기 (`public/mvcc/index.html`)

### 실시간 통신 (인덱스 카드부터 추가해야 함 — 현재 01~04 가 전부 공개됨)

- [ ] MQTT QoS 0/1/2 + 패킷 손실
  - 네트워크가 불안정할 때 각 QoS 레벨에서 메시지가 어떻게 유실되고 중복되는지
  - QoS 2 의 4-way 핸드셰이크 비용을 QoS 1 의 중복과 나란히 놓고 비교
- [ ] WebSocket 다중 서버와 Redis Pub/Sub
  - 서버를 늘리면 다른 노드에 붙은 클라이언트에게 메시지가 안 가는 문제
  - Pub/Sub 로 풀 때 생기는 것들 — 팬아웃 비용, 유실(Pub/Sub 은 저장하지 않음), 재연결 중 공백
- [ ] Keep-alive와 죽은 커넥션 + LWT
  - TCP 는 살아 있다고 하는데 실제로는 끊긴 연결. keep-alive 주기와 탐지 지연의 관계
  - Last Will and Testament 가 언제 발행되고 언제 안 되는지 (정상 종료 vs 비정상 종료)

## 페이지 추가 체크리스트

새 시각화를 올릴 때마다:

- [ ] `public/<slug>/index.html` (ko) + `public/en/<slug>/index.html` (en)
- [ ] 실험대 로직/스타일은 `public/shared/<slug>-lab.js` · `<slug>-lab.css` 로 한 벌만
- [ ] 본문은 HTML 에 직접 — JS 주입 금지 (색인 안 됨)
- [ ] canonical + hreflang 3줄(ko·en·x-default), 양쪽 페이지 모두에 동일하게
- [ ] 인덱스 두 벌에 카드 추가
- [ ] `sitemap.xml` 에 ko/en 두 블록 (파일 안 주석에 템플릿 있음)
- [ ] 배포 후 Search Console 에서 sitemap 재제출 + URL 검사

## SEO

- [ ] `/mvcc/` 와 `/en/mvcc/` 가 각각 별도 색인되는지 확인
- [ ] `/gc/` 와 `/en/gc/` 동일 확인
- [ ] 색인 후 검색어별 노출 확인 — "VACUUM 테이블 안 줄어듦", "G1 ZGC 차이" 등

## 검토해볼 것

- [ ] `not_found_handling = "404-page"` 인데 `public/404.html` 이 없다. 현재는 평문 404 응답
- [ ] JSON-LD (`TechArticle`) 추가 여부 — 검색 결과 표시에 도움될 수 있음
- [ ] 폰트를 CDN 대신 self-host 할지 (초기 렌더 지연)
