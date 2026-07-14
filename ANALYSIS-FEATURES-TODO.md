<!-- (c) 2026 William Li -->

# Analysis / QC features — roadmap & follow-ups

Rolling log for the profile/characterisation **quality-control** feature set. The
methods here are adapted from **Harold Boll's** MATLAB QC scripts (`doQCpfA.m` —
single-profile QC; `doQC2charsets.m` — two-measurement-set comparison). Attribution
retained per method origin.

## Delivered (2026-07)

Implemented in `public/index.html` and verified headless. All ported from the Boll
scripts:

1. **Primaries/overprints sub-tables** — Data Table + Comparison Table (collapsible,
   default-closed; columns match the parent tables). Paper white included in
   char-vs-char compare.
2. **Duplicate-patch count + repeatability ΔE** — Dataset box line.
3. **Percentiles (P90/P95) + per-channel ΔE breakdown** — under the histogram in
   Comparison Statistics (Included/Excluded/Only per ink).
4. **Near-Neutral Survey** — char data **and** ICC (evaluated test set).
5. **Comparison Plot** — ΔE vs L\* and ΔE vs distance-from-neutral.

Outstanding housekeeping: new i18n strings are **English-only** pending the 11-locale
+ `translations/Eng-*.xlsx` sync.

---

## TODO #1 — Gamut volume — chardata side DELIVERED (2026-07); profiletool side pending

**Source:** used by *both* Boll scripts (`doQCpfA` gamut volumes per intent;
`doQC2charsets` two-gamut volumes + intersection).

### Delivered in chardata (2026-07)

**Method — WASM boundary voxelisation + flood-fill** (`gamut-wasm/gamut-wrapper.cpp`
`gamutVolumeModel` / `gamutVolumeIcc`; `public/gamut.js` `Gamut.gamutVolume{Model,Icc}`
+ `volumeParams`; UI in `public/index.html` `ensureGamutVolume` / `renderGamutVolume`).
Volume = ΔE*ab³ enclosed by the gamut boundary.

The originally-planned primitives were **empirically disproven** (see also the
scratchpad tests) — do not revisit them:
- **Signed-tetra on `cachedMesh`: fails.** The display mesh is a union of separately
  triangulated device-cube boundary patches — not watertight, not consistently wound,
  self-overlapping at high ink counts. Volume swings 20–160% with reference point.
