/* ============================================================
   this is the day — 클라이언트
   ------------------------------------------------------------
   서버가 없으므로 "오늘" 은 여기서만 정해진다. 정적 HTML 에는 날짜와 이름까지만
   들어 있고, D-day · 오늘 여부 · 지나감 표시는 전부 이 파일이 붙인다.
   그래서 페이지를 몇 달 전에 배포해 두어도 표시가 낡지 않는다.

   한국어와 영어가 같은 파일을 쓴다. 갈림길은 <html lang> 하나이고, 말은 아래
   STR 표에 모아 두었다 — 페이지마다 사전을 인라인하면 한쪽만 고쳐지는 일이 생긴다.

   표는 다시 받지 않는다 — 공휴일도(<tr data-d>), 황금연휴도(<tr data-s>),
   절기·삭망도(<tr data-sky>) 이미 HTML 안에 있어서 DOM 만 읽으면 된다.
   fetch 는 네 곳에만 쓴다.
     · 국가 선택기 목록 (countries.json) — 204개 <li> 를 412개 페이지에 인라인하면
       HTML 만 7MB 가 된다. 첫 화면의 국가 목록만 HTML 에 박고 선택기는 여기서 채운다.
     · 첫 화면의 "내 국가" 요약 카드
     · 첫 화면의 "오늘 공휴일인 나라" — 이번 달 색인 하나 (data/month/YYYY-MM.json)
     · 첫 화면의 "다가오는 절기와 삭망" — sky.json 하나 (/sky/ 페이지는 안 받는다)
   ============================================================ */
