/**
 * Procedural player and manager portraits.
 *
 * A squad is twenty coloured discs with numbers on them, and a league is four hundred and eighty of
 * them: nobody's face tells you anything, so the squad list reads as a spreadsheet. Real portraits
 * are impossible — the players are generated, and there are hundreds of them — so these are drawn the
 * way the club crests are (emblem.ts): every feature is derived from the player's id, so the same
 * player always has the same face, in any screen, at any size, for no bytes at all.
 *
 * The face carries information as well as identity. Age greys the hair, thins it and grows the beard
 * out, so a squad list shows its veterans at a glance; the collar is the club's kit colour, so a
 * player in a list of transfer targets is visibly somebody else's.
 *
 * Drawn to read at 28px in a squad row, which is the smallest place it appears — features are few
 * and large on purpose. There is no attempt at likeness or ethnicity beyond a plausible spread for a
 * Korean league; the point is that two players look like two different people.
 */
import { luminance, shade } from "./kits";

export interface PortraitSource {
  /** stable identity: the same id always produces the same face */
  id: string;
  /** greys and thins the hair, and grows the beard */
  age: number;
  /** collar colour; omitted for a plain neutral collar */
  color?: string;
}

/** Stable 32-bit hash (FNV-1a), the same one the crests use. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** A stream of small independent numbers out of one hash, so features do not move together. */
function bits(h: number, slot: number, mod: number): number {
  return (Math.imul(h ^ Math.imul(slot + 1, 0x9e3779b1), 0x85ebca6b) >>> 8) % mod;
}

const SKIN = ["#f4d3b4", "#eec7a3", "#e3b48c", "#d6a279", "#c48f66", "#a97753"];
const HAIR = ["#14100e", "#1d1712", "#2b1d15", "#3a2a1c", "#4a3324", "#6b4a2f"];
/** Dyed, which a few players in every squad have. */
const DYED = ["#b4762c", "#c9a227", "#8d5524", "#5c5c5c"];

type Face = "oval" | "round" | "square" | "long";
type Hair = "short" | "buzz" | "curly" | "parted" | "swept" | "bald" | "bun";
type Beard = "none" | "stubble" | "moustache" | "goatee" | "full";

export interface PortraitDesign {
  skin: string; hair: string; face: Face; style: Hair; beard: Beard; brow: number; eye: number; grey: number;
}

/**
 * The face a source resolves to. Age is folded in here rather than at the drawing stage so that the
 * design itself is what ages: hair greys from the late twenties, recedes past thirty, and a beard
 * only appears on a grown man.
 */
export function portraitDesign(src: PortraitSource): PortraitDesign {
  const h = hash(src.id);
  const age = Math.max(15, Math.min(40, src.age || 25));
  const dyed = bits(h, 7, 100) < 12;
  const style: Hair = (() => {
    const pool: Hair[] = ["short", "short", "buzz", "curly", "parted", "swept", "bun"];
    const pick = pool[bits(h, 2, pool.length)]!;
    // hair thins with age: a receding pick becomes a buzz, and some of the oldest go bald outright.
    // Kept modest — about one in five by the late thirties — a first cut had most veterans bald.
    const balding = bits(h, 8, 100) < Math.max(0, (age - 30) * 3);
    return balding ? (bits(h, 9, 2) ? "bald" : "buzz") : pick;
  })();
  const beard: Beard = (() => {
    if (age < 20) return "none";
    const pool: Beard[] = ["none", "none", "stubble", "stubble", "moustache", "goatee", "full"];
    const pick = pool[bits(h, 3, pool.length)]!;
    // the very young keep it light whatever the draw
    return age < 23 && (pick === "full" || pick === "moustache") ? "stubble" : pick;
  })();
  return {
    skin: SKIN[bits(h, 1, SKIN.length)]!,
    hair: dyed ? DYED[bits(h, 6, DYED.length)]! : HAIR[bits(h, 5, HAIR.length)]!,
    face: (["oval", "round", "square", "long"] as Face[])[bits(h, 0, 4)]!,
    style,
    beard,
    brow: bits(h, 4, 3),
    eye: bits(h, 10, 3),
    // nothing before thirty, a little salt at 33, clearly greying by the late thirties
    grey: Math.max(0, Math.min(0.6, (age - 30) / 12)),
  };
}

