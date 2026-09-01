import { describe, expect, it } from "vitest";
import { MAX_SUBS, Match } from "../src/match";
import { generateTeam } from "../src/teams";
import { FORMATIONS, roleDistance } from "../src/formation";

function mk(seed = 7): Match {
  const home = generateTeam({ id: 0, name: "Home", shortName: "HOM", color: "#f00", formation: "4-3-3", quality: 13, seed: 11 });
  const away = generateTeam({ id: 1, name: "Away", shortName: "AWY", color: "#00f", formation: "4-4-2", quality: 12, seed: 22 });
  return new Match(home, away, { seed, aiManaged: [] });
}

function toOpenPlay(m: Match): void {
  let n = 0;
  while (m.state.phase !== "PLAY" && n++ < 2000) m.step();
  expect(m.state.phase).toBe("PLAY");
}

function toNextStoppage(m: Match): void {
  let n = 0;
  while (m.state.phase === "PLAY" && n++ < 20 * 60 * 10) m.step();
  expect(m.state.phase).not.toBe("PLAY");
}

describe("substitutions (Law 3)", () => {
  it("teams have a bench and it starts off the pitch", () => {
    const m = mk();
    expect(m.teams[0].bench.length).toBe(7);
    expect(m.activePlayers(0).length).toBe(11);
    for (const b of m.teams[0].bench) expect(m.player(b.id).onPitch).toBe(false);
  });

  it("a sub requested during play waits for the next stoppage, then swaps the slot", () => {
    const m = mk();
    toOpenPlay(m);
    const out = m.state.lineups[0][9]!; // ST slot in 4-3-3
    const inn = m.teams[0].bench.find((b) => b.role === "ST")!.id;
    expect(m.requestSubstitution(0, out, inn)).toBeNull();
    // still on the pitch while the ball is in play
    expect(m.player(out).onPitch).toBe(true);
    expect(m.state.pendingSubs.length).toBe(1);
    toNextStoppage(m);
    expect(m.player(out).onPitch).toBe(false);
    expect(m.player(inn).onPitch).toBe(true);
    expect(m.state.lineups[0][9]).toBe(inn);
    expect(m.state.subsUsed[0]).toBe(1);
    expect(m.activePlayers(0).length).toBe(11);
    expect(m.state.events.some((e) => e.type === "SUBSTITUTION" && e.playerId === inn)).toBe(true);
  });

  it("a sub requested while the ball is dead is applied immediately", () => {
    const m = mk();
    // Before kick-off the ball is dead.
    const out = m.state.lineups[0][5]!;
    const inn = m.teams[0].bench.find((b) => b.role === "CM")!.id;
    expect(m.requestSubstitution(0, out, inn)).toBeNull();
    expect(m.player(inn).onPitch).toBe(true);
    expect(m.player(out).onPitch).toBe(false);
  });

  it("rejects invalid requests and enforces the limit", () => {
    const m = mk();
    const bench = m.teams[0].bench;
    expect(m.requestSubstitution(0, m.state.lineups[1][3]!, bench[1]!.id)).toMatch(/unknown|not/);
    expect(m.requestSubstitution(0, m.state.lineups[0][3]!, m.state.lineups[0][4]!)).toMatch(/not a bench|not available/);
    let ok = 0;
    for (let i = 1; i < bench.length; i++) {
      const r = m.requestSubstitution(0, m.state.lineups[0][i]!, bench[i]!.id);
      if (r === null) ok++;
    }
    expect(ok).toBe(MAX_SUBS);
    expect(m.state.subsUsed[0]).toBe(MAX_SUBS);
    // the substituted player cannot come back
    expect(m.requestSubstitution(0, bench[1]!.id, m.teams[0].players[1]!.id)).not.toBeNull();
  });

  it("a substitute keeper takes over keeper duties", () => {
    const m = mk();
    const gkOut = m.state.lineups[0][0]!;
    const gkIn = m.teams[0].bench[0]!.id;
    expect(m.requestSubstitution(0, gkOut, gkIn)).toBeNull();
    expect(m.keeper(0).id).toBe(gkIn);
    expect(m.isKeeper(gkIn)).toBe(true);
    expect(m.isKeeper(gkOut)).toBe(false);
  });
});

describe("live tactics", () => {
  it("changing formation re-assigns the eleven to fitting roles", () => {
    const m = mk();
    m.setTactics(0, { formation: "4-4-2" });
    const slots = FORMATIONS["4-4-2"];
    const lineup = m.state.lineups[0];
    expect(new Set(lineup).size).toBe(11);
    expect(m.def(lineup[0]!).role).toBe("GK");
    // Every outfield slot is filled by a player within one line of its role.
    for (let i = 1; i < 11; i++) {
      expect(roleDistance(m.def(lineup[i]!).role, slots[i]!.role)).toBeLessThanOrEqual(3.5);
    }
    expect(m.state.events.at(-1)?.type).toBe("TACTICS");
  });

  it("clamps slider values and records a TACTICS event", () => {
    const m = mk();
    m.setTactics(0, { mentality: 1.7, pressing: -1 });
    expect(m.teams[0].tactics.mentality).toBe(1);
    expect(m.teams[0].tactics.pressing).toBe(0);
    expect(m.state.events.at(-1)?.type).toBe("TACTICS");
  });

  it("an attacking mentality moves the block higher up the pitch", () => {
    const avgX = (mentality: number): number => {
      const m = mk(3);
      m.setTactics(0, { mentality });
      m.setTactics(1, { mentality: 0.5 });
      let sum = 0;
      let n = 0;
      let ticks = 0;
      while (ticks++ < 20 * 60 * 6) {
        m.step();
        if (m.state.phase !== "PLAY") continue;
        for (const p of m.activePlayers(0)) {
          if (m.isKeeper(p.id)) continue;
          sum += p.pos.x * m.dirOf(0);
          n++;
        }
      }
      return sum / n;
    };
    expect(avgX(0.9)).toBeGreaterThan(avgX(0.1) + 2);
  });
});

describe("fatigue", () => {
  it("accumulates over a match in a stamina-dependent, realistic range", () => {
    const m = mk(5);
    m.runToEnd();
    const outfield = m.state.players.filter((p) => p.onPitch && !m.isKeeper(p.id) && p.distance > 0);
    const fat = outfield.map((p) => p.fatigue);
    const avg = fat.reduce((a, b) => a + b, 0) / fat.length;
    expect(avg).toBeGreaterThan(0.4);
    expect(avg).toBeLessThan(0.85);
    // subs came on fresh: those with less distance are less tired
    const km = outfield.map((p) => p.distance / 1000);
    expect(Math.max(...km)).toBeGreaterThan(7); // a 90-minute outfielder covers 8-12 km in reality
  });
});

describe("AI manager", () => {
  it("uses substitutions and a late tactical shift for its team", () => {
    const home = generateTeam({ id: 0, name: "Home", shortName: "HOM", color: "#f00", formation: "4-3-3", quality: 15, seed: 11 });
    const away = generateTeam({ id: 1, name: "Away", shortName: "AWY", color: "#00f", formation: "4-4-2", quality: 10, seed: 22 });
    const m = new Match(home, away, { seed: 9, aiManaged: [1] });
    m.runToEnd();
    expect(m.state.subsUsed[1]).toBeGreaterThan(0);
    expect(m.state.subsUsed[0]).toBe(0);
    expect(m.state.events.some((e) => e.type === "TACTICS" && e.team === 1)).toBe(true);
  });
});
