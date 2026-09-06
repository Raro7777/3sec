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

// --- 0. 첫 안내 · 코치 (테스터 피드백 "게임을 어떻게 하는지 모르겠다")
check('첫 실행에 안내가 뜬다', (await count('#intro .guide')) === 1);
check('안내가 목표(우승)를 말한다', (await text('#intro')).includes('우승'));
await tap('[data-act="intronext"]', 200);
check('안내 둘째 장이 세 가지 루프다', /스카우트[\s\S]*육성[\s\S]*리그/.test(await text('#intro')));
await tap('[data-act="intronext"]', 200);
check('안내 셋째 장에 시작하기가 있다', (await count('[data-act="introdone"]')) === 1);
await tap('[data-act="introdone"]', 300);
check('안내가 닫힌다', await page.$eval('#intro', el => el.hidden));
check('코치 배너가 스카우트를 가리킨다', (await text('#coach')).includes('스카우트') && (await count('.coach-target[data-go="scout"]')) === 1);
check('코치 배너 글자가 14px 이상이다', (await page.$eval('#coach', el => parseFloat(getComputedStyle(el).fontSize))) >= 14);

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
check('스카우트 결과가 실물 카드로 공개된다', (await count('.rcard')) === 1);
check('코치가 이 선수 키우기를 가리킨다', (await count('.coach-target[data-trainthis]')) === 1);
check('첫 스카우트 미션이 골드를 준다', +(await text('#rGold')) === gold0 + 50, '골드 ' + await text('#rGold'));
check('시작 티켓 5장으로는 10연이 잠긴다', await page.$eval('[data-act="scout10"]', b => b.disabled));
// 시작 티켓은 엔진 기본 5장(league-and-economy B.6.7 — 온보딩에 티켓을 더 주면 시즌 1 난이도가 무너진다).
// 10연은 조각·순위 보상이 쌓인 뒤 열리므로, 화면 검사를 위해 세이브에 티켓을 넣어 준다.
await page.evaluate(() => {
  const E = window.VS, k = 'bloom-manager-save-v1';
  const g = E.loadGame(JSON.parse(localStorage.getItem(k)));
  E.addTickets(g, 10);
  localStorage.setItem(k, JSON.stringify(E.saveGame(g)));
});
await page.reload(); await page.waitForTimeout(800);
await tap('[data-tab="scout"]', 300);
await tap('[data-act="scout10"]', 700);
check('10연 결과가 나온다', (await viewText()).includes('10연속 결과'));
check('10연 결과가 카드 10장 그리드다', (await count('.rgrid .rcard')) === 10);
// 카드를 누르면 도감 상세, 돌아오면 10연 결과가 그대로
await tap('[data-dex]', 400);
check('10연 카드가 도감 상세로 열린다', (await count('.rcard')) === 1 && (await viewText()).includes('보유'));
await tap('[data-act="dexback"]', 400);
check('도감 상세에서 스카우트 결과로 돌아온다', (await viewText()).includes('10연속 결과'));

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

