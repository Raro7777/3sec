/**
 * "What did my change actually do?"
 *
 * The tactics sliders genuinely drive the simulation — raising pressing measurably raises tackles,
 * widening the shape measurably spreads the players out — but the game never told the manager so, and
 * a slider whose effect you cannot see is indistinguishable from one that does nothing.
 *
 * This records a snapshot of the user's tactics and both sides' stats once a match minute, and after
 * full time turns it into a short before/after readout for each change the manager made. Nothing is
 * added to the engine: the sampling is passive, and everything below is arithmetic on stats the match
 * already keeps.
 *
 * A caveat the wording has to carry: this is what happened after a change, not proof the change
 * caused it. The opponent adjusts too, the scoreline drives both sides' behaviour, and ten minutes of
 * football is a small sample. The report says "이후" ("after"), never "때문에" ("because of").
 */
import type { Match, Tactics, TeamId, TeamStats } from "@3sec/engine";


/** A window shorter than this is too little football to say anything about. */
export const MIN_WINDOW_MINUTES = 8;

/** The slider values worth reporting a change in, and what to call them. */
const WATCHED: { key: keyof Tactics; label: string }[] = [
  { key: "mentality", label: "멘탈리티" },
  { key: "defensiveLine", label: "수비 라인" },
  { key: "pressing", label: "압박" },
  { key: "directness", label: "직접성" },
  { key: "width", label: "폭" },
  { key: "tempo", label: "템포" },
  { key: "counter", label: "역습" },
  { key: "engageLine", label: "압박 시작선" },
];

interface Sample {
  minute: number;
  formation: string;
  sliders: number[];
  trap: boolean;
  mine: TeamStats;
  theirs: TeamStats;
}

/** One measure, before and after, already normalised for the length of its window. */
export interface ReportLine {
  label: string;
  before: number;
  after: number;
  /** how to print the numbers */
  format: "rate" | "percent" | "decimal";
  /** which direction is the manager's side doing better in */
  good: "up" | "down";
}

export interface TacticsChange {
  minute: number;
  /** "압박 0.5 → 0.9" style descriptions of everything that moved at once */
  labels: string[];
  beforeMinutes: number;
  afterMinutes: number;
  lines: ReportLine[];
}

export interface TacticsReport {
  changes: TacticsChange[];
  /** changes that happened too close to the whistle (or to each other) to measure */
  unmeasured: number;
}

/** Sum of a stat over a window, per ten minutes of it. */
const per10 = (delta: number, minutes: number): number => (minutes > 0 ? (delta * 10) / minutes : 0);

export class TacticsRecorder {
  private samples: Sample[] = [];
  private lastMinute = -1;

  constructor(private readonly match: Match, private readonly userTeam: TeamId) {
    this.sample();
  }

  /**
   * Take a snapshot if the match clock has entered a new minute. Cheap enough to call from the step
   * loop: it copies two small stat objects at most once a minute of match time.
   */
  sample(): void {
    const s = this.match.state;
    // The match clock, not the tick count: a change made at 24' must be reported at 24', and the two
    // diverge because ticks keep running through stoppages, restarts and the half-time break.
    const minute = Math.floor(this.match.matchSeconds() / 60);
    if (minute === this.lastMinute) return;
    this.lastMinute = minute;
    const t = this.match.teams[this.userTeam].tactics;
    const them: TeamId = this.userTeam === 0 ? 1 : 0;
    this.samples.push({
      minute,
      formation: t.formation,
      sliders: WATCHED.map(({ key }) => Number(t[key] ?? 0)),
      trap: !!t.offsideTrap,
      mine: { ...s.stats[this.userTeam] },
      theirs: { ...s.stats[them] },
    });
  }

