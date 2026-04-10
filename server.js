const express = require('express');
const https = require('https');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const bodyParser = require('body-parser');
const multer = require('multer'); // Added for file uploads

const app = express();
const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'db.json');


// --- Sage Integrated Support removed ---

app.use(cors());

// --- Sage Integrated Support removed ---

app.use(bodyParser.json());

// Serve backup files for the legacy dashboard
app.get('/aggregate_dashboard.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'aggregate_dashboard_backup.html'));
});

app.get('/aggregate_script.js', (req, res) => {
    res.sendFile(path.join(__dirname, 'aggregate_script_backup.js'));
});

app.use(express.static(__dirname));

// Debug Middleware
app.use((req, res, next) => {
    console.log(`[NODE] Request: ${req.method} ${req.url}`);
    next();
});

// --- Sage Static Files removal ---



// Helper to read DB
const readDb = () => {
    try {
        const data = fs.readFileSync(DB_FILE, 'utf8');
        const json = JSON.parse(data);

        return json;
    } catch (err) {
        console.error('Error reading DB:', err); // DEBUG LOG
        return { environment_urls: {}, users: [] };
    }
};

// Helper to write DB
const writeDb = (data) => {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
};

// Helper to resolve environment URLs case-insensitively
const resolveEnvUrl = (db, env, type = 'api') => {
    let urls;
    if (type === 'api') {
        urls = db.environment_api_urls || {};
    } else if (type === 'ui' || type === 'environment_urls') {
        urls = db.environment_urls || {};
    } else if (type === 'sso_prefix') {
        urls = db.sso_urls_prefix || {};
    } else if (type === 'sso_suffix') {
        urls = db.sso_urls_suffix || {};
    } else {
        urls = db.environment_urls || {};
    }

    if (!env) return urls['default'] || null;
    const target = env.toLowerCase();
    for (const key of Object.keys(urls)) {
        if (key.toLowerCase() === target) return urls[key];
    }
    return urls['default'] || null;
};

// GET all data
app.get('/api/db', (req, res) => {
    res.json(readDb());
});

// GET unit conversions
app.get('/api/unit-conversions', (req, res) => {
    const db = readDb();
    res.json(db.unit_conversion || []);
});

// POST create user
app.post('/api/users', (req, res) => {
    const { environment, tenant, username, password } = req.body;
    if (!environment || !tenant || !username) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    const db = readDb();
    const newUser = {
        id: Date.now().toString(), // Simple ID generation
        environment,
        tenant,
        username,
        password // Storing in plain text as per implied demo requirements (not secure for prod)
    };

    db.users.push(newUser);
    writeDb(db);
    res.status(201).json(newUser);
});

// PUT update user
app.put('/api/users/:id', (req, res) => {
    const { id } = req.params;
    const { environment, tenant, username } = req.body;
    const db = readDb();

    const userIndex = db.users.findIndex(u => u.id === id);
    if (userIndex === -1) {
        return res.status(404).json({ error: 'User not found' });
    }

    // Update fields
    db.users[userIndex] = { ...db.users[userIndex], environment, tenant, username };
    writeDb(db);
    res.json(db.users[userIndex]);
});

// DELETE user
app.delete('/api/users/:id', (req, res) => {
    const { id } = req.params;
    const db = readDb();

    const initialLength = db.users.length;
    db.users = db.users.filter(u => u.id !== id);

    if (db.users.length === initialLength) {
        return res.status(404).json({ error: 'User not found' });
    }

    writeDb(db);
    res.status(204).send();
});

// DELETE all users in a tenant
app.delete('/api/tenants', (req, res) => {
    const { environment, tenant } = req.body;
    if (!environment || !tenant) {
        return res.status(400).json({ error: 'Missing environment or tenant' });
    }

    const db = readDb();
    const initialLength = db.users.length;

    // Filter out users belonging to the target tenant in the target environment
    db.users = db.users.filter(u => !(u.environment === environment && u.tenant === tenant));

    if (db.users.length === initialLength) {
        return res.status(404).json({ error: 'Tenant not found' });
    }

    writeDb(db);
    res.status(204).send();
});



// --- Master Data Proxy Endpoint (Area Units) ---
app.get('/api/user-aggregate/master/constants', (req, res) => {
    const { environment, name, size } = req.query;
    const authHeader = req.headers.authorization;

    if (!environment || !name) {
        return res.status(400).json({ error: 'Missing environment or name parameter' });
    }

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Missing or invalid authorization header' });
    }

    const db = readDb();
    const apiBaseUrl = resolveEnvUrl(db, environment, 'api');
    const frontendUrl = resolveEnvUrl(db, environment, 'ui');

    if (!apiBaseUrl) {
        return res.status(400).json({ error: `Unknown environment: ${environment}` });
    }

    const pathStr = `/services/master/api/constants?name=${encodeURIComponent(name)}&size=${encodeURIComponent(size || 5000)}`;
    const fullUrl = apiBaseUrl + pathStr;
    console.log(`[User Aggregate] Master Constants URL: ${fullUrl}`);

    const urlObj = new URL(fullUrl);
    const options = {
        hostname: urlObj.hostname,
        port: 443,
        path: urlObj.pathname + urlObj.search,
        method: 'GET',
        headers: {
            'Authorization': authHeader,
            'Accept': 'application/json, text/plain, */*',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'origin': frontendUrl || apiBaseUrl,
            'referer': (frontendUrl || apiBaseUrl) + '/'
        }
    };

    const reqProxy = https.request(options, (resProxy) => {
        let data = '';
        resProxy.on('data', chunk => data += chunk);
        resProxy.on('end', () => {
            if (data.trim().startsWith('<!DOCTYPE') || data.trim().startsWith('<html')) {
                return res.status(502).json({ error: 'API returned HTML' });
            }
            try {
                const jsonData = JSON.parse(data);
                if (resProxy.statusCode >= 200 && resProxy.statusCode < 300) {
                    res.json(jsonData);
                } else {
                    res.status(resProxy.statusCode).json({ error: jsonData.message || 'Failed to fetch constants' });
                }
            } catch (e) {
                console.error('[User Aggregate] Parse Error:', e.message);
                res.status(500).json({ error: 'Failed to parse response' });
            }
        });
    });

    reqProxy.on('error', (e) => {
        console.error('[User Aggregate] Proxy Request Error:', e);
        res.status(500).json({ error: 'Proxy request failed: ' + e.message });
    });

    reqProxy.end();
});

