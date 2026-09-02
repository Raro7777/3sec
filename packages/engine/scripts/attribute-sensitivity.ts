/**
 * Phase D: does each player attribute have a measurable, sensible effect?
 * Team 0's outfield players get ONE attribute shifted by ±5 (clamped 1..20); team 1 is untouched.
 * Equal-quality squads, common seeds, cells evaluated in parallel processes.
 *   tsx scripts/attribute-sensitivity.ts [matchesPerCell=10]
 */
import { spawn } from "node:child_process";
import { cpus } from "node:os";
import { fileURLToPath } from "node:url";
import { Match, generateTeam, type Attributes } from "../src/index";

type Attr = keyof Attributes;
const attrs: Attr[] = ["pace", "acceleration", "passing", "vision", "firstTouch", "dribbling", "finishing", "composure", "tackling", "marking", "positioning", "decisions", "anticipation", "strength", "stamina"];

interface Row { shotsF: number; shotsA: number; goalsF: number; goalsA: number; poss: number; passPct: number; tacklesF: number; interceptsF: number; foulsF: number; convF: number; xgF: number; km: number; lateFatigue: number }

function cell(attr: Attr | null, delta: number, n: number): Row {
  const acc: Row = { shotsF: 0, shotsA: 0, goalsF: 0, goalsA: 0, poss: 0, passPct: 0, tacklesF: 0, interceptsF: 0, foulsF: 0, convF: 0, xgF: 0, km: 0, lateFatigue: 0 };
  for (let i = 0; i < n; i++) {
    const home = generateTeam({ id: 0, name: "H", shortName: "H", color: "#f00", formation: "4-3-3", quality: 12, seed: 700 + i });
    const away = generateTeam({ id: 1, name: "A", shortName: "A", color: "#00f", formation: "4-3-3", quality: 12, seed: 800 + i });
    if (attr) for (const p of [...home.players, ...home.bench]) if (p.role !== "GK") p.attrs[attr] = Math.max(1, Math.min(20, p.attrs[attr] + delta));
    const m = new Match(home, away, { seed: 900 + i, aiManaged: [] });
    m.runToEnd();
    const [a, b] = m.state.stats;
    acc.shotsF += a.shots; acc.shotsA += b.shots; acc.goalsF += a.goals; acc.goalsA += b.goals;
    acc.poss += a.possessionTicks / (a.possessionTicks + b.possessionTicks);
    acc.passPct += a.passesCompleted / Math.max(1, a.passes);
    acc.tacklesF += a.tackles; acc.foulsF += a.fouls; acc.xgF += a.xg;
    acc.interceptsF += m.state.events.filter((e) => e.type === "INTERCEPTION" && e.team === 0).length;
    acc.convF += a.shots ? a.goals / a.shots : 0;
    const out = m.state.players.filter((p) => p.team === 0 && p.onPitch && !m.isKeeper(p.id));
    acc.km += out.reduce((s, p) => s + p.distance, 0) / out.length / 1000;
    acc.lateFatigue += out.reduce((s, p) => s + p.fatigue, 0) / out.length;
  }
  for (const k of Object.keys(acc) as (keyof Row)[]) acc[k] /= n;
  return acc;
}

const fmt = (r: Row) => `shots ${r.shotsF.toFixed(1)}/${r.shotsA.toFixed(1)}  goals ${r.goalsF.toFixed(2)}/${r.goalsA.toFixed(2)}  conv ${(100 * r.convF).toFixed(0)}%  xG ${r.xgF.toFixed(2)}  poss ${(100 * r.poss).toFixed(0)}%  pass% ${(100 * r.passPct).toFixed(0)}  tackles ${r.tacklesF.toFixed(1)}  intercepts ${r.interceptsF.toFixed(1)}  fouls ${r.foulsF.toFixed(1)}  km ${r.km.toFixed(1)}  fatigue ${(100 * r.lateFatigue).toFixed(0)}%`;

if (process.argv.includes("--cell")) {
  const i = process.argv.indexOf("--cell");
  const attr = process.argv[i + 1] === "null" ? null : (process.argv[i + 1] as Attr);
  process.stdout.write(JSON.stringify(cell(attr, Number(process.argv[i + 2]), Number(process.argv[i + 3]))));
} else {
  const n = Number(process.argv[2] ?? 10);
  const self = fileURLToPath(import.meta.url);
  const jobs: { label: string; attr: string; delta: number }[] = [{ label: "neutral", attr: "null", delta: 0 }];
  for (const a of attrs) jobs.push({ label: `${a} -5`, attr: a, delta: -5 }, { label: `${a} +5`, attr: a, delta: 5 });
  const run = (j: typeof jobs[number]) => new Promise<Row>((res, rej) => {
    const c = spawn(process.execPath, ["--import", "tsx", self, "--cell", j.attr, String(j.delta), String(n)], { stdio: ["ignore", "pipe", "inherit"] });
    let out = ""; c.stdout.on("data", (d) => (out += d)); c.on("exit", (code) => (code === 0 ? res(JSON.parse(out.trim())) : rej(new Error(`exit ${code}`))));
  });
  const results: Row[] = new Array(jobs.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(cpus().length, jobs.length) }, async () => { while (next < jobs.length) { const k = next++; results[k] = await run(jobs[k]!); } }));
  jobs.forEach((j, k) => console.log(`${j.label.padEnd(17)}${fmt(results[k]!)}`));
}
