# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running

```
node server.js
```

Serves the app at `http://localhost:3001`. No build step — `server.js` is a static file server only; all logic runs client-side in `public/index.html`.

## Architecture

Everything of substance is in `public/index.html`. The Express server only serves it as a static file.

### Data flow

1. User selects two CSV files (File A / File B) via file inputs.
2. Each file is parsed and validated client-side — required columns are `CYAN`, `MAGENTA`, `YELLOW`, `BLACK`, `LAB_L`, `LAB_A`, `LAB_B`.
3. The Compare button is enabled only when both files pass validation.
4. On Compare, the selected ΔE method is applied (calculation and plot TBD).

### Key functions in `index.html`

| Function | Purpose |
|---|---|
| `parseCSV(text)` | Splits text into `{ headers, rows[] }` |
| `validateCSV(headers)` | Checks for required columns, returns `{ ok, missing[] }` |
| `loadFile(slot, file)` | Reads file, parses, validates, updates panel UI for slot `'a'` or `'b'` |
| `updateCompareBtn()` | Enables Compare only when both `state.a` and `state.b` are valid |

### ΔE method selector

The selected ΔE method (`dEab`, `dE94`, `dE00`) is persisted to `localStorage`. ΔE calculation and plot rendering are not yet implemented — the Compare button currently logs both datasets to the console.

### Dependencies

- **express** — npm package, install with `npm install`.
