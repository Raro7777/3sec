// 육성 12턴 상태기계 + 서포터 + 평가전 + 정책.
// TraineeState.cs · Supporter.cs · TrainingSession.cs · Policies/TrainingPolicy.cs · Evaluation/*.cs 포팅.

import { POS, STAT, SIDE, clampStat, clonePlayer } from './domain.js';
import {
  ACT, ACT_NAMES_KO, COND, ZONE, SPECIAL, SPECIAL_NAMES_KO, INJURY, GRADE_NAMES, APT_NAMES,
  DEFAULT_TRAINING_CONFIG, BODY_STATS,
  zoneOf, zoneMult, inHot, comboMult, diminish, injuryProbability, fatigueGain, riskOf,
  isTraining, ovrOf, gradeOf, isRival, skillLevelForHints,
  isEvalTurn, evalRound, isStoryTurn, storyIndex, isSeniorTurn,
} from './training-config.js';
import { storyEvent, seniorEvent, randomStatBranchEvent, randomStatEvent, randomFatigueEvent, randomConditionEvent, flavorOf, effect } from './training-events.js';
import { Rng } from './rng.js';
import { roundHalfEven, sigmoid } from './mathx.js';
import { generateTeamState } from './generator.js';
import { simulateMatch, totalPoints } from './match.js';
import { createSimConfig } from './config.js';

export const PHASE = { AwaitAction: 0, AwaitEventChoice: 1, Graduated: 2 };

// ---------------------------------------------------------------- 트레이니 상태
/** TraineeState.cs:9 */
export class TraineeState {
  constructor(card, cfg, aptitudeOverride, potentialOverride) {
    this.card = card;
    this.pos = card.pos;
    this.clubId = card.teamId || '';
    this.current = new Float64Array(10);
    this.potential = new Int32Array(10);
    this.initial = new Int32Array(10);
    for (let i = 0; i < 10; i++) {
      this.initial[i] = card.stats[i];
      this.current[i] = card.stats[i];
      let p = potentialOverride ? potentialOverride[i] : card.potential[i];
      if (p < this.initial[i]) p = this.initial[i];
      if (p > 100) p = 100;
      this.potential[i] = p;
    }
    this.aptitude = new Int32Array(5);
    const apt = cfg.positionAptitude[this.pos];
    for (let t = 0; t < 5; t++) this.aptitude[t] = aptitudeOverride ? aptitudeOverride[t] : apt[t];

    this.fatigue = 0;
    this.condition = COND.Normal;
    this.combo = 0;
    this.injuries = 0;
    this.severeInjuries = 0;
    this.treatmentTurnsLeft = 0;
    this.turnsLost = 0;
    this.firstInjuryTurn = -1;
    this.hints = 0;
    this.randomEvents = 0;
    this.seniorEvents = 0;
    this.rests = 0;
    this.hotTrains = 0;
    this.trains = 0;
    this.conditionAcc = 0;
    this.bestConditionTurns = 0;
  }

  /** 잠재력 상한을 넘지 않게 상승 적용. 실제 상승량 반환. TraineeState.cs:60 */
  applyGain(k, raw) {
    const rem = this.potential[k] - this.current[k];
    const g = Math.min(raw, rem > 0 ? rem : 0);
    this.current[k] += g;
    return g;
  }

  applyLoss(k, amount) {
    const v = this.current[k] - amount;
    this.current[k] = v > 0 ? v : 0;
  }

  remaining(k) { return this.potential[k] - this.current[k]; }

  coreAverage(cfg) {
    const core = cfg.core3[this.pos];
    let s = 0;
    for (const k of core) s += this.current[k];
    return s / core.length;
  }

  /** 핵심 3스탯 도달률 / 전체 도달률. TraineeState.cs:90 Reach */
  reach(cfg) {
    const c3 = cfg.core3[this.pos];
    let cn = 0, cd = 0, an = 0, ad = 0;
    for (const k of c3) { cn += this.current[k] - this.initial[k]; cd += this.potential[k] - this.initial[k]; }
    for (let i = 0; i < 10; i++) {
      if (this.potential[i] > this.initial[i]) { an += this.current[i] - this.initial[i]; ad += this.potential[i] - this.initial[i]; }
    }
    return { core: cd > 0 ? cn / cd : 1.0, all: ad > 0 ? an / ad : 1.0 };
  }
}

// ---------------------------------------------------------------- 서포터
/** Supporter.cs:9 SupporterInfo */
export function supporterFromPlayer(p) {
  return { id: p.id, name: p.name, pos: p.pos, clubId: p.teamId || '', stats: p.stats.slice() };
}

/** 서포터 없음. Supporter.cs:63 SupportProfile.Empty */
export function emptySupport(cfg) {
  return {
    cfg, supporters: [], trainBonus: [0, 0, 0, 0, 0], hotExtra: 0,
    injuryMult: 1.0, condDownMult: 1.0, specialBonus: 0,
    signatureTrainings: [], tags: [], count: 0,
  };
}

