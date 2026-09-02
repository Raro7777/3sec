import { Match, Rng, type MatchOptions, type PlayerDef, type TeamDef, type TeamId } from "@3sec/engine";
import type { Club, Fixture, GameState, SquadPlayer, TableRow } from "./types";
import { buildClubs } from "./world";
import { buildFixtures, roundsPerSeason } from "./fixtures";
import { repairSelection, autoSelect } from "./selection";
import { aiTransfers, seasonBudget } from "./transfers";
import { trainWeek, ATTR_LABEL } from "./training";
import { payWages, settleContracts } from "./contracts";

export function newGame(seed: number, userClub = 0): GameState {
  const clubs = buildClubs(seed);
  return { version: 1, seed, season: 1, round: 0, userClub, clubs, fixtures: buildFixtures(clubs.length), news: [`시즌 1 시작. 당신은 ${clubs[userClub]!.name} 감독입니다.`] };
}

export const clubOf = (s: GameState, id: number): Club => s.clubs[id]!;
export const playerOf = (c: Club, id: string): SquadPlayer => c.squad.find((p) => p.id === id)!;
export const seasonOver = (s: GameState): boolean => s.round >= roundsPerSeason(s.clubs.length);
export const currentFixtures = (s: GameState): Fixture[] => s.fixtures.filter((f) => f.round === s.round);
export const nextUserFixture = (s: GameState): Fixture | null => currentFixtures(s).find((f) => f.home === s.userClub || f.away === s.userClub) ?? null;

/** Deterministic per-match seed so a saved game replays identically. */
export function fixtureSeed(s: GameState, f: Fixture): number {
  return (s.seed * 7919 + s.season * 104729 + f.id * 131 + 17) >>> 0;
}

/** Before a round: AI clubs re-pick their best XI; the user's selection is repaired if it became illegal. */
export function prepareRound(s: GameState): void {
  for (const c of s.clubs) {
    c.selection = c.id === s.userClub ? repairSelection(c) : autoSelect(c, c.selection.formation);
  }
}

const strip = (p: SquadPlayer): PlayerDef => ({ id: p.id, name: p.name, number: p.number, role: p.role, attrs: p.attrs });

export function teamDef(c: Club, side: TeamId): TeamDef {
  return {
    id: side,
    name: c.name,
    shortName: c.shortName,
    color: c.color,
    players: c.selection.starters.map((id) => strip(playerOf(c, id))),
    bench: c.selection.bench.map((id) => strip(playerOf(c, id))),
    tactics: { ...c.tactics, formation: c.selection.formation },
  };
}

/** Build the engine match for a fixture. The user's side is human-managed, all others AI. */
export function createMatch(s: GameState, f: Fixture, opts: MatchOptions = {}): Match {
  const home = clubOf(s, f.home);
  const away = clubOf(s, f.away);
  const initialFatigue: Record<string, number> = {};
  for (const c of [home, away]) for (const p of c.squad) initialFatigue[p.id] = Math.max(0, Math.min(0.6, (1 - p.condition) * 0.8));
  const aiManaged: TeamId[] = [];
  if (f.home !== s.userClub) aiManaged.push(0);
  if (f.away !== s.userClub) aiManaged.push(1);
  return new Match(teamDef(home, 0), teamDef(away, 1), { seed: fixtureSeed(s, f), aiManaged, initialFatigue, ...opts });
}

/** Write a finished match back into the season: score, scorers, player stats, cards, fatigue, injuries, bans. */
export function recordResult(s: GameState, f: Fixture, m: Match): void {
  if (m.state.phase !== "FULL_TIME") throw new Error("match not finished");
  f.score = [m.state.score[0], m.state.score[1]];
  f.scorers = m.state.events
    .filter((e) => e.type === "GOAL" || e.type === "OWN_GOAL")
    .map((e) => `${e.minute}' ${e.playerId ? m.def(e.playerId).name : "?"}${e.type === "OWN_GOAL" ? " (OG)" : ""} (${m.teams[e.team!]!.shortName})`);
  const rng = new Rng(fixtureSeed(s, f) ^ 0x5bd1e995);
  const clubs: [Club, Club] = [clubOf(s, f.home), clubOf(s, f.away)];
  for (const side of [0, 1] as TeamId[]) {
    const c = clubs[side];
    const played = m.state.players.filter((p) => p.team === side && p.distance > 0);
    for (const ps of played) {
      const p = playerOf(c, ps.id);
      p.stats.apps++;
      p.stats.minutes += Math.round(90 * Math.min(1, ps.distance / 9000));
      p.condition = Math.max(0.2, 1 - ps.fatigue * 0.9);
      // Injuries: roughly one per club every 2-3 matches, more likely on tired legs. Mostly short.
      const intensity = c.training.intensity === "high" ? 1.3 : c.training.intensity === "low" ? 0.85 : 1;
      if (rng.chance(0.022 * (0.6 + ps.fatigue) * intensity)) {
        const days = Math.min(90, Math.round(3 + Math.pow(rng.next(), 2.2) * 60));
        p.injuryDays = days;
        s.news.unshift(`${c.shortName}: ${p.name} 부상, 약 ${days}일 결장.`);
      }
    }
    for (const e of m.state.events) {
      if (e.team !== side || !e.playerId) continue;
      const p = playerOf(c, e.playerId);
      if (e.type === "GOAL") p.stats.goals++;
      if (e.type === "YELLOW_CARD") {
        p.stats.yellows++;
        p.seasonYellows++;
        if (p.seasonYellows % 5 === 0) {
          p.ban = Math.max(p.ban, 1);
          s.news.unshift(`${c.shortName}: ${p.name} 경고 누적 5장으로 1경기 출장 정지.`);
        }
      }
      if (e.type === "RED_CARD") {
        p.stats.reds++;
        const secondYellow = m.state.events.some((x) => x.type === "YELLOW_CARD" && x.playerId === p.id && x.t < e.t);
        p.ban = Math.max(p.ban, secondYellow ? 1 : 2);
        s.news.unshift(`${c.shortName}: ${p.name} 퇴장, ${p.ban}경기 출장 정지.`);
      }
    }
    // Suspended players who sat out this match have served one game.
    const playedIds = new Set(played.map((p) => p.id));
    for (const p of c.squad) if (p.ban > 0 && !playedIds.has(p.id)) p.ban--;
  }
  const [h, a] = clubs;
  s.news.unshift(`${h.shortName} ${f.score[0]} - ${f.score[1]} ${a.shortName}`);
  if (s.news.length > 60) s.news.length = 60;
}

