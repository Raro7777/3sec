/**
 * Headless simulation: run N matches and print aggregate statistics.
 *   pnpm sim            -> 20 matches
 *   pnpm sim 100        -> 100 matches
 *   pnpm sim 1 --log    -> 1 match with the event log
 */
import { Match, generateTeam } from "../src/index";

const args = process.argv.slice(2);
const n = Number(args.find((a) => /^\d+$/.test(a)) ?? 20);
const log = args.includes("--log");

const totals = {
  goals: 0,
  shots: 0,
  onTarget: 0,
  corners: 0,
  fouls: 0,
  offsides: 0,
  passes: 0,
  completed: 0,
  yellows: 0,
  reds: 0,
  saves: 0,
  crosses: 0,
  blocks: 0,
  xg: 0,
  homeWins: 0,
  draws: 0,
  awayWins: 0,
};
const dist = new Map<string, number>();

const t0 = performance.now();
for (let i = 0; i < n; i++) {
  const home = generateTeam({ id: 0, name: "Seoul FC", shortName: "SEO", color: "#e63946", formation: "4-3-3", quality: 13, seed: 100 + i });
  const away = generateTeam({ id: 1, name: "Busan United", shortName: "BUS", color: "#457b9d", formation: "4-4-2", quality: 12, seed: 200 + i });
  const m = new Match(home, away, { seed: 1000 + i });
  m.runToEnd();
  const s = m.state;
  const [a, b] = s.stats;
  totals.goals += a.goals + b.goals;
  totals.shots += a.shots + b.shots;
  totals.onTarget += a.shotsOnTarget + b.shotsOnTarget;
  totals.corners += a.corners + b.corners;
  totals.fouls += a.fouls + b.fouls;
  totals.offsides += a.offsides + b.offsides;
  totals.passes += a.passes + b.passes;
  totals.completed += a.passesCompleted + b.passesCompleted;
  totals.yellows += a.yellows + b.yellows;
  totals.reds += a.reds + b.reds;
  totals.saves += a.saves + b.saves;
  totals.crosses += a.crosses + b.crosses;
  totals.blocks += s.events.filter((e) => e.type === "BLOCK").length;
  totals.xg += a.xg + b.xg;
  if (s.score[0] > s.score[1]) totals.homeWins++;
  else if (s.score[0] < s.score[1]) totals.awayWins++;
  else totals.draws++;
  const key = `${s.score[0]}-${s.score[1]}`;
  dist.set(key, (dist.get(key) ?? 0) + 1);
  const poss = a.possessionTicks / Math.max(1, a.possessionTicks + b.possessionTicks);
  console.log(
    `#${i + 1} ${m.scoreline()}  shots ${a.shots}/${b.shots} (on ${a.shotsOnTarget}/${b.shotsOnTarget})  xG ${a.xg.toFixed(2)}/${b.xg.toFixed(2)}  poss ${(poss * 100).toFixed(0)}%  corners ${a.corners}/${b.corners}  fouls ${a.fouls}/${b.fouls}  offs ${a.offsides}/${b.offsides}  pass ${a.passesCompleted}/${a.passes} ${b.passesCompleted}/${b.passes}`,
  );
  if (log) {
    for (const e of s.events) {
      if (["SHOT_ON_TARGET", "INTERCEPTION", "TACKLE"].includes(e.type)) continue;
      console.log(`  ${String(e.minute).padStart(2, "0")}' ${e.type.padEnd(12)} ${e.text}`);
    }
  }
}
const ms = performance.now() - t0;

console.log("\n=== Averages per match ===");
console.log(`goals      ${(totals.goals / n).toFixed(2)}   (real-world ~2.7)`);
console.log(`xG         ${(totals.xg / n).toFixed(2)}`);
console.log(`shots      ${(totals.shots / n).toFixed(1)}   (real-world ~25)`);
console.log(`on target  ${(totals.onTarget / n).toFixed(1)}   (real-world ~8-9)`);
console.log(`saves      ${(totals.saves / n).toFixed(1)}   (${((100 * totals.saves) / Math.max(1, totals.onTarget)).toFixed(0)}% of on-target; real-world ~70%)`);
console.log(`blocks     ${(totals.blocks / n).toFixed(1)}   (real-world ~6-7)`);
console.log(`crosses    ${(totals.crosses / n).toFixed(1)}   (real-world ~35)`);
console.log(`corners    ${(totals.corners / n).toFixed(1)}   (real-world ~10)`);
console.log(`fouls      ${(totals.fouls / n).toFixed(1)}   (real-world ~22)`);
console.log(`offsides   ${(totals.offsides / n).toFixed(1)}   (real-world ~3-4)`);
console.log(`yellows    ${(totals.yellows / n).toFixed(2)}   (real-world ~3.5)`);
console.log(`reds       ${(totals.reds / n).toFixed(2)}   (real-world ~0.15)`);
console.log(`passes     ${(totals.passes / n).toFixed(0)}  completed ${((100 * totals.completed) / Math.max(1, totals.passes)).toFixed(0)}%   (real-world ~900 @ 80%)`);
console.log(`H/D/A      ${totals.homeWins}/${totals.draws}/${totals.awayWins}`);
console.log(`scorelines ${[...dist.entries()].sort((x, y) => y[1] - x[1]).slice(0, 8).map(([k, c]) => `${k}×${c}`).join("  ")}`);
console.log(`\n${n} matches in ${(ms / 1000).toFixed(1)}s (${(ms / n).toFixed(0)} ms/match)`);
