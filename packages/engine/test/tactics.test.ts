import { describe, expect, it } from "vitest";
import { Match } from "../src/match";
import { generateTeam, normalizeTactics, defaultTactics } from "../src/teams";
import { TACTIC_PRESETS, autoRoles, defaultRoles, normalizeRoles, rolesForSlot } from "../src/ai/roles";
import type { PlayerRoleId } from "../src/types";

function play(seeds: number[], home: Parameters<typeof generateTeam>[0]["tactics"], away: Parameters<typeof generateTeam>[0]["tactics"], minutes = 20) {
  const acc = { shots: [0, 0] as [number, number], crosses: [0, 0] as [number, number], offsides: [0, 0] as [number, number], passes: [0, 0] as [number, number], goals: [0, 0] as [number, number] };
  for (const seed of seeds) {
    const h = generateTeam({ id: 0, name: "H", shortName: "H", color: "#f00", formation: "4-3-3", quality: 12, seed: 11, tactics: home });
    const a = generateTeam({ id: 1, name: "A", shortName: "A", color: "#00f", formation: "4-3-3", quality: 12, seed: 22, tactics: away });
    const m = new Match(h, a, { seed, halfLength: minutes * 30, aiManaged: [] });
    m.runToEnd();
    for (const t of [0, 1] as const) {
      acc.shots[t] += m.state.stats[t].shots; acc.crosses[t] += m.state.stats[t].crosses; acc.offsides[t] += m.state.stats[t].offsides;
      acc.passes[t] += m.state.stats[t].passes; acc.goals[t] += m.state.stats[t].goals;
    }
  }
  return acc;
}

describe("player roles", () => {
  it("every slot offers legal roles and normalization repairs bad arrays", () => {
    for (const f of ["4-3-3", "4-4-2", "4-2-3-1", "3-5-2"] as const) {
      const d = defaultRoles(f);
      expect(d.length).toBe(11);
      expect(d[0]).toBe("GK");
      const broken = normalizeRoles(f, ["PCH", "PCH"] as PlayerRoleId[]);
      expect(broken[0]).toBe("GK");
      expect(broken.length).toBe(11);
    }
    expect(rolesForSlot("ST")).toEqual(["AF", "TM", "PCH", "F9"]);
    expect(rolesForSlot("LB")).toEqual(["FB", "WB", "DFB"]);
    const t = normalizeTactics({ formation: "4-4-2", mentality: 2, tempo: -1 } as never);
    expect(t.mentality).toBe(1);
    expect(t.tempo).toBe(0);
    expect(t.roles!.length).toBe(11);
  });

  it("auto roles depend on attributes and are legal for their slots", () => {
    const team = generateTeam({ id: 0, name: "H", shortName: "H", color: "#f00", formation: "4-2-3-1", quality: 13, seed: 5 });
    const roles = autoRoles("4-2-3-1", team.players.map((p) => p.attrs));
    expect(normalizeRoles("4-2-3-1", roles)).toEqual(roles);
    expect(team.tactics.roles).toEqual(roles);
  });

  it("inside forwards shoot more and cross less than wingers; wing-backs cross more than defensive full-backs", () => {
    const seeds = [1, 2, 3, 4, 5, 6];
    const base = defaultRoles("4-3-3");
    const ifRoles = base.map((r, i) => (i === 8 || i === 10 ? "IF" : r)) as PlayerRoleId[];
    const wRoles = base.map((r, i) => (i === 8 || i === 10 ? "W" : r)) as PlayerRoleId[];
    const wb = base.map((r, i) => (i === 1 || i === 4 ? "WB" : r)) as PlayerRoleId[];
    const dfb = base.map((r, i) => (i === 1 || i === 4 ? "DFB" : r)) as PlayerRoleId[];
    const a = play(seeds, { roles: ifRoles }, { roles: wRoles });
    expect(a.crosses[0]).toBeLessThan(a.crosses[1]);
    const b = play(seeds, { roles: wb }, { roles: dfb });
    expect(b.crosses[0]).toBeGreaterThan(b.crosses[1]);
  });
});

describe("team instructions", () => {
  it("an offside trap catches more runners; a high engage line presses higher; presets are complete", () => {
    const seeds = [11, 12, 13, 14, 15, 16];
    const trap = play(seeds, { offsideTrap: true, defensiveLine: 0.7 }, { offsideTrap: false, defensiveLine: 0.7 });
    // opponents of the trapping side (team 1) are flagged more often than the trapping side itself
    expect(trap.offsides[1]).toBeGreaterThanOrEqual(trap.offsides[0]);
    for (const p of Object.values(TACTIC_PRESETS)) {
      const t = normalizeTactics({ ...defaultTactics("4-4-2"), ...p });
      expect(t.tempo).toBeGreaterThanOrEqual(0);
      expect(t.roles!.length).toBe(11);
    }
  });

  it("an injured player is substituted by the AI manager at the next stoppage", () => {
    const h = generateTeam({ id: 0, name: "H", shortName: "H", color: "#f00", formation: "4-3-3", quality: 12, seed: 11 });
    const a = generateTeam({ id: 1, name: "A", shortName: "A", color: "#00f", formation: "4-3-3", quality: 12, seed: 22 });
    const m = new Match(h, a, { seed: 3, halfLength: 10 * 60, aiManaged: [0, 1] });
    let n = 0;
    while (m.state.phase !== "PLAY" && n++ < 2000) m.step();
    const victim = m.player(m.state.lineups[1][7]!);
    m.injure(victim, "test");
    expect(victim.injured).toBe(true);
    let t = 0;
    while (victim.onPitch && t++ < 20 * 240) m.step();
    expect(victim.onPitch).toBe(false);
    expect(m.state.events.some((e) => e.type === "INJURY" && e.playerId === victim.id)).toBe(true);
  });
});
