# 커밋 히스토리 분석 — 어떤 문제가 있었고 어떻게 해결했는가

작성일: 2026-08-04
분석 범위: `72ce6d2`(2026-01-26, 초기 커밋) ~ `fa8c51a`(2026-07-29), 총 308 커밋 / `test` 브랜치 기준
관련 문서: [`code-audit.md`](./code-audit.md) · [`concurrency-fixes.md`](./concurrency-fixes.md) · [`architecture.md`](./architecture.md) · [`todo.md`](./todo.md)

> 이 문서는 커밋 로그와 실제 diff를 대조해 **반복적으로 발생한 문제 유형**과 그 해결 방식을 정리한 것이다.
> 개별 기능 개발 커밋은 제외하고, 결함·장애·기술부채 해소에 해당하는 커밋을 중심으로 묶었다.

---

## 0. 한눈에 보기

| 문제 영역 | 대표 증상 | 근본 원인 유형 | 대표 커밋 |
|---|---|---|---|
| 동시성 | 동시 요청 시 응답 유실·오매칭, SSE 프레임 깨짐 | 공유 가변 상태에 조율 없는 접근 | `8b3482b`, `63bb3a1` |
| 외부 I/O 신뢰성 | 스레드 무한 hang, DB 커넥션 장기 점유 | 타임아웃 미설정, 트랜잭션 안에서 네트워크 왕복 | `ece514e`, `13c6cb1` |
| 타입/널 안전성 | NPE, 잘못된 HTTP 상태코드, 자료형 추론 오류 | 래퍼 타입 `==` 비교, JPQL 반환 타입 불일치 | `0635c67`, `e8dbfe3`, `fc45415` |
| 데이터 정합성 | 배치 업데이트 예외, 날짜가 화면마다 다름 | 가짜 엔티티 합성, 기준 컬럼/타임존 불일치 | `042ca2a`, `147d743` |
| 보안 | SQL 인젝션 가능 지점 | MyBatis `${}` 문자열 치환 | `6cfd544` |
| 스키마 리팩터링 여파 | 컴파일 에러, 매핑 누락, 한글 깨짐 | 대규모 테이블/컬럼 리네임의 파급 | `184681d`~`67b414b`, `d426a19` |
| 인증/세션 | 소셜 로그인 리다이렉트·쿠키 미전달 | 크로스 오리진 쿠키 정책, 환경별 프로토콜 차이 | `2b5f2cb`, `878038d`, `822bfa9` |
| 빌드/버전 | QueryDSL·org.json·테스트 라이브러리 컴파일 실패 | Spring Boot 3 마이그레이션 파급, transitive 의존성 | `ca3c3d0`, `ccb0daa`, `64bd786` |

커밋 메시지 형식은 프로젝트 중반까지 `[modify]`/`[feat]`/`[etc]` 스타일이 압도적(`[modify]` 152건)이었고,
6월 중순 이후 Conventional Commits(`fix(scope):`, `perf(tx):`)로 전환되며 **원인·해결·근거를 본문에 남기는 방식**으로 바뀌었다.
이 문서에서 원인 분석이 상세한 항목이 대부분 후반부 커밋인 이유가 여기에 있다.

---

## 1. 동시성 결함 — 가장 위험했던 두 건

두 건 모두 "간헐적이라 재현이 어렵고, 로그만 보면 타임아웃/네트워크 문제로 오인되는" 유형이다.
이론 배경과 수정 근거는 [`concurrency-fixes.md`](./concurrency-fixes.md)에 별도 정리되어 있다.

### 1.1 MQTT 요청-응답 매칭에서 future 유실 (`8b3482b`, 2026-06-17)

**문제**
단말 설정 조회는 MQTT로 요청을 발행하고 응답 토픽 수신을 `CompletableFuture`로 기다리는 구조다.
대기 중인 future를 `pendingMap`에 **serial 단위 키로 단순 `put`** 하고 있었다.

- 같은 단말에 동일 명령이 동시에 두 번 들어오면 두 번째 `put`이 첫 future를 덮어씀
- 첫 호출자는 완료 통지를 영원히 받지 못하고 **10초 타임아웃까지 방치**
- 응답이 엉뚱한 요청에 매칭될 수 있음(오매칭)

**해결**
`PendingMqttRequests`를 신규 도입해 키별 `ConcurrentLinkedQueue`로 교체했다.

