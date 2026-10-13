/**
 * Long-run health check.
 *
 * Plays several seasons end to end and prints, per season, the numbers that only drift over years:
 * does the world inflate or rot (ratings, ages, budgets), does the same club win every year, does the
 * market keep moving, does a manager who merely picks his best eleven survive. Nothing here is a
 * gate; it is the view a real tester would need ten hours to form.
 *
 *   pnpm -C packages/game longrun                      # 6 seasons, seed 2026
 *   SEASONS=8 SEED=777 pnpm -C packages/game longrun
 *   USER=passive pnpm -C packages/game longrun         # the user's club touches nothing (default: best XI + renewals)
 */
import {
  newGame, prepareRound, currentFixtures, createMatch, recordResult, advanceRound, seasonOver, startNextSeason,
  table, topScorers, overall, autoSelect, wageBill, expiringContracts, renewContract, renewalTerms,
  jobOffers, acceptJob, clubOf, divisionTable, divisionOf, userDivision, managerRep,
} from "../src/index";
import { simulateCupDay, advanceCupDay } from "../src/cup";
import { simulateClDay, advanceClDay } from "../src/continental";
import type { Club, GameState } from "../src/types";

const SEASONS = Number(process.env.SEASONS ?? 6);
const SEED = Number(process.env.SEED ?? 2026);
const USER_MODE = process.env.USER ?? "auto";

const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const f1 = (x: number): string => x.toFixed(1);
const topN = (c: Club, n = 14): number => mean(c.squad.map((p) => overall(p.attrs, p.role)).sort((a, b) => b - a).slice(0, n));

/** What a sensible but minimal user does each week: field the best eleven, keep the squad's core signed. */
function userWeek(s: GameState): void {
  const me = clubOf(s, s.userClub);
  me.selection = autoSelect(me, me.selection.formation);
  if (USER_MODE === "passive") return;
  const ranked = [...me.squad].sort((a, b) => overall(b.attrs, b.role) - overall(a.attrs, a.role));
  const core = new Set(ranked.slice(0, 18).map((p) => p.id));
  for (const p of expiringContracts(s)) {
    if (!core.has(p.id) || p.age >= 33) continue;
    const years = p.age <= 24 ? 3 : p.age <= 29 ? 2 : 1;
    const terms = renewalTerms(p, years);
    if (me.budget - terms.fee < 5) continue;
    renewContract(s, p.id, years);
  }
}

function afterSack(s: GameState, log: string[]): void {
  if (!s.board.sacked) return;
  const rec = s.board.sacked;
  const [c] = jobOffers(s);
  log.push(`  경질 S${rec.season} R${rec.round} (${rec.position}위/기대 ${rec.expected}위, ${rec.reason}) → ${c ? clubOf(s, c.id).shortName : "제안 없음"}`);
  if (c) acceptJob(s, c.id);
}

function playSeason(s: GameState, log: string[]): { matches: number; userGoalsFor: number; userGoalsAgainst: number } {
  let matches = 0, gf = 0, ga = 0;
  while (!seasonOver(s)) {
    if (s.pendingCupDay) { simulateCupDay(s); advanceCupDay(s); continue; }
    if (s.pendingClDay) { simulateClDay(s); advanceClDay(s); continue; }
    if (!s.board.sacked) userWeek(s);
    prepareRound(s);
    for (const f of currentFixtures(s)) {
      if (f.score) continue;
      const m = createMatch(s, f, { autoUser: true });
      m.runToEnd();
      matches++;
      if (f.home === s.userClub) { gf += m.state.score[0]; ga += m.state.score[1]; }
      if (f.away === s.userClub) { gf += m.state.score[1]; ga += m.state.score[0]; }
      recordResult(s, f, m);
    }
    advanceRound(s);
    afterSack(s, log);
  }
  return { matches, userGoalsFor: gf, userGoalsAgainst: ga };
}

