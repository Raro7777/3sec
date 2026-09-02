import { describe, expect, it } from "vitest";
import { Rng, TUNING } from "@3sec/engine";
import {
  CLUBS, FAN_FRENZY_AT, FAN_PROTEST_BELOW, FAN_PROTEST_CONFIDENCE, FAN_PROTEST_WEEKS, FAN_START_MOOD, advanceRound, adjustMood, avgHomeAttendance, clubCapacity, createMatch,
  currentFixtures, deserialize, expectedAttendance, fanHomeEdge, fansCupResult, fansTransfer, fansWeek, financeSummary, gateReceipts, isStar, moodLabel, newGame, playerOf,
  roundsPerSeason, seasonOver, serialize, simulateRound, startNextSeason, weeklyRevenue, type GameState,
} from "../src/index";
import { advanceCupDay, simulateCupDay } from "../src/cup";

const SHORT = { halfLength: 4 * 60 };

/** A whole season headlessly (cup days included). */
function playSeason(s: GameState): void {
  while (!seasonOver(s)) {
    if (s.pendingCupDay) { simulateCupDay(s, SHORT); advanceCupDay(s); continue; }
    simulateRound(s, SHORT);
    advanceRound(s);
  }
}

describe("fans: model", () => {
  it("every club starts with a capacity matching the world definition, core supporters and a content mood", () => {
    const s = newGame(7);
    for (const c of s.clubs) {
      expect(c.capacity).toBe(CLUBS[c.id]!.capacity);
      expect(clubCapacity(c)).toBe(c.capacity);
      expect(c.fans.mood).toBe(FAN_START_MOOD);
      expect(c.fans.base).toBeGreaterThan(0);
      expect(c.fans.base).toBeLessThan(c.capacity);
      expect(c.fans.seasonHome).toBe(0);
    }
    // more reputation → a bigger core within the same ground
    const big = s.clubs.find((c) => c.reputation >= 14)!, small = s.clubs.find((c) => c.reputation <= 10.5)!;
    expect(big.fans.base / big.capacity).toBeGreaterThan(small.fans.base / small.capacity);
  });

  it("attendance stays between the core support and the seats, and a happy crowd is bigger than an angry one", () => {
    const s = newGame(8);
    const home = s.clubs[0]!, away = s.clubs[7]!;
    const avg = (mood: number) => {
      home.fans.mood = mood;
      let sum = 0;
      for (let i = 0; i < 100; i++) {
        const att = expectedAttendance(s, home, away, false, new Rng(i + 1));
        expect(att).toBeGreaterThanOrEqual(home.fans.base);
        expect(att).toBeLessThanOrEqual(home.capacity);
        sum += att;
      }
      return sum / 100;
    };
    expect(avg(90)).toBeGreaterThan(avg(50));
    expect(avg(50)).toBeGreaterThan(avg(10));
    // a frenzied support pays a little more at the gate
    home.fans.mood = 50;
    const g50 = gateReceipts(home, 30000);
    home.fans.mood = FAN_FRENZY_AT;
    expect(gateReceipts(home, 30000)).toBeGreaterThan(g50);
  });

  it("mood clamps to 0..100 and its labels run 분노 → 열광", () => {
    const s = newGame(9);
    const c = s.clubs[0]!;
    adjustMood(c, 500);
    expect(c.fans.mood).toBe(100);
    adjustMood(c, -500);
    expect(c.fans.mood).toBe(0);
    expect(moodLabel(10)).toBe("분노");
    expect(moodLabel(30)).toBe("불만");
    expect(moodLabel(50)).toBe("보통");
    expect(moodLabel(65)).toBe("만족");
    expect(moodLabel(85)).toBe("열광");
  });

  it("the home edge handed to the engine scales with the mood", () => {
    const s = newGame(10);
    const home = s.clubs[0]!;
    home.fans.mood = 0;
    expect(fanHomeEdge(home)).toBeCloseTo(TUNING.homeEdge * 0.5, 5);
    home.fans.mood = 100;
    expect(fanHomeEdge(home)).toBeCloseTo(TUNING.homeEdge * 1.5, 5);
    const f = currentFixtures(s).find((x) => x.home === home.id)!;
    const gk = playerOf(home, home.selection.starters[0]!);
    home.fans.mood = 0;
    const low = createMatch(s, f, SHORT).def(gk.id).attrs.reflexes;
    home.fans.mood = 100;
    const high = createMatch(s, f, SHORT).def(gk.id).attrs.reflexes;
    expect(high - low).toBeCloseTo(Math.min(20, gk.attrs.reflexes + TUNING.homeEdge * 1.5) - Math.min(20, gk.attrs.reflexes + TUNING.homeEdge * 0.5), 5);
  });
});

