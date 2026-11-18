/*
 * Sound engine. Every sound is synthesized with the Web Audio API and
 * pre-rendered at startup, so the game works fully offline with no
 * audio files. Any sound can be swapped for a real file, either by
 * picking it in the operator's Look & Sound tab or by dropping a
 * correctly named file into the sounds/ folder (see SOUND_LIST).
 */
(function () {
  const SR = 44100;

  /* ---------------- note helpers ---------------- */
  const NOTE_IDX = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  function hz(name, transpose) {
    const m = /^([A-G])([#b]?)(-?\d)$/.exec(name);
    if (!m) throw new Error('bad note ' + name);
    let midi = 12 * (parseInt(m[3], 10) + 1) + NOTE_IDX[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
    midi += transpose || 0;
    return 440 * Math.pow(2, (midi - 69) / 12);
  }
  const CHORDS = { maj: [0, 4, 7], min: [0, 3, 7], dom7: [0, 4, 7, 10], min7: [0, 3, 7, 10], maj6: [0, 4, 7, 9] };

  /* ---------------- primitive voices ---------------- */
  let noiseCache = new WeakMap();
  function noise(ctx) {
    if (noiseCache.has(ctx)) return noiseCache.get(ctx);
    const len = ctx.sampleRate * 4;
    const b = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    noiseCache.set(ctx, b);
    return b;
  }

  function adsr(g, t, { a = 0.005, peak = 1, d = 0.1, s = 0.7, hold = 0.2, r = 0.1 }) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak * s), t + a + d);
    g.gain.setValueAtTime(Math.max(0.0001, peak * s), t + Math.max(a + d, hold));
    g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(a + d, hold) + r);
    return t + Math.max(a + d, hold) + r;
  }

  function panner(ctx, out, pan) {
    if (!ctx.createStereoPanner || !pan) return out;
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    p.connect(out);
    return p;
  }

  // Bell / chime: inharmonic sine partials with exponential decay
  function bell(ctx, out, f, t, g = 0.5, len = 1.4, pan = 0) {
    const dest = panner(ctx, out, pan);
    const partials = [[1, 1, 1], [2.0, 0.5, 0.65], [3.0, 0.22, 0.4], [4.16, 0.14, 0.28], [5.43, 0.07, 0.18]];
    partials.forEach(([r, a, dl]) => {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f * r;
      const gg = ctx.createGain();
      gg.gain.setValueAtTime(0.0001, t);
      gg.gain.linearRampToValueAtTime(g * a, t + 0.003);
      gg.gain.exponentialRampToValueAtTime(0.0001, t + len * dl);
      o.connect(gg).connect(dest);
      o.start(t);
      o.stop(t + len * dl + 0.05);
    });
  }

  // Glockenspiel-ish sparkle
  function glock(ctx, out, f, t, g = 0.12) {
    [[1, 1, 0.9], [2.76, 0.35, 0.35], [5.4, 0.12, 0.15]].forEach(([r, a, len]) => {
      const o = ctx.createOscillator();
      o.frequency.value = f * r;
      const gg = ctx.createGain();
      gg.gain.setValueAtTime(0.0001, t);
      gg.gain.linearRampToValueAtTime(g * a, t + 0.002);
      gg.gain.exponentialRampToValueAtTime(0.0001, t + len);
      o.connect(gg).connect(out);
      o.start(t);
      o.stop(t + len + 0.05);
    });
  }

  // Synth brass: detuned saws + square sub, filter envelope, late vibrato
  function brass(ctx, out, f, t, dur, g = 0.12, opts = {}) {
    const bright = opts.bright || 1;
    const pan = opts.pan || 0;
    const dest = panner(ctx, out, pan);
    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.Q.value = 1.2;
    const fMax = Math.min(f * 9 * bright, 9000);
    filt.frequency.setValueAtTime(f * 1.2, t);
    filt.frequency.exponentialRampToValueAtTime(fMax, t + 0.035);
    filt.frequency.exponentialRampToValueAtTime(Math.min(f * 4.5 * bright, 6000), t + 0.18);
    const amp = ctx.createGain();
    const end = adsr(amp, t, { a: 0.018, peak: g, d: 0.12, s: 0.72, hold: Math.max(0.05, dur - 0.03), r: 0.09 });
    filt.connect(amp).connect(dest);

    const vib = ctx.createOscillator();
    vib.frequency.value = 5.6;
    const vibG = ctx.createGain();
    vibG.gain.setValueAtTime(0, t);
    if (dur > 0.45) {
      vibG.gain.setValueAtTime(0, t + 0.25);
      vibG.gain.linearRampToValueAtTime(f * 0.006, t + 0.5);
    }
    vib.connect(vibG);
    vib.start(t);
    vib.stop(end + 0.05);

    [[-7, 'sawtooth', 1], [7, 'sawtooth', 1], [0, 'square', 0.35]].forEach(([det, type, lvl], i) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = i === 2 ? f / 2 : f;
      o.detune.value = det;
      vibG.connect(o.frequency);
      const og = ctx.createGain();
      og.gain.value = lvl * 0.5;
      o.connect(og).connect(filt);
      o.start(t);
      o.stop(end + 0.05);
    });
    return end;
  }

  function bass(ctx, out, f, t, dur, g = 0.32) {
    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.setValueAtTime(900, t);
    filt.frequency.exponentialRampToValueAtTime(280, t + 0.2);
    const amp = ctx.createGain();
    const end = adsr(amp, t, { a: 0.006, peak: g, d: 0.18, s: 0.45, hold: dur * 0.85, r: 0.06 });
    filt.connect(amp).connect(out);
    [['triangle', 1], ['sawtooth', 0.25]].forEach(([type, lvl]) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f;
      const og = ctx.createGain();
      og.gain.value = lvl;
      o.connect(og).connect(filt);
      o.start(t);
      o.stop(end + 0.05);
    });
  }

  function kick(ctx, out, t, g = 0.85) {
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(155, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.13);
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(g, t);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
    o.connect(amp).connect(out);
    o.start(t);
    o.stop(t + 0.35);
  }

  function timpani(ctx, out, f, t, g = 0.6, len = 1.1) {
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(f * 1.25, t);
    o.frequency.exponentialRampToValueAtTime(f, t + 0.06);
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(g, t);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + len);
    o.connect(amp).connect(out);
    o.start(t);
    o.stop(t + len + 0.05);
    noiseHit(ctx, out, t, { type: 'lowpass', freq: 600, g: g * 0.35, len: 0.08 });
  }

  function noiseHit(ctx, out, t, { type = 'highpass', freq = 7000, q = 0.7, g = 0.2, len = 0.05, a = 0.001, pan = 0 }) {
    const src = ctx.createBufferSource();
    src.buffer = noise(ctx);
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.linearRampToValueAtTime(g, t + a);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + a + len);
    src.connect(f).connect(amp).connect(panner(ctx, out, pan));
    const need = a + len + 0.05;
    const off = Math.random() * Math.max(0, 3.9 - need);
    src.start(t, off, need);
  }

  function snare(ctx, out, t, g = 0.35) {
    noiseHit(ctx, out, t, { type: 'bandpass', freq: 2600, q: 0.6, g, len: 0.16 });
    noiseHit(ctx, out, t, { type: 'highpass', freq: 5000, g: g * 0.5, len: 0.08 });
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(240, t);
    o.frequency.exponentialRampToValueAtTime(160, t + 0.06);
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(g * 0.8, t);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    o.connect(amp).connect(out);
    o.start(t);
    o.stop(t + 0.1);
  }

  function hat(ctx, out, t, g = 0.08) { noiseHit(ctx, out, t, { freq: 8000, g, len: 0.035, pan: 0.25 }); }
  function crash(ctx, out, t, g = 0.22, len = 1.8) {
    noiseHit(ctx, out, t, { freq: 4500, g, len, a: 0.003 });
    noiseHit(ctx, out, t, { type: 'bandpass', freq: 9000, q: 0.5, g: g * 0.6, len: len * 0.6, a: 0.003 });
  }

  // Sleigh bells: a cluster of tiny metallic jingles
  function sleigh(ctx, out, t, g = 0.05) {
    for (let k = 0; k < 4; k++) {
      const tt = t + Math.random() * 0.018;
      const pan = (Math.random() - 0.5) * 0.6;
      noiseHit(ctx, out, tt, { type: 'bandpass', freq: 6500 + Math.random() * 3000, q: 6, g: g * 1.6, len: 0.07, pan });
      const o = ctx.createOscillator();
      o.frequency.value = 4800 + Math.random() * 4200;
      const amp = ctx.createGain();
      amp.gain.setValueAtTime(0.0001, tt);
      amp.gain.linearRampToValueAtTime(g * 0.35, tt + 0.002);
      amp.gain.exponentialRampToValueAtTime(0.0001, tt + 0.09);
      o.connect(amp).connect(panner(ctx, out, pan));
      o.start(tt);
      o.stop(tt + 0.1);
    }
  }

  function chordStab(ctx, out, root, quality, t, dur, g = 0.045, octave = 4) {
    const base = hz('C' + octave) * Math.pow(2, root / 12);
    CHORDS[quality].forEach((iv, i) => brass(ctx, out, base * Math.pow(2, iv / 12), t, dur, g, { bright: 0.7, pan: (i - 1.5) * 0.25 }));
  }

  /* ---------------- sound recipes ---------------- */
  const RECIPES = {
    ding: {
      norm: 0.8,
      len: 2.2,
      fn(ctx, out) {
        bell(ctx, out, hz('C6'), 0.0, 0.42, 2.0);
        bell(ctx, out, hz('G6'), 0.0, 0.18, 1.4);
        bell(ctx, out, hz('C7'), 0.0, 0.07, 0.8);
      },
    },
    strike: {
      norm: 0.62,
      len: 1.1,
      fn(ctx, out) {
        const t = 0.0, dur = 0.85;
        const shaper = ctx.createWaveShaper();
        const curve = new Float32Array(1024);
        for (let i = 0; i < 1024; i++) { const x = (i / 1023) * 2 - 1; curve[i] = Math.tanh(x * 3.5); }
        shaper.curve = curve;
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 2200;
        const amp = ctx.createGain();
        amp.gain.setValueAtTime(0.0001, t);
        amp.gain.linearRampToValueAtTime(0.38, t + 0.012);
        amp.gain.setValueAtTime(0.38, t + dur - 0.06);
        amp.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        shaper.connect(lp).connect(amp).connect(out);
        [[98, 'sawtooth'], [103.5, 'sawtooth'], [147, 'square'], [196.4, 'sawtooth']].forEach(([f, type]) => {
          const o = ctx.createOscillator();
          o.type = type;
          o.frequency.value = f;
          const g = ctx.createGain();
          g.gain.value = 0.32;
          o.connect(g).connect(shaper);
          o.start(t);
          o.stop(t + dur + 0.05);
        });
      },
    },
    buzzin: {
      norm: 0.55,
      len: 0.7,
      fn(ctx, out) {
        const t = 0, dur = 0.5;
        const amp = ctx.createGain();
        amp.gain.setValueAtTime(0.0001, t);
        amp.gain.linearRampToValueAtTime(0.22, t + 0.008);
        amp.gain.setValueAtTime(0.22, t + dur - 0.05);
        amp.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        const trem = ctx.createGain();
        trem.gain.value = 0.6;
        const lfo = ctx.createOscillator();
        lfo.type = 'square';
        lfo.frequency.value = 32;
        const lfoG = ctx.createGain();
        lfoG.gain.value = 0.4;
        lfo.connect(lfoG).connect(trem.gain);
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 3500;
        trem.connect(lp).connect(amp).connect(out);
        [[740, 'square', 0.5], [1110, 'sawtooth', 0.25]].forEach(([f, type, l]) => {
          const o = ctx.createOscillator();
          o.type = type;
          o.frequency.value = f;
          const g = ctx.createGain();
          g.gain.value = l;
          o.connect(g).connect(trem);
          o.start(t);
          o.stop(t + dur + 0.05);
        });
        lfo.start(t);
        lfo.stop(t + dur + 0.05);
      },
    },
    whoosh: {
      norm: 0.6,
      len: 0.8,
      fn(ctx, out) {
        const src = ctx.createBufferSource();
        src.buffer = noise(ctx);
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.Q.value = 1.4;
        bp.frequency.setValueAtTime(350, 0);
        bp.frequency.exponentialRampToValueAtTime(5000, 0.45);
        const amp = ctx.createGain();
        amp.gain.setValueAtTime(0.0001, 0);
        amp.gain.linearRampToValueAtTime(0.5, 0.3);
        amp.gain.exponentialRampToValueAtTime(0.0001, 0.62);
        src.connect(bp).connect(amp).connect(out);
        src.start(0, 0, 0.7);
      },
    },
    tick: {
      norm: 0.45,
      len: 0.15,
      fn(ctx, out) {
        const o = ctx.createOscillator();
        o.frequency.setValueAtTime(1900, 0);
        o.frequency.exponentialRampToValueAtTime(1200, 0.04);
        const amp = ctx.createGain();
        amp.gain.setValueAtTime(0.25, 0);
        amp.gain.exponentialRampToValueAtTime(0.0001, 0.06);
        o.connect(amp).connect(out);
        o.start(0);
        o.stop(0.08);
        noiseHit(ctx, out, 0, { type: 'bandpass', freq: 3000, q: 2, g: 0.15, len: 0.01 });
      },
    },
    tickHigh: {
      norm: 0.55,
      len: 0.15,
      fn(ctx, out) {
        const o = ctx.createOscillator();
        o.frequency.setValueAtTime(2600, 0);
        o.frequency.exponentialRampToValueAtTime(1800, 0.05);
        const amp = ctx.createGain();
        amp.gain.setValueAtTime(0.3, 0);
        amp.gain.exponentialRampToValueAtTime(0.0001, 0.08);
        o.connect(amp).connect(out);
        o.start(0);
        o.stop(0.1);
      },
    },
    duplicate: {
      norm: 0.7,
      len: 0.6,
      fn(ctx, out) {
        [[0, 392], [0.2, 330]].forEach(([t, f]) => {
          const lp = ctx.createBiquadFilter();
          lp.type = 'lowpass';
          lp.frequency.value = 1400;
          const amp = ctx.createGain();
          amp.gain.setValueAtTime(0.0001, t);
          amp.gain.linearRampToValueAtTime(0.3, t + 0.01);
          amp.gain.setValueAtTime(0.3, t + 0.12);
          amp.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
          lp.connect(amp).connect(out);
          ['square', 'sawtooth'].forEach((type) => {
            const o = ctx.createOscillator();
            o.type = type;
            o.frequency.value = f;
            o.connect(lp);
            o.start(t);
            o.stop(t + 0.18);
          });
        });
      },
    },
    timeup: {
      norm: 0.7,
      len: 1.5,
      fn(ctx, out) {
        const dur = 1.2;
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 1800;
        const amp = ctx.createGain();
        amp.gain.setValueAtTime(0.0001, 0);
        amp.gain.linearRampToValueAtTime(0.32, 0.01);
        amp.gain.setValueAtTime(0.32, dur - 0.08);
        amp.gain.exponentialRampToValueAtTime(0.0001, dur);
        lp.connect(amp).connect(out);
        [[220, 'sawtooth'], [223, 'sawtooth'], [330, 'square']].forEach(([f, type]) => {
          const o = ctx.createOscillator();
          o.type = type;
          o.frequency.value = f;
          const g = ctx.createGain();
          g.gain.value = 0.35;
          o.connect(g).connect(lp);
          o.start(0);
          o.stop(dur + 0.05);
        });
      },
    },
    chaching: {
      norm: 0.75,
      len: 1.8,
      fn(ctx, out) {
        ['C6', 'E6', 'G6', 'C7', 'E7'].forEach((n, i) => bell(ctx, out, hz(n), i * 0.065, 0.22, 1.2, (i - 2) * 0.2));
        for (let i = 0; i < 6; i++) sleigh(ctx, out, 0.05 + i * 0.06, 0.06);
      },
    },
    applause: {
      norm: 0.75,
      len: 5.0,
      fn(ctx, out) {
        const total = 4.6;
        const bus = ctx.createGain();
        bus.gain.setValueAtTime(0.0001, 0);
        bus.gain.linearRampToValueAtTime(1, 0.35);
        bus.gain.setValueAtTime(1, 2.4);
        bus.gain.exponentialRampToValueAtTime(0.0001, total);
        bus.connect(out);
        // crowd wash
        const src = ctx.createBufferSource();
        src.buffer = noise(ctx);
        src.loop = true;
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = 1400;
        bp.Q.value = 0.5;
        const wg = ctx.createGain();
        wg.gain.value = 0.06;
        src.connect(bp).connect(wg).connect(bus);
        src.start(0);
        src.stop(total);
        // individual claps
        const count = 340;
        for (let i = 0; i < count; i++) {
          const t = Math.random() * (total - 0.2);
          noiseHit(ctx, bus, t, {
            type: 'bandpass',
            freq: 900 + Math.random() * 1900,
            q: 0.9 + Math.random() * 1.2,
            g: 0.1 + Math.random() * 0.12,
            len: 0.03 + Math.random() * 0.04,
            pan: (Math.random() - 0.5) * 1.6,
          });
        }
      },
    },
    roundStart: {
      norm: 0.9,
      len: 3.0,
      fn(ctx, out) {
        // riser
        const src = ctx.createBufferSource();
        src.buffer = noise(ctx);
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.Q.value = 2;
        bp.frequency.setValueAtTime(300, 0);
        bp.frequency.exponentialRampToValueAtTime(6000, 0.42);
        const ag = ctx.createGain();
        ag.gain.setValueAtTime(0.0001, 0);
        ag.gain.linearRampToValueAtTime(0.25, 0.4);
        ag.gain.exponentialRampToValueAtTime(0.0001, 0.48);
        src.connect(bp).connect(ag).connect(out);
        src.start(0, 0, 0.5);
        // ta- DAAA
        const t1 = 0.42, t2 = 0.62;
        [hz('G4'), hz('B4'), hz('D5'), hz('G5')].forEach((f, i) => brass(ctx, out, f, t1, 0.12, 0.08, { pan: (i - 1.5) * 0.3 }));
        [hz('C4'), hz('E4'), hz('G4'), hz('C5'), hz('E5'), hz('G5')].forEach((f, i) => brass(ctx, out, f, t2, 1.4, 0.07, { pan: (i - 2.5) * 0.25, bright: 1.1 }));
        bass(ctx, out, hz('C2'), t2, 1.4, 0.4);
        timpani(ctx, out, hz('G2'), t1, 0.5, 0.4);
        timpani(ctx, out, hz('C2'), t2, 0.7, 1.4);
        crash(ctx, out, t2, 0.25, 2.0);
        for (let i = 0; i < 8; i++) sleigh(ctx, out, t2 + i * 0.105, 0.05);
        glock(ctx, out, hz('C7'), t2 + 0.05, 0.12);
        glock(ctx, out, hz('G7'), t2 + 0.15, 0.08);
      },
    },
    fanfare: {
      norm: 0.9,
      len: 5.0,
      fn(ctx, out) {
        const b = 0.15; // 16th-ish
        const seq = [['G4', 0, 1], ['G4', 1, 1], ['G4', 2, 1], ['C5', 3, 3], ['G4', 6, 1], ['C5', 7, 1], ['E5', 8, 2], ['G5', 10, 12]];
        seq.forEach(([n, s, d]) => {
          brass(ctx, out, hz(n), s * b, d * b - 0.02, 0.13, { bright: 1.2 });
          brass(ctx, out, hz(n, -12), s * b, d * b - 0.02, 0.06);
        });
        const tEnd = 10 * b;
        [['C4', 'maj', 0, 3], ['C4', 'maj', 3, 3], ['G3', 'maj', 6, 4]].forEach(([r, q, s, d]) => {
          const root = hz(r);
          CHORDS[q].forEach((iv) => brass(ctx, out, root * Math.pow(2, iv / 12), s * b, d * b - 0.03, 0.04, { bright: 0.8 }));
        });
        [hz('C4'), hz('E4'), hz('G4'), hz('C5'), hz('E5')].forEach((f, i) => brass(ctx, out, f, tEnd, 1.9, 0.06, { pan: (i - 2) * 0.3 }));
        bass(ctx, out, hz('C2'), tEnd, 1.9, 0.45);
        for (let i = 0; i < 10; i++) timpani(ctx, out, hz('C2'), i * b, 0.25 + i * 0.03, 0.25);
        timpani(ctx, out, hz('C2'), tEnd, 0.8, 1.8);
        crash(ctx, out, tEnd, 0.3, 2.6);
        for (let i = 0; i < 16; i++) sleigh(ctx, out, tEnd + i * 0.11, 0.05);
        ['C7', 'E7', 'G7', 'C8'].forEach((n, i) => glock(ctx, out, hz(n), tEnd + i * 0.08, 0.1));
      },
    },
    theme: { len: 32.5, render: renderTheme, norm: 0.9 },
  };

  /* ---------------- original theme tune ----------------
   * Composed as a list of note events, then rendered by pre-rendering each
   * unique instrument/pitch once and replaying it (much faster than
   * synthesizing thousands of live voices). */
  function themeScore() {
    const evs = [];
    const E = (inst, f, t, dur, g, pan = 0) => evs.push({ inst, f, t, dur, g, pan });
    const bpm = 144;
    const beat = 60 / bpm;
    const bar = beat * 4;

    const melody = [
      [['E5', 0.5], ['G5', 0.5], ['C6', 1], ['B5', 0.5], ['A5', 0.5], ['G5', 1]],
      [['A5', 0.5], ['G5', 0.5], ['F5', 0.5], ['E5', 0.5], ['D5', 1], ['G4', 1]],
      [['F5', 0.5], ['A5', 0.5], ['C6', 1], ['D6', 0.5], ['C6', 0.5], ['A5', 1]],
      [['E5', 0.5], ['F5', 0.5], ['G5', 0.5], ['A5', 0.5], ['G5', 2]],
      [['E5', 0.5], ['G5', 0.5], ['C6', 1], ['E6', 0.5], ['D6', 0.5], ['C6', 1]],
      [['C6', 0.5], ['A5', 0.5], ['G5', 0.5], ['F5', 0.5], ['A5', 1], ['C6', 1]],
      [['B5', 0.5], ['A5', 0.5], ['G5', 0.5], ['F5', 0.5], ['D5', 1], ['B4', 1]],
      [['C5', 1], ['E5', 0.5], ['G5', 0.5], ['C6', 1], [null, 1]],
    ];
    const chords = [
      [[0, 'maj', 4]], [[2, 'min', 2], [7, 'dom7', 2]], [[5, 'maj', 4]], [[7, 'dom7', 4]],
      [[0, 'maj', 4]], [[5, 'maj', 2], [9, 'min', 2]], [[7, 'dom7', 4]], [[0, 'maj', 2], [7, 'dom7', 2]],
    ];
    const stab = (root, q, t, dur, g, oct = 4) => {
      const base = hz('C' + oct) * Math.pow(2, root / 12);
      CHORDS[q].forEach((iv, i) => E('stab', base * Math.pow(2, iv / 12), t, dur, g, (i - 1.5) * 0.25));
    };

    let t = 0.05;
    // intro bar
    [[0, 0.5], [2.5, 0.5], [3.5, 0.5]].forEach(([bb, d]) => {
      stab(7, 'dom7', t + bb * beat, d * beat, 0.06);
      E('bass', hz('G2'), t + bb * beat, d * beat, 0.4);
      E('timp', hz('G2'), t + bb * beat, 0.5, 0.5);
    });
    for (let i = 0; i < 8; i++) E('snare', 0, t + (2 + i * 0.25) * beat, 0, 0.08 + i * 0.03);
    t += bar;

    function section(tr, variation) {
      for (let b = 0; b < 8; b++) {
        const bt = t + b * bar;
        let pos = 0;
        melody[b].forEach(([n, len]) => {
          if (n) {
            const f = hz(n, tr);
            E('lead', f, bt + pos * beat, len * beat - 0.03, 0.14);
            if (variation) {
              E('leadLow', f / 2, bt + pos * beat, len * beat - 0.03, 0.06);
              E('glock', f * 2, bt + pos * beat, 0, 0.07);
            }
          }
          pos += len;
        });
        let cpos = 0;
        chords[b].forEach(([root, q, len]) => {
          const r = root + tr;
          for (let k = 0; k < len; k++) {
            const bb = bt + (cpos + k) * beat;
            const iv = k % 2 === 0 ? 0 : 7;
            E('bass', hz('C2') * Math.pow(2, ((r % 12) + iv) / 12), bb, beat * 0.9, 0.22);
            stab(r % 12, q, bb + beat * 0.5, beat * 0.28, 0.032, 4);
          }
          cpos += len;
        });
        for (let k = 0; k < 4; k++) {
          const bb = bt + k * beat;
          if (k === 0 || k === 2) E('kick', 0, bb, 0, 0.5);
          if (k === 1 || k === 3) E('snare', 0, bb, 0, 0.22);
          E('hat', 0, bb, 0, 0.05);
          E('hat', 0, bb + beat * 0.5, 0, 0.035);
          E('sleigh', 0, bb, 0, 0.04);
          E('sleigh', 0, bb + beat * 0.5, 0, 0.025);
        }
        if (b === 0) E('crash', 0, bt, 1.6, 0.16);
        if (b === 7) for (let i = 0; i < 4; i++) E('snare', 0, bt + (2 + i * 0.5) * beat, 0, 0.1 + i * 0.04);
      }
      t += 8 * bar;
    }
    section(0, false);
    section(2, true); // key change up a whole step

    // ending in D: "da da da DAAA"
    [['A5', 0, 0.5], ['A5', 0.5, 0.5], ['B5', 1, 0.5], ['C#6', 1.5, 0.5]].forEach(([n, s, d]) => {
      E('lead', hz(n), t + s * beat, d * beat - 0.03, 0.12);
      E('snare', 0, t + s * beat, 0, 0.25);
    });
    stab(9, 'dom7', t, beat * 1.8, 0.04);
    E('bass', hz('A2'), t, beat * 1.8, 0.4);
    const tf = t + 2 * beat;
    E('lead', hz('D6'), tf, 2.4, 0.13);
    [hz('D4'), hz('F#4'), hz('A4'), hz('D5'), hz('F#5')].forEach((f, i) => E('stab', f, tf, 2.4, 0.055, (i - 2) * 0.3));
    E('bass', hz('D2'), tf, 2.4, 0.45);
    E('timp', hz('D2'), tf, 2.2, 0.8);
    E('crash', 0, tf, 3.0, 0.3);
    for (let i = 0; i < 12; i++) E('sleigh', 0, tf + i * 0.1, 0, 0.045);
    ['D7', 'F#7', 'A7', 'D8'].forEach((n, i) => E('glock', hz(n), tf + i * 0.07, 0, 0.08));
    return evs;
  }

  // How to render one sample of each instrument (at gain 1)
  const SAMPLE = {
    lead: { len: (d) => d + 0.3, fn: (c, o, f, d) => brass(c, o, f, 0, d, 1, { bright: 1.15 }), sustain: true },
    leadLow: { len: (d) => d + 0.3, fn: (c, o, f, d) => brass(c, o, f, 0, d, 1), sustain: true },
    stab: { len: (d) => d + 0.3, fn: (c, o, f, d) => brass(c, o, f, 0, d, 1, { bright: 0.7 }), sustain: true },
    bass: { len: (d) => d + 0.2, fn: (c, o, f, d) => bass(c, o, f, 0, d, 1), sustain: true },
    glock: { len: () => 1.0, fn: (c, o, f) => glock(c, o, f, 0, 1) },
    timp: { len: (d) => d + 0.2, fn: (c, o, f, d) => timpani(c, o, f, 0, 1, d) },
    kick: { len: () => 0.4, fn: (c, o) => kick(c, o, 0, 1) },
    snare: { len: () => 0.3, fn: (c, o) => snare(c, o, 0, 1) },
    hat: { len: () => 0.1, fn: (c, o) => hat(c, o, 0, 1) },
    crash: { len: (d) => d + 0.1, fn: (c, o, f, d) => crash(c, o, 0, 1, d) },
    sleigh: { len: () => 0.15, fn: (c, o) => sleigh(c, o, 0, 1), variants: 4 },
  };

  async function renderSample(spec, f, dur) {
    const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const ctx = new OAC(2, Math.ceil(SR * spec.len(dur)), SR);
    spec.fn(ctx, ctx.destination, f, dur);
    return await ctx.startRendering();
  }

  async function renderTheme(len) {
    const evs = themeScore();
    // unique samples: key -> {inst, f, dur}
    const need = new Map();
    evs.forEach((e) => {
      const spec = SAMPLE[e.inst];
      const variants = spec.variants || 1;
      e.v = variants > 1 ? Math.floor(Math.random() * variants) : 0;
      const key = e.inst + '|' + e.f.toFixed(2) + '|' + e.v;
      e.key = key;
      const cur = need.get(key);
      if (!cur) need.set(key, { inst: e.inst, f: e.f, dur: e.dur });
      else cur.dur = Math.max(cur.dur, e.dur);
    });
    const samples = new Map();
    await Promise.all([...need.entries()].map(async ([key, n]) => {
      samples.set(key, await renderSample(SAMPLE[n.inst], n.f, n.dur));
    }));

    const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const ctx = new OAC(2, Math.ceil(SR * len), SR);
    const out = masterChain(ctx);
    const mix = ctx.createGain();
    mix.gain.value = 0.9;
    mix.connect(out);
    const pans = new Map();
    const panNode = (p) => {
      if (!p || !ctx.createStereoPanner) return mix;
      const k = p.toFixed(2);
      if (!pans.has(k)) { const n = ctx.createStereoPanner(); n.pan.value = p; n.connect(mix); pans.set(k, n); }
      return pans.get(k);
    };
    evs.forEach((e) => {
      const spec = SAMPLE[e.inst];
      const src = ctx.createBufferSource();
      src.buffer = samples.get(e.key);
      const g = ctx.createGain();
      g.gain.value = e.g;
      src.connect(g).connect(panNode(e.pan));
      src.start(e.t);
      if (spec.sustain) {
        g.gain.setValueAtTime(e.g, e.t + e.dur);
        g.gain.linearRampToValueAtTime(0, e.t + e.dur + 0.09);
        src.stop(e.t + e.dur + 0.12);
      }
    });
    return await ctx.startRendering();
  }

  /* ---------------- engine ---------------- */
  function masterChain(ctx) {
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -10;
    comp.ratio.value = 6;
    comp.attack.value = 0.003;
    comp.release.value = 0.15;
    comp.connect(ctx.destination);
    return comp;
  }

  function normalize(buf, target) {
    let peak = 0;
    for (let ch = 0; ch < buf.numberOfChannels; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < d.length; i++) { const v = Math.abs(d[i]); if (v > peak) peak = v; }
    }
    if (peak > 0) {
      const k = target / peak;
      for (let ch = 0; ch < buf.numberOfChannels; ch++) {
        const d = buf.getChannelData(ch);
        for (let i = 0; i < d.length; i++) d[i] *= k;
      }
    }
    return buf;
  }

  async function renderRecipe(recipe) {
    let buf;
    if (recipe.render) buf = await recipe.render(recipe.len);
    else {
      const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
      const ctx = new OAC(2, Math.ceil(SR * recipe.len), SR);
      recipe.fn(ctx, masterChain(ctx));
      buf = await ctx.startRendering();
    }
    return normalize(buf, recipe.norm || 0.8);
  }

  const MUSIC = new Set(['theme']);

  /* Every swappable sound. `file` is the name to use in the sounds/ folder. */
  const SOUND_LIST = [
    { key: 'theme', file: 'theme', label: 'Theme music', desc: 'Title & winner screens (▶ Theme button)' },
    { key: 'roundStart', file: 'round-start', label: 'New round', desc: 'When a round starts' },
    { key: 'ding', file: 'reveal', label: 'Correct answer', desc: 'An answer flips over' },
    { key: 'strike', file: 'wrong', label: 'Wrong answer', desc: 'The big X / strike' },
    { key: 'buzzin', file: 'buzz-in', label: 'Buzz-in', desc: 'Face-off buzzer (Q / P)' },
    { key: 'chaching', file: 'points', label: 'Points awarded', desc: 'The bank goes to a team' },
    { key: 'applause', file: 'applause', label: 'Applause', desc: 'After a team wins a round' },
    { key: 'fanfare', file: 'winner', label: 'Winner fanfare', desc: 'Winner screen & bonus goal reached' },
    { key: 'whoosh', file: 'bonus-answer', label: 'Bonus answer', desc: 'A bonus-round answer appears' },
    { key: 'duplicate', file: 'duplicate', label: 'Duplicate answer', desc: 'Bonus round “try again” (D)' },
    { key: 'tick', file: 'tick', label: 'Timer tick', desc: 'Bonus timer, every second' },
    { key: 'tickHigh', file: 'tick-final', label: 'Final ticks', desc: 'Bonus timer, last 5 seconds' },
    { key: 'timeup', file: 'time-up', label: "Time's up", desc: 'Bonus timer hits zero' },
  ];
  const EXTS = ['mp3', 'm4a', 'wav', 'ogg'];

  class SoundEngine {
    constructor() {
      this.ctx = null;
      this.buffers = {};   // built-in synthesized sounds
      this.folder = {};    // key -> {el, label}   files found in sounds/
      this.uploads = {};   // key -> {buffer|el, label, size}   files picked in the app
      this.vol = {};       // key -> 0..1 per-sound volume
      this.ready = false;
      this.musicReady = false;
      this.sfxVol = 0.9;
      this.musicVol = 0.55;
      this.muted = false;
      this.music = null;
      this.onchange = null;
    }

    _changed() { if (this.onchange) this.onchange(); }

    async init() {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
      this.sfxBus = this.ctx.createGain();
      this.musicBus = this.ctx.createGain();
      this.sfxBus.connect(this.master);
      this.musicBus.connect(this.master);
      this.applyVolumes();

      this.probeFolder();

      const quick = Object.keys(RECIPES).filter((n) => !MUSIC.has(n));
      for (const n of quick) {
        try { this.buffers[n] = await renderRecipe(RECIPES[n]); } catch (e) { console.error('render failed', n, e); }
      }
      this.ready = true;
      this._changed();
      for (const n of MUSIC) {
        try { this.buffers[n] = await renderRecipe(RECIPES[n]); } catch (e) { console.error('render failed', n, e); }
      }
      this.musicReady = true;
      this._changed();
    }

    /* Look for sounds/<file>.mp3|m4a|wav|ogg for every sound. */
    probeFolder() {
      this.folder = {};
      return Promise.all(SOUND_LIST.map((s) => this._probe(s))).then(() => this._changed());
    }
    _probe(s) {
      return new Promise((resolve) => {
        let i = 0;
        const tryNext = () => {
          if (i >= EXTS.length) return resolve(null);
          const rel = s.file + '.' + EXTS[i++];
          const el = new Audio();
          let done = false;
          const ok = () => { if (done) return; done = true; this.folder[s.key] = { el, label: rel }; resolve(rel); };
          const fail = () => { if (done) return; done = true; tryNext(); };
          el.addEventListener('loadedmetadata', ok, { once: true });
          el.addEventListener('canplay', ok, { once: true });
          el.addEventListener('error', fail, { once: true });
          setTimeout(fail, 6000);
          el.preload = 'auto';
          el.src = 'sounds/' + rel;
        };
        tryNext();
      });
    }

    /* A file picked in the app (Blob/File). Music streams; effects are decoded for snappy playback. */
    async setUpload(key, blob, label) {
      let entry;
      if (MUSIC.has(key)) {
        const url = URL.createObjectURL(blob);
        const el = new Audio();
        el.preload = 'auto';
        await new Promise((res, rej) => {
          el.addEventListener('loadedmetadata', res, { once: true });
          el.addEventListener('error', () => rej(new Error('unreadable audio')), { once: true });
          el.src = url;
        }).catch((e) => { URL.revokeObjectURL(url); throw e; });
        entry = { el, url, label, size: blob.size };
      } else {
        const ab = await blob.arrayBuffer();
        const buffer = await this.ctx.decodeAudioData(ab);
        entry = { buffer, label, size: blob.size };
      }
      this._revoke(key);
      this.uploads[key] = entry;
      this._changed();
    }
    clearUpload(key) {
      this._revoke(key);
      delete this.uploads[key];
      this._changed();
    }
    _revoke(key) {
      const u = this.uploads[key];
      if (u && u.url) URL.revokeObjectURL(u.url);
    }
    sourceOf(key) {
      if (this.uploads[key]) return { kind: 'upload', label: this.uploads[key].label, folder: this.folder[key] ? this.folder[key].label : null };
      if (this.folder[key]) return { kind: 'folder', label: this.folder[key].label };
      return { kind: 'builtin', label: 'Built-in' };
    }
    setSoundVolume(key, v) {
      this.vol[key] = v;
      if (this.music && this.music.name === key) this.music.setLevel(v);
    }
    volOf(key) { return this.vol[key] != null ? this.vol[key] : 1; }

    unlock() {
      if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    }

    applyVolumes() {
      if (!this.ctx) return;
      this.master.gain.value = this.muted ? 0 : 1;
      this.sfxBus.gain.value = this.sfxVol;
      this.musicBus.gain.value = this.musicVol;
      if (this.music && this.music.el) this.music.el.muted = this.muted;
    }

    setVolumes({ sfx, music, muted }) {
      if (sfx != null) this.sfxVol = sfx;
      if (music != null) this.musicVol = music;
      if (muted != null) this.muted = muted;
      this.applyVolumes();
      if (this.music) this.music.setLevel(this.volOf(this.music.name));
    }

    play(name, { gain = 1, delay = 0 } = {}) {
      if (!this.ctx) return null;
      this.unlock();
      const isMusic = MUSIC.has(name);
      if (isMusic) this.stopMusic(0.3);
      const level = this.volOf(name);
      const src = this.uploads[name] || this.folder[name];
      const handle = src && src.el
        ? this._playEl(name, src.el, gain, level, delay, isMusic)
        : this._playBuf(name, (src && src.buffer) || this.buffers[name], gain, level, delay, isMusic);
      if (handle && isMusic) { this.music = handle; this._changed(); }
      return handle;
    }

    _playEl(name, tmpl, gain, level, delay, isMusic) {
      const el = tmpl.cloneNode();
      const bus = () => (isMusic ? this.musicVol : this.sfxVol);
      const setLevel = (lv) => { el.volume = Math.max(0, Math.min(1, bus() * gain * lv)); };
      setLevel(level);
      el.muted = this.muted;
      const start = () => el.play().catch(() => {});
      delay ? setTimeout(start, delay * 1000) : start();
      let fading = null;
      const handle = {
        name, el, setLevel,
        stop: (fade = 0.6) => {
          if (fading) return;
          const v0 = el.volume, steps = 12;
          let i = 0;
          fading = setInterval(() => {
            i++;
            el.volume = Math.max(0, v0 * (1 - i / steps));
            if (i >= steps) { clearInterval(fading); el.pause(); }
          }, Math.max(10, (fade * 1000) / steps));
        },
      };
      el.addEventListener('ended', () => { if (this.music === handle) { this.music = null; this._changed(); } });
      return handle;
    }

    _playBuf(name, buf, gain, level, delay, isMusic) {
      if (!buf) return null;
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      const g = this.ctx.createGain();
      g.gain.value = gain * level;
      src.connect(g).connect(isMusic ? this.musicBus : this.sfxBus);
      src.start(this.ctx.currentTime + delay);
      const handle = {
        name, src,
        setLevel: (lv) => { g.gain.setValueAtTime(gain * lv, this.ctx.currentTime); },
        stop: (fade = 0.6) => {
          const now = this.ctx.currentTime;
          g.gain.cancelScheduledValues(now);
          g.gain.setValueAtTime(g.gain.value, now);
          g.gain.linearRampToValueAtTime(0.0001, now + fade);
          try { src.stop(now + fade + 0.05); } catch (e) { /* already stopped */ }
        },
      };
      src.onended = () => { if (this.music === handle) { this.music = null; this._changed(); } };
      return handle;
    }

    stopMusic(fade = 1.2) {
      if (this.music) {
        this.music.stop(fade);
        this.music = null;
        this._changed();
      }
    }

    isMusicPlaying() { return !!this.music; }
  }

  window.SoundEngine = SoundEngine;
  window.SOUND_LIST = SOUND_LIST;
  window.__SOUND_RECIPES = RECIPES; // exposed for testing
  window.__renderRecipe = renderRecipe;
})();
