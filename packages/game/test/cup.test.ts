import { describe, expect, it } from "vitest";
import {
  CUP_D2_ENTRANTS, CUP_NAME, CUP_PRIZE, CUP_ROUNDS, CLUBS_PER_DIVISION, advanceCupDay, advanceRound, createCupMatch, cupByes, cupDayDue, cupField, cupPrize, currentCupTies, deserialize,
  divisionOf, newGame, pendingCupTies, recordCupResult, seasonRounds, serialize, simulateCupDay, simulateRound, table, tieWinner, userCupStatus,
} from "../src/index";
import type { GameState } from "../src/index";

const SHORT = { halfLength: 4 * 60 };

/** Play the whole cup headlessly, stage after stage. */
function playCup(s: GameState): void {
  while (s.cup.stage < 4) simulateCupDay(s, SHORT);
}

describe("컵 대회 bracket", () => {
  it("draws a 16-club field: the whole top flight plus the best four below it, nobody resting", () => {
    const s = newGame(11);
    expect(cupByes(s)).toEqual([]);
    const field = cupField(s);
    expect(field.length).toBe(CLUBS_PER_DIVISION + CUP_D2_ENTRANTS);
    // every first-division club is in, and exactly the best four of the second
    for (const c of s.clubs) if (divisionOf(c) === 1) expect(field).toContain(c.id);
    const below = s.clubs.filter((c) => divisionOf(c) > 1).sort((a, b) => b.reputation - a.reputation);
    for (const c of below.slice(0, CUP_D2_ENTRANTS)) expect(field).toContain(c.id);
    for (const c of below.slice(CUP_D2_ENTRANTS)) expect(field).not.toContain(c.id);

    const r1 = currentCupTies(s);
    expect(s.cup.stage).toBe(0);
    expect(r1.length).toBe(8);
    expect(new Set(r1.flatMap((t) => [t.home, t.away])).size).toBe(16);
    expect(userCupStatus(newGame(11, 7))).toBe("playing"); // 울산: top flight, always in
    expect(userCupStatus(newGame(11, 23))).toBe("out"); // 정선: weakest of the division below
  });

  it("runs R16 (8) → QF (4) → SF (2) → F (1) and crowns exactly one holder, deterministically", () => {
    const a = newGame(12), b = newGame(12);
    for (const s of [a, b]) {
      simulateCupDay(s, SHORT);
      expect(s.cup.stage).toBe(1);
      expect(currentCupTies(s).length).toBe(4);
      simulateCupDay(s, SHORT);
      expect(s.cup.stage).toBe(2);
      expect(currentCupTies(s).length).toBe(2);
      simulateCupDay(s, SHORT);
      expect(s.cup.stage).toBe(3);
      expect(currentCupTies(s).length).toBe(1);
      simulateCupDay(s, SHORT);
      expect(s.cup.stage).toBe(4);
      expect(s.cup.ties.length).toBe(15);
      expect(typeof s.cup.holder).toBe("number");
      expect(s.cup.holder).toBe(tieWinner(s.cup.ties[14]!));
      expect(s.cup.ties.every((t) => t.score !== null && tieWinner(t) !== null)).toBe(true);
    }
    expect(a.cup).toEqual(b.cup);
    expect(a.news.some((n) => n.includes(`${CUP_NAME} 우승`))).toBe(true);
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
    const final = s.cup.ties.find((t) => t.stage === 3)!;
    const winner = tieWinner(final)!, runnerUp = final.home === winner ? final.away : final.home;
    // home ties also bank gate receipts (fans.ts), booked in seasonGate: the prize is what is left
    const net = (id: number) => s.clubs[id]!.budget - start[id]! - (s.clubs[id]!.seasonGate ?? 0);
    expect(net(winner)).toBeCloseTo(CUP_PRIZE.winner, 0);
    expect(net(runnerUp)).toBeCloseTo(CUP_PRIZE.runnerUp, 0);
    for (const t of s.cup.ties.filter((x) => x.stage === 2)) {
      const l = tieWinner(t) === t.home ? t.away : t.home;
      expect(net(l)).toBeCloseTo(CUP_PRIZE.sfLoser, 0);
    }
    for (const t of s.cup.ties.filter((x) => x.stage === 1)) {
      const l = tieWinner(t) === t.home ? t.away : t.home;
      expect(net(l)).toBeCloseTo(CUP_PRIZE.qfLoser, 0);
    }
    for (const c of s.clubs) expect(cupPrize(s, c.id)).toBeCloseTo(net(c.id), 0);
    expect(s.clubs.reduce((n, c) => n + net(c.id), 0)).toBeCloseTo(30 + 15 + 2 * 8 + 4 * 4, 0);
  });

  it("schedules cup days after league rounds 6, 11, 16 and 21", () => {
    const s = newGame(15);
    const seen: number[] = [];
    while (s.round < seasonRounds(s)) {
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
    expect(currentCupTies(m).length).toBe(8);
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
    expect(tieWinner(t)).not.toBeNull();
    // only a level tie goes to penalties, and that is what puts the cup line at the top of the news
    if (t.score![0] === t.score![1]) expect(s.news[0]).toContain(CUP_NAME);
    else expect(t.penalties).toBeUndefined();
  });
});
