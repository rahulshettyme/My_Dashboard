// Chart Instances (Global)
var growthProgressionChartInstance = null;
var growthStageChartInstance = null;
var harvestWindowChartInstance = null;
var harvestDailyChartInstance = null;
var harvestWindowPieChart = null;

document.addEventListener('DOMContentLoaded', () => {
    // Auto-detect production environment
    const urlInput = document.getElementById('server-url');
    const urlContainer = document.getElementById('server-url-container');
    const isRender = window.location.hostname.includes('onrender.com');
    const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

    if (urlInput) {
        // User Request: Remove Backend Server URL when running in local
        if (isLocal && urlContainer) {
            urlContainer.style.display = 'none';
        }

        if (!isLocal) {
            // We are likely on Render or another deployed environment
            urlInput.value = window.location.origin; // Set to current site URL

            // Hide the input if it's explicitly Render
            if (isRender && urlContainer) {
                urlContainer.style.display = 'none';
            }
        }
    }

    // Load system unit conversions
    fetchUnitConversions();

    // Add event listener for aggregate toggle
    document.getElementById('include-no-prediction-agg')?.addEventListener('change', () => {
        if (globalData && globalData.length > 0) processData(globalData);
    });
});

const excelUploadInput = document.getElementById('excel-upload');
if (excelUploadInput) {
    excelUploadInput.addEventListener('change', handleFileUpload);
}

var globalData = [];
var plotsList = []; // Store plot names for searchable dropdown
var plotsWithPrediction = []; // Plots with yield prediction data
var plotsWithoutPrediction = []; // Missing Data plots
var plotsNotEnabled = []; // Not Enabled plots

var authToken = null;
var currentEnvironment = null;
var currentTenant = null;
var plotsData = [];
var userPrefs = {};
var companyPrefs = {};
var projectsSortedByName = false;
var projectsList = [];

var selectedProjectIds = [];
var showPredictionAvailable = true; // Toggle state (Legacy)
var unitConversions = []; // Store system reference factors
var activeHarvestWindowFilter = null; // 'Before Window', 'Within Window', 'Post Window'
var lastProcessedPlots = [];
var lastHarvestTasks = [];

// --- Login State (from script.js) ---
var loginState = {
    environmentUrls: {},
    users: [],
    loading: true
};

// DOM Elements for Login (synced with index.html names where possible)
const loginElements = {
    envSelect: document.getElementById('environment'),
    tenantSelect: document.getElementById('tenant'),
    userSelect: document.getElementById('user'),
    userActions: document.getElementById('user-actions'),
    loginBtn: document.getElementById('login-btn'),
    addUserBtn: document.getElementById('add-user-btn'),
    editUserBtn: document.getElementById('edit-user-btn'),
    modal: document.getElementById('user-modal'),
    closeModal: document.querySelector('.close-modal'),
    modalTitle: document.getElementById('modal-title'),
    userForm: document.getElementById('user-form'),
    modalEnv: document.getElementById('modal-env'),
    modalTenantSelect: document.getElementById('modal-tenant-select'),
    modalTenantInput: document.getElementById('modal-tenant-input'),
    modalUsername: document.getElementById('modal-username'),
    modalPassword: document.getElementById('modal-password'),
    userIdInput: document.getElementById('user-id'),
    deleteUserBtn: document.getElementById('modal-delete-user-btn'),
    deleteTenantBtn: document.getElementById('delete-tenant-btn')
};
var aggregateMetrics = {
    expYield: 0, reYield: 0, aiYield: 0,
    expHarvest: 0, reHarvest: 0, aiHarvest: 0
};

// Start: Store raw aggregate values
var aggregateRaw = {
    aiMinYield: 0,
    aiMaxYield: 0,
    aiMinHarvest: 0,
    aiMaxHarvest: 0,
    expYield: 0,
    reYield: 0,
    expHarvest: 0,
    reHarvest: 0
};

// Pagination State
var paginationState = {
    currentPage: 1,
    rowsPerPage: 20,
    filteredData: [],
    searchQuery: '',
    sortBy: '',
    sortOrder: 'asc'
};

// -----------------------------------------

// =============================================
// HELPER: GET SERVER URL
// =============================================
function getServerUrl() {
    const input = document.getElementById('server-url');
    let url = input ? input.value.trim() : 'http://localhost:3000';
    // Remove trailing slash if present
    return url.replace(/\/$/, '');
}

// =============================================
// UNIT CONVERSION SYSTEM
// =============================================
const MASS_CONVERSIONS = {
    tonne: 1,         // Metric Tonne = 1:1
    kgs: 1000,        // 1 Tonne = 1000 Kgs
    ton: 1.10231      // 1 Tonne = 1.10231 US Tons
};

const AREA_CONVERSIONS = {
    ha: 1,            // Hectare = 1:1
    acre: 2.47105     // 1 Ha = 2.47105 Acres
};

const YIELD_UNIT_LABELS = {
    kgs_acre: 'Kgs/Acre',
    kgs_ha: 'Kgs/Ha',
    tonne_acre: 'Tonne/Acre',
    tonne_ha: 'Tonne/Ha',
    ton_acre: 'Ton/Acre',
    ton_ha: 'Ton/Ha'
};

const HARVEST_UNIT_LABELS = {
    kgs: 'Kgs',
    tonne: 'Tonne',
    ton: 'Ton'
};

function getDataYieldUnit() {
    const selector = document.getElementById('data-yield-unit');
    return selector ? selector.value : 'kgs_acre';
}

function getDataAreaUnit() {
    const selector = document.getElementById('data-area-unit');
    return selector ? selector.value : 'acre';
}

function getDataHarvestUnit() {
    const selector = document.getElementById('data-harvest-unit');
    return selector ? selector.value : 'kgs';
}

function convertYield(valueInTonnePerHa, targetUnit) {
    const [massUnit, areaUnit] = targetUnit.split('_');
    const massConverted = valueInTonnePerHa * MASS_CONVERSIONS[massUnit];
    const areaConverted = massConverted / AREA_CONVERSIONS[areaUnit];
    return areaConverted;
}

function convertHarvest(valueInTonnes, targetUnit) {
    return valueInTonnes * MASS_CONVERSIONS[targetUnit];
}

async function fetchUnitConversions() {
    const baseUrl = getServerUrl();
    try {
        const response = await fetch(`${baseUrl}/api/unit-conversions`);
        const data = await response.json();
        if (Array.isArray(data)) {
            unitConversions = data;
            console.log(`[INFO] Loaded ${unitConversions.length} unit conversion factors.`);
        }
    } catch (error) {
        console.error('Error fetching unit conversions:', error);
    }
}

function convertValueToMetricTon(value, unitCode) {
    const val = parseFloat(value);
    if (isNaN(val)) return 0;
    if (!unitCode) return val;
    
    const factorObj = unitConversions.find(u => u.unit_code.toUpperCase() === unitCode.toUpperCase());
    if (factorObj) {
        const factor = parseFloat(factorObj.conversion_factor);
        return val * (isNaN(factor) ? 1 : factor);
    }
    // Fallback logic for common units if factor not found in db.json
    const code = unitCode.toLowerCase();
    if (code === 'kilogram' || code === 'kgs' || code === 'kg') return val * 0.001;
    if (code === 'gram') return val * 0.000001;
    if (code === 'quintal') return val * 0.1;
    if (code === 'metric_ton' || code === 'tonnes' || code === 'mt') return val;
    
    // User Request: If unit not present, default to factor 1
    console.log(`[DEBUG] Unknown unit '${unitCode}', defaulting factor to 1`);
    return val; 
}

function formatDate(dateStr) {
    if (!dateStr) return "-";
    try {
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) return "-";
        const day = String(d.getDate()).padStart(2, '0');
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const year = d.getFullYear();
        return `${day}-${month}-${year}`;
    } catch (e) { return "-"; }
}

function updateUnitLabels(plotData = null) {
    let yieldLabel, harvestLabel, areaLabelLabel;

    if (plotData) {
        // PLOT LEVEL Labels
        const hUnit = (plotData.harvestUnit || 'kgs').toLowerCase();
        const aUnit = (plotData.areaUnit || 'acre').toLowerCase();
        const hLabel = HARVEST_UNIT_LABELS[hUnit] || hUnit;
        const aLabel = aUnit === 'ha' ? 'Ha' : 'Acre';
        
        harvestLabel = hLabel;
        yieldLabel = `${hLabel}/${aLabel}`;
        areaLabelLabel = aUnit === 'ha' ? 'Hectares' : 'Acres';
    } else {
        // AGGREGATE LEVEL Labels (Always Tonnes/Ha as per request)
        yieldLabel = 'Tonne/Ha';
        harvestLabel = 'Tonne';
        areaLabelLabel = 'Hectares';
    }

    const plotYieldLabel = document.getElementById('plot-yield-unit-label');
    const plotHarvestLabel = document.getElementById('plot-harvest-unit-label');
    if (plotYieldLabel) plotYieldLabel.textContent = yieldLabel;
    if (plotHarvestLabel) plotHarvestLabel.textContent = harvestLabel;

    const thAuditedArea = document.getElementById('th-audited-area');
    const thExpYield = document.getElementById('th-exp-yield');
    const thReYield = document.getElementById('th-re-yield');
    const thPredYieldMin = document.getElementById('th-pred-yield-min');
    const thPredYieldMax = document.getElementById('th-pred-yield-max');
    const thExpHarvest = document.getElementById('th-exp-harvest');
    const thReHarvest = document.getElementById('th-re-harvest');
    const thPredHarvestMin = document.getElementById('th-pred-harvest-min');
    const thPredHarvestMax = document.getElementById('th-pred-harvest-max');

    if (thAuditedArea) thAuditedArea.textContent = `Audited Area (${areaLabelLabel})`;
    if (thExpYield) thExpYield.textContent = `Expected Yield (${yieldLabel})`;
    if (thReYield) thReYield.textContent = `Re-estimated Yield (${yieldLabel})`;
    if (thPredYieldMin) thPredYieldMin.textContent = `Predicted Yield Min (${yieldLabel})`;
    if (thPredYieldMax) thPredYieldMax.textContent = `Predicted Yield Max (${yieldLabel})`;
    if (thExpHarvest) thExpHarvest.textContent = `Expected Harvest (${harvestLabel})`;
    if (thReHarvest) thReHarvest.textContent = `Re-estimated Harvest (${harvestLabel})`;
    if (thPredHarvestMin) thPredHarvestMin.textContent = `Predicted Harvest Min (${harvestLabel})`;
    if (thPredHarvestMax) thPredHarvestMax.textContent = `Predicted Harvest Max (${harvestLabel})`;
}

const fmtYield = (val) => {
    if (val === null || val === undefined || val === 'NA' || isNaN(val)) return '-';
    return Number(val).toFixed(2);
};
const fmtHarvest = (val) => {
    if (val === null || val === undefined || val === 'NA' || isNaN(val)) return '-';
    return Math.round(Number(val)).toString();
};
const fmtSmart = (val) => {
    if (val === null || val === undefined || val === 'NA' || isNaN(val)) return '-';
    const s = Number(val).toFixed(2);
    return s.endsWith('.00') ? s.slice(0, -3) : s;
};

// =============================================
// SEARCHABLE DROPDOWN FUNCTIONALITY
// =============================================
function initSearchableDropdown() {
    const searchInput = document.getElementById('plot-search');
    const dropdownList = document.getElementById('plot-dropdown-list');
    const hiddenInput = document.getElementById('plot-select-value');

    if (!searchInput || !dropdownList) return;

    let highlightedIndex = -1;

    searchInput.addEventListener('focus', function () {
        this.select(); // Auto-select text for easy clearing
        renderDropdownOptions(this.value);
        dropdownList.classList.add('show');
    });

    searchInput.addEventListener('click', function () {
        this.select(); // Ensure click also selects all
    });

    searchInput.addEventListener('input', (e) => {
        highlightedIndex = -1;
        renderDropdownOptions(e.target.value);
        dropdownList.classList.add('show');
    });

    searchInput.addEventListener('keydown', (e) => {
        const items = dropdownList.querySelectorAll('.dropdown-item');

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            highlightedIndex = Math.min(highlightedIndex + 1, items.length - 1);
            updateHighlight(items);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            highlightedIndex = Math.max(highlightedIndex - 1, 0);
            updateHighlight(items);
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (highlightedIndex >= 0 && items[highlightedIndex]) {
                selectPlot(items[highlightedIndex].dataset.value);
            }
        } else if (e.key === 'Escape') {
            dropdownList.classList.remove('show');
            searchInput.blur();
        }
    });

    document.addEventListener('click', (e) => {
        if (!e.target.closest('.searchable-dropdown')) {
            dropdownList.classList.remove('show');
        }
    });

    function updateHighlight(items) {
        items.forEach((item, index) => {
            item.classList.toggle('highlighted', index === highlightedIndex);
        });
        if (items[highlightedIndex]) {
            items[highlightedIndex].scrollIntoView({ block: 'nearest' });
        }
    }

    function renderDropdownOptions(query = '') {
        dropdownList.innerHTML = '';
        const lowerQuery = query.toLowerCase();
        const filtered = plotsList.filter(plot =>
            plot.toLowerCase().includes(lowerQuery)
        );

        if (filtered.length === 0) {
            dropdownList.innerHTML = '<div class="dropdown-no-results">No plots found</div>';
            return;
        }

        filtered.forEach(plot => {
            const item = document.createElement('div');
            item.className = 'dropdown-item';
            if (hiddenInput.value === plot) {
                item.classList.add('selected');
            }
            item.dataset.value = plot;
            item.textContent = plot;
            item.addEventListener('click', () => selectPlot(plot));
            dropdownList.appendChild(item);
        });
    }

    function selectPlot(plotName) {
        searchInput.value = plotName;
        hiddenInput.value = plotName;
        dropdownList.classList.remove('show');

        dropdownList.querySelectorAll('.dropdown-item').forEach(item => {
            item.classList.toggle('selected', item.dataset.value === plotName);
        });

        updatePlotData(plotName);
    }
}

function populateSearchableDropdown(plots) {
    // Sort plots alphabetically by name
    plots.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
    plotsList = plots;
    const searchInput = document.getElementById('plot-search');
    const hiddenInput = document.getElementById('plot-select-value');

    if (searchInput) {
        searchInput.value = '';
        searchInput.placeholder = `Search ${plots.length} plots...`;
    }
    if (hiddenInput) {
        hiddenInput.value = '';
    }
}

// =============================================
// FILE UPLOAD HANDLING
// =============================================
function handleFileUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    document.getElementById('file-name').textContent = `File: ${file.name}`;

    const reader = new FileReader();
    reader.onload = function (e) {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });

        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];

        const jsonData = XLSX.utils.sheet_to_json(worksheet);

        if (jsonData.length > 0) {
            document.getElementById('source-selector').classList.add('hidden');
            document.getElementById('unit-config-section').classList.remove('hidden');

            processData(jsonData);
            document.getElementById('dashboard-content').classList.remove('hidden');
            initSearchableDropdown();
            updateUnitLabels();

            const showAllBtn = document.getElementById('show-all-plots-btn');
            if (showAllBtn) showAllBtn.style.display = 'flex';
        } else {
            alert('File appears to be empty or invalid.');
        }
    };
    reader.readAsArrayBuffer(file);
}

