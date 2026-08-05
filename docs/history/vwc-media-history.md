# 이슈 & 해결 히스토리 (git log 분석)

> 대상: `7d00905`(2026-02-24, 최초 포팅) ~ `9ce290b`(2026-07-09), 총 86 커밋
> 프로젝트: Vueroid Cloud 파일/미디어 API — 레거시 FileUpload 서비스를 **Java 21 + Spring Boot 3 + AWS SDK v2**로 포팅하면서 S3 멀티파트 업로드, VOD(HLS) 스트리밍, 스프라이트 썸네일을 신규 개발한 이력

관련 문서: [업로드 진행률 조회 API 분석](./upload-progress-api-analysis.md)

---

## 0. 한눈에 보기

| 영역 | 발생 이슈 수(커밋) | 성격 |
|---|---|---|
| 플랫폼 마이그레이션 / 빌드 | 6 | Boot3·SDK v2 전환 부작용, 인코딩·버전 문제 |
| S3 멀티파트 업로드 | 9 | presigned URL 방향(PUT/GET), 키 경로 조립, 확장자 파싱, 응답 스펙 |
| VOD / HLS 스트리밍 | 11 | 작업 폴더 경로, ffmpeg 입력·컨테이너 분기, m3u8 파일명, Range 크기 |
| 인증 / 에러 코드 | 5 | 401 남발, 토큰 전달 위치, CORS |
| 썸네일 / 스프라이트 | 6 | 파일명·스키마 정리, 격자 계산 버그 |
| DB / JPA | 8 | 컬럼 리네이밍(`dvc_id`→`serial`), 감사 컬럼, 중복 행 조회, 설정 오타 |
| 로깅 노이즈 | 3 | SQL 로그 억제 |

가장 자주 반복된 실패 유형은 **"경로/키 문자열 조립"** 과 **"클라이언트-서버 계약(스펙) 불일치"** 두 가지다. 아래에서 영역별로 증상 → 원인 → 해결 순으로 정리한다.

---

## 1. 플랫폼 마이그레이션 / 빌드

### 1-1. 애플리케이션 기동 실패 — logback XML 인코딩 깨짐
- **증상:** `application run` 시 오류. 로그 설정 파일의 한글 주석이 `?�일 로깅 ?�정`처럼 깨져 XML 파싱이 불안정했다.
- **원인:** 레거시에서 그대로 가져온 `logback_*.xml` 4개 파일이 UTF-8이 아닌 인코딩으로 저장되어 있었다.
- **해결:** 4개 프로파일 파일 모두 BOM 포함 UTF-8로 다시 저장하고, 깨진 한글 주석을 영문 주석으로 교체하며 불필요한 주석을 정리했다. → `6a41355`

### 1-2. Swagger 기동/렌더 에러
- **증상:** springdoc Swagger UI 에러.
- **원인:** Spring Boot 3.4.3 + springdoc 조합 버그.
- **해결:** Boot를 `3.4.3 → 3.4.13`으로 올리고, 함께 문제를 유발한 `springdoc.swagger-ui.path` 설정을 제거했다. → `155e662` (선행 라이브러리 패치 `9b3f550`)

### 1-3. AWS SDK v1 잔존
- 의존 로직을 모두 제거한 뒤 v1 라이브러리를 빌드에서 삭제해 v1/v2 혼용 가능성을 없앴다. → `077b244`

### 1-4. S3 Transfer Acceleration 비활성화
- **증상:** presigner에 `s3-accelerate.amazonaws.com` 엔드포인트를 강제하니 정상 동작하지 않음(버킷 가속 미설정).
- **해결(임시):** `AwsS3Config`의 `endpointOverride`를 주석 처리. → `31990bf` — **현재도 주석 상태(미해결 부채)**

---

## 2. S3 멀티파트(청크) 업로드

