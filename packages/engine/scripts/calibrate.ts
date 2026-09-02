/**
 * Automated calibration of the match engine against real-world per-match statistics.
 *
 *   pnpm calibrate                 # 10 rounds of coordinate descent, 8 matches per evaluation
 *   pnpm calibrate 6 12            # 6 rounds, 12 matches per evaluation
 *
 * Writes the best tuning to scripts/tuning.best.json after every improvement.
 */
import { spawn } from "node:child_process";
import { cpus } from "node:os";
import { writeFileSync, existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { DEFAULT_TUNING, type Tuning } from "../src/index";

const here = dirname(fileURLToPath(import.meta.url));
const workerPath = join(here, "calib-worker.ts");
const bestPath = join(here, "tuning.best.json");

const rounds = Number(process.argv[2] ?? 10);
const matchesPerEval = Number(process.argv[3] ?? 8);
const workers = Math.max(1, Math.min(cpus().length, matchesPerEval));

/** Real-world targets (top-flight averages per match, both teams combined) and weights. */
const TARGETS: { key: string; target: number; weight: number; label: string }[] = [
  { key: "goals", target: 2.7, weight: 3, label: "goals" },
  { key: "shots", target: 25, weight: 3, label: "shots" },
  { key: "onTarget", target: 8.5, weight: 2, label: "on target" },
  { key: "savePct", target: 0.7, weight: 1, label: "save %" },
  { key: "corners", target: 10, weight: 1, label: "corners" },
  { key: "fouls", target: 22, weight: 1, label: "fouls" },
  { key: "offsides", target: 3.5, weight: 1, label: "offsides" },
  { key: "yellows", target: 3.5, weight: 1, label: "yellows" },
  { key: "reds", target: 0.15, weight: 0.3, label: "reds" },
  { key: "passes", target: 900, weight: 2, label: "passes" },
  { key: "passPct", target: 0.8, weight: 3, label: "pass %" },
  { key: "crosses", target: 35, weight: 0.5, label: "crosses" },
  { key: "xg", target: 2.7, weight: 1, label: "xG" },
  { key: "blocks", target: 7, weight: 0.5, label: "blocks" },
];

/** Parameter bounds (multiplicative search inside these). */
const BOUNDS: Record<keyof Tuning, [number, number]> = {
  shotBase: [-0.6, 0.6],
  shotXgMult: [1.5, 10],
  longRangeBase: [-0.3, 1.0],
  shotAngSd: [0.15, 0.5],
  crossBase: [-0.5, 1.0],
  passMarginWeight: [0.3, 2.0],
  carryBonus: [0, 1.5],
  receiverBias: [0, 1.5],
  controlBase: [0.3, 0.75],
  markGapNear: [0.6, 2.5],
  markGapMid: [1.0, 4.0],
  markGapFar: [1.5, 6.0],
  pressers: [1, 3],
  engageRadius: [1.5, 6],
  tackleRate: [0.5, 3.0],
  foulBase: [0.01, 0.2],
  yellowBase: [0.03, 0.3],
  gkReach: [1.2, 2.8],
  offsideWobble: [0.5, 6],
  reactionDelay: [0, 1.0],
  panicClear: [0, 0.8],
  shieldBase: [0.3, 0.92],
  attrCompression: [0.5, 0.9],
  homeBoost: [0, 0.1],
  homeEdge: [0, 1.5],
};

interface Metrics {
  [k: string]: number;
}

function runWorker(patch: Partial<Tuning>, seedStart: number, n: number): Promise<Metrics> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", workerPath, JSON.stringify(patch), String(seedStart), String(n)], {
      cwd: join(here, ".."),
      stdio: ["ignore", "pipe", "inherit"],
    });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.on("exit", (code) => {
      if (code !== 0) return reject(new Error(`worker exit ${code}`));
      try {
        resolve(JSON.parse(out.trim().split("\n").pop()!));
      } catch (e) {
        reject(e);
      }
    });
  });
}

