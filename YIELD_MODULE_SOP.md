# Yield & Harvest Module Standard Operating Procedure (SOP) & Calculations Specification

This document serves as the single source of truth for the features, calculations, logic rules, and data model hierarchies implemented in the Yield and Harvest Module of the Cropin Dashboard.

---

## 1. Feature Overview & Domain Definitions
The Yield and Harvest Module provides automated intelligence, validation, and analytics for expected, re-estimated (field-audited), and AI-predicted crop yield and harvest volumes.

It operates at two granularities:
1. **Plot Level**: Individual croppable area (CA) metrics, comparison between farmer configuration, field re-estimates, and remote AI model predictions.
2. **Aggregate Level**: Project-wide totals and area-weighted averages across all plots where prediction data is available (with an option to include non-predicted plots).

---

## 2. Yield Prediction Model Selection Hierarchy

The Yield Prediction API (`/services/farm/api/plot-risk/yield?caIds={caIds}`) may return multiple model records for a single plot in its `records` array (e.g., `TASUMI`, `BIOMASS_GDD`, `BIOMASS_DAYS`). The system implements a strict 3-rule model selection hierarchy to determine the authoritative prediction record for both plot-level data cards and project aggregate calculations:

### Strict 3-Rule Hierarchy
1. **Rule 1: Use `TASUMI` data as yield and harvest data if present**:
   - If a record with `modelType: "TASUMI"` (case-insensitive) is present, the system MUST select this record.
   - **Single Record Domain Invariant**: Upstream API responses will **always return at most a single `TASUMI` record per plot** (there will never be multiple `TASUMI` records). Code-level sorting or indexing `tasumiRecords[0]` is a defensive safety net.
   - **Crucial Key Constraint for TASUMI**: For `TASUMI`, remote sensing calculations strictly correspond to the `predictionDate` key (e.g. `2026-08-14`). Database record update timestamps (`modifiedDateTime`, e.g. `2026-09-04`) must NEVER override the model's actual `predictionDate`. The `predictionDate` is compared against the Biomass latest cutoff date when evaluating the `L` (Latest) badge in the base data table.
2. **Rule 2: If `TASUMI` is not present, use the latest `BIOMASS_DAYS` values (do not aggregate all biomass dates)**:
   - If no `TASUMI` record exists, the system checks for records with `modelType: "BIOMASS_DAYS"`.
   - If multiple `BIOMASS_DAYS` records exist, the most recent record (by timestamp DESC) is selected.
   - When extracting values from `BIOMASS_DAYS`:
     - If `gddPredictions` array is present (e.g., progression across multiple cutoff dates), the system extracts values exclusively from the **chronologically latest cutoff date** (sorted by `cutoff_date` ASC, taking the last entry).
     - **Explicit Constraint**: The system MUST NOT average or aggregate across all available biomass dates; it strictly takes the single latest cutoff date point.
3. **Rule 3: If none present, mark plot as NA and do not use for aggregation**:
   - If neither `TASUMI` nor `BIOMASS_DAYS` is present (e.g., only other models like `BIOMASS_GDD` exist, empty records array `[]`, or API error/disabled):
     - The plot's AI prediction model is marked as `'NA'`.
     - Plot-level predicted harvest and yield are marked as `'NA'`.
     - The plot is **strictly excluded from aggregate calculations** (`Agg AI Harvest Min/Max` and `Agg AI Yield Min/Max` weighted sums), and is excluded from total aggregate area and expected/re-estimated harvest totals (unless the user explicitly checks "Include plots without prediction in aggregate").

### Extracted Parameters
From the selected record (or latest cutoff date), the following metrics are extracted:
- `yieldMin`, `yieldMax`, `yieldAvg` (standardized in `Tonnes/Ha`)
- `productionMin`, `productionMax`, `productionAvg` (standardized in `Tonnes`)
- `modelType` (`TASUMI` or `BIOMASS_DAYS`, or `'NA'`)

---

## 3. Mathematical Calculations & Unit Normalization

### A. Unit Conversion Standards & Dynamic Rules Engine
All AI predictions from the upstream API are standardized in:
- **Harvest (Production)**: Metric Tonnes (`METRIC_TON` / `Ton (Metric)`)
- **Yield**: Metric Tonnes per Hectare (`METRIC_TON` per `HECTARE`)

#### Dynamic Master Unit & Conversion Rules API
Instead of hardcoding conversion constants, factors are dynamically looked up via:
`GET /services/farm/api/unit-conversions/unit-master` (proxied via `GET /api/user-aggregate/unit-master`).

