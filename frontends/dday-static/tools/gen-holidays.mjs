/* ============================================================
   Nager.Date → public/data/*.json
   실행: node tools/gen-holidays.mjs   (frontends/dday-static 에서)
   ------------------------------------------------------------
   이 저장소에서 유일하게 네트워크를 타는 단계이고, 빌드 타임에만 돈다.
   배포되는 사이트에는 여기서 만든 JSON 만 올라가므로 런타임 외부 의존이 0 이다.

   국가당 파일을 따로 쓰는 이유 — 브라우저는 고른 국가 하나만 받는다.
   전부 한 파일에 담으면 대한민국 공휴일을 보려고 204개국을 내려받게 된다.

   필드 이름이 한 글자인 것도 같은 이유다. 204개 × 3년치라 키 이름이 곧 용량이다.
     d 날짜 · n 현지어 이름 · e 영어 이름(현지어와 같으면 생략) · r 지역 한정 코드
   ============================================================ */
import { writeFileSync, mkdirSync, rmSync, existsSync, readdirSync } from 'node:fs';
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
            return await res.json();
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

    return {
        code: cc,
        name,
        ko: koName.of(cc) || name,
        years: gotYears,
        generated: generatedOn,
        days: list,
    };
}

/* ------------------------------------------------------------------ 실행 */

console.log(`Nager.Date → ${years.join(' · ')}`);
const countries = await getJson(`${NAGER}/AvailableCountries`);
if (!countries?.length) { console.error('AvailableCountries 를 못 받았다'); process.exit(1); }
console.log(`대상 국가 ${countries.length}개, 요청 ${countries.length * years.length}건`);

const built = await pool(countries, async (c, i) => {
    const out = await buildCountry(c);
    if ((i + 1) % 25 === 0) console.log(`  ${i + 1}/${countries.length}`);
    return out;
});

/* 공휴일이 하나도 없는 국가는 페이지를 만들 게 없다 — 목록에서도 뺀다.
   조용히 빠지면 나중에 왜 없는지 알 수 없으니 남은 수를 찍는다. */
const usable = built.filter(c => c.days.length > 0);
const empty = built.filter(c => c.days.length === 0).map(c => c.code);

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

const total = usable.reduce((n, c) => n + c.days.length, 0);
console.log(`\n국가 ${usable.length}개 · 공휴일 ${total}건 · data/ 파일 ${readdirSync(DATA).length}개`);
if (empty.length) console.log(`Public 공휴일 0건이라 제외: ${empty.join(', ')}`);
