/* ============================================================
   34편 고정자료 생성 — JDK 의 힙 인체공학을 실측해 heap-fixture.mjs 로 굳힌다
   실행: node tools/gen-heap-fixture.mjs [java 경로]
   ------------------------------------------------------------
   `gen-vsop87.mjs` 와 같은 **한 번 돌리고 마는 도구**다. 이것만 외부 런타임(JDK)을
   부르고, 그 출력을 저장소에 굳혀 둔다. 그래서 `verify-heapergo.mjs` 와
   `check-pages.mjs` 는 JDK 없이 돌고, 이 디렉터리의 "의존성 없음" 이 유지된다.

   ------------------------------------------------------------ 왜 고정자료인가

   이 편의 검산점은 **JVM 자신**이다 — `-XX:MaxRAM=N -XX:+PrintFlagsFinal` 이 임의
   입력에 답을 인쇄하므로, 표를 맞추는 것이 아니라 **생성기와 겨룰 수** 있다.
   26편이 RFC 6928 의 유한한 표로 검산한 것보다 센 자리다.

   그런데 그 생성기를 검사 때마다 부르면 검사가 JDK 판에 매인다. 그래서 한 번 떠서
   굳히고, 어느 JVM 이 무엇을 인쇄했는지 파일에 함께 적는다 — `sky-fixture.mjs` 가
   분점 공표 시각을 굳혀 둔 것과 같은 방식이다.

   ⚠ **JDK 판이 바뀌면 다시 떠야 한다.** 2026-09-04 에 JDK 17(Zulu)과 25(Temurin)에서
   각각 떠 보고 모든 점이 일치하는 것을 확인했지만, 그게 앞으로도 참이라는 보장은 없다.
   ScaleForWordSize(96*M) 와 힙 정렬은 명세가 아니라 구현이다.
   ============================================================ */
import { execFileSync, spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const JAVA = process.argv[2] || 'java';

/* 훑을 자리. 세 구간(50% · 평지 · 25%)과 두 경계를 다 덮고, 정렬이 보이도록
   짝수와 홀수를 섞는다 — 홀수가 없으면 2 MiB 올림이 그림자처럼 숨는다. */
const RAMS = [
    16, 32, 48, 64, 65, 67, 80, 96, 101, 103, 112, 128, 129, 131, 160, 192, 201, 203,
    224, 240, 244, 245, 247, 248, 249, 250, 251, 252, 254, 256, 260, 272, 300, 320,
    384, 400, 448, 480, 500, 502, 504, 505, 506, 508, 510, 512, 516, 544, 640, 768,
    1001, 1003, 1005, 1024, 1536, 2001, 2003, 2048, 3072, 4096, 8192, 16384
];

function flags(extra) {
    const out = execFileSync(JAVA, [...extra, '-XX:+PrintFlagsFinal', '-version'],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const grab = (name) => {
        const m = new RegExp(`\\s${name}\\s+=\\s+(\\S+)`).exec(out);
        return m ? m[1] : null;
    };
    return grab;
}

/* 어느 JVM 이 인쇄한 것인지 파일에 함께 적는다 — 판이 바뀌면 알아볼 수 있게.
   ⚠ `-version` 과 `-XshowSettings` 는 **stderr** 로 쓴다. stdout 만 읽으면 빈 문자열이
   와서 고정자료에 어느 JVM 이 떴는지가 안 남는다 — 처음에 그렇게 떠서 JVM 칸이 비었다. */
const props = spawnSync(JAVA, ['-XshowSettings:properties', '-version'], { encoding: 'utf8' });
const verLine = (props.stderr || '')
    .split('\n').map((x) => x.trim())
    .filter((x) => x.startsWith('java.runtime.version') || x.startsWith('java.vm.name'))
    .join(' · ');
if (!verLine) { console.error('JVM 판을 읽지 못했다 — java 경로를 확인할 것'); process.exit(1); }

const base = flags([]);
const DEFAULTS = {
    MaxRAMPercentage: +base('MaxRAMPercentage'),
    MinRAMPercentage: +base('MinRAMPercentage'),
    InitialRAMPercentage: +base('InitialRAMPercentage'),
};

const rows = [];
for (const mb of RAMS) {
    const g = flags([`-XX:MaxRAM=${mb}m`]);
    rows.push({ mb, heap: +g('MaxHeapSize') });
}

const body = `/* ============================================================
   34편 검산 자료 — JVM 이 인쇄한 힙 인체공학 실측
   ------------------------------------------------------------
   **생성물이다. 손으로 고치지 말 것** — \`node tools/gen-heap-fixture.mjs <java>\` 가
   \`-XX:MaxRAM=N -XX:+PrintFlagsFinal\` 을 ${rows.length}번 불러 만든다.

   \`verify-heapergo.mjs\` 가 모델을 이 표와 견준다. 검사에 JDK 가 필요 없도록
   굳혀 둔 것이고, JDK 판이 바뀌면 다시 떠야 한다.

   뜬 JVM: ${verLine}
   ============================================================ */

/** 이 표를 인쇄한 JVM. 판이 바뀌었는지 사람이 알아볼 수 있게 남긴다. */
export const JVM = ${JSON.stringify(verLine)};

/** 그 JVM 의 기본값. 명세가 아니라 실측이다. */
export const DEFAULTS = ${JSON.stringify(DEFAULTS, null, 4)};

/** { mb: -XX:MaxRAM 값(MB), heap: 그때 인쇄된 MaxHeapSize(바이트) } */
export const SWEEP = [
${rows.map((r) => `    { mb: ${r.mb}, heap: ${r.heap} },`).join('\n')}
];
`;

writeFileSync(join(dirname(fileURLToPath(import.meta.url)), 'heap-fixture.mjs'), body);

console.log(`heap-fixture.mjs — ${rows.length}점`);
console.log(`  ${verLine}`);
console.log(`  기본값 Max ${DEFAULTS.MaxRAMPercentage}% · Min ${DEFAULTS.MinRAMPercentage}%`
    + ` · Initial ${DEFAULTS.InitialRAMPercentage}%`);
const mib = (b) => (b / 1048576).toFixed(1);
console.log(`  ${rows[0].mb}MB → ${mib(rows[0].heap)}MB … `
    + `${rows[rows.length - 1].mb}MB → ${mib(rows[rows.length - 1].heap)}MB`);
