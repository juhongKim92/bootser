/* ============================================================
   Nager.Date → public/data/*.json
   실행: node tools/gen-holidays.mjs   (frontends/dday-static 에서)
   ------------------------------------------------------------
   이 저장소에서 유일하게 네트워크를 타는 단계이고, 빌드 타임에만 돈다.
   배포되는 사이트에는 여기서 만든 JSON 만 올라가므로 런타임 외부 의존이 0 이다.

   국가당 파일을 따로 쓰는 이유 — 브라우저는 고른 국가 하나만 받는다.
   전부 한 파일에 담으면 대한민국 공휴일을 보려고 204개국을 내려받게 된다.

   필드 이름이 한 글자인 것도 같은 이유다. 204개 × 3년치라 키 이름이 곧 용량이다.
     days  d 날짜 · n 현지어 이름 · e 영어 이름(현지어와 같으면 생략) · r 지역 한정 코드
     long  s 시작 · e 끝 · b 징검다리 날짜(없으면 생략)

   long 에 일수를 담지 않는 이유 — s 와 e 에서 나온다. 담아 두면 자료 안에서
   두 값이 갈라질 수 있고, 그러면 그것까지 검사해야 한다.
   ============================================================ */
import { writeFileSync, readFileSync, mkdirSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DATA, NAGER, CONCURRENCY, YEARS, isPublic, today } from './config.mjs';

const years = YEARS();
const generatedOn = today();
const koName = new Intl.DisplayNames(['ko'], { type: 'region' });

async function getJson(url, tries = 3) {
    for (let i = 1; i <= tries; i++) {
        try {
            const res = await fetch(url);
            if (res.status === 404) return null;           /* 그 해 데이터가 아직 없는 국가 */
            if (res.status === 429) { await sleep(1500 * i); continue; }
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            /* 200 인데 본문이 비어 오는 엔드포인트가 있다 (LongWeekend 가 그렇다).
               res.json() 은 거기서 SyntaxError 를 내는데, 그건 재시도해도 똑같다 —
               자료가 없는 것이므로 404 와 같이 다룬다. */
            const text = await res.text();
            if (!text.trim()) return null;
            return JSON.parse(text);
        } catch (e) {
            if (i === tries) throw new Error(`${url} — ${e.message}`);
            await sleep(700 * i);
        }
    }
    return null;
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/* 동시 요청을 CONCURRENCY 개로 묶는 최소 풀. 의존성을 늘리지 않으려고 직접 쓴다. */
async function pool(items, worker) {
    const out = new Array(items.length);
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
        while (true) {
            const i = next++;
            if (i >= items.length) return;
            out[i] = await worker(items[i], i);
        }
    }));
    return out;
}

/* counties 는 'US-CA' 처럼 ISO 3166-2 로 온다. 앞의 국가 코드는 파일마다 똑같으니 뗀다. */
const trimCounty = (code, cc) => (code.startsWith(cc + '-') ? code.slice(cc.length + 1) : code);

/* ------------------------------------------------------------- 날짜 셈
   'YYYY-MM-DD' 를 Date 로 바로 넘기면 시간대에 따라 하루가 밀린다.
   전부 "에폭 일수" 정수로만 다룬다. */
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const epochDay = (iso) => {
    const [y, m, d] = iso.split('-').map(Number);
    return Math.round(Date.UTC(y, m - 1, d) / 86400000);
};
const isoOf = (n) => new Date(n * 86400000).toISOString().slice(0, 10);
const spanOf = (s, e) => {
    const out = [];
    for (let n = epochDay(s); n <= epochDay(e); n++) out.push(isoOf(n));
    return out;
};

/* 버린 연휴를 세어 둔다. pool 이 동시에 돌지만 자바스크립트는 한 줄기라 안전하다. */
let dropped = 0, mismatched = 0;

/* ------------------------------------------------------------- 황금연휴
   같은 Nager 에 엔드포인트만 하나 더다. /LongWeekend/{year}/{cc} 가 공휴일과
   주말을, 필요하면 징검다리 하루를 끼워 3일 이상 이어지는 구간을 준다.
   주말이 어느 요일인지는 나라마다 다른데(이집트는 금·토) 그건 Nager 가 안다.

   우리가 담지 않은 공휴일에 걸린 연휴는 버린다. Nager 의 LongWeekend 는 types 를
   가리지 않는데 우리 표에는 Public 만 있어서, 그대로 실으면 표에 없는 날을 근거로
   "5일 연휴" 라고 적는 페이지가 나온다 — 페이지 안에서 앞뒤가 안 맞는다. */
