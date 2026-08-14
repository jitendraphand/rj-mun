/* =============================================================================
   results.js — analysis, charts, comparison library and export.
   ========================================================================== */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  var session = RJ.getSession();
  var analysis = RJ.analyse(session);
  var selected = [];                 /* library entry ids on the comparison chart */
  var MAX_COMPARE = 3;               /* validated all-pairs for the first 3 slots */

  function tokens() {
    var s = getComputedStyle(document.body);
    return {
      s1: s.getPropertyValue('--series-1').trim() || '#2a78d6',
      s2: s.getPropertyValue('--series-2').trim() || '#eb6834',
      s3: s.getPropertyValue('--series-3').trim() || '#1baf7a'
    };
  }

  /* ------------------------------------------------------------- summary */

  function paintSummary() {
    var bits = [];
    if (session.sample) bits.push('<strong>' + escapeHtml(session.sample) + '</strong>');
    if (session.material) bits.push(escapeHtml(session.material));
    if (session.thickness) bits.push(escapeHtml(session.thickness) + ' mm thick');
    if (session.distance) bits.push(escapeHtml(session.distance) + ' cm between devices');
    bits.push('recorded ' + new Date(session.created).toLocaleDateString());
    if (session.ambient.overall != null) {
      bits.push('room floor ' + RJ.fmt(session.ambient.overall, 0) + ' dB');
    }
    $('sessionSummary').innerHTML = bits.join(' &middot; ');

    var nothing = analysis.measuredCount === 0 &&
                  !Object.keys(session.runs.baseline).length &&
                  !Object.keys(session.runs.panel).length;
    $('emptyState').hidden = !nothing;
  }

  function paintTiles() {
    var loudness = RJ.loudnessRatio(analysis.meanLoss);
    var best = analysis.best;
    var tiles = [
      {
        label: 'Mean insertion loss',
        value: analysis.meanLoss == null ? '—' : RJ.fmt(analysis.meanLoss) + ' dB',
        note: analysis.reliableCount
          ? 'averaged over ' + analysis.reliableCount + ' trustworthy band' + (analysis.reliableCount === 1 ? '' : 's')
          : 'no complete bands yet',
        gold: true
      },
      {
        label: 'Perceived loudness',
        value: loudness == null ? '—' : '1 / ' + loudness.toFixed(1),
        note: loudness == null ? 'needs both runs' : 'of the unblocked sound'
      },
      {
        label: 'Best band',
        value: best && best.loss != null ? best.label : '—',
        note: best && best.loss != null ? RJ.fmt(best.loss) + ' dB removed there' : 'no band complete'
      },
      {
        label: 'Bands complete',
        value: analysis.measuredCount + ' / ' + analysis.bandCount,
        note: analysis.complete ? 'full sweep recorded' : 'both runs needed per band'
      }
    ];

    $('tiles').innerHTML = tiles.map(function (t) {
      return '<div class="tile' + (t.gold ? ' gold' : '') + '">' +
        '<div class="tile-label">' + t.label + '</div>' +
        '<div class="tile-value">' + t.value + '</div>' +
        '<div class="tile-note">' + t.note + '</div></div>';
    }).join('');
  }

  function paintVerdict() {
    if (analysis.meanLoss == null) { $('verdictCard').hidden = true; return; }
    $('verdictCard').hidden = false;

    var grade = RJ.gradeLoss(analysis.meanLoss);
    var ratio = RJ.loudnessRatio(analysis.meanLoss);
    var name = session.sample || session.material || 'This panel';
    var low = analysis.rows.filter(function (r) { return r.band <= 250 && r.loss != null; });
    var high = analysis.rows.filter(function (r) { return r.band >= 2000 && r.loss != null; });
    var lowMean = RJ.mean(low.map(function (r) { return r.loss; }));
    var highMean = RJ.mean(high.map(function (r) { return r.loss; }));

    var text = escapeHtml(name) + ' removed <strong>' + RJ.fmt(analysis.meanLoss) +
      ' dB</strong> on average — ' + grade.label.toLowerCase() +
      '. Sound arriving behind it is roughly <strong>1/' + ratio.toFixed(1) +
      '</strong> as loud as it was with nothing in the way.';

    if (lowMean != null && highMean != null) {
      var diff = highMean - lowMean;
      text += ' It works ' + (diff > 3 ? 'far better on high frequencies (' +
        RJ.fmt(highMean) + ' dB above 2 kHz against ' + RJ.fmt(lowMean) +
        ' dB below 250 Hz), the behaviour expected of a porous fibre panel'
        : diff < -3 ? 'better on low frequencies than high — unusual for a fibre panel; check for a gap or a resonance'
        : 'about equally across the range');
      text += '.';
    }
    $('verdictText').innerHTML = text;

    var caveats = [];
    var flagged = analysis.rows.filter(function (r) { return r.floorLimited; });
    if (flagged.length) {
      caveats.push(flagged.length + ' band' + (flagged.length === 1 ? '' : 's') +
        ' (' + flagged.map(function (r) { return r.label; }).join(', ') +
        ') sat close to the room noise floor, so the true loss there may be larger than measured.');
    }
    if (session.ambient.overall == null) {
      caveats.push('No ambient measurement was taken, so no band could be checked against the noise floor.');
    }
    if (!analysis.complete) {
      caveats.push('The sweep is incomplete — ' + analysis.measuredCount + ' of ' +
        analysis.bandCount + ' bands have both readings.');
    }
    caveats.push('Some sound travels around the panel and through the table, so this is the insertion loss of the whole rig rather than of the material alone.');
    $('verdictCaveat').textContent = caveats.join(' ');
  }

  /* -------------------------------------------------------------- charts */

  function paintCharts() {
    var t = tokens();
    var cats = analysis.rows.map(function (r) { return RJ.bandShort(r.band); });

    RJ.chart.line($('chartLevels'), {
      categories: cats,
      xLabel: 'Octave band centre frequency (Hz)',
      yLabel: 'Level at the meter (dB SPL)',
      unit: 'dB',
      emptyMessage: 'Record a sweep on the Sound Meter to draw this chart.',
      ariaLabel: 'Level reaching the meter, with and without the panel, per octave band',
      series: [
        { name: 'No panel', color: t.s1, values: analysis.rows.map(function (r) { return r.baseline; }) },
        { name: 'With panel', color: t.s2, values: analysis.rows.map(function (r) { return r.panel; }) }
      ]
    });
    RJ.chart.legend($('legendLevels'), [
      { name: 'Baseline — no panel', color: t.s1 },
      { name: 'With panel', color: t.s2 }
    ]);

    RJ.chart.bar($('chartLoss'), {
      categories: cats,
      values: analysis.rows.map(function (r) { return r.loss; }),
      color: t.s1,
      unit: 'dB',
      seriesName: 'Insertion loss',
      xLabel: 'Octave band centre frequency (Hz)',
      yLabel: 'Insertion loss (dB)',
      emptyMessage: 'Both runs are needed before insertion loss can be shown.',
      ariaLabel: 'Insertion loss in decibels per octave band'
    });
    $('legendLoss').innerHTML = analysis.rows.some(function (r) { return r.floorLimited; })
      ? '<span class="item">Bands flagged in the table sat close to the room noise floor.</span>'
      : '';
  }

  function paintCompare() {
    var t = tokens();
    var palette = [t.s1, t.s2, t.s3];
    var lib = RJ.getLibrary();
    var chosen = lib.filter(function (e) { return selected.indexOf(e.id) !== -1; });

    if (!chosen.length) {
      $('chartCompare').innerHTML = '<p class="chart-empty">Tick a saved sample below to plot it.</p>';
      $('legendCompare').innerHTML = '';
      return;
    }

    var bands = RJ.DEFAULT_BANDS.slice();
    chosen.forEach(function (e) {
      e.bands.forEach(function (f) { if (bands.indexOf(f) === -1) bands.push(f); });
    });
    bands.sort(function (a, b) { return a - b; });

    var series = chosen.map(function (e, i) {
      return {
        name: e.name,
        color: palette[i % palette.length],
        values: bands.map(function (f) {
          return e.loss[f] == null ? null : e.loss[f];
        })
      };
    });

    RJ.chart.line($('chartCompare'), {
      categories: bands.map(RJ.bandShort),
      series: series,
      unit: 'dB',
      xLabel: 'Octave band centre frequency (Hz)',
      yLabel: 'Insertion loss (dB)',
      ariaLabel: 'Insertion loss per octave band for the selected saved samples'
    });
    /* One series needs no legend box — the end-label already names it. */
    if (series.length < 2) {
      $('legendCompare').innerHTML = '';
    } else {
      RJ.chart.legend($('legendCompare'), series.map(function (s) {
        return { name: s.name, color: s.color };
      }));
    }
  }

  /* --------------------------------------------------------------- table */

  function paintTable() {
    var body = $('resultsBody');
    body.innerHTML = '';

    analysis.rows.forEach(function (r) {
      var grade = RJ.gradeLoss(r.loss);
      var assessment = r.loss == null
        ? '<span class="muted small">incomplete</span>'
        : (r.floorLimited
            ? '<span class="badge badge-warn">near noise floor</span>'
            : '<span class="badge ' + grade.cls + '">' + grade.label + '</span>');

      var tr = document.createElement('tr');
      tr.innerHTML =
        '<th scope="row">' + r.label + '</th>' +
        '<td class="num">' + RJ.fmt(r.baseline) + '</td>' +
        '<td class="num">' + RJ.fmt(r.panel) + '</td>' +
        '<td class="num">' + RJ.fmt(r.ambient) + '</td>' +
        '<td class="num"><strong>' + RJ.fmtSigned(r.loss) + '</strong></td>' +
        '<td class="num">' + RJ.fmt(r.snr) + '</td>' +
        '<td>' + assessment + '</td>';
      body.appendChild(tr);
    });

    $('resultsFoot').innerHTML = analysis.meanLoss == null ? '' :
      '<tr><td colspan="4">Mean insertion loss</td>' +
      '<td class="num">' + RJ.fmt(analysis.meanLoss) + '</td>' +
      '<td colspan="2">' + (analysis.complete ? 'all bands' : analysis.measuredCount + ' of ' + analysis.bandCount + ' bands') + '</td></tr>';
  }

  /* ------------------------------------------------------------- library */

  function paintLibrary() {
    var lib = RJ.getLibrary();
    var body = $('libraryBody');
    body.innerHTML = '';

    if (!lib.length) {
      body.innerHTML = '<tr><td colspan="7" class="muted">Nothing saved yet. Measure a panel, then tap “Save to comparison library”.</td></tr>';
      $('libraryHint').textContent = '';
      paintCompare();
      return;
    }

    lib.forEach(function (e) {
      var tr = document.createElement('tr');
      var checked = selected.indexOf(e.id) !== -1;
      tr.innerHTML =
        '<td class="no-print"><input type="checkbox" data-pick="' + e.id + '"' +
          (checked ? ' checked' : '') + ' aria-label="Plot ' + escapeHtml(e.name) + '"></td>' +
        '<th scope="row">' + escapeHtml(e.name) + '</th>' +
        '<td>' + escapeHtml(e.material || '—') + '</td>' +
        '<td class="num">' + (e.thickness ? escapeHtml(e.thickness) + ' mm' : '—') + '</td>' +
        '<td class="num"><strong>' + RJ.fmt(e.meanLoss) + '</strong></td>' +
        '<td>' + new Date(e.saved).toLocaleString() + '</td>' +
        '<td class="no-print"><button class="btn btn-danger btn-sm" type="button" data-drop="' + e.id + '">Remove</button></td>';
      body.appendChild(tr);
    });

    $('libraryHint').textContent = 'Up to ' + MAX_COMPARE +
      ' samples can be charted at once — beyond that the colours stop being reliably distinguishable.';

    Array.prototype.forEach.call(body.querySelectorAll('[data-pick]'), function (cb) {
      cb.addEventListener('change', function () {
        var id = cb.dataset.pick;
        if (cb.checked) {
          if (selected.length >= MAX_COMPARE) {
            cb.checked = false;
            $('libraryHint').textContent = 'Untick one of the ' + MAX_COMPARE +
              ' charted samples before adding another.';
            return;
          }
          selected.push(id);
        } else {
          selected = selected.filter(function (s) { return s !== id; });
        }
        paintLibrary();
        paintCompare();
      });
    });

    Array.prototype.forEach.call(body.querySelectorAll('[data-drop]'), function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.dataset.drop;
        if (!confirm('Remove this sample from the library?')) return;
        RJ.saveLibrary(RJ.getLibrary().filter(function (e) { return e.id !== id; }));
        selected = selected.filter(function (s) { return s !== id; });
        paintLibrary();
        paintCompare();
      });
    });

    paintCompare();
  }

  function saveToLibrary() {
    if (analysis.meanLoss == null) {
      $('saveHint').textContent = 'Nothing to save yet — a sample needs at least one band measured in both runs.';
      return;
    }
    var loss = {};
    analysis.rows.forEach(function (r) { if (r.loss != null) loss[r.band] = Math.round(r.loss * 10) / 10; });

    var entry = {
      id: 'L' + Date.now().toString(36).toUpperCase(),
      name: session.sample || session.material || ('Sample ' + session.id),
      material: session.material,
      thickness: session.thickness,
      distance: session.distance,
      bands: session.bands.slice(),
      loss: loss,
      meanLoss: Math.round(analysis.meanLoss * 10) / 10,
      saved: new Date().toISOString()
    };
    RJ.addToLibrary(entry);
    if (selected.length < MAX_COMPARE) selected.push(entry.id);
    paintLibrary();
    $('saveHint').textContent = '“' + entry.name + '” saved. Start a new sample on the Sound Meter to test the next panel.';
  }

  /* -------------------------------------------------------------- helpers */

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function slug(s) {
    return String(s || 'sample').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'sample';
  }

  /* ----------------------------------------------------------------- wire */

  $('saveLibrary').addEventListener('click', saveToLibrary);

  $('exportCsv').addEventListener('click', function () {
    RJ.download('soundproofing-' + slug(session.sample || session.material) + '-' + session.id + '.csv',
                RJ.toCSV(session));
  });

  $('printPage').addEventListener('click', function () { window.print(); });

  /* Another tab (the meter) may be recording while this page is open. */
  window.addEventListener('storage', function (e) {
    if (e.key && e.key.indexOf('rjmun.') === 0) {
      session = RJ.getSession();
      analysis = RJ.analyse(session);
      paintSummary(); paintTiles(); paintVerdict(); paintCharts(); paintTable(); paintLibrary();
    }
  });

  paintSummary();
  paintTiles();
  paintVerdict();
  paintCharts();
  paintTable();
  paintLibrary();
})();
