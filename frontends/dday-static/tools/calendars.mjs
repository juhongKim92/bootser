/* ============================================================
   다른 달력 — 원화
   ------------------------------------------------------------
   `gen-sky.mjs` 가 새해 날짜를 계산해 `sky.json` 에 담고, `gen-pages.mjs` 가
   `/sky/calendar/` 를 만든다. `check-pages.mjs` 가 이 목록을 놓고 견준다.

   ------------------------------------------------------------ 손으로 적는 것

   **어느 달력을 실을지와 그 이름뿐이다.** 날짜 계산은 한 줄도 없다 — 그건 런타임의
   ICU(CLDR 달력 표)가 하고, 우리는 그 답을 굳혀서 검산한다. 국제 기념일이 죽은 이유가
   *"사실 자체를 손으로 적어야 한다"* 였는데, 여기서 손으로 적는 것은 라벨과 갈래뿐이고
   *"그 달력의 새해가 그레고리력 언제인가"* 는 전부 파생된다 — 이름 축과 같은 자리다.

   ------------------------------------------------------------ 두 갈래로 갈린다

   이 페이지의 축이 그것이다.

     · 천문이 정하는 달력   삭(히즈라 · 히브리 · 한국 음력)이나 춘분(페르시아 · 인도)에
                          묶여 있다. 그래서 새해가 그레고리력에서 해마다 움직이고,
                          **서력과의 차이가 상수가 아니다**
     · 연호만 바꾼 달력     불기 · 민국 · 레이와. 새해가 1월 1일이라 그레고리력과 나란히
                          가고, **차이가 정확히 상수**다 (−543 · +1911 · +2018)

   검산점도 그 갈래로 갈린다 — 앞쪽은 해 길이 불변식과 천문 교차검증, 뒤쪽은 상수다.

   ⚠ `numbered: false` 인 달력이 하나 있다. 한국 음력(단기)은 ICU 에서 해에 **번호가
   없다** — `year` 파트가 아예 안 나오고 `yearName`(간지, 병오)과 `relatedYear`(그레고리)
   만 나온다. "오늘이 몇 년인가" 를 물을 수 없는 달력이라 표에서 그 칸을 비운다.
   ============================================================ */

