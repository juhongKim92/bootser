# devicereg 서버 운영 리스크 분석 및 해결 시나리오

- **작성일**: 2026-08-31
- **대상**: `vueroid-web-devicereg` (Spring Boot 3.4.3 / Java 21 / WebSocket / MQTT)
- **상태**: 분석 완료, 조치 미착수

---

## 1. 요약

단말 등록 과정에서 **앱과 단말 사이를 중계하는 서버**다. 16개 파일 530줄로 리포 안에서 가장 작지만, 담당하는 기능은 서비스의 신뢰 경계 그 자체다.

등록 플로우는 이렇게 설계되어 있다.

```
1. 앱이 WebSocket /ncnRegist 접속 → {serial, type:"send"} 전송
2. 서버가 브로커에 단말 접속 여부 확인
3. 서버가 server/{serial}/command 로 {"type":"reg","timeout":30} 발행  → 단말이 등록 대기 모드 진입
4. 사용자가 30초 안에 단말의 물리 버튼을 누름
5. 단말이 device/{serial}/pushbutton 발행
6. 서버가 해당 serial 의 WebSocket 세션으로 "successRegist" 전달
7. 앱이 api 서버 POST /devices/usage 를 호출해 실제 바인딩
```

**4번의 물리 버튼 누름이 "이 단말을 물리적으로 소유하고 있다"는 증명이다.** 설계 의도는 타당하다. 시리얼은 단말 라벨에 인쇄되어 있어 비밀이 아니므로, 소유 증명은 물리적 행위로 받는 것이 맞다.

문제는 **그 증명이 실제 바인딩 단계에서 검증되지 않는다는 점**이다. 7번은 6번의 결과를 확인하지 않는다. 이 서버가 하는 일 전체가 강제력 없는 절차가 된다.

| 갈래 | 핵심 문제 |
|---|---|
| 신뢰 모델 | 물리 소유 증명이 바인딩 단계에서 검증되지 않는다. WebSocket 엔드포인트에도 인증이 없다 |
| 스케일아웃 | 공유 구독(한 인스턴스만 수신)과 인스턴스 로컬 세션 맵이 결합되어, **2대로 늘리면 등록이 절반 실패한다** |
| 환경 설정 | prod DB 가 다른 두 서버와 또 다르다. 세 서버가 서로 다른 "운영 DB" 를 본다 |
| 누락된 개선 | 다른 프로젝트에서 이미 고친 문제(HTTP 타임아웃)가 여기만 반영되지 않았다 |

---

## 2. 위험도 요약

| # | 항목 | 터지는 조건 | 영향 | 우선순위 |
|---|---|---|---|---|
| 1 | 물리 소유 증명이 바인딩 시 검증되지 않음 | 시리얼을 아는 로그인 사용자 | **타인 단말 무단 등록** | **P0** |
| 2 | WebSocket 무인증 + 오리진 전체 허용 | 상시 | 임의 단말 등록모드 진입, 성공 통지 탈취 | **P0** |
| 3 | 공유 구독 + 인스턴스 로컬 세션 맵 | 인스턴스 2대 이상 | 등록이 조용히 실패 | **P0** |
| 4 | prod DB 가 세 서버 중 또 다른 값 | prod 배포 시 | 데이터 분리 실패 | **P0** |
| 5 | Actuator 전체 노출 (전 프로파일) | 관리 포트 도달 가능 | 정보 노출 | **P0** |
| 6 | 자격증명 형상관리 커밋 | 리포 접근 가능한 누구나 | DB·브로커 계정 유출 | **P0** |
| 7 | 브로커 REST 호출에 타임아웃 없음 | 브로커 무응답 | 스레드 무한 점유 | **P1** |
| 8 | 세션 레지스트리 메모리 누수 | 다중 serial 등록 | 힙 증가 | **P1** |
| 9 | `/device/check/{serial}` 무인증 | 상시 | 단말 온라인 여부 조회 오라클 | **P1** |
| 10 | 토픽 파싱이 try 블록 밖 | 비정상 토픽 | 처리 중단 | P2 |
| 11 | WebSocket 유휴 타임아웃·크기 제한 없음 | 연결 누적 | 리소스 고갈 | P2 |
| 12 | 입력 검증 없음 | 비정상 페이로드 | NPE 로 연결 종료 | P2 |
| 13 | `minimum-idle` = `maximum-pool-size` | 상시 | 유휴 시에도 커넥션 10개 점유 | P2 |
| 14 | 로그 보존 2일 / log4jdbc 경유 | 상시 | 사후 분석 불가 | P2 |
| 15 | 공유 구독 그룹명을 서비스 간 공유 | 토픽 중복 시 | 메시지 분할 수신 | P2 |

---

## 3. P0 — 즉시 조치

### 3.1 물리 소유 증명이 실제 바인딩 단계에서 검증되지 않는다

**현상**

devicereg 서버는 버튼 누름을 확인하고 앱에 `successRegist` 를 보낸다.

```java
// MqttService.java:52-63
private void sendToWebSocket(String serial) {
    WebSocketSession session = sessionRegistry.getSession(serial);
    ...
    WebSocketHeader wsHeader = new WebSocketHeader("server", "successRegist", serial, 200, null);
    session.sendMessage(new TextMessage(wsPayload));
}
```

그런데 **실제 소유권을 기록하는 곳은 api 서버이고, 거기서는 이 절차를 확인하지 않는다.**

```java
// vueroid-web-api / DeviceService.java:108-120
@Transactional
public Device addDevice(AddDeviceRequest request, Long uaId) {
    Device device = deviceRepository.findBySerial(request.serial()).orElseThrow(IllegalArgumentException::new);
    if (device.getUaId() != null) {
        throw new ApiException(CommonErrorCode.ALREADY_EXISTS, "이미 등록된 단말 입니다.");
    }
    ...
    device.setUaId(uaId);      // ← 여기서 소유자가 정해진다
```

**근거**

`addDevice` 의 검사는 하나뿐이다 — "이미 주인이 있는가". 없으면 호출자의 것이 된다.

