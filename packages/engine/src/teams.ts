import { FORMATIONS } from "./formation";
import { Rng } from "./rng";
import type { Attributes, FormationName, PlayerDef, Role, Tactics, TeamDef, TeamId } from "./types";

const FIRST = ["Kim", "Lee", "Park", "Choi", "Jung", "Kang", "Cho", "Yoon", "Jang", "Lim", "Han", "Oh", "Seo", "Shin", "Kwon", "Hwang", "Ahn", "Song", "Ryu", "Hong"];
const GIVEN = ["Minjun", "Seojun", "Doyun", "Yejun", "Siwoo", "Hajun", "Jiho", "Juwon", "Jihoon", "Junseo", "Hyunwoo", "Woojin", "Sunwoo", "Eunwoo", "Jaeyoon", "Taeyang", "Yujun", "Seungmin", "Dohyun", "Geonwoo"];

function clamp120(x: number): number {
  return Math.max(1, Math.min(20, Math.round(x)));
}

/** Generate attributes around a quality level (1..20) with role bias. */
export function generateAttributes(rng: Rng, role: Role, quality: number): Attributes {
  const g = (bias = 0, sd = 2.2) => clamp120(rng.gauss(quality + bias, sd));
  const gk = role === "GK";
  const def = role === "CB" || role === "LB" || role === "RB" || role === "DM";
  const fwd = role === "ST" || role === "LW" || role === "RW" || role === "AM";
  const wide = role === "LB" || role === "RB" || role === "LM" || role === "RM" || role === "LW" || role === "RW";
  return {
    pace: g(wide || fwd ? 1.5 : def ? -0.5 : 0),
    acceleration: g(wide || fwd ? 1.5 : def ? -0.5 : 0),
    agility: g(fwd ? 1 : 0),
    strength: g(def ? 1.5 : 0),
    stamina: g(wide ? 1 : 0),
    passing: g(role === "CM" || role === "DM" || role === "AM" ? 1.5 : def ? -1 : 0),
    vision: g(role === "AM" || role === "CM" ? 2 : def ? -1.5 : 0),
    technique: g(fwd ? 1 : def ? -1 : 0),
    firstTouch: g(fwd ? 1 : def ? -1 : 0),
    dribbling: g(fwd ? 2 : def ? -2 : 0),
    finishing: g(role === "ST" ? 3 : fwd ? 1 : def ? -3 : -1),
    composure: g(fwd ? 1 : 0),
    tackling: g(def ? 2.5 : fwd ? -3 : 0),
    marking: g(def ? 2.5 : fwd ? -3 : 0),
    positioning: g(def ? 2 : fwd ? -1 : 0),
    decisions: g(),
    anticipation: g(def ? 1 : 0),
    reflexes: gk ? g(1) : clamp120(rng.gauss(4, 1.5)),
    handling: gk ? g(1) : clamp120(rng.gauss(4, 1.5)),
    gkPositioning: gk ? g(1) : clamp120(rng.gauss(4, 1.5)),
  };
}

export function defaultTactics(formation: FormationName = "4-3-3"): Tactics {
  return { formation, mentality: 0.5, defensiveLine: 0.5, pressing: 0.5, directness: 0.5, width: 0.6 };
}

/** Bench roles: reserve keeper plus cover for each line. */
const BENCH_ROLES: Role[] = ["GK", "CB", "LB", "CM", "AM", "RW", "ST"];

export interface GenerateTeamOptions {
  id: TeamId;
  name: string;
  shortName: string;
  color: string;
  formation?: FormationName;
  quality?: number; // 1..20 average quality
  seed?: number;
  tactics?: Partial<Tactics>;
}

export function generateTeam(opts: GenerateTeamOptions): TeamDef {
  const rng = new Rng((opts.seed ?? 42) + opts.id * 7919);
  const formation = opts.formation ?? "4-3-3";
  const quality = opts.quality ?? 12;
  const slots = FORMATIONS[formation];
  const players: PlayerDef[] = slots.map((slot, i) => ({
    id: `${opts.shortName}-${i + 1}`,
    name: `${rng.pick(FIRST)} ${rng.pick(GIVEN)}`,
    number: i === 0 ? 1 : i + 1,
    role: slot.role,
    attrs: generateAttributes(rng, slot.role, quality),
  }));
  // Bench players are a touch weaker on average (quality - 1) but fresher legs matter late on.
  const bench: PlayerDef[] = BENCH_ROLES.map((role, i) => ({
    id: `${opts.shortName}-${12 + i}`,
    name: `${rng.pick(FIRST)} ${rng.pick(GIVEN)}`,
    number: 12 + i,
    role,
    attrs: generateAttributes(rng, role, quality - 1),
  }));
  return {
    id: opts.id,
    name: opts.name,
    shortName: opts.shortName,
    color: opts.color,
    players,
    bench,
    tactics: { ...defaultTactics(formation), ...opts.tactics },
  };
}