- 각 요청이 자기 future를 소유하고, 응답은 **가장 오래 기다린 요청부터 FIFO로 매칭**
- 등록/완료/제거를 `ConcurrentHashMap.compute` 기반으로 원자화
- `DeviceConfigurationFacade`, `MqttService`를 신규 API로 전환
- 동시요청 FIFO 매칭 회귀 테스트 추가

> 단말 펌웨어 변경 없이 서버 코드만으로 해결했다는 점이 중요하다 — 프로토콜을 건드리지 않고 서버 측 자료구조만 교체.

### 1.2 SseEmitter 동시 write (`63bb3a1`, 2026-06-17)

**문제**
동일 `SseEmitter`에 Redis 구독 스레드 · 하트비트 스케줄러 · reconnect 호출자가 동시에 write할 수 있었다.
`SseEmitter`는 동시 `send`/`complete`에 thread-safe하지 않아 **프레임 깨짐 / `IllegalStateException`** 위험.

**해결**
- emitter → `ReentrantLock` 맵을 도입하고, 모든 출력을 `doSend` 단일 통로로 모아 락으로 직렬화
- `safeComplete`도 동일 락으로 보호
- 락은 `register`에서 생성, `cleanupIfOwnedBy`/emitter 교체 시 제거해 **누수 방지**
- `doSend`의 catch를 `Exception`으로 넓혀 "완료 후 전송" 예외까지 흡수
- `SSEController.connect`의 직접 `emitter.send`를 관리 통로(`sseEmitters.send`)로 전환
- 데드락 방지를 위해 락→맵 순서만 유지(역방향 없음)
- 회귀 테스트 `SSEEmittersTest`(동시 send 예외 비전파 + 락 누수 없음) 추가

### 1.3 앞선 임시 대응 — 타임아웃 늘리기 (`3a8e9cb`, 2026-06-09)

동시성 원인을 규명하기 전에는 `MQTT 수신 future time 3 sec -> 10 sec`로 **대기 시간을 늘리는 방식**으로 대응했다.
증상은 완화되지만 원인(future 덮어쓰기)은 남아 있었고, 8일 뒤 `8b3482b`에서 근본 해결됐다.
**타임아웃 상향은 진단이 아니라 유예**라는 점을 보여주는 사례.

---

## 2. 외부 I/O 신뢰성

### 2.1 타임아웃 없는 HTTP 클라이언트 (`ece514e`, 2026-06-16)

**문제** — `RestTemplate`, `RestClient`, OAuth용 `WebClient`가 모두 타임아웃 없이 생성되어,
상대 서버가 응답하지 않으면 요청 스레드가 **무한 hang**. 톰캣 워커 고갈로 이어질 수 있는 구조.

**해결**
- `RestTemplate`: connect 5s / read 10s (`WebMvcConfig`)
- `RestClient`: `NanoMqClientService` 빌더에 connect 5s / read 10s
- Google/Apple/SocialLogin OAuth 서비스: 타임아웃 없는 `WebClient.Builder` 대신 **튜닝된 `webClient` 빈을 주입**

### 2.2 트랜잭션 점유 중 네트워크 왕복 (`13c6cb1`, 2026-06-23)

**문제** — DB 커넥션을 잡은 채로 KVS/MQTT 왕복을 수행. 외부가 느려지면 커넥션 풀이 마름.
추가로 국가 변경과 KVS 채널 삭제의 상태 정합성이 맞지 않았다(비동기 발행이라 실패해도 롤백되지 않음).

**해결**
| 대상 | 조치 |
|---|---|
| `LiveService.getEndPoint` | `@Transactional(NOT_SUPPORTED)` — KVS 왕복 동안 커넥션 미점유 |
| `UaService.updateLoginDtm` | 로그인시각 갱신 트랜잭션과 MQTT 발행을 self-proxy로 분리 → **커밋·커넥션 반납 후 발행** |
| `UaService.sendRemoveKVSChannel` | 비동기 → 동기 호출로 변경, 실패 시 예외를 던져 국가 변경과 함께 롤백 |

### 2.3 JPA 재귀 페치와 무한정 조회 (`4e65eb5`, 2026-06-16)

`Device`↔`Model`이 상호 EAGER여서 재귀적으로 연쇄 페치되고 있었다.
`Model.mds`를 LAZY로 변경해 연쇄를 차단하고, `DeviceQueryDslRepository.findByCountry` /
`UaQueryDslRepository.findAll`에 `limit(1000)`을 추가해 **상한 없는 전체 조회**를 막았다.