function processData(rows) {
    if (!Array.isArray(rows)) {
        console.error("processData: rows is not an array", rows);
        return;
    }
    globalData = rows;
    const plotsWithPred = [];
    const skippedPlots = [];
    const notEnabledPlots = [];

    let expHarvestTonSum = 0, reHarvestTonSum = 0;
    let aiHarvestMinTonSum = 0, aiHarvestMaxTonSum = 0;
    let totalAreaHaSum = 0;

    const includeNoPred = document.getElementById('include-no-prediction-agg')?.checked;
    
    // For calculating AI yield avg/weighted on aggregate
    let aiYieldMinWeightedSum = 0, aiYieldMaxWeightedSum = 0;
    let countWithPrediction = 0;

    const getVal = (row, keys) => {
        for (let k of keys) {
            const foundKey = Object.keys(row).find(rk => rk.toLowerCase().includes(k.toLowerCase()));
            if (foundKey && !isNaN(parseFloat(row[foundKey]))) return parseFloat(row[foundKey]);
        }
        return 0;
    };

    const getTextVal = (row, keys) => {
        for (let k of keys) {
            const foundKey = Object.keys(row).find(rk => rk.toLowerCase().includes(k.toLowerCase()));
            if (foundKey) return row[foundKey];
        }
        return '';
    };

    rows.forEach((row, index) => {
        // Support both structured (Login) and unstructured (Excel) keys
        const caName = row['Plot Name'] || row['CA Name'] || getTextVal(row, ['plot name', 'ca name']);
        const caId = row['caId'] || row['CA_ID'] || row['CA ID'] || getTextVal(row, ['ca id', 'caid', 'plot id', 'plotid']);
        
        row.caId = caId; // Standardize for mapping
        
        if (!caName) return;

        const h1 = row['Expected Harvest'] !== undefined ? row['Expected Harvest'] : getVal(row, ['expected harvest', 'exp_harvest']);
        const h2 = row['Re-estimated Harvest'] !== undefined ? row['Re-estimated Harvest'] : getVal(row, ['re-estimated harvest', 're_harvest']);
        const y1 = row['Expected YIELD'] !== undefined ? row['Expected YIELD'] : getVal(row, ['expected yield', 'exp_yield']);
        const y2 = row['Re-estimated Yield'] !== undefined ? row['Re-estimated Yield'] : getVal(row, ['re-estimated yield', 're_yield']);
        const area = row['Audited Area'] !== undefined ? row['Audited Area'] : (parseFloat(getTextVal(row, ['audited area', 'area'])) || 0);
        
        const h3_min = row['Harvest Min predicted'] !== undefined ? row['Harvest Min predicted'] : getVal(row, ['harvest min predicted', 'min predicted harvest', 'predicted harvest min']);
        const h3_max = row['Harvest Max predicted'] !== undefined ? row['Harvest Max predicted'] : getVal(row, ['harvest max predicted', 'max predicted harvest', 'predicted harvest max']);
        const y3_min = row['Yield Min predicted'] !== undefined ? row['Yield Min predicted'] : getVal(row, ['yield min predicted', 'min predicted yield', 'predicted yield min']);
        const y3_max = row['Yield Max predicted'] !== undefined ? row['Yield Max predicted'] : getVal(row, ['yield max predicted', 'max predicted yield', 'predicted yield max']);

        // Unit info
        const qUnit = (row['plotHarvestUnit'] || getDataHarvestUnit()).toLowerCase();
        const aUnit = (row['plotAreaUnit'] || getDataAreaUnit()).toLowerCase();
        
        // Conversions to Standard (Tonne, Ha) for aggregate
        const massFactor = MASS_CONVERSIONS[qUnit] || MASS_CONVERSIONS.kgs;
        const areaFactor = AREA_CONVERSIONS[aUnit] || AREA_CONVERSIONS.acre;
        
        const areaHa = area / areaFactor;
        const h1Ton = h1 / massFactor;
        const h2Ton = h2 / massFactor;

        const isNA = h3_min === 'NA' || y3_min === 'NA' || row['Harvest Min predicted'] === 'NA';
        const isZero = (h3_min === 0 || h3_min === null) && (h3_max === 0 || h3_max === null) && (y3_min === 0 || y3_min === null) && (y3_max === 0 || y3_max === null);
        const isPredictionAvailable = !isNA && !isZero && row['Harvest Min predicted'] !== undefined;

        if (isPredictionAvailable || includeNoPred) {
            totalAreaHaSum += areaHa;
            expHarvestTonSum += h1Ton;
            reHarvestTonSum += h2Ton;
            
            plotsWithPred.push(caName);
            countWithPrediction++;
        }

        if (!isPredictionAvailable) {
            if (row['Yield Not Enabled']) {
                notEnabledPlots.push(caName);
            } else {
                skippedPlots.push(caName);
            }
        }

        // Predictions are usually in Tonnes/Ha from AI API
        // If data is not present, use 0
        const h3MinTon = (h3_min === 'NA' || h3_min === undefined || h3_min === null) ? 0 : h3_min; 
        const h3MaxTon = (h3_max === 'NA' || h3_max === undefined || h3_max === null) ? 0 : h3_max;
        
        aiHarvestMinTonSum += h3MinTon;
        aiHarvestMaxTonSum += h3MaxTon;
        
        // For weighted yield on aggregate
        const y3MinVal = (y3_min === 'NA' || y3_min === undefined || y3_min === null) ? 0 : y3_min;
        const y3MaxVal = (y3_max === 'NA' || y3_max === undefined || y3_max === null) ? 0 : y3_max;

        if (isPredictionAvailable || includeNoPred) {
            aiYieldMinWeightedSum += y3MinVal * areaHa;
            aiYieldMaxWeightedSum += y3MaxVal * areaHa;
        }

        // Build processed object for PLOT LEVEL (Raw values)
        row._processed = {
            name: caName,
            auditedArea: area,
            areaUnit: aUnit,
            y1, y2,
            y3_min: y3MinVal, 
            y3_max: y3MaxVal,
            h1, h2,
            h3_min: h3MinTon, 
            h3_max: h3MaxTon,
            noPrediction: !isPredictionAvailable,
            notEnabled: row['Yield Not Enabled'] || false,
            harvestUnit: qUnit
        };
    });

    plotsWithPrediction = plotsWithPred;
    plotsWithoutPrediction = skippedPlots;
    plotsNotEnabled = notEnabledPlots;
    populateSearchableDropdown(plotsWithPrediction);

    if (totalAreaHaSum > 0) {
        updateElement('agg-total-area', totalAreaHaSum.toFixed(2) + ' Ha');
        updateElement('agg-plots-count', (plotsWithPrediction.length).toString());

        // Aggregate Harvest (Tonnes)
        updateElement('agg-exp-harvest', fmtSmart(expHarvestTonSum));
        updateElement('agg-re-harvest', fmtSmart(reHarvestTonSum));
        calculateDiff('agg-re-harvest-diff', reHarvestTonSum, expHarvestTonSum);

        updateElement('agg-ai-harvest-min', fmtSmart(aiHarvestMinTonSum));
        updateElement('agg-ai-harvest-max', fmtSmart(aiHarvestMaxTonSum));
        calculateDataTestRangeDiff('agg-ai-harvest-diff-exp', aiHarvestMinTonSum, aiHarvestMaxTonSum, expHarvestTonSum);
        calculateDataTestRangeDiff('agg-ai-harvest-diff-re', aiHarvestMinTonSum, aiHarvestMaxTonSum, reHarvestTonSum);

        // Aggregate Yield (Tonnes/Ha)
        const expYieldAgg = expHarvestTonSum / totalAreaHaSum;
        const reYieldAgg = reHarvestTonSum / totalAreaHaSum;
        const aiMinYieldAgg = aiYieldMinWeightedSum / totalAreaHaSum;
        const aiMaxYieldAgg = aiYieldMaxWeightedSum / totalAreaHaSum;

        updateElement('agg-exp-yield', fmtSmart(expYieldAgg));
        updateElement('agg-re-yield', fmtSmart(reYieldAgg));
        calculateDiff('agg-re-diff', reYieldAgg, expYieldAgg);

        updateElement('agg-ai-yield-min', fmtSmart(aiMinYieldAgg));
        updateElement('agg-ai-yield-max', fmtSmart(aiMaxYieldAgg));
        calculateDataTestRangeDiff('agg-ai-diff-exp', aiMinYieldAgg, aiMaxYieldAgg, expYieldAgg);
        calculateDataTestRangeDiff('agg-ai-diff-re', aiMinYieldAgg, aiMaxYieldAgg, reYieldAgg);

        // Plot Level removed per user request

        aggregateRaw = {
            aiMinYield: aiMinYieldAgg,
            aiMaxYield: aiMaxYieldAgg,
            aiMinHarvest: aiHarvestMinTonSum,
            aiMaxHarvest: aiHarvestMaxTonSum,
            expYield: expYieldAgg,
            reYield: reYieldAgg,
            expHarvest: expHarvestTonSum,
            reHarvest: reHarvestTonSum
        };
    }
}

function updatePlotData(selectedPlot) {
    const row = globalData.find(r => r._processed && r._processed.name === selectedPlot);

    updateElement('plot-audited-area', '');

    if (row && row._processed) {
        const d = row._processed;
        
        // Update labels for this specific plot
        updateUnitLabels(d);

        if (d.auditedArea !== undefined) {
            const areaVal = parseFloat(d.auditedArea);
            const aLabel = d.areaUnit === 'ha' ? 'Ha' : 'Acres';
            updateElement('plot-audited-area', `Audited Area: ${areaVal.toFixed(2)} ${aLabel}`);
        }

        updateElement('plot-exp-yield', fmtSmart(d.y1));
        updateElement('plot-re-yield', fmtSmart(d.y2));
        calculateDiff('plot-re-diff', d.y2, d.y1);

        updateElement('plot-exp-harvest', fmtSmart(d.h1));
        updateElement('plot-re-harvest', fmtSmart(d.h2));
        calculateDiff('plot-re-harvest-diff', d.h2, d.h1);

        if (d.noPrediction) {
            updateElement('plot-app-yield-min', 'NA');
            updateElement('plot-app-yield-max', 'NA');
            updateElement('plot-app-harvest-min', 'NA');
            updateElement('plot-app-harvest-max', 'NA');

            const naHtml = '<span style="color: var(--text-secondary);">NA</span>';
            const diffEls = ['plot-app-yield-diff-exp', 'plot-app-yield-diff-re', 'plot-app-harvest-diff-exp', 'plot-app-harvest-diff-re'];
            diffEls.forEach(id => {
               const el = document.getElementById(id);
               if(el) el.innerHTML = naHtml;
            });
        } else {
            updatePlotPredictedDisplay(d);
        }
    }
}


function updateElement(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
}

function calculateDiff(elementId, current, baseline) {
    const el = document.getElementById(elementId);
    if (!el || baseline === 0) {
        if (el) el.textContent = '-';
        return;
    }

    const diff = ((current - baseline) / baseline) * 100;
    const absDiff = Math.abs(diff).toFixed(2);
    const isPositive = diff >= 0;
    const arrow = diff >= 0 ? '↑' : '↓';

    el.textContent = `${arrow} ${absDiff}%`;
    el.className = isPositive ? 'sub-text value-green' : 'sub-text value-red';
}

function calculateDataTestRangeDiff(elementId, min, max, baseline) {
    const el = document.getElementById(elementId);
    if (!el || baseline === 0) {
        if (el) el.textContent = '-';
        return;
    }

    const getDiffHtml = (val, base) => {
        const d = ((val - base) / base) * 100;
        const cls = d >= 0 ? 'value-green' : 'value-red';
        const a = d >= 0 ? '↑' : '↓';
        return `<span class="${cls}">${a} ${Math.abs(d).toFixed(2)}%</span>`;
    };

    el.innerHTML = `${getDiffHtml(min, baseline)} - ${getDiffHtml(max, baseline)}`;
}

// =============================================
// ALL PLOTS MODAL WITH SEARCH & PAGINATION
// =============================================
function showAllPlotsModal() {
    const modal = document.getElementById('all-plots-modal');

    paginationState.currentPage = 1;
    paginationState.searchQuery = '';
    paginationState.rowsPerPage = parseInt(document.getElementById('rows-per-page').value) || 20;

    const searchInput = document.getElementById('table-search');
    if (searchInput) searchInput.value = '';

    paginationState.filteredData = globalData.filter(row => {
        if (!row._processed) return false;
        if (showPredictionAvailable) {
            return !row._processed.noPrediction;
        } else {
            return row._processed.noPrediction;
        }
    });

    renderPaginatedTable();
    document.body.style.overflow = 'hidden';
    modal.classList.add('active');
}

function closeAllPlotsModal() {
    const modal = document.getElementById('all-plots-modal');
    modal.classList.remove('active');
    document.body.style.overflow = '';
}


function filterTableData(query) {
    paginationState.searchQuery = query.toLowerCase();
    paginationState.currentPage = 1;

    if (!query.trim()) {
        paginationState.filteredData = globalData.filter(row => {
            if (!row._processed) return false;
            if (showPredictionAvailable) {
                return !row._processed.noPrediction;
            } else {
                return row._processed.noPrediction;
            }
        });
    } else {
        paginationState.filteredData = globalData.filter(row => {
            if (!row._processed) return false;
            const d = row._processed;
            if (showPredictionAvailable && d.noPrediction) return false;
            if (!showPredictionAvailable && !d.noPrediction) return false;
            return d.name.toLowerCase().includes(paginationState.searchQuery) ||
                (d.auditedArea && d.auditedArea.toString().includes(paginationState.searchQuery));
        });
    }
    renderPaginatedTable();
}

function handleSortChange(e) {
    paginationState.sortBy = e.target.value;
    renderPaginatedTable();
}

function toggleSortOrder() {
    paginationState.sortOrder = paginationState.sortOrder === 'asc' ? 'desc' : 'asc';
    const btn = document.getElementById('sort-order-btn');
    if (btn) btn.textContent = paginationState.sortOrder === 'asc' ? '↑ Asc' : '↓ Desc';
    renderPaginatedTable();
}

function sortTable(column) {
    console.log('Sorting table by column:', column);
}

