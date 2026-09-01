import { describe, expect, it } from "vitest";
import { Match } from "../src/match";
import { generateTeam } from "../src/teams";
import { PITCH } from "../src/pitch";
import type { TeamId } from "../src/types";

function mk(seed = 7, halfLength = 45 * 60): Match {
  const home = generateTeam({ id: 0, name: "Home", shortName: "HOM", color: "#f00", formation: "4-3-3", quality: 13, seed: 11 });
  const away = generateTeam({ id: 1, name: "Away", shortName: "AWY", color: "#00f", formation: "4-4-2", quality: 12, seed: 22 });
  return new Match(home, away, { seed, halfLength });
}

/** Run until open play (kick-off taken). */
function toOpenPlay(m: Match): void {
  let n = 0;
  while (m.state.phase !== "PLAY" && n++ < 2000) m.step();
  expect(m.state.phase).toBe("PLAY");
}

describe("match determinism", () => {
  it("same seed produces an identical match", () => {
    const a = mk(99, 5 * 60);
    const b = mk(99, 5 * 60);
    a.runToEnd();
    b.runToEnd();
    expect(a.state.score).toEqual(b.state.score);
    expect(a.state.tick).toBe(b.state.tick);
    expect(a.state.events.map((e) => e.type + e.t)).toEqual(b.state.events.map((e) => e.type + e.t));
  });

  it("different seeds diverge", () => {
    const a = mk(1, 5 * 60);
    const b = mk(2, 5 * 60);
    a.runToEnd();
    b.runToEnd();
    expect(a.state.events.map((e) => e.type + e.t)).not.toEqual(b.state.events.map((e) => e.type + e.t));
  });
});

describe("match flow", () => {
  it("plays two halves, swaps ends and reaches full time", () => {
    const m = mk(5, 3 * 60);
    const firstHalfDirs = [...m.state.attackDir];
    m.runToEnd();
    expect(m.state.phase).toBe("FULL_TIME");
    expect(m.state.half).toBe(2);
    expect(m.state.attackDir).toEqual([firstHalfDirs[1], firstHalfDirs[0]]);
    const types = m.state.events.map((e) => e.type);
    expect(types).toContain("HALF_TIME");
    expect(types).toContain("FULL_TIME");
    expect(types.filter((t) => t === "KICK_OFF").length).toBeGreaterThanOrEqual(2);
  });

  it("kick-off keeps every player in their own half until the ball is kicked", () => {
    const m = mk(3);
    while (m.state.restart && m.state.restart.timer > 0.2) m.step();
    for (const p of m.state.players) {
      const dir = m.dirOf(p.team);
      expect(p.pos.x * dir).toBeLessThanOrEqual(0.5);
    }
  });
});

