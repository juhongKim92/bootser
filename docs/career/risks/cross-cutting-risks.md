# 5개 서비스 공통 구조 문제 분석

- **작성일**: 2026-08-31
- **대상**: `vueroid-wifi-cloud-backend` 모노레포 전체 (api / device / media / devicereg / eventstream)
- **상태**: 분석 완료, 조치 미착수

---

## 1. 요약

다섯 서비스를 개별 분석한 결과, **같은 문제가 프로젝트를 옮겨 다니며 반복**되는 것이 확인됐다. 개별 문서가 각각 지적한 항목 중 상당수는 독립된 실수가 아니라 세 가지 구조적 원인에서 파생된 증상이다.

| 패턴 | 증상 | 파생된 개별 항목 수 |
|---|---|---|
| **A. 설정이 코드에 있고 복사로 번진다** | 운영 DB 가 네 갈래로 갈라짐, 자격증명 전량 커밋, 진단 수단 무력화 | 12 |
| **B. 수정이 프로젝트 간에 전파되지 않는다** | 한 곳에서 고친 문제가 다른 곳에 그대로 남음 | 9 |
| **C. 단말 인증 체계가 서비스 전체에 없다** | 단말 진입점 4개가 각각 다른 방식으로 무방비 | 7 |

중요한 점은 **세 패턴 모두 리포 안에 이미 올바른 사례가 존재한다**는 것이다. 원칙을 새로 도입하는 문제가 아니라, **한 곳에서 내린 판단이 나머지로 넘어가지 않는 문제**다. 이 차이가 조치 난이도를 크게 낮춘다.

| 패턴 | 이미 올바르게 되어 있는 곳 |
|---|---|
| 로그 설정 관리 | eventstream — `logback-spring.xml` 단일 파일, 보존 30일 |
| Actuator 노출 | device — prod 에서 `include: ""` 로 비활성 + 이유 주석 |
| 외부 호출 타임아웃 | api — `NanoMqClientService`, `RestTemplate` 양쪽 모두 |
| 커넥션 풀 유휴값 | api — `minimum-idle: 2` + 변경 이유 주석 |
| 경로 이탈 방어 | device — `ReceiveService.createThumbnailImage` 의 `startsWith` 검사 |
| 버퍼 수명 관리 | eventstream — `snapshotPacket` 의 명시적 복사 |

---

## 2. 패턴 A — 설정이 코드에 있고 복사로 번진다

### 2.1 운영 DB 가 네 갈래로 갈라져 있다

다섯 서비스는 `md_device`, `dv_file`, `ua_user` 등 **같은 테이블을 공유해야 한다.** 그런데 prod 프로파일이 가리키는 대상이 서로 다르다.

| 서버 | prod 접속 대상 | `ApplicationName` |
|---|---|---|
| `vueroid-web-api` | `HOST-A:5432/d21` | `ncnApi` |
| `vueroid-web-api-device` | `HOST-B:5432/**vwc_dev**` | `deviceApi` |
| `vueroid-web-api-media` | `HOST-B:5432/**vwc_dev**` | `ncnMedia` |
| `vueroid-web-devicereg` | `HOST-B:5432/vwc_prod` | `deviceRegProd` |
| `vueroid-web-eventstream` | `HOST-B:5432/**vwc_dev**` | **`ncnMedia`** ← 중복 |

세 종류의 서로 다른 값이 나오고, 그중 셋은 **개발 DB(`vwc_dev`)** 다.

**증상이 조합될 때 무슨 일이 벌어지는가**

- device 서버가 단말 상태를 `vwc_dev` 에 쓰고 api 서버는 `d21` 을 읽는다 → 앱에서 모든 단말이 영구 오프라인
- eventstream 이 영상 메타를 `vwc_dev` 에 쓰고 media 서버도 `vwc_dev` 를 본다 → 이 둘끼리는 맞지만, 앱(api 서버)에서는 영상이 보이지 않는다
- devicereg 는 혼자 `vwc_prod` 를 본다 → 그 DB 가 해당 호스트에 실제로 존재하는지부터 확인이 필요하다

**진단 수단까지 망가져 있다**

접속 대상을 확인하는 표준 방법은 `pg_stat_activity` 조회다.

