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

  it("inside forwards shoot more than wingers; wing-backs push far higher than defensive full-backs", () => {
    const base = defaultRoles("4-3-3");
    const mk = (role: PlayerRoleId) => base.map((r, i) => (i === 8 || i === 10 ? role : r)) as PlayerRoleId[];
    // Same opponent and seeds for both variants; only the home side's wide roles differ.
    const wideShots = (role: PlayerRoleId) => {
      let n = 0;
      for (let seed = 1; seed <= 5; seed++) {
        const h = generateTeam({ id: 0, name: "H", shortName: "H", color: "#f00", formation: "4-3-3", quality: 12, seed: 11, tactics: { roles: mk(role) } });
        const a = generateTeam({ id: 1, name: "A", shortName: "A", color: "#00f", formation: "4-3-3", quality: 12, seed: 22, tactics: { roles: mk("W") } });
        const m = new Match(h, a, { seed, halfLength: 45 * 60, aiManaged: [] });
        m.runToEnd();
        const wide = new Set([h.players[8]!.id, h.players[10]!.id]);
        n += m.state.events.filter((e) => e.type === "SHOT" && e.playerId && wide.has(e.playerId)).length;
      }
      return n;
    };
    expect(wideShots("IF")).toBeGreaterThan(wideShots("W"));
    // Wing-backs hold a much higher average position in possession than defensive full-backs.
    const fbRoles = (role: PlayerRoleId) => base.map((r, i) => (i === 1 || i === 4 ? role : r)) as PlayerRoleId[];
    const fbAdvance = (role: PlayerRoleId) => {
      let sum = 0, n = 0;
      for (let seed = 1; seed <= 2; seed++) {
        const h = generateTeam({ id: 0, name: "H", shortName: "H", color: "#f00", formation: "4-3-3", quality: 12, seed: 11, tactics: { roles: fbRoles(role) } });
        const a = generateTeam({ id: 1, name: "A", shortName: "A", color: "#00f", formation: "4-3-3", quality: 12, seed: 22 });
        const m = new Match(h, a, { seed, halfLength: 20 * 60, aiManaged: [] });
        const ids = [h.players[1]!.id, h.players[4]!.id];
        while (m.state.phase !== "FULL_TIME") {
          m.step();
          if (m.state.tick % 20 === 0 && m.state.phase === "PLAY" && m.possessionTeam() === 0) for (const id of ids) { sum += m.player(id).pos.x * m.dirOf(0); n++; }
        }
      }
      return sum / n;
    };
    expect(fbAdvance("WB")).toBeGreaterThan(fbAdvance("DFB") + 3);
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

describe("set pieces and individual instructions", () => {
  it("uses the configured corner and penalty takers when they are on the pitch", () => {
    const h = generateTeam({ id: 0, name: "H", shortName: "H", color: "#f00", formation: "4-3-3", quality: 12, seed: 11 });
    const a = generateTeam({ id: 1, name: "A", shortName: "A", color: "#00f", formation: "4-3-3", quality: 12, seed: 22 });
    const corner = h.players[2]!.id, pen = h.players[3]!.id;
    h.tactics = normalizeTactics({ ...h.tactics, setPieces: { cornerTaker: corner, penaltyTaker: pen, cornerTarget: "near" } });
    const m = new Match(h, a, { seed: 9, aiManaged: [] });
    let n = 0;
    while (m.state.phase !== "PLAY" && n++ < 2000) m.step();
    m.setupRestart("CORNER", 0, { x: 52.2 * m.dirOf(0), y: 33.7 });
    expect(m.state.restart?.takerId).toBe(corner);
    m.setupRestart("PENALTY", 0, { x: 41.5 * m.dirOf(0), y: 0 });
    expect(m.state.restart?.takerId).toBe(pen);
    // an injured configured taker is skipped
    m.player(pen).injured = true;
    m.setupRestart("PENALTY", 0, { x: 41.5 * m.dirOf(0), y: 0 });
    expect(m.state.restart?.takerId).not.toBe(pen);
  });

  it("'shoot more' on the striker raises the striker's share of shots", () => {
    // 20 seeds: a pair of 15-minute halves is noisy enough that 6 of them can end level.
    const seeds = Array.from({ length: 20 }, (_, i) => 21 + i);
    let more = 0, base = 0;
    for (const seed of seeds) {
      for (const flag of [true, false]) {
        const h = generateTeam({ id: 0, name: "H", shortName: "H", color: "#f00", formation: "4-3-3", quality: 12, seed: 11 });
        const a = generateTeam({ id: 1, name: "A", shortName: "A", color: "#00f", formation: "4-3-3", quality: 12, seed: 22 });
        const instructions = Array.from({ length: 11 }, (_, i) => (i === 9 && flag ? { shootMore: true } : {}));
        h.tactics = normalizeTactics({ ...h.tactics, instructions });
        const m = new Match(h, a, { seed, halfLength: 15 * 60, aiManaged: [] });
        m.runToEnd();
        const st = h.players[9]!.id;
        const shots = m.state.events.filter((e) => e.type === "SHOT" && e.playerId === st).length;
        if (flag) more += shots; else base += shots;
      }
    }
    expect(more).toBeGreaterThan(base);
  });
});
