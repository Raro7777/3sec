/**
 * 서사 이벤트: once a week there is a STORY_CHANCE of one event for the user with two or three choices (sponsor offers,
 * a local paper, a scouting tip, a player's private matter, a dressing-room row, the board's demands, derby week, an
 * away-fan bus, a coach being tapped up, an injury crisis, media criticism, a youth product asking for his debut).
 * Pending events sit in `s.events` until `resolveEvent`; one left for STORY_TTL rounds is settled with its last
 * (decline / do-nothing) choice. Resolved events move to `s.eventLog` (newest first, EVENT_LOG_MAX kept).
 *
 * Narrative news without a choice: a wonderkid in the academy, a first-team debut, a first goal, a national-team call-up
 * (overall ≥ CAP_RATING, age ≤ CAP_MAX_AGE, morale +5) and a loan returnee scoring against his old club.
 *
 * Hooks: `storyWeek` from advanceRound, `storyMatch` from recordResult, `storyRollover` from startNextSeason,
 * `migrateStory` from save.deserialize.
 */
import type { Match, Rng } from "@3sec/engine";
import type { Club, Fixture, GameState, SquadPlayer, StoryChoice, StoryEvent, StoryTemplateId } from "./types";
import { clubOf, nextUserFixture } from "./season";
import { adjustMood } from "./fans";
import { adjustMorale, adjustSquadMorale, captainOf, ensureCaptain, leadership, moraleOf, personalityOf } from "./morale";
import { isDerby, derbyName } from "./lore";
import { MAX_PROSPECTS, scoutedProspect } from "./youth";
import { STAFF_ROLE_LABEL } from "./staff";
import { formPoints } from "./board";
import { overall } from "./rating";
import { CLUBS_PER_DIVISION } from "./divisions";

export const STORY_CHANCE = 0.25;
/** Rounds a pending event waits before it settles itself with the last choice. */
export const STORY_TTL = 2;
export const EVENT_LOG_MAX = 20;
/** National-team call-ups: overall at least this, age at most this. */
export const CAP_RATING = 16;
export const CAP_MAX_AGE = 27;
export const CAP_MORALE = 5;
/** A prospect whose scouted floor reaches this is a wonderkid. */
export const WONDERKID_AT = 16;
/** 억원 */
export const SCOUT_TIP_COST = 3;
export const AWAY_BUS_COST = 2;
export const PHYSIO_COST = 3;

export const STORY_TEMPLATES: StoryTemplateId[] = ["sponsor", "localPress", "prospectTip", "personalLeave", "lockerConflict", "boardDemand", "derbyWeek", "awayBus", "coachOffer", "injuryCrisis", "mediaCriticism", "youthDebut"];

const clamp = (x: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, x));
const round1 = (x: number): number => Math.round(x * 10) / 10;
const isYouthProduct = (p: SquadPlayer): boolean => !!p.youthProduct || /-Y\d+$/.test(p.id);
const boardAdd = (s: GameState, d: number): void => { if (s.board && !s.board.sacked) s.board.confidence = round1(clamp(s.board.confidence + d, 0, 100)); };
const money = (c: Club, d: number): void => { c.budget = round1(c.budget + d); };

export const pendingEvents = (s: GameState): StoryEvent[] => (s.events ?? []).filter((e) => !e.resolved);

function flag(s: GameState, key: string): boolean {
  if (!s.storyFlags) s.storyFlags = [];
  if (s.storyFlags.includes(key)) return false;
  s.storyFlags.push(key);
  if (s.storyFlags.length > 200) s.storyFlags.splice(0, s.storyFlags.length - 200);
  return true;
}

// ------------------------------------------------------------------ templates

interface Draft { title: string; text: string; choices: StoryChoice[]; playerId?: string; playerId2?: string; staffId?: string; amount?: number }

const assistantOf = (me: Club): { id: string; name: string; rating: number; wage: number } | undefined => (me.staff ?? []).filter((m) => m.role === "assistant").sort((a, b) => b.rating - a.rating)[0];
const squadPool = (me: Club): SquadPlayer[] => me.squad.filter((p) => !p.onLoan);

