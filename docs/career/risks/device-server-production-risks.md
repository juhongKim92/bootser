# device 서버 운영 리스크 분석 및 해결 시나리오

- **작성일**: 2026-08-31
- **대상**: `vueroid-web-api-device` (Spring Boot 3.4.3 / Java 21 / MyBatis + JPA / MQTT / Redis / S3)
- **상태**: 분석 완료, 조치 미착수

---

## 1. 요약

단말(블랙박스)이 직접 붙는 서버다. 사용자 앱은 이 서버를 호출하지 않는다. 담당하는 일은 네 가지다.

| 경로 | 하는 일 |
|---|---|
| `POST /registration` | 단말 부트스트랩 — 모델 검증, `md_device` 행 생성, 접속 정보(브로커 주소·계정 등) 응답 |
| `POST /report` (HTTP) / `device/+/report` (MQTT) | 단말 상태·GPS 수신 → `ud_device_last` upsert |
| `device/+/reportThumbnail` (MQTT) | 썸네일 수신 → 로컬 저장 → S3 업로드 → `dv_file` 기록 |
| `POST /mqtt/webhook` | 브로커 연결 종료 웹훅 → `status=power_off` 갱신 → Redis 발행 |

62개 파일의 작은 서버지만, **단말 전량의 트래픽이 여기로 모인다.** 규모가 커질 때 가장 먼저 한계에 닿는 지점이고, 실제로 이미 한 번 사고가 났다(`docs/device-webhook-offline-miss.md`).

문제는 크게 네 갈래다.

| 갈래 | 핵심 문제 |
|---|---|
| 인증 부재 | 시큐리티 의존성 자체가 없다. 부트스트랩·리포트 엔드포인트가 무인증이고, 부트스트랩 응답에 브로커 접속 정보가 평문으로 나간다 |
| 환경 설정 오류 | prod 프로파일이 **dev DB** 를 바라본다. stage/prod 에는 Redis 설정이 아예 없어 localhost 로 폴백한다 |
| 처리량 구조 | MQTT 수신 전량이 **단일 스레드**에서 DB·S3 동기 처리된다. 썸네일 업로드가 리포트 처리를 막는다 |
| 상태 정합성 | 리포트(MQTT)와 오프라인 웹훅(HTTP)이 순서 보장 없이 같은 행을 갱신한다. 타임스탬프 가드가 없다 |

---

## 2. 위험도 요약

| # | 항목 | 터지는 조건 | 영향 | 우선순위 |
|---|---|---|---|---|
| 1 | 부트스트랩·리포트 무인증 + 브로커 정보 평문 응답 | 상시 | 브로커 계정 유출, 단말 데이터 위조 | **P0** |
| 2 | prod 프로파일이 `vwc_dev` DB 를 바라봄 | prod 배포 시 | 운영 데이터 분리 실패 | **P0** |
| 3 | stage/prod 에 Redis 설정 없음 → localhost 폴백 | prod 배포 시 | 오프라인 알림 전파 전면 실패 | **P0** |
| 4 | 자격증명 형상관리 커밋 | 리포 접근 가능한 누구나 | api 서버와 동일 AWS 키 공유 | **P0** |
| 5 | MQTT 수신이 단일 스레드 동기 처리 | 단말 수 증가 | 처리량 상한, 리포트 지연·유실 | **P1** |
| 6 | 웹훅 비동기 큐가 무제한 + 휘발성 | 브로커 재기동 / 배포 | 오프라인 이벤트 대량 유실 | **P1** |
| 7 | 운영 로그 레벨 debug + 보존 2일 | 상시 | 로그 조기 소실, 디스크·I/O 부담 | **P1** |
| 8 | 상태 갱신 순서 보장 없음 | 재접속 시 경합 | 온라인 단말이 오프라인으로 표시 | **P1** |
| 9 | 입력 검증 전무 | 비정상 페이로드 | NPE·캐스팅 실패로 500 | **P1** |
| 10 | 썸네일 업로드 실패 시 로컬 파일 잔존 | S3 오류 | 디스크 누수 | P2 |
| 11 | DES/ECB + 8바이트 고정키 | 암호화 활성화 시 | 사실상 평문 수준 | P2 |
| 12 | SSE·WebClient 데드코드 | 상시 | 불필요한 Redis 구독·스레드 | P2 |
| 13 | 커넥션 풀·톰캣 설정 부재 | 트래픽 급증 | 기본값(10/200)으로 운영 | P2 |
| 14 | 운영 DataSource 가 log4jdbc 경유 | 상시 | 전 쿼리 프록시 오버헤드 | P2 |
| 15 | 웹훅 시크릿 소스 하드코딩 | 상시 | 리포 접근 시 웹훅 위조 | P2 |
| 16 | 매 리포트마다 `"임시 응답"` 발행 | 상시 | 불필요한 브로커 트래픽 | P2 |

---

## 3. P0 — 즉시 조치

### 3.1 부트스트랩·리포트 엔드포인트에 인증이 없고, 브로커 접속 정보가 평문으로 나간다

**현상**

`build.gradle` 에 `spring-boot-starter-security` 가 **없다.** 시큐리티 설정 클래스도 없다. 즉 이 서버의 모든 엔드포인트는 무인증이다.

```java
// MainController.java — 인증 없음
@PostMapping("/registration")
public ResponseEntity<ResponseMessage> registration(@RequestBody RequestMessage request) { ... }

// ReceiveController.java — 인증 없음
@PostMapping("/report")
public ResponseEntity<Void> report(@RequestBody RequestMessage request) { ... }
```

**근거 — 부트스트랩이 무엇을 돌려주는가**

부트스트랩 응답은 `bs_api_map` 테이블에서 읽어온 접속 정보 묶음이다. 그 안에 브로커 계정이 포함된다.

```java
// MainService.java:145-147 — 암호화가 주석 처리되어 있다
//        encData(returnData, "broker_id");
//        encData(returnData, "broker_pw");
        return returnData;
```

즉 `broker_id`, `broker_pw` 가 **평문 그대로 응답 본문에 실린다.** 요청자 검증은 다음 두 가지뿐이다.

```java
// MainService.java:120-131
ModelInfoResponse modelInfo = repository.selectModelByName(modelName);   // 모델명이 존재하는가
if (!Objects.equals(modelInfo.crcName(), serialSuffix)) { ... }          // 시리얼 접미사가 모델 CRC 와 일치하는가
```

모델명과 시리얼 형식은 **비밀이 아니다.** 단말 한 대만 있으면 둘 다 알 수 있다. 즉 유효한 형식의 시리얼을 만들어 보내면 누구나 브로커 계정을 받아갈 수 있다.

**근거 — 무인증 리포트가 무엇을 바꾸는가**

```java
// ReceiveService.java:52-64
String serial = requestHeader.serial();     // ← 요청 본문의 값을 그대로 신뢰
...
updateDeviceLast(data, serial);             // ud_device_last upsert
```

`ud_device_last` 는 앱이 보여주는 차량 상태·마지막 위치의 원본이다. 시리얼만 알면 임의 단말의 위치·전압·상태를 조작할 수 있다.

