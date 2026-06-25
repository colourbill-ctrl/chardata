<!-- (c) 2026 William Li -->

# CharData — Architecture

A diagram of CharData's major components, grouped by the environment each runs in
(browser JavaScript, browser WebAssembly, Node.js server, build-time tooling, and
external services). See `docs/architecture.svg` for a rendered version of the same.

## Diagram (Mermaid)

```mermaid
flowchart TB
  subgraph BROWSER["CLIENT &mdash; Browser"]
    direction TB

    subgraph JS["JavaScript / DOM"]
      SPA["public/index.html<br/>single ~10.8k-line SPA<br/><br/>• UI + state: _gamutState[a|b], _iccState[a|b], _rawFileData[]<br/>• Ingest: addFileToList, _sniffIcc (acsp magic)<br/>• Parsers: parseCSV / parseCGATS / parseCxF (CxF·X-3)<br/>• Views: renderPlot (3D), renderSlicePlot (2D),<br/>&nbsp;&nbsp;runCompare (ΔE), Tone Value, Estimate, G7<br/>• I18N dict (11 langs), escapeHtml (XSS guard)"]
      GAMUTJS["public/gamut.js<br/>blob-URL dynamic import<br/>→ window.Gamut"]
      ICCJS["public/icc-viewer.js<br/>blob-URL dynamic import<br/>→ window.IccViewer"]
      PLOTLY["plotly-2.27.0.min.js<br/>3D / 2D rendering"]
    end

    subgraph WASMENV["WebAssembly (C++ compiled)"]
      GAMUTW["chardata-gamut.wasm<br/>src: gamut-wasm/gamut-wrapper.cpp<br/>embeds lcms2 (vendored)<br/><br/>fitModel · buildGamutMesh · buildSlice<br/>loadIccProfile · evalIccA2B/batch · buildIccGamutMesh<br/><i>always loaded</i>"]
      ICCW["icc-viewer.wasm (lazy)<br/>src: icc-viewer-wasm/wrapper.cpp<br/>embeds IccProfLib (iccDEV)<br/><br/>validateProfile · describeTag<br/><i>loaded only on “Display File”</i>"]
    end

    SPA -->|window.Gamut| GAMUTJS
    SPA -->|window.IccViewer| ICCJS
    SPA -->|script src| PLOTLY
    GAMUTJS --> GAMUTW
    ICCJS --> ICCW
  end

  subgraph SERVER["SERVER &mdash; server.js (94 lines) · Node.js / Express"]
    direction TB
    EXP["Express static middleware (serves public/) + helmet<br/>• CSP; COOP = same-origin-allow-popups (dev profiletool popup)<br/>• only special MIME: application/wasm<br/>• GET /favicon.ico → 204<br/>• GET /health → “ok” (UptimeRobot)<br/>• GET /memstat → MEM_OK|MEM_LOW (reads /proc/meminfo)<br/><br/>NO runtime build · NO database · NO subscriber backend"]
  end

  subgraph BUILD["BUILD-TIME &mdash; pre-commit, WSL + Emscripten"]
    direction TB
    BW["build-wasm.sh → chardata-gamut.wasm"]
    BIW["build-icc-viewer-wasm.sh → icc-viewer.wasm"]
    GH["generate-help.js: MANUAL.md → public/help.html"]
  end

  subgraph EXT["EXTERNAL SERVICES (cross-origin)"]
    direction TB
    WP["colourbill.com WP plugin<br/>/admin-ajax.php (✉ Subscribe POST)"]
    GA["GA4 analytics"]
    UR["UptimeRobot (/health, /memstat keyword)"]
    PT["profiletool (separate app, new tab)"]
  end

  subgraph DEPLOY["DEPLOY"]
    direction TB
    CD["push main → GitHub Actions → SSH to AWS Lightsail<br/>git reset --hard · npm install --omit=dev · pm2 restart<br/>chardata.colourbill.com (profiletool at /profiletool/ in prod)"]
  end

  BROWSER <-->|HTTPS: static assets + 3 endpoints| SERVER
  SPA -.->|one-way, origin-pinned postMessage<br/>launchIccEditor hands profile bytes| PT
  SPA -.->|cross-origin POST| WP
  BROWSER -.-> GA
  SERVER -.-> UR
  BUILD -.->|commits .wasm + help.html artifacts| SERVER
  CD -.-> SERVER
```

## Component summary by environment

**Browser / JavaScript (the app)**
- `public/index.html` — the entire SPA: UI, two parallel state objects (`_gamutState`
  for characterisation data, `_iccState` for ICC profiles), file ingest/sniffing (CSV,
  CGATS, CxF, ICC), all views (3D plot, 2D slice, Compare, Tone Value, Estimate, G7),
  and the 11-language I18N dictionary. There is no JS build — it is served as-is.
- `public/gamut.js`, `public/icc-viewer.js` — thin loaders that pull the WASM modules
  in via blob-URL dynamic import and expose `window.Gamut` / `window.IccViewer`.
- `plotly-2.27.0.min.js` — vendored rendering library.

**Browser / WebAssembly (C++ compiled)**
- **Module 1 — `chardata-gamut.wasm`** (from `gamut-wasm/gamut-wrapper.cpp`, embeds
  vendored **lcms2**): does all the math — polynomial model fitting, 3D mesh / 2D slice
  generation, and ICC profile A2B evaluation/transforms. Always loaded.
- **Module 2 — `icc-viewer.wasm`** (from `icc-viewer-wasm/wrapper.cpp`, embeds
  **IccProfLib** from iccDEV): ICC header + tag-directory display only. Lazy — loaded
  just on "Display File."

**Server / Node.js**
- `server.js` — a 94-line Express + helmet static file server. Only three live
  endpoints (`/favicon.ico`, `/health`, `/memstat`); no DB, no build step, no app logic.

**Build-time (not running in either env above)**
- Pre-commit hook + `scripts/*` regenerate the two `.wasm` artifacts (WSL + Emscripten)
  and `public/help.html` (from `MANUAL.md`), since Lightsail has no toolchain.

**External (cross-origin)**
- WordPress plugin on `colourbill.com` handles the Subscribe form; GA4 for analytics;
  UptimeRobot watches `/health` and `/memstat`; profiletool (separate app) receives
  profile bytes via one-way origin-pinned `postMessage`.
