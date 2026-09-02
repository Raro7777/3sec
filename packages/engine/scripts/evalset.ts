/**
 * Evaluate several tuning patches side by side (each on the same seeds), in parallel.
 *   tsx scripts/evalset.ts <configs.json> [matchesPerConfig=12]
 * configs.json: { "name": { ...partial tuning }, ... }  (patches are applied on top of tuning.best.json if present)
 */
import { spawn } from "node:child_process";
import { cpus } from "node:os";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { DEFAULT_TUNING, type Tuning } from "../src/index";

const here = dirname(fileURLToPath(import.meta.url));
const workerPath = join(here, "calib-worker.ts");
const bestPath = join(here, "tuning.best.json");
const configs = JSON.parse(readFileSync(process.argv[2]!, "utf8")) as Record<string, Partial<Tuning>>;
const n = Number(process.argv[3] ?? 12);
const workers = Math.max(1, cpus().length);
const base: Tuning = { ...DEFAULT_TUNING, ...(existsSync(bestPath) ? JSON.parse(readFileSync(bestPath, "utf8")) : {}) };

const TARGETS: [string, number, number][] = [
  ["goals", 2.7, 3], ["shots", 25, 3], ["onTarget", 8.5, 2], ["savePct", 0.7, 1], ["corners", 10, 1], ["fouls", 22, 1],
  ["offsides", 3.5, 1], ["yellows", 3.5, 1], ["reds", 0.15, 0.3], ["passes", 900, 2], ["passPct", 0.8, 3], ["crosses", 35, 0.5], ["xg", 2.7, 1], ["blocks", 7, 0.5],
];

function run(patch: Tuning, seedStart: number, k: number): Promise<Record<string, number>> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", workerPath, JSON.stringify(patch), String(seedStart), String(k)], { cwd: join(here, ".."), stdio: ["ignore", "pipe", "inherit"] });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.on("exit", (code) => (code === 0 ? resolve(JSON.parse(out.trim().split("\n").pop()!)) : reject(new Error(`exit ${code}`))));
  });
}

async function evaluate(t: Tuning): Promise<Record<string, number>> {
  const per = Math.ceil(n / workers);
  const jobs: Promise<Record<string, number>>[] = [];
  for (let s = 0; s < n; s += per) jobs.push(run(t, s, Math.min(per, n - s)));
  const parts = await Promise.all(jobs);
  const sum: Record<string, number> = {};
  for (const p of parts) for (const [k, v] of Object.entries(p)) sum[k] = (sum[k] ?? 0) + v;
  const N = sum.n!;
  const m: Record<string, number> = {
    goals: sum.goals! / N, shots: sum.shots! / N, onTarget: sum.onTarget! / N, savePct: sum.saves! / Math.max(1, sum.onTarget!),
    corners: sum.corners! / N, fouls: sum.fouls! / N, offsides: sum.offsides! / N, yellows: sum.yellows! / N, reds: sum.reds! / N,
    passes: sum.passes! / N, passPct: sum.completed! / Math.max(1, sum.passes!), crosses: sum.crosses! / N, xg: sum.xg! / N, blocks: sum.blocks! / N,
  };
  let loss = 0;
  for (const [k, target, w] of TARGETS) { const e = Math.max(-1.4, Math.min(1.4, Math.log(Math.max(m[k]!, target * 0.02) / target))); loss += w * e * e; }
  m.loss = loss;
  return m;
}

const cols = ["loss", "goals", "shots", "onTarget", "savePct", "xg", "passes", "passPct", "crosses", "corners", "fouls", "yellows", "reds", "offsides", "blocks"];
console.log("config".padEnd(10) + cols.map((c) => c.padStart(9)).join(""));
for (const [name, patch] of Object.entries(configs)) {
  const m = await evaluate({ ...base, ...patch });
  console.log(name.padEnd(10) + cols.map((c) => (c.endsWith("Pct") ? (100 * m[c]!).toFixed(0) + "%" : m[c]!.toFixed(c === "loss" || m[c]! < 3 ? 2 : 1)).padStart(9)).join(""));
}
