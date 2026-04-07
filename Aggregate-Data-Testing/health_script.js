// --- Global Health Chart Instances ---
var healthGreennessPieChart = null;
var healthNitrogenPieChart = null;
var healthWaterPieChart = null;

// --- State Variables ---
var currentHealthResults = null;
var healthTableSortCol = 'plotName';
var healthTableSortOrder = 'asc';
var activeHealthHarvestWindowFilter = null;
var lastHealthProcessedPlots = [];
var lastHealthHarvestTasks = [];
var lastHealthCollectedDetails = [];

/**
 * Handle UI toggle changes for Health Dashboard
 */
function handleHealthToggleChange() {
    if (currentHealthResults) {
        renderHealthKPIDashboard(currentHealthResults);
    }
}

/**
 * Main entry point to load Health Data
 */
async function handleLoadHealthData() {
    if (selectedProjectIds.length === 0) {
        alert("Please select at least one project first.");
        return;
    }
    if (plotsData.length === 0) {
        alert("Please click '🔍 Verify & Load Plots' first to identify compatible plots.");
        return;
    }

    const loadHealthBtn = document.getElementById('load-health-data-btn');
    const healthInfo = document.getElementById('health-info');
    const healthStatus = document.getElementById('health-status');
    const healthCardsContainer = document.getElementById('health-cards-container');
    const healthEmptyState = document.getElementById('health-empty-state');
    
    const legacyHealthContent = document.getElementById('legacy-health-content');
    if (legacyHealthContent) legacyHealthContent.classList.remove('hidden');

    const baseUrl = getServerUrl();

    // Loading State
    if (loadHealthBtn) {
        loadHealthBtn.disabled = true;
        loadHealthBtn.innerHTML = '⌛ Loading Health Data...';
        loadHealthBtn.style.opacity = '0.7';
    }
    
    if (healthInfo) healthInfo.classList.remove('hidden');
    if (healthStatus) {
        healthStatus.textContent = "Analyzing " + plotsData.length + " Plot Risk-Enabled plots...";
        healthStatus.style.color = "var(--primary-color)";
    }

    const healthResults = [];
    const BATCH_SIZE = 5;

    const satBase = getEnvironmentBaseUrl(currentEnvironment);
    const isProxy = satBase.includes('localhost') || satBase.includes('/api/user-aggregate');

    async function processPlotHealth(plot) {
        try {
            const sUrl = `${baseUrl}/api/user-aggregate/sustainability?environment=${encodeURIComponent(currentEnvironment)}&caIds=${encodeURIComponent(plot.caId)}`;
            const satUrl = isProxy 
                ? `${satBase}/api/user-aggregate/satellite?environment=${encodeURIComponent(currentEnvironment)}&sortBy=capturedDateTime&orderBy=DESC&size=10&caIds=${plot.caId}`
                : `${satBase}/services/farm/api/plot-risk/satellite?sortBy=capturedDateTime&orderBy=DESC&size=10&caIds=${plot.caId}`;

            const [sResp, satResp] = await Promise.all([
                fetch(sUrl, { headers: { 'Authorization': `Bearer ${authToken}`, 'ngrok-skip-browser-warning': 'true' } }),
                fetch(satUrl, { headers: { 'Authorization': `Bearer ${authToken}`, 'ngrok-skip-browser-warning': 'true' } })
            ]);

            // Handle Sustainability
            let sData = {};
            if (sResp.ok && sResp.status !== 204) {
                const tempData = await sResp.json();
                sData = Array.isArray(tempData) ? (tempData[0] || {}) : tempData;
                if (window.sustainabilityCache) window.sustainabilityCache[plot.caId] = sData;
            }

            // Handle Satellite
            let satResult = null;
            if (satResp.ok) {
                const result = await satResp.json();
                if (result && result.records) {
                    let planetData = null, sentinelData = null;
                    for (const record of result.records) {
                        const boundaryStatus = record.metrics?.errorCodes?.boundaryMetrics;
                        if (boundaryStatus === 'discarded' || boundaryStatus === 'cmk') continue;

                        if (record.provider === 'planet' && !planetData) {
                            const m = record.metrics?.cropMetrics?.[0];
                            if (m) planetData = { date: record.capturedDateTime, greenness: m.plotDeviationNDVI, nitrogen: m.plotDeviationNDRE };
                        }
                        if ((record.provider === 'sentinel2' || record.provider === 'sentinel') && !sentinelData) {
                            const m = record.metrics?.cropMetrics?.[0];
                            if (m) sentinelData = { 
                                date: record.capturedDateTime, 
                                waterStress: m.plotDeviationLSWI,
                                greenness: m.plotDeviationNDVI,
                                nitrogen: m.plotDeviationNDRE
                            };
                        }
                        if (planetData && sentinelData) break;
                    }
                    satResult = { planetData, sentinelData };
                }
            }

            const rawHarvestDate = sData.harvestDate || null;
            const isHarvestedToggle = (sData.harvested == true || sData.harvested === 'true' || sData.harvested === 1 || !!rawHarvestDate);
            
            const formatDate = (dateStr) => {
                if (!dateStr || dateStr === '-') return "-";
                const d = new Date(dateStr);
                if (isNaN(d.getTime())) return dateStr;
                const dd = String(d.getDate()).padStart(2, '0');
                const mm = String(d.getMonth() + 1).padStart(2, '0');
                return `${dd}-${mm}-${d.getFullYear()}`;
            };

            return {
                plotName: plot.name,
                caId: plot.caId,
                projectId: plot.projectId,
                isHarvested: isHarvestedToggle ? "Yes" : "No",
                harvestedDate: formatDate(rawHarvestDate),
                // Satellite fields
                planetDate: satResult?.planetData ? satResult.planetData.date : '-',
                planetGreenness: satResult?.planetData ? satResult.planetData.greenness : '-',
                planetNitrogen: satResult?.planetData ? satResult.planetData.nitrogen : '-',
                sentinelDate: satResult?.sentinelData ? satResult.sentinelData.date : '-',
                sentinelWaterStress: satResult?.sentinelData ? satResult.sentinelData.waterStress : '-',
                sentinelGreenness: satResult?.sentinelData ? satResult.sentinelData.greenness : '-',
                sentinelNitrogen: satResult?.sentinelData ? satResult.sentinelData.nitrogen : '-'
            };
        } catch (error) {
            console.error(`Error processing health for plot ${plot.caId}:`, error);
            return null;
        }
    }

    try {
        for (let i = 0; i < plotsData.length; i += BATCH_SIZE) {
            const batch = plotsData.slice(i, i + BATCH_SIZE);
            const batchResults = await Promise.all(batch.map(p => processPlotHealth(p)));
            batchResults.forEach(res => { if (res) healthResults.push(res); });
            if (healthStatus) healthStatus.textContent = `Processing plots: ${Math.min(i + BATCH_SIZE, plotsData.length)}/${plotsData.length}`;
        }

        currentHealthResults = healthResults;
        window.lastSatelliteResults = healthResults;
        
        // Render Dashboard
        renderHealthKPIDashboard(healthResults);
        renderHealthSatelliteTable(healthResults);

        if (healthCardsContainer) healthCardsContainer.classList.remove('hidden');
        if (healthEmptyState) healthEmptyState.classList.add('hidden');

        if (healthStatus) {
            healthStatus.textContent = `Health Analysis Complete. ${healthResults.length} plots processed.`;
            healthStatus.style.color = "var(--primary-color)";
        }
    } finally {
        if (loadHealthBtn) {
            loadHealthBtn.disabled = false;
            loadHealthBtn.innerHTML = '❤️ Load Health Data';
            loadHealthBtn.style.opacity = '1';
        }
    }
}

