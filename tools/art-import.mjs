/* 생성된 원본 한 장을 카드 규격으로 잘라 art/04_export/{pid}/ 에 넣는다.
 *
 *   node tools/art-import.mjs p001 ~/생성물.png --face 470,310,180
 *   node tools/art-import.mjs p001 원본.png --face 470,310,180 --dry   # 파일을 쓰지 않고 계산만
 *
 * 왜 필요한가:
 *   생성 도구가 내주는 비율(1024×1536 = 2:3 등)은 카드 규격 3:4 가 아니고, 용량도 2MB 씩 나온다.
 *   웹 프로토타입은 42명 전원을 단일 HTML 에 인라인하므로 **카드 1장 200KB** 가 상한이다(docs/art-pipeline.md 3).
 *   42번 손으로 자르면 4.2절의 얼굴 위치 규칙이 사람마다 흔들린다.
 *
 * 이미지 처리를 어떻게 하는가:
 *   이 환경에는 ImageMagick·Pillow·sharp 가 없다. 대신 **이미 있는 Chromium**(playwright)의 캔버스를 쓴다 —
 *   디코딩·크롭·리샘플·WebP 인코딩을 브라우저가 다 해 준다. 새 의존성이 늘지 않는다.
 *
 * 자르는 규칙 (art-style-guide 4.2 · 4.3):
 *   카드  = 3:4. 얼굴 중심이 세로 30% 지점에 오도록 맞추고, 원본을 벗어나면 경계로 민다.
 *   썸네일 = 1:1. 한 변 = 2.2 × 얼굴 높이, 중심 = (cx, cy + 0.15 × 얼굴 높이).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

const ARGV = process.argv.slice(2);
const DRY = ARGV.includes('--dry');
const opt = (name, def) => { const i = ARGV.indexOf('--' + name); return i >= 0 && ARGV[i + 1] ? ARGV[i + 1] : def; };
const VALUED = ['face', 'quality', 'cardw', 'headfrac', 'kind'];
const [pid, src] = ARGV.filter((a, i) => !a.startsWith('--') && !VALUED.includes((ARGV[i - 1] || '').replace('--', '')));

if (!pid || !src) {
  console.error('사용법: node tools/art-import.mjs <pid> <원본> [--kind card|hero] [--face cx,cy,h] [--headfrac 0.20] [--cardw 900] [--dry]');
  process.exit(1);
}
if (!fs.existsSync(src)) { console.error(`원본을 찾을 수 없습니다: ${src}`); process.exit(1); }

/**
 * 무엇을 만드는가 — `card`(기본) 또는 `hero`.
 *   card: 미디엄 샷을 3:4 로 잘라 카드·썸네일을 만든다. 리스트에서 96px 로 줄어도 얼굴이 읽혀야 한다.
 *   hero: 전신 액션을 그대로 3:4 로 맞춰 넣는다. 선수 상세 화면에서 크게 보는 용도라 자르지 않는다.
 */
const KIND = opt('kind', 'card');
if (KIND !== 'card' && KIND !== 'hero') { console.error("--kind 는 card 또는 hero 입니다."); process.exit(1); }

/** 카드 가로 픽셀. 웹 프로토타입 표시 크기(최대 108px CSS)의 8배면 충분하고, 용량이 예산 안에 든다. */
const CARD_W = +opt('cardw', KIND === 'hero' ? 1000 : 900);
/** 카드 높이에서 머리가 차지할 비율. 주면 그 크기가 되도록 잘라 낸다(4.2 는 0.18~0.23). */
const HEADFRAC = opt('headfrac', null) ? +opt('headfrac') : null;
/** (참고용) 썸네일 변 — 파일은 더 이상 쓰지 않는다. 원형 초상은 앱이 카드에서 오린다(art-pipeline 15.2). */
const THUMB_W = 512;
/** 용량 상한 — 42명 × (카드+썸네일)이 인라인 예산 11MB 안에 들어야 한다. */
const BUDGET = { card: 200 * 1024, thumb: 60 * 1024, hero: 160 * 1024 };
/** 시작 품질 — 예산을 넘기면 한 단계씩 내린다. `--quality 0.8` 로 시작점을 낮출 수 있다(신인 풀은 0.8·600px, art-pipeline 15.3). */
const Q0 = +opt('quality', 0.85);
const QUALITIES = [0.85, 0.8, 0.75, 0.7, 0.65, 0.6, 0.55].filter(q => q <= Q0 + 1e-9);

