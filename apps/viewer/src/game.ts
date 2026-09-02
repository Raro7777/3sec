import { FORMATIONS, ROLES, TACTIC_PRESETS, autoRoles, normalizeTactics, rolesForSlot, type FormationName, type Match, type PlayerRoleId, type Tactics, type TeamId } from "@3sec/engine";

type SliderKey = "mentality" | "defensiveLine" | "pressing" | "directness" | "width" | "tempo" | "counter" | "engageLine";
import {
  CLUBS, SAVE_KEY, advanceRound, autoSelect, clubOf, createMatch, currentFixtures, deserialize, isAvailable, newGame, nextUserFixture,
  overall, playerOf, prepareRound, recordResult, roundsPerSeason, seasonOver, selectionProblem, serialize, slotFit, startNextSeason,
  swap, table, topScorers, type Club, type Fixture, type GameState, type SquadPlayer,
  MAX_SQUAD, MIN_SQUAD, bestOffer, buyPlayer, playerValue, sellPlayer, transferTargets, windowOpen,
  FOCUS_LABEL, INTENSITY_LABEL, expiringContracts, renewContract, renewalTerms, wageBill, type TrainingFocus, type TrainingIntensity,
  COACHING, LEAVE_AGE, MAX_PROSPECTS, MIN_PROMOTE_AGE, SCOUTING, promoteProspect, prospectOverall, releaseProspect, youthWeeklyCost, type ScoutingTier,
} from "@3sec/game";
import { MatchScreen } from "./match-screen";

