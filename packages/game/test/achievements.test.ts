import { describe, expect, it } from "vitest";
import type { Match } from "@3sec/engine";
import {
  ACHIEVEMENTS, achievementById, achievementsAfterMatch, advanceRound, deserialize, hallOfFame, hasAchievement, newGame, promoteProspect, seasonRounds,
  seasonCleanSheets, serialize, simulateRound, startNextSeason, takeFreshAchievements, table, type GameState,
} from "../src/index";

const SHORT = { halfLength: 4 * 60 };

/** A finished match with just the goal events needed for the comeback check. */
function fakeMatch(events: { type: "GOAL" | "OWN_GOAL"; team: 0 | 1 }[]): Match {
  return { state: { phase: "FULL_TIME", events } } as unknown as Match;
}

/** Award every fixture of the round: the user's club wins (or loses) by `[gf, ga]`, everyone else draws. */
function fixRound(s: GameState, round: number, mine: [number, number]): void {
  for (const f of s.fixtures.filter((x) => x.round === round)) {
    const involved = f.home === s.userClub || f.away === s.userClub;
    if (!involved) { f.score = [1, 1]; continue; }
    f.score = f.home === s.userClub ? [mine[0], mine[1]] : [mine[1], mine[0]];
  }
}

describe("achievement definitions", () => {
  it("has at least 20 unique achievements with Korean titles and a tier", () => {
    expect(ACHIEVEMENTS.length).toBeGreaterThanOrEqual(20);
    expect(new Set(ACHIEVEMENTS.map((a) => a.id)).size).toBe(ACHIEVEMENTS.length);
    for (const a of ACHIEVEMENTS) {
      expect(/[가-힣]/.test(a.title)).toBe(true);
      expect(/[가-힣]/.test(a.desc)).toBe(true);
      expect(["bronze", "silver", "gold"]).toContain(a.tier);
    }
    expect(achievementById("league_title")?.tier).toBe("gold");
  });

  it("a new game starts with empty counters, no unlocks and the budget as the season minimum", () => {
    const s = newGame(11, 10);
    expect(s.achievements).toEqual([]);
    expect(s.freshAchievements).toEqual([]);
    expect(s.records!.wins).toBe(0);
    expect(s.records!.seasonsInCharge).toBe(0);
    expect(s.seasonMinBudget).toBe(s.clubs[10]!.budget);
  });
});

describe("match counters", () => {
  it("counts wins, big wins, runs, clean sheets and comebacks from the user's matches only", () => {
    const s = newGame(12, 3);
    const mine = s.fixtures.find((f) => f.round === 0 && f.home === 3)! ?? s.fixtures.find((f) => f.round === 0 && f.away === 3)!;
    const home = mine.home === 3;
    mine.score = home ? [3, 0] : [0, 3];
    const earned = achievementsAfterMatch(s, mine, fakeMatch([]), false);
    expect(earned).toEqual(expect.arrayContaining(["first_win", "big_win"]));
    const r = s.records!;
    expect(r.wins).toBe(1);
    expect(r.bigWins).toBe(1);
    expect(r.unbeaten).toBe(1);
    expect(r.cleanSheets).toBe(1);
    expect(r.comebacks).toBe(0);
    expect(r.biggestWin?.score).toEqual([3, 0]);
    expect(s.freshAchievements).toEqual(expect.arrayContaining(["first_win", "big_win"]));
    expect(s.news[0]).toMatch(/^🏅 업적 달성/);
    // someone else's match changes nothing
    const other = s.fixtures.find((f) => f.round === 0 && f.home !== 3 && f.away !== 3)!;
    other.score = [4, 0];
    expect(achievementsAfterMatch(s, other, fakeMatch([]), false)).toEqual([]);
    expect(r.wins).toBe(1);
    // a comeback: the opponent scores first, the user wins 2-1
    const r1 = s.fixtures.find((f) => f.round === 1 && (f.home === 3 || f.away === 3))!;
    const me: 0 | 1 = r1.home === 3 ? 0 : 1, opp: 0 | 1 = me === 0 ? 1 : 0;
    r1.score = me === 0 ? [2, 1] : [1, 2];
    achievementsAfterMatch(s, r1, fakeMatch([{ type: "GOAL", team: opp }, { type: "GOAL", team: me }, { type: "GOAL", team: me }]), false);
    expect(r.comebacks).toBe(1);
    expect(r.wins).toBe(2);
    expect(r.unbeaten).toBe(2);
    expect(r.cleanSheets).toBe(0);
    // a defeat ends the run; the best run stays
    const r2 = s.fixtures.find((f) => f.round === 2 && (f.home === 3 || f.away === 3))!;
    r2.score = r2.home === 3 ? [0, 1] : [1, 0];
    achievementsAfterMatch(s, r2, fakeMatch([{ type: "GOAL", team: r2.home === 3 ? 1 : 0 }]), false);
    expect(r.unbeaten).toBe(0);
    expect(r.bestUnbeaten).toBe(2);
    // unlocks are not repeated
    expect(s.achievements!.filter((a) => a.id === "first_win").length).toBe(1);
  });

  it("runs from recordResult: wins on the counter match the fixtures", () => {
    const s = newGame(13, 5);
    for (let i = 0; i < 4; i++) { simulateRound(s, SHORT); advanceRound(s); }
    let wins = 0;
    for (const f of s.fixtures) {
      if (!f.score || (f.home !== 5 && f.away !== 5)) continue;
      const [gf, ga] = f.home === 5 ? f.score : [f.score[1], f.score[0]];
      if (gf > ga) wins++;
    }
    expect(s.records!.wins).toBe(wins);
    if (wins > 0) expect(hasAchievement(s, "first_win")).toBe(true);
    expect(s.seasonMinBudget).toBeLessThanOrEqual(s.clubs[5]!.budget);
  });

  it("takeFreshAchievements hands the new ids over once", () => {
    const s = newGame(14, 2);
    const f = s.fixtures.find((x) => x.round === 0 && (x.home === 2 || x.away === 2))!;
    f.score = f.home === 2 ? [1, 0] : [0, 1];
    achievementsAfterMatch(s, f, fakeMatch([]), false);
    expect(takeFreshAchievements(s)).toEqual(["first_win"]);
    expect(takeFreshAchievements(s)).toEqual([]);
  });
});