// ── 원본 크기 (PNG/WebP 헤더에서 직접 읽는다)
const buf = fs.readFileSync(src);
function dimensions(b) {
  if (b.length > 24 && b.readUInt32BE(0) === 0x89504E47) return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
  if (b.length > 30 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') {
    const f = b.toString('ascii', 12, 16);
    if (f === 'VP8 ') return { w: b.readUInt16LE(26) & 0x3FFF, h: b.readUInt16LE(28) & 0x3FFF };
    if (f === 'VP8L') { const v = b.readUInt32LE(21); return { w: (v & 0x3FFF) + 1, h: ((v >> 14) & 0x3FFF) + 1 }; }
    if (f === 'VP8X') return { w: (b.readUIntLE(24, 3) & 0xFFFFFF) + 1, h: (b.readUIntLE(27, 3) & 0xFFFFFF) + 1 };
  }
  return null;
}
const dim = dimensions(buf);
if (!dim) { console.error('PNG·WebP 만 읽습니다(크기를 못 읽었습니다).'); process.exit(1); }
const { w: SW, h: SH } = dim;

// ── 얼굴 좌표. 안 주면 4.2 의 권장 위치로 가정하고 그 사실을 알린다.
const faceArg = opt('face', null);
const face = faceArg
  ? (() => { const [cx, cy, h] = faceArg.split(',').map(Number); return { cx, cy, h }; })()
  : { cx: Math.round(SW * 0.5), cy: Math.round(SH * 0.30), h: Math.round(SH * 0.20) };
if (!faceArg) console.warn('⚠ --face 를 주지 않아 4.2 권장 위치로 가정합니다. 썸네일이 어긋나면 실제 좌표를 주세요.');

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/**
 * 카드 크롭 (3:4).
 *
 * 기본은 "비율만 맞춘다" — 원본을 최대한 살리고 얼굴 중심을 세로 30% 로 민다.
 *
 * `--headfrac 0.20` 을 주면 **머리 크기까지 맞춘다**: 카드 높이의 20% 를 머리가 채우도록 잘라 낸다.
 * 이게 필요한 이유는 실측이다 — 생성 모델은 프롬프트로 "머리가 화면의 1/5" 을 아무리 지시해도
 * 전신을 그린다(히어로 시험 6장 전부 머리 10~16%). 4.2 규격은 18~23% 이고, 그래야 카드가 96px 로
 * 줄었을 때 얼굴이 읽힌다. 생성으로 안 되는 것을 크롭으로 맞춘다.
 */
function cardCrop() {
  const R = 3 / 4;
  if (HEADFRAC && KIND === 'card') {
    let h = Math.round(face.h / HEADFRAC);
    let w = Math.round(h * R);
    if (w > SW || h > SH) {                           // 원본보다 커지면 들어가는 최대 크기로
      const k = Math.min(SW / w, SH / h);
      w = Math.round(w * k); h = Math.round(h * k);
    }
    const x = Math.round(clamp(face.cx - w / 2, 0, SW - w));
    const y = Math.round(clamp(face.cy - 0.30 * h, 0, SH - h));
    return { x, y, w, h };
  }
  if (SW / SH < R) {                                  // 원본이 규격보다 세로로 길다 → 위아래를 자른다
    const h = Math.round(SW / R);
    const y = Math.round(clamp(face.cy - 0.30 * h, 0, SH - h));
    return { x: 0, y, w: SW, h };
  }
  const w = Math.round(SH * R);                       // 가로로 넓다 → 좌우를 자른다
  const x = Math.round(clamp(face.cx - w / 2, 0, SW - w));
  return { x, y: 0, w, h: SH };
}
// ── 썸네일 크롭 (1:1) — 4.3
function thumbCrop() {
  const side = Math.round(Math.min(2.2 * face.h, SW, SH));
  const x = Math.round(clamp(face.cx - side / 2, 0, SW - side));
  const y = Math.round(clamp(face.cy + 0.15 * face.h - side / 2, 0, SH - side));
  return { x, y, w: side, h: side };
}

const card = cardCrop(), thumb = thumbCrop();
const facePct = { x: (face.cx - card.x) / card.w, y: (face.cy - card.y) / card.h };

console.log(`# ${pid} ← ${path.basename(src)}\n`);
console.log(`| 항목 | 값 |`);
console.log(`|---|---|`);
console.log(`| 원본 | ${SW}×${SH} (비율 ${(SW / SH).toFixed(3)}) · ${(buf.length / 1024).toFixed(0)}KB |`);
console.log(`| 얼굴(원본 좌표) | 중심 (${face.cx}, ${face.cy}) · 높이 ${face.h} |`);
console.log(`| 카드 크롭 | (${card.x}, ${card.y}) ${card.w}×${card.h} → ${CARD_W}×${Math.round(CARD_W * 4 / 3)} |`);
console.log(`| 썸네일 크롭 | (${thumb.x}, ${thumb.y}) ${thumb.w}×${thumb.h} → ${THUMB_W}×${THUMB_W} |`);
const inTol = Math.abs(facePct.x - 0.5) <= 0.06 && Math.abs(facePct.y - 0.30) <= 0.05;
const headPct = face.h / card.h;
console.log(`| 카드 안 얼굴 위치 | (${(facePct.x * 100).toFixed(0)}%, ${(facePct.y * 100).toFixed(0)}%) — 권장 (50%, 30%) ±(6, 5) ${inTol ? '✅' : '⚠ 벗어남'} |`);
console.log(`| 카드 안 머리 크기 | ${(headPct * 100).toFixed(0)}% — 규격 18~23% ${headPct >= 0.18 && headPct <= 0.23 ? '✅' : '⚠ 벗어남'} |`);

