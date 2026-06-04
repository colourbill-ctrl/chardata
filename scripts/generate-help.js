'use strict';
// scripts/generate-help.js
// Run with: node scripts/generate-help.js
// Regenerates public/help.html including all SVG layout diagrams.

const fs   = require('fs');
const path = require('path');
const OUT  = path.join(__dirname, '../public/help.html');

// ── SVG primitives ────────────────────────────────────────────────────────────

const SHARED_STYLE = `
<style>
:root {
  --bg:#f0f2f5; --pnl:#fff; --pnl-bd:#ccd6e0; --hd:#e8edf2; --hd-bd:#c0ccd8;
  --sec:#f5f6f8; --sec-bd:#dde4ec; --btn:#e8edf2; --btn-bd:#bbb;
  --act:#4a90e2; --act2:#2a6ab5; --red:#e24a4a;
  --tx:#333; --tx2:#555; --tx3:#888; --txW:#fff; --txA:#1a5a8a;
  --ln:#dde4ec;
}
@media(prefers-color-scheme:dark){
  :root{
    --bg:#1a1c1f; --pnl:#22262e; --pnl-bd:#3a4048; --hd:#252930; --hd-bd:#3a4048;
    --sec:#1e2128; --sec-bd:#333a44; --btn:#252930; --btn-bd:#444;
    --act:#2a5a90; --act2:#1f4070; --red:#8a2a2a;
    --tx:#c8cdd4; --tx2:#9aa0a8; --tx3:#555e6a; --txW:#c8cdd4; --txA:#7ab8e8;
    --ln:#2e3440;
  }
}
rect.bg   { fill:var(--bg); }
rect.pnl  { fill:var(--pnl);  stroke:var(--pnl-bd); stroke-width:1.5; }
rect.hd   { fill:var(--hd);   stroke:var(--hd-bd);  stroke-width:1; }
rect.sec  { fill:var(--sec);  stroke:var(--sec-bd); stroke-width:1; }
rect.btn  { fill:var(--btn);  stroke:var(--btn-bd); stroke-width:1; }
rect.act  { fill:var(--act);  stroke:var(--act2);   stroke-width:1; }
rect.red  { fill:var(--red);  stroke:#a03030;        stroke-width:1; }
rect.lnbd { fill:none; stroke:var(--ln); stroke-width:1; }
line.div  { stroke:var(--ln); stroke-width:1; }
text      { font-family:Arial,sans-serif; font-size:11px; fill:var(--tx); }
text.tT   { font-size:13px; font-weight:bold; fill:var(--txA); }
text.tB   { font-weight:bold; }
text.t2   { fill:var(--tx2); }
text.t3   { fill:var(--tx3); font-size:10px; }
text.tW   { fill:var(--txW); }
text.tA   { fill:var(--txA); font-weight:bold; }
</style>`;

function svg(w, h, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}"
  style="width:100%;max-width:${w}px;display:block;margin:20px 0;border-radius:8px;overflow:visible;">
${SHARED_STYLE}
${body}
</svg>`;
}

const R = (x,y,w,h,cls,rx=5) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" class="${cls}"/>`;

const T = (x,y,s,cls='',anchor='middle') =>
  `<text x="${x}" y="${y}" text-anchor="${anchor}" class="${cls}">${s}</text>`;

const L = (x1,y1,x2,y2) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="div"/>`;

// Callout label: small text connected to a point by a short line
function callout(lx, ly, tx, ty, label, cls='t3') {
  return `<line x1="${lx}" y1="${ly}" x2="${tx}" y2="${ty}" stroke="var(--tx3)" stroke-width="1" stroke-dasharray="3,2"/>