describe("laws of the game", () => {
  it("ball over the touchline gives a throw-in to the other team", () => {
    const m = mk(4);
    toOpenPlay(m);
    const b = m.state.ball;
    const lastTeam = (b.lastTouchTeam ?? 0) as TeamId;
    b.owner = null;
    b.pos = { x: 10, y: PITCH.halfWidth + 0.5 };
    b.vel = { x: 0, y: 3 };
    m.step();
    expect(m.state.restart?.kind).toBe("THROW_IN");
    expect(m.state.restart?.team).toBe(lastTeam === 0 ? 1 : 0);
    expect(Math.abs(m.state.restart!.pos.y)).toBeCloseTo(PITCH.halfWidth - 0.3, 1);
  });

  it("ball fully over the goal line between the posts is a goal and restarts with a kick-off", () => {
    const m = mk(4);
    toOpenPlay(m);
    const b = m.state.ball;
    const dir = m.dirOf(0);
    const scorer = m.state.players.find((p) => p.team === 0 && m.def(p.id).role === "ST")!;
    b.owner = null;
    b.lastTouch = scorer.id;
    b.lastTouchTeam = 0;
    b.pos = { x: (PITCH.halfLength + 0.3) * dir, y: 1 };
    b.z = 0.5;
    b.vel = { x: 10 * dir, y: 0 };
    m.step();
    expect(m.state.score).toEqual([1, 0]);
    expect(m.state.phase).toBe("GOAL_CELEBRATION");
    const goal = m.state.events.find((e) => e.type === "GOAL");
    expect(goal?.playerId).toBe(scorer.id);
    // celebration ends with the conceding team kicking off
    let n = 0;
    while (m.state.phase === "GOAL_CELEBRATION" && n++ < 2000) m.step();
    expect(m.state.restart?.kind).toBe("KICK_OFF");
    expect(m.state.restart?.team).toBe(1);
  });

  it("ball over the goal line last touched by the attacker is a goal kick, by a defender a corner", () => {
    for (const [lastTeam, expected] of [
      [0, "GOAL_KICK"],
      [1, "CORNER"],
    ] as const) {
      const m = mk(4);
      toOpenPlay(m);
      const b = m.state.ball;
      const dir = m.dirOf(0); // team 0 attacks this goal line
      const toucher = m.state.players.find((p) => p.team === lastTeam && m.def(p.id).role !== "GK")!;
      b.owner = null;
      b.lastTouch = toucher.id;
      b.lastTouchTeam = lastTeam;
      b.pos = { x: (PITCH.halfLength + 0.3) * dir, y: 20 };
      b.vel = { x: 5 * dir, y: 0 };
      m.step();
      expect(m.state.restart?.kind).toBe(expected);
    }
  });

  it("offside: a flagged team-mate receiving the pass concedes a free kick", () => {
    const m = mk(4);
    toOpenPlay(m);
    const s = m.state;
    const dir = m.dirOf(0);
    const passer = m.state.players.find((p) => p.team === 0 && m.def(p.id).role === "CM")!;
    const striker = m.state.players.find((p) => p.team === 0 && m.def(p.id).role === "ST")!;
    // Put every defender of team 1 (except GK) behind the striker => striker is offside.
    for (const p of m.state.players) {
      if (p.team === 1 && m.def(p.id).role !== "GK") p.pos = { x: 10 * dir, y: p.pos.y };
    }
    m.keeper(1).pos = { x: 51 * dir, y: 0 };
    striker.pos = { x: 30 * dir, y: 0 };
    passer.pos = { x: 5 * dir, y: 0 };
    s.ball.owner = null;
    s.ball.pos = { x: 6 * dir, y: 0 };
    s.ball.vel = { x: 0, y: 0 };
    s.ball.lastTouch = passer.id;
    s.ball.lastTouchTeam = 0;
    expect(m.inOffsidePosition(striker)).toBe(true);
    m.recordPass(passer, false);
    expect(s.lastPass?.offsidePositions[striker.id]).toBe(true);
    // Striker collects the ball.
    s.ball.pos = { x: 30 * dir + 0.3, y: 0 };
    striker.kickCooldown = 0;
    m.gainPossession(striker);
    expect(s.restart?.kind).toBe("FREE_KICK");
    expect(s.restart?.team).toBe(1);
    expect(s.stats[0].offsides).toBe(1);
    expect(s.events.at(-1)?.type).toBe("OFFSIDE");
  });

  it("offside does not apply in your own half", () => {
    const m = mk(4);
    toOpenPlay(m);
    const dir = m.dirOf(0);
    const striker = m.state.players.find((p) => p.team === 0 && m.def(p.id).role === "ST")!;
    for (const p of m.state.players) if (p.team === 1) p.pos = { x: -20 * dir, y: p.pos.y };
    striker.pos = { x: -5 * dir, y: 0 };
    expect(m.inOffsidePosition(striker)).toBe(false);
  });

  it("opponents stand at least 9.15 m from a free kick when it is taken", () => {
    const m = mk(4);
    toOpenPlay(m);
    m.setupRestart("FREE_KICK", 0, { x: 0, y: 0 });
    // Let players settle
    while (m.state.restart && m.state.restart.timer > 0.1) m.step();
    for (const p of m.state.players) {
      if (p.team === 1 && m.def(p.id).role !== "GK") {
        expect(Math.hypot(p.pos.x, p.pos.y)).toBeGreaterThan(PITCH.restartExclusion - 1.5);
      }
    }
  });
});

describe("statistics sanity (1 full match)", () => {
  it("produces football-like aggregate numbers", () => {
    const m = mk(2024);
    m.runToEnd();
    const [a, b] = m.state.stats;
    const goals = a.goals + b.goals;
    const shots = a.shots + b.shots;
    expect(goals).toBe(m.state.score[0] + m.state.score[1]);
    expect(shots).toBeGreaterThan(8);
    expect(shots).toBeLessThan(100);
    expect(a.shotsOnTarget).toBeLessThanOrEqual(a.shots);
    expect(a.passesCompleted).toBeLessThanOrEqual(a.passes);
    expect(a.possessionTicks + b.possessionTicks).toBeGreaterThan(20 * 60 * 60);
  });
});