```sql
SELECT datname, application_name, client_addr, count(*)
FROM pg_stat_activity
WHERE application_name IN ('ncnApi','ncnMedia','deviceApi','deviceRegProd')
GROUP BY 1,2,3
ORDER BY 1,2;
```

그런데 **eventstream 의 `ApplicationName` 이 `ncnMedia` 로 media 서버와 같다.** media 서버 yml 을 복사하면서 DB 도 이름표도 바꾸지 않았다. 위 쿼리의 `ncnMedia` 행에는 두 서비스가 섞여 나오고, `client_addr` 로만 구분해야 한다.

**즉 "어느 서버가 어디에 붙어 있는가"라는 가장 기초적인 질문에 답할 수 없는 상태다.** 이것이 다른 모든 조치보다 먼저 해결되어야 하는 이유다.

### 2.2 자격증명이 다섯 프로젝트에 흩어져 커밋되어 있다

| 자격증명 | 존재하는 프로젝트 |
|---|---|
| AWS Access Key / Secret (**전부 동일한 키**) | api, device, media, eventstream |
| DB 계정 (**전 환경 동일 비밀번호**) | 5개 전부 |
| MQTT 브로커 계정 | api, device, devicereg |
| 브로커 관리 API 계정 (소스 하드코딩) | api, devicereg |
| JWT 서명 시크릿 | api, media (동일 값), device (다른 값) |
| Apple / Google / Firebase 키 | api |
| DES 대칭키 `"testkey!"` | device |

**AWS 키 하나가 네 프로젝트에서 공유된다.** eventstream 은 `event/vod/` 하위에 쓰기만 하면 되고 media 는 한 버킷만 다루면 되는데, 둘 다 api 서버의 SES·KVS·전 리전 버킷 권한을 그대로 들고 있다. **어느 한 서버가 침해되면 피해가 나머지 전체로 번진다.**

브로커 계정은 더 까다롭다. 세 프로젝트에 흩어져 있고 그중 둘은 소스에 하드코딩되어 있으므로, **교체하려면 세 곳을 동시에 배포해야 한다.** 한 곳이라도 빠지면 그 서버만 브로커 접속에 실패한다.

### 2.3 근본 원인과 조치

세 증상 모두 **"값을 각 프로젝트의 `application.yml` 에 직접 적고, 새 환경이 필요하면 프로파일 블록을 복사한다"** 는 방식에서 나온다. 어느 값이 맞는지 판단할 단일 기준이 없으므로, 복사 시점에 틀려도 알 방법이 없다.

**1단계 — 현황 확정 (조치보다 먼저)**

```sql
-- 다섯 서버가 실제로 어디에 붙어 있는가
SELECT datname, application_name, client_addr, count(*)
FROM pg_stat_activity WHERE application_name IS NOT NULL
GROUP BY 1,2,3 ORDER BY 1,2;
```

```bash
# 각 인스턴스가 어느 프로파일로 떠 있는가
ps -ef | grep -o 'server.profile=[a-z]*'
```

**"운영 DB 는 무엇인가"에 대한 답이 하나로 정해지기 전에는 코드를 고칠 수 없다.**

**2단계 — 값을 코드 밖으로**

```yaml
# 다섯 프로젝트 공통 형태
spring:
  datasource:
    url: jdbc:postgresql://${DB_HOST}:${DB_PORT}/${DB_NAME}?ApplicationName=${spring.application.name}-${spring.profiles.active}
    username: ${DB_USERNAME}
    password: ${DB_PASSWORD}
```

`ApplicationName` 을 애플리케이션 이름에서 자동 생성하면 **손으로 적을 일이 없어져 중복이 재발하지 않는다.**

**3단계 — 기동 시 가드**

프로파일과 실제 접속 대상이 어긋나면 부팅을 중단시킨다. **다섯 프로젝트에 같은 코드가 필요하므로 공용 모듈로 만든다.**

```java
@Component @Profile("prod")
public class DataSourceGuard implements ApplicationRunner {
    public void run(ApplicationArguments args) throws Exception {
        try (Connection c = dataSource.getConnection()) {
            String db = c.getCatalog();
            if (db.contains("dev") || db.contains("test")) {
                throw new IllegalStateException("prod 프로파일이 비운영 DB에 연결됨: " + db);
            }
        }
    }
}
```

**4단계 — 자격증명 교체**

순서가 중요하다.

