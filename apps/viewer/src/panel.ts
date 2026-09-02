import { FORMATIONS, MAX_SUBS, ROLES, TACTIC_PRESETS, rolesForSlot, type FormationName, type Match, type PlayerRoleId, type PlayerState, type Tactics, type TeamId } from "@3sec/engine";

type SliderKey = "mentality" | "defensiveLine" | "pressing" | "directness" | "width" | "tempo" | "counter" | "engageLine";

/**
 * Manager panel for the user's team: live tactics, lineup/bench with fatigue, substitutions.
 */
export class ManagerPanel {
  private match!: Match;
  private team: TeamId;
  private selOut: string | null = null;
  private selIn: string | null = null;
  private lastRoster = 0;

  private el = {
    teamName: document.getElementById("teamName")!,
    formation: document.getElementById("formation") as HTMLSelectElement,
    sliders: document.getElementById("sliders")!,
    lineup: document.getElementById("lineup")!,
    bench: document.getElementById("bench")!,
    subsUsed: document.getElementById("subsUsed")!,
    subPlan: document.getElementById("subPlan")!,
    btnSub: document.getElementById("btnSub") as HTMLButtonElement,
    subMsg: document.getElementById("subMsg")!,
    pending: document.getElementById("pending")!,
  };

  private readonly sliderDefs: { key: SliderKey; label: string; lo: string; hi: string }[] = [
    { key: "mentality", label: "멘탈리티", lo: "수비", hi: "공격" },
    { key: "defensiveLine", label: "수비라인", lo: "낮게", hi: "높게" },
    { key: "pressing", label: "프레싱", lo: "약하게", hi: "강하게" },
    { key: "directness", label: "직접성", lo: "짧게", hi: "롱볼" },
    { key: "width", label: "폭", lo: "좁게", hi: "넓게" },
    { key: "tempo", label: "템포", lo: "느리게", hi: "빠르게" },
    { key: "counter", label: "역습", lo: "자제", hi: "적극" },
    { key: "engageLine", label: "압박선", lo: "낮게", hi: "높게" },
  ];

  constructor(team: TeamId, public onSelectPlayer: (id: string | null) => void) {
    this.team = team;
    this.buildSliders();
    this.el.formation.addEventListener("change", () => {
      this.match.setTactics(this.team, { formation: this.el.formation.value as FormationName });
      this.renderRoster(true);
    });
    this.el.btnSub.addEventListener("click", () => this.queueSub());
  }

  attach(match: Match, team: TeamId = this.team): void {
    this.match = match;
    this.team = team;
    this.selOut = null;
    this.selIn = null;
    this.el.teamName.textContent = match.teams[this.team].name;
    this.el.formation.value = match.teams[this.team].tactics.formation;
    this.syncSliders();
    this.el.subMsg.textContent = "";
    this.renderRoster(true);
  }

  /** Called from the canvas click handler so a tap on the pitch also selects the outgoing player. */
  selectFromPitch(id: string | null): void {
    if (id && this.match.teamOf.get(id) === this.team && this.match.player(id).onPitch) {
      this.selOut = id;
      this.renderRoster(true);
    }
  }

  private buildSliders(): void {
    this.el.sliders.innerHTML = "";
    // presets
    const pre = document.createElement("div");
    pre.className = "actions";
    pre.style.margin = "4px 0 2px";
    for (const name of Object.keys(TACTIC_PRESETS)) {
      const b = document.createElement("button");
      b.textContent = name;
      b.style.cssText = "padding:3px 8px;font-size:12px";
      b.addEventListener("click", () => {
        this.match.setTactics(this.team, TACTIC_PRESETS[name]!);
        this.syncSliders();
      });
      pre.appendChild(b);
    }
    this.el.sliders.appendChild(pre);
    // offside trap
    const trap = document.createElement("label");
    trap.style.cssText = "margin:4px 0";
    trap.innerHTML = `<input type="checkbox" data-key="offsideTrap"> 오프사이드 트랩`;
    trap.querySelector("input")!.addEventListener("change", (e) => this.match.setTactics(this.team, { offsideTrap: (e.target as HTMLInputElement).checked }));
    this.el.sliders.appendChild(trap);
    for (const def of this.sliderDefs) {
      const row = document.createElement("div");
      row.className = "tactic";
      row.innerHTML = `<span class="lbl">${def.label}</span><input type="range" min="0" max="100" step="5" data-key="${def.key}" aria-label="${def.label}" title="${def.lo} ↔ ${def.hi}"><span class="val"></span>`;
      const input = row.querySelector("input")!;
      const val = row.querySelector(".val")!;
      input.addEventListener("input", () => {
        const v = Number(input.value) / 100;
        this.match.setTactics(this.team, { [def.key]: v } as Partial<Tactics>);
        val.textContent = this.describe(def, v);
      });
      this.el.sliders.appendChild(row);
    }
  }