/** Supporter.cs:69 SupportProfile.Build */
export function buildSupport(traineePos, traineeClub, supporters, cfg, capOverride) {
  const prof = emptySupport(cfg);
  const cap = capOverride === undefined || capOverride === null ? cfg.supportCap : capOverride;
  let inj = 0, cond = 0, sp = 0;
  for (const s of supporters || []) {
    if (!s) continue;
    prof.supporters.push(s);
    const tags = [];
    for (let t = 0; t < 5; t++) {
      const main = s.stats[cfg.trainingStats[t][0]];
      prof.trainBonus[t] += Math.min(cfg.supportTrainCapEach, Math.max(0.0, main - cfg.supportStatBase) / cfg.supportStatDiv);
    }
    if (s.pos === traineePos) {
      for (let t = 0; t < 5; t++) prof.trainBonus[t] += cfg.supportPosMatch;
      tags.push('포지션 일치');
    }
    if (s.clubId && s.clubId === traineeClub) {
      for (let t = 0; t < 5; t++) prof.trainBonus[t] += cfg.supportSameClub;
      tags.push('동문');
    }
    if (isRival(cfg, s.clubId, traineeClub)) {
      prof.hotExtra += cfg.supportRivalHot;
      tags.push('라이벌');
    }
    inj += Math.min(cfg.supportInjCapEach, Math.max(0.0, s.stats[STAT.stamina] - cfg.supportStatBase) / cfg.supportInjDiv);
    cond += Math.min(cfg.supportCondCapEach, Math.max(0.0, s.stats[STAT.mental] - cfg.supportStatBase) / cfg.supportCondDiv);
    const ovr = ovrOf(cfg, s.stats, s.pos);
    if (ovr >= cfg.gradeCut[0]) sp += cfg.supportSpecialS;
    else if (ovr >= cfg.gradeCut[1]) sp += cfg.supportSpecialA;
    // 시그니처 훈련: 주 스탯 최고(동률이면 앞 순서)
    let bestT = 0, bestV = -Infinity;
    for (let t = 0; t < 5; t++) {
      const v = s.stats[cfg.trainingStats[t][0]];
      if (v > bestV) { bestV = v; bestT = t; }
    }
    prof.signatureTrainings.push(bestT);
    prof.tags.push(tags.join('·'));
  }
  for (let t = 0; t < 5; t++) prof.trainBonus[t] = Math.min(cap, prof.trainBonus[t]);
  prof.injuryMult = Math.max(cfg.supportInjFloor, 1.0 - inj);
  prof.condDownMult = Math.max(cfg.supportCondFloor, 1.0 - cond);
  prof.specialBonus = Math.min(cfg.supportSpecialCap, sp);
  prof.count = prof.supporters.length;
  return prof;
}

/** 자동 추천(9.6절). Supporter.cs:129 Recommend */
export function recommendSupporterList(traineePos, traineeClub, roster, cfg, k = 3) {
  const core = cfg.core3[traineePos];
  const coreTrainings = [];
  for (let t = 0; t < 5; t++) if (core.indexOf(cfg.trainingStats[t][0]) >= 0) coreTrainings.push(t);
  const score = (s) => {
    const one = buildSupport(traineePos, traineeClub, [s], cfg, 9.0);
    let sum = 0;
    for (const t of coreTrainings) sum += one.trainBonus[t];
    return sum + one.hotExtra * 0.5 + (1.0 - one.injuryMult) * 0.5;
  };
  return (roster || []).filter(Boolean)
    .map(s => ({ s, v: score(s) }))
    .sort((a, b) => b.v - a.v)
    .slice(0, k)
    .map(x => x.s);
}

export function supportSummary(prof) {
  const parts = [];
  for (let t = 0; t < 5; t++) parts.push(`${ACT_NAMES_KO[t]}+${(prof.trainBonus[t] * 100).toFixed(1)}%`);
  return `훈련보정 ${parts.join(' ')} | 핫존 +${(prof.hotExtra * 100).toFixed(0)}%p 부상×${prof.injuryMult.toFixed(2)} 컨디션하락×${prof.condDownMult.toFixed(2)} 특훈+${(prof.specialBonus * 100).toFixed(0)}%p`;
}

// ---------------------------------------------------------------- 평가전 제공자
const OPPONENT_NAMES = ['지역 대학 선발', '프로 2군', '소속 구단 1군 선발'];

/**
 * 오라클 근사식(7.2절). StubEvaluationProvider.cs:11
 * perf = clamp(50 + (핵심3 − 강도) × 1.5 + N(0, 12)), 승리 = sigmoid((핵심3 − 강도)/8).
 * 정합(파리티) 기준 경로 — 컨디션 보정 없음.
 */
export const stubEvaluationProvider = {
  name: 'stub',
  play(req, rng) {
    const cfg = req.cfg;
    const diff = req.coreAverage - req.opponentStrength;
    let perf = 50.0 + diff * cfg.evalPerfSlope + rng.gauss(0, cfg.evalPerfSigma);
    perf = Math.max(0.0, Math.min(100.0, perf));
    const winP = sigmoid(diff / cfg.evalWinK);
    const won = rng.nextDouble() < winP;
    const name = OPPONENT_NAMES[Math.min(req.round, OPPONENT_NAMES.length - 1)];
    const clampI = (v, lo, hi) => (v < lo ? lo : (v > hi ? hi : v));
    const loser = won ? clampI(14 + Math.round((100 - perf) / 8.0), 10, 23) : clampI(10 + Math.round(perf / 6.0), 8, 23);
    return {
      round: req.round, turn: req.turn, opponentStrength: req.opponentStrength, opponentName: name,
      absent: false, won, performance: perf,
      scoreLine: won ? `25-${loser}` : `${loser}-25`,
      highlights: [perf >= cfg.mvpPerf ? '경기 내내 코트를 지배했다.'
        : perf >= cfg.goodPerf ? '몇 차례 결정적인 장면을 만들었다.'
          : perf >= cfg.poorPerf ? '평범한 하루.' : '공이 손에 붙지 않았다.'],
      box: null, coreGain: 0, hint: 0, conditionDelta: 0, mvp: false,
    };
  },
};

// SimEvaluationProvider.cs:19 Params
const SIM_EVAL_PARAMS = {
  coreOffset: [7.7, 4.3, 7.7, 5.7, 13.7],
  baseline: [5.54, 4.90, 3.06, 2.67, 6.54],
  netSlope: [0.023, 0.10, 0.054, 0.044, 0.11],
  scale: [6.7, 4.35, 4.5, 5.3, 3.6],
  marginWeight: 0.5,
  conditionMult: [0.92, 0.96, 1.00, 1.03, 1.06],
  conditionAdj: [-8, -4, 0, 4, 8],
  pointsToWin: 25,
  highlightCount: 3,
};

const EVAL_SIM_CONFIG = (() => {
  const c = createSimConfig();
  c.match.setsToWin = 1;
  c.match.pointsToWinSet = SIM_EVAL_PARAMS.pointsToWin;
  c.match.pointsToWinFinalSet = SIM_EVAL_PARAMS.pointsToWin;
  return c;
})();

/** 포지션별 순기여(박스스코어 → 1개 숫자). SimEvaluationProvider.cs:133 NetContribution */
export function netContribution(pos, b) {
  const attack = b.kills - b.attackErrors - b.blocked;
  const serve = b.aces - b.serveErrors;
  const block = b.blockKills + 0.5 * b.blockAssists + 0.25 * b.blockTouches;
  const rec = b.receptionPerfect + 0.5 * b.receptionGood - b.receptionErrors;
  const dig = b.digs - 0.5 * (b.digAttempts - b.digs);
  switch (pos) {
    case POS.S: return 0.35 * b.assists + attack + serve + block + 0.5 * dig;
    case POS.OH: return attack + serve + block + 0.6 * rec + 0.5 * dig;
    case POS.OP: return attack + serve + block + 0.4 * rec + 0.4 * dig;
    case POS.MB: return attack + serve + 1.5 * block + 0.4 * dig;
    default: return rec + 0.8 * dig + 0.3 * b.assists;
  }
}

