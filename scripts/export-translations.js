#!/usr/bin/env node
// Extracts the I18N object from index.html and writes one .xlsx per language pair.
'use strict';

const fs   = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const htmlPath  = path.join(__dirname, '..', 'public', 'index.html');
const outDir    = path.join(__dirname, '..', 'translations');

// --- Extract the I18N block from the HTML ---------------------------------
const html = fs.readFileSync(htmlPath, 'utf8');
const lines = html.split('\n');

const startIdx = lines.findIndex(l => l.trim().startsWith('const I18N = {'));
const endIdx   = lines.findIndex((l, i) => i > startIdx && l.trim() === '};');

if (startIdx === -1 || endIdx === -1) {
  console.error('Could not locate I18N block in index.html');
  process.exit(1);
}

const block = lines.slice(startIdx, endIdx + 1).join('\n');

// Eval in a small sandbox to get the object
const I18N = (new Function(`${block}; return I18N;`))();

// --- Language metadata ---------------------------------------------------
// Single-language pairs
const LANGS = [
  { code: 'fr', file: 'Eng-Fr', label: 'French' },
  { code: 'de', file: 'Eng-De', label: 'German' },
  { code: 'it', file: 'Eng-It', label: 'Italian' },
  { code: 'es', file: 'Eng-Es', label: 'Spanish' },
  { code: 'ja', file: 'Eng-Ja', label: 'Japanese' },
  { code: 'ko', file: 'Eng-Ko', label: 'Korean' },
];

// Combined pairs (3 columns each)
const COMBINED = [
  { file: 'Eng-Pt', codes: ['pt-PT', 'pt-BR'], labels: ['Portuguese (PT)', 'Portuguese (BR)'] },
  { file: 'Eng-Zh', codes: ['zh-CN', 'zh-TW'], labels: ['Chinese Simplified', 'Chinese Traditional'] },
];

const enKeys = Object.keys(I18N.en);

fs.mkdirSync(outDir, { recursive: true });

// Write single-language spreadsheets
for (const lang of LANGS) {
  const dict = I18N[lang.code];
  if (!dict) { console.warn(`No locale found for ${lang.code}, skipping`); continue; }

  const rows = [['English', lang.label]];
  for (const key of enKeys) {
    rows.push([I18N.en[key] ?? '', dict[key] ?? '']);
  }

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [{ wch: 55 }, { wch: 55 }];
  XLSX.utils.book_append_sheet(wb, ws, 'Translations');
  const outPath = path.join(outDir, `${lang.file}.xlsx`);
  XLSX.writeFile(wb, outPath);
  console.log(`Written: ${lang.file}.xlsx  (${rows.length - 1} rows)`);
}

// Write combined spreadsheets
for (const combo of COMBINED) {
  const dicts = combo.codes.map(c => I18N[c]);
  if (dicts.some(d => !d)) { console.warn(`Missing locale for ${combo.file}, skipping`); continue; }

  const rows = [['English', ...combo.labels]];
  for (const key of enKeys) {
    rows.push([I18N.en[key] ?? '', ...dicts.map(d => d[key] ?? '')]);
  }

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [{ wch: 55 }, { wch: 55 }, { wch: 55 }];
  XLSX.utils.book_append_sheet(wb, ws, 'Translations');
  const outPath = path.join(outDir, `${combo.file}.xlsx`);
  XLSX.writeFile(wb, outPath);
  console.log(`Written: ${combo.file}.xlsx  (${rows.length - 1} rows)`);
}

console.log(`\nAll done — files in: ${outDir}`);
