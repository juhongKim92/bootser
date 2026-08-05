# 트러블슈팅 이력 (커밋 로그 정리)

`bsd-taxi-api` 저장소의 커밋 이력에서 **어떤 문제가 있었고 어떻게 해결했는지**를 주제별로 정리한 문서다.
기간: 2025-05 (프로젝트 분기) ~ 2026-07.

각 항목은 `증상 → 원인 → 해결` 순서이며, 끝에 해당 커밋 해시를 붙였다.

---

## 목차

1. [DB 커넥션 누수 / 풀 고갈](#1-db-커넥션-누수--풀-고갈)
2. [마이그레이션 배치 시퀀스 무한 소모](#2-마이그레이션-배치-시퀀스-무한-소모)
3. [쿼리 성능 (풀스캔 / N+1 / 거대 트랜잭션)](#3-쿼리-성능-풀스캔--n1--거대-트랜잭션)
4. [ADAS / DMS 집계 정확도](#4-adas--dms-집계-정확도)
5. [ORM 매핑 · 예외 처리 · 관측성](#5-orm-매핑--예외-처리--관측성)
6. [반복해서 드러난 패턴 (교훈)](#6-반복해서-드러난-패턴-교훈)

---

## 1. DB 커넥션 누수 / 풀 고갈

이 저장소에서 가장 크고 오래 끌었던 문제군. "서버가 멈춘다 / 응답이 안 온다"로 신고되었고,
원인은 한 곳이 아니라 **여러 경로가 각각 커넥션을 오래 붙잡고 있던 것**이었다.

### 1-1. 마이그레이션 서비스의 커넥션 누수

- **증상**: DB 파일 마이그레이션 중 커넥션이 반납되지 않아 풀이 고갈. 수동 실행과 스케줄러가
  동시에 돌면 특히 심함.
- **원인**: `DbFileServiceImpl` 이 `connection` / `migrationMapperSession` 을 **인스턴스 필드**로
  들고 있어, 동시 실행 시 서로의 세션을 덮어쓰며 반납 경로를 잃었다. 또 클래스 레벨
  `@Transactional` 때문에 **S3 업로드 구간까지** 커넥션을 쥐고 있었다.
- **해결**
  - `SqlSession` 을 인스턴스 필드 → **레코드 단위 지역 변수**로 전환.
  - `migrateDbFile` 의 클래스 레벨 `@Transactional` 제거, **S3 업로드 전에 커넥션 반납**.
  - COPY와 조회 쿼리를 같은 세션 커넥션에서 처리해 **동시 점유 2개 → 1개**로 축소.
  - `migrateDrive/Gps/Adas` 를 `private` 으로 좁혀 외부 호출 경로 차단.
  - `application.yml` 에 Hikari `leak-detection-threshold: 60s` + Prometheus 메트릭 태그 추가.
  - 관련 문서: `docs/db-connection-monitoring.md`, `docs/rollback-guide.md`
- 커밋: `3a7800b` (2026-06-19), 진단 SQL 스니펫 `1756230`

### 1-2. OSIV(Open Session In View)로 인한 커넥션 핀닝

- **증상**: Hikari 누수 경고 스택 최상단이 `getDeviceIdFromDriveHistory` 였는데, 정작 그 쿼리는 17ms.
- **원인**: `spring.jpa.open-in-view` 기본값 `true`. **요청 중 첫 쿼리**가 빌린 커넥션을
  **응답 렌더링이 끝날 때까지** 유지하고, `ProxyLeakTask` 는 **빌린 시점**의 스택을 찍는다.
  즉 트레이스가 가리킨 쿼리는 범인이 아니었다.
- **해결**: `spring.jpa.open-in-view: false` 로 요청 전 구간 커넥션 핀닝 방지.
  (이 엔드포인트들은 DTO projection / 명시 쿼리 위주라 지연로딩 파손 위험 없음.)
- 커밋: `5d2f090` (2026-06-30) / 상세 문서 `docs/drivingDetail-dms-slow-query-fix.md`

### 1-3. 진단 절차 자체를 자산화

서버 멈춤·지연이 반복되어, 원인 추적 절차를 런북으로 남겼다.

- `docs/runbook-stuck-diagnosis.md` — 커넥션·스레드 점유 진단 절차 (`b3c9e0b`)
- `docs/db-connection-diagnostics.sql` — `pg_stat_activity` 기반 진단 SQL (`1756230`)
- `docs/db-connection-monitoring.md` — Actuator / Prometheus 모니터링 (`3a7800b`)

---

## 2. 마이그레이션 배치 시퀀스 무한 소모

가장 파급이 컸던 장애. **COPY 전면 실패**로 이어졌다.

- **증상**: `uc_gps_history_id_seq` 가 int4 상한(2,147,483,647)에 도달해 GPS 적재가 전면 실패.
  실제 레코드 수는 그에 한참 못 미침.
- **원인**: `migrateDbFile` 이 **drive/gps COPY를 먼저 실행한 뒤**에 ADAS 테이블 존재를 검사했다.
  ADAS가 없는 파일이면 그 시점에 `throw` → 트랜잭션 롤백. 그런데 **시퀀스는 롤백되지 않는다.**
  레코드는 `migrate_flag='N'` 으로 남아 **매분 재시도 → 매번 COPY → 매번 시퀀스만 태움**.
  무한 루프로 21억을 소진한 것.
- **해결**
  - ADAS 테이블 검사를 **COPY 전으로 이동** → 없으면 COPY 자체를 하지 않음(시퀀스 소비 0).
  - ADAS 없는 파일은 `migrate_flag='E'` (신규 상태값)로 표시 후 skip → **재시도 대상에서 제외**.
  - 레코드별 `try/catch` 로 격리해 한 건 실패가 배치 전체를 중단시키지 않도록 함.
  - 후속: id 컬럼/시퀀스 **int → bigint 전환**(운영 DDL)이 선행되어야 적재 재개.
    런북 `docs/pk-int-to-bigint-migration.md` 작성.
- 커밋: `3bbc9eb` (2026-06-23), 런북 `5d2f090`
- **제외된 파일 점검법**: `migrate_flag='E'` 로 조회해 원인 확인 후 재처리.

---

## 3. 쿼리 성능 (풀스캔 / N+1 / 거대 트랜잭션)

### 3-1. 주행상세 DMS 집계 풀스캔

- **증상**: `GET /api/history/drivingDetail/{id}` 가 특정 주행에서만 수십 초. Hikari 누수 경고 동반.
- **원인**: `getDmsBetween` 이 `time` **단독 필터**로 전 단말 GPS를 엔티티 로딩한 뒤 Java 루프로 합산.
  인덱스는 `(device_id, time)` 복합이라 선두 컬럼 없이는 못 타서 `uc_gps_history` 풀스캔.
  덤으로 **타 단말 DMS까지 합산**하던 정확성 버그도 있었다.
  "특정 주행만" 느렸던 건 `2026-01-12` 이후 주행에서만 이 분기를 타기 때문.
- **해결**: `device_history_id` 인덱스를 타는 **단일 SQL 집계**(`SUM((adas>>n)&1)`)로 대체하고,
  해당 주행으로 스코프를 좁힘. 다른 상세 쿼리와 같은 17ms대로 복귀.
- 커밋: `d2d71ed` (2026-06-30) / 상세 문서 `docs/drivingDetail-dms-slow-query-fix.md` (`fc909bf`)

### 3-2. `updateDistance` 거리계산 쿼리의 불필요한 전체 정렬

- **증상**: 구간당 약 10분 소요, `wait_event=DataFileRead`.
- **원인**: `distances` CTE가 `(select * from uc_gps_history order by time asc)` **파생 테이블**을
  거쳐 필터를 걸어, prepared statement의 generic plan에서 인덱스를 못 타고 Seq Scan + Sort.
- **해결**: 파생 테이블/내부 `order by` 제거 후 `uc_gps_history` 에 직접 `device_id`/`time` 필터.
  `LAG` 윈도우 함수가 자체 `ORDER BY time` 을 갖고 최종 UPDATE는 id 매칭이라 **결과는 동일**,
  플랜만 `idx_uc_gps_history_device_time_id` 를 타도록 바뀜.
- **검증법**: `force_generic_plan` 으로 EXPLAIN 해서 Seq Scan+Sort → Index Scan 전환 확인.
- 커밋: `4e4aa9b` (2026-06-23) / 초기 시도 `657c9d6`, `9d79f67` (2026-01-23)

### 3-3. 안전운전점수 배치: 거대 트랜잭션 + N+1

- **증상**: `chkMdCale`/`caculeSafeScore` 배치가 **DB 커넥션 1개를 배치 전체 시간 동안 점유**,
  한 건 실패 시 진행분 전부 롤백.
- **해결 (1단계 — 트랜잭션 분리·페이징, `6f78ad2`)**
  - `SafeScoreBatchProcessor.processOne` 신설: 레코드 1건을 `REQUIRES_NEW` **독립 트랜잭션**으로 처리.
  - 호출부는 건별 `try/catch` 로 실패 스킵 → **진행분 보존**.
  - 거대 `@Transactional` 제거, 계산식 전환(useYn 플립)은 `switchAppliedCalcBase` 로 원자 처리.
  - type B 전체 재계산을 전체 적재 → **Slice 페이징(1000건)**, 수동 `em.flush/clear` 제거.
- **해결 (2단계 — N+1 축소, `9578e52`)**
  - 건당 쿼리 **5개(4 SELECT + 1 UPDATE) → 3개**.
  - `chkGpsDate`(건수) + `getOverSpeedDis`(과속 거리/시간)를 **조건부 집계(FILTER)** 를 쓰는
    `getGpsAggregate` 단일 쿼리로 통합 → `uc_gps_history` 1회 스캔.
  - `findByCountTwoHours` 쿼리 제거 → 이력 행의 start/end로 Java 산술 계산(`(end-start)/7200`, 동일 결과).
  - 신규 `GpsAggregateDto` 추가.
  - **롤백 배려**: 대체된 매퍼/XML은 미사용 상태로 남겨둠. 이 커밋만 revert하면 1단계는 유지된다.
- 관련 분석 문서: `docs/chkMdCale-analysis.md`

---

## 4. ADAS / DMS 집계 정확도

기능 자체는 동작하는데 **숫자가 틀리던** 문제군. 원인은 대체로 비트 매핑 불일치와 집계 규칙 불일치.

### 4-1. 비트 연산 방향(reverse) 혼동

- `AdasUtilV2` 는 `adas` 값을 25자리 이진 문자열로 만든 뒤 **뒤집어서(reverse)** 인덱스로 접근한다.
  뒤집기 때문에 **인덱스 i = LSB 기준 비트 번호**가 되고, SQL의 `(adas >> n) & 1` 과 정확히 일치한다.
  이 방향을 착각해 값이 어긋난 이력이 있다.
- 커밋: `10a51dd` (2026-01-23, "adas bit 연산 로직 수정... reverse..."), `d846ef0`, `57b66bb`

### 4-2. 사람·차·오토바이 감지가 항상 0으로 집계

- **원인**: `dailyAdasTotal`(주행상세)·`AdasExcel` 쿼리가 사람 감지를 **bit 10/12만** 세고 있었다.
  실제 정의(`AdasUtilV2`)는 사람 = 5,6,10,12 / 차량 = 8,11,13 / 오토바이 = 9,14,15.
- **해결**: 누락 비트 전부 반영 + **행당 OR로 1회만 카운트**(기존 left+right 비트별 SUM은 중복 카운트).
- 커밋: `edef903` (2026-07-09)

### 4-3. GPS 샘플링 수만큼 부풀려지던 감지 횟수

- **원인**: 감지 비트가 켜진 **모든 행**을 세다 보니, 한 번의 감지가 GPS 샘플링 주기만큼 중복 집계됨.
- **해결**: `saveAdasCountV4` 규칙에 맞춰 **0→1 전환(구간 시작) 횟수**로 집계 —
  "연속된 1은 하나". 차선변경·전방/후진경고·사람·차·오토바이에 적용, `lineBreak` 도 동일 처리해
  정상차선 관계 유지. DMS는 행별 합산 유지.
- 커밋: `7c8f424` (2026-07-09)

### 4-4. DMS 정의 변경 (비트 7 → 비트 16~23)

- **배경**: 최초엔 DMS를 `adas` **비트 7 단일 플래그**로 셌으나, b606 펌웨어에서 운전자 상태 감지가
  세분화되며 정의를 **SLEEP_V1~FOOD(비트 16~23) 감지 횟수 합**으로 변경.
  한 행에서 여러 항목 동시 감지 시 각각 +1.
- **해결**: `AdasUtilV2` 파싱을 16비트 → 25비트로 확장하고 sleep(V1/V2/V3 분리)/eyesOff/phone/
  cigarette/beverage/food 비트 매핑 추가. `AdasCountDto`, `StAlertAdasV4`(컬럼 8개),
  `saveAdasCountV4` 까지 연결.
- 커밋: `2b197fd` (2026-06-22), `51d89c7` (2026-06-30)
- 참고: 펌웨어 미출시로 DMS를 일시 비활성화했다가(`6bb2c87`) 이후 재활성화(`3558aeb`)한 이력 있음.

### 4-5. 주행상세 평균속도가 일별 통계와 불일치

- **원인**: 주행상세가 `uc_gps_history` 를 **재집계한** 평균/최고속도를 쓰고,
  일별 통계는 **저장값**(`ud_device_history.speedavg`)을 써서 두 API 값이 달랐다.
- **해결**: 주행상세도 저장값(`dailyDriveDetail`) 기준으로 통일하고, `speedAvg` 를
  `trunc(...,1)`·float 로 맞춰 **소수점 1자리까지 일치**하도록 수정.
- 커밋: `97a712d` (2026-07-09)

### 4-6. 통계 집계 경로 난립 → V4 일원화

- **문제**: `saveAdasCountV2`/`V3`/`V4` 가 공존해 어느 경로로 저장되느냐에 따라 규칙이 달랐다.
- **해결**: `StatisticControllerV2` 의 수동/일괄 저장 API가 **V4만 호출**하도록 변경,
  미사용 V2·V3 메서드와 관련 Repository 의존성 제거, 일괄 저장 날짜 범위 2025~2026 갱신.
- 커밋: `71d5b36` (2026-07-10)

### 4-7. ADAS 경고 6종 비트 파싱 추가 (진행 중)

- `AdasUtilV2` 에 비트 1~6 상수 추가 (FCWS, FVSA, TLDS, RCWS, PCWS, RPWS).
  5번은 PCWS, 6번은 RPWS 로 정의되어 **HUMANS 에서 제외**.
- `AdasCountDto` 대응 필드 추가 후 `countAdasAlert` 에서 적재.
- ⚠️ **통계 집계/저장 로직에는 아직 미연결** (`getTotal` 미포함). 후속 작업 필요.
- 커밋: `a56081c` (2026-07-28)

---

## 5. ORM 매핑 · 예외 처리 · 관측성

### 5-1. `sleepV1~3` 컬럼 매핑 불일치로 조회 실패

- **원인**: Hibernate 네이밍 전략이 **대문자 뒤 숫자**(`sleepV1`)에는 언더스코어를 넣지 않아
  `sleepv1` 로 매핑 → 실제 컬럼 `sleep_v1` 과 불일치.
- **해결**: `StAlertAdasV4` 에 `@Column(name="sleep_v1~3")` 명시 매핑.
- 커밋: `04f7ed8` (2026-06-30)

### 5-2. DB 업로드가 로그 없이 500으로 실패

- **증상**: 업로드 실패 시 **아무 로그 없이** 500만 나감 → 원인 추적 불가.
- **해결**: 예외 핸들러 보강.
  - `MaxUploadSizeExceededException` → **413** 응답 + 로깅
  - `MultipartException`(파싱 실패) → **400** 응답 + 로깅
  - `Exception` catch-all → 그동안 로그 없이 나가던 예외의 **스택트레이스 기록**.
    단, `ErrorResponse` 를 구현한 표준 MVC 예외는 **재던져 기존 4xx 동작 유지**.
- 커밋: `f0e8f6b` (2026-07-27)

### 5-3. 불필요한 예외 전파 제거

- 파일 삭제 실패 시 `throw` 하던 것을 제거 — 후속 처리를 막을 이유가 없는 케이스였다.
- 커밋: `e2a77f9` (2026-06-17)

### 5-4. 관측성 기반 구축

- Prometheus / Grafana 도입 (`0c4088b`, 2025-06-09) — 이후 커넥션 풀 메트릭 추적의 토대가 됨.
- 2025-06-13 하루 동안 QueryDSL 예외·로그 추가/삭제 커밋이 집중된 구간(`2307065`~`83691a4`)은
  운영 버그 추적을 위한 임시 로그 투입 → 원인 확정 후 롤백한 흔적이다.

---

## 6. 반복해서 드러난 패턴 (교훈)

1. **누수 경고 스택의 최상단은 범인이 아닐 수 있다.**
   OSIV가 켜져 있으면 트레이스는 "요청의 첫 쿼리"를 가리킨다. 실제 병목은 같은 요청의 다른 쿼리다.

2. **시간 범위 조회는 반드시 device 스코프와 함께.**
   `time` 단독 조건은 `(device_id, time)` 복합 인덱스를 못 타고 풀스캔이 된다.
   그리고 스코프 누락은 성능 문제이면서 동시에 **정확성 버그**(타 단말 데이터 합산)이기도 했다.

3. **행 단위 후처리는 DB에서.**
   "전부 로딩 → Java 루프 합산" 패턴이 두 번(DMS 집계, 안전운전점수 배치) 문제를 일으켰다.

4. **시퀀스는 롤백되지 않는다.**
   검증(precondition)은 **부수효과를 내는 작업보다 먼저** 해야 한다.
   그리고 재시도 배치에는 **영구 실패 상태값**(`migrate_flag='E'`)이 반드시 필요하다.

5. **배치는 건별 독립 트랜잭션으로.**
   거대 트랜잭션은 커넥션 점유 + 전량 롤백이라는 두 가지 리스크를 동시에 만든다.

6. **비트 매핑은 한 곳(`AdasUtilV2`)을 단일 기준으로.**
   Java 유틸 / MyBatis XML / 통계 저장 로직이 각자 비트를 세면서 값 불일치가 반복 발생했다.
   집계 규칙("연속된 1은 하나")도 마찬가지로 경로마다 달랐다.

7. **같은 지표를 두 API가 다른 소스로 계산하면 언젠가 어긋난다.**
   평균속도는 저장값 기준으로 일원화해서 해결했다.

8. **파생 테이블 + 내부 `order by` 는 generic plan에서 인덱스를 죽인다.**
   결과에 무의미한 정렬은 제거한다.

---

## 관련 문서

| 문서 | 내용 |
|---|---|
| `docs/drivingDetail-dms-slow-query-fix.md` | 주행상세 DMS 풀스캔 상세 분석 (비트 매핑 근거 포함) |
| `docs/db-connection-monitoring.md` | Hikari 누수/고갈 모니터링 (Actuator·Prometheus) |
| `docs/db-connection-diagnostics.sql` | `pg_stat_activity` 기반 진단 SQL 스니펫 |
| `docs/runbook-stuck-diagnosis.md` | 서버 멈춤/지연 시 커넥션·스레드 점유 진단 런북 |
| `docs/pk-int-to-bigint-migration.md` | PK int 한계(약 21억) 대응 전환 런북 |
| `docs/chkMdCale-analysis.md` | 안전운전점수 배치 분석 |
| `docs/rollback-guide.md` | 롤백 가이드 |