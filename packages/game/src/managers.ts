import { nameFor, type Nationality } from "./names";
import { FORMATIONS, Rng, autoRoles, normalizeTactics, type FormationName, type PlayerRoleId, type Tactics } from "@3sec/engine";
import type { Club, GameState, Manager, ManagerOfYear, ManagerTraitId, ManagerTraits, TableRow, TrainingFocus, TrainingIntensity } from "./types";
import { DIVISIONS, clubsIn, divisionTable } from "./divisions";
import { randomName } from "./world";
import { clubOf, table } from "./season";
import { autoSelect } from "./selection";
import { userStartingStaff } from "./staff";

/** Sacked managers kept in the free pool. */
export const MAX_FREE_MANAGERS = 10;
/** Board reviews start once the table means something. */
export const REVIEW_FROM_ROUND = 8;
/** Places below the reputation-based expectation that count as underperformance. */
export const PRESSURE_GAP = 4;
/** Consecutive underperforming reviews before the board reaches for the axe. */
export const PRESSURE_LIMIT = 6;
/** Per-review sacking probability once the limit is reached. */
export const SACK_CHANCE = 0.5;
/** A manager retires at the rollover once this old. */
export const RETIRE_AGE = 66;

export const TRAIT_IDS: ManagerTraitId[] = ["attack", "possession", "pressing", "pragmatism", "youth", "spending", "stubborn", "temper"];

const clamp = (x: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, x));
const r2 = (x: number): number => Math.round(x * 100) / 100;

// ------------------------------------------------------------------ generation

/** A fresh manager from the dice: traits spread wide so personalities are distinct, age 36..62. */
export function generateManager(rng: Rng, season: number, id: string, nat: Nationality = "한국"): Manager {
  const traits = {} as ManagerTraits;
  for (const k of TRAIT_IDS) traits[k] = r2(clamp(0.05 + rng.next() * 0.9 + rng.gauss(0, 0.08), 0.02, 0.98));
  return { id, name: nat === "한국" ? randomName(rng) : nameFor(rng, nat), ...(nat === "한국" ? {} : { nat }), age: rng.int(36, 62), traits, since: season, history: [] };
}

/** Number of traits on which the two differ by at least 0.4. */
export function traitDistance(a: ManagerTraits, b: ManagerTraits): number {
  return TRAIT_IDS.filter((k) => Math.abs(a[k] - b[k]) >= 0.4).length;
}

/** A replacement who is recognisably different (≥ 2 traits off by ≥ 0.4) from the man he follows. */
export function differentManager(rng: Rng, season: number, id: string, from: Manager | null): Manager {
  let m = generateManager(rng, season, id);
  for (let i = 0; from && i < 12 && traitDistance(m.traits, from.traits) < 2; i++) m = generateManager(rng, season, `${id}-${i}`);
  if (from && traitDistance(m.traits, from.traits) < 2) {
    // force two traits to the far side
    for (const k of TRAIT_IDS.slice(0, 2)) m.traits[k] = r2(from.traits[k] >= 0.5 ? clamp(from.traits[k] - 0.5, 0.02, 0.98) : clamp(from.traits[k] + 0.5, 0.02, 0.98));
  }
  m.id = id;
  return m;
}

// ------------------------------------------------------------------ style → tactics

