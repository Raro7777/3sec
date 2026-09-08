import { describe, expect, it } from "vitest";
import {
  SCENARIOS, activeScenario, advanceRound, buyPlayer, clearedScenarios, judgeScenario, loanIn, newScenarioGame, scenarioBlock, scenarioById,
  seasonOver, signFreeAgent, simulateRound, startNextSeason, transferTargets, isForeignPlayer, type GameState, type SeasonRecord,
} from "../src/index";

const SHORT = { halfLength: 60, autoUser: true };
const playSeason = (s: GameState) => { while (!seasonOver(s)) { s.pendingCupDay = false; s.pendingClDay = false; simulateRound(s, SHORT); advanceRound(s); } };
const record = (s: GameState, over: Partial<SeasonRecord> = {}): SeasonRecord =>
  ({ season: s.season, champion: 0, cupWinner: null, userPosition: 5, userPts: 40, ...over });

describe("시나리오 모드", () => {
  it("every scenario picks a club, states a goal, and starts a run that is judged on its first season", () => {
    expect(SCENARIOS.length).toBeGreaterThanOrEqual(6);
    for (const sc of SCENARIOS) {
      expect(sc.name.length).toBeGreaterThan(1);
      expect(sc.goal.length).toBeGreaterThan(3);
      expect(sc.stars).toBeGreaterThanOrEqual(1);
      const s = newScenarioGame(600, sc.id, "측정");
      expect(s.scenario).toEqual({ id: sc.id, season: 1, outcome: "running" });
      expect(activeScenario(s)?.id).toBe(sc.id);
      // the club it picked is a real one and the squad is legal to field
      expect(s.clubs[s.userClub]).toBeTruthy();
      expect(s.clubs[s.userClub]!.selection.starters.length).toBe(11);
      expect(s.news.some((n) => n.includes(sc.name))).toBe(true);
    }
  });

  it("the opening state is bent the way the brief says", () => {
    const broke = newScenarioGame(601, "brokePromotion", "측정");
    expect(broke.clubs[broke.userClub]!.budget).toBe(0);
    const debt = newScenarioGame(601, "debt", "측정");
    expect(debt.emergencyLoan!.remaining).toBe(30);
    const home = newScenarioGame(601, "homegrown", "측정");
    expect(home.clubs[home.userClub]!.squad.some(isForeignPlayer)).toBe(false);
    const sale = newScenarioGame(601, "fireSale", "측정");
    const plain = newScenarioGame(601, "survival", "측정");
    expect(sale.clubs[sale.userClub]!.squad.length).toBeLessThan(plain.clubs[plain.userClub]!.squad.length + 1);
  });

  it("rules refuse the signings they forbid, and only those", () => {
    const s = newScenarioGame(602, "youthOnly", "측정");
    const me = s.clubs[s.userClub]!;
    me.budget = 5000;
    const t = transferTargets(s).find((x) => x.price !== null && !x.abroad)!;
    expect(buyPlayer(s, t.club.id, t.player.id)).toContain("영입할 수 없습니다");
    expect(scenarioBlock(s, "loan")).toContain("임대");
    expect(scenarioBlock(s, "free")).toContain("자유계약");
    // the foreign-only scenario blocks a foreigner and lets a Korean through
    const h = newScenarioGame(602, "homegrown", "측정");
    h.clubs[h.userClub]!.budget = 5000;
    const abroad = transferTargets(h).find((x) => x.abroad && x.price !== null)!;
    expect(buyPlayer(h, abroad.club.id, abroad.player.id)).toContain("외국인");
    const korean = transferTargets(h).find((x) => !x.abroad && x.price !== null)!;
    expect(buyPlayer(h, korean.club.id, korean.player.id)).toBeNull();
    // a run that is over stops binding
    h.scenario!.outcome = "failed";
    expect(scenarioBlock(h, "transfer", { nat: "일본" })).toBeNull();
  });

  it("judging marks the run cleared or failed and remembers what was cleared", () => {
    const s = newScenarioGame(603, "survival", "측정");
    const st = judgeScenario(s, record(s, { relegated: [] }));
    expect(st!.outcome).toBe("cleared");
    expect(clearedScenarios(s).map((x) => x.id)).toEqual(["survival"]);
    expect(s.news[0]).toContain("성공");

    const f = newScenarioGame(603, "survival", "측정");
    const fs = judgeScenario(f, record(f, { relegated: [f.userClub] }));
    expect(fs!.outcome).toBe("failed");
    expect(clearedScenarios(f)).toEqual([]);
    expect(f.news[0]).toContain("실패");
  });

  it("a sacking ends the run, and a season played out reaches a verdict", async () => {
    const s = newScenarioGame(604, "titleRun", "측정");
    s.board!.confidence = 5;
    s.board!.sacked = { season: 1, round: 5, position: 12, expected: 1, pts: 3, reason: "warnings" };
    // the sack path in board.ts calls failScenarioOnSack; call it the way the board does
    const { failScenarioOnSack } = await import("../src/scenario");
    failScenarioOnSack(s);
    expect(s.scenario!.outcome).toBe("failed");
    expect(s.scenario!.note).toContain("경질");

    const run = newScenarioGame(605, "survival", "측정");
    playSeason(run);
    startNextSeason(run);
    expect(["cleared", "failed"]).toContain(run.scenario!.outcome);
    expect(run.scenario!.note).toBeTruthy();
  });

  it("scenarioById is total over the list and forgiving elsewhere", () => {
    for (const sc of SCENARIOS) expect(scenarioById(sc.id)).toBe(sc);
    expect(scenarioById("nope")).toBeUndefined();
    expect(scenarioById(undefined)).toBeUndefined();
    expect(() => newScenarioGame(606, "nope")).toThrow();
  });
});