- **Convex hull of the point cloud: +30–50% on CMYK** (fills the gamut's concavities).
- **Star-|tetra| to centroid: +11–23% CMYK, ~3× at 7 inks** (mesh self-overlap).
- **Interior point-fill through the model: diverges** for char data — the fitted
  polynomial overshoots, so finer sampling keeps finding new Lab spikes.

So the shipped method samples only the device **2-skeleton boundary** → Lab, voxelises
into a fixed Lab grid, **dilates** to seal sampling gaps, **flood-fills** the exterior,
then **erodes** the exterior back by the dilation amount to cancel its bias. Enclosed
cells × voxel³ = volume. Bounds the volume by the shell (interior overshoot spikes poke
*outside* and are flooded away), so it **converges** for both ICC and polynomial models.
`volumeParams(N)` bounds boundary samples (~180k) and picks voxel size + dilation by
colorant count. Fast: CMYK ICC ~250–320 ms, CMYK char ~700 ms, 7-colour ~2.4 s; cached
per slot keyed by model identity (char) or handle+intent (ICC).

**Accuracy caveat (important):**
- **ICC = exact** (real A2B map). Per rendering intent — each intent maps a genuinely
  different gamut (e.g. swop: Absolute 389k, Perceptual 617k, Saturation ~650k). Correct.
- **Char data = "modeled".** It measures the *fitted polynomial model's* gamut shell,
  which overshoots the measured data — proven: the model-shell volume (FOGRA53 703k)
  exceeds even the **convex hull of the measured points** (608k), which is geometrically
  impossible unless the model boundary lies outside the data. The displayed 3D shell
  overshoots identically (same model boundary), so the number is *consistent with what's
  drawn* but not the physical measured gamut. UI tags char volumes **"modeled"** with a
  tooltip. Voxelisation adds a further ~5–10% surface bias (vs-dependent), consistent
  across datasets so A-vs-B comparisons stay fair.

**UX (as shipped):** Explore → readout in the 3D-Plot section **and** the 2D-slice
section (dataset A). Compare → A/B volumes + Δ% at the top of the Comparison Table
(A blue / B orange, char tagged "modeled"). Measurement-only / CxF-X4 (no model) →
no volume. `Δ` = (B−A)/A. Intersection volume (`doGamutsIntersect`) still **deferred**.

i18n: `gamut_*` keys are **EN-only** (11-locale + xlsx sync outstanding, same follow-up
pass as the QC + guide strings).

### profiletool side — engine port DONE (2026-07); Analysis-tab UI pending

**iccviz engine port DELIVERED.** `iccviz::GamutVolume(CIccProfile*, aToBTag, intent, …)`
in `~/code/profiletool/iccviz/IccVizModel.{hpp,cpp}` — same boundary voxelisation +
dilate + flood-fill + erode, but the device→PCS boundary eval uses **IccProfLib**
(`CIccXform::Create(pIcc, tag, bInput=true, intent, icInterpLinear)` → `Apply` →
`icLabFromPcs` / `icXyzFromPcs`+`icXYZtoLab`); device values **0..1** (not lcms2's 0..100).
A standalone function — deliberately NOT a new `Kind`, so it does not leak into the shared
`Enumerate()` that chardata's icc-viewer also consumes. Per-intent via (AToB tag × intent):
perceptual=A2B0/0, relative=A2B1/1, saturation=A2B2/2, absolute=A2B1/3.

**Binding + JS:** `validator-wasm/plot-wrapper.cpp` exposes `gamutVolume(bytes, tagSig,
intent)` (profiletool-only — chardata's copy of plot-wrapper is untouched);
`frontend/src/lib/vizPlot.js` exports `gamutVolume(bytes, tagSig, intent)`. iccplot WASM
rebuilt against clean iccDEV master (`/tmp/iccdev-clean` worktree, then removed).

**Verified** vs chardata's lcms2 reference (swop, S=48, vs=2): colorimetric intents match
to ~1% (absolute −1.0%, relative −0.9%). Saturation: iccviz is tag-faithful (swop's A2B2 ≡
A2B1, confirmed via evaluateTag → same volume; lcms2's differing saturation is its own CMM
behaviour). Perceptual −8.6% (legitimate lcms2-vs-IccProfLib perceptual-table difference).
Fast: ~100–300 ms/intent.

**Still pending:** the profiletool **Analysis-tab React UI** — an `AnalysisPanel.jsx`
section calling `gamutVolume(bytes, tag, intent)` for the profile's AToB tags/intents and
displaying the per-intent volumes (alongside the InkReversal / Neutral sections); gate on
an AToB-bearing profile class (`isOutput`). Not started.

---

## TODO #2 — B2A round-trip ΔE (Lab → device → Lab accuracy)

**Source:** the headline accuracy metric in `doQCpfA.m` ("Accuracy of B2A1 Relative
Colorimetric transform: Roundtrip of Lab"). Profile-only. Exists in neither tool.

**DECISION (updated 2026-07):** implement **in profiletool only — NOT in chardata.** The
computation can live in iccviz as a **standalone function** (same isolation pattern as #1's
`GamutVolume` — a plain function, NOT a `Kind`, so it never enters the shared `Enumerate()`
that chardata's icc-viewer consumes) surfaced through a **profiletool-only** binding in
`validator-wasm/plot-wrapper.cpp` + `vizPlot.js`, with the **UI in profiletool's Analysis
tab**. chardata gets nothing for #2 — no chardata binding, no chardata UI. Rationale:
iccviz already has bidirectional transform evaluation (IccProfLib `CIccXform`, both A2B and
B2A); the round-trip is wiring + a ΔE\*ab helper (iccviz has no ΔE today); profile-only;
and profiletool is the natural home for a single-profile accuracy metric alongside PAWG.

**Design (from `doQCpfA.m`)**
- Test points start in **Lab (PCS)**, not device space, and must be guaranteed in-gamut.
  Boll's scheme: 32 constant-L\* slices spanning a trimmed L\* range (below the highlight
  tip, above the shadow tip); at each slice, ~64 points on the profile's own gamut
  boundary + 3 chroma-eroded rings (×0.8/0.5/0.2 toward neutral) + a neutral point ≈ 256
  pts/slice ≈ 8k total.
  - *iccviz simplification to consider:* seed by sampling the **device** space on a grid,
    push through **A2B** to obtain in-gamut Lab (guaranteed valid), then round-trip those.
    Avoids needing a constant-L\* gamut-boundary generator up front.
- Round trip: `Lab1 --B2A(intent)--> device --A2B(intent)--> Lab2`; ΔE = ΔE\*ab(Lab1,Lab2).
- Report: mean / std / **P90** / max + histogram, optionally binned by L\* (as Boll does).
- New iccviz pieces: a ΔE\*ab helper (iccviz has **no** ΔE today) and the round-trip loop;
  reuse existing `CIccXform` build/apply. New `IccVizModel` Kind (e.g. `RoundTripDE`).

---

## Attribution

QC methods (delivered + #1/#2) adapted from **Harold Boll's** characterisation/profile
QC scripts. The `InkReversalL` visualization already in iccviz is likewise attributed to
Harold Boll — these belong to the same body of work.

---

## Appendix — #1 difficulty/risk: iccviz-shared vs. separate

**Architecture facts that drive this:**
- chardata has **two** WASM modules: `chardata-gamut` (lcms2; all gamut mesh/slice math,
  and the only place that can touch **char-data clouds** — no ICC needed) and
  `icc-viewer` (IccProfLib + the linked **iccviz** engine; ICC-only).
- iccviz is **2D-only** today (chromaticity + gamt raster); it has no 3D gamut hull and
  no volume, and depends on IccProfLib for transforms.
- profiletool consumes iccviz; it needs volume for **ICC profiles only**.
- chardata needs volume for **both** char-data clouds **and** ICC profiles.

**Option A — shared primitive in iccviz**
- *Pros:* one C++ implementation of the volume geometry; profiletool + chardata's ICC
  path could both call it.
- *Cons / risk:*
  - iccviz still needs a **new 3D boundary generator** (it has none) — the bulk of the
    profiletool work exists either way.
  - chardata's char-data clouds have **no ICC profile**, so iccviz (IccProfLib-based)
    cannot generate their boundary — chardata must compute those volumes **outside**
    iccviz regardless. So "shared" cannot cover chardata's full requirement.
  - chardata's mesh lives in `chardata-gamut`, a **different WASM module** from the one
    linking iccviz. Reusing an iccviz volume fn means marshaling vertex arrays across
    module boundaries in JS (extra copy + glue), or moving mesh generation into iccviz
    (large change; also swaps chardata's transform backend from lcms2 → IccProfLib for
    gamut, risking result drift vs. today's meshes).
  - Net: sharing the ~30-line primitive saves little while adding cross-module plumbing
    and a boundary-backend mismatch.

**Option B — separate (recommended)**
- chardata: add volume in **JS on the existing `cachedMesh`** (signed-tetrahedra sum) +
  a convex-hull volume for measurement clouds. Self-contained; no new WASM export
  strictly required; works for both data types; zero cross-module plumbing. **Low risk.**
- iccviz/profiletool: implement a fresh **3D gamut boundary sampler + volume primitive**
  in iccviz C++ (new `IccVizModel` Kind) + Analysis-tab UI. This is new work, but it is
  **the same work Option A requires anyway**; the only duplication is the tiny geometry
  primitive (JS vs C++, different runtimes).
- *Risk:* the volume primitive exists in two languages — but it is small, stable, and
  independently testable; divergence risk is negligible if both use the same
  signed-tetrahedra formula and are unit-checked against a known solid (e.g. a cube).

**Recommendation:** **Option B.** Do #1 separately. Sharing via iccviz doesn't reduce
chardata's work (char-data clouds + cross-module split) and introduces a
backend-mismatch/marshaling risk; the shared surface (a ~30-line hull/tetra-volume) is
too small to justify it. Keep #2 in iccviz (bidirectional transforms already there);
keep #1's geometry local to each tool.
