# CharData User Manual

CharData is a browser-based tool for loading, exploring, and comparing colour characterisation datasets — the kind produced by measuring a printed test chart (e.g. IT8, P2P, ECI2002) on a spectrophotometer.

**CharData** is a browser-based tool for exploring and comparing colour characterisation datasets and ICC profiles. It runs entirely in your browser with no installation required, and works on both desktop and mobile.

A characterisation dataset typically associates device ink percentages (CYAN, MAGENTA, YELLOW, BLACK, and any additional colorants) with measured L\*a\*b\* colorimetry and, optionally, spectral reflectance. CharData accepts these files in **CGATS/IT8** and **CSV** formats. CharData also accepts **ICC profiles** (output, input, and display classes) and treats them as virtual datasets evaluated through their A2B (device-to-Lab) transform.

**What you can do with CharData:**

- **Explore a single dataset or profile** — browse the data table, visualise the colour gamut in 3D L\*a\*b\* space, examine a 2D slice at any L\*, a\*, or b\* value, analyse tonal response (tone value / dot gain) per colorant, check G7 grey balance compliance, and fit a polynomial model to predict L\*a\*b\* for any device colorant combination.
- **Compare two datasets, two profiles, or one of each** — see a row-by-row ΔE / ΔL\* / ΔC\* / ΔH\* / Δh\* table for matched patches, with summary statistics (mean, min, max, std dev), and view both gamuts and tone value curves overlaid on the same charts.
- **Work with spectral data** — if spectral reflectance columns are present, CharData computes L\*a\*b\* from them using a selectable illuminant (D50/D65), observer (2°/10°), and M-condition (M0/M1/M2), and can display the spectral curve for any clicked data point.
- **Switch rendering intent** — for ICC profiles, change between Perceptual / Relative Colorimetric / Saturation / Absolute Colorimetric and have every view (3D shell, 2D slice, comparison table, tone curves, estimate) recompute against the new transform.

The suggested workflow is to load an entire directory of characterisation files via the File Select panel, then pick individual files to explore or compare.

---

## Contents

