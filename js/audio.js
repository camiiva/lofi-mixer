/**
 * LOFI.MIXER — audio.js (improved synthesis)
 *
 * Signal chain per channel:
 *   Synth output → Tone.Volume → shared Filter → shared Reverb → Destination
 */

const AudioEngine = (() => {

  let masterFilter = null;
  let masterReverb = null;

  const channels = {
    ambiance:     { synth: null, volume: null },
    beats:        { synth: null, volume: null },
    texture:      { synth: null, volume: null },
    instrumental: { synth: null, volume: null },
  };

  let initialized = false;
  let playing     = false;

  // Shared playback params (read live by sequencers)
  const params = { bpm: 75, swing: 0 }; // swing: 0–66 (%)

  // ---------- Helpers ----------

  function toDB(val) {
    if (val === 0) return -Infinity;
    return -40 + (val / 100) * 40;
  }

  function warmthToFreq(val) {
    return 400 + (val / 100) * 7600;
  }

  function connectSynth(synth, name) {
    if (synth?.output) synth.output.connect(channels[name].volume);
  }

  // Tiny random timing humanisation (±ms)
  function jitter(ms = 6) {
    return (Math.random() - 0.5) * (ms / 1000);
  }

  // Velocity humanisation (0.65–1.0)
  function vel(base = 0.85, spread = 0.2) {
    return Math.min(1, Math.max(0.01, base + (Math.random() - 0.5) * spread));
  }

  // Current swing delay for odd 16th-note steps
  function swingOffset() {
    const sixteenth = Tone.Time('16n').toSeconds();
    return sixteenth * (params.swing / 100) * 0.5;
  }

  // ---------- Ambiance synths ----------

  function makeRainSynth() {
    // Three layered noise bands — no wobble LFO
    const rumble = new Tone.Noise('pink');
    const body   = new Tone.Noise('pink');
    const splash = new Tone.Noise('white');

    const rumbleF = new Tone.Filter({ type: 'lowpass',  frequency: 320,  rolloff: -24 });
    const bodyF   = new Tone.Filter({ type: 'bandpass', frequency: 1400, Q: 0.6 });
    const splashF = new Tone.Filter({ type: 'highpass', frequency: 5000 });

    const rumbleG = new Tone.Volume(-8);
    const bodyG   = new Tone.Volume(-4);
    const splashG = new Tone.Volume(-16);

    const merge = new Tone.Gain(1);

    // Very-slow breath swell (imperceptible as modulation)
    const breath = new Tone.LFO({ frequency: 0.018, min: 0.9, max: 1.0 });
    breath.connect(merge.gain);

    rumble.chain(rumbleF, rumbleG, merge);
    body.chain(bodyF,     bodyG,   merge);
    splash.chain(splashF, splashG, merge);

    return {
      output: merge,
      start()   { breath.start(); rumble.start(); body.start(); splash.start(); },
      stop()    { breath.stop();  rumble.stop();  body.stop();  splash.stop();  },
      dispose() {
        breath.dispose();
        [rumble, body, splash, rumbleF, bodyF, splashF, rumbleG, bodyG, splashG, merge]
          .forEach(n => n.dispose());
      },
    };
  }

  function makeCafeSynth() {
    // Voice murmur: three overlapping bandpass channels (simulates speech formants)
    const n1 = new Tone.Noise('pink');
    const n2 = new Tone.Noise('pink');
    const n3 = new Tone.Noise('brown');
    const f1 = new Tone.Filter({ type: 'bandpass', frequency: 700,  Q: 1.2 });
    const f2 = new Tone.Filter({ type: 'bandpass', frequency: 1300, Q: 0.9 });
    const f3 = new Tone.Filter({ type: 'bandpass', frequency: 400,  Q: 0.6 });
    const g1 = new Tone.Volume(-8);
    const g2 = new Tone.Volume(-10);
    const g3 = new Tone.Volume(-6);

    const merge = new Tone.Gain(1);
    n1.chain(f1, g1, merge);
    n2.chain(f2, g2, merge);
    n3.chain(f3, g3, merge);

    // Slow conversational swell
    const murmurLFO = new Tone.LFO({ frequency: 0.06, min: 0.75, max: 1.0 });
    murmurLFO.connect(merge.gain);

    // Soft cutlery clink (gentler than MetalSynth — noise envelope)
    const clinkNoise = new Tone.Noise('white');
    const clinkEnv   = new Tone.AmplitudeEnvelope({ attack: 0.001, decay: 0.18, sustain: 0, release: 0.08 });
    const clinkHi    = new Tone.Filter({ type: 'bandpass', frequency: 3500, Q: 2 });
    const clinkVol   = new Tone.Volume(-20);
    clinkNoise.chain(clinkEnv, clinkHi, clinkVol, merge);

    const clinkLoop = new Tone.Loop((time) => {
      if (Math.random() < 0.2) clinkEnv.triggerAttackRelease('16n', time);
    }, '1.5n');

    return {
      output: merge,
      start()   { murmurLFO.start(); n1.start(); n2.start(); n3.start(); clinkNoise.start(); clinkLoop.start('+0'); },
      stop()    { murmurLFO.stop();  n1.stop();  n2.stop();  n3.stop();  clinkNoise.stop();  clinkLoop.stop(); },
      dispose() {
        murmurLFO.dispose(); clinkLoop.dispose();
        [n1,n2,n3,f1,f2,f3,g1,g2,g3,merge,clinkNoise,clinkEnv,clinkHi,clinkVol]
          .forEach(n => n.dispose());
      },
    };
  }

  function makeForestSynth() {
    // Wind: low pink noise with very slow amplitude swell
    const wind   = new Tone.Noise('pink');
    const windF  = new Tone.Filter({ type: 'lowpass', frequency: 600, rolloff: -48 });
    const windLFO = new Tone.LFO({ frequency: 0.025, min: 0.6, max: 1.0 });
    const windG  = new Tone.Volume(-4);
    wind.chain(windF, windG);
    windLFO.connect(windG.volume); // swell the gain, not the filter

    // Distant stream: bandpass of brown noise
    const stream  = new Tone.Noise('brown');
    const streamF = new Tone.Filter({ type: 'bandpass', frequency: 500, Q: 0.3 });
    const streamG = new Tone.Volume(-12);
    stream.chain(streamF, streamG);

    const merge = new Tone.Gain(1);
    windG.connect(merge);
    streamG.connect(merge);

    // Birds: three synth voices with different ranges
    const bird = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'sine' },
      envelope: { attack: 0.015, decay: 0.1, sustain: 0, release: 0.06 },
      volume: -18,
    });
    bird.connect(merge);

    const birdLoop = new Tone.Loop((time) => {
      if (Math.random() < 0.18) {
        const freqs = [
          1200 + Math.random() * 800,
          2000 + Math.random() * 1200,
          900  + Math.random() * 600,
        ];
        const f = freqs[Math.floor(Math.random() * freqs.length)];
        bird.triggerAttackRelease(f, '32n', time);
        if (Math.random() < 0.5)
          bird.triggerAttackRelease(f * (1.15 + Math.random() * 0.15), '32n', time + 0.09 + Math.random() * 0.05);
        if (Math.random() < 0.25)
          bird.triggerAttackRelease(f * 0.85, '32n', time + 0.18);
      }
    }, '1.2n');

    return {
      output: merge,
      start()   { windLFO.start(); wind.start(); stream.start(); birdLoop.start('+0'); },
      stop()    { windLFO.stop();  wind.stop();  stream.stop();  birdLoop.stop(); },
      dispose() {
        windLFO.dispose(); birdLoop.dispose();
        [wind, windF, windG, stream, streamF, streamG, merge, bird]
          .forEach(n => n.dispose());
      },
    };
  }

  // ---------- Beat synths ----------

  function buildDrumKit() {
    // Kick: sine + click noise for punch
    const kickSine = new Tone.Synth({
      oscillator: { type: 'sine' },
      envelope: { attack: 0.001, decay: 0.35, sustain: 0, release: 0.1 },
      volume: -2,
    });
    const kickClick = new Tone.NoiseSynth({
      noise: { type: 'white' },
      envelope: { attack: 0.001, decay: 0.02, sustain: 0, release: 0.005 },
      volume: -10,
    });
    const kickClickF = new Tone.Filter({ type: 'bandpass', frequency: 800, Q: 0.5 });
    kickClick.connect(kickClickF);

    // Snare: tonal body + noise crack
    const snareTone = new Tone.Synth({
      oscillator: { type: 'triangle' },
      envelope: { attack: 0.001, decay: 0.08, sustain: 0, release: 0.04 },
      volume: -12,
    });
    const snareNoise = new Tone.NoiseSynth({
      noise: { type: 'white' },
      envelope: { attack: 0.001, decay: 0.14, sustain: 0, release: 0.04 },
      volume: -8,
    });
    const snareF = new Tone.Filter({ type: 'bandpass', frequency: 2500, Q: 0.8 });
    snareNoise.connect(snareF);

    // Hi-hat: short white noise, very high-pass
    const hat = new Tone.NoiseSynth({
      noise: { type: 'white' },
      envelope: { attack: 0.001, decay: 0.032, sustain: 0, release: 0.008 },
      volume: -18,
    });
    const hatF = new Tone.Filter({ type: 'highpass', frequency: 8000 });
    hat.connect(hatF);

    const merge = new Tone.Gain(1);
    kickSine.connect(merge);
    kickClickF.connect(merge);
    snareTone.connect(merge);
    snareF.connect(merge);
    hatF.connect(merge);

    function triggerKick(time) {
      // Pitch sweep: start high, fall to fundamental
      kickSine.triggerAttack('C2', time, vel(0.9, 0.15));
      kickSine.frequency.setValueAtTime(180, time);
      kickSine.frequency.exponentialRampToValueAtTime(50, time + 0.18);
      kickSine.triggerRelease(time + 0.38);
      kickClick.triggerAttackRelease('32n', time, vel(0.8, 0.2));
    }

    function triggerSnare(time) {
      snareTone.triggerAttackRelease(220, '16n', time, vel(0.75, 0.2));
      snareNoise.triggerAttackRelease('8n', time, vel(0.8, 0.2));
    }

    function triggerHat(time) {
      hat.triggerAttackRelease('16n', time, vel(0.5, 0.3));
    }

    function dispose() {
      [kickSine, kickClick, kickClickF, snareTone, snareNoise, snareF, hat, hatF, merge]
        .forEach(n => n.dispose());
    }

    return { merge, triggerKick, triggerSnare, triggerHat, dispose };
  }

  function makeLoFiHipHopBeat() {
    Tone.Transport.bpm.value = params.bpm;

    const kit = buildDrumKit();

    // Syncopated lo-fi kick / snare pattern (16 steps)
    const kickPat  = [1,0,0,1,0,0,1,0,1,0,0,0,1,0,0,0];
    const snarePat = [0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0];
    const hatPat   = [1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0];

    const seq = new Tone.Sequence((time, i) => {
      const odd = i % 2 === 1;
      const t   = time + (odd ? swingOffset() : 0) + jitter(5);
      if (kickPat[i])  kit.triggerKick(t);
      if (snarePat[i]) kit.triggerSnare(t);
      if (hatPat[i])   kit.triggerHat(t);
    }, [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15], '16n');

    return {
      output: kit.merge,
      start()   { seq.start(0); },
      stop()    { seq.stop(); },
      dispose() { seq.dispose(); kit.dispose(); },
    };
  }

  function makeBoomBapBeat() {
    Tone.Transport.bpm.value = params.bpm;
    const kit = buildDrumKit();

    // Heavy syncopated kick, sharp snare, sparse off-beat hat
    const kickPat  = [1,0,0,0,0,0,1,0,1,0,0,0,0,0,0,0];
    const snarePat = [0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0];
    const hatPat   = [0,0,1,0,0,0,1,0,0,0,1,0,0,0,1,0]; // off-beat

    const seq = new Tone.Sequence((time, i) => {
      const odd = i % 2 === 1;
      const t   = time + (odd ? swingOffset() : 0) + jitter(6);
      if (kickPat[i])  kit.triggerKick(t);
      if (snarePat[i]) kit.triggerSnare(t);
      if (hatPat[i])   kit.triggerHat(t);
    }, [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15], '16n');

    return {
      output: kit.merge,
      start()   { seq.start(0); },
      stop()    { seq.stop(); },
      dispose() { seq.dispose(); kit.dispose(); },
    };
  }

  function makeHalfTimeBeat() {
    Tone.Transport.bpm.value = params.bpm;
    const kit = buildDrumKit();

    // Snare only on beat 3 — wide open, meditative
    const kickPat  = [1,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0];
    const snarePat = [0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0];
    const hatPat   = [1,0,1,0,0,0,1,0,1,0,1,0,0,0,1,0];

    const seq = new Tone.Sequence((time, i) => {
      const odd = i % 2 === 1;
      const t   = time + (odd ? swingOffset() : 0) + jitter(7);
      if (kickPat[i])  kit.triggerKick(t);
      if (snarePat[i]) kit.triggerSnare(t);
      if (hatPat[i])   kit.triggerHat(t);
    }, [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15], '16n');

    return {
      output: kit.merge,
      start()   { seq.start(0); },
      stop()    { seq.stop(); },
      dispose() { seq.dispose(); kit.dispose(); },
    };
  }

  function makeTrapBeat() {
    Tone.Transport.bpm.value = params.bpm;

    // 808-style kick: very low, long decay, big pitch sweep
    const kick808 = new Tone.Synth({
      oscillator: { type: 'sine' },
      envelope: { attack: 0.001, decay: 0.9, sustain: 0, release: 0.2 },
      volume: 0,
    });
    const kickClick = new Tone.NoiseSynth({
      noise: { type: 'white' },
      envelope: { attack: 0.001, decay: 0.015, sustain: 0, release: 0.005 },
      volume: -12,
    });
    const kickClickF = new Tone.Filter({ type: 'bandpass', frequency: 900, Q: 0.5 });
    kickClick.connect(kickClickF);

    const snareTone = new Tone.Synth({
      oscillator: { type: 'triangle' },
      envelope: { attack: 0.001, decay: 0.06, sustain: 0, release: 0.03 },
      volume: -14,
    });
    const snareNoise = new Tone.NoiseSynth({
      noise: { type: 'white' },
      envelope: { attack: 0.001, decay: 0.12, sustain: 0, release: 0.03 },
      volume: -9,
    });
    const snareF = new Tone.Filter({ type: 'bandpass', frequency: 2800, Q: 0.9 });
    snareNoise.connect(snareF);

    // Trap hat: fast, tight, high-frequency
    const hat = new Tone.NoiseSynth({
      noise: { type: 'white' },
      envelope: { attack: 0.001, decay: 0.018, sustain: 0, release: 0.005 },
      volume: -20,
    });
    const hatF = new Tone.Filter({ type: 'highpass', frequency: 9000 });
    hat.connect(hatF);

    const merge = new Tone.Gain(1);
    kick808.connect(merge);
    kickClickF.connect(merge);
    snareTone.connect(merge);
    snareF.connect(merge);
    hatF.connect(merge);

    function triggerKick808(time) {
      kick808.triggerAttack('A1', time, vel(0.95, 0.08));
      kick808.frequency.setValueAtTime(130, time);
      kick808.frequency.exponentialRampToValueAtTime(38, time + 0.35);
      kick808.triggerRelease(time + 0.9);
      kickClick.triggerAttackRelease('32n', time, vel(0.7, 0.2));
    }

    // Trap pattern: syncopated kick, snare on 2/4, rolling 16th hats
    const kickPat  = [1,0,0,0,0,1,0,0,0,0,0,0,1,0,0,0];
    const snarePat = [0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0];
    const hatPat   = [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1]; // rolling 16ths
    // Hat accents on beats (louder every other hit)
    const hatAccent = [1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0];

    const seq = new Tone.Sequence((time, i) => {
      const t = time + jitter(3);
      if (kickPat[i])  triggerKick808(t);
      if (snarePat[i]) {
        snareTone.triggerAttackRelease(220, '16n', t, vel(0.7, 0.15));
        snareNoise.triggerAttackRelease('8n', t, vel(0.75, 0.15));
      }
      if (hatPat[i]) {
        hat.triggerAttackRelease('16n', t, vel(hatAccent[i] ? 0.55 : 0.28, 0.15));
      }
    }, [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15], '16n');

    return {
      output: merge,
      start()   { seq.start(0); },
      stop()    { seq.stop(); },
      dispose() {
        seq.dispose();
        [kick808, kickClick, kickClickF, snareTone, snareNoise, snareF, hat, hatF, merge]
          .forEach(n => n.dispose());
      },
    };
  }

  function makeBossaNovaBeat() {
    Tone.Transport.bpm.value = params.bpm;
    const kit = buildDrumKit();

    // Clave-inspired syncopated hat (3-2 son clave approximation)
    // Kick on 1 and 3, light snare ghost notes, clave hat pattern
    const kickPat  = [1,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0];
    const snarePat = [0,0,0,0,1,0,0,1,0,0,0,0,1,0,1,0]; // ghost notes
    const hatPat   = [1,0,0,1,0,1,0,0,1,0,0,1,0,1,0,0]; // clave-like

    const seq = new Tone.Sequence((time, i) => {
      const t = time + jitter(5);
      if (kickPat[i])  kit.triggerKick(t);
      if (snarePat[i]) kit.triggerSnare(t);
      if (hatPat[i])   kit.triggerHat(t);
    }, [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15], '16n');

    return {
      output: kit.merge,
      start()   { seq.start(0); },
      stop()    { seq.stop(); },
      dispose() { seq.dispose(); kit.dispose(); },
    };
  }

  function makeJazzBeat() {
    Tone.Transport.bpm.value = params.bpm;

    const kit = buildDrumKit();

    // Ride cymbal instead of hat
    const ride = new Tone.MetalSynth({
      frequency: 320,
      envelope: { attack: 0.001, decay: 0.26, release: 0.22 },
      harmonicity: 5.1,
      modulationIndex: 12,
      resonance: 2600,
      octaves: 1.3,
      volume: -20,
    });
    ride.connect(kit.merge);

    // Jazz swung 8ths: ride on 0, 3, 6, 9, 12 (triplet grid)
    const kickPat  = [1,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0];
    const snarePat = [0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0];
    const ridePat  = [1,0,0,1,0,0,1,0,0,1,0,0,1,0,0,0];

    const seq = new Tone.Sequence((time, i) => {
      const odd = i % 2 === 1;
      const t   = time + (odd ? swingOffset() : 0) + jitter(4);
      if (kickPat[i])  kit.triggerKick(t);
      if (snarePat[i]) kit.triggerSnare(t);
      if (ridePat[i])  ride.triggerAttackRelease('16n', t, vel(0.55, 0.25));
    }, [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15], '16n');

    return {
      output: kit.merge,
      start()   { seq.start(0); },
      stop()    { seq.stop(); },
      dispose() { seq.dispose(); kit.dispose(); ride.dispose(); },
    };
  }

  // ---------- Texture synths ----------

  function makeVinylCrackleSynth() {
    const noise = new Tone.Noise('white');
    const env   = new Tone.AmplitudeEnvelope({ attack: 0.001, decay: 0.015, sustain: 0, release: 0.008 });
    const hi    = new Tone.Filter({ type: 'highpass', frequency: 2500 });
    const lo    = new Tone.Filter({ type: 'lowpass',  frequency: 10000 });
    noise.chain(env, hi, lo);

    const crackleLoop = new Tone.Loop((time) => {
      const n = Math.floor(Math.random() * 4);
      for (let i = 0; i < n; i++) {
        env.triggerAttackRelease('32n', time + Math.random() * 0.22);
      }
    }, '8n');

    return {
      output: lo,
      start()   { noise.start(); crackleLoop.start('+0'); },
      stop()    { noise.stop();  crackleLoop.stop(); },
      dispose() { [noise, env, hi, lo, crackleLoop].forEach(n => n.dispose()); },
    };
  }

  function makeTapeHissSynth() {
    const noise = new Tone.Noise('white');
    const hi    = new Tone.Filter({ type: 'highpass', frequency: 4500 });
    const lo    = new Tone.Filter({ type: 'lowpass',  frequency: 14000 });
    noise.chain(hi, lo);
    return {
      output: lo,
      start()   { noise.start(); },
      stop()    { noise.stop(); },
      dispose() { [noise, hi, lo].forEach(n => n.dispose()); },
    };
  }

  // ---------- Instrumental synths ----------

  // Am7 → Fmaj7 → Cmaj7 → Em7 progression (4-bar loop)
  // Notation: 'bar:beat:sixteenth' (Tone.js transport time)
  const ARPEGGIO_EVENTS = [
    // Am7
    { time: '0:0:0', notes: ['A3'],       dur: '8n' },
    { time: '0:0:2', notes: ['C4'],       dur: '8n' },
    { time: '0:1:0', notes: ['E4'],       dur: '4n' },
    { time: '0:2:0', notes: ['G4'],       dur: '8n' },
    { time: '0:2:2', notes: ['E4'],       dur: '8n' },
    { time: '0:3:0', notes: ['A3', 'E4'], dur: '4n' },
    // Fmaj7
    { time: '1:0:0', notes: ['F3'],       dur: '8n' },
    { time: '1:0:2', notes: ['A3'],       dur: '8n' },
    { time: '1:1:0', notes: ['C4'],       dur: '4n' },
    { time: '1:2:0', notes: ['E4'],       dur: '8n' },
    { time: '1:2:2', notes: ['C4'],       dur: '8n' },
    { time: '1:3:0', notes: ['F3', 'C4'], dur: '4n' },
    // Cmaj7
    { time: '2:0:0', notes: ['C3'],       dur: '8n' },
    { time: '2:0:2', notes: ['E3'],       dur: '8n' },
    { time: '2:1:0', notes: ['G3'],       dur: '4n' },
    { time: '2:2:0', notes: ['B3'],       dur: '8n' },
    { time: '2:2:2', notes: ['G3'],       dur: '8n' },
    { time: '2:3:0', notes: ['C3', 'G3'], dur: '4n' },
    // Em7
    { time: '3:0:0', notes: ['E3'],       dur: '8n' },
    { time: '3:0:2', notes: ['G3'],       dur: '8n' },
    { time: '3:1:0', notes: ['B3'],       dur: '4n' },
    { time: '3:2:0', notes: ['D4'],       dur: '8n' },
    { time: '3:2:2', notes: ['B3'],       dur: '8n' },
    { time: '3:3:0', notes: ['E3', 'B3'], dur: '4n' },
  ];

  const PAD_EVENTS = [
    { time: '0:0:0', notes: ['A3', 'C4', 'E4', 'G4'], dur: '1m' },
    { time: '1:0:0', notes: ['F3', 'A3', 'C4', 'E4'], dur: '1m' },
    { time: '2:0:0', notes: ['C3', 'E3', 'G3', 'B3'], dur: '1m' },
    { time: '3:0:0', notes: ['E3', 'G3', 'B3', 'D4'], dur: '1m' },
  ];

  const GUITAR_EVENTS = [
    // Am - bar 0
    { time: '0:0:0', note: 'A2' }, { time: '0:0:2', note: 'E3' },
    { time: '0:1:0', note: 'A3' }, { time: '0:1:2', note: 'C4' },
    { time: '0:2:0', note: 'E4' }, { time: '0:2:2', note: 'A3' },
    { time: '0:3:0', note: 'C4' }, { time: '0:3:2', note: 'E4' },
    // Fmaj7 - bar 1
    { time: '1:0:0', note: 'F2' }, { time: '1:0:2', note: 'C3' },
    { time: '1:1:0', note: 'F3' }, { time: '1:1:2', note: 'A3' },
    { time: '1:2:0', note: 'C4' }, { time: '1:2:2', note: 'E4' },
    { time: '1:3:0', note: 'A3' }, { time: '1:3:2', note: 'C4' },
    // Cmaj7 - bar 2
    { time: '2:0:0', note: 'C2' }, { time: '2:0:2', note: 'G2' },
    { time: '2:1:0', note: 'C3' }, { time: '2:1:2', note: 'E3' },
    { time: '2:2:0', note: 'G3' }, { time: '2:2:2', note: 'B3' },
    { time: '2:3:0', note: 'E3' }, { time: '2:3:2', note: 'G3' },
    // Em7 - bar 3
    { time: '3:0:0', note: 'E2' }, { time: '3:0:2', note: 'B2' },
    { time: '3:1:0', note: 'E3' }, { time: '3:1:2', note: 'G3' },
    { time: '3:2:0', note: 'B3' }, { time: '3:2:2', note: 'D4' },
    { time: '3:3:0', note: 'G3' }, { time: '3:3:2', note: 'B3' },
  ];

  function makePart(events, callback) {
    const part = new Tone.Part(callback, events);
    part.loop    = true;
    part.loopEnd = '4m';
    return part;
  }

  function makeLoFiPiano() {
    const synth = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'triangle' },
      envelope: { attack: 0.025, decay: 0.55, sustain: 0.28, release: 1.6 },
      volume: -8,
    });
    synth.set({ detune: -12 }); // slightly flat = warmer

    const chorus = new Tone.Chorus({ frequency: 1.2, delayTime: 4, depth: 0.28, wet: 0.38 });
    const merge  = new Tone.Gain(1);
    synth.chain(chorus, merge);

    const part = makePart(ARPEGGIO_EVENTS, (time, { notes, dur }) => {
      const note = notes.length === 1 ? notes[0] : notes;
      synth.triggerAttackRelease(note, dur, time, vel(0.62, 0.28));
    });

    return {
      output: merge,
      start()   { chorus.start(); part.start(0); },
      stop()    { part.stop(); },
      dispose() { part.dispose(); synth.dispose(); chorus.dispose(); merge.dispose(); },
    };
  }

  function makeEPiano() {
    // Rhodes-like: triangle wave + tremolo + slight detune
    const synth = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'triangle' },
      envelope: { attack: 0.005, decay: 0.7, sustain: 0.12, release: 1.8 },
      volume: -8,
    });
    synth.set({ detune: 6 });

    const tremolo = new Tone.Tremolo({ frequency: 4.8, depth: 0.28, wet: 0.65 });
    const chorus  = new Tone.Chorus({ frequency: 0.7, delayTime: 3.5, depth: 0.2, wet: 0.3 });
    const merge   = new Tone.Gain(1);
    synth.chain(tremolo, chorus, merge);

    const part = makePart(ARPEGGIO_EVENTS, (time, { notes, dur }) => {
      const note = notes.length === 1 ? notes[0] : notes;
      synth.triggerAttackRelease(note, dur, time, vel(0.68, 0.22));
    });

    return {
      output: merge,
      start()   { tremolo.start(); chorus.start(); part.start(0); },
      stop()    { part.stop(); },
      dispose() { part.dispose(); synth.dispose(); tremolo.dispose(); chorus.dispose(); merge.dispose(); },
    };
  }

  function makeSynthPad() {
    const synth = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'sawtooth' },
      envelope: { attack: 1.4, decay: 0.6, sustain: 0.85, release: 2.8 },
      volume: -14,
    });

    const filter = new Tone.Filter({ type: 'lowpass', frequency: 1100, Q: 0.4 });
    const chorus = new Tone.Chorus({ frequency: 0.4, delayTime: 9, depth: 0.55, wet: 0.65 });
    const merge  = new Tone.Gain(1);
    synth.chain(filter, chorus, merge);

    const part = makePart(PAD_EVENTS, (time, { notes, dur }) => {
      synth.triggerAttackRelease(notes, dur, time, vel(0.72, 0.14));
    });

    return {
      output: merge,
      start()   { chorus.start(); part.start(0); },
      stop()    { part.stop(); },
      dispose() { part.dispose(); synth.dispose(); filter.dispose(); chorus.dispose(); merge.dispose(); },
    };
  }

  function makePluckGuitar() {
    // Karplus-Strong string synthesis
    const pluck = new Tone.PluckSynth({
      attackNoise: 1.8,
      dampening:   3200,
      resonance:   0.93,
      volume:      -6,
    });

    const chorus = new Tone.Chorus({ frequency: 0.5, delayTime: 5.5, depth: 0.32, wet: 0.45 });
    const merge  = new Tone.Gain(1);
    pluck.chain(chorus, merge);

    const part = makePart(GUITAR_EVENTS, (time, { note }) => {
      pluck.triggerAttack(note, time);
    });

    return {
      output: merge,
      start()   { chorus.start(); part.start(0); },
      stop()    { part.stop(); },
      dispose() { part.dispose(); pluck.dispose(); chorus.dispose(); merge.dispose(); },
    };
  }

  // ---------- Registry ----------

  const factories = {
    ambiance: { rain: makeRainSynth, cafe: makeCafeSynth, forest: makeForestSynth },
    beats: {
      'lofi-hiphop': makeLoFiHipHopBeat,
      'boom-bap':    makeBoomBapBeat,
      'halftime':    makeHalfTimeBeat,
      'trap':        makeTrapBeat,
      'jazz':        makeJazzBeat,
      'bossa-nova':  makeBossaNovaBeat,
      'none':        null,
    },
    texture:  { 'vinyl-crackle': makeVinylCrackleSynth, 'tape-hiss': makeTapeHissSynth, none: null },
    instrumental: { piano: makeLoFiPiano, 'e-piano': makeEPiano, pad: makeSynthPad, guitar: makePluckGuitar, none: null },
  };

  const initialVolumes = { ambiance: 70, beats: 60, texture: 40, instrumental: 55 };

  // ---------- Public API ----------

  async function init(sourceKeys) {
    masterFilter = new Tone.Filter({ type: 'lowpass', frequency: warmthToFreq(55), rolloff: -12 });
    masterReverb = new Tone.Reverb({ decay: 3.5, wet: 0.30 });
    await masterReverb.ready;
    masterFilter.chain(masterReverb, Tone.Destination);

    for (const [name, key] of Object.entries(sourceKeys)) {
      const vol = new Tone.Volume(toDB(initialVolumes[name] ?? 50));
      vol.connect(masterFilter);
      channels[name].volume = vol;

      const factory = factories[name]?.[key];
      if (factory) {
        channels[name].synth = factory();
        connectSynth(channels[name].synth, name);
      }
    }

    initialized = true;
  }

  async function play() {
    if (!initialized) return;
    await Tone.start();
    playing = true;
    Tone.Transport.start();
    for (const ch of Object.values(channels)) ch.synth?.start();
  }

  function stop() {
    playing = false;
    for (const ch of Object.values(channels)) ch.synth?.stop();
    Tone.Transport.stop();
  }

  function setChannelVolume(name, val) {
    channels[name]?.volume?.volume.rampTo(toDB(val), 0.05);
  }

  function setChannelSource(name, key) {
    const ch = channels[name];
    if (!ch) return;
    if (ch.synth) { ch.synth.stop(); ch.synth.dispose(); ch.synth = null; }

    const factory = factories[name]?.[key];
    if (!factory) return;

    ch.synth = factory();
    connectSynth(ch.synth, name);
    if (playing) ch.synth.start();
  }

  function setWarmth(val) {
    masterFilter?.frequency.rampTo(warmthToFreq(val), 0.12);
  }

  function setReverb(val) {
    if (masterReverb) masterReverb.wet.rampTo(val / 100, 0.15);
  }

  function setBPM(val) {
    params.bpm = val;
    Tone.Transport.bpm.rampTo(val, 0.5);
  }

  function setSwing(val) {
    params.swing = val; // read live by sequencer callbacks
  }

  function isPlaying() { return playing; }

  return { init, play, stop, setChannelVolume, setChannelSource, setWarmth, setReverb, setBPM, setSwing, isPlaying };
})();
