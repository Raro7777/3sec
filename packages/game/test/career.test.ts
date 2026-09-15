import { describe, expect, it } from "vitest";
import {
  COUNTER_CAP, JOB_OFFER_TTL, OFFER_FROM_ROUND, acceptContract, acceptJob, acceptJobOffer, careerJobOffers, careerRollover, careerWeek, counterContract, declineContract,
  declineJobOffer, deserialize, expectedPositions, newGame, offerWage, offerYears, openContractTalk, pendingJobOffer, repStars, roundsPerSeason, serialize, startNextSeason,
  startingRep, table, type GameState,
} from "../src/index";

function fixRound(s: GameState, round: number, mine: [number, number]): void {
  for (const f of s.fixtures.filter((x) => x.round === round)) {
    const involved = f.home === s.userClub || f.away === s.userClub;
    if (!involved) { f.score = [1, 1]; continue; }
    f.score = f.home === s.userClub ? [mine[0], mine[1]] : [mine[1], mine[0]];
  }
}

/** Script a whole season (no engine) so the table is decided. */
function playSeason(s: GameState, mine: [number, number]): void {
  const rounds = roundsPerSeason(s.clubs.length);
  for (let r = 0; r < rounds; r++) { fixRound(s, r, mine); s.round++; }
}

describe("reputation and contracts", () => {
  it("starts from the club's reputation minus two (floor 5) with a two-season contract", () => {
    const s = newGame(21, 10);
    const me = s.clubs[10]!;
    expect(s.managerRep).toBe(startingRep(me.reputation));
    expect(s.managerRep).toBeGreaterThanOrEqual(5);
    expect(s.managerContract).toEqual({ until: 2, wage: offerWage(me.reputation, s.managerRep!) });
    expect(s.contractTalk).toBeUndefined();
    expect(s.jobOffersPending).toEqual([]);
    expect(startingRep(6)).toBe(5);
    expect(startingRep(14)).toBe(12);
  });

  it("wage and length grow with reputation; stars run 1..5", () => {
    expect(offerWage(8, 8)).toBe(1);
    expect(offerWage(12, 10)).toBe(3.2);
    expect(offerWage(12, 10, true)).toBe(3.7);
    expect(offerWage(15, 16)).toBeGreaterThan(offerWage(12, 10));
    expect(offerYears(8, 12, false)).toBe(1);
    expect(offerYears(12, 12, false)).toBe(2);
    expect(offerYears(15, 12, true)).toBe(3);
    expect(repStars(5)).toBe(1);
    expect(repStars(20)).toBe(5);
    expect(repStars(11)).toBe(3);
  });

  it("opens the talk once the season is over and the contract is up; accepting extends it", () => {
    const s = newGame(22, 10);
    s.managerContract!.until = 1;
    playSeason(s, [2, 0]);
    s.board.confidence = 80;
    expect(s.contractTalk).toBeUndefined();
    careerWeek(s);
    const t = s.contractTalk!;
    expect(t).toBeTruthy();
    expect(t.season).toBe(1);
    expect(t.years).toBeGreaterThanOrEqual(2);
    expect(t.wage).toBe(offerWage(s.clubs[10]!.reputation, s.managerRep!, true));
    expect(s.news[0]).toMatch(/재계약을 제안/);
    expect(acceptContract(s)).toBeNull();
    expect(s.contractTalk).toBeUndefined();
    expect(s.managerContract).toEqual({ until: 1 + t.years, wage: t.wage });
    // no talk while the contract still runs, none on thin ice
    const s2 = newGame(22, 10);
    playSeason(s2, [2, 0]);
    expect(openContractTalk(s2)).toBeNull();
    const s3 = newGame(22, 10);
    s3.managerContract!.until = 1;
    playSeason(s3, [0, 2]);
    s3.board.confidence = 20;
    expect(openContractTalk(s3)).toBeNull();
  });

  it("one counter only: an outrageous ask is refused, a fair one is decided by the dice and signs at the asked wage", () => {
    const s = newGame(23, 10);
    s.managerContract!.until = 1;
    playSeason(s, [2, 0]);
    s.board.confidence = 80;
    openContractTalk(s);
    const offer = s.contractTalk!.wage;
    const bad = counterContract(s, offer * COUNTER_CAP + 1);
    expect(bad.ok).toBe(false);
    expect(s.contractTalk!.countered).toBe(true);
    expect(s.contractTalk!.wage).toBe(offer);
    expect(counterContract(s, offer + 0.5).error).toMatch(/한 번만/);
    // a fair ask from a big name
    const s2 = newGame(24, 10);
    s2.managerRep = 20;
    s2.managerContract!.until = 1;
    playSeason(s2, [2, 0]);
    s2.board.confidence = 80;
    openContractTalk(s2);
    const o2 = s2.contractTalk!.wage;
    const res = counterContract(s2, o2 + 0.3);
    expect(res.chance).toBeGreaterThan(0.5);
    if (res.ok) {
      expect(s2.contractTalk).toBeUndefined();
      expect(s2.managerContract!.wage).toBe(Math.round((o2 + 0.3) * 10) / 10);
    } else {
      expect(s2.contractTalk!.wage).toBe(o2);
      expect(s2.contractTalk!.countered).toBe(true);
    }
    // an unanswered talk is signed at the rollover
    const s3 = newGame(25, 10);
    s3.managerContract!.until = 1;
    playSeason(s3, [2, 0]);
    s3.board.confidence = 80;
    openContractTalk(s3);
    startNextSeason(s3);
    expect(s3.contractTalk).toBeUndefined();
    expect(s3.managerContract!.until).toBeGreaterThan(1);
  });

  it("declining makes the manager a free agent with offers; taking one keeps the reputation and brings a contract", () => {
    const s = newGame(26, 10);
    s.managerContract!.until = 1;
    playSeason(s, [2, 0]);
    s.board.confidence = 80;
    openContractTalk(s);
    const rep = s.managerRep!;
    expect(declineContract(s)).toBeNull();
    expect(s.board.sacked?.reason).toBe("declined");
    expect(s.managerContract).toBeUndefined();
    const offers = careerJobOffers(s);
    expect(offers.length).toBeGreaterThan(0);
    expect(offers.every((c) => c.id !== 10)).toBe(true);
    const target = offers[0]!;
    expect(acceptJob(s, target.id)).toBeNull();
    expect(s.userClub).toBe(target.id);
    expect(s.managerRep).toBe(rep);
    expect(s.managerContract).toEqual({ until: 2, wage: offerWage(target.reputation, rep) });
    expect(s.clubs[10]!.manager).not.toBeNull();
    expect(s.board.sacked).toBeUndefined();
  });

  it("the rollover moves the reputation with the finish, the trophies, the verdict and the sack", () => {
    const up = newGame(27, 10);
    playSeason(up, [3, 0]);
    up.board.confidence = 90;
    const before = up.managerRep!;
    const ch = careerRollover(up);
    expect(ch.before).toBe(before);
    expect(ch.after).toBeGreaterThan(before + 2);
    expect(ch.reasons.join(" ")).toMatch(/리그 우승/);
    expect(up.news[0]).toMatch(/감독 평판/);
    const down = newGame(27, 7);
    playSeason(down, [0, 3]);
    down.board.sacked = { season: 1, round: 22, position: 12, expected: expectedPositions(down).get(7)!, pts: 0, reason: "rollover" };
    const b2 = down.managerRep!;
    const ch2 = careerRollover(down);
    expect(ch2.after).toBeLessThanOrEqual(b2 - 2);
    expect(down.managerContract).toBeUndefined();
    expect(down.managerRep).toBeGreaterThanOrEqual(1);
  });
});

