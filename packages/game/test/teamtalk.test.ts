import { describe, expect, it } from "vitest";
import {
  newGame, clubOf, giveTalk, talkOptions, talkGiven, toneFit, reactionOf, talkAttrDelta, moraleOf, TALK_MAX,
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

  it("at half time the score sets the room, not the form", () => {
    const ahead = ctx({ lead: 1 }), level = ctx({ lead: 0 }), behind = ctx({ lead: -3 });
    // calm holds a lead, a demand takes a level game, a rebuke is for a beating
    expect(toneFit("calm", ahead)).toBeGreaterThan(toneFit("demand", ahead));
    expect(toneFit("demand", level)).toBeGreaterThan(toneFit("calm", level));
    expect(toneFit("rebuke", behind)).toBeGreaterThan(toneFit("rebuke", level));
    // a rebuke while winning throws it away
    expect(toneFit("rebuke", ahead)).toBeLessThan(0);
    // the form no longer decides anything once the score does
    expect(toneFit("calm", ctx({ lead: 1, form: "LLLLL" }))).toBe(toneFit("calm", ctx({ lead: 1, form: "WWWWW" })));
  });

  it("half time speaks to the score, and the lines differ from the tunnel's", () => {
    const pre = talkOptions(ctx());
    const ahead = talkOptions(ctx({ lead: 2 }));
    const behind = talkOptions(ctx({ lead: -2 }));
    for (let i = 0; i < 4; i++) {
      expect(ahead[i]!.line).not.toBe(pre[i]!.line);
      expect(ahead[i]!.line).not.toBe(behind[i]!.line);
    }
  });

  it("a half-time talk reaches the pitch: the attribute move is the morale move, stretched", () => {
    const s = newGame(13);
    const me = clubOf(s, s.userClub)!;
    const before = new Map(me.squad.map((p) => [p.id, moraleOf(p)]));
    const r = giveTalk(s, me, "demand", ctx({ lead: 0 }), "r1:ht");
    const lifted = r.reactions.find((x) => x.delta > 1);
    expect(lifted).toBeDefined();
    const p = me.squad.find((q) => q.id === lifted!.id)!;
    const d = talkAttrDelta(p, before.get(p.id)!);
    // it moves the attributes morale moves, and by more than the lasting morale alone would
    expect(Object.keys(d).length).toBeGreaterThan(0);
    expect(d.composure ?? 0).toBeGreaterThan(0);
    const lasting = talkAttrDelta(p, before.get(p.id)!, 1);
    expect(d.composure!).toBeGreaterThan(lasting.composure ?? 0);
    // a player who took it badly loses attributes instead
    const hurt = r.reactions.find((x) => x.delta < -1);
    if (hurt) {
      const q = me.squad.find((y) => y.id === hurt.id)!;
      expect(talkAttrDelta(q, before.get(q.id)!).composure ?? 0).toBeLessThan(0);
    }
  });

  it("after the whistle the result sets the room", () => {
    const won = ctx({ lead: 2, final: true });
    const droppedTwo = ctx({ lead: 0, final: true, favourite: true });
    const wonOne = ctx({ lead: 0, final: true, favourite: false });
    const beaten = ctx({ lead: -3, final: true });
    // a win is praised, and a rebuke after one costs the room for nothing
    expect(toneFit("praise", won)).toBeGreaterThan(toneFit("demand", won));
    expect(toneFit("rebuke", won)).toBeLessThan(0);
    // the same draw reads differently depending on who dropped the points
    expect(toneFit("demand", droppedTwo)).toBeGreaterThan(toneFit("praise", droppedTwo));
    expect(toneFit("praise", wonOne)).toBeGreaterThan(toneFit("demand", wonOne));
    // a beating is the one result that answers to a rebuke
    expect(toneFit("rebuke", beaten)).toBeGreaterThan(toneFit("praise", beaten));
    // and full time is not half time: the same score reads differently once nothing can be rescued
    expect(toneFit("rebuke", ctx({ lead: 1, final: true }))).not.toBe(toneFit("rebuke", ctx({ lead: 1 })));
  });

  it("full time has its own lines", () => {
    const ht = talkOptions(ctx({ lead: 1 }));
    const ft = talkOptions(ctx({ lead: 1, final: true }));
    for (let i = 0; i < 4; i++) expect(ft[i]!.line).not.toBe(ht[i]!.line);
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
