import { describe, expect, it } from "vitest";
import type { Match } from "@3sec/engine";
import {
  MATCH_ATTR_SWING, MORALE, MORALE_START, adjustMorale, answerInterview, captainOf, deserialize, ensureCaptain, interviewContext, leadership, lockerRoom, matchAttrs, moraleOf, moraleTrainingFactor,
  moraleWeek, newGame, personalityFromId, personalityOf, pressConference, rejectOffer, serialize, setCaptain, simulateRound, skipInterview, trainWeek, type GameState, type SquadPlayer, type TransferOffer,
} from "../src/index";

const SHORT = { halfLength: 3 * 60 };
const trait = (p: SquadPlayer, t: Partial<SquadPlayer["personality"] & object>): void => { p.personality = { ...personalityOf(p), ...t }; };

describe("morale: personality", () => {
  it("personalityFromId is deterministic, inside 0..1 and varies between ids", () => {
    const a = personalityFromId("C0-1"), b = personalityFromId("C0-1"), c = personalityFromId("C0-2");
    expect(a).toEqual(b);
    for (const v of Object.values(a)) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); }
    const all = Array.from({ length: 40 }, (_, i) => personalityFromId(`C1-${i + 1}`));
    const ambitions = new Set(all.map((t) => t.ambition));
    expect(ambitions.size).toBeGreaterThan(20);
    expect(a).not.toEqual(c);
  });

  it("a new game gives every player a personality and the start morale, every club a captain and a locker room", () => {
    const s = newGame(21, 0);
    for (const c of s.clubs) {
      for (const p of c.squad) {
        expect(p.personality).toEqual(personalityFromId(p.id));
        expect(p.morale).toBe(MORALE_START);
      }
      const cap = captainOf(c)!;
      expect(cap).toBeTruthy();
      expect(c.squad.includes(cap)).toBe(true);
      // the AI armband goes to the oldest
      expect(cap.age).toBe(Math.max(...c.squad.map((p) => p.age)));
      expect(c.lockerRoom).toBeGreaterThanOrEqual(0);
      expect(c.lockerRoom).toBeLessThanOrEqual(100);
    }
  });

  it("adjustMorale clamps to 0..100 and a content player withdraws his transfer request", () => {
    const s = newGame(22, 0);
    const p = s.clubs[0]!.squad[0]!;
    adjustMorale(p, 500);
    expect(p.morale).toBe(100);
    adjustMorale(p, -500);
    expect(p.morale).toBe(0);
    p.transferRequest = true;
    adjustMorale(p, 50);
    expect(p.transferRequest).toBe(true);
    adjustMorale(p, 10);
    expect(p.transferRequest).toBeUndefined();
  });
});

