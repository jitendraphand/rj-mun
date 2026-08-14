/* =============================================================================
   acoustics.js — shared model, dB maths and storage for the soundproofing demo.
   Classic script (no ES modules) so the pages also work straight from file://.
   Everything hangs off the global `RJ`.
   ========================================================================== */
(function (global) {
  'use strict';

  var RJ = global.RJ || (global.RJ = {});

  /* ---------------------------------------------------------------- Bands */

  /* Standard 1/1-octave centre frequencies used for building acoustics. */
  RJ.ALL_BANDS = [125, 250, 500, 1000, 2000, 4000, 8000];
  RJ.DEFAULT_BANDS = [125, 250, 500, 1000, 2000, 4000];

  RJ.bandLabel = function (f) {
    return f >= 1000 ? (f / 1000) + ' kHz' : f + ' Hz';
  };

  RJ.bandShort = function (f) {
    return f >= 1000 ? (f / 1000) + 'k' : String(f);
  };

  /* Octave band edges: centre / sqrt(2) .. centre * sqrt(2) */
  RJ.bandEdges = function (f) {
    var r = Math.SQRT2;
    return { lo: f / r, hi: f * r };
  };

  /* Nearest test band to a measured frequency, within `tolerance` (fraction). */
  RJ.nearestBand = function (freq, bands, tolerance) {
    bands = bands || RJ.ALL_BANDS;
    tolerance = tolerance == null ? 0.09 : tolerance;
    var best = null, bestErr = Infinity;
    for (var i = 0; i < bands.length; i++) {
      var err = Math.abs(freq - bands[i]) / bands[i];
      if (err < bestErr) { bestErr = err; best = bands[i]; }
    }
    return bestErr <= tolerance ? best : null;
  };

  /* ------------------------------------------------------------- dB maths */

  RJ.DB_FLOOR = -120;

  /** Linear amplitude (0..1 full scale) -> dBFS. */
  RJ.toDb = function (amp) {
    if (!(amp > 0)) return RJ.DB_FLOOR;
    return Math.max(RJ.DB_FLOOR, 20 * Math.log10(amp));
  };

  /** dB -> linear amplitude. */
  RJ.fromDb = function (db) { return Math.pow(10, db / 20); };

  /** RMS of a Float32Array of samples. */
  RJ.rms = function (buf) {
    var sum = 0;
    for (var i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    return Math.sqrt(sum / buf.length);
  };

  /** Energy (not arithmetic) average of a list of dB values. */
  RJ.dbAverage = function (list) {
    var vals = list.filter(function (v) { return typeof v === 'number' && isFinite(v); });
    if (!vals.length) return null;
    var sum = 0;
    for (var i = 0; i < vals.length; i++) sum += Math.pow(10, vals[i] / 10);
    return 10 * Math.log10(sum / vals.length);
  };

  /** Arithmetic mean — the right average for *differences* such as insertion loss. */
  RJ.mean = function (list) {
    var vals = list.filter(function (v) { return typeof v === 'number' && isFinite(v); });
    if (!vals.length) return null;
    var sum = 0;
    for (var i = 0; i < vals.length; i++) sum += vals[i];
    return sum / vals.length;
  };

  /**
   * Subtract a noise floor from a measured level (both dB), on an energy basis.
   * Returns null when the signal is not at least 3 dB above the floor.
   */
  RJ.subtractNoise = function (measured, floor) {
    if (measured == null || floor == null) return measured;
    var d = measured - floor;
    if (d <= 3) return null;
    if (d > 15) return measured;             /* correction is negligible */
    return 10 * Math.log10(Math.pow(10, measured / 10) - Math.pow(10, floor / 10));
  };

  /** A-weighting at a frequency, in dB (IEC 61672 formula). */
  RJ.aWeight = function (f) {
    var f2 = f * f, f4 = f2 * f2;
    var num = 12194 * 12194 * f4;
    var den = (f2 + 20.6 * 20.6) *
              Math.sqrt((f2 + 107.7 * 107.7) * (f2 + 737.9 * 737.9)) *
              (f2 + 12194 * 12194);
    return 20 * Math.log10(num / den) + 2.0;
  };

  RJ.fmt = function (v, digits) {
    if (v == null || !isFinite(v)) return '—';
    return v.toFixed(digits == null ? 1 : digits);
  };

  RJ.fmtSigned = function (v, digits) {
    if (v == null || !isFinite(v)) return '—';
    var s = v.toFixed(digits == null ? 1 : digits);
    return v > 0 ? '+' + s : s;
  };

  /* ------------------------------------------------------ Quality grading */

  /**
   * How good is this insertion loss, in words a school audience understands?
   * Grades are deliberately conservative — a phone-and-panel rig is a
   * demonstration, not a certified acoustic laboratory.
   */
  RJ.gradeLoss = function (db) {
    if (db == null || !isFinite(db)) return { label: 'Not measured', cls: '' };
    if (db < 3) return { label: 'Barely audible change', cls: 'badge-bad' };
    if (db < 6) return { label: 'Slight reduction', cls: 'badge-warn' };
    if (db < 10) return { label: 'Clearly quieter', cls: 'badge-warn' };
    if (db < 15) return { label: 'Half as loud', cls: 'badge-good' };
    if (db < 25) return { label: 'Strong blocking', cls: 'badge-good' };
    return { label: 'Excellent blocking', cls: 'badge-good' };
  };

  /* A 10 dB drop is heard as roughly "half as loud". */
  RJ.loudnessRatio = function (db) {
    if (db == null || !isFinite(db)) return null;
    return Math.pow(2, db / 10);
  };

  /* --------------------------------------------------------- Session model */

  var SESSION_KEY = 'rjmun.session.v1';
  var LIBRARY_KEY = 'rjmun.library.v1';
  var SETTINGS_KEY = 'rjmun.settings.v1';

  function read(key, fallback) {
    try {
      var raw = global.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) { return fallback; }
  }

  function write(key, value) {
    try {
      global.localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) { return false; }
  }

  RJ.newSession = function () {
    return {
      id: 'S' + Date.now().toString(36).toUpperCase(),
      created: new Date().toISOString(),
      sample: '',
      material: '',
      thickness: '',
      distance: '',
      notes: '',
      calibration: 120,          /* dBFS -> dB SPL offset */
      bands: RJ.DEFAULT_BANDS.slice(),
      ambient: { overall: null, bands: {} },
      runs: { baseline: {}, panel: {} }
    };
  };

  RJ.getSession = function () {
    var s = read(SESSION_KEY, null);
    if (!s || !s.runs) { s = RJ.newSession(); write(SESSION_KEY, s); }
    if (!s.ambient) s.ambient = { overall: null, bands: {} };
    if (!s.bands) s.bands = RJ.DEFAULT_BANDS.slice();
    return s;
  };

  RJ.saveSession = function (s) { return write(SESSION_KEY, s); };
  RJ.resetSession = function () { var s = RJ.newSession(); write(SESSION_KEY, s); return s; };

  RJ.getSettings = function () {
    return read(SETTINGS_KEY, { level: -12, toneSeconds: 3, gapSeconds: 1.5, bands: RJ.DEFAULT_BANDS.slice() });
  };
  RJ.saveSettings = function (v) { return write(SETTINGS_KEY, v); };

  RJ.getLibrary = function () { return read(LIBRARY_KEY, []); };
  RJ.saveLibrary = function (list) { return write(LIBRARY_KEY, list); };

  RJ.addToLibrary = function (entry) {
    var lib = RJ.getLibrary();
    lib.unshift(entry);
    RJ.saveLibrary(lib.slice(0, 24));
    return lib;
  };

  /* ------------------------------------------------------------- Analysis */

  /**
   * Turn a session into per-band results.
   * Levels are stored as dB SPL (already calibrated at capture time).
   */
  RJ.analyse = function (session) {
    var bands = session.bands && session.bands.length ? session.bands : RJ.DEFAULT_BANDS;
    var rows = bands.map(function (f) {
      var b = session.runs.baseline[f];
      var p = session.runs.panel[f];
      var amb = session.ambient && session.ambient.bands ? session.ambient.bands[f] : null;
      var bl = b ? b.spl : null;
      var pl = p ? p.spl : null;
      var loss = (bl != null && pl != null) ? bl - pl : null;

      /* Trustworthy only when the quieter reading still stands clear of the room. */
      var snr = (pl != null && amb != null) ? pl - amb : null;
      var limited = (snr != null && snr < 10);

      return {
        band: f,
        label: RJ.bandLabel(f),
        baseline: bl,
        panel: pl,
        ambient: amb,
        loss: loss,
        snr: snr,
        floorLimited: limited
      };
    });

    var losses = rows.filter(function (r) { return r.loss != null && !r.floorLimited; })
                     .map(function (r) { return r.loss; });
    var allLosses = rows.map(function (r) { return r.loss; })
                        .filter(function (v) { return v != null; });

    var best = null;
    rows.forEach(function (r) {
      if (r.loss != null && (!best || r.loss > best.loss)) best = r;
    });

    return {
      rows: rows,
      meanLoss: RJ.mean(losses.length ? losses : allLosses),
      reliableCount: losses.length,
      measuredCount: allLosses.length,
      bandCount: bands.length,
      best: best,
      complete: allLosses.length === bands.length
    };
  };

  RJ.toCSV = function (session) {
    var a = RJ.analyse(session);
    var lines = [];
    lines.push('R.J. International School - Soundproofing test');
    lines.push('Session,' + session.id);
    lines.push('Recorded,' + session.created);
    lines.push('Sample,"' + (session.sample || '') + '"');
    lines.push('Material,"' + (session.material || '') + '"');
    lines.push('Thickness (mm),' + (session.thickness || ''));
    lines.push('Source-to-meter distance (cm),' + (session.distance || ''));
    lines.push('Calibration offset (dB),' + session.calibration);
    lines.push('Ambient overall (dB SPL),' + RJ.fmt(session.ambient.overall));
    lines.push('Notes,"' + String(session.notes || '').replace(/"/g, '""') + '"');
    lines.push('');
    lines.push('Band (Hz),Baseline (dB SPL),With panel (dB SPL),Ambient (dB SPL),Insertion loss (dB),Signal above ambient (dB),Flag');
    a.rows.forEach(function (r) {
      lines.push([
        r.band,
        RJ.fmt(r.baseline), RJ.fmt(r.panel), RJ.fmt(r.ambient),
        RJ.fmt(r.loss), RJ.fmt(r.snr),
        r.floorLimited ? 'near noise floor' : ''
      ].join(','));
    });
    lines.push('');
    lines.push('Mean insertion loss (dB),' + RJ.fmt(a.meanLoss));
    return lines.join('\r\n');
  };

  RJ.download = function (filename, text, mime) {
    var blob = new Blob([text], { type: (mime || 'text/csv') + ';charset=utf-8;' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  };

  /* ----------------------------------------------------------- Audio bits */

  /** Shared AudioContext factory with the Safari prefix handled. */
  RJ.makeContext = function (opts) {
    var Ctor = global.AudioContext || global.webkitAudioContext;
    if (!Ctor) throw new Error('Web Audio is not supported by this browser.');
    return new Ctor(opts || {});
  };

  RJ.supportsMic = function () {
    return !!(global.navigator && global.navigator.mediaDevices &&
              global.navigator.mediaDevices.getUserMedia);
  };

  /** Secure-context check — getUserMedia needs https:// or localhost. */
  RJ.isSecure = function () {
    return global.isSecureContext ||
           location.protocol === 'https:' ||
           location.hostname === 'localhost' ||
           location.hostname === '127.0.0.1';
  };

  /** Pink noise buffer (Voss-McCartney style filter over white noise). */
  RJ.makePinkNoise = function (ctx, seconds) {
    var len = Math.floor(ctx.sampleRate * (seconds || 3));
    var buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var out = buf.getChannelData(0);
    var b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (var i = 0; i < len; i++) {
      var white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.96900 * b2 + white * 0.1538520;
      b3 = 0.86650 * b3 + white * 0.3104856;
      b4 = 0.55000 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.0168980;
      out[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
      b6 = white * 0.115926;
    }
    return buf;
  };

})(window);
