/**
 * 팀 토크: the dressing room before kick-off. The manager picks one of four tones and every player answers
 * it in his own way — the ambitious one wants to be challenged, the hot head resents a rebuke, the
 * professional shrugs at all of it. What comes out is a morale move per player, which `matchAttrs` turns
 * into the attributes the engine plays with, so a talk is worth about a point of technique either way.
 *
 * Nothing here rolls dice: a reaction is the player's personality (derived from his id) read against the
 * situation, so the same talk in the same match always lands the same way.
 *
 * Hooks: `talkOptions` and `giveTalk` from the viewer's pre-match sheet, before `createMatch` strips the
 * squad; `talkGiven` keeps it to one talk per fixture.
 */
import type { Club, GameState, SquadPlayer } from "./types";
import { adjustMorale, moraleOf, personalityOf, leadership, captainOf, lockerRoom } from "./morale";

export type TalkTone = "praise" | "calm" | "demand" | "rebuke";

/** How the dressing room stands when the manager walks in. */
export interface TalkContext {
  /** the user's side is at home */
  home: boolean;
  opponent: string;
  /** the user's side is the stronger of the two on reputation */
  favourite: boolean;
  /** a derby, or a manager the papers have made a feud of */
  derby: boolean;
  /** results of the last five, newest first: "W" | "D" | "L" */
  form: string;
}

export interface TalkOption {
  tone: TalkTone;
  /** the button */
  label: string;
  /** what the manager says, written for this situation */
  line: string;
}

export interface TalkReaction {
  id: string;
  name: string;
  /** morale move, one decimal */
  delta: number;
}

export interface TalkResult {
  tone: TalkTone;
  /** average morale move across the eleven */
  lift: number;
  /** every starter, best reaction first */
  reactions: TalkReaction[];
  /** the room's own line back */
  note: string;
}

/** The biggest morale a single talk can move a player, either way. */
export const TALK_MAX = 8;
/** The fit at which a tone is worth nothing: below it the talk costs morale, above it the talk pays. */
export const TALK_NEUTRAL = 1.9;
/** How far the fit either side of neutral is stretched into morale. */
export const TALK_SCALE = 1.9;

const clamp = (x: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, x));
const round1 = (x: number): number => Math.round(x * 10) / 10;

/** Wins minus losses over the recent form string, −5…+5. */
const formScore = (form: string): number => {
  let n = 0;
  for (const ch of form.slice(0, 5)) n += ch === "W" ? 1 : ch === "L" ? -1 : 0;
  return n;
};

/**
 * How well a tone suits the room, before personality. A rebuke lands after a bad run and nowhere else;
 * praise carries an underdog and makes a favourite complacent; a demand suits the favourite and the
 * ambitious; calm is the tone that is never wrong and never much.
 */
export function toneFit(tone: TalkTone, ctx: TalkContext): number {
  const f = formScore(ctx.form);
  switch (tone) {
    case "praise": return 2.4 - (ctx.favourite ? 1.4 : 0) + (f <= -1 ? 1.6 : 0) + (ctx.home ? 0.3 : 0.6);
    case "calm": return 2.0 + (ctx.derby ? 1.4 : 0) + (ctx.favourite ? 0.5 : 0);
    case "demand": return 0.6 + (ctx.favourite ? 2.0 : -0.6) + (f >= 2 ? 1.0 : 0) + (ctx.home ? 0.4 : -0.2);
    case "rebuke": return -1.4 + (f <= -2 ? 3.8 : f <= -1 ? 1.6 : 0) + (ctx.favourite ? 0.6 : -0.4);
  }
}

/**
 * One player's answer. The tone's fit is the room's; on top of it his own character speaks: ambition wants
 * to be challenged, a hot temperament takes a rebuke personally, loyalty answers praise, and a professional
 * moves less than anyone whatever is said.
 */
