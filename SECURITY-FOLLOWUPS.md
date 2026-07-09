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

## Resolved in image-decode antagonistic pass (2026-07-08, follow-up)

Second hostile pass, scoped to the **UTIF / TIFF-JPEG-PDF image-decode path** — the
one surface the 1.15.x fuzz (#18) explicitly did **not** cover (it fuzzed the ICC
WASM parsers only). chardata's Image tab (`#image-file-input`, accepts
`tiff/bmp/gif/pdf/png/jpeg`) runs the pure-JS **UTIF** decoder plus hand-rolled
PDF/Flate paths on untrusted bytes. Reachable by luring a user to open a crafted
file (no postMessage/URL push into this path), so severity is a **visitor-tab DoS /
content-injection**, not server compromise — but the 1.15.x sweep had left it
unmeasured. An adversarial-TIFF fuzz (`decode()` over bombs / malformed / truncated
/ bit-flipped / random inputs, plus an isolated `decodeImage` allocation probe)
found **one main-thread-freeze DoS the size cap did not stop**; hardened the whole
path and re-verified.

### 19. UTIF metadata-parse hang/OOM — unbounded tag-count loop ✓ DONE  (HIGH-ish DoS)

`UTIF._readIFD` (`public/lib/utif.js`) reads a TIFF tag's **count** field straight
from the file and loops that many times pushing to a JS array, for value types
3/4/5/8/9/10/11/12/13 with **no bound** (upstream already clamps types 1/2/7 in-line).
A **~130-byte** crafted TIFF with one bogus count (up to 4.28e9) froze the main
thread **6–20 s** and OOMs the tab — and it fires in `sniffTiff` → `UTIF.decode`,
i.e. **before** any dimension/size logic could run, so the file-size cap is no
defence. Empirically found by the fuzz (`flip17/29/41/53` = the high byte of
successive tags' count fields → 12–20 s each). Upstream bug (photopea/UTIF),
reportable. **CWE-834 / CWE-400.**

Fix (mirrors UTIF's own type-1/2/7 clamp discipline, behaviour-preserving for every
well-formed TIFF): a **per-tag** clamp of out-of-line counts to what the buffer
actually holds, plus a **per-decode element budget** (`UTIF._MAXELEMS = 64 M`)
threaded via `prm` across all IFD / sub-IFD / maker-note recursion, plus an IFD-chain
cap (`UTIF._MAXIFDS`). Verified: fuzz anomalies **20 s → 0** (280 decode() ok, no
hang); valid inline **and** out-of-line array tags (`BitsPerSample [8,8,8]`,
multi-strip) still decode losslessly.

### 20. Decoded-dimension / decompression bomb — no pixel cap before allocation ✓ DONE  (MED DoS)

Every decode entry trusted attacker image dimensions: `decodeTiff` → `UTIF.decodeImage`
allocates `height·⌈width·spp·bpc/8⌉` up front from the IFD tags; `decodeCmykJpegViaUtif`,
`decodePdf`, and `decodeViaCanvas` likewise allocate `w·h·channels`. The 100 MB
**file** cap only bounds *uncompressed* images — CCITT-G3/G4 (1-bit "plates"), LZW,
PackBits, Deflate-TIFF, JPEG and PDF Flate/DCT decouple file size from decoded size,
so a few-KB file can claim **gigapixel** dimensions and OOM the tab. (The isolated
`decodeImage(65535²)` probe timed out / OOM-killed even under a 256 MB child cap.)

Fix: `MAX_IMAGE_PIXELS = 64 Mpx` + an `assertImagePixels(w,h,spp)` guard (JS-number
math, exact to 2⁵³ — no 32-bit overflow wrap) applied in **`sniffTiff`** (before
`UTIF.decodeImage`), **`sniffPdf`**, **`decodeTiff`** (defence-in-depth), a new
**`jpegSofDims` SOF pre-scan** in `decodeCmykJpegViaUtif` (bounds the frame before
`JpegDecoder.parse` allocates coefficient buffers), and **`decodeViaCanvas`** onload.
Rejects with a localized `image_err_too_big` (added to all 12 locales). 64 Mpx is far
above any real proof scan / camera image; uncompressed inputs are already bounded
tighter by the file cap, so this specifically defuses compression bombs.

### 21. zlib-bomb via `inflateAsync` — no output cap ✓ DONE  (MED DoS)

`inflateAsync` (PNG iCCP, PDF `/ICCBased`, PDF image `/FlateDecode`) accumulated the
entire inflated stream with no ceiling — a few-KB deflate stream can inflate to GBs.
Fix: `maxBytes` param that cancels the reader and throws once exceeded —
`MAX_ICC_INFLATE_BYTES = 64 MB` for embedded-ICC, `MAX_IMAGE_INFLATE_BYTES = 512 MB`
for PDF image streams.

### 22. Plotly text-field link/markup injection via filename & colorant name ✓ DONE  (LOW)

Attacker-controlled **dataset names (= filename)** and **colorant names** were passed
**raw** into Plotly `name:` (legend) / `title.text` sinks — 3D scatter/mesh/wireframe,
2D slice, tone-value plot. Plotly renders a limited HTML subset in text fields
(`<a href>`, `<b>`, `<span style>`, …) and resolves entities, so a filename like
`<a href="https://evil">x</a>.csv` injects a **clickable off-site link / markup** into
a chart. **Not** script execution — Plotly 2.27 protocol-sanitizes hrefs (drops
`javascript:`, verified in the min.js: resolves `.protocol` against an allowlist) and
whitelists tags (no `<img>`/event handlers) — but the innerHTML-focused sweeps
(#1/#4/#5/#7/#13) had only escaped these names at the **HTML-legend** sink, missing the
**Plotly text** sink. (`buildSpectralLabel` already `escapeHtml`s, so the spectral
popup was incidentally safe.)

Fix: a `plotlyText()` helper (escapes `<>&`) applied at the 7 Plotly `name:` sinks that
receive raw filenames/colorant names; the parallel custom HTML legends keep their own
`escapeHtml`, so no double-escaping.

**Re-verified this pass (unchanged, good):** live headers on the wire
(`chardata.colourbill.com/` root + `/index.html`, Cloudflare-fronted) — **CSP is a
response header** (full helmet directive set incl. `base-uri 'self'`, `form-action
'self'`, `upgrade-insecure-requests`; no `<meta>` CSP), `script-src`/`style-src`
`'unsafe-inline'` confirmed **required** (466 inline `style=` attrs + 1 `<style>` +
Plotly runtime `<style>` injection; hundreds of inline `on*=` handlers in the
single-file SPA), HSTS `max-age=31536000; includeSubDomains`, `nosniff`,
`Referrer-Policy: no-referrer`, Permissions-Policy, `frame-ancestors 'none'` + XFO,
COOP/CORP all present. `npm audit` **0** (express+helmet only).

**SCA of the *vendored* client libs `npm audit` can't see** (they aren't in the
lockfile): **plotly.js 2.27.0** — clear of the one relevant recent advisory,
**CVE-2023-46308** (prototype pollution, fixed in 2.25.2 < 2.27.0); slightly behind
latest 2.x (hygiene only, no known open vuln). **utif.js** — the DoS in #19, now
patched locally.

### Minor / hygiene (this pass)

- **Duplicate `Strict-Transport-Security` at the edge.** Cloudflare adds a second HSTS
  header (`max-age=31536000`, **without** `includeSubDomains`) on top of helmet's
  (`…; includeSubDomains`). RFC 6797 says the UA processes only the first, so the
  effective policy is fine, but two layers set HSTS and the Cloudflare one is weaker —
  pick one authority (drop helmet's HSTS and set it edge-side, or disable Cloudflare's)
  to avoid drift. Neither carries `preload` (intentional).
- **xlsx translation drift.** `image_err_too_big` was added to all 12 I18N locales
  (runtime correct) but not to `translations/Eng-*.xlsx`; chardata has no
  `sync-translations` script (profiletool does), so regenerate or hand-add on the next
  translation pass. Non-security.
- **Portable image-decode fuzz** (`decode()` bombs/malformed/bitflip + `decodeImage`
  allocation probe + guard checks) exists as a session artifact; worth landing under
  `scripts/` as a standing regression to rerun after any UTIF bump, alongside the #18
  ICC-parser fuzz suggestion.

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
