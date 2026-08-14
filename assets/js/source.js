/* =============================================================================
   source.js — Device 1. Tone generator and automatic octave-band sweep.
   ========================================================================== */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  var settings = RJ.getSettings();

  var ctx = null;          /* AudioContext, created on first user gesture */
  var master = null;       /* master gain -> destination                  */
  var voice = null;        /* { osc|src, gain } currently sounding        */
  var currentFreq = null;
  var wave = 'sine';
  var levelDb = settings.level == null ? -12 : settings.level;

  var sweep = { running: false, timers: [], index: 0, plan: [], startedAt: 0, total: 0 };

  var RAMP = 0.05;         /* click-free envelope, seconds */

  /* --------------------------------------------------------------- audio */

  function audio() {
    if (!ctx) {
      ctx = RJ.makeContext();
      master = ctx.createGain();
      master.gain.value = 1;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function amplitude() { return RJ.fromDb(levelDb); }

  function stopVoice(now) {
    if (!voice) return;
    var t = now || ctx.currentTime;
    var v = voice;
    voice = null;
    try {
      v.gain.gain.cancelScheduledValues(t);
      v.gain.gain.setValueAtTime(v.gain.gain.value, t);
      v.gain.gain.linearRampToValueAtTime(0.0001, t + RAMP);
      v.node.stop(t + RAMP + 0.02);
    } catch (e) { /* already stopped */ }
  }

  function playTone(freq, when, duration) {
    var c = audio();
    var t0 = when == null ? c.currentTime : when;
    var gain = c.createGain();
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.linearRampToValueAtTime(amplitude(), t0 + RAMP);
    gain.connect(master);

    var node;
    if (wave === 'pink') {
      node = c.createBufferSource();
      node.buffer = RJ.makePinkNoise(c, 3);
      node.loop = true;
    } else {
      node = c.createOscillator();
      node.type = 'sine';
      node.frequency.setValueAtTime(freq, t0);
    }
    node.connect(gain);
    node.start(t0);

    if (duration != null) {
      var end = t0 + duration;
      gain.gain.setValueAtTime(amplitude(), end - RAMP);
      gain.gain.linearRampToValueAtTime(0.0001, end);
      node.stop(end + 0.02);
    }
    return { node: node, gain: gain };
  }

  function startTone(freq) {
    audio();
    stopVoice();
    voice = playTone(freq, null, null);
    currentFreq = freq;
    paintState('playing');
  }

  function stopEverything() {
    stopVoice();
    currentFreq = null;
    cancelSweep();
    paintState('idle');
  }

  /* ----------------------------------------------------------------- UI */

  function paintState(state, extra) {
    var freqValue = $('freqValue');
    var freqUnit = $('freqUnit');
    var stateLabel = $('stateLabel');
    var sub = $('readoutSub');

    if (state === 'playing') {
      if (wave === 'pink') {
        freqValue.textContent = 'PINK';
        freqUnit.textContent = 'noise';
      } else {
        freqValue.textContent = currentFreq >= 1000 ? (currentFreq / 1000).toFixed(currentFreq % 1000 ? 1 : 0) : currentFreq;
        freqUnit.textContent = currentFreq >= 1000 ? 'kHz' : 'Hz';
      }
      stateLabel.textContent = sweep.running ? 'Sweeping' : 'Playing';
      sub.textContent = extra || ('Output ' + levelDb + ' dBFS — hold this volume for both runs.');
    } else if (state === 'gap') {
      freqValue.textContent = '—';
      freqUnit.textContent = '';
      stateLabel.textContent = 'Sweeping';
      sub.textContent = extra || 'Silence between tones';
    } else {
      freqValue.textContent = '—';
      freqUnit.textContent = '';
      stateLabel.textContent = 'Ready';
      sub.textContent = extra || 'Choose a tone below, or start the automatic sweep.';
    }

    Array.prototype.forEach.call(document.querySelectorAll('#toneDial button'), function (b) {
      var on = !sweep.running && wave === 'sine' && Number(b.dataset.freq) === currentFreq;
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  function buildDial() {
    var dial = $('toneDial');
    dial.innerHTML = '';
    RJ.ALL_BANDS.forEach(function (f) {
      var b = document.createElement('button');
      b.type = 'button';
      b.dataset.freq = f;
      b.setAttribute('aria-pressed', 'false');
      b.innerHTML = RJ.bandLabel(f).replace(' ', '&nbsp;') +
                    '<span>' + (f <= 250 ? 'low' : f <= 1000 ? 'mid' : 'high') + '</span>';
      b.addEventListener('click', function () {
        if (sweep.running) cancelSweep();
        if (currentFreq === f && voice) {
          stopVoice();
          currentFreq = null;
          paintState('idle');
        } else {
          startTone(f);
        }
      });
      dial.appendChild(b);
    });
  }

  function buildBandPicker() {
    var host = $('bandPicker');
    host.innerHTML = '';
    RJ.ALL_BANDS.forEach(function (f) {
      var id = 'band-' + f;
      var row = document.createElement('div');
      row.className = 'switch-row';
      row.style.marginBottom = '4px';
      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.id = id;
      cb.value = f;
      cb.checked = settings.bands.indexOf(f) !== -1;
      cb.addEventListener('change', function () {
        settings.bands = selectedBands();
        RJ.saveSettings(settings);
        estimate();
      });
      var lab = document.createElement('label');
      lab.htmlFor = id;
      lab.textContent = RJ.bandLabel(f);
      lab.style.cssText = 'text-transform:none;letter-spacing:0;font-weight:500;font-size:.95rem';
      row.appendChild(cb);
      row.appendChild(lab);
      host.appendChild(row);
    });
  }

  function selectedBands() {
    return Array.prototype.slice.call(document.querySelectorAll('#bandPicker input:checked'))
      .map(function (i) { return Number(i.value); })
      .sort(function (a, b) { return a - b; });
  }

  function paintLevel() {
    var pct = Math.round(RJ.fromDb(levelDb) * 100);
    $('levelReadout').innerHTML = (levelDb < 0 ? '&minus;' : '') + Math.abs(levelDb) +
      ' dBFS &middot; ' + pct + ' % of full scale';
    if (voice) {
      var t = ctx.currentTime;
      voice.gain.gain.cancelScheduledValues(t);
      voice.gain.gain.setValueAtTime(voice.gain.gain.value, t);
      voice.gain.gain.linearRampToValueAtTime(amplitude(), t + 0.08);
    }
  }

  function logLine(text, cls) {
    var log = $('sweepLog');
    if (log.dataset.fresh !== '1') { log.innerHTML = ''; log.dataset.fresh = '1'; }
    var li = document.createElement('li');
    var t = document.createElement('time');
    var d = new Date();
    t.textContent = String(d.getHours()).padStart(2, '0') + ':' +
                    String(d.getMinutes()).padStart(2, '0') + ':' +
                    String(d.getSeconds()).padStart(2, '0');
    var span = document.createElement('span');
    if (cls) span.className = cls;
    span.textContent = text;
    li.appendChild(t);
    li.appendChild(span);
    log.appendChild(li);
    log.scrollTop = log.scrollHeight;
  }

  function estimate() {
    var bands = selectedBands();
    var tone = Number($('toneSeconds').value);
    var gap = Number($('gapSeconds').value);
    var lead = $('leadIn').checked ? 3 : 0;
    var total = lead + bands.length * tone + Math.max(0, bands.length - 1) * gap;
    sweep.total = total;
    if (!sweep.running) {
      $('sweepStatus').textContent = bands.length
        ? 'Idle — total run time about ' + Math.round(total) + ' s'
        : 'Select at least one band';
    }
    return { bands: bands, tone: tone, gap: gap, lead: lead, total: total };
  }

  /* -------------------------------------------------------------- sweep */

  function startSweep() {
    var plan = estimate();
    if (!plan.bands.length) return;

    audio();
    stopVoice();
    wave = 'sine';
    paintWaveSeg();

    sweep.running = true;
    sweep.timers = [];
    sweep.startedAt = performance.now();
    $('startSweep').disabled = true;
    $('stopSweep').disabled = false;
    $('sweepDot').className = 'dot busy';
    $('sweepLog').dataset.fresh = '0';
    logLine('Sweep started — ' + plan.bands.length + ' bands, ' + plan.tone + ' s each');
    if (plan.lead) logLine('Lead-in silence, ' + plan.lead + ' s');

    var t = audio().currentTime + 0.15;
    var wall = plan.lead * 1000;
    var startBase = t + plan.lead;

    plan.bands.forEach(function (f, i) {
      var at = startBase + i * (plan.tone + plan.gap);
      playTone(f, at, plan.tone);

      sweep.timers.push(setTimeout(function () {
        currentFreq = f;
        paintState('playing', 'Band ' + (i + 1) + ' of ' + plan.bands.length + ' — hold still');
        logLine(RJ.bandLabel(f) + ' playing for ' + plan.tone + ' s');
      }, wall + i * (plan.tone + plan.gap) * 1000 + 40));

      if (i < plan.bands.length - 1) {
        sweep.timers.push(setTimeout(function () {
          paintState('gap');
        }, wall + (i * (plan.tone + plan.gap) + plan.tone) * 1000));
      }
    });

    sweep.timers.push(setTimeout(function () {
      finishSweep();
    }, (plan.total + 0.4) * 1000));

    tickProgress();
  }

  function tickProgress() {
    if (!sweep.running) return;
    var elapsed = (performance.now() - sweep.startedAt) / 1000;
    var pct = Math.min(100, (elapsed / sweep.total) * 100);
    $('sweepProgress').style.width = pct + '%';
    $('sweepStatus').textContent = 'Running — ' + Math.max(0, Math.ceil(sweep.total - elapsed)) + ' s remaining';
    requestAnimationFrame(tickProgress);
  }

  function clearTimers() {
    sweep.timers.forEach(clearTimeout);
    sweep.timers = [];
  }

  function finishSweep() {
    clearTimers();
    sweep.running = false;
    currentFreq = null;
    $('startSweep').disabled = false;
    $('stopSweep').disabled = true;
    $('sweepDot').className = 'dot';
    $('sweepProgress').style.width = '100%';
    $('sweepStatus').textContent = 'Sweep complete — check the meter on the other device';
    logLine('Sweep complete', 'log-ok');
    paintState('idle', 'Sweep complete. Insert or remove the panel, then run it again.');
    setTimeout(function () {
      if (!sweep.running) $('sweepProgress').style.width = '0%';
    }, 1600);
  }

  function cancelSweep() {
    if (!sweep.running) return;
    clearTimers();
    sweep.running = false;
    stopVoice();
    /* Tones already scheduled ahead of time need the graph muted briefly. */
    var t = audio().currentTime;
    master.gain.cancelScheduledValues(t);
    master.gain.setValueAtTime(0, t);
    master.gain.setValueAtTime(0, t + 0.4);
    master.gain.linearRampToValueAtTime(1, t + 0.45);

    $('startSweep').disabled = false;
    $('stopSweep').disabled = true;
    $('sweepDot').className = 'dot';
    $('sweepProgress').style.width = '0%';
    $('sweepStatus').textContent = 'Stopped';
    logLine('Sweep stopped by user', 'log-warn');
    paintState('idle');
  }

  function paintWaveSeg() {
    Array.prototype.forEach.call(document.querySelectorAll('#waveSeg button'), function (b) {
      b.setAttribute('aria-pressed', b.dataset.wave === wave ? 'true' : 'false');
    });
  }

  /* --------------------------------------------------------------- wire */

  buildDial();
  buildBandPicker();

  $('level').value = levelDb;
  paintLevel();
  $('level').addEventListener('input', function () {
    levelDb = Number(this.value);
    settings.level = levelDb;
    RJ.saveSettings(settings);
    paintLevel();
  });

  Array.prototype.forEach.call(document.querySelectorAll('#waveSeg button'), function (b) {
    b.addEventListener('click', function () {
      wave = b.dataset.wave;
      paintWaveSeg();
      if (voice) {
        var f = currentFreq || 1000;
        startTone(f);
      }
    });
  });

  $('toneSeconds').value = settings.toneSeconds || 3;
  $('gapSeconds').value = settings.gapSeconds || 1.5;
  $('toneSeconds').addEventListener('change', function () {
    settings.toneSeconds = Number(this.value); RJ.saveSettings(settings); estimate();
  });
  $('gapSeconds').addEventListener('change', function () {
    settings.gapSeconds = Number(this.value); RJ.saveSettings(settings); estimate();
  });
  $('leadIn').addEventListener('change', estimate);

  $('startSweep').addEventListener('click', startSweep);
  $('stopSweep').addEventListener('click', cancelSweep);
  $('stopAll').addEventListener('click', stopEverything);

  /* Silence the speaker if the page is backgrounded — a forgotten 4 kHz tone
     playing from a pocket is nobody's idea of a good exhibition. */
  document.addEventListener('visibilitychange', function () {
    if (document.hidden && (voice || sweep.running)) stopEverything();
  });

  window.addEventListener('pagehide', stopEverything);

  estimate();
  paintState('idle');
})();
