// 게임 루프: 구단 상태 · 스카우트(확률·천장·중복 조각·한계돌파) · 육성 시작/졸업 · 라인업 · 경기.
// Play/GameState.cs · Play/Game.cs 포팅 + docs/league-and-economy.md B.2(천장·포지션 지정)·A.3(시즌 사다리·결원 보충).

import { PLAYERS, TEAMS } from '../data.js';
import {
  POS, POS_CODES, RARITY, RARITIES, SIDE,
  playerFromJson, makePlayer, clonePlayer, clampStat, statAverage,
  makeTeamState, autoLineupFromRoster, validateTeamState, defaultTactics, FORMATION,
} from './domain.js';
import { Rng, derivedSeed, mixSeed } from './rng.js';
import { roundHalfEven } from './mathx.js';
import { generatePlayer } from './generator.js';
import { simulateMatch } from './match.js';
import { SKILL_BY_NAME } from './skills.js';
import {
  TrainingSession, PHASE, emptySupport, buildSupport, recommendSupporterList,
  simEvaluationProvider, stubEvaluationProvider, campLine,
} from './training.js';
import {
  DEFAULT_TRAINING_CONFIG, ACT, ACT_NAMES_KO, COND_NAMES_KO, COND_ARROWS,
  ZONE_NAMES_KO, GRADE_NAMES, SPECIAL_NAMES_KO, INJURY,
  ovrOf, gradeOf, skillLevelForHints, isEvalTurn,
} from './training-config.js';
import { effectBadge } from './training-events.js';

// ---------------------------------------------------------------- 참조 데이터
/** data.js 원본을 엔진 표현으로 1회만 변환(모든 게임이 공유하는 읽기 전용 풀). */
export const CARD_POOL = PLAYERS.map(playerFromJson);
const CARD_BY_ID = new Map(CARD_POOL.map(p => [p.id, p]));
export const CLUBS = TEAMS.map(t => ({
  id: t.id, name: t.name, city: t.city, colors: t.colors,
  emblemConcept: t.emblemConcept, identity: t.identity, homeArena: t.homeArena,
}));
const CLUB_BY_ID = new Map(CLUBS.map(c => [c.id, c]));
const POOL_BY_CLUB = new Map();
for (const p of CARD_POOL) {
  if (!POOL_BY_CLUB.has(p.teamId)) POOL_BY_CLUB.set(p.teamId, []);
  POOL_BY_CLUB.get(p.teamId).push(p);
}

/** 구단 아이덴티티 → 전술(league-and-economy.md A.3.3). 기본은 미적용(C# 프로토타입과 동일), 옵션으로 켠다. */
export const CLUB_TACTICS = {
  t01: { quickWeight: 0.9, openWeight: 1.4, backRowWeight: 1.0, delayedWeight: 0.4, serveAggression: 0.75, formation: FORMATION.Spread },
  t02: { quickWeight: 1.1, openWeight: 1.0, backRowWeight: 0.6, delayedWeight: 0.5, serveAggression: 0.25, formation: FORMATION.LiberoCentered },
  t03: { quickWeight: 1.5, openWeight: 1.1, backRowWeight: 0.5, delayedWeight: 0.6, serveAggression: 0.5, formation: FORMATION.Standard },
  t04: { quickWeight: 0.9, openWeight: 1.1, backRowWeight: 1.1, delayedWeight: 0.3, serveAggression: 0.9, formation: FORMATION.Spread },
  t05: { quickWeight: 1.2, openWeight: 0.9, backRowWeight: 0.8, delayedWeight: 1.0, serveAggression: 0.4, formation: FORMATION.Standard },
  t06: { quickWeight: 1.4, openWeight: 0.9, backRowWeight: 0.9, delayedWeight: 0.8, serveAggression: 0.8, formation: FORMATION.Spread },
};

// ---------------------------------------------------------------- 상수
export const ECONOMY = {
  initialTickets: 5,          // GameState.cs:37 · league-and-economy.md 부록 start:
  initialGold: 1200,          // league-and-economy.md 부록 start: 초기 골드 1,200
  fragmentsPerTicket: 12,     // league-and-economy.md B.1 조각 12 = 티켓 1 (구 프로토타입 눈금 3)
  scoutR: 0.80, scoutSR: 0.17, scoutSSR: 0.03, // GameState.cs:39
  limitBreakPotential: 3,     // GameState.cs:40
  maxLimitBreak: 5,
  fillerOverall: 44.0,        // GameState.cs:41 · league-and-economy.md A.5.3 연습생 44
  fillerPerSeason: 1.0,       // A.5.3 시즌당 +1
  fillerCap: 48.0,            // A.5.3 상한 48
  pitySR: 10,                 // league-and-economy.md B.2.2
  pitySSR: 60,
  duplicateFragments: 0,      // 중복 = 한계돌파 1단계(기존 game.js 규칙). 조각까지 주면 티켓이 폭주한다 — PARITY.md 시즌 계층 절
  positionScoutGold: 1200,    // league-and-economy.md B.2.1 포지션 지정 = 티켓 1 + 골드 1,200
  ticketCap: 999,             // B.1 재화 정의표
  goldCap: 9999999,
};

/**
 * 시즌·육성 보상표. league-and-economy.md A.5.1 (부록 reward: 와 1:1).
 * 리그 계층(season.js)과 육성 졸업(graduate)이 공유한다.
 */
export const REWARDS = {
  matchShards: 2,             // 경기 참가 (승패 무관)
  winShards: 4,               // 경기 승리 (+4)
  matchGold: 100,             // 경기 참가 골드
  homeGold: 50,               // 홈 경기 +50
  winGold: 180,               // 승리 +180
  setGold: 25,                // 획득 세트당 +25
  rankTickets: [8, 7, 6, 5, 4, 4, 3],
  rankGold: [2600, 2200, 1800, 1500, 1200, 900, 700],
  playoffEntryTicket: 1, playoffEntryGold: 500,
  playoffWinTicket: 1, playoffWinGold: 300,
  championTicket: 3, championGold: 2000,
  firstGraduationTicket: 1,   // 육성 첫 완주 (계정 1회)
  trainingMilestones: { 5: 2, 10: 2, 20: 3, 40: 4, 70: 5, 100: 6 },
  graduationGold: { S: 700, A: 500, B: 350, C: 220, D: 130 },
  mvpTicket: 2, mvpGold: 1000,
  titleTicket: 1, titleGold: 500,   // 부문 1위 · 신인상
};

/**
 * 시즌 사다리 g(n). league-and-economy.md A.3.1
 * 문서 초기값은 [0.35, 0.48, 0.58, 0.66, 0.72, 0.76, 0.80] 이지만 그 값은
 *   ① 승률 로지스틱 근사(실제 MatchSimulator 아님) ② A.3.5(스카우트된 선수의 구단 결원) 미반영
 * 을 전제로 캘리브레이션된 것이라, 둘 다 실제로 구현된 web 엔진에서는 사다리가 너무 낮았다.
 * web/season-check.mjs 로 재캘리브레이션한 값(조정 근거는 web/PARITY.md "시즌 계층" 절).
 */
export const SEASON_GROWTH = [0.52, 0.63, 0.74, 0.80, 0.80, 0.80, 0.80];
export function growthFor(season) {
  const i = Math.max(1, season | 0) - 1;
  return SEASON_GROWTH[Math.min(i, SEASON_GROWTH.length - 1)];
}
/**
 * AI 구단 선수의 고유 스킬 레벨 사다리(docs/skills.md 7.2).
 * 원소속 SSR·SR 은 자기 구단에서도 당연히 스킬을 쓴다. 이들은 이미 그 스킬로 리그에서 이름을 낸
 * 완성형 주전이므로 시즌 1부터 Lv2 로 시작하고, 스탯 사다리(SEASON_GROWTH)가 고원에 닿는
 * 시즌 2부터 Lv3 이 된다. 갓 졸업한 신인(플레이어 카드)이 힌트로 Lv1~3 을 얻는 것과 대비된다.
 */