const TRAINEE_ID = 'TRAINEE';

/** 실제 경기 시뮬로 평가전 1세트. SimEvaluationProvider.cs:19 */
export const simEvaluationProvider = {
  name: 'sim',
  collectEvents: false,
  play(req, rng) {
    const P = SIM_EVAL_PARAMS;
    const seedCamp = rng.nextSeed(), seedOpp = rng.nextSeed(), seedMatch = rng.nextSeed();
    const overall = req.opponentStrength - P.coreOffset[req.pos];
    const camp = generateTeamState(seedCamp, 'CAMP', req.traineeTeamName || '캠프 팀', overall);
    const trainee = buildTraineePlayer(req);
    insertTrainee(camp, trainee);
    camp.playerCondition = new Map([[trainee.id, P.conditionMult[req.condition]]]);
    const oppName = OPPONENT_NAMES[Math.min(req.round, OPPONENT_NAMES.length - 1)];
    const opp = generateTeamState(seedOpp, 'OPP', oppName, overall);

    const result = simulateMatch(camp, opp, seedMatch, EVAL_SIM_CONFIG, this.collectEvents);
    let box = result.boxScores.get(TRAINEE_ID);
    if (!box) box = { playerId: TRAINEE_ID, name: trainee.name, positionCode: 'OH', serves: 0, aces: 0, serveErrors: 0, receptions: 0, receptionPerfect: 0, receptionGood: 0, receptionPoor: 0, receptionErrors: 0, sets: 0, assists: 0, attacks: 0, kills: 0, attackErrors: 0, blocked: 0, blockKills: 0, blockAssists: 0, blockTouches: 0, digAttempts: 0, digs: 0 };

    const tp = totalPoints(result);
    const margin = tp.home - tp.away;
    const net = netContribution(req.pos, box);
    const delta = req.coreAverage - req.opponentStrength;
    const expectedNet = P.baseline[req.pos] + P.netSlope[req.pos] * delta;
    let perf = 50.0 + req.cfg.evalPerfSlope * delta + P.conditionAdj[req.condition]
      + P.scale[req.pos] * (net - expectedNet) + P.marginWeight * margin;
    perf = Math.max(0.0, Math.min(100.0, perf));

    return {
      round: req.round, turn: req.turn, opponentStrength: req.opponentStrength, opponentName: oppName,
      absent: false, won: result.winner === SIDE.HOME, performance: perf,
      scoreLine: result.sets.map(s => `${s.home}-${s.away}`).join(', '),
      highlights: simHighlights(req.pos, box),
      box, coreGain: 0, hint: 0, conditionDelta: 0, mvp: false,
    };
  },
};

function buildTraineePlayer(req) {
  const t = clonePlayer(req.card);
  t.id = TRAINEE_ID;
  t.teamId = 'CAMP';
  for (let i = 0; i < 10; i++) t.stats[i] = clampStat(roundHalfEven(req.currentStats[i]));
  return t;
}

/** 같은 포지션의 라인업 자리를 트레이니로 교체. SimEvaluationProvider.cs:116 InsertTrainee */
function insertTrainee(team, trainee) {
  team.roster.push(trainee);
  team.index.set(trainee.id, trainee);
  const l = team.lineup;
  let replaced;
  switch (trainee.pos) {
    case POS.L: replaced = l.liberoId; l.liberoId = trainee.id; break;
    case POS.S: replaced = l.startingIds[0]; l.startingIds[0] = trainee.id; break;
    case POS.OH: replaced = l.startingIds[1]; l.startingIds[1] = trainee.id; break;
    case POS.MB: replaced = l.startingIds[2]; l.startingIds[2] = trainee.id; break;
    default: replaced = l.startingIds[3]; l.startingIds[3] = trainee.id; break;
  }
  if (replaced) l.benchIds.push(replaced);
}

function simHighlights(pos, b) {
  const h = [];
  if (b.attacks > 0) h.push(`공격 ${b.kills}/${b.attacks} (범실 ${b.attackErrors}, 피블로킹 ${b.blocked})`);
  if (b.serves > 0) h.push(`서브 ${b.serves}회, 에이스 ${b.aces}, 범실 ${b.serveErrors}`);
  if (b.receptions > 0) h.push(`리시브 ${b.receptions}회 (A ${b.receptionPerfect} / B ${b.receptionGood} / 실패 ${b.receptionErrors})`);
  if (b.blockKills + b.blockAssists > 0) h.push(`블로킹 득점 ${b.blockKills} (어시스트 ${b.blockAssists})`);
  if (b.digAttempts > 0) h.push(`디그 ${b.digs}/${b.digAttempts}`);
  if (pos === POS.S && b.assists > 0) h.push(`세트 ${b.sets}회, 어시스트 ${b.assists}`);
  return h.slice(0, SIM_EVAL_PARAMS.highlightCount);
}

// ---------------------------------------------------------------- 육성 세션
/** TrainingSession.cs:83 */
export class TrainingSession {
  constructor(card, support, cfg, evaluation, seed, deterministic = false, aptitudeOverride = null, potentialOverride = null) {
    this.cfg = cfg || DEFAULT_TRAINING_CONFIG;
    this.trainee = new TraineeState(card, this.cfg, aptitudeOverride, potentialOverride);
    this.support = support || emptySupport(this.cfg);
    this.evaluation = evaluation || stubEvaluationProvider;
    this.seed = seed;
    this.rng = new Rng(seed);
    this.deterministic = deterministic;
    this.turn = 1;
    this.phase = PHASE.AwaitAction;
    this.specialAvailable = false;
    this.specialKindPending = SPECIAL.Position;
    this.pendingEvent = null;
    this.log = [];
    this.evaluations = [];
    this.result = null;
    this.instanceId = `${card.id}@${seed}`;
    this.policyName = '수동';
    this._currentRecord = null;
    this._gains = new Float64Array(10);
    this.beginTurn();
  }

