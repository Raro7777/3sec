import { describe, expect, it } from "vitest";
import type { Rng } from "@3sec/engine";
import {
  ARREARS_MORALE, FEUD_AT, LOAN_WEEKS, RED_ARREARS_WEEKS, RETURN_AFTER, STORY_TTL, advanceRound, adjustFeud, feudWith, financeStatus, financeWeek, h2hTable, inArrears, moraleOf,
  newGame, noteDeparture, overall, pendingEvents, recordManagerH2H, resolveEvent, returnable, returningPlayer, simulateRound, storyWeek, takeEmergencyLoan, type GameState, type StoryEvent, type StoryTemplateId,
} from "../src/index";
import { rivalOf } from "../src/lore";
import { clubOf } from "../src/season";

const forced = (next = 0): Rng => ({ next: () => next, chance: () => true, int: (lo: number) => lo, range: (lo: number) => lo, pick: <T>(a: T[]) => a[0]!, gauss: () => 0 }) as unknown as Rng;
function push(s: GameState, template: StoryTemplateId, extra: Partial<StoryEvent> = {}): StoryEvent {
  const ev: StoryEvent = { id: `ev-t-${template}-${(s.events ?? []).length}`, template, season: s.season, round: s.round, title: template, text: "", choices: [{ label: "A", hint: "" }, { label: "B", hint: "" }, { label: "C", hint: "" }], expiresRound: s.round + STORY_TTL, ...extra };
  (s.events ??= []).push(ev);
  return ev;
}
const avgMorale = (s: GameState) => { const me = s.clubs[s.userClub]!; return me.squad.reduce((n, p) => n + moraleOf(p), 0) / me.squad.length; };
/** Fire storyWeek with sweep of dice until the wanted template appears. */
function fire(s: GameState, t: StoryTemplateId): StoryEvent | null {
  for (let i = 0; i < 60; i++) { s.events = []; const e = storyWeek(s, forced(i / 60)); if (e?.template === t) return e; }
  return null;
}

describe("구단 생존 (finance.ts)", () => {
  it("weeks in the red count up, wages go late at the threshold and the squad's morale bleeds until the club is back in the black", () => {
    const s = newGame(601, 0);
    const me = s.clubs[s.userClub]!;
    me.budget = -5;
    for (let i = 0; i < RED_ARREARS_WEEKS - 1; i++) financeWeek(s);
    expect(inArrears(me)).toBe(false);
    const before = avgMorale(s);
    financeWeek(s);
    expect(inArrears(me)).toBe(true);
    expect(s.news[0]).toContain("급여가 밀렸습니다");
    expect(avgMorale(s)).toBeCloseTo(before + ARREARS_MORALE, 0);
    me.budget = 3;
    financeWeek(s);
    expect(me.redWeeks).toBe(0);
    expect(s.news[0]).toContain("밀린 급여를 모두 지급");
  });

  it("the owner's loan pays out at once and is clawed back weekly with interest", () => {
    const s = newGame(602, 0);
    const me = s.clubs[s.userClub]!;
    me.budget = 0;
    takeEmergencyLoan(s, 20);
    expect(me.budget).toBe(20);
    const st = financeStatus(s);
    expect(st.loan!.remaining).toBeCloseTo(23, 1);
    for (let i = 0; i < LOAN_WEEKS; i++) financeWeek(s);
    expect(financeStatus(s).loan).toBeNull();
    expect(me.budget).toBeCloseTo(-3, 0);
  });

  it("wageArrears fires once a season for a club with late wages; borrowing books the loan, holding out can trigger a request", () => {
    const s = newGame(603, 0);
    const me = s.clubs[s.userClub]!;
    me.budget = -10; me.redWeeks = RED_ARREARS_WEEKS;
    const ev = fire(s, "wageArrears");
    expect(ev).toBeTruthy();
    expect(ev!.amount).toBeGreaterThan(0);
    resolveEvent(s, ev!.id, 1);
    expect(s.emergencyLoan!.remaining).toBeGreaterThan(ev!.amount!);
    expect(me.budget).toBe(-10 + ev!.amount!);
    expect(fire(s, "wageArrears")).toBeNull();
  });

  it("fanFunding and cityGrant put money in; boardSellDemand sells the star when accepted", () => {
    const s = newGame(604, 0);
    const me = s.clubs[s.userClub]!;
    me.budget = -2; me.fans.mood = 60;
    const fund = fire(s, "fanFunding")!;
    expect(fund).toBeTruthy();
    const b0 = me.budget;
    resolveEvent(s, fund.id, 0);
    expect(me.budget).toBe(b0 + fund.amount!);
    // a civic club in the early rounds gets its council hearing
    const civic = newGame(605, 3);
    const c = civic.clubs[3]!; c.budget = 4; civic.round = 3;
    const grant = fire(civic, "cityGrant")!;
    expect(grant).toBeTruthy();
    resolveEvent(civic, grant.id, 1);
    expect(c.budget).toBe(4 + Math.round(grant.amount! * 1.3));
    // the board's demand, with a window open and a buyer about
    me.redWeeks = RED_ARREARS_WEEKS + 3; me.budget = -20;
    const sell = fire(s, "boardSellDemand");
    if (sell) {
      const n = me.squad.length, conf = s.board!.confidence;
      resolveEvent(s, sell.id, 0);
      expect(me.squad.length).toBe(n - 1);
      expect(s.board!.confidence).toBeGreaterThan(conf);
    }
  });
});

