/* ============================================================
   천문 계산 → public/data/sky.json
   실행: node tools/gen-sky.mjs   (frontends/dday-static 에서)
   ------------------------------------------------------------
   gen-holidays.mjs 와 달리 네트워크를 타지 않는다. tools/astro.mjs 가 전부
   계산하므로 이 단계는 언제 돌려도 같은 답이 나온다.

   자료가 한 벌뿐인 이유 — 절기도 삭망도 유성우도 전 세계가 같은 순간을 공유한다.
   204개국으로 쪼갤 것이 없다.

   ⚠ 순간은 UTC 이고 날짜는 시간대마다 갈린다. 2025년 동지는 UTC 12월 21일
   15:02 인데 한국에서는 12월 22일 00:02 다. 그래서 **날짜를 여기서 굳혀 둔다** —
   ko 페이지는 KST, en 페이지는 UTC. 브라우저가 다시 계산하면 HTML 에 박힌 날짜와
   갈라질 수 있으므로, 그 변환은 이 파일 한 군데에서만 한다.
   ============================================================ */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATA, YEARS, today } from './config.mjs';
import { solarTerms, moonPhases, showers, lunarMonths, TERM_NAMES } from './astro.mjs';

const years = YEARS();

/* 페이지의 기준 시간대. gen-pages.mjs 의 L.*.zone 과 반드시 같아야 한다. */
export const ZONES = { kst: 'Asia/Seoul', utc: 'UTC' };

const fmt = (at, tz) => new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
}).format(at);

/* '2026-09-08, 00:19' → { d: '2026-09-08', h: '00:19' } */
function local(at, tz) {
    const s = fmt(at, tz);
    return { d: s.slice(0, 10), h: s.slice(-5) };
}

/* 두 기준 시간대의 날짜·시각을 함께 담는다. 브라우저는 이걸 그대로 쓴다. */
function stamp(at) {
    const k = local(at, ZONES.kst), u = local(at, ZONES.utc);
    /* 초까지 담는다. 분에서 자르면 공표값과의 차이가 반올림에 묻혀,
       ΔT 를 통째로 빼먹어도 검사가 조용하다 — 실제로 그랬다. */
    return { t: at.toISOString().slice(0, 19) + 'Z', kst: k.d, kh: k.h, utc: u.d, uh: u.h };
}

/* 자정에 가까운 사건은 날짜가 뒤집힐 수 있다. 태양 쪽 오차는 1분 미만이고
   달 쪽은 그보다 작지만, 몇 분짜리 여유는 알고 있어야 한다. */
const CLOSE = 5;
const marginOf = (hhmm) => {
    const [h, m] = hhmm.split(':').map(Number);
    const t = h * 60 + m;
    return Math.min(t, 1440 - t);
};

/* 음력의 기준 시간대. **절기·삭망과 달리 이것은 자료의 일부다** — 음력은
   "삭이 든 날이 며칟날인가" 로 달이 갈리므로 시간대를 정해야 성립한다.
   한국 음력이라 KST 고, en 페이지도 같은 표를 본다(각주로 밝힌다). */
const LUNAR_TZ = ZONES.kst;

const terms = [], moons = [], rain = [], lunar = [];
for (const year of years) {
    for (const t of solarTerms(year)) {
        const nm = TERM_NAMES[t.k];
        terms.push({ ...stamp(t.at), k: t.k, n: nm.ko, h: nm.han, e: nm.en });
    }
    for (const p of moonPhases(year)) moons.push({ ...stamp(p.at), f: p.full ? 1 : 0 });
    for (const s of showers(year)) {
        rain.push({ ...stamp(s.at), id: s.id, n: s.ko, e: s.en, z: s.zhr });
    }
    /* 음력 달은 순간이 아니라 날짜라 stamp() 를 쓰지 않는다 — 굳힐 시간대가
       하나뿐이고 시각이 없다. s(초하루) 와 n(길이)만 담는다. */
    for (const mo of lunarMonths(year, LUNAR_TZ)) lunar.push(mo);
}

/* 자료 자체가 앞뒤가 맞는지 여기서 한 번 본다. check-pages 가 다시 보지만,
   틀린 자료를 페이지로 만들어 놓고 나중에 잡는 것보다 여기서 멈추는 게 낫다. */
