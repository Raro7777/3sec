import { describe, expect, it } from "vitest";
import { Rng } from "@3sec/engine";
import { advanceRound, expiringContracts, newGame, overall, renewContract, roundsPerSeason, simulateRound, startNextSeason, trainWeek, wageBill, selectionProblem, MIN_SQUAD } from "../src/index";

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

  it("pays wages every week and books training news for the user", () => {
    const s = newGame(32);
    const me = s.clubs[s.userClub]!;
    const budget = me.budget;
    simulateRound(s, { halfLength: 60 });
    advanceRound(s);
    expect(me.budget).not.toBe(budget); // income in, wages out
    expect(wageBill(me)).toBeGreaterThan(0);
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
