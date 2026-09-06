import { describe, expect, it } from "vitest";
import { DIFFICULTIES, newGame, userExpectation, clubOf, refusalChance } from "../src/index";
const isStarter = (c: { selection: { starters: string[] } }, p: { id: string }) => c.selection.starters.includes(p.id);
import { deserialize } from "../src/save";

describe("난이도", () => {
  it("scales only the user's starting budget and board confidence", () => {
    const normal = newGame(7, 3, "감독", "normal");
    const easy = newGame(7, 3, "감독", "easy");
    const hard = newGame(7, 3, "감독", "hard");
    const mine = (s: typeof normal) => clubOf(s, 3);
    expect(easy.difficulty).toBe("easy");
    expect(mine(easy).budget).toBe(Math.round(mine(normal).budget * DIFFICULTIES.easy.startBudget));
    expect(mine(hard).budget).toBe(Math.round(mine(normal).budget * DIFFICULTIES.hard.startBudget));
    // every other club is untouched
    for (const id of [0, 1, 5, 12, 23]) expect(clubOf(easy, id).budget).toBe(clubOf(normal, id).budget);
    expect(easy.board.confidence).toBe(65);
    expect(hard.board.confidence).toBe(55);
    // the world itself is identical: same squads on every setting
    expect(clubOf(hard, 3).squad.map((p) => p.name)).toEqual(clubOf(normal, 3).squad.map((p) => p.name));
  });

  it("moves the board's expectation by the slack, inside the table", () => {
    const normal = newGame(7, 0, "감독", "normal");
    const easy = newGame(7, 0, "감독", "easy");
    const hard = newGame(7, 0, "감독", "hard");
    const base = userExpectation(normal);
    expect(userExpectation(easy)).toBe(Math.min(12, base + 2));
    expect(userExpectation(hard)).toBe(Math.max(1, base - 1));
    // a title favourite on hard is still expected first, not zeroth
    const top = newGame(7, 7, "감독", "hard");
    expect(userExpectation(top)).toBeGreaterThanOrEqual(1);
  });

  it("makes wanted starters at bigger clubs more reluctant on hard, easier on easy", () => {
    const mk = (d: "easy" | "normal" | "hard") => newGame(7, 23, "감독", d); // the smallest club buying from the biggest
    const n = mk("normal"), e = mk("easy"), h = mk("hard");
    const from = clubOf(n, 7);
    const star = from.squad.find((p) => isStarter(from, p))!;
    const base = refusalChance(n, from, star);
    expect(base).toBeGreaterThan(0);
    expect(refusalChance(e, clubOf(e, 7), clubOf(e, 7).squad.find((p) => p.id === star.id)!)).toBeCloseTo(base * DIFFICULTIES.easy.refusal, 5);
    expect(refusalChance(h, clubOf(h, 7), clubOf(h, 7).squad.find((p) => p.id === star.id)!)).toBeCloseTo(Math.min(0.95, base * DIFFICULTIES.hard.refusal), 5);
  });

  it("treats a save from before the setting as normal", () => {
    const s = newGame(7, 0);
    const raw = JSON.parse(JSON.stringify(s));
    delete raw.difficulty;
    const back = deserialize(JSON.stringify(raw));
    expect(back?.difficulty).toBe("normal");
  });
});
