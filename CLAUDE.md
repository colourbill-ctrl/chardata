# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running

```
npm install
node server.js
```

Serves the app at `http://localhost:3001`. There is no JS build step at runtime — `server.js` is a static file server (Express + helmet) that only sets the `application/wasm` MIME type.

Three things *do* get generated, but only at commit time via the pre-commit hook:
- `public/wasm/chardata-gamut.{mjs,wasm}` from `gamut-wasm/gamut-wrapper.cpp` (gamut math + ICC eval via lcms2)
- `public/wasm/icc-viewer.{mjs,wasm}` from `icc-viewer-wasm/wrapper.cpp` (ICC profile header + tag display via IccProfLib)
- `public/help.html` from `MANUAL.md`

## Architecture

Everything of substance is in `public/index.html` — a single ~7000-line SPA. The Express server only serves it as a static file.

### WASM module

Gamut math (polynomial model fitting, 3D mesh generation, 2D slice, ICC profile evaluation) lives in C++ compiled to WebAssembly:

- **Source**: `gamut-wasm/gamut-wrapper.cpp` — embind-exported functions
- **Build**: from WSL: `scripts/build-wasm.sh` (requires Emscripten + nlohmann-json3-dev; lcms2 is a vendored submodule under `gamut-wasm/third-party/lcms2`)
- **Artifacts**: `public/wasm/chardata-gamut.mjs` + `public/wasm/chardata-gamut.wasm` (committed — Lightsail has no build toolchain)
- **JS wrapper**: `public/gamut.js` — loads WASM via blob-URL dynamic import, exposes `window.Gamut`

### WASM API (`window.Gamut`)

| Function | Purpose |
|---|---|
| `Gamut.preload()` | Eagerly load + instantiate the WASM module (returns Promise) |
| `Gamut.fitModel(data)` | Fit weighted polynomial model to characterisation data; returns model JSON |
| `Gamut.buildGamutMesh(model, steps)` | Build 3D mesh via boundary-cloud triangulation; returns `{vertices, triangles}` |
| `Gamut.buildSlice(model, axis, value, steps)` | 2D gamut slice at fixed Lab axis; axis: 0=L*, 1=a*, 2=b*; returns `{polygon, raw}` |
| `Gamut.loadIccProfile(bytes)` | Validate + load ICC profile bytes; returns handle JSON or `{error}` |
| `Gamut.evalIccA2BSync(handleId, vals, intent)` / `evalIccBatchSync(...)` | **Sync** — single/batch A2B eval; require `preload()` to have resolved first |
| `Gamut.buildIccGamutMesh(handleId, intent, steps)` | 3D shell from ICC profile sampled at boundary cube |
| `Gamut.buildIccSlice(handleId, intent, axis, value, steps)` | 2D slice from ICC profile |
| `Gamut.BOUNDARY_STEPS`, `Gamut.SLICE_FACE_STEPS` | Default sampling steps per colorant count (indexed 0..15) |

**Supported ICC color spaces**: CMYK, CMY, RGB, Gray, and NCLR 2..15 channels (`cmsSig{N}colorData`). NCLR profiles get real ink names from `cmsSigColorantTableTag` when present; otherwise the wrapper synthesises generic `Ink1..InkN` names.

lcms2 expects 0..100 inputs for ink colour spaces (CMYK, CMY, NCLR 5..15ch — anything `IsInkSpace` returns true for) and 0..1 for non-ink (RGB/Gray). The wrapper tracks this via `IccProfile::inputMax`; do not reintroduce a blanket `/100.0` scale.

**Sampling caveat**: `BOUNDARY_STEPS`/`SLICE_FACE_STEPS` shrink fast with channel count because mesh vertices grow as `C(N,2) * 2^(N-2) * (steps+1)^2`. For N≥12, even the floor of `steps=2` is best-effort and may OOM in WASM. Don't bump those defaults without measuring.

### ICC viewer WASM (lazy)

A second, independent module wraps **IccProfLib** (from iccDEV at `/home/colour/code/iccdev`) for header + tag-directory display. It is **only loaded when the user clicks "Display File" on an ICC slot** — `chardata-gamut.wasm` keeps using lcms2 for transforms.