export const CLUB_SKILL_LEVEL = [2, 3, 3, 3, 3, 3, 3];
export function clubSkillLevelFor(season) {
  const i = Math.max(1, season | 0) - 1;
  return CLUB_SKILL_LEVEL[Math.min(i, CLUB_SKILL_LEVEL.length - 1)];
}
/**
 * 결원 보충 선수의 강도 = 구단 평균 + vacancyOverallDelta. league-and-economy.md A.3.5
 * 문서 초기값은 −8 이지만 그 값은 A.3.5 미구현 전제의 추정이라 실제 시뮬에서 재캘리브레이션했다
 * (web/PARITY.md "시즌 계층" 절 · 문서 D.2 "A.3.5 구현 시 사다리 재캘리브레이션" 항목).
 */
const VACANCY = {
  overallDelta: -4,        // 육성 선수 대체 강도 = 구단 평균 + 이 값(스탯 평균 공간) = OVR −7.4
  traineeSlots: 4,         // 구단이 육성 선수로 버티는 최대 결원 수. 이보다 많이 빠지면 즉시전력을 영입한다
  signingOvrDelta: -2.0,   // 즉시전력 영입의 포지션 가중 OVR = 빠져나간 선수의 사다리 OVR + 이 값
};
export const VACANCY_TUNING = VACANCY;

/**
 * 선수 노화 곡선(league-and-economy.md A.3.6 · v0.3).
 *
 * 나이는 상태로 저장하지 않고 카드 데이터의 `age`(스카우트 시점 = 시즌 1 기준 나이)에서 파생한다:
 *   나이(시즌 n) = card.age + (n − 1)
 * 42명 전원이 같은 속도로 늙으므로 저장 포맷이 늘지 않고, 세이브를 불러와도 값이 같다(결정성).
 *
 *  - 전성기(peak) 끝까지는 배수 1.0 — 성장은 육성 루프와 사다리가 담당한다.
 *  - 전성기를 넘기면 매년 declinePerYear 만큼 실효 스탯이 곱셈으로 깎인다.
 *  - retireAge 에 닿으면 은퇴한다: 코트에 서지 못하고(로스터 제외) 스카우트 풀에서도 빠진다.
 *  - 세터·리베로는 점프 의존도가 낮고 판단·기술 비중이 커 실제 배구에서도 선수 생명이 길다 → +2년.
 */
export const AGING = {
  peakEnd: 25,                    // 전성기 마지막 나이(OP·MB 기준) — 26세부터 하락
  peakEndByPos: [2, 1, 0, 0, 2],  // S, OH, OP, MB, L — 세터·리베로 27 / 아웃사이드 26 / 아포짓·미들 25
  declineFirst: 0.07,             // 전성기를 넘긴 첫 해의 하락폭(점프력·스피드가 먼저 빠진다)
  declinePerYear: 0.015,          // 그 뒤 매년 추가 하락폭(경험·기술로 버티며 완만해진다)
  declineFloor: 0.70,             // 배수 하한
  retireAge: 31,                  // 은퇴 나이(OP·MB 기준)
  retireByPos: [2, 1, 0, 0, 2],   // 세터·리베로 33 / 아웃사이드 32 / 아포짓·미들 31
  clubReplaceFactor: 1.0,         // AI 구단이 세대교체하는 기준 배수(1.0 = 전성기를 넘기는 즉시)
  clubRecruitOvrDelta: 0.0,       // 교체 신인의 포지션 가중 OVR = 떠난 선수의 사다리 OVR + 이 값
  clubRecruitAge: 20,
  fillerAge: 19,                  // 연습생은 매 시즌 새 세대 → 항상 신인 나이
  peakStart: 22,                  // 표기 전용(판정에 쓰지 않는다 — 전성기 이전에도 배수는 1.0)
};

/** 시즌 n 시점의 실제 나이. */
export function ageAt(baseAge, season) {
  return (baseAge | 0) + Math.max(1, season | 0) - 1;
}
function peakEndFor(pos) { return AGING.peakEnd + (AGING.peakEndByPos[pos | 0] || 0); }
function retireAgeFor(pos) { return AGING.retireAge + (AGING.retireByPos[pos | 0] || 0); }

/** 실효 스탯 배수(1.0 = 전성기 이내). */
export function ageFactor(baseAge, pos, season) {
  const age = ageAt(baseAge, season);
  const over = age - peakEndFor(pos);
  if (over <= 0) return 1;
  return Math.max(AGING.declineFloor, 1 - AGING.declineFirst - AGING.declinePerYear * (over - 1));
}
/** 은퇴 여부. */
export function isRetiredAge(baseAge, pos, season) {
  return ageAt(baseAge, season) >= retireAgeFor(pos);
}
/** UI 표기용 나이 단계: 'growth' | 'peak' | 'decline' | 'retired'. */
export function agePhase(baseAge, pos, season) {
  const age = ageAt(baseAge, season);
  if (age >= retireAgeFor(pos)) return 'retired';
  if (age > peakEndFor(pos)) return 'decline';
  if (age >= AGING.peakStart) return 'peak';
  return 'growth';
}

/**
 * 나이를 반영한 선수. `own = true` 면 p 를 직접 고쳐 쓴다(이미 이 호출자만 아는 사본일 때).
 * 공유 객체(CARD_POOL)를 넘길 때는 반드시 own = false — 전역 카드가 오염된다.
 */
function agedPlayer(p, season, own = false) {
  const f = ageFactor(p.age, p.pos, season);
  const age = ageAt(p.age, season);
  if (f >= 1) {
    if (age === p.age) return p;
    const c = own ? p : clonePlayer(p);
    c.age = age;
    return c;
  }
  const c = own ? p : clonePlayer(p);
  for (let i = 0; i < 10; i++) c.stats[i] = clampStat(roundHalfEven(p.stats[i] * f));
  c.age = age;
  c.ageFactor = f;
  return c;
}

/** 전 스탯을 균등 가감해 포지션 가중 OVR 을 target 에 맞춘다(OVR 은 스탯의 가중 평균이라 선형). */
function shiftToOvr(p, target) {
  const w = TRAINING_CFG.ovrWeights[p.pos];
  let sw = 0;
  for (let i = 0; i < 10; i++) sw += w[i];
  const slope = TRAINING_CFG.positionScale[p.pos] * sw;
  if (slope <= 0) return p;
  const k = (target - ovrOf(TRAINING_CFG, p.stats, p.pos)) / slope;
  for (let i = 0; i < 10; i++) {
    p.stats[i] = clampStat(roundHalfEven(p.stats[i] + k));
    p.potential[i] = clampStat(Math.max(p.potential[i], p.stats[i]));
  }
  return p;
}

/** 카드(사람)가 은퇴했는가 — 스카우트 풀·육성에서 제외된다. */
export function isCardRetired(state, cardOrId) {
  const card = typeof cardOrId === 'string' ? CARD_BY_ID.get(cardOrId) : cardOrId;
  if (!card) return false;
  return isRetiredAge(card.age, card.pos, state.season);
}
/** 아직 스카우트할 수 있는 카드 풀(은퇴자 제외). */
export function activeCardPool(state) {
  return CARD_POOL.filter(p => !isRetiredAge(p.age, p.pos, state.season));
}

const TRAINING_CFG = DEFAULT_TRAINING_CONFIG;

// ---------------------------------------------------------------- 상태
/** 결정적 시드 카운터. GameState.cs:47 NextSeed */
function nextSeed(state) {
  state.seedIndex++;
  return derivedSeed(state.seed, state.seedIndex);
}

function hashString(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return (h & 0x7fffffff) | 0;
}

const FILLER_PLAN = [POS.S, POS.OH, POS.OH, POS.MB, POS.MB, POS.OP, POS.L]; // GameState.cs:73

/**
 * 연습생 7명(N 카드 수준). 시드에서 항상 같은 결과가 나오므로 저장하지 않고 재생성한다. GameState.cs:71
 * league-and-economy.md A.5.3: 시즌마다 신규 세대로 교체. overall 44 → 시즌당 +1, 상한 48.
 * 시즌 1 은 기존 시드 규칙(derivedSeed(seed,0))을 그대로 써서 기존 세이브·파리티와 값이 같다.
 */
