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
- `res.usableArea` (added 2026-09-23) is looked up the same way, from `yieldInfo['Usable Area']`, with the same `"NA"` sentinel on no match.

### G. `usableArea` field — sourcing and threading (added 2026-09-23)
`usableArea` is a genuinely **distinct** field from `auditedArea` on the Croppable Area API — confirmed against `area_unit_testing/api_config.json`'s documented field paths for both `/services/farm/api/croppable-areas` and its `ext/croppable-areas` variant, which list `auditedArea.count` and `usableArea.count` as sibling fields (alongside `declaredArea.count` and `areaAudit.auditedArea`). It is **not** a relabeling of `auditedArea` and **not** the same value the Growth Progression legend's "Usable Area" row shows (that row, added earlier the same day, is actually `auditedArea` under a display label — see Section 3H — and was not renamed once this real field was wired in, since the legend's per-category breakdown is a separate feature from this base-table column).

Growth does not fetch Croppable Area data itself — like `auditedArea`/`expectedHarvestTon`, it borrows `usableArea` from the Yield Module's already-fetched CA data via the same `yieldInfo` lookup (Section 2F above), so `usableArea` is only populated in the Growth base table when Yield data has already been loaded for the project (the exact same pre-existing dependency `auditedArea` already has).

**Data flow**:
1. `server.js`'s `/api/user-aggregate/ca-details` route (proxying `/services/projections/api/croppableAreas/{caId}`) extracts `usableArea` defensively for either response shape (`jsonData.usableArea.count` or a raw `jsonData.usableArea` number), returning `null` — not `0` — when the field is genuinely absent, so a real `0` usable-area value is never mistaken for "missing" (unlike `auditedArea`'s extraction on the same route, which uses `|| 0` and cannot distinguish a real `0` from "absent" — a pre-existing, unrelated quirk, not something this change fixes).
2. Yield's `generateDataFromAPI()` (`aggregate_script_backup.js`) stores it on the row object as `'Usable Area': caData.usableArea` (`'NA'` if `null`/`undefined`), alongside the existing `'Audited Area'`.
3. Growth's `processPlotGrowth()` and `syncGrowthWithYield()` both read `yieldInfo['Usable Area']` into `res.usableArea`, mirroring the existing `auditedArea` lookup exactly.
4. The Base Growth Table (Section 7) renders it as a new `Usable Area` column, positioned immediately after `Audited Area`, with the same `"NA"`-string guard pattern as every column that can be `"NA"`.

**Caveat — unverified against a live response for this specific endpoint**: the `api_config.json` field paths above are documented against `/services/farm/api/croppable-areas` (the "farm" service). The live `ca-details` proxy actually calls `/services/projections/api/croppableAreas/{caId}` (the "projections" service, a **different** endpoint/service than the one `api_config.json` documents) — it was not possible to confirm `usableArea` is present on *that specific* endpoint's response without a live authenticated request against it. The extraction mirrors `auditedArea`'s already-proven dual-shape defensive pattern on this same route, so it will not error if the field is absent (it will simply resolve to `"NA"` throughout), but treat the assumption that this exact endpoint returns `usableArea` as unconfirmed until verified against a real response.

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
- `totalPlotsCount` — **corrected 2026-09-24**: sourced in the renderer as `(window.verifiedHealthPlots && window.verifiedHealthPlots.length) ? window.verifiedHealthPlots.length : fullResults.length`, i.e. the **PR-enabled (Plot Risk) plot count** — the exact same `window.verifiedHealthPlots` list `handleLoadGrowthData()` fetches Growth data for. `Plots under Analysis: X / Y` and `Harvested Plots: X / Y` denominators can still exceed `fullResults.length` when a PR-enabled plot's growth/sustainability fetch fails, but will no longer be inflated by plots that were never even PR-eligible for this module in the first place.
  - **Bug fixed 2026-09-24**: prior to this, `totalPlotsCount` was sourced from `plotsData.length` — the **entire project's plot count**, including non-PR-enabled plots Growth never attempts to fetch. A project with 59 total plots but only, say, 56 PR-enabled would show `"56 / 59"` even when growth analysis genuinely covered every eligible plot — misleadingly implying 3 plots were missing from analysis when they were simply out of scope for this module entirely.
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

