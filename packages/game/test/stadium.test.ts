import { describe, expect, it } from "vitest";
import {
  CLUBS, EXPANSION_COST_BASE, EXPANSION_COST_PER_REP, EXPANSION_MAX_SHARE, EXPANSION_STEP, advanceRound, clubCapacity, clubOf, deserialize, expandStadium, expansionAdvice, expansionCost,
  expansionCostPer1000, expansionProblem, maxExpansion, newGame, renameClub, renameStadium, resetClubKit, seasonOver, serialize, setClubKit, simulateRound, startNextSeason, type GameState,
} from "../src/index";
import { advanceCupDay, simulateCupDay } from "../src/cup";

const SHORT = { halfLength: 4 * 60 };

function playSeason(s: GameState): void {
  while (!seasonOver(s)) {
    if (s.pendingCupDay) { simulateCupDay(s, SHORT); advanceCupDay(s); continue; }
    simulateRound(s, SHORT);
    advanceRound(s);
  }
}

describe("stadium: expansion cost and limits", () => {
  it("a block costs more for a reputable club and the price scales with the seats", () => {
    expect(expansionCostPer1000(10)).toBe(EXPANSION_COST_BASE);
    expect(expansionCostPer1000(14)).toBe(EXPANSION_COST_BASE + 4 * EXPANSION_COST_PER_REP);
    expect(expansionCostPer1000(8)).toBe(EXPANSION_COST_BASE);
    const s = newGame(3);
    const me = clubOf(s, s.userClub);
    expect(expansionCost(me, 3000)).toBeCloseTo(3 * expansionCostPer1000(me.reputation), 5);
  });

  it("the ceiling is EXPANSION_MAX_SHARE above the original seats, in whole blocks, minus pending orders", () => {
    const s = newGame(4);
    const me = clubOf(s, s.userClub);
    const cap = clubCapacity(me);
    expect(maxExpansion(me)).toBe(Math.floor((cap * (1 + EXPANSION_MAX_SHARE)) / EXPANSION_STEP) * EXPANSION_STEP - cap);
    me.pendingSeats = 2000;
    expect(maxExpansion(me)).toBe(Math.floor((cap * (1 + EXPANSION_MAX_SHARE)) / EXPANSION_STEP) * EXPANSION_STEP - cap - 2000);
  });

  it("refuses odd sizes, too much, a second order in the same season and an empty purse", () => {
    const s = newGame(5);
    const me = clubOf(s, s.userClub);
    me.budget = 1000;
    expect(expansionProblem(s, 500)).toMatch(/단위/);
    expect(expansionProblem(s, 0)).toMatch(/단위/);
    expect(expansionProblem(s, maxExpansion(me) + EXPANSION_STEP)).toMatch(/최대/);
    expect(expansionProblem(s, EXPANSION_STEP)).toBeNull();
    me.budget = 1;
    expect(expansionProblem(s, EXPANSION_STEP)).toMatch(/예산/);
    me.budget = 1000;
    expect(expandStadium(s, 2000)).toBeNull();
    expect(expandStadium(s, 1000)).toMatch(/이미/);
    expect(expansionAdvice(s).expandedThisSeason).toBe(true);
  });

  it("an order pays now, remembers the original seats and opens only at the rollover", () => {
    const s = newGame(6);
    const me = clubOf(s, s.userClub);
    const cap = clubCapacity(me);
    me.budget = 500;
    const cost = expansionCost(me, 3000);
    expect(expandStadium(s, 3000)).toBeNull();
    expect(me.budget).toBeCloseTo(500 - cost, 5);
    expect(me.pendingSeats).toBe(3000);
    expect(me.baseCapacity).toBe(cap);
    expect(me.expansionSeason).toBe(s.season);
    expect(clubCapacity(me)).toBe(cap);
    expect(s.news[0]).toMatch(/착공/);
    // survives a save round trip
    const back = deserialize(serialize(s))!;
    expect(clubOf(back, back.userClub).pendingSeats).toBe(3000);
    playSeason(s);
    expect(clubCapacity(me)).toBe(cap);
    startNextSeason(s);
    expect(clubCapacity(me)).toBe(cap + 3000);
    expect(me.pendingSeats).toBeUndefined();
    expect(s.news.some((n) => n.includes("구장 확장 완료") && n.includes("3,000"))).toBe(true);
    // the core support grew with the ground and a new order is allowed again, against the original ceiling
    expect(me.fans.base).toBeGreaterThan(0);
    expect(me.baseCapacity).toBe(cap);
    expect(maxExpansion(me)).toBe(Math.floor((cap * (1 + EXPANSION_MAX_SHARE)) / EXPANSION_STEP) * EXPANSION_STEP - cap - 3000);
    expect(expansionProblem(s, EXPANSION_STEP)).toBeNull();
    // the ceiling holds once reached
    me.capacity = Math.floor((cap * (1 + EXPANSION_MAX_SHARE)) / EXPANSION_STEP) * EXPANSION_STEP;
    expect(maxExpansion(me)).toBe(0);
    expect(expansionProblem(s, EXPANSION_STEP)).toMatch(/더 이상/);
  });

  it("the advice counts occupancy and sellouts, and seats pay only when the ground sells out", () => {
    const s = newGame(7);
    const me = clubOf(s, s.userClub);
    const fresh = expansionAdvice(s, 2000);
    expect(fresh.homeMatches).toBe(0);
    expect(fresh.extraGate).toBe(0);
    expect(fresh.paybackSeasons).toBe(Infinity);
    expect(fresh.cost).toBeCloseTo(expansionCost(me, 2000), 5);
    expect(fresh.maxSeats).toBe(maxExpansion(me));
    playSeason(s);
    const a = expansionAdvice(s, 2000);
    expect(a.homeMatches).toBeGreaterThan(0);
    expect(a.occupancy).toBeGreaterThan(0);
    expect(a.occupancy).toBeLessThanOrEqual(1);
    expect(a.sellouts).toBe(s.fixtures.filter((f) => f.home === me.id && (f.attendance ?? 0) >= a.capacity).length + s.cup.ties.filter((t) => t.home === me.id && (t.attendance ?? 0) >= a.capacity).length);
    if (a.sellouts > 0) {
      expect(a.extraGate).toBeGreaterThan(0);
      expect(a.paybackSeasons).toBeCloseTo(a.cost / a.extraGate, 1);
    } else {
      expect(a.extraGate).toBe(0);
      expect(a.paybackSeasons).toBe(Infinity);
    }
    // a packed ground: every home match at the roof → 2,000 seats × fill × matches × ticket
    for (const f of s.fixtures) if (f.home === me.id && f.attendance !== undefined) f.attendance = a.capacity;
    for (const t of s.cup.ties) if (t.home === me.id && t.attendance !== undefined) t.attendance = a.capacity;
    const full = expansionAdvice(s, 2000);
    expect(full.sellouts).toBe(full.homeMatches);
    expect(full.extraGate).toBeGreaterThan(a.extraGate - 1e-9);
    expect(full.paybackSeasons).toBeLessThan(20);
  });
});

