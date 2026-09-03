// 육성 모드 튜닝 테이블. TrainingConfig.cs 의 값을 그대로 옮긴 것(값 변경 금지).
import { POS, STAT } from './domain.js';

// TrainingEnums.cs:8 TrainingAction — 0~4 훈련 5종, 5 휴식, 6 특훈, 7 치료(강제)
export const ACT = { Serve: 0, Receive: 1, Set: 2, Spike: 3, Block: 4, Rest: 5, Special: 6, Treat: 7 };
export const ACT_KEYS = ['serve', 'receive', 'set', 'spike', 'block', 'rest', 'special', 'treat'];
export const ACT_NAMES_KO = ['서브', '리시브', '토스', '스파이크', '블로킹', '휴식', '특훈', '치료'];

// TrainingEnums.cs:22 Condition (0 최악 ~ 4 절호조)
export const COND = { Worst: 0, Bad: 1, Normal: 2, Good: 3, Best: 4 };
export const COND_NAMES_KO = ['최악', '부진', '보통', '호조', '절호조'];
export const COND_ARROWS = ['↓↓', '↓', '→', '↑', '↑↑'];

// TrainingEnums.cs:33 FatigueZone
export const ZONE = { Cold: 0, Normal: 1, Hot: 2, Overheat: 3 };
export const ZONE_NAMES_KO = ['콜드', '적정', '핫존', '과열'];

export const APT_NAMES = ['D', 'C', 'B', 'A', 'S'];
export const GRADE_NAMES = ['D', 'C', 'B', 'A', 'S'];
export const SPECIAL = { Position: 0, Stamina: 1, MentalCamp: 2 };
export const SPECIAL_NAMES_KO = ['포지션 특훈', '체력 특훈', '멘탈 캠프'];
export const INJURY = { None: 0, Light: 1, Severe: 2 };

const A = { D: 0, C: 1, B: 2, A: 3, S: 4 };

