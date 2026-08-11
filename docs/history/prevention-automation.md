# 반복 결함 유형 분석과 사전 방지 · 자동화 설계

> 대상: `docs/history/` 하위 6개 히스토리 문서 + `solution-review.md`
> (`blur` · `bsd` · `event-stream` · `sr` · `vwc` · `vwc-media` — 6개 저장소, 약 2,500 커밋)
>
> 기존 문서와의 역할 분담
> - `*-history.md` — **무엇이 터졌고 어떻게 고쳤는가** (저장소별 기록)
> - `solution-review.md` — **그 해결이 정당했는가** (해결 품질 평가)
> - **이 문서** — **왜 반복됐고, 다음에 무엇으로 막을 것인가** (유형 분류 → 방지 → 자동화)
>
> 원칙: 사람의 주의력에 기대는 대책은 이미 6번 실패했다.
> 여기서 제안하는 것은 **강제력이 있는 장치**(타입 · 테스트 · 빌드 게이트 · 알람)에 한정한다.

---

## 목차

1. [요약 — 3장으로 보는 결론](#1-요약--3장으로-보는-결론)
2. [공통 결함 유형 10가지](#2-공통-결함-유형-10가지)
3. [왜 반복됐는가 — 구조적 원인 3가지](#3-왜-반복됐는가--구조적-원인-3가지)
4. [사전 방지 — 단계별 강제 지점](#4-사전-방지--단계별-강제-지점)
5. [자동화 설계](#5-자동화-설계)
6. [실행 로드맵](#6-실행-로드맵)
7. [부록 — 구현 스케치](#7-부록--구현-스케치)

---

## 1. 요약 — 3장으로 보는 결론

### 1-1. 결함은 흩어져 있지 않다. 10개 유형이 전부다

6개 저장소, 서로 다른 도메인(미디어 처리 · 택시 텔레메트릭 · 블랙박스 스트리밍 · 클라우드 파일 API)인데
**결함 유형은 거의 동일했다.** 아래 표의 "저장소 수"가 그 근거다.

| # | 유형 | 저장소 | 대표 사례 |
|---|---|---|---|
| A | 컴파일러가 검증하지 않는 문자열 | **6 / 6** | S3 키 `//`, MyBatis 컬럼명, `order_updates: ture`, FFmpeg 단위 `k` |
| B | 조용한 실패 (예외 없이 틀린 결과) | **5 / 6** | 확장자 검증 누락, `limit(1000)` 절단, 매핑 안 된 DTO 필드 null |
| C | 종료 조건 없는 재시도 루프 | 2 / 6 | 시퀀스 21억 소진, 동일 uuid 무한 재큐잉 |
| D | 인메모리 동시성 제어의 실패 | 3 / 6 | `synchronized` 컬렉션 → DB 상태값/원자 UPDATE로 수렴 |
| E | 트랜잭션 · 커넥션 경계와 I/O 중첩 | 3 / 6 | OSIV 핀닝, 트랜잭션 안 KVS/MQTT 왕복, 거대 배치 트랜잭션 |
| F | 외부 시스템 계약을 검증 없이 신뢰 | 4 / 6 | `success:true` 인데 결과 없음, 헤더 기준 파서, 단말 타임스탬프 |
| G | 단위 · 좌표계 변환 지점 누락 | 2 / 6 | frame↔ms, sec↔ms, rotation 좌표 역변환, byte↔MB |
| H | 대증요법이 원인 규명을 늦춤 | 4 / 6 | 타임아웃 상향, 큐 무제한, `limit` 추가 |
| I | 대규모 리네임 · 마이그레이션 파급 | 4 / 6 | `dvc_id`→`serial` 3회 보정, Boot2→3 transitive 의존성 |
| J | 크리덴셜 평문 · "임시" 조치 잔존 | 3 / 6 | JWT secret 평문 커밋, CORS 전체 허용, in-memory Redis mock |

### 1-2. 문제는 결함이 아니라 **발견 시점**이었다

거의 모든 항목이 **운영에서 발견됐다.** 같은 결함이라도 발견 시점이 왼쪽일수록 비용이 지수적으로 싸다.

```
타입/IDE  →  빌드  →  단위테스트  →  CI 게이트  →  기동 시  →  QA  →  운영
  (0)        (1)        (10)         (30)        (100)     (300)  (3000)
                                                              ↑
                                            6개 문서의 사례 대부분이 여기
```

**이 문서의 목표는 각 유형을 한 칸이라도 왼쪽으로 옮기는 것**이며, 5장의 자동화 항목은 전부 그 관점으로 설계했다.

| 유형 | 현재 발견 시점 | 옮길 수 있는 시점 | 수단 |
|---|---|---|---|
| A | 운영 | CI / 기동 시 | 금지 패턴 게이트, `@ConfigurationProperties` + `@Validated` |
| B | 운영(지연 발견) | 단위 테스트 | 폴백 금지 규칙, 절단 감지 로그·메트릭 |
| C | 운영(대형 장애) | 설계 | 재시도 3요건 템플릿 + ArchUnit |
| D | 스케일아웃 시점 | 단위 테스트 | 동시성 회귀 테스트 하네스 |
| E | 운영(커넥션 고갈) | CI | ArchUnit(트랜잭션 내 외부 클라이언트 호출 금지) |
| F | 운영 | 계약 테스트 | 실응답 덤프 기반 역직렬화 테스트 |
| G | 운영 | 컴파일 | 값 객체(VO) |
| H | — | 리뷰 | 완화 조치 시 원인 티켓 강제 |
| I | 운영 | CI | 매핑 로드 테스트, 스키마 validate |
| J | 미해결 | 커밋 시점 | 시크릿 스캐너 pre-commit + CI |

### 1-3. 가장 효과가 컸던 단일 대응은 이미 나와 있다

`vwc` `d426a19` — **MyBatis 매퍼 XML 전체 로드 테스트**.
XML 매핑 오류는 컴파일에 걸리지 않고 해당 API를 호출해야만 터지는데, 이걸 CI로 끌어왔다.
`solution-review.md`도 이를 "6개 문서 전체를 통틀어 가장 파급력 큰 대응"으로 꼽았다.

**핵심은 MyBatis가 아니라 그 발상이다** — *런타임에만 드러나는 검증을 빌드 시점으로 당긴다.*
5장은 이 발상을 booster 스택(JPA · Kafka · Redis · Gradle · Jenkins)에 옮겨 적용한 것이다.

---

## 2. 공통 결함 유형 10가지

각 유형은 **정의 → 증거 → 왜 반복되는가 → 막는 방법**으로 기술한다.

---

### A. 컴파일러가 검증하지 않는 문자열 — 6/6 저장소

**정의** — 경로 · 키 · 컬럼명 · 외부 커맨드 · 설정값처럼, 문자열로 조립되어 컴파일러 · IDE · 타입 시스템 어디에도 걸리지 않는 값.

**증거**

| 하위 유형 | 사례 |
|---|---|
| S3 키 / 파일 경로 조립 | `event-stream` §5(`//` 중복), `vwc-media` §2-2, §3-1(경로 5커밋 소모), `blur` §7(구분자 이슈 4건 + `mkdirs` 6건) |
| DB 컬럼명 (XML/네이티브 쿼리) | `vwc-media` §6-1(`dvc_id`→`serial` 3회 보정), `vwc` §6.1, `blur` §6-2(오매핑 7건) |
| 설정 파일 오타 | `vwc-media` §6-4 (`order_updates: ture` — 조용히 무시됨) |
| 외부 커맨드 옵션 | `blur` §1-2 (`-b:v` 단위 `k` 누락 → 화질 저하), 옵션 순서(`8b578fa`) |
| 로그 메시지 하드코딩 | `sr` §4 (`download failed`가 파싱·작업 실패까지 뭉뚱그려 오진 유발) |
| 여러 곳에 흩어진 상수 | `event-stream` §1-2 (패킷 크기 상수가 서버·클라·버퍼 3곳 → 한 곳만 고쳐 회귀) |

**왜 반복되는가** — 같은 규칙(경로 조립 규칙, 컬럼명, 버퍼 크기)이 **2곳 이상에 독립 구현**되어 있으면 한쪽만 고쳐진다.
`vwc-media` §3-1이 전형이다. "다운로드 · 변환 · 스트림 응답" 세 군데가 각자 경로를 계산했고, 5개 커밋을 소모했다.

**막는 방법**
1. 규칙을 **단일 함수**로 모으고 나머지는 호출만 한다 (`FileUtil.getFileNameWithoutExt`가 그 결론이었다).
2. 흩어질 수밖에 없는 상수는 **한 상수를 세 곳이 참조**하게 하고, 세 값의 일치를 테스트로 고정한다.
3. 설정값은 `@ConfigurationProperties` + `@Validated`로 받고, **기동 시 실제 적용값을 로깅**한다. `ture` 같은 오타가 기동 로그에서 잡힌다.
4. 금지 패턴은 CI grep 게이트로 (→ 5-1).

---

### B. 조용한 실패 — 5/6 저장소, 가장 늦게 발견되는 유형

**정의** — 예외도 로그도 없이 **틀린 결과 또는 빈 결과**를 반환하는 코드.

**증거**

- `vwc` §4.3 — `fileExt`를 `avi`만 검증 → mp4 파일이 "없음"으로 표시
- `vwc` §4.3 — `pushSubType` 비교 문자열이 단말 실제 값과 달라 분기가 전부 미실행
- `vwc` §2.3 — `limit(1000)`: 1,001번째부터 존재하지만 보이지 않는 데이터 (`solution-review` §1-2에서 🔴)
- `sr` §5 / `83b28c3` — 응답 DTO 필드 불일치 → OCR 텍스트가 **항상 null**로 저장 (한참 뒤 발견)
- `vwc-media` §6-4 — yml boolean 오타로 배치 정렬이 비활성 상태였음
- `vwc-media` §5-2 — null을 기본값으로 채우던 폴백이 클라이언트 seek 위치를 어긋나게 함

**왜 반복되는가** — 세 가지 습관이 원인이다.
① 폴백으로 기본값 채우기, ② 예외를 `Optional.empty()`/빈 리스트로 흡수, ③ 방어 목적의 상한(`limit`)을 예외 없이 자름.
셋 다 "당장 화면이 안 깨지게" 만드는 조치이며, 그 대가로 **오류가 데이터에 스며든다.**

**막는 방법**
1. **폴백 금지를 기본값으로.** 값이 없으면 `null`을 채우지 말고 그대로 비운다. `vwc-media` `d4e2886`(폴백 제거)이 정확한 방향이었다.
2. **상한에는 관측을 붙인다.** `limit(n)`이 필요하면 `limit(n+1)`로 조회해 초과 시 `log.warn` + 메트릭. 이상적으로는 페이징.
3. **"조용히 빈 결과"가 나올 수 있는 분기에는 회귀 테스트를 강제한다.** `vwc` §4.3이 실제로 그렇게 마무리됐다.
4. 외부에서 오는 열거값(확장자 · 타입 문자열) 비교는 문자열이 아니라 **enum + `EnumSet`** 으로. 매칭 실패는 예외 또는 `ERROR` 값 + warn (`vwc-media` §2-6이 좋은 예).

---

### C. 종료 조건 없는 재시도 루프 — 2/6 저장소, 그러나 대형 장애 2건

**증거**

| | `bsd` §2 | `sr` §5 |
|---|---|---|
| 증상 | 매분 재시도 → int4 시퀀스 21억 소진 → **GPS 적재 전면 실패** | 동일 uuid 무한 재큐잉, 상태가 FAILED로 확정되지 않음 |
| 직접 원인 | 검증이 부수효과(COPY) 뒤에 있었음 | 예외가 좁은 catch를 빠져나가 상위 재큐잉 경로로 |
| 공통 근본 원인 | **재시도 루프에 종료 조건이 없었다** | 동일 |
| 해결 품질 | ✅ 영구 실패 상태 `migrate_flag='E'` | 🟠 특정 케이스 가드에 머무름 |

**왜 반복되는가** — 재시도는 "안정성을 위해" 넣는 코드라 **위험 요소로 인식되지 않는다.**
그리고 `bsd`가 두 달 먼저 얻은 교훈이 `sr`로 전파되지 않았다(→ 3-1).

**막는 방법 — 재시도 루프 3요건 (예외 없음)**
1. **시도 횟수 상한** — `attempt_count` 컬럼 + `MAX_ATTEMPTS`
2. **영구 실패 상태** — 재시도 대상에서 제외되는 종료 상태가 반드시 존재
3. **재시도 대상은 화이트리스트** — "이 예외들만 실패 처리"가 아니라 **"이 예외들만 재시도"**

추가로 지수 백오프. 매분 재시도는 실패 상황에서 외부 서버를 함께 두들긴다.

> booster는 Outbox + Kafka Consumer 구조라 이 유형에 **직접 노출**된다.
> `OutboxMessageRelay` 폴링과 Kafka Consumer 재처리 양쪽 모두 위 3요건이 필요하고, DLQ가 그중 2번에 해당한다.

---

### D. 인메모리 동시성 제어의 실패 — 3/6

**증거**
- `blur` §3 — `waitList`/`downList` + `synchronized` → check-then-act 경쟁 조건 → 프로세스 분리 → **결국 DB 상태값(`RESERVE_INFERENCE`)** 도입 (3회 시도)
- `blur` §5 — 크레딧 낙관적 락 → **DB 원자적 UPDATE**로 수렴 (하루에 4커밋)
- `vwc` §1.1 — `pendingMap.put`으로 future 덮어쓰기 → 큐 기반 FIFO 매칭
- `vwc` §1.2 — `SseEmitter` 동시 write → `ReentrantLock` 직렬화

**공통 궤적** — 애플리케이션 레벨 락으로 시작 → 실패 → **DB 레벨 원자 연산으로 수렴.**
`blur`는 두 도메인에서 독립적으로 같은 결론에 도달했다.

**막는 방법**
1. 공유 상태의 상호배제는 **처음부터 DB 원자 연산**으로 설계한다.
   ```sql
   -- 작업 선점: rowCount == 1 일 때만 진행
   UPDATE ai_file SET state='RESERVE', reserved_at=now(), reserved_by=:instance
    WHERE id=:id AND state='DOWNLOADED';
   -- 또는 PostgreSQL 작업 큐 표준
   SELECT ... FOR UPDATE SKIP LOCKED
   ```
2. 선점 상태에는 **회수 경로**(`reserved_at` 타임아웃)를 함께 만든다. 없으면 프로세스 강제 종료 시 영구 정지 행이 생긴다.
3. **단일 인스턴스에서는 드러나지 않는다**는 점이 핵심 위험이다. Scale-out을 목표로 하는 booster에서는 인메모리 상태 자체가 설계 결함이다.
4. 동시성 수정에는 **동시 호출 회귀 테스트를 필수 첨부**한다 (→ 5-2).

---

### E. 트랜잭션 · 커넥션 경계와 I/O 중첩 — 3/6

**증거**
- `bsd` §1-1 — 클래스 레벨 `@Transactional` 때문에 **S3 업로드 구간까지** 커넥션 점유 → 풀 고갈
- `bsd` §1-2 / `vwc-media` §6-4 — **OSIV 기본값 true**로 요청 전 구간 커넥션 핀닝 (두 저장소에서 독립 발생)
- `vwc` §2.2 — 트랜잭션 점유 중 KVS/MQTT 왕복
- `bsd` §3-3 — 거대 배치 트랜잭션 = 커넥션 장기 점유 + 전량 롤백

**막는 방법**
1. `spring.jpa.open-in-view: false`를 **공통 모듈 기본값**으로 (booster는 `libs/storage-db`가 그 자리다).
2. Hikari `leak-detection-threshold` + 커넥션 풀 메트릭을 **처음부터** 켠다. `bsd`가 이걸로 진단했다.
3. 커밋 후 발행은 `@TransactionalEventListener(AFTER_COMMIT)` — self-proxy는 안티패턴(`solution-review` §2-3).
   booster는 이미 Outbox 패턴을 채택했으므로 발행 보장이 필요한 경로는 Outbox로 올린다.
4. 읽기 전용 외부 왕복은 `@Transactional(NOT_SUPPORTED)`.
5. **ArchUnit으로 강제 가능한 유형이다** (→ 5-2).

---

### F. 외부 시스템 계약을 검증 없이 신뢰 — 4/6

**증거**
- `sr` §5 — LPR 서버가 미검출에도 `success:true`(HTTP 200) 반환. 앱은 도메인 필드(`plate_found`)를 보지 않고 업로드 시도 → 무한 재시도 장애의 출발점
- `sr` §5 / `83b28c3` — 응답 DTO가 실제 응답 구조와 불일치 → 필드가 조용히 null
- `event-stream` §2-2 — **헤더 파일 기준**으로 작성한 바이너리 파서가 실제 데이터와 불일치. 덤프 → 헥스 로깅 → 오프셋 역산으로만 해결
- `event-stream` §3-2 — 단말 타임스탬프가 수 초씩 점프 → 전부 자체 생성으로 전환
- `vwc` §8.2 — 미들웨어팀과의 토픽/헤더 계약 불일치 4건

**수렴한 결론** — *"외부 입력값은 신뢰하지 않고, 계약은 문서가 아니라 실측으로 검증한다."*

**막는 방법**
1. 외부 응답 DTO는 **실제 응답을 파일로 덤프해 두고 역직렬화 테스트를 고정**한다. 이게 계약 테스트의 최소 형태다.
2. 테스트에서는 `FAIL_ON_UNKNOWN_PROPERTIES=true`로 **모르는 필드를 실패로** 만들고, 운영 코드에는 `@JsonIgnoreProperties(ignoreUnknown=true)`를 둔다. 스펙 변경을 테스트가 먼저 잡는다.
3. HTTP 200 / `success:true`는 전송 성공일 뿐이다. **도메인 결과 필드까지 확인**하고, 그 검증을 DTO 매핑 직후 한 곳에서 수행한다.
4. 바이너리 · 미디어 규격은 **골든 파일 테스트**. 샘플 입력 → 산출물의 핵심 속성(길이 · 해상도 · 프레임 수)을 고정한다.
   `event-stream` §3-5(SPS/PPS를 하루 4커밋 왕복 후 롤백)는 검증 기준이 없어 발생한 비용이었다.

---

### G. 단위 · 좌표계 변환 지점 누락 — 2/6, 그러나 가장 오래 끈 항목

**증거**
- `blur` §1-1 — rotation 처리를 1년 넘게 **6회** 재발. 썸네일/HLS/렌더링/좌표 CSV 네 경로가 각자 회전을 소비
- `blur` §1-5 — frame → ms 전환 중 duration 단위(sec→ms) 실수로 **썸네일 개수가 1000배**
- `blur` §1-2 — bitrate 단위 `k` 누락
- `vwc-media` §3-6 — `duration` 초 → ms, `fileSize` byte → MB
- `vwc` §4.2 / §4.4 — 날짜 기준 컬럼과 타임존이 화면마다 달라 **같은 주행이 다른 날짜로 표시**

**막는 방법**
1. **단위는 타입으로 감싼다.** `Duration`, `Millis`, `Bitrate.ofKbps(2000)`, `Rotation`. 원시 `int`/`double`로 흘리면 변환 지점마다 터진다. `blur` §11-2가 스스로 *"단위를 타입으로 감싸지 않은 대가"* 라고 적었다.
2. **진입점에서 1회 정규화(bake)** 한다. rotation은 업로드 직후 픽셀에 굽고 메타를 제거했다면 아래 전 단계가 rotation을 몰라도 됐다(`solution-review` §2-7).
3. **시각은 저장·전달·표시 기준을 문서 한 곳에 못박는다.** UTC 저장 / 표시 시점 변환 중 하나로 통일하고, 같은 지표를 두 API가 다른 소스로 계산하지 않는다(`bsd` §4-5).

---

### H. 대증요법이 원인 규명을 늦춤 — 4/6

**증거**

| 조치 | 실제 원인 | 규명까지 | 평가 |
|---|---|---|---|
| MQTT future 타임아웃 3s → 10s (`vwc` `3a8e9cb`) | future 덮어쓰기 + 구독 누락 | **8일** | 유예 |
| 스레드풀 큐 2000 → 무제한 (`blur` `9ee4061`) | 생산 속도 > 소비 속도 (설계) | — | 🔴 거부를 OOM과 맞바꿈 |
| 전체 조회에 `limit(1000)` (`vwc` `4e65eb5`) | 페이징 부재 | — | 🔴 성능 문제를 정확성 문제로 |
| LPR 타임아웃 70s → 300s (`sr` `4f2cf12`) | 추론 시간 자체가 김 | — | ✅ 타당 |

**구분 기준** — 정상 케이스의 소요 시간 분포(p99)를 **알고** 늘렸으면 정답, 모르고 늘렸으면 유예다.

**막는 방법**
- 완화 조치(타임아웃 상향 · 상한 완화 · 재시도 추가)는 금지하지 않는다. 다만 **원인 티켓 번호를 커밋 본문에 남기는 것을 규약화**한다.
- 큐가 넘치면 무제한으로 열지 말고 백프레셔(`CallerRunsPolicy` / 세마포어). **거부는 신호이지 버그가 아니다.**

---

### I. 대규모 리네임 · 마이그레이션 파급 — 4/6

**증거**
- `vwc` §6.1 — 스키마 리팩터링 후 컴파일 에러 · 매핑 누락 · 한글 깨짐 · BOM 오류가 연쇄
- `vwc-media` §6-1 — `dvc_id`→`serial`을 **3회에 나눠** 보정
- `vwc` §6.3 — Boot2→3 전환 후 springfox · QueryDSL · **transitive org.json 구버전** 등 파생 5건
- `blur` §6-2 — 테이블 대규모 리네이밍 시기에 컬럼 오매핑 7건 집중

**핵심 통찰** — **컴파일러는 절반만 잡는다.** XML 매퍼 · SQL 문자열 · 로그 인코딩 · yml은 전부 통과한다.

**막는 방법**
1. 리네임 **착수 전에** 매핑 로드 테스트를 먼저 넣는다 (`d426a19`). 순서가 중요하다.
2. `Grep` 전수 검색 후 **일괄 처리**. 세 번 나눠 하면 세 번 다 누락된다.
3. Hibernate `ddl-auto: validate`를 CI에서 실제 스키마 대상으로 실행하면, 엔티티↔스키마 드리프트가 기동 시점에 잡힌다.
4. transitive 의존성은 `./gradlew dependencies`로 **실제 해결 버전을 확인**하고 필요하면 명시 선언으로 override.

---

### J. 크리덴셜 평문 · "임시" 조치 잔존 — 3/6, 전부 미해결

**증거**
- `vwc` §5.2 / `vwc-media` §9 — Firebase 키 · AWS IAM 키 · DB 접속정보 · Google OAuth secret · **JWT 서명 secret** · Apple `.p8`가 평문 커밋. 두 저장소 모두 "rotate 필요"로 정확히 진단했으나 **양쪽 다 미해결**
- `vwc` §9-2 — `AppRedisClient` 임시 in-memory mock이 프로파일 분기 없이 전 환경 적용
- `vwc-media` §4-4 — CORS `setAllowedOriginPatterns("*")` + `allowCredentials(true)` 임시 전체 허용 유지
- `vwc-media` §1-4 / §9 — `endpointOverride` 주석 처리 등 "임시/일딴/추후" 잔존 9건

**막는 방법**
1. 시크릿은 **첫 커밋부터 외부화**. 나중에 빼면 이력에 남아 rotate가 강제된다.
2. **시크릿 스캐너를 pre-commit + CI 양쪽에** 건다 (→ 5-1). 이건 자동화로 완전히 해결되는 유일한 유형이다.
3. "임시" 코드에는 **만료일과 티켓을 코드에 박고**, 만료일 경과 시 빌드가 경고하도록 한다 (→ 5-1 `TODO(expires=...)` 룰).

---

## 3. 왜 반복됐는가 — 구조적 원인 3가지

유형별 원인은 2장에 적었다. 여기서는 **유형을 가로질러 공통인 것**만 본다.

### 3-1. 지식이 저장소 경계를 넘지 못했다

`solution-review.md` §4-1이 확인한 **독립 재발 4건**:

| 결함 | 먼저 해결한 곳 | 그런데 다시 발생한 곳 |
|---|---|---|
| 스프라이트 격자를 예상 프레임 수로 선할당 → 검은 줄 | `event-stream` (05-11) | `vwc-media` (07월) |
| OSIV 기본값 true로 커넥션 핀닝 | `bsd` (06-30) | `vwc-media` |
| S3 키 선행 슬래시로 `//` | `event-stream` (03-06) | `vwc-media` / `blur` |
| 무한 재시도 루프 | `bsd` (06-23, 근본 해결) | `sr` (07-06, 케이스 가드) |

앞의 두 건은 **A가 먼저 해결됐는데도 B에서 다시 발생했다.** 같은 조직 · 같은 스택인데 교훈이 전달되지 않았다.

**대응** — 문서로는 전달되지 않았다는 것이 이미 증명됐다. **공통 모듈의 기본값과 CI 룰에 박는 것**만 실효가 있다.
booster의 `libs/*` 구조와 `init-service-module.sh`가 정확히 그 자리다.

### 3-2. 규약이 타입이나 테스트가 아니라 "관례"로만 존재했다

- "음수 id는 미영속 엔티티" — 코드 관례. 새 코드가 분기를 빠뜨리면 재발 (`vwc` §4.1)
- "경로는 확장자를 제거해서 만든다" — 3개 클래스에 흩어짐 (`vwc-media` §3-1)
- "패킷 크기는 4MB" — 3곳에 각각 상수 (`event-stream` §1-2)
- "rotation은 진입점마다 정규화" — 소비자가 늘 때마다 재발 (`blur` §1-1)

**대응** — 규약은 강제력이 있는 곳으로 옮긴다. 강제력 순위: **타입 > 테스트 > 빌드 게이트 > 리뷰 체크리스트 > 문서.**
지금까지의 대응은 대부분 맨 오른쪽이었다.

### 3-3. 검증 기준을 정하지 않고 착수했다

`event-stream` §6-5가 스스로 짚었다 — *"왕복이 잦았던 구간은 검증 기준이 없던 구간이다."*

- SPS/PPS extradata: 하루 4커밋 왕복 후 롤백 (ffprobe 기준을 먼저 고정했다면 1회)
- 먹싱 구현 3회 전환, ClamAV 연동 3회 전환, rotation 6회 재발
- 반대로 후반부(`b289c8e`, `2316ca2`, `74e0ea5`)는 **테스트를 함께 넣으면서 한 번에 마무리**됐다

**대응** — 포맷 · 규격 · 인코딩 · 성능처럼 왕복이 예상되는 작업은 **"무엇이 만족되면 끝인가"를 실행 가능한 형태(테스트/스크립트)로 먼저 만든다.**

---

## 4. 사전 방지 — 단계별 강제 지점

3-2의 원칙(강제력 있는 곳으로 옮긴다)에 따라, 방지책을 **어느 단계에서 강제할지**로 재배치한다.

### 4-1. 프로젝트 부트스트랩 — 한 번에 끝나는 것들

booster는 `libs/*` 공통 모듈과 `init-service-module.sh` / `init-lib-module.sh`를 갖고 있다.
**아래 항목은 문서가 아니라 이 두 곳에 박는다.**

| 항목 | 박을 위치 | 막는 유형 |
|---|---|---|
| `spring.jpa.open-in-view: false` | `libs/storage-db` 기본 설정 | E |
| Hikari `leak-detection-threshold: 60s` + 풀 메트릭 | `libs/storage-db` | E |
| 모든 HTTP 클라이언트에 connect/read 타임아웃 (Feign 포함) | `libs/core-web` | E, F |
| PK `bigint` + 시퀀스 사용률 알람 | `BaseEntity` / 관측 스택 | C |
| Jackson `FAIL_ON_UNKNOWN_PROPERTIES` — 운영 false, **테스트 true** | `libs/common` | F |
| 소스·리소스 인코딩 UTF-8 강제 | 루트 `build.gradle` | A, I |
| 재시도 정책 기본 골격(상한 · 영구 실패 상태 · 백오프) | `libs/core-resilience` | C |
| 시크릿 외부화 (환경변수 / 시크릿 매니저) | 템플릿 | J |

### 4-2. 설계 시점 — 스펙에 넣을 6문항

`.claude/skills/spec-writer`, `spec-review` 산출물에 **아래 6문항 답변을 필수 섹션으로 추가**한다.
전부 실제로 대가를 치른 항목이다.

1. **실패하면 어떻게 되는가** — 재시도하는가? 상한과 영구 실패 상태는? (유형 C)
2. **동시에 두 번 들어오면 어떻게 되는가** — 선점은 DB 원자 연산인가, 인메모리인가? (유형 D)
3. **이 트랜잭션 안에 네트워크 I/O가 있는가** — 있다면 왜 밖으로 못 빼는가? (유형 E)
4. **외부 응답의 어떤 필드로 성공을 판정하는가** — HTTP 200 / `success:true` 이상의 근거가 있는가? (유형 F)
5. **단위와 시간대는 무엇인가** — ms/sec, byte/MB, UTC/로컬. 타입으로 감쌌는가? (유형 G)
6. **무엇이 만족되면 완료인가** — 실행 가능한 검증 기준이 있는가? (원인 3-3)

### 4-3. 코드 작성 시 — 타입으로 밀어 올리기

- 단위 · 각도 · 식별자는 **값 객체**로 (유형 G)
- 외부 열거값은 **enum + `EnumSet`**, 매칭 실패는 명시적 처리 (유형 B)
- 광범위 `catch` 금지 — `catch (RuntimeException) → 401`, `catch (Exception) → InvalidRequestException` 모두 진단 능력을 없앴다
- `InterruptedException`에서 `RuntimeException` 재던지기 금지 → `Thread.currentThread().interrupt()`
- 로그의 단계 구분은 문자열이 아니라 **MDC + 예외 타입**으로 (`sr` §4 개선안)
- 조회 편의로 가짜 엔티티 합성 금지 — DTO로 내리거나 upsert로

### 4-4. 리뷰 — 3문항으로 줄인다

체크리스트가 길면 아무도 안 본다. `.claude/skills/review`에 주입할 **핵심 3문항**:

1. 이 변경은 **조용히 실패할 수 있는가?** (폴백 · 상한 절단 · 빈 결과 반환)
2. 이 변경은 **증상 완화인가 원인 제거인가?** 완화라면 원인 티켓이 커밋 본문에 있는가?
3. 이 규칙이 **다른 곳에도 중복 구현되어 있지 않은가?** (경로 · 상수 · 비트 매핑 · 집계 규칙)

---

## 5. 자동화 설계

**선정 기준** — 6개 문서에서 실제로 발생한 유형만 대상으로 하고, booster 스택(Gradle 멀티모듈 · Jenkins · JPA · Kafka)에 지금 붙일 수 있는 것만 넣었다.

> ⚠️ **선행 조건**: 현재 `Jenkinsfile`은 `./gradlew clean build -x test`로 **테스트를 건너뛴다.**
> 아래 게이트 대부분이 테스트 태스크에 붙으므로, 최소한 **검증 전용 태스크는 배포 파이프라인에서 실행**되어야 한다.
> 이 한 줄이 바뀌지 않으면 나머지 자동화는 전부 무효다.

### 5-1. Tier 1 — 즉시 도입 (반나절 이내, 효과 큼)

| # | 자동화 | 막는 유형 | 구현 위치 | 비용 |
|---|---|---|---|---|
| 1 | **시크릿 스캐너** (gitleaks) — pre-commit hook + Jenkins stage | **J** | `.git/hooks` + Jenkinsfile | 30분 |
| 2 | **금지 패턴 게이트** — `./gradlew verifyConventions` | A, B, H, J | 루트 `build.gradle` | 2시간 |
| 3 | **설정 검증** — `@ConfigurationProperties` + `@Validated` + 기동 시 적용값 로깅 | A | `libs/common` | 2시간 |
| 4 | **의존성 잠금** — `dependencyLocking` + transitive 버전 리포트 | I | 루트 `build.gradle` | 1시간 |

**금지 패턴 게이트 룰 초안** (전부 실제 사례 기반, 부록 7-1에 구현)

| 룰 | 근거 사례 |
|---|---|
| MyBatis `${}` 사용 금지 (화이트리스트 외) | `vwc` §5.1 SQL 인젝션 |
| `catch (Exception` 후 특정 HTTP 상태 하드코딩 금지 | `vwc-media` §4-1 (모든 예외가 401) |
| `catch (InterruptedException` 블록 내 `throw new RuntimeException` 금지 | `sr` §8-2 |
| yml boolean 값이 `true/false`가 아닌 경우 실패 | `vwc-media` §6-4 (`ture`) |
| 하드코딩된 credential 형태 문자열 (`AKIA`, `-----BEGIN`, `jwt.secret:` 리터럴) | `vwc` §5.2 |
| `TODO`/`FIXME`/`임시`에 티켓·만료일 없으면 경고, 만료일 경과 시 실패 | `vwc-media` §9 (임시 조치 9건 잔존) |
| `allowedOriginPatterns("*")` + `allowCredentials(true)` 동시 사용 금지 | `vwc-media` §4-4 |

### 5-2. Tier 2 — 1~2주 내 (구조적 방어)

| # | 자동화 | 막는 유형 | 설명 |
|---|---|---|---|
| 5 | **ArchUnit 규칙 테스트** | D, E, I | `d426a19`의 booster 판본. 부록 7-2에 규칙 6개 초안 |
| 6 | **JPA 쿼리 · 스키마 검증 테스트** | A, I | 모든 Repository의 파생 쿼리 · `@Query`를 컨텍스트 기동 시 검증 + `ddl-auto: validate`를 CI에서 실제 스키마 대상 실행 |
| 7 | **외부 응답 계약 테스트** | F | 실응답 JSON을 `src/test/resources/contracts/`에 덤프해 두고, `FAIL_ON_UNKNOWN_PROPERTIES=true`로 역직렬화. 스펙이 바뀌면 테스트가 먼저 깨진다 |
| 8 | **동시성 회귀 테스트 하네스** | D | `libs/*` testFixtures에 "N스레드 동시 호출 → 결과 불변식 검증" 유틸. 동시성 수정 PR에는 이 테스트 첨부를 규약화 |
| 9 | **Testcontainers 기반 통합 테스트** | A, E, F, I | H2와 PostgreSQL의 방언 차이로 인한 조용한 실패를 제거. Redis/Kafka도 동일 |

**ArchUnit이 막는 것** (히스토리 사례 → 규칙):

| 히스토리 사례 | ArchUnit 규칙 |
|---|---|
| `bsd` §1-1 트랜잭션 안 S3 업로드 | `@Transactional` 메서드에서 `*Client`/`S3*`/`Kafka*` 호출 금지 |
| CLAUDE.md 모듈 의존성 규칙 | `apps/*` → `apps/*` 금지, `libs/*` → `apps/*` 금지 |
| CLAUDE.md Entity 규칙 | 엔티티에 `set*` 메서드 금지, `@NoArgsConstructor(PROTECTED)` 필수 |
| `vwc-media` §4-1 광범위 catch | Controller/Facade에서 `catch (Exception)` 후 상태코드 하드코딩 금지 |
| `blur` §11 / `solution-review` §1-4 | 외부 프로세스 · 무제한 스레드풀 생성 금지 (`Executors.newCachedThreadPool` 등) |
| AOP self-invocation (CLAUDE.md 실수 기록) | 같은 클래스 내 `@Cacheable`/`@Transactional`/`@Async` 메서드 호출 탐지 |

> 마지막 규칙은 이 저장소의 메모리에 **실제 실수 기록**(2025-02-05 `SpecialDayCacheService`)이 남아 있는 항목이다.
> 체크리스트로 관리했는데도 문서 작성 직후 같은 실수가 났다 — 3-2의 정확한 사례이므로 **테스트로 옮겨야 한다.**

### 5-3. Tier 3 — 운영 관측 (조용한 실패를 소리나게)

유형 B와 C는 **코드가 아니라 운영 지표로만 잡힌다.** booster는 Prometheus/Grafana/Loki/Tempo가 이미 있으므로 메트릭만 추가하면 된다.

| 메트릭 / 알람 | 근거 사례 | 임계 |
|---|---|---|
| 시퀀스 사용률 `last_value / max_value` | `bsd` §2 (21억 소진 → COPY 전면 실패) | 70% 경고 |
| Hikari 활성 커넥션 · 대기 시간 · 누수 경고 수 | `bsd` §1 | 풀 80% |
| **재시도 `attempt_count` 분포 · 최대값** | `bsd` §2, `sr` §5 | max ≥ MAX_ATTEMPTS 즉시 |
| **조회 상한 도달 횟수** (`limit(n+1)` 패턴) | `vwc` §2.3 | 1건이라도 발생 시 warn |
| Outbox 미발행 적체(lag) · 최고 재시도 횟수 | booster 고유 (Outbox 패턴) | lag > 1분 |
| Kafka Consumer lag · DLQ 유입 | booster 고유 | DLQ > 0 |
| 스레드풀 큐 깊이 · 거부 건수 | `blur` §2 (큐 무제한화의 대안) | 큐 80% |
| 외부 호출 p99 latency | `solution-review` §4-3 (타임아웃 상향의 근거) | 상시 대시보드 |

**추가로 런북을 자산화한다.** `bsd`가 6개 저장소 중 유일하게 한 일이고, 원인 규명 품질이 가장 높았던 이유이기도 하다.
`docs/runbook/` 아래에 ① 커넥션·스레드 점유 진단 절차, ② 진단 SQL 스니펫, ③ 롤백 가이드.

### 5-4. Tier 4 — 에이전트 자동화 (이 저장소의 강점 활용)

`.claude/skills`에 이미 20개 스킬이 있다. **히스토리에서 얻은 결함 카탈로그를 스킬에 주입**하면, 리뷰 품질이 사람 주의력에 의존하지 않는다.

| 자동화 | 형태 | 내용 |
|---|---|---|
| **결함 카탈로그 주입** | 기존 `review` · `anti-pattern` 스킬 보강 | 2장의 10개 유형을 탐지 항목으로 명시. "조용한 실패 가능성", "완화 vs 원인 제거", "규칙 중복 구현" 3문항(4-4)을 필수 출력 섹션으로 |
| **`/retro-check`** (신규) | 스킬 | 현재 diff를 10개 유형에 매칭해 해당 유형의 과거 사례와 함께 경고. 예: 재시도 코드 추가 감지 → `bsd` §2 사례 + 3요건 제시 |
| **`/postmortem`** (신규) | 스킬 | `fix(...)` 커밋에서 증상·원인·해결·유형을 추출해 `docs/history/booster-history.md`에 append. **히스토리 문서를 사후 대량 작성이 아니라 상시 누적으로** 전환 |
| **커밋 메시지 게이트** | git `commit-msg` hook | Conventional Commits 강제 + `fix(...)`에는 본문 필수. `vwc` §10-6이 *"커밋 메시지 형식 전환이 해결의 깊이 자체를 바꿨다"* 고 관찰한 항목 |
| **편집 직후 룰 경고** | `.claude/settings.json` PostToolUse hook | Edit/Write 직후 5-1 금지 패턴을 즉시 검사 → CI까지 안 가고 편집 시점에 피드백 (부록 7-3) |

> `/postmortem`이 이 목록에서 가장 중요하다.
> 6개 문서 모두 **프로젝트가 끝난 뒤 커밋 로그를 역추적해** 작성됐고, 그래서 초기 커밋(`[modify] 오류 수정` 152건)은 분석이 불가능했다.
> 상시 누적으로 바꾸면 원인 분석의 해상도가 올라가고, 3-1의 "저장소 경계를 못 넘는 지식" 문제도 완화된다.

### 5-5. 우선순위 매트릭스

```
효과 高 │  ① 시크릿 스캐너      ⑤ ArchUnit          ⑦ 계약 테스트
        │  ② 금지 패턴 게이트    ⑥ JPA 쿼리 검증      ⑨ Testcontainers
        │  ③ 설정 검증          ⑩ 결함 카탈로그 주입
        ├──────────────────────────────────────────────────────
효과 中 │  ④ 의존성 잠금        ⑧ 동시성 하네스      ⑫ /postmortem
        │  ⑬ 커밋 메시지 게이트  ⑪ 운영 메트릭·알람
        └──────────────────────────────────────────────────────
             비용 低              비용 中              비용 高
```

---

## 6. 실행 로드맵

### 1주차 — 게이트 세우기
- [ ] Jenkinsfile에 검증 stage 추가 (**`-x test` 우회 문제 해결이 선행**)
- [ ] gitleaks pre-commit + CI stage (유형 J)
- [ ] `./gradlew verifyConventions` — 부록 7-1의 룰 7개 (유형 A · B · H · J)
- [ ] `commit-msg` hook — Conventional Commits + `fix()` 본문 필수

### 2~4주차 — 구조적 방어
- [ ] ArchUnit 테스트 모듈 신설 + 부록 7-2 규칙 6개 (유형 D · E · I)
- [ ] `libs/storage-db` 기본값 확정: OSIV false · leak detection · 풀 메트릭 (유형 E)
- [ ] `@ConfigurationProperties` + `@Validated` 전환 및 기동 시 적용값 로깅 (유형 A)
- [ ] `libs/*` testFixtures에 동시성 테스트 하네스 (유형 D)
- [ ] `.claude/skills/review` · `anti-pattern`에 결함 카탈로그 주입

### 1분기 — 관측과 누적
- [ ] Tier 3 메트릭·알람 8종 (유형 B · C)
- [ ] `docs/runbook/` 3종 (진단 절차 · 진단 SQL · 롤백)
- [ ] 외부 응답 계약 테스트 체계 (유형 F)
- [ ] `/retro-check` · `/postmortem` 스킬 (원인 3-1)
- [ ] Testcontainers 전환 (유형 A · I)

### 검증 지표
자동화가 실제로 작동하는지는 **다음 히스토리 문서로 확인**한다.
- 10개 유형 중 CI/빌드에서 잡힌 비율
- `fix()` 커밋 중 "완화"로 분류되는 비율
- 저장소 간 독립 재발 건수 (현재 4건 → 목표 0건)

---

## 7. 부록 — 구현 스케치

### 7-1. 금지 패턴 게이트 (루트 `build.gradle`)

```groovy
// 실제 히스토리 사례에서 도출한 룰만 포함한다. 일반론은 넣지 않는다.
def forbiddenPatterns = [
    [name: 'MyBatis ${} (SQL injection)',      // vwc §5.1
     glob: '**/*.xml',   regex: /\$\{[^}]+\}/],
    [name: 'InterruptedException -> RuntimeException',   // sr §8-2
     glob: '**/*.java',  regex: /catch\s*\(\s*InterruptedException[\s\S]{0,300}?throw new RuntimeException/],
    [name: 'Unbounded thread pool',            // solution-review §1-3, §1-4
     glob: '**/*.java',  regex: /Executors\.newCachedThreadPool|new LinkedBlockingQueue\(\s*\)/],
    [name: 'CORS wildcard + credentials',      // vwc-media §4-4
     glob: '**/*.java',  regex: /allowedOriginPatterns\(\s*"\*"\s*\)/],
    [name: 'Hardcoded credential',             // vwc §5.2
     glob: '**/*.{java,yml,yaml,properties}',
     regex: /(AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/],
    [name: 'Undated TODO/임시',                 // vwc-media §9
     glob: '**/*.java',  regex: /(TODO|FIXME|임시)(?!\([A-Z]+-\d+,\s*expires=\d{4}-\d{2}-\d{2}\))/],
]

tasks.register('verifyConventions') {
    group = 'verification'
    description = '히스토리에서 도출한 금지 패턴을 검사한다'
    doLast {
        def violations = []
        forbiddenPatterns.each { rule ->
            fileTree(rootDir) {
                include rule.glob
                exclude '**/build/**', '**/node_modules/**', '**/playground/**'
            }.each { f ->
                def text = f.getText('UTF-8')
                if (text =~ rule.regex) {
                    violations << "[${rule.name}] ${rootDir.toPath().relativize(f.toPath())}"
                }
            }
        }
        // yml boolean 오타 (vwc-media §6-4: order_updates: ture)
        fileTree(rootDir) {
            include '**/src/main/resources/**/*.yml'
            exclude '**/build/**'
        }.each { f ->
            f.eachLine { line ->
                def m = line =~ /^\s*[\w.\-]+:\s*(ture|flase|treu|fasle)\s*$/
                if (m) { violations << "[yml boolean typo] ${f.name}: ${line.trim()}" }
            }
        }
        if (violations) {
            throw new GradleException("금지 패턴 ${violations.size()}건:\n  " + violations.join('\n  '))
        }
    }
}

// 배포 파이프라인이 -x test 여도 우회되지 않도록 check 이전 단계에 건다
subprojects { tasks.matching { it.name == 'compileJava' }.configureEach { finalizedBy ':verifyConventions' } }
```

Jenkinsfile stage:
```groovy
stage('Verify Conventions') {
    steps { sh "cd ${PROJECT_DIR} && ./gradlew verifyConventions gitleaksScan" }
}
```

### 7-2. ArchUnit 규칙 초안

```java
@AnalyzeClasses(packages = "com.booster", importOptions = ImportOption.DoNotIncludeTests.class)
class ArchitectureRulesTest {

    // CLAUDE.md 모듈 의존성 규칙
    @ArchTest
    static final ArchRule apps_must_not_depend_on_apps =
        slices().matching("com.booster.(*)service..").should().notDependOnEachOther();

    // bsd §1-1: 트랜잭션 안에서 외부 I/O 금지
    @ArchTest
    static final ArchRule no_external_io_inside_transaction =
        noMethods().that().areAnnotatedWith(Transactional.class)
            .should(new CallExternalClientCondition());   // *Client / S3* / KafkaTemplate / RestClient

    // CLAUDE.md Entity 규칙: setter 금지
    @ArchTest
    static final ArchRule entities_have_no_setters =
        noMethods().that().areDeclaredInClassesThat().areAnnotatedWith(Entity.class)
            .should().haveNameMatching("set[A-Z].*");

    // vwc-media §4-1: 광범위 catch 후 상태코드 하드코딩 금지
    @ArchTest
    static final ArchRule no_broad_catch_to_status =
        noClasses().that().resideInAnyPackage("..web..", "..application..")
            .should(new BroadCatchToHttpStatusCondition());

    // solution-review §1-3, §1-4: 무제한 스레드풀 / 무제한 큐 금지
    @ArchTest
    static final ArchRule no_unbounded_executor =
        noClasses().should().callMethod(Executors.class, "newCachedThreadPool");

    // CLAUDE.md 실수 기록: AOP self-invocation 탐지
    @ArchTest
    static final ArchRule no_aop_self_invocation =
        noMethods().should(new SelfInvokesAopAnnotatedMethodCondition());  // @Cacheable/@Transactional/@Async
}
```

### 7-3. 편집 시점 피드백 hook (`.claude/settings.json`)

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "pwsh -NoProfile -File .claude/hooks/check-forbidden-patterns.ps1"
          }
        ]
      }
    ]
  }
}
```

스크립트는 7-1과 **같은 룰 정의를 공유**해야 한다(규칙이 두 곳에 중복되면 유형 A를 스스로 재현하는 셈이다).
룰을 `config/forbidden-patterns.json` 한 곳에 두고 Gradle과 hook이 함께 읽는 구조로 만든다.

### 7-4. 재시도 3요건 템플릿 (`libs/core-resilience`)

```java
/**
 * 재시도 가능한 작업의 최소 계약.
 * 근거: bsd-history §2 (시퀀스 21억 소진), sr-history §5 (무한 재큐잉)
 */
public interface RetryableTask {
    int maxAttempts();                          // ① 시도 횟수 상한
    TerminalState onExhausted();                // ② 영구 실패 상태
    boolean isRetryable(Throwable e);           // ③ 화이트리스트 (기본: false)
    Duration backoff(int attempt);              // 지수 백오프
}
```

`isRetryable`의 **기본 구현이 `false`** 라는 점이 핵심이다.
"이 예외들만 실패 처리, 나머지는 재시도"가 아니라 **"이것만 재시도, 나머지는 실패"** 로 기본값을 뒤집는다.

---

## 참고

| 문서 | 역할 |
|---|---|
| [`blur-history.md`](./blur-history.md) | 미디어 처리 · 외부 프로세스 연동 (유형 A · D · G) |
| [`bsd-history.md`](./bsd-history.md) | DB 커넥션 · 쿼리 성능 · 배치 (유형 C · E) — 원인 규명 품질 최상 |
| [`event-stream-history.md`](./event-stream-history.md) | 네트워크 · 바이너리 규격 (유형 F) |
| [`sr-history.md`](./sr-history.md) | 로그 기반 장애 추적 (유형 C · F) |
| [`vwc-history.md`](./vwc-history.md) | 동시성 · 마이그레이션 · 보안 (유형 D · I · J) |
| [`vwc-media-history.md`](./vwc-media-history.md) | 경로/키 조립 · 계약 불일치 (유형 A · B) |
| [`solution-review.md`](./solution-review.md) | 해결 품질 평가 · 미해결 부채 우선순위 |