  get isTreating() { return this.trainee.treatmentTurnsLeft > 0; }
  get fatigue() { return this.trainee.fatigue; }
  get condition() { return this.trainee.condition; }
  get combo() { return this.trainee.combo; }
  get zone() { return zoneOf(this.cfg, this.trainee.fatigue); }
  get isFinalTurn() { return this.turn >= this.cfg.turns; }
  get currentOvr() { return ovrOf(this.cfg, this.trainee.current, this.trainee.pos); }
  get initialOvr() { return ovrOf(this.cfg, this.trainee.initial, this.trainee.pos); }

  /** 부상 확률 배수 = 서포터 방지 × 부상 이력. TrainingSession.cs:139 */
  injuryMultiplier() {
    let m = this.support.count > 0 ? this.support.injuryMult : 1.0;
    if (this.trainee.injuries > 0) m *= this.cfg.reinjuryMult;
    return m;
  }

  /** TrainingSession.cs:147 InjuryProbability */
  injuryProbabilityOf(a, kind) {
    const k = kind === undefined ? this.specialKindPending : kind;
    const risk = a === ACT.Special ? (k === SPECIAL.MentalCamp ? 0.0 : this.cfg.specialRisk) : riskOf(this.cfg, a);
    return injuryProbability(this.cfg, this.trainee.fatigue, risk, this.injuryMultiplier());
  }

  /** 컨디션 × 강도 곡선 × (1+콤보). TrainingSession.cs:161 BaseMult */
  baseMult() {
    const c = this.cfg, tr = this.trainee;
    return c.conditionMult[tr.condition] * zoneMult(c, tr.fatigue) * comboMult(c, tr.combo);
  }

  /** (1+서포트). TrainingSession.cs:164 SupportMult */
  supportMult(a) {
    const cfg = this.cfg, sup = this.support;
    if (sup.count === 0) return 1.0;
    let s;
    if (a === ACT.Special) {
      s = 0;
      const core = cfg.core3[this.trainee.pos];
      for (let t = 0; t < 5; t++) {
        if (core.indexOf(cfg.trainingStats[t][0]) >= 0 && sup.trainBonus[t] > s) s = sup.trainBonus[t];
      }
    } else s = sup.trainBonus[a];
    if (inHot(cfg, this.trainee.fatigue)) s += sup.hotExtra;
    return 1.0 + Math.min(cfg.supportCap, s);
  }

  /** ε = 0 예상 상승치(4.2절). TrainingSession.cs:186 ComputeGains */
  computeGains(a, kind, out) {
    const cfg = this.cfg, tr = this.trainee;
    for (let i = 0; i < 10; i++) out[i] = 0;
    const cm = this.baseMult() * this.supportMult(a);
    const cur = tr.current, pot = tr.potential;
    if (a === ACT.Special) {
      let stats, w;
      if (kind === SPECIAL.Stamina) { stats = cfg.staminaSpecialStats; w = cfg.specialWeights; }
      else if (kind === SPECIAL.MentalCamp) { stats = [STAT.mental]; w = [1.0]; }
      else { stats = cfg.core3[tr.pos]; w = cfg.specialWeights; }
      for (let i = 0; i < stats.length && i < w.length; i++) {
        const s = stats[i];
        out[s] += cfg.base * cfg.specialBaseMult * w[i] * diminish(cfg, cur[s], pot[s]) * cm;
      }
    } else if (isTraining(a)) {
      const apt = cfg.aptitudeMult[tr.aptitude[a]];
      const stats = cfg.trainingStats[a];
      const w = [cfg.wPrimary, cfg.wSecondary1, cfg.wSecondary2];
      for (let i = 0; i < 3; i++) {
        const s = stats[i];
        out[s] += cfg.base * w[i] * apt * diminish(cfg, cur[s], pot[s]) * cm;
      }
    }
    return out;
  }

  previewGains(a, kind) {
    const g = new Float64Array(10);
    this.computeGains(a, kind === undefined ? this.specialKindPending : kind, g);
    return Array.from(g);
  }

  /** 훈련 5종의 OVR 가중 기대 상승(ε=0). TrainingSession.cs:222 WeightedPreviews */
  weightedPreviews() {
    const cfg = this.cfg, tr = this.trainee;
    const out = [0, 0, 0, 0, 0];
    const bm = this.baseMult() * cfg.base;
    const pw = cfg.ovrWeights[tr.pos];
    const cur = tr.current, pot = tr.potential;
    for (let t = 0; t < 5; t++) {
      const s = cfg.trainingStats[t];
      const a = cfg.aptitudeMult[tr.aptitude[t]] * bm * this.supportMult(t);
      out[t] = a * (cfg.wPrimary * pw[s[0]] * diminish(cfg, cur[s[0]], pot[s[0]])
        + cfg.wSecondary1 * pw[s[1]] * diminish(cfg, cur[s[1]], pot[s[1]])
        + cfg.wSecondary2 * pw[s[2]] * diminish(cfg, cur[s[2]], pot[s[2]]));
    }
    return out;
  }

  /** 선택지 1개의 OVR 가중 기대 상승(positionScale 미적용). TrainingSession.cs:250 */
  weightedPreview(a) {
    if (isTraining(a)) return this.weightedPreviews()[a];
    const g = this.previewGains(a);
    const pw = this.cfg.ovrWeights[this.trainee.pos];
    let s = 0;
    for (let i = 0; i < 10; i++) s += pw[i] * g[i];
    return s;
  }

  /** 가중 기대 상승 최대 훈련. TrainingSession.cs:261 */
  bestTrainingByPreview() {
    const wp = this.weightedPreviews();
    let best = 0;
    for (let t = 1; t < 5; t++) if (wp[t] > wp[best]) best = t;
    return best;
  }

  /** 부상 배지를 감안한 기대값 최대 훈련: gain×(1−p) − p×loss_w. TrainingSession.cs:270 */
  bestTrainingByEv(lossWeight) {
    const cfg = this.cfg;
    const lw = lossWeight === undefined ? cfg.evLossWeight : lossWeight;
    const wp = this.weightedPreviews();
    const im = this.injuryMultiplier(), f = this.trainee.fatigue;
    let best = 0, bestEv = -Infinity;
    for (let t = 0; t < 5; t++) {
      const p = injuryProbability(cfg, f, cfg.trainRisk[t], im);
      const ev = wp[t] * (1 - p) - p * lw;
      if (ev > bestEv) { bestEv = ev; best = t; }
    }
    return best;
  }

