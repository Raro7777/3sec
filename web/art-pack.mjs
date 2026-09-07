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
 *   art/04_export/{pid}/{pid}_stand.webp        — 코트 스탠디: 전신에서 배경을 지운 RGBA 누끼, 세로 320px
 *                                                  (tools/art-standee.py 가 hero 에서 만든다 · art-pipeline 16.8)
 *   art/04_export/{pid}/{pid}_meta.json         — 얼굴 좌표(card.face) + 스탠디 앵커(standee). 원형 초상은 **카드에서 오린다** —
 *                                                  별도 썸네일 파일을 두지 않는다(42명 × 32KB = 1.3MB 절약).
 *   webp 가 있으면 webp 를 쓴다(같은 화질에 png 의 30~40%).
 *   {pid} 는 선수 id(p001~) 또는 신인 외형 풀 id(rk01~) 다.
 *
 * 파일이 하나도 없으면 빈 팩을 돌려준다 — 그때 앱은 지금처럼 SVG 플레이스홀더를 그린다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOKIE_LOOKS } from './engine/rookies.js';   // 신인 풀 외형(머리 스타일·색·피부) — 리그 머리(16.9)용

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
  // 스탠디는 몸 상자로 잘라 비율이 제각각이다 — 세로만 본다. 코트에서 최대 ~160px(2x)로 그려지므로 320 이면 충분하다.
  stand: { height: 320, what: '코트 스탠디(누끼)' },
};
/** 스탠디 앵커 기본값 — meta.standee 가 없을 때. [발x, 발y, 몸위, 몸아래, 머리x, 머리y, 방향(1=R,-1=L,0=모름)] */
export const STAND_DEFAULT = [0.5, 1.0, 0.03, 0.97, 0.5, 0.08, 0];

/**
 * 리그 머리(art-pipeline 16.9): h = [머리 팔레트 번호(art-style-guide 2.7, 13 = 선셋 오렌지), 뒷머리 스타일 묶음, 피부톤 A/B/C].
 * 런칭 선수는 meta.json(hair.palette·skin), 신인 풀은 엔진의 ROOKIE_LOOKS 에서 읽는다. 렌더러는 이 세 값만 쓴다.
 */