### 2.4 AWS S3 클라이언트 반복 생성 (`df05d0d`, 2026-04-08)

요청마다 S3 클라이언트를 새로 만들던 로직을 **리전별 1회 생성 후 재사용**으로 변경.

---

## 3. 타입 / 널 안전성

이 프로젝트에서 반복적으로 터진 계열이다. 대부분 원인이 같다 — **래퍼 타입과 원시 타입의 경계**.

### 3.1 NPE를 401로 응답하던 예외 핸들러 (`e8dbfe3`, 2026-04-02)

```java
// before
if (e instanceof AuthenticationException || e instanceof NullPointerException) {
    errorCode = 401;
```
`NullPointerException`이 인증 실패와 같은 분기에 묶여 있어, **서버 버그(NPE)가 클라이언트에 "인증 실패"로 보였다.**
클라이언트는 재로그인을 시도하며 원인 파악이 불가능해진다. NPE를 500으로 분리해 해결.

> 진단을 방해하는 유형의 버그라 우선순위가 높다. 로그인 실패로 오인된 장애의 배경으로도 볼 수 있다(§7 참고).

### 3.2 `Integer` 언박싱 NPE (`0635c67`, 2026-04-02)

```java
- if (deviceListDto.getStatus() == 3) {
+ if (Integer.valueOf(3).equals(deviceListDto.getStatus())) {
```
`status`가 `Integer`(nullable)인데 `== 3` 비교로 언박싱 NPE. `equals` 비교로 전환.
같은 날 `7e1e61e`, `4a8087b`에서도 동종 NPE 수정이 이어졌다.

### 3.3 JPQL 반환 타입 불일치 (`fc45415`, 2026-04-13)

`SELECT ROUND(SUM(fileSize)/1024, 5)`를 `Double.class`로 받으려다 데이터타입 추론 오류.
**SQL에서 나눗셈·라운딩을 하지 않고** `SUM`을 `Long`으로 받아 Java에서 `/ 1024.0` 처리하도록 변경.

### 3.4 org.json 타입의 Jackson 직렬화 실패 (`9b9751f`, 2026-06-12)

`deviceDisconnected` SSE 전송 시 `JSONObject`/`JSONArray`를 그대로 넘겨 `Jackson No suitable converter` 예외.
`RedisSubscriber`에서 **`Map`/`List`로 변환한 뒤 전송**하도록 수정.
그리고 이 변환에 쓴 `toMap()`/`toList()`가 다음 항목의 빌드 오류로 이어진다(§6.3).

---

## 4. 데이터 정합성

### 4.1 존재하지 않는 행을 UPDATE (`042ca2a`, 2026-07-02)

**문제** — 알람 설정 조회 쿼리가 유저 설정 행(`UC_SERVICE_SET`)이 없을 때 **음수 id의 가짜 엔티티를 합성**해서 반환했다.
화면에는 기본값이 잘 보이지만, 사용자가 이 값을 그대로 저장하면 존재하지 않는 id로 UPDATE가 발생 →
`Batch update returned unexpected row count` 예외.

**해결** — `UserAlarmSettingFacade`에서 **id 부호로 분기**. 실제 행은 UPDATE, 가짜 엔티티는 신규 INSERT.

> "조회 편의를 위해 없는 데이터를 합성"하는 패턴이 쓰기 경로에서 터진 전형적 사례.
> 합성 엔티티를 만들 때는 쓰기 경로에서 구별할 수 있게 표식(여기서는 음수 id)을 두고 **반드시 분기해야 한다.**

### 4.2 화면마다 다른 주행 날짜 (`147d743`, 2026-06-23)

**문제** — 달력 점찍기(`/v2/drive-history/search`)는 `start_dtm` 기준 + **UTC 고정**으로 날짜를 계산하는데,
일별 주행(daily-driving)은 `end_dtm` 기준 + **디바이스 타임존 보정**을 썼다.
자정 부근·타임존 경계 주행이 두 화면에서 서로 다른 날짜에 표시됐다.

**해결** — `findDriveDatesInMonth`가 `end_dtm`에 디바이스 offset을 적용한 뒤 종료일 기준으로 그룹핑하고,
`StatisticsService`가 `gmtId`/`timeCal`로 `cal`·`minutesDifference`를 SQL에 전달하도록 통일.

