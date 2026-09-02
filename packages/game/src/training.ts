import type { Attributes } from "@3sec/engine";
import type { Club, SquadPlayer, TrainingFocus, TrainingIntensity } from "./types";
import { overall } from "./rating";

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
  if (age <= 20) return 0.14;
  if (age <= 23) return 0.1;
  if (age <= 26) return 0.05;
  if (age <= 29) return 0.012;
  if (age <= 32) return -0.04;
  return -0.09;
}

export interface Development { player: SquadPlayer; attr: Attr; delta: 1 | -1 }

/**
 * One week of training for a club: every player's growth accumulator moves by the age rate
 * (scaled by intensity and capped by potential); whole points are spent on attributes, biased
 * toward the training focus. Declines hit physical attributes first, as in life.
 */
export function trainWeek(club: Club, rng: { next(): number }): Development[] {
  const out: Development[] = [];
  const mult = club.training.intensity === "high" ? 1.3 : club.training.intensity === "low" ? 0.7 : 1;
  const focus = FOCUS_ATTRS[club.training.focus];
  for (const p of club.squad) {
    let rate = weeklyRate(p.age);
    if (rate > 0) {
      rate *= mult;
      const headroom = p.potential - overall(p.attrs, p.role);
      if (headroom <= 0) rate = 0;
      else if (headroom < 1.5) rate *= 0.4;
    }
    p.growth += rate;
    const pool = p.role === "GK" ? GK_ATTRS : OUTFIELD;
    let guard = 0;
    while (p.growth >= 1 && guard++ < 4) {
      const weighted = [...pool, ...focus.filter((a) => pool.includes(a)), ...focus.filter((a) => pool.includes(a))];
      const attr = weighted[Math.floor(rng.next() * weighted.length)]!;
      if (p.attrs[attr] < 20) { p.attrs[attr]++; out.push({ player: p, attr, delta: 1 }); }
      p.growth -= 1;
    }
    guard = 0;
    while (p.growth <= -1 && guard++ < 4) {
      const weighted = [...pool, ...PHYSICAL, ...PHYSICAL];
      const attr = weighted[Math.floor(rng.next() * weighted.length)]!;
      if (p.attrs[attr] > 1) { p.attrs[attr]--; out.push({ player: p, attr, delta: -1 }); }
      p.growth += 1;
    }
  }
  return out;
}

export const ATTR_LABEL: Record<Attr, string> = {
  pace: "속도", acceleration: "가속", agility: "민첩", strength: "힘", stamina: "체력", passing: "패스", vision: "시야", technique: "기술",
  firstTouch: "터치", dribbling: "드리블", finishing: "마무리", composure: "침착", tackling: "태클", marking: "마킹", positioning: "위치",
  decisions: "판단", anticipation: "예측", reflexes: "반사신경", handling: "핸들링", gkPositioning: "GK 위치",
};
