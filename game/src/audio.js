// Procedural sound for Sunscorch Yard. Every sound is synthesized with
// the Web Audio API at runtime: no audio files ship with the game, so the
// browser loads nothing over the network. The mixer is created lazily on
// the first user gesture, so browsers' autoplay rules are respected, and a
// muted flag survives across rounds.

export function createAudio() {
  let ctx = null;
  let master = null;
  let muted = false;

  function ensure() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return true;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
    return true;
  }

  function noiseBuffer(duration) {
    const buffer = ctx.createBuffer(1, Math.max(1, Math.floor(ctx.sampleRate * duration)), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  // A filtered noise burst: the body of a gunshot, an explosion, a hurt thud.
  function burst({ duration, filterFreq, filterType, gain, decay }) {
    if (!ensure() || muted) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(duration);
    const filter = ctx.createBiquadFilter();
    filter.type = filterType || 'lowpass';
    filter.frequency.value = filterFreq || 1200;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain || 0.4, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + (decay || duration));
    src.connect(filter).connect(g).connect(master);
    src.start(t);
    src.stop(t + duration + 0.05);
  }

  // A short oscillator tone: beeps, ticks, chimes.
  function tone({ freq, endFreq, duration, type, gain }) {
    if (!ensure() || muted) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(freq, t);
    if (endFreq) osc.frequency.exponentialRampToValueAtTime(endFreq, t + duration);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain || 0.2, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + duration);
    osc.connect(g).connect(master);
    osc.start(t);
    osc.stop(t + duration + 0.05);
  }

  return {
    unlock() {
      ensure();
    },
    setMuted(value) {
      muted = value;
    },
    isMuted() {
      return muted;
    },
    shot(kind) {
      if (kind === 'shotgun') burst({ duration: 0.22, filterFreq: 900, gain: 0.7, decay: 0.2 });
      else if (kind === 'dmr') burst({ duration: 0.3, filterFreq: 700, gain: 0.7, decay: 0.28 });
      else if (kind === 'smg') burst({ duration: 0.09, filterFreq: 1600, gain: 0.32, decay: 0.08 });
      else if (kind === 'rifle') burst({ duration: 0.14, filterFreq: 1100, gain: 0.5, decay: 0.12 });
      else burst({ duration: 0.1, filterFreq: 1400, gain: 0.4, decay: 0.09 });
      tone({ freq: 160, endFreq: 60, duration: 0.08, type: 'triangle', gain: 0.25 });
    },
    dryFire() {
      tone({ freq: 1400, duration: 0.03, type: 'square', gain: 0.08 });
    },
    reload() {
      tone({ freq: 500, duration: 0.05, type: 'square', gain: 0.1 });
      setTimeout(() => tone({ freq: 700, duration: 0.05, type: 'square', gain: 0.1 }), 180);
    },
    hit(head) {
      tone({ freq: head ? 1900 : 1300, duration: 0.06, type: 'sine', gain: 0.22 });
    },
    hurt() {
      burst({ duration: 0.15, filterFreq: 500, gain: 0.35, decay: 0.14 });
    },
    kill() {
      tone({ freq: 880, endFreq: 1320, duration: 0.12, type: 'sine', gain: 0.2 });
    },
    plantBeep() {
      tone({ freq: 1100, duration: 0.09, type: 'square', gain: 0.12 });
    },
    defuseBeep() {
      tone({ freq: 900, duration: 0.09, type: 'square', gain: 0.12 });
    },
    explosion() {
      burst({ duration: 0.7, filterFreq: 300, gain: 0.9, decay: 0.65 });
      tone({ freq: 90, endFreq: 35, duration: 0.5, type: 'sine', gain: 0.5 });
    },
    flash() {
      tone({ freq: 2400, endFreq: 1200, duration: 0.3, type: 'sine', gain: 0.15 });
    },
    plant() {
      tone({ freq: 660, endFreq: 990, duration: 0.25, type: 'triangle', gain: 0.25 });
      setTimeout(() => tone({ freq: 990, endFreq: 1320, duration: 0.3, type: 'triangle', gain: 0.25 }), 200);
    },
    throwSound() {
      burst({ duration: 0.12, filterFreq: 2000, gain: 0.15, decay: 0.1 });
    },
    roundStart() {
      tone({ freq: 523, duration: 0.12, type: 'triangle', gain: 0.2 });
      setTimeout(() => tone({ freq: 784, duration: 0.16, type: 'triangle', gain: 0.2 }), 130);
    },
    roundWin() {
      [523, 659, 784].forEach((f, i) => setTimeout(() => tone({ freq: f, duration: 0.18, type: 'triangle', gain: 0.22 }), i * 140));
    },
    roundLose() {
      [392, 330, 262].forEach((f, i) => setTimeout(() => tone({ freq: f, duration: 0.2, type: 'triangle', gain: 0.2 }), i * 150));
    },
    buy() {
      tone({ freq: 1046, duration: 0.07, type: 'sine', gain: 0.15 });
    },
    denied() {
      tone({ freq: 220, duration: 0.12, type: 'square', gain: 0.12 });
    },
  };
}
