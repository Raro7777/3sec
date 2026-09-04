/* 웹 앱 화면 흐름 회귀 테스트 (Playwright).
 *
 *   node web/build.mjs && node web/app-test.mjs
 *   node web/app-test.mjs --headed --slow 200
 *
 * 이 테스트가 있는 이유: 지금까지 나온 UI 버그가 전부 손으로 플레이하다 발견됐다.
 *   · 건너뛰기 해금 플래그를 아무도 저장하지 않아 영영 안 열림
 *   · 부상 치료 턴에 선택지가 모두 잠겨 육성이 진행 불가
 *   · 골드를 쓰는데 화면에 표시가 없음
 *   · 능력치 감소가 "+-6" 으로 출력
 * 전부 "화면이 특정 상태에 갇히거나, 상태가 화면에 안 드러나는" 종류다.
 * 그래서 여기서는 렌더링 픽셀이 아니라 **막다른 골목과 상태 노출**을 검사한다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.join(HERE, 'dist', 'bloom.html');
const HEADED = process.argv.includes('--headed');
const SLOW = (() => { const i = process.argv.indexOf('--slow'); return i >= 0 ? +process.argv[i + 1] : 0; })();

if (!fs.existsSync(APP)) {
  console.error('먼저 빌드하세요: node web/build.mjs');
  process.exit(1);
}
let chromium;
try { ({ chromium } = await import('playwright')); }
catch { console.error('playwright 가 필요합니다: npm i -D playwright'); process.exit(1); }

const CHROME = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium/chrome']
  .find(p => fs.existsSync(p));

// ---------------------------------------------------------------- 하네스
const results = [];
let page, browser, jsErrors = [];

function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: detail || '' });
  if (!ok) console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`);
}
async function tap(sel, ms = 260) {
  const el = await page.$(sel);
  if (!el) return false;
  if (await el.isDisabled().catch(() => false)) return false;
  await el.click();
  await page.waitForTimeout(ms);
  return true;
}
const count = sel => page.evaluate(s => document.querySelectorAll(s).length, sel);
const text = async sel => (await page.textContent(sel).catch(() => '')) || '';
const viewText = () => page.evaluate(() => document.getElementById('view').textContent || '');
/** 지금 화면에 누를 수 있는 것이 하나라도 있는가 — 막다른 골목 검사 */
const hasWayForward = () => page.evaluate(() =>
  [...document.querySelectorAll('#view button, #view [data-go], #view [data-act], .nav button')]
    .some(b => !b.disabled));

// ---------------------------------------------------------------- 실행
browser = await chromium.launch({ headless: !HEADED, slowMo: SLOW, ...(CHROME ? { executablePath: CHROME } : {}) });
page = await browser.newPage({ viewport: { width: 390, height: 844 } });
page.on('pageerror', e => jsErrors.push(e.message));
page.on('console', m => { if (m.type() === 'error' && !/net::ERR/.test(m.text())) jsErrors.push('console: ' + m.text()); });
await page.goto('file://' + APP);
await page.waitForTimeout(700);

// --- 1. 첫 실행
check('첫 화면이 뜬다', (await viewText()).length > 20);
check('시작 티켓이 표시된다', +(await text('#rTickets')) > 0, '티켓 ' + await text('#rTickets'));
check('골드가 화면에 있다', (await count('#rGold')) === 1);

// --- 2. 스카우트
await tap('[data-tab="scout"]');
const gold0 = +(await text('#rGold'));
check('지정 스카우트 비용이 표시된다', (await viewText()).includes('골드 ' + gold0) || /골드\s*\d/.test(await viewText()));
await tap('[data-act="scout"]', 400);
check('스카우트 결과가 나온다', (await viewText()).includes('이 선수 키우기'));
await tap('[data-act="scout10"]', 700);
check('10연 결과가 나온다', (await viewText()).includes('10연속 결과'));

// 지정 스카우트: 골드가 실제로 줄어드는가
const goldBefore = +(await text('#rGold'));
const didPos = await tap('[data-scoutpos="1"]', 400);
if (didPos) {
  const goldAfter = +(await text('#rGold'));
  check('지정 스카우트가 골드를 소비한다', goldAfter < goldBefore, `${goldBefore} → ${goldAfter}`);
} else {
  check('골드 부족 시 지정 스카우트가 잠긴다', goldBefore < 1200, '보유 ' + goldBefore);
}

// --- 3. 육성 한 바퀴 (부상 턴 포함해 끝까지 진행되는지)
await tap('[data-tab="train"]');
check('육성할 카드가 있다', (await count('[data-pick]')) > 0);
await tap('[data-pick]', 400);
if (await page.$('[data-act="startcamp"]')) await tap('[data-act="startcamp"]', 350);

