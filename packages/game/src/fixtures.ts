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
  // venue bookkeeping so nobody plays long home or away streaks in the first half
  const homes = new Array<number>(n).fill(0);
  const last = new Array<"H" | "A" | "">(n).fill("");
  const streak = new Array<number>(n).fill(0);
  for (let r = 0; r < n - 1; r++) {
    const pairs: [number, number][] = [];
    const left = [ids[0]!, ...rot.slice(0, n / 2 - 1)];
    const right = rot.slice(n / 2 - 1).reverse();
    for (let i = 0; i < n / 2; i++) {
      const a = left[i]!, b = right[i]!;
      // the side that has just been away (longer away streak, then fewer home games) gets the home game
      const want = (x: number) => (last[x] === "A" ? 2 + streak[x]! : last[x] === "H" ? -streak[x]! : 0) - homes[x]! * 0.5;
      const aHome = want(a) > want(b) || (want(a) === want(b) && (r + i) % 2 === 0);
      const [h, w] = aHome ? [a, b] : [b, a];
      pairs.push([h, w]);
      for (const [x, v] of [[h, "H"], [w, "A"]] as [number, "H" | "A"][]) {
        streak[x] = last[x] === v ? streak[x]! + 1 : 1;
        last[x] = v;
        if (v === "H") homes[x]!++;
      }
    }
    rounds.push(pairs);
    rot.unshift(rot.pop()!);
  }
  const all: Fixture[] = [];
  let id = 0;
  for (const [r, pairs] of rounds.entries()) for (const [h, a] of pairs) all.push({ id: id++, round: r, home: h, away: a, score: null, scorers: [] });
  // the return half mirrors the first with venues swapped
  for (const [r, pairs] of rounds.entries()) for (const [h, a] of pairs) all.push({ id: id++, round: r + n - 1, home: a, away: h, score: null, scorers: [] });
  return all;
}

export const roundsPerSeason = (clubs: number): number => 2 * (clubs - 1);
