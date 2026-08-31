# eventstream 서버 운영 리스크 분석 및 해결 시나리오

- **작성일**: 2026-08-31
- **대상**: `vueroid-web-eventstream` (Spring Boot 3.4.3 / Java 21 / Netty / FlatBuffers / JavaCV·FFmpeg / S3)
- **상태**: 분석 완료, 조치 미착수

---

## 1. 요약

단말이 이벤트 영상을 **실시간 스트리밍으로 올리는** 서버다. HTTP 가 아니라 Netty TCP 위에서 FlatBuffers 프레임을 받아, 그 자리에서 MP4 로 먹싱하고 S3 에 올린다.

```
단말 → TCP(8010) → Netty
  ① SessionHeader  : 시리얼 + 미디어 정보 → 인증, MuxingSession 생성
  ② FramePacket ×N : 비디오/오디오/데이터 프레임 → 큐 적재 → 워커가 먹싱
  ③ EndOfStream    : 종료 → 리먹스 → 최종 MP4 조립 → 썸네일 생성 → S3 업로드 → DB 기록
```

`MuxingSession` 1,707줄이 사실상 이 서버의 전부다. **리포에서 유일하게 테스트 코드가 있는 프로젝트**이고(3개 파일), 프레임 스냅샷 복사·워커 세마포어·유휴 타임아웃 등 **동시성 설계를 의식하고 만든 흔적이 뚜렷하다.** 다른 프로젝트보다 구현 수준이 높다.

그럼에도 운영 관점에서는 위험이 크다. 이유는 코드 품질이 아니라 **한계값이 하드코딩되어 있고, 그 한계에 닿았을 때 어떤 일이 벌어지는지 알 수단이 없다**는 데 있다.

| 갈래 | 핵심 문제 |
|---|---|
| 관측 불가 | HTTP 스타터가 없어 **헬스 엔드포인트도 메트릭도 없다.** 이미 CPU 포화 원인을 특정하지 못한 이력이 있다 |
| 동시성 한계 | 동시 먹싱이 상수 4로 고정되어 있고, 대기하는 세션의 큐는 **무제한**이다 |
| 외부 프로세스 | ffmpeg 을 타임아웃 없이 기다린다. 4개가 멈추면 서비스 전체가 멈춘다 |
| 인증·전송 | 인증이 "시리얼이 DB에 있는가" 확인뿐이고, 전송 구간이 평문 TCP 다 |

**이 서버는 이미 한 번 사고 문서가 작성된 대상이다**(`docs/eventstream-deploy-slowdown.md`). 그 문서는 "CPU 포화는 확인했으나 **점유 주체는 확정하지 못했다**"로 끝난다. 이 문서 §4.3 이 그 미해결 질문에 대한 유력한 후보를 제시한다.

---

## 2. 위험도 요약

| # | 항목 | 터지는 조건 | 영향 | 우선순위 |
|---|---|---|---|---|
| 1 | 관측 수단 전무 (헬스·메트릭 없음) | 상시 | 장애 감지·원인 규명 불가 | **P0** |
| 2 | 인증이 시리얼 존재 확인뿐 + 평문 TCP | 상시 | 임의 단말 영상 위조, 전송 구간 노출 | **P0** |
| 3 | prod DB 가 dev DB, `application_name` 도 media 와 중복 | prod 배포 시 | 데이터 분리 실패 + 진단 혼선 | **P0** |
| 4 | 자격증명 형상관리 커밋 | 리포 접근 가능한 누구나 | 버킷·DB 접근 | **P0** |
| 5 | ffmpeg `waitFor()` 타임아웃 없음 + 퍼밋 4개 | ffmpeg 무응답 | **서비스 전체 정지** | **P1** |
| 6 | 동시 먹싱 4 고정 + 무제한 큐 | 동시 업로드 5건 이상 | 힙 증가 → OOM | **P1** |
| 7 | 후처리가 제한 없는 가상 스레드 | 세션 동시 종료 | 캐리어 스레드 고갈, CPU 포화 | **P1** |
| 8 | 이벤트 루프에서 JDBC·FFmpeg 초기화 | 재접속 폭주 | 전체 연결 처리 정지 | **P1** |
| 9 | 작업 디렉터리 정리가 정상 경로에만 존재 | 처리 실패 시 | 디스크 누수 | **P1** |
| 10 | 미등록 단말이 인증 통과 후 NPE | `ua_id IS NULL` 단말 | 업로드 전량 폐기 | **P1** |
| 11 | `messageCount` 지표가 항상 0 | 상시 | 유일한 세션 진단값이 무의미 | P2 |
| 12 | 로그 한 줄에 20개 이상 필드 | 상시 | 검색·집계 불가 | P2 |
| 13 | 무중단 배포 부재 | 배포 시마다 | 진행 중 업로드 유실 | P2 |
| 14 | log4jdbc 경유 | 상시 | 쿼리 오버헤드 | P2 |

---

## 3. P0 — 즉시 조치

### 3.1 이 서버에는 관측 수단이 없다

**현상**

`build.gradle` 의존성 목록에 **`spring-boot-starter-web` 이 없다.**

```gradle
implementation 'org.springframework.boot:spring-boot-starter'          // web 아님
implementation 'org.springframework.boot:spring-boot-starter-data-jpa'
implementation 'io.netty:netty-all:4.2.5.Final'
```

`actuator` 도 `micrometer` 도 없다. 다른 네 프로젝트에는 모두 있다.

**근거**

내장 웹 서버가 뜨지 않으므로 `application.yml` 의 다음 설정은 **전부 동작하지 않는다.**

```yaml
server:
  port: 6010                    # 열리지 않는다
  tomcat:
    access-log:                 # 톰캣이 없다
      enabled: true
spring:
  h2:
    console:
      enabled: true             # local 프로파일 — 뜨지 않는다
      path: /h2-console
```

결과적으로 이 서버는 다음을 **전혀 할 수 없다.**

| 필요한 것 | 현재 상태 |
|---|---|
| ALB/모니터링의 헬스체크 | 응답할 엔드포인트가 없음 |
| CPU·힙·GC 지표 수집 | 노출 수단 없음 |
| 스레드 덤프 | 원격 수집 불가 |
| 진행 중 세션 수·큐 적재량 | 코드에 카운터는 있으나 밖으로 나가지 않음 |

**운영에서 터지는 시나리오**

`docs/eventstream-deploy-slowdown.md` 가 정확히 이 문제의 결과물이다. 그 문서는 CPU 포화를 확인했지만 **누가 CPU 를 쓰는지 확정하지 못한 채 종료된다.** 조사 초기에는 에이징 테스트 부하로 판단했다가, 접속 단말이 없다는 사실이 나오면서 재검증이 필요해졌다.

지표가 있었다면 "진행 중 먹싱 세션 3개, 후처리 가상 스레드 40개, ffmpeg 프로세스 12개" 같은 형태로 **몇 분 안에 답이 나올 질문이었다.**

프로세스가 살아 있지만 먹싱이 전부 멈춘 상태(§4.1)도 밖에서는 정상으로 보인다. 헬스체크가 없으므로 ALB 는 인스턴스를 교체하지 않는다.

**해결 시나리오**

