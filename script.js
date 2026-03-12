import { api } from './api.js';

// DOM Elements
const elements = {
    envSelect: document.getElementById('environment'),
    tenantSelect: document.getElementById('tenant'),
    userSelect: document.getElementById('user'),
    userSelectWrapper: document.querySelector('.user-select-wrapper'),
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
    deleteTenantBtn: document.getElementById('delete-tenant-btn'),
    featureSelect: document.getElementById('feature-select'),
    proceedBtn: document.getElementById('proceed-btn')

};

// State
let state = {
    environmentUrls: {},
    users: [],
    loading: true
};

// --- Initialization ---
// --- Initialization ---
async function init() {
    try {
        const data = await api.getDb();
        state.environmentUrls = data.environment_urls;
        state.users = data.users;
        renderEnvironments();
        state.loading = false;

    } catch (err) {
        console.error('Failed to load data:', err);
        alert('Failed to connect to server. Ensure "npm start" is running.');
    }
}





// --- Render Logic ---
function renderEnvironments() {
    // Main UI
    elements.envSelect.innerHTML = '<option value="" disabled selected>Select Environment</option>';
    elements.modalEnv.innerHTML = '<option value="" disabled selected>Select Environment</option>';

    Object.keys(state.environmentUrls).forEach(env => {
        // Main Dropdown
        const option = document.createElement('option');
        option.value = env;
        option.textContent = env;
        elements.envSelect.appendChild(option);

        // Modal Dropdown
        const modalOption = option.cloneNode(true);
        elements.modalEnv.appendChild(modalOption);
    });
}

function renderTenants(environment, targetSelect) {
    targetSelect.innerHTML = '<option value="" disabled selected>Select Tenant</option>';

    // Filter users to find unique tenants in this environment
    const usersInEnv = state.users.filter(u => u.environment === environment);
    const tenants = [...new Set(usersInEnv.map(u => u.tenant))];

    tenants.forEach(tenant => {
        const option = document.createElement('option');
        option.value = tenant;
        option.textContent = tenant;
        targetSelect.appendChild(option);
    });

    // If rendering for modal, add the "Add New" option
    if (targetSelect === elements.modalTenantSelect) {
        const addNewOpt = document.createElement('option');
        addNewOpt.value = 'new';
        addNewOpt.textContent = '+ Add New Tenant';
        targetSelect.appendChild(addNewOpt);
    }
}

function renderUsers(environment, tenant) {
    elements.userSelect.innerHTML = '<option value="" disabled selected>Select User</option>';

    const relevantUsers = state.users.filter(u =>
        u.environment === environment && u.tenant === tenant
    );

    relevantUsers.forEach(user => {
        const option = document.createElement('option');
        option.value = user.id; // Value is ID now
        option.textContent = user.username;
        elements.userSelect.appendChild(option);
    });

    elements.userSelect.disabled = false;
    updateUserActionsVisibility();
}

function updateUserActionsVisibility() {
    const hasUser = elements.userSelect.value && elements.userSelect.value !== "";
    elements.userActions.style.display = hasUser ? 'flex' : 'none';
}

// --- Event Listeners: Main UI ---
elements.envSelect.addEventListener('change', (e) => {
    const env = e.target.value;
    elements.tenantSelect.disabled = false;
    elements.userSelect.disabled = true;
    elements.userSelect.innerHTML = '<option value="" disabled selected>Select User</option>';
    renderTenants(env, elements.tenantSelect);
    updateUserActionsVisibility();
});

elements.tenantSelect.addEventListener('change', (e) => {
    const env = elements.envSelect.value;
    const tenant = e.target.value;
    renderUsers(env, tenant);
});

elements.userSelect.addEventListener('change', () => {
    updateUserActionsVisibility();
});