export function reactionOf(p: SquadPlayer, tone: TalkTone, ctx: TalkContext, room: number): number {
  const t = personalityOf(p);
  const m = moraleOf(p);
  let d = toneFit(tone, ctx);
  switch (tone) {
    case "praise":
      d += (t.loyalty - 0.5) * 2.0 + (m < 45 ? 1.4 : 0) - (t.ambition - 0.5) * 1.2;
      break;
    case "calm":
      d += (t.professionalism - 0.5) * 1.6 - Math.max(0, t.temperament - 0.6) * 1.0;
      break;
    case "demand":
      d += (t.ambition - 0.5) * 3.0 - (m < 40 ? 2.0 : 0) + (leadership(p) - 0.5) * 1.2;
      break;
    case "rebuke":
      d += -Math.max(0, t.temperament - 0.45) * 4.4 + (t.professionalism - 0.5) * 2.6 - (m < 50 ? 1.8 : 0);
      break;
  }
  // a settled dressing room takes everything better than an unhappy one
  d += (room - 60) / 30;
  // A tone that merely fits is worth nothing; the room notices only what suits it well or badly, so the
  // scale is pulled down by TALK_NEUTRAL and then stretched — a good read lifts the room, a bad one splits it.
  d = (d - TALK_NEUTRAL) * TALK_SCALE;
  // professionals keep their own counsel, whatever is said
  d *= 1 - (t.professionalism - 0.5) * 0.5;
  return round1(clamp(d, -TALK_MAX, TALK_MAX));
}

/** The four things the manager can say, written for this room. */
export function talkOptions(ctx: TalkContext): TalkOption[] {
  const f = formScore(ctx.form);
  const where = ctx.home ? "우리 홈에서" : `${ctx.opponent} 원정에서`;
  return [
    {
      tone: "praise", label: "격려",
      line: f <= -1
        ? "요 몇 경기 결과는 잊어라. 훈련장에서 본 너희는 이 정도 팀이 아니다. 나는 너희를 믿는다."
        : `${where} 겁먹을 이유가 하나도 없다. 여기 있는 열한 명이면 충분하다.`,
    },
    {
      tone: "calm", label: "침착",
      line: ctx.derby
        ? "관중이 뭐라 하든 우리 축구를 한다. 흥분하는 쪽이 진다. 90분을 길게 봐라."
        : "서두르지 마라. 하던 대로, 실수 하나에 무너지지 않는 팀이 이긴다.",
    },
    {
      tone: "demand", label: "요구",
      line: ctx.favourite
        ? `${ctx.opponent}는 우리보다 아래다. 그렇다면 첫 15분에 끝내라. 봐주는 경기는 없다.`
        : "약체 취급받는 게 지겹지 않나. 오늘 여기서 증명해라. 나는 결과를 원한다.",
    },
    {
      tone: "rebuke", label: "질책",
      line: f <= -2
        ? "지난 경기 후반 45분, 나는 우리 팀을 못 봤다. 오늘도 그러면 명단을 갈아엎겠다."
        : "훈련장에서의 집중력을 그라운드에 가져오지 못하고 있다. 오늘 보여줘라.",
    },
  ];
}

/** The room's line back, from how the eleven took it. */
function roomNote(tone: TalkTone, lift: number, worst: TalkReaction | undefined, cap: SquadPlayer | null): string {
  const who = cap ? `주장 ${cap.name}이(가)` : "고참들이";
  if (lift >= 2.5) return `${who} 고개를 끄덕입니다. 라커룸이 달아올랐습니다.`;
  if (lift >= 0.8) return `${who} 조용히 받아들입니다. 나쁘지 않은 반응입니다.`;
  if (lift > -0.5) return "라커룸은 조용합니다. 크게 달라진 건 없습니다.";
  if (worst) return `${worst.name}의 표정이 굳었습니다. ${tone === "rebuke" ? "질책이 과했습니다." : "말이 먹히지 않았습니다."}`;
  return "라커룸이 무겁습니다.";
}

/** Whether a talk has already been given for this fixture (one per match). */
export const talkGiven = (s: GameState, key: string): boolean => s.lastTalk?.key === key;

/**
 * Deliver the talk: every starter's morale moves, the locker room is recomputed, and the result is what
 * the viewer shows. `key` identifies the fixture so the same talk cannot be given twice.
 */
export function giveTalk(s: GameState, c: Club, tone: TalkTone, ctx: TalkContext, key: string): TalkResult {
  const room = c.lockerRoom ?? 60;
  const xi = c.selection.starters.map((id) => c.squad.find((p) => p.id === id)).filter((p): p is SquadPlayer => !!p);
  const reactions: TalkReaction[] = xi.map((p) => {
    const delta = reactionOf(p, tone, ctx, room);
    adjustMorale(p, delta);
    return { id: p.id, name: p.name, delta };
  });
  lockerRoom(c);
  const lift = reactions.length ? round1(reactions.reduce((a, r) => a + r.delta, 0) / reactions.length) : 0;
  const sorted = [...reactions].sort((a, b) => b.delta - a.delta);
  s.lastTalk = { key, tone, lift };
  return { tone, lift, reactions: sorted, note: roomNote(tone, lift, sorted[sorted.length - 1], captainOf(c)) };
}
