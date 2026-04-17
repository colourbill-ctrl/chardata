# CharData User Manual

CharData is a browser-based tool for loading, exploring, and comparing colour characterisation datasets — the kind produced by measuring a printed test chart (e.g. IT8, P2P, ECI2002) on a spectrophotometer.

---

## Contents

1. [File format](#1-file-format)
2. [Loading datasets](#2-loading-datasets)
3. [Settings panel](#3-settings-panel)
4. [Explore mode](#4-explore-mode)
   - [Data table](#41-data-table)
   - [G7 report](#42-g7-report)
   - [3D Gamut plot](#43-3d-gamut-plot)
   - [2D Gamut slice](#44-2d-gamut-slice)
   - [Estimate section](#45-estimate-section)
5. [Compare mode](#5-compare-mode)
   - [Compare table](#51-compare-table)
   - [3D Gamut plot (Compare)](#52-3d-gamut-plot-compare)
6. [Mobile](#6-mobile)

---

## 1. File format

CharData accepts **CSV** and **CGATS/IT8** text files. CGATS is also published as **ISO 28178** — these are the same format.

### Required columns

Every file must contain these seven columns (case-insensitive, any order):

| Column | Description |
|---|---|
| `CYAN` | Cyan device value, 0–100 |
| `MAGENTA` | Magenta device value, 0–100 |
| `YELLOW` | Yellow device value, 0–100 |
| `BLACK` | Black device value, 0–100 |
| `LAB_L` | CIE L* |
| `LAB_A` | CIE a* |
| `LAB_B` | CIE b* |

Additional columns (e.g. extra colorants, spectral data) are accepted and used where relevant.

### Column name aliases

The following column names are automatically remapped on load:

| File column | Treated as |
|---|---|
| `CMYK_C` | `CYAN` |
| `CMYK_M` | `MAGENTA` |
| `CMYK_Y` | `YELLOW` |
| `CMYK_K` | `BLACK` |

### Spectral data

If the file contains spectral reflectance columns (named `NMxxx`, `NM_xxx`, or `SPECTRAL_NMxxx`, where `xxx` is the wavelength in nm), CharData can compute L\*a\*b\* from the spectral data instead of using the file's pre-computed LAB values. See [Settings — Spectral → LAB](#spectral--lab).

---

## 2. Loading datasets

Files can be loaded via the **Dataset A** and **Dataset B** panels in the left pane (File Select).

- **Drag and drop** a file from your file system directly onto a panel, or
- Click **Display File** (after a file is loaded) to view its data table.

On **mobile**, tap the folder icon (bottom-right) to open the File Select pane.

Once a file loads successfully, the panel shows:
- File name
- File type (CSV / CGATS / ISO 28178)
- Number of rows (after deduplication, if enabled)
- Column validation result

If required columns are missing, a warning lists what is absent. The app still loads the file for viewing, but features that require the missing columns will be unavailable.

---

## 3. Settings panel

Open Settings by clicking the **⚙** button on the right edge of the screen (or the gear icon on mobile). A **?** help button sits directly below ⚙ and opens this help page in a new tab.

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

### Background

Switches the app between **Light**, **Dark**, and **System** (follows OS preference) themes.

---

## 4. Explore mode

Explore mode works with a single dataset (Dataset A). Select it with the **Explore** button at the top.

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

The **Estimate** section fits a polynomial model to the dataset, mapping device colorants → L\*a\*b\*. It allows you to predict the L\*a\*b\* for any combination of colorant values, and see the nearest actual patch in the dataset.

#### Generating a model

Click **Generate model**. A "Computing…" message is shown while the fit runs (it may take a moment for large datasets). If the fit fails, an error message and **Retry** button appear.

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

---

## 5. Compare mode

Compare mode loads two datasets (A and B) and shows a row-by-row colour difference table. Select it with the **Compare** button at the top.

Rows are matched by **device colorant values**. Rows where all colorants are zero are excluded. If the two datasets have different colorant columns, the union of both sets is used.

### 5.1 Compare table

The table shows, for each matched patch:

- Device colorant values
- L\*, a\*, b\* for Dataset A
- L\*, a\*, b\* for Dataset B
- ΔE (using the selected method)
- ΔH (hue difference)

Columns are sortable by clicking the header.

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

The 3D plot in Compare mode shows both datasets overlaid in L\*a\*b\* space. Dataset A is shown in blue, Dataset B in red. All the same controls as Explore mode apply, with per-slot gear panels for independent control of each dataset's shell/points/colour mode.

---

## 6. Mobile

On screens narrower than 700 px:

- The left File Select pane and right Settings pane collapse into drawers.
- Tap the **folder icon** (bottom-right) to open/close File Select.
- Tap the **⚙ icon** (bottom-right) to open/close Settings.
- Tap the backdrop to close any open drawer.
- The Ko-fi / info buttons scale down automatically.

All features are available on mobile; the layout adapts to the smaller screen.
