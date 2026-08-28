/* ============================================================
   천문 계산 — 절기 · 삭망 · 유성우 극대기
   ------------------------------------------------------------
   네트워크도 의존성도 없다. 순수 함수뿐이라 gen-sky.mjs 와 check-pages.mjs 가
   같은 것을 서로 다른 방향에서 쓴다.

   태양은 VSOP87D 절단본(tools/vsop87.mjs)을 쓴다. Meeus 저정밀식(0.01°)으로
   시작했다가 바꾼 이유가 있다 — 2025년 동지가 KST 자정 정각에 떨어져서,
   15분 오차로는 날짜가 12월 21일인지 22일인지 정할 수 없었다.
   지금은 공표값과 1분 안에 든다.

   달은 Meeus 제49장(삭망)이다. 이쪽은 처음부터 충분했다 — 2027년 중국 춘절이
   삭 4분 뒤에 걸리는 해인데 그것을 맞힌다.
   ============================================================ */
import { L, B, R } from './vsop87.mjs';

const RAD = Math.PI / 180, DEG = 180 / Math.PI;
const sin = (d) => Math.sin(d * RAD);
export const norm = (d) => ((d % 360) + 360) % 360;

export const JD_UNIX = 2440587.5;
export const jdToDate = (jd) => new Date((jd - JD_UNIX) * 86400000);
export const dateToJd = (d) => d.getTime() / 86400000 + JD_UNIX;

/* ΔT (TT − UT). Espenak–Meeus 2005–2050 식. 2026년에 약 75초다.
   날짜를 가르는 데는 넉넉하지만, 안 넣으면 그만큼 통째로 밀린다. */
export const deltaT = (y) => { const t = y - 2000; return 62.92 + 0.32217 * t + 0.005589 * t * t; };

/* Σ_p τ^p · Σ_i A cos(B + C τ) */
function series(tab, tau) {
    let total = 0;
    for (const p of Object.keys(tab)) {
        let s = 0;
        for (const [a, b, c] of tab[p]) s += a * Math.cos(b + c * tau);
        total += s * tau ** p;
    }
    return total;
}

/** 태양의 겉보기 황경(도). jde 는 역학시(TT) 율리우스일. */
export function solarLongitude(jde) {
    const tau = (jde - 2451545.0) / 365250;
    const T = tau * 10;

    /* 지구의 황경 → 태양은 그 반대편 */
    let O = norm(series(L, tau) * DEG + 180);
    O += -0.09033 / 3600;                          /* VSOP87 → FK5 (Meeus 25.9) */

    /* 장동(주요 4항) + 광행차. 광행차는 동경거리에 반비례한다. */
    const Om = 125.04452 - 1934.136261 * T;
    const Ls = 280.4665 + 36000.7698 * T;
    const Lm = 218.3165 + 481267.8813 * T;
    const dpsi = (-17.1996 * sin(Om) - 1.3187 * sin(2 * Ls)
                  - 0.2274 * sin(2 * Lm) + 0.2062 * sin(2 * Om)) / 3600;
    const aberration = -20.4898 / series(R, tau) / 3600;

    return norm(O + dpsi + aberration);
}

/** 태양의 황위(도). 지금 화면에는 안 쓰지만 급수를 담아 두었으니 함께 내놓는다. */
export const solarLatitude = (jde) => -series(B, (jde - 2451545.0) / 365250) * DEG;

/** 겉보기 황경이 target(도) 이 되는 순간. 태양은 하루에 약 0.9856° 간다. */
export function whenLongitude(target, guessJde) {
    let jde = guessJde;
    for (let i = 0; i < 80; i++) {
        let d = solarLongitude(jde) - target;
        if (d > 180) d -= 360;
        if (d < -180) d += 360;
        if (Math.abs(d) < 1e-11) break;
        jde -= d / 0.9856473;
    }
    return jde;
}

/* 24절기의 이름. 자리(k)가 곧 황경/15 라 순서가 곧 정의다 —
   k=0 이 춘분(황경 0°)이고 전통적인 첫 절기 입춘은 315°, 곧 k=21 이다. */
export const TERM_NAMES = [
    { ko: '춘분', han: '春分', en: 'Vernal Equinox' },
    { ko: '청명', han: '淸明', en: 'Clear and Bright' },
    { ko: '곡우', han: '穀雨', en: 'Grain Rain' },
    { ko: '입하', han: '立夏', en: 'Start of Summer' },
    { ko: '소만', han: '小滿', en: 'Grain Full' },
    { ko: '망종', han: '芒種', en: 'Grain in Ear' },
    { ko: '하지', han: '夏至', en: 'Summer Solstice' },
    { ko: '소서', han: '小暑', en: 'Minor Heat' },
    { ko: '대서', han: '大暑', en: 'Major Heat' },
    { ko: '입추', han: '立秋', en: 'Start of Autumn' },
    { ko: '처서', han: '處暑', en: 'End of Heat' },
    { ko: '백로', han: '白露', en: 'White Dew' },
    { ko: '추분', han: '秋分', en: 'Autumnal Equinox' },
    { ko: '한로', han: '寒露', en: 'Cold Dew' },
    { ko: '상강', han: '霜降', en: 'Frost Descent' },
    { ko: '입동', han: '立冬', en: 'Start of Winter' },
    { ko: '소설', han: '小雪', en: 'Minor Snow' },
    { ko: '대설', han: '大雪', en: 'Major Snow' },
    { ko: '동지', han: '冬至', en: 'Winter Solstice' },
    { ko: '소한', han: '小寒', en: 'Minor Cold' },
    { ko: '대한', han: '大寒', en: 'Major Cold' },
    { ko: '입춘', han: '立春', en: 'Start of Spring' },
    { ko: '우수', han: '雨水', en: 'Rain Water' },
    { ko: '경칩', han: '驚蟄', en: 'Awakening of Insects' },
];

