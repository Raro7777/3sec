// 런칭 로스터 데이터 검증: node data/validate.mjs
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const players = JSON.parse(readFileSync(join(here, "players.json"), "utf8"));
const teams = JSON.parse(readFileSync(join(here, "teams.json"), "utf8"));

const STATS = ["serve","receive","set","spike","block","dig","speed","power","stamina","mental"];
const PLAYER_KEYS = ["id","name","teamId","position","rarity","jerseyNumber","heightCm","age","stats","potential","skill","appearance","personality","bio"];
const TEAM_KEYS = ["id","name","city","colors","emblemConcept","identity","homeArena"];
const POS = ["S","OH","OP","MB","L"];
const RARITY = ["N","R","SR","SSR"];
const HEIGHT = { S:[172,180], OH:[175,185], OP:[178,188], MB:[182,192], L:[165,172] };
const AVG = { R:[35,55], SR:[45,65], SSR:[55,75] };
const errors = [], warns = [];
const err = (m) => errors.push(m);
const warn = (m) => warns.push(m);
const isInt = (v) => Number.isInteger(v);
const sameKeys = (o, keys) => JSON.stringify(Object.keys(o)) === JSON.stringify(keys);

// ---------- teams ----------
if (teams.length !== 6) err(`teams: expected 6, got ${teams.length}`);
const teamIds = new Set();
teams.forEach((t, i) => {
  if (!sameKeys(t, TEAM_KEYS)) err(`team[${i}] keys mismatch: ${Object.keys(t)}`);
  if (t.id !== `t0${i + 1}`) err(`team[${i}] id expected t0${i + 1}, got ${t.id}`);
  teamIds.add(t.id);
  for (const c of ["primary","secondary"]) if (!/^#[0-9A-F]{6}$/.test(t.colors?.[c] ?? "")) err(`${t.id} colors.${c} invalid`);
  for (const k of ["name","city","emblemConcept","identity","homeArena"]) if (typeof t[k] !== "string" || !t[k]) err(`${t.id} ${k} empty`);
});
const names = teams.map(t => t.name); if (new Set(names).size !== names.length) err("duplicate team names");
const prim = teams.map(t => t.colors.primary); if (new Set(prim).size !== prim.length) err("duplicate primary colors");

// ---------- players ----------
if (players.length !== 42) err(`players: expected 42, got ${players.length}`);
const byTeam = {}, seenIds = new Set(), seenNames = new Set(), hairCombo = new Set();
const rarityCount = {}, posCount = {};
players.forEach((p, i) => {
  const tag = `${p.id ?? "?"}(${p.name ?? "?"})`;
  if (!sameKeys(p, PLAYER_KEYS)) err(`${tag} keys mismatch: ${Object.keys(p)}`);
  const expectId = `p${String(i + 1).padStart(3, "0")}`;
  if (p.id !== expectId) err(`${tag} id expected ${expectId}`);
  if (seenIds.has(p.id)) err(`${tag} duplicate id`); seenIds.add(p.id);
  if (seenNames.has(p.name)) err(`${tag} duplicate name`); seenNames.add(p.name);
  if (!teamIds.has(p.teamId)) err(`${tag} unknown teamId ${p.teamId}`);
  if (!POS.includes(p.position)) err(`${tag} bad position ${p.position}`);
  if (!RARITY.includes(p.rarity)) err(`${tag} bad rarity ${p.rarity}`);
  if (!isInt(p.jerseyNumber) || p.jerseyNumber < 1 || p.jerseyNumber > 99) err(`${tag} bad jerseyNumber`);
  const [hMin, hMax] = HEIGHT[p.position] ?? [0, 0];
  if (!isInt(p.heightCm) || p.heightCm < hMin || p.heightCm > hMax) err(`${tag} heightCm ${p.heightCm} out of ${p.position} range ${hMin}-${hMax}`);
  if (!isInt(p.age) || p.age < 18 || p.age > 24) err(`${tag} age ${p.age} out of 18-24`);
  if (!sameKeys(p.stats, STATS)) err(`${tag} stats keys mismatch`);
  if (!sameKeys(p.potential, STATS)) err(`${tag} potential keys mismatch`);

  // stat ranges
  const [aMin, aMax] = AVG[p.rarity] ?? [0, 100];
  let sum = 0;
  for (const k of STATS) {
    const s = p.stats[k], q = p.potential[k];
    if (!isInt(s) || s < 0 || s > 100) err(`${tag} stats.${k}=${s} not int 0-100`);
    if (!isInt(q) || q < 0 || q > 100) err(`${tag} potential.${k}=${q} not int 0-100`);
    if (q < s) err(`${tag} potential.${k} ${q} < stats ${s}`);
    const d = q - s;
    if (d < 15 && q < 100) err(`${tag} potential.${k} growth ${d} < 15`);
    if (d > 30) err(`${tag} potential.${k} growth ${d} > 30`);
    sum += s;
    const liberoLow = p.position === "L" && (k === "spike" || k === "block");
    if (liberoLow) { if (s > 30) err(`${tag} libero ${k}=${s} > 30`); }
    else if (s < aMin - 10 || s > aMax + 10) err(`${tag} stats.${k}=${s} outside ${p.rarity} band ±10 (${aMin - 10}-${aMax + 10})`);
  }
  const avg = sum / STATS.length;
  if (avg < aMin || avg > aMax) err(`${tag} avg ${avg.toFixed(1)} outside ${p.rarity} band ${aMin}-${aMax}`);

  // position profile sanity
  const s = p.stats;
  const top = STATS.slice().sort((a, b) => s[b] - s[a]);
  if (p.position === "S" && !(s.set === Math.max(...STATS.map(k => s[k])) && s.set > s.spike + 15)) warn(`${tag} S profile: set should be top & >> spike`);
  if (p.position === "OP" && !(s.spike >= s.receive + 20 && s.power >= s.receive + 15)) warn(`${tag} OP profile: spike/power should >> receive`);
  if (p.position === "MB" && !(s.block === Math.max(...STATS.map(k => s[k])) || top.slice(0, 2).includes("block"))) warn(`${tag} MB profile: block should be top-2`);
  if (p.position === "L" && !(top.slice(0, 3).every(k => ["receive","dig","speed"].includes(k)))) warn(`${tag} L profile: top3 should be receive/dig/speed (got ${top.slice(0,3)})`);
  if (p.position === "OH" && Math.abs(s.spike - s.receive) > 25) warn(`${tag} OH profile: spike/receive gap ${Math.abs(s.spike - s.receive)} > 25`);

  // skill
  if (!sameKeys(p.skill, ["name","description"])) err(`${tag} skill keys mismatch`);
  if (p.rarity === "R" && (p.skill.name !== "" || p.skill.description !== "")) err(`${tag} R must have empty skill`);
  if (p.rarity !== "R" && (!p.skill.name || !p.skill.description)) err(`${tag} ${p.rarity} must have skill`);

  // appearance
  if (!sameKeys(p.appearance, ["hairStyle","hairColor","eyeColor","bodyType"])) err(`${tag} appearance keys mismatch`);
  for (const k of ["hairStyle","hairColor","eyeColor","bodyType"]) if (!p.appearance[k]) err(`${tag} appearance.${k} empty`);
  const combo = `${p.appearance.hairStyle}|${p.appearance.hairColor}`;
  if (hairCombo.has(combo)) err(`${tag} duplicate hair combo ${combo}`); hairCombo.add(combo);
  if (!Array.isArray(p.personality) || p.personality.length !== 3 || p.personality.some(x => typeof x !== "string" || !x)) err(`${tag} personality must be 3 non-empty strings`);
  if (typeof p.bio !== "string" || p.bio.length < 10) err(`${tag} bio too short`);

  rarityCount[p.rarity] = (rarityCount[p.rarity] ?? 0) + 1;
  posCount[p.position] = (posCount[p.position] ?? 0) + 1;
  (byTeam[p.teamId] ??= []).push(p);
});

// ---------- per-team distribution ----------
const ssrPerTeam = {};
for (const [tid, list] of Object.entries(byTeam)) {
  if (list.length !== 7) err(`${tid} has ${list.length} players, expected 7`);
  const pc = {}; list.forEach(p => pc[p.position] = (pc[p.position] ?? 0) + 1);
  const expect = { S:1, OH:2, OP:1, MB:2, L:1 };
  for (const [pos, n] of Object.entries(expect)) if ((pc[pos] ?? 0) !== n) err(`${tid} position ${pos}: ${pc[pos] ?? 0}, expected ${n}`);
  const jerseys = list.map(p => p.jerseyNumber);
  if (new Set(jerseys).size !== jerseys.length) err(`${tid} duplicate jerseyNumber: ${jerseys}`);
  const ssr = list.filter(p => p.rarity === "SSR").length; ssrPerTeam[tid] = ssr;
  if (ssr < 1 || ssr > 2) err(`${tid} SSR count ${ssr}, expected 1-2`);
  const colors = list.map(p => p.appearance.hairColor);
  const dupColors = colors.filter((c, i) => colors.indexOf(c) !== i);
  if (dupColors.length) warn(`${tid} duplicate hair colors in team: ${[...new Set(dupColors)]}`);
  const styles = list.map(p => p.appearance.hairStyle);
  const dupStyles = styles.filter((c, i) => styles.indexOf(c) !== i);
  if (dupStyles.length) warn(`${tid} duplicate hair styles in team: ${[...new Set(dupStyles)]}`);
}
if ((rarityCount.SSR ?? 0) !== 10 || (rarityCount.SR ?? 0) !== 14 || (rarityCount.R ?? 0) !== 18) err(`rarity distribution ${JSON.stringify(rarityCount)}, expected SSR10/SR14/R18`);
const hairStyles = new Set(players.map(p => p.appearance.hairStyle));
const hairColors = new Set(players.map(p => p.appearance.hairColor));
if (hairStyles.size < 8) err(`hair styles ${hairStyles.size} < 8`);

// ---------- report ----------
console.log("players:", players.length, "teams:", teams.length);
console.log("rarity:", rarityCount, "position:", posCount);
console.log("SSR per team:", ssrPerTeam);
console.log("distinct hair styles:", hairStyles.size, "| distinct hair colors:", hairColors.size, "| distinct style+color combos:", hairCombo.size);
for (const [tid, list] of Object.entries(byTeam)) {
  const r = {}; list.forEach(p => r[p.rarity] = (r[p.rarity] ?? 0) + 1);
  const avg = (list.reduce((a, p) => a + STATS.reduce((x, k) => x + p.stats[k], 0) / STATS.length, 0) / list.length).toFixed(1);
  console.log(`  ${tid}: ${JSON.stringify(r)} team avg stat ${avg}`);
}
if (warns.length) { console.log(`\nWARNINGS (${warns.length}):`); warns.forEach(w => console.log("  -", w)); }
if (errors.length) { console.log(`\nERRORS (${errors.length}):`); errors.forEach(e => console.log("  -", e)); process.exit(1); }
console.log("\nOK: all checks passed");
