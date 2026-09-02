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
  /** budget when the season began (the review screen shows the change since) */
  seasonStartBudget: number;
  /** injuries suffered this season (league + cup); reset at the rollover */
  seasonInjuries?: number;
  /** wages actually paid this season (억원); reset at the rollover */
  seasonWages?: number;
  /** income actually banked this season (억원); reset at the rollover */
  seasonRevenue?: number;
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
}