1단계 — actuator 를 붙인다. **다른 어떤 조치보다 먼저다.** 이후 모든 개선의 효과를 이것으로 측정한다.

```gradle
implementation 'org.springframework.boot:spring-boot-starter-web'
implementation 'org.springframework.boot:spring-boot-starter-actuator'
implementation 'io.micrometer:micrometer-registry-prometheus'
```

```yaml
management:
  server:
    port: 6090
    address: 127.0.0.1
  endpoints:
    web:
      exposure:
        include: "health,info,metrics,prometheus,threaddump"
```

**웹 스타터를 추가하면 톰캣이 뜬다.** Netty 와 포트가 겹치지 않게 확인하고, 관리 포트는 루프백에 묶는다.

2단계 — 이 서버 고유의 지표를 노출한다. **일반 JVM 지표만으로는 부족하다.** 무엇을 봐야 하는지는 코드가 이미 알려준다. `MuxingSession` 에 카운터가 20개 넘게 있다.

```java
Gauge.builder("eventstream.sessions.active", MuxingSession::activeCount).register(registry);
Gauge.builder("eventstream.mux.permits.available", MUX_PERMITS::availablePermits).register(registry);
Gauge.builder("eventstream.queue.depth.total", ...).register(registry);       // §4.2 의 조기 경보
Counter  eventstream.ffmpeg.remux.failures
Timer    eventstream.ffmpeg.remux.duration                                     // §4.1 의 조기 경보
Gauge    eventstream.postprocess.inflight                                      // §4.3 의 조기 경보
```

**퍼밋 가용량이 0에 오래 머무르는 것, 큐 깊이가 우상향하는 것 — 이 둘이 이 서버의 핵심 선행 지표다.**

3단계 — 헬스체크를 실질적으로 만든다. 프로세스 생존만으로는 의미가 없다.

```java
@Component
public class MuxHealthIndicator implements HealthIndicator {
    @Override public Health health() {
        // 퍼밋이 오래 0이고 큐가 계속 쌓이면 살아 있어도 일을 못 하는 상태다
        if (MUX_PERMITS.availablePermits() == 0 && stalledFor(Duration.ofMinutes(5))) {
            return Health.down().withDetail("reason", "mux stalled").build();
        }
        return Health.up().build();
    }
}
```

**검증**

- `/actuator/health` 응답 확인, ALB 타겟그룹 헬스체크 연결
- 부하 시험 중 퍼밋 가용량·큐 깊이가 지표로 관측되는지

---

### 3.2 인증이 존재 확인뿐이고 전송 구간이 평문이다

**현상**

```java
// RepositoryDeviceAuthenticator.java:13-18
@Override
public boolean isValid(String serial) {
    return deviceRepository.findBySerial(serial)
            .filter(device -> device.getDeviceStatusCd() != DeviceStatus.DEL)
            .isPresent();
}
```

```java
// FlatBufferHandler.java:81-96
String serial = header.serial();                    // 클라이언트가 보낸 값
boolean isValid = deviceAuthenticator.isValid(serial);
if (isValid) {
    ctx.channel().attr(AUTH_KEY).set(true);         // 인증 완료로 표시
```

**근거**

클래스 이름은 `DeviceAuthenticator` 지만 하는 일은 **"이 시리얼이 DB에 있고 삭제 상태가 아닌가"** 확인이다. 자격증명이 없다. 시리얼은 단말 라벨에 인쇄된 값이므로 비밀이 아니다.

전송 구간도 보호되지 않는다. `NettyServer.configurePipeline` 에 `SslHandler` 가 없다.

```java
// NettyServer.java:83-90 — 평문 TCP
pipeline.addLast(new LengthFieldBasedFrameDecoder(4 * 1024 * 1024, 0, 4, 0, 4));
pipeline.addLast(new LengthFieldPrepender(4));
pipeline.addLast(new IdleStateHandler(readIdleTimeoutSeconds, 0, 0));
pipeline.addLast(flatBufferHandler);
```

**운영에서 터지는 시나리오**

- **영상 위조**: 임의 클라이언트가 남의 시리얼로 접속해 조작된 영상을 올리면, 그 영상이 해당 사용자의 이벤트 영상으로 저장된다(`dv_file` 에 `ua_id` 기준으로 기록된다). 사고 영상이 증거로 쓰이는 서비스에서 **저장된 영상의 진위를 보증할 수 없다는 것은 서비스 신뢰의 근간을 흔든다.**
- **도청**: 주행 영상이 평문으로 인터넷을 지난다. 중간 경로에서 관찰 가능하다.
- **스토리지 비용 공격**: 인증 비용이 없으므로 대량 접속으로 S3 에 쓰레기 영상을 쌓을 수 있다.

**해결 시나리오**

이 문제는 device 서버 §3.1 과 뿌리가 같다. **단말 인증 체계가 서비스 전체에 없다.** 따라서 개별 대응이 아니라 공통 과제로 잡아야 한다.

1단계 — 전송 구간 암호화를 먼저 한다. 인증 체계보다 도입이 쉽고 효과가 즉시 나온다.

```java
SslContext sslContext = SslContextBuilder.forServer(certChainFile, keyFile).build();
pipeline.addFirst(sslContext.newHandler(ch.alloc()));
```

단말 펌웨어가 TLS 를 지원하는지가 관건이다. **지원하지 않으면 펌웨어 로드맵에 올려야 하며, 그 전까지는 망 수준 통제(보안그룹으로 접속 대역 제한)가 유일한 완화책이다.**

2단계 — mTLS 로 인증까지 해결한다. TLS 를 도입한다면 클라이언트 인증서를 같이 쓰는 것이 자연스럽다. 인증서의 CN 과 `SessionHeader.serial` 이 일치하는지 확인하면 **위조가 원천 차단된다.**

```java
String certSerial = extractCnFromClientCert(ctx);
if (!certSerial.equals(header.serial())) {
    ctx.close();
    return;
}
```

3단계 — 펌웨어 변경 전까지의 완화책.

```
[ ] 8010 포트를 단말 트래픽이 오는 대역으로만 개방
[ ] 시리얼당 동시 세션 수 제한 (정상 단말은 1개면 충분)
[ ] 시리얼당 시간당 업로드 용량 상한 → 초과 시 차단 + 알람
[ ] 존재하지 않는 시리얼로의 접속 시도를 지표화 (탐색 행위 감지)
```

**3단계는 코드 변경만으로 지금 할 수 있고, 위조가 실제로 일어나고 있는지 확인할 수단이 된다.** 인증 체계 도입 전에 먼저 넣는 편이 낫다.

---

### 3.3 prod 프로파일이 dev DB 를 보고, 이름표까지 media 서버와 겹친다

**현상**

```yaml
# stage
url: jdbc:log4jdbc:postgresql://HOST-B:5432/vwc_dev?ApplicationName=ncnMediaStage
# prod
url: jdbc:log4jdbc:postgresql://HOST-B:5432/vwc_dev?ApplicationName=ncnMedia
```

**근거**

DB 가 `vwc_dev` 인 것은 device·media 서버와 같은 문제다. 그런데 여기는 하나가 더 있다. **`ApplicationName` 이 `ncnMedia` 로, media 서버 prod 와 완전히 동일하다.** media 서버 yml 에서 그대로 복사하면서 DB 도 이름표도 바꾸지 않았다.

