import { describe, expect, it } from "vitest";
import { Match } from "../src/match";
import { generateTeam } from "../src/teams";
import { PITCH } from "../src/pitch";

/**
 * Scenario tests: fixed situations replayed over many seeds, checking that outcome
 * distributions look like football. These are the Phase B "eye test" made measurable.
 */
function mk(seed: number): Match {
  const home = generateTeam({ id: 0, name: "H", shortName: "H", color: "#f00", formation: "4-3-3", quality: 12, seed: 11 });
  const away = generateTeam({ id: 1, name: "A", shortName: "A", color: "#00f", formation: "4-4-2", quality: 12, seed: 22 });
  const m = new Match(home, away, { seed, aiManaged: [] });
  let n = 0;
  while (m.state.phase !== "PLAY" && n++ < 2000) m.step();
  return m;
}

/** Park every player of `team` far from the action (own half corner) so they cannot interfere. */
function park(m: Match, team: 0 | 1, except: string[]): void {
  const dir = m.dirOf(team);
  for (const p of m.activePlayers(team)) {
    if (except.includes(p.id) || m.isKeeper(p.id)) continue;
    p.pos = { x: -45 * dir, y: 30 };
    p.vel = { x: 0, y: 0 };
  }
}

describe("scenario: striker one-on-one with the keeper", () => {
  it("scores roughly 30-55% of the time, keeper saves or striker misses the rest", () => {
    let goals = 0, saves = 0, N = 40;
    for (let s = 0; s < N; s++) {
      const m = mk(100 + s);
      const dir = m.dirOf(0);
      const st = m.state.lineups[0][9]!;
      park(m, 0, [st]);
      park(m, 1, []);
      const p = m.player(st);
      p.pos = { x: 20 * dir, y: 0 };
      p.vel = { x: 6 * dir, y: 0 };
      p.facing = dir === 1 ? 0 : Math.PI;
      m.keeper(1).pos = { x: 50 * dir, y: 0 };
      m.state.ball.pos = { x: 20.4 * dir, y: 0 };
      m.state.ball.owner = st;
      m.state.ball.lastTouch = st;
      m.state.ball.lastTouchTeam = 0;
      const before = m.state.score[0];
      let t = 0;
      while (t++ < 20 * 12 && m.state.phase === "PLAY") m.step();
      if (m.state.score[0] > before) goals++;
      else if (m.state.events.some((e) => e.type === "SAVE")) saves++;
    }
    // Real one-on-ones convert ~30-40%; the band is wide because 40 samples are noisy.
    const gRate = goals / N;
    expect(gRate).toBeGreaterThanOrEqual(0.2);
    expect(gRate).toBeLessThan(0.7);
    expect(saves).toBeGreaterThan(0);
  });
});

describe("scenario: corner kick", () => {
  it("is delivered into the box and rarely goes straight in", () => {
    let reachedBox = 0, directGoals = 0, N = 30;
    for (let s = 0; s < N; s++) {
      const m = mk(200 + s);
      const dir = m.dirOf(0);
      m.setupRestart("CORNER", 0, { x: (PITCH.halfLength - 0.3) * dir, y: PITCH.halfWidth - 0.3 });
      let t = 0;
      let inBox = false;
      const before = m.state.score[0];
      while (t++ < 20 * 40) {
        m.step();
        const b = m.state.ball.pos;
        if (Math.abs(b.x) > PITCH.halfLength - PITCH.penaltyAreaDepth && Math.abs(b.y) < PITCH.penaltyAreaHalfWidth && m.state.restart === null) inBox = true;
        if (m.state.phase !== "PLAY" && m.state.restart === null) break;
        if (m.state.restart && m.state.restart.kind !== "CORNER") break;
      }
      if (inBox) reachedBox++;
      if (m.state.score[0] > before && m.state.events.filter((e) => e.type === "SHOT").length === 0) directGoals++;
    }
    expect(reachedBox / N).toBeGreaterThan(0.6);
    expect(directGoals / N).toBeLessThan(0.1);
  });
});

describe("scenario: shot from the edge of the box with a defender in the lane", () => {
  it("gets blocked or saved far more often than it scores", () => {
    let goals = 0, blocks = 0, N = 40;
    for (let s = 0; s < N; s++) {
      const m = mk(300 + s);
      const dir = m.dirOf(0);
      const st = m.state.lineups[0][9]!;
      const cb = m.state.lineups[1][2]!;
      park(m, 0, [st]);
      park(m, 1, [cb]);
      const p = m.player(st);
      p.pos = { x: 34 * dir, y: 2 };
      p.vel = { x: 0, y: 0 };
      m.player(cb).pos = { x: 36.5 * dir, y: 1.6 };
      m.keeper(1).pos = { x: 51 * dir, y: 0 };
      m.state.ball.pos = { x: 34.4 * dir, y: 2 };
      m.state.ball.owner = st;
      m.state.ball.lastTouch = st;
      m.state.ball.lastTouchTeam = 0;
      p.possessionTime = 2; // settled, will decide
      const before = m.state.score[0];
      let t = 0;
      while (t++ < 20 * 6 && m.state.phase === "PLAY") m.step();
      if (m.state.score[0] > before) goals++;
      if (m.state.events.some((e) => e.type === "BLOCK")) blocks++;
    }
    expect(goals / N).toBeLessThan(0.25);
    expect(blocks).toBeGreaterThan(2);
  });
});
