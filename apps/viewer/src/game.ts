import { FORMATIONS, INSTRUCTION_IDS, INSTRUCTION_LABEL, ROLES, Rng, TACTIC_PRESETS, autoRoles, normalizeTactics, rolesForSlot, type CornerTarget, type FormationName, type InstructionId, type Match, type PlayerRoleId, type Tactics, type TeamId } from "@3sec/engine";

type SliderKey = "mentality" | "defensiveLine" | "pressing" | "directness" | "width" | "tempo" | "counter" | "engageLine";
import {
  CLUBS, SAVE_KEY, advanceRound, autoSelect, clubOf, createMatch, currentFixtures, deserialize, isAvailable, newGame, nextUserFixture,
  overall, playerOf, prepareRound, recordResult, roundsPerSeason, seasonOver, selectionProblem, serialize, slotFit, startNextSeason,
  swap, table, topScorers, type Club, type Fixture, type GameState, type SquadPlayer,
  MAX_SQUAD, MIN_SQUAD, bestOffer, playerValue, sellPlayer, transferTargets, windowOpen, deadlineDay, makeBid, openOffers, acceptOffer, rejectOffer, respondToCounter,
  freeAgentTerms, signFreeAgent, loanableOut, loanDestination, loanOut, loanTargets, loanIn, type BidResult,
  FOCUS_LABEL, INTENSITY_LABEL, expiringContracts, renewContract, renewalTerms, wageBill, type TrainingFocus, type TrainingIntensity,
  COACHING, LEAVE_AGE, MAX_PROSPECTS, MIN_PROMOTE_AGE, SCOUTING, promoteProspect, prospectOverall, releaseProspect, youthWeeklyCost, type ScoutingTier,
  CUP_NAME, CUP_PRIZE, CUP_ROUNDS, CUP_STAGE_LABEL, advanceCupDay, createCupMatch, cupByes, cupDone, cupFixture, cupPrize, pendingCupTies, recordCupResult,
  tieWinner, userCupStatus, userCupTie, type CupTie,
  marketSummary, homeAwayRecord, financeSummary,
  managerTags, managerOfYear, expectedPositions, type Manager,
  ATTR_LABEL, RATING_MIN_APPS, avgRating, topAssists, topRatings,
  BOARD_FROM_ROUND, TRUST_AT, WARN_BELOW, acceptJob, confidenceBand, jobOffers, userExpectation, userPosition,
  titleClinched,
  MAX_STAFF, STAFF_ROLE_LABEL, ensureStaffMarket, expiringStaff, fireStaff, hireStaff, renewStaff, staffRenewalFee, staffRoomProblem, staffSeverance, staffSigningFee, staffWageBill, type StaffMember,
} from "@3sec/game";
import { celebrate } from "./celebrate";
import type { Attributes } from "@3sec/engine";
import { MatchScreen } from "./match-screen";
import { getSimPool } from "./sim/pool";
import { asMatch, cupJob, leagueJob } from "./sim/adapter";

type ScreenName = "home" | "squad" | "table" | "transfers" | "youth" | "results" | "match" | "guide" | "onboarding" | "review" | "settings" | "profile" | "sacked";
const SLOT_KEY = (n: number) => `3sec.slot.${n}`;
const APP_VERSION = "0.19";

/** One-line character per club for the club picker (indexed like CLUBS). */
const CLUB_BLURBS: string[] = [
  "수도의 명문, 중간 전력에 큰 기대",
  "항구 도시의 자존심, 롱볼과 투지로 버틴다",
  "탄탄한 조직력의 다크호스, 우승 도전 가능",
  "젊은 스쿼드, 스리백으로 도박을 건다",
  "빛고을의 공격 축구, 수비는 불안",
  "재건 중인 구단, 예산이 빠듯하다",
  "빠른 측면 공격, 상위권 단골 후보",
  "리그 최강 전력, 우승이 목표",
  "전통의 강호, 두터운 스쿼드로 타이틀 경쟁",
  "철강 도시의 뚝심, 중위권 안정이 현실적",
  "최약체, 잔류가 목표",
  "신흥 구단, 성장 가능성에 베팅",
];

/**
 * One-line Korean tip on how an AI manager's side will play against mine (the strongest trait speaks;
 * a pragmatist facing a bigger club is expected to sit deep).
 */
export function managerPreview(m: Manager, myClub: Club, opp?: Club): string {
  const t = m.traits;
  if (t.pragmatism > 0.6 && opp && myClub.reputation - opp.reputation >= 1) return "우리를 강팀으로 보고 내려앉아 역습을 노릴 겁니다. 서두르지 말고 폭을 넓게 쓰세요.";
  const cands: { w: number; tip: string }[] = [
    { w: 0.5 - t.possession, tip: "롱볼과 역습을 즐기는 팀입니다. 라인을 너무 올리지 마세요." },
    { w: t.possession - 0.5, tip: "점유율을 가져가려는 팀입니다. 중원을 두껍게 하고 빠른 역습을 노리세요." },
    { w: t.attack - 0.5, tip: "공격적으로 나옵니다. 뒷공간이 열리니 역습과 빠른 공격수가 효과적입니다." },
    { w: 0.5 - t.attack, tip: "내려앉아 수비하는 팀입니다. 폭을 넓히고 크로스와 슈팅을 늘려 인내심 있게 공략하세요." },
    { w: t.pressing - 0.5, tip: "강하게 압박해 옵니다. 직접성을 높여 압박을 벗어나고 후반 체력 저하를 노리세요." },
  ];
  const best = cands.sort((a, b) => b.w - a.w)[0]!;
  return best.w >= 0.15 ? best.tip : "균형 잡힌 팀입니다. 평소 전술로 맞서되 경기 흐름에 따라 조정하세요.";
}

/** Manager name + tags for an opponent line; the user's own club has none. */
const managerLabel = (c: Club): string => c.manager ? `${c.manager.name} 감독${managerTags(c.manager).length ? ` <small>(${managerTags(c.manager).join(" · ")})</small>` : ""}` : "";

/** 1..5 잠재력 stars from the exact potential (≤10 → 1, 17+ → 5). */
const potentialStars = (pot: number): number => (pot >= 17 ? 5 : pot >= 15 ? 4 : pot >= 12.5 ? 3 : pot >= 10 ? 2 : 1);
/** Colour of a match rating / average. */
const ratingColor = (r: number): string => (r >= 7.5 ? "var(--good)" : r >= 6.5 ? "var(--text)" : r >= 5.5 ? "var(--warn)" : "var(--bad)");
const fmtRating = (r: number): string => r.toFixed(1);
/** Attribute groups of the profile screen (goalkeeping shown for keepers only). */
const ATTR_GROUPS: { title: string; keys: (keyof Attributes)[]; gk?: boolean }[] = [
  { title: "기술", keys: ["passing", "vision", "technique", "firstTouch", "dribbling", "finishing", "tackling", "marking"] },
  { title: "정신", keys: ["composure", "decisions", "anticipation", "positioning"] },
  { title: "피지컬", keys: ["pace", "acceleration", "agility", "strength", "stamina"] },
  { title: "골키퍼", keys: ["reflexes", "handling", "gkPositioning"], gk: true },
];
const INFO_BTN = (key: string) => `<button class="info" data-info="${key}" title="선수 프로필" aria-label="선수 프로필">ℹ</button>`;

/** 1..5 전력 stars derived from reputation (10 → 1, 14.5 → 5). */
const clubStars = (rep: number): number => Math.max(1, Math.min(5, Math.round(1 + (rep - 10) / 4.5 * 4)));


const SLIDERS: { key: SliderKey; label: string; lo: string; hi: string }[] = [
  { key: "mentality", label: "멘탈리티", lo: "수비", hi: "공격" },
  { key: "defensiveLine", label: "수비라인", lo: "낮게", hi: "높게" },
  { key: "pressing", label: "프레싱", lo: "약하게", hi: "강하게" },
  { key: "directness", label: "직접성", lo: "짧게", hi: "롱볼" },
  { key: "width", label: "폭", lo: "좁게", hi: "넓게" },
  { key: "tempo", label: "템포", lo: "느리게", hi: "빠르게" },
  { key: "counter", label: "역습", lo: "자제", hi: "적극" },
  { key: "engageLine", label: "압박선", lo: "낮게", hi: "높게" },
];
void (null as unknown as Tactics);

/** Season controller: owns the game state, the screens and the matchday flow. */
export class Game {
  state: GameState;
  private readonly screen: MatchScreen;
  private live: { fixture: Fixture; match: Match; tie?: CupTie }[] | null = null;
  /** what the live matches belong to (decides how they are settled and shown) */
  private liveKind: "league" | "cup" = "league";
  private selA: string | null = null;
  private current: ScreenName = "home";
  private pickedClub: number | null = null;
  /** where the profile screen returns to */
  private profileFrom: ScreenName = "squad";

  private readonly el = {
    home: document.getElementById("home")!,
    squad: document.getElementById("squad")!,
    table: document.getElementById("tableView")!,
    transfers: document.getElementById("transfers")!,
    youth: document.getElementById("youth")!,
    guide: document.getElementById("guide")!,
    settings: document.getElementById("settings")!,
    onboarding: document.getElementById("onboarding")!,
    results: document.getElementById("results")!,
    review: document.getElementById("review")!,
    profile: document.getElementById("profile")!,
    sacked: document.getElementById("sacked")!,
    season: document.getElementById("seasonLabel")!,
    tabMatch: document.getElementById("tabMatch") as HTMLButtonElement,
    overlay: document.getElementById("overlay")!,
    overlayText: document.getElementById("overlayText")!,
    overlayBar: document.getElementById("overlayBar")!,
  };

  constructor() {
    const saved = this.load();
    // Without a save the state is a placeholder until onboarding finishes; nothing of it is shown.
    this.state = saved ?? newGame(Math.floor(Math.random() * 1e6) + 1);
    prepareRound(this.state);
    this.screen = new MatchScreen((work, label) => this.runChunked(work, label));
    for (const b of document.querySelectorAll<HTMLButtonElement>("#nav button.tab")) {
      b.addEventListener("click", () => this.show(b.dataset.screen as ScreenName));
    }
    this.renderGuide();
    if (!saved) {
      this.startOnboarding();
      return;
    }
    this.renderAll();
    this.showFirstScreen();
  }

  /** Guide once for a fresh manager (existing flag), otherwise home. */
  private showFirstScreen(): void {
    let seen = false;
    try { seen = localStorage.getItem("3sec.guide.seen") === "1"; } catch { /* ignore */ }
    if (this.state.board.sacked) { this.renderSacked(); this.show("sacked"); return; }
    if (!seen && this.state.round === 0 && this.state.season === 1) {
      this.show("guide");
      try { localStorage.setItem("3sec.guide.seen", "1"); } catch { /* ignore */ }
    } else this.show("home");
  }

  // ------------------------------------------------------------ onboarding
  private startOnboarding(): void {
    this.pickedClub = null;
    document.body.classList.add("onboarding");
    this.renderOnboarding();
    this.show("onboarding");
  }

  private renderOnboarding(): void {
    const stars = (n: number) => `<span class="stars" title="전력 ${n}/5">${"★".repeat(n)}<i>${"★".repeat(5 - n)}</i></span>`;
    const h: string[] = [];
    h.push(`<div class="card onb-welcome"><h3>환영합니다</h3>
      <div class="onb-title">가난한자의 FM에 오신 것을 환영합니다</div>
      <div class="hint">12개 구단이 22라운드 리그를 치릅니다. 감독 이름을 정하고 이끌 팀을 하나 고르세요. 전력이 강한 팀은 우승을, 약한 팀은 잔류를 목표로 합니다.</div>
      <label style="margin-top:4px">감독 이름 <input id="onbName" type="text" placeholder="감독 이름" maxlength="12" autocomplete="off" /></label>
      <div class="hint">비워두면 "감독"으로 불립니다.</div></div>`);
    h.push(`<div class="card"><h3>팀 선택 <span>카드를 눌러 선택</span></h3><div class="club-grid">`);
    CLUBS.forEach((c, i) => {
      const n = clubStars(c.reputation);
      h.push(`<button type="button" class="club-card${this.pickedClub === i ? " sel" : ""}" data-club="${i}" style="--club:${c.color}">
        <div class="cc-head"><span class="dot" style="background:${c.color}"></span><b>${c.name}</b><small>${c.shortName}</small></div>
        <div class="cc-meta">${stars(n)}<span class="cc-form">${c.formation}</span></div>
        <div class="cc-blurb">${CLUB_BLURBS[i] ?? ""}</div>
      </button>`);
    });
    h.push(`</div></div>`);
    h.push(`<div class="actions onb-actions"><button class="primary" id="onbStart" ${this.pickedClub === null ? "disabled" : ""}>이 팀으로 시작 →</button><span class="hint" id="onbHint">${this.pickedClub === null ? "팀을 먼저 선택하세요." : `${CLUBS[this.pickedClub]!.name} 감독으로 시작합니다.`}</span></div>`);
    this.el.onboarding.innerHTML = h.join("");

    const nameInput = document.getElementById("onbName") as HTMLInputElement;
    const startBtn = document.getElementById("onbStart") as HTMLButtonElement;
    const hint = document.getElementById("onbHint")!;
    this.el.onboarding.querySelectorAll<HTMLButtonElement>(".club-card").forEach((b) => b.addEventListener("click", () => {
      this.pickedClub = Number(b.dataset.club);
      this.el.onboarding.querySelectorAll<HTMLElement>(".club-card").forEach((x) => x.classList.toggle("sel", x === b));
      startBtn.disabled = false;
      hint.textContent = `${CLUBS[this.pickedClub]!.name} 감독으로 시작합니다.`;
    }));
    nameInput.addEventListener("keydown", (e) => { if (e.key === "Enter" && !startBtn.disabled) startBtn.click(); });
    startBtn.addEventListener("click", () => {
      if (this.pickedClub === null) return;
      this.finishOnboarding(this.pickedClub, nameInput.value);
    });
  }

  private finishOnboarding(club: number, name: string): void {
    this.state = newGame(Math.floor(Math.random() * 1e6) + 1, club, name.trim() || "감독");
    prepareRound(this.state);
    this.live = null;
    this.pickedClub = null;
    this.save();
    document.body.classList.remove("onboarding");
    this.renderAll();
    this.showFirstScreen();
  }

