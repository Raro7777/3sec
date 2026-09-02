import type { Attributes, FormationName, PlayerDef, Role, Tactics } from "@3sec/engine";

/** Season counters of a player; the rating fields are optional for saves and squads built before match ratings. */
export interface PlayerStats {
  apps: number;
  goals: number;
  minutes: number;
  yellows: number;
  reds: number;
  assists?: number;
  /** sum of match ratings (average = ratingSum / ratedApps) */
  ratingSum?: number;
  ratedApps?: number;
  /** man-of-the-match awards (highest rating of the game) */
  motm?: number;
}

/** One finished season on a player's CV. */
export interface CareerEntry { season: number; club: number; apps: number; goals: number; assists: number; /** average match rating (0 without a rated appearance) */ rating: number }

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
  stats: PlayerStats;
  /** last five match ratings, oldest first (league + cup) */
  form?: number[];
  /** finished seasons, oldest first (appended at the rollover) */
  career?: CareerEntry[];
  /** away on loan at another club: stays in this squad but is unavailable and costs half a wage */
  onLoan?: boolean;
  /** borrowed from that club for the season; returns at the rollover */
  loanFrom?: number;
  /** free agents only: the season the player was released */
  freeSince?: number;
  /** refused to join the user's club this season (no second approach) */
  refusedSeason?: number;
  /** minutes played since the last training week (playing time feeds development; reset by trainWeek) */
  lastMinutes?: number;
}

export type OfferStatus = "open" | "accepted" | "rejected" | "expired" | "countered";

/** An AI club's bid for one of the user's players. */
export interface TransferOffer {
  id: string;
  from: number;
  playerId: string;
  fee: number;
  wageOffer?: number;
  /** the offer lapses once s.round reaches this */
  expiresRound: number;
  /** "countered": the user's counter was refused, the original fee still stands (one counter only) */
  status: OfferStatus;
  counterFee?: number;
}