| 확인 항목 | 검증 여부 |
|---|---|
| 요청자가 로그인 상태인가 | O (`@AuthenticationPrincipal`) |
| 해당 단말에 이미 주인이 있는가 | O |
| **버튼 누름(pushbutton)이 실제로 있었는가** | **X** |
| **그 pushbutton 이 이 사용자의 요청에 대한 것인가** | **X** |
| 등록 대기 상태(reg)에 있는 단말인가 | X |

즉 **devicereg 서버를 거치지 않고 api 서버를 직접 호출해도 등록이 된다.** 시리얼은 단말 라벨·박스·앱 화면에 노출되는 값이므로 비밀이 아니다.

**운영에서 터지는 시나리오**

- 아직 등록되지 않은 단말의 시리얼을 아는 사람(판매점 직원, 배송 과정에서 박스를 본 사람, 차량 정비소, 중고 매물 사진)이 자기 계정으로 먼저 등록해 버릴 수 있다. 정품 구매자는 이후 "이미 등록된 단말"이라는 오류를 만난다.
- 등록을 선점당한 사용자를 구제하려면 운영자가 수동으로 소유권을 옮겨야 한다. **그 과정 자체가 또 다른 사회공학 공격 표면이 된다.**
- 시리얼 형식이 규칙적이라면(모델 접두어 + 순번) 대량 선점도 가능하다. 실제 형식 확인이 필요하다.

**해결 시나리오**

1단계 — **먼저 실제 시리얼 형식과 미등록 단말 수를 확인한다.** 위험도가 형식의 예측 가능성에 달려 있다.

```sql
SELECT COUNT(*) FROM md_device WHERE ua_id IS NULL;          -- 선점 가능한 단말 수
SELECT serial FROM md_device ORDER BY created_dtm DESC LIMIT 20;   -- 형식 규칙성 확인
```

2단계 — 등록 티켓을 도입해 두 서버를 연결한다. **devicereg 가 확인한 사실을 api 서버가 신뢰할 수 있는 형태로 전달하는 것이 핵심이다.**

```
1. devicereg 가 pushbutton 수신 → 등록 티켓 발급
     키: registration:ticket:{랜덤값}
     값: {serial, 발급시각}
     TTL: 5분, 1회용
2. 티켓을 WebSocket 으로 앱에 전달
3. 앱이 POST /devices/usage 에 티켓을 함께 전송
4. api 서버가 티켓을 소비(getAndDelete)하고 serial 일치를 확인한 뒤에만 바인딩
```

티켓 저장소는 두 서버가 함께 보는 Redis 여야 한다. **api 서버의 `AppRedisClient` 구현체가 현재 인메모리라는 점을 먼저 해결해야 한다**(api 서버 문서 §4.2). 그 전에 도입하면 티켓이 다른 인스턴스에서 조회되지 않아 등록이 실패한다.

3단계 — 과도기 처리. 티켓 검증을 바로 강제하면 구버전 앱이 전부 등록 불가가 된다.

```
1차 배포: 티켓이 있으면 검증, 없으면 통과 + "티켓 없음" 지표 기록
2차 배포: 지표가 0에 수렴하면 티켓 필수로 전환
```

**지표가 0으로 떨어지지 않으면 티켓 없이 등록하는 경로가 남아 있다는 뜻이므로, 강제 전환 전에 반드시 원인을 찾아야 한다.**

4단계 — 보조 방어. 티켓 도입 전까지 쓸 수 있는 완화책이다.

```
[ ] 계정당 등록 시도 횟수 제한 (실패 포함)
[ ] 짧은 시간에 여러 시리얼 등록 시도 → 탐지·차단
[ ] 등록 발생 시 단말 이력에 요청 IP·시각 기록 (사후 추적용)
```

**검증**

- devicereg 를 거치지 않고 api 서버만 직접 호출 → 조치 후에는 400/403
- 정상 앱 등록 플로우가 그대로 동작하는지 (회귀)

---

### 3.2 WebSocket 엔드포인트에 인증이 없다

**현상**

```java
// WebSocketConfig.java:17-20
registry.addHandler(socketHandler, "/ncnRegist")
        .setAllowedOrigins("*");
```

`build.gradle` 에 `spring-boot-starter-security` 가 없다. 핸드셰이크 인터셉터도 없다. **접속에 아무 조건이 없다.**

**근거 — 두 가지 악용 경로**

**(1) 임의 단말을 등록 대기 모드로 진입시킬 수 있다**

```java
// SocketHandler.java:41-52 — 요청자 확인 없이 시리얼만 보고 명령을 발행한다
String serial = webSocketMessage.header().serial();
...
if (SEND.equals(type)) {
    boolean isDeviceConnected = nanoMqClientService.checkDeviceConnection(serial);
    if (isDeviceConnected) {
        String topic = "server/" + serial + "/command";
        JsonNode data = objectMapper.valueToTree(Map.of("type", "reg", "timeout", 30));
        mqttGateway.sendToMqtt(mqttMessageString, topic);
```

임의의 시리얼로 반복 호출하면 해당 단말이 계속 등록 대기 모드로 들어간다. 단말이 그 상태에서 어떤 동작을 하는지(LED 점멸, 안내음, 다른 기능 중단)는 펌웨어 확인이 필요하지만, **소유자가 의도하지 않은 상태 변화를 외부에서 유발할 수 있다는 사실 자체가 문제다.**

**(2) 등록 성공 통지를 가로챌 수 있다**

```java
// WebSocketSessionRegistry.java:18-27 — 나중에 등록한 쪽이 이긴다
public void register(String serial, WebSocketSession session) {
    WebSocketSession existing = sessionMap.get(serial);
    if (existing != null && existing.getId().equals(session.getId())) {
        return;
    }
    sessionMap.put(serial, session);      // ← 기존 세션을 조건 없이 덮어쓴다
```

