import type { Fixture } from "./types";

/**
 * Double round-robin by the circle method: n teams (even) → (n-1) rounds of n/2 pairs, then the
 * same rounds with home and away swapped. Home/away alternates for the pivot team so nobody plays
 * long home or away streaks.
 */
export function buildFixtures(n: number): Fixture[] {
  if (n % 2 !== 0) throw new Error("even number of clubs required");
  const ids = Array.from({ length: n }, (_, i) => i);
  const rounds: [number, number][][] = [];
  const rot = ids.slice(1);
  for (let r = 0; r < n - 1; r++) {
    const pairs: [number, number][] = [];
    const left = [ids[0]!, ...rot.slice(0, n / 2 - 1)];
    const right = rot.slice(n / 2 - 1).reverse();
    for (let i = 0; i < n / 2; i++) {
      const a = left[i]!, b = right[i]!;
      // alternate who is at home from round to round so the pivot is not always home
      pairs.push((r + i) % 2 === 0 ? [a, b] : [b, a]);
    }
    rounds.push(pairs);
    rot.unshift(rot.pop()!);
  }
  const all: Fixture[] = [];
  let id = 0;
  for (const [r, pairs] of rounds.entries()) for (const [h, a] of pairs) all.push({ id: id++, round: r, home: h, away: a, score: null, scorers: [] });
  for (const [r, pairs] of rounds.entries()) for (const [h, a] of pairs) all.push({ id: id++, round: r + n - 1, home: a, away: h, score: null, scorers: [] });
  return all;
}

export const roundsPerSeason = (clubs: number): number => 2 * (clubs - 1);
