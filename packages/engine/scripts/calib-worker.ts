/**
 * Worker: run N matches with a tuning patch and print aggregate metrics as JSON.
 *   tsx calib-worker.ts '<tuning json>' <seedStart> <n>
 */
import { Match, generateTeam, setTuning, type Tuning } from "../src/index";

const patch = JSON.parse(process.argv[2] ?? "{}") as Partial<Tuning>;
const seedStart = Number(process.argv[3] ?? 0);
const n = Number(process.argv[4] ?? 2);
setTuning(patch);

const acc = {
  n: 0,
  goals: 0,
  shots: 0,
  onTarget: 0,
  saves: 0,
  corners: 0,
  fouls: 0,
  offsides: 0,
  yellows: 0,
  reds: 0,
  passes: 0,
  completed: 0,
  crosses: 0,
  xg: 0,
  blocks: 0,
  homeShots: 0,
  awayShots: 0,
};

for (let i = 0; i < n; i++) {
  const seed = seedStart + i;
  // Alternate formations between home/away so formation effects don't masquerade as home bias.
  const fA = i % 2 === 0 ? "4-3-3" : "4-4-2";
  const fB = i % 2 === 0 ? "4-4-2" : "4-3-3";
  const home = generateTeam({ id: 0, name: "H", shortName: "H", color: "#f00", formation: fA, quality: 12, seed: 1000 + seed });
  const away = generateTeam({ id: 1, name: "A", shortName: "A", color: "#00f", formation: fB, quality: 12, seed: 2000 + seed });
  const m = new Match(home, away, { seed: 3000 + seed, aiManaged: [0, 1] });
  m.runToEnd();
  const [a, b] = m.state.stats;
  acc.n++;
  acc.goals += a.goals + b.goals;
  acc.shots += a.shots + b.shots;
  acc.onTarget += a.shotsOnTarget + b.shotsOnTarget;
  acc.saves += a.saves + b.saves;
  acc.corners += a.corners + b.corners;
  acc.fouls += a.fouls + b.fouls;
  acc.offsides += a.offsides + b.offsides;
  acc.yellows += a.yellows + b.yellows;
  acc.reds += a.reds + b.reds;
  acc.passes += a.passes + b.passes;
  acc.completed += a.passesCompleted + b.passesCompleted;
  acc.crosses += a.crosses + b.crosses;
  acc.xg += a.xg + b.xg;
  acc.blocks += m.state.events.filter((e) => e.type === "BLOCK").length;
  acc.homeShots += a.shots;
  acc.awayShots += b.shots;
}

process.stdout.write(JSON.stringify(acc));