또한 등록되지 않은 단말이 부트스트랩을 호출하면 `md_device` 에 행이 생성된다.

```java
// MainService.java:88-98
if (device == null) {
    MdDevice newDevice = MdDevice.builder().serial(serial)...build();
    repository.insertDevice(newDevice);      // ← 무인증 INSERT
}
```

**운영에서 터지는 시나리오**

- 브로커 계정이 유출되면 공격자가 MQTT 브로커에 직접 붙는다. `nanomq_acl.conf` 의 토픽 권한이 계정 단위라면 **전 단말의 토픽을 구독·발행할 수 있다.** 다른 사용자의 주행 리포트를 실시간으로 관찰하거나, 임의 단말에 설정 변경 명령을 밀어 넣는 것이 가능해진다.
- 리포트 위조로 특정 차량의 위치를 임의 좌표로 덮어쓸 수 있다. 앱에서는 정상 데이터와 구분되지 않는다.
- `md_device` 무인증 INSERT 로 테이블을 오염시킬 수 있고, 실물 단말이 나중에 그 시리얼로 부트스트랩할 때 이미 생성된 행과 충돌한다.

**해결 시나리오**

1단계 — 단말 인증 수단을 정한다. 이게 설계 결정이므로 먼저 확정해야 한다.

| 방식 | 장점 | 단점 |
|---|---|---|
| mTLS (단말별 클라이언트 인증서) | 가장 견고, 브로커와 동일 신뢰 체계 | 단말 펌웨어·프로비저닝 변경 필요 |
| 단말별 사전 공유 토큰 (제조 시 주입) | 펌웨어 변경 소폭 | 토큰 배포·폐기 체계 필요 |
| 시리얼 + 서명(HMAC) 헤더 | 변경 최소 | 공유키 유출 시 전량 무력화 |

**단말 펌웨어 변경 없이 지금 당장 할 수 있는 것은 3단계의 망 분리다.** 인증 도입은 펌웨어 로드맵과 함께 잡아야 한다.

2단계 — 브로커 계정을 단말별로 분리한다. 지금은 전 단말이 같은 계정(`ncnvucl`)을 쓰는 것으로 보이므로, 한 대가 털리면 전부 털린다.

```
[ ] 브로커에 단말별 계정 발급 (serial 기반) 또는 클라이언트 인증서 도입
[ ] nanomq_acl.conf 에서 계정별로 자기 토픽만 허용
    device/{자기serial}/#  publish 만, server/{자기serial}/# subscribe 만
[ ] 부트스트랩 응답의 브로커 계정을 단말 고유값으로 발급
```

이렇게 하면 부트스트랩 응답이 유출돼도 **피해가 해당 단말 한 대로 국한된다.**

3단계 — 즉시 적용 가능한 완화책

```
[ ] /registration, /report 를 단말 트래픽만 도달 가능한 경로로 제한
    (ALB 리스너 규칙 / 보안그룹 / WAF 레이트리밋)
[ ] 시리얼당 부트스트랩 호출 빈도 제한 — 정상 단말은 부팅 시 1회만 호출한다
[ ] md_device 자동 생성 시 별도 상태값(pending)으로 표시하고, 미사용 행은 배치로 정리
[ ] encData 주석 해제 전에 §5.2 의 DES 문제를 먼저 해결 — 지금 그대로 켜면 보안 개선이 아니다
```

4단계 — 이상 탐지. 존재하지 않는 시리얼의 부트스트랩 시도, 같은 시리얼의 급증하는 리포트를 지표로 남긴다. 지금은 위조가 발생해도 알 방법이 없다.

**검증**

```bash
# 임의 시리얼로 부트스트랩 → 브로커 계정이 응답에 포함되는지
curl -X POST https://<device서버>/device/registration -H 'Content-Type: application/json' -d '{...}'
# 기대(조치 후): 401/403, 또는 단말 고유 계정만 반환
```

---

### 3.2 prod 프로파일이 dev 데이터베이스를 바라본다

**현상**

```yaml
# application.yml — 프로파일별 datasource url
test  : jdbc:log4jdbc:postgresql://HOST-B:5432/vwc_test?ApplicationName=deviceApiTest
dev   : jdbc:log4jdbc:postgresql://HOST-B:5432/vwc_dev?ApplicationName=deviceApiDev
stage : jdbc:log4jdbc:postgresql://HOST-B:5432/vwc_dev?ApplicationName=deviceApiStage
prod  : jdbc:log4jdbc:postgresql://HOST-B:5432/vwc_dev?ApplicationName=deviceApi
```

**근거**

prod 와 stage 가 dev 와 **같은 호스트, 같은 데이터베이스(`vwc_dev`)** 를 가리킨다. `ApplicationName` 만 다르다.

같은 리포의 api 서버 prod 설정과 비교하면 차이가 분명하다.

| 서버 | prod DB |
|---|---|
| `vueroid-web-api` | `HOST-A:5432/d21` |
| `vueroid-web-api-device` | `HOST-B:5432/vwc_dev` ← |

두 서버는 **같은 테이블(`md_device`, `ud_device_last`)을 공유해야 한다.** api 서버는 `d21` 에서 읽고, device 서버는 `vwc_dev` 에 쓴다. 서로 다른 DB다.

**운영에서 터지는 시나리오**

prod 프로파일로 device 서버를 띄우는 순간:

- 단말이 보낸 상태·위치가 `vwc_dev` 에 쌓이고, 앱은 `d21` 을 읽으므로 **모든 단말이 영원히 오프라인·위치 없음으로 보인다.**
- 부트스트랩이 `vwc_dev.md_device` 를 조회하므로 실제 등록된 단말도 미등록으로 판정되어 `Unregistration Device` 400 을 받는다. **단말이 클라우드 기능을 전혀 쓸 수 없다.**
- dev 환경에 운영 단말 데이터가 섞여 들어가 개발 DB 가 오염된다.

**먼저 확인할 것**

이 설정이 실제로 사용되는지가 관건이다. device 서버 prod 인스턴스가 아직 없다면 잠재 지뢰이고, 이미 떠 있다면 현재 진행 중인 사고다.

```bash
# 배포된 인스턴스의 실행 프로파일 확인
ps -ef | grep server.profile
```

```sql
-- 어느 DB로 붙고 있는지는 PostgreSQL 쪽에서 바로 보인다
SELECT datname, application_name, client_addr, count(*)
FROM pg_stat_activity
WHERE application_name LIKE 'deviceApi%'
GROUP BY 1,2,3;
```

**해결 시나리오**

```yaml
# prod
spring:
  datasource:
    url: jdbc:postgresql://${DB_HOST}:${DB_PORT}/${DB_NAME}?ApplicationName=deviceApi
    username: ${DB_USERNAME}
    password: ${DB_PASSWORD}
```

- 호스트·DB명을 환경변수로 빼면 **yml 복사·붙여넣기로 환경이 섞이는 실수 자체가 불가능해진다.** 이 사고의 근본 원인은 값이 코드에 있다는 점이다(§3.4 와 같은 뿌리).
- 기동 시 자기 검증을 넣는다. 프로파일과 접속 DB명이 어긋나면 부팅을 중단시킨다.