interface Snapshot {
  season: number;
  champion: string; d2Champion: string; cup: string; cl: string;
  spread: number; userPos: number; userDiv: number; userPts: number;
  worldOvr: number; worldAge: number; worldBudget: number; worldRep: number; repSd: number;
  bestOvr: number; worstOvr: number; squadMin: number; squadMax: number;
  userOvr: number; userAge: number; userBudget: number; userWages: number; userSquad: number; userConf: number; userRep: number; userYouth: number; userRed: number;
  deals: number; fees: number; loans: number; freeAgents: number; freeManagers: number;
  topScorer: string; over33: number; under21: number;
}

function snapshot(s: GameState, before: { marketLen: number }): Snapshot {
  const clubs = s.clubs;
  const me = clubOf(s, s.userClub);
  const t1 = divisionTable(s, 1);
  const t2 = divisionTable(s, 2);
  const ovr = clubs.map((c) => topN(c));
  const reps = clubs.map((c) => c.reputation);
  const repMean = mean(reps);
  const season = s.marketLog.filter((e) => e.season === s.season);
  const all = clubs.flatMap((c) => c.squad);
  const ts = topScorers(s, 1)[0];
  const ut = table(s);
  return {
    season: s.season,
    champion: clubOf(s, t1[0]!.club).shortName,
    d2Champion: t2[0] ? clubOf(s, t2[0].club).shortName : "-",
    cup: s.cup.holder != null ? clubOf(s, s.cup.holder).shortName : "-",
    cl: s.continental?.holder != null ? clubOf(s, s.continental.holder).shortName : "-",
    spread: t1[0]!.pts - t1[t1.length - 1]!.pts,
    userPos: ut.findIndex((r) => r.club === s.userClub) + 1,
    userDiv: userDivision(s),
    userPts: ut.find((r) => r.club === s.userClub)?.pts ?? 0,
    worldOvr: mean(ovr), worldAge: mean(all.map((p) => p.age)), worldBudget: mean(clubs.map((c) => c.budget)), worldRep: repMean,
    repSd: Math.sqrt(mean(reps.map((r) => (r - repMean) ** 2))),
    bestOvr: Math.max(...ovr), worstOvr: Math.min(...ovr),
    squadMin: Math.min(...clubs.map((c) => c.squad.length)), squadMax: Math.max(...clubs.map((c) => c.squad.length)),
    userOvr: topN(me), userAge: mean(me.squad.map((p) => p.age)), userBudget: me.budget, userWages: wageBill(me), userSquad: me.squad.length,
    userConf: s.board.confidence, userRep: managerRep(s), userYouth: me.squad.filter((p) => p.youthProduct).length, userRed: me.redWeeks ?? 0,
    deals: season.filter((e) => e.kind === "transfer").length, fees: season.reduce((a, e) => a + e.fee, 0), loans: season.filter((e) => e.kind === "loan").length,
    freeAgents: s.freeAgents.length, freeManagers: s.freeManagers.length,
    topScorer: ts ? `${ts.player.name}(${clubOf(s, ts.club.id).shortName}) ${ts.player.stats.goals}골` : "-",
    over33: all.filter((p) => p.age >= 33).length, under21: all.filter((p) => p.age <= 21).length,
  };
}

const s = newGame(SEED, 0, "장기진단");
const startClub = clubOf(s, s.userClub).shortName;
console.log(`seed ${SEED} · ${SEASONS} seasons · user ${USER_MODE} · start ${startClub} (rep ${clubOf(s, s.userClub).reputation}, budget ${clubOf(s, s.userClub).budget})`);
console.log(`world at start: ovr ${f1(mean(s.clubs.map(topN)))} · age ${f1(mean(s.clubs.flatMap((c) => c.squad.map((p) => p.age))))} · budget ${f1(mean(s.clubs.map((c) => c.budget)))} · rep ${f1(mean(s.clubs.map((c) => c.reputation)))}`);

