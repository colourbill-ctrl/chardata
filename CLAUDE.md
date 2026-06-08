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

**Supported ICC profile classes**: Output (`prtr`), Input (`scnr`), Display (`mntr`), and ColorSpace (`spac`) — all expose a device→PCS A2B map, so they share the same transform path. Abstract (`abst`, PCS→PCS), DeviceLink (`link`, device→device), and NamedColor (`nmcl`) stay rejected by the class guard in `loadIccProfile` because none of them map device→Lab. The guard is deliberately permissive: a `spac` (or any) profile that lacks the A2B tags a given intent needs is caught downstream by the transform creation, not pre-emptively.

lcms2 expects 0..100 inputs for ink colour spaces (CMYK, CMY, NCLR 5..15ch — anything `IsInkSpace` returns true for) and 0..1 for non-ink (RGB/Gray). The wrapper tracks this via `IccProfile::inputMax`; do not reintroduce a blanket `/100.0` scale.

**Sampling caveat**: `BOUNDARY_STEPS`/`SLICE_FACE_STEPS` shrink fast with channel count because mesh vertices grow as `C(N,2) * 2^(N-2) * (steps+1)^2`. For N≥12, even the floor of `steps=2` is best-effort and may OOM in WASM. Don't bump those defaults without measuring.

### ICC viewer WASM (lazy)

A second, independent module wraps **IccProfLib** (from iccDEV at `/home/colour/code/iccdev`) for header + tag-directory display **and per-tag visualizations**. It is **only loaded when the user clicks "Display File" on an ICC slot** — `chardata-gamut.wasm` keeps using lcms2 for transforms.

