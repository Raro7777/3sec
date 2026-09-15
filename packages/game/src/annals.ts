/**
 * 기록실: the club's all-time records and the league's season-by-season chronicle, read from the
 * players' CVs (career entries, kept when they move) and the season history.
 */
import type { Club, GameState, SquadPlayer } from "./types";
import { avgRating } from "./ratings";

export interface ClubRecordLine { name: string; value: number; seasons: string; playerId: string; current: boolean }
export interface SeasonBest { name: string; season: number; value: number; playerId: string }
export interface ClubRecords {
  /** most goals for the club across every season (current squad, other squads and free agents) */
  topScorers: ClubRecordLine[];
  topApps: ClubRecordLine[];
  /** best single season at the club */
  seasonGoals: SeasonBest | null;
  seasonRating: SeasonBest | null;
  /** seasons the club has on record */
  seasonsOnRecord: number;
}

const RATING_MIN_APPS = 10;

/** Everyone who ever played for `clubId`, wherever they are now. */
function everyone(s: GameState): { player: SquadPlayer; club: Club | null }[] {
  const all: { player: SquadPlayer; club: Club | null }[] = [];
  for (const c of s.clubs) for (const player of c.squad) all.push({ player, club: c });
  for (const player of s.freeAgents ?? []) all.push({ player, club: null });
  return all;
}

export function clubRecords(s: GameState, clubId: number, n = 5): ClubRecords {
  const lines: { player: SquadPlayer; current: boolean; goals: number; apps: number; seasons: number[] }[] = [];
  let seasonGoals: SeasonBest | null = null, seasonRating: SeasonBest | null = null;
  const seasons = new Set<number>();
  for (const { player, club } of everyone(s)) {
    let goals = 0, apps = 0; const played: number[] = [];
    for (const e of player.career ?? []) {
      if (e.club !== clubId) continue;
      goals += e.goals; apps += e.apps; played.push(e.season); seasons.add(e.season);
      if (!seasonGoals || e.goals > seasonGoals.value) seasonGoals = { name: player.name, season: e.season, value: e.goals, playerId: player.id };
      if (e.apps >= RATING_MIN_APPS && e.rating > 0 && (!seasonRating || e.rating > seasonRating.value)) seasonRating = { name: player.name, season: e.season, value: e.rating, playerId: player.id };
    }
    const here = club?.id === clubId;
    if (here) {
      goals += player.stats.goals; apps += player.stats.apps; if (player.stats.apps) played.push(s.season);
      if (!seasonGoals || player.stats.goals > seasonGoals.value) seasonGoals = { name: player.name, season: s.season, value: player.stats.goals, playerId: player.id };
      const r = avgRating(player);
      if ((player.stats.ratedApps ?? 0) >= RATING_MIN_APPS && r > 0 && (!seasonRating || r > seasonRating.value)) seasonRating = { name: player.name, season: s.season, value: r, playerId: player.id };
    }
    if (apps > 0 || goals > 0) lines.push({ player, current: here, goals, apps, seasons: played });
  }
  const span = (xs: number[]) => { if (!xs.length) return ""; const a = Math.min(...xs), b = Math.max(...xs); return a === b ? `S${a}` : `S${a}~S${b}`; };
  const line = (x: (typeof lines)[number], value: number): ClubRecordLine => ({ name: x.player.name, value, seasons: span(x.seasons), playerId: x.player.id, current: x.current });
  return {
    topScorers: [...lines].filter((x) => x.goals > 0).sort((a, b) => b.goals - a.goals || b.apps - a.apps).slice(0, n).map((x) => line(x, x.goals)),
    topApps: [...lines].sort((a, b) => b.apps - a.apps || b.goals - a.goals).slice(0, n).map((x) => line(x, x.apps)),
    seasonGoals: seasonGoals && seasonGoals.value > 0 ? seasonGoals : null,
    seasonRating,
    seasonsOnRecord: seasons.size + 1,
  };
}
