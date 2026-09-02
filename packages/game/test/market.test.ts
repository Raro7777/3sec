import { describe, expect, it } from "vitest";
import { Rng } from "@3sec/engine";
import {
  AI_DEALS_PER_WINDOW, MARKET_LOG_MAX, MAX_SQUAD, MIN_SQUAD, acceptOffer, aiLoans, marketSummary, askingPrice, autoSelect, deserialize, expireOffers, freeAgentTerms, incomingOffers, isAvailable, loanIn, loanOut, loanTargets,
  loanWageBill, loanableOut, makeBid, newGame, openOffers, overall, playerValue, refusalChance, rejectOffer, releaseToMarket, respondToCounter, roundsPerSeason,
  selectionProblem, serialize, signFreeAgent, startNextSeason, transferTargets, transferWeek, wageBill, wageFor, windowOpen, type GameState, type SquadPlayer,
} from "../src/index";

const fixed = (v: number) => ({ next: () => v });
const ovr = (p: SquadPlayer) => overall(p.attrs, p.role);
const boost = (p: SquadPlayer) => { for (const k of Object.keys(p.attrs) as (keyof typeof p.attrs)[]) p.attrs[k] = 20; };
const countPlayers = (s: GameState) => s.clubs.reduce((n, c) => n + c.squad.length, 0) + s.freeAgents.length;

describe("incoming offers", () => {
  it("a needy, rich AI club bids for a player who would start for it; offers lapse after two rounds or when the window shuts", () => {
    const s = newGame(31);
    s.offers = [];
    const me = s.clubs[s.userClub]!;
    const star = me.squad.find((p) => p.role === "ST")!;
    boost(star);
    const buyer = s.clubs[(s.userClub + 1) % 12]!;
    buyer.budget = 100000;
    for (const c of s.clubs) if (c !== buyer && c !== me) c.budget = 0; // only the buyer can afford anything
    expect(windowOpen(s)).toBe(true);
    const forStar = () => s.offers.find((x) => x.playerId === star.id && x.from === buyer.id);
    for (let i = 0; i < 40 && !forStar(); i++) { incomingOffers(s, new Rng(i + 1)); if (s.offers.length && !forStar()) s.offers = []; }
    const o = forStar()!;
    expect(o).toBeDefined();
    expect(o.status).toBe("open");
    const value = playerValue(star);
    expect(o.fee).toBeGreaterThanOrEqual(Math.round(value * 0.8) - 1);
    expect(o.fee).toBeLessThanOrEqual(Math.round(value * 1.1) + 1);
    expect(o.expiresRound).toBe(s.round + 2);
    expect(s.news.some((n) => n.includes(star.name) && n.includes(`${o.fee}억`))).toBe(true);
    // still live one round later within the window, gone once it lapses
    expireOffers(s);
    expect(openOffers(s).some((x) => x.id === o.id)).toBe(true);
    s.round = o.expiresRound + 8; // a later window (round 10) with the offer past its date
    expireOffers(s);
    expect(openOffers(s).length).toBe(0);
    // an offer made in the winter window dies when the window closes
    s.round = 10;
    s.offers.push({ id: "w", from: buyer.id, playerId: star.id, fee: value, expiresRound: 12, status: "open" });
    s.round = 12;
    expireOffers(s);
    expect(openOffers(s).length).toBe(0);
  });

  it("accepting moves the player and the money; rejecting just drops it", () => {
    const s = newGame(32);
    s.offers = [];
    const me = s.clubs[s.userClub]!;
    const buyer = s.clubs[3]!;
    buyer.budget = 100;
    const p = me.squad[5]!;
    const myBudget = me.budget, mySize = me.squad.length, theirSize = buyer.squad.length;
    s.offers.push({ id: "a", from: buyer.id, playerId: p.id, fee: 30, expiresRound: 2, status: "open" });
    s.offers.push({ id: "b", from: 4, playerId: me.squad[6]!.id, fee: 5, expiresRound: 2, status: "open" });
    expect(rejectOffer(s, "b")).toBeNull();
    expect(openOffers(s).map((o) => o.id)).toEqual(["a"]);
    expect(acceptOffer(s, "a")).toBeNull();
    expect(me.squad.length).toBe(mySize - 1);
    expect(buyer.squad.some((q) => q.id === p.id)).toBe(true);
    expect(buyer.squad.length).toBe(theirSize + 1);
    expect(me.budget).toBe(myBudget + 30);
    expect(buyer.budget).toBe(70);
    expect(selectionProblem(me)).toBeNull();
    expect(selectionProblem(buyer)).toBeNull();
    expect(new Set(buyer.squad.map((q) => q.number)).size).toBe(buyer.squad.length);
    expect(openOffers(s).length).toBe(0);
    expect(acceptOffer(s, "a")).toMatch(/유효/);
  });

  it("a counter is accepted or refused by the seeded rng; a second counter ends the talks", () => {
    const s = newGame(33);
    s.offers = [];
    s.round = 10; // not deadline day: no bonus
    const me = s.clubs[s.userClub]!;
    const buyer = s.clubs[2]!;
    buyer.budget = 10000;
    const p = me.squad[7]!, q = me.squad[8]!;
    const value = playerValue(p);
    s.offers.push({ id: "c1", from: buyer.id, playerId: p.id, fee: value, expiresRound: 12, status: "open" });
    s.offers.push({ id: "c2", from: buyer.id, playerId: q.id, fee: playerValue(q), expiresRound: 12, status: "open" });
    // asking 1.1 × value: acceptance chance clamps near 95% → accepted with rng 0.5
    const r1 = respondToCounter(s, "c1", Math.round(value * 1.1), fixed(0.5));
    expect(r1.accepted).toBe(true);
    expect(buyer.squad.some((x) => x.id === p.id)).toBe(true);
    expect(me.budget).toBeGreaterThan(0);
    // asking 3 × value: chance clamps to 5% → refused, the original fee stays on the table
    const r2 = respondToCounter(s, "c2", playerValue(q) * 3, fixed(0.5));
    expect(r2.accepted).toBe(false);
    expect(s.offers.find((o) => o.id === "c2")!.status).toBe("countered");
    expect(s.offers.find((o) => o.id === "c2")!.counterFee).toBe(playerValue(q) * 3);
    const r3 = respondToCounter(s, "c2", playerValue(q) * 2, fixed(0.5));
    expect(r3.accepted).toBe(false);
    expect(openOffers(s).length).toBe(0);
    expect(me.squad.some((x) => x.id === q.id)).toBe(true);
  });
});

