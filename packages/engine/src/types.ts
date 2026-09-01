import type { Vec2 } from "./math/vec";

export type TeamId = 0 | 1;
export type AttackDir = 1 | -1;

export type Role = "GK" | "CB" | "LB" | "RB" | "DM" | "CM" | "LM" | "RM" | "AM" | "LW" | "RW" | "ST";

/** Football Manager style attributes, 1..20 */
export interface Attributes {
  pace: number;
  acceleration: number;
  agility: number;
  strength: number;
  stamina: number;
  passing: number;
  vision: number;
  technique: number;
  firstTouch: number;
  dribbling: number;
  finishing: number;
  composure: number;
  tackling: number;
  marking: number;
  positioning: number;
  decisions: number;
  anticipation: number;
  // GK
  reflexes: number;
  handling: number;
  gkPositioning: number;
}

export interface PlayerDef {
  id: string;
  name: string;
  number: number;
  role: Role;
  attrs: Attributes;
}

export type FormationName = "4-3-3" | "4-4-2" | "4-2-3-1" | "3-5-2";

export interface Tactics {
  formation: FormationName;
  /** 0..1 – how high the defensive line sits */
  defensiveLine: number;
  /** 0..1 – how aggressively the team presses */
  pressing: number;
  /** 0..1 – how direct/vertical the passing is */
  directness: number;
  /** 0..1 – team width */
  width: number;
}

export interface TeamDef {
  id: TeamId;
  name: string;
  shortName: string;
  color: string;
  players: PlayerDef[]; // 11 starters, index 0 is GK
  tactics: Tactics;
}

export interface BallState {
  pos: Vec2;
  z: number;
  vel: Vec2;
  vz: number;
  /** id of the player currently controlling the ball, or null if loose */
  owner: string | null;
  /** last player to touch the ball */
  lastTouch: string | null;
  lastTouchTeam: TeamId | null;
  /** second-to-last toucher (used for own goal / deflection attribution) */
  prevTouch: string | null;
}

export interface PlayerState {
  id: string;
  team: TeamId;
  pos: Vec2;
  vel: Vec2;
  /** facing angle radians */
  facing: number;
  /** current move target (debug) */
  target: Vec2;
  desiredSpeed: number;
  /** 0..1 */
  fatigue: number;
  yellow: number;
  sentOff: boolean;
  /** cooldown before this player may kick again (s) */
  kickCooldown: number;
  /** time since gaining possession (s) */
  possessionTime: number;
  /** debug label of last decision */
  intent: string;
}

export type Phase =
  | "PRE_KICKOFF"
  | "PLAY"
  | "GOAL_CELEBRATION"
  | "RESTART_SETUP"
  | "HALF_TIME"
  | "FULL_TIME";

export type RestartKind =
  | "KICK_OFF"
  | "THROW_IN"
  | "GOAL_KICK"
  | "CORNER"
  | "FREE_KICK"
  | "PENALTY";

export interface Restart {
  kind: RestartKind;
  team: TeamId;
  pos: Vec2;
  takerId: string | null;
  /** seconds remaining until the restart is taken */
  timer: number;
}

export type MatchEventType =
  | "KICK_OFF"
  | "GOAL"
  | "OWN_GOAL"
  | "SHOT"
  | "SHOT_ON_TARGET"
  | "SAVE"
  | "THROW_IN"
  | "CORNER"
  | "GOAL_KICK"
  | "FREE_KICK"
  | "PENALTY"
  | "OFFSIDE"
  | "FOUL"
  | "YELLOW_CARD"
  | "RED_CARD"
  | "HALF_TIME"
  | "FULL_TIME"
  | "INTERCEPTION"
  | "BLOCK"
  | "TACKLE";

export interface MatchEvent {
  t: number; // match seconds
  minute: number;
  type: MatchEventType;
  team: TeamId | null;
  playerId: string | null;
  pos?: Vec2;
  text: string;
}

export interface TeamStats {
  possessionTicks: number;
  shots: number;
  shotsOnTarget: number;
  goals: number;
  corners: number;
  fouls: number;
  offsides: number;
  passes: number;
  passesCompleted: number;
  crosses: number;
  tackles: number;
  saves: number;
  xg: number;
  yellows: number;
  reds: number;
}

export interface MatchState {
  tick: number;
  /** seconds of match time elapsed within the current half (running clock) */
  clock: number;
  half: 1 | 2;
  addedTime: number;
  phase: Phase;
  phaseTimer: number;
  score: [number, number];
  attackDir: [AttackDir, AttackDir];
  ball: BallState;
  players: PlayerState[];
  restart: Restart | null;
  /** team that kicks off the second half */
  secondHalfKickoff: TeamId;
  events: MatchEvent[];
  stats: [TeamStats, TeamStats];
  /** offside bookkeeping: snapshot taken at the moment of the last pass */
  lastPass: {
    fromId: string;
    team: TeamId;
    t: number;
    offsidePositions: Record<string, boolean>;
  } | null;
  stoppages: number;
}