  get isDeepRest() { return this.trainee.fatigue >= this.cfg.restDeepAt; }
  restCondUpProbability() { return this.isDeepRest ? this.cfg.restCondUpDeep : this.cfg.restCondUpShallow; }

  /** 턴 시작 선택지. TrainingSession.cs:288 GetOptions */
  getOptions() {
    const cfg = this.cfg, tr = this.trainee;
    const list = [];
    const locked = this.isTreating || this.phase !== PHASE.AwaitAction;
    const stamina = tr.current[STAT.stamina];
    for (let t = 0; t < 5; t++) {
      list.push({
        id: ['serve', 'receive', 'set', 'spike', 'block'][t],
        action: t, specialKind: SPECIAL.Position,
        label: ACT_NAMES_KO[t], available: !locked,
        aptitude: tr.aptitude[t], aptitudeLabel: APT_NAMES[tr.aptitude[t]], hasAptitude: true,
        injuryP: this.injuryProbabilityOf(t),
        injuryBadge: injuryBadge(this.injuryProbabilityOf(t)),
        expectedGains: this.previewGains(t),
        weightedGain: this.weightedPreview(t),
        fatigueDelta: fatigueGain(cfg, cfg.fatigueTrain, stamina) - cfg.fatiguePassive,
        restCondUpP: 0, deepRest: false,
        supportBonus: this.supportMult(t) - 1.0,
        hintGain: 0,
      });
    }
    const restGains = new Array(10).fill(0);
    restGains[STAT.mental] = Math.min(cfg.restMental, Math.max(0, tr.remaining(STAT.mental)));
    list.push({
      id: 'rest', action: ACT.Rest, specialKind: SPECIAL.Position,
      label: '휴식', available: !locked,
      aptitude: -1, aptitudeLabel: '', hasAptitude: false,
      injuryP: 0, injuryBadge: null,
      expectedGains: restGains, weightedGain: 0,
      fatigueDelta: -Math.min(cfg.fatigueRest, tr.fatigue),
      restCondUpP: this.restCondUpProbability(), deepRest: this.isDeepRest,
      supportBonus: 0, hintGain: 0,
    });
    if (this.specialAvailable) {
      const k = this.specialKindPending;
      const p = this.injuryProbabilityOf(ACT.Special, k);
      list.push({
        id: 'special', action: ACT.Special, specialKind: k,
        label: SPECIAL_NAMES_KO[k], available: !locked,
        aptitude: -1, aptitudeLabel: '', hasAptitude: false,
        injuryP: p, injuryBadge: injuryBadge(p),
        expectedGains: this.previewGains(ACT.Special, k),
        weightedGain: this.weightedPreview(ACT.Special),
        fatigueDelta: (k === SPECIAL.MentalCamp ? cfg.mentalCampFatigue : fatigueGain(cfg, cfg.specialFatigue, stamina)) - cfg.fatiguePassive,
        restCondUpP: 0, deepRest: false,
        supportBonus: this.supportMult(ACT.Special) - 1.0,
        hintGain: 1,
      });
    }
    return list;
  }

  /** 특훈을 흘려보낸다. TrainingSession.cs:337 DismissSpecial */
  dismissSpecial() { this.specialAvailable = false; }

  /** 턴 행동 적용. TrainingSession.cs:340 Apply */
  apply(action) {
    if (this.phase !== PHASE.AwaitAction) throw new Error(`행동을 받을 수 없는 단계: ${this.phase}`);
    const tr = this.trainee, cfg = this.cfg;
    const rec = {
      turn: this.turn, requested: action, action,
      specialKind: SPECIAL.Position,
      zone: zoneOf(cfg, tr.fatigue), zoneMult: zoneMult(cfg, tr.fatigue),
      comboBefore: tr.combo, fatigueBefore: tr.fatigue,
      conditionBefore: tr.condition, conditionAfter: tr.condition,
      fatigueAfter: tr.fatigue, injuryP: 0, injury: INJURY.None, shallowRest: false,
      gains: {}, losses: {}, event: null, eval: null, flavor: '',
    };
    let rested = false;

    if (tr.treatmentTurnsLeft > 0) {
      // 치료 턴: 정책이 특훈을 골랐다면 소비된다(스크립트 동작).
      if (action === ACT.Special) this.specialAvailable = false;
      rec.action = ACT.Treat;
      tr.treatmentTurnsLeft--; tr.turnsLost++;
      tr.fatigue = Math.max(0, tr.fatigue - cfg.fatigueTreat);
      tr.combo = 0;
    } else if (action === ACT.Rest) {
      rested = true;
      tr.rests++; tr.combo = 0;
      rec.shallowRest = tr.fatigue < cfg.restDeepAt;
      tr.fatigue = Math.max(0, tr.fatigue - cfg.fatigueRest);
      if (cfg.restMental > 0) rec.gains[STAT.mental] = tr.applyGain(STAT.mental, cfg.restMental);
    } else {
      const kind = this.specialKindPending;
      if (action === ACT.Special) {
        if (!this.specialAvailable) throw new Error('이번 턴에는 특훈이 없습니다');
        this.specialAvailable = false;
        rec.specialKind = kind;
      } else if (!isTraining(action)) throw new Error('선택할 수 없는 행동: ' + action);

      const p = this.injuryProbabilityOf(action, kind);
      rec.injuryP = p;
      const hit = !this.deterministic && this.rng.chance(p);
      if (hit) {
        tr.injuries++; tr.combo = 0;
        if (tr.firstInjuryTurn < 0) tr.firstInjuryTurn = this.turn;
        if (this.rng.chance(cfg.severeRatio)) {
          tr.severeInjuries++; tr.treatmentTurnsLeft = cfg.treatSevere; tr.condition = COND.Worst;
          if (cfg.severeBodyLoss > 0) for (const s of BODY_STATS) { tr.applyLoss(s, cfg.severeBodyLoss); addLoss(rec, s, cfg.severeBodyLoss); }
          if (cfg.severeAllLoss > 0) for (let i = 0; i < 10; i++) { tr.applyLoss(i, cfg.severeAllLoss); addLoss(rec, i, cfg.severeAllLoss); }
          rec.injury = INJURY.Severe;
        } else {
          tr.treatmentTurnsLeft = cfg.treatLight;
          tr.condition = Math.max(0, tr.condition - 1);
          if (cfg.lightBodyLoss > 0) for (const s of BODY_STATS) { tr.applyLoss(s, cfg.lightBodyLoss); addLoss(rec, s, cfg.lightBodyLoss); }
          rec.injury = INJURY.Light;
        }
      } else {
        if (inHot(cfg, tr.fatigue)) tr.hotTrains++;
        tr.trains++; tr.conditionAcc += cfg.conditionMult[tr.condition];
        const g = this.computeGains(action, kind, this._gains);
        const eps = this.deterministic ? 0.0 : this.rng.uniform(-cfg.randEps, cfg.randEps);
        for (let i = 0; i < 10; i++) {
          if (g[i] <= 0) continue;
          rec.gains[i] = tr.applyGain(i, g[i] * (1 + eps));
        }
        const fb = action === ACT.Special ? (kind === SPECIAL.MentalCamp ? cfg.mentalCampFatigue : cfg.specialFatigue) : cfg.fatigueTrain;
        if (action === ACT.Special && kind === SPECIAL.MentalCamp) tr.fatigue = Math.min(100, tr.fatigue + fb);
        else tr.fatigue = Math.min(100, tr.fatigue + fatigueGain(cfg, fb, tr.current[STAT.stamina]));
        if (action === ACT.Special) {
          tr.hints++;
          if (kind === SPECIAL.MentalCamp) tr.condition = Math.min(4, tr.condition + 1);
        }
        tr.combo++;
      }
    }

    if (rec.action !== ACT.Treat && !rested) tr.fatigue = Math.max(0, tr.fatigue - cfg.fatiguePassive);
    if (rec.injury === INJURY.None && rec.action !== ACT.Treat) this.driftCondition(rested, rec.shallowRest);
    if (tr.condition === COND.Best) tr.bestConditionTurns++;
    rec.fatigueAfter = tr.fatigue;
    rec.conditionAfter = tr.condition;
    rec.flavor = flavorOf(rec.action, this.turn);
    this.log.push(rec);
    this._currentRecord = rec;
    this.afterAction();
    return rec;
  }

