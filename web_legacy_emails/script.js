// Web Legacy Emails - Jira Ticket Metrics & Weekly Summary

// State
let state = {
    config: {},
    history: [],
    currentCounts: {
        olderHighest: 0,
        olderHigh: 0,
        recentHighest: 0,
        recentHigh: 0,
        date: ''
    },
    lastFetchedAt: null, // set on a successful Jira fetch; null = showing saved history
    liveError: null,     // why the last Jira fetch failed (shown in the outdated-data banner)
    chartImages: {}      // latest rendered chart PNG data URLs (reused as email attachments)
};

// DOM References
const el = {
    // Badges & Actions
    lastUpdatedBadge: document.getElementById('lastUpdatedBadge'),
    fetchJiraBtn: document.getElementById('fetchJiraBtn'),
    manualEditBtn: document.getElementById('manualEditBtn'),
    saveSnapshotBtn: document.getElementById('saveSnapshotBtn'),
    settingsBtn: document.getElementById('settingsBtn'),
    emailBtn: document.getElementById('emailBtn'),

    // Digest preview, outdated-data banner, off-screen chart canvas host
    staleBanner: document.getElementById('staleBanner'),
    emailDigest: document.getElementById('emailDigest'),
    chartRenderArea: document.getElementById('chartRenderArea'),

    // Loading & Toast
    loadingOverlay: document.getElementById('loadingOverlay'),
    loadingText: document.getElementById('loadingText'),
    toast: document.getElementById('toast'),

    // Edit / Trend Data Modal (week entry + history table)
    manualEditModal: document.getElementById('manualEditModal'),
    closeManualEditModal: document.getElementById('closeManualEditModal'),
    cancelManualEditBtn: document.getElementById('cancelManualEditBtn'),
    editOlderHighest: document.getElementById('editOlderHighest'),
    editOlderHigh: document.getElementById('editOlderHigh'),
    editRecentHighest: document.getElementById('editRecentHighest'),
    editRecentHigh: document.getElementById('editRecentHigh'),
    editSnapshotDate: document.getElementById('editSnapshotDate'),
    historyTableBody: document.getElementById('historyTableBody'),
    saveAllHistoryBtn: document.getElementById('saveAllHistoryBtn'),

    // Settings Modal
    settingsModal: document.getElementById('settingsModal'),
    closeSettingsModal: document.getElementById('closeSettingsModal'),
    cancelSettingsBtn: document.getElementById('cancelSettingsBtn'),
    saveSettingsBtn: document.getElementById('saveSettingsBtn'),
    cfgJiraDomain: document.getElementById('cfgJiraDomain'),
    cfgJiraEmail: document.getElementById('cfgJiraEmail'),
    cfgJiraApiToken: document.getElementById('cfgJiraApiToken'),
    cfgQueryOlderCombined: document.getElementById('cfgQueryOlderCombined'),
    cfgQueryOlderHighest: document.getElementById('cfgQueryOlderHighest'),
    cfgQueryOlderHigh: document.getElementById('cfgQueryOlderHigh'),
    cfgQueryRecentCombined: document.getElementById('cfgQueryRecentCombined'),
    cfgQueryRecentHighest: document.getElementById('cfgQueryRecentHighest'),
    cfgQueryRecentHigh: document.getElementById('cfgQueryRecentHigh'),

    // Email Modal
    emailModal: document.getElementById('emailModal'),
    closeEmailModal: document.getElementById('closeEmailModal'),
    cancelEmailBtn: document.getElementById('cancelEmailBtn'),
    saveEmailSettingsBtn: document.getElementById('saveEmailSettingsBtn'),
    sendTestEmailBtn: document.getElementById('sendTestEmailBtn'),
    sendEmailBtn: document.getElementById('sendEmailBtn'),
    cfgEmailTo: document.getElementById('cfgEmailTo'),
    cfgEmailCc: document.getElementById('cfgEmailCc'),
    cfgEmailSubject: document.getElementById('cfgEmailSubject'),
    cfgSenderName: document.getElementById('cfgSenderName'),
    cfgGmailUser: document.getElementById('cfgGmailUser'),
    cfgGmailAppPassword: document.getElementById('cfgGmailAppPassword'),
    cfgEmailMode: document.getElementById('cfgEmailMode'),
    autoSendSection: document.getElementById('autoSendSection'),
    composeHint: document.getElementById('composeHint'),
    schEnabled: document.getElementById('schEnabled'),
    schDays: document.getElementById('schDays'),
    schTime: document.getElementById('schTime'),
    schSave: document.getElementById('schSave'),
    schStatus: document.getElementById('schStatus'),
    schRuns: document.getElementById('schRuns'),
    saveScheduleBtn: document.getElementById('saveScheduleBtn'),
    runNowTestBtn: document.getElementById('runNowTestBtn')
};