${T(tx, ty - 3, label, cls, tx > lx ? 'start' : 'end')}`;
}

// ── Diagram 1: Overall App Layout ────────────────────────────────────────────
// Three regions: the File Select pane (LEFT), the main canvas holding the
// Dataset A / Dataset B slots + mode content (CENTRE), and the Settings blade
// (RIGHT). Dataset boxes live in the CENTRE canvas, not the File Select pane.
function diag_layout() {
  const W=760, H=350;
  const TOP=10, BOT=H-10;
  const LP=10,  LW=158;          // left: File Select pane
  const CP=176, CW=420;          // centre: main canvas
  const RP=606, RW=144;          // right: Settings blade

  let b = '';
  b += R(0,0,W,H,'bg',0);

  // ── Left: File Select pane (file list / cards) ──
  b += R(LP,TOP,LW,BOT-TOP,'pnl');
  b += R(LP,TOP,LW,26,'hd');
  b += T(LP+LW/2, TOP+17, 'File Select', 'tT');
  b += R(LP+8,TOP+32,LW-16,18,'btn',3);
  b += T(LP+LW/2, TOP+44, '+  Load files…', 't3');
  const secs = [
    ['▾ Standard datasets',     'FOGRA51.txt'],
    ['▾ Characterization data', 'myjob.csv'],
    ['▾ ICC Profiles',          'press.icc'],
  ];
  let fy = TOP+56;
  for (const [hdr, card] of secs) {
    b += R(LP+8, fy, LW-16, 16, 'hd', 3);
    b += T(LP+13, fy+11, hdr, 't3', 'start');
    b += R(LP+12, fy+18, LW-24, 14, 'sec', 3);
    b += T(LP+18, fy+28, card, 't3', 'start');
    fy += 38;
  }
  b += T(LP+LW/2, fy+14, 'Drag a card onto', 't3');
  b += T(LP+LW/2, fy+27, 'a Dataset box →', 't3');

  // ── Centre: main canvas ──
  b += R(CP,TOP,CW,BOT-TOP,'pnl');
  // mode toggle
  b += R(CP+10,TOP+10,90,24,'act',4);
  b += T(CP+55, TOP+26, 'Explore', 'tW tB');
  b += R(CP+108,TOP+10,90,24,'btn',4);
  b += T(CP+153, TOP+26, 'Compare', 't2');

  // Dataset slots (Dataset A / B live HERE, in the main canvas)
  const slotW=(CW-30)/2, sAx=CP+10, sBx=CP+10+slotW+10, sY=TOP+46, sH=96;
  // Dataset A — loaded
  b += R(sAx,sY,slotW,sH,'pnl');
  b += R(sAx,sY,slotW,20,'hd');
  b += T(sAx+slotW/2, sY+14, 'Dataset A  ✓', 'tB');
  b += T(sAx+slotW/2, sY+34, 'FOGRA51.txt', 't3');
  b += T(sAx+slotW/2, sY+48, 'Char. dataset · 1485 rows', 't3');
  b += T(sAx+slotW/2, sY+62, 'CMYK · spectral ✓', 't3');
  b += R(sAx+12,sY+sH-26,slotW-24,16,'btn',3);
  b += T(sAx+slotW/2, sY+sH-15, 'Display File', 't3');
  // Dataset B — empty
  b += R(sBx,sY,slotW,sH,'pnl');
  b += R(sBx,sY,slotW,20,'hd');
  b += T(sBx+slotW/2, sY+14, 'Dataset B', 'tB');
  b += T(sBx+slotW/2, sY+58, '(drag a card here)', 't3');

  // mode content area
  const cy = sY+sH+12;
  b += R(CP+10, cy, CW-20, BOT-cy-2, 'lnbd', 4);
  b += T(CP+CW/2, cy+50, 'Mode content', 'tT');
  b += T(CP+CW/2, cy+70, 'Data Table · 3D Gamut · 2D Slice', 't3');
  b += T(CP+CW/2, cy+84, 'Tone Value · G7 · Estimate', 't3');

  // ── Right: Settings blade ──
  b += R(RP,TOP,RW,BOT-TOP,'pnl');
  b += R(RP,TOP,38,34,'btn',0);    b += T(RP+19, TOP+21, '⚙', 't2');
  b += R(RP,TOP+42,38,34,'btn',0); b += T(RP+19, TOP+62, '?', 't2');
  b += L(RP+38,TOP,RP+38,BOT);
  b += T(RP+38+(RW-38)/2, TOP+20, 'Settings', 'tT');
  ['ΔE Method','Filter Duplicates','Spectral → LAB','Model','Background']
    .forEach((s,i) => b += T(RP+38+(RW-38)/2, TOP+44+i*18, s, 't2'));

  // ── Callouts ──
  b += callout(sAx+slotW/2, sY+sH, sAx+slotW/2, cy+20, 'Dataset boxes — in the main canvas (drag a card here)', 't3');
  b += callout(LP+LW/2, TOP+13, LP+LW/2-6, TOP-6, 'File Select pane', 't3');
  b += callout(RP+19, TOP+21, RP+96, TOP-6, 'Settings panel', 't3');

  return svg(W, H, b);
}

// ── Diagram 2: Explore Mode Sections ─────────────────────────────────────────
function diag_explore() {
  const W=720, H=370;
  const LP=10, LW=150;
  const CP=168, CW=542;
  const TOP=10;

  let b = '';
  b += R(0,0,W,H,'bg',0);

  // Left pane — Dataset A loaded
  b += R(LP,TOP,LW,H-TOP-10,'pnl');
  b += R(LP,TOP,LW,22,'hd');
  b += T(LP+LW/2, TOP+15, 'File Select', 'tT');
  b += R(LP+6,TOP+28,LW-12,80,'pnl');
  b += R(LP+6,TOP+28,LW-12,18,'hd');
  b += T(LP+LW/2, TOP+40, 'Dataset A  ✓', 'tB');
  b += T(LP+LW/2, TOP+56, 'profile.csv', 't3');
  b += T(LP+LW/2, TOP+68, '1 200 rows', 't3');
  b += T(LP+LW/2, TOP+80, 'CMYK + Spectral', 't3');
  b += R(LP+12,TOP+112,LW-24,14,'btn',3);
  b += T(LP+LW/2, TOP+122, 'Dataset B  (empty)', 't3');

  // Center — sections
  b += R(CP,TOP,CW,H-TOP-10,'pnl');

  // Mode bar
  b += R(CP+8,TOP+8,90,22,'act',4);
  b += T(CP+8+45, TOP+23, 'Explore', 'tW tB');
  b += R(CP+104,TOP+8,90,22,'btn',4);
  b += T(CP+104+45, TOP+23, 'Compare', 't2');

  // Sections
  const sections = [
    ['▶  Data Table',          false],
    ['▼  3D Gamut Plot',       true ],
    ['     ☑ Show gamut shell · ☑ Show data points · ☑ Color by hue · ☑ Color by value', false, true],
    ['     Shell opacity ░░░░░░░░░░░░░░░░', false, true],
    ['     ☐ Show spectral data when point selected', false, true],
    ['▶  Gamut Slice (2D)',    false],
    ['▶  Tone Value',          false],
    ['▶  G7 Report',           false],
    ['▶  Estimate',            false],
  ];

  let sy = TOP+40;
  for (const [label, open, sub] of sections) {
    const h = 22;
    const cls = sub ? 'pnl' : (open ? 'pnl' : 'sec');
    b += R(CP+8, sy, CW-16, h, cls, 3);
    if (!sub) b += T(CP+18, sy+15, label, open ? 'tA' : 't2', 'start');
    else       b += T(CP+18, sy+15, label, 't3', 'start');
    sy += h + 2;
  }

  // Callouts
  b += callout(CP+8+45, TOP+23, CP+8+45, TOP+23-30, 'Active mode', 't3');
  b += callout(CP+18, TOP+62, W-10, TOP+62, 'Collapsed section (click to expand)', 't3');
  b += callout(CP+18, TOP+108, W-10, TOP+108, 'Expanded section', 't3');

  return svg(W, H, b);
}

// ── Diagram 3: Compare Mode ───────────────────────────────────────────────────
function diag_compare() {
  const W=720, H=310;
  const LP=10, LW=150;
  const CP=168, CW=542;
  const TOP=10;

  let b = '';
  b += R(0,0,W,H,'bg',0);

  // Left pane — both datasets loaded
  b += R(LP,TOP,LW,H-TOP-10,'pnl');
  b += R(LP,TOP,LW,22,'hd');
  b += T(LP+LW/2, TOP+15, 'File Select', 'tT');

  b += R(LP+6,TOP+28,LW-12,68,'pnl');
  b += R(LP+6,TOP+28,LW-12,18,'hd');
  b += T(LP+LW/2, TOP+40, 'Dataset A  ✓', 'tB');
  b += T(LP+LW/2, TOP+58, 'profile_A.csv', 't3');
  b += T(LP+LW/2, TOP+72, '1 200 rows', 't3');
  b += T(LP+LW/2, TOP+86, 'CMYK+LAB', 't3');

  b += R(LP+6,TOP+102,LW-12,68,'pnl');
  b += R(LP+6,TOP+102,LW-12,18,'hd');
  b += T(LP+LW/2, TOP+114, 'Dataset B  ✓', 'tB');
  b += T(LP+LW/2, TOP+132, 'profile_B.csv', 't3');
  b += T(LP+LW/2, TOP+146, '1 180 rows', 't3');
  b += T(LP+LW/2, TOP+160, 'CMYK+LAB', 't3');

  // Center
  b += R(CP,TOP,CW,H-TOP-10,'pnl');

  // Mode bar
  b += R(CP+8,TOP+8,90,22,'btn',4);
  b += T(CP+8+45, TOP+23, 'Explore', 't2');
  b += R(CP+104,TOP+8,90,22,'act',4);
  b += T(CP+104+45, TOP+23, 'Compare', 'tW tB');

  // Stats box
  b += R(CP+8,TOP+38,CW-16,46,'sec',4);
  b += T(CP+8+30, TOP+55, 'Mean ΔE00', 't3', 'middle');
  b += T(CP+8+30, TOP+73, '2.41', 'tB');
  b += T(CP+8+100, TOP+55, 'Min ΔE00', 't3', 'middle');
  b += T(CP+8+100, TOP+73, '0.18', 'tB');
  b += T(CP+8+170, TOP+55, 'Max ΔE00', 't3', 'middle');
  b += T(CP+8+170, TOP+73, '8.93', 'tB');
  b += T(CP+8+240, TOP+55, 'Std Dev', 't3', 'middle');
  b += T(CP+8+240, TOP+73, '1.67', 'tB');

  // Table header
  const ty = TOP+92;
  b += R(CP+8,ty,CW-16,22,'hd',0);
  const cols = ['C','M','Y','K','L*(A)','a*(A)','b*(A)','L*(B)','a*(B)','b*(B)','ΔE','ΔH'];
  const cw = (CW-16)/cols.length;
  cols.forEach((c,i) => {
    b += T(CP+8 + i*cw + cw/2, ty+15, c, 't3');
    if (i>0) b += L(CP+8+i*cw, ty, CP+8+i*cw, ty+22);
  });

  // Table rows (sample)
  for (let r=0; r<5; r++) {
    const ry = ty+22 + r*22;
    b += R(CP+8,ry,CW-16,22, r%2===0?'sec':'pnl', 0);
    const vals = ['100','0','0','0','28','48','-3','27','47','-2','0.9','0.5'];
    vals.forEach((v,i) => {
      b += T(CP+8 + i*cw + cw/2, ry+15, r===0?v:'…', 't3');
    });
  }

  // Callout
  b += callout(CP+8+120, TOP+55, CP+8+120, TOP+36, 'Summary statistics', 't3');
  b += callout(CP+8+cols.length*cw/2, ty+15, W-5, ty+5, 'Sortable columns', 't3');

  return svg(W, H, b);
}

// ── Diagram 4: Settings Panel ─────────────────────────────────────────────────
function diag_settings() {
  const W=380;
  const SX=58, SW=W-68;
  const VALW=110;          // value-dropdown width
  const VALX=SX+SW-VALW-4; // value-dropdown x

  let content = '';
  let gy = 46;

  const row = (label, value) => {
    content += T(SX+4, gy+13, label, 't3', 'start');
    content += R(VALX, gy, VALW, 18, 'btn', 3);
    content += T(VALX+8, gy+13, value, 't2', 'start');
    content += T(VALX+VALW-8, gy+13, '▾', 't3', 'end');
    gy += 24;
  };
  const section = (label) => {
    content += T(SX+4, gy+13, label, 't2 tB', 'start');
    gy += 20;
  };
  const divider = () => {
    content += L(SX, gy, SX+SW, gy);
    gy += 10;
  };

  row('ΔE Method', 'ΔE00');
  row('Filter Duplicates', 'Yes');
  row('Filter Method', 'Median');
  divider();
  section('Spectral → LAB');
  row('Illuminant', 'D50');
  row('Standard Observer', '2°');
  row('M-Condition', 'M0');
  divider();
  section('Model');
  row('Weighted', 'Off');
  divider();
  section('Display');
  row('Background', 'System');
  row('Language', 'System default');

  const H = gy + 14;

  let chrome = '';
  chrome += R(0,0,W,H,'bg',0);
  chrome += R(10,10,W-20,H-20,'pnl');
  chrome += R(10,10,38,34,'btn',0); chrome += T(29,31,'⚙','t2');
  chrome += R(10,46,38,34,'btn',0); chrome += T(29,67,'?','t2');
  chrome += L(48,10,48,H-10);
  chrome += T(SX+SW/2, 26, 'Settings', 'tT');
  chrome += L(SX,36,SX+SW,36);

  return svg(W, H, chrome + content);
}

// ── Diagram 5: 3D Gamut Plot Controls ────────────────────────────────────────
function diag_gamut() {
  const W=720, H=270;
  let b = '';
  b += R(0,0,W,H,'bg',0);

  // Control panel
  b += R(10,10,W-20,80,'pnl');
  b += R(10,10,W-20,22,'hd');
  b += T(W/2, 25, '3D Gamut Plot Controls', 'tT');

  // Global controls row 1
  const items1 = ['☑ Show gamut shell','☑ Show data points','☑ Color by hue angle','☑ Color by value'];
  items1.forEach((s,i) => {
    b += T(20 + i*175, 48, s, 't2', 'start');
  });

  // Global controls row 2
  b += T(20, 68, 'Shell opacity:', 't3', 'start');
  b += R(98,60,120,12,'btn',2);
  b += R(98,60,70,12,'act',2);  // filled portion
  b += T(230, 68, '☐ Show spectral data when point selected', 't3', 'start');

  // Thin divider line
  b += L(10,92,W-10,92);
  b += T(20, 108, 'Per-slot controls (gear icon ⚙ in legend):', 't3', 'start');

  // Plot area
  b += R(10,118,W-20,H-128,'sec',4);
  b += T(W/2, 170, '3D L*a*b* Gamut Plot', 'tT');
  b += T(W/2, 192, '(interactive — rotate, zoom, click points)', 't3');

  // Legend area
  b += R(W-160,128,140,60,'pnl',4);
  b += T(W-160+10, 143, '⚙  Dataset A', 'tA', 'start');
  b += T(W-160+10, 161, '⚙  Dataset B', 't2', 'start');
  b += T(W-160+10, 175, '↑ click to toggle', 't3', 'start');

  // Callouts
  b += callout(20+87, 48, 20+87, 38, 'Global checkboxes', 't3');
  b += callout(W-160+10, 143, W-145, 108, 'Per-slot gear', 't3');

  return svg(W, H, b);
}

// ── Diagram 6: Estimate Section ───────────────────────────────────────────────
function diag_estimate() {
  const W=720, H=310;
  let b = '';
  b += R(0,0,W,H,'bg',0);
  b += R(10,10,W-20,H-20,'pnl');
  b += R(10,10,W-20,22,'hd');
  b += T(W/2, 25, 'Estimate Section  (Explore mode)', 'tT');

  // Before model generated
  b += R(18,38,200,H-50,'sec',4);
  b += T(118, 56, 'Before generating', 'tB t2');
  b += R(28,66,180,24,'act',4);
  b += T(118, 82, 'Generate model', 'tW tB');
  b += T(118, 106, 'Click to fit polynomial', 't3');
  b += T(118, 120, 'model to the dataset', 't3');

  // After model generated
  b += R(228,38,W-238,H-50,'pnl',4);
  b += T(228+(W-238)/2, 56, 'After generating', 'tB t2');

  // Stats box
  b += R(238,64,W-248,42,'sec',4);
  b += T(238+40, 80, 'Mean ΔE', 't3'); b += T(238+40, 96, '1.83', 'tB');
  b += T(238+110, 80, 'Min ΔE', 't3'); b += T(238+110, 96, '0.04', 'tB');
  b += T(238+180, 80, 'Max ΔE', 't3'); b += T(238+180, 96, '7.21', 'tB');
  b += T(238+250, 80, 'Std Dev', 't3'); b += T(238+250, 96, '1.12', 'tB');
  b += T(238+330, 80, 'Pts', 't3');    b += T(238+330, 96, '1200', 'tB');

  // Table
  b += R(238,114,W-248,H-126,'sec',4);
  const cols2 = [80,120,80,80];
  const headers2 = ['Colorant','Slider','Model','Nearest'];
  let cx2 = 238;
  headers2.forEach((h,i) => {
    b += R(cx2, 114, cols2[i], 20, 'hd', 0);
    b += T(cx2+cols2[i]/2, 128, h, 't3');
    cx2 += cols2[i];
  });

  const crows = [['CYAN','░░░░░▓░░░','42'],['MAGENTA','░░░░░░░▓░','71'],['YELLOW','░░▓░░░░░░','23'],['BLACK','░░░░░▓░░░','45']];
  crows.forEach(([c,sl,v],i) => {
    const ry = 136 + i*22;
    b += T(238+40, ry+14, c, 't2'); // col 1
    b += T(238+80+40, ry+14, sl, 't3'); // col 2
    b += T(238+200+40, ry+14, v, 't3'); // col 3
    b += T(238+280+40, ry+14, i===0?v:'…', 't3'); // col 4
  });

  b += L(238,224,W-10,224);
  b += T(238+40, 240, 'L*', 't3'); b += T(238+200+40, 240, '61.2', 'tB t2'); b += T(238+280+40, 240, '60.8', 't3');
  b += T(238+40, 256, 'a*', 't3'); b += T(238+200+40, 256, '-3.1', 'tB t2'); b += T(238+280+40, 256, '-3.4', 't3');
  b += T(238+40, 272, 'b*', 't3'); b += T(238+200+40, 272, '12.4', 'tB t2'); b += T(238+280+40, 272, '12.1', 't3');

  b += R(W-100,H-38,84,22,'btn',4);
  b += T(W-58, H-23, '↺ Regenerate', 't3');

  // Callouts
  b += callout(238+40, 80, 140, 64, 'Fit statistics', 't3');
  b += callout(238+40, 190, 140, 200, 'Colorant sliders', 't3');
  b += callout(238+200+40, 240, 238+200+40, H-12, 'Model prediction', 't3');
  b += callout(238+280+40, 240, W-10, H-12, 'Nearest in dataset', 't3');

  return svg(W, H, b);
}

// ── Diagram 7: 2D Gamut Slice ─────────────────────────────────────────────────
function diag_slice() {
  const W=720, H=300;
  let b = '';
  b += R(0,0,W,H,'bg',0);

  // Control bar
  b += R(10,10,W-20,46,'pnl');
  b += R(10,10,W-20,22,'hd');
  b += T(W/2, 25, '2D Gamut Slice Controls', 'tT');
  b += T(20, 49, 'Slice axis:', 't3', 'start');
  b += R(92,41,38,14,'act',3);  b += T(111, 51, 'L*', 'tW');
  b += R(134,41,38,14,'btn',3); b += T(153, 51, 'a*', 't2');
  b += R(176,41,38,14,'btn',3); b += T(195, 51, 'b*', 't2');
  b += T(250, 49, 'Position', 't3', 'start');
  b += R(308,43,120,10,'btn',2); b += R(308,43,66,10,'act',2);
  b += T(452, 49, 'Thickness', 't3', 'start');
  b += R(522,43,80,10,'btn',2);  b += R(522,43,26,10,'act',2);
  b += T(700, 49, '☑ Soft view', 't3', 'end');

  // Plot area — a*b* plane at fixed L*
  b += R(10,64,W-20,H-74,'sec',4);
  const cx = W/2, cy = 64 + (H-74)/2;
  b += `<ellipse cx="${cx}" cy="${cy}" rx="180" ry="76" fill="none" stroke="var(--act)" stroke-width="1.5"/>`;
  b += L(cx-200,cy,cx+200,cy);
  b += L(cx,cy-92,cx,cy+92);
  b += T(cx+206, cy+3, 'a*', 't3', 'start');
  b += T(cx, cy-98, 'b*', 't3');
  const pts = [[-130,-28],[-60,18],[8,-40],[64,28],[126,-10],[-28,48],[92,-48],[36,58],[-96,40]];
  pts.forEach(([dx,dy],i) => {
    const near = i % 3 === 0;
    b += `<circle cx="${cx+dx}" cy="${cy+dy}" r="${near?4:2.5}" fill="var(--act2)" opacity="${near?'1':'0.32'}"/>`;
  });

  // Callouts
  b += callout(cx+90, cy-66, cx+90, cy-104, 'Gamut boundary at this slice', 't3');
  b += callout(374, 48, 374, 30, 'Slice position', 't3');
  b += callout(cx-130, cy-28, 24, cy-28, 'Soft view fades distant points', 't3');

  return svg(W, H, b);
}

// ── Diagram 8: Extract subset ─────────────────────────────────────────────────
function diag_extract() {
  const W=560, H=300;
  let b = '';
  b += R(0,0,W,H,'bg',0);
  b += R(10,10,W-20,H-20,'pnl');
  b += R(10,10,W-20,22,'hd');
  b += T(W/2, 25, 'Extract — build a subset by dropping rows', 'tT');

  const cols = ['C','M','Y','K','O','G','V'];
  const tx0 = 24, tw = (W-48)/cols.length, ty = 42;
  b += R(tx0,ty,W-48,20,'hd',0);
  cols.forEach((c,i) => {
    b += T(tx0 + i*tw + tw/2, ty+14, c, 't3');
    if (i>0) b += L(tx0+i*tw, ty, tx0+i*tw, ty+20);
  });

  // keep = part of CMYK extract; dropped = O/G/V primary rows
  const rows = [
    ['100','0','0','0','0','0','0', true ],
    ['0','100','0','0','0','0','0', true ],
    ['0','0','0','0','100','0','0', false],
    ['0','0','100','0','0','0','0', true ],
    ['0','0','0','0','0','100','0', false],
    ['0','0','0','100','0','0','0', true ],
    ['0','0','0','0','0','0','100', false],
  ];
  rows.forEach((r,ri) => {
    const rry = ty+20 + ri*24, keep = r[7];
    b += R(tx0,rry,W-48,24, keep ? (ri%2 ? 'pnl':'sec') : 'btn', 0);
    cols.forEach((c,i) => { b += T(tx0 + i*tw + tw/2, rry+15, r[i], keep ? 't2' : 't3'); });
    if (!keep) b += L(tx0+4, rry+12, tx0+W-52, rry+12);  // strike-through dropped rows
  });

  b += R(W-160,H-40,140,26,'act',5);
  b += T(W-90, H-23, 'Extract CMYK', 'tW tB');

  b += callout(tx0+W-48-30, ty+20+24*2+12, W-26, ty+20+24*2+12, 'Rows dropped (O · G · V)', 't3');
  b += callout(tx0+40, ty+20+12, 26, ty+20+12, 'Rows kept (C · M · Y · K)', 't3');

  return svg(W, H, b);
}

// ── Diagram 9: Data Table (expanded) ─────────────────────────────────────────
function diag_datatable() {
  const W=600, H=300;
  let b = '';
  b += R(0,0,W,H,'bg',0);
  b += R(10,10,W-20,H-20,'pnl');
  b += R(10,10,W-20,24,'hd');
  b += T(W/2, 26, 'Data Table  (Explore mode)', 'tT');

  // expanded-section bar
  b += R(18,40,W-36,18,'sec',3);
  b += T(26, 53, '▼ Data Table', 'tA', 'start');
  b += T(W-26, 53, 'click a header to sort', 't3', 'end');

  // table
  const cols = ['#','C','M','Y','K','L*','a*','b*'];
  const tx0 = 18, tw = (W-36)/cols.length, ty = 64;
  b += R(tx0,ty,W-36,22,'hd',0);
  cols.forEach((c,i) => {
    const lab = c === 'L*' ? 'L* ▲' : c;   // sorted-ascending indicator on L*
    b += T(tx0 + i*tw + tw/2, ty+15, lab, c === 'L*' ? 'tA' : 't3');
    if (i>0) b += L(tx0+i*tw, ty, tx0+i*tw, ty+22);
  });

  const rows = [
    ['1','0','0','0','0','95.0','-0.2','2.1'],
    ['2','100','0','0','0','55.3','-37.1','-50.2'],
    ['3','0','100','0','0','48.6','74.2','-3.4'],
    ['4','0','0','100','0','89.1','-5.0','93.0'],
    ['5','0','0','0','100','16.2','0.4','-0.9'],
    ['6','50','40','30','10','58.7','3.2','5.8'],
    ['7','75','68','67','90','12.0','0.1','-0.6'],
  ];
  rows.forEach((r,ri) => {
    const ry = ty+22 + ri*22;
    b += R(tx0,ry,W-36,22, ri%2 ? 'pnl':'sec', 0);
    r.forEach((v,i) => b += T(tx0 + i*tw + tw/2, ry+15, v, i>=5 ? 't2' : 't3'));
  });

  b += callout(tx0 + 6*tw - tw/2, ty+15, tx0 + 6*tw - tw/2, ty-4, 'Device colorants, then L* a* b*', 't3');
  b += T(W/2, H-16, 'Double-click a row’s L*a*b* → spectral curve popup', 't3');
  return svg(W, H, b);
}

// ── Diagram 10: Tone Value ────────────────────────────────────────────────────
function diag_tonevalue() {
  const W=620, H=330;
  let b = '';
  b += R(0,0,W,H,'bg',0);
  b += R(10,10,W-20,H-20,'pnl');
  b += R(10,10,W-20,22,'hd');
  b += T(W/2, 25, 'Tone Value', 'tT');

  // chart frame
  const gx0=64, gx1=W-30, gy0=46, gy1=224;   // plot box (y0 top, y1 bottom)
  b += R(18,38,W-36,200,'sec',4);
  b += L(gx0,gy0,gx0,gy1);          // Y axis
  b += L(gx0,gy1,gx1,gy1);          // X axis
  b += T(gx0-8, gy0+6, 'TV%', 't3', 'end');
  b += T(gx1, gy1+16, 'ink %', 't3', 'end');
  b += T(gx0-8, gy1, '0', 't3', 'end');
  b += T(gx0-8, gy0+4, '100', 't3', 'end');
  b += T(gx0, gy1+16, '0', 't3');
  b += T(gx1, gy1+16, '100', 't3', 'end');

  // ideal-linear diagonal (dashed)
  b += `<line x1="${gx0}" y1="${gy1}" x2="${gx1}" y2="${gy0}" stroke="var(--tx3)" stroke-width="1" stroke-dasharray="4,3"/>`;

  // tone curves bowing above the diagonal (dot gain), one per colorant
  const curve = (bump, color) => {
    const n=10, pts=[];
    for (let i=0;i<=n;i++) {
      const t=i/n, x=gx0+(gx1-gx0)*t, yLin=gy1+(gy0-gy1)*t;
      const y=yLin - bump*Math.sin(Math.PI*t);
      pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
    }
    return `<polyline points="${pts.join(' ')}" fill="none" stroke="${color}" stroke-width="2"/>`;
  };
  b += curve(30, '#2aa4d4');   // C
  b += curve(24, '#d24a9a');   // M
  b += curve(14, '#d0a91e');   // Y
  b += curve(34, 'var(--tx)'); // K

  // legend swatches
  [['C','#2aa4d4'],['M','#d24a9a'],['Y','#d0a91e'],['K','var(--tx)']].forEach(([c,col],i) => {
    const lx = gx0+10 + i*34;
    b += `<line x1="${lx}" y1="${gy0+8}" x2="${lx+14}" y2="${gy0+8}" stroke="${col}" stroke-width="2"/>`;
    b += T(lx+22, gy0+12, c, 't3');
  });

  // control bar
  b += R(18,246,W-36,H-256,'pnl',4);
  b += T(26, 262, '▼ Controls', 'tA', 'start');
  const ctl = (x, label, val, w) => {
    b += T(x, 286, label, 't3', 'start');
    b += R(x, 290, w, 16, 'btn', 3);
    b += T(x+6, 302, val, 't2', 'start');
    b += T(x+w-8, 302, '▾', 't3', 'end');
  };
  ctl(26,  'Tone Method', 'Murray-Davies', 120);
  ctl(160, 'Filter', 'V', 44);
  ctl(220, 'Graph Type', 'Transfer', 86);
  b += T(330, 286, 'Colorants', 't3', 'start');
  ['☑ C','☑ M','☑ Y','☑ K'].forEach((c,i) => b += T(330 + i*52, 302, c, 't2', 'start'));

  // callout
  b += callout((gx0+gx1)/2, gy0+70, (gx0+gx1)/2+70, gy0+40, 'Curves above the diagonal = dot gain', 't3');
  return svg(W, H, b);
}

// ── Diagram registry: id → { svg, caption } ──────────────────────────────────
// Shared, single source of truth. The same SVG strings are embedded verbatim in
// the colourbill.com /chardata/ page so both surfaces render identical diagrams.
const DIAGRAMS = {
  layout:    { svg: diag_layout(),    caption: 'Overall layout — File Select pane (left), the Dataset A / B boxes and mode content in the main canvas (centre), Settings panel (right). The “Display File” / “Launch editor” buttons live on each Dataset box.' },
  settings:  { svg: diag_settings(),  caption: 'Settings panel — ΔE method, duplicate filtering and averaging, spectral→Lab conditions, model and display options.' },
  datatable: { svg: diag_datatable(), caption: 'Data Table (expanded) — one row per patch, sortable columns: device colorants first, then L* a* b*. Double-click the colorimetry for a row’s spectral curve.' },
  tonevalue: { svg: diag_tonevalue(), caption: 'Tone Value — printed tone value vs input ink % per colorant; curves above the diagonal show dot gain. The control bar selects Tone Method (Murray-Davies / CTV), filter and graph type.' },
  gamut:     { svg: diag_gamut(),     caption: '3D L*a*b* gamut plot — per-dataset gear controls for opacity/density, shell &amp; point-cloud toggles; click a point for its spectrum.' },
  slice:     { svg: diag_slice(),     caption: '2D gamut slice — move the slice along L*, a* or b*, adjust its thickness; soft view emphasises points near the slice.' },
  estimate:  { svg: diag_estimate(),  caption: 'Estimate — fit a forward model, then predict L*a*b* for any device-colorant combination; fit statistics shown alongside.' },
  extract:   { svg: diag_extract(),   caption: 'Extract — discard rows to build a subset, e.g. pull the CMYK data out of a CMYKOGV dataset.' },
  compare:   { svg: diag_compare(),   caption: 'Compare mode — row-by-row ΔE Comparison Table with aggregate statistics (mean / min / max / std dev) across matched patches.' },
};

// ── "Things you can do with CharData" — shared content ────────────────────────
const uihint = (diag, label) =>
  `<button type="button" class="cd-uihint" data-diag="${diag}">${label}</button>`;

const THINGS = [
  { id: 'view-datasets', heading: 'View characterization datasets: CGATS, CxF/X-3, CSV, ICC', html:
`<p>CharData reads characterization datasets in CGATS, CxF/X-3 and CSV formats &mdash; focusing on device colorants, colorimetry and spectral data. It will also load ICC profiles to use as characterization datasets, with some caveats. Although permissive about the wide variety of commercial CGATS variants, CharData flags any format issues and can be used for (loose) validation.</p>
<p>The loading workflow starts from the ${uihint('layout','collapsible File Select pane')} on the left. Use the file-selection button to load file handles into the dataset list beneath it; standard datasets from the ICC website are preloaded for convenience. Click-select or drag-and-drop datasets and ICC profiles onto the ${uihint('layout','Dataset boxes')} in the main canvas to activate them for viewing.</p>
<p>The &ldquo;Display File&rdquo; button in the ${uihint('layout','Dataset box')} shows the original (or edited) text of the dataset file. For ICC profiles the header and tags are shown, with an option to launch a simple ICC profile editor/inspector in a separate tab.</p>
<p>The ${uihint('settings','collapsible Settings panel')} on the right controls whether duplicates (by device colorant) are filtered, and the averaging method used &mdash; useful where a dataset repeats measurements of the same colorant.</p>
<p>The ${uihint('datatable','Data Table')} shows the data row by row. Double-clicking colorimetry reveals the spectral data for that row, when available. For ICC profiles a synthetic table is generated by sampling the A2B table.</p>
<p>The ${uihint('tonevalue','Tone Value tab')} plots tone value for the primary colorant ramps. Murray-Davies densitometry is available only when spectral data is present; otherwise CTV (Colour Tone Value) is used. In general, where both spectral and colorimetric data are available, the spectral data is treated as the source of truth.</p>` },

  { id: 'plot-datasets', heading: 'Plot datasets — 3D plot &amp; 2D slices', html:
`<p>Datasets can be viewed graphically and interactively, both as a ${uihint('gamut','3D plot')} in colorimetric L*a*b* space and as a ${uihint('slice','2D gamut slice view')}. Each dataset can be shown as its raw L*a*b* point cluster, as an estimated gamut shell (when a model can be generated), or both.</p>
<p>In the 3D plot, the gear icon on each dataset&rsquo;s legend label lets you change opacity and point density per dataset, and toggle the gamut or point cloud on or off. When spectral data is present you can view the spectral curve of any point by clicking it (with &ldquo;Show spectral data when point selected&rdquo; enabled).</p>
<p>The 2D Gamut Slice view moves a slice along any principal colorimetric direction &mdash; L*, a* or b* &mdash; which is especially useful for seeing how colorimetric points relate to gamut boundaries. Slice thickness is adjustable; the soft viewing mode emphasises points near the slice and de-emphasises those farther into or out of it.</p>` },

  { id: 'create-models', heading: 'Create simple models from datasets', html:
`<p>For datasets containing both device colorants and colour data (colorimetric and/or spectral) it is often possible to fit a forward model. When possible this model is generated on load, and the ${uihint('estimate','Estimate')} section lets you evaluate device colorants through it. This enables effective interpolation, but beware that the simple technique behaves less well with higher-dimensional data. Model fit statistics are shown below the dataset so you can judge how far to trust it.</p>
<p>There is no way to generate a model from a pure colour point cloud &mdash; device coordinates are a necessary condition.</p>` },

  { id: 'generate-gamuts', heading: 'Generate gamuts', html:
`<p>The model &mdash; whether fit from characterization data or evaluated through an ICC profile &mdash; is used to estimate a gamut shell, mapping the boundary of the device-colorant hypercube into L*a*b* space. That 3D boundary shape is then plotted in both the ${uihint('gamut','3D plot')} and ${uihint('slice','2D gamut slice')} views.</p>` },

  { id: 'extract-subsets', heading: 'Extract dataset subsets', html:
`<p>Some features within a characterization dataset &mdash; the CMY gray axis, the primary/secondary subsets, or a lower-dimensional subset of the full dataset &mdash; are used frequently. The ${uihint('extract','Extract')} function is a convenience for discarding data rows to build such a subset from the original.</p>
<p>For example, Extract can be used to pull the CMYK characterization data out of a CMYKOGV dataset.</p>` },

  { id: 'compare', heading: 'Compare datasets &amp; profiles', html:
`<p>CharData has two main uses: inspecting a single dataset, and comparing two directly. Comparison is enabled by selecting ${uihint('compare','Compare')} mode at the top of the app. As in Explore, drag or select a dataset or ICC profile from the File Select panel onto one of the two Dataset boxes; the comparisons are generated automatically.</p>
<p>The ${uihint('compare','Comparison Table')} shows a row-by-row comparison generating a variety of ΔE metrics (the specific ΔE type is configurable in the Settings pane). It only compares matching device colorants &mdash; with no matching colorants, or none at all (a pure colorimetric point cloud), no comparison can be made.</p>
<p>A set of ${uihint('compare','comparison aggregate statistics')} (mean, min, max, std dev) is presented right at the top &mdash; especially useful when evaluating differences between two datasets that should be of the same device, or between an ICC profile&rsquo;s absolute-colorimetric forward model and its formative characterization dataset.</p>
<p>Other useful comparisons include the tonal behaviour of the two datasets and their gamut-boundary locations, in either the 3D or 2D views.</p>` },

  { id: 'check-fit', heading: 'Check dataset vs profile fit', html:
`<p>A common use case is checking how well an ICC profile&rsquo;s (absolute) colorimetry matches its formative characterization dataset. This is easily done with ${uihint('compare','Compare mode')}: compare the two directly &mdash; the ICC profile as one dataset, and the corresponding characterization dataset as the other.</p>` },

  { id: 'view-icc', heading: 'View ICC profiles', html:
`<p>ICC profiles (currently supporting up to v4) load into CharData and behave much like characterization datasets, with some minor but important differences.</p>
<p>Because an ICC profile is a composite data format, the rendering intent must be chosen. For most CharData use cases that is Absolute Colorimetric (A2B3), though the others can be used too. Accordingly, only profile types that provide a device-colorant-to-colorimetry mapping (output, scanner, display) are supported; classes such as abstract and DeviceLink are not, and likely never will be.</p>
<p>${uihint('estimate','Estimate')} evaluates device colorants through the chosen forward-model intent, and ${uihint('tonevalue','Tone Value')} plots the CTV. A set of patches generated by evaluating device colorants through the forward model is currently implemented for CMYK only, as a convenience.</p>` },

  { id: 'edit-profiles', heading: 'Edit profiles (via profiletool)', html:
`<p>For ICC profiles loaded as a dataset, the ${uihint('layout','&ldquo;Display File&rdquo;')} button opens a view tab showing the header and tag content. A ${uihint('layout','&ldquo;Launch Editor&rdquo;')} button opens profiletool, the companion app based on the open-source IccDev project.</p>
<p>profiletool enables both viewing and limited editing of the header and tags by converting the ICC profile (a tag-based data construct) to either XML or JSON. You can edit the XML or JSON, convert the edited result back to ICC profile format, and save it out.</p>` },

  { id: 'image-gamut', heading: 'View image gamut', html:
`<p>CharData can convert an image into an L*a*b* point cloud, which can then be analysed directly or compared against a reference colour gamut.</p>
<p>The key steps are to first load the image in the Image tab, then assign a forward model to interpret the image&rsquo;s device colorants as colorimetry. If the image embeds an ICC profile, that profile is taken as the default interpretation (you can override it). If the image is itself defined in the Lab colour space, that Lab data is used directly.</p>` },

  { id: 'calculate-tonality', heading: 'Calculate tonality', html:
`<p>Tonality is commonly calculated a couple of ways. Murray-Davies densitometry uses the inner product between RGBV filter functions and the spectral power distribution (SPD) of a measurement to derive density and hence tonality. ${uihint('tonevalue','Colour Tone Value')} (CTV) instead uses the measured colorimetry to determine tonality.</p>
<p>Both methods are supported in CharData, though Murray-Davies is only available when spectral measurement is present. Although some datasets carry measured density (D_VIS, D_RED, D_BLUE, D_GREEN), CharData strips this out and treats the spectral data as the source of truth.</p>` },
];

function thingsYouCanDo() {
  const items = THINGS.map(t =>
`  <details class="cd-thing" id="${t.id}">
    <summary>${t.heading}</summary>
    <div class="cd-thing__body">
