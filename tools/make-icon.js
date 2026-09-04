'use strict';
/* 앱 아이콘 생성기 — build/icon.png (512×512) 를 만든다.
 *
 * 외부 이미지 편집 없이 플레이스홀더 아이콘을 코드로 그린다.
 * electron-builder 는 build/icon.png 하나로 Windows(.ico)·macOS(.icns) 를 자동 생성한다.
 *
 * 실제 아트가 준비되면 이 스크립트를 쓰지 말고 512×512 이상 PNG 를 build/icon.png 로
 * 바꿔 넣으면 된다. **지금은 실제 아이콘이 들어와 있으므로 이 스크립트는 기본적으로
 * 아무 일도 하지 않는다** — CI 가 무심코 실제 아이콘을 플레이스홀더로 덮어쓰는 사고를
 * 막기 위해서다(빌드 워크플로에서도 이 단계를 뺐다).
 *
 * 사용법:  node tools/make-icon.js         # 이미 있으면 건너뛴다
 *          node tools/make-icon.js --force # 그래도 다시 그린다
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZE = 512;
const W = SIZE, H = SIZE;

// ---- 픽셀 버퍼 (RGBA) ----
const px = Buffer.alloc(W * H * 4, 0);

function blend(x, y, r, g, b, a) {
  if (x < 0 || y < 0 || x >= W || y >= H || a <= 0) return;
  const i = (y * W + x) * 4;
  const sa = a, da = px[i + 3] / 255;
  const outA = sa + da * (1 - sa);
  if (outA <= 0) return;
  px[i]     = Math.round((r * sa + px[i]     * da * (1 - sa)) / outA);
  px[i + 1] = Math.round((g * sa + px[i + 1] * da * (1 - sa)) / outA);
  px[i + 2] = Math.round((b * sa + px[i + 2] * da * (1 - sa)) / outA);
  px[i + 3] = Math.round(outA * 255);
}

// 안티에일리어싱용: 거리 기반 커버리지(경계에서 1px 부드럽게)
function coverage(d) {
  // d < 0 이면 내부. 경계 폭 1px.
  if (d <= -0.5) return 1;
  if (d >= 0.5) return 0;
  return 0.5 - d;
}

function roundRect(x0, y0, x1, y1, radius, colorAt) {
  for (let y = Math.floor(y0) - 1; y <= Math.ceil(y1) + 1; y++) {
    for (let x = Math.floor(x0) - 1; x <= Math.ceil(x1) + 1; x++) {
      // 둥근 사각형의 부호 있는 거리
      const cx = Math.min(Math.max(x, x0 + radius), x1 - radius);
      const cy = Math.min(Math.max(y, y0 + radius), y1 - radius);
      const dx = x - cx, dy = y - cy;
      const d = Math.sqrt(dx * dx + dy * dy) - radius;
      const c = coverage(d);
      if (c > 0) {
        const col = colorAt(x, y);
        blend(x, y, col[0], col[1], col[2], c * (col[3] === undefined ? 1 : col[3]));
      }
    }
  }
}

function circle(cx, cy, r, col) {
  for (let y = Math.floor(cy - r) - 1; y <= Math.ceil(cy + r) + 1; y++) {
    for (let x = Math.floor(cx - r) - 1; x <= Math.ceil(cx + r) + 1; x++) {
      const d = Math.hypot(x - cx, y - cy) - r;
      const c = coverage(d);
      if (c > 0) blend(x, y, col[0], col[1], col[2], c * (col[3] === undefined ? 1 : col[3]));
    }
  }
}

// 캡슐(둥근 끝의 선분) — 팔·다리·몸통에 사용
function capsule(x1, y1, x2, y2, r, col) {
  const minX = Math.min(x1, x2) - r - 1, maxX = Math.max(x1, x2) + r + 1;
  const minY = Math.min(y1, y2) - r - 1, maxY = Math.max(y1, y2) + r + 1;
  const vx = x2 - x1, vy = y2 - y1;
  const len2 = vx * vx + vy * vy || 1;
  for (let y = Math.floor(minY); y <= Math.ceil(maxY); y++) {
    for (let x = Math.floor(minX); x <= Math.ceil(maxX); x++) {
      let t = ((x - x1) * vx + (y - y1) * vy) / len2;
      t = Math.max(0, Math.min(1, t));
      const d = Math.hypot(x - (x1 + t * vx), y - (y1 + t * vy)) - r;
      const c = coverage(d);
      if (c > 0) blend(x, y, col[0], col[1], col[2], c * (col[3] === undefined ? 1 : col[3]));
    }
  }
}

// ---- 그리기 ----
// 배경: 보라 그라데이션 둥근 사각형
const PAD = 26;
roundRect(PAD, PAD, W - PAD, H - PAD, 112, (x, y) => {
  const t = (y - PAD) / (H - PAD * 2);
  // #8a63ff -> #5b34d6
  const r = Math.round(138 + (91 - 138) * t);
  const g = Math.round(99 + (52 - 99) * t);
  const b = Math.round(255 + (214 - 255) * t);
  return [r, g, b, 1];
});

// 캐릭터 실루엣(흰색): 머리 + 몸통 + 한쪽 팔을 든 포즈(신호 보내는 느낌)
const WHITE = [255, 255, 255, 1];
circle(256, 196, 62, WHITE);                 // 머리
capsule(256, 268, 256, 358, 46, WHITE);      // 몸통
capsule(212, 292, 150, 232, 22, WHITE);      // 왼팔(살짝 아래)
capsule(300, 292, 372, 208, 22, WHITE);      // 오른팔(위로 든 팔)
capsule(232, 366, 224, 424, 22, WHITE);      // 왼다리
capsule(280, 366, 288, 424, 22, WHITE);      // 오른다리

// ---- PNG 인코딩 ----
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

// 각 행 앞에 필터 바이트(0) 붙이기
const raw = Buffer.alloc(H * (1 + W * 4));
for (let y = 0; y < H; y++) {
  raw[y * (1 + W * 4)] = 0;
  px.copy(raw, y * (1 + W * 4) + 1, y * W * 4, (y + 1) * W * 4);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8;    // bit depth
ihdr[9] = 6;    // color type: RGBA
ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0))
]);

const outDir = path.join(__dirname, '..', 'build');
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, 'icon.png');
// 실제 아이콘을 플레이스홀더로 덮어쓰지 않는다. 다시 그리려면 --force.
if (fs.existsSync(outPath) && !process.argv.includes('--force')) {
  console.log(`이미 아이콘이 있어 그대로 둡니다: ${outPath}`);
  console.log('플레이스홀더로 다시 그리려면: node tools/make-icon.js --force');
  process.exit(0);
}
fs.writeFileSync(outPath, png);
console.log(`아이콘 생성: ${outPath} (${W}×${H}, ${(png.length / 1024).toFixed(1)} KB)`);
