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
import { foreignCountry } from "./continental";
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
import { CLUBS_PER_DIVISION, DIVISIONS, clubsIn, divisionName, inRelegationZone, userDivision } from "./divisions";
import { MAX_SQUAD, bestOffer, playerValue, sellPlayer, windowOpen } from "./transfers";
import { wageBill } from "./contracts";
import { seasonRounds, table } from "./season";
import { LOAN_INTEREST, LOAN_WEEKS, RED_ARREARS_WEEKS, inArrears, redWeeks, takeEmergencyLoan } from "./finance";
import { forgetAlumnus, noteDeparture, returnFee, returnable, returningPlayer } from "./alumni";
import { FEUD_AT, adjustFeud, feudWith, tauntLine } from "./rivalry";
import { clubLore } from "./lore";
import { clubCapacity, fanBase } from "./fans";

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

export const STORY_TEMPLATES: StoryTemplateId[] = ["sponsor", "localPress", "prospectTip", "personalLeave", "lockerConflict", "boardDemand", "derbyWeek", "awayBus", "coachOffer", "injuryCrisis", "mediaCriticism", "youthDebut", "topFlightBid", "relegationFear", "overseasBid",
  "wageArrears", "boardSellDemand", "fanFunding", "cityGrant", "veteranFarewell", "lateBloomer", "prodigalReturn", "rivalTaunt"];

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

interface Draft { title: string; text: string; choices: StoryChoice[]; playerId?: string; playerId2?: string; staffId?: string; amount?: number; clubId?: number; managerId?: string }

/** The squad member a bigger club would come asking about: the best of the ones that can be sold. */
const starPlayer = (me: Club): SquadPlayer | undefined =>
  [...me.squad].filter((p) => !p.onLoan && p.loanFrom === undefined && p.injuryDays === 0)
    .sort((a, b) => overall(b.attrs, b.role) - overall(a.attrs, a.role))[0];

/** How many points off safety the user is, when they are in the drop zone. */
function pointsToSafety(s: GameState): number {
  const rows = table(s);
  const safeIdx = rows.length - 3; // the last position that stays up
  const safe = rows[safeIdx], me = rows.find((r) => r.club === s.userClub);
  return safe && me ? Math.max(0, safe.pts - me.pts) : 0;
}

/** Rounds still to play in the user's season. */
const roundsLeft = (s: GameState): number => Math.max(0, seasonRounds(s) - s.round);

const assistantOf = (me: Club): { id: string; name: string; rating: number; wage: number } | undefined => (me.staff ?? []).filter((m) => m.role === "assistant").sort((a, b) => b.rating - a.rating)[0];
const hasFlag = (s: GameState, key: string): boolean => !!s.storyFlags?.includes(key);
const roundsLeftIn = (s: GameState): number => seasonRounds(s) - s.round;
/** 시민구단 by its lore: the city's club, which the council part-funds. */
const isCivic = (id: number): boolean => /시민구단/.test(clubLore(id).history);
/** A veteran on an expiring deal in the run-in, the most-capped first. */
const veteranOf = (s: GameState, me: Club): SquadPlayer | undefined =>
  s.round >= seasonRounds(s) - 6 && roundsLeftIn(s) > 0
    ? [...squadPool(me)].filter((p) => p.age >= 33 && p.contractUntil <= s.season && !hasFlag(s, `vet:${p.id}`)).sort((a, b) => b.stats.apps - a.stats.apps)[0]
    : undefined;
/** A non-starter in his mid-to-late twenties with room left to grow: the late bloomer. */
const bloomerOf = (s: GameState, me: Club): SquadPlayer | undefined =>
  s.round >= 3
    ? [...squadPool(me)].filter((p) => p.age >= 25 && p.age <= 29 && p.injuryDays === 0 && !me.selection.starters.includes(p.id) && p.potential - overall(p.attrs, p.role) >= 1 && !hasFlag(s, `bloom:${p.id}`))
      .sort((a, b) => (b.potential - overall(b.attrs, b.role)) - (a.potential - overall(a.attrs, a.role)))[0]
    : undefined;
