import { describe, expect, it } from "vitest";
import { Rng } from "@3sec/engine";
import {
  PRESSURE_LIMIT, TRAIT_IDS, adaptsTo, askingPrice, boardReview, buildClubs, deserialize, differentManager, expectedPositions, generateManager, managerFormation,
  managerOfYear, managerRollover, managerTactics, managerTags, managerTraining, newGame, playerValue, prepareRound, roundsPerSeason, serialize, simulateRound,
  startNextSeason, table, traitDistance, type Club, type Manager,
} from "../src/index";

const SHORT = { halfLength: 4 * 60 };

/** A manager with every trait at 0.5 except the given overrides. */
const mk = (over: Partial<Manager["traits"]>, id = "T"): Manager => ({
  id, name: "테스트", age: 45, since: 1, history: [],
  traits: { attack: 0.5, possession: 0.5, pressing: 0.5, pragmatism: 0.5, youth: 0.5, spending: 0.5, stubborn: 0.5, temper: 0.5, ...over },
});

describe("manager generation", () => {
  it("is deterministic per seed, gives every AI club a Korean-named manager with traits in 0..1 and the user none", () => {
    const a = buildClubs(7), b = buildClubs(7);
    expect(a.map((c) => c.manager)).toEqual(b.map((c) => c.manager));
    for (const c of a) {
      const m = c.manager!;
      expect(m).toBeTruthy();
      expect(m.name).toMatch(/^[가-힣]{2,4}$/);
      expect(m.age).toBeGreaterThanOrEqual(36);
      for (const k of TRAIT_IDS) { expect(m.traits[k]).toBeGreaterThanOrEqual(0); expect(m.traits[k]).toBeLessThanOrEqual(1); }
      expect(c.pressure).toBe(0);
    }
    const ids = new Set(a.map((c) => c.manager!.id));
    expect(ids.size).toBe(a.length);
    expect(buildClubs(8).map((c) => c.manager!.name).join()).not.toBe(a.map((c) => c.manager!.name).join());
    const s = newGame(7, 3);
    expect(s.clubs[3]!.manager).toBeNull();
    expect(s.clubs[0]!.manager).toEqual(a[0]!.manager);
    expect(s.freeManagers).toEqual([]);
    // the squads are untouched by the dice the manager consumes
    expect(s.clubs[5]!.squad.map((p) => p.name)).toEqual(a[5]!.squad.map((p) => p.name));
  });

  it("a replacement differs on at least two traits by 0.4 and tags describe the strongest traits", () => {
    const rng = new Rng(3);
    for (let i = 0; i < 20; i++) {
      const old = generateManager(rng, 1, `A${i}`);
      const fresh = differentManager(rng, 2, `B${i}`, old);
      expect(traitDistance(old.traits, fresh.traits)).toBeGreaterThanOrEqual(2);
      expect(fresh.id).toBe(`B${i}`);
      expect(managerTags(fresh).length).toBeLessThanOrEqual(3);
    }
    expect(managerTags(mk({ attack: 0.9, possession: 0.1, youth: 0.8 }))).toEqual(["공격적", "롱볼", "유스 중시"]);
    expect(managerTags(mk({ attack: 0.2, spending: 0.1, stubborn: 0.9, temper: 0.7 }))).toEqual(["짠물", "협상 강경", "수비적"]);
    expect(managerTags(mk({}))).toEqual([]);
  });
});