```java
@Component
@Profile("prod")
@RequiredArgsConstructor
public class DataSourceGuard implements ApplicationRunner {
    private final DataSource dataSource;
    @Override public void run(ApplicationArguments args) throws Exception {
        try (Connection c = dataSource.getConnection()) {
            String db = c.getCatalog();
            if (db.contains("dev") || db.contains("test")) {
                throw new IllegalStateException("prod 프로파일이 비운영 DB에 연결됨: " + db);
            }
        }
    }
}
```

**검증**

- prod 프로파일로 로컬 기동 시 위 가드가 예외를 던지는지
- 배포 후 `pg_stat_activity` 에서 `deviceApi` 가 운영 DB에만 보이는지

---

### 3.3 stage/prod 에 Redis 설정이 없어 localhost 로 폴백한다

**현상**

`spring.data.redis` 는 local / test / dev 프로파일에만 정의되어 있다. **stage 와 prod 블록에는 없다.**

```yaml
local : host <사내 개발 Redis>
test  : host <ElastiCache test 엔드포인트>
dev   : host <ElastiCache test 엔드포인트>
stage : (없음)   ← localhost:6379 로 폴백
prod  : (없음)   ← localhost:6379 로 폴백
```

**근거**

Redis 는 이 서버의 핵심 경로에 있다. 단말 오프라인 이벤트를 api 서버에 전달하는 유일한 통로다.

```java
// WebhookService.java:70 — 이 발행이 실패하면 앱 알림이 가지 않는다
Long receivers = stringRedisTemplate.convertAndSend(DEVICE_DISCONNECTED_CHANNEL, message);
```

Redis 미설정 시 연쇄적으로 일어나는 일:

1. `RedisConfig` 의 `@EnableRedisRepositories(enableKeyspaceEvents = ON_STARTUP)` 가 기동 시 Redis 에 `CONFIG SET` 을 시도한다 → 연결 실패
2. `RedisMessageListenerContainer` 가 계속 재연결을 시도하며 에러 로그를 쏟는다
3. `convertAndSend` 가 예외를 던진다 → `WebhookService` 의 `catch (Exception e)` 에 잡혀 로그만 남는다

3번이 특히 나쁘다. **DB 갱신(`status=power_off`)은 이미 성공한 뒤라 예외가 나도 롤백되지 않고, 호출부는 이미 200 을 반환한 상태다.** 즉 조용히 절반만 처리된다.

**운영에서 터지는 시나리오**

단말 전원이 꺼져도 앱에 실시간 알림이 가지 않는다. DB 는 갱신되므로 앱을 새로고침하면 오프라인으로 보이고, 새로고침 전까지는 온라인으로 보인다. **"가끔 알림이 안 온다"가 아니라 "항상 안 온다"인데, 화면 갱신 시에는 정상이라 원인 파악이 늦어진다.**

이 서버는 이미 유사한 사고를 겪었다(`docs/device-webhook-offline-miss.md` — 웹훅이 전량 유실되었으나 로그가 없어 발견이 늦었다). 같은 구간에서 같은 유형의 문제가 반복될 수 있다.

**해결 시나리오**

1단계 — stage/prod 프로파일에 Redis 설정을 추가한다. api 서버는 이미 프로파일별로 정의하고 있으므로 **같은 Redis 클러스터를 가리켜야 한다.** 서로 다른 Redis 를 보면 발행은 되는데 수신자가 0이다.

```yaml
# prod
spring:
  data:
    redis:
      host: ${REDIS_HOST}     # api 서버 prod 와 동일: redis-production-001...
      port: 6379
```

2단계 — 발행 실패를 조용히 넘기지 않는다. 현재 코드는 수신자 수를 로그로만 남긴다.

```java
Long receivers = stringRedisTemplate.convertAndSend(DEVICE_DISCONNECTED_CHANNEL, message);
if (receivers == null || receivers == 0) {
    log.error("[오프라인 알림 미전달][{}] 구독자 0 — api 서버 구독 상태 확인 필요. serial={}", traceId, serial);
}
```

수신자 0은 "api 서버가 구독 중이 아니다"라는 뜻이므로, **로그가 아니라 알람 대상이다.** 이 지표 하나만 있어도 위 유형의 사고를 즉시 잡을 수 있다.

3단계 — 기동 시 Redis 연결을 검증한다. 연결 불가 상태로 서비스가 뜨는 것 자체를 막는다.

```java
@Bean
public ApplicationRunner redisHealthCheck(StringRedisTemplate template) {
    return args -> template.getConnectionFactory().getConnection().ping();
}
```

4단계 — 근본적으로는 pub/sub 이 아니라 지속성 있는 전달 수단이 맞다. Redis pub/sub 은 **구독자가 없으면 메시지가 사라진다.** api 서버 배포 중 발생한 오프라인 이벤트는 지금 구조상 복구 불가다. Redis Stream 이나 별도 이벤트 테이블 + 폴링으로 바꾸면 전달 보장이 생긴다.

**검증**

```bash
redis-cli -h <운영redis> SUBSCRIBE deviceDisconnected   # 단말 전원 차단 시 메시지 도착 확인
# device 서버 로그에서 "수신자=1" 이상인지 확인 (0이면 api 서버 구독 안 됨)
```

---

### 3.4 자격증명이 형상관리에 평문으로 들어 있다

**현상**

`application.yml` 하나에 다음이 모두 들어 있다.

| 종류 | 값의 성격 |
|---|---|
| 전 프로파일 DB 계정 | api 서버와 동일 비밀번호 |
| AWS Access Key / Secret | **api 서버와 완전히 동일한 키** |
| MQTT 브로커 계정 | `spring.mqtt.username/password` |
| JWT 시크릿 | api 서버와는 다른 값 |
| DES 대칭키 | `app.encryption.des-secret-key: "testkey!"` |
| 웹훅 시크릿 | `WebHookController.java:19` 소스에 상수로 하드코딩 |

**근거 — api 서버와 AWS 키를 공유한다**

```
vueroid-web-api/src/main/resources/application.yml        aws.access-key: <운영 AWS 키>
vueroid-web-api-device/src/main/resources/application.yml amazon-properties.access-key: <동일한 값>  ← 동일
```

키가 같으므로 **권한도 같다.** device 서버는 썸네일 업로드만 하면 되는데, api 서버가 쓰는 SES·KVS·전 리전 버킷 권한을 그대로 들고 있다. device 서버가 침해되면 피해가 api 서버 범위까지 번진다.

**해결 시나리오**

§3.1 의 키 교체 작업과 함께 진행한다. device 서버 고유의 조치는 다음 두 가지다.

```
[ ] AWS 키를 서비스별로 분리 — device 서버는 ncn-vueroid-web 버킷의 dir-name 하위에 PutObject 만
[ ] 웹훅 시크릿을 소스 상수에서 설정값으로 이동 (§5.4)
```

나머지(환경변수 주입, `.gitignore`, 히스토리 정리, CI 시크릿 스캔)는 api 서버 문서 §3.1 과 동일하다. **두 프로젝트를 같은 작업으로 묶어 한 번에 처리하는 편이 낫다.**

---

## 4. P1 — 규모 확대 전 필수