/**
 * Satellite Status Formatting
 */
function formatHealthStatus(status) {
    if (!status || status === '-') return "-";
    if (status === 'normal') return 'Normal';
    if (status === 'plots_need_attention') return 'Plots Need Attention';
    if (status === 'early_symptoms_noted') return 'Early Symptoms Noted';
    return status.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
}

function getHealthStatusColor(status) {
    if (!status || status === '-') return 'var(--text-secondary)';
    const s = status.toLowerCase();
    if (s.includes('normal')) return '#10b981';
    if (s.includes('attention')) return '#ef4444';
    if (s.includes('early')) return '#f59e0b';
    return 'var(--text-primary)';
}

function getEnvironmentBaseUrl(env) {
    if (env === 'QA2') return 'https://sf-v2-gcp.cropin.co.in/qa2';
    return getServerUrl(); 
}


/**
 * Toggle Visibility for Detail Table
 */
function toggleHealthTableVisibility() {
    const wrapper = document.getElementById('base-health-table-wrapper');
    const text = document.getElementById('toggle-health-table-text');
    const btn = document.getElementById('toggle-health-table-btn');
    if (!wrapper || !text) return;

    if (wrapper.classList.contains('hidden')) {
        wrapper.classList.remove('hidden');
        text.textContent = 'Hide Base Plot Data';
        if (btn) btn.innerHTML = '<i class="fas fa-eye-slash"></i> <span id="toggle-health-table-text">Hide Base Plot Data</span>';
    } else {
        wrapper.classList.add('hidden');
        text.textContent = 'View Base Plot Data';
        if (btn) btn.innerHTML = '<i class="fas fa-table"></i> <span id="toggle-health-table-text">View Base Plot Data</span>';
    }
}

