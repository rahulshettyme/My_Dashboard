// --- Global Health Chart Instances ---
var healthGreennessPieChart = null;
var healthNitrogenPieChart = null;
var healthWaterPieChart = null;

// --- State Variables ---
var currentHealthResults = null;
var healthTableSortCol = 'plotName';
var healthTableSortOrder = 'asc';
var activeHealthHarvestWindowFilter = null;
var activeHealthFilter = null; // Filter for details table
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
 * Clear Health UI and State
 */
function clearHealthUI() {
    currentHealthResults = null;
    window.lastSatelliteResults = null;
    activeHealthFilter = null;
    
    // Destroy charts if they exist
    if (healthGreennessPieChart) { healthGreennessPieChart.destroy(); healthGreennessPieChart = null; }
    if (healthNitrogenPieChart) { healthNitrogenPieChart.destroy(); healthNitrogenPieChart = null; }
    if (healthWaterPieChart) { healthWaterPieChart.destroy(); healthWaterPieChart = null; }
    
    // Reset status label
    const healthStatus = document.getElementById('health-status');
    if (healthStatus) healthStatus.textContent = '';
    
    // Hide Health content container
    const healthCardsContainer = document.getElementById('health-cards-container');
    if (healthCardsContainer) healthCardsContainer.classList.add('hidden');
    
    // Hide base table wrapper
    const wrapper = document.getElementById('base-health-table-wrapper');
    if (wrapper) wrapper.classList.add('hidden');
    const text = document.getElementById('toggle-health-table-text');
    if (text) text.textContent = 'View Base Plot Data';
    const btn = document.getElementById('toggle-health-table-btn');
    if (btn) btn.innerHTML = '<i class="fas fa-table"></i> <span id="toggle-health-table-text">View Base Plot Data</span>';
    
    // Hide drilldown container
    const drilldown = document.getElementById('health-kpi-drilldown-container');
    if (drilldown) drilldown.classList.add('hidden');
}

/**
 * Determine which provider's data to use for a given status type (greenness or nitrogen)
 * based on selected options.
 */
