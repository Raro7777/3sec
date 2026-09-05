/* 지금까지 들어온 아트를 한 장에 모아 본다 — 편차 QA(art-style-guide 8.2)와 크롭 확인용.
 *
 *   node tools/art-sheet.mjs                 # art/00_guide/sheet.png
 *   node tools/art-sheet.mjs --out /tmp/x.png
 *
 * 왜 필요한가:
 *   42명을 한 명씩 보면 "다들 같은 화풍인가"를 판정할 수 없다. 나란히 놓아야 튀는 것이 보인다.
 *   그리고 **썸네일이 얼굴을 제대로 잡았는지**는 원본이 아니라 44px 로 줄인 결과에서만 드러난다.
 *   `art-import.mjs` 를 --face 없이 돌리면 4.2 권장 위치로 가정하는데, 그 가정이 맞았는지 여기서 눈으로 본다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const EXPORT = path.join(ROOT, 'art', '04_export');
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const OUT = path.resolve(arg('out', path.join(ROOT, 'art', '00_guide', 'sheet.png')));
/**
 * --grid: 카드 위에 10% 격자를 얹는다.
 *
 * 왜: `art-import.mjs` 는 얼굴 좌표(--face cx,cy,h)를 받아야 썸네일을 제대로 자른다.
 * 42장을 하나씩 열어 재는 것은 불가능하고, --face 없이 4.2 권장 위치로 가정하면 절반쯤 빗나간다.
 * 격자를 얹은 대조 시트 **한 장**에서 여러 명의 얼굴 위치를 % 로 한 번에 읽어 내기 위한 모드다.
 */
const GRID = process.argv.includes('--grid');

const players = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'players.json'), 'utf8'));
const CLUB = { t01: '가온', t02: '해솔', t03: '태령', t04: '적동', t05: '연화', t06: '라온' };
const FRAME = { N: '#6A7C8E', R: '#5B9BE0', SR: '#A97BE8', SSR: '#E9B949' };

const rows = players
  .filter(p => fs.existsSync(path.join(EXPORT, p.id, `${p.id}_card.webp`)))
  .map(p => {
    const b64 = k => 'data:image/webp;base64,' +
      fs.readFileSync(path.join(EXPORT, p.id, `${p.id}_${k}.webp`)).toString('base64');
    return { p, card: b64('card'), thumb: b64('thumb') };
  });

if (!rows.length) { console.error('들어온 아트가 없습니다.'); process.exit(1); }

const cells = rows.map(({ p, card, thumb }) => `
 <div class=c>
   <div class=cardbox style="border-color:${FRAME[p.rarity] || '#5B9BE0'}"><img src="${card}">${GRID ? '<div class=g></div>' : ''}</div>
   ${GRID ? `<div class=pid>${p.id}</div>` : ''}
   <div class=meta><div class=av><img src="${thumb}"></div>
     <div><b>${p.name}</b><span>${p.id} · ${p.position} · ${p.rarity} · ${CLUB[p.teamId] || p.teamId}</span></div></div>
 </div>`).join('');

const html = `<style>
body{margin:0;background:#0A1017;color:#E8EDF2;font:13px/1.45 system-ui,sans-serif;padding:20px}
h1{font-size:17px;margin:0 0 3px}p{color:#8A97A6;font-size:12px;margin:0 0 18px}
.grid{display:grid;grid-template-columns:repeat(6,1fr);gap:14px}
.cardbox{border:2.5px solid;border-radius:9px;overflow:hidden;aspect-ratio:3/4;position:relative}
.g{position:absolute;inset:0;
  background-image:repeating-linear-gradient(to right,rgba(255,80,80,.85) 0 1px,transparent 1px 10%),
                   repeating-linear-gradient(to bottom,rgba(80,200,255,.85) 0 1px,transparent 1px 10%)}
.pid{font:700 11px/1.2 monospace;color:#FF6B6B;margin-top:2px}
.cardbox img{width:100%;height:100%;object-fit:cover;display:block}
.meta{display:flex;align-items:center;gap:7px;margin-top:6px}
.av{width:44px;height:44px;border-radius:50%;overflow:hidden;border:2px solid #2A3644;flex:none}
.av img{width:100%;height:100%;object-fit:cover;display:block}
.meta b{display:block;font-size:12.5px}.meta span{color:#8A97A6;font-size:10.5px}
</style>
<h1>아트 대조 시트 — ${rows.length} / ${players.length}명</h1>
<p>카드(등급 프레임) · 44px 원형 초상. 초상이 얼굴을 못 잡았으면 그 카드는 --face 를 손으로 줘야 한다.</p>
<div class=grid>${cells}</div>`;

const tmp = path.join(path.dirname(OUT), '.sheet.html');
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(tmp, html);

let chromium;
try { ({ chromium } = await import('playwright')); }
catch { console.error('playwright 가 필요합니다: npm i -D playwright'); process.exit(1); }
const CHROME = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium/chrome']
  .find(p => fs.existsSync(p));
const browser = await chromium.launch({ headless: true, ...(CHROME ? { executablePath: CHROME } : {}) });
const page = await browser.newPage({ viewport: { width: 1180, height: 900 }, deviceScaleFactor: 1.5 });
await page.goto('file://' + tmp);
await page.waitForTimeout(400);
await page.screenshot({ path: OUT, fullPage: true });
await browser.close();
fs.rmSync(tmp, { force: true });
console.log(`${path.relative(ROOT, OUT)}  ${rows.length}명`);
