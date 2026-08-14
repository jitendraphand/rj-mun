/* =============================================================================
   chart.js — dependency-free SVG charts (line + bar) with a hover layer.
   Re-renders on container resize so label sizes stay constant.
   ========================================================================== */
(function (global) {
  'use strict';

  var RJ = global.RJ || (global.RJ = {});
  var NS = 'http://www.w3.org/2000/svg';

  function el(name, attrs) {
    var node = document.createElementNS(NS, name);
    for (var k in attrs) {
      if (Object.prototype.hasOwnProperty.call(attrs, k) && attrs[k] != null) {
        node.setAttribute(k, attrs[k]);
      }
    }
    return node;
  }

  function css(host, name, fallback) {
    var v = getComputedStyle(host).getPropertyValue(name);
    return (v && v.trim()) || fallback;
  }

  function niceTicks(min, max, count) {
    var span = max - min;
    if (!(span > 0)) { max = min + 1; span = 1; }
    var raw = span / (count || 5);
    var mag = Math.pow(10, Math.floor(Math.log10(raw)));
    var norm = raw / mag;
    var step = (norm >= 7.5 ? 10 : norm >= 3.5 ? 5 : norm >= 1.5 ? 2 : 1) * mag;
    var start = Math.floor(min / step) * step;
    var end = Math.ceil(max / step) * step;
    var ticks = [];
    for (var v = start; v <= end + step * 0.001; v += step) {
      ticks.push(Math.round(v * 1e6) / 1e6);
    }
    return { ticks: ticks, min: start, max: end };
  }

  /* Rounded-top bar path: 4px radius on the data end, square on the baseline. */
  function barPath(x, y, w, h, r) {
    r = Math.min(r, w / 2, Math.abs(h));
    if (h <= 0.5) return 'M' + x + ',' + y + 'h' + w;
    return 'M' + x + ',' + (y + h) +
           'V' + (y + r) +
           'a' + r + ',' + r + ' 0 0 1 ' + r + ',' + (-r) +
           'h' + (w - 2 * r) +
           'a' + r + ',' + r + ' 0 0 1 ' + r + ',' + r +
           'V' + (y + h) + 'Z';
  }

  function tooltip(host) {
    var tip = host.querySelector('.chart-tip');
    if (!tip) {
      tip = document.createElement('div');
      tip.className = 'chart-tip';
      host.appendChild(tip);
    }
    return tip;
  }

  function mount(host, render) {
    if (host.__rjResize) host.__rjResize.disconnect();
    var draw = function () {
      var w = host.clientWidth || 640;
      render(Math.max(280, w));
    };
    draw();
    if (global.ResizeObserver) {
      var ro = new ResizeObserver(function () { draw(); });
      ro.observe(host);
      host.__rjResize = ro;
    } else {
      global.addEventListener('resize', draw);
    }
  }

  function clearSvg(host) {
    var old = host.querySelector('svg');
    if (old) old.remove();
    var stale = host.querySelector('.chart-empty');
    if (stale) stale.remove();
  }

  /* Room for the direct end-labels, sized to the longest series name. */
  function rightMargin(series, width) {
    if (width < 520) return 18;
    var longest = 0;
    series.forEach(function (s) { longest = Math.max(longest, s.name.length); });
    return Math.min(150, Math.max(76, longest * 7 + 18));
  }

  function fit(text, px) {
    var max = Math.floor(px / 7);
    return text.length <= max ? text : text.slice(0, Math.max(1, max - 1)) + '…';
  }

  function empty(host, message) {
    host.innerHTML = '<p class="chart-empty">' + message + '</p>';
  }

  RJ.chart = {};

  /**
   * Line chart with markers, a crosshair tooltip and direct end-labels.
   * opts: { categories:[], series:[{name, color, values:[]}], yLabel, unit,
   *         yMin, yMax, decimals }
   */
  RJ.chart.line = function (host, opts) {
    var series = (opts.series || []).filter(function (s) {
      return s.values.some(function (v) { return v != null && isFinite(v); });
    });
    if (!series.length) { empty(host, opts.emptyMessage || 'No readings yet.'); return; }

    var tip = tooltip(host);
    var decimals = opts.decimals == null ? 1 : opts.decimals;
    var unit = opts.unit || '';

    mount(host, function (width) {
      clearSvg(host);

      var all = [];
      series.forEach(function (s) {
        s.values.forEach(function (v) { if (v != null && isFinite(v)) all.push(v); });
      });
      var lo = Math.min.apply(null, all), hi = Math.max.apply(null, all);
      var pad = Math.max(2, (hi - lo) * 0.18);
      var scale = niceTicks(
        opts.yMin != null ? opts.yMin : lo - pad,
        opts.yMax != null ? opts.yMax : hi + pad, 5);

      var height = width < 520 ? 300 : 340;
      var m = { top: 16, right: rightMargin(series, width), bottom: 46, left: 52 };
      var iw = width - m.left - m.right;
      var ih = height - m.top - m.bottom;
      var n = opts.categories.length;

      var gridCol = css(host, '--chart-grid', '#e1e0d9');
      var axisCol = css(host, '--chart-axis', '#c3c2b7');
      var mutedCol = css(host, '--chart-muted', '#898781');
      var inkCol = css(host, '--chart-ink-2', '#52514e');

      var x = function (i) { return m.left + (n === 1 ? iw / 2 : (iw * i) / (n - 1)); };
      var y = function (v) { return m.top + ih - ((v - scale.min) / (scale.max - scale.min)) * ih; };

      var svg = el('svg', {
        viewBox: '0 0 ' + width + ' ' + height,
        role: 'img',
        'aria-label': opts.ariaLabel || opts.yLabel || 'Line chart'
      });

      /* Gridlines + y ticks */
      scale.ticks.forEach(function (t) {
        var yy = y(t);
        svg.appendChild(el('line', {
          x1: m.left, x2: m.left + iw, y1: yy, y2: yy,
          stroke: gridCol, 'stroke-width': 1
        }));
        var lbl = el('text', {
          x: m.left - 10, y: yy + 4, 'text-anchor': 'end',
          fill: mutedCol, 'font-size': 11, 'font-family': 'system-ui, sans-serif',
          'font-variant-numeric': 'tabular-nums'
        });
        lbl.textContent = t;
        svg.appendChild(lbl);
      });

      /* Axis */
      svg.appendChild(el('line', {
        x1: m.left, x2: m.left + iw, y1: m.top + ih, y2: m.top + ih,
        stroke: axisCol, 'stroke-width': 1
      }));

      /* X labels */
      opts.categories.forEach(function (c, i) {
        var lbl = el('text', {
          x: x(i), y: m.top + ih + 20, 'text-anchor': 'middle',
          fill: mutedCol, 'font-size': 11, 'font-family': 'system-ui, sans-serif'
        });
        lbl.textContent = c;
        svg.appendChild(lbl);
      });

      if (opts.yLabel) {
        var ylab = el('text', {
          x: -(m.top + ih / 2), y: 14, transform: 'rotate(-90)',
          'text-anchor': 'middle', fill: mutedCol, 'font-size': 11,
          'font-family': 'system-ui, sans-serif'
        });
        ylab.textContent = opts.yLabel;
        svg.appendChild(ylab);
      }
      if (opts.xLabel) {
        var xlab = el('text', {
          x: m.left + iw / 2, y: height - 6, 'text-anchor': 'middle',
          fill: mutedCol, 'font-size': 11, 'font-family': 'system-ui, sans-serif'
        });
        xlab.textContent = opts.xLabel;
        svg.appendChild(xlab);
      }

      /* Series */
      series.forEach(function (s) {
        var d = '', open = false;
        s.values.forEach(function (v, i) {
          if (v == null || !isFinite(v)) { open = false; return; }
          d += (open ? 'L' : 'M') + x(i) + ',' + y(v);
          open = true;
        });
        svg.appendChild(el('path', {
          d: d, fill: 'none', stroke: s.color, 'stroke-width': 2,
          'stroke-linecap': 'round', 'stroke-linejoin': 'round'
        }));

        s.values.forEach(function (v, i) {
          if (v == null || !isFinite(v)) return;
          /* 2px surface ring keeps overlapping markers separable */
          svg.appendChild(el('circle', {
            cx: x(i), cy: y(v), r: 5, fill: s.color,
            stroke: '#ffffff', 'stroke-width': 2
          }));
        });

        /* Direct end-label (skipped on narrow screens — legend carries it) */
        if (width >= 520) {
          var lastIdx = -1;
          s.values.forEach(function (v, i) { if (v != null && isFinite(v)) lastIdx = i; });
          if (lastIdx >= 0) {
            var t = el('text', {
              x: x(lastIdx) + 10, y: y(s.values[lastIdx]) + 4,
              fill: inkCol, 'font-size': 12, 'font-weight': 600,
              'font-family': 'system-ui, sans-serif'
            });
            t.textContent = fit(s.name, m.right - 14);
            svg.appendChild(t);
          }
        }
      });

      /* Hover layer: one full-height band per category */
      var crosshair = el('line', {
        x1: 0, x2: 0, y1: m.top, y2: m.top + ih,
        stroke: axisCol, 'stroke-width': 1, 'stroke-dasharray': '3 3',
        opacity: 0, 'pointer-events': 'none'
      });
      svg.appendChild(crosshair);

      opts.categories.forEach(function (c, i) {
        var bandW = n === 1 ? iw : iw / (n - 1);
        var hit = el('rect', {
          x: x(i) - bandW / 2, y: m.top, width: bandW, height: ih,
          fill: 'transparent'
        });
        hit.addEventListener('pointerenter', function () {
          crosshair.setAttribute('x1', x(i));
          crosshair.setAttribute('x2', x(i));
          crosshair.setAttribute('opacity', 1);
          var html = '<div class="tip-head">' + c + '</div>';
          series.forEach(function (s) {
            var v = s.values[i];
            html += '<div class="tip-row"><span class="swatch" style="background:' + s.color + '"></span>' +
                    s.name + ' <strong>' + (v == null || !isFinite(v) ? '—' : v.toFixed(decimals) + ' ' + unit) +
                    '</strong></div>';
          });
          tip.innerHTML = html;
          tip.classList.add('on');
          tip.style.left = (x(i) / width * 100) + '%';
          tip.style.top = (m.top + 6) + 'px';
        });
        hit.addEventListener('pointerleave', function () {
          tip.classList.remove('on');
          crosshair.setAttribute('opacity', 0);
        });
        svg.appendChild(hit);
      });

      host.insertBefore(svg, tip);
    });
  };

  /**
   * Bar chart, one series.
   * opts: { categories:[], values:[], color, yLabel, unit, decimals, valueLabels }
   */
  RJ.chart.bar = function (host, opts) {
    var has = (opts.values || []).some(function (v) { return v != null && isFinite(v); });
    if (!has) { empty(host, opts.emptyMessage || 'No readings yet.'); return; }

    var tip = tooltip(host);
    var decimals = opts.decimals == null ? 1 : opts.decimals;
    var unit = opts.unit || '';

    mount(host, function (width) {
      clearSvg(host);

      var vals = opts.values.filter(function (v) { return v != null && isFinite(v); });
      var hi = Math.max.apply(null, vals);
      var lo = Math.min.apply(null, vals);
      var scale = niceTicks(Math.min(0, lo), Math.max(hi * 1.12, 1), 5);

      var height = width < 520 ? 290 : 330;
      var m = { top: 22, right: 16, bottom: 46, left: 52 };
      var iw = width - m.left - m.right;
      var ih = height - m.top - m.bottom;
      var n = opts.categories.length;

      var gridCol = css(host, '--chart-grid', '#e1e0d9');
      var axisCol = css(host, '--chart-axis', '#c3c2b7');
      var mutedCol = css(host, '--chart-muted', '#898781');
      var inkCol = css(host, '--chart-ink-2', '#52514e');
      var color = opts.color || css(host, '--series-1', '#2a78d6');

      var slot = iw / n;
      var gap = Math.max(2, slot * 0.28);          /* >= 2px surface gap */
      var bw = Math.max(6, slot - gap);
      var y = function (v) { return m.top + ih - ((v - scale.min) / (scale.max - scale.min)) * ih; };

      var svg = el('svg', {
        viewBox: '0 0 ' + width + ' ' + height,
        role: 'img', 'aria-label': opts.ariaLabel || opts.yLabel || 'Bar chart'
      });

      scale.ticks.forEach(function (t) {
        var yy = y(t);
        svg.appendChild(el('line', {
          x1: m.left, x2: m.left + iw, y1: yy, y2: yy, stroke: gridCol, 'stroke-width': 1
        }));
        var lbl = el('text', {
          x: m.left - 10, y: yy + 4, 'text-anchor': 'end', fill: mutedCol,
          'font-size': 11, 'font-family': 'system-ui, sans-serif'
        });
        lbl.textContent = t;
        svg.appendChild(lbl);
      });

      svg.appendChild(el('line', {
        x1: m.left, x2: m.left + iw, y1: y(0), y2: y(0), stroke: axisCol, 'stroke-width': 1
      }));

      opts.categories.forEach(function (c, i) {
        var v = opts.values[i];
        var cx = m.left + slot * i + slot / 2;

        var lbl = el('text', {
          x: cx, y: m.top + ih + 20, 'text-anchor': 'middle', fill: mutedCol,
          'font-size': 11, 'font-family': 'system-ui, sans-serif'
        });
        lbl.textContent = c;
        svg.appendChild(lbl);

        if (v == null || !isFinite(v)) return;

        var top = y(Math.max(v, 0));
        var h = Math.abs(y(v) - y(0));
        var bar = el('path', {
          d: barPath(cx - bw / 2, top, bw, h, 4),
          fill: opts.colors ? opts.colors[i] : color
        });
        svg.appendChild(bar);

        if (opts.valueLabels !== false) {
          var vl = el('text', {
            x: cx, y: top - 7, 'text-anchor': 'middle', fill: inkCol,
            'font-size': 12, 'font-weight': 600, 'font-family': 'system-ui, sans-serif',
            'font-variant-numeric': 'tabular-nums'
          });
          vl.textContent = v.toFixed(decimals);
          svg.appendChild(vl);
        }

        var hit = el('rect', { x: m.left + slot * i, y: m.top, width: slot, height: ih, fill: 'transparent' });
        hit.addEventListener('pointerenter', function () {
          tip.innerHTML = '<div class="tip-head">' + c + '</div>' +
            '<div class="tip-row"><span class="swatch" style="background:' +
            (opts.colors ? opts.colors[i] : color) + '"></span>' +
            (opts.seriesName || opts.yLabel || 'Value') + ' <strong>' +
            v.toFixed(decimals) + ' ' + unit + '</strong></div>';
          tip.classList.add('on');
          tip.style.left = (cx / width * 100) + '%';
          tip.style.top = Math.max(4, top - 8) + 'px';
        });
        hit.addEventListener('pointerleave', function () { tip.classList.remove('on'); });
        svg.appendChild(hit);
      });

      if (opts.yLabel) {
        var ylab = el('text', {
          x: -(m.top + ih / 2), y: 14, transform: 'rotate(-90)', 'text-anchor': 'middle',
          fill: mutedCol, 'font-size': 11, 'font-family': 'system-ui, sans-serif'
        });
        ylab.textContent = opts.yLabel;
        svg.appendChild(ylab);
      }
      if (opts.xLabel) {
        var xlab = el('text', {
          x: m.left + iw / 2, y: height - 6, 'text-anchor': 'middle', fill: mutedCol,
          'font-size': 11, 'font-family': 'system-ui, sans-serif'
        });
        xlab.textContent = opts.xLabel;
        svg.appendChild(xlab);
      }

      host.insertBefore(svg, tip);
    });
  };

  /** Legend markup helper — identity is never carried by colour alone. */
  RJ.chart.legend = function (node, items) {
    node.innerHTML = items.map(function (it) {
      return '<span class="item"><span class="swatch" style="background:' + it.color + '"></span>' +
             it.name + '</span>';
    }).join('');
  };

})(window);
