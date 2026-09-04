// 리그 시즌 계층 — 일정·순위·매치데이·포스트시즌·결산·경제.
// docs/league-and-economy.md A(리그 시즌)·B(경제)·C(구현 인터페이스) 구현.
// 경기 시뮬(match.js)·육성(training.js)·구단 상태(game.js)는 그대로 쓰고, 이 파일은 그 위의 상태기계만 담당한다.

import { SIDE } from './domain.js';
import { Rng, mixSeed } from './rng.js';
import { createSimConfig } from './config.js';
import { simulateMatch } from './match.js';
import { ovrOf } from './training-config.js';
import {
  CLUBS, CLUB_BY_ID, ECONOMY, REWARDS, SEASON_GROWTH, growthFor,
  myTeamState, myTeam, clubTeamState, departedCardIds, activeCardPool,
  formatMatchResult, nextSeed, addHistory, addTickets, addGold, addFragments,
  createFillers, newClubRecords, TRAINING_CFG, rookieClassOf,
} from './game.js';
// 골드 소비처(B.6) — 결산에서 구단 운영비를 정산한다.
import { payUpkeep, facilityUpkeep, clubPrestige } from './facility.js';

// ---------------------------------------------------------------- 상수 (league-and-economy.md 부록 league:)
/** 시즌 포맷 상수. C.1 SeasonConfig 와 1:1. */
export const SEASON_CONFIG = {
  teamCount: 7,            // A.1.1 플레이어 1 + AI 6
  rounds: 2,               // 더블 라운드로빈
  matchdays: 14,           // 홀수 팀 → 라운드마다 1팀 부전(bye), 팀당 12경기 · bye 2회
  matchesPerTeam: 12,
  fixturesPerMatchday: 3,
  // A.1.2 승점
  winPoints: 3,            // 3-0 · 3-1 승
  winPointsTight: 2,       // 3-2 승
  losePointsTight: 1,      // 2-3 패
  losePoints: 0,
  // A.1.3 포스트시즌 (프로토타입 축약안이 아니라 정식안)
  playoffTeams: 4,
  semiBestOf: 1,           // 준PO 3위 vs 4위 단판
  poBestOf: 3,             // PO 2위 vs 준PO 승자
  finalBestOf: 5,          // 챔프전 정규 1위 vs PO 승자
  finalAdvantage: 1,       // 정규 1위 1승 어드밴티지
  // A.3.4 홈 어드밴티지
  homeCourtLogit: 0.05,
  // A.2.1 외곽 루프
  preseasonTrainings: 2,   // 시즌 1 개막 전 2회만 (시즌 2+ 는 매치데이 루프에 흡수)
  trainingsPerMatchday: 1,
};

/** 리그 경기 전용 시뮬 설정(홈 어드밴티지 0.05). 친선경기(playMatch)는 기존대로 0.0. A.3.4 */
const LEAGUE_SIM_CONFIG = (() => {
  const c = createSimConfig();
  c.match.homeCourtLogit = SEASON_CONFIG.homeCourtLogit;
  return c;
})();

export const PHASE = {
  Preseason: 'preseason',   // 일정 확정, 스카우트·프리시즌 육성
  Matchday: 'matchday',     // 정규 시즌 진행 중
  Playoff: 'playoff',       // 포스트시즌
  Offseason: 'offseason',   // 결산 완료, 다음 시즌 대기
};

const PHASE_LABEL = { preseason: '프리시즌', matchday: '정규 시즌', playoff: '포스트시즌', offseason: '시즌 결산' };

// ---------------------------------------------------------------- 일정 (A.1.1)
/**
 * 더블 라운드로빈 일정. 7팀 + 더미 1(bye) = 8슬롯 서클 메서드로 7라운드를 만들고,
 * 2차 레그는 홈·원정을 뒤집어 붙인다 → 14 매치데이 / 팀당 12경기 · 홈 6 · 원정 6 · bye 2회.
 * teamIds 의 슬롯 배치와 라운드 순서를 시드로 섞는다(C.4 H(accountSeed, seasonNumber, "schedule")).
 * @returns {Array<Array<{h:number,a:number}>>} rounds[md-1] = 그 매치데이의 3경기(팀 인덱스)
 */
export function buildSchedule(teamCount, seed) {
  const rng = new Rng(seed);
  const slots = [];
  for (let i = 0; i < teamCount; i++) slots.push(i);
  for (let i = slots.length - 1; i > 0; i--) {          // Fisher-Yates (결정적)
    const j = rng.nextInt(i + 1);
    const t = slots[i]; slots[i] = slots[j]; slots[j] = t;
  }
  const arr = slots.slice();
  if (arr.length % 2 === 1) arr.push(-1);               // -1 = bye
  const n = arr.length;
  const leg1 = [];
  for (let r = 0; r < n - 1; r++) {
    const round = [];
    for (let i = 0; i < n / 2; i++) {
      const x = arr[i], y = arr[n - 1 - i];
      if (x < 0 || y < 0) continue;                     // bye
      // 라운드 패리티로 홈·원정을 교대(레그 내 편중 완화). 시즌 총합은 2차 레그 미러로 6:6 균등.
      round.push(r % 2 === 0 ? { h: x, a: y } : { h: y, a: x });
    }
    leg1.push(round);
    arr.splice(1, 0, arr.pop());                        // arr[0] 고정 회전
  }
  const leg2 = leg1.map(rd => rd.map(f => ({ h: f.a, a: f.h })));
  shuffleInPlace(leg1, rng);
  shuffleInPlace(leg2, rng);
  return leg1.concat(leg2);
}

