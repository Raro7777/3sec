import { describe, expect, it } from "vitest";
import { FEUD_AT, adjustFeud, clubOf, newGame, nextUserFixture, pressQuote } from "../src/index";

describe("the opposing manager's press line", () => {
  it("is a quote, is stable across renders, and turns personal once there is a feud", () => {
    const s = newGame(11, 0);
    const fx = nextUserFixture(s)!;
    const me = clubOf(s, s.userClub), opp = clubOf(s, fx.home === me.id ? fx.away : fx.home);
    const m = opp.manager!;
    const a = pressQuote(s, m, me, opp);
    expect(a.startsWith('"') && a.endsWith('"')).toBe(true);
    expect(pressQuote(s, m, me, opp)).toBe(a);
    adjustFeud(s, m.id, FEUD_AT);
    const b = pressQuote(s, m, me, opp);
    expect(b).not.toBe(a);
    expect(b).toMatch(/할 말이 없다|잊지 않았다|관심 없다/);
  });
});
