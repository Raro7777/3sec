import { describe, expect, it } from "vitest";
import {
  CLUBS_PER_DIVISION, DIVISIONS, SWAP, advanceRound, applyPromotionRelegation, clubsIn, currentFixtures, deserialize,
  divisionOf, divisionPosition, divisionTable, inPromotionZone, inRelegationZone, newGame, seasonOver, seasonRounds,
  serialize, simulateRound, startNextSeason, table, userDivision, type GameState,
} from "../src/index";

const SHORT = { halfLength: 3 * 60 };

/** Play a whole season headlessly: the user's division through the engine, the rest statistically. */
function playSeason(s: GameState): void {
  while (!seasonOver(s)) {
    s.pendingCupDay = false;
    simulateRound(s, SHORT);
    advanceRound(s);
  }
}

describe("두 개의 디비전", () => {
  it("builds two full divisions on one calendar, each playing only itself", () => {
    const s = newGame(31);
    expect(s.clubs.length).toBe(CLUBS_PER_DIVISION * DIVISIONS);
    for (let d = 1; d <= DIVISIONS; d++) expect(clubsIn(s, d).length).toBe(CLUBS_PER_DIVISION);

    // Every fixture is between two clubs of the same division, and both divisions play every round.
    for (const f of s.fixtures) expect(divisionOf(s.clubs[f.home]!)).toBe(divisionOf(s.clubs[f.away]!));
    const rounds = seasonRounds(s);
    expect(s.fixtures.length).toBe(DIVISIONS * rounds * (CLUBS_PER_DIVISION / 2));
    for (let r = 0; r < rounds; r++) {
      for (let d = 1; d <= DIVISIONS; d++) {
        const n = s.fixtures.filter((f) => f.round === r && divisionOf(s.clubs[f.home]!) === d).length;
        expect(n).toBe(CLUBS_PER_DIVISION / 2);
      }
    }
    // The engine only ever plays the user's own division.
    expect(currentFixtures(s).length).toBe(CLUBS_PER_DIVISION / 2);
    for (const f of currentFixtures(s)) expect(divisionOf(s.clubs[f.home]!)).toBe(userDivision(s));
  });

  it("resolves the division the user is not in, complete with a table, scorers and gate money", () => {
    const s = newGame(32);
    const other = userDivision(s) === 1 ? 2 : 1;
    const before = clubsIn(s, other).map((c) => c.budget);
    simulateRound(s, SHORT);
    advanceRound(s);

    const rows = divisionTable(s, other);
    expect(rows.every((r) => r.played === 1)).toBe(true);
    expect(rows.reduce((n, r) => n + r.pts, 0)).toBeGreaterThan(0);
    // Somebody scored, and the goals are on a player's record rather than nobody's.
    const goals = rows.reduce((n, r) => n + r.gf, 0);
    expect(goals).toBeGreaterThan(0);
    expect(clubsIn(s, other).reduce((n, c) => n + c.squad.reduce((m, p) => m + p.stats.goals, 0), 0)).toBe(goals);
    // Their home matches sold tickets: a club promoted later must not arrive broke.
    expect(clubsIn(s, other).map((c) => c.budget)).not.toEqual(before);
    for (const f of s.fixtures.filter((x) => x.round === 0 && divisionOf(s.clubs[x.home]!) === other)) {
      expect(f.attendance).toBeGreaterThan(0);
    }
  });

  it("sends the bottom two down and brings the top two up, and moves reputation with them", () => {
    const s = newGame(33);
    playSeason(s);
    const d1 = divisionTable(s, 1), d2 = divisionTable(s, 2);
    const down = d1.slice(-SWAP).map((r) => r.club);
    const up = d2.slice(0, SWAP).map((r) => r.club);
    // The standings screen agrees with what is about to happen.
    for (const id of down) expect(inRelegationZone(s, id)).toBe(true);
    for (const id of up) expect(inPromotionZone(s, id)).toBe(true);
    expect(inRelegationZone(s, d1[0]!.club)).toBe(false);
    expect(inPromotionZone(s, d2[d2.length - 1]!.club)).toBe(false);

    const repBefore = new Map(s.clubs.map((c) => [c.id, c.reputation]));
    const swap = applyPromotionRelegation(s);
    expect(swap.relegated.map((r) => r.club).sort()).toEqual([...down].sort());
    expect(swap.promoted.map((r) => r.club).sort()).toEqual([...up].sort());
    for (const id of down) {
      expect(divisionOf(s.clubs[id]!)).toBe(2);
      expect(s.clubs[id]!.reputation).toBeLessThan(repBefore.get(id)!);
    }
    for (const id of up) {
      expect(divisionOf(s.clubs[id]!)).toBe(1);
      expect(s.clubs[id]!.reputation).toBeGreaterThan(repBefore.get(id)!);
    }
    for (let d = 1; d <= DIVISIONS; d++) expect(clubsIn(s, d).length).toBe(CLUBS_PER_DIVISION);
  });

  it("carries promotion through the rollover: new fixtures, the user's own league, and the news", () => {
    const s = newGame(34);
    playSeason(s);
    const goingUp = divisionTable(s, 2).slice(0, SWAP).map((r) => r.club);
    const goingDown = divisionTable(s, 1).slice(-SWAP).map((r) => r.club);
    startNextSeason(s);

    for (const id of goingUp) expect(divisionOf(s.clubs[id]!)).toBe(1);
    for (const id of goingDown) expect(divisionOf(s.clubs[id]!)).toBe(2);
    // The new calendar is drawn for the divisions as they now stand.
    for (const f of s.fixtures) expect(divisionOf(s.clubs[f.home]!)).toBe(divisionOf(s.clubs[f.away]!));
    expect(s.fixtures.every((f) => f.score === null)).toBe(true);
    const promoted = s.clubs[goingUp[0]!]!;
    expect(s.news.some((n) => n.includes(promoted.name) && n.includes("승격"))).toBe(true);
    // The user's table is their own division and nothing else.
    expect(table(s).length).toBe(CLUBS_PER_DIVISION);
    expect(table(s).every((r) => divisionOf(s.clubs[r.club]!) === userDivision(s))).toBe(true);
  });

  it("a relegated user plays the division below, and their table follows them down", () => {
    const s = newGame(35);
    const me = s.clubs[s.userClub]!;
    playSeason(s);
    // Force the user to finish last: the rollover must move them, not just the clubs around them.
    me.division = 1;
    for (const f of s.fixtures) {
      if (f.home === me.id) f.score = [0, 4];
      else if (f.away === me.id) f.score = [4, 0];
    }
    expect(divisionPosition(s, me.id)).toBe(CLUBS_PER_DIVISION);
    startNextSeason(s);

    expect(divisionOf(me)).toBe(2);
    expect(userDivision(s)).toBe(2);
    expect(table(s).some((r) => r.club === me.id)).toBe(true);
    expect(currentFixtures(s).every((f) => divisionOf(s.clubs[f.home]!) === 2)).toBe(true);
    expect(s.news.some((n) => n.includes("강등"))).toBe(true);
  });

  it("a save from the one-league game gains a second division, caught up to the round it is on", () => {
    const s = newGame(36);
    for (let r = 0; r < 3; r++) { s.pendingCupDay = false; simulateRound(s, SHORT); advanceRound(s); }
    const raw = JSON.parse(serialize(s)) as { clubs: { division?: number }[]; fixtures: { home: number }[] };
    // Roll the save back to what the one-league game wrote: twelve clubs, their fixtures, no divisions.
    raw.clubs = raw.clubs.slice(0, CLUBS_PER_DIVISION);
    raw.fixtures = raw.fixtures.filter((f) => f.home < CLUBS_PER_DIVISION);
    for (const c of raw.clubs) delete c.division;

    const back = deserialize(JSON.stringify(raw))!;
    expect(back).not.toBeNull();
    expect(back.clubs.length).toBe(CLUBS_PER_DIVISION * DIVISIONS);
    for (let d = 1; d <= DIVISIONS; d++) expect(clubsIn(back, d).length).toBe(CLUBS_PER_DIVISION);
    // The old clubs keep their ids, their division and the season they had played.
    expect(divisionTable(back, 1).every((r) => r.played === 3)).toBe(true);
    // The new division is caught up so the promotion places mean something at the rollover.
    expect(divisionTable(back, 2).every((r) => r.played === 3)).toBe(true);
    expect(new Set(back.fixtures.map((f) => f.id)).size).toBe(back.fixtures.length);
  });
});