function shuffleInPlace(a, rng) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = rng.nextInt(i + 1);
    const t = a[i]; a[i] = a[j]; a[j] = t;
  }
}

// ---------------------------------------------------------------- 시즌 시작
function leagueTeamIds(state) {
  return [state.clubId].concat(CLUBS.map(c => c.id));
}

/**
 * 새 시즌 시작. 일정 생성 · 순위표 초기화 · 프리시즌 육성 슬롯 지급.
 * 이미 진행 중인 시즌이 있으면 그대로 돌려준다(중복 호출 안전).
 * @returns {object} state.league (시즌 상태). UI 는 seasonView(state) 를 쓰는 것이 편하다.
 */
export function startSeason(state, opts = {}) {
  const L = state.league;
  if (L && L.phase !== PHASE.Offseason && !opts.force) return L;
  const number = Math.max(1, state.season | 0);
  const teams = leagueTeamIds(state);
  const seasonSeed = mixSeed(state.seed, 0x5EA5, number);   // C.4 시즌 결정성의 뿌리
  const schedule = buildSchedule(teams.length, mixSeed(seasonSeed, 0x5C4E, 1));
  // A.2.1 프리시즌 육성(시즌 1 만 2회) + 매치데이 1 슬롯 1회 → 시즌 1 총 16회 / 시즌 2+ 14회
  const preseason = number === 1 ? SEASON_CONFIG.preseasonTrainings : 0;
  const next = {
    number,
    phase: PHASE.Preseason,
    matchday: 0,                       // 치른 매치데이 수(0~14)
    trainingsLeft: preseason + SEASON_CONFIG.trainingsPerMatchday,
    seasonSeed,
    teams,
    schedule,
    results: schedule.map(rd => rd.map(() => null)),
    playerStats: {},
    bracket: null,
    trainingBase: state.trainingCount | 0,   // 신인상 판정 기준(이 시즌에 졸업한 인스턴스)
    settlement: null,
  };
  state.league = next;
  if (!state.leagueHistory) state.leagueHistory = [];
  if (!state.clubRecords) state.clubRecords = newClubRecords();
  addHistory(state, `시즌 ${number} 개막 — 블룸 리그 ${teams.length}팀 · ${SEASON_CONFIG.matchdays} 매치데이 (AI 성장률 ${(growthFor(number) * 100).toFixed(0)}%)`);
  return next;
}

function requireLeague(state) {
  if (!state.league) throw new Error('시즌이 시작되지 않았습니다. startSeason(state) 을 먼저 호출하세요.');
  return state.league;
}

// ---------------------------------------------------------------- 순위표 (A.1.2)
function emptyRow(teamId) {
  return {
    teamId, played: 0, wins: 0, losses: 0, points: 0,
    setsFor: 0, setsAgainst: 0, pointsFor: 0, pointsAgainst: 0,
  };
}

/** 승점 배분. A.1.2 — 3-0·3-1 승 3점 / 3-2 승 2점 · 패 1점 / 그 외 패 0점 */
export function matchPoints(winnerSets, loserSets) {
  const c = SEASON_CONFIG;
  return loserSets >= 2
    ? { win: c.winPointsTight, lose: c.losePointsTight }
    : { win: c.winPoints, lose: c.losePoints };
}

/** 저장된 경기 결과에서 순위표·상대전적을 재계산한다(순위표는 저장하지 않는다). */
function computeTable(L) {
  const rows = new Map();
  for (const id of L.teams) rows.set(id, emptyRow(id));
  const h2h = new Map();   // 'A|B' → A 가 B 에게 거둔 승수
  for (let md = 0; md < L.results.length; md++) {
    const rd = L.results[md];
    for (let i = 0; i < rd.length; i++) {
      const r = rd[i];
      if (!r) continue;
      const f = L.schedule[md][i];
      const H = rows.get(L.teams[f.h]), A = rows.get(L.teams[f.a]);
      H.played++; A.played++;
      H.setsFor += r.hs; H.setsAgainst += r.as;
      A.setsFor += r.as; A.setsAgainst += r.hs;
      H.pointsFor += r.hp; H.pointsAgainst += r.ap;
      A.pointsFor += r.ap; A.pointsAgainst += r.hp;
      const homeWon = r.hs > r.as;
      const pts = matchPoints(Math.max(r.hs, r.as), Math.min(r.hs, r.as));
      if (homeWon) {
        H.wins++; A.losses++; H.points += pts.win; A.points += pts.lose;
        h2h.set(H.teamId + '|' + A.teamId, (h2h.get(H.teamId + '|' + A.teamId) || 0) + 1);
      } else {
        A.wins++; H.losses++; A.points += pts.win; H.points += pts.lose;
        h2h.set(A.teamId + '|' + H.teamId, (h2h.get(A.teamId + '|' + H.teamId) || 0) + 1);
      }
    }
  }
  return { rows, h2h };
}

