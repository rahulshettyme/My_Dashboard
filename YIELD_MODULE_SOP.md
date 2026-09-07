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

The Yield Prediction API (`/services/farm/api/plot-risk/yield?caIds={caIds}`) may return multiple model records for a single plot in its `records` array (e.g., `TASUMI`, `BIOMASS_GDD`, `BIOMASS_DAYS`). The system implements a strict priority selection rule to determine the authoritative prediction record:

### Priority Rules
1. **Priority 1 (`TASUMI`)**:
   - If one or more records with `modelType: "TASUMI"` (case-insensitive) are present, the system MUST select this record.
   - If multiple `TASUMI` records exist, the most recent record (determined by `modifiedDateTime` $\to$ `predictionDate` $\to$ `createdDateTime` DESC) is selected as the latest data.
2. **Priority 2 (`BIOMASS_DAYS`)**:
   - If no `TASUMI` record exists, the system MUST check for records with `modelType: "BIOMASS_DAYS"`.
   - If multiple `BIOMASS_DAYS` records exist, the most recent record (by timestamp DESC) is selected.
3. **Fallback**:
   - If neither `TASUMI` nor `BIOMASS_DAYS` is present, the system defaults to the first available record in `records[0]`, or the top-level `parameters` object.
   - If no data or parameters exist, values are marked as `'NA'`.

### Extracted Parameters
From the selected record, the following metrics are extracted:
- `yieldMin`, `yieldMax`, `yieldAvg` (in `Tonnes/Ha`)
- `productionMin`, `productionMax`, `productionAvg` (in `Tonnes`)
- `modelType` (e.g. `TASUMI`, `BIOMASS_DAYS`)

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

---

## 4. Change Log (Feature & Logic Audit Trail)
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