describe("customize: names and kit", () => {
  it("renames the club once the names pass, keeps the original name and survives a reload", () => {
    const s = newGame(8);
    const me = clubOf(s, s.userClub);
    const orig = me.name;
    expect(renameClub(s, "", "AB")).toMatch(/입력/);
    expect(renameClub(s, "아주아주아주아주긴구단이름이다", "AB")).toMatch(/이내/);
    expect(renameClub(s, "새 구단", "A")).toMatch(/약칭/);
    expect(renameClub(s, "새 구단", "ABCD")).toMatch(/약칭/);
    const other = s.clubs.find((c) => c.id !== me.id)!;
    expect(renameClub(s, other.name, "AB")).toMatch(/이미/);
    expect(renameClub(s, "새 구단", "새구")).toBeNull();
    expect(me.name).toBe("새 구단");
    expect(me.shortName).toBe("새구");
    expect(me.baseName).toBe(orig);
    expect(renameClub(s, "둘째 이름", "둘째")).toBeNull();
    expect(me.baseName).toBe(orig);
    const back = clubOf(deserialize(serialize(s))!, s.userClub);
    expect(back.name).toBe("둘째 이름");
    expect(back.baseName).toBe(orig);
    // untouched clubs still get their labels refreshed from the world definition
    const otherBack = deserialize(serialize(s))!.clubs.find((c) => c.id === other.id)!;
    expect(otherBack.name).toBe(CLUBS[other.id]!.name);
    expect(renameStadium(s, "우리 홈")).toBeNull();
    expect(me.stadiumName).toBe("우리 홈");
    expect(renameStadium(s, "")).toBeNull();
    expect(me.stadiumName).toBeUndefined();
  });

  it("the kit sets the club colour and a reset restores the default", () => {
    const s = newGame(9);
    const me = clubOf(s, s.userClub);
    const orig = me.color;
    expect(setClubKit(s, { primary: "red", secondary: "#000000", pattern: "hoops" })).toMatch(/색상/);
    expect(setClubKit(s, { primary: "#112233", secondary: "#FFEEDD", pattern: "hoops", away: "dark" })).toBeNull();
    expect(me.color).toBe("#112233");
    expect(me.kit).toEqual({ primary: "#112233", secondary: "#ffeedd", pattern: "hoops", away: "dark" });
    expect(setClubKit(s, { primary: "#112233", secondary: "#ffeedd", pattern: "sash", away: { primary: "#ffffff", secondary: "#112233", pattern: "halves" } })).toBeNull();
    expect(typeof me.kit?.away).toBe("object");
    resetClubKit(s, orig);
    expect(me.kit).toBeUndefined();
    expect(me.color).toBe(orig);
  });
});
