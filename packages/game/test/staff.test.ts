import { describe, expect, it } from "vitest";
import { Rng } from "@3sec/engine";
import {
  AI_RENEW_RATING, MAX_PER_ROLE, MAX_STAFF, NATIONAL_SCOUT_RATING, SCOUTING, STAFF_MARKET_MAX, STAFF_MARKET_MIN, STAFF_ROLES, USER_ASSISTANT_RATING,
  advanceRound, aiHireStaff, applyStaffRecovery, deserialize, ensureStaffMarket, expiringStaff, fireStaff, hireStaff, injuryDaysFactor, injuryFactor,
  intakeTier, migrateStaff, newGame, payWages, recoveryBonus, refreshStaffMarket, renewStaff, roundsPerSeason, scoutReport, serialize, simulateRound,
  staffBonus, staffRating, staffRollover, staffSeverance, staffSigningFee, staffWage, staffWageBill, staffWeek, startNextSeason, trainWeek, transferTargets,
  wageBill, weeklyRevenue, youthIntake, youthNarrowFactor, youthWeek, type GameState, type StaffMember, type StaffRole, seasonRounds,
} from "../src/index";

const roleOf = (role: StaffRole, rating: number, season = 1, id = `T-${role}-${rating}`): StaffMember =>
  ({ id, name: "테스트", role, rating, age: 40, wage: staffWage(rating), contractUntil: season });

const finishSeason = (s: GameState): void => { s.round = roundsPerSeason(s.clubs.length); };

describe("coaching staff — generation", () => {
  it("every club starts with 3..6 staff rated 4..19 (one assistant at least, one per role), the user with a modest trio", () => {
    const s = newGame(51);
    for (const c of s.clubs) {
      const n = c.staff.length;
      if (c.id === s.userClub) {
        expect(n).toBe(3);
        expect(c.staff.map((m) => m.role).sort()).toEqual(["assistant", "fitness", "physio"]);
        for (const m of c.staff) {
          if (m.role === "assistant") expect(m.rating).toBe(USER_ASSISTANT_RATING); // neutral: training starts at plain rates
          else expect(Math.abs(m.rating - (c.reputation - 1))).toBeLessThanOrEqual(2);
          expect(m.contractUntil).toBe(1);
        }
        expect(staffBonus(c, "assistant")).toBeCloseTo(1, 5);
        continue;
      }
      expect(n).toBeGreaterThanOrEqual(3);
      expect(n).toBeLessThanOrEqual(6);
      expect(c.staff.some((m) => m.role === "assistant")).toBe(true);
      for (const role of STAFF_ROLES) expect(c.staff.filter((m) => m.role === role).length).toBeLessThanOrEqual(MAX_PER_ROLE[role]);
      for (const m of c.staff) {
        expect(m.rating).toBeGreaterThanOrEqual(4);
        expect(m.rating).toBeLessThanOrEqual(19);
        expect(m.wage).toBeCloseTo(staffWage(m.rating), 5);
        expect(m.wage).toBeGreaterThanOrEqual(0.3);
        expect(m.contractUntil).toBeGreaterThanOrEqual(1);
      }
      expect(new Set(c.staff.map((m) => m.id)).size).toBe(n);
    }
    // the same seed builds the same staff; bigger clubs field more of it on average
    const t = newGame(51);
    expect(t.clubs.map((c) => c.staff)).toEqual(s.clubs.map((c) => c.staff));
    const ai = s.clubs.filter((c) => c.id !== s.userClub);
    const big = ai.filter((c) => c.reputation >= 13), small = ai.filter((c) => c.reputation <= 11.3);
    const avg = (xs: typeof ai) => xs.reduce((n, c) => n + c.staff.length, 0) / xs.length;
    expect(avg(big)).toBeGreaterThan(avg(small));
  });

  it("wages follow 0.15 × rating^1.3 / 10 with a 0.3 floor", () => {
    expect(staffWage(4)).toBe(0.3);
    expect(staffWage(16)).toBeCloseTo(0.15 * Math.pow(16, 1.3) / 10, 2);
    expect(staffWage(19)).toBeGreaterThan(staffWage(12));
  });
});

