import { FORMATIONS, type FormationName, type Role } from "@3sec/engine";
import type { Club, Selection, SquadPlayer } from "./types";
import { overall, slotFit } from "./rating";

export const BENCH_SIZE = 7;

export const isAvailable = (p: SquadPlayer): boolean => p.injuryDays <= 0 && p.ban <= 0;

/** Best available XI for the formation (greedy by slot fit × freshness) plus a role-balanced bench. */
export function autoSelect(club: Club, formation: FormationName = club.selection.formation): Selection {
  const slots = FORMATIONS[formation];
  const pool = club.squad.filter(isAvailable);
  const taken = new Set<string>();
  const starters: string[] = [];
  // Fill the scarcest slots first: GK, then by slot order.
  for (const slot of slots) {
    let best: SquadPlayer | null = null;
    let bestScore = -Infinity;
    for (const p of pool) {
      if (taken.has(p.id)) continue;
      const score = slotFit(p.attrs, p.role, slot.role) * (0.7 + 0.3 * p.condition);
      if (score > bestScore) {
        bestScore = score;
        best = p;
      }
    }
    if (!best) break;
    taken.add(best.id);
    starters.push(best.id);
  }
  const rest = pool.filter((p) => !taken.has(p.id)).sort((a, b) => overall(b.attrs, b.role) * (0.7 + 0.3 * b.condition) - overall(a.attrs, a.role) * (0.7 + 0.3 * a.condition));
  const bench: string[] = [];
  const gk = rest.find((p) => p.role === "GK");
  if (gk) bench.push(gk.id);
  const group = (r: Role): number => (r === "GK" ? 0 : r === "CB" || r === "LB" || r === "RB" ? 1 : r === "ST" || r === "LW" || r === "RW" ? 3 : 2);
  // one of each outfield line first, then the best of the rest
  for (const g of [1, 2, 3]) {
    const p = rest.find((q) => !bench.includes(q.id) && group(q.role) === g);
    if (p && bench.length < BENCH_SIZE) bench.push(p.id);
  }
  for (const p of rest) {
    if (bench.length >= BENCH_SIZE) break;
    if (!bench.includes(p.id) && p.role !== "GK") bench.push(p.id);
  }
  return { formation, starters, bench };
}

/** Is the selection playable as it stands? Returns the first problem, or null. */
export function selectionProblem(club: Club): string | null {
  const sel = club.selection;
  const slots = FORMATIONS[sel.formation];
  if (sel.starters.length !== slots.length) return "선발 11명이 필요합니다";
  const ids = new Set<string>();
  for (const [i, id] of sel.starters.entries()) {
    const p = club.squad.find((q) => q.id === id);
    if (!p) return `알 수 없는 선수 ${id}`;
    if (ids.has(id)) return `${p.name}이(가) 중복 등록되었습니다`;
    ids.add(id);
    if (!isAvailable(p)) return `${p.name}은(는) ${p.injuryDays > 0 ? "부상" : "출장 정지"} 중입니다`;
    if (i === 0 && p.role !== "GK") return "1번 자리는 골키퍼여야 합니다";
  }
  if (sel.bench.length > BENCH_SIZE) return `교체 명단은 최대 ${BENCH_SIZE}명입니다`;
  for (const id of sel.bench) {
    const p = club.squad.find((q) => q.id === id);
    if (!p) return `알 수 없는 선수 ${id}`;
    if (ids.has(id)) return `${p.name}이(가) 중복 등록되었습니다`;
    ids.add(id);
    if (!isAvailable(p)) return `${p.name}은(는) ${p.injuryDays > 0 ? "부상" : "출장 정지"} 중입니다`;
  }
  return null;
}

/** Keep the manager's choices where legal; only the unavailable/missing spots are refilled. */
export function repairSelection(club: Club): Selection {
  const sel = club.selection;
  if (!selectionProblem(club)) return sel;
  const auto = autoSelect(club, sel.formation);
  const used = new Set<string>();
  const ok = (id: string): boolean => {
    const p = club.squad.find((q) => q.id === id);
    return !!p && isAvailable(p) && !used.has(id);
  };
  const starters = FORMATIONS[sel.formation].map((slot, i) => {
    const keep = sel.starters[i];
    if (keep && ok(keep) && (i > 0 || club.squad.find((q) => q.id === keep)!.role === "GK")) {
      used.add(keep);
      return keep;
    }
    const fill = auto.starters.find((id) => ok(id) && (i > 0 || club.squad.find((q) => q.id === id)!.role === "GK")) ?? club.squad.find((q) => isAvailable(q) && !used.has(q.id) && (i > 0 || q.role === "GK"))?.id;
    if (!fill) throw new Error(`${slot.role} 자리에 출전 가능한 선수가 없습니다`);
    used.add(fill);
    return fill;
  });
  const bench: string[] = [];
  for (const id of [...sel.bench, ...auto.bench]) if (bench.length < BENCH_SIZE && ok(id)) { used.add(id); bench.push(id); }
  return { formation: sel.formation, starters, bench };
}

/** Swap two squad members between starters / bench / reserves (either may be in any group). */
export function swap(club: Club, a: string, b: string): Selection {
  const sel = { ...club.selection, starters: [...club.selection.starters], bench: [...club.selection.bench] };
  const where = (id: string): ["starters" | "bench" | "none", number] => {
    const si = sel.starters.indexOf(id);
    if (si >= 0) return ["starters", si];
    const bi = sel.bench.indexOf(id);
    if (bi >= 0) return ["bench", bi];
    return ["none", -1];
  };
  const [ga, ia] = where(a);
  const [gb, ib] = where(b);
  if (ga !== "none") sel[ga][ia] = b;
  if (gb !== "none") sel[gb][ib] = a;
  if (ga === "none" && gb !== "none") sel[gb][ib] = a;
  if (gb === "none" && ga !== "none") sel[ga][ia] = b;
  return sel;
}
