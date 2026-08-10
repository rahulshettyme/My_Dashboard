// Mock browser globals needed by the script when loaded under Node
global.getServerUrl = function() { return 'http://localhost:3000'; };
global.document = {
    addEventListener: () => {},
    getElementById: () => null
};
global.window = {};

const { runSuite } = require('./Aggregate-Data-Testing/health_script.test.js');

try {
    runSuite();
    process.exit(0);
} catch (error) {
    console.error('\n❌ Regression Test Suite FAILED:');
    console.error(error.stack || error.message || error);
    process.exit(1);
}
