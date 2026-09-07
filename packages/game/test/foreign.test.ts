import { describe, expect, it } from "vitest";
import { Rng } from "@3sec/engine";
import {
  FOREIGN_ON_PITCH, FOREIGN_PREMIUM, FOREIGN_QUOTA, askingPrice, askingPriceFor, autoSelect, buyPlayer, ensureForeign, foreignCount, foreignStarters,
  isForeignId, isForeignPlayer, makeBid, newGame, overall, pendingEvents, resolveEvent, selectionProblem, storyWeek, transferTargets, type GameState, type SquadPlayer,
} from "../src/index";

/** Turn the user's n best outfield players into (nominal) foreigners. */
function naturalise(s: GameState, n: number): SquadPlayer[] {
  const me = s.clubs[s.userClub]!;
  const picked = [...me.squad].filter((p) => p.role !== "GK").sort((a, b) => overall(b.attrs, b.role) - overall(a.attrs, a.role)).slice(0, n);
  for (const p of picked) p.nat = "일본";
  return picked;
}

describe("foreign players: names and quota", () => {
  it("continental clubs carry players named by country while Korean squads stay Korean", () => {
    const s = newGame(501, 0);
    const foreign = ensureForeign(s);
    expect(foreign.length).toBeGreaterThan(0);
    for (const c of foreign) {
      expect(isForeignId(c.id)).toBe(true);
      expect(c.squad.every(isForeignPlayer)).toBe(true);
      expect(new Set(c.squad.map((p) => p.nat)).size).toBe(1);
    }
    expect(s.clubs.flatMap((c) => c.squad).some(isForeignPlayer)).toBe(false);
    // a Japanese club's names are spaced two-part names, not Korean three-syllable ones
    const jp = foreign.find((c) => c.squad[0]!.nat === "일본");
    if (jp) expect(jp.squad.every((p) => /\s/.test(p.name))).toBe(true);
  });

  it("autoSelect fields at most FOREIGN_ON_PITCH foreigners and selectionProblem flags a fourth", () => {
    const s = newGame(502, 0);
    const me = s.clubs[s.userClub]!;
    const picked = naturalise(s, 5);
    expect(foreignCount(me)).toBe(5);
    me.selection = autoSelect(me);
    expect(foreignStarters(me)).toBeLessThanOrEqual(FOREIGN_ON_PITCH);
    expect(selectionProblem(me)).toBeNull();
    // force four onto the pitch: swap a Korean starter for the benched foreigner
    const benched = picked.find((p) => !me.selection.starters.includes(p.id))!;
    const koreanIdx = me.selection.starters.findIndex((id) => !isForeignPlayer(me.squad.find((q) => q.id === id)!) && me.squad.find((q) => q.id === id)!.role !== "GK");
    me.selection.starters[koreanIdx] = benched.id;
    me.selection.bench = me.selection.bench.filter((id) => id !== benched.id);
    expect(foreignStarters(me)).toBe(FOREIGN_ON_PITCH + 1);
    expect(selectionProblem(me)).toContain("외국인");
  });

  it("a club at the holding quota cannot bid for, buy, or sign another foreigner", () => {
    const s = newGame(503, 0);
    const me = s.clubs[s.userClub]!;
    me.budget = 100000;
    naturalise(s, FOREIGN_QUOTA);
    const t = transferTargets(s).find((x) => x.abroad && x.price !== null)!;
    expect(t).toBeTruthy();
    const r = makeBid(s, t.club.id, t.player.id, t.price! * 2, new Rng(1));
    expect(r.status).toBe("error");
    expect(r.text).toContain("외국인 보유 한도");
    expect(buyPlayer(s, t.club.id, t.player.id)).toContain("외국인 보유 한도");
    // a Korean target is still fine
    const kr = transferTargets(s).find((x) => !x.abroad && x.price !== null)!;
    expect(buyPlayer(s, kr.club.id, kr.player.id)).toBeNull();
  });

  it("foreign clubs ask a premium over the domestic asking price and are listed as abroad", () => {
    const s = newGame(504, 0);
    const abroad = transferTargets(s).filter((x) => x.abroad);
    expect(abroad.length).toBeGreaterThan(20);
    for (const t of abroad.slice(0, 30)) {
      const domestic = askingPrice(t.club, t.player);
      if (domestic === null) { expect(t.price).toBeNull(); continue; }
      expect(t.price).toBe(Math.round(domestic * FOREIGN_PREMIUM));
      expect(askingPriceFor(s, t.club, t.player)).toBe(t.price);
    }
    const home = transferTargets(s).find((x) => !x.abroad && x.price !== null)!;
    expect(home.price).toBe(askingPrice(home.club, home.player));
  });

  it("overseasBid: a foreign club bids for the star; selling moves them abroad, refusing stings", () => {
    const die = { next: () => 0, chance: () => true, int: (lo: number) => lo, range: (lo: number) => lo, pick: <T>(a: T[]) => a[0]!, gauss: () => 0 } as unknown as Rng;
    const s = newGame(505, 0);
    const me = s.clubs[s.userClub]!;
    // make sure there is a star worth chasing
    const star = [...me.squad].sort((a, b) => overall(b.attrs, b.role) - overall(a.attrs, a.role))[0]!;
    for (const k of Object.keys(star.attrs) as (keyof typeof star.attrs)[]) star.attrs[k] = 18;
    ensureForeign(s);
    let ev = null;
    for (let i = 0; i < 40 && !ev; i++) { s.events = []; s.storyFlags = []; const e = storyWeek(s, { ...die, next: () => i / 40 } as Rng); if (e?.template === "overseasBid") ev = e; }
    expect(ev).toBeTruthy();
    expect(ev!.playerId).toBe(star.id);
    expect(ev!.clubId !== undefined && isForeignId(ev!.clubId)).toBe(true);
    expect(ev!.amount!).toBeGreaterThan(0);
    const budget = me.budget;
    resolveEvent(s, ev!.id, 0);
    expect(me.squad.some((p) => p.id === star.id)).toBe(false);
    expect(s.foreign!.find((c) => c.id === ev!.clubId)!.squad.some((p) => p.id === star.id)).toBe(true);
    expect(me.budget).toBe(budget + ev!.amount!);
    expect(pendingEvents(s).length).toBe(0);
  });
});
