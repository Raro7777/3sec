import { describe, expect, it } from "vitest";
import { Rng } from "@3sec/engine";
import { advanceRound, expiringContracts, newGame, overall, renewContract, roundsPerSeason, simulateRound, startNextSeason, trainWeek, wageBill, selectionProblem, MIN_SQUAD, playingTimeBonus, weeklyRate, BENCHED_FACTOR, INTENSITY_MULT } from "../src/index";
import type { Attributes } from "@3sec/engine";

const attrSum = (a: Attributes): number => Object.values(a).reduce((x, y) => x + y, 0);

describe("training and development", () => {
  it("young players grow toward potential, veterans decline, over a season of weeks", () => {
    const s = newGame(31);
    const c = s.clubs[0]!;
    const young = c.squad.filter((p) => p.age <= 21);
    const old = c.squad.filter((p) => p.age >= 33);
    const before = new Map(c.squad.map((p) => [p.id, overall(p.attrs, p.role)]));
    c.training = { focus: "technical", intensity: "high" };
    const rng = new Rng(3);
    for (let w = 0; w < 40; w++) trainWeek(c, rng);
    for (const p of young) expect(overall(p.attrs, p.role)).toBeGreaterThanOrEqual(before.get(p.id)!);
    if (young.length) expect(young.some((p) => overall(p.attrs, p.role) > before.get(p.id)!)).toBe(true);
    for (const p of old) expect(overall(p.attrs, p.role)).toBeLessThanOrEqual(before.get(p.id)!);
    for (const p of c.squad) expect(overall(p.attrs, p.role)).toBeLessThanOrEqual(p.potential + 1);
  });

  it("an 18-year-old with headroom who plays every week gains at least 6 attribute points over a 22-round season", () => {
    const s = newGame(34);
    const c = s.clubs[0]!;
    c.training = { focus: "balanced", intensity: "normal" };
    const kid = c.squad.find((p) => p.role !== "GK")!;
    kid.age = 18;
    kid.potential = Math.min(20, overall(kid.attrs, kid.role) + 5);
    const before = attrSum(kid.attrs);
    const rng = new Rng(5);
    for (let w = 0; w < 22; w++) {
      // a full match: the recordResult bookkeeping for a 70-minute outing
      kid.lastMinutes = 70;
      kid.growth += playingTimeBonus(kid.age, 70);
      trainWeek(c, rng);
      expect(kid.lastMinutes).toBe(0); // the week's minutes are consumed by training
    }
    expect(attrSum(kid.attrs) - before).toBeGreaterThanOrEqual(6);
    expect(attrSum(kid.attrs) - before).toBeLessThanOrEqual(12);
  });

  it("development rates: playing time pays, benched youngsters slow down, intensity scales", () => {
    expect(weeklyRate(18)).toBeCloseTo(0.24);
    expect(weeklyRate(20)).toBeCloseTo(0.2);
    expect(weeklyRate(23)).toBeCloseTo(0.16);
    expect(weeklyRate(26)).toBeCloseTo(0.07);
    expect(weeklyRate(29)).toBeCloseTo(0.015);
    expect(weeklyRate(32)).toBeCloseTo(-0.05);
    expect(weeklyRate(33)).toBeCloseTo(-0.11);
    expect(playingTimeBonus(19, 90)).toBe(0.09);
    expect(playingTimeBonus(23, 60)).toBe(0.06);
    expect(playingTimeBonus(23, 59)).toBe(0);
    expect(playingTimeBonus(24, 90)).toBe(0);
    expect(INTENSITY_MULT.high).toBe(1.4);
    expect(INTENSITY_MULT.low).toBe(0.7);
    const s = newGame(35);
    const c = s.clubs[0]!;
    const kid = c.squad.find((p) => p.role !== "GK")!;
    kid.age = 19; kid.potential = 20; kid.growth = 0;
    const rng = { next: () => 0.99 }; // never spends a point, so growth is the raw rate
    kid.lastMinutes = 0;
    trainWeek(c, { next: () => 0.5 });
    const benched = kid.growth;
    expect(benched).toBeCloseTo(0.24 * BENCHED_FACTOR, 5);
    kid.growth = 0; kid.lastMinutes = 90;
    trainWeek(c, rng);
    expect(kid.growth).toBeCloseTo(0.24, 5);
    c.training = { focus: "balanced", intensity: "high" };
    kid.growth = 0; kid.lastMinutes = 90;
    trainWeek(c, rng);
    expect(kid.growth).toBeCloseTo(0.24 * 1.4, 5);
  });

  it("a season of real matches feeds minutes into development and counts injuries", () => {
    const s = newGame(36);
    simulateRound(s, { halfLength: 60 });
    const played = s.clubs.flatMap((c) => c.squad).filter((p) => p.stats.apps > 0);
    expect(played.length).toBeGreaterThan(0);
    expect(played.every((p) => (p.lastMinutes ?? 0) > 0)).toBe(true);
    const injuries = s.clubs.reduce((n, c) => n + (c.seasonInjuries ?? 0), 0);
    expect(injuries).toBe(s.news.filter((n) => /부상/.test(n)).length);
    advanceRound(s);
    expect(played.every((p) => p.lastMinutes === 0)).toBe(true);
  });

  it("pays wages every week and books training news for the user", () => {
    const s = newGame(32);
    const me = s.clubs[s.userClub]!;
    const budget = me.budget;
    simulateRound(s, { halfLength: 60 });
    advanceRound(s);
    expect(me.budget).not.toBe(budget); // income in, wages out
    expect(wageBill(me)).toBeGreaterThan(0);
    expect(me.seasonWages).toBeCloseTo(wageBill(me) / roundsPerSeason(12), 1);
    expect(me.seasonRevenue).toBeGreaterThan(0);
  });

  it("contracts expire at the season end; renewals cost a fee and extend the deal", () => {
    const s = newGame(33);
    const me = s.clubs[s.userClub]!;
    me.budget = 1000;
    const exp = expiringContracts(s);
    expect(exp.length).toBeGreaterThan(0);
    const keep = exp[0]!;
    expect(renewContract(s, keep.id, 2)).toBeNull();
    expect(keep.contractUntil).toBe(3);
    expect(me.budget).toBeLessThan(1000);
    const leavers = expiringContracts(s).map((p) => p.id);
    s.round = roundsPerSeason(12);
    startNextSeason(s);
    expect(me.squad.some((p) => p.id === keep.id)).toBe(true);
    for (const id of leavers) if (me.squad.length > MIN_SQUAD) expect(me.squad.some((p) => p.id === id)).toBe(false);
    expect(me.squad.length).toBeGreaterThanOrEqual(MIN_SQUAD);
    for (const c of s.clubs) {
      expect(selectionProblem(c)).toBeNull();
      expect(c.squad.every((p) => p.contractUntil >= s.season)).toBe(true);
    }
  });
});