이것이 특히 나쁜 이유는, **접속 대상을 확인하는 진단 수단 자체를 망가뜨리기 때문이다.**

```sql
-- 다른 문서에서 제안한 진단 쿼리
SELECT datname, application_name, client_addr, count(*)
FROM pg_stat_activity
WHERE application_name IN ('ncnApi','ncnMedia','deviceApi','deviceRegProd')
GROUP BY 1,2,3;
```

이 쿼리에서 `ncnMedia` 행은 **media 서버와 eventstream 서버가 섞여 나온다.** `client_addr` 로만 구분해야 하는데, 그러려면 각 인스턴스의 IP 를 미리 알아야 한다.

다섯 프로젝트의 prod DB 를 모두 모으면 이렇게 된다.

| 서버 | prod 접속 대상 | ApplicationName |
|---|---|---|
| `vueroid-web-api` | `HOST-A/d21` | `ncnApi` |
| `vueroid-web-api-device` | `HOST-B/vwc_dev` | `deviceApi` |
| `vueroid-web-api-media` | `HOST-B/vwc_dev` | `ncnMedia` |
| `vueroid-web-devicereg` | `HOST-B/vwc_prod` | `deviceRegProd` |
| `vueroid-web-eventstream` | `HOST-B/vwc_dev` | **`ncnMedia`** ← 중복 |

**해결 시나리오**

1단계 — `ApplicationName` 부터 고친다. 한 글자 수정이고 진단 능력이 즉시 회복된다.

```yaml
# stage
ApplicationName=eventStage
# prod
ApplicationName=eventProd
```

2단계 — DB 접속 대상을 환경변수로 뺀다. 네 프로젝트 공통 조치다.

3단계 — 기동 시 가드를 넣는다(device 서버 §3.2). **다섯 프로젝트에 같은 코드가 필요하므로 공용 모듈로 만드는 편이 낫다.**

4단계 — `ApplicationName` 을 애플리케이션 이름에서 자동으로 채운다. 손으로 적으면 또 복사된다.

```yaml
url: jdbc:postgresql://${DB_HOST}:${DB_PORT}/${DB_NAME}?ApplicationName=${spring.application.name}-${spring.profiles.active}
```

`spring.application.name: event-stream` 이 이미 정의되어 있으므로 바로 쓸 수 있다.

---

### 3.4 자격증명이 형상관리에 평문으로 있다

DB 계정과 AWS 키가 `application.yml` 에 있고, **AWS 키는 나머지 네 프로젝트와 동일한 값**이다.

```yaml
amazon-properties:
  access-key: <운영 AWS 키>        # 다섯 프로젝트가 같은 키
  secret-key: <운영 AWS 시크릿>
```

이 서버가 필요한 권한은 `ncn-vueroid-web` 버킷의 `event/vod/` 하위에 쓰는 것뿐인데, api 서버의 SES·KVS 권한까지 들고 있다.

조치는 api 서버 문서 §3.1 과 동일하다. **다섯 프로젝트를 하나의 작업으로 묶어 처리한다.** 이 서버는 EC2 인스턴스 프로파일로 전환하기 가장 쉬운 대상이다 — S3 하나만 쓰기 때문이다.

```java
// AwsS3Config — 키를 코드에서 없앤다
return S3AsyncClient.builder()
        .region(Region.of(props.getRegion()))
        .credentialsProvider(DefaultCredentialsProvider.create())   // 인스턴스 프로파일 사용
        .build();
```

---

## 4. P1 — 안정성

### 4.1 ffmpeg 을 타임아웃 없이 기다리고, 퍼밋은 4개뿐이다

**현상**

리먹스 단계에서 외부 ffmpeg 프로세스를 실행한다.

```java
// MuxingSession.java:509-522
Process process = new ProcessBuilder(command)
        .directory(Path.of(".").toAbsolutePath().normalize().toFile())
        .redirectErrorStream(true)
        .start();

String output;
try (var input = process.getInputStream()) {
    output = new String(input.readAllBytes(), StandardCharsets.UTF_8);
}

int exitCode = process.waitFor();       // ← 타임아웃 없음. 무한 대기
```

그리고 이 코드가 실행되는 워커는 **세마포어 퍼밋을 쥐고 있다.**

```java
// MuxingSession.java:52-54
private static final int MAX_CONCURRENT_MUX = 4;
private static final Semaphore MUX_PERMITS = new Semaphore(MAX_CONCURRENT_MUX);

// MuxingSession.java:236-238
MUX_PERMITS.acquire();
permitAcquired = true;
```

**근거**

`waitFor()` 는 프로세스가 끝날 때까지 무한정 기다린다. ffmpeg 이 손상된 입력이나 특정 코덱 조합에서 멈추면 **그 워커는 영구히 퍼밋을 반납하지 않는다.**

퍼밋이 4개이므로 **이런 상황이 네 번 누적되면 새 워커가 단 하나도 퍼밋을 얻지 못한다.**

```
ffmpeg 멈춤 4회 누적
  → MUX_PERMITS.availablePermits() == 0 (영구)
  → 이후 모든 세션의 워커가 acquire() 에서 대기
  → 프레임은 계속 들어오고 큐에만 쌓인다 (§4.2)
  → 서비스는 살아 있지만 아무것도 처리하지 않는다
```

**프로세스는 정상, 포트는 열려 있고, 로그도 조용하다.** §3.1 대로 헬스체크가 없으므로 ALB 도 이상을 감지하지 못한다. **이 서버에서 가장 조용하고 가장 완전한 정지 시나리오다.**

`redirectErrorStream(true)` 로 합친 뒤 `readAllBytes()` 를 `waitFor()` 보다 먼저 하는 순서는 올바르다(파이프 버퍼가 차서 생기는 교착을 피한다). **구현자가 이 함정은 알고 있었는데 타임아웃은 빠졌다.**

**해결 시나리오**

1단계 — 타임아웃과 강제 종료를 넣는다.

```java
Process process = new ProcessBuilder(command).redirectErrorStream(true).start();

String output;
try (var input = process.getInputStream()) {
    output = new String(input.readAllBytes(), StandardCharsets.UTF_8);
}

if (!process.waitFor(REMUX_TIMEOUT_SECONDS, TimeUnit.SECONDS)) {
    process.destroyForcibly();
    process.waitFor(5, TimeUnit.SECONDS);
    throw new IllegalStateException("ffmpeg remux timeout: sessionId=" + sessionId);
}
if (process.exitValue() != 0) {
    throw new IllegalStateException("ffmpeg remux failed: " + output);
}
```

타임아웃 값은 **정상 리먹스 소요시간을 먼저 측정해서 정한다.** `-c copy` 리먹스라면 영상 길이에 거의 비례하지 않고 파일 크기에 비례한다. 실측 p99 의 3~5배가 적당하다.

2단계 — `MAX_CONCURRENT_MUX` 를 설정값으로 빼고 CPU 수에 연동한다.

```java
@Value("${eventstream.max-concurrent-mux:0}")
private int configuredMaxConcurrentMux;
// 0이면 availableProcessors() 기반으로 산정
```

