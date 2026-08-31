# media 서버 운영 리스크 분석 및 해결 시나리오

- **작성일**: 2026-08-31
- **대상**: `vueroid-web-api-media` (Spring Boot 3.4.13 / Java 21 / JPA + MyBatis / S3 / FFmpeg)
- **상태**: 분석 완료, 조치 미착수

---

## 1. 요약

블랙박스 영상 파일을 다루는 서버다. 단말이 올리고(멀티파트 업로드), 사용자가 본다(HLS 변환·스트리밍·다운로드). 117개 파일 중 실질 로직은 VOD·업로드 두 갈래에 몰려 있다.

| 경로 | 하는 일 |
|---|---|
| `POST /upload/{serial}` → `/upload/complete` | S3 멀티파트 업로드 presigned URL 발급 → 완료 처리 → 썸네일 생성 |
| `GET /VOD/{serial}/{fileId}/hls` | S3에서 원본 내려받아 **FFmpeg 으로 HLS 변환** 후 재생목록 반환 |
| `GET /VOD/{serial}/{fileId}/{channel}` | 변환된 m3u8 전송 |
| `GET /VOD/{serial}/download/{fileId}`, `POST /VOD/{serial}/download` | 단일/다중(zip) 다운로드 |

**이 서버의 성격은 API 서버가 아니라 미디어 처리 워커에 가깝다.** 그런데 구조는 일반 웹 API 그대로다. 무거운 변환 작업이 HTTP 요청 스레드에서 동기로 돌고, 동시 실행 제한이 없다.

문제는 크게 네 갈래다.

| 갈래 | 핵심 문제 |
|---|---|
| 인가 누락 | 시큐리티가 `permitAll` 이고 인가는 컨트롤러마다 수동으로 한다. **빠진 엔드포인트가 여러 개다.** 그중 하나는 타인의 영상을 인증 없이 재생시킨다 |
| CPU·프로세스 | FFmpeg 변환이 요청 스레드에서 동기 실행되고 동시성 제한이 없다. 썸네일은 가상 스레드로 무제한 생성된다 |
| 디스크 | 원본 영상을 로컬에 내려받는데 정리 배치는 하루 1회다. 임계값(5분)과 주기(24시간)가 어긋나 있다 |
| 환경 설정 | prod 프로파일이 dev DB 를 바라본다 (device 서버와 동일) |

---

## 2. 위험도 요약

| # | 항목 | 터지는 조건 | 영향 | 우선순위 |
|---|---|---|---|---|
| 1 | `permitAll` + 수동 인가, 누락 엔드포인트 다수 | 상시 | **타인 영상 무단 재생**, 임시파일 삭제 | **P0** |
| 2 | 테스트 컨트롤러가 운영에 노출 | 상시 | 임의 파일 읽기 여지, presigned URL 무단 발급 | **P0** |
| 3 | prod 프로파일이 `vwc_dev` DB 참조 | prod 배포 시 | 파일 메타 분리 실패 | **P0** |
| 4 | 자격증명 커밋 + 소스 주석에 실제 presigned URL | 리포 접근 가능한 누구나 | 버킷 접근 | **P0** |
| 5 | FFmpeg 변환이 요청 스레드에서 동기·무제한 실행 | 동시 재생 증가 | CPU 포화, 서버 전체 무응답 | **P1** |
| 6 | 썸네일이 가상 스레드로 무제한 생성 | 업로드 몰림 | ffmpeg 프로세스 폭주 | **P1** |
| 7 | 임시파일 정리 주기와 임계값 불일치 | 상시 | 로컬 디스크 고갈 | **P1** |
| 8 | Range 응답을 힙에 적재 (8MB/요청) | 동시 스트리밍 | OOM | **P1** |
| 9 | 업로드 완료 예외를 전부 400 으로 뭉갬 | 장애 발생 시 | 원인 추적 불가 | **P1** |
| 10 | CORS `*` + `allowCredentials` | 임의 사이트 방문 | 인증 API 무단 호출 | P2 |
| 11 | `fileSize` 검증 없이 presigned URL 루프 | 조작된 요청 | 서명 대량 생성 DoS | P2 |
| 12 | 경로 조합에 봉쇄 검사 없음 | 조작된 경로 | 작업 디렉터리 이탈 여지 | P2 |
| 13 | 정리 배치가 전 단말 순회 + 분산 락 없음 | 단말 증가 | 배치 시간 선형 증가, 중복 실행 | P2 |
| 14 | `minimum-idle` = `maximum-pool-size` | 상시 | 유휴 시에도 커넥션 10개 점유 | P2 |
| 15 | 로그 보존 2일 / log4jdbc 경유 | 상시 | 사후 분석 불가, 쿼리 오버헤드 | P2 |

---

## 3. P0 — 즉시 조치

### 3.1 인가가 컨트롤러마다 수동이고, 빠진 엔드포인트가 있다

**현상**

시큐리티는 켜져 있지만 전부 허용한다.

```java
// SecurityConfig.java:28-31
.authorizeHttpRequests(auth -> auth
        .anyRequest().permitAll()
)
.httpBasic(Customizer.withDefaults());
```

인가는 각 컨트롤러가 헤더를 직접 읽어 처리한다.

```java
// VodFacade.java:238-241
private Optional<DvFile> findAccessibleFile(String authorizationHeader, String serial, long fileId) {
    long userId = jwtTokenExtractor.extractUaId(authorizationHeader);
    return streamingService.getAccessibleFile(serial, fileId, userId);   // 소유자까지 확인 — 이건 옳다
}
```

**소유권 검사 로직 자체는 제대로 구현되어 있다.** 문제는 그걸 호출하지 않는 경로가 있다는 점이다.

**근거 — 엔드포인트별 인가 여부**

| 엔드포인트 | 토큰 검사 | 소유권 검사 |
|---|---|---|
| `GET /VOD/{serial}/{fileId}/hls` | O | O |
| `GET /VOD/{serial}/{fileId}` | O | O |
| `GET /VOD/{serial}/{fileId}/{channel}` | O | O |
| **`GET /VOD/m/{serial}/{fileId}/{channel}`** | **X** | **X** |
| `GET /VOD/{serial}/download/{fileId}` | O | O |
| `POST /VOD/{serial}/download` | O | O |
| **`POST /VOD/remove`** | **X** | **X** |
| `POST /upload/{serial}` | O | — |
| **`POST /upload/complete`** | **X** | uuid 소유 |
| **`POST /upload/{serial}/cancel`** | **X** | **X** |
| **`GET /upload/progress/{uuid}`** | **X** | **X** |
| **`POST /test/file/upload`, `GET /test/file/{uuid}`** | **X** | **X** |
| **`GET /vod-test/**`** | **X** | — |