/** TrainingConfig.cs:186 CreateDefault */
export function createTrainingConfig() {
  return {
    turns: 12,
    // growth (4.1절) — TrainingConfig.cs:16
    base: 4.6,
    wPrimary: 1.0, wSecondary1: 0.5, wSecondary2: 0.25,
    aptitudeMult: [0.40, 0.70, 1.00, 1.15, 1.30],
    diminishFull: 20.0, diminishMin: 0.25,
    randEps: 0.25,
    conditionMult: [0.60, 0.85, 1.00, 1.10, 1.30],
    // zone (3.6절) — TrainingConfig.cs:30
    coldHi: 30, coldMult: 0.85,
    hotLo: 45, hotHi: 80, hotMult: 1.50,
    overheatMult: 0.85,
    comboStep: 0.05, comboCap: 0.15,
    // special (3.4절) — TrainingConfig.cs:41
    specialBaseMult: 1.5,
    specialWeights: [1.0, 0.7, 0.5],
    specialAppearP: 0.25,
    specialMinCondition: COND.Good,
    specialKindWeights: [1.0, 0.0, 0.0],
    specialPersistsUntilUsed: true,
    specialRisk: 1.5, specialFatigue: 30.0, mentalCampFatigue: 10.0,
    // fatigue (5.1절) — TrainingConfig.cs:56
    fatigueTrain: 20.0, fatigueMatch: 12.0, fatiguePassive: 5.0,
    fatigueRest: 45.0, fatigueTreat: 20.0,
    staminaFactorBase: 60.0, staminaFactorDiv: 250.0,
    // rest (3.3절) — TrainingConfig.cs:66
    restMental: 1.0, restCondUpDeep: 0.70, restDeepAt: 50.0, restCondUpShallow: 0.30,
    // condition drift (5.3절) {+1, 유지, −1} — TrainingConfig.cs:72
    driftMid: [0.15, 0.70, 0.15],
    driftHot: [0.15, 0.70, 0.15],
    driftOver: [0.0, 0.40, 0.60],
    driftHotFrom: 60.0, driftOverFrom: 80.0,
    // injury (5.4~5.5절) — TrainingConfig.cs:80
    injuryStart: 45.0, injuryMax: 0.40, injuryExp: 1.6,
    trainRisk: [0.8, 1.0, 0.7, 1.3, 1.2],
    reinjuryMult: 2.0, severeRatio: 0.30,
    treatLight: 1, treatSevere: 2,
    lightBodyLoss: 3, severeAllLoss: 3, severeBodyLoss: 0,
    // events (6절) — TrainingConfig.cs:97
    randomEventP: 0.40, randomEventCap: 6,
    eventBranchP: 0.50, eventBranchSuccessP: 0.65, eventBranchGain: 3,
    storyTurns: [2, 6, 10], bondTurn: 7,
    seniorTurns: [5, 9], seniorEventP: 0.50, seniorEventCap: 2, seniorEventGain: 2,
    // evaluation (7절) — TrainingConfig.cs:111
    evalTurns: [4, 8, 12], evalStrength: [62, 72, 80],
    evalPerfSlope: 1.5, evalPerfSigma: 12.0, evalWinK: 8.0,
    mvpPerf: 80, goodPerf: 60, poorPerf: 40,
    mvpCoreGain: 2, mvpHint: 2, goodCoreGain: 1, goodHint: 1,
    winHint: 1, lossMental: 1,
    // graduation (8절) — TrainingConfig.cs:129
    gradeCut: [80, 74, 66, 55],
    hintLevels: [3, 6, 9],
    // support (9절) — TrainingConfig.cs:133
    supportStatBase: 60, supportStatDiv: 800,
    supportTrainCapEach: 0.06, supportCap: 0.20,
    supportPosMatch: 0.02, supportSameClub: 0.02, supportRivalHot: 0.05,
    supportInjDiv: 300, supportInjCapEach: 0.10, supportInjFloor: 0.80,
    supportCondDiv: 200, supportCondCapEach: 0.12, supportCondFloor: 0.65,
    supportSpecialS: 0.03, supportSpecialA: 0.02, supportSpecialCap: 0.06,
    supporterSlots: 3,
    rivals: [['t01', 't05'], ['t02', 't06'], ['t03', 't04']],
    // policy (12.3절) — TrainingConfig.cs:154
    safeRestAt: 35, safeSpecialMaxP: 0.05,
    optimalInjuryThreshold: 0.10, optimalSpecialMaxP: 0.20,
    pushInjuryThreshold: 0.20, pushSpecialMaxP: 0.30,
    evLossWeight: 2.0, spikeOnlyRestAt: 55,
    // position tables (3.1~3.2절, 8.2절) — TrainingConfig.cs:165
    trainingStats: [
      [STAT.serve, STAT.power, STAT.mental],
      [STAT.receive, STAT.dig, STAT.stamina],
      [STAT.set, STAT.mental, STAT.speed],
      [STAT.spike, STAT.power, STAT.stamina],
      [STAT.block, STAT.speed, STAT.power],
    ],
    positionAptitude: [
      /* S  */[A.B, A.B, A.S, A.C, A.B],
      /* OH */[A.A, A.A, A.C, A.A, A.B],
      /* OP */[A.A, A.C, A.D, A.S, A.B],
      /* MB */[A.B, A.C, A.D, A.A, A.S],
      /* L  */[A.D, A.S, A.B, A.D, A.D],
    ],
    ovrWeights: [
      /* S  */[.10, .08, .30, .06, .08, .08, .10, .04, .04, .12],
      /* OH */[.10, .18, .04, .22, .08, .08, .08, .10, .06, .06],
      /* OP */[.12, .05, .03, .28, .10, .04, .08, .14, .08, .08],
      /* MB */[.08, .04, .03, .18, .26, .03, .10, .14, .08, .06],
      /* L  */[.00, .28, .06, .00, .00, .26, .16, .04, .10, .10],
    ],
    positionScale: [1.0, 1.0, 1.0, 1.0, 0.95],
    core3: [
      /* S  */[STAT.set, STAT.mental, STAT.speed],
      /* OH */[STAT.spike, STAT.receive, STAT.serve],
      /* OP */[STAT.spike, STAT.power, STAT.serve],
      /* MB */[STAT.block, STAT.spike, STAT.power],
      /* L  */[STAT.receive, STAT.dig, STAT.speed],
    ],
    staminaSpecialStats: [STAT.stamina, STAT.speed, STAT.power],
  };
}

