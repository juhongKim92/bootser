# 로그 기반 장애 추적 이력 (2026-06 ~ 2026-07)

커밋 로그를 기준으로, 운영/테스트 서버에서 **어떤 로그가 남았고 → 그 로그로 무엇을 알아냈고 → 어떻게 해결했는지**를 정리한 문서.

대상 커밋 범위: `b966f7f` ~ `156a34b` (branch `test`)

---

## 1. 한눈에 보기

| 시기 | 증상 | 대응 커밋 | 성격 |
|---|---|---|---|
| 2026-06-15 | 테스트 서버 번호판 복원이 "정상 종료"되지 않음 (상태가 COMPLETED로 안 넘어감) | `4339cda`, `4ebc773`, `8a0f08e` | 로깅 추가 (원인 추적) |
| 2026-06-15 | 알림 대상이 없는 요청에서 `sendAlarm` 예외 | `24eb9bd` | 방어 코드 + 테스트 |
| 2026-06-25 | 실패 로그가 전부 `download failed`로 찍혀 실제 실패 지점을 알 수 없음 | `cc76c9f` | 로깅 구조 개선 (stage 분리) |
| 2026-07-03 | 성공해도 OCR 텍스트가 항상 `null` | `83b28c3` | 응답 DTO 불일치 수정 |
| 2026-07-06 | `NoSuchElementException: File not found` 무한 재시도, 상태가 계속 DOWNLOAD | `156a34b` | 근본 원인 수정 |

---

## 2. 사건 #1 — 번호판 복원이 정상 종료되지 않음

### 남은 로그 / 증상
- 테스트 서버에서 `RESTORE`(단일 번호판 복원) 작업이 끝나도 상태가 완료로 바뀌지 않음.
- 당시 `RestoreProcessor`는 실패 시 아무 로그도 남기지 않고 `throw new RuntimeException(e)` 로만 처리 → **어디서 멈췄는지 로그로 알 수 없었음**.

### 추적 과정 (로깅을 3단계로 강화)

1. **`4339cda` [modify] 테스트서버 번호판 복원 정상 종료 안되는 현상 로깅 추가**
   - `RestoreProcessor`의 `InterruptedException` catch절에 에러 로그 1줄 추가.
     ```java
     log.error("[{}] RestoreProcessor error", dvFile.getPathUuid(), e);
     ```

2. **`4ebc773` [logging] 트래킹 로그 추가**
   - `updateState()` 진입/종료를 구분할 수 있게 `- start` / `- end` 로그 추가.
   - 목적: 업로드 단계까지는 들어왔는지, 아니면 그 이전에 끊겼는지 구분.

3. **`8a0f08e` [logging] 오류발생으로 인한 로깅 빡세게 추가**
   - `updateState()` 내부를 **단계별로 전부 로깅**:
     - `restore uploaded file - s3 end: {resultPath}`
     - `restore status update - completed`
     - `restore db save - end`
     - `restore alarm - end`
   - 동시에 예외 처리 수정:
     - `InterruptedException` → `RuntimeException` 재던지기 대신 `Thread.currentThread().interrupt()` 로 정상 종료 (executor 스레드가 죽는 것 방지).
     - `catch (Exception e)` 추가 → 그동안 삼켜지던 런타임 예외가 로그에 남도록.
   - `uploadS3AndRemove` 반환값을 받아서 로그로 남기게 변경(업로드 결과 확인용).

### 해결
- 실패 지점이 로그로 특정 가능해졌고, executor 스레드가 예외로 죽어 후속 처리가 안 되던 문제도 함께 제거됨.
- 이 로깅 강화가 이후 사건 #4(무한 재시도)의 원인 규명 근거가 됨.

---

## 3. 사건 #2 — `sendAlarm` 예외 (알림 수신 설정이 없는 요청)

### 남은 로그 / 증상
- 결과 수신 방식(`ResultRecv`)이 지정되지 않았거나 `WAIT` / `CANCEL` 인 요청에서 알림 전송 로직이 그대로 실행되어 예외 발생.

### 해결 — `24eb9bd` [modify] 예외처리 추가
- `AlarmService.sendAlarm()` 진입 로그 추가 (`call sendAlarm`).
- 가드 절 추가: `resultRecv == null || WAIT || CANCEL` 이면 **조기 return** (알림 전송 스킵).
- 회귀 테스트 추가: `sendAlarm_skipsNotificationWhenResultReceiverIsNotSet`
  → 예외가 나지 않고 `awsS3Util / fcmUtil / emailSender / plateRequestService` 어느 것도 호출되지 않음을 검증.

---

## 4. 사건 #3 — 실패 로그가 전부 `download failed` 로 찍힘