### 4.1 MQTT 수신 전량이 단일 스레드에서 동기 처리된다

**현상**

```java
// MqttConfig.java:70-76
@Bean
public MessageChannel mqttInboundChannel() {
    return new DirectChannel();      // ← 발신 스레드에서 그대로 실행
}
```

`DirectChannel` 은 큐도 스레드 풀도 없다. 메시지를 넣은 스레드가 핸들러를 **동기로 실행**한다. MQTT 어댑터의 발신 스레드는 Paho 클라이언트 콜백 스레드 하나뿐이다.

즉 `report`, `reportThumbnail` 전량이 **한 스레드에서 순차 처리된다.**

```java
// MqttService.java:26-48 — 이 메서드 전체가 단일 스레드에서 직렬 실행
case "report" -> {
    receiveService.report(request);                       // DB 조회 + upsert (pgcrypto 암호화 2회)
    mqttGateway.sendToMqtt("임시 응답", "response/" + serial);
}
case "reportThumbnail" -> {
    receiveService.reportThumbnail(serial, payload);      // 로컬 파일 쓰기 + S3 업로드 + DB 2회
}
```

**근거 — 처리량 한계**

리포트 주기 기본값은 3초다.

```java
// MainService.java:82
returnData.put("report_cycle", Integer.parseInt(returnData.getOrDefault("report_cycle", "3").toString()));
```

단말 N대면 초당 `N/3` 건이 들어온다. 리포트 1건은 `getDeviceInfo` 조회 + `getGpsTermYn` 조회 + `insertDeviceLast` upsert = **DB 왕복 3회**이며, upsert 안에서 `encrypt_number_aes256()` 이 2회 호출된다.

왕복당 1ms 를 가정해도 건당 3ms 이상이므로 단일 스레드 상한은 **초당 300건 안팎**이다. 역산하면 단말 약 900대에서 포화한다. (정확한 수치는 실측이 필요하다. 여기서는 자릿수만 본다.)

썸네일은 더 나쁘다. S3 업로드는 `join()` 으로 완료를 기다린다.

```java
// S3V2Transfer.java:47-52
FileUpload upload = transferManager.uploadFile(uploadRequest);
CompletedFileUpload result = upload.completionFuture().join();   // ← 블로킹
```

업로드 한 건에 200ms 가 걸리면 **그 200ms 동안 모든 단말의 리포트가 멈춘다.**

**운영에서 터지는 시나리오**

- 처리 속도가 유입 속도를 못 따라가면 Paho 콜백이 밀리고, QoS 1 의 PUBACK 이 지연된다. 브로커는 미확인 메시지를 버퍼링하다 한계에 닿으면 **메시지를 버린다.** 단말 상태가 갱신되지 않아 앱에서 "차량 정보 없음"이 된다.
- 지연은 서서히 누적되므로 임계점을 넘기 전까지 지표에 잘 안 보인다. 넘는 순간 전면 장애가 된다.
- 썸네일이 몰리는 시간대(출퇴근)에 리포트 지연이 집중된다.

**해결 시나리오**

1단계 — 수신 채널을 큐 기반으로 바꿔 스레드를 분리한다.

```java
@Bean
public MessageChannel mqttInboundChannel() {
    // 큐 용량을 명시해, 밀리면 조용히 쌓이는 대신 눈에 보이게 만든다
    return new QueueChannel(10_000);
}

@Bean
public IntegrationFlow mqttInboundFlow(MessageChannel mqttInboundChannel) {
    return IntegrationFlow.from(mqttInboundChannel)
            .channel(MessageChannels.executor(mqttExecutor()))   // 워커 풀에서 처리
            .handle(...)
            .get();
}
```

2단계 — **리포트와 썸네일을 서로 다른 풀로 분리한다.** 성격이 완전히 다르다.

| 종류 | 특성 | 적정 풀 |
|---|---|---|
| report | 짧은 DB 작업, 고빈도 | DB 커넥션 풀 크기에 맞춤 (8~16) |
| reportThumbnail | S3 I/O 대기, 저빈도·고지연 | 별도 풀 (4~8) |

썸네일이 느려도 리포트는 계속 처리되어야 한다.

3단계 — 리포트 처리 자체의 DB 왕복을 줄인다. 현재 건당 3회다.

```java
// getDeviceInfo 와 getGpsTermYn 은 같은 md_device 행을 두 번 읽는다 → 한 번으로 합친다
Optional<DeviceInfoResponse> info = receiveRepository.getDeviceInfo(serial);  // terms_gps 를 여기 포함
```

`md_device` 는 변경 빈도가 낮으므로 **시리얼 기준 캐시(TTL 수 분)를 두면 왕복이 3회에서 1회로 준다.** 단말 900대 한계가 2,700대로 늘어난다.

4단계 — 스케일아웃 준비. 구독은 이미 공유 구독(`$share/backend-group/`)으로 되어 있어 인스턴스를 늘리면 부하가 분산된다. **다만 브로커(NanoMQ)가 공유 구독을 지원하는 버전인지 확인이 필요하다.** 미지원이면 전 인스턴스가 모든 메시지를 받아 중복 처리된다.

```bash
# 인스턴스 2대 기동 후 같은 리포트가 양쪽 로그에 모두 찍히는지 확인
```

5단계 — 지표를 남긴다. 큐 적재량, 건당 처리시간, 브로커 미확인 메시지 수. 지금은 밀리고 있는지 알 수단이 없다.

**검증**

- 단말 시뮬레이터로 목표 대수의 리포트를 주입하며 큐 적재량이 0 근처를 유지하는지
- 썸네일을 대량 주입하는 동안 리포트 처리 지연이 늘지 않는지

---

### 4.2 오프라인 웹훅 처리 큐가 무제한이고 휘발성이다

**현상**

```java
// WebhookService.java:23
@Async
public void processDisconnection(String traceId, long receivedAt, String clientId, String reason) {
```

`@EnableAsync` 는 있지만(`VcDeviceApplication.java:10`) **전용 Executor 빈이 없다.** 스프링 부트 기본 `applicationTaskExecutor` 가 쓰이며 기본값은 다음과 같다.

```
core-size  : 8
max-size   : Integer.MAX_VALUE
queue-capacity : Integer.MAX_VALUE   ← 사실상 무제한
```

큐가 무제한이면 **max-size 는 영원히 발동하지 않는다.** 항상 8개 스레드만 일하고 나머지는 힙에 쌓인다.

**근거**

컨트롤러는 검증만 하고 즉시 200 을 반환한다.

```java
// WebHookController.java:56
webhookService.processDisconnection(traceId, receivedAt, payload.clientId(), payload.reason());
return ResponseEntity.ok().build();     // ← 처리 완료를 보장하지 않는다
```

브로커 입장에서는 전달에 성공한 것이므로 재전송하지 않는다. 이후 처리가 실패하거나 유실되어도 **복구 경로가 없다.**

**운영에서 터지는 시나리오**

