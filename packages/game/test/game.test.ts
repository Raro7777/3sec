import { describe, expect, it } from "vitest";
import { FORMATIONS } from "@3sec/engine";
import {
  advanceRound, autoSelect, buildFixtures, createMatch, currentFixtures, deserialize, newGame, playerOf, recordResult,
  roundsPerSeason, selectionProblem, serialize, simulateRound, startNextSeason, swap, table, repairSelection,
} from "../src/index";

const SHORT = { halfLength: 4 * 60 };

describe("fixtures", () => {
  it("double round robin: every pair meets twice, once at each ground, one game per club per round", () => {
    const n = 12;
    const fx = buildFixtures(n);
    expect(fx.length).toBe(n * (n - 1));
    const seen = new Map<string, number>();
    for (const f of fx) seen.set(`${f.home}-${f.away}`, (seen.get(`${f.home}-${f.away}`) ?? 0) + 1);
    for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) if (a !== b) expect(seen.get(`${a}-${b}`)).toBe(1);
    for (let r = 0; r < roundsPerSeason(n); r++) {
      const clubs = fx.filter((f) => f.round === r).flatMap((f) => [f.home, f.away]);
      expect(new Set(clubs).size).toBe(n);
    }
    const homeGames = Array.from({ length: n }, (_, c) => fx.filter((f) => f.home === c).length);
    expect(homeGames.every((h) => h === n - 1)).toBe(true);
  });
});

describe("world and selection", () => {
  it("builds 12 clubs of 20 with a legal XI and bench each", () => {
    const s = newGame(1);
    expect(s.clubs.length).toBe(12);
    for (const c of s.clubs) {
      expect(c.squad.length).toBe(20);
      expect(selectionProblem(c)).toBeNull();
      expect(c.selection.starters.length).toBe(FORMATIONS[c.selection.formation].length);
      expect(playerOf(c, c.selection.starters[0]!).role).toBe("GK");
      expect(c.selection.bench.length).toBe(7);
    }
  });

  it("is deterministic for a seed", () => {
    const a = newGame(5), b = newGame(5);
    expect(serialize(a)).toBe(serialize(b));
  });

  it("swap moves players between starters, bench and reserves; repair replaces the unavailable", () => {
    const s = newGame(2);
    const c = s.clubs[0]!;
    const st = c.selection.starters[9]!;
    const reserve = c.squad.find((p) => !c.selection.starters.includes(p.id) && !c.selection.bench.includes(p.id))!;
    c.selection = swap(c, st, reserve.id);
    expect(c.selection.starters[9]).toBe(reserve.id);
    expect(c.selection.starters.includes(st)).toBe(false);
    playerOf(c, reserve.id).injuryDays = 10;
    expect(selectionProblem(c)).toMatch(/부상/);
    c.selection = repairSelection(c);
    expect(selectionProblem(c)).toBeNull();
    expect(c.selection.starters.includes(reserve.id)).toBe(false);
  });

  it("autoSelect never fields injured or banned players", () => {
    const s = newGame(3);
    const c = s.clubs[1]!;
    for (const p of c.squad.slice(0, 5)) p.ban = 1;
    const sel = autoSelect(c);
    for (const id of [...sel.starters, ...sel.bench]) expect(playerOf(c, id).ban).toBe(0);
  });
});

describe("season progression", () => {
  it("plays a round, updates the table consistently, then advances", () => {
    const s = newGame(7);
    simulateRound(s, SHORT);
    expect(currentFixtures(s).every((f) => f.score)).toBe(true);
    const t = table(s);
    expect(t.reduce((a, r) => a + r.played, 0)).toBe(12);
    expect(t.reduce((a, r) => a + r.gf, 0)).toBe(t.reduce((a, r) => a + r.ga, 0));
    expect(t[0]!.pts).toBeGreaterThanOrEqual(t[11]!.pts);
    expect(advanceRound(s)).toBe(true);
    expect(s.round).toBe(1);
  });

  it("records appearances, minutes, carried fatigue and recovers over the week", () => {
    const s = newGame(8);
    const f = currentFixtures(s)[0]!;
    const m = createMatch(s, f, SHORT);
    m.runToEnd();
    recordResult(s, f, m);
    const home = s.clubs[f.home]!;
    const starters = home.selection.starters.map((id) => playerOf(home, id));
    expect(starters.every((p) => p.stats.apps === 1)).toBe(true);
    expect(starters.some((p) => p.condition < 1)).toBe(true);
    expect(f.scorers.length).toBe(f.score![0] + f.score![1]);
    for (const g of currentFixtures(s)) if (!g.score) { const mm = createMatch(s, g, SHORT); mm.runToEnd(); recordResult(s, g, mm); }
    advanceRound(s);
    expect(starters.every((p) => p.condition === 1)).toBe(true);
  });

  it("same seed replays the same results and survives a save round-trip", () => {
    const a = newGame(9), b = newGame(9);
    simulateRound(a, SHORT);
    simulateRound(b, SHORT);
    expect(currentFixtures(a).map((f) => f.score)).toEqual(currentFixtures(b).map((f) => f.score));
    const c = deserialize(serialize(a))!;
    expect(c).not.toBeNull();
    expect(serialize(c)).toBe(serialize(a));
    expect(deserialize("garbage")).toBeNull();
  });

  it("rolls into a new season with ages and fresh fixtures", () => {
    const s = newGame(10);
    const age = s.clubs[0]!.squad[0]!.age;
    s.round = roundsPerSeason(12);
    startNextSeason(s);
    expect(s.season).toBe(2);
    expect(s.round).toBe(0);
    expect(s.clubs[0]!.squad[0]!.age).toBe(age + 1);
    expect(s.fixtures.every((f) => !f.score)).toBe(true);
    expect(s.clubs.every((c) => selectionProblem(c) === null)).toBe(true);
  });
});