### 남은 로그 / 증상
```
[uuid] download failed
java.lang.Exception: ...
```
- `InferenceBatchFacade`의 배치 작업 스레드가 **다운로드 / 파싱 / 실제 작업**을 한 `try` 블록에서 처리하고, catch절 로그 메시지를 `download failed` 로 고정해 둔 상태.
- 실제로는 다운로드가 아닌 단계(파싱, 추론 작업)에서 터진 케이스도 전부 `download failed` 로 보여 **오진 유발**.

### 해결 — `cc76c9f` [logging] 다운로드 실패 외 케이스도 발견되어 케이스 분리하여 step으로 처리
- 작업 진행 단계를 `stage` 지역 변수로 추적: `download` → `parse` → `work`.
- catch절 로그를 stage 기반으로 변경:
  ```java
  log.error("[{}] {} interrupted", uuid, stage, e);                          // InterruptedException
  log.error("[{}] {}", uuid, formatBatchTaskFailureMessage(stage), e);       // Exception -> "<stage> failed"
  ```
- `formatBatchTaskFailureMessage(stage)` 헬퍼 추가 (테스트 가능하도록 package-private).
- 효과: 이후 로그에서 `parse failed` / `work failed` 로 실패 단계가 즉시 구분됨.

---

## 5. 사건 #4 — `NoSuchElementException: File not found` 무한 재시도 ★ 핵심 장애

### 남은 로그
운영 로그에 **동일 uuid로 반복** 발생:
```
java.util.NoSuchElementException: File not found
    at com.ncn.ai.service.S3StorageService.uploadS3AndRemove(S3StorageService.java:46)
    at com.ncn.ai.facade.InferenceBatchFacade.runMultiPlateExtract(InferenceBatchFacade.java:191)
    at com.ncn.ai.facade.InferenceBatchFacade.lambda$downloadAndDoWork$0(...)
```
- 같은 uuid가 계속 등장 → **무한 재시도 중**.
- 사용자 상태 조회(`GET /v4/videos/plates/{uuid}`)는 계속 `처리중(DOWNLOAD)` 만 반환, FAILED로 확정되지 않음.

### 진단 결과
1. **볼륨 문제 아님** — 앱(`inputFileDir=/opt/dlami/nvme/data`), `vueroid-xision-1`, LPR 서버 `vueroid-xision3-1`(`localhost:8000`) 모두 `/data → /opt/dlami/nvme/data` 를 공유 (docker inspect 확인).
2. **LPR 서버가 번호판 미검출 시에도 `success:true`(HTTP 200)를 반환하면서 출력 파일을 만들지 않음.** curl로 재현:
   ```json
   {"success":true,"data":{"status":"completed","plates_found":0,
    "result":{"plate_found":false,"ocr_text":null}}}
   ```
   → `plate_*.jpg` 미생성.
3. 앱은 `plate_found` / `status` 를 확인하지 않고 무조건 `output_path` 파일을 업로드 시도 → `NoSuchElementException`.
4. 이 예외가 `runMultiPlateExtract` 의 `catch(IllegalStateException|IOException|InterruptedException)` 에 걸리지 않아 상위 람다의 `catch(Exception)` 으로 튐 → `addWaitList` 로 **재큐잉 반복**, 상태가 FAILED로 확정되지 않음.

### 해결 (2단계)

**(1) `83b28c3` fix(lpr): LPR restore 응답 DTO를 실제 서버 응답 구조에 맞게 수정**
- `LprRestoreVideoResponse` 를 실제 응답 구조로 교체:
  - 기존 `Target / restored_path` → `Data{run_id, status, total_frames, processed_frames, plates_found, error, result}`,
    `Result{plate_found, frames_used, ocr_text, ocr_confidence}`
- `@JsonIgnoreProperties(ignoreUnknown = true)` 추가 (알 수 없는 필드로 인한 파싱 실패 방지).
- `extractResultOcrText` → `data.result().ocrText()` 참조로 수정.
- 부수 효과: **성공 시에도 OCR 텍스트가 항상 null로 저장되던 별개 버그 수정.**
- 단, 이 커밋만으로는 무한 재시도가 해결되지 않음 (아래 (2)가 실제 수정).

**(2) `156a34b` fix(lpr): 번호판 미검출 시 업로드 시도 없이 즉시 실패 처리**
- `runMultiPlateExtract` 에서 LPR 응답 직후 미검출 여부를 판정:
  ```java
  LprRestoreVideoResponse.Data response = requestMultiPlateExtract(...);
  if (isPlateNotFound(response)) {
      throw new LprRestoreException(404, null, "LPR restore found no plate for " + uuid);
  }
  ```