describe("fans: reactions", () => {
  it("a win against a bigger side lifts the mood, a home defeat to a smaller one sinks it", () => {
    const s = newGame(11);
    const strong = [...s.clubs].sort((a, b) => b.reputation - a.reputation)[0]!;
    const weak = [...s.clubs].sort((a, b) => a.reputation - b.reputation)[0]!;
    const f = s.fixtures.find((x) => x.round === 0 && (x.home === weak.id || x.away === weak.id))!;
    // rewrite round 0 so the weakest club hosts the strongest and wins 3-0
    f.home = weak.id; f.away = strong.id; f.score = [3, 0];
    for (const x of currentFixtures(s)) if (x !== f && !x.score) x.score = [1, 1];
    s.round = 1;
    fansWeek(s);
    expect(weak.fans.mood).toBeGreaterThan(FAN_START_MOOD + 5);
    expect(strong.fans.mood).toBeLessThan(FAN_START_MOOD - 3);
  });

  it("three weeks of anger bring a protest and cost the user's board", () => {
    const s = newGame(12);
    const me = s.clubs[s.userClub]!;
    s.round = 1; // no results yet: only the drift moves the mood
    const conf = s.board.confidence;
    me.fans.mood = 5;
    for (let i = 0; i < FAN_PROTEST_WEEKS; i++) { me.fans.mood = Math.min(me.fans.mood, FAN_PROTEST_BELOW - 5); fansWeek(s); }
    expect(s.news.some((n) => /팬 시위/.test(n))).toBe(true);
    expect(s.board.confidence).toBeCloseTo(conf - FAN_PROTEST_CONFIDENCE, 5);
    expect(me.fans.lowWeeks).toBe(0);
  });

  it("selling a star angers the sellers' fans and pleases the buyers'; cup ties move both sets", () => {
    const s = newGame(13);
    const from = s.clubs[0]!, to = s.clubs[1]!;
    const star = [...from.squad].sort((a, b) => b.attrs.finishing - a.attrs.finishing)[0]!;
    // make him unmistakably the best player of both squads
    for (const k of Object.keys(star.attrs) as (keyof typeof star.attrs)[]) star.attrs[k] = 20;
    expect(isStar(from, star)).toBe(true);
    fansTransfer(s, from, to, star);
    expect(from.fans.mood).toBeLessThan(FAN_START_MOOD);
    expect(to.fans.mood).toBeGreaterThan(FAN_START_MOOD);
    const a = s.clubs[2]!, b = s.clubs[3]!;
    fansCupResult(s, a, b, 2);
    expect(a.fans.mood).toBeGreaterThan(FAN_START_MOOD);
    expect(b.fans.mood).toBeLessThan(FAN_START_MOOD);
  });
});

describe("fans: season", () => {
  it("records a crowd and a gate for every home match, keeps income near the old flat figure and resets at the rollover", () => {
    const s = newGame(14);
    playSeason(s);
    const rounds = roundsPerSeason(s.clubs.length);
    for (const f of s.fixtures) {
      const home = s.clubs[f.home]!;
      expect(f.attendance).toBeGreaterThanOrEqual(home.fans.base);
      expect(f.attendance).toBeLessThanOrEqual(home.capacity);
    }
    for (const t of s.cup.ties) if (t.score) expect(t.attendance).toBeGreaterThan(0);
    for (const c of s.clubs) {
      expect(c.fans.seasonHome).toBeGreaterThanOrEqual(rounds / 2);
      expect(avgHomeAttendance(c)).toBeGreaterThan(c.fans.base * 0.9);
      expect(c.fans.bestAttendance).toBeLessThanOrEqual(c.capacity);
      expect(c.fans.mood).toBeGreaterThanOrEqual(0);
      expect(c.fans.mood).toBeLessThanOrEqual(100);
      const fin = financeSummary(s, c.id);
      expect(fin.gate).toBeGreaterThan(0);
      expect(fin.gate).toBeLessThan(fin.revenue);
      // the old flat income was 0.6 + 0.35 × (reputation − 10) per week; fixed + gate should land in the same band
      const old = (0.6 + Math.max(0, c.reputation - 10) * 0.35) * rounds;
      expect(fin.revenue).toBeGreaterThan(old * 0.7);
      expect(fin.revenue).toBeLessThan(old * 1.45);
      expect(weeklyRevenue(c, null)).toBeLessThan(0.6 + Math.max(0, c.reputation - 10) * 0.35);
    }
    const top = [...s.clubs].sort((a, b) => b.reputation - a.reputation)[0]!;
    const topFin = financeSummary(s, top.id);
    expect(topFin.revenue / rounds).toBeGreaterThan(1.7);
    expect(topFin.revenue / rounds).toBeLessThan(2.7);
    startNextSeason(s);
    for (const c of s.clubs) {
      expect(c.fans.seasonHome).toBe(0);
      expect(c.fans.seasonAttendance).toBe(0);
      expect(c.fans.bestAttendance).toBe(0);
      expect(c.seasonGate).toBe(0);
      expect(Math.abs(c.fans.mood - FAN_START_MOOD)).toBeLessThanOrEqual(40); // halved toward the start value (±27.5 at most), then the rollover window moves it a little
    }
  });

  it("a save without fans or capacity gets sensible defaults", () => {
    const s = newGame(15);
    simulateRound(s, SHORT);
    advanceRound(s);
    const raw = JSON.parse(serialize(s));
    for (const c of raw.clubs) { delete c.fans; delete c.capacity; delete c.seasonGate; }
    for (const f of raw.fixtures) delete f.attendance;
    const back = deserialize(JSON.stringify(raw))!;
    expect(back).not.toBeNull();
    for (const c of back.clubs) {
      expect(c.capacity).toBe(CLUBS[c.id]!.capacity);
      expect(c.fans.mood).toBe(FAN_START_MOOD);
      expect(c.fans.base).toBeGreaterThan(0);
      expect(c.fans.seasonHome).toBe(0);
      expect(c.seasonGate).toBe(0);
    }
    // and it plays on
    simulateRound(back, SHORT);
    expect(advanceRound(back)).toBe(true);
    expect(currentFixtures(s).length).toBeGreaterThan(0);
  });
});