${t.html}
    </div>
  </details>`).join('\n');
  return `<section class="cd-things" id="things-you-can-do">
  <h2 class="cd-things__title">Things you can do with CharData</h2>
  <p class="cd-things__intro">Expand any item below for detail. Underlined <span class="cd-uihint-demo">UI references</span> open a labelled diagram of that part of the app.</p>
${items}
</section>`;
}

// Hidden <template>s holding each diagram — cloned into the popup on demand.
function diagramTemplates() {
  return Object.entries(DIAGRAMS).map(([id, d]) =>
`<template class="cd-diag-tpl" data-diag="${id}"><figure class="cd-diag">${d.svg}<figcaption>${d.caption}</figcaption></figure></template>`
  ).join('\n');
}

// Shared popup CSS + JS + modal markup (used verbatim in the colourbill page too).
const CD_POPUP_CSS = `
.cd-things { border:1px solid #d0e0ee; border-radius:10px; background:#fbfdff; padding:18px 20px 22px; margin:28px 0; }
.cd-things__title { margin:0 0 4px; border:none; padding:0; }
.cd-things__intro { font-size:13px; color:#666; margin:0 0 14px; }
.cd-uihint-demo { color:#1a5a8a; border-bottom:1px dashed #1a5a8a; font-weight:bold; }
.cd-thing { border:1px solid #dde4ec; border-radius:8px; margin:8px 0; background:#fff; }
.cd-thing > summary { cursor:pointer; padding:11px 16px; font-weight:bold; color:#1a5a8a; font-size:14px; list-style:none; }
.cd-thing > summary::-webkit-details-marker { display:none; }
.cd-thing > summary::before { content:"\\25B6"; color:#9aa6b2; font-size:0.7em; margin-right:8px; }
.cd-thing[open] > summary::before { content:"\\25BC"; }
.cd-thing__body { padding:2px 16px 14px; }
.cd-thing__body p { font-size:14px; margin:0 0 9px; }
button.cd-uihint { font:inherit; font-weight:bold; color:#1a5a8a; background:none; border:none; border-bottom:1px dashed #1a5a8a; padding:0 1px; margin:0; cursor:pointer; }
button.cd-uihint:hover { background:#e8f0f8; }
button.cd-uihint::after { content:"\\2317"; font-size:0.85em; opacity:0.65; margin-left:2px; }
.cd-modal[hidden] { display:none; }
.cd-modal { position:fixed; inset:0; z-index:9999; display:flex; align-items:center; justify-content:center; padding:24px; }
.cd-modal__overlay { position:absolute; inset:0; background:rgba(10,15,25,0.72); }
.cd-modal__dialog { position:relative; background:#f0f2f5; border-radius:12px; padding:22px 22px 18px; max-width:840px; width:100%; max-height:90vh; overflow:auto; box-shadow:0 24px 70px rgba(0,0,0,0.5); }
.cd-modal__close { position:absolute; top:6px; right:12px; border:none; background:none; font-size:28px; line-height:1; cursor:pointer; color:#8a93a0; }
.cd-modal__close:hover { color:#333; }
.cd-diag { margin:0; }
.cd-diag figcaption { margin-top:12px; font-size:13px; line-height:1.5; color:#555; font-family:Arial,sans-serif; }
@media (prefers-color-scheme: dark) {
  .cd-things { background:#1d2026; border-color:#333a44; }
  .cd-things__intro { color:#9aa0a8; }
  .cd-thing { background:#22262e; border-color:#333a44; }
  .cd-thing > summary { color:#7ab8e8; }
  .cd-modal__dialog { background:#1a1c1f; }
  .cd-modal__close { color:#9aa0a8; }
  .cd-diag figcaption { color:#9aa0a8; }
  .cd-modal__close:hover { color:#fff; }
}`;

const CD_POPUP_JS = `<script>
(function () {
  var modal, body;
  function ensure() {
    if (modal) return;
    modal = document.createElement('div');
    modal.className = 'cd-modal'; modal.hidden = true;
    modal.innerHTML = '<div class="cd-modal__overlay"></div><div class="cd-modal__dialog" role="dialog" aria-modal="true"><button class="cd-modal__close" aria-label="Close">\\u00D7</button><div class="cd-modal__body"></div></div>';
    document.body.appendChild(modal);
    body = modal.querySelector('.cd-modal__body');
    modal.querySelector('.cd-modal__overlay').addEventListener('click', close);
    modal.querySelector('.cd-modal__close').addEventListener('click', close);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
  }
  function open(id) {
    ensure();
    var tpl = document.querySelector('template.cd-diag-tpl[data-diag="' + id + '"]');
    if (!tpl) return;
    body.innerHTML = '';
    body.appendChild(tpl.content.cloneNode(true));
    modal.hidden = false; document.body.style.overflow = 'hidden';
    modal.querySelector('.cd-modal__close').focus();
  }
  function close() { if (modal) { modal.hidden = true; document.body.style.overflow = ''; } }
  document.addEventListener('click', function (e) {
    var btn = e.target.closest && e.target.closest('.cd-uihint');
    if (btn) { e.preventDefault(); open(btn.getAttribute('data-diag')); }
  });
}());
</script>`;

// ── Optional: dump diagrams + section HTML for embedding into the WP page ─────
if (process.argv.includes('--dump')) {
  const dir = process.argv[process.argv.indexOf('--dump') + 1] || '/tmp/cd-diagrams';
  fs.mkdirSync(dir, { recursive: true });
  for (const [id, d] of Object.entries(DIAGRAMS)) {
    fs.writeFileSync(path.join(dir, `diag-${id}.svg`), d.svg, 'utf8');
  }
  fs.writeFileSync(path.join(dir, 'templates.html'), diagramTemplates(), 'utf8');
  fs.writeFileSync(path.join(dir, 'section.html'), thingsYouCanDo(), 'utf8');
  fs.writeFileSync(path.join(dir, 'popup.css'), CD_POPUP_CSS, 'utf8');
  fs.writeFileSync(path.join(dir, 'popup.js'), CD_POPUP_JS, 'utf8');
  console.log('Dumped diagrams + section to ' + dir);
  process.exit(0);
}

// ── Markdown → HTML (subset) ─────────────────────────────────────────────────
function mdToHtml(md) {
  const lines = md.split('\n');
  const out = [];
  let inTable = false, inList = false, inPara = false;

  const flush = () => {
    if (inTable) { out.push('</tbody></table>'); inTable = false; }
    if (inList)  { out.push('</ul>'); inList = false; }
    if (inPara)  { out.push('</p>'); inPara = false; }
  };

  const inline = s => s
    // Protect escaped *_ from bold/italic regexes by swapping to a placeholder first
    .replace(/\\\*/g, '').replace(/\\_/g, '')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
    .replace(//g, '*').replace(//g, '_');

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^#{4}\s/.test(l))      { flush(); out.push(`<h4>${inline(l.replace(/^#{4}\s/,''))}</h4>`); }
    else if (/^#{3}\s/.test(l)) { flush(); out.push(`<h3 id="${slug(l)}">${inline(l.replace(/^#{3}\s/,''))}</h3>`); }
    else if (/^#{2}\s/.test(l)) { flush(); out.push(`<h2 id="${slug(l)}">${inline(l.replace(/^#{2}\s/,''))}</h2>`); }
    else if (/^#{1}\s/.test(l)) { flush(); out.push(`<h1>${inline(l.replace(/^#{1}\s/,''))}</h1>`); }
    else if (/^---$/.test(l))   { flush(); out.push('<hr>'); }
    else if (/^\|/.test(l)) {
      if (!inTable) {
        flush();
        out.push('<table><thead>');
        const hcells = l.split('|').filter((_,i,a)=>i>0&&i<a.length-1).map(c=>`<th>${inline(c.trim())}</th>`);
        out.push('<tr>' + hcells.join('') + '</tr></thead><tbody>');
        i++; // skip separator row
        inTable = true;
      } else {
        const cells = l.split('|').filter((_,i,a)=>i>0&&i<a.length-1).map(c=>`<td>${inline(c.trim())}</td>`);
        out.push('<tr>' + cells.join('') + '</tr>');
      }
    }
    else if (/^- /.test(l)) {
      if (!inList) { flush(); out.push('<ul>'); inList = true; }
      out.push(`<li>${inline(l.replace(/^- /,''))}</li>`);
    }
    else if (/^\s*<\/?\w/.test(l)) {
      // Raw HTML block (e.g. <div class="note">…</div>) — pass through verbatim
      flush();
      out.push(l);
    }
    else if (l.trim() === '') {
      flush();
    }
    else {
      if (!inPara) { out.push('<p>'); inPara = true; }
      else out.push(' ');
      out.push(inline(l));
    }
  }
  flush();
  // Collapse single-line paragraphs and list items onto one line for tidier output
  return out.join('\n')
    .replace(/<p>\n([^\n]*)\n<\/p>/g, '<p>$1</p>');
}

function slug(h) {
  return h.replace(/^#+\s*/,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
}

// ── Assemble help.html ────────────────────────────────────────────────────────
const manual = fs.readFileSync(path.join(__dirname, '../MANUAL.md'), 'utf8');

// Strip the H1 title and the legacy one-line subtitle (both replaced by hardcoded HTML below)
const stripped = manual
  .replace(/^#[^#].*\n+/, '')        // remove H1
  .replace(/^CharData is.*\n+/, ''); // remove legacy single-line subtitle

// Split into intro (About — between subtitle and first ---) and body (after second ---)
const firstDash = stripped.indexOf('\n---\n');
const introMd = firstDash === -1 ? '' : stripped.slice(0, firstDash).trim();
const bodyMd = firstDash === -1
  ? stripped
  : stripped.slice(firstDash).replace(/^\n---\n[\s\S]*?\n---\n+/, '');

// Split on section anchors to inject diagrams
function insertAfter(html, marker, injection) {
  const idx = html.indexOf(marker);
  if (idx === -1) return html;
  const end = html.indexOf('\n', idx) + 1;
  return html.slice(0, end) + injection + html.slice(end);
}

const intro = mdToHtml(introMd);
let body = mdToHtml(bodyMd);
body = insertAfter(body, 'id="1-file-format"',       '\n' + diag_layout());
body = insertAfter(body, 'id="3-settings-panel"',   '\n' + diag_settings());
body = insertAfter(body, 'id="4-explore-mode"',     '\n' + diag_explore());
body = insertAfter(body, 'id="4-3-3d-gamut-plot"',  '\n' + diag_gamut());
body = insertAfter(body, 'id="4-5-estimate-section"','\n' + diag_estimate());
body = insertAfter(body, 'id="5-compare-mode"',     '\n' + diag_compare());

const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>CharData Help</title>
  <script async src="https://www.googletagmanager.com/gtag/js?id=G-WJN2XTVMG8"></script>
  <script>
    window.dataLayer = window.dataLayer || [];
    function gtag(){dataLayer.push(arguments);}
    gtag('js', new Date());
    gtag('config', 'G-WJN2XTVMG8');
  </script>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, sans-serif; background: #f0f2f5; color: #333; line-height: 1.6; }
    .page { max-width: 860px; margin: 0 auto; padding: 40px 24px 80px; }
    h1 { font-size: 24px; color: #1a5a8a; margin-bottom: 6px; }
    .subtitle { color: #888; font-size: 14px; margin-bottom: 32px; }
    h2 { font-size: 17px; color: #1a5a8a; margin: 36px 0 10px; padding-bottom: 5px; border-bottom: 2px solid #d0e6f5; }
    h3 { font-size: 14px; font-weight: bold; color: #333; margin: 20px 0 6px; }
    h4 { font-size: 13px; font-weight: bold; color: #555; margin: 14px 0 4px; }
    p { font-size: 14px; margin-bottom: 10px; }
    ul, ol { font-size: 14px; margin: 8px 0 10px 24px; }
    li { margin-bottom: 4px; }
    code { font-family: monospace; font-size: 12px; background: #e8edf2; padding: 1px 5px; border-radius: 3px; }
    table { border-collapse: collapse; width: 100%; margin: 10px 0 14px; font-size: 13px; }
    th { background: #e8edf2; text-align: left; padding: 6px 10px; border: 1px solid #ccd6e0; font-weight: bold; color: #444; }
    td { padding: 5px 10px; border: 1px solid #dde4ec; vertical-align: top; }
    tr:nth-child(even) td { background: #f7f9fb; }
    .note { background: #fff8e6; border-left: 3px solid #f0b429; padding: 8px 12px; font-size: 13px; margin: 10px 0; border-radius: 0 4px 4px 0; }
    nav { background: #fff; border: 1px solid #dde; border-radius: 8px; padding: 16px 20px; margin-bottom: 32px; font-size: 13px; }
    nav ol { margin-left: 18px; }
    nav li { margin-bottom: 3px; }
    nav a { color: #1a5a8a; text-decoration: none; }
    nav a:hover { text-decoration: underline; }
    hr { border: none; border-top: 1px solid #dde; margin: 32px 0; }
    strong { color: #222; }
    section { margin-bottom: 8px; }
    @media (prefers-color-scheme: dark) {
      body { background: #1a1c1f; color: #d0d4da; }
      h1 { color: #7ab8e8; }
      h2 { color: #7ab8e8; border-bottom-color: #2a4a60; }
      h3 { color: #c8cdd4; }
      h4 { color: #9aa0a8; }
      code { background: #2a2e35; color: #a8d4f0; }
      table { color: #c8cdd4; }
      th { background: #252930; border-color: #3a4048; color: #9aa0a8; }
      td { border-color: #2e3440; }
      tr:nth-child(even) td { background: #1e2128; }
      .note { background: #2a2410; border-left-color: #c08820; color: #c8b880; }
      nav { background: #22262e; border-color: #333a44; }
      nav a { color: #7ab8e8; }
      hr { border-top-color: #2e3440; }
      strong { color: #e0e4ea; }
      .subtitle { color: #666e7a; }
    }
${CD_POPUP_CSS}
  </style>
</head>
<body>
<div class="page">

  <h1>CharData Help</h1>
  <p class="subtitle">Browser-based colour characterisation data explorer and comparator</p>

${intro}

${thingsYouCanDo()}

  <nav>
    <strong>Contents</strong>
    <ol>
      <li><a href="#1-file-format">File format</a></li>
      <li><a href="#2-loading-datasets">Loading datasets</a></li>
      <li><a href="#3-settings-panel">Settings panel</a></li>
      <li><a href="#4-explore-mode">Explore mode</a>
        <ol>
          <li><a href="#4-1-data-table">Data table</a></li>
          <li><a href="#4-2-g7-report">G7 report</a></li>
          <li><a href="#4-3-3d-gamut-plot">3D Gamut plot</a></li>
          <li><a href="#4-4-2d-gamut-slice">2D Gamut slice</a></li>
          <li><a href="#4-5-estimate-section">Estimate section</a></li>
          <li><a href="#4-6-tone-value">Tone Value</a></li>
        </ol>
      </li>
      <li><a href="#5-compare-mode">Compare mode</a>
        <ol>
          <li><a href="#5-1-compare-table">Compare table</a></li>
          <li><a href="#5-2-3d-gamut-plot-compare">3D Gamut plot (Compare)</a></li>
          <li><a href="#5-3-tone-value-compare">Tone Value (Compare)</a></li>
          <li><a href="#5-4-image-gamut">Image gamut</a></li>
        </ol>
      </li>
      <li><a href="#6-mobile">Mobile</a></li>
    </ol>
  </nav>

${body}

</div>
${diagramTemplates()}
${CD_POPUP_JS}
</body>
</html>`;

fs.writeFileSync(OUT, html, 'utf8');
console.log('Written: ' + OUT);
