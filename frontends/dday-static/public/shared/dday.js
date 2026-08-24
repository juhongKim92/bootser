/* ============================================================
   오늘 뭐 쉬나 — 클라이언트
   ------------------------------------------------------------
   서버가 없으므로 "오늘" 은 여기서만 정해진다. 정적 HTML 에는 날짜와 이름까지만
   들어 있고, D-day · 오늘 여부 · 지나감 표시는 전부 이 파일이 붙인다.
   그래서 페이지를 몇 달 전에 배포해 두어도 표시가 낡지 않는다.

   국가 페이지는 공휴일 표를 다시 안 받는다 — 이미 HTML 안에
   <tr data-d="2026-10-03"> 로 들어 있어서 DOM 만 읽으면 된다.
   fetch 는 두 곳에만 쓴다.
     · 국가 선택기 목록 — 204개 <li> 를 204개 페이지에 인라인하면 HTML 이 3.7MB 가
       된다. 첫 화면(/)에만 인라인하고 국가 페이지에서는 countries.json 으로 채운다.
     · 첫 화면의 "내 국가" 요약 카드
   ============================================================ */
(function () {
    'use strict';

    var DOW = ['일', '월', '화', '수', '목', '금', '토'];
    var STORE = 'dday.country';

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
        var p = parts(iso);
        return p.y + '년 ' + p.m + '월 ' + p.d + '일 (' + DOW[dow(iso)] + ')';
    }
    function shortHuman(iso) {
        var p = parts(iso);
        return p.m + '월 ' + p.d + '일 (' + DOW[dow(iso)] + ')';
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
       첫 화면은 HTML 에 이미 박혀 있고, 국가 페이지는 받아 온다.
       어느 쪽이든 같은 약속을 돌려주므로 부르는 쪽은 구분하지 않는다. */
    var listCache = null;
    function countries() {
        if (listCache) return listCache;

        var inline = $$('#picker li[data-cc]');
        if (inline.length) {
            listCache = Promise.resolve(inline.map(function (li) {
                return {
                    code: li.getAttribute('data-cc'),
                    ko: li.getAttribute('data-ko') || '',
                    name: li.getAttribute('data-en') || ''
                };
            }));
        } else {
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
                if (mark) mark.innerHTML = '<span class="now">오늘</span>';
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
        if (!todays.length) return { text: '오늘은 공휴일이 아닙니다', rest: false };
        var partial = todays.every(function (m) { return m.item.local; });
        return {
            text: todays.map(function (m) { return nameFn(m.item); }).join(' · ') +
                (partial ? ' — 일부 지역만 쉽니다' : ' — 오늘 쉽니다'),
            rest: !partial
        };
    }

    function paintNow(today, found) {
        var card = $('#now');
        if (!card) return;

        var asof = $('.asof', card);
        if (asof) asof.textContent = '기준 ' + human(today) + ' · 내 기기 시간';

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
            : '<em>담긴 자료 범위 밖입니다</em>';
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

        function wire() {
            items = $$('li', list).map(function (li) {
                return { li: li, key: (li.getAttribute('data-key') || '').toLowerCase() };
            });
            apply();
        }
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

        if ($('li', list)) {
            wire();                                   /* 첫 화면 — 이미 박혀 있다 */
        } else {
            countries().then(function (all) {
                list.innerHTML = all.map(function (c) {
                    var cur = c.code === here;
                    return '<li data-cc="' + c.code + '" data-key="' +
                        esc(searchKey(c)) + '">' +
                        '<a href="/' + c.code.toLowerCase() + '/" data-cc="' + c.code + '"' +
                        (cur ? ' aria-current="true"' : '') + '>' +
                        '<span class="flag">' + flag(c.code) + '</span>' + esc(c.ko) +
                        '<span class="cc">' + c.code + '</span></a></li>';
                }).join('');
                wire();
            }).catch(function () {
                list.innerHTML = '';
                if (none) { none.hidden = false; none.textContent = '국가 목록을 불러오지 못했습니다.'; }
            });
        }

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
            return { d: day.d, n: day.n, local: !!day.r };
        }), today);

        var v = verdictOf(got.todays, function (it) { return it.n; });

        var line = function (label, e, sign) {
            return '<dt>' + label + '</dt><dd>' + (e
                ? '<span class="dd">D' + sign + Math.abs(e.diff) + '</span>' + esc(e.item.n) +
                  '<em>' + shortHuman(e.item.d) + '</em>'
                : '<em>담긴 자료 범위 밖입니다</em>') + '</dd>';
        };

        home.innerHTML =
            '<div class="asof">기준 ' + human(today) + ' · 내 기기 시간</div>' +
            '<div class="verdict' + (v.rest ? ' rest' : '') + '">' +
                flag(data.code) + ' ' + esc(data.ko) + ' — ' + esc(v.text) + '</div>' +
            '<dl class="pair">' +
                line('다음', got.next, '-') +
                line('지난', got.prev, '+') +
                '<dt>전체</dt><dd><a href="/' + data.code.toLowerCase() + '/">' +
                    esc(data.ko) + ' 공휴일 전체 보기 →</a></dd>' +
            '</dl>';
        home.hidden = false;
    }

    /* ---------------------------------------------------------------- 시동 */
    function start() {
        initPicker();

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