function ratio(f, a) { return a === 0 ? (f === 0 ? 0 : f) : f / a; }

/** A.1.2 타이브레이크 6단계(결정적 — 동전던지기 없음). */
function compareRows(x, y, h2h) {
  if (x.points !== y.points) return y.points - x.points;                       // 1 승점
  if (x.wins !== y.wins) return y.wins - x.wins;                               // 2 승수
  const sx = ratio(x.setsFor, x.setsAgainst), sy = ratio(y.setsFor, y.setsAgainst);
  if (sx !== sy) return sy - sx;                                               // 3 세트 득실률
  const px = ratio(x.pointsFor, x.pointsAgainst), py = ratio(y.pointsFor, y.pointsAgainst);
  if (px !== py) return py - px;                                               // 4 점수 득실률
  const hx = h2h.get(x.teamId + '|' + y.teamId) || 0;                          // 5 승자승
  const hy = h2h.get(y.teamId + '|' + x.teamId) || 0;
  if (hx !== hy) return hy - hx;
  return x.teamId < y.teamId ? -1 : (x.teamId > y.teamId ? 1 : 0);             // 6 팀 ID 사전순
}

function teamMeta(state, teamId) {
  if (teamId === state.clubId) {
    const t = myTeam(state);
    return { name: t.name, city: t.city, colors: t.colors, isMe: true };
  }
  const c = CLUB_BY_ID.get(teamId);
  return { name: c.name, city: c.city, colors: c.colors, isMe: false };
}

/**
 * 현재 순위표. league-and-economy.md A.1.2
 * @returns {Array<{rank,teamId,name,colors,played,wins,losses,points,setsFor,setsAgainst,setRatio,pointsFor,pointsAgainst,pointDiff,isMe}>}
 */
export function standings(state) {
  const L = requireLeague(state);
  const { rows, h2h } = computeTable(L);
  const list = L.teams.map(id => rows.get(id));
  list.sort((a, b) => compareRows(a, b, h2h));
  return list.map((r, i) => {
    const m = teamMeta(state, r.teamId);
    return {
      rank: i + 1, teamId: r.teamId, name: m.name, colors: m.colors,
      played: r.played, wins: r.wins, losses: r.losses, points: r.points,
      setsFor: r.setsFor, setsAgainst: r.setsAgainst, setRatio: ratio(r.setsFor, r.setsAgainst),
      pointsFor: r.pointsFor, pointsAgainst: r.pointsAgainst, pointDiff: r.pointsFor - r.pointsAgainst,
      isMe: m.isMe,
    };
  });
}

/** 내 순위(1~7). */
export function myRank(state) {
  const t = standings(state).find(r => r.isMe);
  return t ? t.rank : 0;
}

// ---------------------------------------------------------------- 일정 보기
/**
 * 전체 일정. @returns {Array<{matchday, fixtures:[{home,away,homeName,awayName,result}], mine, bye}>}
 */
export function schedule(state) {
  const L = requireLeague(state);
  const out = [];
  for (let md = 0; md < L.schedule.length; md++) {
    const fixtures = L.schedule[md].map((f, i) => {
      const home = L.teams[f.h], away = L.teams[f.a];
      const r = L.results[md][i];
      return {
        home, away,
        homeName: teamMeta(state, home).name, awayName: teamMeta(state, away).name,
        result: r ? { homeSets: r.hs, awaySets: r.as, homePoints: r.hp, awayPoints: r.ap } : null,
      };
    });
    const mine = fixtures.find(f => f.home === state.clubId || f.away === state.clubId) || null;
    out.push({ matchday: md + 1, fixtures, mine, bye: mine === null, played: L.results[md][0] !== null });
  }
  return out;
}

/** 매치데이 md(1~14)에서 내 경기. bye 면 null. */
function myFixture(L, clubId, md) {
  if (md < 1 || md > L.schedule.length) return null;
  const rd = L.schedule[md - 1];
  for (let i = 0; i < rd.length; i++) {
    if (L.teams[rd[i].h] === clubId) return { index: i, opponentId: L.teams[rd[i].a], isHome: true };
    if (L.teams[rd[i].a] === clubId) return { index: i, opponentId: L.teams[rd[i].h], isHome: false };
  }
  return null;
}

// ---------------------------------------------------------------- 경기 실행
/**
 * 이 매치데이에 필요한 7팀 TeamState 를 한 번만 만들어 재사용한다(성능).
 * AI 6구단은 시즌 g 와 결원(졸업시킨 카드) 목록이 그대로면 매치데이마다 다시 만들 필요가 없으므로
 * 계정별 약한 캐시를 둔다 — 매치데이 1회 비용을 6번의 로스터 복제에서 0 으로 줄인다.
 */
const CLUB_TS_CACHE = new WeakMap();
function buildTeamStates(state) {
  const departed = departedCardIds(state);
  const token = state.season + '|' + state.useClubTactics + '|' + Array.from(departed).sort().join(',');
  let hit = CLUB_TS_CACHE.get(state);
  if (!hit || hit.token !== token) {
    const g = growthFor(state.season);
    const clubs = new Map();
    for (const c of CLUBS) clubs.set(c.id, clubTeamState(state, c.id, { growth: g, departed }));
    hit = { token, clubs };
    CLUB_TS_CACHE.set(state, hit);
  }
  const map = new Map(hit.clubs);
  map.set(state.clubId, myTeamState(state));
  return map;
}