describe("style → tactics", () => {
  const club = (): Club => buildClubs(11)[2]!;

  it("more attacking managers set a higher mentality, line and tempo; possession men play shorter; formations follow the style", () => {
    const c = club();
    let prev = -1;
    for (const attack of [0.1, 0.3, 0.5, 0.7, 0.9]) {
      const t = managerTactics(mk({ attack }), c);
      expect(t.mentality).toBeGreaterThan(prev);
      prev = t.mentality;
      for (const k of ["mentality", "defensiveLine", "pressing", "directness", "width", "tempo", "counter", "engageLine"] as const) {
        expect(t[k]).toBeGreaterThanOrEqual(0);
        expect(t[k]).toBeLessThanOrEqual(1);
      }
      expect(t.roles!.length).toBe(11);
    }
    expect(managerTactics(mk({ attack: 0.9 }), c).tempo).toBeGreaterThan(managerTactics(mk({ attack: 0.2 }), c).tempo);
    expect(managerTactics(mk({ possession: 0.9 }), c).directness).toBeLessThan(managerTactics(mk({ possession: 0.1 }), c).directness);
    expect(managerTactics(mk({ possession: 0.9 }), c).counter).toBeLessThan(managerTactics(mk({ possession: 0.1 }), c).counter);
    expect(managerTactics(mk({ pressing: 0.9 }), c).pressing).toBeGreaterThan(managerTactics(mk({ pressing: 0.1 }), c).pressing);
    expect(managerTactics(mk({ attack: 0.8, pragmatism: 0.2 }), c).offsideTrap).toBe(true);
    expect(managerTactics(mk({ attack: 0.8, pragmatism: 0.8 }), c).offsideTrap).toBe(false);
    // a hot head is that bit more extreme
    expect(managerTactics(mk({ attack: 0.8, temper: 0.9 }), c).mentality).toBeGreaterThan(managerTactics(mk({ attack: 0.8, temper: 0.2 }), c).mentality);
    expect(["4-3-3", "4-2-3-1"]).toContain(managerFormation(mk({ possession: 0.8 }), "3-5-2"));
    expect(["4-4-2", "3-5-2"]).toContain(managerFormation(mk({ attack: 0.2 }), "4-3-3"));
    expect(managerFormation(mk({}), "4-3-3")).toBe("4-3-3");
    // attacking men push the full-backs and wide men forward, cautious ones lock them down
    const atk = managerTactics(mk({ attack: 0.9 }), c).roles!;
    expect(atk[1]).toBe("WB"); expect(atk[4]).toBe("WB");
    const def = managerTactics(mk({ attack: 0.1 }), c).roles!;
    expect(def[1]).toBe("DFB"); expect(def[4]).toBe("DFB");
    expect(managerTraining(mk({ attack: 0.9, temper: 0.9 }))).toEqual({ focus: "attacking", intensity: "high" });
    expect(managerTraining(mk({ pressing: 0.9 }))).toEqual({ focus: "physical", intensity: "normal" });
  });

  it("a pragmatist sits deeper against a bigger side; an idealist never changes", () => {
    const clubs = buildClubs(11);
    const weak = clubs[10]!; // 제주, reputation 10.5
    const strong = clubs[7]!; // 울산, reputation 14
    const prag = mk({ pragmatism: 0.9 });
    const ideal = mk({ pragmatism: 0.1 });
    expect(adaptsTo(prag, weak, strong)).toBe(true);
    expect(adaptsTo(prag, strong, weak)).toBe(false);
    expect(adaptsTo(ideal, weak, strong)).toBe(false);
    const base = managerTactics(prag, weak, null), vs = managerTactics(prag, weak, strong);
    expect(vs.mentality).toBeCloseTo(base.mentality - 0.15, 5);
    expect(vs.defensiveLine).toBeCloseTo(base.defensiveLine - 0.15, 5);
    expect(vs.directness).toBeCloseTo(base.directness + 0.15, 5);
    expect(vs.counter).toBeCloseTo(base.counter + 0.2, 5);
    expect(managerTactics(prag, weak, weak)).toEqual(base);
    expect(managerTactics(ideal, weak, strong)).toEqual(managerTactics(ideal, weak, null));
    // prepareRound applies the manager's setup to every AI club
    const s = newGame(11, 0);
    prepareRound(s);
    for (const c of s.clubs) if (c.manager) {
      expect(c.tactics.formation).toBe(c.selection.formation);
      expect(c.tactics.mentality).toBeCloseTo(managerTactics(c.manager, c, s.clubs.find((o) => o !== c && s.fixtures.some((f) => f.round === 0 && ((f.home === c.id && f.away === o.id) || (f.away === c.id && f.home === o.id))))!).mentality, 5);
    }
  });
});

describe("market policy", () => {
  it("a youth-minded manager refuses to sell a 20-year-old cheaply and a hard negotiator adds 10%", () => {
    const s = newGame(12, 0);
    const seller = s.clubs[4]!;
    const kid = seller.squad.find((p) => !seller.selection.starters.slice(0, 3).includes(p.id))!;
    kid.age = 20;
    seller.manager = mk({ youth: 0.5, stubborn: 0.5 });
    const plain = askingPrice(seller, kid)!;
    expect(plain).toBeGreaterThanOrEqual(playerValue(kid));
    seller.manager = mk({ youth: 0.9 });
    expect(Math.abs(askingPrice(seller, kid)! - plain * 1.6)).toBeLessThanOrEqual(1);
    seller.manager = mk({ stubborn: 0.9 });
    expect(Math.abs(askingPrice(seller, kid)! - plain * 1.1)).toBeLessThanOrEqual(1);
    // no youth premium once he is not a prospect
    kid.age = 26;
    seller.manager = mk({ youth: 0.9 });
    expect(askingPrice(seller, kid)!).toBeLessThanOrEqual(Math.round(playerValue(kid) * 1.5) + 1);
  });
});