```
① 다섯 프로젝트를 환경변수 참조로 변경 + 배포 (값은 아직 기존과 동일 → 무해한 배포)
② AWS 키를 서비스별로 분리 발급, DB·브로커 계정 교체
③ 환경변수만 갱신 → 재배포 없이 반영, 롤백도 값 되돌리기로 끝
④ .gitignore·히스토리 정리·CI 시크릿 스캔(gitleaks) 추가
```

**코드와 값을 먼저 분리한 뒤에 교체해야 안전하다.** 지금 상태에서 키를 바꾸면 다섯 프로젝트를 동시에 재배포해야 한다.

---

## 3. 패턴 B — 수정이 프로젝트 간에 전파되지 않는다

같은 코드·같은 설정이 여러 프로젝트에 복제되어 있고, **한 곳에서 문제를 발견해 고쳐도 나머지는 그대로 남는다.** 고친 쪽에는 이유가 주석으로 남아 있어서, 판단이 있었다는 사실 자체는 확인된다.

### 3.1 확인된 사례

**① 외부 HTTP 호출 타임아웃**

`NanoMqClientService` 는 api 와 devicereg 두 프로젝트에 복제되어 있다.

```java
// vueroid-web-api — 고쳐져 있고 이유도 남아 있다
// 타임아웃 미설정 시 응답 없는 브로커/프록시에서 호출 스레드가 무한 대기 (catch도 작동 못 함)
SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
factory.setConnectTimeout(Duration.ofSeconds(5));
factory.setReadTimeout(Duration.ofSeconds(10));

// vueroid-web-devicereg — 타임아웃 설정이 없다
this.restClient = restClientBuilder
        .baseUrl("http://wifinlb.vueroid-cloud.com:8888")
        .defaultHeaders(headers -> headers.setBasicAuth("ncn", "..."))
        .build();
```

api 프로젝트는 같은 교훈을 `WebMvcConfig.restTemplate()` 에도 적용해 두었다. **한 프로젝트 안에서는 두 번 반영된 수정이 다른 프로젝트로는 한 번도 넘어가지 않았다.**

**② 커넥션 풀 유휴값**

| 프로젝트 | `minimum-idle` |
|---|---|
| api | **2** — `# 유휴 시 최소 2개만 유지 (기존 10 → 상시 10개 점유 문제)` |
| media | 10 |
| devicereg | 10 |
| device / eventstream | 설정 없음 (기본값) |

api 에서 "상시 10개 점유 문제"를 겪고 고쳤는데, **같은 문제를 가진 두 프로젝트는 그대로다.** devicereg 는 매퍼 XML 이 없어 DB 를 실제로 쓰지 않는데도 커넥션 10개를 상시 점유한다.

**③ 로그 설정**

| 프로젝트 | logback 파일 | 운영 보존 | 운영 레벨 |
|---|---|---|---|
| eventstream | `logback-spring.xml` 1개 | **30일** | — |
| api | 프로파일별 5개 | 2일 | info |
| device | 프로파일별 4개 | 2일 | **debug** |
| media | 프로파일별 4개 | 2일 | info |
| devicereg | 프로파일별 4개 | 2일 | info |

**eventstream 만 스프링 표준 방식(`logback-spring.xml` 단일 파일 + 프로파일 조건)을 쓰고 보존기간도 합리적이다.** 나머지 넷은 파일을 프로파일 수만큼 복제해 두었고, 그래서 보존기간 2일이 네 곳에 똑같이 박혀 있다. device 는 운영 레벨이 debug 인데, 단말 전량의 리포트를 받는 서버라 로그가 몇 시간 만에 밀려 나간다.

**④ Actuator 노출**

| 프로젝트 | 운영 설정 |
|---|---|
| device | **`include: ""`** — `# 모니터링 연동 전까지 모든 actuator 엔드포인트 비활성화` |
| api | `include: "*"` (+ `shutdown: true`) |
| devicereg | `include: "*"` — **4개 프로파일 전부** |
| eventstream | actuator 자체가 없음 |

**device 서버는 판단하고 껐고 이유까지 적어 두었다.** 그 판단이 api·devicereg 로 넘어가지 않았다.

**⑤ log4jdbc**