describe("unsolicited approaches", () => {
  it("a bigger club under pressure comes calling for a reputed manager; accepting switches mid-season, ignoring lets it lapse", () => {
    const s = newGame(28, 10);
    s.managerRep = 20;
    const big = [...s.clubs].filter((c) => c.id !== 10).sort((a, b) => b.reputation - a.reputation)[0]!;
    big.pressure = 3;
    s.round = OFFER_FROM_ROUND;
    let offer = null;
    for (let i = 0; i < 12 && !offer; i++) { offer = careerWeek(s); if (!offer) s.round++; }
    expect(offer).toBeTruthy();
    expect(offer!.club).toBe(big.id);
    expect(offer!.expires).toBe(s.round + JOB_OFFER_TTL);
    expect(pendingJobOffer(s)).toBe(offer);
    expect(s.news[0]).toMatch(/감독직을 제안/);
    // a second approach does not arrive while one is open
    expect(careerWeek(s)).toBeNull();
    expect(s.jobOffersPending!.length).toBe(1);
    // let it lapse
    const snap = JSON.parse(serialize(s)) as GameState;
    s.round = offer!.expires;
    careerWeek(s);
    expect(pendingJobOffer(s)).toBeNull();
    expect(s.news[0]).toMatch(/만료/);
    // accept on the copy
    const t = deserialize(serialize(snap))!;
    const rep = t.managerRep!;
    expect(acceptJobOffer(t)).toBeNull();
    expect(t.userClub).toBe(big.id);
    expect(t.managerRep).toBe(rep);
    expect(t.managerContract!.wage).toBe(offer!.wage);
    expect(t.managerContract!.until).toBe(t.season + offer!.years - 1);
    expect(t.clubs[10]!.manager).not.toBeNull();
    expect(t.clubs[big.id]!.manager).toBeNull();
    expect(t.jobOffersPending).toEqual([]);
    expect(t.board.sacked).toBeUndefined();
    // decline on another copy
    const d = deserialize(serialize(snap))!;
    expect(declineJobOffer(d)).toBeNull();
    expect(pendingJobOffer(d)).toBeNull();
    expect(d.userClub).toBe(10);
  });

  it("no approach for a nobody or without a pressured bigger club", () => {
    const s = newGame(29, 10);
    s.managerRep = 5;
    for (const c of s.clubs) c.pressure = 3;
    for (let r = OFFER_FROM_ROUND; r < 18; r++) { s.round = r; expect(careerWeek(s)).toBeNull(); }
    const s2 = newGame(29, 10);
    s2.managerRep = 20;
    for (let r = OFFER_FROM_ROUND; r < 18; r++) { s2.round = r; expect(careerWeek(s2)).toBeNull(); }
    expect(table(s2).length).toBe(12);
  });

  it("old saves get a reputation and a contract from the current club", () => {
    const s = newGame(30, 6);
    const raw = JSON.parse(serialize(s)) as Record<string, unknown>;
    delete raw.managerRep; delete raw.managerContract; delete raw.contractTalk; delete raw.jobOffersPending;
    const back = deserialize(JSON.stringify(raw))!;
    expect(back.managerRep).toBe(startingRep(back.clubs[6]!.reputation));
    expect(back.managerContract).toEqual({ until: 2, wage: offerWage(back.clubs[6]!.reputation, back.managerRep!) });
    expect(back.jobOffersPending).toEqual([]);
  });
});
