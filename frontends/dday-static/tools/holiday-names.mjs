/* ============================================================
   이름 축의 원화 — 어느 공휴일 이름을 페이지로 세우고 한국어로 무엇이라 적나
   ------------------------------------------------------------
   `data/*.json` 안에 국가 축으로도 공통 축으로도 쓰이지 않은 축이 하나 있다.
   **공휴일 이름**이다. 크리스마스는 178개국이 같은 날 쉬고, 독립기념일은
   104개국이 저마다 다른 날 쉰다 — 둘 다 국가 페이지로는 답할 수 없는 물음이다.

   ⚠ 여기서 손으로 적는 것은 **라벨과 슬러그뿐이다.** 어느 나라가 언제 쉬는가는
   전부 `data/*.json` 에서 파생되고 `check-pages` 가 국가별 파일로 되짚는다.
   국제 기념일을 내린 이유(한국어 라벨이 30% 뿐이었다)가 여기서는 걸리지 않는
   까닭이 그것이다 — 라벨이 틀리면 화면에 보이고, 사실은 손으로 적지 않는다.

   ------------------------------------------------------------ 이름을 묶는 규칙

   Nager 의 이름은 표기가 고르지 않다. `All Saints' Day` · `All Saints Day` ·
   `All Saints’ Day` 가 다 있고(51개국이 세 갈래로 쪼개져 있었다), 그대로 세우면
   같은 축일이 얇은 페이지 셋으로 갈려 서로 잡아먹는다.

   그래서 **표기만 다른 것은 기계적으로 묶는다** — 소문자로 내리고 아포스트로피와
   구두점을 떼고 공백을 하나로 줄인 꼴(`NORM`)이 키다. 그 이상은 묶지 않는다:
   `Labour Day` 와 `Workers' Day` 와 `May Day` 는 낱말이 다르므로 따로 남는다.
   묶고 싶은 유혹이 있지만(노동절 하나로 160개국이 된다) 미국 Labor Day 는 9월이고
   영국 May Day 는 노동절이 아니다 — 뜻을 판단해 묶기 시작하면 그 판단이 어디서도
   검사되지 않는다. 표기 정규화는 규칙이고, 뜻으로 묶는 것은 의견이다.

   ------------------------------------------------------------ 늘고 줄 때

   문턱은 아래 `MIN` 이다 — 표지 연도에 이 수 이상의 나라가 같은 이름을 쓰면
   페이지를 세운다. 자료가 바뀌어 문턱을 새로 넘는 이름이 생기면 **`gen-pages` 가
   멈춘다.** 라벨이 없는 채로 지나가면 한국어 페이지에 영어 이름이 박히는데, 그건
   조용히 반쪽이 되는 종류의 고장이다.

   ------------------------------------------------------------ 자료는 어디에도 없다

   이름 축은 `data/` 에 파일을 하나도 더 만들지 않는다. `gen-pages.mjs` 가
   `data/*.json` 에서 그때그때 묶어 HTML 에 박고, `check-pages.mjs` 는 **자기 손으로
   다시 묶어** 그 HTML 과 견준다. 파생물을 저장해 두고 견주는 쪽(`data/month/*.json`)
   보다 검산점이 세다 — 묶는 코드를 나눠 쓰지 않으므로 둘이 같이 틀릴 수 없다.
   ============================================================ */

/** 표지 연도에 이 수 이상의 나라가 같은 이름을 쓰면 페이지를 세운다.
    5 로 두면 60개 이름이 걸린다. 낮추면 한두 나라만 있는 얇은 페이지가 늘고,
    높이면 "세계의 독립기념일" 같은 물음에 답할 페이지가 줄어든다. */
export const MIN = 5;

