# Yield & Harvest Module Standard Operating Procedure (SOP) & Calculations Specification

This document serves as the single source of truth for the features, calculations, logic rules, and data model hierarchies implemented in the Yield and Harvest Module of the Cropin Dashboard.

---

## 1. Feature Overview & Domain Definitions
The Yield and Harvest Module provides automated intelligence, validation, and analytics for expected, re-estimated (field-audited), and AI-predicted crop yield and harvest volumes.

It operates at two granularities:
1. **Plot Level**: Individual croppable area (CA) metrics, comparison between farmer configuration, field re-estimates, and remote AI model predictions.
2. **Aggregate Level**: Project-wide totals and area-weighted averages across all plots where prediction data is available (with an option to include non-predicted plots).

### Script Execution Order (Important for Runtime Behavior — previously undocumented)
`aggregate_dashboard_backup.html` loads scripts as `api.js` (module) → `components/export_manager.js` (defer) → `aggregate_script_backup.js` (defer) → `Aggregate-Data-Testing/health_script.js` (classic script, **no `defer`**). Per HTML parsing rules, the non-deferred `health_script.js` actually executes **first**, synchronously mid-parse; the deferred scripts run afterward, in order, once parsing completes — so **`aggregate_script_backup.js` executes last**, not first as the markup order suggests.