function simFixture(L, md, index, homeTS, awayTS, collectEvents) {
  // C.4 매치데이 경기 시드 = H(seasonSeed, matchDay, fixtureIndex) — 경기마다 독립
  const seed = mixSeed(L.seasonSeed, md, index + 1);
  return { seed, result: simulateMatch(homeTS, awayTS, seed, LEAGUE_SIM_CONFIG, collectEvents) };
}

function setPoints(result, side) {
  let n = 0;
  for (const s of result.sets) n += side === SIDE.HOME ? s.home : s.away;
  return n;
}

/** 시즌 개인 기록 누적(A.5.1 MVP·부문 타이틀용). C.2 SeasonPlayerStats */
function accumulateStats(L, result, homeTS, awayTS) {
  const homeIds = new Set(homeTS.roster.map(p => p.id));
  for (const b of result.boxScores.values()) {
    const teamId = homeIds.has(b.playerId) ? homeTS.team.id : awayTS.team.id;
    let v = L.playerStats[b.playerId];
    if (!v) {
      v = L.playerStats[b.playerId] = {
        playerId: b.playerId, name: b.name, teamId, positionCode: b.positionCode,
        matches: 0, points: 0, kills: 0, attacks: 0, attackErrors: 0,
        blockKills: 0, aces: 0, digs: 0, receptions: 0, receptionPerfect: 0,
      };
    }
    v.teamId = teamId;
    v.matches++;
    v.points += b.kills + b.blockKills + b.aces;
    v.kills += b.kills; v.attacks += b.attacks; v.attackErrors += b.attackErrors;
    v.blockKills += b.blockKills; v.aces += b.aces; v.digs += b.digs;
    v.receptions += b.receptions; v.receptionPerfect += b.receptionPerfect;
  }
}

/** 경기 보상(A.5.1). 내 경기에만 지급한다. */
function rewardMatch(state, won, mySets, isHome) {
  const shards = REWARDS.matchShards + (won ? REWARDS.winShards : 0);
  const converted = addFragments(state, shards);
  const gold = REWARDS.matchGold + REWARDS.setGold * mySets
    + (isHome ? REWARDS.homeGold : 0) + (won ? REWARDS.winGold : 0);
  addGold(state, gold);
  return {
    shards, gold, ticketsConverted: converted,
    text: `조각 +${shards}${converted ? ` (→ 티켓 +${converted})` : ''} · 골드 +${gold}`,
  };
}

// ---------------------------------------------------------------- 매치데이 진행 (A.2.1)
/** 이번 매치데이에 육성이 가능한가. */
export function canTrain(state) {
  const L = state.league;
  if (!L) return true;
  return (L.phase === PHASE.Preseason || L.phase === PHASE.Matchday) && L.trainingsLeft > 0;
}

/** 이번 매치데이 육성 슬롯 포기(그냥 다음 경기로 간다). */
export function skipTrainingSlot(state) {
  const L = requireLeague(state);
  const gave = L.trainingsLeft;
  L.trainingsLeft = 0;
  return { skipped: gave, trainingsLeft: 0 };
}

/**
 * 다음 매치데이 진행. 내 경기(이벤트 포함) + 나머지 경기 자동 시뮬(collectEvents:false).
 * @returns {{matchday, myMatch, myFixture, otherResults, standings, seasonEnded, reward}}
 */