/** 이 페이지가 다루는 달력. `id` 는 ICU 달력 이름(BCP 47 `-u-ca-`)이다. */
export const CALS = [
    {
        id: 'dangi', kind: 'astro', numbered: false, janFirst: false,
        ko: '한국 음력', en: 'Korean lunisolar',
        nyKo: '설날', nyEn: 'Korean New Year',
        /* 삭이 든 날이 초하루다 — 이 저장소가 `/sky/lunar/` 에서 직접 계산하는 그 달력이다.
           그래서 **우리 계산과 ICU 를 견줄 수 있다**(gen-sky 의 검산점). */
        noteKo: '삭이 든 날이 초하루입니다. 이 사이트가 직접 계산하는 달력이기도 해서, 두 답을 견줄 수 있습니다.',
        noteEn: 'A month begins on the day of the new moon. This site computes that calendar itself, so the two answers can be compared.',
    },
    {
        id: 'islamic-umalqura', kind: 'astro', numbered: true, janFirst: false,
        ko: '히즈라력', en: 'Hijri',
        nyKo: '히즈라 새해', nyEn: 'Islamic New Year',
        noteKo: '열두 달이 모두 삭으로 돌고 윤달이 없습니다. 그래서 한 해가 354일이나 355일이고, 새해가 그레고리력에서 해마다 11일씩 앞당겨집니다.',
        noteEn: 'Twelve lunar months with no leap month, so a year runs 354 or 355 days and the new year moves about 11 days earlier each Gregorian year.',
    },
    {
        id: 'hebrew', kind: 'astro', numbered: true, janFirst: false,
        ko: '히브리력', en: 'Hebrew',
        nyKo: '로쉬 하샤나', nyEn: 'Rosh Hashanah',
        noteKo: '달로 돌면서 윤달로 계절을 붙잡습니다. 그래서 한 해가 353일에서 385일까지 갈립니다 — 이 표에서 가장 넓습니다.',
        noteEn: 'Lunar months kept in step with the seasons by a leap month, so a year runs anywhere from 353 to 385 days — the widest span in this table.',
    },
    {
        id: 'persian', kind: 'astro', numbered: true, janFirst: false,
        ko: '페르시아력', en: 'Solar Hijri',
        nyKo: '노루즈', nyEn: 'Nowruz',
        noteKo: '새해가 천문학으로 정해집니다 — 테헤란 표준시로 춘분이 정오 이전이면 그날, 이후면 다음날입니다. 이 사이트가 계산하는 춘분으로 그 규칙을 되짚을 수 있습니다.',
        noteEn: 'Its new year is fixed by astronomy — the day of the vernal equinox if that moment falls before noon in Tehran, otherwise the next day. The equinox this site computes can retrace that rule.',
    },
    {
        id: 'indian', kind: 'astro', numbered: true, janFirst: false,
        ko: '인도 사카력', en: 'Indian Saka',
        nyKo: '사카 새해', nyEn: 'Saka New Year',
        noteKo: '춘분 이튿날에서 시작하는 태양력입니다. 페르시아력과 하루 차이로 나란히 갑니다.',
        noteEn: 'A solar calendar starting the day after the equinox, running a day behind the Solar Hijri calendar.',
    },
    {
        id: 'ethiopic', kind: 'astro', numbered: true, janFirst: false,
        ko: '에티오피아력', en: 'Ethiopian',
        nyKo: '엔쿠타타시', nyEn: 'Enkutatash',
        noteKo: '서른 날짜리 열두 달에 닷새(윤년 엿새)짜리 열세 번째 달 파구메가 붙습니다. 서력과 7~8년 차이입니다.',
        noteEn: 'Twelve months of thirty days plus a thirteenth month, Pagumen, of five days (six in a leap year). It runs seven to eight years behind the Gregorian year.',
    },
    {
        id: 'coptic', kind: 'astro', numbered: true, janFirst: false,
        ko: '콥트력', en: 'Coptic',
        nyKo: '네이루즈', nyEn: 'Nayrouz',
        noteKo: '에티오피아력과 같은 날 새해를 맞습니다 — 뿌리가 같은 이집트 달력이라서요. 연호만 다릅니다.',
        noteEn: 'It begins its year on the same day as the Ethiopian calendar — both descend from the Egyptian calendar. Only the era number differs.',
    },
    /* 아래 셋은 새해가 1월 1일이라 새해 표에 들어가지 않는다. 서력과의 차이가
       **상수**라는 것이 이 셋의 전부이고, 그게 위 여섯과 갈리는 자리다. */
    {
        id: 'buddhist', kind: 'era', numbered: true, janFirst: true, offset: -543,
        ko: '불기', en: 'Buddhist',
        nyKo: '1월 1일', nyEn: '1 January',
        noteKo: '그레고리력에 543을 더한 것입니다. 태국·캄보디아·라오스가 씁니다.',
        noteEn: 'The Gregorian year plus 543, used in Thailand, Cambodia and Laos.',
    },
    {
        id: 'roc', kind: 'era', numbered: true, janFirst: true, offset: 1911,
        ko: '민국', en: 'Minguo',
        nyKo: '1월 1일', nyEn: '1 January',
        noteKo: '1912년을 1년으로 셉니다. 대만이 씁니다.',
        noteEn: 'Counts 1912 as year 1. Used in Taiwan.',
    },
    {
        id: 'japanese', kind: 'era', numbered: true, janFirst: true, offset: 2018,
        ko: '일본 연호', en: 'Japanese era',
        nyKo: '1월 1일', nyEn: '1 January',
        noteKo: '연호가 바뀌면 1년으로 되돌아갑니다. 레이와는 2019년 5월 1일에 시작했습니다 — 그래서 이 상수는 달력 규칙이 아니라 그날까지의 사실입니다.',
        noteEn: 'The count restarts at one when the era changes. Reiwa began on 1 May 2019 — so this offset is not a calendar rule but a fact that holds from that day.',
    },
];