- **브로커 재기동·네트워크 순단** 시 전 단말의 연결이 동시에 끊긴다. 단말 1만 대면 웹훅 1만 건이 한꺼번에 들어온다. 8개 스레드가 건당 DB 2회 + Redis 1회로 처리하므로 소진에 수 분이 걸리고, 그동안 나머지는 힙에 머문다.
- 그 사이에 배포나 재기동이 걸리면 **큐에 있던 이벤트는 전부 소실된다.** 해당 단말들은 DB 상 영원히 온라인으로 남는다. 다시 오프라인이 되려면 또 한 번 끊겨야 한다.
- 이 서버는 웹훅 유실로 이미 한 번 사고를 겪었다(`docs/device-webhook-offline-miss.md`). 그때 원인은 브로커 설정이었고 애플리케이션 코드는 무관했지만, **지금 구조에서는 애플리케이션 쪽에서도 같은 증상이 발생할 수 있다.**

**해결 시나리오**

1단계 — Executor 를 명시하고 큐를 유한하게 만든다. 무제한 큐는 문제를 감추기만 한다.

```java
@Bean("webhookExecutor")
public ThreadPoolTaskExecutor webhookExecutor() {
    ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
    executor.setCorePoolSize(8);
    executor.setMaxPoolSize(32);
    executor.setQueueCapacity(2_000);                 // 넘치면 즉시 드러난다
    executor.setThreadNamePrefix("webhook-");
    executor.setWaitForTasksToCompleteOnShutdown(true);
    executor.setAwaitTerminationSeconds(30);          // 종료 시 큐 소진 대기 → 배포 중 유실 방지
    executor.setRejectedExecutionHandler(new ThreadPoolExecutor.CallerRunsPolicy());
    return executor;
}
```

`@Async("webhookExecutor")` 로 지정한다. `CallerRunsPolicy` 를 쓰면 큐가 차는 순간 요청 스레드가 직접 처리하므로 **자연스럽게 브로커 쪽으로 역압(backpressure)이 전달된다.** 유실보다 낫다.

2단계 — 종료 시 소진을 보장한다. `setWaitForTasksToCompleteOnShutdown(true)` + `graceful shutdown` 조합이 필요하다.

```yaml
server:
  shutdown: graceful
spring:
  lifecycle:
    timeout-per-shutdown-phase: 30s
```

3단계 — 유실 시 복구 경로를 만든다. 위 조치들은 유실 확률을 낮출 뿐 0으로 만들지 못한다. **주기적 정합성 보정이 진짜 해법이다.**

```
브로커 관리 API 로 현재 접속 중인 클라이언트 목록을 조회
  → ud_device_last.status 가 온라인인데 목록에 없는 단말을 찾아 power_off 로 보정
  → 5분 주기 실행
```

웹훅은 실시간성을 담당하고, 이 배치가 최종 정합성을 보장한다. 이벤트 기반 시스템에서는 둘 다 필요하다.

4단계 — 큐 적재량과 처리 지연을 지표로 남긴다. 현재 로그에 `큐 대기={}ms` 가 이미 찍히고 있으므로(`WebhookService.java:33`) **그 값을 메트릭으로 승격시키면 된다.**

**검증**

- 웹훅 5,000건을 한꺼번에 주입하고 처리 완료 건수 확인 (유실 0)
- 주입 도중 프로세스를 재기동해도 graceful shutdown 으로 큐가 소진되는지
- 보정 배치가 누락된 단말을 실제로 잡아내는지

---

### 4.3 운영 로그가 debug 레벨이고 2일 만에 사라진다

**현상**

```xml
<!-- logback_prod.xml -->
<logger name="com.ncn" level="debug" additivity="false">
<root level="debug">
...
<maxFileSize>50MB</maxFileSize>
<totalSizeCap>500MB</totalSizeCap>
<maxHistory>2</maxHistory>
```

**근거**

운영에서 root 와 애플리케이션 로거가 모두 **debug** 다. 이 서버는 단말 전량의 리포트를 받는다. 단말 1,000대 × 3초 주기면 초당 333건이고, 건당 로그가 몇 줄만 나가도 **하루 수십 GB** 가 된다.

보존 상한은 500MB 다. 즉 **몇 시간 지난 로그는 남아 있지 않다.**

정상 동작이 WARN 으로 기록되는 곳도 있다.

```java
// ReceiveService.java:117 — 썸네일 저장 성공인데 warn
log.warn("Saved report thumbnail. serial={}, path={}, size={}", serial, target, payload.length);
```

WARN 은 "확인이 필요한 상황"이라는 신호인데, 정상 흐름에서 계속 찍히면 **진짜 경고가 묻힌다.** 최근 커밋 이력에도 썸네일 로그를 주석 처리했다 되돌린 흔적이 반복된다(`8e77f53`, `ff4e9de`) — 로그 레벨 기준이 정리되지 않았다는 신호다.

**운영에서 터지는 시나리오**

- 장애 발생 후 조사에 착수했을 때 이미 로그가 밀려 나갔다. §3.3 의 Redis 미설정 같은 문제도 **에러 로그가 남아 있어야 발견되는데, 그 로그가 몇 시간 만에 사라진다.**
- debug 로깅 자체가 디스크 I/O 를 점유해 §4.1 의 단일 스레드 처리를 더 느리게 만든다.
- 디스크가 차면 로그 기록이 실패하고, 최악의 경우 애플리케이션이 멈춘다.

**해결 시나리오**

1단계 — 운영 레벨을 정리한다.

```xml
<logger name="com.ncn" level="info" additivity="false">
<root level="warn">
```

2단계 — 로그 레벨 기준을 정한다. 지금은 기준이 없어 사람마다 다르게 쓴다.

```
ERROR : 사람이 조치해야 하는 실패 (Redis 발행 실패, DB 갱신 0건, S3 업로드 실패)
WARN  : 비정상이나 자동 복구되는 상황 (재시도 성공, 알 수 없는 토픽)
INFO  : 상태 전이 (부트스트랩, 오프라인 처리 완료) — 건당이 아니라 이벤트당
DEBUG : 개발 전용. 운영에서 켜지 않는다
```

리포트처럼 초당 수백 건 발생하는 이벤트는 **건별 로그 대신 집계 지표로 바꾼다.** "초당 처리 건수", "평균 처리시간"이 개별 로그 수백 줄보다 유용하다.

3단계 — 중앙 수집으로 옮기고 보존을 30~90일로 늘린다. api 서버와 동일한 조치이므로 묶어서 진행한다.

4단계 — 런타임 레벨 조정 수단을 남긴다. 문제 조사 시 재배포 없이 특정 로거만 debug 로 올릴 수 있어야 한다. actuator `loggers` 엔드포인트를 관리 포트에서만 쓰도록 열어두면 된다.

**검증**

- 운영 부하에서 하루 로그 생성량이 보존 정책 안에 들어오는지
- WARN 이상만 필터링했을 때 실제 조치가 필요한 건만 남는지

---

### 4.4 단말 상태 갱신에 순서 보장이 없다

**현상**

같은 `ud_device_last` 행을 서로 다른 경로가 갱신한다.

```sql
-- ReceiveMapperSQL.xml — 리포트 수신 (MQTT, 3초 주기)
insert into ud_device_last (...) values (...) on conflict (serial) do update set time = excluded.time, status = excluded.status, ...

-- MainMapperSQL.xml — 오프라인 웹훅 (HTTP, 비동기)
update ud_device_last set status = 'power_off' where serial = #{serial}
```