- `isPlateNotFound()` 판정 기준: `data == null` / `platesFound <= 0` / `result == null` / `plateFound == false`.
- `LprRestoreException` 은 `IllegalStateException` 상속 → 기존 실패 처리 catch절에 그대로 걸림:
  - `plateRequest.fail(...)` (404 → "Plate restore failed because the video file or target plate could not be found.")
  - `updateProcessStatus(dvFile, FAILED)` / `removeDownlist(dvFile)` / `sendFailureAlarm(dvFile, 404)`
- 결과: **업로드 시도 자체를 하지 않으므로 `NoSuchElementException` 발생 원인 제거 + 재시도 없이 즉시 실패 확정 + 사용자 실패 알림 발송.**

---

## 6. 함께 진행된 실패 처리 / 사용자 노출 개선

로그 추적 과정에서 함께 정리된 실패 응답·알림 관련 변경들.

| 커밋 | 내용 |
|---|---|
| `9ce583b` | 멀티 번호판 복원 실패 시 **실패 사유를 리턴**하도록 로직 수정 (`PlateRequest.fail`, `StatusPlateLink` 에 사유 필드) |
| `b4d4ca6` | 멀티 번호판 복원 실패 케이스에 대한 **push/email 알림 추가** |
| `55f691b` | 실패 사유 케이스 핸들링 수정 — LPR 500 + plate extract 실패면 "번호판 추출 실패" 메시지로 변경, 다국어(KO/EN/ES) 추가 |
| `d8fad58` | Email/Push 실패 알림에 **오류 코드 전시** 추가 (`error code : 507` 형태) |
| `b966f7f` | 507(저장 공간 부족)을 사용자에게 노출하지 않고 **500 내부 서버 오류 메시지로 통일** (내부 사정 노출 불필요) |
| `4f2cf12` | LPR 요청 timeout **70초 → 300초** (추론 시간이 길어 타임아웃으로 실패하던 케이스 대응) |
| `a2b7375` | `AwsS3Util.downloadFile` 의 불필요한 다운로드 경로 로그 삭제 (노이즈 제거) |

---

## 7. 남은 작업

### #3 예외 처리 보강 → 무한 재시도 차단 (긴급도 낮음)
- 사건 #4의 번호판 미검출 케이스는 `156a34b` 로 해결됨. 아래는 **그 외 원인(파일 미존재 등)에 대한 방어 코드**.
- 위치: `InferenceBatchFacade.runMultiPlateExtract` catch절
- `NoSuchElementException`(또는 `RuntimeException`)을 catch 대상에 포함시켜 파일 미존재도 정상 실패로 처리하고 재큐잉되지 않도록 할 것.
- 참고: `if (resultPath == null)` 방어 코드는 `uploadS3AndRemove` 가 null 반환 전에 예외를 먼저 던지므로 현재 dead code.

### happy path 미검증
- **유효한 번호판 좌표일 때 LPR 서버가 `output_path` 에 실제로 파일을 쓰는지** 미확인.
  - 재현 방법: 실패한 운영 요청의 실제 좌표를 DB에서 조회해 curl로 그대로 재현.
    ```sql
    SELECT d.path_uuid, d.input_name, p.rect_x, p.rect_y, p.rect_width, p.rect_height, p.rect_time_ms
    FROM plate_request p JOIN dv_file d ON d.id = p.file_id
    WHERE d.task = 'RESTORE_VIDEO' ORDER BY p.id DESC LIMIT 10;
    ```
  - `plate_found:true` 인데도 파일이 안 생기면 → 서버측 output 저장 로직 문제(별도 대응 필요).
  - 기존 테스트는 임의 좌표(100,100,60,30)라 `plate_found:false` 였으므로 happy path는 아직 미검증.

---

## 8. 회고 — 로깅에서 얻은 교훈

1. **catch절 로그 메시지를 특정 단계로 하드코딩하지 말 것** — `download failed` 하나로 뭉쳐 있어 오진을 유발했다 (`cc76c9f`).
2. **`InterruptedException` 에서 `RuntimeException` 재던지기 금지** — executor 스레드가 죽어 후속 상태 갱신이 누락됐다 (`8a0f08e`).
3. **catch 대상 예외 타입을 좁게 잡으면 실패가 상위 재큐잉 경로로 새어나간다** — 무한 재시도의 직접 원인 (`156a34b`, 남은 작업 #3).
4. **외부 서버 응답 DTO는 실제 응답으로 검증할 것** — 매핑되지 않는 필드는 조용히 null이 되어 버그가 늦게 발견된다 (`83b28c3`).
5. **외부 서버의 `success:true` 를 성공으로 믿지 말 것** — 도메인 결과 필드(`plate_found`, `plates_found`)까지 확인해야 한다.