const fail = [];
if (terms.length !== years.length * 24) fail.push(`절기가 ${terms.length}건 — ${years.length * 24}건이어야 한다`);
for (let i = 1; i < terms.length; i++) {
    const gap = (Date.parse(terms[i].t) - Date.parse(terms[i - 1].t)) / 86400000;
    if (gap < 14 || gap > 16.5) fail.push(`절기 간격이 ${gap.toFixed(1)}일 — ${terms[i - 1].n}→${terms[i].n}`);
}
for (let i = 1; i < moons.length; i++) {
    if (moons[i].f === moons[i - 1].f) fail.push(`삭망이 연달아 같다 — ${moons[i].t}`);
}
/* 음력. 초하루가 삭이 든 날인지가 규칙의 절반이므로 여기서 바로 견준다 —
   같은 파일 안의 moons 로 되짚을 수 있는 검산이라 페이지까지 갈 이유가 없다.
   해의 경계에서 시작한 달은 다음 해 표의 첫 달로 이어지므로 통째로 이어 본다. */
{
    const newMoonDays = new Set(moons.filter((m) => !m.f).map((m) => m.kst));
    const day = (iso) => Math.round(Date.parse(iso + 'T00:00:00Z') / 86400000);
    for (const mo of lunar) {
        if (mo.n !== 29 && mo.n !== 30) fail.push(`음력 ${mo.y}/${mo.m} 이 ${mo.n}일이다`);
        /* 자료가 담은 해의 삭만 갖고 있으므로 양 끝 달은 견줄 짝이 없다 */
        const inRange = years.includes(+mo.s.slice(0, 4));
        if (inRange && !newMoonDays.has(mo.s)) {
            fail.push(`음력 ${mo.y}/${mo.m} 의 초하루 ${mo.s} 에 삭이 없다`);
        }
    }
    for (let i = 1; i < lunar.length; i++) {
        const gap = day(lunar[i].s) - day(lunar[i - 1].s);
        if (gap !== lunar[i - 1].n) {
            fail.push(`음력 달이 이어지지 않는다 — ${lunar[i - 1].s}(${lunar[i - 1].n}일) → ${lunar[i].s}`);
        }
    }
    /* 한 음력 해는 12개월이거나 (윤달이 있으면) 13개월이다. 자료 창의 양 끝
       음력 해는 잘려 있으니 가운데 것만 본다. */
    const byLy = new Map();
    for (const mo of lunar) byLy.set(mo.y, (byLy.get(mo.y) || 0) + 1);
    const lys = [...byLy.keys()].sort((a, b) => a - b).slice(1, -1);
    for (const ly of lys) {
        const n = byLy.get(ly);
        if (n !== 12 && n !== 13) fail.push(`음력 ${ly}년이 ${n}개월이다`);
        const leaps = lunar.filter((mo) => mo.y === ly && mo.leap).length;
        if (leaps !== (n === 13 ? 1 : 0)) fail.push(`음력 ${ly}년(${n}개월)에 윤달이 ${leaps}개다`);
    }
}
if (fail.length) {
    console.error('천문 자료가 앞뒤가 맞지 않는다:');
    for (const f of fail.slice(0, 10)) console.error('  ✗', f);
    process.exit(1);
}

const sky = {
    generated: today(),
    years,
    zones: ZONES,
    lunarZone: LUNAR_TZ,
    terms, moons, showers: rain, lunar,
};
writeFileSync(join(DATA, 'sky.json'), JSON.stringify(sky) + '\n');

const size = (JSON.stringify(sky).length / 1024).toFixed(1);
console.log(`sky.json — 절기 ${terms.length} · 삭망 ${moons.length} · 유성우 ${rain.length}`
    + ` · 음력 ${lunar.length}개월(윤달 ${lunar.filter((m) => m.leap).length}) (${size}KB)`);

/* 얇은 자리를 알려 준다. 막지는 않는다 — 계산은 맞고, 그저 여유가 적을 뿐이다. */
for (const [zone, key] of [['KST', 'kh'], ['UTC', 'uh']]) {
    const tight = [...terms, ...moons, ...rain]
        .map((e) => ({ e, m: marginOf(e[key]) }))
        .filter((x) => x.m <= CLOSE)
        .sort((a, b) => a.m - b.m);
    if (tight.length) {
        console.log(`  ${zone} 자정에서 ${CLOSE}분 이내 ${tight.length}건 — 가장 얇은 것 ${tight[0].m}분 (${tight[0].e.t})`);
    }
}
