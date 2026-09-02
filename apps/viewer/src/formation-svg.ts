import { FORMATIONS, type FormationName } from "@3sec/engine";

/** The little a formation diagram needs of a squad (structurally satisfied by the game's Club). */
export interface SquadLike {
  squad: { id: string; number: number; name: string }[];
}

/**
 * Formation diagram as inline SVG, attack pointing up. With a club and starters it labels each slot with the
 * player's number and name; without, it is a small silhouette for the picker.
 */
export function formationSvg(f: FormationName, club: SquadLike | null, starters: string[], width: number, selectedId: string | null = null): string {
  const W = 120, H = 146;
  const slots = FORMATIONS[f];
  const big = width >= 120;
  const dots = slots.map((s, i) => {
    const cx = 60 + s.y * 49;
    const cy = 131 - ((s.x + 1) / 2) * 123;
    const p = club && starters[i] ? club.squad.find((q) => q.id === starters[i]) : undefined;
    const r = big ? 5.6 : 4.2;
    const fill = s.role === "GK" ? "#e8b84a" : i === 0 ? "#e8b84a" : "#f2c14e";
    const label = big && p ? `<text x="${cx}" y="${cy + 0.8}" text-anchor="middle" dominant-baseline="middle" font-size="5.4" font-weight="700" fill="#1a1400" font-family="IBM Plex Mono, monospace">${p.number}</text>
      <text x="${cx}" y="${cy + r + 4.8}" text-anchor="middle" font-size="4.7" fill="#e7edf2" font-family="IBM Plex Sans KR, sans-serif" stroke="#1f4d2a" stroke-width="0.9" paint-order="stroke">${p.name}</text>
      <text x="${cx}" y="${cy + r + 8.6}" text-anchor="middle" font-size="3.4" fill="#cfe3d5" font-family="IBM Plex Mono, monospace">${s.role}</text>` : "";
    const sel = big && p && selectedId === p.id;
    return big && p
      ? `<g data-pid="${p.id}" style="cursor:pointer"><circle cx="${cx}" cy="${cy}" r="${r + 4}" fill="transparent"/><circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}" stroke="${sel ? "#fff" : "#1a1400"}" stroke-width="${sel ? 1.8 : 1}"/>${label}</g>`
      : `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}" stroke="#1a1400" stroke-width="${big ? 1 : 0.6}"/>${label}`;
  }).join("");
  const lines = big
    ? `<rect x="36" y="2" width="48" height="14" fill="none" stroke="#dfe9d9" stroke-width="0.8" opacity=".8"/><rect x="36" y="124" width="48" height="14" fill="none" stroke="#dfe9d9" stroke-width="0.8" opacity=".8"/><line x1="2" y1="70" x2="118" y2="70" stroke="#dfe9d9" stroke-width="0.8" opacity=".8"/><circle cx="60" cy="70" r="10" fill="none" stroke="#dfe9d9" stroke-width="0.8" opacity=".8"/>`
    : `<line x1="2" y1="70" x2="118" y2="70" stroke="#dfe9d9" stroke-width="0.8" opacity=".6"/>`;
  return `<svg viewBox="0 0 ${W} ${H}" width="${width}" height="${Math.round(width * H / W)}" role="img" aria-label="${f}"><rect x="0" y="0" width="${W}" height="${H}" rx="4" fill="#2f7a3e"/><rect x="2" y="2" width="${W - 4}" height="${H - 4}" fill="none" stroke="#dfe9d9" stroke-width="0.8" opacity=".8"/>${lines}${dots}</svg>`;
}

/** One node of the live (in-match) diagram. */
export interface LiveNode {
  id: string;
  number: number;
  name: string;
  /** slot role label (CB, ST…) */
  role: string;
  /** condition 0..1 (1 = fresh) */
  cond: number;
  goals: number;
  yellow: boolean;
  injured: boolean;
  /** a queued substitution for this player: who comes on */
  pending?: { number: number; name: string } | null;
  selected?: boolean;
  /** empty slot (sent off) */
  empty?: boolean;
}

export interface LiveDiagramOptions {
  formation: FormationName;
  nodes: (LiveNode | null)[];
  /** attack direction: "up" (portrait panel) or "right" (landscape drawer) */
  orient: "up" | "right";
  /** kit colour for the discs */
  color: string;
  /** text colour on the discs */
  textColor: string;
}

/** condition → ring colour (matches the fatigue bars of the roster list) */
export function condColor(cond: number): string {
  return cond > 0.55 ? "#5fd38a" : cond > 0.3 ? "#f4a259" : "#ef5b5b";
}

/**
 * Live formation diagram for the manager panel: the on-pitch XI with number, name, a condition ring,
 * goal / card / injury marks and a badge for a queued substitution. Each node is tappable (`data-pid`).
 * Sized by the viewBox only (width:100% in CSS); the aspect follows the orientation.
 */