/** Can the template fire this week? */
function applicable(s: GameState, me: Club, t: StoryTemplateId): boolean {
  const fx = nextUserFixture(s);
  switch (t) {
    case "sponsor": case "localPress": return true;
    case "prospectTip": return me.youth.prospects.length < MAX_PROSPECTS && me.budget >= SCOUT_TIP_COST;
    case "personalLeave": return squadPool(me).some((p) => p.injuryDays === 0);
    case "lockerConflict": return squadPool(me).length >= 4;
    case "boardDemand": return s.round >= 5 && !s.board?.sacked;
    case "derbyWeek": return !!fx && isDerby(fx.home, fx.away);
    case "awayBus": return !!fx && fx.away === s.userClub && me.budget >= AWAY_BUS_COST;
    case "coachOffer": return s.round >= 3 && !!assistantOf(me);
    case "injuryCrisis": return me.squad.filter((p) => p.injuryDays > 0).length >= 3;
    case "mediaCriticism": return s.round >= 5 && formPoints(s, s.userClub) <= 4;
    case "youthDebut": return squadPool(me).some((p) => isYouthProduct(p) && p.stats.apps === 0 && p.injuryDays === 0);
  }
}

function draft(s: GameState, me: Club, t: StoryTemplateId, rng: Rng): Draft | null {
  const pool = squadPool(me);
  const pick = (arr: SquadPlayer[]): SquadPlayer | undefined => (arr.length ? arr[Math.floor(rng.next() * arr.length)] : undefined);
  switch (t) {
    case "sponsor": {
      const amount = rng.int(3, 8);
      return { title: "스폰서 제안", text: `지역 유흥업체가 유니폼 소매 광고로 ${amount}억을 제안했습니다. 서포터 모임은 "구단 이미지에 맞지 않는다"며 반대합니다.`, amount, choices: [{ label: `${amount}억 받는다`, hint: "예산 +, 팬 분위기 −4" }, { label: "거절한다", hint: "팬 분위기 +2" }] };
    }
    case "localPress": return { title: "지역 언론 인터뷰 요청", text: "지역 신문이 감독 심층 인터뷰를 요청했습니다. 라커룸 이야기까지 솔직하게 듣고 싶다고 합니다.", choices: [{ label: "솔직하게 응한다", hint: "팬 +3, 이사회 +1, 선수단 사기 −1" }, { label: "구단 이야기만 한다", hint: "팬 +1" }, { label: "거절한다", hint: "팬 −2, 선수단 사기 +1" }] };
    case "prospectTip": return { title: "유망주 발굴 소식", text: `스카우트가 지방 리그에서 눈에 띄는 유망주를 발견했다고 보고했습니다. 영입에는 스카우팅 비용 ${SCOUT_TIP_COST}억이 듭니다.`, amount: SCOUT_TIP_COST, choices: [{ label: `영입한다 (${SCOUT_TIP_COST}억)`, hint: "잠재력 높은 유망주 아카데미 합류" }, { label: "넘긴다", hint: "변화 없음" }] };
    case "personalLeave": {
      const p = pick(pool.filter((q) => q.injuryDays === 0));
      if (!p) return null;
      return { title: "선수 개인사", text: `${p.name}이(가) 집안 사정으로 일주일 휴가를 요청했습니다. 허락하면 다음 경기에 뛸 수 없습니다.`, playerId: p.id, choices: [{ label: "휴가를 허락한다", hint: `${p.name} 사기 +10, 선수단 +1, 다음 경기 결장` }, { label: "경기 후에 가라고 한다", hint: `${p.name} 사기 −12` }] };
    }
    case "lockerConflict": {
      const sorted = [...pool].sort((a, b) => moraleOf(a) - moraleOf(b));
      const a = sorted[0]!, b = pick(sorted.slice(1, 5)) ?? sorted[1]!;
      const cap = ensureCaptain(me);
      return { title: "라커룸 갈등", text: `훈련 중 ${a.name}과(와) ${b.name}이(가) 크게 다퉜습니다. 분위기가 험악합니다.${cap ? ` 주장 ${cap.name}이(가) 중재하겠다고 나섰습니다.` : ""}`, playerId: a.id, playerId2: b.id, choices: [{ label: "주장에게 맡긴다", hint: "주장의 리더십에 따라 결과가 갈림" }, { label: "직접 두 선수를 부른다", hint: "두 선수 사기 −2, 선수단 +1" }, { label: "지켜본다", hint: "두 선수 사기 −6, 라커룸 −" }] };
    }
    case "boardDemand": {
      const rows = CLUBS_PER_DIVISION;
      const target = Math.max(1, Math.min(rows, Math.round(rows / 3)));
      return { title: "이사회 요구", text: `이사회가 시즌 목표를 ${target}위 이내로 못 박고 감독의 공개 약속을 요구합니다.`, amount: target, choices: [{ label: "약속한다", hint: "이사회 +3, 선수단 사기 −2 (부담)" }, { label: "현실적으로 답한다", hint: "이사회 −1, 선수단 사기 +1" }] };
    }
    case "derbyWeek": {
      const fx = nextUserFixture(s)!;
      const opp = clubOf(s, fx.home === s.userClub ? fx.away : fx.home);
      return { title: "더비 주간 분위기", text: `${derbyName(fx.home, fx.away)}을(를) 앞두고 도시 전체가 들썩입니다. 기자들이 ${opp.shortName}에 대한 한마디를 기다립니다.`, choices: [{ label: "불을 지핀다", hint: "선수단 사기 +4, 팬 +3, 이사회 −1" }, { label: "차분하게 준비한다", hint: "선수단 사기 +1" }] };
    }
    case "awayBus": {
      const fx = nextUserFixture(s)!;
      return { title: "원정 팬 버스 지원", text: `서포터즈가 ${clubOf(s, fx.home).shortName} 원정 응원 버스 비용 ${AWAY_BUS_COST}억 지원을 요청했습니다.`, amount: AWAY_BUS_COST, choices: [{ label: `지원한다 (${AWAY_BUS_COST}억)`, hint: "팬 +5, 선수단 사기 +1" }, { label: "거절한다", hint: "팬 −2" }] };
    }
    case "coachOffer": {
      const a = assistantOf(me)!;
      const raise = round1(Math.max(0.2, a.wage * 0.3));
      return { title: "코치 이직 제안", text: `${STAFF_ROLE_LABEL.assistant} ${a.name}에게 다른 구단이 자리를 제안했습니다. 연봉을 ${raise}억 올려 주면 남겠다고 합니다.`, staffId: a.id, amount: raise, choices: [{ label: `연봉 인상 (+${raise}억/시즌)`, hint: "코치 잔류" }, { label: "보내 준다", hint: "수석코치 이탈, 선수단 사기 −2" }] };
    }
    case "injuryCrisis": {
      const n = me.squad.filter((p) => p.injuryDays > 0).length;
      return { title: "부상 위기", text: `부상자가 ${n}명입니다. 의무 팀장이 외부 재활 전문가 초빙(${PHYSIO_COST}억)을 건의했습니다.`, amount: PHYSIO_COST, choices: [{ label: `전문가 초빙 (${PHYSIO_COST}억)`, hint: "모든 부상자 회복 −7일" }, { label: "참는다", hint: "변화 없음" }] };
    }
    case "mediaCriticism": return { title: "미디어 비판", text: `한 칼럼니스트가 "${s.managerName} 감독의 전술은 시대에 뒤떨어졌다"고 썼습니다. 기자들이 반응을 묻습니다.`, choices: [{ label: "정면 반박한다", hint: "팬 +2, 선수단 사기 +2, 이사회 −1" }, { label: "결과로 답하겠다", hint: "변화 없음" }] };
    case "youthDebut": {
      const p = pick(pool.filter((q) => isYouthProduct(q) && q.stats.apps === 0 && q.injuryDays === 0));
      if (!p) return null;
      return { title: "유스 출신 데뷔 요청", text: `아카데미 출신 ${p.name}(${p.age}세 ${p.role})이(가) 면담을 요청했습니다. "언제 기회를 주실 건가요?"`, playerId: p.id, choices: [{ label: "곧 기회를 주겠다고 한다", hint: `${p.name} 사기 +8 (약속을 지키지 않으면 다시 떨어집니다)` }, { label: "아직 이르다고 한다", hint: `${p.name} 사기 −5` }] };
    }
  }
}

