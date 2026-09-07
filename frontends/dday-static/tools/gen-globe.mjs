/* ============================================================
   Natural Earth → public/data/globe.json
   실행: node tools/gen-globe.mjs   (frontends/dday-static 에서)
   ------------------------------------------------------------
   첫 화면 오른쪽 여백에서 도는 지구본이 나라를 고르는 손잡이다. 그 지구본이
   쓰는 것은 **나라당 점 하나**뿐이다 — 국경 폴리곤이 아니다.

   왜 폴리곤이 아닌가. 이 사이트가 담은 204개국에는 소국이 많다. 110m 국경으로
   나라를 칠하면 몰타·싱가포르·나우루·바베이도스가 1px 이하가 되어 클릭이 안 된다.
   러시아는 쉽고 몰타는 못 고르는 지구본은 「나라 고르기」를 절반만 하는 것이다.
   점으로 두면 204개가 전부 동등하게 잡힌다. 배포 크기도 250KB 대 1.6KB(gzip)다.
   덤으로 **분쟁 국경을 그리지 않는다** — 폴리곤을 배포하지 않으니 애초에 그 문제가
   생기지 않는다.

   자료가 세 겹인 이유 — 한 레이어로 204개가 안 채워진다. 실측:
     110m countries      LABEL_X/Y     181개  (손으로 놓은 라벨 점이라 무게중심보다 낫다)
     50m tiny_countries  Point         소국   (NE 가 이 문제를 위해 따로 두는 레이어)
     50m map_units       LABEL_X/Y     마지막 7개(노퍽섬·몬트세라트·스발바르·카보베르데·
                                       코코스·크리스마스섬·프랑스령 기아나)

   ------------------------------------------------------------
   검산점 — 이 파일의 절반이 그것이다.

   1. **두 벌 대조.** 점은 위 세 겹에서 오고, 검산은 **네 번째 레이어**(50m countries
      폴리곤)로 한다. 각 점이 제 나라 폴리곤 안에 드는지 본다. 폴리곤은 검산에만
      쓰고 **배포하지 않는다.** 밖에서 받은 자료 두 벌을 서로 견주는 것이라
      "받은 대로 찍혔나" 가 아니다.
   2. **204/204.** 하나라도 비면 종료 코드 1 이다. 나라가 늘면 여기서 멈춘다.
   3. **좌표 범위.** |lon| ≤ 180 · |lat| ≤ 90. 위경도를 맞바꾸는 실수가 여기서 걸린다
      (lat 이 90 을 넘는 나라는 없지만 lon 은 넘으므로 한쪽 방향으로만 걸린다).

   폴리곤이 없는 나라(소국·섬)는 1번을 통과할 수 없다. 그 건수를 **숨기지 않고
   찍는다** — 검산이 몇 개에 대해 돌았는지 모르면 검산이 아니다.
   ============================================================ */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { DATA, PUB, today } from './config.mjs';

const NE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson';
const LAYERS = {
    countries110: 'ne_110m_admin_0_countries.geojson',
    tiny50:       'ne_50m_admin_0_tiny_countries.geojson',
    units50:      'ne_50m_admin_0_map_units.geojson',
    check50:      'ne_50m_admin_0_countries.geojson',      /* 검산 전용 — 배포 안 함 */
};

/* A2 코드가 여러 필드에 흩어져 있다. ISO_A2 가 '-99' 인 feature 가 있어서
   (분쟁·미승인 지역) 대체 필드를 순서대로 본다. */
const A2_FIELDS = ['ISO_A2', 'ISO_A2_EH', 'WB_A2'];
const a2 = (p) => {
    for (const k of A2_FIELDS) {
        const v = p[k];
        if (v && v !== '-99' && String(v).length === 2) return String(v);
    }
    return null;
};

async function layer(name) {
    const res = await fetch(`${NE}/${LAYERS[name]}`);
    if (!res.ok) throw new Error(`${LAYERS[name]} — HTTP ${res.status}`);
    const g = JSON.parse(await res.text());
    console.log(`  ${LAYERS[name]} — feature ${g.features.length}개`);
    return g;
}