// --- Farmer List Proxy Endpoint ---
app.get('/api/user-aggregate/farmers', (req, res) => {
    const { environment } = req.query;
    const authHeader = req.headers.authorization;
    const responseUnit = req.headers['x-response-unit']; // Capture custom header

    if (!environment) {
        return res.status(400).json({ error: 'Missing environment parameter' });
    }

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Missing or invalid authorization header' });
    }

    const db = readDb();
    const apiBaseUrl = resolveEnvUrl(db, environment, 'api');
    const frontendUrl = resolveEnvUrl(db, environment, 'ui');

    if (!apiBaseUrl) {
        return res.status(400).json({ error: `Unknown environment: ${environment}` });
    }

    const pathStr = `/services/farm/api/farmers`;
    const fullUrl = apiBaseUrl + pathStr;

    console.log(`[User Aggregate] Farmers URL: ${fullUrl}`);
    console.log(`[User Aggregate] INCOMING HEADER X-Response-Unit: '${responseUnit}' (Type: ${typeof responseUnit})`);

    const urlObj = new URL(fullUrl);
    const headers = {
        'Authorization': authHeader,
        'Accept': 'application/json, text/plain, */*',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'origin': frontendUrl || apiBaseUrl,
        'referer': (frontendUrl || apiBaseUrl) + '/'
    };

    if (responseUnit) {
        headers['X-Response-Unit'] = responseUnit;
    }

    const options = {
        hostname: urlObj.hostname,
        port: 443,
        path: urlObj.pathname + urlObj.search,
        method: 'GET',
        headers: headers
    };

    const reqProxy = https.request(options, (resProxy) => {
        let data = '';
        resProxy.on('data', chunk => data += chunk);
        resProxy.on('end', () => {
            if (data.trim().startsWith('<!DOCTYPE') || data.trim().startsWith('<html')) {
                return res.status(502).json({ error: 'API returned HTML' });
            }
            try {
                const jsonData = JSON.parse(data);
                if (resProxy.statusCode >= 200 && resProxy.statusCode < 300) {
                    res.json(jsonData);
                } else {
                    res.status(resProxy.statusCode).json({ error: jsonData.message || 'Failed to fetch farmers' });
                }
            } catch (e) {
                console.error('[User Aggregate] Parse Error (Farmers):', e.message);
                res.status(500).json({ error: 'Failed to parse response' });
            }
        });
    });

    reqProxy.end();
});

// --- Farmer Search (By ID) Proxy Endpoint ---
app.get('/api/user-aggregate/farmers/:id', (req, res) => {
    const { environment } = req.query;
    const { id } = req.params;
    const authHeader = req.headers.authorization;
    const responseUnit = req.headers['x-response-unit'];

    if (!environment) return res.status(400).json({ error: 'Missing environment parameter' });
    if (!authHeader) return res.status(401).json({ error: 'Missing auth header' });

    const db = readDb();
    const apiBaseUrl = resolveEnvUrl(db, environment, 'api');

    if (!apiBaseUrl) return res.status(400).json({ error: `Unknown environment: ${environment}` });

    const fullUrl = `${apiBaseUrl}/services/farm/api/farmers/${id}`;

    console.log(`[User Aggregate] Farmer Search URL: ${fullUrl}`);
    console.log(`[User Aggregate] INCOMING HEADER X-Response-Unit: '${responseUnit}'`);

    const urlObj = new URL(fullUrl);
    const headers = {
        'Authorization': authHeader,
        'Accept': 'application/json, text/plain, */*',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    };
    if (responseUnit) {
        headers['X-Response-Unit'] = responseUnit;
    }

    const options = {
        hostname: urlObj.hostname,
        port: 443,
        path: urlObj.pathname + urlObj.search,
        method: 'GET',
        headers: headers
    };

    const reqProxy = https.request(options, (resProxy) => {
        let data = '';
        resProxy.on('data', chunk => data += chunk);
        resProxy.on('end', () => {
            try {
                const jsonData = JSON.parse(data);
                if (resProxy.statusCode >= 200 && resProxy.statusCode < 300) {
                    res.json(jsonData);
                } else {
                    res.status(resProxy.statusCode).json(jsonData);
                }
            } catch (e) {
                res.status(500).json({ error: 'Failed to parse response' });
            }
        });
    });

    reqProxy.on('error', (e) => res.status(500).json({ error: e.message }));
    reqProxy.end();
});

// --- Generic Test Proxy Endpoint ---
// Usage: /api/test-proxy?environment=QA5&targetPath=/services/farm/api/farmers&...
app.get('/api/test-proxy', (req, res) => {
    const { environment, targetPath, ...restParams } = req.query;
    const authHeader = req.headers.authorization;
    const responseUnit = req.headers['x-response-unit'];

    if (!environment) return res.status(400).json({ error: 'Missing environment parameter' });
    if (!targetPath) return res.status(400).json({ error: 'Missing targetPath parameter' });
    if (!authHeader) return res.status(401).json({ error: 'Missing auth header' });

    const db = readDb();
    const envApiUrls = db.environment_api_urls || {};
    let apiBaseUrl = null;

    for (const key of Object.keys(envApiUrls)) {
        if (key.toLowerCase() === environment.toLowerCase()) {
            apiBaseUrl = envApiUrls[key];
            break;
        }
    }

    if (!apiBaseUrl) return res.status(400).json({ error: `Unknown environment: ${environment}` });

    // Construct upstream URL
    // targetPath should provide the path. restParams are appended as query string.
    let fullUrl = `${apiBaseUrl}${targetPath}`;

    // Append remaining query params (excluding environment and targetPath which we extracted)
    const queryString = new URLSearchParams(restParams).toString();
    if (queryString) {
        fullUrl += (fullUrl.includes('?') ? '&' : '?') + queryString;
    }

    const urlObj = new URL(fullUrl);
    const headers = {
        'Authorization': authHeader,
        'Accept': 'application/json, text/plain, */*',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    };
    if (responseUnit) headers['X-Response-Unit'] = responseUnit;

    const options = {
        hostname: urlObj.hostname,
        port: 443,
        path: urlObj.pathname + urlObj.search,
        method: 'GET',
        headers: headers
    };

    const reqProxy = https.request(options, (resProxy) => {
        let data = '';
        resProxy.on('data', chunk => data += chunk);
        resProxy.on('end', () => {
            try {
                // Try parsing as JSON first
                const jsonData = JSON.parse(data);
                if (resProxy.statusCode >= 200 && resProxy.statusCode < 300) {
                    res.json(jsonData);
                } else {
                    res.status(resProxy.statusCode).json(jsonData);
                }
            } catch (e) {
                // If not JSON (or empty), check content type or just return text/error
                console.error('[Generic Proxy] Parse Error:', e.message);
                res.status(resProxy.statusCode || 500).send(data);
            }
        });
    });

    reqProxy.on('error', (e) => {
        console.error('[Generic Proxy] Request Error:', e);
        res.status(500).json({ error: e.message });
    });
    reqProxy.end();
});





