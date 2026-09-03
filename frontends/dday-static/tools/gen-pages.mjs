/* ============================================================
   public/data/*.json → 한국어 · 영어 두 벌의 정적 페이지
   실행: node tools/gen-pages.mjs   (frontends/dday-static 에서)
   ------------------------------------------------------------
     한국어  /            /kr/      /us/      …
     영어    /en/         /en/kr/   /en/us/   …

   공휴일 목록은 HTML 안에 그대로 박는다. 자바스크립트를 꺼도 읽히고, 크롤러가
   "2026년 대한민국 공휴일" 이나 "South Korea Public Holidays 2026" 을 찾을 때
   실제로 그 문자열이 문서에 있다.
   날짜에 따라 달라지는 것(D-day · 오늘 여부)만 shared/dday.js 가 붙인다.

   선택기 <ul> 은 어느 페이지에서도 비워 둔다 — 204개 <li> × 418개 페이지면
   HTML 만 7MB 가 된다. dday.js 가 countries.json 으로 채운다.
   첫 화면의 국가 목록은 그와 별개로 HTML 에 박혀 있어서, 자바스크립트가 없어도
   204개국으로 갈 수 있다.

   'en' 은 국가 코드가 아니다(ISO 3166-1 에 없다). 그래서 /en/ 을 언어 칸으로
   써도 국가 경로와 부딪히지 않는데, Nager 목록이 바뀌어 부딪히면 조용히
   덮어써 버리므로 아래에서 확인하고 멈춘다.
   ============================================================ */