가장 심각한 것은 첫 번째다.

```java
// VodController.java:93-102
@GetMapping("/m/{serial}/{fileId}/{channel}")
@SecurityRequirement(name = "")                       // 스웨거상으로도 "인증 불필요"
public ResponseEntity<?> streamApp(@PathVariable String serial, @PathVariable long fileId, @PathVariable String channel) {
    Path m3u8FilePath = vodFacade.resolveStreamFile(serial, fileId, channel);   // ← 토큰 파라미터 자체가 없다
    return download(m3u8FilePath);
}
```

```java
// VodFacade.java:160-162 — 인자에 토큰이 없다. 경로만 조합해 반환한다.
public Path resolveStreamFile(String serial, long fileId, String channel) {
    return Paths.get(tempFileDir, serial, Long.toString(fileId), streamFileName(channel)).toAbsolutePath();
}
```

바로 위 `resolveAccessibleStreamFile()` 은 소유권을 확인한다. **같은 목적의 메서드가 검사하는 버전과 안 하는 버전으로 나란히 존재하고, 앱용 엔드포인트가 안 하는 쪽을 쓴다.**

`serial` 은 단말 라벨에 인쇄되어 있고 `fileId` 는 연속된 정수다. 즉 **타인의 블랙박스 영상을 인증 없이 열람할 수 있다.**

`POST /VOD/remove` 도 마찬가지다.

```java
// VodController.java:136-144 — 토큰 없이 serial 목록만 받아 폴더를 지운다
vodFacade.removeVideos(videoRemoveRequest.getSerialList());
```

**운영에서 터지는 시나리오**

- 시리얼을 아는 사람(중고 거래, 정비소, 주차장 등 물리적으로 차량에 접근한 누구나)이 해당 차량의 주행 영상을 열람할 수 있다. **개인정보·위치정보 유출이며 서비스 신뢰도에 직결된다.**
- `POST /VOD/remove` 로 임의 단말의 변환 캐시를 반복 삭제하면, 그 사용자는 영상을 볼 때마다 재변환(§4.1)을 유발한다. 소수의 요청으로 서버 CPU 를 고갈시킬 수 있다.

**해결 시나리오**

1단계 — **`/VOD/m/**` 경로가 실제로 쓰이는지부터 확인한다.** 앱이 쓰지 않는다면 삭제가 가장 빠른 조치다.

```bash
# 액세스 로그에서 호출 주체 확인
grep '/media/VOD/m/' d21api_access.* | awk '{print $NF}' | sort | uniq -c
```

앱이 쓰고 있다면 왜 토큰 없이 만들었는지가 관건이다. 흔한 이유는 **네이티브 미디어 플레이어가 m3u8 세그먼트를 받을 때 헤더를 안 실어준다**는 것이다. 그렇다면 헤더 대신 URL 에 실을 수 있는 수단이 필요하다.

2단계 — 짧은 수명의 서명 URL 로 전환한다.

```
1. 앱이 인증된 상태로 /VOD/{serial}/{fileId}/hls 를 호출
2. 서버가 재생목록과 함께 재생 전용 토큰을 발급 (파일 단위, TTL 5분)
3. 앱은 /VOD/m/{serial}/{fileId}/{channel}?t={토큰} 으로 세그먼트 요청
4. 서버가 토큰을 검증 — 대상 파일이 일치하는지까지 확인
```

이미 `TokenService` 클래스가 존재하므로 그 위에 얹으면 된다.

3단계 — 인가를 시큐리티 계층으로 끌어올린다. 수동 인가의 근본 문제는 **새 엔드포인트를 추가할 때 빠뜨려도 아무도 모른다**는 점이다.

```java
.authorizeHttpRequests(auth -> auth
        .requestMatchers("/actuator/health").permitAll()
        .anyRequest().authenticated()          // 기본을 인증 필요로 뒤집는다
)
```

기본값을 뒤집으면 **누락의 방향이 반대가 된다.** 빠뜨리면 "누구나 접근"이 아니라 "아무도 접근 못 함"이 되어 즉시 발견된다. 소유권 검사는 지금처럼 서비스 계층에 남긴다.

4단계 — 남은 무인증 엔드포인트를 정리한다.

```
[ ] POST /VOD/remove          → 인증 + 소유권 검사 추가, 또는 내부 전용으로 이동
[ ] POST /upload/complete     → 인증 추가 (uuid 만으로는 부족)
[ ] POST /upload/{serial}/cancel → 인증 + 소유권 검사
[ ] GET  /upload/progress/{uuid} → 인증
[ ] POST /test/file/**        → 삭제 (§3.2)
```

**검증**

```bash
curl -i https://<media서버>/media/VOD/m/<타인시리얼>/12345/1ch.m3u8   # 기대: 401
curl -i -X POST https://<media서버>/media/VOD/remove -d '{"serialList":["..."]}'  # 기대: 401
```

---

### 3.2 테스트 전용 컨트롤러가 운영에 살아 있다

**현상**

```java
// VodPerfTestController.java:30-37
@Hidden                                   // 스웨거에서만 숨겨진다. 라우팅은 살아 있다
@RestController
@RequestMapping("/vod-test")
public class VodPerfTestController {
    private static final String TEST_HLS_MASTER_PATH = "/home/ubuntu/vod-test/index.m3u8";
    private static final String TEST_MP4_PATH = "/home/ubuntu/vod-test/sample.mp4";
```

```java
// AwsFileController.java:30-42
@Hidden
@PostMapping(value = "/test/file/upload")
public ResponseEntity<TestFileInfo> singleFile(@RequestBody AwsUploadRequest file) {
    TestFileInfo url = s3UploadTestFacade.getPresignUrlSingleUpload(file);   // 인증 없이 업로드 URL 발급
```

**근거**

- `@Hidden` 은 **문서에서 감출 뿐 접근을 막지 않는다.** 프로파일 조건도 없어 운영에서도 매핑된다.
- `/test/file/upload` 는 인증 없이 **S3 presigned 업로드 URL 을 발급한다.** 즉 누구나 이 버킷에 파일을 쓸 수 있다. 스토리지 비용 부담과 악성 파일 적재 경로가 된다.
- `/vod-test/hls/{*resourcePath}` 는 와일드카드로 경로 조각을 받아 파일을 읽는다.

```java
// VodPerfTestController.java:116-124
private Path resolveHlsPath(String resourcePath) {
    ...
    String normalizedPath = resourcePath.startsWith("/") ? resourcePath.substring(1) : resourcePath;
    return masterPath.getParent().resolve(normalizedPath).normalize();   // normalize 는 하지만
}                                                                        // 봉쇄(startsWith) 검사가 없다
```

