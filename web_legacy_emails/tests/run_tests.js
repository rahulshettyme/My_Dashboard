// Web Legacy Emails — module-scoped regression suite.
// Run from the project root with: node web_legacy_emails/tests/run_tests.js
// Deliberately independent of the root `node run_tests.js` (Health/Yield/Growth suite).
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// Ratchets forward to tests.length after every task — represents "tests that existed
// before the CURRENT task's changes", not a fixed historical constant.
const baselineCount = 11;

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
        name: 'filterHistoryForChart: single month shows every week',
        fn: () => {
            const h = [week('Oct 2, 2026'), week('Oct 9, 2026'), week('Oct 16, 2026')];
            assert.deepStrictEqual(dates(tpl.filterHistoryForChart(h)), dates(h));
        }
    },
    {
        name: 'filterHistoryForChart: older months keep only their first week',
        fn: () => {
            const h = [
                week('Jul 3, 2026'), week('Jul 10, 2026'), week('Jul 17, 2026'),
                week('Aug 7, 2026'), week('Aug 14, 2026'),
                week('Sep 4, 2026'),
                week('Oct 2, 2026')
            ];
            assert.deepStrictEqual(dates(tpl.filterHistoryForChart(h)),
                ['Jul 3, 2026', 'Aug 7, 2026', 'Sep 4, 2026', 'Oct 2, 2026']);
        }
    },
    {
        name: 'filterHistoryForChart: previous month retires weeks 2..N+1 as current month grows',
        fn: () => {
            const sep = [week('Sep 4, 2026'), week('Sep 11, 2026'), week('Sep 18, 2026'), week('Sep 25, 2026')];

            // 1 week in Oct → Sep week 2 hidden
            assert.deepStrictEqual(dates(tpl.filterHistoryForChart([...sep, week('Oct 2, 2026')])),
                ['Sep 4, 2026', 'Sep 18, 2026', 'Sep 25, 2026', 'Oct 2, 2026']);

            // 2 weeks in Oct → Sep weeks 2-3 hidden
            assert.deepStrictEqual(dates(tpl.filterHistoryForChart([...sep, week('Oct 2, 2026'), week('Oct 9, 2026')])),
                ['Sep 4, 2026', 'Sep 25, 2026', 'Oct 2, 2026', 'Oct 9, 2026']);

            // 3+ weeks in Oct → only Sep anchor remains
            assert.deepStrictEqual(dates(tpl.filterHistoryForChart([...sep, week('Oct 2, 2026'), week('Oct 9, 2026'), week('Oct 16, 2026')])),
                ['Sep 4, 2026', 'Oct 2, 2026', 'Oct 9, 2026', 'Oct 16, 2026']);
        }
    },
    {
        name: 'filterHistoryForChart: real jira_weekly_history.json keeps first + last entry and one point per older month',
        fn: () => {
            const history = JSON.parse(fs.readFileSync(path.join(MODULE_DIR, 'jira_weekly_history.json'), 'utf8'));
            const filtered = tpl.filterHistoryForChart(history);
            assert.strictEqual(filtered[0].date, history[0].date, 'First history entry must remain the first chart point');
            assert.strictEqual(filtered[filtered.length - 1].date, history[history.length - 1].date, 'Latest entry must be the last chart point');
            assert.ok(filtered.length < history.length, 'Rollover must hide some weekly entries');
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
        name: 'buildJiraUrl: strips protocol/path and encodes JQL',
        fn: () => {
            assert.strictEqual(script.buildJiraUrl('https://cropin.atlassian.net/browse/X', 'priority = High'),
                'https://cropin.atlassian.net/issues?jql=priority%20%3D%20High');
            assert.strictEqual(script.buildJiraUrl('', ''), 'https://cropin.atlassian.net/issues?jql=');
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