/* 분점 둘과 지점 둘. 표에 배지를 달고 check-pages 가 개수를 센다. */
export const CARDINAL = { 0: 'equinox', 6: 'solstice', 12: 'equinox', 18: 'solstice' };

/** 절기 하나의 UT 순간. k 는 황경/15 (0=춘분 · 6=하지 · 12=추분 · 18=동지). */
export function solarTermAt(year, k) {
    /* 춘분은 3월 20일 언저리, 그 뒤로 15°마다 약 15.2일 */
    const guess = dateToJd(new Date(Date.UTC(year, 2, 20))) + k * 15.21;
    return jdToDate(whenLongitude(k * 15, guess) - deltaT(year) / 86400);
}

/** 그 해(UTC 기준)에 드는 24절기 전부. */
export function solarTerms(year) {
    const out = [];
    for (let k = 0; k < 24; k++) {
        for (const y of [year - 1, year, year + 1]) {
            const at = solarTermAt(y, k);
            if (at.getUTCFullYear() === year) out.push({ k, at });
        }
    }
    return out.sort((a, b) => a.at - b.at);
}

/* ------------------------------------------------------------------ 삭망
   Meeus 제49장. k 가 정수면 삭, +0.5 면 망이다. */
const NEW_ARGS = [
    [-0.40720, 'Mp', 0], [0.17241, 'M', 1], [0.01608, '2Mp', 0], [0.01039, '2F', 0],
    [0.00739, 'Mp-M', 1], [-0.00514, 'Mp+M', 1], [0.00208, '2M', 2], [-0.00111, 'Mp-2F', 0],
    [-0.00057, 'Mp+2F', 0], [0.00056, '2Mp+M', 1], [-0.00042, '3Mp', 0], [0.00042, 'M+2F', 1],
    [0.00038, 'M-2F', 1], [-0.00024, '2Mp-M', 1], [-0.00017, 'O', 0], [-0.00007, 'Mp+2M', 0],
    [0.00004, '2Mp-2F', 0], [0.00004, '3M', 0], [0.00003, 'Mp+M-2F', 0], [0.00003, '2Mp+2F', 0],
    [-0.00003, 'Mp+M+2F', 0], [0.00003, 'Mp-M+2F', 0], [-0.00002, 'Mp-M-2F', 0],
    [-0.00002, '3Mp+M', 0], [0.00002, '4Mp', 0],
];
/* 망은 앞 일곱 항만 계수가 다르고 나머지는 같다 */
const FULL_HEAD = [-0.40614, 0.17302, 0.01614, 0.01043, 0.00734, -0.00515, 0.00209];
const FULL_ARGS = NEW_ARGS.map((t, i) => (i < FULL_HEAD.length ? [FULL_HEAD[i], t[1], t[2]] : t));

/* 행성 섭동 보정 (Meeus 표 49.A 뒤의 추가항) */
const PLANETARY = [
    [0.000325, 299.77, 0.107408, -0.009173], [0.000165, 251.88, 0.016321, 0],
    [0.000164, 251.83, 26.651886, 0], [0.000126, 349.42, 36.412478, 0],
    [0.000110, 84.66, 18.206239, 0], [0.000062, 141.74, 53.303771, 0],
    [0.000060, 207.14, 2.453732, 0], [0.000056, 154.84, 7.306860, 0],
    [0.000047, 34.52, 27.261239, 0], [0.000042, 207.19, 0.121824, 0],
    [0.000040, 291.34, 1.844379, 0], [0.000037, 161.72, 24.198154, 0],
    [0.000035, 239.56, 25.513099, 0], [0.000023, 331.55, 3.592518, 0],
];

