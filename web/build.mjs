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
const html = shell.replace('<!--ENGINE-->',
  '<script>\n' + engine + '\n</scr' + 'ipt>\n<script>\n' + court + '\n</scr' + 'ipt>');

fs.writeFileSync(outPath, html);
fs.rmSync(bundlePath, { force: true });
console.log(`${path.relative(ROOT, outPath)}  ${(html.length / 1024).toFixed(0)}KB`);