The API provides two primary arrays:
1. `unit-master`: List of units across types (`Mass`, `Area`, etc.) with fields `id`, `name`, `unitSymbol`, `unitCode`, `unitShortCode`, and `unitType`.
2. `unit-conversion`: List of conversion factors between units with `fromUnitId`, `toUnitId`, `conversionFactor`, and `unitType`.

#### Zero Hardcoded IDs Constraint
Unit IDs vary across tenant databases and environments. **IDs must NEVER be hardcoded.**
The system dynamically resolves unit IDs at runtime using `resolveUnitId(unitType, candidates, masterData)`:
1. Filters `unit-master` by `unitType` (`Mass` or `Area`).
2. Matches candidates against `unitCode`, `name`, `unitSymbol`, and `unitShortCode` (case-insensitive).
3. Matches aliases (e.g. `kgs` $\to$ `Kilogram`, `tonne`/`mt` $\to$ `Metric Ton`, `ha` $\to$ `Hectare`, `ac` $\to$ `Acre`).

#### Factor Lookup & Inversion Math
For conversion from source unit $S$ to target unit $T$:
1. If $S = T$, $\text{Factor} = 1.0$.
2. Direct rule: If `fromUnitId == S` and `toUnitId == T`, $\text{Factor} = \text{conversionFactor}$.
3. Reciprocal rule: If `fromUnitId == T` and `toUnitId == S`, $\text{Factor} = \frac{1}{\text{conversionFactor}}$.
4. Fallback: If no rule is found, standard baseline constants are applied as a safety net.

#### Session-Level Caching (Zero Latency)
To eliminate latency, Master Unit rules are **NEVER** fetched per plot or per calculation.
They are retrieved once during application login (`Promise.all` in `handleLogin`) or initial plot loading, and cached in `tenantUnitMasterData` / `window.tenantUnitMasterCache` for the life of the session.

### B. Plot-Level Calculations
For a plot with audited area $A$, expected harvest $H_1$, and re-estimated harvest $H_2$:
- **Expected Yield ($Y_1$)**:
  $$Y_1 = \frac{H_1}{A}$$
- **Re-estimated Yield ($Y_2$)**:
  $$Y_2 = \frac{H_2}{A}$$
- **Predicted Harvest (in plot harvest unit $q$)**:
  $$\text{massFactor} = \text{getDynamicFactor}(\text{'Metric Ton'}, q, \text{'Mass'})$$
  $$H_{3\text{min}} = \text{productionMin} \times \text{massFactor}$$
  $$H_{3\text{max}} = \text{productionMax} \times \text{massFactor}$$
- **Predicted Yield (in plot yield unit $q/a$)**:
  $$\text{massFactor} = \text{getDynamicFactor}(\text{'Metric Ton'}, q, \text{'Mass'})$$
  $$\text{areaFactor} = \text{getDynamicFactor}(\text{'Hectare'}, a, \text{'Area'})$$
  $$\text{yieldConversionFactor} = \frac{\text{massFactor}}{\text{areaFactor}}$$
  $$Y_{3\text{min}} = \text{yieldMin} \times \text{yieldConversionFactor}$$
  $$Y_{3\text{max}} = \text{yieldMax} \times \text{yieldConversionFactor}$$
- **Card Level Percentage Difference & Within Range Logic (Yield & Harvest Cards)**:
  - **Within Range Evaluation**:
    - If the baseline value falls within the predicted interval ($\min(\text{predMin}, \text{predMax}) \le \text{baseline} \le \max(\text{predMin}, \text{predMax})$), the card level metric displays **Within range** accompanied by an inline green thumbs-up icon (`<span class="value-green">...Within range</span>`).
  - **Outside Range Evaluation (Closest Boundary)**:
    - If the baseline falls outside the predicted interval, the metric calculates the percentage difference from the closer predicted boundary ($\text{min}$ or $\text{max}$):
      $$\text{distMin} = |\text{predMin} - \text{baseline}|, \quad \text{distMax} = |\text{predMax} - \text{baseline}|$$
      $$\text{closestVal} = \text{distMin} \le \text{distMax} \ ? \ \text{predMin} : \text{predMax}$$
      $$\text{diff} = \frac{\text{closestVal} - \text{baseline}}{\text{baseline}} \times 100$$
  - **Baseline Selection Precedence**:
    - If Re-estimated is present ($> 0$), the primary baseline is **Re-estimated** ($Y_2$ or $H_2$).
    - If Re-estimated is absent ($0$ or missing), the primary baseline falls back to **Expected** ($Y_1$ or $H_1$).
  - **Testing & Multi-Baseline Visibility**:
    - The card displays the primary status/difference at the top of the Card Level row.
    - Two dedicated sub-lines provide explicit comparison for testing:
      1. `Closest vs Expected`: evaluated against Expected baseline (`Within range` or closest $\%$ diff).
      2. `Closest vs Re-estimated`: evaluated against Re-estimated baseline (`Within range` or closest $\%$ diff, or `-` if re-estimated is absent).
  - Applied identically to both **Yield Analysis** (`#plot-card-level`, `#plot-card-level-exp`, `#plot-card-level-re`) and **Harvest Analysis** (`#plot-harvest-card-level`, `#plot-harvest-card-level-exp`, `#plot-harvest-card-level-re`).