/** A season-long loan; the player object lives in `to`'s squad (loanFrom) or stays in `from`'s (onLoan). */
export interface Loan {
  playerId: string;
  from: number;
  to: number;
  /** last season of the loan (returns at that rollover) */
  until: number;
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

/** Personality of an AI head coach; every trait runs 0..1 (0.5 = unremarkable). */
export interface ManagerTraits {
  /** attacking (1) vs defensive (0) football */
  attack: number;
  /** possession (1) vs direct / long-ball (0) */
  possession: number;
  /** how hard the side presses */
  pressing: number;
  /** pragmatist (1) adapts to the opponent; idealist (0) never changes */
  pragmatism: number;
  /** trusts youngsters, hoards prospects */
  youth: number;
  /** big spender (1) vs frugal (0) */
  spending: number;
  /** hard-nosed negotiator */
  stubborn: number;
  /** hot-headed: more extreme tactics, hard training */
  temper: number;
}

export type ManagerTraitId = keyof ManagerTraits;

/** One finished season on a manager's CV. */
export interface ManagerHistory { season: number; club: number; position: number }

/** An AI head coach; the user's club has none (the human is the manager). */
export interface Manager {
  id: string;
  name: string;
  age: number;
  traits: ManagerTraits;
  /** the season he took charge of the current club (or joined the free pool) */
  since: number;
  history: ManagerHistory[];
}

/** Coaching-staff roles: 수석코치, 피지컬 코치, 유스 코치, GK 코치, 스카우트, 의무 팀장. */
export type StaffRole = "assistant" | "fitness" | "youth" | "gk" | "scout" | "physio";

/** One member of a club's coaching staff (or of the free pool in `GameState.staffMarket`). */
export interface StaffMember {
  id: string;
  name: string;
  role: StaffRole;
  /** 1..20 */
  rating: number;
  age: number;
  /** salary per season in 억원 (≈ 0.15 × rating^1.3 / 10, at least 0.3) */
  wage: number;
  /** last season the contract covers */
  contractUntil: number;
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
  /** coaching staff (see staff.ts); at most MAX_STAFF, one per role except two assistants */
  staff: StaffMember[];
  /** the AI head coach; null for the user's club */
  manager: Manager | null;
  /** consecutive board reviews the club sat well below its expected position (sacking follows) */
  pressure: number;
  /** budget when the season began (the review screen shows the change since) */
  seasonStartBudget: number;
  /** injuries suffered this season (league + cup); reset at the rollover */
  seasonInjuries?: number;
  /** wages actually paid this season (억원); reset at the rollover */
  seasonWages?: number;
  /** coaching-staff wages paid this season (억원, staff.ts); reset at the rollover with seasonWages */
  seasonStaffWages?: number;
  /** income actually banked this season (억원); reset at the rollover */
  seasonRevenue?: number;
  /** gate receipts banked this season (억원, part of seasonRevenue; fans.ts); reset at the rollover */
  seasonGate?: number;
  /** stadium seats (fans.ts; mirrored by the viewer's stadiums.ts) */
  capacity: number;
  /** the supporters: mood and attendance counters (fans.ts) */
  fans: Fans;
}

/** A club's supporters (fans.ts). */
export interface Fans {
  /** core supporters who turn up whatever happens (derived from reputation and capacity) */
  base: number;
  /** 0..100 – how the fans feel about the team right now (55 = content) */
  mood: number;
  /** consecutive weekly updates with the mood under FAN_PROTEST_BELOW (a protest follows) */
  lowWeeks: number;
  /** crowd at the last home match (0 before the first) */
  lastAttendance: number;
  /** home crowds summed this season */
  seasonAttendance: number;
  /** home matches played this season */
  seasonHome: number;
  /** biggest home crowd this season */
  bestAttendance: number;
}

export interface Fixture {
  id: number;
  round: number;
  home: number;
  away: number;
  score: [number, number] | null;
  /** "12' Kim Minjun (SEO)" lines for the result screen */
  scorers: string[];
  /** man of the match: the highest-rated player of the game */
  motm?: { playerId: string; rating: number };
  /** home crowd (fans.ts; set when the result is recorded) */
  attendance?: number;
}

/** One knockout tie of the 3sec 컵. Stage 0 = round 1 (8 clubs), 1 = QF, 2 = SF, 3 = final. */
export interface CupTie {
  id: number;
  stage: number;
  home: number;
  away: number;
  score: [number, number] | null;
  /** shoot-out result when the tie was level after 90 minutes */
  penalties?: [number, number];
  scorers: string[];
  /** man of the match (see ratings.ts) */
  motm?: { playerId: string; rating: number };
  /** home crowd (fans.ts) */
  attendance?: number;
}

export interface Cup {
  ties: CupTie[];
  /** stage being played next: 0..3, 4 once the final is done */
  stage: number;
  /** this season's winner once the final is played */
  holder?: number;
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

export type MarketKind = "transfer" | "loan" | "free";

/** One completed deal anywhere in the league (transfer, loan or free-agent signing). */
export interface MarketEntry {
  season: number;
  text: string;
  kind: MarketKind;
  /** fee in 억원 (0 for loans) */
  fee: number;
  /** selling / lending club, absent for free-agent signings */
  from?: number;
  to: number;
  playerId: string;
  playerName: string;
}

/** A finished season, kept for the review's history list. */
export interface SeasonRecord {
  season: number;
  champion: number;
  cupWinner: number | null;
  userPosition: number;
  userPts: number;
  /** 올해의 감독: the manager who beat his club's expectation by the most */
  managerOfYear?: ManagerOfYear;
}

/** Why and when the user's board pulled the trigger (the viewer shows the sacked screen while this is set). */
export interface SackRecord {
  season: number;
  /** rounds played when it happened (roundsPerSeason at the rollover) */
  round: number;
  position: number;
  expected: number;
  pts: number;
  reason: "warnings" | "rollover";
}

/** The user's board: how much it trusts the manager (0..100) and the warnings it has issued this season. */
export interface Board {
  confidence: number;
  warnings: number;
  /** the round of the last weekly review (-1 before the first) */
  lastReview: number;
  /** consecutive reviews with confidence below the warning line */
  lowWeeks: number;
  /** set while the user is between jobs */
  sacked?: SackRecord;
}

/** Winner of the season's manager award (the user may win it too). */
export interface ManagerOfYear { name: string; club: number; position: number; expected: number }

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
  /** season in which the title-clinch celebration was already shown */
  celebratedSeason?: number;
  /** season whose cup win the viewer already celebrated */
  cupCelebratedSeason?: number;
  cup: Cup;
  /** the next matchday is a cup matchday (set when the league reaches a cup round) */
  pendingCupDay: boolean;
  /** incoming bids for the user's players (open ones and this week's resolved ones) */
  offers: TransferOffer[];
  /** released players anyone can sign for a signing fee */
  freeAgents: SquadPlayer[];
  loans: Loan[];
  /** "season:window:clubId" markers, one per AI purchase – at most AI_DEALS_PER_WINDOW of the same key */
  aiDeals: string[];
  /** every completed transfer / loan / free-agent signing league-wide, newest first, capped at 80 */
  marketLog: MarketEntry[];
  /** finished seasons, oldest first */
  seasonHistory: SeasonRecord[];
  /** sacked managers waiting for a job, newest first, capped at 10 */
  freeManagers: Manager[];
  /** the user's board (confidence, warnings, sacking) */
  board: Board;
  /** free coaching staff anyone can hire; regenerated at each window (staff.ts creates it on demand) */
  staffMarket?: StaffMember[];
  /** key of the window the staff market was generated for (staff.ts) */
  staffMarketKey?: string;
  /** the season staffRollover last ran for (staff.ts; makes the rollover idempotent) */
  staffSeason?: number;
}
