# Health Module Standard Operating Procedure (SOP) & Calculations Specification

This document serves as the single source of truth for the features, calculations, and logic rules implemented in the Health (Satellite Data Analysis) Module of the Cropin Dashboard.

---

## 1. Feature Overview & Domain Definitions
The Health Module aggregates satellite indices (primarily from Planet and Sentinel-2 providers) for agricultural plots to determine crop health anomalies. It operates in two configuration modes:
1. **Legacy Mode**: Computes deviations from historical normal categories (Greenness, Nutrient Uptake, Water Stress).
2. **Raw Index Mode (`HEALTH_INDICATORS_DISABLED` = true)**: Switches calculations to direct fractional index mean values (NDVI, NDRE, LSWI) and maps them to fixed mathematical ranges.

---

## 2. Mathematical Calculations & Classification Mappings

### A. Range Classifications (Raw Index Mode)
When `HEALTH_INDICATORS_DISABLED` is `true`, fractional values for NDVI, NDRE, and LSWI are mapped as follows:
| Value Range | Internal Category | UI Label Mapping | Hex Color |
| :--- | :--- | :--- | :--- |
| `[0.66, 1.00]` | `Normal` | `0.66 - 1` | `#10b981` (Green) |
| `[0.33, 0.66)` | `Early Symptoms Noted` | `0.33 - 0.66` | `#f59e0b` (Yellow) |
| `[-1.00, 0.33)` | `Plots Need Attention` | `-1 - 0.33` | `#ef4444` (Red) |

*Internal Status Consistency*: The UI components (charts, legends, filters) store values using internal status keys (`'Normal'`, `'Early Symptoms Noted'`, `'Plots Need Attention'`) and translate them dynamically to ranges using `formatHealthStatus(status)` at render time.

### B. Provider Priorities & Ties
* **Planet vs. Sentinel**: Both providers are analyzed. If capture records for both Planet and Sentinel are present on the same day:
  * By default, **Planet** is prioritized as the latest (unless Sentinel-only toggle is checked).
  * If capture dates are identical, the sorting priority ensures Planet is chosen.
* **Sentinel-only LSWI**: LSWI (Water Stress) is exclusively supported by Sentinel-2. Planet has no LSWI data.

### C. Analysis Window Logic
* **Window Duration**: Configured via UI input field (defaults to 15 days, or 30 days as requested).
* **Date Range Bounds**: Started from today (inclusive) going back $N$ days.
  * Range: `[today - windowDays + 1, today]`.
  * Today's capture records are fully included.
* **Exclusion Classification**: Plots that are not harvested but fall outside the active analysis window date range are classified as `Excluded (<Status>)` and omitted from the active KPI aggregates (although they remain visible in the base details table).

### D. Harvest Filtering
* **Hide Harvested Plots**: If a plot is flagged as harvested (`isHarvested === 'Yes'`), it can be filtered out.
* **KPI Alignment**: If the KPI include-harvested checkbox is off, the base details table filters out harvested plots to align row counts exactly with the KPI card counts.

### E. Germination KPI Mappings (Indicators Enabled Only)
* **Availability**: Germination is available **only when health indicators are present/enabled** (`HEALTH_INDICATORS_DISABLED` = false). It is completely hidden when they are disabled.
* **Loading Mechanism**: A checkbox wrapper (`id="health-load-germination-wrapper"`) is presented next to the Load Health Data button in the enabled mode. Hitting `/services/farm/api/plot-risk/germination` happens only if checked.
* **Status & Color Mapping**:
  * `good` / `normal` $\to$ `'Good'` (Green, `#10b981`)
  * `moderate` $\to$ `'Moderate'` (Yellow, `#f59e0b`)
  * `needsAttention` / contains `attention` $\to$ `'Need Attention'` (Red, `#ef4444`)

---

## 3. Previous Latest (PL) Logic
To provide a comparison timeline:
1. **Date Selection**: After sorting all valid capture records DESC (latest first), the PL record is selected by filtering out all records captured on the same calendar day as the latest record. The **first record from a strictly previous calendar day** is selected as the Previous Latest (`PL`) record (prioritizing Planet if both providers have data on that previous day).
2. **Sentinel-only LSWI PL**: Because LSWI is Sentinel-only, the PL water stress value is extracted by filtering out all Sentinel records captured on the same calendar day as the latest Sentinel record. The **first Sentinel record from a strictly previous Sentinel calendar day** is selected as the PL water stress record.
3. **UI Layout**:
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