const DEFAULT_EMAIL_SUBJECT = 'Legacy Highest/High Issues – Web Application Weekly Jira Summary';

// Helpers
function showToast(msg, isError = false) {
    if (!el.toast) return;
    el.toast.textContent = msg;
    el.toast.style.borderLeftColor = isError ? '#ef4444' : '#10b981';
    el.toast.style.display = 'block';
    setTimeout(() => {
        el.toast.style.display = 'none';
    }, 4000);
}

function showLoading(msg = 'Fetching live counts from Jira...') {
    if (el.loadingOverlay) {
        el.loadingText.textContent = msg;
        el.loadingOverlay.style.display = 'flex';
    }
}

function hideLoading() {
    if (el.loadingOverlay) {
        el.loadingOverlay.style.display = 'none';
    }
}

// History dates are stored as "Oct 16, 2026"; date pickers use "2026-10-16"
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatDateLabel(d) {
    return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

function labelToIso(label) {
    const d = new Date(label);
    if (!label || isNaN(d.getTime())) return '';
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function isoToLabel(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    if (!m) return '';
    return formatDateLabel(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

function setCurrentFromLatestHistory() {
    if (state.history.length === 0) return;
    const latest = state.history[state.history.length - 1];
    state.currentCounts = {
        olderHighest: latest.olderHighest,
        olderHigh: latest.olderHigh,
        recentHighest: latest.recentHighest,
        recentHigh: latest.recentHigh,
        date: latest.date
    };
}

// True when the counts on screen match a stored history week exactly
function isCurrentSaved() {
    const c = state.currentCounts;
    return state.history.some(h => h.date === c.date &&
        h.olderHighest === c.olderHighest && h.olderHigh === c.olderHigh &&
        h.recentHighest === c.recentHighest && h.recentHigh === c.recentHigh);
}

// Renders a Chart.js config to a PNG data URL (2x for sharpness) using an off-screen canvas.
// core.js renders the same config server-side for scheduled sends.
function renderChartImage(config) {
    if (typeof Chart === 'undefined') {
        console.warn('Chart.js not loaded yet');
        return '';
    }
    if (typeof ChartDataLabels !== 'undefined' && !renderChartImage.pluginRegistered) {
        Chart.register(ChartDataLabels);
        renderChartImage.pluginRegistered = true;
    }

    const canvas = document.createElement('canvas');
    canvas.width = window.WebLegacyEmail.LAYOUT.chartWidth;
    canvas.height = window.WebLegacyEmail.LAYOUT.chartHeight;
    el.chartRenderArea.appendChild(canvas);
    config.options.devicePixelRatio = 2;

    const chart = new Chart(canvas.getContext('2d'), config);
    const src = chart.toBase64Image('image/png', 1);
    chart.destroy();
    canvas.remove();
    return src;
}

// Header badge: live Jira data vs. fallback to the last saved week
function renderBadge() {
    const c = state.currentCounts;
    if (state.lastFetchedAt) {
        const time = state.lastFetchedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        el.lastUpdatedBadge.textContent = `Live from Jira · ${time} · ${c.date} ${isCurrentSaved() ? '(saved)' : '(not saved)'}`;
        el.lastUpdatedBadge.style.color = '#10b981';
    } else if (c.date) {
        el.lastUpdatedBadge.textContent = `⚠ Not live — showing saved week ${c.date}`;
        el.lastUpdatedBadge.style.color = '#f59e0b';
    }

    // Outdated-data banner: only while showing saved history instead of live Jira data
    if (!state.lastFetchedAt) {
        el.staleBanner.innerHTML =
            `<strong>⚠ Showing saved local data, not live Jira data.</strong> ` +
            `Last available data: <strong>${c.date || 'none'}</strong> — it may be outdated.` +
            (state.liveError ? `<br><span style="opacity:0.85;">Reason: ${String(state.liveError).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</span>` : '') +
            `<br><span style="opacity:0.85;">Fix the issue and click ⚡ Refresh from Jira. Sending email is blocked until live data loads.</span>`;
        el.staleBanner.style.display = 'block';
    } else {
        el.staleBanner.style.display = 'none';
    }
}

// Digest HTML for the current state; chart image sources are passed in (data URLs on the page, cid: in the email)
function buildDigestHtml(chartSrcs) {
    const c = state.currentCounts;
    const tpl = window.WebLegacyEmail;
    return tpl.buildEmailHtml({
        date: c.date,
        counts: c,
        previous: tpl.previousWeek(state.history, c.date),
        links: tpl.buildJiraLinks(state.config.jiraDomain, state.config.queries),
        charts: chartSrcs,
        senderName: state.config.senderName
    });
}

// Rebuilds the email digest preview (cards, ▲/▼ vs last week, charts ending at the shown week) and the badge
function renderDigest() {
    renderBadge();

    const tpl = window.WebLegacyEmail;
    const chartHistory = tpl.withCurrentWeek(state.history, state.currentCounts);
    state.chartImages = {
        older: renderChartImage(tpl.buildChartConfig(chartHistory, 'older')),
        recent: renderChartImage(tpl.buildChartConfig(chartHistory, 'recent'))
    };
    el.emailDigest.innerHTML = buildDigestHtml(state.chartImages);
}

// Load Config & History from server, then always pull live counts from Jira
async function loadData() {
    try {
        const [resCfg, resHist] = await Promise.all([
            fetch('/api/jira/config'),
            fetch('/api/jira/history')
        ]);

        if (resCfg.ok) {
            state.config = await resCfg.json();
            populateSettingsModal();
        }

        if (resHist.ok) {
            state.history = await resHist.json();
        }
    } catch (e) {
        console.error('Failed to load initial data:', e);
        showToast('Error loading configuration or history', true);
        return;
    }

    // Live Jira data is the default view; saved history is only a fallback (with an outdated warning)
    if (state.config.hasApiToken && await fetchJiraCounts({ quiet: true })) return;

    if (!state.config.hasApiToken) state.liveError = 'Jira API token is not set (⚙️ Jira Settings)';
    setCurrentFromLatestHistory();
    renderDigest();
}

// Fetch Live Counts from Jira. Returns true on success.
// quiet: no settings prompt on failure (used on page load and before sending).
async function fetchJiraCounts({ quiet = false } = {}) {
    showLoading('Querying 4 Jira filters in parallel...');
    try {
        const res = await fetch('/api/jira/fetch-counts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({})
        });

        const data = await res.json();
        hideLoading();

        if (data.success && data.counts) {
            state.currentCounts = {
                olderHighest: data.counts.older.highest,
                olderHigh: data.counts.older.high,
                recentHighest: data.counts.recent.highest,
                recentHigh: data.counts.recent.high,
                date: formatDateLabel(new Date())
            };
            state.lastFetchedAt = new Date();
            state.liveError = null;

            // View only — stored when the user clicks Save Snapshot
            renderDigest();
            if (!quiet) showToast(`✓ Refreshed from Jira${data.fetchedAs ? ` as ${data.fetchedAs}` : ''}.`);
            return true;
        }

        console.error('Fetch counts failed:', data);
        state.liveError = data.error || 'Failed to fetch Jira counts';
        showToast(state.liveError, true);
        if (!quiet && confirm(`Could not fetch from Jira (${data.error || 'Authentication error'}).\n\nWould you like to open Jira Settings to enter an Atlassian API Token or verify queries?`)) {
            openSettingsModal();
        }
        return false;
    } catch (e) {
        hideLoading();
        console.error('Error fetching Jira counts:', e);
        state.liveError = 'Network error while querying Jira';
        showToast(state.liveError, true);
        return false;
    }
}

// Email modal: "Send Test to Me" only applies to button-triggered automatic sending.
// The Gmail login section stays visible because scheduled sending needs it in either mode.
function updateEmailModeUI() {
    const auto = el.cfgEmailMode.value === 'auto';
    el.sendTestEmailBtn.style.display = auto ? '' : 'none';
    el.composeHint.style.display = auto ? 'none' : '';
    el.sendEmailBtn.innerHTML = auto ? '<span>📧</span> Send Email Now' : '<span>📧</span> Send Email';
}

async function openEmailModal() {
    try {
        const cfg = await fetch('/api/email/config').then(r => r.json());
        el.cfgEmailMode.value = cfg.emailMode || 'compose';
        el.cfgEmailTo.value = cfg.recipients || '';
        el.cfgEmailCc.value = cfg.cc || '';
        el.cfgEmailSubject.value = cfg.subject || '';
        el.cfgSenderName.value = cfg.senderName || '';
        el.cfgGmailUser.value = cfg.gmailUser || '';
        el.cfgGmailAppPassword.value = '';
        el.cfgGmailAppPassword.placeholder = cfg.hasAppPassword
            ? 'App password saved — leave blank to keep it'
            : '16-character app password';
    } catch (e) {
        showToast('Error loading email settings', true);
    }
    updateEmailModeUI();
    loadSchedule();
    el.emailModal.style.display = 'flex';
}

// Returns true when saved
async function saveEmailSettings({ quiet = false } = {}) {
    try {
        const res = await fetch('/api/email/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                emailMode: el.cfgEmailMode.value,
                recipients: el.cfgEmailTo.value,
                cc: el.cfgEmailCc.value,
                subject: el.cfgEmailSubject.value,
                senderName: el.cfgSenderName.value,
                gmailUser: el.cfgGmailUser.value,
                gmailAppPassword: el.cfgGmailAppPassword.value.trim()
            })
        });
        const data = await res.json();
        if (!data.success) {
            showToast(data.error || 'Failed to save email settings', true);
            return false;
        }
        el.cfgGmailAppPassword.value = '';
        if (data.config.hasAppPassword) el.cfgGmailAppPassword.placeholder = 'App password saved — leave blank to keep it';
        state.config.senderName = data.config.senderName;
        if (!quiet) showToast('✓ Email settings saved');
        return true;
    } catch (e) {
        showToast('Error saving email settings', true);
        return false;
    }
}