/** 표기 정규화. 이것이 이름을 묶는 유일한 규칙이다. */
export const NORM = (s) => String(s)
    .toLowerCase()
    .replace(/[‘’']/g, '')      /* 아포스트로피 — 곧은 것과 굽은 것 둘 다 */
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/* 정규화한 이름 → { slug, ko, en }
     slug  URL 조각. 두 글자면 안 된다(국가 코드와 부딪힌다) — gen-pages 가 확인한다.
     ko    한국어 라벨
     en    영어 라벨. Nager 의 여러 표기 중 우리가 대표로 삼는 하나다.

   순서는 표지 연도의 국가 수 내림차순이지만, 그 수가 여기 적혀 있지는 않다 —
   자료에서 나오는 값을 원화에 박아 두면 갈라진다. */
export const NAMES = {
    'new years day':              { slug: 'new-year',                 ko: '새해',                   en: "New Year's Day" },
    'christmas day':              { slug: 'christmas',                ko: '크리스마스',             en: 'Christmas Day' },
    'labour day':                 { slug: 'labour-day',               ko: '노동절',                 en: 'Labour Day' },
    'good friday':                { slug: 'good-friday',              ko: '성금요일',               en: 'Good Friday' },
    'easter monday':              { slug: 'easter-monday',            ko: '부활절 월요일',          en: 'Easter Monday' },
    'independence day':           { slug: 'independence-day',         ko: '독립기념일',             en: 'Independence Day' },
    'st stephens day':            { slug: 'st-stephens-day',          ko: '성 스테파노 축일',       en: "St. Stephen's Day" },
    'easter sunday':              { slug: 'easter-sunday',            ko: '부활절',                 en: 'Easter Sunday' },
    'whit monday':                { slug: 'whit-monday',              ko: '성령강림절 월요일',      en: 'Whit Monday' },
    'all saints day':             { slug: 'all-saints-day',           ko: '만성절',                 en: "All Saints' Day" },
    'ascension day':              { slug: 'ascension-day',            ko: '주님 승천 대축일',       en: 'Ascension Day' },
    'assumption day':             { slug: 'assumption-day',           ko: '성모 승천 대축일',       en: 'Assumption Day' },
    'constitution day':           { slug: 'constitution-day',         ko: '제헌절',                 en: 'Constitution Day' },
    'pentecost':                  { slug: 'pentecost',                ko: '성령강림절',             en: 'Pentecost' },
    'national day':               { slug: 'national-day',             ko: '국경일',                 en: 'National Day' },
    'epiphany':                   { slug: 'epiphany',                 ko: '주현절',                 en: 'Epiphany' },
    'emancipation day':           { slug: 'emancipation-day',         ko: '노예 해방 기념일',       en: 'Emancipation Day' },
    'corpus christi':             { slug: 'corpus-christi',           ko: '성체성혈 대축일',        en: 'Corpus Christi' },
    'christmas eve':              { slug: 'christmas-eve',            ko: '크리스마스 이브',        en: 'Christmas Eve' },
    'liberation day':             { slug: 'liberation-day',           ko: '해방 기념일',            en: 'Liberation Day' },
    'international womens day':   { slug: 'international-womens-day', ko: '국제 여성의 날',         en: "International Women's Day" },
    'boxing day':                 { slug: 'boxing-day',               ko: '박싱데이',               en: 'Boxing Day' },
    'holy saturday':              { slug: 'holy-saturday',            ko: '성토요일',               en: 'Holy Saturday' },
    'victory day':                { slug: 'victory-day',              ko: '전승 기념일',            en: 'Victory Day' },
    'maundy thursday':            { slug: 'maundy-thursday',          ko: '성목요일',               en: 'Maundy Thursday' },
    'republic day':               { slug: 'republic-day',             ko: '공화국 기념일',          en: 'Republic Day' },
    'immaculate conception':      { slug: 'immaculate-conception',    ko: '성모 무염시태',          en: 'Immaculate Conception' },
    'national heroes day':        { slug: 'national-heroes-day',      ko: '국가 영웅의 날',         en: "National Heroes' Day" },
    'martyrs day':                { slug: 'martyrs-day',              ko: '순국자의 날',            en: "Martyrs' Day" },
    'international workers day':  { slug: 'international-workers-day', ko: '국제 노동자의 날',      en: "International Workers' Day" },
    'new years eve':              { slug: 'new-years-eve',            ko: '새해 전야',              en: "New Year's Eve" },
    'armistice day':              { slug: 'armistice-day',            ko: '정전 기념일',            en: 'Armistice Day' },
    'may day':                    { slug: 'may-day',                  ko: '5월제',                  en: 'May Day' },
    'revolution day':             { slug: 'revolution-day',           ko: '혁명 기념일',            en: 'Revolution Day' },
    'kings birthday':             { slug: 'kings-birthday',           ko: '국왕 탄신일',            en: "King's Birthday" },
    'carnival':                   { slug: 'carnival',                 ko: '카니발',                 en: 'Carnival' },
    'mothers day':                { slug: 'mothers-day',              ko: '어머니의 날',            en: "Mother's Day" },
    'presidents day':             { slug: 'presidents-day',           ko: '대통령의 날',            en: "Presidents' Day" },
    'workers day':                { slug: 'workers-day',              ko: '노동자의 날',            en: "Workers' Day" },
    'christmas day orthodox':     { slug: 'christmas-orthodox',       ko: '정교회 성탄절',          en: 'Christmas Day (Orthodox)' },
    'youth day':                  { slug: 'youth-day',                ko: '청년의 날',              en: 'Youth Day' },
    'anzac day':                  { slug: 'anzac-day',                ko: '안작 데이',              en: 'Anzac Day' },
    'thanksgiving day':           { slug: 'thanksgiving-day',         ko: '추수감사절',             en: 'Thanksgiving Day' },
    'childrens day':              { slug: 'childrens-day',            ko: '어린이날',               en: "Children's Day" },
    'army day':                   { slug: 'army-day',                 ko: '건군 기념일',            en: 'Army Day' },
    'all souls day':              { slug: 'all-souls-day',            ko: '위령의 날',              en: "All Souls' Day" },
    'statehood day':              { slug: 'statehood-day',            ko: '건국 기념일',            en: 'Statehood Day' },
    'armed forces day':           { slug: 'armed-forces-day',         ko: '국군의 날',              en: 'Armed Forces Day' },
    'remembrance day':            { slug: 'remembrance-day',          ko: '영령 기념일',            en: 'Remembrance Day' },
    'columbus day':               { slug: 'columbus-day',             ko: '콜럼버스 데이',          en: 'Columbus Day' },
    'africa day':                 { slug: 'africa-day',               ko: '아프리카의 날',          en: 'Africa Day' },
    'memorial day':               { slug: 'memorial-day',             ko: '전몰자 추모일',          en: 'Memorial Day' },
    'national holiday':           { slug: 'national-holiday',         ko: '국가 공휴일',            en: 'National Holiday' },
    'carnival monday':            { slug: 'carnival-monday',          ko: '카니발 월요일',          en: 'Carnival Monday' },
    'womens day':                 { slug: 'womens-day',               ko: '여성의 날',              en: "Women's Day" },
    'unity day':                  { slug: 'unity-day',                ko: '통합의 날',              en: 'Unity Day' },
    'gospel day':                 { slug: 'gospel-day',               ko: '복음절',                 en: 'Gospel Day' },
    'heroes day':                 { slug: 'heroes-day',               ko: '영웅의 날',              en: "Heroes' Day" },
    'veterans day':               { slug: 'veterans-day',             ko: '재향군인의 날',          en: 'Veterans Day' },
    'spring bank holiday':        { slug: 'spring-bank-holiday',      ko: '봄 공휴일',              en: 'Spring Bank Holiday' },
};

/** 이름 축 페이지가 놓이는 뿌리. 두 글자면 안 된다 — 국가 코드와 부딪힌다. */
export const NAME_ROOT = 'holiday';
