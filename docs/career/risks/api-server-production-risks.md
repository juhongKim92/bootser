# api 서버 운영 리스크 분석 및 해결 시나리오

- **작성일**: 2026-08-31
- **대상**: `vueroid-web-api` (Spring Boot 3.4.3 / Java 21 / PostgreSQL / Redis / MQTT / AWS KVS)
- **상태**: 분석 완료, 조치 미착수

---

## 1. 요약

사용자 앱·웹이 직접 호출하는 프론트 도어 서버다. 인증, 단말 관리, 라이브 스트리밍 엔드포인트 발급, 알림(SSE/FCM), 통계, 파일 조회를 한 프로세스에서 처리한다.

기능은 동작하지만, **운영 규모가 커지거나 인스턴스를 2대 이상으로 늘리는 순간 무너지는 지점이 다수 존재한다.** 크게 네 갈래다.

| 갈래 | 핵심 문제 |
|---|---|
| 자격증명 관리 | 운영 DB·AWS·JWT 서명키·Apple/Google 시크릿이 전부 형상관리에 평문 커밋 |
| 상태 저장 위치 | 세션성 데이터(OAuth state, 레이트리밋, 분산 락)가 인스턴스 로컬 메모리 → 스케일아웃 불가 |
| 스레드/커넥션 예산 | 톰캣 200 스레드가 최대 10초 블로킹되는 외부 I/O를 물고, DB 커넥션은 10개 |
| 관측 가능성 | 미상 예외를 400 으로 변환 + 스택트레이스 미출력, 로그 보존 2일 |

아래 항목은 **재현 조건과 코드 위치를 함께 명시**했다. 각 항목은 `현상 → 근거 → 운영에서 터지는 시나리오 → 해결 시나리오 → 검증 방법` 순으로 정리한다.

---

## 2. 위험도 요약

| # | 항목 | 터지는 조건 | 영향 | 우선순위 |
|---|---|---|---|---|
| 1 | 자격증명 전량 형상관리 커밋 | 리포 접근 가능한 누구나 | 운영 DB/S3/계정 전체 탈취 | **P0** |
| 2 | CORS `origin=*` + `allowCredentials=true` | 임의 사이트 방문 | 인증 API 무단 호출·응답 탈취 | **P0** |
| 3 | Actuator 전체 노출 + `shutdown` 활성 | 관리 포트 도달 가능 | 원격 서버 종료 | **P0** |
| 4 | 단말 해제 플로우 트랜잭션 부재 | 중간 단계 실패 | 데이터 부분 삭제·정합성 붕괴 | **P0** |
| 5 | MQTT 동기 대기가 톰캣 스레드 점유 | 단말 응답 지연 다발 | 서버 전체 무응답 | **P1** |
| 6 | 상태 저장소가 인메모리(`InMemoryRedisClient`) | 인스턴스 2대 이상 / 재배포 | 소셜 로그인 실패, 알림 유실, 락 무효 | **P1** |
| 7 | 레이트리밋이 무효 경로에 등록 + LB IP 기준 | 상시 | 보호 미작동, 활성화 시 전체 차단 | **P1** |
| 8 | 미상 예외 → 400, 스택트레이스 미출력 | 장애 발생 시 | 원인 추적 불가, 5xx 알람 무력화 | **P1** |
| 9 | 보관 배치 미스케줄 | 상시 | 알림/GPS 테이블 무한 증가 | **P1** |
| 10 | Hikari 10 커넥션 vs 톰캣 200 스레드 | 트래픽 급증 | 커넥션 획득 5초 타임아웃 폭주 | P2 |
| 11 | KVS 클라이언트 요청마다 생성 | 라이브 진입 집중 | 라이브 시작 지연 | P2 |
| 12 | SSE 운영 엔드포인트 무방비 | 인증 사용자 누구나 | 전체 클라이언트 재접속 유발 | P2 |
| 13 | Swagger 운영 노출 | 상시 | 전체 API 스펙 공개 | P2 |
| 14 | 로그 보존 2일 / 중앙 수집 없음 | 사후 분석 시 | 장애 원인 소실 | P2 |
| 15 | 운영 DataSource 가 log4jdbc 경유 | 상시 | 전 쿼리 프록시 오버헤드 | P2 |
| 16 | 읽기 메서드에 `readOnly` 미지정 | 상시 | 불필요한 쓰기 트랜잭션 | P2 |
| 17 | JWT 설정 키 이름/단위 불일치 | 설정 수정 시 | 토큰 수명 1000배 오설정 | P2 |

---

## 3. P0 — 즉시 조치

### 3.1 운영 자격증명이 전부 형상관리에 평문으로 들어 있다

**현상**

`git ls-files` 로 확인되는 추적 대상 파일에 운영 자격증명이 그대로 있다.

```
vueroid-web-api/src/main/resources/application.yml
vueroid-web-api/src/main/resources/application.properties
vueroid-web-api/src/main/resources/serviceAccountKey.json
vueroid-web-api/src/main/resources/serviceAccountKey2.json
```

**근거 — 노출된 자격증명 목록**

| 종류 | 위치 | 비고 |
|---|---|---|
| 운영/스테이지/테스트 DB 계정 | `application.yml` 각 프로파일 `spring.datasource` | 전 환경 동일 비밀번호 |
| AWS Access Key / Secret | `application.yml` `aws.*`, `application.properties` `aws.access-key2~4` | 4개 리전 버킷이 동일 키 재사용 |
| JWT 서명 시크릿 | `application.yml` `jwt.secret` | 유출 시 임의 사용자 토큰 위조 가능 |
| Apple Sign-In private key | `application.yml` `apple.private-key` | PEM 전문 |
| Google OAuth client secret | `application.yml` `spring.security.oauth2...client-secret` | |
| RSA private/public key | `application.yml` `spring.security.private-key` | |
| MQTT 브로커 계정 | `application.yml` `spring.mqtt.username/password` | |
| 브로커 관리 API 계정 | `NanoMqClientService.java:25` `setBasicAuth("ncn", ...)` | 소스에 하드코딩 |
| Firebase 서비스 계정 키 | `serviceAccountKey.json`, `serviceAccountKey2.json` | private_key 포함 |

**운영에서 터지는 시나리오**

리포 접근 권한이 있는 인원(퇴사자 포함), 또는 리포가 한 번이라도 외부로 나간 이력이 있으면 그 시점부터 운영 DB 전체 조회·변조, S3 버킷 전체 접근, 임의 사용자 JWT 위조가 가능하다. 특히 JWT 시크릿은 **유출 사실을 탐지할 방법이 없다.** 위조 토큰은 정상 토큰과 구분되지 않는다.

**해결 시나리오**

1단계 — 유출 전제 대응. 키 교체가 먼저다. 코드 정리가 먼저가 아니다.

