import { describe, expect, it } from "vitest";
import { Match, defaultTactics } from "@3sec/engine";
import { LAST_CALLS, LAST_CALL_FROM, lastCallDue, createCupMatch, kickerNerve, newCup, newGame, pendingCupTies, penaltyShootoutDetail, shootoutTakers, userSideOf, type CupTie } from "../src/index";

/** A level cup tie of the user's, played out (short halves) until it is drawn. */
function drawnTie(seed: number): { s: ReturnType<typeof newGame>; tie: CupTie; m: Match } {
  for (let k = 0; k < 40; k++) {
    const s = newGame(seed + k, 0, "측정");
    newCup(s);
    const tie = pendingCupTies(s).find((t) => t.home === s.userClub || t.away === s.userClub);
    if (!tie) continue;
    const m = createCupMatch(s, tie, { halfLength: 60, autoUser: true });
    m.runToEnd();
    if (m.state.score[0] === m.state.score[1]) return { s, tie, m };
  }
  throw new Error("no drawn tie found");
}

describe("결정적 순간", () => {
  it("the user's named kickers go first in that order; the rest follow by ability; the result is reproducible", () => {
    const { s, tie, m } = drawnTie(700);
    const side = userSideOf(s, tie);
    expect(side).not.toBe(-1);
    const auto = shootoutTakers(m, side as 0 | 1).takers;
    expect(auto.length).toBeGreaterThanOrEqual(5);
    // pick the five weakest, reversed, so the order is clearly not the ability order
    const order = auto.slice(-5).reverse().map((p) => p.id);
    tie.shootoutOrder = order;
    const d1 = penaltyShootoutDetail(s, tie, m);
    const mine = d1.kicks.filter((k) => k.team === side).map((k) => k.playerId);
    expect(mine.slice(0, Math.min(mine.length, 5))).toEqual(order.slice(0, Math.min(mine.length, 5)));
    const d2 = penaltyShootoutDetail(s, tie, m);
    expect(d2).toEqual(d1);
    // an id that is not on the pitch is ignored, not a crash
    tie.shootoutOrder = ["nobody", order[0]!];
    expect(penaltyShootoutDetail(s, tie, m).kicks.filter((k) => k.team === side)[0]!.playerId).toBe(order[0]);
  });

  it("nerve: low morale and heavy legs cost a kicker, fresh and happy gains a little", () => {
    expect(kickerNerve(90, 0)).toBeGreaterThan(0);
    expect(kickerNerve(30, 0)).toBeLessThan(0);
    expect(kickerNerve(60, 0.9)).toBeLessThan(kickerNerve(60, 0.2));
    expect(Math.abs(kickerNerve(100, 1))).toBeLessThan(0.1);
  });

  it("the engine hands a pending restart to another player of the same side only", () => {
    const { m } = drawnTie(720);
    const s = m.state;
    const team = 0 as const;
    const on = s.players.filter((p) => p.team === team && p.onPitch && !p.sentOff);
    const other = s.players.find((p) => p.team === 1 && p.onPitch)!;
    s.restart = { kind: "PENALTY", team, pos: { x: 0, y: 0 }, takerId: on[0]!.id, timer: 3 };
    expect(m.setRestartTaker(team, on[1]!.id)).toBe(true);
    expect(s.restart.takerId).toBe(on[1]!.id);
    expect(m.setRestartTaker(team, other.id)).toBe(false);
    expect(m.setRestartTaker(1, other.id)).toBe(false);
    expect(s.restart.takerId).toBe(on[1]!.id);
  });

  it("last calls are three distinct, in-range tactics patches offered from the 75th minute", () => {
    expect(LAST_CALL_FROM).toBe(75 * 60);
    expect(lastCallDue(74 * 60, 45 * 60)).toBe(false);
    expect(lastCallDue(75 * 60, 45 * 60)).toBe(true);
    // a 3-minute-half match offers it at 5:00 of 6:00
    expect(lastCallDue(4 * 60 + 59, 3 * 60)).toBe(false);
    expect(lastCallDue(5 * 60, 3 * 60)).toBe(true);
    expect(LAST_CALLS.map((c) => c.id)).toEqual(["allOut", "lockDown", "waste"]);
    const base = defaultTactics();
    for (const c of LAST_CALLS) {
      for (const [k, v] of Object.entries(c.patch)) {
        expect(k in base).toBe(true);
        if (typeof v === "number") { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); }
      }
    }
    expect(LAST_CALLS[0]!.patch.mentality!).toBeGreaterThan(LAST_CALLS[1]!.patch.mentality!);
    expect(LAST_CALLS[2]!.patch.tempo!).toBeLessThan(0.2);
  });
});