`normalize()` 는 `..` 을 계산해 없앨 뿐, **계산 결과가 기준 디렉터리 밖으로 나가는 것을 막지 않는다.** 톰캣의 URI 정규화가 앞단에서 대부분의 시도를 걸러내므로 즉시 악용 가능하다고 단정하지는 않지만, **방어가 한 겹뿐이고 그 한 겹이 애플리케이션 밖에 있다.** 컨테이너 설정이나 프록시가 바뀌면 그대로 뚫린다.

**운영에서 터지는 시나리오**

성능 비교용으로 만든 코드가 배포에 섞여 들어간 전형적인 사례다. 작성자는 테스트 후 지울 생각이었을 것이고, 지워지지 않은 채 남았다. **위험한 것은 이 코드가 아무도 모르게 살아 있다는 사실 자체다.** 인벤토리에 없는 엔드포인트는 점검 대상에서도 빠진다.

**해결 시나리오**

1단계 — 삭제한다. 성능 비교가 끝난 코드라면 git 히스토리에 남아 있으므로 필요하면 되살릴 수 있다.

```
[ ] VodPerfTestController 삭제
[ ] AwsFileController 의 /test/file/** 두 개 삭제
[ ] S3UploadTestFacade 삭제
```

2단계 — 남겨야 한다면 프로파일로 격리한다. `@Hidden` 은 격리 수단이 아니다.

```java
@Profile({"local", "dev"})     // 운영 컨텍스트에 아예 등록되지 않는다
@RestController
@RequestMapping("/vod-test")
```

3단계 — 엔드포인트 인벤토리를 만든다. actuator `mappings` 나 springdoc 스펙을 배포 시 덤프해 **예상치 못한 경로가 늘어나면 알 수 있게** 한다. `@Hidden` 이 붙은 것도 `mappings` 에는 나온다.

**검증**

```bash
curl -i https://<media서버>/media/vod-test/mp4          # 기대: 404
curl -i -X POST https://<media서버>/media/test/file/upload -d '{}'   # 기대: 404
```

---

### 3.3 prod 프로파일이 dev 데이터베이스를 바라본다

**현상**

device 서버와 **동일한 문제다.**

```yaml
test  : jdbc:log4jdbc:postgresql://HOST-B:5432/vwc_test?ApplicationName=ncnMediaTest
dev   : jdbc:log4jdbc:postgresql://HOST-B:5432/vwc_dev?ApplicationName=ncnMediaDev
stage : jdbc:log4jdbc:postgresql://HOST-B:5432/vwc_dev?ApplicationName=ncnMediaStage
prod  : jdbc:log4jdbc:postgresql://HOST-B:5432/vwc_dev?ApplicationName=ncnMedia
```

**근거**

`vueroid-web-api` prod 는 `HOST-A:5432/d21` 를 쓴다. media 서버 prod 는 `vwc_dev` 다. 두 서버는 `dv_file`, `md_device`, `ua_user` 를 공유해야 한다.

**두 프로젝트(device·media)에서 같은 형태의 오류가 반복되었다는 점이 중요하다.** 개별 실수가 아니라 **설정을 yml 에 직접 적고 프로파일 블록을 복사해 늘려가는 방식 자체의 문제다.**

**운영에서 터지는 시나리오**

- 단말이 올린 영상의 메타(`dv_file`)가 `vwc_dev` 에 저장되고 앱은 `d21` 을 조회하므로 **업로드한 영상이 앱 목록에 나타나지 않는다.**
- VOD 재생 시 `findAccessibleFile` 이 소유자를 찾지 못해 전부 404 가 된다.
- S3 객체는 실제로 업로드되므로 **DB 에 기록이 없는 고아 파일이 쌓인다.** 정리 배치(§4.3)도 DB 기준으로 도는 탓에 이 파일들은 영구히 남는다.

**해결 시나리오**

device 서버 문서 §3.2 와 동일하다. **세 프로젝트를 한 번에 처리한다.**

```yaml
# prod — 전 프로젝트 공통 형태
spring:
  datasource:
    url: jdbc:postgresql://${DB_HOST}:${DB_PORT}/${DB_NAME}?ApplicationName=ncnMedia
    username: ${DB_USERNAME}
    password: ${DB_PASSWORD}
```

기동 시 프로파일과 실제 접속 DB 를 대조하는 가드도 동일하게 넣는다. 확인 쿼리도 같다.

```sql
SELECT datname, application_name, client_addr, count(*)
FROM pg_stat_activity
WHERE application_name IN ('ncnApi','ncnMedia','deviceApi')
GROUP BY 1,2,3;
```

**이 쿼리 한 번으로 세 서버가 각각 어느 DB 를 보고 있는지 즉시 판별된다.** 가장 먼저 실행할 일이다.

---

### 3.4 자격증명이 커밋되어 있고, 소스 주석에 실제 서명 URL 이 남아 있다

**현상**

`application.yml` 에 AWS 키(api·device 서버와 **동일한 키**)와 JWT 시크릿(api 서버와 동일)이 평문으로 있다.

여기에 더해 소스 주석에 실제 presigned URL 전문이 붙어 있다.

```java
// S3UploadFacade.java:143 (주석)
//https://ncn-vueroid-web.s3.ap-southeast-1.amazonaws.com/test/348/download/vod/5499-C3F5-9A47-8830-CE798C49/20260526/....mp4
//   ?partNumber=4&uploadId=...&X-Amz-Credential=<키ID>%2F20260526%2Fap-southeast-1%2Fs3%2Faws4_request&X-Amz-Signature=...
```

**근거**

이 한 줄에 다음이 모두 들어 있다.

| 항목 | 값 |
|---|---|
| 버킷명·리전 | `ncn-vueroid-web`, `ap-southeast-1` |
| AWS Access Key ID | (운영 키 그대로 노출) |
| 실제 사용자 ID·단말 시리얼 | `348`, `5499-C3F5-...` |
| 객체 키 구조 | `{dir}/{uaId}/download/vod/{serial}/{yyyymmdd}/{uuid}.mp4` |

서명 자체는 12시간 만료라 지금은 무효하지만, **객체 키 구조가 그대로 드러난다.** 키를 손에 넣은 사람에게는 어디를 뒤져야 하는지 알려주는 지도다.

**해결 시나리오**

api 서버 문서 §3.1 의 키 교체·외부 주입 작업에 media 서버를 포함시킨다. media 서버 고유 조치는 두 가지다.

```
[ ] S3UploadFacade.java:143 주석 삭제 — 예시가 필요하면 값을 마스킹한다
[ ] AWS 키를 서비스별로 분리 — media 는 ncn-vueroid-web 버킷의 Get/Put/Delete/Multipart 만
```