```
[ ] AWS: 노출된 Access Key 비활성화 → 신규 발급 → IAM 최소권한 정책 재작성
    (현재 키 1개가 4개 리전 버킷 + SES + KVS 전부를 커버 → 서비스별 분리)
[ ] DB: 전 환경 계정 비밀번호 교체, 환경별로 다른 비밀번호 사용
[ ] JWT: 서명키 교체 (교체 즉시 전 사용자 재로그인 발생 → 공지 후 심야 배포)
[ ] Apple / Google: 키·시크릿 재발급
[ ] Firebase: 서비스 계정 키 폐기 후 재발급
[ ] NanoMQ: 브로커 계정 비밀번호 교체
```

2단계 — 주입 방식 전환

```yaml
# application.yml — 값은 비우고 환경변수 참조만 남긴다
spring:
  datasource:
    username: ${DB_USERNAME}
    password: ${DB_PASSWORD}
jwt:
  secret: ${JWT_SECRET}
aws:
  access-key: ${AWS_ACCESS_KEY}
  secret-key: ${AWS_SECRET_KEY}
```

- EC2 배포라면 IAM Instance Profile 을 쓰면 AWS 키 자체가 필요 없어진다. `StaticCredentialsProvider` → `DefaultCredentialsProvider` 로 교체하면 코드에서 키가 사라진다 (`LiveService.java:117`, `AwsConfig.java`).
- 나머지 값은 SSM Parameter Store(SecureString) 또는 Secrets Manager 로 옮기고, 배포 스크립트가 환경변수로 주입한다.

3단계 — 재발 방지

```
[ ] .gitignore 에 application-*.yml, serviceAccountKey*.json 추가
[ ] git filter-repo 로 히스토리에서 제거 (키 교체 후에 해도 된다)
[ ] pre-commit 훅 또는 CI 에 gitleaks/trufflehog 추가 → 시크릿 패턴 검출 시 빌드 실패
```

**검증**

- 배포 산출물(jar) 안에 평문 시크릿이 없는지: `unzip -p app.jar BOOT-INF/classes/application.yml | grep -iE 'password|secret|key'`
- 구 AWS 키로 API 호출 시 `InvalidAccessKeyId` 응답 확인

---

### 3.2 CORS 가 모든 오리진에 자격증명 포함 요청을 허용한다

**현상**

```java
// SecurityConfig.java:110-121
config.setAllowCredentials(true);
config.addAllowedOriginPattern("*");
```

**근거**

`allowCredentials(true)` + `allowedOriginPattern("*")` 조합은 스프링이 요청 오리진을 그대로 `Access-Control-Allow-Origin` 에 반사(reflect)한다. 즉 **임의의 웹사이트가 브라우저에서 쿠키를 실어 이 API 를 호출하고 응답 본문까지 읽을 수 있다.**

이 서버는 리프레시 토큰을 쿠키로 다루고 있고(`cookie.secure`, `cookie.same-site` 설정 존재), test 프로파일은 `same-site: None` 이다. None 은 크로스 사이트 요청에 쿠키가 실린다는 뜻이다.

추가로 `WebMvcConfig.addCorsMappings()` 에 `localhost:3000` 만 허용하는 별도 CORS 설정이 있으나, 시큐리티 체인의 `CorsConfigurationSource` 가 우선 적용되어 **사실상 사문화된 설정이다.** 설정이 두 군데로 갈라져 있어 코드만 봐서는 어느 쪽이 적용되는지 판단이 어렵다.

**운영에서 터지는 시나리오**

사용자가 로그인 상태로 악성 페이지를 방문 → 그 페이지의 스크립트가 `credentials: 'include'` 로 `/api/devices` 등을 호출 → 단말 목록, 위치 이력, 프로필이 그대로 유출된다. `oauth2.allowed-origins` 에 화이트리스트가 이미 정의되어 있는데 CORS 설정은 그걸 쓰지 않는다.

**해결 시나리오**

```java
@Bean
public CorsConfigurationSource corsConfigurationSource(Oauth2Properties props) {
    CorsConfiguration config = new CorsConfiguration();
    config.setAllowCredentials(true);
    config.setAllowedOrigins(props.getAllowedOrigins());   // 프로파일별 화이트리스트 재사용
    config.setAllowedHeaders(List.of("Origin", "Content-Type", "Accept", "Authorization"));
    config.setAllowedMethods(List.of("GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"));
    config.setMaxAge(3600L);

    UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
    source.registerCorsConfiguration("/**", config);
    return source;
}
```

- 네이티브 앱은 CORS 대상이 아니므로 화이트리스트를 좁혀도 앱 트래픽에는 영향이 없다. **영향 범위는 웹 프론트뿐이다.**
- `WebMvcConfig.addCorsMappings()` 는 삭제해 설정 창구를 하나로 만든다.
- 함께 `@EnableWebMvc` 도 제거 대상이다. 스프링 부트에서 이 어노테이션은 WebMvc 자동설정을 통째로 끄기 때문에, 메시지 컨버터·에러 처리 기본값이 부트 표준과 달라진다.

**검증**

```bash
curl -i -H "Origin: https://evil.example.com" https://wifialb.vueroid-cloud.com/api/health
# 기대: Access-Control-Allow-Origin 헤더 없음
```

---

### 3.3 Actuator 가 전 엔드포인트 노출 + shutdown 활성 상태다

**현상**

```yaml
# application.yml
management:
  endpoint:
    shutdown:
      enabled: true
  endpoints:
    web:
      base-path: "/actuator/api"
      exposure:
        include: "*"
        exclude: "env,beans"
```

관리 포트는 프로파일별로 분리되어 있다 (prod 8090 / stage 8093 / test 8092 / dev 8091).

**근거**

- `include: "*"` 로 `heapdump`, `threaddump`, `configprops`, `loggers`, `mappings` 가 전부 열린다. `env`, `beans` 만 제외했는데 **`configprops` 는 제외되지 않았고 여기에도 설정값이 노출된다.**
- `shutdown` 이 활성화되어 있고 `POST /actuator/api/shutdown` 은 애플리케이션을 종료시킨다.
- 관리 포트를 `server.port` 와 분리하면 스프링 부트는 별도 자식 컨텍스트로 관리 서버를 띄운다. **메인 `SecurityFilterChain` 은 이 컨텍스트에 적용되지 않는다.** 즉 관리 포트에 도달만 하면 인증 없이 호출된다.
- `heapdump` 는 힙 전체를 파일로 내려주므로, 메모리에 올라온 JWT·비밀번호·개인정보가 통째로 나간다.

**운영에서 터지는 시나리오**

VPC 내부 침투나 보안그룹 오설정으로 8090 포트에 접근 가능해지는 순간, 한 번의 POST 로 운영 API 서버가 내려간다. 헬스체크 실패 → ALB 타겟 이탈 → 전면 장애.

**해결 시나리오**

