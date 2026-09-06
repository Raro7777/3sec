// 여자 배구 매니저 — 브라우저용 순수 로직 엔진 (DOM 비참조).
// C# 원본(sim/VolleySim.*) 포팅. 자세한 정합 결과·의도적 차이는 web/PARITY.md 참조.
//
// 사용법(번들러 없이):
//   <script type="module">
//     import { createGame, playMatch, renderCommentary } from './engine.js';
//     const g = createGame({ seed: 42, clubName: '새록 스프라우츠' });
//     const r = playMatch(g, 't06');
//     console.log(renderCommentary(r.events, r.ctx).slice(0, 20));
//   </script>

// ---------------------------------------------------------------- 공개 API
export {
  createGame, loadGame, saveGame,
  scout, trainingCard,
  startTraining, trainingOptions, applyTrainingChoice, graduate,
  recommendSupporters, supporterCandidates,
  autoLineup, setLineupSlot, lineupValid, lineupOvr, myRoster, myTeamState, myTeam,
  playMatch, clubTeamState, clubList,
  representatives, representativeOf, promoteInstance, releaseInstance,
  canScout, scoutCost, departedCardIds, growthFor,
  addTickets, addGold, spendGold, addFragments, formatMatchResult, createFillers,
  recordCareer, careerOf, campTrace,          // 통산 기록·캠프 흔적 (육성→코트 연결 연출)
  CLUBS, CARD_POOL, CLUB_TACTICS, ECONOMY, REWARDS, SCOUT_RATES, SEASON_GROWTH, VACANCY_TUNING,
  CLUB_SKILL_LEVEL, clubSkillLevelFor,
  // 노화·전성기·은퇴 (league-and-economy.md A.3.6)
  AGING, ageAt, ageFactor, agePhase, isRetiredAge, isCardRetired, activeCardPool,
  retiredRepresentatives, instanceAgeInfo,
  // 신인 세대 (docs/rookies.md) — 카드 풀은 이제 시즌에 따라 늘어난다.
  // UI 는 CARD_POOL 대신 allCards(state) / cardById(state, id) 를 써야 한다.
  ROOKIES, LAUNCH_CARDS, allCards, cardById, isRookieCard,
  rookieCards, rookieClassOf, rookieWorld, genericClubSlots,
  peakEndOf, retireAgeOf,
} from './engine/game.js';

// ---------------------------------------------------------------- 골드 소비처 (league-and-economy.md B.6)
// 구단 시설 투자 · 구단 운영비 · 스카우트 리포트. **전부 비전력**이다 —
// 경기·육성 판정에 들어가는 값이 하나도 없고, parity.mjs 9절이 그것을 자동 검증한다.
export {
  FACILITY,
  facilityLevels, facilityLevel, facilityPrice, canUpgradeFacility, upgradeFacility,
  clubPrestige, squadSize, facilityUpkeep, payUpkeep, facilityView,
  reportCost, hasScoutReport, canBuyScoutReport, buyScoutReport, scoutReport, reportableCards,
} from './engine/facility.js';

// ---------------------------------------------------------------- 리그 시즌 계층
// docs/league-and-economy.md A(시즌)·B(경제) — 사용 흐름:
//   startSeason(g) → [scout/startTraining/graduate ...] → advanceMatchday(g) × 14
//   → advancePlayoff(g) 반복 → finishSeason(g) → startSeason(g)
export {
  startSeason, seasonView, standings, schedule, advanceMatchday, skipTrainingSlot,
  playoffState, advancePlayoff, autoFinishPlayoff, finishSeason, seasonHistory,
  seasonAwards, canTrain, myRank, matchPoints, buildSchedule,
  SEASON_CONFIG, PHASE as SEASON_PHASE,
} from './engine/season.js';

export { renderCommentary, ga, josa, fillName, shortName, archetypeOf, personalityQuip, ARCHETYPE_KO } from './engine/commentary.js';

// 참조 데이터·열거형(UI 표기용)
export {
  POSITIONS, RARITIES, POS, POS_CODES, RARITY,
  STAT, STAT_KEYS, STAT_NAMES_KO, SIDE,
  EV, Q, OUT, ATK, REASON, FORMATION,
  defaultTactics,
} from './engine/domain.js';

export {
  ACT, ACT_NAMES_KO, COND, COND_NAMES_KO, COND_ARROWS,
  ZONE, ZONE_NAMES_KO, APT_NAMES, GRADE_NAMES, SPECIAL, SPECIAL_NAMES_KO, INJURY,
  DEFAULT_TRAINING_CONFIG, ovrOf, gradeOf,
} from './engine/training-config.js';

export { POLICIES, runWithPolicy, injuryBadge, campLine } from './engine/training.js';

// 온보딩 미션(GDD 13절) — 앱과 season-check --app 이 같은 표를 쓴다
export { ONBOARDING, MISSIONS, missionProgress, claimMissions, missionRewardTotal } from './engine/missions.js';

// 고유 스킬(docs/skills.md) — 카드 UI 표기·밸런스 하네스용
export {
  SKILLS, SKILL_BY_NAME, SKILL_BY_ID, SKILL_BY_OWNER,
  CH as SKILL_CHANNEL, CH_NAMES_KO as SKILL_CHANNEL_NAMES_KO,
  EFFECT as SKILL_EFFECT, TARGET as SKILL_TARGET, TARGET_NAMES_KO as SKILL_TARGET_NAMES_KO,
  findSkill, hasActiveSkill, describeSkill, createSkillRuntime, SkillRuntime,
} from './engine/skills.js';

// 저수준(파리티 하네스·고급 UI 용)
export { Rng, mixSeed, derivedSeed } from './engine/rng.js';
export { simulateMatch, setScoreLine, totalPoints } from './engine/match.js';
export { generateTeamState, generatePlayer } from './engine/generator.js';
export { DEFAULT_SIM_CONFIG, createSimConfig } from './engine/config.js';
export { PLAYERS, TEAMS } from './data.js';

export const ENGINE_VERSION = '0.3.0-js';