**근거**

두 경로 어디에도 **시간 조건이 없다.** 나중에 도착한 쪽이 무조건 이긴다. 그런데 도착 순서는 보장되지 않는다.

- 리포트는 MQTT → 공유 구독 → 큐 → 워커를 거친다
- 웹훅은 HTTP → `@Async` 큐(코어 8, §4.2)를 거친다

두 큐의 지연이 다르므로 **실제 발생 순서와 처리 순서가 어긋난다.**

**운영에서 터지는 시나리오**

터널 통과 같은 짧은 단절에서:

```
t=0   단말 연결 끊김        → 브로커가 웹훅 발행
t=2s  단말 재접속
t=3s  단말이 리포트 전송     → status='on' 으로 upsert (즉시 처리)
t=5s  웹훅이 큐에서 빠져나옴 → status='power_off' 로 덮어씀   ← 역전
```

결과: **정상 주행 중인 차량이 앱에서 오프라인으로 표시된다.** 다음 리포트가 3초 뒤 오므로 짧게 깜빡이는 정도지만, 웹훅 큐가 밀린 상황(브로커 재기동 직후)에서는 수 분간 오프라인으로 굳는다.

`updated == 0` 경고는 이미 로깅되지만(`WebhookService.java:58`), **덮어쓰기는 0건이 아니라 1건이므로 이 경고에 걸리지 않는다.**

**해결 시나리오**

1단계 — 이벤트 발생 시각을 기준으로 갱신을 가드한다. 웹훅 페이로드에는 브로커가 만든 `timestamp` 가 이미 들어 있다(`MqttWebhookPayload.timestamp()`).

```sql
update ud_device_last
set status = 'power_off',
    time = #{eventTime}
where serial = #{serial}
  and (time is null or time < #{eventTime})   -- 더 최신 데이터가 있으면 갱신하지 않는다
```

리포트 upsert에도 같은 가드를 건다.

```sql
on conflict (serial) do update set ...
where ud_device_last.time is null or ud_device_last.time < excluded.time
```

2단계 — 시간 기준을 통일한다. 지금은 `time` 컬럼에 **단말이 보낸 시각**이 들어가고, 웹훅은 **브로커 시각**을 갖고 있다. 단말 시계가 틀어져 있으면 비교가 무의미하다. 이벤트 순서 판정용 `updated_at`(서버 수신 시각) 컬럼을 별도로 두고, 표시용 `time` 과 분리하는 편이 안전하다.

```
time       : 단말이 보고한 시각 (표시용)
event_at   : 이벤트 발생 시각 (브로커/서버 기준, 순서 판정용)
```

3단계 — §4.2 의 보정 배치가 최종 안전망이 된다. 순서 역전으로 틀어진 상태도 5분 내에 실제 접속 상태로 수렴한다.

**검증**

- 웹훅을 인위적으로 지연시킨 뒤 리포트를 먼저 주입 → `status` 가 `power_off` 로 덮이지 않는지
- 단말 시뮬레이터로 짧은 재접속을 반복하며 상태 깜빡임이 사라지는지

---

### 4.5 입력 검증이 전혀 없다

**현상**

프로젝트 전체에 `@Valid`, `@NotNull`, `@NotBlank` 가 **하나도 없다.** 요청 본문의 값이 그대로 SQL 로 들어간다.

**근거 — 확인된 실패 경로 세 가지**

**(1) NPE — `terms_gps` 가 NULL 일 때**

```java
// ReceiveService.java:194
if (receiveRepository.getGpsTermYn(serial).equals("N")) {
```

```sql
<!-- ReceiveMapperSQL.xml -->
select terms_gps from md_device md where serial = #{serial}
```

`terms_gps` 는 nullable 이다. 부트스트랩으로 자동 생성된 `md_device` 행(§3.1)에는 이 컬럼이 없으므로 **NULL 이 확정적으로 발생한다.** NULL 에 `.equals()` 를 호출하면 NPE 다.

MQTT 경로에서는 `MqttService` 의 `catch (Exception e)` 에 잡혀 로그만 남고 해당 리포트가 버려진다. HTTP 경로(`/report`)에서는 500 이 나간다.

**(2) 캐스팅 실패 — 좌표가 숫자가 아닐 때**

```sql
encrypt_number_aes256(#{latitude}::numeric)
```

`latitude` 는 `String` 이다(`ReportRequest`). 단말이 `"N/A"`, `""` 같은 값을 보내면 PostgreSQL 이 `invalid input syntax for type numeric` 을 던진다. 같은 파라미터가 CASE 문에서 두 번 더 캐스팅된다.

**(3) 상태값 무제한** — `status` 는 화이트리스트 없이 저장된다. 앱이 아는 값 외의 문자열이 들어오면 화면이 어떻게 되는지 정의되어 있지 않다.

**운영에서 터지는 시나리오**

펌웨어 업데이트로 필드 형식이 바뀌거나 특정 상황에서 빈 값이 나가면, **해당 펌웨어를 쓰는 단말 전체의 리포트가 조용히 버려진다.** MQTT 경로는 예외를 삼키므로 에러율 지표에도 잡히지 않는다. 사용자에게는 "차량 정보가 안 보인다"로 나타난다.

**해결 시나리오**

1단계 — NULL 안전 처리부터. 한 줄이면 된다.

```java
if ("N".equals(receiveRepository.getGpsTermYn(serial))) {
```

`terms_gps` 가 NULL 일 때의 의미를 기획에서 확정해야 한다. **GPS 동의를 받지 않은 상태를 "미동의(마스킹)"로 볼지 "동의(저장)"로 볼지는 개인정보 처리 방침 문제다.** 안전한 기본값은 마스킹이다.

2단계 — DTO 경계에서 검증한다.

```java
public record ReportRequest(
        @Pattern(regexp = "-?\\d+(\\.\\d+)?") String longitude,
        @Pattern(regexp = "-?\\d+(\\.\\d+)?") String latitude,
        ...
) {}
```

좌표·속도·전압은 애초에 문자열이 아니라 숫자 타입이어야 한다. 단말 페이로드가 문자열로 온다면 DTO 에서 파싱해 도메인 타입으로 바꾸고, 파싱 실패는 명시적으로 처리한다.

3단계 — 검증 실패를 관측 가능하게 만든다. 지금처럼 조용히 버리지 않는다.

```java
catch (ValidationException e) {
    log.warn("[리포트 폐기] serial={}, 사유={}", serial, e.getMessage());
    invalidReportCounter.increment();     // 지표로 승격
}
```

**단말 펌웨어 문제는 이 카운터가 튀는 것으로 가장 먼저 드러난다.**

4단계 — `status` 를 enum 으로 제한하고, 알 수 없는 값은 폐기하거나 별도 값으로 정규화한다.

**검증**

- `terms_gps` 가 NULL 인 시리얼로 리포트 전송 → NPE 없이 마스킹 처리되는지
- 좌표에 `"abc"` 를 넣은 리포트 → 500 이 아니라 검증 실패 카운터 증가

---

## 5. P2 — 정리 대상