- **Source**: `icc-viewer-wasm/wrapper.cpp` (header/tags/validation, lifted from `~/code/profiletool/validator-wasm/wrapper.cpp` and kept in sync) **plus** `icc-viewer-wasm/plot-wrapper.cpp` (the data-first visualization binding, vendored from profiletool's `validator-wasm/plot-wrapper.cpp`). Both compile into the **one** `icc-viewer` module, so `window.IccViewer` exposes the dump + the viz functions together.
- **Viz engine**: the **shared** `IccVizModel` engine at `~/code/profiletool/iccviz/` (`IccVizModel.cpp` + `IccVizMath.hpp` + `spectralLocus.hpp`) — referenced in place via CMake's `ICCVIZ_ROOT` (overridable env var, default `/home/colour/code/profiletool/iccviz`), **not forked**. chardata and profiletool share one engine; only the app-side binding lives here. It depends solely on IccProfLib + its own self-contained headers.
- **Build**: `scripts/build-icc-viewer-wasm.sh` — separate from `build-wasm.sh`; compiles IccProfLib + `IccVizModel.cpp` directly via Emscripten (bypasses iccDEV's top-level CMake so libxml2/tiff/png/jpeg `find_package` calls don't fire). Needs both `ICCDEV_ROOT` and `ICCVIZ_ROOT` reachable.
- **Artifacts**: `public/wasm/icc-viewer.{mjs,wasm}` (~960 KB WASM + ~40 KB glue, both committed; the +viz engine pushed WASM up from ~730 KB and `INITIAL_MEMORY` from 16→32 MB for CLUT-raster headroom)
- **JS wrapper**: `public/icc-viewer.js` — exposes `window.IccViewer.{validateProfile, describeTag, enumerate, renderGraph, renderRaster, tagEvalInfo, evaluateTag}`; blob-URL dynamic import matches the `gamut.js` pattern
- **Viz rendering layer**: `public/icc-viz.js` — vanilla-JS port of profiletool's React viz components (GraphSvg / RasterCanvas / Collapsible / TagEvaluator / the TagVisuals dispatcher / rasterDecode / colors). Exposes `window.IccViz.{enumerate, renderTagDetail}`. Built entirely via DOM nodes + `textContent` (never `innerHTML` for profile-derived strings such as named-colour / ink names), so untrusted profile text can't become markup — same hygiene as `escapeHtml`. The ICC viewer is English-only (its strings aren't routed through `t()`), so these labels are plain English to match.

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

The **Settings blade** carries a **Number format** control (`#icc-num-base`, `onIccNumBaseChange`) toggling the Tags-tab Offset / Size / Pad columns between **Hexadecimal** (default — ICC offsets are conventionally read in hex, matching profiletool) and **Decimal**. `_iccFmtInt(n)` does the formatting (hex → `0x…` with the sign outside the prefix so a negative pad overlap reads `-0x4`; decimal stays thousands-grouped); the preference persists in `localStorage` (`iccNumBase`) and changing it re-renders the open tag table. The `number_format` / `hex` / `decimal` i18n keys are localized across all 12 locales (dict + `translations/Eng-*.xlsx`).

**Inline per-tag visualizations** (arrangement follows profiletool): expanding a tag row shows, *above* the `Describe()` dump, the graphs/images relevant to that tag — drawn by `icc-viz.js` from the `IccVizModel` data. `openIccViewer` lazily calls `IccViz.enumerate(bytes)` on the first row-expand (cached on `_iccViewerState.viz`, best-effort — any failure falls back to the plain dump); `_toggleIccTagDetail` delegates the detail body to `IccViz.renderTagDetail`. The dispatcher mirrors profiletool's `TagVisuals` branches: `wtpt` / `rXYZ`/`gXYZ`/`bXYZ` → a CIE-1931 **Chromaticity** chart (relevant point highlighted); `rTRC`/`gTRC`/`bTRC`/`kTRC` → a **Tone curve** + collapsed curve table; `A2B*`/`B2A*`/`preview*` → **Curves** (input/output A/B/M overlays, legend toggles), the **CLUT** lattice image, the profile's **Gamut** image (if a `gamt` tag exists), an **Evaluate** single-point transform applier, and the dump under **Data**; `gamt` → its own colour-coded gamut image (no evaluator — a 1-channel map isn't an evaluable transform); colorant/named-colour tables → a*b*/xy **Scatter** + collapsed tables. Graphs are inline SVG, rasters are `<canvas>` (ICC-normalized samples → sRGB via `decodeRaster`), each section a click-to-toggle collapsible. SVG/canvas are fluid (`max-width:100%`) and the evaluator columns `flex-wrap`, so the whole thing reflows in the full-screen mobile modal. Dark-mode variants included.

The viewer title row also carries a **Launch editor** button that hands the profile bytes off to profiletool in a new tab. `launchIccEditor()` opens `http://localhost:5173/?source=chardata` (dev) or `/profiletool/?source=chardata` (prod), waits for `{type:'profiletool:ready'}` from `window.opener` via `postMessage`, and replies with `{type:'profiletool:load', filename, bytes}`. The reply pins `targetOrigin` to the concrete profiletool origin (`http://localhost:5173` in dev, `location.origin` in prod) — never `'*'` — so profile bytes can only reach the intended target even if the popup is navigated cross-origin before the handshake completes. The incoming `ready` is also `ev.origin`-checked against that same target. One-way — chardata never accepts edits back; the user saves from profiletool directly. Same-origin in prod (profiletool is served at chardata.colourbill.com/profiletool/); cross-origin in dev but `postMessage` is unaffected.

For the dev-mode cross-origin popup to retain its `window.opener`, the helmet config in `server.js` sets `crossOriginOpenerPolicy: 'same-origin-allow-popups'` instead of helmet's default `same-origin`. See the inline comment in `server.js` — don't tighten this back without a same-origin alternative for dev.

### Data flow

A "slot" is `'a'` or `'b'`. Each slot can hold either characterisation data (CSV/CGATS) or an ICC profile, and there are two parallel state objects:

- `_gamutState[slot]` — for characterisation data: `cachedModel` (from `Gamut.fitModel`) + `cachedMesh` (from `Gamut.buildGamutMesh`)
- `_iccState[slot]` — for ICC profiles: `handleId`, `renderingIntent` (default 3 = Absolute Colorimetric), profile metadata, plus `patches` (the device test set) and `patchLabValues` (its profile-evaluated Lab). `buildGamutCache` pre-evaluates a device test set for **every** supported device space — `IT875_PATCHES` for CMYK, `buildNclrPatches(N)` otherwise — into `cachedXYZ` (the 3D point cloud) and `icc.patches`, which `renderExploreIcc` tabulates as the data table (device colorants + Lab) for all device spaces, not just CMYK. The mesh-vertex fallback in `buildGamutCache` only fills `cachedXYZ` if that patch eval failed.

File detection happens up front: `_sniffIcc(buffer)` checks bytes 36..39 for the `acsp` magic. ICC files are routed through `loadIccFromBuffer`; text files (CSV/CGATS/CxF) through `processFileText`, which sniffs the format (`isCxF` via the `colorexchangeformat.com` namespace / `CxF` root, else CGATS `BEGIN_DATA_FORMAT`, else CSV) and dispatches to `parseCxF` / `parseCGATS` / `parseCSV`. All three return the same `{ headers, rows[] }` shape, so everything downstream is format-agnostic. The Rendering Intent dropdown is only visible when the slot holds an ICC profile, and changing it triggers a re-render of every dependent view (3D shell, 2D slice, Compare table, Tone Value chart, Estimate).

**CxF/X-3** (ISO 17972-3): `parseCxF` uses `DOMParser` + `getElementsByTagNameNS('*', localName)` (prefix-agnostic — real files use the `cc:` prefix, not the default namespace). Per `Object` it reads `Name`→`SAMPLE_NAME`, first `ColorCIELab`→`LAB_*`, first `ReflectanceSpectrum`→`xxx_NM` (0–1 reflectance; increment from the referenced `ColorSpecification`'s `WavelengthRange`), and `ColorCMYK`/`ColorCMYKPlusN`/`ColorRGB`→device colorants (0–100). `_buildCxF()` is the writer (full X-3, `cc:` prefix), wired into both `exportData` paths as the `cxf` format.

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

Required columns: `LAB_L`, `LAB_A`, `LAB_B` plus at least one device colorant (typically `CYAN`, `MAGENTA`, `YELLOW`, `BLACK`). Spectral-only files derive Lab via `injectSpectralLab`.

**Spectral → Lab** (`injectSpectralLab`): driven by the `SPECTRAL_WTS` tables — the ICC [colorimetry-data](https://registry.color.org/colorimetry-data/) illuminant × observer weighting tables (`Wts-<ILL>-<YEAR>-380-10-780nm.csv`), embedded verbatim as `{x,y,z}` arrays keyed `"<illuminant>-<year>"`. Each table is 41 entries (380–780 nm @ 10 nm) already normalised so the perfect-reflector white point has `Y = 100` (the `k` constant and bandpass correction are baked in), so XYZ is a plain dot product of weights × reflectance and the white point is the per-channel column sum. Illuminants: D50, D65, A, LED-B1, F11; observer year selects the table (2° = 1931, 10° = 1964). M1 forces the D50 colorimetric illuminant; M2 zeroes the UV band (λ ≤ 400 nm). To add an illuminant: pull its 1931 **and** 1964 CSVs from the registry, embed both as new `SPECTRAL_WTS` keys, and add the `<option>` to the `#illuminant` dropdown — no other code changes. `CMF2_Y` is retained separately (it's the Status-densitometer Visual filter for Tone Value), but the standalone CMF/SPD tables that predated the weighting tables were removed.

### Measurement-only datasets

A dataset with Lab and/or spectral but **no device colorants** (common in CxF, also valid for CGATS/CSV) is accepted and flagged `measurementOnly` on `state[slot]`. `validateCSV` no longer rejects zero-colorant data — only missing Lab. `buildGamutCache` already early-returns on empty colorants (no model/mesh), so the 3D point cloud (`cachedXYZ`, built before that return) still renders. The limited feature set is gated on `measurementOnly`: the 3D point cloud, the 2D gamut slice (point cloud only — included in `renderSlicePlot`'s `allSpecs`; `_modelForSlot` returns null so no boundary polygon, same path as the image slot), the data table (with a `SAMPLE_NAME`/label column via `getLabelCol`), and label-matched Compare (`labelKey` instead of `nonZeroColorantKey` in `runCompare`) are enabled. The gamut shell controls, Extract, Tone Value, Estimate, and G7 validation are all hidden/skipped. Per-point labels also feed the 3D scatter hover (`text`/`%{text}` in `renderPlot`'s `buildTrace`).

### Known limitations

- **ICC-vs-ICC Compare** requires both profiles to expose the same ordered colorant list — per-patch ΔE is only well-defined when the same device vector is fed to both. Mismatched lists (e.g. CMYKOG vs CMYKOV) surface a targeted error naming both lists; CMYK-vs-CMYK uses `IT875_PATCHES`, and N≠4 matching profiles use `buildNclrPatches(N)` (coarser two-ink grid for higher N to keep patch counts bounded). See GitHub issue #2 for the original motivation.

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
- `GET /memstat` → 200 `text/plain` `MEM_OK` or `MEM_LOW`. Memory watchdog read straight from `/proc/meminfo` (no deps). A UptimeRobot **Keyword** monitor watches this URL and alerts when `MEM_OK` is **absent** — covering both a low-memory reading (token flips to `MEM_LOW`) and a total box lockup (no response). Thresholds: available RAM < `MIN_AVAIL_MB` (100) or swap utilisation > `MAX_SWAP_PCT` (60). Body is token-only (no raw numbers) because the URL is public; metrics go to the server log. Fails open to `MEM_OK` if `/proc/meminfo` is unreadable (non-Linux dev). Background: the 447 MB instance once OOM-thrashed into being unreachable on every port during a nightly apt kernel upgrade; 2 GB swap was added as the cushion and this endpoint is the tripwire.

### Subscribe form (release notifications)

Footer link "✉ Subscribe" opens a modal that POSTs cross-origin to the WordPress plugin at `https://colourbill.com/wp-admin/admin-ajax.php?action=cb_subscribe`. There is **no chardata-side backend** for subscribers — the list, moderation UI, and release-send flow all live in the WP plugin. The CSP `connectSrc` includes `https://colourbill.com` to permit the POST. Submit handler is `submitSubscribe()` near the modal markup; the hidden `t0` input is stamped on modal open for the server's time-trap (rejects <1.5s submits). Full architecture: `~/colourbill_WP/wordpress/wp-content/plugins/colourbill-customizations/SUBSCRIBERS.md`.

### Analytics (GA4)

The only third-party tracking on the site is **Google Analytics 4**, measurement ID `G-WJN2XTVMG8`. The gtag snippet (async `googletagmanager.com/gtag/js` loader + inline `dataLayer`/`gtag('config', …)` bootstrap) lives in two places:
- `public/index.html` (head, ~line 43) — hand-maintained.
- `public/help.html` (head, ~line 7) — **generated**; the snippet is emitted by `scripts/generate-help.js` (~line 937), not hand-edited. Change the ID there, not in `help.html`.

CSP allows it explicitly: `scriptSrc` includes `https://www.googletagmanager.com`; `connectSrc` includes `https://www.google-analytics.com` and `https://region1.google-analytics.com` (the beacon endpoints). If you rotate the measurement ID, update both HTML/generator copies — and if a GA endpoint changes, the CSP hosts too. This is the **only** outbound telemetry; the subscribe POST (above) is the only other outbound data flow.

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