describe("bidding", () => {
  it("accepts a bid at the asking price, counters a lowball and takes the follow-up at the counter", () => {
    const s = newGame(34);
    const me = s.clubs[s.userClub]!;
    me.budget = 100000;
    const t = transferTargets(s).find((x) => x.price !== null && !x.club.selection.starters.includes(x.player.id))!;
    const low = makeBid(s, t.club.id, t.player.id, Math.round(t.price! * 0.3), fixed(0.99));
    expect(low.status).toBe("countered");
    expect(low.counter).toBe(t.price);
    expect(t.club.squad.includes(t.player)).toBe(true);
    const again = makeBid(s, t.club.id, t.player.id, Math.round(t.price! * 0.5), fixed(0.99), { counter: low.counter! });
    expect(again.status).toBe("rejected");
    const ok = makeBid(s, t.club.id, t.player.id, t.price!, fixed(0.99));
    expect(ok.status).toBe("accepted");
    expect(me.squad.includes(t.player)).toBe(true);
    expect(me.budget).toBe(100000 - t.price!);
    expect(selectionProblem(me)).toBeNull();
    expect(selectionProblem(t.club)).toBeNull();
    // a reasonable bid gets a softer counter (−5%) and the follow-up at that counter is taken
    const t2 = transferTargets(s).find((x) => x.price !== null && x.club.squad.length <= 20 && !x.club.selection.starters.includes(x.player.id))!;
    const mid = makeBid(s, t2.club.id, t2.player.id, Math.round(t2.price! * 0.75), fixed(0.99));
    expect(mid.status).toBe("countered");
    expect(mid.counter).toBe(Math.round(t2.price! * 0.95));
    expect(makeBid(s, t2.club.id, t2.player.id, mid.counter!, fixed(0.99), { counter: mid.counter! }).status).toBe("accepted");
    // shut window / short budget are errors, not negotiations
    s.round = 5;
    expect(makeBid(s, 1, s.clubs[1]!.squad[0]!.id, 10, fixed(0.5)).status).toBe("error");
  });

  it("a starter at a much bigger club may refuse to join, and stays refused for the season", () => {
    const s = newGame(35, 10); // 제주 (reputation 10) courting 울산 (14.5)
    const me = s.clubs[10]!;
    me.budget = 100000;
    const big = s.clubs[7]!;
    const starter = big.squad.find((p) => big.selection.starters.includes(p.id) && askingPrice(big, p) !== null)!;
    expect(refusalChance(s, big, starter)).toBe(0.8);
    const r = makeBid(s, big.id, starter.id, askingPrice(big, starter)! * 2, fixed(0.1));
    expect(r.status).toBe("refused");
    expect(starter.refusedSeason).toBe(s.season);
    expect(s.news.some((n) => n.includes("이적 거부") && n.includes(starter.name))).toBe(true);
    expect(big.squad.includes(starter)).toBe(true);
    expect(makeBid(s, big.id, starter.id, askingPrice(big, starter)! * 2, fixed(0.99)).status).toBe("refused");
    // a bench player of the same club has no such qualms
    const sub = big.squad.find((p) => !big.selection.starters.includes(p.id))!;
    expect(refusalChance(s, big, sub)).toBe(0);
  });
});