### 5.1 썸네일 업로드 실패 시 로컬 파일이 남는다

```java
// S3V2Transfer.java:33-41
public AwsInfo uploadAndRemove(long userId, String storePath, String fileName, Path path, boolean del) {
    ...
    uploadAsync(uploadPath, path);      // ← 실패 시 여기서 예외
    if (del) {
        path.toFile().delete();         // ← 도달하지 않는다
    }
```

S3 업로드가 실패하면 `join()` 이 `CompletionException` 을 던지고 **로컬 임시 파일이 그대로 남는다.** 정리 주체가 없으므로 S3 장애가 길어질수록 디스크가 찬다.

같은 메서드에 문제가 셋 더 있다.

- 메서드 이름은 `uploadAsync` 인데 `join()` 으로 동기 대기한다 — 호출부가 비동기로 오해하기 쉽다
- `delete()` 의 반환값을 무시한다 — 삭제 실패를 알 수 없다
- `Files.write(..., StandardOpenOption.CREATE_NEW)`(`ReceiveService.java:114`)는 파일명이 `serial + 밀리초` 라서 **같은 단말이 같은 밀리초에 두 장을 보내면 예외**가 난다

조치 방향:

```java
try {
    uploadFile(uploadPath, path);
} finally {
    if (del && !path.toFile().delete()) {
        log.warn("임시 썸네일 삭제 실패. path={}", path);
    }
}
```

- 파일명에 UUID 를 붙여 충돌 자체를 없앤다.
- 더 나은 방향은 **로컬 파일을 아예 만들지 않는 것이다.** 페이로드가 이미 메모리에 `byte[]` 로 있으므로 `AsyncRequestBody.fromBytes()` 로 바로 올리면 디스크 경로가 사라진다. 디스크 누수·경로 충돌·권한 문제가 한꺼번에 없어진다.
- 임시 디렉터리(`./works/report-thumbnail`) 정리 배치를 두어 잔존 파일을 회수한다.

### 5.2 DES/ECB + 8바이트 고정키

```java
// EncryptionComponent.java:13
private static final String ALGORITHM = "DES/ECB/NoPadding";
```

```yaml
app.encryption.des-secret-key: "testkey!"   # 임시 대칭키
```

DES 는 키 길이 56비트로 현재 기준에서 안전하지 않고, ECB 모드는 같은 평문이 같은 암호문이 되어 패턴이 그대로 드러난다. 키는 소스와 함께 배포되는 고정값이며 주석에도 "임시"라고 적혀 있다.

현재 이 컴포넌트를 쓰는 곳은 브로커 계정 암호화인데 **주석 처리되어 있어 평문으로 나간다**(§3.1). 즉 지금은 평문이고, 주석을 풀면 DES-ECB 다. **둘 다 대책이 아니다.**

조치 방향: 단말 펌웨어가 요구하는 알고리즘이 DES 로 고정되어 있다면 암호화로 기밀성을 확보할 수 없다는 사실을 전제로 설계해야 한다. **§3.1 의 "단말별 계정 발급"이 실질적인 해법이다.** 계정이 단말마다 다르면 전송 구간에서 노출돼도 피해가 한 대로 제한된다. 펌웨어 변경이 가능하다면 AES-GCM + 단말별 키로 전환한다.

### 5.3 SSE 기계와 WebClient 가 데드코드다

```
SSEEmitters.java (136줄)        → register() 호출부 없음. SSE 컨트롤러 자체가 없다
RedisSubscriber.java            → "browser" 채널 구독 → 존재하지 않는 emitter 로 전송 시도
SchedulerConfig.java            → SSE 하트비트 전용 스레드 2개
WebClientConfig.apisWebClient   → 주입받는 곳 없음
api.url (전 프로파일)            → 위 WebClient 만 사용 → 실질 미사용
```

api 서버에서 복사해 온 코드가 그대로 남은 것으로 보인다. 동작에 해는 없지만 Redis 구독과 스레드를 점유하고, 무엇보다 **"이 서버가 SSE 를 처리한다"는 잘못된 인상을 준다.** 실제로 SSE 를 담당하는 것은 api 서버다.

조치 방향: 삭제한다. `api.url` 설정도 함께 제거한다. prod 값이 `https://prod.vueroid-cloud.com/...` 인데 이 도메인은 다른 설정에서 쓰이지 않아, 살리려 할 때 혼란을 부른다.

### 5.4 웹훅 시크릿이 소스에 하드코딩되어 있다

```java
// WebHookController.java:19
private static final String VALID_KEY = "webhook-secret-token";
...
if (secretKey == null || !secretKey.equals(VALID_KEY)) {
```

- 값이 소스에 있어 환경별로 다르게 할 수 없고, 교체하려면 재배포가 필요하다
- `equals` 비교는 상수시간이 아니다 (실무상 위험은 낮지만 표준 관행은 `MessageDigest.isEqual`)

조치 방향: 설정값(`${webhook.secret}`)으로 빼고 환경변수로 주입한다. 브로커의 `nanomq.conf` 웹훅 헤더 설정과 함께 교체해야 하므로 **양쪽을 동시에 바꾸는 절차를 문서화한다.** `docs/device-webhook-offline-miss.md` 에 기록된 대로, 이 헤더 불일치는 과거에 실제 유실 원인 중 하나였다.

### 5.5 매 리포트마다 `"임시 응답"` 을 발행한다

```java
// MqttService.java:33
mqttGateway.sendToMqtt("임시 응답", "response/" + serial);
```

리포트를 받을 때마다 하드코딩된 한국어 문자열을 브로커로 되돌려 보낸다. 단말 1,000대 × 3초 주기면 **초당 333건의 불필요한 발행**이다. 브로커 부하와 단말 수신 대역을 모두 낭비한다.

조치 방향: 단말이 이 응답을 실제로 소비하는지 확인한다. 소비하지 않으면 삭제하고, 소비한다면 의미 있는 응답 형식을 정의한다. `"temporary"` 케이스도 같은 상태다.

### 5.6 커넥션 풀·톰캣 설정이 없다

`application.yml` 에 `spring.datasource.hikari` 와 `server.tomcat` 설정이 전혀 없다. 기본값(Hikari 10 / 톰캣 200)으로 운영된다.

이 서버는 §4.1 의 조치로 워커 풀을 도입하면 DB 커넥션 경쟁이 생긴다. **워커 풀 크기와 커넥션 풀 크기를 함께 정해야 한다.** 워커가 커넥션보다 많으면 대기만 늘어난다.

```yaml
spring:
  datasource:
    hikari:
      maximum-pool-size: 16      # MQTT 워커 + 웹훅 워커 + HTTP 스레드 합계 고려
      connection-timeout: 3000
      max-lifetime: 1800000
```

api 서버와 같은 DB 를 쓰므로 **인스턴스 전체 합계가 PostgreSQL `max_connections` 를 넘지 않도록** 함께 계산한다.

### 5.7 운영 DataSource 가 log4jdbc 를 경유한다

api 서버와 동일한 문제다. 전 프로파일이 `net.sf.log4jdbc.sql.jdbcapi.DriverSpy` 를 쓴다. 이 서버는 초당 수백 건의 쿼리가 나가는 곳이라 **프록시 오버헤드가 api 서버보다 크게 작용한다.**