공격자가 피해자의 시리얼로 메시지를 보내면 세션 맵이 공격자 것으로 바뀐다. 이후 피해자가 버튼을 눌러도 `successRegist` 는 **공격자에게 간다.** 피해자의 앱은 아무 응답 없이 타임아웃된다.

§3.1 의 티켓 방식을 도입하면 이 경로가 곧 **등록 티켓 탈취**가 되므로, 두 조치는 반드시 함께 가야 한다. **티켓만 도입하고 WebSocket 인증을 방치하면 보안 수준이 오히려 나빠진다** — 지금은 강제력 없는 절차지만, 그때는 강제력 있는 절차를 공격자가 통과하게 된다.

**해결 시나리오**

1단계 — 핸드셰이크에서 JWT 를 검증한다.

```java
@Override
public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
    registry.addHandler(socketHandler, "/ncnRegist")
            .addInterceptors(jwtHandshakeInterceptor)     // 토큰 없으면 핸드셰이크 거부
            .setAllowedOrigins(allowedOrigins);           // 설정값 화이트리스트
}
```

```java
public class JwtHandshakeInterceptor implements HandshakeInterceptor {
    @Override
    public boolean beforeHandshake(ServerHttpRequest request, ServerHttpResponse response,
                                   WebSocketHandler handler, Map<String, Object> attributes) {
        long uaId = jwtTokenExtractor.extract(request);   // 실패 시 예외
        attributes.put("uaId", uaId);                     // 이후 세션에서 참조
        return true;
    }
}
```

WebSocket 핸드셰이크는 일반 HTTP 요청이므로 헤더를 실을 수 있다. 앱이 헤더를 못 싣는 환경이면 쿼리 파라미터로 단기 토큰을 받는다.

2단계 — 세션 등록을 소유자 기준으로 제한한다. 인증만으로는 부족하다. **로그인한 다른 사용자가 남의 시리얼을 쓰는 것을 막아야 한다.**

```java
// 미등록 단말이면 등록 시도 자체는 허용하되, 세션 키를 uaId 와 묶는다
sessionRegistry.register(uaId + ":" + serial, session);
```

이러면 세션 덮어쓰기가 같은 사용자 안에서만 일어난다. 이미 주인이 있는 단말이면 소유자 본인인지 확인한다.

3단계 — `setAllowedOrigins("*")` 를 화이트리스트로 바꾼다. WebSocket 은 동일 출처 정책이 적용되지 않으므로 **서버가 오리진을 검사하지 않으면 임의 웹페이지가 사용자 브라우저를 통해 접속할 수 있다.**

**검증**

```bash
# 토큰 없이 접속 시도 → 핸드셰이크 거부
wscat -c wss://<devicereg>/deviceRegist/ncnRegist
# 타인 시리얼로 send → 거부
```

---

### 3.3 인스턴스를 2대로 늘리면 등록이 절반 실패한다

**현상**

MQTT 구독은 공유 구독이다. **여러 인스턴스 중 하나만 메시지를 받는다.**

```java
// MqttConfig.java:90-93
// 중요: $share/그룹명/토픽명
// 이렇게 설정하면 'my-group'에 속한 서버들 중 하나만 메시지를 받음 (로드밸런싱)
String sharedPushButton = "$share/backend-group/" + PUSH_BUTTON;
```

그런데 WebSocket 세션은 인스턴스 로컬 메모리에 있다.

```java
// WebSocketSessionRegistry.java:13
private final ConcurrentHashMap<String, WebSocketSession> sessionMap = new ConcurrentHashMap<>();
```

**근거**

두 상태가 서로 다른 인스턴스에 있으면 연결되지 않는다.

```
앱 → ALB → 인스턴스 A 에 WebSocket 연결   (세션은 A 에만 존재)
단말 → 브로커 → 공유 구독으로 인스턴스 B 가 pushbutton 수신
인스턴스 B: sessionRegistry.getSession(serial) → null
           → log.warn("[MQTT→WS] 세션 없음 또는 닫힘")
           → 그대로 종료
```

앱은 아무 응답도 받지 못하고 타임아웃된다. **사용자에게는 "버튼을 눌렀는데 등록이 안 됐다"로 보인다.** 인스턴스 2대면 확률적으로 약 절반이 실패한다.

주석이 "핵심: Scale-Out 대응"이라고 적혀 있는 부분이 **정확히 스케일아웃을 깨뜨리는 지점**이라는 점이 이 문제의 성격을 보여준다. 공유 구독 자체는 옳은 선택이다. device 서버처럼 **수신 후 DB에만 쓰는 상태 없는 처리**에서는 그렇다. 여기는 수신 결과를 특정 인스턴스가 들고 있는 연결로 되돌려줘야 하므로 전제가 다르다.

**운영에서 터지는 시나리오**

- 지금 1대로 운영 중이라면 문제가 드러나지 않는다. **트래픽이 늘어 증설하는 순간, 아무 코드 변경 없이 등록 성공률이 떨어진다.** 원인을 배포나 앱 변경에서 찾게 되어 진단이 오래 걸린다.
- 무중단 배포로 신구 인스턴스가 함께 떠 있는 짧은 시간에도 같은 현상이 생긴다. 배포할 때마다 소수의 등록이 실패한다.
- 실패가 `log.warn` 한 줄로만 남고 지표가 없어, **실패하고 있다는 사실 자체를 알 수 없다.**

**해결 시나리오**

세 가지 방법이 있고, 상황에 따라 선택이 다르다.

| 방법 | 방식 | 적합한 상황 |
|---|---|---|
| A. 공유 구독 해제 | 모든 인스턴스가 전부 수신, 세션 있는 곳만 처리 | **지금 당장 적용 가능. 가장 단순** |
| B. Redis 로 세션 라우팅 | 수신 인스턴스가 Redis 로 재발행, 세션 보유 인스턴스가 전달 | 인스턴스가 많아질 때 |
| C. 세션 어피니티 | 시리얼 기준으로 같은 인스턴스에 고정 | ALB 만으로는 구현이 어렵다 |