**세 서버가 같은 키를 공유하는 현재 구조에서는 어느 한 곳이 뚫리면 전부 뚫린다.** 키 분리는 교체 작업과 함께 한 번에 끝내는 편이 낫다.

---

## 4. P1 — 부하 증가 전 필수

### 4.1 FFmpeg HLS 변환이 요청 스레드에서 동기·무제한 실행된다

**현상**

VOD 재생 요청 하나가 다음을 **순차로, 요청 스레드 위에서** 수행한다.

```java
// VodFacade.viewVOD → StreamingService
1. S3 에서 원본 영상 전체 다운로드      (VodStorageService.downToWorkingDirRenameFile)
2. ffprobe 실행 — 비디오 트랙 수 조회   (countVideoTrack)
3. ffprobe 실행 — 오디오 유무 조회      (checkAudioPresence)
4. ffmpeg 실행 — HLS 변환              (convertToHls)
```

```java
// StreamingService.java:143
executor.createJob(totalBuilder).run();     // ← 변환이 끝날 때까지 블로킹
```

**근거**

- 동시 실행 제한이 **없다.** 톰캣 기본 200 스레드가 모두 이 경로에 몰리면 ffmpeg 프로세스 200 개가 동시에 뜬다.
- 타임아웃이 **없다.** 손상된 파일이나 비정상 입력에서 ffmpeg 이 멈추면 스레드가 영구 점유된다.
- 같은 파일에 대한 동시 요청을 막는 잠금이 **없다.**

```java
// VodFacade.java:72-80
if (!dataPath.toFile().exists()) {          // A와 B가 동시에 통과 가능
    vodStorageService.downToWorkingDirRenameFile(...);   // 같은 경로에 동시 다운로드
    playlistFiles = streamingService.createHlsFiles(workingDir);   // 같은 폴더에 동시 변환
}
```

두 요청이 같은 작업 폴더에 동시에 쓰면 **세그먼트가 섞여 재생 불가 상태의 m3u8 이 만들어질 수 있다.** 게다가 그 결과가 캐시로 남아 이후 요청까지 계속 실패한다.

`-c copy` 를 쓰므로 재인코딩은 없어 CPU 부담이 최악은 아니다. 다만 **디스크 I/O 와 프로세스 생성 비용은 그대로이고, S3 다운로드가 앞에 붙는다.** 영상 한 편이 수백 MB 라면 다운로드만 수 초에서 수십 초다.

**운영에서 터지는 시나리오**

- 사용자가 늘어 동시 재생이 겹치면 CPU 가 포화된다. **같은 인프라에서 이미 CPU 포화로 배포가 5분 넘게 지연된 사례가 있다**(`docs/eventstream-deploy-slowdown.md`). 미디어 서버는 그보다 훨씬 무거운 작업을 한다.
- 변환 중 스레드가 묶여 있으므로, 재생과 무관한 업로드·다운로드 요청까지 함께 느려진다.
- 사용자 입장에서는 "재생 버튼을 눌렀는데 한참 뒤에 시작된다"이고, 기다리다 새로고침하면 **또 하나의 변환 작업이 추가로 생긴다.** 부하가 스스로 증폭된다.

**해결 시나리오**

1단계 — 동시 변환 수를 제한한다. 가장 적은 변경으로 CPU 포화를 막는다.

```java
@Bean("hlsExecutor")
public ThreadPoolTaskExecutor hlsExecutor() {
    ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
    int cores = Runtime.getRuntime().availableProcessors();
    executor.setCorePoolSize(Math.max(2, cores / 2));   // CPU 절반만 변환에 쓴다
    executor.setMaxPoolSize(Math.max(2, cores / 2));
    executor.setQueueCapacity(100);
    executor.setThreadNamePrefix("hls-");
    return executor;
}
```

큐가 차면 즉시 실패시켜 사용자에게 "잠시 후 다시 시도" 를 안내한다. **무한정 기다리게 하는 것보다 명확히 거절하는 편이 낫다.**

2단계 — 파일 단위 잠금으로 중복 변환을 없앤다.

```java
// 같은 파일에 대한 두 번째 요청은 첫 번째의 결과를 기다린다
private final ConcurrentHashMap<String, CompletableFuture<String[]>> inFlight = new ConcurrentHashMap<>();

String key = serial + "/" + fileNameWithoutExt;
CompletableFuture<String[]> future = inFlight.computeIfAbsent(key, k ->
        CompletableFuture.supplyAsync(() -> downloadAndConvert(...), hlsExecutor)
                .whenComplete((r, e) -> inFlight.remove(k)));
```

인스턴스가 여러 대면 Redis 락으로 올려야 한다. **다만 각 인스턴스가 자기 로컬 디스크에 변환 결과를 두므로, 애초에 같은 파일 요청이 같은 인스턴스로 가도록 ALB 에서 라우팅하는 편이 근본적이다.**

3단계 — 타임아웃과 프로세스 정리를 넣는다. `net.bramp.ffmpeg` 의 `run()` 은 타임아웃을 제공하지 않으므로 `ProcessBuilder` 로 직접 실행하고 `waitFor(timeout, unit)` + `destroyForcibly()` 를 쓴다. `ThumbnailService.runFfmpegThumbnailExtract` 는 이미 `ProcessBuilder` 를 쓰고 있으므로 그 방식으로 통일한다.

4단계 — 구조 전환. 이것이 본래 답이다.

```
현재 : 재생 요청 → (동기) 다운로드 + 변환 → 응답
개선 : 업로드 완료 → (비동기) 변환 → 결과를 S3 에 저장
      재생 요청 → S3 의 HLS 를 CDN 으로 서빙 (서버는 URL 만 발급)
```

업로드 시점에 한 번만 변환하면 **재생 요청이 아무리 늘어도 서버 CPU 와 무관해진다.** 썸네일은 이미 업로드 시점 처리(§4.2)로 되어 있으므로 같은 자리에 HLS 변환을 붙이면 된다. 변환 결과를 S3 에 두고 CloudFront 로 내보내면 대역폭도 서버를 거치지 않는다.

**검증**

- 동시 재생 50건을 주입하며 CPU 사용률과 ffmpeg 프로세스 수 관측
- 같은 파일을 동시에 10번 요청 → 변환이 1회만 실행되는지
- 손상된 영상 파일 요청 → 타임아웃 후 스레드가 회수되는지

---

### 4.2 썸네일 생성이 가상 스레드로 무제한 생성된다

**현상**

```java
// S3UploadFacade.java:276-279
private void scheduleThumbnailProcessing(...) {
    Runnable task = () -> Thread.ofVirtual().start(() ->
            processThumbnail(uaId, serial, fileName, bucket, storePath, thumbnailStorePath, fileId)
    );
    ...
}
```