조치 방향: prod 프로파일만 `org.postgresql.Driver` 로 되돌리고 URL 의 `jdbc:log4jdbc:` 접두어를 제거한다.

---

## 6. 조치 순서

| 단계 | 기간 | 항목 | 배포 리스크 |
|---|---|---|---|
| 0 | 즉시 | prod DB 설정 확인·수정(§3.2), stage/prod Redis 설정 추가(§3.3) | 낮음 — 설정 변경. **다만 prod 미배포 상태인지 먼저 확인** |
| 1 | 즉시 | 자격증명 교체 — api 서버와 묶어서 진행(§3.4) | 없음 (인프라 작업) |
| 2 | 1주 | 로그 레벨 정리·중앙 수집(§4.3), Redis 발행 실패 알람(§3.3 2단계) | 낮음 — 관측 개선이 먼저다 |
| 3 | 1주 | 입력 검증·NPE 수정(§4.5), 썸네일 파일 누수(§5.1), 데드코드 제거(§5.3) | 낮음 |
| 4 | 2주 | 웹훅 Executor 명시 + graceful shutdown + 보정 배치(§4.2) | 중간 — 유실 방지 효과가 크다 |
| 5 | 2주 | 상태 갱신 순서 가드(§4.4) | 중간 — SQL 변경, 데이터 확인 필요 |
| 6 | 3주 | MQTT 수신 스레드 분리·풀 격리(§4.1), 커넥션 풀 조정(§5.6) | 높음 — 부하 테스트 필수 |
| 7 | 별도 | 단말 인증 체계 도입(§3.1) | 높음 — 펌웨어 로드맵 연계 |

**0단계를 최우선으로 두는 이유**: prod 프로파일이 실제로 사용 중이라면 이건 분석 대상이 아니라 진행 중인 장애다. 다른 어떤 조치보다 먼저 확인해야 한다.

**7단계를 마지막에 둔 이유**: 단말 인증은 서버만으로 완결되지 않는다. 펌웨어·제조 공정·브로커 설정이 함께 움직여야 하므로 별도 과제로 관리한다. 그 전까지는 §3.1 3단계의 망 분리로 완화한다.

---

## 7. 검증 체크리스트

```
[ ] prod 인스턴스가 운영 DB에 연결됨 (pg_stat_activity 로 확인)
[ ] prod 기동 시 DataSourceGuard 가 비운영 DB 연결을 차단
[ ] Redis 발행 수신자 수가 1 이상 (api 서버 구독 확인)
[ ] 단말 전원 차단 → 앱에 실시간 오프라인 알림 도달
[ ] terms_gps 가 NULL 인 단말의 리포트가 NPE 없이 처리
[ ] 좌표에 비정상 값을 넣은 리포트가 500 없이 폐기 + 카운터 증가
[ ] 썸네일 대량 주입 중에도 리포트 처리 지연이 늘지 않음
[ ] 웹훅 5,000건 주입 중 재기동해도 유실 0
[ ] 재접속 직후 리포트가 오프라인 웹훅에 덮이지 않음
[ ] S3 업로드 실패 후 로컬 임시 파일이 남지 않음
[ ] 운영 로그 하루 생성량이 보존 정책 내
[ ] 무인증 부트스트랩 호출 시 브로커 계정이 응답에 없음
```

---

## 8. 경력기술서용 요약

**1) IoT 수집 서버 처리량 병목 규명 및 구조 개선**
> 단말 리포트·썸네일 전량이 Spring Integration `DirectChannel` 을 통해 MQTT 콜백 단일 스레드에서 동기 처리되며, 건당 DB 왕복 3회와 S3 동기 업로드가 같은 스레드를 공유하는 구조를 확인. 리포트와 썸네일을 별도 워커 풀로 분리하고, 단말 정보 캐시로 DB 왕복을 3회에서 1회로 축소, 큐 적재량·건당 처리시간 지표를 도입해 포화 시점을 사전에 감지 가능하도록 개선.

**2) 이벤트 유실 방지 체계 설계**
> 단말 오프라인 웹훅이 무제한 큐의 비동기 처리로 위임되어, 브로커 재기동 시 대량 이벤트가 힙에 적체되고 배포 중 전량 소실되는 경로를 확인. 유한 큐 + `CallerRunsPolicy` 로 역압을 전달하고 graceful shutdown 으로 배포 중 유실을 차단, 브로커 접속 목록과 DB 상태를 대조하는 주기적 보정 배치를 추가해 실시간성과 최종 정합성을 분리 보장.

**3) 분산 이벤트 순서 역전 문제 해결**
> 리포트(MQTT)와 오프라인 웹훅(HTTP)이 서로 다른 큐를 거쳐 같은 레코드를 갱신하면서, 재접속 직후 정상 단말이 오프라인으로 표시되는 경합을 규명. 이벤트 발생 시각 기반 조건부 갱신(`where time < :eventTime`)을 적용하고, 단말 보고 시각과 서버 수신 시각을 분리해 시계 오차에 영향받지 않는 순서 판정 기준을 수립.

**4) 환경 설정 사고 예방 체계 구축**
> 운영 프로파일이 개발 DB 를 참조하고 stage/prod 에 Redis 설정이 누락되어 localhost 로 폴백하는 설정 결함을 발견. 접속 정보를 환경변수로 외부화하고, 기동 시 프로파일과 실제 연결 대상을 대조해 불일치 시 부팅을 중단시키는 가드를 추가해 설정 오류가 런타임 장애로 이어지지 않도록 차단.

**5) 무인증 단말 인터페이스 진단 및 완화**
> 시큐리티 계층 없이 노출된 부트스트랩·리포트 엔드포인트가 단말 레코드 생성과 상태 위조를 허용하고, 부트스트랩 응답에 공용 브로커 계정이 평문으로 포함되는 구조를 진단. 단말별 브로커 계정 발급과 토픽 단위 ACL 로 침해 범위를 단말 1대로 한정하는 방안을 설계하고, 펌웨어 변경 전까지 적용할 망 분리·호출 빈도 제한·이상 탐지 지표를 단계적 완화책으로 정리.

**6) 로깅 정책 정립**
> 운영 환경이 DEBUG 레벨로 동작하고 보존 상한 500MB·2일에 걸려 장애 조사 시점에 로그가 이미 소실되는 상태를 확인. 레벨별 기준(ERROR=조치 필요 / WARN=자동 복구 / INFO=상태 전이)을 정의하고, 초당 수백 건 발생하는 이벤트를 건별 로그에서 집계 지표로 전환, 중앙 수집으로 보존기간을 90일까지 확보.

---

## 9. 관련 문서

| 문서 | 내용 |
|---|---|
| `docs/device-webhook-offline-miss.md` | 웹훅 유실 사고 분석 — 본 문서 §4.2, §5.4 의 배경 |
| `docs/api-server-production-risks.md` | api 서버 리스크 — 자격증명·로깅은 동일 조치로 묶어 진행 |
| `docs/api-todo.md` | `region_cd` 값 의미 불일치 — 본 서버 `MainService` 부트스트랩에서 사용 |