### 4.3 파일 확장자 검증 누락 (`38e718f`, 2026-06-10)

알림 리스트에서 업로드된 파일이 **없다고 표시되는 이슈**. 원인은 `fileExt`를 `avi`만 검증한 것.
`in (avi, mp4)`로 확장자 집합을 넓히고 회귀 테스트(`UcNotificationServiceTest`)를 추가했다.
같은 시기 `d97c32f`에서는 `pushSubType` 비교 문자열이 `push_md_drive_uploaded` → `drive_uploaded`로
**단말이 실제 보내는 값과 달라** 분기가 전부 타지 않던 문제도 함께 수정됐다.

> 두 건 모두 "예외가 안 나고 조용히 빈 결과를 주는" 유형이라 발견이 늦었다.
> 관련 시도: `d4e340a`(알람에서 파일 존재여부 수정)를 포함해 같은 증상을 여러 차례에 걸쳐 손봤다.

### 4.4 썸네일/시각의 타임존 (`6d2f7f2`, 2026-04-23)

`thumbnail time`을 UTC0로 추가하면서 `lastRegTime`도 UTC0 처리로 통일.
§4.2와 같은 계열 — **시각 값의 기준 시간대를 API 전체에서 하나로 맞추는 작업**이 여러 차례 반복됐다.

### 4.5 방해금지(DND) 시간 설정 (`810a291`, 2026-04-21)

`UcServiceSet` 관련 컬럼·매핑 오류를 1차 수정했으나, 커밋 메시지에 남긴 그대로
**국가 설정이 제거되어 사용자의 시간대를 알 수 없다**는 구조적 문제가 미해결로 남았다.
현재는 디바이스 타임존(§4.2의 `gmtId`)을 쓰는 방향으로 정리되고 있다.

---

## 5. 보안

### 5.1 MyBatis SQL 인젝션 (`6cfd544`, 2026-06-16)

`${}`는 문자열을 그대로 SQL에 치환하므로 파라미터가 외부 입력이면 인젝션이 성립한다.
아래 지점을 전부 `#{}`(PreparedStatement 바인딩)로 변경:

| 파일 | 파라미터 |
|---|---|
| `DvStreamHistorySQL.xml` | `uu.id` |
| `StatistcV3SQL.xml` | `udh.userId` |
| `StatisticsSQL.xml` | `searchDate`, `type`, `uaId`, `idx` |

### 5.2 크리덴셜 평문 커밋 — **미해결**

`code-audit.md`가 Critical로 분류한 항목이다. Firebase 서비스 계정 키, AWS IAM 키, DB 접속정보,
Google OAuth secret, **JWT 서명 secret**, Apple `.p8` 키가 모두 저장소에 평문으로 존재한다.
커밋 히스토리에도 남아 있어 파일 삭제만으로는 부족하고 **전부 재발급(rotate)이 필요**하다.
`5bb0e96`, `f863629`, `f36e9b2` 등에서 구글 키를 교체한 이력이 있으나, 교체본 역시 평문 커밋이라 구조는 그대로다.

자세한 항목·조치는 [`code-audit.md`](./code-audit.md) §즉시 조치 참고.

### 5.3 부수적으로 정리된 로그 노이즈

`0f36670`(expired token warn 제거), `4468085`(과도한 에러 스택 출력 제거), `fdeffa6`(SQL 쿼리 로그 off),
`3538c97`(test/stage `getDeviceList` 로그 off) — 운영 로그에서 **토큰·쿼리 등 민감 정보와 노이즈를 줄이는 작업**이 반복됐다.
반대로 진단이 필요할 때는 로그를 다시 추가하는 커밋(`e368c90`, `536d264`, `8d1bbee`)이 쌍으로 나타난다.

---

## 6. 대규모 리팩터링과 그 여파

이 프로젝트에서 결함이 가장 많이 파생된 구간이다. 패턴이 일정하다 —
**구조 변경 커밋 → 컴파일 에러 수정 → 런타임 매핑 누락 → 잔여 정리**.

### 6.1 DB 스키마 리팩터링 (2026-03-09 ~ 04-20)