export function advanceMatchday(state, opts = {}) {
  const L = requireLeague(state);
  if (L.phase === PHASE.Playoff || L.phase === PHASE.Offseason) {
    throw new Error('정규 시즌이 이미 끝났습니다. advancePlayoff / finishSeason 을 쓰세요.');
  }
  const md = L.matchday + 1;
  if (md > SEASON_CONFIG.matchdays) throw new Error('매치데이가 모두 끝났습니다');

  const collectEvents = opts.collectEvents !== false;
  const teamStates = buildTeamStates(state);
  const round = L.schedule[md - 1];
  const mine = myFixture(L, state.clubId, md);

  let myMatch = null;
  const otherResults = [];
  for (let i = 0; i < round.length; i++) {
    const f = round[i];
    const homeId = L.teams[f.h], awayId = L.teams[f.a];
    const isMine = mine !== null && mine.index === i;
    const { seed, result } = simFixture(L, md, i, teamStates.get(homeId), teamStates.get(awayId), isMine && collectEvents);
    L.results[md - 1][i] = {
      hs: result.homeSets, as: result.awaySets,
      hp: setPoints(result, SIDE.HOME), ap: setPoints(result, SIDE.AWAY),
    };
    accumulateStats(L, result, teamStates.get(homeId), teamStates.get(awayId));
    if (isMine) {
      const mySide = mine.isHome ? SIDE.HOME : SIDE.AWAY;
      myMatch = formatMatchResult(result, teamStates.get(homeId), teamStates.get(awayId), mySide, seed);
      myMatch.matchday = md;
      const won = myMatch.won;
      if (won) { state.wins++; state.winsByClub[mine.opponentId] = (state.winsByClub[mine.opponentId] || 0) + 1; }
      else { state.losses++; state.lossesByClub[mine.opponentId] = (state.lossesByClub[mine.opponentId] || 0) + 1; }
      const rw = rewardMatch(state, won, myMatch.myScore, mine.isHome);
      myMatch.reward = rw.text;
      myMatch.rewardDetail = rw;
      addHistory(state, `MD${md} vs ${myMatch.opponent.name}(${mine.isHome ? '홈' : '원정'}): ${won ? '승' : '패'} ${myMatch.myScore}-${myMatch.oppScore}`);
    } else {
      otherResults.push({
        home: homeId, away: awayId,
        homeName: teamMeta(state, homeId).name, awayName: teamMeta(state, awayId).name,
        homeSets: result.homeSets, awaySets: result.awaySets,
        winner: result.homeSets > result.awaySets ? homeId : awayId,
      });
    }
  }

  L.matchday = md;
  L.phase = PHASE.Matchday;
  const seasonEnded = md >= SEASON_CONFIG.matchdays;
  if (seasonEnded) {
    L.trainingsLeft = 0;
    L.phase = PHASE.Playoff;
    L.bracket = createBracket(state);
    addHistory(state, `정규 시즌 종료 — 최종 ${myRank(state)}위`);
  } else {
    L.trainingsLeft += SEASON_CONFIG.trainingsPerMatchday;   // 다음 매치데이 육성 슬롯
  }

  return {
    matchday: md,
    myMatch,
    myFixture: mine ? { opponentId: mine.opponentId, isHome: mine.isHome, isBye: false } : { isBye: true },
    otherResults,
    standings: standings(state),
    seasonEnded,
    reward: myMatch ? myMatch.reward : '',
  };
}

// ---------------------------------------------------------------- 포스트시즌 (A.1.3)
function newSeries(key, name, high, low, bestOf, advantage) {
  return { key, name, high, low, bestOf, highWins: advantage || 0, lowWins: 0, games: [], winner: null, advantage: advantage || 0 };
}

/** 정규 상위 4팀 → 준PO(단판) → PO(3전2선승) → 챔프전(5전3선승 + 1위 1승 어드밴티지). A.1.3 */
function createBracket(state) {
  const ranked = standings(state);
  const seeds = ranked.slice(0, SEASON_CONFIG.playoffTeams).map(r => r.teamId);
  return {
    seeds,
    rounds: [
      newSeries('semi', '준PO', seeds[2], seeds[3], SEASON_CONFIG.semiBestOf, 0),
      newSeries('po', 'PO', seeds[1], null, SEASON_CONFIG.poBestOf, 0),
      newSeries('final', '챔프전', seeds[0], null, SEASON_CONFIG.finalBestOf, SEASON_CONFIG.finalAdvantage),
    ],
    current: 0,
    champion: null,
    myWins: 0,
    entered: seeds.indexOf(state.clubId) >= 0,
  };
}

function seriesNeed(s) { return Math.floor(s.bestOf / 2) + 1; }
function seriesDone(s) { return s.winner !== null; }

/** 브래킷 상태(UI 표시용). */
export function playoffState(state) {
  const L = requireLeague(state);
  if (!L.bracket) return null;
  const b = L.bracket;
  return {
    seeds: b.seeds.map((id, i) => ({ seed: i + 1, teamId: id, name: teamMeta(state, id).name, isMe: id === state.clubId })),
    entered: b.entered,
    champion: b.champion,
    championName: b.champion ? teamMeta(state, b.champion).name : null,
    myWins: b.myWins,
    done: b.champion !== null,
    current: b.current,
    rounds: b.rounds.map(s => ({
      key: s.key, name: s.name, bestOf: s.bestOf, need: seriesNeed(s), advantage: s.advantage,
      high: s.high, highName: s.high ? teamMeta(state, s.high).name : null,
      low: s.low, lowName: s.low ? teamMeta(state, s.low).name : null,
      highWins: s.highWins, lowWins: s.lowWins,
      winner: s.winner, winnerName: s.winner ? teamMeta(state, s.winner).name : null,
      mine: s.high === state.clubId || s.low === state.clubId,
      games: s.games.map(g => ({ ...g, homeName: teamMeta(state, g.home).name, awayName: teamMeta(state, g.away).name })),
    })),
  };
}

/**
 * 포스트시즌 다음 경기 1개 진행. 내 경기면 이벤트·박스스코어 포함.
 * @returns {{round, game, myMatch, result, bracket, done, champion}}
 */