- **Area field**: `bin.totalArea` sums `res.usableArea` (**corrected 2026-09-23** — was `auditedArea` when this bubble was first built; see Section 2G/8.14 for why these are distinct fields, and the dependency note in Section 3H for why this can show `"NA"` until Yield data is loaded).
- **Area unit**: `(companyPrefs.areaUnits || 'ha').toLowerCase().includes('acre') ? 'Acre' : 'Ha'` — a **binary** label. Any `companyPrefs.areaUnits` value not containing the substring `'acre'` is labeled `'Ha'`, even if the tenant's actual configured unit is something else entirely (e.g. Bigha, Gunta, Square Meter). No unit *conversion* is applied — the raw value is shown in the company's own configured unit, only the display *label* is this Acre/Ha heuristic.
- **NA fallback**: bubble shows literal `"NA"` only when a bin's `totalArea === 0` **and** every plot in that bin has `usableArea === "NA"`. A bin with a mix of numeric and `"NA"` areas shows the numeric sum (the `"NA"` plots simply contribute nothing), never `"NA"`.
- **Bubble text**: `` `${total} Plots, ${areaVal} ${areaUnit}` `` where `total` is the bin's combined Slow+Normal+Fast plot count.
- **Geometry**: bubble height `26px`, positioned `65px` above the top of the tallest stacked segment (`bY = topY - 65`), width = measured text width + `12px`, `4px` corner radius (falls back to a square corner if `ctx.roundRect` is unsupported), with a small downward-pointing triangle anchoring it to the bar. Text: `11px "Inter", sans-serif`, dark fill `#1e293b` on a light `#f8fafc` bubble.
- **Chart layout**: `padding: { top: 70, bottom: 10 }` — sized specifically to give the 26px-tall bubble (drawn 65px above the bar) headroom without clipping against the canvas top.

### H. "Number of Plots" / "Usable Area" custom legend (added 2026-09-23)
The native Chart.js legend is disabled (`legend: { display: false }`) and replaced by a custom two-row HTML legend block, `#growth-prog-custom-legend`, rendered directly in `aggregate_dashboard_backup.html` below the canvas (populated in `renderGrowthProgressionChart()`). It reuses the exact same 3 dataset colors as the bars (`#f6c445` Slow, `#264653` Normal, `#5cae57` Fast) — colors are **not** redefined for the legend, only referenced.

- **Row 1 ("Number of Plots")**: `metrics.slowPlotsCount` / `normalPlotsCount` / `fastPlotsCount` — the same values shown in the KPI bar (Section 3E) above the chart, so the legend and KPI bar are always in agreement.
- **Row 2 ("Usable Area ({unit})")**: `metrics.slowArea` / `normalArea` / `fastArea` — fields returned by `computeProgressionMetrics()`, computed inside the **same** `analysisPlots.forEach` loop that produces the Row 1 counts (not from `bins[]`), so a given category's plot count and area total are guaranteed to describe the identical set of plots. **Corrected 2026-09-23**: sourced from `res.usableArea` (the real Croppable Area API field, Section 2G), **not** `res.auditedArea` — these fields were briefly conflated when this legend was first built (before `usableArea` existed in the codebase); both the legend's label and its underlying data now genuinely agree. Uses the same `usableArea !== "NA"` exclusion rule as `bins[i].totalArea` below — an `"NA"` plot contributes `0` to its category's area, never breaks the sum. The `{unit}` in the row title uses the same binary Acre/Ha label as the bubble overlay (Section 3G).
- **Dependency**: since `usableArea` (Section 2G) is only populated when Yield data has already been loaded for the project, this legend's Row 2 (and the bubble overlay's area figure, Section 3G) will show `"NA"`/`0.00` for every category until the Yield tab has been loaded at least once — same pre-existing dependency `auditedArea` always had, just now inherited by this legend too.
- Element ids: `growth-prog-legend-{slow,normal,fast}-count`, `growth-prog-legend-{slow,normal,fast}-area`, `growth-prog-legend-area-title`. Reset to `-` in the project-switch `simpleMetricIds` list alongside the KPI bar's own ids.