export function createFillers(state) {
  const season = Math.max(1, state.season | 0);
  const rng = new Rng(season === 1 ? derivedSeed(state.seed, 0) : mixSeed(state.seed, 0x1F11, season));
  const overall = Math.min(ECONOMY.fillerCap, ECONOMY.fillerOverall + (season - 1) * ECONOMY.fillerPerSeason);
  const list = [];
  for (let i = 0; i < FILLER_PLAN.length; i++) {
    const p = generatePlayer(rng, `${state.clubId}-t${String(i + 1).padStart(2, '0')}`, state.clubId, FILLER_PLAN[i], 90 + i, overall, 3.0);
    p.rarity = RARITY.N;
    p.age = AGING.fillerAge;      // 연습생은 매 시즌 새 세대라 늙지 않는다 (A.3.6)
    p.name = '연습생 ' + p.name;
    p.skillName = '';
    p.skillDesc = '';
    list.push(p);
  }
  return list;
}

/** 새 게임. GameState.cs:60 NewGame */
export function createGame({ seed = 1, clubName, clubCity, unlimitedTickets = false, useClubTactics = false, evaluation = 'sim' } = {}) {
  const state = {
    version: 2,
    seed: seed | 0,
    seedIndex: 0,
    clubId: 'u01',
    clubName: (clubName && String(clubName).trim()) || '새록 스프라우츠',
    clubCity: clubCity || '새록시',
    season: 1,
    tickets: ECONOMY.initialTickets,
    gold: ECONOMY.initialGold,   // league-and-economy.md B.1 골드(신설)
    fragments: 0,
    wins: 0,
    losses: 0,
    trainingCount: 0,
    instanceCounter: 0,
    unlimitedTickets,
    firstRunRewardGiven: false,
    pitySR: 0,
    pitySSR: 0,
    scoutCount: 0,
    ownedCards: {},
    instances: [],
    lineupStarters: null,
    lineupLibero: null,
    history: [],
    winsByClub: {},
    lossesByClub: {},
    useClubTactics,
    evaluationMode: evaluation, // 'sim' | 'stub'
    // 리그 시즌 계층(season.js). null = 아직 시즌을 시작하지 않음(친선경기 모드).
    league: null,
    leagueHistory: [],          // 지난 시즌 결산 목록 (A.5.2)
    clubRecords: newClubRecords(), // 통산 기록 (A.5.1 "구단 기록")
    milestonesGiven: [],        // 육성 누적 마일스톤 중복 지급 방지 (C.3)
  };
  state.fillers = createFillers(state);
  return state;
}

/** 통산 구단 기록(영구 보존). league-and-economy.md A.5.1 */
function newClubRecords() {
  return { titles: 0, bestRank: 0, seasons: 0, mostPoints: 0, longestWinStreak: 0, totalWins: 0, totalLosses: 0, ranks: [] };
}

// ---------------------------------------------------------------- 지갑 (league-and-economy.md B.1)
/** 티켓 지급(상한 999). */
export function addTickets(state, n) {
  if (!n) return 0;
  const before = state.tickets;
  state.tickets = Math.min(ECONOMY.ticketCap, state.tickets + n);
  return state.tickets - before;
}
/** 골드 지급(상한 9,999,999). */
export function addGold(state, n) {
  if (!n) return 0;
  const before = state.gold | 0;
  state.gold = Math.min(ECONOMY.goldCap, before + n);
  return state.gold - before;
}
/** 골드 차감. 부족하면 false, 상태 불변. */
export function spendGold(state, n) {
  if ((state.gold | 0) < n) return false;
  state.gold -= n;
  return true;
}
/** 조각 n 개 지급 → 12개마다 티켓 1. 변환된 티켓 수를 돌려준다. */
export function addFragments(state, n) {
  let converted = 0;
  for (let i = 0; i < n; i++) if (addFragment(state)) converted++;
  return converted;
}

const HISTORY_CAP = 60;
function addHistory(state, line) {
  state.history.push(line);
  if (state.history.length > HISTORY_CAP) state.history.splice(0, state.history.length - HISTORY_CAP);
}

// ---------------------------------------------------------------- 저장/불러오기
/**
 * 저장용 순수 객체. 파생 가능한 값(연습생 · 인스턴스의 이름/포지션/초기스탯/OVR/등급 등)은
 * 저장하지 않고 불러올 때 카드 데이터에서 다시 계산한다 → localStorage 용량 절약.
 */
export function saveGame(state) {
  return {
    v: state.version,
    seed: state.seed, si: state.seedIndex,
    club: [state.clubId, state.clubName, state.clubCity],
    season: state.season,
    tk: state.tickets, gd: state.gold | 0, fr: state.fragments,
    ms: state.milestonesGiven || [],
    w: state.wins, l: state.losses,
    tc: state.trainingCount, ic: state.instanceCounter,
    ut: state.unlimitedTickets ? 1 : 0,
    fr1: state.firstRunRewardGiven ? 1 : 0,
    pty: [state.pitySR, state.pitySSR, state.scoutCount],
    own: state.ownedCards,
    ins: state.instances.map(i => ({
      i: i.instanceId, c: i.cardId,
      f: i.finalStats, p: i.potential,
      h: i.hints, r: i.runIndex, rep: i.isRepresentative ? 1 : 0,
      cp: [i.camp.wins, i.camp.losses, i.camp.absent, i.camp.mvp, i.camp.injuries, i.camp.severeInjuries,
        i.camp.hotTrains, i.camp.rests, i.camp.trains, i.camp.bestConditionTurns, i.camp.turnsLost],
      cn: i.camp.supporterNames,
      pn: i.camp.policyName,
    })),
    lu: state.lineupStarters,
    lb: state.lineupLibero,
    hi: state.history,
    wc: state.winsByClub, lc: state.lossesByClub,
    ct: state.useClubTactics ? 1 : 0,
    em: state.evaluationMode,
    // 리그 시즌 계층 (league-and-economy.md C.3 LeagueState)
    lg: state.league ? packLeague(state.league) : null,
    lh: state.leagueHistory || [],
    cr: state.clubRecords || newClubRecords(),
  };
}

/**
 * 시즌 상태 압축. 대진·경기 결과·개인 기록만 남기고 순위표는 불러올 때 결과에서 재계산한다
 * (저장 용량 절약 + 순위표와 결과의 불일치 원천 차단). league-and-economy.md C.3
 */
function packLeague(L) {
  return {
    n: L.number, ph: L.phase, md: L.matchday, tl: L.trainingsLeft,
    ss: L.seasonSeed, tm: L.teams,
    sc: L.schedule.map(rd => rd.map(f => [f.h, f.a])),
    rs: L.results.map(rd => rd.map(r => (r ? [r.hs, r.as, r.hp, r.ap] : null))),
    ps: packPlayerStats(L.playerStats),
    bk: L.bracket,
    tr: L.trainingBase | 0,
    st: L.settlement || null,
  };
}
const PSTAT_KEYS = ['matches', 'points', 'kills', 'attacks', 'attackErrors', 'blockKills', 'aces', 'digs', 'receptions', 'receptionPerfect'];
function packPlayerStats(ps) {
  const out = {};
  for (const id of Object.keys(ps)) {
    const v = ps[id];
    out[id] = [v.teamId, v.name, v.positionCode].concat(PSTAT_KEYS.map(k => v[k] | 0));
  }
  return out;
}
function unpackPlayerStats(o) {
  const out = {};
  for (const id of Object.keys(o || {})) {
    const a = o[id];
    const v = { playerId: id, teamId: a[0], name: a[1], positionCode: a[2] };
    for (let i = 0; i < PSTAT_KEYS.length; i++) v[PSTAT_KEYS[i]] = a[3 + i] | 0;
    out[id] = v;
  }
  return out;
}
/** 저장본 → 시즌 상태(순위표 재계산은 season.js 가 맡는다). */
export function unpackLeague(j) {
  if (!j) return null;
  return {
    number: j.n, phase: j.ph, matchday: j.md | 0, trainingsLeft: j.tl | 0,
    seasonSeed: j.ss, teams: j.tm,
    schedule: j.sc.map(rd => rd.map(f => ({ h: f[0], a: f[1] }))),
    results: j.rs.map(rd => rd.map(r => (r ? { hs: r[0], as: r[1], hp: r[2], ap: r[3] } : null))),
    playerStats: unpackPlayerStats(j.ps),
    bracket: j.bk || null,
    trainingBase: j.tr | 0,
    settlement: j.st || null,
    table: null, // season.js standings() 가 results 에서 재계산
  };
}