function renderPaginatedTable() {
    const tbody = document.getElementById('all-plots-tbody');
    const { currentPage, rowsPerPage, filteredData, sortBy, sortOrder } = paginationState;

    // Sorting logic
    if (sortBy) {
        filteredData.sort((a, b) => {
            const dA = a._processed;
            const dB = b._processed;
            let valA, valB;

            switch (sortBy) {
                // ... (Implement sort logic if needed, keeping simple for copy) ...
                default:
                    valA = dA.name;
                    valB = dB.name;
            }

            if (valA < valB) return sortOrder === 'asc' ? -1 : 1;
            if (valA > valB) return sortOrder === 'asc' ? 1 : -1;
            return 0;
        });
    }

    const startIndex = (currentPage - 1) * rowsPerPage;
    const endIndex = Math.min(startIndex + rowsPerPage, filteredData.length);
    const totalRows = filteredData.length;
    const totalPages = Math.ceil(totalRows / rowsPerPage);

    tbody.innerHTML = '';
    const yieldUnit = getDataYieldUnit();
    const harvestUnit = getDataHarvestUnit();

    for (let i = startIndex; i < endIndex; i++) {
        const row = filteredData[i];
        const d = row._processed;

        // Table for All Plots should use Metric Tonnes and Tonne/HA
        const qUnit = (d.harvestUnit || 'kgs').toLowerCase();
        const aUnit = (d.areaUnit || 'ha').toLowerCase();
        const massFactor = MASS_CONVERSIONS[qUnit] || MASS_CONVERSIONS.kgs;
        const areaFactor = AREA_CONVERSIONS[aUnit] || AREA_CONVERSIONS.ha;

        const h1Ton = d.h1 / massFactor;
        const h2Ton = d.h2 / massFactor;
        const areaHa = d.auditedArea / areaFactor;
        const y1TonHa = areaHa > 0 ? h1Ton / areaHa : 0;
        const y2TonHa = areaHa > 0 ? h2Ton / areaHa : 0;

        // AI Predictions are already in Tonnes and Tonnes/Ha
        const predictedHarvestMin = d.h3_min;
        const predictedHarvestMax = d.h3_max;
        const predictedHarvestAvg = d.noPrediction || d.notEnabled ? null : (predictedHarvestMin + predictedHarvestMax) / 2;
        const predictedYieldMin = d.y3_min;
        const predictedYieldMax = d.y3_max;
        const yieldPredAvg = d.noPrediction || d.notEnabled ? null : (predictedYieldMin + predictedYieldMax) / 2;

        const yieldReDiff = y1TonHa !== 0 ? ((y2TonHa - y1TonHa) / y1TonHa * 100).toFixed(2) : '0.00';
        const yieldReClass = y2TonHa >= y1TonHa ? 'value-green' : 'value-red';
        const yieldReArrow = y2TonHa >= y1TonHa ? '↑' : '↓';

        const harvestReDiff = h1Ton !== 0 ? ((h2Ton - h1Ton) / h1Ton * 100).toFixed(2) : '0.00';
        const harvestReClass = h2Ton >= h1Ton ? 'value-green' : 'value-red';
        const harvestReArrow = h2Ton >= h1Ton ? '↑' : '↓';

        const hasPred = !d.noPrediction && !d.notEnabled && predictedHarvestAvg !== null;
        let harvestPredHtml = '<span style="color:var(--text-secondary)">-</span>';
        if (hasPred) {
            const harvestPredDiff = h2Ton !== 0 ? ((predictedHarvestAvg - h2Ton) / h2Ton * 100).toFixed(2) : '0.00';
            const harvestPredClass = predictedHarvestAvg >= h2Ton ? 'value-green' : 'value-red';
            const harvestPredArrow = predictedHarvestAvg >= h2Ton ? '↑' : '↓';
            harvestPredHtml = `<span class="${harvestPredClass}">${harvestPredArrow} ${Math.abs(harvestPredDiff)}%</span>`;
        }

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>
                <span style="font-weight: 600; color: #818cf8;">${d.name}</span><br>
                <small>${harvestPredHtml}</small>
            </td>
            <td>${areaHa.toFixed(2)}</td>
            <td>${fmtSmart(h1Ton)}</td>
            <td>
                ${fmtSmart(h2Ton)}<br>
                <small><span class="${harvestReClass}">${harvestReArrow} ${Math.abs(harvestReDiff)}%</span></small>
            </td>
            <td>${fmtSmart(predictedHarvestMin)}</td>
            <td>${fmtSmart(predictedHarvestAvg)}</td>
            <td>${fmtSmart(predictedHarvestMax)}</td>
            <td>${fmtSmart(y1TonHa)}</td>
            <td>
                ${fmtSmart(y2TonHa)}<br>
                <small><span class="${yieldReClass}">${yieldReArrow} ${Math.abs(yieldReDiff)}%</span></small>
            </td>
            <td>${fmtSmart(predictedYieldMin)}</td>
            <td>${fmtSmart(yieldPredAvg)}</td>
            <td>${fmtSmart(predictedYieldMax)}</td>
        `;
        tbody.appendChild(tr);
    } // end for loop

    updatePaginationInfo(startIndex + 1, endIndex, totalRows);
    updatePaginationButtons(paginationState.currentPage, totalPages);
}

function updatePaginationInfo(start, end, total) {
    const infoEl = document.getElementById('pagination-info');
    if (infoEl) {
        if (total === 0) {
            infoEl.textContent = 'No results found';
        } else {
            infoEl.textContent = `Showing ${start}-${end} of ${total}`;
        }
    }
}

function updatePaginationButtons(currentPage, totalPages) {
    const prevBtn = document.getElementById('prev-page-btn');
    const nextBtn = document.getElementById('next-page-btn');
    const pageNumbersEl = document.getElementById('page-numbers');

    if (prevBtn) prevBtn.disabled = currentPage <= 1;
    if (nextBtn) nextBtn.disabled = currentPage >= totalPages;

    if (pageNumbersEl) {
        pageNumbersEl.innerHTML = '';
        // ... (Simplified pagination logic for brevity) ...
        const btn = document.createElement('button');
        btn.className = 'page-number active';
        btn.textContent = currentPage;
        pageNumbersEl.appendChild(btn);
    }
}

function nextPage() {
    const totalPages = Math.ceil(paginationState.filteredData.length / paginationState.rowsPerPage);
    if (paginationState.currentPage < totalPages) {
        paginationState.currentPage++;
        renderPaginatedTable();
    }
}

function prevPage() {
    if (paginationState.currentPage > 1) {
        paginationState.currentPage--;
        renderPaginatedTable();
    }
}

function changeRowsPerPage(value) {
    paginationState.rowsPerPage = parseInt(value);
    paginationState.currentPage = 1;
    renderPaginatedTable();
}

// =============================================
// EVENT LISTENERS
// =============================================
// Removed excel-upload listener

document.getElementById('show-all-plots-btn')?.addEventListener('click', showAllPlotsModal);
document.getElementById('table-search')?.addEventListener('input', (e) => filterTableData(e.target.value));
document.getElementById('rows-per-page')?.addEventListener('change', (e) => changeRowsPerPage(e.target.value));
document.getElementById('prev-page-btn')?.addEventListener('click', prevPage);
document.getElementById('next-page-btn')?.addEventListener('click', nextPage);
document.getElementById('sort-by')?.addEventListener('change', handleSortChange);
document.getElementById('sort-order-btn')?.addEventListener('click', () => {
    paginationState.sortOrder = paginationState.sortOrder === 'asc' ? 'desc' : 'asc';
    const btn = document.getElementById('sort-order-btn');
    if (btn) btn.textContent = paginationState.sortOrder === 'asc' ? '↑ Asc' : '↓ Desc';
    renderPaginatedTable();
});


document.getElementById('data-yield-unit')?.addEventListener('change', () => {
    updateUnitLabels();
    if (globalData.length > 0) processData(globalData);
    updatePlotPredictedDisplay();
});

document.getElementById('data-harvest-unit')?.addEventListener('change', () => {
    updateUnitLabels();
    if (globalData.length > 0) processData(globalData);
    updatePlotPredictedDisplay();
});

document.getElementById('data-area-unit')?.addEventListener('change', () => {
    if (globalData.length > 0) processData(globalData);
});

function updatePlotPredictedDisplay(d) {
    if (!d) {
       const selectedPlot = document.getElementById('plot-select-value')?.value;
       if (!selectedPlot) return;
       const row = globalData.find(r => r._processed && r._processed.name === selectedPlot);
       if (!row || !row._processed) return;
       d = row._processed;
    }

    const qUnit = (d.harvestUnit || 'kgs').toLowerCase();
    const aUnit = (d.areaUnit || 'ha').toLowerCase();
    
    // AI Predictions are in Tonnes (mass) and Tonnes/Ha (yield)
    const massFactor = MASS_CONVERSIONS[qUnit] || MASS_CONVERSIONS.kgs;
    const areaFactor = AREA_CONVERSIONS[aUnit] || AREA_CONVERSIONS.ha;

    // Convert AI Yield (Tonnes/Ha) to Plot Yield (qUnit / aUnit)
    // 1 Tonne/Ha = massFactor / areaFactor in Plot Units
    const yieldConversionFactor = massFactor / areaFactor;
    
    const predictedYieldMin = d.y3_min * yieldConversionFactor;
    const predictedYieldMax = d.y3_max * yieldConversionFactor;

    updateElement('plot-app-yield-min', fmtYield(predictedYieldMin));
    updateElement('plot-app-yield-max', fmtYield(predictedYieldMax));

    calculateDataTestRangeDiff('plot-app-diff-exp', predictedYieldMin, predictedYieldMax, d.y1);
    calculateDataTestRangeDiff('plot-app-diff-re', predictedYieldMin, predictedYieldMax, d.y2);

    const avgPredictedYield = (predictedYieldMin + predictedYieldMax) / 2;
    calculateDiff('plot-card-level', avgPredictedYield, d.y2);

    // Convert AI Harvest (Tonnes) to Plot Harvest (qUnit)
    const predictedHarvestMin = d.h3_min * massFactor;
    const predictedHarvestMax = d.h3_max * massFactor;

    updateElement('plot-app-harvest-min', fmtHarvest(predictedHarvestMin));
    updateElement('plot-app-harvest-max', fmtHarvest(predictedHarvestMax));

    calculateDataTestRangeDiff('plot-app-harvest-diff-exp', predictedHarvestMin, predictedHarvestMax, d.h1);
    calculateDataTestRangeDiff('plot-app-harvest-diff-re', predictedHarvestMin, predictedHarvestMax, d.h2);
}

function showSourceTab(tab) {
    const tabUpload = document.getElementById('tab-upload');
    const tabLogin = document.getElementById('tab-login');
    const uploadSection = document.getElementById('upload-section');
    const loginSection = document.getElementById('login-section');

    if (tab === 'upload') {
        tabUpload.style.border = '2px solid var(--primary-color)';
        tabUpload.style.background = 'rgba(99, 102, 241, 0.1)';
        tabUpload.style.color = 'var(--text-primary)';
        tabLogin.style.border = '2px solid var(--border-color)';
        tabLogin.style.background = 'transparent';
        tabLogin.style.color = 'var(--text-secondary)';
        uploadSection.classList.remove('hidden');
        loginSection.classList.add('hidden');
    } else {
        tabLogin.style.border = '2px solid var(--primary-color)';
        tabLogin.style.background = 'rgba(99, 102, 241, 0.1)';
        tabLogin.style.color = 'var(--text-primary)';
        tabUpload.style.border = '2px solid var(--border-color)';
        tabUpload.style.background = 'transparent';
        tabUpload.style.color = 'var(--text-secondary)';
        loginSection.classList.remove('hidden');
        uploadSection.classList.add('hidden');
    }
}

// =============================================
// LOGIN FUNCTIONALITY WITH DYNAMIC URL
// =============================================

// --- Render Logic (from script.js) ---
function renderEnvironments() {
    loginElements.envSelect.innerHTML = '<option value="" disabled selected>Select Environment</option>';
    loginElements.modalEnv.innerHTML = '<option value="" disabled selected>Select Environment</option>';

    Object.keys(loginState.environmentUrls).forEach(env => {
        const option = document.createElement('option');
        option.value = env;
        option.textContent = env;
        loginElements.envSelect.appendChild(option);
        const modalOption = option.cloneNode(true);
        loginElements.modalEnv.appendChild(modalOption);
    });
}

function renderTenants(environment, targetSelect) {
    targetSelect.innerHTML = '<option value="" disabled selected>Select Tenant</option>';
    const usersInEnv = loginState.users.filter(u => u.environment === environment);
    const tenants = [...new Set(usersInEnv.map(u => u.tenant))];

    tenants.forEach(tenant => {
        const option = document.createElement('option');
        option.value = tenant;
        option.textContent = tenant;
        targetSelect.appendChild(option);
    });

    if (targetSelect === loginElements.modalTenantSelect) {
        const addNewOpt = document.createElement('option');
        addNewOpt.value = 'new';
        addNewOpt.textContent = '+ Add New Tenant';
        targetSelect.appendChild(addNewOpt);
    }
}

function renderUsers(environment, tenant) {
    loginElements.userSelect.innerHTML = '<option value="" disabled selected>Select User</option>';
    const relevantUsers = loginState.users.filter(u =>
        u.environment === environment && u.tenant === tenant
    );

    relevantUsers.forEach(user => {
        const option = document.createElement('option');
        option.value = user.id;
        option.textContent = user.username;
        loginElements.userSelect.appendChild(option);
    });

    loginElements.userSelect.disabled = false;
    updateUserActionsVisibility();
}

function updateUserActionsVisibility() {
    const hasUser = loginElements.userSelect.value && loginElements.userSelect.value !== "";
    loginElements.userActions.style.display = hasUser ? 'flex' : 'none';
}

// --- Event Listeners for Login UI ---
loginElements.envSelect?.addEventListener('change', (e) => {
    const env = e.target.value;
    loginElements.tenantSelect.disabled = false;
    loginElements.userSelect.disabled = true;
    loginElements.userSelect.innerHTML = '<option value="" disabled selected>Select User</option>';
    renderTenants(env, loginElements.tenantSelect);
    updateUserActionsVisibility();
});

loginElements.tenantSelect?.addEventListener('change', (e) => {
    const env = loginElements.envSelect.value;
    const tenant = e.target.value;
    renderUsers(env, tenant);
});

loginElements.userSelect?.addEventListener('change', () => {
    updateUserActionsVisibility();
});

// --- Modal & CRUD (from script.js) ---
function openModal(mode, user = null) {
    loginElements.modal.style.display = 'block';
    loginElements.userForm.reset();
    loginElements.modalTenantInput.style.display = 'none';

    if (mode === 'edit' && user) {
        loginElements.modalTitle.textContent = 'Edit User';
        loginElements.deleteUserBtn.style.display = 'block';
        loginElements.userIdInput.value = user.id;
        loginElements.modalEnv.value = user.environment;
        renderTenants(user.environment, loginElements.modalTenantSelect);
        loginElements.modalTenantSelect.value = user.tenant;
        loginElements.deleteTenantBtn.style.display = 'block';
        loginElements.modalUsername.value = user.username;
        loginElements.modalPassword.value = user.password;
    } else {
        loginElements.modalTitle.textContent = 'Add New User';
        loginElements.deleteUserBtn.style.display = 'none';
        loginElements.deleteTenantBtn.style.display = 'none';
    }
}

function closeModal() {
    loginElements.modal.style.display = 'none';
}

loginElements.addUserBtn?.addEventListener('click', () => openModal('add'));
loginElements.editUserBtn?.addEventListener('click', () => {
    const userId = loginElements.userSelect.value;
    if (!userId) return;
    const user = loginState.users.find(u => u.id === userId);
    openModal('edit', user);
});
loginElements.closeModal?.addEventListener('click', closeModal);
loginElements.modalEnv?.addEventListener('change', (e) => {
    renderTenants(e.target.value, loginElements.modalTenantSelect);
});
loginElements.modalTenantSelect?.addEventListener('change', (e) => {
    if (e.target.value === 'new') {
        loginElements.modalTenantInput.style.display = 'block';
        loginElements.modalTenantInput.required = true;
        loginElements.modalTenantInput.focus();
        loginElements.deleteTenantBtn.style.display = 'none';
    } else {
        loginElements.modalTenantInput.style.display = 'none';
        loginElements.modalTenantInput.required = false;
        loginElements.deleteTenantBtn.style.display = 'block';
    }
});

loginElements.userForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = loginElements.userIdInput.value;
    const environment = loginElements.modalEnv.value;
    let tenant = loginElements.modalTenantSelect.value;
    const username = loginElements.modalUsername.value;
    const password = loginElements.modalPassword.value;

    if (tenant === 'new') {
        tenant = loginElements.modalTenantInput.value;
        if (!tenant) return alert('Please enter a tenant name');
    }

    const userData = { environment, tenant, username, password };

    try {
        if (id) await api.updateUser(id, userData);
        else await api.createUser(userData);

        const data = await api.getDb();
        loginState.users = data.users;

        const currentEnv = loginElements.envSelect.value;
        if (currentEnv) {
            renderTenants(currentEnv, loginElements.tenantSelect);
            loginElements.tenantSelect.value = "";
            loginElements.userSelect.innerHTML = '<option value="" disabled selected>Select User</option>';
            loginElements.userSelect.disabled = true;
            updateUserActionsVisibility();
        }
        closeModal();
    } catch (err) {
        console.error('Error saving user:', err);
    }
});

loginElements.deleteUserBtn?.addEventListener('click', async () => {
    const userId = loginElements.userIdInput.value;
    if (!userId) return;
    try {
        await api.deleteUser(userId);
        const data = await api.getDb();
        loginState.users = data.users;
        const currentEnv = loginElements.envSelect.value;
        if (currentEnv) renderTenants(currentEnv, loginElements.tenantSelect);
        loginElements.tenantSelect.value = "";
        loginElements.userSelect.innerHTML = '<option value="" disabled selected>Select User</option>';
        loginElements.userSelect.disabled = true;
        updateUserActionsVisibility();
        closeModal();
    } catch (err) {
        console.error('Error deleting user:', err);
    }
});

loginElements.deleteTenantBtn?.addEventListener('click', async () => {
    const environment = loginElements.modalEnv.value;
    const tenant = loginElements.modalTenantSelect.value;
    if (!environment || !tenant || tenant === 'new') return;
    try {
        await api.deleteTenant(environment, tenant);
        const data = await api.getDb();
        loginState.users = data.users;
        renderTenants(environment, loginElements.modalTenantSelect);
        loginElements.modalTenantSelect.value = "";
        loginElements.deleteTenantBtn.style.display = 'none';
        const currentEnv = loginElements.envSelect.value;
        if (currentEnv === environment) {
            renderTenants(currentEnv, loginElements.tenantSelect);
            loginElements.tenantSelect.value = "";
            loginElements.userSelect.innerHTML = '<option value="" disabled selected>Select User</option>';
            loginElements.userSelect.disabled = true;
            updateUserActionsVisibility();
        }
    } catch (err) {
        console.error('Error deleting tenant:', err);
    }
});

// Initialize login data
async function initLogin() {
    try {
        const data = await api.getDb();
        loginState.environmentUrls = data.environment_urls;
        loginState.users = data.users;
        renderEnvironments();
        loginState.loading = false;
    } catch (err) {
        console.error('Failed to load login data:', err);
    }
}
initLogin();

// Updated handleLogin to use selections
async function handleLogin() {
    console.log('handleLogin triggered');
    const environment = loginElements.envSelect.value;
    const userId = loginElements.userSelect.value;
    const loginError = document.getElementById('login-error');
    const loginBtn = loginElements.loginBtn;

    if (!environment || !userId) {
        loginError.textContent = 'Please select Environment, Tenant, and User';
        loginError.classList.remove('hidden');
        return;
    }

    const user = loginState.users.find(u => u.id === userId);
    const tenant = loginElements.tenantSelect.value;
    const username = user.username;
    const password = user.password;

    // Get server URL
    const baseUrl = getServerUrl();

    loginBtn.disabled = true;
    loginBtn.textContent = 'Logging in...';
    loginError.classList.add('hidden');

    try {
        // Clear previous session data before new login attempt
        clearAllDataUI();

        const response = await fetch(`${baseUrl}/api/user-aggregate/token`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'ngrok-skip-browser-warning': 'true'
            },
            body: JSON.stringify({ environment, tenant, username, password })
        });

        if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            throw new Error(data.error || 'Login failed');
        }

        const data = await response.json();
        console.log('Login API Success data received');
        
        authToken = data.access_token;
        currentEnvironment = environment;
        currentTenant = tenant;

        document.getElementById('login-form-container').classList.add('hidden');
        document.getElementById('project-container').classList.remove('hidden');
        document.getElementById('session-info').textContent = `${environment} | ${tenant} | ${username} | Loading Prefs...`;

        await Promise.all([loadProjects(), fetchUserInfo()]);

    } catch (error) {
        loginError.textContent = error.message;
        loginError.classList.remove('hidden');
    } finally {
        loginBtn.disabled = false;
        loginBtn.textContent = 'Login to Application';
    }
}

async function fetchUserInfo() {
    const baseUrl = getServerUrl();
    try {
        const response = await fetch(`${baseUrl}/api/user-aggregate/user-info?environment=${encodeURIComponent(currentEnvironment)}`, {
            headers: {
                'Authorization': `Bearer ${authToken}`,
                'ngrok-skip-browser-warning': 'true'
            }
        });
        const result = await response.json();

        if (result.success && result.data) {
            userPrefs = result.data.preferences || {};
            const companyId = result.data.companyId;

            console.log('User Info Fetched:', result.data);

            if (companyId) {
                await fetchCompanyInfo(companyId);
            }
            updateElement('session-info', `${currentEnvironment} | ${currentTenant} | User: ${userPrefs.areaUnits || 'NA'} | Co: ${companyPrefs.areaUnits || 'NA'}`);
        } else {
            console.warn('User Info API returned success=false');
            updateElement('session-info', `${currentEnvironment} | ${currentTenant} | User Fetch Failed`);
        }
    } catch (e) {
        console.warn('Failed to fetch user info', e);
        updateElement('session-info', `${currentEnvironment} | ${currentTenant} | User Fetch Error`);
    }
}

async function fetchCompanyInfo(companyId) {
    const baseUrl = getServerUrl();
    try {
        const response = await fetch(`${baseUrl}/api/user-aggregate/company-info?environment=${encodeURIComponent(currentEnvironment)}&companyId=${encodeURIComponent(companyId)}`, {
            headers: {
                'Authorization': `Bearer ${authToken}`,
                'ngrok-skip-browser-warning': 'true'
            }
        });
        const result = await response.json();

        if (result.success && result.data) {
            // Path: data > preferences > "areaUnits"
            if (result.data.preferences) {
                companyPrefs = result.data.preferences;
            } else if (result.data.data && result.data.data.preferences) {
                companyPrefs = result.data.data.preferences;
            }
            console.log('Company Info Fetched:', companyPrefs);
            // Update display again to show company status
            updateElement('session-info', `${currentEnvironment} | ${currentTenant} | User: ${userPrefs.areaUnits || 'NA'} | Co: ${companyPrefs.areaUnits || 'NA'}`);
        }
    } catch (e) {
        console.warn('Failed to fetch company info', e);
    }
}

function handleLogout() {
    clearAllDataUI();
    document.getElementById('login-form-container').classList.remove('hidden');
    document.getElementById('session-info').textContent = '-';
}

function clearAllDataUI() {
    console.log('[INFO] Clearing all UI data and resetting state.');
    
    // 1. Reset Global State
    globalData = [];
    plotsList = [];
    plotsWithPrediction = [];
    plotsWithoutPrediction = [];
    plotsNotEnabled = [];
    plotsData = [];
    userPrefs = {};
    companyPrefs = {};
    selectedProjectIds = [];
    lastProcessedPlots = [];
    lastHarvestTasks = [];
    activeHarvestWindowFilter = null;
    window.currentGrowthResults = null;
    authToken = null;
    currentEnvironment = null;
    currentTenant = null;

    // 2. Clear Tables
    ['all-plots-tbody', 'harvest-window-plots-tbody', 'harvest-status-tbody', 'harvest-window-summary-tbody'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = '';
    });
    const aggToggle = document.getElementById('include-no-prediction-agg');
    if (aggToggle) aggToggle.checked = false;
    
    const growthTableContainer = document.getElementById('growth-table-container');
    if (growthTableContainer) growthTableContainer.innerHTML = '';

    // 3. Reset Multi-select & Dropdowns
    const triggerText = document.getElementById('trigger-text');
    if (triggerText) triggerText.textContent = "Select Projects (Max 5)";
    
    const projectListContainer = document.getElementById('projects-dropdown-list');
    if (projectListContainer) projectListContainer.innerHTML = '';
    
    const plotSearch = document.getElementById('plot-search');
    if (plotSearch) plotSearch.value = '';
    
    const plotSelectValue = document.getElementById('plot-select-value');
    if (plotSelectValue) plotSelectValue.value = '';

    const projectSelect = document.getElementById('project-select');
    if (projectSelect) projectSelect.innerHTML = '<option value="" disabled selected>Select a project</option>';

    // 4. Hide Sections
    const sectionsToHide = [
        'dashboard-content', 'yield-harvest-section', 'growth-data-section', 
        'growth-info', 'growth-cards-container', 'harvest-status-section', 
        'harvest-status-results', 'harvest-window-plots-container', 
        'growth-progression-plots-container', 'plot-info', 'unit-config-section',
        'base-growth-table-wrapper', 'project-container'
    ];
    sectionsToHide.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.add('hidden');
    });

    const emptyStatesToShow = ['growth-empty-state', 'source-selector'];
    emptyStatesToShow.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.remove('hidden');
    });

    // 5. Reset Metrics & Diff Displays
    clearPlotDisplay();
    
    const simpleMetricIds = [
        'plot-count', 'agg-total-area', 'agg-plots-count', 'agg-exp-harvest', 'agg-re-harvest', 
        'agg-ai-harvest-min', 'agg-ai-harvest-max', 'agg-exp-yield', 'agg-re-yield', 
        'agg-ai-yield-min', 'agg-ai-yield-max', 'growth-prog-total', 'growth-prog-harvested', 
        'harvest-plots-covered', 'harvest-window-range', 'stat-harvest-plots-covered', 'stat-harvest-collected',
        'growth-status', 'progress-text'
    ];
    simpleMetricIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.textContent = '-';
    });

    const diffIds = [
        'agg-re-harvest-diff', 'agg-ai-harvest-diff-exp', 'agg-ai-harvest-diff-re', 
        'agg-re-diff', 'agg-ai-diff-exp', 'agg-ai-diff-re', 'agg-card-level'
    ];
    diffIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = '';
    });

    // 6. Destroy Charts
    if (growthProgressionChartInstance) {
        growthProgressionChartInstance.destroy();
        growthProgressionChartInstance = null;
    }
    if (growthStageChartInstance) {
        growthStageChartInstance.destroy();
        growthStageChartInstance = null;
    }
    if (harvestWindowChartInstance) {
        harvestWindowChartInstance.destroy();
        harvestWindowChartInstance = null;
    }
    if (harvestWindowPieChart) {
        harvestWindowPieChart.destroy();
        harvestWindowPieChart = null;
    }
}

async function loadProjects() {
    const baseUrl = getServerUrl();
    try {
        const response = await fetch(`${baseUrl}/api/user-aggregate/projects?environment=${encodeURIComponent(currentEnvironment)}&tenant=${encodeURIComponent(currentTenant)}`, {
            headers: {
                'Authorization': `Bearer ${authToken}`,
                'ngrok-skip-browser-warning': 'true'
            }
        });

        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Failed to load projects');

        projectsList = data.projects || [];
        renderProjectsList();

    } catch (error) {
        console.error('Error loading projects:', error);
    }
}

// document.getElementById('project-select')?.addEventListener('change', async function () {
/*
const projectId = this.value;
if (!projectId) return;

const plotInfo = document.getElementById('plot-info');
const plotCount = document.getElementById('plot-count');
const plotLoading = document.getElementById('plot-loading');
const generateBtn = document.getElementById('generate-btn');
const baseUrl = getServerUrl();

plotInfo.classList.remove('hidden');
plotLoading.classList.remove('hidden');
plotCount.textContent = '-';
generateBtn.disabled = true;
generateBtn.style.opacity = '0.5';

try {
    const response = await fetch(`${baseUrl}/api/user-aggregate/plots?environment=${encodeURIComponent(currentEnvironment)}&projectId=${encodeURIComponent(projectId)}`, {
        headers: {
            'Authorization': `Bearer ${authToken}`,
            'ngrok-skip-browser-warning': 'true'
        }
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Failed to load plots');

    plotsData = data.plots || [];
    plotCount.textContent = plotsData.length;

    if (plotsData.length > 0) {
        generateBtn.disabled = false;
        generateBtn.style.opacity = '1';
    }

} catch (error) {
    console.error('Error loading plots:', error);
    plotCount.textContent = 'Error';
} finally {
    plotLoading.classList.add('hidden');
}
*/
// });

async function generateDataFromAPI() {
    const progressSpan = document.getElementById('generate-progress');
    const progressText = document.getElementById('progress-text');
    const baseUrl = getServerUrl();

    progressSpan && progressSpan.classList.remove('hidden');

    const generatedData = [];
    const total = plotsData.length;
    const BATCH_SIZE = 5;

    async function fetchPlotData(plot) {
        try {
            // Fetch CA Details first (Critical)
            const caReq = fetch(`${baseUrl}/api/user-aggregate/ca-details?environment=${encodeURIComponent(currentEnvironment)}&caId=${encodeURIComponent(plot.caId)}`, {
                headers: { 'Authorization': `Bearer ${authToken}` }
            });

            // Fetch Yield Prediction (Optional - might fail if not enabled)
            const yieldReq = fetch(`${baseUrl}/api/user-aggregate/yield-prediction?environment=${encodeURIComponent(currentEnvironment)}&caIds=${encodeURIComponent(plot.caId)}`, {
                headers: { 'Authorization': `Bearer ${authToken}` }
            });

            const [caResponse, yieldResponse] = await Promise.all([caReq, yieldReq]);
            const caData = await caResponse.json();

            let yieldData = {};
            if (!yieldResponse.ok) {
                // Handle specific "Not Enabled" cases gracefully
                try {
                    const errBody = await yieldResponse.json();
                    const errMsg = JSON.stringify(errBody);
                    // Check for specific error signatures: srPlotIdnull or 'not generated yet'
                    if (errMsg.includes('error.srPlotIdnull') || errMsg.includes('Yield data is not generated yet')) {
                        console.warn(`[INFO] Plot ${plot.caId} has no yield data (expected). Response: ${errMsg}`);
                        yieldData = { notEnabled: true }; // Mark as explicitly not enabled
                    } else {
                        console.warn(`[WARN] Yield API Failed for CA ${plot.caId} | Status: ${yieldResponse.status}`, errBody);
                        yieldData = {}; // Just missing/failed
                    }
                } catch (e) {
                    console.warn(`[WARN] Yield API Failed for CA ${plot.caId} | Status: ${yieldResponse.status}`);
                    yieldData = {};
                }
            } else {
                yieldData = await yieldResponse.json();
            }

            const reEstYield = caData.auditedArea > 0 ? (caData.reestimatedValue || 0) / caData.auditedArea : 0;

            let companyAreaUnit = (companyPrefs.areaUnits || 'ha').toLowerCase().includes('acre') ? 'acre' : 'ha';
            let userAreaUnit = (userPrefs.areaUnits || companyAreaUnit).toLowerCase().includes('acre') ? 'acre' : 'ha';
            let rawUnit = (caData.quantityUnit || 'kgs').toLowerCase();

            return {
                'Plot Name': plot.name || 'Unknown',
                'caId': plot.caId,
                'Audited Area': caData.auditedArea || 0,
                'Expected Harvest': caData.expectedHarvest || 0,
                'Re-estimated Harvest': caData.reEstimatedHarvest || 0,
                'Expected YIELD': caData.expectedYield || 0,
                'Re-estimated Yield': reEstYield,
                'Harvest Min predicted': yieldData.productionMin,
                'Harvest Max predicted': yieldData.productionMax,
                'Harvest Average predicted': yieldData.productionAvg,
                'Yield Min predicted': yieldData.yieldMin,
                'Yield Max predicted': yieldData.yieldMax,
                'Yield Average predicted': yieldData.yieldAvg,
                'Yield Not Enabled': yieldData.notEnabled || false,
                'plotHarvestUnit': rawUnit,
                'plotAreaUnit': userAreaUnit // Data from API is assumed to be in user/company pref
            };
        } catch (error) {
            console.error(`Error fetching data for CA ${plot.caId}:`, error);
            return null;
        }
    }

    let completed = 0;
    for (let i = 0; i < plotsData.length; i += BATCH_SIZE) {
        const batch = plotsData.slice(i, Math.min(i + BATCH_SIZE, plotsData.length));
        const batchResults = await Promise.allSettled(
            batch.map(plot => fetchPlotData(plot))
        );

        batchResults.forEach(result => {
            if (result.status === 'fulfilled' && result.value) {
                generatedData.push(result.value);
            }
        });

        completed += batch.length;
        progressText.textContent = `${completed}/${total}`;
    }

    progressSpan && progressSpan.classList.add('hidden');

    let companyAreaUnit = 'ha';
    if (authToken && companyPrefs) {
        const cArea = (companyPrefs.areaUnits || '').toLowerCase();
        if (cArea.includes('acre')) companyAreaUnit = 'acre';
    }

    let userAreaUnit = 'ha';
    if (authToken && userPrefs && userPrefs.areaUnits) {
        const uArea = (userPrefs.areaUnits || '').toLowerCase();
        if (uArea.includes('acre')) userAreaUnit = 'acre';
    } else {
        // Fallback: If User Prefs missing/empty, assume User wants what Company has
        // This fixes the issue where User API suceeds but has no pref, defaulting to Ha incorrectly
        userAreaUnit = companyAreaUnit;
    }

    console.log(`Unit Logic: Company=${companyAreaUnit}, User=${userAreaUnit}`);

    setUnit('data-area-unit', userAreaUnit);

    const HA_TO_ACRE = 2.47105;

    generatedData.forEach(d => {
        // Convert Company Unit (Source) -> User Unit (Target)
        let sourceVal = d['Audited Area'] || 0;

        if (companyAreaUnit === 'ha' && userAreaUnit === 'acre') {
            d['Audited Area'] = sourceVal * HA_TO_ACRE;
        } else if (companyAreaUnit === 'acre' && userAreaUnit === 'ha') {
            d['Audited Area'] = sourceVal / HA_TO_ACRE;
        }
        // If units match, no conversion needed

        if (d['Audited Area'] > 0) {
            d['Expected YIELD'] = (d['Expected Harvest'] || 0) / d['Audited Area'];
            d['Re-estimated Yield'] = (d['Re-estimated Harvest'] || 0) / d['Audited Area'];
        }
    });

    document.getElementById('unit-config-section').classList.remove('hidden');
    const areaSelect = document.getElementById('data-area-unit');
    if (areaSelect && areaSelect.parentElement) {
        areaSelect.parentElement.style.display = 'none';
    }

    document.getElementById('dashboard-content').classList.remove('hidden');

    processData(generatedData);
    initSearchableDropdown();
    updateUnitLabels();

    const showAllBtn = document.getElementById('show-all-plots-btn');
    if (showAllBtn) showAllBtn.style.display = 'flex';
}

function setUnit(id, val) {
    const el = document.getElementById(id);
    if (el) el.value = val;
}



function toggleMultiSelect(e) {
    if (e) {
        e.stopPropagation();
    }
    const list = document.getElementById('projects-dropdown-list');
    if (list) {
        list.classList.toggle('hidden');
    }
}

// Close dropdown when clicking outside
document.addEventListener('click', function (e) {
    const list = document.getElementById('projects-dropdown-list');
    if (list && !list.contains(e.target)) {
        list.classList.add('hidden');
    }
});

function renderProjectsList() {
    const listContainer = document.getElementById('projects-dropdown-list');
    if (!listContainer) return;

    listContainer.innerHTML = '';
    const list = [...projectsList];
    if (projectsSortedByName) {
        list.sort((a, b) => a.name.localeCompare(b.name));
    }

    list.forEach(p => {
        const item = document.createElement('div');
        item.style.padding = '0.75rem';
        item.style.borderBottom = '1px solid var(--border-color)';
        item.style.cursor = 'pointer';
        item.style.display = 'flex';
        item.style.alignItems = 'center';
        item.style.gap = '0.5rem';
        item.style.transition = 'background 0.2s';

        // Check if selected
        const isSelected = selectedProjectIds.includes(p.id);
        if (isSelected) item.style.background = 'rgba(99, 102, 241, 0.1)';

        // Inner HTML for Checkbox and Label
        item.innerHTML = `
            <input type="checkbox" ${isSelected ? 'checked' : ''} style="cursor: pointer;">
            <span style="color: var(--text-primary); font-size: 0.9rem;">${p.name}</span>
        `;

        // Row Click Event
        item.addEventListener('click', (e) => {
            e.stopPropagation(); // Prevent closing dropdown
            // Prevent toggling if clicking directly on checkbox (it handles itself)
            if (e.target.tagName !== 'INPUT') {
                const cb = item.querySelector('input');
                cb.checked = !cb.checked;
                handleProjectSelection(p.id, cb.checked);
            }
        });

        // Checkbox Change Event
        const checkbox = item.querySelector('input');
        checkbox.addEventListener('click', (e) => e.stopPropagation()); // Prevent bubbling
        checkbox.addEventListener('change', (e) => {
            handleProjectSelection(p.id, e.target.checked);
        });

        listContainer.appendChild(item);
    });

    const sortIcon = document.getElementById('projects-sort-icon');
    if (sortIcon) {
        sortIcon.textContent = projectsSortedByName ? '🔤' : '📋';
        sortIcon.title = projectsSortedByName ? 'Sorted A-Z (click for API order)' : 'API order (click to sort A-Z)';
    }
}

function handleProjectSelection(id, isSelected) {
    if (isSelected) {
        if (selectedProjectIds.length >= 5) {
            alert("You can select up to 5 projects.");
            renderProjectsList(); // Re-render to uncheck the exceeded one
            return;
        }
        if (!selectedProjectIds.includes(id)) selectedProjectIds.push(id);
    } else {
        selectedProjectIds = selectedProjectIds.filter(pid => pid !== id);
    }

    // Update UI
    const triggerText = document.getElementById('trigger-text');
    if (triggerText) {
        if (selectedProjectIds.length === 0) {
            triggerText.textContent = "Select Projects (Max 5)";
        } else {
            triggerText.textContent = `${selectedProjectIds.length} Project(s) Selected`;
        }
    }

    // Enable/Disable Load Buttons
    const loadBtn = document.getElementById('load-data-btn');
    const growthLoadBtn = document.getElementById('load-growth-data-btn');
    const yieldHarvestSection = document.getElementById('yield-harvest-section');
    const growthSection = document.getElementById('growth-data-section');

    const hasSelection = selectedProjectIds.length > 0;
    
    [loadBtn, growthLoadBtn].forEach(btn => {
        if (btn) {
            btn.disabled = !hasSelection;
            btn.style.opacity = hasSelection ? '1' : '0.5';
            btn.style.cursor = hasSelection ? 'pointer' : 'not-allowed';
        }
    });

    [yieldHarvestSection, growthSection].forEach(sec => {
        if (sec) {
            if (hasSelection) sec.classList.remove('hidden');
            else sec.classList.add('hidden');
        }
    });

    renderProjectsList(); // Re-render to update highlights/checkboxes
}


async function handleLoadPlots() {
    if (selectedProjectIds.length === 0) return;

    // STEP BY STEP: Handle MULTIPLE projects
    const projectId = selectedProjectIds.join(',');

    const plotInfo = document.getElementById('plot-info');
    const plotCount = document.getElementById('plot-count');
    const plotLoading = document.getElementById('plot-loading');
    const baseUrl = getServerUrl();

    // Show loading UI
    plotInfo.classList.remove('hidden');
    plotLoading.classList.remove('hidden');
    plotCount.textContent = '-';

    try {
        console.log(`[DEBUG] Loading plots for Project ID: ${projectId}`);
        const response = await fetch(`${baseUrl}/api/user-aggregate/plots?environment=${encodeURIComponent(currentEnvironment)}&projectId=${encodeURIComponent(projectId)}`, {
            headers: {
                'Authorization': `Bearer ${authToken}`,
                'ngrok-skip-browser-warning': 'true'
            }
        });

        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Failed to load plots');

        plotsData = data.plots || [];
        plotCount.textContent = plotsData.length;
        console.log(`[DEBUG] Loaded ${plotsData.length} plots`);

        if (plotsData.length > 0) {
            // Auto-generate data after loading plots (as per previous flow logic)
            await generateDataFromAPI();
        }

    } catch (error) {
        console.error('Error loading plots:', error);
        plotCount.textContent = 'Error';
        alert(`Failed to load plots: ${error.message}`);
    } finally {
        plotLoading.classList.add('hidden');
    }
}

async function handleLoadGrowthData() {
    if (selectedProjectIds.length === 0) {
        alert("Please select at least one project first.");
        return;
    }
    if (plotsData.length === 0) {
        alert("Please load Yield & Harvest data first to identify the plots.");
        return;
    }

    const loadBtn = document.getElementById('load-growth-data-btn');
    const growthInfo = document.getElementById('growth-info');
    const growthStatus = document.getElementById('growth-status');
    const growthCardsContainer = document.getElementById('growth-cards-container');
    const growthEmptyState = document.getElementById('growth-empty-state');
    const baseUrl = getServerUrl();

    // Loading State
    loadBtn.disabled = true;
    loadBtn.innerHTML = '⌛ Loading Growth Data...';
    loadBtn.style.opacity = '0.7';
    
    growthInfo.classList.remove('hidden');
    growthStatus.textContent = "Analyzing " + plotsData.length + " plots...";
    growthStatus.style.color = "var(--primary-color)";

    const growthResults = [];
    const BATCH_SIZE = 5;

    // Robust extraction helpers (same as in processData)
    const getVal = (row, keys) => {
        for (let k of keys) {
            const foundKey = Object.keys(row).find(rk => rk.toLowerCase().includes(k.toLowerCase()));
            if (foundKey && !isNaN(parseFloat(row[foundKey]))) return parseFloat(row[foundKey]);
        }
        return 0;
    };
    const getTextVal = (row, keys) => {
        for (let k of keys) {
            const foundKey = Object.keys(row).find(rk => rk.toLowerCase().includes(k.toLowerCase()));
            if (foundKey) return row[foundKey];
        }
        return '';
    };


    async function processPlotGrowth(plot) {
        try {
            // 1. Sustainability API
            const sResp = await fetch(`${baseUrl}/api/user-aggregate/sustainability?environment=${encodeURIComponent(currentEnvironment)}&caIds=${encodeURIComponent(plot.caId)}`, {
                headers: { 'Authorization': `Bearer ${authToken}` }
            });

            if (sResp.status === 204) {
                console.log(`[INFO] Sustainability data not enabled for Plot ${plot.caId}`);
                return null; // Skip
            }

            const sData = await sResp.json();
            
            // The backend was modified to return a flat object: { caId, harvested, harvestDate }
            // or { caId, _rawEmpty: true } if there was no data.
            if (!sData || sData._rawEmpty) {
                return null;
            }

            // Robust isHarvested check: true if flag is true OR if a date exists
            const rawHarvestDate = sData.harvestDate || null;
            const isHarvested = (sData.harvested || !!rawHarvestDate);
            const harvestDate = rawHarvestDate;

            // 3. Growth Stage API
            const gResp = await fetch(`${baseUrl}/api/user-aggregate/growth-stage?environment=${encodeURIComponent(currentEnvironment)}&caIds=${encodeURIComponent(plot.caId)}`, {
                headers: { 'Authorization': `Bearer ${authToken}` }
            });

            let growth = await gResp.json();

            // Find yield-related data in globalData using robust string-based ID mapping
            let yieldInfo = globalData.find(d => {
                const dId = String(d.caId || d['CA ID'] || d['CA_ID'] || '').trim().replace(/^0+/, '');
                const pId = String(plot.caId || '').trim().replace(/^0+/, '');
                return dId !== '' && dId === pId;
            });

            // Fallback: If ID mapping fails, try name mapping as a safety (but prioritize ID as requested)
            if (!yieldInfo) {
                yieldInfo = globalData.find(d => {
                    const dName = String(d['Plot Name'] || d['CA Name'] || d.name || '').trim().toLowerCase();
                    const pName = String(plot.name || '').trim().toLowerCase();
                    return dName !== '' && dName === pName;
                });
            }

            const rawExpHarvest = yieldInfo ? (yieldInfo['Expected Harvest'] !== undefined ? yieldInfo['Expected Harvest'] : getVal(yieldInfo, ['expected harvest', 'exp_harvest'])) : 0;
            const auditedArea = yieldInfo ? (yieldInfo['Audited Area'] !== undefined ? yieldInfo['Audited Area'] : (parseFloat(getTextVal(yieldInfo, ['audited area', 'area'])) || 0)) : 0;
            const harvestUnit = yieldInfo ? (yieldInfo['plotHarvestUnit'] || getTextVal(yieldInfo, ['plotharvestunit', 'unit']) || '').toLowerCase() : '';

            // Unit Logic: Use dynamic conversion for Expected Harvest (assumed in plot units)
            const expectedHarvestTon = convertValueToMetricTon(rawExpHarvest, harvestUnit);
            
            let predictedHarvestTon = 0;
            if (yieldInfo) {
                if (yieldInfo._processed && yieldInfo._processed.h3_min !== null) {
                    // AI Predictions in _processed are ALREADY normalized to Tonnes
                    predictedHarvestTon = (yieldInfo._processed.h3_min + yieldInfo._processed.h3_max) / 2;
                } else {
                    // Fallback to raw keys if _processed is missing
                    const rawPredMin = yieldInfo['Harvest Min predicted'] !== undefined ? yieldInfo['Harvest Min predicted'] : getVal(yieldInfo, ['harvest min predicted', 'min predicted harvest', 'predicted harvest min']);
                    const rawPredMax = yieldInfo['Harvest Max predicted'] !== undefined ? yieldInfo['Harvest Max predicted'] : getVal(yieldInfo, ['harvest max predicted', 'max predicted harvest', 'predicted harvest max']);
                    
                    // If these come from AI API, they are in Tonnes. If from Excel, they are in harvestUnit.
                    // We check if values look like Tonnes or if they were likely converted.
                    // To be safe, use the same logic as in processData: assume Tonnes for AI results.
                    predictedHarvestTon = (rawPredMin + rawPredMax) / 2; 
                }
            }

            // Date validation for Harvest Start/End Dates
            let rawHStart = null;
            if (growth && growth.harvestWindowStartDate) {
                const d = new Date(growth.harvestWindowStartDate);
                if (!isNaN(d.getTime())) rawHStart = d;
            }
            let rawHEnd = null;
            if (growth && growth.harvestWindowEndDate) {
                const d = new Date(growth.harvestWindowEndDate);
                if (!isNaN(d.getTime())) rawHEnd = d;
            }

            return {
                plotName: plot.name,
                caId: plot.caId,
                auditedArea: auditedArea,
                expectedHarvestTon: expectedHarvestTon,
                predictedHarvestTon: predictedHarvestTon,
                isHarvested: isHarvested ? "Yes" : "No",
                isConsideredInChart: (!isHarvested && rawHEnd && rawHEnd >= new Date().setHours(0,0,0,0)) ? "Yes" : "No",
                harvestedDate: formatDate(harvestDate),
                currentStage: (growth && growth.cropStageName) ? growth.cropStageName : "-",
                progression: (growth && growth.seasonProgression) ? (parseFloat(growth.seasonProgression) || 0).toFixed(2) : "-",
                hStart: (growth && growth.harvestWindowStartDate) ? formatDate(growth.harvestWindowStartDate) : "-",
                hEnd: (growth && growth.harvestWindowEndDate) ? formatDate(growth.harvestWindowEndDate) : "-",
                rawHStart: rawHStart,
                rawHEnd: rawHEnd
            };

        } catch (error) {
            console.error(`Error processing growth for ${plot.caId}:`, error);
            return null;
        }
    }

    try {
        for (let i = 0; i < plotsData.length; i += BATCH_SIZE) {
            const batch = plotsData.slice(i, i + BATCH_SIZE);
            const results = await Promise.all(batch.map(p => processPlotGrowth(p)));
            results.forEach(res => { if (res) growthResults.push(res); });
            growthStatus.textContent = `Processing plots: ${Math.min(i + BATCH_SIZE, plotsData.length)}/${plotsData.length}`;
        }

        window.currentGrowthResults = growthResults;
        
        // Reset toggles to unchecked on load
        const chartToggle = document.getElementById('hide-harvested-chart');
        if (chartToggle) chartToggle.checked = false;
        const tableToggle = document.getElementById('hide-harvested-table');
        if (tableToggle) tableToggle.checked = false;

        // Hide all drill-down containers on new data load, but show harvest status section header
        const containers = ['growth-progression-plots-container', 'harvest-window-plots-container'];
        containers.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.classList.add('hidden');
        });
        
        const harvestStatusSection = document.getElementById('harvest-status-section');
        const harvestStatusResults = document.getElementById('harvest-status-results');
        if (harvestStatusSection) harvestStatusSection.classList.remove('hidden');
        if (harvestStatusResults) harvestStatusResults.classList.add('hidden');

        const tableControls = document.getElementById('growth-table-controls-container');
        if (tableControls) tableControls.classList.remove('hidden');

        renderGrowthTable(growthResults);
        renderGrowthProgressionChart(growthResults);
        renderGrowthStageChart(growthResults);
        renderHarvestWindowChart(growthResults);
        renderHarvestWindowDailyChart(growthResults);


        growthCardsContainer.classList.remove('hidden');
        if (growthEmptyState) growthEmptyState.classList.add('hidden');
        growthStatus.textContent = `Analysis Complete. ${growthResults.length} plots with growth data. Now you can Load Collected Harvest if Plantype ID is provided.`;
        growthStatus.style.color = "var(--primary-color)";

    } catch (error) {
        console.error('Growth Data logic failure:', error);
        growthStatus.textContent = "Error: " + error.message;
        growthStatus.style.color = "#ef4444";
    } finally {
        loadBtn.disabled = false;
        loadBtn.innerHTML = '🌱 Load Growth Data';
        loadBtn.style.opacity = '1';
        
        const exportBtn = document.getElementById('export-pdf-btn');
        if (exportBtn) {
            exportBtn.disabled = false;
            exportBtn.style.opacity = '1';
            exportBtn.style.cursor = 'pointer';
        }
    }
}

function renderGrowthTable(results) {
    const container = document.getElementById('growth-table-container');
    if (!container) return;

    const getSortIcon = (col) => {
        if (growthTableSortCol !== col) return '<i class="fas fa-sort" style="margin-left: 0.5rem; opacity: 0.3;"></i>';
        return growthTableSortOrder === 'asc' 
            ? '<i class="fas fa-sort-up" style="margin-left: 0.5rem; color: var(--primary-color);"></i>' 
            : '<i class="fas fa-sort-down" style="margin-left: 0.5rem; color: var(--primary-color);"></i>';
    };

    const headerStyle = "padding: 1rem; border-bottom: 2px solid var(--secondary-color); cursor: pointer; user-select: none; transition: background 0.2s;";
    const hoverEffect = "onmouseover=\"this.style.background='rgba(16, 185, 129, 0.05)'\" onmouseout=\"this.style.background='transparent'\"";

    let html = `
        <div class="metrics-grid" style="grid-template-columns: 1fr; margin-top: 1rem;">
            <div class="metric-card" style="padding: 0; overflow-x: auto;">
                <table style="width: 100%; border-collapse: collapse; font-size: 0.9rem;">
                    <thead>
                        <tr style="background: rgba(16, 185, 129, 0.1); text-align: left;">
                            <th style="${headerStyle}" ${hoverEffect} onclick="handleGrowthTableSort('plotName')">Plot Name ${getSortIcon('plotName')}</th>
                            <th style="${headerStyle}" ${hoverEffect} onclick="handleGrowthTableSort('auditedArea')">Audited Area ${getSortIcon('auditedArea')}</th>
                            <th style="${headerStyle}" ${hoverEffect} onclick="handleGrowthTableSort('expectedHarvestTon')">Expected Harvest ${getSortIcon('expectedHarvestTon')}</th>
                            <th style="${headerStyle}" ${hoverEffect} onclick="handleGrowthTableSort('isHarvested')">Is Harvested ${getSortIcon('isHarvested')}</th>
                            <th style="${headerStyle}" ${hoverEffect} onclick="handleGrowthTableSort('harvestedDate')">Harvested Date ${getSortIcon('harvestedDate')}</th>
                            <th style="${headerStyle}" ${hoverEffect} onclick="handleGrowthTableSort('currentStage')">Current Stage ${getSortIcon('currentStage')}</th>
                            <th style="${headerStyle}" ${hoverEffect} onclick="handleGrowthTableSort('progression')">Progression ${getSortIcon('progression')}</th>
                            <th style="${headerStyle}" ${hoverEffect} onclick="handleGrowthTableSort('hStart')">Start Date ${getSortIcon('hStart')}</th>
                            <th style="${headerStyle}" ${hoverEffect} onclick="handleGrowthTableSort('hEnd')">End Date ${getSortIcon('hEnd')}</th>
                        </tr>
                    </thead>
                    <tbody>
    `;

    if (results.length === 0) {
        html += `<tr><td colspan="9" style="padding: 2rem; text-align: center; color: var(--text-secondary);">No growth data available for the selected plots.</td></tr>`;
    } else {
        results.forEach(res => {
            html += `
                <tr style="border-bottom: 1px solid var(--border-color);">
                    <td style="padding: 1rem; font-weight: 600;">${res.plotName}</td>
                    <td style="padding: 1rem;">${(res.auditedArea || 0).toFixed(2)}</td>
                    <td style="padding: 1rem;">${(res.expectedHarvestTon || 0).toFixed(2)}</td>
                    <td style="padding: 1rem; color: ${res.isHarvested === 'Yes' ? '#10b981' : '#f59e0b'}; font-weight: 500;">${res.isHarvested}</td>
                    <td style="padding: 1rem;">${res.harvestedDate || '-'}</td>
                    <td style="padding: 1rem;">${res.currentStage || '-'}</td>
                    <td style="padding: 1rem;">${res.progression}%</td>
                    <td style="padding: 1rem;">${res.hStart || '-'}</td>
                    <td style="padding: 1rem;">${res.hEnd || '-'}</td>
                </tr>
            `;
        });
    }

    html += `</tbody></table></div></div>`;
    container.innerHTML = html;
}

function handleGrowthTableSort(col) {
    if (growthTableSortCol === col) {
        growthTableSortOrder = (growthTableSortOrder === 'asc') ? 'desc' : 'asc';
    } else {
        growthTableSortCol = col;
        growthTableSortOrder = 'asc';
    }
    updateGrowthTable();
}

function resetGrowthTable() {
    growthTableSortCol = 'plotName';
    growthTableSortOrder = 'asc';
    const toggle = document.getElementById('hide-harvested-table');
    if (toggle) toggle.checked = false;
    updateGrowthTable();
}

function sortProjectsToggle() {
    projectsSortedByName = !projectsSortedByName;
    renderProjectsList();
}

document.getElementById('login-password')?.addEventListener('keypress', function (e) {
    if (e.key === 'Enter') {
        e.preventDefault();
        handleLogin();
    }
});

// --- Growth Progression Chart Logic ---

const drawValuesPlugin = {
    id: 'drawValues',
    afterDatasetsDraw: (chart) => {
        const ctx = chart.ctx;
        chart.data.datasets.forEach((dataset, i) => {
            const meta = chart.getDatasetMeta(i);
            meta.data.forEach((bar, index) => {
                const data = dataset.data[index];
                if (data === 0) return; // Don't draw 0s for a cleaner look when empty

                // Setup font for high contrast readability
                ctx.font = 'bold 18px "Inter", sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'bottom';
                
                // Draw a small underline under the number
                const textWidth = ctx.measureText(data).width;
                const textY = bar.y < bar.base ? bar.y - 12 : bar.base - 12;
                
                // Explicitly use white/light-gray so it is always readable on the dark dash
                ctx.fillStyle = '#f8fafc'; 
                ctx.fillText(data, bar.x, textY);
                
                ctx.beginPath();
                ctx.moveTo(bar.x - textWidth/2 - 4, textY + 6);
                ctx.lineTo(bar.x + textWidth/2 + 4, textY + 6);
                ctx.strokeStyle = '#f8fafc';
                ctx.lineWidth = 2;
                ctx.stroke();
            });
        });
    }
};

function renderGrowthProgressionChart(results) {
    try {
        console.log(`[DEBUG] Rendering Progression Chart with ${results.length} plots`);
        // Stats should always reflect the global data, not the filtered results
        const fullResults = window.currentGrowthResults || results;
        const totalPlotsCount = fullResults.length;
        const harvestedPlotsCount = fullResults.filter(r => r.isHarvested === "Yes").length;

        const totalEl = document.getElementById('growth-prog-total');
        const harvestedEl = document.getElementById('growth-prog-harvested');
        if (totalEl) totalEl.textContent = `${totalPlotsCount} / ${plotsData.length}`;
        if (harvestedEl) harvestedEl.textContent = `${harvestedPlotsCount} / ${plotsData.length}`;

        // Initialize bins
        const bins = [
            { label: '0-20%', plots: [], totalArea: 0 },
            { label: '20-40%', plots: [], totalArea: 0 },
            { label: '40-60%', plots: [], totalArea: 0 },
            { label: '60-80%', plots: [], totalArea: 0 },
            { label: '80-100%', plots: [], totalArea: 0 }
        ];

        results.forEach(res => {
            if (res.progression === "-" || res.progression === null) return;
            
            let pVal = parseFloat(res.progression);
            if (isNaN(pVal)) return;

            // Backend returns seasonProgression, e.g., 0.8
            // Convert to percentage
            if (pVal <= 1.0) {
                pVal = pVal * 100;
            }

            let binIdx = 0;
            if (pVal <= 20) binIdx = 0;
            else if (pVal <= 40) binIdx = 1;
            else if (pVal <= 60) binIdx = 2;
            else if (pVal <= 80) binIdx = 3;
            else binIdx = 4;

            bins[binIdx].plots.push(res);
            bins[binIdx].totalArea += (parseFloat(res.auditedArea) || 0);
        });

        const areaUnit = companyPrefs.areaUnits || 'Acre';

        const canvas = document.getElementById('growthProgressionChart');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        
        if (growthProgressionChartInstance) {
            growthProgressionChartInstance.destroy();
        }

        growthProgressionChartInstance = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: bins.map(b => b.label),
                datasets: [{
                    label: 'Plots',
                    data: bins.map(b => b.plots.length),
                    backgroundColor: '#06b6d4',
                    barThickness: 50,
                    borderRadius: 0, 
                    borderWidth: 0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                layout: { padding: { top: 70 } }, // Increased padding for bubbles
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                const b = bins[context.dataIndex];
                                return [
                                    'Plots: ' + context.raw,
                                    'Area: ' + b.totalArea.toFixed(2) + ' ' + areaUnit
                                ];
                            }
                        }
                    }
                },
                scales: {
                    y: { display: false, beginAtZero: true },
                    x: {
                        ticks: { color: '#e2e8f0', font: { size: 14 } },
                        grid: { color: 'rgba(255, 255, 255, 0.1)', drawBorder: false }
                    }
                },
                onClick: (e, elements) => {
                    if (elements.length > 0) {
                        const index = elements[0].index;
                        showGrowthProgressionPlots(bins[index].label, bins[index].plots);
                    }
                }
            },
            plugins: [
                drawValuesPlugin,
                {
                    id: 'progressionCustomLabels',
                    afterDatasetsDraw: (chart) => {
                        const ctx = chart.ctx;
                        chart.data.datasets.forEach((dataset, i) => {
                            const meta = chart.getDatasetMeta(i);
                            meta.data.forEach((bar, index) => {
                                const bData = bins[index];
                                if (bData.plots.length === 0) return;

                                const bubbleText = `${bData.plots.length} Plots, ${bData.totalArea.toFixed(2)} ${areaUnit}`;
                                ctx.font = '11px "Inter", sans-serif';
                                const textWidth = ctx.measureText(bubbleText).width;
                                const bW = textWidth + 12;
                                const bH = 26;
                                const bX = bar.x - (bW / 2);
                                // User Request: more padding between number and bubble
                                // bar.y is top of bar. drawValues draws at bar.y - 12. 
                                // Moving bubble to -65 for more gap.
                                const bY = bar.y - 65; 

                                ctx.fillStyle = '#f8fafc';
                                ctx.beginPath();
                                if (ctx.roundRect) ctx.roundRect(bX, bY, bW, bH, 4);
                                else ctx.rect(bX, bY, bW, bH);
                                ctx.fill();

                                ctx.beginPath();
                                ctx.moveTo(bar.x - 4, bY + bH);
                                ctx.lineTo(bar.x + 4, bY + bH);
                                ctx.lineTo(bar.x, bY + bH + 5);
                                ctx.closePath();
                                ctx.fill();

                                ctx.fillStyle = '#1e293b';
                                ctx.textAlign = 'center';
                                ctx.textBaseline = 'middle';
                                ctx.fillText(bubbleText, bar.x, bY + (bH / 2));
                            });
                        });
                    }
                }
            ]
        });

        // Hide container initially
        const plotsContainer = document.getElementById('growth-progression-plots-container');
        if (plotsContainer) plotsContainer.classList.add('hidden');

    } catch (err) {
        console.error('[ERROR] Problem rendering Progression Chart:', err);
    }
}

// --- Growth Stage Chart Logic (NEW) ---

function renderGrowthStageChart(results) {
    try {
        console.log(`[DEBUG] Rendering Stage Chart with ${results.length} plots`);
        
        const STAGE_ORDER = ["Emergence", "Tuber Initiation", "Tuber Bulking", "Harvested"];
        
        // Initialize bins
        const bins = STAGE_ORDER.map(label => ({
            label: label,
            plots: [],
            totalArea: 0
        }));

        results.forEach(res => {
            let stage = res.currentStage;
            if (res.isHarvested === "Yes") {
                stage = "Harvested";
            }

            // Find correct bin
            let bin = bins.find(b => b.label.toLowerCase() === (stage || "").toLowerCase());
            
            // Fallback for unknown stages? User requested specific order.
            // If it's not one of the major ones, maybe skip or add to a misc? 
            // For now, only handle requested ones.
            if (bin) {
                bin.plots.push(res);
                bin.totalArea += (parseFloat(res.auditedArea) || 0);
            } else if (stage && stage !== "-") {
                console.warn(`[WARN] Unknown stage: ${stage} for plot ${res.plotName}`);
            }
        });

        const areaUnit = (companyPrefs.areaUnits || 'ha').toLowerCase().includes('acre') ? 'Acre' : 'Ha';

        const canvas = document.getElementById('growthStageChart');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        
        if (growthStageChartInstance) {
            growthStageChartInstance.destroy();
        }

        growthStageChartInstance = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: bins.map(b => b.label),
                datasets: [{
                    label: 'Plots',
                    data: bins.map(b => b.plots.length),
                    backgroundColor: [
                        '#22d3ee', // Emergence (Cyan)
                        '#818cf8', // Tuber Initiation (Indigo)
                        '#c084fc', // Tuber Bulking (Purple)
                        '#10b981'  // Harvested (Green)
                    ],
                    barThickness: 60,
                    borderRadius: 4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                layout: { padding: { top: 70 } },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                const b = bins[context.dataIndex];
                                return [
                                    'Plots: ' + context.raw,
                                    'Area: ' + b.totalArea.toFixed(2) + ' ' + areaUnit
                                ];
                            }
                        }
                    }
                },
                scales: {
                    y: { 
                        display: true, 
                        beginAtZero: true,
                        grid: { color: 'rgba(255, 255, 255, 0.05)' },
                        ticks: { color: 'var(--text-secondary)', stepSize: 1 }
                    },
                    x: {
                        ticks: { color: '#e2e8f0', font: { size: 14 } },
                        grid: { display: false }
                    }
                },
                onClick: (e, elements) => {
                    if (elements.length > 0) {
                        const index = elements[0].index;
                        showGrowthStagePlots(bins[index].label, bins[index].plots);
                    }
                }
            },
            plugins: [
                drawValuesPlugin,
                {
                    id: 'stageCustomLabels',
                    afterDatasetsDraw: (chart) => {
                        const ctx = chart.ctx;
                        chart.data.datasets.forEach((dataset, i) => {
                            const meta = chart.getDatasetMeta(i);
                            meta.data.forEach((bar, index) => {
                                const bData = bins[index];
                                if (bData.plots.length === 0) return;

                                const bubbleText = `${bData.plots.length} Plots, ${bData.totalArea.toFixed(2)} ${areaUnit}`;
                                ctx.font = '11px "Inter", sans-serif';
                                const textWidth = ctx.measureText(bubbleText).width;
                                const bW = textWidth + 12;
                                const bH = 26;
                                const bX = bar.x - (bW / 2);
                                const bY = bar.y - 65; 

                                ctx.fillStyle = '#f8fafc';
                                ctx.beginPath();
                                if (ctx.roundRect) ctx.roundRect(bX, bY, bW, bH, 4);
                                else ctx.rect(bX, bY, bW, bH);
                                ctx.fill();

                                ctx.beginPath();
                                ctx.moveTo(bar.x - 4, bY + bH);
                                ctx.lineTo(bar.x + 4, bY + bH);
                                ctx.lineTo(bar.x, bY + bH + 5);
                                ctx.closePath();
                                ctx.fill();

                                ctx.fillStyle = '#1e293b';
                                ctx.textAlign = 'center';
                                ctx.textBaseline = 'middle';
                                ctx.fillText(bubbleText, bar.x, bY + (bH / 2));
                            });
                        });
                    }
                }
            ]
        });

        // Hide container initially
        const plotsContainer = document.getElementById('growth-stage-plots-container');
        if (plotsContainer) plotsContainer.classList.add('hidden');

    } catch (err) {
        console.error('[ERROR] Problem rendering Stage Chart:', err);
    }
}

function showGrowthStagePlots(label, plots) {
    const container = document.getElementById('growth-stage-plots-container');
    const tbody = document.getElementById('growth-stage-plots-tbody');
    const title = document.getElementById('growth-stage-plots-title');

    if (!container || !tbody || !title) return;

    title.textContent = `Plots in Stage: ${label} (${plots.length})`;
    
    tbody.innerHTML = '';
    if (plots.length === 0) {
        tbody.innerHTML = '<tr><td colspan="9" style="padding: 1rem; text-align: center; color: var(--text-secondary);">No plots in this stage.</td></tr>';
    } else {
        plots.forEach(p => {
            const tr = document.createElement('tr');
            tr.style.borderBottom = '1px solid var(--border-color)';
            tr.innerHTML = `
                <td style="padding: 0.75rem; color: var(--text-primary); font-weight: 500;">${p.plotName}</td>
                <td style="padding: 0.75rem; color: var(--text-secondary);">${(p.auditedArea || 0).toFixed(2)}</td>
                <td style="padding: 0.75rem; color: var(--text-secondary);">${(p.expectedHarvestTon || 0).toFixed(2)}</td>
                <td style="padding: 0.75rem; color: var(--text-secondary); font-weight: 500; color: ${p.isHarvested === 'Yes' ? '#10b981' : '#f59e0b'};">${p.isHarvested}</td>
                <td style="padding: 0.75rem; color: var(--text-secondary);">${p.harvestedDate || "-"}</td>
                <td style="padding: 0.75rem; color: var(--text-secondary);">${p.currentStage || "-"}</td>
                <td style="padding: 0.75rem; color: var(--text-secondary); font-weight: 600; color: var(--secondary-color);">${p.progression}%</td>
                <td style="padding: 0.75rem; color: var(--text-secondary);">${p.hStart || "-"}</td>
                <td style="padding: 0.75rem; color: var(--text-secondary);">${p.hEnd || "-"}</td>
            `;
            tbody.appendChild(tr);
        });
    }
    
    container.classList.remove('hidden');
    container.scrollIntoView({ behavior: 'smooth', block: 'center' });
    
    // Removed: Hide other drill-downs to allow coexistence
}


let growthTableSortCol = 'plotName';
let growthTableSortOrder = 'asc';

function renderHarvestWindowChart(results) {
    try {
        if (harvestWindowChartInstance) {
            harvestWindowChartInstance.destroy();
            harvestWindowChartInstance = null;
        }

        const coveredEl = document.getElementById('harvest-plots-covered');
        const rangeEl = document.getElementById('harvest-window-range');

        const areaUnit = companyPrefs.areaUnits || 'Acre';
        
        // 1. Define "Current Week" (Monday to Sunday)
        const now = new Date();
        const dayOfWeek = now.getDay(); // 0 (Sun) to 6 (Sat)
        const diffToMon = (dayOfWeek === 0 ? -6 : 1 - dayOfWeek);
        const currentWeekMon = new Date(now);
        currentWeekMon.setDate(now.getDate() + diffToMon);
        currentWeekMon.setHours(0, 0, 0, 0);

        // 2. Group all plots into Monday-based weeks
        const weeksMap = {};
        let filteredPlotsCount = 0;

        results.forEach(p => {
            if (p.isHarvested === "Yes" || !p.rawHStart || !p.rawHEnd) return;
            if (p.rawHEnd < currentWeekMon) return; // User Request: Ignore if end date before this Monday

            let plotStart = new Date(p.rawHStart);
            plotStart.setHours(0, 0, 0, 0);

            let weekMon;
            if (plotStart < currentWeekMon) {
                // In-progress: Force into Current Week
                weekMon = new Date(currentWeekMon);
            } else {
                const pDay = plotStart.getDay();
                const pDiffToMon = (pDay === 0 ? -6 : 1 - pDay);
                weekMon = new Date(plotStart);
                weekMon.setDate(plotStart.getDate() + pDiffToMon);
            }
            weekMon.setHours(0, 0, 0, 0);

            const weekKey = weekMon.toISOString().split('T')[0];
            if (!weeksMap[weekKey]) {
                weeksMap[weekKey] = { 
                    monday: weekMon,
                    plots: [], 
                    totalHarvest: 0, 
                    totalArea: 0, 
                    chartPlotsCount: 0 
                };
            }
            weeksMap[weekKey].plots.push(p);
            weeksMap[weekKey].totalHarvest += (parseFloat(p.expectedHarvestTon) || 0);
            weeksMap[weekKey].totalArea += (parseFloat(p.auditedArea) || 0);
            weeksMap[weekKey].chartPlotsCount++;
            filteredPlotsCount++;
        });

        // 3. Select the first 8 available weeks starting from Current Week
        const sortedWeeks = Object.keys(weeksMap)
            .filter(key => key >= currentWeekMon.toISOString().split('T')[0])
            .sort()
            .slice(0, 8);

        if (sortedWeeks.length === 0) {
            if (coveredEl) coveredEl.textContent = `0 / ${results.length}`;
            if (rangeEl) rangeEl.textContent = "-";
            return;
        }

        if (coveredEl) coveredEl.textContent = `${filteredPlotsCount} / ${results.length}`;

        const labels = sortedWeeks.map((key, index) => {
            const b = weeksMap[key];
            const sunday = new Date(b.monday);
            sunday.setDate(b.monday.getDate() + 6);
            const fmt = (d) => `${d.getDate().toString().padStart(2, '0')}-${(d.getMonth() + 1).toString().padStart(2, '0')}`;
            return [`Week ${index + 1}`, `${fmt(b.monday)} to ${fmt(sunday)}` ];
        });
        const data = sortedWeeks.map(key => weeksMap[key].totalHarvest);

        if (rangeEl) {
            const first = weeksMap[sortedWeeks[0]].monday;
            const lastMon = weeksMap[sortedWeeks[sortedWeeks.length - 1]].monday;
            const lastSun = new Date(lastMon);
            lastSun.setDate(lastMon.getDate() + 6);
            const fmtLong = (d) => `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')}`;
            rangeEl.textContent = `${fmtLong(first)} - ${fmtLong(lastSun)}`;
        }

        const canvas = document.getElementById('harvestWindowChart');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');

        harvestWindowChartInstance = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Expected Production (Metric Tonnes)',
                    data: data,
                    backgroundColor: '#84cc16',
                    barThickness: 50,
                    borderRadius: 4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                layout: { padding: { top: 70 } },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                const wData = weeksMap[sortedWeeks[context.dataIndex]];
                                return [
                                    `Production: ${context.raw.toFixed(2)} Metric Tonnes`,
                                    `Plots: ${wData.chartPlotsCount}`,
                                    `Area: ${wData.totalArea.toFixed(2)} ${areaUnit}`
                                ];
                            }
                        }
                    }
                },
                scales: {
                    y: { display: true, beginAtZero: true, grid: { color: 'rgba(255, 255, 255, 0.05)' }, ticks: { color: 'var(--text-secondary)' } },
                    x: { ticks: { color: '#e2e8f0', font: { size: 10 } }, grid: { display: false } }
                },
                onClick: (e, elements) => {
                    if (elements.length > 0) {
                        const index = elements[0].index;
                        const key = sortedWeeks[index];
                        showHarvestWindowPlots(`Week ${index + 1}`, weeksMap[key].plots);
                    }
                }
            },
            plugins: [{
                id: 'harvestCustomLabels',
                afterDatasetsDraw: (chart) => {
                    const ctx = chart.ctx;
                    chart.data.datasets.forEach((dataset, i) => {
                        const meta = chart.getDatasetMeta(i);
                        meta.data.forEach((bar, index) => {
                            const val = dataset.data[index];
                            const wData = weeksMap[sortedWeeks[index]];
                            ctx.font = 'bold 16px "Inter", sans-serif';
                            ctx.fillStyle = '#84cc16';
                            ctx.textAlign = 'center';
                            if (val > 0) ctx.fillText(val.toFixed(2), bar.x, bar.y - 10);
                            const bubbleText = `${wData.chartPlotsCount} Plots, ${wData.totalArea.toFixed(2)} ${areaUnit}`;

                            ctx.font = '11px "Inter", sans-serif';
                            const textWidth = ctx.measureText(bubbleText).width;
                            const bW = textWidth + 12;
                            const bH = 26;
                            const bX = bar.x - (bW / 2);
                            const bY = bar.y - 55;
                            ctx.fillStyle = '#f8fafc';
                            ctx.beginPath();
                            if (ctx.roundRect) ctx.roundRect(bX, bY, bW, bH, 4);
                            else ctx.rect(bX, bY, bW, bH);
                            ctx.fill();
                            ctx.beginPath();
                            ctx.moveTo(bar.x - 4, bY + bH);
                            ctx.lineTo(bar.x + 4, bY + bH);
                            ctx.lineTo(bar.x, bY + bH + 5);
                            ctx.closePath();
                            ctx.fill();
                            ctx.fillStyle = '#1e293b';
                            ctx.textAlign = 'center';
                            ctx.textBaseline = 'middle';
                            ctx.fillText(bubbleText, bar.x, bY + (bH / 2));
                        });
                    });
                }
            }]
        });

        const plotsContainer = document.getElementById('harvest-window-plots-container');
        if (plotsContainer) plotsContainer.classList.add('hidden');

    } catch (err) {
        console.error('[ERROR] Problem rendering Harvest Window Chart:', err);
    }
}

