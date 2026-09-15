/**
 * Phase B ("eye test") proxies: numbers that correlate with matches *looking* wrong even when
 * the aggregate statistics are fine.
 *   tsx scripts/naturalness.ts [matches=4]
 *
 * - jitter:   sharp direction reversals per player-minute (target < 2)
 * - bunching: share of ticks with 3+ team-mates within 3 m of each other (target < 5%)
 * - idle:     share of outfield player-ticks standing still in open play (target 10-25%)
 * - sprint:   share of outfield player-ticks above 85% top speed (real ~3-6%)
 * - offBall:  average distance of the nearest defender to an attacker in the final third
 */
import { Match, generateTeam, maxSpeed } from "../src/index";

const n = Number(process.argv[2] ?? 4);
let jitter = 0, playerMinutes = 0, bunchTicks = 0, ticks = 0, idle = 0, sprint = 0, outfieldTicks = 0;
let nearestSum = 0, nearestN = 0;

for (let i = 0; i < n; i++) {
  const home = generateTeam({ id: 0, name: "H", shortName: "H", color: "#f00", formation: "4-3-3", quality: 12, seed: 300 + i });
  const away = generateTeam({ id: 1, name: "A", shortName: "A", color: "#00f", formation: "4-4-2", quality: 12, seed: 400 + i });
  const m = new Match(home, away, { seed: 500 + i, aiManaged: [0, 1] });
  const prevAng = new Map<string, number>();
  while (m.state.phase !== "FULL_TIME") {
    m.step();
    if (m.state.phase !== "PLAY") continue;
    ticks++;
    const active = m.activePlayers();
    let bunched = false;
    for (const p of active) {
      const sp = Math.hypot(p.vel.x, p.vel.y);
      if (!m.isKeeper(p.id)) {
        outfieldTicks++;
        if (sp < 0.3) idle++;
        if (sp > 0.85 * maxSpeed(m.def(p.id).attrs, p.fatigue)) sprint++;
      }
      if (sp > 1.5) {
        const ang = Math.atan2(p.vel.y, p.vel.x);
        const prev = prevAng.get(p.id);
        if (prev !== undefined) {
          let d = Math.abs(ang - prev);
          if (d > Math.PI) d = 2 * Math.PI - d;
          if (d > Math.PI / 2) jitter++;
        }
        prevAng.set(p.id, ang);
      } else prevAng.delete(p.id);
      // bunching: 3+ team-mates within 3 m
      let close = 0;
      for (const q of active) if (q !== p && q.team === p.team && Math.hypot(q.pos.x - p.pos.x, q.pos.y - p.pos.y) < 3) close++;
      if (close >= 2) bunched = true;
    }
    if (bunched) bunchTicks++;
    // nearest defender to attackers in the final third
    const owner = m.state.ball.owner;
    if (owner) {
      const team = m.teamOf.get(owner)!;
      for (const p of m.activePlayers(team)) {
        if (p.pos.x * m.dirOf(team) < 17 || m.isKeeper(p.id)) continue;
        nearestSum += m.pressureAt(p.pos, team);
        nearestN++;
      }
    }
  }
  playerMinutes += (ticks / 20 / 60) * 20;
}
console.log(`matches ${n}`);
console.log(`jitter (reversals per player-minute): ${(jitter / Math.max(1, playerMinutes)).toFixed(2)}   target < 2`);
console.log(`bunching (share of ticks with 3+ team-mates within 3 m): ${((100 * bunchTicks) / ticks).toFixed(1)}%   target < 5%`);
console.log(`idle outfield share: ${((100 * idle) / outfieldTicks).toFixed(1)}%   target 10-25%`);
console.log(`sprint outfield share: ${((100 * sprint) / outfieldTicks).toFixed(1)}%   real ~3-6%`);
console.log(`final-third attacker: nearest defender ${(nearestSum / Math.max(1, nearestN)).toFixed(2)} m   real ~3-5 m`);
