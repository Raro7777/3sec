import { describe, expect, it } from "vitest";
import { FORMATIONS } from "@3sec/engine";
import {
  advanceRound, autoSelect, buildFixtures, createMatch, currentFixtures, deserialize, newGame, playerOf, recordResult,
  roundsPerSeason, selectionProblem, serialize, simulateRound, startNextSeason, swap, table, repairSelection, yellowBan, homeAwayRecord, financeSummary, cupPrize, seasonBudget, weeklyRevenue, wageBill, staffWageBill, CLUBS_PER_DIVISION, DIVISIONS, clubsIn } from "../src/index";

const SHORT = { halfLength: 4 * 60 };

describe("fixtures", () => {
  it("double round robin: every pair meets twice, once at each ground, one game per club per round", () => {
    const n = 12;
    const fx = buildFixtures(n);
    expect(fx.length).toBe(n * (n - 1));
    const seen = new Map<string, number>();
    for (const f of fx) seen.set(`${f.home}-${f.away}`, (seen.get(`${f.home}-${f.away}`) ?? 0) + 1);
    for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) if (a !== b) expect(seen.get(`${a}-${b}`)).toBe(1);
    for (let r = 0; r < roundsPerSeason(n); r++) {
      const clubs = fx.filter((f) => f.round === r).flatMap((f) => [f.home, f.away]);
      expect(new Set(clubs).size).toBe(n);
    }
    const homeGames = Array.from({ length: n }, (_, c) => fx.filter((f) => f.home === c).length);
    expect(homeGames.every((h) => h === n - 1)).toBe(true);
  });
});

describe("world and selection", () => {
  it("builds two divisions of 12 clubs of 20 with a legal XI and bench each", () => {
    const s = newGame(1);
    expect(s.clubs.length).toBe(CLUBS_PER_DIVISION * DIVISIONS);
    for (let d = 1; d <= DIVISIONS; d++) expect(clubsIn(s, d).length).toBe(CLUBS_PER_DIVISION);
    for (const c of s.clubs) {
      expect(c.squad.length).toBe(20);
      expect(selectionProblem(c)).toBeNull();
      expect(c.selection.starters.length).toBe(FORMATIONS[c.selection.formation].length);
      expect(playerOf(c, c.selection.starters[0]!).role).toBe("GK");
      expect(c.selection.bench.length).toBe(7);
    }
  });

  it("is deterministic for a seed", () => {
    const a = newGame(5), b = newGame(5);
    expect(serialize(a)).toBe(serialize(b));
  });

  it("swap moves players between starters, bench and reserves; repair replaces the unavailable", () => {
    const s = newGame(2);
    const c = s.clubs[0]!;
    const st = c.selection.starters[9]!;
    const reserve = c.squad.find((p) => !c.selection.starters.includes(p.id) && !c.selection.bench.includes(p.id))!;
    c.selection = swap(c, st, reserve.id);
    expect(c.selection.starters[9]).toBe(reserve.id);
    expect(c.selection.starters.includes(st)).toBe(false);
    playerOf(c, reserve.id).injuryDays = 10;
    expect(selectionProblem(c)).toMatch(/부상/);
    c.selection = repairSelection(c);
    expect(selectionProblem(c)).toBeNull();
    expect(c.selection.starters.includes(reserve.id)).toBe(false);
  });

  it("autoSelect never fields injured or banned players", () => {
    const s = newGame(3);
    const c = s.clubs[1]!;
    for (const p of c.squad.slice(0, 5)) p.ban = 1;
    const sel = autoSelect(c);
    for (const id of [...sel.starters, ...sel.bench]) expect(playerOf(c, id).ban).toBe(0);
  });
});