### C. Aggregate-Level Calculations
Aggregate values are computed by converting all plot values into base standard units (Hectares and Metric Tonnes):
- **Total Area (Ha)**:
  $$\text{Total Area} = \sum (\text{Plot Area} \times \text{getDynamicFactor}(\text{plotAreaUnit}, \text{'Ha'}, \text{'Area'}))$$
- **Total Expected Harvest (Tonnes)**:
  $$\text{Agg Exp Harvest} = \sum (\text{Plot Expected Harvest} \times \text{getDynamicFactor}(\text{plotHarvestUnit}, \text{'MT'}, \text{'Mass'}))$$
- **Total Re-estimated Harvest (Tonnes)**:
  $$\text{Agg Re Harvest} = \sum (\text{Plot Re-estimated Harvest} \times \text{getDynamicFactor}(\text{plotHarvestUnit}, \text{'MT'}, \text{'Mass'}))$$
- **Total Predicted Harvest (Tonnes)**:
  $$\text{Agg AI Harvest Min} = \sum H_{3\text{min}}, \quad \text{Agg AI Harvest Max} = \sum H_{3\text{max}}$$
- **Area-Weighted Aggregate Yields (Tonnes/Ha)**:
  $$\text{Agg Exp Yield} = \frac{\text{Agg Exp Harvest}}{\text{Total Area}}$$
  $$\text{Agg Re Yield} = \frac{\text{Agg Re Harvest}}{\text{Total Area}}$$
  $$\text{Agg AI Yield Min} = \frac{\sum (Y_{3\text{min}} \times \text{Plot Area (Ha)})}{\text{Total Area}}$$
  $$\text{Agg AI Yield Max} = \frac{\sum (Y_{3\text{max}} \times \text{Plot Area (Ha)})}{\text{Total Area}}$$
- **Card Level Percentage Difference & Within Range Logic (Aggregated Cards)**:
  - Applied identically to project-wide aggregate cards:
    - **Aggregated Yield Analysis** (`#agg-card-level`, `#agg-card-level-exp`, `#agg-card-level-re`):
      - Evaluates aggregate yield baselines ($\text{Agg Exp Yield}$, $\text{Agg Re Yield}$) against the aggregate AI yield range $[\text{Agg AI Yield Min}, \text{Agg AI Yield Max}]$.
      - Primary baseline: $\text{Agg Re Yield}$ if present ($> 0$), else $\text{Agg Exp Yield}$.
      - If baseline is within range, displays `👍 Within range`; otherwise displays the percentage difference from the closer boundary ($\text{min}$ or $\text{max}$).
    - **Aggregated Harvest Analysis** (`#agg-harvest-card-level`, `#agg-harvest-card-level-exp`, `#agg-harvest-card-level-re`):
      - Evaluates aggregate harvest baselines ($\text{Agg Exp Harvest}$, $\text{Agg Re Harvest}$) against the aggregate AI harvest range $[\text{Agg AI Harvest Min}, \text{Agg AI Harvest Max}]$.
      - Primary baseline: $\text{Agg Re Harvest}$ if present ($> 0$), else $\text{Agg Exp Harvest}$.
      - If baseline is within range, displays `👍 Within range`; otherwise displays the percentage difference from the closer boundary ($\text{min}$ or $\text{max}$).

### D. Multi-Model Trend Graph Visualization (BIOMASS_DAYS & TASUMI)
When a plot has `modelType: "BIOMASS_DAYS"` present in its prediction records (`yieldRawRecords`), the dashboard displays interactive forecast trend charts within the plot-level cards and in an expandable "Yield & Growth" modal dialog:

