/* ============================================================
   첫 화면 오른쪽 여백에서 도는 지구본. 나라를 고르는 또 하나의 손잡이다.

   왜 라이브러리가 없나 — 정사영(orthographic) 투영은 세 줄이고 역투영도 그만큼이다.
   클릭 판정은 역투영해서 가장 가까운 점을 찾는 것이라 색 버퍼도 레이캐스팅도
   필요 없다. 이 저장소가 태양 위치를 172항으로 계산하는데 지구본에 600KB 를
   받아 올 이유가 없다.

   왜 점이고 국경이 아닌가 — tools/gen-globe.mjs 의 머리말에 적었다.
   줄이면, 204개국에 소국이 많아서 국경으로 칠하면 몰타를 못 고른다.

   나라 이름과 주소는 자료로 받지 않는다. 첫 화면에 이미 204개 링크가
   li[data-cc] 로 깔려 있으므로 그것을 읽는다 — 늘어나는 바이트가 0 이고,
   목록에서 빠진 나라가 지구본에도 저절로 없다.

   보조기술에는 이 캔버스를 감춘다(aria-hidden). 같은 링크가 아래 목록에 그대로
   있으므로, 닿지 못하는 위젯을 나란히 만드는 것보다 그게 맞다.

   좁은 화면에서는 자료조차 받지 않는다. CSS 로 감추기만 하면 받고 안 보이는
   상태가 되므로 게이트를 여기 둔다(SHOW). 지구본이 담은 것이 아래 목록과 완전히
   겹치므로 감춰도 잃는 것이 없다.

   ============================================================ */
'use strict';

