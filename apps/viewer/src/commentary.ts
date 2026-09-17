import type { Match, MatchEvent, TeamId } from "@3sec/engine";
import { goalCenter } from "@3sec/engine";

/**
 * 중계 자막: the engine's terse event log ("박지훈 슛 (xG 0.12)", "스로인: 창원") read out the way a
 * television commentator would call it. One line per event that deserves a line; the routine
 * restarts (throw-ins, most goal kicks, free kicks far from goal) stay quiet, as they do on air.
 *
 * The caller feeds events in order; the commentator keeps a little context — the last shot, the
 * score before the goal — so a save names the shooter and a goal knows whether it is the equaliser.
 * Phrase choice is deterministic in the event time, so a replayed log reads the same twice.
 */
export class Commentator {
  private lastShot: { name: string; team: TeamId; t: number; xg: number; header: boolean } | null = null;
  private lastScore: [number, number] = [0, 0];
  /** which kick-off comes next: the opening one, the second half's, or a restart after a goal */
  private nextKickOff: "first" | "second" | "restart" = "first";

  constructor(private readonly match: Match) {}

  /** Reset for a new match. */
  reset(): void { this.lastShot = null; this.lastScore = [0, 0]; this.nextKickOff = "first"; }

  /** The line for this event, or null when a commentator would let it pass. */
  line(e: MatchEvent): string | null {
    const m = this.match;
    const s = m.state;
    const team = e.team === null ? null : m.teams[e.team];
    const tn = team?.shortName ?? "";
    const name = e.playerId ? m.def(e.playerId).name : "";
    const pick = <T>(arr: readonly T[]): T => arr[Math.floor(Math.abs(e.t * 7 + e.minute * 13)) % arr.length]!;
    switch (e.type) {
      case "KICK_OFF": {
        const which = this.nextKickOff;
        this.nextKickOff = "restart";
        if (which === "first") return pick([`주심의 휘슬! ${tn} 킥오프로 경기 시작합니다.`, `경기 시작합니다. 킥오프는 ${tn}.`]);
        if (which === "second") return pick([`후반전 시작합니다. ${tn}의 킥오프.`, `후반 45분, 다시 시작합니다. ${tn} 볼.`]);
        return pick([`센터서클에서 다시 시작합니다.`, `킥오프. 경기 재개됩니다.`]);
      }
      case "SHOT": {
        if (/골대/.test(e.text)) { this.lastShot = { name, team: e.team!, t: e.t, xg: 0.3, header: false }; return pick([`골대!! ${name}의 슛이 골대를 때립니다!`, `아, 골대! ${name}, 정말 아깝습니다!`]); }
        const xg = Number(/xG ([\d.]+)/.exec(e.text)?.[1] ?? 0.05);
        const header = /헤딩/.test(e.text);
        this.lastShot = { name, team: e.team!, t: e.t, xg, header };
        if (header) return pick([`${name} 헤딩!`, `올라온 볼, ${name} 머리로 갖다 댑니다!`, `${name}, 헤딩 슛!`]);
        if (xg >= 0.3) return pick([`${name}, 절호의 기회!`, `${name} 슛! 이건 들어가야 하는데요!`, `골문 앞 ${name}!`]);
        if (xg < 0.08) return pick([`${name}, 먼 거리에서 한번 때려봅니다.`, `${name}, 중거리 슛!`, `${name}이(가) 과감하게 때립니다.`]);
        return pick([`${name} 슛!`, `${name}, 때립니다!`, `${name}의 슈팅!`]);
      }
      case "SAVE": {
        const shooter = this.lastShot && this.lastShot.team !== e.team && e.t - this.lastShot.t < 6 ? this.lastShot.name : "";
        const big = (this.lastShot?.xg ?? 0) >= 0.3;
        if (big) return pick([`${name} 선방!! ${shooter ? `${shooter}의 슛을 ` : ""}막아냅니다!`, `엄청난 선방! ${name}이(가) 팀을 구합니다!`, `${name}, 몸을 던져 쳐냅니다! 어떻게 막았을까요!`]);
        return pick([`${name} 선방.${shooter ? ` ${shooter}의 슛, 잡아냅니다.` : ""}`, `골키퍼 ${name}, 안정적으로 처리합니다.`, `${name}이(가) 막아냅니다.`]);
      }
      case "GOAL": {
        const scorer = name;
        const [h, a] = s.score;
        const [ph, pa] = this.lastScore;
        this.lastScore = [h, a];
        const side = e.team!;
        const mine = side === 0 ? h : a, theirs = side === 0 ? a : h;
        const wasBehind = (side === 0 ? ph < pa : pa < ph);
        const wasLevel = ph === pa;
        const tail = mine === theirs ? " 동점입니다!" : wasBehind && mine > theirs ? " 역전입니다!" : wasLevel ? ` ${tn}이(가) 앞서 갑니다!` : mine - theirs >= 3 ? " 승부가 기울고 있습니다." : " 격차를 벌립니다!";
        const late = s.half === 2 && s.clock >= m.halfLength - 5 * 60;
        const score = m.scoreline();
        if (late) return pick([`극장골!!! ${tn}의 ${scorer}! ${score}.${tail}`, `이 시간에 골이 터집니다! ${scorer}! ${score}.${tail}`]);
        return pick([`골! 골! 골입니다! ${tn}의 ${scorer}! ${score}.${tail}`, `${scorer}! 골망을 흔듭니다! ${score}.${tail}`, `들어갔습니다! ${tn} ${scorer}, ${score}.${tail}`]);
      }
      case "OWN_GOAL": {
        const [h, a] = s.score;
        this.lastScore = [h, a];
        return pick([`아… 자책골입니다. ${name}, 자기 골문으로 들어갑니다. ${m.scoreline()}.`, `자책골! ${name}에게는 악몽 같은 순간입니다. ${m.scoreline()}.`]);
      }
      case "ASSIST":
        return pick([`패스를 내준 건 ${name}이었습니다.`, `도움은 ${name}.`, `${name}의 어시스트가 빛났습니다.`]);
      case "CORNER":
        return pick([`코너킥.`, `코너킥입니다.`, `코너킥을 얻어냅니다.`, `코너 플래그 쪽으로 갑니다. 코너킥.`]);
      case "GOAL_KICK": {
        // only worth a word when a shot just went wide
        if (this.lastShot && e.t - this.lastShot.t < 6 && this.lastShot.team !== e.team) return pick([`빗나갑니다. 골킥.`, `옆그물! 골킥으로 이어집니다.`, `골문을 벗어납니다.`]);
        return null;
      }
      case "THROW_IN":
        return null;
      case "FOUL": {
        const mm = /파울: (.+?) → (.+)$/.exec(e.text);
        const victim = mm?.[2] ?? "";
        return pick([`휘슬! ${name}의 파울${victim ? `, ${victim}이(가) 쓰러집니다` : ""}.`, `${name}, 파울입니다.`, `주심이 ${name}의 파울을 선언합니다.`]);
      }
      case "FREE_KICK": {
        if (!e.pos || e.team === null) return null;
        const goal = goalCenter(m.dirOf(e.team));
        const d = Math.hypot(goal.x - e.pos.x, goal.y - e.pos.y);
        if (d > 30) return null;
        return pick([`슈팅 가능한 위치입니다. 프리킥!`, `위험한 지역에서 프리킥.`, `골문 가까운 곳에서 프리킥을 얻어냅니다.`]);
      }
      case "PENALTY":
        return pick([`페널티킥!! 주심이 페널티 스팟을 가리킵니다!`, `페널티! 절호의 기회가 옵니다!`]);
      case "OFFSIDE":
        return pick([`부심 깃발이 올라갑니다. ${name} 오프사이드.`, `오프사이드. ${name}이(가) 한 발 빨랐습니다.`, `공격이 오프사이드로 끊깁니다. ${name}.`]);
      case "YELLOW_CARD":
        return pick([`옐로카드. ${name}, 경고를 받습니다.`, `주심이 카드를 꺼냅니다. ${name} 경고.`, `${name}에게 경고. 조심해야겠습니다.`]);
      case "RED_CARD": {
        const left = e.team === null ? 10 : 11 - s.stats[e.team].reds;
        if (/누적/.test(e.text)) return `두 번째 경고! ${name} 퇴장입니다! ${tn}, ${left}명으로 싸웁니다.`;
        if (/다이렉트/.test(e.text)) return `레드카드!! ${name} 다이렉트 퇴장! ${tn}은(는) ${left}명입니다.`;
        return `${name} 퇴장. ${tn}, ${left}명으로 남은 시간을 버텨야 합니다.`;
      }
      case "SUBSTITUTION": {
        const mm = /: (.+?) OUT → (.+?) IN/.exec(e.text);
        const out = mm?.[1] ?? "", inn = mm?.[2] ?? name;
        return pick([`교체. ${out} 나가고 ${inn} 들어옵니다.`, `벤치가 움직입니다. ${inn} 투입, ${out} 아웃.`, `교체입니다. ${inn}이(가) ${out}을(를) 대신해 들어갑니다.`]);
      }
      case "TACTICS": {
        const f = /포메이션 변경 → (.+)$/.exec(e.text)?.[1];
        if (f) return `벤치에서 포메이션을 ${f}(으)로 바꿉니다.`;
        const list = /전술 조정: (.+)$/.exec(e.text)?.[1] ?? "";
        return `벤치에서 지시가 내려옵니다${list ? `. ${list}` : ""}.`;
      }
      case "INJURY": {
        const kind = /\((.+?)\)/.exec(e.text)?.[1] ?? "";
        return `${name}, 쓰러져 있습니다. ${kind ? `${kind} 부상인 것 같습니다. ` : ""}교체가 필요해 보입니다.`;
      }
      case "HALF_TIME": {
        const [h, a] = s.score;
        const note = h === 0 && a === 0 ? " 골 없이 전반을 마칩니다." : h === a ? " 팽팽합니다." : ` ${m.teams[h > a ? 0 : 1].shortName}이(가) 앞선 채 라커룸으로 들어갑니다.`;
        this.nextKickOff = "second";
        return `전반전 종료. ${m.scoreline()}.${note}`;
      }
      case "FULL_TIME": {
        const [h, a] = s.score;
        const note = h === a ? " 승점을 나눠 갖습니다." : ` ${m.teams[h > a ? 0 : 1].shortName}의 승리입니다.`;
        return `경기 종료! ${m.scoreline()}.${note}`;
      }
      default:
        return null;
    }
  }
}

/** Tidy the 이(가)/은(는)/을(를)/(으)로 placeholders by the syllable before them. */
export function josa(text: string): string {
  const batchim = (ch: string): boolean | null => {
    const c = ch.charCodeAt(0);
    if (c < 0xac00 || c > 0xd7a3) return null;
    return (c - 0xac00) % 28 !== 0;
  };
  return text.replace(/(\S)(이\(가\)|은\(는\)|을\(를\)|\(으\)로)/g, (_, prev: string, p: string) => {
    const b = batchim(prev);
    if (p === "이(가)") return prev + (b === false ? "가" : "이");
    if (p === "은(는)") return prev + (b === false ? "는" : "은");
    if (p === "을(를)") return prev + (b === false ? "를" : "을");
    // (으)로: no 으 after a vowel or ㄹ
    const c = prev.charCodeAt(0);
    const jong = c >= 0xac00 && c <= 0xd7a3 ? (c - 0xac00) % 28 : -1;
    return prev + (jong === 0 || jong === 8 || b === null ? "로" : "으로");
  });
}

