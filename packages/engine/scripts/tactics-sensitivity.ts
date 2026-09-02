/**
 * Phase C: does each tactic slider move the match in the right direction, by a sensible amount?
 * Team 0 plays with one axis at LOW (0.1) or HIGH (0.9), everything else default; team 1 stays
 * neutral. Equal-quality squads, common seeds, cells evaluated in parallel processes.
 *   tsx scripts/tactics-sensitivity.ts [matchesPerCell=10]
 */
import { spawn } from "node:child_process";
import { cpus } from "node:os";
import { fileURLToPath } from "node:url";
import { Match, generateTeam, goalCenter, dist, type Tactics } from "../src/index";

type Axis = keyof Omit<Tactics, "formation">;
const axes: Axis[] = ["mentality", "defensiveLine", "pressing", "directness", "width"];

interface Row { shotsF: number; shotsA: number; goalsF: number; goalsA: number; poss: number; passPct: number; passLen: number; foulsF: number; offsF: number; offsA: number; blockX: number; crossesF: number; shotDistA: number; km: number }

function cell(axis: Axis | null, value: number, n: number): Row {
  const acc: Row = { shotsF: 0, shotsA: 0, goalsF: 0, goalsA: 0, poss: 0, passPct: 0, passLen: 0, foulsF: 0, offsF: 0, offsA: 0, blockX: 0, crossesF: 0, shotDistA: 0, km: 0 };
  for (let i = 0; i < n; i++) {
    const home = generateTeam({ id: 0, name: "H", shortName: "H", color: "#f00", formation: "4-3-3", quality: 12, seed: 700 + i });
    const away = generateTeam({ id: 1, name: "A", shortName: "A", color: "#00f", formation: "4-3-3", quality: 12, seed: 800 + i });
    const m = new Match(home, away, { seed: 900 + i, aiManaged: [] });
    if (axis) m.setTactics(0, { [axis]: value } as Partial<Tactics>);
    let passLenSum = 0, passN = 0, bx = 0, bn = 0, sdA = 0, sdN = 0;
    m.debug.onPass = (p) => { if (m.teamOf.get(p.from) === 0) { passLenSum += p.d; passN++; } };
    while (m.state.phase !== "FULL_TIME") {
      const before = m.state.events.length;
      m.step();
      if (m.state.phase === "PLAY" && m.state.tick % 20 === 0) for (const p of m.activePlayers(0)) if (!m.isKeeper(p.id)) { bx += p.pos.x * m.dirOf(0); bn++; }
      for (const e of m.state.events.slice(before)) if (e.type === "SHOT" && e.team === 1 && e.pos) { sdA += dist(e.pos, goalCenter(m.dirOf(1))); sdN++; }
    }
    const [a, b] = m.state.stats;
    acc.shotsF += a.shots; acc.shotsA += b.shots; acc.goalsF += a.goals; acc.goalsA += b.goals;
    acc.poss += a.possessionTicks / (a.possessionTicks + b.possessionTicks);
    acc.passPct += a.passesCompleted / Math.max(1, a.passes);
    acc.passLen += passLenSum / Math.max(1, passN);
    acc.foulsF += a.fouls; acc.offsF += a.offsides; acc.offsA += b.offsides; acc.blockX += bx / Math.max(1, bn); acc.crossesF += a.crosses;
    acc.shotDistA += sdA / Math.max(1, sdN);
    acc.km += m.activePlayers(0).filter((p) => !m.isKeeper(p.id)).reduce((s, p) => s + p.distance, 0) / 10000;
  }
  for (const k of Object.keys(acc) as (keyof Row)[]) acc[k] /= n;
  return acc;
}

const fmt = (r: Row) => `shots ${r.shotsF.toFixed(1)}/${r.shotsA.toFixed(1)}  goals ${r.goalsF.toFixed(2)}/${r.goalsA.toFixed(2)}  poss ${(100 * r.poss).toFixed(0)}%  pass% ${(100 * r.passPct).toFixed(0)}  passLen ${r.passLen.toFixed(1)}  crosses ${r.crossesF.toFixed(1)}  fouls ${r.foulsF.toFixed(1)}  offs ${r.offsF.toFixed(1)}/${r.offsA.toFixed(1)}  blockX ${r.blockX.toFixed(1)}  shotDistA ${r.shotDistA.toFixed(1)}  km ${r.km.toFixed(1)}`;

if (process.argv.includes("--cell")) {
  const i = process.argv.indexOf("--cell");
  const axis = process.argv[i + 1] === "null" ? null : (process.argv[i + 1] as Axis);
  process.stdout.write(JSON.stringify(cell(axis, Number(process.argv[i + 2]), Number(process.argv[i + 3]))));
} else {
  const n = Number(process.argv[2] ?? 10);
  const self = fileURLToPath(import.meta.url);
  const jobs: { label: string; axis: string; value: number }[] = [{ label: "neutral", axis: "null", value: 0.5 }];
  for (const a of axes) jobs.push({ label: `${a} LOW`, axis: a, value: 0.1 }, { label: `${a} HIGH`, axis: a, value: 0.9 });
  const run = (j: typeof jobs[number]) => new Promise<Row>((res, rej) => {
    const c = spawn(process.execPath, ["--import", "tsx", self, "--cell", j.axis, String(j.value), String(n)], { stdio: ["ignore", "pipe", "inherit"] });
    let out = ""; c.stdout.on("data", (d) => (out += d)); c.on("exit", (code) => (code === 0 ? res(JSON.parse(out.trim())) : rej(new Error(`exit ${code}`))));
  });
  const results: Row[] = new Array(jobs.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(cpus().length, jobs.length) }, async () => { while (next < jobs.length) { const k = next++; results[k] = await run(jobs[k]!); } }));
  jobs.forEach((j, k) => console.log(`${j.label.padEnd(19)}${fmt(results[k]!)}`));
}
