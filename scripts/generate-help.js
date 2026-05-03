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
function diag_layout() {
  // Pane widths: left=160, center=430, right=140, total=750, height=320
  const W=760, H=330;
  const LP=10, LW=155;          // left pane
  const CP=172, CW=430;         // center
  const RP=610, RW=140;         // right blade
  const TOP=10, BOT=H-10;

  let b = '';
  b += R(0,0,W,H,'bg',0);

  // ── Left pane ──
  b += R(LP,TOP,LW,BOT-TOP,'pnl');
  b += R(LP,TOP,LW,28,'hd');
  b += T(LP+LW/2, TOP+18, 'File Select', 'tT');

  // Dataset A panel
  b += R(LP+8,TOP+36,LW-16,88,'pnl');
  b += R(LP+8,TOP+36,LW-16,20,'hd');
  b += T(LP+8+((LW-16)/2), TOP+50, 'Dataset A', 'tB');
  b += T(LP+8+((LW-16)/2), TOP+68, 'filename.csv', 't3');
  b += T(LP+8+((LW-16)/2), TOP+82, '1200 rows  CMYK+LAB', 't3');
  b += T(LP+8+((LW-16)/2), TOP+96, '✓ Valid', 't2');
  b += R(LP+14,TOP+106,LW-28,14,'btn',3);
  b += T(LP+8+((LW-16)/2), TOP+117, 'Display File', 't3');

  // Dataset B panel
  b += R(LP+8,TOP+132,LW-16,88,'pnl');
  b += R(LP+8,TOP+132,LW-16,20,'hd');
  b += T(LP+8+((LW-16)/2), TOP+146, 'Dataset B', 'tB');
  b += T(LP+8+((LW-16)/2), TOP+164, '(drop file here)', 't3');

  // File select hint
  b += T(LP+LW/2, TOP+240, 'Drag & drop files', 't3');
  b += T(LP+LW/2, TOP+254, 'or use file picker', 't3');

  // Ko-fi / Top buttons (top right of left pane area)
  b += R(LP+8,TOP+272,LW-16,18,'btn',3);
  b += T(LP+8+((LW-16)/2), TOP+284, '☕  Ko-fi  ↑ Top', 't3');

  // ── Center pane ──
  b += R(CP,TOP,CW,BOT-TOP,'pnl');

  // Mode buttons
  b += R(CP+10,TOP+10,100,24,'act',4);
  b += T(CP+60, TOP+26, 'Explore', 'tW tB');
  b += R(CP+118,TOP+10,100,24,'btn',4);
  b += T(CP+168, TOP+26, 'Compare', 't2');

  // Content area label
  b += R(CP+10,TOP+44,CW-20,BOT-TOP-54,'lnbd',4);
  b += T(CP+CW/2, TOP+120, 'Mode Content Area', 'tT');
  b += T(CP+CW/2, TOP+140, '(Data Table · G7 Report · 3D Gamut · 2D Slice · Estimate)', 't3');

  // ── Right blade ──
  b += R(RP,TOP,RW,BOT-TOP,'pnl');
  b += R(RP,TOP,38,34,'btn',0);
  b += T(RP+19, TOP+21, '⚙', 't2');
  b += R(RP,TOP+42,38,34,'btn',0);
  b += T(RP+19, TOP+62, '?', 't2');
  b += L(RP+38,TOP,RP+38,BOT);

  b += T(RP+RW/2+10, TOP+20, 'Settings', 'tT');
  b += T(RP+RW/2+10, TOP+50, 'ΔE Method', 't2');
  b += T(RP+RW/2+10, TOP+68, 'Filter Duplicates', 't2');
  b += T(RP+RW/2+10, TOP+86, 'Spectral → LAB', 't2');
  b += T(RP+RW/2+10, TOP+104, 'Background', 't2');

  // Callout labels
  b += callout(LP+LW/2, TOP+50, LP+LW/2-55, TOP+50-40, 'Dataset A panel', 't3');
  b += callout(CP+60, TOP+26, CP+60, TOP+26-30, 'Mode selector', 't3');
  b += callout(RP+19, TOP+21, RP-40, TOP+21, '⚙ Settings', 't3');
  b += callout(RP+19, TOP+62, RP-40, TOP+62, '? Help', 't3');

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
  const W=380, H=360;
  let b = '';
  b += R(0,0,W,H,'bg',0);

  // Blade panel
  b += R(10,10,W-20,H-20,'pnl');
  b += R(10,10,38,34,'btn',0); b += T(29,31,'⚙','t2');
  b += R(10,46,38,34,'btn',0); b += T(29,67,'?','t2');
  b += L(48,10,48,H-10);

  const SX=58, SW=W-68;

  b += T(SX+SW/2, 26, 'Settings', 'tT');
  b += L(SX,36,SX+SW,36);

  const groups = [
    { label:'ΔE Method', opts:['ΔEab','ΔE94','ΔE00 ✓'] },
    { label:'Filter Duplicates', opts:['Yes ✓','No'] },
    { label:'Filter Method', opts:['Median ✓','Mean'] },
  ];

  let gy = 46;
  for (const g of groups) {
    b += T(SX+4, gy+14, g.label, 't2 tB', 'start');
    gy += 18;
    for (const o of g.opts) {
      const active = o.includes('✓');
      b += R(SX+4, gy, SW-8, 18, active ? 'act' : 'btn', 3);
      b += T(SX+4+8, gy+13, o.replace(' ✓',''), active ? 'tW' : 't2', 'start');
      gy += 22;
    }
    b += L(SX,gy+4,SX+SW,gy+4);
    gy += 10;
  }

  b += T(SX+4, gy+14, 'Spectral → LAB', 't2 tB', 'start'); gy += 20;
  [['Illuminant','D50 ✓','D65'],['Observer','2° ✓','10°'],['M-Condition','M0 ✓','M1','M2']].forEach(row => {
    b += T(SX+4, gy+12, row[0], 't3', 'start'); gy += 16;
    row.slice(1).forEach(o => {
      const active = o.includes('✓');
      b += R(SX+4, gy, 54, 16, active ? 'act' : 'btn', 3);
      b += T(SX+4+27, gy+12, o.replace(' ✓',''), active ? 'tW' : 't3');
      SX; gy += 0;  // inline
    });
    gy += 20;
  });

  b += L(SX,gy,SX+SW,gy); gy += 8;
  b += T(SX+4, gy+14, 'Background', 't2 tB', 'start'); gy += 18;
  ['System ✓','Light','Dark'].forEach((o,i) => {
    const active = o.includes('✓');
    b += R(SX+4+i*70, gy, 66, 18, active ? 'act' : 'btn', 3);
    b += T(SX+4+i*70+33, gy+13, o.replace(' ✓',''), active ? 'tW' : 't3');
  });

  return svg(W, H, b);
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
  </style>
</head>
<body>
<div class="page">

  <h1>CharData Help</h1>
  <p class="subtitle">Browser-based colour characterisation data explorer and comparator</p>

${intro}

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
        </ol>
      </li>
      <li><a href="#6-mobile">Mobile</a></li>
    </ol>
  </nav>

${body}

</div>
</body>
</html>`;

fs.writeFileSync(OUT, html, 'utf8');
console.log('Written: ' + OUT);