**근거**

가상 스레드는 값싸다. 그러나 `processThumbnail` 이 하는 일은 값싸지 않다.

```
1. S3 에서 원본 영상 다운로드
2. 외부 ffmpeg 프로세스 실행 — 프레임 추출 (ThumbnailService:173)
3. JavaCV 로 스프라이트 이미지 합성 — BufferedImage 격자 (메모리)
4. 결과물 S3 업로드
```

**가상 스레드는 OS 프로세스와 힙 메모리를 절약해 주지 않는다.** 업로드 100건이 동시에 완료되면 ffmpeg 100개와 대형 `BufferedImage` 100개가 동시에 생긴다.

게다가 `Thread.ofVirtual().start()` 로 띄운 작업은 **아무도 추적하지 않는다.**

- 실패해도 재시도가 없다
- 애플리케이션이 종료되면 진행 중이던 작업이 사라진다
- 몇 건이 밀려 있는지 알 수 없다

실패 시 결과는 조용하다. `VodFacade.findSpriteMeta()` 가 예외를 잡아 `null` 을 반환하므로(`VodFacade.java:135-137`) **썸네일 없이 재생만 되고, 왜 없는지는 아무도 모른다.**

**운영에서 터지는 시나리오**

주차 이벤트가 몰리는 시간대나 통신이 복구되어 단말들이 밀린 영상을 한꺼번에 올릴 때, 업로드 완료가 폭주한다. 그 순간 ffmpeg 프로세스가 무제한으로 뜨면서 **§4.1 의 HLS 변환과 같은 CPU 를 두고 경쟁한다.** 두 경로가 서로를 밀어낸다.

**해결 시나리오**

1단계 — 전용 풀로 제한한다. §4.1 의 HLS 풀과 **별개 풀**이되, 둘의 합이 CPU 를 넘지 않게 잡는다.

```java
@Bean("thumbnailExecutor")
public ThreadPoolTaskExecutor thumbnailExecutor() {
    ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
    executor.setCorePoolSize(2);
    executor.setMaxPoolSize(4);
    executor.setQueueCapacity(500);
    executor.setThreadNamePrefix("thumb-");
    return executor;
}
```

썸네일은 즉시성이 필요 없다. **큐에 쌓아두고 천천히 처리해도 된다.** 재생 시점에 없으면 없는 대로 동작하는 기능이므로 우선순위를 낮게 두는 것이 맞다.

2단계 — 작업을 영속화한다. 지금은 메모리에만 존재해 재시작하면 사라진다.

```
dv_file 에 thumbnail_status 컬럼 추가 (PENDING / DONE / FAILED)
  → 업로드 완료 시 PENDING 으로 기록
  → 워커가 PENDING 을 집어 처리
  → 실패 시 FAILED + 재시도 횟수 기록
```

이러면 재시작해도 이어서 처리되고, **PENDING 건수가 곧 백로그 지표가 된다.**

3단계 — 실패를 드러낸다. `findSpriteMeta` 의 `null` 반환은 유지하되(재생은 되어야 하므로), 실패 카운터를 지표로 올린다.

**검증**

- 업로드 완료 100건 동시 주입 → ffmpeg 동시 실행 수가 설정값 이하인지
- 처리 중 재시작 → PENDING 이 남아 이어서 처리되는지

---

### 4.3 임시파일 정리 주기가 임계값과 어긋나 있다

**현상**

```java
// FileRemoveBatchConfig.java:18
@Scheduled(cron = "0 0 10 * * ?")      // 매일 오전 10시, 하루 1회
public void removeJob() { ... }
```

```java
// FileRemoveBatchFacade.java:22
LocalDateTime threshold = LocalDateTime.now().minusMinutes(5);   // 5분 지난 파일이 대상
```

**근거**

임계값 5분은 "재생이 끝나면 곧 지운다"는 의도다. 그런데 실행은 하루 한 번이다. **오전 10시 1분에 생긴 파일은 다음 날 오전 10시까지, 약 24시간 남는다.**

그동안 로컬 디스크에 쌓이는 것은 작은 파일이 아니다.

| 종류 | 크기 |
|---|---|
| S3 에서 내려받은 원본 영상 | 편당 수백 MB |
| HLS 세그먼트 (`.ts`) | 원본과 비슷한 총량 |
| 다중 다운로드 zip + 압축 전 원본 | 요청당 수 GB 가능 |

다중 다운로드는 TTL 이 아예 다르다.

```java
// VodStorageService.java:29
private static final Duration MULTI_DOWNLOAD_TTL = Duration.ofHours(48);   // 48시간
```

48시간 TTL 인데 정리는 하루 한 번이므로 **최대 72시간까지 남는다.** zip 과 압축 전 원본이 함께 있으므로 실제 점유는 원본 크기의 2배다.

분산 락도 없다. 코드 주석이 이미 문제를 인지하고 있다.

```java
// FileRemoveBatchConfig.java:24
//삭제 배치는 ec2가 다국가간일꺼라 자기 배치에 있는것만 삭제 하도록 수정 개발 필요
```

인스턴스가 여러 대면 **모든 인스턴스가 같은 시각에 배치를 돌린다.** 로컬 파일 삭제는 각자 자기 디스크라 무해하지만, `removeExpiredDashCamFiles()` 는 **S3 객체를 지우고 DB 플래그를 갱신하므로 중복 실행된다.**

**운영에서 터지는 시나리오**

- 디스크가 차면 `Files.createDirectories`, S3 다운로드, ffmpeg 출력이 모두 실패한다. **영상 재생·업로드·다운로드가 한꺼번에 멈춘다.**
- 디스크 full 은 예고 없이 온다. 사용량이 하루 주기로 톱니처럼 움직이므로 평균만 보면 여유 있어 보인다. **일 최대치를 봐야 한다.**
- 배치가 오전 10시에 몰려 실행되면 그 시간대에 I/O 가 튄다. 사용자가 활동하는 시간이다.

**해결 시나리오**

1단계 — 주기를 임계값에 맞춘다. 5분 임계값이 의도라면 실행도 그 정도 주기여야 한다.

```java
@Scheduled(fixedDelay = 10 * 60 * 1000)     // 10분마다
public void removeExpiredTempFiles() {
    fileRemoveBatchFacade.removeExpiredPlayedFiles();
    fileRemoveBatchFacade.removeExpiredMultiDownloadFiles();
}

@Scheduled(cron = "0 0 4 * * ?")            // S3 정리는 트래픽 적은 새벽에 하루 1회
public void removeExpiredDashCamFiles() {
    fileRemoveBatchFacade.removeExpiredDashCamFiles();
}
```

**로컬 디스크 정리와 S3 정리는 성격이 다르므로 분리한다.** 전자는 자주, 후자는 드물게.