### I. Chart configuration
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

**Columns** (each clickable to sort via `handleGrowthTableSort(col)`): `Plot Name, Audited Area, Usable Area, Expected Harvest, Is Harvested, Harvested Date, Current Stage, Progression, Daily Interpretation, Start Date, End Date`.

**`Usable Area` column** (added 2026-09-23): positioned immediately after `Audited Area`, per the request that added it. Cell renders `${res.usableArea === "NA" || res.usableArea === undefined ? "NA" : (parseFloat(res.usableArea) || 0).toFixed(2)}` — see Section 2G for the full sourcing chain and its "unverified against a live response" caveat. Sorting uses the same generic string/number comparison as every other numeric-or-`"NA"` column (no special-casing).

**`Daily Interpretation` column** (added 2026-09-22, per repo history): plain text cell, `${res.dailyInterpretation || '-'}` — no color-coding or badge, unlike `Is Harvested`'s green/amber treatment. Sorting falls through to the generic string/number comparison; there is no special-cased slow/normal/fast sort order for this column.

`dailyInterpretation` also appears in the Growth Progression drill-down table (Section 3I) but is **omitted** from the Stage, Weekly, and Daily drill-down tables. `usableArea` is **not** added to any of the four drill-down tables (Sections 3-5) — only the base table, per the request that added it.

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
12. ~~`totalPlotsCount` KPI denominator comes from the full project's plot count~~ — **fixed 2026-09-24**: now sourced from `window.verifiedHealthPlots.length` (PR-enabled plots only), not `plotsData.length` (Section 3C). Still worth knowing: even the corrected denominator can exceed `fullResults.length` if a PR-enabled plot's growth/sustainability fetch itself fails — `Plots under Analysis`'s denominator is "PR-eligible", not "successfully fetched".
13. **`usableArea` (Section 2G/7) depends on Yield data being loaded first**, same as `auditedArea`/`expectedHarvestTon` — if a project's Yield tab hasn't been loaded, the base table's `Usable Area` column shows `"NA"` for every row even when the plots genuinely have a configured usable area, since Growth never fetches Croppable Area data on its own. Its presence on the live `/services/projections/api/croppableAreas/{caId}` response was not verified against a real authenticated request — see Section 2G.
14. ~~Two unrelated "usable area" concepts coexist in the same module~~ — **resolved 2026-09-23**: the Growth Progression chart's legend (Section 3H) and bubble overlay (Section 3G) were switched from `auditedArea` to the real `usableArea` field the same day this caveat was written, specifically so they'd match the Base Growth Table's `Usable Area` column (Section 7). All three now consistently source `res.usableArea`. Kept here as a historical note: if you see `auditedArea` reintroduced into any Growth Progression code path, that would be a regression back to the original conflation this entry used to describe.

---

## 9. Test Coverage

Exactly two Growth-specific regression tests exist in `Aggregate-Data-Testing/health_script.test.js`:

1. **`extractGrowthStageData_dailyInterpretation_and_latest_stage_extraction`** — imports `extractGrowthStageData` directly from `server.js`. Verifies first-matching-record selection from a 2-record mock, the `dailyInterpretation` `'-'` fallback when missing, and the `{ _rawEmpty: true }` response for an empty `records: []`.
2. **`computeProgressionMetrics_stacked_bins_and_insights_calculation`** — loads `aggregate_script_backup.js` into a Node `vm` sandbox (mocked DOM/Chart.js) and exercises `computeProgressionMetrics()` against a 100-mock-plot fixture for both `hideHarvested = true` and `false`, asserting per-bin plot counts, slow/normal/fast tallies, `onTrackCount`, and (added 2026-09-23 alongside the bubble feature) a dedicated 4-plot fixture verifying `bins[i].totalArea` correctly sums numeric `auditedArea` and excludes the `"NA"` sentinel.

