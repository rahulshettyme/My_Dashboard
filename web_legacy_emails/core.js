// Web Legacy Emails - Node-side core (no Express, no browser).
// Config/history/credential files, Jira counts, chart PNG rendering, Gmail sending and the
// weekly job + scheduler. Used by server.js (/api/jira/*, /api/email/*, in-server scheduler)
// and send_weekly.js (CLI for Windows Task Scheduler / GitHub Actions).
const fs = require('fs');
const path = require('path');
const https = require('https');
const tpl = require('./email_template.js');

const FILES = {
    history: path.join(__dirname, 'jira_weekly_history.json'),
    config: path.join(__dirname, 'jira_config.json'),
    jiraCredentials: path.join(__dirname, 'jira_credentials.json'),   // gitignored
    emailCredentials: path.join(__dirname, 'email_credentials.json'), // gitignored
    runLog: path.join(__dirname, 'schedule_runs.json'),               // gitignored
    preview: path.join(__dirname, 'last_scheduled_preview.html'),     // gitignored (dry runs)
    lastSent: path.join(__dirname, 'last_scheduled_send.json')        // GitHub Actions "already sent today" marker (committed there)
};

const EMAIL_MODES = ['compose', 'auto'];
const DEFAULT_EMAIL_SUBJECT = 'Legacy Highest/High Issues – Web Application Weekly Jira Summary';
const DEFAULT_SCHEDULE = { enabled: false, days: [5], time: '10:00', saveSnapshot: true };
const RUN_LOG_LIMIT = 50;

// Files that must never be served over HTTP (the static server shares the whole project folder)
const PRIVATE_FILES = new Set(['jira_credentials.json', 'email_credentials.json', 'schedule_runs.json', 'last_scheduled_preview.html']);

// True when a request path points at a private file. Decodes the URL and normalises the name the
// way Windows resolves it (case-insensitive, trailing dots/spaces and ":stream" suffixes ignored).
function isPrivatePath(urlPath) {
    let decoded;
    try {
        decoded = decodeURIComponent(urlPath);
    } catch (e) {
        return true; // malformed encoding: refuse
    }
    const name = decoded.split(/[\\/]/).pop().toLowerCase().replace(/:.*$/, '').replace(/[.\s]+$/, '');
    return PRIVATE_FILES.has(name);
}

// Error carrying the HTTP status the routes should answer with
class JobError extends Error {
    constructor(message, status = 500) {
        super(message);
        this.status = status;
    }
}

// ---------- Files ----------
function readJson(file, fallback) {
    try {
        if (!fs.existsSync(file)) return fallback;
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) {
        console.error(`[WebLegacyEmails] Error reading ${path.basename(file)}:`, e.message);
        return fallback;
    }
}

