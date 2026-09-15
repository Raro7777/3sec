import { describe, expect, it } from "vitest";
import type { Match, Rng } from "@3sec/engine";
import {
  AWAY_BUS_COST, CAP_MORALE, CAP_RATING, EVENT_LOG_MAX, MORALE_START, PHYSIO_COST, SCOUT_TIP_COST, STORY_TEMPLATES, STORY_TTL, deserialize, moraleOf, newGame, pendingEvents, personalityOf,
  resolveEvent, scoutedProspect, serialize, storyMatch, storyRollover, storyWeek, type GameState, type StoryEvent, type StoryTemplateId,
} from "../src/index";

/** A die that always says yes to a chance and returns a fixed fraction otherwise. */
const forced = (next = 0, chance = true): Rng => ({ next: () => next, chance: () => chance, int: (lo: number) => lo, range: (lo: number) => lo, pick: <T>(a: T[]) => a[0]!, gauss: () => 0 }) as unknown as Rng;

/** Like `forced`, but `next` cycles through the given values: [0.99, 0] skips the urgent draw and takes the first evergreen template. */
const cycling = (vals: number[], chance = true): Rng => { let i = 0; return { next: () => vals[i++ % vals.length]!, chance: () => chance, int: (lo: number) => lo, range: (lo: number) => lo, pick: <T>(a: T[]) => a[0]!, gauss: () => 0 } as unknown as Rng; };
const evergreen = (): Rng => cycling([0.99, 0]);

/** A hand-made pending event for a template (resolveEvent only needs the fields). */
function push(s: GameState, template: StoryTemplateId, extra: Partial<StoryEvent> = {}): StoryEvent {
  const ev: StoryEvent = { id: `ev-t-${template}-${(s.events ?? []).length}`, template, season: s.season, round: s.round, title: template, text: "", choices: [{ label: "A", hint: "" }, { label: "B", hint: "" }, { label: "C", hint: "" }], expiresRound: s.round + STORY_TTL, ...extra };
  (s.events ??= []).push(ev);
  return ev;
}