1. **Data Model Integration**:
   - **BIOMASS_DAYS**: Provides chronological trend progression via its `gddPredictions` array (e.g., 19 cutoff dates from May 31 to Aug 29). Each entry includes `cutoff_date`, `yieldAvg`, `yieldMin`, `yieldMax` (in Tonnes/Ha), and `productionAvg`, `productionMin`, `productionMax` (in Tonnes).
   - **TASUMI**: Provides the authoritative latest remote sensing prediction point (`yieldAvg`, `productionAvg` and min-max intervals). In the trend visualization, TASUMI is plotted as the culmination point of the forecast trend (matching the official Cropin SmartFarm Plus UI).
   - **Reference Thresholds**:
     - Standard (Expected) Line: Horizontal dashed line representing crop configuration target ($Y_1$, $H_1$).
     - Re-Estimated (Field) Line: Horizontal dashed line representing field auditor observations ($Y_2$, $H_2$).
     - Maximum Attainable Line: Upper boundary benchmark.
2. **Unit Conversion**:
   - All trend points, reference lines, and tooltip metrics automatically adapt to the user's active unit configuration (`getDataYieldUnit()` and `getDataHarvestUnit()`) using dynamic master conversion factors.
3. **Visibility Rule**:
   - If `BIOMASS_DAYS` with `gddPredictions` is absent, the trend chart container remains hidden, preserving the compact card layout.
4. **Mouseover Tooltip Attributes**:
   - When hovering over any data point along the progression curve, the tooltip displays three distinct forecast attributes calculated for that specific cutoff date / model point, formatted in active user units:
     - **Max Predicted**: Upper boundary prediction value (`yieldMax` or `productionMax`).
     - **Min Predicted**: Lower boundary prediction value (`yieldMin` or `productionMin`).
     - **Average**: Central average prediction value (`yieldAvg` or `productionAvg`).
   - Standard reference lines (Standard, Re-Estimated, Maximum Attainable) are filtered from the point tooltip so the hover dialog remains dedicated to the predicted confidence range and mean for the hovered date.
5. **Min-Max Shaded Confidence Interval Band**:
   - The chart renders upper (`Forecast Max`) and lower (`Forecast Min`) prediction boundary lines surrounding the central predicted average line (`Forecasted Yield` / `Forecasted Harvest`).
   - The area between `Forecast Min` and `Forecast Max` is filled with a translucent green band (`rgba(187, 247, 208, 0.55)` in light mode, `rgba(132, 204, 22, 0.2)` in dark mode) via Chart.js relative filler (`fill: '-1'`), illustrating the model's confidence interval at each cutoff date.
   - The modal summary header displays the latest prediction interval as a range (e.g., `1,740.15 - 1,923.07 Kilogram/Acre`).
   - Chart legends filter out internal boundary datasets, cleanly presenting `Forecasted Yield`, `Maximum Attainable Yield`, `Standard Yield`, and `Re-Estimated Yield`.
6. **Y-Axis Scale Dynamic Number Formatting (Zero Duplicate Labels)**:
   - Ticks on the vertical Y-axis format values dynamically via `formatTrendYTick(v)`:
     - Values $\ge 1,000,000$: formatted in Millions with clean decimals without trailing zeros (`1.5M`, `2M`).
     - Values $\ge 1,000$: formatted in Thousands (`1.5k`, `2k`, `2.5k`, `3k`), preserving exact decimals on fractional thousand ticks (`1.5k`, `2.5k`), strictly eliminating duplicate rounded labels (e.g. previous bug of `2k, 2k, 3k, 3k`).
     - Values $< 1,000$: formatted as clean integers or decimals (`500`, `7.5`, `0`).
   - Applied universally to both Plot-Level Yield and Harvest trend charts, as well as the Enlarge Modal dialog.
