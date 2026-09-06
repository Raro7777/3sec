/** How often is a goal an own goal? Full-fidelity league round, many seeds. */
import { newGame, prepareRound, currentFixtures, createMatch } from "../src/index";
let goals = 0, og = 0, matches = 0;
const scorers = new Map<string, number>();
for (const seed of [1, 2, 3, 4, 5, 6]) {
  const s = newGame(seed, 0, "t"); prepareRound(s);
  for (const f of currentFixtures(s)) {
    const m = createMatch(s, f, { autoUser: true }); m.runToEnd(); matches++;
    for (const e of m.state.events) {
      if (e.type === "GOAL") goals++;
      if (e.type === "OWN_GOAL") { og++; goals++; const d = e.playerId ? m.def(e.playerId) : null; scorers.set(d?.role ?? "?", (scorers.get(d?.role ?? "?") ?? 0) + 1); }
    }
  }
}
console.log(`${matches}경기 · 골 ${goals} (경기당 ${(goals / matches).toFixed(2)}) · 자책골 ${og} (${((og / goals) * 100).toFixed(1)}%, 경기당 ${(og / matches).toFixed(2)})`);
console.log("자책골 포지션:", [...scorers.entries()].map(([r, n]) => `${r} ${n}`).join(", "));
