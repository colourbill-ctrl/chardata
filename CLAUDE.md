# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Running

```
node server.js
```

Serves the app at `http://localhost:3002`. No build step for JS — `server.js` is a static file server only.

## Architecture

Everything of substance is in `public/index.html`. The Express server only serves it as a static file.

### WASM module

Gamut calculations (model fitting, 3D mesh generation, 2D slice) live in C++ compiled to WebAssembly:

- **Source**: `gamut-wasm/gamut-wrapper.cpp` — three embind-exported functions
- **Build**: Run from WSL: `scripts/build-wasm.sh` (requires Emscripten + nlohmann-json3-dev)
- **Artifacts**: `public/wasm/compwas-gamut.mjs` + `public/wasm/compwas-gamut.wasm`
- **JS wrapper**: `public/gamut.js` — loads WASM via blob-URL dynamic import, exposes `window.Gamut`

### WASM API (`window.Gamut`)

| Function | Purpose |
|---|---|
| `Gamut.preload()` | Eagerly load + instantiate the WASM module (returns Promise) |
| `Gamut.fitModel(data)` | Fit weighted polynomial model; returns model JSON object |
| `Gamut.buildGamutMesh(model, steps)` | Build 3D mesh via boundary-cloud triangulation; returns `{vertices, triangles}` |
| `Gamut.buildSlice(model, axis, value, steps)` | 2D gamut slice at fixed Lab axis; axis: 0=L*, 1=a*, 2=b*; returns `{polygon, raw}` |
| `Gamut.BOUNDARY_STEPS` | Default steps per colorant count for 3D mesh |
| `Gamut.SLICE_FACE_STEPS` | Default steps per colorant count for 2D slice |

### Data flow

1. User selects two CSV files (File A / File B) via file inputs.
2. Each file is parsed and validated client-side — required columns are `CYAN`, `MAGENTA`, `YELLOW`, `BLACK`, `LAB_L`, `LAB_A`, `LAB_B`.
3. On file load, `buildGamutCache(slot)` calls `Gamut.fitModel()` then `Gamut.buildGamutMesh()` and stores results in `_gamutState[slot].cachedModel` and `_gamutState[slot].cachedMesh`.
4. The 3D gamut shell uses explicit `mesh3d` with `i/j/k` triangle arrays from WASM (not Plotly alphahull).
5. The 2D slice calls `Gamut.buildSlice()` asynchronously per render.
6. The Estimate section evaluates `evalPolynomialModel()` in JS against the WASM-fit model coefficients.

### Key functions in `index.html`

| Function | Purpose |
|---|---|
| `parseCSV(text)` | Splits text into `{ headers, rows[] }` |
| `validateCSV(headers)` | Checks for required columns, returns `{ ok, missing[] }` |
| `loadFile(slot, file)` | Reads file, parses, validates, updates panel UI for slot `'a'` or `'b'` |
| `buildGamutCache(slot)` | Async: fits WASM model + builds mesh, populates `_gamutState[slot]` |
| `regenerateGamutShell(slot)` | Async: rebuild mesh from cached model and re-render |
| `renderPlot()` | Render/update the Plotly 3D plot |
| `renderSlicePlot()` | Async: render/update the 2D gamut slice plot via `Gamut.buildSlice()` |
| `evalPolynomialModel(model, vals)` | Evaluate WASM model coefficients in JS (for Estimate section) |
| `updateCompareBtn()` | Enables Compare only when both `state.a` and `state.b` are valid |

### Dependencies

- **express** — npm package, install with `npm install`.