let turns = 0, stuck = false, sawStoryName = false, sawEventBust = false;
const traineeName = await text('.camp-head b').catch(() => '');
check('캠프 헤더에 성격 아키타입 배지가 있다', (await count('.camp-head .tagrow .arch')) === 1);
check('캠프 헤더가 상반신 그림이다', (await count('.camp-head .bust img')) === 1);
check('캠프에 추천 표시가 하나 있다', (await count('[data-rec="1"] .rec')) === 1);
check('캠프 버튼 범례가 있다', (await viewText()).includes('적성'));
check('코치가 추천을 가리킨다', (await count('.coach-target[data-rec="1"]')) === 1);
await page.waitForTimeout(400);   // 코치가 추천 버튼까지 부드럽게 스크롤한다
check('코치가 가리키는 버튼이 화면 안에 있다', await page.evaluate(() => {
  const t = document.querySelector('.coach-target'); if (!t) return false;
  const r = t.getBoundingClientRect(); return r.top >= 0 && r.bottom <= window.innerHeight;
}));
for (let i = 0; i < 60; i++) {
  const vt = await viewText();
  if (vt.includes('졸업')) break;
  if (vt.includes('스토리 #')) {
    if (traineeName && vt.includes(traineeName)) sawStoryName = true;
    if ((await count('.evbox.vn .bust img')) > 0) sawEventBust = true;
  }
  const moved = await tap('[data-choice]', 130);
  if (!moved) {
    // 선택지가 없다 = 막다른 골목. 부상 치료 턴 소프트락이 이 검사에 걸린다.
    if (!(await viewText()).includes('졸업')) { stuck = true; break; }
  } else turns++;
}
check('캠프가 막히지 않고 끝까지 간다', !stuck, stuck ? `${turns}턴에서 진행 불가` : `${turns}턴 진행`);
check('졸업 화면이 나온다', (await viewText()).includes('졸업'));
check('코치가 경기하러 가기를 가리킨다', (await count('.coach-target[data-go="match"]')) === 1);
check('졸업 능력치 부호가 올바르다', !(await viewText()).includes('+-'), '"+-6" 형태 금지');
check('카드 스토리 컷에 선수 이름이 들어간다', sawStoryName, `이름 ${traineeName}`);
check('스토리 컷 옆에 상반신 초상이 붙는다', sawEventBust);
check('졸업 화면이 실물 카드 + 등급 도장이다', (await count('.rcard')) === 1 && /^[SABCD]$/.test((await text('.stamp')).trim()));
check('성격 양념 문장이 이름을 채운다', (await page.evaluate(() => window.VS.personalityQuip('fire', 'ace', '서하율', 0))).includes('서하율'));
check('조사 처리 — 받침에 따라 은/는', (await page.evaluate(() => window.VS.fillName('{n}은', '유청아') + '|' + window.VS.fillName('{n}은', '탁세온'))) === '유청아는|탁세온은');
// 경기 전 서사: 졸업생의 원소속 구단과 붙으면 '친정' 줄이 나온다
{
  const line = await page.evaluate(() => {
    const E = window.VS; const g = E.loadGame(JSON.parse(localStorage.getItem('bloom-manager-save-v1')));
    const rep = E.representatives(g)[0]; return rep ? (window.BLOOM_UI.matchStory(rep.clubId) || []).join(' / ') : '';
  });
  check('경기 전 서사에 친정 대결 줄이 나온다', line.includes('친정'), line);
}

// --- 4. 로스터 · 선수 상세
await tap('[data-tab="roster"]', 350);
check('로스터에 졸업생이 있다', (await count('[data-detail]')) > 0);
check('연습생 초상이 그림이다(신인 외형 풀)', (await count('.pcard .ava img')) >= 7, `img ${await count('.pcard .ava img')}`);
// 도감 — 런칭 42명 전부, 미보유는 실루엣, 보유만 필터
await tap('[data-go="album"]', 500);
check('도감이 42장을 그린다', (await count('.dex .rcard')) === 42, `${await count('.dex .rcard')}장`);
check('미보유 카드는 실루엣이다', (await count('.dex .rcard.off')) >= 20 && (await count('.dex .rcard:not(.off)')) >= 1);
await tap('[data-dexown="1"]', 350);
check('보유만 필터에 실루엣이 없다', (await count('.dex .rcard')) >= 1 && (await count('.dex .rcard.off')) === 0);
await tap('[data-dexclub="t01"]', 300);
check('구단 필터가 걸린다', (await count('.dex .rcard')) <= 7);
await tap('[data-dexclub="all"]', 200); await tap('[data-dexown="1"]', 200);
await tap('[data-go="roster"]', 350);
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
  check('경기 인트로에 양 팀 얼굴이 선다', (await count('#lvIntro.show .ava')) >= 12, `ava ${await count('#lvIntro.show .ava')}`);
  await tap('#lvIntro', 200);
  check('인트로를 탭하면 바로 시작한다', (await count('#lvIntro.show')) === 0);
  const sp = await page.$('[data-mv="speed"]');
  if (sp) { await sp.click(); await page.waitForTimeout(120); }
  // 2배속에서 컷인(득점·스킬)과 랠리 칩 초상이 한 번은 나와야 한다(4배속은 컷인을 띄우지 않는다)
  let sawCut = false, sawFace = false;
  for (let i = 0; i < 120; i++) {
    await page.waitForTimeout(200);
    if (!sawCut && (await count('#lvCut.show')) > 0) sawCut = true;
    if (!sawFace && (await count('.tch .ava img')) > 0) sawFace = true;
    if (sawCut && sawFace) break;
    if ((await count('#lvCanvas')) === 0) break;
  }
  check('득점·스킬 컷인이 뜬다', sawCut);
  check('랠리 칩에 초상이 붙는다', sawFace);
  if (sp) { await sp.click(); await page.waitForTimeout(120); }
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

