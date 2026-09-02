import type { Match, Role, TeamId } from "@3sec/engine";
import type { Club, Fixture, GameState, SquadPlayer } from "./types";

/** Ratings run 3.0..10.0 around a neutral 6.0. */
export const RATING_BASE = 6;
export const RATING_MIN = 3;
export const RATING_MAX = 10;
/** Match ratings kept as recent form. */
export const FORM_LENGTH = 5;
/** Appearances needed for the league rating table. */
export const RATING_MIN_APPS = 5;
/** A substitute who played fewer minutes than this is pulled halfway back toward the base. */
export const SHORT_SUB_MINUTES = 30;
/** Clean-sheet credit needs at least this many minutes on the pitch. */
export const CLEAN_SHEET_MINUTES = 60;
/** Saves beyond this count earn the keeper a bonus each. */
export const FREE_SAVES = 3;

const DEFENSIVE: Role[] = ["GK", "CB", "LB", "RB"];
export const isDefensive = (role: Role): boolean => DEFENSIVE.includes(role);

export interface RatingInput {
  goals: number;
  ownGoals: number;
  assists: number;
  yellows: number;
  reds: number;
  minutes: number;
  /** came off the bench */
  sub: boolean;
  role: Role;
  /** the opponent did not score */
  cleanSheet: boolean;
  /** the keeper's saves (0 for outfield players) */
  saves: number;
  /** +1 win, 0 draw, -1 loss for the player's team */
  result: -1 | 0 | 1;
}

const round1 = (x: number): number => Math.round(x * 10) / 10;

/**
 * One player's rating for one match:
 * base 6.0, +1.0 per goal (−1.0 per own goal), +0.7 per assist, +0.4 clean sheet for keepers and defenders
 * (≥ 60 minutes), keepers +0.2 per save above 3, −0.3 per yellow, −1.0 per red, +0.3 win / −0.3 loss.
 * A substitute with under 30 minutes is pulled halfway back to 6.0. Clamped to 3.0..10.0, one decimal.
 */
export function matchRating(i: RatingInput): number {
  let r = RATING_BASE;
  r += i.goals * 1.0 - i.ownGoals * 1.0;
  r += i.assists * 0.7;
  if (isDefensive(i.role) && i.cleanSheet && i.minutes >= CLEAN_SHEET_MINUTES) r += 0.4;
  if (i.role === "GK") r += Math.max(0, i.saves - FREE_SAVES) * 0.2;
  r -= i.yellows * 0.3;
  r -= i.reds * 1.0;
  r += i.result * 0.3;
  if (i.sub && i.minutes < SHORT_SUB_MINUTES) r = RATING_BASE + (r - RATING_BASE) / 2;
  return round1(Math.max(RATING_MIN, Math.min(RATING_MAX, r)));
}

/** Append a rating to a player's form window (last FORM_LENGTH, oldest first) and season totals. */
export function pushRating(p: SquadPlayer, rating: number): void {
  if (!Array.isArray(p.form)) p.form = [];
  p.form.push(rating);
  if (p.form.length > FORM_LENGTH) p.form.splice(0, p.form.length - FORM_LENGTH);
  p.stats.ratingSum = round1((p.stats.ratingSum ?? 0) + rating);
  p.stats.ratedApps = (p.stats.ratedApps ?? 0) + 1;
}

/** Season average rating (0 without a rated appearance). */
export function avgRating(p: SquadPlayer): number {
  const n = p.stats.ratedApps ?? 0;
  return n ? round1((p.stats.ratingSum ?? 0) / n) : 0;
}

/** Minutes played, as `recordResult` derives them from distance covered. */
export const minutesFromDistance = (distance: number): number => Math.round(90 * Math.min(1, distance / 9000));

/**
 * Rate every player who took part in a finished match, bank assists / ratings / form, and name the man of
 * the match on the fixture (highest rating; ties go to the home side, then the earlier player).
 * Called by `recordResult` after goals and cards are on the season counters.
 */