import { readFileSync, readdirSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { BASE, PUB, DATA, YEARS, EXTRA, NAME_PAGE, today } from './config.mjs';
import { CARDINAL } from './astro.mjs';
import { CARD_W, CARD_H, CARD_DIR } from './card-art.mjs';
import { NORM, NAMES, MIN, NAME_ROOT } from './holiday-names.mjs';
import { flagImg } from './flags.mjs';

const SITE = 'this is the day';
const MID = YEARS()[1];                                   /* 표지로 삼을 해 = 올해 */

const esc = (s) => String(s).replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* 국기. 예전에는 지역 표시 기호 두 개(이모지)였는데 **윈도우에서 국기로
   그려지지 않는다** — 글리프를 합치지 않아서 'GH' 두 글자로 보였다.
   지금은 우리 오리진의 SVG 다 (tools/flags.mjs · public/flags/).
   목록은 lazy, 머리말처럼 첫 화면에 드는 자리는 eager 다. */
const flag = (cc, opt) => (/^[A-Z]{2}$/.test(cc) ? flagImg(cc, opt) : '');

const dow = (iso) => {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
};

/* 연휴 일수를 세는 데만 쓴다. 자료에는 일수를 담지 않는다 — 시작·끝에서 나오므로
   담아 두면 두 값이 갈라질 수 있다. */
const epochDay = (iso) => {
    const [y, m, d] = iso.split('-').map(Number);
    return Math.round(Date.UTC(y, m - 1, d) / 86400000);
};
const isoPlus = (iso, n) => new Date((epochDay(iso) + n) * 86400000).toISOString().slice(0, 10);

/* 한글 · 영어 · 코드 아무거나로 찾히게 한다. 영어 페이지에서도 "대한" 으로 찾힌다 —
   목록에 걸어 두는 열쇠는 언어와 무관하게 같은 것이 편하다. */
const searchKey = (c) => [c.ko, c.name, c.code].filter(Boolean).join(' ').toLowerCase();

/* description 은 160자를 넘으면 검색결과에서 잘린다. 덧붙이는 문장은 들어갈 때만
   붙인다 — 국가명이 긴 곳(Saint Helena, Ascension and Tristan da Cunha)이 있다. */
const fit = (base, extra, limit = 160) =>
    (extra && base.length + extra.length <= limit) ? base + extra : base;

/* ------------------------------------------------------------------- 말

   경로 규칙은 아래 dir 두 줄이 전부다.
     한국어  dir: ''     →  /        /kr/
     영어    dir: '/en'  →  /en/     /en/kr/

   언어 칸과 국가 칸이 같은 자리를 쓴다. 지금은 'en' 이 국가 코드가 아니고 한국이
   'KO' 가 아닌 'KR' 이라 부딪히지 않지만, 우연이다 — de·fr·es·it·pt·nl·ru 등
   35개 국가 코드가 흔한 언어 코드와 겹친다. 독일어를 넣는 순간 /de/ 가 독일
   공휴일 페이지와 정면으로 부딪힌다.

   그때는 언어를 양쪽 다 명시하는 쪽으로 옮긴다 — dir 을 '/ko' · '/en' 으로 바꾸고
   (dday.js 의 STR.*.dir 도 같이), 루트에 리다이렉트나 언어 선택 랜딩을 둔다.
   경로를 만드는 자리는 전부 dir 을 거치므로 그 두 줄이면 끝난다.

   이미 색인된 뒤라도 옮기는 비용은 낮다. Cloudflare 정적 자산의 _redirects 는
   플레이스홀더를 받으므로 국가마다 한 줄씩 적을 필요가 없다 — 위에서부터
   먼저 맞는 규칙이 이기니 영어 칸을 앞에 둔다.

     /en/*   /en/:splat   200
     /       /ko/         301
     /:cc/   /ko/:cc/     301

   남는 비용은 301 을 타고 순위가 넘어가는 데 걸리는 시간뿐이다. */

const KO_DOW = ['일', '월', '화', '수', '목', '금', '토'];
const EN_DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const L = {
    ko: {
        lang: 'ko', dir: '', other: 'en', locale: 'ko_KR',
        otherLabel: 'EN',            /* 버튼에 적히는 글자 = 눌렀을 때 가는 언어 */
        dow: KO_DOW,
        /* 하늘 페이지의 기준 시간대. sky.json 의 zones 와 같은 것을 가리켜야 한다 —
           절기는 온 세계가 같은 순간을 공유하지만 날짜는 시간대마다 갈린다. */
        zone: 'kst', zoneLabel: '한국 표준시(KST)',
        name: (c) => c.ko,
        homeTitle: (n) => `${SITE} — ${n}개국 공휴일·황금연휴와 절기·삭망 D-day`,
        homeDesc: (n) => `오늘이 무슨 날인지, 다음까지 며칠 남았는지. 대한민국을 비롯한 ${n}개국의 법정 공휴일과 황금연휴, 그리고 24절기·삭망·유성우를 날짜순으로 봅니다.`,
        homeH1: '오늘은 무슨 날인가',
        homeLede: '공휴일과 황금연휴, 절기와 삭망까지. 오늘이 어떤 날인지, 다음까지 며칠 남았는지 봅니다.',
        countriesCap: (n) => `국가 ${n}개`,
        countriesH2: '국가별 공휴일',
        todayCap: '전 세계',
        todayH2: '오늘 공휴일인 나라',
        todayWait: '확인하는 중…',
        searchLabel: '국가 검색',
        searchHint: '국가 검색 — 한글·영어·코드',
        noCountry: '찾는 국가가 없습니다.',
        pickerLabel: '국가 선택',
        /* 머리말의 축 탭. 자리가 좁으므로 짧게 — 긴 이름은 좁은 화면에서 밀린다. */
        axes: { country: '국가', rank: '순위', name: '공휴일 이름', sky: '하늘' },
        title: (c, y) => `${y}년 ${c.ko} 공휴일 — 날짜와 D-day`,
        /* 뒷문장이 204개 페이지에서 똑같으면 구글이 무시하고 본문에서 스니펫을
           자체 생성한다 — CTR 통제권을 잃는다. 나라마다 실제로 다른 사실을 넣는다. */
        desc: (c, y, f, local) => fit(fit(fit(
            `${y}년 ${c.ko}(${c.name})의 공휴일 ${f.count}일.`,
            f.longest ? ` 가장 긴 연휴는 ${f.lead ? `${f.lead.n} ` : ''}${f.longest.n}일입니다.` : ' 사흘 이상 이어지는 연휴는 없습니다.'),
            f.longest ? ` 사흘 이상 쉬는 구간은 ${f.breaks}번입니다.` : ''),
            local ? ' 일부 지역만 쉬는 날은 지역을 표시합니다.' : ''),
        /* 화면에 박히는 요약. 스니펫에 담길 문장이기도 하다. */
        sum: (c, y, f) => `${y}년 ${c.ko}의 공휴일은 ${f.count}일이고, 그중 ${f.weekend}일이 주말과 겹칩니다.`
            + (f.longest
                ? ` 사흘 이상 쉬는 구간은 ${f.breaks}번이며, 가장 긴 것은 ${f.lead ? `${f.lead.n} ` : ''}${f.longest.n}일(${DATE_SPAN.ko(f.longest.s, f.longest.e)})입니다.`
                : ' 주말과 이어져 사흘 이상 쉬는 구간은 없습니다.'),
        h1: (c) => `${c.ko} 공휴일`,
        lede: (c, local) => `${c.ko}${c.ko === c.name ? '' : `(${c.name})`}의 법정 공휴일입니다. 오늘이 쉬는 날인지, 다음 공휴일까지 며칠 남았는지 바로 보여줍니다.`
            + (local ? ' 일부 지역만 쉬는 날에는 해당 지역을 함께 적었습니다.' : ''),
        yearCap: (y, n) => `${y}년 · ${n}일`,
        yearH2: (c, y) => `${y}년 ${c.ko} 공휴일`,
        thDate: '날짜', thName: '공휴일',
        breakCap: (y, n) => `${y}년 · 연휴 ${n}회`,
        breakH2: (c, y) => `${y}년 ${c.ko} 황금연휴`,
        breakNote: '주말과 공휴일이 이어져 사흘 이상 쉬는 구간입니다. 하루만 더 쓰면 이어지는 날은 징검다리로 적었습니다.',
        thSpan: '기간', thBreak: '연휴',
        breakLen: (n) => `${n}일 연휴`,
        bridgeBadge: (n) => `징검다리 ${n}일`,
        placeholderVerdict: (c, n) => `${c.ko} 공휴일 ${n}일`,
        checking: '날짜를 확인하는 중…', computing: '계산하는 중…',
        dtNext: '다음', dtPrev: '지난', dtBreak: '다음 연휴',
        otherCountries: '다른 국가 공휴일 보기 →',
        localBadge: (n) => `일부 지역 ${n}곳`,
        foot: (g) => `공휴일 자료 <a href="https://date.nager.at/" rel="noopener">Nager.Date</a> · <code>types</code> 가 <code>Public</code> 인 항목만 담았습니다. 갱신 ${g}.`,
        footTz: 'D-day 는 이 기기의 날짜로 계산합니다 — 다른 시간대의 국가를 볼 때는 하루 어긋날 수 있습니다.',
        crumbCountry: (c) => `${c.ko} 공휴일`,

        /* --- 이름 축 ---
           국가 축으로는 답할 수 없는 물음을 받는 자리다. "크리스마스에 어느 나라가
           쉬나" 와 "세계의 독립기념일은 언제인가" 는 204개 국가 페이지를 다 열어야
           답이 나오는데, 그건 답이 없는 것과 같다. */
        nameHubTitle: (n) => `공휴일 이름 ${n}가지 — 어느 나라가 함께 쉬나`,
        nameHubDesc: (n, y, m) => `같은 이름의 공휴일을 쓰는 나라를 이름별로 모았습니다.`
            + ` 이름 ${n}가지와, ${y}년에 ${m}개국 이상이 함께 쉬는 날을 날짜순으로 봅니다.`,
        nameHubH1: '공휴일 이름으로 보기',
        nameHubLede: '크리스마스처럼 온 세계가 같은 날 쉬는 이름도 있고, 독립기념일처럼 나라마다 다른 날 쉬는 이름도 있습니다. 이름을 골라 들어가면 어느 나라가 언제 쉬는지 봅니다.',
        nameHubCrumb: '공휴일 이름',
        nameListCap: (n) => `이름 ${n}가지`,
        nameListH2: '이름별로 보기',
        nameCount: (n) => `${n}개국`,
        nameLink: '공휴일 이름으로 보기 →',
        togetherCap: (y, n) => `${y}년 · ${n}일`,
        togetherH2: (y) => `${y}년, 가장 많은 나라가 함께 쉬는 날`,
        togetherNote: (m, y) => `${y}년에 ${m}개국 이상이 같은 날 쉬는 날짜입니다. 국가별 공휴일을 날짜로 뒤집어 셌습니다 — 이름이 나라마다 달라도 같은 날이면 함께 셉니다.`,
        thTogether: '함께 쉬는 나라',
        togetherWho: (n) => `${n}개국`,

        nameTitle: (e, y) => `${y}년 ${e.ko} — 어느 나라가 쉬나`,
        /* f.first · f.peak 는 이미 날짜 한 개 꼴로 다듬어 넘어온다 (DATE_ONE).
           여기서 DATE_SPAN 을 같은 날짜로 두 번 부르면 "12월 25~25일" 이 된다. */
        nameDesc: (e, y, f) => fit(
            `${y}년 ${e.ko}(${e.en})에 쉬는 나라는 ${f.cover}개국입니다.`,
            f.spread > 1
                ? ` 날짜는 나라마다 갈려 ${f.spread}가지입니다.`
                : ` 모두 ${f.first}에 쉽니다.`),
        nameH1: (e) => e.ko,
        nameLede: (e) => `${e.ko}(${e.en})을 공휴일로 두는 나라입니다. 나라를 눌러 그 나라 공휴일 전체로 갈 수 있습니다.`,
        nameSum: (e, y, f) => `${y}년 ${e.ko}에 쉬는 나라는 ${f.cover}개국입니다.`
            + (f.spread > 1
                ? ` 날짜가 나라마다 갈려 ${f.spread}가지이고, 가장 많은 나라가 쉬는 날은 ${f.peak}(${f.peakN}개국)입니다.`
                : ` 모두 같은 날(${f.first}) 쉽니다.`),
        nameYearCap: (y, n) => `${y}년 · ${n}개국`,
        nameYearH2: (e, y) => `${y}년 ${e.ko}`,
        thWho: '쉬는 나라',
        nameNote: '같은 이름을 쓰는 날짜를 모두 담았습니다. 표기만 다른 이름(All Saints’ Day · All Saints Day)은 한 이름으로 묶었고, 낱말이 다른 이름은 묶지 않았습니다.',
        nameBackHub: '공휴일 이름 전체 보기 →',
        dtNextName: '다음',
        dtPrevName: '지난',
        nameVerdict: (e) => `${e.ko}`,

        /* --- 나라끼리 견주기 --- */
        rankTitle: (y) => `${y}년 공휴일 순위 — 많은 나라, 긴 연휴`,
        rankDesc: (y, f) => `${y}년 공휴일이 가장 많은 나라는 ${f.most.label} ${f.most.n}일,`
            + ` 가장 적은 나라는 ${f.least.label} ${f.least.n}일입니다.`
            + ` 가장 긴 황금연휴는 ${f.long.label} ${f.long.n}일입니다.`,
        rankH1: '나라끼리 견주기',
        rankLede: '국가 페이지는 한 나라만 보여 줍니다. 여기서는 담긴 나라 전부를 한 줄에 세워 봅니다.',
        rankCrumb: '나라끼리 견주기',
        rankLink: '나라끼리 견주기 →',
        rankNote: (y, n) => `${y}년 자료를 담긴 ${n}개국에 대해 세었습니다. 세는 단위는 "공휴일이 있는 날짜" 입니다 — 한 날짜에 공휴일이 둘 겹치는 나라가 있어 건수와는 다릅니다.`,
        rankMostCap: (n) => `상위 ${n}개국`,
        rankMostH2: (y) => `${y}년 공휴일이 많은 나라`,
        rankLeastCap: (n) => `하위 ${n}개국`,
        rankLeastH2: (y) => `${y}년 공휴일이 적은 나라`,
        rankBreakCap: (n) => `상위 ${n}건`,
        rankBreakH2: (y) => `${y}년 가장 긴 황금연휴`,
        rankBreakNote: '주말과 공휴일이 이어져 사흘 이상 쉬는 구간 가운데 가장 긴 것입니다.',
        rankBreaksCap: (n) => `상위 ${n}개국`,
        rankBreaksH2: (y) => `${y}년 황금연휴가 많은 나라`,
        thRank: '순위',
        thCountry: '국가',
        thDayCount: '쉬는 날짜',
        thBreakCount: '연휴 횟수',
        rankDays: (n) => `${n}일`,
        rankTimes: (n) => `${n}회`,

        /* --- 하늘 --- */
        /* 허브(/sky/) — 갈래로 보내는 자리다. 표를 이고 있지 않으므로 제목도 갈래
           하나를 가리키지 않는다. 갈래 페이지와 제목이 겹치면 서로 잡아먹는다. */
        skyTitle: (y) => `${y}년 하늘 — 절기·삭망·유성우·음력 D-day`,
        skyDesc: (y) => `${y}년 24절기와 삭·보름, 유성우 극대기, 그리고 음력 달력. 갈래별로 나누어 보고 다음까지 며칠 남았는지 함께 봅니다. 한국 표준시 기준.`,
        skyH1: '하늘',
        skyLede: '절기와 삭망, 유성우, 그리고 음력 달력입니다. 갈래를 골라 들어가면 3년치를 날짜순으로 봅니다.',
        skyCrumb: '하늘',
        skyLink: '하늘 전체 보기 →',
        skyTopicsCap: '갈래',
        skyTopicsH2: '갈래별로 보기',
        skyBackHub: '하늘 전체 보기 →',
        skyCount: (n) => `${n}건`,

        /* 갈래 세 벌. 제목·설명·H1 이 갈래마다 따로여야 검색어에 대응한다 —
           한 URL 에 176건을 몰아 두면 어느 쿼리에도 정확히 대응하지 못한다. */
        sky: {
            term: {
                title: (y) => `${y}년 24절기 — 날짜와 D-day`,
                desc: (y) => `${y}년 24절기를 날짜와 시각까지 날짜순으로. 입춘·춘분·하지·동지가 언제인지, 다음 절기까지 며칠 남았는지 봅니다. 한국 표준시 기준.`,
                h1: '24절기',
                lede: '입춘부터 대한까지 24절기입니다. 절기가 드는 날짜와 시각을 3년치로 담았습니다.',
                crumb: '24절기',
                hub: '24절기',
                hubNote: '입춘 · 춘분 · 하지 · 동지',
            },
            moon: {
                title: (y) => `${y}년 삭과 보름 — 보름달 날짜와 D-day`,
                desc: (y) => `${y}년 삭(그믐)과 보름의 날짜와 시각을 날짜순으로. 다음 보름달까지 며칠 남았는지 함께 보여줍니다. 한국 표준시 기준.`,
                h1: '삭과 보름',
                lede: '달이 완전히 차는 순간과 완전히 비는 순간입니다. 날짜와 시각을 3년치로 담았습니다.',
                crumb: '삭과 보름',
                hub: '삭과 보름',
                hubNote: '보름달 · 그믐달',
            },
            meteor: {
                title: (y) => `${y}년 유성우 — 극대기 날짜와 D-day`,
                desc: (y) => `${y}년 유성우 극대기를 날짜와 시각까지 날짜순으로. 페르세우스자리·쌍둥이자리 유성우가 언제인지, 다음까지 며칠 남았는지 봅니다.`,
                h1: '유성우 극대기',
                lede: '유성우가 가장 많이 떨어지는 순간입니다. 시간당 몇 개까지 보이는지 함께 적었습니다.',
                crumb: '유성우',
                hub: '유성우',
                hubNote: '페르세우스자리 · 쌍둥이자리',
            },
            /* 음력만 note · foot 를 따로 갖는다. 다른 갈래는 "이 페이지는 KST 기준"
               한 줄로 끝나지만, 음력은 시간대가 자료의 일부라 en 페이지도 KST 표를
               본다 — skyNote 를 그대로 쓰면 en 페이지가 "모두 UTC" 라고 거짓말한다. */
            lunar: {
                title: (y) => `${y}년 음력 달력 — 초하루와 윤달`,
                desc: (y) => `${y}년 음력 달의 초하루가 양력 며칟날인지, 그 달이 29일인지 30일인지. 윤달도 함께 봅니다. 한국 표준시 기준.`,
                h1: '음력 달력',
                lede: '음력 달의 첫날(초하루)과 길이입니다. 삭이 든 날이 초하루이고, 중기가 들지 않는 달이 윤달입니다.',
                crumb: '음력',
                hub: '음력 달력',
                hubNote: '초하루 · 윤달',
                note: '음력은 삭이 든 날로 달이 갈리므로 기준 시간대가 규칙의 일부입니다. 이 표는 한국 표준시(KST) 기준이고, 그래서 중국 농력(UTC+8)과는 삭이 두 자정 사이에 떨어지는 해에 하루 어긋납니다 — 2027년 설날이 그렇습니다.',
                foot: '초하루는 삭이 든 날, 동지가 든 달은 11월, 윤달은 중기가 들지 않는 첫 달(무중치윤법)입니다. 삭은 Meeus 제49장, 중기는 VSOP87D 로 직접 계산합니다.',
            },
        },
        skyHomeCap: '하늘',
        skyHomeH2: '다가오는 절기와 삭망',
        termsCap: (y, n) => `${y}년 · 절기 ${n}개`,
        termsH2: (y) => `${y}년 24절기`,
        moonsCap: (y, n) => `${y}년 · 삭망 ${n}회`,
        moonsH2: (y) => `${y}년 삭과 보름`,
        showersCap: (y, n) => `${y}년 · 유성우 ${n}개`,
        showersH2: (y) => `${y}년 유성우 극대기`,
        lunarCap: (y, n) => `${y}년 · ${n}개월`,
        lunarH2: (y) => `${y}년에 초하루가 드는 음력 달`,
        lunarName: (e) => `${e.y}년 ${e.leap ? '윤' : ''}${e.m}월`,
        lunarLen: (n) => `${n}일`,
        leapBadge: '윤달',
        dtLunar: '다음 초하루',
        thTime: '날짜와 시각', thEvent: '천문 현상',
        newMoon: '삭', fullMoon: '보름', han: { new: '朔', full: '望' },
        showerName: (n) => `${n} 유성우`,
        zhr: (n) => `조건이 좋으면 시간당 ${n}개`,
        cardinal: { equinox: '분점', solstice: '지점' },
        dtTerm: '다음 절기', dtNew: '다음 삭', dtFull: '다음 보름', dtShower: '다음 유성우',
        skyVerdict: '오늘 하늘',
        skyNote: '절기와 삭망은 온 세계가 같은 순간을 공유하지만, 날짜는 시간대마다 갈립니다. 이 페이지의 날짜와 시각은 모두 한국 표준시(KST) 기준입니다.',
        skyFoot: '절기·삭망은 VSOP87D(태양)와 Meeus 제49장(달)으로 직접 계산합니다. 유성우 극대기는 국제유성기구가 쓰는 태양 황경으로 구합니다.',
        contact: '문의',
        nfTitle: `없는 쪽입니다 — ${SITE}`,
        nfH1: '없는 쪽입니다',
        nfLede: '주소를 다시 확인해 주세요. 국가 페이지 주소는 두 글자 국가 코드입니다 — 대한민국은 <code>/kr/</code>, 미국은 <code>/us/</code>.',
        nfBack: '국가 목록으로 →',
    },
    en: {
        lang: 'en', dir: '/en', other: 'ko', locale: 'en_US',
        otherLabel: 'KO',            /* 버튼에 적히는 글자 = 눌렀을 때 가는 언어 */
        dow: EN_DOW,
        zone: 'utc', zoneLabel: 'UTC',
        name: (c) => c.name,
        homeTitle: () => `${SITE} — public holidays, long weekends and the sky`,
        homeDesc: (n) => `What is today, and how long until the next one? Public holidays and long weekends for ${n} countries, plus solar terms, moon phases and meteor showers.`,
        homeH1: 'What day is today?',
        homeLede: 'Public holidays and long weekends, solar terms and moon phases. See what today is and how long until the next one.',
        countriesCap: (n) => `${n} countries`,
        countriesH2: 'Holidays by country',
        todayCap: 'Around the world',
        todayH2: 'Countries on holiday today',
        todayWait: 'Checking…',
        searchLabel: 'Search countries',
        searchHint: 'Search — name or code',
        noCountry: 'No country matches.',
        pickerLabel: 'Country',
        axes: { country: 'Countries', rank: 'Rankings', name: 'By name', sky: 'The sky' },
        title: (c, y) => `${c.name} Public Holidays ${y}`,
        /* fit 을 사슬로 건다 — 국가명이 44자인 곳(SH)이 있어서 한 벌로 쓰면 넘친다.
           덜 중요한 절이 먼저 빠지고, 나라가 하나 늘어도 다시 재지 않아도 된다. */
        desc: (c, y, f, local) => fit(fit(fit(
            `${f.count} public holidays in ${c.name} for ${y}.`,
            f.longest ? ` Longest break: ${f.longest.n} days${f.lead ? ` around ${f.lead.e || f.lead.n}` : ''}.` : ' No long weekends of three days or more.'),
            f.longest ? ` ${f.breaks} long weekends of three days or more.` : ''),
            local ? ' Region-only days are marked.' : ''),
        sum: (c, y, f) => `${c.name} has ${f.count} public holidays in ${y}, ${f.weekend} of which fall on a weekend.`
            + (f.longest
                ? ` There are ${f.breaks} long weekends of three days or more; the longest runs ${f.longest.n} days${f.lead ? ` around ${f.lead.e || f.lead.n}` : ''} (${DATE_SPAN.en(f.longest.s, f.longest.e)}).`
                : ' No public holiday joins a weekend into a break of three days or more.'),
        h1: (c) => `${c.name} Public Holidays`,
        lede: (c, local) => `Statutory public holidays in ${c.name}. See at a glance whether today is a day off and how long until the next one.`
            + (local ? ' Days observed only in some regions carry the regions they apply to.' : ''),
        yearCap: (y, n) => `${y} · ${n} days`,
        yearH2: (c, y) => `${c.name} public holidays in ${y}`,
        thDate: 'Date', thName: 'Holiday',
        breakCap: (y, n) => `${y} · ${n} long weekends`,
        breakH2: (c, y) => `${c.name} Long Weekends ${y}`,
        breakNote: 'Stretches of three days or more where weekends and public holidays run together. Days you would have to take off to join them up are marked as bridge days.',
        thSpan: 'Dates', thBreak: 'Break',
        breakLen: (n) => `${n}-day break`,
        bridgeBadge: (n) => (n === 1 ? '1 bridge day' : `${n} bridge days`),
        placeholderVerdict: (c, n) => `${n} public holidays in ${c.name}`,
        checking: 'Checking the date…', computing: 'Computing…',
        dtNext: 'Next', dtPrev: 'Last', dtBreak: 'Next break',
        otherCountries: 'Holidays in other countries →',
        localBadge: (n) => `${n} regions`,
        foot: (g) => `Holiday data from <a href="https://date.nager.at/" rel="noopener">Nager.Date</a> · only entries whose <code>types</code> includes <code>Public</code>. Updated ${g}.`,
        footTz: 'The countdown uses this device’s date — it can be a day out when you view a country in another time zone.',
        crumbCountry: (c) => `${c.name} public holidays`,

        /* --- 이름 축 --- */
        nameHubTitle: (n) => `${n} Holiday Names — Who Shares a Day Off`,
        nameHubDesc: (n, y, m) => `Public holidays grouped by name across countries.`
            + ` ${n} names, plus the ${y} dates on which ${m} or more countries take the day off.`,
        nameHubH1: 'Holidays by name',
        nameHubLede: 'Some names fall on the same day the world over, like Christmas. Others fall on a different day in every country, like Independence Day. Pick a name to see who takes it off and when.',
        nameHubCrumb: 'holidays by name',
        nameListCap: (n) => `${n} names`,
        nameListH2: 'Browse by name',
        nameCount: (n) => `${n}`,
        nameLink: 'Holidays by name →',
        togetherCap: (y, n) => `${y} · ${n} dates`,
        togetherH2: (y) => `Days the most countries share in ${y}`,
        togetherNote: (m, y) => `Dates on which ${m} or more countries take a public holiday in ${y}, counted by turning the per-country data on its date axis — countries count together whenever the date matches, whatever the holiday is called.`,
        thTogether: 'Countries off',
        togetherWho: (n) => `${n} countries`,

        nameTitle: (e, y) => `${e.en} ${y} — Which Countries Take It Off`,
        nameDesc: (e, y, f) => fit(
            `${f.cover} countries observe ${e.en} in ${y}.`,
            f.spread > 1
                ? ` The date differs by country — ${f.spread} of them.`
                : ` All of them on ${f.first}.`),
        nameH1: (e) => e.en,
        nameLede: (e) => `Countries that keep ${e.en} as a public holiday. Follow a country to see all of its holidays.`,
        nameSum: (e, y, f) => `${f.cover} countries observe ${e.en} in ${y}.`
            + (f.spread > 1
                ? ` The date differs by country — ${f.spread} distinct dates — and the one shared by the most countries is ${f.peak} (${f.peakN} countries).`
                : ` Every one of them on the same day, ${f.first}.`),
        nameYearCap: (y, n) => `${y} · ${n} countries`,
        nameYearH2: (e, y) => `${e.en} in ${y}`,
        thWho: 'Countries',
        nameNote: 'Every date that carries this name is here. Names that differ only in spelling (All Saints’ Day · All Saints Day) are one name; names that differ in wording are kept apart.',
        nameBackHub: 'All holiday names →',
        dtNextName: 'Next',
        dtPrevName: 'Last',
        nameVerdict: (e) => `${e.en}`,

        /* --- 나라끼리 견주기 --- */
        rankTitle: (y) => `Public Holidays ${y} — Most Days, Longest Breaks`,
        rankDesc: (y, f) => `In ${y} the most public holidays are in ${f.most.label} with ${f.most.n},`
            + ` the fewest in ${f.least.label} with ${f.least.n}.`
            + ` The longest break runs ${f.long.n} days in ${f.long.label}.`,
        rankH1: 'Countries compared',
        rankLede: 'A country page shows one country. This one lines up every country in the data.',
        rankCrumb: 'countries compared',
        rankLink: 'Countries compared →',
        rankNote: (y, n) => `Counted over ${y} for all ${n} countries in the data. The unit is “dates carrying a public holiday” — a few countries stack two holidays on one date, so this differs from a count of entries.`,
        rankMostCap: (n) => `Top ${n}`,
        rankMostH2: (y) => `Most public holidays in ${y}`,
        rankLeastCap: (n) => `Bottom ${n}`,
        rankLeastH2: (y) => `Fewest public holidays in ${y}`,
        rankBreakCap: (n) => `Top ${n}`,
        rankBreakH2: (y) => `Longest long weekends of ${y}`,
        rankBreakNote: 'The longest stretches where weekends and public holidays run together for three days or more.',
        rankBreaksCap: (n) => `Top ${n}`,
        rankBreaksH2: (y) => `Most long weekends in ${y}`,
        thRank: '#',
        thCountry: 'Country',
        thDayCount: 'Days off',
        thBreakCount: 'Long weekends',
        rankDays: (n) => (n === 1 ? '1 day' : `${n} days`),
        rankTimes: (n) => `${n}`,

        /* --- 하늘 --- */
        skyTitle: (y) => `The Sky in ${y} — Terms, Moons, Meteors, Lunar Months`,
        skyDesc: (y) => `The 24 solar terms, new and full moons, meteor shower peaks and lunar months of ${y}. Pick a kind to see three years in date order, with a countdown.`,
        skyH1: 'The Sky',
        skyLede: 'Solar terms, moon phases, meteor showers and the lunisolar calendar. Pick a kind to see three years in date order.',
        skyCrumb: 'the sky',
        skyLink: 'The whole sky →',
        skyTopicsCap: 'Kinds',
        skyTopicsH2: 'Browse by kind',
        skyBackHub: 'The whole sky →',
        skyCount: (n) => `${n}`,

        sky: {
            term: {
                title: (y) => `The 24 Solar Terms of ${y} — Dates and D-day`,
                desc: (y) => `Every one of the 24 solar terms in ${y} with its exact date and time, in date order, and the days until the next one. Times in UTC.`,
                h1: 'The 24 Solar Terms',
                lede: 'The 24 solar terms, from Start of Spring to Great Cold, with the moment each one falls. Three years of them.',
                crumb: 'solar terms',
                hub: 'Solar terms',
                hubNote: 'Equinoxes and solstices',
            },
            moon: {
                title: (y) => `New and Full Moons ${y} — Dates and D-day`,
                desc: (y) => `Every new and full moon of ${y} with its exact date and time, in date order, and the days until the next full moon. Times in UTC.`,
                h1: 'New and Full Moons',
                lede: 'The moment the Moon is exactly full, and the moment it is exactly new. Three years of them.',
                crumb: 'moon phases',
                hub: 'Moon phases',
                hubNote: 'Full moons and new moons',
            },
            meteor: {
                title: (y) => `Meteor Showers ${y} — Peak Dates and D-day`,
                desc: (y) => `Every meteor shower peak in ${y} with its exact date and time — Perseids, Geminids and the rest — and the days until the next one. Times in UTC.`,
                h1: 'Meteor Shower Peaks',
                lede: 'The moment each shower peaks, with how many meteors an hour to expect in good conditions.',
                crumb: 'meteor showers',
                hub: 'Meteor showers',
                hubNote: 'Perseids and Geminids',
            },
            lunar: {
                title: (y) => `The Lunisolar Calendar ${y} — New Moons and Leap Months`,
                desc: (y) => `Every lunar month of ${y}: the Gregorian date its first day falls on, whether it runs 29 or 30 days, and which month is the leap month. Korean Standard Time.`,
                h1: 'The lunisolar calendar',
                lede: 'The first day of each lunar month, and how long the month runs. A month begins on the day the new moon falls, and the month with no major solar term in it is the leap month.',
                crumb: 'lunisolar calendar',
                hub: 'Lunisolar calendar',
                hubNote: 'New moons and leap months',
                note: 'A lunar month begins on the day the new moon falls, so the time zone is part of the rule rather than a way of showing it. This table is Korean Standard Time (UTC+9); the Chinese calendar (UTC+8) differs by a day whenever a new moon lands between the two midnights — as it does for the 2027 new year.',
                foot: 'A month starts on the day of the new moon, the month containing the winter solstice is the 11th, and the leap month is the first month with no major solar term in it. New moons come from Meeus chapter 49 and solar terms from VSOP87D, computed here.',
            },
        },
        skyHomeCap: 'The sky',
        skyHomeH2: 'Coming up in the sky',
        termsCap: (y, n) => `${y} · ${n} solar terms`,
        termsH2: (y) => `The 24 solar terms of ${y}`,
        moonsCap: (y, n) => `${y} · ${n} phases`,
        moonsH2: (y) => `New and full moons in ${y}`,
        showersCap: (y, n) => `${y} · ${n} showers`,
        showersH2: (y) => `Meteor shower peaks in ${y}`,
        lunarCap: (y, n) => `${y} · ${n} months`,
        lunarH2: (y) => `Lunar months beginning in ${y}`,
        lunarName: (e) => `${e.leap ? 'Leap month' : 'Month'} ${e.m}, ${e.y}`,
        lunarLen: (n) => `${n} days`,
        leapBadge: 'leap month',
        dtLunar: 'Next new month',
        thTime: 'Date and time', thEvent: 'Event',
        newMoon: 'New Moon', fullMoon: 'Full Moon', han: { new: '朔', full: '望' },
        showerName: (n) => `${n}`,
        zhr: (n) => `up to ${n} an hour in good conditions`,
        cardinal: { equinox: 'equinox', solstice: 'solstice' },
        dtTerm: 'Next term', dtNew: 'Next new moon', dtFull: 'Next full moon', dtShower: 'Next shower',
        skyVerdict: 'Today',
        skyNote: 'These moments are shared by the whole world, but the date they fall on depends on the time zone. Every date and time on this page is UTC.',
        skyFoot: 'Solar terms and moon phases are computed here — VSOP87D for the Sun, Meeus chapter 49 for the Moon. Shower peaks use the solar longitude the International Meteor Organization defines them by.',
        contact: 'Contact',
        nfTitle: `Not here — ${SITE}`,
        nfH1: 'Not here',
        nfLede: 'Check the address. Country pages use the two-letter country code — <code>/en/kr/</code> for South Korea, <code>/en/us/</code> for the United States.',
        nfBack: 'Back to the country list →',
    },
};

/* 두 언어가 서로를 가리키는 주소. 셋 다 양쪽 페이지에 똑같이 들어가야 한다. */
const url = (lang, slug) => `${BASE}${L[lang].dir}/${slug}`;

/* ------------------------------------------------------------------ 머리

   글꼴은 `/fonts/fonts.css` 한 줄이다. 예전에는 남의 오리진 셋(googleapis ·
   gstatic · jsdelivr)을 물었고 그중 둘이 렌더를 막는 CSS 였다. `tools/gen-fonts.mjs`
   가 조각을 받아 커밋해 두므로 이제 같은 오리진 · 같은 연결로 들어온다.

   preload 는 넣지 않았다. dynamic subset 은 unicode-range 로 갈려 있어서 어느
   조각이 필요한지가 페이지마다 다르다 — 한 벌을 골라 418개 머리에 박으면 맞는
   페이지에서는 1 RTT 를 벌지만 틀린 페이지에서는 아무도 안 쓰는 파일을 통째로
   받는다. 페이지마다 맞는 조각을 계산해 박을 수는 있지만 그러면 gen-pages 가
   gen-fonts 의 출력(파일 이름)을 읽어야 하고, gen-fonts 는 페이지의 글자를 읽는다 —
   생성기 둘이 서로를 물어 처음 한 번을 돌릴 수 없게 된다. 남의 오리진 셋을 없애는
   것이 이 항목의 몫이고 preload 는 그 뒤에 잴 것이다. */

function head(t, { title, desc, slug, card, alt }) {
    return `<!DOCTYPE html>
<html lang="${t.lang}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="icon" href="/favicon.ico" sizes="48x48">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="icon" href="/icon-192.png" type="image/png" sizes="192x192">
  <link rel="apple-touch-icon" href="/apple-touch-icon.png">
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(desc)}">
  <link rel="canonical" href="${url(t.lang, slug)}">
  <link rel="alternate" hreflang="ko" href="${url('ko', slug)}">
  <link rel="alternate" hreflang="en" href="${url('en', slug)}">
  <link rel="alternate" hreflang="x-default" href="${url('en', slug)}">
  <meta property="og:type" content="website">
  <meta property="og:locale" content="${t.locale}">
  <meta property="og:locale:alternate" content="${L[t.other].locale}">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(desc)}">
  <meta property="og:url" content="${url(t.lang, slug)}">
  <meta property="og:image" content="${BASE}/${CARD_DIR}/${card}.png">
  <meta property="og:image:width" content="${CARD_W}">
  <meta property="og:image:height" content="${CARD_H}">
  <meta property="og:image:alt" content="${esc(alt)}">
  <meta name="twitter:card" content="summary_large_image">
  <link rel="stylesheet" href="/fonts/fonts.css">
  <link rel="stylesheet" href="/shared/base.css">
  <link rel="stylesheet" href="/shared/dday.css">
</head>`;
}

/* ------------------------------------------------------------------ 축 탭

   축이 넷이 되면서(국가 · 순위 · 이름 · 하늘) 첫 화면에 「다른 축으로 보기」 칸을
   두는 것으로는 모자라졌다. 그 칸은 첫 화면에만 있어서, 국가 페이지에서 순위로
   가려면 첫 화면을 거쳐야 했다.

   그래서 **모든 페이지의 머리말**로 올렸다. 지금 보고 있는 축에 aria-current 를
   달아 두므로 어느 축에 있는지가 화면과 보조기술 양쪽에서 읽힌다.

   순서는 자주 쓸 순이다 — 국가가 이 사이트의 본체이고, 순위는 한 장이라 값이 싸고,
   이름 축은 60장이라 들어가면 오래 머문다. 하늘은 성격이 가장 다르니 끝이다. */
const AXES = ['country', 'rank', 'name', 'sky'];
const AXIS_HREF = { country: '/', rank: '/rank/', name: `/${NAME_ROOT}/`, sky: '/sky/' };

function tabs(t, axis) {
    return `    <nav class="tabs">
${AXES.map((k) => {
        const here = k === axis;
        return `      <a class="tab${here ? ' here' : ''}" href="${t.dir}${AXIS_HREF[k]}"`
            + `${here ? ' aria-current="page"' : ''}>${esc(t.axes[k])}</a>`;
    }).join('\n')}
    </nav>`;
}

function top(t, { slug, home, label, axis }) {
    const o = L[t.other];
    return `<div class="top"><div class="wrap">
  <a class="brand" href="${t.dir}/">${home ? '' : '← '}${SITE}</a>
${tabs(t, axis)}
  <nav class="side">
${picker(t, label)}
    <a class="btn" href="${o.dir}/${slug}" hreflang="${o.lang}" lang="${o.lang}">${t.otherLabel}</a>
  </nav>
</div></div>`;
}

/* 선택기. <ul> 은 늘 비워 두고 dday.js 가 countries.json 으로 채운다 —
   204개 <li> 를 418개 페이지에 인라인하면 HTML 만 7MB 가 된다.
   자바스크립트가 없으면 선택기는 빈 채로 남지만, 첫 화면의 국가 목록은
   HTML 에 그대로 박혀 있어서 거기서 고를 수 있다. */
function picker(t, label) {
    return `    <details class="picker" id="picker">
      <summary>${label}</summary>
      <div class="panel">
        <input type="search" placeholder="${esc(t.searchHint)}" aria-label="${esc(t.searchLabel)}" autocomplete="off">
        <ul></ul>
        <div class="none" hidden>${esc(t.noCountry)}</div>
      </div>
    </details>`;
}

/* 연락처. 완성된 주소는 HTML 어디에도 없다 — 로컬 파트와 도메인을 뒤집어 담고
   shared/contact.js 가 합친다. '@' 는 소스에 아예 등장하지 않는다.
   backend-internals 와 같은 방식이고 같은 파일을 쓴다. */
const CONTACT = '<span data-contact data-u="tcatnoc" data-d="moc.91noilimrev">'
    + '<noscript>contact (at) vermilion19 (dot) com</noscript></span>';

const foot = (t, generated) => `  <div class="foot">
    <p>${t.foot(generated)}</p>
    <p>${t.footTz}</p>
    <p>${t.contact} ${CONTACT}</p>
  </div>`;

/* ------------------------------------------------------------ 국가 페이지 */

function table(t, days) {
    const rows = days.map((day) => {
        const [y, m, d] = day.d.split('-');
        const w = dow(day.d);
        const wcls = w === 0 ? ' sun' : w === 6 ? ' sat' : '';
        const local = day.r
            ? `<span class="local" title="${esc(day.r.join(', '))}">${esc(t.localBadge(day.r.length))}</span>` +
              `<span class="regions">${esc(day.r.join(' · '))}</span>`
            : '';
        /* 영어 페이지는 영어 이름을 앞세우고 현지어 이름을 아래에 둔다.
           영어 이름이 따로 없으면(e 가 없으면) 현지어 이름이 곧 영어 이름이다. */
        const primary = t.lang === 'en' ? (day.e || day.n) : day.n;
        const secondary = t.lang === 'en' ? (day.e ? day.n : '') : (day.e || '');
        const sub = secondary ? `<span class="en">${esc(secondary)}</span>` : '';
        return `        <tr data-d="${day.d}">
          <td class="date">${y}.${m}.${d}<span class="dow${wcls}">${t.dow[w]}</span></td>
          <td class="name">${esc(primary)}${local}${sub}</td>
          <td class="mark"></td>
        </tr>`;
    }).join('\n');

    return `      <table>
        <thead><tr><th>${esc(t.thDate)}</th><th>${esc(t.thName)}</th><th></th></tr></thead>
        <tbody>
${rows}
        </tbody>
      </table>`;
}

/* ------------------------------------------------------------ 황금연휴 표

   공휴일 표와 나란한 모양이지만 행이 날짜 하나가 아니라 구간이라 열이 다르다.
   D-day 는 여기서도 비워 두고 dday.js 가 붙인다 — 시작 전이면 D-, 끝난 뒤면 D+,
   그 사이면 "연휴 중" 이다.

   이름 칸을 class="name" 이 아니라 class="len" 으로 두는 이유가 있다.
   check-pages 의 한국어 누출 검사는 <td class="name"> 을 들어내고 본다 —
   거기 들어가는 공휴일 이름은 자료(현지어)라서 영어 페이지에도 한글이 올 수 있기
   때문이다. 연휴 칸은 우리가 쓰는 말이므로 그 면제를 받으면 안 된다. */
const NUM = (iso) => { const [y, m, d] = iso.split('-'); return { y, m, d }; };

/* 요약 문장 안의 날짜 구간. 표의 breakSpan 과 달리 여기는 산문이라 요일도
   연도도 넣지 않는다 — 문장이 길어지면 스니펫에서 잘리는 쪽이 그 뒤다. */
const EN_MONTH = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];