let turns = 0, stuck = false;
for (let i = 0; i < 60; i++) {
  if ((await viewText()).includes('졸업')) break;
  const moved = await tap('[data-choice]', 130);
  if (!moved) {
    // 선택지가 없다 = 막다른 골목. 부상 치료 턴 소프트락이 이 검사에 걸린다.
    if (!(await viewText()).includes('졸업')) { stuck = true; break; }
  } else turns++;
}
check('캠프가 막히지 않고 끝까지 간다', !stuck, stuck ? `${turns}턴에서 진행 불가` : `${turns}턴 진행`);
check('졸업 화면이 나온다', (await viewText()).includes('졸업'));
check('졸업 능력치 부호가 올바르다', !(await viewText()).includes('+-'), '"+-6" 형태 금지');

// --- 4. 로스터 · 선수 상세
await tap('[data-tab="roster"]', 350);
check('로스터에 졸업생이 있다', (await count('[data-detail]')) > 0);
await tap('[data-detail]', 400);
const detail = await viewText();
check('선수 상세가 열린다', detail.includes('OVR') && detail.includes('능력치'));
check('상세에도 잘못된 부호가 없다', !detail.includes('+-'));

// --- 5. 리그 시즌
await tap('[data-tab="match"]', 350);
await tap('[data-act="startseason"]', 500);
check('시즌이 시작된다', (await viewText()).includes('SEASON'));
check('리그 서브탭이 3개다', (await count('[data-ltab]')) === 3);
for (const t of ['sched', 'stats', 'now']) {
  await tap(`[data-ltab="${t}"]`, 300);
  check(`리그 탭(${t})이 내용을 그린다`, (await viewText()).length > 60);
}

// --- 6. 매치데이 → 경기 뷰어 → 건너뛰기 해금
await tap('[data-act="advance"]', 200);
// 경기 뷰어는 시뮬 시간이 들쭉날쭉하므로 고정 대기 대신 캔버스를 기다린다.
// 30초로 넉넉히 잡는다 — art-test 와 연달아 돌리면 브라우저 두 개가 겹쳐 15초를 넘긴 적이 있다.
const inMatch = await page.waitForSelector('#lvCanvas', { timeout: 30000 }).then(() => true, () => false);
await page.waitForTimeout(300);
check('경기 뷰어가 뜬다', inMatch);
if (inMatch) {
  check('처음에는 건너뛰기가 잠겨 있다', (await count('[data-mv="skipset"]')) === 0);
  const sp = await page.$('[data-mv="speed"]');
  if (sp) { await sp.click(); await page.waitForTimeout(100); await sp.click(); await page.waitForTimeout(120); }
  check('속도를 4배까지 올릴 수 있다', (await text('[data-mv="speed"]')).includes('4'));

  let unlocked = false;
  for (let i = 0; i < 260; i++) {                  // 1세트가 끝나면 열려야 한다
    await page.waitForTimeout(500);
    if ((await count('[data-mv="skipset"]')) > 0) { unlocked = true; break; }
    if ((await count('#lvCanvas')) === 0) break;   // 경기가 먼저 끝난 경우
  }
  check('1세트 뒤 건너뛰기가 열린다', unlocked);
  check('해금이 저장된다', unlocked && (await page.evaluate(() => localStorage.getItem('bloom-skip-unlocked-v1'))) === '1');
  if (unlocked) await tap('[data-mv="end"]', 700);
}
await page.waitForFunction(() => {
  const t = document.getElementById('view').textContent || '';
  return t.includes('승리') || t.includes('패배');
}, { timeout: 20000 }).catch(() => {});
const res = await viewText();
check('경기 결과가 나온다', res.includes('승리') || res.includes('패배'));
check('박스스코어가 있다', res.includes('우리 팀 기록'));

// --- 7. 저장 · 복원
const before = await page.evaluate(() => ({
  tickets: document.getElementById('rTickets').textContent,
  save: localStorage.getItem('bloom-manager-save-v1'),
}));
check('진행이 저장된다', !!before.save && before.save.length > 20);
await page.reload();
await page.waitForTimeout(800);
check('새로고침 후 재화가 유지된다', (await text('#rTickets')) === before.tickets,
  `${before.tickets} → ${await text('#rTickets')}`);
check('새로고침 후에도 리그가 살아 있다', (await viewText()).length > 20);

// --- 8. 전역 조건
check('가로 스크롤이 없다', await page.evaluate(() =>
  document.documentElement.scrollWidth <= document.documentElement.clientWidth));
check('모든 화면에 다음 행동이 있다', await hasWayForward());
check('자바스크립트 오류가 없다', jsErrors.length === 0, jsErrors.slice(0, 2).join(' | '));

await browser.close();

// ---------------------------------------------------------------- 결과
const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} 통과` + (failed.length ? ` · ${failed.length} 실패` : ' ✅'));
if (failed.length) {
  for (const f of failed) console.log(`  ✗ ${f.name}${f.detail ? ' — ' + f.detail : ''}`);
  process.exit(1);
}