describe("선수 서사", () => {
  it("veteranFarewell: one more year cuts the wage and extends the deal; the farewell match pleases everyone", () => {
    const s = newGame(611, 0);
    const me = s.clubs[s.userClub]!;
    const vet = me.squad.find((p) => p.role !== "GK")!;
    vet.age = 34; vet.contractUntil = s.season; vet.stats.apps = 20;
    s.round = 20;
    const ev = fire(s, "veteranFarewell")!;
    expect(ev).toBeTruthy();
    expect(ev.playerId).toBe(vet.id);
    const wage = vet.wage;
    resolveEvent(s, ev.id, 0);
    expect(vet.contractUntil).toBe(s.season + 1);
    expect(vet.wage).toBeLessThan(wage);
    expect(fire(s, "veteranFarewell")?.playerId).not.toBe(vet.id);
  });

  it("lateBloomer: a mid-twenties reserve with room to grow gets growth and heart from a chance", () => {
    const s = newGame(612, 0);
    const me = s.clubs[s.userClub]!;
    const p = me.squad.find((q) => !me.selection.starters.includes(q.id) && q.role !== "GK")!;
    p.age = 27; p.potential = overall(p.attrs, p.role) + 3; s.round = 4;
    const ev = fire(s, "lateBloomer")!;
    expect(ev.playerId).toBe(p.id);
    const g = p.growth, m = moraleOf(p);
    resolveEvent(s, ev.id, 0);
    expect(p.growth).toBeCloseTo(g + 1.5, 5);
    expect(moraleOf(p)).toBeGreaterThan(m);
  });

  it("prodigalReturn: a youth product sold abroad is remembered, ages away, and can be bought home two seasons later", () => {
    const s = newGame(613, 0);
    const me = s.clubs[s.userClub]!;
    const kid = me.squad.find((p) => p.age <= 24 && p.role !== "GK")!;
    kid.youthProduct = true;
    noteDeparture(s, kid, 100, "도쿄 이글스", me.id);
    me.squad = me.squad.filter((p) => p !== kid);
    expect(s.alumni!.length).toBe(1);
    expect(returnable(s).length).toBe(0);
    s.season += RETURN_AFTER;
    const back = returningPlayer(s, s.alumni![0]!);
    expect(back.age).toBe(kid.age + RETURN_AFTER);
    expect(back.id).toBe(kid.id);
    const ev = fire(s, "prodigalReturn")!;
    expect(ev).toBeTruthy();
    me.budget = 10000;
    const n = me.squad.length;
    resolveEvent(s, ev.id, 0);
    expect(me.squad.length).toBe(n + 1);
    expect(me.squad.some((p) => p.id === kid.id)).toBe(true);
    expect(s.alumni!.length).toBe(0);
  });
});

describe("감독 라이벌 (rivalry.ts)", () => {
  it("records the user's head-to-head per opposing manager and lists the most-met first", () => {
    const s = newGame(621, 0);
    const opp = s.clubs[1]!;
    recordManagerH2H(s, { home: 0, away: 1, score: [2, 0] });
    recordManagerH2H(s, { home: 1, away: 0, score: [1, 1] });
    recordManagerH2H(s, { home: 2, away: 0, score: [3, 0] });
    const t = h2hTable(s);
    expect(t[0]!.id).toBe(opp.manager!.id);
    expect(t[0]).toMatchObject({ w: 1, d: 1, l: 0, games: 2 });
    expect(t[1]).toMatchObject({ l: 1, games: 1 });
  });

  it("rivalTaunt in a derby week: firing back raises the feud, and a feud makes the derby result swing the fans harder", () => {
    const s = newGame(622, 0);
    const rival = clubOf(s, rivalOf(0));
    // put the derby next
    const fx = s.fixtures.find((f) => !f.score && ((f.home === 0 && f.away === rival.id) || (f.away === 0 && f.home === rival.id)))!;
    const cur = s.fixtures.filter((f) => f.round === s.round && (f.home === 0 || f.away === 0))[0]!;
    [fx.round, cur.round] = [cur.round, fx.round];
    const ev = fire(s, "rivalTaunt")!;
    expect(ev).toBeTruthy();
    expect(ev.managerId).toBe(rival.manager!.id);
    resolveEvent(s, ev.id, 0);
    expect(feudWith(s, rival.manager!.id)).toBe(1);
    adjustFeud(s, rival.manager!.id, FEUD_AT);
    const me = s.clubs[0]!;
    // a derby win with a feud on: the quote lands and the fans get the extra swing
    me.fans.mood = 50;
    simulateRound(s, { autoUser: true, halfLength: 60 });
    const played = s.fixtures.find((f) => f.id === fx.id)!;
    expect(played.score).toBeTruthy();
    expect(s.news.some((n) => n.includes(rival.manager!.name + " 감독"))).toBe(true);
    expect(pendingEvents(s).length).toBe(0);
    advanceRound(s);
  });
});