elements.loginBtn.addEventListener('click', () => {
    const env = elements.envSelect.value;
    const userId = elements.userSelect.value;
    const url = state.environmentUrls[env];

    if (!env || !userId) {
        alert('Please select Environment, Tenant, and User.');
        return;
    }

    const user = state.users.find(u => u.id === userId);
    // Use tenant from selection (which should match user's tenant since we filter users by tenant)
    // But to be safe and consistent with previous logic, we can use the selected tenant directly.
    const tenant = elements.tenantSelect.value;

    if (user && url && tenant) {
        // Rollback: Manual Login Helper
        // 1. Copy password to clipboard
        navigator.clipboard.writeText(user.password).then(() => {
            console.log('Password copied to clipboard');
        }).catch(err => {
            console.error('Failed to copy password:', err);
        });

        // 2. Construct specific SSO Deep Link (Keycloak)
        // Template: https://v2sso-gcp.cropin.co.in/auth/realms/<tenant>/protocol/openid-connect/auth...

        // Ensure no trailing slash on base URL before appending //code
        const cleanBaseUrl = url.replace(/\/$/, '');

        const ssoUrl = `https://v2sso-gcp.cropin.co.in/auth/realms/${tenant}/protocol/openid-connect/auth?response_type=token&client_id=web_app&clientType=web&nonce=_client_web_app&scope=openid%20address%20email%20microprofile-jwt%20offline_access%20phone%20profile%20roles%20web-origins&state=_ArjN_vyDLyeShRr2XK-6wOHt1C1SeaDn1gM8QNnFGE%3D&redirect_uri=${cleanBaseUrl}//code?tenant=${tenant}_U2FsdGVkX1%252FGfAJN4WCu6xwmJPJdhq3l2bZkDVT7c5o%253D`;

        // DEBUG: Log the values
        console.log('Generating SSO URL...');
        console.log('Tenant:', tenant);
        console.log('Base URL:', cleanBaseUrl);
        console.log('Target SSO URL:', ssoUrl);

        // Automation V4: Puppeteer Backend Launch (Reliable)
        // We comment out window.open because Puppeteer will launch its own window.
        // window.open(ssoUrl, '_blank').focus();

        // Trigger Puppeteer Logic
        api.launchIncognito({
            environment: env,
            url: url,
            tenant: tenant,
            username: user.username,
            password: user.password
        }).catch(err => {
            console.error('Failed to launch automation:', err);
            // Fallback: Open manually if backend fails
            window.open(ssoUrl, '_blank').focus();
        });
    }
});


// --- Event Listeners: Modal & CRUD ---
function openModal(mode, user = null) {
    elements.modal.style.display = 'block';

    // Reset Form
    elements.userForm.reset();
    elements.modalTenantInput.style.display = 'none';

    if (mode === 'edit' && user) {
        elements.modalTitle.textContent = 'Edit User';
        elements.deleteUserBtn.style.display = 'block';

        elements.userIdInput.value = user.id;
        elements.modalEnv.value = user.environment;

        // Trigger render tenants for this env
        renderTenants(user.environment, elements.modalTenantSelect);
        elements.modalTenantSelect.value = user.tenant;
        elements.deleteTenantBtn.style.display = 'block'; // Show delete tenant button

        elements.modalUsername.value = user.username;
        elements.modalPassword.value = user.password;
    } else {
        elements.modalTitle.textContent = 'Add New User';
        elements.deleteUserBtn.style.display = 'none';
        elements.deleteTenantBtn.style.display = 'none';
    }
}

function closeModal() {
    elements.modal.style.display = 'none';
}

elements.addUserBtn.addEventListener('click', () => openModal('add'));
elements.closeModal.addEventListener('click', closeModal);
window.addEventListener('click', (e) => { if (e.target === elements.modal) closeModal(); });

elements.modalEnv.addEventListener('change', (e) => {
    renderTenants(e.target.value, elements.modalTenantSelect);
});

