/**
 * Central tuning knobs for the match engine. Every value here has been chosen (or is being
 * calibrated) against real-world per-match statistics; see scripts/calibrate.ts.
 *
 * `setTuning` mutates the live object so scripts can sweep parameters without rebuilding.
 */
export interface Tuning {
  /** shooting: base score and multiplier on xG in the on-ball decision */
  shotBase: number;
  shotXgMult: number;
  /** long-range appetite base (edge of the box, unpressured) */
  longRangeBase: number;
  /** shot direction error base (rad) before skill/pressure factors */
  shotAngSd: number;
  /** cross option base score */
  crossBase: number;
  /** pass lane margin weight (how much a safe lane is worth / a tight one costs) */
  passMarginWeight: number;
  /** extra score for the "carry" (dribble briefly before releasing) when unpressured */
  carryBonus: number;
  /** contested reception bias (m) for the intended receiver */
  receiverBias: number;
  /** first-touch control base probability */
  controlBase: number;
  /** man-marking gaps (m) by distance to own goal: <20, <35, else */
  markGapNear: number;
  markGapMid: number;
  markGapFar: number;
  /** number of pressers on a ball carrier at default pressing (pressing>0.65 adds one) */
  pressers: number;
  /** engage radius base (m); pressing adds up to 3 m */
  engageRadius: number;
  /** tackle attempts per second when in range */
  tackleRate: number;
  /** foul probability base per tackle attempt */
  foulBase: number;
  /** yellow card base probability per foul */
  yellowBase: number;
  /** keeper diving reach base (m) */
  gkReach: number;
  /** forwards' offside-line wobble amplitude (m) for low anticipation */
  offsideWobble: number;
  /** defenders' reaction delay (s) before chasing a pass just played by the opponent */
  reactionDelay: number;
  /** probability that a pressured clearance inside the box goes sideways/behind */
  panicClear: number;
  /** base probability the intended receiver wins a contested reception (shielding) */
  shieldBase: number;
  /** how much of the 1..20 attribute range reaches the physics/AI (1 = full spread) */
  attrCompression: number;
  /** home advantage: mentality/pressing lift for the home side (crowd), 0 = none */
  homeBoost: number;
  /** home advantage: attribute points (1..20 scale) added to every home player for the match, 0 = none */
  homeEdge: number;
  /** fatigue: pass angle/speed error multiplier at full fatigue (angSd *= 1 + this * fatigue) */
  fatiguePassSd: number;
  /** fatigue: mishit probability multiplier at full fatigue (tired legs mis-strike the ball) */
  fatigueMishit: number;
  /** fatigue: shot angle error multiplier at full fatigue */
  fatigueShotSd: number;
  /** fatigue: on-ball decision noise multiplier at full fatigue (tired players pick worse options) */
  fatigueDecision: number;
  /** fatigue: first-touch control probability lost at full fatigue (absolute, 0..1) */
  fatigueControl: number;
}

export const TUNING: Tuning = {
  shotBase: 0.48,
  shotXgMult: 3.0713,
  longRangeBase: 0.168,
  shotAngSd: 0.4,
  crossBase: -0.3,
  passMarginWeight: 0.8,
  carryBonus: 0.9,
  receiverBias: 1.5,
  controlBase: 0.55,
  markGapNear: 1,
  markGapMid: 1.7,
  markGapFar: 2.8,
  pressers: 2,
  engageRadius: 3.5,
  tackleRate: 1.7,
  foulBase: 0.045,
  yellowBase: 0.115,
  gkReach: 3.3,
  offsideWobble: 4,
  reactionDelay: 0.45,
  panicClear: 0.7,
  shieldBase: 0.72,
  attrCompression: 0.35,
  homeBoost: 0.03,
  homeEdge: 0.8,
  fatiguePassSd: 0.45,
  fatigueMishit: 0.9,
  fatigueShotSd: 0.35,
  fatigueDecision: 0.5,
  fatigueControl: 0.25,
};

export const DEFAULT_TUNING: Readonly<Tuning> = Object.freeze({ ...TUNING });

export function setTuning(patch: Partial<Tuning>): void {
  Object.assign(TUNING, patch);
}

export function resetTuning(): void {
  Object.assign(TUNING, DEFAULT_TUNING);
}