describe("season progression", () => {
  it("plays a round, updates the table consistently, then advances", () => {
    const s = newGame(7);
    simulateRound(s, SHORT);
    expect(currentFixtures(s).every((f) => f.score)).toBe(true);
    const t = table(s);
    expect(t.reduce((a, r) => a + r.played, 0)).toBe(12);
    expect(t.reduce((a, r) => a + r.gf, 0)).toBe(t.reduce((a, r) => a + r.ga, 0));
    expect(t[0]!.pts).toBeGreaterThanOrEqual(t[11]!.pts);
    expect(advanceRound(s)).toBe(true);
    expect(s.round).toBe(1);
  });

  it("records appearances, minutes, carried fatigue and recovers over the week", () => {
    const s = newGame(8);
    const f = currentFixtures(s)[0]!;
    const m = createMatch(s, f, SHORT);
    m.runToEnd();
    recordResult(s, f, m);
    const home = s.clubs[f.home]!;
    const starters = home.selection.starters.map((id) => playerOf(home, id));
    expect(starters.every((p) => p.stats.apps === 1)).toBe(true);
    expect(starters.some((p) => p.condition < 1)).toBe(true);
    expect(f.scorers.length).toBe(f.score![0] + f.score![1]);
    for (const g of currentFixtures(s)) if (!g.score) { const mm = createMatch(s, g, SHORT); mm.runToEnd(); recordResult(s, g, mm); }
    advanceRound(s);
    expect(starters.every((p) => p.condition === 1)).toBe(true);
  });

  it("same seed replays the same results and survives a save round-trip", () => {
    const a = newGame(9), b = newGame(9);
    simulateRound(a, SHORT);
    simulateRound(b, SHORT);
    expect(currentFixtures(a).map((f) => f.score)).toEqual(currentFixtures(b).map((f) => f.score));
    const c = deserialize(serialize(a))!;
    expect(c).not.toBeNull();
    // deserialize normalises older shapes (tactics fields), so compare after one normalising pass
    expect(serialize(deserialize(serialize(c))!)).toBe(serialize(c));
    expect(c.clubs.length).toBe(a.clubs.length);
    expect(currentFixtures(c).map((f) => f.score)).toEqual(currentFixtures(a).map((f) => f.score));
    expect(deserialize("garbage")).toBeNull();
  });

  it("rolls into a new season with ages and fresh fixtures, and files the season in the history", () => {
    const s = newGame(10);
    const age = s.clubs[0]!.squad[0]!.age;
    simulateRound(s, SHORT);
    const rows = table(s);
    const me = s.clubs[s.userClub]!;
    me.seasonInjuries = 4;
    s.round = roundsPerSeason(12);
    startNextSeason(s);
    expect(s.season).toBe(2);
    expect(s.round).toBe(0);
    expect(s.clubs[0]!.squad[0]!.age).toBe(age + 1);
    expect(s.fixtures.every((f) => !f.score)).toBe(true);
    expect(s.clubs.every((c) => selectionProblem(c) === null)).toBe(true);
    expect(s.seasonHistory).toMatchObject([{ season: 1, champion: rows[0]!.club, cupWinner: null, userPosition: rows.findIndex((r) => r.club === s.userClub) + 1, userPts: rows.find((r) => r.club === s.userClub)!.pts }]);
    expect(s.seasonHistory[0]!.managerOfYear).toBeTruthy();
    for (const c of s.clubs) { expect(c.seasonInjuries).toBe(0); expect(c.seasonWages).toBe(0); expect(c.seasonRevenue).toBe(0); expect(c.seasonStartBudget).toBe(c.budget); }
  });

  it("splits the league record by venue and summarises the season's money", () => {
    const s = newGame(11);
    simulateRound(s, SHORT);
    advanceRound(s);
    simulateRound(s, SHORT);
    advanceRound(s);
    const me = s.clubs[s.userClub]!;
    const rec = homeAwayRecord(s, me.id);
    const row = table(s).find((r) => r.club === me.id)!;
    expect(rec.home.won + rec.home.drawn + rec.home.lost).toBe(1);
    expect(rec.away.won + rec.away.drawn + rec.away.lost).toBe(1);
    expect(rec.home.won + rec.away.won).toBe(row.won);
    expect(rec.home.lost + rec.away.lost).toBe(row.lost);
    const fin = financeSummary(s, me.id);
    expect(fin.start).toBe(me.seasonStartBudget);
    expect(fin.end).toBe(me.budget);
    expect(fin.wages).toBeGreaterThan(0);
    expect(fin.revenue).toBeGreaterThan(0);
    expect(fin.cupPrize).toBe(cupPrize(s, me.id));
    const pos = table(s).findIndex((r) => r.club === me.id) + 1;
    expect(fin.leaguePrize).toBe(seasonBudget(me.reputation, pos) - seasonBudget(me.reputation, null));
    // a save without the counters falls back to the estimates
    me.seasonWages = 0; me.seasonRevenue = 0;
    const est = financeSummary(s, me.id);
    expect(est.wages).toBeCloseTo(wageBill(me) + staffWageBill(me), 1);
    expect(est.revenue).toBeCloseTo(weeklyRevenue(me, pos) * roundsPerSeason(12), 1);
  });
});

describe("discipline", () => {
  it("yellow cards suspend at 5 (1 match), 10 (1 match) and 15 (2 matches) — nothing in between", () => {
    const bans = Array.from({ length: 21 }, (_, n) => yellowBan(n));
    expect(bans[5]).toBe(1);
    expect(bans[10]).toBe(1);
    expect(bans[15]).toBe(2);
    expect(bans[20]).toBe(2);
    for (const n of [0, 1, 4, 6, 9, 11, 14, 16]) expect(bans[n]).toBe(0);
  });
});

describe("onboarding", () => {
  it("newGame takes the user's club and manager name; the user's side is human-managed", () => {
    const s = newGame(1, 7, "홍길동");
    expect(s.userClub).toBe(7);
    expect(s.managerName).toBe("홍길동");
    expect(s.news.some((n) => n.includes("홍길동"))).toBe(true);
    const f = currentFixtures(s).find((x) => x.home === 7 || x.away === 7)!;
    const m = createMatch(s, f, SHORT);
    const userSide = f.home === 7 ? 0 : 1;
    expect(m.aiManaged.has(userSide as 0 | 1)).toBe(false);
    expect(m.aiManaged.has((1 - userSide) as 0 | 1)).toBe(true);
    // No name / blank name falls back to the default.
    expect(newGame(1, 3).managerName).toBe("감독");
    expect(newGame(1, 3, "   ").managerName).toBe("감독");
  });

  it("serializes the manager name and defaults it for old saves", () => {
    const s = newGame(1, 7, "홍길동");
    expect(deserialize(serialize(s))!.managerName).toBe("홍길동");
    const old = JSON.parse(serialize(newGame(2, 4))) as Record<string, unknown>;
    delete old.managerName;
    const back = deserialize(JSON.stringify(old))!;
    expect(back.managerName).toBe("감독");
    expect(back.userClub).toBe(4);
  });
});