// --- 8. 골드 소비처 (docs/league-and-economy.md E.5 ⑩~⑱) — 화면이 있어야 골드를 쓸 수 있다
await tap('[data-tab="home"]', 300);
check('감독실에 구단 시설 입구가 있다', (await count('[data-go="facility"]')) >= 1);
await tap('[data-go="facility"]', 400);
{
  const t = await viewText();
  check('시설 화면에 예비비와 쓸 수 있는 돈이 있다', t.includes('13,200') && t.includes('쓸 수 있는 돈'));
  check('시설 3종 카드가 있다', (await count('[data-fac]')) === 3);
  // 시작 골드(1,200)로는 한 단계도 못 산다(B.6.4) — 잠금이 아니라 버튼 비활성으로 표현된다
  const disabled = await page.evaluate(() => [...document.querySelectorAll('[data-fac]')].filter(b => b.disabled).length);
  check('골드가 모자라면 투자 버튼이 비활성이다', disabled === 3, `비활성 ${disabled}/3`);
  check('리포트 가격과 분석실 할인 안내가 있다', t.includes('900') && t.includes('5단계에서 무료'));
}
// 골드를 넣어 실제로 사 본다 — 세이브를 고쳐 다시 연다(앱에 치트가 없다)
await page.evaluate(() => { const k = 'bloom-manager-save-v1'; const j = JSON.parse(localStorage.getItem(k)); j.gd = 30000; localStorage.setItem(k, JSON.stringify(j)); });
await page.reload(); await page.waitForTimeout(800);
await tap('[data-tab="home"]', 300); await tap('[data-go="facility"]', 400);
{
  const before = await page.evaluate(() => document.getElementById('rGold').textContent);
  await tap('[data-fac="stadium"]', 400);
  const after = await page.evaluate(() => document.getElementById('rGold').textContent);
  check('시설 투자가 골드를 소비한다', before !== after, `${before} → ${after}`);
  check('투자 뒤 등급 점이 켜진다', (await viewText()).includes('2단계'));   // 다음 단계 표시가 1→2
  check('명성 배지가 붙는다', /지역|준수|명문|신생/.test(await viewText()));
  check('운영비 예고가 보인다', (await viewText()).includes('결산 운영비'));
}
await tap('[data-tab="scout"]', 300); await tap('[data-act="scout"]', 400);
check('스카우트 결과에 리포트 구매 버튼이 있다', (await count('[data-report]')) === 1);
await tap('[data-report]', 500);
{
  const t = await viewText();
  check('리포트 화면에 잠재 OVR 이 있다', t.includes('잠재 OVR'));
  check('리포트가 훈련 적성을 보여 준다', t.includes('훈련 적성'));
  check('리포트가 전력을 올린다고 말하지 않는다', !/훈련 효율|능력치가 오|강해/.test(t));
}
await tap('[data-tab="train"]', 400);
check('육성 목록에 리포트 배지가 있다', /잠재 \d|리포트/.test(await viewText()));
check('육성 목록이 졸업생을 재육성으로 표시한다', /로스터 OVR [\d.]+ [SABCD] · 재육성/.test(await viewText()));
check('육성 목록이 재육성은 초기화가 아니라고 말한다', (await viewText()).includes('초기화가 아닙니다'));
await tap('[data-tab="roster"]', 400);
check('로스터에 계약 인원 게이지가 있다', /계약 \d+\/42/.test(await viewText()));

// --- 9. 결산의 운영비·강등·투자 (E.5 ⑬·⑭)
// 시즌 하나를 화면으로 다 도는 대신 앱이 노출한 엔진(window.VS)으로 빨리 감아 결산 직전 세이브를 만든다.
// 시설 15단계(유지비 6,000)에 골드 0 → 시즌 보상으로도 못 내 미납·강등 문구까지 나와야 한다.
{
  const info = await page.evaluate(() => {
    const E = window.VS, k = 'bloom-manager-save-v1';
    const g = E.loadGame(JSON.parse(localStorage.getItem(k)));
    g.facilities = { analysis: 5, stadium: 5, hall: 5 };   // 유지비 6,000 — 시즌 보상으로도 못 낸다 → 미납·강등
    g.gold = 0;
    if (!E.lineupValid(g)) E.autoLineup(g);
    if (!g.league || g.league.phase === 'offseason') E.startSeason(g);
    for (let i = 0; i < 40; i++) { const sv = E.seasonView(g); if (sv.phase !== 'preseason' && sv.phase !== 'matchday') break; try { E.advanceMatchday(g); } catch (e) { break; } }
    try { E.autoFinishPlayoff(g); } catch (e) {}
    localStorage.setItem(k, JSON.stringify(E.saveGame(g)));
    return E.seasonView(g).phase;
  });
  await page.reload(); await page.waitForTimeout(800);
  await tap('[data-tab="match"]', 400);
  const opened = await tap('[data-act="settle"]', 600);
  const t = await viewText();
  check('빨리 감은 시즌이 결산에 닿는다', opened, `phase ${info}`);
  check('결산에 운영비 −금액 줄이 있다', t.includes('구단 운영비'));
  check('미납이면 강등을 알린다', /내려갔습니다/.test(t));
  check('결산에 구단 투자 블록이 있다', t.includes('구단에 투자'));
  await tap('[data-act="facility-settle"]', 500);
  check('결산에서 들어간 시설 화면은 결산으로 돌아간다', (await count('[data-go="settle"]')) === 1);
  await tap('[data-go="settle"]', 500);
  check('결산으로 돌아온다', (await viewText()).includes('결산'));
}

