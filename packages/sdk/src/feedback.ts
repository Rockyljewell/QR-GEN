export interface FeedbackOptions {
  beep?: boolean;
  vibrate?: boolean;
  /** Tone frequency in Hz. Default 2100. */
  frequency?: number;
  /** Tone length in ms. Default 90. */
  duration?: number;
  /** 0..1. Default 0.12. */
  volume?: number;
}

type AudioCtor = typeof AudioContext;

/** Scan feedback: a short tone (Web Audio) and a vibration (Vibration API). */
export class Feedback {
  private ctx: AudioContext | null = null;

  constructor(public options: FeedbackOptions = {}) {}

  /** Create/resume the audio context. Call from a user gesture (tap on "Start") on iOS. */
  unlock(): void {
    if (this.options.beep === false) return;
    try {
      const Ctor: AudioCtor | undefined =
        (globalThis as { AudioContext?: AudioCtor }).AudioContext ?? (globalThis as { webkitAudioContext?: AudioCtor }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx ??= new Ctor();
      if (this.ctx.state === "suspended") void this.ctx.resume();
    } catch {
      this.ctx = null;
    }
  }

  beep(): void {
    if (this.options.beep === false) return;
    this.unlock();
    const ctx = this.ctx;
    if (!ctx || ctx.state !== "running") return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "square";
    osc.frequency.value = this.options.frequency ?? 2100;
    const vol = this.options.volume ?? 0.12;
    const dur = (this.options.duration ?? 90) / 1000;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(vol, t + 0.005);
    gain.gain.setValueAtTime(vol, t + dur - 0.01);
    gain.gain.linearRampToValueAtTime(0, t + dur);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  vibrate(pattern: number | number[] = 40): void {
    if (this.options.vibrate === false) return;
    try {
      (navigator as Navigator & { vibrate?: (p: number | number[]) => boolean }).vibrate?.(pattern);
    } catch {
      // ignore
    }
  }

  /** Play the configured feedback for a successful scan. */
  success(): void {
    this.beep();
    this.vibrate();
  }

  dispose(): void {
    void this.ctx?.close().catch(() => undefined);
    this.ctx = null;
  }
}
