// --- Global Health Chart Instances ---
var healthGreennessPieChart = null;
var healthNitrogenPieChart = null;
var healthWaterPieChart = null;
var healthGerminationPieChart = null;

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
    if (typeof window !== 'undefined') {
        window.verifiedHealthPlots = null;
    }
    
    // Destroy charts if they exist
    if (healthGreennessPieChart) { healthGreennessPieChart.destroy(); healthGreennessPieChart = null; }
    if (healthNitrogenPieChart) { healthNitrogenPieChart.destroy(); healthNitrogenPieChart = null; }
    if (healthWaterPieChart) { healthWaterPieChart.destroy(); healthWaterPieChart = null; }
    if (healthGerminationPieChart) { healthGerminationPieChart.destroy(); healthGerminationPieChart = null; }
    
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
            val: type === 'greenness' ? res.sentinelGreenness : (type === 'nitrogen' ? res.sentinelNitrogen : res.sentinelGermination),
            date: type === 'germination' ? res.sentinelGermDate : res.sentinelDate
        };
    }

    // Determine values and dates
    const planetVal = type === 'greenness' ? res.planetGreenness : (type === 'nitrogen' ? res.planetNitrogen : res.planetGermination);
    const planetDate = type === 'germination' ? res.planetGermDate : res.planetDate;
    const sentinelVal = type === 'greenness' ? res.sentinelGreenness : (type === 'nitrogen' ? res.sentinelNitrogen : res.sentinelGermination);
    const sentinelDate = type === 'germination' ? res.sentinelGermDate : res.sentinelDate;

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
 * Helper to get the list of Plot Risk (PR) enabled plots to process for Health.
 * Health analysis should only hit APIs for plots with PR enabled.
 */
function getPrEnabledPlots() {
    if (typeof window !== 'undefined' && window.verifiedHealthPlots && Array.isArray(window.verifiedHealthPlots)) {
        return window.verifiedHealthPlots;
    }
    return [];
}

/**
 * Main entry point to load Health Data
 */