export function applyRatings(f: Fixture, m: Match, clubs: [Club, Club]): void {
  const score = m.state.score;
  let best: { playerId: string; rating: number } | null = null;
  for (const side of [0, 1] as TeamId[]) {
    const c = clubs[side];
    const opp = (1 - side) as TeamId;
    const result: -1 | 0 | 1 = score[side] > score[opp] ? 1 : score[side] < score[opp] ? -1 : 0;
    const starters = new Set(m.teams[side].players.map((p) => p.id));
    const played = m.state.players.filter((p) => p.team === side && p.distance > 0);
    // The keeper who played most takes the team's saves.
    const keeper = played.filter((ps) => c.squad.find((p) => p.id === ps.id)?.role === "GK").sort((a, b) => b.distance - a.distance)[0];
    const saves = m.state.stats[side].saves;
    const count = (id: string, type: string): number => m.state.events.filter((e) => e.type === type && e.playerId === id && e.team === side).length;
    for (const ps of played) {
      const p = c.squad.find((x) => x.id === ps.id);
      if (!p) continue;
      const assists = count(p.id, "ASSIST");
      if (assists) p.stats.assists = (p.stats.assists ?? 0) + assists;
      const minutes = minutesFromDistance(ps.distance);
      const rating = matchRating({
        goals: count(p.id, "GOAL"),
        ownGoals: m.state.events.filter((e) => e.type === "OWN_GOAL" && e.playerId === p.id).length,
        assists,
        yellows: count(p.id, "YELLOW_CARD"),
        reds: count(p.id, "RED_CARD"),
        minutes,
        sub: !starters.has(p.id),
        role: p.role,
        cleanSheet: score[opp] === 0,
        saves: keeper && keeper.id === p.id ? saves : 0,
        result,
      });
      pushRating(p, rating);
      if (!best || rating > best.rating) best = { playerId: p.id, rating };
    }
  }
  if (best) {
    f.motm = best;
    for (const c of clubs) {
      const p = c.squad.find((x) => x.id === best!.playerId);
      if (p) p.stats.motm = (p.stats.motm ?? 0) + 1;
    }
  }
}

/** Empty season counters (with the rating fields) for a fresh season or a new player. */
export const emptyStats = (): SquadPlayer["stats"] => ({ apps: 0, goals: 0, minutes: 0, yellows: 0, reds: 0, assists: 0, ratingSum: 0, ratedApps: 0, motm: 0 });

/** Move the season into every player's career list (called at the rollover before the counters reset). */
export function appendCareer(s: GameState): void {
  for (const c of s.clubs) for (const p of c.squad) {
    if (!Array.isArray(p.career)) p.career = [];
    p.career.push({ season: s.season, club: c.id, apps: p.stats.apps, goals: p.stats.goals, assists: p.stats.assists ?? 0, rating: avgRating(p) });
  }
}

export function topAssists(s: GameState, n = 10): { player: SquadPlayer; club: Club }[] {
  const all: { player: SquadPlayer; club: Club }[] = [];
  for (const club of s.clubs) for (const player of club.squad) if ((player.stats.assists ?? 0) > 0) all.push({ player, club });
  return all.sort((a, b) => (b.player.stats.assists ?? 0) - (a.player.stats.assists ?? 0) || b.player.stats.apps - a.player.stats.apps).slice(0, n);
}

/** Best average ratings among players with at least `minApps` rated appearances. */
export function topRatings(s: GameState, n = 10, minApps = RATING_MIN_APPS): { player: SquadPlayer; club: Club; rating: number }[] {
  const all: { player: SquadPlayer; club: Club; rating: number }[] = [];
  for (const club of s.clubs) for (const player of club.squad) if ((player.stats.ratedApps ?? 0) >= minApps) all.push({ player, club, rating: avgRating(player) });
  return all.sort((a, b) => b.rating - a.rating || (b.player.stats.ratedApps ?? 0) - (a.player.stats.ratedApps ?? 0)).slice(0, n);
}
