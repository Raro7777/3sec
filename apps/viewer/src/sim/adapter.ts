/**
 * Glue between SimPool results and the season layer (@3sec/game), which was written against a live `Match`.
 *
 * - `leagueJob` / `cupJob` build a SimJob with exactly the inputs `createMatch` / `createCupMatch` would hand the engine.
 * - `resultToMatchLike` wraps a MatchResult in the subset of the Match surface that `recordResult`, `recordCupResult`
 *   and `penaltyShootout` read: `state.{phase,score,events,players}`, `teams[side].shortName`, `def(id)`.
 */
import type { Match, MatchOptions, PlayerDef, TeamId } from "@3sec/engine";
import { clubOf, cupFixture, fixtureSeed, teamDef, type CupTie, type Fixture, type GameState } from "@3sec/game";
import type { MatchResult, ResultPlayer, SimJob } from "./protocol";

/** Mirrors `createMatch` in packages/game/src/season.ts: user's side human-managed, everyone else AI, tired legs carried over. */
export function leagueJob(s: GameState, f: Fixture, opts: MatchOptions = {}): SimJob {
  const home = clubOf(s, f.home);
  const away = clubOf(s, f.away);
  const initialFatigue: Record<string, number> = {};
  for (const c of [home, away]) for (const p of c.squad) initialFatigue[p.id] = Math.max(0, Math.min(0.6, (1 - p.condition) * 0.8));
  const aiManaged: TeamId[] = [];
  if (f.home !== s.userClub) aiManaged.push(0);
  if (f.away !== s.userClub) aiManaged.push(1);
  return { id: jobId(f), home: teamDef(home, 0), away: teamDef(away, 1), opts: { seed: fixtureSeed(s, f), aiManaged, initialFatigue, ...opts } };
}

/** Mirrors `createCupMatch`: a cup tie viewed as a (negative-id) fixture. */
export function cupJob(s: GameState, t: CupTie, opts: MatchOptions = {}): SimJob {
  return leagueJob(s, cupFixture(t), opts);
}

/** Stable job id for a fixture (cup ties already have unique negative ids via `cupFixture`). */
export const jobId = (f: Fixture): string => `fixture:${f.id}`;

/** The part of `Match` that the season bookkeeping reads. Cast to `Match` at the call site. */
export interface MatchLike {
  readonly state: Pick<Match["state"], "phase" | "score" | "events" | "stats"> & { players: ResultPlayer[] };
  readonly teams: Match["teams"];
  readonly result: MatchResult;
  def(id: string): PlayerDef;
  player(id: string): ResultPlayer;
}

export function resultToMatchLike(r: MatchResult): MatchLike {
  const defs = new Map<string, PlayerDef>();
  for (const t of r.teams) for (const p of [...t.players, ...t.bench]) defs.set(p.id, p);
  const players = new Map(r.players.map((p) => [p.id, p]));
  return {
    state: { phase: r.phase, score: r.score, events: r.events, stats: r.stats, players: r.players },
    teams: r.teams,
    result: r,
    def(id) {
      const d = defs.get(id);
      if (!d) throw new Error(`unknown player ${id}`);
      return d;
    },
    player(id) {
      const p = players.get(id);
      if (!p) throw new Error(`unknown player ${id}`);
      return p;
    },
  };
}

/** Convenience: the `Match`-typed view most call sites want (`recordResult(s, f, asMatch(r))`). */
export const asMatch = (r: MatchResult): Match => resultToMatchLike(r) as unknown as Match;