/**
 * Dashboard Rendering
 */
function renderHealthKPIDashboard(results) {
    if (!results) return;

    // Summary Cards (Always follow the fixed logic)
    updateHealthSummaryCards(results);
    
    // KPI Charts & Drill-downs (Filtered by toggle)
    const includeHarvested = document.getElementById('health-include-harvested')?.checked || false;
    const kpiResults = includeHarvested ? results : results.filter(r => r.isHarvested !== 'Yes');

    renderHealthCategoryKPI('greenness', kpiResults);
    renderHealthCategoryKPI('nitrogen', kpiResults);
    renderHealthCategoryKPI('water', kpiResults);

    // Also ensure the base detail table is updated if it's currently visible
    renderHealthSatelliteTable(results);
}

function updateHealthSummaryCards(results) {
    // Total plots: All the eligible plots
    const totalPlots = plotsData.length;
    
    // Plots Harvested: count of harvested
    const plotsHarvested = results.filter(r => r.isHarvested === "Yes").length;
    
    // Plots covered: Total - Harvested (excluding 'excluded' logic for now)
    const plotsCovered = totalPlots - plotsHarvested;
    
    document.getElementById('health-stat-total-plots').textContent = totalPlots;
    document.getElementById('health-stat-plots-covered').textContent = plotsCovered;
    document.getElementById('health-stat-plots-harvested').textContent = plotsHarvested;
}

function renderHealthCategoryKPI(type, results) {
    const sentinelOnly = document.getElementById('health-sentinel-only-toggle')?.checked || false;
    
    const counts = { 'Normal': 0, 'Early Symptoms Noted': 0, 'Plots Need Attention': 0, 'No Data': 0 };
    const plotBuckets = { 'Normal': [], 'Early Symptoms Noted': [], 'Plots Need Attention': [], 'No Data': [] };

    results.forEach(res => {
        let val = "-", date = "-";
        if (type === 'greenness') {
            const useSentinel = sentinelOnly || (res.planetGreenness === '-');
            val = useSentinel ? res.sentinelGreenness : res.planetGreenness;
            date = useSentinel ? res.sentinelDate : res.planetDate;
        } else if (type === 'nitrogen') {
            const useSentinel = sentinelOnly || (res.planetNitrogen === '-');
            val = useSentinel ? res.sentinelNitrogen : res.planetNitrogen;
            date = useSentinel ? res.sentinelDate : res.planetDate;
        } else if (type === 'water') {
            val = res.sentinelWaterStress;
            date = res.sentinelDate;
        }

        const status = formatHealthStatus(val);
        const bucket = (status === "-") ? "No Data" : status;
        if (counts[bucket] !== undefined) {
            counts[bucket]++;
            plotBuckets[bucket].push({ name: res.plotName, status: status, date: date });
        }
    });

    const categories = ['Normal', 'Early Symptoms Noted', 'Plots Need Attention'];
    const data = categories.map(c => counts[c]);
    const total = data.reduce((a, b) => a + b, 0);

    // Pie Chart
    const canvas = document.getElementById(`health-${type}-pie`);
    if (canvas) {
        let chartRef = (type === 'greenness' ? healthGreennessPieChart : (type === 'nitrogen' ? healthNitrogenPieChart : healthWaterPieChart));
        if (chartRef) chartRef.destroy();

        const ctx = canvas.getContext('2d');
        const newChart = new Chart(ctx, {
            type: 'pie',
            data: {
                labels: categories,
                datasets: [{
                    data: data,
                    backgroundColor: ['#10b981', '#f59e0b', '#ef4444'],
                    borderWidth: 0
                }]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                onClick: (e, elements) => {
                    if (elements.length > 0) {
                        const idx = elements[0].index;
                        showHealthDrillDown(type, categories[idx], plotBuckets[categories[idx]]);
                    }
                }
            }
        });
        if (type === 'greenness') healthGreennessPieChart = newChart;
        else if (type === 'nitrogen') healthNitrogenPieChart = newChart;
        else healthWaterPieChart = newChart;
    }

    // Table next to Pie
    const tableId = `health-${type}-table`;
    const container = document.getElementById(tableId);
    if (container) {
        let html = '<table style="width: 100%; border-collapse: collapse; font-size: 0.9rem;"><tbody>';
        categories.forEach((cat, idx) => {
            const count = counts[cat];
            const pct = total > 0 ? Math.round((count / total) * 100) : 0;
            const color = ['#10b981', '#f59e0b', '#ef4444'][idx];
            html += `
                <tr style="cursor: pointer; border-bottom: 1px solid var(--border-color);" onclick='showHealthDrillDown("${type}", "${cat}", ${JSON.stringify(plotBuckets[cat]).replace(/'/g, "&apos;")})'>
                    <td style="padding: 0.5rem 0; color: var(--text-secondary);">${cat}</td>
                    <td style="padding: 0.5rem 0; text-align: right; font-weight: 700; color: ${color};">${count} (${pct}%)</td>
                </tr>
            `;
        });
        html += '</tbody></table>';
        container.innerHTML = html;
    }

    // Insight
    const insightEl = document.getElementById(`health-${type}-insight`);
    if (insightEl) {
        const normPct = total > 0 ? Math.round((counts['Normal'] / total) * 100) : 0;
        const attnPct = total > 0 ? Math.round((counts['Plots Need Attention'] / total) * 100) : 0;
        const earlyPct = total > 0 ? Math.round((counts['Early Symptoms Noted'] / total) * 100) : 0;
        insightEl.textContent = `The crop ${type} data shows that ${normPct}% is in the Normal range, ${attnPct}% Needs Attention and ${earlyPct}% is exhibiting Early Symptoms.`;
    }
}