export const BODY_STATS = [STAT.speed, STAT.power, STAT.stamina]; // TrainingConfig.cs:183

export const DEFAULT_TRAINING_CONFIG = createTrainingConfig();

// ---------------------------------------------------------------- 파생 함수 (TrainingConfig.cs:190~)
export function zoneOf(cfg, fatigue) {
  if (fatigue >= cfg.hotHi) return ZONE.Overheat;
  if (fatigue >= cfg.hotLo) return ZONE.Hot;
  if (fatigue < cfg.coldHi) return ZONE.Cold;
  return ZONE.Normal;
}

export function zoneMult(cfg, fatigue) {
  switch (zoneOf(cfg, fatigue)) {
    case ZONE.Overheat: return cfg.overheatMult;
    case ZONE.Hot: return cfg.hotMult;
    case ZONE.Cold: return cfg.coldMult;
    default: return 1.0;
  }
}

export function inHot(cfg, fatigue) { return fatigue >= cfg.hotLo && fatigue < cfg.hotHi; }

export function comboMult(cfg, combo) { return 1.0 + Math.min(cfg.comboCap, cfg.comboStep * combo); }

/** 체감 수확(4.3절). TrainingConfig.cs:216 Diminish */
export function diminish(cfg, cur, pot) {
  const rem = pot - cur;
  if (rem <= 0) return 0.0;
  return Math.max(cfg.diminishMin, Math.min(1.0, rem / cfg.diminishFull));
}

/** 부상 확률(5.4절). TrainingConfig.cs:223 */
export function injuryProbability(cfg, fatigue, risk, mult = 1.0) {
  if (fatigue < cfg.injuryStart) return 0.0;
  const x = (fatigue - cfg.injuryStart) / (100.0 - cfg.injuryStart);
  return Math.min(1.0, cfg.injuryMax * Math.pow(x, cfg.injuryExp) * risk * mult);
}

export function fatigueGain(cfg, baseAmount, stamina) {
  return baseAmount * (1.0 - (stamina - cfg.staminaFactorBase) / cfg.staminaFactorDiv);
}

export function riskOf(cfg, a) {
  if (a >= 0 && a <= 4) return cfg.trainRisk[a];
  if (a === ACT.Special) return cfg.specialRisk;
  return 0.0;
}

export function isTraining(a) { return a >= 0 && a <= 4; }

/** OVR = posScale × Σ w[i]·stat[i]. TrainingConfig.cs:242 */
export function ovrOf(cfg, stats, pos) {
  const w = cfg.ovrWeights[pos];
  let sum = 0;
  for (let i = 0; i < 10; i++) sum += w[i] * stats[i];
  return cfg.positionScale[pos] * sum;
}

export function gradeOf(cfg, ovr) {
  if (ovr >= cfg.gradeCut[0]) return 4; // S
  if (ovr >= cfg.gradeCut[1]) return 3; // A
  if (ovr >= cfg.gradeCut[2]) return 2; // B
  if (ovr >= cfg.gradeCut[3]) return 1; // C
  return 0;                             // D
}

export function isRival(cfg, clubA, clubB) {
  if (!clubA || !clubB) return false;
  for (const pair of cfg.rivals) {
    if ((pair[0] === clubA && pair[1] === clubB) || (pair[0] === clubB && pair[1] === clubA)) return true;
  }
  return false;
}

export function skillLevelForHints(cfg, hints) {
  let lv = 0;
  for (let i = 0; i < cfg.hintLevels.length; i++) if (hints >= cfg.hintLevels[i]) lv = i + 1;
  return lv;
}

export function isEvalTurn(cfg, turn) { return cfg.evalTurns.indexOf(turn) >= 0; }
export function evalRound(cfg, turn) { return cfg.evalTurns.indexOf(turn); }
export function isStoryTurn(cfg, turn) { return cfg.storyTurns.indexOf(turn) >= 0; }
export function storyIndex(cfg, turn) { return cfg.storyTurns.indexOf(turn); }
export function isSeniorTurn(cfg, turn) { return cfg.seniorTurns.indexOf(turn) >= 0; }

export { POS };
