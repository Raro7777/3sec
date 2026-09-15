/**
 * Shared contract between the main thread (SimPool) and the simulation worker.
 * Everything crossing postMessage must be plain data (structured-clone safe): no Maps, classes or functions.
 */
import { Match, setTuning, type MatchEvent, type MatchOptions, type Phase, type TeamDef, type TeamId, type TeamStats, type Tuning } from "@3sec/engine";

/** One AI-vs-AI match to simulate. `id` is echoed back so results can be matched to fixtures. */
export interface SimJob {
  id: string;
  home: TeamDef;
  away: TeamDef;
  opts?: MatchOptions;
  /** Engine tuning to apply before the match; SimPool fills this with the main thread's current TUNING when absent. */
  tuning?: Partial<Tuning>;
}

/** The per-player fields `recordResult` / `penaltyShootout` read from `Match.state.players`. */
export interface ResultPlayer {
  id: string;
  team: TeamId;
  distance: number;
  fatigue: number;
  yellow: number;
  sentOff: boolean;
  injured: boolean;
  onPitch: boolean;
}

/** Serializable snapshot of a finished Match: enough for recordResult / recordCupResult bookkeeping. */
export interface MatchResult {
  id: string;
  phase: Phase;
  score: [number, number];
  events: MatchEvent[];
  players: ResultPlayer[];
  stats: [TeamStats, TeamStats];
  /** The TeamDefs as the Match left them (the constructor adjusts `tactics`: home boost, AI gap tweaks). */
  teams: [TeamDef, TeamDef];
  /** player id -> display name, for scorer lines. */
  names: Record<string, string>;
}

export type WorkerRequest = { kind: "run"; job: SimJob };
export type WorkerResponse =
  | { kind: "ready" }
  | { kind: "done"; id: string; result: MatchResult }
  | { kind: "error"; id: string; message: string };

/** Snapshot a (finished) Match into plain data. */
export function matchResult(id: string, m: Match): MatchResult {
  const names: Record<string, string> = {};
  for (const t of m.teams) for (const p of [...t.players, ...t.bench]) names[p.id] = p.name;
  return {
    id,
    phase: m.state.phase,
    score: [m.state.score[0], m.state.score[1]],
    events: m.state.events.map((e) => ({ ...e })),
    players: m.state.players.map((p) => ({ id: p.id, team: p.team, distance: p.distance, fatigue: p.fatigue, yellow: p.yellow, sentOff: p.sentOff, injured: p.injured, onPitch: p.onPitch })),
    stats: [{ ...m.state.stats[0] }, { ...m.state.stats[1] }],
    teams: [m.teams[0], m.teams[1]],
    names,
  };
}

/** Run one job to full time on the calling thread. Used by the worker and by SimPool's no-Worker fallback. */
export function simulateInThread(job: SimJob): MatchResult {
  if (job.tuning) setTuning(job.tuning);
  const m = new Match(job.home, job.away, job.opts ?? {});
  m.runToEnd();
  return matchResult(job.id, m);
}