// ... (existing imports)

// --- Launch Incognito Endpoint ---
const { exec } = require('child_process');

// --- Launch & Automate Endpoint (Puppeteer Version) ---
const puppeteer = require('puppeteer-core');

app.post('/api/launch-incognito', async (req, res) => {
    const { url, tenant, username, password } = req.body;
    if (!url) {
        return res.status(400).json({ error: 'Missing URL' });
    }

    // Automation V4: Puppeteer
    // Launches a controlled Chrome instance to securely and reliably entry credentials.

    if (username && password) {
        console.log(`[Puppeteer] Environment: ${req.body.environment}, Tenant: ${tenant}, User: ${username}`);

        // We do NOT wait for the browser to close.
        // We launch it and let the user take over.
        res.json({ success: true, message: 'Automation started' });

        try {
            // Load environment_urls from db.json
            const dbPath = path.join(__dirname, 'db.json');
            const dbData = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
            const environmentUrls = dbData.environment_urls || {};

            // Get environment from request body (case-insensitive lookup)
            const environment = req.body.environment || '';
            const baseUrl = resolveEnvUrl(dbData, environment, 'ui');

            if (!baseUrl) {
                console.error(`[Puppeteer] No URL found for environment: ${environment}`);
                return;
            }

            console.log(`[Puppeteer] Using base URL: ${baseUrl}`);

            const browser = await puppeteer.launch({
                executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
                headless: false,
                defaultViewport: null,
                args: ['--start-maximized', '--incognito', '--test-type'],
                ignoreDefaultArgs: ['--enable-automation']
            });

            const pages = await browser.pages();
            const page = pages.length > 0 ? pages[0] : await browser.newPage();

            // 1. Go to environment URL
            await page.goto(baseUrl, { waitUntil: 'networkidle2' });

            // Helper function to wait for element and type
            async function waitAndType(xpath, text, pressEnter = false) {
                try {
                    await page.waitForXPath(xpath, { visible: true, timeout: 15000 });
                    const [element] = await page.$x(xpath);
                    if (element) {
                        await element.click();
                        await element.type(text, { delay: 30 });
                        if (pressEnter) {
                            await page.keyboard.press('Enter');
                        }
                        return true;
                    }
                } catch (e) {
                    console.warn(`[Puppeteer] Element not found: ${xpath}`, e.message);
                }
                return false;
            }

            // Convert tenant to lowercase as per user request
            const tenantLower = tenant.toLowerCase();

            // 2. Enter tenant name in mat-input-0 and press Enter
            console.log(`[Puppeteer] Entering tenant: ${tenantLower}`);
            await waitAndType('//*[@id="mat-input-0"]', tenantLower, true);

            // Wait for tenant selection to process
            await new Promise(r => setTimeout(r, 2000));

            // 3. Wait for username field and enter username
            console.log(`[Puppeteer] Entering username: ${username}`);
            await page.waitForSelector('#username', { visible: true, timeout: 15000 });
            await page.type('#username', username, { delay: 30 });

            // 4. Tab to password field and enter password
            await page.keyboard.press('Tab');
            await new Promise(r => setTimeout(r, 200));

            // Type password (either via Tab focus or direct selector)
            try {
                await page.type('#password', password, { delay: 30 });
            } catch (e) {
                // If direct selector fails, it might already be focused
                await page.keyboard.type(password, { delay: 30 });
            }

            // 5. Press Enter to submit
            await page.keyboard.press('Enter');

            // 6. Wait and check URL - retry tenant if needed
            let retryCount = 0;
            const maxRetries = 3;

            while (retryCount < maxRetries) {
                await new Promise(r => setTimeout(r, 3000));

                const currentUrl = page.url();
                console.log(`[Puppeteer] Current URL (attempt ${retryCount + 1}): ${currentUrl}`);

                if (currentUrl.includes('/dashboard-farm/aggregation-level')) {
                    console.log('[Puppeteer] Login Complete (Target URL Reached)');
                    break;
                } else {
                    console.log('[Puppeteer] Target NOT reached. Re-entering tenant...');
                    retryCount++;

                    try {
                        // Re-enter tenant name in mat-input-0
                        await page.waitForXPath('//*[@id="mat-input-0"]', { visible: true, timeout: 5000 });
                        const [input] = await page.$x('//*[@id="mat-input-0"]');
                        if (input) {
                            await input.click();
                            await input.type(tenantLower, { delay: 30 });
                            await page.keyboard.press('Enter');
                            console.log(`[Puppeteer] Tenant re-entered (attempt ${retryCount})`);
                        }
                    } catch (e) {
                        console.warn('[Puppeteer] Re-entry failed or not needed:', e.message);
                        break;
                    }
                }
            }

            // Disconnect from browser to leave it open
            browser.disconnect();

        } catch (err) {
            console.error('[Puppeteer Error]', err);
        }

    } else {
        // Fallback: Just open link (Backend Launch)
        const { exec } = require('child_process');
        exec(`start "" "${url}"`, (error) => { });
        res.json({ success: true });
    }
});

// --- User Aggregate Data Testing Endpoints ---

