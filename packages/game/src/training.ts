import type { Attributes, Role } from "@3sec/engine";
import type { Club, SquadPlayer, TrainingFocus, TrainingIntensity } from "./types";
import { overall } from "./rating";
import { staffBonus, staffRating } from "./staff";
import { moraleTrainingFactor } from "./morale";

type Attr = keyof Attributes;
const OUTFIELD: Attr[] = ["pace", "acceleration", "agility", "strength", "stamina", "passing", "vision", "technique", "firstTouch", "dribbling", "finishing", "composure", "tackling", "marking", "positioning", "decisions", "anticipation"];
const GK_ATTRS: Attr[] = ["reflexes", "handling", "gkPositioning", "positioning", "decisions", "anticipation", "agility", "strength"];
const PHYSICAL: Attr[] = ["pace", "acceleration", "agility", "strength", "stamina"];

export const FOCUS_ATTRS: Record<TrainingFocus, Attr[]> = {
  balanced: [],
  attacking: ["finishing", "composure", "dribbling", "firstTouch", "technique"],
  defending: ["tackling", "marking", "positioning", "anticipation", "strength"],
  technical: ["passing", "vision", "technique", "firstTouch", "dribbling"],
  physical: ["pace", "acceleration", "stamina", "strength", "agility"],
  tactical: ["decisions", "positioning", "anticipation", "vision", "composure"],
};

export const FOCUS_LABEL: Record<TrainingFocus, string> = { balanced: "균형", attacking: "공격", defending: "수비", technical: "기술", physical: "피지컬", tactical: "전술" };
export const INTENSITY_LABEL: Record<TrainingIntensity, string> = { low: "가볍게", normal: "보통", high: "강하게" };

/** Weekly development rate in attribute points: youngsters grow, veterans decline. */
export function weeklyRate(age: number): number {
  if (age <= 18) return 0.24;
  if (age <= 20) return 0.2;
  if (age <= 23) return 0.16;
  if (age <= 26) return 0.07;
  if (age <= 29) return 0.015;
  if (age <= 32) return -0.05;
  return -0.11;
}

/** Growth a youngster banks for a match: ≥ 60 minutes earns 0.06 (0.09 up to age 20); nothing from 24 on. */
export function playingTimeBonus(age: number, minutes: number): number {
  if (minutes < 60 || age > 23) return 0;
  return age <= 20 ? 0.07 : 0.05;
}

/** First-team training intensity multiplier on the development rate (injury and recovery pay for "high"). */
export const INTENSITY_MULT: Record<TrainingIntensity, number> = { low: 0.7, normal: 1, high: 1.4 };

/** A youngster (≤ 23) who did not play at all this week develops at this fraction of his rate. */
export const BENCHED_FACTOR = 0.8;

export interface Development { player: SquadPlayer; attr: Attr; delta: 1 | -1 }

/** Anything that trains: a squad player or an academy prospect. */
export interface Grower { role: Role; attrs: Attributes; growth: number }

/**
 * Spends whole points of accumulated growth on attributes (focus attributes are drawn three times as
 * often); whole points of decline come off the physical attributes first. Shared by squad and academy.
 */
export function spendGrowth(p: Grower, focus: Attr[], rng: { next(): number }): { attr: Attr; delta: 1 | -1 }[] {
  const out: { attr: Attr; delta: 1 | -1 }[] = [];
  const pool = p.role === "GK" ? GK_ATTRS : OUTFIELD;
  let guard = 0;
  while (p.growth >= 1 && guard++ < 4) {
    const weighted = [...pool, ...focus.filter((a) => pool.includes(a)), ...focus.filter((a) => pool.includes(a))];
    const attr = weighted[Math.floor(rng.next() * weighted.length)]!;
    if (p.attrs[attr] < 20) { p.attrs[attr]++; out.push({ attr, delta: 1 }); }
    p.growth -= 1;
  }
  guard = 0;
  while (p.growth <= -1 && guard++ < 4) {
    const weighted = [...pool, ...PHYSICAL, ...PHYSICAL];
    const attr = weighted[Math.floor(rng.next() * weighted.length)]!;
    if (p.attrs[attr] > 1) { p.attrs[attr]--; out.push({ attr, delta: -1 }); }
    p.growth += 1;
  }
  return out;
}

/**
 * One week of training for a club: every player's growth accumulator moves by the age rate
 * (scaled by intensity, dampened for a youngster who sat out the week, capped by potential); whole
 * points are spent on attributes, biased toward the training focus. Declines hit physical attributes
 * first, as in life. The week's minutes are consumed here (reset to 0). The assistant coach scales every
 * growth rate (staffBonus); keepers train under the GK coach instead when the club has one.
 */
export function trainWeek(club: Club, rng: { next(): number }): Development[] {
  const out: Development[] = [];
  const mult = INTENSITY_MULT[club.training.intensity] ?? 1;
  const focus = FOCUS_ATTRS[club.training.focus];
  const coach = staffBonus(club, "assistant");
  const gkCoach = staffRating(club, "gk") ? staffBonus(club, "gk") : coach;
  for (const p of club.squad) {
    let rate = weeklyRate(p.age);
    if (rate > 0) {
      rate *= mult * (p.role === "GK" ? gkCoach : coach);
      if (p.age <= 23 && !p.onLoan && !(p.lastMinutes ?? 0)) rate *= BENCHED_FACTOR;
      const headroom = p.potential - overall(p.attrs, p.role);
      if (headroom <= 0) rate = 0;
      else if (headroom < 1.5) rate *= 0.4;
      // morale and professionalism (morale.ts): ×0.85..1.15; a player who refused training this week banks nothing
      rate *= moraleTrainingFactor(p);
      if (p.trainingRefused) rate = 0;
    }
    p.trainingRefused = undefined;
    p.growth += rate;
    p.lastMinutes = 0;
    for (const ch of spendGrowth(p, focus, rng)) out.push({ player: p, ...ch });
  }
  return out;
}

export const ATTR_LABEL: Record<Attr, string> = {
  pace: "속도", acceleration: "가속", agility: "민첩", strength: "힘", stamina: "체력", passing: "패스", vision: "시야", technique: "기술",
  firstTouch: "터치", dribbling: "드리블", finishing: "마무리", composure: "침착", tackling: "태클", marking: "마킹", positioning: "위치",
  decisions: "판단", anticipation: "예측", reflexes: "반사신경", handling: "핸들링", gkPositioning: "GK 위치",
};
