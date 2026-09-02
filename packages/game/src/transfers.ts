import type { Club, GameState, SquadPlayer } from "./types";
import { overall } from "./rating";
import { autoSelect, repairSelection } from "./selection";
import { clubOf, playerOf, seasonOver } from "./season";

/** Currency unit: 억원 (100 million KRW). */
export const MIN_SQUAD = 16;
export const MAX_SQUAD = 25;

/** Market value from role rating and age: 10 → 5억, 12 → 12억, 14 → 29억, 16 → 70억. */
export function playerValue(p: SquadPlayer): number {
  const ovr = overall(p.attrs, p.role);
  const ageFactor = p.age <= 23 ? 1.25 : p.age <= 28 ? 1 : p.age <= 31 ? 0.7 : 0.4;
  return Math.max(1, Math.round(5 * Math.pow(1.55, ovr - 10) * ageFactor));
}

/** Starting budget by reputation; refilled each season with prize money. */
export function seasonBudget(reputation: number, position: number | null): number {
  const base = Math.round(20 + (reputation - 10) * 12);
  const prize = position === null ? 0 : Math.max(0, 60 - (position - 1) * 5);
  return base + prize;
}

/** Pre-season, the winter window (before rounds 11-12) and the off-season are open. */
export function windowOpen(s: GameState): boolean {
  return s.round === 0 || s.round === 10 || s.round === 11 || seasonOver(s);
}

/** What a club wants for one of its players, or null if it will not sell. */
export function askingPrice(club: Club, p: SquadPlayer): number | null {
  if (club.squad.length <= MIN_SQUAD) return null;
  const ranked = [...club.squad].sort((a, b) => overall(b.attrs, b.role) - overall(a.attrs, a.role));
  const rank = ranked.indexOf(p);
  const premium = rank < 3 ? 1.5 : rank < 8 ? 1.25 : 1.1;
  return Math.round(playerValue(p) * premium);
}

export interface TransferTarget {
  club: Club;
  player: SquadPlayer;
  price: number | null;
  value: number;
}

export function transferTargets(s: GameState): TransferTarget[] {
  const out: TransferTarget[] = [];
  for (const club of s.clubs) {
    if (club.id === s.userClub) continue;
    for (const player of club.squad) out.push({ club, player, price: askingPrice(club, player), value: playerValue(player) });
  }
  return out.sort((a, b) => overall(b.player.attrs, b.player.role) - overall(a.player.attrs, a.player.role));
}

function moveNumber(to: Club, p: SquadPlayer): void {
  const used = new Set(to.squad.map((q) => q.number));
  if (!used.has(p.number)) return;
  for (let n = 2; n < 100; n++) if (!used.has(n)) { p.number = n; return; }
}

/** The user buys a player from another club. Returns an error string or null. */
export function buyPlayer(s: GameState, fromClubId: number, playerId: string): string | null {
  const me = clubOf(s, s.userClub);
  const from = clubOf(s, fromClubId);
  const p = from.squad.find((q) => q.id === playerId);
  if (!p) return "선수를 찾을 수 없습니다";
  if (!windowOpen(s)) return "이적 시장이 닫혀 있습니다";
  const price = askingPrice(from, p);
  if (price === null) return `${from.name}은(는) 스쿼드가 얇아 팔지 않습니다`;
  if (me.budget < price) return `예산 부족 (필요 ${price}억, 보유 ${me.budget}억)`;
  if (me.squad.length >= MAX_SQUAD) return `스쿼드 상한 ${MAX_SQUAD}명`;
  from.squad = from.squad.filter((q) => q !== p);
  from.budget += price;
  from.selection = autoSelect(from, from.selection.formation);
  moveNumber(me, p);
  p.condition = 1;
  me.squad.push(p);
  me.budget -= price;
  me.selection = repairSelection(me);
  s.news.unshift(`${me.shortName}: ${p.name} 영입 (${from.shortName}, ${price}억).`);
  return null;
}

/** Best bid an AI club would make right now for one of the user's players. */
export function bestOffer(s: GameState, playerId: string): { club: Club; fee: number } | null {
  const me = clubOf(s, s.userClub);
  const p = playerOf(me, playerId);
  const value = playerValue(p);
  let best: { club: Club; fee: number } | null = null;
  for (const club of s.clubs) {
    if (club.id === s.userClub || club.squad.length >= MAX_SQUAD - 1) continue;
    // Better players are wanted by everyone; a club pays more when the player would start for them.
    const theirBest = club.squad.filter((q) => q.role === p.role).map((q) => overall(q.attrs, q.role)).sort((a, b) => b - a)[0] ?? 0;
    const need = overall(p.attrs, p.role) > theirBest ? 1.1 : 0.85;
    const fee = Math.round(value * need);
    if (fee <= club.budget && (!best || fee > best.fee)) best = { club, fee };
  }
  return best;
}

/** The user sells a player to the best bidder. Returns an error string or null. */
export function sellPlayer(s: GameState, playerId: string): string | null {
  const me = clubOf(s, s.userClub);
  const p = me.squad.find((q) => q.id === playerId);
  if (!p) return "선수를 찾을 수 없습니다";
  if (!windowOpen(s)) return "이적 시장이 닫혀 있습니다";
  if (me.squad.length <= MIN_SQUAD) return `스쿼드는 최소 ${MIN_SQUAD}명이어야 합니다`;
  const offer = bestOffer(s, playerId);
  if (!offer) return "지금은 제안하는 구단이 없습니다";
  me.squad = me.squad.filter((q) => q !== p);
  me.budget += offer.fee;
  me.selection = repairSelection(me);
  moveNumber(offer.club, p);
  offer.club.squad.push(p);
  offer.club.budget -= offer.fee;
  offer.club.selection = autoSelect(offer.club, offer.club.selection.formation);
  s.news.unshift(`${me.shortName}: ${p.name} → ${offer.club.shortName} 이적 (${offer.fee}억).`);
  return null;
}

/** AI clubs strengthen their weakest line during a window (one deal per club per window at most). */
export function aiTransfers(s: GameState, rng: { next(): number }): void {
  if (!windowOpen(s)) return;
  for (const club of s.clubs) {
    if (club.id === s.userClub || club.squad.length >= MAX_SQUAD - 1) continue;
    const xi = club.selection.starters.map((id) => playerOf(club, id));
    const weakest = xi.slice(1).sort((a, b) => overall(a.attrs, a.role) - overall(b.attrs, b.role))[0];
    if (!weakest) continue;
    const need = overall(weakest.attrs, weakest.role);
    const candidates = transferTargets(s)
      .filter((t) => t.club.id !== club.id && t.club.id !== s.userClub && t.player.role === weakest.role && t.price !== null && t.price <= club.budget && overall(t.player.attrs, t.player.role) >= need + 1.5)
      .sort((a, b) => overall(b.player.attrs, b.player.role) / b.price! - overall(a.player.attrs, a.player.role) / a.price!);
    const pick = candidates[0];
    if (!pick || rng.next() > 0.6) continue;
    const from = pick.club;
    from.squad = from.squad.filter((q) => q !== pick.player);
    from.budget += pick.price!;
    from.selection = autoSelect(from, from.selection.formation);
    moveNumber(club, pick.player);
    club.squad.push(pick.player);
    club.budget -= pick.price!;
    club.selection = autoSelect(club, club.selection.formation);
    s.news.unshift(`${club.shortName}: ${pick.player.name} 영입 (${from.shortName}, ${pick.price}억).`);
  }
}
