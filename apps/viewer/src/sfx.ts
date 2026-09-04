/**
 * Match sound effects synthesised with Web Audio (no audio assets): whistles, crowd roar, "ooh" and boos,
 * plus a continuous ambient crowd bed that breathes with the live danger score.
 * Everything is silent until unlock() runs from a user gesture (mobile autoplay rules) and the toggle is on.
 */
const KEY = "3sec.sfx";

/** Ambient bed: gain of the low murmur layer at danger 0 and at danger 1 (before the crowd-size scale). */
const AMB_GAIN_LOW = 0.03;
const AMB_GAIN_HIGH = 0.12;
/** Ambient bed: murmur low-pass cutoff (Hz) at danger 0 and 1 — the crowd "opens up" as an attack builds. */
const AMB_LP_LOW = 380;
const AMB_LP_HIGH = 1400;
/** Ambient bed: relative level of the bright (terrace hiss) layer at danger 0 and 1. */
const AMB_AIR_LOW = 0.1;
const AMB_AIR_HIGH = 0.55;
/** Smoothing time constant (s) for every ambient parameter — a few hundred ms, so nothing clicks or pumps. */
const AMB_TAU = 0.22;
/** Fade in / out of the whole bed (s). */
const AMB_FADE = 0.5;
/** Minimum gap between ball-kick ticks (ms) so they never machine-gun. */
const TICK_MIN_MS = 90;

/** The long-lived ambient graph: one looping noise source feeding two filtered layers into one gain. */
interface Ambient {
  src: AudioBufferSourceNode;
  lp: BiquadFilterNode;
  air: BiquadFilterNode;
  hi: GainNode;
  out: GainNode;
}

/** The long-lived ball-tick graph: a looping noise source gated by an envelope on `g` (no nodes per tick). */
interface Ticker {
  src: AudioBufferSourceNode;
  f: BiquadFilterNode;
  g: GainNode;
}

export class Sfx {
  private ctx: AudioContext | null = null;
  private noiseBuf: AudioBuffer | null = null;
  enabled = true;
  /** 0..1 crowd size: scales every crowd sound (roar/ooh/boo/clap/chant); whistles are unaffected */
  private crowdLevel = 1;
  private amb: Ambient | null = null;
  /** the match wants the bed running (it is built lazily once the context is unlocked) */
  private ambWanted = false;
  /** last danger value pushed into the bed, and when — used to skip redundant param scheduling */
  private ambDanger = 0;
  private ambAt = 0;
  private ticker: Ticker | null = null;
  private lastTick = 0;

  /** How full the ground is (0..1); a derby or a sell-out pushes it toward 1. */
  setCrowd(level: number): void { this.crowdLevel = Math.max(0, Math.min(1, level)); }
  get crowdVolume(): number { return this.crowdLevel; }

  constructor() {
    try { this.enabled = localStorage.getItem(KEY) !== "0"; } catch { this.enabled = true; }
  }

  /** Create/resume the audio context; call from a click or touch handler. */
  unlock(): void {
    if (!this.ctx) {
      try {
        const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (AC) this.ctx = new AC();
      } catch { this.ctx = null; }
    }
    if (this.ctx?.state === "suspended") void this.ctx.resume();
  }

  setEnabled(v: boolean): void {
    this.enabled = v;
    try { localStorage.setItem(KEY, v ? "1" : "0"); } catch { /* private mode */ }
    if (v) this.unlock();
    else this.teardownAmbient(0);
  }

  private get ac(): AudioContext | null {
    return this.enabled && this.ctx && this.ctx.state === "running" ? this.ctx : null;
  }

  private noise(ac: AudioContext): AudioBuffer {
    if (this.noiseBuf && this.noiseBuf.sampleRate === ac.sampleRate) return this.noiseBuf;
    const len = ac.sampleRate * 3;
    const buf = ac.createBuffer(1, len, ac.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; last = (last + 0.02 * w) / 1.02; d[i] = (w * 0.4 + last * 3) * 0.6; } // pinkish
    this.noiseBuf = buf;
    return buf;
  }

  /** Referee's whistle: n blasts of `len` seconds. */
  whistle(n = 1, len = 0.4, gap = 0.12, vol = 0.18): void {
    const ac = this.ac; if (!ac) return;
    for (let i = 0; i < n; i++) {
      const t0 = ac.currentTime + i * (len + gap);
      const g = ac.createGain();
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(vol, t0 + 0.02);
      g.gain.setValueAtTime(vol, t0 + len - 0.05);
      g.gain.linearRampToValueAtTime(0, t0 + len);
      g.connect(ac.destination);
      for (const f of [2750, 3110]) {
        const o = ac.createOscillator();
        o.type = "square";
        o.frequency.setValueAtTime(f, t0);
        const lfo = ac.createOscillator(); lfo.frequency.value = 38;
        const lg = ac.createGain(); lg.gain.value = 55;
        lfo.connect(lg); lg.connect(o.frequency);
        const og = ac.createGain(); og.gain.value = 0.5;
        o.connect(og); og.connect(g);
        o.start(t0); o.stop(t0 + len + 0.02); lfo.start(t0); lfo.stop(t0 + len + 0.02);
      }
    }
  }

