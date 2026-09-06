/**
 * Difficulty: chosen once at onboarding, kept on the save, never changed mid-career.
 *
 * It only ever touches the human's club. The AI clubs, the balance gate and the division model are the
 * same on every setting, so a hard career is the same world with a shorter rope: less money to start,
 * a board that expects a place or two more, more injuries, dearer and more reluctant transfers.
 */
import type { GameState } from "./types";

export type Difficulty = "easy" | "normal" | "hard";

export interface DifficultyProfile {
  id: Difficulty;
  label: string;
  blurb: string;
  /** multiplier on the starting budget */
  startBudget: number;
  /** places added to the board's expected finish (positive = more lenient) */
  expectationSlack: number;
  /** starting board confidence */
  startConfidence: number;
  /** multiplier on injury frequency */
  injury: number;
  /** multiplier on the fee a selling club accepts from the user */
  askMarkup: number;
  /** multiplier on a player's chance of refusing to join the user */
  refusal: number;
}

export const DIFFICULTIES: Record<Difficulty, DifficultyProfile> = {
  easy: { id: "easy", label: "쉬움", blurb: "예산 넉넉, 이사회 관대, 부상 적음. 게임을 익히기에 좋습니다.", startBudget: 1.4, expectationSlack: 2, startConfidence: 65, injury: 0.7, askMarkup: 0.92, refusal: 0.6 },
  normal: { id: "normal", label: "보통", blurb: "설계된 그대로. 평판만큼 기대받고 평판만큼 씁니다.", startBudget: 1, expectationSlack: 0, startConfidence: 60, injury: 1, askMarkup: 1, refusal: 1 },
  hard: { id: "hard", label: "어려움", blurb: "예산 빠듯, 이사회 조급, 부상 잦음, 선수들이 잘 안 옵니다.", startBudget: 0.7, expectationSlack: -1, startConfidence: 55, injury: 1.3, askMarkup: 1.15, refusal: 1.3 },
};

export const DIFFICULTY_ORDER: Difficulty[] = ["easy", "normal", "hard"];

export const isDifficulty = (x: unknown): x is Difficulty => x === "easy" || x === "normal" || x === "hard";

/** The save's profile; saves from before the setting play on normal. */
export const difficultyOf = (s: GameState): DifficultyProfile => DIFFICULTIES[isDifficulty(s.difficulty) ? s.difficulty : "normal"];

/** Is this the human's club? Difficulty multipliers apply to it alone. */
export const isUserClub = (s: GameState, clubId: number): boolean => clubId === s.userClub;