**Coverage gap**: no tests exercise `renderGrowthStageChart`, `renderHarvestWindowChart`, `renderHarvestWindowDailyChart`, `processPlotGrowth()`'s field mapping, `syncGrowthWithYield()`, `updateGrowthChart()`'s checkbox-scoping behavior, or any of the four bubble-overlay plugins (`growthProgressionTotalsPlugin`, `stageCustomLabels`, `harvestCustomLabels`, `harvestDailyCustomLabels`) — these are Chart.js-canvas-rendering and DOM-wiring paths, consistent with how the Yield Module's `createTrendChart()` also has no dedicated unit test (only the data-computation functions feeding these renderers are unit-tested, matching this codebase's established testing pattern).

---

## 10. Change Log (Feature & Logic Audit Trail)

* **2026-09-24**: Fixed `Plots under Analysis` / `Harvested Plots` KPI Denominator to Use PR-Enabled Plot Count, Not the Full Project's Plot Count:
  1. Root cause: `renderGrowthProgressionChart()` sourced `totalPlotsCount` from `plotsData.length` — every plot in the selected project(s), regardless of Plot Risk eligibility — while the Growth module only ever fetches and analyzes `window.verifiedHealthPlots` (the PR-enabled subset). A project with, say, 59 total plots but only 56 PR-enabled showed `"56 / 59"` even when every eligible plot had in fact been analyzed, misleadingly implying 3 plots were missing from analysis rather than simply being out of scope for this module.
  2. Fixed in `aggregate_script_backup.js`: `totalPlotsCount` now sources from `window.verifiedHealthPlots.length` (falling back to `fullResults.length` if that list is unavailable), matching the exact plot list `handleLoadGrowthData()` iterates when fetching Growth data.
  3. No new regression test: `totalPlotsCount` is a parameter passed *into* `computeProgressionMetrics()`, not something that function derives itself — the existing test already exercises the pure calculation with an explicit value; this fix is in the DOM-wiring renderer that supplies that value, consistent with this module's established pattern of not unit-testing chart-rendering functions (34/34 tests passing, 0 new).
* **2026-09-23**: Switched the Growth Progression Chart's Legend and Bubble Overlay from `auditedArea` to the Real `usableArea` Field:
  1. This directly follows the entry below (which added `usableArea` to the Base Growth Table): once the real `usableArea` field existed, the Growth Progression chart's legend and bubble — which had been labeled "Usable Area" but sourced `auditedArea` — were switched to actually source `usableArea`, resolving the "two unrelated usable area concepts" caveat (Section 8.14) the entry below had just introduced.
  2. `computeProgressionMetrics()`: the `analysisPlots.forEach` loop's `slowArea`/`normalArea`/`fastArea` accumulation and the `targetPlots.forEach` loop's `bins[i].totalArea` accumulation both now read `res.usableArea` (with the same `"NA"`-exclusion rule) instead of `res.auditedArea`.
  3. `growthProgressionTotalsPlugin`'s bubble NA-fallback check (`bin.allPlots.every(...)`) now checks `p.usableArea === "NA"` instead of `p.auditedArea === "NA"`.
  4. Updated the `computeProgressionMetrics_stacked_bins_and_insights_calculation` regression test's area fixture to use `usableArea` instead of `auditedArea` (34/34 tests passing — 0 new named test cases, existing fixture updated).
  5. **New dependency to be aware of**: since `usableArea` is only populated after Yield data has been loaded (Section 2G), the Growth Progression chart's legend Row 2 and bubble overlay will now show `"NA"`/`0.00` until the Yield tab has been loaded at least once for the project — this dependency didn't exist for this specific chart before (it relied on `auditedArea`, which has the identical dependency, so the practical difference is negligible, but worth knowing explicitly).
