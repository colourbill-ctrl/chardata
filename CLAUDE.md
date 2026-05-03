# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Running

```
npm install
node server.js
```

Serves the app at `http://localhost:3001`. There is no JS build step at runtime — `server.js` is a static file server (Express + helmet) that only sets the `application/wasm` MIME type.

Two things *do* get generated, but only at commit time via the pre-commit hook:
- `public/wasm/compwas-gamut.{mjs,wasm}` from `gamut-wasm/gamut-wrapper.cpp`
- `public/help.html` from `MANUAL.md`

## Architecture

Everything of substance is in `public/index.html` — a single ~7000-line SPA. The Express server only serves it as a static file.

### WASM module

Gamut math (polynomial model fitting, 3D mesh generation, 2D slice, ICC profile evaluation) lives in C++ compiled to WebAssembly:

- **Source**: `gamut-wasm/gamut-wrapper.cpp` — embind-exported functions
- **Build**: from WSL: `scripts/build-wasm.sh` (requires Emscripten + nlohmann-json3-dev; lcms2 is a vendored submodule under `gamut-wasm/third-party/lcms2`)
- **Artifacts**: `public/wasm/compwas-gamut.mjs` + `public/wasm/compwas-gamut.wasm` (committed — Lightsail has no build toolchain)
- **JS wrapper**: `public/gamut.js` — loads WASM via blob-URL dynamic import, exposes `window.Gamut`

### WASM API (`window.Gamut`)

| Function | Purpose |
|---|---|
| `Gamut.preload()` | Eagerly load + instantiate the WASM module (returns Promise) |
| `Gamut.fitModel(data)` | Fit weighted polynomial model to characterisation data; returns model JSON |
| `Gamut.buildGamutMesh(model, steps)` | Build 3D mesh via boundary-cloud triangulation; returns `{vertices, triangles}` |
| `Gamut.buildSlice(model, axis, value, steps)` | 2D gamut slice at fixed Lab axis; axis: 0=L*, 1=a*, 2=b*; returns `{polygon, raw}` |
| `Gamut.loadIccProfile(bytes)` | Validate + load ICC profile bytes; returns handle JSON or `{error}` |
| `Gamut.evalIccA2B(handleId, intent, vals)` / `evalIccBatch(...)` / `evalIccBatchSync(...)` | Run colorant values through the profile's A2B table at the given rendering intent |
| `Gamut.buildIccGamutMesh(handleId, intent, steps)` | 3D shell from ICC profile sampled at boundary cube |
| `Gamut.buildIccSlice(handleId, intent, axis, value, steps)` | 2D slice from ICC profile |
| `Gamut.BOUNDARY_STEPS`, `Gamut.SLICE_FACE_STEPS` | Default sampling steps per colorant count |

lcms2 expects 0..100 inputs for ink colour spaces (CMYK/CMY) and 0..1 for non-ink (RGB/Gray). The wrapper tracks this via `IccProfile::inputMax`; do not reintroduce a blanket `/100.0` scale.

### Data flow

A "slot" is `'a'` or `'b'`. Each slot can hold either characterisation data (CSV/CGATS) or an ICC profile, and there are two parallel state objects:

- `_gamutState[slot]` — for characterisation data: `cachedModel` (from `Gamut.fitModel`) + `cachedMesh` (from `Gamut.buildGamutMesh`)
- `_iccState[slot]` — for ICC profiles: `handleId`, `renderingIntent` (default 3 = Absolute Colorimetric), profile metadata

File detection happens up front: `_sniffIcc(buffer)` checks bytes 36..39 for the `acsp` magic. ICC files are routed through `loadIccFromBuffer`; CSV/CGATS through the existing `parseCSV` + `validateCSV` path. The Rendering Intent dropdown is only visible when the slot holds an ICC profile, and changing it triggers a re-render of every dependent view (3D shell, 2D slice, Compare table, Tone Value chart, Estimate).

3D plot defaults differ by data type: characterisation data → shell off, points on; ICC → shell on, points off.

### Key functions in `index.html`

| Function | Purpose |
|---|---|
| `parseCSV(text)` | Splits text into `{ headers, rows[] }` |
| `validateCSV(headers)` | Checks for required columns, returns `{ ok, missing[] }` |
| `addFileToList(file, slot)` | Peeks at file header, classifies as ICC or data, then routes |
| `loadFile(slot, file)` / `loadIccFromBuffer(slot, buf, name)` | Per-type slot loaders |
| `buildGamutCache(slot)` | Async: fits WASM model + builds mesh, populates `_gamutState[slot]` |
| `regenerateGamutShell(slot)` | Async: rebuild mesh from cached model and re-render |
| `setRenderingIntent(slot, intent)` | Async: re-runs every view dependent on the ICC slot |
| `renderPlot()` | Render/update the Plotly 3D plot |
| `renderSlicePlot()` | Async: render/update the 2D gamut slice plot |
| `runCompare()` / `runCompareWithIcc()` | Build `_cmpData`; both paths feed the same `renderCmpTable` |
| `evalPolynomialModel(model, vals)` | Evaluate WASM model coefficients in JS (Estimate section, char data only) |

### CSV format

Required columns: `CYAN`, `MAGENTA`, `YELLOW`, `BLACK`, `LAB_L`, `LAB_A`, `LAB_B`.

### i18n

Strings live in an `I18N` dictionary inside `index.html` with 11 supported languages plus EN fallback (`I18N[lang][key] ?? I18N.en[key] ?? key`). The canonical source is `translations/Eng-*.xlsx` — when adding strings, update both the dictionary and the spreadsheets so the next translation pass stays in sync. The `xlsx` npm package is the usual tool for batch-updating the spreadsheets from a script.

### Help / MANUAL.md

`public/help.html` is **auto-generated** from `MANUAL.md` via `scripts/generate-help.js`. The pre-commit hook runs the generator when `MANUAL.md` (or the generator) is staged, and *aborts the commit* if `public/help.html` is hand-edited. Edit `MANUAL.md` instead.

### Pre-commit hook

`hooks/pre-commit` does two jobs:
1. If anything under `gamut-wasm/` is staged, rebuild the WASM module (via WSL when invoked from a Windows shell, directly when already inside WSL) and stage the artifacts.
2. If `MANUAL.md` or `scripts/generate-help.js` is staged, regenerate `public/help.html` and stage it.

After a fresh clone, activate it with:

```bash
git config core.hooksPath hooks
```

Either step failing aborts the commit.

### Deployment

Pushes to `main` auto-deploy to AWS Lightsail via `.github/workflows/deploy.yml`: SSH in, `git fetch && reset --hard`, `npm install --omit=dev`, restart pm2. No server-side build. Live at `chardata.colourbill.com`. Required GitHub Actions secrets: `SSH_HOST`, `SSH_USER`, `SSH_PRIVATE_KEY`.

### Deferred hardening

`SECURITY-FOLLOWUPS.md` (repo root) tracks deferred items from the 1.4.0 security review — a remaining `escapeHtml` sweep at known line numbers, the still-disabled CSP in `server.js`, and a missing max-file-size guard. Read it before claiming a security pass is complete.

### Dependencies

- **express**, **helmet** — npm packages, install with `npm install`.