describe("coaching staff — effects", () => {
  it("the assistant scales first-team growth: a 16 assistant develops a youngster 1.2× as fast as an 8, a 6 slower", () => {
    const s = newGame(52);
    const c = s.clubs[0]!;
    c.training = { focus: "balanced", intensity: "normal" };
    const kid = c.squad.find((p) => p.role !== "GK")!;
    kid.age = 19; kid.potential = 20;
    const rng = { next: () => 0.99 }; // never spends a point, so growth is the raw rate
    const growthWith = (rating: number): number => {
      c.staff = [roleOf("assistant", rating)];
      kid.growth = 0; kid.lastMinutes = 90;
      trainWeek(c, rng);
      return kid.growth;
    };
    expect(staffBonus(c, "fitness")).toBe(1);
    expect(growthWith(8)).toBeCloseTo(0.2, 5);
    expect(growthWith(16)).toBeCloseTo(0.2 * 1.2, 5);
    expect(growthWith(6)).toBeCloseTo(0.2 * 0.95, 5);
    expect(growthWith(16) / growthWith(6)).toBeCloseTo(1.2 / 0.95, 5);
    c.staff = [];
    expect(staffBonus(c, "assistant")).toBe(1);
    kid.growth = 0; kid.lastMinutes = 90; trainWeek(c, rng);
    expect(kid.growth).toBeCloseTo(0.2, 5);
  });

  it("keepers train under the GK coach when there is one, otherwise under the assistant", () => {
    const s = newGame(53);
    const c = s.clubs[0]!;
    c.training = { focus: "balanced", intensity: "normal" };
    const gk = c.squad.find((p) => p.role === "GK")!;
    gk.age = 19; gk.potential = 20;
    const rng = { next: () => 0.99 };
    c.staff = [roleOf("assistant", 16)];
    gk.growth = 0; gk.lastMinutes = 90; trainWeek(c, rng);
    expect(gk.growth).toBeCloseTo(0.2 * 1.2, 5);
    c.staff = [roleOf("assistant", 16), roleOf("gk", 10)];
    gk.growth = 0; gk.lastMinutes = 90; trainWeek(c, rng);
    expect(gk.growth).toBeCloseTo(0.2 * (0.8 + 0.03 * 10), 5);
  });

  it("the youth coach speeds academy growth and the narrowing of the potential range", () => {
    const s = newGame(54);
    const me = s.clubs[s.userClub]!;
    me.youth.scouting = "regional";
    youthIntake(s, new Rng(3));
    const run = (rating: number | null): { growth: number; width: number } => {
      const t = deserialize(serialize(s))!;
      const c = t.clubs[t.userClub]!;
      c.staff = rating === null ? [] : [roleOf("youth", rating)];
      for (const p of c.youth.prospects) { p.growth = 0; p.reportsSeen = 0; p.weeksInAcademy = 0; }
      for (let w = 0; w < 12; w++) { t.round = w + 1; youthWeek(t); }
      // spent points land in attributes, the rest stays in the accumulator: sum both
      let growth = 0;
      for (const p of c.youth.prospects) growth += p.growth + Object.values(p.attrs).reduce((x, y) => x + y, 0);
      const width = c.youth.prospects.reduce((n, p) => n + (p.potentialRange[1] - p.potentialRange[0]), 0);
      return { growth, width };
    };
    expect(youthNarrowFactor(me)).toBe(1);
    me.staff = [roleOf("youth", 16)];
    expect(youthNarrowFactor(me)).toBeCloseTo(0.8 + 0.03 * 16, 5);
    expect(staffBonus(me, "youth")).toBeCloseTo(0.85 + 0.02 * 16, 5);
    const none = run(null), good = run(16), poor = run(4);
    expect(good.width).toBeLessThan(none.width);
    expect(poor.width).toBeGreaterThan(good.width);
    expect(good.growth).toBeGreaterThanOrEqual(poor.growth);
  });

  it("scout: transfer targets carry a 관찰 보고 within ±(6 − rating/4) of the true potential, none without a scout", () => {
    const s = newGame(55);
    const me = s.clubs[s.userClub]!;
    me.staff = me.staff.filter((m) => m.role !== "scout");
    expect(transferTargets(s).every((t) => t.report === undefined)).toBe(true);
    for (const rating of [8, 16, 20]) {
      me.staff = [roleOf("scout", rating)];
      const err = 6 - rating / 4;
      const targets = transferTargets(s);
      expect(targets.length).toBeGreaterThan(0);
      for (const t of targets) {
        expect(t.report).toBeDefined();
        expect(Math.abs(t.report!.potential - t.player.potential)).toBeLessThanOrEqual(err + 0.051);
        expect(t.report!.note).toContain("관찰 보고");
      }
      // deterministic: the same report on every call this season
      expect(transferTargets(s)[0]!.report).toEqual(targets[0]!.report);
    }
    expect(scoutReport(me, { id: "x", potential: 25 }, 1)!.potential).toBeLessThanOrEqual(20);
  });

  it("scout: a national intake needs a scout rated ≥ 12, otherwise it runs at the regional size", () => {
    const s = newGame(56);
    const me = s.clubs[s.userClub]!;
    me.youth.scouting = "national";
    me.staff = me.staff.filter((m) => m.role !== "scout");
    expect(intakeTier(me)).toBe(SCOUTING.regional);
    me.youth.prospects = [];
    youthIntake(s, new Rng(1));
    expect(me.youth.prospects.length).toBe(SCOUTING.regional.intake);
    expect(s.news.some((n) => n.includes("전국 스카우팅"))).toBe(true);
    me.staff.push(roleOf("scout", NATIONAL_SCOUT_RATING - 1));
    expect(intakeTier(me)).toBe(SCOUTING.regional);
    me.staff = me.staff.filter((m) => m.role !== "scout");
    me.staff.push(roleOf("scout", NATIONAL_SCOUT_RATING));
    expect(intakeTier(me)).toBe(SCOUTING.national);
    me.youth.prospects = [];
    youthIntake(s, new Rng(2));
    expect(me.youth.prospects.length).toBe(SCOUTING.national.intake);
  });

  it("fitness coach and physio: recovery, injury chance and injury length factors", () => {
    const s = newGame(57);
    const c = s.clubs[0]!;
    c.staff = [];
    expect(recoveryBonus(c)).toBe(0);
    expect(injuryFactor(c)).toBe(1);
    expect(injuryDaysFactor(c)).toBe(1);
    c.staff = [roleOf("fitness", 8), roleOf("physio", 8)];
    expect(recoveryBonus(c)).toBe(0);
    expect(injuryFactor(c)).toBe(1);
    expect(injuryDaysFactor(c)).toBe(1);
    c.staff = [roleOf("fitness", 16), roleOf("physio", 16)];
    expect(recoveryBonus(c)).toBeCloseTo(0.08, 5);
    expect(injuryFactor(c)).toBeCloseTo(1 - 0.02 * 8, 5);
    expect(injuryDaysFactor(c)).toBeCloseTo(1 - 0.03 * 8, 5);
    c.staff = [roleOf("fitness", 4), roleOf("physio", 1)];
    expect(injuryFactor(c)).toBeLessThanOrEqual(1.12);
    expect(injuryDaysFactor(c)).toBeCloseTo(1.21, 5);
    c.staff = [roleOf("physio", 20)];
    expect(injuryDaysFactor(c)).toBeCloseTo(0.64, 5);
    c.staff = [roleOf("fitness", 20)];
    expect(injuryFactor(c)).toBeCloseTo(0.76, 5); // clamped
    expect(recoveryBonus(c)).toBeCloseTo(0.12, 5); // clamped
    // applyStaffRecovery tops up condition, capped at 1
    c.staff = [roleOf("fitness", 18)];
    for (const p of c.squad) p.condition = 0.5;
    applyStaffRecovery(c);
    for (const p of c.squad) expect(p.condition).toBeCloseTo(0.6, 5);
    applyStaffRecovery(c, 0.5);
    for (const p of c.squad) expect(p.condition).toBeCloseTo(0.65, 5);
    for (const p of c.squad) p.condition = 0.98;
    applyStaffRecovery(c);
    for (const p of c.squad) expect(p.condition).toBe(1);
  });
});

