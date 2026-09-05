/* 아트 슬롯인 회귀 테스트 — "그림이 들어오면 게임에 실제로 보이는가".
 *
 *   node web/art-test.mjs            (playwright 필요)
 *   node web/art-test.mjs --keep     검사용 임시 아트를 지우지 않는다(눈으로 볼 때)
 *
 * 이 테스트가 있는 이유:
 *   아트 파이프라인의 마지막 한 칸("PNG 를 폴더에 넣으면 화면에 뜬다")은 그림이 한 장도 없는
 *   지금 상태에서는 아무도 못 밟아 본다. 그래서 42명 분 아트를 만든 **뒤에** 깨진 걸 발견하게 된다.
 *   여기서는 검사용 이미지를 잠깐 넣고 빌드해 실제로 <img> 로 그려지는지 보고, 끝나면 지운다.
 *
 * 검사 대상:
 *   1. art-pack 이 art/04_export 를 훑어 data: URI 로 만든다 · webp 가 png 보다 우선한다
 *   2. 빌드가 window.BLOOM_ART 로 인라인한다
 *   3. 실제 화면(스카우트 결과)에서 초상·카드아트가 <img> 로 그려지고 **디코딩까지 된다**
 *   4. 검사 후 저장소에 임시 파일이 남지 않는다
 *
 * 아트가 **없을 때** SVG 플레이스홀더로 떨어지는 경로는 여기서 검사하지 않는다 —
 * `node web/app-test.mjs` 32건이 아트가 하나도 없는 상태로 도는 것이 곧 그 검사다.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const EXPORT = path.join(ROOT, 'art', '04_export');
const OUT = path.join(HERE, 'dist', 'bloom-arttest.html');
const KEEP = process.argv.includes('--keep');

// ─────────────────────────────────────────────── 최소 PNG 인코더 (검사용 단색 이미지)
function png(w, h, rgb) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;                                   // 필터 타입 None
    for (let x = 0; x < w; x++) {
      const o = y * (w * 3 + 1) + 1 + x * 3;
      raw[o] = rgb[0]; raw[o + 1] = rgb[1]; raw[o + 2] = rgb[2];
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;   // 8bit truecolor
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}
let CRC_T = null;
function crc32(buf) {
  if (!CRC_T) {
    CRC_T = new Int32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; CRC_T[n] = c; }
  }
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_T[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return c ^ -1;
}

// ─────────────────────────────────────────────── 하네스
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: !!ok, detail: detail || '' });
  if (!ok) console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`);
};

/**
 * 검사 대상 pid — **실물 선수와 겹치지 않는 합성 id 를 쓴다.**
 *
 * 두 가지를 동시에 지켜야 한다.
 *   ① 실물 아트를 건드리지 않는다. 초기 판에서는 42명 전원에 검사용 파일을 썼는데, webp 우선순위를 보려고
 *      `{pid}_thumb.webp` 를 만들면 **실물 썸네일을 덮어쓰고 지웠다**(실제로 한 번 날렸다).
 *   ② 42명 전원에 아트가 들어와도 돈다. ①의 첫 해법은 "아트가 없는 선수 pid 를 빌려 쓰기" 였는데,
 *      카드 42장이 다 들어오자 빌릴 자리가 없어져 **하네스가 아예 못 돌게 됐다**(13절).
 *
 * 그래서 선수 id 가 아닌 id 를 만들어 쓴다. `art-pack` 은 폴더 이름을 그대로 키로 삼으므로 이것으로 충분하고,
 * 화면 검사(5)는 ART_PID 가 아니라 "화면에 인라인된 그림이 나오는가"를 보므로 실물 아트로 성립한다.
 */
const ALL_PIDS = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'players.json'), 'utf8')).map(p => p.id);
const hasRealArt = pid => fs.existsSync(path.join(EXPORT, pid)) &&
  fs.readdirSync(path.join(EXPORT, pid)).some(f => /\.(webp|png|jpe?g)$/i.test(f));
const REAL = ALL_PIDS.filter(hasRealArt);
const ART_PID = 'zzz-arttest';
if (ALL_PIDS.includes(ART_PID)) { console.error(`${ART_PID} 가 실제 선수 id 가 됐습니다 — 검사용 id 를 바꾸세요.`); process.exit(1); }
const PIDS = [ART_PID];
/** 검사 시작 시점의 04_export 스냅샷 — 끝나고 그대로 돌아왔는지 본다. */
const snapshot = () => fs.existsSync(EXPORT)
  ? fs.readdirSync(EXPORT).flatMap(d => {
      const p = path.join(EXPORT, d);
      return fs.statSync(p).isDirectory() ? fs.readdirSync(p).map(f => d + '/' + f) : [d];
    }).sort().join('|')
  : '';
const BEFORE = snapshot();
const made = [];
function put(pid, kind, ext, buf) {
  const dir = path.join(EXPORT, pid);
  fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, `${pid}_${kind}${ext}`);
  fs.writeFileSync(f, buf);
  made.push(f);
  return f;
}
function cleanup() {
  for (const f of made) fs.rmSync(f, { force: true });
  for (const pid of new Set(made.map(f => path.basename(path.dirname(f))))) {
    const d = path.join(EXPORT, pid);
    if (fs.existsSync(d) && fs.readdirSync(d).length === 0) fs.rmdirSync(d);
  }
  fs.rmSync(OUT, { force: true });
}

process.on('exit', () => { if (!KEEP) cleanup(); });

// 1) 검사용 아트를 넣는다 — 눈에 확 띄는 단색
const THUMB = png(64, 64, [230, 40, 160]), CARD = png(60, 80, [40, 200, 230]);
for (const pid of PIDS) { put(pid, 'thumb', '.png', THUMB); put(pid, 'card', '.png', CARD); }

