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

    // Chart length settings (configurable: jira_config.json "chart", dashboard Edit / Trend Data,
    // GitHub variables CHART_MAX_POINTS / CHART_RECENT_WEEKS). 19 = the point count on Oct 16, 2026.
    const CHART_DEFAULTS = { maxPoints: 19, recentWeeks: 4 };
    const CHART_LIMITS = { maxPoints: [4, 60], recentWeeks: [1, 12] };

    // Whole numbers within limits, and never fewer points than protected recent weeks
    function normalizeChartOptions(options) {
        const o = options || {};
        const pick = (v, def, [lo, hi]) => {
            const n = parseInt(v, 10);
            return Math.min(hi, Math.max(lo, Number.isFinite(n) ? n : def));
        };
        const recentWeeks = pick(o.recentWeeks, CHART_DEFAULTS.recentWeeks, CHART_LIMITS.recentWeeks);
        const maxPoints = Math.max(recentWeeks, pick(o.maxPoints, CHART_DEFAULTS.maxPoints, CHART_LIMITS.maxPoints));
        return { maxPoints, recentWeeks };
    }

    const monthKey = (item) => {
        const d = new Date(item.date);
        return isNaN(d.getTime()) ? String(item.date).slice(0, 8) : `${d.getFullYear()}-${d.getMonth() + 1}`;
    };

    // Which history weeks become chart points (history itself is never changed):
    // - At most maxPoints points.
    // - Never hidden: the last recentWeeks weeks (incl. the newest) and the first week of every month.
    // - Over the limit: hide the oldest unprotected week first (in practice the previous month's week 2,
    //   then week 3, ...). If only protected weeks remain, hide the oldest point overall (left edge).
    function filterHistoryForChart(rawHistory, options) {
        const { maxPoints, recentWeeks } = normalizeChartOptions(options);
        const items = rawHistory || [];
        if (items.length <= maxPoints) return items.slice();

        const isProtected = items.map((item, i) => i >= items.length - recentWeeks);
        const seenMonths = new Set();
        items.forEach((item, i) => {
            const key = monthKey(item);
            if (!seenMonths.has(key)) {
                seenMonths.add(key);
                isProtected[i] = true;
            }
        });

        const keep = items.map(() => true);
        let count = items.length;
        // 1. Oldest unprotected weeks first
        for (let i = 0; i < items.length && count > maxPoints; i++) {
            if (!isProtected[i]) { keep[i] = false; count--; }
        }
        // 2. Still too many: oldest remaining points (old month anchors on the left edge)
        for (let i = 0; i < items.length && count > maxPoints; i++) {
            if (keep[i]) { keep[i] = false; count--; }
        }
        return items.filter((item, i) => keep[i]);
    }

    const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    // History/week date label, e.g. "Oct 20, 2026"
    function formatDateLabel(d) {
        return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
    }

    function buildJiraUrl(domain, jql) {
        const cleanDomain = (domain || 'cropin.atlassian.net').replace(/^https?:\/\//, '').replace(/\/.*$/, '');
        return `https://${cleanDomain}/issues?jql=${encodeURIComponent(jql || '')}`;
    }

    // The 6 card / "View in Jira" links, keyed like config.queries
    function buildJiraLinks(domain, queries) {
        const q = queries || {};
        const links = {};
        ['older_combined', 'older_highest', 'older_high', 'recent_combined', 'recent_highest', 'recent_high']
            .forEach(k => { links[k] = buildJiraUrl(domain, q[k]); });
        return links;
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
    // chartOptions: { maxPoints, recentWeeks } — see filterHistoryForChart
    function buildChartConfig(history, section, chartOptions) {
        const items = filterHistoryForChart(history, chartOptions);
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

    const api = { LAYOUT, CHART_DEFAULTS, CHART_LIMITS, normalizeChartOptions, COLORS, formatDateLabel, buildJiraUrl, buildJiraLinks, filterHistoryForChart, previousWeek, withCurrentWeek, buildChartConfig, buildEmailHtml };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.WebLegacyEmail = api;
})(typeof window !== 'undefined' ? window : this);
