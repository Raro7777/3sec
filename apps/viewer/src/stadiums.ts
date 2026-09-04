/**
 * Per-club stadium looks. Everything here is a palette/spec; render.ts turns it into canvas paint.
 * `capacity` mirrors CLUBS[].capacity in packages/game/src/world.ts (the fan system's attendance cap) — keep them in step.
 * Grass greens stay in the mid range on purpose: player discs (incl. mint/teal/lime kits) must
 * stay legible on every pitch, so nothing here is very dark or very pale.
 */

export type MowPattern = "lengthwise" | "crosswise" | "diagonal" | "checker" | "circles";

export interface Stadium {
  /** club name as it appears in match.teams[i].name */
  club: string;
  /** club abbreviation printed on the ad boards */
  shortName: string;
  /** fictional Korean stadium name */
  name: string;
  capacity: number;
  grass: { a: string; b: string; line: string };
  pattern: MowPattern;
  /** area between the grass apron and the canvas edge: stands (club tone) or an athletics track */
  surround: { color: string; track: boolean };
  /** ad-board band colour at the touchlines (club primary) */
  accent: string;
  /** 0..1 crowd intensity: drives the edge vignette */
  atmosphere: number;
  /** seats now over the seats the ground was drawn for (>1 after an expansion: deeper stands) */
  grown?: number;
}

export const DEFAULT_STADIUM: Stadium = {
  club: "",
  shortName: "HOME",
  name: "홈 구장",
  capacity: 30000,
  grass: { a: "#2f7d3a", b: "#33873f", line: "rgba(255,255,255,0.9)" },
  pattern: "lengthwise",
  surround: { color: "#1f2a33", track: false },
  accent: "#3a4a58",
  atmosphere: 0.5,
};

const S = (s: Omit<Stadium, "grass"> & { grass: { a: string; b: string; line?: string } }): Stadium => ({
  ...s,
  grass: { line: "rgba(255,255,255,0.9)", ...s.grass },
});