describe("board review", () => {
  it("sacks a manager after sustained underperformance, hires a different one and books two news lines", () => {
    const s = newGame(13, 0);
    const exp = expectedPositions(s);
    // fake a table: the biggest club (expected 1st) loses everything, everyone else draws
    const big = s.clubs.find((c) => exp.get(c.id) === 1 && c.id !== s.userClub)!;
    const old = big.manager!;
    for (const f of s.fixtures.filter((f) => f.round < 10)) f.score = f.home === big.id ? [0, 3] : f.away === big.id ? [3, 0] : [1, 1];
    s.round = 10;
    expect(table(s).findIndex((r) => r.club === big.id) + 1).toBe(s.clubs.length);
    const always = new Rng(1);
    let changed: Club[] = [];
    for (let i = 0; i < PRESSURE_LIMIT - 1; i++) { changed = boardReview(s, always); expect(changed).toEqual([]); }
    expect(big.pressure).toBe(PRESSURE_LIMIT - 1);
    for (let i = 0; i < 20 && big.manager === old; i++) boardReview(s, new Rng(50 + i));
    expect(big.manager).not.toBe(old);
    const fresh = big.manager!;
    expect(traitDistance(old.traits, fresh.traits)).toBeGreaterThanOrEqual(2);
    expect(fresh.since).toBe(s.season);
    expect(big.pressure).toBe(0);
    expect(s.freeManagers[0]).toBe(old);
    expect(old.history).toEqual([{ season: 1, club: big.id, position: 12 }]);
    expect(s.news.find((n) => n.includes(`${old.name} 감독 경질`))).toBeTruthy();
    expect(s.news.find((n) => n.includes(`${fresh.name} 감독 부임 (성향:`))).toBeTruthy();
    // a club doing fine keeps its man and carries no pressure
    const rows = table(s);
    const ok = s.clubs.find((c) => c.id !== s.userClub && c !== big && rows.findIndex((r) => r.club === c.id) + 1 - exp.get(c.id)! < 4)!;
    expect(ok.pressure).toBe(0);
    // the pool is used for the next hire: sack another underperformer with a pool that fits
    s.freeManagers.unshift(mk({ attack: 0.95, possession: 0.95, youth: 0.95, spending: 0.05 }, "POOL"));
    const mid = s.clubs.find((c) => c.id !== s.userClub && c !== big && exp.get(c.id)! <= 4)!;
    for (const f of s.fixtures.filter((f) => f.round < 10)) if (f.home === mid.id) f.score = [0, 2]; else if (f.away === mid.id) f.score = [2, 0];
    for (const c of s.clubs) c.pressure = 0;
    mid.manager = mk({}, "MID");
    mid.pressure = PRESSURE_LIMIT;
    boardReview(s, { next: () => 0 } as unknown as Rng);
    expect(mid.manager!.id).toBe("POOL");
    expect(s.freeManagers.some((m) => m.id === "POOL")).toBe(false);
  });

  it("the rollover files every manager's season, names the manager of the year and survives a save round-trip", () => {
    const s = newGame(14, 0);
    const rounds = roundsPerSeason(s.clubs.length);
    for (let r = 0; r < rounds; r++) { simulateRound(s, SHORT); s.round++; }
    s.round = rounds;
    const before = new Map(s.clubs.map((c) => [c.id, c.manager]));
    const award = managerOfYear(s)!;
    expect(award).toBeTruthy();
    const rows = table(s);
    const exp = expectedPositions(s);
    const bestScore = Math.max(...rows.map((r, i) => exp.get(r.club)! - (i + 1)));
    expect(award.expected - award.position).toBe(bestScore);
    const s2 = deserialize(serialize(s))!;
    expect(managerRollover(s2, new Rng(9))).toEqual(award);
    for (const c of s2.clubs) if (c.id !== s2.userClub) {
      const stayed = c.manager!.id === before.get(c.id)!.id;
      const cv = (stayed ? c.manager! : s2.freeManagers.find((m) => m.id === before.get(c.id)!.id)!).history;
      expect(cv.some((h) => h.season === 1 && h.club === c.id)).toBe(true);
    }
    expect(s2.news.some((n) => n.startsWith("올해의 감독:"))).toBe(true);
    startNextSeason(s);
    expect(s.seasonHistory[0]!.managerOfYear).toEqual(award);
    for (const c of s.clubs) if (c.id !== s.userClub) { expect(c.manager).toBeTruthy(); expect(c.pressure).toBe(0); }
    // save round-trip keeps managers, the pool and pressure; old saves get managers generated
    const back = deserialize(serialize(s))!;
    expect(serialize(deserialize(serialize(back))!)).toBe(serialize(back));
    expect(back.clubs.map((c) => c.manager)).toEqual(s.clubs.map((c) => c.manager));
    expect(back.freeManagers).toEqual(s.freeManagers);
    const raw = JSON.parse(serialize(s));
    for (const c of raw.clubs) { delete c.manager; delete c.pressure; }
    delete raw.freeManagers;
    const old = deserialize(JSON.stringify(raw))!;
    expect(old.freeManagers).toEqual([]);
    expect(old.clubs[old.userClub]!.manager).toBeNull();
    for (const c of old.clubs) { expect(c.pressure).toBe(0); if (c.id !== old.userClub) { expect(c.manager!.traits.attack).toBeGreaterThanOrEqual(0); expect(c.manager!.history).toEqual([]); } }
    expect(serialize(deserialize(serialize(old))!)).toBe(serialize(old));
  });
});