const emailList = (value) => value.split(/[,;\n]/).map(s => s.trim()).filter(Boolean).join(',');

// Plain-text fallback for the clipboard (apps that can't paste HTML)
function buildDigestText() {
    const c = state.currentCounts;
    return `Hi Team,\n\n` +
        `Please find below the summary of open Highest/High priority issues in Jira related to the Web application.\n\n` +
        `Issues Older Than 30 Days: ${c.olderHighest + c.olderHigh} (Highest ${c.olderHighest}, High ${c.olderHigh})\n` +
        `Issues From Last 30 Days: ${c.recentHighest + c.recentHigh} (Highest ${c.recentHighest}, High ${c.recentHigh})\n\n` +
        `Thanks,\n${state.config.senderName || 'Rahul'}`;
}

// Copies the rendered digest (cards + chart images) as rich HTML; returns true on success
async function copyDigestToClipboard() {
    const html = buildDigestHtml(state.chartImages);
    try {
        await navigator.clipboard.write([new ClipboardItem({
            'text/html': new Blob([html], { type: 'text/html' }),
            'text/plain': new Blob([buildDigestText()], { type: 'text/plain' })
        })]);
        return true;
    } catch (e) {
        // Fallback: select the preview and copy it like a manual Ctrl+C
        console.warn('Clipboard API copy failed, using selection copy:', e);
        const range = document.createRange();
        range.selectNodeContents(el.emailDigest);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        const ok = document.execCommand('copy');
        sel.removeAllRanges();
        return ok;
    }
}