```yaml
management:
  endpoint:
    shutdown:
      enabled: false          # 무중단 배포는 ALB 드레이닝으로 처리, shutdown 엔드포인트 불필요
  endpoints:
    web:
      exposure:
        include: "health,info,metrics,prometheus"   # 화이트리스트 방식으로 전환
  server:
    port: 8090
    address: 127.0.0.1        # 루프백 바인딩 → 외부에서 도달 불가
```

- 모니터링 에이전트가 원격에서 긁어야 한다면 `address` 대신 보안그룹으로 모니터링 서버 IP 만 허용한다.
- 그래도 인증을 붙이고 싶으면 관리 컨텍스트 전용 `SecurityFilterChain` 을 `EndpointRequest.toAnyEndpoint()` 매처로 별도 등록한다.

**검증**

```bash
curl -X POST http://<운영서버>:8090/actuator/api/shutdown   # 기대: 연결 거부 또는 404
curl http://<운영서버>:8090/actuator/api/heapdump           # 기대: 404
```

---

### 3.4 단말 해제가 트랜잭션 없이 9개 테이블을 순차 삭제한다

**현상**

```java
// DeviceDeleteFacade.java:43-49  — @Transactional 없음
public void delete(long uaId, String serial) {
    Device device = deviceService.findBySerial(serial);
    validation(device, uaId);
    deleteInformation(serial, uaId);
    sendSseMessage(uaId);
    sendUnregistration(serial);
}

// DeviceDeleteFacade.java:67-77
private void deleteInformation(String serial, long uaId) {
    deviceService.deleteDevice(serial);                  // 1
    deviceService.updateDeviceHistory(serial, uaId);     // 2 해제이력
    deviceAppWtService.deleteBySerial(serial);           // 3
    deviceNoticeService.deleteBySerial(serial);          // 4 단말 알림설정
    ucNotificationService.deleteBySerial(serial);        // 5 알림
    deviceMapperRepository.deleteSafeScore(serial);      // 6 안전운전점수
    udDeviceHistoryService.deleteBySerial(serial);       // 7 주행기록
    gpsService.deleteBySerial(serial);                   // 8 GPS 좌표
    dvFileMapperRepository.deleteDvFile(serial);         // 9 파일 메타
}
```

**근거**

파사드에 트랜잭션 경계가 없다. 각 서비스 메서드가 자체 `@Transactional` 을 갖고 있으므로 **단계마다 개별 커밋된다.** 5번에서 DB 타임아웃이나 락 경합으로 실패하면 1~4는 이미 커밋되어 되돌릴 수 없다.

또한 실제 S3 객체는 삭제하지 않는다. `DeviceService.deleteS3File()` 은 존재하지만 호출부가 주석 처리되어 있다 (`DeviceService.java:328`). DB 메타(9번)만 지우므로 **S3 원본은 영구 잔존한다.**

**운영에서 터지는 시나리오**

- 사용자가 단말 해제 → 5번에서 실패 → 단말은 소유자에서 떨어져 나갔는데 알림/주행기록/파일 메타는 남는다. 재등록해도 이전 데이터가 섞여 보인다.
- 개인정보 삭제 요청 대응 시 "삭제했다"고 답변할 근거가 없다. S3 원본은 남아 있고 DB 삭제도 부분 성공일 수 있다.
- 실패가 발생해도 예외는 전역 핸들러에서 400 으로 변환되어(§4.4) 클라이언트는 단순 실패로 인식하고 재시도한다. 재시도 시 1번이 이미 없으므로 다른 지점에서 또 실패한다.

**해결 시나리오**

1단계 — DB 삭제를 하나의 트랜잭션으로 묶는다

```java
@Transactional
public void deleteDeviceData(String serial, long uaId) {
    // 기존 deleteInformation 내용 그대로
}

public void delete(long uaId, String serial) {
    Device device = deviceService.findBySerial(serial);
    validation(device, uaId);
    deleteDeviceData(serial, uaId);        // 커밋 성공해야 아래로 진행
    sendSseMessage(uaId);                  // 부수효과는 커밋 이후
    sendUnregistration(serial);
}
```

2단계 — 외부 부수효과(SSE 발행, MQTT 해제 명령)는 커밋 이후로 뺀다

```java
@TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
public void onDeviceDeleted(DeviceDeletedEvent e) { ... }
```

트랜잭션 안에서 MQTT publish 를 하면 롤백돼도 단말은 이미 해제 명령을 받은 상태가 된다.

3단계 — S3 정리는 비동기 큐로 분리

동기 삭제는 파일 수에 비례해 응답이 느려지고, `DeleteObjectsRequest` 는 요청당 1000키 제한이 있어 대량 단말에서 실패한다. 삭제 대상을 별도 테이블(`pending_s3_deletion`)에 적재하고 배치가 1000개씩 나눠 처리하는 구조로 간다.

**검증**

- 5번 서비스에 강제 예외를 넣고 해제 API 호출 → 1~4 테이블에 행이 그대로 남는지 확인 (조치 후에는 롤백되어야 한다)
- 해제 후 `SELECT COUNT(*) FROM uc_noti WHERE serial = ?` 등 9개 테이블 전수 확인

---

## 4. P1 — 스케일아웃 전 필수

### 4.1 MQTT 동기 요청-응답이 톰캣 스레드를 최대 10초 점유한다

**현상**

단말 설정 조회/변경 API 는 HTTP 요청 스레드에서 MQTT 응답을 블로킹 대기한다.

```java
// DeviceConfigurationFacade.java:60-88
private <T> T sendMqttAndRecv(String mapRequestId, String serial, MqttMessage message, String topicCommand) {
    CompletableFuture<T> future = new CompletableFuture<>();
    PendingMqttRequests.register(mapRequestId, future);
    ...
    T result = future.get(10, TimeUnit.SECONDS);   // ← 최대 10초 블로킹
```

그 앞단에 브로커 관리 API 호출도 동기로 붙는다.

```java
// DeviceConfigurationFacade.java:44-49
if (!nanoMqClientService.checkDeviceConnection(serial)) { ... }
// NanoMqClientService: connectTimeout 5s + readTimeout 10s
```

**근거**

한 요청당 최악 **DB 조회 + 브로커 REST 최대 15초 + MQTT 대기 10초 = 25초** 동안 톰캣 워커 스레드 1개가 묶인다. 톰캣 최대 스레드는 설정이 없어 기본값 200이다.

**운영에서 터지는 시나리오**

전파 불량 지역 단말이 많거나 브로커가 느려지면 응답 지연이 동시다발로 발생한다.

- 200개 요청이 동시에 대기 → 톰캣 스레드 풀 고갈
- 설정 API 와 무관한 로그인·단말목록 요청까지 큐에 쌓여 **서버 전체가 무응답**
- ALB 헬스체크(`/health`)도 큐에 걸려 실패 → 인스턴스 이탈 → 남은 인스턴스로 트래픽 집중 → 연쇄 붕괴

**해결 시나리오**

