import { describe, expect, it } from "vitest";
import {
  newGame, clubOf, giveTalk, talkOptions, talkGiven, toneFit, reactionOf, moraleOf, TALK_MAX,
  type TalkContext, type TalkTone,
} from "../src/index";

const ctx = (over: Partial<TalkContext> = {}): TalkContext =>
  ({ home: true, opponent: "포항", favourite: false, derby: false, form: "WDLDW", ...over });

const TONES: TalkTone[] = ["praise", "calm", "demand", "rebuke"];

describe("팀 토크", () => {
  it("offers four tones, each with a line written for the situation", () => {
    const plain = talkOptions(ctx());
    const derby = talkOptions(ctx({ derby: true }));
    expect(plain.map((o) => o.tone)).toEqual(TONES);
    for (const o of plain) expect(o.line.length).toBeGreaterThan(10);
    // the calm line knows it is a derby
    expect(derby[1]!.line).not.toBe(plain[1]!.line);
  });

  it("reads the room: a rebuke only suits a bad run, a demand suits the favourite", () => {
    expect(toneFit("rebuke", ctx({ form: "LLLLL" }))).toBeGreaterThan(toneFit("rebuke", ctx({ form: "WWWWW" })));
    expect(toneFit("demand", ctx({ favourite: true }))).toBeGreaterThan(toneFit("demand", ctx({ favourite: false })));
    expect(toneFit("praise", ctx({ favourite: false }))).toBeGreaterThan(toneFit("praise", ctx({ favourite: true })));
  });

  it("moves every starter's morale and never past the cap", () => {
    const s = newGame(7);
    const me = clubOf(s, s.userClub)!;
    const before = me.selection.starters.map((id) => moraleOf(me.squad.find((p) => p.id === id)!));
    const r = giveTalk(s, me, "praise", ctx({ form: "LLLDL" }), "r1");
    expect(r.reactions).toHaveLength(me.selection.starters.length);
    for (const x of r.reactions) expect(Math.abs(x.delta)).toBeLessThanOrEqual(TALK_MAX);
    const after = me.selection.starters.map((id) => moraleOf(me.squad.find((p) => p.id === id)!));
    expect(after).not.toEqual(before);
    // encouragement after a bad run lifts the room
    expect(r.lift).toBeGreaterThan(0);
    // reactions come back best first
    expect(r.reactions.map((x) => x.delta)).toEqual([...r.reactions.map((x) => x.delta)].sort((a, b) => b - a));
  });

  it("is deterministic: the same talk in the same room lands identically", () => {
    const a = newGame(11), b = newGame(11);
    const ra = giveTalk(a, clubOf(a, a.userClub)!, "demand", ctx({ favourite: true }), "r1");
    const rb = giveTalk(b, clubOf(b, b.userClub)!, "demand", ctx({ favourite: true }), "r1");
    expect(ra.reactions).toEqual(rb.reactions);
  });

  it("is once per fixture and remembers which one was given", () => {
    const s = newGame(3);
    expect(talkGiven(s, "r1")).toBe(false);
    giveTalk(s, clubOf(s, s.userClub)!, "calm", ctx(), "r1");
    expect(talkGiven(s, "r1")).toBe(true);
    expect(talkGiven(s, "r2")).toBe(false);
    expect(s.lastTalk?.tone).toBe("calm");
  });

  it("a rebuke splits the room: the hot heads take it worst, the professionals best", () => {
    const s = newGame(5);
    const me = clubOf(s, s.userClub)!;
    const c = ctx({ form: "LLLLD" });
    const rows = me.squad.slice(0, 20).map((p) => ({
      temper: p.personality?.temperament ?? 0.5,
      pro: p.personality?.professionalism ?? 0.5,
      d: reactionOf(p, "rebuke", c, 60),
    }));
    const hot = rows.filter((r) => r.temper > 0.7), cool = rows.filter((r) => r.temper < 0.3);
    if (hot.length && cool.length) {
      const avg = (xs: typeof rows) => xs.reduce((a, x) => a + x.d, 0) / xs.length;
      expect(avg(hot)).toBeLessThan(avg(cool));
    }
  });

  it("an unhappy dressing room takes everything worse than a settled one", () => {
    const s = newGame(9);
    const p = clubOf(s, s.userClub)!.squad[0]!;
    // compared on the sum so a tone that clamps at the cap on one side does not hide the difference
    const at = (room: number) => TONES.reduce((a, tone) => a + reactionOf(p, tone, ctx(), room), 0);
    expect(at(40)).toBeLessThan(at(80));
    for (const tone of TONES) expect(reactionOf(p, tone, ctx(), 40)).toBeLessThanOrEqual(reactionOf(p, tone, ctx(), 80));
  });
});