2단계 — S3 정리에만 분산 락을 건다. 로컬 정리는 각 인스턴스가 자기 것을 지우는 게 맞으므로 락이 필요 없다. 오히려 락을 걸면 한 대만 청소하게 되어 잘못된다. **주석의 "자기 배치에 있는것만 삭제"가 정확한 판단이다.**

3단계 — 디스크 사용량을 지표화하고 임계 알람을 건다.

```
[ ] work 디렉터리 사용량 메트릭 노출
[ ] 파티션 사용률 80% 경고 / 90% 위험
[ ] 배치 실행 결과(삭제 건수·확보 용량) 로깅
```

4단계 — 다중 다운로드 zip 은 만든 즉시 응답에 실어 보내므로 **전송 완료 후 바로 지울 수 있다.** 48시간이나 둘 이유를 확인하고, 재다운로드 대비가 목적이 아니라면 TTL 을 대폭 줄인다.

5단계 — `removeExpiredPlayedFiles` 는 전 단말을 순회하며 단말마다 쿼리를 던진다.

```java
// FileRemoveBatchFacade.java:23-27
List<String> deviceList = deviceService.selectDeviceList();     // 전체 단말
for (String serial : deviceList) {
    List<String> expired = streamingService.getExpiredTempFileNmList(serial, threshold);   // 단말당 1쿼리
```

단말 1만 대면 실행마다 1만 쿼리다. 10분 주기로 바꾸면 부담이 커진다. **만료 대상을 한 번에 조회하는 쿼리로 바꿔야 한다.** 로컬 디스크 기준으로 도는 편이 더 단순하다 — 그 인스턴스에 실제로 있는 폴더만 순회하면 된다.

**검증**

- 24시간 부하 시험 중 디스크 사용량이 계단식으로 증가하지 않는지
- 인스턴스 2대에서 S3 삭제가 한쪽만 실행되는지

---

### 4.4 Range 응답을 힙에 통째로 적재한다

**현상**

```java
// VodController.java:47
public static final long RANGE_CHUNK_SIZE = 8 * 1024 * 1024;   // 8MB

// VodController.java:196-200
byte[] body;
try (InputStream inputStream = new FileInputStream(filePath.toFile())) {
    inputStream.skipNBytes(start);
    body = inputStream.readNBytes((int) rangeLength);          // ← 힙에 8MB 적재
}
```

**근거**

Range 요청 하나마다 최대 8MB 를 힙에 올린다. 동시 스트리밍 100건이면 **800MB** 다. 영상 플레이어는 재생 중 Range 요청을 계속 보내므로 동시 요청 수는 시청자 수보다 많다.

`VodPerfTestController` 에도 같은 코드가 복제되어 있다(`VodPerfTestController.java:96-101`).

**해결 시나리오**

파일을 힙에 올리지 않고 스트리밍한다. `ResourceRegion` 을 쓰면 스프링이 알아서 부분 전송한다.

```java
Resource resource = new FileSystemResource(filePath);
ResourceRegion region = new ResourceRegion(resource, start, rangeLength);
return ResponseEntity.status(HttpStatus.PARTIAL_CONTENT)
        .contentType(mediaType)
        .body(region);        // 스프링이 청크 단위로 흘려보낸다
```

더 나은 방향은 §4.1 4단계와 같다. **영상 바이트가 애플리케이션 서버를 통과하지 않게 하는 것이다.** S3 presigned URL 이나 CloudFront 서명 URL 을 발급하면 서버는 URL 만 만들고 전송에서 빠진다. 힙·대역폭·스레드 문제가 한 번에 사라진다.

**검증**

- 동시 스트리밍 100건에서 힙 사용량이 선형 증가하지 않는지
- Range 요청 응답이 정상적으로 부분 전송되는지 (206 + Content-Range)

---

### 4.5 업로드 완료 실패가 전부 400 으로 뭉개진다

**현상**

```java
// S3UploadFacade.java:266-269
} catch (Exception e){
    log.error("complete error : ", e);
    throw new InvalidRequestException("serial", "잘못된 요청");
}
```

**근거**

`complete()` 안에서 일어날 수 있는 실패는 성격이 전부 다르다.

| 실패 | 실제 원인 | 올바른 응답 |
|---|---|---|
| `findByUuid().orElseThrow()` | 잘못된 uuid | 404 |
| 시리얼 불일치 | 잘못된 요청 | 400 |
| `completedMultipartUpload` 실패 | S3 장애 / 파트 누락 | 502 또는 409 |
| `moveObject` 실패 | S3 장애 | 502 |
| `dvFileService.save` 실패 | DB 장애 | 500 |

이 전부가 **400 "잘못된 요청"** 이 된다. 스택트레이스는 남지만(`log.error` 에 예외를 넘기고 있다 — api 서버보다 낫다), **응답 코드로는 서버 장애와 클라이언트 오류가 구분되지 않는다.**

**운영에서 터지는 시나리오**

S3 가 일시적으로 불안정할 때 업로드 완료가 전부 실패한다. 단말은 400 을 받으므로 "내 요청이 잘못됐다"고 판단해 **재시도하지 않을 수 있다.** 그러면 S3 에는 미완료 멀티파트 파트가 남고(스토리지 비용 발생), DB 에는 `dv_file` 기록이 없어 사용자는 영상을 잃는다.

서버 지표상으로도 5xx 가 0이므로 S3 장애가 감지되지 않는다.

**해결 시나리오**

1단계 — 예외를 구분해 던진다.

```java
DvFileUpload upload = dvFileUploadService.findByUuid(request.data().uuid())
        .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "업로드 정보를 찾을 수 없습니다"));

if (!upload.getSerial().equalsIgnoreCase(serial)) {
    throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "시리얼 불일치");
}

try {
    s3V2TransferUtil.completedMultipartUpload(upload.getUploadId(), sourceObjectKey);
    s3V2TransferUtil.moveObject(sourceObjectKey, finalObjectKey);
} catch (SdkException e) {
    throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "저장소 오류", e);   // 재시도 가능함을 알린다
}
```

2단계 — 단말이 재시도 가능한 실패를 구분할 수 있게 한다. **5xx 는 재시도, 4xx 는 재시도 금지**가 되도록 규약을 맞추고 펌웨어와 공유한다.

3단계 — 미완료 멀티파트 업로드 정리를 붙인다. S3 버킷 수명주기 규칙으로 `AbortIncompleteMultipartUpload` 를 7일로 설정하면 코드 변경 없이 비용 누수를 막는다.

```
[ ] S3 버킷 수명주기 규칙: 미완료 멀티파트 7일 후 자동 정리
[ ] dv_file_upload 테이블의 고아 행 정리 배치 (S3 파트가 이미 사라진 건)
```

