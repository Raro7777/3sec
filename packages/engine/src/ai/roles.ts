import type { Attributes, FormationName, InstructionId, PlayerRoleId, Role, Tactics } from "../types";
import { FORMATIONS } from "../formation";

/**
 * Player roles: what a player in a formation slot is asked to do. Each role shifts the shape a
 * little and biases the on-ball decision, the run frequency, how far the player pushes up in
 * possession ("hold") and how eagerly they engage out of it ("press").
 */
export interface RoleDef {
  id: PlayerRoleId;
  name: string;
  /** slot roles this role can be assigned to */
  slots: Role[];
  /** normalized forward shift of the home spot (×52.5 m) */
  dx: number;
  /** lateral scale of the home spot: −0.35 = tucks well inside, +0.1 = hugs the line */
  dy: number;
  shoot: number;
  pass: number;
  cross: number;
  dribble: number;
  /** willingness to attempt tight passes (adds to lane risk appetite) */
  risk: number;
  /** run-in-behind frequency multiplier */
  runs: number;
  /** 0 = bombs forward in possession, 0.5 = normal, 1 = stays back */
  hold: number;
  /** engage/press eagerness multiplier out of possession */
  press: number;
  /** full-backs only: joins overlaps */
  overlap: boolean;
  /** keeper only: sweeps far off the line */
  sweeper: boolean;
  /** target man: aerial weight bonus */
  aerial: number;
}

const R = (d: Partial<RoleDef> & { id: PlayerRoleId; name: string; slots: Role[] }): RoleDef => ({
  dx: 0, dy: 0, shoot: 0, pass: 0, cross: 0, dribble: 0, risk: 0, runs: 1, hold: 0.5, press: 1, overlap: false, sweeper: false, aerial: 0, ...d,
});

const WIDE: Role[] = ["LW", "RW", "LM", "RM"];

export const ROLES: Record<PlayerRoleId, RoleDef> = {
  GK: R({ id: "GK", name: "골키퍼", slots: ["GK"] }),
  SK: R({ id: "SK", name: "스위퍼 키퍼", slots: ["GK"], sweeper: true, pass: 0.1, risk: 0.2 }),
  CB: R({ id: "CB", name: "센터백", slots: ["CB"], hold: 0.9 }),
  BPD: R({ id: "BPD", name: "볼 플레잉 CB", slots: ["CB"], pass: 0.2, risk: 0.25, dribble: 0.15, hold: 0.8 }),
  STP: R({ id: "STP", name: "스토퍼", slots: ["CB"], press: 1.6, hold: 0.9, dx: 0.02 }),
  FB: R({ id: "FB", name: "풀백", slots: ["LB", "RB"], overlap: true, hold: 0.6, runs: 0.6 }),
  WB: R({ id: "WB", name: "윙백", slots: ["LB", "RB"], overlap: true, dx: 0.08, cross: 0.2, runs: 1.3, hold: 0.3, dy: 0.05 }),
  DFB: R({ id: "DFB", name: "수비형 풀백", slots: ["LB", "RB"], dx: -0.04, cross: -0.2, hold: 1, press: 1.1, runs: 0.3 }),
  ANC: R({ id: "ANC", name: "앵커", slots: ["DM"], dx: -0.04, hold: 1, risk: -0.15, press: 0.8, runs: 0.2, shoot: -0.15 }),
  DLP: R({ id: "DLP", name: "딥라잉 플레이메이커", slots: ["DM", "CM"], pass: 0.25, risk: 0.3, hold: 0.85, shoot: -0.1, runs: 0.3 }),
  BWM: R({ id: "BWM", name: "볼 위너", slots: ["DM", "CM"], press: 1.5, pass: -0.1, risk: -0.1, hold: 0.6, runs: 0.5 }),
  BBM: R({ id: "BBM", name: "박스투박스", slots: ["CM"], runs: 1.4, dx: 0.03, shoot: 0.1, hold: 0.35 }),
  PM: R({ id: "PM", name: "플레이메이커", slots: ["CM", "AM"], pass: 0.25, risk: 0.3, hold: 0.6, dribble: 0.05 }),
  AP: R({ id: "AP", name: "공격형 미드필더", slots: ["AM"], pass: 0.15, risk: 0.3, dribble: 0.15, shoot: 0.05, hold: 0.4, dy: -0.2 }),
  SS: R({ id: "SS", name: "섀도 스트라이커", slots: ["AM"], dx: 0.08, runs: 1.6, shoot: 0.25, pass: -0.1, hold: 0.2 }),
  W: R({ id: "W", name: "윙어", slots: WIDE, dy: 0.08, cross: 0.3, dribble: 0.15, runs: 0.8, hold: 0.4 }),
  IF: R({ id: "IF", name: "인사이드 포워드", slots: WIDE, dy: -0.35, shoot: 0.3, dribble: 0.1, cross: -0.25, runs: 1.5, hold: 0.3 }),
  DW: R({ id: "DW", name: "수비형 윙어", slots: WIDE, dx: -0.06, press: 1.4, hold: 0.9, cross: 0.05, runs: 0.5 }),
  AF: R({ id: "AF", name: "어드밴스드 포워드", slots: ["ST"], runs: 1.7, dx: 0.03, shoot: 0.15, hold: 0.2 }),
  TM: R({ id: "TM", name: "타겟맨", slots: ["ST"], runs: 0.5, pass: 0.1, aerial: 0.35, hold: 0.4, dribble: -0.1 }),
  PCH: R({ id: "PCH", name: "포처", slots: ["ST"], dx: 0.05, shoot: 0.35, pass: -0.15, dribble: -0.1, runs: 1.1, hold: 0.1 }),
  F9: R({ id: "F9", name: "폴스 나인", slots: ["ST"], dx: -0.1, pass: 0.2, dribble: 0.15, shoot: -0.1, risk: 0.2, runs: 0.6, hold: 0.5 }),
};