/** Head outlines on a 64×64 canvas, wide enough to leave room for hair and shoulders. */
const FACE_PATH: Record<Face, string> = {
  oval: "M32 12c9.4 0 15.5 6.6 15.5 17.5 0 12.4-7.2 21-15.5 21s-15.5-8.6-15.5-21C16.5 18.6 22.6 12 32 12Z",
  round: "M32 12.5c10.2 0 16.5 7.2 16.5 17.8S42 51 32 51 15.5 40.9 15.5 30.3 21.8 12.5 32 12.5Z",
  square: "M32 12c9.8 0 15.8 6 15.8 15.6v6.2c0 10.4-6.6 17-15.8 17s-15.8-6.6-15.8-17v-6.2C16.2 18 22.2 12 32 12Z",
  long: "M32 11c9 0 15 6.4 15 16.6 0 14.6-7 24.4-15 24.4s-15-9.8-15-24.4C17 17.4 23 11 32 11Z",
};

function hairSvg(d: PortraitDesign, mix: string): string {
  const f = ` fill="${mix}"`;
  switch (d.style) {
    case "bald":
      return "";
    case "buzz":
      return `<path d="M17.5 28c0-11 6.4-17 14.5-17s14.5 6 14.5 17c0 1.6-1.2 2-1.6.6C43 21 38.5 17.6 32 17.6S21 21 19.1 28.6c-.4 1.4-1.6 1-1.6-.6Z"${f}/>`;
    case "curly":
      return `<path d="M32 8.4c7.6 0 14.6 4.4 15.4 12.6.3 3.2-.6 6.6-1.7 6.6-1 0-.8-2.6-2-4.6-1.5 2.2-4 3.4-6.6 2.6-2.2 3-6.6 3.4-9.6 1.6-2 2.6-6 3-8.2.8-1.2 1.6-2.4 3.4-3.2 3-1.2-.6-1.9-4-1.5-7C15.6 14 22.6 8.4 32 8.4Z"${f}/>`;
    case "parted":
      return `<path d="M16.6 27.4c-.6-11.4 6-17.6 15.4-17.6 9 0 15.6 5.4 15.4 16-2.6-4.6-7-8-14-8-3 3.6-6.6 5.4-11 6-2 .3-3.4 1.8-4 5-.4 2-1.7 1.6-1.8-1.4Z"${f}/>`;
    case "swept":
      return `<path d="M17 28c-1-12 5.8-18.6 15-18.6 8 0 14 4.4 15 12.6.4 3.4-.4 7-1.6 7-1 0-.6-3.4-2.6-5.6-4.6 2.6-14.4 3.6-21 8.6-2 1.6-4.4 2.4-4.8-4Z"${f}/>`;
    case "bun":
      return `<path d="M32 9.4c9 0 15 6 15 16.4 0 1.8-1.2 2.4-1.7 1-1.8-5.4-6.4-8.6-13.3-8.6s-11.5 3.2-13.3 8.6c-.5 1.4-1.7.8-1.7-1C17 15.4 23 9.4 32 9.4Z"${f}/><circle cx="32" cy="7.6" r="4.4"${f}/>`;
    case "short":
    default:
      return `<path d="M17 29c-.8-12.6 6.2-19.2 15-19.2S47.8 16.4 47 29c-.2 2.6-1.4 2.4-1.9.4C43.6 22 38.6 18.6 32 18.6S20.4 22 18.9 29.4c-.5 2-1.7 2.2-1.9-.4Z"${f}/>`;
  }
}

function beardSvg(d: PortraitDesign, mix: string): string {
  const f = ` fill="${mix}"`;
  switch (d.beard) {
    case "stubble":
      return `<path d="M20 34c0 10 5.6 16.6 12 16.6S44 44 44 34c0 6-4.6 10.4-12 10.4S20 40 20 34Z" fill="${mix}" opacity="0.35"/>`;
    case "moustache":
      return `<path d="M27.4 38.6c1.6-1.2 3-1.6 4.6-1.6s3 .4 4.6 1.6c-1.2 1.2-2.8 1.8-4.6 1.8s-3.4-.6-4.6-1.8Z"${f}/>`;
    case "goatee":
      return `<path d="M28.6 40.6h6.8c.6 3.4-.8 6.6-3.4 6.6s-4-3.2-3.4-6.6Z"${f}/><path d="M27.6 38.4c1.4-1 2.8-1.4 4.4-1.4s3 .4 4.4 1.4c-1.2 1.1-2.7 1.6-4.4 1.6s-3.2-.5-4.4-1.6Z"${f}/>`;
    case "full":
      return `<path d="M19.6 32c0 12 5.8 19 12.4 19s12.4-7 12.4-19c0 8-5 13.4-12.4 13.4S19.6 40 19.6 32Z"${f}/><path d="M27.4 38.4c1.5-1.1 2.9-1.5 4.6-1.5s3.1.4 4.6 1.5c-1.3 1.2-2.9 1.7-4.6 1.7s-3.3-.5-4.6-1.7Z"${f}/>`;
    case "none":
    default:
      return "";
  }
}