const DATE_SPAN = {
    ko: (s, e) => {
        const a = NUM(s), b = NUM(e);
        return a.m === b.m ? `${+a.m}월 ${+a.d}~${+b.d}일` : `${+a.m}월 ${+a.d}일~${+b.m}월 ${+b.d}일`;
    },
    en: (s, e) => {
        const a = NUM(s), b = NUM(e);
        return a.m === b.m
            ? `${+a.d}–${+b.d} ${EN_MONTH[+a.m - 1]}`
            : `${+a.d} ${EN_MONTH[+a.m - 1]} – ${+b.d} ${EN_MONTH[+b.m - 1]}`;
    },
};

/* ------------------------------------------------------------ 요약할 사실
   스니펫에 담길 문장을 만들 재료다. **연 단위로 확정되는 것만 담는다** —
   게이트 1번이다. D-day 나 "오늘 쉬는가" 처럼 날짜에 따라 변하는 것은 여기 없고
   그대로 브라우저가 맡는다. 여기 있는 넷은 자료를 받은 순간 고정된다.

   왜 이것을 굳이 HTML 에 박나 — title 에 "D-day" 라고 적어 두고 정작 본문은
   "계산하는 중…" 이었다. 구글이 JS 를 렌더하긴 하지만 렌더 큐가 며칠씩 밀리고,
   스니펫은 대개 원본 HTML 에서 뽑는다. 클릭을 만드는 것이 스니펫인데 거기 담길
   문장이 없었다. */