// POST Generate Token for User Aggregate
app.post('/api/user-aggregate/token', async (req, res) => {
    const { environment, tenant, username, password } = req.body;

    if (!environment || !tenant || !username || !password) {
        return res.status(400).json({ error: 'All fields are required' });
    }

    // Determine token construction from db.json
    const db = readDb();
    const ssoPrefixes = db.sso_urls_prefix || {};
    const ssoSuffixes = db.sso_urls_suffix || {};

    console.log(`[User Aggregate] Token Gen - Env: ${environment}, Tenant: ${tenant}`);
    console.log(`[User Aggregate] Available Prefixes:`, Object.keys(ssoPrefixes));

    // --- 1. PREFIX ---
    let tokenPrefix = resolveEnvUrl(db, environment, 'sso_prefix');

    if (!tokenPrefix) {
        console.error(`[User Aggregate] SSO Error: No configuration found for environment '${environment}' in db.json (sso_urls_prefix).`);
        return res.status(400).json({ error: `SSO configuration missing for environment: ${environment}. Please check db.json.` });
    }

    // --- 2. SUFFIX ---
    let tokenSuffix = resolveEnvUrl(db, environment, 'sso_suffix') || "/protocol/openid-connect/token";

    // Construct Full URL
    const tokenUrl = `${tokenPrefix}${tenant.toLowerCase()}${tokenSuffix}`;
    console.log(`[User Aggregate] FINAL Constructed URL: ${tokenUrl}`);


    console.log(`[User Aggregate] Token URL: ${tokenUrl}`);

    // Prepare form data
    const formData = new URLSearchParams();
    formData.append('grant_type', 'password');
    formData.append('username', username);
    formData.append('password', password);
    formData.append('client_id', 'resource_server');
    formData.append('client_secret', 'resource_server');
    formData.append('scope', 'openid');

    try {
        const urlObj = new URL(tokenUrl);
        const postData = formData.toString();

        const options = {
            hostname: urlObj.hostname,
            port: 443,
            path: urlObj.pathname,
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': Buffer.byteLength(postData)
            }
        };

        const tokenReq = https.request(options, (tokenRes) => {
            let data = '';

            tokenRes.on('data', (chunk) => {
                data += chunk;
            });

            tokenRes.on('end', () => {
                try {
                    const jsonData = JSON.parse(data);

                    if (tokenRes.statusCode >= 200 && tokenRes.statusCode < 300) {
                        res.json(jsonData);
                    } else {
                        console.error('[User Aggregate] Token Error:', tokenRes.statusCode, data);
                        res.status(tokenRes.statusCode).json({
                            error: jsonData.error_description || jsonData.error || 'Authentication failed'
                        });
                    }
                } catch (e) {
                    console.error('[User Aggregate] Parse Error:', e);
                    res.status(500).json({ error: 'Failed to parse token response' });
                }
            });
        });

        tokenReq.on('error', (e) => {
            console.error('[User Aggregate] Request Error:', e);
            res.status(500).json({ error: 'Token request failed: ' + e.message });
        });

        tokenReq.write(postData);
        tokenReq.end();

    } catch (err) {
        console.error('[User Aggregate] Error:', err);
        res.status(500).json({ error: 'Internal error generating token' });
    }
});

// GET User-Info
app.get('/api/user-aggregate/user-info', (req, res) => {
    const { environment } = req.query;
    const authHeader = req.headers.authorization;

    if (!environment) return res.status(400).json({ error: 'Missing environment' });
    if (!authHeader || !authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });

    const db = readDb();
    const apiBaseUrl = resolveEnvUrl(db, environment, 'api');
    const frontendUrl = resolveEnvUrl(db, environment, 'ui');

    if (!apiBaseUrl) return res.status(400).json({ error: 'Unknown environment' });

    const fullUrl = apiBaseUrl + `/services/user/api/users/user-info`;
    const urlObj = new URL(fullUrl);
    const options = {
        hostname: urlObj.hostname, port: 443, path: urlObj.pathname, method: 'GET',
        headers: {
            'Authorization': authHeader, 'Accept': 'application/json', 'Content-Type': 'application/json',
            'User-Agent': 'Mozilla/5.0',
            'origin': frontendUrl || apiBaseUrl, 'referer': (frontendUrl || apiBaseUrl) + '/'
        }
    };

    https.request(options, (userRes) => {
        let data = '';
        userRes.on('data', chunk => data += chunk);
        userRes.on('end', () => {
            if (data.trim().startsWith('<')) return res.status(502).json({ error: 'API returned HTML' });
            try {
                const jsonData = JSON.parse(data);
                if (userRes.statusCode >= 200 && userRes.statusCode < 300) {
                    res.json({ success: true, data: jsonData });
                } else {
                    res.status(userRes.statusCode).json({ error: jsonData.message || 'Failed to fetch user info' });
                }
            } catch (e) { res.status(500).json({ error: 'Parse Error' }); }
        });
    }).on('error', e => res.status(500).json({ error: e.message })).end();
});

// GET Company-Info
app.get('/api/user-aggregate/company-info', (req, res) => {
    const { environment, companyId } = req.query;
    const authHeader = req.headers.authorization;

    if (!environment || !companyId) return res.status(400).json({ error: 'Missing params' });
    if (!authHeader || !authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });

    const db = readDb();
    const apiBaseUrl = resolveEnvUrl(db, environment, 'api');
    const frontendUrl = resolveEnvUrl(db, environment, 'ui');

    const fullUrl = apiBaseUrl + `/services/farm/api/companies/${companyId}`;
    const urlObj = new URL(fullUrl);
    const options = {
        hostname: urlObj.hostname, port: 443, path: urlObj.pathname, method: 'GET',
        headers: {
            'Authorization': authHeader, 'Accept': 'application/json', 'Content-Type': 'application/json',
            'User-Agent': 'Mozilla/5.0',
            'origin': frontendUrl || apiBaseUrl, 'referer': (frontendUrl || apiBaseUrl) + '/'
        }
    };

    https.request(options, (compRes) => {
        let data = '';
        compRes.on('data', chunk => data += chunk);
        compRes.on('end', () => {
            if (data.trim().startsWith('<')) return res.status(502).json({ error: 'API returned HTML' });
            try {
                const jsonData = JSON.parse(data);
                if (compRes.statusCode >= 200 && compRes.statusCode < 300) {
                    res.json({ success: true, data: jsonData });
                } else {
                    res.status(compRes.statusCode).json({ error: jsonData.message || 'Failed to fetch company info' });
                }
            } catch (e) { res.status(500).json({ error: 'Parse Error' }); }
        });
    }).on('error', e => res.status(500).json({ error: e.message })).end();
});