// Gmail's compose URL only accepts a plain-text body, so the body carries the paste instruction;
// Ctrl+A then Ctrl+V replaces it with the rich digest from the clipboard.
const COMPOSE_BODY_HINT = '▶ The report is copied. Click here, press Ctrl+A then Ctrl+V to replace this line with it.';

// Default send: copy the digest exactly as shown on the dashboard, open Gmail compose with
// To/CC/Subject filled in. No Jira re-query (the page already loads live data) and nothing is sent
// automatically — the user pastes, reviews and clicks Send in Gmail.
async function composeEmail() {
    const to = emailList(el.cfgEmailTo.value);
    if (!to) {
        showToast('Add at least one "To" address', true);
        return;
    }
    if (!state.lastFetchedAt &&
        !confirm(`The dashboard is showing saved data from ${state.currentCounts.date || 'an unknown date'}, not live Jira data.\n\nOpen Gmail with these numbers anyway?`)) {
        return;
    }
    if (!(await saveEmailSettings({ quiet: true }))) return;

    // Copy before opening Gmail: the clipboard needs this tab to still have focus
    const copied = await copyDigestToClipboard();
    const subject = (el.cfgEmailSubject.value.trim() || DEFAULT_EMAIL_SUBJECT).replace(/\{date\}/g, state.currentCounts.date);
    const gmailLink = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(to)}` +
        `&cc=${encodeURIComponent(emailList(el.cfgEmailCc.value))}&su=${encodeURIComponent(subject)}` +
        (copied ? `&body=${encodeURIComponent(COMPOSE_BODY_HINT)}` : '');

    const win = window.open(gmailLink, '_blank');
    if (!win) {
        // Popup blocked: offer a direct link
        el.composeHint.innerHTML = `Pop-up was blocked. <a href="${gmailLink}" target="_blank" style="color:#60a5fa;font-weight:700;">Open Gmail compose</a>, then press <strong>Ctrl+V</strong> in the message body.`;
        showToast('Pop-up blocked — use the "Open Gmail compose" link in the Email window.', true);
        return;
    }

    el.emailModal.style.display = 'none';
    showToast(copied
        ? '✓ Digest copied. In Gmail, click the message body and press Ctrl+V, then review and Send.'
        : 'Gmail opened, but copying failed — select the preview on this page, copy it, and paste into Gmail.', !copied);
}

// ---------- Scheduled sending (runs in the dashboard server, see core.js) ----------
const escapeText = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function renderSchedule({ schedule, nextRun, runs }) {
    el.schEnabled.checked = !!schedule.enabled;
    el.schTime.value = schedule.time;
    el.schSave.checked = schedule.saveSnapshot !== false;
    el.schDays.querySelectorAll('input').forEach(cb => { cb.checked = schedule.days.includes(Number(cb.value)); });

    el.schStatus.innerHTML = schedule.enabled && nextRun
        ? `<span style="color:#10b981;font-weight:700;">● Enabled</span> — next send: <strong>${new Date(nextRun).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</strong>`
        : '<span style="color:var(--text-secondary);font-weight:700;">○ Off</span> — nothing will be sent automatically';

    const label = { schedule: 'Scheduled', 'run-now': 'Run now', cli: 'Command line' };
    el.schRuns.innerHTML = runs.length
        ? 'Recent runs:<br>' + runs.slice(0, 5).map(r => {
            const when = new Date(r.at).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
            const what = r.ok
                ? (r.dryRun ? 'dry run (not sent)' : `sent${r.test ? ' (test)' : ''} → ${escapeText((r.to || []).join(', '))}`)
                : `failed: ${escapeText(r.error)}`;
            return `${r.ok ? '✅' : '❌'} ${when} · ${label[r.trigger] || r.trigger} · ${what}`;
        }).join('<br>')
        : 'No runs yet.';
}

async function loadSchedule() {
    try {
        renderSchedule(await fetch('/api/email/schedule').then(r => r.json()));
    } catch (e) {
        el.schStatus.textContent = 'Could not load schedule';
    }
}

async function saveSchedule() {
    // To/CC and Gmail login are needed by the scheduler too, so store them first
    if (!(await saveEmailSettings({ quiet: true }))) return;
    try {
        const res = await fetch('/api/email/schedule', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                enabled: el.schEnabled.checked,
                days: [...el.schDays.querySelectorAll('input:checked')].map(cb => Number(cb.value)),
                time: el.schTime.value,
                saveSnapshot: el.schSave.checked
            })
        });
        const data = await res.json();
        if (!data.success) {
            showToast(data.error || 'Failed to save schedule', true);
            return;
        }
        renderSchedule(data);
        // Spell out the next send so a day/time mismatch (e.g. time today but only Fri ticked) is obvious
        showToast(data.schedule.enabled && data.nextRun
            ? `✓ Schedule on — next send: ${new Date(data.nextRun).toLocaleString([], { weekday: 'long', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`
            : '✓ Schedule saved (off)');
    } catch (e) {
        showToast('Error saving schedule', true);
    }
}

// Runs the exact unattended job now (live Jira fetch, server-rendered charts) but only to the Gmail account itself
async function runScheduleTestNow() {
    if (!(await saveEmailSettings({ quiet: true }))) return;
    showLoading('Running the scheduled job (test to me)...');
    try {
        const res = await fetch('/api/email/schedule/run-now', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ test: true })
        });
        const data = await res.json();
        hideLoading();
        if (data.schedule) renderSchedule(data);
        showToast(data.success ? `✓ Test sent to ${data.to.join(', ')} — check your inbox` : (data.error || 'Run failed'), !data.success);
    } catch (e) {
        hideLoading();
        showToast('Network error while running the job', true);
    }
}

// Automatic send (Send Method = auto only): saves settings, refreshes counts from Jira
// (never sends stale numbers), then sends via the server. test=true sends only to the Gmail account itself.
async function sendEmail({ test = false } = {}) {
    if (!(await saveEmailSettings({ quiet: true }))) return;

    if (!test) {
        const to = el.cfgEmailTo.value.trim();
        const cc = el.cfgEmailCc.value.trim();
        if (!to) {
            showToast('Add at least one "To" address', true);
            return;
        }
        if (!confirm(`Send the weekly summary now?\n\nTo: ${to}${cc ? `\nCC: ${cc}` : ''}\n\nCounts will be refreshed from Jira first.`)) return;
    }

    if (!(await fetchJiraCounts({ quiet: true }))) {
        showToast('Not sent: could not get fresh counts from Jira.', true);
        return;
    }

    showLoading(test ? 'Sending test email...' : 'Sending email...');
    try {
        const res = await fetch('/api/email/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/vnd.web-legacy-email+json' },
            body: JSON.stringify({
                html: buildDigestHtml({ older: 'cid:older-trend', recent: 'cid:recent-trend' }),
                date: state.currentCounts.date,
                charts: state.chartImages,
                test
            })
        });
        const data = await res.json();
        hideLoading();
        if (data.success) {
            el.emailModal.style.display = 'none';
            showToast(`✓ ${test ? 'Test email' : 'Email'} sent to ${data.to.join(', ')}${data.cc && data.cc.length ? ` (cc ${data.cc.join(', ')})` : ''}`);
        } else {
            showToast(data.error || 'Failed to send email', true);
        }
    } catch (e) {
        hideLoading();
        showToast('Network error while sending email', true);
    }
}

// History Table (inside the Edit / Trend Data modal)
function renderHistoryTable() {
    el.historyTableBody.innerHTML = '';
    // Latest week on top; data-idx keeps the real (chronological) index for saving/deleting
    for (let idx = state.history.length - 1; idx >= 0; idx--) {
        const row = state.history[idx];
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><input type="date" value="${labelToIso(row.date)}" data-idx="${idx}" data-field="date"></td>
            <td><input type="number" value="${row.olderHighest}" data-idx="${idx}" data-field="olderHighest" style="width: 70px;"></td>
            <td><input type="number" value="${row.olderHigh}" data-idx="${idx}" data-field="olderHigh" style="width: 70px;"></td>
            <td><input type="number" value="${row.recentHighest}" data-idx="${idx}" data-field="recentHighest" style="width: 70px;"></td>
            <td><input type="number" value="${row.recentHigh}" data-idx="${idx}" data-field="recentHigh" style="width: 70px;"></td>
            <td>
                <button style="background:none; border:none; cursor:pointer; color:#ef4444; font-size:1.1rem;" title="Delete row" onclick="window._deleteHistoryRow(${idx})">🗑️</button>
            </td>
        `;
        el.historyTableBody.appendChild(tr);
    }
}

window._deleteHistoryRow = (idx) => {
    state.history.splice(idx, 1);
    renderHistoryTable();
};

// After any history save: charts redraw; cards keep live Jira counts, or fall back to the latest saved week
function applySavedHistory(history) {
    state.history = history;
    if (!state.lastFetchedAt) setCurrentFromLatestHistory();
    renderDigest();
}

async function saveAllHistory() {
    const edited = state.history.map(row => ({ ...row }));
    const inputs = el.historyTableBody.querySelectorAll('input');
    for (const input of inputs) {
        const idx = parseInt(input.dataset.idx, 10);
        const field = input.dataset.field;
        if (field === 'date') {
            const label = isoToLabel(input.value);
            if (!label) {
                showToast(`Row ${idx + 1} has no date`, true);
                return;
            }
            edited[idx].date = label;
        } else {
            edited[idx][field] = Number(input.value) || 0;
        }
    }

    try {
        const res = await fetch('/api/jira/history', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(edited)
        });

        const data = await res.json();
        if (data.success) {
            applySavedHistory(data.history);
            renderHistoryTable();
            showToast('✓ History updated and charts refreshed!');
        } else {
            showToast(data.error || 'Failed to save history', true);
        }
    } catch (e) {
        showToast('Error saving history array', true);
    }
}

// Settings modal
function populateSettingsModal() {
    const q = state.config.queries || {};
    el.cfgJiraDomain.value = state.config.jiraDomain || 'cropin.atlassian.net';
    el.cfgJiraEmail.value = state.config.jiraEmail || '';
    // The server never returns the token; blank on save keeps the stored one
    el.cfgJiraApiToken.value = '';
    el.cfgJiraApiToken.placeholder = state.config.hasApiToken
        ? 'Token saved — leave blank to keep it'
        : 'Generated from id.atlassian.com';

    el.cfgQueryOlderCombined.value = q.older_combined || '';
    el.cfgQueryOlderHighest.value = q.older_highest || '';
    el.cfgQueryOlderHigh.value = q.older_high || '';

    el.cfgQueryRecentCombined.value = q.recent_combined || '';
    el.cfgQueryRecentHighest.value = q.recent_highest || '';
    el.cfgQueryRecentHigh.value = q.recent_high || '';
}

function openSettingsModal() {
    populateSettingsModal();
    el.settingsModal.style.display = 'flex';
}

async function saveSettings() {
    const updated = {
        jiraDomain: el.cfgJiraDomain.value.trim(),
        jiraEmail: el.cfgJiraEmail.value.trim(),
        jiraApiToken: el.cfgJiraApiToken.value.trim(),
        queries: {
            older_combined: el.cfgQueryOlderCombined.value.trim(),
            older_highest: el.cfgQueryOlderHighest.value.trim(),
            older_high: el.cfgQueryOlderHigh.value.trim(),
            recent_combined: el.cfgQueryRecentCombined.value.trim(),
            recent_highest: el.cfgQueryRecentHighest.value.trim(),
            recent_high: el.cfgQueryRecentHigh.value.trim()
        }
    };

    try {
        const res = await fetch('/api/jira/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updated)
        });

        const data = await res.json();
        if (data.success) {
            state.config = data.config;
            renderDigest();
            el.settingsModal.style.display = 'none';
            showToast('✓ Jira settings and queries saved!');
        } else {
            showToast('Failed to save settings', true);
        }
    } catch (e) {
        showToast('Error saving settings', true);
    }
}