/** 새해 표에 들어가는 것 — 새해가 1월 1일이 아닌 달력. */
export const NY_CALS = CALS.filter((c) => !c.janFirst);
/** 연호만 바꾼 것 — 서력과의 차이가 상수여야 한다. */
export const ERA_CALS = CALS.filter((c) => c.kind === 'era');

export const CAL_BY_ID = Object.fromEntries(CALS.map((c) => [c.id, c]));

/* ------------------------------------------------------------------ 도구
   ICU 에 묻는 얇은 판. **계산은 여기 없다** — 물어보는 방법만 있다.

   정오를 쓰는 이유: 달력 경계는 자정이고, 시간대나 서머타임 때문에 자정 근처를
   물으면 하루가 밀릴 수 있다. 정오면 어느 쪽으로도 12시간 여유가 있다. */
export const noonOf = (iso) => Date.parse(`${iso}T12:00:00Z`);

/** 그 순간이 그 달력으로 몇 년인가. 번호가 없는 달력(단기)은 null 이다. */
export function yearOf(cal, at) {
    const parts = new Intl.DateTimeFormat(`en-u-ca-${cal}`, { timeZone: 'UTC', year: 'numeric' })
        .formatToParts(at);
    const y = parts.find((p) => p.type === 'year');
    return y ? y.value : null;
}

/** 번호 대신 이름이 붙는 해(간지). 단기·중국력이 그렇다.
    ⚠ 언어를 받는다 — ICU 는 `en` 에 로마자(bing-wu)를, `ko` 에 한자음(병오)을 준다.
    간지를 우리가 세지 않고 물어보는 값이라, 표기도 물어봐야 짝이 맞는다. */
export function yearNameOf(cal, at, loc = 'en') {
    const parts = new Intl.DateTimeFormat(`${loc}-u-ca-${cal}`, { timeZone: 'UTC', dateStyle: 'full' })
        .formatToParts(at);
    const n = parts.find((p) => p.type === 'yearName');
    return n ? n.value : null;
}

/** 해가 바뀌는 순간을 찾는 열쇠. 번호가 있으면 번호, 없으면 간지+그레고리다. */
function stampOf(cal, at) {
    const parts = new Intl.DateTimeFormat(`en-u-ca-${cal}`, { timeZone: 'UTC', dateStyle: 'full' })
        .formatToParts(at);
    const pick = (t) => (parts.find((p) => p.type === t) || {}).value || '';
    return `${pick('year')}|${pick('era')}|${pick('yearName')}|${pick('relatedYear')}`;
}

/** ISO 날짜에 하루를 더한다. */
const plus = (iso, n) => new Date(noonOf(iso) + n * 86400e3).toISOString().slice(0, 10);

/**
 * 그 달력의 새해를 훑어 찾는다. `from`~`to` (ISO 날짜) 안에서 해가 바뀌는 날들이다.
 * 하루씩 훑는다 — 몇 천 번이라 빠르고, 달력마다 다른 규칙을 우리가 알 필요가 없다.
 */
export function newYears(cal, from, to) {
    const out = [];
    let prev = stampOf(cal, noonOf(from));
    for (let d = plus(from, 1); d <= to; d = plus(d, 1)) {
        const s = stampOf(cal, noonOf(d));
        if (s !== prev) {
            /* 번호가 없는 달력은 간지로 적는다 — ko·en 두 표기를 함께 담는다 */
            out.push({
                s: d,
                y: yearOf(cal, noonOf(d)),
                nk: yearNameOf(cal, noonOf(d), 'ko'),
                ne: yearNameOf(cal, noonOf(d), 'en'),
            });
            prev = s;
        }
    }
    return out;
}