async function buildBreaks(cc, gotYears, holidays) {
    const found = new Map();                           /* 'start|end' → 항목 */

    for (const year of gotYears) {
        const raw = await getJson(`${NAGER}/LongWeekend/${year}/${cc}`);
        if (!Array.isArray(raw) || !raw.length) continue;

        for (const w of raw) {
            if (!ISO.test(w.startDate || '') || !ISO.test(w.endDate || '')) continue;
            if (epochDay(w.endDate) < epochDay(w.startDate)) continue;

            const span = spanOf(w.startDate, w.endDate);
            if (span.length < 3) continue;             /* 3일 미만은 연휴라 부르지 않는다 */
            if (w.dayCount && w.dayCount !== span.length) mismatched++;
            if (!span.some((d) => holidays.has(d))) { dropped++; continue; }

            const item = { s: w.startDate, e: w.endDate };
            /* 징검다리는 "쉬는 날이 아닌데 하루 쓰면 이어지는 날" 이다.
               공휴일이 징검다리로 들어오면 그건 징검다리가 아니다. */
            const bridge = (w.bridgeDays || [])
                .filter((d) => ISO.test(d) && span.includes(d) && !holidays.has(d))
                .sort();
            if (bridge.length) item.b = bridge;

            /* 연말에 걸친 연휴는 두 해의 응답에 다 들어온다 */
            found.set(`${item.s}|${item.e}`, item);
        }
    }

    return [...found.values()].sort((a, b) => a.s.localeCompare(b.s));
}

async function buildCountry({ countryCode: cc, name }) {
    const days = [];
    const gotYears = [];

    for (const year of years) {
        const raw = await getJson(`${NAGER}/PublicHolidays/${year}/${cc}`);
        if (!raw || !raw.length) continue;                 /* 익년 미확정 국가는 조용히 건너뛴다 */
        gotYears.push(year);
        for (const h of raw.filter(isPublic)) {
            const day = { d: h.date, n: h.localName };
            if (h.name && h.name !== h.localName) day.e = h.name;
            if (h.global === false && h.counties?.length) {
                day.r = h.counties.map(c => trimCounty(c, cc));
            }
            days.push(day);
        }
    }

    /* 같은 날 같은 이름이 두 번 오는 경우가 있다 (지역별로 쪼개져 들어올 때).
       날짜+이름으로 합치고 지역 코드는 합집합을 취한다. */
    const merged = new Map();
    for (const day of days) {
        const key = `${day.d}|${day.n}`;
        const prev = merged.get(key);
        if (!prev) { merged.set(key, day); continue; }
        if (prev.r && day.r) prev.r = [...new Set([...prev.r, ...day.r])];
        else delete prev.r;                                /* 한쪽이 전국이면 전국이다 */
    }

    const list = [...merged.values()].sort((a, b) => a.d.localeCompare(b.d));
    for (const day of list) if (day.r) day.r.sort();

    /* 공휴일이 하나도 없으면 연휴도 없다 — 요청을 아낀다 */
    const breaks = list.length ? await buildBreaks(cc, gotYears, new Set(list.map((d) => d.d))) : [];

    return {
        code: cc,
        name,
        ko: koName.of(cc) || name,
        years: gotYears,
        generated: generatedOn,
        days: list,
        long: breaks,
    };
}

/* ------------------------------------------------------------------ 실행 */

console.log(`Nager.Date → ${years.join(' · ')}`);
const countries = await getJson(`${NAGER}/AvailableCountries`);
if (!countries?.length) { console.error('AvailableCountries 를 못 받았다'); process.exit(1); }
console.log(`대상 국가 ${countries.length}개, 요청 ${countries.length * years.length * 2}건 (공휴일 · 황금연휴)`);

const built = await pool(countries, async (c, i) => {
    const out = await buildCountry(c);
    if ((i + 1) % 25 === 0) console.log(`  ${i + 1}/${countries.length}`);
    return out;
});

/* 공휴일이 하나도 없는 국가는 페이지를 만들 게 없다 — 목록에서도 뺀다.
   조용히 빠지면 나중에 왜 없는지 알 수 없으니 남은 수를 찍는다. */
const usable = built.filter(c => c.days.length > 0);
const empty = built.filter(c => c.days.length === 0).map(c => c.code);

