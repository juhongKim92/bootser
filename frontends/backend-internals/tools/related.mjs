/* ============================================================
   "이어서 볼 것" 링크 맵 — 이 파일이 유일한 출처다
   ------------------------------------------------------------
   `node tools/gen-related.mjs` 가 이 맵을 읽어 36개 페이지 끝에 블록을 박는다.
   본문은 HTML 에 직접 들어가야 색인되므로(JS 주입 금지) 생성해서 넣는다.

   고르는 기준 — **실제로 이어져 있는데 화면에 없던 것**만 넣는다.
   "관련 글" 목록이 아니라 한 줄의 이유가 붙은 다음 걸음이다. 이유가 안 써지면
   그 링크는 넣지 않는다.

   제목은 여기 적지 않는다 — 대상 페이지의 <h1> 에서 읽어온다. 제목을 고치면
   링크 문구가 따라 바뀐다.
   ============================================================ */

export const NO = {
  mvcc: '01', gc: '02', hashring: '03', raft: '04', mqtt: '05', websocket: '06',
  keepalive: '07', connpool: '08', jobclaim: '09', retryloop: '10', backpressure: '11',
  correlation: '12', genericplan: '13', retrystorm: '14', writeskew: '15', stampede: '16',
  timeout: '17', lockttl: '18', throughput: '19', rebalance: '20', tcpclose: '21',
  aggregate: '22', alignment: '23', fanout: '24', omission: '25'
};