function writeJson(file, data) {
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

const readConfig = () => readJson(FILES.config, {});
const writeConfig = (data) => writeJson(FILES.config, data);

// Keeps history chronological so back-dated weeks land in place (charts and "latest" rely on order)
function sortHistory(data) {
    const time = (h) => {
        const t = new Date(h.date).getTime();
        return isNaN(t) ? Infinity : t;
    };
    return [...data].sort((a, b) => time(a) - time(b));
}

const readHistory = () => readJson(FILES.history, []);
const writeHistory = (data) => writeJson(FILES.history, sortHistory(data));

// Same date (case-insensitive) replaces that week; returns the new sorted history
function upsertHistory(entry) {
    const week = {
        date: entry.date,
        olderHighest: Number(entry.olderHighest) || 0,
        olderHigh: Number(entry.olderHigh) || 0,
        recentHighest: Number(entry.recentHighest) || 0,
        recentHigh: Number(entry.recentHigh) || 0
    };
    const history = readHistory().filter(h => h.date.toLowerCase() !== week.date.toLowerCase());
    history.push(week);
    const sorted = sortHistory(history);
    writeJson(FILES.history, sorted);
    return sorted;
}

// Raw file contents — use these for read-modify-write so env secrets are never copied into files
const readJiraCredentialsFile = () => readJson(FILES.jiraCredentials, {});
const readEmailCredentialsFile = () => readJson(FILES.emailCredentials, {});

// Effective credentials: environment variables win over the files (GitHub Actions secrets)
function readJiraCredentials() {
    const creds = readJiraCredentialsFile();
    return {
        jiraEmail: process.env.JIRA_EMAIL || creds.jiraEmail || '',
        jiraApiToken: process.env.JIRA_API_TOKEN || creds.jiraApiToken || ''
    };
}

const writeJiraCredentials = (data) => writeJson(FILES.jiraCredentials, data);

function readEmailCredentials() {
    const creds = readEmailCredentialsFile();
    return {
        gmailUser: process.env.GMAIL_USER || creds.gmailUser || '',
        gmailAppPassword: process.env.GMAIL_APP_PASSWORD || creds.gmailAppPassword || ''
    };
}

const writeEmailCredentials = (data) => writeJson(FILES.emailCredentials, data);

// One-time move of credentials that older versions stored inside jira_config.json
function migrateLegacyCredentials() {
    const config = readConfig();
    if (config.jiraApiToken === undefined && config.jiraEmail === undefined) return;
    const creds = readJson(FILES.jiraCredentials, {});
    if (config.jiraEmail && !creds.jiraEmail) creds.jiraEmail = config.jiraEmail;
    if (config.jiraApiToken && !creds.jiraApiToken) creds.jiraApiToken = config.jiraApiToken;
    delete config.jiraEmail;
    delete config.jiraApiToken;
    writeJiraCredentials(creds);
    writeConfig(config);
}

// ---------- Jira ----------
// base = { host, prefix }: the Jira site itself, or the api.atlassian.com gateway (see resolveJiraBase)
function jiraRequest(base, method, apiPath, authHeader, body) {
    return new Promise((resolve, reject) => {
        const payload = body ? JSON.stringify(body) : null;
        const options = {
            hostname: base.host,
            port: 443,
            path: base.prefix + apiPath,
            method,
            headers: {
                'Accept': 'application/json',
                'User-Agent': 'MyDashboard-JiraMetrics/1.0',
                'Authorization': authHeader,
                ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {})
            }
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    try {
                        resolve(JSON.parse(data));
                    } catch (e) {
                        reject(new Error(`Failed to parse Jira response: ${e.message}`));
                    }
                } else {
                    const err = new Error(`Jira API HTTP ${res.statusCode}: ${data.slice(0, 250)}`);
                    err.statusCode = res.statusCode;
                    reject(err);
                }
            });
        });

        req.on('error', err => reject(err));
        req.setTimeout(15000, () => {
            req.destroy();
            reject(new Error('Jira API request timed out after 15s'));
        });
        if (payload) req.write(payload);
        req.end();
    });
}

// Exact count: pages through the enhanced JQL search (ids only). The legacy
// /rest/api/3/search endpoint returns 410 Gone, and /search/approximate-count is not exact.
async function fetchJiraCount(base, jql, authHeader) {
    let count = 0;
    let nextPageToken;
    do {
        const page = await jiraRequest(base, 'POST', '/rest/api/3/search/jql', authHeader, {
            jql,
            fields: ['id'],
            maxResults: 100,
            ...(nextPageToken ? { nextPageToken } : {})
        });
        count += (page.issues || []).length;
        nextPageToken = page.isLast === false ? page.nextPageToken : undefined;
    } while (nextPageToken);
    return count;
}

const isJiraAuthError = (e) => e.statusCode === 401 || e.statusCode === 403;

// Classic API tokens work on the site URL; scoped tokens ("Create API token with scopes")
// are rejected there (401) and only work via api.atlassian.com/ex/jira/<cloudId>.
// Tries the site first, then the gateway. Returns { base, account }; rethrows the auth error if both fail.
async function resolveJiraBase(domain, authHeader) {
    const host = domain.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    const siteBase = { host, prefix: '' };
    try {
        return { base: siteBase, account: await jiraRequest(siteBase, 'GET', '/rest/api/3/myself', authHeader) };
    } catch (siteErr) {
        if (!isJiraAuthError(siteErr)) throw siteErr;

        const tenantRes = await fetch(`https://${host}/_edge/tenant_info`);
        const { cloudId } = tenantRes.ok ? await tenantRes.json() : {};
        if (!cloudId) throw siteErr;

        const gatewayBase = { host: 'api.atlassian.com', prefix: `/ex/jira/${cloudId}` };
        return { base: gatewayBase, account: await jiraRequest(gatewayBase, 'GET', '/rest/api/3/myself', authHeader) };
    }
}

