/**
 * 인터뷰: after every match the user plays (league or cup) the press asks one question with three answers — praise,
 * criticism, or a neutral line. Templates follow the result and its context (derby, big win, heavy loss, a youngster
 * who scored, a star who went missing). Each answer moves the squad's morale, the named player's morale, the board's
 * confidence (±1) and the fans' mood (±2). An interview left unanswered when the next round closes is settled with the
 * neutral answer.
 *
 * Hooks: `pressConference` from recordResult, `skipInterview` from advanceRound.
 */
import type { Match } from "@3sec/engine";
import type { Club, Fixture, GameState, Interview, InterviewOption, SquadPlayer } from "./types";
import { clubOf } from "./season";
import { adjustMood } from "./fans";
import { adjustMorale, adjustSquadMorale, moraleOf } from "./morale";
import { isDerby } from "./lore";
import { overall } from "./rating";

export type InterviewContext = "derby_win" | "derby_loss" | "big_win" | "heavy_loss" | "youngster" | "star_flop" | "win" | "draw" | "loss";

const clamp = (x: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, x));
const round1 = (x: number): number => Math.round(x * 10) / 10;

interface Ctx { s: GameState; me: Club; opp: Club; gf: number; ga: number; cup: boolean; player?: SquadPlayer }

/** The three answers for a context. `player` effects only apply when a player is named. */
function options(kind: InterviewContext, c: Ctx): InterviewOption[] {
  const name = c.player?.name ?? "";
  const opp = c.opp.shortName;
  const praise = (label: string, reply: string, o: Partial<InterviewOption> = {}): InterviewOption => ({ label, kind: "praise", squad: 2, player: 4, board: 0, fans: 1, reply, ...o });
  const scold = (label: string, reply: string, o: Partial<InterviewOption> = {}): InterviewOption => ({ label, kind: "criticize", squad: -2, player: -6, board: 1, fans: 1, reply, ...o });
  const quiet = (label: string, reply: string, o: Partial<InterviewOption> = {}): InterviewOption => ({ label, kind: "neutral", squad: 0, player: 0, board: 0, fans: 0, reply, ...o });
  switch (kind) {
    case "derby_win": return [
      praise("선수들이 자랑스럽다", `"라이벌전에서 이런 투지를 보여준 선수들이 자랑스럽습니다."`, { squad: 3, fans: 2, board: 1 }),
      scold("아직 멀었다", `"이겼지만 전반 내용은 부끄러웠습니다. 더 잘해야 합니다."`, { squad: -1, fans: -1, board: 0 }),
      quiet("팬들 덕분이다", `"오늘의 승리는 팬들의 것입니다. 우리는 다음 경기를 준비합니다."`, { fans: 2 }),
    ];
    case "derby_loss": return [
      praise("선수들은 최선을 다했다", `"결과는 아프지만 선수들을 탓하지 않겠습니다. 책임은 제게 있습니다."`, { squad: 2, fans: -2, board: -1, player: 0 }),
      scold("용납할 수 없는 경기", `"라이벌전에서 이런 태도는 용납할 수 없습니다. 선수단과 이야기하겠습니다."`, { squad: -3, fans: 2, board: 1 }),
      quiet("한 경기일 뿐이다", `"더비도 승점 3점짜리 한 경기입니다. 다음을 준비하겠습니다."`, { fans: -1 }),
    ];
    case "big_win": return [
      praise("완벽한 경기였다", `"오늘은 우리가 준비한 모든 것이 통했습니다. 선수들에게 박수를 보냅니다."`, { squad: 3, fans: 1, board: 0 }),
      scold("만족하기엔 이르다", `"큰 승리지만 여기서 만족하면 다음 주에 대가를 치릅니다."`, { squad: -1, board: 1, fans: 0 }),
      quiet("상대가 흔들렸을 뿐", `"점수 차만큼 우리가 잘한 건 아닙니다. 냉정하게 보겠습니다."`),
    ];
    case "heavy_loss": return [
      praise("선수들을 감싼다", `"오늘 결과의 책임은 전적으로 제게 있습니다. 선수들은 잘못이 없습니다."`, { squad: 2, board: -1, fans: -1 }),
      scold("선수단에 실망했다", `"이런 경기력은 프로가 아닙니다. 선수단에 강하게 이야기하겠습니다."`, { squad: -3, board: 1, fans: 1 }),
      quiet("분석 후 답하겠다", `"영상을 다시 보고 문제를 찾겠습니다. 지금은 드릴 말씀이 없습니다."`, { fans: -1 }),
    ];
    case "youngster": return [
      praise(`${name}을(를) 칭찬한다`, `"${name}은(는) 오늘 나이를 잊게 하는 경기를 했습니다. 큰 선수가 될 겁니다."`, { player: 8, squad: 1, fans: 2 }),
      scold("아직 배울 게 많다", `"골 하나로 들뜨면 안 됩니다. ${name}은(는) 아직 배울 것이 많습니다."`, { player: -4, squad: 0, board: 1 }),
      quiet("팀이 잘한 것", `"${name}의 골은 팀 전체가 만든 겁니다. 특정 선수를 띄우진 않겠습니다."`, { player: 1 }),
    ];
    case "star_flop": return [
      praise(`${name}을(를) 감싼다`, `"${name}도 사람입니다. 매 경기 최고일 순 없어요. 다음 경기에 보여줄 겁니다."`, { player: 5, squad: 1, fans: -1 }),
      scold(`${name}에게 더 바란다`, `"${name} 정도의 선수라면 오늘 같은 경기는 안 됩니다. 본인도 알 겁니다."`, { player: -8, squad: -1, board: 1, fans: 1 }),
      quiet("개별 평가는 하지 않는다", `"선수 개개인은 안에서 평가합니다. 밖에서 말씀드릴 건 없습니다."`),
    ];
    case "win": return [
      praise("선수들이 잘해줬다", `"준비한 대로 선수들이 해냈습니다. 칭찬받아 마땅합니다."`, { squad: 2, fans: 1 }),
      scold("아쉬운 부분이 있었다", `"이겼지만 집중력이 떨어진 구간이 있었습니다. 고쳐야 합니다."`, { squad: -1, board: 1 }),
      quiet("다음 경기에 집중", `"승점 3점을 가져온 것으로 충분합니다. 다음 경기를 봅니다."`),
    ];
    case "draw": return [
      praise("좋은 경기였다", `"${opp} 상대로 내용은 좋았습니다. 결과가 따라오지 않았을 뿐입니다."`, { squad: 1, fans: 0, board: 0 }),
      scold("이겼어야 할 경기", `"이런 경기는 잡았어야 합니다. 마무리가 아쉬웠습니다."`, { squad: -1, board: 1, fans: 1 }),
      quiet("승점 1점도 승점", `"원하던 결과는 아니지만 승점 1점은 가져갑니다."`),
    ];
    case "loss": default: return [
      praise("선수들을 믿는다", `"오늘 졌지만 이 선수들을 믿습니다. 곧 반등할 겁니다."`, { squad: 2, board: -1, fans: -1 }),
      scold("이래선 안 된다", `"이런 경기력으로는 아무것도 얻을 수 없습니다. 변화가 있을 겁니다."`, { squad: -2, board: 1, fans: 1 }),
      quiet("결과를 받아들인다", `"${opp}이(가) 오늘은 더 나았습니다. 받아들이고 준비하겠습니다."`),
    ];
  }
}

