// 리그 시즌·경제 난이도 검증 하네스 (헤드리스, node web/season-check.mjs).
// docs/league-and-economy.md A.4.1(난이도 목표)·B.3(경제 루프)·D.1(E1~E7) 을 실제 엔진으로 재측정한다.
// 경제 시뮬(tools/economy-sim/economy_sim.py)은 승률 로지스틱 근사였고, 여기서는 진짜 MatchSimulator 가 돈다.
//
//   node web/season-check.mjs                 기본 n=200 · 3시즌 · seed 1
//   node web/season-check.mjs --n 400         표본 확대
//   node web/season-check.mjs --seasons 5     시즌 5까지(사다리 고원 확인)
//   node web/season-check.mjs --long          장기(시즌 1~15) 목표 + 신인 세대·카드 풀 검증 — 기본 실행에는 포함되지 않는다
//                                             권장: node web/season-check.mjs --long --n 120  (약 2분)
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
/** 시즌 15 까지 — 신인 세대(docs/rookies.md)가 카드 풀을 붙잡아 주는지 보려면 8시즌으로는 짧다. */
const LONG_SEASONS = 15;
const SEASONS = Math.max(parseInt(arg('seasons', LONG ? String(LONG_SEASONS) : '3'), 10), LONG ? LONG_SEASONS : 1);
const BASE_SEED = parseInt(arg('seed', '1'), 10);
const EVAL = arg('eval', 'stub');          // stub = 육성 평가전 근사(빠름) / sim = 실제 경기
const AS_JSON = argv.includes('--json');
const VERBOSE = argv.includes('--verbose');
// ---- A/B 스위치 (docs/rookies.md 6절 캘리브레이션 표를 이 조합으로 뽑았다)
/** --no-rookies = 신인 세대를 끄고 도입 전(카드 풀 42장 고정) 동작으로 되돌린다. */
const NO_ROOKIES = argv.includes('--no-rookies');
if (NO_ROOKIES) E.ROOKIES.firstSeason = 1e9;
/** --no-club-skill = AI 구단을 물려받은 신인이 고유 스킬을 쓰지 않게 한다. */
if (argv.includes('--no-club-skill')) E.ROOKIES.clubSkill = false;
/** --legacy-vacancy = 결원 판정을 옛 규칙(슬롯 점유 여부와 무관하게 카드 id 기준)으로 되돌린다. */
if (argv.includes('--legacy-vacancy')) E.VACANCY_TUNING.onlyCurrentOccupant = false;

// ---------------------------------------------------------------- 참조
/** 카드 조회는 런칭 42명 + 신인 세대를 모두 봐야 한다(docs/rookies.md — 풀이 시즌마다 늘어난다). */
const card = (g, id) => E.cardById(g, id);
const POS_CODE = E.POS_CODES;                       // ['S','OH','OP','MB','L']
const SLOT_NEED = { S: 1, OH: 2, OP: 1, MB: 2, L: 1 };  // 라인업 5-1 (A.3.2)
const RETRAIN_MAX = 3;                                  // economy_sim DEFAULT_CFG.retrain_max

// ---------------------------------------------------------------- 자동 플레이어 정책
// economy_sim.py 의 "smart" 정책과 같은 우선순위:
//   스카우트: 미보유 포지션 → 지정, 시즌 2+ 는 라인업의 R 슬롯 업그레이드 → 지정, 아니면 일반
//   육성: 미육성 카드(구멍 포지션·고희귀도 우선) → 없으면 재육성(한계돌파 진척 우선, 카드당 3회까지)
/** 은퇴한 카드는 더 이상 코트에 못 서므로 보유 카드로 세지 않는다 (A.3.6). */
function playable(g, cid) {
  const c = card(g, cid);
  return !!c && !E.isCardRetired(g, c);
}