export const ROLE_IDS = Object.keys(ROLES) as PlayerRoleId[];

/** Roles selectable for a slot of the given position. */
export function rolesForSlot(slot: Role): PlayerRoleId[] {
  return ROLE_IDS.filter((id) => ROLES[id].slots.includes(slot));
}

/** The plain default role for a slot. */
export function defaultRole(slot: Role): PlayerRoleId {
  switch (slot) {
    case "GK": return "GK";
    case "CB": return "CB";
    case "LB": case "RB": return "FB";
    case "DM": return "ANC";
    case "CM": return "BBM";
    case "AM": return "AP";
    case "LW": case "RW": case "LM": case "RM": return "W";
    case "ST": return "AF";
  }
}

export function defaultRoles(formation: FormationName): PlayerRoleId[] {
  return FORMATIONS[formation].map((s) => defaultRole(s.role));
}

/** Make a roles array valid for the formation: right length, each role legal for its slot. */
export function normalizeRoles(formation: FormationName, roles?: PlayerRoleId[]): PlayerRoleId[] {
  const slots = FORMATIONS[formation];
  return slots.map((s, i) => {
    const r = roles?.[i];
    return r && ROLES[r] && ROLES[r].slots.includes(s.role) ? r : defaultRole(s.role);
  });
}