다섯 프로젝트 전부 운영 DataSource 가 `net.sf.log4jdbc.sql.jdbcapi.DriverSpy` 를 경유한다. 로그 레벨을 꺼 두어도 프록시 래핑 비용은 발생한다. **이건 아직 어느 프로젝트도 고치지 않았다** — 전파 실패가 아니라 미발견 항목이다.

### 3.2 근본 원인과 조치

원인은 **모노레포이면서 공유 모듈이 없다**는 점이다. 다섯 프로젝트가 각자 `build.gradle` 을 갖고, 같은 클래스를 복사해 쓴다. 리포는 하나인데 코드는 다섯 벌이다.

**1단계 — 전파 누락분을 먼저 맞춘다.** 발견된 4건은 각각 몇 줄짜리 변경이다.

```
[ ] devicereg NanoMqClientService 타임아웃 추가
[ ] media / devicereg minimum-idle 2로 조정
[ ] api / devicereg actuator 화이트리스트 전환, 관리 포트 루프백 바인딩
[ ] api / device / media / devicereg 로그 보존·레벨 조정
```

**2단계 — 공유 모듈을 만든다.** 반복 대상이 명확하다.

```
common/
  ├─ config/DataSourceGuard.java        (§2.3 3단계)
  ├─ client/BrokerAdminClient.java      (NanoMqClientService 통합)
  ├─ util/SafePath.java                 (경로 이탈 방어 — device 서버 구현을 표준으로)
  └─ resources/logback-spring.xml       (eventstream 방식을 표준으로)
```

**3단계 — 표준을 문서가 아니라 코드로 강제한다.** 규칙을 문서로만 남기면 다음 복사에서 또 어긋난다.

```
[ ] 루트 build.gradle 에 공통 의존성·컴파일 옵션 정의, 하위 프로젝트가 상속
[ ] CI 에 설정 린트 추가 — prod 프로파일에 평문 password/actuator "*"/DriverSpy 가 있으면 실패
```

**설정 린트가 이 패턴에 대한 실질적인 재발 방지책이다.** 위 항목 대부분은 정규식으로 검출 가능하다.

---

## 4. 패턴 C — 단말 인증 체계가 서비스 전체에 없다

단말이 클라우드에 접속하는 진입점은 네 곳이다. **네 곳 모두 인증이라 부를 만한 것이 없고, 각각 다른 방식으로 무방비다.**

### 4.1 진입점별 현황

| 진입점 | 서버 | 검증 방식 | 이것으로 막을 수 있는 것 |
|---|---|---|---|
| `POST /registration` | device | 모델명 존재 + 시리얼 접미사 CRC | 없음 — 둘 다 비밀이 아님 |
| `POST /report`, MQTT `device/+/report` | device | **없음** (본문의 serial 을 그대로 신뢰) | 없음 |
| TCP 8010 `SessionHeader` | eventstream | 시리얼이 DB 에 있는가 + 삭제 상태 아닌가 | 없음 — 평문 TCP |
| WebSocket `/ncnRegist` | devicereg | **없음** | 없음 |

여기에 프레임워크 수준 인가 계층의 유무를 겹치면 그림이 완성된다.

| 프로젝트 | `spring-boot-starter-security` | 실효 |
|---|---|---|
| api | 있음 | 동작 (다만 CORS `*` + 광범위한 permitAll 목록) |
| media | 있음 | **`anyRequest().permitAll()`** — 인가를 컨트롤러마다 수동 처리, 누락된 엔드포인트 다수 |
| device | 없음 | 전 엔드포인트 무인증 |
| devicereg | 없음 | 전 엔드포인트 무인증 |
| eventstream | 없음 | 전 엔드포인트 무인증 |

**다섯 중 프레임워크 인가 계층이 실제로 동작하는 것은 api 하나뿐이다.**

### 4.2 개별 결함이 아니라 하나의 사슬이다

각 문서가 지적한 항목들은 따로 보면 개별 취약점이지만, **이어 붙이면 하나의 경로가 된다.**

```
① device: /registration 이 무인증이고 응답에 브로커 계정이 평문으로 나간다
     (encData 주석 처리 상태 — broker_id / broker_pw 그대로 노출)
                          ↓
② 전 단말이 같은 브로커 계정을 쓰므로, 한 번 유출되면 전 단말 토픽 접근
                          ↓
③ eventstream: 인증이 "시리얼이 DB에 있는가" 확인뿐 → 임의 단말 영상 위조 가능
                          ↓
④ devicereg: WebSocket 무인증 → 임의 단말 등록 대기 모드 진입, 성공 통지 탈취
                          ↓
⑤ api: /devices/usage 가 물리 버튼 누름을 검증하지 않음
     → devicereg 가 수행한 소유 증명이 바인딩 단계에서 무의미
```