/**
 * Unified Drill-down
 */
function showHealthDrillDown(metric, status, plots) {
    const container = document.getElementById('health-kpi-drilldown-container');
    const title = document.getElementById('health-kpi-drilldown-title');
    const tbody = document.getElementById('health-kpi-drilldown-tbody');
    
    if (!container || !title || !tbody) return;

    title.textContent = `${metric.charAt(0).toUpperCase() + metric.slice(1)}: ${status} (${plots.length} Plots)`;
    title.style.color = getHealthStatusColor(status);
    
    tbody.innerHTML = plots.map(p => `
        <tr style="border-bottom: 1px solid var(--border-color)">
            <td style="padding: 1rem; color: var(--text-primary); font-weight: 500;">${p.name}</td>
            <td style="padding: 1rem; font-weight: 600; color: ${getHealthStatusColor(p.status)}">${p.status}</td>
            <td style="padding: 1rem; color: var(--text-secondary);">${p.date === '-' ? '-' : new Date(p.date).toLocaleDateString()}</td>
        </tr>
    `).join('');

    container.classList.remove('hidden');
    container.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function closeHealthDrillDown(id) {
    const el = document.getElementById(id);
    if (el) el.classList.add('hidden');
}

/**
 * Base Table (Remains as detail view)
 */
function renderHealthSatelliteTable(results) {
    const container = document.getElementById('health-table-container');
    const sentinelOnly = document.getElementById('health-sentinel-only-toggle')?.checked || false;
    if (!container) return;

    if (!results || results.length === 0) {
        container.innerHTML = '<p style="text-align: center; padding: 2rem; color: var(--text-secondary);">No satellite health data available.</p>';
        return;
    }

    let html = `
        <div class="metrics-grid" style="grid-template-columns: 1fr; margin-top: 1rem;">
            <div class="metric-card" style="padding: 0; overflow-x: auto;">
                <table style="width: 100%; border-collapse: collapse; font-size: 0.85rem;">
                    <thead>
                        <tr style="background: rgba(6, 182, 212, 0.1); text-align: left;">
                            <th style="padding: 1rem; border-bottom: 2px solid #06b6d4;">Plot Name</th>
                            <th style="padding: 1rem; border-bottom: 2px solid #06b6d4;">${sentinelOnly ? 'Sentinel Latest Date' : 'Planet Latest Date'}</th>
                            <th style="padding: 1rem; border-bottom: 2px solid #06b6d4;">Greenness Status</th>
                            <th style="padding: 1rem; border-bottom: 2px solid #06b6d4;">Nitrogen Uptake</th>
                            <th style="padding: 1rem; border-bottom: 2px solid #06b6d4;">Sentinel Latest Date</th>
                            <th style="padding: 1rem; border-bottom: 2px solid #06b6d4;">Water Stress Status</th>
                            <th style="padding: 1rem; border-bottom: 2px solid #06b6d4;">Harvested</th>
                            <th style="padding: 1rem; border-bottom: 2px solid #06b6d4;">Harvested Date</th>
                        </tr>
                    </thead>
                    <tbody>
    `;

    results.forEach(res => {
        const useSentinel = sentinelOnly || (res.planetGreenness === '-');
        const greenVal = useSentinel ? res.sentinelGreenness : res.planetGreenness;
        const nitrogenVal = useSentinel ? res.sentinelNitrogen : res.planetNitrogen;
        const mainDate = useSentinel ? res.sentinelDate : res.planetDate;

        const fGreen = formatHealthStatus(greenVal);
        const fNitrogen = formatHealthStatus(nitrogenVal);
        const fWater = formatHealthStatus(res.sentinelWaterStress);

        html += `
            <tr style="border-bottom: 1px solid var(--border-color)">
                <td style="padding: 0.75rem; color: var(--text-primary); font-weight: 500;">${res.plotName}</td>
                <td style="padding: 0.75rem; color: var(--text-secondary);">${mainDate === '-' ? '-' : new Date(mainDate).toLocaleDateString()}</td>
                <td style="padding: 0.75rem; font-weight: 600; color: ${getHealthStatusColor(fGreen)}">${fGreen}</td>
                <td style="padding: 0.75rem; font-weight: 600; color: ${getHealthStatusColor(fNitrogen)}">${fNitrogen}</td>
                <td style="padding: 0.75rem; color: var(--text-secondary);">${res.sentinelDate === '-' ? '-' : new Date(res.sentinelDate).toLocaleDateString()}</td>
                <td style="padding: 0.75rem; font-weight: 600; color: ${getHealthStatusColor(fWater)}">${fWater}</td>
                <td style="padding: 0.75rem; color: ${res.isHarvested === 'Yes' ? '#10b981' : '#f59e0b'}; font-weight: 600;">${res.isHarvested}</td>
                <td style="padding: 0.75rem; color: var(--text-secondary);">${res.harvestedDate || '-'}</td>
            </tr>
        `;
    });

    html += `</tbody></table></div></div>`;
    container.innerHTML = html;
}

/**
 * --- Harvest Status (Health Version) ---
 * Re-added to support the legacy "Load Collected" functionality if needed.
 */
async function handleLoadHealthHarvestStatus() {
    const planTypeId = document.getElementById('health-harvest-plantype-id')?.value?.trim();
    if (!planTypeId) { alert("Please enter a Plantype ID."); return; }
    if (!currentHealthResults) { alert("Please load Health Data first."); return; }

    const btn = document.getElementById('load-health-harvest-status-btn');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Loading...'; }

    try {
        const tasks = await fetchHealthHarvestTasks(planTypeId);
        renderHealthHarvestStatus(currentHealthResults, tasks);
    } catch (error) {
        console.error("Error loading health harvest status:", error);
    } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = '📥 Load Collected Harvest'; }
    }
}