// ------------------------------------------------------------------ the week

/** A wonderkid, and the season's national-team call-ups (morale +5); news for the user's club. */
function narrativeNews(s: GameState, rng: Rng): void {
  for (const c of s.clubs) {
    const mine = c.id === s.userClub;
    for (const y of c.youth.prospects) {
      if (y.potentialRange[0] >= WONDERKID_AT && flag(s, `wk:${y.id}`) && mine) s.news.unshift(`유스: 스카우트들이 ${y.name}(${y.age}세 ${y.role})을(를) 세대 최고의 재능으로 꼽고 있습니다. 원더키드 발견!`);
    }
    for (const p of c.squad) {
      if (p.onLoan || p.age > CAP_MAX_AGE || overall(p.attrs, p.role) < CAP_RATING || p.capSeason === s.season) continue;
      if (!rng.chance(0.3)) continue;
      p.capSeason = s.season;
      adjustMorale(p, CAP_MORALE);
      if (mine) s.news.unshift(`국가대표 발탁: ${p.name}이(가) 국가대표팀에 소집됐습니다 (사기 +${CAP_MORALE}).`);
    }
  }
}

/**
 * The weekly story tick (advanceRound): narrative news, stale events settle themselves, and — while nothing is
 * pending — a STORY_CHANCE roll for a new event from the templates that fit the week.
 */