function facts(data, year) {
    const y = String(year);
    const days = data.days.filter((d) => d.d.startsWith(y));
    /* 연휴 수는 표에 찍히는 것과 같아야 한다 — Nager 는 같은 명절에 대해 길이가
       다른 구간을 여러 벌 주는데, 표가 그것을 그대로 싣기 때문이다. */
    const breaks = (data.long || []).filter((w) => w.s.startsWith(y));

    let longest = null;
    for (const w of breaks) {
        const n = epochDay(w.e) - epochDay(w.s) + 1;
        if (!longest || n > longest.n) longest = { s: w.s, e: w.e, n };
    }
    /* 가장 긴 연휴가 낀 공휴일. 여럿이면 첫 것 — 이름을 붙여야 문장이 산다
       ("5일" 보다 "설날 5일" 이 검색결과에서 읽힌다).
       조사는 쓰지 않는다 — 이름이 어느 문자로 올지 모른다(みどりの日 · Jour de l'an). */
    const lead = longest ? days.find((d) => d.d >= longest.s && d.d <= longest.e) : null;
    /* 주말과 겹치는 날. "쉬는 날이 며칠 늘어나나" 에 답하는 값이라 사람들이 찾는다. */
    const weekend = days.filter((d) => { const w = dow(d.d); return w === 0 || w === 6; }).length;

    return { count: days.length, breaks: breaks.length, longest, lead, weekend };
}