// GET User Projects
app.get('/api/user-aggregate/projects', (req, res) => {
    const { environment, tenant } = req.query;
    const authHeader = req.headers.authorization;

    if (!environment) {
        return res.status(400).json({ error: 'Missing environment parameter' });
    }

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Missing or invalid authorization header' });
    }

    // Log token prefix for debugging (first 20 chars only, for security)
    const tokenPreview = authHeader.substring(0, 30) + '...';
    console.log(`[User Aggregate] Token Preview: ${tokenPreview}`);
    console.log(`[User Aggregate] Tenant: ${tenant || 'not provided'}`);

    if (!tenant) {
        return res.status(400).json({ error: 'Missing tenant parameter' });
    }

    // Get environment API URL from db.json (case-insensitive lookup)
    // Using environment_api_urls which has the correct GCP API URLs
    const db = readDb();
    const apiBaseUrl = resolveEnvUrl(db, environment, 'api');
    const frontendUrl = resolveEnvUrl(db, environment, 'ui');

    if (!apiBaseUrl) {
        return res.status(400).json({ error: `Unknown environment: ${environment}. Please add to environment_api_urls in db.json` });
    }

    // Use environment_api_urls directly (already includes /qa2, /qa3, etc.)
    // Just append the projects API path
    const projectsPath = `/services/farm/api/projects?userHierarchyPreference=true&size=5000&projectPreferenceRequired=true&sort=projectStatus,asc&sort=lastModifiedDate,desc`;
    const fullUrl = apiBaseUrl + projectsPath;

    console.log(`[User Aggregate] API Base URL: ${apiBaseUrl}`);
    console.log(`[User Aggregate] Projects URL: ${fullUrl}`);

    // Helper function to make request with redirect following
    const makeRequest = (url, redirectCount = 0) => {
        if (redirectCount > 5) {
            return res.status(500).json({ error: 'Too many redirects' });
        }

        const urlObj = new URL(url);

        // Build headers to match working curl request
        const headers = {
            'Authorization': authHeader,
            'Accept': 'application/json, text/plain, */*',
            'accept-language': 'en',
            'Content-Type': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
            'origin': frontendUrl || apiBaseUrl,
            'referer': (frontendUrl || apiBaseUrl) + '/',
            'X-Requested-With': 'XMLHttpRequest'
        };

        const options = {
            hostname: urlObj.hostname,
            port: urlObj.port || 443,
            path: urlObj.pathname + urlObj.search,
            method: 'GET',
            headers: headers
        };

        console.log(`[User Aggregate] Request to: ${urlObj.hostname}${urlObj.pathname}${urlObj.search}`);

        const projectsReq = https.request(options, (projectsRes) => {
            // Handle redirects (301, 302, 303, 307, 308)
            if ([301, 302, 303, 307, 308].includes(projectsRes.statusCode) && projectsRes.headers.location) {
                const redirectUrl = new URL(projectsRes.headers.location, url).toString();
                console.log(`[User Aggregate] Redirecting to: ${redirectUrl}`);
                return makeRequest(redirectUrl, redirectCount + 1);
            }

            let data = '';

            projectsRes.on('data', (chunk) => {
                data += chunk;
            });

            projectsRes.on('end', () => {
                console.log(`[User Aggregate] Response Status: ${projectsRes.statusCode}`);
                console.log(`[User Aggregate] Content-Type: ${projectsRes.headers['content-type']}`);
                console.log(`[User Aggregate] Response Preview: ${data.substring(0, 300)}`);

                // Check if response is HTML (error case)
                if (data.trim().startsWith('<!DOCTYPE') || data.trim().startsWith('<html')) {
                    console.error('[User Aggregate] Received HTML instead of JSON');
                    return res.status(502).json({
                        error: 'API returned HTML instead of JSON. Token may be expired or invalid.',
                        hint: 'Try logging in again with fresh credentials'
                    });
                }

                try {
                    const jsonData = JSON.parse(data);

                    if (projectsRes.statusCode >= 200 && projectsRes.statusCode < 300) {
                        let projectsList = [];

                        if (Array.isArray(jsonData)) {
                            projectsList = jsonData;
                        } else if (jsonData.content && Array.isArray(jsonData.content)) {
                            projectsList = jsonData.content;
                        }

                        const projects = projectsList
                            .filter(p => p.projectStatus === 'LIVE')
                            .map(p => ({
                                id: p.id,
                                name: p.name
                            }));

                        console.log(`[User Aggregate] Found ${projects.length} projects`);
                        res.json({ projects });
                    } else {
                        console.error('[User Aggregate] Projects Error:', projectsRes.statusCode, data);
                        res.status(projectsRes.statusCode).json({
                            error: jsonData.message || jsonData.error || 'Failed to fetch projects'
                        });
                    }
                } catch (e) {
                    console.error('[User Aggregate] Parse Error:', e.message);
                    res.status(500).json({
                        error: 'Failed to parse projects response',
                        rawPreview: data.substring(0, 200),
                        statusCode: projectsRes.statusCode
                    });
                }
            });
        });

        projectsReq.on('error', (e) => {
            console.error('[User Aggregate] Request Error:', e);
            res.status(500).json({ error: 'Projects request failed: ' + e.message });
        });

        projectsReq.end();
    };

    try {
        makeRequest(fullUrl);
    } catch (err) {
        console.error('[User Aggregate] Error:', err);
        res.status(500).json({ error: 'Internal error fetching projects' });
    }
});

