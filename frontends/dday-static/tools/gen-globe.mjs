/* ============================================================
   Natural Earth → public/data/globe.json
   실행: node tools/gen-globe.mjs   (frontends/dday-static 에서)
   ------------------------------------------------------------
   첫 화면 오른쪽 여백에서 도는 지구본이 나라를 고르는 손잡이다. 그 지구본이
   쓰는 것은 **나라당 점 하나**뿐이다 — 국경 폴리곤이 아니다.

   왜 폴리곤이 아닌가. 이 사이트가 담은 204개국에는 소국이 많다. 110m 국경으로
   나라를 칠하면 몰타·싱가포르·나우루·바베이도스가 1px 이하가 되어 클릭이 안 된다.
   러시아는 쉽고 몰타는 못 고르는 지구본은 「나라 고르기」를 절반만 하는 것이다.
   점으로 두면 204개가 전부 동등하게 잡힌다. 국경 폴리곤이면 gzip 250KB 인데
   점은 1.7KB 다(대륙 윤곽 6.5KB 를 더해도 8.5KB).
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
    land110:      'ne_110m_land.geojson',                  /* 대륙 윤곽 */
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


/* ------------------------------------------------------------------ 대륙 윤곽

   점만으로는 어느 대륙인지 알기 어렵다. 그래서 해안선을 배경에 깐다.
   칠하지 않고 선으로만 긋는다 — 채우려면 링을 지평선에서 잘라 테두리를 따라
   이어 붙여야 하고, 그 이음이 어긋나면 대륙이 엉뚱한 모양으로 번진다.
   격자와 같은 방식(뒷면에서 끊고 다시 시작)이면 그 위험이 아예 없다.

   단순화 문턱 0.5° — 240px 지구본은 180° 를 240px 로 그리므로 1px 이 0.75° 다.
   0.5° 는 부화소라 눈에 보이지 않는다. 잰 값(Douglas–Peucker + 소수 첫째 자리):
     원본        링 128 · 꼭짓점 5,143
     0.5°        링 103 · 꼭짓점 1,634 · 17.5KB · gzip 6.5KB
   더 줄일 수도 있지만(1.0° 면 gzip 4KB) 1px 넘게 어긋나기 시작한다.

   검산점 둘 —
   1. **손으로 적은 육지·바다 검문 11개.** 서울은 육지, 남태평양은 바다처럼
      뻔한 지점을 박아 두고 단순화된 링으로 점-다각형 판정을 한다. 링이 깨지거나
      위경도가 맞바뀌면 여기서 걸린다. 자료를 받아 적는 검사가 아니라 자료가
      말하는 내용을 검사하는 것이다.
   2. **나라 점과의 대조 142/204.** 이미 검증한 점 자료를 이 링에 대 본다.
      섬나라·소국 62개는 110m 육지에 표현되지 않아 바다로 떨어지는 것이 맞다.
      그 수를 박아 두면 두 자료가 같은 좌표계에 있다는 것이 검사된다 —
      한쪽이 어긋나면 142 가 무너진다.
   ------------------------------------------------------------------ */

const LAND_TOL = 0.5;

/** Douglas–Peucker. 링 하나를 문턱보다 가는 굽이를 버리고 줄인다. */
function thin(ring, tol) {
    if (ring.length < 3) return ring;
    const keep = new Array(ring.length).fill(false);
    keep[0] = keep[ring.length - 1] = true;
    const stack = [[0, ring.length - 1]];
    while (stack.length) {
        const [a, b] = stack.pop();
        if (b - a < 2) continue;
        const [x1, y1] = ring[a], [x2, y2] = ring[b];
        const dx = x2 - x1, dy = y2 - y1, L = dx * dx + dy * dy;
        let far = -1, fd = 0;
        for (let i = a + 1; i < b; i++) {
            const [x, y] = ring[i];
            const t = L ? Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / L)) : 0;
            const d = Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy));
            if (d > fd) { fd = d; far = i; }
        }
        if (fd > tol) { keep[far] = true; stack.push([a, far], [far, b]); }
    }
    return ring.filter((_, i) => keep[i]);
}

/** 육지 링을 줄여 [lon, lat, lon, lat, ...] 로 펴 담는다. 링마다 한 배열이다. */
function coast(g) {
    const rings = [];
    for (const f of g.features) {
        const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
        for (const poly of polys) {
            for (const ring of poly) {
                const s = thin(ring, LAND_TOL)
                    .map((q) => [Math.round(q[0] * 10) / 10, Math.round(q[1] * 10) / 10]);
                /* 자리를 줄이면 이웃 꼭짓점이 같은 값이 된다 — 걷어 낸다 */
                const u = s.filter((q, i) => i === 0 || q[0] !== s[i - 1][0] || q[1] !== s[i - 1][1]);
                if (u.length >= 4) rings.push(u);
            }
        }
    }
    return rings;
}

const inLand = (rings, lon, lat) => rings.some((r) => inRing(r, lon, lat));

/* 뻔한 지점만 고른다. 해안 가까이를 박으면 단순화 문턱을 바꿀 때마다 흔들린다. */
const PROBES = [
    ['서울', 127.0, 37.6, true],
    ['사하라', 10, 25, true],
    ['아마존', -60, -5, true],
    ['시베리아', 100, 65, true],
    ['오스트레일리아 가운데', 134, -25, true],
    ['그린란드 안쪽', -42, 72, true],
    ['남극 대륙', 0, -85, true],
    ['남태평양', -140, -30, false],
    ['대서양 가운데', -30, 0, false],
    ['인도양', 80, -30, false],
    ['북극점 부근', 0, 89, false],
];

/** 나라 점 204개 중 몇 개가 단순화된 육지 위에 떨어지나. 이 수가 대조점이다. */
const ON_LAND = 142;

/* ------------------------------------------------------------------ 본체 */

const mine = JSON.parse(readFileSync(join(DATA, 'countries.json'), 'utf8'));
console.log(`나라 ${mine.length}개 · Natural Earth 를 받는다`);

const [c110, tiny, units, check, landGeo] = await Promise.all(
    ['countries110', 'tiny50', 'units50', 'check50', 'land110'].map(layer));

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

/* 대륙 윤곽 — 줄이고 검산한다 */
const land = coast(landGeo);
const landPts = land.reduce((n, r) => n + r.length, 0);

for (const [name, lon, lat, want] of PROBES) {
    if (inLand(land, lon, lat) !== want) {
        die.push(`육지 검문이 틀렸다 — ${name} [${lon}, ${lat}] 이 ${want ? '바다' : '육지'}로 나온다`);
    }
}

const onLand = out.filter(([, lon, lat]) => inLand(land, lon, lat)).length;
if (onLand !== ON_LAND) {
    die.push(`나라 점 중 육지에 떨어지는 것이 ${onLand}개 — ${ON_LAND}개여야 한다`
        + `\n      점 자료와 육지 자료가 같은 좌표계에 있는지를 이 수로 본다.`
        + ` 단순화 문턱(${LAND_TOL}°)을 바꿨다면 ON_LAND 도 같이 고칠 것`);
}

console.log(`대륙 윤곽 — 링 ${land.length}개 · 꼭짓점 ${landPts}개`
    + ` · 육지 검문 ${PROBES.length}개 통과 · 나라 점 ${onLand}/${out.length}개가 육지`);
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
writeFileSync(file, JSON.stringify({ g: today(), p: out, l: land.map((r) => r.flat()) }) + String.fromCharCode(10));
const bytes = readFileSync(file).length;
console.log(`globe.json — ${bytes}B (gzip 약 ${Math.round(bytes / 2.3)}B)`);
