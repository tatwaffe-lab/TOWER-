/**
 * Audio komplett programmatisch über die WebAudio-API.
 *
 * Es werden bewusst keine externen Musik-/Sounddateien vorausgesetzt: das
 * hielte rechtliche Unklarheiten und fehlende Assets im Spiel. Stattdessen
 * werden alle Klänge aus Oszillatoren und Rauschen synthetisiert — das ist
 * hörbares Feedback ohne eine einzige Fremddatei.
 *
 * Fehlertoleranz: schlägt WebAudio fehl (alte Browser, blockierter Kontext),
 * wird stumm weitergespielt statt das Spiel abstürzen zu lassen.
 */

export type SoundName =
  | "ui-click"
  | "ui-error"
  | "build"
  | "upgrade"
  | "sell"
  | "shot-light"
  | "shot-heavy"
  | "shot-energy"
  | "flame"
  | "explosion"
  | "hit"
  | "enemy-death"
  | "boss-spawn"
  | "boss-phase"
  | "core-damage"
  | "wave-start"
  | "wave-clear"
  | "ability"
  | "ultimate"
  | "send-incoming"
  | "perk"
  | "victory"
  | "defeat";

interface SoundSpec {
  /** Priorität: bei vielen gleichzeitigen Sounds gewinnen hohe Werte. */
  priority: number;
  /** Mindestabstand zwischen zwei Abspielvorgängen in ms (Anti-Matsch). */
  throttleMs: number;
  play(ctx: AudioContext, out: GainNode, now: number): void;
}

function tone(
  ctx: AudioContext,
  out: GainNode,
  now: number,
  opts: {
    type?: OscillatorType;
    from: number;
    to?: number;
    duration: number;
    gain?: number;
    delay?: number;
  }
): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  const start = now + (opts.delay ?? 0);
  osc.type = opts.type ?? "square";
  osc.frequency.setValueAtTime(opts.from, start);
  if (opts.to !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(1, opts.to), start + opts.duration);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(opts.gain ?? 0.25, start + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + opts.duration);
  osc.connect(gain);
  gain.connect(out);
  osc.start(start);
  osc.stop(start + opts.duration + 0.02);
}

function noise(
  ctx: AudioContext,
  out: GainNode,
  now: number,
  opts: { duration: number; gain?: number; filterFrom?: number; filterTo?: number; delay?: number }
): void {
  const start = now + (opts.delay ?? 0);
  const length = Math.max(1, Math.floor(ctx.sampleRate * opts.duration));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;

  const src = ctx.createBufferSource();
  src.buffer = buffer;

  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.setValueAtTime(opts.filterFrom ?? 2000, start);
  if (opts.filterTo !== undefined) {
    filter.frequency.exponentialRampToValueAtTime(Math.max(40, opts.filterTo), start + opts.duration);
  }

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(opts.gain ?? 0.2, start);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + opts.duration);

  src.connect(filter);
  filter.connect(gain);
  gain.connect(out);
  src.start(start);
  src.stop(start + opts.duration + 0.02);
}

