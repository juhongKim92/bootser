/* ============================================================
   this is the day — 클라이언트
   ------------------------------------------------------------
   서버가 없으므로 "오늘" 은 여기서만 정해진다. 정적 HTML 에는 날짜와 이름까지만
   들어 있고, D-day · 오늘 여부 · 지나감 표시는 전부 이 파일이 붙인다.
   그래서 페이지를 몇 달 전에 배포해 두어도 표시가 낡지 않는다.

   한국어와 영어가 같은 파일을 쓴다. 갈림길은 <html lang> 하나이고, 말은 아래
   STR 표에 모아 두었다 — 페이지마다 사전을 인라인하면 한쪽만 고쳐지는 일이 생긴다.

   국가 페이지는 공휴일 표를 다시 안 받는다 — 이미 HTML 안에
   <tr data-d="2026-10-03"> 로 들어 있어서 DOM 만 읽으면 된다.
   fetch 는 두 곳에만 쓴다.
     · 국가 선택기 목록 (countries.json) — 204개 <li> 를 410개 페이지에 인라인하면
       HTML 만 7MB 가 된다. 첫 화면의 국가 목록만 HTML 에 박고 선택기는 여기서 채운다.
     · 첫 화면의 "내 국가" 요약 카드
     · 첫 화면의 "오늘 공휴일인 나라" — 이번 달 색인 하나 (data/month/YYYY-MM.json)
   ============================================================ */