elements.modalTenantSelect.addEventListener('change', (e) => {
    if (e.target.value === 'new') {
        elements.modalTenantInput.style.display = 'block';
        elements.modalTenantInput.required = true;
        elements.modalTenantInput.focus();
        elements.deleteTenantBtn.style.display = 'none';
    } else {
        elements.modalTenantInput.style.display = 'none';
        elements.modalTenantInput.required = false;
        elements.deleteTenantBtn.style.display = 'block';
    }
});

elements.userForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = elements.userIdInput.value;
    const environment = elements.modalEnv.value;
    let tenant = elements.modalTenantSelect.value;
    const username = elements.modalUsername.value;
    const password = elements.modalPassword.value;

    if (tenant === 'new') {
        tenant = elements.modalTenantInput.value;
        if (!tenant) return alert('Please enter a tenant name');
    }

    const userData = { environment, tenant, username, password };

    try {
        if (id) {
            await api.updateUser(id, userData);
        } else {
            await api.createUser(userData);
        }

        // Refresh Data
        const data = await api.getDb();
        state.users = data.users;

        // Refresh UI
        const currentEnv = elements.envSelect.value;
        if (currentEnv) {
            renderTenants(currentEnv, elements.tenantSelect);
            // Clear selection as requested
            elements.tenantSelect.value = "";
            elements.userSelect.innerHTML = '<option value="" disabled selected>Select User</option>';
            elements.userSelect.disabled = true;
            updateUserActionsVisibility();
        }

        closeModal();
    } catch (err) {
        console.error('Error saving user:', err);
        alert('Failed to save user.');
    }
});

// Edit & Delete handlers
elements.editUserBtn.addEventListener('click', (e) => {
    e.preventDefault(); // Prevent accidental form submit if inside form
    const userId = elements.userSelect.value;
    if (!userId) return;
    const user = state.users.find(u => u.id === userId);
    openModal('edit', user);
});

// Delete User (Inside Modal)
elements.deleteUserBtn.addEventListener('click', async () => {
    const userId = elements.userIdInput.value;
    if (!userId) return;

    if (userId) {
        try {
            await api.deleteUser(userId);
            const data = await api.getDb();
            state.users = data.users;

            // Refresh UI
            const currentEnv = elements.envSelect.value;
            if (currentEnv) renderTenants(currentEnv, elements.tenantSelect);
            elements.tenantSelect.value = "";
            elements.userSelect.innerHTML = '<option value="" disabled selected>Select User</option>';
            elements.userSelect.disabled = true;
            updateUserActionsVisibility();

            closeModal();
        } catch (err) {
            console.error('Error deleting user:', err);
            alert('Failed to delete user.');
        }
    }
});

// Delete Tenant (Inside Modal)
elements.deleteTenantBtn.addEventListener('click', async () => {
    const environment = elements.modalEnv.value;
    const tenant = elements.modalTenantSelect.value;

    if (!environment || !tenant || tenant === 'new') return;

    try {
        await api.deleteTenant(environment, tenant);
        const data = await api.getDb();
        state.users = data.users;

        // Refresh Modal - tenant list
        renderTenants(environment, elements.modalTenantSelect);
        elements.modalTenantSelect.value = "";
        elements.deleteTenantBtn.style.display = 'none';

        // Refresh Main UI
        const currentEnv = elements.envSelect.value;
        if (currentEnv === environment) {
            renderTenants(currentEnv, elements.tenantSelect);
            elements.tenantSelect.value = "";
            elements.userSelect.innerHTML = '<option value="" disabled selected>Select User</option>';
            elements.userSelect.disabled = true;
            updateUserActionsVisibility();
        }

    } catch (err) {
        console.error('Error deleting tenant:', err);
        alert('Failed to delete tenant.');
    }
});

// Refresh Button Removed



// --- Data Testing Logic ---
if (elements.proceedBtn) {
    elements.proceedBtn.addEventListener('click', () => {
        const feature = elements.featureSelect.value;
        if (feature) {
            window.location.href = feature;
        } else {
            alert('Please select a feature');
        }
    });
}

init();