if (DRY) process.exit(0);

// ── Chromium 캔버스로 크롭·리샘플·WebP 인코딩
let chromium;
try { ({ chromium } = await import('playwright')); }
catch { console.error('playwright 가 필요합니다: npm i -D playwright'); process.exit(1); }
const CHROME = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium/chrome']
  .find(p => fs.existsSync(p));

const browser = await chromium.launch({ headless: true, ...(CHROME ? { executablePath: CHROME } : {}) });
const page = await browser.newPage();
const srcUri = `data:image/${src.toLowerCase().endsWith('.webp') ? 'webp' : 'png'};base64,${buf.toString('base64')}`;

/** 크롭 영역을 out×outH 로 리샘플해 WebP 로 인코딩. 예산에 들 때까지 품질을 낮춘다. */
async function render(crop, outW, outH, budget, label) {
  for (const q of QUALITIES) {
    const b64 = await page.evaluate(async ({ uri, crop, outW, outH, q }) => {
      const img = new Image();
      img.src = uri;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = outW; c.height = outH;
      const g = c.getContext('2d');
      g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
      g.drawImage(img, crop.x, crop.y, crop.w, crop.h, 0, 0, outW, outH);
      return c.toDataURL('image/webp', q).split(',')[1];
    }, { uri: srcUri, crop, outW, outH, q });
    const out = Buffer.from(b64, 'base64');
    if (out.length <= budget || q === QUALITIES[QUALITIES.length - 1]) {
      console.log(`  ${label}: ${(out.length / 1024).toFixed(0)}KB (품질 ${q})` +
        (out.length > budget ? ` — ⚠ 예산 ${(budget / 1024).toFixed(0)}KB 초과` : ''));
      return out;
    }
  }
}

const dir = path.join(ROOT, 'art', '04_export', pid);
fs.mkdirSync(dir, { recursive: true });
console.log('');
if (KIND === 'hero') {
  fs.writeFileSync(path.join(dir, `${pid}_hero.webp`),
    await render(card, CARD_W, Math.round(CARD_W * 4 / 3), BUDGET.hero, '전신 '));
} else {
  fs.writeFileSync(path.join(dir, `${pid}_card.webp`), await render(card, CARD_W, Math.round(CARD_W * 4 / 3), BUDGET.card, '카드 '));
  // 썸네일 파일은 만들지 않는다 — 앱과 대조 시트가 meta.json 의 얼굴 상자로 카드에서 직접 오린다(15.2).
  // 옛 썸네일이 남아 있으면 지운다(빌드가 더 이상 읽지 않으니 남겨 두면 헷갈린다).
  fs.rmSync(path.join(dir, `${pid}_thumb.webp`), { force: true });
}
await browser.close();

// ── meta.json — 카드 좌표계로 환산한 얼굴 위치를 기록한다(썸네일 재생성·연출이 이 값을 쓴다)
if (KIND === 'hero') {
  console.log(`\n→ art/04_export/${pid}/${pid}_hero.webp 를 넣었습니다(선수 상세 화면용).`);
  process.exit(0);
}
const seed = path.join(ROOT, 'art', '00_guide', 'meta_seed', `${pid}_meta.json`);
const meta = fs.existsSync(seed) ? JSON.parse(fs.readFileSync(seed, 'utf8')) : { pid };
const scale = CARD_W / card.w;
meta.card = { face: {
  cx: Math.round((face.cx - card.x) * scale),
  cy: Math.round((face.cy - card.y) * scale),
  h: Math.round(face.h * scale),
} };
meta.source = { file: path.basename(src), size: `${SW}x${SH}`, crop: card, imported: new Date().toISOString().slice(0, 10) };
delete meta._note;
fs.writeFileSync(path.join(dir, `${pid}_meta.json`), JSON.stringify(meta, null, 2) + '\n');

console.log(`\n→ art/04_export/${pid}/ 에 카드·meta.json 을 넣었습니다(초상은 카드에서 오린다).`);
console.log(`   확인: node web/art-pack.mjs · 빌드: node web/build.mjs`);