const HAIR_PALETTE = {
  '블랙': 1, '다크 브라운': 2, '체스트넛 브라운': 3, '라이트 브라운': 4, '애쉬 브라운': 6, '애쉬 그레이': 6, '차콜 그레이': 6,
  '로즈 브라운': 3, '밀크티 베이지': 5, '골든 브라운': 4, '허니 블론드': 5, '오번': 8, '플래티넘 블론드': 7, '와인 레드': 8,
  '민트 그린': 11, '네이비 블루': 10, '화이트': 7, '화이트 실버': 7, '코랄 핑크': 9, '크림슨 레드': 8, '선셋 오렌지': 13,
  '라벤더 퍼플': 12, '스카이 블루': 10, '피치 핑크': 9,
};
/** 헤어스타일 이름 → 뒷머리 도형 묶음. 앞에서부터 먼저 맞는 것. */
export function hairBucket(style) {
  const s = String(style || '');
  if (/트윈테일/.test(s)) return 'twin';
  if (/번/.test(s)) return 'bun';
  if (/브레이드/.test(s)) return 'braid';
  if (/포니테일/.test(s)) return 'pony';
  if (/롱/.test(s)) return 'long';
  if (/미디엄|하프업|레이어드|울프컷|웨이브/.test(s)) return 'medium';
  return 'short';
}
const LOOK_BY_ID = new Map(ROOKIE_LOOKS.map(l => [l.id, l]));
function headInfo(pid, meta) {
  let color = null, style = null, skin = null, palette = null;
  if (meta && meta.hair) { color = meta.hair.color; style = meta.hair.style; palette = meta.hair.palette; skin = meta.skin; }
  const look = LOOK_BY_ID.get(pid);
  if (look) { color = color || look.hairColor; style = style || look.hairStyle; skin = skin || look.skin; }
  if (!color && !style) return null;
  const idx = palette || HAIR_PALETTE[color] || 2;
  return [idx, hairBucket(style), skin || 'A'];
}
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
    const row = { pid, card: 0, hero: 0, stand: 0, dim: {} };
    const one = {};
    const metaFile = path.join(dir, `${pid}_meta.json`);
    let meta = null;
    if (fs.existsSync(metaFile)) {
      try { meta = JSON.parse(fs.readFileSync(metaFile, 'utf8')); }
      catch { problems.push(`${pid}: meta.json 을 읽을 수 없습니다`); }
    }
    for (const kind of ['card', 'hero', 'stand']) {
      const hit = pick(dir, pid, kind);
      if (!hit) continue;
      const { uri, bytes: n, dim } = dataUri(hit);
      one[kind === 'stand' ? 's' : kind] = uri;
      row[kind] = n;
      row.dim[kind] = dim;
      bytes += n;
      const spec = SPEC[kind];
      if (!dim) problems.push(`${pid} ${spec.what}: 크기를 읽을 수 없습니다(${path.basename(hit.file)})`);
      else if (spec.ratio !== undefined && Math.abs(dim.w / dim.h - spec.ratio) > spec.tol)
        problems.push(`${pid} ${spec.what}: 비율 ${dim.w}×${dim.h} — 규격은 ${spec.ideal} (${spec.ratio === 1 ? '1:1' : '3:4'})`);
      else if (spec.height !== undefined && dim.h !== spec.height)
        problems.push(`${pid} ${spec.what}: 세로 ${dim.h}px — 규격은 ${spec.height}px (tools/art-standee.py)`);
    }
    if (one.card) {
      // 얼굴 상자 — 카드 좌표계의 비율 [cx, cy, h]. 원형 초상은 이 상자를 2.2×h 정사각형으로 오려 만든다(4.3).
      let f = FACE_DEFAULT;
      const fc = meta && meta.card && meta.card.face, d = row.dim.card;
      if (fc && d) f = [fc.cx / d.w, fc.cy / d.h, fc.h / d.h].map(v => Math.round(v * 1000) / 1000);
      one.f = f;
    }
    if (one.s) {
      // 스탠디 앵커 — 출력 이미지 기준 0~1. 렌더러는 이 값만 읽는다(발을 코트에 놓고 몸 구간을 같은 높이로 맞춘다).
      const st = meta && meta.standee;
      if (st && st.foot && st.head) {
        // 방향은 사람이 적은 값(standee_manual.facing)이 도구 추정보다 우선한다 — 다시 만들지 않아도 바로 반영
        const man = meta.standee_manual || {};
        const facing = man.facing || st.facing;
        const dir3 = facing === 'R' ? 1 : facing === 'L' ? -1 : 0;
        one.sm = [st.foot[0], st.foot[1], st.top, st.bottom, st.head[0], st.head[1], dir3];
      } else {
        one.sm = STAND_DEFAULT.slice();
        problems.push(`${pid} 스탠디: meta.standee 가 없습니다 — python3 tools/art-standee.py --ids ${pid} --force`);
      }
    }
    // 포즈 세트(16.10): {pid}_pose_{name}.webp — 상태별 스탠디. p = {name: uri}, pm = {name: 앵커 7칸}
    const poseFiles = fs.readdirSync(dir).filter(f => new RegExp(`^${pid}_pose_([a-z]+)\\.(webp|png)$`).test(f)).sort();
    if (poseFiles.length) {
      one.p = {}; one.pm = {};
      const pm = (meta && meta.poses) || {}, man = (meta && meta.standee_manual && meta.standee_manual.poses) || {};
      for (const f of poseFiles) {
        const name = f.match(/_pose_([a-z]+)\./)[1];
        if (one.p[name]) continue;                                   // webp 가 png 보다 앞에 온다(정렬상 png 가 먼저라 뒤집는다)
        const hit = { file: path.join(dir, f), ext: path.extname(f) };
        const { uri, bytes: n, dim } = dataUri(hit);
        one.p[name] = uri; bytes += n; row.pose = (row.pose || 0) + n;
        if (dim && dim.h !== SPEC.stand.height) problems.push(`${pid} 포즈 ${name}: 세로 ${dim.h}px — 규격은 ${SPEC.stand.height}px`);
        const st = pm[name];
        if (st && st.foot && st.head) {
          const facing = (man[name] && man[name].facing) || st.facing;
          one.pm[name] = [st.foot[0], st.foot[1], st.top, st.bottom, st.head[0], st.head[1], facing === 'R' ? 1 : facing === 'L' ? -1 : 0];
        } else { one.pm[name] = STAND_DEFAULT.slice(); problems.push(`${pid} 포즈 ${name}: meta.poses 가 없습니다 — python3 tools/art-standee.py --poses --ids ${pid} --force`); }
      }
    }
    // 동작 애니메이션(16.10): {pid}_anim_{name}_{ii}.webp — a = {name: [uri...]}, am = {name: {m:[앵커...], c: 접촉 프레임}}
    const animFiles = fs.readdirSync(dir).filter(f => new RegExp(`^${pid}_anim_([a-z]+)_(\\d+)\\.webp$`).test(f)).sort();
    if (animFiles.length) {
      one.a = {}; one.am = {};
      const an = (meta && meta.anims) || {};
      for (const f of animFiles) {
        const mm = f.match(/_anim_([a-z]+)_(\d+)\.webp$/), name = mm[1];
        const { uri, bytes: n } = dataUri({ file: path.join(dir, f), ext: '.webp' });
        (one.a[name] = one.a[name] || []).push(uri); bytes += n; row.anim = (row.anim || 0) + n;
      }
      for (const name of Object.keys(one.a)) {
        const a = an[name];
        const ms = (a && a.frames || []).map(st => [st.foot[0], st.foot[1], st.top, st.bottom, st.head[0], st.head[1], st.facing === 'L' ? -1 : 1]);
        while (ms.length < one.a[name].length) ms.push(STAND_DEFAULT.slice());
        one.am[name] = { m: ms, c: a ? a.contact : Math.floor(one.a[name].length / 2) };
        if (!a) problems.push(`${pid} 동작 ${name}: meta.anims 가 없습니다 — python3 tools/art-standee.py --anims --ids ${pid} --force`);
      }
    }
    const hi = headInfo(pid, meta);
    if (hi) one.h = hi;
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
  console.log('| id | 카드 | 크기 | 전신 | 크기 | 스탠디 | 크기 | 얼굴 |');
  console.log('|---|---|---|---|---|---|---|---|');
  for (const e of entries)
    console.log(`| ${e.pid} | ${kb(e.card)} | ${dim(e.dim.card)} | ${kb(e.hero)} | ${dim(e.dim.hero)} | ${kb(e.stand)} | ${dim(e.dim.stand)} | ${(art[e.pid].f || []).join(',')} |`);
  const mb = bytes / 1024 / 1024;
  const launch = entries.filter(e => /^p\d/.test(e.pid)), pool = entries.filter(e => /^rk/.test(e.pid));
  const sum = list => list.reduce((a, e) => a + e.card + e.hero + e.stand, 0) / 1024 / 1024;
  const standN = entries.filter(e => e.stand).length, standMb = entries.reduce((a, e) => a + e.stand, 0) / 1024 / 1024;
  console.log(`\n선수 ${launch.length}명 ${sum(launch).toFixed(2)}MB · 신인 풀 ${pool.length}종 ${sum(pool).toFixed(2)}MB` +
    ` · 스탠디 ${standN}장 ${standMb.toFixed(2)}MB` +
    ` · 합계 ${mb.toFixed(2)}MB / 예산 ${ART_BUDGET_MB}MB` + (mb > ART_BUDGET_MB ? ' — **초과**' : ''));
  if (problems.length) {
    console.log(`\n## 규격 확인 — ${problems.length}건\n`);
    for (const p of problems) console.log(`- ${p}`);
    process.exit(1);
  }
  console.log('\n규격 확인: 이상 없음 ✅');
}
