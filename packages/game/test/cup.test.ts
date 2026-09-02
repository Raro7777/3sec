import { describe, expect, it } from "vitest";
import {
  CUP_PRIZE, CUP_ROUNDS, advanceCupDay, advanceRound, createCupMatch, cupByes, cupDayDue, cupPrize, currentCupTies, deserialize,
  newGame, pendingCupTies, recordCupResult, roundsPerSeason, serialize, simulateCupDay, simulateRound, table, tieWinner, userCupStatus,
} from "../src/index";
import type { GameState } from "../src/index";

const SHORT = { halfLength: 4 * 60 };

/** Play the whole cup headlessly, stage after stage. */
function playCup(s: GameState): void {
  while (s.cup.stage < 4) simulateCupDay(s, SHORT);
}

describe("3sec 컵 bracket", () => {
  it("draws 4 round-1 ties among the 8 lowest-reputation clubs; the top 4 get byes", () => {
    const s = newGame(11);
    const byes = cupByes(s);
    expect(byes.length).toBe(4);
    const sorted = [...s.clubs].sort((a, b) => b.reputation - a.reputation).map((c) => c.id);
    expect(byes).toEqual(sorted.slice(0, 4));
    const r1 = currentCupTies(s);
    expect(s.cup.stage).toBe(0);
    expect(r1.length).toBe(4);
    const inR1 = r1.flatMap((t) => [t.home, t.away]);
    expect(new Set(inR1).size).toBe(8);
    for (const b of byes) expect(inR1.includes(b)).toBe(false);
    expect(userCupStatus(newGame(11, 7))).toBe("bye"); // 울산: highest reputation
    expect(userCupStatus(newGame(11, 10))).toBe("playing");
  });

  it("runs R1 → QF (4) → SF (2) → F (1) and crowns exactly one holder, deterministically", () => {
    const a = newGame(12), b = newGame(12);
    for (const s of [a, b]) {
      simulateCupDay(s, SHORT);
      expect(s.cup.stage).toBe(1);
      expect(currentCupTies(s).length).toBe(4);
      const qfClubs = currentCupTies(s).flatMap((t) => [t.home, t.away]);
      for (const bye of cupByes(s)) expect(qfClubs.includes(bye)).toBe(true);
      simulateCupDay(s, SHORT);
      expect(s.cup.stage).toBe(2);
      expect(currentCupTies(s).length).toBe(2);
      simulateCupDay(s, SHORT);
      expect(s.cup.stage).toBe(3);
      expect(currentCupTies(s).length).toBe(1);
      simulateCupDay(s, SHORT);
      expect(s.cup.stage).toBe(4);
      expect(s.cup.ties.length).toBe(11);
      expect(typeof s.cup.holder).toBe("number");
      expect(s.cup.holder).toBe(tieWinner(s.cup.ties[10]!));
      expect(s.cup.ties.every((t) => t.score !== null && tieWinner(t) !== null)).toBe(true);
    }
    expect(a.cup).toEqual(b.cup);
    expect(a.news.some((n) => n.includes("3sec 컵 우승"))).toBe(true);
  });

  it("decides drawn ties by a shoot-out and only those", () => {
    let drawn = 0;
    for (let seed = 20; seed < 26; seed++) {
      const s = newGame(seed);
      playCup(s);
      for (const t of s.cup.ties) {
        const level = t.score![0] === t.score![1];
        expect(t.penalties !== undefined).toBe(level);
        if (level) {
          drawn++;
          expect(t.penalties![0]).not.toBe(t.penalties![1]);
          expect(Math.max(...t.penalties!)).toBeGreaterThanOrEqual(1);
        }
      }
      if (s.cup.ties.some((t) => t.penalties)) expect(s.news.some((n) => /승부차기 \d+-\d+/.test(n))).toBe(true);
    }
    expect(drawn).toBeGreaterThan(0);
  });

  it("leaves the league table untouched and skips league card bookkeeping", () => {
    const s = newGame(13);
    const before = JSON.stringify(table(s));
    const yellowsBefore = s.clubs.reduce((n, c) => n + c.squad.reduce((m, p) => m + p.seasonYellows, 0), 0);
    playCup(s);
    expect(JSON.stringify(table(s))).toBe(before);
    expect(s.fixtures.every((f) => !f.score)).toBe(true);
    expect(s.clubs.reduce((n, c) => n + c.squad.reduce((m, p) => m + p.seasonYellows, 0), 0)).toBe(yellowsBefore);
    // ...but appearances were recorded for the cup matches.
    expect(s.clubs.some((c) => c.squad.some((p) => p.stats.apps > 0))).toBe(true);
  });

  it("pays prize money: QF losers 4, SF losers 8, runner-up 15, winner 30", () => {
    const s = newGame(14);
    const start = s.clubs.map((c) => c.budget);
    playCup(s);
    const final = s.cup.ties[10]!;
    const winner = tieWinner(final)!, runnerUp = final.home === winner ? final.away : final.home;
    expect(s.clubs[winner]!.budget - start[winner]!).toBe(CUP_PRIZE.winner);
    expect(s.clubs[runnerUp]!.budget - start[runnerUp]!).toBe(CUP_PRIZE.runnerUp);
    for (const t of s.cup.ties.filter((x) => x.stage === 2)) {
      const l = tieWinner(t) === t.home ? t.away : t.home;
      expect(s.clubs[l]!.budget - start[l]!).toBe(CUP_PRIZE.sfLoser);
    }
    for (const t of s.cup.ties.filter((x) => x.stage === 1)) {
      const l = tieWinner(t) === t.home ? t.away : t.home;
      expect(s.clubs[l]!.budget - start[l]!).toBe(CUP_PRIZE.qfLoser);
    }
    for (const c of s.clubs) expect(cupPrize(s, c.id)).toBe(c.budget - start[c.id]!);
    expect(s.clubs.reduce((n, c) => n + c.budget - start[c.id]!, 0)).toBe(30 + 15 + 2 * 8 + 4 * 4);
  });

  it("schedules cup days after league rounds 6, 11, 16 and 21", () => {
    const s = newGame(15);
    const seen: number[] = [];
    while (s.round < roundsPerSeason(12)) {
      if (s.pendingCupDay) {
        seen.push(s.round);
        expect(cupDayDue(s)).toBe(true);
        expect(pendingCupTies(s).length).toBeGreaterThan(0);
        simulateCupDay(s, SHORT);
        expect(advanceCupDay(s)).toBe(true);
        expect(s.pendingCupDay).toBe(false);
      }
      simulateRound(s, SHORT);
      advanceRound(s);
    }
    expect(seen).toEqual([...CUP_ROUNDS]);
    expect(s.cup.stage).toBe(4);
    expect(table(s).reduce((n, r) => n + r.played, 0)).toBe(12 * 22);
  });

  it("round-trips through a save and migrates old saves without a cup", () => {
    const s = newGame(16);
    simulateCupDay(s, SHORT);
    const back = deserialize(serialize(s))!;
    expect(back.cup).toEqual(s.cup);
    expect(back.pendingCupDay).toBe(s.pendingCupDay);
    expect(back.clubs.map((c) => c.seasonStartBudget)).toEqual(s.clubs.map((c) => c.seasonStartBudget));
    const old = JSON.parse(serialize(newGame(17))) as Record<string, unknown>;
    delete old.cup;
    delete old.pendingCupDay;
    for (const c of old.clubs as Record<string, unknown>[]) delete c.seasonStartBudget;
    const m = deserialize(JSON.stringify(old))!;
    expect(m.pendingCupDay).toBe(false);
    expect(m.cup.stage).toBe(0);
    expect(currentCupTies(m).length).toBe(4);
    expect(m.clubs.every((c) => c.seasonStartBudget === c.budget)).toBe(true);
  });

  it("records a single tie played through createCupMatch", () => {
    const s = newGame(18, 10);
    const t = currentCupTies(s).find((x) => x.home === 10 || x.away === 10)!;
    const m = createCupMatch(s, t, SHORT);
    expect(m.aiManaged.has((t.home === 10 ? 0 : 1) as 0 | 1)).toBe(false);
    m.runToEnd();
    recordCupResult(s, t, m);
    expect(t.score).not.toBeNull();
    expect(t.scorers.length).toBe(t.score![0] + t.score![1]);
    expect(s.news[0]).toMatch(/3sec 컵/);
  });
});
