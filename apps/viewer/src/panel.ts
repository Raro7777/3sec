import { FORMATIONS, MAX_SUBS, ROLES, TACTIC_PRESETS, roleDistance, rolesForSlot, type Attributes, type CornerTarget, type FormationName, type Match, type PlayerRoleId, type PlayerState, type Role, type Tactics, type TeamId } from "@3sec/engine";
import { overall, slotFit } from "@3sec/game";
import { liveFormationSvg, type LiveNode } from "./formation-svg";
import { kitTextColor } from "./kits";

type SliderKey = "mentality" | "defensiveLine" | "pressing" | "directness" | "width" | "tempo" | "counter" | "engageLine";

/** The three attributes that decide a substitution for each slot role (label, key). */
const KEY_ATTRS: Record<Role, [string, keyof Attributes][]> = {
  GK: [["반사", "reflexes"], ["핸들링", "handling"], ["위치", "gkPositioning"]],
  CB: [["태클", "tackling"], ["마킹", "marking"], ["위치", "positioning"]],
  LB: [["태클", "tackling"], ["스피드", "pace"], ["체력", "stamina"]],
  RB: [["태클", "tackling"], ["스피드", "pace"], ["체력", "stamina"]],
  DM: [["태클", "tackling"], ["위치", "positioning"], ["패스", "passing"]],
  CM: [["패스", "passing"], ["시야", "vision"], ["체력", "stamina"]],
  LM: [["패스", "passing"], ["드리블", "dribbling"], ["체력", "stamina"]],
  RM: [["패스", "passing"], ["드리블", "dribbling"], ["체력", "stamina"]],
  AM: [["시야", "vision"], ["패스", "passing"], ["기술", "technique"]],
  LW: [["드리블", "dribbling"], ["스피드", "pace"], ["가속", "acceleration"]],
  RW: [["드리블", "dribbling"], ["스피드", "pace"], ["가속", "acceleration"]],
  ST: [["결정력", "finishing"], ["침착", "composure"], ["스피드", "pace"]],
};

/**
 * Manager panel for the user's team: formation diagram with tap-to-substitute, live tactics,
 * lineup/bench with fatigue, substitutions. The same component serves the portrait layout (stacked
 * under the pitch) and the immersive landscape drawer.
 */
