/**
 * Per-club stadium looks. Everything here is a palette/spec; render.ts turns it into canvas paint.
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
  S({ club: "서울 FC", shortName: "SEO", name: "한강 아레나", capacity: 58000,
    grass: { a: "#2c7c39", b: "#318841" }, pattern: "lengthwise",
    surround: { color: "#5a1a22", track: false }, accent: "#e63946", atmosphere: 0.95 }),
  S({ club: "부산 유나이티드", shortName: "BUS", name: "해운대 베이 스타디움", capacity: 43000,
    grass: { a: "#2b7f48", b: "#30894f" }, pattern: "crosswise",
    surround: { color: "#1c4e5e", track: false }, accent: "#4cc9f0", atmosphere: 0.75 }),
  S({ club: "인천 블루", shortName: "INC", name: "송도 포트 파크", capacity: 38000,
    grass: { a: "#2e7a3c", b: "#338645" }, pattern: "diagonal",
    surround: { color: "#173a66", track: false }, accent: "#3a86ff", atmosphere: 0.7 }),
  S({ club: "대구 울브스", shortName: "DAE", name: "팔공 그라운드", capacity: 26000,
    grass: { a: "#4f883b", b: "#559041" }, pattern: "lengthwise",
    surround: { color: "#c9ab7c", track: true }, accent: "#8ecae6", atmosphere: 0.45 }),
  S({ club: "광주 레이즈", shortName: "GWA", name: "무등 선샤인 파크", capacity: 22000,
    grass: { a: "#3d8a37", b: "#45953e" }, pattern: "checker",
    surround: { color: "#5e4a12", track: false }, accent: "#ffd166", atmosphere: 0.55 }),
  S({ club: "대전 코메츠", shortName: "DJN", name: "갑천 돔", capacity: 31000,
    grass: { a: "#297a46", b: "#2e854d" }, pattern: "circles",
    surround: { color: "#3b2559", track: false }, accent: "#c77dff", atmosphere: 0.65 }),
  S({ club: "수원 윙스", shortName: "SUW", name: "화성 윙스 파크", capacity: 44000,
    grass: { a: "#2d7834", b: "#33843b" }, pattern: "lengthwise",
    surround: { color: "#0f4a3c", track: false }, accent: "#06d6a0", atmosphere: 0.85 }),
  S({ club: "울산 앵커스", shortName: "ULS", name: "태화강 앵커 스타디움", capacity: 40000,
    grass: { a: "#2f7f42", b: "#348a49" }, pattern: "crosswise",
    surround: { color: "#5c3a1c", track: false }, accent: "#f4a261", atmosphere: 0.8 }),
  S({ club: "전주 그린", shortName: "JEO", name: "완산벌 스타디움", capacity: 36000,
    grass: { a: "#39872f", b: "#3f9236" }, pattern: "lengthwise",
    surround: { color: "#15423d", track: false }, accent: "#2a9d8f", atmosphere: 0.8 }),
  S({ club: "포항 아이언", shortName: "POH", name: "영일만 스틸야드", capacity: 20000,
    grass: { a: "#4b7f3a", b: "#518741" }, pattern: "crosswise",
    surround: { color: "#3a3f45", track: false }, accent: "#adb5bd", atmosphere: 0.6 }),
  S({ club: "제주 아일랜더스", shortName: "JEJ", name: "한라 필드", capacity: 18000,
    grass: { a: "#2e8a4a", b: "#349451" }, pattern: "crosswise",
    surround: { color: "#d2b48c", track: true }, accent: "#ff8fab", atmosphere: 0.4 }),
  S({ club: "창원 세일즈", shortName: "CHW", name: "마산만 마리나 파크", capacity: 24000,
    grass: { a: "#2a7838", b: "#2f823e" }, pattern: "diagonal",
    surround: { color: "#3d5222", track: false }, accent: "#a7c957", atmosphere: 0.5 }),
];

const byClub = new Map(STADIUMS.map((s) => [s.club, s]));

/** Home stadium for a club name; unknown names (e.g. engine test teams) get the default. */
export function stadiumFor(clubName: string): Stadium {
  return byClub.get(clubName) ?? DEFAULT_STADIUM;
}

/** Cache key that changes whenever the static painting would differ. */
export function stadiumKey(s: Stadium, w: number, h: number, dpr: number): string {
  return `${s.name}|${s.club}|${w}|${h}|${dpr}`;
}