업로드 구조는 **서버가 uploadId·presigned URL만 발급하고 실제 데이터는 클라이언트가 S3로 직접 PUT**하는 방식이다. 서버가 데이터 경로에 없기 때문에, 문제는 대부분 "URL을 잘못 만들었다" 또는 "키 문자열이 어긋났다"로 나타났다.

### 2-1. 청크 업로드 URL이 GET으로 서명되어 업로드 불가 🔴
- **증상:** 발급받은 part URL로 PUT을 하면 실패.
- **원인:** `getPreSignedPartUrl` / `generateSingleFileUploadUrl`이 이름은 업로드인데 내부에서 `presignGetObject`(조회용)로 서명하고 있었다. 메서드 이름이 방향을 감추고 있어 발견이 늦었다.
- **해결:** 업로드는 `putPreSignedPartUrl` / `putGenerateSingleFileUploadUrl`, 조회는 `getGenerateSingleFileUploadUrl`로 **메서드 이름에 HTTP 메서드를 명시**하고 PUT/GET 양쪽을 모두 제공하도록 분리했다. → `6e689f4`, `07c6c16`
- **교훈:** presigned URL은 "서명한 메서드"가 곧 계약이다. 이름 규칙(`get*`/`put*`)을 강제하는 것이 가장 저렴한 방어책이었다.

### 2-2. 오브젝트 키에 버킷·디렉터리 누락 / 이중 슬래시 🔴
- **증상:** 청크 업로드 URL 로직 오류. 업로드 위치가 어긋나고 `complete`가 실패.
- **원인:** ① `application.yml`의 `bucket: ncn-vueroid-web/` 처럼 **버킷명에 슬래시가 포함**되어 있었고, 공용 prefix(`dirName`) 설정이 아예 없었다. ② 코드에서 `"/download/vod/..."` 처럼 선행 슬래시를 붙여 키가 `//download/...`로 조립됐다.
- **해결:** `bucket`에서 슬래시를 제거하고 `dirName: test/`를 추가, 코드에서는 선행 슬래시를 제거했다. 실패 원인 추적을 위해 `complete` 예외에 `log.error`를 추가했다. → `dbb15ad`, `5aa4e0e`

### 2-3. 확장자 대소문자에 따른 `IllegalArgumentException` 🔴
- **증상:** `sample.MP4`처럼 대문자 확장자 업로드 시 `FileExt.valueOf()`에서 예외 → 500.
- **원인:** enum 변환 전에 대문자 정규화를 하지 않았고, 허용 확장자 검사도 문자열 `Set`과 enum이 이중으로 존재해 규칙이 갈렸다.
- **해결:** `DvFile.create`에서 `toUpperCase(Locale.ROOT)` 적용(`a48f31d`), `FileUtil.validateFileName`을 `EnumSet<FileExt>` 기반으로 통일하고 매칭 실패 시 `InvalidRequestException`으로 전환. 회귀 테스트(`FileUtilTest`)를 함께 추가했다. → `b81bfef`
- **부수 정리:** `multiFileUpload`을 감싸던 광범위 `try-catch`(모든 예외를 `InvalidRequestException`으로 뭉개던 코드)를 제거해 실제 원인이 로그에 남도록 했다. → `b81bfef`

### 2-4. 청크 URL 응답 payload 축소 (스펙 변경)
- **배경:** part마다 완전한 presigned URL을 내려주면, 파트 수(5MB 단위 → 1GB 파일이면 200개)만큼 동일한 쿼리스트링이 중복돼 응답이 커진다. 커밋 메시지에는 "전송 방식 변경"만 남아 있으나, 변경 내용상 목적은 중복 제거다.
- **해결:** 응답 스펙을 `List<ChunkUrl>{chunkNumber,url}` → `baseUrl` + `List<String[]>{partNumber, X-Amz-Signature}`로 변경. 공통 쿼리스트링을 `baseUrl`로 한 번만 내리고 파트별로는 번호와 서명만 전달, 클라이언트가 조립하도록 했다. `ChunkUrl` DTO는 삭제. → `f24e237`
- **트레이드오프:** URL 조립 책임이 클라이언트로 이동해 서버-클라이언트 결합이 커졌다. 스펙 변경이므로 컨트롤러 테스트도 함께 수정.