export function storyWeek(s: GameState, rng: Rng): StoryEvent | null {
  if (!s.events) s.events = [];
  if (!s.eventLog) s.eventLog = [];
  narrativeNews(s, rng);
  for (const e of pendingEvents(s)) if (s.round >= e.expiresRound) resolveEvent(s, e.id, e.choices.length - 1, true);
  if (s.board?.sacked || pendingEvents(s).length) return null;
  if (!rng.chance(STORY_CHANCE)) return null;
  const me = clubOf(s, s.userClub);
  const fits = STORY_TEMPLATES.filter((t) => applicable(s, me, t));
  if (!fits.length) return null;
  const t = fits[Math.floor(rng.next() * fits.length)]!;
  const d = draft(s, me, t, rng);
  if (!d) return null;
  const ev: StoryEvent = { id: `ev-${s.season}-${s.round}-${t}`, template: t, season: s.season, round: s.round, expiresRound: s.round + STORY_TTL, ...d };
  s.events.push(ev);
  s.news.unshift(`이벤트: ${ev.title} — 홈 화면에서 선택하세요.`);
  return ev;
}

/**
 * The user (or the clock) picks a choice: the effects land, the event moves to the log. Returns the outcome text, or
 * null when the event or the choice does not exist.
 */
export function resolveEvent(s: GameState, eventId: string, choice: number, auto = false): string | null {
  const ev = (s.events ?? []).find((e) => e.id === eventId && !e.resolved);
  if (!ev || !ev.choices[choice]) return null;
  const me = clubOf(s, s.userClub);
  const p = ev.playerId ? me.squad.find((q) => q.id === ev.playerId) : undefined;
  const p2 = ev.playerId2 ? me.squad.find((q) => q.id === ev.playerId2) : undefined;
  let out = "";
  switch (ev.template) {
    case "sponsor":
      if (choice === 0) { money(me, ev.amount ?? 0); adjustMood(me, -4); out = `${ev.amount}억이 예산에 들어왔습니다. 서포터들은 못마땅해합니다.`; }
      else { adjustMood(me, 2); out = "서포터들이 구단의 결정에 박수를 보냈습니다."; }
      break;
    case "localPress":
      if (choice === 0) { adjustMood(me, 3); boardAdd(s, 1); adjustSquadMorale(me, -1); out = "인터뷰가 큰 반향을 얻었지만 선수들은 라커룸 이야기가 나간 것을 불편해합니다."; }
      else if (choice === 1) { adjustMood(me, 1); out = "무난한 인터뷰가 실렸습니다."; }
      else { adjustMood(me, -2); adjustSquadMorale(me, 1); out = "언론은 서운해했지만 선수들은 감독이 방패가 되어 준 것을 고마워합니다."; }
      break;
    case "prospectTip":
      if (choice === 0) {
        if (me.budget < SCOUT_TIP_COST) { out = "예산이 부족해 영입이 무산됐습니다."; break; }
        if (me.youth.prospects.length >= MAX_PROSPECTS) { out = `아카데미 정원(${MAX_PROSPECTS}명)이 차서 영입이 무산됐습니다.`; break; }
        money(me, -SCOUT_TIP_COST);
        const y = scoutedProspect(s, me, ev.id, 2);
        out = `${y.name}(${y.age}세 ${y.role})이(가) 아카데미에 합류했습니다 (잠재력 ${y.potentialRange[0]}~${y.potentialRange[1]}).`;
      } else out = "다른 구단이 그 선수를 데려갔다는 소식이 들립니다.";
      break;
    case "personalLeave":
      if (!p) { out = "선수는 이미 팀을 떠났습니다."; break; }
      if (choice === 0) { adjustMorale(p, 10); adjustSquadMorale(me, 1); p.injuryDays = Math.max(p.injuryDays, 6); out = `${p.name}이(가) 일주일 휴가를 떠났습니다. 선수단이 감독의 배려를 높이 삽니다.`; }
      else { adjustMorale(p, -12); out = `${p.name}이(가) 말없이 훈련장으로 돌아갔습니다. 표정이 어둡습니다.`; }
      break;
    case "lockerConflict": {
      const both = [p, p2].filter((q): q is SquadPlayer => !!q);
      if (choice === 0) {
        const cap = captainOf(me);
        const lead = cap ? leadership(cap) : 0;
        if (lead >= 0.55) { for (const q of both) adjustMorale(q, 5); adjustSquadMorale(me, 1); out = `주장 ${cap!.name}이(가) 두 선수를 화해시켰습니다. 라커룸이 오히려 단단해졌습니다.`; }
        else { for (const q of both) adjustMorale(q, -3); out = `${cap ? `주장 ${cap.name}은(는)` : "주장 없이는"} 갈등을 수습하지 못했습니다. 앙금이 남았습니다.`; }
      } else if (choice === 1) { for (const q of both) adjustMorale(q, -2); adjustSquadMorale(me, 1); out = "감독실에서 긴 면담이 있었습니다. 두 선수는 마지못해 악수했습니다."; }
      else { for (const q of both) adjustMorale(q, -6); adjustSquadMorale(me, -1); out = "갈등이 며칠 더 이어졌고 훈련 분위기가 가라앉았습니다."; }
      break;
    }
    case "boardDemand":
      if (choice === 0) { boardAdd(s, 3); adjustSquadMorale(me, -2); out = `${ev.amount}위 이내를 공개 약속했습니다. 이사회는 만족했지만 선수단은 부담을 느낍니다.`; }
      else { boardAdd(s, -1); adjustSquadMorale(me, 1); out = "이사회는 미지근한 반응이었지만 선수들은 감독이 방패가 되어 준 것을 압니다."; }
      break;
    case "derbyWeek":
      if (choice === 0) { adjustSquadMorale(me, 4); adjustMood(me, 3); boardAdd(s, -1); out = "감독의 도발적인 발언이 헤드라인을 장식했습니다. 선수단과 팬은 달아올랐고 이사회는 눈살을 찌푸렸습니다."; }
      else { adjustSquadMorale(me, 1); out = "조용한 한 주였습니다. 선수들은 경기에만 집중했습니다."; }
      break;
    case "awayBus":
      if (choice === 0) {
        if (me.budget < AWAY_BUS_COST) { adjustMood(me, -2); out = "예산이 부족해 지원하지 못했습니다."; break; }
        money(me, -AWAY_BUS_COST); adjustMood(me, 5); adjustSquadMorale(me, 1); out = "원정석이 우리 팬으로 가득 찼습니다. 선수들도 힘을 얻었습니다.";
      } else { adjustMood(me, -2); out = "서포터즈는 자비로 몇 명만 원정을 떠났습니다."; }
      break;
    case "coachOffer": {
      const m = (me.staff ?? []).find((x) => x.id === ev.staffId);
      if (!m) { out = "코치는 이미 팀에 없습니다."; break; }
      if (choice === 0) { m.wage = round1(m.wage + (ev.amount ?? 0)); m.contractUntil = Math.max(m.contractUntil, s.season + 1); out = `${m.name} 코치가 잔류합니다 (연봉 ${m.wage}억, ~S${m.contractUntil}).`; }
      else { me.staff = me.staff.filter((x) => x !== m); adjustSquadMorale(me, -2); out = `${STAFF_ROLE_LABEL.assistant} ${m.name}이(가) 팀을 떠났습니다. 선수들이 아쉬워합니다.`; }
      break;
    }
    case "injuryCrisis":
      if (choice === 0) {
        if (me.budget < PHYSIO_COST) { out = "예산이 부족해 초빙이 무산됐습니다."; break; }
        money(me, -PHYSIO_COST);
        let n = 0;
        for (const q of me.squad) if (q.injuryDays > 0) { q.injuryDays = Math.max(0, q.injuryDays - 7); n++; }
        out = `재활 전문가가 합류해 부상자 ${n}명의 복귀가 일주일 앞당겨졌습니다.`;
      } else out = "의무팀이 묵묵히 버티고 있습니다.";
      break;
    case "mediaCriticism":
      if (choice === 0) { adjustMood(me, 2); adjustSquadMorale(me, 2); boardAdd(s, -1); out = "감독의 반박이 화제가 됐습니다. 팬과 선수는 통쾌해했고 이사회는 조용히 하길 바랍니다."; }
      else out = "감독은 말을 아꼈습니다.";
      break;
    case "youthDebut":
      if (!p) { out = "선수는 이미 팀을 떠났습니다."; break; }
      if (choice === 0) { adjustMorale(p, 8); out = `${p.name}이(가) 밝은 얼굴로 훈련장으로 돌아갔습니다. 기회를 기다립니다.`; }
      else { adjustMorale(p, -5); out = `${p.name}은(는) 실망했지만 받아들였습니다.`; }
      break;
  }
  ev.resolved = { choice, outcome: out, round: s.round, auto: auto || undefined };
  s.events = (s.events ?? []).filter((e) => e !== ev);
  if (!s.eventLog) s.eventLog = [];
  s.eventLog.unshift(ev);
  if (s.eventLog.length > EVENT_LOG_MAX) s.eventLog.length = EVENT_LOG_MAX;
  s.news.unshift(`${ev.title}${auto ? " (자동 처리)" : ""}: ${ev.choices[choice]!.label} — ${out}`);
  return out;
}

