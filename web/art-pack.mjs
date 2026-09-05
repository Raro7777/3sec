/* art/04_export/ 에 들어온 최종 이미지를 빌드에 인라인할 수 있는 형태로 모은다.
 *
 *   node web/art-pack.mjs          # 지금 무엇이 들어와 있는지 표로 출력
 *   node web/art-pack.mjs --json   # 빌드가 쓰는 형태 그대로
 *
 * 왜 인라인인가:
 *   빌드 산출물(web/dist/bloom.html)은 **단일 HTML 한 장**이다. 아티팩트로 게시하면 외부 이미지가
 *   CSP 로 막히고, 휴대폰에 파일 하나만 넘겨도 그림이 보여야 한다. 그래서 data: URI 로 넣는다.
 *
 * 규칙(art-style-guide 4.9 · art-pipeline 15.2):
 *   art/04_export/{pid}/{pid}_card.{webp,png}   — 카드 일러스트 3:4
 *   art/04_export/{pid}/{pid}_hero.{webp,png}   — 전신 3:4 (선수 상세)
 *   art/04_export/{pid}/{pid}_meta.json         — 얼굴 좌표(card.face). 원형 초상은 **카드에서 오린다** —
 *                                                  별도 썸네일 파일을 두지 않는다(42명 × 32KB = 1.3MB 절약).
 *   webp 가 있으면 webp 를 쓴다(같은 화질에 png 의 30~40%).
 *   {pid} 는 선수 id(p001~) 또는 신인 외형 풀 id(rk01~) 다.
 *
 * 파일이 하나도 없으면 빈 팩을 돌려준다 — 그때 앱은 지금처럼 SVG 플레이스홀더를 그린다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const EXPORT_DIR = path.join(ROOT, 'art', '04_export');

/** 인라인 예산 — 넘으면 빌드가 경고한다. 아티팩트 상한 16MB 에 여유를 둔 값. */
export const ART_BUDGET_MB = 11;

const MIME = { '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' };
const PREFER = ['.webp', '.png', '.jpg', '.jpeg'];

/**
 * 규격 (art-style-guide 4.1·4.2·4.3). 비율만 본다 — 해상도는 낮춰 넣어도 화면에서는 문제가 없다.
 *
 * card 와 hero 는 같은 3:4 지만 **프레이밍이 다르다**(art-pipeline 10):
 *   card = 미디엄 샷(허벅지 컷). 리스트·가챠 결과에서 96px 로 줄어도 얼굴이 읽혀야 한다.
 *   hero = 전신 액션. 선수 상세 화면에서 크게 본다. 없으면 카드로 대신한다.
 */
export const SPEC = {
  card:  { ratio: 3 / 4, tol: 0.02, ideal: '2048×2732', what: '카드 일러스트(미디엄 샷)' },
  hero:  { ratio: 3 / 4, tol: 0.04, ideal: '1600×2133', what: '전신 일러스트' },
};
/** 얼굴 상자 기본값(4.2 규격: 얼굴 중심 (50%, 30%) · 머리 높이 20%). meta.json 이 없을 때만 쓴다. */
export const FACE_DEFAULT = [0.5, 0.30, 0.20];

/** PNG·WebP 헤더에서 크기를 읽는다(외부 의존 없이). 못 읽으면 null. */
function dimensions(buf) {
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504E47)                       // PNG
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  if (buf.length > 30 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    const fmt = buf.toString('ascii', 12, 16);
    if (fmt === 'VP8 ')  return { w: buf.readUInt16LE(26) & 0x3FFF, h: buf.readUInt16LE(28) & 0x3FFF };
    if (fmt === 'VP8L') { const b = buf.readUInt32LE(21); return { w: (b & 0x3FFF) + 1, h: ((b >> 14) & 0x3FFF) + 1 }; }
    if (fmt === 'VP8X')  return { w: (buf.readUIntLE(24, 3) & 0xFFFFFF) + 1, h: (buf.readUIntLE(27, 3) & 0xFFFFFF) + 1 };
  }
  return null;
}

/** {pid}_{kind}.* 중 우선순위가 가장 높은 확장자 하나를 고른다. */
function pick(dir, pid, kind) {
  for (const ext of PREFER) {
    const f = path.join(dir, `${pid}_${kind}${ext}`);
    if (fs.existsSync(f)) return { file: f, ext };
  }
  return null;
}

function dataUri(hit) {
  const buf = fs.readFileSync(hit.file);
  return { uri: `data:${MIME[hit.ext]};base64,${buf.toString('base64')}`, bytes: buf.length, dim: dimensions(buf) };
}

