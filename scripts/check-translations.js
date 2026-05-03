// Audit translations/Eng-*.xlsx against the I18N dict in public/index.html.
// Reports drift; does not modify anything.

const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const REPO = path.resolve(__dirname, '..');
const INDEX_HTML = path.join(REPO, 'public', 'index.html');
const T_DIR = path.join(REPO, 'translations');

// Map xlsx filename → I18N dict key inside index.html.
const FILE_TO_LANG = {
  'Eng-De.xlsx':   'de',
  'Eng-Es.xlsx':   'es',
  'Eng-Fr.xlsx':   'fr',
  'Eng-It.xlsx':   'it',
  'Eng-Ja.xlsx':   'ja',
  'Eng-Ko.xlsx':   'ko',
  'Eng-Pt.xlsx':   'pt-PT',
  'Eng-Pt-BM.xlsx':'pt-BR',
  'Eng-Sv.xlsx':   'sv',
  'Eng-Zh.xlsx':   'zh-CN',
  'Eng-Zh_BP.xlsx':'zh-CN',     // older snapshot of same lang
  'Eng-Zh_BP2.xlsx':'zh-TW',    // older snapshot of zh-TW
};

// ── 1. Extract I18N dict from index.html ─────────────────────────────────────
const html = fs.readFileSync(INDEX_HTML, 'utf8');
// Pull out `const I18N = { ... };` — match braces by depth.
const i18nStart = html.indexOf('const I18N');
if (i18nStart < 0) { console.error('I18N dict not found'); process.exit(1); }
const braceStart = html.indexOf('{', i18nStart);
let depth = 0, end = -1;
for (let i = braceStart; i < html.length; i++) {
  if (html[i] === '{') depth++;
  else if (html[i] === '}') {
    depth--;
    if (depth === 0) { end = i + 1; break; }
  }
}
const i18nLiteral = html.slice(braceStart, end);
let I18N;
try {
  // The dict is a plain JS object literal — eval in a sandboxed Function.
  I18N = (new Function('return ' + i18nLiteral))();
} catch (e) {
  console.error('Could not parse I18N literal:', e.message);
  process.exit(1);
}
console.log('I18N languages:', Object.keys(I18N).join(', '));
console.log('EN key count :', Object.keys(I18N.en).length);
console.log('');

// ── 2. For each xlsx, read row by row and compare ────────────────────────────
function readSheet(p) {
  const wb = XLSX.readFile(p);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  return rows;
}

const summary = [];
for (const [file, lang] of Object.entries(FILE_TO_LANG)) {
  const p = path.join(T_DIR, file);
  if (!fs.existsSync(p)) { summary.push({ file, lang, status: 'MISSING' }); continue; }
  const rows = readSheet(p);
  if (!rows.length) { summary.push({ file, lang, status: 'EMPTY' }); continue; }

  // Header row gives us column positions.
  const header = rows[0].map(c => String(c || '').trim());
  const data = rows.slice(1).filter(r => r.some(c => String(c).trim() !== ''));

  // Heuristic: column 0 is the English string, column 1+ is the translation.
  // We don't have a stable "key" column — match by the EN string itself.
  const xlsxEnSet = new Set(data.map(r => String(r[0] || '').trim()).filter(Boolean));
  const i18nDict = I18N[lang] || {};
  const i18nEn = I18N.en;
  const enValues = new Set(Object.values(i18nEn).map(v => String(v).trim()));

  // Missing in xlsx: EN strings present in I18N but absent from xlsx column 0.
  const missingFromXlsx = [];
  for (const [k, v] of Object.entries(i18nEn)) {
    const s = String(v).trim();
    if (!xlsxEnSet.has(s)) missingFromXlsx.push({ key: k, en: s });
  }

  // Extra in xlsx: rows that no longer correspond to any I18N en value.
  const extraInXlsx = [];
  for (const r of data) {
    const en = String(r[0] || '').trim();
    if (!en) continue;
    if (!enValues.has(en)) extraInXlsx.push(en);
  }

  summary.push({
    file, lang,
    rowCount: data.length,
    i18nKeyCount: Object.keys(i18nDict).length,
    missing: missingFromXlsx,
    extra: extraInXlsx,
    header,
  });
}

// ── 3. Print report ──────────────────────────────────────────────────────────
for (const s of summary) {
  console.log(`── ${s.file} (lang=${s.lang}) ─────────────────`);
  if (s.status) { console.log('  STATUS:', s.status); continue; }
  console.log(`  xlsx rows : ${s.rowCount}`);
  console.log(`  I18N[${s.lang}] keys : ${s.i18nKeyCount}`);
  console.log(`  header    : ${JSON.stringify(s.header)}`);
  console.log(`  Missing from xlsx (in I18N.en, not in column 0): ${s.missing.length}`);
  if (s.missing.length && s.missing.length <= 20) {
    for (const m of s.missing) console.log(`    - [${m.key}] "${m.en.slice(0,80)}"`);
  } else if (s.missing.length) {
    for (const m of s.missing.slice(0, 10)) console.log(`    - [${m.key}] "${m.en.slice(0,80)}"`);
    console.log(`    ... and ${s.missing.length - 10} more`);
  }
  console.log(`  Extra in xlsx (column 0 strings not found in I18N.en): ${s.extra.length}`);
  if (s.extra.length && s.extra.length <= 10) {
    for (const e of s.extra) console.log(`    - "${e.slice(0,80)}"`);
  } else if (s.extra.length) {
    for (const e of s.extra.slice(0, 5)) console.log(`    - "${e.slice(0,80)}"`);
    console.log(`    ... and ${s.extra.length - 5} more`);
  }
  console.log('');
}