const cache = new Map<string, string>();
const CACHE_MAX = 400;

/**
 * An inline SVG portrait, `size` css px square. Cheap to inline in a long squad list: the markup is
 * cached per person and size, and there is no image to fetch.
 */
export function portraitSvg(src: PortraitSource, size = 34): string {
  const key = `${src.id}|${Math.round(src.age)}|${src.color ?? ""}|${size}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const d = portraitDesign(src);
  const uid = `pt${hash(key).toString(36)}`;
  // grey is mixed into the hair rather than replacing it, so an ageing player keeps his own colour
  const mix = d.grey > 0 ? shade(d.hair, d.grey * 0.75) : d.hair;
  const collar = src.color ?? "#4a5560";
  const collarLine = luminance(collar) > 0.6 ? "rgba(0,0,0,0.25)" : "rgba(255,255,255,0.25)";
  const shadow = shade(d.skin, -0.16);
  const browY = 27 + d.brow;
  const eyeY = browY + 3.6;

  const svg =
    `<svg class="pt" viewBox="0 0 64 64" width="${size}" height="${size}" aria-hidden="true" focusable="false" style="vertical-align:middle;flex:0 0 auto;border-radius:50%;background:#1b2229">` +
    `<defs><clipPath id="${uid}"><circle cx="32" cy="32" r="32"/></clipPath></defs>` +
    `<g clip-path="url(#${uid})">` +
    // shoulders in the club's colour, so a face in a list of other clubs' players reads as theirs
    `<path d="M4 64c0-11.6 11.4-17.4 28-17.4S60 52.4 60 64Z" fill="${collar}"/>` +
    `<path d="M26.4 45.8h11.2v6.2c0 2-2.4 3.4-5.6 3.4s-5.6-1.4-5.6-3.4Z" fill="${shadow}"/>` +
    `<path d="M4 64c0-11.6 11.4-17.4 28-17.4S60 52.4 60 64" fill="none" stroke="${collarLine}" stroke-width="1.4"/>` +
    `<path d="${FACE_PATH[d.face]}" fill="${d.skin}"/>` +
    // ears
    `<ellipse cx="16.6" cy="32" rx="2.4" ry="3.4" fill="${d.skin}"/><ellipse cx="47.4" cy="32" rx="2.4" ry="3.4" fill="${d.skin}"/>` +
    beardSvg(d, mix) +
    // brows, then eyes: two marks are enough to read a face at 28px
    `<rect x="22.6" y="${browY}" width="7.4" height="1.7" rx="0.85" fill="${mix}"/>` +
    `<rect x="34" y="${browY}" width="7.4" height="1.7" rx="0.85" fill="${mix}"/>` +
    `<ellipse cx="26.3" cy="${eyeY + 2}" rx="1.9" ry="${1.5 + d.eye * 0.25}" fill="#221a16"/>` +
    `<ellipse cx="37.7" cy="${eyeY + 2}" rx="1.9" ry="${1.5 + d.eye * 0.25}" fill="#221a16"/>` +
    // nose and mouth, drawn as shadow rather than outline so they stay soft when scaled down
    `<path d="M32 33.6c-1.1 2.6-2 4-2 4.6 0 .8.9 1.2 2 1.2s2-.4 2-1.2c0-.6-.9-2-2-4.6Z" fill="${shadow}" opacity="0.7"/>` +
    `<path d="M28.6 42.6c1 .9 2.1 1.3 3.4 1.3s2.4-.4 3.4-1.3" fill="none" stroke="${shade(d.skin, -0.34)}" stroke-width="1.5" stroke-linecap="round"/>` +
    hairSvg(d, mix) +
    `</g></svg>`;

  if (cache.size >= CACHE_MAX) cache.clear();
  cache.set(key, svg);
  return svg;
}
