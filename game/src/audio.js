// All sound is synthesised with Web Audio: no audio files, no network.
// One shared context, one master gain, short envelopes for every effect.
export function makeSoundboard() {
  let ctx = null;
  let master = null;
  let started = false;

  function ensure() {
    if (ctx) return true;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.32;
      master.connect(ctx.destination);
      return true;
    } catch (e) {
      return false;
    }
  }

  function tone(freq, dur, type, vol, slideTo) {
    if (!ensure()) return;
    if (ctx.state === 'suspended') ctx.resume();
    const t0 = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);
    gain.gain.setValueAtTime(vol || 0.2, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.connect(gain);
    gain.connect(master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  function noiseBurst(dur, vol, lowFreq, highFreq) {
    if (!ensure()) return;
    if (ctx.state === 'suspended') ctx.resume();
    const t0 = ctx.currentTime;
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filt = ctx.createBiquadFilter();
    filt.type = 'bandpass';
    filt.frequency.value = lowFreq || 1200;
    filt.Q.value = 0.8;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(vol || 0.3, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    src.connect(filt);
    filt.connect(gain);
    gain.connect(master);
    src.start(t0);
    if (highFreq) {
      // second, brighter crack layered on top for gunshots
      const src2 = ctx.createBufferSource();
      src2.buffer = buf;
      const filt2 = ctx.createBiquadFilter();
      filt2.type = 'highpass';
      filt2.frequency.value = highFreq;
      const g2 = ctx.createGain();
      g2.gain.setValueAtTime((vol || 0.3) * 0.5, t0);
      g2.gain.exponentialRampToValueAtTime(0.001, t0 + dur * 0.6);
      src2.connect(filt2);
      filt2.connect(g2);
      g2.connect(master);
      src2.start(t0);
    }
  }

  return {
    unlock() { ensure(); if (ctx && ctx.state === 'suspended') ctx.resume(); },
    shot(kind) {
      if (kind === 'shotgun') { noiseBurst(0.22, 0.5, 500, 3000); tone(140, 0.12, 'square', 0.22, 55); }
      else if (kind === 'rifle') { noiseBurst(0.14, 0.42, 900, 3800); tone(190, 0.09, 'square', 0.16, 70); }
      else if (kind === 'dmr') { noiseBurst(0.2, 0.48, 700, 3400); tone(150, 0.14, 'square', 0.2, 60); }
      else if (kind === 'smg') { noiseBurst(0.09, 0.32, 1400, 4200); }
      else { noiseBurst(0.1, 0.34, 1100, 3600); tone(220, 0.07, 'square', 0.12, 90); }
    },
    dryClick() { tone(1400, 0.03, 'square', 0.1); },
    reload() { tone(500, 0.05, 'square', 0.1); setTimeout(() => tone(700, 0.05, 'square', 0.1), 120); setTimeout(() => tone(950, 0.06, 'square', 0.12), 320); },
    hit() { tone(880, 0.05, 'sine', 0.14); },
    hurt() { tone(160, 0.18, 'sawtooth', 0.18, 70); },
    kill() { tone(660, 0.09, 'sine', 0.16); setTimeout(() => tone(990, 0.12, 'sine', 0.16), 90); },
    boom() { noiseBurst(0.7, 0.6, 180, 0); tone(70, 0.6, 'sine', 0.4, 30); },
    flash() { tone(2400, 0.3, 'sine', 0.2, 1200); noiseBurst(0.25, 0.25, 3000, 0); },
    plantTick() { tone(1200, 0.04, 'square', 0.09); },
    defuseTick() { tone(1000, 0.04, 'square', 0.09); },
    planted() { tone(440, 0.15, 'sine', 0.2); setTimeout(() => tone(440, 0.15, 'sine', 0.2), 180); setTimeout(() => tone(880, 0.3, 'sine', 0.2), 360); },
    roundStart() { tone(523, 0.12, 'triangle', 0.18); setTimeout(() => tone(784, 0.18, 'triangle', 0.18), 140); },
    roundEnd(win) {
      if (win) { tone(523, 0.12, 'triangle', 0.18); setTimeout(() => tone(659, 0.12, 'triangle', 0.18), 130); setTimeout(() => tone(784, 0.25, 'triangle', 0.2), 260); }
      else { tone(392, 0.16, 'triangle', 0.18); setTimeout(() => tone(311, 0.28, 'triangle', 0.18), 170); }
    },
    buy() { tone(740, 0.06, 'sine', 0.14); setTimeout(() => tone(988, 0.08, 'sine', 0.14), 70); },
    denied() { tone(220, 0.12, 'square', 0.12, 160); },
    step() { noiseBurst(0.05, 0.06, 300, 0); },
    // A low desert wind bed that loops quietly under play.
    wind() {
      if (!ensure() || started) return;
      started = true;
      const len = ctx.sampleRate * 3;
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = buf.getChannelData(0);
      let v = 0;
      for (let i = 0; i < len; i++) { v = v * 0.98 + (Math.random() * 2 - 1) * 0.02; data[i] = v * 2.2; }
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const filt = ctx.createBiquadFilter();
      filt.type = 'lowpass';
      filt.frequency.value = 320;
      const gain = ctx.createGain();
      gain.gain.value = 0.05;
      src.connect(filt);
      filt.connect(gain);
      gain.connect(master);
      src.start();
    },
  };
}