const fundingAmount = (me: Club): number => clamp(Math.round((fanBase(me.reputation, clubCapacity(me)) / 4000) * (me.fans.mood / 60)), 2, 12);
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
    // A club above only comes calling when there is a division above to come from, a window to deal
    // in, and somebody worth asking about.
    case "topFlightBid": return userDivision(s) > 1 && windowOpen(s) && !!starPlayer(me) && clubsIn(s, userDivision(s) - 1).length > 0;
    // a club abroad comes for the top flight's stars: only a real star, only with the window open
    case "overseasBid": { const star = starPlayer(me); return userDivision(s) === 1 && windowOpen(s) && !!star && overall(star.attrs, star.role) >= 13.5 && (s.foreign?.length ?? 0) > 0; }
    // The run-in, in the drop zone, with the drop still real.
    // 구단 생존 (finance.ts): the squad, the board, the fans and the city all react to a club in the red
    case "wageArrears": return inArrears(me) && !hasFlag(s, `arrears:${s.season}`);
    case "boardSellDemand": { const star = starPlayer(me); return redWeeks(me) >= RED_ARREARS_WEEKS + 3 && windowOpen(s) && !!star && !!bestOffer(s, star.id) && !hasFlag(s, `selldemand:${s.season}`); }
    case "fanFunding": return me.budget < 0 && me.fans.mood >= 45 && !hasFlag(s, `fund:${s.season}`);
    case "cityGrant": return isCivic(me.id) && s.round >= 2 && s.round <= 8 && me.budget < 15 && !hasFlag(s, `grant:${s.season}`);
    // 선수 서사
    case "veteranFarewell": return !!veteranOf(s, me);
    case "lateBloomer": return !!bloomerOf(s, me);
    case "prodigalReturn": return windowOpen(s) && returnable(s).length > 0 && me.squad.length < MAX_SQUAD;
    // 감독 라이벌 (rivalry.ts): the derby press week
    case "rivalTaunt": return !!fx && isDerby(fx.home, fx.away) && !!clubOf(s, fx.home === s.userClub ? fx.away : fx.home).manager && !hasFlag(s, `taunt:${s.season}:${s.round}`);
    case "relegationFear": return userDivision(s) < DIVISIONS && s.round >= seasonRounds(s) - 4 && roundsLeft(s) > 0 && inRelegationZone(s, s.userClub);
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
    case "topFlightBid": {
      const p = starPlayer(me)!;
      // the bidder: a club from the division above, the stronger ones more likely to come calling
      const above = [...clubsIn(s, userDivision(s) - 1)].sort((a, b) => b.reputation - a.reputation);
      const from = above[Math.floor(rng.next() * rng.next() * above.length)] ?? above[0]!;
      const fee = Math.max(1, Math.round(playerValue(p) * (1.15 + rng.next() * 0.4)));
      const raise = Math.max(0.1, Math.round(p.wage * 0.4 * 10) / 10);
      return {
        title: `${divisionName(userDivision(s) - 1)}의 제안`,
        text: `${from.name}이(가) ${p.name}에게 관심을 보이며 ${fee}억을 제시했습니다. ${p.name}은(는) "${divisionName(userDivision(s) - 1)}에서 뛰고 싶다"는 말을 숨기지 않습니다.`,
        playerId: p.id, amount: fee, clubId: from.id,
        choices: [
          { label: `${fee}억에 판다`, hint: `예산 +${fee}억, 선수단 사기 −4, 팬 −5` },
          { label: "거절한다", hint: `${p.name} 사기 −15, 이적 요구 가능성` },
          { label: `재계약으로 붙잡는다 (연봉 +${raise}억)`, hint: `${p.name} 사기 +12, 예산 −${raise}억, 팬 +3` },
        ],
      };
    }
    case "overseasBid": {
      const p = starPlayer(me)!;
      const rich = [...(s.foreign ?? [])].sort((a, b) => b.reputation - a.reputation);
      const from = rich[Math.floor(rng.next() * rng.next() * rich.length)] ?? rich[0]!;
      // abroad the money is bigger: well above the domestic value, and the player knows it
      const fee = Math.max(2, Math.round(playerValue(p) * (1.6 + rng.next() * 0.7)));
      const raise = Math.max(0.2, Math.round(p.wage * 0.6 * 10) / 10);
      return {
        title: "해외 구단의 제안",
        text: `${foreignCountry(from.id)}의 ${from.name}이(가) ${p.name} 영입에 ${fee}억을 제시했습니다. 에이전트는 "선수 본인도 해외 도전을 원한다"고 전합니다.`,
        playerId: p.id, amount: fee, clubId: from.id,
        choices: [
          { label: `${fee}억에 보낸다`, hint: `예산 +${fee}억, 선수단 사기 −3, 팬 −4, 이사회 +2` },
          { label: "거절한다", hint: `${p.name} 사기 −18, 이적 요구 가능성 큼` },
          { label: `재계약으로 붙잡는다 (연봉 +${raise}억)`, hint: `${p.name} 사기 +10, 예산 −${raise}억, 팬 +4` },
        ],
      };
    }
    case "wageArrears": {
      flag(s, `arrears:${s.season}`);
      const cap = ensureCaptain(me);
      const amount = Math.max(5, Math.round(wageBill(me) / 4));
      return {
        title: "급여 체불 항의",
        text: `${redWeeks(me)}주째 적자로 급여가 밀렸습니다. ${cap ? `주장 ${cap.name}이(가)` : "고참들이"} 선수단을 대표해 감독실을 찾아왔습니다. 구단주는 ${amount}억 긴급 대출을 제안했지만 이자 ${Math.round(LOAN_INTEREST * 100)}%에 ${LOAN_WEEKS}주 분할 상환 조건입니다.`,
        amount, playerId: cap?.id,
        choices: [
          { label: "주장에게 시간을 부탁한다", hint: "주장 리더십에 따라 선수단 사기 +3 또는 −3" },
          { label: `구단주 대출 ${amount}억`, hint: `예산 +${amount}억, ${LOAN_WEEKS}주간 매주 상환, 이사회 −2` },
          { label: "버틴다", hint: "선수단 사기 −4, 이사회 −1, 이적 요구 가능성" },
        ],
      };
    }
    case "boardSellDemand": {
      flag(s, `selldemand:${s.season}`);
      const star = starPlayer(me)!;
      const offer = bestOffer(s, star.id)!;
      return {
        title: "이사회의 매각 요구",
        text: `${redWeeks(me)}주째 적자입니다. 이사회가 "구단이 먼저"라며 ${star.name}을(를) ${offer.club.name}에 ${offer.fee}억에 넘기라고 요구합니다.`,
        playerId: star.id, clubId: offer.club.id, amount: offer.fee,
        choices: [{ label: `${offer.fee}억에 판다`, hint: "예산 +, 이사회 +5, 팬과 선수단은 실망" }, { label: "거부한다", hint: "이사회 −8, 선수단 사기 +2" }],
      };
    }
    case "fanFunding": {
      flag(s, `fund:${s.season}`);
      const amount = fundingAmount(me);
      return {
        title: "팬 후원 캠페인",
        text: `서포터즈 연합이 "구단을 살리자" 후원 캠페인을 제안했습니다. 예상 모금액은 ${amount}억이지만, 팬들에게 손을 벌리는 일입니다.`,
        amount,
        choices: [{ label: "캠페인을 연다", hint: `예산 +${amount}억, 팬 −3, 선수단 사기 +2` }, { label: "사양한다", hint: "팬 +1" }],
      };
    }
    case "cityGrant": {
      flag(s, `grant:${s.season}`);
      const amount = rng.int(6, 12);
      return {
        title: "지자체 지원금 심사",
        text: `시의회가 시민구단 지원금 ${amount}억 심사를 앞두고 있습니다. 유스·지역 공헌 계획 발표가 필요합니다. 시장 선거 유세에 감독이 함께 서 준다면 더 준다는 귀띔도 있습니다.`,
        amount,
        choices: [
          { label: "지역 공헌 계획으로 신청한다", hint: `팬 여론 40 이상이면 +${amount}억, 아니면 절반` },
          { label: "유세에 동행한다", hint: `+${Math.round(amount * 1.3)}억, 팬 −4, 이사회 +1` },
          { label: "신청하지 않는다", hint: "변화 없음" },
        ],
      };
    }
    case "veteranFarewell": {
      const p = veteranOf(s, me)!;
      flag(s, `vet:${p.id}`);
      const apps = p.stats.apps + (p.career ?? []).filter((e) => e.club === me.id).reduce((n, e) => n + e.apps, 0);
      const wage = Math.max(0.2, round1(p.wage * 0.8));
      return {
        title: "베테랑의 마지막 시즌",
        text: `${p.name}(${p.age}세)의 계약이 이번 시즌으로 끝납니다. 구단에서 ${apps}경기를 뛴 그가 감독실 문을 두드렸습니다. "한 시즌만 더 뛰고 싶습니다. 연봉은 깎아도 좋습니다."`,
        playerId: p.id, amount: wage,
        choices: [
          { label: `1년 더 (연봉 ${wage}억)`, hint: `${p.name} 사기 +8, 팬 +2` },
          { label: "은퇴 경기를 마련한다", hint: "팬 +5, 선수단 사기 +3, 시즌 후 떠남" },
          { label: "사무적으로 통보한다", hint: `${p.name} 사기 −8, 팬 −3, 선수단 −1` },
        ],
      };
    }
    case "lateBloomer": {
      const p = bloomerOf(s, me)!;
      flag(s, `bloom:${p.id}`);
      return {
        title: "늦깎이의 부탁",
        text: `${p.age}세 ${p.name}이(가) 훈련이 끝난 뒤 혼자 남아 있었습니다. "감독님, 저 아직 늘 수 있습니다. 한 번만 믿어 주세요." 코치진도 요즘 훈련 태도가 달라졌다고 합니다.`,
        playerId: p.id,
        choices: [{ label: "기회를 준다", hint: `${p.name} 성장 +1.5, 사기 +12` }, { label: "지금처럼 간다", hint: `${p.name} 사기 −5` }],
      };
    }
    case "prodigalReturn": {
      const a = returnable(s)[0]!;
      const rp = returningPlayer(s, a);
      const fee = returnFee(rp);
      return {
        title: "돌아온 탕아",
        text: `${a.toName}에서 ${s.season - a.season}시즌을 보낸 ${rp.name}(${rp.age}세 ${rp.role}, 능력 ${overall(rp.attrs, rp.role).toFixed(1)})이(가) 돌아오고 싶다고 합니다. 이적료 ${fee}억, 연봉 ${rp.wage}억. 팬들은 이미 그의 이름을 외치고 있습니다.`,
        playerId: rp.id, amount: fee, clubId: a.toClub,
        choices: [{ label: `데려온다 (${fee}억)`, hint: "팬 +6, 선수단 사기 +1" }, { label: "거절한다", hint: "그는 다른 곳에서 커리어를 마칩니다" }],
      };
    }
    case "rivalTaunt": {
      const fx = nextUserFixture(s)!;
      flag(s, `taunt:${s.season}:${s.round}`);
      const opp = clubOf(s, fx.home === s.userClub ? fx.away : fx.home);
      const m = opp.manager!;
      const feud = feudWith(s, m.id);
      return {
        title: "라이벌 감독의 도발",
        text: `${derbyName(fx.home, fx.away)}을(를) 앞둔 기자회견에서 ${opp.shortName}의 ${m.name} 감독이 말했습니다. ${tauntLine(m, s.managerName)}${feud >= FEUD_AT ? " 두 감독의 신경전은 이미 리그의 화제입니다." : ""}`,
        clubId: opp.id, managerId: m.id,
        choices: [
          { label: "받아친다", hint: "선수단 사기 +3, 팬 +3, 이사회 −1, 앙숙 +1 (더비 결과의 파급 커짐)" },
          { label: "무시한다", hint: "변화 없음" },
          { label: "존중을 표한다", hint: "이사회 +1, 팬 −1, 앙숙 −1" },
        ],
      };
    }
    case "relegationFear": {
      const gap = pointsToSafety(s);
      const left = roundsLeft(s);
      const below = divisionName(userDivision(s) + 1);
      return {
        title: `강등권, 남은 ${left}경기`,
        text: `${left}경기를 남기고 강등권입니다. 잔류까지 승점 ${gap}점 차. 훈련장 공기가 무겁고, 선수들이 실수를 두려워하는 게 눈에 보입니다. ${below} 이야기는 아무도 꺼내지 않습니다.`,
        amount: gap,
        choices: [
          { label: "베테랑을 앞세운다", hint: "고참 사기 +8, 어린 선수 −5, 이사회 +1" },
          { label: "젊은 선수에게 맡긴다", hint: "23세 이하 사기 +10·성장 +, 고참 −6, 팬 +2" },
          { label: "부담을 덜어 준다", hint: "선수단 전체 사기 +5, 팬 −3, 이사회 −1" },
        ],
      };
    }
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
    case "topFlightBid": {
      const from = ev.clubId !== undefined ? clubOf(s, ev.clubId) : null;
      if (!p) { out = "그 선수는 이미 팀을 떠났습니다."; break; }
      if (choice === 0) {
        const fee = ev.amount ?? 0;
        money(me, fee);
        if (from) noteDeparture(s, p, from.id, from.name, me.id);
        me.squad = me.squad.filter((q) => q.id !== p.id);
        me.selection.starters = me.selection.starters.filter((id) => id !== p.id);
        me.selection.bench = me.selection.bench.filter((id) => id !== p.id);
        if (from) from.squad.push(p);
        adjustSquadMorale(me, -4);
        adjustMood(me, -5);
        out = `${p.name}이(가) ${from?.shortName ?? "상위 리그"}로 떠났습니다. ${fee}억이 들어왔지만 라커룸은 조용합니다.`;
      } else if (choice === 1) {
        adjustMorale(p, -15);
        // an ambitious player held against his will starts pushing for the move himself
        if (personalityOf(p).ambition > 0.6) p.transferRequest = true;
        out = `제안을 거절했습니다. ${p.name}은(는) 납득하지 못한 표정입니다.${p.transferRequest ? " 이적을 공식 요구했습니다." : ""}`;
      } else {
        const raise = Math.max(0.1, Math.round(p.wage * 0.4 * 10) / 10);
        p.wage = Math.round((p.wage + raise) * 10) / 10;
        money(me, -raise);
        adjustMorale(p, 12);
        adjustMood(me, 3);
        p.transferRequest = false;
        out = `${p.name}이(가) 재계약에 서명했습니다 (연봉 +${raise}억). 팬들은 구단이 에이스를 지켰다며 반겼습니다.`;
      }
      break;
    }
    case "overseasBid": {
      const from = ev.clubId !== undefined ? clubOf(s, ev.clubId) : null;
      if (!p) { out = "그 선수는 이미 팀을 떠났습니다."; break; }
      if (choice === 0) {
        const fee = ev.amount ?? 0;
        money(me, fee);
        me.squad = me.squad.filter((q) => q.id !== p.id);
        me.selection.starters = me.selection.starters.filter((id) => id !== p.id);
        me.selection.bench = me.selection.bench.filter((id) => id !== p.id);
        if (from) from.squad.push(p);
        adjustSquadMorale(me, -3);
        adjustMood(me, -4);
        if (s.board) s.board.confidence = Math.min(100, Math.round((s.board.confidence + 2) * 10) / 10);
        out = `${p.name}이(가) ${from?.name ?? "해외"}(으)로 떠났습니다. ${fee}억. 이사회는 장사를 잘했다고 보지만 팬들은 서운합니다.`;
      } else if (choice === 1) {
        adjustMorale(p, -18);
        if (personalityOf(p).ambition > 0.4) p.transferRequest = true;
        out = `제안을 거절했습니다. ${p.name}은(는) 해외 도전의 꿈이 막혔다고 느낍니다.${p.transferRequest ? " 이적을 공식 요구했습니다." : ""}`;
      } else {
        const raise = Math.max(0.2, Math.round(p.wage * 0.6 * 10) / 10);
        p.wage = Math.round((p.wage + raise) * 10) / 10;
        money(me, -raise);
        adjustMorale(p, 10);
        adjustMood(me, 4);
        p.transferRequest = false;
        out = `${p.name}이(가) 재계약에 서명했습니다 (연봉 +${raise}억). "아직 여기서 이룰 게 남았다"고 했습니다.`;
      }
      break;
    }
    case "wageArrears": {
      if (choice === 0) {
        const cap = captainOf(me);
        if (cap && leadership(cap) >= 0.55) { adjustSquadMorale(me, 3); out = `주장 ${cap.name}이(가) 선수단을 다독였습니다. "감독님을 믿자." 밀린 급여는 남았지만 라커룸은 버팁니다.`; }
        else { adjustSquadMorale(me, -3); out = `${cap ? `주장 ${cap.name}은(는)` : "고참들은"} 선수단을 설득하지 못했습니다. 훈련장 분위기가 싸늘합니다.`; }
      } else if (choice === 1) {
        takeEmergencyLoan(s, ev.amount ?? 0);
        boardAdd(s, -2);
        adjustSquadMorale(me, 2);
        out = `구단주에게 ${ev.amount}억을 빌렸습니다. 급여가 나갔지만 ${LOAN_WEEKS}주간 매주 ${s.emergencyLoan?.weekly}억씩 갚아야 합니다. 이사회는 감독의 살림을 걱정합니다.`;
      } else {
        adjustSquadMorale(me, -4);
        boardAdd(s, -1);
        const restless = [...squadPool(me)].sort((a, b) => personalityOf(b).ambition - personalityOf(a).ambition)[0];
        if (restless && personalityOf(restless).ambition > 0.5) { restless.transferRequest = true; out = `버티기로 했습니다. ${restless.name}이(가) 에이전트를 통해 이적을 요구했습니다.`; }
        else out = "버티기로 했습니다. 선수들은 말없이 훈련했지만 웃음이 사라졌습니다.";
      }
      break;
    }
    case "boardSellDemand": {
      if (!p) { out = "그 선수는 이미 팀을 떠났습니다."; break; }
      if (choice === 0) {
        const err = sellPlayer(s, p.id);
        if (err) { out = `매각이 무산됐습니다: ${err}`; break; }
        boardAdd(s, 5);
        adjustSquadMorale(me, -2);
        out = `${p.name}을(를) 팔았습니다. 이사회는 안도했고, 팬들은 "구단이 선수를 팔아 연명한다"고 씁쓸해합니다.`;
      } else { boardAdd(s, -8); adjustSquadMorale(me, 2); out = `매각을 거부했습니다. 이사회는 "감독이 현실을 모른다"고 했지만 선수단은 감독 편에 섰습니다.`; }
      break;
    }
    case "fanFunding":
      if (choice === 0) { money(me, ev.amount ?? 0); adjustMood(me, -3); adjustSquadMorale(me, 2); out = `팬들이 ${ev.amount}억을 모아 주었습니다. 선수들은 응답해야 한다는 것을 압니다. 다만 "또 팬 지갑이냐"는 말도 나옵니다.`; }
      else { adjustMood(me, 1); out = "정중히 사양했습니다. 팬들은 구단의 자존심을 이해했습니다."; }
      break;
    case "cityGrant": {
      const amount = ev.amount ?? 0;
      if (choice === 0) {
        const full = me.fans.mood >= 40;
        const got = full ? amount : Math.round(amount / 2);
        money(me, got);
        out = full ? `시의회가 지원금 ${got}억을 승인했습니다. 시민 여론이 구단 편이었습니다.` : `시민 여론이 좋지 않아 지원금이 ${got}억으로 깎였습니다.`;
      } else if (choice === 1) { const got = Math.round(amount * 1.3); money(me, got); adjustMood(me, -4); boardAdd(s, 1); out = `유세 무대에 함께 섰고 지원금 ${got}억이 나왔습니다. 서포터 게시판은 "감독이 정치를 한다"며 시끄럽습니다.`; }
      else out = "신청하지 않았습니다. 시의회는 다음 시즌에 다시 보자고 했습니다.";
      break;
    }
    case "veteranFarewell": {
      if (!p) { out = "그 선수는 이미 팀을 떠났습니다."; break; }
      if (choice === 0) { p.wage = ev.amount ?? p.wage; p.contractUntil = s.season + 1; adjustMorale(p, 8); adjustMood(me, 2); out = `${p.name}이(가) 연봉 ${p.wage}억에 1년 더 뛰기로 했습니다. 그는 감독실을 나서며 고개를 깊이 숙였습니다.`; }
      else if (choice === 1) { adjustMood(me, 5); adjustSquadMorale(me, 3); adjustMorale(p, 4); out = `마지막 홈경기를 ${p.name}의 은퇴 경기로 치르기로 했습니다. 팬들이 걸개를 준비합니다. 시즌이 끝나면 그는 떠납니다.`; }
      else { adjustMorale(p, -8); adjustMood(me, -3); adjustSquadMorale(me, -1); out = `사무국 통보로 끝났습니다. ${p.name}은(는) 말없이 짐을 챙겼고 고참들은 그 장면을 봤습니다.`; }
      break;
    }
    case "lateBloomer": {
      if (!p) { out = "그 선수는 이미 팀을 떠났습니다."; break; }
      if (choice === 0) { p.growth += 1.5; p.potential = Math.max(p.potential, round1(overall(p.attrs, p.role) + 1.5)); adjustMorale(p, 12); out = `${p.name}에게 기회를 약속했습니다. 그는 그날 밤 가장 늦게 훈련장을 떠났습니다 (성장 +1.5).`; }
      else { adjustMorale(p, -5); out = `${p.name}은(는) 알겠다고만 했습니다. 다음 날 훈련은 평소와 같았습니다.`; }
      break;
    }
    case "prodigalReturn": {
      const a = (s.alumni ?? []).find((x) => x.player.id === ev.playerId);
      if (!a) { out = "그는 이미 다른 팀과 계약했습니다."; break; }
      if (choice === 0) {
        const fee = ev.amount ?? 0;
        if (me.budget < fee) { out = `예산이 부족해 복귀가 무산됐습니다 (${fee}억 필요).`; break; }
        if (me.squad.length >= MAX_SQUAD) { out = "스쿼드가 가득 차 복귀가 무산됐습니다."; break; }
        const rp = returningPlayer(s, a);
        money(me, -fee);
        const used = new Set(me.squad.map((q) => q.number));
        if (used.has(rp.number)) for (let n = 2; n < 100; n++) if (!used.has(n)) { rp.number = n; break; }
        me.squad.push(rp);
        forgetAlumnus(s, rp.id);
        adjustMood(me, 6);
        adjustSquadMorale(me, 1);
        out = `${rp.name}이(가) 돌아왔습니다. 첫 훈련에 팬 수백 명이 담장 밖에 모였습니다.`;
      } else { forgetAlumnus(s, ev.playerId!); out = "거절했습니다. 그는 다른 곳에서 커리어를 이어 갑니다."; }
      break;
    }
    case "rivalTaunt": {
      const mid = ev.managerId ?? "";
      if (choice === 0) { adjustSquadMorale(me, 3); adjustMood(me, 3); boardAdd(s, -1); const f = adjustFeud(s, mid, 1); out = `받아쳤습니다. 다음 날 신문 1면은 두 감독의 사진이었습니다${f >= FEUD_AT ? " — 이제 두 사람은 공인된 앙숙입니다" : ""}.`; }
      else if (choice === 1) out = "질문을 흘려보냈습니다. 기사는 하루 만에 잊혔습니다.";
      else { boardAdd(s, 1); adjustMood(me, -1); adjustFeud(s, mid, -1); out = "상대 감독을 치켜세웠습니다. 이사회는 품위를 칭찬했고 팬들은 조금 김이 빠졌습니다."; }
      break;
    }
    case "relegationFear": {
      const squad = squadPool(me);
      if (choice === 0) {
        for (const q of squad) adjustMorale(q, q.age >= 29 ? 8 : q.age <= 22 ? -5 : 0);
        boardAdd(s, 1);
        out = "고참들이 앞으로 나섰습니다. 젊은 선수들은 밀려난 기분입니다.";
      } else if (choice === 1) {
        for (const q of squad) {
          if (q.age <= 23) { adjustMorale(q, 10); if (overall(q.attrs, q.role) < q.potential) q.growth += 0.15; }
          else if (q.age >= 29) adjustMorale(q, -6);
        }
        adjustMood(me, 2);
        out = "어린 선수들이 눈을 반짝입니다. 고참들의 표정은 굳었지만, 팬들은 이 결정을 좋아했습니다.";
      } else {
        adjustSquadMorale(me, 5);
        adjustMood(me, -3);
        boardAdd(s, -1);
        out = "선수들의 어깨가 조금 가벼워졌습니다. 다만 밖에서는 위기감이 없어 보인다는 말이 나옵니다.";
      }
      break;
    }
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
