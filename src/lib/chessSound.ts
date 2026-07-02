/**
 * chessSound.ts — premium chess sound synthesizer.
 *
 * This is a faithful port of the original Grandmaster's Arena `ChessSound`
 * object (from public/index.html). It uses the Web Audio API to synthesize
 * a warm, professional "tock" — layered: soft noise burst (impact) + sine
 * body (resonance) + triangle sub (depth), routed through a lowpass filter
 * for woody warmth. Tuned to sound like a fine staunton piece on a walnut
 * board — not harsh or digital.
 *
 * All functions are safe to call from the client only (this module
 * accesses `window` lazily inside functions).
 */

type SoundType =
  | "move" | "capture" | "castle" | "check" | "promote"
  | "game-end" | "illegal" | "select" | "victory" | "defeat";

let audioCtx: AudioContext | null = null;
let muted = false;

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (muted) return null;
  if (!audioCtx) {
    try {
      const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      audioCtx = new Ctor();
    } catch {
      return null;
    }
  }
  if (audioCtx.state === "suspended") {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

/** Set the global mute state. */
export function setMuted(value: boolean) {
  muted = value;
}

/** Get the current mute state. */
export function isMuted(): boolean {
  return muted;
}

/**
 * Core "tock" synthesizer — the heart of the original sound design.
 * Layered: filtered noise burst (impact) + sine body (resonance) + triangle
 * sub (thump), all through a lowpass filter for warmth.
 */
function playTock(opts: {
  freq?: number;
  decay?: number;
  noiseDecay?: number;
  gain?: number;
  filterFreq?: number;
  filterQ?: number;
}) {
  const ctx = getCtx();
  if (!ctx) return;
  try {
    const t = ctx.currentTime;
    const freq = opts.freq ?? 220;
    const decay = opts.decay ?? 0.08;
    const noiseDecay = opts.noiseDecay ?? 0.04;
    const gain = opts.gain ?? 0.3;
    const filterFreq = opts.filterFreq ?? 1200;
    const filterQ = opts.filterQ ?? 2;

    // Master gain + lowpass for woody warmth (gentler rolloff for a softer sound)
    const master = ctx.createGain();
    master.gain.setValueAtTime(gain, t);
    master.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(filterFreq, t);
    lp.Q.setValueAtTime(filterQ, t);
    lp.connect(master);
    master.connect(ctx.destination);

    // Layer 1: Filtered noise burst — the soft "knock" impact
    // (gentler cubic envelope, lower noise gain)
    const noiseBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * noiseDecay), ctx.sampleRate);
    const noiseData = noiseBuf.getChannelData(0);
    for (let i = 0; i < noiseData.length; i++) {
      noiseData[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / noiseData.length, 3);
    }
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuf;
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.4, t);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, t + noiseDecay);
    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = "bandpass";
    noiseFilter.frequency.setValueAtTime(freq * 1.8, t);
    noiseFilter.Q.setValueAtTime(1.2, t);
    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(lp);

    // Layer 2: Sine body — the woody resonance (pitch drops on impact)
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq * 1.3, t);
    osc.frequency.exponentialRampToValueAtTime(freq, t + 0.02);
    const oscGain = ctx.createGain();
    oscGain.gain.setValueAtTime(0.6, t);
    oscGain.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    osc.connect(oscGain);
    oscGain.connect(lp);

    // Layer 3: Triangle sub — adds depth/thump
    const sub = ctx.createOscillator();
    sub.type = "triangle";
    sub.frequency.setValueAtTime(freq * 0.5, t);
    sub.frequency.exponentialRampToValueAtTime(freq * 0.4, t + 0.025);
    const subGain = ctx.createGain();
    subGain.gain.setValueAtTime(0.3, t);
    subGain.gain.exponentialRampToValueAtTime(0.0001, t + decay * 1.5);
    sub.connect(subGain);
    subGain.connect(lp);

    noise.start(t);
    noise.stop(t + noiseDecay);
    osc.start(t);
    osc.stop(t + decay);
    sub.start(t);
    sub.stop(t + decay * 1.5);
  } catch (e) {
    console.warn("Audio play failed", e);
  }
}

/** Soft ascending C-major arpeggio (warm sine waves) — plays on victory. */
function playVictory() {
  const ctx = getCtx();
  if (!ctx) return;
  try {
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(2000, ctx.currentTime);
    lp.Q.setValueAtTime(1, ctx.currentTime);
    lp.connect(ctx.destination);
    [261.63, 329.63, 392, 523.25].forEach((freq, i) => {
      const r = ctx.createOscillator();
      const g = ctx.createGain();
      r.type = "sine";
      r.frequency.setValueAtTime(freq, ctx.currentTime + i * 0.12);
      g.gain.setValueAtTime(0, ctx.currentTime);
      g.gain.linearRampToValueAtTime(0.07, ctx.currentTime + i * 0.12 + 0.06);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * 0.12 + 0.9);
      r.connect(g);
      g.connect(lp);
      r.start(ctx.currentTime + i * 0.12);
      r.stop(ctx.currentTime + i * 0.12 + 1);
    });
  } catch (e) {
    console.warn("Audio play failed", e);
  }
}