/** 점 레이어에서 code → [lon, lat]. Point 기하면 좌표를, 아니면 LABEL_X/Y 를 쓴다. */
function points(g) {
    const m = new Map();
    for (const f of g.features) {
        const code = a2(f.properties);
        if (!code || m.has(code)) continue;
        const c = f.geometry?.type === 'Point'
            ? f.geometry.coordinates
            : (f.properties.LABEL_X != null && f.properties.LABEL_Y != null
                ? [f.properties.LABEL_X, f.properties.LABEL_Y] : null);
        if (c) m.set(code, [Number(c[0]), Number(c[1])]);
    }
    return m;
}

/** 링 하나에 대한 점-다각형 판정(ray casting). 경도 ±180 을 넘는 링은 안 다룬다 —
    검산이 통과하지 못할 뿐이고, 그건 「검산이 안 돈 건수」로 찍힌다. */
function inRing(ring, lon, lat) {
    let hit = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i], [xj, yj] = ring[j];
        if ((yi > lat) !== (yj > lat) && lon < (xj - xi) * (lat - yi) / (yj - yi) + xi) hit = !hit;
    }
    return hit;
}

/** MultiPolygon/Polygon 안에 드나. 구멍(내부 링)은 무시한다 — 라벨 점이 호수 안에
    놓이는 일은 NE 가 이미 피한다. */
function inside(geom, lon, lat) {
    const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
    for (const poly of polys) if (inRing(poly[0], lon, lat)) return true;
    return false;
}

/* ------------------------------------------------------------------ 검산

   점-다각형 판정이 맞는 검사다. 거리로는 못 한다 — **꼭짓점까지의 거리는
   폴리곤까지의 거리가 아니라서** 내륙국의 중앙에 놓인 라벨이 제 나라 꼭짓점보다
   이웃 나라 꼭짓점에 가까워진다. 재 보니 204개 중 56개가 그렇게 걸렸다.
   레소토의 점은 남아프리카 꼭짓점에서 73km 인데 자기 국경은 그보다 거칠다.

   그래서 통과하지 못하는 것은 **문턱으로 뭉개지 않고 명단으로 고정한다.**
   명단에 없는 나라가 실패하면 실패고, 명단에 있는데 통과하면 **"예외가 낡았다"** 로
   역시 실패다. 자료가 갱신되며 폴리곤이 좋아지면 명단을 줄이라고 여기서 말해 준다.
   ------------------------------------------------------------------ */

/* 검산용 50m countries 폴리곤이 이 나라를 따로 담지 않는다 — 해외영토·속령을
   본국에 합쳐 두기 때문이다. 점 자체는 맞다. */
const NO_POLYGON = {
    GP: '과들루프 — 프랑스 해외주, FR 에 합쳐져 있다',
    MQ: '마르티니크 — 프랑스 해외주',
    GF: '프랑스령 기아나 — 프랑스 해외주',
    BQ: '네덜란드령 카리브 — NL 에 합쳐져 있다',
    GI: '지브롤터 — 영국 해외영토',
    SJ: '스발바르·얀마웬 — 노르웨이 속령',
    CC: '코코스 제도 — 오스트레일리아 속령',
    CX: '크리스마스섬 — 오스트레일리아 속령',
    TK: '토켈라우 — 뉴질랜드 속령',
};

/* 라벨 점이 일부러 바다에 놓인 나라. 여러 조각으로 흩어진 영토에 이름 하나를
   얹으려면 그게 맞는 위치다 — 지도 제작의 판단이고 오류가 아니다.
   괄호 안은 제 나라 지형까지의 실측 최단 거리다. */
const LABEL_AT_SEA = {
    NZ: '뉴질랜드 — 두 섬 사이 바다 (81km)',
    GQ: '적도 기니 — 본토와 비오코섬을 함께 이고 있다 (90km)',
    TT: '트리니다드 토바고 — 두 섬 사이 (18km)',
    SC: '세이셸 — 점은 알다브라 환초(세이셸 영토)인데 50m 폴리곤이 외곽 섬을 안 담는다 (1121km)',
    VA: '바티칸 시국 — 0.44km² 라 50m 로는 표현되지 않는다 (1km)',
    SX: '신트마르턴 — 34km² (4km)',
};