// Live counts for the 4 count queries. Returns { counts: {olderHighest, olderHigh, recentHighest, recentHigh}, fetchedAs }.
// Throws JobError (400 config, 401 auth, 500 other).
async function fetchCounts() {
    const config = readConfig();
    const { jiraEmail, jiraApiToken } = readJiraCredentials();

    // Anonymous Jira searches return 200 with zero results, so never query without credentials
    if (!jiraEmail || !jiraApiToken) {
        throw new JobError('Jira email and API token are not configured. Add them in Jira Settings.', 400);
    }
    const authHeader = 'Basic ' + Buffer.from(`${jiraEmail}:${jiraApiToken}`).toString('base64');

    const { older_highest, older_high, recent_highest, recent_high } = config.queries || {};
    if (!older_highest || !older_high || !recent_highest || !recent_high) {
        throw new JobError('One or more required JQL queries are missing', 400);
    }

    // Verify credentials first so a bad token is reported clearly instead of as zero counts
    let base, account;
    try {
        ({ base, account } = await resolveJiraBase(config.jiraDomain || 'cropin.atlassian.net', authHeader));
    } catch (e) {
        if (isJiraAuthError(e)) throw new JobError('Jira rejected the email/API token. Check them in Jira Settings.', 401);
        throw new JobError(e.message, 500);
    }

    try {
        const [olderHighest, olderHigh, recentHighest, recentHigh] = await Promise.all([
            fetchJiraCount(base, older_highest, authHeader),
            fetchJiraCount(base, older_high, authHeader),
            fetchJiraCount(base, recent_highest, authHeader),
            fetchJiraCount(base, recent_high, authHeader)
        ]);
        return {
            counts: { olderHighest, olderHigh, recentHighest, recentHigh },
            fetchedAs: account.displayName || account.emailAddress || ''
        };
    } catch (e) {
        throw new JobError(e.message, 500);
    }
}

// ---------- Email ----------
// "a@x.com, b@x.com; c@x.com" -> ['a@x.com', 'b@x.com', 'c@x.com']
const parseEmailList = (value) => String(value || '').split(/[,;\n]/).map(s => s.trim()).filter(Boolean);
const isValidEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

// Effective To/CC: EMAIL_TO / EMAIL_CC environment variables (GitHub repository variables) win over
// jira_config.json when set and non-empty; the dashboard UI edits the config file.
// Effective chart settings: CHART_MAX_POINTS / CHART_RECENT_WEEKS environment variables (GitHub repository
// variables) win over jira_config.json "chart"; always normalised to safe limits.
function readChartOptions(config = readConfig()) {
    const c = config.chart || {};
    return tpl.normalizeChartOptions({
        maxPoints: process.env.CHART_MAX_POINTS || c.maxPoints,
        recentWeeks: process.env.CHART_RECENT_WEEKS || c.recentWeeks
    });
}

function readRecipients(config = readConfig()) {
    return {
        to: parseEmailList(process.env.EMAIL_TO || config.recipients),
        cc: parseEmailList(process.env.EMAIL_CC || config.cc),
        source: { to: process.env.EMAIL_TO ? 'EMAIL_TO' : 'config', cc: process.env.EMAIL_CC ? 'EMAIL_CC' : 'config' }
    };
}

const buildSubject = (config, date, test) => {
    const subject = (config.subject || DEFAULT_EMAIL_SUBJECT).replace(/\{date\}/g, date || '');
    return test ? `[TEST] ${subject}` : subject;
};