**상수 4는 어떤 근거로 정해진 값인지 코드에 없다.** 인스턴스를 키워도 처리량이 늘지 않고, 줄여도 자동으로 낮아지지 않는다.

3단계 — 퍼밋 획득에도 타임아웃을 둔다. 영원히 기다리는 대신 실패시키는 편이 낫다.

```java
if (!MUX_PERMITS.tryAcquire(PERMIT_WAIT_SECONDS, TimeUnit.SECONDS)) {
    log.error("Mux permit timeout — 세션 폐기: sessionId={}", sessionId);
    permitTimeoutCounter.increment();     // 알람 대상
    return;                               // 큐가 무한정 쌓이는 것보다 낫다
}
```

4단계 — 리먹스 소요시간과 실패를 지표로 낸다(§3.1 2단계). **타임아웃을 넣어도 자주 걸린다면 값이 잘못됐거나 입력이 잘못된 것이므로, 지표 없이는 판단할 수 없다.**

**검증**

- ffmpeg 을 인위적으로 멈추게 하는 입력으로 시험 → 타임아웃 후 퍼밋 반납 확인
- 4회 반복 후에도 새 세션이 정상 처리되는지

---

### 4.2 대기하는 세션의 프레임 큐가 무제한이다

**현상**

```java
// MuxingSession.java:68 — 용량 인자가 없다 = Integer.MAX_VALUE
private final LinkedBlockingQueue<QueuedFramePacket> packetQueue = new LinkedBlockingQueue<>();

// MuxingSession.java:189
packetQueue.offer(snapshotPacket(packet, packetSeq));    // 항상 성공한다
```

**근거**

`snapshotPacket` 은 Netty 버퍼의 내용을 **힙 배열로 복사한다.**

```java
// MuxingSession.java:1572-1575
ByteBuffer source = packet.dataAsByteBuffer().duplicate();
byte[] data = new byte[source.remaining()];
source.get(data);
```

이 복사 자체는 옳은 설계다. Netty 는 `channelRead0` 반환 후 버퍼를 반납하므로, 복사하지 않고 참조만 넘기면 해제된 메모리를 읽게 된다. **구현자가 이 함정을 정확히 피했다.**

문제는 복사본이 쌓이는 데 상한이 없다는 점이다. §4.1 의 퍼밋 4개와 결합하면 이렇게 된다.

```
동시 업로드 세션 5개
  → 4개는 퍼밋을 얻어 처리
  → 5번째 세션의 워커는 acquire() 에서 대기
  → 그동안 단말은 계속 프레임을 보낸다
  → 5번째 세션의 큐에 영상 전체가 힙으로 쌓인다
```

프레임 최대 크기는 `LengthFieldBasedFrameDecoder(4MB)` 로 제한되지만 **개수 제한이 없다.** 1분짜리 이벤트 영상이 수십 MB 라면, 대기 세션 50개는 수 GB 다.

`offer()` 는 실패하지 않으므로 **어디에도 경고가 남지 않는다.** OOM 이 나기 전까지 아무 신호가 없다.

**운영에서 터지는 시나리오**

사고나 급정거가 동시다발로 일어나는 상황(출퇴근 시간, 악천후)에서 이벤트 업로드가 몰린다. 5번째부터는 모두 대기 큐로 간다. **힙이 차면 GC 가 길어지고, 그러면 처리가 더 느려져 큐가 더 쌓인다.** 되먹임 구조라 임계점을 넘으면 급격히 무너진다.

**해결 시나리오**

1단계 — 큐에 상한을 두고, 넘치면 명시적으로 실패시킨다.

```java
private static final int MAX_QUEUE_PACKETS = 2_000;   // 실측 기반으로 정한다
private final BlockingQueue<QueuedFramePacket> packetQueue = new LinkedBlockingQueue<>(MAX_QUEUE_PACKETS);

if (!packetQueue.offer(snapshotPacket(packet, packetSeq))) {
    droppedPacketCount++;
    queueOverflowCounter.increment();      // 알람 대상
    // 세션을 포기할지, 프레임만 버릴지는 정책 결정 사항
}
```

**프레임을 버리면 영상에 구멍이 생기고, 세션을 포기하면 영상 전체를 잃는다.** 둘 중 무엇이 나은지는 서비스 기준으로 정해야 한다. 사고 영상이라면 **불완전한 영상보다 명확한 실패가 나을 수 있다** — 단말이 재시도할 여지가 생기기 때문이다.

2단계 — 역압을 TCP 까지 전달한다. 이것이 더 근본적이다.

```java
// 큐가 임계치를 넘으면 읽기를 멈춘다 → TCP 수신 윈도가 줄어 단말이 느려진다
if (packetQueue.size() > HIGH_WATER_MARK) {
    ctx.channel().config().setAutoRead(false);
}
// 큐가 빠지면 다시 켠다
if (packetQueue.size() < LOW_WATER_MARK) {
    ctx.channel().config().setAutoRead(true);
}
```

**메모리에 쌓는 대신 네트워크가 기다리게 하는 것이 정석이다.** 다만 `IdleStateHandler(10초)` 와 상호작용을 확인해야 한다. 읽기를 멈추면 유휴로 판정되어 연결이 끊길 수 있다. 자동 읽기를 끈 동안에는 유휴 판정을 유예하는 처리가 필요하다.

3단계 — 세션 수 자체에 상한을 둔다. 큐 상한만으로는 세션이 늘어나는 것을 막지 못한다.

```java
// 퍼밋 대기가 길어지면 새 연결을 거절한다
if (MUX_PERMITS.availablePermits() == 0 && activeSessions.get() > MAX_ACTIVE_SESSIONS) {
    ctx.close();     // 단말이 나중에 재시도하도록
}
```

**검증**

- 동시 업로드 20건 주입 → 힙 사용량이 선형 증가하지 않는지
- 큐 상한 도달 시 지표가 오르고 로그가 남는지

---

### 4.3 후처리가 제한 없는 가상 스레드로 실행된다

**현상**

먹싱이 끝나면 후처리가 시작된다.

```java
// FileUploadFacade.java:49-51
public void processCompletedFile(String sessionId, String serial, String filePathStr, String fileName) {
    Thread.ofVirtual().start(() -> {      // ← 개수 제한 없음
```

후처리가 하는 일은 가볍지 않다.

```
1. FFmpegFrameGrabber 로 영상 길이 추출        (JavaCV — 네이티브 호출)
2. 썸네일 80장 추출 + 스프라이트 합성           (JavaCV — 네이티브 + 이미지 메모리)
3. 썸네일 S3 업로드
4. 영상 S3 업로드
5. dv_file / dv_file_thumbnail DB 기록
6. 작업 디렉터리 삭제
```

**근거**

먹싱은 세마포어 4개로 제한된다. **후처리에는 그런 제한이 없다.**

가상 스레드는 생성 비용이 낮지만, **네이티브 호출 중에는 캐리어 스레드에서 내려올 수 없다(pinning).** JavaCV 의 `FFmpegFrameGrabber` 는 JNI 로 FFmpeg 을 호출하므로 그 시간 동안 캐리어 스레드를 점유한다.