1단계 — 격리. 가장 적은 변경으로 전면 장애를 막는다.

설정 API 전용 스레드 풀을 두고 `DeferredResult` 로 반환해, 대기가 톰캣 워커를 잡지 않게 한다.

```java
@GetMapping("/devices/{serial}/config")
public DeferredResult<ConfigurationDto> getConfig(...) {
    DeferredResult<ConfigurationDto> result = new DeferredResult<>(15_000L);
    deviceConfigExecutor.submit(() -> { ... result.setResult(dto); });
    return result;
}
```

전용 풀 크기를 제한(예: 32)하면 단말 지연이 아무리 심해도 **피해가 설정 API 로만 국한된다.**

2단계 — 타임아웃 예산 재설계

```
브로커 연결 확인 : connect 1s / read 2s   (현재 5s / 10s)
MQTT 응답 대기   : 5s                     (현재 10s)
합계 상한        : 7s
```

앱 클라이언트 타임아웃보다 서버 상한이 짧아야 한다. 그렇지 않으면 클라이언트가 먼저 끊고 재시도해 서버 부하만 늘어난다.

3단계 — 서킷 브레이커

브로커 확인 호출에 서킷 브레이커를 걸어, 실패율이 임계치를 넘으면 즉시 실패로 응답한다. 지금은 `checkDeviceConnection` 이 예외를 삼키고 `false` 를 반환하므로(`NanoMqClientService.java:63-67`) **브로커 장애와 단말 오프라인이 구분되지 않는다.** 두 상황을 다른 에러 코드로 나눠야 앱이 다른 안내를 띄울 수 있다.

4단계 — 스케일아웃 시 응답 오배달

`PendingMqttRequests` 는 static 맵이다. 인스턴스 A/B 가 각각 `device/+/settingInfo` 를 구독하면 단말 응답을 **양쪽 다 수신**한다. A가 보낸 명령의 응답이 B에 있던 다른 사용자의 대기 future 를 완료시킬 수 있다. 요청별 고유 id 를 페이로드에 실어 echo 받는 것이 정답이나 펌웨어 변경이 필요하다. 펌웨어 변경 전까지는 구독 토픽을 인스턴스별로 분리하거나(`device/+/settingInfo/{instanceId}`) 응답 라우팅을 Redis 로 중계하는 방식으로 우회한다.

**검증**

- 오프라인 단말 시리얼로 설정 조회를 200 동시 호출하면서 `/health` 응답시간 측정 → 조치 전에는 타임아웃, 조치 후에는 정상
- `metrics/tomcat.threads.busy` 추이 확인

---

### 4.2 세션성 상태가 인스턴스 로컬 메모리에 저장된다

**현상**

`AppRedisClient` 인터페이스의 구현체는 **`InMemoryRedisClient` 하나뿐이다.** 이름과 달리 Redis 를 쓰지 않고 `ConcurrentHashMap` 에 저장한다.

```java
// InMemoryRedisClient.java:19-21
public class InMemoryRedisClient implements AppRedisClient {
    private final ConcurrentHashMap<String, Entry> store = new ConcurrentHashMap<>();
```

**근거 — 이 저장소에 무엇이 들어가는가**

| 사용처 | 저장 내용 | 인메모리일 때 결과 |
|---|---|---|
| `GoogleOAuthService.java:129` / `AppleOAuthService.java:84` | OAuth `state` (TTL 5분) | 콜백이 다른 인스턴스로 가면 **로그인 실패** |
| `GoogleOAuthService.java:91` / `AppleOAuthService.java:177` | 신규가입 티켓 | 약관 동의 단계에서 티켓 소실 → **가입 중단** |
| `RateLimitingService.java:20` | 로그인 시도 카운트 | 인스턴스마다 별도 집계 → 제한이 N배로 느슨해짐 |
| `RedisLockService.java:15` | 배치 분산 락 | **분산 락이 아니다.** 인스턴스마다 락 획득 성공 → 배치 중복 실행 |

한편 `RedisConfig` 는 **실제 Redis** 에 `RedisMessageListenerContainer` 를 붙여 구독은 하고 있다. 즉 다른 서버(device 등)가 Redis 로 발행한 이벤트는 수신되지만, **api 서버가 스스로 발행하는 이벤트는 Redis 로 나가지 않는다.**

```java
// InMemoryRedisClient.java:26-29 — 브라우저 채널이 아니면 그냥 버린다
if (!Constants.SSE.CHANNEL_BROWSER.equals(channel)) {
    log.debug("Ignoring in-memory publish for channel={}", channel);
    return;
}
```

`AuthControllerV2.java:1027` 의 `redisClient.publish("newLogin", ...)` 은 **채널이 달라 전량 폐기된다.** 중복 로그인 감지 기능이 코드상 존재하지만 실제로는 동작하지 않는다.

**운영에서 터지는 시나리오**

- 인스턴스를 2대로 늘리는 순간 **소셜 로그인 성공률이 약 50% 로 떨어진다.** ALB 라운드로빈이므로 인가 요청과 콜백이 다른 인스턴스로 갈라진다. "가끔 로그인이 안 된다"는 재현 어려운 문의가 반복된다.
- 배포·재기동 중 로그인 시도 중이던 사용자는 전부 실패한다.
- SSE 알림도 마찬가지다. 사용자의 SSE 연결이 A에 있는데 알림이 B에서 발행되면 배지 숫자가 갱신되지 않는다.

**해결 시나리오**

1단계 — 실제 Redis 구현체 추가. 인터페이스는 이미 있으므로 구현만 붙이면 된다.

```java
@Component
@Primary
@Profile("!local")
@RequiredArgsConstructor
public class RedisAppRedisClient implements AppRedisClient {
    private final StringRedisTemplate template;

    @Override public void publish(String channel, String message) { template.convertAndSend(channel, message); }
    @Override public void set(String key, String value, Duration ttl) { template.opsForValue().set(key, value, ttl); }
    @Override public String get(String key) { return template.opsForValue().get(key); }
    @Override public String getAndDelete(String key) { return template.opsForValue().getAndDelete(key); }
    @Override public boolean setIfAbsent(String key, String value, Duration ttl) {
        return Boolean.TRUE.equals(template.opsForValue().setIfAbsent(key, value, ttl));
    }
    @Override public Long increment(String key) { return template.opsForValue().increment(key); }
    @Override public void delete(String key) { template.delete(key); }
}
```

`InMemoryRedisClient` 는 `@Profile("local")` 로 내려 로컬 개발 편의용으로만 남긴다. `StringRedisTemplate` 빈은 `RedisConfig` 에 이미 있다.

2단계 — `newLogin` 채널을 `RedisConfig` 구독 목록에 추가한다. 발행만 하고 구독이 없으면 여전히 아무 일도 일어나지 않는다.

3단계 — 레이트리밋은 원자적 연산으로 교체한다. 현재는 `get` 확인 후 `increment` 하는 비원자 패턴이라 동시 요청에서 카운트가 새어 나간다.