**검증**

- S3 접근을 차단한 상태에서 `complete` 호출 → 502 응답 + 5xx 지표 증가
- 잘못된 uuid → 404

---

## 5. P2 — 정리 대상

### 5.1 CORS 가 모든 오리진에 자격증명 요청을 허용한다

```java
// SecurityConfig.java:20-26
config.setAllowedOriginPatterns(List.of("*"));
config.setAllowedMethods(List.of("*"));
config.setAllowedHeaders(List.of("*"));
config.setAllowCredentials(true);
```

api 서버와 같은 문제이며 **여기가 더 넓다.** 메서드·헤더까지 전부 열려 있다. 주석 처리된 화이트리스트가 바로 위에 남아 있는 것으로 보아, 개발 편의로 풀었다가 그대로 배포된 것으로 보인다.

조치 방향은 api 서버 문서 §3.2 와 동일하다. 프로파일별 허용 오리진 목록을 설정으로 빼고 `setAllowedOrigins` 를 쓴다.

`httpBasic(Customizer.withDefaults())` 도 함께 정리 대상이다. `permitAll` 과 함께 쓰여 아무 역할을 하지 않으면서, 스프링 부트가 기동 시 임의 비밀번호를 생성해 로그에 남긴다.

### 5.2 `fileSize` 검증 없이 presigned URL 을 루프로 발급한다

```java
// S3UploadFacade.java:114-129
int chunkSize = (int) Math.ceil((double) v2Request.fileSize() / MB5);
...
for (int i = 1; i <= chunkSize; i++) {
    String url = s3V2TransferUtil.putPreSignedPartUrl(s3ObjectKey, uploadId, i, duration);
```

`fileSize` 는 클라이언트가 보낸 값이고 검증이 없다. 큰 값을 보내면 서명 생성이 그만큼 반복된다. 서명 하나당 HMAC 연산과 문자열 조립이 일어나므로 **CPU 와 메모리를 동시에 소모한다.** `(int)` 캐스팅이라 아주 큰 값에서는 음수로 뒤집혀 루프가 돌지 않는 등 동작도 예측하기 어렵다.

조치 방향:

```java
private static final long MAX_UPLOAD_SIZE = 2L * 1024 * 1024 * 1024;   // 2GB

if (v2Request.fileSize() <= 0 || v2Request.fileSize() > MAX_UPLOAD_SIZE) {
    throw new InvalidRequestException("fileSize", "허용 범위를 벗어난 파일 크기");
}
```

S3 멀티파트는 파트 수 상한이 10,000 이므로 그 제약과도 맞춰야 한다. 정상 블랙박스 영상의 실제 크기 분포를 확인해 상한을 정한다.

### 5.3 경로 조합에 봉쇄 검사가 없다

세 곳이 같은 형태다.

```java
// VodFacade.java:161 — channel 이 그대로 파일명이 된다
Paths.get(tempFileDir, serial, Long.toString(fileId), streamFileName(channel))

// VodFacade.java:167 — serial 이 경로 조각이 된다
Paths.get(tempFileDir, serial, FileUtil.getFileNameWithoutExt(fileInfo.getFileName()), streamFileName(channel))

// VodPerfTestController.java:123 — normalize 는 하지만 결과를 검사하지 않는다
masterPath.getParent().resolve(normalizedPath).normalize()
```

`streamFileName` 은 숫자면 `{n}ch.m3u8` 로 만들고, **아니면 입력을 그대로 파일명으로 쓴다.**

```java
// VodFacade.java:171-176
private String streamFileName(String channel) {
    if (channel != null && channel.matches("\\d+")) {
        return channel + "ch.m3u8";
    }
    return channel;        // ← 검증 없이 통과
}
```

경로 변수는 단일 세그먼트라 슬래시를 직접 넣기 어렵고 톰캣이 URI 를 정규화하므로 **즉시 악용 가능하다고 단정하지는 않는다.** 다만 방어가 애플리케이션 밖에만 있다는 점이 문제다.

조치 방향 — 조합 결과가 기준 디렉터리 안에 있는지 확인한다. 한 줄이면 된다.

```java
Path base = Paths.get(tempFileDir).toAbsolutePath().normalize();
Path target = base.resolve(serial).resolve(...).normalize();
if (!target.startsWith(base)) {
    throw new InvalidRequestException("path", "잘못된 경로");
}
```

`ReceiveService`(device 서버)에는 이미 같은 검사가 들어 있다. **같은 조직 안에 올바른 예가 있으므로 그 패턴을 공용 유틸로 만들어 전 프로젝트에서 쓰는 편이 낫다.**

`streamFileName` 도 허용 채널을 화이트리스트로 제한한다.

### 5.4 커넥션 풀이 유휴 시에도 10개를 점유한다

```yaml
spring.datasource.hikari:
  maximum-pool-size: 10
  minimum-idle: 10        # ← 최대치와 동일
```

`minimum-idle` 이 `maximum-pool-size` 와 같으면 **트래픽이 없어도 커넥션 10개를 계속 붙잡는다.** api 서버는 같은 문제를 겪고 2로 낮췄고, 그 이력이 주석으로 남아 있다.

```yaml
# vueroid-web-api/application.yml
minimum-idle: 2        # 유휴 시 최소 2개만 유지 (기존 10 → 상시 10개 점유 문제)
```

**media 서버는 그 수정이 반영되지 않았다.** 세 서버가 같은 PostgreSQL 을 쓰므로 합산 커넥션이 `max_connections` 를 압박한다.

조치 방향: `minimum-idle: 2` 로 맞춘다. 동시에 세 서버의 인스턴스 수 × 풀 크기 합계를 계산해 DB 상한과 대조한다.

### 5.5 로그 보존 2일 / 운영 DataSource 가 log4jdbc 경유

api·device 서버와 동일한 문제다. `logback_prod.xml` 이 `maxHistory 2`, `totalSizeCap 500MB` 이고, 전 프로파일이 `net.sf.log4jdbc.sql.jdbcapi.DriverSpy` 를 쓴다.

**세 프로젝트가 같은 logback 템플릿을 복사해 쓰고 있으므로, 한 번에 정리하는 것이 맞다.** 로그 레벨은 media 가 `info` 로 device(`debug`)보다 낫다.

---

## 6. 조치 순서