function question(kind: InterviewContext, c: Ctx): string {
  const opp = c.opp.name, name = c.player?.name ?? "";
  const score = `${c.gf}-${c.ga}`;
  switch (kind) {
    case "derby_win": return `라이벌 ${opp}을(를) ${score}로 꺾었습니다. 팬들이 열광하고 있는데, 선수들에게 한마디 하신다면?`;
    case "derby_loss": return `라이벌전에서 ${score}로 졌습니다. 홈 팬들의 야유가 있었는데, 오늘 경기를 어떻게 평가하십니까?`;
    case "big_win": return `${opp}을(를) ${score}로 대파했습니다. 오늘 경기, 시즌 최고의 경기였다고 봐도 될까요?`;
    case "heavy_loss": return `${opp}에 ${score} 대패입니다. 오늘 같은 경기력, 감독님은 어떻게 설명하시겠습니까?`;
    case "youngster": return `${c.player?.age}세 ${name}이(가) 오늘 골을 넣었습니다. 어린 선수의 활약, 어떻게 보셨습니까?`;
    case "star_flop": return `팀의 간판 ${name}이(가) 오늘 평점 ${round1(c.player?.form?.[c.player.form.length - 1] ?? 0).toFixed(1)}로 부진했습니다. 무슨 문제가 있었나요?`;
    case "win": return `${opp}에 ${score} 승리입니다. 오늘 경기 총평 부탁드립니다.`;
    case "draw": return `${opp}과(와) ${score} 무승부입니다. 승점 1점, 만족하시나요?`;
    case "loss": default: return `${opp}에 ${score}로 패했습니다. 오늘 패인은 무엇이었습니까?`;
  }
}