### 2-5. `complete` 요청 양식 변경
- 단말 규격에 맞춰 `complete` 요청을 `UploadFileReqeust{header, data}` 구조(`UploadFileHeader`, `UploadFileInfo`)로 감쌌다. → `47939e4`
- 이후 같은 DTO에 필드가 추가될 때마다 **테스트 생성자 인자가 깨지는 문제**가 반복됐다(`7bf3ea1`, `8122a56`). record 기반 DTO 확장 시 예상 가능한 비용.

### 2-6. `store_type`이 항상 DOWNLOAD로 저장됨
- **원인:** `DvFile.create`가 `StoreType.DOWNLOAD`를 하드코딩.
- **해결:** 단말이 보낸 `data.to`로 분기. `StoreType.from(value, default)` 헬퍼를 추가하고 대소문자 무시, `USER`는 `DOWNLOAD` 별칭 처리. **미전송(구버전 클라이언트) → `CLOUD`, 값이 있으나 매칭 실패 → `ERROR` + warn 로그**로 과도기를 흡수했다. → `19b1912`

### 2-7. 진행률 조회 시 `NoSuchUploadException` (500) 🟠
- `complete` 진행 중(S3 uploadId 소멸 ~ DB 커밋 사이)에 진행률 폴링이 겹치면 `listParts`가 404를 던지고 그대로 500이 된다. 데이터 손상은 없다.
- 원인 분석과 권장 수정안은 별도 문서로 정리했다(`7bf3ea1`). **코드 수정은 아직 반영되지 않은 상태** → [upload-progress-api-analysis.md](./upload-progress-api-analysis.md)

---

## 3. VOD / HLS 스트리밍

원본(AVI/MP4)을 EC2 로컬 작업 폴더로 내려받아 ffmpeg로 HLS 변환 후 서비스하는 구조. **"어떤 경로에 무슨 이름으로 두는가"** 가 세 군데(다운로드·변환·스트림 응답)에서 각각 계산되고 있었기 때문에, 한 곳을 고치면 다른 곳이 깨지는 패턴이 반복됐다.

### 3-1. 작업 폴더 경로 불일치 3연타 🔴
| 커밋 | 증상 | 원인 | 해결 |
|---|---|---|---|
| `0efa1b0` | 다운로드 파일이 프로세스 CWD에 흩어짐 | 경로 기준 없음 | `work/` 하위로 이관(하드코딩) |
| `b062794` | 환경별 경로 고정 불가 | `Paths.get("work", ...)` 하드코딩 | `vueroid.tempFileDir` 프로퍼티(기본 `work`)로 외부화, 다운로드·변환 양쪽에 적용 |
| `ae89f7e` | 변환 폴더와 스트림 조회 폴더 불일치 | 한쪽은 `20260416_..avi`(확장자 포함), 다른 쪽은 확장자 없이 폴더를 만듦 | `FileUtil.getFileNameWithoutExt()` 추가 후 **양쪽 모두 확장자 제거된 이름** 사용 |
| `b73b794` | 위 수정 누락분 | `VodStorageService.downloadToWorkingDirectory`만 확장자 포함 유지 | 같은 규칙 적용 |
| `2f1c985` | 채널 재생 시 파일 not found | `resolveStreamFile`이 `tempFileDir` 없이 상대 경로 계산 | prefix에 `tempFileDir` 추가 + `streamFile` 경로 debug 로그 |

- **교훈:** 경로 규칙이 3개 클래스에 흩어져 있던 것이 근본 원인이다. `tempFileDir` + `getFileNameWithoutExt`로 규칙을 모으면서 정리됐지만, 5개 커밋이 소모됐다.