`e010996`에서 시작해 `184681d`(테이블/컬럼 삭제 반영), `0a15bab`·`dee4bed`(컬럼 리네임),
`537de7c`(`MD_DEVICE` 리팩터링), `e71d29c`(merge), `67b414b`(1차 최종 정리)로 이어진 흐름.

| 파생 문제 | 커밋 |
|---|---|
| 삭제된 테이블 잔여 참조로 컴파일 에러 | `03abb72`, `2fafda0` |
| 머지 후 잔여 오류 | `d6684f1` |
| 한글 주석·로그 문자열 깨짐 | `8887583`, `fdada29` |
| BOM 문자열 오류 | `138accc` |
| 컬럼명 정합성 (`dvcid`→`serial`, `yn`→`fl`, `inmngidx`→`createdManagerId`) | `01d11ae`, `8cd2ac5`, `b9bc729`, `1b8c9b9`, `a9a818a` |

**여기서 나온 가장 좋은 대응** — `d426a19` **MyBatis resultMap 매핑 오류 탐지기**:
`MybatisMapperXmlLoadTest`를 추가해 매퍼 XML을 전부 로드/검증한다.
XML 매핑 오류는 컴파일에 걸리지 않고 **해당 API를 호출할 때만 터지는** 유형이라,
리네임 작업 중 누락을 CI 단계에서 잡을 수 있게 만든 것이 유효했다.

### 6.2 응답 DTO 제거 → HTTP 상태코드 (2026-03-17 ~ 03-19)

`3fe2d2f`·`acc8cba`에서 응답을 감싸던 `responseDto` 대신 **HTTP 상태코드로 결과를 표현**하도록 전환,
`72e2032`에서 `responseListDto` → `PageResponseDto` 개편 및 반환값 `ResponseEntity` 래핑.
이후 `fde0e1b`·`d9dae47`(상수형 데이터 리턴 API 래핑, 유저그룹 소스 전체 삭제),
`369f32c`(`DeviceDto`를 응답으로 남용하던 API 정리)로 마무리.
같은 흐름에서 에러 응답 형식도 재정의됐다(`4f30383`, `69d7943`)
— 예: 미등록 단말 검증 응답을 `409` → `400`으로 교정(`c521622`).

### 6.3 Spring Boot 2 → 3 / Java 17 → 21 (`ca3c3d0`, 2026-03-03)

146파일이 변경된 단일 커밋. 이후 파생된 빌드 문제:

| 문제 | 해결 | 커밋 |
|---|---|---|
| springfox가 Spring Boot 3와 호환 불량 | **springdoc으로 마이그레이션**, `ApiIgnore` 자체 애노테이션 대체 구현 | `a48eb65` |
| QueryDSL 빌드 실패 (`jakarta` 전환) | `build.gradle`에 Q타입 생성 경로/설정 명시 | `ccb0daa`, `6be5ad3` |
| 단위 테스트 라이브러리 버전 충돌 | 버전 정정 | `760f2c6` |
| 미사용 spring batch 의존성 | 라이브러리·설정 삭제 | `ff6632d`, `f46b453` |
| `JSONObject.toMap()`/`JSONArray.toList()` 컴파일 실패 | javapns가 끌어오는 **transitive org.json 20160212**에 해당 메서드 없음 → `org.json:json:20231013` 명시 선언으로 override | `64bd786` |

> `64bd786`은 transitive 의존성이 조용히 구버전을 고정하는 전형적 사례다.
> 진단의 핵심은 "내 코드에 있는 메서드가 없다"가 아니라 **어느 의존성이 그 버전을 끌어오는지**를 찾는 것.

### 6.4 서비스/리포지토리 네이밍 정리

`0d64f67`, `14e04f6`, `7c54311` 3회에 걸친 네이밍 통일(`dvc`→`device`, `mdName`→`modelName`).
Facade 계층 도입(`DeviceDeleteFacade`, `DeviceConfigurationFacade`, `UserAlarmSettingFacade`)도 이 시기에 정착했고,
`517cadb`에서 단말 삭제 로직을 Facade로 모듈화하며 unregistration MQTT 발행을 함께 넣었다.

---

## 7. 인증 / 소셜 로그인

ID/PW 로그인을 폐기하고 소셜 로그인 전용으로 전환하는 과정에서 **크로스 오리진 쿠키** 문제가 반복됐다.

### 7.1 전환 흐름

