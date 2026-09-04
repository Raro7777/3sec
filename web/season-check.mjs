// 리그 시즌·경제 난이도 검증 하네스 (헤드리스, node web/season-check.mjs).
// docs/league-and-economy.md A.4.1(난이도 목표)·B.3(경제 루프)·D.1(E1~E7) 을 실제 엔진으로 재측정한다.
// 경제 시뮬(tools/economy-sim/economy_sim.py)은 승률 로지스틱 근사였고, 여기서는 진짜 MatchSimulator 가 돈다.
//
//   node web/season-check.mjs                 기본 n=200 · 3시즌 · seed 1
//   node web/season-check.mjs --n 400         표본 확대
//   node web/season-check.mjs --seasons 5     시즌 5까지(사다리 고원 확인)
//   node web/season-check.mjs --long          장기(시즌 1~8) 목표까지 검증 — 기본 실행에는 포함되지 않는다
//                                             권장: node web/season-check.mjs --long --n 120  (약 60초)
//   node web/season-check.mjs --eval sim      육성 평가전을 실제 시뮬로(느림, 정합 확인용)
//   node web/season-check.mjs --json          기계 판독용 출력
// 종료 코드 0 = 전 목표 충족.

import * as E from './engine.js';
import { POLICIES } from './engine/training.js';