**⑤가 특히 중요하다.** devicereg 서버 전체가 존재하는 이유는 ④의 물리 버튼 누름으로 소유를 증명하기 위해서인데, 정작 소유권을 기록하는 api 서버가 그 결과를 확인하지 않는다. **설계된 보안 절차가 강제되지 않는 상태다.**

### 4.3 조치 — 단계가 중요하다

이 영역은 단말 펌웨어·제조 공정·브로커 설정이 함께 움직여야 하므로 서버만으로 완결되지 않는다. **순서를 틀리면 보안이 오히려 나빠질 수 있다.**

**즉시 (서버 코드만으로 가능)**

```
[ ] device: /registration, /report 를 단말 트래픽 대역으로만 개방 (ALB/보안그룹/WAF)
[ ] device: 시리얼당 부트스트랩 호출 빈도 제한 — 정상 단말은 부팅 시 1회
[ ] eventstream: 시리얼당 동시 세션 수·시간당 업로드 용량 상한
[ ] eventstream: ua_id 가 NULL 인 단말을 세션 시작 시점에 거절
[ ] 4개 서버 공통: 존재하지 않는 시리얼로의 접속 시도를 지표화 → 탐색 행위 탐지
```

**마지막 항목이 특히 가치 있다.** 지금은 위조가 실제로 일어나고 있는지조차 알 수 없다. 지표를 먼저 놓으면 이후 조치의 우선순위를 데이터로 정할 수 있다.

**1차 (브로커 설정 + 서버)**

```
[ ] 브로커 계정을 단말별로 발급 (공용 계정 폐기)
[ ] nanomq_acl.conf 에서 계정별로 자기 토픽만 허용
      device/{자기serial}/#  publish, server/{자기serial}/#  subscribe
[ ] 부트스트랩 응답의 브로커 계정을 단말 고유값으로 전환
```

**이 조치만으로 ①~②의 사슬이 끊긴다.** 계정이 유출돼도 피해가 단말 한 대로 국한되기 때문이다. **DES/ECB 암호화(`"testkey!"`)를 되살리는 것은 대책이 아니다** — 그 암호화가 켜져도 전 단말이 같은 계정을 쓰는 한 의미가 없다.

**2차 (등록 플로우 정합성)**

```
[ ] devicereg: WebSocket 핸드셰이크 JWT 검증  ← 반드시 먼저
[ ] devicereg: pushbutton 확인 시 1회용 등록 티켓 발급 (공유 Redis, TTL 5분)
[ ] api: /devices/usage 가 티켓을 소비·검증한 뒤에만 바인딩
```

**순서를 지켜야 한다.** WebSocket 인증 없이 티켓만 도입하면, 지금은 강제력 없는 절차인 것이 **강제력 있는 절차를 공격자가 통과하는 상태**로 바뀐다. 보안 수준이 오히려 내려간다.

또한 티켓 저장소는 두 서버가 함께 보는 Redis 여야 하는데, **api 서버의 `AppRedisClient` 구현체가 현재 인메모리 하나뿐이다.** 그 전환이 선행되지 않으면 티켓이 다른 인스턴스에서 조회되지 않아 등록이 실패한다.

**3차 (펌웨어 로드맵 연계)**

```
[ ] eventstream: TCP 구간 TLS 적용 (주행 영상이 현재 평문 전송)
[ ] 단말별 클라이언트 인증서 도입 → mTLS 로 전송 보호와 인증을 동시 해결
[ ] 인증서 CN 과 SessionHeader.serial 일치 검증
```

---

## 5. 통합 조치 로드맵

개별 문서의 조치를 **함께 처리해야 효율적인 것끼리 묶었다.** 프로젝트별로 따로 진행하면 같은 작업을 다섯 번 하게 된다.