```java
Long count = redisClient.increment(key);
if (count == 1L) redisClient.expire(key, Duration.ofMinutes(BLOCK_TIME));
return count <= MAX_REQUEST;
```

**검증**

- 인스턴스 2대 띄우고 구글 로그인 20회 반복 → 실패 0건
- `redis-cli MONITOR` 로 `oauth:state:*` 키 생성/삭제 확인
- 배치를 2대에서 동시에 트리거 → 한쪽만 실행되는지 확인

---

### 4.3 레이트리밋이 존재하지 않는 경로에 등록되어 있다

**현상**

```java
// WebMvcConfig.java:41-45
reg.addInterceptor(passwordSearchInterceptor)
   .addPathPatterns("/web/uaUser/findId");

// PasswordSearchInterceptor.java:19-24
String ip = request.getRemoteAddr();
if ("/api/web/uaUser/findId".equals(requestURI) && !rateLimitingService.isRequestAllowed(ip)) {
    response.setStatus(HttpServletResponse.SC_FORBIDDEN);
    return false;
}
```

**근거 — 두 겹의 문제**

1. **경로가 실존하지 않는다.** 현재 아이디 찾기 엔드포인트는 `POST /users/find-id/by-device`(`UaApiController.java:127`)와 `POST /id/mdDevice/none`(`IdController.java:25`)이다. `/web/uaUser/findId` 는 구버전 경로다. 인터셉터는 등록만 되어 있고 **어떤 요청에도 걸리지 않는다.**
   - `SecurityConfig` 의 permitAll 목록에도 구 경로 `/web/uaUser/findid` 가 남아 있다. 신규 경로는 목록에 없으므로 인증이 필요한 상태다. 앱이 비로그인 상태에서 아이디 찾기를 호출한다면 지금 401을 받고 있을 가능성이 있다. **실 트래픽 로그로 확인이 필요하다.**

2. **IP 산출 방식이 LB 환경에서 무의미하다.** `getRemoteAddr()` 은 ALB 뒤에서 로드밸런서 IP 를 돌려준다. 인터셉터를 올바른 경로에 다시 붙이는 순간, 전 사용자가 하나의 카운터를 공유하게 되어 **누구든 5회만 호출하면 3분간 전체 사용자가 차단된다.** 즉 지금 상태에서 경로만 고치면 더 큰 사고가 난다.

`UserActionLogService.java:26` 은 `X-FORWARDED-FOR` 를 먼저 읽는 올바른 구현을 이미 갖고 있다. 코드베이스 안에서 방식이 갈린 상태다.

**운영에서 터지는 시나리오**

- 현재: 아이디 찾기(이메일 반환)가 무제한 호출 가능. 이름·생년월일 조합 대입으로 가입 이메일을 수집할 수 있다.
- 순진하게 경로만 고칠 경우: 단일 IP 카운터 → 서비스 전체 차단(자기 자신에 대한 DoS).

**해결 시나리오**

1단계 — 클라이언트 IP 추출을 표준화한다. 애플리케이션 코드에서 헤더를 직접 파싱하는 대신 프레임워크에 맡긴다.

```yaml
server:
  forward-headers-strategy: native   # 톰캣 RemoteIpValve 활성화
```

이러면 `getRemoteAddr()` 이 `X-Forwarded-For` 기반 실제 클라이언트 IP 를 반환한다. `UserActionLogService` 의 수동 파싱도 함께 제거할 수 있다. `internalProxies` 로 신뢰 프록시 대역을 지정해 헤더 위조를 막는다.

2단계 — 인터셉터를 실제 경로에 등록한다.

```java
reg.addInterceptor(passwordSearchInterceptor)
   .addPathPatterns("/users/find-id/**", "/id/mdDevice/**");
```

URI 문자열 비교 로직은 삭제하고 패턴 등록만으로 판정한다. 경로가 또 바뀌면 같은 사고가 반복된다.

3단계 — 정책을 다층으로 만든다.

```
IP 기준        : 분당 5회
대상 계정 기준 : 시간당 3회   ← IP 를 바꿔도 우회 불가
전역 기준      : 초당 N회 (서비스 보호용, 임계치는 평시 트래픽의 10배)
```

4단계 — 차단 발생을 지표로 남긴다. 지금은 403 만 내려주고 로그도 없어, 차단이 걸렸는지 운영자가 알 수 없다.

**검증**

```bash
for i in $(seq 1 10); do curl -s -o /dev/null -w "%{http_code}\n" -X POST .../users/find-id/by-device -d '...'; done
# 기대: 6번째부터 403, 다른 IP(모바일 네트워크)에서는 200
```

---

### 4.4 전역 예외 핸들러가 원인을 지우고 상태 코드를 왜곡한다

**현상**

```java
// ExceptionController.java:52-80
@ExceptionHandler(Exception.class)
public ResponseEntity<?> exceptionHandler(Exception e) {
    log.info("오류발생1 : {}", e.getMessage());     // ← 스택트레이스 없음, INFO 레벨
    ...
    } else {
        errorCode = 400;                            // ← 미상 예외를 전부 400 으로
    }
    return ResponseEntity.status(errorCode).build();  // ← 본문 없음
}
```

**근거**

세 가지가 동시에 잘못됐다.

1. `e.getMessage()` 만 남긴다. NPE 는 메시지가 `null` 인 경우가 흔해 **`오류발생1 : null` 한 줄만 남고 어느 코드에서 터졌는지 알 수 없다.**
2. 레벨이 INFO 다. 운영 logback 은 root/`com.ncn` 이 info 이므로 기록은 되지만, 로그 수집기에서 에러로 분류되지 않아 알람이 울리지 않는다.
3. 정체불명 예외를 400 으로 내린다. **서버 내부 오류가 클라이언트 잘못으로 둔갑한다.** ALB/CloudWatch 의 5xx 지표가 0으로 유지되어 장애가 감지되지 않는다.

`NullPointerException` 만 500 으로 분기하는데, 정작 그 NPE 도 스택트레이스가 없다.

**운영에서 터지는 시나리오**

앱에서 "가끔 400 이 온다"는 문의가 접수된다. 서버 지표는 전부 정상(5xx 0%)이다. 로그를 뒤져도 `오류발생1 : null` 뿐이고, 로그 보존은 2일(§5.5)이라 며칠 지난 건은 흔적조차 없다. **원인 규명 불가 상태로 종결된다.**

**해결 시나리오**

```java
@ExceptionHandler(Exception.class)
public ResponseEntity<ErrorBody> unhandled(Exception e, HttpServletRequest req) {
    String traceId = UUID.randomUUID().toString().substring(0, 8);
    log.error("[{}] 처리되지 않은 예외 - {} {}", traceId, req.getMethod(), req.getRequestURI(), e);
    return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
            .body(new ErrorBody(500, "일시적인 오류가 발생했습니다. (code: " + traceId + ")"));
}
```

