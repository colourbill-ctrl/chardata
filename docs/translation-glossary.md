<!-- (c) 2026 William Li -->

# Translation glossary & work estimate

Notes captured 2026-05-20 while scoping a translation pass for `MANUAL.md` into
the 11 non-English locales that the app already supports. **Work is deferred** —
this document is a placeholder so the analysis isn't lost when we come back to it.

## Scope

- Source: `MANUAL.md` — 499 lines, ~4,958 words, ~31 KB. Plain markdown with a
  handful of inline `<a>` / `<div class="note">` blocks. Auto-built into
  `public/help.html` by `scripts/generate-help.js` via a pre-commit hook.
- Targets (English is source): **fr, de, it, es, pt-PT, pt-BR, sv, zh-CN,
  zh-TW, ja, ko** — 11 locales, listed in `public/index.html` under
  `#lang-select`.
- Total volume across all locales: ~55,000 translated words + same QA volume.

## Cost / effort matrix

| Approach | Cost | Wall time | Quality risk |
|---|---|---|---|
| LLM batch (Claude/GPT-4-class), no human pass | ~$5–20 API total | 1 evening | High — colour-science terms drift, inline HTML occasionally mangled |
| LLM batch + native-speaker spot-review per locale | ~$100–200/locale → **$1.1–2.2k total** | 2–3 weeks elapsed | Medium |
| Professional technical translator (colour/print domain) | $0.12–$0.20/word → ~$650–$1k per locale → **$7–11k total** | 4–6 weeks | Low |

Recommended path: **LLM batch + glossary + native-speaker spot-check on the 4
highest-traffic locales (zh-CN, ja, de, es)**. ~2–3 days of work + ~$400–800 in
reviewer fees + ~½ day plumbing.

## Engineering plumbing (one-time, ~½–1 day)

Independent of which translation path is chosen:

1. **Pipeline**: `scripts/generate-help.js` currently emits one `help.html`.
   Needs to loop over `MANUAL.{lang}.md` → `public/help.{lang}.html`
   (or `public/help/{lang}/index.html`).
2. **Launcher**: the three `window.open('help.html', '_blank')` call sites
   (`#help-btn`, `#mobile-help-btn`, and the `?` button under ⚙) need to read
   the current `lang-select` value and open `help.{lang}.html`, falling back
   to `help.html` when a translation is missing.
3. **Pre-commit hook**: extend the existing MANUAL.md auto-regen so any
   `MANUAL.*.md` change regenerates all `help.{lang}.html` files.
4. **Glossary file**: ship `docs/translation-glossary.csv` (or .json) and have
   the LLM prompt reference it as a hard-replace list before translation.
5. **Inline HTML preservation**: the manual contains raw `<a style="…">` and
   `<img>` tags — translators (human or LLM) must leave attributes/URLs
   untouched. Add a regex sanity check (`href=` / `style=` counts must match
   between source and target).

## Ongoing cost

Every `MANUAL.md` edit invalidates 11 translations. Realistic options:

- **Per-edit retranslation** of just changed paragraphs (LLM-cheap).
- **Stale banner** at the top of non-English `help.html` when the source has
  changed since last sync.

## Coverage check vs existing app I18N

The app's `I18N` table in `public/index.html` already carries ~155 translated
keys × 12 locales (lines 1229–3111). Cross-correlation with the manual:

| Bucket | Count |
|---|---|
| Manual terms already translated in UI I18N | ~38 |
| Manual terms with no I18N counterpart | ~32 |
| Manual terms that are proper nouns / code (no translation) | ~25 |
| Inconsistencies / questionable existing translations | 8 |

### Reusable from existing I18N (~38 terms)

Pull verbatim from `I18N[locale]` — same translation, no new decisions:

`settings` · `de_method` · `filter_dups` · `filter_method` · `illuminant`
· `std_observer` · `m_condition` · `rendering_intent_label` · `intent_perceptual`
· `intent_relative_colorimetric` · `intent_saturation` · `intent_absolute_colorimetric`
· `show_shell` (gamut shell) · `gamut_slice` · `color_hue` · `color_value`
(lightness) · `tone_value` · `tone_method` · `spectral_md` (Murray-Davies)
· `ctv` · `transfer` · `gain` · `tone_value_gain` · `reflectance`
· `device_colorants` · `comparison_table` · `data_table` · `estimate`
· `model` · `nearest_dataset` · `weighted` · `image_detail_*` · `image_tab`
· `paper_white_missing` · `g7_*` · `file_select` · `explore` · `compare`
· `display_file` · `icc_launch_editor`.

### Manual-only terms needing new glossary entries (~32 terms)