async function fetchHealthHarvestTasks(planTypeId) {
    const baseUrl = getServerUrl();
    const allTasks = [];
    for (const projectId of selectedProjectIds) {
        try {
            const url = `${baseUrl}/api/user-aggregate/harvest-tasks?environment=${encodeURIComponent(currentEnvironment)}&projectId=${encodeURIComponent(projectId)}&planTypeId=${encodeURIComponent(planTypeId)}`;
            const response = await fetch(url, { headers: { 'Authorization': `Bearer ${authToken}`, 'ngrok-skip-browser-warning': 'true' } });
            const data = await response.json();
            if (response.ok && data.records) allTasks.push(...data.records);
        } catch (e) { console.error(e); }
    }
    return allTasks;
}

function renderHealthHarvestStatus(processedPlots, tasks) {
    const section = document.getElementById('health-harvest-status-section');
    const tbody = document.getElementById('health-harvest-status-tbody');
    const statPlotsEl = document.getElementById('health-stat-harvest-plots-covered');
    const statCollectedEl = document.getElementById('health-stat-harvest-collected');

    if (!section || !tbody) return;

    tbody.innerHTML = '';
    section.classList.remove('hidden');
    lastHealthProcessedPlots = processedPlots;
    lastHealthHarvestTasks = tasks;

    const tasksByPlot = {};
    tasks.forEach(t => { const id = String(t.croppableAreaId); if (!tasksByPlot[id]) tasksByPlot[id] = []; tasksByPlot[id].push(t); });

    // Use currentHealthResults (already contains isHarvested info)
    const harvestedWithData = processedPlots.filter(p => p.isHarvested === 'Yes' && tasksByPlot[String(p.caId)]);

    let totalCollected = 0;
    const coveredCaIds = new Set();
    const detailRows = [];

    const windowAggregates = {
        'Before Window': { count: 0, collected: 0, expected: 0, predicted: 0, color: '#f59e0b' },
        'Within Window': { count: 0, collected: 0, expected: 0, predicted: 0, color: '#10b981' },
        'Post Window': { count: 0, collected: 0, expected: 0, predicted: 0, color: '#3b82f6' }
    };

    harvestedWithData.forEach(plot => {
        const caId = String(plot.caId);
        const plotTasks = tasksByPlot[caId];
        const status = 'Within Window'; // Simplified window logic
        
        const agg = windowAggregates[status];
        if (agg) agg.count++;

        plotTasks.forEach(task => {
            const ton = (parseFloat(task.qty) || 0) * 1; 
            totalCollected += ton;
            if (agg) agg.collected += ton;
            detailRows.push({ name: plot.plotName, date: task.actualClosedDate, qty: task.qty, unit: task.unit, ton: ton });
        });
        coveredCaIds.add(caId);
    });

    tbody.innerHTML = detailRows.map(r => `
        <tr style="border-bottom: 1px solid var(--border-color)">
            <td style="padding: 1rem; color: var(--text-primary); font-weight: 500;">${r.name}</td>
            <td style="padding: 1rem; color: var(--text-secondary);">${r.date}</td>
            <td style="padding: 1rem; color: var(--text-secondary);">-</td>
            <td style="padding: 1rem; color: var(--text-secondary);">-</td>
            <td style="padding: 1rem; color: var(--text-primary); font-weight: 600;">${r.qty}</td>
            <td style="padding: 1rem; color: var(--text-secondary);">${r.unit}</td>
            <td style="padding: 1rem; color: var(--secondary-color); font-weight: 700;">${r.ton.toFixed(2)}</td>
            <td style="padding: 1rem; color: #f59e0b;">NA</td>
        </tr>
    `).join('');

    if (statPlotsEl) statPlotsEl.textContent = `${coveredCaIds.size} / ${processedPlots.filter(p => p.isHarvested === "Yes").length}`;
    if (statCollectedEl) statCollectedEl.textContent = `${totalCollected.toFixed(2)} metric ton`;
    
    document.getElementById('health-harvest-status-results')?.classList.remove('hidden');
    renderHealthHarvestWindowStatus(windowAggregates);
}