export function liveFormationSvg(o: LiveDiagramOptions): string {
  const up = o.orient === "up";
  // roomy enough that a disc plus its two-line label never touches the next line of the formation
  const W = up ? 170 : 240, H = up ? 220 : 210;
  const slots = FORMATIONS[o.formation];
  const r = 8.5;
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  // pitch markings
  const pad = 3;
  const mark = up
    ? `<rect x="${W / 2 - 34}" y="${pad}" width="68" height="20" fill="none" stroke="#dfe9d9" stroke-width="0.9" opacity=".7"/><rect x="${W / 2 - 34}" y="${H - pad - 20}" width="68" height="20" fill="none" stroke="#dfe9d9" stroke-width="0.9" opacity=".7"/><line x1="${pad}" y1="${H / 2}" x2="${W - pad}" y2="${H / 2}" stroke="#dfe9d9" stroke-width="0.9" opacity=".7"/><circle cx="${W / 2}" cy="${H / 2}" r="14" fill="none" stroke="#dfe9d9" stroke-width="0.9" opacity=".7"/>`
    : `<rect x="${pad}" y="${H / 2 - 34}" width="20" height="68" fill="none" stroke="#dfe9d9" stroke-width="0.9" opacity=".7"/><rect x="${W - pad - 20}" y="${H / 2 - 34}" width="20" height="68" fill="none" stroke="#dfe9d9" stroke-width="0.9" opacity=".7"/><line x1="${W / 2}" y1="${pad}" x2="${W / 2}" y2="${H - pad}" stroke="#dfe9d9" stroke-width="0.9" opacity=".7"/><circle cx="${W / 2}" cy="${H / 2}" r="14" fill="none" stroke="#dfe9d9" stroke-width="0.9" opacity=".7"/>`;
  const nodes = slots.map((s, i) => {
    // normalised slot → diagram coordinates (labels need ~16 units below each disc)
    const along = (s.x + 1) / 2; // 0 own goal … 1 opponent goal
    const cx = up ? W / 2 + s.y * (W / 2 - 24) : 22 + along * (W - 44);
    const cy = up ? (H - 26) - along * (H - 44) : H / 2 + s.y * (H / 2 - 26);
    const n = o.nodes[i];
    if (!n || n.empty) {
      return `<g><circle cx="${cx}" cy="${cy}" r="${r - 1}" fill="none" stroke="#e7edf2" stroke-dasharray="2 2" stroke-width="1" opacity=".5"/><text x="${cx}" y="${cy + r + 8}" text-anchor="middle" font-size="5.5" fill="#cfe3d5" font-family="IBM Plex Mono, monospace">${s.role}</text></g>`;
    }
    const circ = 2 * Math.PI * (r + 2.4);
    const ring = `<circle cx="${cx}" cy="${cy}" r="${r + 2.4}" fill="none" stroke="#0b1014" stroke-opacity=".55" stroke-width="2.2"/><circle cx="${cx}" cy="${cy}" r="${r + 2.4}" fill="none" stroke="${condColor(n.cond)}" stroke-width="2.2" stroke-linecap="round" stroke-dasharray="${(circ * Math.max(0.02, n.cond)).toFixed(1)} ${circ.toFixed(1)}" transform="rotate(-90 ${cx} ${cy})"/>`;
    const sel = n.selected ? `<circle cx="${cx}" cy="${cy}" r="${r + 5}" fill="none" stroke="#ffd166" stroke-width="1.6"/>` : "";
    const marks: string[] = [];
    if (n.goals > 0) marks.push(`<g><circle cx="${cx + r - 1}" cy="${cy - r + 1}" r="4.2" fill="#fff" stroke="#1a1400" stroke-width=".6"/><text x="${cx + r - 1}" y="${cy - r + 1.4}" text-anchor="middle" dominant-baseline="middle" font-size="5" font-weight="700" fill="#1a1400" font-family="IBM Plex Mono, monospace">${n.goals > 1 ? n.goals : "⚽"}</text></g>`);
    if (n.yellow) marks.push(`<rect x="${cx - r - 3}" y="${cy - r - 1}" width="3.6" height="5" fill="#ffd60a" stroke="#1a1400" stroke-width=".5"/>`);
    if (n.injured) marks.push(`<text x="${cx - r - 1}" y="${cy + r + 1}" text-anchor="middle" font-size="6" fill="#ef5b5b" font-weight="700" font-family="IBM Plex Sans KR, sans-serif">✚</text>`);
    const pend = n.pending
      ? `<g><rect x="${cx - 16}" y="${cy - r - 13}" width="32" height="8.5" rx="2" fill="#ffd166" stroke="#1a1400" stroke-width=".5"/><text x="${cx}" y="${cy - r - 8.6}" text-anchor="middle" dominant-baseline="middle" font-size="5.6" font-weight="700" fill="#1a1400" font-family="IBM Plex Sans KR, sans-serif">⇄ #${n.pending.number} ${esc(n.pending.name)}</text></g>`
      : "";
    return `<g data-pid="${n.id}" style="cursor:pointer"><circle cx="${cx}" cy="${cy}" r="${r + 7}" fill="transparent"/>${sel}${ring}<circle cx="${cx}" cy="${cy}" r="${r}" fill="${o.color}" stroke="${n.selected ? "#fff" : "#1a1400"}" stroke-width="${n.selected ? 1.6 : 0.9}"/>
      <text x="${cx}" y="${cy + 0.6}" text-anchor="middle" dominant-baseline="middle" font-size="8" font-weight="700" fill="${o.textColor}" font-family="IBM Plex Mono, monospace">${n.number}</text>
      <text x="${cx}" y="${cy + r + 9}" text-anchor="middle" font-size="6.6" font-weight="600" fill="#ffffff" font-family="IBM Plex Sans KR, sans-serif" stroke="#153d20" stroke-width="1.4" paint-order="stroke">${esc(n.name)}</text>
      <text x="${cx}" y="${cy + r + 15.5}" text-anchor="middle" font-size="5" fill="#cfe3d5" font-family="IBM Plex Mono, monospace">${n.role}</text>${marks.join("")}${pend}</g>`;
  }).join("");
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${o.formation}" style="display:block"><rect x="0" y="0" width="${W}" height="${H}" rx="5" fill="#2f7a3e"/><rect x="${pad}" y="${pad}" width="${W - pad * 2}" height="${H - pad * 2}" fill="none" stroke="#dfe9d9" stroke-width="0.9" opacity=".7"/>${mark}${nodes}</svg>`;
}
