/* ============================================================
   페이지를 브라우저 없이 구동하는 하니스
   ------------------------------------------------------------
   `public/<slug>/index.html` 을 읽어 `/shared/*.js` 를 node:vm 컨텍스트에서
   실행한다. 그러면 배포되는 코드 그대로가 돌아가고, window.DDAY 손잡이로
   날짜 계산을 직접 흔들어 볼 수 있다.

   jsdom 을 쓰지 않는다. 이 사이트가 건드리는 브라우저 API 는 아래뿐이라
   (querySelector · querySelectorAll · classList · matchMedia · fetch · Intl.Locale)
   최소 스텁으로 충분하고, 저장소에 의존성을 늘리지 않는 게 낫다.

   localStorage 스텁은 지금 아무도 안 쓴다. 그래도 두는 이유는 "쓰지 않는다" 를
   검사할 수 있어야 하기 때문이다 — boot(page, { storage }) 로 값을 심어 두고
   그것이 화면을 바꾸지 못하는지 본다.

   DOM 스텁은 요소를 만들어 주기만 하고 HTML 을 파싱하지는 않는다 —
   그래서 querySelectorAll('tr[data-d]') 은 빈 배열이다. 표의 내용은
   check-pages.mjs 가 HTML 에서 직접 뽑아 DDAY.classify 에 먹여 검사한다.
   구동 검사와 계산 검사를 갈라 둔 것이지, 빠뜨린 게 아니다.
   ============================================================ */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createContext, runInContext } from 'node:vm';
import { PUB, DATA, BASE } from './config.mjs';

export { PUB, DATA };

/* kids: 셀렉터 → 자식 요소(들). 없는 셀렉터에는 null / [] 을 돌려준다 —
   진짜 querySelector 가 그렇게 동작하고, dday.js 는 그 null 로 갈림길을 고른다.
   (국가 페이지에 #home 이 없다는 사실이 첫 화면 코드를 건너뛰게 하는 조건이다) */
export function makeEl(tag = 'div', { attrs: init = {}, kids = {} } = {}) {
    const attrs = { ...init };
    const el = {
        tagName: String(tag).toUpperCase(),
        innerHTML: '', outerHTML: '', textContent: '', value: '',
        className: '', id: '', hidden: false,
        style: {}, dataset: {}, children: [], parentNode: null,
        classList: {
            _s: new Set(),
            add(...c) { c.forEach((x) => this._s.add(x)); },
            remove(...c) { c.forEach((x) => this._s.delete(x)); },
            toggle(c, on) {
                const has = this._s.has(c);
                if (on === undefined ? has : !on) this._s.delete(c); else this._s.add(c);
            },
            contains(c) { return this._s.has(c); },
        },
        setAttribute(k, v) { attrs[k] = String(v); },
        getAttribute(k) { return k in attrs ? attrs[k] : null; },
        removeAttribute(k) { delete attrs[k]; },
        hasAttribute(k) { return k in attrs; },
        appendChild(c) { this.children.push(c); if (c) c.parentNode = this; return c; },
        removeChild(c) { this.children = this.children.filter((x) => x !== c); return c; },
        remove() { },
        /* contact.js 가 조립한 <a> 로 자기를 갈아 끼운다. 스텁은 트리가 없으니
           바꿔치기 대신 결과를 붙들어 둔다 — check-pages 가 그걸 읽는다. */
        replaceWith(node) { this.replacedBy = node; },
        cloneNode() {
            const c = makeEl(tag, { attrs, kids });
            c.textContent = this.textContent;
            c.innerHTML = this.innerHTML;
            c.className = this.className;
            return c;
        },
        contains() { return false; },
        closest() { return null; },
        addEventListener() { }, removeEventListener() { }, dispatchEvent() { return true; },
        focus() { }, blur() { }, scrollIntoView() { },
        querySelector(sel) {
            const k = kids[sel];
            return Array.isArray(k) ? (k[0] || null) : (k || null);
        },
        querySelectorAll(sel) {
            const k = kids[sel];
            return Array.isArray(k) ? k : (k ? [k] : []);
        },
    };
    return el;
}

/* 같은 셀렉터는 같은 객체를 돌려준다 — 그래야 렌더 결과를 다시 읽을 수 있다.
   #picker 만은 안쪽 구조까지 미리 엮어 둔다. 선택기는 input · ul · .none 을 찾아
   서로 다른 갈림길로 가는데, 아무거나 돌려주면 그 갈림길이 사라진다. */
