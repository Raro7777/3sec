import { describe, expect, it } from "vitest";
import {
  BOARD_FROM_ROUND, SACK_BELOW, START_CONFIDENCE, WARN_BELOW, WARN_WEEKS, acceptJob, advanceRound, boardRollover, boardWeek, confidenceBand, confidenceTarget,
  deserialize, expectedPositions, formPoints, jobOffers, newGame, roundsPerSeason, serialize, simulateRound, startNextSeason, stepConfidence, userExpectation,
  userPosition, type GameState,
} from "../src/index";

const SHORT = { halfLength: 4 * 60 };

/** Award every fixture of the round: the user's club loses 0-3 (or wins 3-0), everyone else draws. */
function fixRound(s: GameState, round: number, userWins: boolean): void {
  for (const f of s.fixtures.filter((x) => x.round === round)) {
    const mine = f.home === s.userClub || f.away === s.userClub;
    if (!mine) { f.score = [1, 1]; continue; }
    const userHome = f.home === s.userClub;
    f.score = userWins === userHome ? [3, 0] : [0, 3];
  }
}

/** Play `n` rounds with scripted results (no engine), running the weekly board review like advanceRound does. */
function scripted(s: GameState, n: number, userWins: boolean): void {
  for (let i = 0; i < n; i++) {
    fixRound(s, s.round, userWins);
    s.round++;
    if (s.round >= BOARD_FROM_ROUND) boardWeek(s);
  }
}

describe("confidence dynamics", () => {
  it("targets 50 at expectation with average form, ±4 per place and ±1.25 per form point, clamped", () => {
    expect(confidenceTarget(5, 5, 7)).toBe(50);
    expect(confidenceTarget(5, 7, 7)).toBe(42);
    expect(confidenceTarget(7, 5, 7)).toBe(58);
    expect(confidenceTarget(5, 5, 15)).toBe(60);
    expect(confidenceTarget(5, 5, 0)).toBe(41.25);
    expect(confidenceTarget(1, 12, 0)).toBe(0);
    expect(confidenceTarget(12, 1, 15)).toBe(100);
    expect(stepConfidence(60, 20)).toBe(50);
    expect(stepConfidence(50, 20)).toBe(42.5);
    expect(stepConfidence(20, 100)).toBe(40);
    expect(confidenceBand(80)).toBe("good");
    expect(confidenceBand(50)).toBe("ok");
    expect(confidenceBand(30)).toBe("warn");
    expect(confidenceBand(10)).toBe("bad");
  });

  it("starts at 60 and does nothing before round 5; form points count the last five results", () => {
    const s = newGame(3, 10);
    expect(s.board).toEqual({ confidence: START_CONFIDENCE, warnings: 0, lastReview: -1, lowWeeks: 0 });
    expect(userExpectation(s)).toBe(expectedPositions(s).get(10));
    scripted(s, BOARD_FROM_ROUND - 1, true);
    expect(s.board.confidence).toBe(START_CONFIDENCE);
    expect(s.board.lastReview).toBe(-1);
    expect(formPoints(s, 10)).toBe(12);
    scripted(s, 1, true);
    expect(s.board.lastReview).toBe(BOARD_FROM_ROUND);
    expect(userPosition(s)).toBe(1);
    expect(s.board.confidence).toBe(stepConfidence(START_CONFIDENCE, confidenceTarget(userExpectation(s), 1, 15)));
    expect(s.board.confidence).toBeGreaterThan(START_CONFIDENCE);
  });

  it("an underdog winning everything heads for 100, a favourite meeting expectation settles near 60, a losing favourite sinks", () => {
    const up = newGame(3, 10);
    expect(userExpectation(up)).toBeGreaterThan(8);
    scripted(up, 15, true);
    expect(up.board.confidence).toBeGreaterThan(90);
    expect(up.board.warnings).toBe(0);
    const par = newGame(3, 7);
    scripted(par, 15, true);
    expect(par.board.confidence).toBeGreaterThan(58);
    expect(par.board.confidence).toBeLessThanOrEqual(60);
    const down = newGame(3, 7);
    scripted(down, 8, false);
    expect(down.board.confidence).toBeLessThan(30);
  });

  it("runs from advanceRound with real matches and never leaves 0..100", () => {
    const s = newGame(4, 10);
    for (let i = 0; i < 8; i++) { simulateRound(s, SHORT); advanceRound(s); }
    expect(s.board.lastReview).toBe(s.round);
    expect(s.board.confidence).toBeGreaterThanOrEqual(0);
    expect(s.board.confidence).toBeLessThanOrEqual(100);
  });
});