### 3-2. ffmpeg 입력 파일을 `index.avi`로 단정 🔴
- **증상:** MP4 원본은 HLS 변환 자체가 실패(파일 없음).
- **원인:** 다운로드는 `index.avi`로 저장, 변환은 `index.avi`를 읽는 구조 — MP4 지원이 추가된 뒤에도 그대로였다.
- **해결:** `indexFileName(fileName)`으로 원본 확장자를 반영해 저장하고, `resolveVodInputFile()`이 `VOD_FILE_EXTS`(AVI, MP4)를 순회해 실제 존재하는 입력을 찾도록 변경. 없으면 명시적으로 `IOException`. → `b062794`

### 3-3. 컨테이너별 데이터 트랙 추출 방식 차이 🔴
- **증상:** MP4에서 주행 데이터(`data.dat`)가 추출되지 않음.
- **원인:** AVI 기준으로 `-map 0:s?`(자막 스트림) + `rawvideo` 포맷 하나만 사용. MP4는 데이터가 **data 스트림(`0:d`)** 으로 들어 있다.
- **해결:** 입력 확장자로 분기 — MP4는 `-f data -map 0:d:0? -c copy`, AVI는 기존 `-f rawvideo -map 0:s? -c copy`. → `5d277c0`

### 3-4. m3u8 파일명 규칙 누락으로 HLS 다운로드 실패 🔴
- **증상:** 채널 스트림 요청이 404.
- **원인:** `channel` 경로 변수를 파일명으로 그대로 사용했으나, 실제 생성물은 `0ch.m3u8` 형식.
- **해결:** `streamFileName(channel)` — 숫자면 `{channel}ch.m3u8`로 변환. 아울러 "권한 검사 후 경로를 다시 계산"하던 2단계 흐름을 `resolveAccessibleStreamFile()`로 합쳐, **DB에서 조회한 실제 파일명 기준으로 경로를 계산**하도록 바꿨다(권한 검사와 경로 계산이 서로 다른 입력을 쓰던 문제 제거). → `2cfa816`

### 3-5. MP4 Range 응답 단위가 너무 작음
- **증상:** 1MB 단위 Range 응답으로 요청 수가 과도.
- **해결:** `RANGE_CHUNK_SIZE`를 1MB → 8MB로 올리고, 테스트 컨트롤러가 별도 상수를 갖던 중복을 제거해 `VodController.RANGE_CHUNK_SIZE`를 공유. → `7588fd9`

### 3-6. 조회 대상 확장자 / 응답 스펙
- VOD 조회가 AVI만 대상으로 하던 것을 MP4까지 확장. → `da33133`
- 데이터 파일 전송 형식을 **항목별 배열 → 시간대별 meta 오브젝트 배열**로 변경(`VodMetaPoint` 신설). 클라이언트에서 시각별로 값을 짝지어야 하던 부담 제거. → `ffa0faf`, 추출 로직 정리 `a5e7ee4`
- 업로드 시 `videoTime(ms)`를 저장하고 `VodResponse.duration` 단위를 **초 → ms**로 명시. 파싱은 `parseVideoTime`으로 감싸 null/빈값/실패 시 0 반환(`NumberFormatException` 방지). → `8122a56`

---

## 4. 인증 / 에러 코드

### 4-1. 모든 런타임 예외가 401로 나감 🔴
- **증상:** 토큰과 무관한 내부 오류도 401 Unauthorized.
- **원인:** `VodFacade.getVod`가 `catch (RuntimeException) → 401`, `catch (Exception) → 400`으로 뭉개고 있었다.
- **해결:** **토큰 파싱 실패(`InvalidRequestException`)만 401**, 그 외 예외는 500으로 변경하고 각 분기에 로그를 남겼다. → `d63edb4`

### 4-2. 잘못된 토큰인데 404가 나감
- **원인:** `findAccessibleFile`이 토큰 추출까지 `try` 안에서 수행하고 예외를 `Optional.empty()`로 흡수 → 호출부에서 "파일 없음(404)"으로 처리됐다.
- **해결:** 토큰 추출을 `try` 밖으로 빼내 **인증 실패는 401로 전파**, 조회 실패만 empty로 남겼다. → `07c6c16`