function makeDoc(bodyAttrs, { rows, breaks, ids, lang, contacts }) {
    const cache = new Map();
    const body = makeEl('body', { attrs: bodyAttrs });
    /* <html lang> 은 dday.js 가 말을 고르는 유일한 근거다. 안 옮기면 영어 페이지가
       한국어로 그려지는데, 브라우저에서는 멀쩡하니 하니스만 틀리게 된다. */
    const root = makeEl('html', { attrs: { lang } });
    root.lang = lang;

    /* 선택기 <ul> 은 배포되는 HTML 에서도 비어 있다 — dday.js 가 채운다.
       비어 있다는 사실 자체가 그 코드가 도는 조건이라 그대로 둔다. */
    const pickerList = makeEl('ul', { kids: { li: [] } });
    cache.set('#picker', makeEl('details', {
        kids: {
            input: makeEl('input'),
            ul: pickerList,
            '.none': makeEl('div'),
            'a[aria-current="true"]': null,
        },
    }));
    cache.set('#now', makeEl('div', {
        kids: { '.asof': makeEl('div'), '.verdict': makeEl('div') },
    }));

    const doc = {
        readyState: 'complete',
        documentElement: root, head: makeEl('head'), body,
        /* HTML 에 없는 id 는 null 이다 — 국가 페이지에 #home 이 없다는 사실이
           dday.js 의 갈림길이라, 아무거나 돌려주면 첫 화면 코드가 엉뚱하게 돈다 */
        querySelector(sel) {
            if (cache.has(sel)) return cache.get(sel);
            const id = /^#([A-Za-z][\w-]*)$/.exec(sel);
            if (id && !ids.has(id[1])) return null;
            cache.set(sel, makeEl());
            return cache.get(sel);
        },
        querySelectorAll(sel) {
            if (sel === 'tr[data-d]') return rows;
            if (sel === 'tr[data-s]') return breaks;
            if (sel === '[data-contact]') return contacts;
            /* 선택기 항목은 dday.js 가 innerHTML 로 넣는다. 스텁은 트리를 만들지
               않으니 여기서 되읽을 수 없고, 채워진 결과는 check-pages.mjs 가
               pickerList.innerHTML 로 본다. */
            return [];
        },
        getElementById(id) { return doc.querySelector('#' + id); },
        createElement: (t) => makeEl(t),
        createTextNode(t) { const e = makeEl('#text'); e.textContent = String(t); return e; },
        addEventListener() { }, removeEventListener() { },
        cache, pickerList, rows, breaks, contacts,
    };
    return doc;
}

const unesc = (s) => s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&amp;/g, '&');

/* 공휴일 표의 행. gen-pages.mjs 가 찍는 모양이 정해져 있어 좁은 정규식으로 충분하다.
   주의 — .name 의 textContent 는 영어 이름·지역 배지를 **미리 떼어 낸** 값이다.
   진짜 브라우저에서는 dday.js 의 nameOf() 가 그 일을 하지만 스텁은 DOM 트리를
   만들지 않는다. 그래서 nameOf() 의 떼어 내는 동작 자체는 여기서 검사되지 않고,
   그 조각들이 HTML 에 제대로 있는지는 check-pages.mjs 가 따로 본다. */
function parseRows(html) {
    const rows = [];
    for (const m of html.matchAll(/<tr data-d="(\d{4}-\d{2}-\d{2})">([\s\S]*?)<\/tr>/g)) {
        const cell = (m[2].match(/<td class="name">([\s\S]*?)<\/td>/) || [])[1] || '';
        const clean = unesc(cell
            .replace(/<span class="(en|local|regions)"[^>]*>[\s\S]*?<\/span>/g, '')
            .replace(/<[^>]+>/g, '')).trim();

        const name = makeEl('td');
        name.textContent = clean;

        /* 다른 언어로 적힌 이름. 카드가 이걸 가져다 쓰므로 스텁에도 있어야 한다. */
        const subText = (m[2].match(/<span class="en">([\s\S]*?)<\/span>/) || [])[1];
        let sub = null;
        if (subText !== undefined) { sub = makeEl('span'); sub.textContent = unesc(subText).trim(); }

        rows.push(makeEl('tr', {
            attrs: { 'data-d': m[1] },
            kids: {
                '.mark': makeEl('td'),
                '.name': name,
                '.en': sub,
                '.local': /class="local"/.test(m[2]) ? makeEl('span') : null,
            },
        }));
    }
    return rows;
}

/* 황금연휴 표의 행. 공휴일 행과 달리 날짜가 둘이라(시작·끝) 따로 뽑는다.
   내용 칸은 dday.js 가 읽지 않으므로 .mark 만 있으면 된다 — 거기에 붙는
   D-day 를 check-pages 가 되읽는다. */
function parseBreaks(html) {
    const rows = [];
    const re = /<tr data-s="(\d{4}-\d{2}-\d{2})" data-e="(\d{4}-\d{2}-\d{2})">/g;
    for (const m of html.matchAll(re)) {
        rows.push(makeEl('tr', {
            attrs: { 'data-s': m[1], 'data-e': m[2] },
            kids: { '.mark': makeEl('td') },
        }));
    }
    return rows;
}

/* 연락처 조각. HTML 에는 뒤집힌 두 토막만 있고 완성된 주소가 없다 —
   contact.js 가 합치는 결과가 맞는지 보려면 스텁에도 그 두 토막이 있어야 한다. */