1. `531fbc2` 기존 로그인 API 삭제, `b30fd5c` 휴면회원 엔티티 삭제, `4596a8d` UA 테이블 컬럼 정리
2. `8990975` 테스트에서 ID/PW가 무의미해져 **JWT를 내부적으로 자동 발급**하는 방식으로 대체
3. `5c906d8`~`143a647` 구글·애플 로그인 구현, `f35b971` 모바일용 로그인/회원가입 추가
4. `8e5a85f` 소셜 로그인 플랫폼 검증 제거(앱은 별도 경로로 분리 → [`MOBILE_AUTH.md`](./MOBILE_AUTH.md))

### 7.2 리다이렉트 / 쿠키 문제

| 문제 | 해결 | 커밋 |
|---|---|---|
| 콜백 API가 값을 그대로 반환해 프론트가 받을 수 없음 | 콜백에서 **프론트 페이지로 리다이렉트** | `2b5f2cb` |
| 리다이렉트 대상 오리진을 하드코딩 | 요청에서 오리진 추출 → `Origin` 헤더 기반으로 정착 | `cc203dc`, `f10928b` |
| 크로스 사이트에서 refreshToken 쿠키 미전송 | `SameSite=None` 설정 | `878038d` |
| `SameSite=None`은 `Secure` 필수 → HTTP인 test 환경에서 쿠키 유실 | 프로파일별 쿠키 속성 분기(test는 HTTP 허용) | `822bfa9` |
| 신규 회원 처리 | 약관 페이지로 리다이렉션 분기 | `e84d954` |
| CORS 허용 오리진 | `allowOrigins` 정비, 화이트리스트 추가, `referer` 기반 코드 제거 | `d27890a`, `7b85011`, `250838d` |

### 7.3 토큰 수명 관리

`1302813`(`token_in_dtm` 추가), `4161f0b`(로그아웃·탈퇴 시 토큰 정보 삭제),
`5cd6a5c`·`a729101`(refresh 응답 정정 — 프로필 URL, `lastName` 포함).

### 7.4 서버 다운 시 로그인 안내 — **미해결**

2026-07-28 서버 다운 구간에 구글 로그인 20여 회 실패. 클라이언트가 아무 처리를 하지 않아
사용자는 원인을 알 수 없는 화면에 멈췄다. 앱 프로세스가 죽으면 응답 주체가 우리 앱이 아니라 **ALB**이므로
302 리다이렉트도 `Set-Cookie`도 없고 502/503/504만 돌아온다.
방법은 아직 미확정 — [`social-login-downtime-handling.md`](./social-login-downtime-handling.md) 참고.

---

## 8. MQTT 단말 연동

단말과의 실시간 연동은 **미들웨어팀·펌웨어와 계약을 맞춰가는 과정**이 그대로 커밋에 남아 있다.

### 8.1 mock → 실연동

`a733fe1`에서 단말 설정 조회를 Mocking으로 먼저 열었고,
`cfa259c`·`9e02cb8`(테스트 코드와 메서드 레벨까지 삭제), `1f6cc16`에서 mock을 단계적으로 제거했다.
`94c4618`에서는 e2e 검증용 MQTT 전송 API를 별도로 만들어 실장비 없이 흐름을 확인할 수 있게 했다.

### 8.2 토픽/헤더 계약 불일치

| 문제 | 해결 | 커밋 |
|---|---|---|
| 설정 전송 토픽이 고정되어 있음 | 송신 토픽 동적 지정 지원, 단말 설정을 `setting` 토픽으로 전송 | `d082c17` |
| setting 메시지 header type이 `policy`로 나감 | `setting`으로 정정 + 테스트 반영 | `f53cc14`, `13b10de` |
| `settingRecv` 응답을 구독하지 않아 요청이 항상 타임아웃 | 토픽 구독 추가 → 수신 시 대기 future 완료 처리 | `d8d27cf`, `412d854` |
| 수신 로그가 raw payload라 판독 불가 | 파싱된 header·data로 출력 | `d25314c` |
| config 키 매핑 근거가 코드에 없음 | 출처(미들웨어팀 config 파일)를 주석으로 명시 | `63b9123`, `77b1bef` |

> `d8d27cf`→`412d854`는 §1.3의 타임아웃 상향과 같은 시기 문제다.
> "응답이 안 온다"의 원인이 **구독 자체를 하지 않은 것**이었고, 그 뒤에 §1.1의 future 유실이 또 있었다.
> 한 증상 아래 원인이 세 겹으로 쌓여 있던 구간.