- **기본값을 500 으로 되돌린다.** 400 이 맞는 케이스(`MethodArgumentNotValidException`, `HttpMessageNotReadableException` 등)는 개별 핸들러로 명시한다.
- 스택트레이스를 반드시 남긴다 (`log.error(msg, args..., e)`).
- traceId 를 응답과 로그에 함께 넣으면 사용자 문의 → 로그 검색이 한 번에 된다. 내부 예외 메시지는 응답에 노출하지 않는다.
- MDC 에 requestId/uaId 를 심어 로그 패턴에 포함시키면 사용자 단위 추적이 가능해진다.

**전환 시 주의**

400 → 500 으로 바뀌면 **기존에 숨어 있던 서버 오류가 5xx 지표로 한꺼번에 드러난다.** 이건 정상이다. 다만 배포 직후 알람이 폭주할 수 있으므로, 먼저 로깅만 개선해 실제 예외 분포를 1주일 수집한 뒤 상태 코드를 바꾸는 2단계 진행을 권한다.

**검증**

- 임의 500 유발 후 로그에 스택트레이스와 traceId 존재 확인
- CloudWatch 5xx 지표가 실제 오류율과 일치하는지 확인

---

### 4.5 데이터 보관 배치가 등록만 되어 있고 실행되지 않는다

**현상**

```java
// PrivateInfoProtectJob.java:20
//    @Scheduled(cron = "0 0 3 * * *") // 매일 새벽 3시
    public void run() { ... }
```

- 프로젝트 전체에 `@EnableScheduling` 이 **없다.** 주석을 풀어도 동작하지 않는다.
- `AlarmBatchService`(1개월 지난 알림 읽음 처리 / 3개월 지난 알림 삭제)는 **호출부가 존재하지 않는다.** 스케줄러도, 컨트롤러도 없다.

**근거**

배치 구현 자체는 잘 되어 있다. `FOR UPDATE SKIP LOCKED` + 10,000건 청크 커밋 + 루프마다 슬립으로 락 경합을 피하는 형태다(`AlarmBatchService.java:22-50`). 실행만 안 될 뿐이다.

**운영에서 터지는 시나리오**

- `uc_noti` 는 단말 이벤트마다 행이 쌓인다. 삭제가 없으면 무한 증가한다. 알림 목록 조회와 미읽음 카운트가 점점 느려지고, 인덱스가 메모리를 벗어나는 시점부터 응답시간이 급격히 나빠진다.
- GPS/ADAS 이력은 개인정보다. 보관기간 정책(5년)이 코드에 있는데 실행되지 않으므로 **정책 미이행 상태가 누적된다.** 개인정보 관련 감사에서 지적 대상이다.
- 문제가 조용히 누적되다가 디스크나 쿼리 성능 임계점에서 한꺼번에 터진다.

**해결 시나리오**

1단계 — 현재 규모 파악이 먼저다. 몇 년치가 쌓였는지 모르는 상태에서 배치를 켜면 첫 실행이 수 시간 걸리며 DB 를 마비시킬 수 있다.

```sql
SELECT COUNT(*), MIN(created_dtm) FROM uc_noti;
SELECT COUNT(*) FROM uc_noti WHERE created_dtm < NOW() - INTERVAL '3 months';
SELECT pg_size_pretty(pg_total_relation_size('uc_noti'));
```

2단계 — 초회 정리는 배치가 아니라 수동 작업으로 한다. 트래픽이 적은 시간대에 청크 단위로 나눠 실행하고 진행 상황을 확인하며 진행한다.

3단계 — 스케줄링을 활성화한다.

```java
@Configuration
@EnableScheduling
public class SchedulingConfig {
    @Bean
    public TaskScheduler taskScheduler() {
        ThreadPoolTaskScheduler s = new ThreadPoolTaskScheduler();
        s.setPoolSize(2);
        s.setThreadNamePrefix("batch-");
        s.setWaitForTasksToCompleteOnShutdown(true);
        return s;
    }
}
```

`PrivateInfoProtectJob` 의 `@Scheduled` 주석을 풀고, `AlarmBatchService` 에도 동일하게 잡을 만든다.

4단계 — **분산 락을 실제 Redis 로 바꾼 뒤에 켠다**(§4.2). 지금 상태로 인스턴스 2대에서 스케줄러를 켜면 배치가 중복 실행된다.

5단계 — 실행 결과를 남긴다. 처리 건수·소요시간을 로그와 메트릭으로 기록해야 "돌고 있는지" 확인 가능하다. 지금처럼 조용히 안 도는 상태가 재발하지 않으려면 **배치 미실행 자체를 알람 조건으로 만들어야 한다**(24시간 내 실행 기록 없음 → 알람).

**검증**

- 배치 실행 후 `SELECT COUNT(*) FROM uc_noti WHERE created_dtm < NOW() - INTERVAL '3 months' AND read_fl <> 'D'` 가 0
- 테이블 크기 추이가 우상향에서 평탄화로 전환되는지 주간 모니터링

---

## 5. P2 — 성능·운영 개선

### 5.1 DB 커넥션 예산이 스레드 수와 맞지 않는다

```yaml
spring.datasource.hikari:
  maximum-pool-size: 10        # prod 는 이 기본값을 그대로 사용 (test 만 20으로 override)
  connection-timeout: 5000
```

톰캣 200 스레드가 커넥션 10개를 두고 경쟁한다. 정상 부하에서는 쿼리가 짧아 문제없지만, 느린 쿼리 하나가 커넥션을 오래 잡으면 나머지 요청이 5초 만에 `SQLTransientConnectionException` 으로 실패한다. **일부 지연이 전면 에러로 증폭되는 구조다.**

조치 방향:
- 실제 동시 쿼리 수를 `hikaricp.connections.active` 메트릭으로 먼저 측정한다. 무작정 늘리면 PostgreSQL `max_connections` 를 압박한다.
- 인스턴스 수 × 풀 크기 < DB `max_connections` × 0.8 을 지킨다.
- 느린 쿼리를 먼저 잡는 편이 풀 확대보다 효과적이다. `log_min_duration_statement` 로 1초 이상 쿼리를 수집한다.
- 커넥션 획득 실패는 별도 알람 대상으로 지정한다.

### 5.2 KVS 클라이언트를 요청마다 새로 만든다

```java
// LiveService.java:66-100
try (KinesisVideoClient kvsClient = buildKinesisVideoClient()) {
    String arn = getArn(kvsClient, serial);                            // AWS 호출 1
    GetSignalingChannelEndpointResponse ep = getSignalingEndPoint(...); // 2
    try (KinesisVideoSignalingClient sig = buildKinesisVideoSignalingClient(...)) {
        ... sig.getIceServerConfig(...)                                 // 3
```

