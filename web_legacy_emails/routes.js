// Web Legacy Emails - HTTP routes (/api/jira/*, /api/email/*), shared by the main dashboard
// server.js and the standalone deploy's server.js. Thin layer over core.js; credentials are never
// sent back to the browser. Expects the app to already parse application/json bodies.
const bodyParser = require('body-parser');
const wle = require('./core.js');

// Custom content type so the app-wide 100kb JSON parser skips it (body carries 2 chart PNGs)
const EMAIL_SEND_CONTENT_TYPE = 'application/vnd.web-legacy-email+json';

// startScheduler: true only in the real server process (not when tests require the server)
function register(app, { startScheduler = false } = {}) {
    wle.migrateLegacyCredentials();

    // ---------- Jira ----------
    // Get Config (credentials replaced by flags)
    app.get('/api/jira/config', (req, res) => {
        const creds = wle.readJiraCredentials();
        res.json({
            ...wle.readConfig(),
            jiraEmail: creds.jiraEmail || '',
            hasApiToken: !!creds.jiraApiToken
        });
    });

    // Update Config — a blank token keeps the saved one
    app.post('/api/jira/config', (req, res) => {
        try {
            const { jiraEmail, jiraApiToken, hasApiToken, ...rest } = req.body;

            const creds = wle.readJiraCredentialsFile();
            if (jiraEmail !== undefined) creds.jiraEmail = String(jiraEmail).trim();
            if (jiraApiToken) creds.jiraApiToken = String(jiraApiToken).trim();
            wle.writeJiraCredentials(creds);

            const updated = { ...wle.readConfig(), ...rest };
            wle.writeConfig(updated);
            const effective = wle.readJiraCredentials();
            res.json({ success: true, config: { ...updated, jiraEmail: effective.jiraEmail || '', hasApiToken: !!effective.jiraApiToken } });
        } catch (e) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    // Get History
    app.get('/api/jira/history', (req, res) => {
        res.json(wle.readHistory());
    });

    // Append / Update Snapshot in History (same date replaces that week)
    app.post('/api/jira/history', (req, res) => {
        try {
            if (!req.body.date) return res.status(400).json({ error: 'Date is required' });
            res.json({ success: true, history: wle.upsertHistory(req.body) });
        } catch (e) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    // Replace Full History
    app.put('/api/jira/history', (req, res) => {
        try {
            if (!Array.isArray(req.body)) return res.status(400).json({ error: 'Expected an array' });
            wle.writeHistory(req.body);
            res.json({ success: true, history: wle.readHistory() });
        } catch (e) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    // Fetch Counts from Jira
    app.post('/api/jira/fetch-counts', async (req, res) => {
        try {
            const { counts, fetchedAs } = await wle.fetchCounts();
            res.json({
                success: true,
                fetchedAt: new Date().toISOString(),
                fetchedAs,
                counts: {
                    older: { total: counts.olderHighest + counts.olderHigh, highest: counts.olderHighest, high: counts.olderHigh },
                    recent: { total: counts.recentHighest + counts.recentHigh, highest: counts.recentHighest, high: counts.recentHigh }
                }
            });
        } catch (e) {
            console.error('[Jira] Error fetching counts:', e.message);
            res.status(e.status || 500).json({ success: false, error: e.message });
        }
    });

    // ---------- Gmail sending ----------
    // Recipients/subject/sender name/send method/schedule live in jira_config.json; Gmail login +
    // app password in the gitignored email_credentials.json (never returned to the browser).
    const emailConfigResponse = () => {
        const config = wle.readConfig();
        const creds = wle.readEmailCredentials();
        return {
            emailMode: wle.EMAIL_MODES.includes(config.emailMode) ? config.emailMode : 'compose',
            recipients: config.recipients || '',
            cc: config.cc || '',
            subject: config.subject || '',
            senderName: config.senderName || '',
            gmailUser: creds.gmailUser || '',
            hasAppPassword: !!creds.gmailAppPassword
        };
    };

    // Get Email Config (app password replaced by a flag)
    app.get('/api/email/config', (req, res) => {
        res.json(emailConfigResponse());
    });

    // Update Email Config — a blank app password keeps the saved one
    app.post('/api/email/config', (req, res) => {
        try {
            const { emailMode, recipients, cc, subject, senderName, gmailUser, gmailAppPassword } = req.body;
            if (emailMode !== undefined && !wle.EMAIL_MODES.includes(emailMode)) {
                return res.status(400).json({ success: false, error: `Invalid send method: ${emailMode}` });
            }

            const invalid = [...wle.parseEmailList(recipients), ...wle.parseEmailList(cc), ...(gmailUser ? [gmailUser.trim()] : [])]
                .filter(e => !wle.isValidEmail(e));
            if (invalid.length) {
                return res.status(400).json({ success: false, error: `Invalid email address: ${invalid.join(', ')}` });
            }

            const current = wle.readConfig();
            wle.writeConfig({
                ...current,
                emailMode: emailMode || current.emailMode || 'compose',
                recipients: String(recipients || '').trim(),
                cc: String(cc || '').trim(),
                subject: String(subject || '').trim(),
                senderName: String(senderName || '').trim()
            });

            const creds = wle.readEmailCredentialsFile();
            creds.gmailUser = String(gmailUser || '').trim();
            // Google shows app passwords as "abcd efgh ijkl mnop"; spaces are not part of it
            if (gmailAppPassword) creds.gmailAppPassword = String(gmailAppPassword).replace(/\s+/g, '');
            wle.writeEmailCredentials(creds);

            res.json({ success: true, config: emailConfigResponse() });
        } catch (e) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    // Send button in auto mode. Body: { html, date, charts: { older, recent } (PNG data URLs), test }.
    // html references the charts as cid:older-trend / cid:recent-trend.
    app.post('/api/email/send', bodyParser.json({ type: EMAIL_SEND_CONTENT_TYPE, limit: '10mb' }), async (req, res) => {
        try {
            const { html, date, charts = {}, test } = req.body || {};
            if (!html) return res.status(400).json({ success: false, error: 'Email content is missing' });

            // Button-triggered automatic sending is opt-in: refuse unless Send method is explicitly 'auto'
            if (wle.readConfig().emailMode !== 'auto') {
                return res.status(403).json({ success: false, error: 'Automatic sending is turned off (Send method = Gmail compose). Change it in Email settings to enable.' });
            }

            const toPng = (dataUrl) => (typeof dataUrl === 'string' && dataUrl.startsWith('data:image/png;base64,'))
                ? Buffer.from(dataUrl.split(',')[1], 'base64') : null;
            const sent = await wle.sendDigestMail({ html, date, charts: { older: toPng(charts.older), recent: toPng(charts.recent) }, test });
            res.json({ success: true, ...sent });
        } catch (e) {
            console.error('[Email] Send failed:', e.message);
            res.status(e.status || 500).json({ success: false, error: e.message });
        }
    });

    // ---------- Scheduled sending ----------
    const scheduleResponse = () => {
        const schedule = wle.readSchedule();
        const next = wle.nextScheduledRun(schedule);
        return { schedule, nextRun: next ? next.toISOString() : null, runs: wle.readRunLog().slice(0, 10) };
    };

    app.get('/api/email/schedule', (req, res) => {
        res.json(scheduleResponse());
    });

    // Body: { enabled, days: [0-6, Sun=0], time: 'HH:MM', saveSnapshot }
    app.post('/api/email/schedule', (req, res) => {
        try {
            wle.writeSchedule(req.body || {});
            res.json({ success: true, ...scheduleResponse() });
        } catch (e) {
            res.status(e.status || 500).json({ success: false, error: e.message });
        }
    });

    // Runs the full unattended job immediately. Body: { test } — test sends only to the Gmail account
    // itself and never saves history; a real run uses the schedule's saveSnapshot setting.
    app.post('/api/email/schedule/run-now', async (req, res) => {
        try {
            const test = req.body.test !== false;
            const result = await wle.runWeeklyJob({ test, trigger: 'run-now', saveSnapshot: wle.readSchedule().saveSnapshot });
            res.json({ success: true, ...result, ...scheduleResponse() });
        } catch (e) {
            res.status(e.status || 500).json({ success: false, error: e.message, ...scheduleResponse() });
        }
    });

    if (startScheduler) wle.startScheduler();
}

// Middleware for the static server: 404 for credential/run-output files
const blockPrivateFiles = (req, res, next) => (wle.isPrivatePath(req.path) ? res.status(404).end() : next());

module.exports = { register, blockPrivateFiles };