function breakSpan(t, s, e) {
    const a = NUM(s), b = NUM(e);
    const cell = (p, iso, withYear) => {
        const w = dow(iso);
        const wcls = w === 0 ? ' sun' : w === 6 ? ' sat' : '';
        return `${withYear ? p.y + '.' : ''}${p.m}.${p.d}<span class="dow${wcls}">${t.dow[w]}</span>`;
    };
    /* 연말에 걸친 연휴만 끝쪽에도 연도를 적는다 — 늘 적으면 좁은 화면에서 넘친다 */
    return `${cell(a, s, true)} ~ ${cell(b, e, a.y !== b.y)}`;
}

function breakTable(t, items) {
    const rows = items.map((w) => {
        const n = (epochDay(w.e) - epochDay(w.s)) + 1;
        const bridge = w.b?.length
            ? `<span class="bridge" title="${esc(w.b.join(', '))}">${esc(t.bridgeBadge(w.b.length))}</span>`
            : '';
        return `        <tr data-s="${w.s}" data-e="${w.e}">
          <td class="range">${breakSpan(t, w.s, w.e)}</td>
          <td class="len">${esc(t.breakLen(n))}${bridge}</td>
          <td class="mark"></td>
        </tr>`;
    }).join('\n');

    return `      <table class="breaks">
        <thead><tr><th>${esc(t.thSpan)}</th><th>${esc(t.thBreak)}</th><th></th></tr></thead>
        <tbody>
${rows}
        </tbody>
      </table>`;
}

function countryPage(t, data) {
    /* 자료가 낡으면 연휴 섹션만 조용히 빠진다. 그게 가장 알아채기 어려우니 멈춘다. */
    if (!Array.isArray(data.long)) {
        console.error(`data/${data.code}.json 에 long 이 없다 — node tools/gen-holidays.mjs 를 먼저 돌릴 것.`);
        process.exit(1);
    }

    const byYear = new Map();
    for (const day of data.days) {
        const y = +day.d.slice(0, 4);
        if (!byYear.has(y)) byYear.set(y, []);
        byYear.get(y).push(day);
    }

    /* 표지 연도 — 올해가 있으면 올해, 없으면 가진 것 중 가장 이른 해 */
    const years = [...byYear.keys()].sort((a, b) => a - b);
    const main = byYear.has(MID) ? MID : years[0];
    const localCount = data.days.filter((d) => d.r).length;
    const slug = `${data.code.toLowerCase()}/`;

    const sections = years.map((y) => {
        const body = table(t, byYear.get(y));
        if (y === main) {
            return `  <section>
    <span class="cap">${esc(t.yearCap(y, byYear.get(y).length))}</span>
    <h2>${esc(t.yearH2(data, y))}</h2>
${body}
  </section>`;
        }
        return `  <details class="year">
    <summary>${esc(t.yearCap(y, byYear.get(y).length))}</summary>
${body}
  </details>`;
    }).join('\n\n');

    /* 황금연휴. 공휴일과 같은 해 나눔을 쓴다 — 표지 연도는 펼쳐 두고 나머지는 접는다.
       연휴가 한 건도 없는 국가가 있어서(공휴일이 늘 주중 한복판인 곳) 통째로 뺀다. */
    const breaksByYear = new Map();
    for (const w of data.long) {
        const y = +w.s.slice(0, 4);
        if (!breaksByYear.has(y)) breaksByYear.set(y, []);
        breaksByYear.get(y).push(w);
    }
    const breakYears = [...breaksByYear.keys()].sort((a, b) => a - b);
    const breakMain = breaksByYear.has(main) ? main : breakYears[0];

    const breaks = !data.long.length ? '' : '\n\n' + breakYears.map((y) => {
        const body = breakTable(t, breaksByYear.get(y));
        if (y === breakMain) {
            return `  <section>
    <span class="cap">${esc(t.breakCap(y, breaksByYear.get(y).length))}</span>
    <h2>${esc(t.breakH2(data, y))}</h2>
    <p class="note">${esc(t.breakNote)}</p>
${body}
  </section>`;
        }
        return `  <details class="year">
    <summary>${esc(t.breakCap(y, breaksByYear.get(y).length))}</summary>
${body}
  </details>`;
    }).join('\n\n');

    const f = facts(data, main);

    const crumbs = {
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: [
            { '@type': 'ListItem', position: 1, name: SITE, item: `${BASE}${t.dir}/` },
            { '@type': 'ListItem', position: 2, name: t.crumbCountry(data), item: url(t.lang, slug) },
        ],
    };

    return `${head(t, {
        title: t.title(data, main),
        desc: t.desc(data, main, f, localCount),
        slug,
        card: data.code.toLowerCase(),
        alt: `${t.crumbCountry(data)} — ${SITE}`,
    })}
<body data-cc="${data.code}">

${top(t, { slug, axis: 'country', label: `${flag(data.code, { eager: true })}${esc(t.name(data))}` })}

<main class="wrap">

  <h1>${esc(t.h1(data))}</h1>
  <p class="lede">${esc(t.lede(data, localCount))}</p>
  <p class="sum">${esc(t.sum(data, main, f))}</p>

  <div class="now" id="now">
    <div class="asof">${esc(t.checking)}</div>
    <div class="verdict">${esc(t.placeholderVerdict(data, data.days.length))}</div>
    <dl class="pair">
      <dt>${esc(t.dtNext)}</dt><dd id="next"><em>${esc(t.computing)}</em></dd>
      <dt>${esc(t.dtPrev)}</dt><dd id="prev"><em>${esc(t.computing)}</em></dd>${data.long.length ? `
      <dt>${esc(t.dtBreak)}</dt><dd id="break"><em>${esc(t.computing)}</em></dd>` : ''}
    </dl>
  </div>

${sections}${breaks}

  <section>
    <p><a href="${t.dir}/#countries">${esc(t.otherCountries)}</a></p>
  </section>

${foot(t, data.generated)}
</main>

<script type="application/ld+json">${JSON.stringify(crumbs)}</script>
<script src="/shared/dday.js"></script>
<script src="/shared/contact.js"></script>
</body>
</html>
`;
}

/* ---------------------------------------------------------------- 하늘

   국가 페이지와 달리 자료가 한 벌이다 — 절기도 삭망도 유성우도 온 세계가 같은
   순간을 공유한다. 갈리는 것은 **날짜**뿐이고, 그건 sky.json 이 기준 시간대마다
   미리 굳혀 두었다 (ko=KST · en=UTC). 여기서 다시 계산하지 않는다.

   이름 칸을 class="ev" 로 두는 이유는 황금연휴의 class="len" 과 같다 —
   한국어 누출 검사는 <td class="name"> 을 면제하는데, 이 칸의 말은 우리 것이라
   그 면제를 받으면 안 된다. */
/* 음력만 모양이 다르다 — 순간이 아니라 날짜이고, 시간대가 자료의 일부라
   ko/en 으로 갈릴 날짜가 없다. 그래서 두 칸(kst·utc) 이 아니라 s 한 칸이고
   시각이 없다. 표 코드는 그대로 나눠 쓰고 여기 두 줄에서만 갈린다. */
const skyDate = (e, t) => (e.s !== undefined ? e.s : t.zone === 'kst' ? e.kst : e.utc);
const skyTime = (e, t) => (e.s !== undefined ? '' : t.zone === 'kst' ? e.kh : e.uh);

function skyRow(t, e, kind, name, alt, badge) {
    const iso = skyDate(e, t);
    const [y, m, d] = iso.split('-');
    const w = dow(iso);
    const wcls = w === 0 ? ' sun' : w === 6 ? ' sat' : '';
    const at = skyTime(e, t);
    return `        <tr data-d="${iso}" data-sky="${kind}">
          <td class="date">${y}.${m}.${d}<span class="dow${wcls}">${t.dow[w]}</span>${at ? `<span class="at">${at}</span>` : ''}</td>
          <td class="ev">${esc(name)}${badge || ''}${alt ? `<span class="alt">${esc(alt)}</span>` : ''}</td>
          <td class="mark"></td>
        </tr>`;
}

function skyTable(t, rows) {
    return `      <table class="sky">
        <thead><tr><th>${esc(t.thTime)}</th><th>${esc(t.thEvent)}</th><th></th></tr></thead>
        <tbody>
${rows.join('\n')}
        </tbody>
      </table>`;
}

/* 표지 연도는 펼치고 나머지 해는 접는다 — 공휴일·황금연휴와 같은 규칙이다. */
function skyGroup(t, byYear, cap, h2, build) {
    const years = [...byYear.keys()].sort((a, b) => a - b);
    const head = byYear.has(MID) ? MID : years[0];
    return years.map((y) => {
        const body = skyTable(t, byYear.get(y).map(build));
        if (y === head) {
            return `  <section>
    <span class="cap">${esc(cap(y, byYear.get(y).length))}</span>
    <h2>${esc(h2(y))}</h2>
${body}
  </section>`;
        }
        return `  <details class="year">
    <summary>${esc(cap(y, byYear.get(y).length))}</summary>
${body}
  </details>`;
    }).join('\n\n');
}

const groupBy = (list, key) => {
    const m = new Map();
    for (const e of list) {
        const y = +key(e).slice(0, 4);
        if (!m.has(y)) m.set(y, []);
        m.get(y).push(e);
    }
    return m;
};

/* 하늘의 세 갈래.
   slug 는 config 의 EXTRA · key 는 sky.json 의 키 · kind 는 <tr data-sky> 의 값이고
   card 는 그 갈래 페이지의 카드에 놓을 줄이다. 넷이 서로 어긋나면 조용히 반쪽이 되므로
   한 곳에 적어 두고 gen-pages · gen-card · check-pages 가 같이 본다. */
export const SKY_TOPICS = [
    { slug: 'term',   key: 'terms',   kind: 'term',   cap: 'termsCap',   h2: 'termsH2',
      card: [['dtTerm', 'next-term']] },
    { slug: 'moon',   key: 'moons',   kind: 'moon',   cap: 'moonsCap',   h2: 'moonsH2',
      card: [['dtNew', 'next-new'], ['dtFull', 'next-full']] },
    { slug: 'meteor', key: 'showers', kind: 'shower', cap: 'showersCap', h2: 'showersH2',
      card: [['dtShower', 'next-shower']] },
    { slug: 'lunar',  key: 'lunar',   kind: 'lunar',  cap: 'lunarCap',   h2: 'lunarH2',
      card: [['dtLunar', 'next-lunar']] },
];

/* 갈래마다 행 모양이 다르다 — 절기는 분점·지점 배지가 붙고, 삭망은 이름이 자료가
   아니라 f 플래그에서 나오고, 유성우는 시간당 개수가 붙는다. */
function skyBuild(t, topic) {
    if (topic.slug === 'term') {
        return (e) => {
            const badge = CARDINAL[e.k]
                ? `<span class="cardinal">${esc(t.cardinal[CARDINAL[e.k]])}</span>` : '';
            return skyRow(t, e, 'term', t.lang === 'en' ? e.e : e.n, e.h, badge);
        };
    }
    if (topic.slug === 'moon') {
        return (e) => skyRow(t, e, 'moon', e.f ? t.fullMoon : t.newMoon, e.f ? t.han.full : t.han.new);
    }
    /* 음력 — 이름이 자료의 숫자에서 나오고(2026년 윤6월), 곁줄에 양력 구간과
       길이가 붙는다. 길이는 s 와 다음 달 초하루에서 나오지만 표의 끝에서는
       다음 달이 표 밖이라 자료에 담아 두었다(astro.mjs 의 lunarMonths 주석). */
    if (topic.slug === 'lunar') {
        return (e) => skyRow(t, e, 'lunar', t.lunarName(e),
            `${DATE_SPAN[t.lang](e.s, isoPlus(e.s, e.n - 1))} · ${t.lunarLen(e.n)}`,
            e.leap ? `<span class="leap">${esc(t.leapBadge)}</span>` : '');
    }
    return (e) => skyRow(t, e, 'shower', t.showerName(t.lang === 'en' ? e.e : e.n), t.zhr(e.z));
}

