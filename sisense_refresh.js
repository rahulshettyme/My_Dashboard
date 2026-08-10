import { api } from './api.js';

// DOM Elements
const elements = {
    tenantSelect: document.getElementById('tenant-select'),
    generateTokenBtn: document.getElementById('generate-token-btn'),
    refreshBtn: document.getElementById('refresh-cube-btn'),
    statusBtn: document.getElementById('check-status-btn'),
    progressBarContainer: document.getElementById('cube-progress-container'),
    progressBar: document.getElementById('cube-progress-bar'),
    statusBadge: document.getElementById('cube-status-badge'),
    refreshStatusBadge: document.getElementById('refresh-status-badge'),
    lastOperation: document.getElementById('cube-last-operation'),
    terminalLogs: document.getElementById('terminal-logs'),
    clearTerminalBtn: document.getElementById('clear-terminal-btn')
};

// State
let state = {
    selectedTenant: '',
    selectedDatamodel: '',
    accessToken: '',
    isOperating: false,
    lastBuildId: '',
    cubes: []
};

// --- Initialization ---
async function init() {
    try {
        addLog('System', 'Fetching available tenants from database...', 'info');
        const db = await api.getDb();
        
        if (db && db.sisensecubes) {
            state.cubes = db.sisensecubes;
            const tenants = state.cubes.map(c => c.tenant).filter(Boolean);
            populateTenants(tenants);
            addLog('System', `Successfully loaded ${tenants.length} tenants from configuration.`, 'success');
        } else {
            throw new Error('sisensecubes array not found in database.');
        }
    } catch (err) {
        console.error('Failed to load tenants:', err);
        addLog('System', `Error loading tenants: ${err.message}. Please verify server status.`, 'error');
        elements.tenantSelect.innerHTML = '<option value="" disabled selected>Failed to load tenants</option>';
    }
}

// --- Helper: Logging ---
function addLog(source, message, type = 'info') {
    const logRow = document.createElement('div');
    logRow.className = 'log-row';

    const now = new Date();
    const timeString = now.toTimeString().split(' ')[0];

    const timeSpan = document.createElement('span');
    timeSpan.className = 'log-time';
    timeSpan.textContent = `[${timeString}] [${source}]`;

    const messageSpan = document.createElement('span');
    messageSpan.className = `log-${type}`;
    messageSpan.textContent = message;

    logRow.appendChild(timeSpan);
    logRow.appendChild(messageSpan);
    elements.terminalLogs.appendChild(logRow);
    
    // Auto-scroll to bottom of terminal
    elements.terminalLogs.scrollTop = elements.terminalLogs.scrollHeight;
}

// --- UI Actions: Populate Tenant dropdown ---
function populateTenants(tenants) {
    elements.tenantSelect.innerHTML = '<option value="" disabled selected>Select Tenant</option>';
    
    tenants.forEach(tenant => {
        const option = document.createElement('option');
        option.value = tenant;
        option.textContent = tenant;
        elements.tenantSelect.appendChild(option);
    });

    elements.tenantSelect.disabled = false;
}

// --- Event Listeners ---

// Tenant Select Change
elements.tenantSelect.addEventListener('change', (e) => {
    state.selectedTenant = e.target.value;
    
    if (state.selectedTenant) {
        const cube = state.cubes.find(c => c.tenant === state.selectedTenant);
        state.selectedDatamodel = cube ? cube.datamodelTitle : '';

        elements.generateTokenBtn.disabled = false;
        elements.refreshBtn.disabled = !state.accessToken;
        elements.statusBtn.disabled = !state.accessToken;
        
        // Clear terminal & reset status badge
        elements.terminalLogs.innerHTML = '';
        updateStatusBadge('idle');
        
        addLog('System', `Active tenant context updated to: "${state.selectedTenant}"`, 'info');
        if (state.selectedDatamodel) {
            addLog('System', `Datamodel UUID: "${state.selectedDatamodel}"`, 'info');
        }
        if (state.accessToken) {
            addLog('System', 'Cached access token is active and ready.', 'success');
        } else {
            addLog('System', 'Awaiting authentication. Please click "Generate Token" first.', 'warning');
        }
    }
});