// 2) art-pack 이 잡아내는가
const { collectArt } = await import('./art-pack.mjs?t=' + Date.now());
const packed = collectArt();
check('art-pack 이 넣은 아트를 전부 찾는다', Object.keys(packed.art).length === PIDS.length + REAL.length,
  Object.keys(packed.art).length + '/' + (PIDS.length + REAL.length) + (REAL.length ? ` (실물 ${REAL.length}명 포함)` : ''));
check('썸네일·카드 둘 다 잡힌다', !!packed.art[ART_PID]?.thumb && !!packed.art[ART_PID]?.card);
check('data: URI 로 만든다', /^data:image\/png;base64,/.test(packed.art[ART_PID]?.thumb || ''));

// 3) webp 우선순위 — 같은 이름의 webp 가 있으면 그쪽을 쓴다
put(ART_PID, 'thumb', '.webp', Buffer.from('RIFF____WEBPVP8 ', 'ascii'));
const packed2 = collectArt();
check('webp 가 png 보다 우선한다', /^data:image\/webp;/.test(packed2.art[ART_PID]?.thumb || ''),
  (packed2.art[ART_PID]?.thumb || '').slice(0, 24));
fs.rmSync(made.pop(), { force: true });                       // webp 는 가짜라 브라우저 검사에서 빼둔다

// 4) 빌드가 인라인하는가
execFileSync('node', [path.join(HERE, 'build.mjs'), '--out', OUT], { stdio: ['ignore', 'pipe', 'pipe'] });
const html = fs.readFileSync(OUT, 'utf8');
// 키 순서는 폴더 정렬 순이라 ART_PID 가 첫 키라고 가정하면 안 된다(실물 아트가 앞설 수 있다)
check('빌드 산출물에 아트가 인라인된다',
  html.includes('window.BLOOM_ART={') && html.includes(`"${ART_PID}":{`));

// 5) 브라우저에서 실제로 <img> 로 그려지는가
let chromium;
try { ({ chromium } = await import('playwright')); }
catch { console.error('playwright 가 필요합니다: npm i -D playwright'); process.exit(1); }
const CHROME = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium/chrome']
  .find(p => fs.existsSync(p));

const browser = await chromium.launch({ headless: true, ...(CHROME ? { executablePath: CHROME } : {}) });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const jsErrors = [];
page.on('pageerror', e => jsErrors.push(e.message));
await page.goto('file://' + OUT);
await page.waitForTimeout(700);

// 화면 흐름을 그대로 밟는다 — 렌더러를 직접 부르지 않고 "플레이어가 보는 것"을 검사한다.
const tap = async (sel, ms = 300) => {
  const el = await page.$(sel);
  if (!el) return false;
  await el.click();
  await page.waitForTimeout(ms);
  return true;
};

// 스카우트 결과 화면 = 카드 아트가 가장 크게 나오는 곳
await tap('[data-tab="scout"]');
await tap('[data-act="scout"]', 500);
const viewHtml = await page.evaluate(() => document.getElementById('view').innerHTML);
// MIME 을 png 로 못 박지 않는다 — 넣는 그림이 webp 라 실물 아트가 늘면 png 만 찾다 헛짚는다.
// 검사의 뜻은 "SVG 플레이스홀더가 아니라 인라인된 그림이 나온다" 이다(art-pipeline 12).
check('스카우트 결과에 카드 아트 <img> 가 있다', /<img[^>]+src="data:image\/(png|webp)/.test(viewHtml));
check('카드아트에 등급 프레임이 남는다', /border:2\.5px solid #(E9B949|A97BE8|5B9BE0|6A7C8E)/.test(viewHtml),
  viewHtml.match(/border:2\.5px solid #\w+/)?.[0] || '프레임 없음');

// 육성 목록 = 원형 초상이 여러 개 나오는 곳
await tap('[data-tab="train"]', 400);
const trainHtml = await page.evaluate(() => document.getElementById('view').innerHTML);
check('육성 목록의 원형 초상이 <img> 다', /class="ava[^"]*"[^>]*>\s*<img[^>]+src="data:image\/(png|webp)/.test(trainHtml));

// **디코딩까지 되는가** — data: URI 가 깨져 있으면 여기서 잡힌다
const imgs = await page.evaluate(() => {
  const list = [...document.querySelectorAll('#view img')];
  return { n: list.length, broken: list.filter(i => i.complete && i.naturalWidth === 0).length };
});
check('화면의 이미지가 실제로 디코딩된다', imgs.n > 0 && imgs.broken === 0, `${imgs.n}장 중 깨짐 ${imgs.broken}`);

// 6) 혼재 상태에서 화면이 정상인가
check('가로 스크롤이 없다', await page.evaluate(() =>
  document.documentElement.scrollWidth <= document.documentElement.clientWidth));
check('자바스크립트 오류가 없다', jsErrors.length === 0, jsErrors.slice(0, 2).join(' | '));

await browser.close();

// 7) 뒷정리
if (!KEEP) {
  cleanup();
  const after = snapshot();
  check('저장소가 검사 전 상태로 돌아온다', after === BEFORE,
    after === BEFORE ? '' : '실물 아트가 바뀌었을 수 있습니다 — art/04_export 를 확인하세요');
}

const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} 통과` + (failed.length ? ` · ${failed.length} 실패` : ' ✅'));
if (failed.length) { for (const f of failed) console.log(`  ✗ ${f.name}${f.detail ? ' — ' + f.detail : ''}`); process.exit(1); }
