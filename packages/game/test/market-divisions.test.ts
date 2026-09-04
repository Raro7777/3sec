import { describe, expect, it } from "vitest";
import {
  CLUBS_PER_DIVISION, RELEGATION_DISCOUNT, SWAP, advanceRound, applyPromotionRelegation, askingPrice, clubsIn,
  divisionOf, divisionTable, newGame, playerValue, pyramidPosition, refusalChanceBetween, seasonOver, simulateRound,
  startNextSeason, type Club, type GameState,
} from "../src/index";

const SHORT = { halfLength: 3 * 60 };
const playSeason = (s: GameState) => {
  while (!seasonOver(s)) { s.pendingCupDay = false; simulateRound(s, SHORT); advanceRound(s); }
};
/** Make `p` a starter at `c` so he has a place worth keeping. */
const starterOf = (c: Club) => c.squad.find((p) => c.selection.starters.includes(p.id))!;

describe("이적시장과 디비전", () => {
  it("ranks clubs down the pyramid, so leading the second division sits below surviving in the first", () => {
    const s = newGame(41);
    playSeason(s);
    const top = divisionTable(s, 1).map((r) => r.club);
    const below = divisionTable(s, 2).map((r) => r.club);
    expect(pyramidPosition(s, top[0]!)).toBe(1);
    expect(pyramidPosition(s, top[top.length - 1]!)).toBe(CLUBS_PER_DIVISION);
    // the second division's champions rank below the first division's bottom club
    expect(pyramidPosition(s, below[0]!)).toBe(CLUBS_PER_DIVISION + 1);
    expect(pyramidPosition(s, below[0]!)).toBeGreaterThan(pyramidPosition(s, top[top.length - 1]!));
  });

  it("a first-division starter refuses to drop a division; the same move upward is welcome", () => {
    const s = newGame(42);
    playSeason(s);
    const topClub = clubsIn(s, 1).find((c) => pyramidPosition(s, c.id) <= 3)!;
    const lowClub = clubsIn(s, 2).find((c) => pyramidPosition(s, c.id) >= CLUBS_PER_DIVISION + 6)!;
    const star = starterOf(topClub);
    const journeyman = starterOf(lowClub);
    expect(refusalChanceBetween(s, topClub, lowClub, star)).toBeGreaterThan(0.5);
    expect(refusalChanceBetween(s, lowClub, topClub, journeyman)).toBe(0);
  });

  it("marks a relegated club for one season: its players go cheap and barely refuse a move", () => {
    const s = newGame(43);
    playSeason(s);
    const down = divisionTable(s, 1).slice(-SWAP).map((r) => r.club);
    const club = s.clubs[down[0]!]!;
    const p = starterOf(club);
    const fullPrice = askingPrice(club, p)!;

    applyPromotionRelegation(s);
    expect(club.firesale).toBe(true);
    expect(divisionOf(club)).toBe(2);
    // the same player is now a third cheaper
    expect(askingPrice(club, p)!).toBeCloseTo(Math.round(fullPrice * RELEGATION_DISCOUNT), 0);
    expect(askingPrice(club, p)!).toBeLessThan(fullPrice);
    // and he is far readier to leave than a settled player facing the same step
    const settled = clubsIn(s, 2).find((c) => c.id !== club.id && !c.firesale)!;
    const other = starterOf(settled);
    const worse = clubsIn(s, 2).reduce((a, b) => (pyramidPosition(s, b.id) > pyramidPosition(s, a.id) ? b : a));
    if (worse.id !== club.id && worse.id !== settled.id) {
      expect(refusalChanceBetween(s, club, worse, p)).toBeLessThan(refusalChanceBetween(s, settled, worse, other) || 1);
    }
    expect(playerValue(p)).toBeGreaterThan(0);
  });

  it("clears the fire sale at the next rollover, so it costs one season and not every season after", () => {
    const s = newGame(44);
    playSeason(s);
    startNextSeason(s);
    const flagged = s.clubs.filter((c) => c.firesale).map((c) => c.id);
    expect(flagged.length).toBe(SWAP);
    playSeason(s);
    startNextSeason(s);
    // last year's relegated clubs are no longer discounted; only this year's are
    const nowFlagged = s.clubs.filter((c) => c.firesale).map((c) => c.id);
    expect(nowFlagged.length).toBe(SWAP);
    for (const id of flagged) if (!nowFlagged.includes(id)) expect(s.clubs[id]!.firesale).toBeUndefined();
  });
});
