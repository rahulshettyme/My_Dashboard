// Web Legacy Emails - shared digest builder.
// Used by the page preview (browser global `WebLegacyEmail`) and, later, the Node email sender
// (module.exports), so the preview is exactly what gets sent.
// Output must stay email-safe: tables + inline styles only (no classes, flex, grid or <style>),
// charts passed in as <img> sources.
(function (root) {
    // Email width and chart image size (chart = email width minus section/card padding).
    // The page renders chart canvases at this size so preview and email match.
    const LAYOUT = { emailWidth: 900, chartWidth: 820, chartHeight: 320 };

    const COLORS = {
        highest: '#ef4444',
        high: '#f59e0b',
        headerBg: '#1e3a8a',
        title: '#1e3a8a',
        text: '#1e293b',
        muted: '#64748b',
        border: '#e2e8f0',
        up: '#dc2626',     // more bugs = bad
        down: '#16a34a',   // fewer bugs = good
        same: '#64748b'
    };

    // Filter history for charts according to the progressive monthly rollover rule:
    // 1. All records for past months (older than previous month) retain ONLY their 1st week entry.
    // 2. For the previous month, as N new weekly entries are added in the current month:
    //    - Week 1 of previous month is always kept as the monthly anchor.
    //    - Intermediate weeks (week 2, week 3, ...) are progressively hidden from the start (i.e. week 2 is hidden first when N=1, week 3 when N=2, etc.).
    // 3. For the current active month: all weekly entries are displayed.
    function filterHistoryForChart(rawHistory) {
        if (!rawHistory || rawHistory.length <= 1) return rawHistory || [];

        const monthGroups = new Map();
        rawHistory.forEach(item => {
            const d = new Date(item.date);
            const key = isNaN(d.getTime())
                ? item.date.slice(0, 8)
                : (d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'));
            if (!monthGroups.has(key)) {
                monthGroups.set(key, []);
            }
            monthGroups.get(key).push(item);
        });

        const monthKeys = Array.from(monthGroups.keys());
        if (monthKeys.length === 1) return rawHistory;

        const currentMonthKey = monthKeys[monthKeys.length - 1];
        const prevMonthKey = monthKeys[monthKeys.length - 2];
        const olderMonthKeys = monthKeys.slice(0, monthKeys.length - 2);

        const filtered = [];

        // 1. Older months: keep only 1st week
        olderMonthKeys.forEach(mKey => {
            const entries = monthGroups.get(mKey);
            if (entries && entries.length > 0) {
                filtered.push(entries[0]);
            }
        });

        // 2. Previous month: progressive retirement based on count in current month
        const currentMonthEntries = monthGroups.get(currentMonthKey) || [];
        const prevMonthEntries = monthGroups.get(prevMonthKey) || [];
        const nAdded = currentMonthEntries.length;

        prevMonthEntries.forEach((entry, idx) => {
            // idx 0 = monthly anchor (always kept); idx N is retired once nAdded >= N
            if (idx === 0 || idx > nAdded) {
                filtered.push(entry);
            }
        });

        // 3. Current month: all entries visible
        currentMonthEntries.forEach(entry => {
            filtered.push(entry);
        });

        return filtered;
    }

    // Latest history week strictly before `date` (the comparison point for ▲/▼); null if none
    function previousWeek(history, date) {
        const t = new Date(date).getTime();
        if (!date || isNaN(t)) return null;
        let prev = null;
        (history || []).forEach(h => {
            const ht = new Date(h.date).getTime();
            if (!isNaN(ht) && ht < t && (!prev || ht >= new Date(prev.date).getTime())) prev = h;
        });
        return prev;
    }

    // History plus the week on screen (e.g. freshly fetched, not yet saved), so charts always end
    // at the numbers shown on the cards. Same date replaces that week; otherwise inserted in date order.
    function withCurrentWeek(history, current) {
        const list = (history || []).filter(h => !current || h.date !== current.date);
        if (!current || !current.date || isNaN(new Date(current.date).getTime())) return history || [];
        const week = {
            date: current.date,
            olderHighest: current.olderHighest,
            olderHigh: current.olderHigh,
            recentHighest: current.recentHighest,
            recentHigh: current.recentHigh
        };
        const t = new Date(current.date).getTime();
        const idx = list.findIndex(h => new Date(h.date).getTime() > t);
        if (idx < 0) list.push(week);
        else list.splice(idx, 0, week);
        return list;
    }

    // Chart.js config for one section's trend image. section: 'older' | 'recent'.
    // Highest = red and High = amber in both charts.
    function buildChartConfig(history, section) {
        const items = filterHistoryForChart(history);
        const key = section === 'older' ? 'older' : 'recent';
        const line = (label, data, color) => ({
            label,
            data,
            borderColor: color,
            backgroundColor: color,
            borderWidth: 2,
            pointRadius: 3,
            tension: 0.1,
            fill: false
        });

        return {
            type: 'line',
            data: {
                labels: items.map(i => i.date),
                datasets: [
                    line('Highest Priority', items.map(i => i[key + 'Highest']), COLORS.highest),
                    line('High Priority', items.map(i => i[key + 'High']), COLORS.high)
                ]
            },
            options: {
                responsive: false,
                animation: false,
                layout: { padding: { top: 18, right: 12 } },
                plugins: {
                    legend: { display: false },
                    tooltip: { enabled: false },
                    datalabels: {
                        align: 'top',
                        anchor: 'center',
                        offset: 2,
                        color: '#334155',
                        font: { size: 10, weight: 600, family: 'Arial, sans-serif' },
                        formatter: (value) => value
                    }
                },
                scales: {
                    x: {
                        grid: { color: '#f1f5f9' },
                        ticks: { font: { size: 9, family: 'Arial, sans-serif' }, color: '#64748b', maxRotation: 45, minRotation: 45 }
                    },
                    y: {
                        beginAtZero: true,
                        grid: { color: '#f1f5f9' },
                        ticks: { font: { size: 10, family: 'Arial, sans-serif' }, color: '#64748b', precision: 0 }
                    }
                }
            }
        };
    }

    function escapeHtml(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function deltaHtml(current, previous) {
        if (previous == null || isNaN(previous)) return '';
        const diff = current - previous;
        const [color, text] = diff > 0
            ? [COLORS.up, `&#9650; ${diff} vs last week`]
            : diff < 0
                ? [COLORS.down, `&#9660; ${-diff} vs last week`]
                : [COLORS.same, '&ndash; no change vs last week'];
        return `<div style="font-size:12px;font-weight:700;color:${color};margin:2px 0 4px 0;">${text}</div>`;
    }

    const CARD_THEMES = {
        total: { bg: '#f8fafc', border: '#e2e8f0', accent: '#2563eb', label: '#475569', value: '#0f172a', sub: '#64748b' },
        highest: { bg: '#fef2f2', border: '#fee2e2', accent: COLORS.highest, label: '#dc2626', value: '#dc2626', sub: '#b91c1c' },
        high: { bg: '#fffbeb', border: '#fef3c7', accent: COLORS.high, label: '#d97706', value: '#d97706', sub: '#b45309' }
    };

    function cardHtml(theme, label, value, previous, sub, href) {
        const t = CARD_THEMES[theme];
        const dot = theme === 'total' ? '' : `<span style="color:${t.accent};">&#9679;</span> `;
        return `
<td width="33%" valign="top" style="padding:0 6px;">
  <a href="${escapeHtml(href)}" target="_blank" style="text-decoration:none;color:inherit;display:block;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${t.bg};border:1px solid ${t.border};border-left:5px solid ${t.accent};border-radius:8px;">
      <tr><td style="padding:14px 16px;font-family:Arial,sans-serif;">
        <div style="font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:${t.label};">${dot}${label}</div>
        <div style="font-size:34px;font-weight:800;line-height:1.15;color:${t.value};margin-top:6px;">${escapeHtml(value)}</div>
        ${deltaHtml(value, previous)}
        ${sub ? `<div style="font-size:12px;color:${t.sub};">${sub}</div>` : ''}
      </td></tr>
    </table>
  </a>
</td>`;
    }

    function legendHtml() {
        const item = (color, text) =>
            `<span style="display:inline-block;margin:0 10px;"><span style="display:inline-block;width:10px;height:10px;background:${color};border-radius:2px;"></span> ${text}</span>`;
        return item(COLORS.highest, 'Highest Priority') + item(COLORS.high, 'High Priority');
    }

    function sectionHtml(s) {
        return `
<tr><td style="padding:0 24px 24px 24px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${COLORS.border};border-radius:12px;">
    <tr><td style="padding:18px 14px 6px 14px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td style="padding:0 6px;font-family:Arial,sans-serif;font-size:19px;font-weight:700;color:${COLORS.title};">${s.title}</td>
          <td align="right" style="padding:0 6px;">
            <a href="${escapeHtml(s.link)}" target="_blank" style="display:inline-block;background:#1d4ed8;color:#ffffff;text-decoration:none;font-family:Arial,sans-serif;font-size:13px;font-weight:700;padding:8px 16px;border-radius:6px;">View in Jira &rarr;</a>
          </td>
        </tr>
      </table>
    </td></tr>
    <tr><td style="padding:10px 8px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${s.cards}</tr></table>
    </td></tr>
    <tr><td style="padding:8px 14px 16px 14px;" align="center">
      <div style="font-family:Arial,sans-serif;font-size:14px;font-weight:700;color:${COLORS.text};margin-bottom:4px;">${s.chartTitle}</div>
      <div style="font-family:Arial,sans-serif;font-size:12px;font-weight:600;color:#475569;margin-bottom:8px;">${legendHtml()}</div>
      ${s.chartSrc ? `<img src="${escapeHtml(s.chartSrc)}" width="${LAYOUT.chartWidth}" alt="${s.chartTitle}" style="display:block;width:100%;max-width:${LAYOUT.chartWidth}px;height:auto;border:0;">` : ''}
    </td></tr>
  </table>
</td></tr>`;
    }

    // data: { date, counts:{olderHighest,olderHigh,recentHighest,recentHigh}, previous (history row or null),
    //         links:{older_combined,older_highest,older_high,recent_combined,recent_highest,recent_high},
    //         charts:{older,recent} (img src), senderName }
    function buildEmailHtml(data) {
        const c = data.counts;
        const p = data.previous;
        const links = data.links || {};
        const charts = data.charts || {};
        const prev = (f) => (p ? p[f] : null);
        const prevTotal = (a, b) => (p ? p[a] + p[b] : null);

        const olderCards =
            cardHtml('total', 'Total Open Issues', c.olderHighest + c.olderHigh, prevTotal('olderHighest', 'olderHigh'), '', links.older_combined) +
            cardHtml('highest', 'Highest Priority', c.olderHighest, prev('olderHighest'), '', links.older_highest) +
            cardHtml('high', 'High Priority', c.olderHigh, prev('olderHigh'), '', links.older_high);

        const recentCards =
            cardHtml('total', 'Total Recent Issues', c.recentHighest + c.recentHigh, prevTotal('recentHighest', 'recentHigh'), '', links.recent_combined) +
            cardHtml('highest', 'Highest Priority', c.recentHighest, prev('recentHighest'), '', links.recent_highest) +
            cardHtml('high', 'High Priority', c.recentHigh, prev('recentHigh'), '', links.recent_high);

        return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;">
<tr><td align="center" style="padding:16px 8px;">
<table role="presentation" width="${LAYOUT.emailWidth}" cellpadding="0" cellspacing="0" style="width:100%;max-width:${LAYOUT.emailWidth}px;background:#ffffff;border:1px solid ${COLORS.border};border-radius:12px;">
  <tr><td style="background:${COLORS.headerBg};border-radius:12px 12px 0 0;padding:18px 24px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
      <td style="font-family:Arial,sans-serif;color:#ffffff;font-size:18px;font-weight:800;letter-spacing:0.02em;">Web Bugs &middot; Weekly Summary</td>
      <td align="right" style="font-family:Arial,sans-serif;color:#bfdbfe;font-size:13px;font-weight:600;">${data.date ? 'Week of ' + escapeHtml(data.date) : ''}</td>
    </tr></table>
  </td></tr>
  <tr><td style="padding:22px 24px 18px 24px;font-family:Arial,sans-serif;font-size:15px;line-height:1.6;color:#334155;">
    Hi Team,<br><br>
    Please find below the summary of open Highest/High priority issues in Jira related to the Web application.
  </td></tr>
  ${sectionHtml({ title: 'Issues Older Than 30 Days', link: links.older_combined, cards: olderCards, chartTitle: 'Older Than 30 Days &mdash; Trend', chartSrc: charts.older })}
  ${sectionHtml({ title: 'Issues From Last 30 Days', link: links.recent_combined, cards: recentCards, chartTitle: 'Issues From Last 30 Days &mdash; Trend', chartSrc: charts.recent })}
  <tr><td style="padding:0 24px 24px 24px;font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#475569;">
    Thanks,<br><strong style="color:${COLORS.text};">${escapeHtml(data.senderName || 'Rahul')}</strong>
  </td></tr>
</table>
</td></tr>
</table>`;
    }

    const api = { LAYOUT, COLORS, filterHistoryForChart, previousWeek, withCurrentWeek, buildChartConfig, buildEmailHtml };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.WebLegacyEmail = api;
})(typeof window !== 'undefined' ? window : this);