function ownedCoverage(g) {
  const cover = { S: 0, OH: 0, OP: 0, MB: 0, L: 0 };
  for (const cid of Object.keys(g.ownedCards)) {
    const c = card(g, cid);
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

/** 이번 시즌의 소비 계측(지정 스카우트·시설·리포트). playRun 이 시즌마다 초기화한다. */
let SPEND = null;

function scoutPhase(g) {
  let guard = 0;
  // 스카우트 중에는 라인업이 바뀌지 않으므로 업그레이드 대상은 한 번만 계산한다(하네스 속도).
  const upgrade = g.season >= 2 ? upgradePosition(g) : null;
  while (g.tickets > 0) {
    if (++guard > 200) break;
    const target = uncoveredPosition(g) || upgrade;
    if (target !== null && E.canScout(g, { position: target })) {
      E.scout(g, { position: target });
      if (SPEND) { SPEND.targeted++; SPEND.scoutGold += E.ECONOMY.positionScoutGold; }
    } else {
      E.scout(g);
    }
  }
}

// ---------------------------------------------------------------- 골드 소비 정책 (B.6.4)
// 자동 플레이어는 **예비비(FACILITY.reserveGold = 지정 스카우트 11회분)를 반드시 남기고**,
// 남는 골드만 시즌 결산에서 구단에 쓴다. 순서는 ① 싼 시설부터 1단계씩 ② 그래도 남으면 스카우트 리포트.
// 예비비를 남기므로 이 정책이 포지션 지정 스카우트를 굶기지 않는다 — 그게 밸런스를 지키는 핵심이다.
function spendPhase(g) {
  const reserve = E.FACILITY.reserveGold;
  // ① 시설 — 가장 싼 다음 단계부터
  for (let guard = 0; guard < 60; guard++) {
    let best = null, bestPrice = Infinity;
    for (const t of E.FACILITY.tracks) {
      const price = E.facilityPrice(g, t.id);
      if (price !== null && price < bestPrice) { bestPrice = price; best = t.id; }
    }
    if (best === null || (g.gold | 0) - bestPrice < reserve) break;
    E.upgradeFacility(g, best);
    if (SPEND) { SPEND.facilityGold += bestPrice; SPEND.facilityBuys++; }
  }
  // ② 스카우트 리포트 — 보유했지만 아직 안 본 카드부터(육성 전에 천장을 확인한다)
  const owned = Object.keys(g.ownedCards).sort();
  for (const cid of owned) {
    if (E.hasScoutReport(g, cid)) continue;
    const cost = E.reportCost(g);
    if ((g.gold | 0) - cost < reserve) break;
    E.buyScoutReport(g, cid);
    if (SPEND) { SPEND.reportGold += cost; SPEND.reports++; }
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
      const ca = card(g, a), cb = card(g, b);
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
    const ca = card(g, a), cb = card(g, b);
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
    // AI 6구단의 **실전** 라인업 OVR — 결원(A.3.5)까지 반영한 값. 사다리 74.91 과의 차이가 곧 리그 공동화 정도다.
    let aiSum = 0, aiN = 0, subs = 0;
    for (const c of E.CLUBS) {
      const cts = E.clubTeamState(g, c.id);
      subs += cts.roster.filter(x => x.isSubstitute).length;
      for (const id of cts.lineup.startingIds.concat([cts.lineup.liberoId])) {
        const pl = cts.index.get(id);
        if (!pl) continue;
        aiSum += E.ovrOf(E.DEFAULT_TRAINING_CONFIG, pl.stats, pl.pos); aiN++;
      }
    }
    const pool = E.activeCardPool(g);
    let rookieOwned = 0;
    for (const cid of Object.keys(g.ownedCards)) if (E.isRookieCard(E.cardById(g, cid))) rookieOwned++;
    let lineupRookies = 0;
    for (const id of ts.lineup.startingIds.concat([ts.lineup.liberoId])) {
      const inst = g.instances.find(i => i.instanceId === id);
      if (inst && E.isRookieCard(E.cardById(g, inst.cardId))) lineupRookies++;
    }
    return {
      lineupAge: n ? ageSum / n : 0,
      declining,
      retired: E.retiredRepresentatives(g).length,
      aiOvr: aiN ? aiSum / aiN : 0,
      clubSubs: subs,
      owned: Object.keys(g.ownedCards).length,
      poolLeft: pool.length,
      poolRookies: pool.filter(p => E.isRookieCard(p)).length,
      genericSlots: E.genericClubSlots(g, season),
      rookieOwned,
      lineupRookies,
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
    SPEND = { targeted: 0, scoutGold: 0, facilityGold: 0, facilityBuys: 0, reportGold: 0, reports: 0 };
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
    spendPhase(g);   // 결산 화면에서 구단에 투자한다 (B.6.4)
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
      // B.6 골드 소비처
      targeted: SPEND.targeted, scoutGold: SPEND.scoutGold,
      facilityGold: SPEND.facilityGold, reportGold: SPEND.reportGold,
      sinkGold: SPEND.facilityGold + SPEND.reportGold,
      upkeepPaid: st.upkeep ? st.upkeep.paid : 0,
      upkeepShort: st.upkeep ? st.upkeep.shortfall : 0,
      prestige: E.clubPrestige(g).total,
      ssr: Object.keys(g.ownedCards).filter(c => card(g, c) && card(g, c).rarity === E.RARITY.SSR).length,
      sr: Object.keys(g.ownedCards).filter(c => card(g, c) && card(g, c).rarity === E.RARITY.SR).length,
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
// B.6 골드 소비처를 넣은 뒤에도 **초반에는 지정 스카우트를 쓸 여유가 남아야 한다**.
// 예비비(13,200)가 시즌 1~3 잔액(8.7k/9.1k/10.4k)보다 커서 시설·리포트를 한 장도 못 사는 것이 설계다.
const targeted13 = mean(runsOut.map(r => r.seasons.slice(0, 3).reduce((x, y) => x + (y ? y.targeted : 0), 0)));
T('시즌 1~3 포지션 지정 스카우트(합)', targeted13, 18, null, v => v.toFixed(1) + '회', 'B.6.4 초반 여유');
T('시즌 3 골드 잔액', mean(byS(3).map(r => r.goldEnd)), 8500, null, v => v.toFixed(0), 'B.6.4 초반은 소비처가 잠긴다');

// ---------------------------------------------------------------- 장기 시즌 목표 (A.4.4) — --long 에서만
const longTargets = [];
const longStart = targets.length;
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
  // ④ 골드가 무한 축적되지 않는다 — 종반 잔액이 중반 정점을 넘지 않을 것 (B.6.5)
  targets.push({
    label: '골드 잔액이 무한 축적되지 않는다 (시즌 8 ≤ 시즌 4)', value: gold(8), lo: null, hi: null,
    ok: gold(8) <= gold(4),
    text: `S4 ${gold(4).toFixed(0)} → S8 ${gold(8).toFixed(0)}`, note: '',
  });
  if (SEASONS >= 15) {
    targets.push({
      label: '골드 잔액이 후반에 안정된다 (시즌 15 ≤ 시즌 4)', value: gold(15), lo: null, hi: null,
      ok: gold(15) <= gold(4),
      text: `S4 ${gold(4).toFixed(0)} → S15 ${gold(15).toFixed(0)}`, note: 'B.6.5',
    });
    const lateGold = [9, 10, 11, 12, 13, 14, 15].map(gold);
    targets.push({
      label: '시즌 9~15 골드 잔액 최댓값 ≤ 시즌 4 잔액', value: Math.max(...lateGold), lo: null, hi: null,
      ok: Math.max(...lateGold) <= gold(4),
      text: `${Math.max(...lateGold).toFixed(0)} vs S4 ${gold(4).toFixed(0)}`, note: 'B.6.5',
    });
    // 과도하게 걷어 가면 지정 스카우트가 굶어 전력이 바뀐다 — 아래쪽 가드레일
    const allGold = [];
    for (let k = 4; k <= SEASONS; k++) allGold.push(gold(k));
    T('시즌 4~15 골드 잔액 최솟값', Math.min(...allGold), 3000, null, v => v.toFixed(0), 'B.6.5 과다 회수 방지');
  }

  // ⑤ 신인 세대 (docs/rookies.md) — 은퇴로 줄어드는 스카우트 명단을 새 카드가 붙잡는가
  const pool = n => mean(byS(n).map(r => r.poolLeft));
  const late4 = [12, 13, 14, 15].filter(n => n <= SEASONS);
  const all15 = [];
  for (let n = 4; n <= SEASONS; n++) all15.push(n);
  if (late4.length > 0) {
    T('시즌 12~15 스카우트 가능 카드(최솟값)', Math.min(...late4.map(pool)), 40, null, v => v.toFixed(1) + '장',
      `S${late4[late4.map(pool).indexOf(Math.min(...late4.map(pool)))]}`);
    T('시즌 4~15 스카우트 가능 카드(최솟값)', Math.min(...all15.map(pool)), 40, null, v => v.toFixed(1) + '장');
    const lateTitles = late4.map(title);
    T('시즌 9~15 우승률 최솟값', Math.min(...[9, 10, 11, 12, 13, 14, 15].filter(n => n <= SEASONS).map(title)), 0.30, null, p);
    T('시즌 9~15 우승률 최댓값', Math.max(...[9, 10, 11, 12, 13, 14, 15].filter(n => n <= SEASONS).map(title)), null, 0.80, p);
    targets.push({
      label: '시즌 12~15 우승률이 단조 증가하지 않는다', value: NaN, lo: null, hi: null,
      ok: !(lateTitles[0] < lateTitles[1] && lateTitles[1] < lateTitles[2] && lateTitles[2] < lateTitles[3]),
      text: lateTitles.map(v => (v * 100).toFixed(0) + '%').join(' → '), note: '고원',
    });
  }
  for (let i = longStart; i < targets.length; i++) if (targets[i]) longTargets.push(targets[i]);
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

  // 신인 세대 (docs/rookies.md)
  if (!NO_ROOKIES) {
    const gr = E.createGame({ seed: 4711, evaluation: 'stub' });
    gr.season = 15;
    const sig = (g) => E.rookieCards(g, 15).map(c => `${c.id}:${c.name}:${c.jersey}:${c.stats.join(',')}`).join('|');
    const s15 = sig(gr);
    const gr2 = E.createGame({ seed: 4711, evaluation: 'stub' }); gr2.season = 15;
    const gr3 = E.createGame({ seed: 4712, evaluation: 'stub' }); gr3.season = 15;
    must('신인: 같은 시드 → 같은 세대', s15 === sig(gr2));
    must('신인: 다른 시드 → 다른 세대', s15 !== sig(gr3));
    // 캐시를 뒤로만 늘리므로, 시즌 15 까지 쌓은 뒤 물어본 시즌 6 = 시즌 6 까지만 쌓은 결과
    const grStep = E.createGame({ seed: 4711, evaluation: 'stub' });
    for (let n = 1; n <= 15; n++) { grStep.season = n; E.activeCardPool(grStep); }
    must('신인: 시즌을 하나씩 올려도 같은 세대(캐시 단조성)', sig(grStep) === s15);
    // 시즌 1~3 보호 구간
    gr.season = 3;
    must('신인: 시즌 1~3 에는 신규 카드가 없다', E.rookieCards(gr, 3).length === 0 && E.activeCardPool(gr).length === 42);
    // 세이브에 카드를 넣지 않는다 → 재로드 후 같은 세대가 나온다
    const gs = E.createGame({ seed: 4711, evaluation: 'stub' });
    gs.season = 12;
    const before = E.rookieCards(gs, 12).map(c => c.id + ':' + c.name).join('|');
    const saved = JSON.parse(JSON.stringify(E.saveGame(gs)));
    const gl = E.loadGame(saved);
    must('신인: 세이브에 카드를 저장하지 않는다', JSON.stringify(saved).indexOf('r0401') < 0);
    must('신인: 재로드 후 같은 세대 재현', before === E.rookieCards(gl, 12).map(c => c.id + ':' + c.name).join('|'));
    // 신인 카드를 스카우트·육성한 뒤 저장→복원
    const gt = E.createGame({ seed: 909, evaluation: 'stub' });
    gt.season = 8;
    const rookie = E.activeCardPool(gt).find(c => E.isRookieCard(c));
    gt.ownedCards[rookie.id] = 0;
    const sess = E.startTraining(gt, rookie.id, []);
    let guard = 0;
    while (sess.phase !== 2) { if (++guard > 200) break; if (sess.phase === 0) sess.apply(POLICIES.optimal.choose(sess)); else sess.resolveEvent(sess.pendingEvent.oracleChoice); }
    E.graduate(sess, 0);
    const gt2 = E.loadGame(JSON.parse(JSON.stringify(E.saveGame(gt))));
    const i1 = gt.instances[0], i2 = gt2.instances[0];
    must('신인: 신인 카드 인스턴스가 저장→복원된다',
      !!i2 && i1.name === i2.name && i1.ovr.toFixed(3) === i2.ovr.toFixed(3), rookie.name);
    // 구단 로스터에도 들어간다
    const gc = E.createGame({ seed: 4711, evaluation: 'stub' });
    gc.season = 12;
    let heirs = 0, size = 0;
    for (const c of E.CLUBS) { const ts = E.clubTeamState(gc, c.id); size += ts.roster.length; heirs += ts.roster.filter(x => x.isRookieHeir).length; }
    must('신인: AI 구단 42 슬롯을 신인이 채운다 (시즌 12)', heirs >= 20 && size === 42, `${heirs}/42 슬롯`);
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

  // 골드 소비처 (B.6) — 시설·운영비·리포트
  {
    const gf = E.createGame({ seed: 1234 });
    must('시설: 새 게임의 등급은 0 · 명성 "신생"', E.clubPrestige(gf).total === 0 && E.clubPrestige(gf).name === '신생');
    gf.gold = 0;
    must('시설: 골드 부족 시 투자 차단', !E.canUpgradeFacility(gf, 'analysis'));
    gf.gold = E.FACILITY.tracks[0].prices[0];
    E.upgradeFacility(gf, 'analysis');
    must('시설: 1단계 투자 = 가격만큼 차감', gf.gold === 0 && E.facilityLevel(gf, 'analysis') === 1);
    must('시설: 유지비 = 등급 × 단가', E.facilityUpkeep(gf).facility === E.FACILITY.upkeepPerLevel);
    // 리포트: 카드당 1회 결제, 재열람 무료
    gf.gold = 100000;
    const cid = E.CARD_POOL[0].id;
    const cost = E.reportCost(gf);
    const g0 = gf.gold;
    const rep = E.buyScoutReport(gf, cid);
    must('리포트: 1회 결제 + 잠재 OVR 제공', gf.gold === g0 - cost && rep && rep.ovrPotential > rep.ovrNow,
      `${rep.name} 잠재 OVR ${rep.ovrPotential}`);
    const g1 = gf.gold;
    E.buyScoutReport(gf, cid);
    must('리포트: 같은 카드 재열람은 무료', gf.gold === g1);
    // 분석실 5단계면 리포트가 무료
    const gr = E.createGame({ seed: 1235 });
    gr.gold = 1e6;
    for (let i = 0; i < 5; i++) E.upgradeFacility(gr, 'analysis');
    must('리포트: 분석실 5단계 = 무료', E.reportCost(gr) === 0);
    // 운영비 미납 → 시설 1단계 강등
    const gu = E.createGame({ seed: 1236 });
    gu.gold = 1e6;
    E.upgradeFacility(gu, 'stadium'); E.upgradeFacility(gu, 'stadium');
    gu.gold = 100;
    const paid = E.payUpkeep(gu);
    must('운영비: 미납 시 시설 1단계 강등 · 잔액 0', paid.shortfall > 0 && gu.gold === 0 && E.facilityLevel(gu, 'stadium') === 1);
    // 저장/복원
    const gs = E.createGame({ seed: 1237 });
    gs.gold = 1e6;
    E.upgradeFacility(gs, 'hall'); E.buyScoutReport(gs, E.CARD_POOL[3].id);
    const gs2 = E.loadGame(JSON.parse(JSON.stringify(E.saveGame(gs))));
    must('시설·리포트: 저장→복원',
      E.facilityLevel(gs2, 'hall') === 1 && E.hasScoutReport(gs2, E.CARD_POOL[3].id) && gs2.gold === gs.gold);
  }
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
  // (골드 소비처 세부는 아래 "골드 소비처" 표에서 따로 낸다 — B.6)
  for (let n = 1; n <= SEASONS; n++) {
    const rs = byS(n);
    if (!rs.length) continue;
    console.log(`| ${n} | ${(E.growthFor(n) * 100).toFixed(0)}% | ${p(mean(rs.map(r => r.wins / 12)))} | ${mean(rs.map(r => r.wins)).toFixed(1)}-${mean(rs.map(r => r.losses)).toFixed(1)} | ${mean(rs.map(r => r.points)).toFixed(1)} | ${mean(rs.map(r => r.rank)).toFixed(2)} | ${p(mean(rs.map(r => (r.po ? 1 : 0))))} | ${p(mean(rs.map(r => (r.champion ? 1 : 0))))} | ${mean(rs.map(r => r.scouts)).toFixed(1)} | ${mean(rs.map(r => r.trainings)).toFixed(1)} | ${mean(rs.map(r => r.lineupOvr)).toFixed(1)} | ${mean(rs.map(r => r.holes)).toFixed(2)} | ${mean(rs.map(r => r.ticketsEnd)).toFixed(1)} | ${mean(rs.map(r => r.goldEnd)).toFixed(0)} |`);
  }

  console.log('\n## 골드 소비처 (docs/league-and-economy.md B.6)\n');
  console.log('| 시즌 | 유입(추정) | 지정 스카우트 | 시설 투자 | 리포트 | 구단 운영비 | 명성 등급 | 계약 선수 | 골드 잔액 |');
  console.log('|---|---|---|---|---|---|---|---|---|');
  for (let n = 1; n <= SEASONS; n++) {
    const rs = byS(n);
    if (!rs.length) continue;
    const prev = n > 1 ? mean(byS(n - 1).map(r => r.goldEnd)) : E.ECONOMY.initialGold;
    const end = mean(rs.map(r => r.goldEnd));
    const out = mean(rs.map(r => r.scoutGold + r.facilityGold + r.reportGold + r.upkeepPaid));
    console.log(`| ${n} | ${(end - prev + out).toFixed(0)} | ${mean(rs.map(r => r.targeted)).toFixed(1)}회 / ${mean(rs.map(r => r.scoutGold)).toFixed(0)} | ${mean(rs.map(r => r.facilityGold)).toFixed(0)} | ${mean(rs.map(r => r.reportGold)).toFixed(0)} | ${mean(rs.map(r => r.upkeepPaid)).toFixed(0)} | ${mean(rs.map(r => r.prestige)).toFixed(1)} | ${mean(rs.map(r => r.owned)).toFixed(1)} | ${end.toFixed(0)} |`);
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
    console.log('| 시즌 | 라인업 평균 나이 | 하락기 슬롯(7중) | 은퇴한 대표 | 스카우트 가능 카드 |');
    console.log('|---|---|---|---|---|');
    for (let n = 1; n <= SEASONS; n++) {
      const rs = byS(n);
      if (!rs.length) continue;
      console.log(`| ${n} | ${mean(rs.map(r => r.lineupAge)).toFixed(1)}세 | ${mean(rs.map(r => r.declining)).toFixed(2)} | ${mean(rs.map(r => r.retired)).toFixed(2)} | ${mean(rs.map(r => r.poolLeft)).toFixed(1)} |`);
    }

    console.log('\n## 신인 세대 (docs/rookies.md)\n');
    console.log('| 시즌 | 스카우트 가능 카드 | 그중 신인 | 런칭 잔존 | 보유 카드 | 보유 신인 | 라인업 신인(7중) | 제네릭 구단 슬롯 | 구단 결원 대체(42중) | 내 라인업 OVR | AI 실전 OVR | 우승률 |');
    console.log('|---|---|---|---|---|---|---|---|---|---|---|---|');
    for (let n = 1; n <= SEASONS; n++) {
      const rs = byS(n);
      if (!rs.length) continue;
      const poolLeft = mean(rs.map(r => r.poolLeft));
      const poolRk = mean(rs.map(r => r.poolRookies));
      console.log(`| ${n} | ${poolLeft.toFixed(1)} | ${poolRk.toFixed(1)} | ${(poolLeft - poolRk).toFixed(1)} | ${mean(rs.map(r => r.owned)).toFixed(1)} | ${mean(rs.map(r => r.rookieOwned)).toFixed(1)} | ${mean(rs.map(r => r.lineupRookies)).toFixed(2)} | ${mean(rs.map(r => r.genericSlots)).toFixed(1)} | ${mean(rs.map(r => r.clubSubs)).toFixed(1)} | ${mean(rs.map(r => r.lineupOvr)).toFixed(1)} | ${mean(rs.map(r => r.aiOvr)).toFixed(1)} | ${p(mean(rs.map(r => (r.champion ? 1 : 0))))} |`);
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
  if (label.indexOf('육성 횟수') >= 0 || label.indexOf('스카우트') >= 0) return v.toFixed(0) + '회';
  if (label.indexOf('가능 카드') >= 0) return v.toFixed(0) + '장';
  if (label.indexOf('골드') >= 0) return v.toFixed(0);   // B.6 골드 잔액 목표는 절대값이다
  return (v * 100).toFixed(0) + '%';
}

process.exit(failures === 0 && invFail === 0 ? 0 : 1);