// GET User Plots for a Project
app.get('/api/user-aggregate/plots', (req, res) => {
    const { environment, projectId } = req.query;
    const authHeader = req.headers.authorization;

    if (!environment || !projectId) {
        return res.status(400).json({ error: 'Missing environment or projectId parameter' });
    }

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Missing or invalid authorization header' });
    }

    // Get environment API URL from db.json
    const db = readDb();
    const apiBaseUrl = resolveEnvUrl(db, environment, 'api');
    const frontendUrl = resolveEnvUrl(db, environment, 'ui');

    if (!apiBaseUrl) {
        return res.status(400).json({ error: `Unknown environment: ${environment}` });
    }

    const plotsPath = `/services/farm/api/dashboard/latlongs?size=5000&projectIds=${projectId}`;
    const fullUrl = apiBaseUrl + plotsPath;

    console.log(`[User Aggregate] Plots URL: ${fullUrl}`);

    const urlObj = new URL(fullUrl);
    const postBody = '{}';
    const headers = {
        'Authorization': authHeader,
        'Accept': 'application/vnd.v2+json',
        'accept-language': 'en',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postBody),
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
        'origin': frontendUrl || 'https://sf-v2.cropin.co.in',
        'referer': (frontendUrl || 'https://sf-v2.cropin.co.in') + '/',
        'X-Requested-With': 'XMLHttpRequest'
    };

    const options = {
        hostname: urlObj.hostname,
        port: 443,
        path: urlObj.pathname + urlObj.search,
        method: 'POST',
        headers: headers
    };

    const plotsReq = https.request(options, (plotsRes) => {
        let data = '';

        plotsRes.on('data', (chunk) => {
            data += chunk;
        });

        plotsRes.on('end', () => {
            console.log(`[User Aggregate] Plots Response Status: ${plotsRes.statusCode}`);

            if (data.trim().startsWith('<!DOCTYPE') || data.trim().startsWith('<html')) {
                return res.status(502).json({ error: 'API returned HTML - token may be invalid' });
            }

            try {
                const jsonData = JSON.parse(data);

                if (plotsRes.statusCode >= 200 && plotsRes.statusCode < 300) {
                    // Extract name and caId from response
                    let plotsList = Array.isArray(jsonData) ? jsonData : (jsonData.content || []);

                    const plots = plotsList.map(p => ({
                        name: p.name,
                        caId: p.caId
                    }));

                    console.log(`[User Aggregate] Found ${plots.length} plots`);
                    res.json({ plots, totalCount: plots.length });
                } else {
                    res.status(plotsRes.statusCode).json({
                        error: jsonData.message || jsonData.error || 'Failed to fetch plots'
                    });
                }
            } catch (e) {
                console.error('[User Aggregate] Plots Parse Error:', e.message);
                res.status(500).json({ error: 'Failed to parse plots response' });
            }
        });
    });

    plotsReq.on('error', (e) => {
        console.error('[User Aggregate] Plots Request Error:', e);
        res.status(500).json({ error: 'Plots request failed: ' + e.message });
    });

    // POST needs an empty body
    plotsReq.write(postBody);
    plotsReq.end();
});

// GET CA Details
app.get('/api/user-aggregate/ca-details', (req, res) => {
    const { environment, caId } = req.query;
    const authHeader = req.headers.authorization;

    if (!environment || !caId) {
        return res.status(400).json({ error: 'Missing environment or caId parameter' });
    }

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Missing or invalid authorization header' });
    }

    const db = readDb();
    const apiBaseUrl = resolveEnvUrl(db, environment, 'api');
    const frontendUrl = resolveEnvUrl(db, environment, 'ui');

    if (!apiBaseUrl) {
        return res.status(400).json({ error: `Unknown environment: ${environment}` });
    }

    const caPath = `/services/projections/api/croppableAreas/${caId}`;
    const fullUrl = apiBaseUrl + caPath;

    const urlObj = new URL(fullUrl);
    const options = {
        hostname: urlObj.hostname,
        port: 443,
        path: urlObj.pathname,
        method: 'GET',
        headers: {
            'Authorization': authHeader,
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'origin': frontendUrl || apiBaseUrl,
            'referer': (frontendUrl || apiBaseUrl) + '/'
        }
    };

    const caReq = https.request(options, (caRes) => {
        let data = '';
        caRes.on('data', chunk => data += chunk);
        caRes.on('end', () => {
            if (data.trim().startsWith('<!DOCTYPE') || data.trim().startsWith('<html')) {
                return res.status(502).json({ error: 'API returned HTML' });
            }
            try {
                const jsonData = JSON.parse(data);
                if (caRes.statusCode >= 200 && caRes.statusCode < 300) {
                    // auditedArea is an object with count property
                    const auditedAreaValue = jsonData.auditedArea?.count || jsonData.auditedArea || 0;
                    res.json({
                        caId: caId,
                        auditedArea: auditedAreaValue,
                        expectedHarvest: jsonData.expectedHarvest,
                        reEstimatedHarvest: jsonData.reEstimatedHarvest,
                        expectedYield: jsonData.data?.expectedYield,
                        reestimatedValue: jsonData.reEstimatedHarvest, // used for yield formula: reestimatedValue / auditedArea
                        quantityUnit: jsonData.quantityUnit
                    });
                } else {
                    res.status(caRes.statusCode).json({ error: jsonData.message || 'Failed to fetch CA details' });
                }
            } catch (e) {
                res.status(500).json({ error: 'Failed to parse CA details response' });
            }
        });
    });

    caReq.on('error', (e) => {
        res.status(500).json({ error: 'CA details request failed: ' + e.message });
    });

    caReq.end();
});

// GET Yield Prediction
app.get('/api/user-aggregate/yield-prediction', (req, res) => {
    const { environment, caIds } = req.query;
    const authHeader = req.headers.authorization;

    if (!environment || !caIds) {
        return res.status(400).json({ error: 'Missing environment or caIds parameter' });
    }

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Missing or invalid authorization header' });
    }

    const db = readDb();
    const apiBaseUrl = resolveEnvUrl(db, environment, 'api');
    const frontendUrl = resolveEnvUrl(db, environment, 'ui');

    if (!apiBaseUrl) {
        return res.status(400).json({ error: `Unknown environment: ${environment}` });
    }

    const yieldPath = `/services/farm/api/plot-risk/yield?caIds=${caIds}`;
    const fullUrl = apiBaseUrl + yieldPath;

    const urlObj = new URL(fullUrl);
    const options = {
        hostname: urlObj.hostname,
        port: 443,
        path: urlObj.pathname + urlObj.search,
        method: 'GET',
        headers: {
            'Authorization': authHeader,
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'origin': frontendUrl || apiBaseUrl,
            'referer': (frontendUrl || apiBaseUrl) + '/'
        }
    };

    const yieldReq = https.request(options, (yieldRes) => {
        let data = '';
        yieldRes.on('data', chunk => data += chunk);
        yieldRes.on('end', () => {
            if (data.trim().startsWith('<!DOCTYPE') || data.trim().startsWith('<html')) {
                return res.status(502).json({ error: 'API returned HTML' });
            }
            try {
                const jsonData = JSON.parse(data);
                if (yieldRes.statusCode >= 200 && yieldRes.statusCode < 300) {
                    // Extract parameters from records array
                    let hasData = false;
                    let params = {};

                    if (jsonData.records && jsonData.records.length > 0) {
                        // Use first record's parameters
                        params = jsonData.records[0].parameters || {};
                        hasData = true;
                    } else if (jsonData.parameters) {
                        params = jsonData.parameters;
                        hasData = true;
                    }

                    if (hasData) {
                        res.json({
                            caId: caIds,
                            productionMin: parseFloat(params.productionMin) || 'NA',
                            productionMax: parseFloat(params.productionMax) || 'NA',
                            productionAvg: parseFloat(params.productionAvg) || 'NA',
                            yieldMin: parseFloat(params.yieldMin) || 'NA',
                            yieldMax: parseFloat(params.yieldMax) || 'NA',
                            yieldAvg: parseFloat(params.yieldAvg) || 'NA'
                        });
                    } else {
                        // No data available - mark as NA
                        res.json({
                            caId: caIds,
                            productionMin: 'NA',
                            productionMax: 'NA',
                            productionAvg: 'NA',
                            yieldMin: 'NA',
                            yieldMax: 'NA',
                            yieldAvg: 'NA'
                        });
                    }
                } else {
                    res.status(yieldRes.statusCode).json({ error: jsonData.message || 'Failed to fetch yield prediction' });
                }
            } catch (e) {
                res.status(500).json({ error: 'Failed to parse yield prediction response' });
            }
        });
    });

    yieldReq.on('error', (e) => {
        res.status(500).json({ error: 'Yield prediction request failed: ' + e.message });
    });

    yieldReq.end();
});