/**
 * @returns {{art:Object, bytes:number, entries:Array, problems:Array}}
 *   art 은 { p001:{thumb,card}, ... } 형태. problems 는 규격 위반 목록(빌드는 막지 않고 경고만 한다 —
 *   비율이 조금 어긋난 그림이라도 화면에는 나오는 편이 작업 중에는 낫다).
 */
export function collectArt() {
  const art = {}, entries = [], problems = [];
  let bytes = 0;
  if (!fs.existsSync(EXPORT_DIR)) return { art, bytes, entries, problems };

  for (const pid of fs.readdirSync(EXPORT_DIR).sort()) {
    const dir = path.join(EXPORT_DIR, pid);
    if (!fs.statSync(dir).isDirectory()) continue;
    const row = { pid, card: 0, hero: 0, dim: {} };
    const one = {};
    for (const kind of ['card', 'hero']) {
      const hit = pick(dir, pid, kind);
      if (!hit) continue;
      const { uri, bytes: n, dim } = dataUri(hit);
      one[kind] = uri;
      row[kind] = n;
      row.dim[kind] = dim;
      bytes += n;
      const spec = SPEC[kind];
      if (!dim) problems.push(`${pid} ${spec.what}: 크기를 읽을 수 없습니다(${path.basename(hit.file)})`);
      else if (Math.abs(dim.w / dim.h - spec.ratio) > spec.tol)
        problems.push(`${pid} ${spec.what}: 비율 ${dim.w}×${dim.h} — 규격은 ${spec.ideal} (${spec.ratio === 1 ? '1:1' : '3:4'})`);
    }
    if (one.card) {
      // 얼굴 상자 — 카드 좌표계의 비율 [cx, cy, h]. 원형 초상은 이 상자를 2.2×h 정사각형으로 오려 만든다(4.3).
      const metaFile = path.join(dir, `${pid}_meta.json`);
      let f = FACE_DEFAULT;
      if (fs.existsSync(metaFile)) {
        try {
          const m = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
          const fc = m.card && m.card.face, d = row.dim.card;
          if (fc && d) f = [fc.cx / d.w, fc.cy / d.h, fc.h / d.h].map(v => Math.round(v * 1000) / 1000);
        } catch { problems.push(`${pid}: meta.json 을 읽을 수 없습니다`); }
      }
      one.f = f;
    }
    if (Object.keys(one).length) { art[pid] = one; entries.push(row); }
    else problems.push(`${pid}: 폴더는 있는데 ${PREFER.join('/')} 파일이 없습니다`);
  }
  return { art, bytes, entries, problems };
}

// ─────────────────────────────────────────────────────────── CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  const { art, bytes, entries, problems } = collectArt();
  if (process.argv.includes('--json')) { console.log(JSON.stringify(art)); process.exit(0); }

  const kb = n => n ? (n / 1024).toFixed(0) + 'KB' : '—';
  console.log(`# art/04_export 스캔\n`);
  if (!entries.length) {
    console.log('들어온 이미지가 없습니다. 앱은 SVG 플레이스홀더를 그립니다.');
    console.log(`\n넣는 곳: art/04_export/{pid}/{pid}_thumb.webp · {pid}_card.webp  (규격은 docs/art-pipeline.md)`);
    process.exit(0);
  }
  const dim = d => d ? `${d.w}×${d.h}` : '?';
  console.log('| id | 카드 | 크기 | 전신 | 크기 | 얼굴 |');
  console.log('|---|---|---|---|---|---|');
  for (const e of entries)
    console.log(`| ${e.pid} | ${kb(e.card)} | ${dim(e.dim.card)} | ${kb(e.hero)} | ${dim(e.dim.hero)} | ${(art[e.pid].f || []).join(',')} |`);
  const mb = bytes / 1024 / 1024;
  const launch = entries.filter(e => /^p\d/.test(e.pid)), pool = entries.filter(e => /^rk/.test(e.pid));
  const sum = list => list.reduce((a, e) => a + e.card + e.hero, 0) / 1024 / 1024;
  console.log(`\n선수 ${launch.length}명 ${sum(launch).toFixed(2)}MB · 신인 풀 ${pool.length}종 ${sum(pool).toFixed(2)}MB` +
    ` · 합계 ${mb.toFixed(2)}MB / 예산 ${ART_BUDGET_MB}MB` + (mb > ART_BUDGET_MB ? ' — **초과**' : ''));
  if (problems.length) {
    console.log(`\n## 규격 확인 — ${problems.length}건\n`);
    for (const p of problems) console.log(`- ${p}`);
    process.exit(1);
  }
  console.log('\n규격 확인: 이상 없음 ✅');
}