export const STADIUMS: Stadium[] = [
  S({ club: "서울 FC", shortName: "서울", name: "한강 아레나", capacity: 58000,
    grass: { a: "#2c7c39", b: "#318841" }, pattern: "lengthwise",
    surround: { color: "#5a1a22", track: false }, accent: "#e63946", atmosphere: 0.95 }),
  S({ club: "부산 유나이티드", shortName: "부산", name: "해운대 베이 스타디움", capacity: 43000,
    grass: { a: "#2b7f48", b: "#30894f" }, pattern: "crosswise",
    surround: { color: "#1c4e5e", track: false }, accent: "#4cc9f0", atmosphere: 0.75 }),
  S({ club: "인천 블루", shortName: "인천", name: "송도 포트 파크", capacity: 38000,
    grass: { a: "#2e7a3c", b: "#338645" }, pattern: "diagonal",
    surround: { color: "#173a66", track: false }, accent: "#3a86ff", atmosphere: 0.7 }),
  S({ club: "대구 울브스", shortName: "대구", name: "팔공 그라운드", capacity: 26000,
    grass: { a: "#4f883b", b: "#559041" }, pattern: "lengthwise",
    surround: { color: "#c9ab7c", track: true }, accent: "#8ecae6", atmosphere: 0.45 }),
  S({ club: "광주 레이즈", shortName: "광주", name: "무등 선샤인 파크", capacity: 22000,
    grass: { a: "#3d8a37", b: "#45953e" }, pattern: "checker",
    surround: { color: "#5e4a12", track: false }, accent: "#ffd166", atmosphere: 0.55 }),
  S({ club: "대전 코메츠", shortName: "대전", name: "갑천 돔", capacity: 31000,
    grass: { a: "#297a46", b: "#2e854d" }, pattern: "circles",
    surround: { color: "#3b2559", track: false }, accent: "#c77dff", atmosphere: 0.65 }),
  S({ club: "수원 윙스", shortName: "수원", name: "화성 윙스 파크", capacity: 44000,
    grass: { a: "#2d7834", b: "#33843b" }, pattern: "lengthwise",
    surround: { color: "#0f4a3c", track: false }, accent: "#06d6a0", atmosphere: 0.85 }),
  S({ club: "울산 앵커스", shortName: "울산", name: "태화강 앵커 스타디움", capacity: 40000,
    grass: { a: "#2f7f42", b: "#348a49" }, pattern: "crosswise",
    surround: { color: "#5c3a1c", track: false }, accent: "#f4a261", atmosphere: 0.8 }),
  S({ club: "전주 그린", shortName: "전주", name: "완산벌 스타디움", capacity: 36000,
    grass: { a: "#39872f", b: "#3f9236" }, pattern: "lengthwise",
    surround: { color: "#15423d", track: false }, accent: "#2a9d8f", atmosphere: 0.8 }),
  S({ club: "포항 아이언", shortName: "포항", name: "영일만 스틸야드", capacity: 20000,
    grass: { a: "#4b7f3a", b: "#518741" }, pattern: "crosswise",
    surround: { color: "#3a3f45", track: false }, accent: "#adb5bd", atmosphere: 0.6 }),
  S({ club: "제주 아일랜더스", shortName: "제주", name: "한라 필드", capacity: 18000,
    grass: { a: "#2e8a4a", b: "#349451" }, pattern: "crosswise",
    surround: { color: "#d2b48c", track: true }, accent: "#ff8fab", atmosphere: 0.4 }),
  S({ club: "창원 세일즈", shortName: "CHW", name: "마산만 마리나 파크", capacity: 24000,
    grass: { a: "#2a7838", b: "#2f823e" }, pattern: "diagonal",
    surround: { color: "#3d5222", track: false }, accent: "#a7c957", atmosphere: 0.5 }),

  // Second division (world.ts CLUBS_D2). Smaller grounds: more running tracks, thinner crowds, and
  // atmosphere well below the top flight — a relegated side should feel the drop from the touchline.
  S({ club: "청주 스톤즈", shortName: "청주", name: "상당 스톤 파크", capacity: 15000,
    grass: { a: "#3a7f3f", b: "#3f8a45" }, pattern: "lengthwise",
    surround: { color: "#3d444b", track: false }, accent: "#8d99ae", atmosphere: 0.5 }),
  S({ club: "안양 퍼플", shortName: "안양", name: "평촌 퍼플 돔", capacity: 17000,
    grass: { a: "#2f7d3d", b: "#348843" }, pattern: "crosswise",
    surround: { color: "#3a1d5c", track: false }, accent: "#7b2cbf", atmosphere: 0.55 }),
  S({ club: "김포 타이드", shortName: "김포", name: "한강 하구 스타디움", capacity: 12000,
    grass: { a: "#307e42", b: "#358a49" }, pattern: "diagonal",
    surround: { color: "#0f4c60", track: true }, accent: "#118ab2", atmosphere: 0.4 }),
  S({ club: "천안 브릭스", shortName: "천안", name: "직산 브릭 필드", capacity: 14000,
    grass: { a: "#4a8540", b: "#4f8f46" }, pattern: "lengthwise",
    surround: { color: "#6b4423", track: true }, accent: "#bc6c25", atmosphere: 0.42 }),
  S({ club: "여수 게일즈", shortName: "여수", name: "돌산 윈드 파크", capacity: 11000,
    grass: { a: "#2c7f47", b: "#31894e" }, pattern: "crosswise",
    surround: { color: "#12556b", track: false }, accent: "#00b4d8", atmosphere: 0.48 }),
  S({ club: "원주 하이랜더스", shortName: "원주", name: "치악 하이랜드", capacity: 13000,
    grass: { a: "#52863c", b: "#578f43" }, pattern: "checker",
    surround: { color: "#3b4527", track: true }, accent: "#606c38", atmosphere: 0.38 }),
  S({ club: "군산 하버", shortName: "군산", name: "새만금 하버 파크", capacity: 10000,
    grass: { a: "#2e7a40", b: "#338546" }, pattern: "lengthwise",
    surround: { color: "#1a3038", track: true }, accent: "#264653", atmosphere: 0.35 }),
  S({ club: "충주 밀즈", shortName: "충주", name: "탄금 밀 그라운드", capacity: 9000,
    grass: { a: "#478440", b: "#4c8e47" }, pattern: "diagonal",
    surround: { color: "#7a4230", track: true }, accent: "#e07a5f", atmosphere: 0.34 }),
  S({ club: "속초 웨일스", shortName: "속초", name: "설악 웨일 파크", capacity: 8000,
    grass: { a: "#2f7c44", b: "#34874b" }, pattern: "crosswise",
    surround: { color: "#22455e", track: false }, accent: "#457b9d", atmosphere: 0.46 }),
  S({ club: "구미 서킷", shortName: "구미", name: "금오 서킷 필드", capacity: 12000,
    grass: { a: "#4b8a3e", b: "#509445" }, pattern: "checker",
    surround: { color: "#7a5c14", track: true }, accent: "#ffb703", atmosphere: 0.4 }),
  S({ club: "목포 앵커스", shortName: "목포", name: "유달 앵커 그라운드", capacity: 9000,
    grass: { a: "#2d7b3f", b: "#328645" }, pattern: "lengthwise",
    surround: { color: "#3b0d2c", track: true }, accent: "#5f0f40", atmosphere: 0.36 }),
  S({ club: "정선 마운티스", shortName: "정선", name: "가리왕 마운틴 파크", capacity: 7000,
    grass: { a: "#55873d", b: "#5a9144" }, pattern: "circles",
    surround: { color: "#27384f", track: true }, accent: "#3d5a80", atmosphere: 0.3 }),
];

const byClub = new Map(STADIUMS.map((s) => [s.club, s]));

/** Home stadium for a club name; unknown names (e.g. engine test teams) get the default. */
export function stadiumFor(clubName: string): Stadium {
  return byClub.get(clubName) ?? DEFAULT_STADIUM;
}

/** Regional rivalries: a meeting of two clubs from one group is a derby day (louder crowd, ribbon). */
const DERBY_GROUPS: string[][] = [
  ["서울 FC", "인천 블루", "수원 윙스"],
  ["부산 유나이티드", "울산 앵커스", "창원 세일즈"],
  ["대구 울브스", "포항 아이언"],
  ["광주 레이즈", "전주 그린"],
  ["대전 코메츠", "제주 아일랜더스"],
];

export function isDerby(homeClub: string, awayClub: string): boolean {
  return homeClub !== awayClub && DERBY_GROUPS.some((g) => g.includes(homeClub) && g.includes(awayClub));
}

/** Cache key that changes whenever the static painting would differ. */
export function stadiumKey(s: Stadium, w: number, h: number, dpr: number): string {
  return `${s.name}|${s.club}|${s.shortName}|${s.capacity}|${s.grown ?? 1}|${w}|${h}|${dpr}`;
}
