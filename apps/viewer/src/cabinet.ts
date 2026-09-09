/**
 * 트로피 진열장: the honours as an object in the room rather than a row of tiles. A wooden case with lit
 * glass shelves; each trophy stands on a shelf with its engraved plaque, and the shelves that are still
 * empty stay visible — an empty cabinet is the point of the first season.
 *
 * The trophies are drawn, not photographed: a league cup, a smaller knock-out cup, a manager's shield and
 * a promotion plate, each in its own metal. Sizes carry the hierarchy, so a shelf reads at a glance.
 */

export type TrophyKind = "league" | "cup" | "manager" | "promotion" | "continental";

export interface Trophy {
  kind: TrophyKind;
  /** the engraving: what was won */
  label: string;
  /** the season, engraved under it */
  season: number;
  /** a double, a treble — a ribbon on the cup */
  ribbon?: string;
}

interface Metal { body: string; shine: string; dark: string; base: string }

const METAL: Record<TrophyKind, Metal> = {
  league: { body: "#e8c15c", shine: "#fff3c9", dark: "#9a7420", base: "#3a2d14" },
  continental: { body: "#cfd8e3", shine: "#ffffff", dark: "#7d8a9b", base: "#232c37" },
  cup: { body: "#c9ccd4", shine: "#f6f8fb", dark: "#7a7f8a", base: "#26292f" },
  manager: { body: "#d8a657", shine: "#ffe9b8", dark: "#8d6520", base: "#33270f" },
  promotion: { body: "#b5c9a8", shine: "#e8f3e0", dark: "#6f8264", base: "#232b1f" },
};

/** How tall a trophy stands, in the shelf's units. The hierarchy is the whole point of a cabinet. */
const HEIGHT: Record<TrophyKind, number> = { league: 1, continental: 0.88, cup: 0.76, manager: 0.62, promotion: 0.5 };
/** Width over height. A cup is tall and narrow; a shield and a plate are not, and forcing them into a cup's
 * proportions is what made the shield read as a bullet. */
const ASPECT: Record<TrophyKind, number> = { league: 0.62, continental: 0.62, cup: 0.62, manager: 0.92, promotion: 1 };

const cupSvg = (m: Metal, w: number, h: number, handles: boolean): string => {
  const id = Math.random().toString(36).slice(2, 8);
  const bowlH = h * 0.44, stemH = h * 0.2, baseH = h * 0.14, cx = w / 2;
  const bowlW = w * 0.62;
  return `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true">
    <defs><linearGradient id="g${id}" x1="0" x2="1"><stop offset="0" stop-color="${m.dark}"/><stop offset=".38" stop-color="${m.body}"/><stop offset=".52" stop-color="${m.shine}"/><stop offset=".7" stop-color="${m.body}"/><stop offset="1" stop-color="${m.dark}"/></linearGradient></defs>
    ${handles ? `<path d="M${cx - bowlW / 2} ${h * 0.14} q ${-bowlW * 0.42} ${bowlH * 0.16} ${-bowlW * 0.05} ${bowlH * 0.6}" fill="none" stroke="url(#g${id})" stroke-width="${w * 0.075}" stroke-linecap="round"/>
      <path d="M${cx + bowlW / 2} ${h * 0.14} q ${bowlW * 0.42} ${bowlH * 0.16} ${bowlW * 0.05} ${bowlH * 0.6}" fill="none" stroke="url(#g${id})" stroke-width="${w * 0.075}" stroke-linecap="round"/>` : ""}
    <path d="M${cx - bowlW / 2} ${h * 0.1} h ${bowlW} l ${-bowlW * 0.11} ${bowlH * 0.62} q ${-bowlW * 0.06} ${bowlH * 0.38} ${-bowlW * 0.56} ${bowlH * 0.38} q ${-bowlW * 0.5} 0 ${-bowlW * 0.56} ${-bowlH * 0.38} Z" fill="url(#g${id})"/>
    <rect x="${cx - bowlW / 2 - w * 0.03}" y="${h * 0.06}" width="${bowlW + w * 0.06}" height="${h * 0.055}" rx="${h * 0.02}" fill="url(#g${id})"/>
    <rect x="${cx - w * 0.055}" y="${h * 0.1 + bowlH}" width="${w * 0.11}" height="${stemH}" fill="url(#g${id})"/>
    <rect x="${cx - w * 0.3}" y="${h - baseH}" width="${w * 0.6}" height="${baseH}" rx="${h * 0.014}" fill="${m.base}"/>
    <rect x="${cx - w * 0.22}" y="${h - baseH - h * 0.045}" width="${w * 0.44}" height="${h * 0.05}" rx="${h * 0.012}" fill="url(#g${id})"/>
  </svg>`;
};