/** 저장 JSON(또는 문자열) → GameState. */
export function loadGame(json) {
  const j = typeof json === 'string' ? JSON.parse(json) : json;
  const state = createGame({ seed: j.seed, clubName: j.club[1], clubCity: j.club[2] });
  state.version = j.v;
  state.seedIndex = j.si | 0;
  state.clubId = j.club[0];
  state.season = j.season || 1;
  state.tickets = j.tk | 0;
  state.gold = j.gd === undefined ? ECONOMY.initialGold : (j.gd | 0); // 구 세이브 마이그레이션: 초기 골드 지급
  state.fragments = j.fr | 0;
  state.milestonesGiven = j.ms || [];
  state.wins = j.w | 0;
  state.losses = j.l | 0;
  state.trainingCount = j.tc | 0;
  state.instanceCounter = j.ic | 0;
  state.unlimitedTickets = !!j.ut;
  state.firstRunRewardGiven = !!j.fr1;
  state.pitySR = j.pty ? j.pty[0] : 0;
  state.pitySSR = j.pty ? j.pty[1] : 0;
  state.scoutCount = j.pty ? j.pty[2] : 0;
  state.ownedCards = j.own || {};
  state.instances = (j.ins || []).map(rehydrateInstance).filter(Boolean);
  state.lineupStarters = j.lu || null;
  state.lineupLibero = j.lb || null;
  state.history = j.hi || [];
  state.winsByClub = j.wc || {};
  state.lossesByClub = j.lc || {};
  state.useClubTactics = !!j.ct;
  state.evaluationMode = j.em || 'sim';
  state.league = unpackLeague(j.lg);           // 구 세이브(시즌 없음)면 null
  state.leagueHistory = j.lh || [];
  state.clubRecords = j.cr || newClubRecords();
  state.fillers = createFillers(state);
  if (state.lineupStarters && !lineupValid(state)) { state.lineupStarters = null; state.lineupLibero = null; }
  return state;
}

/** 저장된 최소 정보 + 카드 데이터 → 인스턴스 복원(OVR·등급·도달률·스킬 레벨 재계산). */
function rehydrateInstance(s) {
  const card = CARD_BY_ID.get(s.c);
  if (!card) return null;
  const finalStats = s.f.slice();
  const potential = s.p.slice();
  const initialStats = card.stats.slice();
  const ovr = ovrOf(TRAINING_CFG, finalStats, card.pos);
  const c3 = TRAINING_CFG.core3[card.pos];
  let cn = 0, cd = 0, an = 0, ad = 0;
  for (const k of c3) { cn += finalStats[k] - initialStats[k]; cd += potential[k] - initialStats[k]; }
  for (let i = 0; i < 10; i++) if (potential[i] > initialStats[i]) { an += finalStats[i] - initialStats[i]; ad += potential[i] - initialStats[i]; }
  const cp = s.cp || [];
  return {
    instanceId: s.i, cardId: s.c, name: card.name, pos: card.pos, rarity: card.rarity,
    clubId: card.teamId, jersey: card.jersey, heightCm: card.heightCm, age: card.age,
    skillName: card.skillName,
    finalStats, initialStats, potential,
    ovr, grade: gradeOf(TRAINING_CFG, ovr),
    completion: cd > 0 ? cn / cd : 1, allReach: ad > 0 ? an / ad : 1,
    hints: s.h | 0, skillLevel: skillLevelForHints(TRAINING_CFG, s.h | 0),
    camp: {
      wins: cp[0] | 0, losses: cp[1] | 0, absent: cp[2] | 0, mvp: cp[3] | 0,
      injuries: cp[4] | 0, severeInjuries: cp[5] | 0, hotTrains: cp[6] | 0, rests: cp[7] | 0,
      trains: cp[8] | 0, bestConditionTurns: cp[9] | 0, turnsLost: cp[10] | 0,
      supporterNames: s.cn || [], policyName: s.pn || '',
    },
    runIndex: s.r | 0, isRepresentative: !!s.rep,
  };
}

// ---------------------------------------------------------------- 스카우트
export function representatives(state) { return state.instances.filter(i => i.isRepresentative); }
export function representativeOf(state, cardId) { return state.instances.find(i => i.isRepresentative && i.cardId === cardId) || null; }
/**
 * 스카우트 1회 비용. league-and-economy.md B.2.1
 * 일반 = 티켓 1 / 포지션 지정 = 티켓 1 + 골드 1,200
 */
export function scoutCost(opts = {}) {
  const targeted = opts.position !== undefined && opts.position !== null && opts.position !== '';
  return { tickets: 1, gold: targeted ? ECONOMY.positionScoutGold : 0, targeted };
}
/** 지정 스카우트는 골드가 모자라면 막힌다(B.2.1). */
export function canScout(state, opts = {}) {
  const c = scoutCost(opts);
  if (!state.unlimitedTickets && state.tickets < c.tickets) return false;
  if (c.gold > 0 && (state.gold | 0) < c.gold) return false;
  return true;
}

/** 스카우트 확률 표기용 상수(국내 확률형 아이템 표시 의무 전제, B.2.3). */
export const SCOUT_RATES = { R: ECONOMY.scoutR, SR: ECONOMY.scoutSR, SSR: ECONOMY.scoutSSR };

/**
 * 스카우트 1회. R 80 / SR 17 / SSR 3%, 천장 SR+ 10 · SSR 60(공유 카운터).
 * Game.cs:41 Scout + league-and-economy.md B.2.2
 * @param {object} state
 * @param {{position?: string}} [opts] position 지정 시 해당 포지션 풀만(포지션 지정 스카우트)
 * @returns {{card, isDuplicate, fragments, pity, limitBreak, rarity, tickets}}
 */
export function scout(state, opts = {}) {
  const cost = scoutCost(opts);
  if (!state.unlimitedTickets && state.tickets < cost.tickets) throw new Error('스카우트 티켓이 없습니다');
  if (cost.gold > 0 && (state.gold | 0) < cost.gold) throw new Error(`포지션 지정 스카우트는 골드 ${cost.gold} 이 필요합니다 (보유 ${state.gold | 0})`);
  if (!state.unlimitedTickets) state.tickets -= cost.tickets;
  if (cost.gold > 0) state.gold -= cost.gold;
  const rng = new Rng(nextSeed(state));
  state.scoutCount++;
  state.pitySR++;
  state.pitySSR++;

  let rarity, triggered = null;
  if (state.pitySSR >= ECONOMY.pitySSR) { rarity = RARITY.SSR; triggered = 'ssr'; }
  else if (state.pitySR >= ECONOMY.pitySR) {
    // SSR 비중 = 3 / (3 + 17)
    rarity = rng.nextDouble() < ECONOMY.scoutSSR / (ECONOMY.scoutSSR + ECONOMY.scoutSR) ? RARITY.SSR : RARITY.SR;
    triggered = 'sr';
  } else {
    const r = rng.nextDouble();
    rarity = r < ECONOMY.scoutR ? RARITY.R : (r < ECONOMY.scoutR + ECONOMY.scoutSR ? RARITY.SR : RARITY.SSR);
  }
  if (rarity >= RARITY.SR) state.pitySR = 0;
  if (rarity === RARITY.SSR) state.pitySSR = 0;

  const wantPos = opts.position != null ? (typeof opts.position === 'string' ? POS_CODES.indexOf(opts.position) : opts.position) : -1;
  // A.3.6 은퇴한 선수는 공개 명단에서 빠진다 — 스카우트할 수 없다.
  const pool = activeCardPool(state);
  let cands = pool.filter(p => p.rarity === rarity && (wantPos < 0 || p.pos === wantPos));
  if (cands.length === 0) cands = pool.filter(p => wantPos < 0 || p.pos === wantPos);
  if (cands.length === 0) cands = pool.length > 0 ? pool : CARD_POOL;
  const card = cands[rng.nextInt(cands.length)];

  const owned = Object.prototype.hasOwnProperty.call(state.ownedCards, card.id);
  let gainedFragments = 0;
  if (owned) {
    state.ownedCards[card.id] = Math.min(ECONOMY.maxLimitBreak, state.ownedCards[card.id] + 1);
    gainedFragments = ECONOMY.duplicateFragments;
    for (let i = 0; i < gainedFragments; i++) addFragment(state);
  } else {
    state.ownedCards[card.id] = 0;
  }
  addHistory(state, `스카우트: ${card.name} ${POS_CODES[card.pos]} ${RARITIES[card.rarity]}${owned ? ' (중복 → 한계돌파)' : ''}${triggered ? ' [천장 보장]' : ''}`);

  return {
    card,
    rarity: RARITIES[rarity],
    isDuplicate: owned,
    limitBreak: state.ownedCards[card.id],
    fragments: { total: state.fragments, gained: gainedFragments, perTicket: ECONOMY.fragmentsPerTicket },
    pity: {
      triggered,
      srIn: Math.max(0, ECONOMY.pitySR - state.pitySR),
      ssrIn: Math.max(0, ECONOMY.pitySSR - state.pitySSR),
      srCounter: state.pitySR, ssrCounter: state.pitySSR,
    },
    tickets: state.tickets,
    gold: state.gold | 0,
    cost,
  };
}