const skyCrumbs = (t, slug, name) => ({
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
        { '@type': 'ListItem', position: 1, name: SITE, item: `${BASE}${t.dir}/` },
        { '@type': 'ListItem', position: 2, name: t.skyCrumb, item: url(t.lang, 'sky/') },
        ...(slug === 'sky/' ? [] : [{ '@type': 'ListItem', position: 3, name, item: url(t.lang, slug) }]),
    ],
});

/* -------------------------------------------------------------- 하늘 허브
   표를 이고 있지 않다. 176건을 한 URL 에 몰아 두면 어느 검색어에도 정확히
   대응하지 못해서 갈래로 쪼갰고, 여기는 그 갈래로 보내는 자리만 맡는다.

   "다가오는" 칸은 첫 화면과 같은 것이다 — dday.js 의 initSkyHome 이 #skylist 를
   보고 sky.json 을 받아 채운다. 두 화면이 같은 코드를 쓰므로 답이 갈라지지 않는다. */
function skyHubPage(t, sky) {
    const slug = 'sky/';
    const links = SKY_TOPICS.map((topic) => {
        const s = t.sky[topic.slug];
        return `      <li><a href="${t.dir}/sky/${topic.slug}/">${esc(s.hub)}` +
            `<span class="en">${esc(s.hubNote)}</span>` +
            `<span class="cc">${esc(t.skyCount(sky[topic.key].length))}</span></a></li>`;
    }).join('\n');

    return `${head(t, { title: t.skyTitle(MID), desc: t.skyDesc(MID), slug, card: 'sky', alt: `${t.skyCrumb} — ${SITE}` })}
<body data-sky-hub="1">

${top(t, { slug, axis: 'sky', label: esc(t.pickerLabel) })}

<main class="wrap">

  <h1>${esc(t.skyH1)}</h1>
  <p class="lede">${esc(t.skyLede)}</p>

  <section id="sky">
    <span class="cap">${esc(t.skyHomeCap)}</span>
    <h2>${esc(t.skyHomeH2)}</h2>
    <ul class="worldwide" id="skylist"></ul>
  </section>

  <section>
    <span class="cap">${esc(t.skyTopicsCap)}</span>
    <h2>${esc(t.skyTopicsH2)}</h2>
    <ul class="countries">
${links}
    </ul>
  </section>

  <p class="note">${esc(t.skyNote)}</p>

  <section>
    <p><a href="${t.dir}/#countries">${esc(t.otherCountries)}</a></p>
  </section>

  <div class="foot">
    <p>${esc(t.skyFoot)}</p>
    <p>${t.contact} ${CONTACT}</p>
  </div>
</main>

<script type="application/ld+json">${JSON.stringify(skyCrumbs(t, slug))}</script>
<script src="/shared/dday.js"></script>
<script src="/shared/contact.js"></script>
</body>
</html>
`;
}

/* ----------------------------------------------------------- 하늘 갈래 한 장
   자료는 허브와 같은 sky.json 한 벌이고, 여기서는 갈래 하나만 3년치로 편다.
   카드 줄도 그 갈래 것만 둔다 — dday.js 의 fill() 이 없는 id 를 그냥 건너뛴다. */
function skyTopicPage(t, sky, topic) {
    const slug = `sky/${topic.slug}/`;
    const s = t.sky[topic.slug];
    const by = groupBy(sky[topic.key], (e) => skyDate(e, t));
    const body = skyGroup(t, by, t[topic.cap], t[topic.h2], skyBuild(t, topic));

    const pairs = topic.card.map(([label, id]) =>
        `      <dt>${esc(t[label])}</dt><dd id="${id}"><em>${esc(t.computing)}</em></dd>`).join('\n');

    return `${head(t, { title: s.title(MID), desc: s.desc(MID), slug, card: `sky-${topic.slug}`, alt: `${s.crumb} — ${SITE}` })}
<body data-sky="1">

${top(t, { slug, axis: 'sky', label: esc(t.pickerLabel) })}

<main class="wrap">

  <h1>${esc(s.h1)}</h1>
  <p class="lede">${esc(s.lede)}</p>

  <div class="now" id="now">
    <div class="asof">${esc(t.checking)}</div>
    <div class="verdict">${esc(t.skyVerdict)}</div>
    <dl class="pair">
${pairs}
    </dl>
  </div>

  <p class="note">${esc(s.note || t.skyNote)}</p>

${body}

  <section>
    <p><a href="${t.dir}/sky/">${esc(t.skyBackHub)}</a></p>
    <p><a href="${t.dir}/#countries">${esc(t.otherCountries)}</a></p>
  </section>

  <div class="foot">
    <p>${esc(s.foot || t.skyFoot)}</p>
    <p>${t.contact} ${CONTACT}</p>
  </div>
</main>

<script type="application/ld+json">${JSON.stringify(skyCrumbs(t, slug, s.crumb))}</script>
<script src="/shared/dday.js"></script>
<script src="/shared/contact.js"></script>
</body>
</html>
`;
}

/* ================================================================ 이름 축
   국가별 자료를 공휴일 **이름**으로 다시 묶는다. 밖에서 받아오는 것이 없고
   `data/` 에 파일을 하나도 더 만들지 않는다 — 여기서 묶어 HTML 에 박고,
   `check-pages` 가 **자기 손으로 다시 묶어** 그 HTML 과 견준다.
   원화(어느 이름을 세우고 한국어로 무엇이라 적나)는 tools/holiday-names.mjs 다. */

/** 표지 연도에 몇 나라 이상 함께 쉬는 날짜를 허브에 실을지. */
const TOGETHER_MIN = 10;
/** 순위 표에 몇 줄을 실을지. */
const RANK_TOP = 20;

/* 산문 안의 날짜 하나. DATE_SPAN 을 같은 날짜로 두 번 부르면 "12월 25~25일" 이 된다. */
const DATE_ONE = {
    ko: (iso) => { const a = NUM(iso); return `${+a.m}월 ${+a.d}일`; },
    en: (iso) => { const a = NUM(iso); return `${+a.d} ${EN_MONTH[+a.m - 1]}`; },
};

function nameIndex(datas, main) {
    const byKey = new Map();
    for (const data of datas) {
        for (const day of data.days) {
            /* 영어 이름이 없으면(현지어와 같으면) 현지어가 곧 영어 이름이다 —
               이 갈림길을 놓치면 3,375건이 'undefined' 라는 한 이름으로 뭉친다. */
            const key = NORM(day.e ?? day.n);
            if (!byKey.has(key)) byKey.set(key, new Map());
            const byDate = byKey.get(key);
            if (!byDate.has(day.d)) byDate.set(day.d, new Set());
            byDate.get(day.d).add(data.code);
        }
    }

    const out = [], missing = [];
    for (const [key, byDate] of byKey) {
        const cover = new Set();
        for (const [d, ccs] of byDate) {
            if (d.startsWith(String(main))) for (const cc of ccs) cover.add(cc);
        }
        if (cover.size < MIN) continue;

        const label = NAMES[key];
        if (!label) { missing.push(`'${key}' — ${cover.size}개국`); continue; }
        out.push({
            key, slug: label.slug, ko: label.ko, en: label.en, cover: cover.size,
            dates: [...byDate.keys()].sort()
                .map((d) => ({ d, cc: [...byDate.get(d)].sort() })),
        });
    }

    /* 라벨이 없는 채로 지나가면 한국어 페이지에 영어 이름이 박힌다 — 화면으로만
       보이고 어디서도 에러가 나지 않는 종류의 고장이라 여기서 멈춘다. */
    if (missing.length) {
        console.error(`이름 축에 라벨이 없는 이름 ${missing.length}개 — tools/holiday-names.mjs 에 적을 것:`);
        for (const m of missing) console.error('  · ' + m);
        process.exit(1);
    }

    /* 반대쪽 — 원화에는 있는데 이제 문턱을 못 넘는 이름. 페이지는 사라지는데
       공유 카드는 남아 유령이 되므로(gen-card 는 원화만 본다) 알려 준다. */
    const alive = new Set(out.map((e) => e.key));
    for (const key of Object.keys(NAMES)) {
        if (!alive.has(key)) {
            console.warn(`  주의: '${key}' 가 ${main}년에 ${MIN}개국을 못 넘는다 —`
                + ' 페이지가 나오지 않으니 holiday-names.mjs 에서 뺄 것');
        }
    }

    /* 슬러그가 부딪히거나 두 글자면 국가 페이지를 조용히 덮어쓴다 */
    const seen = new Map();
    for (const e of out) {
        if (!NAME_PAGE.test(`${NAME_ROOT}/${e.slug}`)) {
            console.error(`슬러그 '${e.slug}' 가 이름 축 모양이 아니다 (config.mjs 의 NAME_PAGE)`);
            process.exit(1);
        }
        if (seen.has(e.slug)) {
            console.error(`슬러그 '${e.slug}' 를 '${seen.get(e.slug)}' 와 '${e.key}' 가 함께 쓴다`);
            process.exit(1);
        }
        seen.set(e.slug, e.key);
    }

    /* 표지 연도의 국가 수 내림차순. 같으면 슬러그순 — 두 언어가 같은 순서를 본다. */
    return out.sort((a, b) => b.cover - a.cover || a.slug.localeCompare(b.slug));
}

/** 표지 연도에 가장 많은 나라가 함께 쉬는 날. 이름이 아니라 **날짜**로 묶는다. */
function togetherIndex(datas, main, names) {
    const byDate = new Map();
    for (const data of datas) {
        for (const day of data.days) {
            if (!day.d.startsWith(String(main))) continue;
            if (!byDate.has(day.d)) byDate.set(day.d, new Set());
            byDate.get(day.d).add(data.code);
        }
    }
    /* 그 날짜에 가장 많은 나라가 쓰는 이름을 대표로 붙인다 — 없으면 링크 없이 둔다 */
    const lead = (d) => {
        let best = null;
        for (const e of names) {
            const row = e.dates.find((x) => x.d === d);
            if (row && (!best || row.cc.length > best.n)) best = { e, n: row.cc.length };
        }
        return best && best.e;
    };
    return [...byDate.keys()]
        .map((d) => ({ d, n: byDate.get(d).size }))
        .filter((x) => x.n >= TOGETHER_MIN)
        .sort((a, b) => b.n - a.n || a.d.localeCompare(b.d))
        .map((x) => ({ ...x, lead: lead(x.d) }));
}

/** 표지 연도의 국가끼리 견주기. 전부 파생값이라 저장하지 않는다. */
function rankIndex(datas, main) {
    const y = String(main);
    const rows = datas.map((d) => ({
        code: d.code, ko: d.ko, name: d.name,
        /* **날짜 수**를 센다. 한 날짜에 공휴일이 둘 겹치는 나라가 있어서
           건수로 세면 "쉬는 날" 이 부풀려진다 (대한민국 2025-05-05 가 그렇다).
           국가 페이지의 요약은 건수를 쓰므로 페이지마다 세는 단위가 다르다 —
           그래서 여기서는 열 이름을 "쉬는 날짜" 로 두고 각주로 밝힌다. */
        n: new Set(d.days.filter((x) => x.d.startsWith(y)).map((x) => x.d)).size,
        breaks: (d.long || []).filter((w) => w.s.startsWith(y)),
    })).filter((c) => c.n > 0);

    const spans = [];
    for (const c of rows) {
        for (const w of c.breaks) {
            spans.push({ code: c.code, ko: c.ko, name: c.name, s: w.s, e: w.e,
                n: epochDay(w.e) - epochDay(w.s) + 1 });
        }
    }
    const by = (f) => (a, b) => f(b) - f(a) || a.code.localeCompare(b.code);

    return {
        total: rows.length,
        most: [...rows].sort(by((c) => c.n)).slice(0, RANK_TOP),
        least: [...rows].sort((a, b) => a.n - b.n || a.code.localeCompare(b.code)).slice(0, RANK_TOP),
        busiest: [...rows].sort(by((c) => c.breaks.length)).slice(0, RANK_TOP),
        longest: spans.sort((a, b) => b.n - a.n || a.s.localeCompare(b.s)
            || a.code.localeCompare(b.code)).slice(0, RANK_TOP),
    };
}