// Generate Token Handler
elements.generateTokenBtn.addEventListener('click', async () => {
    if (state.isOperating) return;

    state.isOperating = true;
    toggleControls(false);
    
    addLog('API', 'Generating access token...', 'info');
    elements.progressBarContainer.style.display = 'block';
    elements.progressBar.style.width = '30%';
    elements.progressBar.style.background = 'linear-gradient(to right, var(--primary-color), #c084fc)';

    try {
        const response = await api.loginSisense();
        elements.progressBar.style.width = '70%';
        
        if (response.ok) {
            const loginData = await response.json();
            const token = loginData.access_token;
            if (token) {
                state.accessToken = token;
                elements.progressBar.style.width = '100%';
                addLog('API', 'Token generated successfully.', 'success');
                addLog('API', `Access Token: ${token.substring(0, 15)}... [cached]`, 'success');
            } else {
                throw new Error('Access token not found in login response.');
            }
        } else {
            const errText = await response.text();
            throw new Error(`Auth failed (${response.status}): ${errText}`);
        }
    } catch (err) {
        console.error('Failed to generate token:', err);
        addLog('System', `Error: ${err.message}`, 'error');
        elements.progressBar.style.width = '100%';
        elements.progressBar.style.background = 'var(--danger-color)';
    } finally {
        state.isOperating = false;
        toggleControls(true);
    }
});

// Clear terminal logs
elements.clearTerminalBtn.addEventListener('click', () => {
    elements.terminalLogs.innerHTML = '';
    addLog('System', 'Terminal logs cleared.', 'info');
});

// Refresh Cube Handler
elements.refreshBtn.addEventListener('click', async () => {
    if (state.isOperating || !state.selectedTenant) return;

    state.isOperating = true;
    toggleControls(false);
    updateStatusBadge('running');
    
    // Visual Progress Bar Reset
    elements.progressBarContainer.style.display = 'block';
    elements.progressBar.style.width = '0%';
    elements.progressBar.style.background = 'linear-gradient(to right, var(--primary-color), #c084fc)';

    const tenant = state.selectedTenant;
    const datamodel = state.selectedDatamodel;
    addLog('API', `Initiating cube rebuild request for tenant: "${tenant}"...`, 'info');
    if (datamodel) {
        addLog('API', `Using Datamodel UUID: "${datamodel}"`, 'info');
    }

    addLog('API', 'Connecting to backend service...', 'info');
    elements.progressBar.style.width = '30%';

    try {
        const response = await api.refreshCube(tenant, datamodel, state.accessToken);
        elements.progressBar.style.width = '70%';

        const isSuccess = response.ok;
        const status = response.status;
        const responseData = await response.json().catch(() => null);

        elements.progressBar.style.width = '100%';
        addLog('API', `Response received (Status: ${status})`, isSuccess ? 'success' : 'error');

        // Show the entire raw JSON response in the log console
        if (responseData) {
            const formattedJson = JSON.stringify(responseData, null, 4);
            formattedJson.split('\n').forEach(line => {
                addLog('Response', line, isSuccess ? 'info' : 'error');
            });

            // Extract and track the build ID (oid) from the response
            if (isSuccess && responseData.oid) {
                state.lastBuildId = responseData.oid;
                addLog('System', `Tracking build reference ID: ${state.lastBuildId}`, 'success');
            }
        } else {
            addLog('API', 'No JSON payload in response body.', 'warning');
        }

        if (isSuccess) {
            updateStatusBadge('success');
            const now = new Date();
            elements.lastOperation.textContent = `Success at ${now.toLocaleTimeString()}`;
        } else {
            elements.progressBar.style.background = 'var(--danger-color)';
            updateStatusBadge('failed');
            const now = new Date();
            elements.lastOperation.textContent = `Failed at ${now.toLocaleTimeString()}`;
        }
    } catch (err) {
        console.error('Error triggering cube refresh:', err);
        addLog('System', `Network or Server Error: ${err.message}`, 'error');
        elements.progressBar.style.width = '100%';
        elements.progressBar.style.background = 'var(--danger-color)';
        updateStatusBadge('failed');
        const now = new Date();
        elements.lastOperation.textContent = `Failed at ${now.toLocaleTimeString()}`;
    } finally {
        state.isOperating = false;
        toggleControls(true);
    }
});

