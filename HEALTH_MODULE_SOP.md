# Health Module Standard Operating Procedure (SOP) & Calculations Specification

This document serves as the single source of truth for the features, calculations, and logic rules implemented in the Health (Satellite Data Analysis) Module of the Cropin Dashboard.

---

## 1. Feature Overview & Domain Definitions
The Health Module aggregates satellite indices (primarily from Planet and Sentinel-2 providers) for agricultural plots to determine crop health anomalies. It operates in two configuration modes:
1. **Legacy Mode**: Computes deviations from historical normal categories (Greenness, Nutrient Uptake, Water Stress).
2. **Raw Index Mode (`HEALTH_INDICATORS_DISABLED` = true)**: Switches calculations to direct fractional index mean values (NDVI, NDRE, LSWI) and maps them to fixed mathematical ranges.
3. **Plot Risk (PR) Filtered API Execution**: Health data processing and all associated API requests (Sustainability, Satellite, and Germination) are dispatched exclusively for Plot Risk-enabled plots (`window.verifiedHealthPlots`). Plots without PR capability in the project are bypassed to eliminate unnecessary API requests and maintain strict consistency with PR verification.
4. **Script Execution Order (Important for Runtime Behavior)**: `aggregate_dashboard_backup.html` loads scripts as `api.js` (module) → `components/export_manager.js` (defer) → `aggregate_script_backup.js` (defer) → `Aggregate-Data-Testing/health_script.js` (classic script, **no `defer`**). Per HTML parsing rules, the non-deferred `health_script.js` actually executes **first**, synchronously mid-parse, before the deferred scripts run after the document finishes parsing. All Health-module functions (`formatHealthStatus`, `getHealthStatusColor`, `classifyValueToStatus`, `formatGerminationStatus`, `getGerminationColor`, `isWithinAnalysisWindow`, `getPrEnabledPlots`, `handleLoadHealthData`) exist only in `health_script.js` and are unconditionally authoritative — there is no naming collision with `aggregate_script_backup.js` for Health logic. (Note: 15 Yield-prediction helper functions *are* duplicated between the two files; see `YIELD_MODULE_SOP.md` for that collision's runtime implications — it does not affect the Health module.)

---

## 2. Mathematical Calculations & Classification Mappings

### A. Range Classifications (Raw Index Mode)
When `HEALTH_INDICATORS_DISABLED` is `true`, fractional values for NDVI, NDRE, and LSWI are mapped by `classifyValueToStatus(val)` / `getHealthStatusColor(status)` (`Aggregate-Data-Testing/health_script.js`) as follows:
| Value Range (Actual, Open-Ended) | Internal Category | UI Label Mapping | Hex Color |
| :--- | :--- | :--- | :--- |
| `>= 0.66` (no upper cap) | `Normal` | `0.66 - 1` | `#10b981` (Green) |
| `>= 0.33 and < 0.66` | `Early Symptoms Noted` | `0.33 - 0.66` | `#f59e0b` (Yellow) |
| `< 0.33` (no lower floor) | `Plots Need Attention` | `-1 - 0.33` | `#ef4444` (Red) |

**Note (corrected 2026-09-22)**: The code does not clamp values to `[0.66, 1.00]` or `[-1.00, 0.33)` as closed intervals — any value `>= 0.66` (even `> 1`) is classified `Normal`, and any value `< 0.33` (even `< -1`) is classified `Plots Need Attention`. The `1.00` and `-1.00` bounds shown in the UI Label Mapping are fixed display strings only, not enforced numeric caps.

*Internal Status Consistency*: The UI components (charts, legends, filters) store values using internal status keys (`'Normal'`, `'Early Symptoms Noted'`, `'Plots Need Attention'`) and translate them dynamically to ranges using `formatHealthStatus(status)` at render time.

*Untracked "No Data" Bucket (missing from prior SOP)*: Plots whose status resolves to `"-"`/`"No Data"` are counted internally in a `counts['No Data']` bucket but are excluded from the `categories` array used by both the KPI pie chart and legend table, so they never appear as a rendered slice/row and are excluded from "Plots Analyzed (Covered)" totals — although they remain reachable via the base table's category filter code path.

### B. Provider Priorities & Ties
* **Three independent UI toggles govern provider selection** (`getTargetProviderData()` in `health_script.js`):
  1. `health-sentinel-only-toggle` ("Use Sentinel Data Only (Bypass Planet)") — when checked, always returns the Sentinel value regardless of dates.
  2. `health-provider-preference-toggle` ("Show Provider Preference") — when checked (and Sentinel-only is not), always prefers Planet if present, falling back to Sentinel only when Planet is empty (`'-'`). *(Previously undocumented.)*
  3. **Default (neither toggle checked)**: Both providers are compared. If Planet's and Sentinel's capture dates fall on the **same calendar day** (Y/M/D match, not exact timestamp), **Planet is chosen**. If they fall on different calendar days, whichever provider's capture date is genuinely later (by day) is chosen as latest — **Sentinel wins if its capture day is later than Planet's**, contrary to a blanket "Planet is always prioritized."
* **Tie-break in the initial DESC sort of satellite records** (a separate code path from the toggle logic above, used before per-provider extraction) breaks ties only on **exact millisecond timestamp equality**, not same-calendar-day — in practice this rarely fires with real capture timestamps. The `L` (Latest) badge shown in the base details table (Section 3) uses a third, independent rule: a strict `sentinelDate > planetDate` timestamp comparison with no day-grouping or Planet preference. These three "who's latest" rules can disagree on the same row; none is used interchangeably with another.
* **Sentinel-only LSWI**: LSWI (Water Stress) is exclusively supported by Sentinel-2. Planet has no LSWI data.

### C. Analysis Window Logic
* **Window Duration**: Configured via **four independent** UI input fields — one per KPI category (`health-greenness-window`, `health-nitrogen-window`, `health-water-window`, `health-germination-window`), **each defaulting to 15 days**. There is no single global window and no `30`-day default anywhere in code or markup; the previous "or 30 days as requested" note was not implemented.
* **Date Range Bounds**: Started from today (inclusive) going back $N$ days.
  * Range: `[today - windowDays + 1, today]` (`isWithinAnalysisWindow()`).
  * Today's capture records are fully included.
* **Exclusion Classification**: Plots that are not harvested but fall outside the active analysis window date range are classified as `Excluded (<Status>)` and omitted from the active KPI aggregates (although they remain visible in the base details table).

### D. Harvest Filtering
Two **independent** checkboxes control harvested-plot visibility (not a single unified mechanism):
* **`health-include-harvested`** ("KPI" checkbox): Drives KPI/pie-chart aggregation counts. It only affects the **base details table** while a KPI category drill-down filter is currently active (`activeHealthFilter` set) — in that state, unchecking it filters harvested plots (`isHarvested === 'Yes'`) out of the table to align row counts with the KPI card counts.
* **`health-hide-harvested-base-table`** ("base table" checkbox): Independently filters the base details table directly **at all times**, regardless of whether a KPI drilldown is active — `displayResults = hideHarvested ? filteredResults.filter(r => r.isHarvested !== 'Yes') : filteredResults`.
* With no KPI drilldown active, base-table harvested-plot visibility is governed **solely** by `health-hide-harvested-base-table`, independent of the KPI checkbox's state.

### E. Germination KPI Mappings (Indicators Enabled Only)
* **Availability**: Germination is available **only when health indicators are present/enabled** (`HEALTH_INDICATORS_DISABLED` = false). It is completely hidden when they are disabled.
* **Loading Mechanism**: A checkbox wrapper (`id="health-load-germination-wrapper"`) is presented next to the Load Health Data button in the enabled mode. Hitting `/services/farm/api/plot-risk/germination` happens only if checked.
* **Consider only Planet Filtering**: A checkbox (`id="health-germination-only-planet"`) allows filtering the Germination Pie Chart and KPI summaries to only use Planet data, ignoring Sentinel entries. The base detail table drilldown row filtering respects this checked state to align table rows with chart categories, while the cell contents continue to present both providers for comparison.
* **Status & Color Mapping** (`formatGerminationStatus()`; value is lowercased and trimmed before comparison, so matching is case-insensitive, not a literal camelCase compare):
  * `'good'` / `'normal'` $\to$ `'Good'` (Green, `#10b981`)
  * `'moderate'` $\to$ `'Moderate'` (Yellow, `#f59e0b`)
  * `'needsattention'` (exact) or any value containing the substring `'attention'` $\to$ `'Need Attention'` (Red, `#ef4444`)

---

## 3. Previous Latest (PL) Logic
To provide a comparison timeline:
1. **Date Selection**: After sorting all valid capture records DESC (latest first), the PL record is selected by filtering out all records captured on the same calendar day as the latest record. The **first record from a strictly previous calendar day** is selected as the Previous Latest (`PL`) record.
   * **Correction (2026-09-22)**: There is no explicit "prefer Planet" step at the PL-selection stage. `plCandidates[0]` is simply the next record, in the already-DESC-sorted order, after same-day-as-latest records are removed — whichever provider's record is chronologically later (of the two, on that earlier day) is picked. Planet is only favored here as an inherited side-effect of the global sort's tie-break, which fires solely on **exact millisecond timestamp equality** (practically never with real capture times) — not a per-day Planet preference.
2. **Sentinel-only LSWI PL**: Because LSWI is Sentinel-only, the PL water stress value is extracted by filtering out all Sentinel records captured on the same calendar day as the latest Sentinel record. The **first Sentinel record from a strictly previous Sentinel calendar day** is selected as the PL water stress record. (Confirmed matching code.)
3. **UI Layout**:
   * **KPI Grid Columns**: Rendered as 3 columns (`repeat(3, 1fr)`) by default. If Germination is active and loaded, the grid adjusts to a symmetric **2x2 columns** (`repeat(2, 1fr)`) layout to provide ample space for cards to breathe.
   * Greenness / Nutrient / Germination columns: Display:
     * Planet: `P: <date> : <status_or_value>` + `L` badge if Planet is latest (or `P: -` if empty)
     * Sentinel: `S: <date> : <status_or_value>` + `L` badge if Sentinel is latest (or `S: -` if empty)
     * PL: `PL: <provider> : <date> : <status_or_value>` (or `PL: -` if empty)
   * Water Stress column: Displays:
     * Latest: `<date> : <status_or_value>` (no L badge, or `-` if empty)
     * PL: `PL: <date> : <status_or_value>` (no provider prefix, or `PL: -` if empty)

---

## 4. Change Log (Feature & Logic Audit Trail)
* **2026-08-07**: Implemented `HEALTH_INDICATORS_DISABLED` toggle mapping raw index means to status ranges.
* **2026-08-07**: Fixed color mapping boundary overlaps in `getHealthStatusColor` using range prefixes.
* **2026-08-07**: Integrated dynamic in-place table filtering upon clicking category KPI lists or pie slices.
* **2026-08-10**: Added the Previous Latest (PL) row calculation and cross-column status mappings.
* **2026-08-10**: Aligned base details table row visibility filters with the KPI include-harvested states to resolve count mismatch.
* **2026-08-10**: Refined LSWI PL extraction to pull from the 2nd Sentinel record instead of the overall 2nd capture.
* **2026-08-10**: Injected inline date metadata directly into PL status displays.
* **2026-08-11**: Updated analysis window bounds to start from today (inclusive) instead of yesterday.
* **2026-08-12**: Updated PL and PL LSWI calculations to filter out same-day captures, resolving overlap issues by forcing PL to always refer to a strictly previous calendar day.
* **2026-08-12**: Refined details table formatting to display formatted capture dates inline for all Planet and Sentinel status cells.
* **2026-08-12**: Added a compact inline `L` (Latest) badge next to the newest provider in Greenness and Nutrient cells, omitting it from Sentinel-only Water Stress.
* **2026-08-12**: Removed the redundant Capture Date column from the base details table to optimize screen layout space.
* **2026-08-12**: Integrated "Germination" Crop Health Risk KPI card and table column with conditional load checkbox beside the Load Health Data button.
* **2026-08-13**: Optimized the grid layout to a symmetric 2x2 style when Germination is selected to resolve layout squishing.
* **2026-08-14**: Added the "Consider only Planet" checkbox to the Germination card header to filter the pie chart, KPI counts, and active drilldown table rows exclusively to Planet data.
* **2026-09-01**: Restricted Health data loading (`handleLoadHealthData`) to execute exclusively against Plot Risk (PR) enabled plots (`window.verifiedHealthPlots`) instead of all project plots (`plotsData`), preventing API requests for non-PR plots and synchronizing batch processing indicators.
* **2026-09-22**: SOP Accuracy Audit — corrected drift between documented formulas and actual code (per the new SOP Update Constraint in `AGENTS.md`). No application code was changed; documentation only. Corrections: range classification bounds are open-ended (`>= 0.66` / `< 0.33`), not closed intervals; documented the previously-missing third provider toggle (`health-provider-preference-toggle`) and the same-calendar-day (not exact-tie) Planet preference rule, plus the separate exact-timestamp tie-break used by the initial sort and the independent strict-`>` rule used by the base-table `L` badge; corrected analysis window default to 15 days only (removed unimplemented "30 days") and documented that it is four independent per-category inputs, not one global window; split the single "Harvest Filtering" rule into its two actually-independent checkboxes (`health-include-harvested` vs. `health-hide-harvested-base-table`); clarified germination status matching is case-insensitive substring/exact matching on a lowercased+trimmed value, not a literal camelCase compare; corrected PL provider-priority claim (no explicit Planet-preference step at PL selection); documented the previously-missing "No Data" bucket exclusion from KPI totals/chart; documented actual script load order (`health_script.js` executes before `aggregate_script_backup.js` despite markup order) confirming no naming collision affects Health-module functions specifically.