7. **'Hide Biomass after Tasumi' Plot-Level Trend Filter Option**:
   - A toggle checkbox `#hide-biomass-after-tasumi` is provided in the Section 2 (Plot Level) header (and synchronized in the Enlarge Modal header `#modal-hide-biomass-after-tasumi`).
   - When checked:
     - The trend chart stops showing any Biomass Days data points whose cutoff date is chronologically after the plot's authoritative Tasumi prediction date (`bISODate > tasumiISODate`).
     - If both Biomass Days and Tasumi have data on the exact same calendar day (`bISODate === tasumiISODate`), the system considers **Tasumi only** by filtering out the Biomass data point on that date and plotting the authoritative Tasumi point.
     - Only Biomass cutoff dates strictly preceding Tasumi (`bISODate < tasumiISODate`) are rendered on the trend progression leading up to Tasumi at the end.
   - When unchecked (default):
     - All chronological Biomass cutoff dates are plotted along with the Tasumi point.
   - **Scope Isolation Constraint**:
     - This toggle strictly modifies the visual dataset passed to the trend charts (`plot-yield-trend-chart`, `plot-harvest-trend-chart`, and `modal-trend-canvas`).
     - It **never alters** plot metric values (Expected, Re-estimated, Predicted min/max, Card Level status/percentage) or any records in the base data table (`#all-plots-table`) or aggregate cards.

### E. Base Yield Data Ordering & Natural Sorting
To guarantee consistent presentation across the dashboard, all base yield records (`globalData`), API-generated plot arrays, and the base plot data table (`#base-yield-table-wrapper`) are sorted ascending by plot name (`Plot Name` / `CA Name`):
1. **Natural Alphanumeric Ordering**: Sorting utilizes `localeCompare(..., undefined, { numeric: true, sensitivity: 'base' })`, ensuring natural progression (e.g. `Plot 1, Plot 2, Plot 10` rather than ASCII `Plot 1, Plot 10, Plot 2`).
2. **Universal Application**:
   - `generateDataFromAPI()` sorts target plots prior to batch request dispatch and sorts the assembled results.
   - `processData(rows)` enforces natural ascending sort across all inputs (API and Excel uploads), establishing sorted order for `globalData`.
   - The Base Plot Data table defaults to Plot Name Ascending (`sort-by` dropdown default), with toggleable Asc/Desc support.

### F. Multi-Model Prediction Display in Base Data Table (TASUMI & BIOMASS)
To align with the Crop Health satellite data table presentation and provide transparent multi-model visibility, the prediction columns in the base data table (`#all-plots-table`):
- `Pred Harv Min`
- `Pred Harv Max`
- `Pred Yield Min`
- `Pred Yield Max`

display values for both AI prediction models simultaneously:
1. **Model Prefixes**:
   - `T:` for Tasumi model predictions (styled with `#818cf8` indigo accent).
   - `B:` for Biomass model predictions (styled with `#34d399` emerald accent).
2. **Strict Vertical Ordering (Tasumi Always on Top)**:
   - Line 1: `T: <value>` (Tasumi is displayed on top unconditionally).
   - Line 2: `B: <value>` (Biomass is displayed on the bottom line).
   - Both lines maintain consistent row heights matching 2-line cells in the table (e.g. `Re-est Harvest` and `Re-est Yield`).
3. **Latest Prediction Indicator (`L` Badge)**:
   - An inline cyan badge (`L`) with styling matching the Health satellite table (`background: rgba(6, 182, 212, 0.15); color: #06b6d4; font-size: 0.65rem; font-weight: 600; padding: 1px 4px; border-radius: 3px;`) is appended exclusively to the chronologically newer model:
     - **Tasumi Timestamp**: Extracted strictly from `predictionDate` (with fallback to `createdDateTime` / `modifiedDateTime` only if `predictionDate` is missing), ensuring that remote sensing predictions (e.g. `2026-08-14`) are not masked by later database modification timestamps (`2026-09-04`).
     - **Biomass Timestamp**: Extracted from the latest `gddPredictions` entry's `cutoff_date` (or `modifiedDateTime` / `predictionDate` / `createdDateTime` fallback).
     - **Precedence**: If both timestamps are identical, Tasumi receives the `L` badge per Priority Rule 1.
     - If only one model has valid data for a plot, that model receives the `L` badge.
     - If a model is absent or evaluated as `'NA'`, it renders a gray `-` and receives no `L` badge.
4. **Column Sorting Support**:
   - All columns in `#all-plots-table`, including `Plot Name`, `Audited Area`, `Exp/Re-est Harvest`, and `Pred Harv/Yield Min/Max`, support interactive ascending/descending sorting via `sortTable(column)` with header indicator arrows (`▲` / `▼`).

### G. Crop Variety Details & Maximum Attainable Yield
1. **Upstream API Endpoint**:
   - `GET /services/farm/api/varieties/{varietyId}` (proxied via `GET /api/user-aggregate/variety-details`).
2. **Request Deduplication & Caching**:
   - In agricultural setups, many croppable areas (CAs) share the same crop variety.
   - The system utilizes an in-memory promise cache (`varietyDetailsCache`) keyed by `${environment}_${varietyId}` to guarantee that only **a single network request** is made per unique `varietyId`. All plots sharing that variety resolve instantly without redundant HTTP calls.
