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

## Resolved in 1.15.x antagonistic review (2026-07-08)

Full hostile pass mirroring the tiffview security sweep — response headers, CSP,
untrusted-WASM decode, dependency SCA — plus an empirical parser fuzz. Live
headers/TLS reconfirmed on the wire (`chardata.colourbill.com`, Cloudflare-
fronted). **Two exploitable client-side issues found** (one HIGH XSS the earlier
sweeps missed, one compute-DoS), plus two low XSS and a header gap; all fixed.

### 13. Stored XSS via colorant name in Tone-Value checkbox `id=` ✓ DONE

`buildTvColorantCheckboxes` (`public/index.html` ~6980) interpolated a
device-colorant **name** (CSV/CGATS column header **or** ICC `colorantTableTag`
ink name — both attacker-controlled) into an `id="${cbId}"` attribute **unescaped**.
The visible `<span>` was escaped (~6982) but the `id` was missed — the same
escaped-in-one-context-missed-in-another regression as #4/#5/#7. A header like
`zz"><img src=x onerror=…>` broke out of the attribute and executed on
`container.innerHTML = …` — **no interaction beyond loading the file** (the
checkbox grid auto-renders in Explore/Compare). Also reachable via a crafted NCLR
ICC ink name (≤32 bytes, enough for `"><img src=x onerror=alert(1)>`).
Fix: `id="${escapeHtml(cbId)}"`. Behaviour-preserving — the id is read back via
`getElementById(\`tv-cb-${slot}-${colorant}\`)` and saved by `cb.id`, and the HTML
parser entity-decodes the attribute so `.id` still equals the raw string on both
sides. Verified headless: payload renders inert (no live `<img>`, `onerror` never
fires), checkbox still functions.

### 14. Uncapped compute DoS on load (high colorant count) ✓ DONE

`buildGamutCache` runs **automatically on load** (no user click). The polynomial
fit matrix grows as `C(nC+deg,deg)²` and the boundary-cloud mesh as
`C(N,2)·2^(N-2)·(steps+1)²`; at `nC=15` that is a ~1.9 GB matrix / ~7.7 M mesh
vertices — a crafted CSV with many colorant columns (or an exotic 13–15-channel
NCLR ICC) hangs/OOMs the tab, uncatchably, on load. (`fitModel` already rejects
`nC>15`, so the practical crashers are `nC=14/15`.)
Fix: a JS-side `MAX_MODEL_COLORANTS = 12` cap (the tiffview "resident cap" analog)
in both the CSV and ICC paths — skip the model + 3D shell, keep the point cloud,
2D slice, data table, and Compare. Real print data is ≤7 colorants (CMYKOGV); >12
was already "best-effort / may OOM" per the `BOUNDARY_STEPS` note, so this turns a
crash into graceful degradation. Verified headless: 15-colorant load returns in
~1 ms (was a hang), point cloud built, mesh skipped, `console.warn` logged.

### 15. Filename XSS in export-dialog `value=` ✓ DONE

`_showExportDialog` (`public/index.html` ~7729) wrote the uploaded file's name
into `value="${baseName}_extracted"` unescaped, and `nameInput.focus()` fires on
open — a file named `a" onfocus=alert(1) autofocus x.csv` (legal on Linux/macOS)
executes. Fix: `escapeHtml(baseName)`, and `escapeHtml(localDirHandle.name)` on the
adjacent folder field (self-XSS, hygiene).

### 16. Unescaped ICC signature cells ✓ DONE

`renderExploreIcc` (~7387–7388) emitted the profile's `colorSpace` / `deviceClass`
signatures (`sig4str`, ≤4 attacker bytes) unescaped in element-text — too short to
weaponise, but markup-corrupting. Fix: `escapeHtml(…)`, matching the already-escaped
`a.name` / colorant cells around them.

### 17. `Permissions-Policy` response header ✓ DONE

Helmet doesn't set it; the deployed headers had none. Added an explicit middleware
in `server.js` denying camera/microphone/geolocation/usb/payment/…/`interest-cohort`
/`browsing-topics` — a static colour viewer needs none of them. Verified on the wire.

### 18. Parser fuzz — no crash/hang on untrusted profile bytes ✓ VERIFIED