가상 스레드 스케줄러의 기본 병렬도는 CPU 코어 수다. **코어가 4개인 인스턴스에서 후처리 4건이 동시에 네이티브 구간에 들어가면, 나머지 가상 스레드는 전부 멈춘다.** 먹싱 워커도 같은 스케줄러를 쓰므로 함께 멈춘다.

```java
// MuxingSession.java:53 — 먹싱 워커도 가상 스레드다
private static final ExecutorService MUX_EXECUTOR = Executors.newVirtualThreadPerTaskExecutor();
```

**즉 후처리가 몰리면 먹싱까지 함께 굶는다.** 세마포어 4개가 지키려던 경계가 우회된다.

**이것이 `docs/eventstream-deploy-slowdown.md` 가 특정하지 못한 CPU 점유 주체의 유력한 후보다.** 그 문서는 "접속 중인 단말이 없는데 CPU 가 포화되어 있다"는 관찰로 끝난다. 후처리는 **단말 접속이 이미 끝난 뒤에 실행된다.** 접속 단말이 0인데 CPU 가 포화된 상태와 정확히 맞물린다.

**해결 시나리오**

1단계 — **먼저 가설을 검증한다.** 조치보다 확인이 먼저다.

```bash
# 대상 서버에서 — 접속 단말이 없는 상태에서 CPU 를 쓰는 주체 확인
jcmd <pid> Thread.print | grep -c "VirtualThread"
ps -ef | grep -c ffmpeg
top -H -p <pid>          # 어떤 스레드가 CPU 를 쓰는지
```

`-Djdk.tracePinnedThreads=full` 로 기동하면 **핀 발생 지점의 스택이 그대로 찍힌다.** 가설 검증에 가장 직접적인 수단이다.

2단계 — 후처리를 전용 플랫폼 스레드 풀로 옮긴다. **네이티브 호출이 지배적인 작업에는 가상 스레드가 적합하지 않다.**

```java
private final ExecutorService postProcessExecutor = new ThreadPoolExecutor(
        2, 4, 60L, TimeUnit.SECONDS,
        new LinkedBlockingQueue<>(200),
        new ThreadFactoryBuilder().setNameFormat("postproc-%d").build(),
        new ThreadPoolExecutor.CallerRunsPolicy()
);
```

**먹싱 퍼밋과 후처리 풀 크기의 합이 코어 수를 넘지 않게 잡는다.** 두 작업 모두 CPU 바운드다.

3단계 — 후처리 실패 시 복구 경로를 만든다. 지금은 가상 스레드 안에서 예외가 나면 로그만 남고 끝이다.

```
dv_file 저장 전에 실패하면 영상 자체가 유실된다.
  → 먹싱 완료 시점에 "처리 대기" 상태로 DB에 먼저 기록
  → 후처리 완료 시 상태 갱신
  → 실패한 건은 배치가 재시도
```

**먹싱까지 성공한 영상은 이미 디스크에 있으므로, 후처리 실패는 재시도로 완전히 복구 가능한 실패다.** 지금은 그 기회를 버리고 있다.

4단계 — 썸네일 80장 추출이 정말 필요한지 재검토한다. `DEFAULT_THUMBNAIL_TARGET_FRAMES = 80` 은 이벤트 영상 길이에 비하면 촘촘하다. 개수를 줄이면 후처리 비용이 비례해 줄어든다.

**검증**

- `jdk.tracePinnedThreads` 로 핀 발생 확인 → 조치 후 사라지는지
- 세션 20건 동시 종료 → 먹싱 처리가 멈추지 않는지

---

### 4.4 Netty 이벤트 루프에서 DB 조회와 FFmpeg 초기화를 한다

**현상**

세션 헤더 처리 전체가 이벤트 루프 스레드에서 실행된다.

```java
// FlatBufferHandler.java:80-95 — channelRead0 에서 직접 호출된다
boolean isValid = deviceAuthenticator.isValid(serial);      // ① JDBC 조회 (블로킹)
...
MuxingSession muxer = new MuxingSession(...);
muxer.init(header);                                          // ② 아래 작업 전부
```

```java
// MuxingSession.init — ②의 내용
sessionWorkDir = ensureSessionWorkDirectory();     // 디렉터리 생성
dumpMediaInfoBytes(mediaInfoBytes);                // 파일 쓰기
MediaInfoParser.parse(mediaInfoBytes);             // 파싱 (591줄짜리 파서)
audioOutputStream = Files.newOutputStream(...);    // 파일 열기
initializePacketMuxer(videoInfo);                  // FFmpegFrameRecorder 초기화 (네이티브)
```

**근거**

Netty 이벤트 루프는 **여러 연결을 하나의 스레드가 돌아가며 처리한다.** 워커 그룹은 `new NioEventLoopGroup()` 기본값이므로 스레드 수는 CPU 코어의 2배다.

한 연결의 세션 헤더 처리가 블로킹되면, **그 이벤트 루프에 배정된 다른 모든 연결이 그동안 읽히지 않는다.** JDBC 조회 하나가 수십 ms 여도, 접속이 몰리면 누적된다.

`Device` 조회는 `md_device` 전체 행을 가져오므로 커넥션 풀 대기까지 겹칠 수 있다. **커넥션 풀 설정이 이 프로젝트에는 아예 없어 기본값 10이다.**

**운영에서 터지는 시나리오**

네트워크 복구나 브로커 재기동 후 단말들이 한꺼번에 재접속하는 상황에서, 세션 헤더가 동시에 밀려든다. 이벤트 루프가 DB 조회로 막히면 **접속 처리 자체가 직렬화되어 재접속 폭풍이 해소되지 않는다.** 단말은 타임아웃 후 재시도하므로 부하가 더 커진다.

**해결 시나리오**

1단계 — 무거운 작업을 이벤트 루프 밖으로 뺀다. Netty 는 이를 위한 표준 수단을 제공한다.

```java
// 핸들러를 별도 EventExecutorGroup 에 배치하면 그 그룹의 스레드에서 실행된다
private final EventExecutorGroup businessGroup = new DefaultEventExecutorGroup(16);

pipeline.addLast(businessGroup, flatBufferHandler);
```

**한 줄 변경으로 이벤트 루프 블로킹이 사라진다.** 같은 채널의 메시지는 같은 실행자에 순서대로 배정되므로 순서 보장도 유지된다.

2단계 — 인증 결과를 캐시한다. 같은 시리얼이 반복 접속하므로 캐시 적중률이 높다.

```java
// 짧은 TTL 이면 단말 삭제 반영 지연도 감수할 만하다
Cache<String, Boolean> authCache = Caffeine.newBuilder()
        .expireAfterWrite(Duration.ofMinutes(5))
        .maximumSize(50_000)
        .build();
```

3단계 — 커넥션 풀을 명시한다. 현재 설정이 없어 기본값으로 돌고 있다.

```yaml
spring:
  datasource:
    hikari:
      maximum-pool-size: 10
      connection-timeout: 3000
```

**다섯 서버가 같은 DB 를 쓰므로 합계를 계산해야 한다**(다른 문서와 동일한 지적).

**검증**

- 동시 접속 200건 주입 → 세션 헤더 처리 지연이 선형 증가하지 않는지
- 이벤트 루프 스레드의 CPU 시간이 특정 스레드에 몰리지 않는지

---

### 4.5 작업 디렉터리 정리가 정상 경로에만 있다

