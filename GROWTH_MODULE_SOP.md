# Growth Module Standard Operating Procedure (SOP) & Calculations Specification

This document serves as the single source of truth for the features, calculations, logic rules, and known caveats implemented in the Growth Module of the Cropin Dashboard. It was created 2026-09-23 (the module previously had no SOP) by auditing the actual live code — every claim below is verified against `server.js`, `aggregate_script_backup.js`, and `aggregate_dashboard_backup.html` as they exist today, not against design intent.

---

## 1. Feature Overview & Domain Definitions

The Growth Module tracks per-plot crop growth stage, season progression, and upcoming harvest windows across a project, surfaced as four Chart.js bar charts plus one plain HTML base/detail table:

1. **Growth Progression** — stacked bar chart binning plots by season-progression percentage, further split into Slow/Normal/Fast growth.
2. **Growth project data - Stage window** — bar chart binning plots by their current crop growth stage (Emergence → Tuber Initiation → Tuber Bulking → Harvested).
3. **Growth project data - Harvest window - Weekly** — bar chart binning plots' expected harvest production by the Monday-anchored week their harvest window falls in (next 8 weeks).
4. **Growth project data - Harvest window - Daily** — bar chart binning plots' expected harvest production by calendar day (next 7 days).
5. **Base Growth Table** (`#growth-table-container`) — a plain, sortable HTML table listing every fetched plot's raw growth fields, independent of the four charts above.

**Root DOM section**: `#growth-data-section` in `aggregate_dashboard_backup.html`. Load trigger: `handleLoadGrowthData()` (button `#load-growth-data-btn`).

**Plot Risk (PR) Filtered Execution**: Like the Health and Yield modules, Growth data is only fetched for Plot Risk-enabled plots (`window.verifiedHealthPlots`); this module has no independent PR gating of its own beyond reusing that same verified-plots list.

**Data-fetch is never filtered by harvest status.** `handleLoadGrowthData()` fetches growth + harvest data for every PR-enabled target plot regardless of whether it later turns out to be harvested — "harvested" is only known *after* a separate per-plot API response comes back (Section 2C). All "Hide Harvested" behavior described in this document (Section 6) is a **client-side post-fetch filter**, never a fetch-time exclusion.

---

## 2. Backend API Layer (`server.js`)

### A. `/api/user-aggregate/growth-prediction` — dead/unused endpoint
Defined at `server.js` but returns a **hardcoded mock response** and does not proxy to any upstream API:
```js
// Mock response for now as per previous structure, but we'll add real proxying below
res.json({ currentNdvi: 0.65, avgNdvi: 0.58, stage: "Vegetative", status: "Good" });
```
**This endpoint is never called by any client code** (confirmed by full-repo search). Do not treat it as a real data source — it appears to be leftover stub code from an earlier design that was never completed. See Section 8.1.

