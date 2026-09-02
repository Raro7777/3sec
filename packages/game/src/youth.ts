import { Rng, generateAttributes, type Role } from "@3sec/engine";
import type { Club, GameState, ScoutingTier, SquadPlayer, YouthProspect } from "./types";
import { overall } from "./rating";
import { spendGrowth, weeklyRate } from "./training";
import { wageFor } from "./contracts";
import { MAX_SQUAD } from "./transfers";
import { randomName } from "./world";
import { autoSelect, repairSelection } from "./selection";

/** Academy size cap; the weakest prospect makes room for a new one. */
export const MAX_PROSPECTS = 8;
export const MIN_PROMOTE_AGE = 16;
/** A prospect who turns this old without promotion leaves at the season rollover. */
export const LEAVE_AGE = 19;
/** AI clubs promote their best prospect at rollover while their squad is below this. */
const AI_PROMOTE_BELOW = 22;

export interface ScoutingTierDef {
  label: string;
  /** 억원 per week */
  cost: number;
  /** prospects per intake */
  intake: number;
  /** added to the potential ceiling of new prospects */
  bonus: number;
  /** weekly narrowing of each end of the potential range (attribute points) */
  narrow: number;
  /** a report (a big narrowing step) every N weeks in the academy; 0 = never */
  reportEvery: number;
}

export const SCOUTING: Record<ScoutingTier, ScoutingTierDef> = {
  none: { label: "없음", cost: 0, intake: 1, bonus: -1.5, narrow: 0.03, reportEvery: 0 },
  local: { label: "지역", cost: 0.2, intake: 2, bonus: 0, narrow: 0.06, reportEvery: 8 },
  regional: { label: "권역", cost: 0.5, intake: 3, bonus: 1, narrow: 0.1, reportEvery: 5 },
  national: { label: "전국", cost: 1.0, intake: 4, bonus: 2, narrow: 0.15, reportEvery: 3 },
};

/** Coaching levels 1..3 (index 0 unused): weekly cost and label. Development multiplier is 0.8 + 0.3 × level. */
export const COACHING: { label: string; cost: number }[] = [
  { label: "", cost: 0 },
  { label: "기본", cost: 0 },
  { label: "전문", cost: 0.3 },
  { label: "엘리트", cost: 0.7 },
];

const ROLES: Role[] = ["GK", "CB", "CB", "LB", "RB", "DM", "CM", "CM", "AM", "LW", "RW", "ST", "ST"];
const round1 = (x: number): number => Math.round(x * 10) / 10;
const clamp = (x: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, x));
const tierOf = (c: Club): ScoutingTierDef => SCOUTING[c.youth.scouting] ?? SCOUTING.local;
const coachingOf = (c: Club): number => clamp(Math.round(c.youth.coaching) || 1, 1, 3);

export const youthWeeklyCost = (c: Club): number => round1(tierOf(c).cost + COACHING[coachingOf(c)]!.cost);
export const prospectOverall = (p: YouthProspect): number => overall(p.attrs, p.role);

function makeProspect(rng: Rng, club: Club, s: GameState, seq: number): YouthProspect {
  const tier = tierOf(club);
  const age = rng.int(15, 18);
  const role = rng.pick(ROLES);
  // Prospects arrive well short of the first team; the youngest are rawer still, and an unscouted intake is mediocre.
  const quality = club.reputation - 4 + rng.gauss(0, 2) - (age <= 16 ? 0.7 : 0) + (club.youth.scouting === "none" ? -1 : 0);
  const attrs = generateAttributes(rng, role, quality);
  const ovr = overall(attrs, role);
  const truePotential = round1(clamp(ovr + rng.range(2, 6) + tier.bonus + rng.gauss(0, 1), ovr, 20));
  const skew = rng.range(-1, 1);
  const lo = round1(clamp(truePotential - 2.5 + skew, Math.min(ovr, truePotential), truePotential));
  const hi = round1(clamp(truePotential + 2.5 + skew, truePotential, 20));
  return {
    id: `C${club.id}-Y${seq}`,
    name: randomName(rng),
    age,
    role,
    attrs,
    potentialRange: [lo, hi],
    truePotential,
    reportsSeen: 0,
    growth: 0,
    joinedRound: s.round,
    weeksInAcademy: 0,
  };
}

/** Every club takes in a batch of prospects sized by its scouting tier; the academy keeps its best eight. */
export function youthIntake(s: GameState, rng: Rng): void {
  for (const c of s.clubs) {
    const fresh: YouthProspect[] = [];
    for (let i = 0; i < tierOf(c).intake; i++) fresh.push(makeProspect(rng, c, s, c.youth.nextId++));
    const all = [...c.youth.prospects, ...fresh].sort((a, b) => b.truePotential - a.truePotential || prospectOverall(b) - prospectOverall(a));
    const kept = all.slice(0, MAX_PROSPECTS);
    const dropped = all.slice(MAX_PROSPECTS);
    c.youth.prospects = kept;
    if (c.id !== s.userClub) continue;
    const names = fresh.map((p) => `${p.name}(${p.age}세 ${p.role})`).join(", ");
    s.news.unshift(`유스: 유망주 ${fresh.length}명 입단 — ${names}.`);
    if (dropped.length) s.news.unshift(`유스: 정원(${MAX_PROSPECTS}명) 초과로 ${dropped.map((p) => p.name).join(", ")} 방출.`);
  }
}

function narrowTowardTruth(p: YouthProspect, lo: number, hi: number): void {
  p.potentialRange = [round1(Math.min(p.truePotential, lo)), round1(Math.max(p.truePotential, hi))];
}

