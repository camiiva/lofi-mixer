/**
 * LOFI.MIXER — ui.js
 * Wires DOM interactions to the AudioEngine.
 * Handles: timestamp, REC blink, glitch triggers, slider fill updates.
 */

(() => {

  // ---------- Element refs ----------
  const playBtn     = document.getElementById('play-btn');
  const stopBtn     = document.getElementById('stop-btn');
  const timestamp   = document.getElementById('timestamp');
  const statusText  = document.getElementById('status-text');
  const recDot      = document.querySelector('.rec-dot');
  const glitchTitle = document.querySelector('.glitch-title');
  const channelRows = document.querySelectorAll('.channel-row');

  const volAmbiance     = document.getElementById('vol-ambiance');
  const volBeats        = document.getElementById('vol-beats');
  const volTexture      = document.getElementById('vol-texture');
  const volInstrumental = document.getElementById('vol-instrumental');
  const warmthSlider    = document.getElementById('warmth');
  const spaceSlider     = document.getElementById('space');
  const bpmSlider       = document.getElementById('bpm');
  const bpmDisplay      = document.getElementById('bpm-display');
  const swingSlider     = document.getElementById('swing');

  const selectAmbiance     = document.getElementById('select-ambiance');
  const selectBeats        = document.getElementById('select-beats');
  const selectTexture      = document.getElementById('select-texture');
  const selectInstrumental = document.getElementById('select-instrumental');

  // ---------- State ----------
  let audioReady = false;

  function currentSources() {
    return {
      ambiance:     selectAmbiance.value,
      beats:        selectBeats.value,
      texture:      selectTexture.value,
      instrumental: selectInstrumental.value,
    };
  }

  // ---------- Timestamp counter ----------
  let seconds = 0;
  let tickInterval = null;

  function startTick() {
    seconds = 0;
    updateTimestamp();
    tickInterval = setInterval(() => { seconds++; updateTimestamp(); }, 1000);
  }

  function stopTick() {
    clearInterval(tickInterval);
    tickInterval = null;
    seconds = 0;
    updateTimestamp();
  }

  function updateTimestamp() {
    const m = String(Math.floor(seconds / 60)).padStart(2, '0');
    const s = String(seconds % 60).padStart(2, '0');
    timestamp.textContent = `${m}:${s}`;
  }

  // ---------- REC indicator ----------
  function startRec() { recDot.classList.add('blink'); }
  function stopRec()  { recDot.classList.remove('blink'); }

  // ---------- Status text ----------
  function setStatus(text) { statusText.textContent = text; }

  // ---------- Play ----------
  playBtn.addEventListener('click', () => {
    // Step 1: Unlock Web Audio synchronously — MUST be the first call,
    // with no await before it. iOS only honours user-gesture trust here.
    Tone.start();

    playBtn.disabled = true;

    const run = async () => {
      if (!audioReady) {
        setStatus('LOADING...');
        try {
          await AudioEngine.init(currentSources());
          audioReady = true;
        } catch (e) {
          console.error('[ui] init failed:', e);
          setStatus('ERR: INIT FAILED');
          playBtn.disabled = false;
          return;
        }
      }

      AudioEngine.play();
      playBtn.classList.add('active');
      stopBtn.disabled = false;
      startTick();
      startRec();
      setStatus('PLAYING...');
    };

    run();
  });

  // ---------- Stop ----------
  stopBtn.addEventListener('click', () => {
    AudioEngine.stop();
    playBtn.disabled = false;
    playBtn.classList.remove('active');
    stopBtn.disabled = true;
    stopTick();
    stopRec();
    setStatus('STOPPED');
  });

  // ---------- Volume sliders ----------
  function bindVolumeSlider(slider, channelName) {
    slider.addEventListener('input', () => {
      const val = Number(slider.value);
      slider.style.setProperty('--fill', `${val}%`);
      AudioEngine.setChannelVolume(channelName, val);
    });
  }

  bindVolumeSlider(volAmbiance,     'ambiance');
  bindVolumeSlider(volBeats,        'beats');
  bindVolumeSlider(volTexture,      'texture');
  bindVolumeSlider(volInstrumental, 'instrumental');

  // ---------- FX sliders ----------
  warmthSlider.addEventListener('input', () => {
    const val = Number(warmthSlider.value);
    warmthSlider.style.setProperty('--fill', `${val}%`);
    AudioEngine.setWarmth(val);
  });

  spaceSlider.addEventListener('input', () => {
    const val = Number(spaceSlider.value);
    spaceSlider.style.setProperty('--fill', `${val}%`);
    AudioEngine.setReverb(val);
  });

  bpmSlider.addEventListener('input', () => {
    const val = Number(bpmSlider.value);
    bpmSlider.style.setProperty('--fill', `${((val - 55) / 55) * 100}%`);
    bpmDisplay.textContent = val;
    AudioEngine.setBPM(val);
  });

  swingSlider.addEventListener('input', () => {
    const val = Number(swingSlider.value);
    swingSlider.style.setProperty('--fill', `${(val / 66) * 100}%`);
    AudioEngine.setSwing(val);
  });

  // ---------- Source selects ----------
  function bindSourceSelect(select, channelName) {
    select.addEventListener('change', () => {
      // Only swap if audio is already running; otherwise the value is
      // picked up naturally when init() runs on the next PLAY tap.
      if (audioReady) AudioEngine.setChannelSource(channelName, select.value);
    });
  }

  bindSourceSelect(selectAmbiance,     'ambiance');
  bindSourceSelect(selectBeats,        'beats');
  bindSourceSelect(selectTexture,      'texture');
  bindSourceSelect(selectInstrumental, 'instrumental');

  // ---------- Glitch title — periodic random trigger ----------
  function triggerTitleGlitch() {
    if (glitchTitle.classList.contains('is-glitching')) return;
    glitchTitle.classList.add('is-glitching');
    setTimeout(() => glitchTitle.classList.remove('is-glitching'), 220);
  }

  function scheduleNextGlitch() {
    const delay = 3000 + Math.random() * 9000;
    setTimeout(() => { triggerTitleGlitch(); scheduleNextGlitch(); }, delay);
  }
  scheduleNextGlitch();

  // ---------- Tracking glitch — random channel rows ----------
  function triggerTrackingGlitch() {
    const rows = Array.from(channelRows);
    const target = rows[Math.floor(Math.random() * rows.length)];
    target.classList.add('is-tracking');
    setTimeout(() => target.classList.remove('is-tracking'), 150);
  }

  function scheduleNextTracking() {
    const delay = 6000 + Math.random() * 14000;
    setTimeout(() => { triggerTrackingGlitch(); scheduleNextTracking(); }, delay);
  }
  scheduleNextTracking();

})();
