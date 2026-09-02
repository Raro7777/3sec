import type { Attributes, FormationName, PlayerDef, Role, Tactics } from "@3sec/engine";

/** A squad member: the engine's player definition plus career/season state. */
export interface SquadPlayer extends PlayerDef {
  age: number;
  /** freshness 0..1 (1 = fully rested); becomes starting fatigue in the next match */
  condition: number;
  /** days until fit again (0 = fit) */
  injuryDays: number;
  /** matches still to serve of a suspension */
  ban: number;
  /** yellow cards accumulated this season toward the next one-match ban */
  seasonYellows: number;
  /** ceiling the player can grow toward (attribute scale, 1..20) */
  potential: number;
  /** fractional development accumulated by weekly training (+ grows, − declines) */
  growth: number;
  /** salary per season in 억원 */
  wage: number;
  /** last season the contract covers (expires after that season) */
  contractUntil: number;
  stats: { apps: number; goals: number; minutes: number; yellows: number; reds: number };
}

export interface Selection {
  formation: FormationName;
  /** 11 player ids in formation slot order (slot 0 = GK) */
  starters: string[];
  /** up to 7 substitutes */
  bench: string[];
}

export type ScoutingTier = "none" | "local" | "regional" | "national";

/** A youth-academy prospect: not yet a squad member, potential only partly known. */
export interface YouthProspect {
  id: string;
  name: string;
  /** 15..18; leaves automatically once 19 without promotion */
  age: number;
  role: Role;
  attrs: Attributes;
  /** what the scouts believe: the true potential lies inside, the range narrows with reports */
  potentialRange: [number, number];
  /** hidden ceiling (1..20) – becomes the player's potential on promotion */
  truePotential: number;
  /** scouting reports delivered so far (0..3) */
  reportsSeen: number;
  /** fractional development accumulated by academy training */
  growth: number;
  joinedRound: number;
  weeksInAcademy: number;
}

export interface Youth {
  prospects: YouthProspect[];
  scouting: ScoutingTier;
  /** 1..3 – academy coaching level */
  coaching: number;
  /** running counter behind prospect ids (unique for the life of the save) */
  nextId: number;
}

export type TrainingFocus = "balanced" | "attacking" | "defending" | "technical" | "physical" | "tactical";
export type TrainingIntensity = "low" | "normal" | "high";

export interface Club {
  id: number;
  name: string;
  shortName: string;
  color: string;
  /** 1..20 – squad quality the club was built around */
  reputation: number;
  /** transfer budget in 억원 */
  budget: number;
  squad: SquadPlayer[];
  tactics: Tactics;
  selection: Selection;
  training: { focus: TrainingFocus; intensity: TrainingIntensity };
  youth: Youth;
}

export interface Fixture {
  id: number;
  round: number;
  home: number;
  away: number;
  score: [number, number] | null;
  /** "12' Kim Minjun (SEO)" lines for the result screen */
  scorers: string[];
}

export interface TableRow {
  club: number;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  gf: number;
  ga: number;
  pts: number;
}

export interface GameState {
  version: 1;
  seed: number;
  season: number;
  /** index of the next round to play (0-based); === roundsPerSeason when the season is over */
  round: number;
  userClub: number;
  /** the human manager's display name (default "감독") */
  managerName: string;
  clubs: Club[];
  fixtures: Fixture[];
  /** newest first, human-readable news (injuries, bans, results) */
  news: string[];
}