describe("morale: effects", () => {
  it("the training factor runs 0.85..1.15 with morale and professionalism", () => {
    const s = newGame(23, 0);
    const p = s.clubs[0]!.squad[3]!;
    p.morale = 0; trait(p, { professionalism: 0 });
    expect(moraleTrainingFactor(p)).toBe(0.85);
    p.morale = 100;
    expect(moraleTrainingFactor(p)).toBe(1.15);
    trait(p, { professionalism: 1 });
    expect(moraleTrainingFactor(p)).toBe(1.05);
    p.morale = MORALE_START; trait(p, { professionalism: 0.2 });
    expect(moraleTrainingFactor(p)).toBe(1);
  });

  it("match attributes move by at most ±0.4 with morale and a hot head loses composure", () => {
    const s = newGame(24, 0);
    const p = s.clubs[0]!.squad[5]!;
    p.morale = MORALE_START; trait(p, { temperament: 0.2 });
    expect(matchAttrs(p)).toEqual(p.attrs);
    p.morale = 100;
    const hi = matchAttrs(p);
    for (const k of Object.keys(p.attrs) as (keyof typeof p.attrs)[]) expect(hi[k]).toBeCloseTo(Math.min(20, p.attrs[k] + MATCH_ATTR_SWING), 5);
    p.morale = 0;
    const lo = matchAttrs(p);
    for (const k of Object.keys(p.attrs) as (keyof typeof p.attrs)[]) expect(lo[k]).toBeCloseTo(Math.max(1, p.attrs[k] - MATCH_ATTR_SWING), 5);
    p.morale = MORALE_START; trait(p, { temperament: 1 });
    expect(matchAttrs(p).composure).toBeCloseTo(Math.max(1, p.attrs.composure - 1), 5);
    expect(matchAttrs(p).passing).toBe(p.attrs.passing);
    // the engine sees the tweak, the squad keeps its integers
    expect(Number.isInteger(p.attrs.composure)).toBe(true);
  });

  it("the week: starters rise, an unused ambitious player falls, everything stays in 0..100", () => {
    const s = newGame(25, 0);
    const me = s.clubs[0]!;
    const f = s.fixtures.find((x) => x.round === 0 && (x.home === 0 || x.away === 0))!;
    f.score = [1, 1]; // a draw: the unused-player penalty is not masked by the result swing
    const starters = new Set(me.selection.starters);
    for (const p of me.squad) { p.morale = MORALE_START; p.lastMinutes = starters.has(p.id) ? 90 : 0; trait(p, { professionalism: 0.5, loyalty: 0.5 }); }
    const bench = me.squad.filter((p) => !starters.has(p.id));
    trait(bench[0]!, { ambition: 1 });
    trait(bench[1]!, { ambition: 0 });
    s.round = 1;
    moraleWeek(s);
    for (const id of starters) expect(moraleOf(me.squad.find((p) => p.id === id)!)).toBeGreaterThan(MORALE_START);
    expect(moraleOf(bench[0]!)).toBeLessThan(MORALE_START);
    expect(moraleOf(bench[0]!)).toBeLessThan(moraleOf(bench[1]!));
    for (const c of s.clubs) for (const p of c.squad) { expect(p.morale).toBeGreaterThanOrEqual(0); expect(p.morale).toBeLessThanOrEqual(100); }
    expect(typeof me.lockerRoom).toBe("number");
  });

  it("two weeks in the dumps: an ambitious player asks away, a placid one refuses a week of training", () => {
    const s = newGame(26, 0);
    const me = s.clubs[0]!;
    for (const p of me.squad) p.lastMinutes = 30;
    const [a, b] = me.squad;
    a!.morale = 15; trait(a!, { ambition: 0.9, professionalism: 0.5 });
    b!.morale = 15; trait(b!, { ambition: 0.1, professionalism: 0.5 });
    s.round = 1;
    moraleWeek(s);
    expect(a!.transferRequest).toBeUndefined();
    expect(a!.lowMoraleWeeks).toBe(1);
    s.round = 2;
    const complained = moraleWeek(s);
    expect(complained).toContain(a);
    expect(complained).toContain(b);
    expect(a!.transferRequest).toBe(true);
    expect(b!.trainingRefused).toBe(true);
    expect(s.news.some((n) => n.startsWith(`불만: ${a!.name}`) && n.includes("이적을 요청"))).toBe(true);
    expect(s.news.some((n) => n.startsWith(`불만: ${b!.name}`) && n.includes("훈련을 거부"))).toBe(true);
    // the refusal costs the week's growth and is consumed by training
    b!.age = 19; b!.potential = 20; b!.growth = 0.2;
    trainWeek(me, { next: () => 0.5 });
    expect(b!.growth).toBe(0.2);
    expect(b!.trainingRefused).toBeUndefined();
  });

  it("captain: the user appoints one, a loyal professional lifts the locker room", () => {
    const s = newGame(27, 0);
    const me = s.clubs[0]!;
    expect(setCaptain(s, "nope")).toBeTruthy();
    const p = me.squad.find((q) => q.id !== me.captain)!;
    p.morale = MORALE_START;
    expect(setCaptain(s, p.id)).toBeNull();
    expect(me.captain).toBe(p.id);
    expect(p.morale).toBe(MORALE_START + 5);
    expect(s.news[0]).toContain(`${p.name}이(가) 새 주장`);
    expect(setCaptain(s, p.id)).toBe("이미 주장입니다");
    for (const q of me.squad) q.morale = MORALE_START;
    trait(p, { loyalty: 0.9, professionalism: 0.9 });
    expect(leadership(p)).toBeGreaterThan(0.6);
    expect(lockerRoom(me)).toBe(MORALE_START + MORALE.captainLift);
    trait(p, { loyalty: 0.1, professionalism: 0.1 });
    expect(lockerRoom(me)).toBe(MORALE_START);
    // the armband moves on when the captain is gone
    me.squad = me.squad.filter((q) => q !== p);
    expect(ensureCaptain(me)!.id).not.toBe(p.id);
  });

  it("a refused bid sours the player", () => {
    const s = newGame(28, 0);
    const me = s.clubs[0]!;
    const p = me.squad[4]!;
    p.morale = MORALE_START;
    const o: TransferOffer = { id: "o-test", from: 1, playerId: p.id, fee: 10, expiresRound: 5, status: "open" };
    s.offers.push(o);
    expect(rejectOffer(s, o.id)).toBeNull();
    expect(p.morale).toBeLessThan(MORALE_START);
  });

  it("an old save without personalities loads with hash-derived traits, morale 60 and a captain", () => {
    const s = newGame(29, 0);
    const raw = JSON.parse(serialize(s));
    for (const c of raw.clubs) { delete c.captain; delete c.lockerRoom; for (const p of c.squad) { delete p.personality; delete p.morale; } }
    delete raw.events; delete raw.eventLog;
    const loaded = deserialize(JSON.stringify(raw))!;
    for (const c of loaded.clubs) {
      expect(c.captain).toBe(s.clubs[c.id]!.captain);
      expect(typeof c.lockerRoom).toBe("number");
      for (const p of c.squad) { expect(p.personality).toEqual(personalityFromId(p.id)); expect(p.morale).toBe(MORALE_START); }
    }
    expect(loaded.events).toEqual([]);
    expect(loaded.eventLog).toEqual([]);
  });
});