  private describe(def: { lo: string; hi: string }, v: number): string {
    return v < 0.35 ? def.lo : v > 0.65 ? def.hi : "보통";
  }

  private syncSliders(): void {
    const t = this.match.teams[this.team].tactics;
    const trap = this.el.sliders.querySelector<HTMLInputElement>('input[data-key="offsideTrap"]');
    if (trap) trap.checked = !!t.offsideTrap;
    for (const input of this.el.sliders.querySelectorAll<HTMLInputElement>("input[type=range]")) {
      const key = input.dataset.key as SliderKey;
      input.value = String(Math.round(t[key] * 100));
      const def = this.sliderDefs.find((d) => d.key === key)!;
      input.parentElement!.querySelector(".val")!.textContent = this.describe(def, t[key]);
    }
  }

  /** Cheap per-frame update: fatigue bars and counters. Full rebuild when the roster changed. */
  update(force = false): void {
    const s = this.match.state;
    const rosterKey = s.lineups[this.team].join(",") + "|" + s.subsUsed[this.team] + "|" + s.pendingSubs.length;
    if (force || rosterKey !== this.rosterKey) {
      this.rosterKey = rosterKey;
      this.renderRoster(true);
      return;
    }
    const now = performance.now();
    if (now - this.lastRoster < 500) return;
    this.lastRoster = now;
    for (const row of this.el.lineup.querySelectorAll<HTMLElement>(".row[data-id]")) {
      const p = this.match.player(row.dataset.id!);
      this.paintBar(row.querySelector<HTMLElement>(".bar i")!, p);
    }
  }
  private rosterKey = "";

  private paintBar(bar: HTMLElement, p: PlayerState): void {
    const cond = 1 - p.fatigue;
    bar.style.width = `${Math.round(cond * 100)}%`;
    bar.style.background = cond > 0.55 ? "var(--good)" : cond > 0.3 ? "var(--warn)" : "var(--bad)";
    bar.parentElement!.title = `컨디션 ${Math.round(cond * 100)}% · ${(p.distance / 1000).toFixed(1)} km`;
  }

  private row(p: PlayerState, kind: "lineup" | "bench"): HTMLElement {
    const m = this.match;
    const def = m.def(p.id);
    const div = document.createElement("div");
    div.className = "row";
    div.dataset.id = p.id;
    const selected = kind === "lineup" ? this.selOut === p.id : this.selIn === p.id;
    if (selected) div.classList.add("sel");
    const used = kind === "bench" && !m.benchAvailable(this.team).some((b) => b.id === p.id);
    if (p.sentOff || used) div.classList.add("off");
    const slotRole = kind === "lineup" ? m.slotIndex(p.id) >= 0 ? this.slotRole(m.slotIndex(p.id)) : def.role : def.role;
    const roleText = slotRole !== def.role ? `${slotRole}<span style="opacity:.5">(${def.role})</span>` : slotRole;
    const cards = p.sentOff ? `<span class="card red"></span>` : p.yellow ? `<span class="card"></span>` : "";
    const hurt = p.injured ? `<span style="color:var(--bad);font-size:11px;margin-left:4px">부상</span>` : "";
    const slot = kind === "lineup" ? m.slotIndex(p.id) : -1;
    const rid = slot >= 0 ? m.roleOf(p.id).id : null;
    const roleSel = slot >= 0 ? `<select class="rolesel" data-slot="${slot}" style="grid-column:2 / 4;padding:1px 4px;font-size:11px">${rolesForSlot(this.slotRole(slot) as PlayerRoleId extends never ? never : Parameters<typeof rolesForSlot>[0]).map((r) => `<option value="${r}" ${r === rid ? "selected" : ""}>${ROLES[r].name}</option>`).join("")}</select>` : "";
    div.innerHTML = `<span class="num">${def.number}</span><span class="role">${roleText}</span><span class="name" title="${def.name}">${def.name}${cards}${hurt}</span><span class="bar"><i></i></span>${roleSel}`;
    const sel = div.querySelector<HTMLSelectElement>("select.rolesel");
    if (sel) {
      sel.addEventListener("click", (e) => e.stopPropagation());
      sel.addEventListener("change", (e) => {
        e.stopPropagation();
        const roles = [...(m.teams[this.team].tactics.roles ?? [])] as PlayerRoleId[];
        roles[slot] = sel.value as PlayerRoleId;
        m.setTactics(this.team, { roles });
      });
    }
    this.paintBar(div.querySelector<HTMLElement>(".bar i")!, p);
    if (!p.sentOff && !used) {
      div.addEventListener("click", () => {
        if (kind === "lineup") {
          this.selOut = this.selOut === p.id ? null : p.id;
          this.onSelectPlayer(this.selOut);
        } else {
          this.selIn = this.selIn === p.id ? null : p.id;
        }
        this.el.subMsg.textContent = "";
        this.renderRoster(true);
      });
    }
    return div;
  }