/* ------------------------------------------------------------- 이름 축 한 장 */

/** 표지 연도의 사실. 스니펫에 담길 문장의 재료다 — 자료를 받은 순간 고정된다. */
function nameFacts(entry, year) {
    const rows = entry.dates.filter((x) => x.d.startsWith(String(year)));
    const cc = new Set();
    for (const r of rows) for (const c of r.cc) cc.add(c);
    let peak = null;
    for (const r of rows) if (!peak || r.cc.length > peak.cc.length) peak = r;
    return {
        cover: cc.size, spread: rows.length,
        first: rows.length ? rows[0].d : null,
        peak: peak ? peak.d : null, peakN: peak ? peak.cc.length : 0,
    };
}

/* 나라 칩. 이름 칸 안에 들어가는데 dday.js 의 nameOf() 와 하니스가 `.ccs` 를
   떼어 내므로 카드에는 "178개국" 만 옮겨진다 — 178개 나라 이름이 카드에
   쏟아지지 않는다. 그 두 곳과 여기가 짝이다. */
function chips(t, ccs, byCode) {
    return ccs
        .map((cc) => byCode.get(cc) || { code: cc, ko: cc, name: cc })
        .sort((a, b) => t.name(a).localeCompare(t.name(b), t.lang))
        .map((c) => `<span class="one">${flag(c.code)}<a href="${t.dir}/${c.code.toLowerCase()}/">`
            + `${esc(t.name(c))}</a></span>`)
        .join('');
}

function nameTable(t, rows, byCode) {
    const body = rows.map((r) => {
        const [y, m, d] = r.d.split('-');
        const w = dow(r.d);
        const wcls = w === 0 ? ' sun' : w === 6 ? ' sat' : '';
        return `        <tr data-d="${r.d}">
          <td class="date">${y}.${m}.${d}<span class="dow${wcls}">${t.dow[w]}</span></td>
          <td class="name">${esc(t.togetherWho(r.cc.length))}<span class="ccs">${chips(t, r.cc, byCode)}</span></td>
          <td class="mark"></td>
        </tr>`;
    }).join('\n');

    return `      <table class="who">
        <thead><tr><th>${esc(t.thDate)}</th><th>${esc(t.thWho)}</th><th></th></tr></thead>
        <tbody>
${body}
        </tbody>
      </table>`;
}

const nameCrumbs = (t, slug, name) => ({
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
        { '@type': 'ListItem', position: 1, name: SITE, item: `${BASE}${t.dir}/` },
        { '@type': 'ListItem', position: 2, name: t.nameHubCrumb, item: url(t.lang, `${NAME_ROOT}/`) },
        ...(name ? [{ '@type': 'ListItem', position: 3, name, item: url(t.lang, slug) }] : []),
    ],
});

function namePage(t, entry, byCode, main, generated) {
    const slug = `${NAME_ROOT}/${entry.slug}/`;
    const byYear = groupBy(entry.dates, (r) => r.d);
    const f = nameFacts(entry, main);

    const ccOf = (rows) => {
        const s = new Set();
        for (const r of rows) for (const c of r.cc) s.add(c);
        return s.size;
    };
    const body = [...byYear.keys()].sort((a, b) => a - b).map((y) => {
        const rows = byYear.get(y);
        const table = nameTable(t, rows, byCode);
        if (y === main) {
            return `  <section>
    <span class="cap">${esc(t.nameYearCap(y, ccOf(rows)))}</span>
    <h2>${esc(t.nameYearH2(entry, y))}</h2>
${table}
  </section>`;
        }
        return `  <details class="year">
    <summary>${esc(t.nameYearCap(y, ccOf(rows)))}</summary>
${table}
  </details>`;
    }).join('\n\n');

    return `${head(t, {
        title: t.nameTitle(entry, main),
        desc: t.nameDesc(entry, main, { ...f, first: f.first && DATE_ONE[t.lang](f.first) }),
        slug,
        card: `${NAME_ROOT}-${entry.slug}`,
        alt: `${t.nameH1(entry)} — ${SITE}`,
    })}
<body data-list="name">

${top(t, { slug, axis: 'name', label: esc(t.pickerLabel) })}

<main class="wrap">

  <h1>${esc(t.nameH1(entry))}</h1>
  <p class="lede">${esc(t.nameLede(entry))}</p>
  <p class="sum">${esc(t.nameSum(entry, main, {
        ...f,
        first: f.first && DATE_ONE[t.lang](f.first),
        peak: f.peak && DATE_ONE[t.lang](f.peak),
    }))}</p>

  <div class="now" id="now">
    <div class="asof">${esc(t.checking)}</div>
    <div class="verdict">${esc(t.nameVerdict(entry))}</div>
    <dl class="pair">
      <dt>${esc(t.dtNextName)}</dt><dd id="next"><em>${esc(t.computing)}</em></dd>
      <dt>${esc(t.dtPrevName)}</dt><dd id="prev"><em>${esc(t.computing)}</em></dd>
    </dl>
  </div>

  <p class="note">${esc(t.nameNote)}</p>

${body}

  <section>
    <p><a href="${t.dir}/${NAME_ROOT}/">${esc(t.nameBackHub)}</a></p>
    <p><a href="${t.dir}/#countries">${esc(t.otherCountries)}</a></p>
  </section>

${foot(t, generated)}
</main>

<script type="application/ld+json">${JSON.stringify(nameCrumbs(t, slug, t.nameH1(entry)))}</script>
<script src="/shared/dday.js"></script>
<script src="/shared/contact.js"></script>
</body>
</html>
`;
}

/* -------------------------------------------------------------- 이름 축 허브
   이름으로 보내는 자리이면서, **날짜 축**으로 뒤집은 표를 하나 이고 있다.
   첫 화면의 "오늘 어느 나라가 쉬나" 는 있는데 "어떤 날에 가장 많은 나라가
   쉬나" 는 여태 아무 데도 없었다 — 같은 자료를 한 번 더 뒤집으면 나온다. */
function nameHubPage(t, names, together, main, generated) {
    const slug = `${NAME_ROOT}/`;
    /* 곁줄은 한국어 화면에만 둔다 — 영어 이름을 곁들이면 읽는 데 도움이 되지만,
       영어 화면에 한국어 라벨을 곁들이면 그건 그냥 한국어 누출이다. */
    const links = names.map((e) => {
        const sub = t.lang === 'en' ? '' : `<span class="en">${esc(e.en)}</span>`;
        return `      <li><a href="${t.dir}/${NAME_ROOT}/${e.slug}/">${esc(t.lang === 'en' ? e.en : e.ko)}`
            + `${sub}<span class="cc">${esc(t.nameCount(e.cover))}</span></a></li>`;
    }).join('\n');

    const rows = together.map((x) => {
        const [y, m, d] = x.d.split('-');
        const w = dow(x.d);
        const wcls = w === 0 ? ' sun' : w === 6 ? ' sat' : '';
        const who = x.lead
            ? `<a href="${t.dir}/${NAME_ROOT}/${x.lead.slug}/">${esc(t.lang === 'en' ? x.lead.en : x.lead.ko)}</a>`
            : '';
        return `        <tr data-d="${x.d}">
          <td class="date">${y}.${m}.${d}<span class="dow${wcls}">${t.dow[w]}</span></td>
          <td class="name">${esc(t.togetherWho(x.n))}${who ? `<span class="ccs">${who}</span>` : ''}</td>
          <td class="mark"></td>
        </tr>`;
    }).join('\n');

    return `${head(t, {
        title: t.nameHubTitle(names.length),
        desc: t.nameHubDesc(names.length, main, TOGETHER_MIN),
        slug, card: NAME_ROOT, alt: `${t.nameHubCrumb} — ${SITE}`,
    })}
<body data-list="hub">

${top(t, { slug, axis: 'name', label: esc(t.pickerLabel) })}

<main class="wrap">

  <h1>${esc(t.nameHubH1)}</h1>
  <p class="lede">${esc(t.nameHubLede)}</p>

  <section>
    <span class="cap">${esc(t.togetherCap(main, together.length))}</span>
    <h2>${esc(t.togetherH2(main))}</h2>
    <p class="note">${esc(t.togetherNote(TOGETHER_MIN, main))}</p>
      <table class="who">
        <thead><tr><th>${esc(t.thDate)}</th><th>${esc(t.thTogether)}</th><th></th></tr></thead>
        <tbody>
${rows}
        </tbody>
      </table>
  </section>

  <section>
    <span class="cap">${esc(t.nameListCap(names.length))}</span>
    <h2>${esc(t.nameListH2)}</h2>
    <ul class="countries">
${links}
    </ul>
  </section>

  <section>
    <p><a href="${t.dir}/#countries">${esc(t.otherCountries)}</a></p>
  </section>

${foot(t, generated)}
</main>

<script type="application/ld+json">${JSON.stringify(nameCrumbs(t, slug))}</script>
<script src="/shared/dday.js"></script>
<script src="/shared/contact.js"></script>
</body>
</html>
`;
}

/* ==================================================== 나라끼리 견주기 (/rank/)
   국가 페이지 204장은 한 나라씩만 보여 준다. "어디가 가장 많이 쉬나" 는
   204장을 다 열어야 답이 나오는데, 그건 답이 없는 것과 같다.
   전부 파생값이라 자료를 하나도 더 만들지 않는다. */

function rankRows(t, rows, cell) {
    return rows.map((c, i) => `        <tr>
          <td class="no">${i + 1}</td>
          <td class="who">${flag(c.code)}<a href="${t.dir}/${c.code.toLowerCase()}/">${esc(t.name(c))}</a></td>
          <td class="len">${esc(cell(c))}</td>
        </tr>`).join('\n');
}

function rankTable(t, rows, th, cell) {
    return `      <table class="rank">
        <thead><tr><th>${esc(t.thRank)}</th><th>${esc(t.thCountry)}</th><th>${esc(th)}</th></tr></thead>
        <tbody>
${rankRows(t, rows, cell)}
        </tbody>
      </table>`;
}

/* 최장 연휴 표만 행이 구간이라 열이 다르다. tr data-s/data-e 를 달아 두면
   dday.js 가 국가 페이지의 연휴 표와 **같은 규칙으로** D-day 를 붙인다 —
   여기서 규칙을 새로 만들면 사이트 안에서 D-day 가 두 뜻을 갖는다. */
function rankBreakTable(t, spans) {
    const rows = spans.map((w, i) => `        <tr data-s="${w.s}" data-e="${w.e}">
          <td class="no">${i + 1}</td>
          <td class="who">${flag(w.code)}<a href="${t.dir}/${w.code.toLowerCase()}/">${esc(t.name(w))}</a></td>
          <td class="range">${breakSpan(t, w.s, w.e)}</td>
          <td class="len">${esc(t.breakLen(w.n))}</td>
          <td class="mark"></td>
        </tr>`).join('\n');

    return `      <table class="rank breaks">
        <thead><tr><th>${esc(t.thRank)}</th><th>${esc(t.thCountry)}</th><th>${esc(t.thSpan)}</th><th>${esc(t.thBreak)}</th><th></th></tr></thead>
        <tbody>
${rows}
        </tbody>
      </table>`;
}

