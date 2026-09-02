/**
 * Shared fixtures for scripts/check-worker.mjs. Runs in two places:
 *  - node (via tsx): prints the in-thread reference results as JSON.
 *  - browser (bundled by esbuild): exposes window.runCheck(), which runs the same jobs through SimPool
 *    (workers, then forced in-thread) and times 6 matches both ways.
 */
import { generateTeam, type TeamDef } from "@3sec/engine";
import { simulateInThread, type MatchResult, type SimJob } from "../src/sim/protocol";
import { SimPool } from "../src/sim/pool";
import { resultToMatchLike } from "../src/sim/adapter";

export const JOB_COUNT = 6;

const team = (id: 0 | 1, seed: number, quality: number): TeamDef =>
  generateTeam({ id, name: id === 0 ? `Home ${seed}` : `Away ${seed}`, shortName: id === 0 ? `H${seed}` : `A${seed}`, color: id === 0 ? "#c33" : "#33c", seed, quality, formation: (["4-3-3", "4-4-2", "4-2-3-1", "3-5-2"] as const)[seed % 4] });

export function makeJobs(n = JOB_COUNT): SimJob[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `job${i}`,
    home: team(0, 100 + i, 9 + (i % 5)),
    away: team(1, 200 + i, 8 + ((i * 3) % 6)),
    opts: { seed: 1000 + i * 7, aiManaged: [0, 1] as (0 | 1)[] },
  }));
}

/** Compact, order-stable digest of a result for comparison. */
export function digest(r: MatchResult) {
  const round = (x: number) => Math.round(x * 1000) / 1000;
  const m = resultToMatchLike(r);
  const scorers = r.events.filter((e) => e.type === "GOAL" || e.type === "OWN_GOAL").map((e) => `${e.minute}' ${e.playerId ? m.def(e.playerId).name : "?"} (${m.teams[e.team!]!.shortName})`);
  return {
    id: r.id,
    phase: r.phase,
    score: r.score,
    events: r.events.length,
    eventSig: r.events.map((e) => `${e.type}@${round(e.t)}:${e.playerId ?? "-"}`).join("|"),
    scorers,
    shots: [r.stats[0].shots, r.stats[1].shots],
    xg: [round(r.stats[0].xg), round(r.stats[1].xg)],
    distance: round(r.players.reduce((a, p) => a + p.distance, 0)),
    fatigue: round(r.players.reduce((a, p) => a + p.fatigue, 0)),
    yellows: r.players.reduce((a, p) => a + p.yellow, 0),
    onPitch: r.players.filter((p) => p.onPitch).length,
    homeTactics: { ...r.teams[0].tactics, roles: undefined, instructions: undefined, setPieces: undefined },
  };
}
export type Digest = ReturnType<typeof digest>;

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

if (typeof window === "undefined") {
  // node: in-thread reference
  const t0 = now();
  const digests = makeJobs().map((j) => digest(simulateInThread(j)));
  console.log(JSON.stringify({ digests, ms: Math.round(now() - t0) }));
} else {
  (window as unknown as { runCheck: () => Promise<unknown> }).runCheck = async () => {
    const jobs = makeJobs();
    const pool = new SimPool();
    const t0 = now();
    const progress: number[] = [];
    const viaWorkers = await pool.run(jobs, (done) => progress.push(done));
    const workerMs = Math.round(now() - t0);
    const workerDigests = jobs.map((j) => digest(viaWorkers.get(j.id)!));
    const mode = pool.mode, workerCount = pool.workerCount;
    // Second run on the same (now JIT-warm) pool: what repeated rounds in the app see.
    const t2 = now();
    await pool.run(makeJobs());
    const workerWarmMs = Math.round(now() - t2);
    pool.dispose();

    const inThreadPool = new SimPool({ forceInThread: true });
    const t1 = now();
    const viaThread = await inThreadPool.run(jobs);
    const threadMs = Math.round(now() - t1);
    const threadDigests = jobs.map((j) => digest(viaThread.get(j.id)!));
    return { mode, workerCount, hardwareConcurrency: navigator.hardwareConcurrency, workerMs, workerWarmMs, threadMs, progress, workerDigests, threadDigests, protocol: location.protocol };
  };
}