AWS SDK 클라이언트 생성은 HTTP 클라이언트와 커넥션 풀을 새로 만드는 무거운 작업이다. 라이브 진입 한 번마다 클라이언트 2개 생성 + AWS 왕복 3회가 서블릿 스레드에서 순차 실행된다. SDK 타임아웃 설정도 없어 기본값(재시도 3회 포함 수십 초)을 따른다.

조치 방향:
- `KinesisVideoClient` 는 스레드 세이프하므로 싱글턴 빈으로 승격한다. 시그널링 클라이언트는 엔드포인트가 채널마다 달라 캐시 키를 엔드포인트로 두고 재사용한다.
- `ClientOverrideConfiguration` 으로 `apiCallTimeout`, `apiCallAttemptTimeout` 을 명시한다.
- ARN·엔드포인트는 채널당 거의 불변이므로 단말 시리얼 기준 캐시(TTL 수 분)를 두면 AWS 호출 3회가 1회 이하로 준다.
- 자격증명은 `DefaultCredentialsProvider` 로 바꿔 §3.1 과 함께 해결한다.

### 5.3 SSE 운영 엔드포인트가 인증만 통과하면 열린다

```java
// SSEController.java:51-62
@PostMapping("/shutdown")   // 전체 클라이언트에 reconnect 이벤트 발행
@GetMapping("/list")        // 접속 중인 전체 emitter 맵 반환
```

`/sse/**` 는 `anyRequest().authenticated()` 에만 걸린다. 즉 **일반 사용자 토큰으로도 호출된다.**

- `/sse/shutdown` 은 접속 중인 모든 클라이언트에 재접속을 지시한다. 반복 호출하면 전체 클라이언트가 동시에 재연결을 시도하는 thundering herd 를 유발할 수 있다.
- `/sse/list` 는 접속 중인 전체 사용자 ID 목록을 노출한다. 게다가 `SseEmitter` 객체 자체를 직렬화하려 하므로 정상 응답도 기대하기 어렵다.

조치 방향: 두 엔드포인트에 `@PreAuthorize("hasRole('ADMIN')")` 을 걸거나, 운영 도구로 분리해 관리 포트로 옮긴다. `/sse/list` 는 개수·키 목록만 반환하도록 축소한다.

### 5.4 Swagger 가 시큐리티를 우회해 노출된다

```java
// SecurityConfig.java:50-58
return web -> web.ignoring().requestMatchers("/swagger-ui/**", "/v3/api-docs/**", ...);
```

`web.ignoring()` 은 시큐리티 필터 체인 자체를 건너뛴다. `swagger.server-url` 이 `https://wifialb.vueroid-cloud.com/api` 로 잡혀 있어 **운영 도메인 API 스펙 전체가 공개 상태다.** 전 엔드포인트 경로·파라미터·DTO 구조가 그대로 드러나며, Swagger UI 에서 바로 호출도 가능하다.

조치 방향: prod/stage 프로파일에서 springdoc 을 비활성화한다.

```yaml
springdoc:
  api-docs:
    enabled: false     # prod, stage 블록에 추가
  swagger-ui:
    enabled: false
```

내부에서 필요하면 관리 포트나 사내망 전용 경로로 옮긴다.

### 5.5 로그 보존이 2일이고 중앙 수집이 없다

```xml
<!-- logback_prod.xml -->
<maxFileSize>50MB</maxFileSize>
<totalSizeCap>500MB</totalSizeCap>
<maxHistory>2</maxHistory>
```

로컬 디스크에만 2일 보관한다. 인스턴스가 교체되면 그 즉시 소실된다. §4.4 의 스택트레이스 부재와 겹치면 **사후 분석이 사실상 불가능하다.**

조치 방향:
- CloudWatch Logs 또는 로그 수집 에이전트로 중앙 적재하고 보존기간을 30~90일로 잡는다.
- 로그 포맷을 JSON 으로 바꾸면 traceId·uaId·URI 로 검색이 가능해진다.
- 액세스 로그는 prod 에만 설정되어 있다(`server.tomcat.access-log`). 스테이지에도 동일하게 켜서 배포 전 검증에 쓴다.

### 5.6 운영 DataSource 가 log4jdbc 프록시를 경유한다

```yaml
spring.datasource.driver-class-name: net.sf.log4jdbc.sql.jdbcapi.DriverSpy   # 전 프로파일 동일
```

`jdbc.*` 로거를 off/error 로 낮춰 두었지만, 드라이버 프록시는 **모든 Connection/Statement/ResultSet 호출을 래핑한다.** 로그를 안 남겨도 래핑 비용은 발생하고, ResultSet 을 많이 순회하는 통계 쿼리에서 특히 불리하다.

조치 방향: prod 프로파일만 순수 드라이버로 되돌린다.

```yaml
# prod
spring:
  datasource:
    driver-class-name: org.postgresql.Driver
    url: jdbc:postgresql://HOST-A:5432/d21?ApplicationName=ncnApi   # jdbc:log4jdbc: 접두어 제거
```

쿼리 추적이 필요하면 PostgreSQL `auto_explain` / `pg_stat_statements` 를 쓴다. 애플리케이션 부하 없이 더 정확하다.

### 5.7 조회 메서드에 `readOnly` 가 없다

`DeviceService.findAllByUaId`, `findAll`, `findBySerial` 등 순수 조회 메서드에 `@Transactional` 만 붙어 있다(`DeviceService.java:161-190`). 읽기 전용 힌트가 없으면 Hibernate 가 더티 체킹용 스냅샷을 유지하고 flush 를 수행한다.

조치 방향: 조회 메서드는 `@Transactional(readOnly = true)` 로 통일한다. 클래스 레벨에 `readOnly = true` 를 두고 쓰기 메서드에만 재정의하는 방식이 실수를 줄인다. `LiveService` 는 이미 그 패턴을 쓰고 있다.

### 5.8 JWT 설정 키 이름과 실제 단위가 다르다

```yaml
jwt:
  token-validity-in-seconds: 120000          # 이름은 seconds
  refresh-token-validity-in-seconds: 2592000000
```

```java
// TokenProvider.java:37-38
@Value("${jwt.token-validity-in-seconds}") long tokenValidityInMilliseconds
...
Date validity = new Date(now + this.tokenValidityInMilliseconds);   // ms 로 사용
```

**설정 키는 초, 코드는 밀리초로 읽는다.** 현재 액세스 토큰 유효기간은 120,000ms = **2분**, 리프레시 토큰은 2,592,000,000ms = **30일**이다.

값 자체는 합리적이지만, 누군가 키 이름을 믿고 "2분은 너무 짧다"며 값을 조정하면 의도의 1000배가 된다. 반대로 "이름대로 초 단위로 고치자"며 코드를 바꾸면 액세스 토큰이 33시간짜리가 되어 탈취 위험이 급증한다.

조치 방향: 키 이름을 바꾸고 `Duration` 타입으로 받는다.