function showGrowthProgressionPlots(label, plots) {
    const container = document.getElementById('growth-progression-plots-container');
    const tbody = document.getElementById('growth-progression-plots-tbody');
    const title = document.getElementById('growth-progression-plots-title');

    if (!container || !tbody || !title) return;

    title.textContent = `Plots in Range: ${label} (${plots.length})`;
    
    tbody.innerHTML = '';
    if (plots.length === 0) {
        tbody.innerHTML = '<tr><td colspan="9" style="padding: 1rem; text-align: center; color: var(--text-secondary);">No plots in this range.</td></tr>';
    } else {
        plots.forEach(p => {
            const tr = document.createElement('tr');
            tr.style.borderBottom = '1px solid var(--border-color)';
            tr.innerHTML = `
                <td style="padding: 0.75rem; color: var(--text-primary); font-weight: 500;">${p.plotName}</td>
                <td style="padding: 0.75rem; color: var(--text-secondary);">${(p.auditedArea || 0).toFixed(2)}</td>
                <td style="padding: 0.75rem; color: var(--text-secondary);">${(p.expectedHarvestTon || 0).toFixed(2)}</td>
                <td style="padding: 0.75rem; color: var(--text-secondary); font-weight: 500; color: ${p.isHarvested === 'Yes' ? '#10b981' : '#f59e0b'};">${p.isHarvested}</td>
                <td style="padding: 0.75rem; color: var(--text-secondary);">${p.harvestedDate || "-"}</td>
                <td style="padding: 0.75rem; color: var(--text-secondary);">${p.currentStage || "-"}</td>
                <td style="padding: 0.75rem; color: var(--text-secondary); font-weight: 600; color: var(--secondary-color);">${p.progression}%</td>
                <td style="padding: 0.75rem; color: var(--text-secondary);">${p.hStart || "-"}</td>
                <td style="padding: 0.75rem; color: var(--text-secondary);">${p.hEnd || "-"}</td>
            `;
            tbody.appendChild(tr);
        });
    }
    
    container.classList.remove('hidden');
    container.scrollIntoView({ behavior: 'smooth', block: 'center' });
    
    // Removed: Hide other drill-down to allow coexistence
}

