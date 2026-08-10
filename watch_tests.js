const fs = require('fs');
const { exec } = require('child_process');
const path = require('path');

const filesToWatch = [
    path.join(__dirname, 'Aggregate-Data-Testing', 'health_script.js'),
    path.join(__dirname, 'Aggregate-Data-Testing', 'health_script.test.js')
];

let debounceTimer = null;

function runSuite() {
    console.clear();
    console.log(`[WATCHER] Change detected. Running tests... at ${new Date().toLocaleTimeString()}\n`);
    exec('node run_tests.js', (error, stdout, stderr) => {
        if (stdout) console.log(stdout);
        if (stderr) console.error(stderr);
        if (error) {
            console.error(`❌ Tests failed with exit code: ${error.code}`);
        } else {
            console.log('✓ All tests passed.');
        }
        console.log('\nWaiting for changes...');
    });
}

console.log('Starting regression watch process...');
runSuite(); // Run initially

filesToWatch.forEach(filePath => {
    if (fs.existsSync(filePath)) {
        fs.watch(filePath, (event, filename) => {
            if (filename) {
                clearTimeout(debounceTimer);
                debounceTimer = setTimeout(runSuite, 300);
            }
        });
        console.log(`Watching: ${filePath}`);
    } else {
        console.warn(`File not found: ${filePath}`);
    }
});