function rankPage(t, rank, main, generated) {
    const slug = 'rank/';
    const f = {
        most: { label: t.name(rank.most[0]), n: rank.most[0].n },
        least: { label: t.name(rank.least[0]), n: rank.least[0].n },
        long: { label: t.name(rank.longest[0]), n: rank.longest[0].n },
    };

    const crumbs = {
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: [
            { '@type': 'ListItem', position: 1, name: SITE, item: `${BASE}${t.dir}/` },
            { '@type': 'ListItem', position: 2, name: t.rankCrumb, item: url(t.lang, slug) },
        ],
    };

    return `${head(t, {
        title: t.rankTitle(main), desc: t.rankDesc(main, f), slug,
        card: 'rank', alt: `${t.rankCrumb} — ${SITE}`,
    })}
<body data-list="rank">

${top(t, { slug, axis: 'rank', label: esc(t.pickerLabel) })}

<main class="wrap">

  <h1>${esc(t.rankH1)}</h1>
  <p class="lede">${esc(t.rankLede)}</p>
  <p class="sum">${esc(t.rankDesc(main, f))}</p>
  <p class="note">${esc(t.rankNote(main, rank.total))}</p>

  <section>
    <span class="cap">${esc(t.rankBreakCap(rank.longest.length))}</span>
    <h2>${esc(t.rankBreakH2(main))}</h2>
    <p class="note">${esc(t.rankBreakNote)}</p>
${rankBreakTable(t, rank.longest)}
  </section>

  <section>
    <span class="cap">${esc(t.rankMostCap(rank.most.length))}</span>
    <h2>${esc(t.rankMostH2(main))}</h2>
${rankTable(t, rank.most, t.thDayCount, (c) => t.rankDays(c.n))}
  </section>

  <section>
    <span class="cap">${esc(t.rankLeastCap(rank.least.length))}</span>
    <h2>${esc(t.rankLeastH2(main))}</h2>
${rankTable(t, rank.least, t.thDayCount, (c) => t.rankDays(c.n))}
  </section>

  <section>
    <span class="cap">${esc(t.rankBreaksCap(rank.busiest.length))}</span>
    <h2>${esc(t.rankBreaksH2(main))}</h2>
${rankTable(t, rank.busiest, t.thBreakCount, (c) => t.rankTimes(c.breaks.length))}
  </section>

  <section>
    <p><a href="${t.dir}/#countries">${esc(t.otherCountries)}</a></p>
  </section>

${foot(t, generated)}
</main>

<script type="application/ld+json">${JSON.stringify(crumbs)}</script>
<script src="/shared/dday.js"></script>
<script src="/shared/contact.js"></script>
</body>
</html>
`;
}

function homePage(t, index, generated) {
    const n = index.length;
    const links = index.map((c) =>
        `      <li data-cc="${c.code}" data-key="${esc(searchKey(c))}"><a href="${t.dir}/${c.code.toLowerCase()}/">${flag(c.code)}<span class="cn">${esc(t.name(c))}</span><span class="cc">${c.code}</span></a></li>`
    ).join('\n');

    return `${head(t, { title: t.homeTitle(n), desc: t.homeDesc(n), slug: '', card: 'home', alt: SITE })}
<body>

${top(t, { slug: '', home: true, axis: 'country', label: esc(t.pickerLabel) })}

<main class="wrap">

  <h1>${esc(t.homeH1)}</h1>
  <p class="lede">${esc(t.homeLede)}</p>

  <div class="now" id="home" hidden></div>

  <section id="today">
    <span class="cap" id="tcap">${esc(t.todayCap)}</span>
    <h2>${esc(t.todayH2)}</h2>
    <p class="pending" id="tnote">${esc(t.todayWait)}</p>
    <ul class="worldwide" id="tlist"></ul>
  </section>

  <section id="sky">
    <span class="cap">${esc(t.skyHomeCap)}</span>
    <h2>${esc(t.skyHomeH2)}</h2>
    <ul class="worldwide" id="skylist"></ul>
    <p><a href="${t.dir}/sky/">${esc(t.skyLink)}</a></p>
  </section>

  <section id="countries">
    <span class="cap">${esc(t.countriesCap(n))}</span>
    <h2>${esc(t.countriesH2)}</h2>
    <input type="search" class="find" id="csearch" placeholder="${esc(t.searchHint)}" aria-label="${esc(t.searchLabel)}" autocomplete="off">
    <ul class="countries" id="clist">
${links}
    </ul>
    <div class="none" id="cnone" hidden>${esc(t.noCountry)}</div>
  </section>

${foot(t, generated)}
</main>

<script src="/shared/dday.js"></script>
<script src="/shared/contact.js"></script>
</body>
</html>
`;
}

/* ---------------------------------------------------------------- 404
   canonical 도 hreflang 도 넣지 않는다 — 색인될 쪽이 아니다.
   Cloudflare 의 not_found_handling = "404-page" 는 경로를 거슬러 올라가며
   가장 가까운 404.html 을 찾는다. /en/404.html 을 함께 두면 /en/... 로 잘못
   들어온 사람이 영어 안내를 본다. */
function notFoundPage(t) {
    return `<!DOCTYPE html>
<html lang="${t.lang}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="icon" href="/favicon.ico" sizes="48x48">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="icon" href="/icon-192.png" type="image/png" sizes="192x192">
  <link rel="apple-touch-icon" href="/apple-touch-icon.png">
  <title>${esc(t.nfTitle)}</title>
  <meta name="robots" content="noindex">
  <link rel="stylesheet" href="/fonts/fonts.css">
  <link rel="stylesheet" href="/shared/base.css">
  <link rel="stylesheet" href="/shared/dday.css">
</head>
<body>

<div class="top"><div class="wrap">
  <a class="brand" href="${t.dir}/">← ${SITE}</a>
</div></div>

<main class="wrap">
  <h1>${esc(t.nfH1)}</h1>
  <p class="lede">${t.nfLede}</p>
  <p><a href="${t.dir}/#countries">${esc(t.nfBack)}</a></p>

  <div class="foot">
    <p>${t.contact} ${CONTACT}</p>
  </div>
</main>

<script src="/shared/contact.js"></script>
</body>
</html>
`;
}

/* ------------------------------------------------------------------ 실행 */

const index = JSON.parse(readFileSync(join(DATA, 'countries.json'), 'utf8'));
const SPECIAL = new Set(['countries.json', 'sky.json']);
const files = readdirSync(DATA).filter((f) => f.endsWith('.json') && !SPECIAL.has(f));

if (index.some((c) => c.code === 'EN')) {
    console.error('국가 코드 EN 이 생겼다 — /en/ 언어 칸과 부딪힌다. 언어 칸 주소를 바꿀 것.');
    process.exit(1);
}

/* 국가가 아닌 슬러그가 국가 코드와 부딪히면 국가 페이지를 조용히 덮어쓴다.
   지금은 'sky' 가 세 글자라 안 부딪히지만, 늘어날 때를 위해 확인해 둔다. */
for (const slug of EXTRA) {
    if (index.some((c) => c.code.toLowerCase() === slug)) {
        console.error(`슬러그 '${slug}' 가 국가 코드와 부딪힌다 — 다른 이름을 쓸 것.`);
        process.exit(1);
    }
}

const skyFile = join(DATA, 'sky.json');
if (!existsSync(skyFile)) {
    console.error('data/sky.json 이 없다 — node tools/gen-sky.mjs 를 먼저 돌릴 것.');
    process.exit(1);
}
const sky = JSON.parse(readFileSync(skyFile, 'utf8'));

/* 이전에 만든 국가·언어 디렉터리를 먼저 지운다. Nager 에서 빠진 국가의 페이지가
   남으면 sitemap 에는 없는데 링크만 살아 있는 유령이 된다. 'en' 도 두 글자라
   이 규칙에 함께 걸려 통째로 다시 만들어진다.
   국가가 아닌 슬러그(EXTRA)는 두 글자가 아니라서 따로 지운다. */
for (const name of readdirSync(PUB, { withFileTypes: true })) {
    if (name.isDirectory() && (/^[a-z]{2}$/.test(name.name) || EXTRA.includes(name.name))) {
        rmSync(join(PUB, name.name), { recursive: true });
    }
}

let generated = today();
let count = 0;

/* 자료를 한 번만 읽는다. 이름 축과 순위는 204개 파일을 통째로 봐야 나오는데,
   언어마다 다시 읽으면 두 벌이 갈라질 수 있다(같은 자료로 만든 두 페이지가
   서로 다른 수를 적는 일이 실제로 가능하다). */
const all = files
    .map((f) => JSON.parse(readFileSync(join(DATA, f), 'utf8')))
    .filter((d) => d.days.length);
for (const d of all) generated = d.generated || generated;

/* 표지 연도. 국가 페이지의 규칙과 같다 — 올해가 있으면 올해. */
const coverYear = all.some((d) => d.days.some((x) => x.d.startsWith(String(MID))))
    ? MID
    : Math.min(...all.flatMap((d) => d.days.map((x) => +x.d.slice(0, 4))));

const byCode = new Map(index.map((c) => [c.code, c]));
const names = nameIndex(all, coverYear);
const together = togetherIndex(all, coverYear, names);
const rank = rankIndex(all, coverYear);

for (const lang of ['ko', 'en']) {
    const t = L[lang];
    const root = join(PUB, t.dir.replace(/^\//, ''));

    /* countries.json 은 한글 이름순으로 저장돼 있다. 영어 페이지에서 그대로 쓰면
       Ghana 가 맨 앞에 오는(가나) 무작위 순서로 보인다 — 보이는 이름으로 다시 정렬한다. */
    const sorted = [...index].sort((a, b) =>
        t.name(a).localeCompare(t.name(b), t.lang));

    for (const data of all) {
        const dir = join(root, data.code.toLowerCase());
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, 'index.html'), countryPage(t, data));
        count++;
    }

    /* 이름 축 — 허브 하나와 이름 하나씩. 국가 축도 전세계 공통 축도 아닌
       세 번째 축이고, 자료를 하나도 더 만들지 않는다. */
    const nameDir = join(root, NAME_ROOT);
    mkdirSync(nameDir, { recursive: true });
    writeFileSync(join(nameDir, 'index.html'), nameHubPage(t, names, together, coverYear, generated));
    count++;
    for (const entry of names) {
        const dir = join(nameDir, entry.slug);
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, 'index.html'), namePage(t, entry, byCode, coverYear, generated));
        count++;
    }

    /* 나라끼리 견주기 — 한 장이다. 표를 여럿 이고 있어도 물음이 하나라 나누지 않는다. */
    const rankDir = join(root, 'rank');
    mkdirSync(rankDir, { recursive: true });
    writeFileSync(join(rankDir, 'index.html'), rankPage(t, rank, coverYear, generated));
    count++;

    /* 하늘. 국가 축이 아니라 전 세계 공통 축이라 자료가 한 벌인데, 갈래가 셋이라
       페이지는 넷이다 — 허브 하나와 갈래 셋. 허브는 표를 이고 있지 않다. */
    const skyDir = join(root, 'sky');
    mkdirSync(skyDir, { recursive: true });
    writeFileSync(join(skyDir, 'index.html'), skyHubPage(t, sky));
    count++;
    for (const topic of SKY_TOPICS) {
        const dir = join(skyDir, topic.slug);
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, 'index.html'), skyTopicPage(t, sky, topic));
        count++;
    }

    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, 'index.html'), homePage(t, sorted, generated));
    writeFileSync(join(root, '404.html'), notFoundPage(t));
    count++;
}

console.log(`페이지 ${count}개 (한국어·영어 각 ${count / 2}개) — 표지 연도 ${coverYear}`);
console.log(`  국가 ${all.length} · 이름 축 ${names.length} (문턱 ${MIN}개국)`
    + ` · 함께 쉬는 날 ${together.length}일 (${TOGETHER_MIN}개국 이상) · 하늘 ${SKY_TOPICS.length}갈래`);
