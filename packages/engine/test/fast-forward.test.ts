import { describe, expect, it } from "vitest";
import { Match } from "../src/match";
import { generateTeam } from "../src/teams";

function mk(seed = 7): Match {
  const home = generateTeam({ id: 0, name: "Home", shortName: "HOM", color: "#f00", formation: "4-3-3", quality: 13, seed: 11 });
  const away = generateTeam({ id: 1, name: "Away", shortName: "AWY", color: "#00f", formation: "4-4-2", quality: 12, seed: 22 });
  return new Match(home, away, { seed });
}

describe("fastForward", () => {
  it("reaches the target clock in the second half, deterministically", () => {
    const a = mk(31), b = mk(31);
    expect(a.fastForward(60 * 60)).toBe(true);
    expect(b.fastForward(60 * 60)).toBe(true);
    expect(a.state.half).toBe(2);
    expect(a.state.clock).toBeGreaterThanOrEqual(15 * 60);
    expect(a.state.clock).toBeLessThan(15 * 60 + 1);
    expect(a.state.phase).not.toBe("FULL_TIME");
    expect(a.state.tick).toBe(b.state.tick);
    expect(a.state.score).toEqual(b.state.score);
    expect(a.state.events.map((e) => e.type + e.t)).toEqual(b.state.events.map((e) => e.type + e.t));
  });

  it("stops inside the first half when the target is before half time", () => {
    const m = mk(5);
    expect(m.fastForward(20 * 60)).toBe(true);
    expect(m.state.half).toBe(1);
    expect(m.state.clock).toBeGreaterThanOrEqual(20 * 60);
    expect(m.state.clock).toBeLessThan(20 * 60 + 1);
  });

  it("can be sliced with maxTicks and continues to the same state", () => {
    const whole = mk(9), sliced = mk(9);
    whole.fastForward(30 * 60);
    let done = false;
    let guard = 0;
    while (!done && guard++ < 10_000) done = sliced.fastForward(30 * 60, 500);
    expect(done).toBe(true);
    expect(sliced.state.tick).toBe(whole.state.tick);
    expect(sliced.state.clock).toBe(whole.state.clock);
  });

  it("first-half stoppage time is not mistaken for the second half", () => {
    const m = mk(12);
    // 45:30 is second-half territory (halfLength + 30 s): the half must be 2 even if the first half ran long
    expect(m.fastForward(45 * 60 + 30)).toBe(true);
    expect(m.state.half).toBe(2);
    expect(m.state.clock).toBeGreaterThanOrEqual(30);
  });
});

describe("setScore", () => {
  it("is reflected in the score and the goal stats without emitting events", () => {
    const m = mk(3);
    m.fastForward(60 * 60);
    const events = m.state.events.length;
    m.setScore(0, 2);
    expect(m.state.score).toEqual([0, 2]);
    expect(m.state.stats[0].goals).toBe(0);
    expect(m.state.stats[1].goals).toBe(2);
    expect(m.state.events.length).toBe(events);
    // play on: the forced scoreline is the base for the rest of the match
    m.runToEnd();
    expect(m.state.phase).toBe("FULL_TIME");
    expect(m.state.score[1]).toBeGreaterThanOrEqual(2);
    expect(m.state.stats[1].goals).toBe(m.state.score[1]);
  });
});

describe("sendOff", () => {
  it("removes an outfield player for good and counts the red", () => {
    const m = mk(4);
    m.fastForward(55 * 60);
    const id = m.state.lineups[0][5]!;
    expect(m.sendOff(id)).toBeNull();
    expect(m.player(id).sentOff).toBe(true);
    expect(m.activePlayers(0).length).toBe(10);
    expect(m.state.stats[0].reds).toBe(1);
    expect(m.state.events[m.state.events.length - 1]!.type).toBe("RED_CARD");
    expect(m.sendOff(id)).not.toBeNull();
    m.runToEnd();
    expect(m.activePlayers(0).length).toBeLessThanOrEqual(10);
  });
});