function renderHealthHarvestWindowStatus(aggregates) {
    const container = document.getElementById('health-harvest-window-status-container');
    const tbody = document.getElementById('health-harvest-window-summary-tbody');
    if (!container || !tbody) return;

    container.classList.remove('hidden');
    const statuses = ['Before Window', 'Within Window', 'Post Window'];
    tbody.innerHTML = statuses.map(s => {
        const d = aggregates[s];
        return `
            <tr style="border-bottom: 1px solid var(--border-color)">
                <td style="padding: 1.25rem 1rem; font-weight: 500; color: #60a5fa;">${s}</td>
                <td style="padding: 1.25rem 1rem; text-align: center; color: var(--text-primary);">${d.count}</td>
                <td style="padding: 1.25rem 1rem; text-align: center; color: #10b981;">${d.collected.toFixed(2)}</td>
                <td style="padding: 1.25rem 1rem; text-align: center;">-</td>
                <td style="padding: 1.25rem 1rem; text-align: center; color: #f59e0b;">NA</td>
            </tr>
        `;
    }).join('');

    // Reusing the global chart var from top if it were defined, but we'll use a local check
    const canvas = document.getElementById('health-harvest-window-pie-chart');
    if (canvas) {
        // We might need a global for this pie too if it needs destroying
        if (window.healthHarvestWindowPieChart) window.healthHarvestWindowPieChart.destroy();
        window.healthHarvestWindowPieChart = new Chart(canvas.getContext('2d'), {
            type: 'pie',
            data: {
                labels: statuses,
                datasets: [{ data: statuses.map(s => aggregates[s].count), backgroundColor: statuses.map(s => aggregates[s].color) }]
            },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
        });
    }
}
