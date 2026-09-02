/**
 * Match sound effects synthesised with Web Audio (no audio assets): whistles, crowd roar, "ooh" and boos.
 * Everything is silent until unlock() runs from a user gesture (mobile autoplay rules) and the toggle is on.
 */
const KEY = "3sec.sfx";

export class Sfx {
  private ctx: AudioContext | null = null;
  private noiseBuf: AudioBuffer | null = null;
  enabled = true;

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
  private crowd(dur: number, lp: number, vol: number, atk = 0.08, lpEnd = lp): void {
    const ac = this.ac; if (!ac) return;
    const t0 = ac.currentTime;
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
}