- **Source**: `icc-viewer-wasm/wrapper.cpp` — lifted from `~/code/profiletool/validator-wasm/wrapper.cpp` and kept in sync; same JSON shape so the profiletool layout serves as a template
- **Build**: `scripts/build-icc-viewer-wasm.sh` — separate from `build-wasm.sh`; compiles IccProfLib sources directly via Emscripten (bypasses iccDEV's top-level CMake so libxml2/tiff/png/jpeg `find_package` calls don't fire)
- **Artifacts**: `public/wasm/icc-viewer.{mjs,wasm}` (~730 KB WASM + ~40 KB glue, both committed)
- **JS wrapper**: `public/icc-viewer.js` — exposes `window.IccViewer.{validateProfile, describeTag}`; blob-URL dynamic import matches the `gamut.js` pattern

#### JSON shape from `validateProfile(bytes)`
```jsonc
{ libraryVersion, profileId, sizeBytes, sizeBytesHex,
  header: { Attributes, Cmm, "Creation Date", ..., Version, ... },
  tags: [ { name, id, type, isArrayType, description, offset, size, pad } ],
  validation: { level, status, messages[] } }
```
`description` is `CIccTag::Describe(verbosity=75)` so CLUT cells and curve points stay out of the bulk pass. The tag detail UI calls `describeTag(bytes, tagSig)` on row expand to fetch the verbosity-100 dump for one tag.

#### UI

`showFile()` in `index.html` branches on `_rawFileData[slot].isIcc` and calls `openIccViewer(slot)` for ICC files (versus the existing text overlay for CSV/CGATS). The viewer is a modal overlay (`#icc-viewer-overlay`) mirroring the existing `#file-viewer-overlay` styling — Arial / blue accent, no profiletool crimson. Tabs: **Header** (2-column key/value table) and **Tags** (7-column grid: `# / Name / ID / Type / Offset / Size / Pad`; click a row to expand inline). At viewports ≤720 px the modal goes full-screen and the tag rows reflow into stacked cards — no horizontal scroll.

The viewer title row also carries a **Launch editor** button that hands the profile bytes off to profiletool in a new tab. `launchIccEditor()` opens `http://localhost:5173/?source=chardata` (dev) or `/profiletool/?source=chardata` (prod), waits for `{type:'icctools:ready'}` from `window.opener` via `postMessage`, and replies with `{type:'icctools:load', filename, bytes}`. (The literal `icctools:` prefix on these wire-protocol messages predates the profiletool rename and must change in lockstep with the profiletool app — see also the postMessage call sites in `public/index.html`.) The reply pins `targetOrigin` to the concrete profiletool origin (`http://localhost:5173` in dev, `location.origin` in prod) — never `'*'` — so profile bytes can only reach the intended target even if the popup is navigated cross-origin before the handshake completes. The incoming `ready` is also `ev.origin`-checked against that same target. One-way — chardata never accepts edits back; the user saves from profiletool directly. Same-origin in prod (profiletool is served at chardata.colourbill.com/profiletool/); cross-origin in dev but `postMessage` is unaffected.

For the dev-mode cross-origin popup to retain its `window.opener`, the helmet config in `server.js` sets `crossOriginOpenerPolicy: 'same-origin-allow-popups'` instead of helmet's default `same-origin`. See the inline comment in `server.js` — don't tighten this back without a same-origin alternative for dev.

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

### Known limitations