Both files declare 15 identically-named Yield-prediction helper functions as plain top-level `function` statements (`resolveUnitId`, `getDynamicFactor`, `getFallbackFactor`, `resolveYieldPredictionRules`, `sortYieldBaseData`, `getPlotPredictionModelComparison`, `renderModelCell`, `isWithinPredictedRange`, `formatCardLevelDiff`, `extractPlotMultiModelData`, `formatTrendYTick`, `convertYield`, `convertHarvest`, `extractVarietyYieldDetails`, `calculateClosestDiff`, `formatTrendDate`). Plain `function` redeclaration at global scope does not throw — it silently overwrites `window.<name>`. **Because `aggregate_script_backup.js` runs last, its declarations are authoritative for the live UI for all of these functions.** (Only `fmtYield`/`fmtHarvest`/`fmtSmart` are scoped inside `if (typeof module !== 'undefined')` in `health_script.js` to avoid a `const` redeclaration `SyntaxError` against `aggregate_script_backup.js`'s copies — this only prevents the crash, it doesn't change which file "wins" for these three, since `health_script.js`'s versions never execute their module-only block in-browser.) As of this audit (2026-09-22) all diffed shared functions were byte-identical between the two files, so there is currently no behavioral divergence — but this dual-declaration is fragile and any future edit made to only one file's copy will silently diverge from the other without any error.

**Test coverage caveat**: Regression Test 32 (`browserScripts_syntax_and_global_scope_collision_check`) simulates script loading via Node's `vm.runInContext` in the HTML *source* order (`export_manager.js` → `aggregate_script_backup.js` → `health_script.js`), which does not model real browser `defer` timing and is therefore the reverse of the actual execution order described above. The test only asserts each shared function exists (`typeof fn === 'function'`), so it cannot detect which file's implementation is actually live in the browser, nor would it catch a regression where the two files' logic diverges.

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
     - The plot is **strictly excluded from aggregate calculations** (`Agg AI Harvest Min/Max` and `Agg AI Yield Min/Max` weighted sums), and is excluded from total aggregate area and expected/re-estimated harvest totals (unless the user explicitly checks the **"Include no prediction plots"** checkbox, `id="include-no-prediction-agg"` — corrected 2026-09-22; the SOP previously misquoted this label as "Include plots without prediction in aggregate").
   - **Additional exclusion condition (previously undocumented)**: A plot is also treated as "no prediction" and excluded from aggregation if its AI values resolve to **all-zero** (`h3_min`/`h3_max`/`y3_min`/`y3_max` all `0` or `null`), even when `modelType` is not literally `'NA'` (`isZero` check in `processData()`, `aggregate_script_backup.js`). This runs alongside the documented `isNA` check; the effective condition is `isPredictionAvailable = !isNA && !isZero`.
   - **Additional bucket (previously undocumented)**: Plots whose Yield feature is not enabled for the CA are tracked separately as `plotsNotEnabled` (`notEnabledPlots`), distinct from the `'NA'`/excluded bucket described above — a third state beyond "has prediction" / "excluded (NA or zero)".

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
3. Matches aliases. **Full alias table (corrected/expanded 2026-09-22 — SOP previously documented only 4 examples)**, from `resolveUnitId()` in `aggregate_script_backup.js`:
   - **Mass**: `kgs`/`kg`/`kilogram`/`kilograms` $\to$ `Kilogram`; `tonne`/`tonnes`/`mt`/`metric ton`/`ton (metric)` $\to$ `Metric Ton`; `ton`/`tons`/`us ton` $\to$ **`US Ton`** (a distinct unit from `Metric Ton` — do not conflate); `quintal`/`qtl` $\to$ `Quintal`; `gram`/`g` $\to$ `Gram`.
   - **Area**: `acre`/`acres`/`ac` $\to$ `Acre`; `ha`/`hectare`/`hectares` $\to$ `Hectare`; `sq mt`/`square meter`/`sqm` $\to$ `Square Meter`; `bigha` $\to$ `Bigha`; `gunta` $\to$ `Gunta`.

#### Factor Lookup & Inversion Math
For conversion from source unit $S$ to target unit $T$:
1. If $S = T$, $\text{Factor} = 1.0$.
2. Direct rule: If `fromUnitId == S` and `toUnitId == T`, $\text{Factor} = \text{conversionFactor}$.
3. Reciprocal rule: If `fromUnitId == T` and `toUnitId == S`, $\text{Factor} = \frac{1}{\text{conversionFactor}}$.
4. Fallback: If no rule is found, standard baseline constants are applied as a safety net (`getFallbackFactor()`). **Exact constants (previously undocumented)**:
   - **Area**: Hectare $\to$ Acre = `2.47105`; Acre $\to$ Hectare = `0.404686`.
   - **Mass** (baseline "to Metric Ton" map, `toTon`): Metric Ton = `1.0`, Kilogram = `0.001`, US Ton = `0.9071847`, Quintal = `0.1`, Gram = `0.000001`. Final factor = `tgtToTon > 0 ? srcToTon / tgtToTon : 1.0`.
   - **Legacy/parallel code paths note**: `fetchUnitConversions()` (legacy `/api/unit-conversions` endpoint) and `convertValueToMetricTon()` (own independent hardcoded fallback table) also exist in `aggregate_script_backup.js` and are still callable. They appear superseded by the dynamic `getDynamicFactor`/`resolveUnitId` system described above, but their continued presence means the "Zero Hardcoded IDs Constraint" heading should be read as applying to the active dynamic path, not as a guarantee that no hardcoded fallback values exist anywhere in the codebase.

#### Session-Level Caching (Zero Latency)
To eliminate latency, Master Unit rules are **NEVER** fetched per plot or per calculation.
They are retrieved once during application login (`Promise.all` in `handleLogin`) or initial plot loading, and cached in `tenantUnitMasterData` / `window.tenantUnitMasterCache` for the life of the session.

### B. Plot-Level Calculations
For a plot with audited area $A$, expected harvest $H_1$, and re-estimated harvest $H_2$:
- **Expected Yield ($Y_1$)**:
  $$Y_1 = \frac{H_1}{A}$$
- **Re-estimated Yield ($Y_2$)**:
  $$Y_2 = \frac{H_2}{A}$$
  - **Computation timing (clarified 2026-09-22)**: $Y_1$/$Y_2$ are **not** recomputed live at card-render time. For API-sourced plots, `H/A` is computed once during data ingestion in `generateDataFromAPI()` and stored on the row (`d['Expected YIELD']`, post area-unit conversion). For Excel-uploaded rows, `'Expected YIELD'`/`'Re-estimated Yield'` columns are read directly from the sheet when present, with no recomputation. The formula above is correct, but it is an ingestion-time step, not a per-render calculation.
  - **Field-naming note (2026-09-22)**: An initial `reEstYield` value is computed in `generateDataFromAPI()` from `caData.reestimatedValue / auditedArea`, but is immediately overwritten later in the same function by `H2/Area` (using the differently-named source field `caData.reEstimatedHarvest`) before rendering — the two similarly-named source fields (`reestimatedValue` vs `reEstimatedHarvest`) are not the same field. The final displayed $Y_2$ always comes from the `H2/Area` computation; the initial `reestimatedValue`-based computation is effectively dead and does not reach the UI.
- **Predicted Harvest (in plot harvest unit $q$)**:
  $$\text{massFactor} = \text{getDynamicFactor}(\text{'Metric Ton'}, q, \text{'Mass'})$$
  $$H_{3\text{min}} = \text{productionMin} \times \text{massFactor}$$
  $$H_{3\text{max}} = \text{productionMax} \times \text{massFactor}$$
  - **Formatting & Decimal Precision**: Predicted Harvest values in the plot card are formatted with 2 decimal places roundoff via `fmtHarvest` (`Number(val).toFixed(2)`), matching `fmtYield` and preventing loss of precision when crop harvest units are `TON` or fractional (e.g. `1.52 - 2.56` instead of `2 - 3`).
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
      - If baseline is within range, displays **Within range** with the same inline SVG thumbs-up icon used at plot level (corrected 2026-09-22 — this is not a literal `👍` emoji character); otherwise displays the percentage difference from the closer boundary ($\text{min}$ or $\text{max}$).
    - **Aggregated Harvest Analysis** (`#agg-harvest-card-level`, `#agg-harvest-card-level-exp`, `#agg-harvest-card-level-re`):
      - Evaluates aggregate harvest baselines ($\text{Agg Exp Harvest}$, $\text{Agg Re Harvest}$) against the aggregate AI harvest range $[\text{Agg AI Harvest Min}, \text{Agg AI Harvest Max}]$.
      - Primary baseline: $\text{Agg Re Harvest}$ if present ($> 0$), else $\text{Agg Exp Harvest}$.
      - If baseline is within range, displays **Within range** with the same inline SVG thumbs-up icon used at plot level (not a literal `👍` emoji character); otherwise displays the percentage difference from the closer boundary ($\text{min}$ or $\text{max}$).

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
   - The area between `Forecast Min` and `Forecast Max` is filled with a translucent green band (`rgba(187, 247, 208, 0.55)` or `rgba(132, 204, 22, 0.2)`) via Chart.js relative filler (`fill: '-1'`), illustrating the model's confidence interval at each cutoff date. **Correction (2026-09-22)**: the color choice is **not** driven by the user's OS/app light-dark theme setting, despite the "light mode"/"dark mode" framing. `createTrendChart()` sets `isDark = !opts.isModal` — the embedded plot-card chart is always invoked with `isModal:false` and therefore always renders `rgba(132, 204, 22, 0.2)`; the enlarged Yield & Growth modal chart is always invoked with `isModal:true` and therefore always renders `rgba(187, 247, 208, 0.55)`. The correct framing is **embedded card chart** vs. **enlarged modal chart**, not light vs. dark theme.
   - The modal summary header displays the latest prediction interval as a range (e.g., `1,740.15 - 1,923.07 Kilogram/Acre`).
   - Chart legends filter out internal boundary datasets, cleanly presenting `Forecasted Yield`, `Maximum Attainable Yield`, `Standard Yield`, and `Re-Estimated Yield`.
6. **Y-Axis Scale Dynamic Number Formatting (Zero Duplicate Labels)**:
   - Ticks on the vertical Y-axis format values dynamically via `formatTrendYTick(v)`:
     - Values $\ge 1,000,000$: formatted in Millions with clean decimals without trailing zeros (`1.5M`, `2M`).
     - Values $\ge 1,000$: formatted in Thousands (`1.5k`, `2k`, `2.5k`, `3k`), preserving exact decimals on fractional thousand ticks (`1.5k`, `2.5k`), strictly eliminating duplicate rounded labels (e.g. previous bug of `2k, 2k, 3k, 3k`).
     - Values $< 1,000$: formatted as clean integers or decimals (`500`, `7.5`, `0`).
   - Applied universally to both Plot-Level Yield and Harvest trend charts, as well as the Enlarge Modal dialog.
7. **'Show Biomass after Tasumi' Plot-Level Trend Filter Option**:
   - A toggle checkbox `#show-biomass-after-tasumi` is provided in the Section 2 (Plot Level) header (and synchronized in the Enlarge Modal header `#modal-show-biomass-after-tasumi`), unchecked by default.
   - **Default Behavior (Unchecked)**:
     - The trend chart stops showing any Biomass Days data points whose cutoff date is chronologically after the plot's authoritative Tasumi prediction date (`bISODate > tasumiISODate`).
     - If both Biomass Days and Tasumi have data on the exact same calendar day (`bISODate === tasumiISODate`), the system considers **Tasumi only** by filtering out the Biomass data point on that date and plotting the authoritative Tasumi point.
     - The trend curve terminates cleanly with the Tasumi prediction as the culmination point.
   - **User Opt-in (Checked)**:
     - All chronological Biomass cutoff dates are plotted along with the Tasumi point, showing the full progression even after Tasumi.
   - **Scope Isolation Constraint**:
     - This toggle strictly modifies the visual dataset passed to the trend charts (`plot-yield-trend-chart`, `plot-harvest-trend-chart`, and `modal-trend-canvas`).
     - It **never alters** plot metric values (Expected, Re-estimated, Predicted min/max, Card Level status/percentage) or any records in the base data table (`#all-plots-table`) or aggregate cards.

8. **Maximum Attainable Reference Line — Fallback Heuristic When Variety Data Is Unavailable (previously undocumented)**:
   - When the real variety-derived `maxAttainableYield` (Section 3G) is unavailable, `extractPlotMultiModelData()` synthesizes a fallback reference line instead of omitting it:
     $$\text{maxAttainableYield} = \text{stdYield} > 0 \ ? \ \text{stdYield} \times 1.85 \ : \ \text{maxYieldVal} \times 1.2$$
     $$\text{maxAttainableHarvest} = \text{stdHarvest} > 0 \ ? \ \text{stdHarvest} \times 1.85 \ : \ \text{maxHarvestVal} \times 1.2$$
   - i.e. **1.85×** the Standard (crop-configuration) Yield/Harvest if available, else **1.2×** the observed maximum value already present in the trend data. This synthetic line is visually indistinguishable from a real variety-derived Maximum Attainable line and should not be assumed accurate for plots without variety data.

9. **Enlarged Yield & Growth Modal Top Summary Information**:
   - The enlarged modal dialog (`#yield-growth-modal`) displays 3 standardized metric rows above the forecast trend chart:
     - **Standard Yield / Standard Harvest**: Configured baseline from crop configuration (`#modal-summary-val-std`, `#modal-summary-unit-std`) with subtitle `From Crop Configuration` (with the previous 'View' link removed).
     - **Re-estimated Yield / Re-estimated Harvest**: Field-audited baseline (`#modal-summary-val-re`, `#modal-summary-unit-re`) with subtitle `From Field Audit`. When Re-estimated data is absent or $0$, cleanly displays `-`.
     - **Forecasted Yield / Forecasted Harvest**: Remote sensing model prediction interval (`#modal-summary-val-pred`, `#modal-summary-unit-pred`) with subtitle `🌿 Powered By Cropin AI`.
   - All 3 rows adapt dynamically when switching between the `Yield Analysis` and `Harvest Analysis` tabs, using active plot display units (`yieldUnitLabel` and `harvestUnitLabel`).
   - **Known test/implementation gap (previously undocumented)**: `extractModalSummaryValues()` exists only in `health_script.js` (exercised by regression Test 30 via `health_script.test.js`). The live modal (`renderModalTrendChart()` in `aggregate_script_backup.js`) builds these 3 summary rows with its own separate inline logic and never calls `extractModalSummaryValues()`. Test 30 therefore does not exercise the function actually driving the browser UI for this feature — treat Test 30's coverage of modal summary extraction as unverified against the live code path until reconciled.

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
   - From `data.yieldPerLocation[0]` (falling back to `data.companyYieldPerLocation[0]` if absent — previously undocumented), `maxAttainableYield`, `expectedYieldUnits` (e.g. `KILOGRAM`), and `referenceAreaUnits` / `refrenceAreaUnits` (e.g. `ACRE`) are extracted.
   - The value is dynamically converted to base standard `Tonnes/Ha`:
     $$\text{Max Attainable (Tonnes/Ha)} = \frac{\text{rawMax} \times \text{massToTon}}{\text{areaToHa}}$$
   - When rendered in `#all-plots-table` under `Max Attainable` and plotted on the multi-model trend chart as the upper boundary reference line, it converts dynamically to the user's active yield unit (`getDataYieldUnit()`).

---

## 4. Change Log (Feature & Logic Audit Trail)
* **2026-09-16**: Fixed Browser Global Scope Identifier Collision & Added Browser Scripts Syntax Test:
  1. Root cause: `Aggregate-Data-Testing/health_script.js` declared `const fmtYield` in the top-level scope, which collided with `const fmtYield` in `aggregate_script_backup.js` when both scripts were loaded in `aggregate_dashboard_backup.html`, throwing `Uncaught SyntaxError: Identifier 'fmtYield' has already been declared` and halting initialization of environment selection.
  2. Scoped Node-specific exports inside `if (typeof module !== 'undefined')` in `health_script.js`, ensuring zero global identifier collisions in browser environments.
  3. Added Test 32 (`browserScripts_syntax_and_global_scope_collision_check`) to regression suite to sequentially execute `components/export_manager.js`, `aggregate_script_backup.js`, and `health_script.js` in a shared browser-like VM context, permanently preventing any syntax errors or global collisions from bypassing regression testing (32/32 tests passing: 30 existing, 2 new).
* **2026-09-16**: Updated Plot-Level Predicted Harvest Formatting (`fmtHarvest`) to 2 Decimal Places Roundoff:
  1. Updated `fmtHarvest` in `aggregate_script_backup.js` and `health_script.js` to format with 2 decimal places roundoff (`Number(val).toFixed(2)`), replacing `Math.round()` which previously rounded small/decimal unit values (e.g. `1.52 - 2.56 TON`) to integers (`2 - 3`).
  2. Aligned `fmtHarvest` with `fmtYield` and table formatting for complete consistency across plot cards, modals, and base table.
  3. Added Test 31 to regression test suite verifying `fmtHarvest` and `fmtYield` with 2 decimal points roundoff and null/fallback handling (31/31 tests passing: 30 existing, 1 new).
* **2026-09-16**: Updated Enlarged Yield & Harvest Cards (Yield & Growth Modal):
  1. Added Re-estimated Yield and Re-estimated Harvest to the top summary header of `#yield-growth-modal` (`#modal-summary-label-re`, `#modal-summary-val-re`, `#modal-summary-unit-re`) with subtitle `From Field Audit`.
  2. Structured the top summary information into 3 clean, responsive metric rows (Standard, Re-estimated, Forecasted) guaranteeing alignment across all zoom levels and viewports.
  3. Removed the non-functional 'View' button link from the 'Standard yield' and 'Standard harvest' section (`From Crop Configuration`).
  4. Added Test 30 to regression test suite verifying modal summary value extraction and fallback handling (30/30 tests passing: 11 existing, 19 new).
* **2026-09-16**: Updated Plot-Level Trend Chart 'Show Biomass after Tasumi' and Added 'Tasumi generated' Indicator:
  1. Renamed checkbox to `Show Biomass after Tasumi` (`#show-biomass-after-tasumi`), unchecked/disabled by default. *(Correction 2026-09-22: the live markup has no `disabled` attribute — the checkbox is interactive from the start, only unchecked by default. See Section 3D.7 for the current, accurate default-state description.)*
  2. Inverted default behavior: by default (unchecked), biomass data generated after Tasumi is hidden and same-day conflict defaults to Tasumi only; only upon user checking the box are all biomass points displayed.
  3. Added plot-level status label `Tasumi generated: Yes / No` (`#plot-tasumi-status`) directly next to `Audited Area` providing immediate transparency on whether the culmination point on the trend chart is Tasumi or Biomass Days.
  4. Updated Test 29 in regression test suite (29/29 tests passing: 11 existing, 18 new).
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
* **2026-09-22**: SOP Accuracy Audit — corrected drift between documented formulas and actual code (per the new SOP Update Constraint in `AGENTS.md`). No application code was changed; documentation only. Corrections: fixed the "Include no prediction plots" checkbox label (previously misquoted); documented the `isZero` all-zero exclusion condition and the separate `plotsNotEnabled` bucket (Rule 3 aggregation exclusion); expanded the unit alias table to its full list including the distinct `US Ton` vs `Metric Ton` units, Quintal, Gram, Square Meter, Bigha, and Gunta; documented the exact fallback conversion constants (`getFallbackFactor`) and flagged the still-present legacy/parallel unit-conversion code paths; clarified that plot-level $Y_1$/$Y_2$ are computed once at data-ingestion time, not live per render; corrected the "👍 Within range" wording — it is an inline SVG icon, not a literal emoji character; documented the `isDark`/`isModal` confidence-band color logic is keyed to embedded-card-vs-modal context, not the user's light/dark theme; documented the previously-unmentioned Maximum Attainable fallback heuristic (1.85× Standard, or 1.2× observed max) used when variety data is unavailable; documented that `extractModalSummaryValues()` (tested by Test 30) is not actually called by the live modal rendering path; corrected the "disabled by default" changelog claim for `#show-biomass-after-tasumi`; documented the actual script load order (`health_script.js` executes before `aggregate_script_backup.js`, contrary to markup order) and that `aggregate_script_backup.js`'s declarations are authoritative for shared Yield helper functions; flagged that regression Test 32 simulates the scripts in the wrong relative order and cannot detect a real collision-driven divergence.