### 4-3. accessToken을 body/query로 받던 이중 경로 제거
- HLS 관련 VOD 요청에서 `@RequestParam accessToken` 대안 경로를 없애고 **`Authorization` 헤더 단일화**. → `1baf6c6`

### 4-4. CORS
- 로컬 개발(`localhost:5173`, netlify 테스트 도메인) 대응으로 origin 화이트리스트를 넣었다가(`2ca1385`), 대응 도메인이 계속 늘어나 **`setAllowedOriginPatterns("*")` 로 임시 전체 허용**. → `5ea506f` — **현재도 전체 허용 상태(미해결 부채)**
- 중간에 API별 `@CrossOrigin`을 걷어내 설정을 `SecurityConfig` 한 곳으로 모았다. → `b752024`

---

## 5. 썸네일 / 스프라이트

### 5-1. 스프라이트 하단 검은 여백 🔴 (가장 최근 로직 버그)
- **증상:** 스프라이트 이미지 마지막 행이 검게 비어 나옴.
- **원인:** 격자 크기(`columns`/`rows`)를 **추출 예정 프레임 수(`-frames:v` 상한)** 로 먼저 확정한 뒤 이미지를 할당했다. ffmpeg가 실제로 만든 프레임이 그보다 적으면(짧은 영상, 마지막 구간 프레임 부재) 남은 칸이 미채색으로 남는다.
- **해결:** 순서를 뒤집어 **① ffmpeg 실행 → ② 실제 생성된 파일만 순서대로 읽어 리스트에 담고 → ③ 그 개수로 격자를 산정 → ④ 정확한 크기로 이미지를 한 번만 할당 → ⑤ 그리기**. 0장이면 명시적 예외. → `468215e`

### 5-2. 스프라이트 메타가 더미 값
- 초기에는 `new SpriteMeta(url, 1, 160, 90, 10, 31)` 하드코딩. `dv_file_thumbnail` 테이블/엔티티·리포지토리·서비스를 만들어 **실제 생성 결과(interval, w/h, column, total)를 저장·조회**하도록 연동했다. → `becc6cb`
- 이후 조회 시 null을 기본값으로 채워주던 `defaultValue(...)` 폴백을 제거했다. 실제와 다른 값이 응답에 섞여 **클라이언트 seek 위치가 어긋나는(데이터 오염) 위험**이 폴백의 편의보다 컸다는 판단. → `d4e2886`

### 5-3. 파일명 / 스키마 정리
- 스프라이트 산출물 이름이 `strip.webp`와 `sprite.webp`로 코드 내에서 갈리던 것을 **`sprite.webp`로 통일**. → `1e35a52`
- `dv_file_thumbnail`에서 `dir_path`를 없애고 `file_name`을 두어, 경로를 저장하지 않고 **원본 파일의 storePath로부터 유도**하도록 변경(경로 중복 저장 제거). → `a31dacb`

---

## 6. DB / JPA

### 6-1. 컬럼 리네이밍 전파 누락 — `dvc_id` → `serial` 🔴
- 단말 식별자 컬럼명이 `dvc_id` → `serial`로 바뀌면서 **MyBatis XML 5개 파일 + Repository + Migration 매퍼**를 순차적으로 고쳤다. 한 번에 끝나지 않고 `eaa93eb` → `833c05e` → `4552831`로 세 차례 누락 보정이 필요했다.
- **교훈:** 쿼리가 XML 문자열에 있어 컴파일 타임에 잡히지 않는다. 리네이밍 시 `Grep`으로 전체 검색 후 일괄 처리해야 했던 케이스.