**A 를 권한다.** pushbutton 은 등록 순간에만 발생하는 저빈도 이벤트라 전량 수신해도 부담이 없다. 처리 조건도 이미 코드에 있다.

```java
// MqttConfig
String pushButtonTopic = PUSH_BUTTON;      // $share/ 접두어 제거 — 전 인스턴스가 수신
```

```java
// MqttService.sendToWebSocket — 세션 없으면 조용히 넘어가는 현재 동작이 그대로 정답이 된다
WebSocketSession session = sessionRegistry.getSession(serial);
if (session == null || !session.isOpen()) {
    return;      // 내 인스턴스 담당이 아님
}
```

**공유 구독을 쓸 때는 "세션 없음"이 오류였지만, 전량 수신에서는 정상 상태가 된다.** 따라서 로그 레벨도 warn 에서 debug 로 낮춰야 한다.

B 로 간다면 api 서버·device 서버와 같은 Redis 를 쓰되, 그 전에 api 서버의 인메모리 구현체 문제를 먼저 해결해야 한다.

**어느 쪽을 택하든 지표가 먼저다.** 지금은 실패를 셀 수 없다.

```
[ ] pushbutton 수신 건수
[ ] WebSocket 전달 성공 건수
[ ] 두 값의 차이 = 유실 건수  ← 이것이 알람 대상
```

**검증**

- 인스턴스 2대 기동 후 등록 20회 반복 → 전건 성공
- 수신 건수와 전달 성공 건수가 일치하는지

---

### 3.4 세 서버가 서로 다른 "운영 DB" 를 바라본다

**현상**

devicereg prod 는 또 다른 값이다.

```yaml
# vueroid-web-devicereg — prod
url: jdbc:log4jdbc:postgresql://HOST-B:5432/vwc_prod?ApplicationName=deviceRegProd
```

**근거 — 네 프로젝트의 prod DB 대조**

| 서버 | prod 접속 대상 |
|---|---|
| `vueroid-web-api` | `HOST-A:5432/d21` |
| `vueroid-web-api-device` | `HOST-B:5432/vwc_dev` |
| `vueroid-web-api-media` | `HOST-B:5432/vwc_dev` |
| `vueroid-web-devicereg` | `HOST-B:5432/vwc_prod` |

**세 개의 서로 다른 값이 나온다.** 이 서버들은 같은 `md_device`, `dv_file`, `ua_user` 테이블을 공유해야 한다.

devicereg 는 그나마 `vwc_prod` 라는 이름을 쓰지만, **호스트가 다른 서버들의 개발 DB 와 같은 `HOST-B`** 이다. api 서버가 쓰는 `HOST-A` 이 아니다. `vwc_prod` 데이터베이스가 그 호스트에 실제로 존재하는지부터 확인해야 한다. 없으면 기동 자체가 실패한다.

**이것이 세 프로젝트에서 반복된 문제의 결정판이다.** 개별 오타가 아니라, **접속 정보를 각 프로젝트의 yml 에 직접 적고 프로파일 블록을 복사해 늘려가는 방식이 만들어낸 결과**다. 어느 값이 맞는지 판단할 단일 기준이 없다.

**운영에서 터지는 시나리오**

devicereg 는 DB 를 실제로 거의 쓰지 않는다(MyBatis 설정은 있으나 매퍼 XML 이 없다). 그래서 **잘못된 DB 를 봐도 증상이 늦게 나타난다.** 기동은 되고 WebSocket·MQTT 는 동작한다. 나중에 DB 조회 기능이 추가되는 순간 조용히 잘못된 데이터를 읽기 시작한다.

**해결 시나리오**

1단계 — **네 서버가 각각 어디에 붙고 있는지부터 확인한다.** 이것이 다른 모든 조치보다 앞선다.

```sql
SELECT datname, application_name, client_addr, count(*)
FROM pg_stat_activity
WHERE application_name IN ('ncnApi','ncnMedia','deviceApi','deviceRegProd')
GROUP BY 1,2,3
ORDER BY 1,2;
```

2단계 — 운영 DB 의 단일 기준을 문서로 확정한다. 코드를 고치기 전에 **"운영 DB 는 무엇인가"에 대한 답이 하나여야 한다.**

3단계 — 네 프로젝트 모두 환경변수 주입으로 전환한다. 값이 코드에 없으면 복사로 번지지 않는다.

```yaml
url: jdbc:postgresql://${DB_HOST}:${DB_PORT}/${DB_NAME}?ApplicationName=deviceReg
username: ${DB_USERNAME}
password: ${DB_PASSWORD}
```

4단계 — 기동 시 가드를 넣는다(device 서버 문서 §3.2 와 동일). **네 프로젝트에 같은 코드를 넣어야 하므로 공용 모듈로 만드는 편이 낫다.**

5단계 — devicereg 는 DB 를 실제로 쓰는지 재검토한다. 매퍼가 없다면 `spring-boot-starter-data-jpa` 와 datasource 설정을 통째로 제거하는 것이 가장 확실하다. **쓰지 않는 연결은 오설정의 여지만 남긴다.**

---

### 3.5 Actuator 가 전 프로파일에서 전부 노출된다

**현상**

test / dev / stage / prod **네 프로파일 모두** 같은 설정을 갖고 있다.

```yaml
management:
  server:
    port: 7090            # prod
  endpoints:
    web:
      base-path: "/actuator/reg"
      exposure:
        include: "*"
        exclude: "env,beans"
```

**근거**

api 서버와 같은 문제이며, **여기가 더 나쁘다.**

- 시큐리티 의존성이 아예 없어 관리 포트든 서비스 포트든 인증 계층이 존재하지 않는다
- `include: "*"` 로 `heapdump`, `threaddump`, `configprops`, `loggers`, `mappings` 가 열린다
- `env`, `beans` 만 제외했으나 `configprops` 에도 설정값이 나온다

`shutdown` 은 기본 비활성이라 api 서버보다 한 단계 낫지만, `heapdump` 는 **힙 전체를 파일로 내려준다.** 이 서버 힙에는 WebSocket 세션 정보와 단말 시리얼이 들어 있다.