function showHarvestWindowPlots(label, plots) {
    const container = document.getElementById('harvest-window-plots-container');
    const tbody = document.getElementById('harvest-window-plots-tbody');
    const title = document.getElementById('harvest-window-plots-title');

    if (!container || !tbody || !title) return;

    title.textContent = `Plots in ${label} (${plots.length})`;
    
    tbody.innerHTML = '';
    if (plots.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="padding: 1rem; text-align: center; color: var(--text-secondary);">No plots in this week.</td></tr>';
    } else {
        plots.forEach(p => {
            const tr = document.createElement('tr');
            tr.style.borderBottom = '1px solid var(--border-color)';
            tr.innerHTML = `
                <td style="padding: 0.75rem; color: var(--text-primary); font-weight: 500;">${p.plotName}</td>
                <td style="padding: 0.75rem; color: var(--text-secondary);">${(p.auditedArea || 0).toFixed(2)}</td>
                <td style="padding: 0.75rem; color: var(--text-secondary);">${(p.expectedHarvestTon || 0).toFixed(2)}</td>
                <td style="padding: 0.75rem; color: var(--text-secondary);">${p.currentStage || "-"}</td>
                <td style="padding: 0.75rem; color: var(--text-secondary); font-weight: 600; color: var(--secondary-color);">${p.progression}%</td>
                <td style="padding: 0.75rem; color: var(--text-secondary);">${p.hStart || "-"}</td>
                <td style="padding: 0.75rem; color: var(--text-secondary);">${p.hEnd || "-"}</td>
            `;
            tbody.appendChild(tr);
        });
    }
    
    container.classList.remove('hidden');
    container.scrollIntoView({ behavior: 'smooth', block: 'center' });

    // Hide the other drill-down if open
    const containers = ['growth-progression-plots-container', 'harvest-window-plots-container', 'harvest-window-daily-plots-container'];
    containers.forEach(id => {
        if (id !== container.id) {
            const other = document.getElementById(id);
            if (other) other.classList.add('hidden');
        }
    });
}