3. **Graceful Fallback**:
   - While PR-enabled plots have a variety assigned, `maxAttainableYield` within the variety configuration is optional.
   - If `varietyId` is null/empty or `maxAttainableYield` is missing/empty, the system sets `maxAttainableYield` to `'NA'` without failing or halting execution.
4. **Unit Normalization & Display**:
   - From `data.yieldPerLocation[0]`, `maxAttainableYield`, `expectedYieldUnits` (e.g. `KILOGRAM`), and `referenceAreaUnits` / `refrenceAreaUnits` (e.g. `ACRE`) are extracted.
   - The value is dynamically converted to base standard `Tonnes/Ha`:
     $$\text{Max Attainable (Tonnes/Ha)} = \frac{\text{rawMax} \times \text{massToTon}}{\text{areaToHa}}$$
   - When rendered in `#all-plots-table` under `Max Attainable` and plotted on the multi-model trend chart as the upper boundary reference line, it converts dynamically to the user's active yield unit (`getDataYieldUnit()`).

---

## 4. Change Log (Feature & Logic Audit Trail)
* **2026-09-09**: Added 'Hide Biomass after Tasumi' Option for Plot-Level Trend Charts:
  1. Added checkbox `Hide Biomass after Tasumi` (`#hide-biomass-after-tasumi`) in Section 2 (Plot Level) header and synchronized `#modal-hide-biomass-after-tasumi` in Yield & Growth enlarge modal.
  2. Updated `extractPlotMultiModelData()` in `aggregate_script_backup.js` and `health_script.js`:
     - Stops showing biomass data generated after tasumi date (`bISODate > tasumiISODate`).
     - Same-day conflict resolution: if both models have data on the same day (`bISODate === tasumiISODate`), considers Tasumi only (excludes biomass on that date).
     - Renders progression curves leading up to Tasumi seamlessly.
  3. Enforced strict scope isolation: change applies exclusively to trend charts without affecting plot card values, card-level within range/diff logic, base data table, or aggregates.
  4. Added Test 29 to regression test suite (29/29 tests passing: 11 existing, 18 new).
* **2026-09-09**: Fixed Y-Axis Scale Values in Plot-Level Yield & Harvest Trend Charts (Eliminated Duplicate Labels):
  1. Root cause: Y-axis tick callback used `(v / 1000).toFixed(0) + 'k'`, which rounded non-exact thousand ticks (e.g. 1500 $\to$ 2k, 2500 $\to$ 3k), causing duplicate consecutive labels (`2k, 2k, 3k, 3k`).
  2. Implemented `formatTrendYTick(v)` in `aggregate_script_backup.js` and `health_script.js`:
     - Values $\ge 1,000$: dynamically formats with decimals when needed (`1.5k`, `2k`, `2.5k`, `3k`) with no trailing zeros.
     - Values $< 1,000$: cleanly displays numeric value (`500`, `7.5`, `0`).
     - Values $\ge 1,000,000$: formats in Millions (`1.5M`, `2M`).
  3. Verified fix applies universally to Plot Yield trend chart, Plot Harvest trend chart, and Enlarge Modal dialog.
  4. Added Test 28 to regression test suite verifying distinct, accurate Y-axis tick formatting (28/28 tests passing: 11 existing, 17 new).
* **2026-09-08**: Extended Card Level Percentage & 'Within Range' Logic to Aggregated Cards:
  1. Added Card Level metric rows to project-wide **Aggregated Yield Analysis** (`#agg-card-level`, `#agg-card-level-exp`, `#agg-card-level-re`) and **Aggregated Harvest Analysis** (`#agg-harvest-card-level`, `#agg-harvest-card-level-exp`, `#agg-harvest-card-level-re`) cards in `aggregate_dashboard_backup.html`.
  2. Implemented identical closest boundary percentage difference and within-range detection in `processData()` for aggregate yield and harvest.
  3. Enforced baseline selection precedence: Re-estimated total/yield when present ($> 0$), falling back to Expected.
  4. Updated `diffIds` in `resetData()` to cleanly reset all aggregated card level elements.
  5. Added Case 7 to Test 27 in regression suite verifying aggregated card level calculations (27/27 tests passing: 11 existing, 16 new).
