// Web Legacy Emails — module-scoped regression suite.
// Run from the project root with: node web_legacy_emails/tests/run_tests.js
// Deliberately independent of the root `node run_tests.js` (Health/Yield/Growth suite).
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// Ratchets forward to tests.length after every task — represents "tests that existed
// before the CURRENT task's changes", not a fixed historical constant.
const baselineCount = 21;

const MODULE_DIR = path.join(__dirname, '..');

// Load script.js in a sandbox with minimal browser globals so its top-level DOM lookups no-op
function loadScript() {
    const src = fs.readFileSync(path.join(MODULE_DIR, 'script.js'), 'utf8');
    const ctx = {
        document: { getElementById: () => null, addEventListener: () => {} },
        window: {},
        console
    };
    vm.createContext(ctx);
    vm.runInContext(src, ctx);
    return ctx;
}

const script = loadScript();
const tpl = require(path.join(MODULE_DIR, 'email_template.js'));
// Array.from re-creates the array in this realm (vm sandbox arrays fail deepStrictEqual otherwise)
const dates = (items) => Array.from(items, i => i.date);
const week = (date) => ({ date, olderHighest: 0, olderHigh: 0, recentHighest: 0, recentHigh: 0 });

const tests = [
    {
        name: 'filterHistoryForChart: empty / single entry passthrough',
        fn: () => {
            assert.deepStrictEqual(dates(tpl.filterHistoryForChart([])), []);
            assert.deepStrictEqual(dates(tpl.filterHistoryForChart(null)), []);
            assert.deepStrictEqual(dates(tpl.filterHistoryForChart([week('Oct 2, 2026')])), ['Oct 2, 2026']);
        }
    },
    {
        name: 'filterHistoryForChart: within the limit every week is shown',
        fn: () => {
            const h = [week('Sep 4, 2026'), week('Sep 11, 2026'), week('Sep 18, 2026'), week('Oct 2, 2026'), week('Oct 9, 2026')];
            assert.deepStrictEqual(dates(tpl.filterHistoryForChart(h)), dates(h), 'Default limit 19 > 5 weeks');
            assert.deepStrictEqual(dates(tpl.filterHistoryForChart(h, { maxPoints: 5, recentWeeks: 4 })), dates(h), 'Exactly at the limit');
        }
    },
    {
        name: 'filterHistoryForChart: over the limit hides oldest unprotected week; month first-weeks + last N never hidden',
        fn: () => {
            const sep = [week('Sep 4, 2026'), week('Sep 11, 2026'), week('Sep 18, 2026'), week('Sep 25, 2026')];
            const oct = [week('Oct 2, 2026'), week('Oct 9, 2026'), week('Oct 16, 2026')];
            // 7 weeks, limit 6: Sep 11 (oldest unprotected) goes; Sep 4 = Sep's first week, last 4 = Sep 25..Oct 16
            assert.deepStrictEqual(dates(tpl.filterHistoryForChart([...sep, ...oct], { maxPoints: 6, recentWeeks: 4 })),
                ['Sep 4, 2026', 'Sep 18, 2026', 'Sep 25, 2026', 'Oct 2, 2026', 'Oct 9, 2026', 'Oct 16, 2026']);
            // limit 5: Sep 18 goes next
            assert.deepStrictEqual(dates(tpl.filterHistoryForChart([...sep, ...oct], { maxPoints: 5, recentWeeks: 4 })),
                ['Sep 4, 2026', 'Sep 25, 2026', 'Oct 2, 2026', 'Oct 9, 2026', 'Oct 16, 2026']);
            // limit 4: only protected left (Sep 4 + last 4) -> oldest point overall (Sep 4) is dropped
            assert.deepStrictEqual(dates(tpl.filterHistoryForChart([...sep, ...oct], { maxPoints: 4, recentWeeks: 4 })),
                ['Sep 25, 2026', 'Oct 2, 2026', 'Oct 9, 2026', 'Oct 16, 2026']);
        }
    },
    {
        name: 'filterHistoryForChart: settings are normalised (whole numbers, limits, maxPoints >= recentWeeks)',
        fn: () => {
            assert.deepStrictEqual({ ...tpl.normalizeChartOptions() }, { maxPoints: 19, recentWeeks: 4 }, 'Defaults');
            assert.deepStrictEqual({ ...tpl.normalizeChartOptions({ maxPoints: '20', recentWeeks: '6' }) }, { maxPoints: 20, recentWeeks: 6 }, 'Strings from variables');
            assert.deepStrictEqual({ ...tpl.normalizeChartOptions({ maxPoints: 2, recentWeeks: 8 }) }, { maxPoints: 8, recentWeeks: 8 }, 'maxPoints raised to recentWeeks');
            assert.deepStrictEqual({ ...tpl.normalizeChartOptions({ maxPoints: 999, recentWeeks: 0 }) }, { maxPoints: 60, recentWeeks: 1 }, 'Clamped to limits');
            assert.deepStrictEqual({ ...tpl.normalizeChartOptions({ maxPoints: 'abc', recentWeeks: '' }) }, { maxPoints: 19, recentWeeks: 4 }, 'Invalid -> defaults');
        }
    },
    {
        name: 'filterHistoryForChart: real jira_weekly_history.json ends at the latest week, within the limit, last 4 shown',
        fn: () => {
            const history = JSON.parse(fs.readFileSync(path.join(MODULE_DIR, 'jira_weekly_history.json'), 'utf8'));
            const filtered = tpl.filterHistoryForChart(history);
            const shown = new Set(Array.from(filtered, x => x.date));
            assert.strictEqual(filtered[filtered.length - 1].date, history[history.length - 1].date, 'Latest entry must be the last chart point');
            assert.ok(filtered.length <= tpl.CHART_DEFAULTS.maxPoints, 'Never more than the default limit');
            assert.ok(history.slice(-4).every(x => shown.has(x.date)), 'Last 4 weeks shown');
        }
    },
    {
        name: 'filterHistoryForChart: 3 more years of weekly data — exact length, last N + month first-weeks always shown, for several settings',
        fn: () => {
            const history = JSON.parse(fs.readFileSync(path.join(MODULE_DIR, 'jira_weekly_history.json'), 'utf8'));
            const firstOfMonth = (h) => {
                const m = new Map();
                h.forEach(x => { const t = new Date(x.date); const k = `${t.getFullYear()}-${t.getMonth()}`; if (!m.has(k)) m.set(k, x); });
                return [...m.values()];
            };
            [undefined, { maxPoints: 20, recentWeeks: 4 }, { maxPoints: 12, recentWeeks: 6 }].forEach(opts => {
                const o = tpl.normalizeChartOptions(opts);
                const h = [...history];
                let d = new Date(new Date(h[h.length - 1].date).getTime() + 7 * 864e5);
                let prevFirst = null;
                for (let i = 0; i < 156; i++) {
                    h.push(week(tpl.formatDateLabel(d)));
                    const f = tpl.filterHistoryForChart(h, opts);
                    const shown = new Set(Array.from(f, x => x.date));
                    const first = new Date(f[0].date);
                    const label = `${JSON.stringify(o)} week ${i}`;
                    assert.strictEqual(f.length, o.maxPoints, `${label}: length`);
                    assert.ok(h.slice(-o.recentWeeks).every(x => shown.has(x.date)), `${label}: last ${o.recentWeeks} weeks shown`);
                    assert.ok(firstOfMonth(h).filter(a => new Date(a.date) >= first).every(a => shown.has(a.date)), `${label}: month first-weeks shown`);
                    assert.ok(!prevFirst || first >= prevFirst, `${label}: left edge only moves forward`);
                    prevFirst = first;
                    d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7);
                }
            });
        }
    },
    {
        name: 'labelToIso / isoToLabel: calendar picker <-> stored "Mon D, YYYY" round-trip',
        fn: () => {
            assert.strictEqual(script.labelToIso('Oct 5, 2026'), '2026-10-05');
            assert.strictEqual(script.isoToLabel('2026-10-05'), 'Oct 5, 2026');
            assert.strictEqual(script.isoToLabel(script.labelToIso('Jun 20, 2025')), 'Jun 20, 2025');
            assert.strictEqual(script.labelToIso(''), '');
            assert.strictEqual(script.isoToLabel(''), '');
        }
    },
    {
        name: 'previousWeek: latest history week strictly before the given date',
        fn: () => {
            const h = [week('Sep 25, 2026'), week('Oct 2, 2026'), week('Oct 9, 2026')];
            assert.strictEqual(tpl.previousWeek(h, 'Oct 9, 2026').date, 'Oct 2, 2026', 'Saved week compares to the week before it');
            assert.strictEqual(tpl.previousWeek(h, 'Oct 19, 2026').date, 'Oct 9, 2026', 'Unsaved newer week compares to latest saved');
            assert.strictEqual(tpl.previousWeek(h, 'Sep 25, 2026'), null, 'First week has no previous');
            assert.strictEqual(tpl.previousWeek(h, ''), null);
        }
    },
    {
        name: 'buildEmailHtml: email-safe markup, header date, ▲/▼ deltas and Jira links',
        fn: () => {
            const html = tpl.buildEmailHtml({
                date: 'Oct 16, 2026',
                counts: { olderHighest: 1, olderHigh: 43, recentHighest: 2, recentHigh: 1 },
                previous: { date: 'Oct 9, 2026', olderHighest: 1, olderHigh: 44, recentHighest: 0, recentHigh: 1 },
                links: { older_combined: 'https://x/older', older_highest: 'https://x/oh', older_high: 'https://x/o',
                         recent_combined: 'https://x/recent', recent_highest: 'https://x/rh', recent_high: 'https://x/r' },
                charts: { older: 'cid:older', recent: 'cid:recent' }
            });
            assert.ok(!/class=|<style|display:\s*(flex|grid)/i.test(html), 'Must use inline styles only (no classes/style blocks/flex/grid)');
            assert.ok(html.includes('Week of Oct 16, 2026'), 'Header band shows the week date');
            assert.ok(html.includes('Web Bugs &middot; Weekly Summary'), 'Header band title');
            assert.ok(html.includes(`max-width:${tpl.LAYOUT.emailWidth}px`) && html.includes(`max-width:${tpl.LAYOUT.chartWidth}px`), 'Email and chart widths come from LAYOUT');
            assert.ok(html.includes('&#9660; 1 vs last week'), 'Older High 44 -> 43 shows ▼ 1');
            assert.ok(html.includes('&#9650; 2 vs last week'), 'Recent Highest 0 -> 2 shows ▲ 2');
            assert.ok(html.includes('&ndash; no change vs last week'), 'Unchanged counts say no change');
            assert.ok(html.includes('href="https://x/older"') && html.includes('src="cid:recent"'), 'Links and chart images are wired');
            assert.ok(html.includes('Hi Team,<br><br>'), 'Blank line between greeting and body');
            assert.ok(html.includes('Please find below the summary of open Highest/High priority issues in Jira related to the Web application.'), 'Intro sentence');
            assert.ok(!/Immediate attention required|Target for sprint resolution|Opened in the last 30 days|Older than 30 days/.test(html), 'Removed card sub-texts stay removed');
        }
    },
    {
        name: 'withCurrentWeek: charts end at the live (unsaved) week; same date replaces; history untouched',
        fn: () => {
            const h = [week('Oct 2, 2026'), week('Oct 9, 2026')];
            const live = { date: 'Oct 19, 2026', olderHighest: 1, olderHigh: 43, recentHighest: 0, recentHigh: 1 };
            assert.deepStrictEqual(dates(tpl.withCurrentWeek(h, live)), ['Oct 2, 2026', 'Oct 9, 2026', 'Oct 19, 2026']);

            const replaced = tpl.withCurrentWeek(h, { ...live, date: 'Oct 9, 2026' });
            assert.deepStrictEqual(dates(replaced), ['Oct 2, 2026', 'Oct 9, 2026']);
            assert.strictEqual(replaced[1].olderHigh, 43, 'Live counts replace the saved week with the same date');

            assert.strictEqual(h.length, 2, 'Original history array is not mutated');
            assert.deepStrictEqual(dates(tpl.withCurrentWeek(h, { ...live, date: '' })), dates(h), 'No date -> history unchanged');
        }
    },
    {
        name: 'buildChartConfig: both charts use red Highest and amber High',
        fn: () => {
            const h = [week('Oct 2, 2026'), week('Oct 9, 2026')];
            ['older', 'recent'].forEach(section => {
                const ds = tpl.buildChartConfig(h, section).data.datasets;
                assert.strictEqual(ds[0].borderColor, tpl.COLORS.highest, `${section} Highest colour`);
                assert.strictEqual(ds[1].borderColor, tpl.COLORS.high, `${section} High colour`);
            });
        }
    },
    {
        name: 'core.renderChartPng: renders a PNG server-side (no browser) at 2x LAYOUT size',
        fn: () => {
            const core = require(path.join(MODULE_DIR, 'core.js'));
            const png = core.renderChartPng([week('Oct 2, 2026'), week('Oct 9, 2026')], 'recent');
            assert.ok(Buffer.isBuffer(png) && png.length > 1000, 'PNG buffer produced');
            assert.strictEqual(png.slice(1, 4).toString(), 'PNG', 'PNG signature');
            assert.strictEqual(png.readUInt32BE(16), tpl.LAYOUT.chartWidth * 2, 'Width is 2x chartWidth');
            assert.strictEqual(png.readUInt32BE(20), tpl.LAYOUT.chartHeight * 2, 'Height is 2x chartHeight');
        }
    },
    {
        name: 'core.nextScheduledRun / writeSchedule validation / buildSubject',
        fn: () => {
            const core = require(path.join(MODULE_DIR, 'core.js'));
            const tue = new Date(2026, 9, 20, 9, 0); // Tue Oct 20, 2026 09:00
            const fri10 = core.nextScheduledRun({ enabled: true, days: [5], time: '10:00' }, tue);
            assert.strictEqual(fri10.toDateString(), new Date(2026, 9, 23).toDateString(), 'Next Friday');
            assert.strictEqual(fri10.getHours(), 10);
            assert.strictEqual(core.nextScheduledRun({ enabled: true, days: [2], time: '09:30' }, tue).getDate(), 20, 'Later today counts');
            assert.strictEqual(core.nextScheduledRun({ enabled: true, days: [2], time: '08:00' }, tue).getDate(), 27, 'Earlier today -> next week');
            assert.strictEqual(core.nextScheduledRun({ enabled: false, days: [5], time: '10:00' }, tue), null, 'Disabled -> null');

            // Invalid input is rejected before anything is written
            assert.throws(() => core.writeSchedule({ enabled: true, days: [5], time: '25:00' }), /HH:MM/);
            assert.throws(() => core.writeSchedule({ enabled: true, days: [], time: '10:00' }), /at least one day/);

            assert.strictEqual(core.buildSubject({ subject: 'S {date}' }, 'Oct 20, 2026', false), 'S Oct 20, 2026');
            assert.strictEqual(core.buildSubject({}, '', true), `[TEST] ${core.DEFAULT_EMAIL_SUBJECT}`);
        }
    },
    {
        name: 'core.readRecipients: EMAIL_TO / EMAIL_CC env (GitHub variables) override config To/CC',
        fn: () => {
            const core = require(path.join(MODULE_DIR, 'core.js'));
            const config = { recipients: 'a@x.com, b@x.com', cc: 'c@x.com' };
            const saved = { to: process.env.EMAIL_TO, cc: process.env.EMAIL_CC };
            try {
                delete process.env.EMAIL_TO;
                delete process.env.EMAIL_CC;
                let r = core.readRecipients(config);
                assert.deepStrictEqual([r.to, r.cc, r.source.to], [['a@x.com', 'b@x.com'], ['c@x.com'], 'config']);

                process.env.EMAIL_TO = 'team@x.com; lead@x.com';
                r = core.readRecipients(config);
                assert.deepStrictEqual(r.to, ['team@x.com', 'lead@x.com'], 'EMAIL_TO wins');
                assert.deepStrictEqual(r.cc, ['c@x.com'], 'CC still from config when EMAIL_CC unset');
                assert.strictEqual(r.source.to, 'EMAIL_TO');

                process.env.EMAIL_CC = '';
                assert.deepStrictEqual(core.readRecipients(config).cc, ['c@x.com'], 'Empty variable falls back to config');
            } finally {
                if (saved.to === undefined) delete process.env.EMAIL_TO; else process.env.EMAIL_TO = saved.to;
                if (saved.cc === undefined) delete process.env.EMAIL_CC; else process.env.EMAIL_CC = saved.cc;
            }
        }
    },
    {
        name: 'core.isPrivatePath: credential/run-output files are never served (incl. Windows path tricks)',
        fn: () => {
            const core = require(path.join(MODULE_DIR, 'core.js'));
            [
                '/web_legacy_emails/jira_credentials.json',
                '/web_legacy_emails/email_credentials.json',
                '/web_legacy_emails/JIRA_CREDENTIALS.JSON',
                '/web_legacy_emails/jira%5Fcredentials.json',
                '/web_legacy_emails/jira_credentials.json.',
                '/web_legacy_emails/jira_credentials.json::$DATA',
                '/web_legacy_emails/schedule_runs.json',
                '/web_legacy_emails/last_scheduled_preview.html',
                '/web_legacy_emails/%E0%A4%A' // malformed encoding is refused
            ].forEach(p => assert.strictEqual(core.isPrivatePath(p), true, `must block ${p}`));
            ['/web_legacy_emails/index.html', '/web_legacy_emails/jira_config.json', '/style.css']
                .forEach(p => assert.strictEqual(core.isPrivatePath(p), false, `must allow ${p}`));
        }
    },
    {
        name: 'core.isSendDue: SEND_DAYS / SEND_TIME / once-per-day marker for GitHub Actions',
        fn: () => {
            const core = require(path.join(MODULE_DIR, 'core.js'));
            const fri1745 = new Date(2026, 9, 23, 17, 45); // Fri Oct 23, 2026 17:45 (local)
            const due = (o) => core.isSendDue({ lastSent: null, now: fri1745, ...o }).due;

            assert.strictEqual(due({ days: 'Fri', time: '17:30' }), true, 'Friday after 17:30 -> due');
            assert.strictEqual(due({ days: undefined, time: undefined }), true, 'Defaults Fri 17:30 -> due');
            assert.strictEqual(due({ days: 'Fri', time: '18:00' }), false, 'Before SEND_TIME -> not due');
            assert.strictEqual(due({ days: 'Mon,Thu', time: '17:00' }), false, 'Not a send day');
            assert.strictEqual(due({ days: 'monday; friday', time: '9:05' }), true, 'Full names, ; separator, H:MM');
            assert.strictEqual(due({ days: '5', time: '17:45' }), true, 'Day number, exactly on time');

            // Once per day per mode
            const sentSend = { date: 'Oct 23, 2026', mode: 'send', at: 'x' };
            assert.strictEqual(core.isSendDue({ days: 'Fri', time: '17:30', now: fri1745, lastSent: sentSend }).due, false, 'Already sent today');
            assert.strictEqual(core.isSendDue({ days: 'Fri', time: '17:30', now: fri1745, lastSent: { ...sentSend, date: 'Oct 16, 2026' } }).due, true, 'Sent last week -> due');
            assert.strictEqual(core.isSendDue({ days: 'Fri', time: '17:30', mode: 'send', now: fri1745, lastSent: { ...sentSend, mode: 'test' } }).due, true, 'A test today does not block the real send');

            assert.throws(() => core.isSendDue({ days: 'Fry', time: '17:30', now: fri1745, lastSent: null }), /Unknown day/);
            assert.throws(() => core.isSendDue({ days: 'Fri', time: '5 PM', now: fri1745, lastSent: null }), /HH:MM/);
        }
    },
    {
        name: 'core.isSendDue / scheduledEvening: GitHub runs late after midnight count as the previous evening',
        fn: () => {
            const core = require(path.join(MODULE_DIR, 'core.js'));
            // Real case 2026-10-21: SEND_DAYS=Tue, SEND_TIME=21:00, the 00:00 IST slot started at Wed 01:48
            const wed0148 = new Date(2026, 9, 21, 1, 48);
            const r = core.isSendDue({ days: 'Tue', time: '21:00', mode: 'test', now: wed0148, lastSent: null });
            assert.strictEqual(r.due, true, 'Late Wed 01:48 run belongs to Tuesday evening -> due');
            assert.ok(/late run at Wed 01:48/.test(r.reason), 'Reason explains the late run');
            assert.strictEqual(tpl.formatDateLabel(core.scheduledEvening(wed0148)), 'Oct 20, 2026', 'Dated Tuesday');

            // Marker from the late run blocks a second late run the same night
            const marker = { date: 'Oct 20, 2026', mode: 'test', at: 'x' };
            assert.strictEqual(core.isSendDue({ days: 'Tue', time: '21:00', mode: 'test', now: new Date(2026, 9, 21, 2, 30), lastSent: marker }).due, false);

            // 06:00 and later is the real day again
            const wed0600 = new Date(2026, 9, 21, 6, 0);
            assert.strictEqual(core.scheduledEvening(wed0600), wed0600, '06:00 unchanged');
            assert.strictEqual(core.isSendDue({ days: 'Tue', time: '21:00', now: wed0600, lastSent: null }).due, false, 'Wed 06:00 is not Tuesday');
            assert.strictEqual(core.isSendDue({ days: 'Wed', time: '05:00', now: wed0600, lastSent: null }).due, true, 'Wed 06:00 after 05:00 on Wed -> due');
        }
    },
    {
        name: 'core.readChartOptions: CHART_MAX_POINTS / CHART_RECENT_WEEKS env (GitHub variables) override config "chart"',
        fn: () => {
            const core = require(path.join(MODULE_DIR, 'core.js'));
            const saved = { max: process.env.CHART_MAX_POINTS, recent: process.env.CHART_RECENT_WEEKS };
            try {
                delete process.env.CHART_MAX_POINTS;
                delete process.env.CHART_RECENT_WEEKS;
                assert.deepStrictEqual({ ...core.readChartOptions({ chart: { maxPoints: 22, recentWeeks: 5 } }) }, { maxPoints: 22, recentWeeks: 5 }, 'Config used');
                assert.deepStrictEqual({ ...core.readChartOptions({}) }, { maxPoints: 19, recentWeeks: 4 }, 'Defaults when no config');
                process.env.CHART_MAX_POINTS = '20';
                assert.deepStrictEqual({ ...core.readChartOptions({ chart: { maxPoints: 22, recentWeeks: 5 } }) }, { maxPoints: 20, recentWeeks: 5 }, 'Env wins per setting');
            } finally {
                if (saved.max === undefined) delete process.env.CHART_MAX_POINTS; else process.env.CHART_MAX_POINTS = saved.max;
                if (saved.recent === undefined) delete process.env.CHART_RECENT_WEEKS; else process.env.CHART_RECENT_WEEKS = saved.recent;
            }
        }
    },
    {
        name: 'apps_script/github_trigger.gs: parsing, IST slots, once per slot, mode change, disabled, multi-time schedules',
        fn: () => {
            // Run the real .gs file with stand-ins for Apps Script services and the GitHub API
            const props = {};
            const vars = { WEEKLY_EMAIL_ENABLED: 'true', SEND_DAYS: 'Wed', SEND_TIME: '17:00', SCHEDULE_MODE: 'send' };
            const dispatches = [];
            let clock = new Date('2026-10-21T11:25:00Z'); // Wed 16:55 IST
            const ist = (d, opts) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', ...opts }).format(d);
            const ctx = {
                console: { log: () => {} },
                Date: class extends Date { constructor(...a) { super(...(a.length ? a : [clock.getTime()])); } static now() { return clock.getTime(); } },
                Utilities: {
                    formatDate: (d, tz, fmt) => ({
                        'yyyy-MM-dd': ist(d, { year: 'numeric', month: '2-digit', day: '2-digit' }).split('/').reverse().join('-'),
                        u: String((['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(ist(d, { weekday: 'short' }))) + 1),
                        H: String(Number(ist(d, { hour: '2-digit', hour12: false }))),
                        m: String(Number(ist(d, { minute: '2-digit' }))),
                        'HH:mm': ist(d, { hour: '2-digit', minute: '2-digit', hour12: false })
                    })[fmt]
                },
                PropertiesService: { getScriptProperties: () => ({
                    getProperty: k => props[k] || null, getProperties: () => ({ ...props }),
                    setProperty: (k, v) => { props[k] = v; }, deleteProperty: k => { delete props[k]; }
                }) },
                UrlFetchApp: { fetch: (url, o) => {
                    const m = /actions\/variables\/(\w+)$/.exec(url);
                    if (m) return { getResponseCode: () => (vars[m[1]] !== undefined ? 200 : 404), getContentText: () => JSON.stringify({ value: vars[m[1]] }) };
                    dispatches.push(JSON.parse(o.payload));
                    return { getResponseCode: () => 204, getContentText: () => '' };
                } }
            };
            props.GITHUB_TOKEN = 'test-token';
            vm.createContext(ctx);
            vm.runInContext(fs.readFileSync(path.join(MODULE_DIR, 'apps_script', 'github_trigger.gs'), 'utf8') +
                '\nthis.__api = { checkAndDispatch, parseDays_, parseTimes_, CONFIG };', ctx);
            const gs = ctx.__api;

            // Parsing
            assert.deepStrictEqual(Array.from(gs.parseDays_('Mon-Fri')), [1, 2, 3, 4, 5]);
            assert.deepStrictEqual(Array.from(gs.parseDays_('fri, monday')), [1, 5]);
            assert.deepStrictEqual(Array.from(gs.parseDays_('Fri-Mon')), [0, 1, 5, 6], 'Range across the weekend');
            assert.deepStrictEqual(Array.from(gs.parseDays_('*')), [0, 1, 2, 3, 4, 5, 6]);
            assert.deepStrictEqual(Array.from(gs.parseTimes_('10:00, 13:00, 9:05'), t => t.time), ['10:00', '13:00', '09:05']);
            assert.throws(() => gs.parseDays_('Fry'), /Unknown day/);
            assert.throws(() => gs.parseTimes_('5 PM'), /HH:MM/);

            // GitHub-variable schedule: Wed 17:00 IST
            gs.checkAndDispatch();
            assert.strictEqual(dispatches.length, 0, '16:55 IST: too early');
            clock = new Date('2026-10-21T11:35:00Z'); // 17:05 IST
            gs.checkAndDispatch();
            assert.strictEqual(dispatches.length, 1, '17:05 IST: dispatched');
            assert.deepStrictEqual(dispatches[0], { ref: 'main', inputs: { mode: 'scheduled' } });
            clock = new Date('2026-10-21T11:45:00Z');
            gs.checkAndDispatch();
            assert.strictEqual(dispatches.length, 1, 'Same slot not dispatched twice');
            vars.SCHEDULE_MODE = 'test';
            gs.checkAndDispatch();
            assert.strictEqual(dispatches.length, 2, 'Changed mode = new slot the same day');
            vars.WEEKLY_EMAIL_ENABLED = 'false';
            clock = new Date('2026-10-28T11:35:00Z'); // next Wed 17:05 IST
            gs.checkAndDispatch();
            assert.strictEqual(dispatches.length, 2, 'Disabled: nothing dispatched');

            // Fixed multi-time schedule (other projects): weekdays 10:00, 13:00, 17:00
            gs.CONFIG.schedule = [{ days: 'Mon-Fri', times: '10:00, 13:00, 17:00' }];
            const before = dispatches.length;
            ['04:35', '07:35', '07:45', '11:35'].forEach(utc => { clock = new Date(`2026-10-29T${utc}:00Z`); gs.checkAndDispatch(); }); // Thu 10:05, 13:05, 13:15, 17:05 IST
            assert.strictEqual(dispatches.length - before, 3, 'One dispatch per slot: 10:00, 13:00, 17:00');
            clock = new Date('2026-10-31T11:35:00Z'); // Sat
            gs.checkAndDispatch();
            assert.strictEqual(dispatches.length - before, 3, 'Saturday not in Mon-Fri');
        }
    },
    {
        name: 'deploy/sync_deploy.js threeWayMerge: one flow — base deletions/corrections applied, GitHub weeks never lost',
        fn: () => {
            const file = path.join(MODULE_DIR, 'deploy', 'sync_deploy.js');
            if (!fs.existsSync(file)) return; // base project only — deploy tooling isn't copied to the deploy repo
            const { threeWayMerge, mergeHistories } = require(file);
            const w = (d, v) => ({ ...week(d), olderHighest: v });
            const vals = (list) => Object.fromEntries(Array.from(list, h => [h.date, h.olderHighest]));

            // snapshot = GitHub's history at the last pull
            const snapshot = [w('Oct 9, 2026', 1), w('Oct 16, 2026', 1), w('Oct 21, 2026', 1)];
            // base since then: deleted Oct 21 (test week), corrected Oct 9, added Oct 20
            const base = [w('Oct 9, 2026', 7), w('Oct 16, 2026', 1), w('Oct 20, 2026', 3)];
            // GitHub since then: sent Oct 23, re-sent Oct 16 with new numbers
            const deploy = [w('Oct 9, 2026', 1), w('Oct 16, 2026', 5), w('Oct 21, 2026', 1), w('Oct 23, 2026', 2)];
            const r = threeWayMerge(snapshot, base, deploy);
            assert.deepStrictEqual(vals(r.merged), { 'Oct 9, 2026': 7, 'Oct 16, 2026': 5, 'Oct 20, 2026': 3, 'Oct 23, 2026': 2 });
            assert.deepStrictEqual(Array.from(r.deleted), ['Oct 21, 2026'], 'Deleted in base since the pull -> removed');
            assert.deepStrictEqual(Array.from(r.edited), ['Oct 9, 2026'], 'Corrected in base, GitHub unchanged -> base wins');
            assert.deepStrictEqual(Array.from(r.fromDeploy), ['Oct 23, 2026'], 'Sent by GitHub after the pull -> kept');
            assert.deepStrictEqual(Array.from(r.fromBase), ['Oct 20, 2026'], 'Only in base -> kept');
            assert.deepStrictEqual(Array.from(r.conflicts), [], 'Oct 16 changed only on GitHub -> no conflict, GitHub wins');

            // Both changed the same week -> GitHub wins, reported as conflict
            const c = threeWayMerge([w('Oct 9, 2026', 1)], [w('Oct 9, 2026', 2)], [w('Oct 9, 2026', 3)]);
            assert.deepStrictEqual([vals(c.merged)['Oct 9, 2026'], Array.from(c.conflicts)], [3, ['Oct 9, 2026']]);

            // Regression: snapshot = base (as saved after a push) must treat an unseen GitHub week as NEW, not deleted
            const afterPush = threeWayMerge(base, base, [...deploy.filter(h => h.date !== 'Oct 21, 2026'), w('Oct 30, 2026', 4)]);
            assert.ok(afterPush.fromDeploy.includes('Oct 30, 2026') && !afterPush.deleted.includes('Oct 30, 2026'), 'Unseen GitHub week is new');

            // No snapshot (never pulled) -> plain union, nothing deleted; deploy wins per date (case-insensitive)
            const u = mergeHistories([w('Oct 16, 2026', 1), w('Oct 23, 2026', 2)], [w('Oct 9, 2026', 4), w('oct 16, 2026', 9)]);
            assert.deepStrictEqual(vals(u), { 'Oct 9, 2026': 4, 'Oct 16, 2026': 1, 'Oct 23, 2026': 2 });
        }
    },
    {
        name: 'buildJiraUrl: strips protocol/path and encodes JQL',
        fn: () => {
            assert.strictEqual(tpl.buildJiraUrl('https://cropin.atlassian.net/browse/X', 'priority = High'),
                'https://cropin.atlassian.net/issues?jql=priority%20%3D%20High');
            assert.strictEqual(tpl.buildJiraUrl('', ''), 'https://cropin.atlassian.net/issues?jql=');
        }
    }
];

function runSuite() {
    console.log('--- Running Web Legacy Emails Regression Test Cases ---');
    let passed = 0;
    tests.forEach((t, index) => {
        console.log(`[Test ${index + 1}] Testing ${t.name}...`);
        t.fn();
        console.log(`✓ ${t.name} passed.`);
        passed++;
    });

    const total = tests.length;
    const existingCount = Math.min(total, baselineCount);
    const newCount = Math.max(0, total - baselineCount);

    console.log('\n=============================================');
    console.log(`Web Legacy Emails Test Suite Result:`);
    console.log(`- Existing Test Cases: ${existingCount}`);
    console.log(`- New Test Cases: ${newCount}`);
    console.log(`- Total Executed: ${total}`);
    console.log(`- Passed: ${passed} / ${total}`);
    console.log('=============================================\n');
}

module.exports = { runSuite, tests, baselineCount };

if (require.main === module) {
    try {
        runSuite();
        process.exit(0);
    } catch (error) {
        console.error('\n❌ Web Legacy Emails Test Suite FAILED:');
        console.error(error.stack || error.message || error);
        process.exit(1);
    }
}
