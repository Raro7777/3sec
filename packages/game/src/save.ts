import type { GameState } from "./types";

export const SAVE_KEY = "3sec.save.v1";

export function serialize(s: GameState): string {
  return JSON.stringify(s);
}

export function deserialize(json: string | null | undefined): GameState | null {
  if (!json) return null;
  try {
    const s = JSON.parse(json) as GameState;
    if (s.version !== 1 || !Array.isArray(s.clubs) || !Array.isArray(s.fixtures)) return null;
    return s;
  } catch {
    return null;
  }
}