/**
 * One academy week for every club: fees for scouting and coaching leave the budget, prospects train
 * toward their hidden ceiling, and the scouts' potential estimate tightens (a lot when a report lands).
 */
export function youthWeek(s: GameState): void {
  const rng = new Rng(s.seed * 23 + s.season * 811 + s.round * 13 + 5);
  for (const c of s.clubs) {
    c.budget = round1(c.budget - youthWeeklyCost(c));
    const tier = tierOf(c);
    const mult = 0.8 + 0.3 * coachingOf(c);
    for (const p of c.youth.prospects) {
      p.weeksInAcademy++;
      let rate = weeklyRate(p.age) * mult;
      const headroom = p.truePotential - prospectOverall(p);
      if (headroom <= 0) rate = 0;
      else if (headroom < 1.5) rate *= 0.4;
      p.growth += rate;
      spendGrowth(p, [], rng);
      const step = tier.narrow * (1 + 0.5 * p.reportsSeen);
      const [lo, hi] = p.potentialRange;
      const before = lo;
      narrowTowardTruth(p, lo + step, hi - step);
      if (tier.reportEvery > 0 && p.reportsSeen < 3 && p.weeksInAcademy % tier.reportEvery === 0) {
        p.reportsSeen++;
        const [l, h] = p.potentialRange;
        narrowTowardTruth(p, p.truePotential - (p.truePotential - l) * 0.6, p.truePotential + (h - p.truePotential) * 0.6);
        if (c.id === s.userClub && before < 15 && p.potentialRange[0] >= 15) {
          s.news.unshift(`유망주 보고서: ${p.name}(${p.age}세 ${p.role}) 잠재력 최소 ${Math.round(p.potentialRange[0])} — 1군급 재목입니다.`);
        }
      }
    }
  }
}

function freeNumber(club: Club): number {
  const used = new Set(club.squad.map((q) => q.number));
  for (let n = 2; n < 100; n++) if (!used.has(n)) return n;
  return 99;
}

function toPlayer(club: Club, p: YouthProspect, season: number): SquadPlayer {
  const player: SquadPlayer = {
    id: p.id,
    name: p.name,
    number: freeNumber(club),
    role: p.role,
    attrs: p.attrs,
    age: p.age,
    potential: p.truePotential,
    growth: p.growth,
    wage: 0,
    contractUntil: season + 3,
    condition: 1,
    injuryDays: 0,
    ban: 0,
    seasonYellows: 0,
    lastMinutes: 0,
    stats: { apps: 0, goals: 0, minutes: 0, yellows: 0, reds: 0 },
  };
  player.wage = Math.max(0.3, round1(wageFor(player) * 0.5));
  return player;
}

/** The user promotes a prospect (16+) into the first team on a cheap three-season deal. Returns an error or null. */
export function promoteProspect(s: GameState, prospectId: string): string | null {
  const me = s.clubs[s.userClub]!;
  const p = me.youth.prospects.find((q) => q.id === prospectId);
  if (!p) return "유망주를 찾을 수 없습니다";
  if (p.age < MIN_PROMOTE_AGE) return `${MIN_PROMOTE_AGE}세부터 승격할 수 있습니다`;
  if (me.squad.length >= MAX_SQUAD) return `스쿼드 상한 ${MAX_SQUAD}명`;
  const player = toPlayer(me, p, s.season);
  me.youth.prospects = me.youth.prospects.filter((q) => q !== p);
  me.squad.push(player);
  me.selection = repairSelection(me);
  s.news.unshift(`${me.shortName}: 유망주 ${player.name}(${player.age}세 ${player.role}) 1군 승격 (연봉 ${player.wage}억, ~S${player.contractUntil}).`);
  return null;
}

export function releaseProspect(s: GameState, prospectId: string): string | null {
  const me = s.clubs[s.userClub]!;
  const p = me.youth.prospects.find((q) => q.id === prospectId);
  if (!p) return "유망주를 찾을 수 없습니다";
  me.youth.prospects = me.youth.prospects.filter((q) => q !== p);
  s.news.unshift(`${me.shortName}: 유망주 ${p.name} 방출.`);
  return null;
}

/**
 * Season rollover for the academies: AI clubs with thin squads promote their best prospect, everyone
 * ages a year, and anyone reaching the leaving age without a promotion walks away.
 */
export function youthRollover(s: GameState, rng: { next(): number }): void {
  void rng;
  for (const c of s.clubs) {
    if (c.id !== s.userClub) {
      const best = [...c.youth.prospects].filter((p) => p.age >= MIN_PROMOTE_AGE).sort((a, b) => b.truePotential - a.truePotential)[0];
      if (best && c.squad.length < AI_PROMOTE_BELOW && c.squad.length < MAX_SQUAD) {
        c.youth.prospects = c.youth.prospects.filter((p) => p !== best);
        c.squad.push(toPlayer(c, best, s.season));
        c.selection = autoSelect(c, c.selection.formation);
      }
    }
    for (const p of c.youth.prospects) p.age++;
    const leaving = c.youth.prospects.filter((p) => p.age >= LEAVE_AGE);
    if (!leaving.length) continue;
    c.youth.prospects = c.youth.prospects.filter((p) => p.age < LEAVE_AGE);
    if (c.id === s.userClub) for (const p of leaving) s.news.unshift(`유스: ${p.name}(${p.age}세 ${p.role}) 승격 없이 아카데미를 떠났습니다.`);
  }
}