async function handleLoadHealthData() {
    if (typeof selectedProjectIds !== 'undefined' && selectedProjectIds.length === 0) {
        alert("Please select at least one project first.");
        return;
    }

    const targetPlots = getPrEnabledPlots();
    if (targetPlots.length === 0) {
        if (typeof plotsData !== 'undefined' && plotsData.length > 0) {
            alert("No Plot Risk-enabled plots found for the selected project(s). Health data is only loaded for plots with PR enabled.");
        } else {
            alert("Please click '🔍 Verify & Load Plots' first to identify compatible plots.");
        }
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
        healthStatus.textContent = "Analyzing " + targetPlots.length + " Plot Risk-Enabled plots...";
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

            const loadGermCheckbox = document.getElementById('health-load-germination-checkbox');
            const shouldLoadGerm = !window.healthIndicatorsDisabled && loadGermCheckbox && loadGermCheckbox.checked;

            let sResp, satResp, gResp;
            let gData = { records: [] };

            if (shouldLoadGerm) {
                const germUrl = `${baseUrl}/api/user-aggregate/germination?environment=${encodeURIComponent(currentEnvironment)}&caIds=${plot.caId}`;
                [sResp, satResp, gResp] = await Promise.all([
                    fetch(sUrl, { headers: { 'Authorization': `Bearer ${authToken}`, 'ngrok-skip-browser-warning': 'true' } }),
                    fetch(satUrl, { headers: { 'Authorization': `Bearer ${authToken}`, 'ngrok-skip-browser-warning': 'true' } }),
                    fetch(germUrl, { headers: { 'Authorization': `Bearer ${authToken}`, 'ngrok-skip-browser-warning': 'true' } })
                ]);
                if (gResp.ok) {
                    try {
                        gData = await gResp.json();
                    } catch (e) {
                        console.error('Failed to parse germination data:', e);
                    }
                }
            } else {
                [sResp, satResp] = await Promise.all([
                    fetch(sUrl, { headers: { 'Authorization': `Bearer ${authToken}`, 'ngrok-skip-browser-warning': 'true' } }),
                    fetch(satUrl, { headers: { 'Authorization': `Bearer ${authToken}`, 'ngrok-skip-browser-warning': 'true' } })
                ]);
            }

            // Handle Sustainability
            let sData = {};
            if (sResp.ok && sResp.status !== 204) {
                const tempData = await sResp.json();
                sData = Array.isArray(tempData) ? (tempData[0] || {}) : tempData;
                if (window.sustainabilityCache) window.sustainabilityCache[plot.caId] = sData;
            }

            const rawHarvestDate = sData.harvestDate || null;
            const harvestDateObj = rawHarvestDate ? new Date(rawHarvestDate) : null;
            if (harvestDateObj && !isNaN(harvestDateObj.getTime())) {
                harvestDateObj.setHours(23, 59, 59, 999);
            }

            // Handle Satellite
            let satResult = null;
            if (satResp.ok) {
                const result = await satResp.json();
                if (result && result.records) {
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

                    // Helper to get calendar day (e.g. "Mon Aug 10 2026")
                    const getCalendarDay = (dateStr) => {
                        if (!dateStr || dateStr === '-') return '';
                        const d = new Date(dateStr);
                        return isNaN(d.getTime()) ? '' : d.toDateString();
                    };

                    // 4. Extract the PL record (for Greenness & Nitrogen)
                    // Must be strictly from a previous calendar day than the overall latest record (validRecords[0])
                    let plData = null;
                    if (validRecords.length > 0) {
                        const latestDay = getCalendarDay(validRecords[0].capturedDateTime);
                        const plCandidates = validRecords.filter(r => getCalendarDay(r.capturedDateTime) !== latestDay);
                        
                        if (plCandidates.length > 0) {
                            const rec = plCandidates[0];
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
                                }
                            } else {
                                const m = rec.metrics?.cropMetrics?.[0];
                                if (m) {
                                    plData.greenness = m.plotDeviationNDVI;
                                    plData.nitrogen = m.plotDeviationNDRE;
                                }
                            }
                        }
                    }

                    // 5. Extract PL Water Stress from a previous Sentinel capture day (since LSWI is Sentinel-only)
                    // Must be strictly from a previous calendar day than the latest Sentinel record (sentinelRecords[0])
                    const sentinelRecords = validRecords.filter(r => r.provider === 'sentinel2' || r.provider === 'sentinel');
                    let plWaterStressVal = '-';
                    let plWaterDateVal = '-';
                    if (sentinelRecords.length > 0) {
                        const latestSentinelDay = getCalendarDay(sentinelRecords[0].capturedDateTime);
                        const plSentinelCandidates = sentinelRecords.filter(r => getCalendarDay(r.capturedDateTime) !== latestSentinelDay);
                        
                        if (plSentinelCandidates.length > 0) {
                            const secSentinel = plSentinelCandidates[0];
                            plWaterDateVal = secSentinel.capturedDateTime;
                            if (window.healthIndicatorsDisabled) {
                                const stats = secSentinel.metrics?.statistics;
                                if (stats && stats.lswi) {
                                    plWaterStressVal = stats.lswi.mean;
                                }
                            } else {
                                const m = secSentinel.metrics?.cropMetrics?.[0];
                                if (m && m.plotDeviationLSWI !== undefined) {
                                    plWaterStressVal = m.plotDeviationLSWI;
                                }
                            }
                        }
                    }
                    if (plData) {
                        plData.waterStress = plWaterStressVal;
                        plData.waterDate = plWaterDateVal;
                    }

                    satResult = { planetData, sentinelData, plData };
                }
            }

            // Handle Germination records
            let planetGerm = null, sentinelGerm = null, plGerm = null;
            if (shouldLoadGerm && gData && gData.records) {
                const getCalendarDay = (dateStr) => {
                    if (!dateStr || dateStr === '-') return '';
                    const d = new Date(dateStr);
                    return isNaN(d.getTime()) ? '' : d.toDateString();
                };

                const validGermRecords = gData.records.filter(record => {
                    if (harvestDateObj && record.date) {
                        const recordDateObj = new Date(record.date);
                        if (!isNaN(recordDateObj.getTime()) && recordDateObj.getTime() > harvestDateObj.getTime()) {
                            return false;
                        }
                    }
                    return true;
                });

                validGermRecords.sort((a, b) => {
                    const tA = new Date(a.date).getTime();
                    const tB = new Date(b.date).getTime();
                    if (tA !== tB) {
                        return tB - tA;
                    }
                    const pA = (a.provider || '').toLowerCase() === 'planet' ? 1 : 0;
                    const pB = (b.provider || '').toLowerCase() === 'planet' ? 1 : 0;
                    return pB - pA;
                });

                for (const record of validGermRecords) {
                    const provider = (record.provider || '').toLowerCase();
                    if (provider === 'planet' && !planetGerm) {
                        planetGerm = {
                            date: record.date,
                            value: record.data?.cropGermination || '-'
                        };
                    }
                    if ((provider === 'sentinel2' || provider === 'sentinel') && !sentinelGerm) {
                        sentinelGerm = {
                            date: record.date,
                            value: record.data?.cropGermination || '-'
                        };
                    }
                    if (planetGerm && sentinelGerm) break;
                }

                if (validGermRecords.length > 0) {
                    const latestGermDay = getCalendarDay(validGermRecords[0].date);
                    const plGermCandidates = validGermRecords.filter(r => getCalendarDay(r.date) !== latestGermDay);
                    if (plGermCandidates.length > 0) {
                        const rec = plGermCandidates[0];
                        plGerm = {
                            date: rec.date,
                            provider: (rec.provider || '').toLowerCase() === 'planet' ? 'Planet' : 'Sentinel',
                            value: rec.data?.cropGermination || '-'
                        };
                    }
                }
            }

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
                plWaterStress: satResult?.plData ? satResult.plData.waterStress : '-',
                plWaterDate: satResult?.plData ? satResult.plData.waterDate : '-',
                
                // Germination fields
                planetGermDate: planetGerm ? planetGerm.date : '-',
                planetGermination: planetGerm ? planetGerm.value : '-',
                sentinelGermDate: sentinelGerm ? sentinelGerm.date : '-',
                sentinelGermination: sentinelGerm ? sentinelGerm.value : '-',
                plGermDate: plGerm ? plGerm.date : '-',
                plGermProvider: plGerm ? plGerm.provider : '-',
                plGermination: plGerm ? plGerm.value : '-'
            };
        } catch (error) {
            console.error(`Error processing health for plot ${plot.caId}:`, error);
            return null;
        }
    }

    try {
        for (let i = 0; i < targetPlots.length; i += BATCH_SIZE) {
            const batch = targetPlots.slice(i, i + BATCH_SIZE);
            const batchResults = await Promise.all(batch.map(p => processPlotHealth(p)));
            batchResults.forEach(res => { if (res) healthResults.push(res); });
            if (healthStatus) healthStatus.textContent = `Processing plots: ${Math.min(i + BATCH_SIZE, targetPlots.length)}/${targetPlots.length}`;
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

function formatGerminationStatus(val) {
    if (!val || val === '-') return '-';
    const v = val.toString().toLowerCase().trim();
    if (v === 'good' || v === 'normal') return 'Good';
    if (v === 'moderate') return 'Moderate';
    if (v === 'needsattention' || v.includes('attention')) return 'Need Attention';
    return val;
}

function getGerminationColor(status) {
    if (status === 'Good') return '#10b981'; // Green
    if (status === 'Moderate') return '#f59e0b'; // Yellow
    if (status === 'Need Attention') return '#ef4444'; // Red
    return 'var(--text-secondary)';
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

    // Germination dynamic card visibility and rendering
    const loadGermCheckbox = document.getElementById('health-load-germination-checkbox');
    const showGermination = !window.healthIndicatorsDisabled && loadGermCheckbox && loadGermCheckbox.checked;

    const germinationCard = document.getElementById('health-germination-card');
    const grid = document.getElementById('health-kpi-grid');

    if (showGermination) {
        if (germinationCard) germinationCard.classList.remove('hidden');
        if (grid) grid.style.gridTemplateColumns = 'repeat(2, 1fr)';
        renderHealthCategoryKPI('germination', kpiResults);
    } else {
        if (germinationCard) germinationCard.classList.add('hidden');
        if (grid) grid.style.gridTemplateColumns = 'repeat(3, 1fr)';
    }

    // Also ensure the base detail table is updated if it's currently visible
    renderHealthSatelliteTable(results);
}

function updateHealthSummaryCards(results) {
    // Total plots: All the eligible plots
    const totalPlots = (typeof plotsData !== 'undefined' && plotsData.length > 0) ? plotsData.length : results.length;
    
    // Plots Harvested: count of harvested
    const plotsHarvested = results.filter(r => r.isHarvested === "Yes").length;
    
    // PR Enabled: all compatible plots loaded in results
    const prPlots = getPrEnabledPlots();
    const plotsCovered = prPlots.length > 0 ? prPlots.length : results.length;
    
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
 * Helper to check if a date string is within the last N days from today, including today.
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

    // Lower bound: today - windowDays + 1 (since today is included)
    const startLimit = new Date(today);
    startLimit.setDate(today.getDate() - windowDays + 1);

    // Return true if startLimit <= record <= today
    return record.getTime() >= startLimit.getTime() && record.getTime() <= today.getTime();
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
        const endLimit = new Date(today); // Today (inclusive)
        const startLimit = new Date(today);
        startLimit.setDate(today.getDate() - windowDays + 1); // today - windowDays + 1
        dateWindowEl.innerHTML = `<i class="far fa-calendar-alt"></i> Window: ${formatDateToDMY(startLimit)} to ${formatDateToDMY(endLimit)}`;
    }

    const categories = type === 'germination'
        ? ['Good', 'Moderate', 'Need Attention']
        : ['Normal', 'Early Symptoms Noted', 'Plots Need Attention'];

    const counts = { 'No Data': 0 };
    const plotBuckets = { 'No Data': [] };
    categories.forEach(c => {
        counts[c] = 0;
        counts[`Excluded (${c})`] = 0;
        plotBuckets[c] = [];
        plotBuckets[`Excluded (${c})`] = [];
    });

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
        } else if (type === 'germination') {
            const onlyPlanet = document.getElementById('health-germination-only-planet')?.checked || false;
            if (onlyPlanet) {
                val = res.planetGermination;
                date = res.planetGermDate;
            } else {
                const target = getTargetProviderData(res, 'germination');
                val = target.val;
                date = target.date;
            }
        }

        let status = val;
        if (type === 'germination') {
            status = formatGerminationStatus(val);
        } else if (window.healthIndicatorsDisabled && !isNaN(val) && val !== '-') {
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

    const data = categories.map(c => counts[c]);
    const total = data.reduce((a, b) => a + b, 0);

    const analyzedEl = document.getElementById(`health-${type}-analyzed`);
    if (analyzedEl) {
        analyzedEl.textContent = `Plots Analyzed (Covered): ${total}`;
    }

    // Pie Chart
    const canvas = document.getElementById(`health-${type}-pie`);
    if (canvas) {
        let chartRef = (type === 'greenness' ? healthGreennessPieChart : (type === 'nitrogen' ? healthNitrogenPieChart : (type === 'water' ? healthWaterPieChart : healthGerminationPieChart)));
        if (chartRef) chartRef.destroy();

        const ctx = canvas.getContext('2d');
        const newChart = new Chart(ctx, {
            type: 'pie',
            data: {
                labels: categories.map(c => type === 'germination' ? formatGerminationStatus(c) : formatHealthStatus(c)),
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
        else if (type === 'water') healthWaterPieChart = newChart;
        else healthGerminationPieChart = newChart;
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
            const displayCatName = type === 'germination' ? formatGerminationStatus(cat) : formatHealthStatus(cat);
            html += `
                <tr style="cursor: pointer; border-bottom: 1px solid var(--border-color);" onclick='showHealthDrillDown("${type}", "${cat}", ${JSON.stringify(plotBuckets[cat]).replace(/'/g, "&apos;")})'>
                    <td style="padding: 0.5rem 0; color: var(--text-secondary);">${displayCatName}</td>
                    <td style="padding: 0.5rem 0; text-align: right; font-weight: 700; color: ${color};">${count} (${pct}%)</td>
                </tr>
            `;
        });

        // Excluded rows matching each status
        const excludedCategories = categories.map(c => `Excluded (${c})`);
        html += `
            <tr style="background: rgba(255, 255, 255, 0.05); pointer-events: none;">
                <td colspan="2" style="padding: 0.4rem 0 0.2rem 0; font-size: 0.75rem; color: var(--text-secondary); font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; border-bottom: 1px solid var(--border-color);">Excluded (Outside Window)</td>
            </tr>
        `;
        excludedCategories.forEach((cat, idx) => {
            const count = counts[cat];
            const color = ['rgba(16, 185, 129, 0.6)', 'rgba(245, 158, 11, 0.6)', 'rgba(239, 68, 68, 0.6)'][idx];
            const displayLabel = type === 'germination' ? formatGerminationStatus(cat.replace('Excluded (', '').replace(')', '')) : formatHealthStatus(cat.replace('Excluded (', '').replace(')', ''));
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
        if (type === 'germination') {
            const goodPct = total > 0 ? Math.round((counts['Good'] / total) * 100) : 0;
            const modPct = total > 0 ? Math.round((counts['Moderate'] / total) * 100) : 0;
            const attnPct = total > 0 ? Math.round((counts['Need Attention'] / total) * 100) : 0;
            insightEl.textContent = `The crop germination data shows that ${goodPct}% is in the Good range, ${modPct}% is in the Moderate range, and ${attnPct}% is in the Need Attention range.`;
        } else {
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
        const includeHarvested = document.getElementById('health-include-harvested')?.checked || false;
        if (!includeHarvested) {
            filteredResults = filteredResults.filter(r => r.isHarvested !== 'Yes');
        }

        const { type, status } = activeHealthFilter;
        const windowInput = document.getElementById(`health-${type}-window`);
        const windowDays = windowInput ? parseInt(windowInput.value, 10) : 15;

        filteredResults = filteredResults.filter(res => {
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
            } else if (type === 'germination') {
                const onlyPlanet = document.getElementById('health-germination-only-planet')?.checked || false;
                if (onlyPlanet) {
                    val = res.planetGermination;
                    date = res.planetGermDate;
                } else {
                    const target = getTargetProviderData(res, 'germination');
                    val = target.val;
                    date = target.date;
                }
            }

            let plotStatus = val;
            if (type === 'germination') {
                plotStatus = formatGerminationStatus(val);
            } else if (window.healthIndicatorsDisabled && !isNaN(val) && val !== '-') {
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
        let displayType = activeHealthFilter.type === 'greenness' ? 'Greenness' : (activeHealthFilter.type === 'nitrogen' ? 'Nutrient' : (activeHealthFilter.type === 'water' ? 'Water Stress' : 'Germination'));
        if (window.healthIndicatorsDisabled) {
            displayType = activeHealthFilter.type === 'greenness' ? 'NDVI' : (activeHealthFilter.type === 'nitrogen' ? 'NDRE' : 'LSWI');
        }
        const displayStatusText = activeHealthFilter.type === 'germination'
            ? formatGerminationStatus(activeHealthFilter.status)
            : formatHealthStatus(activeHealthFilter.status);
        filterBannerHtml = `
            <div style="display: flex; justify-content: space-between; align-items: center; background: rgba(6, 182, 212, 0.08); border: 1px solid rgba(6, 182, 212, 0.2); border-radius: 6px; padding: 0.5rem 1rem; margin-bottom: 1rem;">
                <span style="font-size: 0.85rem; color: var(--text-primary); font-weight: 500;">
                    Showing only plots with status <strong style="color: #06b6d4;">${displayStatusText}</strong> for <strong style="color: #06b6d4;">${displayType}</strong>
                </span>
                <button onclick="clearActiveHealthFilter()" style="padding: 0.25rem 0.5rem; background: #06b6d4; border: none; color: white; border-radius: 4px; font-size: 0.75rem; font-weight: 600; cursor: pointer;">Clear Filter</button>
            </div>
        `;
    }

    if (displayResults.length === 0) {
        container.innerHTML = filterBannerHtml + '<p style="text-align: center; padding: 2rem; color: var(--text-secondary);">No plots matching the active filter.</p>';
        return;
    }

    const loadGermCheckbox = document.getElementById('health-load-germination-checkbox');
    const showGermination = !window.healthIndicatorsDisabled && loadGermCheckbox && loadGermCheckbox.checked;

    let html = filterBannerHtml + `
        <div class="metrics-grid" style="grid-template-columns: 1fr; margin-top: 1rem;">
            <div class="metric-card" style="padding: 0; overflow-x: auto;">
                <table style="width: 100%; border-collapse: collapse; font-size: 0.85rem;">
                    <thead>
                        <tr style="background: rgba(6, 182, 212, 0.1); text-align: left;">
                            <th style="padding: 1rem; border-bottom: 2px solid #06b6d4;">Plot Name</th>
                            <th style="padding: 1rem; border-bottom: 2px solid #06b6d4;">${window.healthIndicatorsDisabled ? 'NDVI (P / S)' : 'Greenness Status (P / S)'}</th>
                            <th style="padding: 1rem; border-bottom: 2px solid #06b6d4;">${window.healthIndicatorsDisabled ? 'NDRE (P / S)' : 'Nutrient Uptake (P / S)'}</th>
                            <th style="padding: 1rem; border-bottom: 2px solid #06b6d4;">${window.healthIndicatorsDisabled ? 'LSWI (Sentinel)' : 'Water Stress Status (Sentinel)'}</th>
                            ${showGermination ? '<th style="padding: 1rem; border-bottom: 2px solid #06b6d4;">Germination (P / S)</th>' : ''}
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

        const lBadgeHtml = ` <span style="background: rgba(6, 182, 212, 0.15); color: #06b6d4; font-size: 0.65rem; padding: 1px 4px; border-radius: 3px; font-weight: 600; display: inline-block; vertical-align: middle;">L</span>`;
        const planetLBadge = (!hasSentinelNewer && res.planetDate !== '-') ? lBadgeHtml : '';
        const sentinelLBadge = (hasSentinelNewer && res.sentinelDate !== '-') ? lBadgeHtml : '';

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

        const plGreenText = res.plDate === '-' ? 'PL: -' : `PL: ${plProviderText} : ${plDateFormatted} : ${displayPlGreen}`;
        const plGreenColor = res.plDate === '-' ? 'var(--text-secondary)' : getHealthStatusColor(plGreenStatus);

        const plNitrogenText = res.plDate === '-' ? 'PL: -' : `PL: ${plProviderText} : ${plDateFormatted} : ${displayPlNitrogen}`;
        const plNitrogenColor = res.plDate === '-' ? 'var(--text-secondary)' : getHealthStatusColor(plNitrogenStatus);

        const plWaterDateFormatted = formatCellDate(res.plWaterDate);
        const plWaterText = (res.plWaterStress === '-') ? 'PL: -' : `PL: ${plWaterDateFormatted} : ${displayPlWater}`;
        const plWaterColor = (res.plWaterStress === '-') ? 'var(--text-secondary)' : getHealthStatusColor(plWaterStatus);

        // Germination Cell variables
        let germinationCellHtml = '';
        if (showGermination) {
            const planetGermDateFormatted = formatCellDate(res.planetGermDate);
            const sentinelGermDateFormatted = formatCellDate(res.sentinelGermDate);
            const plGermDateFormatted = formatCellDate(res.plGermDate);

            const planetGermStatus = formatGerminationStatus(res.planetGermination);
            const sentinelGermStatus = formatGerminationStatus(res.sentinelGermination);
            const plGermStatus = formatGerminationStatus(res.plGermination);

            const hasSentinelGermNewer = (() => {
                if (res.sentinelGermDate !== '-' && res.planetGermDate !== '-') {
                    const pDate = new Date(res.planetGermDate);
                    const sDate = new Date(res.sentinelGermDate);
                    return sDate.getTime() > pDate.getTime();
                }
                return res.sentinelGermDate !== '-' && res.planetGermDate === '-';
            })();

            const planetGermLBadge = (!hasSentinelGermNewer && res.planetGermDate !== '-') ? lBadgeHtml : '';
            const sentinelGermLBadge = (hasSentinelGermNewer && res.sentinelGermDate !== '-') ? lBadgeHtml : '';

            const plGermProviderText = res.plGermProvider === 'Planet' ? 'P' : 'S';
            const plGermDisplayText = res.plGermDate === '-' ? 'PL: -' : `PL: ${plGermProviderText} : ${plGermDateFormatted} : ${plGermStatus}`;
            const plGermColor = res.plGermDate === '-' ? 'var(--text-secondary)' : getGerminationColor(plGermStatus);

            germinationCellHtml = `
                <td style="padding: 0.75rem;">
                    <div style="font-size: 0.8rem; font-weight: 600; color: ${getGerminationColor(planetGermStatus)};">${res.planetGermDate === '-' ? 'P: -' : `P: ${planetGermDateFormatted} : ${planetGermStatus}${planetGermLBadge}`}</div>
                    <div style="font-size: 0.8rem; font-weight: 600; color: ${getGerminationColor(sentinelGermStatus)}; margin-top: 0.25rem;">${res.sentinelGermDate === '-' ? 'S: -' : `S: ${sentinelGermDateFormatted} : ${sentinelGermStatus}${sentinelGermLBadge}`}</div>
                    <div style="font-size: 0.8rem; font-weight: 600; color: ${plGermColor}; margin-top: 0.25rem; border-top: 1px dashed rgba(255,255,255,0.1); padding-top: 0.25rem;">${plGermDisplayText}</div>
                </td>
            `;
        }

        html += `
            <tr style="border-bottom: 1px solid var(--border-color)">
                <td style="padding: 0.75rem; color: var(--text-primary); font-weight: 500;">${res.plotName}</td>
                <td style="padding: 0.75rem;">
                    <div style="font-size: 0.8rem; font-weight: 600; color: ${getHealthStatusColor(planetGreenStatus)};">${res.planetDate === '-' ? 'P: -' : `P: ${planetDateFormatted} : ${displayPlanetGreen}${planetLBadge}`}</div>
                    <div style="font-size: 0.8rem; font-weight: 600; color: ${getHealthStatusColor(sentinelGreenStatus)}; margin-top: 0.25rem;">${res.sentinelDate === '-' ? 'S: -' : `S: ${sentinelDateFormatted} : ${displaySentinelGreen}${sentinelLBadge}`}</div>
                    <div style="font-size: 0.8rem; font-weight: 600; color: ${plGreenColor}; margin-top: 0.25rem; border-top: 1px dashed rgba(255,255,255,0.1); padding-top: 0.25rem;">${plGreenText}</div>
                </td>
                <td style="padding: 0.75rem;">
                    <div style="font-size: 0.8rem; font-weight: 600; color: ${getHealthStatusColor(planetNitrogenStatus)};">${res.planetDate === '-' ? 'P: -' : `P: ${planetDateFormatted} : ${displayPlanetNitrogen}${planetLBadge}`}</div>
                    <div style="font-size: 0.8rem; font-weight: 600; color: ${getHealthStatusColor(sentinelNitrogenStatus)}; margin-top: 0.25rem;">${res.sentinelDate === '-' ? 'S: -' : `S: ${sentinelDateFormatted} : ${displaySentinelNitrogen}${sentinelLBadge}`}</div>
                    <div style="font-size: 0.8rem; font-weight: 600; color: ${plNitrogenColor}; margin-top: 0.25rem; border-top: 1px dashed rgba(255,255,255,0.1); padding-top: 0.25rem;">${plNitrogenText}</div>
                </td>
                <td style="padding: 0.75rem;">
                    <div style="font-size: 0.8rem; font-weight: 600; color: ${getHealthStatusColor(fWater)};">${res.sentinelDate === '-' ? '-' : `${sentinelDateFormatted} : ${displayWater}`}</div>
                    <div style="font-size: 0.8rem; font-weight: 600; color: ${plWaterColor}; margin-top: 0.25rem; border-top: 1px dashed rgba(255,255,255,0.1); padding-top: 0.25rem;">${plWaterText}</div>
                </td>
                ${germinationCellHtml}
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

// =============================================
// DYNAMIC UNIT CONVERSION SYSTEM (TESTABLE ENGINE)
// =============================================
function resolveUnitId(unitType, candidateKeys, masterData = null) {
    const data = masterData || (typeof window !== 'undefined' ? window.tenantUnitMasterCache : null);
    if (!data || !Array.isArray(data['unit-master'])) return null;

    const targetType = (unitType || '').toLowerCase();
    const candidates = (Array.isArray(candidateKeys) ? candidateKeys : [candidateKeys])
        .filter(k => k !== null && k !== undefined)
        .map(k => String(k).trim().toLowerCase());

    if (candidates.length === 0) return null;

    const unitsOfType = data['unit-master'].filter(u => 
        (u.unitType || '').toLowerCase() === targetType
    );

    for (const cand of candidates) {
        const match = unitsOfType.find(u => 
            (u.unitCode && u.unitCode.toLowerCase() === cand) ||
            (u.name && u.name.toLowerCase() === cand) ||
            (u.unitSymbol && u.unitSymbol.toLowerCase() === cand) ||
            (u.unitShortCode && u.unitShortCode.toLowerCase() === cand)
        );
        if (match) return match.id;
    }

    for (const cand of candidates) {
        const match = unitsOfType.find(u => {
            const uName = (u.name || '').toLowerCase();
            const uCode = (u.unitCode || '').toLowerCase();
            const uSym = (u.unitSymbol || '').toLowerCase();

            if (targetType === 'mass') {
                if ((cand === 'kgs' || cand === 'kg' || cand === 'kilogram' || cand === 'kilograms') &&
                    (uCode === 'kilogram' || uName === 'kilogram' || uSym === 'kg')) return true;
                if ((cand === 'tonne' || cand === 'tonnes' || cand === 'mt' || cand === 'metric ton' || cand === 'ton (metric)') &&
                    (uCode.includes('metric') || uName.includes('metric') || uSym === 'mt')) return true;
                if ((cand === 'ton' || cand === 'tons' || cand === 'us ton') &&
                    (uCode === 'ton' || uName === 'ton' || uSym === 'ton')) return true;
                if ((cand === 'quintal' || cand === 'qtl') &&
                    (uCode === 'quintal' || uName === 'quintal')) return true;
                if ((cand === 'gram' || cand === 'g') &&
                    (uCode === 'gram' || uName === 'gram' || uSym === 'g')) return true;
            }

            if (targetType === 'area') {
                if ((cand === 'acre' || cand === 'acres' || cand === 'ac') &&
                    (uCode === 'acre' || uName === 'acre' || uSym === 'acre')) return true;
                if ((cand === 'ha' || cand === 'hectare' || cand === 'hectares') &&
                    (uCode === 'hectare' || uName === 'hectare' || uSym === 'ha' || uSym.toLowerCase() === 'hectare')) return true;
                if ((cand === 'sq mt' || cand === 'square meter' || cand === 'sqm') &&
                    (uCode.includes('square_meter') || uName.includes('square meter'))) return true;
                if ((cand === 'bigha') && (uCode === 'bigha' || uName === 'bigha')) return true;
                if ((cand === 'gunta') && (uCode === 'gunta' || uName === 'gunta')) return true;
            }

            return false;
        });
        if (match) return match.id;
    }

    return null;
}

function getFallbackFactor(src, tgt, unitType) {
    const type = (unitType || '').toLowerCase();
    if (type === 'area') {
        const isSrcAcre = src.includes('acre') || src === 'ac';
        const isSrcHa = src.includes('ha') || src.includes('hectare');
        const isTgtAcre = tgt.includes('acre') || tgt === 'ac';
        const isTgtHa = tgt.includes('ha') || tgt.includes('hectare');

        if (isSrcHa && isTgtAcre) return 2.47105;
        if (isSrcAcre && isTgtHa) return 0.404686;
        return 1.0;
    }
    if (type === 'mass') {
        const toTon = (u) => {
            if (u.includes('metric') || u === 'tonne' || u === 'tonnes' || u === 'mt') return 1.0;
            if (u === 'kgs' || u === 'kg' || u.includes('kilogram')) return 0.001;
            if (u === 'ton' || u === 'tons') return 0.9071847;
            if (u === 'quintal') return 0.1;
            if (u === 'gram' || u === 'g') return 0.000001;
            return 1.0;
        };
        const srcToTon = toTon(src);
        const tgtToTon = toTon(tgt);
        return tgtToTon > 0 ? (srcToTon / tgtToTon) : 1.0;
    }
    return 1.0;
}

function getDynamicFactor(srcCandidate, tgtCandidate, unitType, masterData = null) {
    const data = masterData || (typeof window !== 'undefined' ? window.tenantUnitMasterCache : null);

    const sStr = String(Array.isArray(srcCandidate) ? srcCandidate[0] : srcCandidate || '').trim().toLowerCase();
    const tStr = String(Array.isArray(tgtCandidate) ? tgtCandidate[0] : tgtCandidate || '').trim().toLowerCase();

    if (sStr === tStr) return 1.0;

    const srcId = resolveUnitId(unitType, srcCandidate, data);
    const tgtId = resolveUnitId(unitType, tgtCandidate, data);

    if (srcId !== null && tgtId !== null) {
        if (srcId === tgtId) return 1.0;

        if (data && Array.isArray(data['unit-conversion'])) {
            const direct = data['unit-conversion'].find(r => 
                Number(r.fromUnitId) === Number(srcId) && Number(r.toUnitId) === Number(tgtId)
            );
            if (direct && !isNaN(parseFloat(direct.conversionFactor))) {
                return parseFloat(direct.conversionFactor);
            }

            const reciprocal = data['unit-conversion'].find(r => 
                Number(r.fromUnitId) === Number(tgtId) && Number(r.toUnitId) === Number(srcId)
            );
            if (reciprocal && !isNaN(parseFloat(reciprocal.conversionFactor)) && parseFloat(reciprocal.conversionFactor) !== 0) {
                return 1.0 / parseFloat(reciprocal.conversionFactor);
            }
        }
    }

    return getFallbackFactor(sStr, tStr, unitType);
}

function convertYield(valueInTonnePerHa, targetUnit, masterData = null) {
    const [massUnit, areaUnit] = targetUnit.split('_');
    const massFactor = getDynamicFactor(['METRIC_TON', 'Ton (Metric)', 'MT', 'Tonnes'], massUnit, 'Mass', masterData);
    const areaFactor = getDynamicFactor(['HECTARE', 'Hectare', 'ha'], areaUnit, 'Area', masterData);
    return areaFactor > 0 ? (valueInTonnePerHa * massFactor / areaFactor) : valueInTonnePerHa;
}

function convertHarvest(valueInTonnes, targetUnit, masterData = null) {
    const massFactor = getDynamicFactor(['METRIC_TON', 'Ton (Metric)', 'MT', 'Tonnes'], targetUnit, 'Mass', masterData);
    return valueInTonnes * massFactor;
}

function formatTrendDate(dateStr) {
    if (!dateStr) return '';
    const parts = dateStr.split('T')[0].split('-');
    if (parts.length === 3) {
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const mIdx = parseInt(parts[1], 10) - 1;
        const day = parseInt(parts[2], 10);
        return `${day < 10 ? '0' + day : day} ${months[mIdx] || ''}`;
    }
    return dateStr;
}

function extractPlotMultiModelData(d, yieldUnitOverride = null, harvestUnitOverride = null) {
    if (!d || !Array.isArray(d.yieldRawRecords)) return null;

    const bDaysRecord = d.yieldRawRecords.find(r => (r.modelType || '').toUpperCase() === 'BIOMASS_DAYS');
    const tasumiRecord = d.yieldRawRecords.find(r => (r.modelType || '').toUpperCase() === 'TASUMI');

    if (!bDaysRecord || !Array.isArray(bDaysRecord.gddPredictions) || bDaysRecord.gddPredictions.length === 0) {
        return null;
    }

    const yieldUnit = yieldUnitOverride || (typeof getDataYieldUnit === 'function' ? getDataYieldUnit() : 'kgs_acre');
    const harvestUnit = harvestUnitOverride || (typeof getDataHarvestUnit === 'function' ? getDataHarvestUnit() : 'kgs');

    // Sort biomass days progression chronologically
    const sortedGdd = [...bDaysRecord.gddPredictions].sort((a, b) => (a.cutoff_date || '').localeCompare(b.cutoff_date || ''));

    const labels = [];
    const yieldBiomassData = [];
    const yieldBiomassMin = [];
    const yieldBiomassMax = [];
    const harvestBiomassData = [];
    const harvestBiomassMin = [];
    const harvestBiomassMax = [];

    sortedGdd.forEach(p => {
        labels.push(formatTrendDate(p.cutoff_date));

        const rawYAvg = parseFloat(p.yieldAvg || p.yield_days || p.yieldMin || 0);
        const rawYMin = parseFloat(p.yieldMin !== undefined ? p.yieldMin : rawYAvg);
        const rawYMax = parseFloat(p.yieldMax !== undefined ? p.yieldMax : rawYAvg);

        const rawHAvg = parseFloat(p.productionAvg || p.productionMin || 0);
        const rawHMin = parseFloat(p.productionMin !== undefined ? p.productionMin : rawHAvg);
        const rawHMax = parseFloat(p.productionMax !== undefined ? p.productionMax : rawHAvg);

        yieldBiomassData.push(parseFloat(convertYield(rawYAvg, yieldUnit).toFixed(2)));
        yieldBiomassMin.push(parseFloat(convertYield(Math.min(rawYMin, rawYMax), yieldUnit).toFixed(2)));
        yieldBiomassMax.push(parseFloat(convertYield(Math.max(rawYMin, rawYMax), yieldUnit).toFixed(2)));

        harvestBiomassData.push(parseFloat(convertHarvest(rawHAvg, harvestUnit).toFixed(2)));
        harvestBiomassMin.push(parseFloat(convertHarvest(Math.min(rawHMin, rawHMax), harvestUnit).toFixed(2)));
        harvestBiomassMax.push(parseFloat(convertHarvest(Math.max(rawHMin, rawHMax), harvestUnit).toFixed(2)));
    });

    let tasumiYieldAvg = null;
    let tasumiYieldMin = null;
    let tasumiYieldMax = null;
    let tasumiHarvestAvg = null;
    let tasumiHarvestMin = null;
    let tasumiHarvestMax = null;
    let tasumiDateStr = null;

    if (tasumiRecord && tasumiRecord.parameters) {
        const p = tasumiRecord.parameters;
        const rawYAvg = parseFloat(p.yieldAvg || p.yieldMin || 0);
        const rawYMin = parseFloat(p.yieldMin !== undefined ? p.yieldMin : rawYAvg);
        const rawYMax = parseFloat(p.yieldMax !== undefined ? p.yieldMax : rawYAvg);

        const rawHAvg = parseFloat(p.productionAvg || p.productionMin || 0);
        const rawHMin = parseFloat(p.productionMin !== undefined ? p.productionMin : rawHAvg);
        const rawHMax = parseFloat(p.productionMax !== undefined ? p.productionMax : rawHAvg);

        tasumiYieldAvg = parseFloat(convertYield(rawYAvg, yieldUnit).toFixed(2));
        tasumiYieldMin = parseFloat(convertYield(Math.min(rawYMin, rawYMax), yieldUnit).toFixed(2));
        tasumiYieldMax = parseFloat(convertYield(Math.max(rawYMin, rawYMax), yieldUnit).toFixed(2));

        tasumiHarvestAvg = parseFloat(convertHarvest(rawHAvg, harvestUnit).toFixed(2));
        tasumiHarvestMin = parseFloat(convertHarvest(Math.min(rawHMin, rawHMax), harvestUnit).toFixed(2));
        tasumiHarvestMax = parseFloat(convertHarvest(Math.max(rawHMin, rawHMax), harvestUnit).toFixed(2));

        tasumiDateStr = tasumiRecord.predictionDate 
            ? formatTrendDate(tasumiRecord.predictionDate.substring(0, 10)) 
            : (tasumiRecord.createdDateTime ? formatTrendDate(tasumiRecord.createdDateTime.substring(0, 10)) : 'Latest');
    }

    const unifiedYieldTrend = [...yieldBiomassData];
    const unifiedYieldMin = [...yieldBiomassMin];
    const unifiedYieldMax = [...yieldBiomassMax];

    const unifiedHarvestTrend = [...harvestBiomassData];
    const unifiedHarvestMin = [...harvestBiomassMin];
    const unifiedHarvestMax = [...harvestBiomassMax];

    const unifiedLabels = [...labels];

    if (tasumiYieldAvg !== null) {
        unifiedLabels.push(tasumiDateStr || 'Latest');
        unifiedYieldTrend.push(tasumiYieldAvg);
        unifiedYieldMin.push(tasumiYieldMin);
        unifiedYieldMax.push(tasumiYieldMax);

        unifiedHarvestTrend.push(tasumiHarvestAvg);
        unifiedHarvestMin.push(tasumiHarvestMin);
        unifiedHarvestMax.push(tasumiHarvestMax);
    }

    const stdYield = parseFloat(Number(d.y1 || 0).toFixed(2));
    const reYield = parseFloat(Number(d.y2 || 0).toFixed(2));
    const maxYieldVal = Math.max(...unifiedYieldTrend, stdYield, reYield);
    
    // Use API Max Attainable Yield if present, otherwise calculate heuristic fallback
    let maxAttainableYield;
    const procMaxTonHa = (d.maxAttainableYieldTonHa !== undefined && d.maxAttainableYieldTonHa !== null)
        ? d.maxAttainableYieldTonHa
        : (d._processed && d._processed.maxAttainableYieldTonHa !== undefined ? d._processed.maxAttainableYieldTonHa : null);
    if (procMaxTonHa !== null && !isNaN(procMaxTonHa)) {
        maxAttainableYield = parseFloat(convertYield(procMaxTonHa, yieldUnit).toFixed(2));
    } else {
        maxAttainableYield = parseFloat((stdYield > 0 ? (stdYield * 1.85) : (maxYieldVal * 1.2)).toFixed(2));
    }

    const stdHarvest = parseFloat(Number(d.h1 || 0).toFixed(2));
    const reHarvest = parseFloat(Number(d.h2 || 0).toFixed(2));
    const maxHarvestVal = Math.max(...unifiedHarvestTrend, stdHarvest, reHarvest);
    
    // For harvest: if area is available and API max attainable yield is known, calculate max harvest as maxAttainableYield * area
    let maxAttainableHarvest;
    const plotAreaHa = Number(d.auditedArea || (d._processed && d._processed.auditedArea) || 0) * getDynamicFactor(d.areaUnit || (d._processed && d._processed.areaUnit) || 'ha', 'ha', 'Area');
    if (procMaxTonHa !== null && !isNaN(procMaxTonHa) && plotAreaHa > 0) {
        const maxAttainableHarvestTon = procMaxTonHa * plotAreaHa;
        maxAttainableHarvest = parseFloat(convertHarvest(maxAttainableHarvestTon, harvestUnit).toFixed(2));
    } else {
        maxAttainableHarvest = parseFloat((stdHarvest > 0 ? (stdHarvest * 1.85) : (maxHarvestVal * 1.2)).toFixed(2));
    }

    return {
        labels: unifiedLabels,
        biomassLabels: labels,
        yieldTrend: unifiedYieldTrend,
        yieldMinTrend: unifiedYieldMin,
        yieldMaxTrend: unifiedYieldMax,
        harvestTrend: unifiedHarvestTrend,
        harvestMinTrend: unifiedHarvestMin,
        harvestMaxTrend: unifiedHarvestMax,
        stdYield, reYield, maxAttainableYield,
        stdHarvest, reHarvest, maxAttainableHarvest,
        tasumi: {
            yieldAvg: tasumiYieldAvg,
            yieldMin: tasumiYieldMin,
            yieldMax: tasumiYieldMax,
            harvestAvg: tasumiHarvestAvg,
            harvestMin: tasumiHarvestMin,
            harvestMax: tasumiHarvestMax,
            date: tasumiDateStr,
            index: tasumiYieldAvg !== null ? (unifiedLabels.length - 1) : -1
        }
    };
}

function resolveYieldPredictionRules(records) {
    if (!Array.isArray(records) || records.length === 0) return null;

    const getRecordTime = (r) => {
        if (!r) return 0;
        const isTasumi = (r.modelType || '').trim().toUpperCase() === 'TASUMI';
        const dateStr = isTasumi 
            ? (r.predictionDate || r.createdDateTime || r.modifiedDateTime)
            : (r.modifiedDateTime || r.predictionDate || r.createdDateTime);
        if (!dateStr) return 0;
        const t = new Date(dateStr).getTime();
        return isNaN(t) ? 0 : t;
    };

    // 1. Use TASUMI data as yield and harvest data plot if it is present
    const tasumiRecords = records.filter(r => (r.modelType || '').trim().toUpperCase() === 'TASUMI');
    if (tasumiRecords.length > 0) {
        tasumiRecords.sort((a, b) => getRecordTime(b) - getRecordTime(a));
        const r = tasumiRecords[0];
        const p = r.parameters || {};
        return {
            yieldMin: p.yieldMin !== undefined ? p.yieldMin : (r.yieldMin !== undefined ? r.yieldMin : 'NA'),
            yieldMax: p.yieldMax !== undefined ? p.yieldMax : (r.yieldMax !== undefined ? r.yieldMax : 'NA'),
            yieldAvg: p.yieldAvg || p.yieldMin || r.yieldAvg || r.yieldMin || 'NA',
            productionMin: p.productionMin !== undefined ? p.productionMin : (r.productionMin !== undefined ? r.productionMin : 'NA'),
            productionMax: p.productionMax !== undefined ? p.productionMax : (r.productionMax !== undefined ? r.productionMax : 'NA'),
            productionAvg: p.productionAvg || p.productionMin || r.productionAvg || r.productionMin || 'NA',
            modelType: 'TASUMI'
        };
    }

    // 2. If TASUMI not present, use the latest BIOMASS_DAYS values (do not use aggregate of all available biomass data)
    const biomassDaysRecords = records.filter(r => (r.modelType || '').trim().toUpperCase() === 'BIOMASS_DAYS');
    if (biomassDaysRecords.length > 0) {
        biomassDaysRecords.sort((a, b) => getRecordTime(b) - getRecordTime(a));
        const r = biomassDaysRecords[0];
        if (Array.isArray(r.gddPredictions) && r.gddPredictions.length > 0) {
            const sortedGdd = [...r.gddPredictions].sort((a, b) => (a.cutoff_date || '').localeCompare(b.cutoff_date || ''));
            const latestGdd = sortedGdd[sortedGdd.length - 1];
            return {
                yieldMin: latestGdd.yieldMin !== undefined ? latestGdd.yieldMin : (r.parameters && r.parameters.yieldMin !== undefined ? r.parameters.yieldMin : (r.yieldMin !== undefined ? r.yieldMin : 'NA')),
                yieldMax: latestGdd.yieldMax !== undefined ? latestGdd.yieldMax : (r.parameters && r.parameters.yieldMax !== undefined ? r.parameters.yieldMax : (r.yieldMax !== undefined ? r.yieldMax : 'NA')),
                yieldAvg: latestGdd.yieldAvg || latestGdd.yield_days || (r.parameters && (r.parameters.yieldAvg || r.parameters.yieldMin)) || r.yieldAvg || 'NA',
                productionMin: latestGdd.productionMin !== undefined ? latestGdd.productionMin : (r.parameters && r.parameters.productionMin !== undefined ? r.parameters.productionMin : (r.productionMin !== undefined ? r.productionMin : 'NA')),
                productionMax: latestGdd.productionMax !== undefined ? latestGdd.productionMax : (r.parameters && r.parameters.productionMax !== undefined ? r.parameters.productionMax : (r.productionMax !== undefined ? r.productionMax : 'NA')),
                productionAvg: latestGdd.productionAvg || (r.parameters && (r.parameters.productionAvg || r.parameters.productionMin)) || r.productionAvg || 'NA',
                modelType: 'BIOMASS_DAYS'
            };
        }
        const p = r.parameters || r;
        if (p && (p.yieldMin !== undefined || p.productionMin !== undefined || p.yieldAvg !== undefined || p.productionAvg !== undefined)) {
            return {
                yieldMin: p.yieldMin !== undefined ? p.yieldMin : 'NA',
                yieldMax: p.yieldMax !== undefined ? p.yieldMax : 'NA',
                yieldAvg: p.yieldAvg || p.yieldMin || 'NA',
                productionMin: p.productionMin !== undefined ? p.productionMin : 'NA',
                productionMax: p.productionMax !== undefined ? p.productionMax : 'NA',
                productionAvg: p.productionAvg || p.productionMin || 'NA',
                modelType: 'BIOMASS_DAYS'
            };
        }
    }

    // 3. If none present, mark plot as NA and dont use for aggregation
    return null;
}

function sortYieldBaseData(rows) {
    if (!Array.isArray(rows) || rows.length === 0) return rows || [];

    const getTextVal = (row, keys) => {
        for (let k of keys) {
            const foundKey = Object.keys(row).find(rk => rk.toLowerCase().includes(k.toLowerCase()));
            if (foundKey) return row[foundKey];
        }
        return '';
    };

    const getRowPlotName = (r) => {
        if (!r) return '';
        if (r._processed && r._processed.name) return r._processed.name;
        if (r['Plot Name']) return r['Plot Name'];
        if (r['CA Name']) return r['CA Name'];
        if (r.name) return r.name;
        if (r.plotName) return r.plotName;
        return getTextVal(r, ['plot name', 'ca name']) || '';
    };

    return [...rows].sort((a, b) => {
        const nameA = String(getRowPlotName(a) || '').trim();
        const nameB = String(getRowPlotName(b) || '').trim();
        return nameA.localeCompare(nameB, undefined, { numeric: true, sensitivity: 'base' });
    });
}

function getPlotPredictionModelComparison(d, targetYieldUnit, targetHarvestUnit) {
    const yUnit = targetYieldUnit || (typeof getDataYieldUnit === 'function' ? getDataYieldUnit() : 'tonne_ha');
    const hUnit = targetHarvestUnit || (typeof getDataHarvestUnit === 'function' ? getDataHarvestUnit() : 'tonnes');

    const records = (d && Array.isArray(d.yieldRawRecords) && d.yieldRawRecords) ||
                    (d && d._processed && Array.isArray(d._processed.yieldRawRecords) && d._processed.yieldRawRecords) ||
                    (d && d.row && Array.isArray(d.row.yieldRawRecords) && d.row.yieldRawRecords) ||
                    (Array.isArray(d) ? d : []);

    const getRecordTime = (r) => {
        if (!r) return 0;
        const isTasumi = (r.modelType || '').trim().toUpperCase() === 'TASUMI';
        const dateStr = isTasumi
            ? (r.predictionDate || r.createdDateTime || r.modifiedDateTime)
            : (r.modifiedDateTime || r.predictionDate || r.createdDateTime);
        if (!dateStr) return 0;
        const t = new Date(dateStr).getTime();
        return isNaN(t) ? 0 : t;
    };

    const safeConvertH = (val) => {
        if (val === undefined || val === null || val === 'NA' || isNaN(val)) return null;
        if (typeof convertHarvest === 'function') {
            return convertHarvest(parseFloat(val), hUnit);
        }
        return parseFloat(val);
    };

    const safeConvertY = (val) => {
        if (val === undefined || val === null || val === 'NA' || isNaN(val)) return null;
        if (typeof convertYield === 'function') {
            return convertYield(parseFloat(val), yUnit);
        }
        return parseFloat(val);
    };

    let tasumi = {
        harvestMin: null,
        harvestMax: null,
        yieldMin: null,
        yieldMax: null,
        date: null,
        timestamp: 0,
        available: false
    };

    let biomass = {
        harvestMin: null,
        harvestMax: null,
        yieldMin: null,
        yieldMax: null,
        date: null,
        timestamp: 0,
        available: false
    };

    // 1. Check TASUMI records
    const tasumiRecords = records.filter(r => (r.modelType || '').trim().toUpperCase() === 'TASUMI');
    if (tasumiRecords.length > 0) {
        tasumiRecords.sort((a, b) => getRecordTime(b) - getRecordTime(a));
        const r = tasumiRecords[0];
        const p = r.parameters || {};
        const rawYMin = p.yieldMin !== undefined ? p.yieldMin : r.yieldMin;
        const rawYMax = p.yieldMax !== undefined ? p.yieldMax : r.yieldMax;
        const rawHMin = p.productionMin !== undefined ? p.productionMin : r.productionMin;
        const rawHMax = p.productionMax !== undefined ? p.productionMax : r.productionMax;

        tasumi.harvestMin = safeConvertH(rawHMin);
        tasumi.harvestMax = safeConvertH(rawHMax);
        tasumi.yieldMin = safeConvertY(rawYMin);
        tasumi.yieldMax = safeConvertY(rawYMax);
        tasumi.date = r.predictionDate || r.createdDateTime || r.modifiedDateTime || null;
        tasumi.timestamp = getRecordTime(r);
        tasumi.available = tasumi.harvestMin !== null || tasumi.yieldMin !== null;
    }

    // 2. Check BIOMASS records (BIOMASS_DAYS or BIOMASS)
    const biomassRecords = records.filter(r => {
        const m = (r.modelType || '').trim().toUpperCase();
        return m === 'BIOMASS_DAYS' || m.includes('BIOMASS');
    });
    if (biomassRecords.length > 0) {
        biomassRecords.sort((a, b) => getRecordTime(b) - getRecordTime(a));
        const r = biomassRecords[0];
        if (Array.isArray(r.gddPredictions) && r.gddPredictions.length > 0) {
            const sortedGdd = [...r.gddPredictions].sort((a, b) => (a.cutoff_date || '').localeCompare(b.cutoff_date || ''));
            const latestGdd = sortedGdd[sortedGdd.length - 1];
            const p = r.parameters || {};

            const rawYMin = latestGdd.yieldMin !== undefined ? latestGdd.yieldMin : (p.yieldMin !== undefined ? p.yieldMin : r.yieldMin);
            const rawYMax = latestGdd.yieldMax !== undefined ? latestGdd.yieldMax : (p.yieldMax !== undefined ? p.yieldMax : r.yieldMax);
            const rawHMin = latestGdd.productionMin !== undefined ? latestGdd.productionMin : (p.productionMin !== undefined ? p.productionMin : r.productionMin);
            const rawHMax = latestGdd.productionMax !== undefined ? latestGdd.productionMax : (p.productionMax !== undefined ? p.productionMax : r.productionMax);

            biomass.harvestMin = safeConvertH(rawHMin);
            biomass.harvestMax = safeConvertH(rawHMax);
            biomass.yieldMin = safeConvertY(rawYMin);
            biomass.yieldMax = safeConvertY(rawYMax);
            biomass.date = latestGdd.cutoff_date || r.modifiedDateTime || r.predictionDate || r.createdDateTime || null;
            if (latestGdd.cutoff_date) {
                const ct = new Date(latestGdd.cutoff_date).getTime();
                biomass.timestamp = isNaN(ct) ? 0 : ct;
            }
            if (!biomass.timestamp) {
                biomass.timestamp = getRecordTime(r);
            }
            biomass.available = biomass.harvestMin !== null || biomass.yieldMin !== null;
        } else {
            const p = r.parameters || r;
            const rawYMin = p.yieldMin !== undefined ? p.yieldMin : 'NA';
            const rawYMax = p.yieldMax !== undefined ? p.yieldMax : 'NA';
            const rawHMin = p.productionMin !== undefined ? p.productionMin : 'NA';
            const rawHMax = p.productionMax !== undefined ? p.productionMax : 'NA';

            biomass.harvestMin = safeConvertH(rawHMin);
            biomass.harvestMax = safeConvertH(rawHMax);
            biomass.yieldMin = safeConvertY(rawYMin);
            biomass.yieldMax = safeConvertY(rawYMax);
            biomass.date = r.modifiedDateTime || r.predictionDate || r.createdDateTime || null;
            biomass.timestamp = getRecordTime(r);
            biomass.available = biomass.harvestMin !== null || biomass.yieldMin !== null;
        }
    }

    // 3. Fallback when records is empty but single processed model exists
    if (!tasumi.available && !biomass.available && d && !d.noPrediction) {
        const m = ((d.modelType || (d._processed && d._processed.modelType)) || '').toUpperCase();
        const proc = d._processed || d;
        if (m === 'TASUMI') {
            tasumi.harvestMin = safeConvertH(proc.h3_min);
            tasumi.harvestMax = safeConvertH(proc.h3_max);
            tasumi.yieldMin = safeConvertY(proc.y3_min);
            tasumi.yieldMax = safeConvertY(proc.y3_max);
            tasumi.available = tasumi.harvestMin !== null || tasumi.yieldMin !== null;
        } else if (m === 'BIOMASS_DAYS' || m.includes('BIOMASS')) {
            biomass.harvestMin = safeConvertH(proc.h3_min);
            biomass.harvestMax = safeConvertH(proc.h3_max);
            biomass.yieldMin = safeConvertY(proc.y3_min);
            biomass.yieldMax = safeConvertY(proc.y3_max);
            biomass.available = biomass.harvestMin !== null || biomass.yieldMin !== null;
        }
    }

    // Determine latest model
    let isTasumiLatest = false;
    let isBiomassLatest = false;

    if (tasumi.available && biomass.available) {
        if (biomass.timestamp > tasumi.timestamp) {
            isBiomassLatest = true;
        } else {
            // Tasumi is strictly newer OR timestamps are equal (Tasumi gets priority)
            isTasumiLatest = true;
        }
    } else if (tasumi.available) {
        isTasumiLatest = true;
    } else if (biomass.available) {
        isBiomassLatest = true;
    }

    return {
        tasumi,
        biomass,
        isTasumiLatest,
        isBiomassLatest,
        latestModel: isTasumiLatest ? 'TASUMI' : (isBiomassLatest ? 'BIOMASS' : null)
    };
}

function renderModelCell(tVal, bVal, isTasumiLatest, isBiomassLatest, tDate, bDate) {
    const lBadgeHtml = ` <span style="background: rgba(6, 182, 212, 0.15); color: #06b6d4; font-size: 0.65rem; padding: 1px 4px; border-radius: 3px; font-weight: 600; display: inline-block; vertical-align: middle; margin-left: 3px;" title="Latest Model Prediction">L</span>`;

    const formatVal = (v) => {
        if (v === null || v === undefined || v === 'NA' || isNaN(v)) return '-';
        if (typeof fmtSmart === 'function') return fmtSmart(v);
        const s = Number(v).toFixed(2);
        return s.endsWith('.00') ? s.slice(0, -3) : s;
    };

    const hasTVal = tVal !== null && tVal !== undefined && tVal !== 'NA' && !isNaN(tVal);
    const hasBVal = bVal !== null && bVal !== undefined && bVal !== 'NA' && !isNaN(bVal);

    const tDisplay = hasTVal ? formatVal(tVal) : '-';
    const bDisplay = hasBVal ? formatVal(bVal) : '-';

    const tBadge = (isTasumiLatest && hasTVal) ? lBadgeHtml : '';
    const bBadge = (isBiomassLatest && hasBVal) ? lBadgeHtml : '';

    const tColor = hasTVal ? 'var(--text-primary)' : 'var(--text-secondary)';
    const bColor = hasBVal ? 'var(--text-primary)' : 'var(--text-secondary)';

    const tTitle = tDate ? `Tasumi Date: ${tDate}` : 'Tasumi Model';
    const bTitle = bDate ? `Biomass Date: ${bDate}` : 'Biomass Model';

    return `
        <div style="font-size: 0.8rem; line-height: 1.35; white-space: nowrap;" title="${tTitle}">
            <span style="font-weight: 600; color: #818cf8;">T:</span> <span style="color: ${tColor};">${tDisplay}</span>${tBadge}
        </div>
        <div style="font-size: 0.8rem; line-height: 1.35; margin-top: 2px; white-space: nowrap;" title="${bTitle}">
            <span style="font-weight: 600; color: #34d399;">B:</span> <span style="color: ${bColor};">${bDisplay}</span>${bBadge}
        </div>
    `;
}

function extractVarietyYieldDetails(varietyJson) {
    if (!varietyJson) return { maxAttainableYield: 'NA', expectedYieldUnits: null, referenceAreaUnits: null, expectedYield: null };

    const dataObj = varietyJson.data || varietyJson;
    let locEntry = null;

    if (Array.isArray(dataObj.yieldPerLocation) && dataObj.yieldPerLocation.length > 0) {
        locEntry = dataObj.yieldPerLocation[0];
    } else if (dataObj.yieldPerLocation && typeof dataObj.yieldPerLocation === 'object') {
        locEntry = dataObj.yieldPerLocation;
    }

    if (!locEntry) {
        if (Array.isArray(dataObj.companyYieldPerLocation) && dataObj.companyYieldPerLocation.length > 0) {
            locEntry = dataObj.companyYieldPerLocation[0];
        }
    }

    if (!locEntry) {
        return { maxAttainableYield: 'NA', expectedYieldUnits: null, referenceAreaUnits: null, expectedYield: null };
    }

    const rawMax = locEntry.maxAttainableYield;
    const maxVal = (rawMax !== undefined && rawMax !== null && rawMax !== '' && !isNaN(parseFloat(rawMax)))
        ? parseFloat(rawMax)
        : 'NA';

    const refArea = locEntry.refrenceAreaUnits || locEntry.referenceAreaUnits || null;
    const expUnit = locEntry.expectedYieldUnits || null;
    const expYield = (locEntry.expectedYield !== undefined && locEntry.expectedYield !== null && !isNaN(parseFloat(locEntry.expectedYield)))
        ? parseFloat(locEntry.expectedYield)
        : null;

    return {
        maxAttainableYield: maxVal,
        expectedYieldUnits: expUnit,
        referenceAreaUnits: refArea,
        expectedYield: expYield
    };
}

if (typeof module !== 'undefined') {
    module.exports = {
        isWithinAnalysisWindow,
        formatDateToDMY,
        classifyValueToStatus,
        formatHealthStatus,
        getHealthStatusColor,
        formatGerminationStatus,
        getGerminationColor,
        getPrEnabledPlots,
        resolveUnitId,
        getDynamicFactor,
        getFallbackFactor,
        convertYield,
        convertHarvest,
        formatTrendDate,
        extractPlotMultiModelData,
        resolveYieldPredictionRules,
        sortYieldBaseData,
        getPlotPredictionModelComparison,
        renderModelCell,
        extractVarietyYieldDetails
    };
}
