import type { MatchEventType, MatchState, TeamId } from "@3sec/engine";

/** One recorded engine tick: enough to redraw the pitch. */
export interface FramePlayer { id: string; team: TeamId; x: number; y: number; f: number }
export interface Frame { clock: number; half: number; bx: number; by: number; bz: number; owner: string | null; players: FramePlayer[] }

/** A highlight cut from the recorder: the seconds before a goal, an offside flag, a red card… */
export interface Clip {
  id: number;
  type: MatchEventType;
  minute: number;
  team: TeamId | null;
  text: string;
  frames: Frame[];
}

/** Ring buffer of the last `seconds` of the user's match at 20 Hz. */
export class Recorder {
  private buf: Frame[] = [];
  private readonly cap: number;
  constructor(seconds = 12, hz = 20) { this.cap = seconds * hz; }

  reset(): void { this.buf = []; }

  push(s: MatchState): void {
    const players: FramePlayer[] = [];
    for (const p of s.players) if (p.onPitch && !p.sentOff) players.push({ id: p.id, team: p.team, x: p.pos.x, y: p.pos.y, f: p.facing });
    this.buf.push({ clock: s.clock, half: s.half, bx: s.ball.pos.x, by: s.ball.pos.y, bz: s.ball.z, owner: s.ball.owner, players });
    if (this.buf.length > this.cap) this.buf.splice(0, this.buf.length - this.cap);
  }

  /** The last `seconds` of play as a fresh array. */
  cut(seconds: number, hz = 20): Frame[] {
    return this.buf.slice(Math.max(0, this.buf.length - Math.round(seconds * hz)));
  }
}

/** Which events earn a clip, and how many seconds before them to keep. */
export const CLIP_SECONDS: Partial<Record<MatchEventType, number>> = { GOAL: 7, OWN_GOAL: 7, OFFSIDE: 5, RED_CARD: 5, PENALTY: 5 };
