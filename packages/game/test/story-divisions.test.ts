import { describe, expect, it } from "vitest";
import {
  CLUBS_PER_DIVISION, SWAP, advanceRound, clubsIn, divisionOf, divisionTable, moraleOf, newGame, overall,
  pendingEvents, resolveEvent, seasonOver, seasonRounds, simulateRound, startNextSeason, storyWeek,
  type Club, type GameState, type StoryEvent, type StoryTemplateId,
} from "../src/index";
import { Rng } from "@3sec/engine";

const SHORT = { halfLength: 3 * 60 };
const playSeason = (s: GameState) => {
  while (!seasonOver(s)) { s.pendingCupDay = false; simulateRound(s, SHORT); advanceRound(s); }
};
/** Keep rolling the story dice until the wanted template comes up (they are drawn at random). */
function force(s: GameState, id: StoryTemplateId): StoryEvent {
  for (let i = 0; i < 400; i++) {
    storyWeek(s, new Rng(i * 7919 + 13));
    const ev = pendingEvents(s).find((e) => e.template === id);
    if (ev) return ev;
    s.events = [];
  }
  throw new Error(`${id} never fired`);
}
/** Put the user in the second division, at the round the caller wants. */
function inSecond(seed: number, round: number): GameState {
  const s = newGame(seed, 0, "측정");
  s.clubs[s.userClub]!.division = 2;
  s.round = round;
  return s;
}
const star = (c: Club) => [...c.squad].sort((a, b) => overall(b.attrs, b.role) - overall(a.attrs, a.role))[0]!;

describe("승강제가 만든 이벤트", () => {
  it("only offers the top-flight bid to a club that has a division above it", () => {
    const top = newGame(51, 0, "측정");
    top.round = 0;
    expect(() => force(top, "topFlightBid")).toThrow(); // already in the first division
  });

  it("brings a first-division club for my best player, and selling actually moves him", () => {
    const s = inSecond(52, 0);
    const me = s.clubs[s.userClub]!;
    const ev = force(s, "topFlightBid");
    const wanted = me.squad.find((p) => p.id === ev.playerId)!;
    expect(wanted.id).toBe(star(me).id);
    expect(ev.clubId).toBeDefined();
    const buyer = s.clubs[ev.clubId!]!;
    expect(divisionOf(buyer)).toBe(1);
    expect(ev.amount!).toBeGreaterThan(0);
    expect(ev.choices.length).toBe(3);

    const budget = me.budget, size = me.squad.length;
    resolveEvent(s, ev.id, 0);
    expect(me.squad.some((p) => p.id === wanted.id)).toBe(false);
    expect(buyer.squad.some((p) => p.id === wanted.id)).toBe(true);
    expect(me.squad.length).toBe(size - 1);
    expect(me.budget).toBeCloseTo(budget + ev.amount!, 1);
    // and he is out of the XI, not a ghost in the selection
    expect(me.selection.starters).not.toContain(wanted.id);
    expect(me.selection.bench).not.toContain(wanted.id);
  });

  it("keeping him costs money and mood: refusing sours him, re-signing lifts him", () => {
    const refuse = inSecond(53, 0);
    const evA = force(refuse, "topFlightBid");
    const pA = refuse.clubs[refuse.userClub]!.squad.find((p) => p.id === evA.playerId)!;
    const before = moraleOf(pA);
    resolveEvent(refuse, evA.id, 1);
    expect(moraleOf(pA)).toBeLessThan(before);
    expect(refuse.clubs[refuse.userClub]!.squad.some((p) => p.id === pA.id)).toBe(true);

    const keep = inSecond(53, 0);
    const evB = force(keep, "topFlightBid");
    const me = keep.clubs[keep.userClub]!;
    const pB = me.squad.find((p) => p.id === evB.playerId)!;
    const wage = pB.wage, budget = me.budget, mood = moraleOf(pB);
    resolveEvent(keep, evB.id, 2);
    expect(pB.wage).toBeGreaterThan(wage);
    expect(me.budget).toBeLessThan(budget);
    expect(moraleOf(pB)).toBeGreaterThan(mood);
    expect(pB.transferRequest).toBe(false);
  });

  it("raises the relegation scare only in the run-in, in the drop zone, and never in the bottom division", () => {
    const s = newGame(54, 0, "측정");
    playSeason(s);
    // force the user into the drop zone of the first division on the last rounds
    const me = s.clubs[s.userClub]!;
    me.division = 1;
    for (const f of s.fixtures) {
      if (f.home === me.id) f.score = [0, 4];
      else if (f.away === me.id) f.score = [4, 0];
    }
    s.round = seasonRounds(s) - 2;
    const bottom = divisionTable(s, 1).slice(-SWAP).map((r) => r.club);
    expect(bottom).toContain(me.id);
    const ev = force(s, "relegationFear");
    expect(ev.choices.length).toBe(3);
    expect(ev.text).toContain("강등권");

    // mid-season, the same table raises nothing
    const early = { ...s, round: 4, events: [] } as GameState;
    expect(() => force(early, "relegationFear")).toThrow();
  });

  it("the run-in choices split the dressing room the way they say they do", () => {
    const s = newGame(55, 0, "측정");
    playSeason(s);
    const me = s.clubs[s.userClub]!;
    me.division = 1;
    for (const f of s.fixtures) {
      if (f.home === me.id) f.score = [0, 4];
      else if (f.away === me.id) f.score = [4, 0];
    }
    s.round = seasonRounds(s) - 2;
    const ev = force(s, "relegationFear");
    const old = me.squad.filter((p) => p.age >= 29 && !p.onLoan);
    const young = me.squad.filter((p) => p.age <= 22 && !p.onLoan);
    const beforeOld = old.map((p) => moraleOf(p));
    const beforeYoung = young.map((p) => moraleOf(p));
    resolveEvent(s, ev.id, 0); // leaning on the veterans
    old.forEach((p, i) => expect(moraleOf(p)).toBeGreaterThanOrEqual(beforeOld[i]!));
    young.forEach((p, i) => expect(moraleOf(p)).toBeLessThanOrEqual(beforeYoung[i]!));
    if (old.length) expect(moraleOf(old[0]!)).toBeGreaterThan(beforeOld[0]!);
  });
});