/** Soft descending arpeggio (warm triangle waves) — plays on defeat. */
function playDefeat() {
  const ctx = getCtx();
  if (!ctx) return;
  try {
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(1200, ctx.currentTime);
    lp.Q.setValueAtTime(1, ctx.currentTime);
    lp.connect(ctx.destination);
    [311.13, 293.66, 261.63, 196].forEach((freq, i) => {
      const r = ctx.createOscillator();
      const g = ctx.createGain();
      r.type = "triangle";
      r.frequency.setValueAtTime(freq, ctx.currentTime + i * 0.14);
      g.gain.setValueAtTime(0, ctx.currentTime);
      g.gain.linearRampToValueAtTime(0.07, ctx.currentTime + i * 0.14 + 0.07);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * 0.14 + 0.9);
      r.connect(g);
      g.connect(lp);
      r.start(ctx.currentTime + i * 0.14);
      r.stop(ctx.currentTime + i * 0.14 + 1);
    });
  } catch (e) {
    console.warn("Audio play failed", e);
  }
}

/**
 * Play a sound for the given event.
 *
 * Maps the generic `SoundType` to the original's specific sound functions:
 *  - move    → warm "tock" (medium pitch, short decay)
 *  - capture → heavier "thud" + scrape (lower pitch, longer decay, more noise)
 *  - check   → soft alert "knock-knock" (two quick rising tocks)
 *  - castle  → two tocks in quick succession
 *  - promote → ascending arpeggio (reuses victory sound, shorter)
 *  - victory / game-end (win)  → playVictory
 *  - defeat                   → playDefeat
 *  - illegal → low buzz (descending tock)
 *  - select  → very soft, short tick
 */
export function playSound(type: SoundType) {
  switch (type) {
    case "select":
      // Very soft, short tick — barely audible, just a tactile confirmation.
      playTock({ freq: 880, decay: 0.04, noiseDecay: 0.02, gain: 0.08, filterFreq: 2500, filterQ: 2 });
      break;
    case "move":
      // Warm "tock" — medium pitch, short decay. Like a staunton piece on walnut.
      playTock({ freq: 220, decay: 0.10, noiseDecay: 0.04, gain: 0.28, filterFreq: 1200, filterQ: 2 });
      break;
    case "capture":
      // Heavier "thud" + scrape — lower pitch, longer decay, more noise.
      playTock({ freq: 150, decay: 0.16, noiseDecay: 0.07, gain: 0.36, filterFreq: 800, filterQ: 1.8 });
      // Secondary scrape sound (filtered noise, lower band) after 20ms
      playScrape();
      break;
    case "castle":
      // Two tocks in quick succession (king + rook landing).
      playTock({ freq: 220, decay: 0.09, noiseDecay: 0.035, gain: 0.26, filterFreq: 1200, filterQ: 2 });
      setTimeout(() => {
        playTock({ freq: 200, decay: 0.09, noiseDecay: 0.035, gain: 0.24, filterFreq: 1100, filterQ: 2 });
      }, 110);
      break;
    case "check":
      // Soft alert "knock-knock" — two quick tocks, slightly rising pitch.
      playTock({ freq: 300, decay: 0.07, noiseDecay: 0.03, gain: 0.24, filterFreq: 1500, filterQ: 2.5 });
      setTimeout(() => {
        playTock({ freq: 400, decay: 0.08, noiseDecay: 0.035, gain: 0.22, filterFreq: 1700, filterQ: 2.5 });
      }, 100);
      break;
    case "promote":
      // Short ascending arpeggio (first 3 notes of victory).
      playVictory();
      break;
    case "victory":
    case "game-end":
      playVictory();
      break;
    case "defeat":
      playDefeat();
      break;
    case "illegal":
      // Low buzz — descending tock.
      playTock({ freq: 160, decay: 0.14, noiseDecay: 0.06, gain: 0.18, filterFreq: 700, filterQ: 1.5 });
      break;
  }
}

/** Secondary scrape sound for captures — filtered noise burst in a lower band. */
function playScrape() {
  const ctx = getCtx();
  if (!ctx) return;
  try {
    const t = ctx.currentTime + 0.02;
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.08), ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 1.5);
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.15, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    const f = ctx.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.setValueAtTime(600, t);
    f.Q.setValueAtTime(3, t);
    src.connect(f);
    f.connect(g);
    g.connect(ctx.destination);
    src.start(t);
    src.stop(t + 0.08);
  } catch {
    /* ignore */
  }
}