// GET Growth Prediction
app.get('/api/user-aggregate/growth-prediction', (req, res) => {
    const { environment, caIds } = req.query;
    const authHeader = req.headers.authorization;

    if (!environment || !caIds) {
        return res.status(400).json({ error: 'Missing environment or caIds parameter' });
    }

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Missing or invalid authorization header' });
    }

    const db = readDb();
    const apiBaseUrl = resolveEnvUrl(db, environment, 'api');
    const frontendUrl = resolveEnvUrl(db, environment, 'ui');

    if (!apiBaseUrl) {
        return res.status(400).json({ error: `Unknown environment: ${environment}` });
    }

    // Mock response for now as per previous structure, but we'll add real proxying below
    res.json({
        currentNdvi: 0.65,
        avgNdvi: 0.58,
        stage: "Vegetative",
        status: "Good"
    });
});

// GET Sustainability Data
app.get('/api/user-aggregate/sustainability', (req, res) => {
    const { environment, caIds } = req.query;
    const authHeader = req.headers.authorization;

    if (!environment || !caIds) return res.status(400).json({ error: 'Missing environment or caIds' });
    if (!authHeader) return res.status(401).json({ error: 'Missing authorization' });

    const db = readDb();
    const apiBaseUrl = resolveEnvUrl(db, environment, 'api');
    if (!apiBaseUrl) return res.status(400).json({ error: 'Unknown environment' });

    const fullUrl = `${apiBaseUrl}/services/farm/api/plot-risk/sustainability/plot?caIds=${caIds}`;
    const urlObj = new URL(fullUrl);
    const options = {
        hostname: urlObj.hostname,
        port: 443,
        path: urlObj.pathname + urlObj.search,
        method: 'GET',
        headers: {
            'Authorization': authHeader,
            'Accept': 'application/json',
            'User-Agent': 'Mozilla/5.0'
        }
    };

    const sReq = https.request(options, (sRes) => {
        let data = '';
        sRes.on('data', chunk => data += chunk);
        sRes.on('end', () => {
            if (sRes.statusCode === 204) return res.status(204).end();
            try {
                const parsedData = JSON.parse(data);
                if (sRes.statusCode >= 200 && sRes.statusCode < 300) {
                    const record = (parsedData.records && parsedData.records.length > 0) ? parsedData.records[0] : null;
                    if (record) {
                        res.json({
                            caId: caIds,
                            harvested: record.harvested || false,
                            harvestDate: record.harvestDate || null
                        });
                    } else {
                        res.json({ caId: caIds, harvested: false, harvestDate: null, _rawEmpty: true });
                    }
                } else {
                    res.status(sRes.statusCode).send(data);
                }
            } catch (e) {
                console.error('[User Aggregate] Sustainability Parse Error:', e.message);
                res.status(500).json({ error: 'Failed to proxy sustainability' });
            }
        });
    });
    sReq.on('error', e => res.status(500).json({ error: e.message }));
    sReq.end();
});
// GET Growth Stage Data
app.get('/api/user-aggregate/growth-stage', (req, res) => {
    const { environment, caIds } = req.query;
    const authHeader = req.headers.authorization;

    if (!environment || !caIds) return res.status(400).json({ error: 'Missing environment or caIds' });
    if (!authHeader) return res.status(401).json({ error: 'Missing authorization' });

    const db = readDb();
    const apiBaseUrl = resolveEnvUrl(db, environment, 'api');
    if (!apiBaseUrl) return res.status(400).json({ error: 'Unknown environment' });

    const fullUrl = `${apiBaseUrl}/services/farm/api/plot-risk/growthstage?caIds=${caIds}&size=10&orderBy=DESC&sortBy=date`;
    const urlObj = new URL(fullUrl);

    const options = {
        hostname: urlObj.hostname,
        port: 443,
        path: urlObj.pathname + urlObj.search,
        method: 'GET',
        headers: {
            'Authorization': authHeader,
            'Accept': 'application/json',
            'User-Agent': 'Mozilla/5.0'
        }
    };

    const gReq = https.request(options, (gRes) => {
        let data = '';
        gRes.on('data', chunk => data += chunk);
        gRes.on('end', () => {
            if (data.trim().startsWith('<!DOCTYPE') || data.trim().startsWith('<html')) {
                console.error(`[User Aggregate] Growth Stage Error: API returned HTML instead of JSON for caIds=${caIds}`);
                return res.status(502).json({ error: 'Upstream API returned HTML (possible session timeout)' });
            }
            if (!data.trim()) {
                console.warn(`[User Aggregate] Growth Stage Warning: Empty response for caIds=${caIds}`);
                return res.json({ caId: caIds, _rawEmpty: true, _message: "Empty response from upstream" });
            }

            try {
                const parsedData = JSON.parse(data);
                if (gRes.statusCode >= 200 && gRes.statusCode < 300) {
                    let growth = null;
                    if (parsedData.records && Array.isArray(parsedData.records)) {
                        for (const rec of parsedData.records) {
                            if (rec.cropGrowthStage && rec.cropGrowthStage.cropStageName) {
                                growth = rec.cropGrowthStage;
                                break;
                            }
                        }
                    }

                    if (growth) {
                        res.json({
                            caId: caIds,
                            cropStageName: growth.cropStageName || "-",
                            seasonProgression: growth.seasonProgression || 0,
                            harvestWindowStartDate: growth.harvestWindowStartDate || "-",
                            harvestWindowEndDate: growth.harvestWindowEndDate || "-"
                        });
                    } else {
                        res.json({ caId: caIds, _rawEmpty: true, _message: "No valid growth stage records found" });
                    }
                } else {
                    res.status(gRes.statusCode).send(data);
                }
            } catch (e) {
                console.error('[User Aggregate] Growth Stage Parse Error:', e.message);
                console.error('[User Aggregate] Raw Data snippet:', data.substring(0, 100));
                res.status(500).json({ error: 'Failed to parse growthstage response' });
            }
        });
    });
    gReq.on('error', e => {
        console.error('[User Aggregate] Growth Stage Request Error:', e.message);
        res.status(500).json({ error: 'Proxy request failed: ' + e.message });
    });
    gReq.end();
});