function parseContacts(html) {
    const out = [];
    for (const m of html.matchAll(/<span data-contact data-u="([^"]*)" data-d="([^"]*)"/g)) {
        out.push(makeEl('span', { attrs: { 'data-u': m[1], 'data-d': m[2] } }));
    }
    return out;
}

const memStore = (seed = {}) => {
    const m = new Map(Object.entries(seed));
    return {
        getItem: (k) => (m.has(k) ? m.get(k) : null),
        setItem: (k, v) => m.set(k, String(v)),
        removeItem: (k) => m.delete(k), clear: () => m.clear(), key: () => null, length: 0,
        /* 검사용 — 무엇이 담겼는지 들여다본다. 진짜 Storage 에는 없는 것이라
           이름 앞에 밑줄을 둔다. */
        _dump: () => Object.fromEntries(m),
    };
};

/* fetch 는 실제로 배포될 public/ 을 읽는다. 네트워크를 타지 않으면서도
   경로가 틀리면 (예: /data/kr.json 처럼 소문자로 적으면) 여기서 잡힌다. */
function makeFetch(seen) {
    return async function fetchStub(url) {
        seen.push(url);
        const path = String(url).replace(/^https?:\/\/[^/]+/, '');
        const file = join(PUB, path.replace(/^\//, ''));
        if (!existsSync(file) || statSync(file).isDirectory()) {
            return { ok: false, status: 404, json: async () => { throw new Error('404'); } };
        }
        const text = readFileSync(file, 'utf8');
        return { ok: true, status: 200, text: async () => text, json: async () => JSON.parse(text) };
    };
}

/** 페이지 하나를 구동한다. page 는 '' (첫 화면) 또는 'kr' 같은 슬러그. */
export function boot(page, { languages = ['ko-KR'], storage = {} } = {}) {
    const file = join(PUB, page, 'index.html');
    if (!existsSync(file)) throw new Error(`없는 페이지: ${page}`);
    const html = readFileSync(file, 'utf8');

    /* <body data-cc="KR"> 을 스텁 body 에 옮겨 준다 — 국가 페이지 판정에 쓰인다 */
    const bodyTag = (html.match(/<body\b([^>]*)>/i) || ['', ''])[1];
    const bodyAttrs = {};
    for (const m of bodyTag.matchAll(/([a-z-]+)="([^"]*)"/gi)) bodyAttrs[m[1]] = m[2];

    const doc = makeDoc(bodyAttrs, {
        rows: parseRows(html),
        breaks: parseBreaks(html),
        ids: new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1])),
        lang: (html.match(/<html lang="([a-z]{2})">/) || [])[1] || 'ko',
        contacts: parseContacts(html),
    });
    const fetched = [];
    const win = {};
    Object.assign(win, {
        window: win, self: win, document: doc,
        navigator: { userAgent: 'node', language: languages[0], languages },
        location: {
            href: `${BASE}/${page ? page + '/' : ''}`,
            pathname: '/' + (page ? page + '/' : ''),
        },
        localStorage: memStore(storage), sessionStorage: memStore(),
        setTimeout: () => 1, clearTimeout() { },
        matchMedia: (q) => ({
            matches: false, media: q, addEventListener() { }, removeEventListener() { },
        }),
        fetch: makeFetch(fetched),
        Intl, Promise, JSON, Math, Date, String, Number, Array, Object, RegExp, Error,
        console,
    });
    createContext(win);

    const errors = [], srcs = [];
    const isJs = (t) => !t || /^(text\/javascript|application\/javascript|module)$/i.test(t.trim());

    for (const tag of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
        const type = (tag[1].match(/\btype="([^"]*)"/) || [])[1];
        if (!isJs(type)) continue;
        const src = (tag[1].match(/\bsrc="([^"]+)"/) || [])[1];
        let code = tag[2];
        if (src) {
            if (!src.startsWith('/')) continue;                /* 외부 CDN 은 건너뛴다 */
            const f = join(PUB, src.replace(/^\//, ''));
            if (!existsSync(f)) { errors.push(`없는 스크립트: ${src}`); continue; }
            srcs.push(src);
            code = readFileSync(f, 'utf8');
        }
        try { runInContext(code, win, { filename: src || 'inline' }); }
        catch (e) { errors.push(`${src || 'inline'} — ${e.message}`); }
    }

    return { html, doc, win, errors, srcs, fetched, dday: win.DDAY };
}

/** public 아래 index.html 을 가진 슬러그 목록. '' 는 첫 화면. */
export function pages() {
    const out = [];
    const walk = (dir) => {
        for (const name of readdirSync(dir)) {
            const p = join(dir, name);
            if (statSync(p).isDirectory()) walk(p);
            else if (name === 'index.html') {
                out.push(relative(PUB, dir).split('\\').join('/'));
            }
        }
    };
    walk(PUB);
    return out.sort((a, b) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b)));
}
