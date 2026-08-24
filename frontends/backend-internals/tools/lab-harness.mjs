/* ============================================================
   실험대를 브라우저 없이 구동하는 하니스
   ------------------------------------------------------------
   `public/<slug>/index.html` 을 읽어 인라인 <script>(여기에 LAB_I18N 이 있다)와
   `/shared/*.js` 를 node:vm 컨텍스트에서 실행한다. 그러면 배포되는 코드 그대로가
   돌아가고, 렌더 결과를 DOM 스텁에서 읽어낼 수 있다.

   jsdom 을 쓰지 않는다. 실험대가 건드리는 브라우저 API 는 아래뿐이라
   (querySelector · querySelectorAll · getElementById · setInterval ·
    requestAnimationFrame · matchMedia · canvas 2d · classList · localStorage)
   최소 스텁으로 충분하고, 저장소에 의존성을 늘리지 않는 게 낫다.

   검사 범위 — 모델의 수치와 렌더된 문자열이다. 레이아웃은 없고
   (getBoundingClientRect 가 고정값) 캔버스도 no-op 이다. 픽셀은 대상이 아니니
   깨지면 안 되는 것은 문자열로 판정할 수 있는 형태로 옮겨 담는다.
   ============================================================ */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createContext, runInContext } from 'node:vm';

const HERE = dirname(fileURLToPath(import.meta.url));
export const PUB = join(HERE, '..', 'public');

/* --- 캔버스 2D 컨텍스트 — 전부 no-op. 해시링·Raft 가 canvas 를 쓴다 --- */
const ctx2d = () => new Proxy({ canvas: { width: 900, height: 320 } }, {
    get(t, k) {
        if (k in t) return t[k];
        if (k === 'measureText') return () => ({ width: 8 });
        if (k === 'getImageData') return () => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 });
        if (/^create(Linear|Radial)Gradient|createPattern$/.test(String(k))) return () => ({ addColorStop() { } });
        return () => { };
    },
    set(t, k, v) { t[k] = v; return true; }
});

export function makeEl(tag = 'div') {
    const attrs = {};
    return {
        tagName: String(tag).toUpperCase(),
        innerHTML: '', outerHTML: '', textContent: '', innerText: '', value: '',
        className: '', id: '', disabled: false, checked: false, hidden: false,
        style: {}, dataset: {}, children: [], childNodes: [], parentNode: null,
        width: 900, height: 320, offsetWidth: 900, offsetHeight: 320,
        clientWidth: 900, clientHeight: 320, scrollTop: 0, scrollHeight: 320,
        classList: {
            _s: new Set(),
            add(...c) { c.forEach(x => this._s.add(x)); },
            remove(...c) { c.forEach(x => this._s.delete(x)); },
            toggle(c, on) {
                const has = this._s.has(c);
                if (on === undefined ? has : !on) this._s.delete(c); else this._s.add(c);
            },
            contains(c) { return this._s.has(c); }
        },
        setAttribute(k, v) { attrs[k] = String(v); },
        getAttribute(k) { return k in attrs ? attrs[k] : null; },
        removeAttribute(k) { delete attrs[k]; },
        hasAttribute(k) { return k in attrs; },
        appendChild(c) { this.children.push(c); this.childNodes.push(c); if (c) c.parentNode = this; return c; },
        insertBefore(c) { return this.appendChild(c); },
        removeChild(c) { this.children = this.children.filter(x => x !== c); return c; },
        replaceChildren() { this.children = []; this.childNodes = []; },
        remove() { },
        addEventListener() { }, removeEventListener() { }, dispatchEvent() { return true; },
        focus() { }, blur() { }, scrollIntoView() { },
        click() { if (typeof this.onclick === 'function') this.onclick({ target: this }); },
        getBoundingClientRect: () => ({ x: 0, y: 0, top: 0, left: 0, right: 900, bottom: 320, width: 900, height: 320 }),
        querySelector: () => makeEl(),
        querySelectorAll: () => [],
        closest: () => null,
        getContext: () => ctx2d()
    };
}

/* 같은 셀렉터는 같은 객체를 돌려준다 — 그래야 렌더 결과를 다시 읽을 수 있다 */
function makeDoc() {
    const cache = new Map();
    const doc = {
        hidden: false, readyState: 'complete',
        documentElement: makeEl('html'), head: makeEl('head'), body: makeEl('body'),
        querySelector(sel) { if (!cache.has(sel)) cache.set(sel, makeEl()); return cache.get(sel); },
        querySelectorAll: () => [],
        getElementById(id) { return doc.querySelector('#' + id); },
        createElement: t => makeEl(t),
        createElementNS: (_, t) => makeEl(t),
        createTextNode(t) { const e = makeEl('#text'); e.textContent = String(t); return e; },
        createDocumentFragment: () => makeEl('#fragment'),
        addEventListener() { }, removeEventListener() { },
        cache
    };
    return doc;
}

const memStore = () => {
    const m = new Map();
    return {
        getItem: k => (m.has(k) ? m.get(k) : null),
        setItem: (k, v) => m.set(k, String(v)),
        removeItem: k => m.delete(k), clear: () => m.clear(), key: () => null, length: 0
    };
};

