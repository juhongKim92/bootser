/**
 * 최소 PNG 인코더 — truecolor RGB, 필터 없음.
 *
 * `gen-favicon.mjs` 와 `gen-card.mjs` 가 함께 쓴다. 두 벌로 두면 갈라진다.
 * 이 디렉터리의 무의존성 규칙을 지키려고 손으로 인코딩한다 — 단색 블록만
 * 그리므로 필터가 필요 없고, 그래서 이 정도로 짧게 끝난다.
 *
 * 이 파일을 고치면 `node tools/gen-favicon.mjs --check` 가 회귀 검사가 된다.
 * 커밋된 파비콘 넷과 바이트가 하나라도 달라지면 거기서 걸린다.
 */
import { deflateSync } from 'node:zlib';

const CRC_TABLE = (() => {
    const t = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        t[n] = c;
    }
    return t;
})();

export function crc32(buf) {
    let c = -1;
    for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
}

export function chunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
}

/** '#rrggbb' → [r, g, b] */
export const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

/**
 * w×h RGB 버퍼(픽셀당 3바이트)를 PNG 로 인코딩한다.
 * 스캔라인 필터는 0(None) 고정 — 단색 블록뿐이라 이게 가장 잘 압축된다.
 */
export function encodePng(width, height, src) {
    if (src.length !== width * height * 3) {
        throw new Error(`버퍼 크기가 ${src.length} 다 — ${width * height * 3} 이어야 한다`);
    }
    const stride = width * 3 + 1;
    const raw = Buffer.alloc(height * stride);
    for (let y = 0; y < height; y++) {
        raw[y * stride] = 0;
        src.copy(raw, y * stride + 1, y * width * 3, (y + 1) * width * 3);
    }
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8;   // bit depth
    ihdr[9] = 2;   // color type: truecolor RGB
    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk('IHDR', ihdr),
        chunk('IDAT', deflateSync(raw, { level: 9 })),
        chunk('IEND', Buffer.alloc(0)),
    ]);
}

/**
 * PNG 머리에서 크기를 읽는다. 검사 쪽에서 쓴다 —
 * og:image:width 로 적어 둔 값과 실제 파일이 갈라지는 것을 잡는다.
 */
export function pngSize(buf) {
    const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    if (buf.length < 24 || sig.some((b, i) => buf[i] !== b)) return null;
    if (buf.toString('ascii', 12, 16) !== 'IHDR') return null;
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}