**Colour metrics & differences:** chroma (C\*), hue distance (ΔH\*),
hue-angle difference (Δh\*), lightness difference (ΔL\*), chroma difference
(ΔC\*), CIE 1976/1994/2000 wording around ΔEab/ΔE94/ΔE00, "perceptually
uniform", "weighted by chroma".

**Patches & data:** patch / test patch / patch set, characterisation dataset
(BE/AE spelling choice), test chart, spectrophotometer, spectral reflectance
(phrase), primary tone ramp / tonal ramp / tonal response, paper white,
K solid / CMY solid / solids, patch cloud / scatter cloud / point cloud,
IT8.7/5 patch set, N-colorant / 5-colorant / 7-colorant (CMYKOGV),
decimal-aligned.

**Printing & process:** dot gain / dot loss (UI has "Gain" but not "dot gain"),
ink% / ink percentage, tonal response, status densitometer / densitometer
filter (T/E/I/A), spectral density, G7 grey balance / G7 System ADS.

**ICC / pipeline:** A2B (device-to-Lab) transform, device class
(Output/Input/Display), device color space, virtual dataset, alphahull mesh,
"evaluated on demand".

**UI feature names (manual references, no I18N key):** drag-and-drop,
"Standard datasets" section, gear icon, Computing badge, "Generate model" /
"Regenerate" (UI has `regen` only).

**Image gamut pipeline:** spatial averaging, ΔE-radius deduplication, bin grid,
channel count, device pixels, colorant family.

**Workflow verbs:** load / loaded / load order, bind / binding, match /
matched patches, fit / refit / fitting, evaluate / re-evaluate.

→ ~32 new entries × 11 target locales = **~350 anchored term decisions**, plus
inheritance rules (zh-CN ⇒ zh-TW with traditional-char swap; pt-PT ⇒ pt-BR with
locale-specific overrides).

### Proper nouns / code — keep verbatim

`CGATS`, `IT8`, `P2P`, `ECI2002`, `IT8.7/5`, `FOGRA`, `IFRA`, `APTEC`,
`ISO 15339`, `CRPC`, `EUROSB`, `JapanColor`, `IDEAlliance`, `ISO 20654`,
`ISO 28178`, `iCCP`, `APP2`, `ICC_PROFILE`, `ICCBased`, `DeviceGray`,
`DeviceRGB`, `DeviceCMYK`, `PhotometricInterpretation`, `YCCK`, `DCTDecode`,
`FlateDecode`, `Predictor`, `PNG`, `JPEG`, `TIFF`, `BMP`, `GIF`, `PDF`,
`L*`, `a*`, `b*`, `C*`, `h*`, `D50`, `D65`, `M0`, `M1`, `M2`, `ΔE`, `ΔE00`,
`ΔE94`, `ΔEab`.

## Inconsistencies in existing I18N — fix BEFORE extending to manual

If we translate the manual against the current UI strings, these errors
propagate into ~30+ manual occurrences and harden into a much larger surface.
Fix in one `public/index.html` edit (~30 min) before starting any manual work.

| # | Locale | Term | Current | Concern | Suggested |
|---|---|---|---|---|---|
| 1 | zh-CN / zh-TW | device colorants | 设备色度 / 設備色度 | "色度" = chromaticity, not colorant — semantic error | 设备着色剂 / 設備著色劑 (or 设备色料) |
| 2 | ja | Standard Observer | 等色関数 | "Colour-matching function" — not the same as observer | 標準観測者 |
| 3 | es | lightness (color by value) | brillo | "brillo" = brightness, not L\* lightness | luminosidad |
| 4 | es | gamut shell | capa del gama | "capa" = layer, "gama" missing -t | envolvente del gamut |
| 5 | es | Rendering intent | Propósito de representación | Industry term is "Intención de renderizado" | Intención de renderizado |
| 6 | fr | gamut shell | coquille gamut | "coquille" awkward in print context | enveloppe du gamut |
| 7 | de | Gain (standalone) | Gewinn | "Gewinn" = profit; print industry uses "Zuwachs" | Zuwachs (matches "Tonwertzuwachs" used elsewhere) |
| 8 | pt-PT vs pt-BR | tone value, rendering intent | Drift between PT/BR | Document intent or unify | Pick lead variant per term, note in glossary |

## When picking this up later

1. Fix the 8 flagged UI strings in `public/index.html` (single commit).
2. Build `docs/translation-glossary.csv` with columns `term, en, fr, de, it,
   es, pt-PT, pt-BR, sv, zh-CN, zh-TW, ja, ko` — pre-fill the 38 reusable rows
   from `I18N`, then add the 32 new rows.
3. Native-speaker spot-check the 8 flagged + 32 new terms in the 4 priority
   locales (zh-CN, ja, de, es).
4. LLM-batch translate `MANUAL.md` against the locked glossary.
5. Wire `scripts/generate-help.js` and the three `window.open('help.html')`
   call sites for per-locale help.
