import { describe, expect, it } from "vitest";
import {
  FORM_LENGTH, appendCareer, avgRating, currentFixtures, deserialize, matchRating, newGame, pushRating, serialize, simulateRound, startNextSeason,
  topAssists, topRatings, type RatingInput, type SquadPlayer,
} from "../src/index";

const SHORT = { halfLength: 4 * 60 };

const base = (over: Partial<RatingInput> = {}): RatingInput => ({
  goals: 0, ownGoals: 0, assists: 0, yellows: 0, reds: 0, minutes: 90, sub: false, role: "CM", cleanSheet: false, saves: 0, result: 0, ...over,
});

describe("match rating formula", () => {
  it("starts at 6.0 and moves by goals, own goals, assists, cards and the result", () => {
    expect(matchRating(base())).toBe(6);
    expect(matchRating(base({ goals: 1 }))).toBe(7);
    expect(matchRating(base({ goals: 2, result: 1 }))).toBe(8.3);
    expect(matchRating(base({ ownGoals: 1 }))).toBe(5);
    expect(matchRating(base({ assists: 1 }))).toBe(6.7);
    expect(matchRating(base({ assists: 2, goals: 1, result: 1 }))).toBe(8.7);
    expect(matchRating(base({ yellows: 1 }))).toBe(5.7);
    expect(matchRating(base({ reds: 1, result: -1 }))).toBe(4.7);
    expect(matchRating(base({ result: 1 }))).toBe(6.3);
    expect(matchRating(base({ result: -1 }))).toBe(5.7);
  });

  it("gives clean sheets to keepers and defenders only, and only from 60 minutes on", () => {
    expect(matchRating(base({ role: "CB", cleanSheet: true }))).toBe(6.4);
    expect(matchRating(base({ role: "LB", cleanSheet: true, result: 1 }))).toBe(6.7);
    expect(matchRating(base({ role: "GK", cleanSheet: true }))).toBe(6.4);
    expect(matchRating(base({ role: "CB", cleanSheet: true, minutes: 59 }))).toBe(6);
    expect(matchRating(base({ role: "ST", cleanSheet: true }))).toBe(6);
  });

  it("pays keepers 0.2 per save above three", () => {
    expect(matchRating(base({ role: "GK", saves: 3 }))).toBe(6);
    expect(matchRating(base({ role: "GK", saves: 6 }))).toBe(6.6);
    expect(matchRating(base({ role: "GK", saves: 6, cleanSheet: true, result: 1 }))).toBe(7.3);
    expect(matchRating(base({ role: "ST", saves: 9 }))).toBe(6);
  });

  it("pulls a short substitute appearance halfway back to 6.0 and clamps to 3..10", () => {
    expect(matchRating(base({ goals: 1, sub: true, minutes: 20 }))).toBe(6.5);
    expect(matchRating(base({ goals: 1, sub: true, minutes: 30 }))).toBe(7);
    expect(matchRating(base({ goals: 1, minutes: 20 }))).toBe(7);
    expect(matchRating(base({ reds: 1, ownGoals: 2, yellows: 1, result: -1 }))).toBe(3);
    expect(matchRating(base({ goals: 4, assists: 2, result: 1 }))).toBe(10);
  });
});

describe("form window and season totals", () => {
  it("keeps the last five ratings, oldest first, and accumulates the average", () => {
    const p = { stats: { apps: 0, goals: 0, minutes: 0, yellows: 0, reds: 0 } } as unknown as SquadPlayer;
    for (const r of [6, 7, 8, 5, 9, 6.5, 7.5]) pushRating(p, r);
    expect(p.form).toEqual([8, 5, 9, 6.5, 7.5]);
    expect(p.form!.length).toBe(FORM_LENGTH);
    expect(p.stats.ratedApps).toBe(7);
    expect(p.stats.ratingSum).toBe(49);
    expect(avgRating(p)).toBe(7);
  });
});