describe("story: events", () => {
  it("has at least ten templates and a forced week creates one pending event, no second while it waits", () => {
    expect(STORY_TEMPLATES.length).toBeGreaterThanOrEqual(10);
    const s = newGame(41, 0);
    const ev = storyWeek(s, evergreen())!;
    expect(ev).toBeTruthy();
    expect(ev.template).toBe("sponsor");
    expect(ev.choices.length).toBeGreaterThanOrEqual(2);
    expect(pendingEvents(s)).toEqual([ev]);
    expect(s.news[0]).toContain(ev.title);
    expect(storyWeek(s, forced(0))).toBeNull();
    expect(pendingEvents(s).length).toBe(1);
    // an unforced die at 25 % never fires when chance says no
    s.events = [];
    expect(storyWeek(s, forced(0, false))).toBeNull();
  });

  it("resolveEvent applies the choice, logs the event and refuses unknown ids or choices", () => {
    const s = newGame(42, 0);
    const me = s.clubs[0]!;
    const ev = storyWeek(s, forced(0))!;
    const budget = me.budget, mood = me.fans.mood;
    expect(resolveEvent(s, "nope", 0)).toBeNull();
    expect(resolveEvent(s, ev.id, 9)).toBeNull();
    const out = resolveEvent(s, ev.id, 0);
    expect(typeof out).toBe("string");
    expect(me.budget).toBeCloseTo(budget + ev.amount!, 5);
    expect(me.fans.mood).toBeCloseTo(mood - 4, 5);
    expect(pendingEvents(s)).toEqual([]);
    expect(s.eventLog![0]).toBe(ev);
    expect(ev.resolved).toEqual({ choice: 0, outcome: out, round: s.round });
    expect(resolveEvent(s, ev.id, 0)).toBeNull();
    expect(s.news[0]).toContain(ev.title);
  });

  it("a stale event settles itself with the last choice at the next story tick", () => {
    const s = newGame(43, 0);
    const me = s.clubs[0]!;
    const ev = storyWeek(s, evergreen())!;
    const mood = me.fans.mood;
    s.round += STORY_TTL;
    storyWeek(s, forced(0, false));
    expect(pendingEvents(s)).toEqual([]);
    expect(ev.resolved?.auto).toBe(true);
    expect(ev.resolved?.choice).toBe(ev.choices.length - 1);
    expect(me.fans.mood).toBeCloseTo(mood + 2, 5);
    expect(s.news[0]).toContain("자동 처리");
  });

  it("a sweep over the templates: every choice resolves without error and lands in the log", () => {
    const s = newGame(44, 0);
    const me = s.clubs[0]!;
    me.budget = 200;
    // make the conditional templates possible
    me.squad[0]!.injuryDays = 20; me.squad[1]!.injuryDays = 20; me.squad[2]!.injuryDays = 20;
    me.squad[3]!.youthProduct = true; me.squad[3]!.stats.apps = 0;
    const seen = new Set<StoryTemplateId>();
    let n = 0;
    for (let r = 0; r < 40; r++) {
      s.round = r % 26;
      const ev = storyWeek(s, forced(((r * 7) % 10) / 10));
      if (!ev) continue;
      seen.add(ev.template);
      const out = resolveEvent(s, ev.id, r % ev.choices.length);
      expect(typeof out).toBe("string");
      n++;
    }
    expect(seen.size).toBeGreaterThanOrEqual(6);
    expect(s.eventLog!.length).toBe(Math.min(n, EVENT_LOG_MAX));
    for (const c of s.clubs) for (const p of c.squad) { expect(p.morale).toBeGreaterThanOrEqual(0); expect(p.morale).toBeLessThanOrEqual(100); }
  });

  it("template effects: scouting tip adds a prospect, a leave sidelines the player, the bus costs money, the physio heals, the coach leaves", () => {
    const s = newGame(45, 0);
    const me = s.clubs[0]!;
    me.budget = 50;
    // 유망주 발굴
    const before = me.youth.prospects.length;
    resolveEvent(s, push(s, "prospectTip", { amount: SCOUT_TIP_COST }).id, 0);
    expect(me.youth.prospects.length).toBe(before + 1);
    expect(me.budget).toBeCloseTo(50 - SCOUT_TIP_COST, 5);
    const y = me.youth.prospects[me.youth.prospects.length - 1]!;
    expect(y.potentialRange[0]).toBeGreaterThanOrEqual(y.truePotential - 1.5);
    // 선수 개인사
    const p = me.squad.find((q) => q.injuryDays === 0)!;
    p.morale = MORALE_START;
    resolveEvent(s, push(s, "personalLeave", { playerId: p.id }).id, 0);
    expect(p.morale).toBeGreaterThanOrEqual(MORALE_START + 10);
    expect(p.injuryDays).toBeGreaterThanOrEqual(6);
    const q = me.squad.find((x) => x !== p)!;
    q.morale = MORALE_START;
    resolveEvent(s, push(s, "personalLeave", { playerId: q.id }).id, 1);
    expect(q.morale).toBe(MORALE_START - 12);
    // 원정 팬 버스
    const mood = me.fans.mood, budget = me.budget;
    resolveEvent(s, push(s, "awayBus", { amount: AWAY_BUS_COST }).id, 0);
    expect(me.budget).toBeCloseTo(budget - AWAY_BUS_COST, 5);
    expect(me.fans.mood).toBeCloseTo(mood + 5, 5);
    // 부상 위기
    me.squad[0]!.injuryDays = 30;
    resolveEvent(s, push(s, "injuryCrisis", { amount: PHYSIO_COST }).id, 0);
    expect(me.squad[0]!.injuryDays).toBe(23);
    // 코치 이직
    const coach = me.staff.find((m) => m.role === "assistant")!;
    resolveEvent(s, push(s, "coachOffer", { staffId: coach.id, amount: 0.5 }).id, 1);
    expect(me.staff.includes(coach)).toBe(false);
    // 라커룸 갈등: a strong captain reconciles, a weak one fails
    const [a, b] = me.squad.filter((x) => x.injuryDays === 0);
    const cap = me.squad.find((x) => x.id === me.captain)!;
    cap.personality = { ...personalityOf(cap), loyalty: 1, professionalism: 1 };
    a!.morale = 50; b!.morale = 50;
    resolveEvent(s, push(s, "lockerConflict", { playerId: a!.id, playerId2: b!.id }).id, 0);
    expect(a!.morale).toBe(56);
    cap.personality = { ...personalityOf(cap), loyalty: 0, professionalism: 0 };
    resolveEvent(s, push(s, "lockerConflict", { playerId: a!.id, playerId2: b!.id }).id, 0);
    expect(a!.morale).toBe(53);
    // 이사회 요구
    const conf = s.board.confidence;
    resolveEvent(s, push(s, "boardDemand", { amount: 4 }).id, 0);
    expect(s.board.confidence).toBe(Math.min(100, conf + 3));
  });

  it("scoutedProspect is deterministic for a key and lifts the ceiling", () => {
    const a = newGame(46, 0), b = newGame(46, 0);
    const pa = scoutedProspect(a, a.clubs[0]!, "key", 2), pb = scoutedProspect(b, b.clubs[0]!, "key", 2);
    expect(pa).toEqual(pb);
    expect(pa.truePotential).toBeGreaterThanOrEqual(Math.min(20, pa.potentialRange[0]));
    expect(a.clubs[0]!.youth.prospects).toContain(pa);
  });
});