* **2026-09-08**: Added 'Within range' & Green Thumbs-Up Status to Plot Card Level Logic:
  1. Implemented interval check: If the baseline value (Re-estimated if present, else Expected) falls within the predicted interval ($\min(\text{predMin}, \text{predMax}) \le \text{baseline} \le \max(\text{predMin}, \text{predMax})$), card level displays **Within range** with an inline green thumbs-up icon (`👍 Within range`).
  2. Maintained closest boundary percentage difference calculation ($\text{min}$ or $\text{max}$) exclusively when the baseline falls outside the predicted interval.
  3. Integrated `isWithinPredictedRange()` and `formatCardLevelDiff()` in `aggregate_script_backup.js` and `health_script.js`.
  4. Updated sub-lines `Closest vs Expected` and `Closest vs Re-estimated` to reflect Within Range status when respective baselines fall inside the predicted range.
  5. Updated Test 27 in regression test suite verifying within range detection, boundaries, and out-of-range closest diff (27/27 tests passing: 11 existing, 16 new).
* **2026-09-08**: Updated Plot Card Level Logic to Closest Min/Max Prediction vs Baseline & Added to Harvest Card:
  1. Replaced card level average calculation with closest predicted value selection: computes distance between `min` vs baseline and `max` vs baseline, selecting whichever is closer ($|\text{pred} - \text{baseline}|$).
  2. Implemented baseline selection precedence: if Re-estimated is present ($> 0$), computes difference against Re-estimated; if absent, falls back to Expected.
  3. Added multi-baseline transparency to Card Level row: displays primary difference on top line, followed by explicit `Closest vs Expected` and `Closest vs Re-estimated` sub-lines for validation.
  4. Added Card Level metric row to Harvest Analysis card (`#plot-harvest-card-level`, `#plot-harvest-card-level-exp`, `#plot-harvest-card-level-re`).
  5. Updated `clearPlotDisplay()` and `noPrediction` fallbacks to reset all 6 card-level elements cleanly.
  6. Added Test 27 to regression test suite (27/27 tests passing: 11 existing, 16 new).
* **2026-09-08**: Visualized Min and Max Confidence Interval Band Around Predicted Average Value:
  1. Rendered upper (`Forecast Max`) and lower (`Forecast Min`) boundary lines with translucent green fill (`fill: '-1'`) around the central predicted average curve in `createTrendChart()`.
  2. Updated modal summary header to display the min-max forecast range (e.g. `1,740.15 - 1,923.07`) matching Cropin UI.
  3. Added X-axis (`Year (2026)`) and Y-axis (`Yield (Unit)`) scale titles and filtered internal boundary datasets from legend.
  4. Regression test suite verified (26/26 tests passing).
* **2026-09-08**: Integrated Variety API (`/services/farm/api/varieties/<varietyId>`) and Max Attainable Yield in Base Table:
  1. Implemented backend proxy endpoint `GET /api/user-aggregate/variety-details` and `extractVarietyYieldDetails()` in `server.js`.
  2. Implemented in-memory promise caching (`varietyDetailsCache` in `aggregate_script_backup.js`) to ensure only 1 API call per unique `varietyId` regardless of the number of plots.
  3. Added graceful fallback: missing `varietyId` or missing `maxAttainableYield` defaults to `'NA'` without failing execution.
  4. Dynamically normalized `maxAttainableYield` from variety units (`expectedYieldUnits`, `referenceAreaUnits`) to base `Tonnes/Ha` and active display yield unit.
  5. Added sortable column `Max Attainable` to `#all-plots-table` with header sort arrows and interactive sorting.
  6. Updated multi-model trend chart reference lines to utilize the real API `maxAttainableYield` (and scaled harvest) instead of heuristic multiplier.
  7. Added Test 26 to regression test suite (26/26 tests passing: 11 existing, 15 new).
* **2026-09-08**: Updated Base Data Table of Yield for Multi-Model Display (TASUMI & BIOMASS):
  1. Enforced `predictionDate` key for TASUMI model instead of `modifiedDateTime` (e.g. `predictionDate: 2026-08-14` vs `modifiedDateTime: 2026-09-04`), guaranteeing accurate chronological comparison with Biomass cutoff dates (e.g. `2026-08-29`).
  2. Implemented `getPlotPredictionModelComparison(d, yieldUnit, harvestUnit)` and `renderModelCell()` to extract and render both Tasumi (`T:`) and Biomass (`B:`) predictions.
  3. Enforced Tasumi on top line always (`T:`) and Biomass on bottom line (`B:`).
  4. Added inline `L` badge for the chronologically latest model based on timestamp comparison.
  5. Enabled interactive column sorting for all table headers (`Plot Name`, `auditedArea`, `h1`, `h2`, `h3_min`, `h3_max`, `y1`, `y2`, `y3_min`, `y3_max`) with indicator arrows.
  6. Added Test 25 to regression suite (25/25 tests passing: 11 existing, 14 new).