// Edit / Trend Data Modal
function openManualEditModal() {
    el.editOlderHighest.value = state.currentCounts.olderHighest;
    el.editOlderHigh.value = state.currentCounts.olderHigh;
    el.editRecentHighest.value = state.currentCounts.recentHighest;
    el.editRecentHigh.value = state.currentCounts.recentHigh;
    el.editSnapshotDate.value = labelToIso(state.currentCounts.date) || labelToIso(formatDateLabel(new Date()));
    renderHistoryTable();
    el.manualEditModal.style.display = 'flex';
}

// Reads the week entry form; null (with a toast) when no date is picked
function readWeekForm() {
    const date = isoToLabel(el.editSnapshotDate.value);
    if (!date) {
        showToast('Pick a week date first', true);
        return null;
    }
    return {
        olderHighest: Number(el.editOlderHighest.value) || 0,
        olderHigh: Number(el.editOlderHigh.value) || 0,
        recentHighest: Number(el.editRecentHighest.value) || 0,
        recentHigh: Number(el.editRecentHigh.value) || 0,
        date
    };
}

// Stores the form's week in history (same date replaces that week); modal stays open to show the row
async function saveCurrentSnapshot() {
    const week = readWeekForm();
    if (!week) return;

    try {
        const res = await fetch('/api/jira/history', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(week)
        });

        const data = await res.json();
        if (data.success && data.history) {
            applySavedHistory(data.history);
            renderHistoryTable();
            showToast(`✓ Snapshot saved for ${week.date}. Trend charts updated.`);
        } else {
            showToast(data.error || 'Failed to save snapshot', true);
        }
    } catch (e) {
        console.error('Error saving snapshot:', e);
        showToast('Error saving snapshot to history', true);
    }
}