/** Pick roles that suit the players' attributes (used by AI clubs and the "자동" button). */
export function autoRoles(formation: FormationName, attrsBySlot: (Attributes | undefined)[]): PlayerRoleId[] {
  const slots = FORMATIONS[formation];
  return slots.map((s, i) => {
    const a = attrsBySlot[i];
    if (!a) return defaultRole(s.role);
    switch (s.role) {
      case "GK": return a.pace + a.gkPositioning >= 26 ? "SK" : "GK";
      case "CB": return a.passing >= 13 && a.vision >= 12 ? "BPD" : a.anticipation >= 14 && a.pace >= 13 ? "STP" : "CB";
      case "LB": case "RB": return a.pace + a.stamina >= 28 && a.technique >= 12 ? "WB" : a.tackling >= 14 && a.pace < 12 ? "DFB" : "FB";
      case "DM": return a.passing >= 14 && a.vision >= 13 ? "DLP" : a.tackling >= 14 ? "BWM" : "ANC";
      case "CM": return a.passing + a.vision >= 28 ? "PM" : a.tackling >= 14 && a.passing < 13 ? "BWM" : "BBM";
      case "AM": return a.finishing >= 14 && a.pace >= 13 ? "SS" : "AP";
      case "LW": case "RW": case "LM": case "RM": return a.finishing >= 13 && a.finishing >= a.technique ? "IF" : a.tackling >= 13 && a.stamina >= 14 ? "DW" : "W";
      case "ST": return a.strength >= 15 && a.finishing < 15 ? "TM" : a.pace + a.acceleration >= 30 ? "AF" : a.finishing >= 15 ? "PCH" : a.vision >= 13 ? "F9" : "AF";
    }
  });
}

export const INSTRUCTION_LABEL: Record<InstructionId, string> = {
  shootMore: "슛 자주", holdPosition: "위치 고수", getForward: "적극 전진", stayWider: "넓게 서기", cutInside: "안으로 파고들기",
  pressMore: "강하게 압박", pressLess: "압박 자제", riskyPasses: "모험적 패스", safePasses: "안전한 패스", dribbleMore: "드리블 자주",
};
export const INSTRUCTION_IDS = Object.keys(INSTRUCTION_LABEL) as InstructionId[];

/** Individual instructions modify the role's effective definition. */
export function applyInstructions(def: RoleDef, instr?: Partial<Record<InstructionId, boolean>>): RoleDef {
  if (!instr) return def;
  const d = { ...def };
  if (instr.shootMore) d.shoot += 0.3;
  if (instr.holdPosition) { d.hold = 1; d.runs = Math.min(d.runs, 0.3); }
  if (instr.getForward) { d.hold = Math.min(d.hold, 0.2); d.runs *= 1.5; }
  if (instr.stayWider) d.dy += 0.12;
  if (instr.cutInside) d.dy -= 0.3;
  if (instr.pressMore) d.press *= 1.4;
  if (instr.pressLess) d.press *= 0.6;
  if (instr.riskyPasses) d.risk += 0.3;
  if (instr.safePasses) d.risk -= 0.3;
  if (instr.dribbleMore) d.dribble += 0.25;
  return d;
}

/** Team-instruction presets (formation and roles untouched). */
export const TACTIC_PRESETS: Record<string, Omit<Partial<Tactics>, "formation" | "roles">> = {
  균형: { mentality: 0.5, defensiveLine: 0.5, pressing: 0.5, directness: 0.5, width: 0.6, tempo: 0.5, counter: 0.5, engageLine: 0.5, offsideTrap: false },
  게겐프레싱: { mentality: 0.65, defensiveLine: 0.8, pressing: 0.95, directness: 0.55, width: 0.5, tempo: 0.8, counter: 0.75, engageLine: 1, offsideTrap: true },
  점유: { mentality: 0.55, defensiveLine: 0.7, pressing: 0.7, directness: 0.2, width: 0.65, tempo: 0.35, counter: 0.3, engageLine: 0.8, offsideTrap: false },
  카테나치오: { mentality: 0.25, defensiveLine: 0.2, pressing: 0.3, directness: 0.6, width: 0.35, tempo: 0.5, counter: 0.9, engageLine: 0.2, offsideTrap: false },
  롱볼: { mentality: 0.5, defensiveLine: 0.4, pressing: 0.5, directness: 0.95, width: 0.7, tempo: 0.7, counter: 0.6, engageLine: 0.4, offsideTrap: false },
};