  private slotRole(idx: number): string {
    return FORMATIONS[this.match.teams[this.team].tactics.formation][idx]?.role ?? "";
  }

  private renderRoster(_full: boolean): void {
    const m = this.match;
    const s = m.state;
    this.el.lineup.innerHTML = "";
    for (const id of s.lineups[this.team]) this.el.lineup.appendChild(this.row(m.player(id), "lineup"));
    this.el.bench.innerHTML = "";
    for (const d of m.teams[this.team].bench) this.el.bench.appendChild(this.row(m.player(d.id), "bench"));
    this.el.subsUsed.textContent = `교체 ${s.subsUsed[this.team]}/${MAX_SUBS}`;

    const out = this.selOut ? m.def(this.selOut) : null;
    const inn = this.selIn ? m.def(this.selIn) : null;
    this.el.subPlan.innerHTML = out || inn
      ? `<b style="color:var(--bad)">OUT</b> ${out ? `#${out.number} ${out.name}` : "—"} &nbsp;→&nbsp; <b style="color:var(--good)">IN</b> ${inn ? `#${inn.number} ${inn.name}` : "—"}`
      : "나갈 선수(선발)와 들어올 선수(벤치)를 차례로 선택하세요.";
    this.el.btnSub.disabled = !(out && inn);

    this.el.pending.innerHTML = "";
    for (const q of s.pendingSubs.filter((q) => q.team === this.team)) {
      const div = document.createElement("div");
      div.className = "pend";
      div.innerHTML = `<span>⏳ ${m.def(q.outId).name} → ${m.def(q.inId).name} (다음 중단 시)</span>`;
      const cancel = document.createElement("button");
      cancel.textContent = "취소";
      cancel.addEventListener("click", () => {
        m.cancelSubstitution(this.team, q.outId);
        this.renderRoster(true);
      });
      div.appendChild(cancel);
      this.el.pending.appendChild(div);
    }
  }

  private queueSub(): void {
    if (!this.selOut || !this.selIn) return;
    const err = this.match.requestSubstitution(this.team, this.selOut, this.selIn);
    if (err) {
      this.el.subMsg.textContent = `교체 불가: ${translate(err)}`;
      return;
    }
    const applied = this.match.state.phase !== "PLAY";
    this.el.subMsg.style.color = applied ? "var(--good)" : "var(--warn)";
    this.el.subMsg.textContent = applied ? "교체 완료" : "예약됨 — 다음 경기 중단 때 투입됩니다";
    this.selOut = null;
    this.selIn = null;
    this.onSelectPlayer(null);
    this.renderRoster(true);
  }
}

function translate(err: string): string {
  if (err.includes("limit")) return `교체 한도(${MAX_SUBS}명)를 모두 사용했습니다`;
  if (err.includes("already")) return "이미 예약된 선수입니다";
  if (err.includes("not available")) return "이미 교체된 선수입니다";
  if (err.includes("not on the pitch")) return "그라운드에 없는 선수입니다";
  if (err.includes("over")) return "경기가 끝났습니다";
  return err;
}