  /** 컨디션 드리프트(5.3절). TrainingSession.cs:430 DriftCondition */
  driftCondition(rested, shallow) {
    const tr = this.trainee, cfg = this.cfg;
    if (this.deterministic) {
      if (rested && !shallow) tr.condition = Math.min(4, tr.condition + 1);
      else if (!rested && tr.fatigue >= cfg.driftOverFrom) tr.condition = Math.max(0, tr.condition - 1);
      return;
    }
    const r = this.rng.nextDouble();
    let up, down;
    if (rested) { up = shallow ? cfg.restCondUpShallow : cfg.restCondUpDeep; down = 0.0; }
    else if (tr.fatigue < cfg.driftHotFrom) { up = cfg.driftMid[0]; down = cfg.driftMid[2]; }
    else if (tr.fatigue < cfg.driftOverFrom) { up = cfg.driftHot[0]; down = cfg.driftHot[2]; }
    else { up = cfg.driftOver[0]; down = cfg.driftOver[2]; }
    if (this.support.count > 0) down *= this.support.condDownMult;
    if (r < up) tr.condition = Math.min(4, tr.condition + 1);
    else if (r < up + down) tr.condition = Math.max(0, tr.condition - 1);
  }

  /** 이벤트 우선순위: 스토리 > 선배 > 랜덤. TrainingSession.cs:450 AfterAction */
  afterAction() {
    const cfg = this.cfg, tr = this.trainee;
    if (isStoryTurn(cfg, this.turn)) {
      this.pendingEvent = storyEvent(storyIndex(cfg, this.turn), tr.pos, cfg);
      this.phase = PHASE.AwaitEventChoice;
      return;
    }
    if (!this.deterministic) {
      if (isSeniorTurn(cfg, this.turn) && this.support.count > 0 && tr.seniorEvents < cfg.seniorEventCap && this.rng.nextDouble() < cfg.seniorEventP) {
        tr.seniorEvents++;
        const idx = this.rng.nextInt(this.support.signatureTrainings.length);
        this.pendingEvent = seniorEvent(this.support.supporters[idx].name, this.support.tags[idx], this.support.signatureTrainings[idx], cfg);
        this.phase = PHASE.AwaitEventChoice;
        return;
      }
      if (tr.randomEvents < cfg.randomEventCap && !(this.rng.nextDouble() > cfg.randomEventP)) {
        tr.randomEvents++;
        this.pendingEvent = this.rollRandomEvent();
        this.phase = PHASE.AwaitEventChoice;
        return;
      }
    }
    this.finishTurn();
  }

  /** TrainingSession.cs:475 RollRandomEvent */
  rollRandomEvent() {
    const cfg = this.cfg;
    const r = this.rng.nextDouble();
    if (r < 0.50) {
      const s = this.rng.nextInt(10);
      if (this.rng.nextDouble() < cfg.eventBranchP) return randomStatBranchEvent(s, cfg);
      const v = 1 + this.rng.nextInt(3);
      return randomStatEvent(s, v);
    }
    if (r < 0.75) return randomFatigueEvent([-15, -10, 10][this.rng.nextInt(3)]);
    return randomConditionEvent([1, 1, -1][this.rng.nextInt(3)]);
  }

  /** 대기 중인 이벤트의 선택지 결정. TrainingSession.cs:493 ResolveEvent */
  resolveEvent(choiceIndex) {
    if (this.phase !== PHASE.AwaitEventChoice || this.pendingEvent === null) throw new Error('대기 중인 이벤트가 없습니다');
    const ev = this.pendingEvent;
    let idx = choiceIndex;
    if (idx < 0 || idx >= ev.choices.length || !ev.choices[idx]) idx = 0;
    const choice = ev.choices[idx];
    const success = !choice.isBranch || this.rng.nextDouble() < choice.successRate;
    const eff = success ? choice.onSuccess : (choice.onFail || effect());
    const outcome = { event: ev, choiceIndex: idx, success, applied: eff, actualGains: {} };
    this.applyEffect(eff, outcome);
    if (this._currentRecord) this._currentRecord.event = outcome;
    this.pendingEvent = null;
    this.phase = PHASE.AwaitAction;
    this.finishTurn();
    return outcome;
  }

