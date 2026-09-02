/**
 * 구단 꾸미기: the user renames the club and its ground and designs the kit. The original name survives in
 * `baseName` because the viewer keys stadium art, default kits and rivalries by it; the kit's primary colour is
 * the club colour used everywhere (table dots, cards), so the two are kept equal.
 */
import type { ClubKit, GameState, KitPatternName, KitSpec } from "./types";
import { clubOf } from "./season";

export const CLUB_NAME_MAX = 12;
export const SHORT_NAME_MIN = 2;
export const SHORT_NAME_MAX = 3;
export const STADIUM_NAME_MAX = 14;
export const KIT_PATTERNS: readonly KitPatternName[] = ["solid", "stripes", "hoops", "sash", "halves"];
export const KIT_PATTERN_LABEL: Record<KitPatternName, string> = { solid: "단색", stripes: "세로 줄무늬", hoops: "가로 줄무늬", sash: "사선 띠", halves: "반반" };

const HEX = /^#[0-9a-f]{6}$/i;

/** Rename the user's club; returns the problem or null. The first rename records the original name. */
export function renameClub(s: GameState, name: string, shortName: string): string | null {
  const c = clubOf(s, s.userClub);
  const n = name.trim(), sn = shortName.trim();
  if (!n) return "구단명을 입력하세요.";
  if ([...n].length > CLUB_NAME_MAX) return `구단명은 ${CLUB_NAME_MAX}자 이내여야 합니다.`;
  if ([...sn].length < SHORT_NAME_MIN || [...sn].length > SHORT_NAME_MAX) return `약칭은 ${SHORT_NAME_MIN}~${SHORT_NAME_MAX}자여야 합니다.`;
  if (s.clubs.some((o) => o.id !== c.id && (o.name === n || o.shortName === sn))) return "다른 구단이 이미 쓰는 이름입니다.";
  if (n === c.name && sn === c.shortName) return null;
  if (c.baseName === undefined) c.baseName = c.name;
  c.name = n;
  c.shortName = sn;
  return null;
}

/** Rename the user's ground (empty = back to the default name). */
export function renameStadium(s: GameState, name: string): string | null {
  const c = clubOf(s, s.userClub);
  const n = name.trim();
  if ([...n].length > STADIUM_NAME_MAX) return `구장 이름은 ${STADIUM_NAME_MAX}자 이내여야 합니다.`;
  c.stadiumName = n || undefined;
  return null;
}

function kitProblem(k: KitSpec): string | null {
  if (!HEX.test(k.primary) || !HEX.test(k.secondary)) return "색상 값이 올바르지 않습니다.";
  if (!KIT_PATTERNS.includes(k.pattern)) return "알 수 없는 패턴입니다.";
  return null;
}

/** Set the user's kit; the primary colour becomes the club colour. */
export function setClubKit(s: GameState, kit: ClubKit): string | null {
  const c = clubOf(s, s.userClub);
  const err = kitProblem(kit) ?? (kit.away && typeof kit.away === "object" ? kitProblem(kit.away) : null);
  if (err) return err;
  const clean: ClubKit = { primary: kit.primary.toLowerCase(), secondary: kit.secondary.toLowerCase(), pattern: kit.pattern };
  if (kit.away) clean.away = typeof kit.away === "string" ? kit.away : { primary: kit.away.primary.toLowerCase(), secondary: kit.away.secondary.toLowerCase(), pattern: kit.away.pattern };
  c.kit = clean;
  c.color = clean.primary;
  return null;
}

/** Drop the custom kit; `color` goes back to the world definition's colour when known. */
export function resetClubKit(s: GameState, defaultColor?: string): void {
  const c = clubOf(s, s.userClub);
  c.kit = undefined;
  if (defaultColor) c.color = defaultColor;
}
