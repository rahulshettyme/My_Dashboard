const assert = require('assert');
const healthScript = require('./health_script.js');
const { selectYieldPredictionParameters } = require('../server.js');

const baselineCount = 11;

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
            
            // Today (should be included now)
            const todayStr = today.toISOString();
            assert.strictEqual(healthScript.isWithinAnalysisWindow(todayStr, 15), true, 'Today must be included in the analysis window');

            // Yesterday (should be included)
            const yesterday = new Date(today);
            yesterday.setDate(today.getDate() - 1);
            const yesterdayStr = yesterday.toISOString();
            assert.strictEqual(healthScript.isWithinAnalysisWindow(yesterdayStr, 15), true, 'Yesterday must be inside the analysis window');

            // 15 days ago (should be outside a 15-day window including today)
            const oldDate = new Date(today);
            oldDate.setDate(today.getDate() - 15);
            const oldDateStr = oldDate.toISOString();
            assert.strictEqual(healthScript.isWithinAnalysisWindow(oldDateStr, 15), false, '15 days ago must be outside 15-day window');
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
    },
    {
        name: 'plSameDayFilteringLogic',
        fn: () => {
            const getCalendarDay = (dateStr) => {
                if (!dateStr || dateStr === '-') return '';
                const d = new Date(dateStr);
                return isNaN(d.getTime()) ? '' : d.toDateString();
            };

            const validRecords = [
                { capturedDateTime: '2026-08-10T12:00:00Z', provider: 'planet' },
                { capturedDateTime: '2026-08-10T08:00:00Z', provider: 'sentinel' },
                { capturedDateTime: '2026-08-05T09:00:00Z', provider: 'sentinel' }
            ];

            const latestDay = getCalendarDay(validRecords[0].capturedDateTime);
            const plCandidates = validRecords.filter(r => getCalendarDay(r.capturedDateTime) !== latestDay);

            assert.strictEqual(plCandidates.length, 1, 'Should filter out all records from the same day as latest');
            assert.strictEqual(plCandidates[0].capturedDateTime, '2026-08-05T09:00:00Z', 'PL candidate should be from a previous day');
            assert.strictEqual(plCandidates[0].provider, 'sentinel', 'PL candidate provider should match');
        }
    },
    {
        name: 'formatGerminationStatus',
        fn: () => {
            assert.strictEqual(healthScript.formatGerminationStatus('good'), 'Good', 'good should format to Good');
            assert.strictEqual(healthScript.formatGerminationStatus('normal'), 'Good', 'normal should format to Good');
            assert.strictEqual(healthScript.formatGerminationStatus('moderate'), 'Moderate', 'moderate should format to Moderate');
            assert.strictEqual(healthScript.formatGerminationStatus('needsAttention'), 'Need Attention', 'needsAttention should format to Need Attention');
            assert.strictEqual(healthScript.formatGerminationStatus('attention'), 'Need Attention', 'attention should format to Need Attention');
            assert.strictEqual(healthScript.formatGerminationStatus('-'), '-', '- should format to -');
        }
    },
    {
        name: 'getGerminationColor',
        fn: () => {
            assert.strictEqual(healthScript.getGerminationColor('Good'), '#10b981', 'Good status should color green');
            assert.strictEqual(healthScript.getGerminationColor('Moderate'), '#f59e0b', 'Moderate status should color yellow');
            assert.strictEqual(healthScript.getGerminationColor('Need Attention'), '#ef4444', 'Need Attention status should color red');
        }
    },
    {
        name: 'getPrEnabledPlots',
        fn: () => {
            global.window.verifiedHealthPlots = undefined;
            assert.deepStrictEqual(healthScript.getPrEnabledPlots(), [], 'Should return empty array when verifiedHealthPlots is undefined');

            global.window.verifiedHealthPlots = [];
            assert.deepStrictEqual(healthScript.getPrEnabledPlots(), [], 'Should return empty array when verifiedHealthPlots is empty');

            const mockPlots = [
                { caId: '101', name: 'Plot 101' },
                { caId: '102', name: 'Plot 102' }
            ];
            global.window.verifiedHealthPlots = mockPlots;
            const result = healthScript.getPrEnabledPlots();
            assert.strictEqual(result.length, 2, 'Should return only PR-enabled plots');
            assert.strictEqual(result[0].caId, '101');
            assert.strictEqual(result[1].caId, '102');
        }
    },
    {
        name: 'selectYieldPredictionParameters_TASUMI_priority',
        fn: () => {
            const samplePayload = {
                totalItems: 3,
                records: [
                    {
                        modelType: 'TASUMI',
                        modifiedDateTime: '2026-09-03T12:17:06.726Z',
                        parameters: {
                            yieldMin: '7.535',
                            yieldMax: '8.328',
                            yieldAvg: '7.932',
                            productionMin: '9.209',
                            productionMax: '10.179',
                            productionAvg: '9.694'
                        }
                    },
                    {
                        modelType: 'BIOMASS_GDD',
                        modifiedDateTime: '2026-09-07T01:55:50.090Z',
                        parameters: {
                            yieldMin: '12.643',
                            yieldMax: '13.973'
                        }
                    },
                    {
                        modelType: 'BIOMASS_DAYS',
                        modifiedDateTime: '2026-09-07T01:55:50.357Z',
                        parameters: {
                            yieldMin: '32.625',
                            yieldMax: '36.059',
                            productionMin: '39.872',
                            productionMax: '44.07'
                        }
                    }
                ]
            };

            const result = selectYieldPredictionParameters(samplePayload);
            assert.ok(result, 'Result should not be null');
            assert.strictEqual(result.modelType, 'TASUMI', 'TASUMI should be prioritized');
            assert.strictEqual(result.yieldMin, '7.535');
            assert.strictEqual(result.productionMin, '9.209');
        }
    },
    {
        name: 'selectYieldPredictionParameters_BIOMASS_DAYS_fallback',
        fn: () => {
            const samplePayloadNoTasumi = {
                totalItems: 2,
                records: [
                    {
                        modelType: 'BIOMASS_GDD',
                        modifiedDateTime: '2026-09-07T01:55:50.090Z',
                        parameters: { yieldMin: '12.643' }
                    },
                    {
                        modelType: 'BIOMASS_DAYS',
                        modifiedDateTime: '2026-09-07T01:55:50.357Z',
                        parameters: {
                            yieldMin: '32.625',
                            yieldMax: '36.059',
                            productionMin: '39.872',
                            productionMax: '44.07'
                        }
                    }
                ]
            };

            const result = selectYieldPredictionParameters(samplePayloadNoTasumi);
            assert.ok(result, 'Result should not be null');
            assert.strictEqual(result.modelType, 'BIOMASS_DAYS', 'BIOMASS_DAYS should be selected as fallback');
            assert.strictEqual(result.yieldMin, '32.625');
            assert.strictEqual(result.productionMin, '39.872');
        }
    },
    {
        name: 'selectYieldPredictionParameters_latest_date_selection',
        fn: () => {
            const multipleTasumi = {
                records: [
                    {
                        modelType: 'TASUMI',
                        modifiedDateTime: '2026-08-01T00:00:00.000Z',
                        parameters: { yieldMin: '5.000', productionMin: '6.000' }
                    },
                    {
                        modelType: 'TASUMI',
                        modifiedDateTime: '2026-09-01T00:00:00.000Z',
                        parameters: { yieldMin: '8.500', productionMin: '10.000' }
                    }
                ]
            };

            const result = selectYieldPredictionParameters(multipleTasumi);
            assert.ok(result, 'Result should not be null');
            assert.strictEqual(result.yieldMin, '8.500', 'Should select the latest TASUMI record by date');
            assert.strictEqual(result.productionMin, '10.000');
        }
    },
    {
        name: 'resolveUnitId_dynamic_lookup_without_hardcoded_ids',
        fn: () => {
            const mockCustomTenant = {
                'unit-master': [
                    { id: 999, name: 'Metric Ton', unitSymbol: 'MT', unitType: 'Mass', unitCode: 'METRIC_TON' },
                    { id: 888, name: 'Kilogram', unitSymbol: 'kg', unitType: 'Mass', unitCode: 'KILOGRAM' },
                    { id: 777, name: 'Acre', unitSymbol: 'ac', unitType: 'Area', unitCode: 'ACRE' },
                    { id: 666, name: 'Hectare', unitSymbol: 'ha', unitType: 'Area', unitCode: 'HECTARE' },
                    { id: 555, name: 'Ton', unitSymbol: 'ton', unitType: 'Mass', unitCode: 'TON' }
                ],
                'unit-conversion': []
            };

            // Resolving Mass units with non-standard tenant IDs
            assert.strictEqual(healthScript.resolveUnitId('Mass', 'kgs', mockCustomTenant), 888, 'Kgs should resolve to 888');
            assert.strictEqual(healthScript.resolveUnitId('Mass', 'Kilogram', mockCustomTenant), 888, 'Kilogram should resolve to 888');
            assert.strictEqual(healthScript.resolveUnitId('Mass', ['METRIC_TON', 'Ton (Metric)'], mockCustomTenant), 999, 'Metric Ton should resolve to 999');
            assert.strictEqual(healthScript.resolveUnitId('Mass', 'ton', mockCustomTenant), 555, 'US Ton should resolve to 555');

            // Resolving Area units
            assert.strictEqual(healthScript.resolveUnitId('Area', 'ha', mockCustomTenant), 666, 'Hectare should resolve to 666');
            assert.strictEqual(healthScript.resolveUnitId('Area', 'acre', mockCustomTenant), 777, 'Acre should resolve to 777');
            assert.strictEqual(healthScript.resolveUnitId('Area', 'unknown_unit', mockCustomTenant), null, 'Unknown unit should return null');
        }
    },
    {
        name: 'getDynamicFactor_direct_and_reciprocal_rules',
        fn: () => {
            const mockMaster = {
                'unit-master': [
                    { id: 10, name: 'Kilogram', unitSymbol: 'kg', unitType: 'Mass', unitCode: 'KILOGRAM' },
                    { id: 20, name: 'Metric Ton', unitSymbol: 'MT', unitType: 'Mass', unitCode: 'METRIC_TON' },
                    { id: 30, name: 'Hectare', unitSymbol: 'ha', unitType: 'Area', unitCode: 'HECTARE' },
                    { id: 40, name: 'Acre', unitSymbol: 'ac', unitType: 'Area', unitCode: 'ACRE' }
                ],
                'unit-conversion': [
                    // Direct rule: Kilogram (10) -> Metric Ton (20) = 0.001
                    { id: 1, fromUnitId: 10, toUnitId: 20, conversionFactor: 0.001, unitType: 'Mass' },
                    // Direct rule: Hectare (30) -> Acre (40) = 2.47105
                    { id: 2, fromUnitId: 30, toUnitId: 40, conversionFactor: 2.47105, unitType: 'Area' }
                ]
            };

            // Identity
            assert.strictEqual(healthScript.getDynamicFactor('kg', 'kg', 'Mass', mockMaster), 1.0, 'Same unit should yield factor 1.0');

            // Direct rule: Kg to MT
            const kgToMt = healthScript.getDynamicFactor('kg', 'MT', 'Mass', mockMaster);
            assert.strictEqual(kgToMt, 0.001, 'Kg -> MT should be 0.001');

            // Reciprocal rule: MT to Kg (1 / 0.001 = 1000)
            const mtToKg = healthScript.getDynamicFactor('MT', 'kg', 'Mass', mockMaster);
            assert.strictEqual(mtToKg, 1000, 'MT -> Kg should be 1000 via reciprocal rule');

            // Direct rule: Ha to Acre
            const haToAcre = healthScript.getDynamicFactor('ha', 'acre', 'Area', mockMaster);
            assert.strictEqual(haToAcre, 2.47105, 'Ha -> Acre should be 2.47105');

            // Reciprocal rule: Acre to Ha (1 / 2.47105 ~= 0.404686)
            const acreToHa = healthScript.getDynamicFactor('acre', 'ha', 'Area', mockMaster);
            assert.ok(Math.abs(acreToHa - 0.404686) < 0.0001, 'Acre -> Ha should be approximately 0.404686');
        }
    },
    {
        name: 'convertYield_and_convertHarvest_calculation',
        fn: () => {
            const mockMaster = {
                'unit-master': [
                    { id: 1, name: 'Kilogram', unitSymbol: 'kg', unitType: 'Mass', unitCode: 'KILOGRAM' },
                    { id: 2, name: 'Metric Ton', unitSymbol: 'MT', unitType: 'Mass', unitCode: 'METRIC_TON' },
                    { id: 3, name: 'Hectare', unitSymbol: 'ha', unitType: 'Area', unitCode: 'HECTARE' },
                    { id: 4, name: 'Acre', unitSymbol: 'ac', unitType: 'Area', unitCode: 'ACRE' }
                ],
                'unit-conversion': [
                    { id: 1, fromUnitId: 2, toUnitId: 1, conversionFactor: 1000.0, unitType: 'Mass' },
                    { id: 2, fromUnitId: 3, toUnitId: 4, conversionFactor: 2.47105, unitType: 'Area' }
                ]
            };

            // AI predicted harvest: 15.0 Metric Tonnes -> User unit: kgs
            const harvestInKg = healthScript.convertHarvest(15.0, 'kgs', mockMaster);
            assert.strictEqual(harvestInKg, 15000.0, '15 MT must convert to 15,000 Kgs');

            // AI predicted yield: 10.0 Tonnes/Ha -> User unit: kgs_acre
            // Mass factor: MT -> Kg = 1000
            // Area factor: Ha -> Acre = 2.47105
            // Yield factor = 1000 / 2.47105 = 404.686267
            // 10.0 * 404.686267 = 4046.86267
            const yieldInKgAcre = healthScript.convertYield(10.0, 'kgs_acre', mockMaster);
            assert.ok(Math.abs(yieldInKgAcre - 4046.86267) < 0.01, '10 Tonnes/Ha must convert to ~4046.86 Kg/Acre');

            // 1:1 Metric Tonnes/Ha -> tonne_ha
            const yieldInTonneHa = healthScript.convertYield(5.5, 'tonne_ha', mockMaster);
            assert.strictEqual(yieldInTonneHa, 5.5, '5.5 Tonne/Ha must remain 5.5');
        }
    },
    {
        name: 'dynamic_conversion_fallback_behavior',
        fn: () => {
            // Test with null masterData - should gracefully fallback to standard constants
            const haToAcreFallback = healthScript.getDynamicFactor('ha', 'acre', 'Area', null);
            assert.strictEqual(haToAcreFallback, 2.47105, 'Fallback for Ha -> Acre should be 2.47105');

            const acreToHaFallback = healthScript.getDynamicFactor('acre', 'ha', 'Area', null);
            assert.strictEqual(acreToHaFallback, 0.404686, 'Fallback for Acre -> Ha should be 0.404686');

            const mtToKgFallback = healthScript.getDynamicFactor('tonne', 'kgs', 'Mass', null);
            assert.strictEqual(mtToKgFallback, 1000, 'Fallback for Tonne -> Kgs should be 1000');
        }
    },
    {
        name: 'formatTrendDate_date_formatting',
        fn: () => {
            assert.strictEqual(healthScript.formatTrendDate('2026-05-31'), '31 May', '2026-05-31 -> 31 May');
            assert.strictEqual(healthScript.formatTrendDate('2026-06-10T00:00:00.000Z'), '10 Jun', '2026-06-10 -> 10 Jun');
            assert.strictEqual(healthScript.formatTrendDate('2026-08-29'), '29 Aug', '2026-08-29 -> 29 Aug');
            assert.strictEqual(healthScript.formatTrendDate(''), '', 'Empty string -> empty');
        }
    },
    {
        name: 'extractPlotMultiModelData_biomass_and_tasumi_trend',
        fn: () => {
            const mockPlotWithBothModels = {
                y1: 15000,
                y2: 15000,
                h1: 45300,
                h2: 45300,
                yieldRawRecords: [
                    {
                        modelType: 'TASUMI',
                        createdDateTime: '2026-09-03T00:00:00.000Z',
                        parameters: {
                            yieldAvg: '7.932',
                            yieldMin: '7.535',
                            yieldMax: '8.328',
                            productionAvg: '9.694',
                            productionMin: '9.209',
                            productionMax: '10.179'
                        }
                    },
                    {
                        modelType: 'BIOMASS_DAYS',
                        gddPredictions: [
                            { cutoff_date: '2026-05-31', yieldAvg: 4.942, yieldMin: 4.695, yieldMax: 5.189, productionAvg: 6.04, productionMin: 5.738, productionMax: 6.342 },
                            { cutoff_date: '2026-06-10', yieldAvg: 9.63, yieldMin: 9.15, yieldMax: 10.11, productionAvg: 11.768, productionMin: 11.18, productionMax: 12.35 },
                            { cutoff_date: '2026-08-29', yieldAvg: 34.34, yieldMin: 32.62, yieldMax: 36.05, productionAvg: 41.971, productionMin: 39.87, productionMax: 44.07 }
                        ]
                    }
                ]
            };

            const data = healthScript.extractPlotMultiModelData(mockPlotWithBothModels, 'kgs_acre', 'kgs');
            assert.ok(data, 'Data should not be null when BIOMASS_DAYS is present');
            assert.strictEqual(data.labels.length, 4, 'Should contain 3 biomass points + 1 latest TASUMI point');
            assert.strictEqual(data.labels[0], '31 May');
            assert.strictEqual(data.labels[2], '29 Aug');
            assert.strictEqual(data.labels[3], '03 Sep', 'Last point label should be TASUMI created date');

            // TASUMI yieldAvg: 7.932 Tonnes/Ha * ~404.686267 = ~3209.97 Kg/Acre
            assert.ok(data.tasumi.yieldAvg > 3200 && data.tasumi.yieldAvg < 3220, 'TASUMI yieldAvg should convert to ~3209.97 Kg/Acre');
            // TASUMI harvestAvg: 9.694 Tonnes * 1000 = 9694 Kgs
            assert.strictEqual(data.tasumi.harvestAvg, 9694, 'TASUMI harvestAvg should convert to 9,694 Kgs');

            // Reference standards
            assert.strictEqual(data.stdYield, 15000);
            assert.strictEqual(data.stdHarvest, 45300);

            // Test when BIOMASS_DAYS is absent
            const plotWithoutBiomass = {
                yieldRawRecords: [{ modelType: 'TASUMI', parameters: {} }]
            };
            assert.strictEqual(healthScript.extractPlotMultiModelData(plotWithoutBiomass), null, 'Should return null when BIOMASS_DAYS is absent');
        }
    },
    {
        name: 'extractPlotMultiModelData_min_max_and_avg_trend_arrays',
        fn: () => {
            const mockPlot = {
                y1: 15000,
                y2: 12000,
                h1: 45300,
                h2: 36240,
                yieldRawRecords: [
                    {
                        modelType: 'TASUMI',
                        createdDateTime: '2026-09-03T00:44:12.088Z',
                        parameters: {
                            yieldAvg: '7.932',
                            yieldMin: '7.535',
                            yieldMax: '8.328',
                            productionAvg: '9.694',
                            productionMin: '9.209',
                            productionMax: '10.179'
                        }
                    },
                    {
                        modelType: 'BIOMASS_DAYS',
                        gddPredictions: [
                            { cutoff_date: '2026-08-04', yieldAvg: 26.0425, yieldMin: 24.74, yieldMax: 27.345, productionAvg: 31.828, productionMin: 30.236, productionMax: 33.42 }
                        ]
                    }
                ]
            };

            const data = healthScript.extractPlotMultiModelData(mockPlot, 'kgs_acre', 'kgs');
            assert.ok(data.yieldMinTrend, 'yieldMinTrend array must exist');
            assert.ok(data.yieldMaxTrend, 'yieldMaxTrend array must exist');
            assert.ok(data.harvestMinTrend, 'harvestMinTrend array must exist');
            assert.ok(data.harvestMaxTrend, 'harvestMaxTrend array must exist');

            // Point 0 (04 Aug Biomass Days):
            // yieldMin: 24.74 * 404.686267 = ~10011.94
            // yieldMax: 27.345 * 404.686267 = ~11066.15
            // yieldAvg: 26.0425 * 404.686267 = ~10539.04
            assert.ok(data.yieldMinTrend[0] > 10000 && data.yieldMinTrend[0] < 10020, 'Point 0 yieldMin should be ~10011.94');
            assert.ok(data.yieldMaxTrend[0] > 11050 && data.yieldMaxTrend[0] < 11080, 'Point 0 yieldMax should be ~11066.15');
            assert.ok(data.yieldTrend[0] > 10530 && data.yieldTrend[0] < 10550, 'Point 0 yieldAvg should be ~10539.04');

            // Point 1 (03 Sep TASUMI):
            // yieldMin: 7.535 * 404.686267 = ~3049.31
            // yieldMax: 8.328 * 404.686267 = ~3370.23
            // yieldAvg: 7.932 * 404.686267 = ~3209.97
            assert.ok(data.yieldMinTrend[1] > 3040 && data.yieldMinTrend[1] < 3060, 'TASUMI yieldMin should be ~3049.31');
            assert.ok(data.yieldMaxTrend[1] > 3360 && data.yieldMaxTrend[1] < 3380, 'TASUMI yieldMax should be ~3370.23');
            assert.ok(data.yieldTrend[1] > 3200 && data.yieldTrend[1] < 3220, 'TASUMI yieldAvg should be ~3209.97');

            // Harvest values for TASUMI (converted to Kgs):
            assert.strictEqual(data.harvestMinTrend[1], 9209, 'TASUMI harvestMin should be 9209 Kgs');
            assert.strictEqual(data.harvestMaxTrend[1], 10179, 'TASUMI harvestMax should be 10179 Kgs');
            assert.strictEqual(data.harvestTrend[1], 9694, 'TASUMI harvestAvg should be 9694 Kgs');
        }
    },
    {
        name: 'selectYieldPredictionParameters_neither_present_returns_null',
        fn: () => {
            // Rule 3: If neither TASUMI nor BIOMASS_DAYS is present, return null (mark as NA, do not aggregate)
            const payloadOtherModelsOnly = {
                records: [
                    {
                        modelType: 'BIOMASS_GDD',
                        parameters: { yieldMin: '10.0', productionMin: '12.0' }
                    },
                    {
                        modelType: 'NDVI_HISTORICAL',
                        parameters: { yieldMin: '11.0', productionMin: '13.0' }
                    }
                ]
            };

            const result = selectYieldPredictionParameters(payloadOtherModelsOnly);
            assert.strictEqual(result, null, 'Should return null when neither TASUMI nor BIOMASS_DAYS is present');

            const emptyPayload = { records: [] };
            assert.strictEqual(selectYieldPredictionParameters(emptyPayload), null, 'Empty records should return null');
        }
    },
    {
        name: 'resolveYieldPredictionRules_three_rule_verification',
        fn: () => {
            // Rule 1: TASUMI present -> Use TASUMI
            const recordsWithBoth = [
                {
                    modelType: 'BIOMASS_DAYS',
                    modifiedDateTime: '2026-09-07T01:55:50.357Z',
                    gddPredictions: [
                        { cutoff_date: '2026-05-31', yieldMin: 4.695, yieldAvg: 4.89, productionMin: 5.68, productionAvg: 5.98 },
                        { cutoff_date: '2026-08-29', yieldMin: 32.62, yieldAvg: 34.34, productionMin: 39.87, productionAvg: 41.97 }
                    ]
                },
                {
                    modelType: 'TASUMI',
                    modifiedDateTime: '2026-09-03T12:17:06.726Z',
                    parameters: {
                        yieldMin: '7.535',
                        yieldMax: '8.328',
                        yieldAvg: '7.932',
                        productionMin: '9.209',
                        productionMax: '10.179',
                        productionAvg: '9.694'
                    }
                }
            ];

            const tasumiResult = healthScript.resolveYieldPredictionRules(recordsWithBoth);
            assert.strictEqual(tasumiResult.modelType, 'TASUMI');
            assert.strictEqual(tasumiResult.yieldMin, '7.535');
            assert.strictEqual(tasumiResult.productionMin, '9.209');

            // Rule 2: TASUMI not present -> Use latest BIOMASS_DAYS cutoff date values (not an average across dates)
            const recordsBiomassOnly = [
                {
                    modelType: 'BIOMASS_DAYS',
                    modifiedDateTime: '2026-09-07T01:55:50.357Z',
                    gddPredictions: [
                        { cutoff_date: '2026-05-31', yieldMin: 4.695, yieldAvg: 4.89, productionMin: 5.68, productionAvg: 5.98 },
                        { cutoff_date: '2026-08-29', yieldMin: 32.62, yieldAvg: 34.34, productionMin: 39.87, productionAvg: 41.97 }
                    ]
                }
            ];

            const biomassResult = healthScript.resolveYieldPredictionRules(recordsBiomassOnly);
            assert.strictEqual(biomassResult.modelType, 'BIOMASS_DAYS');
            assert.strictEqual(biomassResult.yieldMin, 32.62, 'Should pick latest cutoff date (2026-08-29), not earlier cutoff date');
            assert.strictEqual(biomassResult.productionMin, 39.87, 'Should pick latest cutoff date (2026-08-29)');

            // Rule 3: Neither present -> Return null (mark as NA, do not aggregate)
            const recordsNeither = [
                {
                    modelType: 'BIOMASS_GDD',
                    parameters: { yieldMin: '15.0' }
                }
            ];
            assert.strictEqual(healthScript.resolveYieldPredictionRules(recordsNeither), null, 'Should return null when neither model is present');
            assert.strictEqual(healthScript.resolveYieldPredictionRules([]), null, 'Empty array should return null');
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
