/**
 * League balance gate.
 *
 * Plays whole seasons of real fixtures through the game layer and checks the aggregate numbers
 * against the bands the engine is calibrated to. This is the regression test for changes that
 * shift match outcomes — the fatigue and morale work, tuning knobs, AI or physics changes — the
 * kind of drift no single-match unit test notices.
 *
 * It is a script rather than a vitest case on purpose: a season is ~130 matches and takes minutes,
 * far past what belongs in the suite developers run on every save. Run it before landing anything
 * that touches the simulation:
 *
 *   pnpm -C packages/game balance                 # 2 seasons, the default gate
 *   SEEDS=2026,777,99,4242 pnpm -C packages/game balance
 *   BEFORE=1 pnpm -C packages/game balance        # fatigue knobs zeroed, to compare against
 *
 * Exits non-zero when a band is missed, so CI can use it directly.
 */
import { newGame, prepareRound, currentFixtures, createMatch, recordResult, advanceRound, seasonOver } from "../src/index";
import { simulateCupDay, advanceCupDay } from "../src/cup";
import { setTuning } from "@3sec/engine";

/**
 * The bands. Real top-flight football sits near the middle of each; the widths are set from the
 * seed-to-seed spread measured over eight seasons, so a passing run means "still football", not
 * "identical to the day this was written". Draw share in particular swings 20–32% between worlds.
 */
const BANDS: Record<string, { lo: number; hi: number; real: string }> = {
  "goals/match": { lo: 2.5, hi: 3.4, real: "~2.7" },
  "home win %": { lo: 36, hi: 50, real: "~43" },
  "draw %": { lo: 18, hi: 31, real: "~24" },
  "away win %": { lo: 27, hi: 40, real: "~33" },
  "yellows/match": { lo: 2.4, hi: 4.4, real: "~3.2" },
  "reds/match": { lo: 0.0, hi: 0.35, real: "~0.1" },
  "pass %": { lo: 70, hi: 84, real: "~80" },
  "shots/match": { lo: 18, hi: 32, real: "~25" },
  "on target %": { lo: 22, hi: 42, real: "~33" },
};

interface Totals { matches: number; goals: number; home: number; draw: number; away: number; yellows: number; reds: number; passes: number; completed: number; shots: number; onTarget: number }

function playSeason(seed: number): Totals {
  const t: Totals = { matches: 0, goals: 0, home: 0, draw: 0, away: 0, yellows: 0, reds: 0, passes: 0, completed: 0, shots: 0, onTarget: 0 };
  const s = newGame(seed, 0, "밸런스");
  while (!seasonOver(s)) {
    if (s.pendingCupDay) { simulateCupDay(s); advanceCupDay(s); continue; }
    prepareRound(s);
    for (const f of currentFixtures(s)) {
      if (f.score) continue;
      const m = createMatch(s, f, { autoUser: true });
      m.runToEnd();
      const [a, b] = m.state.stats;
      const [gh, ga] = m.state.score;
      t.matches++;
      t.goals += gh + ga;
      if (gh > ga) t.home++; else if (gh < ga) t.away++; else t.draw++;
      t.yellows += a.yellows + b.yellows;
      t.reds += a.reds + b.reds;
      t.passes += a.passes + b.passes;
      t.completed += a.passesCompleted + b.passesCompleted;
      t.shots += a.shots + b.shots;
      t.onTarget += a.shotsOnTarget + b.shotsOnTarget;
      recordResult(s, f, m);
    }
    advanceRound(s);
  }
  return t;
}

function measure(t: Totals): Record<string, number> {
  const per = (n: number) => n / t.matches;
  return {
    "goals/match": per(t.goals),
    "home win %": (100 * t.home) / t.matches,
    "draw %": (100 * t.draw) / t.matches,
    "away win %": (100 * t.away) / t.matches,
    "yellows/match": per(t.yellows),
    "reds/match": per(t.reds),
    "pass %": (100 * t.completed) / t.passes,
    "shots/match": per(t.shots),
    "on target %": (100 * t.onTarget) / t.shots,
  };
}

if (process.env.BEFORE === "1") setTuning({ fatiguePassSd: 0, fatigueMishit: 0, fatigueShotSd: 0, fatigueDecision: 0, fatigueControl: 0 });

const seeds = (process.env.SEEDS ?? "2026,777").split(",").map((x) => Number(x.trim()));
const total: Totals = { matches: 0, goals: 0, home: 0, draw: 0, away: 0, yellows: 0, reds: 0, passes: 0, completed: 0, shots: 0, onTarget: 0 };
for (const seed of seeds) {
  const t = playSeason(seed);
  const m = measure(t);
  console.log(`seed ${seed} (${t.matches} matches): ` + Object.entries(m).map(([k, v]) => `${k} ${v.toFixed(2)}`).join(" · "));
  for (const k of Object.keys(total) as (keyof Totals)[]) total[k] += t[k];
}

console.log(`\n${total.matches} matches over ${seeds.length} season(s)\n`);
const agg = measure(total);
let failed = 0;
for (const [k, band] of Object.entries(BANDS)) {
  const v = agg[k]!;
  const ok = v >= band.lo && v <= band.hi;
  if (!ok) failed++;
  console.log(`${ok ? "  ok " : "FAIL "}${k.padEnd(14)} ${v.toFixed(2).padStart(6)}   band ${band.lo}–${band.hi} (real ${band.real})`);
}

if (failed > 0) {
  console.error(`\n${failed} band(s) missed — the simulation has drifted out of the calibrated range.`);
  process.exit(1);
}
console.log("\nall bands ok");
