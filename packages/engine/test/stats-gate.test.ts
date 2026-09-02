import { describe, expect, it } from "vitest";
import { Match } from "../src/match";
import { generateTeam } from "../src/teams";

/**
 * Statistical gate: the engine must keep producing football-like aggregate numbers.
 * Bands are deliberately wide (few matches => noisy) but catch regressions of the kind that
 * turned up during calibration (60 shots, 10 goals, 60% passing, 85 in-play minutes).
 * Uses fixed seeds so the run is deterministic.
 */
describe("statistical gate (6 equal-quality matches)", () => {
  const N = 6;
  const acc = { goals: 0, shots: 0, onTarget: 0, passes: 0, completed: 0, fouls: 0, yellows: 0, reds: 0, corners: 0, offsides: 0, inPlay: 0, homeShots: 0 };
  for (let i = 0; i < N; i++) {
    const fA = i % 2 === 0 ? "4-3-3" : "4-4-2";
    const fB = i % 2 === 0 ? "4-4-2" : "4-3-3";
    const home = generateTeam({ id: 0, name: "H", shortName: "H", color: "#f00", formation: fA, quality: 12, seed: 7000 + i });
    const away = generateTeam({ id: 1, name: "A", shortName: "A", color: "#00f", formation: fB, quality: 12, seed: 8000 + i });
    const m = new Match(home, away, { seed: 9000 + i, aiManaged: [0, 1] });
    let play = 0;
    while (m.state.phase !== "FULL_TIME") {
      m.step();
      if (m.state.phase === "PLAY") play++;
    }
    const [a, b] = m.state.stats;
    acc.goals += a.goals + b.goals;
    acc.shots += a.shots + b.shots;
    acc.onTarget += a.shotsOnTarget + b.shotsOnTarget;
    acc.passes += a.passes + b.passes;
    acc.completed += a.passesCompleted + b.passesCompleted;
    acc.fouls += a.fouls + b.fouls;
    acc.yellows += a.yellows + b.yellows;
    acc.reds += a.reds + b.reds;
    acc.corners += a.corners + b.corners;
    acc.offsides += a.offsides + b.offsides;
    acc.inPlay += play / 20 / 60;
    acc.homeShots += a.shots;
  }
  const per = (k: keyof typeof acc) => acc[k] / N;

  it("goals per match 1.2–4.2 (real ~2.7)", () => {
    expect(per("goals")).toBeGreaterThanOrEqual(1.2);
    expect(per("goals")).toBeLessThanOrEqual(4.2);
  });
  it("shots per match 16–34 (real ~25)", () => {
    expect(per("shots")).toBeGreaterThanOrEqual(16);
    expect(per("shots")).toBeLessThanOrEqual(34);
  });
  it("on target 4–12 (real ~8.5)", () => {
    expect(per("onTarget")).toBeGreaterThanOrEqual(4);
    expect(per("onTarget")).toBeLessThanOrEqual(12);
  });
  it("pass completion 72–90% (real ~80%)", () => {
    const pct = acc.completed / acc.passes;
    expect(pct).toBeGreaterThanOrEqual(0.72);
    expect(pct).toBeLessThanOrEqual(0.9);
  });
  it("passes per match 750–1400 (real ~900)", () => {
    expect(per("passes")).toBeGreaterThanOrEqual(750);
    expect(per("passes")).toBeLessThanOrEqual(1400);
  });
  it("fouls 12–32, yellows 1.5–6, reds ≤ 0.6", () => {
    expect(per("fouls")).toBeGreaterThanOrEqual(12);
    expect(per("fouls")).toBeLessThanOrEqual(32);
    expect(per("yellows")).toBeGreaterThanOrEqual(1.5);
    expect(per("yellows")).toBeLessThanOrEqual(6);
    expect(per("reds")).toBeLessThanOrEqual(0.6);
  });
  it("corners ≥ 3 and offsides ≥ 0.5", () => {
    expect(per("corners")).toBeGreaterThanOrEqual(3);
    expect(per("offsides")).toBeGreaterThanOrEqual(0.5);
  });
  it("ball in play 50–66 minutes (real ~57)", () => {
    expect(per("inPlay")).toBeGreaterThanOrEqual(50);
    expect(per("inPlay")).toBeLessThanOrEqual(66);
  });
  it("no systematic home/away bias with equal squads (home shot share 30–70%)", () => {
    const share = acc.homeShots / acc.shots;
    expect(share).toBeGreaterThan(0.3);
    expect(share).toBeLessThan(0.7);
  });
});
