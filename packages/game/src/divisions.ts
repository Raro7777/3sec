/**
 * Two divisions, promotion and relegation.
 *
 * The league used to be a single closed circle of twelve: win it two or three times and the game had
 * nothing left to ask of you. A second division gives every season a floor as well as a ceiling —
 * the bottom two go down, the top two come up — so mid-table safety is worth something and a bad
 * season costs you the league you were in.
 *
 * Only the division the user plays in is simulated by the match engine. The other one is resolved by
 * the statistical model in `simulateAwayDivision`, calibrated against the engine's own season
 * aggregates, so adding a whole second league costs a matchday nothing. Promotion moves the user
 * between the two, and the division they are in is always the one played out in full.
 */
import { Rng } from "@3sec/engine";
import type { Club, Fixture, GameState, TableRow } from "./types";
import { buildFixtures } from "./fixtures";
import { CLUBS_D2 } from "./world";
import { recordAttendance } from "./fans";

export { CLUBS_D2 };

/** How many divisions there are, and how many clubs in each. */
export const DIVISIONS = 2;
export const CLUBS_PER_DIVISION = 12;
/** Clubs that swap divisions at the rollover: the bottom `SWAP` of a division for the top `SWAP` of the one below. */
export const SWAP = 2;

/** A club's division; saves from the one-league game have none and are all first division. */
export const divisionOf = (c: Club): number => c.division ?? 1;
export const userDivision = (s: GameState): number => divisionOf(s.clubs[s.userClub]!);
export const clubsIn = (s: GameState, division: number): Club[] => s.clubs.filter((c) => divisionOf(c) === division);

export const DIVISION_NAME: Record<number, string> = { 1: "1부 리그", 2: "2부 리그" };
export const divisionName = (d: number): string => DIVISION_NAME[d] ?? `${d}부 리그`;

/**
 * Prize money and league income scale down with the division: second-division football pays roughly
 * a third of what the top flight does, which is what makes promotion worth chasing and relegation
 * worth fearing beyond the league table itself.
 */
export const DIVISION_PRIZE_FACTOR: Record<number, number> = { 1: 1, 2: 0.32 };
export const prizeFactor = (division: number): number => DIVISION_PRIZE_FACTOR[division] ?? 0.32;

/**
 * One-off payment (억원) to a promoted club, paid at the rollover.
 *
 * Without it promotion was a one-year holiday. Measured over a season, a club coming up arrived with
 * 29억 against the 87억 of the division it joined — and less even than the 79억 of the clubs that had
 * just dropped out of it, who then bounced straight back. A median first-division player costs 18억,
 * so promotion bought a single signing and three quarters of promoted clubs went down again inside
 * two seasons.
 *
 * The money is deliberately the lever rather than a bigger reputation bump: reputation also raises
 * what the board expects and what squads are generated at, so a promoted side would be handed a
 * mid-table demand in the same breath as promotion. Cash leaves the manager free to spend it or not.
 */
export const PROMOTION_PRIZE = 35;


/**
 * Fixtures for every division on one shared calendar: each division plays its own double
 * round-robin, and both use the same round numbers so a matchday is a matchday everywhere.
 *
 * Club ids are not division-contiguous once clubs have been promoted and relegated, so the
 * round-robin is built over positions and then mapped onto whichever ids are in the division.
 */
export function buildAllFixtures(clubs: Club[]): Fixture[] {
  const all: Fixture[] = [];
  let id = 0;
  for (let d = 1; d <= DIVISIONS; d++) {
    const ids = clubs.filter((c) => divisionOf(c) === d).map((c) => c.id);
    if (ids.length < 2) continue;
    for (const f of buildFixtures(ids.length)) {
      all.push({ ...f, id: id++, home: ids[f.home]!, away: ids[f.away]! });
    }
  }
  return all;
}

/** The league table of one division. */
export function divisionTable(s: GameState, division: number): TableRow[] {
  const ids = new Set(clubsIn(s, division).map((c) => c.id));
  const rows = new Map<number, TableRow>();
  for (const id of ids) rows.set(id, { club: id, played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, pts: 0 });
  for (const f of s.fixtures) {
    if (!f.score || !ids.has(f.home) || !ids.has(f.away)) continue;
    const h = rows.get(f.home)!, a = rows.get(f.away)!;
    const [hg, ag] = f.score;
    h.played++; a.played++;
    h.gf += hg; h.ga += ag; a.gf += ag; a.ga += hg;
    if (hg > ag) { h.won++; a.lost++; h.pts += 3; }
    else if (hg < ag) { a.won++; h.lost++; a.pts += 3; }
    else { h.drawn++; a.drawn++; h.pts++; a.pts++; }
  }
  return [...rows.values()].sort((x, y) => y.pts - x.pts || (y.gf - y.ga) - (x.gf - x.ga) || y.gf - x.gf || s.clubs[x.club]!.name.localeCompare(s.clubs[y.club]!.name));
}

/** Where a club finished (1-based) in its own division, or 0 when it has no table. */
export function divisionPosition(s: GameState, clubId: number): number {
  const c = s.clubs[clubId];
  if (!c) return 0;
  return divisionTable(s, divisionOf(c)).findIndex((r) => r.club === clubId) + 1;
}

/**
 * Match odds from the two sides' strength, calibrated so a whole simulated division reproduces the
 * engine's own season: ~2.95 goals a match and a 43/23/34 home/draw/away split between equal sides.
 * Strength is club reputation, which is what the squads were built around.
 */