export class ManagerPanel {
  private match!: Match;
  private team: TeamId;
  private selOut: string | null = null;
  private selIn: string | null = null;
  private lastRoster = 0;
  /** player id → age, when the game passes its squads (absent for challenges) */
  private ages: Record<string, number> = {};
  /** goals per player, rebuilt from the event list when it grows */
  private goals = new Map<string, number>();
  private goalsAt = -1;
  /** disc colour of the diagram (the team's kit) */
  private discColor = "#f2c14e";
  private discText = "#1a1400";
  /** attack direction of the diagram; set by the screen when the layout changes */
  orient: "up" | "right" = "up";
  private diagKey = "";

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
    fmDiag: document.getElementById("fmDiag")!,
    subPick: document.getElementById("subPick")!,
    fmHint: document.getElementById("fmHint"),
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
    // diagram: tap a player → candidate list; tap again → deselect
    this.el.fmDiag.addEventListener("click", (e) => {
      const g = (e.target as Element).closest<SVGElement>("[data-pid]");
      if (!g) return;
      const id = g.dataset.pid!;
      const p = this.match.player(id);
      if (p.sentOff) return;
      this.selOut = this.selOut === id ? null : id;
      this.selIn = null;
      this.el.subMsg.textContent = "";
      this.onSelectPlayer(this.selOut);
      this.renderRoster(true);
    });
    // candidate list: tap a bench player → the substitution is queued right away
    this.el.subPick.addEventListener("click", (e) => {
      const t = e.target as HTMLElement;
      if (t.closest("[data-close]")) { this.selOut = null; this.selIn = null; this.onSelectPlayer(null); this.renderRoster(true); return; }
      const c = t.closest<HTMLElement>("[data-in]");
      if (!c || !this.selOut) return;
      this.selIn = c.dataset.in!;
      this.queueSub();
    });
  }

  attach(match: Match, team: TeamId = this.team, ages: Record<string, number> = {}, disc?: { color: string; text?: string }): void {
    this.match = match;
    this.team = team;
    this.ages = ages;
    this.goals.clear();
    this.goalsAt = -1;
    this.discColor = disc?.color ?? match.teams[team].color;
    this.discText = disc?.text ?? kitTextColor(this.discColor);
    this.selOut = null;
    this.selIn = null;
    this.diagKey = "";
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
      this.selIn = null;
      this.renderRoster(true);
    }
  }

  /** The outgoing player currently picked on the diagram (null when nothing is selected). */
  get selectedOut(): string | null { return this.selOut; }

  /** Drop the selection (the screen calls this when the drawer closes). */
  clearSelection(): void {
    if (!this.selOut && !this.selIn) return;
    this.selOut = null;
    this.selIn = null;
    this.renderRoster(true);
  }

  /** Goals of each player of the user's match (any team), from the event list. */
  private goalsOf(id: string): number {
    const ev = this.match.state.events;
    if (ev.length !== this.goalsAt) {
      this.goals.clear();
      for (const e of ev) if (e.type === "GOAL" && e.playerId) this.goals.set(e.playerId, (this.goals.get(e.playerId) ?? 0) + 1);
      this.goalsAt = ev.length;
    }
    return this.goals.get(id) ?? 0;
  }

  /** The on-pitch XI in formation, with condition rings, marks and queued swaps. */
  private renderDiagram(force = false): void {
    const m = this.match, s = m.state;
    const f = m.teams[this.team].tactics.formation;
    const slots = FORMATIONS[f];
    const pend = new Map(s.pendingSubs.filter((q) => q.team === this.team).map((q) => [q.outId, q.inId]));
    const nodes: (LiveNode | null)[] = slots.map((slot, i) => {
      const id = s.lineups[this.team][i];
      if (!id) return null;
      const p = m.player(id);
      const d = m.def(id);
      if (p.sentOff) return { id, number: d.number, name: d.name, role: slot.role, cond: 0, goals: 0, yellow: false, injured: false, empty: true };
      const inn = pend.get(id);
      return {
        id, number: d.number, name: d.name, role: slot.role,
        cond: Math.round((1 - p.fatigue) * 20) / 20,
        goals: this.goalsOf(id), yellow: p.yellow > 0, injured: p.injured,
        pending: inn ? { number: m.def(inn).number, name: m.def(inn).name } : null,
        selected: this.selOut === id,
      };
    });
    const key = JSON.stringify([f, this.orient, nodes]);
    if (!force && key === this.diagKey) return;
    this.diagKey = key;
    this.el.fmDiag.innerHTML = liveFormationSvg({ formation: f, nodes, orient: this.orient, color: this.discColor, textColor: this.discText });
  }

  /** The "교체" picker for the selected outgoing player: bench candidates, same slot role first. */
  private renderSubPick(): void {
    const m = this.match, s = m.state;
    const box = this.el.subPick;
    const out = this.selOut ? m.player(this.selOut) : null;
    if (!out || !out.onPitch || out.sentOff) { box.hidden = true; box.innerHTML = ""; if (this.el.fmHint) this.el.fmHint.hidden = false; return; }
    box.hidden = false;
    if (this.el.fmHint) this.el.fmHint.hidden = true;
    const od = m.def(out.id);
    const slot = m.slotIndex(out.id);
    const slotRole = (slot >= 0 ? this.slotRole(slot) : od.role) as Role;
    const keys = KEY_ATTRS[slotRole];
    const outOvr = overall(od.attrs, slotRole);
    const outCond = Math.round((1 - out.fatigue) * 100);
    const fmt = (n: number) => (Math.round(n * 10) / 10).toFixed(1);
    const attr = (n: number) => Math.round(n);
    const delta = (d: number, digits = 1) => Math.abs(d) < 0.05 ? "" : `<em class="${d > 0 ? "up" : "dn"}">${Math.abs(d).toFixed(digits)}</em>`;
    const queued = s.pendingSubs.filter((q) => q.team === this.team).length;
    const left = MAX_SUBS - s.subsUsed[this.team] - queued;
    const alreadyOut = s.pendingSubs.find((q) => q.team === this.team && q.outId === out.id);
    const age = this.ages[out.id];
    const head = `<div class="spHead"><span><b>OUT</b> 교체 후보 <span style="color:var(--muted)">(남은 교체 ${Math.max(0, left)}명)</span></span><button data-close="1">닫기</button></div>
      <div class="spOut"><span class="num">#${od.number}</span><span><b>${od.name}</b> <small style="color:var(--muted)">${slotRole}${od.role !== slotRole ? `(${od.role})` : ""}${age ? ` · ${age}세` : ""}</small><br><small style="color:var(--muted)">종합 <b style="color:var(--text)">${fmt(outOvr)}</b> · 컨디션 <b style="color:${outCond > 55 ? "var(--good)" : outCond > 30 ? "var(--warn)" : "var(--bad)"}">${outCond}%</b> · ${keys.map(([l, k]) => `${l} ${attr(od.attrs[k])}`).join(" · ")}${out.injured ? ' · <b style="color:var(--bad)">부상</b>' : ""}</small></span></div>`;
    if (alreadyOut) {
      box.innerHTML = head + `<div class="hint">⏳ 이미 ${m.def(alreadyOut.inId).name} 투입이 예약된 선수입니다.</div>`;
      return;
    }
    if (left <= 0) {
      box.innerHTML = head + `<div class="hint" style="color:var(--warn)">교체 한도(${MAX_SUBS}명)를 모두 사용했습니다.</div>`;
      return;
    }
    const taken = new Set(s.pendingSubs.map((q) => q.inId));
    const cands = m.benchAvailable(this.team)
      .filter((p) => !taken.has(p.id) && (slotRole === "GK") === (m.def(p.id).role === "GK"))
      .map((p) => {
        const d = m.def(p.id);
        return { p, d, dist: roleDistance(d.role, slotRole), fit: slotFit(d.attrs, d.role, slotRole), ovr: overall(d.attrs, slotRole) };
      })
      .sort((a, b) => a.dist - b.dist || b.fit - a.fit);
    const rows = cands.map(({ p, d, dist, fit, ovr }) => {
      const cond = Math.round((1 - p.fatigue) * 100);
      const a = this.ages[p.id];
      const kv = keys.map(([l, k]) => `<span>${l} <b>${attr(d.attrs[k])}</b>${delta(attr(d.attrs[k]) - attr(od.attrs[k]), 0)}</span>`).join("");
      const fitTxt = dist === 0 ? `<small style="color:var(--good)">적임</small>` : `<small style="color:var(--warn)">${d.role}→${slotRole} 적합 ${fmt(fit)}</small>`;
      return `<button class="cand ${dist > 3 ? "far" : ""}" data-in="${p.id}">
        <span class="num">#${d.number}</span>
        <span class="who"><b>${d.name}</b><small>${d.role}${a ? ` · ${a}세` : ""}</small>${fitTxt}</span>
        <span class="ovr">${fmt(ovr)}${delta(ovr - outOvr)}</span>
        <span class="kv"><span>컨디션 <b style="color:${cond > 55 ? "var(--good)" : cond > 30 ? "var(--warn)" : "var(--bad)"}">${cond}%</b>${delta(cond - outCond, 0)}</span>${kv}</span>
      </button>`;
    });
    box.innerHTML = head + (rows.length ? rows.join("") : `<div class="hint">투입 가능한 벤치 선수가 없습니다.</div>`) + `<div class="hint">후보를 탭하면 바로 예약됩니다. 종합은 이 자리(${slotRole}) 기준, 화살표는 나가는 선수와의 차이입니다.</div>`;
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
    // set pieces: takers and corner delivery (filled per match in syncSliders)
    const sp = document.createElement("div");
    sp.id = "setPieces";
    sp.style.cssText = "display:grid;grid-template-columns:64px 1fr;gap:4px 8px;align-items:center;margin:6px 0 2px;font-size:12px;color:var(--muted)";
    this.el.sliders.appendChild(sp);
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
    this.renderSetPieces();
    for (const input of this.el.sliders.querySelectorAll<HTMLInputElement>("input[type=range]")) {
      const key = input.dataset.key as SliderKey;
      input.value = String(Math.round(t[key] * 100));
      const def = this.sliderDefs.find((d) => d.key === key)!;
      input.parentElement!.querySelector(".val")!.textContent = this.describe(def, t[key]);
    }
  }

  private renderSetPieces(): void {
    const m = this.match;
    const box = document.getElementById("setPieces");
    if (!box) return;
    const t = m.teams[this.team].tactics;
    const sp = t.setPieces ?? {};
    const eleven = m.state.lineups[this.team].slice(1).map((id) => m.player(id)).filter((p) => !p.sentOff);
    const opt = (cur?: string) => `<option value="">자동</option>${eleven.map((p) => `<option value="${p.id}" ${p.id === cur ? "selected" : ""}>${m.def(p.id).number} ${m.def(p.id).name}</option>`).join("")}`;
    const targets: [CornerTarget, string][] = [["center", "중앙(PK 지점)"], ["near", "니어포스트"], ["far", "파포스트"], ["short", "짧게"]];
    box.innerHTML = `<span>코너 키커</span><select data-sp="cornerTaker">${opt(sp.cornerTaker)}</select>
      <span>프리킥 키커</span><select data-sp="freeKickTaker">${opt(sp.freeKickTaker)}</select>
      <span>PK 키커</span><select data-sp="penaltyTaker">${opt(sp.penaltyTaker)}</select>
      <span>코너 타깃</span><select data-sp="cornerTarget">${targets.map(([v, l]) => `<option value="${v}" ${(sp.cornerTarget ?? "center") === v ? "selected" : ""}>${l}</option>`).join("")}</select>`;
    box.querySelectorAll<HTMLSelectElement>("select[data-sp]").forEach((sel) =>
      sel.addEventListener("change", () => {
        const key = sel.dataset.sp as keyof NonNullable<Tactics["setPieces"]>;
        const next = { ...(m.teams[this.team].tactics.setPieces ?? {}) } as Record<string, string | undefined>;
        next[key] = sel.value || undefined;
        m.setTactics(this.team, { setPieces: next as Tactics["setPieces"] });
      }));
  }

  /** Cheap per-frame update: fatigue bars and counters. Full rebuild when the roster changed. */
  update(force = false): void {
    if (!this.match) return;
    const s = this.match.state;
    const rosterKey = s.lineups[this.team].join(",") + "|" + s.subsUsed[this.team] + "|" + s.pendingSubs.length;
    if (force || rosterKey !== this.rosterKey) {
      this.rosterKey = rosterKey;
      this.renderRoster(true);
      this.renderSetPieces();
      return;
    }
    const now = performance.now();
    if (now - this.lastRoster < 500) return;
    this.lastRoster = now;
    for (const row of this.el.lineup.querySelectorAll<HTMLElement>(".row[data-id]")) {
      const p = this.match.player(row.dataset.id!);
      this.paintBar(row.querySelector<HTMLElement>(".bar i")!, p);
    }
    this.renderDiagram();
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
    this.renderDiagram(true);
    this.renderSubPick();

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
