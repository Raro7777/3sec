import { FORMATIONS, INSTRUCTION_IDS, INSTRUCTION_LABEL, ROLES, Rng, TACTIC_PRESETS, autoRoles, normalizeTactics, rolesForSlot, type CornerTarget, type FormationName, type InstructionId, type Match, type PlayerRoleId, type Tactics, type TeamId } from "@3sec/engine";

type SliderKey = "mentality" | "defensiveLine" | "pressing" | "directness" | "width" | "tempo" | "counter" | "engageLine";
import {
  CLUBS, SAVE_KEY, advanceRound, autoSelect, clubOf, createMatch, currentFixtures, deserialize, isAvailable, newGame, nextUserFixture,
  overall, playerOf, prepareRound, recordResult, seasonRounds, seasonOver, selectionProblem, serialize, slotFit, startNextSeason,
  swap, table, topScorers, type Club, type Fixture, type GameState, type SquadPlayer,
  MAX_SQUAD, MIN_SQUAD, bestOffer, playerValue, sellPlayer, transferTargets, windowOpen, deadlineDay, makeBid, openOffers, acceptOffer, rejectOffer, respondToCounter,
  freeAgentTerms, signFreeAgent, loanableOut, loanDestination, loanOut, loanTargets, loanIn, type BidResult,
  FOCUS_LABEL, INTENSITY_LABEL, expiringContracts, renewContract, renewalTerms, wageBill, type TrainingFocus, type TrainingIntensity,
  COACHING, LEAVE_AGE, MAX_PROSPECTS, MIN_PROMOTE_AGE, SCOUTING, promoteProspect, prospectOverall, releaseProspect, youthWeeklyCost, type ScoutingTier,
  CUP_NAME, CUP_PRIZE, CUP_ROUNDS, CUP_STAGE_LABEL, advanceCupDay, createCupMatch, cupByes, cupDone, cupFixture, cupPrize, pendingCupTies, recordCupResult,
  tieWinner, userCupStatus, userEnteredCup, userCupTie, type CupTie,
  marketSummary, homeAwayRecord, financeSummary,
  managerTags, managerOfYear, expectedPositions, type Manager,
  ATTR_LABEL, RATING_MIN_APPS, avgRating, topAssists, topRatings,
  BOARD_FROM_ROUND, TRUST_AT, WARN_BELOW, acceptJob, confidenceBand, jobOffers, userExpectation, userPosition,
  titleClinched,
  MAX_STAFF, STAFF_ROLE_LABEL, ensureStaffMarket, expiringStaff, fireStaff, hireStaff, renewStaff, staffRenewalFee, staffRoomProblem, staffSeverance, staffSigningFee, staffWageBill, staffStyleTags, type StaffMember,
  avgHomeAttendance, clubCapacity, moodBand, moodLabel,
  expectedAttendance, fixtureSeed, penaltyShootoutDetail, type ShootoutDetail,
  EXPANSION_STEP, KIT_PATTERNS, KIT_PATTERN_LABEL, CLUB_NAME_MAX, SHORT_NAME_MAX, STADIUM_NAME_MAX, expandStadium, expansionAdvice, renameClub, renameStadium, resetClubKit, setClubKit, type ClubKit, type KitPatternName,
} from "@3sec/game";
import {
  CLUBS_D2, DIVISIONS, SWAP, divisionName, divisionOf, userDivision, inPromotionZone, inRelegationZone,
  MIN_WINDOW_MINUTES, formatValue, lineSwing, type TacticsReport,
} from "@3sec/game";
import {
  ACHIEVEMENTS, TIER_LABEL, achievementById, hallOfFame, takeFreshAchievements, type AchievementTier,
  repStars, repLabel, managerRep, pendingJobOffer, contractExpiring, acceptContract, counterContract, declineContract, acceptJobOffer, declineJobOffer, careerJobOffers,
} from "@3sec/game";
import {
  clubLore, derbyFor, answerInterview, resolveEvent, pendingEvents, setCaptain, moraleOf, moraleLabel, moraleBand, personalityTags, captainOf, type InterviewOption,
} from "@3sec/game";
import { stadiumFor } from "./stadiums";
import { alternateKit, kitForClub, kitTextColor, paintKit, type Kit } from "./kits";
import { emblemSvg } from "./emblem";
import { portraitSvg } from "./portrait";
import { managerArt, userArt } from "./manager-art";
import { DIFFICULTIES, DIFFICULTY_ORDER, difficultyOf, type Difficulty, parseRoster, rosterTemplate, buildClubs, type RosterPack } from "@3sec/game";

const ROSTER_KEY = "3sec.roster";
const escHtml = (x: string): string => x.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
/** The roster pack kept on this device (settings screen), or null for the fictional world. */
function loadRosterPack(): RosterPack | null {
  try { const raw = localStorage.getItem(ROSTER_KEY); if (!raw) return null; return parseRoster(raw).pack; } catch { return null; }
}
import { canvasBlob, downloadsBlocked, isNativeApp, drawSeasonCard, shareFile } from "./share";
import { celebrate } from "./celebrate";
import { CHALLENGES, applyScenario, buildChallenge, challengeById, challengeOutcome, clearChallengeRecords, loadChallengeRecords, recordChallenge, stars as chalStars, type ChallengeScenario } from "./challenge";
import type { Attributes } from "@3sec/engine";
import { MatchScreen } from "./match-screen";
import { formationSvg } from "./formation-svg";
import { getSimPool } from "./sim/pool";
import { asMatch, cupJob, leagueJob } from "./sim/adapter";

type ScreenName = "home" | "squad" | "table" | "transfers" | "youth" | "results" | "match" | "guide" | "onboarding" | "review" | "settings" | "profile" | "sacked";
const SLOT_KEY = (n: number) => `3sec.slot.${n}`;
/** Rolling automatic backups: three snapshots, oldest overwritten first (see `backupNow`). */
const AUTO_KEY = (n: number) => `3sec.auto.${n}`;
const AUTO_SLOTS = [1, 2, 3];
/** When the last automatic backup was taken, so the timer survives a reload. */
const AUTO_AT_KEY = "3sec.auto.at";
const AUTO_EVERY_MS = 30 * 60 * 1000;
const APP_VERSION = "0.23";

/** Rough category of a news line, for the home-screen filter chips. */
export function newsKind(n: string): "market" | "fans" | "board" | "squad" | "comp" | "other" {
  if (/이적|영입|판매|자유계약|임대|계약|제안|호가|은퇴/.test(n)) return "market";
  if (/팬|관중|매진|시위|응원/.test(n)) return "fans";
  if (/이사회|경질|신뢰|감독직|연봉 협상|재계약 협상/.test(n)) return "board";
  if (/부상|퇴장|경고|출장 정지|사기|불만|주장|국가대표|데뷔|유스|유망주|승격|훈련/.test(n)) return "squad";
  if (/우승|컵|더비|라이벌|결승|승부차기|업적|올해의 감독|시즌/.test(n)) return "comp";
  return "other";
}
export function newsIcon(n: string): string {
  const k = newsKind(n);
  if (/업적/.test(n)) return "🏅";
  if (/우승/.test(n)) return "🏆";
  if (/더비|라이벌/.test(n)) return "⚔️";
  if (/부상/.test(n)) return "🩹";
  if (/퇴장|출장 정지/.test(n)) return "🟥";
  if (/유스|유망주|승격|데뷔/.test(n)) return "🌱";
  return k === "market" ? "🔁" : k === "fans" ? "📣" : k === "board" ? "🏛️" : k === "squad" ? "👤" : k === "comp" ? "🎽" : "📰";
}

/** One-line character per club for the club picker (indexed like CLUBS). */
/** Every club a new manager can pick, in club-id order: the top flight, then the division below. */
const WORLD_CLUBS = [...CLUBS, ...CLUBS_D2];

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
  // second division (world.ts CLUBS_D2), in the same id order — a harder start with promotion to chase
  "2부 최강 후보, 한 시즌 만의 승격을 노린다",
  "지난 시즌 승격 실패, 스쿼드는 그대로 남았다",
  "젊은 팀에 재정은 여유롭다, 시간이 필요하다",
  "수비는 단단하지만 골이 부족하다",
  "해안 도시의 스리백, 홈에서는 강하다",
  "성실한 중위권, 한 방이 아쉽다",
  "만성 자금난, 유스로 버티는 구단",
  "승격과 강등을 오간 엘리베이터 팀",
  "작은 구장, 뜨거운 응원",
  "공격적이지만 기복이 심하다",
  "재건 첫 시즌, 기대치는 낮다",
  "리그 최약체, 살아남는 것이 목표",
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
/** A player's face, collar in the club colour (portrait.ts). Deterministic per player, no asset to load. */
const face = (p: { id: string; age: number }, club: { color: string } | null | undefined, size: number): string =>
  portraitSvg({ id: p.id, age: p.age, color: club?.color }, size);