| 단계 | 기간 | 항목 | 배포 리스크 |
|---|---|---|---|
| 0 | 즉시 | `/VOD/m/**` 무인증 스트리밍 차단(§3.1), 테스트 컨트롤러 삭제(§3.2) | 낮음 — **앱 호출 여부 확인 후 진행** |
| 1 | 즉시 | 세 서버 prod DB 접속 대상 확인(§3.3) — 쿼리 한 번 | 없음 |
| 2 | 1주 | 자격증명 교체 — api·device 와 묶어서(§3.4), CORS 화이트리스트(§5.1) | 낮음 |
| 3 | 1주 | 정리 배치 주기 조정 + 디스크 지표·알람(§4.3) | 낮음 — **디스크 고갈은 예고 없이 온다** |
| 4 | 2주 | 인가를 시큐리티 계층으로 전환(§3.1 3단계), 나머지 무인증 엔드포인트 정리 | 중간 — 전 엔드포인트 회귀 테스트 |
| 5 | 2주 | FFmpeg 동시 실행 제한 + 파일 단위 잠금 + 타임아웃(§4.1 1~3단계) | 중간 — 부하 테스트 필수 |
| 6 | 2주 | 썸네일 전용 풀 + 작업 영속화(§4.2), 업로드 완료 예외 구분(§4.5) | 중간 |
| 7 | 별도 | 변환을 업로드 시점으로 이동 + CDN 서빙(§4.1 4단계, §4.4) | 높음 — 구조 변경 |

**0단계를 최우선에 두는 이유**: 타인 영상 열람은 다른 어떤 항목보다 파급이 크다. 다만 앱이 그 경로를 쓰고 있다면 차단이 곧 기능 중단이므로, **호출 여부 확인이 조치보다 먼저다.**

**7단계가 사실상 이 서버의 최종 목표다.** 1~6단계는 현재 구조를 버티게 만드는 조치이고, 미디어 서버가 영상 바이트와 변환 작업을 떠안는 구조 자체는 규모가 커지면 반드시 한계에 닿는다.

---

## 7. 검증 체크리스트

```
[ ] /VOD/m/** 무인증 호출 시 401
[ ] /vod-test/**, /test/file/** 404
[ ] 세 서버(ncnApi/ncnMedia/deviceApi)가 각각 올바른 DB에 연결
[ ] 임의 Origin 으로 CORS 프리플라이트 거부
[ ] 동시 재생 50건에서 ffmpeg 프로세스 수가 설정 상한 이하
[ ] 같은 파일 동시 10회 요청 → 변환 1회만 실행
[ ] 손상 영상 요청 → 타임아웃 후 스레드 회수
[ ] 업로드 완료 100건 동시 → 썸네일 ffmpeg 동시 실행 수 제한
[ ] 처리 중 재시작 → 썸네일 PENDING 이 이어서 처리
[ ] 24시간 부하 후 work 디렉터리 사용량이 우상향하지 않음
[ ] 동시 스트리밍 100건에서 힙 사용량 선형 증가 없음
[ ] S3 차단 상태에서 complete 호출 → 502 + 5xx 지표 반영
[ ] fileSize 에 비정상 값 → 400
```

---

## 8. 경력기술서용 요약

**1) 접근 제어 결함 발견 및 인가 구조 재설계**
> 시큐리티 설정이 `permitAll` 이고 인가를 컨트롤러마다 수동 수행하는 구조에서, 앱 전용 스트리밍 엔드포인트가 토큰 검사 없이 파일 경로만 조합해 반환하여 시리얼과 파일 ID 만으로 타인의 블랙박스 영상을 열람할 수 있는 경로를 발견. 재생 전용 단기 서명 토큰을 도입하고, 기본 정책을 `authenticated` 로 전환해 신규 엔드포인트에서 인가 누락이 발생하면 즉시 드러나도록 구조를 역전.

**2) 미디어 변환 부하 격리**
> HLS 변환이 S3 원본 다운로드와 FFmpeg 실행을 HTTP 요청 스레드에서 동기 수행하며 동시 실행 제한·타임아웃·중복 방지가 모두 없는 구조를 확인. 변환 전용 스레드 풀로 동시성을 CPU 절반으로 제한하고 파일 단위 in-flight 병합으로 중복 변환을 제거, 프로세스 타임아웃을 도입해 단일 파일 오류가 스레드를 영구 점유하지 못하도록 차단. 나아가 변환 시점을 재생 요청에서 업로드 완료 시점으로 이전하고 CDN 서빙으로 전환하는 구조 개선안을 설계.

**3) 비동기 작업 관리 체계 도입**
> 썸네일 생성이 `Thread.ofVirtual()` 로 무제한 생성되어 외부 FFmpeg 프로세스와 이미지 합성 메모리가 업로드 폭주 시 통제 없이 증가하고, 실패·재시작 시 복구 경로가 없는 상태를 확인. 전용 풀로 동시성을 제한하고 작업 상태를 DB에 영속화해 재시작 후 이어서 처리되도록 개선, 대기 건수를 백로그 지표로 노출.

**4) 스토리지 고갈 예방**
> 임시파일 정리 배치의 만료 임계값(5분)과 실행 주기(일 1회)가 어긋나 원본 영상과 HLS 세그먼트가 최대 24시간, 다중 다운로드 zip 은 최대 72시간 로컬 디스크에 잔존하는 구조를 규명. 로컬 정리와 S3 정리를 성격에 맞게 분리(10분 주기 / 새벽 1회)하고, 전 단말 순회 방식의 N+1 조회를 제거, 디스크 사용률 임계 알람을 추가.

**5) 메모리 사용 패턴 개선**
> Range 요청마다 8MB 를 힙 배열로 적재하는 스트리밍 구현으로 동시 시청자 증가 시 힙이 선형 증가하는 문제를 확인. `ResourceRegion` 기반 스트리밍으로 전환하고, 영상 바이트가 애플리케이션을 통과하지 않도록 서명 URL 기반 직접 서빙으로 전환하는 방향을 제시.

**6) 배포 산출물 위생 관리**
> 성능 비교용 테스트 컨트롤러와 인증 없는 presigned URL 발급 엔드포인트가 `@Hidden` 만 붙은 채 운영에 배포되어 있고, 소스 주석에 실제 서명 URL(액세스 키 ID·버킷 구조·사용자 ID 포함)이 남아 있는 상태를 발견. 테스트 코드를 프로파일로 격리하고, 배포 시 엔드포인트 인벤토리를 자동 덤프해 의도치 않은 경로 노출을 감지하는 절차를 도입.

---

## 9. 관련 문서

| 문서 | 내용 |
|---|---|
| `docs/api-server-production-risks.md` | api 서버 리스크 — 자격증명·CORS·로깅은 동일 조치로 묶어 진행 |
| `docs/device-server-production-risks.md` | device 서버 리스크 — **prod DB 오설정이 동일하게 발견됨** |
| `docs/eventstream-deploy-slowdown.md` | CPU 포화로 인한 배포 지연 — 본 문서 §4.1 의 배경 |