**해결 시나리오**

api 서버 문서 §3.3 과 동일하다.

```yaml
management:
  endpoints:
    web:
      exposure:
        include: "health,info,metrics,prometheus"   # 화이트리스트
  server:
    port: 7090
    address: 127.0.0.1                              # 루프백 바인딩
```

**네 프로젝트가 같은 형태이므로 한 번에 정리한다.** 프로파일마다 블록을 반복하지 말고 공통 블록에 한 번만 정의하는 편이 실수를 줄인다.

---

### 3.6 자격증명이 형상관리에 평문으로 있다

DB 계정, MQTT 브로커 계정이 `application.yml` 에 있고, 브로커 관리 API 계정은 소스에 하드코딩되어 있다.

```java
// NanoMqClientService.java:18
.defaultHeaders(headers -> headers.setBasicAuth("ncn", "P@ssword1!"))
```

**device 서버·api 서버와 완전히 동일한 값이다.** 세 프로젝트에 같은 브로커 계정이 하드코딩되어 있으므로, 교체 시 세 곳을 함께 바꿔야 한다. 한 곳이라도 빠지면 그 서버만 브로커 접속에 실패한다.

조치는 api 서버 문서 §3.1 과 동일하며, **네 프로젝트를 하나의 작업으로 묶어 진행한다.** 순서는 다음과 같다.

```
1. 네 프로젝트 모두 환경변수 참조로 변경 + 배포 (값은 아직 기존과 동일)
2. 브로커/DB 계정 교체 + 환경변수만 갱신
3. 재배포 없이 값만 바뀌므로 롤백도 값 되돌리기로 끝난다
```

**코드와 값을 분리한 뒤에 교체해야 안전하다.** 지금 상태에서 교체하면 네 프로젝트를 동시에 재배포해야 한다.

---

## 4. P1 — 안정성

### 4.1 브로커 REST 호출에 타임아웃이 없다

**현상**

```java
// NanoMqClientService.java:14-20
public NanoMqClientService(RestClient.Builder restClientBuilder) {
    this.restClient = restClientBuilder
            .baseUrl("http://wifinlb.vueroid-cloud.com:8888")
            .defaultHeaders(headers -> headers.setBasicAuth("ncn", "P@ssword1!"))
            .build();                      // ← 타임아웃 설정이 없다
}
```

**근거**

**같은 클래스가 api 서버에도 있고, 그쪽은 이미 고쳐져 있다.** 수정 이유까지 주석으로 남아 있다.

```java
// vueroid-web-api / NanoMqClientService.java:18-22
// 타임아웃 미설정 시 응답 없는 브로커/프록시에서 호출 스레드가 무한 대기 (catch도 작동 못 함)
SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
factory.setConnectTimeout(Duration.ofSeconds(5));
factory.setReadTimeout(Duration.ofSeconds(10));
```

**devicereg 만 이 수정이 반영되지 않았다.** `NanoMqClientService` 는 api 와 devicereg 두 프로젝트에 복제되어 있고, 그중 한 곳만 고쳐진 상태다. api 프로젝트는 같은 교훈을 `WebMvcConfig.restTemplate()` 에도 적용해 두었다 — **한 프로젝트 안에서는 두 번 반영된 수정이 다른 프로젝트로는 넘어오지 않았다.**

주석이 지적한 대로, 타임아웃이 없으면 `catch (Exception e)` 가 작동하지 못한다. 예외가 발생하지 않고 그냥 기다리기 때문이다.

이 메서드는 두 경로에서 호출된다.

```java
// SocketHandler.java:43 — WebSocket 메시지 처리 스레드
boolean isDeviceConnected = nanoMqClientService.checkDeviceConnection(serial);

// DeviceController.java:17 — 인증 없는 HTTP 엔드포인트 (§4.3)
```

**운영에서 터지는 시나리오**

브로커나 그 앞단 프록시가 응답하지 않으면 호출 스레드가 무한정 묶인다. WebSocket 처리 스레드가 소진되면 **등록 요청 전체가 멈춘다.** 브로커 자체는 살아 있는데 관리 API 만 느린 경우에도 같은 일이 생긴다.

`/device/check/{serial}` 은 인증이 없으므로, 브로커 관리 API 가 느려진 상태에서 이 엔드포인트를 반복 호출하면 톰캣 스레드를 고갈시킬 수 있다.

**해결 시나리오**

1단계 — api 프로젝트와 동일하게 맞춘다.

```java
SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
factory.setConnectTimeout(Duration.ofSeconds(2));
factory.setReadTimeout(Duration.ofSeconds(3));
```

**등록 플로우는 사용자가 앱 화면에서 기다리는 상황이므로 api 서버보다 짧게 잡는 것이 맞다.** 3초 안에 답이 없으면 "단말 상태를 확인할 수 없습니다"로 안내하는 편이 낫다.

2단계 — 같은 클래스가 두 프로젝트에 복제된 구조 자체를 정리한다. 공용 모듈로 빼거나, 최소한 **한 곳을 고치면 나머지도 확인하도록 체크리스트를 남긴다.** 이번처럼 조용히 어긋나는 일이 반복된다.

3단계 — 브로커 확인 실패와 단말 오프라인을 구분한다. 현재는 둘 다 `false` 다.

```java
// 지금: 브로커 장애도 "단말이 연결되어있지 않음" 으로 안내된다
WebSocketHeader header = new WebSocketHeader("server", "send", serial, 400, "단말이 브로커에 연결되어있지 않음.");
```

사용자는 단말 전원을 확인하러 가지만 원인은 서버 쪽이다. **잘못된 안내는 문의를 늘린다.**

**검증**

- 브로커 관리 API 포트를 차단한 상태에서 등록 시도 → 3초 내 오류 응답
- 그 상태에서 WebSocket 스레드가 회수되는지

---

### 4.2 세션 레지스트리가 메모리를 누수한다

**현상**