### B. `/api/user-aggregate/growth-stage` — the real data source
Proxies to:
```
GET ${apiBaseUrl}/services/farm/api/plot-risk/growthstage?caIds=${caIds}&size=10&orderBy=DESC&sortBy=date
```
Upstream is asked to sort `DESC` by date and return up to 10 records per request. The route detects an HTML error page or an empty response body (see the Yield Module's proxy-layer conventions) before attempting `JSON.parse`, then delegates extraction to `extractGrowthStageData()`.

### C. `extractGrowthStageData(parsedData, caIds)` — record selection
```js
function extractGrowthStageData(parsedData, caIds) {
    let growth = null;
    if (parsedData && parsedData.records && Array.isArray(parsedData.records)) {
        for (const rec of parsedData.records) {
            if (rec.cropGrowthStage && rec.cropGrowthStage.cropStageName) {
                growth = rec.cropGrowthStage;
                break;
            }
        }
    }
    if (growth) {
        return {
            caId: caIds,
            cropStageName: growth.cropStageName || "-",
            seasonProgression: (growth.seasonProgression !== undefined && growth.seasonProgression !== null) ? growth.seasonProgression : 0,
            dailyInterpretation: growth.dailyInterpretation || "-",
            harvestWindowStartDate: growth.harvestWindowStartDate || "-",
            harvestWindowEndDate: growth.harvestWindowEndDate || "-"
        };
    } else {
        return { caId: caIds, _rawEmpty: true, _message: "No valid growth stage records found" };
    }
}
```
It takes the **first** `records[]` entry whose `cropGrowthStage.cropStageName` is truthy and stops (`break`) — it does **not** independently re-sort or compare dates itself. It trusts the upstream `orderBy=DESC&sortBy=date` query param to have already placed the newest record first.

**Caveat**: unlike the Health module's `L` (Latest) badge logic, which independently re-verifies "latest" via explicit date comparisons even when the upstream API is asked to sort, `extractGrowthStageData()` has **no client-side safety net** — if upstream ever returned unsorted or ascending-sorted data, this function would silently extract the oldest matching record with no error or warning. Exported for testing at the bottom of `server.js`.

### D. `isHarvested` comes from a *different* API entirely
`isHarvested` is **not** part of the growth-stage response. It's derived from a separate `/api/user-aggregate/sustainability` call (made first, per plot, in `processPlotGrowth()`):
```js
const isHarvested = (sData.harvested || !!rawHarvestDate);
```
i.e. `true` if either the Sustainability API's `harvested` boolean is set **or** a `harvestDate` is present — an "OR" check across two signals, not a single source of truth. Any Growth-chart logic that reads `res.isHarvested` is implicitly depending on this separate API succeeding.

### E. No request caching/dedup layer
Unlike the Yield Module's `varietyDetailsCache` (deduplicated per unique `varietyId`, since many plots legitimately share one crop variety), Growth data is genuinely per-plot — there is **no analogous cache** for growth-stage or sustainability calls. Every plot triggers its own fetch pair, in batches of 5 concurrent requests (`BATCH_SIZE = 5`), on every load and every "sync." `syncGrowthWithYield()` itself performs no additional fetching — it only reconciles already-loaded in-memory data.

### F. Client-side field mapping (`processPlotGrowth()`)
```js
return {
    ...
    isHarvested: isHarvested ? "Yes" : "No",
    isConsideredInChart: (!isHarvested && rawHEnd && rawHEnd >= new Date().setHours(0,0,0,0)) ? "Yes" : "No",
    harvestedDate: formatDate(harvestDate),
    currentStage: (growth && growth.cropStageName) ? growth.cropStageName : "-",
    progression: (growth && growth.seasonProgression) ? (parseFloat(growth.seasonProgression) || 0).toFixed(2) : "-",
    dailyInterpretation: (growth && growth.dailyInterpretation) ? growth.dailyInterpretation : "-",
    hStart: (growth && growth.harvestWindowStartDate) ? formatDate(growth.harvestWindowStartDate) : "-",
    hEnd: (growth && growth.harvestWindowEndDate) ? formatDate(growth.harvestWindowEndDate) : "-",
    rawHStart: rawHStart,
    rawHEnd: rawHEnd,
    ...
};
```
- `res.progression` is a **formatted string** (already `.toFixed(2)`'d here), not a number — every consumer that bins by progression must `parseFloat()` it again (Section 3A does this).
- `res.hStart`/`res.hEnd` are **display-formatted strings**; `res.rawHStart`/`res.rawHEnd` are the underlying `Date` objects, used exclusively by the two Harvest Window charts (Section 5) for actual date-math binning — the display strings are never used for binning math.
- `res.isConsideredInChart` is computed here but **never read anywhere else in the codebase** — a vestigial/dead field (Section 8.7).
- `res.auditedArea` / `res.expectedHarvestTon` are looked up from the matching Yield row (`yieldInfo`); when no match is found they resolve to the **literal string `"NA"`** (not `0`, not `null`) — every chart/table in this module that sums or displays area/harvest must explicitly guard for this string sentinel (most do; one does not — Section 8.8).

---

## 3. Growth Progression Chart

**Canvas**: `growthProgressionChart`. **Core function**: `computeProgressionMetrics(fullResults, totalPlotsCount, plotsToBin, hideHarvested = false)`, exposed as `window.computeProgressionMetrics` for testing. **Render function**: `renderGrowthProgressionChart(results, hideHarvestedParam)`.

### A. Binning (5 fixed bins by progression %)
Labels: `'0 - 20%'`, `'20 - 40%'`, `'40 - 60%'`, `'60 - 80%'`, `'80 - 100%'`.
```js
if (pVal <= 1.0) { pVal = pVal * 100; }   // treat a 0-1 fraction as a fraction, not already a %
let binIdx = 0;
if (pVal <= 20) binIdx = 0;
else if (pVal <= 40) binIdx = 1;
else if (pVal <= 60) binIdx = 2;
else if (pVal <= 80) binIdx = 3;
else binIdx = 4;
```
Boundaries are inclusive on the **lower** bin — exactly `20%` lands in bin 0, not bin 1. Plots with `res.progression === "-"` or `null`, or that fail `parseFloat` (`NaN`), are **skipped entirely** — they appear in no bin and are not counted anywhere in the bins array.

### B. Slow / Normal / Fast classification
Case-insensitive substring match on `dailyInterpretation`, applied identically for both per-bin classification and the KPI totals:
```js
const interp = (res.dailyInterpretation || '').toLowerCase().trim();
if (interp.includes('slow')) { /* Slow Growth */ }
else if (interp.includes('fast')) { /* Fast Growth */ }
else { /* Normal Growth */ }
```
**Caveat**: anything that isn't `'slow'`/`'fast'` — including the literal `"-"` placeholder used when `dailyInterpretation` is missing from the upstream API — falls into the `else` branch and is counted as **Normal Growth**. There is no distinct "no data"/"unknown" bucket (contrast the Health Module's explicitly tracked `counts['No Data']` bucket).

### C. `hideHarvested` semantics
- `analysisCount` — the filtered count actually used for the Slow/Normal/Fast tallies.
- `harvestedCount` — always `fullResults.filter(r => r.isHarvested === "Yes").length`, computed on the **unfiltered** results regardless of `hideHarvested`.
- `totalPlotsCount` — sourced in the renderer as `(plotsData && plotsData.length) ? plotsData.length : fullResults.length`, i.e. the **entire project's plot count**, not the count of plots that successfully returned growth data. `Plots under Analysis: X / Y` and `Harvested Plots: X / Y` denominators can therefore exceed `fullResults.length` when some plots aren't PR-enabled or failed to fetch growth/sustainability data.
- `plotsToBin` (an optional 3rd param) lets the caller bin a different, already-filtered array than the one used for the KPI totals; the renderer passes its own filtered `results` here while always computing KPI totals from `window.currentGrowthResults`.

### D. Per-bin `totalArea`
```js
if (res.auditedArea !== "NA") {
    bins[binIdx].totalArea += (parseFloat(res.auditedArea) || 0);
}
```
`"NA"` is **excluded** from the sum (not treated as `0`). Verified by the regression suite (Section 9).

### E. KPI bar (above the chart)
`growth-prog-under-analysis` / `growth-prog-harvested` render as zero-padded `"XX / YY"` (`String(n).padStart(2, '0')`); `growth-prog-slow` / `growth-prog-normal` / `growth-prog-fast` render as bare zero-padded counts. `growth-prog-total` is a hidden legacy placeholder kept only for backward compatibility — it is set but never displayed.

### F. Insight banner (`#growth-prog-insight-text`)
Four branches, evaluated in order:
1. `analysisCount === 0` → `"No plots currently under active growth analysis."`
2. `slowPlotsCount === 0` → `"<b>{onTrackCount} plots</b> are progressing <b>on track</b>."`
3. `onTrackCount === 0` → `"<b>{slowPlotsCount} plots</b> show <b>slow growth and require attention</b>."`
4. else → `"<b>{onTrackCount} plots</b> are progressing <b>on track</b>, while <b>{slowPlotsCount} plots</b> show <b>slow growth and require attention</b>"` — **note this 4th branch has no trailing period**, verbatim from source.

`onTrackCount = normalPlotsCount + fastPlotsCount`.

### G. "{count} Plots, {area} {unit}" bubble overlay (added 2026-09-23)
A custom Chart.js plugin, `growthProgressionTotalsPlugin` (`afterDatasetsDraw` hook), draws a white speech-bubble above each stacked bar, replacing an earlier version that only drew the bare stacked total as bold text with an underline. Built to match the Stage window chart's bubble (Section 4D) exactly — same geometry, same rules:

- **Area unit**: `(companyPrefs.areaUnits || 'ha').toLowerCase().includes('acre') ? 'Acre' : 'Ha'` — a **binary** label. Any `companyPrefs.areaUnits` value not containing the substring `'acre'` is labeled `'Ha'`, even if the tenant's actual configured unit is something else entirely (e.g. Bigha, Gunta, Square Meter). No unit *conversion* is applied — `auditedArea` is always shown in the company's own configured unit (per the Yield Module SOP's Section 3B unit-sourcing rules), only the display *label* is this Acre/Ha heuristic.
- **NA fallback**: bubble shows literal `"NA"` only when a bin's `totalArea === 0` **and** every plot in that bin has `auditedArea === "NA"`. A bin with a mix of numeric and `"NA"` areas shows the numeric sum (the `"NA"` plots simply contribute nothing), never `"NA"`.
- **Bubble text**: `` `${total} Plots, ${areaVal} ${areaUnit}` `` where `total` is the bin's combined Slow+Normal+Fast plot count.
- **Geometry**: bubble height `26px`, positioned `65px` above the top of the tallest stacked segment (`bY = topY - 65`), width = measured text width + `12px`, `4px` corner radius (falls back to a square corner if `ctx.roundRect` is unsupported), with a small downward-pointing triangle anchoring it to the bar. Text: `11px "Inter", sans-serif`, dark fill `#1e293b` on a light `#f8fafc` bubble.
- **Chart layout**: `padding: { top: 70, bottom: 10 }` — sized specifically to give the 26px-tall bubble (drawn 65px above the bar) headroom without clipping against the canvas top.

### H. Chart configuration
Stacked bar chart (`type: 'bar'`, `stack: 'growthProgressionStack'`), 3 datasets: `Slow Growth` (`#f6c445`), `Normal Growth` (`#264653`), `Fast Growth` (`#5cae57`), `barThickness: 45`. Clicking a bar drills into `showGrowthProgressionPlots(bins[index].label, bins[index].allPlots)`, whose table includes a `Daily Interpretation` column (the only one of the four drill-down tables that does).

---

## 4. Growth Stage Window Chart

**Canvas**: `growthStageChart` (card titled "Growth project data - Stage window"). **Render function**: `renderGrowthStageChart(results)`.

### A. Fixed stage bins
```js
const STAGE_ORDER = ["Emergence", "Tuber Initiation", "Tuber Bulking", "Harvested"];
```
Exactly 4 bins, in this fixed order — this list is **crop-agnostic and hardcoded**, not derived from the variety's actual configured crop stages.

### B. `isHarvested` overrides `currentStage`
```js
let stage = res.currentStage;
if (res.isHarvested === "Yes") { stage = "Harvested"; }
```
A plot's real `currentStage` from the growth-stage API (e.g. `"Tuber Bulking"`) is **discarded and overridden** to `"Harvested"` whenever the separate Sustainability-derived `isHarvested` flag (Section 2D) is `"Yes"`, regardless of what stage growth data actually reports.

### C. Bin matching — unmatched stages are silently dropped
```js
let bin = bins.find(b => b.label.toLowerCase() === (stage || "").toLowerCase());
if (bin) {
    bin.plots.push(res);
    if (res.auditedArea !== "NA") { bin.totalArea += (parseFloat(res.auditedArea) || 0); }
} else if (stage && stage !== "-") {
    console.warn(`[WARN] Unknown stage: ${stage} for plot ${res.plotName}`);
}
```
**Caveat**: exact case-insensitive match against the 4 `STAGE_ORDER` labels only. Any other `currentStage` (e.g. `"Flowering"`, `"Vegetative"`, or any crop-specific stage name not in the hardcoded list) is **excluded from every bin** — the plot vanishes from this chart entirely, with only a `console.warn`, no "Other/Misc" catch-all bin, and no user-visible indication that a plot is missing.

### D. "{count} Plots, {area} {unit}" bubble overlay
Custom plugin `stageCustomLabels`, registered alongside the shared `drawValuesPlugin`. Identical geometry, NA-fallback rule, and `areaUnit` source to the Growth Progression chart's bubble (Section 3G) — `bH = 26`, `bY = bar.y - 65`, same rounded-rect-plus-triangle draw, same `11px "Inter"` font. This is the pattern the Progression chart's bubble (Section 3G) was built to match.

### E. Chart configuration
Single-dataset (non-stacked) bar chart, `backgroundColor` array `['#22d3ee' /*Emergence*/, '#818cf8' /*Tuber Initiation*/, '#c084fc' /*Tuber Bulking*/, '#10b981' /*Harvested*/]`, `barThickness: 60`, y-axis visible with `stepSize: 1`. Tooltip shows `["Plots: N", "Area: X.XX Unit"]`. Clicking a bar drills into `showGrowthStagePlots(label, plots)`.

### F. Drill-down table columns
`Plot Name, Audited Area (Acre)†, Expected Harvest (Ton)†, Is Harvested, Date, Current Stage, Progression %, H-Start, H-End`. († See Section 8.4 — headers are hardcoded strings, not unit-aware.) `Is Harvested` cell is color-coded green (`#10b981`) for `'Yes'`, amber (`#f59e0b`) otherwise.

**Known bug**: the drill-down's close (X) button calls `closeGrowthStageDrillDown()`, which **is not defined anywhere in the codebase** — clicking it throws `ReferenceError`. Every other Growth drill-down correctly calls the shared `closeGrowthDrillDown(id)`. The table can still be dismissed indirectly (clicking another bar, or reloading data, re-hides it on next render).

---

## 5. Harvest Window Charts (Weekly & Daily)

Both bin plots by their **expected harvest production**, not by plot count — the bar value is the summed `expectedHarvestTon` for that time bucket. Both **unconditionally exclude harvested plots and plots with missing harvest-window dates**, independent of the "Hide Harvested Plots" checkbox (Section 6):
```js
if (p.isHarvested === "Yes" || !p.rawHStart || !p.rawHEnd) return;
```

### A. Weekly (`renderHarvestWindowChart`, canvas `harvestWindowChart`)
- Bins by the **Monday-start week** containing `p.rawHStart`.
- Also excludes weeks whose window has already fully elapsed: skip if `p.rawHEnd < currentWeekMon`.
- A plot whose window already started before this Monday (in-progress) is force-bucketed into the **current week** rather than its original start week.
- Shows only the **first 8** upcoming weeks.
- Bar value = sum of `p.expectedHarvestTon` for that week, explicitly excluding `"NA"`.
- Bubble offset: `bY = bar.y - 55` (see Section 8.9 — geometrically close to, but not identical to, the Progression/Stage bubbles' `-65` offset).
- Drill-down (`showHarvestWindowPlots`) columns: `Plot Name, Audited Area (Acre)†, Expected Harvest (Ton)†, Current Stage, Progression %, H-Start, H-End` — no `Is Harvested`/`Harvested Date` columns, since harvested plots never appear here.

### B. Daily (`renderHarvestWindowDailyChart`, canvas `harvestDailyChart`)
- Bins by exact calendar day of `p.rawHStart`.
- Excludes windows whose end date is **today or earlier**, anchored to **tomorrow** (not "this Monday" like the weekly chart): skip if `p.rawHEnd < tomorrow`.
- An in-progress plot (started before tomorrow) is force-bucketed into the "Tomorrow" bucket.
- Shows only the **first 7** upcoming days.
- Bubble offset: `bY = bar.y - 50`, with a smaller `10px` bubble font and `14px` value-label font (vs. `16px` on the Weekly chart) — see Section 8.9.
- Drill-down (`showHarvestWindowDailyPlots`) columns: identical to the Weekly drill-down.
- **Known bug (Section 8.8)**: this drill-down's cells render `(p.auditedArea || 0).toFixed(2)` with **no `"NA"`-string guard**, unlike every other Growth drill-down table. If `auditedArea` is the literal string `"NA"`, this throws a runtime `TypeError`.

### C. Area-unit labeling inconsistency
Both Weekly and Daily charts source their bubble's area-unit label as `companyPrefs.areaUnits || 'Acre'` **raw, unnormalized** — in contrast to the Progression/Stage charts' binary Acre/Ha normalization (Section 3G). A tenant configured in e.g. `"HECTARE"` would see `"Ha"` on the Progression/Stage bubbles and the literal string `"HECTARE"` on the Weekly/Daily bubbles. See Section 8.3.

---

## 6. "Hide Harvested Plots" Checkbox (`#hide-harvested-chart`)

Defaults **unchecked** on every new Growth data load. Driven by `updateGrowthChart()`:
```js
function updateGrowthChart() {
    if (!window.currentGrowthResults) return;
    const hideHarvested = document.getElementById('hide-harvested-chart')?.checked;
    const filteredResults = hideHarvested
        ? window.currentGrowthResults.filter(r => r.isHarvested !== "Yes")
        : window.currentGrowthResults;

    // Only Progression chart should be filtered per user request
    renderGrowthProgressionChart(filteredResults, !!hideHarvested);

    // Stage, Harvest Window (Weekly), and Harvest Window (Daily) should show all data
    renderGrowthStageChart(window.currentGrowthResults);
    renderHarvestWindowChart(window.currentGrowthResults);
    renderHarvestWindowDailyChart(window.currentGrowthResults);
}
```
**Only the Growth Progression chart is filtered by this checkbox** (per the code's own inline comments, quoted verbatim above). The Stage window, Harvest Window Weekly, and Harvest Window Daily charts always receive the full, unfiltered dataset.

**Nuance**: the two Harvest Window charts already unconditionally exclude harvested plots as part of their own binning logic (Section 5) — so in practice this checkbox is a no-op for them either way; it's genuinely only meaningful for the Progression and (implicitly, by never hiding them) Stage charts. The Stage window chart is the one place harvested plots are always visible, bucketed into the dedicated "Harvested" bin.

A **separate, independent** checkbox, `#hide-harvested-table` (`onchange="updateGrowthTable()"`), controls the Base Growth Table (Section 7) — it does not share state with `#hide-harvested-chart`.

---

## 7. Base Growth Table

Plain HTML table (not Chart.js), rendered by `renderGrowthTable(results)` into `#growth-table-container`, toggled via `window.toggleGrowthTableVisibility`, filtered/re-rendered by `updateGrowthTable()` and its own `#hide-harvested-table` checkbox.

**Columns** (each clickable to sort via `handleGrowthTableSort(col)`): `Plot Name, Audited Area, Expected Harvest, Is Harvested, Harvested Date, Current Stage, Progression, Daily Interpretation, Start Date, End Date`.

**`Daily Interpretation` column** (added 2026-09-22, per repo history): plain text cell, `${res.dailyInterpretation || '-'}` — no color-coding or badge, unlike `Is Harvested`'s green/amber treatment. Sorting falls through to the generic string/number comparison; there is no special-cased slow/normal/fast sort order for this column.

`dailyInterpretation` also appears in the Growth Progression drill-down table (Section 3H) but is **omitted** from the Stage, Weekly, and Daily drill-down tables.

---

## 8. Known Bugs, Caveats & Divergences (Audited 2026-09-23)

1. **Dead endpoint**: `/api/user-aggregate/growth-prediction` (Section 2A) returns a hardcoded mock and is never called by any client code. Do not build against it or assume it is live.
2. **Undefined function referenced in HTML**: the Stage window drill-down's close button calls `closeGrowthStageDrillDown()`, which doesn't exist anywhere in the codebase — throws `ReferenceError` on click (Section 4F).
3. **Inconsistent area-unit labeling across the 4 charts**: Progression/Stage bubbles normalize to a binary `Acre`/`Ha` label; Weekly/Daily bubbles use the raw, unnormalized `companyPrefs.areaUnits` string directly (Section 5C).
4. **Hardcoded drill-down table headers**: all 4 drill-down tables' HTML headers literally read `"Audited Area (Acre)"` / `"Expected Harvest (Ton)"` regardless of the tenant's actual configured units — static strings, not driven by `companyPrefs`/`areaUnit` at all, unlike the chart bubbles which at least attempt unit-awareness.
5. **`dailyInterpretation` "no data" collapses into "Normal"**: any value that doesn't contain `'slow'`/`'fast'` — including the `"-"` placeholder used when the API returns nothing — is counted as Normal Growth everywhere it's classified (Section 3B). There is no distinct "no data"/"unknown" bucket, unlike the Health Module's explicitly tracked one.
6. **Unmatched crop stages are silently dropped from the Stage window chart**: any `currentStage` not exactly matching one of the 4 hardcoded `STAGE_ORDER` labels excludes the plot from every bin, with only a `console.warn` (Section 4C).
7. **Dead/unused computed field**: `isConsideredInChart` is computed on every growth result in `processPlotGrowth()` but never read anywhere else in the codebase — vestigial.
8. **Latent crash risk in the Daily Harvest Window drill-down**: `showHarvestWindowDailyPlots()` renders `(p.auditedArea || 0).toFixed(2)` and `(p.expectedHarvestTon || 0).toFixed(2)` with **no `"NA"`-string guard**, unlike every other Growth drill-down table (which all explicitly check `p.auditedArea === "NA" ? "NA" : ...`). A plot whose `auditedArea`/`expectedHarvestTon` resolved to the literal string `"NA"` falling inside the next-7-days daily window will throw `TypeError: "NA".toFixed is not a function` (Section 5B).
9. **Minor bubble-geometry/font-size divergence across the 4 charts**, despite inline code comments claiming an exact match: Progression/Stage bubbles are offset `bar.y - 65` with `11px` font; the Weekly chart's bubble is offset `bar.y - 55`; the Daily chart's bubble is offset `bar.y - 50` with a `10px` bubble font and `14px` value-label font (vs. `16px` bold on Weekly). Only Progression vs. Stage are truly geometrically identical.
10. **`extractGrowthStageData()` trusts upstream sort order with no client-side date re-verification** (Section 2C) — a materially less defensive design than the Health Module's independently-verified "latest" logic.
11. **No request caching/dedup layer** for growth-stage or sustainability calls, unlike the Yield Module's `varietyDetailsCache` (Section 2E) — architecturally reasonable here since growth data is genuinely per-plot, but worth knowing there's no dedup to lean on.
12. **`totalPlotsCount` KPI denominator** comes from the full project's plot count (`plotsData.length`), not the count of plots that successfully returned growth data (Section 3C) — do not assume `Plots under Analysis` denominator equals `growthResults.length`.

---

## 9. Test Coverage

Exactly two Growth-specific regression tests exist in `Aggregate-Data-Testing/health_script.test.js`:

1. **`extractGrowthStageData_dailyInterpretation_and_latest_stage_extraction`** — imports `extractGrowthStageData` directly from `server.js`. Verifies first-matching-record selection from a 2-record mock, the `dailyInterpretation` `'-'` fallback when missing, and the `{ _rawEmpty: true }` response for an empty `records: []`.
2. **`computeProgressionMetrics_stacked_bins_and_insights_calculation`** — loads `aggregate_script_backup.js` into a Node `vm` sandbox (mocked DOM/Chart.js) and exercises `computeProgressionMetrics()` against a 100-mock-plot fixture for both `hideHarvested = true` and `false`, asserting per-bin plot counts, slow/normal/fast tallies, `onTrackCount`, and (added 2026-09-23 alongside the bubble feature) a dedicated 4-plot fixture verifying `bins[i].totalArea` correctly sums numeric `auditedArea` and excludes the `"NA"` sentinel.

**Coverage gap**: no tests exercise `renderGrowthStageChart`, `renderHarvestWindowChart`, `renderHarvestWindowDailyChart`, `processPlotGrowth()`'s field mapping, `syncGrowthWithYield()`, `updateGrowthChart()`'s checkbox-scoping behavior, or any of the four bubble-overlay plugins (`growthProgressionTotalsPlugin`, `stageCustomLabels`, `harvestCustomLabels`, `harvestDailyCustomLabels`) — these are Chart.js-canvas-rendering and DOM-wiring paths, consistent with how the Yield Module's `createTrendChart()` also has no dedicated unit test (only the data-computation functions feeding these renderers are unit-tested, matching this codebase's established testing pattern).

---

## 10. Change Log (Feature & Logic Audit Trail)

* **2026-09-23**: Created this SOP (module previously had none) via a full audit of the live Growth Module code, and added the Growth Progression chart's area bubble overlay:
  1. Added a `"{count} Plots, {area} {unit}"` speech-bubble overlay to the Growth Progression chart's `growthProgressionTotalsPlugin`, replacing the previous bare-number-with-underline display, matching the Stage window chart's existing `stageCustomLabels` bubble geometry and NA-fallback rules exactly (Section 3G).
  2. Increased the Growth Progression chart's `layout.padding.top` from `35` to `70` to give the taller bubble headroom without clipping, matching the Stage window chart's padding.
  3. Added a `bins[i].totalArea` NA-exclusion assertion to the existing `computeProgressionMetrics_stacked_bins_and_insights_calculation` regression test (34/34 tests passing — 0 new named test cases, extended an existing one).
  4. Audited and documented the entire module for the first time: all four charts, the backend proxy/extraction layer, the base table, the two independent "hide harvested" checkboxes, and 12 pre-existing bugs/caveats (Section 8) that were previously undocumented and, in several cases, live latent bugs (e.g. the undefined `closeGrowthStageDrillDown()`, the Daily drill-down's missing `"NA"` guard).
