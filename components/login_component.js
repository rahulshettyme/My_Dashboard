
class LoginComponent {
    constructor(containerId, options = {}) {
        this.container = document.getElementById(containerId);
        this.onLoginSuccess = options.onLoginSuccess || (() => { });
        this.onLoginFail = options.onLoginFail || (() => { });
        this.onLogout = options.onLogout || (() => { });
        this.apiEndpoint = options.apiEndpoint || '/api/user-aggregate/token';
        this.envList = options.envList || []; // Default empty, will fetch
        this.initialState = options.initialState || null;

        // Render loading state first
        this.render();

        // Fetch dynamic environment list
        this.fetchEnvironments().then(() => {
            // Re-render with populated list
            this.render();
            this.attachEvents(); // Re-attach events to new DOM
            if (this.initialState) {
                this.restoreSession(this.initialState);
            }
        });
    }

    async fetchEnvironments() {
        try {
            const res = await fetch('http://localhost:3000/api/db');
            if (res.ok) {
                const db = await res.json();
                // Extract environments from sso_urls_prefix keys (excluding 'default' ones)
                // OR from environment_urls
                const ssoKeys = Object.keys(db.sso_urls_prefix || {}).filter(k => !k.startsWith('default'));
                const urlKeys = Object.keys(db.environment_urls || {});

                // Merge and dedup
                const allEnvs = [...new Set([...ssoKeys, ...urlKeys])].sort();

                if (allEnvs.length > 0) {
                    this.envList = allEnvs;
                } else {
                    // Fallback if DB empty
                    this.envList = ["QA1", "QA2", "QA3", "QA4", "QA5", "QA6", "QA7", "QA8", "Prod"];
                }
            } else {
                console.error("Failed to fetch DB for environments");
                this.envList = ["QA1", "QA2", "QA3", "QA4", "QA5", "QA6", "QA7", "QA8", "Prod"];
            }
        } catch (e) {
            console.error("Error fetching environments:", e);
            this.envList = ["QA1", "QA2", "QA3", "QA4", "QA5", "QA6", "QA7", "QA8", "Prod"];
        }
    }

    restoreSession(state) {
        // 0. HARDENED CHECK: If no token, logout immediately.
        if (!state || !state.access_token) {
            console.warn("Restore Session: No access token found. Logging out.");
            this.onLogout();
            return;
        }

        // Validate Token Expiry
        if (state && state.access_token) {
            try {
                let base64Url = state.access_token.split('.')[1];
                let base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
                let jsonPayload = decodeURIComponent(atob(base64).split('').map(function (c) {
                    return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
                }).join(''));

                const payload = JSON.parse(jsonPayload);
                const exp = payload.exp * 1000; // to ms
                const now = Date.now();

                if (now > exp) {
                    console.warn("Session expired. Clearing.");
                    this.onLogout();
                    return;
                }
            } catch (e) {
                console.error("Token validation failed. Forcing logout.", e);
                this.onLogout();
                return;
            }
        }

        const formView = this.container.querySelector('#lc-view-form');
        const successView = this.container.querySelector('#lc-view-logged-in');

        // Update UI
        if (formView) formView.style.display = 'none';
        if (successView) {
            successView.style.display = 'block';
            this.container.querySelector('#lc-display-user').innerText = state.username || 'User';
            this.container.querySelector('#lc-display-env').innerText = state.environment ? `${state.environment} (${state.tenant || ''})` : 'Restored Session';
        }
    }