describe("free agents", () => {
  it("an unrenewed player becomes a free agent at the rollover and can be signed for 30% of value", () => {
    const s = newGame(36);
    const me = s.clubs[s.userClub]!;
    for (const c of s.clubs) for (const p of c.squad) p.contractUntil = 9; // nobody else is released, no thin squads
    const leaver = me.squad.find((p) => p.age <= 26 && !me.selection.starters.includes(p.id))!;
    leaver.contractUntil = 1;
    s.round = roundsPerSeason(12);
    startNextSeason(s);
    expect(me.squad.includes(leaver)).toBe(false);
    expect(s.freeAgents.includes(leaver)).toBe(true);
    expect(leaver.freeSince).toBe(2);
    expect(s.news.some((n) => n.includes(leaver.name) && n.includes("자유계약"))).toBe(true);
    const terms = freeAgentTerms(leaver);
    expect(terms.fee).toBe(Math.max(1, Math.round(playerValue(leaver) * 0.3)));
    expect(terms.wage).toBe(Math.round(wageFor(leaver) * 1.2 * 10) / 10);
    const budget = me.budget, size = me.squad.length;
    expect(signFreeAgent(s, leaver.id)).toBeNull();
    expect(me.squad.includes(leaver)).toBe(true);
    expect(me.squad.length).toBe(size + 1);
    expect(s.freeAgents.includes(leaver)).toBe(false);
    expect(me.budget).toBe(Math.round((budget - terms.fee) * 10) / 10);
    expect(leaver.wage).toBe(terms.wage);
    expect(leaver.contractUntil).toBe(s.season + terms.years - 1);
    expect(leaver.freeSince).toBeUndefined();
    expect(selectionProblem(me)).toBeNull();
  });

  it("the pool is capped at 20 best, ages at the rollover and forgets anyone idle for two seasons", () => {
    const s = newGame(37);
    const donor = s.clubs[1]!;
    const pool = [...donor.squad];
    for (const c of s.clubs) for (const p of c.squad) p.contractUntil = 9;
    for (const p of pool.slice(0, 4)) { donor.squad = donor.squad.filter((q) => q !== p); releaseToMarket(s, p, 1); }
    const s2 = s.clubs[2]!;
    for (const p of [...s2.squad].slice(0, 18)) { s2.squad = s2.squad.filter((q) => q !== p); releaseToMarket(s, p, 2); }
    expect(s.freeAgents.length).toBe(20);
    expect(s.freeAgents.every((p, i, a) => i === 0 || playerValue(a[i - 1]!) >= playerValue(p))).toBe(true);
    const ages = new Map(s.freeAgents.map((p) => [p.id, p.age]));
    s.round = roundsPerSeason(12);
    startNextSeason(s); // new season 2: freeSince 1 is one season idle → kept, a year older
    const kept = s.freeAgents.filter((p) => p.freeSince === 1);
    expect(kept.length).toBeGreaterThan(0);
    expect(kept.every((p) => p.age === ages.get(p.id)! + 1)).toBe(true);
    s.round = roundsPerSeason(12);
    startNextSeason(s); // season 3: freeSince 1 is gone
    expect(s.freeAgents.some((p) => p.freeSince === 1)).toBe(false);
  });
});