* **2026-09-23**: Added the Real `usableArea` Field (from the Croppable Area API) to the Base Growth Table:
  1. **Correction to the entry directly below**: that entry's item 3 states "there is no distinct 'usable area' concept anywhere in the API or codebase" — this was true for the Growth Progression legend's data at the time, but a genuine `usableArea.count` field **does** exist on the Croppable Area API (confirmed via `area_unit_testing/api_config.json`'s documented field paths, Section 2G) and is unrelated to that legend's `auditedArea`-based row. The two features use the word "usable area" to mean two different things — see Section 2G for the disambiguation.
  2. Extended `server.js`'s `/api/user-aggregate/ca-details` route to extract `usableArea` (defensively handling both the `{count: N}` object shape and a raw-number shape, same pattern as the existing `auditedArea` extraction) and return it alongside `auditedArea`.
  3. Threaded `usableArea` through the existing Yield→Growth data-borrowing pipeline: Yield's row object gains a `'Usable Area'` field; Growth's `processPlotGrowth()` and `syncGrowthWithYield()` both read it into `res.usableArea`, mirroring `auditedArea`'s existing lookup exactly (Section 2G).
  4. Added a new `Usable Area` column to the Base Growth Table (Section 7), positioned immediately after `Audited Area`, sortable via the table's existing generic sort logic — no drill-down tables were changed, per the request's scope (base table only).
  5. This field could not be verified against a live authenticated response for the exact endpoint (`/services/projections/api/croppableAreas/{caId}`) the live proxy calls, which differs from the endpoint `api_config.json` documents (`/services/farm/api/croppable-areas`) — flagged explicitly as an unverified assumption in Section 2G. If the field turns out to be absent on this specific endpoint, every consumer already resolves to `"NA"` rather than erroring.
* **2026-09-23**: Added "Number of Plots" / "Usable Area" Custom Legend to the Growth Progression Chart:
  1. Disabled the native Chart.js legend (`legend: { display: false }`) on the Growth Progression chart and replaced it with a custom two-row HTML legend (`#growth-prog-custom-legend`) showing both plot count and total area per Slow/Normal/Fast Growth category, using the exact same 3 dataset colors as the bars (no color changes, per explicit request).
  2. Added `slowArea`/`normalArea`/`fastArea` to `computeProgressionMetrics()`'s return value, computed in the same `analysisPlots.forEach` loop (and using the same `"NA"`-exclusion rule) that already produced `slowPlotsCount`/`normalPlotsCount`/`fastPlotsCount`, guaranteeing the legend's two rows always describe the identical plot sets.
  3. Labeled the area row "Usable Area" per the request, though the underlying field is `auditedArea` (this legend's own data, not the `usableArea` field added in the entry above) — a display-label choice made before the real `usableArea` field existed in this codebase; see the correction above.
  4. Added `slowArea`/`normalArea`/`fastArea` assertions to the existing `computeProgressionMetrics_stacked_bins_and_insights_calculation` regression test (34/34 tests passing — 0 new named test cases, extended an existing one).
  5. Added the new legend's 6 element ids to the project-switch `simpleMetricIds` reset list so they clear to `-` alongside the existing KPI bar.
* **2026-09-23**: Created this SOP (module previously had none) via a full audit of the live Growth Module code, and added the Growth Progression chart's area bubble overlay:
  1. Added a `"{count} Plots, {area} {unit}"` speech-bubble overlay to the Growth Progression chart's `growthProgressionTotalsPlugin`, replacing the previous bare-number-with-underline display, matching the Stage window chart's existing `stageCustomLabels` bubble geometry and NA-fallback rules exactly (Section 3G).
  2. Increased the Growth Progression chart's `layout.padding.top` from `35` to `70` to give the taller bubble headroom without clipping, matching the Stage window chart's padding.
  3. Added a `bins[i].totalArea` NA-exclusion assertion to the existing `computeProgressionMetrics_stacked_bins_and_insights_calculation` regression test (34/34 tests passing — 0 new named test cases, extended an existing one).
  4. Audited and documented the entire module for the first time: all four charts, the backend proxy/extraction layer, the base table, the two independent "hide harvested" checkboxes, and 12 pre-existing bugs/caveats (Section 8) that were previously undocumented and, in several cases, live latent bugs (e.g. the undefined `closeGrowthStageDrillDown()`, the Daily drill-down's missing `"NA"` guard).