  /** The finished report, or null when the manager changed nothing worth measuring. */
  report(): TacticsReport | null {
    this.sample();
    if (this.samples.length < 2) return null;

    // Every minute at which something the manager controls changed.
    const marks: { index: number; atMinute: number; labels: string[] }[] = [];
    for (let i = 1; i < this.samples.length; i++) {
      const a = this.samples[i - 1]!, b = this.samples[i]!;
      const labels: string[] = [];
      if (a.formation !== b.formation) labels.push(`포메이션 ${a.formation} → ${b.formation}`);
      WATCHED.forEach(({ label }, k) => {
        const from = a.sliders[k]!, to = b.sliders[k]!;
        // ignore the rounding dust a normalised slider can pick up
        if (Math.abs(to - from) < 0.02) return;
        labels.push(`${label} ${from.toFixed(2)} → ${to.toFixed(2)} ${to > from ? "↑" : "↓"}`);
      });
      if (a.trap !== b.trap) labels.push(`오프사이드 트랩 ${b.trap ? "켬" : "끔"}`);
      // labelled with the minute the manager was still on the old setting, which is when they moved it
      if (labels.length) marks.push({ index: i, atMinute: a.minute, labels });
    }
    if (!marks.length) return null;

    const first = this.samples[0]!;
    const last = this.samples[this.samples.length - 1]!;
    const changes: TacticsChange[] = [];
    let unmeasured = 0;

    marks.forEach((mark, n) => {
      // The window before runs back to the previous change, the one after runs on to the next.
      const start = n === 0 ? first : this.samples[marks[n - 1]!.index]!;
      const mid = this.samples[mark.index]!;
      const end = n === marks.length - 1 ? last : this.samples[marks[n + 1]!.index]!;
      const beforeMinutes = mid.minute - start.minute;
      const afterMinutes = end.minute - mid.minute;
      if (beforeMinutes < MIN_WINDOW_MINUTES || afterMinutes < MIN_WINDOW_MINUTES) { unmeasured++; return; }

      const d = (from: Sample, to: Sample, side: "mine" | "theirs", key: keyof TeamStats) => to[side][key] - from[side][key];
      const ratio = (from: Sample, to: Sample, num: keyof TeamStats, den: keyof TeamStats) => {
        const bottom = d(from, to, "mine", den);
        return bottom > 0 ? d(from, to, "mine", num) / bottom : 0;
      };

      const lines: ReportLine[] = [
        { label: "내 슈팅", format: "rate", good: "up", before: per10(d(start, mid, "mine", "shots"), beforeMinutes), after: per10(d(mid, end, "mine", "shots"), afterMinutes) },
        { label: "내 xG", format: "decimal", good: "up", before: per10(d(start, mid, "mine", "xg"), beforeMinutes), after: per10(d(mid, end, "mine", "xg"), afterMinutes) },
        { label: "태클", format: "rate", good: "up", before: per10(d(start, mid, "mine", "tackles"), beforeMinutes), after: per10(d(mid, end, "mine", "tackles"), afterMinutes) },
        { label: "상대 슈팅", format: "rate", good: "down", before: per10(d(start, mid, "theirs", "shots"), beforeMinutes), after: per10(d(mid, end, "theirs", "shots"), afterMinutes) },
        { label: "패스 성공률", format: "percent", good: "up", before: ratio(start, mid, "passesCompleted", "passes"), after: ratio(mid, end, "passesCompleted", "passes") },
      ];

      changes.push({ minute: mark.atMinute, labels: mark.labels, beforeMinutes, afterMinutes, lines });
    });

    return changes.length || unmeasured ? { changes, unmeasured } : null;
  }
}

/** How much a line moved, as a share of the before value (0 when there was nothing to move from). */
export function lineSwing(l: ReportLine): number {
  if (l.before === 0) return l.after === 0 ? 0 : 1;
  return (l.after - l.before) / Math.abs(l.before);
}

export function formatValue(l: ReportLine, v: number): string {
  return l.format === "percent" ? `${(v * 100).toFixed(0)}%` : l.format === "decimal" ? v.toFixed(2) : v.toFixed(1);
}