function getTargetProviderData(res, type) {
    const sentinelOnly = document.getElementById('health-sentinel-only-toggle')?.checked || false;
    const showProviderPref = document.getElementById('health-provider-preference-toggle')?.checked || false;

    // 1. If Sentinel Only is requested, always use Sentinel.
    if (sentinelOnly) {
        return {
            val: type === 'greenness' ? res.sentinelGreenness : res.sentinelNitrogen,
            date: res.sentinelDate
        };
    }

    // Determine values and dates
    const planetVal = type === 'greenness' ? res.planetGreenness : res.planetNitrogen;
    const planetDate = res.planetDate;
    const sentinelVal = type === 'greenness' ? res.sentinelGreenness : res.sentinelNitrogen;
    const sentinelDate = res.sentinelDate;

    // 2. If Show Provider Preference is checked, use the current default logic:
    // Prefer Planet if available, fallback to Sentinel.
    if (showProviderPref) {
        const useSentinel = planetVal === '-';
        return {
            val: useSentinel ? sentinelVal : planetVal,
            date: useSentinel ? sentinelDate : planetDate
        };
    }

    // 3. Otherwise, by default, Show Latest Data (remove provider preference filter):
    // Compare dates to choose the latest record. If on the same day, prefer Planet.
    if (planetVal !== '-' && sentinelVal !== '-') {
        const pDate = new Date(planetDate);
        const sDate = new Date(sentinelDate);
        const pTime = isNaN(pDate.getTime()) ? 0 : pDate.getTime();
        const sTime = isNaN(sDate.getTime()) ? 0 : sDate.getTime();

        const isSameDay = !isNaN(pDate.getTime()) && !isNaN(sDate.getTime()) &&
                          pDate.getFullYear() === sDate.getFullYear() &&
                          pDate.getMonth() === sDate.getMonth() &&
                          pDate.getDate() === sDate.getDate();

        if (isSameDay) {
            return { val: planetVal, date: planetDate };
        } else if (pTime > sTime) {
            return { val: planetVal, date: planetDate };
        } else {
            return { val: sentinelVal, date: sentinelDate };
        }
    } else if (planetVal !== '-') {
        return { val: planetVal, date: planetDate };
    } else {
        return { val: sentinelVal, date: sentinelDate };
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
    const isProxy = satBase.includes('localhost') || satBase.includes('127.0.0.1') || satBase.includes('/api/user-aggregate');

    async function processPlotHealth(plot) {
        try {
            const sUrl = `${baseUrl}/api/user-aggregate/sustainability?environment=${encodeURIComponent(currentEnvironment)}&caIds=${encodeURIComponent(plot.caId)}`;
            const satUrl = isProxy 
                ? `${satBase}/api/user-aggregate/satellite?environment=${encodeURIComponent(currentEnvironment)}&sortBy=capturedDateTime&orderBy=DESC&size=30&caIds=${plot.caId}`
                : `${satBase}/services/farm/api/plot-risk/satellite?sortBy=capturedDateTime&orderBy=DESC&size=30&caIds=${plot.caId}`;

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
                    const rawHarvestDate = sData.harvestDate || null;
                    const harvestDateObj = rawHarvestDate ? new Date(rawHarvestDate) : null;
                    if (harvestDateObj && !isNaN(harvestDateObj.getTime())) {
                        harvestDateObj.setHours(23, 59, 59, 999);
                    }

                    // 1. Filter out invalid/cmk records and post-harvest records
                    const validRecords = result.records.filter(record => {
                        const boundaryStatus = record.metrics?.errorCodes?.boundaryMetrics;
                        if (boundaryStatus === 'discarded' || boundaryStatus === 'cmk') return false;

                        if (harvestDateObj && record.capturedDateTime) {
                            const recordDateObj = new Date(record.capturedDateTime);
                            if (!isNaN(recordDateObj.getTime()) && recordDateObj.getTime() > harvestDateObj.getTime()) {
                                return false;
                            }
                        }
                        return true;
                    });

                    // 2. Sort DESC with priority to Planet on tie
                    validRecords.sort((a, b) => {
                        const tA = new Date(a.capturedDateTime).getTime();
                        const tB = new Date(b.capturedDateTime).getTime();
                        if (tA !== tB) {
                            return tB - tA; // DESC
                        }
                        // Planet priority on tie
                        const pA = a.provider === 'planet' ? 1 : 0;
                        const pB = b.provider === 'planet' ? 1 : 0;
                        return pB - pA;
                    });

                    // 3. Extract the latest Planet and Sentinel records
                    let planetData = null, sentinelData = null;
                    for (const record of validRecords) {
                        if (record.provider === 'planet' && !planetData) {
                            if (window.healthIndicatorsDisabled) {
                                const stats = record.metrics?.statistics;
                                if (stats && stats.ndvi) {
                                    planetData = {
                                        date: record.capturedDateTime,
                                        greenness: stats.ndvi.mean,
                                        nitrogen: stats.ndre ? stats.ndre.mean : '-'
                                    };
                                }
                            } else {
                                const m = record.metrics?.cropMetrics?.[0];
                                if (m) planetData = { date: record.capturedDateTime, greenness: m.plotDeviationNDVI, nitrogen: m.plotDeviationNDRE };
                            }
                        }
                        if ((record.provider === 'sentinel2' || record.provider === 'sentinel') && !sentinelData) {
                            if (window.healthIndicatorsDisabled) {
                                const stats = record.metrics?.statistics;
                                if (stats && stats.ndvi) {
                                    sentinelData = {
                                        date: record.capturedDateTime,
                                        waterStress: stats.lswi ? stats.lswi.mean : '-',
                                        greenness: stats.ndvi.mean,
                                        nitrogen: stats.ndre ? stats.ndre.mean : '-'
                                    };
                                }
                            } else {
                                const m = record.metrics?.cropMetrics?.[0];
                                if (m) sentinelData = { 
                                    date: record.capturedDateTime, 
                                    waterStress: m.plotDeviationLSWI,
                                    greenness: m.plotDeviationNDVI,
                                    nitrogen: m.plotDeviationNDRE
                                };
                            }
                        }
                        if (planetData && sentinelData) break;
                    }

                    // 4. Extract the PL (2nd overall latest record) from validRecords
                    let plData = null;
                    if (validRecords.length >= 2) {
                        const rec = validRecords[1];
                        const isPlanet = rec.provider === 'planet';
                        plData = {
                            date: rec.capturedDateTime,
                            provider: isPlanet ? 'Planet' : 'Sentinel',
                            greenness: '-',
                            nitrogen: '-',
                            waterStress: '-'
                        };

                        if (window.healthIndicatorsDisabled) {
                            const stats = rec.metrics?.statistics;
                            if (stats) {
                                plData.greenness = stats.ndvi ? stats.ndvi.mean : '-';
                                plData.nitrogen = stats.ndre ? stats.ndre.mean : '-';
                                if (!isPlanet) {
                                    plData.waterStress = stats.lswi ? stats.lswi.mean : '-';
                                }
                            }
                        } else {
                            const m = rec.metrics?.cropMetrics?.[0];
                            if (m) {
                                plData.greenness = m.plotDeviationNDVI;
                                plData.nitrogen = m.plotDeviationNDRE;
                                if (!isPlanet) {
                                    plData.waterStress = m.plotDeviationLSWI;
                                }
                            }
                        }
                    }

                    satResult = { planetData, sentinelData, plData };
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
                sentinelNitrogen: satResult?.sentinelData ? satResult.sentinelData.nitrogen : '-',
                // PL fields
                plDate: satResult?.plData ? satResult.plData.date : '-',
                plProvider: satResult?.plData ? satResult.plData.provider : '-',
                plGreenness: satResult?.plData ? satResult.plData.greenness : '-',
                plNitrogen: satResult?.plData ? satResult.plData.nitrogen : '-',
                plWaterStress: satResult?.plData ? satResult.plData.waterStress : '-'
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
 * Helper to classify a numeric mean satellite index (NDVI, NDRE, LSWI) into category
 */
function classifyValueToStatus(val) {
    if (val === undefined || val === null || val === '-' || isNaN(val)) return '-';
    const num = parseFloat(val);
    if (num >= 0.66) return 'Normal';
    if (num >= 0.33 && num < 0.66) return 'Early Symptoms Noted';
    return 'Plots Need Attention';
}

/**
 * Satellite Status Formatting
 */
function formatHealthStatus(status) {
    if (!status || status === '-') return "-";

    if (window.healthIndicatorsDisabled) {
        let s = status;
        if (!isNaN(status)) {
            s = classifyValueToStatus(status);
        }
        if (s === 'normal' || s === 'Normal') return '0.66 - 1';
        if (s === 'early_symptoms_noted' || s === 'Early Symptoms Noted') return '0.33 - 0.66';
        if (s === 'plots_need_attention' || s === 'Plots Need Attention') return '-1 - 0.33';
        return s;
    }

    if (status === 'normal' || status === 'Normal') return 'Normal';
    if (status === 'plots_need_attention' || status === 'Plots Need Attention') return 'Plots Need Attention';
    if (status === 'early_symptoms_noted' || status === 'Early Symptoms Noted') return 'Early Symptoms Noted';
    return status.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
}

function getHealthStatusColor(status) {
    if (!status || status === '-') return 'var(--text-secondary)';
    const s = status.toLowerCase();
    if (s.includes('normal') || s.startsWith('0.66')) return '#10b981';
    if (s.includes('attention') || s.startsWith('-1')) return '#ef4444';
    if (s.includes('early') || s.startsWith('0.33')) return '#f59e0b';
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

    // Update card titles based on HEALTH_INDICATORS_DISABLE config
    const greenTitle = document.getElementById('health-greenness-title-text');
    const nitrogenTitle = document.getElementById('health-nitrogen-title-text');
    const waterTitle = document.getElementById('health-water-title-text');

    if (window.healthIndicatorsDisabled) {
        if (greenTitle) greenTitle.innerHTML = '<i class="fas fa-leaf"></i> NDVI';
        if (nitrogenTitle) nitrogenTitle.innerHTML = '<i class="fas fa-microchip"></i> NDRE';
        if (waterTitle) waterTitle.innerHTML = '<i class="fas fa-tint"></i> LSWI';
    } else {
        if (greenTitle) greenTitle.innerHTML = '<i class="fas fa-leaf"></i> Crop Greenness Status';
        if (nitrogenTitle) nitrogenTitle.innerHTML = '<i class="fas fa-microchip"></i> Nutrient Uptake';
        if (waterTitle) waterTitle.innerHTML = '<i class="fas fa-tint"></i> Water Stress Status';
    }

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
    
    // PR Enabled: all compatible plots loaded in results
    const plotsCovered = results.length;
    
    document.getElementById('health-stat-total-plots').textContent = totalPlots;
    document.getElementById('health-stat-plots-covered').textContent = plotsCovered;
    document.getElementById('health-stat-plots-harvested').textContent = plotsHarvested;
}

/**
 * Helper to format a Date object as DD-MM-YYYY
 */
function formatDateToDMY(date) {
    const dd = String(date.getDate()).padStart(2, '0');
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    return `${dd}-${mm}-${date.getFullYear()}`;
}

/**
 * Helper to check if a date string is within the last N days from today, excluding today.
 * Today is excluded, meaning the record date must be strictly before today (local time).
 */
function isWithinAnalysisWindow(dateStr, windowDays) {
    if (!dateStr || dateStr === '-') return false;
    const recordDate = new Date(dateStr);
    if (isNaN(recordDate.getTime())) return false;

    // Get today's date at midnight local time
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Get record date at midnight local time
    const record = new Date(recordDate);
    record.setHours(0, 0, 0, 0);

    // Lower bound: today - windowDays
    const startLimit = new Date(today);
    startLimit.setDate(today.getDate() - windowDays);

    // Return true if startLimit <= record < today
    return record.getTime() >= startLimit.getTime() && record.getTime() < today.getTime();
}

/**
 * Handle apply filter action for individual KPI modules
 */
function handleHealthApplyFilter(type) {
    if (currentHealthResults) {
        const includeHarvested = document.getElementById('health-include-harvested')?.checked || false;
        const kpiResults = includeHarvested ? currentHealthResults : currentHealthResults.filter(r => r.isHarvested !== 'Yes');
        renderHealthCategoryKPI(type, kpiResults);
    }
}

function renderHealthCategoryKPI(type, results) {
    const sentinelOnly = document.getElementById('health-sentinel-only-toggle')?.checked || false;
    
    // Read the window input for this type:
    const windowInputId = `health-${type}-window`;
    const windowInput = document.getElementById(windowInputId);
    const windowDays = windowInput ? parseInt(windowInput.value, 10) : 15;

    // Display the date window range
    const dateWindowEl = document.getElementById(`health-${type}-date-window`);
    if (dateWindowEl) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const endLimit = new Date(today);
        endLimit.setDate(today.getDate() - 1); // Yesterday
        const startLimit = new Date(today);
        startLimit.setDate(today.getDate() - windowDays); // today - windowDays
        dateWindowEl.innerHTML = `<i class="far fa-calendar-alt"></i> Window: ${formatDateToDMY(startLimit)} to ${formatDateToDMY(endLimit)}`;
    }

    const counts = { 
        'Normal': 0, 
        'Early Symptoms Noted': 0, 
        'Plots Need Attention': 0,
        'Excluded (Normal)': 0,
        'Excluded (Early Symptoms Noted)': 0,
        'Excluded (Plots Need Attention)': 0,
        'No Data': 0 
    };
    const plotBuckets = { 
        'Normal': [], 
        'Early Symptoms Noted': [], 
        'Plots Need Attention': [],
        'Excluded (Normal)': [],
        'Excluded (Early Symptoms Noted)': [],
        'Excluded (Plots Need Attention)': [],
        'No Data': [] 
    };

    results.forEach(res => {
        let val = "-", date = "-";
        if (type === 'greenness') {
            const target = getTargetProviderData(res, 'greenness');
            val = target.val;
            date = target.date;
        } else if (type === 'nitrogen') {
            const target = getTargetProviderData(res, 'nitrogen');
            val = target.val;
            date = target.date;
        } else if (type === 'water') {
            val = res.sentinelWaterStress;
            date = res.sentinelDate;
        }

        let status = val;
        if (window.healthIndicatorsDisabled && !isNaN(val) && val !== '-') {
            status = classifyValueToStatus(val);
        } else {
            status = formatHealthStatus(val);
            if (status === '0.66 - 1') status = 'Normal';
            if (status === '0.33 - 0.66') status = 'Early Symptoms Noted';
            if (status === '-1 - 0.33') status = 'Plots Need Attention';
        }

        if (status === "-" || status === "No Data") {
            counts['No Data']++;
            plotBuckets['No Data'].push({ name: res.plotName, status: '-', date: date });
            return;
        }

        const isHarvested = res.isHarvested === 'Yes';
        const isWithinWindow = isWithinAnalysisWindow(date, windowDays);

        let bucket = status;
        // Excluded: plots which are not harvested but outside the analysis window
        if (!isHarvested && !isWithinWindow) {
            bucket = `Excluded (${status})`;
        }

        if (counts[bucket] !== undefined) {
            counts[bucket]++;
            plotBuckets[bucket].push({ name: res.plotName, status: status, date: date });
        }
    });

    const categories = ['Normal', 'Early Symptoms Noted', 'Plots Need Attention'];
    const data = categories.map(c => counts[c]);
    const total = data.reduce((a, b) => a + b, 0);

    const analyzedEl = document.getElementById(`health-${type}-analyzed`);
    if (analyzedEl) {
        analyzedEl.textContent = `Plots Analyzed (Covered): ${total}`;
    }

    // Pie Chart
    const canvas = document.getElementById(`health-${type}-pie`);
    if (canvas) {
        let chartRef = (type === 'greenness' ? healthGreennessPieChart : (type === 'nitrogen' ? healthNitrogenPieChart : healthWaterPieChart));
        if (chartRef) chartRef.destroy();

        const ctx = canvas.getContext('2d');
        const newChart = new Chart(ctx, {
            type: 'pie',
            data: {
                labels: categories.map(c => formatHealthStatus(c)),
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
            const displayCatName = formatHealthStatus(cat);
            html += `
                <tr style="cursor: pointer; border-bottom: 1px solid var(--border-color);" onclick='showHealthDrillDown("${type}", "${cat}", ${JSON.stringify(plotBuckets[cat]).replace(/'/g, "&apos;")})'>
                    <td style="padding: 0.5rem 0; color: var(--text-secondary);">${displayCatName}</td>
                    <td style="padding: 0.5rem 0; text-align: right; font-weight: 700; color: ${color};">${count} (${pct}%)</td>
                </tr>
            `;
        });

        // Excluded rows matching each status
        const excludedCategories = ['Excluded (Normal)', 'Excluded (Early Symptoms Noted)', 'Excluded (Plots Need Attention)'];
        html += `
            <tr style="background: rgba(255, 255, 255, 0.05); pointer-events: none;">
                <td colspan="2" style="padding: 0.4rem 0 0.2rem 0; font-size: 0.75rem; color: var(--text-secondary); font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; border-bottom: 1px solid var(--border-color);">Excluded (Outside Window)</td>
            </tr>
        `;
        excludedCategories.forEach((cat, idx) => {
            const count = counts[cat];
            const color = ['rgba(16, 185, 129, 0.6)', 'rgba(245, 158, 11, 0.6)', 'rgba(239, 68, 68, 0.6)'][idx];
            const displayLabel = formatHealthStatus(cat.replace('Excluded (', '').replace(')', ''));
            html += `
                <tr style="cursor: pointer; border-bottom: 1px solid var(--border-color); opacity: 0.7;" onclick='showHealthDrillDown("${type}", "${cat}", ${JSON.stringify(plotBuckets[cat]).replace(/'/g, "&apos;")})'>
                    <td style="padding: 0.5rem 0; color: var(--text-secondary); font-style: italic; padding-left: 0.5rem;">${displayLabel}</td>
                    <td style="padding: 0.5rem 0; text-align: right; font-weight: 700; color: ${color};">${count}</td>
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
        
        let displayType = type === 'nitrogen' ? 'nutrient' : type;
        let normalLabel = 'Normal';
        let attnLabel = 'Needs Attention';
        let earlyLabel = 'Early Symptoms';
        
        if (window.healthIndicatorsDisabled) {
            displayType = type === 'greenness' ? 'NDVI' : (type === 'nitrogen' ? 'NDRE' : 'LSWI');
            normalLabel = '0.66 - 1';
            attnLabel = '-1 - 0.33';
            earlyLabel = '0.33 - 0.66';
        }
        
        insightEl.textContent = `The crop ${displayType} data shows that ${normPct}% is in the ${normalLabel} range, ${attnPct}% is in the ${attnLabel} range, and ${earlyPct}% is in the ${earlyLabel} range.`;
    }
}

/**
 * Unified Drill-down (now filters base details table instead of separate layout)
 */
function showHealthDrillDown(metric, status, plots) {
    activeHealthFilter = { type: metric, status: status };

    if (currentHealthResults) {
        renderHealthSatelliteTable(currentHealthResults);
    }

    const wrapper = document.getElementById('base-health-table-wrapper');
    if (wrapper && wrapper.classList.contains('hidden')) {
        toggleHealthTableVisibility();
    }

    const tableHeader = document.getElementById('toggle-health-table-btn');
    if (tableHeader) {
        tableHeader.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}

function closeHealthDrillDown(id) {
    const el = document.getElementById(id);
    if (el) el.classList.add('hidden');
}

function clearActiveHealthFilter() {
    activeHealthFilter = null;
    if (currentHealthResults) {
        renderHealthSatelliteTable(currentHealthResults);
    }
}

/**
 * Handle checkbox change to hide harvested plots in the base table
 */
function handleHealthBaseTableToggleChange() {
    if (currentHealthResults) {
        renderHealthSatelliteTable(currentHealthResults);
    }
}

/**
 * Base Table (Remains as detail view)
 */
function renderHealthSatelliteTable(results) {
    const container = document.getElementById('health-table-container');
    const sentinelOnly = document.getElementById('health-sentinel-only-toggle')?.checked || false;
    const showProviderPref = document.getElementById('health-provider-preference-toggle')?.checked || false;
    const hideHarvested = document.getElementById('health-hide-harvested-base-table')?.checked || false;
    if (!container) return;

    if (!results || results.length === 0) {
        container.innerHTML = '<p style="text-align: center; padding: 2rem; color: var(--text-secondary);">No satellite health data available.</p>';
        return;
    }

    let filteredResults = results;
    if (activeHealthFilter) {
        const { type, status } = activeHealthFilter;
        const windowInput = document.getElementById(`health-${type}-window`);
        const windowDays = windowInput ? parseInt(windowInput.value, 10) : 15;

        filteredResults = results.filter(res => {
            let val = "-", date = "-";
            if (type === 'greenness') {
                const target = getTargetProviderData(res, 'greenness');
                val = target.val;
                date = target.date;
            } else if (type === 'nitrogen') {
                const target = getTargetProviderData(res, 'nitrogen');
                val = target.val;
                date = target.date;
            } else if (type === 'water') {
                val = res.sentinelWaterStress;
                date = res.sentinelDate;
            }

            let plotStatus = val;
            if (window.healthIndicatorsDisabled && !isNaN(val) && val !== '-') {
                plotStatus = classifyValueToStatus(val);
            } else {
                plotStatus = formatHealthStatus(val);
                if (plotStatus === '0.66 - 1') plotStatus = 'Normal';
                if (plotStatus === '0.33 - 0.66') plotStatus = 'Early Symptoms Noted';
                if (plotStatus === '-1 - 0.33') plotStatus = 'Plots Need Attention';
            }

            if (plotStatus === "-" || plotStatus === "No Data") {
                return status === 'No Data';
            }

            const isHarvested = res.isHarvested === 'Yes';
            const isWithinWindow = isWithinAnalysisWindow(date, windowDays);

            let bucket = plotStatus;
            if (!isHarvested && !isWithinWindow) {
                bucket = `Excluded (${plotStatus})`;
            }

            return bucket === status;
        });
    }

    const displayResults = hideHarvested ? filteredResults.filter(r => r.isHarvested !== 'Yes') : filteredResults;

    let filterBannerHtml = '';
    if (activeHealthFilter) {
        let displayType = activeHealthFilter.type === 'greenness' ? 'Greenness' : (activeHealthFilter.type === 'nitrogen' ? 'Nutrient' : 'Water Stress');
        if (window.healthIndicatorsDisabled) {
            displayType = activeHealthFilter.type === 'greenness' ? 'NDVI' : (activeHealthFilter.type === 'nitrogen' ? 'NDRE' : 'LSWI');
        }
        filterBannerHtml = `
            <div style="display: flex; justify-content: space-between; align-items: center; background: rgba(6, 182, 212, 0.08); border: 1px solid rgba(6, 182, 212, 0.2); border-radius: 6px; padding: 0.5rem 1rem; margin-bottom: 1rem;">
                <span style="font-size: 0.85rem; color: var(--text-primary); font-weight: 500;">
                    Showing only plots with status <strong style="color: #06b6d4;">${formatHealthStatus(activeHealthFilter.status)}</strong> for <strong style="color: #06b6d4;">${displayType}</strong>
                </span>
                <button onclick="clearActiveHealthFilter()" style="padding: 0.25rem 0.5rem; background: #06b6d4; border: none; color: white; border-radius: 4px; font-size: 0.75rem; font-weight: 600; cursor: pointer;">Clear Filter</button>
            </div>
        `;
    }

    if (displayResults.length === 0) {
        container.innerHTML = filterBannerHtml + '<p style="text-align: center; padding: 2rem; color: var(--text-secondary);">No plots matching the active filter.</p>';
        return;
    }

    let html = filterBannerHtml + `
        <div class="metrics-grid" style="grid-template-columns: 1fr; margin-top: 1rem;">
            <div class="metric-card" style="padding: 0; overflow-x: auto;">
                <table style="width: 100%; border-collapse: collapse; font-size: 0.85rem;">
                    <thead>
                        <tr style="background: rgba(6, 182, 212, 0.1); text-align: left;">
                            <th style="padding: 1rem; border-bottom: 2px solid #06b6d4;">Plot Name</th>
                            <th style="padding: 1rem; border-bottom: 2px solid #06b6d4;">Capture Date (P / S)</th>
                            <th style="padding: 1rem; border-bottom: 2px solid #06b6d4;">${window.healthIndicatorsDisabled ? 'NDVI (P / S)' : 'Greenness Status (P / S)'}</th>
                            <th style="padding: 1rem; border-bottom: 2px solid #06b6d4;">${window.healthIndicatorsDisabled ? 'NDRE (P / S)' : 'Nutrient Uptake (P / S)'}</th>
                            <th style="padding: 1rem; border-bottom: 2px solid #06b6d4;">${window.healthIndicatorsDisabled ? 'LSWI (Sentinel)' : 'Water Stress Status (Sentinel)'}</th>
                            <th style="padding: 1rem; border-bottom: 2px solid #06b6d4;">Harvested</th>
                            <th style="padding: 1rem; border-bottom: 2px solid #06b6d4;">Harvested Date</th>
                        </tr>
                    </thead>
                    <tbody>
    `;

    // Sort results by plotName ascending
    const sortedResults = [...displayResults].sort((a, b) => {
        return (a.plotName || '').localeCompare(b.plotName || '', undefined, { numeric: true, sensitivity: 'base' });
    });

    sortedResults.forEach(res => {
        const fWater = formatHealthStatus(res.sentinelWaterStress);

        const formatCellDate = (dateStr) => {
            if (!dateStr || dateStr === '-') return '-';
            const d = new Date(dateStr);
            return isNaN(d.getTime()) ? dateStr : formatDateToDMY(d);
        };

        const planetDateFormatted = formatCellDate(res.planetDate);
        const sentinelDateFormatted = formatCellDate(res.sentinelDate);

        const hasSentinelNewer = (() => {
            if (res.sentinelDate !== '-' && res.planetDate !== '-') {
                const pDate = new Date(res.planetDate);
                const sDate = new Date(res.sentinelDate);
                return sDate.getTime() > pDate.getTime();
            }
            return res.sentinelDate !== '-' && res.planetDate === '-';
        })();

        const sentinelDateBadge = hasSentinelNewer
            ? ` <span style="background: rgba(6, 182, 212, 0.15); color: #06b6d4; font-size: 0.65rem; padding: 1px 4px; border-radius: 3px; font-weight: 600; display: inline-block; vertical-align: middle;">Latest</span>`
            : '';

        const planetGreenStatus = formatHealthStatus(res.planetGreenness);
        const sentinelGreenStatus = formatHealthStatus(res.sentinelGreenness);
        const planetNitrogenStatus = formatHealthStatus(res.planetNitrogen);
        const sentinelNitrogenStatus = formatHealthStatus(res.sentinelNitrogen);

        const formatActualValue = (val) => {
            if (val === undefined || val === null || val === '-' || isNaN(val)) return '-';
            return parseFloat(val).toFixed(3);
        };

        const displayPlanetGreen = window.healthIndicatorsDisabled ? formatActualValue(res.planetGreenness) : planetGreenStatus;
        const displaySentinelGreen = window.healthIndicatorsDisabled ? formatActualValue(res.sentinelGreenness) : sentinelGreenStatus;
        const displayPlanetNitrogen = window.healthIndicatorsDisabled ? formatActualValue(res.planetNitrogen) : planetNitrogenStatus;
        const displaySentinelNitrogen = window.healthIndicatorsDisabled ? formatActualValue(res.sentinelNitrogen) : sentinelNitrogenStatus;
        const displayWater = window.healthIndicatorsDisabled ? formatActualValue(res.sentinelWaterStress) : fWater;

        // PL (Previous Latest) Calculations
        const plDateFormatted = formatCellDate(res.plDate);
        const plGreenStatus = formatHealthStatus(res.plGreenness);
        const plNitrogenStatus = formatHealthStatus(res.plNitrogen);
        const plWaterStatus = formatHealthStatus(res.plWaterStress);

        const displayPlGreen = window.healthIndicatorsDisabled ? formatActualValue(res.plGreenness) : plGreenStatus;
        const displayPlNitrogen = window.healthIndicatorsDisabled ? formatActualValue(res.plNitrogen) : plNitrogenStatus;
        const displayPlWater = window.healthIndicatorsDisabled ? formatActualValue(res.plWaterStress) : plWaterStatus;

        const plProviderText = res.plProvider === 'Planet' ? 'P' : 'S';

        const plDateText = res.plDate === '-' ? 'PL: -' : `PL: ${plProviderText} : ${plDateFormatted}`;
        const plGreenText = res.plDate === '-' ? 'PL: -' : `PL: ${plProviderText} : ${displayPlGreen}`;
        const plGreenColor = res.plDate === '-' ? 'var(--text-secondary)' : getHealthStatusColor(plGreenStatus);

        const plNitrogenText = res.plDate === '-' ? 'PL: -' : `PL: ${plProviderText} : ${displayPlNitrogen}`;
        const plNitrogenColor = res.plDate === '-' ? 'var(--text-secondary)' : getHealthStatusColor(plNitrogenStatus);

        const plWaterText = (res.plDate === '-' || res.plWaterStress === '-') ? 'PL: -' : `PL: ${plProviderText} : ${displayPlWater}`;
        const plWaterColor = (res.plDate === '-' || res.plWaterStress === '-') ? 'var(--text-secondary)' : getHealthStatusColor(plWaterStatus);

        html += `
            <tr style="border-bottom: 1px solid var(--border-color)">
                <td style="padding: 0.75rem; color: var(--text-primary); font-weight: 500;">${res.plotName}</td>
                <td style="padding: 0.75rem;">
                    <div style="font-size: 0.8rem; color: var(--text-secondary);">P: ${planetDateFormatted}</div>
                    <div style="font-size: 0.8rem; color: var(--text-secondary); margin-top: 0.25rem;">S: ${sentinelDateFormatted}${sentinelDateBadge}</div>
                    <div style="font-size: 0.8rem; color: var(--text-secondary); margin-top: 0.25rem; border-top: 1px dashed rgba(255,255,255,0.1); padding-top: 0.25rem;">${plDateText}</div>
                </td>
                <td style="padding: 0.75rem;">
                    <div style="font-size: 0.8rem; font-weight: 600; color: ${getHealthStatusColor(planetGreenStatus)};">Planet: ${displayPlanetGreen}</div>
                    <div style="font-size: 0.8rem; font-weight: 600; color: ${getHealthStatusColor(sentinelGreenStatus)}; margin-top: 0.25rem;">Sentinel: ${displaySentinelGreen}</div>
                    <div style="font-size: 0.8rem; font-weight: 600; color: ${plGreenColor}; margin-top: 0.25rem; border-top: 1px dashed rgba(255,255,255,0.1); padding-top: 0.25rem;">${plGreenText}</div>
                </td>
                <td style="padding: 0.75rem;">
                    <div style="font-size: 0.8rem; font-weight: 600; color: ${getHealthStatusColor(planetNitrogenStatus)};">Planet: ${displayPlanetNitrogen}</div>
                    <div style="font-size: 0.8rem; font-weight: 600; color: ${getHealthStatusColor(sentinelNitrogenStatus)}; margin-top: 0.25rem;">Sentinel: ${displaySentinelNitrogen}</div>
                    <div style="font-size: 0.8rem; font-weight: 600; color: ${plNitrogenColor}; margin-top: 0.25rem; border-top: 1px dashed rgba(255,255,255,0.1); padding-top: 0.25rem;">${plNitrogenText}</div>
                </td>
                <td style="padding: 0.75rem;">
                    <div style="font-weight: 600; color: ${getHealthStatusColor(fWater)};">${displayWater}</div>
                    <div style="font-size: 0.8rem; font-weight: 600; color: ${plWaterColor}; margin-top: 0.25rem; border-top: 1px dashed rgba(255,255,255,0.1); padding-top: 0.25rem;">${plWaterText}</div>
                </td>
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

if (typeof module !== 'undefined') {
    module.exports = {
        isWithinAnalysisWindow,
        formatDateToDMY,
        classifyValueToStatus,
        formatHealthStatus,
        getHealthStatusColor
    };
}