  applyEffect(eff, outcome) {
    const tr = this.trainee;
    for (let i = 0; i < 10; i++) {
      const v = eff.statGains[i];
      if (v > 0) outcome.actualGains[i] = tr.applyGain(i, v);
      else if (v < 0) { tr.applyLoss(i, -v); outcome.actualGains[i] = v; }
    }
    if (Math.abs(eff.fatigue) > 0) tr.fatigue = Math.max(0, Math.min(100, tr.fatigue + eff.fatigue));
    if (eff.condition !== 0) tr.condition = Math.max(0, Math.min(4, tr.condition + eff.condition));
    if (eff.hint !== 0) tr.hints += eff.hint;
  }

  /** TrainingSession.cs:529 FinishTurn */
  finishTurn() {
    if (!this.cfg.specialPersistsUntilUsed) this.specialAvailable = false;
    if (isEvalTurn(this.cfg, this.turn)) this.runEvaluation();
    if (this.turn >= this.cfg.turns) {
      this.result = this.buildGraduation();
      this.phase = PHASE.Graduated;
      return;
    }
    this.turn++;
    this.phase = PHASE.AwaitAction;
    this.beginTurn();
  }

  /** 턴 시작: 특훈 등장 판정(3.4절). TrainingSession.cs:561 BeginTurn */
  beginTurn() {
    if (this.deterministic || this.specialAvailable) return;
    const cfg = this.cfg, tr = this.trainee;
    const p = cfg.specialAppearP + (this.support.count > 0 ? this.support.specialBonus : 0.0);
    if (inHot(cfg, tr.fatigue) && tr.condition >= cfg.specialMinCondition && this.rng.nextDouble() < p) {
      this.specialAvailable = true;
      this.specialKindPending = this.rollSpecialKind();
    }
  }

  /** TrainingSession.cs:573 RollSpecialKind */
  rollSpecialKind() {
    const w = this.cfg.specialKindWeights;
    let nonZero = 0, sum = 0;
    for (let i = 0; i < w.length; i++) { if (w[i] > 0) nonZero++; sum += w[i]; }
    if (nonZero <= 1 || sum <= 0) {
      for (let i = 0; i < w.length; i++) if (w[i] > 0) return i;
      return SPECIAL.Position;
    }
    let r = this.rng.nextDouble() * sum;
    for (let i = 0; i < w.length; i++) { r -= w[i]; if (r < 0) return i; }
    return SPECIAL.Position;
  }

  /** 평가전(7절). TrainingSession.cs:587 RunEvaluation */
  runEvaluation() {
    const cfg = this.cfg, tr = this.trainee;
    const round = evalRound(cfg, this.turn);
    const opp = cfg.evalStrength[round];
    let o;
    if (tr.treatmentTurnsLeft > 0) {
      o = {
        round, turn: this.turn, opponentStrength: opp, opponentName: '—',
        absent: true, won: false, performance: 0, scoreLine: '', highlights: [], box: null,
        coreGain: 0, hint: 0, conditionDelta: 0, mvp: false,
      };
      this.evaluations.push(o);
      if (this._currentRecord) this._currentRecord.eval = o;
      return;
    }
    const req = {
      round, turn: this.turn, opponentStrength: opp, card: tr.card, pos: tr.pos,
      currentStats: Array.from(tr.current), coreAverage: tr.coreAverage(cfg),
      condition: tr.condition, cfg, sessionSeed: this.seed, traineeTeamName: '캠프 팀',
    };
    o = this.evaluation.play(req, this.rng);
    o.round = round; o.turn = this.turn; o.opponentStrength = opp;
    const perf = o.performance;
    let bonus, hint;
    if (perf >= cfg.mvpPerf) { bonus = cfg.mvpCoreGain; hint = cfg.mvpHint; }
    else if (perf >= cfg.goodPerf) { bonus = cfg.goodCoreGain; hint = cfg.goodHint; }
    else { bonus = 0; hint = 0; }
    for (const s of cfg.core3[tr.pos]) tr.applyGain(s, bonus);
    if (o.won) hint += cfg.winHint;
    else tr.applyGain(STAT.mental, cfg.lossMental);
    if (perf < cfg.poorPerf) { tr.condition = Math.max(0, tr.condition - 1); o.conditionDelta = -1; }
    if (perf >= cfg.mvpPerf) {
      tr.condition = Math.min(4, tr.condition + 1); o.conditionDelta = +1; o.mvp = true;
      this.specialAvailable = true; this.specialKindPending = this.rollSpecialKind();
    }
    tr.hints += hint;
    tr.fatigue = Math.min(100, tr.fatigue + cfg.fatigueMatch);
    o.coreGain = bonus; o.hint = hint;
    this.evaluations.push(o);
    if (this._currentRecord) this._currentRecord.eval = o;
  }

  /** 졸업(8절). TrainingSession.cs:626 BuildGraduation */
  buildGraduation() {
    const cfg = this.cfg, tr = this.trainee, card = tr.card;
    const finalStats = new Array(10);
    const initialStats = new Array(10);
    const potential = new Array(10);
    for (let i = 0; i < 10; i++) {
      finalStats[i] = clampStat(roundHalfEven(Math.min(tr.current[i], tr.potential[i])));
      initialStats[i] = tr.initial[i];
      potential[i] = tr.potential[i];
    }
    const ovr = ovrOf(cfg, finalStats, tr.pos);
    const grade = gradeOf(cfg, ovr);
    const { core, all } = tr.reach(cfg);
    const skillLevel = skillLevelForHints(cfg, tr.hints);

    const camp = { wins: 0, losses: 0, absent: 0, mvp: 0, injuries: tr.injuries, severeInjuries: tr.severeInjuries,
      hotTrains: tr.hotTrains, rests: tr.rests, trains: tr.trains, bestConditionTurns: tr.bestConditionTurns,
      turnsLost: tr.turnsLost, supporterNames: this.support.supporters.map(s => s.name), policyName: this.policyName };
    for (const e of this.evaluations) {
      if (e.absent) camp.absent++;
      else if (e.won) camp.wins++;
      else camp.losses++;
      if (e.mvp) camp.mvp++;
    }

    const instance = {
      instanceId: this.instanceId, cardId: card.id, name: card.name,
      pos: tr.pos, rarity: card.rarity, clubId: tr.clubId,
      jersey: card.jersey, heightCm: card.heightCm, age: card.age,
      skillName: card.skillName || '',
      finalStats, initialStats, potential,
      ovr, grade, completion: core, allReach: all,
      hints: tr.hints, skillLevel, camp, runIndex: 0, isRepresentative: true,
    };

    const deltas = new Array(10);
    for (let i = 0; i < 10; i++) deltas[i] = finalStats[i] - initialStats[i];

    const skill = instance.skillName || '고유 스킬';
    return {
      instance, deltas,
      ovrRaw: ovrOf(cfg, tr.current, tr.pos),
      ovrInitial: this.initialOvr,
      gradeRaw: gradeOf(cfg, ovrOf(cfg, tr.current, tr.pos)),
      coreReach: core, allReach: all, hints: tr.hints, skillLevel,
      unlockedSkills: skillLevel > 0 ? [`${skill} Lv${skillLevel}`] : [],
      evaluations: this.evaluations.slice(),
      camp,
      comment: graduationComment(grade),
    };
  }
}