// --- 9b. 피드백 보내기 — 테스터가 어디서든 상황이 붙은 한 줄을 남길 수 있어야 한다
await tap('[data-tab="home"]', 400);
check('감독실에 피드백 보내기가 있다', (await count('[data-go="feedback"]')) >= 1);
await tap('[data-go="feedback"]', 400);
{
  await page.fill('#fbText', '경기 화면 글자가 작아요');
  await tap('[data-fbkind="art"]', 300);
  check('피드백 종류 선택이 유지된다', (await page.$eval('[data-fbkind="art"]', el => el.getAttribute('aria-current'))) === 'true');
  check('종류를 바꿔도 입력이 남는다', (await page.$eval('#fbText', el => el.value)) === '경기 화면 글자가 작아요');
  const body = await page.$eval('#fbBody', el => el.value);
  check('피드백 본문에 내용과 종류가 붙는다', body.includes('경기 화면 글자가 작아요') && body.includes('그림'));
  check('피드백 본문에 시즌·화면·빌드가 붙는다', /시즌 \d/.test(body) && body.includes('화면 감독실') && /빌드 \S+/.test(body));
  check('피드백 본문에 티켓·골드·로스터가 붙는다', /티켓 \d+ · 골드 \d+ · 로스터 \d+/.test(body));
  check('피드백 본문에 개인 정보가 없다', !/@|[0-9]{3}-[0-9]{3,4}-[0-9]{4}/.test(body));
  check('피드백 입력 글자가 16px 이상이다(iOS 확대 방지)', (await page.$eval('#fbText', el => parseFloat(getComputedStyle(el).fontSize))) >= 16);
  check('공유가 없는 기기에도 복사 버튼이 있다', (await count('[data-act="fbcopy"]')) === 1);
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
  await tap('[data-act="fbcopy"]', 500);
  check('복사 결과를 알려 준다', (await count('.toast')) >= 1);
  await tap('[data-act="fbback"]', 400);
  check('피드백에서 온 곳으로 돌아간다', (await viewText()).includes('다음 목표') || (await viewText()).includes('먼저 선수를'));
}
// 오류 기록 — 화면이 멈춘 이유를 피드백이 같이 실어야 한다
{
  await page.evaluate(() => { setTimeout(() => { throw new Error('테스트용 오류'); }, 0); });
  await page.waitForTimeout(200);
  jsErrors = jsErrors.filter(m => !m.includes('테스트용 오류'));
  const errs = await page.evaluate(() => JSON.parse(localStorage.getItem('bloom-errors-v1') || '[]'));
  check('자바스크립트 오류가 기억된다', errs.some(e => e.includes('테스트용 오류')), JSON.stringify(errs));
  await tap('[data-act="help"]', 400);
  check('도움말 끝에 피드백 링크가 있다', (await count('[data-go="feedback"]')) === 1);
  await tap('[data-go="feedback"]', 400);
  const body = await page.$eval('#fbBody', el => el.value);
  check('피드백 본문에 최근 오류가 붙는다', body.includes('최근 오류') && body.includes('테스트용 오류'));
  check('도움말에서 들어가면 화면이 도움말로 적힌다', body.includes('화면 도움말'));
  await tap('[data-act="fbback"]', 300);
}
// 코치 안내는 끌 수 있고, 도움말에서 다시 켜면 첫 안내부터 다시 나온다
{
  await page.evaluate(() => { localStorage.setItem('bloom-coach-v1', JSON.stringify({ on: true, intro: true, done: false })); });
  await page.reload(); await page.waitForTimeout(800);
  const shown = !(await page.$eval('#coach', el => el.hidden));
  if (shown) { await tap('[data-act="coachoff"]', 300); check('코치 안내를 끌 수 있다', await page.$eval('#coach', el => el.hidden)); }
  else check('가이드를 마친 저장에는 배너가 없다', true);
  await tap('[data-act="help"]', 400);
  check('도움말에 코치 안내 다시 보기가 있다', (await count('[data-act="coachon"]')) === 1);
  await tap('[data-act="coachon"]', 400);
  check('다시 보기를 누르면 첫 안내가 나온다', (await count('#intro .guide')) === 1);
  await tap('[data-act="introskip"]', 300);
  check('건너뛰기로 안내가 닫힌다', await page.$eval('#intro', el => el.hidden));
}

// --- 10. 전역 조건
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
