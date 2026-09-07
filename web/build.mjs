/* 웹 앱 빌드 — 엔진 번들 + 코트 렌더러를 app-shell.html 에 인라인해 단일 HTML 을 만든다.
 *
 *   node web/build.mjs                  → web/dist/bloom.html
 *   node web/build.mjs --out /tmp/x.html
 *
 * 아티팩트로 게시할 때 외부 스크립트를 못 쓰기 때문에 전부 인라인한다.
 * 엔진 번들은 esbuild 로 만든다(ESM 모듈 그래프를 IIFE 하나로).
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectArt, collectRig, ART_BUDGET_MB } from './art-pack.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const outPath = path.resolve(arg('out', path.join(HERE, 'dist', 'bloom.html')));
const bundlePath = path.join(path.dirname(outPath), 'engine.bundle.js');
fs.mkdirSync(path.dirname(outPath), { recursive: true });

// 1) 엔진 번들
try {
  execFileSync('npx', ['--yes', 'esbuild@0.25.0',
    path.join(HERE, 'engine.js'),
    '--bundle', '--format=iife', '--global-name=VS',
    '--outfile=' + bundlePath,
  ], { stdio: ['ignore', 'ignore', 'pipe'], cwd: ROOT });
} catch (e) {
  console.error('엔진 번들 실패 — esbuild 를 받을 수 있어야 합니다.');
  console.error(String(e.stderr || e.message).slice(0, 500));
  process.exit(1);
}

// 2) 인라인
const shell = fs.readFileSync(path.join(HERE, 'app-shell.html'), 'utf8');
if (!shell.includes('<!--ENGINE-->')) {
  console.error('app-shell.html 에 <!--ENGINE--> 자리표시자가 없습니다.');
  process.exit(1);
}
const engine = fs.readFileSync(bundlePath, 'utf8');
const court = fs.readFileSync(path.join(HERE, 'court-render.js'), 'utf8');

// 3) 아트 팩 — art/04_export 에 들어온 최종 이미지를 data: URI 로 인라인한다.
//    한 장도 없으면 빈 객체가 들어가고 앱은 지금처럼 SVG 플레이스홀더를 그린다.
//    스탠디·포즈 세트는 기본 제외(코트 그림은 리그, 16.9.2) — `--with-standee` 로 싣는다. 리그 파츠는 window.BLOOM_RIG.
const withStandee = process.argv.includes('--with-standee');
const { art, bytes: artBytes0, entries: artEntries, problems: artProblems } = collectArt({ standee: withStandee });
const { rig, bytes: rigBytes } = collectRig();
const artBytes = artBytes0 + rigBytes;
const artScript = '<script>window.BLOOM_ART=' + JSON.stringify(art) + ';window.BLOOM_RIG=' + JSON.stringify(rig) + ';</scr' + 'ipt>';

// 4) 빌드 태그 — 피드백 본문에 붙는다(어느 리비전에서 난 일인지). git 이 없으면 날짜만.
function buildTag() {
  const day = new Date().toISOString().slice(0, 10);
  try {
    const sha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    const dirty = execFileSync('git', ['status', '--porcelain', '--', 'web', 'data'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() ? '+' : '';
    return sha + dirty + ' ' + day;
  } catch { return day; }
}
const BUILD = buildTag();

const html = shell.replace('<!--ENGINE-->',
  artScript + '\n<script>\n' + engine + '\n</scr' + 'ipt>\n<script>\n' + court + '\n</scr' + 'ipt>')
  .replace("var BUILD = '__BUILD__';", 'var BUILD = ' + JSON.stringify(BUILD) + ';');

fs.writeFileSync(outPath, html);
fs.rmSync(bundlePath, { force: true });

const mb = html.length / 1024 / 1024;
const artMb = artBytes / 1024 / 1024;
console.log(`${path.relative(ROOT, outPath)}  ${(html.length / 1024).toFixed(0)}KB  [${BUILD}]` +
  (artEntries.length ? `  (아트 ${artEntries.length}명 · ${artMb.toFixed(2)}MB)` : '  (아트 없음 — SVG 플레이스홀더)'));
if (artMb > ART_BUDGET_MB)
  console.warn(`⚠ 인라인 아트 ${artMb.toFixed(2)}MB 가 예산 ${ART_BUDGET_MB}MB 를 넘었습니다 — 아티팩트 상한(16MB)에 걸립니다.`);
if (mb > 15)
  console.warn(`⚠ 산출물 ${mb.toFixed(2)}MB — 아티팩트 상한 16MB 에 근접했습니다.`);
for (const p of artProblems) console.warn('⚠ 아트 규격: ' + p);
