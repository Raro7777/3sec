/**
 * 마지막 지시: once per match, from LAST_CALL_FROM, the manager shouts one of three things at the touchline.
 * Each is a tactics patch the viewer applies through Match.setTactics; the engine does the rest.
 */
import type { Tactics } from "@3sec/engine";

/** The call is offered from this minute of a 90-minute match; shorter matches scale (lastCallDue). */
export const LAST_CALL_MINUTE = 75;
/** Match second from which the call is offered in a full-length match. */
export const LAST_CALL_FROM = LAST_CALL_MINUTE * 60;
/** Is it time, given the seconds played (Match.matchSeconds) and the half length the match runs with? */
export const lastCallDue = (matchSeconds: number, halfLength: number): boolean => matchSeconds >= 2 * halfLength * (LAST_CALL_MINUTE / 90);

export type LastCallId = "allOut" | "lockDown" | "waste";
export interface LastCall { id: LastCallId; label: string; icon: string; hint: string; shout: string; patch: Partial<Tactics> }

export const LAST_CALLS: LastCall[] = [
  { id: "allOut", label: "총공격", icon: "🔥", hint: "라인을 올리고 전원 공격. 골이 필요할 때 — 역습은 각오하세요.", shout: "올려! 전부 올라가!",
    patch: { mentality: 0.95, defensiveLine: 0.8, pressing: 0.85, engageLine: 0.85, directness: 0.7, tempo: 0.85, width: 0.7, counter: 0.3 } },
  { id: "lockDown", label: "잠그기", icon: "🔒", hint: "내려앉아 지킵니다. 리드를 지킬 때 — 공은 상대가 갖습니다.", shout: "내려와! 라인 지켜!",
    patch: { mentality: 0.1, defensiveLine: 0.2, pressing: 0.3, engageLine: 0.2, directness: 0.6, tempo: 0.35, width: 0.4, counter: 0.7, offsideTrap: false } },
  { id: "waste", label: "시간 끌기", icon: "⏳", hint: "천천히, 안전하게. 코너 깃대에서 공을 지킵니다.", shout: "천천히! 서두르지 마!",
    patch: { mentality: 0.3, tempo: 0.05, directness: 0.15, counter: 0.15, pressing: 0.35, engageLine: 0.3, width: 0.6 } },
];

export const lastCallById = (id: string): LastCall | undefined => LAST_CALLS.find((c) => c.id === id);
