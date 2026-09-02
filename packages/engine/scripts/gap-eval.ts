/**
 * Quality-gap balance: how do results scale with the squad-quality difference?
 *   tsx scripts/gap-eval.ts [matchesPerCell=24] [configs.json]
 * Cells: equal (12 v 12), small (13 v 11.5), medium (14 v 11), large (15 v 10). Both sides AI-managed,
 * home/away alternate so home advantage cancels out.
 */
import { spawn } from "node:child_process";
import { cpus } from "node:os";
import { fileURLToPath } from "node:url";
import { readFileSync, existsSync } from "node:fs";
import { Match, generateTeam, setTuning, type Tuning } from "../src/index";

const GAPS: [string, number, number][] = [["equal 12v12", 12, 12], ["small 13v11.5", 13, 11.5], ["medium 14v11", 14, 11], ["large 15v10", 15, 10]];

interface Row { w: number; d: number; l: number; gf: number; ga: number; sf: number; sa: number; poss: number; xgf: number; xga: number }

function cell(qa: number, qb: number, n: number): Row {
  const r: Row = { w: 0, d: 0, l: 0, gf: 0, ga: 0, sf: 0, sa: 0, poss: 0, xgf: 0, xga: 0 };
  for (let i = 0; i < n; i++) {
    const strongHome = i % 2 === 0;
    const strong = generateTeam({ id: strongHome ? 0 : 1, name: "S", shortName: "S", color: "#f00", formation: "4-3-3", quality: qa, seed: 500 + i });
    const weak = generateTeam({ id: strongHome ? 1 : 0, name: "W", shortName: "W", color: "#00f", formation: "4-3-3", quality: qb, seed: 600 + i });
    const m = strongHome ? new Match(strong, weak, { seed: 700 + i, aiManaged: [0, 1] }) : new Match(weak, strong, { seed: 700 + i, aiManaged: [0, 1] });
    m.runToEnd();
    const s = m.state.stats[strongHome ? 0 : 1], o = m.state.stats[strongHome ? 1 : 0];
    if (s.goals > o.goals) r.w++; else if (s.goals < o.goals) r.l++; else r.d++;
    r.gf += s.goals; r.ga += o.goals; r.sf += s.shots; r.sa += o.shots; r.xgf += s.xg; r.xga += o.xg;
    r.poss += s.possessionTicks / (s.possessionTicks + o.possessionTicks);
  }
  return r;
}

const fmt = (r: Row, n: number) => `W/D/L ${(100 * r.w / n).toFixed(0)}/${(100 * r.d / n).toFixed(0)}/${(100 * r.l / n).toFixed(0)}%  goals ${(r.gf / n).toFixed(2)}:${(r.ga / n).toFixed(2)}  shots ${(r.sf / n).toFixed(1)}:${(r.sa / n).toFixed(1)}  xG ${(r.xgf / n).toFixed(2)}:${(r.xga / n).toFixed(2)}  poss ${(100 * r.poss / n).toFixed(0)}%`;

if (process.argv.includes("--cell")) {
  const i = process.argv.indexOf("--cell");
  const patch = process.argv[i + 4];
  if (patch) setTuning(JSON.parse(patch) as Partial<Tuning>);
  process.stdout.write(JSON.stringify(cell(Number(process.argv[i + 1]), Number(process.argv[i + 2]), Number(process.argv[i + 3]))));
} else {
  const n = Number(process.argv[2] ?? 24);
  const configs: Record<string, Partial<Tuning>> = process.argv[3] && existsSync(process.argv[3]) ? JSON.parse(readFileSync(process.argv[3], "utf8")) : { base: {} };
  const self = fileURLToPath(import.meta.url);
  const jobs = Object.entries(configs).flatMap(([name, patch]) => GAPS.map((g) => ({ name, g, patch })));
  const run = (j: typeof jobs[number]) => new Promise<Row>((res, rej) => {
    const c = spawn(process.execPath, ["--import", "tsx", self, "--cell", String(j.g[1]), String(j.g[2]), String(n), JSON.stringify(j.patch)], { stdio: ["ignore", "pipe", "inherit"] });
    let out = ""; c.stdout.on("data", (d) => (out += d)); c.on("exit", (code) => (code === 0 ? res(JSON.parse(out.trim())) : rej(new Error(`exit ${code}`))));
  });
  const results: Row[] = new Array(jobs.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(cpus().length, jobs.length) }, async () => { while (next < jobs.length) { const k = next++; results[k] = await run(jobs[k]!); } }));
  jobs.forEach((j, k) => console.log(`${j.name.padEnd(10)} ${j.g[0].padEnd(14)} ${fmt(results[k]!, n)}`));
  console.log("reference (real leagues): equal ≈ 37/26/37, goals 1.35:1.35 · large gap ≈ 70/18/12, goals 2.3:0.8, shots 17:9, poss 62%");
}