/** The home ground as a painted strip (public/art/stadium-NN.webp, by club id) with its name and seats. */
const venueHtml = (c: Club, seats: number): string =>
  `<div class="venue"><img class="venueArt" src="./art/stadium-${String(c.id).padStart(2, "0")}.webp" alt="" loading="lazy"><span class="venueCap">${c.stadiumName ?? stadiumFor(c.baseName ?? c.name).name} · ${seats.toLocaleString("ko-KR")}석</span></div>`;

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
  /** The last watched match's before/after readout of the manager's own changes (tactics-report.ts). */
  private lastTactics: TacticsReport | null = null;
  /** the running 도전 모드 match (outside the season: never settled, never saved) */
  private challenge: { scen: ChallengeScenario; match: Match; side: TeamId } | null = null;
  private selA: string | null = null;
  private current: ScreenName = "home";
  private pickedClub: number | null = null;
  private pickedDifficulty: Difficulty = "normal";
  /** where the profile screen returns to */
  private profileFrom: ScreenName = "squad";
  /** active sub-tab per screen (persisted) */
  private tabSel: Record<string, string> = (() => { try { return JSON.parse(localStorage.getItem("3sec.tabs") ?? "{}") as Record<string, string>; } catch { return {}; } })();
  /** the player waiting in the compare tray */
  private comparePick: { club: number; id: string } | null = null;
  /** a failed save is reported once per session, not on every action */
  private saveWarned = false;
  /** when the last automatic backup was taken (epoch ms; restored from storage) */
  private lastAutoAt: number = (() => { try { return Number(localStorage.getItem(AUTO_AT_KEY)) || 0; } catch { return 0; } })();
  private readonly sheet = document.getElementById("sheet") as HTMLDivElement;
  private readonly sheetBody = document.getElementById("sheetBody") as HTMLDivElement;
  /** while the shoot-out is being revealed the sheet cannot be dismissed by tapping outside */
  private sheetLock = false;
  private readonly cta = document.getElementById("cta") as HTMLButtonElement;

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
    this.sheet.querySelector(".sheetBack")!.addEventListener("click", () => this.closeSheet());
    this.sheetBody.addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>("[data-sheet]");
      if (b) this.sheetAction(b.dataset.sheet!, b.dataset);
    });
    this.cta.addEventListener("click", () => this.ctaAction());
    this.applyFontSize(this.fontSize());
    (window as unknown as { __fm?: Game }).__fm = this; // test hook (Playwright drives the UI through it)
    this.renderGuide();
    if (!saved) {
      this.startOnboarding();
      return;
    }
    this.renderAll();
    this.showFirstScreen();
  }

  private fontSize(): "s" | "m" | "l" {
    try { const v = localStorage.getItem("3sec.fs"); return v === "s" || v === "l" ? v : "m"; } catch { return "m"; }
  }

  private applyFontSize(k: "s" | "m" | "l"): void {
    try { localStorage.setItem("3sec.fs", k); } catch { /* ignore */ }
    document.body.classList.toggle("fs-s", k === "s");
    document.body.classList.toggle("fs-l", k === "l");
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

  /** Settings: the roster pack on this device (roster.ts). Applies to new games only. */
  private rosterCardHtml(): string {
    const pack = loadRosterPack();
    const cur = this.state.roster;
    return `<div class="card"><h3>로스터 팩 <span>${pack ? `${pack.name} · ${pack.clubs.length}개 구단` : "없음"}</span></h3>
      <div class="hint">구단·선수 이름을 담은 JSON 파일을 불러오면 <b>새 게임</b>을 시작할 때 적용됩니다. 진행 중인 게임${cur ? `(현재: ${cur})` : ""}은 바뀌지 않습니다. 파일은 이 기기에만 저장되고, 게임에는 가상의 구단과 선수만 들어 있습니다. 만드는 법은 저장소의 tools/roster를 보세요.</div>
      <div class="actions"><label style="cursor:pointer"><input type="file" id="setRosterFile" accept=".json,application/json" style="display:none"><span style="border:1px solid #2c3d4b;border-radius:6px;padding:6px 10px;background:#1a2530;color:var(--text)">로스터 파일 불러오기</span></label><button data-set="rosterTemplate">템플릿 복사</button>${pack ? '<button class="danger" data-set="rosterClear">해제</button>' : ""}</div>
      <div class="hint" id="rosterMsg"></div></div>`;
  }

  private bindRosterCard(): void {
    const root = this.el.settings;
    const msg = () => root.querySelector<HTMLElement>("#rosterMsg")!;
    root.querySelector<HTMLInputElement>("#setRosterFile")?.addEventListener("change", async (e) => {
      const f = (e.target as HTMLInputElement).files?.[0];
      if (!f) return;
      const text = await f.text();
      const { pack, errors } = parseRoster(text);
      if (!pack) { msg().innerHTML = `<span style="color:var(--bad)">불러오지 못했습니다:</span><br>${errors.slice(0, 6).map(escHtml).join("<br>")}${errors.length > 6 ? `<br>… 외 ${errors.length - 6}건` : ""}`; return; }
      try { localStorage.setItem(ROSTER_KEY, JSON.stringify(pack)); } catch { msg().textContent = "저장 공간이 부족합니다."; return; }
      this.renderSettings();
      this.el.settings.querySelector<HTMLElement>("#rosterMsg")!.textContent = `"${pack.name}" 적용 준비 완료. 설정의 새 게임 시작으로 시작하세요.`;
    });
    root.querySelector('[data-set="rosterClear"]')?.addEventListener("click", () => { try { localStorage.removeItem(ROSTER_KEY); } catch { /* ignore */ } this.renderSettings(); });
    root.querySelector('[data-set="rosterTemplate"]')?.addEventListener("click", async () => {
      const text = JSON.stringify(rosterTemplate(buildClubs(1)), null, 1);
      try { await navigator.clipboard.writeText(text); msg().textContent = "24개 슬롯 템플릿을 클립보드에 복사했습니다. 이름을 채워 JSON 파일로 저장하세요."; }
      catch { msg().textContent = "클립보드에 복사하지 못했습니다."; }
    });
  }

  private renderOnboarding(): void {
    const stars = (n: number) => `<span class="stars" title="전력 ${n}/5">${"★".repeat(n)}<i>${"★".repeat(5 - n)}</i></span>`;
    const h: string[] = [];
    h.push(`<div class="card onb-welcome"><img class="onbArt" src="./art/splash.webp" alt=""><h3>환영합니다</h3>
      <div class="onb-title">가난한자의 FM에 오신 것을 환영합니다</div>
      <div class="hint">1부·2부 각각 12개 구단이 22라운드 리그를 치릅니다. 매 시즌 1부 하위 2팀이 강등되고 2부 상위 2팀이 승격합니다. 감독 이름을 정하고 이끌 팀을 하나 고르세요.</div>
      <div class="hint" style="color:var(--accent)">커리어 모드 추천: 평판 낮은 구단에서 시작하세요. 기대를 넘는 성적은 감독 평판을 빠르게 올리고, 시즌 중 큰 구단의 감독직 제안으로 이어집니다.</div>
      <label style="margin-top:4px">감독 이름 <input id="onbName" type="text" placeholder="감독 이름" maxlength="12" autocomplete="off" /></label>
      <div class="hint">비워두면 "감독"으로 불립니다.</div>
      <div class="onb-diff-title">난이도 <small>시작 후에는 바꿀 수 없습니다</small></div>
      <div class="onb-diff">${DIFFICULTY_ORDER.map((d) => `<button type="button" class="diff-card${this.pickedDifficulty === d ? " sel" : ""}" data-diff="${d}"><b>${DIFFICULTIES[d].label}</b><small>${DIFFICULTIES[d].blurb}</small></button>`).join("")}</div></div>`);
    // Both divisions are on offer: starting below is the harder career, with promotion to chase.
    // A roster pack on this device renames the slots it covers (settings → 로스터 팩).
    const pack = loadRosterPack();
    const packed = new Map((pack?.clubs ?? []).map((c) => [c.slot, c]));
    if (pack) h.push(`<div class="card" style="border-color:var(--accent)"><h3>로스터 팩 <span>${pack.clubs.length}개 구단</span></h3><div class="hint">"${pack.name}"이(가) 적용됩니다. 이 기기에만 저장된 파일이며 게임에 기본 포함된 것이 아닙니다. 설정에서 해제할 수 있습니다.</div></div>`);
    const world = [...CLUBS.map((c) => ({ c, d: 1 })), ...CLUBS_D2.map((c) => ({ c, d: 2 }))].map(({ c, d }, i) => {
      const r = packed.get(i);
      return { d, c: r ? { ...c, name: r.name, shortName: r.shortName, color: r.color ?? c.color, reputation: r.reputation ?? c.reputation } : c };
    });
    for (const d of [1, 2]) {
      h.push(`<div class="card"><h3>${divisionName(d)} <span>${d === 1 ? "카드를 눌러 선택" : "어려운 시작 · 승격이 목표"}</span></h3><div class="club-grid">`);
      world.forEach(({ c, d: cd }, i) => {
        if (cd !== d) return;
        const n = clubStars(c.reputation);
        h.push(`<button type="button" class="club-card${this.pickedClub === i ? " sel" : ""}" data-club="${i}" style="--club:${c.color}">
          <div class="cc-head">${emblemSvg({ id: i, name: c.name, shortName: c.shortName, color: c.color }, 22)}<b>${c.name}</b><small>${c.shortName}</small></div>
          <div class="cc-meta">${stars(n)}<span class="cc-form">${c.formation}</span></div>
          <div class="cc-blurb">${packed.has(i) ? "로스터 팩" : CLUB_BLURBS[i] ?? ""}</div>
        </button>`);
      });
      h.push(`</div></div>`);
    }
    h.push(`<div class="actions onb-actions"><button class="primary" id="onbStart" ${this.pickedClub === null ? "disabled" : ""}>이 팀으로 시작 →</button><span class="hint" id="onbHint">${this.pickedClub === null ? "팀을 먼저 선택하세요." : `${WORLD_CLUBS[this.pickedClub]!.name} 감독으로 시작합니다.`}</span></div>`);
    this.el.onboarding.innerHTML = h.join("");

    const nameInput = document.getElementById("onbName") as HTMLInputElement;
    const startBtn = document.getElementById("onbStart") as HTMLButtonElement;
    const hint = document.getElementById("onbHint")!;
    this.el.onboarding.querySelectorAll<HTMLButtonElement>(".club-card").forEach((b) => b.addEventListener("click", () => {
      this.pickedClub = Number(b.dataset.club);
      this.el.onboarding.querySelectorAll<HTMLElement>(".club-card").forEach((x) => x.classList.toggle("sel", x === b));
      startBtn.disabled = false;
      hint.textContent = `${WORLD_CLUBS[this.pickedClub]!.name} 감독으로 시작합니다.`;
    }));
    this.el.onboarding.querySelectorAll<HTMLButtonElement>(".diff-card").forEach((b) => b.addEventListener("click", () => {
      this.pickedDifficulty = b.dataset.diff as Difficulty;
      this.el.onboarding.querySelectorAll<HTMLElement>(".diff-card").forEach((x) => x.classList.toggle("sel", x === b));
    }));
    nameInput.addEventListener("keydown", (e) => { if (e.key === "Enter" && !startBtn.disabled) startBtn.click(); });
    startBtn.addEventListener("click", () => {
      if (this.pickedClub === null) return;
      this.finishOnboarding(this.pickedClub, nameInput.value);
    });
  }

  private finishOnboarding(club: number, name: string): void {
    this.state = newGame(Math.floor(Math.random() * 1e6) + 1, club, name.trim() || "감독", this.pickedDifficulty, loadRosterPack());
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
    this.el.guide.innerHTML = `<div class="card guide"><h3>설명서 <span>가난한자의 FM · 만든이 raro</span></h3>
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
      <li>홈 화면의 <b>이사회 신뢰도</b>(0~100, 시작 60 · 난이도에 따라 55~65)는 ${BOARD_FROM_ROUND}라운드부터 매주 움직입니다. 목표치는 <b>평판 순 기대 순위</b>와 실제 순위의 차이(한 계단 7점)와 최근 5경기 승점으로 정해지고, 매주 그 차이의 1/4만큼 다가갑니다. 컵에서 이기면 +5.</li>
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
    let data: string;
    try {
      data = serialize(this.state);
    } catch {
      this.warnSaveFailed();
      return;
    }
    if (!this.writeKey(SAVE_KEY, data)) {
      // Out of room: the live save matters more than an old snapshot, so free one and try again.
      this.dropOldestAuto();
      if (!this.writeKey(SAVE_KEY, data)) this.warnSaveFailed();
    }
    this.maybeAutoBackup();
  }

  // ------------------------------------------------------------ automatic backups
  /** One guarded localStorage write; false when storage refused it (quota, disabled, private mode). */
  private writeKey(key: string, value: string): boolean {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  }

  /** Warn once per session that the game can no longer be written to this device. */
  private warnSaveFailed(): void {
    if (this.saveWarned) return;
    this.saveWarned = true;
    alert("저장에 실패했습니다. 기기 저장 공간이 부족하거나 브라우저가 저장을 막고 있습니다.\n설정 화면에서 '파일로 내보내기' 또는 '텍스트 복사'로 지금 백업해 두세요.");
  }

  private autoInfo(n: number): { savedAt: string; label: string; data: string } | null {
    try {
      const raw = localStorage.getItem(AUTO_KEY(n));
      return raw ? (JSON.parse(raw) as { savedAt: string; label: string; data: string }) : null;
    } catch {
      return null;
    }
  }

  /** The stored automatic backups, newest first. */
  private autoBackups(): { n: number; info: { savedAt: string; label: string; data: string } }[] {
    return AUTO_SLOTS.map((n) => ({ n, info: this.autoInfo(n) }))
      .filter((x): x is { n: number; info: { savedAt: string; label: string; data: string } } => !!x.info)
      .sort((a, b) => Date.parse(b.info.savedAt) - Date.parse(a.info.savedAt));
  }

  /** Remove the oldest automatic backup (optionally keeping one slot). Returns true if one went. */
  private dropOldestAuto(keep?: number): boolean {
    const stored = this.autoBackups().filter((x) => x.n !== keep);
    const victim = stored[stored.length - 1];
    if (!victim) return false;
    try { localStorage.removeItem(AUTO_KEY(victim.n)); } catch { /* ignore */ }
    return true;
  }

  /**
   * Take an automatic snapshot into the free slot, or over the oldest one. Never throws: a backup that
   * cannot be written (quota, storage off) drops the oldest snapshot and retries once, then gives up.
   */
  private backupNow(): void {
    let entry: string;
    try {
      entry = JSON.stringify({ savedAt: new Date().toISOString(), label: this.stateLabel(), data: serialize(this.state) });
    } catch {
      return;
    }
    const slots = AUTO_SLOTS.map((n) => ({ n, info: this.autoInfo(n) }));
    const free = slots.find((x) => !x.info);
    const oldest = slots.filter((x) => x.info).sort((a, b) => Date.parse(a.info!.savedAt) - Date.parse(b.info!.savedAt))[0];
    const target = (free ?? oldest)?.n;
    if (target === undefined) return;
    // Mark the attempt even if it fails, so a full device is not retried on every single action.
    this.lastAutoAt = Date.now();
    this.writeKey(AUTO_AT_KEY, String(this.lastAutoAt));
    if (this.writeKey(AUTO_KEY(target), entry)) return;
    if (this.dropOldestAuto(target)) this.writeKey(AUTO_KEY(target), entry);
  }

  /** Time-based backup: at most one every ~30 minutes of play, so a long season is covered too. */
  private maybeAutoBackup(): void {
    if (Date.now() - this.lastAutoAt < AUTO_EVERY_MS) return;
    this.backupNow();
  }

  // ------------------------------------------------------------ navigation
  private show(name: ScreenName): void {
    if (this.current === "match" && name !== "match") this.screen.leave();
    this.current = name;
    for (const s of document.querySelectorAll<HTMLElement>(".screen")) s.classList.toggle("active", s.id === `screen-${name}`);
    for (const b of document.querySelectorAll<HTMLButtonElement>("#nav button.tab")) b.classList.toggle("active", b.dataset.screen === name);
    this.closeSheet();
    this.updateCta();
    window.dispatchEvent(new Event("resize"));
  }

  private renderAll(): void {
    const s = this.state;
    this.el.season.textContent = `${s.managerName} 감독 · 시즌 ${s.season} · ${s.pendingCupDay && !seasonOver(s) ? `컵 ${CUP_STAGE_LABEL[s.cup.stage] ?? ""}` : `${Math.min(s.round + 1, seasonRounds(s))}/${seasonRounds(s)}R`}`;
    this.el.tabMatch.disabled = !this.live && !this.challenge;
    this.renderHome();
    this.renderSquad();
    this.renderTable();
    this.renderTransfers();
    this.renderYouth();
    this.renderSettings();
    this.updateCta();
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
    return `${st.managerName} 감독 · ${c.name} · 시즌 ${st.season} ${Math.min(st.round + 1, seasonRounds(st))}R`;
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
    const autos = this.autoBackups();
    this.el.settings.innerHTML = `<div class="card"><h3>설정 <span>가난한자의 FM v${APP_VERSION} · 만든이 raro</span></h3>
      <div class="hint">현재 게임: <b>${this.stateLabel()}</b> — 진행 상황은 매 조작마다 자동 저장됩니다. 아래 슬롯은 별도 백업이고, 파일로 내보내면 다른 기기로 옮길 수 있습니다.</div>
      <div class="actions" style="margin-top:6px"><button data-set="guide">📖 설명서 보기</button><button class="danger" data-set="newGame">새 게임 시작</button></div>
      <div class="actions" style="margin-top:4px;align-items:center"><span class="hint">글자 크기</span>${(["s", "m", "l"] as const).map((k) => `<button data-fs="${k}" class="${this.fontSize() === k ? "primary" : ""}">${k === "s" ? "작게" : k === "m" ? "보통" : "크게"}</button>`).join("")}</div></div>
    <div class="card"><h3>저장 슬롯</h3>${slots
      .map(({ n, info }) => `<div class="slot"><div><div>슬롯 ${n}</div><div class="meta">${info ? `${info.label}<br>${new Date(info.savedAt).toLocaleString("ko-KR")}` : "비어 있음"}</div></div>
        <div class="btns"><button data-slot-save="${n}">저장</button><button data-slot-load="${n}" ${info ? "" : "disabled"}>불러오기</button><button class="danger" data-slot-del="${n}" ${info ? "" : "disabled"}>삭제</button></div></div>`)
      .join("")}</div>
    <div class="card"><h3>자동 백업 <span>최근 ${AUTO_SLOTS.length}개</span></h3>
      <div class="hint">시즌이 시작될 때마다, 그리고 오래 플레이하면 30분마다 자동으로 백업이 남습니다. 최근 ${AUTO_SLOTS.length}개만 보관하고 오래된 것부터 덮어씁니다.</div>
      ${autos.length
        ? autos.map(({ n, info }) => `<div class="slot"><div><div>자동 백업</div><div class="meta">${info.label}<br>${new Date(info.savedAt).toLocaleString("ko-KR")}</div></div>
          <div class="btns"><button data-auto-load="${n}">불러오기</button></div></div>`).join("")
        : '<div class="slot"><div><div>자동 백업</div><div class="meta">아직 없습니다. 다음 시즌이 시작되면 만들어집니다.</div></div></div>'}</div>
    <div class="card"><h3>파일로 저장 / 불러오기 <span>기기 간 이동</span></h3>
      <div class="actions"><button data-set="export">파일로 내보내기</button><button data-set="share">공유하기</button><button data-set="copy">텍스트 복사</button><label style="cursor:pointer"><input type="file" id="setImportFile" accept=".json,application/json,text/plain" style="display:none"><span style="border:1px solid #2c3d4b;border-radius:6px;padding:6px 10px;background:#1a2530;color:var(--text)">파일에서 불러오기</span></label></div>
      <div class="hint" style="margin-top:6px">붙여넣기로 불러오기: 저장 텍스트를 아래에 붙여 넣고 버튼을 누르세요.</div>
      <textarea id="setImportText" placeholder='{"version":1, ...}'></textarea>
      <div class="actions"><button data-set="importText">텍스트에서 불러오기</button></div></div>
    <div class="card"><h3>난이도 <span>${difficultyOf(s).label}</span></h3><div class="hint">${difficultyOf(s).blurb} 난이도는 새 게임을 시작할 때만 고를 수 있습니다.</div></div>
    ${this.rosterCardHtml()}
    <div class="card"><h3>구단 꾸미기 <span>${s.clubs[s.userClub]?.name ?? ""}</span></h3><div class="actions"><button data-set="customize">🎨 유니폼 · 구단명 · 홈구장</button></div><div class="hint">유니폼 색과 패턴, 구단명, 구장 이름을 바꾸고 예산으로 좌석을 늘립니다. 홈 화면의 구단명을 눌러도 열립니다.</div></div>
    <div class="card"><h3>데이터</h3><div class="actions"><button class="danger" data-set="wipe">모든 데이터 초기화</button></div><div class="hint">자동 저장과 슬롯, 자동 백업을 모두 지우고 처음 화면으로 돌아갑니다.</div></div>`;

    this.el.settings.insertAdjacentHTML("beforeend", this.challengeCardHtml(true));
    this.wireChallenge(this.el.settings);
    const q = (sel: string) => this.el.settings.querySelector<HTMLElement>(sel)!;
    // The claude.ai artifact viewer blocks page-initiated downloads; there the share/copy paths remain.
    if (location.hostname.endsWith("claude.ai")) q('[data-set="export"]').style.display = "none";
    q('[data-set="guide"]').addEventListener("click", () => this.show("guide"));
    this.el.settings.querySelectorAll<HTMLButtonElement>("button[data-fs]").forEach((b) => b.addEventListener("click", () => { this.applyFontSize(b.dataset.fs as "s" | "m" | "l"); this.renderSettings(); }));
    q('[data-set="newGame"]').addEventListener("click", () => this.act("newGame"));
    q('[data-set="customize"]').addEventListener("click", () => this.openCustomizeSheet());
    this.bindRosterCard();
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
    for (const { n } of autos) {
      this.el.settings.querySelector(`[data-auto-load="${n}"]`)!.addEventListener("click", () => {
        const info = this.autoInfo(n);
        if (!info) return;
        if (this.live && !confirm("진행 중인 경기가 있습니다. 불러오면 그 경기는 사라집니다. 계속할까요?")) return;
        if (!confirm(`${info.label} 을(를) 불러올까요? 현재 게임은 덮어쓰입니다.`)) return;
        const st = deserialize(info.data);
        if (!st) { alert("자동 백업 데이터가 손상되었습니다."); return; }
        this.applyLoaded(st, "자동 백업");
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
      if (!confirm("자동 저장과 슬롯, 자동 백업을 모두 지웁니다. 정말 초기화할까요?")) return;
      try {
        localStorage.removeItem(SAVE_KEY);
        [1, 2, 3].forEach((n) => localStorage.removeItem(SLOT_KEY(n)));
        AUTO_SLOTS.forEach((n) => localStorage.removeItem(AUTO_KEY(n)));
        localStorage.removeItem(AUTO_AT_KEY);
        localStorage.removeItem("3sec.guide.seen");
      } catch { /* ignore */ }
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
    h.push(`<div class="card"><h3><span data-customize title="구단 꾸미기" style="cursor:pointer;white-space:nowrap">${me.name} <small style="color:var(--muted);font-size:11px">✎</small></span> <span class="mgr">${userArt(s, 22, me.color)} 감독 ${s.managerName}</span><span>${divisionName(userDivision(s))} ${over ? "종료" : `${pos}위 · ${rows[pos - 1]!.pts}점`} · 예산 ${me.budget}억 · 연봉 ${wageBill(me)}억/시즌${windowOpen(s) ? ' · <b style="color:var(--good)">이적시장 열림</b>' : ""}</span></h3>`);
    h.push(this.todoHtml());
    h.push(this.careerStripHtml());
    // the pending interview (press.ts) and the story events with their choices (story.ts)
    h.push(this.interviewHtml());
    h.push(this.eventsHtml());
    const expiring = expiringContracts(s);
    if (expiring.length && over) h.push(`<div class="hint" style="color:var(--bad);border:1px solid var(--bad);border-radius:8px;padding:8px 10px">⚠ 재계약하지 않은 선수 ${expiring.length}명(${expiring.slice(0, 4).map((p) => p.name).join(", ")}${expiring.length > 4 ? " 외" : ""})이 <b>다음 시즌 시작</b>을 누르면 떠납니다. 이적 탭 → 판매·계약에서 지금 재계약할 수 있습니다.</div>`);
    if (false && expiring.length && s.round >= 12 && !over) h.push(`<div class="hint" style="color:var(--warn)">이번 시즌 계약 만료 ${expiring.length}명 (${expiring.slice(0, 3).map((p) => p.name).join(", ")}${expiring.length > 3 ? " 외" : ""}) — 이적 탭에서 재계약하지 않으면 시즌 후 떠납니다.</div>`);

    h.push(this.boardHtml());
    h.push(this.fansHtml());
    if (s.board.sacked) {
      h.push(`<div class="hint" style="color:var(--bad)"><b>경질되었습니다.</b> ${me.name} 이사회가 계약을 해지했습니다. 다른 구단의 제안을 받거나 새 게임을 시작하세요.</div><div class="actions"><button class="primary" data-act="sacked">거취 정하기 →</button></div>`);
    } else if (this.live || this.challenge) {
      h.push(`<div class="hint">${this.challenge ? `도전 「${this.challenge.scen.title}」 경기가 진행 중입니다.` : "경기가 진행 중입니다."}</div><div class="actions"><button class="primary" data-act="toMatch">경기로 돌아가기</button>${this.challenge ? `<button class="danger" data-act="chalAbandon">도전 포기</button>` : ""}</div>`);
    } else if (over) {
      const champ = clubOf(s, rows[0]!.club);
      const fate = inPromotionZone(s, me.id) ? ` <b style="color:var(--accent)">승격!</b> 다음 시즌은 ${divisionName(userDivision(s) - 1)}입니다.`
        : inRelegationZone(s, me.id) ? ` <b style="color:var(--bad)">강등.</b> 다음 시즌은 ${divisionName(userDivision(s) + 1)}에서 다시 시작합니다.` : "";
      h.push(`<div class="hint">${divisionName(userDivision(s))} 시즌 ${s.season} 최종 순위 ${pos}위.${fate} 우승: <b style="color:var(--accent)">${champ.name}</b>${s.cup.holder !== undefined ? ` · ${CUP_NAME} 우승: <b>${clubOf(s, s.cup.holder).name}</b>` : ""}</div>`);
      h.push(`<div class="actions"><button class="primary" data-act="review">시즌 결산 보기</button><button data-act="nextSeason">다음 시즌 시작 →</button></div>`);
    } else if (s.pendingCupDay) {
      const tie = userCupTie(s);
      const stage = CUP_STAGE_LABEL[s.cup.stage] ?? "";
      if (tie) {
        const home = clubOf(s, tie.home), away = clubOf(s, tie.away);
        h.push(venueHtml(home, clubCapacity(home)));
        h.push(`<div class="fixture cup">
          <div class="team" data-clubcard="${home.id}" style="cursor:pointer"><span class="embWrap">${emblemSvg(home, 26)}</span>${home.name}<small>${tie.home === me.id ? "홈" : "상대"} · 최근 ${this.form(home.id)}</small></div>
          <div class="vs"><span class="cupTag">${CUP_NAME}</span>${stage}<b>vs</b></div>
          <div class="team r" data-clubcard="${away.id}" style="cursor:pointer">${away.name}<span class="embWrap r">${emblemSvg(away, 26)}</span><small>${tie.away === me.id ? "원정" : "상대"} · 최근 ${this.form(away.id)}</small></div>
        </div>`);
        h.push(this.opponentHtml(clubOf(s, tie.home === me.id ? tie.away : tie.home)));
        const prob = selectionProblem(me);
        if (prob) h.push(`<div class="hint" style="color:var(--warn)">선발 문제: ${prob} — 스쿼드에서 조정하거나 자동으로 보정됩니다.</div>`);
        h.push(`<div class="actions"><button data-act="squad">스쿼드 점검</button><button class="primary" data-act="play">경기 시작 ▶</button><button data-act="cupSim" title="이번 컵 라운드의 모든 경기를 즉시 시뮬레이션합니다">⏩ 자동 진행</button></div>
        <div class="hint">단판 토너먼트입니다. 90분 무승부면 승부차기로 가립니다. 컵 경고는 리그 누적에 들어가지 않습니다. 상금: 8강 탈락 ${CUP_PRIZE.qfLoser}억 · 4강 탈락 ${CUP_PRIZE.sfLoser}억 · 준우승 ${CUP_PRIZE.runnerUp}억 · 우승 ${CUP_PRIZE.winner}억.</div>`);
      } else {
        const st = userCupStatus(s);
        h.push(`<div class="fixture cup"><div class="team"><span class="cupTag">${CUP_NAME}</span> ${stage}<small>${st === "bye" ? "우리 팀은 부전승으로 8강에 직행합니다." : userEnteredCup(s) ? "우리 팀은 이미 탈락했습니다. 다른 팀들의 경기가 진행됩니다." : "이번 시즌 컵에는 나가지 않습니다 (1부 전 구단과 2부 상위 4팀만 출전). 다른 팀들의 경기가 진행됩니다."}</small></div></div>`);
        // a day off for us: settle the cup alone, or roll straight on through the next league rounds
        h.push(`<div class="actions"><button class="primary" data-act="cupSim">컵 라운드 진행 ⏩</button><button data-act="sim3" title="컵 라운드를 처리한 뒤 리그 3라운드를 이어서 자동 진행합니다">⏩ +3라운드</button><button data-act="sim5" title="컵 라운드를 처리한 뒤 리그 5라운드를 이어서 자동 진행합니다">⏩ +5라운드</button></div>`);
      }
    } else if (fx) {
      const home = clubOf(s, fx.home), away = clubOf(s, fx.away);
      const oppId = fx.home === me.id ? fx.away : fx.home;
      const oppPos = rows.findIndex((r) => r.club === oppId) + 1;
      const form = (c: Club) => this.form(c.id);
      h.push(venueHtml(home, clubCapacity(home)));
      h.push(`<div class="fixture">
        <div class="team" data-clubcard="${home.id}" style="cursor:pointer"><span class="embWrap">${emblemSvg(home, 26)}</span>${home.name}<small>${fx.home === me.id ? "홈" : `${oppPos}위`} · 최근 ${form(home)}</small></div>
        <div class="vs">R${fx.round + 1}<b>vs</b></div>
        <div class="team r" data-clubcard="${away.id}" style="cursor:pointer">${away.name}<span class="embWrap r">${emblemSvg(away, 26)}</span><small>${fx.away === me.id ? "원정" : `${oppPos}위`} · 최근 ${form(away)}</small></div>
      </div>`);
      h.push(this.opponentHtml(clubOf(s, oppId)));
      const dby = derbyFor(s, fx);
      if (dby?.rival) h.push(`<div class="hint" style="color:var(--accent)"><b>🔥 ${dby.name}</b> — "${clubLore(dby.rival.id).nickname}" ${dby.rival.name}과의 라이벌전. 이기면 팬과 이사회가 두 배로 기뻐하고, 지면 두 배로 아파합니다.</div>`);
      const prob = selectionProblem(me);
      if (prob) h.push(`<div class="hint" style="color:var(--warn)">선발 문제: ${prob} — 스쿼드에서 조정하거나 자동으로 보정됩니다.</div>`);
      h.push(`<div class="actions"><button data-act="squad">스쿼드 점검</button><button class="primary" data-act="play">경기 시작 ▶</button><span style="display:inline-flex;gap:4px;align-items:center"><button data-act="sim1" title="이번 라운드의 모든 경기를 즉시 시뮬레이션합니다">⏩ 1라운드</button><button data-act="sim3" title="3라운드를 연속 시뮬레이션합니다 (내 경기 포함)">⏩ 3라운드</button><button data-act="sim5" title="5라운드를 연속 시뮬레이션합니다 (내 경기 포함)">⏩ 5라운드</button></span></div>
      <div class="hint">자동 진행은 내 전술 + 수석코치 성향으로 AI가 지휘합니다.</div>`);
    }
    if (!over) h.push(`<div class="cupLine">${this.cupLineHtml()}</div>`);
    h.push(`</div>`);
    h.push(this.challengeCardHtml(false));
    h.push(`<div class="grid2">`);
    const newsLine = (n: string) => `<div data-kind="${newsKind(n)}"><span class="nIcon">${newsIcon(n)}</span>${n}</div>`;
    h.push(`<div class="card"><h3>소식 <span class="chips newsFilter">${([["all", "전체"], ["market", "이적"], ["fans", "팬"], ["board", "이사회"], ["squad", "선수"], ["comp", "대회"]] as [string, string][]).map(([k, l]) => `<button class="sortChip ${this.newsFilter === k ? "on" : ""}" data-news="${k}">${l}</button>`).join("")}</span></h3>
      <div class="news">${s.news.slice(0, 6).map(newsLine).join("") || "<div>아직 소식이 없습니다.</div>"}</div>${s.news.length > 6 ? `<details><summary class="hint" style="cursor:pointer">지난 소식 ${Math.min(34, s.news.length - 6)}건 더 보기</summary><div class="news" style="margin-top:4px">${s.news.slice(6, 40).map(newsLine).join("")}</div></details>` : ""}</div>`);
    h.push(`<div class="card"><h3>순위 <span>상위 6</span></h3>${this.tableHtml(rows.slice(0, 6), true)}</div>`);
    h.push(`</div>`);
    h.push(`<div class="actions"><button class="danger" data-act="newGame">새 게임</button><span class="hint">진행 상황은 이 브라우저에 자동 저장됩니다. · 가난한자의 FM · 만든이 raro</span></div>`);
    this.el.home.innerHTML = h.join("");
    this.wireClubTaps(this.el.home);
    this.el.home.querySelectorAll<HTMLButtonElement>("button[data-news]").forEach((b) => b.addEventListener("click", () => { this.newsFilter = b.dataset.news!; this.applyNewsFilter(); }));
    this.applyNewsFilter();
    this.el.home.querySelector("[data-customize]")?.addEventListener("click", () => this.openCustomizeSheet());
    this.wireStory(this.el.home);
    this.el.home.querySelectorAll<HTMLButtonElement>("button[data-go]").forEach((b) => b.addEventListener("click", () => {
      if (b.dataset.career) { this.openCareerSheet(); return; }
      const [screen, tab] = (b.dataset.tab ?? "").split(":");
      if (screen && tab) { this.tabSel[screen] = tab; try { localStorage.setItem("3sec.tabs", JSON.stringify(this.tabSel)); } catch { /* ignore */ } this.renderAll(); }
      this.show(b.dataset.go as ScreenName);
    }));
    this.el.home.querySelectorAll<HTMLButtonElement>("button[data-act]").forEach((b) => b.addEventListener("click", () => this.act(b.dataset.act!)));
    this.wireChallenge(this.el.home);
    this.queueAchievementToast();
  }

  // ------------------------------------------------------------ achievements, hall of fame, manager career
  private static readonly TIER_COLOR: Record<AchievementTier, string> = { gold: "#e8b84a", silver: "#c0c8d0", bronze: "#c8834a" };
  private achToastQueued = false;

  private tierBadge(t: AchievementTier): string {
    return `<span style="display:inline-block;min-width:16px;padding:0 5px;border-radius:9px;font-size:10px;font-weight:700;color:#1a1400;background:${Game.TIER_COLOR[t]}">${TIER_LABEL[t]}</span>`;
  }

  /** Fresh unlocks pop up once as a bottom sheet (after the screen switch settles), then the list is cleared. */
  private queueAchievementToast(): void {
    if (this.achToastQueued || !this.state.freshAchievements?.length) return;
    this.achToastQueued = true;
    setTimeout(() => {
      this.achToastQueued = false;
      if (this.current === "match" || this.current === "onboarding" || document.body.classList.contains("onboarding")) return;
      const ids = takeFreshAchievements(this.state);
      if (!ids.length) return;
      this.save();
      const total = this.state.achievements?.length ?? 0;
      this.openSheet(`<div class="pc"><h3 style="margin:0">🏅 업적 달성 <span style="color:var(--muted);font-weight:400;font-size:12px">${total} / ${ACHIEVEMENTS.length}</span></h3>
        ${ids.map((id) => achievementById(id)).filter((a) => !!a).map((a) => `<div class="stat" style="border:1px solid ${Game.TIER_COLOR[a!.tier]};border-radius:8px;padding:8px 10px;background:var(--panel2);display:flex;flex-direction:column;gap:3px"><b>${this.tierBadge(a!.tier)} ${a!.title}</b><small class="hint">${a!.desc}</small></div>`).join("")}
        <div class="hint">순위 화면의 명예의 전당 탭에서 전체 업적과 기록을 볼 수 있습니다.</div>
        <div class="pcActions"><button class="primary" data-sheet="close">닫기</button></div></div>`);
    }, 60);
  }

  /** Home strip: reputation stars, the contract, and any pending negotiation / approach with its buttons. */
  private careerStripHtml(): string {
    const s = this.state;
    if (s.board.sacked) return "";
    const rep = managerRep(s);
    const n = repStars(rep);
    const c = s.managerContract;
    const contract = c ? `계약 ~S${c.until} · 연봉 ${c.wage}억${contractExpiring(s) ? ' · <span style="color:var(--warn)">올 시즌 만료</span>' : ""}` : "계약 없음";
    const h: string[] = [];
    h.push(`<div class="board"><div class="boardHead"><span>감독 평판 <span class="stars" title="평판 ${rep}/20">${"★".repeat(n)}<i>${"★".repeat(5 - n)}</i></span> <small>${rep} · ${repLabel(rep)}</small></span><small>${contract}</small></div>`);
    h.push(this.careerTalkHtml());
    h.push(`</div>`);
    return h.join("");
  }

  /** The pending contract talk and/or job approach with their buttons (shared by home, the review and the sheet). */
  private careerTalkHtml(): string {
    const s = this.state;
    const btn = 'style="padding:3px 8px;font-size:12px"';
    const h: string[] = [];
    const t = s.contractTalk;
    if (t) h.push(`<div class="hint" style="margin-top:6px;color:var(--text)"><b style="color:var(--accent)">이사회 재계약 제안</b>: ${t.years}년 · 연봉 ${t.wage}억${t.countered ? ' · <span style="color:var(--warn)">역제안 거절됨 — 원안 유효</span>' : ""}
      <div class="actions" style="margin-top:4px"><button class="primary" data-act="acceptContract" ${btn}>수락</button>${t.countered ? "" : `<button data-act="counterContract" ${btn}>역제안 (연봉 올리기)</button>`}<button class="danger" data-act="declineContract" ${btn}>거절하고 떠나기</button></div>
      <span class="hint">거절하면 자유계약 감독이 되어 다른 구단의 제안을 받습니다. 답하지 않으면 다음 시즌 시작 시 제시안대로 체결됩니다.</span></div>`);
    const o = pendingJobOffer(s);
    if (o) {
      const club = clubOf(s, o.club);
      const left = Math.max(0, o.expires - s.round);
      h.push(`<div class="hint" style="margin-top:6px;color:var(--text)"><b style="color:var(--accent)">📩 <span class="dot" style="background:${club.color}"></span>${club.name} 구단이 감독직을 제안했습니다</b>: ${o.years}년 · 연봉 ${o.wage}억 · ${left <= 0 ? "이번 주 만료" : `${left}라운드 내 답변`}
        <div class="actions" style="margin-top:4px"><button class="primary" data-act="acceptJobOffer" ${btn}>수락 (즉시 이적)</button><button data-act="declineJobOffer" ${btn}>거절</button></div>
        <span class="hint">수락하면 시즌 중에 ${club.name}으로 옮기고 평판은 그대로 가져갑니다. ${this.me.shortName}은(는) 새 감독을 선임합니다.</span></div>`);
    }
    return h.join("");
  }

  /** To-do rows for a pending negotiation or approach (open the career sheet). */
  private careerTodoItems(): { text: string; screen: ScreenName; tab?: [string, string]; color: string; career?: boolean }[] {
    const s = this.state;
    const out: { text: string; screen: ScreenName; tab?: [string, string]; color: string; career?: boolean }[] = [];
    if (s.board.sacked) return out;
    const t = s.contractTalk;
    if (t) out.push({ text: `이사회 재계약 제안: ${t.years}년 · 연봉 ${t.wage}억 — 답변이 필요합니다`, screen: "home", color: "var(--accent)", career: true });
    const o = pendingJobOffer(s);
    if (o) out.push({ text: `${clubOf(s, o.club).name} 감독직 제안 (${o.years}년 · ${o.wage}억) — ${Math.max(0, o.expires - s.round)}라운드 내 답변`, screen: "home", color: "var(--accent)", career: true });
    return out;
  }

  private openCareerSheet(): void {
    const s = this.state;
    const rep = managerRep(s);
    const n = repStars(rep);
    this.openSheet(`<div class="pc"><h3 style="margin:0">감독 커리어 <span style="color:var(--muted);font-weight:400;font-size:12px">${s.managerName}</span></h3>
      <div class="hint">평판 <span class="stars">${"★".repeat(n)}<i>${"★".repeat(5 - n)}</i></span> ${rep} · ${repLabel(rep)}${s.managerContract ? ` · 계약 ~S${s.managerContract.until} · 연봉 ${s.managerContract.wage}억` : ""}</div>
      ${this.careerTalkHtml().replace(/data-act="/g, 'data-sheet="career" data-act="') || '<div class="hint">진행 중인 협상이 없습니다.</div>'}
      <div class="pcActions"><button data-sheet="close">닫기</button></div></div>`);
  }

  /** Contract / job-offer actions (home strip, review section, career sheet). Returns whether `a` was one. */
  private careerAct(a: string): boolean {
    const s = this.state;
    const done = (): void => { this.save(); this.closeSheet(); this.renderAll(); if (this.current === "review") this.renderReview(); };
    switch (a) {
      case "acceptContract": { const err = acceptContract(s); if (err) alert(err); done(); return true; }
      case "counterContract": {
        const t = s.contractTalk;
        if (!t) return true;
        const ask = this.askFee(`요구 연봉 (억원) — 이사회 제시 ${t.wage}억. 요구가 클수록 거절 확률이 높고, 역제안은 한 번뿐입니다.`, Math.round(t.wage * 1.2 * 10) / 10);
        if (ask === null) return true;
        const res = counterContract(s, ask);
        alert(res.error ?? (res.ok ? `이사회가 연봉 ${res.wage}억을 수락했습니다. 재계약 체결!` : `이사회가 거절했습니다. 원안 ${res.wage}억은 그대로 유효합니다.`));
        done();
        return true;
      }
      case "declineContract": {
        if (!confirm("재계약을 거절하고 구단을 떠날까요? 자유계약 감독이 되어 다른 구단의 제안을 받게 됩니다.")) return true;
        const err = declineContract(s);
        if (err) { alert(err); return true; }
        this.save(); this.closeSheet(); this.renderAll(); this.renderSacked(); this.show("sacked");
        return true;
      }
      case "acceptJobOffer": {
        const o = pendingJobOffer(s);
        if (!o) return true;
        if (!confirm(`${clubOf(s, o.club).name}의 제안을 수락하고 지금 옮길까요? ${this.me.name}은(는) 떠납니다.`)) return true;
        const err = acceptJobOffer(s);
        if (err) { alert(err); return true; }
        this.save(); this.closeSheet(); this.renderAll(); this.show("home");
        return true;
      }
      case "declineJobOffer": { const err = declineJobOffer(s); if (err) alert(err); done(); return true; }
      default: return false;
    }
  }

  /** Review section: the season's unlocks and the running total. */
  private achievementsReviewHtml(): string {
    const s = this.state;
    const all = s.achievements ?? [];
    const mine = all.filter((a) => a.season === s.season);
    const item = (id: string) => { const a = achievementById(id); return a ? `<div class="stat" style="border-color:${Game.TIER_COLOR[a.tier]}"><b>${this.tierBadge(a.tier)} ${a.title}</b><small>${a.desc}</small></div>` : ""; };
    return `<div class="card review"><h3>업적 <span>이번 시즌 ${mine.length}개 · 누적 ${all.length} / ${ACHIEVEMENTS.length}</span></h3>
      ${mine.length ? `<div class="stats">${mine.map((a) => item(a.id)).join("")}</div>` : '<div class="hint">이번 시즌에 달성한 업적이 없습니다.</div>'}
      <div class="hint" style="margin-top:6px">전체 업적과 기록은 순위 화면의 명예의 전당 탭에서 볼 수 있습니다.</div></div>`;
  }

  /** Review section: reputation, contract, and the negotiation when one is pending. */
  private careerReviewHtml(): string {
    const s = this.state;
    const rep = managerRep(s);
    const n = repStars(rep);
    const r = s.records;
    const c = s.managerContract;
    const stat = (label: string, value: string) => `<div class="stat"><small>${label}</small><b>${value}</b></div>`;
    const lastRep = s.news.find((x) => x.startsWith("감독 평판"));
    let talk = this.careerTalkHtml();
    if (!talk && !s.board.sacked) {
      if (c && contractExpiring(s) && seasonOver(s)) talk = `<div class="hint" style="margin-top:6px;color:var(--warn)">계약이 올 시즌으로 끝나지만 이사회가 아직 재계약을 제안하지 않았습니다 (신뢰도 35 미만이면 제안이 없습니다).</div>`;
      else if (c) talk = `<div class="hint" style="margin-top:6px">계약은 시즌 ${c.until}까지입니다. 만료 시즌이 끝나면 이사회가 평판과 성적에 따라 재계약을 제안합니다.</div>`;
    }
    return `<div class="card review"><h3>감독 커리어 <span class="mgr">${userArt(s, 26)} 감독 ${s.managerName}</span></h3>
      <div class="stats">
        ${stat("감독 평판", `<span class="stars">${"★".repeat(n)}<i>${"★".repeat(5 - n)}</i></span> <small>${rep} / 20 · ${repLabel(rep)}</small>`)}
        ${stat("계약", c ? `~S${c.until} <small>연봉 ${c.wage}억</small>` : "없음")}
        ${stat("재임 시즌", `${r?.seasonsInCharge ?? 0}시즌 <small>완주 기준</small>`)}
        ${stat("통산 승리", `${r?.wins ?? 0}승`)}
        ${stat("최다 무패", `${r?.bestUnbeaten ?? 0}경기`)}
        ${stat("역전승", `${r?.comebacks ?? 0}회`)}
      </div>
      ${lastRep ? `<div class="hint" style="margin-top:6px">${lastRep}</div>` : ""}
      <div class="hint" style="margin-top:4px">다음 시즌 시작 시 기대 대비 순위(±0.3/계단), 우승(+1.5), 컵(+1), 이사회 평가(±0.5), 경질(−2)로 평판이 갱신됩니다.</div>
      ${talk}</div>`;
  }

  /** 명예의 전당 tab: trophy cabinet, achievements grid, record book. */
  private hallOfFameHtml(): string {
    const s = this.state;
    const hof = hallOfFame(s);
    const earnedAt = new Map((s.achievements ?? []).map((a) => [a.id, a]));
    const num = (x: number) => x.toLocaleString("ko-KR");
    const trophy = (icon: string, seasons: number[], label: string) => seasons.length
      ? seasons.map((x) => `<div class="stat" style="align-items:center;text-align:center"><span style="font-size:28px;line-height:1.1">${icon}</span><b>${label}</b><small>시즌 ${x}</small></div>`).join("")
      : "";
    const cabinet = trophy("🏆", hof.titles, "리그 우승") + trophy("🏆", hof.cups, CUP_NAME + " 우승") + trophy("🎖", hof.managerAwards, "올해의 감독");
    const stat = (label: string, value: string) => `<div class="stat"><small>${label}</small><b>${value}</b></div>`;
    const bw = hof.biggestWin;
    const r = hof.records;
    const grid = ACHIEVEMENTS.map((a) => {
      const e = earnedAt.get(a.id);
      const col = Game.TIER_COLOR[a.tier];
      return `<div class="stat" style="border-color:${e ? col : "var(--line)"};${e ? "" : "opacity:.5"}" title="${a.desc}"><b>${e ? this.tierBadge(a.tier) : "🔒"} ${a.title}</b><small>${e ? `시즌 ${e.season} ${e.round}R 달성` : a.desc}</small></div>`;
    }).join("");
    const byTier = (t: AchievementTier) => `${ACHIEVEMENTS.filter((a) => a.tier === t && earnedAt.has(a.id)).length}/${ACHIEVEMENTS.filter((a) => a.tier === t).length}`;
    const h: string[] = [];
    h.push(`<div class="card review"><h3>트로피 진열장 <span>${s.managerName} 감독 · ${hof.positions.length}시즌</span></h3>
      ${cabinet ? `<div class="stats">${cabinet}</div>` : '<div class="hint">아직 트로피가 없습니다. 리그나 컵을 우승하면 여기에 진열됩니다.</div>'}
      ${hof.doubles.length ? `<div class="hint" style="margin-top:6px;color:var(--accent)">더블 달성: ${hof.doubles.map((x) => `시즌 ${x}`).join(", ")}</div>` : ""}
      <div class="stats" style="margin-top:8px">
        ${stat("최고 순위", hof.bestPosition ? `${hof.bestPosition}위` : "—")}
        ${stat("통산 승리", `${r.wins}승`)}
        ${stat("최다 연속 무패", `${r.bestUnbeaten}경기`)}
        ${stat("최다 연속 무실점", `${r.bestCleanSheets}경기`)}
        ${stat("최다 점수 차 승리", bw ? `${bw.score[0]}-${bw.score[1]} <small>vs ${clubOf(s, bw.opponent).shortName} · S${bw.season}${bw.cup ? ` · ${CUP_NAME}` : ""}</small>` : "—")}
        ${stat("최다 홈 관중", hof.recordAttendance ? `${num(hof.recordAttendance)}명` : "—")}
        ${stat("역전승 / 대승", `${r.comebacks}회 / ${r.bigWins}회`)}
        ${stat("유스 승격", `${r.promotedYouth}명`)}
      </div></div>`);
    h.push(`<div class="card review"><h3>업적 <span>${hof.earned.length} / ${hof.total} · 금 ${byTier("gold")} · 은 ${byTier("silver")} · 동 ${byTier("bronze")}</span></h3><div class="stats">${grid}</div></div>`);
    h.push(`<div class="grid2">`);
    h.push(`<div class="card"><h3>역대 시즌 <span>내 순위</span></h3>${hof.positions.length ? `<table class="std"><thead><tr><th>시즌</th><th class="l">구단</th><th>순위</th><th>승점</th><th class="l">득점왕</th></tr></thead><tbody>${[...hof.positions].reverse()
      .map((p) => { const ts = hof.topScorers.find((t) => t.season === p.season); return `<tr><td>S${p.season}</td><td class="l">${clubOf(s, p.club).shortName}</td><td>${p.position}위${hof.titles.includes(p.season) ? " 🏆" : ""}</td><td>${p.pts}</td><td class="l">${ts ? `${ts.name} ${ts.goals}골 <small>(${clubOf(s, ts.club).shortName})</small>` : "—"}</td></tr>`; }).join("")}</tbody></table>` : '<div class="hint">첫 시즌이 끝나면 기록이 쌓입니다.</div>'}</div>`);
    h.push(`<div class="card"><h3>통산 득점 <span>리그 전체 · 현역</span></h3>${hof.careerGoals.length ? `<table class="std"><thead><tr><th>#</th><th class="l">선수</th><th class="l">클럽</th><th>골</th></tr></thead><tbody>${hof.careerGoals
      .map((x, i) => `<tr class="${x.club?.id === s.userClub ? "me" : ""}"><td>${i + 1}</td><td class="l">${x.player.name}${x.player.youthProduct ? ' <small title="유스 출신">🌱</small>' : ""}</td><td class="l">${x.club ? x.club.shortName : "FA"}</td><td><b>${x.goals}</b></td></tr>`).join("")}</tbody></table>` : '<div class="hint">아직 득점이 없습니다.</div>'}
      <h3 style="margin-top:10px">통산 평점 <span>20경기 이상</span></h3>${hof.careerRatings.length ? `<table class="std"><thead><tr><th>#</th><th class="l">선수</th><th class="l">클럽</th><th>출장</th><th>평점</th></tr></thead><tbody>${hof.careerRatings
      .map((x, i) => `<tr class="${x.club?.id === s.userClub ? "me" : ""}"><td>${i + 1}</td><td class="l">${x.player.name}</td><td class="l">${x.club ? x.club.shortName : "FA"}</td><td>${x.apps}</td><td><b style="color:${ratingColor(x.rating)}">${fmtRating(x.rating)}</b></td></tr>`).join("")}</tbody></table>` : '<div class="hint">20경기 이상 뛴 선수가 아직 없습니다.</div>'}
      <h3 style="margin-top:10px">시즌 최다 관중</h3>${hof.bestAttendances.length ? `<table class="std"><thead><tr><th class="l">구단</th><th>관중</th></tr></thead><tbody>${hof.bestAttendances.map((x) => `<tr class="${x.club.id === s.userClub ? "me" : ""}"><td class="l">${x.club.shortName}</td><td>${num(x.attendance)}명</td></tr>`).join("")}</tbody></table>` : '<div class="hint">아직 홈경기가 없습니다.</div>'}</div>`);
    h.push(`</div>`);
    return h.join("");
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

  /** Compact fan strip for the home card: mood bar with its label and the last home crowd (fans.ts). */
  private fansHtml(): string {
    const me = this.me;
    const f = me.fans;
    if (!f) return "";
    const band = moodBand(f.mood);
    const color = band === "good" ? "var(--good)" : band === "ok" ? "var(--accent)" : band === "warn" ? "var(--warn)" : "var(--bad)";
    const cap = clubCapacity(me);
    const n = (x: number) => x.toLocaleString("ko-KR");
    const last = f.lastAttendance ? `지난 홈경기 관중 ${n(f.lastAttendance)}명${f.lastAttendance >= cap ? " · 매진" : ""}` : `홈구장 ${n(cap)}석 · 아직 홈경기 없음`;
    return `<div class="board"><div class="boardHead"><span>팬 분위기 <b style="color:${color}">${moodLabel(f.mood)}</b> <small>${Math.round(f.mood)}</small></span><small>${last}</small></div>
      <div class="bar" title="팬 분위기 ${f.mood}/100"><i style="width:${Math.round(f.mood)}%;background:${color}"></i></div></div>`;
  }

  // ------------------------------------------------------------ interviews and story events (press.ts, story.ts)

  /** The pending post-match interview as a card with its three answers (empty string when none is waiting). */
  private interviewHtml(): string {
    const s = this.state;
    const iv = s.pendingInterview;
    if (!iv || !iv.options?.length) return "";
    const me = this.me;
    const opp = s.clubs[iv.opponent];
    const p = iv.playerId ? me.squad.find((q) => q.id === iv.playerId) : undefined;
    const sign = (x: number) => `${x > 0 ? "+" : ""}${x}`;
    const eff = (o: InterviewOption) => [o.squad ? `팀 사기 ${sign(o.squad)}` : "", p && o.player ? `${p.name} 사기 ${sign(o.player)}` : "", o.board ? `이사회 ${sign(o.board)}` : "", o.fans ? `팬 ${sign(o.fans)}` : ""].filter(Boolean).join(" · ") || "변화 없음";
    const color = (k: InterviewOption["kind"]) => (k === "praise" ? "var(--good)" : k === "criticize" ? "var(--warn)" : "var(--muted)");
    return `<div class="card" data-story-card="interview" style="border-left:3px solid var(--accent)"><h3>🎙 경기 후 인터뷰 <span>${iv.cup ? CUP_NAME : `R${iv.round + 1}`}${opp ? ` · vs ${opp.shortName}` : ""}</span></h3>
      <div class="hint" style="color:var(--text);margin-bottom:6px">"${iv.question}"</div>
      <div class="todo">${iv.options.map((o, i) => `<button class="todoRow" data-story="answer" data-idx="${i}" style="border-left-color:${color(o.kind)}"><span><b>${o.label}</b><br><small>${eff(o)}</small></span><b>›</b></button>`).join("")}</div>
      <div class="hint">답하지 않으면 다음 라운드에 원론적인 답변으로 처리됩니다.</div></div>`;
  }

  /** Pending story events as cards with their choices, then a collapsible list of the last ten resolved ones. */
  private eventsHtml(): string {
    const s = this.state;
    const pending = pendingEvents(s);
    const log = (s.eventLog ?? []).slice(0, 10);
    const h: string[] = [];
    for (const ev of pending) {
      h.push(`<div class="card evCard" data-story-card="event" style="border-left:3px solid var(--warn)"><img class="evArt" src="./art/event-${ev.template}.webp" alt="" loading="lazy"><h3>📜 ${ev.title} <span>R${ev.round + 1}</span></h3>
        <div class="hint" style="color:var(--text);margin-bottom:6px">${ev.text}</div>
        <div class="todo">${ev.choices.map((c, i) => `<button class="todoRow" data-story="event" data-id="${ev.id}" data-choice="${i}" style="border-left-color:var(--accent)"><span><b>${c.label}</b>${c.hint ? `<br><small>${c.hint}</small>` : ""}</span><b>›</b></button>`).join("")}</div>
        <div class="hint">${Math.max(1, ev.expiresRound - s.round)}라운드 안에 결정하지 않으면 마지막 선택으로 처리됩니다.</div></div>`);
    }
    if (log.length) h.push(`<details class="card"><summary class="hint" style="cursor:pointer">지난 이벤트 ${log.length}건</summary><div class="news" style="margin-top:4px">${log.map((ev) => `<div><b>S${ev.season} R${ev.round + 1} · ${ev.title}</b> — ${ev.choices[ev.resolved?.choice ?? 0]?.label ?? ""}${ev.resolved?.auto ? " (자동 처리)" : ""}<br><small>${ev.resolved?.outcome ?? ""}</small></div>`).join("")}</div></details>`);
    return h.join("");
  }

  /** Click delegation for the interview answers and the event choices (home and results screens). */
  private wireStory(root: HTMLElement): void {
    root.querySelectorAll<HTMLButtonElement>("button[data-story]").forEach((b) => b.addEventListener("click", () => this.storyAction(b.dataset)));
  }

  /** One handler for both: an interview answer (`answer` + idx) or an event choice (`event` + id + choice). */
  private storyAction(ds: DOMStringMap): void {
    const s = this.state;
    if (ds.story === "answer") {
      const err = answerInterview(s, Number(ds.idx ?? "-1"));
      if (err) { alert(err); return; }
    } else if (ds.story === "event") {
      const out = resolveEvent(s, ds.id ?? "", Number(ds.choice ?? "-1"));
      if (out === null) { alert("이미 처리된 이벤트입니다."); return; }
    } else return;
    this.save();
    this.renderAll();
    // the results screen is not part of renderAll: drop its answered card in place
    this.el.results.querySelectorAll("[data-story-card]").forEach((el) => el.remove());
  }

  /** What needs the manager's attention right now, as tappable rows (empty string when nothing does). */
  private todoHtml(): string {
    const s = this.state;
    const me = this.me;
    const items: { text: string; screen: ScreenName; tab?: [string, string]; color: string; career?: boolean }[] = this.careerTodoItems();
    const prob = selectionProblem(me);
    if (prob) items.push({ text: `선발 문제: ${prob}`, screen: "squad", tab: ["squad", "sel"], color: "var(--warn)" });
    const offers = openOffers(s).length;
    if (offers) items.push({ text: `받은 이적 제안 ${offers}건 (2라운드 후 만료)`, screen: "transfers", tab: ["transfers", "off"], color: "var(--accent)" });
    const injured = me.squad.filter((p) => p.injuryDays > 0);
    if (injured.length) items.push({ text: `부상자 ${injured.length}명: ${injured.slice(0, 3).map((p) => `${p.name} ${p.injuryDays}일`).join(", ")}${injured.length > 3 ? " …" : ""}`, screen: "squad", tab: ["squad", "sel"], color: "var(--muted)" });
    const banned = me.squad.filter((p) => p.ban > 0);
    if (banned.length) items.push({ text: `출장 정지: ${banned.map((p) => `${p.name} ${p.ban}경기`).join(", ")}`, screen: "squad", tab: ["squad", "sel"], color: "var(--muted)" });
    const expiring = expiringContracts(s);
    if (expiring.length && s.round >= 12) {
      const starters = expiring.filter((p) => me.selection.starters.includes(p.id)).length;
      const late = s.round >= seasonRounds(s) - 4;
      items.push({ text: `${late ? "⚠ " : ""}계약 만료 예정 ${expiring.length}명${starters ? ` (주전 ${starters}명)` : ""}: ${expiring.slice(0, 3).map((p) => p.name).join(", ")}${expiring.length > 3 ? " …" : ""}${late ? " — 재계약하지 않으면 시즌이 끝날 때 떠납니다" : ""}`, screen: "transfers", tab: ["transfers", "sell"], color: late || starters ? "var(--bad)" : "var(--warn)" });
    }
    const staffExp = expiringStaff(s);
    if (staffExp.length && s.round >= 12) items.push({ text: `코치 계약 만료 예정 ${staffExp.length}명`, screen: "squad", tab: ["squad", "train"], color: "var(--warn)" });
    if (me.budget < 0) items.push({ text: "예산 적자: 연봉이 매주 빠져나갑니다. 선수를 팔거나 상금을 기다리세요.", screen: "transfers", tab: ["transfers", "sell"], color: "var(--bad)" });
    if (!items.length) return "";
    return `<div class="todo">${items.map((it) => `<button class="todoRow" data-go="${it.screen}" data-tab="${it.tab ? it.tab.join(":") : ""}"${it.career ? ' data-career="1"' : ""} style="border-left-color:${it.color}"><span>${it.text}</span><b>›</b></button>`).join("")}</div>`;
  }

  /** The opposing manager on the next-fixture card: name, tags and a one-line tip. */
  private opponentHtml(opp: Club): string {
    const m = opp.manager;
    if (!m) return "";
    const since = m.since < this.state.season ? ` · ${this.state.season - m.since}시즌째` : " · 부임 첫 시즌";
    return `<div class="hint" style="display:flex;gap:8px;align-items:flex-start">${managerArt(this.state, m, 40, opp.color)}<span>상대 감독 <b>${m.name}</b>${managerTags(m).length ? ` <span style="color:var(--accent)">${managerTags(m).join(" · ")}</span>` : ""}${since} — ${managerPreview(m, this.me, opp)}</span></div>`;
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
    } else mine = st === "bye" ? "부전승 (8강 직행)" : st === "out" ? (userEnteredCup(s) ? '<span style="color:var(--bad)">탈락</span>' : '<span style="color:var(--muted)">미출전 (2부 상위 4팀만)</span>') : "대진 미정";
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
    // A 도전 모드 match is running: nothing that would advance or settle the season is allowed until it is over.
    if (this.challenge && ["play", "sim1", "sim3", "sim5", "cupSim", "nextSeason", "nextRound"].includes(a)) {
      alert(`도전 「${this.challenge.scen.title}」 경기가 진행 중입니다. 먼저 끝내거나 포기하세요.`);
      return;
    }
    switch (a) {
      case "chalAbandon": this.abandonChallenge(); break;
      case "squad": this.show("squad"); break;
      case "play": this.startMatch(); break;
      case "sim1": void this.simRounds(1); break;
      case "sim3": void this.simRounds(3); break;
      case "sim5": void this.simRounds(5); break;
      case "toMatch": this.show("match"); break;
      case "cupSim": void this.simRounds(1); break;
      case "review": this.renderReview(); this.show("review"); break;
      case "sacked": this.renderSacked(); this.show("sacked"); break;
      // The snapshot goes first so the timer it resets keeps `save` from taking a second, near-identical one.
      case "nextSeason": {
        const before = userDivision(this.state);
        startNextSeason(this.state);
        this.backupNow(); this.save(); this.renderAll();
        // Going up was a news line while a title win filled the screen; it is the bigger moment for
        // the clubs that start in the second division, so it gets the same treatment.
        const after = userDivision(this.state);
        if (after < before) {
          void celebrate({
            kind: "promotion",
            title: `${divisionName(after)} 승격!`,
            subtitle: `${this.me.name} · 시즌 ${this.state.season}부터 ${divisionName(after)}`,
            lines: [`${divisionName(before)}를 ${SWAP}위 안으로 마쳤습니다.`, "상금과 관중, 그리고 상대가 달라집니다."],
            color: "#ffd166",
          }).then(() => this.afterAdvance("home"));
        } else this.afterAdvance("home");
        break;
      }
      case "newGame":
        if (confirm("현재 진행 상황을 지우고 새 게임을 시작할까요?")) {
          if (this.current === "match") this.screen.leave();
          this.live = null;
          this.startOnboarding();
        }
        break;
      default: this.careerAct(a);
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
    const when = rec.reason !== "warnings" ? `시즌 ${rec.season} 종료 후` : `시즌 ${rec.season} ${rec.round}라운드 후`;
    const declined = rec.reason === "declined";
    const offers = declined ? careerJobOffers(s) : jobOffers(s);
    const stars = (n: number) => `<span class="stars">${"★".repeat(n)}<i>${"★".repeat(5 - n)}</i></span>`;
    const h: string[] = [];
    h.push(`<div class="card review"><h3>경질 <span class="mgr">감독 ${s.managerName}</span><span>${me.name}</span></h3>
      <div class="rvTitle" style="color:${declined ? "var(--accent)" : "var(--bad)"}">${declined ? "자유계약" : "경질"} <small>${when}</small></div>
      <div class="hint">${declined ? `${s.managerName} 감독이 ${me.name}의 재계약을 거절하고 떠났습니다. 평판 ${managerRep(s)}에 맞는 구단들이 연락해 옵니다.` : `${me.name} 이사회가 ${s.managerName} 감독과의 계약을 해지했습니다. ${rec.reason === "rollover" ? "시즌 결산에서 신뢰도가 35 아래였습니다." : "두 번째 경고와 함께 신뢰도가 15 아래로 떨어졌습니다."}`}</div>
      <div class="stats">
        <div class="stat"><small>당시 순위</small><b>${rec.position}위 <small>/ ${table(s).length}팀 · ${rec.pts}점</small></b></div>
        <div class="stat"><small>이사회 기대</small><b>${rec.expected}위</b></div>
        <div class="stat"><small>신뢰도</small><b style="color:var(--bad)">${Math.round(s.board.confidence)}</b></div>
        <div class="stat"><small>경고</small><b>${s.board.warnings}회</b></div>
        <div class="stat"><small>역대 시즌</small><b>${s.seasonHistory.length ? s.seasonHistory.map((r) => `S${r.season} ${r.userPosition}위`).join(" · ") : "—"}</b></div>
      </div>
      <div class="actions" style="margin-top:8px"><button class="primary" id="skOffers">다른 구단 제안 받기</button><button class="danger" data-act="newGame">새 게임</button></div></div>`);
    h.push(`<div class="card" id="skOfferList" hidden><h3>감독 제안 <span>${offers.length}곳</span></h3>
      <div class="hint">감독 자리가 비었거나 이사회 압박이 큰 구단들이 연락해 왔습니다. 수락하면 그 구단의 감독이 되고, 신뢰도 55에서 새로 시작합니다.</div>
      ${offers.length ? offers.map((c) => `<div class="offer"><div class="of-main"><b><span class="dot" style="background:${c.color}"></span>${c.name}</b> <span class="role">${posOf.get(c.id)}위 · 예산 ${c.budget}억 · 전력 ${stars(clubStars(c.reputation))}</span>
          <div class="hint">${c.manager ? `${managerArt(s, c.manager, 20, c.color)} ${c.manager.name} 감독 경질 예정 · 이사회 압박 ${c.pressure ?? 0}` : "감독 공석"} · 스쿼드 ${c.squad.length}명</div></div>
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

  // ------------------------------------------------------------ sub-tabs, the bottom sheet (player/club cards, compare) and the progress button
  /** Segmented control + panels; the active tab is remembered per screen. */
  private subTabs(screen: string, tabs: { id: string; label: string; html: string }[]): string {
    const cur = tabs.some((x) => x.id === this.tabSel[screen]) ? this.tabSel[screen]! : tabs[0]!.id;
    return `<div class="subtabs" data-tabs="${screen}">${tabs.map((x) => `<button class="${x.id === cur ? "on" : ""}" data-tab="${x.id}">${x.label}</button>`).join("")}</div>` +
      tabs.map((x) => `<div class="subpanel" data-panel="${x.id}" ${x.id === cur ? "" : "hidden"}>${x.html}</div>`).join("");
  }

  private wireSubTabs(root: HTMLElement): void {
    const bar = root.querySelector<HTMLElement>(".subtabs");
    if (!bar) return;
    const screen = bar.dataset.tabs!;
    bar.querySelectorAll<HTMLButtonElement>("button[data-tab]").forEach((b) => b.addEventListener("click", () => {
      const id = b.dataset.tab!;
      this.tabSel[screen] = id;
      try { localStorage.setItem("3sec.tabs", JSON.stringify(this.tabSel)); } catch { /* ignore */ }
      bar.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
      root.querySelectorAll<HTMLElement>(".subpanel").forEach((pn) => { pn.hidden = pn.dataset.panel !== id; });
      window.scrollTo({ top: 0 });
    }));
  }

  /** The one button that always shows what to do next. */
  private updateCta(): void {
    const s = this.state;
    const cur = this.current;
    const hide = cur === "match" || cur === "onboarding" || cur === "guide" || document.body.classList.contains("onboarding");
    this.cta.hidden = hide;
    if (hide) return;
    let label: string, act: string;
    if (this.challenge) { label = `도전 「${this.challenge.scen.title}」 경기로 ▶`; act = "toMatch"; }
    else if (this.live) { label = "경기로 돌아가기 ▶"; act = "toMatch"; }
    else if (s.board.sacked) { label = "이사회 통보 확인"; act = "sacked"; }
    else if (cur === "results") { label = seasonOver(s) ? "시즌 결산 보기 →" : "다음 라운드 →"; act = "nextRound"; }
    else if (seasonOver(s)) { label = cur === "review" ? "다음 시즌 시작 →" : "시즌 결산 보기 →"; act = cur === "review" ? "nextSeason" : "review"; }
    else if (selectionProblem(this.me)) { label = "선발 문제 해결 →"; act = "squad"; }
    else if (s.pendingCupDay) { const mine = !!userCupTie(s); label = mine ? `${CUP_NAME} 경기 시작 ▶` : `${CUP_NAME} 라운드 진행 ⏩`; act = mine ? "play" : "cupSim"; }
    else { const fx = nextUserFixture(s); label = fx ? `R${s.round + 1} 경기 시작 ▶` : "라운드 진행 ⏩"; act = fx ? "play" : "sim1"; }
    this.cta.textContent = label;
    this.cta.dataset.act = act;
    this.cta.classList.toggle("warn", act === "squad" || act === "sacked");
  }

  private ctaAction(): void {
    const act = this.cta.dataset.act ?? "";
    if (act === "nextRound") { document.getElementById("btnNextRound")?.click(); return; }
    if (act === "nextSeason") { if (confirm("다음 시즌을 시작할까요?")) this.act("nextSeason"); return; }
    this.act(act);
  }

  private openSheet(html: string): void {
    this.sheetBody.innerHTML = html;
    this.sheet.hidden = false;
    this.sheetBody.scrollTop = 0;
  }

  private closeSheet(): void {
    if (this.sheetLock) return;
    if (!this.sheet.hidden) this.sheet.hidden = true;
  }

  private findPlayer(club: number, id: string): { p: SquadPlayer; club: Club | null } | null {
    const c = club >= 0 ? clubOf(this.state, club) : null;
    const p = c ? c.squad.find((x) => x.id === id) : this.state.freeAgents.find((x) => x.id === id);
    return p ? { p, club: c } : null;
  }

  private sheetAction(kind: string, ds: DOMStringMap): void {
    if (kind === "close") { this.closeSheet(); return; }
    if (kind === "career") { this.careerAct(ds.act ?? ""); return; }
    const club = Number(ds.club ?? "-1"), id = ds.id ?? "";
    if (kind === "profile") { const f = this.findPlayer(club, id); if (f) { this.closeSheet(); this.openProfile(f.p, f.club, this.current); } return; }
    if (kind === "pick") { this.comparePick = { club, id }; const f = this.findPlayer(club, id); if (f) this.openPlayerSheet(f.p, f.club); return; }
    if (kind === "unpick") { this.comparePick = null; const f = this.findPlayer(club, id); if (f) this.openPlayerSheet(f.p, f.club); return; }
    if (kind === "compare") {
      const a = this.comparePick ? this.findPlayer(this.comparePick.club, this.comparePick.id) : null;
      const b = this.findPlayer(club, id);
      if (a && b) this.openSheet(this.compareHtml(a.p, a.club, b.p, b.club));
      return;
    }
    if (kind === "club") { this.openClubSheet(club, ds.cmp === "1"); return; }
    if (kind === "custom") { this.customizeAct(ds.act ?? ""); return; }
    if (kind === "captain") {
      const err = setCaptain(this.state, id);
      if (err) { alert(err); return; }
      this.save();
      this.renderAll();
      const f = this.findPlayer(club, id);
      if (f) this.openPlayerSheet(f.p, f.club);
      return;
    }
    if (kind === "market") {
      const el = ds.sel ? this.el.transfers.querySelector<HTMLButtonElement>(ds.sel) : null;
      this.closeSheet();
      el?.click();
    }
  }

  private wireClubTaps(root: HTMLElement): void {
    root.querySelectorAll<HTMLElement>("[data-club], [data-clubcard]").forEach((el) => el.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).closest("button, select, input, a")) return;
      const id = Number(el.dataset.club ?? el.dataset.clubcard);
      if (Number.isFinite(id)) this.openClubSheet(id, false);
    }));
  }

  // ------------------------------------------------------------ 구단 꾸미기 (kit, names, stadium)

  /** The club as the match screen wants it: engine team fields plus custom kit, original name, ground and seats. */
  private clubLook(c: Club): { name: string; color: string; baseName?: string; kit?: ClubKit; stadiumName?: string; capacity: number } {
    return { name: c.name, color: c.color, baseName: c.baseName, kit: c.kit, stadiumName: c.stadiumName, capacity: clubCapacity(c) };
  }

  /** Paint a kit disc with a shirt number into a square canvas (css size = canvas attribute size). */
  private static paintKitPreview(canvas: HTMLCanvasElement, kit: Kit, num = ""): void {
    const size = Number(canvas.dataset.size ?? canvas.width);
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(size * dpr); canvas.height = Math.round(size * dpr);
    canvas.style.width = `${size}px`; canvas.style.height = `${size}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);
    const r = size / 2 - 2;
    paintKit(ctx, kit, size / 2, size / 2, r);
    if (num) {
      ctx.fillStyle = kitTextColor(kit);
      ctx.font = `700 ${Math.round(r * 0.95)}px 'Barlow Condensed', system-ui, sans-serif`;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(num, size / 2, size / 2 + 1);
    }
  }

  /** The kit the sheet's inputs currently describe (home + away choice). */
  private customKitFromSheet(): ClubKit {
    const q = <T extends HTMLElement>(sel: string) => this.sheetBody.querySelector<T>(sel)!;
    const pattern = (this.sheetBody.querySelector<HTMLElement>(".kitTile.on")?.dataset.pattern ?? "solid") as KitPatternName;
    const kit: ClubKit = { primary: q<HTMLInputElement>("#kitPrimary").value, secondary: q<HTMLInputElement>("#kitSecondary").value, pattern };
    const away = q<HTMLSelectElement>("#kitAway").value;
    if (away === "white" || away === "dark") kit.away = away;
    else if (away === "custom") kit.away = { primary: q<HTMLInputElement>("#awayPrimary").value, secondary: q<HTMLInputElement>("#awaySecondary").value, pattern: q<HTMLSelectElement>("#awayPattern").value as KitPatternName };
    return kit;
  }

  /** Repaint the previews and pattern tiles from the inputs. */
  private refreshKitPreview(): void {
    const kit = this.customKitFromSheet();
    const home: Kit = { primary: kit.primary, secondary: kit.secondary, pattern: kit.pattern };
    const away = alternateKit(kit.primary, home, kit.away);
    const num = String(this.me.squad.find((p) => this.me.selection.starters.includes(p.id))?.number ?? 10);
    for (const c of this.sheetBody.querySelectorAll<HTMLCanvasElement>("canvas[data-kit]")) {
      const which = c.dataset.kit;
      if (which === "home") Game.paintKitPreview(c, home, num);
      else if (which === "away") Game.paintKitPreview(c, away, num);
      else Game.paintKitPreview(c, { ...home, pattern: which as KitPatternName });
    }
    this.sheetBody.querySelector<HTMLElement>("#awayCustom")!.hidden = kit.away === undefined || typeof kit.away === "string";
    this.sheetBody.querySelector<HTMLElement>("#kitDot")!.style.background = kit.primary;
  }

  private refreshExpansion(): void {
    const slider = this.sheetBody.querySelector<HTMLInputElement>("#expSeats");
    const out = this.sheetBody.querySelector<HTMLElement>("#expInfo");
    const btn = this.sheetBody.querySelector<HTMLButtonElement>('[data-act="expand"]');
    if (!slider || !out || !btn) return;
    const seats = Number(slider.value);
    const a = expansionAdvice(this.state, seats);
    const payback = a.paybackSeasons === Infinity ? "회수 불가 (매진이 없으면 새 좌석은 비어 있습니다)" : `약 ${a.paybackSeasons}시즌 만에 회수`;
    out.innerHTML = `<b>+${seats.toLocaleString("ko-KR")}석</b> → ${(a.capacity + a.pendingSeats + seats).toLocaleString("ko-KR")}석 · 비용 <b>${a.cost}억</b> · 예상 추가 입장 수입 <b>${a.extraGate}억/시즌</b><br><small>${payback}</small>${a.problem ? `<br><small style="color:var(--warn)">${a.problem}</small>` : ""}`;
    btn.disabled = !!a.problem;
  }

  private openCustomizeSheet(notice?: string): void {
    const s = this.state;
    const me = this.me;
    const kit = kitForClub(me);
    const awayChoice = me.kit?.away === undefined ? "auto" : typeof me.kit.away === "string" ? me.kit.away : "custom";
    const awayCustom = typeof me.kit?.away === "object" ? me.kit.away : alternateKit(me.color, kit);
    const ground = stadiumFor(me.baseName ?? me.name);
    const a = expansionAdvice(s, EXPANSION_STEP);
    const occ = a.homeMatches ? `${Math.round(a.occupancy * 100)}%` : "—";
    const esc = (x: string) => x.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
    const patSel = (id: string, cur: KitPatternName) => `<select id="${id}">${KIT_PATTERNS.map((p) => `<option value="${p}" ${p === cur ? "selected" : ""}>${KIT_PATTERN_LABEL[p]}</option>`).join("")}</select>`;
    this.openSheet(`<div class="pc custom">
      <h3 style="margin:0"><span class="dot" id="kitDot" style="background:${me.color};width:14px;height:14px"></span>구단 꾸미기 <span style="color:var(--muted);font-weight:400;font-size:12px">${me.name}</span></h3>
      ${notice ? `<div class="hint custNotice" style="color:var(--good)">✓ ${notice}</div>` : ""}

      <div class="custSec"><div class="custTitle">유니폼</div>
        <div class="kitRow">
          <div class="kitPrev"><canvas data-kit="home" data-size="64" width="64" height="64"></canvas><small>홈</small></div>
          <div class="kitPrev"><canvas data-kit="away" data-size="64" width="64" height="64"></canvas><small>원정</small></div>
          <div class="kitInputs">
            <label>주 색상 <input type="color" id="kitPrimary" value="${kit.primary}"></label>
            <label>보조 색상 <input type="color" id="kitSecondary" value="${kit.secondary}"></label>
          </div>
        </div>
        <div class="kitTiles">${KIT_PATTERNS.map((p) => `<button type="button" class="kitTile ${p === kit.pattern ? "on" : ""}" data-pattern="${p}"><canvas data-kit="${p}" data-size="40" width="40" height="40"></canvas><small>${KIT_PATTERN_LABEL[p]}</small></button>`).join("")}</div>
        <div class="kitInputs" style="margin-top:6px"><label>원정 유니폼 <select id="kitAway">
          <option value="auto" ${awayChoice === "auto" ? "selected" : ""}>자동 (홈과 겹치지 않게)</option>
          <option value="white" ${awayChoice === "white" ? "selected" : ""}>흰색 + 사선 띠</option>
          <option value="dark" ${awayChoice === "dark" ? "selected" : ""}>어두운색 + 사선 띠</option>
          <option value="custom" ${awayChoice === "custom" ? "selected" : ""}>직접 정하기</option></select></label></div>
        <div class="kitInputs" id="awayCustom" hidden><label>원정 주 색상 <input type="color" id="awayPrimary" value="${awayCustom.primary}"></label><label>보조 <input type="color" id="awaySecondary" value="${awayCustom.secondary}"></label><label>패턴 ${patSel("awayPattern", awayCustom.pattern)}</label></div>
        <div class="hint">주 색상은 순위표와 카드의 구단 색으로도 쓰입니다. 바뀐 유니폼은 다음 경기부터 입습니다. 원정 유니폼은 홈 팀과 색이 겹칠 때만 입습니다.</div>
        <div class="pcActions"><button class="primary" data-sheet="custom" data-act="saveKit">유니폼 저장</button><button data-sheet="custom" data-act="resetKit" ${me.kit ? "" : "disabled"}>기본 유니폼으로</button></div>
      </div>

      <div class="custSec"><div class="custTitle">구단명</div>
        <div class="kitInputs"><label style="flex:2">구단명 <input type="text" id="custName" maxlength="${CLUB_NAME_MAX}" value="${esc(me.name)}"></label><label>약칭 <input type="text" id="custShort" maxlength="${SHORT_NAME_MAX}" value="${esc(me.shortName)}" style="width:4em"></label></div>
        <div class="hint">구단명 ${CLUB_NAME_MAX}자, 약칭 2~${SHORT_NAME_MAX}자.${me.baseName ? ` 원래 이름: ${me.baseName}` : ""}</div>
        <div class="pcActions"><button class="primary" data-sheet="custom" data-act="saveName">이름 저장</button>${me.baseName ? `<button data-sheet="custom" data-act="resetName">원래 이름으로</button>` : ""}</div>
      </div>

      <div class="custSec"><div class="custTitle">홈구장</div>
        <div class="kitInputs"><label style="flex:1">구장 이름 <input type="text" id="custStadium" maxlength="${STADIUM_NAME_MAX}" value="${esc(me.stadiumName ?? "")}" placeholder="${esc(ground.name)}"></label><button data-sheet="custom" data-act="saveStadium" style="flex:0 0 auto">이름 저장</button></div>
        <div class="pcStats wrap"><div>좌석<b>${a.capacity.toLocaleString("ko-KR")}석</b><small>${a.pendingSeats ? `다음 시즌 +${a.pendingSeats.toLocaleString("ko-KR")}` : `원래 ${a.baseCapacity.toLocaleString("ko-KR")}석`}</small></div><div>객석 점유<b>${occ}</b><small>홈 ${a.homeMatches}경기</small></div><div>매진<b>${a.sellouts}회</b><small>이번 시즌</small></div><div>입장 수입<b>${(me.seasonGate ?? 0).toFixed(1)}억</b><small>이번 시즌</small></div></div>
        ${a.maxSeats > 0 ? `<div class="kitInputs"><label style="flex:1">확장 규모 <input type="range" id="expSeats" min="${EXPANSION_STEP}" max="${a.maxSeats}" step="${EXPANSION_STEP}" value="${EXPANSION_STEP}"></label></div>
        <div class="hint" id="expInfo"></div>
        <div class="hint">좌석당 비용은 구단 평판에 따라 오릅니다 (1,000석당 ${a.costPer1000}억). 원래 좌석의 50%까지, 시즌마다 한 번 확장할 수 있고 공사는 다음 시즌 개막에 끝납니다. 관중은 좌석을 넘지 못하므로 매진이 잦을 때만 확장이 남습니다.</div>
        <div class="pcActions"><button class="primary" data-sheet="custom" data-act="expand">🏗 구장 확장</button></div>` : `<div class="hint">이 구장은 더 이상 확장할 수 없습니다 (원래 좌석의 50%까지).</div>`}
      </div>
      <div class="pcActions"><button data-sheet="close">닫기</button></div>
    </div>`);
    const body = this.sheetBody;
    body.querySelectorAll<HTMLButtonElement>(".kitTile").forEach((b) => b.addEventListener("click", () => {
      body.querySelectorAll(".kitTile").forEach((x) => x.classList.remove("on"));
      b.classList.add("on");
      this.refreshKitPreview();
    }));
    for (const id of ["#kitPrimary", "#kitSecondary", "#kitAway", "#awayPrimary", "#awaySecondary", "#awayPattern"]) {
      body.querySelector(id)?.addEventListener("input", () => this.refreshKitPreview());
      body.querySelector(id)?.addEventListener("change", () => this.refreshKitPreview());
    }
    body.querySelector("#expSeats")?.addEventListener("input", () => this.refreshExpansion());
    this.refreshKitPreview();
    this.refreshExpansion();
  }

  private customizeAct(act: string): void {
    const s = this.state;
    const body = this.sheetBody;
    const val = (sel: string) => body.querySelector<HTMLInputElement>(sel)?.value ?? "";
    const done = (msg?: string) => { this.save(); this.renderAll(); this.openCustomizeSheet(msg); };
    switch (act) {
      case "saveKit": { const err = setClubKit(s, this.customKitFromSheet()); if (err) { alert(err); return; } done("유니폼을 저장했습니다. 다음 경기부터 입습니다."); return; }
      case "resetKit": { resetClubKit(s, CLUBS[this.me.id]?.color); done("기본 유니폼으로 되돌렸습니다."); return; }
      case "saveName": { const err = renameClub(s, val("#custName"), val("#custShort")); if (err) { alert(err); return; } done("구단명을 저장했습니다."); return; }
      case "resetName": { const me = this.me; if (me.baseName) { const err = renameClub(s, me.baseName, CLUBS[me.id]?.shortName ?? me.shortName); if (err) { alert(err); return; } me.baseName = undefined; } done("원래 이름으로 되돌렸습니다."); return; }
      case "saveStadium": { const err = renameStadium(s, val("#custStadium")); if (err) { alert(err); return; } done("구장 이름을 저장했습니다."); return; }
      case "expand": {
        const seats = Number(val("#expSeats"));
        const a = expansionAdvice(s, seats);
        if (a.problem) { alert(a.problem); return; }
        if (!confirm(`홈구장을 ${seats.toLocaleString("ko-KR")}석 늘리는 데 ${a.cost}억을 쓸까요? 공사는 다음 시즌 개막에 끝나 ${(a.capacity + a.pendingSeats + seats).toLocaleString("ko-KR")}석이 됩니다.`)) return;
        const err = expandStadium(s, seats);
        if (err) { alert(err); return; }
        done("확장 공사를 계약했습니다. 다음 시즌부터 적용됩니다.");
        return;
      }
    }
  }

  // ---- player card
  private openPlayerSheet(p: SquadPlayer, club: Club | null): void {
    this.openSheet(this.playerCardHtml(p, club));
  }

  private radarGroups(p: SquadPlayer): { label: string; keys: (keyof Attributes)[] }[] {
    return p.role === "GK"
      ? [{ label: "반사", keys: ["reflexes"] }, { label: "핸들링", keys: ["handling"] }, { label: "위치", keys: ["gkPositioning"] }, { label: "판단", keys: ["decisions", "composure", "anticipation"] }, { label: "스피드", keys: ["pace", "acceleration", "agility"] }, { label: "피지컬", keys: ["strength", "stamina"] }]
      : [{ label: "스피드", keys: ["pace", "acceleration", "agility"] }, { label: "피지컬", keys: ["strength", "stamina"] }, { label: "기술", keys: ["technique", "firstTouch", "dribbling"] }, { label: "패스", keys: ["passing", "vision"] }, { label: "공격", keys: ["finishing", "composure"] }, { label: "수비", keys: ["tackling", "marking", "positioning", "anticipation"] }];
  }

  private keyAttrs(p: SquadPlayer): (keyof Attributes)[] {
    const r = p.role;
    if (r === "GK") return ["reflexes", "handling", "gkPositioning", "decisions", "composure", "anticipation", "agility", "strength"];
    if (r === "CB" || r === "LB" || r === "RB") return ["tackling", "marking", "positioning", "anticipation", "strength", "pace", "passing", "stamina"];
    if (r === "DM" || r === "CM" || r === "AM") return ["passing", "vision", "technique", "firstTouch", "decisions", "stamina", "tackling", "dribbling"];
    return ["finishing", "composure", "pace", "acceleration", "dribbling", "technique", "firstTouch", "anticipation"];
  }

  private groupValues(p: SquadPlayer, groups: { keys: (keyof Attributes)[] }[]): number[] {
    return groups.map((g) => Math.round((g.keys.reduce((a, k) => a + p.attrs[k], 0) / g.keys.length) * 10) / 10);
  }

  /** Hexagonal radar chart (SVG) for one or two players. */
  private radarSvg(series: { values: number[]; color: string }[], labels: string[], size = 150): string {
    const cx = size / 2, cy = size / 2, R = size / 2 - 20, n = labels.length;
    const pt = (i: number, v: number): [number, number] => { const a = (i * 2 * Math.PI) / n; return [cx + (R * v / 20) * Math.sin(a), cy - (R * v / 20) * Math.cos(a)]; };
    const poly = (v: number) => Array.from({ length: n }, (_, i) => pt(i, v).map((x) => x.toFixed(1)).join(",")).join(" ");
    const rings = [5, 10, 15, 20].map((v) => `<polygon points="${poly(v)}" fill="${v === 20 ? "rgba(255,255,255,.03)" : "none"}" stroke="rgba(255,255,255,.14)" stroke-width="1"/>`).join("");
    const axes = labels.map((_, i) => { const [x, y] = pt(i, 20); return `<line x1="${cx}" y1="${cy}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="rgba(255,255,255,.12)"/>`; }).join("");
    const text = labels.map((l, i) => { const [x, y] = pt(i, 24.5); return `<text x="${x.toFixed(1)}" y="${(y + 3).toFixed(1)}" text-anchor="middle" font-size="10" fill="#93a4b3" font-family="IBM Plex Sans KR, sans-serif">${l}</text>`; }).join("");
    const shapes = series.map((sr) => `<polygon points="${Array.from({ length: n }, (_, i) => pt(i, sr.values[i] ?? 0).map((x) => x.toFixed(1)).join(",")).join(" ")}" fill="${sr.color}" fill-opacity=".26" stroke="${sr.color}" stroke-width="1.6"/>` +
      Array.from({ length: n }, (_, i) => { const [x, y] = pt(i, sr.values[i] ?? 0); return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.2" fill="${sr.color}"/>`; }).join("")).join("");
    return `<svg class="radar" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img">${rings}${axes}${shapes}${text}</svg>`;
  }

  private playerCardHtml(p: SquadPlayer, club: Club | null): string {
    const s = this.state;
    const ovr = overall(p.attrs, p.role);
    const stars = potentialStars(p.potential);
    const st = p.stats;
    const avg = avgRating(p);
    const cond = Math.round(p.condition * 100);
    const status = p.onLoan ? "임대 중" : p.loanFrom !== undefined ? `임대 (${clubOf(s, p.loanFrom).shortName})` : p.injuryDays > 0 ? `부상 ${p.injuryDays}일` : p.ban > 0 ? `정지 ${p.ban}경기` : p.seasonYellows % 5 === 4 ? "경고 누적 4" : "출전 가능";
    const statusColor = p.injuryDays > 0 || p.ban > 0 ? "var(--bad)" : p.onLoan || p.loanFrom !== undefined || p.seasonYellows % 5 === 4 ? "var(--warn)" : "var(--good)";
    const attrColor = (v: number) => (v >= 15 ? "var(--good)" : v >= 11 ? "var(--accent)" : v >= 8 ? "var(--text)" : "var(--bad)");
    const groups = this.radarGroups(p);
    const keys = this.keyAttrs(p);
    const form = (p.form ?? []).slice(-5);
    const clubId = club ? club.id : -1;
    const pick = this.comparePick;
    const picked = pick ? this.findPlayer(pick.club, pick.id) : null;
    const isPicked = !!pick && pick.id === p.id;
    const ds = `data-club="${clubId}" data-id="${p.id}"`;
    const cmpBtn = picked && !isPicked
      ? `<button class="primary" data-sheet="compare" ${ds}>${picked.p.name}와 비교</button><button data-sheet="unpick" ${ds} title="비교 대상 해제" style="flex:0 0 auto">✕</button>`
      : isPicked ? `<button disabled>비교 대상 ✓</button><button data-sheet="unpick" ${ds}>해제</button>`
      : `<button data-sheet="pick" ${ds}>비교 대상으로</button>`;
    return `<div class="pc">
      <div class="pcHead"><div class="pcNum">${face(p, club, 44)}<small>${p.number}</small></div>
        <div class="pcMain"><div class="pcName">${p.name}</div><div class="hint">${p.role} · ${p.age}세 · ${club ? `<span class="dot" style="background:${club.color}"></span>${club.name}` : "자유계약"}${club && club.id !== s.userClub ? " <small>(타 구단)</small>" : ""}</div></div>
        <div class="pcOvr"><b style="color:${ovr >= 14 ? "var(--good)" : ovr >= 11 ? "var(--text)" : "var(--warn)"}">${ovr.toFixed(1)}</b><small><span class="stars">${"★".repeat(stars)}<i>${"★".repeat(5 - stars)}</i></span></small></div></div>
      <div class="pcStats"><div>가치<b>${playerValue(p)}억</b></div><div>연봉 · 계약<b>${p.wage}억</b><small>~시즌 ${p.contractUntil}${p.contractUntil <= s.season ? " 만료" : ""}</small></div><div>컨디션<b style="color:${cond > 70 ? "var(--good)" : cond > 45 ? "var(--warn)" : "var(--bad)"}">${cond}%</b></div><div>상태<b style="color:${statusColor}">${status}</b></div></div>
      <div class="pcStats wrap"><div>사기<b style="color:${(() => { const b = moraleBand(moraleOf(p)); return b === "good" ? "var(--good)" : b === "ok" ? "var(--accent)" : b === "warn" ? "var(--warn)" : "var(--bad)"; })()}">${moraleLabel(moraleOf(p))}</b><small>${Math.round(moraleOf(p))}/100${p.transferRequest ? " · 이적 요청" : ""}</small></div><div>성격<b>${personalityTags(p).join(" · ") || "평범"}</b></div>${club && club.captain === p.id ? `<div>주장<b style="color:var(--accent)">Ⓒ</b></div>` : ""}</div>
      <div class="pcMid">${this.radarSvg([{ values: this.groupValues(p, groups), color: "#ffd166" }], groups.map((g) => g.label), 150)}
        <div class="pcAttrs">${keys.map((k) => `<div><span>${ATTR_LABEL[k]}</span><b style="color:${attrColor(p.attrs[k])}">${p.attrs[k]}</b></div>`).join("")}</div></div>
      <div class="pcSeason"><span>출장 <b>${st.apps}</b></span><span>골 <b>${st.goals}</b></span><span>도움 <b>${st.assists ?? 0}</b></span><span>평점 <b style="color:${avg ? ratingColor(avg) : "inherit"}">${avg ? fmtRating(avg) : "—"}</b></span><span>MOTM <b>${st.motm ?? 0}</b></span><span>경고 <b>${st.yellows}</b></span>${form.length ? `<span class="chips">${form.map((r) => `<span class="chip" style="background:${ratingColor(r)}">${fmtRating(r)}</span>`).join("")}</span>` : ""}</div>
      ${this.marketActionHtml(p, clubId)}
      <div class="pcActions">${cmpBtn}${club && club.id === s.userClub && club.captain !== p.id && !p.onLoan && p.loanFrom === undefined ? `<button data-sheet="captain" ${ds}>주장 임명</button>` : ""}<button data-sheet="profile" ${ds}>전체 프로필</button><button data-sheet="close">닫기</button></div>
    </div>`;
  }

  /** The transfer-market action for this player (bid, sign, sell, loan in), mirrored from the transfers screen. */
  private marketActionHtml(p: SquadPlayer, clubId: number): string {
    const sels = [`button[data-bid="${clubId}:${p.id}"]`, `button[data-sign="${p.id}"]`, `button[data-sell="${p.id}"]`, `button[data-loanin="${clubId}:${p.id}"]`, `button[data-loanout="${p.id}"]`, `button[data-renew="${p.id}"]`];
    const found = sels.map((sel) => ({ sel, el: this.el.transfers.querySelector<HTMLButtonElement>(sel) })).filter((x) => x.el);
    if (!found.length) return "";
    return `<div class="pcActions pcMarket">${found.map(({ sel, el }) => `<button class="primary" data-sheet="market" data-sel="${sel.replace(/"/g, "&quot;")}" ${el!.disabled ? "disabled" : ""} title="${el!.title || "이적 시장 조작"}">${el!.textContent?.trim() ?? "거래"}</button>`).join("")}</div>`;
  }

  private compareHtml(a: SquadPlayer, ca: Club | null, b: SquadPlayer, cb: Club | null): string {
    const groups = this.radarGroups(a.role === "GK" ? a : b.role === "GK" ? b : a);
    const va = this.groupValues(a, groups), vb = this.groupValues(b, groups);
    const keys = this.keyAttrs(a).slice(0, 6);
    const num = (label: string, x: number, y: number, fmt: (v: number) => string = (v) => String(v), lowerBetter = false) => {
      const wa = lowerBetter ? x < y : x > y, wb = lowerBetter ? y < x : y > x;
      return `<div class="cmpRow"><b class="${wa ? "w" : ""}">${fmt(x)}</b><span>${label}</span><b class="${wb ? "w" : ""}">${fmt(y)}</b></div>`;
    };
    const f1 = (v: number) => v.toFixed(1);
    const ra = avgRating(a), rb = avgRating(b);
    const rows = [
      num("능력", overall(a.attrs, a.role), overall(b.attrs, b.role), f1),
      num("잠재력", a.potential, b.potential, (v) => "★".repeat(potentialStars(v))),
      num("나이", a.age, b.age, undefined, true),
      num("가치 (억)", playerValue(a), playerValue(b)),
      num("연봉 (억)", a.wage, b.wage, undefined, true),
      ...keys.map((k) => num(ATTR_LABEL[k], a.attrs[k], b.attrs[k])),
      num("출장", a.stats.apps, b.stats.apps),
      num("골 / 도움", a.stats.goals + (a.stats.assists ?? 0), b.stats.goals + (b.stats.assists ?? 0), (v) => (v === a.stats.goals + (a.stats.assists ?? 0) ? `${a.stats.goals} / ${a.stats.assists ?? 0}` : `${b.stats.goals} / ${b.stats.assists ?? 0}`)),
      num("평점", ra, rb, (v) => (v ? fmtRating(v) : "—")),
    ].join("");
    const head = (p: SquadPlayer, c: Club | null, color: string, right: boolean) => `<div class="cmpP" style="text-align:${right ? "right" : "left"}"><b style="color:${color}">${p.name}</b><small>${p.role} · ${p.age}세 · ${c ? c.shortName : "자유계약"}</small></div>`;
    return `<div class="pc cmp">
      <div class="cmpHead">${head(a, ca, "#ffd166", false)}<span class="vs">VS</span>${head(b, cb, "#7ad0ff", true)}</div>
      <div style="display:flex;justify-content:center">${this.radarSvg([{ values: va, color: "#ffd166" }, { values: vb, color: "#7ad0ff" }], groups.map((g) => g.label), 170)}</div>
      <div class="cmpRows">${rows}</div>
      <div class="pcActions"><button data-sheet="unpick" data-club="${cb ? cb.id : -1}" data-id="${b.id}">비교 대상 바꾸기</button><button data-sheet="close">닫기</button></div>
    </div>`;
  }

  // ---- club card
  private clubFacts(c: Club) {
    const s = this.state;
    const rows = table(s);
    const idx = rows.findIndex((r) => r.club === c.id);
    const row = rows[idx]!;
    const xi = c.selection.starters.map((id) => playerOf(c, id));
    const xiAvg = xi.length ? xi.reduce((a, p) => a + overall(p.attrs, p.role), 0) / xi.length : 0;
    const best = [...c.squad].sort((x, y) => overall(y.attrs, y.role) - overall(x.attrs, x.role))[0];
    const scorer = [...c.squad].sort((x, y) => y.stats.goals - x.stats.goals)[0];
    const avgAge = c.squad.length ? c.squad.reduce((a, p) => a + p.age, 0) / c.squad.length : 0;
    const me = s.userClub;
    let w = 0, d = 0, l = 0;
    for (const f of s.fixtures) {
      if (!f.score || !((f.home === c.id && f.away === me) || (f.away === c.id && f.home === me))) continue;
      const mine = f.home === me ? f.score[0] - f.score[1] : f.score[1] - f.score[0];
      if (mine > 0) w++; else if (mine < 0) l++; else d++;
    }
    const st = stadiumFor(c.baseName ?? c.name);
    return { pos: idx + 1, pts: row.pts, played: row.played, gd: row.gf - row.ga, form: this.form(c.id), rep: c.reputation, mgr: c.id === me ? s.managerName : c.manager?.name ?? "—", tags: c.manager ? managerTags(c.manager) : [], stadium: c.stadiumName ?? st.name, capacity: clubCapacity(c), budget: c.budget, wages: wageBill(c), size: c.squad.length, avgAge, xiAvg, best, scorer, h2h: `${w}승 ${d}무 ${l}패`, expected: expectedPositions(s).get(c.id) ?? 0, mood: c.fans?.mood ?? 0, avgAtt: c.fans ? avgHomeAttendance(c) : 0, bestAtt: c.fans?.bestAttendance ?? 0, gate: c.seasonGate ?? 0 };
  }

  private openClubSheet(clubId: number, compare: boolean): void {
    const s = this.state;
    const c = clubOf(s, clubId);
    const me = this.me;
    const f = this.clubFacts(c);
    const stars = (rep: number) => { const n = Math.max(1, Math.min(5, Math.round(((rep - 10) / 4.5) * 4 + 1))); return `<span class="stars">${"★".repeat(n)}<i>${"★".repeat(5 - n)}</i></span>`; };
    if (compare && c.id !== me.id) {
      const g = this.clubFacts(me);
      const num = (label: string, x: number, y: number, fmt: (v: number) => string = (v) => String(v), lowerBetter = false) => {
        const wa = lowerBetter ? x < y : x > y, wb = lowerBetter ? y < x : y > x;
        return `<div class="cmpRow"><b class="${wa ? "w" : ""}">${fmt(x)}</b><span>${label}</span><b class="${wb ? "w" : ""}">${fmt(y)}</b></div>`;
      };
      const f1 = (v: number) => v.toFixed(1);
      const rows = [
        num("순위", f.pos, g.pos, (v) => `${v}위`, true),
        num("승점", f.pts, g.pts),
        num("득실", f.gd, g.gd, (v) => (v > 0 ? `+${v}` : String(v))),
        num("기대 순위", f.expected, g.expected, (v) => `${v}위`, true),
        num("평판", f.rep, g.rep, f1),
        num("선발 평균 능력", f.xiAvg, g.xiAvg, f1),
        num("최고 선수", f.best ? overall(f.best.attrs, f.best.role) : 0, g.best ? overall(g.best.attrs, g.best.role) : 0, f1),
        num("평균 나이", f.avgAge, g.avgAge, f1, true),
        num("스쿼드", f.size, g.size),
        num("예산 (억)", f.budget, g.budget),
        num("연봉 총액 (억)", f.wages, g.wages),
        num("구장 좌석", f.capacity, g.capacity, (v) => v.toLocaleString()),
        num("팬 분위기", f.mood, g.mood, (v) => `${moodLabel(v)} ${Math.round(v)}`),
        num("평균 홈 관중", f.avgAtt, g.avgAtt, (v) => (v ? `${v.toLocaleString("ko-KR")}명` : "—")),
      ].join("");
      this.openSheet(`<div class="pc cmp">
        <div class="cmpHead"><div class="cmpP"><b style="color:${c.color}">${c.name}</b><small>${f.mgr} 감독 · 최근 ${f.form}</small></div><span class="vs">VS</span><div class="cmpP" style="text-align:right"><b style="color:${me.color}">${me.name}</b><small>${g.mgr} 감독 · 최근 ${g.form}</small></div></div>
        <div class="cmpRows">${rows}</div>
        <div class="hint">올 시즌 상대 전적(내 기준): ${f.h2h}</div>
        <div class="pcActions"><button data-sheet="club" data-club="${c.id}" data-cmp="0">구단 카드</button><button data-sheet="close">닫기</button></div></div>`);
      return;
    }
    this.openSheet(`<div class="pc">
      ${venueHtml(c, f.capacity)}
      <div class="pcHead"><div class="pcNum" style="font-size:22px;line-height:0">${emblemSvg(c, 34)}</div>
        <div class="pcMain"><div class="pcName">${c.name}</div><div class="hint" style="display:flex;align-items:center;gap:6px">${c.id === s.userClub ? userArt(s, 24, c.color) : c.manager ? managerArt(s, c.manager, 24, c.color) : ""}<span>${f.mgr} 감독${f.tags.length ? ` · <span style="color:var(--accent)">${f.tags.join(" · ")}</span>` : ""}</span></div></div>
        <div class="pcOvr"><b>${f.pos}위</b><small>${f.pts}점 · ${f.played}경기</small></div></div>
      <div class="hint">${clubLore(c.id).founded}년 창단 · "${clubLore(c.id).nickname}" · 우승 ${clubLore(c.id).honours}회${clubLore(c.id).rival >= 0 ? ` · 라이벌 <b data-clubcard="${clubLore(c.id).rival}" style="cursor:pointer">${clubOf(s, clubLore(c.id).rival).name}</b> (${clubLore(c.id).derby})` : ""}</div>
      <div class="hint" style="margin-bottom:6px">${clubLore(c.id).history}</div>
      <div class="pcStats wrap"><div>전력<b>${stars(f.rep)}</b></div><div>최근 5경기<b>${f.form}</b></div><div>기대 순위<b>${f.expected}위</b></div><div>득실<b>${f.gd > 0 ? "+" : ""}${f.gd}</b></div></div>
      <div class="pcStats wrap"><div>라커룸<b>${moraleLabel(c.lockerRoom ?? 60)}</b><small>${Math.round(c.lockerRoom ?? 60)}/100</small></div><div>주장<b>${captainOf(c)?.name ?? "—"}</b></div></div>
      <div class="pcStats wrap"><div>홈구장<b>${f.stadium}</b><small>${f.capacity.toLocaleString()}석</small></div><div>예산<b>${f.budget}억</b></div><div>연봉 총액<b>${f.wages}억</b></div><div>스쿼드<b>${f.size}명</b><small>평균 ${f.avgAge.toFixed(1)}세</small></div></div>
      <div class="pcStats wrap"><div>팬 분위기<b>${moodLabel(f.mood)}</b><small>${Math.round(f.mood)}/100</small></div><div>평균 홈 관중<b>${f.avgAtt ? `${f.avgAtt.toLocaleString("ko-KR")}명` : "—"}</b><small>${f.bestAtt ? `최다 ${f.bestAtt.toLocaleString("ko-KR")}명` : ""}</small></div><div>입장 수입<b>${f.gate ? `${(Math.round(f.gate * 10) / 10).toFixed(1)}억` : "—"}</b><small>이번 시즌</small></div><div>객석 점유<b>${f.avgAtt ? `${Math.round((f.avgAtt / f.capacity) * 100)}%` : "—"}</b></div></div>
      <div class="pcStats wrap"><div>선발 평균<b>${f.xiAvg.toFixed(1)}</b></div><div>최고 선수<b>${f.best ? f.best.name : "—"}</b><small>${f.best ? overall(f.best.attrs, f.best.role).toFixed(1) : ""}</small></div><div>득점 1위<b>${f.scorer && f.scorer.stats.goals ? f.scorer.name : "—"}</b><small>${f.scorer && f.scorer.stats.goals ? `${f.scorer.stats.goals}골` : ""}</small></div><div>상대 전적<b>${c.id === me.id ? "—" : f.h2h}</b></div></div>
      <div class="pcActions">${c.id !== me.id ? `<button class="primary" data-sheet="club" data-club="${c.id}" data-cmp="1">내 팀과 비교</button>` : ""}<button data-sheet="close">닫기</button></div>
    </div>`);
  }

  // ------------------------------------------------------------ player profile

  private openProfile(p: SquadPlayer, club: Club | null, from: ScreenName): void {
    this.profileFrom = from;
    this.renderProfile(p, club);
    this.show("profile");
  }

  /** Resolve a `club:player` info key (club -1 = free agent) and open the profile. */
  private wireInfo(root: HTMLElement, from: ScreenName): void {
    root.querySelectorAll<HTMLElement>("button[data-info], [data-open]").forEach((b) => b.addEventListener("click", (e) => {
      e.stopPropagation();
      const [c, id] = (b.dataset.info ?? b.dataset.open)!.split(":");
      const clubId = Number(c);
      const club = clubId >= 0 ? clubOf(this.state, clubId) : null;
      const p = club ? club.squad.find((x) => x.id === id) : this.state.freeAgents.find((x) => x.id === id);
      if (p) this.openPlayerSheet(p, club);
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
      <div class="pfHead"><div class="pfNum">${face(p, club, 60)}<small>${p.number}</small></div><div class="pfMain"><div class="pfName">${p.name}</div>
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
    const hSel: string[] = [], hTac: string[] = [], hTrain: string[] = [];
    hSel.push(`<div class="card"><h3>${me.name} 스쿼드 <span>${me.squad.length}명</span></h3>
      <div class="squad-tools">
        <span>포메이션 <b style="color:var(--accent)">${sel.formation}</b></span>
        <button id="sqAuto" ${locked ? "disabled" : ""}>자동 선발</button>
        <span class="hint">선수 두 명을 차례로 누르면 자리를 맞바꿉니다 (선발 ↔ 벤치 ↔ 예비).</span>
      </div>
      <div class="fmWrap">
        <div class="fmBig">${formationSvg(sel.formation, me, sel.starters, 250, this.selA)}</div>
        <div class="fmList">${(Object.keys(FORMATIONS) as FormationName[]).map((f) => `<button class="fmBtn ${f === sel.formation ? "on" : ""}" data-formation="${f}" ${locked ? "disabled" : ""} title="${f} 적용 (자동 선발)">${formationSvg(f, null, [], 56)}<div>${f}</div></button>`).join("")}
          <div class="hint" style="flex-basis:100%">포메이션을 누르면 그 대형으로 자동 선발되고 역할이 다시 배정됩니다. 도식의 선수를 누른 뒤 아래 명단에서 다른 선수를 누르면 자리를 바꿉니다.</div></div>
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
        <span class="num face">${face(p, me, 28)}<i>${p.number}</i></span><span class="role">${roleText}</span>
        <span class="name" title="${p.name}">${p.name}</span>
        <span class="ovr" style="color:${ovr >= 14 ? "var(--good)" : ovr >= 11 ? "var(--text)" : "var(--warn)"}">${ovr.toFixed(1)}</span>
        <span class="age">${p.age}세</span>
        <span class="bar" title="컨디션 ${Math.round(cond * 100)}%"><i style="width:${Math.round(cond * 100)}%;background:${cond > 0.7 ? "var(--good)" : cond > 0.45 ? "var(--warn)" : "var(--bad)"}"></i></span>
        <span class="st">${status}</span>${INFO_BTN(`${me.id}:${p.id}`)}${roleSel}</div>`;
    };
    const header = `<div class="row wide" style="cursor:default;color:var(--muted);font-size:11px"><span>#</span><span>포지션</span><span>이름</span><span style="text-align:right">능력</span><span class="age">나이</span><span>컨디션</span><span class="st" style="color:var(--muted)">상태</span><span></span></div>`;
    hSel.push(`<div class="grid2">`);
    hSel.push(`<div class="card"><h3>선발 XI <span>${sel.formation}</span></h3>${header}<div class="roster">${sel.starters.map((id, i) => row(playerOf(me, id), slots[i]?.role ?? null, i)).join("")}</div></div>`);
    const reserves = me.squad.filter((p) => !sel.starters.includes(p.id) && !sel.bench.includes(p.id));
    hSel.push(`<div class="card"><h3>벤치 <span>${sel.bench.length}/7</span></h3>${header}<div class="roster">${sel.bench.map((id) => row(playerOf(me, id), null)).join("")}</div>
      <details ${this.selA && reserves.some((p) => p.id === this.selA) ? "open" : ""}><summary style="margin-top:8px;cursor:pointer;color:var(--muted);font-size:13px">예비 ${reserves.length}명 ${reserves.some((p) => p.injuryDays > 0 || p.ban > 0) ? `· <span style="color:var(--warn)">결장 ${reserves.filter((p) => p.injuryDays > 0 || p.ban > 0).length}</span>` : ""} (펼치기)</summary><div class="roster">${reserves.map((p) => row(p, null)).join("")}</div></details></div>`);
    hSel.push(`</div>`);
    const tr = me.training;
    hTrain.push(`<div class="card"><h3>훈련 <span>매주 적용</span></h3>
      <div class="squad-tools">
        <label>초점 <select id="trFocus">${(Object.keys(FOCUS_LABEL) as TrainingFocus[]).map((f) => `<option value="${f}" ${f === tr.focus ? "selected" : ""}>${FOCUS_LABEL[f]}</option>`).join("")}</select></label>
        <label>강도 <select id="trIntensity">${(Object.keys(INTENSITY_LABEL) as TrainingIntensity[]).map((i) => `<option value="${i}" ${i === tr.intensity ? "selected" : ""}>${INTENSITY_LABEL[i]}</option>`).join("")}</select></label>
      </div>
      <div class="hint">어린 선수는 잠재력까지 성장하고 30대는 서서히 쇠퇴합니다. 초점을 둔 능력치가 먼저 오르고, 강도를 높이면 성장은 빠르지만(강하게 ×1.4, 가볍게 ×0.7) 회복이 느리고 부상이 잦아집니다. 23세 이하는 경기에 60분 이상 뛰면 추가로 성장하고, 한 주 내내 결장하면 성장이 20% 느려집니다.</div></div>`);
    hTrain.push(this.staffCardHtml(locked));
    hTac.push(`<div class="card"><h3>기본 전술 <span>경기 중에도 변경 가능</span></h3>
      <div class="actions">${Object.keys(TACTIC_PRESETS).map((n) => `<button data-preset="${n}" ${locked ? "disabled" : ""}>${n}</button>`).join("")}<button data-autoroles ${locked ? "disabled" : ""}>역할 자동</button></div>
      <label style="margin:4px 0"><input type="checkbox" id="sqTrap" ${me.tactics.offsideTrap ? "checked" : ""} ${locked ? "disabled" : ""}> 오프사이드 트랩 (라인을 평평하게 유지해 침투를 잡되, 뚫리면 위험)</label>
      <div id="sqSliders"></div>
      <div class="hint">역할은 선발 명단의 각 줄에서 고릅니다. 예: 윙어 ↔ 인사이드 포워드(중앙으로 파고들어 슛), 풀백 ↔ 윙백(오버랩), 앵커 ↔ 딥라잉 플레이메이커, 어드밴스드 포워드 ↔ 타겟맨·포처·폴스 나인.</div></div>`);
    const tn = normalizeTactics({ ...me.tactics, formation: sel.formation });
    const spv = tn.setPieces ?? {};
    const takerOpt = (cur?: string) => `<option value="">자동</option>${sel.starters.slice(1).map((id) => { const p = playerOf(me, id); return `<option value="${id}" ${id === cur ? "selected" : ""}>${p.number} ${p.name}</option>`; }).join("")}`;
    const targets: [CornerTarget, string][] = [["center", "중앙(PK 지점)"], ["near", "니어포스트"], ["far", "파포스트"], ["short", "짧게"]];
    hTac.push(`<div class="card"><h3>세트피스 <span>키커와 코너 타깃</span></h3>
      <div class="tactic"><span class="lbl">코너 키커</span><select data-sp="cornerTaker" style="grid-column:2 / 4" ${locked ? "disabled" : ""}>${takerOpt(spv.cornerTaker)}</select></div>
      <div class="tactic"><span class="lbl">프리킥 키커</span><select data-sp="freeKickTaker" style="grid-column:2 / 4" ${locked ? "disabled" : ""}>${takerOpt(spv.freeKickTaker)}</select></div>
      <div class="tactic"><span class="lbl">PK 키커</span><select data-sp="penaltyTaker" style="grid-column:2 / 4" ${locked ? "disabled" : ""}>${takerOpt(spv.penaltyTaker)}</select></div>
      <div class="tactic"><span class="lbl">코너 타깃</span><select data-sp="cornerTarget" style="grid-column:2 / 4" ${locked ? "disabled" : ""}>${targets.map(([v, l]) => `<option value="${v}" ${(spv.cornerTarget ?? "center") === v ? "selected" : ""}>${l}</option>`).join("")}</select></div>
      <div class="hint">비워 두면 능력치가 가장 좋은 선수가 맡습니다. 부상·퇴장 선수는 자동으로 제외됩니다.</div></div>`);
    hTac.push(`<div class="card"><h3>개인 지시 <span>역할 위에 덧씌움</span></h3><div class="roster">${sel.starters.slice(1).map((id, k) => {
      const i = k + 1;
      const p = playerOf(me, id);
      const cur = tn.instructions?.[i] ?? {};
      return `<div style="padding:6px 4px;border-bottom:1px solid var(--line)"><div style="font-size:13px;margin-bottom:4px"><span class="num" style="font-family:'IBM Plex Mono',monospace;color:var(--muted)">${p.number}</span> ${p.name} <span style="color:var(--muted);font-size:11px">${ROLES[tn.roles![i]!]!.name}</span></div>
        <div style="display:flex;flex-wrap:wrap;gap:4px">${INSTRUCTION_IDS.map((ins) => `<button data-ins="${i}:${ins}" ${locked ? "disabled" : ""} style="padding:2px 8px;font-size:11px;border-radius:12px;${cur[ins] ? "background:var(--accent);color:#1a1400;border-color:var(--accent)" : ""}">${INSTRUCTION_LABEL[ins]}</button>`).join("")}</div></div>`;
    }).join("")}</div><div class="hint">서로 반대되는 지시(예: 강하게 압박 / 압박 자제)는 한쪽만 켭니다.</div></div>`);
    this.el.squad.innerHTML = this.subTabs("squad", [
      { id: "sel", label: "선발", html: hSel.join("") },
      { id: "tac", label: "전술", html: hTac.join("") },
      { id: "train", label: "훈련·스태프", html: hTrain.join("") },
    ]);
    this.wireSubTabs(this.el.squad);

    this.el.squad.querySelectorAll<HTMLButtonElement>("button[data-formation]").forEach((b) => b.addEventListener("click", () => {
      const f = b.dataset.formation as FormationName;
      if (f === me.selection.formation) return;
      me.selection = autoSelect(me, f);
      me.tactics = { ...me.tactics, formation: f, roles: autoRoles(f, me.selection.starters.map((id) => playerOf(me, id).attrs)) };
      this.afterSquadChange();
    }));
    document.getElementById("sqAuto")!.addEventListener("click", () => {
      me.selection = autoSelect(me, me.selection.formation);
      this.afterSquadChange();
    });
    if (!locked) {
      const pickForSwap = (id: string) => {
        if (!this.selA) this.selA = id;
        else if (this.selA === id) this.selA = null;
        else {
          me.selection = swap(me, this.selA, id);
          this.selA = null;
        }
        this.afterSquadChange();
      };
      this.el.squad.querySelectorAll<HTMLElement>(".row[data-id]").forEach((r) => r.addEventListener("click", () => pickForSwap(r.dataset.id!)));
      this.el.squad.querySelectorAll<HTMLElement>(".fmBig [data-pid]").forEach((g) => g.addEventListener("click", () => pickForSwap(g.dataset.pid!)));
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
      <span style="font-size:13px">${m.name} <small style="color:var(--muted)">${m.age}세 · 연봉 ${m.wage}억 · ~S${m.contractUntil}${expiring.has(m.id) ? ' · <b style="color:var(--bad)">만료 예정</b>' : ""}${m.role === "assistant" && staffStyleTags(m).length ? ` · <span style="color:var(--accent)">${staffStyleTags(m).join(" · ")}</span>` : ""}</small></span>
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
      <div class="hint">수석코치는 1군 훈련 성장을 돕고, <b>자동 진행 라운드에서는 내 기본 전술에 자신의 성향(공격적·압박·점유 등)을 더해 교체와 전술 조정을 맡습니다</b>. GK 코치는 골키퍼 성장, 유스 코치는 아카데미 성장·스카우팅 정밀도, 피지컬 코치는 주간 회복과 부상 예방, 의무 팀장은 부상 기간, 스카우트는 이적 타깃의 잠재력 보고서를 담당합니다. 능력 8이 평균이며, 그 이상이면 효과가 커집니다. 연봉은 시즌 중 매주 예산에서 나갑니다.</div>
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
  /**
   * A league table. `division` names the league the rows belong to (the user's own by default) so the
   * promotion and relegation places can be marked: the top `SWAP` of any division below the first go
   * up, the bottom `SWAP` of any division above the last go down (divisions.ts).
   */
  private tableHtml(rows: ReturnType<typeof table>, compact = false, division = userDivision(this.state)): string {
    const s = this.state;
    const posOf = new Map(rows.map((r, i) => [r.club, i + 1]));
    const full = rows.length;
    const promoTo = division > 1 ? SWAP : 0;
    const relegFrom = division < DIVISIONS ? full - SWAP : full;
    return `<table class="std"><thead><tr><th>#</th><th class="l">클럽</th>${compact ? "" : '<th class="l mgrcol">감독</th>'}<th>경기</th>${compact ? "" : "<th>승</th><th>무</th><th>패</th><th>득</th><th>실</th>"}<th>득실</th><th>승점</th></tr></thead><tbody>${rows
      .map((r) => {
        const c = clubOf(s, r.club);
        const pos = posOf.get(r.club)!;
        const mgr = c.id === s.userClub ? s.managerName : c.manager?.name ?? "—";
        const mgrTitle = c.manager ? managerTags(c.manager).join(", ") : "";
        // zones only make sense on the full table, not the six-row home summary
        const zone = compact ? "" : pos <= promoTo ? " promo" : pos > relegFrom ? " releg" : "";
        const line = !compact && (pos === promoTo + 1 || pos === relegFrom + 1) ? " zoneline" : "";
        const title = zone === " promo" ? " title=\"승격권\"" : zone === " releg" ? " title=\"강등권\"" : "";
        return `<tr class="${r.club === s.userClub ? "me" : ""}${zone}${line}" data-club="${c.id}" style="cursor:pointer"${title}><td>${pos}</td><td class="l"><span class="embWrap">${emblemSvg(c, 18)}</span>${c.name}</td>${compact ? "" : `<td class="l mgrcol" title="${mgrTitle}">${mgr}</td>`}<td>${r.played}</td>${compact ? "" : `<td>${r.won}</td><td>${r.drawn}</td><td>${r.lost}</td><td>${r.gf}</td><td>${r.ga}</td>`}<td>${r.gf - r.ga > 0 ? "+" : ""}${r.gf - r.ga}</td><td><b>${r.pts}</b></td></tr>`;
      })
      .join("")}</tbody></table>`;
  }

  /** The standings card for one division, with a legend for whatever zones it has. */
  private divisionCard(division: number): string {
    const s = this.state;
    const mine = division === userDivision(s);
    const legend = [
      division > 1 ? `<span style="color:var(--accent)">■</span> 상위 ${SWAP}팀 승격` : "",
      division < DIVISIONS ? `<span style="color:var(--bad)">■</span> 하위 ${SWAP}팀 강등` : "",
    ].filter(Boolean).join(" · ");
    return `<div class="card"><h3>${divisionName(division)} <span>시즌 ${s.season}${mine ? " · 내 리그" : ""}</span></h3>${this.tableHtml(table(s, division), false, division)}<div class="hint">${legend}${legend ? " · " : ""}구단을 누르면 구단 카드가 열립니다.</div></div>`;
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

  /** Cup goals this season, parsed from the ties' scorer lines ("12' 이름 (클럽)"). */
  private cupRecordsHtml(): string {
    const s = this.state;
    const counts = new Map<string, { n: number; club: string }>();
    for (const t of s.cup.ties) for (const line of t.scorers) {
      const m = /'\s*(.+?)(?:\s*\(OG\))?\s*\((.+?)\)\s*$/.exec(line);
      if (!m || /\(OG\)/.test(line)) continue;
      const key = `${m[1]}|${m[2]}`;
      const e = counts.get(key) ?? { n: 0, club: m[2]! };
      e.n++; counts.set(key, e);
    }
    const rows = [...counts.entries()].map(([k, v]) => ({ name: k.split("|")[0]!, club: v.club, n: v.n })).sort((a, b) => b.n - a.n).slice(0, 8);
    const played = s.cup.ties.filter((t) => t.score).length;
    return `<div class="card"><h3>${CUP_NAME} 기록 <span>${played}경기</span></h3>${rows.length ? `<table class="std"><thead><tr><th>#</th><th class="l">선수</th><th class="l">클럽</th><th>골</th></tr></thead><tbody>${rows.map((r, i) => `<tr><td>${i + 1}</td><td class="l">${r.name}</td><td class="l">${r.club}</td><td>${r.n}</td></tr>`).join("")}</tbody></table>` : `<div class="hint">아직 ${CUP_NAME} 득점이 없습니다.</div>`}${s.cup.holder !== undefined ? `<div class="hint">우승: <b>${clubOf(s, s.cup.holder).name}</b></div>` : ""}</div>`;
  }

  private renderTable(): void {
    const s = this.state;
    const scorers = topScorers(s, 10);
    const assists = topAssists(s, 10);
    const ratings = topRatings(s, 10);
    // the user's own division first, then the rest — a relegated manager still wants to see the league above
    const mine = userDivision(s);
    const order = [mine, ...Array.from({ length: DIVISIONS }, (_, i) => i + 1).filter((d) => d !== mine)];
    const standings = order.map((d) => this.divisionCard(d)).join("");
    const sched = `<div class="card"><h3>내 일정 <span>${clubOf(s, s.userClub).name}</span></h3>${this.scheduleHtml()}</div>`;
    const records = `<div class="grid2">
      <div class="card"><h3>득점 순위</h3>${scorers.length ? `<table class="std"><thead><tr><th>#</th><th class="l">선수</th><th class="l">클럽</th><th>출장</th><th>도움</th><th>골</th></tr></thead><tbody>${scorers
        .map((x, i) => `<tr class="${x.club.id === s.userClub ? "me" : ""}"><td>${i + 1}</td><td class="l"><span class="embWrap">${face(x.player, x.club, 22)}</span>${x.player.name}</td><td class="l">${x.club.shortName}</td><td>${x.player.stats.apps}</td><td>${x.player.stats.assists ?? 0}</td><td><b>${x.player.stats.goals}</b></td></tr>`)
        .join("")}</tbody></table>` : `<div class="hint">아직 득점이 없습니다.</div>`}</div>
      <div class="card"><h3>도움 순위</h3>${assists.length ? `<table class="std"><thead><tr><th>#</th><th class="l">선수</th><th class="l">클럽</th><th>출장</th><th>골</th><th>도움</th></tr></thead><tbody>${assists
        .map((x, i) => `<tr class="${x.club.id === s.userClub ? "me" : ""}"><td>${i + 1}</td><td class="l"><span class="embWrap">${face(x.player, x.club, 22)}</span>${x.player.name}</td><td class="l">${x.club.shortName}</td><td>${x.player.stats.apps}</td><td>${x.player.stats.goals}</td><td><b>${x.player.stats.assists ?? 0}</b></td></tr>`)
        .join("")}</tbody></table>` : `<div class="hint">아직 도움이 없습니다.</div>`}</div>
      </div>
      <div class="card"><h3>평점 순위 <span>${RATING_MIN_APPS}경기 이상 출전</span></h3>${ratings.length ? `<table class="std"><thead><tr><th>#</th><th class="l">선수</th><th class="l">클럽</th><th>출장</th><th>골</th><th>도움</th><th>MOTM</th><th>평점</th></tr></thead><tbody>${ratings
        .map((x, i) => `<tr class="${x.club.id === s.userClub ? "me" : ""}"><td>${i + 1}</td><td class="l"><span class="embWrap">${face(x.player, x.club, 22)}</span>${x.player.name}</td><td class="l">${x.club.shortName}</td><td>${x.player.stats.apps}</td><td>${x.player.stats.goals}</td><td>${x.player.stats.assists ?? 0}</td><td>${x.player.stats.motm ?? 0}</td><td><b style="color:${ratingColor(x.rating)}">${fmtRating(x.rating)}</b></td></tr>`)
        .join("")}</tbody></table>` : `<div class="hint">${RATING_MIN_APPS}경기 이상 출전한 선수가 아직 없습니다.</div>`}</div>`;
    this.el.table.innerHTML = this.subTabs("table", [
      { id: "standings", label: "순위", html: standings },
      { id: "sched", label: "일정", html: sched },
      { id: "cup", label: CUP_NAME, html: this.cupHtml() },
      { id: "records", label: "기록", html: records + this.cupRecordsHtml() },
      { id: "hof", label: "명예의 전당", html: this.hallOfFameHtml() },
    ]);
    this.wireSubTabs(this.el.table);
    this.wireClubTaps(this.el.table);
  }

  // ------------------------------------------------------------ transfers
  private newsFilter = "all";
  /** Hide news lines outside the chosen kind (client-side, keeps the render cheap). */
  private applyNewsFilter(): void {
    this.el.home.querySelectorAll<HTMLButtonElement>("button[data-news]").forEach((b) => b.classList.toggle("on", b.dataset.news === this.newsFilter));
    this.el.home.querySelectorAll<HTMLElement>(".news [data-kind]").forEach((d) => { d.hidden = this.newsFilter !== "all" && d.dataset.kind !== this.newsFilter; });
  }

  private transferRole = "전체";
  private transferSort = "ovr";
  private transferLimit = 25;
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
    const sortFn: Record<string, (a: ReturnType<typeof transferTargets>[number], b: ReturnType<typeof transferTargets>[number]) => number> = {
      ovr: (a, b) => overall(b.player.attrs, b.player.role) - overall(a.player.attrs, a.player.role),
      value: (a, b) => (a.price ?? a.value) - (b.price ?? b.value),
      age: (a, b) => a.player.age - b.player.age || overall(b.player.attrs, b.player.role) - overall(a.player.attrs, a.player.role),
      pot: (a, b) => b.player.potential - a.player.potential,
    };
    const allTargets = transferTargets(s).filter((t) => this.transferRole === "전체" || t.player.role === this.transferRole).sort(sortFn[this.transferSort] ?? sortFn.ovr!);
    const targets = allTargets.slice(0, this.transferLimit);
    const moreBtn = allTargets.length > targets.length ? `<div class="actions" style="justify-content:center"><button id="trMore">더 보기 (${allTargets.length - targets.length}명 남음)</button></div>` : "";
    if (this.pendingBid && !clubOf(s, this.pendingBid.clubId).squad.some((p) => p.id === this.pendingBid!.playerId)) this.pendingBid = null;
    const btn = 'style="padding:3px 8px;font-size:12px"';
    const fmtRow = (p: SquadPlayer, clubName: string, right: string, clubId: number = me.id) => `<div class="row tr" style="cursor:default">
        <span class="num face">${face(p, clubOf(s, clubId), 28)}<i>${p.number}</i></span><span class="role">${p.role}</span>
        <span class="name" title="${p.name}" data-open="${clubId}:${p.id}" style="cursor:pointer;text-decoration:underline dotted rgba(255,255,255,.25)">${p.name} <span style="opacity:.55;font-size:11px">${clubName}</span></span>
        <span class="ovr">${overall(p.attrs, p.role).toFixed(1)}</span><span class="age">${p.age}세</span>
        <span class="val" style="font-family:'IBM Plex Mono',monospace;font-size:12px;text-align:right">${playerValue(p)}억</span>
        <span style="text-align:right">${right}</span>${INFO_BTN(`${clubId}:${p.id}`)}</div>`;
    const h: string[] = [], hOff: string[] = [], hBuy: string[] = [], hSell: string[] = [], hFree: string[] = [];
    h.push(`<div class="card"><h3>이적 시장 <span>예산 ${me.budget}억 · 스쿼드 ${me.squad.length}/${MAX_SQUAD}</span></h3>
      <div class="hint">${open ? `<b style="color:var(--good)">열림</b>${deadlineDay(s) ? ' · <b style="color:var(--accent)">마감일</b> — 구단들이 평소보다 쉽게 응합니다' : ""} — 프리시즌(1R 전), 겨울(11~12R 전), 시즌 종료 후에 거래할 수 있습니다.` : '<b style="color:var(--warn)">닫힘</b> — 다음 창구: ' + (s.round < 10 ? "11라운드 전" : "시즌 종료 후")}
      ${locked ? " · 경기 중에는 거래할 수 없습니다." : ""}</div>
      <div class="squad-tools"><label>포지션 <select id="trRole">${roles.map((r) => `<option ${r === this.transferRole ? "selected" : ""}>${r}</option>`).join("")}</select></label>
        <span class="chips">${([["ovr", "능력순"], ["value", "싼 순"], ["age", "어린 순"], ["pot", "잠재력순"]] as [string, string][]).map(([k, l]) => `<button class="sortChip ${this.transferSort === k ? "on" : ""}" data-sort="${k}">${l}</button>`).join("")}</span>
      <span class="hint">호가는 상대 구단이 부르는 값입니다(핵심 선수일수록 비쌈, 24명 넘는 구단의 잉여 선수는 가치 그대로). 영입 버튼을 누르면 금액을 제시하고, 구단은 수락하거나 한 번 역제안합니다.</span></div></div>`);
    // ---- incoming offers
    const offers = openOffers(s);
    if (offers.length || open) {
      hOff.push(`<div class="card"><h3>받은 제안 <span>${offers.length}건${offers.length ? " · 2라운드 후 만료" : ""}</span></h3>`);
      if (!offers.length) hOff.push(`<div class="hint">아직 제안이 없습니다. 창구가 열린 동안 매주 AI 구단이 필요한 포지션의 내 선수에게 제안을 보냅니다.</div>`);
      for (const o of offers) {
        const p = playerOf(me, o.playerId);
        const from = clubOf(s, o.from);
        const value = playerValue(p);
        const ratio = Math.round((o.fee / value) * 100);
        const weeks = Math.max(0, o.expiresRound - s.round);
        const canSell = can && me.squad.filter((q) => !q.onLoan && q.loanFrom === undefined).length > MIN_SQUAD;
        hOff.push(`<div class="offer">
          <div class="of-main"><b>${p.name}</b> <span class="role">${p.role} · ${overall(p.attrs, p.role).toFixed(1)} · ${p.age}세</span>
            <div class="hint">${from.name} → <b style="color:${ratio >= 100 ? "var(--good)" : ratio >= 90 ? "var(--text)" : "var(--warn)"}">${o.fee}억</b> (가치 ${value}억의 ${ratio}%) · ${weeks <= 0 ? "이번 주 만료" : `${weeks}주 후 만료`}${o.status === "countered" ? ` · <span style="color:var(--warn)">역제안 ${o.counterFee}억 거절됨 — 원안 유효, 재역제안 시 철회</span>` : ""}</div></div>
          <div class="of-acts">${INFO_BTN(`${me.id}:${p.id}`)}<button class="primary" data-accept="${o.id}" ${canSell ? "" : "disabled"} ${btn}>수락</button>${o.status === "open" ? `<button data-counter="${o.id}" ${canSell ? "" : "disabled"} ${btn}>역제안</button>` : ""}<button class="danger" data-reject="${o.id}" ${locked ? "disabled" : ""} ${btn}>거절</button></div>
        </div>`);
      }
      hOff.push(`</div>`);
    }
    // (grid wrapper dropped: sections live in tabs)
    hBuy.push(`<div class="card"><h3>영입 대상 <span>능력순 상위 ${targets.length}</span></h3><div class="roster">${targets
      .map((t) => {
        if (t.price === null) return fmtRow(t.player, t.club.shortName, '<span class="hint">비매</span>', t.club.id);
        if (t.player.refusedSeason === s.season) return fmtRow(t.player, t.club.shortName, '<span class="hint" style="color:var(--warn)">이적 거부</span>', t.club.id);
        const pb = this.pendingBid && this.pendingBid.playerId === t.player.id ? this.pendingBid : null;
        const ok = can && me.squad.length < MAX_SQUAD && me.budget >= Math.min(t.price, pb?.counter ?? t.price) * 0.5;
        return fmtRow(t.player, t.club.shortName, pb
          ? `<button class="primary" data-bid="${t.club.id}:${t.player.id}" ${ok ? "" : "disabled"} ${btn} title="역제안 ${pb.counter}억 — 마지막 제시">재입찰 ${pb.counter}억</button>`
          : `<button data-bid="${t.club.id}:${t.player.id}" ${ok ? "" : "disabled"} ${btn}>호가 ${t.price}억</button>`, t.club.id);
      })
      .join("")}</div></div>${moreBtn}`);
    hSell.push(`<div class="card"><h3>내 선수 판매 <span>최소 ${MIN_SQUAD}명 유지</span></h3><div class="hint">즉시 판매가는 지금 가장 높은 값을 부르는 구단 기준입니다. 더 받고 싶다면 받은 제안을 기다리거나 역제안하세요.</div><div class="roster">${[...me.squad]
      .sort((a, b) => overall(b.attrs, b.role) - overall(a.attrs, a.role))
      .map((p) => {
        if (p.loanFrom !== undefined) return fmtRow(p, `임대 (${clubOf(s, p.loanFrom).shortName})`, '<span class="hint">임대 선수</span>');
        if (p.onLoan) return fmtRow(p, "", '<span class="hint">임대 중</span>');
        const offer = open ? bestOffer(s, p.id) : null;
        return fmtRow(p, "", offer ? `<button data-sell="${p.id}" ${!locked && me.squad.length > MIN_SQUAD ? "" : "disabled"} ${btn}>${offer.fee}억 → ${offer.club.shortName}</button>` : '<span class="hint">제안 없음</span>');
      })
      .join("")}</div></div>`);
    // (grid wrapper dropped: sections live in tabs)
    // ---- free agents & loans
    // (grid wrapper dropped: sections live in tabs)
    const fas = [...s.freeAgents].sort((a, b) => overall(b.attrs, b.role) - overall(a.attrs, a.role));
    hFree.push(`<div class="card"><h3>자유계약 선수 <span>${fas.length}명 · 계약금 가치의 30%</span></h3>
      <div class="hint">계약이 끝나고 풀린 선수들입니다. 이적료 없이 계약금(가치 30%)과 시세보다 20% 높은 연봉으로 데려옵니다. 2시즌 동안 팀을 못 찾으면 사라집니다.</div>
      <div class="roster">${fas.length ? fas.map((p) => { const t = freeAgentTerms(p); return fmtRow(p, `연봉 ${t.wage}억`, `<button data-sign="${p.id}" ${can && me.squad.length < MAX_SQUAD && me.budget >= t.fee ? "" : "disabled"} ${btn} title="계약금 ${t.fee}억 · 연봉 ${t.wage}억 · ${t.years}년">계약금 ${t.fee}억</button>`, -1); }).join("") : '<div class="hint">지금은 자유계약 선수가 없습니다.</div>'}</div></div>`);
    const outs = loanableOut(s);
    const onLoan = me.squad.filter((p) => p.onLoan);
    const ins = loanTargets(s).filter((t) => this.transferRole === "전체" || t.player.role === this.transferRole).slice(0, 15);
    const myLoanIns = s.loans.filter((l) => l.to === me.id).length;
    const canLoanOut = can && me.squad.filter((p) => !p.onLoan && p.loanFrom === undefined).length - 1 >= MIN_SQUAD;
    hFree.push(`<div class="card"><h3>임대 <span>시즌 종료 시 복귀</span></h3>
      <div class="hint"><b>임대 보내기</b>: 23세 이하이거나 비주전인 선수를 필요한 구단에 보냅니다. 연봉 50%를 상대가 부담하고 어린 선수는 조금 더 빨리 성장합니다. <b>임대 영입</b>: 다른 구단의 비주전을 이적료 없이 데려오되 연봉은 전액 부담합니다 (시즌당 2명).</div>
      ${onLoan.length ? `<div class="roster">${onLoan.map((p) => { const l = s.loans.find((x) => x.playerId === p.id); return fmtRow(p, l ? `→ ${clubOf(s, l.to).shortName}` : "", '<span class="hint">임대 중 · 시즌 후 복귀</span>'); }).join("")}</div>` : ""}
      <h3 style="margin-top:6px">보낼 수 있는 선수 <span>${outs.length}명</span></h3>
      <div class="roster">${outs.length ? outs.map((p) => { const d = loanDestination(s, p); return fmtRow(p, "", d ? `<button data-loanout="${p.id}" ${canLoanOut ? "" : "disabled"} ${btn} title="${d.name}이(가) 받습니다">임대 → ${d.shortName}</button>` : '<span class="hint">원하는 구단 없음</span>'); }).join("") : '<div class="hint">임대 보낼 만한 선수가 없습니다.</div>'}</div>
      <h3 style="margin-top:6px">임대 영입 가능 <span>비주전 상위 ${ins.length} · ${myLoanIns}/2</span></h3>
      <div class="roster">${ins.map((t) => fmtRow(t.player, t.club.shortName, `<button data-loanin="${t.club.id}:${t.player.id}" ${can && me.squad.length < MAX_SQUAD && myLoanIns < 2 ? "" : "disabled"} ${btn} title="연봉 ${t.player.wage}억 전액 부담">임대 영입</button>`, t.club.id)).join("")}</div></div>`);
    // (grid wrapper dropped: sections live in tabs)
    const contracts = [...me.squad].filter((p) => p.loanFrom === undefined).sort((a, b) => a.contractUntil - b.contractUntil || b.wage - a.wage);
    hSell.push(`<div class="card"><h3>계약 <span>연봉 총액 ${wageBill(me)}억/시즌</span></h3>
      <div class="hint">계약은 시즌 단위입니다. 만료 시즌(이번 시즌이면 <b style="color:var(--warn)">만료 예정</b>)인 선수는 시즌이 끝나면 자유계약으로 풀리므로 미리 재계약하세요. 계약금은 선수 가치의 5%×연수입니다.</div>
      <div class="roster">${contracts
        .map((p) => {
          const exp = p.contractUntil <= s.season;
          const t1 = renewalTerms(p, 1), t3 = renewalTerms(p, 3);
          return `<div class="row tr" style="cursor:default"><span class="num face">${face(p, me, 28)}<i>${p.number}</i></span><span class="role">${p.role}</span>
            <span class="name">${p.name} <span style="opacity:.55;font-size:11px">연봉 ${p.wage}억${p.onLoan ? " · 임대 중" : ""}</span></span>
            <span class="ovr">${overall(p.attrs, p.role).toFixed(1)}</span><span class="age">${p.age}세</span>
            <span style="font-family:'IBM Plex Mono',monospace;font-size:12px;text-align:right;color:${exp ? "var(--warn)" : "var(--muted)"}">~S${p.contractUntil}</span>
            <span style="text-align:right;display:flex;gap:4px;justify-content:flex-end">${[1, 3].map((y) => `<button data-renew="${p.id}:${y}" ${locked || me.budget < (y === 1 ? t1.fee : t3.fee) ? "disabled" : ""} title="계약금 ${y === 1 ? t1.fee : t3.fee}억 · 연봉 ${y === 1 ? t1.wage : t3.wage}억" style="padding:3px 6px;font-size:11px">+${y}년 ${y === 1 ? t1.fee : t3.fee}억</button>`).join("")}</span>${INFO_BTN(`${me.id}:${p.id}`)}</div>`;
        })
        .join("")}</div></div>`);
    this.el.transfers.innerHTML = h.join("") + this.subTabs("transfers", [
      { id: "buy", label: "영입", html: hBuy.join("") },
      { id: "sell", label: "판매·계약", html: hSell.join("") },
      { id: "free", label: "자유·임대", html: hFree.join("") },
      { id: "off", label: `제안${offers.length ? ` <i class="badge">${offers.length}</i>` : ""}`, html: hOff.join("") || '<div class="card"><h3>받은 제안</h3><div class="hint">아직 제안이 없습니다. 창구가 열리면 AI 구단이 내 선수에게 제안을 보냅니다.</div></div>' },
    ]);
    this.wireSubTabs(this.el.transfers);
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
      this.transferLimit = 25;
      this.renderTransfers();
    });
    this.el.transfers.querySelectorAll<HTMLButtonElement>("button[data-sort]").forEach((b) => b.addEventListener("click", () => { this.transferSort = b.dataset.sort!; this.transferLimit = 25; this.renderTransfers(); }));
    document.getElementById("trMore")?.addEventListener("click", () => { this.transferLimit += 25; this.renderTransfers(); });
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
  /** My match at a glance: score, scorers, man of the match and my three best-rated players. */
  /**
   * "내 지시" — what happened after each change the manager made during the match (tactics-report.ts).
   *
   * Deliberately worded as a sequence, not a cause: the opponent adjusts too and ten minutes is a
   * small sample, so the card says what followed a change and leaves the reading to the manager.
   */
  private tacticsReportHtml(): string {
    const rep = this.lastTactics;
    if (!rep) return "";
    if (!rep.changes.length) {
      return `<div class="card"><h3>내 지시</h3><div class="hint">전술을 ${rep.unmeasured}번 바꿨지만, 앞뒤로 ${MIN_WINDOW_MINUTES}분씩은 지나야 효과를 읽을 수 있어 이번엔 측정하지 못했습니다.</div></div>`;
    }
    const body = rep.changes.map((c) => {
      const rows = [...c.lines]
        .sort((a, b) => Math.abs(lineSwing(b)) - Math.abs(lineSwing(a)))
        .map((l) => {
          const swing = lineSwing(l);
          const moved = Math.abs(swing) >= 0.1;
          const better = l.good === "up" ? swing > 0 : swing < 0;
          const color = !moved ? "var(--muted)" : better ? "var(--good)" : "var(--bad)";
          const arrow = !moved ? "→" : swing > 0 ? "↑" : "↓";
          return `<tr><td class="l">${l.label}</td><td>${formatValue(l, l.before)}</td><td style="color:${color}">${arrow}</td><td style="color:${color}"><b>${formatValue(l, l.after)}</b></td></tr>`;
        }).join("");
      return `<div style="margin-top:8px">
        <div><b>${c.minute}분</b> ${c.labels.join(" · ")}</div>
        <table class="std" style="margin-top:4px"><thead><tr><th class="l">지표</th><th>이전 ${c.beforeMinutes}분</th><th></th><th>이후 ${c.afterMinutes}분</th></tr></thead><tbody>${rows}</tbody></table>
      </div>`;
    }).join("");
    const skipped = rep.unmeasured ? ` 나머지 ${rep.unmeasured}번은 앞뒤 구간이 ${MIN_WINDOW_MINUTES}분에 못 미쳐 뺐습니다.` : "";
    return `<div class="card"><h3>내 지시 <span>변경 ${rep.changes.length}건</span></h3>${body}
      <div class="hint" style="margin-top:8px">슈팅·태클은 10분당 횟수입니다. 바꾼 <b>뒤에</b> 벌어진 일이지 바꿨기 <b>때문에</b> 벌어진 일은 아닙니다 — 상대도 함께 조정하고, 스코어 자체가 양 팀을 움직입니다.${skipped}</div></div>`;
  }

  private myMatchSummaryHtml(kind: "league" | "cup", round: number, cupStage: number): string {
    const s = this.state;
    const me = this.me;
    const fx = kind === "cup"
      ? s.cup.ties.find((t) => t.stage === cupStage && (t.home === me.id || t.away === me.id) && t.score)
      : s.fixtures.find((f) => f.round === round && (f.home === me.id || f.away === me.id) && f.score);
    if (!fx || !fx.score) return "";
    const home = clubOf(s, fx.home), away = clubOf(s, fx.away);
    const mine = fx.home === me.id ? fx.score[0] - fx.score[1] : fx.score[1] - fx.score[0];
    const verdict = mine > 0 ? ["승리", "var(--good)"] : mine < 0 ? ["패배", "var(--bad)"] : ["무승부", "var(--muted)"];
    const rated = me.squad.filter((p) => (p.form?.length ?? 0) > 0 && p.stats.apps > 0).map((p) => ({ p, r: p.form![p.form!.length - 1]! })).sort((a, b) => b.r - a.r).slice(0, 3);
    const motm = fx.motm ? (home.squad.find((p) => p.id === fx.motm!.playerId) ?? away.squad.find((p) => p.id === fx.motm!.playerId)) : undefined;
    return `<div class="card mine"><h3>내 경기 <span style="color:${verdict[1]}">${verdict[0]}</span></h3>
      <div class="fixture" style="padding:2px 0"><div class="team" data-clubcard="${home.id}"><span class="dot" style="background:${home.color}"></span>${home.shortName}</div><div class="vs" style="font-size:26px;font-weight:700">${fx.score[0]} - ${fx.score[1]}</div><div class="team r" data-clubcard="${away.id}">${away.shortName}<span class="dot" style="background:${away.color};margin:0 0 0 6px"></span></div></div>
      ${fx.scorers.length ? `<div class="scorers">${fx.scorers.join(" · ")}</div>` : '<div class="hint">득점 없음</div>'}
      ${motm ? `<div class="hint"><span style="color:var(--accent)">★ MOTM</span> ${motm.name} (${home.squad.includes(motm) ? home.shortName : away.shortName}) ${fmtRating(fx.motm!.rating)}</div>` : ""}
      ${rated.length ? `<div class="pcSeason">${rated.map(({ p, r }) => `<span>${p.name} <b style="color:${ratingColor(r)}">${fmtRating(r)}</b> ${INFO_BTN(`${me.id}:${p.id}`)}</span>`).join("")}</div>` : ""}
    </div>${this.tacticsReportHtml()}`;
  }

  private renderResults(round: number, kind: "league" | "cup" = "league", cupStage = 0): void {
    const s = this.state;
    const me = s.userClub;
    const line = (home: Club, away: Club, score: [number, number] | null, scorers: string[], extra = "", motm?: Fixture["motm"], attendance?: number) => {
      const mine = home.id === me || away.id === me;
      let star = "";
      if (motm) {
        const mp = home.squad.find((p) => p.id === motm.playerId) ?? away.squad.find((p) => p.id === motm.playerId);
        if (mp) star = `<div class="scorers"><span style="color:var(--accent)">★ MOTM</span> ${mp.name} (${home.squad.includes(mp) ? home.shortName : away.shortName}) <b style="color:${ratingColor(motm.rating)}">${fmtRating(motm.rating)}</b></div>`;
      }
      const crowd = attendance ? `<div class="scorers" style="opacity:.8">관중 ${attendance.toLocaleString("ko-KR")}명${attendance >= clubCapacity(home) ? ' · <span style="color:var(--accent)">매진</span>' : ""}</div>` : "";
      return `<div class="result ${mine ? "me" : ""}"><span class="r">${home.name}</span><span class="sc">${score ? `${score[0]} - ${score[1]}` : "—"}</span><span>${away.name}${extra}</span>${scorers.length ? `<div class="scorers">${scorers.join(" · ")}</div>` : ""}${star}${crowd}</div>`;
    };
    let title: string, body: string, btn: string;
    if (kind === "cup") {
      const ties = s.cup.ties.filter((t) => t.stage === cupStage);
      title = `${CUP_NAME} ${CUP_STAGE_LABEL[cupStage]} 결과`;
      body = ties.map((t) => line(clubOf(s, t.home), clubOf(s, t.away), t.score, t.scorers, t.penalties ? ` <small style="color:var(--accent)">승부차기 ${t.penalties[0]}-${t.penalties[1]}</small>` : "", t.motm, t.attendance)).join("");
      if (cupStage === 3 && s.cup.holder !== undefined) body += `<div class="hint" style="color:var(--accent);margin-top:6px">${CUP_NAME} 우승: <b>${clubOf(s, s.cup.holder).name}</b></div>`;
      btn = "다음 라운드로 →";
    } else {
      // my own division only: the other one is resolved as the round advances, and lives on the 순위 screen
      const fx = s.fixtures.filter((f) => f.round === round && divisionOf(clubOf(s, f.home)) === userDivision(s));
      title = `${divisionName(userDivision(s))} 라운드 ${round + 1} 결과`;
      body = fx.map((f) => line(clubOf(s, f.home), clubOf(s, f.away), f.score, f.scorers, "", f.motm, f.attendance)).join("");
      btn = round + 1 >= seasonRounds(s) ? "시즌 결산 보기 →" : "다음 라운드로 →";
    }
    this.el.results.innerHTML = `${this.interviewHtml()}${this.myMatchSummaryHtml(kind, round, cupStage)}<div class="card"><h3>${title}</h3>${body}<div class="actions" style="margin-top:8px"><button class="primary" id="btnNextRound">${btn}</button></div></div>
      <div class="card"><h3>순위</h3>${this.tableHtml(table(s))}</div>`;
    this.wireInfo(this.el.results, "results");
    this.wireClubTaps(this.el.results);
    this.wireStory(this.el.results);
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
    const verdict = pos === 1 ? "리그 우승! 완벽한 시즌입니다." : pos <= 3 ? "상위권 마무리. 우승 도전은 다음 시즌으로." : pos > n - 2 ? (userDivision(s) < DIVISIONS ? "강등권 성적입니다. 전력 보강이 시급합니다." : "최하위권 시즌입니다. 전력 보강이 시급합니다.") : "중위권 시즌. 핵심 선수를 지키고 보강하세요.";
    const highlights = s.news.filter((x) => /우승|이적|퇴장|승부차기|영입|판매|경질|부임/.test(x)).slice(0, 8);
    const moy = managerOfYear(s);
    const myExpected = userExpectation(s);
    const stat = (label: string, value: string) => `<div class="stat"><small>${label}</small><b>${value}</b></div>`;
    const h: string[] = [];
    // What the season earned, in the order a manager would rank them: the title, the cup, going up.
    const trophyArt = pos === 1 ? "trophy-league" : s.cup.holder === me.id ? "trophy-cup" : inPromotionZone(s, me.id) ? "trophy-promotion" : null;
    h.push(`<div class="card review"><h3>시즌 ${s.season} 결산 <span class="mgr">감독 ${s.managerName}</span><span>${me.name}</span></h3>
      ${trophyArt ? `<img class="rvArt" src="./art/${trophyArt}.webp" alt="">` : ""}
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
      <div class="actions" style="margin-top:8px"><button class="primary" data-act="nextSeason">다음 시즌 시작 →</button><button data-act="shareCard" title="시즌 결산을 이미지 카드로 저장/공유">🖼 요약 카드 공유</button><button data-act="home">홈으로</button></div>
      <div class="hint">다음 시즌 시작 시 나이·성장·계약 만료·순위 상금이 정산되고 새 일정과 컵 대진이 만들어집니다.</div></div>`);
    h.push(`<div class="grid2">`);
    const bottom = userDivision(s) >= DIVISIONS;
    h.push(`<div class="card"><h3>최종 순위 <span>${bottom ? "상위 2팀 승격" : "하위 2팀 강등권"}</span></h3>${this.tableHtml(rows).replace(/<tr class="([^"]*)"><td>(\d+)<\/td>/g, (_m, cls: string, p: string) => bottom
      ? `<tr class="${cls}"><td>${p}${Number(p) <= 2 ? '<small class="relTag" style="color:var(--good)">승격</small>' : ""}</td>`
      : `<tr class="${cls}${Number(p) > n - 2 ? " rel" : ""}"><td>${p}${Number(p) > n - 2 ? '<small class="relTag">강등권</small>' : ""}</td>`)}</div>`);
    h.push(`<div class="card"><h3>리그 득점 TOP 3</h3>${scorers.length ? `<table class="std"><thead><tr><th>#</th><th class="l">선수</th><th class="l">클럽</th><th>출장</th><th>골</th></tr></thead><tbody>${scorers
      .map((x, i) => `<tr class="${x.club.id === me.id ? "me" : ""}"><td>${i + 1}</td><td class="l"><span class="embWrap">${face(x.player, x.club, 22)}</span>${x.player.name}</td><td class="l">${x.club.shortName}</td><td>${x.player.stats.apps}</td><td><b>${x.player.stats.goals}</b></td></tr>`).join("")}</tbody></table>` : '<div class="hint">득점 기록이 없습니다.</div>'}
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
        ${stat("홈 관중", me.fans?.seasonHome ? `평균 ${avgHomeAttendance(me).toLocaleString("ko-KR")}명 <small>총 ${me.fans.seasonAttendance.toLocaleString("ko-KR")}명 · ${me.fans.seasonHome}경기</small>` : "—")}
        ${stat("시즌 최다 관중", me.fans?.bestAttendance ? `${me.fans.bestAttendance.toLocaleString("ko-KR")}명 <small>${me.fans.bestAttendance >= clubCapacity(me) ? "매진" : `${clubCapacity(me).toLocaleString("ko-KR")}석 중`} · 팬 분위기 ${moodLabel(me.fans.mood)}</small>` : "—")}
      </div>
      <h3 style="margin-top:10px">재정 요약 <span>억원</span></h3>
      <div class="stats">
        ${stat("시즌 시작 → 종료", `${money(fin.start)} → ${money(fin.end)} ${signed(fin.end - fin.start)}`)}
        ${stat("지급 연봉", `−${money(fin.wages)}`)}
        ${stat("수입 (입장·중계·후원)", `+${money(fin.revenue)}${fin.gate ? ` <small>입장 수입 ${money(fin.gate)}</small>` : ""}`)}
        ${stat("컵 상금", fin.cupPrize ? `+${money(fin.cupPrize)}` : "—")}
        ${stat("순위 상금 (다음 시즌 지급)", `+${money(fin.leaguePrize)}`)}
      </div>
      <div class="hint">순위 상금은 다음 시즌 시작 시 예산에 더해집니다. 이적료와 계약금은 시작 → 종료 차이에 이미 반영되어 있습니다.</div>
      ${s.seasonHistory.length ? `<h3 style="margin-top:10px">역대 시즌</h3><table class="std"><thead><tr><th>시즌</th><th class="l">리그 우승</th><th class="l">${CUP_NAME}</th><th>내 순위</th><th>승점</th><th class="l">올해의 감독</th></tr></thead><tbody>${[...s.seasonHistory].reverse()
        .map((r) => `<tr><td>S${r.season}</td><td class="l">${clubOf(s, r.champion).shortName}</td><td class="l">${r.cupWinner === null ? "—" : clubOf(s, r.cupWinner).shortName}</td><td>${r.userPosition}위</td><td>${r.userPts}</td><td class="l">${r.managerOfYear ? `${r.managerOfYear.name} (${clubOf(s, r.managerOfYear.club).shortName})` : "—"}</td></tr>`).join("")}</tbody></table>` : ""}</div>`);
    h.push(`</div>`);
    h.push(`<div class="grid2">${this.achievementsReviewHtml()}${this.careerReviewHtml()}</div>`);
    h.push(this.cupHtml());
    this.el.review.innerHTML = h.join("");
    this.el.review.querySelectorAll<HTMLButtonElement>("button[data-act]").forEach((b) => b.addEventListener("click", () => {
      if (b.dataset.act === "home") this.show("home");
      else if (b.dataset.act === "shareCard") void this.shareSeasonCard(b);
      else this.act(b.dataset.act!);
    }));
  }

  /** 1080×1350 season summary card as PNG → share sheet, or a download (blocked on the claude.ai host → hint). */
  private async shareSeasonCard(btn: HTMLButtonElement): Promise<void> {
    const s = this.state;
    const me = this.me;
    const rows = table(s);
    const pos = rows.findIndex((r) => r.club === me.id) + 1;
    const mine = rows[pos - 1]!;
    const myTop = [...me.squad].sort((a, b) => b.stats.goals - a.stats.goals || b.stats.apps - a.stats.apps)[0];
    const cupSt = userCupStatus(s);
    const myLastTie = [...s.cup.ties].reverse().find((t) => t.score && (t.home === me.id || t.away === me.id));
    const cupResult = cupSt === "holder" ? "우승 🏆" : myLastTie ? `${CUP_STAGE_LABEL[myLastTie.stage]} ${tieWinner(myLastTie) === me.id ? "진출" : "탈락"}` : "—";
    const n = rows.length;
    const verdict = pos === 1 ? "리그 우승! 완벽한 시즌입니다." : pos <= 3 ? "상위권 마무리. 우승 도전은 다음 시즌으로." : pos > n - 2 ? (userDivision(s) < DIVISIONS ? "강등권 성적입니다. 전력 보강이 시급합니다." : "최하위권 시즌입니다. 전력 보강이 시급합니다.") : "중위권 시즌. 핵심 선수를 지키고 보강하세요.";
    if (!isNativeApp() && downloadsBlocked() && !("share" in navigator)) { alert("이 환경에서는 파일 저장이 막혀 있습니다. 앱이나 브라우저에서 열면 카드를 공유할 수 있습니다."); return; }
    const old = btn.textContent;
    btn.disabled = true; btn.textContent = "카드 만드는 중…";
    try {
      const canvas = drawSeasonCard({
        clubName: me.name, clubColor: me.color, managerName: s.managerName, season: s.season,
        position: pos, teams: n, pts: mine.pts, won: mine.won, drawn: mine.drawn, lost: mine.lost, gf: mine.gf, ga: mine.ga,
        topScorer: myTop && myTop.stats.goals > 0 ? `${myTop.name} ${myTop.stats.goals}골` : "—",
        cupResult, verdict, champion: clubOf(s, rows[0]!.club).name,
      });
      const blob = await canvasBlob(canvas);
      const r = await shareFile(blob, `3sec-season${s.season}-${me.shortName}.png`, `가난한자의 FM 시즌 ${s.season} 결산`);
      if (r === "blocked") alert("이 환경에서는 파일 저장이 막혀 있습니다. 앱이나 브라우저에서 열면 카드를 공유할 수 있습니다.");
    } catch (err) {
      console.error(err);
      alert("카드를 만들지 못했습니다.");
    } finally {
      btn.disabled = false; btn.textContent = old;
    }
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
    const others = this.live.filter((x) => x !== user).map((x) => ({ label: "", match: x.match, fixture: x.fixture }));
    this.el.tabMatch.disabled = false;
    this.renderAll();
    this.show("match");
    // atmosphere: today's crowd (same seeded draw recordAttendance will make), derby flag, and the season context for the live table
    const home = clubOf(s, mine.home), away = clubOf(s, mine.away);
    const attendance = expectedAttendance(s, home, away, this.liveKind === "cup", new Rng((fixtureSeed(s, mine) ^ 0x2545f491) >>> 0));
    const derby = !!derbyFor(s, mine);
    this.screen.start(user.match, side, others, () => this.finishRound(), {
      crowd: { attendance, capacity: clubCapacity(home), derby },
      derby,
      live: this.liveKind === "league" ? { state: s, fixture: mine } : undefined,
      clubs: [this.clubLook(home), this.clubLook(away)],
      ages: Object.fromEntries([...home.squad, ...away.squad].map((p) => [p.id, p.age])),
      finishOthers: async () => {
        // replay the other grounds on the worker pool from kick-off (deterministic: same seeds, same AI, same result)
        const items = this.live!.filter((x) => x !== user && x.match.state.phase !== "FULL_TIME");
        if (!items.length) return;
        const jobs = items.map((x) => (x.tie ? cupJob(s, x.tie) : leagueJob(s, x.fixture)));
        const results = await getSimPool().run(jobs);
        items.forEach((x, i) => {
          const done = asMatch(results.get(jobs[i]!.id)!);
          x.match = done;
          const o = others.find((y) => y.fixture === x.fixture);
          if (o) o.match = done;
        });
      },
    });
  }

  /** Simulate n rounds back to back; rounds in between are settled silently, the last one is shown. */
  private async simRounds(n: number): Promise<void> {
    const s = this.state;
    if (this.challenge) return;
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
      const last = k === n - 1 || seasonOver(s) || (!cup && s.round + 1 >= seasonRounds(s));
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
    const total = seasonRounds(s);
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
      quiet: true,
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
    if (!this.live || this.challenge) return;
    // What the manager's own changes did, read off the match before the screen is torn down.
    this.lastTactics = this.screen.tacticsReport();
    const round = s.round;
    const kind = this.liveKind;
    const cupStage = s.cup.stage;
    // 승부차기: the user's cup tie is level after 90 minutes → compute the kick-by-kick sequence before
    // recording (recordCupResult makes the identical seeded draw), then present it one kick per tap.
    const mineLive = kind === "cup" ? this.live.find((x) => x.tie && (x.tie.home === s.userClub || x.tie.away === s.userClub)) : undefined;
    const shootout = mineLive?.tie && mineLive.match.state.phase === "FULL_TIME" && mineLive.match.state.score[0] === mineLive.match.state.score[1]
      ? { detail: penaltyShootoutDetail(s, mineLive.tie, mineLive.match), match: mineLive.match } : null;
    this.settleLive();
    this.screen.leave();
    this.save();
    this.renderAll();
    if (shootout) {
      this.showShootout(shootout.match, shootout.detail, () => this.afterRound(round, kind, cupStage));
      return;
    }
    this.afterRound(round, kind, cupStage);
  }

  /**
   * Shoot-out sheet: kicks are revealed one per tap (⚽ / ❌ per team), with whistle and crowd sounds,
   * then the result; `done` runs when the sheet is closed. Sounds use the match screen's Sfx.
   */
  private showShootout(m: Match, d: ShootoutDetail, done: () => void, note?: (won: boolean) => string): void {
    const s = this.state;
    const [home, away] = m.teams;
    const userSide: TeamId = clubOf(s, s.userClub).name === home.name ? 0 : 1;
    const outcome = note ?? ((won: boolean) => (won ? " · 다음 라운드 진출!" : " · 우리 팀 탈락…"));
    const per = (team: TeamId) => d.kicks.filter((k) => k.team === team);
    const slots = Math.max(5, per(0).length, per(1).length);
    let shown = 0;
    const sfx = this.screen.sounds;
    this.sheetLock = true;
    const paint = () => {
      const kicks = d.kicks.slice(0, shown);
      const tally: [number, number] = [0, 0];
      for (const k of kicks) if (k.scored) tally[k.team]++;
      const row = (team: TeamId) => {
        const mine = per(team);
        const cells: string[] = [];
        for (let i = 0; i < slots; i++) {
          const k = mine[i];
          const idx = k ? d.kicks.indexOf(k) : -1;
          const vis = k && idx < shown;
          cells.push(`<span class="soCell${vis ? (k!.scored ? " ok" : " miss") : ""}">${vis ? (k!.scored ? "⚽" : "❌") : k ? "·" : ""}</span>`);
        }
        const t = m.teams[team];
        return `<div class="soRow"><span class="soTeam" style="color:${t.color}">${t.shortName}</span><span class="soCells">${cells.join("")}</span><b class="soTally">${tally[team]}</b></div>`;
      };
      const last = kicks[kicks.length - 1];
      const over = shown >= d.kicks.length;
      const winner = over ? (d.score[0] > d.score[1] ? 0 : 1) : null;
      const lastLine = last ? `<div class="soLast">${m.teams[last.team].shortName} <b>${last.name}</b> — ${last.scored ? '<span style="color:var(--good)">골! ⚽</span>' : '<span style="color:var(--bad)">실축 ❌</span>'}</div>` : `<div class="soLast hint">${home.shortName}부터 5명씩 찹니다. 동점이면 서든데스.</div>`;
      const result = over ? `<div class="soResult" style="color:${m.teams[winner!].color}">${m.teams[winner!].shortName} 승부차기 ${d.score[0]}-${d.score[1]} 승리${outcome(winner === userSide)}</div>` : "";
      this.openSheet(`<div class="card shootout"><h3>승부차기 <span>${home.shortName} ${m.state.score[0]} - ${m.state.score[1]} ${away.shortName} · 90분 동점</span></h3>
        ${row(0)}${row(1)}${lastLine}${result}
        <div class="actions" style="margin-top:8px">${over
          ? `<button class="primary" data-so="done">결과 보기 →</button>`
          : `<button class="primary" data-so="next">탭하여 다음 킥 ▶</button><button data-so="all">모두 보기</button>`}</div></div>`);
    };
    const kickSound = (scored: boolean) => {
      sfx.unlock();
      sfx.whistle(1, 0.22);
      setTimeout(() => {
        if (!scored) { sfx.ooh(); return; }
        sfx.roar();
      }, 500);
    };
    paint();
    this.sheetBody.onclick = (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>("[data-so]");
      if (!b) return;
      if (b.dataset.so === "next" && shown < d.kicks.length) {
        const k = d.kicks[shown]!;
        shown++;
        kickSound(k.scored);
        if (shown >= d.kicks.length) setTimeout(() => { sfx.whistle(3, 0.35); sfx.clap(); }, 900);
        paint();
      } else if (b.dataset.so === "all") {
        shown = d.kicks.length;
        sfx.unlock(); sfx.whistle(3, 0.35); sfx.clap();
        paint();
      } else if (b.dataset.so === "done") {
        this.sheetBody.onclick = null;
        this.sheetLock = false;
        this.closeSheet();
        done();
      }
    };
  }

  /** Results screen and the cup celebration, after the round is recorded (and any shoot-out shown). */
  private afterRound(round: number, kind: "league" | "cup", cupStage: number): void {
    const s = this.state;
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

  // ------------------------------------------------------------ 도전 모드 (scenario matches outside the season)
  /** The scenario list: a collapsed card on the home screen, an open one in the settings. */
  private challengeCardHtml(open: boolean): string {
    const rec = loadChallengeRecords();
    const done = CHALLENGES.filter((c) => (rec[c.id]?.wins ?? 0) > 0).length;
    const active = this.challenge;
    const rows = CHALLENGES.map((c) => {
      const r = rec[c.id];
      const best = r ? `${r.best ?? "—"} · ${r.tries}회 도전 · 성공 ${r.wins}` : "아직 도전 전";
      return `<div class="chalRow"><div class="chalInfo"><div><b>${c.icon} ${c.title}</b> <span class="chalStars">${chalStars(c.stars)}</span>${r && r.wins > 0 ? ' <span class="chalDone">✓</span>' : ""}</div>
        <div class="hint">${c.desc} <b>${c.goal}.</b></div><div class="hint chalBest">${best}</div></div>
        <button class="${active ? "" : "primary"}" data-chal="${c.id}" ${active ? "disabled" : ""}>도전</button></div>`;
    }).join("");
    return `<div class="card chal"><h3>도전 모드 <span>약 3분 · 시즌 기록과 무관 · 성공 ${done}/${CHALLENGES.length}</span></h3>
      <details ${open ? "open" : ""}><summary class="hint" style="cursor:pointer">시나리오 ${CHALLENGES.length}개 — 내 스쿼드로 특정 상황에 뛰어듭니다. 결과는 시즌에 남지 않습니다.</summary>
      <div class="chalList">${rows}</div>
      ${open ? `<div class="actions" style="margin-top:6px"><button class="danger" data-chal-clear="1">도전 기록 초기화</button></div>` : ""}</details></div>`;
  }

  private wireChallenge(root: HTMLElement): void {
    root.querySelectorAll<HTMLButtonElement>("button[data-chal]").forEach((b) => b.addEventListener("click", () => void this.startChallenge(b.dataset.chal!)));
    root.querySelector<HTMLButtonElement>("button[data-chal-clear]")?.addEventListener("click", () => {
      if (!confirm("도전 모드 기록을 모두 지울까요?")) return;
      clearChallengeRecords();
      this.renderHome();
      this.renderSettings();
    });
  }

  /** Build the scenario match, fast-forward to its starting minute (chunked, with the overlay) and hand it to the match screen. */
  private async startChallenge(id: string): Promise<void> {
    const scen = challengeById(id);
    if (!scen || this.challenge) return;
    if (this.live) { alert("리그 경기가 진행 중입니다. 먼저 그 경기를 끝내세요."); return; }
    const s = this.state;
    const built = buildChallenge(s, scen);
    const { match, side } = built;
    const me = this.me;
    const mm = Math.floor(scen.startAt / 60);
    if (scen.kind === "shootout") {
      await this.runChunked(() => match.fastForward(Infinity, 20 * 60), "90분을 시뮬레이션하는 중… 0:0");
      applyScenario(match, scen, side);
      const day = Math.floor(Date.now() / 86400000);
      const tie: CupTie = { id: day % 997, stage: 3, home: me.id, away: -1, score: null, scorers: [] };
      const detail = penaltyShootoutDetail(s, tie, match);
      const { ok, mine, theirs } = challengeOutcome(match, scen, side, detail.score);
      this.showShootout(match, detail, () => void this.finishChallenge(scen, ok, mine, theirs, " (승부차기)"), (won) => (won ? " · 도전 성공!" : " · 도전 실패…"));
      return;
    }
    if (scen.startAt > 0) {
      // Forced stoppage time must be in place before the clock reaches the whistle, or the engine ends the half first.
      const pre = scen.addedTime ? scen.startAt - 2 : scen.startAt;
      await this.runChunked(() => match.fastForward(pre, 20 * 60), `${scen.title}: ${mm}분 상황을 만드는 중…`);
      if (scen.addedTime) { match.state.addedTime = scen.addedTime; match.fastForward(scen.startAt); }
    }
    applyScenario(match, scen, side);
    this.challenge = { scen, match, side };
    this.renderAll();
    this.show("match");
    const homeClub = side === 0 ? me : null;
    const capacity = homeClub ? clubCapacity(homeClub) : 30000;
    this.screen.start(match, side, [], () => {
      const { ok, mine, theirs } = challengeOutcome(match, scen, side);
      void this.finishChallenge(scen, ok, mine, theirs);
    }, {
      crowd: { attendance: Math.round(capacity * (scen.derby ? 0.98 : 0.8)), capacity, derby: !!scen.derby },
      derby: !!scen.derby,
    });
  }

  /** Verdict, local record, then home. Nothing of the season is touched: no settleLive, no save. */
  private async finishChallenge(scen: ChallengeScenario, ok: boolean, mine: number, theirs: number, note = ""): Promise<void> {
    const rec = recordChallenge(scen.id, ok, mine, theirs, note);
    this.challenge = null;
    if (this.current === "match") this.screen.leave();
    this.renderAll();
    this.show("home");
    if (ok) {
      await celebrate({
        kind: "clinch",
        title: "도전 성공!",
        subtitle: `${scen.icon} ${scen.title} ${chalStars(scen.stars)}`,
        color: "#7ad0ff",
        lines: [`결과 ${mine}-${theirs}${note} — ${scen.goal}.`, `이 시나리오 ${rec.tries}회 도전, ${rec.wins}회 성공.`, "도전 모드 결과는 시즌 기록에 들어가지 않습니다."],
        button: "🎉 좋았어",
      });
      this.renderHome();
      return;
    }
    this.openSheet(`<div class="card"><h3>도전 실패 <span>${scen.icon} ${scen.title} ${chalStars(scen.stars)}</span></h3>
      <div style="font-size:26px;font-weight:700;text-align:center;margin:4px 0">${mine} - ${theirs}${note}</div>
      <div class="hint">조건: <b>${scen.goal}</b>. 이 시나리오 ${rec.tries}회 도전, ${rec.wins}회 성공${rec.best ? ` · 최고 ${rec.best}` : ""}. 같은 날에는 같은 상황이 다시 펼쳐지니 전술을 바꿔 보세요.</div>
      <div class="actions" style="margin-top:8px"><button class="primary" data-chal-retry="${scen.id}">다시 도전 ↻</button><button data-sheet="close">닫기</button></div></div>`);
    this.sheetBody.querySelector<HTMLButtonElement>("button[data-chal-retry]")?.addEventListener("click", () => { this.closeSheet(); void this.startChallenge(scen.id); });
  }

  private abandonChallenge(): void {
    if (!this.challenge) return;
    if (!confirm(`도전 「${this.challenge.scen.title}」을(를) 포기할까요? 기록에는 남지 않습니다.`)) return;
    this.challenge = null;
    if (this.current === "match") this.screen.leave();
    this.renderAll();
    this.show("home");
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
