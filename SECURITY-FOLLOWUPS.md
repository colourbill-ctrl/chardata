# Security follow-ups

## Resolved in 1.4.0 review (2026-05-05)

### 1. `escapeHtml` sweep of pre-existing innerHTML sinks ✓ DONE

Fixed in `public/index.html`:
- `buildTvColorantCheckboxes` — `ds.name` in `title` attr and content (~4717)
- `buildTvColorantCheckboxes` — `colorant` name in checkbox label (~4729)
- `renderTvChart` legend — `t._label` (colorant + ds.name) (~4935)
- Data Table heading — `a.name` (~5026)
- 3D plot legend — `spec.name` (~6179)
- 2D slice legend — `spec.name` (~7040)
- `buildSpectralLabel` — `fileName` and colorant short-names (~3970, ~3975)

### 2. Content-Security-Policy header in `server.js` ✓ DONE

Replaced `contentSecurityPolicy: false` with a full directive set:
- `script-src`: self + unsafe-inline + wasm-unsafe-eval + GTM + blob:
- `style-src`: self + unsafe-inline (Plotly inline styles)
- `img-src`: self + data:
- `connect-src`: self + blob: + Google Analytics domains
- `worker-src`: self + blob:
- `script-src-attr`: unsafe-inline (existing inline event handlers)
- `object-src`: none
- `frame-ancestors`: none (anti-clickjacking)

`'unsafe-inline'` in `script-src` is unavoidable given the architecture
(all JS is inline in index.html). The policy still blocks unexpected
external script origins, forbids object embeds, and prevents framing.

### 3. Max input size guard in `addFileToList` ✓ DONE

`MAX_FILE_BYTES = 200 MB` const + early-return guard at the top of
`addFileToList`. Shows `alert()` consistent with the existing non-slot
error pattern.

## Resolved in follow-up review (2026-05-05)

### 4. Estimate-panel attribute-context XSS ✓ DONE

`buildEstimateHTML` was interpolating colorant names (CSV column header /
ICC ink name — both attacker-controlled) into HTML `id` attributes *and*
into JS string literals inside `oninput=` / `onchange=` handlers. A CSV
header like `Cyan'),alert(1)//` would have executed.

Fix: switched the Estimate UI from name-keyed to **index-keyed** IDs and
handler arguments. `onEstimateInput(idx, val)` now resolves the colorant
name internally via `_estimateModel.colorants[idx]`, so untrusted strings
never reach an HTML attribute. Visible `<td>${c}</td>` cells additionally
go through `escapeHtml`.

### 5. Explore-table colorant header + cells ✓ DONE

`renderExpTable` was emitting `<th>...${c}...</th>` (colorant name) and
`<td>...${col[ri]}...</td>` (colorant cell text — `alignDecimals` returns
the original string when `parseFloat` fails) without escaping. Both now
go through `escapeHtml`. Lab/chroma/hue cells stay untouched — they flow
through `fmtLab`/`fmtCH`/`toFixed` and can only emit numeric strings or
the `'—'` placeholder.

### 6. Supply-chain pinning in deploy workflow ✓ DONE

`.github/workflows/deploy.yml` ran `npm install --omit=dev`, which
honours the `^`-ranged versions in `package.json` and could pull in
silently-updated transitive dependencies between deploys. Switched to
`npm ci --omit=dev` so the committed `package-lock.json` is the source
of truth.

## Still deferred

### lcms2 vendored-submodule tracking

`gamut-wasm/third-party/lcms2` is the parser that handles untrusted ICC
profile bytes. lcms2 has had CVEs historically (CVE-2018-16435,
CVE-2023-3486, etc.). The 32 MB cap and 128-byte minimum in the wrapper
mitigate gross DoS but do not protect against parser-level memory bugs.

**Action:** subscribe to the [mm2/Little-CMS releases feed](https://github.com/mm2/Little-CMS/releases)
or set a quarterly reminder to bump the submodule to the latest tag and
re-run `scripts/build-wasm.sh`. Record the pinned commit in
`gamut-wasm/third-party/lcms2`.

### CSP `report-uri` / `report-to`

The deployed CSP has no reporting endpoint, so violations from real
visitors (a sign of XSS, mis-configured analytics, or a third-party
tag dropping inline JS) are invisible. Optional but cheap. Could point
at a free endpoint like report-uri.com or our own `/csp-report` route.