describe("loans", () => {
  it("loaning out halves the wage bill, benches the player and returns him at the rollover", () => {
    const s = newGame(38);
    const me = s.clubs[s.userClub]!;
    for (const c of s.clubs) for (const q of c.squad) q.contractUntil = 9;
    const p = loanableOut(s).find((x) => x.age <= 23) ?? loanableOut(s)[0]!;
    const before = wageBill(me);
    expect(loanOut(s, p.id)).toBeNull();
    expect(p.onLoan).toBe(true);
    expect(isAvailable(p)).toBe(false);
    expect(wageBill(me)).toBe(Math.round((before - p.wage / 2) * 10) / 10);
    expect(s.loans.length).toBe(1);
    const dest = s.clubs[s.loans[0]!.to]!;
    expect(loanWageBill(s, dest)).toBe(Math.round(p.wage * 0.5 * 10) / 10);
    expect(me.selection.starters.includes(p.id) || me.selection.bench.includes(p.id)).toBe(false);
    expect(selectionProblem(me)).toBeNull();
    expect(loanOut(s, p.id)).toMatch(/임대/);
    const growth = p.growth;
    s.round = 5;
    transferWeek(s, new Rng(1)); // loan bonus ticks even outside a window
    if (p.potential > ovr(p)) expect(p.growth).toBeGreaterThan(growth);
    s.round = roundsPerSeason(12);
    startNextSeason(s);
    expect(p.onLoan).toBeUndefined();
    // last season's loans are all gone; anything left is an AI loan struck in the new pre-season window
    expect(s.loans.every((l) => l.until === s.season && l.playerId !== p.id)).toBe(true);
    expect(me.squad.includes(p)).toBe(true);
  });

  it("loaning in brings a non-starter over for the season and sends him home afterwards", () => {
    const s = newGame(39);
    const me = s.clubs[s.userClub]!;
    for (const c of s.clubs) for (const p of c.squad) p.contractUntil = 9;
    const t = loanTargets(s)[0]!;
    const origin = t.club, size = me.squad.length;
    expect(loanIn(s, origin.id, t.player.id)).toBeNull();
    expect(me.squad.includes(t.player)).toBe(true);
    expect(me.squad.length).toBe(size + 1);
    expect(t.player.loanFrom).toBe(origin.id);
    expect(origin.squad.includes(t.player)).toBe(false);
    expect(selectionProblem(me)).toBeNull();
    expect(selectionProblem(origin)).toBeNull();
    expect(askingPrice(me, t.player)).toBeNull();
    s.round = roundsPerSeason(12);
    startNextSeason(s);
    expect(me.squad.includes(t.player)).toBe(false);
    expect(origin.squad.includes(t.player)).toBe(true);
    expect(t.player.loanFrom).toBeUndefined();
    expect(s.loans.every((l) => l.until === s.season && l.playerId !== t.player.id)).toBe(true);
  });

  it("AI clubs loan a surplus youngster to a club that needs him, once a season, and the log records it", () => {
    const s = newGame(43);
    s.marketLog = [];
    for (const c of s.clubs) for (const q of c.squad) q.contractUntil = 9;
    // a deep squad (24) with a young non-starter on the bench
    const lender = s.clubs[(s.userClub + 2) % 12]!;
    const donor = s.clubs[(s.userClub + 3) % 12]!;
    lender.squad.push(...donor.squad.splice(12, 4));
    for (const c of [lender, donor]) c.selection = autoSelect(c, c.selection.formation);
    const young = lender.squad.find((p) => !lender.selection.starters.includes(p.id) && p.age > 22) ?? lender.squad.find((p) => !lender.selection.starters.includes(p.id))!;
    young.age = 21;
    const total = countPlayers(s);
    for (let i = 0; i < 30 && !s.loans.some((l) => l.from === lender.id); i++) aiLoans(s, new Rng(100 + i));
    const loan = s.loans.find((l) => l.from === lender.id)!;
    expect(loan).toBeDefined();
    const borrowed = s.clubs[loan.to]!.squad.find((p) => p.id === loan.playerId)!;
    expect(borrowed.loanFrom).toBe(lender.id);
    expect(borrowed.age).toBeLessThanOrEqual(22);
    expect(loan.to).not.toBe(s.userClub);
    expect(countPlayers(s)).toBe(total);
    for (const c of s.clubs) if (c.id !== s.userClub) expect(selectionProblem(c)).toBeNull();
    // one outgoing loan per club per season
    for (let i = 0; i < 30; i++) aiLoans(s, new Rng(200 + i));
    expect(s.loans.filter((l) => l.from === lender.id).length).toBe(1);
    const sum = marketSummary(s, s.season);
    expect(sum.loans).toBe(s.loans.length);
    expect(s.marketLog.some((e) => e.kind === "loan" && e.playerId === loan.playerId && e.from === lender.id && e.to === loan.to)).toBe(true);
    s.round = roundsPerSeason(12);
    startNextSeason(s);
    // home at the rollover — unless the new pre-season window moved him again (logged under season 2)
    const movedAgain = s.marketLog.some((e) => e.season === 2 && e.playerId === loan.playerId);
    expect(s.clubs[lender.id]!.squad.some((p) => p.id === loan.playerId) || movedAgain).toBe(true);
    expect(s.loans.some((l) => l.playerId === loan.playerId && l.until === 1)).toBe(false);
  });
});