export function advancePlayoff(state, opts = {}) {
  const L = requireLeague(state);
  if (L.phase !== PHASE.Playoff || !L.bracket) throw new Error('포스트시즌이 아닙니다');
  const b = L.bracket;
  if (b.champion) return { done: true, champion: b.champion, bracket: playoffState(state), myMatch: null, result: null };

  const s = b.rounds[b.current];
  if (s.low === null) throw new Error('대진이 아직 확정되지 않았습니다');
  const gameIndex = s.games.length;
  const highHosts = gameIndex % 2 === 0;                     // 상위 시드가 1·3·5차전 홈 (A.1.3)
  const homeId = highHosts ? s.high : s.low;
  const awayId = highHosts ? s.low : s.high;
  const isMine = homeId === state.clubId || awayId === state.clubId;
  const collectEvents = opts.collectEvents !== false && isMine;

  const teamStates = buildTeamStates(state);
  // C.4 포스트시즌 시드 = H(seasonSeed, "po", round, game)
  const seed = mixSeed(L.seasonSeed, 0x9000 + b.current, gameIndex + 1);
  const result = simulateMatch(teamStates.get(homeId), teamStates.get(awayId), seed, LEAGUE_SIM_CONFIG, collectEvents);
  const homeWon = result.homeSets > result.awaySets;
  const winnerId = homeWon ? homeId : awayId;

  s.games.push({
    game: gameIndex + 1, home: homeId, away: awayId,
    homeSets: result.homeSets, awaySets: result.awaySets, winner: winnerId,
  });
  if (winnerId === s.high) s.highWins++; else s.lowWins++;

  let myMatch = null;
  if (isMine) {
    const mySide = homeId === state.clubId ? SIDE.HOME : SIDE.AWAY;
    myMatch = formatMatchResult(result, teamStates.get(homeId), teamStates.get(awayId), mySide, seed);
    myMatch.round = s.name;
    myMatch.game = gameIndex + 1;
    const won = myMatch.won;
    if (won) { state.wins++; b.myWins++; } else { state.losses++; }
    const rw = rewardMatch(state, won, myMatch.myScore, homeId === state.clubId);
    myMatch.reward = rw.text;
    myMatch.rewardDetail = rw;
    addHistory(state, `${s.name} ${gameIndex + 1}차전 vs ${myMatch.opponent.name}: ${won ? '승' : '패'} ${myMatch.myScore}-${myMatch.oppScore}`);
  }

  const need = seriesNeed(s);
  if (s.highWins >= need || s.lowWins >= need) {
    s.winner = s.highWins >= need ? s.high : s.low;
    if (b.current + 1 < b.rounds.length) {
      b.rounds[b.current + 1].low = s.winner;
      b.current++;
    } else {
      b.champion = s.winner;
      addHistory(state, `블룸 챔피언십 우승: ${teamMeta(state, b.champion).name}`);
    }
  }

  return {
    round: s.name, game: gameIndex + 1,
    result: {
      home: homeId, away: awayId,
      homeName: teamMeta(state, homeId).name, awayName: teamMeta(state, awayId).name,
      homeSets: result.homeSets, awaySets: result.awaySets,
      winner: winnerId, winnerName: teamMeta(state, winnerId).name,
      mine: isMine,
    },
    myMatch,
    bracket: playoffState(state),
    done: b.champion !== null,
    champion: b.champion,
  };
}

/** 남은 포스트시즌 경기를 전부 자동 진행(관전 스킵). */
export function autoFinishPlayoff(state, opts = {}) {
  const L = requireLeague(state);
  let guard = 0;
  while (L.bracket && !L.bracket.champion) {
    if (++guard > 20) throw new Error('포스트시즌이 끝나지 않습니다');
    advancePlayoff(state, { collectEvents: false, ...opts });
  }
  return playoffState(state);
}

// ---------------------------------------------------------------- 시즌 결산 (A.5)
const AWARD_DEFS = [
  { key: 'mvp', name: '시즌 MVP', stat: r => r.points, ticket: () => REWARDS.mvpTicket, gold: () => REWARDS.mvpGold },
  { key: 'scorer', name: '득점상', stat: r => r.kills, ticket: () => REWARDS.titleTicket, gold: () => REWARDS.titleGold },
  { key: 'blocker', name: '블로킹상', stat: r => r.blockKills, ticket: () => REWARDS.titleTicket, gold: () => REWARDS.titleGold },
  { key: 'server', name: '서브상', stat: r => r.aces, ticket: () => REWARDS.titleTicket, gold: () => REWARDS.titleGold },
  { key: 'receiver', name: '리시브상', stat: r => (r.receptions >= 60 ? r.receptionPerfect : -1), ticket: () => REWARDS.titleTicket, gold: () => REWARDS.titleGold },
  { key: 'digger', name: '디그상', stat: r => r.digs, ticket: () => REWARDS.titleTicket, gold: () => REWARDS.titleGold },
];

function bestBy(list, fn) {
  let best = null, bestV = -Infinity;
  for (const r of list) {
    const v = fn(r);
    if (v > bestV || (v === bestV && best && r.playerId < best.playerId)) { best = r; bestV = v; }
  }
  return bestV <= 0 ? null : best;
}

