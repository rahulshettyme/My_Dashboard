document.addEventListener('DOMContentLoaded', () => {
    // Shared State
    let authToken = null;
    let currentEnv = null;
    let apiConfigs = [];
    let selectedApis = [];
    let availableUnits = [];

    // DOM Elements
    const trigger = document.getElementById('api-select-trigger');
    const dropdown = document.getElementById('api-select-dropdown');
    const triggerText = document.getElementById('api-select-text');
    const testSection = document.getElementById('api-test-section');
    const unitsList = document.getElementById('units-list');
    const selectedApisBody = document.getElementById('selected-apis-body');

    // 0. Load APIs Immediately
    loadApiList();

    // Initialize Login
    const loginComponent = new LoginComponent('login-container', {
        apiEndpoint: 'http://localhost:3000/api/user-aggregate/token',
        onLoginSuccess: (token, userDetails) => {
            console.log('Login Successful:', userDetails);
            authToken = token;
            currentEnv = userDetails.environment;
            fetchAreaUnits();
        },
        onLogout: () => {
            console.log('Logged Out');
            authToken = null;
            currentEnv = null;
            availableUnits = [];
            unitsList.innerHTML = 'Waiting for login...';
        }
    });

    // --- Feature 1: Fetch Area Units ---
    async function fetchAreaUnits() {
        unitsList.innerHTML = 'Loading units...';
        availableUnits = [];
        try {
            const url = `http://localhost:3000/api/user-aggregate/master/constants?environment=${encodeURIComponent(currentEnv)}&name=areaunit&size=5000`;
            const response = await fetch(url, { headers: { 'Authorization': `Bearer ${authToken}` } });
            if (!response.ok) throw new Error('Failed to fetch units');

            const data = await response.json();
            const records = Array.isArray(data) ? data : (data.content || []);

            if (records.length === 0) {
                unitsList.innerHTML = 'No area units found.';
                return;
            }

            availableUnits = records.map(r => {
                let raw = r.name || r.value || (typeof r === 'string' ? r : JSON.stringify(r));
                if (typeof raw === 'string') raw = raw.replace(/^"|"$/g, '');
                return raw;
            });

            const displayNames = availableUnits.map(u => formatUnitName(u)).join(', ');
            unitsList.textContent = displayNames;

        } catch (error) {
            console.error('Error fetching area units:', error);
            unitsList.innerHTML = `<span style="color:red;">Error: ${error.message}</span>`;
        }
    }

    const methodSelect = document.getElementById('method-select');

    // --- Feature 2: generic API Selection ---
    async function loadApiList() {
        try {
            const response = await fetch('api_config.json');
            apiConfigs = await response.json();

            // Initial render based on default method (GET)
            filterAndRenderApis();

            // Listen for method changes
            methodSelect.addEventListener('change', () => {
                // Clear selected APIs when switching methods to avoid confusion? 
                // Alternatively, keep them but they might be hidden. 
                // Let's clear them for cleaner state.
                selectedApis = [];
                updateTriggerText();
                renderTableRows();

                filterAndRenderApis();
            });

        } catch (error) {
            console.error(error);
            dropdown.innerHTML = '<div style="padding:1rem; color:red;">Failed to load APIs</div>';
        }
    }

    function filterAndRenderApis() {
        const selectedMethod = methodSelect.value;
        const filteredConfigs = apiConfigs.filter(config => config.method === selectedMethod);
        renderApiDropdown(filteredConfigs);
    }

    function renderApiDropdown(configs) {
        dropdown.innerHTML = '';
        if (configs.length === 0) {
            dropdown.innerHTML = '<div style="padding:1rem;">No APIs found for ' + methodSelect.value + '</div>';
            return;
        }

        configs.forEach(config => {
            const apiName = config.name;
            const item = document.createElement('div');
            item.className = 'dropdown-item';

            // Check if already selected (persisting selection across filters would be tricky if we cleared it, 
            // but since we cleared selectedApis above, this starts fresh for the new method)
            const isSelected = selectedApis.some(a => a.name === apiName);

            item.innerHTML = `
                <input type="checkbox" id="api-${apiName}" ${isSelected ? 'checked' : ''} style="pointer-events: none;">
                <label style="cursor:pointer; flex:1; pointer-events: none;">${apiName}</label>
            `;

            item.addEventListener('click', (e) => {
                e.stopPropagation();
                const cb = item.querySelector('input');
                cb.checked = !cb.checked;
                toggleApiSelection(config, cb.checked);
            });

            dropdown.appendChild(item);
        });
    }

    function toggleApiSelection(config, isSelected) {
        if (isSelected) {
            if (!selectedApis.some(a => a.name === config.name)) selectedApis.push(config);
        } else {
            selectedApis = selectedApis.filter(a => a.name !== config.name);
        }
        updateTriggerText();
        renderTableRows();
    }

    function updateTriggerText() {
        if (selectedApis.length === 0) {
            triggerText.textContent = 'Select APIs...';
            triggerText.style.color = 'var(--text-secondary)';
            testSection.classList.add('hidden');
        } else {
            triggerText.textContent = `${selectedApis.length} API(s) Selected`;
            triggerText.style.color = 'var(--text-primary)';
            testSection.classList.remove('hidden');
        }
    }

    // --- Feature 3: Generic Table & Test Logic ---
    function renderTableRows() {
        selectedApisBody.innerHTML = '';

        selectedApis.forEach((config, index) => {
            const tr = document.createElement('tr');
            tr.style.borderBottom = '1px solid var(--border-color)';

            const inputId = `id-input-${index}`;
            const btnId = `run-btn-${index}`;
            const resultsId = `results-${index}`;

            tr.innerHTML = `
                <td style="padding: 1rem; color: var(--text-primary); font-weight: 500;">${config.name}</td>
                <td style="padding: 1rem;">
                    <input type="text" id="${inputId}" placeholder="ID..." 
                        style="width: 100%; padding: 0.5rem; border-radius: 4px; border: 1px solid var(--border-color); background: var(--input-bg);">
                </td>
                <td style="padding: 1rem;">
                    <button id="${btnId}" class="btn-primary" style="padding: 0.5rem 1rem; font-size: 0.9rem;">Run Test</button>
                </td>
                <td style="padding: 1rem;">
                    <div id="${resultsId}" style="font-size: 0.85rem; color: var(--text-secondary); max-height: 300px; overflow-y: auto;">
                        Click Run to test.
                    </div>
                </td>
            `;

            selectedApisBody.appendChild(tr);

            const btn = tr.querySelector(`#${btnId}`);
            btn.addEventListener('click', () => runGenericTest(config, index));
        });
    }

    async function runGenericTest(config, index) {
        if (!authToken) {
            alert('Please login first to run tests.');
            document.getElementById('login-container').scrollIntoView({ behavior: 'smooth' });
            return;
        }

        const input = document.getElementById(`id-input-${index}`);
        const resultDiv = document.getElementById(`results-${index}`);
        const searchId = input.value.trim();

        if (!searchId) {
            alert('Please provide an ID');
            return;
        }

        if (availableUnits.length === 0) {
            resultDiv.innerHTML = '<span style="color:orange">No Area Units available. Please wait for them to load.</span>';
            return;
        }

        resultDiv.innerHTML = 'Starting tests...<br>';
        console.log(`[GenericRunner] Starting ${config.name} for ID: ${searchId}`);

        // --- LOOP THROUGH UNITS ---
        for (const unit of availableUnits) {
            const unitDisplay = formatUnitName(unit);
            const resultLine = document.createElement('div');
            resultLine.textContent = `[${unitDisplay}]: Testing...`;
            resultDiv.appendChild(resultLine);

            try {
                // --- PROXY URL CONSTRUCTION ---
                let upstreamPath = config.endpoint; // e.g. /services/farm/api/farmers

                // Modify upstream path based on logic type (e.g. append ID for search)
                if (config.logicType === 'search' && config.paramType === 'path') {
                    upstreamPath = `${upstreamPath}/${searchId}`;
                }

                // Construct Proxy URL: /api/test-proxy
                let proxyUrl = new URL('http://localhost:3000/api/test-proxy');
                proxyUrl.searchParams.append('environment', currentEnv);
                proxyUrl.searchParams.append('targetPath', upstreamPath);
                proxyUrl.searchParams.append('ts', Date.now());

                // Add static params (like size=5000) to the proxy URL (forwarded to upstream)
                if (config.staticParams) {
                    for (const [key, val] of Object.entries(config.staticParams)) {
                        proxyUrl.searchParams.append(key, val);
                    }
                }

                // For 'list' params, we rely on the staticParams + extraction logic.

                const response = await fetch(proxyUrl, {
                    headers: { 'Authorization': `Bearer ${authToken}`, 'X-Response-Unit': unit }
                });

                if (!response.ok) {
                    const txt = await response.text();
                    throw new Error(`Status ${response.status} - ${txt}`);
                }

                const data = await response.json();
                let foundItem = null;
                let itemCount = 0;

                // --- DATA EXTRACTION STRATEGY ---
                if (config.logicType === 'list') {
                    // Filter in memory
                    const listData = Array.isArray(data) ? data
                        : (data.content || data.data || []);

                    itemCount = listData.length;

                    // Flexible matching (String coercion)
                    foundItem = listData.find(item => String(getNestedValue(item, config.idMatchKey)) === String(searchId));
                } else {
                    // Expecting direct object
                    foundItem = data;
                    itemCount = 1;
                }

                if (foundItem) {
                    let displayParts = [];

                    // Case A: Multiple Extractions
                    if (config.extractions && Array.isArray(config.extractions)) {
                        config.extractions.forEach(ext => {
                            const val = getNestedValue(foundItem, ext.path);
                            // Format Value: if object stringify, else show. Handle nulls.
                            const valStr = (val !== undefined && val !== null)
                                ? ((typeof val === 'object') ? JSON.stringify(val) : val)
                                : '-';

                            displayParts.push(`<span style="color:#9ca3af;">${ext.label}: <strong style="color:#e5e7eb;">${valStr}</strong></span>`);
                        });
                    }
                    // Case B: Single Extraction
                    else if (config.extractionPath) {
                        const val = getNestedValue(foundItem, config.extractionPath);
                        const valStr = (val !== undefined && val !== null)
                            ? ((typeof val === 'object') ? JSON.stringify(val) : val)
                            : '-';
                        displayParts.push(`<span style="color:#9ca3af;">Value: <strong style="color:#e5e7eb;">${valStr}</strong></span>`);
                    } else {
                        displayParts.push('<span style="color:#9ca3af;">Record Found</span>');
                    }

                    // Format: [Unit Name (Bold)] [Flex values separated by pipe]
                    const valuesHtml = displayParts.join('<span style="color:#4b5563; margin:0 8px;">|</span>');

                    resultLine.style.padding = '6px 0';
                    resultLine.style.borderBottom = '1px solid #374151'; // Darker border
                    resultLine.innerHTML = `
                        <div style="display:flex; align-items:center;">
                            <span style="font-weight:600; color:#f3f4f6; min-width:140px;">${unitDisplay}</span>
                            <div style="flex:1; margin-left:10px; font-size:0.9em;">
                                ${valuesHtml}
                            </div>
                        </div>
                    `;
                } else {
                    // Not Found
                    resultLine.innerHTML = `
                        <div style="display:flex; align-items:center; padding:6px 0; border-bottom:1px solid #374151;">
                            <span style="font-weight:600; color:#f3f4f6; min-width:140px;">${unitDisplay}</span>
                            <span style="color:orange; font-size:0.9em;">ID Not Found <span style="color:#6b7280; font-size:0.85em;">(Checked ${itemCount})</span></span>
                        </div>
                     `;
                }

            } catch (err) {
                console.error(err);
                resultLine.innerHTML = `[${unitDisplay}]: <span style="color:red">Failed</span> (${err.message})`;
            }
        }

        const finalDiv = document.createElement('div');
        finalDiv.innerHTML = `<strong>Done. Tested ${availableUnits.length} units.</strong>`;
        resultDiv.appendChild(finalDiv);
    }

    // --- UTILS ---
    function formatUnitName(unit) {
        if (!unit) return '';
        return unit.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
    }

    function getNestedValue(obj, path) {
        if (!path) return undefined;
        return path.split('.').reduce((acc, part) => acc && acc[part], obj);
    }

    // UI Toggle
    trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        dropdown.classList.toggle('show');
    });

    document.addEventListener('click', (e) => {
        if (!trigger.contains(e.target) && !dropdown.contains(e.target)) {
            dropdown.classList.remove('show');
        }
    });
});
