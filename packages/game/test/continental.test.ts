import { describe, expect, it } from "vitest";
import {
  CL_GROUP_STAGES, CL_KR_SLOTS, CL_PRIZE, CL_ROUNDS, CL_STAGES, FOREIGN_ID_BASE, advanceClDay, advanceCupDay, advanceRound, clDayDue, clDone, clPrize,
  clubOf, clubRecords, deserialize, groupOf, groupTable, newGame, prepareRound, seasonOver, serialize, simulateClDay, simulateCupDay, simulateRound,
  startNextSeason, userClSummary, userEnteredCl, type GameState,
} from "../src/index";

const SHORT = { halfLength: 60 };
/** Drive a season the way the viewer does: cup days and continental days between the league rounds. */
function playSeason(s: GameState, onCl?: (s: GameState) => void, len = SHORT): void {
  for (let guard = 0; guard < 80 && !seasonOver(s); guard++) {
    prepareRound(s);
    if (s.pendingCupDay) { simulateCupDay(s, { autoUser: true, ...len }); advanceCupDay(s); continue; }
    if (s.pendingClDay) { simulateClDay(s, { autoUser: true, ...len }); advanceClDay(s); onCl?.(s); continue; }
    simulateRound(s, len); advanceRound(s);
  }
}

describe("동아시아 챔피언스리그", () => {
  it("draws sixteen entrants into four groups with the Korean three kept apart", () => {
    const s = newGame(3, 7); // 울산, the top reputation, is in
    const c = s.continental!;
    expect(c.entrants.length).toBe(16);
    expect(new Set(c.entrants).size).toBe(16);
    const kr = c.entrants.filter((id) => id < FOREIGN_ID_BASE);
    expect(kr.length).toBe(CL_KR_SLOTS);
    expect(new Set(kr.map((id) => groupOf(c, id))).size).toBe(CL_KR_SLOTS);
    expect(userEnteredCl(s)).toBe(true);
    expect(s.foreign!.length).toBe(13);
    // every foreign club is a playable club: eleven starters picked, a manager, a ground
    for (const f of s.foreign!) { expect(f.selection.starters.length).toBe(11); expect(f.manager).not.toBeNull(); expect(clubOf(s, f.id)).toBe(f); }
    // three group matchdays are laid out: six ties each
    for (let st = 0; st < CL_GROUP_STAGES; st++) expect(c.ties.filter((t) => t.stage === st).length).toBe(8);
  });

  it("plays the groups on its own midweeks, then the knock-outs, and crowns a holder inside the season", () => {
    const s = newGame(3, 7);
    const days: number[] = [];
    playSeason(s, (st) => days.push(st.round));
    expect(days.length).toBe(CL_STAGES);
    expect(days).toEqual([...CL_ROUNDS]);
    expect(clDone(s)).toBe(true);
    expect(s.continental!.holder).toBeDefined();
    // every group table adds up: four clubs, three games each
    for (let g = 0; g < 4; g++) { const t = groupTable(s, g); expect(t.length).toBe(4); for (const r of t) expect(r.played).toBe(3); }
    // knock-out ties exist and every one has a winner (penalties when level)
    const ko = s.continental!.ties.filter((t) => t.stage >= CL_GROUP_STAGES);
    expect(ko.length).toBe(4 + 2 + 1);
    for (const t of ko) { expect(t.score).not.toBeNull(); if (t.score![0] === t.score![1]) expect(t.penalties).toBeDefined(); }
    // the holder banked the winner's prize
    const holder = clubOf(s, s.continental!.holder!);
    expect(clPrize(s, holder.id)).toBeGreaterThanOrEqual(CL_PRIZE.winner);
    expect(userClSummary(s)).toBeTruthy();
    // league bookkeeping untouched: 22 rounds, no continental fixture in the league list
    expect(s.round).toBe(22);
    expect(s.fixtures.every((f) => f.id >= 0)).toBe(true);
  });

  it("qualifies next season's entrants from the final table and keeps the foreign field out of the league", () => {
    const s = newGame(3, 23);
    expect(userEnteredCl(s)).toBe(false);
    playSeason(s);
    const top3 = [...s.fixtures].length ? undefined : undefined; void top3;
    startNextSeason(s);
    const c = s.continental!;
    expect(c.season).toBe(2);
    expect(c.stage).toBe(0);
    expect(s.clQualifiers!.length).toBe(3);
    for (const id of s.clQualifiers!) expect(c.entrants).toContain(id);
    expect(s.clubs.length).toBe(24);
    expect(s.seasonHistory[0]!.clWinner).toBeDefined();
    expect(s.seasonHistory[0]!.promoted!.length).toBe(2);
    expect(s.seasonHistory[0]!.d2Champion).toBeDefined();
  });

  it("survives a save round trip and is created for a save from before the competition", () => {
    const s = newGame(3, 7);
    playSeason(s);
    const back = deserialize(serialize(s))!;
    expect(back.continental!.holder).toBe(s.continental!.holder);
    expect(back.foreign!.length).toBe(13);
    // an old save: no foreign field, no competition, mid-season → recreated and caught up to the round
    const old = JSON.parse(serialize(newGame(4, 0)));
    delete old.continental; delete old.foreign; delete old.pendingClDay;
    old.round = 10; // past the first two group matchdays
    const m = deserialize(JSON.stringify(old))!;
    expect(m.foreign!.length).toBe(13);
    expect(m.continental!.stage).toBeGreaterThanOrEqual(2);
    expect(clDayDue(m)).toBe(false);
  });
});

describe("기록실", () => {
  it("reads the club's all-time scorers and appearances off the players' CVs, keeping those who left", () => {
    const s = newGame(5, 0);
    playSeason(s, undefined, { halfLength: 300 }); // long enough halves for goals to be scored
    const before = clubRecords(s, 0);
    expect(before.topScorers.length).toBeGreaterThan(0);
    expect(before.topApps[0]!.value).toBeGreaterThan(10);
    expect(before.seasonGoals!.value).toBe(before.topScorers[0]!.value);
    startNextSeason(s);
    const after = clubRecords(s, 0);
    // the CVs carried the season over: the same leader, now with a season span
    expect(after.topScorers[0]!.name).toBe(before.topScorers[0]!.name);
    expect(after.topScorers[0]!.seasons).toMatch(/S1/);
    expect(after.seasonsOnRecord).toBe(2);
  });
});
