/**
 * Procedural club emblems.
 *
 * A club's identity used to be a coloured dot, which fails twice: three of the league's blues sit
 * within a few degrees of hue, and 서울/수원/창원/전주 collapse into each other for red-green colour
 * blindness (~8% of men). An emblem adds two identity channels that survive both problems — the
 * crest *silhouette* and the *pattern* inside it — so clubs stay apart even in greyscale.
 *
 * Everything is derived deterministically from the club (its original name and id), so the same club
 * always wears the same crest, and the result is a small SVG string that can be inlined many times.
 */

import { luminance, shade } from "./kits";

/** What an emblem is built from: any club-like object. `baseName` keeps renamed clubs stable. */
export interface EmblemSource {
  id?: number;
  name: string;
  shortName?: string;
  color: string;
  baseName?: string;
}

const SHAPES = ["shield", "round", "hex", "banner", "diamond", "rounded"] as const;
const PATTERNS = ["solid", "halves", "stripes", "sash", "hoop", "quarters"] as const;
type Shape = (typeof SHAPES)[number];
type Pattern = (typeof PATTERNS)[number];

/** Crest outlines on a 32×32 canvas, inset 1.5px so the outline stroke stays inside the box. */
const SHAPE_PATH: Record<Shape, string> = {
  shield: "M16 1.5 29.7 5.6V16.3C29.7 23.6 22.8 28.9 16 30.5 9.2 28.9 2.3 23.6 2.3 16.3V5.6Z",
  round: "M1.8 16A14.2 14.2 0 1 0 30.2 16A14.2 14.2 0 1 0 1.8 16Z",
  hex: "M16 1.5 29 8.6V23.4L16 30.5 3 23.4V8.6Z",
  banner: "M3.4 2.2H28.6V30.4L16 23.2 3.4 30.4Z",
  diamond: "M16 1.4 30.6 16 16 30.6 1.4 16Z",
  rounded: "M7 2.2H25A4.8 4.8 0 0 1 29.8 7V25A4.8 4.8 0 0 1 25 29.8H7A4.8 4.8 0 0 1 2.2 25V7A4.8 4.8 0 0 1 7 2.2Z",
};

/** Stable 32-bit hash of a string (FNV-1a). */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** The identity key of a club: original name first (renaming a club keeps its crest), then id. */
function keyOf(c: EmblemSource): string {
  return `${c.baseName ?? c.name}#${c.id ?? ""}`;
}

/** Secondary colour: a much darker or much lighter shade of the club colour, whichever contrasts. */
function secondaryOf(color: string): string {
  return luminance(color) > 0.42 ? shade(color, -0.62) : shade(color, 0.62);
}

/** The character shown on the crest: first letter of the short name, else of the name. */
function initialOf(c: EmblemSource): string {
  const src = (c.shortName ?? c.name).trim();
  return src ? [...src][0]! : "?";
}

/**
 * Which shape each league club wears. Twelve clubs share six silhouettes, so the pairs are chosen to put
 * colours that survive colour-blindness together (red 서울 with light-blue 대구, yellow 광주 with purple 대전,
 * cyan 부산 with orange 울산 …) instead of the naive id % 6, which paired red 서울 with green 수원 — the exact
 * collision a deuteranope cannot resolve. Patterns differ within every pair as a second channel.
 */
const CLUB_SHAPE = [0, 1, 2, 0, 3, 3, 2, 1, 4, 5, 4, 5] as const;

/** The deterministic design of a club's crest — exported so callers can match it elsewhere (kits, pitch). */
export function emblemDesign(c: EmblemSource): { shape: Shape; pattern: Pattern; primary: string; secondary: string; initial: string } {
  // The league's clubs have small ids and use the table above; anything without one (engine test teams,
  // custom clubs) falls back to the name hash.
  const i = typeof c.id === "number" && c.id >= 0 ? c.id : hash(keyOf(c)) % 997;
  return {
    shape: SHAPES[CLUB_SHAPE[i] ?? i % SHAPES.length]!,
    pattern: PATTERNS[(i * 5 + Math.floor(i / SHAPES.length)) % PATTERNS.length]!,
    primary: c.color,
    secondary: secondaryOf(c.color),
    initial: initialOf(c),
  };
}

/** The pattern fills, painted over the primary inside the crest clip. */
function patternSvg(p: Pattern, sec: string): string {
  const f = ` fill="${sec}"`;
  switch (p) {
    case "halves":
      return `<rect x="16" y="0" width="16" height="32"${f}/>`;
    case "stripes":
      return `<path d="M4 0h4.5v32H4Zm10 0h4.5v32H14Zm10 0h4.5v32H24Z"${f}/>`;
    case "sash":
      return `<path d="M0 24 24 0h8L0 32Z"${f}/>`;
    case "hoop":
      return `<rect x="0" y="11" width="32" height="10"${f}/>`;
    case "quarters":
      return `<path d="M0 0h16v16H0Zm16 16h16v16H16Z"${f}/>`;
    case "solid":
    default:
      return "";
  }
}

const cache = new Map<string, string>();
const CACHE_MAX = 160;

/**
 * An inline SVG crest for a club, `size` css px square.
 *
 * Deterministic: shape, pattern and the derived secondary colour all come from the club, so the same
 * club always looks the same. Cheap to inline many times (the markup is cached per club+size).
 */
export function emblemSvg(c: EmblemSource, size = 18): string {
  const key = `${keyOf(c)}|${c.color}|${c.shortName ?? ""}|${size}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const d = emblemDesign(c);
  // Unique per design so several crests can share a document without their clips colliding.
  const cid = `em${hash(`${keyOf(c)}|${c.color}`).toString(36)}`;
  const dark = luminance(d.primary) > 0.5 ? "#101418" : "#ffffff";
  const halo = dark === "#ffffff" ? "rgba(0,0,0,0.55)" : "rgba(255,255,255,0.7)";
  const path = SHAPE_PATH[d.shape];
  const svg =
    `<svg class="emb" viewBox="0 0 32 32" width="${size}" height="${size}" aria-hidden="true" focusable="false" style="vertical-align:middle;flex:0 0 auto">` +
    `<defs><clipPath id="${cid}"><path d="${path}"/></clipPath></defs>` +
    `<g clip-path="url(#${cid})"><rect width="32" height="32" fill="${d.primary}"/>${patternSvg(d.pattern, d.secondary)}</g>` +
    `<path d="${path}" fill="none" stroke="rgba(255,255,255,0.85)" stroke-width="1.6"/>` +
    // `dy` rather than dominant-baseline: older WebViews ignore the latter and drop the letter to the floor.
    `<text x="16" y="16" dy="0.36em" text-anchor="middle" font-size="17" font-weight="700"` +
    ` font-family="'Noto Sans KR',system-ui,sans-serif" fill="${dark}" stroke="${halo}" stroke-width="3.2"` +
    ` paint-order="stroke" stroke-linejoin="round">${escapeText(d.initial)}</text>` +
    `</svg>`;

  if (cache.size >= CACHE_MAX) cache.clear();
  cache.set(key, svg);
  return svg;
}

/** A crest at `size` px, or the old colour dot when it would be too small to read (< 13px). */
export function emblemOrDot(c: EmblemSource, size = 18, dotStyle = ""): string {
  return size >= 13 ? emblemSvg(c, size) : `<span class="dot" style="background:${c.color}${dotStyle ? `;${dotStyle}` : ""}"></span>`;
}

function escapeText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