describe("AI market weeks", () => {
  it("weekly trading keeps every squad within 16–25 with a legal selection and conserves players", () => {
    const s = newGame(40);
    const total = countPlayers(s);
    // one bloated club (24) and one thin club (16) to exercise surplus sales and free-agent signings
    s.clubs[4]!.squad.push(...s.clubs[5]!.squad.splice(12, 4));
    for (const c of [s.clubs[4]!, s.clubs[5]!]) c.selection = autoSelect(c, c.selection.formation);
    let deals = 0;
    for (const round of [0, 10, 11, 22, 22]) {
      s.round = round;
      const news = s.news.length;
      transferWeek(s, new Rng(round * 7 + 1));
      deals += s.news.length - news;
      for (const c of s.clubs) {
        expect(c.squad.length).toBeGreaterThanOrEqual(MIN_SQUAD);
        expect(c.squad.length).toBeLessThanOrEqual(MAX_SQUAD);
        if (c.id !== s.userClub) expect(selectionProblem(c)).toBeNull();
      }
    }
    expect(countPlayers(s)).toBe(total);
    expect(deals).toBeGreaterThan(0);
    // at most AI_DEALS_PER_WINDOW purchases per club per window (three windows were visited)
    const buys = s.news.filter((n) => /영입 \(/.test(n) && !n.includes("자유계약"));
    expect(buys.length).toBeLessThanOrEqual(11 * 3 * AI_DEALS_PER_WINDOW);
    for (const key of new Set(s.aiDeals)) expect(s.aiDeals.filter((k) => k === key).length).toBeLessThanOrEqual(AI_DEALS_PER_WINDOW);
  });

  it("an AI club may buy twice in one window but not three times", () => {
    const s = newGame(44);
    const buyer = s.clubs[(s.userClub + 1) % 12]!;
    buyer.budget = 100000;
    for (const c of s.clubs) if (c !== buyer) c.budget = 0;
    for (let i = 0; i < 12; i++) transferWeek(s, new Rng(i + 3));
    const bought = s.marketLog.filter((e) => e.kind === "transfer" && e.to === buyer.id).length;
    expect(bought).toBeGreaterThanOrEqual(1);
    expect(bought).toBeLessThanOrEqual(AI_DEALS_PER_WINDOW);
    expect(s.aiDeals.filter((k) => k === `1:pre:${buyer.id}`).length).toBe(bought);
  });
});

describe("market log", () => {
  it("records every transfer, loan and free signing league-wide, caps at 80 lines and summarises the user's ins/outs", () => {
    const s = newGame(45);
    s.marketLog = [];
    const me = s.clubs[s.userClub]!;
    me.budget = 100000;
    const t = transferTargets(s).find((x) => x.price !== null)!;
    expect(makeBid(s, t.club.id, t.player.id, t.price! * 2, fixed(0.99))).toMatchObject({ status: "accepted" });
    const fa = s.clubs[1]!.squad.pop()!;
    releaseToMarket(s, fa, 1);
    expect(signFreeAgent(s, fa.id)).toBeNull();
    const out = loanableOut(s).find((p) => p !== t.player && p !== fa)!;
    expect(loanOut(s, out.id)).toBeNull();
    const kinds = s.marketLog.map((e) => e.kind);
    expect(kinds).toEqual(["loan", "free", "transfer"]); // newest first
    const sum = marketSummary(s, 1);
    expect(sum.transfers).toBe(1);
    expect(sum.frees).toBe(1);
    expect(sum.loans).toBe(1);
    expect(sum.biggest!.fee).toBe(t.price! * 2);
    expect(sum.userIn.map((e) => e.playerId).sort()).toEqual([t.player.id, fa.id].sort());
    expect(sum.userOut.map((e) => e.playerId)).toEqual([out.id]);
    expect(marketSummary(s, 7).transfers).toBe(0);
    // AI deals land in the log too, and it never grows past the cap
    for (let i = 0; i < 6; i++) { s.round = [0, 10, 11, 22][i % 4]!; transferWeek(s, new Rng(i + 9)); }
    for (let i = 0; i < 100; i++) s.marketLog.unshift({ season: 1, text: "x", kind: "transfer", fee: 1, to: 2, playerId: `x${i}`, playerName: "x" });
    transferWeek(s, new Rng(77));
    expect(s.marketLog.length).toBeLessThanOrEqual(MARKET_LOG_MAX + 100);
    s.round = 0;
    const before = s.marketLog.length;
    for (let i = 0; i < 20 && s.marketLog.length === before; i++) transferWeek(s, new Rng(500 + i));
    if (s.marketLog.length !== before) expect(s.marketLog.length).toBe(MARKET_LOG_MAX);
  });
});

describe("persistence", () => {
  it("offers, free agents, loans and player flags survive a save round-trip; old saves get empty lists", () => {
    const s = newGame(41);
    const me = s.clubs[s.userClub]!;
    s.offers.push({ id: "z", from: 2, playerId: me.squad[3]!.id, fee: 12, expiresRound: 2, status: "open" });
    const fa = s.clubs[1]!.squad.pop()!;
    releaseToMarket(s, fa, 1);
    expect(loanOut(s, loanableOut(s)[0]!.id)).toBeNull();
    const back = deserialize(serialize(s))!;
    expect(serialize(deserialize(serialize(back))!)).toBe(serialize(back));
    expect(back.offers.map((o) => o.id)).toEqual(s.offers.map((o) => o.id));
    expect(back.freeAgents.map((p) => p.id)).toEqual([fa.id]);
    expect(back.loans).toEqual(s.loans);
    expect(back.clubs[s.userClub]!.squad.find((p) => p.id === s.loans[0]!.playerId)!.onLoan).toBe(true);
    const old = JSON.parse(serialize(newGame(42))) as Record<string, unknown>;
    delete old.offers; delete old.freeAgents; delete old.loans; delete old.aiDeals; delete old.marketLog; delete old.seasonHistory;
    for (const c of old.clubs as Record<string, unknown>[]) { delete c.seasonInjuries; delete c.seasonWages; delete c.seasonRevenue; for (const p of c.squad as Record<string, unknown>[]) delete p.lastMinutes; }
    const mig = deserialize(JSON.stringify(old))!;
    expect(mig.offers).toEqual([]);
    expect(mig.freeAgents).toEqual([]);
    expect(mig.loans).toEqual([]);
    expect(mig.aiDeals).toEqual([]);
    expect(mig.marketLog).toEqual([]);
    expect(mig.seasonHistory).toEqual([]);
    for (const c of mig.clubs) { expect(c.seasonInjuries).toBe(0); expect(c.seasonWages).toBe(0); expect(c.seasonRevenue).toBe(0); for (const p of c.squad) expect(p.lastMinutes).toBe(0); }
  });
});
