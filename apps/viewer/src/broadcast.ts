/**
 * 중계 그래픽: the match presented the way it would be on television. Everything here is DOM laid over the
 * pitch canvas, because broadcast graphics are type and blocks of colour, which the browser draws better
 * than a canvas does.
 *
 * The pieces, in the order a viewer meets them:
 * - `lineups` sweeps both elevens in before kick-off, the way a broadcast opens.
 * - `bug` is the permanent scoreline in the corner: club blocks in their own colours, the clock, the round.
 * - `strap` is the lower third that announces a goal, a card or a substitution and then leaves.
 * - `interval` is the half-time and full-time card, with the numbers that decided it.
 * - `replay` marks the replay, as a broadcast must.
 *
 * All of it obeys prefers-reduced-motion: the same graphics, without the sweep.
 */

export interface Side {
  name: string;
  shortName: string;
  color: string;
  crest: string;
}

export interface StrapSpec {
  kind: "goal" | "card" | "sub" | "note";
  /** the big word: 골, 퇴장, 교체 */
  title: string;
  /** who it happened to */
  who: string;
  /** the minute, already formatted */
  minute: string;
  /** the side it belongs to, for the colour bar */
  color: string;
  /** the scoreline after the event, for a goal */
  score?: string;
  /** a second line: the assist, the reason, the player coming on */
  note?: string;
}

export interface IntervalStat { label: string; home: string; away: string; /** 0..1 share for the bar */ share?: number }

const reduced = (): boolean => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const el = (tag: string, cls: string, html = ""): HTMLElement => {
  const e = document.createElement(tag);
  e.className = cls;
  if (html) e.innerHTML = html;
  return e;
};

export class Broadcast {
  private readonly root: HTMLElement;
  private bugEl: HTMLElement | null = null;
  private strapEl: HTMLElement | null = null;
  private strapTimer = 0;
  private cardEl: HTMLElement | null = null;
  private replayEl: HTMLElement | null = null;
  private home: Side | null = null;
  private away: Side | null = null;

  constructor(stage: HTMLElement) {
    this.root = el("div", "bc");
    stage.appendChild(this.root);
  }

  /** Clear everything (a new match, or leaving the screen). */
  reset(home: Side, away: Side, competition: string): void {
    this.home = home; this.away = away;
    this.root.innerHTML = "";
    this.bugEl = null; this.strapEl = null; this.cardEl = null; this.replayEl = null;
    window.clearTimeout(this.strapTimer);
    this.buildBug(competition);
  }

  dispose(): void {
    window.clearTimeout(this.strapTimer);
    this.root.innerHTML = "";
    this.root.remove();
  }

  // ------------------------------------------------------------------ the bug

  private buildBug(competition: string): void {
    const h = this.home!, a = this.away!;
    const bug = el("div", "bcBug");
    bug.innerHTML = `
      <div class="bcTeams">
        <span class="bcSide" style="--c:${h.color}"><i class="bcCrest">${h.crest}</i><b>${h.shortName}</b></span>
        <span class="bcScore" data-bc="score">0 - 0</span>
        <span class="bcSide r" style="--c:${a.color}"><b>${a.shortName}</b><i class="bcCrest">${a.crest}</i></span>
      </div>
      <div class="bcMeta"><span class="bcClock" data-bc="clock">00:00</span><span class="bcComp">${competition}</span><span class="bcPhase" data-bc="phase"></span></div>`;
    this.root.appendChild(bug);
    this.bugEl = bug;
  }

  /** The running score, clock and state. `danger` pulses the clock in the last minute. */
  update(score: [number, number], clock: string, phase: string, danger: boolean): void {
    if (!this.bugEl) return;
    const s = this.bugEl.querySelector<HTMLElement>('[data-bc="score"]')!;
    const next = `${score[0]} - ${score[1]}`;
    if (s.textContent !== next) {
      s.textContent = next;
      if (!reduced()) { s.classList.remove("hit"); void s.offsetWidth; s.classList.add("hit"); }
    }
    const c = this.bugEl.querySelector<HTMLElement>('[data-bc="clock"]')!;
    c.textContent = clock;
    c.classList.toggle("danger", danger);
    this.bugEl.querySelector<HTMLElement>('[data-bc="phase"]')!.textContent = phase;
  }

  // ------------------------------------------------------------------ line-ups

  /** The opening graphic: both elevens, sweeping in from the sides. Resolves when it has left. */
  lineups(homeXI: string[], awayXI: string[], homeFormation: string, awayFormation: string, note: string): Promise<void> {
    const h = this.home!, a = this.away!;
    const card = el("div", "bcLineups");
    const col = (side: Side, xi: string[], formation: string, right: boolean) => `
      <div class="bcXI${right ? " r" : ""}" style="--c:${side.color}">
        <div class="bcXIHead"><i>${side.crest}</i><b>${side.name}</b><small>${formation}</small></div>
        <ol>${xi.map((n, i) => `<li style="animation-delay:${(i * 26 + (right ? 90 : 0))}ms"><span>${i + 1}</span>${n}</li>`).join("")}</ol>
      </div>`;
    card.innerHTML = `<div class="bcLineHead">${note}</div><div class="bcXIs">${col(h, homeXI, homeFormation, false)}${col(a, awayXI, awayFormation, true)}</div>`;
    this.root.appendChild(card);
    return new Promise((done) => {
      const leave = () => {
        card.classList.add("out");
        window.setTimeout(() => { card.remove(); done(); }, reduced() ? 0 : 320);
      };
      card.addEventListener("click", leave);
      window.setTimeout(leave, reduced() ? 900 : 3400);
    });
  }

