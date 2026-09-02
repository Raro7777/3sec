import { FORMATIONS, type FormationName, type Match, type Tactics, type TeamId } from "@3sec/engine";
import {
  SAVE_KEY, advanceRound, autoSelect, clubOf, createMatch, currentFixtures, deserialize, isAvailable, newGame, nextUserFixture,
  overall, playerOf, prepareRound, recordResult, roundsPerSeason, seasonOver, selectionProblem, serialize, slotFit, startNextSeason,
  swap, table, topScorers, type Club, type Fixture, type GameState, type SquadPlayer,
} from "@3sec/game";
import { MatchScreen } from "./match-screen";

type ScreenName = "home" | "squad" | "table" | "results" | "match";

const SLIDERS: { key: keyof Omit<Tactics, "formation">; label: string; lo: string; hi: string }[] = [
  { key: "mentality", label: "멘탈리티", lo: "수비", hi: "공격" },
  { key: "defensiveLine", label: "수비라인", lo: "낮게", hi: "높게" },
  { key: "pressing", label: "프레싱", lo: "약하게", hi: "강하게" },
  { key: "directness", label: "직접성", lo: "짧게", hi: "롱볼" },
  { key: "width", label: "폭", lo: "좁게", hi: "넓게" },
];

/** Season controller: owns the game state, the screens and the matchday flow. */
export class Game {
  state: GameState;
  private readonly screen: MatchScreen;
  private live: { fixture: Fixture; match: Match }[] | null = null;
  private selA: string | null = null;
  private current: ScreenName = "home";

  private readonly el = {
    home: document.getElementById("home")!,
    squad: document.getElementById("squad")!,
    table: document.getElementById("tableView")!,
    results: document.getElementById("results")!,
    season: document.getElementById("seasonLabel")!,
    tabMatch: document.getElementById("tabMatch") as HTMLButtonElement,
    overlay: document.getElementById("overlay")!,
    overlayText: document.getElementById("overlayText")!,
    overlayBar: document.getElementById("overlayBar")!,
  };

  constructor() {
    this.state = this.load() ?? newGame(Math.floor(Math.random() * 1e6) + 1);
    prepareRound(this.state);
    this.screen = new MatchScreen((work, label) => this.runChunked(work, label));
    for (const b of document.querySelectorAll<HTMLButtonElement>("#nav button.tab")) {
      b.addEventListener("click", () => this.show(b.dataset.screen as ScreenName));
    }
    this.renderAll();
    this.show("home");
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
    this.current = name;
    for (const s of document.querySelectorAll<HTMLElement>(".screen")) s.classList.toggle("active", s.id === `screen-${name}`);
    for (const b of document.querySelectorAll<HTMLButtonElement>("#nav button.tab")) b.classList.toggle("active", b.dataset.screen === name);
    if (name === "match") window.dispatchEvent(new Event("resize"));
  }