(function () {
    'use strict';

    var STORE = 'dday.country';

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
            noHoliday: '오늘은 공휴일이 아닙니다',
            off: ' — 오늘 쉽니다',
            partial: ' — 일부 지역만 쉽니다',
            outOfRange: '담긴 자료 범위 밖입니다',
            allOf: function (name) { return name + ' 공휴일 전체 보기 →'; },
            dtAll: '전체',
            dtNext: '다음',
            dtPrev: '지난',
            loadFail: '국가 목록을 불러오지 못했습니다.',
            todayCapN: function (n) { return '전 세계 · ' + n + '곳'; },
            todayNone: '오늘은 어느 나라도 공휴일이 아닙니다.',
            todayFail: '오늘 공휴일인 나라를 불러오지 못했습니다.',
            todayOut: '담긴 자료 범위 밖의 날짜입니다.',
            regionOnly: function (n) { return '일부 지역 ' + n + '곳'; },
            name: function (c) { return c.ko || c.name; },
            holiday: function (h) { return h.n; },
            holidaySub: function (h) { return h.e || ''; },
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
            noHoliday: 'Today is not a public holiday',
            off: ' — a day off today',
            partial: ' — observed only in some regions',
            outOfRange: 'Outside the range of the data',
            allOf: function (name) { return 'All ' + name + ' holidays →'; },
            dtAll: 'All',
            dtNext: 'Next',
            dtPrev: 'Last',
            loadFail: 'Could not load the country list.',
            todayCapN: function (n) { return 'Around the world · ' + n; },
            todayNone: 'No country has a public holiday today.',
            todayFail: 'Could not load today’s holidays.',
            todayOut: 'That date is outside the range of the data.',
            regionOnly: function (n) { return n + ' regions'; },
            name: function (c) { return c.name || c.ko; },
            holiday: function (h) { return h.e || h.n; },
            holidaySub: function (h) { return h.e ? h.n : ''; },
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

    /* ------------------------------------------------------------ 표 채우기 */
    function paintTables(today) {
        var rows = $$('tr[data-d]');
        var got = classify(rows.map(function (tr) {
            return { d: tr.getAttribute('data-d'), tr: tr, local: !!$('.local', tr) };
        }), today);

        got.marked.forEach(function (m) {
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

        return got;
    }

    /* 이름 칸에는 영어 이름과 지역 배지가 같이 들어 있다. 카드에는 이름만 옮긴다. */
    function nameOf(tr) {
        var el = $('.name', tr);
        if (!el) return '';
        var clone = el.cloneNode(true);
        $$('.en, .regions, .local', clone).forEach(function (x) { x.remove(); });
        return clone.textContent.trim();
    }

    /* --------------------------------------------------------- 오늘 카드 문안
       국가 페이지와 첫 화면이 같은 문장을 쓰도록 여기서만 만든다. */
    function verdictOf(todays, nameFn) {
        if (!todays.length) return { text: T.noHoliday, rest: false };
        var partial = todays.every(function (m) { return m.item.local; });
        return {
            text: todays.map(function (m) { return nameFn(m.item); }).join(' · ') +
                (partial ? T.partial : T.off),
            rest: !partial
        };
    }

    function paintNow(today, found) {
        var card = $('#now');
        if (!card) return;

        var asof = $('.asof', card);
        if (asof) asof.textContent = T.asof(human(today));

        var verdict = $('.verdict', card);
        if (verdict) {
            var v = verdictOf(found.todays, function (it) { return nameOf(it.tr); });
            verdict.textContent = v.text;
            verdict.className = 'verdict' + (v.rest ? ' rest' : '');
        }

        fill($('#next'), found.next, '-');
        fill($('#prev'), found.prev, '+');
    }
    function fill(dd, entry, sign) {
        if (!dd) return;
        dd.innerHTML = entry
            ? '<span class="dd">D' + sign + Math.abs(entry.diff) + '</span>' +
              esc(nameOf(entry.item.tr)) + '<em>' + shortHuman(entry.item.d) + '</em>'
            : '<em>' + T.outOfRange + '</em>';
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

        /* 고른 국가를 기억한다. 다음에 / 로 들어오면 이걸 먼저 쓴다. */
        list.addEventListener('click', function (e) {
            var a = e.target && e.target.closest ? e.target.closest('a[data-cc]') : null;
            if (a) remember(a.getAttribute('data-cc'));
        });
    }

    /* 한글 이름 · 영어 이름 · 코드 아무거나로 찾히게 한다 ("대한", "korea", "kr") */
    function searchKey(c) {
        return [c.ko, c.name, c.code].filter(Boolean).join(' ').toLowerCase();
    }

    function remember(cc) {
        try { localStorage.setItem(STORE, cc); } catch (_) { /* 사생활 보호 모드 */ }
    }
    function recall() {
        try { return localStorage.getItem(STORE); } catch (_) { return null; }
    }

    /* --------------------------------------------------------- 첫 화면(/) */
    /* 기억해 둔 국가 > 브라우저 지역 설정 순. 둘 다 없으면 카드를 접어 둔다. */
    function detect(known) {
        var saved = recall();
        if (saved && known.indexOf(saved) >= 0) return saved;

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
            return { d: day.d, n: (LANG === 'en' ? (day.e || day.n) : day.n), local: !!day.r };
        }), today);

        var v = verdictOf(got.todays, function (it) { return it.n; });

        var line = function (label, e, sign) {
            return '<dt>' + label + '</dt><dd>' + (e
                ? '<span class="dd">D' + sign + Math.abs(e.diff) + '</span>' + esc(e.item.n) +
                  '<em>' + shortHuman(e.item.d) + '</em>'
                : '<em>' + T.outOfRange + '</em>') + '</dd>';
        };

        var label = T.name(data);
        home.innerHTML =
            '<div class="asof">' + T.asof(human(today)) + '</div>' +
            '<div class="verdict' + (v.rest ? ' rest' : '') + '">' +
                flag(data.code) + ' ' + esc(label) + ' — ' + esc(v.text) + '</div>' +
            '<dl class="pair">' +
                line(T.dtNext, got.next, '-') +
                line(T.dtPrev, got.prev, '+') +
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
            remember(page);                           /* 직접 링크로 들어와도 기억한다 */
            var today = todayIso();
            paintNow(today, paintTables(today));
        }
        initHome();
    }

    /* 하니스 손잡이 — tools/check-pages.mjs 가 배포되는 이 코드 그대로를 돌려
       날짜 계산을 검사한다. 브라우저 동작에는 쓰이지 않는다. */
    window.DDAY = {
        lang: LANG, t: T,
        epochDay: epochDay, todayIso: todayIso, human: human, shortHuman: shortHuman,
        flag: flag, classify: classify, verdictOf: verdictOf, detect: detect,
        searchKey: searchKey
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start);
    } else {
        start();
    }
})();