/* 급격히 줄었으면 멈춘다.
   이 스크립트는 매달 사람 없이 도는데, 아래에서 data/ 를 통째로 지우고 새로 쓴다.
   Nager 가 잠시 절반만 돌려주는 날이 있으면 국가 페이지 100개가 조용히 사라지고,
   1:1 대응은 그대로라 check-pages 도 통과한다. 그때 알아챌 방법이 없다.

   진짜로 줄어든 것이라면 --allow-shrink 로 넘긴다. */
const before = existsSync(join(DATA, 'countries.json'))
    ? JSON.parse(readFileSync(join(DATA, 'countries.json'), 'utf8')).length
    : 0;
const FLOOR = 0.9;
if (before && usable.length < before * FLOOR && !process.argv.includes('--allow-shrink')) {
    console.error(`국가가 ${before}개에서 ${usable.length}개로 줄었다 — Nager 응답이 온전한지 확인할 것.`);
    console.error('진짜로 줄어든 것이라면: node tools/gen-holidays.mjs --allow-shrink');
    process.exit(1);
}

/* 데이터 디렉터리는 통째로 다시 만든다. 그래야 Nager 에서 사라진 국가의
   파일이 남아 sitemap 에 유령 URL 로 들어가는 일이 없다. */
if (existsSync(DATA)) rmSync(DATA, { recursive: true });
mkdirSync(DATA, { recursive: true });

for (const c of usable) {
    writeFileSync(join(DATA, `${c.code}.json`), JSON.stringify(c) + '\n');
}

const index = usable
    .map(c => ({ code: c.code, name: c.name, ko: c.ko, n: c.days.length }))
    .sort((a, b) => a.ko.localeCompare(b.ko, 'ko'));
writeFileSync(join(DATA, 'countries.json'), JSON.stringify(index) + '\n');

/* ------------------------------------------------------------ 날짜 색인
   "오늘 어느 나라가 쉬나" 는 국가별 파일로는 답할 수 없다 — 204개를 다 받아야 한다.
   그래서 같은 자료를 날짜로 한 번 더 색인해 둔다.

   달 단위로 쪼개는 이유. 하루 단위면 파일이 973개가 되고, 통째로 한 파일이면
   900KB 를 받아 그중 하루치만 쓴다. 달 파일은 36개에 평균 200여 건이라
   브라우저가 이번 달 하나만 받으면 된다.

   국가 이름은 넣지 않는다 — countries.json 에 이미 있고 그 파일은 선택기가
   어차피 받는다. 여기 또 넣으면 이름이 두 군데가 되어 갈라진다. */
const months = new Map();
for (const c of usable) {
    for (const day of c.days) {
        const m = day.d.slice(0, 7);
        if (!months.has(m)) months.set(m, new Map());
        const byDay = months.get(m);
        if (!byDay.has(day.d)) byDay.set(day.d, []);

        const entry = { c: c.code, n: day.n };
        if (day.e) entry.e = day.e;
        if (day.r) entry.r = day.r;
        byDay.get(day.d).push(entry);
    }
}

const MONTHS = join(DATA, 'month');
mkdirSync(MONTHS, { recursive: true });
for (const [m, byDay] of months) {
    /* 나라 순서를 코드순으로 굳혀 둔다 — 자료가 안 바뀌었는데 diff 가 뜨면
       매달 갱신할 때 무엇이 진짜 바뀌었는지 보이지 않는다. */
    const d = {};
    for (const key of [...byDay.keys()].sort()) {
        d[key] = byDay.get(key).sort((a, b) => a.c.localeCompare(b.c));
    }
    writeFileSync(join(MONTHS, `${m}.json`), JSON.stringify({ m, d }) + '\n');
}

const total = usable.reduce((n, c) => n + c.days.length, 0);
const breaks = usable.reduce((n, c) => n + c.long.length, 0);
console.log(`\n국가 ${usable.length}개 · 공휴일 ${total}건 · 황금연휴 ${breaks}건`);
console.log(`data/ 파일 ${readdirSync(DATA).length}개 · data/month/ ${readdirSync(MONTHS).length}개`);
if (empty.length) console.log(`Public 공휴일 0건이라 제외: ${empty.join(', ')}`);
/* 조용히 버리면 다음 달에 왜 연휴가 줄었는지 알 수 없다 */
if (dropped) console.log(`우리가 담지 않은 공휴일에만 걸려 제외한 연휴 ${dropped}건`);
if (mismatched) console.log(`주의: Nager 의 dayCount 가 기간과 다른 연휴 ${mismatched}건 — 기간으로 셌다`);
const noBreak = usable.filter((c) => !c.long.length).map((c) => c.code);
if (noBreak.length) console.log(`3년간 황금연휴 0건: ${noBreak.join(', ')}`);