  private renderAll(): void {
    const s = this.state;
    this.el.season.textContent = `시즌 ${s.season} · ${Math.min(s.round + 1, roundsPerSeason(s.clubs.length))}/${roundsPerSeason(s.clubs.length)}R`;
    this.el.tabMatch.disabled = !this.live;
    this.renderHome();
    this.renderSquad();
    this.renderTable();
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
    h.push(`<div class="card"><h3>${me.name} <span>${over ? "시즌 종료" : `${pos}위 · ${rows[pos - 1]!.pts}점`}</span></h3>`);
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
      h.push(`<div class="actions"><button data-act="squad">스쿼드 점검</button><button class="primary" data-act="play">경기 시작 ▶</button><button data-act="sim" title="이번 라운드의 모든 경기를 즉시 시뮬레이션합니다">라운드 자동 진행 ⏩</button></div>`);
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
      case "sim": void this.simRound(); break;
      case "toMatch": this.show("match"); break;
      case "nextSeason": startNextSeason(this.state); this.save(); this.renderAll(); break;
      case "newGame":
        if (confirm("현재 진행 상황을 지우고 새 게임을 시작할까요?")) {
          this.state = newGame(Math.floor(Math.random() * 1e6) + 1);
          prepareRound(this.state);
          this.live = null;
          this.save();
          this.renderAll();
          this.show("home");
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
    const row = (p: SquadPlayer, slotRole: string | null) => {
      const ovr = slotRole ? slotFit(p.attrs, p.role, slotRole as SquadPlayer["role"]) : overall(p.attrs, p.role);
      const cond = p.condition;
      const status = p.injuryDays > 0 ? `부상 ${p.injuryDays}일` : p.ban > 0 ? `출장정지 ${p.ban}` : p.seasonYellows % 5 === 4 ? "경고 누적 4" : "";
      const roleText = slotRole && slotRole !== p.role ? `${slotRole}<span style="opacity:.5">(${p.role})</span>` : p.role;
      return `<div class="row wide ${this.selA === p.id ? "sel" : ""} ${isAvailable(p) ? "" : "off"}" data-id="${p.id}">
        <span class="num">${p.number}</span><span class="role">${roleText}</span>
        <span class="name" title="${p.name}">${p.name}</span>
        <span class="ovr" style="color:${ovr >= 14 ? "var(--good)" : ovr >= 11 ? "var(--text)" : "var(--warn)"}">${ovr.toFixed(1)}</span>
        <span class="age">${p.age}세</span>
        <span class="bar" title="컨디션 ${Math.round(cond * 100)}%"><i style="width:${Math.round(cond * 100)}%;background:${cond > 0.7 ? "var(--good)" : cond > 0.45 ? "var(--warn)" : "var(--bad)"}"></i></span>
        <span class="st">${status}</span></div>`;
    };
    const header = `<div class="row wide" style="cursor:default;color:var(--muted);font-size:11px"><span>#</span><span>포지션</span><span>이름</span><span style="text-align:right">능력</span><span style="text-align:right">나이</span><span>컨디션</span><span style="text-align:right">상태</span></div>`;
    h.push(`<div class="grid2">`);
    h.push(`<div class="card"><h3>선발 XI <span>${sel.formation}</span></h3>${header}<div class="roster">${sel.starters.map((id, i) => row(playerOf(me, id), slots[i]?.role ?? null)).join("")}</div></div>`);
    const reserves = me.squad.filter((p) => !sel.starters.includes(p.id) && !sel.bench.includes(p.id));
    h.push(`<div class="card"><h3>벤치 <span>${sel.bench.length}/7</span></h3>${header}<div class="roster">${sel.bench.map((id) => row(playerOf(me, id), null)).join("")}</div>
      <h3 style="margin-top:8px">예비 <span>${reserves.length}</span></h3><div class="roster">${reserves.map((p) => row(p, null)).join("")}</div></div>`);
    h.push(`</div>`);
    h.push(`<div class="card"><h3>기본 전술 <span>경기 중에도 변경 가능</span></h3><div id="sqSliders"></div></div>`);
    this.el.squad.innerHTML = h.join("");

    (document.getElementById("sqFormation") as HTMLSelectElement).addEventListener("change", (e) => {
      me.selection = autoSelect(me, (e.target as HTMLSelectElement).value as FormationName);
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
    const all = table(s);
    return `<table class="std"><thead><tr><th>#</th><th class="l">클럽</th><th>경기</th>${compact ? "" : "<th>승</th><th>무</th><th>패</th><th>득</th><th>실</th>"}<th>득실</th><th>승점</th></tr></thead><tbody>${rows
      .map((r) => {
        const c = clubOf(s, r.club);
        const pos = all.indexOf(r) + 1;
        return `<tr class="${r.club === s.userClub ? "me" : ""}"><td>${pos}</td><td class="l"><span class="dot" style="background:${c.color}"></span>${c.name}</td><td>${r.played}</td>${compact ? "" : `<td>${r.won}</td><td>${r.drawn}</td><td>${r.lost}</td><td>${r.gf}</td><td>${r.ga}</td>`}<td>${r.gf - r.ga > 0 ? "+" : ""}${r.gf - r.ga}</td><td><b>${r.pts}</b></td></tr>`;
      })
      .join("")}</tbody></table>`;
  }

  private renderTable(): void {
    const s = this.state;
    const scorers = topScorers(s, 10);
    this.el.table.innerHTML = `<div class="card"><h3>리그 순위 <span>시즌 ${s.season}</span></h3>${this.tableHtml(table(s))}</div>
      <div class="card"><h3>득점 순위</h3>${scorers.length ? `<table class="std"><thead><tr><th>#</th><th class="l">선수</th><th class="l">클럽</th><th>출장</th><th>골</th></tr></thead><tbody>${scorers
        .map((x, i) => `<tr class="${x.club.id === s.userClub ? "me" : ""}"><td>${i + 1}</td><td class="l">${x.player.name}</td><td class="l">${x.club.shortName}</td><td>${x.player.stats.apps}</td><td><b>${x.player.stats.goals}</b></td></tr>`)
        .join("")}</tbody></table>` : `<div class="hint">아직 득점이 없습니다.</div>`}</div>`;
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

  private async simRound(): Promise<void> {
    const s = this.state;
    prepareRound(s);
    this.live = currentFixtures(s).map((fixture) => ({ fixture, match: createMatch(s, fixture) }));
    const live = this.live;
    await this.runChunked(() => {
      for (let i = 0; i < 20 * 30; i++) for (const x of live) if (x.match.state.phase !== "FULL_TIME") x.match.step();
      return live.every((x) => x.match.state.phase === "FULL_TIME");
    }, "라운드 시뮬레이션 중…");
    this.finishRound();
  }

  private finishRound(): void {
    const s = this.state;
    if (!this.live) return;
    const round = s.round;
    for (const { fixture, match } of this.live) {
      if (fixture.score) continue;
      recordResult(s, fixture, match);
      // Tactics changed from the touchline carry over to the next match.
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
