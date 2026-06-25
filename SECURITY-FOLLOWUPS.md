<!-- (c) 2026 William Li -->

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

## Resolved in 1.9.x review (2026-06-11)

Full-codebase scan (chardata + profiletool) plus live header/TLS/dependency
review. Two genuinely exploitable XSS sinks found in chardata — both
escaping-convention regressions in code added *after* the 1.4.0 sweep.

### 7. Stored XSS in Extract "remove colorant" chips ✓ DONE

`renderExplore()` (`public/index.html` ~6970) interpolated a device-colorant
name (CSV/CGATS column header or CxF `SpotInkName` — attacker-controlled) into
three sinks unescaped at once: the `id` attribute, the chip `<span>`, and an
inline `onclick="toggleColorantDelete('…')"` **JS-string literal**. A CSV header
like `');alert(document.cookie)//` broke out of the handler string and executed
on click — the exact name-keyed-handler anti-pattern #4/#5 were supposed to have
eliminated (the Extract chip control in the same Explore view was missed).

Fix: index-keyed the handler (`toggleColorantDelete(idx)` resolves the name
internally via `state.a.colorants[idx]`, mirroring `onEstimateInput`), `id` is
now `colorant-chip-<idx>`, and the visible `<span>` goes through `escapeHtml`.
Verified end-to-end (headless): payload renders as inert text, no execution on
click, delete-toggle still works.

### 8. XSS in file-panel colorant line on language switch ✓ DONE

`refreshPanelUI()` (`public/index.html` ~3725) wrote `s.colorants.join(', ')`
into `colorantsEl.innerHTML` unescaped — the re-localization path (only caller:
`onLangChange`) forgot the `escapeHtml` that the first-render path at ~4941
already applies. Trigger: load a malicious file, then change UI language.
Fix: `s.colorants.map(escapeHtml).join(', ')`. Verified (French switch, no exec).

### 9. ICC-viewer WASM size guard ✓ DONE

`icc-viewer-wasm/wrapper.cpp` handed bytes straight to `ValidateIccProfile`
with no wrapper-level cap (unlike `gamut-wrapper.cpp`). Added a shared
`iccSizeGuard` (32 MB / 128-byte, matching the lcms2 path) to `validateBytes`
and `describeTagBytes`. WASM rebuilt + committed; valid profiles still display
(verified with a FOGRA39L CMYK profile — 81×81 CLUT raster paints).

### 10. Shared IccVizModel CLUT-raster hardening ✓ DONE

`iccviz/IccVizModel.cpp` (the engine shared with profiletool via `window.IccViz`)
`buildClutRaster`: tile-count and image-buffer geometry are profile-derived and
were computed in `int`/`size_t` (32-bit on wasm32) — a positive overflow could
land on a small value that escaped the `<=0` guards and under-sized the buffer.
Fixed: 64-bit accumulation with overflow bail on the tile loop, a `uint64_t`
buffer-size ceiling (256 MB) before `assign`, a zero-divisor guard on the
row-alignment modulus, a null check on `GetData(0)`, and `strnlen`-bounded
construction of the colorant/named-colour label strings. Unreachable behind the
input cap today, but no longer relies on an implicit upstream invariant. Built
into both chardata (`icc-viewer.wasm`) and profiletool (`iccplot.wasm`).

### 11. Deploy workflow action SHA-pin + least privilege ✓ DONE

`.github/workflows/deploy.yml` pinned `appleboy/ssh-action@v1.0.3` by **mutable
tag** while handing it `SSH_PRIVATE_KEY`. Pinned to the commit SHA
(`029f5b4…`, matching profiletool's SHA-pin convention) and added
`permissions: {}` (the job never uses `GITHUB_TOKEN`).

### 12. express/qs DoS advisory ✓ DONE

`npm audit fix` bumped express 4.21→4.22.2 / qs→6.15.2 (GHSA-q8mj-m7cp-5q26).
Not practically reachable on a static file server, but cleared to keep the
audit green. `package.json` unchanged; lockfile only.

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
