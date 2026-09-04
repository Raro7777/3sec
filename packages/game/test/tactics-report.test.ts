import { describe, expect, it } from "vitest";
import { Match, generateTeam } from "@3sec/engine";
import { MIN_WINDOW_MINUTES, TacticsRecorder, formatValue, lineSwing, type ReportLine } from "../src/index";

/** Play a match, applying `at` minute-by-minute changes, and return the finished report. */
function play(seed: number, changes: { minute: number; patch: Parameters<Match["setTactics"]>[1] }[], opts: { halfLength?: number } = {}) {
  const home = generateTeam({ id: 0, name: "H", shortName: "H", color: "#f00", formation: "4-3-3", quality: 12, seed: 11, tactics: { pressing: 0.25 } });
  const away = generateTeam({ id: 1, name: "A", shortName: "A", color: "#00f", formation: "4-4-2", quality: 12, seed: 22 });
  const m = new Match(home, away, { seed, aiManaged: [1], ...opts });
  const rec = new TacticsRecorder(m, 0);
  const todo = [...changes];
  while (m.state.phase !== "FULL_TIME") {
    m.step();
    rec.sample();
    while (todo.length && m.matchSeconds() >= todo[0]!.minute * 60) m.setTactics(0, todo.shift()!.patch);
  }
  return rec.report();
}

const lineOf = (lines: ReportLine[], label: string): ReportLine => lines.find((l) => l.label === label)!;

describe("내 지시 리포트", () => {
  it("is empty when the manager never touched anything", () => {
    expect(play(7, [])).toBeNull();
  });

  it("names the change, at the minute it was made, and measures the football either side of it", () => {
    const rep = play(7, [{ minute: 30, patch: { pressing: 0.95 } }])!;
    expect(rep).not.toBeNull();
    expect(rep.changes.length).toBe(1);
    const c = rep.changes[0]!;
    // labelled with the minute the manager moved it, not the minute the sample noticed
    expect(c.minute).toBe(30);
    expect(c.labels.length).toBe(1);
    expect(c.labels[0]).toContain("압박");
    expect(c.labels[0]).toContain("↑");
    // the windows are the football before and after, and they cover the match
    expect(c.beforeMinutes).toBeGreaterThanOrEqual(MIN_WINDOW_MINUTES);
    expect(c.afterMinutes).toBeGreaterThanOrEqual(MIN_WINDOW_MINUTES);
    expect(c.beforeMinutes + c.afterMinutes).toBeGreaterThan(80);
    // pressing hard is what tackles measure, so this is the line that must move
    const tackles = lineOf(c.lines, "태클");
    expect(tackles.after).toBeGreaterThan(tackles.before);
    expect(lineSwing(tackles)).toBeGreaterThan(0.15);
  });

  it("reports several sliders moved at once as one change", () => {
    const rep = play(9, [{ minute: 40, patch: { pressing: 0.9, mentality: 0.85, width: 0.9 } }])!;
    expect(rep.changes.length).toBe(1);
    const labels = rep.changes[0]!.labels.join(" ");
    for (const name of ["압박", "멘탈리티", "폭"]) expect(labels).toContain(name);
  });

  it("splits the windows at each change when there are several", () => {
    const rep = play(11, [
      { minute: 25, patch: { pressing: 0.9 } },
      { minute: 60, patch: { mentality: 0.9 } },
    ])!;
    expect(rep.changes.map((c) => c.minute)).toEqual([25, 60]);
    // the first change's "after" window ends where the second one begins
    expect(rep.changes[0]!.afterMinutes).toBe(rep.changes[1]!.minute - rep.changes[0]!.minute);
  });

  it("declines to measure a change made too close to the whistle rather than reading noise", () => {
    const rep = play(13, [{ minute: 88, patch: { pressing: 0.95 } }])!;
    expect(rep.changes).toEqual([]);
    expect(rep.unmeasured).toBe(1);
  });

  it("formats each measure the way it is read, and scores the direction that helps the manager", () => {
    const rep = play(7, [{ minute: 30, patch: { pressing: 0.95 } }])!;
    const lines = rep.changes[0]!.lines;
    expect(lineOf(lines, "패스 성공률").format).toBe("percent");
    expect(formatValue(lineOf(lines, "패스 성공률"), 0.784)).toBe("78%");
    expect(formatValue(lineOf(lines, "태클"), 7.25)).toBe("7.3");
    expect(formatValue(lineOf(lines, "내 xG"), 0.5551)).toBe("0.56");
    // conceding fewer shots is the good direction; taking more of my own is
    expect(lineOf(lines, "상대 슈팅").good).toBe("down");
    expect(lineOf(lines, "내 슈팅").good).toBe("up");
    // a pass completion of 78% against 83% is a fall, however small the absolute numbers
    expect(lineSwing({ label: "x", format: "percent", good: "up", before: 0.83, after: 0.78 })).toBeLessThan(0);
    expect(lineSwing({ label: "x", format: "rate", good: "up", before: 0, after: 0 })).toBe(0);
  });
});