describe("press: interviews", () => {
  function played(seed: number): GameState {
    const s = newGame(seed, 0);
    simulateRound(s, SHORT);
    return s;
  }

  it("the user's match leaves an interview with praise / criticism / neutral answers, and an answer applies its effects", () => {
    const s = played(31);
    const iv = s.pendingInterview!;
    expect(iv).toBeTruthy();
    expect(iv.options.map((o) => o.kind)).toEqual(["praise", "criticize", "neutral"]);
    expect(iv.question.length).toBeGreaterThan(5);
    const me = s.clubs[0]!;
    const before = me.squad.map((p) => moraleOf(p));
    const conf = s.board.confidence, mood = me.fans.mood;
    const o = iv.options[1]!;
    expect(answerInterview(s, 1)).toBeNull();
    me.squad.forEach((p, i) => { if (!p.onLoan && p.id !== iv.playerId) expect(moraleOf(p)).toBe(Math.max(0, Math.min(100, before[i]! + o.squad))); });
    expect(s.board.confidence).toBe(Math.max(0, Math.min(100, conf + o.board)));
    expect(me.fans.mood).toBeCloseTo(Math.max(0, Math.min(100, mood + o.fans)), 5);
    expect(s.pendingInterview).toBeUndefined();
    expect(s.news[0]).toContain("인터뷰:");
    expect(answerInterview(s, 0)).toBeTruthy();
  });

  it("skipping applies the neutral answer; a new press conference settles an old interview first", () => {
    const s = played(32);
    const iv = s.pendingInterview!;
    const neutral = iv.options.find((o) => o.kind === "neutral")!;
    skipInterview(s);
    expect(s.pendingInterview).toBeUndefined();
    expect(s.news[0]).toContain(neutral.reply);
    // a fake finished match is enough for the press: an old interview is answered neutrally before the new one lands
    s.pendingInterview = { ...iv, id: "iv-old" };
    const f = s.fixtures.find((x) => x.round === 0 && (x.home === 0 || x.away === 0))!;
    const m = { state: { events: [], players: [] } } as unknown as Match;
    const next = pressConference(s, f, m, false)!;
    expect(next.id).not.toBe("iv-old");
    expect(s.pendingInterview).toBe(next);
    expect(s.news.some((n) => n.includes(neutral.reply))).toBe(true);
    // not the user's match: nothing
    const other = s.fixtures.find((x) => x.round === 0 && x.home !== 0 && x.away !== 0)!;
    s.pendingInterview = undefined;
    expect(pressConference(s, other, m, false)).toBeNull();
    expect(s.pendingInterview).toBeUndefined();
  });

  it("the context follows the result: derby, big win, heavy loss, a youngster's goal, a star's flop", () => {
    const s = newGame(33, 0);
    const me = s.clubs[0]!;
    const ctx = (opp: number, gf: number, ga: number, player?: SquadPlayer) => interviewContext({ s, me, opp: s.clubs[opp]!, gf, ga, cup: false, player });
    expect(ctx(2, 1, 0)).toBe("derby_win");
    expect(ctx(2, 0, 1)).toBe("derby_loss");
    expect(ctx(1, 3, 0)).toBe("big_win");
    expect(ctx(1, 0, 3)).toBe("heavy_loss");
    expect(ctx(1, 1, 0)).toBe("win");
    expect(ctx(1, 1, 1)).toBe("draw");
    expect(ctx(1, 0, 1)).toBe("loss");
    const kid = { ...me.squad[0]!, age: 19 };
    expect(ctx(1, 1, 0, kid)).toBe("youngster");
    const star = { ...me.squad[0]!, age: 29, form: [5.5] };
    expect(ctx(1, 0, 1, star)).toBe("star_flop");
  });
});