function phaseJde(k, full) {
    const T = k / 1236.85;
    const mean = 2451550.09766 + 29.530588861 * k
        + 0.00015437 * T ** 2 - 0.000000150 * T ** 3 + 0.00000000073 * T ** 4;
    const E = 1 - 0.002516 * T - 0.0000074 * T ** 2;
    const M = 2.5534 + 29.10535670 * k - 0.0000014 * T ** 2 - 0.00000011 * T ** 3;
    const Mp = 201.5643 + 385.81693528 * k + 0.0107582 * T ** 2
        + 0.00001238 * T ** 3 - 0.000000058 * T ** 4;
    const F = 160.7108 + 390.67050284 * k - 0.0016118 * T ** 2
        - 0.00000227 * T ** 3 + 0.000000011 * T ** 4;
    const O = 124.7746 - 1.56375588 * k + 0.0020672 * T ** 2 + 0.00000215 * T ** 3;

    const ARG = {
        Mp, M, O, '2Mp': 2 * Mp, '2F': 2 * F, '2M': 2 * M, '3Mp': 3 * Mp, '3M': 3 * M,
        '4Mp': 4 * Mp, 'Mp-M': Mp - M, 'Mp+M': Mp + M, 'Mp-2F': Mp - 2 * F,
        'Mp+2F': Mp + 2 * F, '2Mp+M': 2 * Mp + M, '2Mp-M': 2 * Mp - M, 'M+2F': M + 2 * F,
        'M-2F': M - 2 * F, 'Mp+2M': Mp + 2 * M, '2Mp-2F': 2 * Mp - 2 * F,
        '2Mp+2F': 2 * Mp + 2 * F, 'Mp+M-2F': Mp + M - 2 * F, 'Mp+M+2F': Mp + M + 2 * F,
        'Mp-M+2F': Mp - M + 2 * F, 'Mp-M-2F': Mp - M - 2 * F, '3Mp+M': 3 * Mp + M,
    };

    let corr = 0;
    for (const [c, arg, e] of (full ? FULL_ARGS : NEW_ARGS)) corr += c * E ** e * sin(ARG[arg]);
    for (const [c, a, b, q] of PLANETARY) corr += c * sin(a + b * k + q * T ** 2);
    return mean + corr;
}

/** 그 해(UTC 기준)에 드는 삭과 망 전부. */
export function moonPhases(year) {
    const out = [];
    const k0 = Math.floor((year - 2000) * 12.3685) - 2;
    for (let i = 0; i < 20; i++) {
        for (const full of [false, true]) {
            const k = k0 + i + (full ? 0.5 : 0);
            const at = jdToDate(phaseJde(k, full) - deltaT(year) / 86400);
            if (at.getUTCFullYear() === year) out.push({ full, at });
        }
    }
    return out.sort((a, b) => a.at - b.at);
}

/* --------------------------------------------------------- 유성우 극대기
   날짜를 손으로 적지 않는다. 국제유성기구(IMO)는 극대기를 **태양 황경**으로
   정의하므로, 위에서 검증한 태양 계산에 그 황경을 넣으면 해마다 맞는 날짜가
   나온다 — 해가 바뀌어도 이 표를 고칠 일이 없다.

   그래도 이 표 자체는 받아 적은 것이고 견줄 두 번째 점이 없다. lon 이 틀리면
   조용히 며칠 어긋난다. 그래서 check-pages 는 "널리 알려진 달·일" 안에 드는지만
   본다 — 정밀 검산이 아니라 오타 방지다. 게이트 4번을 통과하지 못한 자료라는
   사실을 docs/todo.md 에도 적어 두었다. */
export const SHOWERS = [
    { id: 'quadrantids',     lon: 283.15, ko: '사분의자리',    en: 'Quadrantids',        zhr: 110, win: [1, 3] },
    { id: 'lyrids',          lon: 32.32,  ko: '거문고자리',    en: 'Lyrids',             zhr: 18,  win: [4, 22] },
    { id: 'eta-aquariids',   lon: 45.5,   ko: '물병자리 에타', en: 'Eta Aquariids',      zhr: 50,  win: [5, 6] },
    { id: 'delta-aquariids', lon: 125,    ko: '물병자리 델타', en: 'Delta Aquariids',    zhr: 25,  win: [7, 30] },
    { id: 'perseids',        lon: 140.0,  ko: '페르세우스자리', en: 'Perseids',          zhr: 100, win: [8, 12] },
    { id: 'orionids',        lon: 208,    ko: '오리온자리',    en: 'Orionids',           zhr: 20,  win: [10, 21] },
    { id: 'taurids',         lon: 223,    ko: '황소자리 남쪽', en: 'Southern Taurids',   zhr: 5,   win: [11, 5] },
    { id: 'leonids',         lon: 235.27, ko: '사자자리',      en: 'Leonids',            zhr: 15,  win: [11, 17] },
    { id: 'geminids',        lon: 262.2,  ko: '쌍둥이자리',    en: 'Geminids',           zhr: 150, win: [12, 14] },
    { id: 'ursids',          lon: 270.7,  ko: '작은곰자리',    en: 'Ursids',             zhr: 10,  win: [12, 22] },
];

/** 그 해의 유성우 극대기 순간. */
export function showers(year) {
    const out = [];
    for (const s of SHOWERS) {
        for (const y of [year - 1, year, year + 1]) {
            const guess = dateToJd(new Date(Date.UTC(y, 2, 20))) + s.lon / 0.9856473;
            const at = jdToDate(whenLongitude(s.lon, guess) - deltaT(year) / 86400);
            if (at.getUTCFullYear() === year) out.push({ ...s, at });
        }
    }
    return out.sort((a, b) => a.at - b.at);
}