```java
// WebSocketSessionRegistry.java:18-27
public void register(String serial, WebSocketSession session) {
    ...
    sessionMap.put(serial, session);
    sessionIdToSerial.put(session.getId(), serial);      // ← 세션당 serial 하나만 기록
}

// WebSocketSessionRegistry.java:29-35
public void unregisterBySessionId(String sessionId) {
    String serial = sessionIdToSerial.remove(sessionId);
    if (serial != null) {
        sessionMap.remove(serial);                      // ← 마지막 serial 만 정리된다
    }
}
```

**근거**

`register` 는 **모든 메시지마다 호출된다.**

```java
// SocketHandler.java:39 — type 과 무관하게 무조건 실행
sessionRegistry.register(serial, session);
```

한 세션이 여러 시리얼로 메시지를 보내면 `sessionMap` 에는 항목이 여러 개 생기지만, `sessionIdToSerial` 에는 **마지막 시리얼만 남는다.** 연결이 끊길 때 그 하나만 제거되고 **나머지는 영구히 남는다.**

닫힌 `WebSocketSession` 객체가 계속 참조되므로 그에 딸린 버퍼까지 함께 잔존한다.

정상 앱은 한 세션에서 한 시리얼만 다룰 가능성이 높아 평소에는 드러나지 않는다. 그러나 §3.2 의 인증 부재와 결합하면 **의도적으로 누수를 유발할 수 있다.** 한 연결에서 시리얼을 바꿔가며 메시지를 보내면 항목이 무제한 쌓인다.

**해결 시나리오**

1단계 — 역방향 매핑을 다대일로 바꾼다.

```java
private final ConcurrentHashMap<String, Set<String>> sessionIdToSerials = new ConcurrentHashMap<>();

public void register(String serial, WebSocketSession session) {
    sessionMap.put(serial, session);
    sessionIdToSerials.computeIfAbsent(session.getId(), k -> ConcurrentHashMap.newKeySet()).add(serial);
}

public void unregisterBySessionId(String sessionId) {
    Set<String> serials = sessionIdToSerials.remove(sessionId);
    if (serials == null) return;
    for (String serial : serials) {
        sessionMap.remove(serial, sessionMap.get(serial));   // 다른 세션이 차지했으면 건드리지 않는다
    }
}
```

2단계 — `register` 호출 위치를 옮긴다. 등록이 필요한 것은 `send` 처리 시점뿐이다. **모든 메시지마다 등록할 이유가 없다.**

3단계 — 세션당 시리얼 수에 상한을 둔다. 정상 사용에서 1을 넘을 일이 없다면 2 이상은 거부한다.

4단계 — 맵 크기를 지표로 노출한다. **누수는 지표가 없으면 OOM 이 날 때까지 보이지 않는다.** 동시 접속 앱 수와 맵 크기가 비슷해야 정상이다.

**검증**

- 한 연결에서 시리얼 100개로 메시지 전송 후 연결 종료 → 맵 크기가 0으로 돌아오는지
- 장시간 운영 후 맵 크기가 동시 접속 수 수준을 유지하는지

---

### 4.3 단말 온라인 여부를 인증 없이 조회할 수 있다

**현상**

```java
// DeviceController.java:15-19
@GetMapping("/device/check/{serial}")
public ResponseEntity<Boolean> checkDeviceConnection(@PathVariable String serial) {
    boolean isConnected = nanoMqClientService.checkDeviceConnection(serial);
    return ResponseEntity.ok(isConnected);
}
```

**근거**

인증도 소유권 검사도 없다. 시리얼만 있으면 **그 단말이 지금 온라인인지 알 수 있다.**

블랙박스의 온라인 여부는 사실상 **차량의 시동/주차 상태**다. 반복 조회하면 특정 차량의 운행 패턴을 원격에서 관찰할 수 있다. 위치는 아니지만 생활 패턴 정보다.

호출 비용도 문제다. 요청마다 브로커 관리 API 를 호출하므로 **캐시나 레이트리밋 없이 외부 시스템에 부하를 전가한다.** §4.1 의 타임아웃 부재와 겹치면 이 엔드포인트 하나로 서버를 묶어둘 수 있다.

**해결 시나리오**

1단계 — **이 엔드포인트가 실제로 쓰이는지 확인한다.** WebSocket 핸들러가 내부적으로 같은 검사를 하므로, 외부 노출이 필요 없을 가능성이 있다.

```bash
grep '/deviceRegist/device/check/' <액세스로그> | wc -l
```

2단계 — 쓰이지 않으면 삭제한다. 쓰인다면 인증 + 소유권 검사를 붙인다.

```java
@GetMapping("/device/check/{serial}")
public ResponseEntity<Boolean> checkDeviceConnection(
        @RequestHeader("Authorization") String token, @PathVariable String serial) {
    long uaId = jwtTokenExtractor.extractUaId(token);
    // 미등록 단말이면 등록 과정 중일 수 있으므로 허용, 등록된 단말이면 소유자만
    ...
}
```

3단계 — 짧은 캐시(수 초)와 레이트리밋을 둔다. 등록 과정에서 연속 호출되는 성격이므로 캐시 효과가 크다.

**검증**

- 인증 없이 호출 → 401
- 타인 소유 단말 시리얼로 호출 → 403

---

## 5. P2 — 정리 대상

### 5.1 토픽 파싱이 예외 처리 밖에 있다

```java
// MqttService.java:28-31
public void handleMessage(@Payload String payload, @Header(MqttHeaders.RECEIVED_TOPIC) String topic) {
    String prefix = topic.split("/")[2];      // ← try 블록 밖
    log.info("topic : {}", topic);
    ...
    try {
```

구독 토픽이 `device/+/pushbutton` 3단계라 정상 상황에서는 문제가 없다. 그러나 브로커 설정 변경이나 토픽 추가로 3단계 미만 메시지가 들어오면 `ArrayIndexOutOfBoundsException` 이 아래 `catch` 에 잡히지 않고 Spring Integration 으로 전파된다.

조치 방향: 파싱을 `try` 안으로 옮기고 길이를 확인한다.