type ScreenName = "home" | "squad" | "table" | "transfers" | "youth" | "results" | "match" | "guide" | "onboarding";

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
  private live: { fixture: Fixture; match: Match }[] | null = null;
  private selA: string | null = null;
  private current: ScreenName = "home";
  private pickedClub: number | null = null;

  private readonly el = {
    home: document.getElementById("home")!,
    squad: document.getElementById("squad")!,
    table: document.getElementById("tableView")!,
    transfers: document.getElementById("transfers")!,
    youth: document.getElementById("youth")!,
    guide: document.getElementById("guide")!,
    onboarding: document.getElementById("onboarding")!,
    results: document.getElementById("results")!,
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
      <div class="onb-title">3sec 풋볼 매니저에 오신 것을 환영합니다</div>
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
    this.el.guide.innerHTML = `<div class="card guide"><h3>게임 가이드</h3>
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
    this.el.season.textContent = `${s.managerName} 감독 · 시즌 ${s.season} · ${Math.min(s.round + 1, roundsPerSeason(s.clubs.length))}/${roundsPerSeason(s.clubs.length)}R`;
    this.el.tabMatch.disabled = !this.live;
    this.renderHome();
    this.renderSquad();
    this.renderTable();
    this.renderTransfers();
    this.renderYouth();
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
    if (me.budget < 0) h.push(`<div class="hint" style="color:var(--bad)">예산이 적자입니다. 연봉이 매주 빠져나가니 선수를 팔거나 다음 시즌 상금을 기다려야 합니다.</div>`);
    if (this.live) {
      h.push(`<div class="hint">경기가 진행 중입니다.</div><div class="actions"><button class="primary" data-act="toMatch">경기로 돌아가기</button></div>`);
    } else if (over) {
      const champ = clubOf(s, rows[0]!.club);
      h.push(`<div class="hint">시즌 ${s.season} 최종 순위 ${pos}위. 우승: <b style="color:var(--accent)">${champ.name}</b></div>`);
      h.push(`<div class="actions"><button class="primary" data-act="nextSeason">다음 시즌 시작 →</button></div>`);
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
      const prob = selectionProblem(me);
      if (prob) h.push(`<div class="hint" style="color:var(--warn)">선발 문제: ${prob} — 스쿼드에서 조정하거나 자동으로 보정됩니다.</div>`);
      h.push(`<div class="actions"><button data-act="squad">스쿼드 점검</button><button class="primary" data-act="play">경기 시작 ▶</button><span style="display:inline-flex;gap:4px;align-items:center"><button data-act="sim1" title="이번 라운드의 모든 경기를 즉시 시뮬레이션합니다">⏩ 1라운드</button><button data-act="sim3" title="3라운드를 연속 시뮬레이션합니다 (내 경기 포함)">⏩ 3라운드</button><button data-act="sim5" title="5라운드를 연속 시뮬레이션합니다 (내 경기 포함)">⏩ 5라운드</button></span></div>
      <div class="hint">자동 진행은 내 경기도 AI가 지휘합니다. 여러 라운드를 돌리면 매 라운드 사이에 회복·훈련·연봉이 정산되고 마지막 라운드 결과가 표시됩니다.</div>`);
    }
    h.push(`</div>`);
    h.push(`<div class="grid2">`);
    h.push(`<div class="card"><h3>소식</h3><div class="news">${s.news.slice(0, 10).map((n) => `<div>${n}</div>`).join("") || "<div>아직 소식이 없습니다.</div>"}</div></div>`);
    h.push(`<div class="card"><h3>순위 <span>상위 6</span></h3>${this.tableHtml(rows.slice(0, 6), true)}</div>`);
    h.push(`</div>`);
    h.push(`<div class="actions"><button class="danger" data-act="newGame">새 게임</button><span class="hint">진행 상황은 이 브라우저에 자동 저장됩니다.</span></div>`);
    this.el.home.innerHTML = h.join("");
    this.el.home.querySelectorAll<HTMLButtonElement>("button[data-act]").forEach((b) => b.addEventListener("click", () => this.act(b.dataset.act!)));
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
      case "nextSeason": startNextSeason(this.state); this.save(); this.renderAll(); break;
      case "newGame":
        if (confirm("현재 진행 상황을 지우고 새 게임을 시작할까요?")) {
          if (this.current === "match") this.screen.leave();
          this.live = null;
          this.startOnboarding();
        }
        break;
    }
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
      const status = p.injuryDays > 0 ? `부상 ${p.injuryDays}일` : p.ban > 0 ? `출장정지 ${p.ban}` : p.seasonYellows % 5 === 4 ? "경고 누적 4" : p.contractUntil <= this.state.season ? "계약 만료 예정" : p.age <= 23 && p.potential - ovr >= 1.5 ? `잠재 ${p.potential.toFixed(0)}` : "";
      const roleText = slotRole && slotRole !== p.role ? `${slotRole}<span style="opacity:.5">(${p.role})</span>` : p.role;
      return `<div class="row wide ${this.selA === p.id ? "sel" : ""} ${isAvailable(p) ? "" : "off"}" data-id="${p.id}">
        <span class="num">${p.number}</span><span class="role">${roleText}</span>
        <span class="name" title="${p.name}">${p.name}</span>
        <span class="ovr" style="color:${ovr >= 14 ? "var(--good)" : ovr >= 11 ? "var(--text)" : "var(--warn)"}">${ovr.toFixed(1)}</span>
        <span class="age">${p.age}세</span>
        <span class="bar" title="컨디션 ${Math.round(cond * 100)}%"><i style="width:${Math.round(cond * 100)}%;background:${cond > 0.7 ? "var(--good)" : cond > 0.45 ? "var(--warn)" : "var(--bad)"}"></i></span>
        <span class="st">${status}</span>${roleSel}</div>`;
    };
    const header = `<div class="row wide" style="cursor:default;color:var(--muted);font-size:11px"><span>#</span><span>포지션</span><span>이름</span><span style="text-align:right">능력</span><span style="text-align:right">나이</span><span>컨디션</span><span style="text-align:right">상태</span></div>`;
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
      <div class="hint">어린 선수는 잠재력까지 성장하고 30대는 서서히 쇠퇴합니다. 초점을 둔 능력치가 먼저 오르고, 강도를 높이면 성장은 빠르지만 회복이 느리고 부상이 잦아집니다.</div></div>`);
    h.push(`<div class="card"><h3>기본 전술 <span>경기 중에도 변경 가능</span></h3>
      <div class="actions">${Object.keys(TACTIC_PRESETS).map((n) => `<button data-preset="${n}" ${locked ? "disabled" : ""}>${n}</button>`).join("")}<button data-autoroles ${locked ? "disabled" : ""}>역할 자동</button></div>
      <label style="margin:4px 0"><input type="checkbox" id="sqTrap" ${me.tactics.offsideTrap ? "checked" : ""} ${locked ? "disabled" : ""}> 오프사이드 트랩 (라인을 평평하게 유지해 침투를 잡되, 뚫리면 위험)</label>
      <div id="sqSliders"></div>
      <div class="hint">역할은 선발 명단의 각 줄에서 고릅니다. 예: 윙어 ↔ 인사이드 포워드(중앙으로 파고들어 슛), 풀백 ↔ 윙백(오버랩), 앵커 ↔ 딥라잉 플레이메이커, 어드밴스드 포워드 ↔ 타겟맨·포처·폴스 나인.</div></div>`);
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

  private afterSquadChange(): void {
    this.save();
    this.renderSquad();
    this.renderHome();
  }

  // ------------------------------------------------------------ table
  private tableHtml(rows: ReturnType<typeof table>, compact = false): string {
    const s = this.state;
    const posOf = new Map(table(s).map((r, i) => [r.club, i + 1]));
    return `<table class="std"><thead><tr><th>#</th><th class="l">클럽</th><th>경기</th>${compact ? "" : "<th>승</th><th>무</th><th>패</th><th>득</th><th>실</th>"}<th>득실</th><th>승점</th></tr></thead><tbody>${rows
      .map((r) => {
        const c = clubOf(s, r.club);
        const pos = posOf.get(r.club)!;
        return `<tr class="${r.club === s.userClub ? "me" : ""}"><td>${pos}</td><td class="l"><span class="dot" style="background:${c.color}"></span>${c.name}</td><td>${r.played}</td>${compact ? "" : `<td>${r.won}</td><td>${r.drawn}</td><td>${r.lost}</td><td>${r.gf}</td><td>${r.ga}</td>`}<td>${r.gf - r.ga > 0 ? "+" : ""}${r.gf - r.ga}</td><td><b>${r.pts}</b></td></tr>`;
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

  private renderTable(): void {
    const s = this.state;
    const scorers = topScorers(s, 10);
    this.el.table.innerHTML = `<div class="card"><h3>리그 순위 <span>시즌 ${s.season}</span></h3>${this.tableHtml(table(s))}</div>
      <div class="card"><h3>내 일정 <span>${clubOf(s, s.userClub).name}</span></h3>${this.scheduleHtml()}</div>
      <div class="card"><h3>득점 순위</h3>${scorers.length ? `<table class="std"><thead><tr><th>#</th><th class="l">선수</th><th class="l">클럽</th><th>출장</th><th>골</th></tr></thead><tbody>${scorers
        .map((x, i) => `<tr class="${x.club.id === s.userClub ? "me" : ""}"><td>${i + 1}</td><td class="l">${x.player.name}</td><td class="l">${x.club.shortName}</td><td>${x.player.stats.apps}</td><td><b>${x.player.stats.goals}</b></td></tr>`)
        .join("")}</tbody></table>` : `<div class="hint">아직 득점이 없습니다.</div>`}</div>`;
  }

  // ------------------------------------------------------------ transfers
  private transferRole = "전체";
  private renderTransfers(): void {
    const s = this.state;
    const me = this.me;
    const open = windowOpen(s);
    const locked = !!this.live;
    const roles = ["전체", "GK", "CB", "LB", "RB", "DM", "CM", "AM", "LW", "RW", "ST"];
    const targets = transferTargets(s).filter((t) => this.transferRole === "전체" || t.player.role === this.transferRole).slice(0, 60);
    const fmtRow = (p: SquadPlayer, clubName: string, right: string) => `<div class="row tr" style="cursor:default">
        <span class="num">${p.number}</span><span class="role">${p.role}</span>
        <span class="name" title="${p.name}">${p.name} <span style="opacity:.55;font-size:11px">${clubName}</span></span>
        <span class="ovr">${overall(p.attrs, p.role).toFixed(1)}</span><span class="age">${p.age}세</span>
        <span class="val" style="font-family:'IBM Plex Mono',monospace;font-size:12px;text-align:right">${playerValue(p)}억</span>
        <span style="text-align:right">${right}</span></div>`;
    const h: string[] = [];
    h.push(`<div class="card"><h3>이적 시장 <span>예산 ${me.budget}억 · 스쿼드 ${me.squad.length}/${MAX_SQUAD}</span></h3>
      <div class="hint">${open ? '<b style="color:var(--good)">열림</b> — 프리시즌(1R 전), 겨울(11~12R 전), 시즌 종료 후에 거래할 수 있습니다.' : '<b style="color:var(--warn)">닫힘</b> — 다음 창구: ' + (s.round < 10 ? "11라운드 전" : "시즌 종료 후")}
      ${locked ? " · 경기 중에는 거래할 수 없습니다." : ""}</div>
      <div class="squad-tools"><label>포지션 <select id="trRole">${roles.map((r) => `<option ${r === this.transferRole ? "selected" : ""}>${r}</option>`).join("")}</select></label>
      <span class="hint">호가는 상대 구단이 부르는 값입니다(핵심 선수일수록 비쌈). 스쿼드가 16명 이하인 구단은 팔지 않습니다.</span></div></div>`);
    h.push(`<div class="grid2">`);
    h.push(`<div class="card"><h3>영입 대상 <span>능력순 상위 ${targets.length}</span></h3><div class="roster">${targets
      .map((t) => fmtRow(t.player, t.club.shortName, t.price === null ? '<span class="hint">비매</span>' : `<button data-buy="${t.club.id}:${t.player.id}" ${open && !locked && me.budget >= t.price && me.squad.length < MAX_SQUAD ? "" : "disabled"} style="padding:3px 8px;font-size:12px">${t.price}억 영입</button>`))
      .join("")}</div></div>`);
    h.push(`<div class="card"><h3>내 선수 판매 <span>최소 ${MIN_SQUAD}명 유지</span></h3><div class="roster">${[...me.squad]
      .sort((a, b) => overall(b.attrs, b.role) - overall(a.attrs, a.role))
      .map((p) => {
        const offer = open ? bestOffer(s, p.id) : null;
        return fmtRow(p, "", offer ? `<button data-sell="${p.id}" ${!locked && me.squad.length > MIN_SQUAD ? "" : "disabled"} style="padding:3px 8px;font-size:12px">${offer.fee}억 → ${offer.club.shortName}</button>` : '<span class="hint">제안 없음</span>');
      })
      .join("")}</div></div>`);
    h.push(`</div>`);
    const contracts = [...me.squad].sort((a, b) => a.contractUntil - b.contractUntil || b.wage - a.wage);
    h.push(`<div class="card"><h3>계약 <span>연봉 총액 ${wageBill(me)}억/시즌</span></h3>
      <div class="hint">계약은 시즌 단위입니다. 만료 시즌(이번 시즌이면 <b style="color:var(--warn)">만료 예정</b>)인 선수는 시즌이 끝나면 떠나므로 미리 재계약하세요. 계약금은 선수 가치의 5%×연수입니다.</div>
      <div class="roster">${contracts
        .map((p) => {
          const exp = p.contractUntil <= s.season;
          const t1 = renewalTerms(p, 1), t3 = renewalTerms(p, 3);
          return `<div class="row tr" style="cursor:default"><span class="num">${p.number}</span><span class="role">${p.role}</span>
            <span class="name">${p.name} <span style="opacity:.55;font-size:11px">연봉 ${p.wage}억</span></span>
            <span class="ovr">${overall(p.attrs, p.role).toFixed(1)}</span><span class="age">${p.age}세</span>
            <span style="font-family:'IBM Plex Mono',monospace;font-size:12px;text-align:right;color:${exp ? "var(--warn)" : "var(--muted)"}">~S${p.contractUntil}</span>
            <span style="text-align:right;display:flex;gap:4px;justify-content:flex-end">${[1, 3].map((y) => `<button data-renew="${p.id}:${y}" ${locked || me.budget < (y === 1 ? t1.fee : t3.fee) ? "disabled" : ""} title="계약금 ${y === 1 ? t1.fee : t3.fee}억 · 연봉 ${y === 1 ? t1.wage : t3.wage}억" style="padding:3px 6px;font-size:11px">+${y}년 ${y === 1 ? t1.fee : t3.fee}억</button>`).join("")}</span></div>`;
        })
        .join("")}</div></div>`);
    this.el.transfers.innerHTML = h.join("");
    this.el.transfers.querySelectorAll<HTMLButtonElement>("button[data-renew]").forEach((b) =>
      b.addEventListener("click", () => {
        const [id, y] = b.dataset.renew!.split(":");
        const p = playerOf(me, id!);
        const t = renewalTerms(p, Number(y));
        if (!confirm(`${p.name}과(와) ${y}년 재계약할까요? 계약금 ${t.fee}억, 연봉 ${t.wage}억/시즌`)) return;
        const err = renewContract(s, id!, Number(y) as 1 | 2 | 3);
        if (err) alert(err);
        this.save();
        this.renderAll();
      }),
    );
    (document.getElementById("trRole") as HTMLSelectElement).addEventListener("change", (e) => {
      this.transferRole = (e.target as HTMLSelectElement).value;
      this.renderTransfers();
    });
    this.el.transfers.querySelectorAll<HTMLButtonElement>("button[data-buy]").forEach((b) =>
      b.addEventListener("click", () => {
        const [club, id] = b.dataset.buy!.split(":");
        const t = transferTargets(s).find((x) => x.player.id === id)!;
        if (!confirm(`${t.player.name} (${t.club.shortName})을(를) ${t.price}억에 영입할까요?`)) return;
        const err = buyPlayer(s, Number(club), id!);
        if (err) alert(err);
        this.save();
        this.renderAll();
      }),
    );
    this.el.transfers.querySelectorAll<HTMLButtonElement>("button[data-sell]").forEach((b) =>
      b.addEventListener("click", () => {
        const id = b.dataset.sell!;
        const p = playerOf(me, id);
        const offer = bestOffer(s, id);
        if (!offer || !confirm(`${p.name}을(를) ${offer.club.name}에 ${offer.fee}억에 판매할까요?`)) return;
        const err = sellPlayer(s, id);
        if (err) alert(err);
        this.save();
        this.renderAll();
      }),
    );
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
  private renderResults(round: number): void {
    const s = this.state;
    const fx = s.fixtures.filter((f) => f.round === round);
    const me = s.userClub;
    this.el.results.innerHTML = `<div class="card"><h3>라운드 ${round + 1} 결과</h3>${fx
      .map((f) => {
        const h = clubOf(s, f.home), a = clubOf(s, f.away);
        const mine = f.home === me || f.away === me;
        return `<div class="result ${mine ? "me" : ""}"><span class="r">${h.name}</span><span class="sc">${f.score ? `${f.score[0]} - ${f.score[1]}` : "—"}</span><span>${a.name}</span>${f.scorers.length ? `<div class="scorers">${f.scorers.join(" · ")}</div>` : ""}</div>`;
      })
      .join("")}<div class="actions" style="margin-top:8px"><button class="primary" id="btnNextRound">다음 라운드로 →</button></div></div>
      <div class="card"><h3>순위</h3>${this.tableHtml(table(s))}</div>`;
    document.getElementById("btnNextRound")!.addEventListener("click", () => {
      advanceRound(this.state);
      prepareRound(this.state);
      this.save();
      this.renderAll();
      this.show("home");
    });
  }

  // ------------------------------------------------------------ matchday
  private startMatch(): void {
    const s = this.state;
    prepareRound(s);
    const mine = nextUserFixture(s);
    if (!mine) return;
    this.live = currentFixtures(s).map((fixture) => ({ fixture, match: createMatch(s, fixture) }));
    const user = this.live.find((x) => x.fixture === mine)!;
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
      const live = currentFixtures(s).filter((f) => !f.score).map((fixture) => ({ fixture, match: createMatch(s, fixture) }));
      const label = n > 1 ? `라운드 ${s.round + 1} 시뮬레이션 중… (${k + 1}/${n})` : "라운드 시뮬레이션 중…";
      await this.runChunked(() => {
        for (let i = 0; i < 20 * 30; i++) for (const x of live) if (x.match.state.phase !== "FULL_TIME") x.match.step();
        return live.every((x) => x.match.state.phase === "FULL_TIME");
      }, label);
      this.live = live;
      const last = k === n - 1 || seasonOver(s) || s.round + 1 >= roundsPerSeason(s.clubs.length);
      if (last) {
        this.finishRound();
        return;
      }
      this.settleLive();
      advanceRound(s);
      prepareRound(s);
      this.save();
    }
    this.renderAll();
    this.show("home");
  }

  /** Record every live match into the season state (shared by finishRound and multi-round sims). */
  private settleLive(): void {
    const s = this.state;
    if (!this.live) return;
    for (const { fixture, match } of this.live) {
      if (fixture.score) continue;
      recordResult(s, fixture, match);
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
    this.settleLive();
    this.screen.leave();
    this.save();
    this.renderAll();
    this.renderResults(round);
    this.show("results");
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
