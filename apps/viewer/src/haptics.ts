/**
 * Match haptics: short vibration patterns for the moments that matter (goals, cards, penalties,
 * the final whistle). Inside the packaged Android app this goes through the Capacitor Haptics
 * plugin; in a plain browser it falls back to navigator.vibrate, and where neither exists it is a
 * silent no-op. Kept deliberately sparse — a phone that buzzes constantly is worse than a quiet one.
 */
import { isNativeApp } from "./share";

const KEY = "3sec.haptics";

type Style = "light" | "medium" | "heavy";
type Plugin = {
  Haptics: {
    impact: (o: { style: unknown }) => Promise<void>;
    notification: (o: { type: unknown }) => Promise<void>;
    vibrate: (o: { duration: number }) => Promise<void>;
  };
  ImpactStyle: Record<string, unknown>;
  NotificationType: Record<string, unknown>;
};

export class Haptics {
  enabled: boolean;
  private readonly native = isNativeApp();
  private plugin: Promise<Plugin | null> | null = null;

  constructor() {
    try { this.enabled = localStorage.getItem(KEY) !== "0"; } catch { this.enabled = true; }
  }

  /** Is any vibration mechanism available at all? (Hides the toggle's promise on a desktop browser.) */
  get supported(): boolean {
    return this.native || typeof navigator !== "undefined" && typeof navigator.vibrate === "function";
  }

  setEnabled(v: boolean): void {
    this.enabled = v;
    try { localStorage.setItem(KEY, v ? "1" : "0"); } catch { /* private mode */ }
  }

  /** The user's side scored: a celebratory triple pulse. */
  goalFor(): void { this.fire([0, 55, 45, 55, 45, 130], ["heavy", "heavy", "medium"]); }
  /** Conceded: one duller buzz, no fanfare. */
  goalAgainst(): void { this.fire([200], "buzz"); }
  /** Red card: two firm knocks. */
  redCard(): void { this.fire([110, 70, 110], ["heavy", "heavy"]); }
  /** Penalty awarded: a rising two-part buzz, distinct from the red card. */
  penalty(): void { this.fire([40, 60, 180], ["medium", "heavy"]); }
  /** Yellow card: a light tick. */
  yellowCard(): void { this.fire([18], ["light"]); }
  /** Full time: one medium pulse. */
  fullTime(): void { this.fire([90], ["medium"]); }

  /**
   * Play one pattern. `web` is a navigator.vibrate pattern (ms on/off/on…); `nativeSpec` is either
   * "buzz" (a plain timed vibration) or a list of impact styles played ~110 ms apart.
   */
  private fire(web: number[], nativeSpec: Style[] | "buzz"): void {
    if (!this.enabled) return;
    if (this.native) { void this.fireNative(web, nativeSpec); return; }
    try { navigator.vibrate?.(web); } catch { /* blocked or unsupported */ }
  }

  private async fireNative(web: number[], spec: Style[] | "buzz"): Promise<void> {
    const p = await this.load();
    if (!p) return;
    try {
      if (spec === "buzz") { await p.Haptics.vibrate({ duration: web[0] ?? 150 }); return; }
      for (let i = 0; i < spec.length; i++) {
        const style = p.ImpactStyle[spec[i] === "light" ? "Light" : spec[i] === "medium" ? "Medium" : "Heavy"];
        if (i > 0) await new Promise((r) => setTimeout(r, 110));
        await p.Haptics.impact({ style });
      }
    } catch { /* device without a vibrator, or the plugin is unavailable */ }
  }

  private load(): Promise<Plugin | null> {
    this.plugin ??= import("@capacitor/haptics").then((m) => m as unknown as Plugin).catch(() => null);
    return this.plugin;
  }
}