function closeGrowthDrillDown(id) {
    const container = document.getElementById(id);
    if (container) container.classList.add('hidden');
}

function updateGrowthChart() {
    if (!window.currentGrowthResults) return;
    const hideHarvested = document.getElementById('hide-harvested-chart')?.checked;
    const filteredResults = hideHarvested 
        ? window.currentGrowthResults.filter(r => r.isHarvested !== "Yes") 
        : window.currentGrowthResults;
    
    // Only Progression chart should be filtered per user request
    renderGrowthProgressionChart(filteredResults);
    
    // Stage, Harvest Window (Weekly), and Harvest Window (Daily) should show all data
    renderGrowthStageChart(window.currentGrowthResults);
    renderHarvestWindowChart(window.currentGrowthResults);
    renderHarvestWindowDailyChart(window.currentGrowthResults);
}

function updateGrowthTable() {
    if (!window.currentGrowthResults) return;
    const hideHarvested = document.getElementById('hide-harvested-table')?.checked;
    let filteredResults = hideHarvested 
        ? window.currentGrowthResults.filter(r => r.isHarvested !== "Yes") 
        : [...window.currentGrowthResults];

    // Sorting Logic
    if (growthTableSortCol) {
        filteredResults.sort((a, b) => {
            let valA = a[growthTableSortCol];
            let valB = b[growthTableSortCol];

            // Special handling for labels vs raw values
            if (growthTableSortCol === 'hStart') { valA = a.rawHStart ? a.rawHStart.getTime() : 0; valB = b.rawHStart ? b.rawHStart.getTime() : 0; }
            if (growthTableSortCol === 'hEnd') { valA = a.rawHEnd ? a.rawHEnd.getTime() : 0; valB = b.rawHEnd ? b.rawHEnd.getTime() : 0; }
            if (growthTableSortCol === 'harvestedDate') { 
                valA = a.harvestedDate === '-' ? 0 : new Date(a.harvestedDate.split('-').reverse().join('-')).getTime();
                valB = b.harvestedDate === '-' ? 0 : new Date(b.harvestedDate.split('-').reverse().join('-')).getTime();
            }

            if (typeof valA === 'string') {
                return growthTableSortOrder === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
            } else {
                return growthTableSortOrder === 'asc' ? (valA - valB) : (valB - valA);
            }
        });
    }

    // Toggle Clear Filter button visibility
    const resetBtn = document.getElementById('reset-growth-table-btn');
    if (resetBtn) {
        const isDefault = (growthTableSortCol === 'plotName' || growthTableSortCol === 'isHarvested') && growthTableSortOrder === 'asc' && !hideHarvested;
        if (isDefault) resetBtn.classList.add('hidden');
        else resetBtn.classList.remove('hidden');
    }

    renderGrowthTable(filteredResults);
}
document.getElementById('prediction-filter')?.addEventListener('change', function () {
    const filterValue = this.value; // 'all', 'available', 'unavailable'
    let plotsToShow = [];

    if (filterValue === 'all') {
        plotsToShow = [...plotsWithPrediction, ...plotsWithoutPrediction, ...plotsNotEnabled];
    } else if (filterValue === 'available') {
        plotsToShow = plotsWithPrediction;
    } else if (filterValue === 'unavailable') {
        plotsToShow = plotsWithoutPrediction;
    } else if (filterValue === 'not_enabled') {
        plotsToShow = plotsNotEnabled;
    }

    // Sort alphabetically for "All" view to be cleaner
    if (filterValue === 'all') {
        plotsToShow.sort((a, b) => a.localeCompare(b));
    }

    populateSearchableDropdown(plotsToShow);
    initSearchableDropdown();

    document.getElementById('plot-search').value = '';
    document.getElementById('plot-select-value').value = '';
    clearPlotDisplay();
});