```java
try {
    String[] levels = topic.split("/");
    if (levels.length < 3) {
        log.warn("[MQTT] 예상치 못한 토픽 형식: {}", topic);
        return;
    }
    String prefix = levels[2];
```

로그 두 줄(`log.info("topic")`, `log.info("prefix")`)도 정리 대상이다. 등록은 저빈도 이벤트라 부담은 없지만, 같은 내용을 두 번 남길 이유가 없다.

### 5.2 WebSocket 에 유휴 타임아웃·크기 제한이 없다

`WebSocketConfig` 에 세션 제한 설정이 없어 컨테이너 기본값을 따른다.

- 유휴 타임아웃이 없으면 **끊긴 것을 서버가 모르는 반열림(half-open) 연결이 누적된다.** 모바일 네트워크에서 흔한 상황이다.
- 메시지 크기 제한이 없으면 대용량 텍스트 프레임으로 힙을 압박할 수 있다(§3.2 의 인증 부재와 결합).
- 하트비트(ping/pong)가 없어 연결 생존 확인 수단이 없다.

조치 방향:

```java
@Bean
public ServletServerContainerFactoryBean createWebSocketContainer() {
    ServletServerContainerFactoryBean container = new ServletServerContainerFactoryBean();
    container.setMaxTextMessageBufferSize(8 * 1024);        // 등록 메시지는 수백 바이트면 충분
    container.setMaxSessionIdleTimeout(120_000L);           // 2분 무응답 시 정리
    return container;
}
```

등록 플로우는 30초 타임아웃이므로 세션이 오래 살아 있을 이유가 없다. **연결 수 상한도 함께 검토한다.**

### 5.3 입력 검증이 없다

```java
// SocketHandler.java:36-38
WebSocketMessage webSocketMessage = objectMapper.readValue(message.getPayload(), WebSocketMessage.class);
String serial = webSocketMessage.header().serial();     // header 가 null 이면 NPE
```

`header` 가 없거나 JSON 이 깨지면 예외가 나고 `handleTextMessage` 가 `throws Exception` 이므로 연결이 끊긴다. 클라이언트는 이유를 알 수 없다.

`serial` 형식 검증도 없어 그대로 MQTT 토픽에 들어간다.

```java
String topic = "server/" + serial + "/command";      // serial 에 / 나 + 가 들어가면 토픽 구조가 바뀐다
```

**시리얼에 `/` 를 넣으면 의도하지 않은 토픽으로 발행된다.** 브로커 ACL 이 막아줄 가능성이 높지만, 애플리케이션에서도 막아야 한다.

조치 방향:

```java
private static final Pattern SERIAL_PATTERN = Pattern.compile("[A-Z0-9]{4}(-[A-Z0-9]{4}){3,}");

if (header == null || serial == null || !SERIAL_PATTERN.matcher(serial).matches()) {
    sendError(session, 400, "잘못된 요청 형식");
    return;
}
```

실제 시리얼 형식을 확인해 패턴을 맞춘다. 예외로 연결을 끊는 대신 오류 메시지를 보내고 연결을 유지하는 편이 클라이언트 구현에 낫다.

### 5.4 커넥션 풀이 유휴 시에도 10개를 점유한다

```yaml
spring.datasource.hikari:
  maximum-pool-size: 10
  minimum-idle: 10        # ← 최대치와 동일
```

media 서버와 같은 문제다. api 서버는 이미 2로 낮췄고 그 이력이 주석으로 남아 있는데, **devicereg 와 media 에는 반영되지 않았다.**

이 서버는 특히 문제다. **매퍼 XML 이 없어 DB 를 실제로 쓰지 않는데도 커넥션 10개를 상시 점유한다.** §3.4 5단계에서 언급한 대로, DB 의존성 자체를 제거하는 것이 가장 깔끔하다.

### 5.5 로그 보존 2일 / 운영 DataSource 가 log4jdbc 경유

네 프로젝트 공통 문제다. `maxHistory 2`, `totalSizeCap 500MB` 이고 전 프로파일이 `DriverSpy` 를 쓴다. 로그 레벨은 `info` 로 device 서버(`debug`)보다 낫다.

**DB 를 쓰지 않는 이 서버에서 log4jdbc 는 특히 무의미하다.** §5.4 와 함께 정리한다.

### 5.6 공유 구독 그룹명을 서비스 간에 공유한다

device 서버와 devicereg 가 같은 그룹명 `backend-group` 을 쓴다.

```java
// device 서버
"$share/backend-group/device/+/report", "$share/backend-group/device/+/reportThumbnail"
// devicereg
"$share/backend-group/device/+/pushbutton"
```

MQTT 공유 구독은 **(그룹명 + 토픽 필터)** 조합으로 그룹을 식별하므로, 토픽 필터가 다른 현재는 충돌하지 않는다.

문제는 앞으로다. **어느 한 서비스가 다른 서비스와 같은 토픽 필터를 같은 그룹명으로 구독하는 순간, 메시지가 두 서비스로 나뉘어 배달된다.** 각각 절반씩만 받으므로 "가끔 처리가 안 된다"로 나타나고, 원인 파악이 매우 어렵다.

조치 방향: 그룹명을 서비스별로 분리한다.

```
device 서버   : $share/device-report-group/...
devicereg     : $share/devicereg-pushbutton-group/...
```

§3.3 에서 devicereg 의 공유 구독을 해제하면 이 항목은 자연히 해소된다.

---

## 6. 조치 순서