const snaps: Snapshot[] = [];
const log: string[] = [];
const t0 = Date.now();
for (let i = 0; i < SEASONS; i++) {
  const before = { marketLen: s.marketLog.length };
  const r = playSeason(s, log);
  const snap = snapshot(s, before);
  snaps.push(snap);
  const me = clubOf(s, s.userClub);
  console.log(
    `\nS${snap.season} (${r.matches} matches, ${((Date.now() - t0) / 1000).toFixed(0)}s)` +
    `\n  1부 ${snap.champion} (spread ${snap.spread}pts) · 2부 ${snap.d2Champion} · 컵 ${snap.cup} · CL ${snap.cl} · 득점왕 ${snap.topScorer}` +
    `\n  world: ovr ${f1(snap.worldOvr)} [${f1(snap.worstOvr)}–${f1(snap.bestOvr)}] · age ${f1(snap.worldAge)} · ≤21 ${snap.under21} / ≥33 ${snap.over33} · squads ${snap.squadMin}–${snap.squadMax} · budget ${f1(snap.worldBudget)} · rep ${f1(snap.worldRep)} ±${f1(snap.repSd)}` +
    `\n  market: ${snap.deals} transfers (${f1(snap.fees)}억) · ${snap.loans} loans · ${snap.freeAgents} free agents · ${snap.freeManagers} free managers` +
    `\n  user ${me.shortName} D${snap.userDiv} ${snap.userPos}위 ${snap.userPts}pts (${r.userGoalsFor}:${r.userGoalsAgainst}) · ovr ${f1(snap.userOvr)} · age ${f1(snap.userAge)} · squad ${snap.userSquad} (youth ${snap.userYouth}) · budget ${f1(snap.userBudget)} · wages ${f1(snap.userWages)} · red ${snap.userRed}w · board ${snap.userConf} · rep ${snap.userRep}`,
  );
  for (const l of log.splice(0)) console.log(l);
  if (i < SEASONS - 1) {
    startNextSeason(s);
    afterSack(s, log);
    for (const l of log.splice(0)) console.log(l);
    const nm = clubOf(s, s.userClub);
    console.log(`  → S${s.season}: ${nm.shortName} D${userDivision(s)} budget ${f1(nm.budget)} · squad ${nm.squad.length} · expiring ${expiringContracts(s).length} · news ${s.news.length}`);
  }
}

console.log("\n==== drift over the run ====");
const first = snaps[0]!, last = snaps[snaps.length - 1]!;
const d = (k: keyof Snapshot) => `${f1(first[k] as number)} → ${f1(last[k] as number)}`;
console.log(`world ovr ${d("worldOvr")} · age ${d("worldAge")} · budget ${d("worldBudget")} · rep ${d("worldRep")} (sd ${d("repSd")})`);
console.log(`champions: ${snaps.map((x) => x.champion).join(", ")}`);
console.log(`cup: ${snaps.map((x) => x.cup).join(", ")} · CL: ${snaps.map((x) => x.cl).join(", ")}`);
console.log(`user: ${snaps.map((x) => `D${x.userDiv}#${x.userPos}`).join(" ")} · budget ${d("userBudget")} · ovr ${d("userOvr")} · board ${d("userConf")} · rep ${d("userRep")}`);
console.log(`market/season: transfers ${snaps.map((x) => x.deals).join(",")} · fees ${snaps.map((x) => x.fees.toFixed(0)).join(",")} · free agents ${snaps.map((x) => x.freeAgents).join(",")}`);
const news = s.news.slice(0, 40);
console.log(`\nlast news (${s.news.length} total):`);
for (const n of news) console.log("  " + n);
const dup = new Map<string, number>();
for (const n of s.news) { const k = n.replace(/\d+/g, "#"); dup.set(k, (dup.get(k) ?? 0) + 1); }
console.log(`\nmost repeated news shapes:`);
for (const [k, v] of [...dup.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(`  ${String(v).padStart(4)}× ${k.slice(0, 110)}`);