(function () {
    'use strict';

    /* --------------------------------------------------------------- 말
       <html lang> 하나로 갈린다. 페이지마다 인라인 사전을 심지 않는 이유는
       두 언어가 같은 파일을 쓰기 때문이다 — 한쪽만 고쳐지는 일이 없다.

       dir 은 링크를 만들 때 붙는 언어 칸이다. gen-pages.mjs 의 L.*.dir 과
       반드시 같아야 한다 — 경로 규칙을 바꿀 때 여기도 같이 고칠 것. */
    var LANG = (document.documentElement.getAttribute('lang') === 'en') ? 'en' : 'ko';

    var STR = {
        ko: {
            dow: ['일', '월', '화', '수', '목', '금', '토'],
            date: function (p) { return p.y + '년 ' + p.m + '월 ' + p.d + '일'; },
            short: function (p) { return p.m + '월 ' + p.d + '일'; },
            asof: function (d) { return '기준 ' + d + ' · 내 기기 시간'; },
            today: '오늘',
            /* 부정문을 쓰지 않는다. 이 사이트는 이제 공휴일만 다루지 않아서,
               "공휴일이 아니다" 는 카드의 머리글이 되기에 좁고 막다르다. */
            noHoliday: '오늘은 여느 날입니다',
            off: ' — 오늘 쉽니다',
            partial: ' — 일부 지역만 쉽니다',
            outOfRange: '담긴 자료 범위 밖입니다',
            allOf: function (name) { return name + ' 공휴일 전체 보기 →'; },
            dtAll: '전체',
            dtNext: '다음',
            dtPrev: '지난',
            dtBreak: '다음 연휴',
            breakLen: function (n) { return n + '일 연휴'; },
            breakNow: '연휴 중',
            noBreak: '담긴 자료에 연휴가 없습니다',
            loadFail: '국가 목록을 불러오지 못했습니다.',
            todayCapN: function (n) { return '전 세계 · ' + n + '곳'; },
            todayNone: '오늘은 어느 나라도 공휴일이 아닙니다.',
            todayFail: '오늘 공휴일인 나라를 불러오지 못했습니다.',
            todayOut: '담긴 자료 범위 밖의 날짜입니다.',
            regionOnly: function (n) { return '일부 지역 ' + n + '곳'; },
            name: function (c) { return c.ko || c.name; },
            holiday: function (h) { return h.n; },
            holidaySub: function (h) { return h.e || ''; },
            /* 하늘. zone 은 sky.json 이 미리 굳혀 둔 날짜 중 어느 쪽을 쓸지다 —
               ko 는 KST, en 은 UTC. 브라우저가 다시 계산하면 HTML 에 박힌 날짜와
               갈라질 수 있으므로 여기서는 고르기만 한다. */
            zone: 'kst',
            skyNone: '오늘은 절기도 삭망도 아닙니다',
            /* 음력 페이지의 "아무것도 아닌 날". 갈래가 음력뿐인 페이지에서
               "절기도 삭망도 아닙니다" 라고 적으면 그건 거짓말이다. */
            lunarNone: '오늘은 초하루가 아닙니다',
            skyOff: ' — 오늘입니다',
            newMoon: '삭', fullMoon: '보름',
            showerName: function (n) { return n + ' 유성우'; },
            skyName: function (e) { return e.n; },
            skySub: function (e) { return e.h || ''; },
            dtTerm: '다음 절기', dtNew: '다음 삭',
            dtFull: '다음 보름', dtShower: '다음 유성우',
            skyFail: '하늘 자료를 불러오지 못했습니다.',
            dir: ''
        },
        en: {
            dow: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
            mon: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
            date: function (p) { return STR.en.mon[p.m - 1] + ' ' + p.d + ', ' + p.y; },
            short: function (p) { return STR.en.mon[p.m - 1] + ' ' + p.d; },
            asof: function (d) { return 'As of ' + d + ' · this device'; },
            today: 'today',
            noHoliday: 'An ordinary day',
            off: ' — a day off today',
            partial: ' — observed only in some regions',
            outOfRange: 'Outside the range of the data',
            allOf: function (name) { return 'All ' + name + ' holidays →'; },
            dtAll: 'All',
            dtNext: 'Next',
            dtPrev: 'Last',
            dtBreak: 'Next break',
            breakLen: function (n) { return n + '-day break'; },
            breakNow: 'on now',
            noBreak: 'No long weekend in the data',
            loadFail: 'Could not load the country list.',
            todayCapN: function (n) { return 'Around the world · ' + n; },
            todayNone: 'No country has a public holiday today.',
            todayFail: 'Could not load today’s holidays.',
            todayOut: 'That date is outside the range of the data.',
            regionOnly: function (n) { return n + ' regions'; },
            name: function (c) { return c.name || c.ko; },
            holiday: function (h) { return h.e || h.n; },
            holidaySub: function (h) { return h.e ? h.n : ''; },
            zone: 'utc',
            skyNone: 'No solar term or moon phase today',
            lunarNone: 'Not the first day of a lunar month',
            skyOff: ' — today',
            newMoon: 'New Moon', fullMoon: 'Full Moon',
            showerName: function (n) { return n; },
            skyName: function (e) { return e.e || e.n; },
            skySub: function (e) { return e.h || ''; },
            dtTerm: 'Next term', dtNew: 'Next new moon',
            dtFull: 'Next full moon', dtShower: 'Next shower',
            skyFail: 'Could not load the sky data.',
            dir: '/en'
        }
    };
    var T = STR[LANG];

    var $ = function (sel, root) { return (root || document).querySelector(sel); };
    var $$ = function (sel, root) {
        return Array.prototype.slice.call((root || document).querySelectorAll(sel));
    };

    /* ---------------------------------------------------------------- 날짜
       'YYYY-MM-DD' 를 Date 로 바로 넘기면 UTC 로 읽혀 시간대에 따라 하루가 밀린다.
       날짜 계산은 전부 "에폭 일수" 정수로만 한다 — 서머타임에도 어긋나지 않는다. */
    function parts(iso) {
        var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
        return m ? { y: +m[1], m: +m[2], d: +m[3] } : null;
    }
    function epochDay(iso) {
        var p = parts(iso);
        return p ? Math.floor(Date.UTC(p.y, p.m - 1, p.d) / 86400000) : NaN;
    }
    function todayIso() {
        var n = new Date();
        return n.getFullYear() + '-' +
            String(n.getMonth() + 1).padStart(2, '0') + '-' +
            String(n.getDate()).padStart(2, '0');
    }
    function dow(iso) {
        var p = parts(iso);
        return new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay();
    }
    function human(iso) {
        return T.date(parts(iso)) + ' (' + T.dow[dow(iso)] + ')';
    }
    function shortHuman(iso) {
        return T.short(parts(iso)) + ' (' + T.dow[dow(iso)] + ')';
    }

    /* 국가 코드 → 국기 이모지. 두 글자를 지역 표시 기호로 옮긴다. */
    function flag(cc) {
        if (!/^[A-Z]{2}$/.test(cc)) return '';
        return String.fromCodePoint(
            0x1F1E6 + cc.charCodeAt(0) - 65,
            0x1F1E6 + cc.charCodeAt(1) - 65
        );
    }

    function esc(s) {
        return String(s).replace(/[&<>"]/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
        });
    }

    /* --------------------------------------------------------- 국가 목록 확보
       선택기도, 첫 화면의 "오늘 공휴일인 나라" 도 나라 이름이 필요하다.
       한 번만 받아 두고 돌려 쓴다 — 12KB 이고 CDN 이 캐시한다.

       페이지에 인라인하지 않는 이유는 410개 페이지 × 204줄이면 HTML 만
       7MB 가 되기 때문이다. 첫 화면의 국가 목록은 따로 박혀 있다. */
    var listCache = null;
    function countries() {
        if (!listCache) {
            listCache = fetch('/data/countries.json').then(function (r) {
                if (!r.ok) throw new Error('HTTP ' + r.status);
                return r.json();
            });
        }
        return listCache;
    }

    /* ------------------------------------------------------------- 분류
       날짜 목록을 오늘 기준으로 가른다. 표(DOM)에서 왔든 JSON 에서 왔든 같은 함수를
       쓰므로, 첫 화면 카드와 국가 페이지 카드가 서로 다른 답을 낼 수 없다.

       items: [{ d: 'YYYY-MM-DD', ... }]  →  { marked, todays, next, prev } */
    function classify(items, today) {
        var t = epochDay(today);
        var marked = items.map(function (it) {
            return { item: it, diff: epochDay(it.d) - t };
        });

        var todays = [], next = null, prev = null;
        marked.forEach(function (m) {
            if (m.diff === 0) todays.push(m);
            /* 오늘 것을 다음 후보로 잡으면 "다음 공휴일: 오늘" 이 되어버린다 */
            else if (m.diff > 0 && (!next || m.diff < next.diff)) next = m;
            else if (m.diff < 0 && (!prev || m.diff > prev.diff)) prev = m;
        });

        return { marked: marked, todays: todays, next: next, prev: prev };
    }

    /* ---------------------------------------------------------- 연휴 분류
       연휴는 하루가 아니라 구간이라 classify() 를 쓸 수 없다. 갈림길이 셋이다.
         시작 전 → D-(시작까지)   ·   끝난 뒤 → D+(끝난 뒤)   ·   그 사이 → 연휴 중
       "다음" 은 지금 붙어 있는 연휴가 있으면 그것이다. 남은 이틀을 두고
       두 달 뒤 연휴를 가리키면 카드가 거짓말을 한다.

       items: [{ s: 'YYYY-MM-DD', e: 'YYYY-MM-DD', ... }] */
    function breakState(it, t) {
        var s = epochDay(it.s), e = epochDay(it.e);
        var days = e - s + 1;
        if (t < s) return { item: it, phase: 'next', diff: s - t, days: days };
        if (t > e) return { item: it, phase: 'past', diff: e - t, days: days };
        return { item: it, phase: 'now', diff: 0, nth: t - s + 1, days: days };
    }
    function classifyBreaks(items, today) {
        var t = epochDay(today);
        var marked = items.map(function (it) { return breakState(it, t); });

        var now = null, next = null;
        marked.forEach(function (m) {
            if (m.phase === 'now') { if (!now) now = m; }
            else if (m.phase === 'next' && (!next || m.diff < next.diff)) next = m;
        });

        return { marked: marked, now: now, next: next, upcoming: now || next };
    }

    /* ------------------------------------------------------------ 표 채우기
       공휴일 표든 하늘 표든 D-day 를 붙이는 규칙은 하나여야 한다. 표마다 다른
       규칙을 쓰면 같은 사이트 안에서 D-day 가 여러 뜻을 갖는다. */
    function markRows(marked) {
        marked.forEach(function (m) {
            var tr = m.item.tr;
            var mark = $('.mark', tr);

            if (m.diff === 0) {
                tr.classList.add('is-today');
                if (mark) mark.innerHTML = '<span class="now">' + T.today + '</span>';
            } else if (m.diff < 0) {
                tr.classList.add('is-past');
                if (mark) mark.textContent = 'D+' + (-m.diff);
            } else if (mark) {
                mark.innerHTML = '<span class="soon">D-' + m.diff + '</span>';
            }
        });
    }

    function paintTables(today) {
        var rows = $$('tr[data-d]');
        var got = classify(rows.map(function (tr) {
            return {
                d: tr.getAttribute('data-d'), tr: tr, local: !!$('.local', tr),
                n: nameOf(tr), sub: subOf(tr)
            };
        }), today);
        markRows(got.marked);
        return got;
    }

    /* ---------------------------------------------------------- 연휴 표 채우기
       공휴일 표와 같은 자리(.mark)에 같은 모양으로 붙인다 — 다른 표라고 다른
       규칙을 쓰면 같은 페이지 안에서 D-day 가 두 가지 뜻을 갖는다. */
    function paintBreaks(today) {
        var rows = $$('tr[data-s]');
        var got = classifyBreaks(rows.map(function (tr) {
            return {
                s: tr.getAttribute('data-s'),
                e: tr.getAttribute('data-e'),
                tr: tr
            };
        }), today);

        got.marked.forEach(function (m) {
            var tr = m.item.tr;
            var mark = $('.mark', tr);

            if (m.phase === 'now') {
                tr.classList.add('is-today');
                if (mark) mark.innerHTML = '<span class="now">' + T.breakNow + '</span>';
            } else if (m.phase === 'past') {
                tr.classList.add('is-past');
                if (mark) mark.textContent = 'D+' + (-m.diff);
            } else if (mark) {
                mark.innerHTML = '<span class="soon">D-' + m.diff + '</span>';
            }
        });

        return got;
    }

    /* 카드의 연휴 한 줄. 국가 페이지와 첫 화면이 같은 문장을 쓴다. */
    function breakHtml(m) {
        if (!m) return '<em>' + T.noBreak + '</em>';
        return (m.phase === 'now'
                ? '<span class="dd on">' + T.breakNow + '</span>'
                : '<span class="dd">D-' + m.diff + '</span>') +
            esc(T.breakLen(m.days)) +
            '<em>' + shortHuman(m.item.s) + ' ~ ' + shortHuman(m.item.e) + '</em>';
    }

    /* 이름 칸에는 영어 이름과 지역 배지가 같이 들어 있다. 카드에는 이름만 옮긴다.
       `.ccs` 는 이름 축 페이지의 나라 칩이다 — 떼지 않으면 카드 한 줄에 178개
       나라 이름이 쏟아진다. gen-pages 의 chips() · harness 의 parseRows 와 짝이다. */
    function nameOf(tr) {
        var el = $('.name', tr);
        if (!el) return '';
        var clone = el.cloneNode(true);
        $$('.en, .regions, .local, .ccs', clone).forEach(function (x) { x.remove(); });
        return clone.textContent.trim();
    }

    /* 다른 언어로 적힌 이름. 한국어 화면에서는 영어 이름이고, 영어 화면에서는
       현지어 이름이다. 카드에 이것까지 옮기지 않으면 "敬老の日" 만 덩그러니
       남아 무슨 날인지 알 수 없다 — 아래 표에는 붙어 있는데 카드에만 없었다. */
    function subOf(tr) {
        var el = $('.en', tr);
        return el ? el.textContent.trim() : '';
    }

    /* 이름 조립. 표에서 왔든 JSON 에서 왔든 { n, sub } 한 모양이라 여기 하나로 끝난다. */
    function nameHtml(it) {
        return esc(it.n) + (it.sub ? '<span class="sub">' + esc(it.sub) + '</span>' : '');
    }
    function nameText(it) {
        return it.n + (it.sub ? ' (' + it.sub + ')' : '');
    }

    /* --------------------------------------------------------- 오늘 카드 문안
       국가 페이지와 첫 화면이 같은 문장을 쓰도록 여기서만 만든다. */
    function verdictOf(todays) {
        if (!todays.length) return { text: T.noHoliday, rest: false };
        var partial = todays.every(function (m) { return m.item.local; });
        return {
            text: todays.map(function (m) { return nameText(m.item); }).join(' · ') +
                (partial ? T.partial : T.off),
            rest: !partial
        };
    }

    function paintNow(today, found, breaks) {
        var card = $('#now');
        if (!card) return;

        var asof = $('.asof', card);
        if (asof) asof.textContent = T.asof(human(today));

        var verdict = $('.verdict', card);
        if (verdict) {
            var v = verdictOf(found.todays);
            verdict.textContent = v.text;
            verdict.className = 'verdict' + (v.rest ? ' rest' : '');
        }

        fill($('#next'), found.next, '-');
        fill($('#prev'), found.prev, '+');

        /* 연휴가 한 건도 없는 국가에는 이 줄 자체가 없다 */
        var brk = $('#break');
        if (brk) brk.innerHTML = breakHtml(breaks && breaks.upcoming);
    }
    function fill(dd, entry, sign) {
        if (!dd) return;
        dd.innerHTML = entry
            ? '<span class="dd">D' + sign + Math.abs(entry.diff) + '</span>' +
              nameHtml(entry.item) + '<em>' + shortHuman(entry.item.d) + '</em>'
            : '<em>' + T.outOfRange + '</em>';
    }

    /* ------------------------------------------------------------- 하늘
       /sky/ 는 국가 축이 아니다 — 절기도 삭망도 유성우도 온 세계가 같은 순간을
       공유한다. 갈리는 것은 날짜뿐이고 그건 sky.json 이 기준 시간대마다 미리
       굳혀 두었으므로, 여기서는 시간대를 다시 계산하지 않는다.

       표가 갈래(절기·삭망·유성우)마다 따로라 카드도 갈래마다 한 줄씩이다.
       공휴일 표와 같은 classify() 를 쓰되 갈래별로 나눠 먹인다. */
    function paintSky(today) {
        var rows = $$('tr[data-sky]');
        var groups = {};
        rows.forEach(function (tr) {
            var kind = tr.getAttribute('data-sky') || 'other';
            if (!groups[kind]) groups[kind] = [];
            groups[kind].push({
                d: tr.getAttribute('data-d'), tr: tr,
                n: evOf(tr), sub: altOf(tr)
            });
        });

        var out = {}, all = [];
        Object.keys(groups).forEach(function (kind) {
            out[kind] = classify(groups[kind], today);
            markRows(out[kind].marked);
            all = all.concat(out[kind].todays);
        });
        out.todays = all;
        return out;
    }

    /* 이름 칸에는 한자와 배지가 같이 들어 있다. 카드에는 이름만 옮긴다. */
    function evOf(tr) {
        var el = $('.ev', tr);
        if (!el) return '';
        var clone = el.cloneNode(true);
        $$('.alt, .cardinal, .leap', clone).forEach(function (x) { x.remove(); });
        return clone.textContent.trim();
    }
    function altOf(tr) {
        var el = $('.alt', tr);
        return el ? el.textContent.trim() : '';
    }

    function initSky() {
        if (!document.body.getAttribute('data-sky')) return;

        var today = todayIso();
        var got = paintSky(today);

        var card = $('#now');
        if (card) {
            var asof = $('.asof', card);
            if (asof) asof.textContent = T.asof(human(today));

            var verdict = $('.verdict', card);
            if (verdict) {
                /* 갈래가 음력 하나뿐인 페이지에는 음력 문안을 쓴다. 페이지에
                   실제로 그려진 행에서 갈리므로 표시용 표를 따로 두지 않는다. */
                var onlyLunar = !!got.lunar && !got.term && !got.moon && !got.shower;
                verdict.textContent = got.todays.length
                    ? got.todays.map(function (m) { return nameText(m.item); }).join(' · ') + T.skyOff
                    : (onlyLunar ? T.lunarNone : T.skyNone);
                verdict.className = 'verdict' + (got.todays.length ? ' rest' : '');
            }
        }

        /* 삭과 보름은 한 표에 섞여 있다 — 카드에서는 갈라야 하므로 이름으로 고른다.
           이름은 HTML 에서 왔고 HTML 은 sky.json 에서 왔으니 갈라질 자리가 없다. */
        fill($('#next-term'), got.term && got.term.next, '-');
        fill($('#next-shower'), got.shower && got.shower.next, '-');

        fill($('#next-lunar'), got.lunar && got.lunar.next, '-');

        var moons = (got.moon && got.moon.marked) || [];
        fill($('#next-new'), nextNamed(moons, T.newMoon), '-');
        fill($('#next-full'), nextNamed(moons, T.fullMoon), '-');
    }

    function nextNamed(marked, name) {
        var best = null;
        marked.forEach(function (m) {
            if (m.diff <= 0 || m.item.n !== name) return;
            if (!best || m.diff < best.diff) best = m;
        });
        return best;
    }

    /* ------------------------------------------------- 이름 축 · 순위 페이지
       국가 축도 하늘도 아닌 세 축이 더 붙었다 (/holiday/ · /holiday/{이름}/ · /rank/).
       표 모양은 그대로다 — 날짜 행은 tr[data-d], 연휴 행은 tr[data-s] —
       그래서 칠하는 규칙을 새로 만들지 않고 그대로 쓴다. 여기서 다른 규칙을
       쓰면 같은 사이트 안에서 D-day 가 두 가지 뜻을 갖는다.

       카드는 이름 축 한 장에만 있다. 허브와 순위 페이지에는 "다음" 이 하나로
       정해지지 않는다 — 허브의 표는 여러 이름이 섞여 있고, 순위 표의 행은
       나라지 날짜가 아니다. 그런 자리에 카드를 두면 무엇의 D-day 인지 모른다. */
    function initList() {
        var kind = document.body.getAttribute('data-list');
        if (!kind) return;

        var today = todayIso();
        var got = paintTables(today);
        paintBreaks(today);
        if (kind !== 'name') return;

        var card = $('#now');
        if (!card) return;
        var asof = $('.asof', card);
        if (asof) asof.textContent = T.asof(human(today));
        if (got.todays.length) {
            var verdict = $('.verdict', card);
            if (verdict) {
                verdict.textContent = got.todays.map(function (m) { return m.item.n; })
                    .join(' · ') + T.skyOff;
                verdict.className = 'verdict rest';
            }
        }
        fill($('#next'), got.next, '-');
        fill($('#prev'), got.prev, '+');
    }

    /* 첫 화면의 하늘 칸. /sky/ 로 가는 입구이기도 하다 — 여기서 링크가 빠지면
       하늘 페이지는 sitemap 에만 있고 아무도 못 찾는 쪽이 된다. */
    function initSkyHome() {
        var list = $('#skylist');
        if (!list) return;

        var today = todayIso();
        fetch('/data/sky.json').then(function (r) {
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return r.json();
        }).then(function (sky) {
            var zone = T.zone;
            /* 하늘 페이지 카드와 같은 규칙을 쓴다 — "다음" 은 앞으로 올 것이고,
               오늘 것은 그 페이지의 오늘 칸이 맡는다. 두 화면이 다른 규칙을 쓰면
               같은 날 첫 화면과 /sky/ 가 서로 다른 답을 낸다. */
            var pick = function (items, label, name, sub) {
                var got = classify(items.map(function (e) {
                    return { d: e[zone], e: e };
                }), today);
                var m = got.next;
                if (!m) return '';
                var it = m.item.e;
                /* 갈래 이름이 앞, D-day 와 내용이 뒤 — /sky/ 카드의 dt·dd 와 같은 차례다.
                   .dd 를 .what 안에 두는 것도 그래서다. 카드에서는 dd 안에 있다. */
                return '<li><span class="who">' + esc(label) + '</span>' +
                    '<span class="what"><span class="dd">D-' + m.diff + '</span>' +
                    esc(name(it)) +
                    (sub(it) ? '<span class="en">' + esc(sub(it)) + '</span>' : '') +
                    '<em>' + shortHuman(it[zone]) + '</em></span></li>';
            };

            list.innerHTML = [
                pick(sky.terms, T.dtTerm, T.skyName, T.skySub),
                pick(sky.moons.filter(function (m) { return !m.f; }), T.dtNew,
                    function () { return T.newMoon; }, function () { return ''; }),
                pick(sky.moons.filter(function (m) { return m.f; }), T.dtFull,
                    function () { return T.fullMoon; }, function () { return ''; }),
                pick(sky.showers, T.dtShower,
                    function (e) { return T.showerName(T.skyName(e)); }, function () { return ''; }),
            ].join('');
        }).catch(function () {
            list.innerHTML = '<li><span class="what">' + T.skyFail + '</span></li>';
        });
    }

    /* ------------------------------------------------------------- 선택기 */
    function initPicker() {
        var picker = $('#picker');
        if (!picker) return;

        var input = $('input', picker);
        var list = $('ul', picker);
        var none = $('.none', picker);
        if (!input || !list) return;

        var here = document.body.getAttribute('data-cc');
        var items = [];

        function apply() {
            var q = input.value.trim().toLowerCase();
            var hit = 0;
            items.forEach(function (it) {
                var on = !q || it.key.indexOf(q) >= 0;
                it.li.hidden = !on;
                if (on) hit++;
            });
            if (none) none.hidden = hit > 0;
        }

        countries().then(function (all) {
            /* countries.json 은 한글 이름순이다. 영어 화면에서 그대로 쓰면
               Ghana(가나)가 맨 앞에 오는 무작위 순서로 보인다. */
            list.innerHTML = all.slice().sort(function (a, b) {
                return T.name(a).localeCompare(T.name(b), LANG);
            }).map(function (c) {
                var cur = c.code === here;
                return '<li data-cc="' + c.code + '" data-key="' + esc(searchKey(c)) + '">' +
                    '<a href="' + T.dir + '/' + c.code.toLowerCase() + '/" data-cc="' + c.code + '"' +
                    (cur ? ' aria-current="true"' : '') + '>' +
                    '<span class="flag">' + flag(c.code) + '</span>' + esc(T.name(c)) +
                    '<span class="cc">' + c.code + '</span></a></li>';
            }).join('');

            items = $$('li', list).map(function (li) {
                return { li: li, key: (li.getAttribute('data-key') || '').toLowerCase() };
            });
            apply();
        }).catch(function () {
            list.innerHTML = '';
            if (none) { none.hidden = false; none.textContent = T.loadFail; }
        });

        input.addEventListener('input', apply);

        /* 열릴 때 검색칸으로 간다. 좁은 화면에서는 키보드가 목록을 덮으니 넓은 화면만. */
        picker.addEventListener('toggle', function () {
            if (!picker.open) return;
            if (window.matchMedia('(min-width: 641px)').matches) input.focus();
            var cur = $('a[aria-current="true"]', list);
            if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: 'center' });
        });

        /* details 는 바깥을 눌러도 안 닫힌다 */
        document.addEventListener('click', function (e) {
            if (picker.open && !picker.contains(e.target)) picker.open = false;
        });
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && picker.open) picker.open = false;
        });

    }

    /* 한글 이름 · 영어 이름 · 코드 아무거나로 찾히게 한다 ("대한", "korea", "kr") */
    function searchKey(c) {
        return [c.ko, c.name, c.code].filter(Boolean).join(' ').toLowerCase();
    }

    /* --------------------------------------------------------- 첫 화면(/) */
    /* 오로지 브라우저 언어 설정만 본다. IP 도 타임존도 보지 않는다.
       언어 설정은 사용자가 직접 고른 값이라 의도가 담겨 있고, 정적 배포만으로
       읽을 수 있다. 지역이 없는 태그('en', 'zh')는 maximize 가 채워 주는 기본
       지역을 그대로 받는다 — 영어 브라우저면 미국이 맞다고 본다는 뜻이다.
       그러니 '핀란드에서 접속했는데 미국이 뜬다' 는 버그가 아니다. 위치를
       맞히려 들지 마라. 타임존 표를 붙이고 싶어지거든 이 줄을 다시 읽어라.

       자료가 없는 지역이면 카드를 접어 둔다.

       한때 고른 국가를 localStorage 에 기억하고 그걸 먼저 썼는데, 국가 페이지를
       "열어 본 것" 만으로도 기억되는 바람에 이라크 공휴일을 한 번 구경하면
       홈이 계속 이라크가 되었다. 열람 이력은 의도가 아니다. */
    function detect(known) {
        var tags = [];
        if (navigator.languages) tags = tags.concat(navigator.languages);
        if (navigator.language) tags.push(navigator.language);

        for (var i = 0; i < tags.length; i++) {
            var region = null;
            /* Intl.Locale 은 'ko' 처럼 지역이 없는 태그도 maximize 로 KR 을 뽑아준다 */
            try { region = new Intl.Locale(tags[i]).maximize().region; } catch (_) { }
            if (!region) {
                var m = /[-_]([A-Za-z]{2})(?:[-_]|$)/.exec(tags[i]);
                region = m ? m[1].toUpperCase() : null;
            }
            if (region && known.indexOf(region) >= 0) return region;
        }
        return null;
    }

    function initHome() {
        var home = $('#home');
        if (!home) return;

        countries().then(function (all) {
            var cc = detect(all.map(function (c) { return c.code; }));
            if (!cc) return;                          /* 카드는 hidden 인 채로 둔다 */
            return fetch('/data/' + cc + '.json').then(function (r) {
                if (!r.ok) throw new Error('HTTP ' + r.status);
                return r.json();
            }).then(function (data) { renderHomeCard(home, data); });
        }).catch(function () { /* 조용히 접는다 — 아래 국가 목록으로 갈 수 있다 */ });
    }

    function renderHomeCard(home, data) {
        var today = todayIso();
        var got = classify(data.days.map(function (day) {
            return { d: day.d, n: T.holiday(day), sub: T.holidaySub(day), local: !!day.r };
        }), today);

        var v = verdictOf(got.todays);

        var line = function (label, e, sign) {
            return '<dt>' + label + '</dt><dd>' + (e
                ? '<span class="dd">D' + sign + Math.abs(e.diff) + '</span>' + nameHtml(e.item) +
                  '<em>' + shortHuman(e.item.d) + '</em>'
                : '<em>' + T.outOfRange + '</em>') + '</dd>';
        };

        /* 국가 페이지 카드와 같은 줄을 같은 순서로 그린다. 예전에 첫 화면만
           조용히 한 줄 빠뜨린 적이 있어서, 자료가 없을 때만 빠지게 해 둔다. */
        var longs = data.long || [];
        var breakLine = longs.length
            ? '<dt>' + T.dtBreak + '</dt><dd>' +
                breakHtml(classifyBreaks(longs, today).upcoming) + '</dd>'
            : '';

        var label = T.name(data);
        home.innerHTML =
            '<div class="asof">' + T.asof(human(today)) + '</div>' +
            '<div class="verdict' + (v.rest ? ' rest' : '') + '">' +
                flag(data.code) + ' ' + esc(label) + ' — ' + esc(v.text) + '</div>' +
            '<dl class="pair">' +
                line(T.dtNext, got.next, '-') +
                line(T.dtPrev, got.prev, '+') +
                breakLine +
                '<dt>' + T.dtAll + '</dt><dd><a href="' + T.dir + '/' +
                    data.code.toLowerCase() + '/">' + esc(T.allOf(label)) + '</a></dd>' +
            '</dl>';
        home.hidden = false;
    }

    /* --------------------------------------------- 오늘 공휴일인 나라
       국가별 파일로는 답할 수 없는 물음이다 — 204개를 다 받아야 하니까.
       그래서 gen-holidays.mjs 가 같은 자료를 달 단위로 한 번 더 색인해 두고,
       여기서는 이번 달 하나만 받아 오늘에 해당하는 줄만 꺼낸다.

       나라 이름은 countries.json 에서 온다. 달 파일에는 코드만 들어 있어서,
       이름이 두 군데로 갈라지지 않는다. */
    function initToday() {
        var list = $('#tlist');
        var note = $('#tnote');
        if (!list) return;

        var today = todayIso();
        var month = today.slice(0, 7);

        function fail(msg) {
            list.innerHTML = '';
            if (note) { note.hidden = false; note.textContent = msg; }
        }

        Promise.all([
            countries(),
            fetch('/data/month/' + month + '.json').then(function (r) {
                if (r.status === 404) return null;        /* 자료 범위 밖의 달 */
                if (!r.ok) throw new Error('HTTP ' + r.status);
                return r.json();
            })
        ]).then(function (both) {
            var all = both[0], data = both[1];
            if (!data) { fail(T.todayOut); return; }

            var rows = (data.d && data.d[today]) || [];
            if (!rows.length) { fail(T.todayNone); return; }

            var byCode = {};
            all.forEach(function (c) { byCode[c.code] = c; });

            var items = rows.map(function (h) {
                var c = byCode[h.c] || { code: h.c, ko: h.c, name: h.c };
                return { h: h, c: c, label: T.name(c) };
            }).sort(function (a, b) {
                return a.label.localeCompare(b.label, LANG);
            });

            list.innerHTML = items.map(function (it) {
                var sub = T.holidaySub(it.h);
                return '<li>' +
                    '<span class="who">' + flag(it.c.code) + ' <a href="' + T.dir + '/' +
                        it.c.code.toLowerCase() + '/">' + esc(it.label) + '</a></span>' +
                    '<span class="what">' + esc(T.holiday(it.h)) +
                        (sub ? '<span class="en">' + esc(sub) + '</span>' : '') +
                        (it.h.r ? '<span class="local" title="' + esc(it.h.r.join(', ')) + '">' +
                            esc(T.regionOnly(it.h.r.length)) + '</span>' : '') +
                    '</span></li>';
            }).join('');

            if (note) note.hidden = true;
            var cap = $('#tcap');
            if (cap) cap.textContent = T.todayCapN(items.length);
        }).catch(function () { fail(T.todayFail); });
    }

    /* ------------------------------------------------- 첫 화면 국가 검색
       선택기 안에도 검색이 있지만 그건 열어야 보인다. 첫 화면의 204줄짜리
       목록은 열려 있는 채로 눈앞에 있으니, 그 자리에서 바로 줄여야 한다. */
    function initFind() {
        var input = $('#csearch');
        var list = $('#clist');
        var none = $('#cnone');
        if (!input || !list) return;

        var items = $$('li[data-key]', list).map(function (li) {
            return { li: li, key: (li.getAttribute('data-key') || '').toLowerCase() };
        });

        input.addEventListener('input', function () {
            var q = input.value.trim().toLowerCase();
            var hit = 0;
            items.forEach(function (it) {
                var on = !q || it.key.indexOf(q) >= 0;
                it.li.hidden = !on;
                if (on) hit++;
            });
            if (none) none.hidden = hit > 0;
            /* 다 걸러지면 목록이 빈 칸으로 남는다 — 줄여서 "없음" 만 보이게 */
            list.hidden = hit === 0;
        });

        /* Esc 로 비운다 — type="search" 의 기본 동작은 브라우저마다 다르다 */
        input.addEventListener('keydown', function (e) {
            if (e.key !== 'Escape' || !input.value) return;
            input.value = '';
            input.dispatchEvent(new Event('input'));
        });
    }

    /* ---------------------------------------------------------------- 시동 */
    function start() {
        initPicker();
        initFind();
        initToday();

        var page = document.body.getAttribute('data-cc');
        if (page) {
            var today = todayIso();
            paintNow(today, paintTables(today), paintBreaks(today));
        }
        initSky();
        initList();
        initSkyHome();
        initHome();
    }

    /* 하니스 손잡이 — tools/check-pages.mjs 가 배포되는 이 코드 그대로를 돌려
       날짜 계산을 검사한다. 브라우저 동작에는 쓰이지 않는다. */
    window.DDAY = {
        lang: LANG, t: T,
        epochDay: epochDay, todayIso: todayIso, human: human, shortHuman: shortHuman,
        flag: flag, classify: classify, classifyBreaks: classifyBreaks,
        verdictOf: verdictOf, detect: detect, searchKey: searchKey
    };

    /* 하늘 페이지가 첫 화면·국가 페이지와 다른 갈래라는 사실을 검사기가 알아야 한다 */
    window.DDAY.isSky = !!document.body.getAttribute('data-sky');
    /* 이름 축·순위도 마찬가지다 — 국가 페이지가 아니면서 표를 이고 있다 */
    window.DDAY.list = document.body.getAttribute('data-list') || null;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start);
    } else {
        start();
    }
})();
