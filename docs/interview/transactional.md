# @Transactional 완전 정리 — 면접 답변용

목적: "@Transactional은 어떻게 동작하는가?"라는 질문에 **① 프록시(AOP) → ② 트랜잭션 매니저 → ③ ThreadLocal 동기화 → ④ 속성(전파/격리/롤백)** 순서로 막힘없이 설명하는 것. 마지막에 프록시 기반의 한계(self-invocation)까지 짚으면 이해도가 확실히 드러난다.

---

## 한 줄 정의부터

> "@Transactional은 Spring AOP **프록시**가 메서드 호출을 가로채, `PlatformTransactionManager`를 통해 트랜잭션을 시작하고, `TransactionSynchronizationManager`의 **ThreadLocal**에 Connection을 바인딩해 같은 트랜잭션 안에서 커넥션을 공유합니다. 메서드가 정상 종료되면 커밋, 언체크 예외(RuntimeException/Error)가 발생하면 롤백합니다. 프록시 기반이라 **self-invocation**이나 **private 메서드**에서는 동작하지 않는 한계가 있습니다."

---

## 1. 핵심 원리: 프록시 기반 AOP

`@Transactional`은 마법이 아니라 **Spring AOP 프록시**가 동작하는 것이다.

Spring이 부팅될 때 `@Transactional`이 붙은 빈을 감싸는 **프록시 객체**를 대신 만들어 컨테이너에 등록한다. 우리가 그 빈을 주입받으면 실제로는 원본이 아니라 **프록시를 주입**받는다.

```
[Caller] → [Proxy] → (트랜잭션 시작) → [실제 대상 메서드] → (커밋/롤백) → 반환
```

프록시의 동작을 의사코드로 보면:

```java
// Spring이 내부적으로 생성하는 프록시의 동작 (개념)
public Object invoke(Method method, Object[] args) {
    TransactionStatus status = txManager.getTransaction(txAttribute); // 1. 트랜잭션 시작
    try {
        Object result = target.method(args);   // 2. 실제 비즈니스 로직 실행
        txManager.commit(status);               // 3. 정상 종료 → 커밋
        return result;
    } catch (RuntimeException | Error e) {
        txManager.rollback(status);             // 4. 예외 발생 → 롤백
        throw e;
    }
}
```

**프록시 생성 방식 2가지:**
- **JDK Dynamic Proxy**: 인터페이스가 있으면 사용 (인터페이스 기반)
- **CGLIB**: 인터페이스가 없으면 클래스를 상속해 프록시 생성 (Spring Boot는 기본적으로 CGLIB 사용)

---

## 2. 트랜잭션 매니저 (PlatformTransactionManager)

프록시는 직접 커밋/롤백하지 않고 **`PlatformTransactionManager`**에 위임한다.

- JPA 환경 → `JpaTransactionManager`
- JDBC/MyBatis → `DataSourceTransactionManager`
- JTA(분산 트랜잭션) → `JtaTransactionManager`

이것이 실제로 `Connection.setAutoCommit(false)` → 로직 실행 → `commit()` / `rollback()`을 호출한다.

---

## 3. 동기화의 핵심: Connection을 어떻게 공유하나? (ThreadLocal)

"같은 트랜잭션 안에서 여러 Repository/DAO가 **같은 DB Connection**을 써야" 트랜잭션이 성립한다. Spring은 이것을 **`TransactionSynchronizationManager`**가 관리하는 **ThreadLocal**로 해결한다.

```
트랜잭션 시작 → Connection을 ThreadLocal에 바인딩
   → 트랜잭션 내 모든 DB 접근이 ThreadLocal에서 같은 Connection을 꺼내 씀
   → 트랜잭션 종료 → ThreadLocal에서 언바인딩 + Connection 반납
```

> 이 때문에 **트랜잭션은 스레드에 묶인다**는 특징이 나온다. 별도 스레드(`@Async`, 수동 생성 스레드)로 넘어가면 트랜잭션이 전파되지 않는다. Virtual Thread 환경에서도 스레드 단위 바인딩이라 동일하게 주의해야 한다.

---

## 4. 주요 속성 4가지

### (1) 전파 (Propagation) — "이미 트랜잭션이 있으면 어떻게 할래?"

| 옵션 | 동작 |
|------|------|
| `REQUIRED` (기본) | 있으면 참여, 없으면 새로 생성 |
| `REQUIRES_NEW` | 항상 새 트랜잭션 (기존 건 잠시 보류) |
| `NESTED` | 중첩 트랜잭션 (Savepoint 사용) |
| `SUPPORTS` | 있으면 참여, 없으면 트랜잭션 없이 실행 |
| `MANDATORY` | 반드시 기존 트랜잭션 필요, 없으면 예외 |
| `NEVER` | 트랜잭션 있으면 예외 |
| `NOT_SUPPORTED` | 트랜잭션 없이 실행 (있으면 보류) |

> 실무 팁: 이벤트/로그 저장처럼 "메인 로직이 롤백돼도 얜 남겨야 해"는 `REQUIRES_NEW`를 쓴다.

### (2) 격리 수준 (Isolation)
`READ_UNCOMMITTED`, `READ_COMMITTED`(보통 기본), `REPEATABLE_READ`, `SERIALIZABLE`. 동시성 문제(Dirty / Non-repeatable / Phantom Read)와 성능 사이의 트레이드오프.