  // ------------------------------------------------------------------ straps

  /** The lower third. A second strap replaces the first rather than queueing behind it. */
  strap(spec: StrapSpec): void {
    window.clearTimeout(this.strapTimer);
    this.strapEl?.remove();
    const s = el("div", `bcStrap ${spec.kind}`);
    s.style.setProperty("--c", spec.color);
    s.innerHTML = `
      <div class="bcStripe"></div>
      <div class="bcStrapMain">
        <div class="bcStrapTitle">${spec.title}</div>
        <div class="bcStrapWho">${spec.who}${spec.note ? `<small>${spec.note}</small>` : ""}</div>
      </div>
      <div class="bcStrapRight">${spec.score ? `<b>${spec.score}</b>` : ""}<span>${spec.minute}</span></div>`;
    this.root.appendChild(s);
    this.strapEl = s;
    const life = spec.kind === "goal" ? 4200 : 3000;
    this.strapTimer = window.setTimeout(() => {
      s.classList.add("out");
      window.setTimeout(() => s.remove(), reduced() ? 0 : 300);
    }, life);
  }

  /** Take the lower third off now (an interval card is coming). */
  closeStrap(): void {
    window.clearTimeout(this.strapTimer);
    this.strapEl?.remove();
    this.strapEl = null;
  }

  // ------------------------------------------------------------------ interval cards

  /** Half-time or full-time, with the numbers. `onClose` fires when the viewer dismisses it. */
  interval(title: string, score: string, stats: IntervalStat[], button: string | null, onClose?: () => void, aside?: { label: string; onPick: () => void }): void {
    this.cardEl?.remove();
    const h = this.home!, a = this.away!;
    const card = el("div", "bcCard");
    card.innerHTML = `
      <div class="bcCardHead"><span class="bcCardTitle">${title}</span></div>
      <div class="bcCardScore">
        <span class="bcSide" style="--c:${h.color}"><i class="bcCrest">${h.crest}</i><b>${h.shortName}</b></span>
        <span class="bcBig">${score}</span>
        <span class="bcSide r" style="--c:${a.color}"><b>${a.shortName}</b><i class="bcCrest">${a.crest}</i></span>
      </div>
      <div class="bcStats">${stats.map((st) => `
        <div class="bcStat">
          <span class="l">${st.home}</span><span class="k">${st.label}</span><span class="r">${st.away}</span>
          ${st.share === undefined ? "" : `<div class="bcBar"><i style="width:${Math.round(st.share * 100)}%;background:${h.color}"></i><u style="width:${Math.round((1 - st.share) * 100)}%;background:${a.color}"></u></div>`}
        </div>`).join("")}</div>
      ${button || aside ? `<div class="bcCardActs">${aside ? `<button data-bc="aside">${aside.label}</button>` : ""}${button ? `<button class="primary" data-bc="close">${button}</button>` : ""}</div>` : ""}`;
    this.root.appendChild(card);
    this.cardEl = card;
    card.querySelector<HTMLButtonElement>('[data-bc="close"]')?.addEventListener("click", () => {
      this.closeCard();
      onClose?.();
    });
    card.querySelector<HTMLButtonElement>('[data-bc="aside"]')?.addEventListener("click", () => aside!.onPick());
  }

  closeCard(): void {
    const c = this.cardEl;
    if (!c) return;
    this.cardEl = null;
    c.classList.add("out");
    window.setTimeout(() => c.remove(), reduced() ? 0 : 280);
  }

  hasCard(): boolean { return !!this.cardEl; }

  // ------------------------------------------------------------------ wipe

  /** A colour band sweeping across the picture: what a broadcast puts between the live feed and a replay. */
  wipe(color: string): Promise<void> {
    if (reduced()) return Promise.resolve();
    const w = el("div", "bcWipe");
    w.style.setProperty("--c", color);
    this.root.appendChild(w);
    return new Promise((done) => {
      window.setTimeout(() => { w.remove(); done(); }, 460);
    });
  }

  // ------------------------------------------------------------------ replay

  replay(on: boolean): void {
    if (on && !this.replayEl) {
      this.replayEl = el("div", "bcReplay", "<i></i>REPLAY");
      this.root.appendChild(this.replayEl);
    } else if (!on && this.replayEl) {
      this.replayEl.remove();
      this.replayEl = null;
    }
  }
}