| 순서 | 작업 | 대상 | 근거 |
|---|---|---|---|
| **0** | 다섯 서버의 실제 DB 접속 대상 확인 | 전체 | 쿼리 한 번. **prod 가 이미 떠 있다면 진행 중인 장애다** |
| **0** | eventstream `ApplicationName` 중복 수정 | eventstream | 한 줄. 위 진단의 전제 조건 |
| **1** | 관측 도입 — 로그 중앙 수집, eventstream actuator | 전체 | **이후 모든 조치의 검증 수단** |
| **1** | 전파 누락분 4건 일괄 반영 | api·media·devicereg·device | 각각 몇 줄, 위험 낮음 |
| **2** | 단말 인증 즉시 완화책 (망 분리·빈도 제한·이상 탐지 지표) | device·eventstream | 코드 변경만으로 가능 |
| **3** | 설정 외부화 + `DataSourceGuard` 공용 모듈 | 전체 | 자격증명 교체의 전제 |
| **4** | 자격증명 전량 교체 | 전체 인프라 | 3단계 완료 후 재배포 없이 반영 |
| **5** | 프로젝트별 P1 처리 (개별 문서 참조) | 각 프로젝트 | 병렬 진행 가능 |
| **6** | 브로커 계정 단말별 분리 + ACL | 브로커 + device | 인증 사슬 ①~② 차단 |
| **7** | Redis 전환 → 등록 티켓 (WebSocket 인증 선행) | api·devicereg | **순서 엄수** |
| **8** | TLS·mTLS | eventstream + 펌웨어 | 별도 과제 |

**0단계와 1단계를 앞에 두는 이유**: 지금은 "어느 서버가 어디에 붙어 있는가", "무엇이 CPU 를 쓰고 있는가" 같은 기초 질문에 답할 수 없다. **관측이 서기 전에 성능·동시성 값을 조정하는 것은 추측이다.**

---

## 6. 진단 명령 모음

조치 전 현황 파악에 필요한 것들을 모았다. **대부분 읽기 전용이고 몇 분이면 끝난다.**

```sql
-- 어느 서버가 어느 DB에 붙어 있는가 (패턴 A)
SELECT datname, application_name, client_addr, count(*)
FROM pg_stat_activity WHERE application_name IS NOT NULL
GROUP BY 1,2,3 ORDER BY 1,2;

-- 커넥션 총량이 상한을 압박하는가 (패턴 B)
SELECT count(*) AS used, current_setting('max_connections') AS limit FROM pg_stat_activity;

-- 선점 가능한 미등록 단말 수 / 시리얼 형식의 예측 가능성 (패턴 C)
SELECT COUNT(*) FROM md_device WHERE ua_id IS NULL;
SELECT serial FROM md_device ORDER BY created_dtm DESC LIMIT 20;

-- 실행되지 않는 보관 배치로 누적된 데이터량 (api 문서 §4.5)
SELECT COUNT(*), MIN(created_dtm), pg_size_pretty(pg_total_relation_size('uc_noti')) FROM uc_noti;
```

```bash
# 각 인스턴스의 실행 프로파일
ps -ef | grep -o 'server.profile=[a-z]*'

# eventstream CPU 점유 주체 — 기존 미해결 과제의 검증 (eventstream 문서 §4.3)
#   기동 옵션에 -Djdk.tracePinnedThreads=full 추가 후
jcmd <pid> Thread.print | grep -c VirtualThread
ps -ef | grep -c ffmpeg

# 배포 산출물에 평문 시크릿이 남아 있는가 (패턴 A)
unzip -p app.jar BOOT-INF/classes/application.yml | grep -iE 'password|secret|access-key'

# 앱이 실제로 호출하는 경로 확인 — 차단 전 필수 (media 문서 §3.1, devicereg 문서 §4.3)
grep -c '/media/VOD/m/'          <액세스로그>
grep -c '/deviceRegist/device/check/' <액세스로그>
```

---

## 7. 경력기술서용 요약

개별 프로젝트 문서의 항목이 "무엇을 고쳤는가"라면, 이 문서의 항목은 **"왜 반복되는가를 규명하고 재발을 막았는가"** 다. 후자가 서술 가치가 높다.