// Event Listeners
function setupEventListeners() {
    if (el.fetchJiraBtn) el.fetchJiraBtn.addEventListener('click', () => fetchJiraCounts());
    if (el.saveSnapshotBtn) el.saveSnapshotBtn.addEventListener('click', saveCurrentSnapshot);

    // Edit / Trend Data
    if (el.manualEditBtn) el.manualEditBtn.addEventListener('click', openManualEditModal);
    if (el.closeManualEditModal) el.closeManualEditModal.addEventListener('click', () => el.manualEditModal.style.display = 'none');
    if (el.cancelManualEditBtn) el.cancelManualEditBtn.addEventListener('click', () => el.manualEditModal.style.display = 'none');
    if (el.saveAllHistoryBtn) el.saveAllHistoryBtn.addEventListener('click', saveAllHistory);

    // Settings Modal
    if (el.settingsBtn) el.settingsBtn.addEventListener('click', openSettingsModal);
    if (el.closeSettingsModal) el.closeSettingsModal.addEventListener('click', () => el.settingsModal.style.display = 'none');
    if (el.cancelSettingsBtn) el.cancelSettingsBtn.addEventListener('click', () => el.settingsModal.style.display = 'none');
    if (el.saveSettingsBtn) el.saveSettingsBtn.addEventListener('click', saveSettings);

    // Email Modal
    if (el.emailBtn) el.emailBtn.addEventListener('click', openEmailModal);
    if (el.closeEmailModal) el.closeEmailModal.addEventListener('click', () => el.emailModal.style.display = 'none');
    if (el.cancelEmailBtn) el.cancelEmailBtn.addEventListener('click', () => el.emailModal.style.display = 'none');
    if (el.saveEmailSettingsBtn) el.saveEmailSettingsBtn.addEventListener('click', () => saveEmailSettings());
    if (el.sendTestEmailBtn) el.sendTestEmailBtn.addEventListener('click', () => sendEmail({ test: true }));
    if (el.sendEmailBtn) el.sendEmailBtn.addEventListener('click', () => (el.cfgEmailMode.value === 'auto' ? sendEmail() : composeEmail()));
    if (el.saveScheduleBtn) el.saveScheduleBtn.addEventListener('click', saveSchedule);
    if (el.runNowTestBtn) el.runNowTestBtn.addEventListener('click', runScheduleTestNow);
    if (el.cfgEmailMode) el.cfgEmailMode.addEventListener('change', updateEmailModeUI);

    // Chrome only opens the calendar from the small icon; open it on any click in a date field
    document.addEventListener('click', (e) => {
        if (e.target.matches && e.target.matches('input[type="date"]') && e.target.showPicker) {
            try { e.target.showPicker(); } catch (err) { /* picker already open or not allowed */ }
        }
    });

    // Modals close only via their × or Cancel button (no outside-click close, so typed input isn't lost)
}

// Init
document.addEventListener('DOMContentLoaded', () => {
    setupEventListeners();
    loadData();
});