// Sends via Gmail SMTP. charts: { older, recent } PNG Buffers, referenced in html as cid:older-trend / cid:recent-trend.
// test=true sends only to the Gmail account itself (no CC). Returns { to, cc, subject, messageId, accepted, rejected }.
async function sendDigestMail({ html, date, charts = {}, test = false }) {
    const config = readConfig();
    const { gmailUser, gmailAppPassword } = readEmailCredentials();
    if (!gmailUser || !gmailAppPassword) {
        throw new JobError('Gmail address and app password are not configured. Add them in Email settings.', 400);
    }

    const recipients = readRecipients(config);
    const to = test ? [gmailUser] : recipients.to;
    const cc = test ? [] : recipients.cc;
    if (to.length === 0) throw new JobError('No "To" recipients configured. Add them in Email settings (or the EMAIL_TO variable).', 400);
    const invalid = [...to, ...cc].filter(e => !isValidEmail(e));
    if (invalid.length) throw new JobError(`Invalid email address: ${invalid.join(', ')}`, 400);

    const subject = buildSubject(config, date, test);
    const attachments = Object.entries({ 'older-trend': charts.older, 'recent-trend': charts.recent })
        .filter(([, buf]) => Buffer.isBuffer(buf))
        .map(([cid, content]) => ({ filename: `${cid}.png`, content, contentType: 'image/png', cid }));

    const nodemailer = require('nodemailer');
    const transporter = nodemailer.createTransport({
        host: 'smtp.gmail.com',
        port: 465,
        secure: true,
        auth: { user: gmailUser, pass: gmailAppPassword }
    });

    try {
        const info = await transporter.sendMail({
            from: config.senderName ? `"${config.senderName}" <${gmailUser}>` : gmailUser,
            to,
            cc,
            subject,
            html: `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="margin:0;padding:0;">${html}</body></html>`,
            attachments
        });
        return { to, cc, subject, messageId: info.messageId, accepted: info.accepted, rejected: info.rejected };
    } catch (e) {
        const authFailed = e.code === 'EAUTH' || /Username and Password not accepted|Invalid login/i.test(e.message);
        throw authFailed
            ? new JobError('Gmail rejected the login. Use a Google App Password (not your normal password) in Email settings.', 401)
            : new JobError(e.message, 500);
    }
}

// ---------- Charts (server-side, same config as the page) ----------
let chartLib = null;
function getChartLib() {
    if (!chartLib) {
        const { createCanvas } = require('@napi-rs/canvas');
        const { Chart } = require('chart.js/auto');
        Chart.register(require('chartjs-plugin-datalabels'));
        chartLib = { createCanvas, Chart };
    }
    return chartLib;
}

// PNG Buffer for one section's trend chart, at 2x for sharpness
function renderChartPng(history, section, chartOptions) {
    const { createCanvas, Chart } = getChartLib();
    const config = tpl.buildChartConfig(history, section, chartOptions);
    config.options.devicePixelRatio = 2;
    const canvas = createCanvas(tpl.LAYOUT.chartWidth, tpl.LAYOUT.chartHeight);
    const chart = new Chart(canvas.getContext('2d'), config);
    chart.draw();
    const png = canvas.toBuffer('image/png');
    chart.destroy();
    return png;
}

// ---------- Weekly job ----------
function readRunLog() {
    return readJson(FILES.runLog, []);
}

function appendRunLog(entry) {
    const log = [entry, ...readRunLog()].slice(0, RUN_LOG_LIMIT);
    writeJson(FILES.runLog, log);
}

// Full unattended run: live Jira counts → charts → email → (optional) save week to history.
// Never sends if the Jira fetch fails. Options:
//   test: send only to the Gmail account itself, never saves history
//   dryRun: build everything, write last_scheduled_preview.html, send nothing, save nothing
//   saveSnapshot: store today's counts in history after a successful real send
//   trigger: 'schedule' | 'run-now' | 'cli' (logged)
//   scheduledRun: GitHub scheduled run — a late run after midnight is dated the previous evening
async function runWeeklyJob({ test = false, dryRun = false, saveSnapshot = true, trigger = 'cli', slot = null, scheduledRun = false } = {}) {
    const startedAt = new Date();
    const logBase = { at: startedAt.toISOString(), trigger, slot, test, dryRun };
    try {
        const config = readConfig();
        const { counts, fetchedAs } = await fetchCounts();
        const date = tpl.formatDateLabel(scheduledRun ? scheduledEvening(startedAt) : startedAt);
        const history = readHistory();
        const chartHistory = tpl.withCurrentWeek(history, { ...counts, date });
        const chartOptions = readChartOptions(config);
        const pngs = { older: renderChartPng(chartHistory, 'older', chartOptions), recent: renderChartPng(chartHistory, 'recent', chartOptions) };

        const buildHtml = (charts) => tpl.buildEmailHtml({
            date,
            counts,
            previous: tpl.previousWeek(history, date),
            links: tpl.buildJiraLinks(config.jiraDomain, config.queries),
            charts,
            senderName: config.senderName
        });

        if (dryRun) {
            const dataUrl = (buf) => `data:image/png;base64,${buf.toString('base64')}`;
            fs.writeFileSync(FILES.preview,
                `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${buildSubject(config, date, false)}</title></head><body style="margin:0;">` +
                buildHtml({ older: dataUrl(pngs.older), recent: dataUrl(pngs.recent) }) + '</body></html>', 'utf8');
            const result = { ok: true, date, counts, fetchedAs, previewFile: FILES.preview };
            appendRunLog({ ...logBase, ok: true, date, counts, note: 'dry run, nothing sent' });
            return result;
        }

        const sent = await sendDigestMail({
            html: buildHtml({ older: 'cid:older-trend', recent: 'cid:recent-trend' }),
            date,
            charts: pngs,
            test
        });

        const saved = saveSnapshot && !test;
        if (saved) upsertHistory({ ...counts, date });

        appendRunLog({ ...logBase, ok: true, date, counts, to: sent.to, cc: sent.cc, subject: sent.subject, savedSnapshot: saved });
        return { ok: true, date, counts, fetchedAs, ...sent, savedSnapshot: saved };
    } catch (e) {
        appendRunLog({ ...logBase, ok: false, error: e.message });
        throw e instanceof JobError ? e : new JobError(e.message, 500);
    }
}

