#!/usr/bin/env node
/**
 * Build a 3sec roster pack from API-Football (api-sports.io) for your own use.
 *
 *   API_FOOTBALL_KEY=xxxx node tools/roster/from-api-football.mjs --season 2026 --out my-roster.json
 *
 * Fetches the two leagues' standings (2 requests) and every club's squad (24 requests): 26 requests in
 * all, well inside the free plan's 100 per day. Slots 0-11 are the first division in table order,
 * 12-23 the second. Ratings are not in the squads endpoint, so players are left unrated and the game
 * places them around the club's level; edit `rating` (1-20) by hand for the players you know.
 *
 * The file this writes is yours: keep it on your device and load it in the game's settings. Do not
 * redistribute it — real names, emblems and likenesses are the clubs', the league's and the players'.
 */
import fs from "node:fs";

const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => (a.startsWith("--") ? [a.slice(2), arr[i + 1] ?? "true"] : [])).filter((x) => x.length));
const KEY = process.env.API_FOOTBALL_KEY;
if (!KEY) { console.error("API_FOOTBALL_KEY 환경 변수에 api-sports.io 키를 넣어 주세요."); process.exit(1); }
const season = Number(args.season ?? new Date().getFullYear());
const out = args.out ?? `roster-${season}.json`;
// API-Football league ids: K League 1 = 292, K League 2 = 293 (override with --league1 / --league2)
const leagues = [Number(args.league1 ?? 292), Number(args.league2 ?? 293)];
const host = "https://v3.football.api-sports.io";

async function get(path) {
  const res = await fetch(host + path, { headers: { "x-apisports-key": KEY } });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  const j = await res.json();
  if (j.errors && Object.keys(j.errors).length) throw new Error(`${path}: ${JSON.stringify(j.errors)}`);
  return j.response;
}

/** API position → one of the game's roles, spread across the line so a squad is not all CB/CM/ST. */
const ROLE_CYCLE = { Goalkeeper: ["GK"], Defender: ["CB", "CB", "LB", "RB", "CB"], Midfielder: ["CM", "DM", "AM", "CM", "LM", "RM"], Attacker: ["ST", "LW", "RW", "ST"] };
const age = (birth) => { if (!birth) return 25; const d = new Date(birth); const now = new Date(); let a = now.getFullYear() - d.getFullYear(); if (now < new Date(now.getFullYear(), d.getMonth(), d.getDate())) a--; return Math.max(15, Math.min(45, a)); };

const clubs = [];
for (const [li, league] of leagues.entries()) {
  const standings = await get(`/standings?league=${league}&season=${season}`);
  const rows = standings?.[0]?.league?.standings?.[0] ?? [];
  if (!rows.length) { console.error(`리그 ${league} 시즌 ${season} 순위표가 비어 있습니다. --season을 확인하세요.`); process.exit(1); }
  const n = rows.length;
  for (const [i, row] of rows.slice(0, 12).entries()) {
    const slot = li * 12 + i;
    const team = row.team;
    const squad = (await get(`/players/squads?team=${team.id}`))?.[0]?.players ?? [];
    const counters = {};
    const players = squad.slice(0, 25).map((p) => {
      const cyc = ROLE_CYCLE[p.position] ?? ["CM"];
      const k = counters[p.position] = (counters[p.position] ?? 0) + 1;
      return { name: String(p.name).slice(0, 12), age: age(p.birth?.date ?? null) || Number(p.age) || 25, role: cyc[(k - 1) % cyc.length], number: p.number ?? undefined };
    });
    // club level from last table position: top of the first division ≈ 14, bottom of the second ≈ 9
    const reputation = Math.round((li === 0 ? 14 - (i / Math.max(1, n - 1)) * 3.5 : 11.6 - (i / Math.max(1, n - 1)) * 2.8) * 10) / 10;
    clubs.push({ slot, name: String(team.name).slice(0, 14), shortName: String(team.name).replace(/\s.*$/, "").slice(0, 4), reputation, players });
    console.error(`slot ${slot}: ${team.name} — ${players.length}명`);
  }
}
const pack = { format: "3sec-roster/1", name: `${season} 로스터`, clubs };
fs.writeFileSync(out, JSON.stringify(pack, null, 1));
console.error(`저장: ${out} (${clubs.length}개 구단). 게임 설정 → 로스터 팩 → 로스터 파일 불러오기.`);