    render() {
        if (!this.container) return;

        // Initial View: Form
        this.container.innerHTML = `
            <div id="lc-view-form" class="login-component-wrapper">
                <div class="lc-row">
                    <div class="lc-form-group">
                        <label>Environment</label>
                        <div class="lc-custom-dropdown" id="lc-env-dropdown">
                            <div class="lc-dropdown-display" id="lc-env-display">
                                ${this.envList.length > 0 ? 'Select Environment' : 'Loading...'}
                            </div>
                            <input type="hidden" id="lc-env-input">
                            <div class="lc-dropdown-menu">
                                <ul class="lc-dropdown-list">
                                    ${this.envList.map(env => `<li class="lc-dropdown-item" data-value="${env}">${env}</li>`).join('')}
                                </ul>
                            </div>
                        </div>
                    </div>
                    <div class="lc-form-group">
                        <label>Tenant</label>
                        <input type="text" id="lc-tenant" class="lc-input" placeholder="e.g. sf_plus_qazone2">
                    </div>
                </div>
                <div class="lc-row">
                    <div class="lc-form-group">
                        <label>Username</label>
                        <input type="text" id="lc-username" class="lc-input">
                    </div>
                    <div class="lc-form-group">
                        <label>Password</label>
                        <input type="password" id="lc-password" class="lc-input">
                    </div>
                </div>
                <button id="lc-login-btn" class="lc-btn">Login</button>
                <div id="lc-error" class="lc-error hidden"></div>
            </div>

            <div id="lc-view-logged-in" class="login-component-wrapper" style="display:none; text-align: center;">
                 <div style="background: rgba(16, 185, 129, 0.1); border: 1px solid #10b981; border-radius: 8px; padding: 1rem; margin-bottom: 1rem;">
                    <div style="font-size: 1.2rem; color: #10b981; font-weight: bold; margin-bottom: 0.5rem;">
                         Logged In Successfully ✅
                    </div>
                    <div style="color: #cbd5e1; font-size: 0.9rem; margin-bottom: 0.2rem;">
                        User: <strong id="lc-display-user" style="color: white;">-</strong>
                    </div>
                     <div style="color: #cbd5e1; font-size: 0.9rem;">
                        Environment: <strong id="lc-display-env" style="color: white;">-</strong>
                    </div>
                 </div>
                 <button id="lc-logout-btn" class="lc-btn" style="background: #ef4444;">Logout / Switch Account</button>
            </div>
        `;
    }

    attachEvents() {
        const display = this.container.querySelector('#lc-env-display');
        const menu = this.container.querySelector('.lc-dropdown-menu');
        const input = this.container.querySelector('#lc-env-input');
        const list = this.container.querySelector('.lc-dropdown-list');

        // Dropdown Logic
        display.addEventListener('click', (e) => {
            e.stopPropagation();
            menu.classList.toggle('show');
        });

        list.addEventListener('click', (e) => {
            if (e.target.classList.contains('lc-dropdown-item')) {
                const val = e.target.getAttribute('data-value');
                display.textContent = e.target.textContent;
                input.value = val;
                menu.classList.remove('show');
            }
        });

        document.addEventListener('click', (e) => {
            if (!this.container.contains(e.target)) {
                menu.classList.remove('show');
            }
        });

        // Login Logic
        const btn = this.container.querySelector('#lc-login-btn');
        const logoutBtn = this.container.querySelector('#lc-logout-btn');
        const inputs = this.container.querySelectorAll('input');

        const doLogin = async () => {
            const env = input.value;
            const tenant = this.container.querySelector('#lc-tenant').value.trim();
            const username = this.container.querySelector('#lc-username').value.trim();
            const password = this.container.querySelector('#lc-password').value;
            const errorDiv = this.container.querySelector('#lc-error');

            if (!env || !tenant || !username || !password) {
                errorDiv.textContent = "Please fill all fields.";
                errorDiv.classList.remove('hidden');
                return;
            }

            btn.disabled = true;
            btn.textContent = "Logging in...";
            errorDiv.classList.add('hidden');

            try {
                const res = await fetch(this.apiEndpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ environment: env, tenant, username, password })
                });
                const data = await res.json();

                if (data.access_token) {
                    this.onLoginSuccess(data.access_token, { environment: env, tenant, username });

                    // Switch to Logged In View
                    document.getElementById('lc-view-form').style.display = 'none';
                    document.getElementById('lc-view-logged-in').style.display = 'block';

                    document.getElementById('lc-display-user').innerText = username;
                    document.getElementById('lc-display-env').innerText = `${env} (${tenant})`;

                    btn.textContent = "Login"; // Reset for next time
                    btn.disabled = false;

                } else {
                    throw new Error(data.error || "Login Failed");
                }
            } catch (err) {
                this.onLoginFail(err); // Trigger fail callback
                errorDiv.textContent = err.message;
                errorDiv.classList.remove('hidden');
                btn.disabled = false;
                btn.textContent = "Login";
            }
        };

        const doLogout = () => {
            // Reset View
            document.getElementById('lc-view-logged-in').style.display = 'none';
            document.getElementById('lc-view-form').style.display = 'block';

            // Custom Logout Handler
            this.onLogout();
        };

        btn.addEventListener('click', doLogin);
        logoutBtn.addEventListener('click', doLogout);

        // Enter Key Support
        inputs.forEach(inp => {
            inp.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') doLogin();
            });
        });
    }
}