describe("story: narrative news", () => {
  const fakeMatch = (side: 0 | 1, ids: string[], scorer?: string): Match =>
    ({ state: { events: scorer ? [{ type: "GOAL", team: side, playerId: scorer }] : [], players: ids.map((id) => ({ id, team: side, distance: 9000 })) } }) as unknown as Match;

  it("a youth product's debut and a first senior goal make the news and lift morale", () => {
    const s = newGame(51, 0);
    const me = s.clubs[0]!;
    const f = s.fixtures.find((x) => x.round === 0 && x.home === 0) ?? s.fixtures.find((x) => x.round === 0 && x.away === 0)!;
    const side: 0 | 1 = f.home === 0 ? 0 : 1;
    const kid = me.squad[10]!;
    kid.youthProduct = true; kid.age = 18; kid.stats.apps = 1; kid.stats.goals = 1; kid.career = []; kid.morale = MORALE_START;
    storyMatch(s, f, fakeMatch(side, [kid.id], kid.id));
    expect(s.news[0]).toContain("데뷔");
    expect(s.news[0]).toContain("데뷔골");
    expect(kid.morale).toBe(MORALE_START + 4);
    const vet = me.squad[11]!;
    vet.age = 26; vet.stats.apps = 5; vet.stats.goals = 1; vet.career = [{ season: 0, club: 0, apps: 20, goals: 0, assists: 0, rating: 6.5 }]; vet.morale = MORALE_START;
    storyMatch(s, f, fakeMatch(side, [vet.id], vet.id));
    expect(s.news[0]).toContain("첫 골");
    expect(vet.morale).toBe(MORALE_START + 4);
  });

  it("a loan returnee scoring against his old club is a story", () => {
    const s = newGame(52, 0);
    const f = s.fixtures.find((x) => x.round === 0 && (x.home === 0 || x.away === 0))!;
    const side: 0 | 1 = f.home === 0 ? 0 : 1;
    const opp = side === 0 ? f.away : f.home;
    const p = s.clubs[0]!.squad[12]!;
    p.stats.apps = 9; p.stats.goals = 3; p.career = [{ season: 0, club: 0, apps: 9, goals: 3, assists: 0, rating: 7 }];
    p.lastLoanClub = opp;
    storyMatch(s, f, fakeMatch(side, [p.id], p.id));
    expect(s.news[0]).toContain("친정팀");
    expect(s.news[0]).toContain(p.name);
  });

  it("a national-team call-up for a good young player, once a season, with a morale lift", () => {
    const s = newGame(53, 0);
    const me = s.clubs[0]!;
    for (const c of s.clubs) for (const p of c.squad) p.age = 30; // nobody else qualifies
    const p = me.squad[7]!;
    p.age = 24;
    for (const k of Object.keys(p.attrs) as (keyof typeof p.attrs)[]) p.attrs[k] = CAP_RATING + 2;
    p.morale = MORALE_START;
    storyWeek(s, forced(0.5));
    expect(p.capSeason).toBe(s.season);
    expect(p.morale).toBe(MORALE_START + CAP_MORALE);
    expect(s.news.some((n) => n.startsWith("국가대표 발탁") && n.includes(p.name))).toBe(true);
    const n = s.news.filter((x) => x.startsWith("국가대표 발탁")).length;
    storyWeek(s, forced(0.5));
    expect(s.news.filter((x) => x.startsWith("국가대표 발탁")).length).toBe(n);
  });

  it("the rollover settles pending events and an old save loads with empty queues", () => {
    const s = newGame(54, 0);
    const ev = storyWeek(s, forced(0))!;
    storyRollover(s);
    expect(pendingEvents(s)).toEqual([]);
    expect(ev.resolved?.auto).toBe(true);
    const raw = JSON.parse(serialize(s));
    delete raw.events; delete raw.eventLog; delete raw.storyFlags; delete raw.pendingInterview;
    const loaded = deserialize(JSON.stringify(raw))!;
    expect(loaded.events).toEqual([]);
    expect(loaded.eventLog).toEqual([]);
    expect(loaded.storyFlags).toEqual([]);
    expect(moraleOf(loaded.clubs[0]!.squad[0]!)).toBeGreaterThanOrEqual(0);
  });
});
