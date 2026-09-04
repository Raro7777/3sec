/* art/04_export/ 에 들어온 최종 이미지를 빌드에 인라인할 수 있는 형태로 모은다.
 *
 *   node web/art-pack.mjs          # 지금 무엇이 들어와 있는지 표로 출력
 *   node web/art-pack.mjs --json   # 빌드가 쓰는 형태 그대로
 *
 * 왜 인라인인가:
 *   빌드 산출물(web/dist/bloom.html)은 **단일 HTML 한 장**이다. 아티팩트로 게시하면 외부 이미지가
 *   CSP 로 막히고, 휴대폰에 파일 하나만 넘겨도 그림이 보여야 한다. 그래서 data: URI 로 넣는다.
 *
 * 규칙(art-style-guide 4.9):
 *   art/04_export/{pid}/{pid}_card.{webp,png}   — 카드 일러스트 3:4
 *   art/04_export/{pid}/{pid}_thumb.{webp,png}  — 썸네일 1:1 (원형 초상에 쓴다)
 *   art/04_export/{pid}/{pid}_meta.json         — 얼굴 좌표 등(있으면 읽고, 없어도 동작한다)
 *   webp 가 있으면 webp 를 쓴다(같은 화질에 png 의 30~40%).
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

/** 규격 (art-style-guide 4.1·4.2·4.3). 비율만 본다 — 해상도는 낮춰 넣어도 화면에서는 문제가 없다. */
export const SPEC = {
  thumb: { ratio: 1,     tol: 0.02, ideal: '512×512',   what: '썸네일' },
  card:  { ratio: 3 / 4, tol: 0.02, ideal: '2048×2732', what: '카드 일러스트' },
};

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
    const row = { pid, thumb: 0, card: 0, dim: {} };
    const one = {};
    for (const kind of ['thumb', 'card']) {
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
  console.log('| pid | 썸네일 | 크기 | 카드 | 크기 |');
  console.log('|---|---|---|---|---|');
  for (const e of entries)
    console.log(`| ${e.pid} | ${kb(e.thumb)} | ${dim(e.dim.thumb)} | ${kb(e.card)} | ${dim(e.dim.card)} |`);
  const mb = bytes / 1024 / 1024;
  console.log(`\n${entries.length}명 · 합계 ${mb.toFixed(2)}MB / 예산 ${ART_BUDGET_MB}MB` +
    (mb > ART_BUDGET_MB ? ' — **초과**' : ''));
  if (problems.length) {
    console.log(`\n## 규격 확인 — ${problems.length}건\n`);
    for (const p of problems) console.log(`- ${p}`);
    process.exit(1);
  }
  console.log('\n규격 확인: 이상 없음 ✅');
}