  // ------------------------------------------------------------ guide
  private renderGuide(): void {
    const sec = (title: string, body: string, open = false) => `<details ${open ? "open" : ""}><summary>${title}</summary><div class="guide">${body}</div></details>`;
    this.el.guide.innerHTML = `<div class="card guide"><h3>게임 가이드 <span>가난한자의 FM · 만든이 raro</span></h3>
      <p>당신은 12개 구단 리그의 감독입니다. 한 시즌은 홈·원정 22라운드이고, 목표는 우승입니다. 스쿼드를 꾸리고 전술을 정한 뒤 경기를 지휘하고, 이적·훈련·계약으로 팀을 키워 갑니다. 진행은 이 기기에 자동 저장됩니다.</p>
      <div class="actions" style="margin-top:6px"><button class="primary" data-act="start">시작하기 →</button></div></div>
    ${sec("한 라운드의 흐름", `<ul>
      <li><b>홈</b>에서 다음 상대를 확인하고 <b>스쿼드 점검</b>으로 선발을 다듬습니다.</li>
      <li><b>경기 시작</b>을 누르면 라운드의 6경기가 동시에 진행됩니다. 직접 보지 않으려면 <b>라운드 자동 진행</b>으로 결과만 받습니다.</li>
      <li>경기 후 <b>결과 화면</b>에서 <b>다음 라운드로</b>를 누르면 한 주가 지나 컨디션이 회복되고 훈련이 적용되며 연봉이 지급됩니다.</li>
      <li>22라운드가 끝나면 우승팀이 정해지고 <b>다음 시즌 시작</b>으로 이어집니다. 나이·성장·계약 만료가 이때 정산됩니다.</li></ul>`, true)}
    ${sec("스쿼드와 선발", `<ul>
      <li>포메이션을 고르면 <b>자동 선발</b>이 역할 적합도와 컨디션으로 XI와 벤치 7명을 채웁니다.</li>
      <li>선수 두 명을 차례로 누르면 자리를 맞바꿉니다(선발 ↔ 벤치 ↔ 예비). 1번 자리는 골키퍼여야 합니다.</li>
      <li><b>능력</b>은 그 자리에서의 역할 점수(1~20)입니다. 제 포지션이 아니면 괄호로 본래 포지션이 표시되고 점수가 깎입니다.</li>
      <li><b>컨디션</b> 막대가 낮으면 경기 중 빨리 지칩니다. 부상·출장정지 선수는 회색으로 표시되고 출전할 수 없습니다.</li>
      <li>경고 5장 누적이면 1경기, 퇴장은 1~2경기 출장 정지입니다.</li></ul>`)}
    ${sec("전술 슬라이더", `<ul>
      <li><b>멘탈리티</b>: 공격적일수록 슈팅이 늘지만 뒷공간을 내주고 패스 성공률이 떨어집니다.</li>
      <li><b>수비라인</b>: 높이면 상대를 압축하고 오프사이드를 유도하지만 빠른 공격수에게 뒷공간을 허용합니다.</li>
      <li><b>프레싱</b>: 강하면 상대 슈팅이 줄지만 파울과 체력 소모가 늘어납니다.</li>
      <li><b>직접성</b>: 짧게 가면 점유율이 오르고, 롱볼은 빠르게 위협하지만 패스가 자주 끊깁니다.</li>
      <li><b>폭</b>: 넓게 서면 크로스가 늘고, 좁히면 중앙을 두껍게 막습니다.</li>
      <li>스쿼드 탭의 값이 기본 전술이고, 경기 중 바꾼 값은 다음 경기로 이어집니다.</li></ul>`)}
    ${sec("경기 화면", `<ul>
      <li><b>배속</b> 기본값 <span class="kbd">자동</span>은 골문 근처 공방은 천천히, 중원과 중단 시간은 빠르게 흘려 한 경기가 약 9분입니다. <span class="kbd">⏩ 결과로</span>는 남은 시간을 바로 계산합니다.</li>
      <li><b>교체</b>: 오른쪽(또는 ☰ 서랍)에서 나갈 선수와 들어올 선수를 차례로 고르고 <b>교체 예약</b>. 실제 규칙대로 다음 경기 중단 때 들어가며, 최대 5명입니다.</li>
      <li>전술 슬라이더와 포메이션은 경기 중 언제든 바꿀 수 있습니다. 상대는 AI 감독이 점수와 시간에 따라 대응합니다.</li>
      <li>폰을 <b>가로</b>로 돌리면 경기장이 화면을 채우는 몰입 모드가 됩니다. <span class="kbd">⛶ 크게</span>로 직접 켜고 끌 수 있습니다.</li>
      <li>선수를 탭하면 능력치 카드가 보이고, <b>디버그</b>를 켜면 선수 의도와 오프사이드 라인이 표시됩니다.</li></ul>`)}
    ${sec("이적 시장", `<ul>
      <li>창구는 <b>프리시즌(1R 전)</b>, <b>겨울(11~12R 전)</b>, <b>시즌 종료 후</b>에 열립니다.</li>
      <li>선수 가치는 능력과 나이로 정해지고(억원), 상대 구단은 핵심 선수일수록 비싸게 부릅니다. 스쿼드가 16명 이하인 구단은 팔지 않습니다.</li>
      <li>내 선수를 팔면 가장 높은 값을 부른 AI 구단으로 갑니다. 스쿼드는 16~25명을 유지해야 합니다.</li>
      <li>예산은 구단 평판과 시즌 순위 상금으로 채워지고, 연봉이 매주 빠져나갑니다. 적자면 영입이 막힙니다.</li></ul>`)}
    ${sec("훈련·성장·계약", `<ul>
      <li>훈련 <b>초점</b>은 어느 능력치가 먼저 오를지, <b>강도</b>는 성장 속도와 회복·부상 위험을 정합니다.</li>
      <li>어린 선수는 <b>잠재력</b>까지 성장하고, 30세부터 서서히, 33세부터 빠르게 쇠퇴합니다(피지컬부터).</li>
      <li>계약은 시즌 단위입니다. 만료 시즌인 선수는 <b>이적 탭 → 계약</b>에서 재계약하지 않으면 시즌이 끝날 때 떠납니다. 계약금은 가치의 5%×연수입니다.</li></ul>`)}
    ${sec("유스 아카데미", `<ul>
      <li><b>유스</b> 탭의 아카데미에는 시즌 시작과 11라운드 전에 15~18세 유망주가 들어옵니다. 인원은 스카우팅 등급이 정합니다: 없음 1명(평범), 지역 2명, 권역 3명, 전국 4명(잠재력 상한이 높음). 정원은 ${MAX_PROSPECTS}명이고 넘치면 가장 약한 유망주가 나갑니다.</li>
      <li>유망주의 <b>잠재력</b>은 범위(예: 13~17)로만 보이고, 매주 스카우트가 좁혀 갑니다. 등급이 높을수록 빨리 좁혀지고 정기 <b>보고서</b>가 크게 좁힙니다. 하한이 15 이상이면 1군급 재목입니다.</li>
      <li>스카우팅(주 0/0.2/0.5/1.0억)과 코칭(주 0/0.3/0.7억) 비용은 연봉과 함께 매주 예산에서 빠집니다. 코칭 등급이 높을수록 유망주가 빨리 성장합니다.</li>
      <li><b>승격</b>은 ${MIN_PROMOTE_AGE}세부터 가능하며, 3시즌 계약에 연봉은 시세의 절반입니다. ${LEAVE_AGE}세가 되면 승격하지 않은 유망주는 자동으로 떠나므로 18세 유망주는 시즌이 끝나기 전에 결정하세요.</li></ul>`)}
    ${sec(`${CUP_NAME}`, `<ul>
      <li>12개 구단이 겨루는 <b>단판 토너먼트</b>입니다. 1라운드는 평판 상위 4개 구단이 <b>부전승</b>으로 쉬고 8개 구단이 겨루며, 이어서 8강·4강·결승으로 진행됩니다. 대진은 무작위 추첨입니다.</li>
      <li>컵 경기일은 리그 <b>6·11·16·21라운드 뒤</b>에 끼어듭니다. 그날은 홈 화면에 컵 대진이 표시되고, 탈락했거나 부전승이면 <b>컵 라운드 진행</b>으로 다른 경기만 치릅니다.</li>
      <li>90분 무승부면 <b>승부차기</b>로 가립니다. 컵 경기의 경고는 리그 누적에 들어가지 않지만 출장·득점·부상은 그대로 기록됩니다.</li>
      <li>상금: 8강 탈락 ${CUP_PRIZE.qfLoser}억 · 4강 탈락 ${CUP_PRIZE.sfLoser}억 · 준우승 ${CUP_PRIZE.runnerUp}억 · 우승 ${CUP_PRIZE.winner}억. 대진표는 <b>순위</b> 탭 아래에 있습니다.</li>
      <li>마지막 라운드가 끝나면 <b>시즌 결산</b> 화면에서 최종 순위·컵 결과·팀 기록·예산 변화를 돌아보고 다음 시즌을 시작합니다.</li></ul>`)}
    ${sec("상대 감독", `<ul>
      <li>AI 구단마다 성향이 다른 <b>감독</b>이 있습니다. 홈 화면의 다음 경기 카드에 상대 감독의 이름·성향 태그·대응 팁이, 순위표에 감독 이름이 표시됩니다.</li>
      <li>성향 태그: <b>공격적/수비적</b>(멘탈리티·라인·템포), <b>점유 축구/롱볼</b>(직접성·역습), <b>강한 압박</b>, <b>실용주의/이상주의</b>, <b>유스 중시</b>, <b>큰손/짠물</b>, <b>협상 강경</b>, <b>다혈질</b>.</li>
      <li><b>실용주의</b> 감독은 자기보다 강한 팀을 만나면 내려앉아 역습을 노리고, <b>이상주의</b> 감독은 누구를 만나도 자기 축구를 합니다. 공격적인 감독은 풀백을 윙백으로, 수비적인 감독은 앵커와 수비형 윙어를 씁니다.</li>
      <li>이적 시장에서도 성향이 드러납니다. <b>유스 중시</b> 감독은 21세 이하 유망주를 1.6배 값이 아니면 팔지 않고 24세 이하만 영입하며, <b>큰손</b>은 시세보다 높은 제안을 하고, <b>짠물</b>은 잘 사지 않는 대신 잉여 자원을 싸게 넘기고, <b>협상 강경</b>은 역제안을 잘 받지 않습니다.</li>
      <li>이사회는 8라운드부터 매주 <b>평판 순 기대 순위</b>와 실제 순위를 비교합니다. 기대보다 4계단 이상 아래에 6주 연속 머물면 감독이 경질될 수 있고, 시즌 종료 시에도 같은 기준으로 판단합니다. 경질된 감독은 다른 구단이 다시 데려가기도 합니다.</li>
      <li>시즌 결산에서 기대 순위를 가장 크게 넘어선 감독이 <b>올해의 감독</b>이 됩니다. 당신도 후보입니다.</li></ul>`)}
    ${sec("이사회·평점·프로필", `<ul>
      <li>홈 화면의 <b>이사회 신뢰도</b>(0~100, 시작 60)는 ${BOARD_FROM_ROUND}라운드부터 매주 움직입니다. 목표치는 <b>평판 순 기대 순위</b>와 실제 순위의 차이(한 계단 7점)와 최근 5경기 승점으로 정해지고, 매주 그 차이의 1/4만큼 다가갑니다. 컵에서 이기면 +5.</li>
      <li>신뢰도가 ${WARN_BELOW} 아래로 3주 연속이면 <b>이사회 경고</b>, 경고 뒤 다시 3주 연속 아래이고 15 미만이면 <b>경질</b>됩니다. 시즌이 끝날 때 ${TRUST_AT} 이상이면 신임을, 35 미만이면 역시 경질을 통보받습니다. 경질되면 감독 자리가 빈 구단이나 압박이 큰 구단 두 곳에서 제안이 오고, 받아들이면 그 팀의 감독이 됩니다.</li>
      <li>선수마다 경기 <b>평점</b>(3.0~10.0)이 매겨집니다: 기본 6.0, 골 +1.0(자책 −1.0), 도움 +0.7, 60분 이상 뛴 GK·수비수의 무실점 +0.4, GK는 3개 넘는 선방마다 +0.2, 경고 −0.3, 퇴장 −1.0, 승리 +0.3/패배 −0.3. 30분 미만 교체 출전은 6.0 쪽으로 반만 반영됩니다. 경기 최고 평점은 <b>MOTM</b>이 되고, 순위 탭에 도움·평점(${RATING_MIN_APPS}경기 이상) 순위가 있습니다.</li>
      <li>스쿼드·이적 목록의 <b>ℹ</b> 버튼을 누르면 <b>선수 프로필</b>이 열립니다: 능력치 그래프, 시즌 기록, 최근 5경기 평점, 시즌별 경력이 보입니다. 잠재력은 ★ 1~5로 표시됩니다.</li></ul>`)}
    ${sec("팁", `<ul>
      <li>전력이 약하면 수비라인을 낮추고 직접성을 높여 역습을 노리세요. 강하면 높은 라인과 강한 프레싱이 유리합니다.</li>
      <li>60분 이후 컨디션이 40% 아래인 선수는 교체하세요. 피로는 다음 경기 시작 컨디션에도 남습니다.</li>
      <li>겨울 창구 전에 예산을 아껴 두면 시즌 후반 보강이 가능합니다. 23세 이하 잠재력 높은 선수는 값이 오릅니다.</li>
      <li>홈 화면의 <b>새 게임</b>은 저장을 지우고 새 시드로 시작합니다.</li></ul>`)}`;
    this.el.guide.querySelector<HTMLButtonElement>('button[data-act="start"]')!.addEventListener("click", () => this.show("home"));
  }

  // ------------------------------------------------------------ persistence
  private load(): GameState | null {
    try {
      return deserialize(localStorage.getItem(SAVE_KEY));
    } catch {
      return null;
    }
  }
  private save(): void {
    try {
      localStorage.setItem(SAVE_KEY, serialize(this.state));
    } catch {
      /* private mode etc. – the session still works, it just will not persist */
    }
  }

  // ------------------------------------------------------------ navigation
  private show(name: ScreenName): void {
    if (this.current === "match" && name !== "match") this.screen.leave();
    this.current = name;
    for (const s of document.querySelectorAll<HTMLElement>(".screen")) s.classList.toggle("active", s.id === `screen-${name}`);
    for (const b of document.querySelectorAll<HTMLButtonElement>("#nav button.tab")) b.classList.toggle("active", b.dataset.screen === name);
    window.dispatchEvent(new Event("resize"));
  }

  private renderAll(): void {
    const s = this.state;
    this.el.season.textContent = `${s.managerName} 감독 · 시즌 ${s.season} · ${s.pendingCupDay && !seasonOver(s) ? `컵 ${CUP_STAGE_LABEL[s.cup.stage] ?? ""}` : `${Math.min(s.round + 1, roundsPerSeason(s.clubs.length))}/${roundsPerSeason(s.clubs.length)}R`}`;
    this.el.tabMatch.disabled = !this.live;
    this.renderHome();
    this.renderSquad();
    this.renderTable();
    this.renderTransfers();
    this.renderYouth();
    this.renderSettings();
  }
  // ------------------------------------------------------------ settings (new game / save / load)
  private slotInfo(n: number): { savedAt: string; label: string; data: string } | null {
    try {
      const raw = localStorage.getItem(SLOT_KEY(n));
      return raw ? (JSON.parse(raw) as { savedAt: string; label: string; data: string }) : null;
    } catch {
      return null;
    }
  }

  private stateLabel(st: GameState = this.state): string {
    const c = st.clubs[st.userClub]!;
    return `${st.managerName} 감독 · ${c.name} · 시즌 ${st.season} ${Math.min(st.round + 1, roundsPerSeason(st.clubs.length))}R`;
  }

  private applyLoaded(st: GameState, source: string): void {
    this.state = st;
    prepareRound(this.state);
    this.live = null;
    this.save();
    this.renderAll();
    this.show("home");
    alert(`${source}에서 불러왔습니다: ${this.stateLabel(st)}`);
  }

