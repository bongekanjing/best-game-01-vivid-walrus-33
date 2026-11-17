// Sound, synthesised on the fly with Web Audio: no files, no downloads, no network. Every cue is a
// short oscillator envelope, so the whole soundtrack of the game is a page of code. The context is
// created on the first gesture a browser will allow, and every cue degrades to silence if it cannot.

const MASTER = 0.26;

export function createAudio() {
  let ctx = null;
  let master = null;
  let muted = false;
  let ready = false;

  function ensure() {
    if (ready) return true;
    const Ctor = window.AudioContext ?? window.webkitAudioContext;
    if (!Ctor) return false;
    try {
      ctx = new Ctor();
      master = ctx.createGain();
      master.gain.value = MASTER;
      master.connect(ctx.destination);
      ready = true;
      return true;
    } catch {
      return false;
    }
  }

  /** A single envelope: a tone that starts at once and fades to nothing. */
  function tone({ freq, endFreq, type = 'sine', hold = 0.12, volume = 0.3, delay = 0 }) {
    if (muted || !ensure()) return;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    const start = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);
    if (endFreq && endFreq !== freq) osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), start + hold);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + hold);
    osc.connect(gain);
    gain.connect(master);
    osc.start(start);
    osc.stop(start + hold + 0.02);
  }

  /** Noise burst, for hits and the bloom: a filter sweep over a very short white noise. */
  function noise({ hold = 0.16, volume = 0.2, from = 1800, to = 200, delay = 0 }) {
    if (muted || !ensure()) return;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    const start = ctx.currentTime + delay;
    const length = Math.max(1, Math.floor(ctx.sampleRate * hold));
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / length);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(from, start);
    filter.frequency.exponentialRampToValueAtTime(Math.max(40, to), start + hold);
    filter.Q.value = 0.9;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(volume, start);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + hold);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    source.start(start);
  }

  return {
    /** Called from the first user gesture: browsers want one before any sound. */
    unlock() {
      if (!ensure()) return;
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    },
    toggleMute() {
      muted = !muted;
      if (master) master.gain.value = muted ? 0 : MASTER;
      return muted;
    },
    get muted() {
      return muted;
    },
    shoot() {
      tone({ freq: 880, endFreq: 520, type: 'triangle', hold: 0.07, volume: 0.055 });
    },
    hit() {
      noise({ hold: 0.07, volume: 0.11, from: 2400, to: 700 });
    },
    kill() {
      tone({ freq: 200, endFreq: 90, type: 'square', hold: 0.13, volume: 0.05 });
      noise({ hold: 0.11, volume: 0.09, from: 900, to: 200 });
    },
    mote() {
      tone({ freq: 1180, endFreq: 1560, type: 'sine', hold: 0.09, volume: 0.05 });
    },
    hurt() {
      tone({ freq: 320, endFreq: 70, type: 'sawtooth', hold: 0.34, volume: 0.14 });
      noise({ hold: 0.24, volume: 0.15, from: 700, to: 90 });
    },
    dash() {
      noise({ hold: 0.14, volume: 0.09, from: 400, to: 2400 });
    },
    bloom() {
      tone({ freq: 180, endFreq: 640, type: 'sine', hold: 0.4, volume: 0.13 });
      tone({ freq: 270, endFreq: 960, type: 'triangle', hold: 0.34, volume: 0.07, delay: 0.03 });
      noise({ hold: 0.36, volume: 0.13, from: 2200, to: 120 });
    },
    wave() {
      tone({ freq: 392, endFreq: 392, type: 'triangle', hold: 0.16, volume: 0.09 });
      tone({ freq: 523, endFreq: 523, type: 'triangle', hold: 0.18, volume: 0.09, delay: 0.14 });
      tone({ freq: 659, endFreq: 659, type: 'triangle', hold: 0.26, volume: 0.09, delay: 0.28 });
    },
    choose() {
      tone({ freq: 660, endFreq: 990, type: 'sine', hold: 0.16, volume: 0.08 });
    },
    boss() {
      tone({ freq: 98, endFreq: 62, type: 'sawtooth', hold: 0.9, volume: 0.14 });
      noise({ hold: 0.7, volume: 0.12, from: 320, to: 60 });
    },
    over() {
      tone({ freq: 330, endFreq: 110, type: 'triangle', hold: 0.8, volume: 0.12 });
      tone({ freq: 220, endFreq: 70, type: 'sine', hold: 1.1, volume: 0.1, delay: 0.12 });
    },
    win() {
      [523, 659, 784, 1046].forEach((freq, index) => {
        tone({ freq, endFreq: freq, type: 'triangle', hold: 0.32, volume: 0.1, delay: index * 0.13 });
      });
    },
  };
}