### 6-2. 감사 컬럼 통일 — `IN_DTM`/`UP_DTM` → `CREATE_DTM`/`MODIFIED_DTM`
- **증상:** 빌드 에러(존재하지 않는 필드 참조).
- **해결:** `BaseEntity`(`@CreatedDate`/`@LastModifiedDate` + `AuditingEntityListener`)와 `JpaAuditingConfig`(`@EnableJpaAuditing`)를 도입하고, DTO에서 직접 들고 있던 `inDtm`/`upDtm`을 제거. MyBatis insert는 `#{inDtm}` 대신 **DB `now()`** 를 쓰도록 변경해 애플리케이션 시각과 DB 시각이 갈리지 않게 했다. → `11ac47b`

### 6-3. `IncorrectResultSizeDataAccessException` — viewDtm 갱신 🔴
- **증상:** VOD 조회 시 예외 발생.
- **원인:** `updateFileViewDtm(serial, fileName)`이 **(serial, fileName)으로 단건 조회**했는데, 같은 단말에 동일 파일명 행이 중복 존재할 수 있었다.
- **해결:** 호출부는 이미 `DvFile`을 확보한 상태였으므로, **파일 id 기준 `findById`** 로 변경했다(자연키 조회 → PK 조회). → `77175a9`

### 6-4. 설정 오타 / 커넥션 홀딩
- `hibernate.order_updates: ture` **오타** — 값이 무시되어 UPDATE 배치 정렬이 비활성 상태였다. `true`로 수정.
- `spring.jpa.open-in-view`가 기본 true여서 뷰 렌더까지 커넥션을 물고 있었고 기동 시 경고도 남았다. `false`로 설정. → `e0a58a6`
- **교훈:** boolean 설정 오타는 예외 없이 조용히 무시된다. 리뷰에서만 잡히는 유형.

### 6-5. 리팩토링
- `resultStatus` 자체 래핑을 없애고 **HTTP status code에 위임**(`447ea9f`), `GlobalExceptionHandler`/`UnauthorizedException` 도입, DTO 네이밍 정리(`UoFile` → `UoFileDto`), `Header` → `VcHeader` 등 1차 리팩토링. → `f65cff9`, `4552831`, `7182e9c`, `9e2f6c5`

---

## 7. 로깅 노이즈

배포 후 실제 로그를 보고 세 차례에 걸쳐 정리했다.

| 커밋 | 대상 | 조치 |
|---|---|---|
| `89e7d1a` | `jdbc.sqltiming` (dev/test) | `debug` → `error`. prod/stage와 동일하게 통일 |
| `9ce290b` | `com.ncn.web.file.mapper` (dev/stage/test) | 로거를 `info`로 추가해 MyBatis `Preparing/Parameters` DEBUG 억제. 앱의 다른 DEBUG는 유지 |
| `4ebd40a`, `45139db`, `0e3978f` | 업로드 chunkUrl 등 | 디버깅용 로그 추가·위치 조정 |

`root level=debug`(dev/test)를 유지한 채 **시끄러운 로거만 개별로 올리는** 방식을 택했다. 앱 로그의 가시성은 유지하면서 SQL 노이즈만 제거하는 것이 목적이었다.

---

## 8. 반복된 실패 패턴 (회고)

1. **문자열로 조립하는 경로/키** — S3 오브젝트 키(`2-2`), 작업 폴더(`3-1`), m3u8 파일명(`3-4`). 규칙이 여러 클래스에 중복 구현되어 있으면 한쪽만 고쳐지고 배포 후 발견된다. → 경로 계산은 한 곳(유틸/서비스)에 모으고 프로퍼티로 외부화하는 방향으로 수렴했다.
2. **광범위 `catch`가 원인을 감춘다** — `catch (RuntimeException) → 401`(`4-1`), `catch (Exception) → InvalidRequestException`(`2-3`). 예외를 뭉개면 증상(잘못된 상태 코드)과 원인(경로/파싱 오류)이 분리되어 디버깅 비용이 몇 배가 된다. 제거·세분화 후 실제 원인이 즉시 드러났다.
3. **이름이 계약을 감춘다** — `getPreSignedPartUrl`이 GET으로 서명(`2-1`), `generateSingleFileUploadUrl`이 조회 URL 생성. 메서드명에 HTTP 메서드를 넣는 규칙으로 해결.
4. **추정값으로 자원을 먼저 할당하지 않는다** — 스프라이트 격자(`5-1`), 진행률 총 청크 수. 외부 도구(ffmpeg)·외부 서비스(S3)의 **실제 결과를 확인한 뒤** 계산하는 순서로 바꾸자 사라졌다.
5. **컴파일러가 지켜주지 않는 영역** — MyBatis XML 컬럼명(`6-1`), yml boolean 오타(`6-4`), record DTO 확장에 따른 테스트 생성자(`2-5`). 리네이밍 시 전체 검색, 설정 변경 시 실제 적용 여부 확인이 필요했다.
6. **"임시" 조치가 남는다** — 아래 부채 목록 참고.