  private renderSettings(): void {
    const s = this.state;
    const slots = [1, 2, 3].map((n) => ({ n, info: this.slotInfo(n) }));
    this.el.settings.innerHTML = `<div class="card"><h3>설정 <span>가난한자의 FM v${APP_VERSION} · 만든이 raro</span></h3>
      <div class="hint">현재 게임: <b>${this.stateLabel()}</b> — 진행 상황은 매 조작마다 자동 저장됩니다. 아래 슬롯은 별도 백업이고, 파일로 내보내면 다른 기기로 옮길 수 있습니다.</div>
      <div class="actions" style="margin-top:6px"><button data-set="guide">게임 가이드 보기</button><button class="danger" data-set="newGame">새 게임 시작</button></div></div>
    <div class="card"><h3>저장 슬롯</h3>${slots
      .map(({ n, info }) => `<div class="slot"><div><div>슬롯 ${n}</div><div class="meta">${info ? `${info.label}<br>${new Date(info.savedAt).toLocaleString("ko-KR")}` : "비어 있음"}</div></div>
        <div class="btns"><button data-slot-save="${n}">저장</button><button data-slot-load="${n}" ${info ? "" : "disabled"}>불러오기</button><button class="danger" data-slot-del="${n}" ${info ? "" : "disabled"}>삭제</button></div></div>`)
      .join("")}</div>
    <div class="card"><h3>파일로 저장 / 불러오기 <span>기기 간 이동</span></h3>
      <div class="actions"><button data-set="export">파일로 내보내기</button><button data-set="share">공유하기</button><button data-set="copy">텍스트 복사</button><label style="cursor:pointer"><input type="file" id="setImportFile" accept=".json,application/json,text/plain" style="display:none"><span style="border:1px solid #2c3d4b;border-radius:6px;padding:6px 10px;background:#1a2530;color:var(--text)">파일에서 불러오기</span></label></div>
      <div class="hint" style="margin-top:6px">붙여넣기로 불러오기: 저장 텍스트를 아래에 붙여 넣고 버튼을 누르세요.</div>
      <textarea id="setImportText" placeholder='{"version":1, ...}'></textarea>
      <div class="actions"><button data-set="importText">텍스트에서 불러오기</button></div></div>
    <div class="card"><h3>데이터</h3><div class="actions"><button class="danger" data-set="wipe">모든 데이터 초기화</button></div><div class="hint">자동 저장과 슬롯을 모두 지우고 처음 화면으로 돌아갑니다.</div></div>`;

    const q = (sel: string) => this.el.settings.querySelector<HTMLElement>(sel)!;
    // The claude.ai artifact viewer blocks page-initiated downloads; there the share/copy paths remain.
    if (location.hostname.endsWith("claude.ai")) q('[data-set="export"]').style.display = "none";
    q('[data-set="guide"]').addEventListener("click", () => this.show("guide"));
    q('[data-set="newGame"]').addEventListener("click", () => this.act("newGame"));
    for (const { n } of slots) {
      this.el.settings.querySelector(`[data-slot-save="${n}"]`)!.addEventListener("click", () => {
        const existing = this.slotInfo(n);
        if (existing && !confirm(`슬롯 ${n}(${existing.label})을 덮어쓸까요?`)) return;
        try {
          localStorage.setItem(SLOT_KEY(n), JSON.stringify({ savedAt: new Date().toISOString(), label: this.stateLabel(), data: serialize(s) }));
        } catch {
          alert("저장 공간이 부족합니다.");
        }
        this.renderSettings();
      });
      this.el.settings.querySelector(`[data-slot-load="${n}"]`)!.addEventListener("click", () => {
        const info = this.slotInfo(n);
        if (!info) return;
        if (this.live && !confirm("진행 중인 경기가 있습니다. 불러오면 그 경기는 사라집니다. 계속할까요?")) return;
        const st = deserialize(info.data);
        if (!st) { alert("슬롯 데이터가 손상되었습니다."); return; }
        this.applyLoaded(st, `슬롯 ${n}`);
      });
      this.el.settings.querySelector(`[data-slot-del="${n}"]`)!.addEventListener("click", () => {
        if (!confirm(`슬롯 ${n}을 삭제할까요?`)) return;
        try { localStorage.removeItem(SLOT_KEY(n)); } catch { /* ignore */ }
        this.renderSettings();
      });
    }
    const fileName = () => `gananhanja-fm-s${s.season}-r${s.round + 1}.json`;
    q('[data-set="export"]').addEventListener("click", () => {
      const blob = new Blob([serialize(s)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = fileName(); document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    });
    q('[data-set="share"]').addEventListener("click", async () => {
      const nav = navigator as Navigator & { share?: (d: { files?: File[]; title?: string; text?: string }) => Promise<void>; canShare?: (d: { files?: File[] }) => boolean };
      try {
        const file = new File([serialize(s)], fileName(), { type: "application/json" });
        if (nav.share && (!nav.canShare || nav.canShare({ files: [file] }))) await nav.share({ files: [file], title: "가난한자의 FM 저장" });
        else if (nav.share) await nav.share({ title: "가난한자의 FM 저장", text: serialize(s) });
        else alert("이 기기는 공유를 지원하지 않습니다. '텍스트 복사'를 사용하세요.");
      } catch { /* cancelled */ }
    });
    q('[data-set="copy"]').addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(serialize(s)); alert("저장 텍스트를 복사했습니다. 메모장이나 메신저에 붙여 두세요."); }
      catch { (document.getElementById("setImportText") as HTMLTextAreaElement).value = serialize(s); alert("아래 상자에 저장 텍스트를 채웠습니다. 길게 눌러 복사하세요."); }
    });
    (document.getElementById("setImportFile") as HTMLInputElement).addEventListener("change", async (e) => {
      const f = (e.target as HTMLInputElement).files?.[0];
      if (!f) return;
      const st = deserialize(await f.text());
      if (!st) { alert("저장 파일을 읽을 수 없습니다."); return; }
      if (!confirm(`${this.stateLabel(st)} 을(를) 불러올까요? 현재 게임은 덮어쓰입니다.`)) return;
      this.applyLoaded(st, "파일");
    });
    q('[data-set="importText"]').addEventListener("click", () => {
      const st = deserialize((document.getElementById("setImportText") as HTMLTextAreaElement).value.trim());
      if (!st) { alert("저장 텍스트를 읽을 수 없습니다."); return; }
      if (!confirm(`${this.stateLabel(st)} 을(를) 불러올까요? 현재 게임은 덮어쓰입니다.`)) return;
      this.applyLoaded(st, "텍스트");
    });
    q('[data-set="wipe"]').addEventListener("click", () => {
      if (!confirm("자동 저장과 슬롯을 모두 지웁니다. 정말 초기화할까요?")) return;
      try { localStorage.removeItem(SAVE_KEY); [1, 2, 3].forEach((n) => localStorage.removeItem(SLOT_KEY(n))); localStorage.removeItem("3sec.guide.seen"); } catch { /* ignore */ }
      location.reload();
    });
  }


  private get me(): Club {
    return clubOf(this.state, this.state.userClub);
  }

  // ------------------------------------------------------------ home
  private renderHome(): void {
    const s = this.state;
    const me = this.me;
    const rows = table(s);
    const pos = rows.findIndex((r) => r.club === me.id) + 1;
    const fx = nextUserFixture(s);
    const over = seasonOver(s);
    const h: string[] = [];
    h.push(`<div class="card"><h3>${me.name} <span class="mgr">감독 ${s.managerName}</span><span>${over ? "시즌 종료" : `${pos}위 · ${rows[pos - 1]!.pts}점`} · 예산 ${me.budget}억 · 연봉 ${wageBill(me)}억/시즌${windowOpen(s) ? ' · <b style="color:var(--good)">이적시장 열림</b>' : ""}</span></h3>`);
    const expiring = expiringContracts(s);
    if (expiring.length && s.round >= 12 && !over) h.push(`<div class="hint" style="color:var(--warn)">이번 시즌 계약 만료 ${expiring.length}명 (${expiring.slice(0, 3).map((p) => p.name).join(", ")}${expiring.length > 3 ? " 외" : ""}) — 이적 탭에서 재계약하지 않으면 시즌 후 떠납니다.</div>`);
    const offerCount = openOffers(s).length;
    if (offerCount) h.push(`<div class="hint" style="color:var(--accent)">받은 이적 제안 ${offerCount}건 — 이적 탭에서 수락·거절·역제안할 수 있습니다 (2라운드 후 만료).</div>`);
    if (me.budget < 0) h.push(`<div class="hint" style="color:var(--bad)">예산이 적자입니다. 연봉이 매주 빠져나가니 선수를 팔거나 다음 시즌 상금을 기다려야 합니다.</div>`);
    h.push(this.boardHtml());
    if (s.board.sacked) {
      h.push(`<div class="hint" style="color:var(--bad)"><b>경질되었습니다.</b> ${me.name} 이사회가 계약을 해지했습니다. 다른 구단의 제안을 받거나 새 게임을 시작하세요.</div><div class="actions"><button class="primary" data-act="sacked">거취 정하기 →</button></div>`);
    } else if (this.live) {
      h.push(`<div class="hint">경기가 진행 중입니다.</div><div class="actions"><button class="primary" data-act="toMatch">경기로 돌아가기</button></div>`);
    } else if (over) {
      const champ = clubOf(s, rows[0]!.club);
      h.push(`<div class="hint">시즌 ${s.season} 최종 순위 ${pos}위. 우승: <b style="color:var(--accent)">${champ.name}</b>${s.cup.holder !== undefined ? ` · ${CUP_NAME} 우승: <b>${clubOf(s, s.cup.holder).name}</b>` : ""}</div>`);
      h.push(`<div class="actions"><button class="primary" data-act="review">시즌 결산 보기</button><button data-act="nextSeason">다음 시즌 시작 →</button></div>`);
    } else if (s.pendingCupDay) {
      const tie = userCupTie(s);
      const stage = CUP_STAGE_LABEL[s.cup.stage] ?? "";
      if (tie) {
        const home = clubOf(s, tie.home), away = clubOf(s, tie.away);
        h.push(`<div class="fixture cup">
          <div class="team"><span class="dot" style="background:${home.color}"></span>${home.name}<small>${tie.home === me.id ? "홈" : "상대"} · 최근 ${this.form(home.id)}</small></div>
          <div class="vs"><span class="cupTag">${CUP_NAME}</span>${stage}<b>vs</b></div>
          <div class="team r">${away.name}<span class="dot" style="background:${away.color};margin:0 0 0 6px"></span><small>${tie.away === me.id ? "원정" : "상대"} · 최근 ${this.form(away.id)}</small></div>
        </div>`);
        h.push(this.opponentHtml(clubOf(s, tie.home === me.id ? tie.away : tie.home)));
        const prob = selectionProblem(me);
        if (prob) h.push(`<div class="hint" style="color:var(--warn)">선발 문제: ${prob} — 스쿼드에서 조정하거나 자동으로 보정됩니다.</div>`);
        h.push(`<div class="actions"><button data-act="squad">스쿼드 점검</button><button class="primary" data-act="play">경기 시작 ▶</button><button data-act="cupSim" title="이번 컵 라운드의 모든 경기를 즉시 시뮬레이션합니다">⏩ 자동 진행</button></div>
        <div class="hint">단판 토너먼트입니다. 90분 무승부면 승부차기로 가립니다. 컵 경고는 리그 누적에 들어가지 않습니다. 상금: 8강 탈락 ${CUP_PRIZE.qfLoser}억 · 4강 탈락 ${CUP_PRIZE.sfLoser}억 · 준우승 ${CUP_PRIZE.runnerUp}억 · 우승 ${CUP_PRIZE.winner}억.</div>`);
      } else {
        const st = userCupStatus(s);
        h.push(`<div class="fixture cup"><div class="team"><span class="cupTag">${CUP_NAME}</span> ${stage}<small>${st === "bye" ? "우리 팀은 부전승으로 8강에 직행합니다." : "우리 팀은 이미 탈락했습니다. 다른 팀들의 경기가 진행됩니다."}</small></div></div>`);
        h.push(`<div class="actions"><button class="primary" data-act="cupSim">컵 라운드 진행 ⏩</button></div>`);
      }
    } else if (fx) {
      const home = clubOf(s, fx.home), away = clubOf(s, fx.away);
      const oppId = fx.home === me.id ? fx.away : fx.home;
      const oppPos = rows.findIndex((r) => r.club === oppId) + 1;
      const form = (c: Club) => this.form(c.id);
      h.push(`<div class="fixture">
        <div class="team"><span class="dot" style="background:${home.color}"></span>${home.name}<small>${fx.home === me.id ? "홈" : `${oppPos}위`} · 최근 ${form(home)}</small></div>
        <div class="vs">R${fx.round + 1}<b>vs</b></div>
        <div class="team r">${away.name}<span class="dot" style="background:${away.color};margin:0 0 0 6px"></span><small>${fx.away === me.id ? "원정" : `${oppPos}위`} · 최근 ${form(away)}</small></div>
      </div>`);
      h.push(this.opponentHtml(clubOf(s, oppId)));
      const prob = selectionProblem(me);
      if (prob) h.push(`<div class="hint" style="color:var(--warn)">선발 문제: ${prob} — 스쿼드에서 조정하거나 자동으로 보정됩니다.</div>`);
      h.push(`<div class="actions"><button data-act="squad">스쿼드 점검</button><button class="primary" data-act="play">경기 시작 ▶</button><span style="display:inline-flex;gap:4px;align-items:center"><button data-act="sim1" title="이번 라운드의 모든 경기를 즉시 시뮬레이션합니다">⏩ 1라운드</button><button data-act="sim3" title="3라운드를 연속 시뮬레이션합니다 (내 경기 포함)">⏩ 3라운드</button><button data-act="sim5" title="5라운드를 연속 시뮬레이션합니다 (내 경기 포함)">⏩ 5라운드</button></span></div>
      <div class="hint">자동 진행은 내 경기도 AI가 지휘합니다. 여러 라운드를 돌리면 매 라운드 사이에 회복·훈련·연봉이 정산되고 마지막 라운드 결과가 표시됩니다.</div>`);
    }
    if (!over) h.push(`<div class="cupLine">${this.cupLineHtml()}</div>`);
    h.push(`</div>`);
    h.push(`<div class="grid2">`);
    h.push(`<div class="card"><h3>소식</h3><div class="news">${s.news.slice(0, 10).map((n) => `<div>${n}</div>`).join("") || "<div>아직 소식이 없습니다.</div>"}</div></div>`);
    h.push(`<div class="card"><h3>순위 <span>상위 6</span></h3>${this.tableHtml(rows.slice(0, 6), true)}</div>`);
    h.push(`</div>`);
    h.push(`<div class="actions"><button class="danger" data-act="newGame">새 게임</button><span class="hint">진행 상황은 이 브라우저에 자동 저장됩니다. · 가난한자의 FM · 만든이 raro</span></div>`);
    this.el.home.innerHTML = h.join("");
    this.el.home.querySelectorAll<HTMLButtonElement>("button[data-act]").forEach((b) => b.addEventListener("click", () => this.act(b.dataset.act!)));
  }

  /** Compact board-confidence strip for the home card: value, expectation vs position, warnings. */
  private boardHtml(): string {
    const s = this.state;
    const b = s.board;
    const band = confidenceBand(b.confidence);
    const color = band === "good" ? "var(--good)" : band === "ok" ? "var(--accent)" : band === "warn" ? "var(--warn)" : "var(--bad)";
    const exp = userExpectation(s), pos = userPosition(s);
    const note = b.sacked ? "경질" : b.warnings ? `경고 ${b.warnings}회` : b.confidence >= TRUST_AT ? "신임" : b.confidence < WARN_BELOW ? "위험" : s.round < BOARD_FROM_ROUND ? `${BOARD_FROM_ROUND}R부터 평가` : "보통";
    return `<div class="board"><div class="boardHead"><span>이사회 신뢰도 <b style="color:${color}">${Math.round(b.confidence)}</b></span><small>기대 ${exp}위 · 현재 ${pos}위 · <span style="color:${color}">${note}</span></small></div>
      <div class="bar" title="이사회 신뢰도 ${b.confidence}/100"><i style="width:${Math.round(b.confidence)}%;background:${color}"></i></div></div>`;
  }

  /** The opposing manager on the next-fixture card: name, tags and a one-line tip. */
  private opponentHtml(opp: Club): string {
    const m = opp.manager;
    if (!m) return "";
    const since = m.since < this.state.season ? ` · ${this.state.season - m.since}시즌째` : " · 부임 첫 시즌";
    return `<div class="hint">상대 감독 <b>${m.name}</b>${managerTags(m).length ? ` <span style="color:var(--accent)">${managerTags(m).join(" · ")}</span>` : ""}${since} — ${managerPreview(m, this.me, opp)}</div>`;
  }

  /** One-line cup status for the home card: next stage and the user's tie / 탈락 / 부전승. */
  private cupLineHtml(): string {
    const s = this.state;
    const me = s.userClub;
    if (cupDone(s)) return `<b>${CUP_NAME}</b> 종료 · 우승 ${s.cup.holder !== undefined ? clubOf(s, s.cup.holder).name : "—"}`;
    const stage = CUP_STAGE_LABEL[s.cup.stage] ?? "";
    const when = s.pendingCupDay ? "오늘" : s.round < CUP_ROUNDS[s.cup.stage]! ? `${CUP_ROUNDS[s.cup.stage]}R 후` : "다음 경기일";
    const st = userCupStatus(s);
    const tie = userCupTie(s);
    let mine: string;
    if (tie) {
      const opp = clubOf(s, tie.home === me ? tie.away : tie.home);
      mine = `vs ${opp.name} (${tie.home === me ? "홈" : "원정"})`;
    } else mine = st === "bye" ? "부전승 (8강 직행)" : st === "out" ? '<span style="color:var(--bad)">탈락</span>' : "대진 미정";
    return `<b>${CUP_NAME}</b> ${stage} · ${when} · ${mine}`;
  }

  private form(club: number): string {
    const s = this.state;
    const played = s.fixtures.filter((f) => f.score && (f.home === club || f.away === club)).slice(-5);
    if (!played.length) return "—";
    return played
      .map((f) => {
        const [hg, ag] = f.score!;
        const mine = f.home === club ? hg : ag, theirs = f.home === club ? ag : hg;
        return mine > theirs ? "승" : mine < theirs ? "패" : "무";
      })
      .join("");
  }

  private act(a: string): void {
    switch (a) {
      case "squad": this.show("squad"); break;
      case "play": this.startMatch(); break;
      case "sim1": void this.simRounds(1); break;
      case "sim3": void this.simRounds(3); break;
      case "sim5": void this.simRounds(5); break;
      case "toMatch": this.show("match"); break;
      case "cupSim": void this.simRounds(1); break;
      case "review": this.renderReview(); this.show("review"); break;
      case "sacked": this.renderSacked(); this.show("sacked"); break;
      case "nextSeason": startNextSeason(this.state); this.save(); this.renderAll(); this.afterAdvance("home"); break;
      case "newGame":
        if (confirm("현재 진행 상황을 지우고 새 게임을 시작할까요?")) {
          if (this.current === "match") this.screen.leave();
          this.live = null;
          this.startOnboarding();
        }
        break;
    }
  }

  /** After a week or a rollover: the sacked screen if the board acted, otherwise the given screen. */
  private afterAdvance(next: ScreenName): void {
    if (this.state.board.sacked) { this.renderSacked(); this.show("sacked"); } else this.show(next);
  }

  // ------------------------------------------------------------ sacked: job offers or a new game
  private renderSacked(): void {
    const s = this.state;
    const me = this.me;
    const rec = s.board.sacked;
    if (!rec) { this.el.sacked.innerHTML = ""; return; }
    const rows = table(s);
    const posOf = new Map(rows.map((r, i) => [r.club, i + 1]));
    const when = rec.reason === "rollover" ? `시즌 ${rec.season} 종료 후` : `시즌 ${rec.season} ${rec.round}라운드 후`;
    const offers = jobOffers(s);
    const stars = (n: number) => `<span class="stars">${"★".repeat(n)}<i>${"★".repeat(5 - n)}</i></span>`;
    const h: string[] = [];
    h.push(`<div class="card review"><h3>경질 <span class="mgr">감독 ${s.managerName}</span><span>${me.name}</span></h3>
      <div class="rvTitle" style="color:var(--bad)">경질 <small>${when}</small></div>
      <div class="hint">${me.name} 이사회가 ${s.managerName} 감독과의 계약을 해지했습니다. ${rec.reason === "rollover" ? "시즌 결산에서 신뢰도가 35 아래였습니다." : "두 번째 경고와 함께 신뢰도가 15 아래로 떨어졌습니다."}</div>
      <div class="stats">
        <div class="stat"><small>당시 순위</small><b>${rec.position}위 <small>/ ${s.clubs.length}팀 · ${rec.pts}점</small></b></div>
        <div class="stat"><small>이사회 기대</small><b>${rec.expected}위</b></div>
        <div class="stat"><small>신뢰도</small><b style="color:var(--bad)">${Math.round(s.board.confidence)}</b></div>
        <div class="stat"><small>경고</small><b>${s.board.warnings}회</b></div>
        <div class="stat"><small>역대 시즌</small><b>${s.seasonHistory.length ? s.seasonHistory.map((r) => `S${r.season} ${r.userPosition}위`).join(" · ") : "—"}</b></div>
      </div>
      <div class="actions" style="margin-top:8px"><button class="primary" id="skOffers">다른 구단 제안 받기</button><button class="danger" data-act="newGame">새 게임</button></div></div>`);
    h.push(`<div class="card" id="skOfferList" hidden><h3>감독 제안 <span>${offers.length}곳</span></h3>
      <div class="hint">감독 자리가 비었거나 이사회 압박이 큰 구단들이 연락해 왔습니다. 수락하면 그 구단의 감독이 되고, 신뢰도 55에서 새로 시작합니다.</div>
      ${offers.length ? offers.map((c) => `<div class="offer"><div class="of-main"><b><span class="dot" style="background:${c.color}"></span>${c.name}</b> <span class="role">${posOf.get(c.id)}위 · 예산 ${c.budget}억 · 전력 ${stars(clubStars(c.reputation))}</span>
          <div class="hint">${c.manager ? `${c.manager.name} 감독 경질 예정 · 이사회 압박 ${c.pressure ?? 0}` : "감독 공석"} · 스쿼드 ${c.squad.length}명</div></div>
        <div class="of-acts"><button class="primary" data-job="${c.id}">수락</button></div></div>`).join("") : '<div class="hint">지금은 제안이 없습니다.</div>'}</div>`);
    this.el.sacked.innerHTML = h.join("");
    document.getElementById("skOffers")!.addEventListener("click", () => { const l = document.getElementById("skOfferList")!; l.hidden = false; l.scrollIntoView({ behavior: "smooth", block: "start" }); });
    this.el.sacked.querySelector<HTMLButtonElement>('button[data-act="newGame"]')!.addEventListener("click", () => this.act("newGame"));
    this.el.sacked.querySelectorAll<HTMLButtonElement>("button[data-job]").forEach((b) => b.addEventListener("click", () => {
      const c = clubOf(s, Number(b.dataset.job));
      if (!confirm(`${c.name}의 감독직을 수락할까요?`)) return;
      const err = acceptJob(s, c.id);
      if (err) { alert(err); return; }
      prepareRound(s);
      this.selA = null;
      this.pendingBid = null;
      this.save();
      this.renderAll();
      this.show("home");
    }));
  }

  // ------------------------------------------------------------ player profile
  private openProfile(p: SquadPlayer, club: Club | null, from: ScreenName): void {
    this.profileFrom = from;
    this.renderProfile(p, club);
    this.show("profile");
  }

  /** Resolve a `club:player` info key (club -1 = free agent) and open the profile. */
  private wireInfo(root: HTMLElement, from: ScreenName): void {
    root.querySelectorAll<HTMLButtonElement>("button[data-info]").forEach((b) => b.addEventListener("click", (e) => {
      e.stopPropagation();
      const [c, id] = b.dataset.info!.split(":");
      const clubId = Number(c);
      const club = clubId >= 0 ? clubOf(this.state, clubId) : null;
      const p = club ? club.squad.find((x) => x.id === id) : this.state.freeAgents.find((x) => x.id === id);
      if (p) this.openProfile(p, club, from);
    }));
  }

  private renderProfile(p: SquadPlayer, club: Club | null): void {
    const s = this.state;
    const ovr = overall(p.attrs, p.role);
    const stars = potentialStars(p.potential);
    const st = p.stats;
    const avg = avgRating(p);
    const loan = s.loans.find((x) => x.playerId === p.id);
    const status = p.onLoan ? `임대 중${loan ? ` (→ ${clubOf(s, loan.to).shortName})` : ""}` : p.loanFrom !== undefined ? `임대 (${clubOf(s, p.loanFrom).shortName} 소속)` : p.injuryDays > 0 ? `부상 · 약 ${p.injuryDays}일 결장` : p.ban > 0 ? `출장 정지 ${p.ban}경기` : p.seasonYellows % 5 === 4 ? "경고 누적 4장 (1장 더 받으면 정지)" : "출전 가능";
    const statusColor = p.injuryDays > 0 || p.ban > 0 ? "var(--bad)" : p.onLoan || p.loanFrom !== undefined ? "var(--warn)" : "var(--good)";
    const cond = Math.round(p.condition * 100);
    const attrColor = (v: number) => (v >= 15 ? "var(--good)" : v >= 11 ? "var(--accent)" : v >= 8 ? "var(--muted)" : "var(--bad)");
    const groups = ATTR_GROUPS.filter((g) => !g.gk || p.role === "GK").map((g) => `<div class="attrGroup"><h4>${g.title}</h4>${g.keys.map((k) => { const v = p.attrs[k]; return `<div class="attr"><span>${ATTR_LABEL[k]}</span><span class="bar"><i style="width:${v * 5}%;background:${attrColor(v)}"></i></span><b>${v}</b></div>`; }).join("")}</div>`).join("");
    const form = p.form ?? [];
    const chips = form.length ? form.map((r) => `<span class="chip" style="background:${ratingColor(r)}">${fmtRating(r)}</span>`).join("") : '<span class="hint">아직 출전 기록이 없습니다.</span>';
    const stat = (label: string, value: string) => `<div class="stat"><small>${label}</small><b>${value}</b></div>`;
    const career = p.career ?? [];
    const h: string[] = [];
    h.push(`<div class="card profile"><div class="actions"><button id="pfBack">← 돌아가기</button></div>
      <div class="pfHead"><div class="pfNum">${p.number}</div><div class="pfMain"><div class="pfName">${p.name}</div>
        <div class="hint">${p.role} · ${p.age}세 · ${club ? `<span class="dot" style="background:${club.color}"></span>${club.name}` : "자유계약"}${club && club.id !== s.userClub ? ' <small style="opacity:.7">(타 구단)</small>' : ""}</div></div>
        <div class="pfOvr"><b style="color:${ovr >= 14 ? "var(--good)" : ovr >= 11 ? "var(--text)" : "var(--warn)"}">${ovr.toFixed(1)}</b><small>능력</small></div></div>
      <div class="stats">
        ${stat("잠재력", `<span class="stars" title="잠재력 ${stars}/5">${"★".repeat(stars)}<i>${"★".repeat(5 - stars)}</i></span>`)}
        ${stat("가치", `${playerValue(p)}억`)}
        ${stat("연봉", `${p.wage}억/시즌`)}
        ${stat("계약", `~시즌 ${p.contractUntil}${p.contractUntil <= s.season ? ' <small style="color:var(--warn)">만료 예정</small>' : ""}`)}
        ${stat("컨디션", `<span class="bar" style="display:inline-block;width:70px;vertical-align:middle;margin-right:6px"><i style="width:${cond}%;background:${cond > 70 ? "var(--good)" : cond > 45 ? "var(--warn)" : "var(--bad)"}"></i></span>${cond}%`)}
        ${stat("상태", `<span style="color:${statusColor}">${status}</span>`)}
      </div></div>`);
    h.push(`<div class="grid2">`);
    h.push(`<div class="card"><h3>능력치 <span>1~20</span></h3><div class="attrs">${groups}</div></div>`);
    h.push(`<div class="card"><h3>시즌 ${s.season} 기록</h3><div class="stats">
        ${stat("출장", `${st.apps}경기 <small>${st.minutes}분</small>`)}
        ${stat("골 / 도움", `${st.goals} / ${st.assists ?? 0}`)}
        ${stat("평균 평점", avg ? `<span style="color:${ratingColor(avg)}">${fmtRating(avg)}</span> <small>${st.ratedApps ?? 0}경기</small>` : "—")}
        ${stat("MOTM", `${st.motm ?? 0}회`)}
        ${stat("경고 / 퇴장", `${st.yellows} / ${st.reds}`)}
        ${stat("리그 경고 누적", `${p.seasonYellows}장`)}
      </div>
      <h3 style="margin-top:10px">최근 5경기 평점</h3><div class="chips">${chips}</div>
      <h3 style="margin-top:10px">경력</h3>${career.length ? `<table class="std"><thead><tr><th>시즌</th><th class="l">클럽</th><th>출장</th><th>골</th><th>도움</th><th>평점</th></tr></thead><tbody>${[...career].reverse().map((c) => `<tr><td>S${c.season}</td><td class="l">${s.clubs[c.club]?.shortName ?? "?"}</td><td>${c.apps}</td><td>${c.goals}</td><td>${c.assists}</td><td style="color:${c.rating ? ratingColor(c.rating) : "var(--muted)"}">${c.rating ? fmtRating(c.rating) : "—"}</td></tr>`).join("")}</tbody></table>` : '<div class="hint">아직 마친 시즌이 없습니다.</div>'}</div>`);
    h.push(`</div>`);
    this.el.profile.innerHTML = h.join("");
    document.getElementById("pfBack")!.addEventListener("click", () => this.show(this.profileFrom));
  }

  // ------------------------------------------------------------ squad
  private renderSquad(): void {
    const me = this.me;
    const sel = me.selection;
    const slots = FORMATIONS[sel.formation];
    const prob = selectionProblem(me);
    const locked = !!this.live;
    const h: string[] = [];
    h.push(`<div class="card"><h3>${me.name} 스쿼드 <span>${me.squad.length}명</span></h3>
      <div class="squad-tools">
        <label>포메이션 <select id="sqFormation" ${locked ? "disabled" : ""}>${(Object.keys(FORMATIONS) as FormationName[]).map((f) => `<option ${f === sel.formation ? "selected" : ""}>${f}</option>`).join("")}</select></label>
        <button id="sqAuto" ${locked ? "disabled" : ""}>자동 선발</button>
        <span class="hint">선수 두 명을 차례로 누르면 자리를 맞바꿉니다 (선발 ↔ 벤치 ↔ 예비).</span>
      </div>
      ${prob ? `<div class="hint" style="color:var(--bad)">⚠ ${prob}</div>` : `<div class="hint" style="color:var(--good)">선발 명단 이상 없음</div>`}
    </div>`);
    const rolesNow = normalizeTactics({ ...me.tactics, formation: sel.formation }).roles!;
    const row = (p: SquadPlayer, slotRole: string | null, slotIdx = -1) => {
      const ovr = slotRole ? slotFit(p.attrs, p.role, slotRole as SquadPlayer["role"]) : overall(p.attrs, p.role);
      const roleSel = slotIdx >= 0 && !locked
        ? `<select class="rolesel" data-slot="${slotIdx}" style="grid-column:2 / -1;padding:1px 4px;font-size:11px;margin-top:2px">${rolesForSlot(slotRole as SquadPlayer["role"]).map((r) => `<option value="${r}" ${r === rolesNow[slotIdx] ? "selected" : ""}>${ROLES[r].name}</option>`).join("")}</select>`
        : slotIdx >= 0 ? `<span style="grid-column:2 / -1;font-size:11px;color:var(--muted)">${ROLES[rolesNow[slotIdx]!].name}</span>` : "";
      const cond = p.condition;
      const status = p.onLoan ? "임대 중" : p.loanFrom !== undefined ? `임대 (${clubOf(this.state, p.loanFrom).shortName})` : p.injuryDays > 0 ? `부상 ${p.injuryDays}일` : p.ban > 0 ? `출장정지 ${p.ban}` : p.seasonYellows % 5 === 4 ? "경고 누적 4" : p.contractUntil <= this.state.season ? "계약 만료 예정" : p.age <= 23 && p.potential - ovr >= 1.5 ? `잠재 ${p.potential.toFixed(0)}` : "";
      const roleText = slotRole && slotRole !== p.role ? `${slotRole}<span style="opacity:.5">(${p.role})</span>` : p.role;
      return `<div class="row wide ${this.selA === p.id ? "sel" : ""} ${isAvailable(p) ? "" : "off"}" data-id="${p.id}">
        <span class="num">${p.number}</span><span class="role">${roleText}</span>
        <span class="name" title="${p.name}">${p.name}</span>
        <span class="ovr" style="color:${ovr >= 14 ? "var(--good)" : ovr >= 11 ? "var(--text)" : "var(--warn)"}">${ovr.toFixed(1)}</span>
        <span class="age">${p.age}세</span>
        <span class="bar" title="컨디션 ${Math.round(cond * 100)}%"><i style="width:${Math.round(cond * 100)}%;background:${cond > 0.7 ? "var(--good)" : cond > 0.45 ? "var(--warn)" : "var(--bad)"}"></i></span>
        <span class="st">${status}</span>${INFO_BTN(`${me.id}:${p.id}`)}${roleSel}</div>`;
    };
    const header = `<div class="row wide" style="cursor:default;color:var(--muted);font-size:11px"><span>#</span><span>포지션</span><span>이름</span><span style="text-align:right">능력</span><span class="age">나이</span><span>컨디션</span><span class="st" style="color:var(--muted)">상태</span><span></span></div>`;
    h.push(`<div class="grid2">`);
    h.push(`<div class="card"><h3>선발 XI <span>${sel.formation}</span></h3>${header}<div class="roster">${sel.starters.map((id, i) => row(playerOf(me, id), slots[i]?.role ?? null, i)).join("")}</div></div>`);
    const reserves = me.squad.filter((p) => !sel.starters.includes(p.id) && !sel.bench.includes(p.id));
    h.push(`<div class="card"><h3>벤치 <span>${sel.bench.length}/7</span></h3>${header}<div class="roster">${sel.bench.map((id) => row(playerOf(me, id), null)).join("")}</div>
      <h3 style="margin-top:8px">예비 <span>${reserves.length}</span></h3><div class="roster">${reserves.map((p) => row(p, null)).join("")}</div></div>`);
    h.push(`</div>`);
    const tr = me.training;
    h.push(`<div class="card"><h3>훈련 <span>매주 적용</span></h3>
      <div class="squad-tools">
        <label>초점 <select id="trFocus">${(Object.keys(FOCUS_LABEL) as TrainingFocus[]).map((f) => `<option value="${f}" ${f === tr.focus ? "selected" : ""}>${FOCUS_LABEL[f]}</option>`).join("")}</select></label>
        <label>강도 <select id="trIntensity">${(Object.keys(INTENSITY_LABEL) as TrainingIntensity[]).map((i) => `<option value="${i}" ${i === tr.intensity ? "selected" : ""}>${INTENSITY_LABEL[i]}</option>`).join("")}</select></label>
      </div>
      <div class="hint">어린 선수는 잠재력까지 성장하고 30대는 서서히 쇠퇴합니다. 초점을 둔 능력치가 먼저 오르고, 강도를 높이면 성장은 빠르지만(강하게 ×1.4, 가볍게 ×0.7) 회복이 느리고 부상이 잦아집니다. 23세 이하는 경기에 60분 이상 뛰면 추가로 성장하고, 한 주 내내 결장하면 성장이 20% 느려집니다.</div></div>`);
    h.push(this.staffCardHtml(locked));
    h.push(`<div class="card"><h3>기본 전술 <span>경기 중에도 변경 가능</span></h3>
      <div class="actions">${Object.keys(TACTIC_PRESETS).map((n) => `<button data-preset="${n}" ${locked ? "disabled" : ""}>${n}</button>`).join("")}<button data-autoroles ${locked ? "disabled" : ""}>역할 자동</button></div>
      <label style="margin:4px 0"><input type="checkbox" id="sqTrap" ${me.tactics.offsideTrap ? "checked" : ""} ${locked ? "disabled" : ""}> 오프사이드 트랩 (라인을 평평하게 유지해 침투를 잡되, 뚫리면 위험)</label>
      <div id="sqSliders"></div>
      <div class="hint">역할은 선발 명단의 각 줄에서 고릅니다. 예: 윙어 ↔ 인사이드 포워드(중앙으로 파고들어 슛), 풀백 ↔ 윙백(오버랩), 앵커 ↔ 딥라잉 플레이메이커, 어드밴스드 포워드 ↔ 타겟맨·포처·폴스 나인.</div></div>`);
    const tn = normalizeTactics({ ...me.tactics, formation: sel.formation });
    const spv = tn.setPieces ?? {};
    const takerOpt = (cur?: string) => `<option value="">자동</option>${sel.starters.slice(1).map((id) => { const p = playerOf(me, id); return `<option value="${id}" ${id === cur ? "selected" : ""}>${p.number} ${p.name}</option>`; }).join("")}`;
    const targets: [CornerTarget, string][] = [["center", "중앙(PK 지점)"], ["near", "니어포스트"], ["far", "파포스트"], ["short", "짧게"]];
    h.push(`<div class="card"><h3>세트피스 <span>키커와 코너 타깃</span></h3>
      <div class="tactic"><span class="lbl">코너 키커</span><select data-sp="cornerTaker" style="grid-column:2 / 4" ${locked ? "disabled" : ""}>${takerOpt(spv.cornerTaker)}</select></div>
      <div class="tactic"><span class="lbl">프리킥 키커</span><select data-sp="freeKickTaker" style="grid-column:2 / 4" ${locked ? "disabled" : ""}>${takerOpt(spv.freeKickTaker)}</select></div>
      <div class="tactic"><span class="lbl">PK 키커</span><select data-sp="penaltyTaker" style="grid-column:2 / 4" ${locked ? "disabled" : ""}>${takerOpt(spv.penaltyTaker)}</select></div>
      <div class="tactic"><span class="lbl">코너 타깃</span><select data-sp="cornerTarget" style="grid-column:2 / 4" ${locked ? "disabled" : ""}>${targets.map(([v, l]) => `<option value="${v}" ${(spv.cornerTarget ?? "center") === v ? "selected" : ""}>${l}</option>`).join("")}</select></div>
      <div class="hint">비워 두면 능력치가 가장 좋은 선수가 맡습니다. 부상·퇴장 선수는 자동으로 제외됩니다.</div></div>`);
    h.push(`<div class="card"><h3>개인 지시 <span>역할 위에 덧씌움</span></h3><div class="roster">${sel.starters.slice(1).map((id, k) => {
      const i = k + 1;
      const p = playerOf(me, id);
      const cur = tn.instructions?.[i] ?? {};
      return `<div style="padding:6px 4px;border-bottom:1px solid var(--line)"><div style="font-size:13px;margin-bottom:4px"><span class="num" style="font-family:'IBM Plex Mono',monospace;color:var(--muted)">${p.number}</span> ${p.name} <span style="color:var(--muted);font-size:11px">${ROLES[tn.roles![i]!]!.name}</span></div>
        <div style="display:flex;flex-wrap:wrap;gap:4px">${INSTRUCTION_IDS.map((ins) => `<button data-ins="${i}:${ins}" ${locked ? "disabled" : ""} style="padding:2px 8px;font-size:11px;border-radius:12px;${cur[ins] ? "background:var(--accent);color:#1a1400;border-color:var(--accent)" : ""}">${INSTRUCTION_LABEL[ins]}</button>`).join("")}</div></div>`;
    }).join("")}</div><div class="hint">서로 반대되는 지시(예: 강하게 압박 / 압박 자제)는 한쪽만 켭니다.</div></div>`);
    this.el.squad.innerHTML = h.join("");

    (document.getElementById("sqFormation") as HTMLSelectElement).addEventListener("change", (e) => {
      const f = (e.target as HTMLSelectElement).value as FormationName;
      me.selection = autoSelect(me, f);
      me.tactics = { ...me.tactics, formation: f, roles: autoRoles(f, me.selection.starters.map((id) => playerOf(me, id).attrs)) };
      this.afterSquadChange();
    });
    document.getElementById("sqAuto")!.addEventListener("click", () => {
      me.selection = autoSelect(me, me.selection.formation);
      this.afterSquadChange();
    });
    if (!locked) {
      this.el.squad.querySelectorAll<HTMLElement>(".row[data-id]").forEach((r) =>
        r.addEventListener("click", () => {
          const id = r.dataset.id!;
          if (!this.selA) this.selA = id;
          else if (this.selA === id) this.selA = null;
          else {
            me.selection = swap(me, this.selA, id);
            this.selA = null;
          }
          this.afterSquadChange();
        }),
      );
    }
    this.wireInfo(this.el.squad, "squad");
    this.wireStaff();
    (document.getElementById("trFocus") as HTMLSelectElement).addEventListener("change", (e) => { me.training = { ...me.training, focus: (e.target as HTMLSelectElement).value as TrainingFocus }; this.save(); });
    (document.getElementById("trIntensity") as HTMLSelectElement).addEventListener("change", (e) => { me.training = { ...me.training, intensity: (e.target as HTMLSelectElement).value as TrainingIntensity }; this.save(); });
    this.el.squad.querySelectorAll<HTMLSelectElement>("select.rolesel").forEach((sel2) =>
      sel2.addEventListener("click", (e) => e.stopPropagation()));
    this.el.squad.querySelectorAll<HTMLSelectElement>("select.rolesel").forEach((sel2) =>
      sel2.addEventListener("change", (e) => {
        e.stopPropagation();
        const roles = [...rolesNow] as PlayerRoleId[];
        roles[Number(sel2.dataset.slot)] = sel2.value as PlayerRoleId;
        me.tactics = { ...me.tactics, formation: sel.formation, roles };
        this.save();
      }));
    this.el.squad.querySelectorAll<HTMLSelectElement>("select[data-sp]").forEach((sel2) =>
      sel2.addEventListener("change", () => {
        const next = { ...(normalizeTactics({ ...me.tactics, formation: sel.formation }).setPieces ?? {}) } as Record<string, string | undefined>;
        next[sel2.dataset.sp!] = sel2.value || undefined;
        me.tactics = { ...me.tactics, formation: sel.formation, setPieces: next as Tactics["setPieces"] };
        this.save();
      }));
    const OPPOSITE: Partial<Record<InstructionId, InstructionId>> = { pressMore: "pressLess", pressLess: "pressMore", riskyPasses: "safePasses", safePasses: "riskyPasses", holdPosition: "getForward", getForward: "holdPosition", stayWider: "cutInside", cutInside: "stayWider" };
    this.el.squad.querySelectorAll<HTMLButtonElement>("button[data-ins]").forEach((b) =>
      b.addEventListener("click", () => {
        const [slotS, ins] = b.dataset.ins!.split(":") as [string, InstructionId];
        const slot = Number(slotS);
        const t = normalizeTactics({ ...me.tactics, formation: sel.formation });
        const list = t.instructions!.map((x) => ({ ...x }));
        const cur = list[slot]!;
        cur[ins] = !cur[ins];
        const opp = OPPOSITE[ins];
        if (cur[ins] && opp) cur[opp] = false;
        me.tactics = { ...me.tactics, formation: sel.formation, instructions: list };
        this.afterSquadChange();
      }));
    this.el.squad.querySelectorAll<HTMLButtonElement>("button[data-preset]").forEach((b) =>
      b.addEventListener("click", () => {
        me.tactics = normalizeTactics({ ...me.tactics, ...TACTIC_PRESETS[b.dataset.preset!]!, formation: sel.formation });
        this.afterSquadChange();
      }));
    this.el.squad.querySelector<HTMLButtonElement>("button[data-autoroles]")?.addEventListener("click", () => {
      me.tactics = { ...me.tactics, formation: sel.formation, roles: autoRoles(sel.formation, sel.starters.map((id) => playerOf(me, id).attrs)) };
      this.afterSquadChange();
    });
    (document.getElementById("sqTrap") as HTMLInputElement).addEventListener("change", (e) => {
      me.tactics = { ...me.tactics, offsideTrap: (e.target as HTMLInputElement).checked };
      this.save();
    });
    const sl = document.getElementById("sqSliders")!;
    for (const def of SLIDERS) {
      const div = document.createElement("div");
      div.className = "tactic";
      const v = Math.round(me.tactics[def.key] * 100);
      div.innerHTML = `<span class="lbl">${def.label}</span><input type="range" min="0" max="100" step="5" value="${v}" aria-label="${def.label}"><span class="val">${describe(def, v / 100)}</span>`;
      const input = div.querySelector("input")!;
      input.addEventListener("input", () => {
        me.tactics = { ...me.tactics, [def.key]: Number(input.value) / 100 };
        div.querySelector(".val")!.textContent = describe(def, Number(input.value) / 100);
        this.save();
      });
      sl.appendChild(div);
    }
  }

  /** Coaching staff: my coaches (renew / sack) and the hiring market. */
  private staffCardHtml(locked: boolean): string {
    const s = this.state;
    const me = this.me;
    const staff = me.staff ?? [];
    const market = ensureStaffMarket(s);
    const expiring = new Set(expiringStaff(s).map((m) => m.id));
    const bar = (r: number) => `<span class="stars" title="능력 ${r}/20"><i style="display:inline-block;width:${Math.round(r * 3)}px;height:6px;background:${r >= 14 ? "var(--good)" : r >= 9 ? "var(--accent)" : "var(--muted)"};border-radius:3px"></i> ${r}</span>`;
    const row = (m: StaffMember, actions: string) => `<div class="row" style="grid-template-columns:auto 1fr auto auto;align-items:center;gap:8px;padding:5px 4px;border-bottom:1px solid var(--line)">
      <span style="font-size:11px;color:var(--accent);min-width:64px">${STAFF_ROLE_LABEL[m.role]}</span>
      <span style="font-size:13px">${m.name} <small style="color:var(--muted)">${m.age}세 · 연봉 ${m.wage}억 · ~S${m.contractUntil}${expiring.has(m.id) ? ' · <b style="color:var(--bad)">만료 예정</b>' : ""}</small></span>
      ${bar(m.rating)}
      <span style="display:flex;gap:4px">${actions}</span></div>`;
    const mine = staff.length
      ? staff.map((m) => row(m, `<button data-staff-renew="${m.id}" ${locked ? "disabled" : ""} style="padding:2px 8px;font-size:11px" title="계약금 ${staffRenewalFee(m)}억">재계약 ${staffRenewalFee(m)}억</button><button data-staff-fire="${m.id}" ${locked ? "disabled" : ""} style="padding:2px 8px;font-size:11px" title="위약금 ${staffSeverance(s, m)}억">해고</button>`)).join("")
      : '<div class="hint">코칭스태프가 없습니다. 아래 시장에서 채용하세요.</div>';
    const pool = market.length
      ? market.map((m) => {
        const prob = staffRoomProblem(me, m);
        const fee = staffSigningFee(m);
        return row(m, `<button data-staff-hire="${m.id}" ${locked || prob || me.budget < fee ? "disabled" : ""} style="padding:2px 8px;font-size:11px" title="${prob ?? `계약금 ${fee}억`}">채용 ${fee}억</button>`);
      }).join("")
      : '<div class="hint">지금은 시장에 나온 코치가 없습니다. 다음 이적 시장에 새 코치가 나옵니다.</div>';
    return `<div class="card"><h3>코칭스태프 <span>${staff.length}/${MAX_STAFF}명 · 연봉 합계 ${staffWageBill(me)}억</span></h3>
      <div class="roster">${mine}</div>
      <div class="hint">수석코치는 1군 훈련 성장, GK 코치는 골키퍼 성장, 유스 코치는 아카데미 성장·스카우팅 정밀도, 피지컬 코치는 주간 회복과 부상 예방, 의무 팀장은 부상 기간, 스카우트는 이적 타깃의 잠재력 보고서를 담당합니다. 능력 8이 평균이며, 그 이상이면 효과가 커집니다. 연봉은 시즌 중 매주 예산에서 나갑니다.</div>
      <h3 style="margin-top:10px">코치 시장 <span>${market.length}명 · 계약금 = 연봉 1년치</span></h3>
      <div class="roster">${pool}</div></div>`;
  }

  private wireStaff(): void {
    const act = (attr: string, fn: (id: string) => string | null, confirmMsg?: (id: string) => string) => {
      this.el.squad.querySelectorAll<HTMLButtonElement>(`button[${attr}]`).forEach((b) =>
        b.addEventListener("click", (e) => {
          e.stopPropagation();
          const id = b.getAttribute(attr)!;
          if (confirmMsg && !confirm(confirmMsg(id))) return;
          const err = fn(id);
          if (err) alert(err);
          this.afterSquadChange();
        }));
    };
    const s = this.state;
    act("data-staff-hire", (id) => hireStaff(s, id));
    act("data-staff-renew", (id) => renewStaff(s, id));
    act("data-staff-fire", (id) => fireStaff(s, id), (id) => {
      const m = (this.me.staff ?? []).find((x) => x.id === id);
      return m ? `${STAFF_ROLE_LABEL[m.role]} ${m.name}을(를) 해고할까요? 위약금 ${staffSeverance(s, m)}억이 나갑니다.` : "해고할까요?";
    });
  }

  private afterSquadChange(): void {
    this.save();
    this.renderSquad();
    this.renderHome();
  }

  // ------------------------------------------------------------ table
  private tableHtml(rows: ReturnType<typeof table>, compact = false): string {
    const s = this.state;
    const posOf = new Map(table(s).map((r, i) => [r.club, i + 1]));
    return `<table class="std"><thead><tr><th>#</th><th class="l">클럽</th>${compact ? "" : '<th class="l">감독</th>'}<th>경기</th>${compact ? "" : "<th>승</th><th>무</th><th>패</th><th>득</th><th>실</th>"}<th>득실</th><th>승점</th></tr></thead><tbody>${rows
      .map((r) => {
        const c = clubOf(s, r.club);
        const pos = posOf.get(r.club)!;
        const mgr = c.id === s.userClub ? s.managerName : c.manager?.name ?? "—";
        const mgrTitle = c.manager ? managerTags(c.manager).join(", ") : "";
        return `<tr class="${r.club === s.userClub ? "me" : ""}"><td>${pos}</td><td class="l"><span class="dot" style="background:${c.color}"></span>${c.name}</td>${compact ? "" : `<td class="l" title="${mgrTitle}">${mgr}</td>`}<td>${r.played}</td>${compact ? "" : `<td>${r.won}</td><td>${r.drawn}</td><td>${r.lost}</td><td>${r.gf}</td><td>${r.ga}</td>`}<td>${r.gf - r.ga > 0 ? "+" : ""}${r.gf - r.ga}</td><td><b>${r.pts}</b></td></tr>`;
      })
      .join("")}</tbody></table>`;
  }

  private scheduleHtml(): string {
    const s = this.state;
    const me = s.userClub;
    const mine = s.fixtures.filter((f) => f.home === me || f.away === me).sort((a, b) => a.round - b.round);
    return `<table class="std"><thead><tr><th>R</th><th class="l">상대</th><th>홈/원정</th><th>결과</th></tr></thead><tbody>${mine
      .map((f) => {
        const home = f.home === me;
        const opp = clubOf(s, home ? f.away : f.home);
        let res = "—", cls = "";
        if (f.score) {
          const gf = home ? f.score[0] : f.score[1], ga = home ? f.score[1] : f.score[0];
          res = `${gf} - ${ga}`;
          cls = gf > ga ? "color:var(--good)" : gf < ga ? "color:var(--bad)" : "color:var(--muted)";
        }
        const next = f.round === s.round && !f.score;
        return `<tr class="${next ? "me" : ""}"><td>${f.round + 1}</td><td class="l"><span class="dot" style="background:${opp.color}"></span>${opp.name}</td><td>${home ? "홈" : "원정"}</td><td style="${cls};font-family:'IBM Plex Mono',monospace">${res}</td></tr>`;
      })
      .join("")}</tbody></table>`;
  }

  private cupHtml(): string {
    const s = this.state;
    const me = s.userClub;
    const byes = cupByes(s);
    const stages = [0, 1, 2, 3].map((st) => {
      const ties = s.cup.ties.filter((t) => t.stage === st);
      const body = ties.length
        ? ties.map((t) => {
          const h = clubOf(s, t.home), a = clubOf(s, t.away);
          const w = tieWinner(t);
          const cell = (c: Club, won: boolean) => `<span class="${won ? "w" : t.score ? "l" : ""}"><span class="dot" style="background:${c.color}"></span>${c.name}</span>`;
          const sc = t.score ? `${t.score[0]} - ${t.score[1]}${t.penalties ? `<small>승부차기 ${t.penalties[0]}-${t.penalties[1]}</small>` : ""}` : "—";
          return `<div class="tie ${t.home === me || t.away === me ? "me" : ""}">${cell(h, w === t.home)}<span class="sc">${sc}</span>${cell(a, w === t.away)}</div>`;
        }).join("")
        : `<div class="hint">${st === 0 ? "" : "이전 라운드가 끝나면 추첨합니다."}</div>`;
      const when = st === s.cup.stage && s.pendingCupDay ? "오늘" : `${CUP_ROUNDS[st]}R 후`;
      return `<div class="stage"><div class="stageHead">${CUP_STAGE_LABEL[st]} <small>${when}</small></div>${body}${st === 0 ? `<div class="hint">부전승: ${byes.map((b) => clubOf(s, b).name).join(", ")}</div>` : ""}</div>`;
    }).join("");
    const holder = s.cup.holder !== undefined ? ` · 우승 <b style="color:var(--accent)">${clubOf(s, s.cup.holder).name}</b>` : "";
    return `<div class="card"><h3>${CUP_NAME} 대진 <span>단판 토너먼트${holder}</span></h3><div class="bracket">${stages}</div></div>`;
  }

  private renderTable(): void {
    const s = this.state;
    const scorers = topScorers(s, 10);
    const assists = topAssists(s, 10);
    const ratings = topRatings(s, 10);
    this.el.table.innerHTML = `<div class="card"><h3>리그 순위 <span>시즌 ${s.season}</span></h3>${this.tableHtml(table(s))}</div>
      <div class="card"><h3>내 일정 <span>${clubOf(s, s.userClub).name}</span></h3>${this.scheduleHtml()}</div>
      ${this.cupHtml()}
      <div class="grid2">
      <div class="card"><h3>득점 순위</h3>${scorers.length ? `<table class="std"><thead><tr><th>#</th><th class="l">선수</th><th class="l">클럽</th><th>출장</th><th>도움</th><th>골</th></tr></thead><tbody>${scorers
        .map((x, i) => `<tr class="${x.club.id === s.userClub ? "me" : ""}"><td>${i + 1}</td><td class="l">${x.player.name}</td><td class="l">${x.club.shortName}</td><td>${x.player.stats.apps}</td><td>${x.player.stats.assists ?? 0}</td><td><b>${x.player.stats.goals}</b></td></tr>`)
        .join("")}</tbody></table>` : `<div class="hint">아직 득점이 없습니다.</div>`}</div>
      <div class="card"><h3>도움 순위</h3>${assists.length ? `<table class="std"><thead><tr><th>#</th><th class="l">선수</th><th class="l">클럽</th><th>출장</th><th>골</th><th>도움</th></tr></thead><tbody>${assists
        .map((x, i) => `<tr class="${x.club.id === s.userClub ? "me" : ""}"><td>${i + 1}</td><td class="l">${x.player.name}</td><td class="l">${x.club.shortName}</td><td>${x.player.stats.apps}</td><td>${x.player.stats.goals}</td><td><b>${x.player.stats.assists ?? 0}</b></td></tr>`)
        .join("")}</tbody></table>` : `<div class="hint">아직 도움이 없습니다.</div>`}</div>
      </div>
      <div class="card"><h3>평점 순위 <span>${RATING_MIN_APPS}경기 이상 출전</span></h3>${ratings.length ? `<table class="std"><thead><tr><th>#</th><th class="l">선수</th><th class="l">클럽</th><th>출장</th><th>골</th><th>도움</th><th>MOTM</th><th>평점</th></tr></thead><tbody>${ratings
        .map((x, i) => `<tr class="${x.club.id === s.userClub ? "me" : ""}"><td>${i + 1}</td><td class="l">${x.player.name}</td><td class="l">${x.club.shortName}</td><td>${x.player.stats.apps}</td><td>${x.player.stats.goals}</td><td>${x.player.stats.assists ?? 0}</td><td>${x.player.stats.motm ?? 0}</td><td><b style="color:${ratingColor(x.rating)}">${fmtRating(x.rating)}</b></td></tr>`)
        .join("")}</tbody></table>` : `<div class="hint">${RATING_MIN_APPS}경기 이상 출전한 선수가 아직 없습니다.</div>`}</div>`;
  }

  // ------------------------------------------------------------ transfers
  private transferRole = "전체";
  /** the one follow-up bid the selling club allows after a counter */
  private pendingBid: { clubId: number; playerId: string; counter: number } | null = null;

  /** Deterministic dice for a negotiation: same state and figure → same answer (no reroll by reloading). */
  private marketRng(key: string, fee: number): Rng {
    let h = 0;
    for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    const s = this.state;
    return new Rng((s.seed * 53 + s.season * 977 + s.round * 31 + h + Math.round(fee) * 7) >>> 0);
  }

  private askFee(label: string, initial: number): number | null {
    const raw = prompt(label, String(initial));
    if (raw === null) return null;
    const fee = Math.round(Number(raw.replace(/[^\d.]/g, "")));
    if (!(fee > 0)) { alert("금액을 숫자로 입력하세요 (억원)."); return null; }
    return fee;
  }

  private renderTransfers(): void {
    const s = this.state;
    const me = this.me;
    const open = windowOpen(s);
    const locked = !!this.live;
    const can = open && !locked;
    const roles = ["전체", "GK", "CB", "LB", "RB", "DM", "CM", "AM", "LW", "RW", "ST"];
    const targets = transferTargets(s).filter((t) => this.transferRole === "전체" || t.player.role === this.transferRole).slice(0, 60);
    if (this.pendingBid && !clubOf(s, this.pendingBid.clubId).squad.some((p) => p.id === this.pendingBid!.playerId)) this.pendingBid = null;
    const btn = 'style="padding:3px 8px;font-size:12px"';
    const fmtRow = (p: SquadPlayer, clubName: string, right: string, clubId: number = me.id) => `<div class="row tr" style="cursor:default">
        <span class="num">${p.number}</span><span class="role">${p.role}</span>
        <span class="name" title="${p.name}">${p.name} <span style="opacity:.55;font-size:11px">${clubName}</span></span>
        <span class="ovr">${overall(p.attrs, p.role).toFixed(1)}</span><span class="age">${p.age}세</span>
        <span class="val" style="font-family:'IBM Plex Mono',monospace;font-size:12px;text-align:right">${playerValue(p)}억</span>
        <span style="text-align:right">${right}</span>${INFO_BTN(`${clubId}:${p.id}`)}</div>`;
    const h: string[] = [];
    h.push(`<div class="card"><h3>이적 시장 <span>예산 ${me.budget}억 · 스쿼드 ${me.squad.length}/${MAX_SQUAD}</span></h3>
      <div class="hint">${open ? `<b style="color:var(--good)">열림</b>${deadlineDay(s) ? ' · <b style="color:var(--accent)">마감일</b> — 구단들이 평소보다 쉽게 응합니다' : ""} — 프리시즌(1R 전), 겨울(11~12R 전), 시즌 종료 후에 거래할 수 있습니다.` : '<b style="color:var(--warn)">닫힘</b> — 다음 창구: ' + (s.round < 10 ? "11라운드 전" : "시즌 종료 후")}
      ${locked ? " · 경기 중에는 거래할 수 없습니다." : ""}</div>
      <div class="squad-tools"><label>포지션 <select id="trRole">${roles.map((r) => `<option ${r === this.transferRole ? "selected" : ""}>${r}</option>`).join("")}</select></label>
      <span class="hint">호가는 상대 구단이 부르는 값입니다(핵심 선수일수록 비쌈, 24명 넘는 구단의 잉여 선수는 가치 그대로). 영입 버튼을 누르면 금액을 제시하고, 구단은 수락하거나 한 번 역제안합니다.</span></div></div>`);
    // ---- incoming offers
    const offers = openOffers(s);
    if (offers.length || open) {
      h.push(`<div class="card"><h3>받은 제안 <span>${offers.length}건${offers.length ? " · 2라운드 후 만료" : ""}</span></h3>`);
      if (!offers.length) h.push(`<div class="hint">아직 제안이 없습니다. 창구가 열린 동안 매주 AI 구단이 필요한 포지션의 내 선수에게 제안을 보냅니다.</div>`);
      for (const o of offers) {
        const p = playerOf(me, o.playerId);
        const from = clubOf(s, o.from);
        const value = playerValue(p);
        const ratio = Math.round((o.fee / value) * 100);
        const weeks = Math.max(0, o.expiresRound - s.round);
        const canSell = can && me.squad.filter((q) => !q.onLoan && q.loanFrom === undefined).length > MIN_SQUAD;
        h.push(`<div class="offer">
          <div class="of-main"><b>${p.name}</b> <span class="role">${p.role} · ${overall(p.attrs, p.role).toFixed(1)} · ${p.age}세</span>
            <div class="hint">${from.name} → <b style="color:${ratio >= 100 ? "var(--good)" : ratio >= 90 ? "var(--text)" : "var(--warn)"}">${o.fee}억</b> (가치 ${value}억의 ${ratio}%) · ${weeks <= 0 ? "이번 주 만료" : `${weeks}주 후 만료`}${o.status === "countered" ? ` · <span style="color:var(--warn)">역제안 ${o.counterFee}억 거절됨 — 원안 유효, 재역제안 시 철회</span>` : ""}</div></div>
          <div class="of-acts">${INFO_BTN(`${me.id}:${p.id}`)}<button class="primary" data-accept="${o.id}" ${canSell ? "" : "disabled"} ${btn}>수락</button>${o.status === "open" ? `<button data-counter="${o.id}" ${canSell ? "" : "disabled"} ${btn}>역제안</button>` : ""}<button class="danger" data-reject="${o.id}" ${locked ? "disabled" : ""} ${btn}>거절</button></div>
        </div>`);
      }
      h.push(`</div>`);
    }
    h.push(`<div class="grid2">`);
    h.push(`<div class="card"><h3>영입 대상 <span>능력순 상위 ${targets.length}</span></h3><div class="roster">${targets
      .map((t) => {
        if (t.price === null) return fmtRow(t.player, t.club.shortName, '<span class="hint">비매</span>', t.club.id);
        if (t.player.refusedSeason === s.season) return fmtRow(t.player, t.club.shortName, '<span class="hint" style="color:var(--warn)">이적 거부</span>', t.club.id);
        const pb = this.pendingBid && this.pendingBid.playerId === t.player.id ? this.pendingBid : null;
        const ok = can && me.squad.length < MAX_SQUAD && me.budget >= Math.min(t.price, pb?.counter ?? t.price) * 0.5;
        return fmtRow(t.player, t.club.shortName, pb
          ? `<button class="primary" data-bid="${t.club.id}:${t.player.id}" ${ok ? "" : "disabled"} ${btn} title="역제안 ${pb.counter}억 — 마지막 제시">재입찰 ${pb.counter}억</button>`
          : `<button data-bid="${t.club.id}:${t.player.id}" ${ok ? "" : "disabled"} ${btn}>호가 ${t.price}억</button>`, t.club.id);
      })
      .join("")}</div></div>`);
    h.push(`<div class="card"><h3>내 선수 판매 <span>최소 ${MIN_SQUAD}명 유지</span></h3><div class="hint">즉시 판매가는 지금 가장 높은 값을 부르는 구단 기준입니다. 더 받고 싶다면 받은 제안을 기다리거나 역제안하세요.</div><div class="roster">${[...me.squad]
      .sort((a, b) => overall(b.attrs, b.role) - overall(a.attrs, a.role))
      .map((p) => {
        if (p.loanFrom !== undefined) return fmtRow(p, `임대 (${clubOf(s, p.loanFrom).shortName})`, '<span class="hint">임대 선수</span>');
        if (p.onLoan) return fmtRow(p, "", '<span class="hint">임대 중</span>');
        const offer = open ? bestOffer(s, p.id) : null;
        return fmtRow(p, "", offer ? `<button data-sell="${p.id}" ${!locked && me.squad.length > MIN_SQUAD ? "" : "disabled"} ${btn}>${offer.fee}억 → ${offer.club.shortName}</button>` : '<span class="hint">제안 없음</span>');
      })
      .join("")}</div></div>`);
    h.push(`</div>`);
    // ---- free agents & loans
    h.push(`<div class="grid2">`);
    const fas = [...s.freeAgents].sort((a, b) => overall(b.attrs, b.role) - overall(a.attrs, a.role));
    h.push(`<div class="card"><h3>자유계약 선수 <span>${fas.length}명 · 계약금 가치의 30%</span></h3>
      <div class="hint">계약이 끝나고 풀린 선수들입니다. 이적료 없이 계약금(가치 30%)과 시세보다 20% 높은 연봉으로 데려옵니다. 2시즌 동안 팀을 못 찾으면 사라집니다.</div>
      <div class="roster">${fas.length ? fas.map((p) => { const t = freeAgentTerms(p); return fmtRow(p, `연봉 ${t.wage}억`, `<button data-sign="${p.id}" ${can && me.squad.length < MAX_SQUAD && me.budget >= t.fee ? "" : "disabled"} ${btn} title="계약금 ${t.fee}억 · 연봉 ${t.wage}억 · ${t.years}년">계약금 ${t.fee}억</button>`, -1); }).join("") : '<div class="hint">지금은 자유계약 선수가 없습니다.</div>'}</div></div>`);
    const outs = loanableOut(s);
    const onLoan = me.squad.filter((p) => p.onLoan);
    const ins = loanTargets(s).filter((t) => this.transferRole === "전체" || t.player.role === this.transferRole).slice(0, 15);
    const myLoanIns = s.loans.filter((l) => l.to === me.id).length;
    const canLoanOut = can && me.squad.filter((p) => !p.onLoan && p.loanFrom === undefined).length - 1 >= MIN_SQUAD;
    h.push(`<div class="card"><h3>임대 <span>시즌 종료 시 복귀</span></h3>
      <div class="hint"><b>임대 보내기</b>: 23세 이하이거나 비주전인 선수를 필요한 구단에 보냅니다. 연봉 50%를 상대가 부담하고 어린 선수는 조금 더 빨리 성장합니다. <b>임대 영입</b>: 다른 구단의 비주전을 이적료 없이 데려오되 연봉은 전액 부담합니다 (시즌당 2명).</div>
      ${onLoan.length ? `<div class="roster">${onLoan.map((p) => { const l = s.loans.find((x) => x.playerId === p.id); return fmtRow(p, l ? `→ ${clubOf(s, l.to).shortName}` : "", '<span class="hint">임대 중 · 시즌 후 복귀</span>'); }).join("")}</div>` : ""}
      <h3 style="margin-top:6px">보낼 수 있는 선수 <span>${outs.length}명</span></h3>
      <div class="roster">${outs.length ? outs.map((p) => { const d = loanDestination(s, p); return fmtRow(p, "", d ? `<button data-loanout="${p.id}" ${canLoanOut ? "" : "disabled"} ${btn} title="${d.name}이(가) 받습니다">임대 → ${d.shortName}</button>` : '<span class="hint">원하는 구단 없음</span>'); }).join("") : '<div class="hint">임대 보낼 만한 선수가 없습니다.</div>'}</div>
      <h3 style="margin-top:6px">임대 영입 가능 <span>비주전 상위 ${ins.length} · ${myLoanIns}/2</span></h3>
      <div class="roster">${ins.map((t) => fmtRow(t.player, t.club.shortName, `<button data-loanin="${t.club.id}:${t.player.id}" ${can && me.squad.length < MAX_SQUAD && myLoanIns < 2 ? "" : "disabled"} ${btn} title="연봉 ${t.player.wage}억 전액 부담">임대 영입</button>`, t.club.id)).join("")}</div></div>`);
    h.push(`</div>`);
    const contracts = [...me.squad].filter((p) => p.loanFrom === undefined).sort((a, b) => a.contractUntil - b.contractUntil || b.wage - a.wage);
    h.push(`<div class="card"><h3>계약 <span>연봉 총액 ${wageBill(me)}억/시즌</span></h3>
      <div class="hint">계약은 시즌 단위입니다. 만료 시즌(이번 시즌이면 <b style="color:var(--warn)">만료 예정</b>)인 선수는 시즌이 끝나면 자유계약으로 풀리므로 미리 재계약하세요. 계약금은 선수 가치의 5%×연수입니다.</div>
      <div class="roster">${contracts
        .map((p) => {
          const exp = p.contractUntil <= s.season;
          const t1 = renewalTerms(p, 1), t3 = renewalTerms(p, 3);
          return `<div class="row tr" style="cursor:default"><span class="num">${p.number}</span><span class="role">${p.role}</span>
            <span class="name">${p.name} <span style="opacity:.55;font-size:11px">연봉 ${p.wage}억${p.onLoan ? " · 임대 중" : ""}</span></span>
            <span class="ovr">${overall(p.attrs, p.role).toFixed(1)}</span><span class="age">${p.age}세</span>
            <span style="font-family:'IBM Plex Mono',monospace;font-size:12px;text-align:right;color:${exp ? "var(--warn)" : "var(--muted)"}">~S${p.contractUntil}</span>
            <span style="text-align:right;display:flex;gap:4px;justify-content:flex-end">${[1, 3].map((y) => `<button data-renew="${p.id}:${y}" ${locked || me.budget < (y === 1 ? t1.fee : t3.fee) ? "disabled" : ""} title="계약금 ${y === 1 ? t1.fee : t3.fee}억 · 연봉 ${y === 1 ? t1.wage : t3.wage}억" style="padding:3px 6px;font-size:11px">+${y}년 ${y === 1 ? t1.fee : t3.fee}억</button>`).join("")}</span>${INFO_BTN(`${me.id}:${p.id}`)}</div>`;
        })
        .join("")}</div></div>`);
    this.el.transfers.innerHTML = h.join("");
    this.wireInfo(this.el.transfers, "transfers");
    const done = (): void => { this.save(); this.renderAll(); };
    const on = (sel: string, fn: (b: HTMLButtonElement) => void): void => { this.el.transfers.querySelectorAll<HTMLButtonElement>(sel).forEach((b) => b.addEventListener("click", () => fn(b))); };
    on("button[data-renew]", (b) => {
      const [id, y] = b.dataset.renew!.split(":");
      const p = playerOf(me, id!);
      const t = renewalTerms(p, Number(y));
      if (!confirm(`${p.name}과(와) ${y}년 재계약할까요? 계약금 ${t.fee}억, 연봉 ${t.wage}억/시즌`)) return;
      const err = renewContract(s, id!, Number(y) as 1 | 2 | 3);
      if (err) alert(err);
      done();
    });
    (document.getElementById("trRole") as HTMLSelectElement).addEventListener("change", (e) => {
      this.transferRole = (e.target as HTMLSelectElement).value;
      this.renderTransfers();
    });
    on("button[data-bid]", (b) => {
      const [club, id] = b.dataset.bid!.split(":");
      const clubId = Number(club);
      const t = transferTargets(s).find((x) => x.player.id === id && x.club.id === clubId);
      if (!t || t.price === null) return;
      const pb = this.pendingBid && this.pendingBid.playerId === id ? this.pendingBid : null;
      const fee = this.askFee(pb ? `${t.player.name} (${t.club.shortName}) — ${t.club.shortName}의 역제안은 ${pb.counter}억입니다. 마지막 제시액(억)을 입력하세요. 그 아래면 협상이 결렬됩니다.` : `${t.player.name} (${t.club.shortName}) 영입 제시액(억)을 입력하세요. 호가 ${t.price}억 · 가치 ${t.value}억 · 예산 ${me.budget}억`, pb ? pb.counter : t.price);
      if (fee === null) return;
      const r: BidResult = makeBid(s, clubId, id!, fee, this.marketRng(`bid:${id}`, fee), pb ? { counter: pb.counter } : undefined);
      this.pendingBid = r.status === "countered" ? { clubId, playerId: id!, counter: r.counter! } : null;
      alert(r.text);
      done();
    });
    on("button[data-sell]", (b) => {
      const id = b.dataset.sell!;
      const p = playerOf(me, id);
      const offer = bestOffer(s, id);
      if (!offer || !confirm(`${p.name}을(를) ${offer.club.name}에 ${offer.fee}억에 판매할까요?`)) return;
      const err = sellPlayer(s, id);
      if (err) alert(err);
      done();
    });
    on("button[data-accept]", (b) => {
      const o = openOffers(s).find((x) => x.id === b.dataset.accept);
      if (!o) return;
      const p = playerOf(me, o.playerId);
      if (!confirm(`${p.name}을(를) ${clubOf(s, o.from).name}에 ${o.fee}억에 보낼까요?`)) return;
      const err = acceptOffer(s, o.id);
      if (err) alert(err);
      done();
    });
    on("button[data-reject]", (b) => { rejectOffer(s, b.dataset.reject!); done(); });
    on("button[data-counter]", (b) => {
      const o = openOffers(s).find((x) => x.id === b.dataset.counter);
      if (!o) return;
      const p = playerOf(me, o.playerId);
      const value = playerValue(p);
      const fee = this.askFee(`${clubOf(s, o.from).name}의 ${p.name} 제안 ${o.fee}억 (가치 ${value}억). 역제안 금액(억)을 입력하세요. 가치의 115%까지는 대체로 받아들이고, 그 위로는 확률이 빠르게 떨어집니다. 역제안은 한 번만 할 수 있습니다.`, Math.round(value * 1.15));
      if (fee === null) return;
      const r = respondToCounter(s, o.id, fee, this.marketRng(`counter:${o.id}`, fee));
      alert(r.text);
      done();
    });
    on("button[data-sign]", (b) => {
      const p = s.freeAgents.find((x) => x.id === b.dataset.sign);
      if (!p) return;
      const t = freeAgentTerms(p);
      if (!confirm(`자유계약 ${p.name}과(와) ${t.years}년 계약할까요? 계약금 ${t.fee}억, 연봉 ${t.wage}억/시즌`)) return;
      const err = signFreeAgent(s, p.id);
      if (err) alert(err);
      done();
    });
    on("button[data-loanout]", (b) => {
      const p = playerOf(me, b.dataset.loanout!);
      const d = loanDestination(s, p);
      if (!d || !confirm(`${p.name}을(를) ${d.name}에 시즌 종료까지 임대 보낼까요? 연봉의 50%를 ${d.shortName}이(가) 부담하고 선발에서 빠집니다.`)) return;
      const err = loanOut(s, p.id);
      if (err) alert(err);
      done();
    });
    on("button[data-loanin]", (b) => {
      const [club, id] = b.dataset.loanin!.split(":");
      const t = loanTargets(s).find((x) => x.player.id === id);
      if (!t || !confirm(`${t.player.name} (${t.club.shortName})을(를) 시즌 종료까지 임대 영입할까요? 이적료 없음, 연봉 ${t.player.wage}억 전액 부담, 시즌 후 복귀합니다.`)) return;
      const err = loanIn(s, Number(club), id!);
      if (err) alert(err);
      done();
    });
  }

  // ------------------------------------------------------------ youth
  private renderYouth(): void {
    const s = this.state;
    const me = this.me;
    const y = me.youth;
    const locked = !!this.live;
    const tiers = Object.keys(SCOUTING) as ScoutingTier[];
    const prospects = [...y.prospects].sort((a, b) => (b.potentialRange[0] + b.potentialRange[1]) - (a.potentialRange[0] + a.potentialRange[1]) || prospectOverall(b) - prospectOverall(a));
    const h: string[] = [];
    h.push(`<div class="card"><h3>유스 아카데미 <span>유망주 ${y.prospects.length}/${MAX_PROSPECTS} · 주 ${youthWeeklyCost(me)}억 · 예산 ${me.budget}억 · 스쿼드 ${me.squad.length}/${MAX_SQUAD}</span></h3>
      <div class="squad-tools">
        <label>스카우팅 <select id="ytScouting">${tiers.map((k) => `<option value="${k}" ${k === y.scouting ? "selected" : ""}>${SCOUTING[k].label} · ${SCOUTING[k].intake}명 · 주 ${SCOUTING[k].cost}억</option>`).join("")}</select></label>
        <label>코칭 <select id="ytCoaching">${[1, 2, 3].map((l) => `<option value="${l}" ${l === y.coaching ? "selected" : ""}>${COACHING[l]!.label} · 주 ${COACHING[l]!.cost}억</option>`).join("")}</select></label>
      </div>
      <div class="hint">유망주는 시즌 시작과 11라운드 전에 들어옵니다. 스카우팅 등급이 높을수록 인원이 많고 잠재력 상한이 높으며 <b>잠재력 범위</b>가 빨리 좁혀집니다. 코칭 등급은 성장 속도를 정합니다(×${(0.8 + 0.3 * y.coaching).toFixed(1)}). 비용은 연봉과 함께 매주 빠집니다.</div></div>`);
    const header = `<div class="row yt" style="color:var(--muted);font-size:11px"><span>포지션</span><span>이름</span><span style="text-align:right">능력</span><span style="text-align:right">잠재력</span><span></span></div>`;
    const row = (p: (typeof prospects)[number]) => {
      const ovr = prospectOverall(p);
      const [lo, hi] = p.potentialRange;
      const width = hi - lo;
      const known = width <= 0.5 ? "확정" : width <= 1.5 ? "거의 확정" : p.reportsSeen > 0 ? `보고서 ${p.reportsSeen}` : "미확인";
      const potText = width <= 0.5 ? `${Math.round(p.truePotential)}` : `${Math.round(lo)}~${Math.round(hi)}`;
      const urgent = p.age >= LEAVE_AGE - 1;
      const note = urgent ? '<span style="color:var(--warn)">시즌 내 승격 필요</span>' : p.age < MIN_PROMOTE_AGE ? `${MIN_PROMOTE_AGE}세부터 승격` : known;
      const canPromote = !locked && p.age >= MIN_PROMOTE_AGE && me.squad.length < MAX_SQUAD;
      return `<div class="row yt">
        <span class="role">${p.role}</span>
        <span class="name" title="${p.name}">${p.name} <span style="opacity:.55;font-size:11px">${p.age}세 · ${p.weeksInAcademy}주 · ${note}</span></span>
        <span class="ovr" style="color:${ovr >= 12 ? "var(--good)" : ovr >= 9 ? "var(--text)" : "var(--warn)"}">${ovr.toFixed(1)}</span>
        <span class="pot" title="스카우트 추정 잠재력 (${known})" style="color:${lo >= 15 ? "var(--good)" : "var(--muted)"}">${potText}</span>
        <span class="acts"><button data-promote="${p.id}" ${canPromote ? "" : "disabled"} title="${MIN_PROMOTE_AGE}세 이상, 스쿼드 ${MAX_SQUAD}명 미만">승격</button><button class="danger" data-release="${p.id}" ${locked ? "disabled" : ""}>방출</button></span></div>`;
    };
    h.push(`<div class="card"><h3>유망주 <span>잠재력 하한 15 이상은 1군급</span></h3>${header}<div class="roster">${prospects.length ? prospects.map(row).join("") : '<div class="hint">아직 유망주가 없습니다. 다음 입단 시기에 들어옵니다.</div>'}</div>
      <div class="hint">승격하면 3시즌 계약(연봉은 시세의 절반)으로 1군에 합류하고 잠재력이 확정됩니다. ${LEAVE_AGE}세가 되는 유망주는 승격하지 않으면 시즌이 끝날 때 떠납니다.${locked ? " 경기 중에는 변경할 수 없습니다." : ""}</div></div>`);
    this.el.youth.innerHTML = h.join("");
    (document.getElementById("ytScouting") as HTMLSelectElement).addEventListener("change", (e) => { y.scouting = (e.target as HTMLSelectElement).value as ScoutingTier; this.save(); this.renderYouth(); });
    (document.getElementById("ytCoaching") as HTMLSelectElement).addEventListener("change", (e) => { y.coaching = Number((e.target as HTMLSelectElement).value); this.save(); this.renderYouth(); });
    this.el.youth.querySelectorAll<HTMLButtonElement>("button[data-promote]").forEach((b) =>
      b.addEventListener("click", () => {
        const p = y.prospects.find((q) => q.id === b.dataset.promote);
        if (!p || !confirm(`${p.name}(${p.age}세 ${p.role})을(를) 1군으로 승격할까요? 3시즌 계약, 잠재력은 승격 후 확정됩니다.`)) return;
        const err = promoteProspect(s, p.id);
        if (err) alert(err);
        this.save();
        this.renderAll();
      }),
    );
    this.el.youth.querySelectorAll<HTMLButtonElement>("button[data-release]").forEach((b) =>
      b.addEventListener("click", () => {
        const p = y.prospects.find((q) => q.id === b.dataset.release);
        if (!p || !confirm(`${p.name}을(를) 아카데미에서 방출할까요? 되돌릴 수 없습니다.`)) return;
        const err = releaseProspect(s, p.id);
        if (err) alert(err);
        this.save();
        this.renderAll();
      }),
    );
  }

  // ------------------------------------------------------------ results
  private renderResults(round: number, kind: "league" | "cup" = "league", cupStage = 0): void {
    const s = this.state;
    const me = s.userClub;
    const line = (home: Club, away: Club, score: [number, number] | null, scorers: string[], extra = "", motm?: Fixture["motm"]) => {
      const mine = home.id === me || away.id === me;
      let star = "";
      if (motm) {
        const mp = home.squad.find((p) => p.id === motm.playerId) ?? away.squad.find((p) => p.id === motm.playerId);
        if (mp) star = `<div class="scorers"><span style="color:var(--accent)">★ MOTM</span> ${mp.name} (${home.squad.includes(mp) ? home.shortName : away.shortName}) <b style="color:${ratingColor(motm.rating)}">${fmtRating(motm.rating)}</b></div>`;
      }
      return `<div class="result ${mine ? "me" : ""}"><span class="r">${home.name}</span><span class="sc">${score ? `${score[0]} - ${score[1]}` : "—"}</span><span>${away.name}${extra}</span>${scorers.length ? `<div class="scorers">${scorers.join(" · ")}</div>` : ""}${star}</div>`;
    };
    let title: string, body: string, btn: string;
    if (kind === "cup") {
      const ties = s.cup.ties.filter((t) => t.stage === cupStage);
      title = `${CUP_NAME} ${CUP_STAGE_LABEL[cupStage]} 결과`;
      body = ties.map((t) => line(clubOf(s, t.home), clubOf(s, t.away), t.score, t.scorers, t.penalties ? ` <small style="color:var(--accent)">승부차기 ${t.penalties[0]}-${t.penalties[1]}</small>` : "", t.motm)).join("");
      if (cupStage === 3 && s.cup.holder !== undefined) body += `<div class="hint" style="color:var(--accent);margin-top:6px">${CUP_NAME} 우승: <b>${clubOf(s, s.cup.holder).name}</b></div>`;
      btn = "다음 라운드로 →";
    } else {
      const fx = s.fixtures.filter((f) => f.round === round);
      title = `라운드 ${round + 1} 결과`;
      body = fx.map((f) => line(clubOf(s, f.home), clubOf(s, f.away), f.score, f.scorers, "", f.motm)).join("");
      btn = round + 1 >= roundsPerSeason(s.clubs.length) ? "시즌 결산 보기 →" : "다음 라운드로 →";
    }
    this.el.results.innerHTML = `<div class="card"><h3>${title}</h3>${body}<div class="actions" style="margin-top:8px"><button class="primary" id="btnNextRound">${btn}</button></div></div>
      <div class="card"><h3>순위</h3>${this.tableHtml(table(s))}</div>`;
    document.getElementById("btnNextRound")!.addEventListener("click", () => {
      if (kind === "cup") advanceCupDay(this.state);
      else advanceRound(this.state);
      prepareRound(this.state);
      this.save();
      this.renderAll();
      void this.checkCelebrations().then(() => {
        if (this.state.board.sacked) { this.renderSacked(); this.show("sacked"); }
        else if (seasonOver(this.state)) { this.renderReview(); this.show("review"); }
        else this.show("home");
      });
    });
  }

  // ------------------------------------------------------------ season review
  private renderReview(): void {
    const s = this.state;
    const me = this.me;
    const rows = table(s);
    const pos = rows.findIndex((r) => r.club === me.id) + 1;
    const mine = rows[pos - 1]!;
    const n = rows.length;
    const champ = clubOf(s, rows[0]!.club);
    const scorers = topScorers(s, 3);
    const myTop = [...me.squad].sort((a, b) => b.stats.goals - a.stats.goals || b.stats.apps - a.stats.apps)[0];
    const myApps = [...me.squad].sort((a, b) => b.stats.apps - a.stats.apps || b.stats.minutes - a.stats.minutes)[0];
    const myBest = [...me.squad].filter((p) => (p.stats.ratedApps ?? 0) >= RATING_MIN_APPS).sort((a, b) => avgRating(b) - avgRating(a))[0];
    const promoted = me.squad.filter((p) => p.age <= 19 && p.contractUntil === s.season + 3).length;
    const budgetDelta = Math.round((me.budget - me.seasonStartBudget) * 10) / 10;
    const cupSt = userCupStatus(s);
    const myLastTie = [...s.cup.ties].reverse().find((t) => t.score && (t.home === me.id || t.away === me.id));
    const cupText = cupSt === "holder" ? '<b style="color:var(--accent)">우승</b>' : myLastTie ? `${CUP_STAGE_LABEL[myLastTie.stage]} ${tieWinner(myLastTie) === me.id ? "진출" : "탈락"}` : "—";
    const verdict = pos === 1 ? "리그 우승! 완벽한 시즌입니다." : pos <= 3 ? "상위권 마무리. 우승 도전은 다음 시즌으로." : pos > n - 2 ? "강등권 성적입니다. 전력 보강이 시급합니다." : "중위권 시즌. 핵심 선수를 지키고 보강하세요.";
    const highlights = s.news.filter((x) => /우승|이적|퇴장|승부차기|영입|판매|경질|부임/.test(x)).slice(0, 8);
    const moy = managerOfYear(s);
    const myExpected = expectedPositions(s).get(me.id)!;
    const stat = (label: string, value: string) => `<div class="stat"><small>${label}</small><b>${value}</b></div>`;
    const h: string[] = [];
    h.push(`<div class="card review"><h3>시즌 ${s.season} 결산 <span class="mgr">감독 ${s.managerName}</span><span>${me.name}</span></h3>
      <div class="rvTitle">${pos}위 <small>/ ${n}팀 · ${mine.pts}점</small></div>
      <div class="hint">${verdict}</div>
      <div class="stats">
        ${stat("리그 우승", `<span class="dot" style="background:${champ.color}"></span>${champ.name}`)}
        ${stat(`${CUP_NAME} 우승`, s.cup.holder !== undefined ? clubOf(s, s.cup.holder).name : "미정")}
        ${stat("우리 팀 컵 성적", cupText)}
        ${stat("승 / 무 / 패", `${mine.won} / ${mine.drawn} / ${mine.lost}`)}
        ${stat("득 / 실", `${mine.gf} / ${mine.ga} (${mine.gf - mine.ga > 0 ? "+" : ""}${mine.gf - mine.ga})`)}
        ${stat("예산 변화", `<span style="color:${budgetDelta >= 0 ? "var(--good)" : "var(--bad)"}">${budgetDelta >= 0 ? "+" : ""}${budgetDelta}억</span> <small>${me.seasonStartBudget}억 → ${me.budget}억${cupPrize(s, me.id) ? ` · 컵 상금 ${cupPrize(s, me.id)}억` : ""}</small>`)}
        ${stat("팀 내 최다 득점", myTop && myTop.stats.goals > 0 ? `${myTop.name} ${myTop.stats.goals}골` : "—")}
        ${stat("팀 내 최다 출장", myApps && myApps.stats.apps > 0 ? `${myApps.name} ${myApps.stats.apps}경기` : "—")}
        ${stat("유스 승격", `${promoted}명`)}
        ${stat("올해의 감독", moy ? `${moy.club === me.id ? '<span style="color:var(--accent)">' : ""}${moy.name}${moy.club === me.id ? "</span>" : ""} <small>${clubOf(s, moy.club).shortName} · 기대 ${moy.expected}위 → ${moy.position}위</small>` : "—")}
        ${stat("이사회 기대치", `${myExpected}위 <small>→ ${pos}위 (${pos <= myExpected ? "달성" : "미달"})</small>`)}
        ${stat("이사회 신뢰도", `<span style="color:${confidenceBand(s.board.confidence) === "good" ? "var(--good)" : confidenceBand(s.board.confidence) === "bad" ? "var(--bad)" : "var(--text)"}">${Math.round(s.board.confidence)}</span> <small>${s.board.confidence >= TRUST_AT ? "신임 예상" : s.board.confidence < 35 ? "경질 위기" : "유임"}${s.board.warnings ? ` · 경고 ${s.board.warnings}회` : ""}</small>`)}
        ${stat("팀 내 최고 평점", myBest ? `${myBest.name} ${fmtRating(avgRating(myBest))} <small>${myBest.stats.motm ?? 0} MOTM</small>` : "—")}
      </div>
      <div class="actions" style="margin-top:8px"><button class="primary" data-act="nextSeason">다음 시즌 시작 →</button><button data-act="home">홈으로</button></div>
      <div class="hint">다음 시즌 시작 시 나이·성장·계약 만료·순위 상금이 정산되고 새 일정과 컵 대진이 만들어집니다.</div></div>`);
    h.push(`<div class="grid2">`);
    h.push(`<div class="card"><h3>최종 순위 <span>하위 2팀 강등권</span></h3>${this.tableHtml(rows).replace(/<tr class="([^"]*)"><td>(\d+)<\/td>/g, (_m, cls: string, p: string) => `<tr class="${cls}${Number(p) > n - 2 ? " rel" : ""}"><td>${p}${Number(p) > n - 2 ? '<small class="relTag">강등권</small>' : ""}</td>`)}</div>`);
    h.push(`<div class="card"><h3>리그 득점 TOP 3</h3>${scorers.length ? `<table class="std"><thead><tr><th>#</th><th class="l">선수</th><th class="l">클럽</th><th>출장</th><th>골</th></tr></thead><tbody>${scorers
      .map((x, i) => `<tr class="${x.club.id === me.id ? "me" : ""}"><td>${i + 1}</td><td class="l">${x.player.name}</td><td class="l">${x.club.shortName}</td><td>${x.player.stats.apps}</td><td><b>${x.player.stats.goals}</b></td></tr>`).join("")}</tbody></table>` : '<div class="hint">득점 기록이 없습니다.</div>'}
      <h3 style="margin-top:10px">시즌 소식 하이라이트</h3><div class="news">${highlights.map((x) => `<div>${x}</div>`).join("") || "<div>특별한 소식이 없었습니다.</div>"}</div></div>`);
    h.push(`</div>`);
    // --- market, venue split, finances, injuries, history
    const mk = marketSummary(s, s.season);
    const ha = homeAwayRecord(s, me.id);
    const fin = financeSummary(s, me.id);
    const injuries = me.seasonInjuries ?? 0;
    const money = (x: number) => `${Math.round(x * 10) / 10}억`;
    const signed = (x: number) => `<span style="color:${x >= 0 ? "var(--good)" : "var(--bad)"}">${x >= 0 ? "+" : ""}${money(x)}</span>`;
    const dealList = (rows: typeof mk.userIn) => rows.length ? rows.map((e) => `<div>${e.text}</div>`).join("") : "<div>없음</div>";
    h.push(`<div class="grid2">`);
    h.push(`<div class="card review"><h3>이적 시장 요약 <span>시즌 ${s.season} 리그 전체</span></h3>
      <div class="stats">
        ${stat("이적", `${mk.transfers}건`)}
        ${stat("임대", `${mk.loans}건`)}
        ${stat("자유계약", `${mk.frees}건`)}
        ${stat("최고 이적료", mk.biggest ? `${mk.biggest.playerName} ${mk.biggest.fee}억` : "—")}
      </div>
      ${mk.biggest ? `<div class="hint">최대 거래: ${mk.biggest.text}</div>` : ""}
      <h3 style="margin-top:10px">우리 팀 영입 <span>${mk.userIn.length}명</span></h3><div class="news">${dealList(mk.userIn)}</div>
      <h3 style="margin-top:10px">우리 팀 방출·판매·임대 <span>${mk.userOut.length}명</span></h3><div class="news">${dealList(mk.userOut)}</div></div>`);
    h.push(`<div class="card review"><h3>홈/원정 성적 <span>승-무-패</span></h3>
      <div class="stats">
        ${stat("홈", `${ha.home.won}승 ${ha.home.drawn}무 ${ha.home.lost}패`)}
        ${stat("원정", `${ha.away.won}승 ${ha.away.drawn}무 ${ha.away.lost}패`)}
        ${stat("부상", `${injuries}건`)}
      </div>
      <h3 style="margin-top:10px">재정 요약 <span>억원</span></h3>
      <div class="stats">
        ${stat("시즌 시작 → 종료", `${money(fin.start)} → ${money(fin.end)} ${signed(fin.end - fin.start)}`)}
        ${stat("지급 연봉", `−${money(fin.wages)}`)}
        ${stat("수입 (입장·중계·후원)", `+${money(fin.revenue)}`)}
        ${stat("컵 상금", fin.cupPrize ? `+${money(fin.cupPrize)}` : "—")}
        ${stat("순위 상금 (다음 시즌 지급)", `+${money(fin.leaguePrize)}`)}
      </div>
      <div class="hint">순위 상금은 다음 시즌 시작 시 예산에 더해집니다. 이적료와 계약금은 시작 → 종료 차이에 이미 반영되어 있습니다.</div>
      ${s.seasonHistory.length ? `<h3 style="margin-top:10px">역대 시즌</h3><table class="std"><thead><tr><th>시즌</th><th class="l">리그 우승</th><th class="l">${CUP_NAME}</th><th>내 순위</th><th>승점</th><th class="l">올해의 감독</th></tr></thead><tbody>${[...s.seasonHistory].reverse()
        .map((r) => `<tr><td>S${r.season}</td><td class="l">${clubOf(s, r.champion).shortName}</td><td class="l">${r.cupWinner === null ? "—" : clubOf(s, r.cupWinner).shortName}</td><td>${r.userPosition}위</td><td>${r.userPts}</td><td class="l">${r.managerOfYear ? `${r.managerOfYear.name} (${clubOf(s, r.managerOfYear.club).shortName})` : "—"}</td></tr>`).join("")}</tbody></table>` : ""}</div>`);
    h.push(`</div>`);
    h.push(this.cupHtml());
    this.el.review.innerHTML = h.join("");
    this.el.review.querySelectorAll<HTMLButtonElement>("button[data-act]").forEach((b) => b.addEventListener("click", () => {
      if (b.dataset.act === "home") this.show("home");
      else this.act(b.dataset.act!);
    }));
  }

  // ------------------------------------------------------------ matchday
  /** The matches of the next matchday: the open cup ties on a cup day, otherwise the league round. */
  private buildLive(): { fixture: Fixture; match: Match; tie?: CupTie }[] {
    const s = this.state;
    if (s.pendingCupDay && !seasonOver(s)) {
      this.liveKind = "cup";
      return pendingCupTies(s).map((tie) => ({ fixture: cupFixture(tie), match: createCupMatch(s, tie), tie }));
    }
    this.liveKind = "league";
    return currentFixtures(s).filter((f) => !f.score).map((fixture) => ({ fixture, match: createMatch(s, fixture) }));
  }

  private startMatch(): void {
    const s = this.state;
    prepareRound(s);
    const live = this.buildLive();
    const user = live.find((x) => x.fixture.home === s.userClub || x.fixture.away === s.userClub);
    if (!user) return;
    this.live = live;
    const mine = user.fixture;
    const side: TeamId = mine.home === s.userClub ? 0 : 1;
    const others = this.live.filter((x) => x !== user).map((x) => ({ label: "", match: x.match }));
    this.el.tabMatch.disabled = false;
    this.renderAll();
    this.show("match");
    this.screen.start(user.match, side, others, () => this.finishRound());
  }

  /** Simulate n rounds back to back; rounds in between are settled silently, the last one is shown. */
  private async simRounds(n: number): Promise<void> {
    const s = this.state;
    for (let k = 0; k < n; k++) {
      if (seasonOver(s)) break;
      prepareRound(s);
      const cup = s.pendingCupDay && !seasonOver(s);
      this.liveKind = cup ? "cup" : "league";
      const label = cup ? `${CUP_NAME} ${CUP_STAGE_LABEL[s.cup.stage]} 시뮬레이션 중…` : n > 1 ? `라운드 ${s.round + 1} 시뮬레이션 중… (${k + 1}/${n})` : "라운드 시뮬레이션 중…";
      // Headless rounds run on the worker pool (parallel on multi-core phones; falls back to in-thread).
      const items = cup
        ? pendingCupTies(s).map((tie) => ({ fixture: cupFixture(tie), tie, job: cupJob(s, tie) }))
        : currentFixtures(s).filter((f) => !f.score).map((fixture) => ({ fixture, tie: undefined as CupTie | undefined, job: leagueJob(s, fixture) }));
      this.setBusy(label, 0);
      let results: Map<string, ReturnType<typeof asMatch> extends infer _M ? import("./sim/protocol").MatchResult : never>;
      try {
        results = await getSimPool().run(items.map((x) => x.job), (done, total) => this.setBusy(`${label} ${done}/${total}`, done / total));
      } finally {
        this.setBusy(null, 0);
      }
      this.live = items.map((x) => ({ fixture: x.fixture, tie: x.tie, match: asMatch(results.get(x.job.id)!) }));
      const last = k === n - 1 || seasonOver(s) || (!cup && s.round + 1 >= roundsPerSeason(s.clubs.length));
      if (last) {
        this.finishRound();
        return;
      }
      this.settleLive();
      if (cup) advanceCupDay(s);
      else advanceRound(s);
      prepareRound(s);
      this.save();
      await this.checkCelebrations();
      if (s.board.sacked) { this.renderAll(); this.renderSacked(); this.show("sacked"); return; }
    }
    this.renderAll();
    this.show("home");
  }

  /**
   * Title events, once per season: the league is decided (the leader is out of reach), or the user lifts the cup.
   * Shows the celebration overlay (a full one for the user's club) and posts the news line.
   */
  private async checkCelebrations(): Promise<void> {
    const s = this.state;
    if (s.celebratedSeason === s.season) return;
    const champ = titleClinched(s);
    if (champ === null) return;
    s.celebratedSeason = s.season;
    const rows = table(s);
    const lead = rows[0]!, second = rows[1]!;
    const total = roundsPerSeason(s.clubs.length);
    const left = total - lead.played;
    const club = clubOf(s, champ);
    const early = left > 0 ? `${left}경기를 남기고 ` : "";
    if (champ === s.userClub) {
      const me = this.me;
      const scorer = [...me.squad].sort((a, b) => b.stats.goals - a.stats.goals)[0];
      const best = [...me.squad].filter((p) => (p.stats.ratedApps ?? 0) >= RATING_MIN_APPS).sort((a, b) => avgRating(b) - avgRating(a))[0];
      const streak = s.seasonHistory.filter((r) => r.champion === me.id).length + 1;
      s.news.unshift(`🏆 ${me.name} ${early}리그 우승 확정! ${s.managerName} 감독의 ${streak === 1 ? "첫" : `통산 ${streak}번째`} 우승.`);
      this.save();
      this.renderAll();
      await celebrate({
        kind: "league",
        title: "리그 우승!",
        subtitle: `${me.name} · 시즌 ${s.season} 챔피언`,
        color: "#f2c14e",
        lines: [
          `${early}우승을 확정했습니다 (${lead.pts}점, 2위 ${clubOf(s, second.club).shortName}와 ${lead.pts - second.pts}점 차).`,
          `${lead.won}승 ${lead.drawn}무 ${lead.lost}패 · ${lead.gf}득점 ${lead.ga}실점`,
          scorer && scorer.stats.goals > 0 ? `팀 내 득점 1위: ${scorer.name} ${scorer.stats.goals}골` : "",
          best ? `최고 평점: ${best.name} ${avgRating(best).toFixed(2)}` : "",
          streak > 1 ? `${s.managerName} 감독 통산 ${streak}번째 리그 우승` : `${s.managerName} 감독의 첫 리그 우승`,
          "우승 상금은 시즌 결산 때 예산에 더해집니다.",
        ].filter(Boolean),
        button: "🎉 축하 받기",
      });
      return;
    }
    const myPos = rows.findIndex((r) => r.club === s.userClub) + 1;
    s.news.unshift(`${club.name} ${early}리그 우승 확정 (${lead.pts}점).`);
    this.save();
    this.renderAll();
    await celebrate({
      kind: "clinch",
      title: `${club.shortName} 우승 확정`,
      subtitle: `시즌 ${s.season} 리그 챔피언 · ${club.name}`,
      color: "#93a4b3",
      lines: [
        `${early}우승을 확정했습니다 (${lead.pts}점, 2위와 ${lead.pts - second.pts}점 차).`,
        club.manager ? `감독 ${club.manager.name}` : "",
        `우리 팀(${this.me.shortName})은 현재 ${myPos}위입니다.`,
      ].filter(Boolean),
      button: "닫기",
    });
  }

  /** Record every live match into the season state (shared by finishRound and multi-round sims). */
  private settleLive(): void {
    const s = this.state;
    if (!this.live) return;
    for (const { fixture, match, tie } of this.live) {
      if (tie ? tie.score : fixture.score) continue;
      if (tie) recordCupResult(s, tie, match);
      else recordResult(s, fixture, match);
      for (const side of [0, 1] as TeamId[]) {
        const club = clubOf(s, side === 0 ? fixture.home : fixture.away);
        if (club.id === s.userClub) {
          const t = match.teams[side].tactics;
          club.tactics = { ...t };
          if (t.formation !== club.selection.formation) club.selection = autoSelect(club, t.formation);
        }
      }
    }
    this.live = null;
  }

  private finishRound(): void {
    const s = this.state;
    if (!this.live) return;
    const round = s.round;
    const kind = this.liveKind;
    const cupStage = s.cup.stage;
    this.settleLive();
    this.screen.leave();
    this.save();
    this.renderAll();
    this.renderResults(round, kind, cupStage);
    this.show("results");
    if (kind === "cup" && cupStage === 3 && s.cup.holder === s.userClub && s.cupCelebratedSeason !== s.season) {
      s.cupCelebratedSeason = s.season;
      this.save();
      const me = this.me;
      const tie = [...s.cup.ties].reverse().find((t) => t.stage === 3 && (t.home === me.id || t.away === me.id));
      const opp = tie ? clubOf(s, tie.home === me.id ? tie.away : tie.home) : null;
      void celebrate({
        kind: "cup",
        title: `${CUP_NAME} 우승!`,
        subtitle: `${me.name} · 시즌 ${s.season}`,
        color: "#7ad0ff",
        lines: [
          opp && tie?.score ? `결승 ${tie.score[0]} - ${tie.score[1]} vs ${opp.name}${tie.penalties ? ` (승부차기 ${tie.penalties[0]}-${tie.penalties[1]})` : ""}` : "",
          `우승 상금 ${CUP_PRIZE.winner}억이 예산에 더해졌습니다.`,
          `${s.managerName} 감독, 이사회의 신뢰가 올라갑니다.`,
        ].filter(Boolean),
        button: "🏆 트로피 들어올리기",
      });
    }
  }

  private setBusy(label: string | null, frac: number): void {
    this.el.overlay.classList.toggle("show", label !== null);
    if (label !== null) {
      this.el.overlayText.textContent = label;
      this.el.overlayBar.style.width = `${Math.round(frac * 100)}%`;
    }
  }

  private runChunked(work: () => boolean, label: string): Promise<void> {
    this.el.overlay.classList.add("show");
    this.el.overlayText.textContent = label;
    const t0 = performance.now();
    let n = 0;
    return new Promise((resolve) => {
      const slice = () => {
        const done = work();
        n++;
        this.el.overlayBar.style.width = `${Math.min(100, (n / 190) * 100)}%`;
        if (done) {
          this.el.overlay.classList.remove("show");
          void t0;
          resolve();
        } else setTimeout(slice, 0);
      };
      setTimeout(slice, 0);
    });
  }
}

function describe(def: { lo: string; hi: string }, v: number): string {
  return v < 0.35 ? def.lo : v > 0.65 ? def.hi : "보통";
}
