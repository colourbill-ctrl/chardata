/**
 * icc-viz.js — inline per-tag ICC profile visualizations for the Display viewer.
 *
 * Vanilla-JS port of profiletool's React visualization layer (TagVisuals /
 * GraphSvg / RasterCanvas / TagEvaluator / Collapsible / colors / rasterDecode),
 * arranged to match profiletool as closely as a non-React host allows. It draws
 * the DATA returned by the shared IccVizModel engine (window.IccViewer.enumerate
 * / renderGraph / renderRaster / tagEvalInfo / evaluateTag):
 *
 *   • TRC tone curves and LUT A/B/M curve overlays   → inline SVG (legend toggles)
 *   • CIE 1931 chromaticity charts (white / R/G/B)    → inline SVG, point highlight
 *   • CLUT lattice + colour-coded gamut images        → <canvas> (ICC-normalized → sRGB)
 *   • single-point transform evaluator                → sliders + live apply
 *
 * Everything is built with DOM nodes and textContent (never innerHTML for
 * profile-derived strings such as named-colour / ink names), so untrusted
 * profile text can never become markup — matching chardata's escapeHtml hygiene.
 *
 * Entry point:
 *   IccViz.enumerate(bytes)                  → Promise<{byTag,chroma,gamut}|null>
 *   IccViz.renderTagDetail(container, opts)  → fills `container` for one tag
 *       opts = { bytes, tag, viz }   // viz from IccViz.enumerate (may be null)
 */