Answered the "fuzz the decoder" ask empirically. Loaded both shipped WASM modules
in Node and fed **3,788 hostile inputs** (28 seed profiles incl. the lcms2 `bad*`
+ profiletool `beyond-eof`/`added-bytes`/`zero-tags` adversarial corpora ×
bitflips / truncation / extension / zeroing / header-field corruption, plus
random & boundary-size buffers) through `loadIccProfile` (lcms2) and
`validateProfile`/`describeTag` (IccProfLib). Result: **no uncatchable crash, no
hang, zero anomalies** — every input returned a value or a graceful `{error}`
(lcms2 2545 ok / 1242 error / 1 caught-throw; IccProfLib 1583 ok / 2205 error / 0
throw). Memory-safety bugs in the vendored native parsers remain contained by the
WASM sandbox (worst case = the visitor's own tab), and the static server never
parses uploads, so there is no server-side exposure. The harness was a throwaway
(session scratch, not committed); a portable version seeded from the in-repo
`gamut-wasm/third-party/lcms2/testbed/*.icc` corpus could be added under `scripts/`
as a standing regression to rerun after any lcms2/IccProfLib bump.

**Confirmed already-good (no change needed):** CSP is a **response header** (no
`<meta>` CSP exists), `script-src`/`script-src-attr` `'unsafe-inline'` is
architecturally required (hand-authored single-file SPA, hundreds of inline `on*=`
handlers — the documented divergence from tiffview's bundled build), `style-src
'unsafe-inline'` required (inline `<style>` block + 466 inline `style=` attrs +
Plotly's runtime `<style>` injection); HSTS `max-age=31536000; includeSubDomains`,
`nosniff`, `Referrer-Policy: no-referrer`, `frame-ancestors 'none'`, COOP/CORP all
present; `npm audit` **0 vulnerabilities**; prototype-pollution (array-indexed
parsers / uppercased keys / `Map`), `postMessage` (source+origin+type checked,
`targetOrigin` pinned never `'*'`), outbound requests (**no file bytes leave the
device** — "runs locally" upheld), `target=_blank` (`rel=noopener`), and
localStorage (all bounded consumers) sections all clean.

## Still deferred

### Vendored native-parser tracking (lcms2 **+ IccProfLib**)

Two untrusted-ICC parsers ship as native→WASM: **lcms2**
(`gamut-wasm/third-party/lcms2`, transforms) and **IccProfLib** (from `~/code/iccdev`,
the viewer/validator). Both have CVE history (lcms2: CVE-2018-16435, CVE-2023-3486;
IccProfLib/DemoIccMAX: numerous OOB reads/writes). The 32 MB / 128-byte caps + the
WASM sandbox mitigate gross DoS and contain corruption to the tab (confirmed by the
#18 fuzz), but neither protects against a parser-level memory bug in principle.

**Action:** watch the [mm2/Little-CMS releases](https://github.com/mm2/Little-CMS/releases)
and iccDEV master; on a bump, rebuild via `scripts/build-wasm.sh` /
`scripts/build-icc-viewer-wasm.sh` **against a clean master** (see the WASM-
contamination note in `CLAUDE.md`) and record the pins. lcms2 is currently 2.19
(2026-04); IccProfLib rebuilds are already clean-master-gated by the pre-commit hook.

### CSP `report-uri` / `report-to`

The deployed CSP has no reporting endpoint, so violations from real visitors (a
sign of XSS, mis-configured analytics, or a third-party tag dropping inline JS)
are invisible. Optional but cheap. Could point at a free endpoint like
report-uri.com or our own `/csp-report` route.

### Origin IP not firewalled to Cloudflare (box-level)

`chardata.colourbill.com` is Cloudflare-proxied but the Lightsail origin
(`54.203.184.14`) still answers direct traffic, so the WAF/DDoS layer is
bypassable by hitting the IP. Same deferred item as tiffview/spectral — best fixed
box-wide (IP-range firewall or Cloudflare Authenticated Origin Pulls) covering all
apps at once. Low impact for a static viewer.

### Optional, low-urgency defence-in-depth

- **WASM `SHA256SUMS` integrity manifest** (tiffview ships one + a CI `sha256sum -c`
  gate). Lower value here: chardata commits prebuilt WASM and never rebuilds in CI,
  so git already integrity-covers the binaries; a manifest would add only a human-
  reviewable expected-hash record + post-checkout tamper detection.
- **`gamut-wrapper.cpp` exception-safe boundary wrappers + C++ output-size ceilings**
  — mirror `plot-wrapper.cpp`'s try/catch→`{error}` boundary and add a projected-
  vertex ceiling in C (the JS-side #14 cap + the #18 fuzz make this non-urgent; the
  1 caught-throw in the fuzz is already contained by `gamut.js`'s `unwrapError`).
  Needs a WASM rebuild.
- **`plot-wrapper.cpp` size cap** is 256 MB vs the 32 MB used everywhere else —
  align on the next icc-viewer rebuild (both are bounded; purely consistency).