// Check Status Handler
elements.statusBtn.addEventListener('click', async () => {
    if (state.isOperating || !state.selectedTenant) return;

    state.isOperating = true;
    toggleControls(false);
    
    const tenant = state.selectedTenant;
    const datamodel = state.selectedDatamodel;

    addLog('API', `Querying build status for tenant: "${tenant}"...`, 'info');
    if (datamodel) {
        addLog('API', `Using Datamodel UUID: "${datamodel}"`, 'info');
    }

    try {
        const response = await api.checkStatus(tenant, datamodel, state.accessToken);
        const isSuccess = response.ok;
        const status = response.status;
        const responseData = await response.json().catch(() => null);

        addLog('API', `Status Response received (Status: ${status})`, isSuccess ? 'success' : 'error');

        // Show the entire raw JSON response in the log console
        if (responseData) {
            const formattedJson = JSON.stringify(responseData, null, 4);
            formattedJson.split('\n').forEach(line => {
                addLog('Response', line, isSuccess ? 'success' : 'error');
            });

            // Update status badge dynamically based on response status array or lastBuildStatus
            if (responseData.status && Array.isArray(responseData.status)) {
                const cubeStatus = responseData.status[0] || 'idle';
                const refreshStatus = responseData.status[1] || '-';
                updateStatusBadge(cubeStatus, refreshStatus);
            } else if (responseData.lastBuildStatus === 'succeeded' || responseData.lastBuildStatus === 'success') {
                updateStatusBadge('success');
            } else if (responseData.lastBuildStatus === 'failed') {
                updateStatusBadge('failed');
            } else {
                updateStatusBadge('idle');
            }
            
            const now = new Date();
            elements.lastOperation.textContent = `Status checked at ${now.toLocaleTimeString()}`;
        } else {
            addLog('API', 'No JSON payload in status response body.', 'warning');
        }
    } catch (err) {
        console.error('Error checking status:', err);
        addLog('System', `Network or Server Error: ${err.message}`, 'error');
    } finally {
        state.isOperating = false;
        toggleControls(true);
    }
});

// Helper to update individual badge style
function updateBadge(badgeElement, status) {
    if (!badgeElement) return;
    badgeElement.className = 'badge';
    badgeElement.textContent = status || '-';

    const normalized = (status || '').toLowerCase();
    if (normalized === 'idle' || normalized === '-') {
        badgeElement.classList.add('badge-idle');
    } else if (normalized === 'running' || normalized === 'building') {
        badgeElement.classList.add('badge-running');
    } else if (normalized === 'success' || normalized === 'succeeded' || normalized === 'completed') {
        badgeElement.classList.add('badge-success');
    } else if (normalized === 'failed' || normalized === 'error') {
        badgeElement.classList.add('badge-failed');
    } else {
        badgeElement.classList.add('badge-idle');
    }
}

// Helper to update status badges
function updateStatusBadge(cubeStatus, refreshStatus) {
    if (arguments.length === 1) {
        if (cubeStatus === 'idle') {
            updateBadge(elements.statusBadge, 'idle');
            updateBadge(elements.refreshStatusBadge, '-');
        } else if (cubeStatus === 'running') {
            updateBadge(elements.statusBadge, 'running');
            updateBadge(elements.refreshStatusBadge, 'building');
        } else if (cubeStatus === 'success') {
            updateBadge(elements.statusBadge, 'success');
            updateBadge(elements.refreshStatusBadge, '-');
        } else if (cubeStatus === 'failed') {
            updateBadge(elements.statusBadge, 'failed');
            updateBadge(elements.refreshStatusBadge, '-');
        } else {
            updateBadge(elements.statusBadge, cubeStatus);
            updateBadge(elements.refreshStatusBadge, '-');
        }
    } else {
        updateBadge(elements.statusBadge, cubeStatus);
        updateBadge(elements.refreshStatusBadge, refreshStatus);
    }
}

// Enable/disable controls during operation
function toggleControls(enable) {
    elements.tenantSelect.disabled = !enable;
    elements.generateTokenBtn.disabled = !enable;
    elements.refreshBtn.disabled = !(enable && state.accessToken && state.selectedTenant);
    elements.statusBtn.disabled = !(enable && state.accessToken && state.selectedTenant);
}

// Run initializer
init();