1. [File format](#1-file-format)
2. [Loading datasets](#2-loading-datasets)
3. [Settings panel](#3-settings-panel)
4. [Explore mode](#4-explore-mode)
   - [Data table](#4-1-data-table)
   - [G7 report](#4-2-g7-report)
   - [3D Gamut plot](#4-3-3d-gamut-plot)
   - [2D Gamut slice](#4-4-2d-gamut-slice)
   - [Estimate section](#4-5-estimate-section)
   - [Tone Value](#4-6-tone-value)
5. [Compare mode](#5-compare-mode)
   - [Compare table](#5-1-compare-table)
   - [3D Gamut plot (Compare)](#5-2-3d-gamut-plot-compare)
   - [Tone Value (Compare)](#5-3-tone-value-compare)
6. [Mobile](#6-mobile)

---

## 1. File format

CharData accepts **CSV** and **CGATS/IT8** text files. CGATS is also published as **ISO 28178** — these are the same format.

### Required columns

Every file must contain L\*a\*b\* columns and at least one device colorant column:

| Column | Description |
|---|---|
| `LAB_L` | CIE L* |
| `LAB_A` | CIE a* |
| `LAB_B` | CIE b* |
| *(colorant)* | At least one device colorant column (e.g. `CYAN`, `7CLR_1`) |

Files with spectral data but no pre-computed LAB columns are also accepted — CharData computes L\*a\*b\* from the spectral data automatically (see [Settings — Spectral → LAB](#spectral-lab)).

### Device colorant detection

Any column that does not match a known non-colorant pattern is treated as a device colorant. The following are **excluded** from colorant detection:

| Pattern | Examples |
|---|---|
| `LAB_*` | `LAB_L`, `LAB_A`, `LAB_B` |
| Spectral wavelength columns | `NM380`, `380_NM`, `SPECTRAL_NM380` |
| `SAMPLE*` | `SampleID`, `SAMPLE_NAME` |
| `XYZ_*` | `XYZ_X`, `XYZ_Y`, `XYZ_Z` |
| `D_*` | `D_RED`, `D_GREEN` |
| `DENSITY*` | `DENSITY_V` |
| `STATUS_*` | `STATUS_T` |
| `COLOR_NAME`, `COLOR_INDEX` | |

Everything else — `CYAN`, `MAGENTA`, `7CLR_1`, `ORANGE`, etc. — is classified as a device colorant.

If all colorant values in the file are in the range \[0, 1\], they are automatically scaled ×100 to the \[0, 100\] range on load.

### Column name aliases

The following column names are automatically remapped on load:

| File column | Treated as |
|---|---|
| `CMYK_C` | `CYAN` |
| `CMYK_M` | `MAGENTA` |
| `CMYK_Y` | `YELLOW` |
| `CMYK_K` | `BLACK` |

### Spectral data

If the file contains spectral reflectance columns (named `NMxxx`, `NM_xxx`, or `SPECTRAL_NMxxx`, where `xxx` is the wavelength in nm), CharData can compute L\*a\*b\* from the spectral data instead of using the file's pre-computed LAB values. See [Settings — Spectral → LAB](#spectral-lab).

### ICC profiles

CharData also accepts ICC profiles (`.icc`, `.icm`). A file is recognised as an ICC profile by checking for the `acsp` signature at byte offset 36 of the binary header — files that don't carry that magic are rejected.

| Supported | Notes |
|---|---|
| Output / Input / Display class | Other classes (link, abstract, etc.) are rejected |
| CMYK, CMY, RGB, GRAY device color spaces | Other spaces are rejected |
| All four ICC rendering intents | Only those actually present in the profile are selectable; unsupported intents are greyed out |

When a profile loads, CharData treats it as a virtual dataset evaluated on demand through the profile's A2B (device-to-Lab) transform at the chosen rendering intent. CMYK profiles are pre-evaluated against the standard IT8.7/5 patch set so that 3D scatter clouds and ΔE comparisons against another dataset are immediate.

---

## 2. Loading datasets

Files (datasets and profiles) load through the **File Select** panel on the left edge of the screen.

- On **desktop**, click the narrow tab on the left edge of the screen to open/close the File Select panel. The panel slides over the content without resizing it. Drag the **right edge of the panel** (vertical grip dots) to widen or narrow it; the width is remembered across sessions.
- On **mobile**, tap the folder icon (bottom-right) to open/close File Select.

The panel is split into three collapsible sections:

| Section | Contains |
|---|---|
| **Standard datasets** | Built-in industry reference datasets (FOGRA, IFRA, APTEC, ISO 15339 / CRPC, EUROSB, JapanColor) shipped with the app. Click any entry to load it as if it were a local file — once loaded it appears in the Characterization data section below. Defaults to collapsed. |
| **Characterization data** | CSV and CGATS/IT8 files (your own or loaded from Standard datasets) |
| **ICC Profiles** | `.icc` / `.icm` binary profiles |

Click a section header (▾) to collapse or expand that section; the state persists between sessions. The button at the top loads files of either kind — CharData detects each file's type and routes it into the correct section automatically.

- **Drag and drop** files from your file system directly onto a Dataset panel or anywhere inside the File Select panel.
- **Drag a card** from the File Select panel onto Dataset A or Dataset B to assign it.
- **Click a card** to assign it to the next available slot (Explore mode → A; Compare mode → first empty of A / B).
- Click **Display File** (after a dataset loads) to view its data table. Display File is disabled for ICC profiles, which are binary.

Once a file loads, the slot panel shows:

| Type | Information shown |
|---|---|
| CSV | File name, type **CSV**, row count, validation, device colorants, spectral status |
| CGATS / ISO 28178 | File name, type **Characterization dataset**, row count, validation, device colorants, spectral status |
| ICC profile | File name, type **ICC Profile**, color space + colorants, **Rendering intent** dropdown |

Row counts, CGATS header warnings, and the "Colorimetric only" message are not shown for ICC profiles — they don't apply.

If a CSV/CGATS file is missing required columns (LAB or any device colorant), it is rejected with a specific error message. The G7 report additionally requires CMYK colorants. ICC profiles that fail header validation, or whose device class or color space is unsupported, are rejected with a matching message.

<div class="note">
<strong>CGATS header note:</strong> If the first line of a CGATS/IT8 file does not contain <code>CGATS</code> or <code>ISO28178</code>, a warning is shown but the file is still loaded and processed normally.
</div>

### Rendering intent

When a slot holds an ICC profile, the slot panel shows a **Rendering intent** dropdown directly below its colorants line. The default is **Absolute Colorimetric** (or the first intent the profile supports if Absolute is absent). Intents not encoded in the profile are greyed out.

Changing the intent immediately recomputes:
- The 3D gamut shell and IT8.7/5 patch cloud for that slot.
- The 2D gamut slice for that slot.
- The Comparison Table, all difference columns, and the summary statistics (in Compare mode with both slots loaded).
- The Tone Value chart (the Y-axis range is recomputed against the new data).
- The Estimate prediction (re-evaluates on the next slider move).

The Rendering intent control is only visible when the slot holds an ICC profile.

---

## 3. Settings panel

Open Settings by clicking the **⚙** button on the right edge of the screen (or the gear icon on mobile). The Settings panel slides over the content without resizing it. A **?** help button sits directly below ⚙ and opens this help page in a new tab.

### ΔE Method

Selects the colour difference formula used throughout the app.

| Option | Description |
|---|---|
| ΔEab | CIE 1976 — simplest, less perceptually uniform |
| ΔE94 | CIE 1994 — weighted by chroma |
| ΔE00 | CIE 2000 — most perceptually uniform, industry standard |

The selection is remembered between sessions. Changing the method immediately updates the Compare table and the Estimate fit statistics (without refitting the model).

### Filter Duplicates

When **Yes**, rows with identical device colorant values are collapsed into a single row, with L\*a\*b\* values averaged. Useful when a test chart contains repeated patches.

- **Filter Method** — choose **Median** (default, more robust to outliers) or **Mean**.

The row count shown in the dataset panel reflects the deduplicated count.

### Spectral → LAB

Controls how L\*a\*b\* is derived when spectral columns are present. These settings have no effect on files without spectral data.

| Setting | Options |
|---|---|
| Illuminant | D50 (default), D65 |
| Standard Observer | 2° (default), 10° |
| M-Condition | M0 (default), M1 (forces D50), M2 (UV cut) |

Changing any of these settings immediately reprocesses all loaded spectral files.

### Model

Controls how the polynomial model in the [Estimate section](#4-5-estimate-section) is fitted to the dataset.

| Option | Description |
|---|---|
| Weighted: Off | Ordinary least-squares — all patches contribute equally to the fit |
| Weighted: On | Iteratively reweighted least-squares — patches with large residuals are progressively down-weighted, making the model more robust to outlier patches |

### Background

Switches the app between **Light**, **Dark**, and **System** (follows OS preference) themes.

### Language

Overrides the interface language. **System default** detects the browser locale and selects the closest supported language automatically. Available languages: English, Français, Deutsch, Italiano, Español, Português (PT), Português (BR), 中文（简体）, 中文（繁體）, 日本語, 한국어.

---

## 4. Explore mode

Explore mode works with a single slot (A) holding either a characterization dataset or an ICC profile. Select it with the **Explore** button at the top.

When the slot holds an ICC profile, Explore shows a profile summary panel (color space, device class, available rendering intents, colorant list) and — for CMYK profiles — an optional table of the profile's IT8.7/5 patch evaluations at the current rendering intent.

### 4.1 Data table

Click **Display File** in the Dataset A panel to open a sortable table of all rows.

- Click any column header to sort ascending; click again to sort descending.
- Columns shown: all device colorants, then L\*, a\*, b\*.

### 4.2 G7 report

The G7 section (below Data Table) analyses the dataset against the IDEAlliance G7 System ADS target patch values (P2P chart, Appendix A). It requires CMYK colorants plus LAB.

The report shows measured vs target L\*a\*b\* for key patches (paper white, K solids, CMY solids, and tonal ramps), plus ΔE for each.

### 4.3 3D Gamut plot

Displays the dataset's colour gamut in CIE L\*a\*b\* space.

#### Controls

The main control panel (above the plot) contains global settings. Each dataset also has its own gear icon (⚙) in the plot legend for per-slot overrides.

| Control | Description |
|---|---|
| Show gamut shell | Renders an alphahull mesh enclosing the gamut surface |
| Show data points | Shows individual scatter points |
| Color by hue angle | Colours points/shell vertices by hue angle |
| Color by value | Colours points/shell vertices by L* (lightness) |
| Shell opacity | Slider for shell transparency |
| Show spectral data when point selected | Enables spectral reflectance popup on click |

When both global and per-slot checkboxes are visible, the global checkbox shows an **indeterminate** state when the two slots differ. Clicking the global checkbox sets both slots to the same state.

**Defaults differ by file type.** When a characterization dataset loads, the slot defaults to **gamut shell off, data points on**. When an ICC profile loads, the slot defaults to **gamut shell on, data points off** — profiles encode a continuous transform rather than a sample cloud, so the shell is the more meaningful representation. You can override either default with the per-slot checkboxes.

#### Spectral popup

If the dataset has spectral columns and **Show spectral data when point selected** is enabled, clicking a data point opens a popup showing the spectral reflectance curve for that patch.

#### Legend

Click any legend item to **toggle that trace on/off**. Hover for the tooltip.

### 4.4 2D Gamut slice

Below the 3D plot, the **Gamut Slice (2D)** section shows a cross-section of the gamut.

| Control | Description |
|---|---|
| Axis | Which axis to slice along: L\*, a\*, or b\* |
| Value | Position of the slice along the chosen axis (0–100) |
| Bandwidth ± | Half-width of the slice band; wider = more points included |

The slice updates live as you adjust the controls.

### 4.5 Estimate section

The **Estimate** section maps device colorants → L\*a\*b\* and lets you predict the L\*a\*b\* for any combination of colorant values.

- For **characterization datasets**, CharData fits a polynomial model to the data and uses it for prediction. The nearest actual patch in the dataset is shown alongside.
- For **ICC profiles**, prediction uses the profile's A2B transform directly at the current rendering intent — no polynomial fit is needed and no "Generate model" step is required.

#### Generating a model

Click **Generate model**. A blue **Computing** badge appears in the top-left corner of the screen while the fit runs (it may take a moment for large datasets). The badge also appears during other computationally intensive operations such as rendering the 3D gamut shell. If the fit fails, an error message and **Retry** button appear.

#### Model fitting strategy

- The fitter starts at degree 2 and steps up to a maximum of degree 5 (or the number of colorants, whichever is lower).
- At each degree, fit statistics are computed using the selected ΔE method.
- Fitting stops and keeps the best model found when a higher degree yields a worse fit (mean ΔE is the primary criterion, then std dev, then max).
- The degree falls back automatically if there are insufficient data points for a given degree.

#### Fit statistics

| Statistic | Description |
|---|---|
| Mean ΔE | Average colour error across all data points |
| Min ΔE | Best-case colour error |
| Max ΔE | Worst-case colour error |
| Std Dev | Spread of the error distribution |
| Points fitted | Number of rows used for the fit |

The model degree is shown next to "Model fit" above the stats.

#### Interactive prediction

Below the stats, a table allows you to dial in colorant values:

- **Sliders** and **number boxes** are linked — adjust either one.
- **Model** column shows the predicted L\*, a\*, b\* for the current colorant values.
- **Nearest in dataset** column shows the L\*, a\*, b\* (and colorant values) of the closest patch in the dataset by Euclidean distance in colorant space.

Click **Regenerate** to refit the model (e.g. after loading a new dataset). Note: changing the ΔE method in Settings updates the displayed statistics immediately without refitting — only click Regenerate if you want to refit from scratch using the new method's stopping criterion.

### 4.6 Tone Value

The **Tone Value** section analyses the tonal response of each primary colorant — how the printed tone value relates to the input ink percentage. It appears between the Data Table and Estimate sections.

#### Controls

A collapsible bar below the chart (click **▲** to collapse, **▼** to expand) contains:

| Control | Description |
|---|---|
| Tone Method | Murray-Davies (spectral density) or Colour Tone Value (CTV, ISO 20654) |
| Filter | Status densitometer filter: T, E, I, or A (Murray-Davies only) |
| Graph Type | Transfer — TV (%) vs ink%; or Gain — TV minus ink% |
| Colorant checkboxes | Toggle individual colorant curves on/off |

#### Tone Method

**Murray-Davies** computes tone value from spectral reflectance using a simulated densitometer filter. The channel used depends on the colorant:

| Colorant | Filter channel |
|---|---|
| CYAN | Red (R) |
| MAGENTA | Green (G) |
| YELLOW | Blue (B) |
| BLACK and others | Visual (V) |

Paper (lowest ink%) and solid (highest ink%) patches in the primary tone ramp are used as reference points.

**Colour Tone Value (CTV)** follows ISO 20654 and computes tone value from CIE L\* values only. No spectral data is required, but the dataset must contain a primary tone ramp for each colorant.

#### Graph types

**Transfer** — plots tone value (%) on the Y-axis against ink% on the X-axis. Ideal linear response is a straight diagonal from (0,0) to (100,100). Curves above the diagonal indicate dot gain; below indicate dot loss.

**Gain** — plots TV − ink% (percentage points) on the Y-axis. Zero is ideal linear response; positive values = dot gain; negative = dot loss. By definition gain is always zero at 0% and 100% ink.

#### Y-axis range

The Y-axis range is computed from the data for the current dataset, method, and filter combination, then fixed. In Gain mode the range is determined from interior tone steps only (excluding 0% and 100% endpoints), with padding for readability. The range is recalculated if the dataset, method, or filter changes.

#### Availability

Tone Value requires rows where only a single colorant is non-zero at a time (a primary tone ramp). Murray-Davies additionally requires spectral reflectance columns; if absent the chart prompts you to switch to CTV.

For ICC profile slots, CharData synthesises a primary ramp by evaluating the profile at fixed tint percentages (0, 5, 10, 15, 20, 25, 30, 40, 50, 60, 70, 80, 90, 95, 100) along each channel with all other channels at zero. Profiles have no spectral data, so only **CTV** works for ICC slots — Murray-Davies traces are skipped with a "no spectral" indicator. Changing the rendering intent re-samples the profile and re-fits the Y-axis range.

---

## 5. Compare mode

Compare mode loads two slots (A and B) and shows a row-by-row colour difference table. Select it with the **Compare** button at the top. Each slot can hold either a characterization dataset or an ICC profile; all four combinations are supported (data vs data, data vs ICC, ICC vs data, ICC vs ICC).

Matching depends on what's loaded:
- **data vs data** — rows are matched by device colorant values; rows where all colorants are zero are excluded. The union of both files' colorant columns is used as the matching key.
- **data vs ICC** — the dataset's rows drive the matching; for each row, the ICC profile is evaluated at the row's colorant values.
- **ICC vs ICC** — both profiles are evaluated against the standard IT8.7/5 patch set; both profiles must be CMYK.

### 5.1 Compare table

The table shows, for each matched patch:

- Device colorant values (decimal-aligned)
- For Dataset A: L\*, a\*, b\*, C\*, h\*(deg)
- For Dataset B: L\*, a\*, b\*, C\*, h\*(deg)
- **Difference** columns:
  - ΔE (using the selected method)
  - ΔL\* — lightness difference (L\*<sub>B</sub> − L\*<sub>A</sub>)
  - ΔC\* — chroma difference (C\*<sub>B</sub> − C\*<sub>A</sub>)
  - ΔH\* — geometric hue distance (chroma-weighted, computed via the selected ΔE method)
  - Δh\*(deg) — hue-angle difference, signed shortest-path in (−180°, +180°]

Columns are sortable by clicking the header. The same column set and decimal alignment applies for every Compare combination, including ICC slots.

#### Summary statistics

Above the table, a statistics box shows:

| Statistic | Description |
|---|---|
| Mean ΔE | Average colour difference across all matched patches |
| Min ΔE | Smallest colour difference |
| Max ΔE | Largest colour difference |
| Std Dev | Spread of colour differences |

#### Filters

The compare table includes filter controls to narrow down the rows shown:
- **Solids Only** — show only patches where all non-zero colorants are at 100%.

### 5.2 3D Gamut plot (Compare)

The 3D plot in Compare mode shows both slots overlaid in L\*a\*b\* space. Slot A is shown in blue, Slot B in red. All the same controls as Explore mode apply, with per-slot gear panels for independent control of each slot's shell / points / colour mode. Per-slot defaults still apply: ICC slots open with shell on / points off, characterization datasets with shell off / points on. Changing a slot's rendering intent rebuilds its 3D shell and patch cloud immediately.

### 5.3 Tone Value (Compare)

The Tone Value section also appears in Compare mode, below the Comparison Table. Both slots are plotted on the same chart: Slot A uses solid lines, Slot B uses dashed lines in a slightly darker shade of the same colour.

The controls bar includes two additional checkboxes — **Show Dataset A** and **Show Dataset B** — to toggle all curves from either slot at once.

All other controls (Tone Method, Filter, Graph Type, colorant checkboxes) work identically to [Explore mode](#4-6-tone-value). When either slot is an ICC profile, the chart auto-uses the CTV method for that slot; Murray-Davies traces from the ICC slot are skipped (no spectral data). The Y-axis range invalidates whenever a rendering intent changes so the curves stay correctly framed.

---

## 6. Mobile

On screens narrower than 700 px:

- The left File Select pane and right Settings pane collapse into drawers.
- Tap the **folder icon** (bottom-right) to open/close File Select.
- Tap the **⚙ icon** (bottom-right) to open/close Settings.
- Tap the backdrop to close any open drawer.
- The Ko-fi / info buttons scale down automatically.

All features are available on mobile; the layout adapts to the smaller screen.