/* 스크립트는 반드시 **문서 순서대로** 실행한다.
   17편은 LAB_I18N 인라인 블록이 <script src> 앞에 있지만, gc·mvcc 는 거꾸로
   (실험대를 먼저 싣고 인라인에서 initGcLab(...) 을 호출한다). 순서를 뒤집으면
   "initGcLab is not defined" 로 헛되게 실패한다. */
/* source 를 주면 파일 대신 그 HTML 로 돌린다. gen-prerender 가 "구운 것을 걷어낸
   상태" 를 디스크에 쓰지 않고 돌려 보려고 쓴다 — 도중에 죽어도 파일이 안 망가진다. */
export function boot(page, { source } = {}) {
    const file = join(PUB, page, 'index.html');
    if (source === undefined && !existsSync(file)) throw new Error(`없는 페이지: ${page}`);
    const html = source === undefined ? readFileSync(file, 'utf8') : source;
    const doc = makeDoc();

    const win = {};
    Object.assign(win, {
        window: win, self: win, document: doc,
        devicePixelRatio: 1, innerWidth: 1200, innerHeight: 900,
        navigator: { userAgent: 'node', language: 'ko' },
        location: { href: 'https://lab.vermilion19.com/' + (page ? page + '/' : ''), pathname: '/' + (page ? page + '/' : '') },
        localStorage: memStore(), sessionStorage: memStore(),
        setInterval: () => 1, clearInterval() { }, setTimeout: () => 1, clearTimeout() { },
        requestAnimationFrame: () => 1, cancelAnimationFrame() { },
        matchMedia: q => ({ matches: false, media: q, onchange: null, addEventListener() { }, removeEventListener() { }, addListener() { }, removeListener() { } }),
        performance: { now: () => 0 },
        addEventListener() { }, removeEventListener() { },
        getComputedStyle: () => ({ getPropertyValue: () => '' }),
        console
    });
    createContext(win);

    const errors = [], srcs = [];
    /* 실행할 것은 자바스크립트뿐이다. application/ld+json 같은 데이터 블록은 건너뛴다 */
    const isJs = t => !t || /^(text\/javascript|application\/javascript|module)$/i.test(t.trim());
    for (const [i, tag] of [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].entries()) {
        const type = (tag[1].match(/\btype="([^"]*)"/) || [])[1];
        if (!isJs(type)) continue;
        const src = (tag[1].match(/\bsrc="([^"]+)"/) || [])[1];
        if (src) {
            if (!src.startsWith('/')) continue;                  // 외부 CDN 은 건너뛴다
            srcs.push(src);
            const p = join(PUB, src.replace(/^\//, ''));
            if (!existsSync(p)) { errors.push(`없는 스크립트: ${src}`); continue; }
            try { runInContext(readFileSync(p, 'utf8'), win, { filename: src }); }
            catch (e) { errors.push(`${src}: ${e.message}`); }
        } else {
            try { runInContext(tag[2], win, { filename: `${page}/inline[${i}]` }); }
            catch (e) { errors.push(`인라인 스크립트[${i}]: ${e.message}`); }
        }
    }

    return { win, doc, html, page, errors, srcs, i18n: win.LAB_I18N, lab: win.LAB };
}

/* 렌더된 문자열에 치환 사고가 남아 있는지 훑는다.
   빠진 i18n 키는 undefined 로, 인자 부족은 $1 로 남는다. */
const BAD = ['undefined', 'NaN', '$1', '$2', '$3', '[object Object]'];
export function scan(doc, where = '') {
    const out = [];
    for (const [sel, el] of doc.cache) {
        const s = String(el.innerHTML || '') + '\u0000' + String(el.textContent || '');
        for (const pat of BAD) {
            if (s.includes(pat)) out.push(`${where}${where ? ' ' : ''}${sel} → "${pat}" 남음: ${s.replace(/\u0000/g, ' ').slice(0, 150)}`);
        }
    }
    return out;
}

/* `public` 아래 index.html 을 가진 경로를 모은다. '' 와 'en' 은 목록 페이지다. */
export function pages() {
    const out = [];
    const walk = (rel) => {
        const dir = join(PUB, rel);
        if (existsSync(join(dir, 'index.html'))) out.push(rel.split('\\').join('/'));
        for (const name of readdirSync(dir)) {
            const p = join(dir, name);
            if (statSync(p).isDirectory() && name !== 'shared') walk(join(rel, name));
        }
    };
    walk('');
    return out;
}

/* 실험대가 `window.LAB` 을 노출하면 손잡이 조합을 바꿔가며 수치를 읽을 수 있다.
   17편(timeout)이 그 첫 예다. 새 실험대에도 같은 훅을 넣어두면 여기서 바로 쓴다. */
export function probe(lab, cfg) {
    if (!lab || typeof lab.set !== 'function') throw new Error('이 실험대에는 window.LAB 훅이 없다');
    return lab.set(cfg).exact();
}