### 8.3 단말 라이프사이클 이벤트

`57ee7e6`(등록 시 MQTT 발송), `517cadb`(삭제 시 unregistration 발행),
`66c1ad6`(로그인 후 해당 사용자 단말로 history DB 업로드 발행), `e4345d0`(단말 종료 시 SSE 메시지).

### 8.4 단말 별칭 — 순환참조로 방향 전환 (`fd8f872`→`8efc711`, 2026-06-24)

등록 시 별칭을 `lastName + {deviceCount} + th`로 만들려 했으나,
사용자명을 참조하는 과정에서 **순환참조**가 발생해 하루 만에 `user_{n}th` 형태로 단순화했다.
사용자 정보 의존을 끊는 방향으로 정리한 사례.

---

## 9. 남아 있는 문제 (커밋에서 미해결로 확인된 것)

| # | 문제 | 근거 |
|---|---|---|
| 1 | **크리덴셜 평문 커밋 + JWT secret 하드코딩** — 이 값으로 임의 사용자 토큰 위조 가능 | `code-audit.md` C1~C6 |
| 2 | **`AppRedisClient` 구현이 in-memory 하나뿐** — `1634f62`의 "임시 mock"이 프로파일 분기 없이 전 환경에 적용됨. 인스턴스 2대 이상이면 분산 락·OAuth state·rate limit이 조용히 깨짐 | `todo.md` §1 |
| 3 | **CORS 와일드카드 + `allowCredentials(true)`** + 중복 `CorsFilter` | `code-audit.md` High |
| 4 | **서버 다운 시 소셜 로그인 안내** 방법 미확정 | `social-login-downtime-handling.md` |
| 5 | **DND 시간대 판정 근거** — 국가 설정 제거 이후 정리 진행 중 | `810a291` 커밋 메시지 |
| 6 | 개발 편의를 위한 임시 코드 잔존 — `63d766e`(uaId 없이 조회 가능), `2898d9f`(개발용 쿼리), `21b4c7b`(원본 코드 보존) | 각 커밋 메시지의 "나중에 수정해야됨" |

---

## 10. 회고 — 반복된 패턴

**1. 증상 완화가 원인 규명을 늦춘다.**
MQTT 타임아웃 3→10초 상향(`3a8e9cb`)은 8일 뒤 future 유실(`8b3482b`)이 밝혀질 때까지 문제를 가렸다.
타임아웃·재시도 상향은 관측을 위한 유예로만 쓰고, 원인 티켓을 반드시 남길 것.

**2. 조용히 실패하는 코드가 가장 늦게 발견된다.**
확장자 검증 누락(`38e718f`), `pushSubType` 문자열 불일치(`d97c32f`), MyBatis resultMap 누락은
모두 예외 없이 빈 결과를 반환했다. `d426a19`의 **매핑 검증 테스트**처럼 정합성을 테스트로 고정하는 방식이 유효했다.

**3. NPE를 401로 응답한 것(`e8dbfe3`)은 단일 버그가 아니라 진단 능력의 손실이었다.**
예외→상태코드 매핑은 클라이언트 동작과 장애 분석 모두를 좌우하므로 분기를 뭉치지 말 것.

**4. 대규모 리네임은 컴파일러가 절반만 잡아준다.**
XML 매퍼·SQL 문자열·로그 인코딩은 컴파일을 통과한다. 스키마 변경 작업에는
**매퍼 로드 테스트 + 인코딩 통일**을 선행 조건으로 두는 편이 낫다.

**5. 트랜잭션 경계와 외부 I/O 경계는 겹쳐선 안 된다.**
`13c6cb1`이 정리한 원칙 — 커밋 후 발행(self-proxy 분리), 읽기 전용 외부 왕복은 `NOT_SUPPORTED`,
롤백이 필요한 외부 호출은 동기 + 예외 전파.

**6. 커밋 메시지 형식 전환이 실제로 분석 가능성을 바꿨다.**
`[modify] 오류 수정` 152건은 diff를 열어야 내용을 알 수 있지만,
Conventional Commits + 본문(원인/조치/근거)으로 전환된 후반 커밋은 그 자체로 이 문서의 재료가 됐다.
`fix(scope):` 본문에 **"무엇이 어떻게 잘못됐는지"를 한 문단** 남기는 관행을 유지할 것.