* **2026-09-07**: Implemented natural alphanumeric ascending sorting for Base Yield Data:
  1. Added `sortYieldBaseData(rows)` ensuring `globalData` is sorted by plot name ascending (`localeCompare` with `numeric: true`).
  2. Updated `generateDataFromAPI()` and `processData(rows)` to sort base plot yield arrays upon load.
  3. Updated `#sort-by` table selector to default to Plot Name Ascending and supported explicit Name sorting in `renderPaginatedTable()`.
  4. Added Test 24 to regression suite (24/24 tests passing).
* **2026-09-07**: Refined Yield & Harvest Prediction Model Selection & Aggregation Rules:
  1. **Rule 1 (TASUMI)**: If `TASUMI` is present, it is selected as authoritative data for the plot.
  2. **Rule 2 (Latest BIOMASS_DAYS)**: If `TASUMI` is not present, the latest `BIOMASS_DAYS` cutoff values from `gddPredictions` are used directly (strictly avoiding any averaging or aggregating across cutoff dates).
  3. **Rule 3 (NA & Aggregation Exclusion)**: If neither `TASUMI` nor `BIOMASS_DAYS` is present, plot predictions are marked as `'NA'` and strictly excluded from all aggregate yield and harvest calculations (`Agg AI Harvest Min/Max` and `Agg AI Yield Min/Max`).
  4. Updated `server.js` (`selectYieldPredictionParameters`), `aggregate_script_backup.js` (`resolveYieldPredictionRules`), and regression test suite (23 tests passing).
* **2026-09-07**: Updated mouseover graph tooltip attributes for multi-model trend charts:
  1. Replaced reference line entries in hover tooltip with specific prediction attributes: `Max Predicted`, `Min Predicted`, and `Average` values.
  2. Extracted and dynamically converted `yieldMin`, `yieldMax`, `productionMin`, and `productionMax` for all `BIOMASS_DAYS` cutoff dates and `TASUMI` points in `extractPlotMultiModelData()`.
  3. Filtered tooltip interaction to datasetIndex 0 with clean left-aligned typography (`displayColors: false`).
* **2026-09-07**: Integrated multi-model forecast trend visualization for plot-level Yield Analysis and Harvest Analysis cards:
  1. Updated `server.js` (`/api/user-aggregate/yield-prediction`) to return the raw `records` array alongside model parameters.
  2. Implemented `extractPlotMultiModelData()` and `createTrendChart()` in `aggregate_script_backup.js` using Chart.js to render progression curves from `BIOMASS_DAYS.gddPredictions` combined with `TASUMI` authoritative prediction points.
  3. Added embedded card chart containers (`#plot-yield-chart-container`, `#plot-harvest-chart-container`) and full "Yield & Growth" modal dialog (`#yield-growth-modal`) mirroring SmartFarm Plus UI tabs and styling.
* **2026-09-07**: Upgraded Unit Conversion System from hardcoded constants to dynamic upstream Master Unit & Conversion Rules lookup:
  1. Integrated `/services/farm/api/unit-conversions/unit-master` endpoint with server proxy and session cache (`window.tenantUnitMasterCache`).
  2. Implemented dynamic unit ID resolution (`resolveUnitId`) to guarantee zero hardcoded IDs across different tenant database environments.
  3. Implemented direct and reciprocal factor lookup (`getDynamicFactor`) for Mass and Area conversions.
  4. Updated compound Yield conversion: $\text{Yield Factor} = \frac{\text{Mass Factor}}{\text{Area Factor}}$.
  5. Standardized AI predictions: Source Harvest is always Metric Tonnes and Source Yield is always Tonnes/Ha.
* **2026-09-07**: Upgraded Yield Prediction API parsing logic in `server.js` (`selectYieldPredictionParameters`) to support multi-model API responses with prioritized hierarchy:
  1. Priority 1: `modelType === "TASUMI"` (latest by timestamp).
  2. Priority 2: `modelType === "BIOMASS_DAYS"` (latest by timestamp).
  3. Fallback: First record or parameters object.
  Replaced previous naive `records[0]` indexing to guarantee accurate model selection.