/** Simulate every unplayed fixture of the current round headlessly (the user's too, if asked). */
export function simulateRound(s: GameState, opts: MatchOptions = {}, includeUser = true): void {
  prepareRound(s);
  for (const f of currentFixtures(s)) {
    if (f.score) continue;
    if (!includeUser && (f.home === s.userClub || f.away === s.userClub)) continue;
    const m = createMatch(s, f, opts);
    m.runToEnd();
    recordResult(s, f, m);
  }
}

/** Close the round once every fixture has a result: a week passes (recovery, injuries heal). */
export function advanceRound(s: GameState): boolean {
  if (currentFixtures(s).some((f) => !f.score)) return false;
  s.round++;
  const rng = new Rng(s.seed * 19 + s.season * 503 + s.round * 7);
  for (const c of s.clubs) {
    const recover = c.training.intensity === "high" ? 0.5 : c.training.intensity === "low" ? 0.7 : 0.6;
    for (const p of c.squad) {
      p.condition = Math.min(1, p.condition + recover);
      p.injuryDays = Math.max(0, p.injuryDays - 7);
    }
    const dev = trainWeek(c, rng);
    if (c.id === s.userClub) for (const d of dev.slice(0, 3)) s.news.unshift(`훈련: ${d.player.name} ${ATTR_LABEL[d.attr]} ${d.delta > 0 ? "+1" : "-1"}`);
  }
  payWages(s, roundsPerSeason(s.clubs.length));
  if (s.round === 10) aiTransfers(s, new Rng(s.seed * 17 + s.season * 331));
  if (seasonOver(s)) s.news.unshift(`시즌 ${s.season} 종료. 우승: ${clubOf(s, table(s)[0]!.club).name}.`);
  return true;
}

/** Start the next season: ages, development, fresh fixtures and stats. */
export function startNextSeason(s: GameState): void {
  if (!seasonOver(s)) throw new Error("season still running");
  const rng = new Rng(s.seed * 13 + s.season * 977);
  const finalTable = table(s);
  for (const c of s.clubs) c.budget += seasonBudget(c.reputation, finalTable.findIndex((r) => r.club === c.id) + 1);
  settleContracts(s, s.season + 1, rng);
  for (const c of s.clubs) for (const p of c.squad) {
    p.age++;
    if (p.age >= 28) p.potential = Math.min(p.potential, Math.max(1, Math.round(p.potential * 10) / 10));
    p.seasonYellows = 0;
    p.ban = 0;
    p.injuryDays = 0;
    p.condition = 1;
    p.stats = { apps: 0, goals: 0, minutes: 0, yellows: 0, reds: 0 };
  }
  s.season++;
  s.round = 0;
  s.fixtures = buildFixtures(s.clubs.length);
  s.news.unshift(`시즌 ${s.season} 시작.`);
  aiTransfers(s, rng);
  prepareRound(s);
}

export function table(s: GameState): TableRow[] {
  const rows: TableRow[] = s.clubs.map((c) => ({ club: c.id, played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, pts: 0 }));
  for (const f of s.fixtures) {
    if (!f.score) continue;
    const h = rows[f.home]!, a = rows[f.away]!;
    const [hg, ag] = f.score;
    h.played++; a.played++;
    h.gf += hg; h.ga += ag; a.gf += ag; a.ga += hg;
    if (hg > ag) { h.won++; a.lost++; h.pts += 3; }
    else if (hg < ag) { a.won++; h.lost++; a.pts += 3; }
    else { h.drawn++; a.drawn++; h.pts++; a.pts++; }
  }
  return rows.sort((x, y) => y.pts - x.pts || (y.gf - y.ga) - (x.gf - x.ga) || y.gf - x.gf || s.clubs[x.club]!.name.localeCompare(s.clubs[y.club]!.name));
}

export function topScorers(s: GameState, n = 10): { player: SquadPlayer; club: Club }[] {
  const all: { player: SquadPlayer; club: Club }[] = [];
  for (const club of s.clubs) for (const player of club.squad) if (player.stats.goals > 0) all.push({ player, club });
  return all.sort((a, b) => b.player.stats.goals - a.player.stats.goals || b.player.stats.apps - a.player.stats.apps).slice(0, n);
}