describe("warnings and the sack", () => {
  it("three bad weeks bring a warning, a second bad streak under 15 brings the sack (deterministic script)", () => {
    // 울산 (club 7) is expected first; losing every game from the start sinks the board fast.
    const s = newGame(9, 7);
    expect(userExpectation(s)).toBe(1);
    const events: string[] = [];
    let warnedAt = -1, sackedAt = -1;
    for (let r = 0; r < roundsPerSeason(12) - 1 && !s.board.sacked; r++) {
      fixRound(s, s.round, false);
      s.round++;
      const ev = s.round >= BOARD_FROM_ROUND ? boardWeek(s) : null;
      if (ev) events.push(`${s.round}:${ev}:${s.board.confidence}`);
      if (ev === "warning" && warnedAt < 0) warnedAt = s.round;
      if (ev === "sacked") sackedAt = s.round;
    }
    expect(warnedAt).toBeGreaterThan(0);
    expect(sackedAt).toBeGreaterThanOrEqual(warnedAt + WARN_WEEKS);
    expect(s.board.warnings).toBe(1);
    expect(s.board.sacked).toBeTruthy();
    expect(s.board.sacked!.reason).toBe("warnings");
    expect(s.board.sacked!.position).toBe(12);
    expect(s.board.sacked!.expected).toBe(1);
    expect(s.board.sacked!.round).toBe(sackedAt);
    expect(s.board.confidence).toBeLessThan(SACK_BELOW);
    expect(s.news.some((n) => n.startsWith("이사회 경고"))).toBe(true);
    expect(s.news.some((n) => n.includes("경질"))).toBe(true);
    // the first warning fires exactly WARN_WEEKS reviews after confidence first dipped under the line
    expect(events[0]!.startsWith(`${warnedAt}:warning`)).toBe(true);
    // once sacked the board stops moving
    const frozen = s.board.confidence;
    fixRound(s, s.round, true); s.round++; expect(boardWeek(s)).toBeNull();
    expect(s.board.confidence).toBe(frozen);
  });

  it("a single bad streak is only a warning when confidence is still above 15; recovery resets the streak", () => {
    const s = newGame(9, 7);
    s.round = BOARD_FROM_ROUND;
    for (let r = 0; r < BOARD_FROM_ROUND; r++) fixRound(s, r, false);
    s.board.confidence = WARN_BELOW - 1;
    // hand-steer: two bad weeks then a good one → streak resets
    s.board.lowWeeks = 2;
    s.board.confidence = 90; // a good week
    fixRound(s, s.round, true); s.round++;
    expect(boardWeek(s)).toBeNull();
    expect(s.board.lowWeeks).toBe(0);
  });

  it("season end: ≥ 70 is a vote of confidence, < 35 the sack at the rollover, warnings wiped either way", () => {
    const good = newGame(9, 7);
    good.board.confidence = 75; good.board.warnings = 1;
    expect(boardRollover(good)).toBeNull();
    expect(good.news[0]).toContain("이사회 신임");
    expect(good.board.warnings).toBe(0);
    const bad = newGame(9, 7);
    bad.board.confidence = 30;
    expect(boardRollover(bad)).toBe("sacked");
    expect(bad.board.sacked?.reason).toBe("rollover");
    const mid = newGame(9, 7);
    mid.board.confidence = 50;
    expect(boardRollover(mid)).toBeNull();
    expect(mid.board.sacked).toBeUndefined();
  });

  it("the rollover itself applies the verdict through startNextSeason", () => {
    const s = newGame(10, 7);
    while (s.round < 22) { simulateRound(s, SHORT); s.round++; }
    s.pendingCupDay = false;
    s.board.confidence = 20;
    startNextSeason(s);
    expect(s.board.sacked?.reason).toBe("rollover");
    expect(s.board.sacked?.season).toBe(1);
    expect(s.season).toBe(2);
  });
});

describe("job offers after the sack", () => {
  const sackedState = (): GameState => {
    const s = newGame(9, 7);
    scripted(s, 14, false);
    if (!s.board.sacked) { s.board.confidence = 5; s.board.warnings = 1; s.board.lowWeeks = 2; scripted(s, 1, false); }
    expect(s.board.sacked).toBeTruthy();
    return s;
  };

  it("lists up to two AI clubs, vacancies first then the most pressured dugouts, never the user's own", () => {
    const s = sackedState();
    const offers = jobOffers(s);
    expect(offers.length).toBe(2);
    for (const c of offers) expect(c.id).not.toBe(s.userClub);
    s.clubs[3]!.manager = null;
    expect(jobOffers(s)[0]!.id).toBe(3);
    s.clubs[3]!.manager = s.clubs[4]!.manager;
    s.clubs[5]!.pressure = 9;
    expect(jobOffers(s)[0]!.id).toBe(5);
    expect(jobOffers(s, 1).length).toBe(1);
  });

  it("accepting moves the user over: old club gets an AI manager, the new club's coach joins the pool, board resets", () => {
    const s = sackedState();
    const old = s.userClub;
    const target = jobOffers(s)[0]!;
    const displaced = target.manager!;
    const poolBefore = s.freeManagers.length;
    expect(acceptJob(s, target.id)).toBeNull();
    expect(s.userClub).toBe(target.id);
    expect(target.manager).toBeNull();
    expect(s.clubs[old]!.manager).toBeTruthy();
    expect(s.clubs[old]!.manager!.since).toBe(s.season);
    expect(s.freeManagers[0]).toBe(displaced);
    expect(s.freeManagers.length).toBe(poolBefore + 1 - (poolBefore > 0 ? 1 : 0));
    expect(s.board.sacked).toBeUndefined();
    expect(s.board.confidence).toBe(55);
    expect(s.offers).toEqual([]);
    expect(s.news[0]).toContain(target.shortName);
    // and the next weekly review works for the new club
    fixRound(s, s.round, true); s.round++;
    expect(boardWeek(s)).toBeNull();
    expect(s.board.lastReview).toBe(s.round);
    // cannot accept twice
    expect(acceptJob(s, old)).not.toBeNull();
  });

  it("the sacked state, offers and board survive a save round-trip", () => {
    const s = sackedState();
    const back = deserialize(serialize(s))!;
    expect(back.board).toEqual(s.board);
    expect(jobOffers(back).map((c) => c.id)).toEqual(jobOffers(s).map((c) => c.id));
    expect(acceptJob(back, jobOffers(back)[0]!.id)).toBeNull();
    expect(deserialize(serialize(back))!.userClub).toBe(back.userClub);
  });
});
