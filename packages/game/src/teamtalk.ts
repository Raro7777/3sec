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
import type { Attributes } from "@3sec/engine";
import type { Club, GameState, SquadPlayer } from "./types";
import { adjustMorale, matchAttrs, moraleOf, personalityOf, leadership, captainOf, lockerRoom } from "./morale";

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
  /**
   * Half time instead of the tunnel: the goal difference so far from the user's side. Absent before
   * kick-off. At half time the score is the room's mood and the form no longer matters.
   */
  lead?: number;
  /** the match is over: the same score, but nothing left to play for with it */
  final?: boolean;
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
  if (ctx.lead !== undefined) return ctx.final ? fullTimeFit(tone, ctx.lead, ctx) : halfTimeFit(tone, ctx.lead, ctx);
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

/**
 * After the whistle nothing can be rescued, so the talk is about what the players carry into the week. A win
 * is praised, and a rebuke after one costs the room for nothing. A draw depends on who dropped points: the
 * stronger side let two go, the weaker side won one. A beating is the one result that answers to a rebuke.
 */
export function fullTimeFit(tone: TalkTone, lead: number, ctx: TalkContext): number {
  const won = lead > 0, drew = lead === 0, heavy = lead <= -2;
  switch (tone) {
    case "praise": return won ? (lead >= 3 ? 3.6 : 3.2) : drew ? (ctx.favourite ? 1.4 : 2.8) : heavy ? 0.8 : 2.2;
    case "calm": return 2.3;
    case "demand": return won ? (lead >= 3 ? 2.0 : 2.7) : drew ? (ctx.favourite ? 3.3 : 1.8) : 2.5;
    case "rebuke": return won ? -1.6 : drew ? (ctx.favourite ? 2.1 : -0.6) : heavy ? 3.6 : 1.2;
  }
}

/**
 * At half time the score has already said most of it. Ahead, the room needs holding together — calm sees
 * it out, a demand kills it off, a rebuke throws it away. Level, someone has to raise it. Behind, the
 * gentle tones stop working and the honest ones start: a heavy deficit is the one place a rebuke is the
 * right call.
 */
export function halfTimeFit(tone: TalkTone, lead: number, ctx: TalkContext): number {
  const derby = ctx.derby ? 0.4 : 0;
  switch (tone) {
    case "praise": return lead > 0 ? 2.6 : lead === 0 ? 2.2 : lead === -1 ? 2.4 : 1.2;
    case "calm": return (lead > 0 ? 3.4 : lead === 0 ? 2.2 : 1.4) + derby;
    case "demand": return lead > 0 ? 2.8 : lead === 0 ? 3.4 : 3.0;
    case "rebuke": return lead > 0 ? -1.0 : lead === 0 ? 0.8 : lead === -1 ? 2.2 : 3.4;
  }
}

/** After the whistle: nothing to rescue, only what they carry into the week. */
function fullTimeOptions(ctx: TalkContext): TalkOption[] {
  const lead = ctx.lead ?? 0;
  const opp = ctx.opponent;
  return [
    {
      tone: "praise", label: "격려",
      line: lead >= 3
        ? "오늘 같은 경기를 하려고 훈련한 거다. 전부 잘했다. 즐겨라."
        : lead > 0
          ? "이겼다. 힘든 경기였고, 너희가 끝까지 버텼다. 잘했다."
          : lead === 0
            ? `${opp} 상대로 승점 하나는 가져왔다. 고개 숙일 경기 아니다.`
            : "졌지만 싸웠다. 이런 경기를 계속하면 결과는 따라온다.",
    },
    {
      tone: "calm", label: "침착",
      line: lead > 0
        ? "한 경기다. 다음 주에 또 있다. 회복하고 다시 준비해라."
        : lead === 0
          ? "한 경기에 일희일비하지 마라. 시즌은 길다."
          : "이 경기는 여기서 끝이다. 오래 붙잡고 있지 마라. 월요일에 보자.",
    },
    {
      tone: "demand", label: "요구",
      line: lead > 0
        ? "이겼다고 다 된 게 아니다. 이 수준을 다음 주에도 보여줘라."
        : lead === 0
          ? "이건 우리가 잡았어야 하는 경기다. 다음엔 승점 하나로 만족하지 마라."
          : "이 결과를 기억해라. 다음 경기에서 갚아라. 나는 그걸 볼 거다.",
    },
    {
      tone: "rebuke", label: "질책",
      line: lead > 0
        ? "이기긴 했다. 하지만 내가 본 경기는 마음에 들지 않았다."
        : lead === 0
          ? "이런 상대에게 승점 하나. 우리가 어떤 팀인지 다시 생각해봐라."
          : lead <= -2
            ? "오늘 한 짓은 프로가 아니었다. 이 경기는 한 명씩 다시 보겠다."
            : "질 수는 있다. 이렇게 지는 건 안 된다.",
    },
  ];
}