| 단계 | 기간 | 항목 | 배포 리스크 |
|---|---|---|---|
| 0 | 즉시 | 네 서버 prod DB 접속 대상 확인(§3.4 1단계) — 쿼리 한 번 | 없음 |
| 1 | 즉시 | 미등록 단말 수·시리얼 형식 확인(§3.1 1단계) | 없음 — 위험도 판단용 |
| 2 | 1주 | 공유 구독 해제(§3.3), 브로커 호출 타임아웃(§4.1), Actuator 차단(§3.5) | 낮음 — 설정·한 줄 변경 |
| 3 | 1주 | pushbutton 수신/전달 지표 추가(§3.3), 세션 맵 크기 지표(§4.2) | 낮음 — **이후 조치의 검증 수단** |
| 4 | 2주 | WebSocket 인증·오리진 화이트리스트(§3.2), 세션 누수 수정(§4.2) | 중간 — 앱 연동 회귀 테스트 |
| 5 | 2주 | 자격증명 외부 주입(§3.6) — 네 프로젝트 동시 | 중간 |
| 6 | 3주 | 등록 티켓 도입(§3.1) — **api 서버 Redis 전환 이후** | 높음 — 구버전 앱 과도기 필요 |
| 7 | 상시 | 입력 검증(§5.3), WebSocket 제한(§5.2), DB 의존성 제거 검토(§5.4) | 낮음 |

**2단계에 공유 구독 해제를 둔 이유**: 한 줄 변경으로 스케일아웃 차단 요인이 사라진다. 투입 대비 효과가 가장 크다.

**6단계가 마지막인 이유**: 등록 티켓은 api 서버의 Redis 구현체 전환에 의존하고, 구버전 앱 과도기까지 필요하다. **그리고 §3.2 의 WebSocket 인증이 먼저 서 있지 않으면 티켓 도입이 오히려 위험하다** — 강제력 없는 절차를 강제력 있는 절차로 바꾸면서 그 절차를 공격자가 통과할 수 있게 되기 때문이다. 순서를 지켜야 한다.

---

## 7. 검증 체크리스트

```
[ ] 네 서버(ncnApi/ncnMedia/deviceApi/deviceRegProd)가 각각 올바른 DB에 연결
[ ] 인스턴스 2대에서 등록 20회 전건 성공
[ ] pushbutton 수신 건수와 WebSocket 전달 성공 건수 일치
[ ] 토큰 없이 WebSocket 접속 → 핸드셰이크 거부
[ ] 타인 시리얼로 send → 거부
[ ] 브로커 관리 API 차단 상태에서 3초 내 오류 응답, 스레드 회수
[ ] 한 연결에서 시리얼 100개 전송 후 종료 → 세션 맵 크기 0
[ ] /device/check 인증 없이 호출 → 401
[ ] 관리 포트 외부 도달 불가
[ ] devicereg 를 거치지 않고 api 직접 호출로 등록 → 차단 (티켓 도입 후)
```

---

## 8. 경력기술서용 요약

**1) 단말 등록 플로우의 신뢰 모델 재설계**
> WebSocket 중계 서버가 물리 버튼 누름으로 단말 소유를 증명하는 절차를 수행하지만, 실제 소유권을 기록하는 API 서버가 그 결과를 검증하지 않아 시리얼만 알면 미등록 단말을 임의 계정에 귀속시킬 수 있는 구조적 결함을 발견. 공유 저장소 기반 1회용 등록 티켓을 도입해 두 서버 사이의 검증 사슬을 연결하고, 구버전 클라이언트를 위한 관측 후 강제 전환 2단계 배포 절차를 설계.

**2) 스케일아웃 불가 원인 규명 — 상태와 메시지 라우팅의 불일치**
> MQTT 공유 구독(인스턴스 1대만 수신)과 인스턴스 로컬 WebSocket 세션 맵이 결합되어, 인스턴스를 증설하는 순간 단말 등록이 확률적으로 실패하고 그 실패가 경고 로그로만 남아 관측되지 않는 구조를 규명. 저빈도 이벤트 특성에 맞춰 공유 구독을 전량 수신으로 전환하는 최소 변경 해법을 적용하고, 수신 건수와 전달 성공 건수의 차이를 유실 지표로 노출해 동일 유형의 문제를 사전 감지 가능하도록 개선.

**3) 프로젝트 간 설정 표류 및 수정 누락 식별**
> 4개 서비스의 운영 DB 접속 대상이 세 가지로 갈라져 있고, 다른 두 프로젝트에서 이미 수정된 HTTP 타임아웃 누락이 이 프로젝트에만 남아 있는 등, 코드 복제 기반 관리 방식이 만들어낸 표류를 식별. 접속 정보를 환경변수로 외부화하고 기동 시 프로파일·연결 대상 정합성 가드를 도입, 복제된 공용 클래스를 모듈화해 수정이 한 곳에서 전파되도록 정리.

**4) 인증 없는 실시간 채널 보안 강화**
> WebSocket 엔드포인트가 인증과 오리진 검사 없이 열려 있어 임의 단말을 등록 대기 모드로 진입시키고, 세션 레지스트리 덮어쓰기로 타인의 등록 완료 통지를 가로챌 수 있는 경로를 진단. 핸드셰이크 단계 JWT 검증, 사용자 식별자와 결합한 세션 키, 오리진 화이트리스트를 적용하고, 등록 티켓 도입보다 인증 강화가 선행되어야 하는 이유를 조치 순서에 반영.

**5) 메모리 누수 및 리소스 제한 정비**
> 세션 레지스트리의 역방향 매핑이 세션당 하나의 식별자만 보관해 다중 등록 시 항목이 영구 잔존하는 누수를 발견. 다대일 매핑으로 정정하고 세션당 상한과 맵 크기 지표를 추가, WebSocket 유휴 타임아웃·메시지 크기 제한을 명시해 반열림 연결과 대용량 프레임에 의한 리소스 고갈을 차단.

---

## 9. 관련 문서

| 문서 | 내용 |
|---|---|
| `docs/api-server-production-risks.md` | api 서버 리스크 — **등록 티켓은 §4.2 Redis 전환에 의존** |
| `docs/device-server-production-risks.md` | device 서버 리스크 — prod DB 오설정, 브로커 계정 공유 |
| `docs/media-server-production-risks.md` | media 서버 리스크 — prod DB 오설정, 커넥션 풀 설정 누락 |
| `docs/device-webhook-offline-miss.md` | 브로커 웹훅 유실 — 브로커 설정 변경 시 영향 범위 참고 |
