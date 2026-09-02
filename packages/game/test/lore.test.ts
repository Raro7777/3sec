import { describe, expect, it } from "vitest";
import {
  CLUBS, CLUB_LORE, DERBY_CONFIDENCE, buildFixtures, clubLore, currentFixtures, derbyFor, derbyName, derbyPreview, derbyResult, deserialize, isDerby, newGame, prepareRound, rivalOf, serialize,
} from "../src/index";

describe("lore: clubs and rivals", () => {
  it("every club has lore matching the world roster and exactly one rival inside the league", () => {
    expect(CLUB_LORE.length).toBe(CLUBS.length);
    for (const [i, l] of CLUB_LORE.entries()) {
      expect(l.id).toBe(i);
      expect(l.founded).toBeGreaterThan(1900);
      expect(l.nickname.length).toBeGreaterThan(0);
      expect(l.history.length).toBeGreaterThan(10);
      expect(l.honours).toBeGreaterThanOrEqual(0);
      expect(l.rival).not.toBe(i);
      expect(l.rival).toBeGreaterThanOrEqual(0);
      expect(l.rival).toBeLessThan(CLUBS.length);
      expect(rivalOf(i)).toBe(l.rival);
      expect(clubLore(i)).toBe(l);
    }
    // the story pairs: 서울–인천, 부산–울산, 전주–광주, 대구–포항, 대전–창원 are symmetric; 수원→서울 and 제주→부산 are one-way
    for (const [a, b] of [[0, 2], [1, 7], [8, 4], [3, 9], [5, 11]]) { expect(rivalOf(a!)).toBe(b); expect(rivalOf(b!)).toBe(a); }
    expect(rivalOf(6)).toBe(0);
    expect(rivalOf(10)).toBe(1);
    // an unknown club gets the fallback and no rival
    expect(clubLore(99).rival).toBe(-1);
    expect(isDerby(99, 0)).toBe(false);
  });

  it("isDerby is symmetric, a derby has a name, and derbyFor names the user's rival", () => {
    expect(isDerby(0, 2)).toBe(true);
    expect(isDerby(2, 0)).toBe(true);
    expect(isDerby(6, 0)).toBe(true);
    expect(isDerby(0, 6)).toBe(true);
    expect(isDerby(0, 1)).toBe(false);
    expect(isDerby(3, 3)).toBe(false);
    expect(derbyName(0, 2)).toBe("수도권 더비");
    expect(derbyName(6, 0)).toBe("경부 더비");
    expect(derbyName(0, 1)).toBeNull();
    const s = newGame(3, 0);
    const info = derbyFor(s, { home: 2, away: 0 })!;
    expect(info.name).toBe("수도권 더비");
    expect(info.rival!.id).toBe(2);
    expect(derbyFor(s, { home: 3, away: 9 })!.rival).toBeNull();
    expect(derbyFor(s, { home: 0, away: 1 })).toBeNull();
  });

  it("buildFixtures flags every rivalry match: seven pairs, home and away", () => {
    const fx = buildFixtures(CLUBS.length);
    const derbies = fx.filter((f) => f.derby);
    expect(derbies.length).toBe(14);
    for (const f of fx) expect(!!f.derby).toBe(isDerby(f.home, f.away));
  });
});

describe("lore: derby effects", () => {
  it("a derby win lifts the user's board and both sets of fans swing; a draw moves nothing", () => {
    const s = newGame(11, 0);
    const me = s.clubs[0]!, rival = s.clubs[2]!;
    const conf = s.board.confidence, myMood = me.fans.mood, theirMood = rival.fans.mood;
    derbyResult(s, { home: 0, away: 2, score: [2, 0] });
    expect(s.board.confidence).toBe(conf + DERBY_CONFIDENCE);
    expect(me.fans.mood).toBeGreaterThan(myMood);
    expect(rival.fans.mood).toBeLessThan(theirMood);
    expect(s.news[0]).toContain("수도권 더비");
    expect(s.news[0]).toContain(me.name);
    const conf2 = s.board.confidence;
    derbyResult(s, { home: 2, away: 0, score: [3, 0] });
    expect(s.board.confidence).toBe(conf2 - DERBY_CONFIDENCE);
    expect(s.news[0]).toContain("대파");
    const conf3 = s.board.confidence, mood3 = me.fans.mood;
    derbyResult(s, { home: 0, away: 2, score: [1, 1] });
    expect(s.board.confidence).toBe(conf3);
    expect(me.fans.mood).toBe(mood3);
    expect(s.news[0]).toContain("비겼습니다");
    // no derby, no effect
    const n = s.news.length;
    derbyResult(s, { home: 0, away: 1, score: [5, 0] });
    expect(s.news.length).toBe(n);
  });

  it("the 더비 데이 news goes out once per rivalry fixture, when the round is prepared", () => {
    const s = newGame(12, 0);
    // find the user's first derby round and jump the fixtures there without playing
    const derby = s.fixtures.find((f) => f.derby && (f.home === 0 || f.away === 0))!;
    for (const f of s.fixtures) if (f.round === derby.round) f.derby = undefined;
    s.round = derby.round;
    prepareRound(s);
    expect(s.news.filter((n) => n.startsWith("더비 데이")).length).toBe(1);
    expect(currentFixtures(s).every((f) => !!f.derby === isDerby(f.home, f.away))).toBe(true);
    prepareRound(s);
    derbyPreview(s, currentFixtures(s));
    expect(s.news.filter((n) => n.startsWith("더비 데이")).length).toBe(1);
  });

  it("a save from before the lore gets its derby flags back on load", () => {
    const s = newGame(13, 0);
    const raw = JSON.parse(serialize(s));
    for (const f of raw.fixtures) delete f.derby;
    const loaded = deserialize(JSON.stringify(raw))!;
    expect(loaded.fixtures.filter((f) => f.derby).length).toBe(14);
  });
});
