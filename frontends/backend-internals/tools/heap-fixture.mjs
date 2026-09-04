/* ============================================================
   34편 검산 자료 — JVM 이 인쇄한 힙 인체공학 실측
   ------------------------------------------------------------
   **생성물이다. 손으로 고치지 말 것** — `node tools/gen-heap-fixture.mjs <java>` 가
   `-XX:MaxRAM=N -XX:+PrintFlagsFinal` 을 62번 불러 만든다.

   `verify-heapergo.mjs` 가 모델을 이 표와 견준다. 검사에 JDK 가 필요 없도록
   굳혀 둔 것이고, JDK 판이 바뀌면 다시 떠야 한다.

   뜬 JVM: java.runtime.version = 25.0.4.1+1-LTS · java.vm.name = OpenJDK 64-Bit Server VM
   ============================================================ */

/** 이 표를 인쇄한 JVM. 판이 바뀌었는지 사람이 알아볼 수 있게 남긴다. */
export const JVM = "java.runtime.version = 25.0.4.1+1-LTS · java.vm.name = OpenJDK 64-Bit Server VM";

/** 그 JVM 의 기본값. 명세가 아니라 실측이다. */
export const DEFAULTS = {
    "MaxRAMPercentage": 25,
    "MinRAMPercentage": 50,
    "InitialRAMPercentage": 1.5625
};

/** { mb: -XX:MaxRAM 값(MB), heap: 그때 인쇄된 MaxHeapSize(바이트) } */
export const SWEEP = [
    { mb: 16, heap: 8388608 },
    { mb: 32, heap: 16777216 },
    { mb: 48, heap: 25165824 },
    { mb: 64, heap: 33554432 },
    { mb: 65, heap: 35651584 },
    { mb: 67, heap: 35651584 },
    { mb: 80, heap: 41943040 },
    { mb: 96, heap: 50331648 },
    { mb: 101, heap: 54525952 },
    { mb: 103, heap: 54525952 },
    { mb: 112, heap: 58720256 },
    { mb: 128, heap: 67108864 },
    { mb: 129, heap: 69206016 },
    { mb: 131, heap: 69206016 },
    { mb: 160, heap: 83886080 },
    { mb: 192, heap: 100663296 },
    { mb: 201, heap: 106954752 },
    { mb: 203, heap: 106954752 },
    { mb: 224, heap: 117440512 },
    { mb: 240, heap: 125829120 },
    { mb: 244, heap: 127926272 },
    { mb: 245, heap: 130023424 },
    { mb: 247, heap: 130023424 },
    { mb: 248, heap: 130023424 },
    { mb: 249, heap: 132120576 },
    { mb: 250, heap: 132120576 },
    { mb: 251, heap: 132120576 },
    { mb: 252, heap: 132120576 },
    { mb: 254, heap: 132120576 },
    { mb: 256, heap: 132120576 },
    { mb: 260, heap: 132120576 },
    { mb: 272, heap: 132120576 },
    { mb: 300, heap: 132120576 },
    { mb: 320, heap: 132120576 },
    { mb: 384, heap: 132120576 },
    { mb: 400, heap: 132120576 },
    { mb: 448, heap: 132120576 },
    { mb: 480, heap: 132120576 },
    { mb: 500, heap: 132120576 },
    { mb: 502, heap: 132120576 },
    { mb: 504, heap: 132120576 },
    { mb: 505, heap: 134217728 },
    { mb: 506, heap: 134217728 },
    { mb: 508, heap: 134217728 },
    { mb: 510, heap: 134217728 },
    { mb: 512, heap: 134217728 },
    { mb: 516, heap: 136314880 },
    { mb: 544, heap: 142606336 },
    { mb: 640, heap: 167772160 },
    { mb: 768, heap: 201326592 },
    { mb: 1001, heap: 264241152 },
    { mb: 1003, heap: 264241152 },
    { mb: 1005, heap: 264241152 },
    { mb: 1024, heap: 268435456 },
    { mb: 1536, heap: 402653184 },
    { mb: 2001, heap: 526385152 },
    { mb: 2003, heap: 526385152 },
    { mb: 2048, heap: 536870912 },
    { mb: 3072, heap: 805306368 },
    { mb: 4096, heap: 1073741824 },
    { mb: 8192, heap: 2147483648 },
    { mb: 16384, heap: 4294967296 },
];