/** 조각 +1. 3개면 티켓 1로 변환. Game.cs:136 AddFragment */
function addFragment(state) {
  state.fragments++;
  if (state.fragments < ECONOMY.fragmentsPerTicket) return false;
  state.fragments -= ECONOMY.fragmentsPerTicket;
  state.tickets++;
  return true;
}

/** 육성 시작용 카드(한계돌파 반영 잠재력). Game.cs:59 TrainingCard */
export function trainingCard(state, cardId) {
  const base = CARD_BY_ID.get(cardId);
  if (!base) throw new Error('알 수 없는 카드: ' + cardId);
  if (isRetiredAge(base.age, base.pos, state.season)) throw new Error('은퇴한 선수는 육성할 수 없습니다: ' + base.name);
  const c = clonePlayer(base);
  const lb = state.ownedCards[cardId] || 0;
  if (lb > 0) for (let i = 0; i < 10; i++) c.potential[i] = clampStat(c.potential[i] + lb * ECONOMY.limitBreakPotential);
  return c;
}

// ---------------------------------------------------------------- 서포터
export function supporterCandidates(state, traineeCardId) {
  return representatives(state).filter(i => i.cardId !== traineeCardId).map(instanceToSupporter);
}

function instanceToSupporter(inst) {
  return { id: inst.instanceId, name: inst.name, pos: inst.pos, clubId: inst.clubId, stats: inst.finalStats.slice() };
}

/** 추천 서포터 id 배열. Game.cs:72 RecommendSupporters */
export function recommendSupporters(state, cardId) {
  const card = CARD_BY_ID.get(cardId);
  if (!card) throw new Error('알 수 없는 카드: ' + cardId);
  const list = recommendSupporterList(card.pos, card.teamId, supporterCandidates(state, cardId), TRAINING_CFG, TRAINING_CFG.supporterSlots);
  return list.map(s => s.id);
}

// ---------------------------------------------------------------- 육성
function evaluationProvider(state) {
  return state.evaluationMode === 'stub' ? stubEvaluationProvider : simEvaluationProvider;
}

/** 육성 세션 시작. Game.cs:80 NewSession */
export function startTraining(state, cardId, supporterIds) {
  const card = trainingCard(state, cardId);
  const ids = new Set(supporterIds || []);
  const sups = supporterCandidates(state, cardId).filter(s => ids.has(s.id));
  const support = sups.length > 0 ? buildSupport(card.pos, card.teamId, sups, TRAINING_CFG) : emptySupport(TRAINING_CFG);
  const session = new TrainingSession(card, support, TRAINING_CFG, evaluationProvider(state), nextSeed(state));
  session.instanceId = `${card.id}#${++state.instanceCounter}`;
  session.game = state;
  return session;
}

const ACTION_IDS = ['serve', 'receive', 'set', 'spike', 'block', 'rest', 'special'];

/** 현재 턴 선택지(예상 상승치·피로·부상 배지 포함). 이벤트 대기 중이면 이벤트 선택지. */
export function trainingOptions(session) {
  const tr = session.trainee, cfg = session.cfg;
  const head = {
    turn: session.turn, totalTurns: cfg.turns,
    fatigue: Math.round(tr.fatigue * 10) / 10,
    zone: session.zone, zoneLabel: ZONE_NAMES_KO[session.zone],
    condition: tr.condition, conditionLabel: COND_NAMES_KO[tr.condition], conditionArrow: COND_ARROWS[tr.condition],
    combo: tr.combo, hints: tr.hints,
    ovr: Math.round(session.currentOvr * 10) / 10,
    initialOvr: Math.round(session.initialOvr * 10) / 10,
    stats: Array.from(tr.current, v => Math.round(v * 10) / 10),
    potential: Array.from(tr.potential),
    treating: session.isTreating, treatmentTurnsLeft: tr.treatmentTurnsLeft,
    isEvalTurn: isEvalTurn(cfg, session.turn),
    injuries: tr.injuries, severeInjuries: tr.severeInjuries,
  };
  if (session.phase === PHASE.Graduated) {
    return { ...head, kind: 'graduated', options: [], event: null };
  }
  if (session.phase === PHASE.AwaitEventChoice) {
    const ev = session.pendingEvent;
    return {
      ...head, kind: 'event',
      event: { id: ev.id, kind: ev.kind, title: ev.title, text: ev.text, supporterName: ev.supporterName },
      options: ev.choices.map((c, i) => ({
        id: 'event:' + i, index: i, label: c.label,
        isBranch: c.isBranch, successRate: c.successRate,
        effect: effectBadge(c.onSuccess),
        failEffect: c.onFail ? effectBadge(c.onFail) : null,
        recommended: i === ev.oracleChoice,
      })),
    };
  }
  return { ...head, kind: 'action', event: null, options: session.getOptions() };
}

/**
 * 선택 적용(행동 또는 이벤트 선택). choiceId 는 'spike' / 'rest' / 'special' / 'event:0' 등.
 * @returns {{events: Array, nextState: object}}
 */
export function applyTrainingChoice(session, choiceId) {
  const events = [];
  if (session.phase === PHASE.Graduated) throw new Error('이미 졸업한 세션입니다');

  if (session.phase === PHASE.AwaitEventChoice) {
    const idx = typeof choiceId === 'number' ? choiceId : parseInt(String(choiceId).replace('event:', ''), 10) || 0;
    const ev = session.pendingEvent;
    const outcome = session.resolveEvent(idx);
    events.push({
      type: 'event', title: ev.title, text: ev.text,
      choice: ev.choices[outcome.choiceIndex].label,
      branch: ev.choices[outcome.choiceIndex].isBranch, success: outcome.success,
      resultText: outcome.applied.resultText, badge: effectBadge(outcome.applied),
    });
  } else {
    let action;
    if (typeof choiceId === 'number') action = choiceId;
    else {
      action = ACTION_IDS.indexOf(String(choiceId));
      if (action < 0) throw new Error('알 수 없는 선택: ' + choiceId);
    }
    const beforeTurn = session.turn;
    const rec = session.apply(action);
    events.push(turnEvent(session, rec, beforeTurn));
    if (rec.event) {
      const e = rec.event;
      events.push({
        type: 'event', title: e.event.title, text: e.event.text,
        choice: e.event.choices[e.choiceIndex].label, branch: e.event.choices[e.choiceIndex].isBranch,
        success: e.success, resultText: e.applied.resultText, badge: effectBadge(e.applied),
      });
    }
  }

  // 턴 처리 도중 발생한 평가전·졸업 알림
  const last = session.log[session.log.length - 1];
  if (last && last.eval && !last._evalReported) {
    last._evalReported = true;
    const o = last.eval;
    events.push({
      type: 'evaluation', round: o.round, turn: o.turn, absent: o.absent,
      opponent: o.opponentName, strength: o.opponentStrength,
      won: o.won, performance: Math.round(o.performance * 10) / 10, scoreLine: o.scoreLine,
      mvp: o.mvp, coreGain: o.coreGain, hint: o.hint, highlights: o.highlights || [],
      text: o.absent
        ? `평가전 결장 (부상 치료 중)`
        : `평가전 ${o.round + 1}차 vs ${o.opponentName}(강도 ${o.opponentStrength}) — ${o.won ? '승' : '패'} ${o.scoreLine} · 활약도 ${o.performance.toFixed(0)}${o.mvp ? ' MVP!' : ''}`,
    });
  }
  if (session.phase === PHASE.Graduated) {
    events.push({ type: 'graduated', text: '캠프 종료 — 졸업 심사로 넘어갑니다.' });
  }
  return { events, nextState: trainingOptions(session) };
}

