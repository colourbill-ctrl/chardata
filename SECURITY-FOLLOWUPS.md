# Security follow-ups

All three items from the 1.4.0 security review have been resolved (2026-05-05).

## 1. `escapeHtml` sweep of pre-existing innerHTML sinks ✓ DONE

Fixed in `public/index.html`:
- `buildTvColorantCheckboxes` — `ds.name` in `title` attr and content (~4717)
- `buildTvColorantCheckboxes` — `colorant` name in checkbox label (~4729)
- `renderTvChart` legend — `t._label` (colorant + ds.name) (~4935)
- Data Table heading — `a.name` (~5026)
- 3D plot legend — `spec.name` (~6179)
- 2D slice legend — `spec.name` (~7040)
- `buildSpectralLabel` — `fileName` and colorant short-names (~3970, ~3975)

## 2. Content-Security-Policy header in `server.js` ✓ DONE

Replaced `contentSecurityPolicy: false` with a full directive set:
- `script-src`: self + unsafe-inline + wasm-unsafe-eval + GTM + blob:
- `style-src`: self + unsafe-inline (Plotly inline styles)
- `img-src`: self + data:
- `connect-src`: self + blob: + Google Analytics domains
- `worker-src`: self + blob:
- `object-src`: none
- `frame-ancestors`: none (anti-clickjacking)

Note: `'unsafe-inline'` in `script-src` is unavoidable given the architecture
(all JS is inline in index.html). The policy still adds meaningful defence:
blocks unexpected external script origins, forbids object embeds, and prevents
framing.

**Test plan (still relevant for regression):** boot `node server.js`, load the page,
exercise 3D plot, WASM load, ICC profile, help page — watch console for CSP violations.

## 3. Max input size guard in `addFileToList` ✓ DONE

Added `MAX_FILE_BYTES = 200 MB` const and early-return guard at the top of
`addFileToList` in `public/index.html`. Shows `alert()` consistent with the
other non-slot error pattern (lines 3524, 3609).