const shieldSvg = (m: Metal, w: number, h: number): string => {
  const id = Math.random().toString(36).slice(2, 8);
  const baseH = h * 0.16, top = h * 0.05, bodyH = h - baseH - top - h * 0.04;
  const l = w * 0.1, r = w * 0.9, shoulder = top + bodyH * 0.46, tip = top + bodyH;
  return `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true">
    <defs><linearGradient id="s${id}" x1="0" x2="1"><stop offset="0" stop-color="${m.dark}"/><stop offset=".42" stop-color="${m.body}"/><stop offset=".56" stop-color="${m.shine}"/><stop offset="1" stop-color="${m.dark}"/></linearGradient></defs>
    <path d="M${l} ${top} H ${r} V ${shoulder} Q ${r} ${tip - bodyH * 0.1} ${w / 2} ${tip} Q ${l} ${tip - bodyH * 0.1} ${l} ${shoulder} Z" fill="url(#s${id})" stroke="${m.dark}" stroke-width=".8" stroke-linejoin="round"/>
    <path d="M${l + w * 0.08} ${top + bodyH * 0.26} H ${r - w * 0.08}" stroke="${m.dark}" stroke-width="${h * 0.03}" opacity=".5" stroke-linecap="round"/>
    <path d="M${l + w * 0.08} ${top + bodyH * 0.44} H ${r - w * 0.08}" stroke="${m.dark}" stroke-width="${h * 0.03}" opacity=".35" stroke-linecap="round"/>
    <rect x="${w * 0.26}" y="${h - baseH}" width="${w * 0.48}" height="${baseH}" rx="${h * 0.022}" fill="${m.base}" stroke="${m.dark}" stroke-width=".6"/>
  </svg>`;
};

const plateSvg = (m: Metal, w: number, h: number): string => {
  const id = Math.random().toString(36).slice(2, 8);
  return `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true">
    <defs><linearGradient id="p${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${m.shine}"/><stop offset=".5" stop-color="${m.body}"/><stop offset="1" stop-color="${m.dark}"/></linearGradient></defs>
    <ellipse cx="${w / 2}" cy="${h * 0.46}" rx="${w * 0.42}" ry="${h * 0.4}" fill="url(#p${id})" stroke="${m.dark}" stroke-width=".8"/>
    <ellipse cx="${w / 2}" cy="${h * 0.46}" rx="${w * 0.27}" ry="${h * 0.26}" fill="none" stroke="${m.dark}" stroke-width=".7" opacity=".7"/>
    <rect x="${w * 0.34}" y="${h * 0.84}" width="${w * 0.32}" height="${h * 0.14}" rx="${h * 0.03}" fill="${m.base}"/>
  </svg>`;
};

/** One trophy standing on the shelf, with the plaque that says what it was. */
function trophyHtml(t: Trophy, unit: number): string {
  const m = METAL[t.kind];
  const h = Math.round(unit * HEIGHT[t.kind]);
  const w = Math.round(h * ASPECT[t.kind]);
  const art = t.kind === "manager" ? shieldSvg(m, w, h) : t.kind === "promotion" ? plateSvg(m, w, h) : cupSvg(m, w, h, t.kind !== "cup");
  return `<div class="trophy" title="${t.label} · 시즌 ${t.season}">
    <div class="trArt">${art}${t.ribbon ? `<span class="trRibbon">${t.ribbon}</span>` : ""}</div>
    <div class="trPlaque"><b>${t.label}</b><small>시즌 ${t.season}</small></div>
  </div>`;
}

/**
 * The cabinet. Trophies are laid out onto shelves of `perShelf`, tallest first within each shelf so the
 * silhouette reads, and at least `minShelves` shelves are drawn so an empty case still looks like a case
 * waiting to be filled.
 */
export function cabinetHtml(trophies: readonly Trophy[], opts: { perShelf?: number; minShelves?: number; unit?: number } = {}): string {
  const perShelf = opts.perShelf ?? 4;
  const minShelves = opts.minShelves ?? 2;
  const unit = opts.unit ?? 76;
  const sorted = [...trophies].sort((a, b) => HEIGHT[b.kind] - HEIGHT[a.kind] || a.season - b.season);
  const shelves: Trophy[][] = [];
  for (let i = 0; i < sorted.length; i += perShelf) shelves.push(sorted.slice(i, i + perShelf));
  while (shelves.length < minShelves) shelves.push([]);
  const body = shelves.map((row) => `<div class="shelf" style="--unit:${unit}px">
    <div class="shelfItems">${row.length ? row.map((t) => trophyHtml(t, unit)).join("") : '<div class="shelfEmpty">비어 있음</div>'}</div>
    <div class="shelfBoard"></div>
  </div>`).join("");
  return `<div class="cabinet"><div class="cabinetIn">${body}</div><div class="cabinetGlass"></div></div>`;
}