function goalRates(homeRep: number, awayRep: number): [number, number] {
  const gap = Math.max(-3, Math.min(3, homeRep - awayRep));
  // 1.62/1.33 splits the engine's 2.95 goals into the measured home share; a reputation point is
  // worth about 18% of a goal either way.
  return [Math.max(0.25, 1.62 + gap * 0.18), Math.max(0.25, 1.33 - gap * 0.18)];
}

/** One Poisson draw (Knuth); the rates here are small so the loop is a couple of iterations. */
function poisson(rng: Rng, lambda: number): number {
  const limit = Math.exp(-lambda);
  let k = 0, p = 1;
  do { k++; p *= rng.next(); } while (p > limit && k < 12);
  return k - 1;
}

/**
 * Play one fixture of a division the user is not in. The result is a score and a list of scorers
 * drawn from the two squads, which is everything the table, the news and the top-scorer list need —
 * no player minutes, cards, injuries or fatigue, since nobody is watching that league week to week.
 */
export function simulateFixture(s: GameState, f: Fixture, rng: Rng): void {
  const home = s.clubs[f.home]!, away = s.clubs[f.away]!;
  const [lh, la] = goalRates(home.reputation, away.reputation);
  const hg = poisson(rng, lh), ag = poisson(rng, la);
  f.score = [hg, ag];
  // A league nobody watches still sells tickets: without this a club would arrive in the user's
  // division having banked no gate money all season and be broke on promotion (fans.ts).
  recordAttendance(s, f, false);
  f.scorers = [
    ...Array.from({ length: hg }, () => pickScorer(home, rng)),
    ...Array.from({ length: ag }, () => pickScorer(away, rng)),
  ]
    .map((p, i) => ({ p, minute: 1 + Math.floor(rng.next() * 90), side: i < hg ? home : away }))
    .sort((x, y) => x.minute - y.minute)
    .map(({ p, minute, side }) => {
      p.stats.goals++;
      return `${minute}' ${p.name} (${side.shortName})`;
    });
}

/** Who scored: forwards and attacking midfielders far more often than defenders, never the keeper. */
function pickScorer(c: Club, rng: Rng) {
  const weight = (role: string): number =>
    role === "ST" ? 10 : role === "LW" || role === "RW" || role === "AM" ? 6 : role === "LM" || role === "RM" || role === "CM" ? 3 : role === "GK" ? 0 : 1;
  const pool = c.squad.filter((p) => weight(p.role) > 0);
  const total = pool.reduce((a, p) => a + weight(p.role), 0);
  let t = rng.next() * total;
  for (const p of pool) { t -= weight(p.role); if (t <= 0) return p; }
  return pool[pool.length - 1]!;
}

/** Play this round's fixtures in every division the user is not in. */
export function simulateAwayDivisions(s: GameState): void {
  const mine = userDivision(s);
  for (const f of s.fixtures) {
    if (f.round !== s.round || f.score) continue;
    const d = divisionOf(s.clubs[f.home]!);
    if (d === mine) continue;
    simulateFixture(s, f, new Rng((s.seed * 7919 + s.season * 104729 + f.id * 131 + 17) >>> 0));
  }
}

export interface SwapResult {
  /** clubs going down, top division first */
  relegated: { club: number; from: number }[];
  /** clubs coming up */
  promoted: { club: number; to: number }[];
}

/**
 * Move the bottom `SWAP` of each division down and the top `SWAP` of the division below up.
 *
 * Reputation moves with them: a promoted club gains standing (and with it income and the squads it
 * can attract), a relegated one loses it. Without that a relegated giant would walk straight back
 * up every year and the second division would never change shape.
 */
export function applyPromotionRelegation(s: GameState): SwapResult {
  const out: SwapResult = { relegated: [], promoted: [] };
  for (let d = 1; d < DIVISIONS; d++) {
    const upper = divisionTable(s, d);
    const lower = divisionTable(s, d + 1);
    if (upper.length < SWAP || lower.length < SWAP) continue;
    const down = upper.slice(-SWAP).map((r) => r.club);
    const up = lower.slice(0, SWAP).map((r) => r.club);
    for (const id of down) {
      const c = s.clubs[id]!;
      c.division = d + 1;
      c.reputation = Math.round(Math.max(6, c.reputation - 0.8) * 10) / 10;
      out.relegated.push({ club: id, from: d });
    }
    for (const id of up) {
      const c = s.clubs[id]!;
      c.division = d;
      c.reputation = Math.round(Math.min(15, c.reputation + 0.8) * 10) / 10;
      c.budget = Math.round((c.budget + PROMOTION_PRIZE) * 10) / 10;
      out.promoted.push({ club: id, to: d });
    }
  }
  return out;
}

/** Is this club in the relegation zone as the table stands? (For the standings screen.) */
export function inRelegationZone(s: GameState, clubId: number): boolean {
  const c = s.clubs[clubId];
  if (!c || divisionOf(c) >= DIVISIONS) return false;
  const rows = divisionTable(s, divisionOf(c));
  return rows.slice(-SWAP).some((r) => r.club === clubId);
}

/** Is this club in the promotion places as the table stands? */
export function inPromotionZone(s: GameState, clubId: number): boolean {
  const c = s.clubs[clubId];
  if (!c || divisionOf(c) <= 1) return false;
  const rows = divisionTable(s, divisionOf(c));
  return rows.slice(0, SWAP).some((r) => r.club === clubId);
}