**1) 마이크로서비스 설정 표류 진단 및 재발 방지 체계 수립**
> 5개 서비스의 운영 DB 접속 대상이 세 갈래로 갈라져 있고 그중 셋이 개발 DB 를 참조하며, 한 서비스는 DB 식별자(`ApplicationName`)까지 다른 서비스와 중복되어 접속 대상을 확인하는 진단 수단 자체가 무력화된 상태를 규명. 원인이 개별 오타가 아니라 접속 정보를 각 프로젝트 설정 파일에 직접 기재하고 프로파일 블록을 복제해 확장하는 방식임을 특정하고, 접속 정보 외부화·식별자 자동 생성·기동 시 프로파일과 연결 대상 정합성 가드·CI 설정 린트로 이어지는 재발 방지 체계를 설계.

**2) 코드 복제로 인한 수정 전파 실패 식별**
> 공유 모듈 없이 5개 서비스가 동일 클래스와 설정을 복제해 사용하면서, 한 프로젝트에서 원인 분석까지 마치고 수정한 결함(외부 호출 타임아웃 부재, 커넥션 풀 상시 점유, Actuator 전면 노출)이 나머지 프로젝트에 그대로 남아 있는 사례 4건을 식별. 누락분을 일괄 반영하는 한편, 각 문제에 대해 **리포 내에 이미 존재하는 올바른 구현을 표준으로 삼아** 공용 모듈로 추출하고, 정규식 기반 설정 린트를 CI 에 추가해 문서가 아닌 빌드가 표준을 강제하도록 전환.

**3) 분산된 인증 결함을 단일 공격 사슬로 재구성**
> 단말이 접속하는 4개 진입점(HTTP 부트스트랩, MQTT/HTTP 리포트, TCP 영상 스트림, 등록 WebSocket)이 모두 실질적 인증 없이 열려 있고, 5개 서비스 중 프레임워크 인가 계층이 실제 동작하는 것은 하나뿐임을 확인. 개별 취약점을 나열하는 대신 **무인증 부트스트랩 → 공용 브로커 계정 평문 노출 → 전 단말 토픽 접근 → 영상 위조 → 등록 선점**으로 이어지는 단일 사슬로 재구성하고, 사슬을 최소 비용으로 끊는 지점(브로커 계정의 단말별 분리)을 식별. 펌웨어 변경 없이 즉시 적용 가능한 완화책과 펌웨어 로드맵 연계가 필요한 항목을 분리해 단계별 조치 순서를 수립.

**4) 보안 조치 순서 역전 위험 사전 차단**
> 단말 등록 플로우의 물리적 소유 증명이 실제 바인딩 단계에서 검증되지 않는 결함에 대해 1회용 등록 티켓 도입을 설계하면서, **WebSocket 인증이 선행되지 않은 상태에서 티켓만 도입하면 강제력 없는 절차가 공격자가 통과 가능한 강제력 있는 절차로 바뀌어 보안 수준이 오히려 하락**함을 식별. 또한 티켓 저장소가 의존하는 공유 캐시 구현체가 인메모리 상태임을 확인하고, 선행 조건을 명시한 순서 제약을 조치 계획에 반영.

---

## 8. 개별 문서

| 문서 | 항목 수 | 핵심 발견 |
|---|---|---|
| `api-server-production-risks.md` | 17 | 상태 저장소가 인메모리 → 스케일아웃 시 소셜 로그인 실패, 보관 배치 미실행 |
| `device-server-production-risks.md` | 16 | 무인증 부트스트랩이 브로커 계정을 평문 응답, MQTT 수신이 단일 스레드 |
| `media-server-production-risks.md` | 15 | 앱용 스트리밍 엔드포인트 무인증(타인 영상 열람), FFmpeg 동시성 무제한 |
| `devicereg-server-production-risks.md` | 15 | 물리 소유 증명 미검증, 공유 구독 + 로컬 세션 맵으로 스케일아웃 불가 |
| `eventstream-server-production-risks.md` | 14 | ffmpeg 타임아웃 부재 + 퍼밋 4개 = 완전 정지, 관측 수단 전무 |

| 기존 사고 분석 문서 | 관련 |
|---|---|
| `device-webhook-offline-miss.md` | device 문서 §4.2(웹훅 유실), §5.4(시크릿 관리) 의 배경 |
| `eventstream-deploy-slowdown.md` | **CPU 점유 주체 미확정 — eventstream 문서 §4.3 이 후보를 제시** |
| `api-todo.md` | `region_cd` 의미 불일치 — api·device 양쪽에서 사용 |
