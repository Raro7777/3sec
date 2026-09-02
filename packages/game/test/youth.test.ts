import { describe, expect, it } from "vitest";
import { Rng } from "@3sec/engine";
import {
  MAX_PROSPECTS, MAX_SQUAD, LEAVE_AGE, SCOUTING, deserialize, newGame, overall, promoteProspect, releaseProspect, roundsPerSeason,
  serialize, startNextSeason, wageFor, youthIntake, youthWeek, youthWeeklyCost, type ScoutingTier,
} from "../src/index";

describe("youth academy", () => {
  it("intake size follows the scouting tier and the academy is capped at eight", () => {
    const s = newGame(41);
    for (const c of s.clubs) expect(c.youth.prospects.length).toBe(SCOUTING.local.intake);
    const tiers: ScoutingTier[] = ["none", "local", "regional", "national"];
    tiers.forEach((tier, i) => { s.clubs[i]!.youth.prospects = []; s.clubs[i]!.youth.scouting = tier; });
    youthIntake(s, new Rng(7));
    tiers.forEach((tier, i) => expect(s.clubs[i]!.youth.prospects.length).toBe(SCOUTING[tier].intake));
    for (const p of s.clubs[3]!.youth.prospects) {
      expect(p.age).toBeGreaterThanOrEqual(15);
      expect(p.age).toBeLessThanOrEqual(18);
      expect(p.potentialRange[0]).toBeLessThanOrEqual(p.truePotential);
      expect(p.potentialRange[1]).toBeGreaterThanOrEqual(p.truePotential);
    }
    const c = s.clubs[3]!;
    youthIntake(s, new Rng(8));
    youthIntake(s, new Rng(9));
    expect(c.youth.prospects.length).toBe(MAX_PROSPECTS);
  });

  it("weekly scouting narrows the potential range toward the true value and charges the budget", () => {
    const s = newGame(42);
    const me = s.clubs[s.userClub]!;
    me.youth.scouting = "national";
    me.youth.coaching = 3;
    expect(youthWeeklyCost(me)).toBeCloseTo(1.7, 5);
    const budget = me.budget;
    const widths = new Map(me.youth.prospects.map((p) => [p.id, p.potentialRange[1] - p.potentialRange[0]]));
    const ovr = new Map(me.youth.prospects.map((p) => [p.id, overall(p.attrs, p.role)]));
    for (let w = 0; w < 12; w++) { s.round = w + 1; youthWeek(s); }
    expect(me.budget).toBeCloseTo(budget - 1.7 * 12, 5);
    for (const p of me.youth.prospects) {
      const [lo, hi] = p.potentialRange;
      expect(hi - lo).toBeLessThan(widths.get(p.id)!);
      expect(lo).toBeLessThanOrEqual(p.truePotential);
      expect(hi).toBeGreaterThanOrEqual(p.truePotential);
      expect(p.reportsSeen).toBeGreaterThan(0);
      expect(p.weeksInAcademy).toBe(12);
      expect(overall(p.attrs, p.role)).toBeGreaterThanOrEqual(ovr.get(p.id)!);
      expect(overall(p.attrs, p.role)).toBeLessThanOrEqual(p.truePotential + 1);
    }
    const none = s.clubs[(s.userClub + 1) % 12]!;
    none.youth.scouting = "none";
    const w0 = none.youth.prospects[0]!.potentialRange[1] - none.youth.prospects[0]!.potentialRange[0];
    youthWeek(s);
    expect(none.youth.prospects[0]!.potentialRange[1] - none.youth.prospects[0]!.potentialRange[0]).toBeLessThanOrEqual(w0);
  });

  it("promotion moves a prospect into the squad with a cheap 3-season deal, up to the squad limit", () => {
    const s = newGame(43);
    const me = s.clubs[s.userClub]!;
    me.youth.scouting = "national";
    youthIntake(s, new Rng(1));
    const young = me.youth.prospects.find((p) => p.age < 16);
    if (young) expect(promoteProspect(s, young.id)).toMatch(/16세/);
    const p = me.youth.prospects.find((q) => q.age >= 16)!;
    const before = me.squad.length;
    expect(promoteProspect(s, p.id)).toBeNull();
    expect(me.squad.length).toBe(before + 1);
    expect(me.youth.prospects.some((q) => q.id === p.id)).toBe(false);
    const sp = me.squad.find((q) => q.id === p.id)!;
    expect(sp.contractUntil).toBe(s.season + 3);
    expect(sp.potential).toBe(p.truePotential);
    expect(sp.condition).toBe(1);
    expect(sp.stats.apps).toBe(0);
    expect(sp.wage).toBeCloseTo(Math.max(0.3, Math.round(wageFor(sp) * 0.5 * 10) / 10), 5);
    expect(new Set(me.squad.map((q) => q.number)).size).toBe(me.squad.length);
    expect(s.news[0]).toContain("승격");
    while (me.squad.length < MAX_SQUAD) me.squad.push({ ...sp, id: `pad-${me.squad.length}`, number: 50 + me.squad.length });
    const other = me.youth.prospects.find((q) => q.age >= 16)!;
    expect(promoteProspect(s, other.id)).toMatch(/상한/);
    expect(releaseProspect(s, other.id)).toBeNull();
    expect(me.youth.prospects.some((q) => q.id === other.id)).toBe(false);
    expect(promoteProspect(s, "nope")).toMatch(/찾을 수 없/);
  });

  it("prospects age at the rollover; those reaching 19 leave, AI clubs promote to fill thin squads, new intake arrives", () => {
    const s = newGame(44);
    const me = s.clubs[s.userClub]!;
    const old = me.youth.prospects[0]!;
    old.age = LEAVE_AGE - 1;
    const stay = me.youth.prospects[1]!;
    stay.age = 16;
    const ai = s.clubs[(s.userClub + 1) % 12]!;
    ai.squad.length = 18;
    const aiBest = [...ai.youth.prospects].sort((a, b) => b.truePotential - a.truePotential)[0]!;
    aiBest.age = 17;
    const aiSquad = ai.squad.length;
    s.round = roundsPerSeason(12);
    startNextSeason(s);
    expect(me.youth.prospects.some((p) => p.id === old.id)).toBe(false);
    expect(s.news.some((n) => n.includes(old.name) && n.includes("떠났습니다"))).toBe(true);
    const kept = me.youth.prospects.find((p) => p.id === stay.id)!;
    expect(kept.age).toBe(17);
    expect(me.youth.prospects.length).toBeGreaterThan(1);
    expect(ai.squad.length).toBe(aiSquad + 1);
    expect(ai.squad.some((p) => p.id === aiBest.id)).toBe(true);
    for (const c of s.clubs) for (const p of c.youth.prospects) expect(p.age).toBeLessThan(LEAVE_AGE);
  });

  it("survives a save round-trip and migrates saves without an academy", () => {
    const s = newGame(45);
    const me = s.clubs[s.userClub]!;
    me.youth.scouting = "regional";
    me.youth.coaching = 2;
    for (let w = 0; w < 3; w++) { s.round = w + 1; youthWeek(s); }
    const back = deserialize(serialize(s))!;
    expect(serialize(back)).toBe(serialize(s));
    expect(back.clubs[s.userClub]!.youth.prospects[0]!.weeksInAcademy).toBe(3);
    const raw = JSON.parse(serialize(s));
    for (const c of raw.clubs) delete c.youth;
    const old = deserialize(JSON.stringify(raw))!;
    for (const c of old.clubs) expect(c.youth).toEqual({ prospects: [], scouting: "local", coaching: 1, nextId: 1 });
  });
});