function clearPlotDisplay() {
    const plotElements = [
        'plot-audited-area', 'plot-exp-yield', 'plot-re-yield',
        'plot-app-yield-min', 'plot-app-yield-max',
        'plot-exp-harvest', 'plot-re-harvest',
        'plot-app-harvest-min', 'plot-app-harvest-max'
    ];
    plotElements.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.textContent = '-';
    });

    ['plot-re-yield-diff', 'plot-app-yield-diff-exp', 'plot-app-yield-diff-re',
        'plot-re-harvest-diff', 'plot-app-harvest-diff-exp', 'plot-app-harvest-diff-re'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.innerHTML = '';
        });
}

function navigatePlot(direction) {
    // direction: -1 for Prev, 1 for Next
    const currentPlot = document.getElementById('plot-select-value').value;
    if (!plotsList || plotsList.length === 0) return;

    let currentIndex = plotsList.indexOf(currentPlot);

    // If current plot not found (e.g. init), start from -1 
    let newIndex = currentIndex + direction;

    // Handle Wrapping
    if (newIndex < 0) {
        newIndex = plotsList.length - 1;
    } else if (newIndex >= plotsList.length) {
        newIndex = 0;
    }

    const newPlot = plotsList[newIndex];

    // Update Input UI
    const searchInput = document.getElementById('plot-search');
    const hiddenInput = document.getElementById('plot-select-value');

    if (searchInput) searchInput.value = newPlot;
    if (hiddenInput) hiddenInput.value = newPlot;

    // Trigger Data Update
    updatePlotData(newPlot);
}

async function fetchHarvestTasks() {
    const planTypeId = document.getElementById('harvest-plantype-id')?.value?.trim();
    if (!planTypeId) return [];

    const baseUrl = getServerUrl();
    const allTasks = [];

    for (const projectId of selectedProjectIds) {
        try {
            const url = `${baseUrl}/api/user-aggregate/harvest-tasks?environment=${encodeURIComponent(currentEnvironment)}&projectId=${encodeURIComponent(projectId)}&planTypeId=${encodeURIComponent(planTypeId)}`;
            const response = await fetch(url, {
                headers: {
                    'Authorization': `Bearer ${authToken}`,
                    'ngrok-skip-browser-warning': 'true'
                }
            });
            const data = await response.json();
            if (response.ok && data.records) {
                allTasks.push(...data.records);
            }
        } catch (error) {
            console.error(`Error fetching harvest tasks for project ${projectId}:`, error);
        }
    }
    return allTasks;
}

function renderHarvestStatus(processedPlots, tasks) {
    const section = document.getElementById('harvest-status-section');
    const tbody = document.getElementById('harvest-status-tbody');
    const statPlotsEl = document.getElementById('stat-harvest-plots-covered');
    const statCollectedEl = document.getElementById('stat-harvest-collected');

    if (!section || !tbody) return;

    console.log(`[DEBUG] renderHarvestStatus called with ${tasks.length} tasks and ${processedPlots.length} processed plots. Filter: ${activeHarvestWindowFilter}`);

    // Reset
    tbody.innerHTML = '';
    section.classList.remove('hidden');

    // Store for re-rendering (e.g. when filtering)
    lastProcessedPlots = processedPlots;
    lastHarvestTasks = tasks;

    // 1. Setup Mapping & Aggregates
    const plotsByCaId = {};
    plotsData.forEach(p => { if (p.caId) plotsByCaId[String(p.caId)] = p.name; });

    const windowAggregates = {
        'Before Window': { count: 0, collected: 0, expected: 0, predicted: 0, color: '#f59e0b' },
        'Within Window': { count: 0, collected: 0, expected: 0, predicted: 0, color: '#10b981' },
        'Post Window': { count: 0, collected: 0, expected: 0, predicted: 0, color: '#3b82f6' }
    };

    const tasksByPlot = {};
    tasks.forEach(task => {
        const id = String(task.croppableAreaId);
        if (!tasksByPlot[id]) tasksByPlot[id] = [];
        tasksByPlot[id].push(task);
    });

    const harvestedPlotsWithData = processedPlots.filter(p => 
        p.isHarvested === 'Yes' && 
        tasksByPlot[String(p.caId)] &&
        p.rawHStart && p.rawHEnd && p.hStart !== "-" && p.hEnd !== "-"
    );

    let totalCollectedMetricTon = 0;
    let collectedForPredictedPlots = 0; // The sum for Harvest Analysis card
    let collectedPlotCount = 0; // New: count of unique plots contributing
    const includeNoPred = document.getElementById('include-no-prediction-agg')?.checked;
    
    // Separate loop for Aggregate Level "Collected Harvest" - bypasses window/status filtering
    processedPlots.forEach(plot => {
        const caId = String(plot.caId);
        const plotTasks = tasksByPlot[caId];
        if (!plotTasks) return;
        
        const hasPrediction = !plot.noPrediction;
        if (hasPrediction || includeNoPred) {
            let plotAdded = false;
            plotTasks.forEach(task => {
                const metricTonValue = convertValueToMetricTon(parseFloat(task.qty) || 0, task.unit || '-');
                collectedForPredictedPlots += metricTonValue;
                plotAdded = true;
            });
            if (plotAdded) collectedPlotCount++;
        }
    });

    const coveredCaIds = new Set();
    const allDetailRows = [];

    // 2. Process Classification & Aggregation for Harvest Status Tables
    harvestedPlotsWithData.forEach(plot => {
        const caId = String(plot.caId);
        const plotTasks = tasksByPlot[caId];
        
        const start = plot.rawHStart ? new Date(plot.rawHStart).getTime() : null;
        const end = plot.rawHEnd ? new Date(plot.rawHEnd).getTime() : null;
        const collectionDates = plotTasks.map(t => t.actualClosedDate ? new Date(t.actualClosedDate).getTime() : null).filter(d => d !== null);

        let status = 'Within Window';
        if (start && end && collectionDates.length > 0) {
            const allBefore = collectionDates.every(d => d < start);
            const allAfter = collectionDates.every(d => d > end);
            const anyWithin = collectionDates.some(d => d >= start && d <= end);
            if (anyWithin) status = 'Within Window';
            else if (allBefore) status = 'Before Window';
            else if (allAfter) status = 'Post Window';
            else status = 'Within Window'; // Spanning
        }

        // Aggregate totals for Summary Table (always use ALL data)
        const agg = windowAggregates[status];
        if (agg) {
            agg.count++;
            agg.expected += (plot.expectedHarvestTon || 0);
            agg.predicted += (plot.predictedHarvestTon || 0);
        }

        let plotCollectedTon = 0;
        plotTasks.forEach(task => {
            const qty = parseFloat(task.qty) || 0;
            const unit = task.unit || '-';
            const metricTonValue = convertValueToMetricTon(qty, unit);
            
            plotCollectedTon += metricTonValue;
            if (agg) agg.collected += metricTonValue;

            // Detail row entry
            allDetailRows.push({
                name: plotsByCaId[caId] || plot.name || `CA ${caId}`,
                hDate: task.actualClosedDate ? formatDate(task.actualClosedDate) : "-",
                hStart: plot.hStart,
                hEnd: plot.hEnd,
                qty: qty,
                unit: unit,
                metricTon: metricTonValue,
                predictedTon: plot.predictedHarvestTon || 0,
                windowStatus: status // For filtering
            });
        });

        totalCollectedMetricTon += plotCollectedTon;
        coveredCaIds.add(caId);
    });

    // 3. Filter and Render Detail Table
    const filteredRows = activeHarvestWindowFilter 
        ? allDetailRows.filter(r => r.windowStatus === activeHarvestWindowFilter)
        : allDetailRows;

    filteredRows.forEach(r => {
        const tr = document.createElement('tr');
        tr.style.borderBottom = '1px solid var(--border-color)';
        tr.innerHTML = `
            <td style="padding: 1rem; color: var(--text-primary); font-weight: 500;">${r.name}</td>
            <td style="padding: 1rem; color: var(--text-secondary);">${r.hDate}</td>
            <td style="padding: 1rem; color: var(--text-secondary);">${r.hStart}</td>
            <td style="padding: 1rem; color: var(--text-secondary);">${r.hEnd}</td>
            <td style="padding: 1rem; color: var(--text-primary); font-weight: 600;">${r.qty}</td>
            <td style="padding: 1rem; color: var(--text-secondary);">${r.unit}</td>
            <td style="padding: 1rem; color: var(--secondary-color); font-weight: 700;">${r.metricTon.toFixed(2)}</td>
            <td style="padding: 1rem; color: #f59e0b; font-weight: 600;">${r.predictedTon.toFixed(2)}</td>
        `;
        tbody.appendChild(tr);
    });

    // Update Stats
    if (statPlotsEl) {
        const harvestedCount = processedPlots.filter(p => p.isHarvested === "Yes").length;
        statPlotsEl.textContent = `${coveredCaIds.size} / ${harvestedCount || '-'}`;
    }
    if (statCollectedEl) {
        statCollectedEl.textContent = `${totalCollectedMetricTon.toFixed(2)} metric ton`;
    }

    // Update the new Aggregate Level metric
    const aggCollectedEl = document.getElementById('agg-collected-harvest');
    const aggCollectedCountEl = document.getElementById('agg-collected-plots-count');
    if (aggCollectedEl) {
        aggCollectedEl.textContent = `${collectedForPredictedPlots.toFixed(2)} Tonnes`;
    }
    if (aggCollectedCountEl) {
        aggCollectedCountEl.textContent = collectedPlotCount > 0 ? `(${collectedPlotCount} plots)` : '';
    }

    if (filteredRows.length === 0) {
        const msg = activeHarvestWindowFilter ? `No plots found for "${activeHarvestWindowFilter}"` : 'No collected harvest task data found.';
        tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; padding: 2rem; color: var(--text-secondary);">${msg}</td></tr>`;
    }

    const resultsContainer = document.getElementById('harvest-status-results');
    if (resultsContainer) resultsContainer.classList.remove('hidden');

    // 4. Update Summary Visualization
    renderHarvestWindowStatus(windowAggregates, processedPlots);
}

