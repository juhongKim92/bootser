/* ============================================================
   "이어서 볼 것" 블록을 36개 페이지에 박는다 — 실행: node tools/gen-related.mjs
   ------------------------------------------------------------
   링크 맵은 `tools/related.mjs` 하나에 있고, 제목은 대상 페이지의 <h1> 에서 읽는다.
   블록은 주석 표식 사이에 들어가므로 **몇 번 돌려도 결과가 같다**(멱등).

   본문을 JS 로 주입하지 않는 것이 이 사이트의 규칙이라(색인 안 됨) HTML 에
   직접 써 넣는다. 그래서 링크 문구를 고치려면 이 스크립트를 다시 돌려야 한다.

   `--check` 를 주면 파일을 고치지 않고 최신 상태인지만 본다 (CI · 배포 전 확인용).
   ============================================================ */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { RELATED, NO } from './related.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PUB = join(HERE, '..', 'public');
const CHECK = process.argv.includes('--check');

const START = '<!-- onward:start · tools/gen-related.mjs 가 만듭니다. 손으로 고치지 마세요 -->';
const END = '<!-- onward:end -->';
const HEAD = { ko: '이어서 볼 것', en: 'Where to go next' };

const pagePath = (slug, lang) => join(PUB, lang === 'en' ? 'en' : '', slug, 'index.html');
const read = (slug, lang) => readFileSync(pagePath(slug, lang), 'utf8');

/* 제목은 대상 페이지의 <h1> 에서 가져온다 — 제목을 고치면 링크 문구가 따라온다 */
function titleOf(slug, lang) {
  const m = read(slug, lang).match(/<h1[^>]*>([\s\S]*?)<\/h1>/);
  if (!m) throw new Error(`${lang}/${slug}: <h1> 을 못 찾았다`);
  return m[1].replace(/\s+/g, ' ').trim();
}

function block(slug, lang) {
  const items = RELATED[slug].map(r => {
    const href = (lang === 'en' ? '/en/' : '/') + r.to + '/';
    return '      <li><a href="' + href + '">' +
      '<span class="no">' + NO[r.to] + '</span>' +
      '<span><span class="t">' + titleOf(r.to, lang) + '</span>' +
      '<span class="why">' + r[lang] + '</span></span></a></li>';
  }).join('\n');
  return START + '\n' +
    '  <nav class="onward" aria-labelledby="onward-h">\n' +
    '    <h2 id="onward-h">' + HEAD[lang] + '</h2>\n' +
    '    <ul>\n' + items + '\n    </ul>\n' +
    '  </nav>\n  ' + END;
}

let changed = 0, stale = [];
for (const slug of Object.keys(RELATED)) {
  for (const lang of ['ko', 'en']) {
    const file = pagePath(slug, lang);
    let html = readFileSync(file, 'utf8');
    const before = html;

    /* 01~13 은 본문을 <article class="prose"> 로 감싸는데 14 이후는 그러지 않아
       문단 여백이 0 이 된다. prose 규칙이 아예 없는 페이지에만 main 에 붙여준다.
       `class="wrap prose"` 도 잡아야 하므로 부분문자열이 아니라 단어 경계로 본다. */
    if (!/class="[^"]*\bprose\b/.test(html)) {
      html = html.replace('<main class="wrap">', '<main class="wrap prose">');
    }

    const b = block(slug, lang);
    const re = new RegExp(START.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[\\s\\S]*?' + END, '');
    if (re.test(html)) html = html.replace(re, b);
    else {
      if (!html.includes('</main>')) throw new Error(`${file}: </main> 이 없다`);
      html = html.replace(/\n(\s*)<\/main>/, '\n\n  ' + b + '\n$1</main>');
    }

    if (html !== before) {
      if (CHECK) stale.push(`${lang}/${slug}`);
      else { writeFileSync(file, html); changed++; }
    }
  }
}

if (CHECK) {
  if (stale.length) {
    console.error(`"이어서 볼 것" 블록이 최신이 아닙니다 (${stale.length}개): ${stale.join(', ')}`);
    console.error('node tools/gen-related.mjs 를 돌리세요.');
    process.exit(1);
  }
  console.log(`"이어서 볼 것" 블록 — ${Object.keys(RELATED).length * 2}개 페이지 모두 최신`);
} else {
  const links = Object.values(RELATED).reduce((a, v) => a + v.length, 0);
  console.log(`"이어서 볼 것" — ${Object.keys(RELATED).length * 2}개 페이지 · 링크 ${links * 2}개 · 갱신 ${changed}개`);
}