- **NCLR-vs-NCLR Compare** currently aligns colorants by the hardcoded CMYK index at `index.html:5581` (tracked: GitHub issue #2). Comparing two N>4 profiles will silently mis-align channels past the first four.

### i18n

Strings live in an `I18N` dictionary inside `index.html` with 11 supported languages plus EN fallback (`I18N[lang][key] ?? I18N.en[key] ?? key`). The canonical source is `translations/Eng-*.xlsx` — when adding strings, update both the dictionary and the spreadsheets so the next translation pass stays in sync. The `xlsx` npm package is the usual tool for batch-updating the spreadsheets from a script.

**Translation strings are trusted HTML.** `t(key)` returns dictionary values verbatim and callers like `el.innerHTML = t('foo')` rely on no escaping happening. Don't ever route user-derived text through the I18N dictionary or through `t()` — there's a doc comment near the `t()` definition flagging this for future maintainers.

Drift audit: `node scripts/check-translations.js` compares each xlsx column 0 against the EN values in the I18N dict and reports missing/extra rows. The `_BP`, `_BP2`, and `-BM` xlsx files are external-reviewer artifacts whose content has already been incorporated — ignore them when auditing.

### `innerHTML` hygiene

`index.html` interpolates a lot of values into `innerHTML` strings (table cells, legends, attribute values, inline handler arguments). The convention is: **anything user-derived — file names, CSV/CGATS column headers, ICC ink names, validation messages — must go through `escapeHtml()` before being interpolated**, even in attribute or `onclick`-handler-argument contexts. Numeric formatting (`fmtLab`, `fmtCH`, `toFixed`) is safe because it can only emit numbers or the `'—'` placeholder. The Estimate and Explore tables use index-keyed IDs and handler args (`onEstimateInput(idx, val)`) specifically so colorant names never reach an HTML attribute. Treat these as load-bearing patterns — `SECURITY-FOLLOWUPS.md` documents the specific XSS sinks that were closed via this convention.

### Server

`server.js` exposes two endpoints beyond the static middleware:
- `GET /favicon.ico` → 204 (so the browser stops asking).
- `GET /health` → 200 `text/plain` "ok". Used by UptimeRobot for outside-in monitoring; keep it cheap and dependency-free.

### Subscribe form (release notifications)

Footer link "✉ Subscribe" opens a modal that POSTs cross-origin to the WordPress plugin at `https://colourbill.com/wp-admin/admin-ajax.php?action=cb_subscribe`. There is **no chardata-side backend** for subscribers — the list, moderation UI, and release-send flow all live in the WP plugin. The CSP `connectSrc` includes `https://colourbill.com` to permit the POST. Submit handler is `submitSubscribe()` near the modal markup; the hidden `t0` input is stamped on modal open for the server's time-trap (rejects <1.5s submits). Full architecture: `~/colourbill_WP/wordpress/wp-content/plugins/colourbill-customizations/SUBSCRIBERS.md`.

### Help / MANUAL.md

`public/help.html` is **auto-generated** from `MANUAL.md` via `scripts/generate-help.js`. The pre-commit hook runs the generator when `MANUAL.md` (or the generator) is staged, and *aborts the commit* if `public/help.html` is hand-edited. Edit `MANUAL.md` instead.

### Pre-commit hook

`hooks/pre-commit` does three jobs:
1. If anything under `gamut-wasm/` is staged, rebuild `chardata-gamut.{mjs,wasm}` (via WSL when invoked from a Windows shell, directly when already inside WSL) and stage the artifacts.
2. If anything under `icc-viewer-wasm/` is staged, rebuild `icc-viewer.{mjs,wasm}` the same way and stage the artifacts.
3. If `MANUAL.md` or `scripts/generate-help.js` is staged, regenerate `public/help.html` and stage it.

After a fresh clone, activate it with:

```bash
git config core.hooksPath hooks
```

Either step failing aborts the commit.

### Deployment

Pushes to `main` auto-deploy to AWS Lightsail via `.github/workflows/deploy.yml`: SSH in, `git fetch && reset --hard`, `npm install --omit=dev`, restart pm2. No server-side build. Live at `chardata.colourbill.com`. Required GitHub Actions secrets: `SSH_HOST`, `SSH_USER`, `SSH_PRIVATE_KEY`.

### Deferred hardening

`SECURITY-FOLLOWUPS.md` (repo root) is the rolling security log. The 1.4.0 and 1.6.0 findings (CSP enable, `escapeHtml` sweep, max-file-size guard, Estimate/Explore XSS sinks, `npm ci` supply-chain pin) are all resolved and recorded there. Still deferred: tracking the vendored **lcms2** submodule for upstream CVE bumps, and adding a CSP `report-uri` / `report-to` endpoint so production violations are observable. Read the file before claiming a fresh security pass is complete.

### Dependencies

- **express**, **helmet** — npm packages, install with `npm install`.