/** 시즌 개인 타이틀. A.5.1 (득점상은 "공격 득점(kills)" 기준 — MVP 와 겹치지 않게 한 의도적 차이, PARITY.md 참조) */
export function seasonAwards(state) {
  const L = requireLeague(state);
  const list = Object.keys(L.playerStats).map(k => L.playerStats[k]);
  const out = [];
  for (const d of AWARD_DEFS) {
    const w = bestBy(list, d.stat);
    if (!w) continue;
    out.push({
      key: d.key, name: d.name, playerId: w.playerId, playerName: w.name,
      teamId: w.teamId, teamName: teamMeta(state, w.teamId).name,
      isMine: w.teamId === state.clubId, value: d.stat(w), stats: w,
    });
  }
  // 신인상: 이 시즌에 졸업한 내 인스턴스 중 최고 득점 (A.5.1)
  const rookieIds = new Set(state.instances.filter(i => (i.runIndex | 0) > (L.trainingBase | 0)).map(i => i.instanceId));
  const rookies = list.filter(r => rookieIds.has(r.playerId));
  const rk = bestBy(rookies, r => r.points);
  if (rk) {
    out.push({
      key: 'rookie', name: '신인상', playerId: rk.playerId, playerName: rk.name,
      teamId: rk.teamId, teamName: teamMeta(state, rk.teamId).name, isMine: true, value: rk.points, stats: rk,
    });
  }
  return out;
}

/**
 * 시즌 결산. 순위·포스트시즌 보상 지급, 기록 갱신, 다음 시즌으로 이월(A.5.3).
 * 포스트시즌이 안 끝났으면 자동으로 마무리한다.
 * @returns {{season, rank, rewards, mvp, awards, records, nextSeasonGrowth, champion, standings, myStats}}
 */
export function finishSeason(state) {
  const L = requireLeague(state);
  if (L.phase === PHASE.Offseason && L.settlement) return L.settlement;
  if (L.matchday < SEASON_CONFIG.matchdays) throw new Error('정규 시즌이 끝나지 않았습니다');
  if (L.phase === PHASE.Playoff && L.bracket && !L.bracket.champion) autoFinishPlayoff(state);

  const table = standings(state);
  const me = table.find(r => r.isMe);
  const rank = me.rank;
  const b = L.bracket;
  const champion = b ? b.champion : null;
  const isChampion = champion === state.clubId;
  const entered = b ? b.entered : false;

  // ---- 보상 (A.5.1)
  const breakdown = [];
  let tickets = 0, gold = 0;
  const rankTicket = REWARDS.rankTickets[rank - 1], rankGold = REWARDS.rankGold[rank - 1];
  tickets += rankTicket; gold += rankGold;
  breakdown.push({ label: `정규 ${rank}위`, tickets: rankTicket, gold: rankGold });
  if (entered) {
    tickets += REWARDS.playoffEntryTicket; gold += REWARDS.playoffEntryGold;
    breakdown.push({ label: '포스트시즌 진출', tickets: REWARDS.playoffEntryTicket, gold: REWARDS.playoffEntryGold });
  }
  const poWins = b ? b.myWins : 0;
  if (poWins > 0) {
    tickets += REWARDS.playoffWinTicket * poWins; gold += REWARDS.playoffWinGold * poWins;
    breakdown.push({ label: `포스트시즌 ${poWins}승`, tickets: REWARDS.playoffWinTicket * poWins, gold: REWARDS.playoffWinGold * poWins });
  }
  if (isChampion) {
    tickets += REWARDS.championTicket; gold += REWARDS.championGold;
    breakdown.push({ label: '우승(챔피언)', tickets: REWARDS.championTicket, gold: REWARDS.championGold });
  }
  const awards = seasonAwards(state);
  for (const a of awards) {
    if (!a.isMine) continue;
    const t = a.key === 'mvp' ? REWARDS.mvpTicket : REWARDS.titleTicket;
    const g = a.key === 'mvp' ? REWARDS.mvpGold : REWARDS.titleGold;
    tickets += t; gold += g;
    breakdown.push({ label: `${a.name} (${a.playerName})`, tickets: t, gold: g });
  }
  addTickets(state, tickets);
  addGold(state, gold);

  // ---- 구단 운영비 (B.6.3). 보상을 받은 **뒤에** 낸다 — 결산 화면의 순서와 같다.
  //      시설 등급 × 400 + (계약 선수 − 42) × 200. 시즌 1~8 은 둘 다 0 이라 도입 전과 값이 같다.
  const upkeep = payUpkeep(state);
  if (upkeep.total > 0) {
    breakdown.push({
      label: `구단 운영비 (시설 ${upkeep.levels}단계 · 계약 ${upkeep.squadSize}명)`,
      tickets: 0, gold: -upkeep.paid,
    });
    addHistory(state, `구단 운영비 −${upkeep.paid}골드 (시설 ${upkeep.facility} · 선수단 ${upkeep.squad})`);
  }

  // ---- 기록 (A.5.1 구단 기록)
  const rec = state.clubRecords || (state.clubRecords = newClubRecords());
  rec.seasons++;
  rec.totalWins += me.wins; rec.totalLosses += me.losses;
  rec.bestRank = rec.bestRank === 0 ? rank : Math.min(rec.bestRank, rank);
  rec.mostPoints = Math.max(rec.mostPoints, me.points);
  if (isChampion) rec.titles++;
  rec.ranks.push(rank);

  const myPlayers = Object.keys(L.playerStats).map(k => L.playerStats[k])
    .filter(r => r.teamId === state.clubId).sort((a, c) => c.points - a.points).slice(0, 5);
  const mvp = awards.find(a => a.key === 'mvp') || null;
  const growth = growthFor(L.number);
  const nextSeasonGrowth = growthFor(L.number + 1);

  const settlement = {
    season: L.number,
    rank,
    standings: table,
    champion,
    championName: champion ? teamMeta(state, champion).name : null,
    isChampion,
    playoffEntered: entered,
    playoffWins: poWins,
    rewards: { tickets, gold, breakdown, upkeep, net: gold - upkeep.paid },
    upkeep,
    prestige: clubPrestige(state),
    mvp,
    awards,
    myStats: {
      wins: me.wins, losses: me.losses, points: me.points,
      setsFor: me.setsFor, setsAgainst: me.setsAgainst,
      pointsFor: me.pointsFor, pointsAgainst: me.pointsAgainst,
      lineupOvr: lineupOvrOf(state), topPlayers: myPlayers,
    },
    records: { ...rec, ranks: rec.ranks.slice() },
    growth, nextSeasonGrowth,
    growthDelta: nextSeasonGrowth - growth,
  };

  L.settlement = settlement;
  L.phase = PHASE.Offseason;
  state.leagueHistory.push({
    season: L.number, rank, wins: me.wins, losses: me.losses, points: me.points,
    champion: isChampion, championId: champion, championName: settlement.championName,
    tickets, gold, mvp: mvp ? mvp.playerName : null, growth,
  });
  addHistory(state, `시즌 ${L.number} 결산 — ${rank}위 · ${me.wins}승 ${me.losses}패 · 승점 ${me.points}${isChampion ? ' · 우승!' : ''} (티켓 +${tickets} · 골드 +${gold})`);

  // ---- 이월 (A.5.3): 로스터·재화·한계돌파 유지, 연습생만 신규 세대로 교체
  state.season = L.number + 1;
  // 신인 드래프트 — 다음 시즌 명단에 오르는 새 카드(docs/rookies.md 3절). 결산 화면이 그대로 쓴다.
  settlement.rookies = rookieClassOf(state, state.season);
  settlement.cardPool = activeCardPool(state).length;
  state.fillers = createFillers(state);
  if (state.lineupStarters) { state.lineupStarters = null; state.lineupLibero = null; }  // 연습생 교체로 라인업 재편성
  return settlement;
}