(function () {
  'use strict';

  // IccVizModel Kind enum (kept in sync with IccVizModel.hpp).
  const KIND = { Curve1D: 1, ChromaticityXY: 2, NamedColorsAB: 3, NamedColorsXY: 4, ClutImage: 5 };
  const COLORANT_HL = { rXYZ: 'R', gXYZ: 'G', bXYZ: 'B' };
  const TRC_TAGS = new Set(['rTRC', 'gTRC', 'bTRC', 'kTRC']);
  const ATOB_TAGS = new Set(['A2B0', 'A2B1', 'A2B2', 'A2B3']);

  const LAB_PRETTY = { L: 'L*', a: 'a*', b: 'b*' };
  const pretty = (label) => { const tail = String(label).split('_').pop(); return LAB_PRETTY[tail] || tail; };

  // Localized label lookup — delegates to the host page's translation function
  // (window.t) when present, falling back to the English default otherwise. The
  // ICC viewer's labels live in the same I18N dictionary as the rest of the app
  // (keys prefixed `icc_viz_`); t() returns the bare key when one is missing, so
  // the `!== key` guard keeps the English fallback in that case.
  function tr(key, fallback) {
    if (typeof window.t === 'function') {
      const v = window.t(key);
      if (v != null && v !== key) return v;
    }
    return fallback;
  }

  // ── small DOM helpers ──────────────────────────────────────────────────────
  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  const SVGNS = 'http://www.w3.org/2000/svg';
  function svgEl(tag, attrs) {
    const n = document.createElementNS(SVGNS, tag);
    if (attrs) for (const k in attrs) n.setAttribute(k, attrs[k]);
    return n;
  }

  // ── colour logic (port of viz/colors.js) ───────────────────────────────────
  function colorFor(s) {
    if (s.role === 'hint') {
      if (s.id === 'locus' || s.colorHint === 'locus') return '#c79a00';
      if (s.id === 'planckian') return '#3a8f8f';
      return '#c4c9d2';
    }
    switch (s.colorHint) {
      case 'R': return '#d23b3b';
      case 'G': return '#2a9d3a';
      case 'B': return '#3361cc';
      case 'white': return '#7a8190';
      default: return '#4a90e2';
    }
  }
  const PALETTE = ['#4a90e2', '#d23b3b', '#2a9d3a', '#b58a00', '#8e44ad', '#16a3a3', '#e07b39', '#777'];
  function channelColor(spaceSig, index, count) {
    const sig = (spaceSig || '').trim();
    const fb = PALETTE[index % PALETTE.length];
    switch (sig) {
      case 'RGB': return ['#d23b3b', '#2a9d3a', '#3361cc'][index] || fb;
      case 'CMYK': return ['#11aacc', '#cc2a8f', '#d9b800', '#333'][index] || fb;
      case 'GRAY': return '#555';
      case 'Lab': return ['#666', '#c0392b', '#2e6fd6'][index] || fb;
      case 'XYZ': return ['#c0392b', '#2a9d3a', '#3361cc'][index] || fb;
      default: return fb;
    }
  }

  // ── raster decode (port of lib/rasterDecode.js) ─────────────────────────────
  const PHOTO = { WHITE_IS_ZERO: 0, BLACK_IS_ZERO: 1, RGB: 2, CMYK: 5, CIELAB: 8 };
  const PHOTO_NAME = { 0: 'Grayscale', 1: 'Grayscale', 2: 'RGB', 5: 'CMYK', 8: 'CIELAB' };

  function labToRgb(L, a, b) {
    const fy = (L + 16) / 116;
    const fx = fy + a / 500;
    const fz = fy - b / 200;
    const fInv = (t) => { const t3 = t * t * t; return t3 > 0.008856 ? t3 : (t - 16 / 116) / 7.787; };
    const Xn = 0.96422, Yn = 1.0, Zn = 0.82521;
    const X = Xn * fInv(fx), Y = Yn * fInv(fy), Z = Zn * fInv(fz);
    const X2 =  0.9555766 * X - 0.0230393 * Y + 0.0631636 * Z;
    const Y2 = -0.0282895 * X + 1.0099416 * Y + 0.0210077 * Z;
    const Z2 =  0.0122982 * X - 0.0204830 * Y + 1.3299098 * Z;
    const r =  3.2404542 * X2 - 1.5371385 * Y2 - 0.4985314 * Z2;
    const g = -0.9692660 * X2 + 1.8760108 * Y2 + 0.0415560 * Z2;
    const bl =  0.0556434 * X2 - 0.2040259 * Y2 + 1.0572252 * Z2;
    const gamma = (c) => { c = Math.min(1, Math.max(0, c)); return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055; };
    return [Math.round(gamma(r) * 255), Math.round(gamma(g) * 255), Math.round(gamma(bl) * 255)];
  }

  function decodeRaster(ras, opts) {
    opts = opts || {};
    const { width, height, channels: spp, bitsPerChannel: bps, photometric, samples } = ras;
    const maxVal = (1 << bps) - 1 || 65535;
    const read = bps === 16
      ? (p, s) => { const o = (p * spp + s) * 2; return (samples[o] | (samples[o + 1] << 8)) / 65535; }
      : (p, s) => samples[p * spp + s] / maxVal;
    if (opts.gamut) return decodeGamut(ras, read);

    const px = width * height;
    const rgba = new Uint8ClampedArray(px * 4);
    for (let p = 0; p < px; p++) {
      let r, g, b;
      switch (photometric) {
        case PHOTO.RGB:
          r = read(p, 0) * 255; g = read(p, 1) * 255; b = read(p, 2) * 255; break;
        case PHOTO.CMYK: {
          const c = read(p, 0), m = read(p, 1), y = read(p, 2), k = read(p, 3);
          r = 255 * (1 - c) * (1 - k); g = 255 * (1 - m) * (1 - k); b = 255 * (1 - y) * (1 - k); break;
        }
        case PHOTO.CIELAB: {
          const L = read(p, 0) * 100, A = read(p, 1) * 255 - 128, B = read(p, 2) * 255 - 128;
          const rgb = labToRgb(L, A, B); r = rgb[0]; g = rgb[1]; b = rgb[2]; break;
        }
        case PHOTO.WHITE_IS_ZERO: { const v = (1 - read(p, 0)) * 255; r = g = b = v; break; }
        default: { const v = read(p, 0) * 255; r = g = b = v; }
      }
      const o = p * 4;
      rgba[o] = r; rgba[o + 1] = g; rgba[o + 2] = b; rgba[o + 3] = 255;
    }
    return { width, height, rgba, photometric: PHOTO_NAME[photometric] || ('Photometric ' + photometric) };
  }

  function decodeGamut(ras, read) {
    const px = ras.width * ras.height;
    const eps = 1e-4;
    let maxV = 0;
    for (let p = 0; p < px; p++) { const v = read(p, 0); if (v > maxV) maxV = v; }
    const inv = maxV > eps ? 1 / maxV : 0;
    const rgba = new Uint8ClampedArray(px * 4);
    for (let p = 0; p < px; p++) {
      const v = read(p, 0);
      let r, g, b;
      if (v <= eps) { r = 232; g = 235; b = 239; }
      else { const t = inv ? Math.min(1, v * inv) : 1; r = 250 - 95 * t; g = 195 - 183 * t; b = 185 - 173 * t; }
      const o = p * 4;
      rgba[o] = r; rgba[o + 1] = g; rgba[o + 2] = b; rgba[o + 3] = 255;
    }
    return { width: ras.width, height: ras.height, rgba, photometric: 'Gamut' };
  }

  // ── Collapsible (port of viz/Collapsible.jsx) ───────────────────────────────
  // Returns { section, body }. Append children to `body`.
  function collapsible(title, defaultOpen) {
    const section = el('section', 'iccviz-section');
    const header = el('button', 'iccviz-cheader');
    header.type = 'button';
    const caret = el('span', 'iccviz-caret', '▶');
    caret.setAttribute('aria-hidden', 'true');
    header.appendChild(caret);
    header.appendChild(document.createTextNode(title));
    const body = el('div', 'iccviz-cbody');
    let open = !!defaultOpen;
    function apply() {
      caret.classList.toggle('open', open);
      body.style.display = open ? '' : 'none';
      header.setAttribute('aria-expanded', open ? 'true' : 'false');
    }
    header.addEventListener('click', () => { open = !open; apply(); });
    apply();
    section.appendChild(header);
    section.appendChild(body);
    return { section, body };
  }

  function loadingNode() { return el('div', 'iccviz-loading', tr('icc_viz_loading', 'Loading…')); }
  function errorNode(msg) { return el('div', 'iccviz-itemerr', msg); }

  function warningsNode(items) {
    if (!items || !items.length) return null;
    const box = el('div', 'iccviz-itemwarn');
    items.forEach((w) => box.appendChild(el('div', null, '⚠ ' + w)));
    return box;
  }

  // ── GraphSvg (port of viz/GraphSvg.jsx) ─────────────────────────────────────
  function graphSvg(graph, opts) {
    opts = opts || {};
    const highlight = opts.highlight;
    const legend = !!opts.legend;
    const hl = highlight != null ? String(highlight).toLowerCase() : null;
    const hidden = new Set();

    const W = 520;
    const m = { l: 46, r: 16, t: 10, b: 34 };
    const pw = W - m.l - m.r;
    const ph = graph.xAxis.equalAspect ? pw : 300;
    const H = ph + m.t + m.b;
    const xmin = graph.xAxis.min, xmax = graph.xAxis.max;
    const ymin = graph.yAxis.min, ymax = graph.yAxis.max;
    const sx = (x) => m.l + ((x - xmin) / (xmax - xmin || 1)) * pw;
    const sy = (y) => m.t + ph - ((y - ymin) / (ymax - ymin || 1)) * ph;
    const fmt = (v) => (Math.abs(v) >= 100 || Number.isInteger(v) ? v.toFixed(0) : v.toFixed(2));
    const seriesColor = (s) => s.color || colorFor(s);
    const dimmed = (s) => hl != null && (s.colorHint || '').toLowerCase() !== hl && (s.id || '').toLowerCase() !== hl;

    const wrap = el('div', 'iccviz-graphwrap');
    const svg = svgEl('svg', { class: 'iccviz-svg', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': graph.title || '' });

    svg.appendChild(svgEl('rect', { x: m.l, y: m.t, width: pw, height: ph, class: 'iccviz-frame' }));
    [0, 0.25, 0.5, 0.75, 1].forEach((f) => {
      const gx = m.l + f * pw, gy = m.t + f * ph;
      svg.appendChild(svgEl('line', { x1: gx, y1: m.t, x2: gx, y2: m.t + ph, class: 'iccviz-grid' }));
      svg.appendChild(svgEl('line', { x1: m.l, y1: gy, x2: m.l + pw, y2: gy, class: 'iccviz-grid' }));
    });

    // group holding the data; rebuilt when a legend toggle changes visibility.
    const dataG = svgEl('g', {});
    svg.appendChild(dataG);
    function drawData() {
      while (dataG.firstChild) dataG.removeChild(dataG.firstChild);
      const ordered = graph.series.slice().sort((a, b) => (a.role === 'hint' ? 0 : 1) - (b.role === 'hint' ? 0 : 1));
      for (const s of ordered) {
        if (hidden.has(s.id)) continue;
        const color = seriesColor(s);
        const pts = s.points;
        const labelMap = new Map((s.labels || []).map((l) => [l.i, l]));
        if (s.shape === 'polyline' || s.shape === 'closedPath') {
          let str = '';
          for (let i = 0; i < pts.length; i += 2) str += `${sx(pts[i]).toFixed(1)},${sy(pts[i + 1]).toFixed(1)} `;
          const node = svgEl(s.shape === 'closedPath' ? 'polygon' : 'polyline', {
            points: str.trim(), fill: 'none', stroke: color,
            'stroke-width': s.role === 'hint' ? 1 : 1.8,
            'stroke-linejoin': 'round', opacity: dimmed(s) ? 0.3 : 1,
          });
          dataG.appendChild(node);
        } else { // scatter
          const g = svgEl('g', { opacity: dimmed(s) ? 0.4 : 1 });
          for (let i = 0, v = 0; i < pts.length; i += 2, v++) {
            const px = sx(pts[i]), py = sy(pts[i + 1]);
            const lab = labelMap.get(v);
            const isHit = hl != null && lab && lab.t && String(lab.t).toLowerCase() === hl;
            const isMiss = hl != null && !isHit;
            const r = s.role === 'hint' ? 1.5 : (isHit ? 5 : 3);
            if (isHit) g.appendChild(svgEl('circle', { cx: px, cy: py, r: r + 3, fill: 'none', stroke: color, 'stroke-width': 1.5 }));
            g.appendChild(svgEl('circle', { cx: px, cy: py, r: r, fill: color, opacity: isMiss ? 0.35 : 1 }));
            if (lab && lab.t) {
              const txt = svgEl('text', { x: px + 4, y: py - 3, class: 'iccviz-ptlabel', fill: color, opacity: isMiss ? 0.5 : 1, 'font-weight': isHit ? 700 : 400 });
              txt.textContent = String(lab.t);           // profile-derived → textContent only
              g.appendChild(txt);
            }
          }
          dataG.appendChild(g);
        }
      }
    }
    drawData();

    function axisText(x, y, cls, anchor, text, transform) {
      const t = svgEl('text', { x: x, y: y, class: cls, 'text-anchor': anchor });
      if (transform) t.setAttribute('transform', transform);
      t.textContent = text;
      return t;
    }
    svg.appendChild(axisText(m.l, m.t + ph + 14, 'iccviz-axisval', 'start', fmt(xmin)));
    svg.appendChild(axisText(m.l + pw, m.t + ph + 14, 'iccviz-axisval', 'end', fmt(xmax)));
    svg.appendChild(axisText(m.l + pw / 2, m.t + ph + 28, 'iccviz-axislabel', 'middle', graph.xAxis.label || ''));
    svg.appendChild(axisText(m.l - 6, m.t + ph, 'iccviz-axisval', 'end', fmt(ymin)));
    svg.appendChild(axisText(m.l - 6, m.t + 8, 'iccviz-axisval', 'end', fmt(ymax)));
    const yl = axisText(0, 0, 'iccviz-axislabel', 'middle', graph.yAxis.label || '', `translate(12 ${m.t + ph / 2}) rotate(-90)`);
    svg.appendChild(yl);
    if (graph.description) svg.appendChild(axisText(m.l + pw, m.t + 12, 'iccviz-desclabel', 'end', graph.description));

    wrap.appendChild(svg);

    if (legend) {
      const legendSeries = graph.series.filter((s) => s.name);
      if (legendSeries.length) {
        const legendBox = el('div', 'iccviz-legend');
        legendSeries.forEach((s) => {
          const btn = el('button', 'iccviz-legenditem');
          btn.type = 'button';
          const sw = el('span', 'iccviz-swatch');
          sw.style.background = seriesColor(s);
          sw.style.color = seriesColor(s);
          btn.appendChild(sw);
          btn.appendChild(document.createTextNode(s.name));    // legend label → textContent
          function syncPressed() {
            const off = hidden.has(s.id);
            btn.classList.toggle('iccviz-legendoff', off);
            btn.setAttribute('aria-pressed', off ? 'false' : 'true');
          }
          btn.addEventListener('click', () => {
            if (hidden.has(s.id)) hidden.delete(s.id); else hidden.add(s.id);
            syncPressed(); drawData();
          });
          syncPressed();
          legendBox.appendChild(btn);
        });
        wrap.appendChild(legendBox);
      }
    }
    return wrap;
  }

  // ── RasterCanvas (port of viz/RasterCanvas.jsx) ─────────────────────────────
  function rasterCanvas(raster, captionNode) {
    const wrap = el('div', 'iccviz-rasterwrap');
    const canvas = el('canvas', 'iccviz-raster');
    canvas.width = raster.width;
    canvas.height = raster.height;
    canvas.getContext('2d').putImageData(new ImageData(raster.rgba, raster.width, raster.height), 0, 0);
    wrap.appendChild(canvas);
    wrap.appendChild(el('div', 'iccviz-rastermeta', raster.width + '×' + raster.height + ' · ' + raster.photometric));
    if (captionNode) { const m = el('div', 'iccviz-rastermeta'); m.appendChild(captionNode); wrap.appendChild(m); }
    return wrap;
  }

  // Gamut legend caption: swatch + "in gamut" · swatch + "out of gamut".
  function gamutLegend() {
    const frag = document.createDocumentFragment();
    const swatch = (color) => { const s = el('span', 'iccviz-gswatch'); s.style.background = color; return s; };
    frag.appendChild(swatch('#e8ebef'));
    frag.appendChild(document.createTextNode(tr('icc_viz_in_gamut', 'Neutral = in gamut')));
    frag.appendChild(document.createTextNode('   ·   '));
    frag.appendChild(swatch('rgb(155,12,12)'));
    frag.appendChild(document.createTextNode(tr('icc_viz_out_gamut', 'Red = out of gamut')));
    return frag;
  }

  // ── async single graph / raster loaders ─────────────────────────────────────
  // Each returns a placeholder element it fills in once the WASM call resolves.
  function graphView(bytes, id, highlight) {
    const host = el('div');
    host.appendChild(loadingNode());
    window.IccViewer.renderGraph(bytes, id).then((g) => {
      if (!host.isConnected) return;
      host.replaceChildren();
      const w = warningsNode(g.warnings); if (w) host.appendChild(w);
      host.appendChild(graphSvg(g, { highlight }));
    }).catch((e) => { if (host.isConnected) host.replaceChildren(errorNode(e.message || String(e))); });
    return host;
  }

  function rasterView(bytes, id, gamut) {
    const host = el('div');
    host.appendChild(loadingNode());
    window.IccViewer.renderRaster(bytes, id).then((r) => {
      if (!host.isConnected) return;
      host.replaceChildren();
      const w = warningsNode(r.warnings); if (w) host.appendChild(w);
      host.appendChild(rasterCanvas(decodeRaster(r, { gamut }), gamut ? gamutLegend() : null));
    }).catch((e) => { if (host.isConnected) host.replaceChildren(errorNode(e.message || String(e))); });
    return host;
  }

  // Overlay several 1-D curves (one CLUT group) into one colour-coded graph.
  function combinedCurves(bytes, curves, infoPromise, side) {
    const host = el('div');
    host.appendChild(loadingNode());
    Promise.all([
      infoPromise,
      Promise.all(curves.map((c) => window.IccViewer.renderGraph(bytes, c.id).then((g) => ({ c, g })))),
    ]).then(([info, items]) => {
      if (!host.isConnected) return;
      const spaceSig = info ? (side === 'src' ? info.srcSpaceSig : info.dstSpaceSig) : '';
      const labels = info ? (side === 'src' ? info.srcLabels : info.dstLabels) : null;
      const merged = mergeCurveGraphs(items, spaceSig, labels);
      host.replaceChildren();
      if (!merged) return;
      const warnings = items.flatMap(({ g }) => g.warnings || []);
      const w = warningsNode(warnings); if (w) host.appendChild(w);
      host.appendChild(graphSvg(merged, { legend: true }));
    }).catch((e) => { if (host.isConnected) host.replaceChildren(errorNode(e.message || String(e))); });
    return host;
  }

  function mergeCurveGraphs(items, spaceSig, labels) {
    if (!items.length) return null;
    const base = items[0].g;
    let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
    const series = items.map(({ c, g }) => {
      const prim = g.series.find((s) => s.role !== 'hint') || g.series[0];
      for (let i = 0; i < prim.points.length; i += 2) {
        xmin = Math.min(xmin, prim.points[i]); xmax = Math.max(xmax, prim.points[i]);
        ymin = Math.min(ymin, prim.points[i + 1]); ymax = Math.max(ymax, prim.points[i + 1]);
      }
      const name = (labels && labels[c.idx] ? pretty(labels[c.idx]) : 'Ch' + c.idx) + (c.grp ? ' (' + c.grp + ')' : '');
      return Object.assign({}, prim, { id: c.id, name, color: channelColor(spaceSig, c.idx, items.length), role: 'primary' });
    });
    return {
      title: base.title, description: '',
      xAxis: { label: base.xAxis.label, min: isFinite(xmin) ? xmin : 0, max: isFinite(xmax) ? xmax : 1 },
      yAxis: { label: base.yAxis.label, min: isFinite(ymin) ? ymin : 0, max: isFinite(ymax) ? ymax : 1 },
      series,
    };
  }

  // ── TagEvaluator (port of TagEvaluator.jsx) ─────────────────────────────────
  function channelRange(spaceSig, isPcs, idx) {
    if (!isPcs) return { min: 0, max: 1, step: 0.001, def: 1 };
    if ((spaceSig || '').trim() === 'Lab') {
      return idx === 0 ? { min: 0, max: 100, step: 0.5, def: 50 } : { min: -128, max: 127, step: 1, def: 0 };
    }
    return { min: 0, max: 1.2, step: 0.005, def: idx === 1 ? 1 : 0.9 }; // XYZ
  }
  const fmtN = (v, d) => (typeof v === 'number' && isFinite(v)) ? v.toFixed(d) : '—';

  function tagEvaluator(bytes, tag) {
    const host = el('div', 'iccviz-eval');
    host.appendChild(loadingNode());

    window.IccViewer.tagEvalInfo(bytes, tag.id).then((info) => {
      if (!host.isConnected) return;
      host.replaceChildren();

      const hasGrid = Array.isArray(info.gridPoints) &&
        info.gridPoints.length === info.srcChannels && info.gridPoints.every((n) => n > 1);
      let mode = 'float';
      const floatIn = Array.from({ length: info.srcChannels }, (_, k) => channelRange(info.srcSpaceSig, info.srcIsPcs, k).def);
      const gridIn = Array.from({ length: info.srcChannels }, () => 0);

      // top row: direction + mode toggle
      const topRow = el('div', 'iccviz-evaltop');
      topRow.appendChild(el('span', 'iccviz-evaldir', info.srcIsPcs ? tr('icc_viz_pcs_to_device', 'PCS → Device') : tr('icc_viz_device_to_pcs', 'Device → PCS')));
      const toggle = el('div', 'iccviz-modetoggle');
      const floatBtn = el('button', 'iccviz-modebtn', tr('icc_viz_float', 'Float')); floatBtn.type = 'button';
      const gridBtn = el('button', 'iccviz-modebtn', tr('icc_viz_grid', 'Grid')); gridBtn.type = 'button';
      gridBtn.disabled = !hasGrid;
      if (!hasGrid) gridBtn.title = tr('icc_viz_no_clut_grid', 'No CLUT grid');
      toggle.appendChild(floatBtn); toggle.appendChild(gridBtn);
      topRow.appendChild(toggle);
      host.appendChild(topRow);

      const cols = el('div', 'iccviz-evalcols');
      const inCol = el('div', 'iccviz-evalcol');
      inCol.appendChild(el('div', 'iccviz-evalcolhead', tr('icc_viz_input', 'Input') + ' · ' + info.srcSpace));
      const outCol = el('div', 'iccviz-evalcol');
      outCol.appendChild(el('div', 'iccviz-evalcolhead', tr('icc_viz_output', 'Output') + ' · ' + info.dstSpace));
      cols.appendChild(inCol); cols.appendChild(outCol);
      host.appendChild(cols);

      // output rows (built once, values updated live)
      const outHead = el('div', 'iccviz-outheadrow');
      outHead.appendChild(el('span', 'iccviz-chlabel'));
      outHead.appendChild(el('span', 'iccviz-outcol iccviz-outcolhead', tr('icc_viz_human', 'Human')));
      outHead.appendChild(el('span', 'iccviz-outcol iccviz-outcolhead', tr('icc_viz_norm', 'Norm')));
      outCol.appendChild(outHead);
      const outHumanCells = [], outNormCells = [];
      info.dstLabels.forEach((label) => {
        const row = el('div', 'iccviz-outrow');
        row.appendChild(el('span', 'iccviz-chlabel', pretty(label)));
        const hc = el('span', 'iccviz-outcol', '—'); const nc = el('span', 'iccviz-outcol', '—');
        row.appendChild(hc); row.appendChild(nc);
        outHumanCells.push(hc); outNormCells.push(nc);
        outCol.appendChild(row);
      });
      const errBox = el('div', 'iccviz-itemerr'); errBox.style.display = 'none';
      outCol.appendChild(errBox);

      function recompute() {
        let input, normalized;
        if (mode === 'grid' && hasGrid) { input = gridIn.map((idx, k) => idx / (info.gridPoints[k] - 1)); normalized = true; }
        else { input = floatIn.slice(); normalized = false; }
        window.IccViewer.evaluateTag(bytes, tag.id, input, normalized).then((out) => {
          if (!host.isConnected) return;
          errBox.style.display = 'none';
          out.outHuman.forEach((v, k) => { if (outHumanCells[k]) outHumanCells[k].textContent = fmtN(v, 3); });
          out.outNorm.forEach((v, k) => { if (outNormCells[k]) outNormCells[k].textContent = fmtN(v, 4); });
        }).catch((e) => {
          if (!host.isConnected) return;
          outHumanCells.forEach((c) => c.textContent = '—'); outNormCells.forEach((c) => c.textContent = '—');
          errBox.textContent = e.message || String(e); errBox.style.display = '';
        });
      }

      function buildInputs() {
        // clear everything after the colhead
        while (inCol.childNodes.length > 1) inCol.removeChild(inCol.lastChild);
        info.srcLabels.forEach((label, k) => {
          const row = el('div', 'iccviz-evalrow');
          row.appendChild(el('span', 'iccviz-chlabel', pretty(label)));
          if (mode === 'grid' && hasGrid) {
            const n = info.gridPoints[k];
            const slider = el('input', 'iccviz-slider'); slider.type = 'range';
            slider.min = 0; slider.max = n - 1; slider.step = 1; slider.value = gridIn[k];
            const idxLbl = el('span', 'iccviz-nodeidx', gridIn[k] + '/' + (n - 1));
            slider.addEventListener('input', (e) => { gridIn[k] = +e.target.value; idxLbl.textContent = gridIn[k] + '/' + (n - 1); recompute(); });
            row.appendChild(slider); row.appendChild(idxLbl);
          } else {
            const rg = channelRange(info.srcSpaceSig, info.srcIsPcs, k);
            const slider = el('input', 'iccviz-slider'); slider.type = 'range';
            slider.min = rg.min; slider.max = rg.max; slider.step = rg.step; slider.value = floatIn[k];
            const num = el('input', 'iccviz-num'); num.type = 'number';
            num.min = rg.min; num.max = rg.max; num.step = rg.step; num.value = floatIn[k];
            slider.addEventListener('input', (e) => { floatIn[k] = +e.target.value; num.value = floatIn[k]; recompute(); });
            num.addEventListener('input', (e) => { floatIn[k] = +e.target.value; slider.value = floatIn[k]; recompute(); });
            row.appendChild(slider); row.appendChild(num);
          }
          inCol.appendChild(row);
        });
      }

      function setMode(next) {
        if (next === 'grid' && !hasGrid) return;
        mode = next;
        floatBtn.classList.toggle('iccviz-modeon', mode === 'float');
        gridBtn.classList.toggle('iccviz-modeon', mode === 'grid');
        floatBtn.setAttribute('aria-selected', mode === 'float' ? 'true' : 'false');
        gridBtn.setAttribute('aria-selected', mode === 'grid' ? 'true' : 'false');
        buildInputs(); recompute();
      }
      floatBtn.addEventListener('click', () => setMode('float'));
      gridBtn.addEventListener('click', () => setMode('grid'));
      setMode('float');
    }).catch((e) => { if (host.isConnected) host.replaceChildren(errorNode(e.message || String(e))); });

    return host;
  }

  // ── the data dump (verbosity-75 immediately → verbosity-100 lazily) ─────────
  // Mirrors the original _toggleIccTagDetail behaviour, now as a reusable node.
  function dataDump(bytes, tag) {
    const frag = document.createDocumentFragment();
    const noContent = tr('icc_viz_no_content', '(No content)');
    const pre = el('pre', null, tag.description ? tag.description : noContent);
    const loading = el('div', 'iccviz-dumploading', tr('icc_viz_loading_desc', 'Loading full description…'));
    frag.appendChild(pre); frag.appendChild(loading);
    window.IccViewer.describeTag(bytes, tag.id).then((full) => {
      if (!pre.isConnected) return;
      pre.textContent = full || noContent;
      loading.remove();
    }).catch((e) => {
      if (!loading.isConnected) return;
      loading.className = 'iccviz-dumperr';
      loading.textContent = tr('icc_viz_load_desc_error', 'Could not load full description: ') + (e.message || String(e));
    });
    return frag;
  }

  // ── the dispatcher (port of TagVisuals.jsx) ─────────────────────────────────
  // Builds the inline visualizations + the data dump for one tag, in the same
  // order/arrangement as profiletool, and appends them to `container`.
  function renderTagDetail(container, opts) {
    const { bytes, tag, viz } = opts;
    container.replaceChildren();

    const descriptors = (viz && viz.byTag.get(tag.id)) || [];
    const chromaDesc = (viz && viz.chroma) || null;
    const gamutDesc = (tag.id !== 'gamt' && viz && viz.gamut) || null;
    const dump = () => dataDump(bytes, tag);

    const isLut = descriptors.some((d) => d.kind === KIND.ClutImage || d.grp);

    if (isLut) {
      renderLut(container, { bytes, tag, descriptors, gamutDesc, dump });
      return;
    }

    if (tag.id === 'wtpt' && chromaDesc) {
      const c = collapsible(tr('icc_viz_chromaticity', 'Chromaticity'), true);
      c.body.appendChild(graphView(bytes, chromaDesc.id, 'white'));
      container.appendChild(c.section);
      container.appendChild(dump());
      return;
    }

    if (COLORANT_HL[tag.id] && chromaDesc) {
      const c = collapsible(tr('icc_viz_chromaticity', 'Chromaticity'), true);
      c.body.appendChild(graphView(bytes, chromaDesc.id, COLORANT_HL[tag.id]));
      container.appendChild(c.section);
      container.appendChild(dump());
      return;
    }

    if (TRC_TAGS.has(tag.id)) {
      const trc = descriptors.find((d) => d.kind === KIND.Curve1D);
      if (trc) {
        const c = collapsible(tr('icc_viz_tone_curve', 'Tone curve'), true);
        c.body.appendChild(graphView(bytes, trc.id));
        container.appendChild(c.section);
      }
      const tbl = collapsible(tr('icc_viz_curve_table', 'Curve table'), false);
      tbl.body.appendChild(dump());
      container.appendChild(tbl.section);
      return;
    }

    const ab = descriptors.find((d) => d.kind === KIND.NamedColorsAB);
    const xy = descriptors.find((d) => d.kind === KIND.NamedColorsXY);
    if (ab || xy) {
      const c = collapsible(tr('icc_viz_scatter', 'Scatter'), true);
      if (ab) c.body.appendChild(graphView(bytes, ab.id));
      if (xy) c.body.appendChild(graphView(bytes, xy.id));
      container.appendChild(c.section);
      const tbl = collapsible(tr('icc_viz_tables', 'Tables'), false);
      tbl.body.appendChild(dump());
      container.appendChild(tbl.section);
      return;
    }

    // No visualization for this tag — just the dump, as before.
    container.appendChild(dump());
  }

  function renderLut(container, opts) {
    const { bytes, tag, descriptors, gamutDesc, dump } = opts;
    const isGamut = tag.id === 'gamt';
    const isAToB = ATOB_TAGS.has(tag.id);
    const inputGrps = isAToB ? ['A'] : ['B', 'M'];
    const outputGrps = isAToB ? ['B', 'M'] : ['A'];
    const inputCurves = descriptors.filter((d) => d.kind === KIND.Curve1D && inputGrps.includes(d.grp));
    const outputCurves = descriptors.filter((d) => d.kind === KIND.Curve1D && outputGrps.includes(d.grp));
    const clut = descriptors.find((d) => d.kind === KIND.ClutImage);
    // tagEvalInfo shared by the curve colouring + (implicitly) the evaluator.
    const infoPromise = window.IccViewer.tagEvalInfo(bytes, tag.id).catch(() => null);

    if (inputCurves.length || outputCurves.length) {
      const c = collapsible(tr('icc_viz_curves', 'Curves'), !isGamut);
      if (inputCurves.length) {
        c.body.appendChild(el('div', 'iccviz-subhead', tr('icc_viz_input_curves', 'Input curves')));
        c.body.appendChild(combinedCurves(bytes, inputCurves, infoPromise, 'src'));
      }
      if (outputCurves.length) {
        c.body.appendChild(el('div', 'iccviz-subhead', tr('icc_viz_output_curves', 'Output curves')));
        c.body.appendChild(combinedCurves(bytes, outputCurves, infoPromise, 'dst'));
      }
      container.appendChild(c.section);
    }

    if (clut) {
      const c = collapsible(isGamut ? tr('icc_viz_gamut', 'Gamut') : tr('icc_viz_clut', 'CLUT'), true);
      c.body.appendChild(rasterView(bytes, clut.id, isGamut));
      container.appendChild(c.section);
    }

    if (gamutDesc) {
      const c = collapsible(tr('icc_viz_gamut', 'Gamut'), true);
      c.body.appendChild(rasterView(bytes, gamutDesc.id, true));
      container.appendChild(c.section);
    }

    if (!isGamut) {
      const c = collapsible(tr('icc_viz_evaluate', 'Evaluate'), true);
      c.body.appendChild(tagEvaluator(bytes, tag));
      container.appendChild(c.section);
    }

    const data = collapsible(tr('icc_viz_data', 'Data'), false);
    data.body.appendChild(dump());
    container.appendChild(data.section);
  }

  // ── profile-level enumerate (cached by the caller per profile) ──────────────
  // Returns { byTag: Map<tagSig, descriptors[]>, chroma, gamut } or null on any
  // failure (best-effort — tags then fall back to the plain dump).
  async function enumerate(bytes) {
    try {
      const descs = await window.IccViewer.enumerate(bytes);
      const byTag = new Map();
      for (const d of descs) {
        if (!d.tagSig) continue;
        if (!byTag.has(d.tagSig)) byTag.set(d.tagSig, []);
        byTag.get(d.tagSig).push(d);
      }
      const chroma = descs.find((d) => d.kind === KIND.ChromaticityXY) || null;
      const gamut = descs.find((d) => d.tagSig === 'gamt' && d.kind === KIND.ClutImage) || null;
      return { byTag, chroma, gamut };
    } catch (_e) {
      return null;
    }
  }

  window.IccViz = { enumerate, renderTagDetail };
})();
