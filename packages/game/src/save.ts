import type { GameState } from "./types";
import { CLUBS } from "./world";
import { overall } from "./rating";
import { wageFor } from "./contracts";
import { normalizeTactics } from "@3sec/engine";

/** Romanized names from saves made before the Korean localisation → Hangul. */
const FAMILY: Record<string, string> = { Kim: "김", Lee: "이", Park: "박", Choi: "최", Jung: "정", Kang: "강", Cho: "조", Yoon: "윤", Jang: "장", Lim: "임", Han: "한", Oh: "오", Seo: "서", Shin: "신", Kwon: "권", Hwang: "황", Ahn: "안", Song: "송", Ryu: "류", Hong: "홍", Moon: "문", Yang: "양", Bae: "배", Baek: "백", Nam: "남" };
const GIVEN: Record<string, string> = { Minjun: "민준", Seojun: "서준", Doyun: "도윤", Yejun: "예준", Siwoo: "시우", Hajun: "하준", Jiho: "지호", Juwon: "주원", Jihoon: "지훈", Junseo: "준서", Hyunwoo: "현우", Woojin: "우진", Sunwoo: "선우", Eunwoo: "은우", Jaeyoon: "재윤", Taeyang: "태양", Yujun: "유준", Seungmin: "승민", Dohyun: "도현", Geonwoo: "건우", Minseok: "민석", Jinwoo: "진우", Sangho: "상호", Youngjin: "영진", Kyungmin: "경민" };
export function koreanName(name: string): string {
  const m = /^([A-Za-z]+) ([A-Za-z]+)$/.exec(name);
  if (!m) return name;
  const f = FAMILY[m[1]!], g = GIVEN[m[2]!];
  return f && g ? f + g : name;
}
import { DEFAULT_MANAGER_NAME } from "./season";
import { newCup } from "./cup";

export const SAVE_KEY = "3sec.save.v1";

export function serialize(s: GameState): string {
  return JSON.stringify(s);
}

export function deserialize(json: string | null | undefined): GameState | null {
  if (!json) return null;
  try {
    const s = JSON.parse(json) as GameState;
    if (s.version !== 1 || !Array.isArray(s.clubs) || !Array.isArray(s.fixtures)) return null;
    // Saves from before the onboarding flow have no manager name.
    if (typeof s.managerName !== "string" || !s.managerName.trim()) s.managerName = DEFAULT_MANAGER_NAME;
    for (const c of s.clubs) {
      if (typeof c.budget !== "number") c.budget = Math.round(20 + (c.reputation - 10) * 12);
      // Older saves carry English club names; the roster of clubs is fixed by id, so refresh the labels.
      const def = CLUBS[c.id];
      if (def) { c.name = def.name; c.shortName = def.shortName; }
      if (!c.training) c.training = { focus: "balanced", intensity: "normal" };
      if (typeof c.seasonStartBudget !== "number") c.seasonStartBudget = c.budget;
      c.tactics = normalizeTactics({ ...c.tactics, formation: c.selection?.formation ?? c.tactics.formation });
      // Saves from before the academy: an empty one that fills at the next intake (season start / round 11).
      if (!c.youth || !Array.isArray(c.youth.prospects)) c.youth = { prospects: [], scouting: "local", coaching: 1, nextId: 1 };
      if (typeof c.youth.nextId !== "number") c.youth.nextId = c.youth.prospects.length + 1;
      for (const y of c.youth.prospects) if (typeof y.growth !== "number") y.growth = 0;
      for (const p of c.squad) {
        p.name = koreanName(p.name);
        if (typeof p.potential !== "number") { const o = overall(p.attrs, p.role); p.potential = Math.max(o, Math.min(20, Math.round((o + Math.max(0, 27 - p.age) * 0.55 + 0.5) * 10) / 10)); }
        if (typeof p.growth !== "number") p.growth = 0;
        if (typeof p.contractUntil !== "number") p.contractUntil = s.season + 1;
        if (typeof p.wage !== "number") p.wage = wageFor(p);
      }
    }
    s.news = (s.news ?? []).filter((n) => !/[A-Za-z]{4,}/.test(n));
    // Saves from before the cup: draw round 1 now; the cup days slot in from the next cup round on.
    if (!s.cup || !Array.isArray(s.cup.ties) || typeof s.cup.stage !== "number") newCup(s);
    if (typeof s.pendingCupDay !== "boolean") s.pendingCupDay = false;
    return s;
  } catch {
    return null;
  }
}