**현상**

작업 디렉터리 삭제는 후처리의 **마지막 단계**에 있다.

```java
// FileUploadFacade.java:107-109 — try 블록 안, 모든 단계 뒤
deleteSessionWorkDirectoryIfExists(filePath, fileName);
log.info("Business Task Completed: ...");
} catch (Exception e) {
    log.error("Failed to complete business task for session {}", sessionId, e);   // 정리 없음
}
```

**근거**

세션 하나가 만드는 파일은 여러 개다.

```
work/{serial}/{fileName}                    최종 MP4
work/.../video-only.mp4                     중간 산출물
work/.../audio.aac                          중간 산출물
work/.../remuxed.mp4                        중간 산출물
work/.../{fileName}.mediaInfo.bin           덤프
```

이 파일들이 남는 경로가 여럿이다.

| 상황 | 결과 |
|---|---|
| 후처리 중 예외 (S3 오류, DB 오류 등) | 전부 잔존 |
| 비디오 프레임이 하나도 없어 리먹스를 건너뜀 (`finishMuxing` 조기 return) | 전부 잔존 |
| 먹싱 중 예외 (`releaseResources` 는 파일을 지우지 않는다) | 전부 잔존 |
| §4.1 의 ffmpeg 멈춤 | 전부 잔존 |
| 프로세스 강제 종료·배포 | 진행 중이던 전부 잔존 |

그리고 **이 프로젝트에는 주기적 정리 배치가 없다.** `@Scheduled` 도 `@EnableScheduling` 도 없다.

`releaseResources()` 는 이름과 달리 **네이티브 자원(recorder, format context)만 반납하고 파일은 손대지 않는다.**

**운영에서 터지는 시나리오**

실패는 드물게 일어나므로 누수도 천천히 쌓인다. **몇 달에 걸쳐 조용히 늘다가 디스크가 차는 순간 모든 것이 한꺼번에 멈춘다.** 먹싱은 파일 쓰기에 의존하므로 디스크 full 은 곧 서비스 정지다.

media 서버와 달리 여기는 정리 배치 자체가 없으므로 **회수 수단이 아예 없다.**

**해결 시나리오**

1단계 — `finally` 로 옮긴다.

```java
try {
    // 후처리 전부
} catch (Exception e) {
    log.error("Failed to complete business task for session {}", sessionId, e);
} finally {
    deleteSessionWorkDirectoryIfExists(filePath, fileName);
}
```

**다만 §4.3 3단계의 재시도를 도입한다면 실패 시에는 남겨야 한다.** 두 조치의 순서를 정해야 한다. 재시도를 넣을 계획이면 "성공 시 삭제 / 실패 시 보존 + 만료 후 정리"가 맞다.

2단계 — 주기적 청소를 추가한다. **어떤 경로로 남았든 회수되는 안전망이 필요하다.**

```java
@Scheduled(fixedDelay = 30 * 60 * 1000)     // 30분마다
public void cleanupStaleWorkDirectories() {
    // 진행 중인 세션의 디렉터리는 건드리지 않는다
    // 마지막 수정이 N시간 이전인 것만 삭제
}
```

**진행 중 세션과 구분하는 것이 핵심이다.** 활성 세션 목록을 참조하거나, 충분히 긴 임계값(예: 6시간)을 쓴다.

3단계 — 디스크 사용량 지표와 알람을 붙인다(§3.1). **누수는 지표가 없으면 디스크가 찰 때까지 보이지 않는다.**

**검증**

- 후처리에 강제 예외 주입 → 작업 디렉터리가 남지 않는지 (또는 의도대로 보존되는지)
- 청소 배치가 진행 중 세션의 파일을 지우지 않는지

---

### 4.6 미등록 단말이 인증을 통과한 뒤 NPE 로 끝난다

**현상**

인증은 시리얼 존재와 삭제 여부만 본다.

```java
// RepositoryDeviceAuthenticator.java:15-17
return deviceRepository.findBySerial(serial)
        .filter(device -> device.getDeviceStatusCd() != DeviceStatus.DEL)
        .isPresent();                          // ua_id 는 확인하지 않는다
```

후처리에서 소유자를 꺼낼 때 문제가 드러난다.

```java
// FileUploadFacade.java:68-69
Device device = mdDeviceService.findBySerial(serial);
long uaId = device.getUaId();                  // Long → long 자동 언박싱
```

**근거**

`md_device.ua_id` 는 **단말이 사용자 계정에 등록될 때 채워진다.** device 서버 부트스트랩으로 자동 생성된 행(device 서버 문서 §3.1)은 `ua_id` 가 NULL 이다.

즉 **아직 등록되지 않은 단말이 인증을 통과한다.** 그 단말이 영상을 올리면:

```
① 세션 헤더 통과 (ua_id 확인 안 함)
② 프레임 전량 수신 + 큐 적재 + 먹싱 (CPU·디스크 소모)
③ 리먹스 + 최종 MP4 조립 완료
④ 후처리 시작 → device.getUaId() 에서 NPE
⑤ catch 로 잡혀 로그만 남고 종료
⑥ 작업 디렉터리 잔존 (§4.5)
```

**모든 비용을 다 치른 뒤 마지막 단계에서 버려진다.** 게다가 `Device` 자체가 없을 때도 같은 자리에서 NPE 다(`findBySerial` 이 null 을 반환하는 경우).

**운영에서 터지는 시나리오**

단말을 구매했지만 아직 앱에 등록하지 않은 사용자의 단말이 이벤트 영상을 올린다. 서버는 매번 전 과정을 수행하고 매번 버린다. **등록 전 단말이 많다면 그 비용이 계속 발생하고, 로그에는 NPE 스택만 쌓인다.**

`ua_id` 가 NULL 인 단말 수는 device 서버 문서 §3.1 에서 확인한 것과 같은 쿼리로 알 수 있다.

```sql
SELECT COUNT(*) FROM md_device WHERE ua_id IS NULL;
```

**해결 시나리오**

1단계 — 인증 단계에서 걸러낸다. **비용을 치르기 전에 거절하는 것이 핵심이다.**

```java
@Override
public boolean isValid(String serial) {
    return deviceRepository.findBySerial(serial)
            .filter(device -> device.getDeviceStatusCd() != DeviceStatus.DEL)
            .filter(device -> device.getUaId() != null)      // 등록된 단말만
            .isPresent();
}
```

2단계 — 거절 사유를 단말에 알린다. 지금은 `ctx.close()` 로 그냥 끊는다. **단말은 왜 실패했는지 모르니 계속 재시도한다.** `EndOfStream` 에 코드 필드가 있으므로 그것으로 사유를 내려보낼 수 있다.

3단계 — 후처리에도 방어를 남긴다. 인증에서 거른 뒤에도 그 사이 등록이 해제될 수 있다.

```java
Device device = mdDeviceService.findBySerial(serial);
if (device == null || device.getUaId() == null) {
    log.warn("Skipping business task — 소유자 없는 단말: sessionId={}, serial={}", sessionId, serial);
    return;      // finally 의 정리는 그대로 수행된다 (§4.5)
}
```

4단계 — 거절 건수를 지표로 남긴다. **급증하면 등록 플로우에 문제가 생겼다는 신호다**(devicereg 문서 참조).

