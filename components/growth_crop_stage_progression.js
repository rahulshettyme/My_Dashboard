/**
 * Crop Stage Progression — per-plot season card for the Growth module.
 *
 * Fully self-contained and ADDITIVE: it does not modify any existing Growth function. It only
 *   1. reads window.currentGrowthResults (already produced by handleLoadGrowthData) for the plot list,
 *   2. calls the additive /api/user-aggregate/growth-stage-history route (same upstream
 *      growthstage API the Growth module already uses, paged to cover the whole season),
 *   3. composes onto window.handleLoadGrowthData (calls the original untouched, then refreshes).
 *
 * See GROWTH_MODULE_SOP.md Section 11.
 */
(function () {
    'use strict';

    // Dark-mode categorical slots (dataviz reference palette), validated against the card surface
    // #1e293b. Assigned to stages in chronological order of first appearance — never cycled by rank.
    const STAGE_COLORS = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'];
    // Same Slow/Normal/Fast colors as the existing Growth Progression chart, for consistency.
    const RATE_STYLES = {
        slow: { label: 'Slow Growth', color: '#f6c445', icon: 'fa-exclamation-triangle' },
        normal: { label: 'Normal Growth', color: '#5cae57', icon: 'fa-check-circle' },
        fast: { label: 'Fast Growth', color: '#38bdf8', icon: 'fa-forward' },
        unknown: { label: 'Not available', color: '#94a3b8', icon: 'fa-question-circle' }
    };
    const DAY_MS = 24 * 60 * 60 * 1000;
    const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    // -------------------------------------------------------------------------------------------
    // Pure helpers (exported for the Node regression suite)
    // -------------------------------------------------------------------------------------------

    function classifyGrowthRate(interp) {
        const s = String(interp || '').toLowerCase().trim();
        if (!s || s === '-') return 'unknown';
        if (s.includes('slow')) return 'slow';
        if (s.includes('fast')) return 'fast';
        return 'normal';
    }

    /**
     * Turns the history route's records into the chart/card model.
     * - progression: series-level scaling — only if EVERY value is <= 1 is the series treated as a
     *   0-1 fraction (a single early 0.5% reading must not be read as 50%). Clamped to 0-100.
     * - stages: contiguous runs of the same stage name (case-insensitive). A stage name keeps the
     *   same color even if it re-appears later in the season.
     */
    function buildCropStageProgressionModel(records) {
        const valid = (Array.isArray(records) ? records : [])
            .filter(r => r && r.cropStageName && !isNaN(new Date(r.date).getTime()))
            .slice()
            .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

        if (valid.length === 0) return { points: [], stages: [], latest: null, firstDate: null, lastDate: null, stageColors: {} };

        const nums = valid.map(r => parseFloat(r.seasonProgression)).filter(v => !isNaN(v));
        const isFraction = nums.length > 0 && nums.every(v => v <= 1);

        const stageColors = {};
        let colorIdx = 0;
        const points = valid.map(r => {
            const key = String(r.cropStageName).trim().toLowerCase();
            if (!(key in stageColors)) {
                stageColors[key] = STAGE_COLORS[Math.min(colorIdx, STAGE_COLORS.length - 1)];
                colorIdx++;
            }
            let p = parseFloat(r.seasonProgression);
            if (isNaN(p)) p = null;
            else {
                if (isFraction) p = p * 100;
                p = Math.max(0, Math.min(100, p));
            }
            return {
                time: new Date(r.date).getTime(),
                stage: String(r.cropStageName).trim(),
                stageKey: key,
                progression: p,
                rate: classifyGrowthRate(r.dailyInterpretation),
                dailyInterpretation: r.dailyInterpretation || null
            };
        });

        const stages = [];
        points.forEach((pt, i) => {
            const last = stages[stages.length - 1];
            if (last && last.key === pt.stageKey) {
                last.endIdx = i;
                last.end = pt.time;
            } else {
                stages.push({ name: pt.stage, key: pt.stageKey, color: stageColors[pt.stageKey], startIdx: i, endIdx: i, start: pt.time, end: pt.time });
            }
        });
        stages.forEach((s, i) => {
            // Duration runs until the next stage begins (or the last record for the current stage).
            const until = stages[i + 1] ? stages[i + 1].start : s.end;
            s.days = Math.max(1, Math.round((until - s.start) / DAY_MS) + (stages[i + 1] ? 0 : 1));
        });

        const latestRecord = valid[valid.length - 1];
        return {
            points,
            stages,
            stageColors,
            firstDate: points[0].time,
            lastDate: points[points.length - 1].time,
            latest: Object.assign({}, latestRecord, {
                progression: points[points.length - 1].progression,
                rate: points[points.length - 1].rate,
                daysInStage: stages[stages.length - 1].days
            })
        };
    }

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { buildCropStageProgressionModel, classifyGrowthRate, STAGE_COLORS };
    }
    if (typeof window === 'undefined' || typeof document === 'undefined' || !document.querySelector) return;

    // -------------------------------------------------------------------------------------------
    // UI
    // -------------------------------------------------------------------------------------------

    const state = { plots: [], selectedCaId: null, chart: null, cache: new Map(), requestSeq: 0, highlighted: -1 };
    const $ = (id) => document.getElementById(id);

    function fmtShort(t) {
        const d = new Date(t);
        return `${MONTHS[d.getMonth()]} ${String(d.getDate()).padStart(2, '0')}`;
    }
    function fmtFull(t) {
        const d = new Date(t);
        if (isNaN(d.getTime())) return '-';
        return `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`;
    }
    function env() { return (typeof currentEnvironment !== 'undefined') ? currentEnvironment : null; }
    function token() { return (typeof authToken !== 'undefined') ? authToken : null; }
    function serverUrl() { return (typeof getServerUrl === 'function') ? getServerUrl() : ''; }

    function setText(id, text) { const el = $(id); if (el) el.textContent = text; }

    function showState(kind, message) {
        // kind: 'chart' | 'loading' | 'empty' | 'error'
        const body = $('csp-body');
        const msg = $('csp-message');
        if (!body || !msg) return;
        body.classList.toggle('hidden', kind !== 'chart');
        msg.classList.toggle('hidden', kind === 'chart');
        if (kind !== 'chart') {
            const icon = kind === 'loading' ? 'fa-spinner fa-spin' : (kind === 'error' ? 'fa-exclamation-circle' : 'fa-seedling');
            msg.innerHTML = '';
            const i = document.createElement('i');
            i.className = `fas ${icon}`;
            i.style.cssText = 'font-size: 1.5rem; margin-bottom: 0.6rem; display: block; color: var(--text-secondary);';
            const p = document.createElement('div');
            p.textContent = message;
            msg.appendChild(i);
            msg.appendChild(p);
        }
    }

    function resetCard() {
        state.plots = [];
        state.selectedCaId = null;
        state.cache.clear();
        state.requestSeq++;
        if (state.chart) { state.chart.destroy(); state.chart = null; }
        const search = $('csp-plot-search');
        if (search) search.value = '';
        showState('empty', 'Load Growth Data to view per-plot crop stage progression.');
    }

    function initCard() {
        const results = Array.isArray(window.currentGrowthResults) ? window.currentGrowthResults : [];
        const seen = new Set();
        state.plots = results
            .filter(r => r && r.caId && !seen.has(String(r.caId)) && seen.add(String(r.caId)))
            .map(r => ({ caId: String(r.caId), name: r.plotName || String(r.caId), harvested: r.isHarvested === 'Yes' }))
            .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));

        setText('csp-plot-count', state.plots.length ? `${state.plots.length} plots` : '');
        if (state.plots.length === 0) {
            showState('empty', 'No plots with growth data for the selected project(s).');
            return;
        }
        selectPlot(state.plots[0].caId);
    }

    // --- Searchable plot dropdown (same look as the Yield module's plot selector) ---------------
    function renderOptions(query) {
        const list = $('csp-plot-list');
        if (!list) return;
        list.innerHTML = '';
        const q = (query || '').toLowerCase();
        const filtered = state.plots.filter(p => p.name.toLowerCase().includes(q) || p.caId.includes(q));
        if (filtered.length === 0) {
            list.innerHTML = '<div class="dropdown-no-results">No plots found</div>';
            return;
        }
        filtered.forEach(p => {
            const item = document.createElement('div');
            item.className = 'dropdown-item' + (p.caId === state.selectedCaId ? ' selected' : '');
            item.dataset.value = p.caId;
            item.textContent = p.name;
            if (p.harvested) {
                const tag = document.createElement('span');
                tag.textContent = 'Harvested';
                tag.style.cssText = 'margin-left: 0.5rem; font-size: 0.7rem; padding: 1px 6px; border-radius: 999px; border: 1px solid var(--border-color); color: var(--text-secondary);';
                item.appendChild(tag);
            }
            item.addEventListener('mousedown', (e) => { e.preventDefault(); selectPlot(p.caId); });
            list.appendChild(item);
        });
    }

    function closeList() { const list = $('csp-plot-list'); if (list) list.classList.remove('show'); }

    function wireDropdown() {
        const search = $('csp-plot-search');
        const list = $('csp-plot-list');
        if (!search || !list || search.dataset.wired) return;
        search.dataset.wired = '1';
        search.addEventListener('focus', function () { this.select(); state.highlighted = -1; renderOptions(''); list.classList.add('show'); });
        search.addEventListener('input', (e) => { state.highlighted = -1; renderOptions(e.target.value); list.classList.add('show'); });
        search.addEventListener('keydown', (e) => {
            const items = list.querySelectorAll('.dropdown-item');
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                state.highlighted = e.key === 'ArrowDown' ? Math.min(state.highlighted + 1, items.length - 1) : Math.max(state.highlighted - 1, 0);
                items.forEach((it, i) => it.classList.toggle('highlighted', i === state.highlighted));
                if (items[state.highlighted]) items[state.highlighted].scrollIntoView({ block: 'nearest' });
            } else if (e.key === 'Enter') {
                e.preventDefault();
                if (items[state.highlighted]) selectPlot(items[state.highlighted].dataset.value);
            } else if (e.key === 'Escape') {
                closeList(); search.blur();
            }
        });
        search.addEventListener('blur', () => {
            setTimeout(() => {
                closeList();
                const p = state.plots.find(x => x.caId === state.selectedCaId);
                search.value = p ? p.name : '';
            }, 120);
        });
    }

    function navigate(step) {
        if (!state.plots.length) return;
        const idx = state.plots.findIndex(p => p.caId === state.selectedCaId);
        const next = (idx + step + state.plots.length) % state.plots.length;
        selectPlot(state.plots[next].caId);
    }

    // --- Data ------------------------------------------------------------------------------------
    async function selectPlot(caId) {
        const plot = state.plots.find(p => p.caId === String(caId));
        if (!plot) return;
        state.selectedCaId = plot.caId;
        const search = $('csp-plot-search');
        if (search) { search.value = plot.name; search.blur(); }
        closeList();
        const idx = state.plots.indexOf(plot);
        setText('csp-plot-count', `${idx + 1} of ${state.plots.length} plots`);

        const cacheKey = `${env()}|${plot.caId}`;
        if (state.cache.has(cacheKey)) { render(plot, state.cache.get(cacheKey)); return; }

        const seq = ++state.requestSeq;
        showState('loading', `Loading season history for ${plot.name}...`);
        try {
            const resp = await fetch(`${serverUrl()}/api/user-aggregate/growth-stage-history?environment=${encodeURIComponent(env() || '')}&caIds=${encodeURIComponent(plot.caId)}`, {
                headers: { 'Authorization': `Bearer ${token()}` }
            });
            const data = await resp.json().catch(() => ({}));
            if (!resp.ok) throw new Error(data.error || `Request failed (${resp.status})`);
            const model = buildCropStageProgressionModel(data.records);
            state.cache.set(cacheKey, model);
            if (seq !== state.requestSeq) return; // a newer selection superseded this one
            render(plot, model);
        } catch (err) {
            if (seq !== state.requestSeq) return;
            console.error('[Crop Stage Progression] load failed:', err);
            showState('error', `Could not load crop stage history for ${plot.name}: ${err.message}`);
        }
    }

    // --- Rendering -------------------------------------------------------------------------------
    function render(plot, model) {
        if (!model || model.points.length === 0) {
            if (state.chart) { state.chart.destroy(); state.chart = null; }
            showState('empty', `No crop stage records available for ${plot.name}.`);
            return;
        }
        showState('chart');
        const latest = model.latest;
        const currentColor = model.stageColors[String(latest.cropStageName).trim().toLowerCase()];

        // KPI tiles
        setText('csp-sowing', fmtFull(model.firstDate));
        const stageEl = $('csp-stage');
        if (stageEl) {
            stageEl.innerHTML = '';
            const dot = document.createElement('span');
            dot.className = 'csp-dot';
            dot.style.background = currentColor;
            stageEl.appendChild(dot);
            stageEl.appendChild(document.createTextNode(latest.cropStageName));
        }
        setText('csp-stage-sub', `${latest.daysInStage} day${latest.daysInStage === 1 ? '' : 's'} in stage`);
        const prog = latest.progression;
        setText('csp-progress', prog === null ? '-' : `${prog.toFixed(2)}%`);
        const bar = $('csp-progress-bar');
        if (bar) { bar.style.width = `${prog === null ? 0 : prog}%`; bar.style.background = currentColor; }

        const rate = RATE_STYLES[latest.rate] || RATE_STYLES.unknown;
        const rateEl = $('csp-rate');
        if (rateEl) {
            rateEl.innerHTML = '';
            const i = document.createElement('i');
            i.className = `fas ${rate.icon}`;
            i.style.color = rate.color;
            rateEl.appendChild(i);
            rateEl.appendChild(document.createTextNode(' ' + (latest.rate === 'unknown' ? rate.label : (latest.dailyInterpretation || rate.label))));
        }

        const hs = latest.harvestWindowStartDate, he = latest.harvestWindowEndDate;
        setText('csp-harvest', (hs || he) ? `${fmtFull(hs)} → ${fmtFull(he)}` : 'Not available');
        let harvestSub = '';
        if (hs && !isNaN(new Date(hs).getTime())) {
            const today = new Date(); today.setHours(0, 0, 0, 0);
            const diff = Math.round((new Date(hs).setHours(0, 0, 0, 0) - today.getTime()) / DAY_MS);
            const endPassed = he && new Date(he).setHours(0, 0, 0, 0) < today.getTime();
            harvestSub = endPassed ? 'Window has passed' : (diff > 0 ? `Opens in ${diff} day${diff === 1 ? '' : 's'}` : 'Window open now');
        }
        setText('csp-harvest-sub', harvestSub);

        // Diagnosis
        const diag = [latest.stageInterpretation, latest.overAllInterpretation].filter(Boolean);
        const diagWrap = $('csp-diagnosis');
        if (diagWrap) {
            diagWrap.classList.toggle('hidden', diag.length === 0);
            setText('csp-diagnosis-text', diag.join(' '));
        }

        // Stage timeline chips (direct labels for every stage color)
        const tl = $('csp-timeline');
        if (tl) {
            tl.innerHTML = '';
            model.stages.forEach((s, i) => {
                const chip = document.createElement('div');
                chip.className = 'csp-chip' + (i === model.stages.length - 1 ? ' csp-chip-current' : '');
                chip.style.flexGrow = String(Math.max(1, s.days));
                chip.style.borderTopColor = s.color;
                const name = document.createElement('div');
                name.className = 'csp-chip-name';
                name.textContent = s.name;
                const meta = document.createElement('div');
                meta.className = 'csp-chip-meta';
                meta.textContent = `${fmtShort(s.start)} – ${fmtShort(s.end)} · ${s.days}d`;
                chip.title = `${s.name}: ${fmtFull(s.start)} to ${fmtFull(s.end)} (${s.days} days)`;
                chip.appendChild(name);
                chip.appendChild(meta);
                tl.appendChild(chip);
            });
        }

        setText('csp-updated', `Updated ${fmtFull(model.lastDate)} · ${model.points.length} daily records`);
        drawChart(model);
    }

    const crosshairPlugin = {
        id: 'cspCrosshair',
        afterDatasetsDraw(chart) {
            const active = chart.tooltip && chart.tooltip.getActiveElements ? chart.tooltip.getActiveElements() : [];
            if (!active.length) return;
            const x = active[0].element.x;
            const { top, bottom } = chart.chartArea;
            const ctx = chart.ctx;
            ctx.save();
            ctx.strokeStyle = 'rgba(148, 163, 184, 0.55)';
            ctx.lineWidth = 1;
            ctx.setLineDash([4, 4]);
            ctx.beginPath();
            ctx.moveTo(x, top);
            ctx.lineTo(x, bottom);
            ctx.stroke();
            ctx.restore();
        }
    };

    function hexToRgba(hex, a) {
        const h = hex.replace('#', '');
        const n = parseInt(h, 16);
        return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
    }

    function drawChart(model) {
        const canvas = $('csp-chart');
        if (!canvas || typeof Chart === 'undefined') return;
        if (state.chart) { state.chart.destroy(); state.chart = null; }

        const labels = model.points.map(p => fmtShort(p.time));
        // One dataset per stage segment; each segment also includes the next segment's first point
        // so the line and fill are continuous across stage changes (no gaps).
        const datasets = model.stages.map((s, si) => {
            const lastIdx = model.stages[si + 1] ? model.stages[si + 1].startIdx : s.endIdx;
            const data = model.points.map((p, i) => (i >= s.startIdx && i <= lastIdx) ? p.progression : null);
            return {
                label: s.name,
                data,
                borderColor: s.color,
                borderWidth: 2,
                pointRadius: 0,
                pointHoverRadius: 5,
                pointHoverBackgroundColor: s.color,
                pointHoverBorderColor: '#1e293b',
                pointHoverBorderWidth: 2,
                tension: 0.2,
                spanGaps: false,
                fill: 'origin',
                backgroundColor: (ctx) => {
                    const area = ctx.chart.chartArea;
                    if (!area) return hexToRgba(s.color, 0.2);
                    const g = ctx.chart.ctx.createLinearGradient(0, area.top, 0, area.bottom);
                    g.addColorStop(0, hexToRgba(s.color, 0.38));
                    g.addColorStop(1, hexToRgba(s.color, 0.03));
                    return g;
                }
            };
        });

        state.chart = new Chart(canvas.getContext('2d'), {
            type: 'line',
            data: { labels, datasets },
            plugins: [crosshairPlugin],
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: { duration: 400 },
                interaction: { mode: 'index', intersect: false },
                layout: { padding: { top: 8, right: 8 } },
                plugins: {
                    legend: { display: false }, // stage timeline chips above act as the labeled legend
                    datalabels: { display: false },
                    tooltip: {
                        backgroundColor: '#0f172a',
                        borderColor: '#334155',
                        borderWidth: 1,
                        titleColor: '#f8fafc',
                        bodyColor: '#cbd5e1',
                        padding: 10,
                        displayColors: true,
                        // Boundary points belong to two segments; show each date only once.
                        filter: (item, i, arr) => arr.findIndex(x => x.dataIndex === item.dataIndex) === i,
                        callbacks: {
                            title: (items) => items.length ? fmtFull(model.points[items[0].dataIndex].time) : '',
                            label: (item) => {
                                const p = model.points[item.dataIndex];
                                return ` ${p.stage}: ${p.progression === null ? '-' : p.progression.toFixed(2) + '%'}`;
                            },
                            labelColor: (item) => {
                                const c = model.stageColors[model.points[item.dataIndex].stageKey];
                                return { borderColor: c, backgroundColor: c, borderRadius: 2 };
                            },
                            afterLabel: (item) => {
                                const p = model.points[item.dataIndex];
                                return p.dailyInterpretation ? ` ${p.dailyInterpretation}` : '';
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        grid: { color: 'rgba(148, 163, 184, 0.08)' },
                        border: { color: '#334155' },
                        ticks: { color: '#94a3b8', autoSkip: true, maxTicksLimit: 12, maxRotation: 0, font: { size: 11 } }
                    },
                    y: {
                        min: 0,
                        max: 100,
                        grid: { color: 'rgba(148, 163, 184, 0.1)' },
                        border: { display: false },
                        ticks: { color: '#94a3b8', stepSize: 20, callback: (v) => `${v}%`, font: { size: 11 } },
                        title: { display: true, text: 'Season progression', color: '#94a3b8', font: { size: 11 } }
                    }
                }
            }
        });
    }

    // -------------------------------------------------------------------------------------------
    // Wiring
    // -------------------------------------------------------------------------------------------
    window.cspNavigatePlot = navigate;
    window.refreshCropStageProgressionCard = initCard;

    function wire() {
        wireDropdown();
        resetCard();
        // If growth data is already loaded (e.g. script injected late), populate immediately.
        if (Array.isArray(window.currentGrowthResults) && window.currentGrowthResults.length) initCard();
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire);
    else wire();

    // Compose onto the existing loader WITHOUT editing it: the original runs exactly as before,
    // then this card refreshes from the results it produced.
    if (typeof window.handleLoadGrowthData === 'function' && !window.handleLoadGrowthData.__cspWrapped) {
        const originalLoad = window.handleLoadGrowthData;
        const wrapped = async function () {
            resetCard();
            const out = await originalLoad.apply(this, arguments);
            try { initCard(); } catch (e) { console.error('[Crop Stage Progression] init failed:', e); }
            return out;
        };
        wrapped.__cspWrapped = true;
        window.handleLoadGrowthData = wrapped;
    }
})();
