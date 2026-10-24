// Sound effects, made with the Web Audio API. No sound files are needed: every sound is
// a tone or a burst of noise that the browser generates as it plays.
// The audio context is passed in, so the tests can run in Node without a sound card.

/** Opens the browser's audio system. Returns null when the browser has none. */
function browserAudioContext() {
  const Ctor = globalThis.AudioContext || globalThis.webkitAudioContext;
  return Ctor ? new Ctor() : null;
}

export class Sound {
  /** makeContext returns an audio context, or null if sound is not available. */
  constructor(makeContext = browserAudioContext) {
    this.makeContext = makeContext;
    this.ctx = null;
    this.enabled = true;
    this.hum = null; // the looping laser hum while mining, when it is playing
  }

  /**
   * Browsers only allow sound after the player has clicked something.
   * Call this from a click handler; it is safe to call many times.
   */
  unlock() {
    if (!this.ctx) this.ctx = this.makeContext();
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  /** Turns all sound on or off. Returns the new state. */
  toggle() {
    this.enabled = !this.enabled;
    if (!this.enabled) this.setHum(false);
    return this.enabled;
  }

  /** True when sound can be played right now. */
  ready() {
    return this.enabled && this.ctx !== null;
  }

  /** A short musical note that fades out. slideTo bends the pitch as it plays. */
  tone(freq, dur, { type = 'sine', volume = 0.15, slideTo = null, delay = 0 } = {}) {
    const ctx = this.ctx;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    gain.gain.setValueAtTime(volume, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  /** A burst of noise, like a crack or a scrape. */
  noise(dur, volume = 0.2) {
    const ctx = this.ctx;
    const length = Math.floor(ctx.sampleRate * dur);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / length); // fades as it goes
    }
    const source = ctx.createBufferSource();
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(volume, ctx.currentTime);
    source.buffer = buffer;
    source.connect(gain);
    gain.connect(ctx.destination);
    source.start();
  }

  /** The pick hits the rock: a crack plus a low thump. */
  strike() {
    if (!this.ready()) return;
    this.noise(0.08, 0.25);
    this.tone(180, 0.12, { type: 'triangle', volume: 0.3, slideTo: 60 });
  }

  /** Ore is sold: a short rising chime. */
  deposit() {
    if (!this.ready()) return;
    this.tone(660, 0.25, { type: 'triangle', volume: 0.18 });
    this.tone(880, 0.25, { type: 'triangle', volume: 0.18, delay: 0.08 });
    this.tone(1320, 0.4, { type: 'triangle', volume: 0.18, delay: 0.16 });
  }

  /** A crystal runs out: a falling tone. */
  empty() {
    if (!this.ready()) return;
    this.tone(440, 0.35, { type: 'sawtooth', volume: 0.08, slideTo: 180 });
  }

  /** A tiny click when the player points at something. */
  blip() {
    if (!this.ready()) return;
    this.tone(900, 0.05, { type: 'square', volume: 0.04 });
  }

  /** The laser hum: starts or stops a quiet looping buzz. Cheap to call every frame. */
  setHum(on) {
    if (!this.ready() && on) return;
    if (on && !this.hum) {
      const ctx = this.ctx;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(110, ctx.currentTime);
      gain.gain.setValueAtTime(0, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0.03, ctx.currentTime + 0.15);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      this.hum = { osc, gain };
    } else if (!on && this.hum) {
      const { osc, gain } = this.hum;
      const now = this.ctx ? this.ctx.currentTime : 0;
      gain.gain.linearRampToValueAtTime(0, now + 0.12);
      osc.stop(now + 0.15);
      this.hum = null;
    }
  }
}