// GET Plot Features (Intelligence Features)
app.get('/api/user-aggregate/plot-features/:caId', (req, res) => {
    const { environment } = req.query;
    const { caId } = req.params;
    const authHeader = req.headers.authorization;

    if (!environment || !caId) return res.status(400).json({ error: 'Missing environment or caId' });
    if (!authHeader) return res.status(401).json({ error: 'Missing authorization' });

    const db = readDb();
    const apiBaseUrl = resolveEnvUrl(db, environment, 'api');
    if (!apiBaseUrl) return res.status(400).json({ error: 'Unknown environment' });

    const fullUrl = `${apiBaseUrl}/services/farm/api/croppable-areas/features/${caId}`;
    const urlObj = new URL(fullUrl);

    const options = {
        hostname: urlObj.hostname,
        port: 443,
        path: urlObj.pathname,
        method: 'GET',
        headers: {
            'Authorization': authHeader,
            'Accept': 'application/json',
            'User-Agent': 'Mozilla/5.0'
        }
    };

    const fReq = https.request(options, (fRes) => {
        let data = '';
        fRes.on('data', chunk => data += chunk);
        fRes.on('end', () => {
            try {
                if (data.trim().startsWith('<')) return res.status(502).json({ error: 'API returned HTML' });
                const parsedData = JSON.parse(data);
                if (fRes.statusCode >= 200 && fRes.statusCode < 300) {
                    res.json(parsedData);
                } else {
                    res.status(fRes.statusCode).json(parsedData);
                }
            } catch (e) {
                console.error('[User Aggregate] Plot Features Parse Error:', e.message);
                res.status(500).json({ error: 'Failed to proxy plot features' });
            }
        });
    });
    fReq.on('error', e => res.status(500).json({ error: e.message }));
    fReq.end();
});

// GET Harvest Tasks Data
app.get('/api/user-aggregate/harvest-tasks', (req, res) => {
    const { environment, projectId, planTypeId } = req.query;
    const authHeader = req.headers.authorization;

    if (!environment || !projectId || !planTypeId) return res.status(400).json({ error: 'Missing environment, projectId or planTypeId' });
    if (!authHeader) return res.status(401).json({ error: 'Missing authorization' });

    const db = readDb();
    const apiBaseUrl = resolveEnvUrl(db, environment, 'api');

    if (!apiBaseUrl) return res.status(400).json({ error: `Unknown environment: ${environment}` });

    const fullUrl = `${apiBaseUrl}/services/farm/api/projects/${projectId}/plan-types/${planTypeId}/tasks?size=5000`;
    const urlObj = new URL(fullUrl);

    const options = {
        hostname: urlObj.hostname,
        port: 443,
        path: urlObj.pathname + urlObj.search,
        method: 'GET',
        headers: {
            'Authorization': authHeader,
            'Accept': 'application/json',
            'User-Agent': 'Mozilla/5.0'
        }
    };

    const hReq = https.request(options, (hRes) => {
        let data = '';
        hRes.on('data', chunk => data += chunk);
        hRes.on('end', () => {
            try {
                if (hRes.statusCode >= 200 && hRes.statusCode < 300) {
                    const parsedData = JSON.parse(data);
                    
                    // The external API might return a direct array OR an object with a 'records' field
                    const rawRecords = Array.isArray(parsedData) ? parsedData : (parsedData.records || []);
                    
                    console.log(`[DEBUG] Harvest Tasks External API returned ${rawRecords.length} records`);
                    if (rawRecords.length > 0) {
                        console.log(`[DEBUG] First Raw Record Keys:`, Object.keys(rawRecords[0]));
                        console.log(`[DEBUG] First Raw Record Data:`, JSON.stringify(rawRecords[0].data, null, 2));
                    }

                    // Flatten the records into entries
                    const flattenedEntries = [];
                    rawRecords.forEach(task => {
                        const data = task.data || {};
                        
                        // Path 1: planHeaderAttributesEntered (Array of entries)
                        let entries = data.planHeaderAttributesEntered;
                        
                        // Fallback Path 2: Maybe it's directly in data?
                        if (!entries && data.totalQuantity) {
                            entries = [data]; // Wrap in array to reuse logic
                        }

                        if (Array.isArray(entries) && entries.length > 0) {
                            entries.forEach(attr => {
                                if (attr.totalQuantity) {
                                    flattenedEntries.push({
                                        taskId: task.taskId,
                                        croppableAreaId: task.croppableAreaId,
                                        croppableAreaName: task.croppableAreaName,
                                        actualClosedDate: task.actualClosedDate || data.standardAttributesEntered?.executedOn,
                                        expectedStartDate: task.expectedStartDate,
                                        expectedEndDate: task.expectedEndDate,
                                        qty: parseFloat(attr.totalQuantity.count) || 0,
                                        unit: attr.totalQuantity.unit || "-"
                                    });
                                }
                            });
                        }
                    });
                    
                    // Response cleanup: Return only flattened records
                    res.json({ records: flattenedEntries });
                } else {
                    res.status(hRes.statusCode).send(data);
                }
            } catch (e) {
                console.error('[User Aggregate] Harvest Tasks Parse Error:', e.message);
                res.status(500).json({ error: 'Failed to proxy harvest tasks' });
            }
        });
    });
    hReq.on('error', e => res.status(500).json({ error: e.message }));
    hReq.end();
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
});