function turnEvent(session, rec, turn) {
  const gains = [];
  for (const k of Object.keys(rec.gains)) {
    const v = rec.gains[k];
    if (v > 0.05) gains.push({ stat: k | 0, value: Math.round(v * 10) / 10 });
  }
  const losses = [];
  for (const k of Object.keys(rec.losses)) losses.push({ stat: k | 0, value: rec.losses[k] });
  return {
    type: 'turn', turn,
    action: rec.action, actionLabel: rec.action === ACT.Special ? SPECIAL_NAMES_KO[rec.specialKind] : ACT_NAMES_KO[rec.action],
    zone: rec.zone, zoneLabel: ZONE_NAMES_KO[rec.zone], zoneMult: rec.zoneMult,
    comboBefore: rec.comboBefore,
    fatigue: [Math.round(rec.fatigueBefore * 10) / 10, Math.round(rec.fatigueAfter * 10) / 10],
    condition: [rec.conditionBefore, rec.conditionAfter],
    conditionLabel: COND_NAMES_KO[rec.conditionAfter],
    injury: rec.injury, injuryLabel: rec.injury === INJURY.Severe ? '중상' : (rec.injury === INJURY.Light ? '경상' : null),
    injuryP: rec.injuryP, gains, losses, flavor: rec.flavor,
    shallowRest: rec.shallowRest,
  };
}

/**
 * 졸업 처리. decision: 0 대표 교체 / 1 보관 / 2 방출(대표가 이미 있을 때만 의미).
 * Game.cs:104 Graduate
 */
export function graduate(session, decision = 0) {
  if (session.phase !== PHASE.Graduated) throw new Error('아직 캠프가 끝나지 않았습니다');
  const state = session.game;
  const r = session.result;
  const inst = r.instance;
  if (!state) {
    return { instance: inst, grade: GRADE_NAMES[inst.grade], ovr: inst.ovr, deltas: r.deltas, skillLevel: r.skillLevel, summary: r.comment };
  }
  state.trainingCount++;
  inst.runIndex = state.trainingCount;
  const rep = representativeOf(state, inst.cardId);
  let msg;
  if (rep === null) {
    inst.isRepresentative = true;
    state.instances.push(inst);
    msg = '로스터에 편입';
  } else if (decision === 0) {
    rep.isRepresentative = false;
    inst.isRepresentative = true;
    state.instances.push(inst);
    msg = `대표 교체 (기존 OVR ${rep.ovr.toFixed(1)} → 보관함)`;
  } else if (decision === 1) {
    inst.isRepresentative = false;
    state.instances.push(inst);
    msg = '보관함에 보관';
  } else {
    msg = '방출 (스카우트 조각 +1)' + (addFragment(state) ? ' → 조각 3개로 티켓 +1' : '');
  }
  // league-and-economy.md A.5.1 육성 졸업 보상: 등급별 골드 · 첫 완주 · 누적 마일스톤
  const gradeName = GRADE_NAMES[inst.grade];
  const gradGold = REWARDS.graduationGold[gradeName] || 0;
  if (gradGold > 0) { addGold(state, gradGold); msg += ` · 졸업 보상 골드 +${gradGold}`; }
  if (!state.firstRunRewardGiven) {
    state.firstRunRewardGiven = true;
    addTickets(state, REWARDS.firstGraduationTicket);
    msg += ` · 첫 완주 보상 티켓 +${REWARDS.firstGraduationTicket}`;
  }
  if (!state.milestonesGiven) state.milestonesGiven = [];
  for (const key of Object.keys(REWARDS.trainingMilestones)) {
    const need = key | 0;
    if (state.trainingCount >= need && state.milestonesGiven.indexOf(need) < 0) {
      state.milestonesGiven.push(need);
      const n = REWARDS.trainingMilestones[key];
      addTickets(state, n);
      msg += ` · 육성 ${need}회 마일스톤 티켓 +${n}`;
    }
  }
  // 시즌 진행 중이면 이번 매치데이의 육성 슬롯 1개를 소비한다(league-and-economy.md A.2.1)
  if (state.league && state.league.trainingsLeft > 0) state.league.trainingsLeft--;
  addHistory(state, `졸업 #${state.trainingCount}: ${inst.name} ${POS_CODES[inst.pos]} OVR ${inst.ovr.toFixed(1)} ${GRADE_NAMES[inst.grade]} (${msg})`);
  if (state.lineupStarters && !lineupValid(state)) { state.lineupStarters = null; state.lineupLibero = null; }

  return {
    instance: inst,
    grade: GRADE_NAMES[inst.grade],
    ovr: Math.round(inst.ovr * 10) / 10,
    deltas: r.deltas,
    skillLevel: r.skillLevel,
    unlockedSkills: r.unlockedSkills,
    completion: r.coreReach,
    allReach: r.allReach,
    hints: r.hints,
    evaluations: r.evaluations,
    camp: campLine(r.camp),
    roster: msg,
    summary: `${inst.name} ${POS_CODES[inst.pos]} · OVR ${inst.ovr.toFixed(1)} ${GRADE_NAMES[inst.grade]} · 완성도 ${(r.coreReach * 100).toFixed(0)}% · ${campLine(r.camp)} — ${r.comment}`,
  };
}

/** 인스턴스 보관함 관리(대표 승격 / 방출). Game.cs:129 */
export function promoteInstance(state, instanceId) {
  const inst = state.instances.find(i => i.instanceId === instanceId);
  if (!inst) return false;
  for (const i of state.instances) if (i.cardId === inst.cardId) i.isRepresentative = false;
  inst.isRepresentative = true;
  if (state.lineupStarters && !lineupValid(state)) { state.lineupStarters = null; state.lineupLibero = null; }
  return true;
}

export function releaseInstance(state, instanceId) {
  const idx = state.instances.findIndex(i => i.instanceId === instanceId);
  if (idx < 0) return false;
  state.instances.splice(idx, 1);
  addFragment(state);
  if (state.lineupStarters && !lineupValid(state)) { state.lineupStarters = null; state.lineupLibero = null; }
  return true;
}

// ---------------------------------------------------------------- 라인업
function instanceToPlayer(inst, teamId, season) {
  const p = makePlayer({
    id: inst.instanceId, name: inst.name, teamId, pos: inst.pos, rarity: inst.rarity,
    jersey: inst.jersey, heightCm: inst.heightCm, age: inst.age,
    stats: inst.finalStats.slice(), potential: inst.finalStats.slice(),
    skillName: inst.skillName,
    // 육성 힌트로 해금한 고유 스킬 레벨(0~3)이 그대로 경기 판정에 들어간다. docs/skills.md 3절
    skillLevel: inst.skillLevel | 0,
  });
  return agedPlayer(p, season, true);      // A.3.6 노화 — 전성기 이후 실효 스탯 하락
}

/**
 * 내 로스터 = (은퇴하지 않은) 대표 인스턴스 + 연습생. Game.cs:145 MyRoster
 * 은퇴한 인스턴스는 코트에 서지 못하지만 state.instances 에는 남아 서포터(코치)로 계속 쓸 수 있다(A.3.6).
 */
export function myRoster(state) {
  const list = [];
  for (const i of representatives(state)) {
    if (isRetiredAge(i.age, i.pos, state.season)) continue;
    list.push(instanceToPlayer(i, state.clubId, state.season));
  }
  for (const f of state.fillers) list.push(f);
  return list;
}

/** 은퇴한 대표 인스턴스(코치·서포터로만 남는다). UI 결산 화면용. */
export function retiredRepresentatives(state) {
  return representatives(state).filter(i => isRetiredAge(i.age, i.pos, state.season));
}

/** 인스턴스의 현재 나이·단계·실효 배수 — UI 표기용. */
export function instanceAgeInfo(state, inst) {
  return {
    age: ageAt(inst.age, state.season),
    phase: agePhase(inst.age, inst.pos, state.season),
    factor: ageFactor(inst.age, inst.pos, state.season),
    retireAt: AGING.retireAge + (AGING.retireByPos[inst.pos | 0] || 0),
    peakEnd: AGING.peakEnd + (AGING.peakEndByPos[inst.pos | 0] || 0),
  };
}