// ---------- Scheduler (runs inside the dashboard server; PC must be on and server running) ----------
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// ---------- GitHub Actions "is it due?" check (no npm dependencies needed) ----------
// GitHub cron is fixed and often late, so the workflow wakes every 30 min in a window and asks this:
// due = today is one of SEND_DAYS, local time >= SEND_TIME, and nothing was sent today yet.
const DEFAULT_SEND_DAYS = 'Fri';
const DEFAULT_SEND_TIME = '17:30';

// "Fri" / "mon, fri" / "Monday;Thursday" / "5" → [1, 5]-style day numbers (0 = Sun). Throws on unknown names.
function parseSendDays(value) {
    const parts = String(value || DEFAULT_SEND_DAYS).split(/[,;\s]+/).filter(Boolean);
    const days = parts.map(p => {
        if (/^[0-6]$/.test(p)) return Number(p);
        const idx = DAY_NAMES.findIndex(d => d.toLowerCase() === p.slice(0, 3).toLowerCase());
        if (idx < 0) throw new JobError(`Unknown day in SEND_DAYS: "${p}" (use Mon, Tue, Wed, Thu, Fri, Sat, Sun)`, 400);
        return idx;
    });
    return [...new Set(days)].sort();
}

function parseSendTime(value) {
    const time = String(value || DEFAULT_SEND_TIME).trim();
    const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(time);
    if (!m) throw new JobError(`SEND_TIME must be HH:MM in 24-hour IST, e.g. 17:30 (got "${time}")`, 400);
    return { hh: Number(m[1]), mm: Number(m[2]), label: `${m[1].padStart(2, '0')}:${m[2]}` };
}

const readLastSent = () => readJson(FILES.lastSent, null);
const writeLastSent = (entry) => writeJson(FILES.lastSent, entry);

// GitHub can start a scheduled run hours late (a 00:00 IST slot was seen starting at 01:48).
// The wake-up window is evening-only, so any run before this hour is a late run of the previous
// evening and is evaluated as that day at 23:59.
const LATE_RUN_CUTOFF_HOUR = 6;

// The evening a scheduled run belongs to: itself, or the previous day 23:59 for a late run before the cutoff
function scheduledEvening(now = new Date()) {
    return now.getHours() < LATE_RUN_CUTOFF_HOUR
        ? new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 23, 59)
        : now;
}

