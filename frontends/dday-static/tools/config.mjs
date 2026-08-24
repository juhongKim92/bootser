/* dday-static 의 단일 설정점.
   도메인이 바뀌면 여기만 고친다 — gen-pages · gen-sitemap · check-pages 가 모두 이걸 읽는다. */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export const BASE = 'https://this-is-the.day';

export const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(HERE, '..');
export const PUB = join(ROOT, 'public');
export const DATA = join(PUB, 'data');

/* Nager.Date 는 무키 공개 API 다. 키도 쿼터도 없지만 204개국 × 3년이라
   예의상 동시 요청을 묶어서 보낸다. */
export const NAGER = 'https://date.nager.at/api/v3';
export const CONCURRENCY = 6;

/* 왜 3년인가 —
   올해만 담으면 12월 말에 "다음 공휴일" 이 비고, 1월 초에 "지난 공휴일" 이 빈다.
   앞뒤로 한 해씩 두면 어느 날짜에 열어도 양쪽이 채워진다. */
export const YEARS = (now = new Date()) => {
    const y = now.getUTCFullYear();
    return [y - 1, y, y + 1];
};

/* 'Public' 만 남긴다. Nager 의 types 에는 Bank · Observance · Optional · School ·
   Authorities 가 섞여 있는데, 그건 공휴일이 아니라 관습일이거나 일부 직군만 쉬는 날이다.
   (미국 Lincoln's Birthday 가 Observance 로 들어온다) */
export const isPublic = (h) => Array.isArray(h.types) && h.types.includes('Public');

/* 오늘 날짜(로컬). toISOString() 은 UTC 라 KST 새벽에는 하루 전으로 찍힌다 —
   git 의 --date=short 는 로컬 기준이므로 sitemap 의 lastmod 가 어긋나 버린다. */
export const today = (d = new Date()) =>
    d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0');