/** The context the press picks: the most newsworthy angle first. */
export function interviewContext(c: Ctx): InterviewContext {
  const derby = isDerby(c.me.id, c.opp.id);
  const margin = c.gf - c.ga;
  if (derby && margin > 0) return "derby_win";
  if (derby && margin < 0) return "derby_loss";
  if (c.player && c.player.age <= 21 && margin >= 0) return "youngster";
  if (margin >= 3) return "big_win";
  if (margin <= -3) return "heavy_loss";
  if (c.player && margin <= 0) return "star_flop";
  return margin > 0 ? "win" : margin < 0 ? "loss" : "draw";
}

/** The youngster who scored or the star who flopped, if the match has one (the goal scorer wins). */
function talkingPoint(me: Club, m: Match, side: 0 | 1, margin: number): SquadPlayer | undefined {
  const scorers = new Set(m.state.events.filter((e) => e.type === "GOAL" && e.team === side && e.playerId).map((e) => e.playerId!));
  const young = me.squad.filter((p) => scorers.has(p.id) && p.age <= 21).sort((a, b) => a.age - b.age)[0];
  if (young && margin >= 0) return young;
  const xi = me.selection.starters.map((id) => me.squad.find((p) => p.id === id)).filter((p): p is SquadPlayer => !!p);
  const star = [...xi].sort((a, b) => overall(b.attrs, b.role) - overall(a.attrs, a.role))[0];
  const last = star?.form?.[star.form.length - 1];
  if (star && margin <= 0 && typeof last === "number" && last < 6) return star;
  return undefined;
}

/**
 * Called by recordResult once the score, ratings and form are in: builds the user's post-match interview (an earlier
 * unanswered one is settled neutrally first). Returns it, or null when the user did not play.
 */
export function pressConference(s: GameState, f: Pick<Fixture, "id" | "home" | "away" | "score">, m: Match, cup = false): Interview | null {
  if (!f.score || (f.home !== s.userClub && f.away !== s.userClub)) return null;
  if (s.pendingInterview) skipInterview(s);
  const side: 0 | 1 = f.home === s.userClub ? 0 : 1;
  const me = clubOf(s, s.userClub), opp = clubOf(s, side === 0 ? f.away : f.home);
  const gf = f.score[side], ga = f.score[1 - side]!;
  const player = talkingPoint(me, m, side, gf - ga);
  const c: Ctx = { s, me, opp, gf, ga, cup, player };
  const context = interviewContext(c);
  const iv: Interview = { id: `iv-${s.season}-${s.round}-${cup ? "c" : "l"}-${f.id}`, context, question: question(context, c), options: options(context, c), cup, opponent: opp.id, round: s.round };
  if (player && (context === "youngster" || context === "star_flop")) iv.playerId = player.id;
  s.pendingInterview = iv;
  return iv;
}

/** Applies one answer: squad morale, the named player, the board, the fans; a news line; the interview is cleared. */
export function answerInterview(s: GameState, optionIndex: number): string | null {
  const iv = s.pendingInterview;
  if (!iv) return "대기 중인 인터뷰가 없습니다";
  const o = iv.options[optionIndex];
  if (!o) return "없는 답변입니다";
  const me = clubOf(s, s.userClub);
  if (o.squad) adjustSquadMorale(me, o.squad);
  const p = iv.playerId ? me.squad.find((q) => q.id === iv.playerId) : undefined;
  if (p && o.player) adjustMorale(p, o.player);
  if (o.board && s.board && !s.board.sacked) s.board.confidence = round1(clamp(s.board.confidence + o.board, 0, 100));
  if (o.fans && me.fans) adjustMood(me, o.fans);
  const eff: string[] = [];
  if (o.squad) eff.push(`팀 사기 ${o.squad > 0 ? "+" : ""}${o.squad}`);
  if (p && o.player) eff.push(`${p.name} 사기 ${o.player > 0 ? "+" : ""}${o.player} (${moraleOf(p)})`);
  if (o.board) eff.push(`이사회 ${o.board > 0 ? "+" : ""}${o.board}`);
  if (o.fans) eff.push(`팬 ${o.fans > 0 ? "+" : ""}${o.fans}`);
  s.news.unshift(`인터뷰: ${s.managerName} 감독 ${o.reply}${eff.length ? ` → ${eff.join(", ")}` : ""}`);
  s.pendingInterview = undefined;
  return null;
}

/** No answer before the next round: the neutral line goes out (called by advanceRound and by the next press conference). */
export function skipInterview(s: GameState): void {
  const iv = s.pendingInterview;
  if (!iv) return;
  const idx = Math.max(0, iv.options.findIndex((o) => o.kind === "neutral"));
  answerInterview(s, idx);
}