async function evaluate(t: Tuning): Promise<{ loss: number; m: Metrics }> {
  const per = Math.ceil(matchesPerEval / workers);
  const jobs: Promise<Metrics>[] = [];
  let seed = 0;
  for (let w = 0; w < workers; w++) {
    const n = Math.min(per, matchesPerEval - seed);
    if (n <= 0) break;
    jobs.push(runWorker(t, seed, n));
    seed += n;
  }
  const parts = await Promise.all(jobs);
  const sum: Metrics = {};
  for (const p of parts) for (const [k, v] of Object.entries(p)) sum[k] = (sum[k] ?? 0) + v;
  const n = sum.n!;
  const m: Metrics = {
    goals: sum.goals! / n,
    shots: sum.shots! / n,
    onTarget: sum.onTarget! / n,
    savePct: sum.saves! / Math.max(1, sum.onTarget!),
    corners: sum.corners! / n,
    fouls: sum.fouls! / n,
    offsides: sum.offsides! / n,
    yellows: sum.yellows! / n,
    reds: sum.reds! / n,
    passes: sum.passes! / n,
    passPct: sum.completed! / Math.max(1, sum.passes!),
    crosses: sum.crosses! / n,
    xg: sum.xg! / n,
    blocks: sum.blocks! / n,
    homeShare: sum.homeShots! / Math.max(1, sum.homeShots! + sum.awayShots!),
  };
  let loss = 0;
  for (const t of TARGETS) {
    const a = Math.max(m[t.key]!, t.target * 0.02);
    const e = Math.max(-1.4, Math.min(1.4, Math.log(a / t.target))); // cap so one metric cannot dominate
    loss += t.weight * e * e;
  }
  return { loss, m };
}

function fmt(m: Metrics): string {
  return TARGETS.map((t) => {
    const v = m[t.key]!;
    const s = t.key.endsWith("Pct") ? `${(v * 100).toFixed(0)}%` : v.toFixed(v < 1 ? 2 : 1);
    const target = t.key.endsWith("Pct") ? `${(t.target * 100).toFixed(0)}%` : String(t.target);
    return `${t.label} ${s}/${target}`;
  }).join("  ");
}

function clampTo(k: keyof Tuning, v: number): number {
  const [lo, hi] = BOUNDS[k];
  return Math.max(lo, Math.min(hi, v));
}

async function main(): Promise<void> {
  let current: Tuning = { ...DEFAULT_TUNING };
  if (existsSync(bestPath)) {
    current = { ...current, ...(JSON.parse(readFileSync(bestPath, "utf8")) as Partial<Tuning>) };
    console.log("resuming from", bestPath);
  }
  console.log(`calibrate: ${rounds} rounds, ${matchesPerEval} matches/eval, ${workers} workers`);
  let best = await evaluate(current);
  console.log(`baseline loss ${best.loss.toFixed(3)}\n  ${fmt(best.m)}`);

  const keys = Object.keys(BOUNDS) as (keyof Tuning)[];
  let step = 0.35; // multiplicative step; shrinks as rounds progress
  for (let r = 1; r <= rounds; r++) {
    const t0 = Date.now();
    let improved = 0;
    for (const k of keys) {
      const base = current[k];
      const span = BOUNDS[k][1] - BOUNDS[k][0];
      // Additive step for parameters that cross zero, multiplicative otherwise.
      const candidates = base > 0.05 && BOUNDS[k][0] >= 0
        ? [base * (1 + step), base * (1 - step)]
        : [base + span * step * 0.4, base - span * step * 0.4];
      for (const c of candidates) {
        const v = clampTo(k, c);
        if (Math.abs(v - current[k]) < 1e-6) continue;
        const trial = { ...current, [k]: v };
        const res = await evaluate(trial);
        if (res.loss < best.loss - 1e-4) {
          console.log(`  ↳ ${k}: ${current[k].toFixed(3)} → ${v.toFixed(3)}  loss ${best.loss.toFixed(3)} → ${res.loss.toFixed(3)}`);
          current = trial;
          best = res;
          improved++;
          writeFileSync(bestPath, JSON.stringify(current, null, 2));
          break; // move on to the next parameter after an improvement
        }
      }
    }
    console.log(`round ${r}/${rounds} done in ${((Date.now() - t0) / 1000).toFixed(0)}s, ${improved} improvements, loss ${best.loss.toFixed(3)}, step ${step.toFixed(2)}`);
    console.log(`  ${fmt(best.m)}  home-shot-share ${(best.m.homeShare! * 100).toFixed(0)}%`);
    if (improved === 0) step *= 0.6;
    else if (improved <= 2) step *= 0.8;
  }
  console.log("\nbest tuning:\n" + JSON.stringify(current, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