### (3) 롤백 규칙 (rollbackFor)
- **기본: `RuntimeException`(Unchecked)과 `Error`만 롤백.**
- **`Checked Exception`은 롤백하지 않는다!** (자주 나오는 함정 질문)
- 필요하면 `@Transactional(rollbackFor = Exception.class)`로 지정.

### (4) readOnly
`readOnly = true` → JPA에서 flush 모드를 MANUAL로 바꿔 **더티 체킹(변경 감지) 스냅샷을 만들지 않아** 성능·메모리 이득. 조회 전용 메서드에 붙인다.

---

## 5. 가장 중요한 함정: Self-Invocation (자기 호출)

**프록시 기반이라서 생기는 대표적 한계.** 이것을 언급하면 이해도가 확실히 드러난다.

```java
@Service
public class MyService {

    public void outer() {
        inner();  // ❌ this.inner() → 프록시를 거치지 않음 → @Transactional 무시됨!
    }

    @Transactional
    public void inner() { ... }
}
```

**이유:** `outer()`가 `inner()`를 호출할 때 `this.inner()`로 호출된다. `this`는 프록시가 아니라 **원본 객체**라서 프록시의 트랜잭션 처리 로직을 거치지 않는다.

**해결책:**
1. 다른 빈으로 메서드 분리 (권장)
2. 자기 자신을 주입받아 프록시를 통해 호출
3. `AopContext.currentProxy()` 사용

> `@Cacheable`, `@Async`도 완전히 같은 이유로 self-invocation 시 무시된다.

**추가 함정 2개:**
- **`private` / `final` 메서드엔 안 걸린다** — 프록시가 오버라이드할 수 없어서 (CGLIB은 상속 기반)
- **`try-catch`로 예외를 삼키면 롤백되지 않는다** — 프록시까지 예외가 전파돼야 롤백 판단을 한다

---

## 6. 예상 꼬리 질문 5선

### Q1. @Transactional은 내부적으로 어떻게 트랜잭션을 시작하고 커밋하나요?
프록시가 호출을 가로채 `PlatformTransactionManager.getTransaction()`으로 트랜잭션을 시작합니다. 이때 커넥션의 `setAutoCommit(false)`가 호출되고, 해당 커넥션이 `TransactionSynchronizationManager`의 ThreadLocal에 바인딩됩니다. 메서드가 정상 반환되면 `commit()`, 언체크 예외가 던져지면 `rollback()`을 호출한 뒤 커넥션을 반납합니다.

### Q2. 같은 클래스 안에서 @Transactional 메서드를 호출하면 왜 트랜잭션이 안 걸리나요?
Spring AOP는 프록시 기반이라 외부에서 빈으로 진입할 때만 프록시를 거칩니다. 클래스 내부 호출은 `this.method()`로 원본 객체를 직접 호출하기 때문에 프록시를 우회해 어드바이스가 적용되지 않습니다. 해결하려면 메서드를 다른 빈으로 분리하거나, 자기 자신을 주입받아 프록시를 통해 호출해야 합니다.

### Q3. Checked Exception이 터졌는데 롤백이 안 됐습니다. 왜죠?
Spring의 기본 롤백 정책은 `RuntimeException`과 `Error`만 롤백하고, Checked Exception은 커밋합니다. 트랜잭션 설계 관점에서 checked는 "복구 가능한 상황"으로 간주하기 때문입니다. 필요하면 `@Transactional(rollbackFor = Exception.class)`로 명시해야 합니다.

### Q4. REQUIRED와 REQUIRES_NEW의 차이는? 언제 REQUIRES_NEW를 쓰나요?
REQUIRED는 기존 트랜잭션이 있으면 참여하고 없으면 새로 만듭니다(하나의 물리 트랜잭션). REQUIRES_NEW는 기존 트랜잭션을 잠시 보류하고 항상 독립된 새 트랜잭션을 시작합니다. 메인 로직이 롤백되어도 반드시 커밋되어야 하는 감사 로그·실패 이력 저장 같은 곳에 REQUIRES_NEW를 씁니다. 단, 커넥션을 2개 점유하므로 커넥션 풀 고갈에 주의해야 합니다.

### Q5. readOnly = true는 성능에 어떤 영향을 주나요?
JPA에서 flush 모드를 MANUAL로 전환해 영속성 컨텍스트가 변경 감지를 위한 스냅샷을 만들지 않습니다. 그만큼 메모리·CPU를 아끼고 불필요한 flush를 막습니다. 또한 일부 DB/드라이버에서는 읽기 전용 힌트를 전달하거나, 읽기 복제본(Replica)으로 라우팅하는 전략의 트리거로 활용되기도 합니다.

---

## 부록: Spring `@Transactional` vs Jakarta(JTA) `@Transactional`

| 구분 | Spring `org.springframework...` | Jakarta `jakarta.transaction...` |
|------|------------------------|-------------------------------|
| 출신 | Spring Framework | Jakarta EE(JTA) 표준 스펙 |
| 격리 수준(isolation) | 지원 | 미지원 |
| readOnly | 지원 | 미지원 |
| 전파 옵션 | 7가지 (NESTED 포함) | 6가지 (NESTED 없음) |
| 롤백 지정 | `rollbackFor` | `rollbackOn` / `dontRollbackOn` |

> Spring 프로젝트라면 기능이 풍부한 `org.springframework.transaction.annotation.Transactional`을 쓰는 것이 정답. Spring Boot 3/Framework 6부터 `javax.*`는 `jakarta.*`로 전환되었다.