  /** Crowd noise burst: `dur` seconds, low-pass at `lp` Hz, peak `vol`, attack `atk` seconds. */
  private crowd(dur: number, lp: number, vol: number, atk = 0.08, lpEnd = lp, delay = 0): void {
    const ac = this.ac; if (!ac) return;
    // a quarter-full ground is still audible; a full one is loud
    vol *= 0.35 + 0.65 * this.crowdLevel;
    const t0 = ac.currentTime + delay;
    const src = ac.createBufferSource();
    src.buffer = this.noise(ac);
    src.loop = true;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ac.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.setValueAtTime(lp, t0);
    f.frequency.exponentialRampToValueAtTime(Math.max(80, lpEnd), t0 + dur);
    f.Q.value = 0.7;
    const g = ac.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + atk);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    src.connect(f); f.connect(g); g.connect(ac.destination);
    src.start(t0); src.stop(t0 + dur + 0.05);
  }

  /** Goal: a big roar that keeps rolling. */
  roar(): void { this.crowd(3.2, 1800, 0.55, 0.12, 500); this.crowd(1.2, 4000, 0.25, 0.05, 1500); }
  /** Near miss or a big save. */
  ooh(): void { this.crowd(0.9, 1200, 0.28, 0.15, 300); }
  /** The home crowd's displeasure (red card, own goal). */
  boo(): void {
    this.crowd(1.6, 500, 0.35, 0.2, 250);
    const ac = this.ac; if (!ac) return;
    const t0 = ac.currentTime;
    for (const f of [98, 123, 147]) {
      const o = ac.createOscillator(); o.type = "sawtooth"; o.frequency.setValueAtTime(f, t0); o.frequency.linearRampToValueAtTime(f * 0.9, t0 + 1.4);
      const g = ac.createGain(); g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(0.05, t0 + 0.25); g.gain.exponentialRampToValueAtTime(0.001, t0 + 1.5);
      o.connect(g); g.connect(ac.destination); o.start(t0); o.stop(t0 + 1.6);
    }
  }
  /** Applause murmur (substitution, full time). */
  clap(): void { this.crowd(1.4, 3000, 0.18, 0.2, 1500); }

  /**
   * Terrace chant after a goal: four clap beats (♩ ♩ ♩♩ ♩ at ~120 bpm) over a low crowd hum,
   * `strength` 1 for the home end, less for the travelling fans. Starts after `delay` seconds.
   */
  chant(strength = 1, delay = 0.9): void {
    const ac = this.ac; if (!ac) return;
    const k = strength * (0.35 + 0.65 * this.crowdLevel);
    const beats = [0, 0.5, 1.0, 1.25, 1.5, 2.0, 2.5, 2.75, 3.0];
    this.crowd(3.8, 700, 0.16 * strength, 0.4, 400, delay);
    for (const b of beats) {
      const t0 = ac.currentTime + delay + b;
      const src = ac.createBufferSource();
      src.buffer = this.noise(ac);
      src.playbackRate.value = 1.3 + Math.random() * 0.3;
      const f = ac.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = 2200; f.Q.value = 0.8;
      const g = ac.createGain();
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(0.32 * k, t0 + 0.012);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.14);
      src.connect(f); f.connect(g); g.connect(ac.destination);
      src.start(t0); src.stop(t0 + 0.2);
    }
  }

  // ── ambient stadium bed ────────────────────────────────────────────────────
  // A single looping noise buffer feeds two filtered layers (a low murmur and a bright terrace
  // "air") into one output gain — five long-lived nodes for the whole match, no allocation per tick.
  // ambient(danger) only nudges AudioParams with setTargetAtTime, so the changes are smooth.

  /** Start the crowd bed (kick-off / resume). Safe to call repeatedly; silent until the context is unlocked. */
  startAmbient(): void {
    this.ambWanted = true;
    this.ensureAmbient();
  }

  /** Stop the crowd bed (pause, full time, leaving the screen); fades out before the nodes are dropped. */
  stopAmbient(): void {
    this.ambWanted = false;
    this.teardownAmbient(AMB_FADE);
  }

  /**
   * Push the live 0..1 danger score into the bed: louder and brighter as an attack builds, settling
   * back in midfield. Cheap to call every frame — parameter writes are throttled and smoothed.
   */
  ambient(danger: number): void {
    if (!this.ambWanted) return;
    const a = this.ensureAmbient();
    if (!a) return;
    const ac = this.ac!;
    const d = Math.max(0, Math.min(1, danger));
    const now = ac.currentTime;
    // skip redundant scheduling: only when the score moved meaningfully or ~150 ms have passed
    if (Math.abs(d - this.ambDanger) < 0.03 && now - this.ambAt < 0.15) return;
    this.ambDanger = d;
    this.ambAt = now;
    const scale = 0.35 + 0.65 * this.crowdLevel;
    a.out.gain.setTargetAtTime((AMB_GAIN_LOW + (AMB_GAIN_HIGH - AMB_GAIN_LOW) * d) * scale, now, AMB_TAU);
    a.lp.frequency.setTargetAtTime(AMB_LP_LOW + (AMB_LP_HIGH - AMB_LP_LOW) * d, now, AMB_TAU);
    a.hi.gain.setTargetAtTime(AMB_AIR_LOW + (AMB_AIR_HIGH - AMB_AIR_LOW) * d, now, AMB_TAU);
  }

  /** Build the bed if the context is live and the toggle is on; returns null while it cannot play yet. */
  private ensureAmbient(): Ambient | null {
    if (this.amb) return this.amb;
    const ac = this.ac;
    if (!ac || !this.ambWanted) return null;
    const src = ac.createBufferSource();
    src.buffer = this.noise(ac);
    src.loop = true;
    src.playbackRate.value = 0.85;
    const lp = ac.createBiquadFilter();
    lp.type = "lowpass"; lp.frequency.value = AMB_LP_LOW; lp.Q.value = 0.5;
    const air = ac.createBiquadFilter();
    air.type = "bandpass"; air.frequency.value = 2400; air.Q.value = 0.4;
    const hi = ac.createGain(); hi.gain.value = AMB_AIR_LOW;
    const out = ac.createGain();
    out.gain.setValueAtTime(0, ac.currentTime);
    out.gain.linearRampToValueAtTime(AMB_GAIN_LOW * (0.35 + 0.65 * this.crowdLevel), ac.currentTime + AMB_FADE);
    src.connect(lp); lp.connect(out);
    src.connect(air); air.connect(hi); hi.connect(out);
    out.connect(ac.destination);
    src.start();
    this.ambDanger = 0;
    this.ambAt = 0;
    this.amb = { src, lp, air, hi, out };
    return this.amb;
  }

  /** Fade the bed out over `fade` seconds and free every node. */
  private teardownAmbient(fade: number): void {
    const t = this.ticker;
    if (t) {
      this.ticker = null;
      try { t.src.stop(); } catch { /* already stopped */ }
      for (const n of [t.src, t.f, t.g]) { try { n.disconnect(); } catch { /* gone */ } }
    }
    const a = this.amb;
    if (!a) return;
    this.amb = null;
    const ac = this.ctx;
    try {
      if (ac && fade > 0) {
        const now = ac.currentTime;
        a.out.gain.cancelScheduledValues(now);
        a.out.gain.setValueAtTime(a.out.gain.value, now);
        a.out.gain.linearRampToValueAtTime(0, now + fade);
        a.src.stop(now + fade + 0.05);
      } else {
        a.src.stop();
      }
    } catch { /* already stopped */ }
    const drop = (): void => { for (const n of [a.src, a.lp, a.air, a.hi, a.out]) { try { n.disconnect(); } catch { /* gone */ } } };
    if (fade > 0) setTimeout(drop, (fade + 0.1) * 1000); else drop();
  }

  // ── ball ticks ─────────────────────────────────────────────────────────────

  /**
   * A short, quiet transient for a pass / shot / clearance so the pitch feels alive. One long-lived
   * looping source is gated by an envelope, so a tick allocates nothing; ticks closer together than
   * TICK_MIN_MS are dropped (the caller also skips them entirely at high sim speeds).
   */
  kick(vol = 1): void {
    const ac = this.ac; if (!ac) return;
    const now = performance.now();
    if (now - this.lastTick < TICK_MIN_MS) return;
    this.lastTick = now;
    let t = this.ticker;
    if (!t) {
      const src = ac.createBufferSource();
      src.buffer = this.noise(ac);
      src.loop = true;
      src.playbackRate.value = 2.4;
      const f = ac.createBiquadFilter();
      f.type = "bandpass"; f.frequency.value = 1500; f.Q.value = 1.1;
      const g = ac.createGain(); g.gain.value = 0;
      src.connect(f); f.connect(g); g.connect(ac.destination);
      src.start();
      t = this.ticker = { src, f, g };
    }
    const t0 = ac.currentTime;
    const peak = 0.05 * vol;
    t.f.frequency.setValueAtTime(1200 + Math.random() * 700, t0);
    t.g.gain.cancelScheduledValues(t0);
    t.g.gain.setValueAtTime(0, t0);
    t.g.gain.linearRampToValueAtTime(peak, t0 + 0.004);
    t.g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.07);
    t.g.gain.setValueAtTime(0, t0 + 0.08);
  }
}