export function myTeam(state) {
  return {
    id: state.clubId, name: state.clubName, city: state.clubCity,
    homeArena: state.clubCity + ' 신생 체육관',
    colors: { primary: '#2E8B57', secondary: '#F5F5DC' },
  };
}

export function lineupValid(state) {
  if (!state.lineupStarters) return false;
  try {
    const roster = myRoster(state);
    const ts = makeTeamState(myTeam(state), roster, { startingIds: state.lineupStarters.slice(), liberoId: state.lineupLibero, benchIds: [] });
    validateTeamState(ts);
    return true;
  } catch { return false; }
}

/**
 * 내 팀 상태(수동 라인업이 유효하면 그것, 아니면 자동). Game.cs:159 MyTeamState
 * 리그는 매치데이마다 이 함수를 여러 번 부르므로 로스터·TeamState 를 한 번만 만든다
 * (validateTeamState 는 선발 6 + 리베로만 보므로 벤치를 채운 채 검증해도 결과가 같다).
 */
export function myTeamState(state) {
  const roster = myRoster(state);
  if (state.lineupStarters) {
    const lineup = { startingIds: state.lineupStarters.slice(), liberoId: state.lineupLibero, benchIds: [] };
    for (const p of roster) if (lineup.startingIds.indexOf(p.id) < 0 && p.id !== state.lineupLibero) lineup.benchIds.push(p.id);
    const ts = makeTeamState(myTeam(state), roster, lineup, { tactics: defaultTactics() });
    try { validateTeamState(ts); return ts; } catch { /* 무효 → 자동 편성 */ }
  }
  return makeTeamState(myTeam(state), roster, autoLineupFromRoster(roster), { tactics: defaultTactics() });
}

/** 자동 편성. Game.cs:175 AutoLineup */
export function autoLineup(state) {
  const l = autoLineupFromRoster(myRoster(state));
  state.lineupStarters = l.startingIds.slice();
  state.lineupLibero = l.liberoId;
  return { startingIds: state.lineupStarters.slice(), liberoId: state.lineupLibero };
}

/** 슬롯(0~5 선발, 6 리베로)에 선수 배치. 유효하지 않으면 false. Game.cs:182 SetLineupSlot */
export function setLineupSlot(state, slot, playerId) {
  if (!state.lineupStarters) autoLineup(state);
  const starters = state.lineupStarters.slice();
  let libero = state.lineupLibero;
  const roster = myRoster(state);
  const p = roster.find(x => x.id === playerId);
  if (!p) return false;
  if (slot === 6) {
    if (!p.isLibero) return false;
    libero = playerId;
  } else {
    if (slot < 0 || slot > 5) return false;
    if (p.isLibero) return false;
    const existing = starters.indexOf(playerId);
    if (existing >= 0) starters[existing] = starters[slot];
    starters[slot] = playerId;
  }
  try {
    const ts = makeTeamState(myTeam(state), roster, { startingIds: starters, liberoId: libero, benchIds: [] });
    validateTeamState(ts);
  } catch { return false; }
  state.lineupStarters = starters;
  state.lineupLibero = libero;
  return true;
}

/** 라인업 7명의 포지션 OVR 평균. Game.cs:225 LineupOvr */
export function lineupOvr(state) {
  const ts = myTeamState(state);
  let sum = 0, n = 0;
  for (const id of ts.lineup.startingIds.concat([ts.lineup.liberoId])) {
    const p = ts.index.get(id);
    if (!p) continue;
    sum += ovrOf(TRAINING_CFG, p.stats, p.pos);
    n++;
  }
  return n === 0 ? 0 : sum / n;
}

// ---------------------------------------------------------------- AI 구단(개선 2건)
/**
 * [개선 A] AI 구단 선수는 초기치가 아니라 시즌 사다리로 성장한 버전으로 출전한다.
 * 실효 스탯 = round(clamp(stats + g × (potential − stats), 0, 100)), 시즌 1 = 35%.
 * league-and-economy.md A.3.1 (프로토타입 C# Game.ClubTeamState 는 OpponentGrowth 기본 0 = 초기치 그대로였다)
 */
function grownPlayer(p, g) {
  if (g <= 0) return p;
  const c = clonePlayer(p);
  for (let i = 0; i < 10; i++) c.stats[i] = clampStat(roundHalfEven(p.stats[i] + g * (p.potential[i] - p.stats[i])));
  return c;
}

/** 플레이어가 졸업시킨 카드 id 집합(= 원소속 구단에서 빠진 선수). */
export function departedCardIds(state) {
  const s = new Set();
  for (const i of state.instances) s.add(i.cardId);
  return s;
}

/**
 * [개선 B] 스카우트해 졸업시킨 선수는 원소속 구단 라인업에서 빠지고,
 * 같은 포지션의 연습생급 대체 선수(구단 평균 − 8)가 그 자리를 채운다.
 * league-and-economy.md A.3.5 (C# 프로토타입은 미구현이라 원소속에서도 계속 뛰었다)
 */
export function clubTeamState(state, clubId, opts = {}) {
  const club = CLUB_BY_ID.get(clubId);
  if (!club) throw new Error('알 수 없는 구단: ' + clubId);
  const pool = POOL_BY_CLUB.get(clubId) || [];
  const g = opts.growth !== undefined ? opts.growth : growthFor(state.season);
  const departed = opts.departed || departedCardIds(state);

  // 구단 평균(전체 7명 성장 기준) — 결원이 늘어도 대체 선수 강도가 흔들리지 않게 원본 기준으로 고정
  let avg = 0;
  for (const p of pool) avg += statAverage(grownPlayer(p, g).stats);
  avg = pool.length > 0 ? avg / pool.length : 60;
  const subOverall = avg + VACANCY.overallDelta;

  // AI 구단 선수의 고유 스킬 레벨(시즌 사다리). docs/skills.md 7.2
  const clubSkill = opts.clubSkillLevel !== undefined ? (opts.clubSkillLevel | 0) : clubSkillLevelFor(state.season);

  const season = opts.season !== undefined ? (opts.season | 0) : (state.season | 0);
  const roster = [];
  let gone = 0;
  for (const p of pool) {
    if (departed.has(p.id)) {
      const gp0 = grownPlayer(p, g);
      gone++;
      if (gone > VACANCY.traineeSlots) {
        // A.3.5 결원 상한 — 주전 절반 이상이 빠지면 구단도 육성 선수로 버티지 않고 즉시전력을 영입한다.
        const sign = generatePlayer(new Rng(hashString(clubId + '/' + p.id + '/sign')), `${clubId}-sign-${p.id}`, clubId, p.pos, statAverage(gp0.stats), 3.0);
        shiftToOvr(sign, ovrOf(TRAINING_CFG, gp0.stats, gp0.pos) + VACANCY.signingOvrDelta);
        sign.rarity = RARITY.N;
        sign.age = AGING.clubRecruitAge;
        sign.name = sign.name + ' (영입)';
        sign.isSubstitute = true;
        sign.isSigning = true;
        roster.push(sign);
        continue;
      }
      const sub = generatePlayer(new Rng(hashString(clubId + '/' + p.id)), `${clubId}-sub-${p.id}`, clubId, p.pos, 80 + roster.length, subOverall, 4.0);
      sub.rarity = RARITY.N;
      sub.age = AGING.clubRecruitAge;
      sub.name = sub.name + ' (육성 선수)';
      sub.isSubstitute = true;
      roster.push(sub);
      continue;
    }
    const gp = grownPlayer(p, g);
    // A.3.6 세대교체 — 프로 구단은 노쇠한 선수를 붙잡지 않는다. 은퇴했거나 전성기를 충분히
    // 지난 선수는 같은 자리의 신인으로 교체된다(강도 = 그 선수의 성장 후 스탯 평균 + clubRecruitDelta).
    const f = ageFactor(p.age, p.pos, season);
    if (f < AGING.clubReplaceFactor || isRetiredAge(p.age, p.pos, season)) {
      const gen = Math.max(1, ageAt(p.age, season) - (AGING.peakEnd + (AGING.peakEndByPos[p.pos | 0] || 0)));
      const rec = generatePlayer(
        new Rng(hashString(clubId + '/' + p.id + '/gen' + gen)),
        `${clubId}-new-${p.id}-${gen}`, clubId, p.pos, statAverage(gp.stats), 3.0);
      // 신인의 세기는 "떠난 선수의 사다리 OVR + clubRecruitOvrDelta" 로 맞춘다.
      // generatePlayer 는 포지션 표준 프로필이라 같은 스탯 평균이어도 포지션 가중 OVR 이 낮게 나온다
      // (A.3.5 의 −4 스탯평균 = −7.4 OVR 과 같은 이유) — 그래서 OVR 공간에서 직접 맞춘다.
      shiftToOvr(rec, ovrOf(TRAINING_CFG, gp.stats, gp.pos) + AGING.clubRecruitOvrDelta);
      rec.rarity = RARITY.N;
      rec.age = AGING.clubRecruitAge;
      rec.name = rec.name + ' (신인)';
      rec.isRecruit = true;
      roster.push(rec);
      continue;
    }
    const ap = agedPlayer(gp, season, gp !== p);
    if (clubSkill > 0 && SKILL_BY_NAME.has(ap.skillName)) {
      // grownPlayer·agedPlayer 는 변화가 없으면 원본을 그대로 돌려주므로 반드시 복제한 뒤에 쓴다.
      const c = ap === p ? clonePlayer(p) : ap;
      c.skillLevel = clubSkill;
      roster.push(c);
    } else {
      roster.push(ap);
    }
  }
  const tactics = (opts.useClubTactics ?? state.useClubTactics) && CLUB_TACTICS[clubId]
    ? { ...defaultTactics(), ...CLUB_TACTICS[clubId] }
    : defaultTactics();
  return makeTeamState(club, roster, autoLineupFromRoster(roster), { tactics });
}

