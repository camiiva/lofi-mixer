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
    if (playBtn.disabled) return;
    playBtn.disabled = true;

    if (!(window.AudioContext || window.webkitAudioContext)) {
      setStatus('ERR: NO WEB AUDIO API');
      playBtn.disabled = false;
      return;
    }

    // SYNCHRONOUS — iOS only grants Web Audio unlock during the synchronous
    // part of a user-gesture handler. Call Tone.start() here (one context
    // only — creating a second AudioContext in the same gesture can prevent
    // iOS from unlocking Tone's context).
    const toneReady = Tone.start();

    setStatus('UNLOCKING...');
    // ── END SYNCHRONOUS SECTION ──────────────────────────────────────

    const run = async () => {
      try {
        await toneReady;
      } catch (e) {
        setStatus('ERR TONE-START: ' + e.message);
        playBtn.disabled = false;
        return;
      }

      setStatus('CTX:' + Tone.context.state + ' LOADING...');

      if (!audioReady) {
        try {
          await AudioEngine.init(currentSources(), setStatus);
          audioReady = true;
        } catch (e) {
          setStatus('ERR INIT: ' + (e && e.message ? e.message : String(e)));
          playBtn.disabled = false;
          return;
        }
      }

      try {
        AudioEngine.play();
      } catch (e) {
        setStatus('ERR PLAY: ' + (e && e.message ? e.message : String(e)));
        playBtn.disabled = false;
        return;
      }

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

  // ---------- Custom select dropdowns ----------
  function initCustomSelects() {
    document.querySelectorAll('select.ch-select').forEach(select => {
      const wrap = document.createElement('div');
      wrap.className = 'custom-select-wrap';

      const trigger = document.createElement('div');
      trigger.className = 'custom-select-trigger';
      trigger.setAttribute('tabindex', '0');
      trigger.setAttribute('role', 'button');
      trigger.setAttribute('aria-haspopup', 'listbox');
      trigger.setAttribute('aria-expanded', 'false');
      trigger.setAttribute('aria-label', select.getAttribute('aria-label') || '');

      const valueSpan = document.createElement('span');
      valueSpan.className = 'custom-select-value';
      valueSpan.textContent = select.options[select.selectedIndex]?.text || '';

      const arrow = document.createElement('span');
      arrow.className = 'custom-select-arrow';
      arrow.textContent = '▼';
      arrow.setAttribute('aria-hidden', 'true');

      trigger.appendChild(valueSpan);
      trigger.appendChild(arrow);

      const optList = document.createElement('ul');
      optList.className = 'custom-select-options';
      optList.setAttribute('role', 'listbox');

      Array.from(select.options).forEach((opt, i) => {
        const li = document.createElement('li');
        const isSelected = i === select.selectedIndex;
        li.className = 'custom-select-option' + (isSelected ? ' selected' : '');
        li.textContent = opt.text;
        li.dataset.value = opt.value;
        li.setAttribute('role', 'option');
        li.setAttribute('aria-selected', String(isSelected));

        li.addEventListener('click', () => {
          select.value = opt.value;
          valueSpan.textContent = opt.text;
          optList.querySelectorAll('.custom-select-option').forEach(el => {
            el.classList.remove('selected');
            el.setAttribute('aria-selected', 'false');
          });
          li.classList.add('selected');
          li.setAttribute('aria-selected', 'true');
          wrap.classList.remove('open');
          trigger.setAttribute('aria-expanded', 'false');
          select.dispatchEvent(new Event('change'));
        });

        optList.appendChild(li);
      });

      function closeDropdown() {
        wrap.classList.remove('open');
        trigger.setAttribute('aria-expanded', 'false');
      }

      trigger.addEventListener('click', e => {
        e.stopPropagation();
        const isOpen = wrap.classList.contains('open');
        document.querySelectorAll('.custom-select-wrap.open').forEach(w => {
          w.classList.remove('open');
          w.querySelector('.custom-select-trigger')?.setAttribute('aria-expanded', 'false');
        });
        if (!isOpen) {
          wrap.classList.add('open');
          trigger.setAttribute('aria-expanded', 'true');
        }
      });

      trigger.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); trigger.click(); }
        else if (e.key === 'Escape') closeDropdown();
      });

      select.parentNode.insertBefore(wrap, select);
      select.style.display = 'none';
      wrap.appendChild(trigger);
      wrap.appendChild(optList);
      wrap.appendChild(select);
    });

    document.addEventListener('click', () => {
      document.querySelectorAll('.custom-select-wrap.open').forEach(w => {
        w.classList.remove('open');
        w.querySelector('.custom-select-trigger')?.setAttribute('aria-expanded', 'false');
      });
    });
  }

  initCustomSelects();

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