/** Half time, with the score already said. */
function halfTimeOptions(ctx: TalkContext): TalkOption[] {
  const lead = ctx.lead ?? 0;
  const opp = ctx.opponent;
  return [
    {
      tone: "praise", label: "격려",
      line: lead > 0
        ? "전반 45분, 딱 내가 원하던 경기였다. 이대로만 해라."
        : lead === 0
          ? "밀리지 않았다. 한 방이면 넘어간다. 계속 두드려라."
          : "내용은 우리가 낫다. 운이 안 따랐을 뿐이다. 고개 들어라.",
    },
    {
      tone: "calm", label: "침착",
      line: lead > 0
        ? "한 골 앞선 게 아니라 45분이 남은 거다. 서두르면 우리가 준다. 하던 대로."
        : lead === 0
          ? "조급해지지 마라. 먼저 실수하는 쪽이 진다. 우리 리듬으로 끌고 간다."
          : `${opp}가 지치기 시작한다. 급하게 던지지 말고 한 번에 하나씩 되찾아라.`,
    },
    {
      tone: "demand", label: "요구",
      line: lead > 0
        ? "한 골로는 부족하다. 지금 끝내라. 두 번째 골이 오늘 경기를 닫는다."
        : lead === 0
          ? "45분 더 이렇게 할 셈인가. 누군가는 이 경기를 가져와야 한다. 나서라."
          : "남은 45분이 전부다. 지금부터 전부 쏟아붓지 않으면 끝이다.",
    },
    {
      tone: "rebuke", label: "질책",
      line: lead > 0
        ? "이기고 있다고 다 된 줄 아나. 후반에 이러면 뒤집힌다."
        : lead <= -2
          ? "이건 우리 팀이 아니다. 45분 동안 싸운 사람이 몇이나 되나. 다시 시작해라."
          : "전반 45분, 나는 아무것도 못 봤다. 이대로 끝낼 거면 지금 말해라.",
    },
  ];
}

/** The four things the manager can say, written for this room. */
export function talkOptions(ctx: TalkContext): TalkOption[] {
  if (ctx.lead !== undefined) return ctx.final ? fullTimeOptions(ctx) : halfTimeOptions(ctx);
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

/**
 * Words in the interval carry further than the morale they leave behind: a dressing room that has just been
 * lifted plays the second half differently even though, by next week, only the smaller lasting move remains.
 * So the attribute change is worked out as if the morale had moved this much further.
 */
export const HALF_TIME_MATCH_SCALE = 3;

/**
 * What the talk did to a player's match attributes: the difference `matchAttrs` makes between the morale he
 * walked in with and the morale the talk left him with, stretched by `scale`. The engine adds these to the
 * values it is already using (Match.adjustAttrs), so the talk reaches the pitch without discarding the home
 * edge or anything else baked in at kick-off. `before` is the morale from before the talk.
 */
export function talkAttrDelta(p: SquadPlayer, before: number, scale = HALF_TIME_MATCH_SCALE): Partial<Attributes> {
  const moved = (moraleOf(p) - before) * scale;
  const was = matchAttrs({ ...p, morale: before } as SquadPlayer);
  const now = matchAttrs({ ...p, morale: clamp(before + moved, 0, 100) } as SquadPlayer);
  const out: Partial<Attributes> = {};
  for (const k of Object.keys(now) as (keyof Attributes)[]) {
    const d = round1(now[k] - was[k]);
    if (d) out[k] = d;
  }
  return out;
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