// ---------------------------------------------------------------- 인자
const argv = process.argv.slice(2);
function arg(name, dflt) {
  const i = argv.indexOf('--' + name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : dflt;
}
const N = parseInt(arg('n', '200'), 10);
/** --long = 장기 시즌 목표(A.4.4) 검증. 기본 실행은 3시즌만 돌려 빠르게 유지한다. */
const LONG = argv.includes('--long');
const LONG_SEASONS = 8;
const SEASONS = Math.max(parseInt(arg('seasons', LONG ? String(LONG_SEASONS) : '3'), 10), LONG ? LONG_SEASONS : 1);
const BASE_SEED = parseInt(arg('seed', '1'), 10);
const EVAL = arg('eval', 'stub');          // stub = 육성 평가전 근사(빠름) / sim = 실제 경기
const AS_JSON = argv.includes('--json');
const VERBOSE = argv.includes('--verbose');

// ---------------------------------------------------------------- 참조
const CARD_BY_ID = new Map(E.CARD_POOL.map(p => [p.id, p]));
const POS_CODE = E.POS_CODES;                       // ['S','OH','OP','MB','L']
const SLOT_NEED = { S: 1, OH: 2, OP: 1, MB: 2, L: 1 };  // 라인업 5-1 (A.3.2)
const RETRAIN_MAX = 3;                                  // economy_sim DEFAULT_CFG.retrain_max

// ---------------------------------------------------------------- 자동 플레이어 정책
// economy_sim.py 의 "smart" 정책과 같은 우선순위:
//   스카우트: 미보유 포지션 → 지정, 시즌 2+ 는 라인업의 R 슬롯 업그레이드 → 지정, 아니면 일반
//   육성: 미육성 카드(구멍 포지션·고희귀도 우선) → 없으면 재육성(한계돌파 진척 우선, 카드당 3회까지)
/** 은퇴한 카드는 더 이상 코트에 못 서므로 보유 카드로 세지 않는다 (A.3.6). */
function playable(g, cid) {
  const c = CARD_BY_ID.get(cid);
  return !!c && !E.isCardRetired(g, c);
}

function ownedCoverage(g) {
  const cover = { S: 0, OH: 0, OP: 0, MB: 0, L: 0 };
  for (const cid of Object.keys(g.ownedCards)) {
    const c = CARD_BY_ID.get(cid);
    if (c && playable(g, cid)) cover[POS_CODE[c.pos]]++;
  }
  return cover;
}

function uncoveredPosition(g) {
  const cover = ownedCoverage(g);
  for (const p of ['S', 'OP', 'L', 'OH', 'MB']) if (cover[p] < SLOT_NEED[p]) return p;
  return null;
}

/** 라인업에 아직 R 등급(또는 연습생)이 앉아 있는 포지션 — 시즌 2+ 업그레이드 대상. */
function upgradePosition(g) {
  const ts = E.myTeamState(g);
  for (const id of ts.lineup.startingIds.concat([ts.lineup.liberoId])) {
    const p = ts.index.get(id);
    if (!p) continue;
    if (p.rarity <= E.RARITY.R) return POS_CODE[p.pos];
  }
  return null;
}

function scoutPhase(g) {
  let guard = 0;
  // 스카우트 중에는 라인업이 바뀌지 않으므로 업그레이드 대상은 한 번만 계산한다(하네스 속도).
  const upgrade = g.season >= 2 ? upgradePosition(g) : null;
  while (g.tickets > 0) {
    if (++guard > 200) break;
    const target = uncoveredPosition(g) || upgrade;
    if (target !== null && E.canScout(g, { position: target })) E.scout(g, { position: target });
    else E.scout(g);
  }
}

function lineupHolePositions(g) {
  const ts = E.myTeamState(g);
  const holes = new Set();
  for (const id of ts.lineup.startingIds.concat([ts.lineup.liberoId])) {
    const p = ts.index.get(id);
    if (p && !isRealCard(p.id)) holes.add(POS_CODE[p.pos]);
  }
  return holes;
}
function isRealCard(playerId) { return String(playerId).indexOf('#') >= 0; }

function pickTrainee(g, runs) {
  const holes = lineupHolePositions(g);
  const owned = Object.keys(g.ownedCards).filter(cid => playable(g, cid));
  const trained = new Set(g.instances.map(i => i.cardId));
  const untrained = owned.filter(cid => !trained.has(cid));
  if (untrained.length > 0) {
    untrained.sort((a, b) => {
      const ca = CARD_BY_ID.get(a), cb = CARD_BY_ID.get(b);
      const ha = holes.has(POS_CODE[ca.pos]) ? 1 : 0, hb = holes.has(POS_CODE[cb.pos]) ? 1 : 0;
      if (ha !== hb) return hb - ha;
      if (ca.rarity !== cb.rarity) return cb.rarity - ca.rarity;
      return a < b ? -1 : 1;
    });
    return untrained[0];
  }
  // 재육성: 한계돌파 단계가 오른 카드(잠재력 상승) 우선, 카드당 RETRAIN_MAX 회까지
  const cands = owned.filter(cid => (runs.get(cid) || 0) < RETRAIN_MAX);
  if (cands.length === 0) return null;
  cands.sort((a, b) => {
    const la = g.ownedCards[a] | 0, lb = g.ownedCards[b] | 0;
    if (la !== lb) return lb - la;
    const ca = CARD_BY_ID.get(a), cb = CARD_BY_ID.get(b);
    if (ca.rarity !== cb.rarity) return cb.rarity - ca.rarity;
    return (runs.get(a) || 0) - (runs.get(b) || 0);
  });
  return cands[0];
}

function trainPhase(g, runs) {
  let guard = 0;
  while (E.canTrain(g)) {
    if (++guard > 20) break;
    const cid = pickTrainee(g, runs);
    if (cid === null) { E.skipTrainingSlot(g); break; }
    runs.set(cid, (runs.get(cid) || 0) + 1);
    const s = E.startTraining(g, cid, E.recommendSupporters(g, cid));
    let steps = 0;
    while (s.phase !== 2) {
      if (++steps > 200) throw new Error('육성 세션이 끝나지 않습니다');
      if (s.phase === 0) s.apply(POLICIES.optimal.choose(s));
      else s.resolveEvent(s.pendingEvent.oracleChoice);
    }
    E.graduate(s, 0);
  }
}

/** 이 시즌 기준의 노화 지표 — 라인업 평균 나이 · 하락기 슬롯 수 · 은퇴 인스턴스 · 스카우트 풀 크기. */
function ageMetrics(g, season) {
  const save = g.season;
  g.season = season;
  try {
    const ts = E.myTeamState(g);
    let ageSum = 0, n = 0, declining = 0;
    for (const id of ts.lineup.startingIds.concat([ts.lineup.liberoId])) {
      const p = ts.index.get(id);
      if (!p) continue;
      ageSum += p.age; n++;
      if (p.ageFactor !== undefined && p.ageFactor < 1) declining++;   // agedPlayer 가 하락기에만 붙인다
    }
    return {
      lineupAge: n ? ageSum / n : 0,
      declining,
      retired: E.retiredRepresentatives(g).length,
      poolLeft: E.activeCardPool(g).length,
    };
  } finally { g.season = save; }
}

// ---------------------------------------------------------------- 1회 플레이(시즌 1..SEASONS)
function playRun(seed) {
  const g = E.createGame({ seed, evaluation: EVAL });
  const runs = new Map();
  const out = { seasons: [], firstTitle: null, firstFinal4: null, firstWinTrainings: null, firstWinMatchday: null, lineupFullSeason: null };

  for (let n = 1; n <= SEASONS; n++) {
    E.startSeason(g);
    const scoutsBefore = g.scoutCount, trainBefore = g.trainingCount;
    const ticketsBefore = g.tickets, goldBefore = g.gold;
    let minTickets = g.tickets;

    scoutPhase(g);
    trainPhase(g, runs);
    E.autoLineup(g);

    for (let md = 1; md <= E.SEASON_CONFIG.matchdays; md++) {
      const r = E.advanceMatchday(g, { collectEvents: false });
      if (r.myMatch && r.myMatch.won && out.firstWinTrainings === null) {
        out.firstWinTrainings = g.trainingCount;
        out.firstWinMatchday = md;
      }
      if (!r.seasonEnded) {
        scoutPhase(g);
        trainPhase(g, runs);
        E.autoLineup(g);
        if (g.tickets < minTickets) minTickets = g.tickets;
      }
    }
    E.autoFinishPlayoff(g);
    const st = E.finishSeason(g);
    if (st.playoffEntered && out.firstFinal4 === null) out.firstFinal4 = n;
    if (st.isChampion && out.firstTitle === null) out.firstTitle = n;

    const holes = lineupHolePositions(g).size;
    if (holes === 0 && out.lineupFullSeason === null) out.lineupFullSeason = n;

    out.seasons.push({
      season: n, rank: st.rank, wins: st.myStats.wins, losses: st.myStats.losses,
      points: st.myStats.points, champion: st.isChampion, po: st.playoffEntered, poWins: st.playoffWins,
      scouts: g.scoutCount - scoutsBefore, trainings: g.trainingCount - trainBefore,
      lineupOvr: st.myStats.lineupOvr, holes,
      ticketsIn: g.tickets - ticketsBefore + (g.scoutCount - scoutsBefore), // 소비분 되더한 유입 근사
      goldEnd: g.gold, ticketsEnd: g.tickets, minTickets,
      ssr: Object.keys(g.ownedCards).filter(c => CARD_BY_ID.get(c) && CARD_BY_ID.get(c).rarity === E.RARITY.SSR).length,
      sr: Object.keys(g.ownedCards).filter(c => CARD_BY_ID.get(c) && CARD_BY_ID.get(c).rarity === E.RARITY.SR).length,
      // A.3.6 노화 — finishSeason 이 state.season 을 +1 한 뒤라 이 시즌 기준으로 되돌려 잰다
      ...ageMetrics(g, n),
    });
  }
  return out;
}

// ---------------------------------------------------------------- 통계 헬퍼
const mean = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const pctl = (a, p) => {
  if (!a.length) return NaN;
  const s = a.slice().sort((x, y) => x - y);
  const k = (s.length - 1) * p, f = Math.floor(k), c = Math.ceil(k);
  return f === c ? s[f] : s[f] + (s[c] - s[f]) * (k - f);
};

// ---------------------------------------------------------------- 실행
const t0 = performance.now();
const runsOut = [];
for (let i = 0; i < N; i++) runsOut.push(playRun(BASE_SEED * 1000003 + i * 7919 + 17));
const simMs = performance.now() - t0;

const byS = n => runsOut.map(r => r.seasons[n - 1]).filter(Boolean);
const s1 = byS(1);
const winRate1 = mean(s1.map(r => r.wins / E.SEASON_CONFIG.matchesPerTeam));
const rank1 = mean(s1.map(r => r.rank));
const title1 = mean(s1.map(r => (r.champion ? 1 : 0)));
const titleBy3 = mean(runsOut.map(r => (r.firstTitle !== null && r.firstTitle <= Math.min(3, SEASONS) ? 1 : 0)));
const titleS23 = mean(runsOut.map(r => (r.firstTitle !== null && r.firstTitle >= 2 && r.firstTitle <= 3 ? 1 : 0)));
const firstWinTr = runsOut.map(r => r.firstWinTrainings).filter(v => v !== null);
const scouts1 = mean(s1.map(r => r.scouts));
const full3 = mean(runsOut.map(r => (r.lineupFullSeason !== null && r.lineupFullSeason <= Math.min(3, SEASONS) ? 1 : 0)));

// ---------------------------------------------------------------- 목표 판정
const targets = [];
function T(label, value, lo, hi, fmt, note) {
  const ok = (lo === null || value >= lo - 1e-9) && (hi === null || value <= hi + 1e-9);
  targets.push({ label, value, lo, hi, ok, text: fmt(value), note: note || '' });
  return ok;
}
const p = v => (v * 100).toFixed(1) + '%';
T('시즌 1 정규 승률', winRate1, 0.40, 0.50, p);
T('시즌 1 최종 순위(평균)', rank1, 4.0, 5.0, v => v.toFixed(2) + '위');
T('시즌 1 우승률', title1, null, 0.20, p);
T('첫 우승 시즌 2~3 누적', titleS23 + (SEASONS >= 3 ? 0 : NaN), 0.50, null, p, '시즌 2·3 에 첫 우승');
T('첫 승리까지 육성 횟수(p50)', pctl(firstWinTr, 0.5), 4, 8, v => v.toFixed(1) + '회');
T('시즌 1 스카우트 횟수', scouts1, 10, 16, v => v.toFixed(1) + '회');
T('3시즌 내 라인업 7슬롯 정식 카드', full3, 0.80, null, p);

// ---------------------------------------------------------------- 장기 시즌 목표 (A.4.4) — --long 에서만
const longTargets = [];
if (LONG) {
  const title = n => mean(byS(n).map(r => (r.champion ? 1 : 0)));
  const win = n => mean(byS(n).map(r => r.wins / E.SEASON_CONFIG.matchesPerTeam));
  const rank = n => mean(byS(n).map(r => r.rank));
  const gold = n => mean(byS(n).map(r => r.goldEnd));
  const late = [4, 5, 6, 7, 8];
  const titles = late.map(title);

  // ① 시즌 4~8 은 고원 — 각 시즌 40~70%
  T(`시즌 4~8 우승률 최솟값`, Math.min(...titles), 0.40, null, p, `S${late[titles.indexOf(Math.min(...titles))]}`);
  T(`시즌 4~8 우승률 최댓값`, Math.max(...titles), null, 0.70, p, `S${late[titles.indexOf(Math.max(...titles))]}`);
  // ② 종점이 정점이 아니다(단조 증가 금지)
  T('시즌 8 우승률', title(8), null, 0.75, p);
  targets.push({
    label: '시즌 4~8 우승률이 단조 증가하지 않는다', value: NaN, lo: null, hi: null,
    ok: !(titles[0] < titles[1] && titles[1] < titles[2] && titles[2] < titles[3] && titles[3] < titles[4]),
    text: titles.map(v => (v * 100).toFixed(0) + '%').join(' → '), note: '고원',
  });
  // ③ 시즌 5 이후 압도 금지
  const w5 = Math.max(...[5, 6, 7, 8].map(win));
  T('시즌 5~8 정규 승률 최댓값', w5, null, 0.85, p);
  const r5 = Math.min(...[5, 6, 7, 8].map(rank));
  T('시즌 5~8 평균 순위 최솟값', r5, 1.30, null, v => v.toFixed(2) + '위');
  // ④ 골드가 무한 축적되지 않는다 — 종반 잔액이 중반 정점을 넘지 않을 것
  targets.push({
    label: '골드 잔액이 무한 축적되지 않는다 (시즌 8 ≤ 시즌 4)', value: gold(8), lo: null, hi: null,
    ok: gold(8) <= gold(4),
    text: `S4 ${gold(4).toFixed(0)} → S8 ${gold(8).toFixed(0)}`, note: '',
  });
  for (let i = targets.length - 8; i < targets.length; i++) if (targets[i]) longTargets.push(targets[i]);
}

const failures = targets.filter(t => !t.ok).length;

// ---------------------------------------------------------------- 성능 측정
function perfCheck() {
  const g = E.createGame({ seed: 20260903, evaluation: 'stub' });
  E.startSeason(g);
  scoutPhase(g);
  trainPhase(g, new Map());
  E.autoLineup(g);
  E.advanceMatchday(g, { collectEvents: false });   // 워밍업 1회
  const g2 = E.createGame({ seed: 20260904, evaluation: 'stub' });
  E.startSeason(g2);
  scoutPhase(g2); trainPhase(g2, new Map()); E.autoLineup(g2);
  const t = performance.now();
  for (let md = 1; md <= E.SEASON_CONFIG.matchdays; md++) E.advanceMatchday(g2, { collectEvents: false });
  const auto14 = performance.now() - t;
  // 실제 UI 매치데이 1회: 내 경기 이벤트 포함 + 자동 2경기
  const g3 = E.createGame({ seed: 20260905, evaluation: 'stub' });
  E.startSeason(g3); scoutPhase(g3); trainPhase(g3, new Map()); E.autoLineup(g3);
  let one = 0, cnt = 0;
  for (let md = 1; md <= E.SEASON_CONFIG.matchdays; md++) {
    const a = performance.now();
    E.advanceMatchday(g3, { collectEvents: true });
    one += performance.now() - a; cnt++;
  }
  return { auto14, one: one / cnt };
}
const perf = perfCheck();

// ---------------------------------------------------------------- 저장/불러오기 · 결정성 검사
const invariants = [];
function must(label, ok, note) { invariants.push({ label, ok, note: note || '' }); }
{
  // 일정 성립 (A.1.1)
  let schedOk = true, detail = '';
  for (let s = 1; s <= 50; s++) {
    const sc = E.buildSchedule(7, s * 7919 + 13);
    const played = Array(7).fill(0), home = Array(7).fill(0), byes = Array(7).fill(0);
    const pair = new Set();
    if (sc.length !== 14) { schedOk = false; detail = '매치데이 ' + sc.length; break; }
    for (const rd of sc) {
      if (rd.length !== 3) { schedOk = false; detail = '경기 수 ' + rd.length; break; }
      const seen = new Set();
      for (const f of rd) { played[f.h]++; played[f.a]++; home[f.h]++; seen.add(f.h); seen.add(f.a); pair.add(f.h + '>' + f.a); }
      for (let t = 0; t < 7; t++) if (!seen.has(t)) byes[t]++;
    }
    for (let t = 0; t < 7; t++) {
      if (played[t] !== 12 || home[t] !== 6 || byes[t] !== 2) { schedOk = false; detail = `팀${t} ${played[t]}경기 홈${home[t]} bye${byes[t]}`; break; }
    }
    if (pair.size !== 42) { schedOk = false; detail = '대진 ' + pair.size; }
    if (!schedOk) break;
  }
  must('일정: 14 매치데이 × 3경기 · 팀당 12경기(홈6/원정6) · bye 2회 · 42 유일 대진', schedOk, detail);

  // 결정성: 같은 시드 = 같은 시즌
  const sig = (seed) => {
    const g = E.createGame({ seed, evaluation: 'stub' });
    E.startSeason(g); scoutPhase(g); trainPhase(g, new Map()); E.autoLineup(g);
    for (let md = 1; md <= 14; md++) { E.advanceMatchday(g, { collectEvents: false }); if (md < 14) { scoutPhase(g); trainPhase(g, new Map()); E.autoLineup(g); } }
    E.autoFinishPlayoff(g);
    const st = E.finishSeason(g);
    return JSON.stringify(E.standings(g).map(r => [r.teamId, r.points, r.wins, r.setsFor])) + '|' + st.rank + '|' + st.champion;
  };
  must('결정성: 같은 시드 → 같은 순위표·우승팀', sig(31337) === sig(31337));
  must('결정성: 다른 시드 → 다른 결과', sig(31337) !== sig(31338));

  // 저장/불러오기 (시즌 중간)
  const g = E.createGame({ seed: 777, evaluation: 'stub' });
  E.startSeason(g); scoutPhase(g); trainPhase(g, new Map()); E.autoLineup(g);
  for (let md = 1; md <= 6; md++) { E.advanceMatchday(g, { collectEvents: false }); scoutPhase(g); trainPhase(g, new Map()); E.autoLineup(g); }
  const saved = JSON.parse(JSON.stringify(E.saveGame(g)));
  const g2 = E.loadGame(saved);
  const same = JSON.stringify(E.standings(g)) === JSON.stringify(E.standings(g2))
    && JSON.stringify(E.schedule(g)) === JSON.stringify(E.schedule(g2))
    && E.seasonView(g).trainingsLeft === E.seasonView(g2).trainingsLeft
    && g.gold === g2.gold && g.tickets === g2.tickets;
  must('저장→복원: 순위표·일정·지갑·육성 슬롯 일치', same);
  const a = E.advanceMatchday(g, { collectEvents: false });
  const b = E.advanceMatchday(g2, { collectEvents: false });
  must('저장→복원 후 다음 매치데이 재현', JSON.stringify(a.standings) === JSON.stringify(b.standings));

  // 구 세이브(시즌 없음) 마이그레이션
  const old = E.createGame({ seed: 4242 });
  for (let i = 0; i < 3; i++) E.scout(old);
  const oldSave = E.saveGame(old);
  delete oldSave.lg; delete oldSave.lh; delete oldSave.cr; delete oldSave.gd; delete oldSave.ms;
  const migrated = E.loadGame(JSON.parse(JSON.stringify(oldSave)));
  const migOk = migrated.league === null && migrated.gold === E.ECONOMY.initialGold
    && E.seasonView(migrated) === null && migrated.instances.length === old.instances.length;
  must('구 세이브(시즌 없음) 마이그레이션 — 골드 초기 지급 · 시즌 null', migOk);
  E.startSeason(migrated);
  must('마이그레이션 세이브에서 시즌 시작 가능', E.seasonView(migrated).totalMatchdays === 14);

  // 노화·은퇴 (A.3.6)
  {
    const gAge = E.createGame({ seed: 2026, evaluation: 'stub' });
    // 나이는 저장하지 않고 파생한다: 카드 나이 + (시즌 − 1)
    const anyCard = E.CARD_POOL[0];
    must('노화: 나이 = 카드 나이 + (시즌 − 1)',
      E.ageAt(anyCard.age, 1) === anyCard.age && E.ageAt(anyCard.age, 5) === anyCard.age + 4);
    // 시즌 1~3 에는 은퇴자가 없다 — 시즌 1 에 뽑아 키운 선수는 최소 3시즌 주전으로 뛴다
    let retiredBy3 = 0;
    for (let n = 1; n <= 3; n++) { gAge.season = n; retiredBy3 += 42 - E.activeCardPool(gAge).length; }
    must('노화: 시즌 1~3 에는 은퇴 선수가 없다 (초반 경험 보호)', retiredBy3 === 0, `은퇴 ${retiredBy3}명`);
    // 사다리 자체는 그대로 — 결원·은퇴가 없을 때 AI 구단 평균 OVR 은 A.3.1 표와 같다
    const ladderOvr = (n) => {
      gAge.season = n;
      const v = E.CLUBS.map(c => {
        const ts = E.clubTeamState(gAge, c.id);
        let sum = 0, k = 0;
        for (const id of ts.lineup.startingIds.concat([ts.lineup.liberoId])) {
          const pl = ts.index.get(id);
          if (!pl) continue;
          sum += E.ovrOf(E.DEFAULT_TRAINING_CONFIG, pl.stats, pl.pos); k++;
        }
        return sum / k;
      });
      return v.reduce((a, b) => a + b, 0) / v.length;
    };
    const l1 = ladderOvr(1), l3 = ladderOvr(3), l8 = ladderOvr(8);
    gAge.season = 1;
    must('노화: 사다리 유지 — 결원 없을 때 AI 평균 OVR S1 68.7 · S3 73.6 · S8 74.9(상한)',
      Math.abs(l1 - 68.73) < 0.15 && Math.abs(l3 - 73.60) < 0.15 && Math.abs(l8 - 74.91) < 0.30,
      `${l1.toFixed(2)} / ${l3.toFixed(2)} / ${l8.toFixed(2)}`);
    // 은퇴 선수는 코트에 서지 못하지만 서포터(코치)로는 남는다
    must('노화: 하락 배수는 전성기 안에서 1.0, 이후 단조 감소',
      E.ageFactor(20, 1, 1) === 1 && E.ageFactor(24, 1, 5) < E.ageFactor(24, 1, 4));
  }

  // 승점 규칙 (A.1.2)
  const mp = E.matchPoints;
  must('승점: 3-0/3-1 승 3점 · 패 0점', mp(3, 0).win === 3 && mp(3, 1).lose === 0);
  must('승점: 3-2 승 2점 · 패 1점', mp(3, 2).win === 2 && mp(3, 2).lose === 1);

  // 포지션 지정 스카우트 골드 게이팅 (B.2.1)
  const gg = E.createGame({ seed: 99 });
  gg.gold = 0;
  must('골드 부족 시 지정 스카우트 차단', !E.canScout(gg, { position: 'S' }) && E.canScout(gg));
  gg.gold = E.ECONOMY.positionScoutGold;
  const before = gg.gold;
  E.scout(gg, { position: 'S' });
  must('지정 스카우트 = 티켓 1 + 골드 1,200 차감', gg.gold === before - E.ECONOMY.positionScoutGold);
}
const invFail = invariants.filter(i => !i.ok).length;

// ---------------------------------------------------------------- 출력
if (AS_JSON) {
  console.log(JSON.stringify({ n: N, seasons: SEASONS, targets, invariants, perf, simMs }, null, 2));
} else {
  console.log(`# season-check — n=${N} · 시즌 1~${SEASONS} · seed ${BASE_SEED} · 육성 평가전 ${EVAL}\n`);
  console.log('## 난이도 목표 (docs/league-and-economy.md A.4.1 · D.1)\n');
  console.log('| 항목 | 목표 | 실측 | 판정 |');
  console.log('|---|---|---|---|');
  for (const t of targets) {
    const range = t.lo !== null && t.hi !== null ? `${fmtT(t.lo, t.label)}~${fmtT(t.hi, t.label)}`
      : t.lo !== null ? `≥ ${fmtT(t.lo, t.label)}`
        : t.hi !== null ? `≤ ${fmtT(t.hi, t.label)}` : (t.note || '—');
    console.log(`| ${t.label} | ${range} | **${t.text}** | ${t.ok ? '통과' : '실패'} |`);
  }

  console.log('\n## 시즌별 지표\n');
  console.log('| 시즌 | g | 승률 | 승-패 | 승점 | 평균 순위 | 4강 | 우승 | 스카우트 | 육성 | 라인업 OVR | 연습생 슬롯 | 티켓 잔액 | 골드 잔액 |');
  console.log('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (let n = 1; n <= SEASONS; n++) {
    const rs = byS(n);
    if (!rs.length) continue;
    console.log(`| ${n} | ${(E.growthFor(n) * 100).toFixed(0)}% | ${p(mean(rs.map(r => r.wins / 12)))} | ${mean(rs.map(r => r.wins)).toFixed(1)}-${mean(rs.map(r => r.losses)).toFixed(1)} | ${mean(rs.map(r => r.points)).toFixed(1)} | ${mean(rs.map(r => r.rank)).toFixed(2)} | ${p(mean(rs.map(r => (r.po ? 1 : 0))))} | ${p(mean(rs.map(r => (r.champion ? 1 : 0))))} | ${mean(rs.map(r => r.scouts)).toFixed(1)} | ${mean(rs.map(r => r.trainings)).toFixed(1)} | ${mean(rs.map(r => r.lineupOvr)).toFixed(1)} | ${mean(rs.map(r => r.holes)).toFixed(2)} | ${mean(rs.map(r => r.ticketsEnd)).toFixed(1)} | ${mean(rs.map(r => r.goldEnd)).toFixed(0)} |`);
  }

  console.log('\n순위 분포 (%)\n');
  console.log('| 시즌 | 1위 | 2위 | 3위 | 4위 | 5위 | 6위 | 7위 |');
  console.log('|---|---|---|---|---|---|---|---|');
  for (let n = 1; n <= SEASONS; n++) {
    const rs = byS(n);
    if (!rs.length) continue;
    const d = Array(8).fill(0);
    for (const r of rs) d[r.rank]++;
    console.log(`| ${n} | ` + d.slice(1).map(v => (v / rs.length * 100).toFixed(0)).join(' | ') + ' |');
  }

  console.log('\n## 보조 지표\n');
  const line = (k, v) => console.log(`- ${k}: **${v}**`);
  line('첫 승리까지 육성 횟수', `p10 ${pctl(firstWinTr, 0.1).toFixed(0)} / p50 ${pctl(firstWinTr, 0.5).toFixed(0)} / p90 ${pctl(firstWinTr, 0.9).toFixed(0)} (무승 ${((N - firstWinTr.length) / N * 100).toFixed(1)}%)`);
  line('첫 승리 매치데이 p50', pctl(runsOut.map(r => r.firstWinMatchday).filter(v => v !== null), 0.5).toFixed(0));
  line('첫 4강 시즌 분포', [1, 2, 3, 4, 5].slice(0, SEASONS).map(n => `S${n} ${(mean(runsOut.map(r => (r.firstFinal4 === n ? 1 : 0))) * 100).toFixed(0)}%`).join(' · '));
  line('첫 우승 시즌 분포', [1, 2, 3, 4, 5].slice(0, SEASONS).map(n => `S${n} ${(mean(runsOut.map(r => (r.firstTitle === n ? 1 : 0))) * 100).toFixed(0)}%`).join(' · ') + ` · 미우승 ${(mean(runsOut.map(r => (r.firstTitle === null ? 1 : 0))) * 100).toFixed(0)}%`);
  line(`${Math.min(3, SEASONS)}시즌 내 첫 우승 누적`, p(titleBy3));
  line('라인업 7슬롯 충원 시즌 p50', pctl(runsOut.map(r => (r.lineupFullSeason === null ? SEASONS + 1 : r.lineupFullSeason)), 0.5).toFixed(1));
  line('시즌 1 티켓 잔액 최솟값(평균)', mean(s1.map(r => r.minTickets)).toFixed(2));
  line(`${SEASONS}시즌 누적 SR / SSR 보유`, `${mean(byS(SEASONS).map(r => r.sr)).toFixed(1)} / ${mean(byS(SEASONS).map(r => r.ssr)).toFixed(2)}장`);

  if (LONG) {
    console.log('\n## 노화·은퇴 (A.3.6)\n');
    console.log('| 시즌 | 라인업 평균 나이 | 하락기 슬롯(7중) | 은퇴한 대표 | 스카우트 가능 카드(42중) |');
    console.log('|---|---|---|---|---|');
    for (let n = 1; n <= SEASONS; n++) {
      const rs = byS(n);
      if (!rs.length) continue;
      console.log(`| ${n} | ${mean(rs.map(r => r.lineupAge)).toFixed(1)}세 | ${mean(rs.map(r => r.declining)).toFixed(2)} | ${mean(rs.map(r => r.retired)).toFixed(2)} | ${mean(rs.map(r => r.poolLeft)).toFixed(1)} |`);
    }
  }

  console.log('\n## 성능 (Node · x86)\n');
  console.log('| 항목 | 목표 | 실측 | 판정 |');
  console.log('|---|---|---|---|');
  console.log(`| 매치데이 1회 (내 경기 이벤트 포함 + 자동 2경기) | ≤ 100ms | **${perf.one.toFixed(1)}ms** | ${perf.one <= 100 ? '통과' : '실패'} |`);
  console.log(`| 14 매치데이 전체 자동 진행 | ≤ 300ms | **${perf.auto14.toFixed(1)}ms** | ${perf.auto14 <= 300 ? '통과' : '실패'} |`);

  console.log('\n## 규칙 불변식\n');
  console.log('| 항목 | 판정 |');
  console.log('|---|---|');
  for (const i of invariants) console.log(`| ${i.label}${i.note ? ` <sub>${i.note}</sub>` : ''} | ${i.ok ? '통과' : '실패'} |`);

  console.log(`\n시뮬 ${(simMs / 1000).toFixed(1)}초 · 전체 ${(performance.now() / 1000).toFixed(1)}초`);
  console.log(failures === 0 && invFail === 0 ? '\n결과: 전 항목 통과 ✅' : `\n결과: 목표 ${failures}개 · 불변식 ${invFail}개 실패 ❌`);
}

function fmtT(v, label) {
  if (label.indexOf('순위') >= 0) return v.toFixed(1) + '위';
  if (label.indexOf('육성 횟수') >= 0 || label.indexOf('스카우트 횟수') >= 0) return v.toFixed(0) + '회';
  return (v * 100).toFixed(0) + '%';
}

process.exit(failures === 0 && invFail === 0 ? 0 : 1);
