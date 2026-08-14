/* =============================================================================
   meter.js — Device 2. Live sound-level meter, tone recognition and per-band
   recording of the baseline and with-panel runs.
   ========================================================================== */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  /* ------------------------------------------------------------- tuning */

  var SETTLE_MS = 350;    /* tone must hold this long before recording starts  */
  var RELEASE_MS = 260;   /* silence this long ends the capture                */
  var MIN_CAPTURE_MS = 700;
  var PROMINENCE_DB = 12; /* peak must stand this far above the average bin    */
  var FLOOR_MARGIN_DB = 6;/* and this far above the measured ambient level     */
  var BP_Q = 4;

  /* -------------------------------------------------------------- state */

  var session = RJ.getSession();
  var activeRun = 'baseline';
  var autoCapture = true;

  var mic = {
    running: false, stream: null, ctx: null, source: null,
    wide: null, band: null, bp: null,
    timeBuf: null, freqBuf: null, bandBuf: null,
    busy: false            /* true while an ambient/manual capture owns the filter */
  };

  var detect = {
    band: null, stableSince: 0, lastHeard: 0,
    capturing: false, energy: 0, seconds: 0
  };

  var live = { spl: null, bandSpl: null, peak: 0, peakAt: 0, lastFrame: 0, lastPaint: 0 };

  /* --------------------------------------------------------------- audio */

  function startMic() {
    if (!RJ.supportsMic()) {
      setStatus('err', 'This browser does not expose a microphone to web pages.');
      return;
    }
    setStatus('busy', 'Waiting for microphone permission…');

    navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 1
      }
    }).then(function (stream) {
      mic.stream = stream;
      mic.ctx = RJ.makeContext();
      if (mic.ctx.state === 'suspended') mic.ctx.resume();

      mic.source = mic.ctx.createMediaStreamSource(stream);

      mic.wide = mic.ctx.createAnalyser();
      mic.wide.fftSize = 8192;
      mic.wide.smoothingTimeConstant = 0;
      mic.source.connect(mic.wide);

      mic.bp = mic.ctx.createBiquadFilter();
      mic.bp.type = 'bandpass';
      mic.bp.Q.value = BP_Q;
      mic.bp.frequency.value = 1000;

      mic.band = mic.ctx.createAnalyser();
      mic.band.fftSize = 4096;
      mic.band.smoothingTimeConstant = 0;
      mic.source.connect(mic.bp);
      mic.bp.connect(mic.band);
      /* Deliberately never connected to ctx.destination — that would feed back. */

      mic.timeBuf = new Float32Array(mic.wide.fftSize);
      mic.freqBuf = new Float32Array(mic.wide.frequencyBinCount);
      mic.bandBuf = new Float32Array(mic.band.fftSize);

      mic.running = true;
      live.lastFrame = performance.now();

      $('micToggle').textContent = 'Stop meter';
      $('ambientBtn').disabled = false;
      $('manualCapture').disabled = false;
      $('calApply').disabled = false;
      $('meterMode').textContent = 'Live';
      setStatus('live', 'Listening — ' + describeRun());
      log('Microphone started at ' + Math.round(mic.ctx.sampleRate / 1000) + ' kHz');

      requestAnimationFrame(loop);
    }).catch(function (err) {
      var msg = err && err.name === 'NotAllowedError'
        ? 'Microphone permission was refused. Allow it in the browser’s site settings and try again.'
        : 'Could not open the microphone: ' + (err && err.message ? err.message : err);
      setStatus('err', msg);
      log(msg, 'log-warn');
    });
  }

  function stopMic() {
    mic.running = false;
    if (mic.stream) mic.stream.getTracks().forEach(function (t) { t.stop(); });
    if (mic.ctx) mic.ctx.close();
    mic.stream = mic.ctx = mic.source = mic.wide = mic.band = mic.bp = null;
    resetDetection();
    $('micToggle').textContent = 'Start meter';
    $('ambientBtn').disabled = true;
    $('manualCapture').disabled = true;
    $('calApply').disabled = true;
    $('splValue').textContent = '—';
    $('bandLevel').textContent = '—';
    $('toneDetected').textContent = '—';
    $('toneDetail').textContent = 'Listening for a test tone';
    $('meterFill').style.width = '0%';
    $('meterPeak').style.left = '0%';
    $('meterMode').textContent = 'Microphone off';
    setStatus('', 'Microphone off');
  }

  /* ------------------------------------------------------------- analysis */

  /** Strongest spectral peak, with parabolic interpolation, plus prominence. */
  function findPeak() {
    mic.wide.getFloatFrequencyData(mic.freqBuf);
    var nyquist = mic.ctx.sampleRate / 2;
    var binHz = nyquist / mic.freqBuf.length;
    var lo = Math.max(1, Math.floor(90 / binHz));
    var hi = Math.min(mic.freqBuf.length - 2, Math.floor(Math.min(9000, nyquist * 0.95) / binHz));

    var best = lo, bestVal = -Infinity, sum = 0, count = 0;
    for (var i = lo; i <= hi; i++) {
      var v = mic.freqBuf[i];
      if (v > bestVal) { bestVal = v; best = i; }
      if (isFinite(v)) { sum += v; count++; }
    }
    if (!count || !isFinite(bestVal)) return null;

    var a = mic.freqBuf[best - 1], b = mic.freqBuf[best], c = mic.freqBuf[best + 1];
    var shift = 0;
    if (isFinite(a) && isFinite(c)) {
      var denom = a - 2 * b + c;
      if (denom !== 0) shift = Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / denom));
    }

    return {
      freq: (best + shift) * binHz,
      db: bestVal,
      prominence: bestVal - (sum / count)
    };
  }

  function loop(now) {
    if (!mic.running) return;
    var dt = Math.min(0.1, (now - live.lastFrame) / 1000);
    live.lastFrame = now;

    mic.wide.getFloatTimeDomainData(mic.timeBuf);
    live.spl = RJ.toDb(RJ.rms(mic.timeBuf)) + calibration();

    mic.band.getFloatTimeDomainData(mic.bandBuf);
    var bandRms = RJ.rms(mic.bandBuf);
    live.bandSpl = RJ.toDb(bandRms) + calibration();

    if (!mic.busy) runDetection(now, dt, bandRms);

    if (now - live.lastPaint > 90) { live.lastPaint = now; paintLive(now); }
    requestAnimationFrame(loop);
  }

  function runDetection(now, dt, bandRms) {
    var peak = findPeak();
    var floor = session.ambient && session.ambient.overall;
    var aboveRoom = floor == null || live.spl > floor + FLOOR_MARGIN_DB;
    var candidate = null;

    if (peak && peak.prominence > PROMINENCE_DB && aboveRoom) {
      candidate = RJ.nearestBand(peak.freq, session.bands, 0.09);
    }
    live.peakInfo = peak;

    if (candidate) {
      if (detect.band !== candidate) {
        if (detect.band) finalise(now);
        detect.band = candidate;
        detect.stableSince = now;
        detect.capturing = false;
        detect.energy = 0;
        detect.seconds = 0;
        mic.bp.frequency.setTargetAtTime(candidate, mic.ctx.currentTime, 0.01);
      }
      detect.lastHeard = now;

      if (!detect.capturing && now - detect.stableSince >= SETTLE_MS) {
        detect.capturing = true;
      }
      if (detect.capturing) {
        detect.energy += bandRms * bandRms * dt;
        detect.seconds += dt;
      }
    } else if (detect.band && now - detect.lastHeard > RELEASE_MS) {
      finalise(now);
    }
  }

  function finalise() {
    var band = detect.band;
    var seconds = detect.seconds;
    var energy = detect.energy;
    resetDetection();

    if (!band || seconds * 1000 < MIN_CAPTURE_MS) return;
    if (!autoCapture) return;
    if (activeRun === 'off') {
      log(RJ.bandLabel(band) + ' heard but recording is paused', 'log-warn');
      return;
    }
    var spl = RJ.toDb(Math.sqrt(energy / seconds)) + calibration();
    record(band, spl, seconds, 'auto');
  }

  function resetDetection() {
    detect.band = null;
    detect.capturing = false;
    detect.energy = 0;
    detect.seconds = 0;
  }

  function record(band, spl, seconds, how) {
    var existing = session.runs[activeRun][band];
    session.runs[activeRun][band] = {
      spl: spl, seconds: Math.round(seconds * 100) / 100, at: new Date().toISOString()
    };
    RJ.saveSession(session);

    var name = activeRun === 'baseline' ? 'Baseline' : 'With panel';
    log(name + ' · ' + RJ.bandLabel(band) + ' = ' + RJ.fmt(spl) + ' dB' +
        (existing ? ' (replaced earlier reading)' : '') +
        (how === 'manual' ? ' · manual' : ''), 'log-ok');

    var amb = session.ambient.bands[band];
    if (amb != null && spl - amb < 10) {
      log(RJ.bandLabel(band) + ' is only ' + RJ.fmt(spl - amb) +
          ' dB above the room — treat with caution', 'log-warn');
    }
    paintTable();
  }

  /* ------------------------------------------------------ timed captures */

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  /** Average the band-filtered level at one frequency, in dB SPL. */
  function sampleBand(freq, settleMs, measureMs) {
    mic.bp.frequency.setTargetAtTime(freq, mic.ctx.currentTime, 0.01);
    return sleep(settleMs).then(function () {
      var energy = 0, n = 0, t0 = performance.now();
      return new Promise(function (resolve) {
        var step = function () {
          mic.band.getFloatTimeDomainData(mic.bandBuf);
          var r = RJ.rms(mic.bandBuf);
          energy += r * r; n++;
          if (performance.now() - t0 < measureMs) setTimeout(step, 25);
          else resolve(RJ.toDb(Math.sqrt(energy / Math.max(1, n))) + calibration());
        };
        step();
      });
    });
  }

  function measureAmbient() {
    if (!mic.running || mic.busy) return;
    mic.busy = true;
    resetDetection();
    $('ambientBtn').disabled = true;
    setStatus('busy', 'Measuring the room — please keep silent…');
    log('Ambient measurement started');

    /* Overall level, sampled across the whole quiet period. */
    var wideEnergy = 0, wideN = 0;
    var wideTimer = setInterval(function () {
      if (!mic.running) return;
      mic.wide.getFloatTimeDomainData(mic.timeBuf);
      var r = RJ.rms(mic.timeBuf);
      wideEnergy += r * r; wideN++;
    }, 40);

    var bands = session.bands.slice();
    var chain = Promise.resolve();
    var results = {};

    bands.forEach(function (f) {
      chain = chain.then(function () {
        setStatus('busy', 'Measuring the room at ' + RJ.bandLabel(f) + '…');
        return sampleBand(f, 200, 550).then(function (db) { results[f] = db; });
      });
    });

    chain.then(function () {
      clearInterval(wideTimer);
      session.ambient.bands = results;
      session.ambient.overall = RJ.toDb(Math.sqrt(wideEnergy / Math.max(1, wideN))) + calibration();
      session.ambient.at = new Date().toISOString();
      RJ.saveSession(session);

      mic.busy = false;
      $('ambientBtn').disabled = false;
      setStatus('live', 'Listening — ' + describeRun());
      log('Ambient noise floor: ' + RJ.fmt(session.ambient.overall) + ' dB overall', 'log-ok');
      paintAmbient();
      paintTable();
    }).catch(function (e) {
      clearInterval(wideTimer);
      mic.busy = false;
      $('ambientBtn').disabled = false;
      log('Ambient measurement failed: ' + e, 'log-warn');
      setStatus('live', 'Listening — ' + describeRun());
    });
  }

  function manualCapture() {
    if (!mic.running || mic.busy) return;
    if (activeRun === 'off') { log('Recording is paused — choose a run first', 'log-warn'); return; }
    var band = Number($('manualBand').value);
    mic.busy = true;
    resetDetection();
    $('manualCapture').disabled = true;
    setStatus('busy', 'Capturing ' + RJ.bandLabel(band) + ' for 3 s — keep the tone playing…');

    sampleBand(band, 250, 3000).then(function (db) {
      record(band, db, 3, 'manual');
      mic.busy = false;
      $('manualCapture').disabled = false;
      setStatus('live', 'Listening — ' + describeRun());
    }).catch(function (e) {
      mic.busy = false;
      $('manualCapture').disabled = false;
      log('Manual capture failed: ' + e, 'log-warn');
    });
  }

  /* ------------------------------------------------------------ painting */

  function calibration() { return Number(session.calibration) || 0; }

  function describeRun() {
    return activeRun === 'baseline' ? 'recording the baseline run'
         : activeRun === 'panel' ? 'recording the with-panel run'
         : 'recording paused';
  }

  function setStatus(cls, text) {
    $('micDot').className = 'dot' + (cls ? ' ' + cls : '');
    $('micStatus').textContent = text;
  }

  function paintLive(now) {
    $('splValue').textContent = live.spl == null || live.spl < -20 ? '—' : Math.round(live.spl);

    var pct = Math.max(0, Math.min(100, ((live.spl - 30) / 80) * 100));
    $('meterFill').style.width = pct + '%';
    if (pct >= live.peak || now - live.peakAt > 1400) { live.peak = pct; live.peakAt = now; }
    $('meterPeak').style.left = live.peak + '%';

    if (detect.band) {
      $('toneDetected').textContent = RJ.bandLabel(detect.band);
      $('toneDetail').textContent = detect.capturing
        ? 'Recording… ' + detect.seconds.toFixed(1) + ' s'
        : 'Settling…';
      $('bandLevel').textContent = RJ.fmt(live.bandSpl, 0);
      $('meterSub').textContent = 'Test tone detected — hold everything still.';
    } else {
      var p = live.peakInfo;
      $('toneDetected').textContent = '—';
      $('toneDetail').textContent = p && isFinite(p.freq)
        ? 'Loudest content near ' + Math.round(p.freq) + ' Hz'
        : 'Listening for a test tone';
      $('bandLevel').textContent = '—';
      $('meterSub').textContent = mic.busy ? 'Timed measurement in progress…'
        : 'Listening — start the sweep on the other device.';
    }
  }

  function paintAmbient() {
    var amb = session.ambient;
    $('ambientValue').textContent = amb.overall == null ? '—' : Math.round(amb.overall);
    $('ambientNote').textContent = amb.overall == null ? 'Not measured yet'
      : 'Measured ' + new Date(amb.at).toLocaleTimeString();

    var host = $('ambientBreakdown');
    var keys = Object.keys(amb.bands || {});
    if (!keys.length) { host.textContent = ''; return; }
    host.innerHTML = '<strong>Per band:</strong> ' + session.bands.map(function (f) {
      var v = amb.bands[f];
      return RJ.bandLabel(f) + ' ' + (v == null ? '—' : RJ.fmt(v, 0) + ' dB');
    }).join(' &middot; ');
  }

  function paintTable() {
    var a = RJ.analyse(session);
    var body = $('readingsBody');
    body.innerHTML = '';

    a.rows.forEach(function (r) {
      var tr = document.createElement('tr');
      var grade = RJ.gradeLoss(r.loss);
      var quality = r.loss == null
        ? '<span class="muted small">waiting</span>'
        : (r.floorLimited
            ? '<span class="badge badge-warn">near noise floor</span>'
            : '<span class="badge ' + grade.cls + '">' + grade.label + '</span>');

      tr.innerHTML =
        '<th scope="row">' + r.label + '</th>' +
        '<td class="num">' + RJ.fmt(r.baseline) + '</td>' +
        '<td class="num">' + RJ.fmt(r.panel) + '</td>' +
        '<td class="num"><strong>' + RJ.fmt(r.loss) + '</strong></td>' +
        '<td>' + quality + '</td>';
      body.appendChild(tr);
    });

    $('readingsFoot').innerHTML = a.meanLoss == null ? '' :
      '<tr><td colspan="3">Mean insertion loss</td>' +
      '<td class="num">' + RJ.fmt(a.meanLoss) + '</td>' +
      '<td>' + (a.complete ? 'all bands measured' : a.measuredCount + ' of ' + a.bandCount + ' bands') + '</td></tr>';

    var b = Object.keys(session.runs.baseline).length;
    var p = Object.keys(session.runs.panel).length;
    $('recordedCount').textContent = (b + p) + ' / ' + (session.bands.length * 2);
    $('recordedNote').textContent = 'Baseline ' + b + ' · panel ' + p;
  }

  function log(text, cls) {
    var host = $('meterLog');
    if (host.dataset.fresh !== '1') { host.innerHTML = ''; host.dataset.fresh = '1'; }
    var li = document.createElement('li');
    var t = document.createElement('time');
    var d = new Date();
    t.textContent = String(d.getHours()).padStart(2, '0') + ':' +
                    String(d.getMinutes()).padStart(2, '0') + ':' +
                    String(d.getSeconds()).padStart(2, '0');
    var span = document.createElement('span');
    if (cls) span.className = cls;
    span.textContent = text;
    li.appendChild(t); li.appendChild(span);
    host.appendChild(li);
    host.scrollTop = host.scrollHeight;
  }

  function paintRunSeg() {
    Array.prototype.forEach.call(document.querySelectorAll('#runSeg button'), function (b) {
      b.setAttribute('aria-pressed', b.dataset.run === activeRun ? 'true' : 'false');
    });
    if (mic.running && !mic.busy) setStatus('live', 'Listening — ' + describeRun());
  }

  /* ---------------------------------------------------------------- wire */

  if (!RJ.isSecure()) {
    $('insecureWarning').hidden = false;
    $('micToggle').disabled = true;
  }

  /* Sample-detail fields, bound straight to the stored session. */
  [['sample', 'sample'], ['material', 'material'], ['thickness', 'thickness'],
   ['distance', 'distance'], ['notes', 'notes']].forEach(function (pair) {
    var input = $(pair[0]);
    input.value = session[pair[1]] || '';
    input.addEventListener('input', function () {
      session[pair[1]] = this.value;
      RJ.saveSession(session);
    });
  });

  $('calibration').value = session.calibration;
  $('calibration').addEventListener('input', function () {
    var v = Number(this.value);
    if (isFinite(v)) { session.calibration = v; RJ.saveSession(session); paintAmbient(); }
  });

  $('calApply').addEventListener('click', function () {
    var target = Number($('calRef').value);
    if (!isFinite(target) || live.spl == null) return;
    var raw = live.spl - calibration();          /* back to dBFS */
    session.calibration = Math.round((target - raw) * 10) / 10;
    RJ.saveSession(session);
    $('calibration').value = session.calibration;
    log('Calibration set to ' + session.calibration + ' dB from a reference reading of ' + target + ' dB', 'log-ok');
    paintAmbient();
  });

  var manual = $('manualBand');
  session.bands.forEach(function (f) {
    var o = document.createElement('option');
    o.value = f;
    o.textContent = RJ.bandLabel(f);
    manual.appendChild(o);
  });
  manual.value = 1000;

  $('micToggle').addEventListener('click', function () {
    if (mic.running) stopMic(); else startMic();
  });
  $('ambientBtn').addEventListener('click', measureAmbient);
  $('manualCapture').addEventListener('click', manualCapture);

  Array.prototype.forEach.call(document.querySelectorAll('#runSeg button'), function (b) {
    b.addEventListener('click', function () {
      activeRun = b.dataset.run;
      resetDetection();
      paintRunSeg();
      log('Now recording: ' + (activeRun === 'off' ? 'nothing (paused)' :
          activeRun === 'baseline' ? 'baseline run, no panel' : 'with-panel run'));
    });
  });

  $('autoCapture').addEventListener('change', function () {
    autoCapture = this.checked;
    log(autoCapture ? 'Automatic recognition on' : 'Automatic recognition off — use manual capture');
  });

  $('clearRun').addEventListener('click', function () {
    if (activeRun === 'off') return;
    if (!confirm('Delete every reading in the ' +
        (activeRun === 'baseline' ? 'baseline' : 'with-panel') + ' run?')) return;
    session.runs[activeRun] = {};
    RJ.saveSession(session);
    paintTable();
    log('Cleared the ' + activeRun + ' run', 'log-warn');
  });

  $('resetSession').addEventListener('click', function () {
    if (!confirm('Start a new sample? The current readings are erased — save them to the library on the Results page first if you need them.')) return;
    session = RJ.resetSession();
    ['sample', 'material', 'thickness', 'distance', 'notes'].forEach(function (k) { $(k).value = ''; });
    $('calibration').value = session.calibration;
    paintTable(); paintAmbient();
    log('New sample started', 'log-ok');
  });

  window.addEventListener('pagehide', function () { if (mic.running) stopMic(); });

  paintRunSeg();
  paintTable();
  paintAmbient();
})();
