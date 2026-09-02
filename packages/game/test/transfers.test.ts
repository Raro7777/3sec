import { describe, expect, it } from "vitest";
import { MIN_SQUAD, askingPrice, bestOffer, buyPlayer, newGame, playerValue, sellPlayer, selectionProblem, transferTargets, windowOpen, aiTransfers, overall } from "../src/index";
import { Rng } from "@3sec/engine";

describe("transfer market", () => {
  it("values better and younger players higher", () => {
    const s = newGame(21);
    const all = s.clubs.flatMap((c) => c.squad);
    const best = [...all].sort((a, b) => overall(b.attrs, b.role) - overall(a.attrs, a.role))[0]!;
    const worst = [...all].sort((a, b) => overall(a.attrs, a.role) - overall(b.attrs, b.role))[0]!;
    expect(playerValue(best)).toBeGreaterThan(playerValue(worst));
    const young = { ...best, age: 21 }, old = { ...best, age: 33 };
    expect(playerValue(young)).toBeGreaterThan(playerValue(old));
  });

  it("buying moves the player, debits the budget and keeps both XIs legal", () => {
    const s = newGame(22);
    expect(windowOpen(s)).toBe(true);
    const me = s.clubs[s.userClub]!;
    me.budget = 10000;
    const t = transferTargets(s).find((x) => x.price !== null)!;
    const before = me.squad.length, fromBefore = t.club.squad.length, fromBudget = t.club.budget;
    expect(buyPlayer(s, t.club.id, t.player.id)).toBeNull();
    expect(me.squad.length).toBe(before + 1);
    expect(t.club.squad.length).toBe(fromBefore - 1);
    expect(me.budget).toBe(10000 - t.price!);
    expect(t.club.budget).toBe(fromBudget + t.price!);
    expect(selectionProblem(me)).toBeNull();
    expect(selectionProblem(t.club)).toBeNull();
    expect(new Set(me.squad.map((p) => p.number)).size).toBe(me.squad.length);
  });

  it("refuses when the window is shut, the budget is short or the squad is at its minimum", () => {
    const s = newGame(23);
    const me = s.clubs[s.userClub]!;
    const t = transferTargets(s).find((x) => x.price !== null)!;
    me.budget = 0;
    expect(buyPlayer(s, t.club.id, t.player.id)).toMatch(/예산/);
    s.round = 5;
    me.budget = 10000;
    expect(buyPlayer(s, t.club.id, t.player.id)).toMatch(/닫혀/);
    s.round = 0;
    while (me.squad.length > MIN_SQUAD) me.squad.pop();
    expect(sellPlayer(s, me.squad[0]!.id)).toMatch(/최소/);
    expect(askingPrice(me, me.squad[0]!)).toBeNull();
  });

  it("selling goes to the best bidder and credits the fee", () => {
    const s = newGame(24);
    const me = s.clubs[s.userClub]!;
    const star = [...me.squad].sort((a, b) => overall(b.attrs, b.role) - overall(a.attrs, a.role))[0]!;
    const offer = bestOffer(s, star.id)!;
    expect(offer).not.toBeNull();
    const budget = me.budget;
    expect(sellPlayer(s, star.id)).toBeNull();
    expect(me.budget).toBe(budget + offer.fee);
    expect(offer.club.squad.some((p) => p.id === star.id)).toBe(true);
    expect(me.squad.some((p) => p.id === star.id)).toBe(false);
  });

  it("AI clubs trade among themselves and stay legal", () => {
    const s = newGame(25);
    const total = s.clubs.reduce((n, c) => n + c.squad.length, 0);
    aiTransfers(s, new Rng(1));
    expect(s.clubs.reduce((n, c) => n + c.squad.length, 0)).toBe(total);
    for (const c of s.clubs) expect(selectionProblem(c)).toBeNull();
  });
});