// ------------------------------------------------------------------ match narrative

/**
 * After recordResult wrote the stats: a youth product's first-team debut, anyone's first senior goal (user's club), and
 * a loan returnee (or loanee) scoring against his old club (any club).
 */
export function storyMatch(s: GameState, f: Pick<Fixture, "home" | "away">, m: Match, cup = false): void {
  const clubs: [Club, Club] = [clubOf(s, f.home), clubOf(s, f.away)];
  for (const side of [0, 1] as const) {
    const c = clubs[side], opp = clubs[1 - side]!;
    const mine = c.id === s.userClub;
    const goals = new Map<string, number>();
    for (const e of m.state.events) if (e.type === "GOAL" && e.team === side && e.playerId) goals.set(e.playerId, (goals.get(e.playerId) ?? 0) + 1);
    const played = m.state.players.filter((ps) => ps.team === side && ps.distance > 0);
    for (const ps of played) {
      const p = c.squad.find((q) => q.id === ps.id);
      if (!p) continue;
      const careerApps = (p.career ?? []).reduce((a, e) => a + e.apps, 0);
      const careerGoals = (p.career ?? []).reduce((a, e) => a + e.goals, 0);
      const g = goals.get(p.id) ?? 0;
      if (mine && p.stats.apps === 1 && careerApps === 0 && (isYouthProduct(p) || p.age <= 20)) {
        s.news.unshift(`데뷔: ${isYouthProduct(p) ? "아카데미 출신 " : ""}${p.name}(${p.age}세)이(가) ${opp.shortName}전에서 1군 데뷔전을 치렀습니다${g ? " — 데뷔골까지!" : ""}.`);
        adjustMorale(p, 4);
      } else if (mine && g && p.stats.goals === g && careerGoals === 0) {
        s.news.unshift(`첫 골: ${p.name}이(가) ${opp.shortName}전에서 프로 데뷔골을 기록했습니다.`);
        adjustMorale(p, 4);
      }
      if (g && (p.loanFrom === opp.id || p.lastLoanClub === opp.id)) {
        s.news.unshift(`${cup ? "3sec 컵: " : ""}${p.loanFrom === opp.id ? "임대생" : "임대 복귀한"} ${p.name}, 친정팀 ${opp.shortName} 상대로 득점! 세리머니는 하지 않았습니다.`);
      }
    }
  }
}

/** Season rollover: pending events settle with their last choice; the log survives. */
export function storyRollover(s: GameState): void {
  for (const e of pendingEvents(s)) resolveEvent(s, e.id, e.choices.length - 1, true);
  if (!s.events) s.events = [];
  if (!s.eventLog) s.eventLog = [];
}

/** Saves from before the story layer: empty queues. */
export function migrateStory(s: GameState): void {
  if (!Array.isArray(s.events)) s.events = [];
  if (!Array.isArray(s.eventLog)) s.eventLog = [];
  if (!Array.isArray(s.storyFlags)) s.storyFlags = [];
  if (s.pendingInterview && (!Array.isArray(s.pendingInterview.options) || !s.pendingInterview.options.length)) s.pendingInterview = undefined;
}