// ---------------------------------------------------------------- 경기
/**
 * 상대 구단과 1경기(3선승). Game.cs:266 PlayMatch
 * @returns {{setScores, won, box, events, highlights, ctx, reward, sets, eventCount, seed}}
 */
export function playMatch(state, opponentTeamId, opts = {}) {
  const club = CLUB_BY_ID.get(opponentTeamId);
  if (!club) throw new Error('알 수 없는 구단: ' + opponentTeamId);
  const home = myTeamState(state);
  const away = clubTeamState(state, opponentTeamId, opts);
  const collectEvents = opts.collectEvents !== false;
  const seed = opts.seed !== undefined ? opts.seed : nextSeed(state);
  const result = simulateMatch(home, away, seed, opts.config || null, collectEvents);
  const won = result.winner === SIDE.HOME;

  let reward = '';
  if (opts.record !== false) {
    if (won) {
      state.wins++;
      state.winsByClub[club.id] = (state.winsByClub[club.id] || 0) + 1;
      state.tickets++;
      reward = '승리 보상: 스카우트 티켓 +1';
    } else {
      state.losses++;
      state.lossesByClub[club.id] = (state.lossesByClub[club.id] || 0) + 1;
      const converted = addFragment(state);
      reward = `참가 보상: 스카우트 조각 +1 (${state.fragments}/${ECONOMY.fragmentsPerTicket})`;
      if (converted) reward += ` → 조각 ${ECONOMY.fragmentsPerTicket}개로 티켓 +1`;
    }
    addHistory(state, `경기 vs ${club.name}: ${won ? '승' : '패'} ${result.homeSets}-${result.awaySets} (${result.sets.map(s => `${s.home}-${s.away}`).join(', ')})`);
  }

  const view = formatMatchResult(result, home, away, SIDE.HOME, seed);
  view.reward = reward;
  view.opponent = { id: club.id, name: club.name };
  return view;
}

/**
 * simulateMatch 결과 → UI 표현(박스스코어·하이라이트·중계 컨텍스트).
 * 리그 경기는 내 팀이 원정일 수 있으므로 mySide 로 관점을 넘긴다.
 * `box.home`/`setScores`/`sets` 는 실제 홈·원정 기준(중계 ctx 와 일치), `box.mine`/`myScore` 가 내 관점이다.
 */
export function formatMatchResult(result, home, away, mySide, seed) {
  const homeIds = new Set(home.roster.map(p => p.id));
  const box = { home: [], away: [] };
  for (const b of result.boxScores.values()) {
    b.points = b.kills + b.blockKills + b.aces;
    b.killRate = b.attacks > 0 ? b.kills / b.attacks : 0;
    (homeIds.has(b.playerId) ? box.home : box.away).push(b);
  }
  box.home.sort((a, b) => b.points - a.points);
  box.away.sort((a, b) => b.points - a.points);
  const isHome = mySide === SIDE.HOME;
  box.mine = isHome ? box.home : box.away;
  box.opponent = isHome ? box.away : box.home;

  const players = {};
  for (const p of home.roster) players[p.id] = { id: p.id, name: p.name, jersey: p.jersey };
  for (const p of away.roster) players[p.id] = { id: p.id, name: p.name, jersey: p.jersey };
  const ctx = { players, homeName: home.team.name, awayName: away.team.name };
  const won = (result.winner === SIDE.HOME) === isHome;

  return {
    setScores: result.sets.map(s => ({ set: s.setIndex, home: s.home, away: s.away, rallies: s.rallies })),
    sets: { home: result.homeSets, away: result.awaySets },
    myScore: isHome ? result.homeSets : result.awaySets,
    oppScore: isHome ? result.awaySets : result.homeSets,
    isHome,
    won,
    box,
    events: result.events,
    eventCount: result.eventCount,
    highlights: buildHighlights(result, box, home, away, won, isHome),
    ctx,
    reward: '',
    opponent: { id: (isHome ? away : home).team.id, name: (isHome ? away : home).team.name },
    seed,
    homeTeam: { id: home.team.id, name: home.team.name },
    awayTeam: { id: away.team.id, name: away.team.name },
  };
}

function buildHighlights(result, box, home, away, won, isHome = true) {
  const h = [];
  const line = result.sets.map(s => `${s.home}-${s.away}`).join(', ');
  h.push(`${home.team.name} ${result.homeSets}-${result.awaySets} ${away.team.name} (${line})`);
  const mine = box.mine || box.home, theirs = box.opponent || box.away;
  const top = mine[0];
  if (top && top.points > 0) h.push(`${top.name} ${top.points}득점 (공격 ${top.kills}/${top.attacks}, 블로킹 ${top.blockKills}, 서브 ${top.aces})`);
  const oppTop = theirs[0];
  if (oppTop && oppTop.points > 0) h.push(`상대 최다 득점: ${oppTop.name} ${oppTop.points}점`);
  let bestRecv = null;
  for (const b of mine) if (b.receptions >= 8 && (!bestRecv || b.receptionPerfect / b.receptions > bestRecv.receptionPerfect / bestRecv.receptions)) bestRecv = b;
  if (bestRecv) h.push(`리시브: ${bestRecv.name} ${bestRecv.receptions}회 중 정확 ${bestRecv.receptionPerfect}회`);
  const hs = isHome ? result.homeStats : result.awayStats;
  h.push(`팀 공격 성공률 ${(hs.attacks > 0 ? hs.kills / hs.attacks * 100 : 0).toFixed(1)}% · 사이드아웃 ${(hs.receiveRallies > 0 ? hs.receiveRalliesWon / hs.receiveRallies * 100 : 0).toFixed(1)}%`);
  h.push(won ? '승리했습니다.' : '패배했습니다.');
  return h;
}

/** 구단 목록(라인업 OVR 포함) — UI 의 상대 선택 화면용. */
export function clubList(state) {
  return CLUBS.map(c => {
    const ts = clubTeamState(state, c.id);
    let sum = 0, n = 0;
    for (const id of ts.lineup.startingIds.concat([ts.lineup.liberoId])) {
      const p = ts.index.get(id);
      if (!p) continue;
      sum += ovrOf(TRAINING_CFG, p.stats, p.pos); n++;
    }
    return {
      id: c.id, name: c.name, city: c.city, identity: c.identity, colors: c.colors,
      lineupOvr: n > 0 ? sum / n : 0,
      wins: state.winsByClub[c.id] || 0, losses: state.lossesByClub[c.id] || 0,
      substitutes: ts.roster.filter(p => p.isSubstitute).length,
    };
  });
}

// season.js 가 쓰는 내부 헬퍼(리그 계층 전용 — UI 는 season.js 의 공개 API 를 쓴다)
export { CARD_BY_ID, CLUB_BY_ID, nextSeed, addHistory, addFragment, newClubRecords, TRAINING_CFG };