**검증**

- `ua_id` 가 NULL 인 시리얼로 접속 → 세션 헤더 단계에서 즉시 거절
- 거절 지표가 집계되는지

---

## 5. P2 — 정리 대상

### 5.1 유일한 세션 진단 지표가 항상 0이다

`FlatBufferHandler` 는 세션 종료 로그마다 `messageCount` 를 남긴다.

```java
// FlatBufferHandler.java:106-110, 118-123, 138-143
log.info("Finalizing channel session: sessionId={}, messageCount={}, endType: {}", ..., currentMessageCount(ctx), endType);
log.warn("Reader idle timeout. Finalizing channel session: sessionId={}, messageCount={}", ..., currentMessageCount(ctx));
log.error("Netty handler error: sessionId={}, messageCount={}, message={}", ..., currentMessageCount(ctx), ...);
```

그런데 **이 카운터를 증가시키는 코드가 없다.**

```java
// FlatBufferHandler.java:35 — 선언
private static final AttributeKey<AtomicLong> MESSAGE_COUNT_KEY = AttributeKey.valueOf("message_count");

// FlatBufferHandler.java:150-153 — 읽기만 한다. set 하는 곳도, increment 하는 곳도 없다
private long currentMessageCount(ChannelHandlerContext ctx) {
    AtomicLong counter = ctx.channel().attr(MESSAGE_COUNT_KEY).get();
    return counter == null ? 0L : counter.get();      // 항상 0
}
```

**세션이 몇 프레임을 받고 끝났는지가 유휴 타임아웃·예외 상황 진단의 핵심 정보인데, 그 값이 언제나 0이다.** 로그를 보는 사람은 "프레임을 하나도 못 받고 끊겼다"로 오해하게 된다.

조치 방향: `channelRead0` 에서 증가시킨다.

```java
ctx.channel().attr(MESSAGE_COUNT_KEY)
   .setIfAbsent(new AtomicLong());
ctx.channel().attr(MESSAGE_COUNT_KEY).get().incrementAndGet();
```

`MuxingSession` 에는 `enqueuedPacketCount` 등 정확한 카운터가 이미 있으므로, 그 값을 쓰거나 이 카운터를 제거하는 것도 방법이다. **틀린 값을 남기는 것보다는 없는 편이 낫다.**

### 5.2 로그 한 줄에 20개 이상의 필드가 들어간다

```java
// MuxingSession.java:197-217 — 한 줄에 23개 필드
log.info("Finalize requested: sessionId={}, enqueuedPackets={}, processedPackets={}, frameCount={}, "
       + "videoPackets={}, videoIFrames={}, videoPFrames={}, videoBFrames={}, videoSpsPpsPackets={}, "
       + "videoOtherFrames={}, videoFrameIndexGaps={}, incomingVideoTimestampJumps={}, ...", ...);
```

같은 형태의 로그가 `finishMuxing` 에도 두 번 더 있다.

수집한 정보 자체는 훌륭하다. **문제는 형식이다.** 텍스트 한 줄로 뭉쳐 있어 특정 필드로 검색·집계·추이 관찰이 불가능하다. 한 줄이 1KB 를 넘어 로그 용량도 빠르게 찬다.

조치 방향:

- 이 값들은 **로그가 아니라 메트릭이어야 한다**(§3.1 2단계). 추이를 보는 것이 목적이기 때문이다.
- 로그로 남긴다면 JSON 구조화 로깅으로 바꿔 필드 단위 조회가 가능하게 한다.
- 세션당 3회 남기는 대신 종료 시 1회로 줄인다.

### 5.3 `@Value` 필드에 초기값이 중복되어 있다

```java
// NettyServer.java:34-35
@Value("${netty.read-idle-timeout-seconds:10}")
private int readIdleTimeoutSeconds = 10;
```

기본값이 두 곳에 적혀 있다. 스프링이 필드 초기화 이후에 주입하므로 동작에는 문제가 없지만, **한쪽만 고치면 어느 값이 적용되는지 헷갈린다.** 필드 초기화를 제거한다.

`netty.read-idle-timeout-seconds` 는 어느 프로파일에도 정의되어 있지 않으므로 전 환경이 10초로 동작한다. **이동 중 통신 품질이 나쁜 구간에서 10초는 짧을 수 있다.** 실제 재접속 빈도를 확인해 값을 정하고 프로파일에 명시하는 편이 낫다.

### 5.4 무중단 배포가 없다

`NettyServer` 는 `SmartLifecycle` 을 구현해 `stop()` 에서 채널과 이벤트 루프를 정리한다. 종료 처리 자체는 갖춰져 있다.

```java
// NettyServer.java:95-116
serverChannel.close().syncUninterruptibly();
workerGroup.shutdownGracefully().syncUninterruptibly();
```

그러나 **진행 중인 먹싱 세션은 기다리지 않는다.** 배포 시점에 업로드 중이던 영상은 유실된다. 큐에 있던 프레임도 사라진다.

`docs/eventstream-deploy-slowdown.md` 8절이 같은 지적을 하고 있다. 그 문서는 "실사용 환경에서는 재시작 시 스트림 유실, 무중단 배포 부재 문제가 발생하므로 사전 대응이 필요하다"로 정리했다.

조치 방향:

```
1. serverChannel 만 먼저 닫아 신규 접속을 막는다 (기존 세션은 유지)
2. 진행 중 세션이 끝날 때까지 대기 (상한 예: 3분)
3. 상한을 넘으면 강제 종료 — 그때 남은 파일은 §4.5 의 청소 배치가 회수
4. ALB 타겟 그룹에서 먼저 제외 → 드레이닝 시간 확보
```

**§3.1 의 헬스체크가 있어야 4번이 성립한다.** 순서상 관측 도입이 먼저다.

### 5.5 운영 DataSource 가 log4jdbc 를 경유한다

다섯 프로젝트 공통 문제다. 전 프로파일이 `net.sf.log4jdbc.sql.jdbcapi.DriverSpy` 를 쓴다.

이 서버는 쿼리 빈도가 낮아(세션당 2회 정도) 영향이 가장 작다. 다만 §4.4 대로 그 조회가 이벤트 루프에서 일어나므로, **프록시 오버헤드가 이벤트 루프 점유 시간을 늘린다.** 다른 프로젝트와 함께 정리한다.

---

## 6. 조치 순서

| 단계 | 기간 | 항목 | 배포 리스크 |
|---|---|---|---|
| 0 | 즉시 | `ApplicationName` 중복 수정(§3.3 1단계) — 한 줄 | 없음 |
| 1 | 즉시 | CPU 점유 주체 가설 검증(§4.3 1단계) — `jdk.tracePinnedThreads` | 없음 — **기존 미해결 과제의 답** |
| 2 | 1주 | actuator·메트릭·헬스체크 도입(§3.1) | 낮음 — **이후 모든 조치의 검증 수단** |
| 3 | 1주 | ffmpeg 타임아웃(§4.1 1단계), 미등록 단말 사전 거절(§4.6) | 낮음 — 국소 변경, 효과 큼 |
| 4 | 1주 | 작업 디렉터리 `finally` 정리 + 청소 배치(§4.5) | 낮음 |
| 5 | 2주 | 후처리 전용 풀 전환(§4.3 2단계), 이벤트 루프 분리(§4.4 1단계) | 중간 — 부하 테스트 필요 |
| 6 | 2주 | 큐 상한 + 역압(§4.2), 동시 먹싱 수 설정화(§4.1 2단계) | 중간 — 정책 결정 선행 |
| 7 | 2주 | 자격증명 외부 주입·prod DB 정정(§3.3, §3.4) — 다섯 프로젝트 동시 | 중간 |
| 8 | 3주 | 무중단 배포(§5.4) | 중간 — §3.1 헬스체크 의존 |
| 9 | 별도 | TLS·단말 인증(§3.2) | 높음 — 펌웨어 로드맵 연계 |