function addLoss(rec, s, v) {
  rec.losses[s] = (rec.losses[s] || 0) + v;
}

/** 부상 배지 색(training-mode.md 5.4절 UI 규칙: 1~9 노랑 / 10~24 주황 / 25+ 빨강) */
export function injuryBadge(p) {
  if (p <= 0) return null;
  const pct = p * 100;
  return { percent: pct, level: pct < 10 ? 'yellow' : (pct < 25 ? 'orange' : 'red'), label: `${pct.toFixed(0)}%` };
}

function graduationComment(g) {
  switch (g) {
    case 4: return '캠프의 모든 것을 흡수했다. 이제 코트가 좁다.';
    case 3: return '즉시 전력. 어느 팀이라도 탐낼 만한 졸업생.';
    case 2: return '기본기는 갖췄다. 실전에서 한 번 더 자란다.';
    case 1: return '아직 원석. 다음 캠프에서 무기를 찾자.';
    default: return '쉽지 않은 캠프였다. 그래도 끝까지 남았다.';
  }
}

export function campLine(camp) {
  return `평가전 ${camp.wins}승 ${camp.losses}패${camp.absent > 0 ? ` ${camp.absent}결장` : ''} · MVP ${camp.mvp}회 · 부상 ${camp.injuries}회 · 핫존 훈련 ${camp.hotTrains}회 · 절호조 ${camp.bestConditionTurns}턴`;
}

// ---------------------------------------------------------------- 정책 (Policies/TrainingPolicy.cs)
function thresholdPolicy(name, threshold, specialMaxP) {
  return {
    name,
    choose(s) {
      const cfg = s.cfg;
      if (s.specialAvailable) {
        if (s.injuryProbabilityOf(ACT.Special) <= specialMaxP(cfg)) return ACT.Special;
        if (s.turn === cfg.turns) s.dismissSpecial();
      }
      const best = s.bestTrainingByEv();
      if (s.turn < cfg.turns && s.injuryProbabilityOf(best) > threshold(cfg)) return ACT.Rest;
      return best;
    },
    chooseEvent(s, e) { return e.oracleChoice; },
  };
}

export const POLICIES = {
  /** 안전: 피로 ≥ 35 휴식(T12 제외), 특훈은 배지 ≤ 5% 만 수락. TrainingPolicy.cs:72 */
  safe: {
    name: 'safe',
    choose(s) {
      const cfg = s.cfg;
      if (s.specialAvailable && s.injuryProbabilityOf(ACT.Special) <= cfg.safeSpecialMaxP) return ACT.Special;
      if (s.fatigue >= cfg.safeRestAt && s.turn < cfg.turns) return ACT.Rest;
      return s.bestTrainingByEv();
    },
    chooseEvent(s, e) { return e.oracleChoice; },
  },
  /** 최적: 배지 > 10% 휴식, 특훈 ≤ 20% 수락. TrainingPolicy.cs:56 */
  optimal: thresholdPolicy('optimal', c => c.optimalInjuryThreshold, c => c.optimalSpecialMaxP),
  /** 푸시(도박형): 배지 > 20% 휴식, 특훈 ≤ 30%. TrainingPolicy.cs:65 */
  push: thresholdPolicy('push', c => c.pushInjuryThreshold, c => c.pushSpecialMaxP),
  /** 랜덤: 훈련 5 + 휴식 (+특훈) 균등. TrainingPolicy.cs:87 */
  random: {
    name: 'random',
    choose(s) {
      const n = 6 + (s.specialAvailable ? 1 : 0);
      const i = s.rng.nextInt(n);
      const a = i < 5 ? i : (i === 5 ? ACT.Rest : ACT.Special);
      if (a !== ACT.Special) s.dismissSpecial();
      return a;
    },
    chooseEvent(s, e) { return e.oracleChoice; },
  },
  /** 무휴식 몰빵: 항상 가중 최대 훈련(특훈 수락). TrainingPolicy.cs:102 */
  norest: {
    name: 'norest',
    choose(s) {
      if (s.specialAvailable) return ACT.Special;
      return s.bestTrainingByPreview();
    },
    chooseEvent(s, e) { return e.oracleChoice; },
  },
  /** 스파이크만: 피로 ≥ 55 휴식. TrainingPolicy.cs:112 */
  spike: {
    name: 'spike',
    choose(s) {
      s.dismissSpecial();
      if (s.fatigue >= s.cfg.spikeOnlyRestAt && s.turn < s.cfg.turns) return ACT.Rest;
      return ACT.Spike;
    },
    chooseEvent(s, e) { return e.oracleChoice; },
  },
};

/** 정책으로 세션을 끝까지 자동 진행. TrainingRunner.cs:12 Run */
export function runWithPolicy(session, policy) {
  session.policyName = policy.name;
  let guard = 0;
  while (session.phase !== PHASE.Graduated) {
    if (++guard > 1000) throw new Error('세션이 끝나지 않습니다');
    if (session.phase === PHASE.AwaitAction) session.apply(policy.choose(session));
    else session.resolveEvent(policy.chooseEvent(session, session.pendingEvent));
  }
  return session.result;
}

export { ACT, COND, ZONE, SPECIAL, INJURY, GRADE_NAMES };