describe("coaching staff — market", () => {
  it("the market holds 8..12 free coaches and is redrawn per window", () => {
    const s = newGame(58);
    const pool = ensureStaffMarket(s);
    expect(pool.length).toBeGreaterThanOrEqual(STAFF_MARKET_MIN);
    expect(pool.length).toBeLessThanOrEqual(STAFF_MARKET_MAX);
    for (const role of STAFF_ROLES) expect(pool.some((m) => m.role === role)).toBe(true);
    const ids = pool.map((m) => m.id);
    const t = newGame(58);
    expect(ensureStaffMarket(t).map((m) => m.id)).toEqual(ids);
    s.round = 10;
    refreshStaffMarket(s);
    expect(s.staffMarket!.map((m) => m.id)).not.toEqual(ids);
    expect(new Set(s.staffMarket!.map((m) => m.id)).size).toBe(s.staffMarket!.length);
  });

  it("hiring costs a season's wage, needs the budget, and respects the role and size limits; firing pays half the remaining contract", () => {
    const s = newGame(59);
    const me = s.clubs[s.userClub]!;
    me.budget = 100;
    const pool = ensureStaffMarket(s);
    const scout = pool.find((m) => m.role === "scout")!;
    const fee = staffSigningFee(scout);
    expect(hireStaff(s, "nope")).toMatch(/찾을 수 없/);
    me.budget = fee - 0.1;
    expect(hireStaff(s, scout.id)).toMatch(/계약금 부족/);
    me.budget = 100;
    expect(hireStaff(s, scout.id)).toBeNull();
    expect(me.budget).toBeCloseTo(100 - fee, 5);
    expect(me.staff).toContain(scout);
    expect(s.staffMarket).not.toContain(scout);
    expect(scout.contractUntil).toBe(s.season + 2);
    expect(s.news[0]).toContain("스카우트");
    // a second scout is refused (one per role); a second assistant is fine, a third is not
    s.staffMarket!.push(roleOf("scout", 10, 1, "extra-scout"), roleOf("assistant", 10, 1, "a2"), roleOf("assistant", 10, 1, "a3"));
    expect(hireStaff(s, "extra-scout")).toMatch(/자리가 없/);
    expect(hireStaff(s, "a2")).toBeNull();
    expect(hireStaff(s, "a3")).toMatch(/자리가 없/);
    // the roster cap
    me.staff = STAFF_ROLES.map((r, i) => roleOf(r, 10, 1, `full-${i}`)).concat([roleOf("assistant", 10, 1, "full-a"), roleOf("assistant", 9, 1, "full-b")]);
    expect(me.staff.length).toBe(MAX_STAFF);
    s.staffMarket!.push(roleOf("physio", 10, 1, "p2"));
    expect(hireStaff(s, "p2")).toMatch(/정원/);
    // firing
    const victim = me.staff[0]!;
    victim.contractUntil = s.season + 1;
    const sev = staffSeverance(s, victim);
    expect(sev).toBeCloseTo(Math.round(victim.wage * 2 * 0.5 * 10) / 10, 5);
    me.budget = 0;
    expect(fireStaff(s, victim.id)).toMatch(/위약금 부족/);
    me.budget = 10;
    expect(fireStaff(s, victim.id)).toBeNull();
    expect(me.staff).not.toContain(victim);
    expect(me.budget).toBeCloseTo(10 - sev, 5);
    expect(fireStaff(s, victim.id)).toMatch(/찾을 수 없/);
  });

  it("AI clubs fill a missing role from the market when the budget allows (staffWeek runs inside the weekly market)", () => {
    const s = newGame(60);
    const ai = s.clubs.find((c) => c.id !== s.userClub)!;
    ai.staff = [roleOf("assistant", 10)];
    ai.budget = 200;
    const pool = ensureStaffMarket(s);
    const bestFitness = [...pool].filter((m) => m.role === "fitness").sort((a, b) => b.rating - a.rating)[0]!;
    const hire = aiHireStaff(s, ai);
    expect(hire).toBe(bestFitness);
    expect(ai.staff).toContain(bestFitness);
    expect(ai.budget).toBeCloseTo(200 - staffSigningFee(bestFitness), 5);
    // broke clubs do not hire
    const poor = s.clubs.find((c) => c.id !== s.userClub && c !== ai)!;
    poor.staff = [];
    poor.budget = 5;
    expect(aiHireStaff(s, poor)).toBeNull();
    // the weekly tick hires for every AI club with a hole, never for the user
    const me = s.clubs[s.userClub]!;
    const mine = me.staff.length;
    for (const c of s.clubs) c.budget = 300;
    const before = s.clubs.map((c) => c.staff.length);
    staffWeek(s);
    s.clubs.forEach((c, i) => {
      if (c.id === s.userClub) expect(c.staff.length).toBe(mine);
      else if (c.staff.length < STAFF_ROLES.length && before[i]! < STAFF_ROLES.length) expect(c.staff.length).toBeGreaterThanOrEqual(before[i]!);
    });
    // a full season of weeks: nobody ends up with two of a single role or more than the cap
    for (let r = 0; r < 6; r++) staffWeek(s);
    for (const c of s.clubs) {
      expect(c.staff.length).toBeLessThanOrEqual(MAX_STAFF);
      for (const role of STAFF_ROLES) expect(c.staff.filter((m) => m.role === role).length).toBeLessThanOrEqual(MAX_PER_ROLE[role]);
    }
  });

  it("the weekly wage bill includes the staff", () => {
    const s = newGame(61);
    const me = s.clubs[s.userClub]!;
    me.staff = [roleOf("assistant", 16), roleOf("fitness", 12)];
    expect(staffWageBill(me)).toBeCloseTo(staffWage(16) + staffWage(12), 5);
    const weeks = seasonRounds(s);
    me.budget = 100; me.seasonWages = 0;
    payWages(s, weeks);
    expect(me.budget).toBeCloseTo(100 + weeklyRevenue(me, null) - (wageBill(me) + staffWageBill(me)) / weeks, 1);
    expect(me.seasonWages).toBeCloseTo(wageBill(me) / weeks, 2);
    expect(me.seasonStaffWages).toBeCloseTo(staffWageBill(me) / weeks, 2);
    // and the real week pays it too
    const t = newGame(61);
    const you = t.clubs[t.userClub]!;
    you.staff = [roleOf("assistant", 16), roleOf("fitness", 12)];
    simulateRound(t, { halfLength: 60 });
    advanceRound(t);
    expect(you.seasonStaffWages).toBeCloseTo(staffWageBill(you) / weeks, 2);
  });
});