describe("ratings in a simulated round", () => {
  it("rates every player who played, names a man of the match per fixture and banks assists", () => {
    const s = newGame(5);
    simulateRound(s, SHORT);
    for (const f of currentFixtures(s)) {
      expect(f.motm).toBeTruthy();
      expect(f.motm!.rating).toBeGreaterThanOrEqual(3);
      expect(f.motm!.rating).toBeLessThanOrEqual(10);
    }
    let goals = 0, assists = 0, motm = 0;
    for (const c of s.clubs) for (const p of c.squad) {
      expect(p.stats.ratedApps ?? 0).toBe(p.stats.apps);
      expect((p.form ?? []).length).toBe(p.stats.apps);
      goals += p.stats.goals;
      assists += p.stats.assists ?? 0;
      motm += p.stats.motm ?? 0;
      if (p.stats.apps) expect(avgRating(p)).toBeGreaterThanOrEqual(3);
    }
    expect(motm).toBe(currentFixtures(s).length);
    expect(assists).toBeLessThanOrEqual(goals);
    // the man of the match holds the top rating of his game
    const f = currentFixtures(s)[0]!;
    const winner = [...s.clubs[f.home]!.squad, ...s.clubs[f.away]!.squad].find((p) => p.id === f.motm!.playerId)!;
    expect(winner.form![0]).toBe(f.motm!.rating);
    expect(winner.stats.motm).toBe(1);
  });

  it("assist and rating tables sort correctly and the rating table needs five appearances", () => {
    const s = newGame(6);
    for (let i = 0; i < 4; i++) { simulateRound(s, SHORT); s.round++; }
    expect(topRatings(s, 10).length).toBe(0);
    expect(topRatings(s, 10, 1).length).toBeGreaterThan(0);
    const rated = topRatings(s, 10, 1);
    for (let i = 1; i < rated.length; i++) expect(rated[i - 1]!.rating).toBeGreaterThanOrEqual(rated[i]!.rating);
    const assists = topAssists(s, 10);
    for (let i = 1; i < assists.length; i++) expect(assists[i - 1]!.player.stats.assists!).toBeGreaterThanOrEqual(assists[i]!.player.stats.assists!);
    for (const a of assists) expect(a.player.stats.assists).toBeGreaterThan(0);
  });

  it("moves the season onto the career list at the rollover and survives a save round-trip", () => {
    const s = newGame(7);
    simulateRound(s, SHORT);
    const before = structuredClone(s.clubs[0]!.squad.map((p) => ({ id: p.id, apps: p.stats.apps, rating: avgRating(p) })));
    appendCareer(s);
    for (const p of s.clubs[0]!.squad) {
      const b = before.find((x) => x.id === p.id)!;
      expect(p.career!.at(-1)).toEqual({ season: 1, club: 0, apps: b.apps, goals: p.stats.goals, assists: p.stats.assists ?? 0, rating: b.rating });
    }
    const back = deserialize(serialize(s))!;
    expect(back.clubs[0]!.squad[0]!.career).toEqual(s.clubs[0]!.squad[0]!.career);
    const played = s.clubs[0]!.squad.find((p) => p.stats.apps > 0)!;
    expect(back.clubs[0]!.squad.find((p) => p.id === played.id)!.form).toEqual(played.form);
    // an old save without the fields gets zeros, an empty form and an empty career
    const raw = JSON.parse(serialize(s));
    for (const c of raw.clubs) for (const p of c.squad) { delete p.form; delete p.career; delete p.stats.assists; delete p.stats.ratingSum; delete p.stats.ratedApps; delete p.stats.motm; }
    delete raw.board;
    const old = deserialize(JSON.stringify(raw))!;
    const p0 = old.clubs[0]!.squad[0]!;
    expect(p0.form).toEqual([]);
    expect(p0.career).toEqual([]);
    expect(p0.stats.assists).toBe(0);
    expect(p0.stats.ratedApps).toBe(0);
    expect(old.board.confidence).toBe(60);
  });

  it("a full season keeps a career entry per player and resets the season counters", () => {
    const s = newGame(8);
    while (s.round < 22) { simulateRound(s, SHORT); s.round++; }
    s.pendingCupDay = false;
    startNextSeason(s);
    for (const c of s.clubs) for (const p of c.squad) {
      if (p.contractUntil < 2) continue;
      expect(p.stats.apps).toBe(0);
      expect(p.stats.ratedApps ?? 0).toBe(0);
      expect(p.form ?? []).toEqual([]);
    }
    const veteran = s.clubs[1]!.squad.find((p) => p.career && p.career.length)!;
    expect(veteran.career![0]!.season).toBe(1);
  });
});