// { due, reason } for the given moment (local time — the workflow sets TZ=Asia/Kolkata).
// mode: 'send' | 'test' — a marker only blocks the same mode, so a scheduled test today doesn't
// stop a real send later today.
function isSendDue({ days, time, mode = 'send', now = new Date(), lastSent = readLastSent() } = {}) {
    const dayList = parseSendDays(days);
    const t = parseSendTime(time);
    let lateNote = '';
    if (now.getHours() < LATE_RUN_CUTOFF_HOUR) {
        lateNote = ` — late run at ${DAY_NAMES[now.getDay()]} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}, counted as previous evening`;
        now = scheduledEvening(now);
    }
    const today = tpl.formatDateLabel(now);
    const dayNames = dayList.map(d => DAY_NAMES[d]).join(', ');
    const nowLabel = `${DAY_NAMES[now.getDay()]} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    if (!dayList.includes(now.getDay())) return { due: false, reason: `Not a send day (${nowLabel}; SEND_DAYS = ${dayNames})${lateNote}` };
    if (now.getHours() * 60 + now.getMinutes() < t.hh * 60 + t.mm) return { due: false, reason: `Too early (${nowLabel}; SEND_TIME = ${t.label})${lateNote}` };
    if (lastSent && lastSent.date === today && lastSent.mode === mode) return { due: false, reason: `Already sent today (${lastSent.mode} at ${lastSent.at})${lateNote}` };
    return { due: true, reason: `Due (${nowLabel}; SEND_DAYS = ${dayNames}, SEND_TIME = ${t.label})${lateNote}` };
}

function readSchedule() {
    const s = { ...DEFAULT_SCHEDULE, ...(readConfig().schedule || {}) };
    s.days = (Array.isArray(s.days) ? s.days : []).map(Number).filter(d => d >= 0 && d <= 6);
    return s;
}

// Validates and stores { enabled, days: [0-6], time: 'HH:MM', saveSnapshot }
function writeSchedule(input) {
    const days = Array.isArray(input.days) ? [...new Set(input.days.map(Number))].filter(d => Number.isInteger(d) && d >= 0 && d <= 6).sort() : [];
    const time = String(input.time || '');
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new JobError('Time must be HH:MM (24-hour)', 400);
    if (input.enabled && days.length === 0) throw new JobError('Pick at least one day to enable the schedule', 400);
    const schedule = { enabled: !!input.enabled, days, time, saveSnapshot: input.saveSnapshot !== false };
    writeConfig({ ...readConfig(), schedule });
    return schedule;
}

// Next run as a local Date (null when disabled)
function nextScheduledRun(schedule, from = new Date()) {
    if (!schedule.enabled || schedule.days.length === 0) return null;
    const [hh, mm] = schedule.time.split(':').map(Number);
    for (let i = 0; i <= 7; i++) {
        const d = new Date(from.getFullYear(), from.getMonth(), from.getDate() + i, hh, mm, 0, 0);
        if (schedule.days.includes(d.getDay()) && d > from) return d;
    }
    return null;
}

// "2026-10-23 10:00" — one run per slot, even across server restarts within the same minute
const slotKey = (d, time) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${time}`;

let schedulerTimer = null;
// job is injectable for tests; returns stop()
function startScheduler({ intervalMs = 30000, job = runWeeklyJob } = {}) {
    if (schedulerTimer) return stopScheduler;
    let running = false;
    let lastSlot = null;
    schedulerTimer = setInterval(async () => {
        const schedule = readSchedule();
        if (!schedule.enabled || running) return;
        const now = new Date();
        const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
        if (!schedule.days.includes(now.getDay()) || hhmm !== schedule.time) return;

        // One run per slot: in memory, and via the run log across server restarts
        const slot = slotKey(now, schedule.time);
        if (slot === lastSlot || readRunLog().some(r => r.trigger === 'schedule' && r.slot === slot)) return;
        lastSlot = slot;

        running = true;
        console.log(`[WebLegacyEmails] Scheduled send starting (${slot})`);
        try {
            const result = await job({ trigger: 'schedule', slot, saveSnapshot: schedule.saveSnapshot });
            console.log(`[WebLegacyEmails] Scheduled send OK → ${result.to.join(', ')}`);
        } catch (e) {
            console.error(`[WebLegacyEmails] Scheduled send FAILED: ${e.message}`);
        } finally {
            running = false;
        }
    }, intervalMs);
    console.log('[WebLegacyEmails] Scheduler started');
    return stopScheduler;
}

function stopScheduler() {
    clearInterval(schedulerTimer);
    schedulerTimer = null;
}

module.exports = {
    FILES, PRIVATE_FILES, isPrivatePath, EMAIL_MODES, DEFAULT_EMAIL_SUBJECT, DAY_NAMES, JobError,
    readConfig, writeConfig, readHistory, writeHistory, upsertHistory, sortHistory,
    readJiraCredentials, readJiraCredentialsFile, writeJiraCredentials,
    readEmailCredentials, readEmailCredentialsFile, writeEmailCredentials, migrateLegacyCredentials,
    fetchCounts, parseEmailList, isValidEmail, readRecipients, readChartOptions, buildSubject, sendDigestMail, renderChartPng,
    readRunLog, runWeeklyJob, readSchedule, writeSchedule, nextScheduledRun, startScheduler, stopScheduler,
    DEFAULT_SEND_DAYS, DEFAULT_SEND_TIME, parseSendDays, parseSendTime, isSendDue, scheduledEvening, readLastSent, writeLastSent
};