describe("coaching staff — rollover and migration", () => {
  it("contracts expire at the rollover: the user's coach leaves with a news line unless renewed, AI clubs keep anyone rated ≥ 8", () => {
    const s = newGame(62);
    const me = s.clubs[s.userClub]!;
    me.budget = 500;
    const [keep, go] = me.staff as [StaffMember, StaffMember];
    expect(expiringStaff(s)).toContain(keep);
    expect(renewStaff(s, keep.id, 2)).toBeNull();
    expect(keep.contractUntil).toBe(3);
    expect(expiringStaff(s)).not.toContain(keep);
    const ai = s.clubs.find((c) => c.id !== s.userClub)!;
    ai.staff = [roleOf("assistant", AI_RENEW_RATING, 1, "ai-keep"), roleOf("physio", AI_RENEW_RATING - 2, 1, "ai-go"), roleOf("scout", 15, 3, "ai-stay")];
    const ages = new Map(s.clubs.flatMap((c) => c.staff.map((m) => [m.id, m.age] as const)));
    finishSeason(s);
    startNextSeason(s);
    expect(s.season).toBe(2);
    expect(s.staffSeason).toBe(2);
    expect(me.staff).toContain(keep);
    expect(me.staff).not.toContain(go);
    expect(s.news.some((n) => n.includes("코치 계약 만료") && n.includes(go.name))).toBe(true);
    expect(ai.staff.map((m) => m.id)).toContain("ai-keep");
    expect(ai.staff.map((m) => m.id)).toContain("ai-stay");
    expect(ai.staff.map((m) => m.id)).not.toContain("ai-go");
    expect(ai.staff.find((m) => m.id === "ai-keep")!.contractUntil).toBe(3);
    for (const c of s.clubs) for (const m of c.staff) if (ages.has(m.id)) expect(m.age).toBe(ages.get(m.id)! + 1);
    // idempotent: calling it again for the same season changes nothing
    const snapshot = JSON.stringify(s.clubs.map((c) => c.staff));
    staffRollover(s);
    expect(JSON.stringify(s.clubs.map((c) => c.staff))).toBe(snapshot);
    // an explicit rollover for a later season is the documented call site and works the same
    finishSeason(s);
    ai.staff.push(roleOf("gk", 3, 2, "ai-weak"));
    startNextSeason(s);
    expect(ai.staff.map((m) => m.id)).not.toContain("ai-weak");
    expect(s.staffSeason).toBe(3);
    expect(s.staffMarketKey).toBe("3:pre");
  });

  it("ratings drift over the years and the old retire", () => {
    const s = newGame(63);
    const ai = s.clubs.find((c) => c.id !== s.userClub)!;
    ai.staff = [roleOf("assistant", 10, 9, "young"), roleOf("physio", 10, 9, "old"), roleOf("scout", 10, 9, "retiring")];
    ai.staff[0]!.age = 30; ai.staff[1]!.age = 62; ai.staff[2]!.age = 65;
    for (let i = 0; i < 6; i++) { finishSeason(s); startNextSeason(s); }
    const young = ai.staff.find((m) => m.id === "young")!, old = ai.staff.find((m) => m.id === "old");
    expect(young.rating).toBeGreaterThanOrEqual(10);
    expect(young.age).toBe(36);
    if (old) expect(old.rating).toBeLessThanOrEqual(10);
    expect(ai.staff.some((m) => m.id === "retiring")).toBe(false);
  });

  it("migration: a save without staff gets generated staff, a market and the rollover marker", () => {
    const s = newGame(64);
    const old = JSON.parse(serialize(s)) as Record<string, unknown>;
    for (const c of old.clubs as Record<string, unknown>[]) delete c.staff;
    delete old.staffMarket; delete old.staffMarketKey; delete old.staffSeason;
    const mig = deserialize(JSON.stringify(old))!;
    for (const c of mig.clubs) {
      expect(Array.isArray(c.staff)).toBe(true);
      if (c.id === mig.userClub) expect(c.staff.map((m) => m.role).sort()).toEqual(["assistant", "fitness", "physio"]);
      else expect(c.staff.length).toBeGreaterThanOrEqual(3);
      for (const m of c.staff) { expect(m.rating).toBeGreaterThanOrEqual(4); expect(m.rating).toBeLessThanOrEqual(19); }
    }
    expect(mig.staffMarket!.length).toBeGreaterThanOrEqual(STAFF_MARKET_MIN);
    expect(mig.staffSeason).toBe(mig.season);
    // a save that already has staff keeps it untouched
    const again = deserialize(serialize(s))!;
    expect(again.clubs.map((c) => c.staff)).toEqual(s.clubs.map((c) => c.staff));
    migrateStaff(again);
    expect(again.clubs.map((c) => c.staff)).toEqual(s.clubs.map((c) => c.staff));
    expect(staffRating(again.clubs[0]!, "assistant")).toBeGreaterThan(0);
  });
});