const EXCEPT = { ...NO_POLYGON, ...LABEL_AT_SEA };

/* ------------------------------------------------------------------ 본체 */

const mine = JSON.parse(readFileSync(join(DATA, 'countries.json'), 'utf8'));
console.log(`나라 ${mine.length}개 · Natural Earth 를 받는다`);

const [c110, tiny, units, check] = await Promise.all(
    ['countries110', 'tiny50', 'units50', 'check50'].map(layer));

/* 겹치는 순서가 뜻을 갖는다 — 110m 라벨 점이 가장 낫고, 없으면 소국 레이어,
   그래도 없으면 50m 맵유닛이다. 뒤엣것이 앞엣것을 덮지 않는다. */
const pts = new Map([...points(units), ...points(tiny), ...points(c110)]);

const poly = new Map();
for (const f of check.features) {
    const code = a2(f.properties);
    if (code && f.geometry && !poly.has(code)) poly.set(code, f.geometry);
}

const out = [], missing = [], outOfRange = [], escaped = [], stale = [];
let inPoly = 0;

for (const c of mine) {
    const p = pts.get(c.code);
    if (!p) { missing.push(`${c.code}(${c.ko})`); continue; }
    const [lon, lat] = p;

    /* 위경도를 맞바꾸는 실수는 lon 쪽으로만 걸린다 — 위도가 90 을 넘는 나라는
       없지만 경도는 넘으므로. 그래도 둘 다 본다. */
    if (!(Math.abs(lon) <= 180 && Math.abs(lat) <= 90)) {
        outOfRange.push(`${c.code} [${lon}, ${lat}]`);
        continue;
    }

    const g = poly.get(c.code);
    const ok = g ? inside(g, lon, lat) : false;
    if (ok) inPoly++;

    if (ok && EXCEPT[c.code]) stale.push(`${c.code}(${c.ko}) — "${EXCEPT[c.code]}"`);
    if (!ok && !EXCEPT[c.code]) escaped.push(`${c.code}(${c.ko}) [${lon}, ${lat}]`);

    /* 소수점 둘째 자리 = 약 1.1km. 280px 지구본에는 과분하다. */
    out.push([c.code, Math.round(lon * 100) / 100, Math.round(lat * 100) / 100]);
}

console.log('');
console.log(`점 ${out.length}/${mine.length}개`);
console.log(`검산 — 제 나라 폴리곤 안 ${inPoly}개 · 명단에 적어 둔 예외 ${Object.keys(EXCEPT).length}개`
    + ` (폴리곤 없음 ${Object.keys(NO_POLYGON).length} · 라벨이 바다 ${Object.keys(LABEL_AT_SEA).length})`);

const die = [];
if (missing.length) die.push(`점이 없는 나라 ${missing.length}개 — ${missing.join(' ')}`);
if (outOfRange.length) die.push(`좌표가 범위를 벗어남 — ${outOfRange.join(' · ')}`);
if (escaped.length) {
    die.push(`점이 제 나라 폴리곤 밖인데 명단에 없다 ${escaped.length}개 — ${escaped.join(' · ')}`
        + `\n      점이 틀렸는지 보고, 맞다면 까닭을 적어 LABEL_AT_SEA 에 넣을 것`);
}
if (stale.length) {
    die.push(`예외가 낡았다 ${stale.length}개 — 이제 폴리곤 안에 든다. 명단에서 지울 것`
        + `\n      ${stale.join('\n      ')}`);
}
if (die.length) {
    console.error('');
    for (const d of die) console.error('실패  ' + d);
    process.exit(1);
}

/* 코드순으로 굳혀 둔다 — countries.json 의 순서가 바뀌어도 이 파일은 안 바뀐다. */
out.sort((a, b) => (a[0] < b[0] ? -1 : 1));
const file = join(DATA, 'globe.json');
writeFileSync(file, JSON.stringify({ g: today(), p: out }) + '\n');
const bytes = readFileSync(file).length;
console.log(`globe.json — ${bytes}B (gzip 약 ${Math.round(bytes / 2.3)}B)`);