const SOUNDS: Record<SoundName, SoundSpec> = {
  "ui-click": {
    priority: 5,
    throttleMs: 40,
    play: (c, o, n) => tone(c, o, n, { type: "square", from: 620, to: 780, duration: 0.05, gain: 0.12 }),
  },
  "ui-error": {
    priority: 8,
    throttleMs: 180,
    play: (c, o, n) => tone(c, o, n, { type: "square", from: 220, to: 120, duration: 0.16, gain: 0.16 }),
  },
  build: {
    priority: 7,
    throttleMs: 60,
    play: (c, o, n) => {
      tone(c, o, n, { type: "square", from: 300, to: 520, duration: 0.09, gain: 0.16 });
      noise(c, o, n, { duration: 0.12, gain: 0.12, filterFrom: 1800, filterTo: 400 });
    },
  },
  upgrade: {
    priority: 7,
    throttleMs: 80,
    play: (c, o, n) => {
      tone(c, o, n, { type: "square", from: 440, to: 660, duration: 0.08, gain: 0.15 });
      tone(c, o, n, { type: "square", from: 660, to: 880, duration: 0.1, gain: 0.13, delay: 0.07 });
    },
  },
  sell: {
    priority: 6,
    throttleMs: 80,
    play: (c, o, n) => tone(c, o, n, { type: "triangle", from: 520, to: 260, duration: 0.14, gain: 0.14 }),
  },
  "shot-light": {
    priority: 1,
    throttleMs: 45,
    play: (c, o, n) => {
      tone(c, o, n, { type: "square", from: 900, to: 420, duration: 0.035, gain: 0.07 });
      noise(c, o, n, { duration: 0.03, gain: 0.05, filterFrom: 3000, filterTo: 900 });
    },
  },
  "shot-heavy": {
    priority: 3,
    throttleMs: 90,
    play: (c, o, n) => {
      tone(c, o, n, { type: "sawtooth", from: 190, to: 60, duration: 0.16, gain: 0.16 });
      noise(c, o, n, { duration: 0.14, gain: 0.14, filterFrom: 1200, filterTo: 200 });
    },
  },
  "shot-energy": {
    priority: 2,
    throttleMs: 70,
    play: (c, o, n) => tone(c, o, n, { type: "sawtooth", from: 1200, to: 300, duration: 0.09, gain: 0.1 }),
  },
  flame: {
    priority: 1,
    throttleMs: 140,
    play: (c, o, n) => noise(c, o, n, { duration: 0.22, gain: 0.08, filterFrom: 900, filterTo: 300 }),
  },
  explosion: {
    priority: 4,
    throttleMs: 70,
    play: (c, o, n) => {
      noise(c, o, n, { duration: 0.32, gain: 0.22, filterFrom: 1400, filterTo: 90 });
      tone(c, o, n, { type: "sine", from: 140, to: 40, duration: 0.3, gain: 0.16 });
    },
  },
  hit: {
    priority: 1,
    throttleMs: 55,
    play: (c, o, n) => noise(c, o, n, { duration: 0.04, gain: 0.06, filterFrom: 2600, filterTo: 800 }),
  },
  "enemy-death": {
    priority: 2,
    throttleMs: 60,
    play: (c, o, n) => {
      tone(c, o, n, { type: "square", from: 300, to: 90, duration: 0.1, gain: 0.1 });
      noise(c, o, n, { duration: 0.1, gain: 0.08, filterFrom: 1600, filterTo: 300 });
    },
  },
  "boss-spawn": {
    priority: 10,
    throttleMs: 1000,
    play: (c, o, n) => {
      tone(c, o, n, { type: "sawtooth", from: 90, to: 45, duration: 0.9, gain: 0.26 });
      tone(c, o, n, { type: "square", from: 180, to: 90, duration: 0.7, gain: 0.14, delay: 0.15 });
      noise(c, o, n, { duration: 0.8, gain: 0.16, filterFrom: 700, filterTo: 120 });
    },
  },
  "boss-phase": {
    priority: 9,
    throttleMs: 500,
    play: (c, o, n) => {
      tone(c, o, n, { type: "sawtooth", from: 260, to: 70, duration: 0.5, gain: 0.22 });
      noise(c, o, n, { duration: 0.4, gain: 0.16, filterFrom: 1600, filterTo: 200 });
    },
  },
  "core-damage": {
    priority: 9,
    throttleMs: 220,
    play: (c, o, n) => {
      tone(c, o, n, { type: "sawtooth", from: 200, to: 60, duration: 0.34, gain: 0.24 });
      noise(c, o, n, { duration: 0.26, gain: 0.16, filterFrom: 900, filterTo: 140 });
    },
  },
  "wave-start": {
    priority: 9,
    throttleMs: 600,
    play: (c, o, n) => {
      tone(c, o, n, { type: "square", from: 330, duration: 0.14, gain: 0.18 });
      tone(c, o, n, { type: "square", from: 440, duration: 0.2, gain: 0.18, delay: 0.14 });
    },
  },
  "wave-clear": {
    priority: 9,
    throttleMs: 600,
    play: (c, o, n) => {
      [523, 659, 784].forEach((f, i) =>
        tone(c, o, n, { type: "square", from: f, duration: 0.16, gain: 0.16, delay: i * 0.1 })
      );
    },
  },
  ability: {
    priority: 8,
    throttleMs: 200,
    play: (c, o, n) => {
      tone(c, o, n, { type: "sine", from: 400, to: 1100, duration: 0.28, gain: 0.2 });
      tone(c, o, n, { type: "square", from: 800, to: 1600, duration: 0.2, gain: 0.1, delay: 0.06 });
    },
  },
  ultimate: {
    priority: 10,
    throttleMs: 400,
    play: (c, o, n) => {
      tone(c, o, n, { type: "sawtooth", from: 200, to: 1400, duration: 0.6, gain: 0.24 });
      noise(c, o, n, { duration: 0.5, gain: 0.14, filterFrom: 600, filterTo: 3000 });
    },
  },
  "send-incoming": {
    priority: 10,
    throttleMs: 500,
    play: (c, o, n) => {
      tone(c, o, n, { type: "square", from: 700, to: 500, duration: 0.14, gain: 0.2 });
      tone(c, o, n, { type: "square", from: 700, to: 500, duration: 0.14, gain: 0.2, delay: 0.18 });
    },
  },
  perk: {
    priority: 9,
    throttleMs: 300,
    play: (c, o, n) => {
      [660, 880, 1320].forEach((f, i) =>
        tone(c, o, n, { type: "triangle", from: f, duration: 0.18, gain: 0.16, delay: i * 0.08 })
      );
    },
  },
  victory: {
    priority: 10,
    throttleMs: 1500,
    play: (c, o, n) => {
      [523, 659, 784, 1047].forEach((f, i) =>
        tone(c, o, n, { type: "square", from: f, duration: 0.28, gain: 0.2, delay: i * 0.16 })
      );
    },
  },
  defeat: {
    priority: 10,
    throttleMs: 1500,
    play: (c, o, n) => {
      [440, 349, 262].forEach((f, i) =>
        tone(c, o, n, { type: "sawtooth", from: f, duration: 0.4, gain: 0.2, delay: i * 0.22 })
      );
    },
  },
};