/* slug → [{ to, ko, en }] */
export const RELATED = {
  mvcc: [
    { to: 'connpool', ko: '트랜잭션을 오래 열어두는 대가 — 여기서는 정리가 막히고, 8번에서는 커넥션이 마릅니다.', en: 'The price of holding a transaction open — here it blocks cleanup, in no. 8 it drains the pool.' },
    { to: 'writeskew', ko: '스냅숏이 무엇을 보여주는지가 이 페이지라면, 그 스냅숏이 무엇을 통과시키는지가 15번입니다.', en: 'This page is what a snapshot shows you; no. 15 is what that snapshot lets through.' },
    { to: 'genericplan', ko: 'VACUUM 은 통계도 갱신합니다. 통계가 낡으면 옵티마이저가 계획을 잘못 고릅니다.', en: 'VACUUM also refreshes the statistics — and stale statistics make the optimiser pick the wrong plan.' }
  ],
  gc: [
    { to: 'lockttl', ko: '그 정지가 분산 락의 TTL 을 넘으면 락을 잃습니다. 본인은 모릅니다.', en: 'When that pause outlasts a distributed lock’s TTL the lock is gone — and the process cannot tell.' },
    { to: 'keepalive', ko: '정지 중에는 하트비트도 못 나갑니다. 살아 있는데 죽은 것으로 처리됩니다.', en: 'During a pause the heartbeat cannot go out either — alive, and treated as dead.' },
    { to: 'connpool', ko: '정지한 시간도 커넥션을 잡고 있는 시간에 들어갑니다.', en: 'Time spent paused still counts as time holding the connection.' }
  ],
  hashring: [
    { to: 'stampede', ko: '노드가 빠져서 캐시가 무너지는 것이 이 페이지라면, 아무도 빠지지 않았는데 무너지는 것이 16번입니다.', en: 'Here a node leaves and the cache collapses; in no. 16 nobody leaves and it collapses anyway.' },
    { to: 'websocket', ko: '연결이 서버마다 흩어져 있을 때, 메시지를 어느 서버로 보내야 하는가.', en: 'When connections are spread across servers, which one do you send the message to?' },
    { to: 'raft', ko: '멤버십이 바뀌었다는 것을 누가 합의해 주는가.', en: 'Who agrees that the membership changed?' }
  ],
  raft: [
    { to: 'keepalive', ko: '노드가 죽었다고 판단하는 데 걸리는 시간 — 선거 타임아웃과 같은 저울입니다.', en: 'How long it takes to decide a node is dead — the same dial as the election timeout.' },
    { to: 'hashring', ko: '멤버가 바뀌면 데이터는 어디로 옮겨가는가.', en: 'When the membership changes, where does the data move?' }
  ],
  mqtt: [
    { to: 'retrystorm', ko: 'QoS 1 의 재전송이 부하 자체가 되면 어떻게 되는가.', en: 'What happens when QoS 1’s retransmissions become the load itself.' },
    { to: 'lockttl', ko: '중복을 막는 대신 멱등하게 만드는 결론에 다른 쪽에서 도달합니다.', en: 'The same conclusion reached from the other side — stop preventing duplicates, make them idempotent.' },
    { to: 'keepalive', ko: '같은 브로커의 Keep-alive 와 Last Will.', en: 'Keep-alive and Last Will on the same broker.' },
    { to: 'throughput', ko: 'Receive Maximum 이 처리량을 정하는 이유 — 동시성을 RTT 로 나눈 값입니다.', en: 'Why Receive Maximum sets the throughput — it is concurrency divided by RTT.' },
    { to: 'tcpclose', ko: 'QoS 가 홉 단위였던 것처럼 TCP 순서 보장도 홉 단위입니다 — 프록시를 넘지 못합니다.', en: 'Just as QoS was per hop, so is TCP ordering — it does not cross a proxy.' }
  ],
  websocket: [
    { to: 'keepalive', ko: '연결이 죽은 것을 언제 알아차리는가.', en: 'When do you notice a connection has died?' },
    { to: 'backpressure', ko: '팬아웃이 큐를 채우기 시작하면 무엇을 버려야 하는가.', en: 'When the fan-out starts filling the queue, what do you drop?' },
    { to: 'hashring', ko: '어느 서버가 어느 연결을 갖는지를 라우팅으로 푸는 방법.', en: 'Solving “which server owns which connection” by routing instead.' }
  ],
  keepalive: [
    { to: 'gc', ko: '하트비트를 막는 정지가 실제로 얼마나 긴가.', en: 'How long the pause that blocks the heartbeat actually is.' },
    { to: 'raft', ko: '실패 감지를 짧게 잡으면 오탐이 늘어납니다. 같은 저울의 반대쪽입니다.', en: 'Shorten failure detection and false positives rise — the other end of the same dial.' },
    { to: 'lockttl', ko: '하트비트가 못 나가는 것과 락 갱신이 못 나가는 것은 같은 사고입니다.', en: 'A heartbeat that cannot go out and a lock renewal that cannot go out are the same accident.' },
    { to: 'tcpclose', ko: '반대편 — 끊긴 걸 모르는 게 아니라, 정상적으로 끊었는데 데이터가 사라집니다.', en: 'The other side — not failing to notice a break, but closing properly and losing data anyway.' }
  ],
  connpool: [
    { to: 'backpressure', ko: '풀이 마르면 큐가 자랍니다. 그 큐를 어떻게 다룰 것인가.', en: 'When the pool dries up the queue grows — what do you do with that queue?' },
    { to: 'retrystorm', ko: '그 큐가 부하를 걷어내도 안 비는 지점.', en: 'The point where that queue will not drain even after the load is gone.' },
    { to: 'timeout', ko: '타임아웃을 늘리면 점유가 늘어 용량이 줍니다 — 같은 리틀의 법칙입니다.', en: 'Raise the timeout and occupancy rises, so capacity falls — the same Little’s law.' },
    { to: 'throughput', ko: '같은 식이 네트워크에서는 바이트 단위로 나타납니다. 풀 크기 대신 띄운 바이트입니다.', en: 'The same formula in bytes on the network — bytes in flight instead of pool size.' },
    { to: 'mvcc', ko: '트랜잭션을 오래 열어두는 또 다른 대가.', en: 'The other price of holding a transaction open.' }
  ],
  jobclaim: [
    { to: 'lockttl', ko: '제대로 잡은 락이 일하는 중에 사라지면 어떻게 되는가.', en: 'What happens when a correctly claimed lock disappears mid-flight.' },
    { to: 'writeskew', ko: '각자 확인하고 각자 통과하는 같은 모양이 DB 격리 수준에서 나옵니다.', en: 'The same shape — each checks, each passes — coming out of DB isolation levels.' },
    { to: 'retryloop', ko: '선점에 실패한 뒤 재시도가 도는 쪽.', en: 'The retry loop that spins after a failed claim.' }
  ],
  retryloop: [
    { to: 'retrystorm', ko: '그 재시도가 부하 자체가 되어 돌아오지 않는 쪽.', en: 'Where those retries become the load itself and it does not come back.' },
    { to: 'backpressure', ko: '재시도 대신 거부를 고르면 무엇이 달라지는가.', en: 'What changes if you choose rejection over a retry.' },
    { to: 'lockttl', ko: '시퀀스가 롤백해도 돌아오지 않는 성질이 펜싱 토큰에는 오히려 맞습니다.', en: 'A sequence never coming back on rollback is exactly what a fencing token wants.' }
  ],
  backpressure: [
    { to: 'retrystorm', ko: '무너지는 임계와 회복하는 임계가 다릅니다.', en: 'The threshold where it breaks and the threshold where it recovers are not the same.' },
    { to: 'connpool', ko: '자라는 큐가 어디서 오는가.', en: 'Where the growing queue comes from.' },
    { to: 'timeout', ko: '거부가 신호라는 것과 남은 예산을 아래로 넘기는 것은 같은 이야기입니다.', en: 'Rejection as a signal and passing the remaining budget downward are the same idea.' },
    { to: 'omission', ko: '큐에서 기다린 시간은 서버가 재는 응답시간에 안 들어갑니다 — 통째로 사라집니다.', en: 'Time spent waiting in the queue never enters server-side latency — it vanishes whole.' }
  ],
  correlation: [
    { to: 'timeout', ko: '타임아웃으로 포기한 요청의 응답이 늦게 오면, 그게 다음 요청의 짝이 됩니다.', en: 'When the answer to a timed-out request arrives late, it becomes the next request’s pair.' },
    { to: 'mqtt', ko: '패킷 식별자로 짝을 맞추는 같은 문제.', en: 'The same problem, matched by packet identifier.' },
    { to: 'keepalive', ko: '응답이 아예 오지 않는 경우를 언제 알아차리는가.', en: 'When you notice the case where no answer comes at all.' },
    { to: 'alignment', ko: '한 번 어긋난 뒤 스스로 복구하지 못하는 같은 성질이 바이트 레이아웃에도 있습니다.', en: 'The same never-self-correcting property, down at the byte layout.' }
  ],
  genericplan: [
    { to: 'stampede', ko: '평균으로 판단하고 꼬리에서 사고가 납니다 — 젠센 부등식이 옷을 바꿔 입었습니다.', en: 'Judge by the average and break in the tail — Jensen’s inequality in different clothes.' },
    { to: 'mvcc', ko: '그 통계를 갱신하는 것이 VACUUM 과 ANALYZE 입니다.', en: 'Those statistics are what VACUUM and ANALYZE refresh.' },
    { to: 'connpool', ko: '느려진 쿼리가 풀을 말리는 데 얼마나 걸리지 않는가.', en: 'How little it takes for a slowed query to drain the pool.' },
    { to: 'aggregate', ko: '평균으로 판단하는 문제의 사촌 — 평균을 한 번 더 평균하면 가중치를 잃습니다.', en: 'A cousin of judging by the average — average it twice and the weights are gone.' }
  ],
  retrystorm: [
    { to: 'backpressure', ko: '거부를 신호로 쓰면 애초에 이 상태에 들어가지 않습니다.', en: 'Use rejection as a signal and you never enter this state.' },
    { to: 'timeout', ko: '아무도 안 기다리는 그 일이 애초에 왜 시작되는가.', en: 'Why the work nobody is waiting for starts in the first place.' },
    { to: 'connpool', ko: '용량이 왜 그렇게 작은지 — 리틀의 법칙.', en: 'Why the capacity is that small — Little’s law.' },
    { to: 'rebalance', ko: '부하를 걷어도 안 나오는 루프 — 나가는 문이 설정값에만 있는 경우.', en: 'A loop that shedding load will not end — where the exit exists only in the configuration.' },
    { to: 'fanout', ko: '같은 요청을 겹쳐 보내는 것이 언제 꼬리를 자르고 언제 부하 자체가 되는가.', en: 'When overlapping the same request cuts the tail, and when it becomes the load itself.' }
  ],
  writeskew: [
    { to: 'jobclaim', ko: '그래서 락을 어디에 걸어야 하는가.', en: 'So where does the lock have to go?' },
    { to: 'lockttl', ko: '예외도 로그도 없이 결과만 틀리는 같은 종류가 분산 락에서 나옵니다.', en: 'The same species — no exception, no log, just a wrong result — out of a distributed lock.' },
    { to: 'mvcc', ko: '각자가 보고 있던 스냅숏이 무엇이었는가.', en: 'What the snapshot each of them was reading actually was.' },
    { to: 'aggregate', ko: '이쪽은 동시성 때문에 틀리고, 22 는 정의가 갈려서 값이 둘입니다.', en: 'Here concurrency makes it wrong; in no. 22 the definition splits and there are two values.' }
  ],
  stampede: [
    { to: 'lockttl', ko: '뮤텍스를 분산 락으로 옮기면 락의 TTL 이 새 문제가 됩니다.', en: 'Move the mutex to a distributed lock and the lock’s TTL becomes the new problem.' },
    { to: 'genericplan', ko: '평균으로 용량을 잡는 같은 실수를 옵티마이저도 합니다.', en: 'The optimiser makes the same mistake — sizing by the average.' },
    { to: 'hashring', ko: '노드가 빠질 때의 캐시 붕괴.', en: 'The cache collapse when a node does leave.' },
    { to: 'fanout', ko: '캐시는 잎을 없애 팬아웃 폭을 줄입니다 — 그 폭이 왜 그렇게 비싼가.', en: 'A cache removes leaves and narrows the fan-out — here is why that width is so expensive.' }
  ],
  timeout: [
    { to: 'retrystorm', ko: '포기한 뒤에도 계속되는 그 일이 용량을 어떻게 무너뜨리는가.', en: 'How the work that continues after everyone gave up takes capacity down.' },
    { to: 'connpool', ko: '예산을 늘리면 점유가 늘어 용량이 줍니다.', en: 'Raise the budget and occupancy rises, so capacity falls.' },
    { to: 'correlation', ko: '늦게 도착한 응답이 다음 요청의 짝이 되는 경우.', en: 'The case where a late answer becomes the next request’s pair.' },
    { to: 'fanout', ko: '같은 예산 안에서 이번엔 분포가 곱해집니다 — 계층이 아니라 개수로요.', en: 'Inside the same budget, this time the distributions multiply — by count rather than by layer.' }
  ],
  lockttl: [
    { to: 'jobclaim', ko: '그 락을 애초에 어떻게 제대로 잡는가.', en: 'How you claim that lock correctly in the first place.' },
    { to: 'gc', ko: '프로세스가 실제로 얼마나 오래 멈추는가 — TTL 에 들어가야 하는 값입니다.', en: 'How long a process actually stops — the number that belongs in your TTL.' },
    { to: 'mqtt', ko: '중복을 허용하고 멱등하게 만드는 쪽의 값과 대가.', en: 'The price and the payoff of allowing duplicates and being idempotent instead.' }
  ],
  throughput: [
    { to: 'connpool', ko: '같은 식을 커넥션 풀에서 만납니다 — 동시성 = 처리량 × 지연.', en: 'The same formula met at the connection pool — concurrency = throughput × latency.' },
    { to: 'mqtt', ko: 'Receive Maximum 이 그 식의 또 다른 단위입니다.', en: 'Receive Maximum is that formula in yet another unit.' },
    { to: 'timeout', ko: '같은 RTT 가 처리량도 정하고 타임아웃 예산도 먹습니다.', en: 'The same RTT sets your throughput and eats your timeout budget.' }
  ],
  aggregate: [
    { to: 'writeskew', ko: '예외도 로그도 없이 숫자만 틀리는 같은 종류 — 저쪽은 동시성입니다.', en: 'The same species of silent wrong number — that one comes from concurrency.' },
    { to: 'genericplan', ko: '평균으로 판단하는 자리 — 젠센 부등식이 옵티마이저 쪽에서 나옵니다.', en: 'Judging by the average — Jensen’s inequality showing up on the optimiser side.' },
    { to: 'mvcc', ko: '두 경로가 서로 다른 스냅숏을 읽고 있으면 차이가 하나 더 생깁니다.', en: 'If the two paths read different snapshots you get one more source of difference.' },
    { to: 'omission', ko: '이쪽은 정의가 둘이라 둘 다 맞았습니다. 25번은 한쪽이 사건을 아예 안 봤습니다.', en: 'Here two definitions were both right. In no. 25 one side never saw the event at all.' }
  ],
  alignment: [
    { to: 'tcpclose', ko: '21 이 선로에 무엇이 나갔나였다면, 이쪽은 도착한 바이트를 어떻게 읽나입니다.', en: 'If no. 21 was what went out on the wire, this is how to read the bytes that arrived.' },
    { to: 'mqtt', ko: '고정 레이아웃 패킷을 다루는 같은 자리 — 규격을 실측으로 검증해야 하는 이유.', en: 'The same territory of fixed-layout packets — why a spec has to be verified by measurement.' },
    { to: 'correlation', ko: '한 번 어긋난 뒤 스스로 복구하지 못하는 구조가 여기도 있습니다.', en: 'The same shape of never recovering once it has slipped once.' }
  ],
  tcpclose: [
    { to: 'alignment', ko: '도착한 바이트를 읽는 쪽 — 오프셋을 손으로 더하면 그 뒤가 전부 밀립니다.', en: 'The reading side — add offsets by hand and everything after shifts.' },
    { to: 'keepalive', ko: '반대편 — 이쪽은 정상적으로 끊었는데 유실되고, 7 번은 끊겼는데 살아있다고 믿습니다.', en: 'The mirror — here a proper close loses data; in no. 7 a dead connection looks alive.' },
    { to: 'mqtt', ko: 'TCP 순서 보장이 홉 단위인 것이 QoS 가 홉 단위인 것과 같은 구조입니다.', en: 'TCP ordering being per hop is the same structure as QoS being per hop.' },
    { to: 'rebalance', ko: '"정상 종료" 처럼 "살아 있다" 도 계층마다 다른 뜻입니다 — 하트비트는 정상인데 그룹에서 빠집니다.', en: 'Like “clean shutdown”, “alive” also means different things per layer — heartbeats fine, dropped from the group.' }
  ],
  fanout: [
    { to: 'timeout', ko: '취소가 전파되지 않으면 사본의 추가 부하가 계산보다 커집니다 — 아무도 안 기다리는 일이 남습니다.', en: 'If cancellation does not propagate, the copy costs more than the number says — work nobody waits for is left running.' },
    { to: 'retrystorm', ko: '여유 용량이 없을 때 겹쳐 보낸 사본이 부하 자체가 되는 자리.', en: 'Where the overlapping copies become the load, once there is no spare capacity left.' },
    { to: 'backpressure', ko: '폭을 못 줄인다면 남는 선택은 무엇을 버릴지 정하는 것입니다.', en: 'If the width cannot shrink, the remaining choice is deciding what to drop.' },
    { to: 'omission', ko: '그 꼬리를 왜 못 봤는가 — 측정이 하필 느린 구간에만 쉬는 경우.', en: 'Why that tail went unseen — when the measurement rests precisely while things are slow.' }
  ],
  omission: [
    { to: 'fanout', ko: '측정을 고치고 나면 볼 것 — 개별 서버의 꼬리가 사용자에게 몇 배로 도착하는가.', en: 'Once the measurement is fixed: how one server’s tail arrives magnified at the user.' },
    { to: 'aggregate', ko: '같은 사건이 두 숫자가 되는 다른 이유 — 이쪽은 둘 다 맞습니다.', en: 'The other way one event becomes two numbers — there, both are right.' },
    { to: 'connpool', ko: '큐와 풀에서 기다린 시간이 응답시간에서 사라지는 자리.', en: 'Where time spent waiting in the queue and the pool drops out of the latency number.' }
  ],
  rebalance: [
    { to: 'connpool', ko: '바쁨과 진행을 구별하지 못해서 생기는 같은 사고 — CPU 사용률은 진행률이 아닙니다.', en: 'The same accident from confusing busy with progressing — CPU utilisation is not a progress bar.' },
    { to: 'retrystorm', ko: '이쪽은 부하를 걷으면 임계 아래로 내려옵니다. 리밸런싱 루프는 설정을 바꿔야 나옵니다.', en: 'There, shedding load gets you under the threshold. This loop only opens in the configuration.' },
    { to: 'keepalive', ko: '하트비트가 정상인데 죽은 것으로 처리되는 반대 경우.', en: 'The mirror case — the heartbeat is fine and it is treated as dead anyway.' }
  ]
};
