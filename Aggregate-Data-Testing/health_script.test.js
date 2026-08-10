const assert = require('assert');
const healthScript = require('./health_script.js');

const baselineCount = 6;

const tests = [
    {
        name: 'formatDateToDMY',
        fn: () => {
            const d1 = new Date('2026-08-07T12:00:00Z');
            assert.strictEqual(healthScript.formatDateToDMY(d1), '07-08-2026', 'Date formatting mismatch for 2026-08-07');
        }
    },
    {
        name: 'isWithinAnalysisWindow',
        fn: () => {
            const today = new Date();
            const yesterday = new Date(today);
            yesterday.setDate(today.getDate() - 1);
            const yesterdayStr = yesterday.toISOString();
            assert.strictEqual(healthScript.isWithinAnalysisWindow(yesterdayStr, 15), true, 'Yesterday must be inside the analysis window');

            const todayStr = today.toISOString();
            assert.strictEqual(healthScript.isWithinAnalysisWindow(todayStr, 15), false, 'Today must be excluded from the analysis window');

            const oldDate = new Date(today);
            oldDate.setDate(today.getDate() - 16);
            const oldDateStr = oldDate.toISOString();
            assert.strictEqual(healthScript.isWithinAnalysisWindow(oldDateStr, 15), false, '16 days ago must be outside 15-day window');
        }
    },
    {
        name: 'classifyValueToStatus',
        fn: () => {
            assert.strictEqual(healthScript.classifyValueToStatus(0.72), 'Normal', '0.72 should classify as Normal');
            assert.strictEqual(healthScript.classifyValueToStatus(0.66), 'Normal', '0.66 (boundary) should classify as Normal');
            assert.strictEqual(healthScript.classifyValueToStatus(0.50), 'Early Symptoms Noted', '0.50 should classify as Early Symptoms Noted');
            assert.strictEqual(healthScript.classifyValueToStatus(0.33), 'Early Symptoms Noted', '0.33 (boundary) should classify as Early Symptoms Noted');
            assert.strictEqual(healthScript.classifyValueToStatus(0.20), 'Plots Need Attention', '0.20 should classify as Plots Need Attention');
            assert.strictEqual(healthScript.classifyValueToStatus('-'), '-', 'Non-numeric symbol should return -');
        }
    },
    {
        name: 'formatHealthStatus (legacy mode)',
        fn: () => {
            global.window.healthIndicatorsDisabled = false;
            assert.strictEqual(healthScript.formatHealthStatus('normal'), 'Normal', 'normal -> Normal in legacy mode');
            assert.strictEqual(healthScript.formatHealthStatus('plots_need_attention'), 'Plots Need Attention', 'plots_need_attention -> Plots Need Attention');
        }
    },
    {
        name: 'formatHealthStatus (index mode)',
        fn: () => {
            global.window.healthIndicatorsDisabled = true;
            assert.strictEqual(healthScript.formatHealthStatus('Normal'), '0.66 - 1', 'Normal -> 0.66 - 1 in index mode');
            assert.strictEqual(healthScript.formatHealthStatus('Early Symptoms Noted'), '0.33 - 0.66', 'Early Symptoms -> 0.33 - 0.66');
            assert.strictEqual(healthScript.formatHealthStatus('Plots Need Attention'), '-1 - 0.33', 'Attention -> -1 - 0.33');
            assert.strictEqual(healthScript.formatHealthStatus('0.72'), '0.66 - 1', 'Numeric string 0.72 -> 0.66 - 1 in index mode');
            assert.strictEqual(healthScript.formatHealthStatus('0.45'), '0.33 - 0.66', 'Numeric string 0.45 -> 0.33 - 0.66');
        }
    },
    {
        name: 'getHealthStatusColor',
        fn: () => {
            assert.strictEqual(healthScript.getHealthStatusColor('Normal'), '#10b981', 'Normal should be green');
            assert.strictEqual(healthScript.getHealthStatusColor('Early Symptoms Noted'), '#f59e0b', 'Early Symptoms should be yellow');
            assert.strictEqual(healthScript.getHealthStatusColor('Plots Need Attention'), '#ef4444', 'Attention should be red');
            assert.strictEqual(healthScript.getHealthStatusColor('0.66 - 1'), '#10b981', '0.66 - 1 range should be green');
            assert.strictEqual(healthScript.getHealthStatusColor('0.33 - 0.66'), '#f59e0b', '0.33 - 0.66 range should be yellow');
            assert.strictEqual(healthScript.getHealthStatusColor('-1 - 0.33'), '#ef4444', 'Negative range should be red');
        }
    },
    {
        name: 'newFeatureRegressionCheck',
        fn: () => {
            global.window.healthIndicatorsDisabled = true;
            assert.strictEqual(healthScript.formatHealthStatus(0.66), '0.66 - 1', '0.66 boundary value must map to range 0.66 - 1');
        }
    }
];

function runSuite() {
    console.log('--- Running Health Script Regression Test Cases ---');
    global.window = { healthIndicatorsDisabled: false };

    let passed = 0;
    let failed = 0;

    tests.forEach((t, index) => {
        console.log(`[Test ${index + 1}] Testing ${t.name}...`);
        try {
            t.fn();
            console.log(`✓ ${t.name} passed.`);
            passed++;
        } catch (e) {
            console.error(`❌ ${t.name} failed!`);
            throw e;
        }
    });

    const total = tests.length;
    const existingCount = Math.min(total, baselineCount);
    const newCount = Math.max(0, total - baselineCount);

    console.log('\n=============================================');
    console.log(`Regression Test Suite Result:`);
    console.log(`- Existing Test Cases: ${existingCount}`);
    console.log(`- New Test Cases: ${newCount}`);
    console.log(`- Total Executed: ${total}`);
    console.log(`- Passed: ${passed} / ${total}`);
    console.log('=============================================\n');
}

module.exports = { runSuite, tests, baselineCount };