export class AudioManager {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private musicTimer: number | null = null;
  private lastPlayed = new Map<SoundName, number>();
  private failed = false;

  masterVolume = 0.7;
  sfxEnabled = true;
  musicEnabled = true;

  /** Muss aus einer Nutzergeste heraus aufgerufen werden (Browser-Autoplay). */
  unlock(): void {
    if (this.ctx || this.failed) return;
    try {
      const Ctor: typeof AudioContext =
        window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) {
        this.failed = true;
        return;
      }
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.masterVolume;
      this.master.connect(this.ctx.destination);

      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = 0.16;
      this.musicGain.connect(this.master);
    } catch {
      // Kein Audio verfügbar — das Spiel läuft trotzdem weiter.
      this.failed = true;
    }
  }

  setMasterVolume(value: number): void {
    this.masterVolume = Math.max(0, Math.min(1, value));
    if (this.master) this.master.gain.value = this.masterVolume;
  }

  play(name: SoundName): void {
    if (!this.sfxEnabled || this.failed) return;
    this.unlock();
    if (!this.ctx || !this.master) return;
    if (this.ctx.state === "suspended") void this.ctx.resume().catch(() => undefined);

    const spec = SOUNDS[name];
    if (!spec) return;

    // Anti-Matsch: gleiche Sounds werden gedrosselt, damit große Wellen
    // nicht in einer Klangwand enden (Master Prompt §25).
    const now = performance.now();
    const last = this.lastPlayed.get(name) ?? -Infinity;
    if (now - last < spec.throttleMs) return;
    this.lastPlayed.set(name, now);

    try {
      spec.play(this.ctx, this.master, this.ctx.currentTime);
    } catch {
      // Einzelner fehlgeschlagener Sound darf nichts weiter beeinflussen.
    }
  }

  /**
   * Sehr schlichte generative Hintergrundmusik: eine langsame Basslinie mit
   * gelegentlichen Akzenten. Erzeugt Atmosphäre, ohne eine Musikdatei zu
   * brauchen.
   */
  startMusic(): void {
    if (!this.musicEnabled || this.failed || this.musicTimer !== null) return;
    this.unlock();
    if (!this.ctx || !this.musicGain) return;

    const scale = [110, 130.81, 146.83, 164.81, 196, 220];
    let step = 0;
    this.musicTimer = window.setInterval(() => {
      if (!this.ctx || !this.musicGain || !this.musicEnabled) return;
      if (this.ctx.state === "suspended") return;
      const now = this.ctx.currentTime;
      const root = scale[step % scale.length];
      tone(this.ctx, this.musicGain, now, { type: "triangle", from: root, duration: 1.6, gain: 0.18 });
      if (step % 4 === 2) {
        tone(this.ctx, this.musicGain, now, { type: "sine", from: root * 3, duration: 0.9, gain: 0.07, delay: 0.4 });
      }
      step++;
    }, 1700);
  }

  stopMusic(): void {
    if (this.musicTimer !== null) {
      window.clearInterval(this.musicTimer);
      this.musicTimer = null;
    }
  }

  setMusicEnabled(enabled: boolean): void {
    this.musicEnabled = enabled;
    if (enabled) this.startMusic();
    else this.stopMusic();
  }
}

export const audio = new AudioManager();