(function () {

    /* ----------------------------------------------------------- 순수 계산

       하니스는 캔버스를 못 본다. 그래서 계산을 전부 이 칸에 두고 window.GLOBE 로
       내보낸다 — check-pages 가 그리기를 거치지 않고 이 함수들을 직접 때린다.
       아래 「화면」 칸은 얇은 껍데기여야 한다. */

    var RAD = Math.PI / 180;

    /**
     * 정사영. 단위구 위의 (lon, lat) 을 보는 방향 (l0, p0) 기준 평면으로 옮긴다.
     * z > 0 이 앞면이고 뒷면은 그리지 않는다.
     * y 는 위쪽이 양수다 — 캔버스는 아래가 양수라 그릴 때 뒤집는다.
     */
    function project(lon, lat, l0, p0) {
        var dl = (lon - l0) * RAD, p = lat * RAD, q = p0 * RAD;
        var cp = Math.cos(p), sp = Math.sin(p);
        var cq = Math.cos(q), sq = Math.sin(q), cd = Math.cos(dl);
        return {
            x: cp * Math.sin(dl),
            y: cq * sp - sq * cp * cd,
            z: sq * sp + cq * cp * cd
        };
    }

    /** 역투영. 원판 밖(x²+y² > 1)이면 null 이다. */
    function unproject(x, y, l0, p0) {
        var r2 = x * x + y * y;
        if (r2 > 1) return null;
        var z = Math.sqrt(1 - r2), q = p0 * RAD;
        var cq = Math.cos(q), sq = Math.sin(q);
        return [
            l0 + Math.atan2(x, z * cq - y * sq) / RAD,
            Math.asin(z * sq + y * cq) / RAD
        ];
    }

    /**
     * 화면 좌표 (sx, sy) 의 grab 안에 드는 **앞면** 점 전부를 가까운 순으로.
     * pts 는 [code, lon, lat] 배열, 좌표는 원 중심 기준 픽셀이다.
     * r 은 확대가 반영된 반지름이다 — 확대는 이 값만 키우는 것이 전부다.
     */
    function tied(sx, sy, pts, l0, p0, r, grab) {
        var out = [], lim = grab * grab;
        for (var i = 0; i < pts.length; i++) {
            var v = project(pts[i][1], pts[i][2], l0, p0);
            if (v.z <= 0) continue;
            var dx = v.x * r - sx, dy = -v.y * r - sy;
            var d = dx * dx + dy * dy;
            if (d <= lim) out.push([i, d]);
        }
        out.sort(function (a, b) { return a[1] - b[1]; });
        return out.map(function (e) { return e[0]; });
    }

    /** 가장 가까운 앞면 점의 자리번호. 없으면 -1. */
    function pick(sx, sy, pts, l0, p0, r, grab) {
        var all = tied(sx, sy, pts, l0, p0, r, grab);
        return all.length ? all[0] : -1;
    }

    /* 회전하려고 끌었는데 손을 떼는 순간 점이 눌린 것으로 판정되는 일이 있었다.
       끌린 거리가 SLOP 을 넘으면 회전으로 본다. 거리만으로는 모자라다 —
       빈 자리를 누르고 점 위에서 놓아도 눌린 것이 되므로, 누른 곳과 놓은 곳이
       **같은 점**인 것까지 본다. */
    var SLOP = 6;

    /**
     * 놓은 자리를 「눌렀다」로 볼지. moved 는 누른 뒤 끌린 거리(픽셀),
     * from 은 누를 때 잡힌 자리번호, upAt 은 놓을 때 잡힌 자리번호다.
     */
    function clickable(moved, from, upAt) {
        return moved <= SLOP && from >= 0 && upAt === from;
    }

    /* 확대 범위. ×1 에서 소앤틸리스 18개국이 한 번에 겹치는데 ×8 이면 4개로
       줄고 그 뒤로는 평평해진다(AI·BL·MF·SX 는 서로 30km 안이라 어떤 배율로도
       갈라지지 않는다). 그래서 8 에서 멈춘다 — 더 키워도 얻는 것이 없고 해안선만
       거칠어진다. */
    var MAX_ZOOM = 8;

    /* 오늘 공휴일인 나라. **지구본이 자료를 또 받지 않는다** — 첫 화면의
       「오늘 공휴일인 나라」 절을 채우는 dday.js 가 이미 계산하므로 그것을
       넘겨받는다. 같은 규칙을 두 벌 두면 같은 날에 두 화면이 다른 말을 한다.

       화면 게이트 앞에 두는 것이 중요하다. 좁은 화면에서는 그리기가 아예 돌지
       않는데, mark() 는 그때도 불린다(dday.js 는 화면 폭을 모른다). */
    var holidays = null;

    /** 코드 목록을 받아 둔다. 몇 나라가 잡혔는지 돌려준다. */
    function mark(codes) {
        holidays = null;
        if (codes && codes.length) {
            holidays = {};
            for (var i = 0; i < codes.length; i++) holidays[codes[i]] = 1;
        }
        return holidays ? Object.keys(holidays).length : 0;
    }

    /** 받아 둔 코드. 검사기가 되읽는다. */
    function marked() {
        return holidays ? Object.keys(holidays).sort() : [];
    }

    /** 휠 한 번을 배율로. 범위를 벗어나지 않게 자른다. */
    function rezoom(zoom, deltaY) {
        var next = zoom * Math.exp(-deltaY * 0.0015);
        return Math.max(1, Math.min(MAX_ZOOM, next));
    }

    window.GLOBE = {
        project: project, unproject: unproject, pick: pick, tied: tied,
        clickable: clickable, SLOP: SLOP, rezoom: rezoom, MAX_ZOOM: MAX_ZOOM,
        mark: mark, marked: marked
    };

    /* --------------------------------------------------------------- 화면 */

    var SHOW = '(min-width: 1400px)';
    var SPIN = 5;                      /* 도/초 — 손을 대면 멈춘다 */
    var DOT = 2.6, GRAB = 11;

    var box = document.getElementById('globe');
    if (!box) return;
    if (!window.matchMedia || !window.matchMedia(SHOW).matches) return;

    var cv = box.querySelector('canvas');
    var out = box.querySelector('.globe-name');
    if (!cv || !cv.getContext || !out) return;

    /* 이름과 주소는 첫 화면의 국가 목록에서 읽는다 */
    var meta = {};
    Array.prototype.forEach.call(
        document.querySelectorAll('#countries li[data-cc]'),
        function (li) {
            var a = li.querySelector('a'), n = li.querySelector('.cn');
            if (a && n) {
                meta[li.getAttribute('data-cc')] = {
                    href: a.getAttribute('href'), name: n.textContent
                };
            }
        }
    );

    var ctx = cv.getContext('2d');
    var pts = null, land = null, l0 = 127, p0 = 18, r = 0, cx = 0, cy = 0;
    var hot = -1, held = false, spinning = true, last = 0;
    var moved = 0, downAt = -1, zoom = 1;

    /* 확대는 반지름만 키운다. 원판(구멍)은 r 로 그대로 두고 안쪽만 커지므로
       배율을 올리면 창문 크기는 같은 채 내용이 확대된다. */
    function R() { return r * zoom; }

    var root = document.documentElement;
    function ink(name) {
        return getComputedStyle(root).getPropertyValue(name).trim() || '#888';
    }

    function size() {
        var dpr = window.devicePixelRatio || 1;
        var w = box.clientWidth;
        cv.width = Math.round(w * dpr);
        cv.height = Math.round(w * dpr);
        cv.style.height = w + 'px';
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        cx = w / 2; cy = w / 2; r = w / 2 - DOT - 2;
    }

    /** 한 줄을 앞면 토막만 이어 그린다. 뒷면에서 끊고 다시 시작한다. */
    function arc(step, make) {
        ctx.beginPath();
        var on = false;
        for (var t = step[0]; t <= step[1]; t += step[2]) {
            var v = make(t);
            if (v.z <= 0) { on = false; continue; }
            var X = cx + v.x * R(), Y = cy - v.y * R();
            if (on) ctx.lineTo(X, Y); else { ctx.moveTo(X, Y); on = true; }
        }
        ctx.stroke();
    }

    /** 링 하나(펴 담은 [lon, lat, ...])를 앞면 토막만 이어 그린다. */
    function ring(flat) {
        ctx.beginPath();
        var on = false;
        for (var i = 0; i < flat.length; i += 2) {
            var v = project(flat[i], flat[i + 1], l0, p0);
            if (v.z <= 0) { on = false; continue; }
            var X = cx + v.x * R(), Y = cy - v.y * R();
            if (on) ctx.lineTo(X, Y); else { ctx.moveTo(X, Y); on = true; }
        }
        ctx.stroke();
    }

    /** 대륙 윤곽. 칠하지 않는다 — 까닭은 tools/gen-globe.mjs 에 적었다. */
    function coast() {
        if (!land) return;
        ctx.strokeStyle = ink('--ink-3');
        ctx.lineWidth = 1;
        ctx.globalAlpha = 0.45;
        for (var i = 0; i < land.length; i++) ring(land[i]);
        ctx.globalAlpha = 1;
    }

    /** 위선·경선 격자. 30도마다 한 줄이다. */
    function graticule() {
        ctx.strokeStyle = ink('--rule');
        ctx.lineWidth = 1;
        ctx.globalAlpha = 0.5;
        /* 확대하면 30도 격자가 화면 밖으로 다 나간다. 간격과 걸음을 같이 줄인다. */
        var gap = zoom >= 4 ? 10 : 30, step = zoom >= 4 ? 1 : 3, k;
        for (k = -180; k < 180; k += gap) {
            arc([-90, 90, step], (function (m) {
                return function (t) { return project(m, t, l0, p0); };
            })(k));
        }
        for (k = -80; k <= 80; k += gap) {
            arc([-180, 180, step], (function (m) {
                return function (t) { return project(t, m, l0, p0); };
            })(k));
        }
        ctx.globalAlpha = 1;
    }

    function draw() {
        ctx.clearRect(0, 0, cv.width, cv.height);
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.clip();
        graticule();
        coast();
        if (!pts) return;
        var dim = ink('--ink-3'), lit = ink('--ink'), red = ink('--today');
        for (var i = 0; i < pts.length; i++) {
            var v = project(pts[i][1], pts[i][2], l0, p0);
            if (v.z <= 0) continue;
            var big = i === hot;
            /* 오늘 쉬는 나라. 손이 얹힌 점은 크기로 알리고 색은 빨강을 지킨다 —
               가리키는 동안 「오늘 쉰다」는 사실이 사라지면 안 된다. */
            var off = !!(holidays && holidays[pts[i][0]]);
            ctx.beginPath();
            ctx.arc(cx + v.x * R(), cy - v.y * R(),
                big ? DOT + 2 : (off ? DOT + 0.8 : DOT), 0, Math.PI * 2);
            ctx.fillStyle = off ? red : (big ? lit : dim);
            /* 지평선 가까이를 연하게 한다 — 구로 보이게 하는 것은 이 한 줄이다 */
            ctx.globalAlpha = big ? 1 : 0.35 + 0.65 * v.z;
            ctx.fill();
        }
        ctx.globalAlpha = 1;
        ctx.restore();
        /* 창틀은 자르기 밖에서 긋는다 — 안에서 그으면 확대할 때 같이 커진다 */
        ctx.strokeStyle = ink('--rule');
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.stroke();
    }

    function frame(t) {
        if (spinning) {
            if (last) l0 = (l0 + SPIN * (t - last) / 1000 + 540) % 360 - 180;
            last = t;
        } else last = 0;
        draw();
        requestAnimationFrame(frame);
    }

    function at(e) {
        var b = cv.getBoundingClientRect();
        return [e.clientX - b.left - cx, e.clientY - b.top - cy];
    }

    function say(i) {
        if (hot === i) return;
        hot = i;
        var m = i < 0 || !pts ? null : meta[pts[i][0]];
        out.textContent = m ? m.name : '';
        cv.style.cursor = m ? 'pointer' : 'grab';
    }

    cv.addEventListener('pointerdown', function (e) {
        held = true;
        spinning = false;
        moved = 0;
        var p = at(e);
        downAt = pts ? pick(p[0], p[1], pts, l0, p0, R(), GRAB) : -1;
        if (cv.setPointerCapture) cv.setPointerCapture(e.pointerId);
    });

    cv.addEventListener('pointerup', function (e) {
        held = false;
        var from = downAt;
        downAt = -1;
        if (!pts) return;
        var p = at(e);
        if (!clickable(moved, from, pick(p[0], p[1], pts, l0, p0, R(), GRAB))) return;
        if (meta[pts[from][0]]) location.href = meta[pts[from][0]].href;
    });

    cv.addEventListener('pointermove', function (e) {
        if (held) {
            moved += Math.abs(e.movementX) + Math.abs(e.movementY);
            /* 확대하면 같은 픽셀이 더 좁은 각도에 해당한다. 나누지 않으면
               ×8 에서 손을 조금만 움직여도 지구가 달아난다. */
            var deg = 0.4 / zoom;
            l0 = (l0 - e.movementX * deg + 540) % 360 - 180;
            p0 = Math.max(-85, Math.min(85, p0 + e.movementY * deg));
            say(-1);
            return;
        }
        var p = at(e);
        say(pts ? pick(p[0], p[1], pts, l0, p0, R(), GRAB) : -1);
    });

    cv.addEventListener('wheel', function (e) {
        e.preventDefault();
        spinning = false;
        zoom = rezoom(zoom, e.deltaY);
        say(-1);
    }, { passive: false });

    /* 되돌리기. 확대해 놓고 길을 잃으면 여기가 유일한 출구다. */
    cv.addEventListener('dblclick', function () { zoom = 1; say(-1); });

    cv.addEventListener('pointerleave', function () { say(-1); });
    window.addEventListener('resize', size);

    size();
    requestAnimationFrame(frame);

    fetch('/data/globe.json').then(function (res) {
        return res.ok ? res.json() : null;
    }).then(function (d) {
        /* 목록에 없는 나라는 버린다 — 눌러도 갈 곳이 없다 */
        if (!d) return;
        if (d.p) pts = d.p.filter(function (p) { return meta[p[0]]; });
        if (d.l) land = d.l;
    }).catch(function () {
        /* 지구본은 덤이다. 못 받으면 격자만 돈다. */
    });

})();