**1단계를 이례적으로 앞에 둔 이유**: 이미 작성된 사고 문서(`eventstream-deploy-slowdown.md`)가 CPU 점유 주체를 특정하지 못한 채 종료되었다. §4.3 이 그 답의 후보를 제시하므로, **명령 한 줄로 검증할 수 있는 이 확인이 다른 어떤 작업보다 가치가 높다.** 가설이 맞으면 5단계의 우선순위가 올라가고, 틀리면 다른 곳을 봐야 한다.

**2단계 없이는 3단계 이후를 검증할 수 없다.** 지표가 없는 상태에서 동시성 값을 조정하는 것은 추측이다.

---

## 7. 검증 체크리스트

```
[ ] pg_stat_activity 에서 eventstream 과 media 가 구분됨
[ ] jdk.tracePinnedThreads 로 핀 발생 지점 확인 → 조치 후 사라짐
[ ] /actuator/health 응답, ALB 타겟그룹 헬스체크 연결
[ ] 퍼밋 가용량·큐 깊이·후처리 진행 건수가 지표로 관측됨
[ ] ffmpeg 멈춤 유발 입력 → 타임아웃 후 퍼밋 반납, 4회 반복 후에도 정상
[ ] 동시 업로드 20건 → 힙 사용량 선형 증가 없음
[ ] 세션 20건 동시 종료 → 먹싱 처리가 멈추지 않음
[ ] 동시 접속 200건 → 세션 헤더 처리 지연이 선형 증가하지 않음
[ ] 후처리 강제 예외 → 작업 디렉터리 잔존 없음
[ ] ua_id 가 NULL 인 시리얼 → 세션 헤더 단계에서 즉시 거절
[ ] 세션 종료 로그의 messageCount 가 실제 값
[ ] 배포 시 진행 중 업로드가 완료된 뒤 종료
```

---

## 8. 경력기술서용 요약

**1) 미해결 성능 장애의 원인 가설 도출 및 검증 설계**
> CPU 포화로 배포가 지연되었으나 점유 주체를 특정하지 못한 채 종료된 기존 장애를, 코드 분석을 통해 재조사. 영상 후처리(JavaCV 네이티브 호출)가 개수 제한 없는 가상 스레드로 실행되어 캐리어 스레드를 고정(pinning)하고, 같은 스케줄러를 쓰는 먹싱 워커까지 굶기는 경로를 규명. 후처리가 단말 접속 종료 이후에 실행된다는 점이 "접속 단말 0인데 CPU 포화"라는 관찰과 일치함을 확인하고, `jdk.tracePinnedThreads` 기반 검증 절차와 전용 플랫폼 스레드 풀 전환 방안을 설계.

**2) 완전 정지 시나리오 발견 및 차단**
> 외부 FFmpeg 프로세스를 타임아웃 없이 대기하는 코드가 동시 실행 제한 세마포어(퍼밋 4개)를 점유하는 구조를 발견. FFmpeg 무응답이 4회 누적되면 프로세스는 살아 있고 포트도 열린 채 모든 영상 처리가 영구 정지하며, 헬스 엔드포인트가 없어 오토스케일링·로드밸런서도 감지하지 못하는 경로를 특정. 프로세스 타임아웃·강제 종료, 퍼밋 획득 타임아웃, 동시성 상수의 설정화를 적용.

**3) 관측 불가 상태 해소**
> 서비스 중 유일하게 HTTP 스타터와 actuator 가 없어 헬스 엔드포인트도 메트릭도 존재하지 않으며, 코드에 20개 넘는 세션 카운터가 있음에도 외부로 노출되지 않는 상태를 확인. 추가로 유일한 세션 진단 로그값(`messageCount`)이 증가 코드 부재로 항상 0을 출력해 오히려 오독을 유발하고 있었음을 발견. actuator·Prometheus 도입과 함께 먹싱 퍼밋 가용량·큐 깊이·후처리 진행 건수를 선행 지표로 정의하고, 처리 정체를 감지하는 커스텀 헬스 인디케이터를 설계.

**4) 백프레셔 부재로 인한 메모리 고갈 경로 차단**
> 동시 먹싱이 상수 4로 고정된 상태에서 대기 세션의 프레임 큐가 무제한이어서, 5번째 이후 동시 업로드가 영상 전체를 힙에 적재하는 구조를 규명. 큐 용량 상한과 오버플로 지표를 도입하고, Netty `autoRead` 제어로 TCP 수신 윈도까지 역압을 전달해 메모리 대신 네트워크가 대기하도록 전환하는 방안을 설계.

**5) 이벤트 루프 블로킹 제거**
> Netty 이벤트 루프 스레드에서 JDBC 조회, 파일 I/O, FFmpeg 레코더 초기화가 수행되어 재접속 폭주 시 연결 처리가 직렬화되는 문제를 확인. 핸들러를 별도 `EventExecutorGroup` 에 배치해 채널 단위 순서 보장을 유지하면서 블로킹을 격리하고, 단말 인증 결과 캐시로 조회 자체를 줄이는 개선을 적용.

**6) 자원 누수 및 조기 실패 경로 정비**
> 작업 디렉터리 정리가 후처리 정상 경로에만 존재하고 주기적 회수 수단이 없어, 처리 실패·조기 반환·프로세스 종료 시 중간 산출물이 영구 잔존하는 경로를 식별. 정리를 `finally` 로 이동하고 진행 중 세션을 구분하는 청소 배치를 추가. 아울러 인증이 소유자 유무를 확인하지 않아 미등록 단말의 영상이 수신·먹싱·리먹스를 모두 거친 뒤 마지막 단계 NPE 로 폐기되던 흐름을 세션 시작 시점 거절로 전환해 불필요한 CPU·디스크 소모를 제거.

---

## 9. 관련 문서

| 문서 | 내용 |
|---|---|
| `docs/eventstream-deploy-slowdown.md` | **본 서버의 기존 사고 분석 — CPU 점유 주체 미확정. §4.3 이 후보를 제시한다** |
| `docs/api-server-production-risks.md` | api 서버 리스크 — 자격증명·로깅 공통 조치 |
| `docs/device-server-production-risks.md` | device 서버 리스크 — prod DB 오설정, 단말 인증 부재 (공통 과제) |
| `docs/media-server-production-risks.md` | media 서버 리스크 — FFmpeg 동시성·디스크 정리 (유사 구조) |
| `docs/devicereg-server-production-risks.md` | devicereg 서버 리스크 — 등록 플로우 신뢰 모델 |