function renderHarvestWindowStatus(aggregates, processedPlots) {
    const container = document.getElementById('harvest-window-status-container');
    const tbody = document.getElementById('harvest-window-summary-tbody');
    const rangeText = document.getElementById('harvest-window-range-text');
    const canvas = document.getElementById('harvest-window-pie-chart');
    const clearBtn = document.getElementById('clear-harvest-filter');

    if (!container || !tbody) return;

    // Show/Hide Clear Filter button based on state
    if (clearBtn) {
        if (activeHarvestWindowFilter) {
            clearBtn.classList.remove('hidden');
            clearBtn.style.display = 'flex';
        } else {
            clearBtn.classList.add('hidden');
            clearBtn.style.display = 'none';
        }
    }

    // 1. Show Container
    container.classList.remove('hidden');

    // 2. Format Date Range for Project
    const validStarts = processedPlots.map(p => p.rawHStart).filter(d => d instanceof Date && !isNaN(d.getTime()));
    const validEnds = processedPlots.map(p => p.rawHEnd).filter(d => d instanceof Date && !isNaN(d.getTime()));
    
    if (rangeText && validStarts.length > 0 && validEnds.length > 0) {
        const minStart = new Date(Math.min(...validStarts));
        const maxEnd = new Date(Math.max(...validEnds));
        const fmt = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
        rangeText.textContent = `: ${fmt(minStart)} - ${fmt(maxEnd)}`;
    }

    // 3. Render Summary Table
    tbody.innerHTML = '';
    const statuses = ['Before Window', 'Within Window', 'Post Window'];
    statuses.forEach(status => {
        const data = aggregates[status];
        const isActive = activeHarvestWindowFilter === status;
        const tr = document.createElement('tr');
        
        // Dynamic styling for interactivity
        tr.style.borderBottom = '1px solid var(--border-color)';
        tr.style.cursor = 'pointer';
        tr.style.transition = 'background-color 0.2s';
        if (isActive) {
            tr.style.backgroundColor = 'rgba(96, 165, 250, 0.15)'; // Highlight active
        }

        tr.onmouseover = () => { if (!isActive) tr.style.backgroundColor = 'rgba(255, 255, 255, 0.05)'; };
        tr.onmouseout = () => { if (!isActive) tr.style.backgroundColor = 'transparent'; };
        
        tr.onclick = () => {
            if (activeHarvestWindowFilter === status) {
                activeHarvestWindowFilter = null; // Toggle off if clicked again
            } else {
                activeHarvestWindowFilter = status;
            }
            // Trigger Detail Table Refresh
            renderHarvestStatus(lastProcessedPlots, lastHarvestTasks);
        };

        tr.innerHTML = `
            <td style="padding: 1.25rem 1rem; font-weight: 500; color: #60a5fa;">${status}${isActive ? ' <i class="fas fa-filter" style="font-size: 0.8rem; margin-left: 5px;"></i>' : ''}</td>
            <td style="padding: 1.25rem 1rem; text-align: center; color: var(--text-primary); font-weight: 600;">${data.count}</td>
            <td style="padding: 1.25rem 1rem; text-align: center; color: #10b981; font-weight: 700;">${data.collected.toFixed(2)}</td>
            <td style="padding: 1.25rem 1rem; text-align: center; color: var(--text-secondary);">${data.expected.toFixed(2)}</td>
            <td style="padding: 1.25rem 1rem; text-align: center; color: #f59e0b;">${data.predicted.toFixed(2)}</td>
        `;
        tbody.appendChild(tr);
    });

    // 4. Render Pie Chart
    if (harvestWindowPieChart) {
        harvestWindowPieChart.destroy();
    }

    const chartData = {
        labels: statuses,
        datasets: [{
            data: statuses.map(s => aggregates[s].count),
            backgroundColor: statuses.map(s => aggregates[s].color),
            borderColor: 'transparent',
            hoverOffset: 15
        }]
    };

    harvestWindowPieChart = new Chart(canvas, {
        type: 'pie',
        data: chartData,
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    padding: 12,
                    backgroundColor: 'rgba(15, 23, 42, 0.95)',
                    titleColor: '#fff',
                    bodyColor: '#cbd5e1',
                    bodyFont: { size: 14 }
                }
            }
        }
    });
}

async function handleLoadHarvestStatus() {
    const planTypeId = document.getElementById('harvest-plantype-id')?.value?.trim();
    if (!planTypeId) {
        alert("Please enter a Plantype ID.");
        return;
    }

    if (!window.currentGrowthResults || window.currentGrowthResults.length === 0) {
        alert("Please load Growth Data first to identify harvested plots.");
        return;
    }

    const btn = document.getElementById('load-harvest-status-btn');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Loading...';
    }

    try {
        const tasks = await fetchHarvestTasks();
        renderHarvestStatus(window.currentGrowthResults, tasks);
    } catch (error) {
        console.error("Error loading harvest status:", error);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '📥 Load Collected Harvest';
        }
    }
}

window.clearHarvestFilter = function() {
    activeHarvestWindowFilter = null;
    renderHarvestStatus(lastProcessedPlots, lastHarvestTasks);
};

window.toggleGrowthTableVisibility = function() {
    const wrapper = document.getElementById('base-growth-table-wrapper');
    const text = document.getElementById('toggle-growth-table-text');
    if (wrapper.classList.contains('hidden')) {
        wrapper.classList.remove('hidden');
        text.textContent = 'Hide Base Plot Data';
    } else {
        wrapper.classList.add('hidden');
        text.textContent = 'View Base Plot Data';
    }
};


function renderHarvestWindowDailyChart(results) {
    try {
        const now = new Date();
        const tomorrow = new Date(now);
        tomorrow.setDate(now.getDate() + 1);
        tomorrow.setHours(0, 0, 0, 0);

        console.log(`[DEBUG] Rendering Daily Harvest Chart`);
        
        if (harvestDailyChartInstance) {
            harvestDailyChartInstance.destroy();
            harvestDailyChartInstance = null;
        }

        const coveredEl = document.getElementById('harvest-daily-plots-covered');
        const rangeEl = document.getElementById('harvest-daily-window-range');

        // Group plots by Date
        const dailyMap = {};
        let filteredCount = 0;

        results.forEach(p => {
            if (p.isHarvested === "Yes" || !p.rawHStart || !p.rawHEnd) return;
            if (p.rawHEnd < tomorrow) return; // User Request: Ignore if end date is today or earlier

            let start = new Date(p.rawHStart);
            start.setHours(0, 0, 0, 0);

            let targetDate;
            if (start < tomorrow) {
                // In-progress: Force into Tomorrow
                targetDate = new Date(tomorrow);
            } else {
                targetDate = start;
            }

            const key = targetDate.toISOString().split('T')[0];
            if (!dailyMap[key]) {
                dailyMap[key] = {
                    date: targetDate,
                    plots: [],
                    totalHarvest: 0,
                    totalArea: 0
                };
            }
            dailyMap[key].plots.push(p);
            dailyMap[key].totalHarvest += (parseFloat(p.expectedHarvestTon) || 0);
            dailyMap[key].totalArea += (parseFloat(p.auditedArea) || 0);
            filteredCount++;
        });

        // Get sorted list of dates that have data, starting from Tomorrow
        const sortedDates = Object.keys(dailyMap)
            .filter(key => key >= tomorrow.toISOString().split('T')[0])
            .sort()
            .slice(0, 7);

        if (sortedDates.length === 0) {
            if (coveredEl) coveredEl.textContent = `0 / ${results.length}`;
            if (rangeEl) rangeEl.textContent = "-";
            return;
        }

        if (coveredEl) coveredEl.textContent = `${filteredCount} / ${results.length}`;
        
        if (rangeEl) {
            const first = dailyMap[sortedDates[0]].date;
            const last = dailyMap[sortedDates[sortedDates.length - 1]].date;
            const fmt = (d) => `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')}`;
            rangeEl.textContent = `${fmt(first)} - ${fmt(last)}`;
        }

        const areaUnit = companyPrefs.areaUnits || 'Acre';
        const labels = sortedDates.map((key, index) => {
            const b = dailyMap[key];
            const dateStr = `${b.date.getDate().toString().padStart(2, '0')}-${(b.date.getMonth() + 1).toString().padStart(2, '0')}`;
            return [dateStr, `Day ${index + 1}`];
        });
        const data = sortedDates.map(key => dailyMap[key].totalHarvest);

        const canvas = document.getElementById('harvestDailyChart');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');

        harvestDailyChartInstance = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Expected Production (Metric Tonnes)',
                    data: data,
                    backgroundColor: '#3b82f6',
                    barThickness: 45,
                    borderRadius: 4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                layout: { padding: { top: 70 } },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                const b = dailyMap[sortedDates[context.dataIndex]];
                                return [
                                    `Production: ${context.raw.toFixed(2)} Metric Tonnes`,
                                    `Plots: ${b.plots.length}`,
                                    `Area: ${b.totalArea.toFixed(2)} ${areaUnit}`
                                ];
                            }
                        }
                    }
                },
                scales: {
                    y: { display: true, beginAtZero: true, grid: { color: 'rgba(255, 255, 255, 0.05)' }, ticks: { color: 'var(--text-secondary)' } },
                    x: { ticks: { color: '#e2e8f0', font: { size: 10 } }, grid: { display: false } }
                },
                onClick: (e, elements) => {
                    if (elements.length > 0) {
                        const index = elements[0].index;
                        const key = sortedDates[index];
                        const b = dailyMap[key];
                        showHarvestWindowDailyPlots(`${key} (Day ${index + 1})`, b.plots);
                    }
                }
            },
            plugins: [{
                id: 'harvestDailyCustomLabels',
                afterDatasetsDraw: (chart) => {
                    const ctx = chart.ctx;
                    chart.data.datasets.forEach((dataset, i) => {
                        const meta = chart.getDatasetMeta(i);
                        meta.data.forEach((bar, index) => {
                            const val = dataset.data[index];
                            const b = dailyMap[sortedDates[index]];
                            ctx.font = 'bold 14px "Inter", sans-serif';
                            ctx.fillStyle = '#3b82f6';
                            ctx.textAlign = 'center';
                            if (val > 0) ctx.fillText(val.toFixed(2), bar.x, bar.y - 10);
                            
                            const bubbleText = `${b.plots.length} Plots, ${b.totalArea.toFixed(2)} ${areaUnit}`;
                            ctx.font = '10px "Inter", sans-serif';
                            const textWidth = ctx.measureText(bubbleText).width;
                            const bW = textWidth + 10;
                            const bH = 22;
                            const bX = bar.x - (bW / 2);
                            const bY = bar.y - 50;
                            ctx.fillStyle = '#f8fafc';
                            ctx.beginPath();
                            if (ctx.roundRect) ctx.roundRect(bX, bY, bW, bH, 4);
                            else ctx.rect(bX, bY, bW, bH);
                            ctx.fill();
                            ctx.beginPath();
                            ctx.moveTo(bar.x - 4, bY + bH);
                            ctx.lineTo(bar.x + 4, bY + bH);
                            ctx.lineTo(bar.x, bY + bH + 5);
                            ctx.closePath();
                            ctx.fill();
                            ctx.fillStyle = '#1e293b';
                            ctx.textAlign = 'center';
                            ctx.textBaseline = 'middle';
                            ctx.fillText(bubbleText, bar.x, bY + (bH / 2));
                        });
                    });
                }
            }]
        });

        const container = document.getElementById('harvest-window-daily-plots-container');
        if (container) container.classList.add('hidden');

    } catch (err) {
        console.error('[ERROR] Problem rendering Daily Harvest Chart:', err);
    }
}

function showHarvestWindowDailyPlots(label, plots) {
    const container = document.getElementById('harvest-window-daily-plots-container');
    const tbody = document.getElementById('harvest-window-daily-plots-tbody');
    const title = document.getElementById('harvest-window-daily-plots-title');

    if (!container || !tbody || !title) return;

    title.textContent = `Plots on ${label}: (${plots.length})`;
    
    tbody.innerHTML = '';
    if (plots.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="padding: 1rem; text-align: center; color: var(--text-secondary);">No plots on this day.</td></tr>';
    } else {
        plots.forEach(p => {
            const tr = document.createElement('tr');
            tr.style.borderBottom = '1px solid var(--border-color)';
            tr.innerHTML = `
                <td style="padding: 0.75rem; color: var(--text-primary); font-weight: 500;">${p.plotName}</td>
                <td style="padding: 0.75rem; color: var(--text-secondary);">${(p.auditedArea || 0).toFixed(2)}</td>
                <td style="padding: 0.75rem; color: var(--text-secondary);">${(p.expectedHarvestTon || 0).toFixed(2)}</td>
                <td style="padding: 0.75rem; color: var(--text-secondary);">${p.currentStage || "-"}</td>
                <td style="padding: 0.75rem; color: var(--text-secondary); font-weight: 600; color: var(--secondary-color);">${p.progression}%</td>
                <td style="padding: 0.75rem; color: var(--text-secondary);">${p.hStart || "-"}</td>
                <td style="padding: 0.75rem; color: var(--text-secondary);">${p.hEnd || "-"}</td>
            `;
            tbody.appendChild(tr);
        });
    }
    
    container.classList.remove('hidden');
    container.scrollIntoView({ behavior: 'smooth', block: 'center' });

    // Hide the other drill-downs if open
    const containers = ['growth-progression-plots-container', 'harvest-window-plots-container', 'harvest-window-daily-plots-container'];
    containers.forEach(id => {
        if (id !== container.id) {
            const other = document.getElementById(id);
            if (other) other.classList.add('hidden');
        }
    });
}

// --- Expose functions globally for HTML onclick handlers ---
window.showSourceTab = showSourceTab;
window.handleLogin = handleLogin;
window.handleLogout = handleLogout;
window.toggleMultiSelect = toggleMultiSelect;
window.sortProjectsToggle = sortProjectsToggle;
window.handleLoadPlots = handleLoadPlots;
window.navigatePlot = navigatePlot;
window.showAllPlotsModal = showAllPlotsModal;
window.closeAllPlotsModal = closeAllPlotsModal;
window.handleLoadGrowthData = handleLoadGrowthData;
window.closeGrowthDrillDown = closeGrowthDrillDown;
window.handleLoadHarvestStatus = handleLoadHarvestStatus;
window.clearHarvestFilter = clearHarvestFilter;
window.toggleGrowthTableVisibility = toggleGrowthTableVisibility;
window.resetGrowthTable = resetGrowthTable;
window.exportToExcel = () => exportToExcel(globalData, MASS_CONVERSIONS, AREA_CONVERSIONS, showPredictionAvailable);
window.exportDashboardToPDF = exportDashboardToPDF;
window.sortTable = sortTable;
window.handleGrowthTableSort = handleGrowthTableSort;
window.showHarvestWindowDailyPlots = showHarvestWindowDailyPlots;
window.showHarvestWindowPlots = showHarvestWindowPlots;
window.showGrowthProgressionPlots = showGrowthProgressionPlots;