/** Deterministic pick between two options per manager (hash of the id). */
function pickBy(m: Manager, a: FormationName, b: FormationName): FormationName {
  let h = 0;
  for (const ch of m.id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % 2 === 0 ? a : b;
}

/** The formation a manager prefers; a middle-of-the-road man keeps whatever the club plays. */
export function managerFormation(m: Manager, current: FormationName): FormationName {
  const t = m.traits;
  if (t.possession > 0.6) return pickBy(m, "4-3-3", "4-2-3-1");
  if (t.attack < 0.35) return pickBy(m, "4-4-2", "3-5-2");
  return current;
}

/** Whether a manager sets up for a stronger opponent (pragmatists only). */
export const adaptsTo = (m: Manager, club: Club, opponent: Club | null | undefined): boolean =>
  !!opponent && m.traits.pragmatism > 0.6 && opponent.reputation - club.reputation >= 1;

/** Roles the style leans on, applied over autoRoles where the slot allows. */
function styleRoles(m: Manager, formation: FormationName, roles: PlayerRoleId[]): PlayerRoleId[] {
  const t = m.traits;
  const slots = FORMATIONS[formation];
  return roles.map((r, i) => {
    const slot = slots[i]!.role;
    const wide = slot === "LW" || slot === "RW" || slot === "LM" || slot === "RM";
    const back = slot === "LB" || slot === "RB";
    if (t.attack > 0.65) {
      if (back) return "WB";
      if (wide) return "IF";
    } else if (t.attack < 0.35) {
      if (back) return "DFB";
      if (slot === "DM") return "ANC";
      if (wide) return "DW";
    }
    return r;
  });
}

/**
 * Team instructions from the personality, on top of the players' natural roles. A pragmatist facing a
 * stronger side drops deeper and plays for the counter; an idealist plays his way regardless. A hot head
 * pushes his mentality a little further from the middle.
 */
export function managerTactics(m: Manager, club: Club, opponent?: Club | null): Tactics {
  const t = m.traits;
  const formation = club.selection.formation;
  let mentality = 0.3 + 0.4 * t.attack;
  let directness = 0.75 - 0.5 * t.possession;
  const pressing = 0.3 + 0.5 * t.pressing;
  let defensiveLine = 0.35 + 0.35 * t.attack + (t.pressing > 0.6 ? 0.1 : 0);
  const width = 0.45 + 0.25 * t.attack - 0.1 * (t.possession - 0.5);
  const tempo = 0.35 + 0.4 * t.attack;
  let counter = 0.4 + 0.4 * (1 - t.possession);
  const engageLine = 0.15 + 0.8 * t.pressing;
  let offsideTrap = t.attack > 0.6 && t.pragmatism < 0.4;
  if (t.temper > 0.7) mentality += mentality >= 0.5 ? 0.05 : -0.05;
  if (adaptsTo(m, club, opponent)) {
    mentality -= 0.15;
    defensiveLine -= 0.15;
    directness += 0.15;
    counter += 0.2;
    offsideTrap = false;
  }
  const attrs = club.selection.starters.map((id) => club.squad.find((p) => p.id === id)?.attrs);
  const roles = styleRoles(m, formation, autoRoles(formation, attrs));
  return normalizeTactics({
    formation,
    mentality: clamp(mentality, 0, 1),
    defensiveLine: clamp(defensiveLine, 0, 1),
    pressing: clamp(pressing, 0, 1),
    directness: clamp(directness, 0, 1),
    width: clamp(width, 0, 1),
    tempo: clamp(tempo, 0, 1),
    counter: clamp(counter, 0, 1),
    engageLine: clamp(engageLine, 0, 1),
    offsideTrap,
    roles,
  });
}

/** An AI club's matchday setup: the manager's formation, best XI for it and his tactics against this opponent. */
export function applyManagerMatchday(club: Club, opponent: Club | null | undefined): void {
  const m = club.manager;
  if (!m) return;
  const formation = managerFormation(m, club.selection.formation);
  club.selection = autoSelect(club, formation);
  club.tactics = managerTactics(m, club, opponent);
}

// ------------------------------------------------------------------ club policy (training, academy)

export function managerTraining(m: Manager): { focus: TrainingFocus; intensity: TrainingIntensity } {
  const t = m.traits;
  const focus: TrainingFocus = t.attack > 0.65 ? "attacking" : t.pressing > 0.65 ? "physical" : t.possession > 0.65 ? "technical" : "balanced";
  return { focus, intensity: t.temper > 0.6 ? "high" : "normal" };
}

/** Training and academy settings a manager runs at a club (budget decides how far a youth man can go). */
export function applyManagerPolicy(club: Club): void {
  const m = club.manager;
  if (!m) return;
  club.training = managerTraining(m);
  const t = m.traits;
  if (t.youth > 0.6) {
    const rich = club.budget >= 60;
    club.youth.scouting = rich ? "national" : "regional";
    club.youth.coaching = rich ? 3 : 2;
  } else if (t.youth < 0.35) {
    club.youth.scouting = "local";
    club.youth.coaching = 1;
  } else {
    club.youth.scouting = "local";
    club.youth.coaching = club.budget >= 80 ? 2 : 1;
  }
}

// ------------------------------------------------------------------ presentation helpers shared with the UI

/** Up to three Korean tags for the strongest traits (news lines and the UI). */
export function managerTags(m: Manager): string[] {
  const t = m.traits;
  const cands: { w: number; tag: string }[] = [
    { w: Math.abs(t.attack - 0.5), tag: t.attack > 0.5 ? "공격적" : "수비적" },
    { w: Math.abs(t.possession - 0.5), tag: t.possession > 0.5 ? "점유 축구" : "롱볼" },
    { w: t.pressing - 0.5, tag: "강한 압박" },
    { w: Math.abs(t.pragmatism - 0.5), tag: t.pragmatism > 0.5 ? "실용주의" : "이상주의" },
    { w: t.youth - 0.5, tag: "유스 중시" },
    { w: Math.abs(t.spending - 0.5), tag: t.spending > 0.5 ? "큰손" : "짠물" },
    { w: t.stubborn - 0.5, tag: "협상 강경" },
    { w: t.temper - 0.5, tag: "다혈질" },
  ];
  return cands.filter((c) => c.w >= 0.15).sort((a, b) => b.w - a.w).slice(0, 3).map((c) => c.tag);
}

/** Season-long expectation: 1 for the biggest reputation, N for the smallest. */
export function expectedPositions(s: GameState): Map<number, number> {
  // Expectation is set inside a club's own division: a relegated giant is expected to win the second
  // division, not to finish thirteenth overall (divisions.ts).
  const out = new Map<number, number>();
  for (let d = 1; d <= DIVISIONS; d++) {
    [...clubsIn(s, d)]
      .sort((a, b) => b.reputation - a.reputation || a.id - b.id)
      .forEach((c, i) => out.set(c.id, i + 1));
  }
  return out;
}

/** Every division's table, flattened, each row carrying its position inside its own division. */
function allDivisionRows(s: GameState): { club: TableRow; position: number }[] {
  const out: { club: TableRow; position: number }[] = [];
  for (let d = 1; d <= DIVISIONS; d++) divisionTable(s, d).forEach((r, i) => out.push({ club: r, position: i + 1 }));
  return out;
}

/** The manager who beat his club's expectation by the most (the user counts too); ties go to the higher finish. */
export function managerOfYear(s: GameState): ManagerOfYear | null {
  const expected = expectedPositions(s);
  const rows = table(s);
  let best: ManagerOfYear | null = null;
  rows.forEach((r, i) => {
    const club = clubOf(s, r.club);
    const name = club.id === s.userClub ? s.managerName : club.manager?.name;
    if (!name) return;
    const cand: ManagerOfYear = { name, club: club.id, position: i + 1, expected: expected.get(club.id)! };
    const score = (x: ManagerOfYear) => x.expected - x.position;
    if (!best || score(cand) > score(best) || (score(cand) === score(best) && cand.position < best.position)) best = cand;
  });
  return best;
}

// ------------------------------------------------------------------ board review: sackings and hires

function hire(s: GameState, club: Club, rng: Rng, from: Manager | null): Manager {
  const id = `M${club.id}-S${s.season}R${s.round}`;
  // the pool first: anyone recognisably different from the man who just left
  const idx = s.freeManagers.findIndex((m) => !from || traitDistance(m.traits, from.traits) >= 2);
  let m: Manager;
  if (idx >= 0) m = s.freeManagers.splice(idx, 1)[0]!;
  else m = differentManager(rng, s.season, id, from);
  m.since = s.season;
  club.manager = m;
  club.pressure = 0;
  applyManagerPolicy(club);
  return m;
}

function release(s: GameState, m: Manager, club: Club, position: number): void {
  if (!m.history.some((h) => h.season === s.season && h.club === club.id)) m.history.push({ season: s.season, club: club.id, position });
  m.since = s.season;
  s.freeManagers.unshift(m);
  if (s.freeManagers.length > MAX_FREE_MANAGERS) s.freeManagers.length = MAX_FREE_MANAGERS;
}

function sackNews(s: GameState, club: Club, old: Manager, fresh: Manager, position: number, expected: number, why: string): void {
  s.news.unshift(`${club.shortName}: ${fresh.name} 감독 부임 (성향: ${managerTags(fresh).join(", ") || "무난함"}).`);
  s.news.unshift(`${club.shortName}: ${old.name} 감독 ${why} (${position}위, 기대 ${expected}위).`);
}

/**
 * The boards look at the table. An AI club sitting PRESSURE_GAP+ places below its reputation-based
 * expectation adds a notch of pressure per review; from PRESSURE_LIMIT notches the manager is sacked with
 * probability SACK_CHANCE each review. At the rollover (`final`) a finish that far below expectation is judged
 * outright with the same odds. Returns the clubs that changed manager.
 */
export function boardReview(s: GameState, rng: Rng, final = false): Club[] {
  if (!Array.isArray(s.freeManagers)) s.freeManagers = [];
  const expected = expectedPositions(s);
  // Every division's boards judge their own managers, not just the user's league.
  const rows = allDivisionRows(s);
  const changed: Club[] = [];
  rows.forEach(({ club: r, position: i1 }) => {
    const i = i1 - 1;
    const club = clubOf(s, r.club);
    const m = club.manager;
    if (!m || club.id === s.userClub) return;
    // Nobody is judged on a league that has not kicked off: an empty table ranks by name, not merit.
    if (r.played === 0) return;
    const pos = i + 1, exp = expected.get(club.id)!;
    const under = pos - exp >= PRESSURE_GAP;
    club.pressure = under ? (club.pressure ?? 0) + 1 : 0;
    const due = final ? under : club.pressure >= PRESSURE_LIMIT;
    if (!due || rng.next() >= SACK_CHANCE) return;
    release(s, m, club, pos);
    const fresh = hire(s, club, rng, m);
    sackNews(s, club, m, fresh, pos, exp, "경질");
    changed.push(club);
  });
  return changed;
}

/**
 * Season rollover for the dugouts: every AI manager's CV gains the season, the award is handed out, the
 * boards judge the final table, and anyone old enough retires. Call before `s.season` is bumped.
 */
export function managerRollover(s: GameState, rng: Rng): ManagerOfYear | null {
  if (!Array.isArray(s.freeManagers)) s.freeManagers = [];
  const rows = allDivisionRows(s);
  const expected = expectedPositions(s);
  rows.forEach(({ club: r, position }) => {
    const club = clubOf(s, r.club);
    if (club.manager && club.id !== s.userClub) club.manager.history.push({ season: s.season, club: club.id, position });
  });
  const award = managerOfYear(s);
  if (award) s.news.unshift(`올해의 감독: ${award.name} (${clubOf(s, award.club).shortName}, 기대 ${award.expected}위 → ${award.position}위).`);
  boardReview(s, rng, true);
  for (const m of s.freeManagers) m.age++;
  rows.forEach(({ club: r, position }) => {
    const club = clubOf(s, r.club);
    const m = club.manager;
    if (!m || club.id === s.userClub) return;
    m.age++;
    club.pressure = 0;
    if (m.age >= RETIRE_AGE) {
      // retirees do not join the pool
      m.since = s.season;
      const fresh = hire(s, club, rng, m);
      sackNews(s, club, m, fresh, position, expected.get(club.id)!, "은퇴");
    }
  });
  return award;
}

/** The user's club has no AI manager, starts on plain training (the human sets it) and with a modest three-man staff. Called by newGame. */
export function clearUserManager(s: GameState): void {
  const me = clubOf(s, s.userClub);
  me.manager = null;
  me.pressure = 0;
  me.training = { focus: "balanced", intensity: "normal" };
  me.staff = userStartingStaff(new Rng(s.seed * 53 + me.id * 1009 + 21), me, s.season);
  s.staffSeason = s.season; // the staff rollover (staff.ts) is owed from this season on
}