```yaml
jwt:
  access-token-validity: 2m
  refresh-token-validity: 30d
```

```java
public TokenProvider(@Value("${jwt.access-token-validity}") Duration accessTokenValidity, ...)
```

단위가 값에 붙어 있으면 오해할 여지가 없어진다.

---

## 6. 조치 순서

성격이 다른 작업을 섞지 않고, **되돌리기 쉬운 것 → 어려운 것** 순으로 배치했다.

| 단계 | 기간 | 항목 | 배포 리스크 |
|---|---|---|---|
| 0 | 즉시 | 자격증명 전량 교체 (§3.1 1단계) | 없음 (인프라 작업) |
| 1 | 1주 | CORS 화이트리스트(§3.2), Actuator 차단(§3.3), Swagger 비활성(§5.4) | 낮음 — 설정 변경, 롤백 즉시 가능 |
| 2 | 1주 | 예외 핸들러 로깅 개선(§4.4 1단계), 로그 중앙 수집(§5.5) | 낮음 — 관측만 개선. **이후 단계의 검증 수단이므로 먼저 한다** |
| 3 | 2주 | 시크릿 외부 주입 전환(§3.1 2단계), 단말 해제 트랜잭션(§3.4) | 중간 — 기능 회귀 테스트 필요 |
| 4 | 2주 | Redis 구현체 전환(§4.2), 레이트리밋 정상화(§4.3) | 중간 — 로그인 경로 영향, 카나리 배포 권장 |
| 5 | 2주 | MQTT 비동기화·타임아웃 예산(§4.1) | 높음 — 단말 연동 회귀 테스트 필수 |
| 6 | 2주 | 보관 배치 활성화(§4.5) | 높음 — 초회 정리는 수동, DB 부하 모니터링 |
| 7 | 상시 | 커넥션 풀 튜닝(§5.1), KVS 캐싱(§5.2), 드라이버 정리(§5.6), readOnly(§5.7), JWT 키 정리(§5.8) | 낮음 |

**2단계를 1단계 직후에 두는 이유**: 이후 모든 변경의 효과를 측정하려면 관측이 먼저 서 있어야 한다. 5xx 지표가 왜곡된 상태(§4.4)에서는 어떤 조치가 효과가 있었는지 판단할 수 없다.

---

## 7. 검증 체크리스트

```
[ ] 배포 jar 안에 평문 시크릿 없음
[ ] 임의 Origin 으로 CORS 프리플라이트 거부됨
[ ] 관리 포트 외부 도달 불가, shutdown 404
[ ] 운영 도메인 /swagger-ui.html 404
[ ] 단말 해제 중간 실패 시 전 테이블 롤백
[ ] 오프라인 단말 설정조회 200 동시 호출 중에도 /health 200 유지
[ ] 인스턴스 2대에서 소셜 로그인 20회 전건 성공
[ ] 아이디 찾기 6회째 차단, 다른 IP 는 정상
[ ] 500 발생 시 로그에 스택트레이스 + traceId 존재
[ ] 배치 실행 후 3개월 초과 알림 0건, 실행 기록 메트릭 존재
[ ] hikaricp.connections.pending 이 평시 0 유지
```

---

## 8. 경력기술서용 요약

각 항목은 `상황 - 원인 - 조치 - 결과` 형태로 서술할 수 있도록 정리했다. **결과 수치는 조치 후 실제 측정값으로 채워야 한다.**

**1) 단일 장애점 제거 — 외부 연동 블로킹 구조 개선**
> 단말 설정 API 가 MQTT 응답을 요청 스레드에서 최대 10초 동기 대기하고 브로커 REST 호출까지 직렬로 붙어, 단말 응답 지연이 톰캣 스레드 풀 고갈과 서버 전면 무응답으로 확산되는 구조를 확인. 전용 스레드 풀 격리 + `DeferredResult` 비동기 전환 + 타임아웃 예산 재설계(25초 → 7초) + 서킷 브레이커를 적용해 외부 의존 지연의 영향 범위를 해당 API 로 국한.

**2) 스케일아웃 차단 요인 규명 및 상태 저장소 분리**
> 인스턴스 증설이 어려운 원인을 추적해, OAuth state·레이트리밋·분산 락이 Redis 인터페이스로 추상화되어 있으나 실제 구현체는 인스턴스 로컬 `ConcurrentHashMap` 하나뿐임을 확인. 2대 이상 구성 시 소셜 로그인 실패, SSE 알림 유실, 배치 중복 실행이 발생하는 경로를 특정하고 Redis 구현체로 전환해 수평 확장 가능한 구조로 개선.

**3) 데이터 정합성 결함 수정**
> 단말 해제 플로우가 9개 테이블을 트랜잭션 경계 없이 순차 삭제해, 중간 실패 시 부분 삭제 상태로 남는 문제를 발견. 단일 트랜잭션으로 묶고 MQTT/SSE 등 외부 부수효과를 `AFTER_COMMIT` 이벤트로 분리, S3 정리는 재시도 가능한 비동기 큐로 전환.

**4) 장애 대응 체계 구축 — 관측 가능성 확보**
> 전역 예외 핸들러가 미상 예외를 400 으로 변환하고 스택트레이스 없이 INFO 로 기록해, 서버 오류가 5xx 지표에 잡히지 않고 원인 추적도 불가능한 상태를 확인. 상태 코드 정상화, 스택트레이스 로깅, traceId 기반 요청 추적, 로그 중앙 수집(보존 2일 → 90일)을 도입해 장애 원인 규명 경로를 확보.

**5) 보안 취약점 진단 및 개선**
> 운영 자격증명 전량 형상관리 커밋, CORS 와일드카드 + 자격증명 허용, Actuator `shutdown`·`heapdump` 무인증 노출, 운영 Swagger 공개, 무력화된 레이트리밋 등 취약점을 진단. 키 전량 교체 및 외부 주입 전환, 오리진 화이트리스트, 관리 포트 루프백 바인딩, 프록시 환경에 맞는 클라이언트 IP 추출(`forward-headers-strategy`) 적용.

**6) 데이터 수명주기 관리 정상화**
> 알림·GPS 이력 보관 배치가 구현되어 있으나 `@EnableScheduling` 부재로 한 번도 실행되지 않아 데이터가 무한 증가하고 개인정보 보관기간 정책이 미이행 상태임을 확인. 현행 데이터 규모 측정 → 초회 수동 정리 → 분산 락 기반 스케줄링 활성화 → 미실행 감지 알람까지 운영 체계로 구성.

---

## 9. 관련 문서

| 문서 | 내용 |
|---|---|
| `docs/api-todo.md` | `md_device.region_cd` 값 의미 불일치 및 수정 수단 부재 |
| `docs/device-webhook-offline-miss.md` | device 서버 웹훅 유실 (브로커 설정 원인) |
| `docs/eventstream-deploy-slowdown.md` | eventstream 배포 지연 (대상 서버 CPU 포화) |
