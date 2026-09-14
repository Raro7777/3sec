import { describe, expect, it } from "vitest";
import {
  newGame, clubOf, giveTalk, talkOptions, talkGiven, toneFit, reactionOf, talkAttrDelta, moraleOf, TALK_MAX,
  heardFit, roomAverage, staleness, TONES,
  type TalkContext, type TalkTone,
} from "../src/index";

const ctx = (over: Partial<TalkContext> = {}): TalkContext =>
  ({ home: true, opponent: "포항", favourite: false, derby: false, form: "WDLDW", ...over });


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

  it("no tone is worth anything on its own: what pays is beating the other three", () => {
    // by construction the four tones average out to nothing in every situation, so there is no situation
    // where any tone can be picked for a free lift
    for (const over of [{}, { lead: 1 }, { lead: -2, final: true }, { favourite: true, form: "WWWWW" }]) {
      const c = ctx(over as Partial<TalkContext>);
      const spread = TONES.map((t) => heardFit(t, c) - roomAverage(c));
      expect(spread.reduce((a, b) => a + b, 0)).toBeCloseTo(0, 6);
      // and there is always a real choice: someone is clearly right and someone clearly wrong
      expect(Math.max(...spread) - Math.min(...spread)).toBeGreaterThan(1);
    }
  });

  it("saying the same thing stops working, and then turns", () => {
    const c = ctx({ form: "LLLDL" });
    const fresh = heardFit("praise", c, []);
    const twice = heardFit("praise", c, ["praise", "praise"]);
    const often = heardFit("praise", c, ["praise", "praise", "praise", "praise"]);
    expect(twice).toBeLessThan(fresh);
    expect(often).toBeLessThan(twice);
    // worn out, the room's best answer is no longer the one it has been hearing
    const worn: TalkTone[] = ["praise", "praise", "praise", "praise"];
    const best = TONES.reduce((b, t) => (heardFit(t, c, worn) > heardFit(b, c, worn) ? t : b));
    expect(best).not.toBe("praise");
    // another voice is untouched by it
    expect(heardFit("calm", c, worn)).toBe(heardFit("calm", c, []));
  });

  it("always being nice is worse than saying nothing in particular", () => {
    const sits: TalkContext[] = [];
    for (const favourite of [true, false]) for (const form of ["WWWDW", "LLDLL"]) {
      sits.push(ctx({ favourite, form }));
      for (const lead of [1, 0, -2]) { sits.push(ctx({ favourite, form, lead })); sits.push(ctx({ favourite, form, lead, final: true })); }
    }
    const strategy = (pick: (c: TalkContext, log: TalkTone[]) => TalkTone): number => {
      let sum = 0, log: TalkTone[] = [];
      for (const c of sits) {
        const s2 = newGame(6);
        s2.talkLog = [...log];
        const r = giveTalk(s2, clubOf(s2, s2.userClub)!, pick(c, log), c, "k");
        log = [...(s2.talkLog ?? [])];
        sum += r.lift;
      }
      return sum / sits.length;
    };
    const nice = strategy(() => "praise");
    const read = strategy((c, log) => TONES.reduce((b, t) => (heardFit(t, c, log) > heardFit(b, c, log) ? t : b)));
    expect(nice).toBeLessThan(0);
    expect(read).toBeGreaterThan(1);
    expect(read).toBeGreaterThan(nice + 3);
  });

  it("words are worth most to a squad that needs them", () => {
    const c = ctx({ form: "LLLDL" });
    const s = newGame(21);
    const p = clubOf(s, s.userClub)!.squad[0]!;
    const at = (morale: number) => reactionOf({ ...p, morale } as typeof p, "praise", c, 60);
    // the same talk to a player at 55 and one at 95: the one who needs it moves further
    expect(at(55)).toBeGreaterThan(at(95));
    // and a room already at the ceiling barely moves at all
    expect(Math.abs(at(98))).toBeLessThan(Math.abs(at(55)) * 0.35);
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