describe("season achievements and the hall of fame", () => {
  it("a perfect season by the weakest club unlocks the title, the unbeaten season, the home sweep, 60 goals and the underdog title", () => {
    const s = newGame(15, 10);
    const rounds = seasonRounds(s);
    for (let r = 0; r < rounds; r++) {
      fixRound(s, r, [3, 0]);
      for (const f of s.fixtures.filter((x) => x.round === r && (x.home === 10 || x.away === 10))) achievementsAfterMatch(s, f, fakeMatch([]), false);
      s.round++;
    }
    expect(table(s)[0]!.club).toBe(10);
    expect(seasonCleanSheets(s)).toBe(rounds);
    expect(hasAchievement(s, "league_title")).toBe(false);
    expect(hasAchievement(s, "goals_60")).toBe(true);
    expect(hasAchievement(s, "clean_sheets_8")).toBe(true);
    expect(hasAchievement(s, "unbeaten_10")).toBe(true);
    startNextSeason(s);
    for (const id of ["league_title", "season_unbeaten", "home_perfect", "underdog_title", "title_no_debt"]) expect(hasAchievement(s, id), id).toBe(true);
    expect(hasAchievement(s, "back_to_back")).toBe(false);
    expect(s.records!.seasonsInCharge).toBe(1);
    const last = s.achievements!.find((a) => a.id === "league_title")!;
    expect(last.season).toBe(1);
    expect(s.seasonHistory[0]!.userClub).toBe(10);
    const hof = hallOfFame(s);
    expect(hof.titles).toEqual([1]);
    expect(hof.cups).toEqual([]);
    expect(hof.bestPosition).toBe(1);
    expect(hof.total).toBe(ACHIEVEMENTS.length);
    expect(hof.earned[0]!.def.title).toBeTruthy();
    expect(hof.biggestWin?.score).toEqual([3, 0]);
    // a second title in a row
    for (let r = 0; r < rounds; r++) { fixRound(s, r, [2, 1]); s.round++; }
    startNextSeason(s);
    expect(hasAchievement(s, "back_to_back")).toBe(true);
    expect(hallOfFame(s).titles).toEqual([1, 2]);
  });

  it("promoted prospects are marked as youth products and counted", () => {
    const s = newGame(16, 4);
    const me = s.clubs[4]!;
    const p = me.youth.prospects[0]!;
    p.age = 17;
    expect(promoteProspect(s, p.id)).toBeNull();
    expect(me.squad.find((q) => q.id === p.id)?.youthProduct).toBe(true);
    expect(s.records!.promotedYouth).toBe(1);
  });

  it("old saves get empty counters and no unlocks", () => {
    const s = newGame(17, 1);
    const raw = JSON.parse(serialize(s)) as Record<string, unknown>;
    delete raw.records; delete raw.achievements; delete raw.freshAchievements; delete raw.seasonMinBudget;
    const back = deserialize(JSON.stringify(raw))!;
    expect(back.records!.wins).toBe(0);
    expect(back.achievements).toEqual([]);
    expect(back.freshAchievements).toEqual([]);
    expect(back.seasonMinBudget).toBe(back.clubs[1]!.budget);
  });
});