function lineupOvrOf(state) {
  const ts = myTeamState(state);
  let sum = 0, n = 0;
  for (const id of ts.lineup.startingIds.concat([ts.lineup.liberoId])) {
    const p = ts.index.get(id);
    if (!p) continue;
    sum += ovrOf(TRAINING_CFG, p.stats, p.pos); n++;
  }
  return n === 0 ? 0 : sum / n;
}

/** 지난 시즌 결과 목록(최신이 뒤). */
export function seasonHistory(state) {
  return (state.leagueHistory || []).slice();
}

// ---------------------------------------------------------------- 통합 뷰
/**
 * UI 한 번에 쓰는 시즌 요약.
 * @returns {{season, phase, phaseLabel, matchday, totalMatchdays, myNext, standings, canTrain, trainingsLeft, playoff, wallet, growth}}
 */
export function seasonView(state) {
  const L = state.league;
  if (!L) return null;
  const nextMd = L.matchday + 1;
  const mf = L.phase === PHASE.Preseason || L.phase === PHASE.Matchday ? myFixture(L, state.clubId, nextMd) : null;
  const table = standings(state);
  const meRow = table.find(r => r.isMe);
  return {
    season: L.number,
    phase: L.phase,
    phaseLabel: PHASE_LABEL[L.phase] || L.phase,
    matchday: L.matchday,
    nextMatchday: nextMd <= SEASON_CONFIG.matchdays ? nextMd : null,
    totalMatchdays: SEASON_CONFIG.matchdays,
    myNext: nextMd <= SEASON_CONFIG.matchdays && (L.phase === PHASE.Preseason || L.phase === PHASE.Matchday)
      ? {
        matchday: nextMd,
        isBye: mf === null,
        opponentId: mf ? mf.opponentId : null,
        opponentName: mf ? teamMeta(state, mf.opponentId).name : null,
        isHome: mf ? mf.isHome : null,
      }
      : null,
    myRank: meRow ? meRow.rank : 0,
    myRecord: meRow ? { wins: meRow.wins, losses: meRow.losses, points: meRow.points } : null,
    standings: table,
    canTrain: canTrain(state),
    trainingsLeft: L.trainingsLeft,
    playoff: L.bracket ? playoffState(state) : null,
    settlement: L.settlement,
    wallet: {
      tickets: state.tickets, gold: state.gold | 0,
      fragments: state.fragments, fragmentsPerTicket: ECONOMY.fragmentsPerTicket,
      pitySR: Math.max(0, ECONOMY.pitySR - state.pitySR),
      pitySSR: Math.max(0, ECONOMY.pitySSR - state.pitySSR),
      // B.6.3 이번 시즌 결산에서 나갈 구단 운영비 — 잔액 옆에 미리 보여 준다(E.5 UI 필요 사항 #12)
      upkeep: facilityUpkeep(state),
      prestige: clubPrestige(state),
    },
    growth: growthFor(L.number),
    lineupOvr: lineupOvrOf(state),
    history: seasonHistory(state),
  };
}

export { SEASON_GROWTH };