---

## 9. 미해결 / 기술 부채

커밋 메시지에 "임시", "일딴", "추후"로 남은 것과 분석만 끝난 항목들.

| 항목 | 상태 | 근거 커밋 |
|---|---|---|
| 진행률 API `NoSuchUploadException` 미처리 (500) | 분석만 완료, 코드 미반영 | `7bf3ea1` + [분석 문서](./upload-progress-api-analysis.md) |
| `listParts` 페이지네이션 미처리 → 5GB 초과 파일 진행률 오류 | 미반영 | 같은 문서 |
| 리전별 버킷 분리 (현재 `ap-southeast-1` 단일 고정) | 임시 고정 | `2288ed2`, `5aa4e0e`, `db608f4` |
| S3 Transfer Acceleration | `endpointOverride` 주석 처리 상태 | `31990bf` |
| CORS 전체 허용 (`setAllowedOriginPatterns("*")`, `allowCredentials=true`) | 임시 전체 허용 유지 | `5ea506f` |
| 로컬 파일 삭제 배치 — 다국가 EC2 환경에서 "자기 배치 파일만" 삭제하도록 보완 필요 | 미개발 | `0379e32` |
| VOD 성능 테스트 컨트롤러의 테스트 경로 하드코딩 (`/home/ubuntu/vod-test/...`) | 테스트용 잔존 | `847b6ad`, `7588fd9` |
| `application.yml`에 DB 비밀번호·AWS 액세스 키가 평문 커밋되어 있음 | **키 회수·외부화 필요** (git 이력에도 남음) | `dbb15ad` 등 다수 |
| 조회수 감소 로직(`view 카운트 감소`) TODO | 주석으로 남음 | `77175a9` 주변 |

> 마지막 항목은 보안 사안이다. 저장소 이력에 자격증명이 포함되어 있으므로, 환경변수/시크릿 매니저로 외부화하는 것과 **기존 키 폐기(rotate)** 를 함께 진행해야 한다.

---

## 부록: 개발 흐름 타임라인

| 시기 | 주요 작업 |
|---|---|
| 2026-02 | Java 21 / Boot 3 / AWS SDK v2 포팅 시작, presigned URL 업/다운로드 테스트 |
| 2026-03 | S3 멀티파트(청크) 업로드 개발, VOD 포팅(1·2차), MP4 Range 다운로드, Swagger, 진행률 조회 API |
| 2026-04 | HLS 변환 안정화(경로·AVI/MP4 분기), 썸네일 추출, VOD 상세 조회, 인증/에러코드 정리, DB 리팩토링(`dvc_id`→`serial`) |
| 2026-05 | 스프라이트 썸네일 메타 실데이터 연동, 라이브러리 버전 패치, 단일/멀티(zip) 다운로드 + 삭제 배치, 청크 URL 스펙 변경 |
| 2026-06 | 청크 URL 로깅·전송 방식, `complete` 요청 양식, 주행기록 DB 업로드 헤더 정리 |
| 2026-07 | `store_type` 분기, `videoTime` 저장, 스프라이트 여백 버그, viewDtm 조회 방식, 로깅 노이즈 제거 |